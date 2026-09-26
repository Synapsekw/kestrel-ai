# Freeze the backend with PyInstaller (one-folder) and copy it into the Tauri sidecar slot.
# -Venv points at the environment to freeze with: a git worktree has no .venv of its own (and must
# not link to the shared one), so it passes the main checkout's, e.g. -Venv E:\Dev\Yolo\app\backend\.venv
param([string] $Venv = "")
$ErrorActionPreference = "Stop"
$backend = Split-Path $PSScriptRoot -Parent
Set-Location $backend
if (-not $Venv) { $Venv = Join-Path $backend ".venv" }
$pyinstaller = Join-Path $Venv "Scripts\pyinstaller.exe"
if (-not (Test-Path $pyinstaller)) { throw "no PyInstaller at $pyinstaller (pass -Venv <environment>)" }
$started = Get-Date

# Starter weights (usability gap G1) must be fetched before PyInstaller can bundle them.
foreach ($key in @("yolo11n", "yolo11s", "yolo11m")) {
  $path = Join-Path $backend "starter_weights\$key.pt"
  if (-not (Test-Path $path) -or (Get-Item $path).Length -le 1MB) {
    throw "starter weights missing: run scripts\fetch_starter_weights.ps1"
  }
}

# PotreeConverter payload (spec §14): every MANIFEST.json file must be there before freezing.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check_potree_payload.ps1") -Dir (Join-Path $backend "third_party\potreeconverter")
if ($LASTEXITCODE -ne 0) { throw "PotreeConverter payload incomplete; run scripts\fetch_potreeconverter.ps1" }

# PyInstaller logs to stderr; PowerShell 5.1 would turn every line into an error under "Stop".
$ErrorActionPreference = "Continue"
& $pyinstaller kestrel_backend.spec --noconfirm --log-level WARN 2>&1 | ForEach-Object { "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($code -ne 0) { throw "pyinstaller failed with exit code $code" }

foreach ($key in @("yolo11n", "yolo11s", "yolo11m")) {
  $bundledStarter = "dist\kestrel-backend\_internal\starter_weights\$key.pt"
  if (-not (Test-Path $bundledStarter)) { throw "starter weights did not make it into the bundle: $bundledStarter" }
}

& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check_potree_payload.ps1") -Dir "dist\kestrel-backend\_internal\potreeconverter"
if ($LASTEXITCODE -ne 0) { throw "the PotreeConverter payload did not make it into the bundle intact" }

$bin = Join-Path $backend "..\frontend\src-tauri\binaries"
New-Item -ItemType Directory -Force $bin | Out-Null
Copy-Item "dist\kestrel-backend\kestrel-backend.exe" (Join-Path $bin "kestrel-backend-x86_64-pc-windows-msvc.exe") -Force

if (Test-Path (Join-Path $bin "_internal")) { Remove-Item (Join-Path $bin "_internal") -Recurse -Force }
Copy-Item "dist\kestrel-backend\_internal" (Join-Path $bin "_internal") -Recurse
Write-Host "sidecar copied to $bin"

$bytes = (Get-ChildItem "dist\kestrel-backend" -Recurse -File | Measure-Object -Sum Length).Sum
$elapsed = (Get-Date) - $started
Write-Host ("dist/kestrel-backend: {0:N1} MB in {1:N0} files; build took {2:N0} s" -f `
  ($bytes / 1MB), (Get-ChildItem "dist\kestrel-backend" -Recurse -File).Count, $elapsed.TotalSeconds)
