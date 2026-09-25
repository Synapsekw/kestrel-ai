<#
.SYNOPSIS
  Fills backend/third_party/potreeconverter/ with PotreeConverter 2.1.5, its laszip.dll, its
  licence texts and the MSVC runtime DLLs it needs (spec §14).

.DESCRIPTION
  1. Takes the release zip from -Zip, else downloads the pinned GitHub release asset; either way
     its SHA-256 must equal the pinned value.
  2. Extracts PotreeConverter.exe, laszip.dll and licenses/ (resources/ is only for
     --generate-page and is not taken).
  3. Copies msvcp140.dll, msvcp140_atomic_wait.dll, vcruntime140.dll and vcruntime140_1.dll from
     -CrtDir, else from the newest VC\Redist\MSVC\*\x64\Microsoft.VC14*.CRT of any installed Visual
     Studio / Build Tools.
  4. Runs dumpbin /dependents on the exe and laszip.dll: every import must be in the folder or a
     Windows system DLL.
  5. Runs `PotreeConverter.exe --help` from the folder. DLLs next to an exe load before System32,
     so a redist older than the converter's toolset fails here, not on the operator's machine.
  6. Writes MANIFEST.json (name, size, sha256 per file, converter version).

.PARAMETER Zip
  A local copy of PotreeConverter_2.1.5_x64_windows.zip (checked against the same SHA-256).

.PARAMETER CrtDir
  A folder holding the four MSVC DLLs, when auto-detection picks the wrong redist.

.EXAMPLE
  powershell -ExecutionPolicy Bypass -File backend\scripts\fetch_potreeconverter.ps1
#>
[CmdletBinding()]
param([string] $Zip, [string] $CrtDir, [string] $Destination)

$ErrorActionPreference = "Stop"
$ProgressPreference = "SilentlyContinue"
$version = "2.1.5"
$url = "https://github.com/potree/PotreeConverter/releases/download/$version/PotreeConverter_${version}_x64_windows.zip"
$sha256 = "A05BC3A936E41705649DC41B9AE4300EE5273ED23A3F1845E94690CA142E6248"
$crtNames = @("msvcp140.dll", "msvcp140_atomic_wait.dll", "vcruntime140.dll", "vcruntime140_1.dll")
$systemDll = '^(api-ms-win-|ext-ms-win-)|^(kernel32|user32|advapi32|shell32|ole32|oleaut32|ws2_32|bcrypt|ntdll|ucrtbase|gdi32|shlwapi|rpcrt4|version|winmm|psapi|dbghelp|comdlg32|secur32|crypt32)\.dll$'

$backend = Split-Path $PSScriptRoot -Parent
if (-not $Destination) { $Destination = Join-Path $backend "third_party\potreeconverter" }
$tmp = Join-Path $env:TEMP ("kestrel-potree-" + [guid]::NewGuid().ToString("N").Substring(0, 8))
New-Item -ItemType Directory -Force $tmp | Out-Null

