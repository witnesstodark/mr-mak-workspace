#!/usr/bin/env bash
# Deterministic image effects applied in sequence, one pass per effect.
# Effects:
#   border:WIDTH:COLOR      add a solid border
#   pad:WIDTH:COLOR         alias of border (use a transparent color to pad)
#   shadow:SIGMA:COLOR      drop shadow, offset 0,0
#   outline:WIDTH:COLOR     dilate the alpha and fill it with COLOR
#   tint:COLOR:AMOUNT       colorize, AMOUNT 0-100
#   saturate:AMOUNT         modulate saturation, AMOUNT 0-200
#   grayscale               convert to grayscale
#   flip | flop             vertical | horizontal mirror
# Usage:
#   image-edit.sh --in FILE --out FILE --effect border:4:#101018 [--effect ...]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd convert

in=""; out=""; effects=()
while [ $# -gt 0 ]; do
  case "$1" in
    --in) in="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --effect) effects+=("$2"); shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$in" ] || die "--in is required"
[ -n "$out" ] || die "--out is required"
[ "${#effects[@]}" -gt 0 ] || die "at least one --effect is required"
require_file "$in"
out="$(resolve_output "$out")"

tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ashenhold-media.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
current="$in"
step=0

for effect in "${effects[@]}"; do
  step=$((step + 1))
  next="$tmpdir/step-$step.png"
  IFS=: read -r op a b <<<"$effect"
  case "$op" in
    border|pad)
      [ -n "${a:-}" ] && [ -n "${b:-}" ] || die "effect '$effect' needs WIDTH:COLOR"
      convert "$current" -bordercolor "$b" -border "$a" "$next" ;;
    shadow)
      [ -n "${a:-}" ] && [ -n "${b:-}" ] || die "effect '$effect' needs SIGMA:COLOR"
      convert "$current" \( +clone -background "$b" -shadow "60x$a+0+0" \) \
        +swap -background none -layers merge +repage "$next" ;;
    outline)
      [ -n "${a:-}" ] && [ -n "${b:-}" ] || die "effect '$effect' needs WIDTH:COLOR"
      convert "$current" -alpha set -channel A -morphology Dilate Disk:"$a" +channel \
        -background "$b" -alpha shape "$next" ;;
    tint)
      [ -n "${a:-}" ] && [ -n "${b:-}" ] || die "effect '$effect' needs COLOR:AMOUNT"
      convert "$current" -fill "$a" -colorize "$b" "$next" ;;
    saturate)
      [ -n "${a:-}" ] || die "effect '$effect' needs AMOUNT"
      convert "$current" -modulate "100,$a,100" "$next" ;;
    grayscale)
      convert "$current" -colorspace Gray "$next" ;;
    flip)
      convert "$current" -flip "$next" ;;
    flop)
      convert "$current" -flop "$next" ;;
    *) die "unknown effect op: $op" ;;
  esac
  current="$next"
done

cp "$current" "$out"
report "ok image-edit $out effects=${#effects[@]}"
