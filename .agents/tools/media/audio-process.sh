#!/usr/bin/env bash
# Deterministic audio processing and encoding with FFmpeg.
# Usage:
#   audio-process.sh --in FILE --out FILE [--start SEC] [--duration SEC]
#                    [--normalize] [--target-lufs DB] [--gain DB]
#                    [--fade-in SEC] [--fade-out SEC] [--loop N]
#                    [--sample-rate HZ] [--channels N]
#                    [--format ogg|wav|mp3|flac] [--quality 1-10]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd ffmpeg
require_cmd ffprobe

in=""; out=""; start=""; duration=""; normalize=0; lufs="-16"; gain=""
fade_in=""; fade_out=""; loop="1"; rate=""; channels=""; format=""; quality=""
while [ $# -gt 0 ]; do
  case "$1" in
    --in) in="$2"; shift 2 ;;
    --out) out="$2"; shift 2 ;;
    --start) start="$2"; shift 2 ;;
    --duration) duration="$2"; shift 2 ;;
    --normalize) normalize=1; shift ;;
    --target-lufs) lufs="$2"; shift 2 ;;
    --gain) gain="$2"; shift 2 ;;
    --fade-in) fade_in="$2"; shift 2 ;;
    --fade-out) fade_out="$2"; shift 2 ;;
    --loop) loop="$2"; shift 2 ;;
    --sample-rate) rate="$2"; shift 2 ;;
    --channels) channels="$2"; shift 2 ;;
    --format) format="$2"; shift 2 ;;
    --quality) quality="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$in" ] || die "--in is required"
[ -n "$out" ] || die "--out is required"
require_file "$in"
out="$(resolve_output "$out")"
case "$loop" in ''|*[!0-9]*) die "--loop must be a positive integer" ;; esac
[ "$loop" -ge 1 ] || die "--loop must be >= 1"
case "$format" in ""|ogg|wav|mp3|flac) : ;; *) die "--format must be ogg, wav, mp3, or flac" ;; esac

# loudnorm internally resamples to 192 kHz; keep the source rate unless asked.
if [ "$normalize" = 1 ] && [ -z "$rate" ]; then
  rate="$(ffprobe -v error -select_streams a:0 -show_entries stream=sample_rate -of default=nw=1:nk=1 "$in" | head -1)"
  [ -n "$rate" ] || rate=44100
fi

filters=()
if [ "$normalize" = 1 ]; then filters+=("loudnorm=I=${lufs}:TP=-1.5:LRA=11"); fi
if [ -n "$gain" ]; then filters+=("volume=${gain}dB"); fi
if [ -n "$fade_in" ]; then filters+=("afade=t=in:st=0:d=${fade_in}"); fi
if [ -n "$fade_out" ]; then
  total="$duration"
  if [ -z "$total" ]; then
    total="$(ffprobe -v error -show_entries format=duration -of default=nw=1:nk=1 "$in")"
    total="$(awk -v d="$total" -v s="${start:-0}" 'BEGIN{print d-s}')"
  fi
  fo_start="$(awk -v t="$total" -v f="$fade_out" 'BEGIN{r=t-f; if(r<0)r=0; print r}')"
  filters+=("afade=t=out:st=${fo_start}:d=${fade_out}")
fi

# Infer the container from the extension when --format is omitted.
ext="${out##*.}"
fmt="${format:-$ext}"

args=(-hide_banner -loglevel error -y)
[ -n "$start" ] && args+=(-ss "$start")
if [ "$loop" -gt 1 ]; then args+=(-stream_loop "$((loop - 1))"); fi
args+=(-i "$in")
[ -n "$duration" ] && args+=(-t "$duration")
if [ "${#filters[@]}" -gt 0 ]; then
  joined="$(IFS=,; echo "${filters[*]}")"
  args+=(-af "$joined")
fi
[ -n "$rate" ] && args+=(-ar "$rate")
[ -n "$channels" ] && args+=(-ac "$channels")

case "$fmt" in
  ogg)  args+=(-c:a libvorbis -q:a "${quality:-5}") ;;
  mp3)  args+=(-c:a libmp3lame -q:a "${quality:-4}") ;;
  wav)  args+=(-c:a pcm_s16le) ;;
  flac) args+=(-c:a flac) ;;
  *)    die "unknown output format: $fmt (use --format)" ;;
esac
args+=("$out")

ffmpeg "${args[@]}"

probe="$(ffprobe -v error -show_entries format=duration -show_entries stream=channels,sample_rate \
  -of default=nw=1:nk=1 "$out" | paste -sd' ' -)"
report "ok audio-process $out format=$fmt $probe"
