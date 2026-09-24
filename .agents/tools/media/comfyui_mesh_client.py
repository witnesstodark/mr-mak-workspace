#!/usr/bin/env python3
"""Run the stored Pixal3D API graph on ComfyUI and download the resulting GLB.

The graph is the official workflow converted to API format and tuned for 6 GB
(low-VRAM resolution, smaller remesh, smaller atlas, game-ready decimate).

Exit codes: 0 success, 2 usage error, 3 ComfyUI unreachable, 4 generation failed.
"""
import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

DEFAULT_WORKFLOW = os.path.join(os.path.dirname(os.path.abspath(__file__)), "comfyui", "pixal3d_img2mesh.api.json")


def http_json(url, payload=None, timeout=60):
    data = json.dumps(payload).encode() if payload is not None else None
    headers = {"Content-Type": "application/json"} if data else {}
    request = urllib.request.Request(url, data=data, headers=headers)
    with urllib.request.urlopen(request, timeout=timeout) as response:
        return json.loads(response.read().decode())


def http_bytes(url, timeout=300):
    with urllib.request.urlopen(url, timeout=timeout) as response:
        return response.read()


def nodes_of(prompt, class_type):
    return [nid for nid, node in prompt.items() if node["class_type"] == class_type]


def first_node(prompt, class_type):
    found = nodes_of(prompt, class_type)
    return found[0] if found else None


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--url", default=os.environ.get("COMFYUI_URL", "http://127.0.0.1:8188"))
    parser.add_argument("--workflow", default=DEFAULT_WORKFLOW)
    parser.add_argument("--image", required=True, help="image name already uploaded to ComfyUI")
    parser.add_argument("--out", required=True, help="destination .glb path")
    parser.add_argument("--tris", type=int, default=15000, help="decimate target face count")
    parser.add_argument("--seed", type=int, default=-1)
    parser.add_argument("--timeout", type=int, default=1800)
    args = parser.parse_args()

    base = args.url.rstrip("/")

    try:
        http_json(f"{base}/system_stats", timeout=10)
    except (urllib.error.URLError, OSError) as exc:
        print(f"error: ComfyUI not reachable at {base} ({exc})", file=sys.stderr)
        return 3

    with open(args.workflow, "r", encoding="utf-8") as handle:
        prompt = json.load(handle)

    loader = first_node(prompt, "LoadImage")
    if loader is None:
        print("error: workflow has no LoadImage node", file=sys.stderr)
        return 2
    prompt[loader]["inputs"]["image"] = args.image

    decimate = first_node(prompt, "DecimateMesh")
    if decimate is not None:
        prompt[decimate]["inputs"]["target_face_count"] = args.tris

    if args.seed >= 0:
        for nid in nodes_of(prompt, "KSampler"):
            prompt[nid]["inputs"]["seed"] = args.seed

    try:
        queued = http_json(f"{base}/prompt", {"prompt": prompt, "client_id": "ashenhold-mesh"}, timeout=120)
    except urllib.error.HTTPError as exc:
        print(f"error: ComfyUI rejected the workflow: {exc.read().decode(errors='replace')[:800]}", file=sys.stderr)
        return 4

    errors = queued.get("node_errors") or {}
    if errors:
        print(f"error: node errors on submit: {json.dumps(errors)[:800]}", file=sys.stderr)
        return 4

    prompt_id = queued["prompt_id"]
    deadline = time.time() + args.timeout
    while time.time() < deadline:
        entry = http_json(f"{base}/history/{prompt_id}").get(prompt_id)
        if entry:
            status = entry.get("status", {})
            for message in status.get("messages", []):
                if message[0] == "execution_error":
                    info = message[1]
                    print(f"error: {info.get('node_type')} failed: {str(info.get('exception_message'))[:400]}",
                          file=sys.stderr)
                    return 4
            outputs = entry.get("outputs") or {}
            for node_output in outputs.values():
                for item in node_output.get("3d") or []:
                    query = urllib.parse.urlencode({
                        "filename": item["filename"],
                        "subfolder": item.get("subfolder", ""),
                        "type": item.get("type", "output"),
                    })
                    data = http_bytes(f"{base}/view?{query}")
                    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
                    with open(args.out, "wb") as handle:
                        handle.write(data)
                    print(f"ok mesh-generate {args.out} bytes={len(data)} tris_target={args.tris} prompt_id={prompt_id}")
                    return 0
        time.sleep(4)

    print("error: timed out waiting for the mesh", file=sys.stderr)
    return 4


if __name__ == "__main__":
    sys.exit(main())
