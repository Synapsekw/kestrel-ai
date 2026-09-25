<#
.SYNOPSIS
  Smoke test for the frozen backend (spec section 10).

.DESCRIPTION
  Starts dist/kestrel-backend/kestrel-backend.exe exactly as the Tauri sidecar does
  (APP_TOKEN / APP_PORT / APP_DATA_DIR, stdio on a pipe), then proves in one run that the bundle
  carries everything the app needs: the API answers, CUDA torch is inside, one YOLO prediction
  runs, the `worker` subcommand trains with DataLoader workers (freeze_support), ONNX export
  works, and keyring reaches Windows Credential Manager without setuptools entry points.

  Prints `geo ok 32633 <lon> <lat>`, `pointcloud ok 50000 32639 BROTLI laz 50000`, `health ok`,
  `cuda True <gpu name>`, `starter ok 3`, `library ok`, `import ok <n> images`,
  `cloud ok 50000 206`, `predict ok <n> boxes` and `worker ok`, and exits non-zero on any failure.
  Sample frames are copied out of the read-only source folder first.

.PARAMETER Keep
  Leave the generated work dir behind; it is deleted on the way out by default.

.PARAMETER WorkDir
  Run in this folder instead of a fresh one under TEMP. A folder given here is never deleted.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\smoke_frozen.ps1
#>
[CmdletBinding()]
param(
  [string] $Dist,  # defaults to <backend>/dist/kestrel-backend once $PSScriptRoot is set
  [string] $Source = "E:\Dev\Yolo\data\raw\ahmadia",
  [int] $Frames = 3,
  [int] $Imgsz = 640,
  [switch] $Keep,  # leave the generated work dir (project folder, run artefacts, ONNX) on disk
  [string] $WorkDir  # defaults to a fresh folder under $env:TEMP, which is the only one deleted
)

$ErrorActionPreference = "Stop"
# $PSScriptRoot is not set yet while parameter defaults are evaluated on PowerShell 5.1.
if (-not $Dist) { $Dist = Join-Path (Split-Path $PSScriptRoot -Parent) "dist\kestrel-backend" }
# Only a work dir this run generated is ever deleted; one the caller named is left alone.
$generatedWorkDir = -not $WorkDir
if ($generatedWorkDir) {
  $WorkDir = Join-Path $env:TEMP ("kestrel-smoke-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
}
$exe = Join-Path $Dist "kestrel-backend.exe"
if (-not (Test-Path $exe)) { throw "no frozen build at $exe; run backend\scripts\build.ps1 first" }
if (-not (Test-Path $Source)) { throw "no sample frames at $Source" }

$script:Base = $null
$script:Token = -join ((48..57 + 65..90 + 97..122) | Get-Random -Count 32 | ForEach-Object { [char]$_ })
$timings = [ordered]@{}
$total = [Diagnostics.Stopwatch]::StartNew()
$step = [Diagnostics.Stopwatch]::StartNew()

function Complete-Step([string] $Name) {
  $timings[$Name] = [math]::Round($step.Elapsed.TotalSeconds, 2)
  $step.Restart()
}

# rasterio/pyproj inside the bundle (ADR 2026-09-22): one GeoTIFF write/read and one reprojection.
$geo = & $exe geo-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $geo -notmatch "geo ok 32633") { throw "geo selftest failed: $geo" }
Write-Host ($geo.Trim().Split("`n")[-1])
Complete-Step "geo"

# Volume exports (plan 2026-09-24-volumes Task 13): reportlab, openpyxl and scipy's qhull.
$vol = & $exe volumes-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $vol -notmatch "volumes ok") { throw "volumes selftest failed: $vol" }
Write-Host ($vol.Trim().Split("`n")[-1])
Complete-Step "volumes"

