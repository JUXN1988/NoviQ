# -*- coding: utf-8 -*-
"""🪪 Agente «perfil de Windows» (sin IA, sin capturas): averigua UNA vez con lo que Windows ya trae (PowerShell y el
registro) con quién y dónde se trabaja, y lo guarda en datos/perfil_windows.json para que las IAs usen las rutas
REALES del usuario en vez de adivinar o mirar la pantalla:

- usuario, equipo, idioma, versión de Windows, si es administrador, resolución y escala de la pantalla;
- carpetas de verdad (Escritorio, Documentos, Descargas, Imágenes… aunque OneDrive las haya movido);
- navegador predeterminado y navegadores instalados (Chrome, Edge, Firefox, Brave, Opera);
- Office instalado (Word, Excel, PowerPoint, Outlook clásico / nuevo), lector de PDF predeterminado;
- programas del menú Inicio (para abrir «Excel», «WhatsApp», «AnyDesk»… por su nombre exacto).

Se renueva solo cada 24 h (o con «🔄» en 🖥 PC y tareas). Las IAs lo reciben resumido en ~10 líneas."""
import json
import os
import re
import subprocess
import threading
import time
from pathlib import Path

from .config import DATA_DIR, IS_WINDOWS, NO_WINDOW

FILE = DATA_DIR / "perfil_windows.json"
_lock = threading.Lock()
_mem = {"t": 0, "datos": None}

PS_PERFIL = r"""
$ErrorActionPreference = 'SilentlyContinue'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
function Exp($p) { if ($p) { [Environment]::ExpandEnvironmentVariables($p) } else { '' } }
$usf = Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\User Shell Folders'
$carp = [ordered]@{
  Escritorio = [Environment]::GetFolderPath('Desktop'); Documentos = [Environment]::GetFolderPath('MyDocuments')
  Descargas = (Exp $usf.'{374DE290-123F-4565-9164-39C4925E467B}'); Imagenes = [Environment]::GetFolderPath('MyPictures')
  Musica = [Environment]::GetFolderPath('MyMusic'); Videos = [Environment]::GetFolderPath('MyVideos')
  OneDrive = $env:OneDrive; OneDriveEmpresa = $env:OneDriveCommercial; Perfil = $env:USERPROFILE }
if (-not $carp.Descargas) { $carp.Descargas = Join-Path $env:USERPROFILE 'Downloads' }
$os = Get-CimInstance Win32_OperatingSystem
$admin = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
Add-Type -AssemblyName System.Windows.Forms
$pant = @([System.Windows.Forms.Screen]::AllScreens | ForEach-Object { "$($_.Bounds.Width)x$($_.Bounds.Height)$(if ($_.Primary) {' (principal)'})" })
$escala = 100
try { $lp = (Get-ItemProperty 'HKCU:\Control Panel\Desktop\WindowMetrics').AppliedDPI; if ($lp) { $escala = [int]($lp * 100 / 96) } } catch {}
$nav = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Associations\UrlAssociations\http\UserChoice').ProgId
$pdf = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Explorer\FileExts\.pdf\UserChoice').ProgId
function AppPath($exe) {
  foreach ($r in 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKCU:\SOFTWARE\Microsoft\Windows\CurrentVersion\App Paths', 'HKLM:\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\App Paths') {
    $v = (Get-ItemProperty "$r\$exe").'(default)'; if ($v -and (Test-Path ($v.Trim('"')))) { return $v.Trim('"') } }
  return '' }
$navs = [ordered]@{}
foreach ($b in @(@('Chrome','chrome.exe'), @('Edge','msedge.exe'), @('Firefox','firefox.exe'), @('Brave','brave.exe'), @('Opera','opera.exe'))) {
  $p = AppPath $b[1]
  if (-not $p) { foreach ($base in $env:ProgramFiles, ${env:ProgramFiles(x86)}, $env:LOCALAPPDATA) { foreach ($sub in 'Google\Chrome\Application','Microsoft\Edge\Application','Mozilla Firefox','BraveSoftware\Brave-Browser\Application','Programs\Opera') {
      $c = Join-Path (Join-Path $base $sub) $b[1]; if (Test-Path $c) { $p = $c; break } } ; if ($p) { break } } }
  if ($p) { $navs[$b[0]] = $p } }
$off = [ordered]@{}
foreach ($o in @(@('Word','WINWORD.EXE'), @('Excel','EXCEL.EXE'), @('PowerPoint','POWERPNT.EXE'), @('Outlook','OUTLOOK.EXE'), @('OneNote','ONENOTE.EXE'), @('Acrobat','Acrobat.exe'), @('AcrobatReader','AcroRd32.exe'))) {
  $p = AppPath $o[1]; if ($p) { $off[$o[0]] = $p } }
$olkNuevo = [bool](Get-AppxPackage -Name 'Microsoft.OutlookForWindows' -ErrorAction SilentlyContinue)
$apps = @()
foreach ($d in "$env:ProgramData\Microsoft\Windows\Start Menu\Programs", "$env:APPDATA\Microsoft\Windows\Start Menu\Programs") {
  Get-ChildItem $d -Recurse -Include *.lnk,*.url -ErrorAction SilentlyContinue | ForEach-Object {
    $n = $_.BaseName; if ($n -notmatch '(?i)uninstall|desinstalar|readme|léame|help|ayuda|manual|website|sitio web') { $apps += "$n|$($_.FullName)" } } }
try { Get-StartApps | ForEach-Object { $apps += "$($_.Name)|shell:AppsFolder\$($_.AppID)" } } catch {}
[ordered]@{
  usuario = $env:USERNAME; dominio = $env:USERDOMAIN; equipo = $env:COMPUTERNAME; carpetas = $carp
  windows = "$($os.Caption) (build $($os.BuildNumber))"; idioma = (Get-Culture).Name; teclado = (Get-WinUserLanguageList)[0].LanguageTag
  admin = $admin; pantallas = $pant; escala = $escala; navegador_predeterminado = $nav; navegadores = $navs
  office = $off; outlook_nuevo = $olkNuevo; pdf_predeterminado = $pdf
  winget = [bool](Get-Command winget -ErrorAction SilentlyContinue); python = [bool](Get-Command python -ErrorAction SilentlyContinue)
  node = [bool](Get-Command node -ErrorAction SilentlyContinue); apps = ($apps | Select-Object -Unique | Select-Object -First 400)
} | ConvertTo-Json -Depth 4 -Compress
"""


