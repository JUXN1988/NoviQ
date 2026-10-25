# -*- coding: utf-8 -*-
"""🗣 Voces del avatar (texto → voz): modernas, fluidas y gratis, con voces latinas de hombre y mujer.

Motores (⚙ Ajustes → 🤖 Avatar → Voz):
  · microsoft — voces neuronales de Microsoft Edge (las más naturales; en línea, gratis, sin clave). Paquete `edge-tts`
                (Noviq lo instala solo). Ecuador, México, Colombia, Argentina, Perú, Chile, Venezuela, EE. UU. latino…
  · nvidia    — NVIDIA Magpie TTS Multilingual (build.nvidia.com, con tu API key): Isabela y Diego, con emociones
                (feliz, calmado, triste…) que siguen la personalidad y la cara del robot. Cliente `nvidia-riva-client`.
  · piper     — sin internet (`piper-tts`; los modelos ~60 MB se bajan de Hugging Face la primera vez). Corre en otro
                proceso (python -m piper).
  · windows   — las voces instaladas en Windows (las usa el propio avatar; también es el respaldo si todo falla).
El avatar pide el audio a /api/avatar/tts y mueve la boca con la energía real del sonido."""
import base64
import contextlib
import hashlib
import io
import json
import os
import re
import subprocess
import sys
import threading
import time
import wave

from .config import CONFIG, DATA_DIR, FROZEN, IS_WINDOWS

CACHE = DATA_DIR / "voz_cache"
MODELOS_PIPER = DATA_DIR / "voces_piper"
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0
NVIDIA_TTS = "877104f7-e885-42b9-8de8-f6e4c6303969"   # function-id de nvidia/magpie-tts-multilingual
NVIDIA_GRPC = "grpc.nvcf.nvidia.com:443"
_lock = threading.Lock()
_est = {"instalando": "", "log": "", "ultimo_error": "", "ultimo_motor": "", "ms": 0}

BANDERAS = {"EC": "🇪🇨", "MX": "🇲🇽", "CO": "🇨🇴", "AR": "🇦🇷", "PE": "🇵🇪", "CL": "🇨🇱", "VE": "🇻🇪", "US": "🇺🇸", "BO": "🇧🇴",
            "UY": "🇺🇾", "PY": "🇵🇾", "CR": "🇨🇷", "PA": "🇵🇦", "DO": "🇩🇴", "CU": "🇨🇺", "PR": "🇵🇷", "SV": "🇸🇻", "NI": "🇳🇮",
            "GT": "🇬🇹", "HN": "🇭🇳", "ES": "🇪🇸", "GQ": "🇬🇶", "GB": "🇬🇧"}
PAISES = {"EC": "Ecuador", "MX": "México", "CO": "Colombia", "AR": "Argentina", "PE": "Perú", "CL": "Chile", "VE": "Venezuela",
          "US": "Latina (EE. UU.)", "BO": "Bolivia", "UY": "Uruguay", "PY": "Paraguay", "CR": "Costa Rica", "PA": "Panamá",
          "DO": "Rep. Dominicana", "CU": "Cuba", "PR": "Puerto Rico", "SV": "El Salvador", "NI": "Nicaragua", "GT": "Guatemala",
          "HN": "Honduras", "ES": "España", "GQ": "Guinea Ecuatorial", "GB": "Reino Unido"}
LATINOS = set(PAISES) - {"ES", "GQ", "GB"}

# Voces neuronales de Microsoft (lista verificada; en tu PC se actualiza sola con la lista oficial)
_MS = [("EC", "Andrea", "F"), ("EC", "Luis", "M"), ("MX", "Dalia", "F"), ("MX", "Jorge", "M"), ("CO", "Salome", "F"),
       ("CO", "Gonzalo", "M"), ("AR", "Elena", "F"), ("AR", "Tomas", "M"), ("PE", "Camila", "F"), ("PE", "Alex", "M"),
       ("CL", "Catalina", "F"), ("CL", "Lorenzo", "M"), ("VE", "Paola", "F"), ("VE", "Sebastian", "M"), ("US", "Paloma", "F"),
       ("US", "Alonso", "M"), ("BO", "Sofia", "F"), ("BO", "Marcelo", "M"), ("UY", "Valentina", "F"), ("UY", "Mateo", "M"),
       ("PY", "Tania", "F"), ("PY", "Mario", "M"), ("CR", "Maria", "F"), ("CR", "Juan", "M"), ("PA", "Margarita", "F"),
       ("PA", "Roberto", "M"), ("DO", "Ramona", "F"), ("DO", "Emilio", "M"), ("CU", "Belkys", "F"), ("CU", "Manuel", "M"),
       ("PR", "Karina", "F"), ("PR", "Victor", "M"), ("SV", "Lorena", "F"), ("SV", "Rodrigo", "M"), ("NI", "Yolanda", "F"),
       ("NI", "Federico", "M"), ("ES", "Elvira", "F"), ("ES", "Alvaro", "M")]