# PotreeConverter + laspy/lazrs inside the bundle (ADR 2026-09-23): the real import path on a fixture.
$pc = & $exe pointcloud-selftest 2>&1 | Out-String
if ($LASTEXITCODE -ne 0 -or $pc -notmatch "pointcloud ok 50000 32639 BROTLI laz 50000") { throw "pointcloud selftest failed: $pc" }
Write-Host ($pc.Trim().Split("`n")[-1])
Complete-Step "pointcloud"

function Invoke-Api([string] $Method, [string] $Path, $Body, [int] $TimeoutSec = 900) {
  $request = @{
    Method          = $Method
    Uri             = "$script:Base/api/v1$Path"
    Headers         = @{ Authorization = "Bearer $script:Token" }
    UseBasicParsing = $true
    TimeoutSec      = $TimeoutSec
  }
  if ($null -ne $Body) {
    $request.Body = ($Body | ConvertTo-Json -Depth 8)
    $request.ContentType = "application/json"
  }
  try {
    $response = Invoke-WebRequest @request
  } catch {
    $detail = ""
    if ($_.Exception.Response) {
      $reader = New-Object IO.StreamReader($_.Exception.Response.GetResponseStream())
      $detail = ": " + $reader.ReadToEnd()
      $reader.Close()
    }
    throw "$Method $Path failed: $($_.Exception.Message)$detail"
  }
  if ($response.Content) { return ($response.Content | ConvertFrom-Json) }
  return $null
}

# $Jobs is the job collection: "/projects/<id>/jobs" for project jobs, "/library/jobs" for library
# jobs (starter acquire, import, export).
function Wait-ApiJob([string] $Jobs, [string] $JobId, [int] $TimeoutSec = 1800) {
  $deadline = (Get-Date).AddSeconds($TimeoutSec)
  while ((Get-Date) -lt $deadline) {
    $job = Invoke-Api GET "$Jobs/$JobId"
    if ($job.state -in @("succeeded", "failed", "cancelled")) { return $job }
    Start-Sleep -Milliseconds 500
  }
  throw "job $JobId did not finish within $TimeoutSec s"
}

New-Item -ItemType Directory -Force $WorkDir | Out-Null
$sample = Join-Path $WorkDir "sample"
$projectFolder = Join-Path $WorkDir "project"
New-Item -ItemType Directory -Force $sample, $projectFolder, (Join-Path $WorkDir "appdata") | Out-Null
Get-ChildItem $Source -Filter *.jpg | Sort-Object Name | Select-Object -First $Frames |
  ForEach-Object { Copy-Item $_.FullName $sample }

