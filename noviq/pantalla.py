# -*- coding: utf-8 -*-
"""👁 Ver la pantalla gastando pocos tokens (como Claude Desktop, pero primero con lo que Windows ya trae):

1. TEXTO primero (casi gratis): leer_texto usa el OCR que viene con Windows 10/11 (Windows.Media.Ocr, sin instalar nada)
   y devuelve cada línea con su posición «@(x,y)» → la IA puede hacer clic ahí sin ver ninguna imagen.
   clic_texto busca un texto en la pantalla (ej. «Enviar») y hace clic en él directamente.
2. IMAGEN solo si hace falta: captura de SOLO la ventana activa (o la pantalla), reducida a ≤1280 px y en JPEG
   (≈4-8 veces menos tokens que un PNG a tamaño completo). Como en Claude Desktop, la IA puede hacer clic con las
   coordenadas de ESA imagen (origen='captura'): se convierten solas a píxeles reales de la pantalla.
   Con marcas=true se dibujan los controles numerados [eN] encima (set-of-marks) para hacer clic por referencia."""
import base64
import io
import json
import re
import subprocess
import tempfile
import time
from pathlib import Path

from .config import IS_WINDOWS, NO_WINDOW

MAX_LADO = 1280

PS_OCR = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Runtime.WindowsRuntime
$null = [Windows.Storage.StorageFile, Windows.Storage, ContentType = WindowsRuntime]
$null = [Windows.Media.Ocr.OcrEngine, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Foundation.IAsyncOperation`1, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Graphics.Imaging.SoftwareBitmap, Windows.Foundation, ContentType = WindowsRuntime]
$null = [Windows.Storage.Streams.RandomAccessStream, Windows.Storage.Streams, ContentType = WindowsRuntime]
$asTaskGeneric = ([System.WindowsRuntimeSystemExtensions].GetMethods() | Where-Object { $_.Name -eq 'AsTask' -and $_.GetParameters().Count -eq 1 -and $_.GetParameters()[0].ParameterType.Name -eq 'IAsyncOperation`1' })[0]
function Await($t, $tipo) { $a = $asTaskGeneric.MakeGenericMethod($tipo); $n = $a.Invoke($null, @($t)); $n.Wait(-1) | Out-Null; $n.Result }
$f = Await ([Windows.Storage.StorageFile]::GetFileFromPathAsync('__RUTA__')) ([Windows.Storage.StorageFile])
$s = Await ($f.OpenAsync([Windows.Storage.FileAccessMode]::Read)) ([Windows.Storage.Streams.IRandomAccessStream])
$d = Await ([Windows.Graphics.Imaging.BitmapDecoder]::CreateAsync($s)) ([Windows.Graphics.Imaging.BitmapDecoder])
$b = Await ($d.GetSoftwareBitmapAsync()) ([Windows.Graphics.Imaging.SoftwareBitmap])
$e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromUserProfileLanguages()
if (-not $e) { $e = [Windows.Media.Ocr.OcrEngine]::TryCreateFromLanguage([Windows.Globalization.Language]::new('es')) }
if (-not $e) { throw 'Windows no tiene un idioma de OCR instalado (Configuración → Hora e idioma → Idioma → Español → Opciones → OCR).' }
$r = Await ($e.RecognizeAsync($b)) ([Windows.Media.Ocr.OcrResult])
foreach ($l in $r.Lines) {
  $ws = @($l.Words); if ($ws.Count -eq 0) { continue }
  $x1 = ($ws | ForEach-Object { $_.BoundingRect.X } | Measure-Object -Minimum).Minimum
  $y1 = ($ws | ForEach-Object { $_.BoundingRect.Y } | Measure-Object -Minimum).Minimum
  $x2 = ($ws | ForEach-Object { $_.BoundingRect.X + $_.BoundingRect.Width } | Measure-Object -Maximum).Maximum
  $y2 = ($ws | ForEach-Object { $_.BoundingRect.Y + $_.BoundingRect.Height } | Measure-Object -Maximum).Maximum
  $pal = ($ws | ForEach-Object { "$($_.Text)~$([int]$_.BoundingRect.X)~$([int]$_.BoundingRect.Y)~$([int]$_.BoundingRect.Width)~$([int]$_.BoundingRect.Height)" }) -join '^'
  "L|$([int]$x1)|$([int]$y1)|$([int]$x2)|$([int]$y2)|$($l.Text -replace '[\r\n|]',' ')|$pal"
}
"""


# ───────────── Geometría de la pantalla / ventana (ctypes, sin PowerShell: rápido) ─────────────
def _user32():
    import ctypes
    u = ctypes.windll.user32  # type: ignore[attr-defined]
    try:
        ctypes.windll.shcore.SetProcessDpiAwareness(2)  # type: ignore[attr-defined]  # píxeles reales con escala 125-150 %
    except Exception:
        try:
            u.SetProcessDPIAware()
        except Exception:
            pass
    return u


def rect_ventana_activa():
    """(x1, y1, x2, y2, título) de la ventana activa en píxeles reales, o None."""
    if not IS_WINDOWS:
        return None
    import ctypes
    from ctypes import wintypes
    u = _user32()
    h = u.GetForegroundWindow()
    if not h:
        return None
    r = wintypes.RECT()
    try:  # sin la sombra invisible de Windows 10/11
        ctypes.windll.dwmapi.DwmGetWindowAttribute(h, 9, ctypes.byref(r), ctypes.sizeof(r))  # type: ignore[attr-defined]
    except Exception:
        u.GetWindowRect(h, ctypes.byref(r))
    n = u.GetWindowTextLengthW(h)
    buf = ctypes.create_unicode_buffer(n + 1)
    u.GetWindowTextW(h, buf, n + 1)
    if r.right - r.left < 20 or r.bottom - r.top < 20:
        return None
    return max(0, r.left), max(0, r.top), r.right, r.bottom, buf.value


def _grab(zona="ventana"):
    """Imagen PIL + origen (x, y) en la pantalla real + descripción."""
    from PIL import ImageGrab
    if IS_WINDOWS:
        _user32()
    if zona == "ventana":
        rv = rect_ventana_activa()
        if rv:
            x1, y1, x2, y2, t = rv
            im = ImageGrab.grab(bbox=(x1, y1, x2, y2), all_screens=True)
            return im, (x1, y1), f"ventana «{t}»"
    im = ImageGrab.grab(all_screens=(zona == "todas"))
    return im, (0, 0), "pantalla completa"


def _guardar_escala(ctx, origen, factor, tam):
    ctx.conv["_pc_captura"] = {"x0": origen[0], "y0": origen[1], "factor": factor, "w": tam[0], "h": tam[1], "t": time.time()}


def a_pantalla(ctx, x, y):
    """Coordenadas de la última captura reducida → píxeles reales de la pantalla."""
    c = ctx.conv.get("_pc_captura")
    if not c:
        raise RuntimeError("No hay una captura previa: usa accion='captura' primero o da coordenadas reales (origen='pantalla').")
    return int(c["x0"] + x * c["factor"]), int(c["y0"] + y * c["factor"])


def captura(ctx, zona="ventana", marcas=False, calidad=70, guardar=True):
    """Captura reducida (≤1280 px, JPEG) lista para la IA + coordenadas convertibles."""
    from PIL import ImageDraw
    im, origen, que = _grab(zona)
    im = im.convert("RGB")
    w0, h0 = im.size
    factor = max(1.0, max(w0, h0) / MAX_LADO)
    if factor > 1:
        im = im.resize((round(w0 / factor), round(h0 / factor)))
    _guardar_escala(ctx, origen, factor, im.size)
    n_marcas = 0
    if marcas:
        refs = ctx.conv.get("_pc_refs") or {}
        if not refs:
            try:
                from . import pc
                pc.elementos(ctx, 150)
                refs = ctx.conv.get("_pc_refs") or {}
            except Exception:
                refs = {}
        dr = ImageDraw.Draw(im)
        for ref, r in refs.items():
            cx, cy = (r["x"] - origen[0]) / factor, (r["y"] - origen[1]) / factor
            if 0 <= cx < im.width and 0 <= cy < im.height:
                dr.rectangle([cx - 3, cy - 3, cx + 3, cy + 3], outline=(255, 40, 40), width=2)
                dr.rectangle([cx + 4, cy - 7, cx + 6 + 7 * len(ref), cy + 6], fill=(255, 235, 59))
                dr.text((cx + 5, cy - 7), ref, fill=(0, 0, 0))
                n_marcas += 1
    buf = io.BytesIO()
    im.save(buf, "JPEG", quality=int(calidad), optimize=True)
    data = buf.getvalue()
    ruta = None
    if guardar:
        folder = ctx.cwd / "capturas"
        folder.mkdir(exist_ok=True)
        ruta = folder / f"captura_{time.strftime('%Y%m%d_%H%M%S')}.jpg"
        ruta.write_bytes(data)
        ctx.emit("image", {"name": ruta.name, "path": str(ruta)})
    txt = (f"Captura de la {que}: {im.width}x{im.height} px (real {w0}x{h0}, JPEG {len(data) // 1024} KB)."
           f" Para hacer clic en algo de ESTA imagen usa control_pc accion='clic' con x,y de la imagen y origen='captura'"
           f" (se convierten solos a la pantalla real)." + (f" Hay {n_marcas} controles marcados [eN]: usa ref=eN." if n_marcas else "")
           + " Consejo: la próxima vez prueba primero accion='leer_texto' (OCR, sin imagen: gasta muchos menos tokens).")
    return {"text": txt, "images": ["data:image/jpeg;base64," + base64.b64encode(data).decode()], "ruta": str(ruta) if ruta else ""}


def ocr(ctx, zona="ventana"):
    """[(texto_linea, x1, y1, x2, y2, [(palabra, x, y, w, h)…])] en coordenadas reales de la pantalla."""
    if not IS_WINDOWS:
        raise RuntimeError("El OCR de Windows solo está en Windows.")
    im, (ox, oy), que = _grab(zona)
    # el OCR de Windows trabaja mejor con texto grande: se amplía ×2 las ventanas chicas (máx. 10000 px)
    esc = 2 if max(im.size) < 1600 else 1
    if esc > 1:
        im = im.resize((im.width * esc, im.height * esc))
    tmp = Path(tempfile.gettempdir()) / f"noviq_ocr_{int(time.time() * 1000)}.png"
    im.save(tmp)
    try:
        script = PS_OCR.replace("__RUTA__", str(tmp).replace("'", "''"))
        r = subprocess.run(["powershell", "-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", script], capture_output=True,
                           timeout=60, creationflags=NO_WINDOW)
        out = r.stdout.decode("utf-8", "replace")
        if r.returncode != 0 and "L|" not in out:
            raise RuntimeError((r.stderr.decode("utf-8", "replace").strip().splitlines() or ["OCR falló"])[-1][:300])
    finally:
        try:
            tmp.unlink()
        except OSError:
            pass
    lineas = []
    for ln in out.splitlines():
        p = ln.split("|", 6)
        if len(p) < 7 or p[0] != "L":
            continue
        x1, y1, x2, y2 = (int(v) // esc for v in p[1:5])
        pals = []
        for w in p[6].split("^"):
            q = w.split("~")
            if len(q) == 5:
                pals.append((q[0], ox + int(q[1]) // esc, oy + int(q[2]) // esc, int(q[3]) // esc, int(q[4]) // esc))
        lineas.append((p[5].strip(), ox + x1, oy + y1, ox + x2, oy + y2, pals))
    ctx.conv["_pc_ocr"] = {"t": time.time(), "lineas": [(t, a, b, c, d) for t, a, b, c, d, _ in lineas]}
    return lineas, que


def leer_texto(ctx, zona="ventana", maximo=180):
    lineas, que = ocr(ctx, zona)
    if not lineas:
        return f"OCR de la {que}: no encontré texto (puede ser una imagen o un lienzo). Usa accion='captura' si hace falta verla."
    out = [f"Texto de la {que} (OCR de Windows, coordenadas reales del centro @(x,y) para clic):"]
    for t, x1, y1, x2, y2, _ in lineas[:maximo]:
        out.append(f"«{t}» @({(x1 + x2) // 2},{(y1 + y2) // 2})")
    if len(lineas) > maximo:
        out.append(f"… y {len(lineas) - maximo} líneas más.")
    return "\n".join(out)


def _norm(t):
    import unicodedata
    t = unicodedata.normalize("NFKD", (t or "").lower())
    return re.sub(r"\s+", " ", "".join(c for c in t if not unicodedata.combining(c))).strip()


def buscar_texto(ctx, texto, zona="ventana"):
    """Posición (x, y, texto_encontrado) del texto en pantalla (primero palabra/frase exacta, luego parecida)."""
    q = _norm(texto)
    lineas, _ = ocr(ctx, zona)
    mejor = None
    for t, x1, y1, x2, y2, pals in lineas:
        nt = _norm(t)
        if q not in nt:
            continue
        qs = q.split()
        # ¿coincide con palabras concretas? → centro de esas palabras (más preciso que el de la línea)
        ws = [(_norm(w[0]), w) for w in pals]
        for i in range(len(ws)):
            if [w for w, _ in ws[i:i + len(qs)]] == qs or (len(qs) == 1 and ws[i][0].strip(".,:;!?") == q):
                sel = [w for _, w in ws[i:i + len(qs)]]
                xa, ya = min(w[1] for w in sel), min(w[2] for w in sel)
                xb, yb = max(w[1] + w[3] for w in sel), max(w[2] + w[4] for w in sel)
                return (xa + xb) // 2, (ya + yb) // 2, t
        if mejor is None or len(nt) < len(_norm(mejor[2])):
            mejor = ((x1 + x2) // 2, (y1 + y2) // 2, t)
    return mejor


def json_dump(x):
    return json.dumps(x, ensure_ascii=False)
