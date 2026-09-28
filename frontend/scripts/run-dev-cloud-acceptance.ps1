<#
.SYNOPSIS
  Dev-mode acceptance for the point-cloud workspace (C-G ruling G1): the venv backend, Vite pointed at
  it, and Microsoft Edge (WebView2's engine, on the real GPU) with a CDP port; then one driver run.

.DESCRIPTION
  -Work is persistent: app data, the project folder, Edge's profile, state.json (project and cloud
  ids) and out\ (results, screenshots). The first run in a -Work creates the project and imports -Cloud
  (and -Photos) through backend\scripts\pointcloud_acceptance.py setup. A later run with the same
  -Work reopens that project: starting everything again is the "restart" of spec section 16 item 2.
  The token is random per run and never written anywhere. Every process is stopped at the end.

  A worktree has no backend\third_party\potreeconverter; unless KESTREL_POTREECONVERTER is set, the
  converter next to -Python's checkout (<backend>\.venv\Scripts\python.exe -> <backend>\third_party)
  is used.

  Edge runs with window-occlusion and background throttling off, so a window behind another one
  still renders every frame (the frame-time numbers would otherwise measure the throttle).

.EXAMPLE
  .\frontend\scripts\run-dev-cloud-acceptance.ps1 -Work D:\kestrel-acceptance\clouds -Cloud C:\data\chimney.las -Mode layout
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory)] [string] $Work,
  [string] $Cloud,
  [string] $Photos,
  [ValidateSet("layout", "perf", "pins", "pins-check", "clip", "photolink", "image2cloud", "formulas", "hold")]
  [string] $Mode = "perf",
  [int] $Budget = 3000000,
  [ValidateSet("full", "reduced")] [string] $Effects = "full",
  [string] $Driver,
  [string] $Python = "E:\Dev\Yolo\app\backend\.venv\Scripts\python.exe"
)

$ErrorActionPreference = "Stop"
$frontend = Split-Path $PSScriptRoot -Parent
$repo = Split-Path $frontend -Parent
if (-not $Driver) { $Driver = Join-Path $PSScriptRoot "measure-cloud-workspace.mjs" }
$edge = @("${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe", "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe") |
  Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $edge) { throw "Microsoft Edge is not installed" }
if (-not (Test-Path $Python)) { throw "no Python at $Python" }
$Work = [System.IO.Path]::GetFullPath($Work)
foreach ($d in @($Work, "$Work\appdata", "$Work\project", "$Work\out", "$Work\edge")) { New-Item -ItemType Directory -Force $d | Out-Null }
$stateFile = Join-Path $Work "state.json"
$state = if (Test-Path $stateFile) { Get-Content $stateFile -Raw | ConvertFrom-Json } else { $null }
$token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })

function Get-FreePort {
  $l = [System.Net.Sockets.TcpListener]::new([System.Net.IPAddress]::Loopback, 0); $l.Start()
  $port = $l.LocalEndpoint.Port; $l.Stop(); return $port
}
function Wait-Http([string] $Url, [int] $Seconds) {
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    try { Invoke-WebRequest -UseBasicParsing $Url -TimeoutSec 2 | Out-Null; return } catch { Start-Sleep -Milliseconds 300 }
  }
  throw "nothing answered $Url within $Seconds s"
}

$vars = "APP_TOKEN", "APP_PORT", "APP_DATA_DIR", "APP_CORS_ORIGINS", "VITE_DEV_PORT", "APP_BACKEND_URL", "APP_BACKEND_TOKEN",
  "KESTREL_CDP_PORT", "KESTREL_PROJECT_ID", "KESTREL_CLOUD_ID", "KESTREL_CRACK_TYPE", "KESTREL_BACKEND_URL", "KESTREL_TOKEN",
  "KESTREL_BUDGET", "KESTREL_WEBVIEW_DIR", "KESTREL_BROWSER_PROCESS", "KESTREL_WORK_DIR", "KESTREL_MODE", "KESTREL_EFFECTS",
  "KESTREL_OUT", "KESTREL_SHOTS"
