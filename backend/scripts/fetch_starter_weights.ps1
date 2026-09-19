<#
.SYNOPSIS
  Fills backend/starter_weights/ with yolo11n.pt, yolo11s.pt and yolo11m.pt (usability gap G1).

.DESCRIPTION
  For each of the three sizes: skip when backend\starter_weights\<key>.pt already exists and is
  larger than 1 MB; else copy it from E:\Dev\Yolo\models\<key>.pt when that file exists; else
  download the Ultralytics release asset with Invoke-WebRequest into a .part file and rename it
  on success. Prints one line per file (present/copied/downloaded) with its size, and exits 1 if
  any file is missing or smaller than 1 MB once all three have been handled.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_starter_weights.ps1
#>
$ErrorActionPreference = "Stop"

$backend = Split-Path $PSScriptRoot -Parent
$dest = Join-Path $backend "starter_weights"
New-Item -ItemType Directory -Force $dest | Out-Null

$keys = @("yolo11n", "yolo11s", "yolo11m")
$sourceDir = "E:\Dev\Yolo\models"
$releaseUrl = "https://github.com/ultralytics/assets/releases/download/v8.3.0"
$minBytes = 1MB

function Get-SizeMb([string] $path) {
  return [math]::Round((Get-Item $path).Length / 1MB, 1)
}

foreach ($key in $keys) {
  $target = Join-Path $dest "$key.pt"

  if ((Test-Path $target) -and (Get-Item $target).Length -gt $minBytes) {
    Write-Host "present $key.pt ($(Get-SizeMb $target) MB)"
    continue
  }

  $source = Join-Path $sourceDir "$key.pt"
  if (Test-Path $source) {
    Copy-Item $source $target -Force
    Write-Host "copied $key.pt ($(Get-SizeMb $target) MB)"
    continue
  }

  $part = "$target.part"
  Invoke-WebRequest -Uri "$releaseUrl/$key.pt" -OutFile $part
  Move-Item $part $target -Force
  Write-Host "downloaded $key.pt ($(Get-SizeMb $target) MB)"
}

$missing = @()
foreach ($key in $keys) {
  $target = Join-Path $dest "$key.pt"
  if (-not (Test-Path $target) -or (Get-Item $target).Length -le $minBytes) {
    $missing += "$key.pt"
  }
}
if ($missing.Count -gt 0) {
  Write-Error "missing or too small: $($missing -join ', ')"
  exit 1
}
