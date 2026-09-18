# Freeze the backend with PyInstaller (one-folder) and copy it into the Tauri sidecar slot.
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
Set-Location $backend
$started = Get-Date

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

$bytes = (Get-ChildItem "dist\machinery-backend" -Recurse -File | Measure-Object -Sum Length).Sum
$elapsed = (Get-Date) - $started
Write-Host ("dist/machinery-backend: {0:N1} MB in {1:N0} files; build took {2:N0} s" -f `
  ($bytes / 1MB), (Get-ChildItem "dist\machinery-backend" -Recurse -File).Count, $elapsed.TotalSeconds)
