#!/usr/bin/env bash
# Text (or image) to a textured 3D mesh, locally.
#
# Runs the whole chain against a local ComfyUI: optional concept image with
# SD-Turbo, then Pixal3D image-to-mesh, then an optional Unity-ready FBX.
#
# Usage:
#   mesh-generate.sh --prompt "isometric arcane tower, single connected object" --out a.glb
#   mesh-generate.sh --image concept.png --out a.glb --fbx Assets/Art/Towers/ArcaneSpire.fbx
#   mesh-generate.sh --prompt "..." --out a.glb --tris 5000 --seed 42
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd curl
require_cmd python3

PROMPT_URL="${COMFYUI_URL:-http://127.0.0.1:8188}"
HERE="$(dirname "${BASH_SOURCE[0]}")"

image=""; prompt=""; out=""; fbx=""; tris="15000"; seed="-1"
concept_model="sdturbo"; backbone="pixal3d"; steps=""; width=""; height=""
while [ $# -gt 0 ]; do
  case "$1" in
    --image) image="$2"; shift 2 ;;
    --prompt) prompt="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --fbx) fbx="$2"; shift 2 ;;
    --tris) tris="$2"; shift 2 ;;
    --seed) seed="$2"; shift 2 ;;
    --concept-model) concept_model="$2"; shift 2 ;;
    --backbone) backbone="$2"; shift 2 ;;
    --steps) steps="$2"; shift 2 ;;
    --width) width="$2"; shift 2 ;;
    --height) height="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

# Cada backbone tem um vicio proprio:
#   pixal3d  — fiel a imagem, mas gera no espaco da camera e herda a inclinacao
#              do conceito (33 graus medidos a partir de um conceito isometrico)
#   trellis2 — espaco canonico, sai em pe (0,3 graus medidos), menos preso a imagem
case "$backbone" in
  pixal3d)  mesh_workflow="$HERE/comfyui/pixal3d_img2mesh.api.json" ;;
  trellis2) mesh_workflow="$HERE/comfyui/trellis2_img2mesh.api.json" ;;
  *) die "--backbone deve ser pixal3d ou trellis2" ;;
esac

[ -n "$out" ] || die "--out is required"
[ -n "$image" ] || [ -n "$prompt" ] || die "give --image or --prompt"
case "$tris" in ''|*[!0-9]*) die "--tris must be an integer" ;; esac

curl -sf "$PROMPT_URL/system_stats" >/dev/null 2>&1 || die "ComfyUI not reachable at $PROMPT_URL"

concept="$image"
if [ -z "$concept" ]; then
  # Defaults por modelo: o SD-Turbo e destilado (4 passos, 512), o Z-Image pede
  # 9 passos em 768+.
  case "$concept_model" in
    zimage) : "${width:=768}"; : "${height:=768}"; : "${steps:=9}" ;;
    *)      : "${width:=512}"; : "${height:=512}"; : "${steps:=4}" ;;
  esac
  slug="$(printf '%s' "$prompt" | tr 'A-Z' 'a-z' | tr -cs 'a-z0-9' '-' | cut -c1-40 | sed 's/-$//')"
  concept="Artifacts/Media/concept-${slug:-asset}.png"
  echo "generating concept image with $concept_model (${width}x${height}, $steps steps)"
  if [ "$concept_model" = "zimage" ]; then
    python3 "$HERE/comfyui_zimage_client.py" --prompt "$prompt" --out "$concept" \
      --width "$width" --height "$height" --steps "$steps" --seed "$seed"
  else
    python3 "$HERE/comfyui_client.py" --prompt "$prompt" --out "$concept" \
      --width "$width" --height "$height" --steps "$steps" --cfg 1.0 --sampler euler --scheduler normal
  fi
fi
require_file "$concept"

echo "uploading concept to ComfyUI"
upload_json="$(curl -s -F "image=@${concept};type=application/octet-stream" -F "overwrite=true" -F "type=input" "$PROMPT_URL/upload/image")"
ref="$(printf '%s' "$upload_json" | python3 -c "
import sys, json
d = json.load(sys.stdin)
print((d.get('subfolder', '') + '/' + d['name']).lstrip('/'))
")"
[ -n "$ref" ] || die "upload failed: $upload_json"

out="$(resolve_output "$out")"
echo "generating mesh (target ${tris} tris)"
python3 "$HERE/comfyui_mesh_client.py" --url "$PROMPT_URL" --workflow "$mesh_workflow" --image "$ref" --out "$out" --tris "$tris" --seed "$seed"

if [ -n "$fbx" ]; then
  echo "converting for Unity"
  "$HERE/mesh-to-unity.sh" --in "$out" --out "$fbx"
fi

report "ok mesh-generate glb=$out fbx=${fbx:-none} tris_target=$tris"
