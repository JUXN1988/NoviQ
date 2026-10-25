# -*- coding: utf-8 -*-
"""🎙 Voz → texto para el avatar de Noviq (lo que oye su micrófono).

Motores, del más privado al de respaldo (el ajuste avatar.motor_voz = "auto" elige el primero disponible):
  1. local   — faster-whisper en tu PC (sin internet, gratis; usa la GPU NVIDIA si hay). Se instala desde ⚙ Ajustes → 🤖 Avatar.
  2. nvidia  — Whisper large-v3 en la nube de NVIDIA (build.nvidia.com) con tu API key de NVIDIA. Cliente oficial:
               nvidia-riva-client (pequeño; Noviq lo instala solo la primera vez).
  3. nube    — /audio/transcriptions de Groq u OpenAI si tienes su clave activa en Noviq.
  4. windows — reconocimiento de voz de Windows (System.Speech, sin internet). Necesita el paquete de voz en español.
Todo recibe un WAV PCM 16 kHz mono (lo manda el avatar) y devuelve texto."""
import base64
import io
import json
import re
import subprocess
import sys
import threading
import time
import wave
from pathlib import Path

from .config import CONFIG, DATA_DIR, FROZEN, IS_WINDOWS

NVIDIA_WHISPER = "b702f636-f60c-4a3d-a6f4-f3568c13bd7d"   # function-id de openai/whisper-large-v3 en build.nvidia.com
NVIDIA_GRPC = "grpc.nvcf.nvidia.com:443"
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0
PISTA = "Noviq"   # ayuda a los motores a escribir bien el nombre (o el que le pongas en Ajustes)


def _pista():
    n = str((_cfg().get("desde_avatar") or {}).get("nombre") or _cfg().get("nombre_bot") or "").strip()
    return n if n and n.lower() != "noviq" else PISTA

_lock = threading.Lock()
_estado = {"instalando": "", "log": "", "ultimo_motor": "", "ultimo_error": "", "modelo_local": None, "cargando_local": False,
           "sapi": None, "sapi_info": None, "nube_uso": []}


def _cfg():
    c = CONFIG.get("avatar")
    return c if isinstance(c, dict) else {}


def _idioma():
    i = (_cfg().get("idioma") or CONFIG.get("idioma") or "es").lower()
    return "en" if i.startswith("en") else "es"


# ───────────── disponibilidad ─────────────
def _importable(mod):
    try:
        import importlib.util
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _nvidia_clave():
    try:
        from . import vault
        ks = vault.get_keys("nvidia")
        return ks[0] if ks else ""
    except Exception:
        return ""


def _nube():
    """(proveedor, base_url, clave, modelo) de un servicio compatible con /audio/transcriptions."""
    try:
        from . import vault
        for pid, modelo in (("groq", "whisper-large-v3-turbo"), ("openai", "gpt-4o-mini-transcribe")):
            p = (CONFIG.get("providers") or {}).get(pid) or {}
            ks = vault.get_keys(pid)
            if p.get("enabled") and ks and p.get("base_url"):
                return pid, p["base_url"].rstrip("/"), ks[0], modelo
    except Exception:
        pass
    return None


def sapi_info(refrescar=False):
    """Reconocedores de voz de Windows instalados (System.Speech)."""
    if not IS_WINDOWS:
        return []
    if _estado["sapi_info"] is not None and not refrescar:
        return _estado["sapi_info"]
    ps = ("Add-Type -AssemblyName System.Speech; [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | "
          "ForEach-Object { $_.Culture.Name + '|' + $_.Name }")
    try:
        r = subprocess.run(["powershell", "-NoProfile", "-NonInteractive", "-Command", ps], capture_output=True, text=True,
                           timeout=25, creationflags=NO_WINDOW)
        info = [ln.split("|", 1) for ln in (r.stdout or "").splitlines() if "|" in ln]
    except Exception:
        info = []
    _estado["sapi_info"] = info
    return info


