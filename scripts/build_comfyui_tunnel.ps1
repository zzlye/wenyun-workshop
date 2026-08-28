$ErrorActionPreference = "Stop"

# 使用 D:\tools 中的 Python，构建产物放到 D:\tmp，避免污染项目目录。
$python = "D:\tools\python\cpython-3.11-windows-x86_64-none\python.exe"
$projectRoot = Split-Path -Parent $PSScriptRoot
$source = Join-Path $PSScriptRoot "comfyui_tunnel_gui.py"
$buildRoot = "D:\tmp\comfyui-tunnel-build"
$distRoot = "D:\tmp\comfyui-tunnel-dist"

if (-not (Test-Path -LiteralPath $python)) {
    throw "找不到 D:\tools 中的 Python：$python"
}

& $python -m pip install --target "D:\tools\python-packages\comfyui-tunnel" pyinstaller
if ($LASTEXITCODE -ne 0) { throw "PyInstaller 安装失败" }

$env:PYTHONPATH = "D:\tools\python-packages\comfyui-tunnel"
& $python -m PyInstaller --noconfirm --clean --onefile --windowed `
    --name "ComfyUI云酒馆隧道" `
    --distpath $distRoot `
    --workpath $buildRoot `
    --specpath $buildRoot `
    $source
if ($LASTEXITCODE -ne 0) { throw "EXE 构建失败" }

Write-Host "构建完成：$(Join-Path $distRoot 'ComfyUI云酒馆隧道.exe')"
