# Media tools

Local, script-first media pipeline for Ashenhold TD. The OpenCode plugin in
`.opencode/plugins/media-tools/` exposes these scripts as tools; the scripts can
also be run directly from the shell.

## Requirements

Already installed on the machine: `ImageMagick` (`convert`), `ffmpeg`/`ffprobe`,
`sox`, `Blender`, `Inkscape`, `python3`.

GPU generation runs in the ComfyUI container of the project stack (`workspace/ashenhold-td/infra/docker/stack.sh up
comfyui`); the endpoint is `http://127.0.0.1:8188`, override with `COMFYUI_URL`.
The image is `yanwk/comfyui-boot:cu130-slim-v2`; models, custom nodes and user data
live in `workspace/ashenhold-td/infra/docker/comfy/data/` (git-ignored; the container's
`/root/ComfyUI/models`, `custom_nodes`, `user` and `input` point into it).

No `magick` binary exists here; ImageMagick 6 uses `convert`.

## Output safety

Every script refuses to write outside `Assets/`, `Artifacts/`, or
`/tmp/opencode/`. Scratch output goes to `Artifacts/Media/` (git-ignored). Final
game assets go to `Assets/` and follow the `asset-organization` skill.

## Tools

### image-convert.sh

Resize, fit, convert format, trim transparent margins, reduce colors.

```sh
.agents/tools/media/image-convert.sh --in src.png --out Assets/Art/Towers/ember.png \
  --width 128 --height 128 --fit cover --quality 90
```

`--fit contain|cover|stretch`, `--format png|jpg|webp`, `--max-colors N`,
`--trim-alpha`.

### image-edit.sh

Apply deterministic effects in order. Each effect is `op:arg:arg`.

```sh
.agents/tools/media/image-edit.sh --in icon.png --out icon.outlined.png \
  --effect pad:8:none --effect outline:4:'#000000' --effect shadow:6:'#000000'
```

Ops: `border:WIDTH:COLOR`, `pad:WIDTH:COLOR` (use `none` for transparent),
`shadow:SIGMA:COLOR`, `outline:WIDTH:COLOR`, `tint:COLOR:AMOUNT`,
`saturate:AMOUNT`, `grayscale`, `flip`, `flop`.

`outline` dilates the alpha channel within the canvas, so add transparent
padding first (`pad`) when the shape touches the edge.

### comfyui_client.py and comfyui_zimage_client.py

Text-to-image through ComfyUI. These two are Python because ComfyUI exposes an
HTTP API and no CLI at all; they take the output path through the same guardrail
as the shell tools (only `Assets/`, `Artifacts/` or `/tmp/opencode/`). The
SD-Turbo client uses the first checkpoint in `models/checkpoints` unless
`--checkpoint` is given; the Z-Image client runs its own GGUF workflow and obeys
the prompt, which is what makes it the default for anything that becomes a mesh.

```sh
python3 .agents/tools/media/comfyui_client.py --prompt "isometric poison tower icon, flat style" \
  --out Artifacts/Media/poison.png --width 512 --height 512 --steps 25

python3 .agents/tools/media/comfyui_zimage_client.py --prompt "..." \
  --out Artifacts/Media/concept.png --width 768 --height 768 --steps 9
```

Exit `2` on bad usage or a rejected output path, `3` when ComfyUI is
unreachable, `4` when generation fails.

### sound-generate.sh

Procedural SFX with SoX: `tone`, `sweep`, `noise`, `impact`, `chime`, `blip`.

```sh
.agents/tools/media/sound-generate.sh --out Assets/Audio/Towers/BallistaShot.ogg \
  --type impact --duration 0.35 --lowpass 1200 --decay 0.3 --normalize
```

### audio-process.sh

Trim, normalize, gain, fade, loop, resample, and encode.

```sh
.agents/tools/media/audio-process.sh --in raw.wav --out Assets/Audio/Towers/BallistaShot.ogg \
  --duration 0.4 --normalize --fade-out 0.1 --format ogg --quality 6
```

`--normalize` targets `--target-lufs` (default -16) at -1.5 dBTP and preserves
the source sample rate. `--format ogg|wav|mp3|flac`.

### mesh-to-unity.sh

Convert a generated GLB into an FBX that Unity can import. Unity does not read
GLB, so every generated mesh passes through here.

```sh
.agents/tools/media/mesh-to-unity.sh --in Artifacts/Media/ArcaneSpire.glb --out Assets/Art/Towers/ArcaneSpire.fbx
```

Meshes only: lights, cameras and animation are dropped, textures are embedded,
and the axis conversion is the Blender default for Unity (-Z forward, Y up).
`--scale F` adjusts size; `--no-textures` skips embedding.

## Verification

The model can see PNG/JPEG/GIF/WebP output and must inspect it; it cannot hear
audio. Verify audio by measurement:

```sh
ffprobe -v error -show_entries format=duration -show_entries stream=codec_name,channels,sample_rate -of default=nw=1:nk=1 out.ogg
ffmpeg -hide_banner -i out.ogg -af volumedetect -f null - 2>&1 | grep -E "mean_volume|max_volume"
```

Check peak near -1.5 dBFS and no clipping; compare duration against the brief.

GPU generation is measured on the 6 GB budget:

```sh
.agents/tools/media/measure-gpu.sh --label "image generate" -- \
  python3 .agents/tools/media/comfyui_client.py --prompt "..." --out Artifacts/Media/preview.png
```

It reports wall time and peak VRAM, so a pipeline that only fits with other
applications closed is visible before it becomes a habit.

## Measured on this machine

RTX 4050 Laptop, 6141 MiB, driver 595.91.07. The table below was measured on the
old native install (ComfyUI 0.37.0, torch 2.11.0+cu128); the container now ships
torch 2.13.0+cu130 with the same ComfyUI, so treat these numbers as the floor to
beat.

| Run | Time | Peak VRAM |
| --- | --- | --- |
| SD-Turbo 512x512, 4 steps, cfg 1.0 | 3.2 s | 2868 MiB |
| Pixal3D image to GLB, low-VRAM mode | ~356 s | 5764 MiB (94% of the card) |

SD-Turbo is distilled: use 4 steps with guidance disabled (`--cfg 1.0`), not the
25-step defaults. The image path leaves most of the 6 GB free; the mesh path
uses nearly all of it, which is why the same mesh failed twice before the
low-VRAM tuning. Nothing else GPU-heavy can run during a mesh.

### Torch build

The container ships PyTorch 2.13.0 on the **cu130** index, so the optimized
`comfy_kitchen` CUDA kernels load (FP8, NVFP4, ConvRot W4A4, INT8 — the family the
int8_convrot Pixal3D checkpoint uses). The old native install stayed on cu128 on
purpose; the container is the current path. Re-measure the table above before
planning production around it.

### 6 GB tuning that mattered

Pixal3D fits in 6 GB with these values, each one necessary — re-apply them on the
official template:

- `Trellis2UpsampleStage.target_resolution` 1536 to **1024** — the node's own
  default and Pixal3D's documented low-VRAM mode.
- `RemeshMesh.resolution` 768 to **512** — 768 exhausted the card on a
  13M-face mesh.
- `UnwrapMesh` atlas 4096 to **2048**.
- `--cache-none` on the server, because the 5.3 GB transformer otherwise stays
  resident and starves the post-processing. `--lowvram` is a no-op while
  dynamic VRAM is active.

## Server control

`workspace/ashenhold-td/infra/docker/stack.sh` (run from the workspace root) starts, stops and inspects the stack, passing
the right Docker engine per service (ComfyUI and Kimodo need the Engine, which has
the GPU; the runner lives on Docker Desktop). ComfyUI always starts with
`--cache-none`, the flag that makes Pixal3D fit in 6 GB.

```sh
workspace/ashenhold-td/infra/docker/stack.sh up comfyui
workspace/ashenhold-td/infra/docker/stack.sh stop comfyui
workspace/ashenhold-td/infra/docker/stack.sh open comfyui     # start if needed and open the browser
workspace/ashenhold-td/infra/docker/stack.sh logs comfyui 40
workspace/ashenhold-td/infra/docker/stack.sh status
```

Desktop shortcuts for **Blender** and **ComfyUI** exist in `~/Desktop` and in the
application menu and call `workspace/ashenhold-td/infra/docker/stack.sh`. The ComfyUI one starts the container if
needed and opens the browser; its context menu offers status, stop, the
generated-models folder and the log.

### Checking what a workflow needs

The container ships ComfyUI-Manager: use its panel to see installed custom nodes
and what a workflow is missing. From the shell, count the node classes the server
exposes:

```sh
curl -s http://127.0.0.1:8188/object_info | python3 -c 'import json,sys; print(len(json.load(sys.stdin)), "classes")'
```

The Pixal3D workflow runs on the core installation alone, with no custom nodes.
The Z-Image path needs `ComfyUI-GGUF`, installed from ComfyUI-Manager.

### TRELLIS.2 GGUF fork: evaluated and declined

The `Aero-Ex/ComfyUI-Trellis2-GGUF` fork (and `Trellis2_gguf_model_downloader.bat`)
requires Torch 2.7.0 or 2.9.1 wheels, `transformers==5.2.0` and numpy 1.26.4.
The container runs a newer torch/transformers stack than the fork pins, and the
official TRELLIS.2 int8 already produces meshes. The fork's extra value is mesh
cleanup (weld, fill holes, remesh with quad, simplify), which the core already
provides through `RemeshMesh`, `DecimateMesh`, `UnwrapMesh`, `MeshSmoothNormals`,
`MergeMeshes` and `Get3DComponents`, and which Blender also covers. Installing it
would downgrade working dependencies for capability we already have. Revisit only
inside an isolated environment.