def motores():
    """Lista de motores con su disponibilidad (para ⚙ Ajustes)."""
    out = []
    out.append({"id": "local", "nombre": "Local (faster-whisper, sin internet)", "listo": _importable("faster_whisper"),
                "falta": "" if _importable("faster_whisper") else "instalar (≈ 200 MB + modelo)"})
    nv_cli, nv_key = _importable("riva.client"), bool(_nvidia_clave())
    out.append({"id": "nvidia", "nombre": "NVIDIA Whisper large-v3 (nube, tu API key)", "listo": nv_cli and nv_key,
                "falta": "" if nv_cli and nv_key else ("falta la API key de NVIDIA" if not nv_key else "instalar el cliente (pequeño)")})
    nb = _nube()
    out.append({"id": "nube", "nombre": f"{nb[0].capitalize()} Whisper (nube)" if nb else "Groq / OpenAI Whisper (nube)", "listo": bool(nb),
                "falta": "" if nb else "activa Groq u OpenAI con su clave en Proveedores"})
    if IS_WINDOWS:
        si = _estado["sapi_info"]
        es = [c for c, _ in (si or []) if c.lower().startswith(_idioma())]
        out.append({"id": "windows", "nombre": "Windows (System.Speech, sin internet)", "listo": bool(es) if si is not None else None,
                    "falta": "" if es else ("instala el paquete de voz en español de Windows" if si is not None else "comprobando…")})
    return out


def disponible():
    return [m["id"] for m in motores() if m["listo"]]


def orden():
    pref = (_cfg().get("motor_voz") or "auto").lower()
    base = ["local", "nvidia", "nube", "windows"]
    if pref in base:
        base.remove(pref)
        base.insert(0, pref)
    return base


def es_nube(motor):
    return motor in ("nvidia", "nube")


# ───────────── motores ─────────────
def _local(wav_path):
    from faster_whisper import WhisperModel
    with _lock:
        if _estado["modelo_local"] is None:
            tam = (_cfg().get("modelo_local") or "auto").lower()
            if tam == "auto":
                tam = "small"
                try:
                    from . import recursos as R
                    if float(R.medir().get("ram_libre_gb") or 8) < 4:   # poca RAM LIBRE → modelo más liviano
                        tam = "base"
                except Exception:
                    pass
            _estado["cargando_local"] = True
            try:
                try:
                    _estado["modelo_local"] = WhisperModel(tam, device="auto", compute_type="auto",
                                                           download_root=str(DATA_DIR / "voz_modelos"))
                except Exception:
                    _estado["modelo_local"] = WhisperModel(tam, device="cpu", compute_type="int8",
                                                           download_root=str(DATA_DIR / "voz_modelos"))
            finally:
                _estado["cargando_local"] = False
        modelo = _estado["modelo_local"]
    segs, _info = modelo.transcribe(str(wav_path), language=_idioma(), beam_size=1, initial_prompt=_pista(), vad_filter=False,
                                    condition_on_previous_text=False)
    return " ".join(s.text.strip() for s in segs).strip()


def _nvidia(wav_path):
    import riva.client
    clave = _nvidia_clave()
    if not clave:
        raise RuntimeError("falta la API key de NVIDIA")
    auth = riva.client.Auth(uri=NVIDIA_GRPC, use_ssl=True,
                            metadata_args=[["function-id", NVIDIA_WHISPER], ["authorization", "Bearer " + clave]])
    asr = riva.client.ASRService(auth)
    cfg = riva.client.RecognitionConfig(language_code=_idioma(), max_alternatives=1, enable_automatic_punctuation=True,
                                        audio_channel_count=1)
    riva.client.add_audio_file_specs_to_config(cfg, str(wav_path))
    datos = Path(wav_path).read_bytes()
    resp = asr.offline_recognize(datos, cfg)
    return " ".join(r.alternatives[0].transcript.strip() for r in resp.results if r.alternatives).strip()


