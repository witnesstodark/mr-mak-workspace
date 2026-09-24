#!/usr/bin/env python3
"""Gera imagem com o Z-Image Turbo (GGUF) atraves do ComfyUI.

Diferente do comfyui_client.py (SD-Turbo, template com placeholders), este usa o
workflow API montado para o Z-Image: nó GGUF, encoder Qwen3 (tipo `lumina2`) e
ModelSamplingAuraFlow.

Exit codes: 0 sucesso, 2 uso errado, 3 ComfyUI inacessivel, 4 geracao falhou.
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

DEFAULT_WORKFLOW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfyui", "zimage_txt2img.api.json")


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


def http_json(url, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def http_bytes(url, timeout=300):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def by_class(workflow, class_type):
    return [nid for nid, node in workflow.items() if node.get("class_type") == class_type]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"))
    parser.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    parser.add_argument("--prompt", required=True)
    parser.add_argument("--negative", default="blurry, ugly, low quality, watermark, text")
    parser.add_argument("--out", required=True)
    parser.add_argument("--width", type=int, default=768)
    parser.add_argument("--height", type=int, default=768)
    parser.add_argument("--steps", type=int, default=9)
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--timeout", type=int, default=900)
    args = parser.parse_args()

    resolved = resolve_output(args.out)
    if resolved is None:
        return 2
    args.out = str(resolved)

    base = args.url.rstrip("/")
    try:
        http_json(f"{base}/system_stats", timeout=10)
    except (urllib.error.URLError, OSError) as exc:
        print(f"erro: ComfyUI inacessivel em {base} ({exc})", file=sys.stderr)
        return 3

    workflow = json.load(open(args.workflow, encoding="utf-8"))

    encoders = sorted(by_class(workflow, "CLIPTextEncode"), key=int)
    if len(encoders) < 2:
        print("erro: workflow sem os dois CLIPTextEncode esperados", file=sys.stderr)
        return 2
    workflow[encoders[0]]["inputs"]["text"] = args.prompt
    workflow[encoders[1]]["inputs"]["text"] = args.negative

    for nid in by_class(workflow, "EmptyLatentImage"):
        workflow[nid]["inputs"]["width"] = args.width
        workflow[nid]["inputs"]["height"] = args.height

    seed = args.seed if args.seed >= 0 else int(time.time()) % (2 ** 31)
    for nid in by_class(workflow, "KSampler"):
        workflow[nid]["inputs"]["seed"] = seed
        workflow[nid]["inputs"]["steps"] = args.steps

    try:
        queued = http_json(f"{base}/prompt", {"prompt": workflow, "client_id": "ashenhold-zimage"}, timeout=120)
    except urllib.error.HTTPError as exc:
        print(f"erro: workflow rejeitado: {exc.read().decode(errors='replace')[:600]}", file=sys.stderr)
        return 4

    if queued.get("node_errors"):
        print(f"erro: {json.dumps(queued['node_errors'])[:600]}", file=sys.stderr)
        return 4

    prompt_id = queued["prompt_id"]
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        entry = http_json(f"{base}/history/{prompt_id}").get(prompt_id)
        if entry:
            for message in entry.get("status", {}).get("messages", []):
                if message[0] == "execution_error":
                    info = message[1]
                    print(f"erro: {info.get('node_type')} falhou: {str(info.get('exception_message'))[:300]}",
                          file=sys.stderr)
                    return 4
            for node_output in (entry.get("outputs") or {}).values():
                for image in node_output.get("images", []):
                    query = urllib.parse.urlencode({
                        "filename": image["filename"],
                        "subfolder": image.get("subfolder", ""),
                        "type": image.get("type", "output"),
                    })
                    data = http_bytes(f"{base}/view?{query}")
                    with open(args.out, "wb") as handle:
                        handle.write(data)
                    print(f"ok zimage-generate {args.out} {args.width}x{args.height} steps={args.steps} seed={seed}")
                    return 0
        time.sleep(3)

    print("erro: timeout esperando a imagem", file=sys.stderr)
    return 4


if __name__ == "__main__":
    sys.exit(main())
