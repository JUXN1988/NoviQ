; Instalador de Noviq para Windows (Inno Setup 6)
#define MyAppName "Noviq"
#define MyAppVersion "4.2.0"
#define MyAppPublisher "Noviq Labs"
#define MyAppURL "https://noviq.netlify.app"
#define MyAppExeName "Noviq.exe"

[Setup]
AppId={{8F1C2A4E-6B3D-4E8A-9C71-5D2F0B9A7E13}
AppName={#MyAppName}
AppVersion={#MyAppVersion}
AppPublisher={#MyAppPublisher}
AppPublisherURL={#MyAppURL}
AppSupportURL={#MyAppURL}
DefaultDirName={autopf}\Noviq
DefaultGroupName=Noviq
DisableProgramGroupPage=yes
LicenseFile=..\..\LICENSE.md
OutputDir=..\..\dist
OutputBaseFilename=Noviq-Setup-Windows
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
Name: "startup"; Description: "Iniciar Noviq con Windows (para las tareas programadas)"; GroupDescription: "Opciones:"; Flags: unchecked

[Files]
Source: "..\..\dist\Noviq\*"; DestDir: "{app}"; Flags: ignoreversion recursesubdirs createallsubdirs

[Icons]
Name: "{group}\Noviq"; Filename: "{app}\{#MyAppExeName}"
Name: "{group}\Desinstalar Noviq"; Filename: "{uninstallexe}"
Name: "{autodesktop}\Noviq"; Filename: "{app}\{#MyAppExeName}"; Tasks: desktopicon
Name: "{userstartup}\Noviq"; Filename: "{app}\{#MyAppExeName}"; Parameters: "--no-browser"; Tasks: startup

[Run]
Filename: "{app}\{#MyAppExeName}"; Description: "Abrir Noviq ahora"; Flags: nowait postinstall skipifsilent

[UninstallRun]
Filename: "{app}\{#MyAppExeName}"; Parameters: "--stop"; Flags: runhidden; RunOnceId: "StopNoviq"
