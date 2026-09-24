#!/usr/bin/env python3
"""Minimal ComfyUI API client for Ashenhold TD image generation.

Standard library only. Submits the workflow template next to this file to a
running ComfyUI server, waits for the result, and downloads the first image.

Exit codes: 0 success, 2 usage error, 3 ComfyUI unreachable, 4 generation failed.
"""
import argparse
import json
import os
import pathlib
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid

TEMPLATE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfyui", "txt2img.json")


def resolve_output(raw):
    """Resolve an output path and refuse to write outside the allowed roots.

    Allowed: <project>/Assets/, <project>/Artifacts/, /tmp/opencode/.
    Returns None (after printing the reason) when the path is not allowed.
    """
    root = pathlib.Path(os.environ.get("MEDIA_PROJECT_ROOT") or pathlib.Path(__file__).resolve().parents[3])
    target = pathlib.Path(raw)
    if not target.is_absolute():
        target = pathlib.Path.cwd() / target
    target = target.resolve()
    allowed = (root / "Assets", root / "Artifacts", pathlib.Path("/tmp/opencode"))
    if not any(target == base or base in target.parents for base in allowed):
        print(f"error: output must be inside Assets/, Artifacts/, or /tmp/opencode/ (got: {raw})",
              file=sys.stderr)
        return None
    target.parent.mkdir(parents=True, exist_ok=True)
    return target


def http_json(url, payload=None, timeout=30):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    req = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return json.loads(resp.read().decode())


def http_bytes(url, timeout=120):
    with urllib.request.urlopen(url, timeout=timeout) as resp:
        return resp.read()


def discover_checkpoint(base):
    info = http_json(f"{base}/object_info/CheckpointLoaderSimple")
    names = info["CheckpointLoaderSimple"]["input"]["required"]["ckpt_name"][0]
    if not names:
        raise RuntimeError("ComfyUI has no checkpoint installed in models/checkpoints")
    return names[0]


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--url", default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"))
    p.add_argument("--prompt", required=True)
    p.add_argument("--negative", default="blurry, low quality, watermark, text")
    p.add_argument("--out", required=True)
    p.add_argument("--width", type=int, default=512)
    p.add_argument("--height", type=int, default=512)
    p.add_argument("--steps", type=int, default=25)
    p.add_argument("--cfg", type=float, default=7.0)
    p.add_argument("--seed", type=int, default=-1)
    p.add_argument("--checkpoint", default="")
    p.add_argument("--sampler", default="euler")
    p.add_argument("--scheduler", default="normal")
    p.add_argument("--timeout", type=int, default=600)
    args = p.parse_args()

    resolved = resolve_output(args.out)
    if resolved is None:
        return 2
    args.out = str(resolved)

    base = args.url.rstrip("/")

    try:
        http_json(f"{base}/system_stats", timeout=10)
    except (urllib.error.URLError, OSError) as exc:
        print(f"error: ComfyUI not reachable at {base} ({exc}). "
              f"Start it and set COMFYUI_URL. See .agents/tools/media/README.md.", file=sys.stderr)
        return 3

    try:
        checkpoint = args.checkpoint or discover_checkpoint(base)
    except Exception as exc:  # noqa: BLE001 - surface any discovery failure
        print(f"error: could not determine checkpoint: {exc}", file=sys.stderr)
        return 3

    seed = args.seed if args.seed >= 0 else int(time.time()) % (2 ** 31)

    with open(TEMPLATE, "r", encoding="utf-8") as fh:
        template = fh.read()

    # The template already wraps string placeholders in quotes, so insert the
    # escaped string content without its surrounding quotes.
    def esc(value):
        return json.dumps(str(value))[1:-1]

    replacements = {
        "__CKPT__": esc(checkpoint),
        "__PROMPT__": esc(args.prompt),
        "__NEGATIVE__": esc(args.negative),
        "__WIDTH__": str(args.width),
        "__HEIGHT__": str(args.height),
        "__STEPS__": str(args.steps),
        "__CFG__": str(args.cfg),
        "__SEED__": str(seed),
        "__SAMPLER__": esc(args.sampler),
        "__SCHEDULER__": esc(args.scheduler),
    }
    for key, value in replacements.items():
        template = template.replace(key, value)
    workflow = json.loads(template)

    client_id = str(uuid.uuid4())
    try:
        queued = http_json(f"{base}/prompt", {"prompt": workflow, "client_id": client_id})
    except urllib.error.HTTPError as exc:
        print(f"error: ComfyUI rejected the workflow: {exc.read().decode(errors='replace')}", file=sys.stderr)
        return 4

    prompt_id = queued["prompt_id"]
    deadline = time.time() + args.timeout
    images = []
    while time.time() < deadline:
        history = http_json(f"{base}/history/{prompt_id}")
        entry = history.get(prompt_id)
        if entry:
            outputs = entry.get("outputs", {})
            for node in outputs.values():
                images.extend(node.get("images", []))
            if images:
                break
            if entry.get("status", {}).get("status_str") == "error":
                print("error: ComfyUI reported a generation error", file=sys.stderr)
                return 4
        time.sleep(1)
    else:
        print("error: timed out waiting for ComfyUI", file=sys.stderr)
        return 4

    if not images:
        print("error: ComfyUI returned no images", file=sys.stderr)
        return 4

    img = images[0]
    query = urllib.parse.urlencode({
        "filename": img["filename"],
        "subfolder": img.get("subfolder", ""),
        "type": img.get("type", "output"),
    })
    data = http_bytes(f"{base}/view?{query}")
    with open(args.out, "wb") as fh:
        fh.write(data)

    print(f"ok image-generate {args.out} model={checkpoint} seed={seed} {args.width}x{args.height}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
