<#
.SYNOPSIS
  Proves the packaged app's 3D viewer renders (spec section 13). build-installer.ps1 runs it before Inno Setup.

.DESCRIPTION
  pnpm dev and tauri dev render point clouds even with a CSP that blanks the packaged app, so only a
  check on the packaged exe catches that trap. This script: refuses to run while Kestrel AI is open;
  starts the frozen backend on a free port with a temp app-data dir; writes the fixture LAZ (or takes
  -Cloud); imports it into a fresh detection project; launches the release exe against that backend
  (APP_BACKEND_URL/APP_BACKEND_TOKEN) with a CDP port and a temp WebView2 profile; runs the driver
  (check-packaged-webview.mjs by default); then kills both process trees and removes the temp dir.

.EXAMPLE
  pnpm -C frontend check:webview
#>
[CmdletBinding()]
param([string] $Cloud, [string] $Driver, [int] $Budget = 3000000, [switch] $Keep)

$ErrorActionPreference = "Stop"
$frontend = Split-Path $PSScriptRoot -Parent
if (-not $Driver) { $Driver = Join-Path $PSScriptRoot "check-packaged-webview.mjs" }
$backendExe = Join-Path $frontend "src-tauri\binaries\kestrel-backend-x86_64-pc-windows-msvc.exe"
$appExe = Join-Path $frontend "src-tauri\target\release\kestrel-ai.exe"
foreach ($p in @($backendExe, $appExe, $Driver)) {
  if (-not (Test-Path $p)) { throw "missing $p (freeze the backend with backend\scripts\build.ps1 and build the release app first)" }
}
if (Get-Process -Name "kestrel-ai" -ErrorAction SilentlyContinue) {
  throw "Kestrel AI is running; close it first (a WebView2 profile cannot be shared across different browser arguments)"
}

function Get-FreePort {
  $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start()
  $port = $l.LocalEndpoint.Port; $l.Stop(); return $port
}

$T = Join-Path $env:TEMP ("kestrel-webview-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $T, (Join-Path $T "appdata"), (Join-Path $T "project") | Out-Null
$token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$backend = $null; $app = $null; $script:Base = $null

function Invoke-Api([string] $Method, [string] $Path, $Body) {
  $request = @{ Method = $Method; Uri = "$script:Base/api/v1$Path"; Headers = @{ Authorization = "Bearer $token" }; UseBasicParsing = $true; TimeoutSec = 900 }
  if ($null -ne $Body) { $request.Body = ($Body | ConvertTo-Json -Depth 8); $request.ContentType = "application/json" }
  $response = Invoke-WebRequest @request
  if ($response.Content) { return ($response.Content | ConvertFrom-Json) }
  return $null
}

try {
  $env:APP_TOKEN = $token; $env:APP_PORT = "0"; $env:APP_DATA_DIR = Join-Path $T "appdata"
  $stdout = Join-Path $T "stdout.txt"
  $backend = Start-Process -FilePath $backendExe -PassThru -WindowStyle Hidden -RedirectStandardOutput $stdout -RedirectStandardError (Join-Path $T "stderr.txt")
  $port = $null; $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $port) {
    if ($backend.HasExited) { throw "the frozen backend exited with code $($backend.ExitCode)" }
    $line = Get-Content $stdout -ErrorAction SilentlyContinue | Where-Object { $_ -match '"port":\s*(\d+)' }
    if ($line) { $port = [int]$Matches[1] }
    Start-Sleep -Milliseconds 100
  }
  if (-not $port) { throw "the frozen backend printed no startup line within 30 s" }
  $script:Base = "http://127.0.0.1:$port"
  $deadline = (Get-Date).AddSeconds(20); $up = $false
  while ((Get-Date) -lt $deadline -and -not $up) { try { Invoke-Api GET "/health" | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 200 } }
  if (-not $up) { throw "the frozen backend did not answer /health" }

  if (-not $Cloud) {
    $Cloud = Join-Path $T "fixture.laz"
    $written = & $backendExe pointcloud-selftest --write-fixture $Cloud 2>&1 | Out-String
    if ($LASTEXITCODE -ne 0) { throw "could not write the fixture: $written" }
  }
  $project = Invoke-Api POST "/projects" @{ name = "Webview check"; folder = (Join-Path $T "project"); classes = @(@{ name = "excavator"; colour = "#f97316" }); kind = "detect" }
  $created = Invoke-Api POST "/projects/$($project.id)/pointclouds" @{ path = $Cloud }
  $deadline = (Get-Date).AddMinutes(30)
  do {
    Start-Sleep -Milliseconds 500
    $job = Invoke-Api GET "/projects/$($project.id)/jobs/$($created.job.id)"
  } while ($job.state -in @("queued", "running") -and (Get-Date) -lt $deadline)
  if ($job.state -ne "succeeded") { throw "the cloud import did not succeed: $($job.state) $($job.error)" }

  $cdp = Get-FreePort
  $env:APP_BACKEND_URL = $script:Base
  $env:APP_BACKEND_TOKEN = $token
  $env:WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS = "--remote-debugging-port=$cdp"
  $env:WEBVIEW2_USER_DATA_FOLDER = Join-Path $T "webview"
  $app = Start-Process -FilePath $appExe -PassThru
  $deadline = (Get-Date).AddSeconds(60); $cdpUp = $false
  while ((Get-Date) -lt $deadline -and -not $cdpUp) {
    try { Invoke-WebRequest -UseBasicParsing "http://127.0.0.1:$cdp/json/version" -TimeoutSec 1 | Out-Null; $cdpUp = $true } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $cdpUp) { throw "the packaged app opened no CDP endpoint on $cdp within 60 s" }

  $env:KESTREL_CDP_PORT = "$cdp"; $env:KESTREL_PROJECT_ID = $project.id; $env:KESTREL_CLOUD_ID = $created.cloud.id
  $env:KESTREL_BACKEND_URL = $script:Base; $env:KESTREL_TOKEN = $token; $env:KESTREL_BUDGET = "$Budget"
  $env:KESTREL_WEBVIEW_DIR = Join-Path $T "webview"; $env:KESTREL_WORK_DIR = $T
  $ErrorActionPreference = "Continue"
  & node $Driver 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "the packaged-webview check failed (driver exit $code)" }
} finally {
  foreach ($p in @($app, $backend)) {
    if ($p -and -not $p.HasExited) { & taskkill /T /F /PID $p.Id 2>&1 | Out-Null }
  }
  foreach ($n in "APP_TOKEN", "APP_PORT", "APP_DATA_DIR", "APP_BACKEND_URL", "APP_BACKEND_TOKEN", "WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS", "WEBVIEW2_USER_DATA_FOLDER", "KESTREL_CDP_PORT", "KESTREL_PROJECT_ID", "KESTREL_CLOUD_ID", "KESTREL_BACKEND_URL", "KESTREL_TOKEN", "KESTREL_BUDGET", "KESTREL_WEBVIEW_DIR", "KESTREL_WORK_DIR") {
    Remove-Item "Env:$n" -ErrorAction SilentlyContinue
  }
  if ($Keep) { Write-Host "work dir kept: $T" } else { Start-Sleep -Seconds 1; Remove-Item $T -Recurse -Force -ErrorAction SilentlyContinue }
}