_ACENTO = {"Salome": "Salomé", "Tomas": "Tomás", "Sebastian": "Sebastián", "Sofia": "Sofía", "Maria": "María", "Victor": "Víctor",
           "Alvaro": "Álvaro"}
_NV = [("Magpie-Multilingual.ES-US.Isabela", "Isabela", "F"), ("Magpie-Multilingual.ES-US.Diego", "Diego", "M")]
_NV_EN = [("Magpie-Multilingual.EN-US.Aria", "Aria", "F"), ("Magpie-Multilingual.EN-US.Jason", "Jason", "M")]
_PIPER = [("es_MX-claude-high", "Claude", "F", "MX"), ("es_MX-ald-medium", "Ald", "M", "MX"), ("es_ES-davefx-medium", "Dave", "M", "ES")]
EMOCION_NV = {"triste": "Sad", "feliz": "Happy", "risa": "Happy", "sonrisa": "Happy", "enojado": "Angry", "sorpresa": "Happy",
              "tranquilo": "Calm", "dormido": "Calm", "miedo": "Fearful"}
POR_DEFECTO = {"motor": "microsoft", "voz": "es-EC-LuisNeural"}


def _cfg():
    c = CONFIG.get("avatar")
    return c if isinstance(c, dict) else {}


def _importable(mod):
    try:
        import importlib.util
        return importlib.util.find_spec(mod) is not None
    except Exception:
        return False


def _log(t):
    try:
        with open(DATA_DIR / "avatar.log", "a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S") + " [voces] " + str(t) + "\n")
    except Exception:
        pass


def _nvidia_clave():
    try:
        from . import vault
        ks = vault.get_keys("nvidia")
        return ks[0] if ks else ""
    except Exception:
        return ""


def elegida():
    c = _cfg()
    motor = c.get("voz_motor") or POR_DEFECTO["motor"]
    voz = c.get("voz_id") or (POR_DEFECTO["voz"] if motor == "microsoft" else "")
    return motor, voz


# ───────────── catálogo ─────────────
def _lista_ms():
    """Voces de Microsoft: la lista oficial (guardada 7 días) o la verificada de respaldo."""
    f = DATA_DIR / "voces_microsoft.json"
    try:
        if f.exists() and time.time() - f.stat().st_mtime < 7 * 86400:
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        pass
    out = [{"id": f"es-{p}-{n}Neural", "nombre": _ACENTO.get(n, n), "genero": g, "pais": p} for p, n, g in _MS]
    out += [{"id": "en-US-AvaNeural", "nombre": "Ava", "genero": "F", "pais": "US", "idioma": "en"},
            {"id": "en-US-AndrewNeural", "nombre": "Andrew", "genero": "M", "pais": "US", "idioma": "en"}]

    def refrescar():
        try:
            import asyncio
            import edge_tts
            vs = asyncio.run(edge_tts.list_voices())
            nuevas = []
            for v in vs:
                loc = v.get("Locale") or ""
                if not loc.startswith(("es-", "en-US")):
                    continue
                nom = re.sub(r"(Multilingual)?Neural$", "", v["ShortName"].split("-", 2)[-1])
                nuevas.append({"id": v["ShortName"], "nombre": _ACENTO.get(nom, nom), "genero": "F" if v.get("Gender") == "Female" else "M",
                               "pais": loc.split("-")[-1], "idioma": loc[:2]})
            if nuevas:
                f.write_text(json.dumps(nuevas, ensure_ascii=False), encoding="utf-8")
        except Exception as e:
            _log(f"lista de Microsoft: {e}")
    if _importable("edge_tts"):
        threading.Thread(target=refrescar, daemon=True).start()
    return out


def _lista_piper():
    f = DATA_DIR / "voces_piper.json"
    try:
        if f.exists():
            return json.loads(f.read_text(encoding="utf-8"))
    except Exception:
        pass
    return [{"id": i, "nombre": n, "genero": g, "pais": p} for i, n, g, p in _PIPER]