def _generico():
    """Fuera de Windows (o si PowerShell falla): lo básico desde Python."""
    h = Path.home()
    carp = {}
    for k, sub in (("Escritorio", ["Desktop", "Escritorio"]), ("Documentos", ["Documents", "Documentos"]),
                   ("Descargas", ["Downloads", "Descargas"]), ("Imagenes", ["Pictures", "Imágenes"])):
        for s in sub:
            for base in (h / "OneDrive", h):
                if (base / s).is_dir():
                    carp[k] = str(base / s)
                    break
            if k in carp:
                break
    carp["Perfil"] = str(h)
    return {"usuario": os.environ.get("USERNAME") or os.environ.get("USER") or h.name, "equipo": os.environ.get("COMPUTERNAME", ""),
            "carpetas": carp, "windows": "", "navegadores": {}, "office": {}, "apps": [], "generico": True}


def perfil(forzar=False, max_age=86400):
    """Perfil del equipo (cacheado 24 h)."""
    with _lock:
        if not forzar and _mem["datos"] and time.time() - _mem["t"] < 600:
            return _mem["datos"]
        if not forzar:
            try:
                d = json.loads(FILE.read_text(encoding="utf-8"))
                if time.time() - d.get("_t", 0) < max_age:
                    _mem.update(t=time.time(), datos=d)
                    return d
            except Exception:
                pass
        d = None
        if IS_WINDOWS:
            try:
                r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", PS_PERFIL],
                                   capture_output=True, timeout=90, creationflags=NO_WINDOW)
                out = r.stdout.decode("utf-8", "replace").strip()
                d = json.loads(out[out.index("{"):]) if "{" in out else None
            except Exception:
                d = None
        d = d or _generico()
        d["carpetas"] = {k: v for k, v in (d.get("carpetas") or {}).items() if v and Path(v).exists()}
        d["apps"] = [a for a in (d.get("apps") or []) if isinstance(a, str) and "|" in a]
        d["_t"] = time.time()
        try:
            FILE.write_text(json.dumps(d, ensure_ascii=False, indent=1), encoding="utf-8")
        except OSError:
            pass
        _mem.update(t=time.time(), datos=d)
        return d


