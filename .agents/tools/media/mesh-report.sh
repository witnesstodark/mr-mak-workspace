#!/usr/bin/env bash
# Relatorio de uma malha gerada: triangulos, dimensoes, ilhas conectadas e,
# opcionalmente, um render de conferencia.
#
# Uso:
#   mesh-report.sh --in Artifacts/Media/asset.fbx [--render Artifacts/Media/asset.png]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd blender

in=""; render=""
while [ $# -gt 0 ]; do
  case "$1" in
    --in) in="$2"; shift 2 ;;
    --render) render="$2"; shift 2 ;;
    *) die "argumento desconhecido: $1" ;;
  esac
done

[ -n "$in" ] || die "--in e obrigatorio"
require_file "$in"
[ -z "$render" ] || render="$(resolve_output "$render")"

args=(--in "$in")
[ -n "$render" ] && args+=(--render "$render")

log="$(blender -b --factory-startup --python "$(dirname "${BASH_SOURCE[0]}")/blender_mesh_report.py" \
  -- "${args[@]}" 2>&1 || true)"

printf '%s\n' "$log" | grep -E "^relatorio:" || {
  printf '%s\n' "$log" | tail -15 >&2
  die "o Blender nao produziu o relatorio"
}
