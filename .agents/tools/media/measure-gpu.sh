#!/usr/bin/env bash
# Run a GPU workload and report wall time and peak VRAM.
# The 6 GB card is the binding constraint, so every generation is measured.
# Usage: measure-gpu.sh --label "image generate" -- <command...>
set -euo pipefail

label=""
while [ $# -gt 0 ]; do
  case "$1" in
    --label) label="$2"; shift 2 ;;
    --) shift; break ;;
    *) break ;;
  esac
done

[ -n "$label" ] || label="run"
[ $# -gt 0 ] || { echo "error: no command given (use -- <command>)" >&2; exit 2; }
command -v nvidia-smi >/dev/null 2>&1 || { echo "error: nvidia-smi not available" >&2; exit 2; }

samples="$(mktemp "${TMPDIR:-/tmp}/gpu-samples.XXXXXX")"
trap 'rm -f "$samples"' EXIT

while :; do
  nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits >> "$samples" 2>/dev/null || true
  sleep 0.5
done &
sampler=$!

start="$(date +%s.%N)"
status=0
"$@" || status=$?
end="$(date +%s.%N)"

kill "$sampler" 2>/dev/null || true
wait "$sampler" 2>/dev/null || true
nvidia-smi --query-gpu=memory.used --format=csv,noheader,nounits >> "$samples" 2>/dev/null || true

peak="$(sort -n "$samples" | tail -1)"
dur="$(awk -v a="$start" -v b="$end" 'BEGIN{printf "%.1f", b-a}')"
printf 'measure label="%s" duration=%ss peak_vram=%sMiB exit=%d\n' "$label" "$dur" "${peak:-0}" "$status"
exit "$status"