$env:APP_TOKEN = $script:Token
$env:APP_PORT = "0"   # the exe picks a free port and prints it as a JSON line
$env:APP_DATA_DIR = Join-Path $WorkDir "appdata"
$stdout = Join-Path $WorkDir "stdout.txt"
$stderr = Join-Path $WorkDir "stderr.txt"
$proc = Start-Process -FilePath $exe -PassThru -WindowStyle Hidden `
  -RedirectStandardOutput $stdout -RedirectStandardError $stderr

try {
  # 1. startup: the JSON line the Tauri launcher reads off the sidecar's stdout
  $port = $null
  $deadline = (Get-Date).AddSeconds(30)
  while ((Get-Date) -lt $deadline -and -not $port) {
    if ($proc.HasExited) { throw "the exe exited with code $($proc.ExitCode); stderr:`n$(Get-Content $stderr -Raw)" }
    $line = Get-Content $stdout -ErrorAction SilentlyContinue | Where-Object { $_ -match '"port":\s*(\d+)' }
    if ($line) { $port = [int]$Matches[1] }
    Start-Sleep -Milliseconds 100
  }
  if (-not $port) { throw "the exe printed no startup JSON line within 30 s" }
  $script:Base = "http://127.0.0.1:$port"
  Complete-Step "startup_line"
  Write-Host "startup ok port $port pid $($proc.Id)"

  # 2. health within 20 s
  $health = $null
  $deadline = (Get-Date).AddSeconds(20)
  while ((Get-Date) -lt $deadline -and -not $health) {
    try { $health = Invoke-Api GET "/health" -TimeoutSec 5 } catch { Start-Sleep -Milliseconds 200 }
  }
  if (-not $health) { throw "health did not answer within 20 s" }
  Complete-Step "health"
  Write-Host "health ok"

  # 3. the gpu block is filled by a background probe, so poll until it appears
  $deadline = (Get-Date).AddSeconds(90)
  while ((Get-Date) -lt $deadline -and -not $health.gpu) {
    Start-Sleep -Milliseconds 250
    $health = Invoke-Api GET "/health"
  }
  if (-not $health.gpu) { throw "the gpu probe produced no answer within 90 s" }
  if (-not $health.gpu.available) { throw "cuda False: the frozen build cannot see the GPU" }
  Complete-Step "cuda"
  Write-Host "cuda $($health.gpu.available) $($health.gpu.name)"

  # 4. starter weights (usability gap G1): the three bundled sizes must be available
  $starters = Invoke-Api GET "/starter-models"
  $available = @($starters.items | Where-Object { $_.available })
  if ($available.Count -ne 3) {
    throw "expected 3 available starter models, found $($available.Count): $($starters.items | ConvertTo-Json -Compress)"
  }
  Complete-Step "starter_models"
  Write-Host "starter ok $($available.Count)"

  # 4b. the app-wide model library opened: its migrations are inside the bundle
  $library = Invoke-Api GET "/library/status"
  if (-not $library.available) { throw "the model library did not open: $($library.error)" }
  Complete-Step "library"
  Write-Host "library ok $($library.root)"

  # 5. project, import, weights
  $names = @("excavator", "wheel_loader", "bulldozer", "dump_truck", "crane", "concrete_mixer", "roller", "backhoe")
  $colours = @("#f97316", "#eab308", "#22c55e", "#06b6d4", "#3b82f6", "#a855f7", "#ec4899", "#ef4444")
  $classes = 0..7 | ForEach-Object { @{ name = $names[$_]; colour = $colours[$_]; hotkey = "$($_ + 1)" } }
  $project = Invoke-Api POST "/projects" @{ name = "Frozen smoke"; folder = $projectFolder; classes = $classes; kind = "train" }
  $pid1 = $project.id
  Complete-Step "create_project"

  $imported = Invoke-Api POST "/projects/$pid1/sources" @{ folder = $sample; site = "ahmadia" }
  $job = Wait-ApiJob "/projects/$pid1/jobs" $imported.job.id
  if ($job.state -ne "succeeded") { throw "import failed: $($job.error)" }
  $stats = Invoke-Api GET "/projects/$pid1/stats"
  if ($stats.image_count -ne $Frames) { throw "imported $($stats.image_count) images, expected $Frames" }
  Complete-Step "import"
  Write-Host "import ok $($stats.image_count) images"

  # 5b. a point cloud through the API: import in a detection project, then a Range read of its octree
  $cloudsFolder = Join-Path $WorkDir "clouds-project"
  New-Item -ItemType Directory -Force $cloudsFolder | Out-Null
  $fixture = Join-Path $WorkDir "fixture.laz"
  $written = & $exe pointcloud-selftest --write-fixture $fixture 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0) { throw "could not write the point-cloud fixture: $written" }
  $pcProject = Invoke-Api POST "/projects" @{ name = "Frozen smoke clouds"; folder = $cloudsFolder; classes = $classes; kind = "detect" }
  $created = Invoke-Api POST "/projects/$($pcProject.id)/pointclouds" @{ path = $fixture }
  $job = Wait-ApiJob "/projects/$($pcProject.id)/jobs" $created.job.id
  if ($job.state -ne "succeeded") { throw "point-cloud import failed: $($job.error)" }
  $cloud = Invoke-Api GET "/projects/$($pcProject.id)/pointclouds/$($created.cloud.id)"
  if ($cloud.status -ne "ready" -or $cloud.point_count -ne 50000) { throw "cloud not ready: $($cloud | ConvertTo-Json -Compress)" }
  # PowerShell 5.1 refuses a Range header in -Headers; HttpWebRequest.AddRange sets it properly.
  $rangeUrl = "$script:Base/api/v1/projects/$($pcProject.id)/pointclouds/$($cloud.id)/octree/hierarchy.bin"
  $req = [System.Net.HttpWebRequest]::Create($rangeUrl)
  $req.Headers.Add("Authorization", "Bearer $script:Token")
  $req.AddRange(0, 21)
  $resp = $req.GetResponse()
  $stream = $resp.GetResponseStream(); $buffer = New-Object byte[] 64; $read = 0
  while (($n = $stream.Read($buffer, $read, $buffer.Length - $read)) -gt 0) { $read += $n }
  $status = [int]$resp.StatusCode; $resp.Close()
  if ($status -ne 206 -or $read -ne 22) { throw "octree Range read gave $status with $read bytes" }
  Complete-Step "pointcloud_api"
  Write-Host "cloud ok $($cloud.point_count) $status"

  $acquire = Invoke-Api POST "/library/starters/yolo11n/acquire" @{}
  $job = Wait-ApiJob "/library/jobs" $acquire.job.id
  if ($job.state -ne "succeeded") { throw "starter acquire failed: $($job.error)" }
  $model = Invoke-Api GET "/library/models/$($job.result.model_id)"
  if ($model.class_aliases.truck -ne "dump_truck") {
    throw "expected truck aliased to dump_truck, got $($model.class_aliases | ConvertTo-Json -Compress)"
  }
  Complete-Step "import_model"
  Write-Host "model ok $($model.name) $($model.class_names.Count) classes"
  Write-Host "alias ok"

  # 6. one prediction through the packaged torch/ultralytics stack
  $images = Invoke-Api GET "/projects/$pid1/images?limit=$Frames&sort=path"
  $first = $images.items[0]
  $predicted = Invoke-Api POST "/projects/$pid1/images/$($first.id)/preannotate" `
    @{ model_id = $model.id; imgsz = $Imgsz; conf = 0.05 }
  Complete-Step "predict"
  Write-Host "predict ok $($predicted.items.Count) boxes"

  # 7. a dataset and a 1-epoch run: the `worker` subcommand with DataLoader workers
  foreach ($image in $images.items) {
    Invoke-Api POST "/projects/$pid1/images/$($image.id)/boxes" `
      @{ class_id = $project.classes[0].id; x = 400; y = 600; w = 180; h = 120 } | Out-Null
  }
  $dataset = Invoke-Api POST "/projects/$pid1/datasets" `
    @{ name = "v1"; split_method = "random"; val_fraction = 0.34; seed = 42 }
  $job = Wait-ApiJob "/projects/$pid1/jobs" $dataset.job.id
  if ($job.state -ne "succeeded") { throw "dataset failed: $($job.error)" }
  $frozen = Invoke-Api GET "/projects/$pid1/datasets/$($dataset.dataset.id)"
  Complete-Step "dataset"
  Write-Host "dataset ok train $($frozen.train_count) val $($frozen.val_count)"

  $training = Invoke-Api POST "/projects/$pid1/train" @{
    name = "smoke"; dataset_id = $frozen.id; base_model_id = $model.id
    epochs = 1; imgsz = $Imgsz; batch = 2; patience = 5; augmentation = "aerial"; device = "0"
  }
  $job = Wait-ApiJob "/projects/$pid1/jobs" $training.job.id
  if ($job.state -ne "succeeded") {
    $log = Invoke-Api GET "/projects/$pid1/jobs/$($training.job.id)/log?tail=40"
    throw "training failed: $($job.error)`n$($log.lines -join "`n")"
  }
  $trained = Invoke-Api GET "/library/models/$($job.result.model_id)"
  Complete-Step "worker_train"
  Write-Host "worker ok mAP50 $([math]::Round($trained.metrics.map50, 4))"

  $fontSeeded = Test-Path (Join-Path $env:APP_DATA_DIR "ultralytics\Arial.ttf")
  if (-not $fontSeeded) { throw "the worker did not seed Arial.ttf into the app data config dir" }
  Write-Host "font ok $($env:APP_DATA_DIR)\ultralytics\Arial.ttf"

  # 8. ONNX export, again through the frozen worker
  $export = Invoke-Api POST "/library/models/$($trained.id)/export" @{ format = "onnx"; imgsz = $Imgsz }
  $job = Wait-ApiJob "/library/jobs" $export.job.id
  if ($job.state -ne "succeeded") { throw "export failed: $($job.error)" }
  $trained = Invoke-Api GET "/library/models/$($trained.id)"
  # exports are relative to the model's own folder, `<library>/models/<slug>-<id8>/`
  $modelDir = Get-ChildItem (Join-Path $library.root "models") -Directory -Filter "*-$($trained.id.Substring(0, 8))" |
    Select-Object -First 1
  if (-not $modelDir) { throw "no library folder for model $($trained.id) under $($library.root)" }
  $onnx = Join-Path $modelDir.FullName $trained.exports.onnx
  Complete-Step "export_onnx"
  Write-Host "export ok $onnx $([math]::Round((Get-Item $onnx).Length / 1MB, 1)) MB"

  # 9. keyring: the frozen build has no entry points, so the Windows backend must be pinned.
  #    A key that is already stored belongs to the operator and is never touched.
  $providers = (Invoke-Api GET "/providers").items
  $anthropic = $providers | Where-Object { $_.name -eq "anthropic" }
  if ($anthropic.has_key) {
    Write-Host "keyring skip (a key is already stored for anthropic; not touching it)"
  } else {
    Invoke-Api PUT "/providers/anthropic/key" @{ api_key = "frozen-smoke-placeholder-not-a-key" } | Out-Null
    $after = (Invoke-Api GET "/providers").items | Where-Object { $_.name -eq "anthropic" }
    Invoke-Api DELETE "/providers/anthropic/key" | Out-Null
    $cleared = (Invoke-Api GET "/providers").items | Where-Object { $_.name -eq "anthropic" }
    if (-not $after.has_key) { throw "keyring stored nothing: the Windows backend is not in the bundle" }
    if ($cleared.has_key) { throw "keyring did not delete the placeholder" }
    Write-Host "keyring ok (stored and removed a placeholder through Credential Manager)"
  }
  Complete-Step "keyring"

  $timings["total"] = [math]::Round($total.Elapsed.TotalSeconds, 2)
  $bytes = (Get-ChildItem $Dist -Recurse -File | Measure-Object -Sum Length).Sum
  Write-Host ""
  Write-Host ("bundle: {0:N1} MB at {1}" -f ($bytes / 1MB), $Dist)
  Write-Host "timings (s): $(($timings.GetEnumerator() | ForEach-Object { "$($_.Key)=$($_.Value)" }) -join ' ')"
  Write-Host "smoke ok"
} finally {
  if (-not $proc.HasExited) {
    # /T: a training run may still own worker children of our own process tree
    & taskkill /T /F /PID $proc.Id 2>&1 | Out-Null
    $proc.WaitForExit(10000) | Out-Null
  }
  if ($Keep -or -not $generatedWorkDir) {
    Write-Host "work dir kept: $WorkDir"
  } else {
    # A run leaves a project folder, training run folders, weights and a 10 MB ONNX behind.
    Remove-Item $WorkDir -Recurse -Force -ErrorAction SilentlyContinue
    if (Test-Path $WorkDir) {
      Write-Host "work dir could not be removed: $WorkDir"
    } else {
      Write-Host "work dir removed: $WorkDir (pass -Keep to inspect it)"
    }
  }
}
