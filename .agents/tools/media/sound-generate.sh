#!/usr/bin/env bash
# Procedural sound synthesis with SoX, then optional loudness normalization with FFmpeg.
# Types: tone | sweep | noise | impact | chime | blip
# Usage:
#   sound-generate.sh --out FILE --type TYPE --duration SEC
#                     [--freq HZ] [--freq2 HZ] [--waveform sine|square|sawtooth|triangle]
#                     [--decay SEC] [--volume 0-1] [--noise white|pink|brown]
#                     [--lowpass HZ] [--normalize] [--sample-rate HZ]
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"
require_cmd sox

out=""; type=""; duration=""; freq="440"; freq2=""; wave="sine"; decay=""; volume="0.8"
noise="pink"; lowpass=""; normalize=0; rate="44100"
while [ $# -gt 0 ]; do
  case "$1" in
    --out) out="$2"; shift 2 ;;
    --type) type="$2"; shift 2 ;;
    --duration) duration="$2"; shift 2 ;;
    --freq) freq="$2"; shift 2 ;;
    --freq2) freq2="$2"; shift 2 ;;
    --waveform) wave="$2"; shift 2 ;;
    --decay) decay="$2"; shift 2 ;;
    --volume) volume="$2"; shift 2 ;;
    --noise) noise="$2"; shift 2 ;;
    --lowpass) lowpass="$2"; shift 2 ;;
    --normalize) normalize=1; shift ;;
    --sample-rate) rate="$2"; shift 2 ;;
    *) die "unknown argument: $1" ;;
  esac
done

[ -n "$out" ] || die "--out is required"
[ -n "$type" ] || die "--type is required"
[ -n "$duration" ] || die "--duration is required"
case "$type" in tone|sweep|noise|impact|chime|blip) : ;; *) die "unknown --type: $type" ;; esac

out="$(resolve_output "$out")"
tmpdir="$(mktemp -d "${TMPDIR:-/tmp}/ashenhold-sound.XXXXXX")"
trap 'rm -rf "$tmpdir"' EXIT
raw="$tmpdir/raw.wav"

# Attack and decay envelope.
# $1 duration, $2 decay time (defaults to the full length).
# sox "fade" truncates the audio at its stop-position, so a fade-out is built
# with the reverse idiom instead: reverse, fade in, reverse.
fade_expr() {
  local d="$1" dec="${2:-$1}"
  [ -n "$dec" ] || dec="$d"
  local attack out
  attack="$(awk -v d="$d" 'BEGIN{a=0.005; if(a>d/4) a=d/4; if(a<0) a=0; printf "%.6f", a}')"
  out="$(awk -v d="$d" -v x="$dec" 'BEGIN{o=x; if(o>d) o=d; if(o<0) o=0; printf "%.6f", o}')"
  echo "fade $attack reverse fade $out reverse"
}

case "$type" in
  tone)
    sox -n -r "$rate" "$raw" synth "$duration" "$wave" "$freq" $(fade_expr "$duration" "$decay") vol "$volume"
    ;;
  sweep)
    [ -n "$freq2" ] || die "--freq2 is required for sweep"
    sox -n -r "$rate" "$raw" synth "$duration" sine "${freq}-${freq2}" $(fade_expr "$duration" "") vol "$volume"
    ;;
  noise)
    sox -n -r "$rate" "$raw" synth "$duration" "${noise}noise" $(fade_expr "$duration" "$decay") vol "$volume"
    ;;
  impact)
    sox -n -r "$rate" "$raw" synth "$duration" brownnoise $(fade_expr "$duration" "${decay:-0.15}") vol "$volume"
    ;;
  blip)
    sox -n -r "$rate" "$raw" synth "$duration" square "$freq" $(fade_expr "$duration" "0.03") vol "$(awk -v v="$volume" 'BEGIN{print v*0.6}')"
    ;;
  chime)
    a="$tmpdir/a.wav"; b="$tmpdir/b.wav"; c="$tmpdir/c.wav"
    sox -n -r "$rate" "$a" synth "$duration" sine "$freq" $(fade_expr "$duration" "$decay") vol "$volume"
    sox -n -r "$rate" "$b" synth "$duration" sine "$(awk -v f="$freq" 'BEGIN{print f*2}')" $(fade_expr "$duration" "$decay") vol "$(awk -v v="$volume" 'BEGIN{print v*0.4}')"
    sox -n -r "$rate" "$c" synth "$duration" sine "$(awk -v f="$freq" 'BEGIN{print f*3}')" $(fade_expr "$duration" "$decay") vol "$(awk -v v="$volume" 'BEGIN{print v*0.2}')"
    sox -m "$a" "$b" "$c" "$raw"
    ;;
esac

if [ -n "$lowpass" ]; then
  sox "$raw" "$tmpdir/filtered.wav" lowpass "$lowpass"
  raw="$tmpdir/filtered.wav"
fi

if [ "$normalize" = 1 ]; then
  require_cmd ffmpeg
  ffmpeg -hide_banner -loglevel error -y -i "$raw" -af loudnorm=I=-16:TP=-1.5:LRA=11 -ar "$rate" "$tmpdir/norm.wav"
  raw="$tmpdir/norm.wav"
fi

case "${out##*.}" in
  ogg) require_cmd ffmpeg; ffmpeg -hide_banner -loglevel error -y -i "$raw" -c:a libvorbis -q:a 5 "$out" ;;
  mp3) require_cmd ffmpeg; ffmpeg -hide_banner -loglevel error -y -i "$raw" -c:a libmp3lame -q:a 4 "$out" ;;
  wav) cp "$raw" "$out" ;;
  *)   cp "$raw" "$out" ;;
esac

dur="$(sox --i -D "$out" 2>/dev/null || echo '?')"
report "ok sound-generate $out type=$type duration=${dur}s"
