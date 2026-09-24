#!/usr/bin/env bash
# Compact progress report for a long-running media job.
# Reads a log that may contain curl progress bars, and reports the stage, the
# last percentage, and the bytes already on disk.
#
# Usage:
#   progress.sh --log FILE [--pid PATTERN] [--dir DIR] [--name LABEL]
set -euo pipefail

log=""; pid_pattern=""; dir=""; name="job"
while [ $# -gt 0 ]; do
  case "$1" in
    --log) log="$2"; shift 2 ;;
    --pid) pid_pattern="$2"; shift 2 ;;
    --dir) dir="$2"; shift 2 ;;
    --name) name="$2"; shift 2 ;;
    *) echo "error: unknown argument: $1" >&2; exit 2 ;;
  esac
done

[ -n "$log" ] || { echo "error: --log is required" >&2; exit 2; }
[ -f "$log" ] || { echo "error: log not found: $log" >&2; exit 2; }

# Bound the read: progress logs grow fast.
recent="$(tail -c 200000 "$log" 2>/dev/null | tr '\r' '\n')"

if [ -n "$pid_pattern" ]; then
  if pgrep -f "$pid_pattern" >/dev/null 2>&1; then
    state="running (pid $(pgrep -f "$pid_pattern" | head -1))"
  else
    state="stopped"
  fi
else
  state="unknown"
fi

stage="$(printf '%s\n' "$recent" | grep -E '^(get|have) ' | tail -1 | sed 's/^[a-z]* *//')"
pct="$(printf '%s\n' "$recent" | grep -oE '[0-9]+\.[0-9]%' | tail -1)"

done_bytes=0; done_count=0
partial_bytes=0; partial_count=0
if [ -n "$dir" ] && [ -d "$dir" ]; then
  while IFS= read -r -d '' f; do
    size=$(stat -c%s "$f")
    case "$f" in
      *.part) partial_bytes=$((partial_bytes + size)); partial_count=$((partial_count + 1)) ;;
      *) done_bytes=$((done_bytes + size)); done_count=$((done_count + 1)) ;;
    esac
  done < <(find "$dir" -type f \( -name '*.safetensors' -o -name '*.gguf' -o -name '*.part' \) -print0 2>/dev/null)
fi

to_gib() { awk -v b="$1" 'BEGIN{printf "%.2f GiB", b/1073741824}'; }

printf '%s\n' \
  "job      : $name" \
  "state    : $state" \
  "stage    : ${stage:-(none logged yet)}" \
  "progress : ${pct:-(no percentage logged)}" \
  "complete : $done_count file(s), $(to_gib "$done_bytes")" \
  "partial  : $partial_count file(s), $(to_gib "$partial_bytes")"
