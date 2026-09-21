<# Read the actual app/setup PE icon resources as Windows sees them, without launching setup. #>
param(
  [Parameter(Mandatory = $true)][string] $AppExe,
  [Parameter(Mandatory = $true)][string] $SetupExe,
  [string] $OutputDirectory = $PSScriptRoot,
  [switch] $RefreshShell
)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class KestrelIconEvidence {
  [DllImport("shell32.dll", CharSet=CharSet.Unicode)]
  public static extern uint ExtractIconEx(string file, int index, IntPtr[] large, IntPtr[] small, uint count);
  [DllImport("user32.dll")]
  public static extern bool DestroyIcon(IntPtr icon);
  [DllImport("shell32.dll")]
  public static extern void SHChangeNotify(uint eventId, uint flags, IntPtr item1, IntPtr item2);
}
'@
New-Item -ItemType Directory -Path $OutputDirectory -Force | Out-Null
foreach ($entry in @(@{ Name = 'installed-app'; Path = $AppExe }, @{ Name = 'installer'; Path = $SetupExe })) {
  $resolved = (Resolve-Path -LiteralPath $entry.Path).Path
  $large = New-Object IntPtr[] 1
  $small = New-Object IntPtr[] 1
  $count = [KestrelIconEvidence]::ExtractIconEx($resolved, 0, $large, $small, 1)
  # ExtractIconEx counts both returned sizes: one large + one small is two icons.
  if ($count -eq 0 -or $large[0] -eq [IntPtr]::Zero -or $small[0] -eq [IntPtr]::Zero) {
    throw "Native extraction count $count; large=$($large[0]), small=$($small[0]); $resolved"
  }
  try {
    foreach ($variant in @(@{ Name = 'large'; Handle = $large[0] }, @{ Name = 'small'; Handle = $small[0] })) {
      $icon = [System.Drawing.Icon]::FromHandle($variant.Handle)
      $bitmap = $icon.ToBitmap()
      try {
        $destination = Join-Path $OutputDirectory "$($entry.Name)-$($variant.Name).png"
        $bitmap.Save($destination, [System.Drawing.Imaging.ImageFormat]::Png)
        Write-Output "$($entry.Name) $($variant.Name): $($bitmap.Width)x$($bitmap.Height) -> $destination"
      } finally { $bitmap.Dispose() }
    }
  } finally {
    if ($large[0] -ne [IntPtr]::Zero) { [KestrelIconEvidence]::DestroyIcon($large[0]) | Out-Null }
    if ($small[0] -ne [IntPtr]::Zero) { [KestrelIconEvidence]::DestroyIcon($small[0]) | Out-Null }
  }
}
if ($RefreshShell) {
  [KestrelIconEvidence]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)
  Write-Output 'Windows notified that application icons changed.'
}