def _nube_tx(wav_path):
    import requests
    nb = _nube()
    if not nb:
        raise RuntimeError("sin Groq/OpenAI activos")
    pid, base, clave, modelo = nb
    with open(wav_path, "rb") as f:
        r = requests.post(base + "/audio/transcriptions", headers={"Authorization": "Bearer " + clave},
                          files={"file": ("voz.wav", f, "audio/wav")},
                          data={"model": modelo, "language": _idioma(), "prompt": _pista(), "response_format": "json"}, timeout=60)
    if r.status_code != 200:
        raise RuntimeError(f"{pid} {r.status_code}: {r.text[:200]}")
    return (r.json().get("text") or "").strip()


_SAPI_PS = r"""
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
Add-Type -AssemblyName System.Speech
$want = '__IDIOMA__'
$ri = [System.Speech.Recognition.SpeechRecognitionEngine]::InstalledRecognizers() | Where-Object { $_.Culture.Name.ToLower().StartsWith($want) } | Select-Object -First 1
if (-not $ri) { [Console]::Out.WriteLine('{"error":"sin reconocedor"}'); exit 1 }
$eng = New-Object System.Speech.Recognition.SpeechRecognitionEngine($ri)
$eng.LoadGrammar((New-Object System.Speech.Recognition.DictationGrammar))
[Console]::Out.WriteLine('{"listo":true}')
while ($true) {
  $f = [Console]::In.ReadLine()
  if ($f -eq $null) { break }
  $txt = @()
  try {
    $eng.SetInputToWaveFile($f)
    while ($true) { $r = $eng.Recognize(); if ($r -eq $null) { break }; $txt += $r.Text }
    $eng.SetInputToNull()
    [Console]::Out.WriteLine((@{ texto = ($txt -join ' ') } | ConvertTo-Json -Compress))
  } catch { [Console]::Out.WriteLine((@{ error = $_.Exception.Message } | ConvertTo-Json -Compress)) }
}
"""


def _windows(wav_path):
    if not IS_WINDOWS:
        raise RuntimeError("solo en Windows")
    with _lock:
        p = _estado["sapi"]
        if p is None or p.poll() is not None:
            p = subprocess.Popen(["powershell", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-Command",
                                  _SAPI_PS.replace("__IDIOMA__", _idioma())], stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL, text=True, encoding="utf-8", creationflags=NO_WINDOW)
            primera = json.loads(p.stdout.readline() or "{}")
            if not primera.get("listo"):
                p.kill()
                raise RuntimeError(primera.get("error") or "el reconocedor de Windows no arrancó")
            _estado["sapi"] = p
        p.stdin.write(str(wav_path) + "\n")
        p.stdin.flush()
        r = json.loads(p.stdout.readline() or "{}")
    if r.get("error"):
        raise RuntimeError(r["error"])
    return (r.get("texto") or "").strip()


FUNCS = {"local": _local, "nvidia": _nvidia, "nube": _nube_tx, "windows": _windows}


def _duracion(wav_bytes):
    try:
        with wave.open(io.BytesIO(wav_bytes)) as w:
            return w.getnframes() / float(w.getframerate() or 16000)
    except Exception:
        return 0.0


def transcribir(audio_b64, solo_local=False, solo=None):
    """→ (texto, motor). Prueba los motores disponibles en orden. solo_local=True evita la nube (ahorro/privacidad);
    solo=["local"] limita a esos motores (detector local del nombre)."""
    try:
        datos = base64.b64decode(audio_b64)
    except Exception:
        raise RuntimeError("audio inválido")
    if datos[:4] != b"RIFF" or len(datos) < 2000:
        raise RuntimeError("audio vacío o no es WAV")
    listos = set(disponible())
    candidatos = [m for m in orden() if m in listos and not (solo_local and es_nube(m)) and (not solo or m in solo)]
    if not candidatos:
        raise LookupError("sin motor")
    carpeta = DATA_DIR / "voz_tmp"
    carpeta.mkdir(parents=True, exist_ok=True)
    f = carpeta / f"frase_{int(time.time() * 1000)}.wav"
    f.write_bytes(datos)
    errores = []
    try:
        for m in candidatos:
            try:
                t0 = time.time()
                txt = FUNCS[m](f)
                _estado["ultimo_motor"], _estado["ultimo_error"] = m, ""
                if es_nube(m):
                    _estado["nube_uso"] = [x for x in _estado["nube_uso"] if time.time() - x < 3600] + [time.time()]
                _log(f"{m} {time.time() - t0:.1f}s {_duracion(datos):.1f}s-audio → {txt[:80]!r}")
                return _limpiar(txt), m
            except Exception as e:
                errores.append(f"{m}: {type(e).__name__}: {str(e)[:160]}")
                _log("✖ " + errores[-1])
        _estado["ultimo_error"] = " · ".join(errores)
        raise RuntimeError("no pude transcribir (" + "; ".join(errores)[:300] + ")")
    finally:
        try:
            f.unlink()
        except OSError:
            pass