def carpetas_usuario():
    """{"Escritorio": Path, "Documentos": Path, "Descargas": Path, ...} (solo las que existen, sin repetir)."""
    out, vistos = {}, set()
    for k in ("Escritorio", "Documentos", "Descargas", "Imagenes", "Videos", "Musica"):
        v = (perfil().get("carpetas") or {}).get(k)
        if v and Path(v).is_dir() and v.lower() not in vistos:
            out[k] = Path(v)
            vistos.add(v.lower())
    return out


def _norm(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return re.sub(r"[^a-z0-9 ]+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


ALIAS = {"word": "word", "excel": "excel", "powerpoint": "powerpoint", "outlook": "outlook", "chrome": "google chrome",
         "edge": "microsoft edge", "bloc de notas": "notepad", "notepad": "notepad", "calculadora": "calculator",
         "explorador": "explorer", "explorador de archivos": "explorer", "whatsapp": "whatsapp", "telegram": "telegram",
         "paint": "paint", "configuracion": "ms-settings:", "ajustes": "ms-settings:"}
DIRECTOS = {"notepad": "notepad.exe", "explorer": "explorer.exe", "calculator": "calc.exe", "ms-settings:": "ms-settings:",
            "paint": "mspaint.exe", "cmd": "cmd.exe", "powershell": "powershell.exe"}


def buscar_app(nombre):
    """Ruta (acceso directo o AppID) del programa del menú Inicio que mejor coincide con «nombre», o None."""
    q = _norm(nombre)
    if not q:
        return None
    q = ALIAS.get(q, q)
    if q in DIRECTOS:
        return DIRECTOS[q]
    mejor, pm = None, 0
    qs = set(q.split())
    for a in perfil().get("apps") or []:
        n, ruta = a.split("|", 1)
        nn = _norm(n)
        if nn == q:
            return ruta
        ws = set(nn.split())
        p = len(qs & ws) / max(1, len(qs)) + (0.5 if nn.startswith(q) else 0) - 0.02 * max(0, len(ws) - len(qs))
        if p > pm:
            mejor, pm = ruta, p
    return mejor if pm >= 0.99 else None


def resumen_prompt():
    """~10 líneas para el prompt de la IA (rutas reales: nada de adivinar ni hacer capturas para encontrarlas)."""
    try:
        d = perfil()
    except Exception:
        return ""
    c = d.get("carpetas") or {}
    lin = [f"- Usuario de Windows: {d.get('usuario')} en {d.get('equipo') or 'este PC'}"
           + (f" · {d['windows']}" if d.get("windows") else "") + (f" · idioma {d['idioma']}" if d.get("idioma") else "")
           + (" · administrador" if d.get("admin") else "")]
    if c:
        lin.append("- Carpetas REALES: " + " · ".join(f"{k}: {v}" for k, v in c.items() if k not in ("Perfil", "OneDriveEmpresa", "Musica", "Videos")))
    nav = d.get("navegador_predeterminado") or ""
    nav_n = next((k for k in ("Chrome", "Edge", "Firefox", "Brave", "Opera") if k.lower() in nav.lower()), nav)
    if d.get("navegadores"):
        lin.append(f"- Navegadores: {', '.join(d['navegadores'])} (predeterminado: {nav_n or '?'})")
    off = [k for k in (d.get("office") or {}) if k in ("Word", "Excel", "PowerPoint", "Outlook", "OneNote")]
    if off or d.get("outlook_nuevo"):
        lin.append("- Office instalado: " + ", ".join(off) + (" · Outlook nuevo (sin COM)" if d.get("outlook_nuevo") else "")
                   + (" · Outlook clásico (COM disponible)" if "Outlook" in off else ""))
    if d.get("pantallas"):
        lin.append(f"- Pantalla: {', '.join(d['pantallas'])} · escala {d.get('escala', 100)}%")
    if d.get("apps"):
        lin.append(f"- {len(d['apps'])} programas en el menú Inicio: ábrelos por su nombre con control_pc accion='abrir'.")
    return "\n".join(lin)