## Long jobs

Background work reports on completion, not live. `progress.sh` answers "where is
it" in a fraction of a second:

```sh
.agents/tools/media/progress.sh --log /tmp/opencode/render.log \
  --pid main.py --dir Artifacts/ComfyUI --name "mesh"
```

It prints the current stage, the last percentage, and the bytes already on disk.
For a continuous view, run it under `watch` in your own shell, outside the
session.

## ComfyUI (Docker)

ComfyUI is a container (`yanwk/comfyui-boot:cu130-slim-v2`), defined in the root
`workspace/ashenhold-td/infra/docker/compose.yml` and run by `workspace/ashenhold-td/infra/docker/stack.sh` on the Docker Engine — the Docker Desktop VM
on Linux has no GPU passthrough, which is why the GPU services never run there.
Models, custom nodes, workflows and the database live in `workspace/ashenhold-td/infra/docker/comfy/data/`
(git-ignored, mounted at `/root`); generated files land in `Artifacts/ComfyUI/`.

```sh
workspace/ashenhold-td/infra/docker/stack.sh up comfyui
COMFYUI_URL=http://127.0.0.1:8188 python3 .agents/tools/media/comfyui_client.py --prompt "..." --out Artifacts/Media/preview.png
```

The volume is a **clean, factory ComfyUI**: no models, no custom nodes, no
workflows. Install what a workflow needs — ComfyUI-Manager lists custom nodes and
models — or fetch a file straight into the volume (paths under
`/root/ComfyUI/models/<folder>`):

| Model | Hugging Face path | Folder |
| --- | --- | --- |
| SD-Turbo | `stabilityai/sd-turbo/resolve/main/sd_turbo.safetensors` | `checkpoints` |
| Pixal3D int8 | `Comfy-Org/Pixal3D/resolve/main/diffusion_models/pixal3d_int8_convrot.safetensors` | `diffusion_models` |
| TRELLIS.2 int8 | `Comfy-Org/TRELLIS.2/resolve/main/diffusion_models/trellis_2_int8_convrot.safetensors` | `diffusion_models` |
| TRELLIS.2 shape VAE | `Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_shape_vae_bf16.safetensors` | `vae` |
| TRELLIS.2 texture VAE | `Comfy-Org/Pixal3D/resolve/main/vae/trellis_2_texture_vae_bf16.safetensors` | `vae` |
| DINOv3 (Pixal3D) | `Comfy-Org/Pixal3D/resolve/main/clip_vision/dino_v3_L_naf_fp32.safetensors` | `clip_vision` |
| BiRefNet | `Comfy-Org/BiRefNet/resolve/main/background_removal/birefnet.safetensors` | `background_removal` |
| MoGe | `Comfy-Org/MoGe/resolve/main/geometry_estimation/moge_2_vitl_normal_fp16.safetensors` | `geometry_estimation` |
| Z-Image Turbo Q4 | `jayn7/Z-Image-Turbo-GGUF/resolve/main/z_image_turbo-Q4_K_M.gguf` | `diffusion_models` |
| Qwen3 4B Q4 | `unsloth/Qwen3-4B-GGUF/resolve/main/Qwen3-4B-Q4_K_M.gguf` | `text_encoders` |
| Z-Image VAE | `Comfy-Org/z_image_turbo/resolve/main/split_files/vae/ae.safetensors` | `vae` |

```sh
# example: SD-Turbo into checkpoints
docker --context default exec comfyui python3 -c "import urllib.request; urllib.request.urlretrieve('https://huggingface.co/stabilityai/sd-turbo/resolve/main/sd_turbo.safetensors','/root/ComfyUI/models/checkpoints/sd_turbo.safetensors')"
```

## 3D meshes with Pixal3D

Pixal3D turns one image into a textured mesh. The official workflow is part of
ComfyUI core, so no third-party nodes are needed; both official templates (single
image and multi-view) come with the image — download the checkpoints from the
table above before the first run.

1. Start ComfyUI (`workspace/ashenhold-td/infra/docker/stack.sh up comfyui`) and load the `Pixal3D & TRELLIS.2: Image to Model` template.
2. Load the concept image and queue the workflow.
3. The GLB lands in `Artifacts/ComfyUI/3d/` (the container's output directory).
4. Convert it for Unity:

```sh
.agents/tools/media/mesh-to-unity.sh --in Artifacts/ComfyUI/3d/ArcaneSpire.glb --out Assets/Art/Towers/ArcaneSpire.fbx
```

The multi-view template reconstructs side and back geometry from a turnaround
sheet, which fixes the back-of-object hallucination of the single-image path.
Use generated meshes for hero assets and props, then clean them before Unity.

On 6 GB of VRAM, close Unity, Rider, and browsers before a run: the pipeline
peaks near the card's limit even quantized. Generation takes tens of minutes,
so measure a real asset before planning production around it.
