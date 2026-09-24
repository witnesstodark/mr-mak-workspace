#!/usr/bin/env bash
# Controls the Ashenhold TD stack, picking the right Docker engine per service.
#
#   infra/docker/stack.sh up [service...]      start (default: all services)
#   infra/docker/stack.sh stop [service...]    stop
#   infra/docker/stack.sh restart [service...] stop + start
#   infra/docker/stack.sh ps                   list containers on both engines
#   infra/docker/stack.sh status               HTTP checks for ComfyUI, Kimodo and Portainer
#   infra/docker/stack.sh open SERVICE         start if needed and open its page
#   infra/docker/stack.sh logs SERVICE [n]     tail logs of one service
#
# Engine per service (Docker Desktop on Linux has no GPU passthrough):
#   comfyui, kimodo-demo     -> Docker Engine  (context "default")
#   gitlab-runner, portainer -> Docker Desktop (context "desktop-linux")
#
# A Compose file cannot choose its engine, so this script always passes the
# context explicitly instead of relying on whatever context is active.
set -euo pipefail

# The script lives in infra/docker/ and drives the stack from the repository
# root, where `.models-dir` and the compose files are resolved from.
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

COMPOSE_FILE="infra/docker/compose.yml"
ENGINE_SERVICES=(comfyui kimodo-demo)
DESKTOP_SERVICES=(gitlab-runner portainer)

log() { printf '%s\n' "$*"; }
die() { printf 'error: %s\n' "$*" >&2; exit 1; }

COMPOSE_FILES=(-f "$COMPOSE_FILE")

# Models on an external drive: .agents/tools/media/models-hd.sh writes .models-dir,
# and the override mounts that folder over /root/ComfyUI/models.
if [ -f .models-dir ]; then
  COMFYUI_MODELS_DIR="$(head -1 .models-dir)"
  if [ ! -d "$COMFYUI_MODELS_DIR" ] || ! mountpoint -q "$COMFYUI_MODELS_DIR"; then
    die "COMFYUI_MODELS_DIR=$COMFYUI_MODELS_DIR is not a mounted filesystem (drive offline?)"
  fi
  export COMFYUI_MODELS_DIR
  COMPOSE_FILES+=(-f infra/docker/compose.models-hd.yml)
fi

engine_compose() { docker --context default compose "${COMPOSE_FILES[@]}" "$@"; }
desktop_compose() { docker compose "${COMPOSE_FILES[@]}" "$@"; }

in_list() { local needle="$1"; shift; local item; for item in "$@"; do [ "$item" = "$needle" ] && return 0; done; return 1; }

split_services() {
  # Sets ENGINE_TARGETS and DESKTOP_TARGETS from the requested services.
  local requested=("$@")
  [ ${#requested[@]} -eq 0 ] && requested=("${ENGINE_SERVICES[@]}" "${DESKTOP_SERVICES[@]}")

  ENGINE_TARGETS=()
  DESKTOP_TARGETS=()
  local service
  for service in "${requested[@]}"; do
    if in_list "$service" "${ENGINE_SERVICES[@]}"; then
      ENGINE_TARGETS+=("$service")
    elif in_list "$service" "${DESKTOP_SERVICES[@]}"; then
      DESKTOP_TARGETS+=("$service")
    else
      die "unknown service: $service (engine: ${ENGINE_SERVICES[*]} | desktop: ${DESKTOP_SERVICES[*]})"
    fi
  done
}

run() {
  local action="$1"; shift
  split_services "$@"

  if [ ${#ENGINE_TARGETS[@]} -gt 0 ]; then
    log "[engine]  $action ${ENGINE_TARGETS[*]}"
    case "$action" in
      up)      engine_compose up -d "${ENGINE_TARGETS[@]}" ;;
      stop)    engine_compose stop "${ENGINE_TARGETS[@]}" ;;
      restart) engine_compose restart "${ENGINE_TARGETS[@]}" ;;
    esac
  fi

  if [ ${#DESKTOP_TARGETS[@]} -gt 0 ]; then
    log "[desktop] $action ${DESKTOP_TARGETS[*]}"
    case "$action" in
      up)      desktop_compose up -d "${DESKTOP_TARGETS[@]}" ;;
      stop)    desktop_compose stop "${DESKTOP_TARGETS[@]}" ;;
      restart) desktop_compose restart "${DESKTOP_TARGETS[@]}" ;;
    esac
  fi
}

cmd_ps() {
  log "== engine (default) =="
  docker --context default compose "${COMPOSE_FILES[@]}" ps
  log
  log "== desktop (desktop-linux) =="
  docker compose "${COMPOSE_FILES[@]}" ps
}

cmd_status() {
  local url status
  for url in "ComfyUI http://127.0.0.1:8188/system_stats" "Kimodo http://127.0.0.1:7860/" "Portainer http://127.0.0.1:9000/"; do
    set -- $url
    if curl -skf --max-time 4 -o /dev/null "$2" 2>/dev/null; then status="up"; else status="down"; fi
    printf '  %-9s %s (%s)\n' "$1" "$status" "$2"
  done
  printf '  %-9s %s\n' "Runner" "$(docker ps --filter name=ashenhold-td-gitlab-runner-1 --format '{{.Status}}' | head -1 || true)"
}

cmd_open() {
  local service="${1:-}"
  case "$service" in
    comfyui)
      run up comfyui
      wait_http "http://127.0.0.1:8188/system_stats" 60 || true
      xdg-open "http://127.0.0.1:8188" >/dev/null 2>&1 &
      log "abrindo http://127.0.0.1:8188"
      ;;
    kimodo-demo)
      run up kimodo-demo
      wait_http "http://127.0.0.1:7860/" 90 || true
      xdg-open "http://127.0.0.1:7860" >/dev/null 2>&1 &
      log "abrindo http://127.0.0.1:7860"
      ;;
    portainer)
      run up portainer
      wait_http "http://127.0.0.1:9000/" 30 || true
      xdg-open "http://127.0.0.1:9000" >/dev/null 2>&1 &
      log "abrindo http://127.0.0.1:9000"
      ;;
    *) die "open supports: comfyui, kimodo-demo, portainer" ;;
  esac
}

wait_http() {
  local url="$1" tries="${2:-45}" i
  for i in $(seq 1 "$tries"); do
    curl -skf --max-time 3 -o /dev/null "$url" 2>/dev/null && return 0
    sleep 2
  done
  log "warning: $url did not respond in time"
  return 1
}

cmd_logs() {
  local service="${1:-}"; local lines="${2:-30}"
  [ -n "$service" ] || die "usage: stack.sh logs SERVICE [n]"
  split_services "$service"
  if [ ${#ENGINE_TARGETS[@]} -gt 0 ]; then
    engine_compose logs --tail "$lines" --no-log-prefix "$service"
  else
    desktop_compose logs --tail "$lines" --no-log-prefix "$service"
  fi
}

case "${1:-}" in
  up|stop|restart) action="$1"; shift; run "$action" "$@" ;;
  ps)      cmd_ps ;;
  status)  cmd_status ;;
  open)    shift; cmd_open "${1:-}" ;;
  logs)    shift; cmd_logs "$@" ;;
  *)       die "usage: $(basename "$0") {up|stop|restart|ps|status|open|logs} [service...]" ;;
esac