function Find-VsFile([string] $pattern) {
  $roots = @("${env:ProgramFiles(x86)}\Microsoft Visual Studio", "$env:ProgramFiles\Microsoft Visual Studio") |
    Where-Object { $_ -and (Test-Path $_) }
  $hits = foreach ($r in $roots) { Get-ChildItem -Path (Join-Path $r $pattern) -ErrorAction SilentlyContinue }
  # newest toolset first: the version folder is the one right after MSVC\
  $hits | Sort-Object { $v = ($_.FullName -split '\\MSVC\\')[1].Split('\')[0]; try { [version]$v } catch { [version]"0.0" } } -Descending |
    Select-Object -First 1
}

try {
  # 1. the zip
  $zipPath = Join-Path $tmp "potree.zip"
  if ($Zip) { Copy-Item $Zip $zipPath } else { Invoke-WebRequest -Uri $url -OutFile $zipPath -UseBasicParsing }
  $actual = (Get-FileHash -Algorithm SHA256 $zipPath).Hash
  if ($actual -ne $sha256) { throw "PotreeConverter zip SHA-256 mismatch: expected $sha256, got $actual" }
  Write-Host "zip ok ($actual)"

  # 2. extract
  Expand-Archive -Path $zipPath -DestinationPath (Join-Path $tmp "x")
  $exe = Get-ChildItem (Join-Path $tmp "x") -Recurse -Filter PotreeConverter.exe | Select-Object -First 1
  if (-not $exe) { throw "the zip holds no PotreeConverter.exe" }
  $src = $exe.Directory.FullName
  if (Test-Path $Destination) { Remove-Item $Destination -Recurse -Force }
  New-Item -ItemType Directory -Force $Destination | Out-Null
  Copy-Item (Join-Path $src "PotreeConverter.exe"), (Join-Path $src "laszip.dll") $Destination
  Copy-Item (Join-Path $src "licenses") (Join-Path $Destination "licenses") -Recurse

  # 3. MSVC runtime
  if (-not $CrtDir) {
    $crt = Find-VsFile "*\*\VC\Redist\MSVC\*\x64\Microsoft.VC14*.CRT"
    if (-not $crt) { throw "no MSVC redist found; install the Visual Studio Build Tools or pass -CrtDir" }
    $CrtDir = $crt.FullName
  }
  foreach ($n in $crtNames) {
    $p = Join-Path $CrtDir $n
    if (-not (Test-Path $p)) { throw "$n is not in $CrtDir" }
    Copy-Item $p $Destination
  }
  Write-Host "msvc runtime from $CrtDir"

  # 4. dependency closure
  $dumpbin = Find-VsFile "*\*\VC\Tools\MSVC\*\bin\Hostx64\x64\dumpbin.exe"
  if (-not $dumpbin) { throw "dumpbin.exe not found; install the Visual Studio Build Tools (C++ workload)" }
  $local = @(Get-ChildItem $Destination -Filter *.dll | ForEach-Object { $_.Name.ToLower() })
  foreach ($bin in @("PotreeConverter.exe", "laszip.dll")) {
    $deps = & $dumpbin.FullName /nologo /dependents (Join-Path $Destination $bin) |
      ForEach-Object { $_.Trim() } | Where-Object { $_ -match '\.dll$' -and $_ -notmatch '^Dump of' }
    foreach ($d in $deps) {
      $name = $d.ToLower()
      if ($local -notcontains $name -and $name -notmatch $systemDll) {
        throw "$bin imports $d, which is neither in $Destination nor a Windows system DLL"
      }
    }
    Write-Host "closure ok: $bin ($($deps.Count) imports)"
  }

  # 5. it loads with the bundled DLLs
  $help = & (Join-Path $Destination "PotreeConverter.exe") --help 2>&1 | Out-String
  if ($LASTEXITCODE -ne 0 -or $help -notmatch "--encoding") {
    throw "PotreeConverter.exe --help failed with the bundled runtime (exit $LASTEXITCODE). A redist older than the converter's toolset shows up here: pass -CrtDir with a newer Microsoft.VC14x.CRT. Output:`n$help"
  }
  Write-Host "load ok"

  # 6. manifest
  $files = Get-ChildItem $Destination -Recurse -File | Where-Object { $_.Name -ne "MANIFEST.json" } | Sort-Object FullName |
    ForEach-Object {
      [ordered]@{
        name   = $_.FullName.Substring($Destination.Length + 1).Replace('\', '/')
        size   = $_.Length
        sha256 = (Get-FileHash -Algorithm SHA256 $_.FullName).Hash.ToLower()
      }
    }
  $manifest = [ordered]@{ converter_version = $version; files = @($files) }
  $manifest | ConvertTo-Json -Depth 4 | Set-Content -Encoding utf8 (Join-Path $Destination "MANIFEST.json")
  Write-Host "manifest ok: $(@($files).Count) files in $Destination"
} finally {
  Remove-Item $tmp -Recurse -Force -ErrorAction SilentlyContinue
}