def _refrescar_piper():
    """Lista oficial de voces de Piper en español (voices.json de Hugging Face); el género se toma del respaldo si se conoce."""
    try:
        import urllib.request
        with urllib.request.urlopen("https://huggingface.co/rhasspy/piper-voices/resolve/main/voices.json?download=true", timeout=20) as r:
            d = json.load(r)
        conocidas = {i: (n, g) for i, n, g, _ in _PIPER}
        out = []
        for k, v in sorted(d.items()):
            if not k.startswith("es_"):
                continue
            n, g = conocidas.get(k, (v.get("name", k).capitalize(), "?"))
            out.append({"id": k, "nombre": n, "genero": g, "pais": k[3:5], "calidad": v.get("quality"),
                        "hablantes": v.get("num_speakers", 1),
                        "archivos": {fn: x.get("size_bytes") for fn, x in (v.get("files") or {}).items()}})
        if out:
            (DATA_DIR / "voces_piper.json").write_text(json.dumps(out, ensure_ascii=False), encoding="utf-8")
    except Exception as e:
        _log(f"lista de Piper: {e}")


def catalogo():
    """Todas las voces por motor, con disponibilidad (para ⚙ Ajustes)."""
    def deco(v, motor):
        p = v.get("pais") or ""
        return dict(v, motor=motor, bandera=BANDERAS.get(p, "🌎"), pais_nombre=PAISES.get(p, p), latina=p in LATINOS)
    nv_ok, nv_key = _importable("riva.client"), bool(_nvidia_clave())
    motores = [
        {"id": "microsoft", "nombre": "Microsoft neuronales (las más naturales · en línea · gratis)", "listo": _importable("edge_tts"),
         "falta": "" if _importable("edge_tts") else "instalar (pequeño, Noviq lo hace solo)",
         "voces": [deco(v, "microsoft") for v in _lista_ms()]},
        {"id": "nvidia", "nombre": "NVIDIA Magpie (con emociones · tu API key)", "listo": nv_ok and nv_key,
         "falta": "" if nv_ok and nv_key else ("falta la API key de NVIDIA" if not nv_key else "instalar el cliente (pequeño)"),
         "voces": [deco({"id": i, "nombre": n, "genero": g, "pais": "US"}, "nvidia") for i, n, g in _NV]
         + [deco({"id": i, "nombre": n, "genero": g, "pais": "US", "idioma": "en"}, "nvidia") for i, n, g in _NV_EN]},
        {"id": "piper", "nombre": "Piper (sin internet · cada voz ~60 MB la primera vez)", "listo": _importable("piper"),
         "falta": "" if _importable("piper") else "instalar piper-tts (~30 MB)",
         "voces": [deco(v, "piper") for v in _lista_piper()]},
        {"id": "windows", "nombre": "Voces de Windows (las instaladas en tu PC)", "listo": True, "falta": "", "voces": []},
    ]
    m, v = elegida()
    return {"motores": motores, "elegida": {"motor": m, "voz": v}, "instalando": _est["instalando"], "log": _est["log"],
            "ultimo_error": _est["ultimo_error"], "ultimo_motor": _est["ultimo_motor"], "ms": _est["ms"]}


# ───────────── síntesis ─────────────
def _prosodia(vel, tono):
    return f"{int(round((float(vel or 1) - 1) * 100)):+d}%", f"{int(round((float(tono or 1) - 1) * 50)):+d}Hz"


def _ms(texto, voz, vel, tono, estilo):
    import edge_tts
    rate, pitch = _prosodia(vel, tono)
    com = edge_tts.Communicate(texto, voz or POR_DEFECTO["voz"], rate=rate, pitch=pitch, receive_timeout=25)
    audio = b"".join(ch["data"] for ch in com.stream_sync() if ch.get("type") == "audio")
    if not audio:
        raise RuntimeError("Microsoft no devolvió audio")
    return audio, "mp3"


