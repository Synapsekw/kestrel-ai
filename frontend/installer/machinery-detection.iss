; Inno Setup script for the Machinery Detection installer (spec section 10).
;
; Tauri's own bundlers cannot carry this app: the frozen backend is a 3.4 GB one-folder PyInstaller
; build, and both NSIS (32-bit payload offsets) and the WiX template (one embedded cabinet) stop at
; 2 GB. Inno Setup 6 has no such limit. See docs/progress.md, "S6 packaging evidence".
;
; Compiled by frontend/scripts/build-installer.ps1, which passes the version in with /DAppVersion.
; Every path below is relative to this file's folder, which is Inno's default SourceDir.

#define AppName "Machinery Detection"
#define AppPublisher "Synapse Solutions"
#ifndef AppVersion
  #define AppVersion "0.0.0"
#endif

#define AppExe "..\src-tauri\target\release\machinery-app.exe"
#define SidecarExe "..\src-tauri\binaries\machinery-backend-x86_64-pc-windows-msvc.exe"
#define InternalDir "..\src-tauri\binaries\_internal"
#define IconFile "..\src-tauri\icons\icon.ico"
#define OutputDir "..\src-tauri\target\release\bundle\inno"

; Shipped only when the build script found a copy; the runtime is present on Windows 11 anyway.
#define WebView2Setup "MicrosoftEdgeWebview2Setup.exe"
#define HaveWebView2Setup FileExists(AddBackslash(SourcePath) + WebView2Setup)

[Setup]
AppId={{B7E0B1F4-4C2E-4D6D-9C3A-2F5E6A1D9C77}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher={#AppPublisher}
VersionInfoVersion={#AppVersion}
; Per user: no administrator rights and no shared install directory.
PrivilegesRequired=lowest
DefaultDirName={localappdata}\Programs\Machinery Detection
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
; The install location is fixed because uninstall removes {app} whole: an operator who pointed
; the install at an existing folder would lose whatever else was in it.
DisableDirPage=yes
UsePreviousAppDir=yes
; x64os, not x64compatible: ARM64 Windows runs x64 code under emulation, where the CUDA sidecar
; cannot work, so the install would succeed and the app would die on the first torch import.
ArchitecturesAllowed=x64os
ArchitecturesInstallIn64BitMode=x64os
OutputDir={#OutputDir}
OutputBaseFilename=Machinery Detection_{#AppVersion}_x64-setup
Compression=lzma2/max
SolidCompression=yes
WizardStyle=modern
SetupIconFile={#IconFile}
UninstallDisplayName={#AppName}
UninstallDisplayIcon={app}\machinery-app.exe

[Files]
; The sidecar exe and its `_internal` folder must land beside machinery-app.exe: the shell plugin
; resolves a sidecar as `<folder of the running exe>\<name>.exe`, and a PyInstaller one-folder
; build loads `_internal` from beside its own exe. The target triple is only part of the file name
; in the source slot, which is why the sidecar is renamed on the way in - exactly what the Tauri
; CLI does when it stages `target\release\machinery-backend.exe`.
Source: "{#AppExe}"; DestDir: "{app}"; Flags: ignoreversion
Source: "{#SidecarExe}"; DestDir: "{app}"; DestName: "machinery-backend.exe"; Flags: ignoreversion
Source: "{#InternalDir}\*"; DestDir: "{app}\_internal"; Flags: ignoreversion recursesubdirs createallsubdirs
#if HaveWebView2Setup
Source: "{#WebView2Setup}"; DestDir: "{tmp}"; Flags: deleteafterinstall
#endif

[Icons]
Name: "{autoprograms}\{#AppName}"; Filename: "{app}\machinery-app.exe"

#if HaveWebView2Setup
[Run]
Filename: "{tmp}\{#WebView2Setup}"; Parameters: "/silent /install"; \
  StatusMsg: "Installing the WebView2 runtime..."; Check: NeedsWebView2
#endif

[UninstallDelete]
; Leave the install directory empty of leftovers. Per-user app data (logs, recent projects,
; settings, the Ultralytics config dir) lives under %APPDATA% and is deliberately kept, as are the
; operator's project folders.
Type: filesandordirs; Name: "{app}"

[Code]
const
  WebView2Client = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}';

function HasVersion(RootKey: Integer; SubKey: String): Boolean;
var
  Version: String;
begin
  Result := RegQueryStringValue(RootKey, SubKey, 'pv', Version) and (Version <> '') and
    (Version <> '0.0.0.0');
end;

{ The Evergreen runtime registers itself per machine (32-bit view on x64) or per user. }
function WebView2Installed: Boolean;
begin
  Result :=
    HasVersion(HKEY_LOCAL_MACHINE, 'SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\' + WebView2Client) or
    HasVersion(HKEY_LOCAL_MACHINE, 'SOFTWARE\Microsoft\EdgeUpdate\Clients\' + WebView2Client) or
    HasVersion(HKEY_CURRENT_USER, 'Software\Microsoft\EdgeUpdate\Clients\' + WebView2Client);
end;

function NeedsWebView2: Boolean;
begin
  Result := not WebView2Installed;
end;
