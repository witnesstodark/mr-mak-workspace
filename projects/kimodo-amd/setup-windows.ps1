$ErrorActionPreference = "Stop"

$projectRoot = Split-Path -Parent $MyInvocation.MyCommand.Path
$runtime = Join-Path $projectRoot "runtime"
$model = "soma-rp-v1.1"

if (-not (Test-Path (Join-Path $runtime ".git"))) {
    git clone https://github.com/TheLocalLab/kimodo.cpp-windows.git $runtime
    git -C $runtime submodule update --init --recursive
}

if (-not (Get-Command cmake -ErrorAction SilentlyContinue)) {
    throw "CMake is required. Install it with: winget install --id Kitware.CMake --exact"
}

if (-not (Get-Command go -ErrorAction SilentlyContinue)) {
    throw "Go is required. Install it with: winget install --id GoLang.Go --exact"
}

$vsDevCmd = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\Tools\VsDevCmd.bat"
$vulkanSdk = "C:\VulkanSDK\1.4.357.0"
$ninja = "C:\Program Files\Microsoft Visual Studio\18\Community\Common7\IDE\CommonExtensions\Microsoft\CMake\Ninja\ninja.exe"
if (-not (Test-Path $vsDevCmd)) {
    throw "Visual Studio 2026 C++ tools are required at $vsDevCmd"
}
if (-not (Test-Path "$vulkanSdk\Lib\vulkan-1.lib")) {
    throw "Vulkan SDK is required at $vulkanSdk"
}
if (-not (Test-Path $ninja)) {
    throw "Visual Studio's bundled Ninja executable was not found"
}

python -m pip install --user huggingface_hub
python (Join-Path $runtime "scripts\download_gguf_weights.py") `
    --output $runtime `
    --model $model

if (-not (Test-Path "K:\")) {
    subst K: $runtime
}
if (-not (Test-Path "K:\")) {
    throw "K: is unavailable; a short path is required by the Vulkan shader build"
}

$cmakeCommand = @(
    "call `"$vsDevCmd`" -arch=x64",
    "cmake -S K:\ -B K:\build -G Ninja -DCMAKE_MAKE_PROGRAM=`"$ninja`" -DCMAKE_BUILD_TYPE=Release",
    "-DKIMODO_ENABLE_VULKAN=ON -DCMAKE_PREFIX_PATH=`"$vulkanSdk\Lib\cmake`"",
    "-DVulkan_INCLUDE_DIR=`"$vulkanSdk\Include`" -DVulkan_LIBRARY=`"$vulkanSdk\Lib\vulkan-1.lib`"",
    "-DVulkan_GLSLC_EXECUTABLE=`"$vulkanSdk\Bin\glslc.exe`"",
    "&& cmake --build K:\build --parallel 1"
) -join " "
& $env:ComSpec /d /s /c $cmakeCommand
if ($LASTEXITCODE -ne 0) {
    throw "Kimodo build failed with exit code $LASTEXITCODE"
}

Write-Host "Kimodo is ready. Launch the studio with:"
Write-Host (Join-Path $runtime "Launch-Kimodo-UI.bat")
