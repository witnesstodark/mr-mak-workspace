# Kimodo on AMD Windows

This workspace uses the [Kimodo.cpp Windows port](https://github.com/TheLocalLab/kimodo.cpp-windows)
to generate human motion from text on an AMD GPU. The upstream NVIDIA Python
implementation expects CUDA; this setup uses Vulkan through the Windows Vulkan
SDK and AMD graphics driver instead.

## Local installation

The runtime and model weights live in `projects/kimodo-amd/runtime` on this
computer. They are excluded from Git; run `setup-windows.ps1` from the
repository root to clone the runtime, download the SOMA RP v1.1 motion model
and text encoder, and build the Vulkan backend.

The initial model download requires approximately 16-17 GB of disk space.
Review the model cards and their separate licenses before redistributing
weights or generated assets.

## Launch

After setup, run:

```powershell
.\projects\kimodo-amd\runtime\Launch-Kimodo-UI.bat
```

Open `http://127.0.0.1:8094` to use the local motion studio. Generated
animations can be exported as GLB for Blender or downstream game workflows.

## Hardware route

- GPU: AMD Radeon RX 7900 XTX
- GPU backend: Vulkan
- Build tools: Visual Studio C++ x64, CMake, Go, and the Vulkan SDK

The setup script maps the runtime to `K:` while compiling. This short path
works around MSVC path-length and shader-build issues; the mapping is local
and can be removed with `subst K: /d` after setup.