$converterSet = $false
if (-not $env:KESTREL_POTREECONVERTER -and -not (Test-Path "$repo\backend\third_party\potreeconverter\PotreeConverter.exe")) {
  $fromPython = Join-Path (Split-Path (Split-Path (Split-Path $Python -Parent) -Parent) -Parent) "third_party\potreeconverter\PotreeConverter.exe"
  if (Test-Path $fromPython) { $env:KESTREL_POTREECONVERTER = $fromPython; $converterSet = $true }
}
$backend = $null; $vite = $null; $browser = $null
try {
  $vitePort = Get-FreePort
  $env:APP_TOKEN = $token; $env:APP_PORT = "0"; $env:APP_DATA_DIR = "$Work\appdata"
  $env:APP_CORS_ORIGINS = "[`"http://127.0.0.1:$vitePort`"]"
  $stdout = "$Work\backend-stdout.txt"
  $backend = Start-Process -FilePath $Python -ArgumentList "-m", "app" -WorkingDirectory "$repo\backend" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput $stdout -RedirectStandardError "$Work\backend-stderr.txt"
  $port = $null; $deadline = (Get-Date).AddSeconds(60)
  while ((Get-Date) -lt $deadline -and -not $port) {
    if ($backend.HasExited) { throw "the backend exited with code $($backend.ExitCode) (see $Work\backend-stderr.txt)" }
    $line = Get-Content $stdout -ErrorAction SilentlyContinue | Where-Object { $_ -match '"port":\s*(\d+)' } | Select-Object -First 1
    if ($line -and $line -match '"port":\s*(\d+)') { $port = [int]$Matches[1] }
    Start-Sleep -Milliseconds 200
  }
  if (-not $port) { throw "the backend printed no startup line within 60 s" }
  $base = "http://127.0.0.1:$port"
  $deadline = (Get-Date).AddSeconds(30); $up = $false
  while ((Get-Date) -lt $deadline -and -not $up) {
    try { Invoke-WebRequest -UseBasicParsing "$base/api/v1/health" -Headers @{ Authorization = "Bearer $token" } | Out-Null; $up = $true } catch { Start-Sleep -Milliseconds 300 }
  }
  if (-not $up) { throw "the backend did not answer /health" }

  if (-not $state) {
    if (-not $Cloud) { throw "the first run in $Work needs -Cloud" }
    $setup = @("scripts\pointcloud_acceptance.py", "setup", "--base", $base, "--token", $token, "--project-folder", "$Work\project",
      "--source", ([System.IO.Path]::GetFullPath($Cloud)), "--backend-pid", "$($backend.Id)")
    if ($Photos) { $setup += @("--photos", ([System.IO.Path]::GetFullPath($Photos))) }
    Push-Location "$repo\backend"
    try { $json = & $Python @setup | Select-Object -Last 1 } finally { Pop-Location }
    if ($LASTEXITCODE -ne 0) { throw "setup failed (exit $LASTEXITCODE): $json" }
    $parsed = $json | ConvertFrom-Json
    if ($parsed.import_state -ne "succeeded") { throw "the cloud import did not succeed: $($parsed.import_state) $($parsed.import_error)" }
    if ($Photos -and $parsed.photos_state -ne "succeeded") { throw "the photo import did not succeed: $($parsed.photos_state)" }
    $json | Set-Content -Encoding utf8 $stateFile
    $state = $parsed
    Write-Host "setup $json"
  }

  $env:VITE_DEV_PORT = "$vitePort"; $env:APP_BACKEND_URL = $base; $env:APP_BACKEND_TOKEN = $token
  $vite = Start-Process -FilePath "cmd.exe" -ArgumentList "/c", "pnpm", "-C", "`"$frontend`"", "dev" -PassThru -WindowStyle Hidden `
    -RedirectStandardOutput "$Work\vite.txt" -RedirectStandardError "$Work\vite-err.txt"
  Wait-Http "http://127.0.0.1:$vitePort/" 90

  $cdp = Get-FreePort
  $browser = Start-Process -FilePath $edge -PassThru -ArgumentList "--remote-debugging-port=$cdp", "--user-data-dir=`"$Work\edge`"",
    "--no-first-run", "--no-default-browser-check", "--disable-features=CalculateNativeWinOcclusion",
    "--disable-backgrounding-occluded-windows", "--disable-renderer-backgrounding", "--disable-background-timer-throttling",
    "--window-position=0,0", "--window-size=1440,900", "http://127.0.0.1:$vitePort/"
  Wait-Http "http://127.0.0.1:$cdp/json/version" 60

  $env:KESTREL_CDP_PORT = "$cdp"; $env:KESTREL_PROJECT_ID = $state.project_id; $env:KESTREL_CLOUD_ID = $state.cloud_id
  $env:KESTREL_CRACK_TYPE = $state.crack_type_id; $env:KESTREL_BACKEND_URL = $base; $env:KESTREL_TOKEN = $token
  $env:KESTREL_BUDGET = "$Budget"; $env:KESTREL_WEBVIEW_DIR = "$Work\edge"; $env:KESTREL_BROWSER_PROCESS = "msedge.exe"
  $env:KESTREL_WORK_DIR = $Work; $env:KESTREL_MODE = $Mode; $env:KESTREL_EFFECTS = $Effects
  $env:KESTREL_OUT = "$Work\out\$Mode-$Effects.json"; $env:KESTREL_SHOTS = "$Work\out"
  $ErrorActionPreference = "Continue"
  & node $Driver 2>&1 | ForEach-Object { "$_" }
  $code = $LASTEXITCODE
  $ErrorActionPreference = "Stop"
  if ($code -ne 0) { throw "the driver failed (exit $code)" }
} finally {
  # taskkill writes to stderr when a child is already gone; under "Stop" that would abort this block
  # and leave the rest running (found in the smoke run: Vite and the backend survived)
  $ErrorActionPreference = "Continue"
  foreach ($p in @($browser, $vite, $backend)) {
    if ($p -and -not $p.HasExited) { & taskkill /T /F /PID $p.Id 2>&1 | Out-Null }
  }
  # Edge may hand the window to a process that is not the one started: stop every Edge process of this profile.
  $profileDir = "$Work\edge"
  Get-CimInstance Win32_Process -Filter "Name='msedge.exe'" | Where-Object { $_.CommandLine -and $_.CommandLine.Contains($profileDir) } |
    ForEach-Object { & taskkill /T /F /PID $_.ProcessId 2>&1 | Out-Null }
  foreach ($n in $vars) { Remove-Item "Env:$n" -ErrorAction SilentlyContinue }
  if ($converterSet) { Remove-Item "Env:KESTREL_POTREECONVERTER" -ErrorAction SilentlyContinue }
}
