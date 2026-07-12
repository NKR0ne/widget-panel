; Inno Setup script for qt-panel.
; Build the deployed app first:  build.ps1 -Deploy   (produces build\nmake-release with the
; Qt runtime, qml/, and helpers\). Then compile this with ISCC:
;   "C:\Program Files (x86)\Inno Setup 6\ISCC.exe" installer\qt-panel.iss
; Output: installer\Output\qt-panel-setup.exe

#define AppName "Widget Panel"
#define AppVersion "1.0.0"
#define AppExe "qt-panel.exe"
#define SrcDir "..\build\nmake-release"

[Setup]
AppId={{A7E3D2C1-9F4B-4E8A-B2C6-1D5E9F0A3B77}
AppName={#AppName}
AppVersion={#AppVersion}
AppPublisher=nicolas
DefaultDirName={autopf}\WidgetPanel
DefaultGroupName={#AppName}
DisableProgramGroupPage=yes
OutputBaseFilename=qt-panel-setup
Compression=lzma2
SolidCompression=yes
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible
WizardStyle=modern
PrivilegesRequired=lowest

[Tasks]
Name: "desktopicon"; Description: "Créer un raccourci sur le bureau"; Flags: unchecked
Name: "autostart"; Description: "Lancer au démarrage de Windows"; Flags: unchecked

[Files]
; Whole deployed tree (exe + Qt DLLs + qml/ + plugins + helpers\).
Source: "{#SrcDir}\*"; DestDir: "{app}"; Flags: recursesubdirs createallsubdirs ignoreversion

[Icons]
Name: "{group}\{#AppName}"; Filename: "{app}\{#AppExe}"
Name: "{autodesktop}\{#AppName}"; Filename: "{app}\{#AppExe}"; Tasks: desktopicon

[Registry]
; Optional autostart (per-user Run key — matches the app's own autostart setting).
Root: HKCU; Subkey: "Software\Microsoft\Windows\CurrentVersion\Run"; \
  ValueType: string; ValueName: "qt-panel"; ValueData: """{app}\{#AppExe}"""; \
  Flags: uninsdeletevalue; Tasks: autostart

[Run]
Filename: "{app}\{#AppExe}"; Description: "Lancer {#AppName}"; \
  Flags: nowait postinstall skipifsilent
