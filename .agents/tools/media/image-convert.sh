#!/usr/bin/env bash
# Deterministic image conversion: resize, fit, format, alpha trim, palette reduction.
# Usage:
#   image-convert.sh --in FILE --out FILE [--width N] [--height N]
#                    [--fit contain|cover|stretch] [--format png|jpg|webp]
#                    [--quality 1-100] [--max-colors N] [--trim-alpha]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd convert
require_cmd identify

in=""; out=""; width=""; height=""; fit="contain"; format=""; quality=""; colors=""; trim=0
while [ $# -gt 0 ]; do
  case "$1" in
    --in) in="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --width) width="$2"; shift 2 ;;
    --height) height="$2"; shift 2 ;;
    --fit) fit="$2"; shift 2 ;;
    --format) format="$2"; shift 2 ;;
    --quality) quality="$2"; shift 2 ;;
    --max-colors) colors="$2"; shift 2 ;;
    --trim-alpha) trim=1; shift ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$in" ] || die "--in is required"
[ -n "$out" ] || die "--out is required"
case "$fit" in contain|cover|stretch) : ;; *) die "--fit must be contain, cover, or stretch" ;; esac
case "$format" in ""|png|jpg|jpeg|webp) : ;; *) die "--format must be png, jpg, or webp" ;; esac
[ -z "$quality" ] || { [ "$quality" -ge 1 ] 2>/dev/null && [ "$quality" -le 100 ] || die "--quality must be 1-100"; }
[ -z "$colors" ] || { [ "$colors" -ge 2 ] 2>/dev/null || die "--max-colors must be >= 2"; }

require_file "$in"
out="$(resolve_output "$out")"

args=("$in")
if [ "$trim" = 1 ]; then args+=(-trim +repage); fi

if [ -n "$width" ] || [ -n "$height" ]; then
  case "$fit" in
    stretch) args+=(-resize "${width:-}"x"${height:-}"!) ;;
    cover)   args+=(-resize "${width:-}"x"${height:-}"^ -gravity center -extent "${width:-}"x"${height:-}") ;;
    contain) args+=(-resize "${width:-}"x"${height:-}") ;;
  esac
fi

if [ -n "$colors" ]; then args+=(-colors "$colors"); fi
if [ -n "$quality" ]; then args+=(-quality "$quality"); fi

if [ -n "$format" ]; then
  args+=("${format^^}:$out")
else
  args+=("$out")
fi

convert "${args[@]}"
info="$(identify -format '%wx%h %[channels] %b' "$out")"
report "ok image-convert $out $info"
