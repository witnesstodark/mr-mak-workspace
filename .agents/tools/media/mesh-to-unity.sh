#!/usr/bin/env bash
# Convert a generated GLB mesh into an FBX that Unity can import.
# Unity does not import GLB, so every generated mesh passes through here.
# Usage:
#   mesh-to-unity.sh --in FILE.glb --out FILE.fbx [--scale F] [--no-textures]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd blender

in=""; out=""; scale="1.0"; textures=1
while [ $# -gt 0 ]; do
  case "$1" in
    --in) in="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --scale) scale="$2"; shift 2 ;;
    --no-textures) textures=0; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$in" ] || die "--in is required"
[ -n "$out" ] || die "--out is required"
require_file "$in"
out="$(resolve_output "$out")"

args=(--in "$in" --out "$out" --scale "$scale")
[ "$textures" = 0 ] && args+=(--no-textures)

# Blender writes through its own process; keep this in the foreground.
log="$(blender -b --factory-startup --python "$(dirname "${BASH_SOURCE[0]}")/blender_glb_to_fbx.py" \
  -- "${args[@]}" 2>&1 || true)"

[ -f "$out" ] || { printf '%s\n' "$log" | tail -20 >&2; die "Blender did not produce $out"; }

stats="$(printf '%s\n' "$log" | grep -E '^mesh-stats' || true)"
report "ok mesh-to-unity $out size=$(stat -c%s "$out")B ${stats}"
