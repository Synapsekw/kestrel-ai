<#
.SYNOPSIS
  Build the Windows installer with Inno Setup 6 (spec section 10).

.DESCRIPTION
  Builds the Tauri app without a bundler (`pnpm tauri build --no-bundle`) and wraps the result,
  the frozen sidecar and its `_internal` folder into a per-user setup exe with Inno Setup. Tauri's
  own NSIS and WiX bundlers both stop at a 2 GB payload and the CUDA backend is 3.4 GB; see
  docs/progress.md, "S6 packaging evidence".

  The compiler is `node_modules/innosetup-compiler`, so nothing is installed system-wide. The
  version comes from src-tauri/tauri.conf.json, so it is not duplicated.

  Freeze the backend first: `backend\scripts\build.ps1`.

  Before Inno Setup it runs check-packaged-webview.ps1, which needs Kestrel AI closed.

.PARAMETER SkipTauriBuild
  Compile the installer around the release binary that is already in target/release.

.EXAMPLE
  pnpm build:installer
#>
[CmdletBinding()]
param([switch] $SkipTauriBuild)

$ErrorActionPreference = "Stop"
# $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1, so every
# path is resolved here in the body.
$frontend = Split-Path $PSScriptRoot -Parent
Set-Location $frontend
$started = Get-Date

$binaries = Join-Path $frontend "src-tauri\binaries"
$sidecar = Join-Path $binaries "kestrel-backend-x86_64-pc-windows-msvc.exe"
$internal = Join-Path $binaries "_internal"
if (-not (Test-Path $sidecar) -or -not (Test-Path $internal)) {
  throw "the frozen backend is missing from $binaries. Run backend\scripts\build.ps1 first; it freezes the backend with PyInstaller and copies the exe and its _internal folder into the sidecar slot."
}

$iscc = Join-Path $frontend "node_modules\innosetup-compiler\bin\ISCC.exe"
if (-not (Test-Path $iscc)) {
  throw "the Inno Setup compiler is missing at $iscc. Run pnpm install in frontend/."
}

$version = (Get-Content (Join-Path $frontend "src-tauri\tauri.conf.json") -Raw | ConvertFrom-Json).version
# Inno writes the version into VersionInfoVersion, which Windows requires to be numeric: a
# pre-release version such as 0.2.0-rc1 would otherwise fail deep inside ISCC.
if ($version -notmatch '^\d+(\.\d+){0,3}$') {
  throw "the version in src-tauri\tauri.conf.json is '$version'; the installer needs a numeric version such as 0.1.0 (up to four dot-separated numbers)"
}
Write-Host "building the installer for version $version"

if (-not $SkipTauriBuild) {
  # pnpm and cargo write progress on stderr; PowerShell 5.1 would turn every line into an error
  # under "Stop", so the exit code is checked by hand instead.
  $ErrorActionPreference = "Continue"
  & pnpm tauri build --no-bundle 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "pnpm tauri build --no-bundle failed with exit code $code" }
}

$appExe = Join-Path $frontend "src-tauri\target\release\kestrel-ai.exe"
if (-not (Test-Path $appExe)) { throw "no release binary at $appExe; run without -SkipTauriBuild" }

# The packaged 3D viewer must render (spec section 13; ADR 2026-09-23 "packaged webview needs
# worker-src blob:"). pnpm dev and tauri dev hide a blank viewer; only the release exe shows it. No
# installer is built when the check fails.
& powershell -NoProfile -ExecutionPolicy Bypass -File (Join-Path $PSScriptRoot "check-packaged-webview.ps1")
if ($LASTEXITCODE -ne 0) { throw "the packaged-webview check failed; no installer was built (the reason is above)" }

# The WebView2 bootstrapper is Microsoft's redistributable, never committed. It is shipped only
# when a copy is already on this machine: dropped into frontend/installer/ by hand, or left in the
# Tauri bundler cache by an earlier NSIS build. Without it the installer still works on a machine
# that has the runtime, which every Windows 11 machine does.
$installerDir = Join-Path $frontend "installer"
$bootstrapper = Join-Path $installerDir "MicrosoftEdgeWebview2Setup.exe"
if (-not (Test-Path $bootstrapper)) {
  $cache = Join-Path $env:LOCALAPPDATA "tauri"
  $cached = if (Test-Path $cache) {
    Get-ChildItem $cache -Recurse -File -Filter "MicrosoftEdgeWebview2Setup.exe" -ErrorAction SilentlyContinue |
      Select-Object -First 1
  } else { $null }
  if ($cached) {
    Copy-Item $cached.FullName $bootstrapper -Force
    Write-Host "webview2 bootstrapper copied from the tauri cache"
  } else {
    Write-Warning "no MicrosoftEdgeWebview2Setup.exe found; the installer will not be able to install the WebView2 runtime on a machine that lacks it (see the README troubleshooting section)"
  }
}
if (Test-Path $bootstrapper) { Write-Host "webview2 bootstrapper: $bootstrapper" }

$output = Join-Path $frontend "src-tauri\target\release\bundle\inno"
New-Item -ItemType Directory -Force $output | Out-Null

$ErrorActionPreference = "Continue"
& $iscc "/DAppVersion=$version" (Join-Path $installerDir "kestrel-ai.iss") 2>&1 |
  ForEach-Object { "$_" }
$code = $LASTEXITCODE
$ErrorActionPreference = "Stop"
if ($code -ne 0) { throw "ISCC failed with exit code $code" }

$setup = Join-Path $output "Kestrel AI_${version}_x64-setup.exe"
if (-not (Test-Path $setup)) { throw "ISCC reported success but $setup is missing" }
$elapsed = (Get-Date) - $started
$webview2 = if (Test-Path $bootstrapper) { "with the WebView2 bootstrapper" } else { "without a WebView2 bootstrapper" }
Write-Host ("installer: {0} ({1:N1} MB, {2}) in {3:N0} s" -f $setup, ((Get-Item $setup).Length / 1MB), $webview2, $elapsed.TotalSeconds)