def _pcm_a_wav(pcm, sr):
    b = io.BytesIO()
    with wave.open(b, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(sr)
        w.writeframes(pcm)
    return b.getvalue()


def _nvidia(texto, voz, vel, tono, estilo):
    import riva.client
    clave = _nvidia_clave()
    if not clave:
        raise RuntimeError("falta la API key de NVIDIA")
    voz = voz or _NV[0][0]
    emo = EMOCION_NV.get((estilo or "").lower())
    if emo and voz.count(".") == 2:
        voz = f"{voz}.{emo}"
    idioma = "es-US" if ".ES-US." in voz else "en-US"
    auth = riva.client.Auth(uri=NVIDIA_GRPC, use_ssl=True, metadata_args=[["function-id", NVIDIA_TTS], ["authorization", "Bearer " + clave]])
    tts = riva.client.SpeechSynthesisService(auth)
    sr = 44100
    try:
        r = tts.synthesize(texto, voice_name=voz, language_code=idioma, encoding=riva.client.AudioEncoding.LINEAR_PCM, sample_rate_hz=sr)
    except Exception:
        if voz.count(".") < 3:
            raise
        r = tts.synthesize(texto, voice_name=voz.rsplit(".", 1)[0], language_code=idioma,   # sin emoción si esa no existe
                           encoding=riva.client.AudioEncoding.LINEAR_PCM, sample_rate_hz=sr)
    if not r.audio:
        raise RuntimeError("NVIDIA no devolvió audio")
    return _pcm_a_wav(r.audio, sr), "wav"


def _modelo_piper(voz):
    voz = voz or _PIPER[0][0]
    m = re.match(r"^([a-z]{2})_([A-Z]{2})-([^-]+)-(.+)$", voz)
    if not m:
        raise RuntimeError(f"voz de Piper inválida: {voz}")
    MODELOS_PIPER.mkdir(parents=True, exist_ok=True)
    onnx = MODELOS_PIPER / f"{voz}.onnx"
    if not onnx.exists() or not (MODELOS_PIPER / f"{voz}.onnx.json").exists():
        import urllib.request
        base = (f"https://huggingface.co/rhasspy/piper-voices/resolve/main/{m.group(1)}/{m.group(1)}_{m.group(2)}/"
                f"{m.group(3)}/{m.group(4)}/{voz}")
        _est["log"] = f"Descargando la voz {voz} (una sola vez)…"
        for ext in (".onnx.json", ".onnx"):
            tmp = MODELOS_PIPER / f"{voz}{ext}.parcial"
            urllib.request.urlretrieve(base + ext + "?download=true", tmp)
            tmp.replace(MODELOS_PIPER / f"{voz}{ext}")
        _est["log"] = f"✔ Voz {voz} lista"
    return onnx


def _piper(texto, voz, vel, tono, estilo):
    if FROZEN:
        raise RuntimeError("Piper aún no está disponible en el Noviq instalado (.exe)")
    onnx = _modelo_piper(voz)
    salida = CACHE / f"piper_{int(time.time() * 1000)}.wav"
    CACHE.mkdir(parents=True, exist_ok=True)
    r = subprocess.run([sys.executable, "-m", "piper", "-m", str(onnx), "-f", str(salida), "--length-scale",
                        f"{1 / max(0.5, min(2.0, float(vel or 1))):.2f}"], input=texto.encode("utf-8"), capture_output=True,
                       timeout=60, creationflags=NO_WINDOW, env=dict(os.environ, PYTHONUTF8="1", PYTHONIOENCODING="utf-8"))
    if r.returncode or not salida.exists():
        raise RuntimeError("Piper falló: " + (r.stderr or b"").decode("utf-8", "replace")[-300:])
    datos = salida.read_bytes()
    salida.unlink(missing_ok=True)
    return datos, "wav"


MOTORES = {"microsoft": _ms, "nvidia": _nvidia, "piper": _piper}


def _limpio(texto):
    t = re.sub(r"[*_`#>|~]+", " ", str(texto or ""))
    t = re.sub(r"https?://\S+", "el enlace", t)
    t = re.sub(r"[\U0001F300-\U0001FAFF☀-➿️]", "", t)   # emojis: no se leen
    return re.sub(r"\s+", " ", t).strip()[:1500]


def _podar_cache(maximo=400):
    try:
        fs = sorted(CACHE.glob("*.*"), key=lambda p: p.stat().st_mtime)
        for p in fs[:-maximo]:
            p.unlink(missing_ok=True)
    except Exception:
        pass


def sintetizar(texto, estilo="", motor=None, voz=None, vel=None, tono=None):
    """→ dict(ok, audio(base64), formato, motor, voz, ms) o dict(ok=False, error). Usa caché para frases repetidas."""
    texto = _limpio(texto)
    if not texto:
        return {"ok": False, "error": "texto vacío"}
    c = _cfg()
    m0, v0 = elegida()
    motor = motor or m0
    voz = voz if voz is not None else (v0 if motor == m0 else "")
    if motor == "windows":
        return {"ok": False, "error": "voz de Windows (la pone el avatar)", "windows": True}
    vel = float(vel if vel is not None else c.get("voz_vel") or 1.0)
    tono = float(tono if tono is not None else c.get("voz_tono") or 1.0)
    orden = [motor] + [x for x in ("microsoft",) if x != motor and _importable("edge_tts")]
    errores = []
    for mo in orden:
        if mo not in MOTORES:
            continue
        vz = voz if mo == motor else POR_DEFECTO["voz"]
        clave = hashlib.sha1(f"{mo}|{vz}|{estilo if mo == 'nvidia' else ''}|{vel:.2f}|{tono:.2f}|{texto}".encode("utf-8")).hexdigest()[:20]
        for ext in ("mp3", "wav"):
            f = CACHE / f"{clave}.{ext}"
            if f.exists():
                f.touch()
                return {"ok": True, "audio": base64.b64encode(f.read_bytes()).decode(), "formato": ext, "motor": mo, "voz": vz,
                        "ms": 0, "cache": True}
        t0 = time.time()
        try:
            with _lock if mo == "piper" else contextlib.nullcontext():
                audio, fmt = MOTORES[mo](texto, vz, vel, tono, estilo)
            ms = int((time.time() - t0) * 1000)
            _est.update(ultimo_motor=mo, ms=ms, ultimo_error="")
            if len(texto) <= 300:
                CACHE.mkdir(parents=True, exist_ok=True)
                (CACHE / f"{clave}.{fmt}").write_bytes(audio)
                _podar_cache()
            return {"ok": True, "audio": base64.b64encode(audio).decode(), "formato": fmt, "motor": mo, "voz": vz, "ms": ms}
        except Exception as e:
            errores.append(f"{mo}: {type(e).__name__}: {str(e)[:160]}")
            _log("✖ " + errores[-1])
    _est["ultimo_error"] = " · ".join(errores)
    return {"ok": False, "error": _est["ultimo_error"] or "sin motor de voz"}



# ───────────── instalación ─────────────
PAQUETES = {"microsoft": ["edge-tts"], "nvidia": ["nvidia-riva-client"], "piper": ["piper-tts"]}


def instalar(motor, esperar=False):
    paq = PAQUETES.get(motor)
    if not paq:
        return {"ok": False, "error": "motor desconocido"}
    if FROZEN:
        return {"ok": False, "error": "en el Noviq instalado (.exe) este motor aún no se puede añadir"}
    if _est["instalando"]:
        return {"ok": False, "error": f"ya estoy instalando {_est['instalando']}"}

    def trabajo():
        _est["instalando"], _est["log"] = motor, f"Instalando {', '.join(paq)}…"
        try:
            r = subprocess.run([sys.executable, "-m", "pip", "install", "-q", "--disable-pip-version-check", *paq],
                               capture_output=True, text=True, timeout=1800, creationflags=NO_WINDOW)
            _est["log"] = "✔ Instalado" if r.returncode == 0 else "✖ " + (r.stderr or r.stdout)[-400:]
            _log(f"pip {paq}: {_est['log']}")
            import importlib
            importlib.invalidate_caches()
            if motor == "piper" and r.returncode == 0:
                _refrescar_piper()
        except Exception as e:
            _est["log"] = f"✖ {e}"
        finally:
            _est["instalando"] = ""

    if esperar:
        trabajo()
    else:
        threading.Thread(target=trabajo, daemon=True, name=f"instalar-voz-{motor}").start()
    return {"ok": True}


def asegurar():
    """Al arrancar: instala lo que falta para el motor elegido (Microsoft por defecto: un paquete pequeño)."""
    motor, _ = elegida()
    if motor in PAQUETES and not FROZEN:
        mod = {"microsoft": "edge_tts", "nvidia": "riva.client", "piper": "piper"}[motor]
        if not _importable(mod) and (motor != "nvidia" or _nvidia_clave()):
            _log(f"instalo el motor de voz {motor}")
            instalar(motor, esperar=True)
    if motor == "piper" and _importable("piper") and not (DATA_DIR / "voces_piper.json").exists():
        _refrescar_piper()
