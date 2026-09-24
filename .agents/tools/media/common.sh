#!/usr/bin/env bash
# Shared helpers for the Ashenhold TD media scripts.
# Wraps ImageMagick, FFmpeg, SoX, Inkscape, and Blender. No bundled third-party asset.
set -euo pipefail

PROJECT_ROOT="${MEDIA_PROJECT_ROOT:-$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)}"
WORK_DIR="${MEDIA_WORK_DIR:-$PROJECT_ROOT/Artifacts/Media}"

die() { echo "error: $*" >&2; exit 1; }

require_cmd() {
  command -v "$1" >/dev/null 2>&1 || die "required command not found: $1"
}

require_file() {
  [ -f "$1" ] || die "input file not found: $1"
}

# Resolve an output path and refuse to write outside the allowed roots.
# Allowed: <project>/Assets/, <project>/Artifacts/, /tmp/opencode/.
resolve_output() {
  local p="$1" abs
  abs="$(realpath -m "$p")"
  case "$abs" in
    "$PROJECT_ROOT"/Assets/*|"$PROJECT_ROOT"/Artifacts/*|/tmp/opencode/*) : ;;
    *) die "output must be inside Assets/, Artifacts/, or /tmp/opencode/ (got: $p)" ;;
  esac
  mkdir -p "$(dirname "$abs")"
  printf '%s' "$abs"
}

# Print a compact machine-readable summary line.
report() { printf '%s\n' "$*"; }
