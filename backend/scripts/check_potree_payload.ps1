<#
.SYNOPSIS
  Fails unless every file MANIFEST.json lists is present in a PotreeConverter payload folder.
.DESCRIPTION
  Used by build.ps1 twice: on backend\third_party\potreeconverter before PyInstaller runs, and on
  dist\kestrel-backend\_internal\potreeconverter after it (spec §14). A missing MSVC DLL would
  otherwise go unnoticed on the build machine, which has the runtime installed system-wide.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Dir)
$ErrorActionPreference = "Stop"
$manifest = Join-Path $Dir "MANIFEST.json"
if (-not (Test-Path $manifest)) {
  throw "no PotreeConverter payload at ${Dir}: run backend\scripts\fetch_potreeconverter.ps1"
}
$m = Get-Content $manifest -Raw | ConvertFrom-Json
$missing = @()
foreach ($f in $m.files) {
  if (-not (Test-Path (Join-Path $Dir $f.name))) { $missing += $f.name }
}
if ($missing.Count -gt 0) {
  throw "the PotreeConverter payload at $Dir is missing: $($missing -join ', ') (run backend\scripts\fetch_potreeconverter.ps1)"
}
Write-Host "potreeconverter payload ok: $($m.files.Count) files, version $($m.converter_version)"
