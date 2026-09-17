# Freeze the backend with PyInstaller (one-folder) and copy it into the Tauri sidecar slot.
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
Set-Location $backend

# PyInstaller logs to stderr; PowerShell 5.1 would turn every line into an error under "Stop".
$ErrorActionPreference = "Continue"
& .\.venv\Scripts\pyinstaller.exe machinery_backend.spec --noconfirm --log-level WARN 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($code -ne 0) { throw "pyinstaller failed with exit code $code" }

$bin = Join-Path $backend "..\frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item "dist\machinery-backend\machinery-backend.exe" (Join-Path $bin "machinery-backend-x86_64-pc-windows-msvc.exe") -Force
if (Test-Path (Join-Path $bin "_internal")) { Remove-Item (Join-Path $bin "_internal") -Recurse -Force }
Copy-Item "dist\machinery-backend\_internal" (Join-Path $bin "_internal") -Recurse
Write-Host "sidecar copied to $bin"
