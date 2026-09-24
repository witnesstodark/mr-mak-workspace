#!/usr/bin/env bash
# Store the ComfyUI models on an external drive.
#
#   .agents/tools/media/models-hd.sh MOUNT_POINT [--move]
#
# What it does:
#   - creates <MOUNT_POINT>/comfyui-models
#   - writes .models-dir at the project root, which infra/docker/stack.sh reads to mount the
#     drive over /root/ComfyUI/models in the container
#   - with --move, moves the models already inside the Docker volume to the drive
#   - prints the /etc/fstab line so the drive always mounts at the same path
set -euo pipefail
source "$(dirname "${BASH_SOURCE[0]}")/common.sh"

# The stack lives in the game project, not next to this script: resolve the game
# root so `.models-dir` and the models directory land where stack.sh reads them.
PROJECT_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../../workspace/ashenhold-td" && pwd)"

MOUNT="${1:-}"
[ -n "$MOUNT" ] || die "usage: models-hd.sh MOUNT_POINT [--move]"
MOVE=0
[ "${2:-}" = "--move" ] && MOVE=1

require_cmd docker
require_cmd findmnt
[ -d "$MOUNT" ] || die "mount point not found: $MOUNT"
mountpoint -q "$MOUNT" || die "$MOUNT is not a mount point - is the drive mounted?"

FS="$(findmnt -no FSTYPE "$MOUNT")"
if [ "$FS" != ext4 ]; then
  report "warning: filesystem is $FS; ext4 reads faster and handles permissions better"
fi
FREE_GB="$(df -BG --output=avail "$MOUNT" | tail -1 | tr -dc '0-9')"
if [ "${FREE_GB:-0}" -lt 40 ]; then
  report "warning: only ${FREE_GB}GB free on $MOUNT (the full model set is about 26GB)"
fi

DEST="$MOUNT/comfyui-models"
mkdir -p "$DEST"

# ComfyUI's models live in the project folder `infra/docker/comfy/data/models`,
# bind-mounted at `/root/ComfyUI/models` in the container.
MODELS_DIR="$PROJECT_ROOT/infra/docker/comfy/data/models"

if [ "$MOVE" = 1 ]; then
  report "moving models from $MODELS_DIR to $DEST"
  docker --context default run --rm \
    -v "$MODELS_DIR":/data \
    -v "$DEST":/dest \
    alpine sh -c '
      cd /data || exit 1
      find . -type f -print0 | while IFS= read -r -d "" f; do
        mkdir -p "/dest/$(dirname "$f")"
        mv "$f" "/dest/$f"
      done
      echo "moved:"; find /dest -type f | wc -l'
fi

printf '%s\n' "$DEST" > "$PROJECT_ROOT/.models-dir"
report "wrote $PROJECT_ROOT/.models-dir -> $DEST"

UUID="$(findmnt -no UUID "$MOUNT" 2>/dev/null || true)"
report ""
report "To keep the drive at this path after reboots, add to /etc/fstab:"
if [ -n "$UUID" ]; then
  report "UUID=$UUID  $MOUNT  $FS  defaults,nofail,noatime  0  2"
else
  report "$MOUNT  $FS  defaults,nofail,noatime  0  2   # UUID via: blkid"
fi
report ""
report "Next: infra/docker/stack.sh up comfyui"