def uso_nube_hora():
    return len([x for x in _estado["nube_uso"] if time.time() - x < 3600])


_RUIDO = re.compile(r"(?i)^\W*(gracias por ver|subt[ií]tulos|suscr[ií]bete|thank you for watching|\[m[uú]sica\]|\(m[uú]sica\)|m[uú]sica)\W*$")


def _limpiar(t):
    t = re.sub(r"\s+", " ", t or "").strip()
    if _RUIDO.match(t):   # alucinaciones típicas de Whisper con ruido
        return ""
    return t


# ───────────── instalación ─────────────
def _log(t):
    try:
        with open(DATA_DIR / "avatar.log", "a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S") + " [voz] " + str(t) + "\n")
    except Exception:
        pass


def instalar(motor, esperar=False):
    """Instala el cliente de un motor con pip (en el Python de Noviq). motor: nvidia | local."""
    paquetes = {"nvidia": ["nvidia-riva-client"], "local": ["faster-whisper"]}.get(motor)
    if not paquetes:
        return {"ok": False, "error": "motor desconocido"}
    if FROZEN:
        return {"ok": False, "error": "en el Noviq instalado (.exe) este motor aún no se puede añadir"}
    if _estado["instalando"]:
        return {"ok": False, "error": f"ya estoy instalando {_estado['instalando']}"}

    def trabajo():
        _estado["instalando"], _estado["log"] = motor, f"Instalando {', '.join(paquetes)}…"
        try:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check", *paquetes],
                               capture_output=True, text=True, timeout=1800, creationflags=NO_WINDOW)
            _estado["log"] = "✔ Instalado" if r.returncode == 0 else "✖ " + (r.stderr or r.stdout)[-400:]
            _log(f"pip {paquetes}: {_estado['log']}")
            import importlib
            importlib.invalidate_caches()
        except Exception as e:
            _estado["log"] = f"✖ {e}"
        finally:
            _estado["instalando"] = ""

    if esperar:
        trabajo()
    else:
        threading.Thread(target=trabajo, daemon=True, name=f"instalar-voz-{motor}").start()
    return {"ok": True}


def asegurar_motor():
    """Al arrancar (en segundo plano): comprueba el reconocedor de Windows y, si hay clave de NVIDIA pero no su cliente (ni
    faster-whisper local), instala el cliente oficial (pequeño): Whisper large-v3 entiende mucho mejor que el de Windows."""
    try:
        sapi_info()
    except Exception:
        pass
    if _nvidia_clave() and not _importable("riva.client") and not _importable("faster_whisper") and not FROZEN:
        _log("instalo nvidia-riva-client (Whisper de NVIDIA con tu clave) para entender tu voz")
        instalar("nvidia", esperar=True)


def estado_publico():
    return {"motores": motores(), "instalando": _estado["instalando"], "log": _estado["log"], "ultimo_motor": _estado["ultimo_motor"],
            "ultimo_error": _estado["ultimo_error"], "cargando_local": _estado["cargando_local"], "uso_nube_hora": uso_nube_hora()}


def cerrar():
    p = _estado.get("sapi")
    if p and p.poll() is None:
        try:
            p.kill()
        except Exception:
            pass
