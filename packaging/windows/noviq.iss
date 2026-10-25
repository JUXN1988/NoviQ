; Instalador de NoviQ para Windows (Inno Setup 6)
#define MyAppName "NoviQ"
#define MyAppVersion "4.2.0"
#define MyAppPublisher "NoviQ Labs"
#define MyAppURL "https://github.com/JUXN1988/noviark"
#define MyAppExeName "NoviQ.exe"

[Setup]
AppId={{8F1C2A4E-6B3D-4E8A-9C71-5D2F0B9A7E13}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\NoviQ
DefaultGroupName=NoviQ
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE.md
OutputDir=..\..\dist
OutputBaseFilename=NoviQ-Setup-Windows
SetupIconFile=..\..\static\noviq.ico
UninstallDisplayIcon={app}\{#MyAppExeName}
Compression=lzma2/ultra
SolidCompression=yes
WizardStyle=modern
PrivilegesRequired=lowest
PrivilegesRequiredOverridesAllowed=dialog
ArchitecturesAllowed=x64compatible
ArchitecturesInstallIn64BitMode=x64compatible

[Languages]
Name: "spanish"; MessagesFile: "compiler:Languages\Spanish.isl"
Name: "english"; MessagesFile: "compiler:Default.isl"

[Tasks]
Name: "desktopicon"; Description: "{cm:CreateDesktopIcon}"; GroupDescription: "{cm:AdditionalIcons}"
Name: "startup"; Description: "Iniciar NoviQ con Windows (para las tareas programadas)"; GroupDescription: "Opciones:"; Flags: unchecked

[Files]
Source: "..\..\dist\NoviQ\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\NoviQ"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar NoviQ"; Filename: "{uninstallexe}"
Name: "{autodesktop}\NoviQ"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\NoviQ"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-browser"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir NoviQ ahora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--stop"; Flags: runhidden; RunOnceId: "StopNoviQ"
