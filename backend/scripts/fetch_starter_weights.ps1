<#
.SYNOPSIS
  Fills backend/starter_weights/ with yolo11n.pt, yolo11s.pt and yolo11m.pt (usability gap G1).

.DESCRIPTION
  For each of the three sizes: skip when the destination already has <key>.pt larger than 1 MB;
  else copy it from E:\Dev\Yolo\models\<key>.pt when that file exists there; else download the
  Ultralytics release asset with Invoke-WebRequest into a .part file and rename it on success.
  Whatever its origin, every file's SHA-256 is checked against the pinned value in $sha256 below;
  a mismatch deletes the file, prints the expected and actual hashes, and exits 1 immediately, so
  a corrupted download or a wrong local copy is never silently used as a base model. Prints one
  line per file (present/copied/downloaded, with its size and "sha256 ok"), and exits 1 if any
  file is missing or smaller than 1 MB once all three have been handled.

.PARAMETER Destination
  Folder to fill; defaults to backend/starter_weights next to this script. Point it at a scratch
  folder to prove the checksum-mismatch path without touching the real files.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_starter_weights.ps1
#>
[CmdletBinding()]
param(
  [string] $Destination
)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"

$backend = Split-Path $PSScriptRoot -Parent
if (-not $Destination) { $Destination = Join-Path $backend "starter_weights" }
New-Item -ItemType Directory -Force $Destination | Out-Null

$keys = @("yolo11n", "yolo11s", "yolo11m")
$sourceDir = "E:\Dev\Yolo\models"
$releaseUrl = "https://github.com/ultralytics/assets/releases/download/v8.3.0"
$minBytes = 1MB

# Pinned against the files this project has used since phase 1 (yolo11n/yolo11m, copied from
# E:\Dev\Yolo\models) and the official v8.3.0 release asset fetched over HTTPS (yolo11s).
$sha256 = @{
  yolo11n = "0EBBC80D4A7680D14987A577CD21342B65ECFD94632BD9A8DA63AE6417644EE1"
  yolo11s = "85A76FE86DD8AFE384648546B56A7A78580C7CB7B404FC595F97969322D502D5"
  yolo11m = "D5FFC1A674953A08E11A8D21E022781B1B23A19B730AFC309290BD9FB5305B95"
}

function Get-SizeMb([string] $path) {
  return [math]::Round((Get-Item $path).Length / 1MB, 1)
}

# Deletes $path and exits 1 on a mismatch, so a caller never sees "present"/"copied"/"downloaded"
# printed for a file that turned out not to be trustworthy.
function Assert-Checksum([string] $key, [string] $path) {
  $actual = (Get-FileHash -Algorithm SHA256 $path).Hash
  $expected = $sha256[$key]
  if ($actual -ne $expected) {
    Remove-Item $path -Force
    Write-Error "$key.pt failed SHA-256 verification: expected $expected, got $actual (file removed)"
    exit 1
  }
}

foreach ($key in $keys) {
  $target = Join-Path $Destination "$key.pt"

  if ((Test-Path $target) -and (Get-Item $target).Length -gt $minBytes) {
    Assert-Checksum $key $target
    Write-Host "present $key.pt ($(Get-SizeMb $target) MB, sha256 ok)"
    continue
  }

  $source = Join-Path $sourceDir "$key.pt"
  if (Test-Path $source) {
    Copy-Item $source $target -Force
    Assert-Checksum $key $target
    Write-Host "copied $key.pt ($(Get-SizeMb $target) MB, sha256 ok)"
    continue
  }

  $part = "$target.part"
  Invoke-WebRequest -Uri "$releaseUrl/$key.pt" -OutFile $part -UseBasicParsing
  Move-Item $part $target -Force
  Assert-Checksum $key $target
  Write-Host "downloaded $key.pt ($(Get-SizeMb $target) MB, sha256 ok)"
}

$missing = @()
foreach ($key in $keys) {
  $target = Join-Path $Destination "$key.pt"
  if (-not (Test-Path $target) -or (Get-Item $target).Length -le $minBytes) {
    $missing += "$key.pt"
  }
}
if ($missing.Count -gt 0) {
  Write-Error "missing or too small: $($missing -join ', ')"
  exit 1
}
