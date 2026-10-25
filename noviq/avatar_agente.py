# -*- coding: utf-8 -*-
"""🤖 Conector del avatar: Noviq ↔ el robot flotante (carpeta noviq-avatar).

El avatar es INDEPENDIENTE: tiene su propia mente, memoria, ajustes, voz, oído, herramientas y API (sus ajustes están en
su propia página, http://127.0.0.1:7777/ajustes, que Noviq muestra en ⚙ Ajustes → 🤖 Avatar). Este módulo hace de
puente para que, cuando Noviq está abierto, el avatar:
- ARRANQUE con Noviq (si le falta su motor Electron, o está dañado, lo descarga y lo verifica), se conecte con su API
  y vuelva a abrirse si se cae mientras hay trabajo.
- AVISE de los trabajos de Noviq (chat, Telegram, tareas programadas, voz): empieza, herramientas (icono + animación),
  progreso, permisos, preguntas, «¡Ya terminé!», «¿Qué más hacemos?»… según las preferencias que el avatar le pasa.
- USE TODO lo de Noviq: órdenes de trabajo a sus agentes (en el proyecto correcto, sin mezclar charla con proyectos),
  sus herramientas, su IA más rápida, sus voces (Piper sin internet) y su oído (faster-whisper sin internet).
- ENTIENDA por voz lo que es de Noviq: «sí/no» a un permiso, la respuesta a una pregunta de la IA, «detente»,
  «continúa», «¿cómo vas?», «nueva conversación…». Todo lo demás lo decide la mente del avatar.
API del avatar: http://127.0.0.1:<puerto>/ (ver noviq-avatar/README.md)."""
import hashlib
import json
import os
import platform
import queue
import random
import re
import shutil
import subprocess
import threading
import time
import unicodedata
import uuid
import zipfile
from pathlib import Path

import requests
from flask import Blueprint, Response, jsonify, request, stream_with_context

from .config import BASE_DIR, CONFIG, DATA_DIR, FROZEN, IS_WINDOWS, VERSION, save_config

bp = Blueprint("avatar", __name__)
CARPETA = Path(os.environ.get("NOVIQ_AVATAR_DIR") or (BASE_DIR / "noviq-avatar"))
NO_WINDOW = 0x08000000 if IS_WINDOWS else 0
DETACHED = (0x00000008 | 0x00000200) if IS_WINDOWS else 0   # DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP
ESTADO_F = DATA_DIR / "avatar_estado.json"
MEM_VIEJA = DATA_DIR / "avatar_memoria.json"   # memoria de antes (la hereda el avatar una sola vez)

# En Noviq solo queda lo de Noviq: abrir el avatar con Noviq y en qué puerto. Lo demás (voz, oído, personalidad,
# memoria…) son ajustes DEL AVATAR; las claves viejas se conservan para que el avatar las herede la primera vez.
DEFECTO = {"activo": True, "puerto": 0, "voz": True, "sonidos": True, "volumen": 0.5, "escuchar": "palabra", "motor_voz": "auto",
           "herramientas": True, "burbujas_herramientas": False, "anunciar_inicio": False, "que_mas": True, "dormir_min": 15,
           "cerrar_con_noviq": True, "ofrecer_continuar": True, "nombre_bot": "Noviq", "personalidad": ["animado", "curioso", "divertido"],
           "autonomia": 2, "portapapeles": "observar", "ayuda_portapapeles": True, "instrucciones_extra": "", "voz_motor": "microsoft",
           "voz_id": "es-EC-LuisNeural", "voz_vel": 1.0, "voz_tono": 1.0, "desde_avatar": {}}
PREF = {"avisosTrabajo": "herramientas", "burbujasHerramientas": "burbujas_herramientas", "anunciarInicio": "anunciar_inicio",
        "queMas": "que_mas", "ofrecerContinuar": "ofrecer_continuar", "cerrarConNoviq": "cerrar_con_noviq"}

_S = requests.Session()
_S.trust_env = False   # 127.0.0.1 nunca por un proxy
_lock = threading.RLock()
_lanzar_lock = threading.Lock()
_cola = queue.Queue(maxsize=800)
_E = {"url": "", "token": "", "proc": None, "lanzado_por_mi": False, "vivo": False, "t_vivo": 0, "latido": 0,
      "error": "", "reparando": False, "reparacion": "", "intentos": [], "cerrado_usuario": False, "iniciado": False,
      "listo_t": 0, "saludado": False, "oido": {}, "actividad": time.time(), "voz_ui_t": 0, "voz_backend_t": 0,
      "que_mas_timer": None, "ofrecidos": {}, "caidas": [], "reparado_auto": 0}
_trab = {}        # cid → estado del trabajo en curso (para animaciones y avisos)
_pend = {}        # pregunta abierta de Noviq: {"tipo": permiso|ayuda|plan|continuar|que_mas, "id", "cid", "t", "texto", "guardia"}
_UI = []          # colas SSE de las ventanas de Noviq abiertas
_voz_items = {}   # id → pedido por voz ofrecido a la ventana
_ui = {"conv": None, "t": 0}


def _cfg():
    c = CONFIG.get("avatar")
    out = dict(DEFECTO)
    if isinstance(c, dict):
        out.update(c)
    return out


def _pref(k):
    """Preferencias de avisos que el avatar le pasa a Noviq (las cambias en los ajustes del avatar)."""
    p = (_cfg().get("desde_avatar") or {}).get("noviq") or {}
    if k in p:
        return bool(p[k])
    return bool(_cfg().get(PREF.get(k, k), True))


def _nombre_bot():
    return str((_cfg().get("desde_avatar") or {}).get("nombre") or _cfg().get("nombre_bot") or "Noviq").strip() or "Noviq"


def _en():
    return str(CONFIG.get("idioma") or "es").lower().startswith("en")


def _log(t):
    try:
        with open(DATA_DIR / "avatar.log", "a", encoding="utf-8") as fh:
            fh.write(time.strftime("%Y-%m-%d %H:%M:%S") + " [agente] " + str(t) + "\n")
    except Exception:
        pass


# ═════════════════════════════ Frases (cortas) ═════════════════════════════
FR = {
    "fin": (["¡Ya terminé!", "¡Listo! Ya terminé.", "¡Hecho!"], ["Done!", "All done!", "Finished!"]),
    "fin_t": (["¡Ya terminé «{t}»!", "¡Listo «{t}»!"], ["Finished «{t}»!", "«{t}» is done!"]),
    "que_mas": (["¿Qué más hacemos?", "¿Qué hacemos ahora?", "¿Seguimos con algo más?"], ["What's next?", "What else shall we do?"]),
    "empiezo": (["Voy con eso.", "¡Manos a la obra!", "Entendido, empiezo."], ["On it.", "Let's do it!", "Got it, starting."]),
    "permiso": (["Necesito tu permiso: {l}. ¿Lo apruebo?"], ["I need your permission: {l}. Shall I approve it?"]),
    "permiso_g": (["Esto es delicado: {l}. Apruébalo en la ventana de Noviq."], ["This is sensitive: {l}. Approve it in the Noviq window."]),
    "ayuda": (["Necesito tu ayuda: {i}"], ["I need your help: {i}"]),
    "plan": (["Preparé un plan. ¿Lo apruebo?"], ["I've prepared a plan. Shall I approve it?"]),
    "fin_error": (["Me detuve por un error: {e}. ¿Lo intento otra vez?"], ["I stopped because of an error: {e}. Shall I try again?"]),
    "detenido": (["Listo, me detuve."], ["OK, I stopped."]),
    "aprobado": (["¡Aprobado! Sigo.", "Perfecto, sigo."], ["Approved! Continuing.", "Great, continuing."]),
    "rechazado": (["Entendido, no lo hago."], ["Understood, I won't do it."]),
    "respuesta": (["Se lo paso a la IA.", "Anotado, sigo."], ["Passing it on.", "Noted, continuing."]),
    "hola": (["¡Hola! Soy Noviq. Estoy listo."], ["Hi! I'm Noviq. Ready."]),
    "hola_pend": (["¡Hola! Quedó a medias «{t}». ¿Lo continúo?"], ["Hi! «{t}» was left unfinished. Shall I continue?"]),
    "a_medias": (["Quedó a medias «{t}». ¿Lo continúo?"], ["«{t}» is unfinished. Shall I continue?"]),
    "adios": (["¡Hasta luego!"], ["See you!"]),
    "escucho": (["¿Sí? Te escucho.", "Dime."], ["Yes? I'm listening.", "Go ahead."]),
    "no_entendi": (["No te entendí bien. ¿Me lo repites?"], ["I didn't catch that. Can you repeat it?"]),
    "sin_motor": (["Para escucharte necesito un motor de voz: actívalo en Ajustes, pestaña Avatar."],
                  ["To hear you I need a speech engine: enable one in Settings, Avatar tab."]),
    "nada": (["Ahora no estoy trabajando en nada. ¿Qué hacemos?"], ["I'm not working on anything. What shall we do?"]),
    "trabajando": (["Estoy trabajando en {l}."], ["I'm working on {l}."]),
    "continuo": (["Continúo donde quedé."], ["Continuing where I left off."]),
    "nada_continuar": (["No hay nada a medias."], ["Nothing is unfinished."]),
    "ocupado": (["Ese chat está ocupado: lo hago en otra conversación."], ["That chat is busy: I'll do it in another conversation."]),
    "mic_off": (["Dejo de escuchar. Haz clic en el micrófono cuando me necesites."], ["I'll stop listening. Click the microphone when you need me."]),
    "mic_on": (["Te escucho cuando digas «Noviq».", ], ["I'll listen when you say «Noviq»."]),
    "vale": (["Vale.", "De acuerdo."], ["OK.", "Sure."]),
    "aqui": (["¡Perfecto! Aquí estaré.", "Aquí estaré si me necesitas."], ["Great! I'll be here.", "I'm here if you need me."]),
    "abro": (["Te abro Noviq."], ["Opening Noviq."]),
    "no_abierto": (["Noviq está cerrado."], ["Noviq is closed."]),
}


def fr(clave, **kw):
    es, en = FR[clave]
    t = random.choice(en if _en() else es)
    try:
        return t.format(**kw)
    except Exception:
        return t


def _corto(t, n=60):
    t = re.sub(r"\s+", " ", str(t or "")).strip()
    return t if len(t) <= n else t[:n - 1].rstrip() + "…"


def _limpio_md(t):
    t = re.sub(r"```.*?```", " ", t or "", flags=re.S)
    t = re.sub(r"`([^`]*)`", r"\1", t)
    t = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", t)
    t = re.sub(r"\[([^\]]+)\]\([^)]*\)", r"\1", t)
    t = re.sub(r"[#*_>|~]+", " ", t)
    t = re.sub(r"(?m)^\s*[-•]\s*", "", t)
    return re.sub(r"\s+", " ", t).strip()


def _resumen_hablado(texto, n=170):
    """Primera(s) frase(s) de la respuesta, sin markdown, para decirla en voz alta."""
    t = _limpio_md(texto)
    if not t:
        return ""
    frases = re.split(r"(?<=[.!?])\s+", t)
    out = ""
    for f in frases:
        if len(out) + len(f) > n and out:
            break
        out = (out + " " + f).strip()
    return _corto(out, n)


# ═════════════════════════════ Comunicación con el avatar ═════════════════════════════
def _config_avatar():
    try:
        return json.loads((CARPETA / "config.json").read_text(encoding="utf-8"))
    except Exception:
        return {}


def _puerto():
    return int(_cfg().get("puerto") or os.environ.get("NOVIQ_PUERTO") or _config_avatar().get("puerto") or 7777)


def _hdr():
    tk = _config_avatar().get("token") or ""
    return {"X-Noviq-Token": tk} if tk else {}


def _av(cmd, espera=2.5):
    """Manda un comando al avatar (no espera la animación). Devuelve la respuesta o {"ok": False}."""
    try:
        r = _S.post(f"http://127.0.0.1:{_puerto()}/comando", json=cmd, headers=_hdr(), timeout=espera)
        _E["vivo"], _E["t_vivo"] = True, time.time()
        return r.json()
    except Exception as e:
        _E["vivo"] = False
        return {"ok": False, "error": str(e)[:200]}


def _av_api(metodo, ruta, cuerpo=None, espera=5):
    """Llama a cualquier ruta de la API del avatar (ajustes, charla, eventos de apps…)."""
    try:
        r = _S.request(metodo, f"http://127.0.0.1:{_puerto()}{ruta}", json=cuerpo, headers=_hdr(), timeout=espera)
        return r.json()
    except Exception as e:
        return {"ok": False, "error": str(e)[:200]}


def _vivo(espera=1.2):
    try:
        r = _S.get(f"http://127.0.0.1:{_puerto()}/estado", headers=_hdr(), timeout=espera)
        if r.status_code == 200:
            _E["vivo"], _E["t_vivo"] = True, time.time()
            return r.json()
    except Exception:
        pass
    _E["vivo"] = False
    return None


def _mandar(*cmds):
    """Encola comandos para el avatar (los manda el hilo del agente, sin frenar a la IA)."""
    for c in cmds:
        try:
            _cola.put_nowait(("cmd", c))
        except queue.Full:
            pass


def decir(texto, tipo="info", voz=None, fijo=False, **extra):
    """Aviso corto con sonido + gesto. La voz (sí/no, cuál) la decide el avatar con SUS ajustes, salvo que se fuerce."""
    cmd = {"cmd": "aviso", "tipo": tipo, "texto": texto, "fijo": bool(fijo)}
    if voz is not None:
        cmd["voz"] = bool(voz)
    cmd.update(extra)
    _mandar(cmd)


# ═════════════════════════════ Electron: instalar / verificar / reparar / abrir ═════════════════════════════
def _electron():
    d = CARPETA / "node_modules" / "electron" / "dist"
    if IS_WINDOWS:
        return d / "electron.exe"
    if platform.system() == "Darwin":
        return d / "Electron.app" / "Contents" / "MacOS" / "Electron"
    return d / "electron"


def instalado():
    return (CARPETA / "main.js").exists()


_HUELLA = ("resources.pak", "icudtl.dat", "snapshot_blob.bin", "v8_context_snapshot.bin", "chrome_100_percent.pak")
_AJENOS_WIN = ("chrome-sandbox", "chrome_crashpad_handler", "libffmpeg.so", "libvulkan.so.1", "electron")


def _huella_actual():
    d = _electron().parent
    return {n: (d / n).stat().st_size for n in _HUELLA if (d / n).exists()}


def motor_sano():
    """(ok, motivo). Detecta un motor mezclado o dañado (p. ej. archivos de otro sistema operativo dentro de dist)."""
    d = _electron().parent
    if not _electron().exists():
        return False, "falta su motor (Electron)"
    if IS_WINDOWS:
        ajenos = [n for n in _AJENOS_WIN if (d / n).exists()]
        if ajenos:
            return False, "su motor tiene archivos de otro sistema (" + ", ".join(ajenos) + ")"
    try:
        h = json.loads((d / ".huella.json").read_text(encoding="utf-8"))
        if h.get("archivos") and h["archivos"] != _huella_actual():
            return False, "los archivos de su motor cambiaron (dañados o mezclados)"
    except FileNotFoundError:
        pass
    except Exception:
        pass
    return True, ""


def _guardar_huella():
    try:
        (_electron().parent / ".huella.json").write_text(json.dumps({"so": platform.system(), "t": time.time(),
                                                                       "archivos": _huella_actual()}), encoding="utf-8")
    except Exception as e:
        _log(f"huella: {e}")


def _descargar_electron():
    pkg = CARPETA / "node_modules" / "electron" / "package.json"
    if not pkg.exists():
        raise RuntimeError("falta node_modules\\electron: instala Node.js y abre noviq-avatar\\iniciar.bat una vez")
    dist = pkg.parent / "dist"
    if not IS_WINDOWS and (dist / "electron.exe").exists():
        # 🛡 esa carpeta es de una instalación de Windows: nunca se le mezclan archivos de otro sistema
        raise RuntimeError("esa carpeta del avatar es de Windows: repárala desde Noviq en Windows")
    ver = json.loads(pkg.read_text(encoding="utf-8"))["version"]
    so = {"Windows": "win32", "Darwin": "darwin"}.get(platform.system(), "linux")
    maq = platform.machine().lower()
    arq = "arm64" if maq in ("arm64", "aarch64") else "ia32" if maq in ("x86", "i386", "i686") else "x64"
    nombre = f"electron-v{ver}-{so}-{arq}.zip"
    url = f"https://github.com/electron/electron/releases/download/v{ver}/{nombre}"
    try:
        sumas = json.loads((pkg.parent / "checksums.json").read_text(encoding="utf-8"))
    except Exception:
        sumas = {}
    destino_zip = DATA_DIR / nombre
    _E["reparacion"] = f"Descargando el motor del avatar (Electron {ver}, ~160 MB)…"
    _log("descargando " + url)
    h = hashlib.sha256()
    with requests.get(url, stream=True, timeout=(15, 120)) as r:
        r.raise_for_status()
        total, hecho = int(r.headers.get("content-length") or 0), 0
        with open(destino_zip, "wb") as f:
            for trozo in r.iter_content(1 << 20):
                f.write(trozo)
                h.update(trozo)
                hecho += len(trozo)
                if total:
                    _E["reparacion"] = f"Descargando el motor del avatar (Electron {ver})… {hecho * 100 // total}%"
    if sumas.get(nombre) and sumas[nombre] != h.hexdigest():
        destino_zip.unlink(missing_ok=True)
        raise RuntimeError("la descarga de Electron no coincide con su huella oficial (SHA-256): no la uso")
    _E["reparacion"] = "Descomprimiendo Electron…"
    if dist.exists():   # el motor anterior (quizá dañado) se aparta entero; nunca se mezclan versiones
        viejo = pkg.parent / f"dist_viejo_{int(time.time())}"
        try:
            dist.rename(viejo)
            shutil.rmtree(viejo, ignore_errors=True)
        except OSError:
            pass
    dist.mkdir(exist_ok=True)
    with zipfile.ZipFile(destino_zip) as z:
        z.extractall(dist)
    if so == "win32":
        for n in _AJENOS_WIN:
            try:
                (dist / n).unlink()
            except OSError:
                pass
    (pkg.parent / "path.txt").write_text({"win32": "electron.exe", "darwin": "Electron.app/Contents/MacOS/Electron"}.get(so, "electron"),
                                         encoding="utf-8")
    if so != "win32":
        try:
            _electron().chmod(0o755)
        except OSError:
            pass
    destino_zip.unlink(missing_ok=True)
    _guardar_huella()
    _log(f"Electron {ver} listo en {dist}")


def reparar(esperar=False, forzar_motor=False):
    """Deja el avatar listo para abrirse: dependencias (npm) y el motor Electron (descarga verificada si falta o está dañado)."""
    if _E["reparando"]:
        return {"ok": False, "error": "ya lo estoy reparando"}

    def trabajo():
        _E["reparando"], _E["reparacion"], _E["error"] = True, "Revisando el avatar…", ""
        try:
            if not instalado():
                raise RuntimeError(f"no encuentro el avatar en {CARPETA}")
            if not (CARPETA / "node_modules" / "ws" / "package.json").exists() or not (CARPETA / "node_modules" / "electron" / "package.json").exists():
                npm = shutil.which("npm")
                if not npm:
                    raise RuntimeError("faltan las dependencias del avatar y no hay Node.js: instálalo desde https://nodejs.org")
                _E["reparacion"] = "Instalando dependencias del avatar (npm install)…"
                r = subprocess.run([npm, "install", "--no-audit", "--no-fund"], cwd=str(CARPETA), capture_output=True, text=True,
                                   timeout=1200, creationflags=NO_WINDOW)
                _log("npm install → " + str(r.returncode) + " " + (r.stderr or "")[-300:])
            sano, motivo = motor_sano()
            if forzar_motor or not sano:
                if motivo:
                    _log("motor: " + motivo + " → lo vuelvo a descargar")
                _descargar_electron()
            elif not (_electron().parent / ".huella.json").exists():
                _guardar_huella()
            if not _electron().exists():
                raise RuntimeError("no pude preparar Electron")
            _E["reparacion"] = "✔ Avatar listo"
        except Exception as e:
            _E["error"] = str(e)[:300]
            _E["reparacion"] = "✖ " + _E["error"]
            _log("reparar: " + _E["error"])
        finally:
            _E["reparando"] = False

    if esperar:
        trabajo()
        return {"ok": not _E["error"], "error": _E["error"] or None}
    threading.Thread(target=trabajo, daemon=True, name="avatar-reparar").start()
    return {"ok": True}


def _vincular():
    return _av({"cmd": "vincular", "url": _E["url"], "token": _E["token"], "lanzado": _E["lanzado_por_mi"]})


def abrir(motivo="", forzar=False):
    """Abre el avatar si no está abierto (y lo conecta). Devuelve True si queda funcionando."""
    if not _cfg()["activo"] and not forzar:
        return False
    with _lanzar_lock:
        if _vivo():
            _vincular()
            return True
        if not instalado():
            _E["error"] = f"no encuentro la carpeta del avatar ({CARPETA})"
            return False
        ahora = time.time()
        _E["intentos"] = [t for t in _E["intentos"] if ahora - t < 600]
        if len(_E["intentos"]) >= 3 and not forzar:
            return False   # se cayó 3 veces en 10 min: espera (el usuario puede abrirlo desde Ajustes)
        _E["intentos"].append(ahora)
        sano, motivo_motor = motor_sano()
        if not sano:
            _log("antes de abrir: " + motivo_motor)
            if not reparar(esperar=True)["ok"]:
                return False
        env = dict(os.environ, NOVIQ_APP_URL=_E["url"], NOVIQ_APP_TOKEN=_E["token"], NOVIQ_DATOS=str(DATA_DIR))
        for k in ("NOVIQ_TOKEN", "ELECTRON_RUN_AS_NODE", "ELECTRON_NO_ATTACH_CONSOLE"):
            env.pop(k, None)
        try:
            log = open(DATA_DIR / "avatar.log", "a", encoding="utf-8")
            log.write(time.strftime("%Y-%m-%d %H:%M:%S") + f" [agente] abro el avatar ({motivo or 'inicio'})\n")
            log.flush()
            try:
                _E["proc"] = subprocess.Popen([str(_electron()), str(CARPETA)], cwd=str(CARPETA), env=env, stdin=subprocess.DEVNULL,
                                              stdout=log, stderr=log, creationflags=DETACHED, close_fds=True)
            finally:
                log.close()   # el avatar tiene su propia copia del archivo
            _E["lanzado_por_mi"], _E["cerrado_usuario"] = True, False
        except Exception as e:
            _E["error"] = f"no pude abrir el avatar: {e}"
            _log(_E["error"])
            return False
        for _ in range(40):   # hasta 20 s
            time.sleep(0.5)
            if _E["proc"].poll() is not None:
                codigo = _E["proc"].returncode
                _E["error"] = f"el avatar se cerró al abrir (código {codigo}); mira datos\\avatar.log y datos\\avatar_arranque.log"
                _log(_E["error"])
                # 🛠 se cayó al arrancar (p. ej. 0xFFFF7003 = Electron reventó): 2 caídas seguidas → se vuelve a bajar su motor
                _E["caidas"] = [t for t in _E["caidas"] if time.time() - t < 900] + [time.time()]
                if len(_E["caidas"]) >= 2 and time.time() - _E["reparado_auto"] > 3600:
                    _E["reparado_auto"] = time.time()
                    _log("se cayó 2 veces al abrir: reparo su motor")
                    threading.Thread(target=lambda: reparar(esperar=True, forzar_motor=True) and None, daemon=True).start()
                return False
            if _vivo(0.8):
                _vincular()
                _E["error"], _E["caidas"] = "", []
                return True
        _E["error"] = "el avatar no respondió en su puerto " + str(_puerto())
        return False


def cerrar(despedirse=True):
    if despedirse:
        _av({"cmd": "secuencia", "pasos": [{"cmd": "aviso", "tipo": "adios", "texto": fr("adios")},
                                           {"cmd": "esperar", "ms": 1600}, {"cmd": "salir"}]}, espera=0.8)
    else:
        _av({"cmd": "salir"}, espera=0.8)


def apagar():
    """Lo llama Noviq justo antes de cerrarse (os._exit): el avatar se despide y se cierra si lo abrió Noviq."""
    try:
        from . import voz as V
        V.cerrar()
    except Exception:
        pass
    if _pref("cerrarConNoviq") and _E["lanzado_por_mi"]:
        cerrar(despedirse=True)


# ═════════════════════════════ Observador de los trabajos (lo llama app.py) ═════════════════════════════
def evento(cid, kind, payload, conv):
    """Rápido y sin bloquear: la IA sigue trabajando mientras el agente decide qué mostrar."""
    if kind in ("token", "reasoning", "tool_delta", "tool_output", "tool_result", "plan_stream", "plan_done", "usage", "assistant_break",
                "reset_segment", "notice", "status", "image", "file", "project", "error"):
        return
    try:
        _cola.put_nowait(("ev", cid, kind, payload or {}, conv))
    except queue.Full:
        pass


def fin_trabajo(conv, resumen, error=None, detenido=False):
    try:
        _cola.put_nowait(("fin", conv.get("id"), resumen or "", error, detenido, conv))
    except queue.Full:
        pass


ICONOS = [  # (patrón de herramienta, icono del visor, animación)
    (r"^(escribir_archivo|editar_archivo|deshacer_cambio|versiones_archivo|guardar)", "codigo", "textear"),
    (r"^(leer_archivo|listar_directorio|buscar_archivos|buscar_en_archivos|mapa_codigo|localizar_error|indice)", "lupa", "analizar"),
    (r"^(ejecutar_powershell|ejecutar_python|ejecutar_linux|procesos|contenedor)", "terminal", "trabajar"),
    (r"^(buscar_en_internet|leer_pagina_web|agente_navegador|probar_web|peticion_http)", "web", "analizar"),
    (r"^(descargar_archivo|biblioteca)", "nube", "trabajar"),
    (r"^(generar_imagen|figuras|juego|nvidia_ia|modelo_3d|textura)", "camara", "trabajar"),
    (r"^(captura_pantalla|control_pc|agente_pc)", "camara", "analizar"),
    (r"^(memoria)", "chip", None),
    (r"^(actualizar_tareas|marcar_tarea)", "ok", None),
    (r"^(probar_proyecto|diagnosticar|puntos_restauracion)", "escudo", "analizar"),
    (r"^(correo|telegram)", "mensaje", "textear"),
    (r"^(agenda|programar_tarea)", "reloj", None),
    (r"^(planificar_en_equipo|trabajar_en_equipo|pedir_relevo|agente_mcp|mcp__)", "red", "trabajar"),
    (r"^(crear_proyecto|cambiar_proyecto|empaquetar_proyecto|mover_o_copiar)", "carpeta", "trabajar"),
    (r"^(instalar_herramienta|entorno)", "llave", "trabajar"),
    (r"^(eliminar)", "candado", "trabajar"),
    (r"^(oficina)", "documento", "trabajar"),
]


def _icono(nombre):
    for pat, ic, acc in ICONOS:
        if re.match(pat, nombre or ""):
            return ic, acc
    return "engranaje", "trabajar"


def _actividad():
    _E["actividad"] = time.time()


def _cancelar_que_mas(tambien_pregunta=True):
    t = _E.get("que_mas_timer")
    if t:
        t.cancel()
        _E["que_mas_timer"] = None
    if tambien_pregunta and _pend.get("tipo") == "que_mas":
        _pend.clear()


def _reanimar():
    """Tras un aviso, los trabajos que siguen vuelven a animarse con su próxima herramienta."""
    for t in _trab.values():
        t["anim"], t["t_anim"], t["tareas"] = None, 0, None


def _abrir_pregunta(tipo, texto, cid=None, pid=None, guardia=False, segundos=30, aviso="pregunta"):
    _pend.clear()
    _pend.update({"tipo": tipo, "id": pid, "cid": cid, "t": time.time(), "texto": texto, "guardia": bool(guardia), "hasta": time.time() + segundos})
    decir(texto, aviso, fijo=tipo in ("permiso", "ayuda", "plan"))
    _mandar({"cmd": "escuchar_respuesta", "segundos": segundos})   # el avatar acepta la respuesta sin que digas su nombre
    _ui_push({"tipo": "pregunta", "pregunta": tipo, "texto": texto})


def _evento_app(tipo, **datos):
    """Le cuenta al avatar lo que pasó en Noviq (queda en su memoria de charla y en el estado de sus planes)."""
    threading.Thread(target=_av_api, args=("POST", "/api/eventos-app", dict(datos, app="noviq", tipo=tipo, actividad=False)),
                     daemon=True).start()


def _procesar_ev(cid, kind, p, conv):
    c = _cfg()
    if kind == "inicio":
        _actividad()
        _cancelar_que_mas()
        voz = time.time() - max(_E["voz_ui_t"], _E["voz_backend_t"]) < 12 or conv.get("origen") == "voz"
        _trab[cid] = {"t0": time.time(), "titulo": conv.get("title") or "", "anim": None, "t_anim": 0, "t_herr": 0, "voz": voz,
                      "tareas": None, "origen": conv.get("origen") or ""}
        if not _E["vivo"] and c["activo"]:
            threading.Thread(target=abrir, args=("trabajo",), daemon=True).start()
            return
        if not _pref("avisosTrabajo") and not voz:
            return
        if voz or _pref("anunciarInicio"):
            decir(fr("empiezo"), "trabajando")
        else:
            _av({"cmd": "aviso", "tipo": "trabajando"})
        _trab[cid]["anim"], _trab[cid]["t_anim"] = "trabajar", time.time()
        return
    t = _trab.get(cid)
    if t is None:
        return
    if kind == "tool_start":
        _actividad()
        ahora = time.time()
        if not _pref("avisosTrabajo") or ahora - t["t_herr"] < 2.5 or _pend:
            return
        t["t_herr"] = ahora
        ic, acc = _icono(p.get("name") or "")
        _av({"cmd": "herramienta", "nombre": ic, "duracion": 2600})
        if acc and acc != t["anim"] and ahora - t["t_anim"] > 6:
            t["anim"], t["t_anim"] = acc, ahora
            _av({"cmd": acc, "duracion": 0})
        if _pref("burbujasHerramientas"):
            a = p.get("args") or {}
            det = a.get("ruta") or a.get("archivo") or a.get("url") or a.get("consulta") or a.get("comando") or ""
            det = Path(str(det)).name if a.get("ruta") or a.get("archivo") else str(det)
            _av({"cmd": "mensaje", "texto": _corto((p.get("label") or "") + (" · " + det if det else ""), 70), "tipo": "pensamiento",
                 "duracion": 2200})
    elif kind == "tasks":
        if not _pref("avisosTrabajo"):
            return
        ts = p.get("tasks") or []
        if len(ts) < 2:
            return
        hechas = sum(1 for x in ts if x.get("estado") == "completada")
        actual = next((x.get("contenido") for x in ts if x.get("estado") == "en_progreso"), "") or ""
        clave = (hechas, len(ts), actual)
        if clave == t["tareas"] or _pend:
            return
        t["tareas"] = clave
        t["anim"], t["t_anim"] = "progreso", time.time()
        _av({"cmd": "progreso", "valor": round(hechas * 100 / len(ts)), "etiqueta": _corto(actual or f"{hechas}/{len(ts)}", 34)})
    elif kind == "confirm":
        _actividad()
        g = bool(p.get("guardia"))
        l_ = _corto(p.get("label") or p.get("name") or "", 60)
        _abrir_pregunta("permiso", fr("permiso_g" if g else "permiso", l=l_), cid, p.get("id"), g, 40, "permiso")
    elif kind == "ask_user":
        _actividad()
        _abrir_pregunta("ayuda", fr("ayuda", i=_corto(p.get("instrucciones"), 130)), cid, p.get("id"), False, 60, "pregunta")
    elif kind == "plan_review":
        _actividad()
        _abrir_pregunta("plan", fr("plan"), cid, p.get("id"), False, 40, "pregunta")
    elif kind == "model_switch":
        m = str(p.get("model") or "").split("::")[-1].split("/")[-1]
        if m and _pref("avisosTrabajo"):
            _av({"cmd": "mensaje", "texto": ("🔁 " + ("Switching to " if _en() else "Cambio a ") + m), "tipo": "pensamiento", "duracion": 2500})
    elif kind == "fase":
        if p.get("fase") == "pensando" and time.time() - t.get("t_fase", 0) > 8 and _pref("avisosTrabajo"):
            t["t_fase"] = time.time()
            _av({"cmd": "expresion", "valor": "pensando", "duracion": 2500})


def _procesar_fin(cid, resumen, error, detenido, conv):
    t = _trab.pop(cid, None) or {}
    _evento_app("fin_trabajo", conv=cid, resumen=_corto(_limpio_md(resumen), 400) if resumen else "", error=str(error)[:300] if error else None,
                titulo=conv.get("title") or t.get("titulo") or "")
    if _pend.get("cid") == cid and _pend.get("tipo") in ("permiso", "ayuda", "plan"):
        _pend.clear()
        _av({"cmd": "callar"})
    _actividad()
    otros = len(_trab)
    titulo = _corto(conv.get("title") or t.get("titulo") or "", 40)
    if not _pref("avisosTrabajo") and not t.get("voz") and not error:
        return
    if detenido:
        decir(fr("detenido"), "info")
    elif error:
        e = _corto(re.sub(r"^\w+Error:\s*", "", str(error)), 90)
        _abrir_pregunta("continuar", fr("fin_error", e=e), cid, None, False, 30, "error")
    else:
        if t.get("voz") and resumen:
            texto = _resumen_hablado(resumen) or fr("fin")
            decir(texto, "exito")
        elif otros:
            decir(fr("fin_t", t=titulo) if titulo else fr("fin"), "exito")
        else:
            decir(fr("fin"), "exito")
    if otros:
        _reanimar()   # los otros trabajos siguen: su próxima herramienta lo vuelve a animar
        return
    if _pref("queMas") and not error and not detenido:
        _cancelar_que_mas()

        def preguntar():
            _E["que_mas_timer"] = None
            if _trab or _pend:
                return
            _abrir_pregunta("que_mas", fr("que_mas"), None, None, False, 20, "pregunta")
        tm = threading.Timer(7.0 if t.get("voz") else 5.0, lambda: _cola.put(("fn", preguntar)))
        tm.daemon = True
        _E["que_mas_timer"] = tm
        tm.start()


# ═════════════════════════════ Hilos del agente ═════════════════════════════
def _procesador():
    while True:
        item = _cola.get()
        try:
            if item[0] == "cmd":
                _av(item[1])
            elif item[0] == "ev":
                _procesar_ev(*item[1:])
            elif item[0] == "fin":
                _procesar_fin(*item[1:])
            elif item[0] == "fn":
                item[1]()
        except Exception as e:
            _log(f"procesador: {type(e).__name__}: {e}")


def _pregunta_resuelta():
    """¿Ya se respondió (desde la ventana, Telegram o por voz) la pregunta abierta?"""
    tp, pid = _pend.get("tipo"), _pend.get("id")
    try:
        if tp == "permiso":
            from .agent import PENDING
            return pid not in PENDING
        if tp == "ayuda":
            from .tools import ASK
            return pid not in ASK
        if tp == "plan":
            from .cerebro import PLANS
            return pid not in PLANS
    except Exception:
        return False
    if tp in ("continuar", "que_mas"):
        return time.time() - _pend.get("t", 0) > 180
    return False


def _convs_a_medias(n=15, dias=3):
    """Conversaciones recientes que quedaron a medias (y que no están trabajando)."""
    out = []
    try:
        from .server_state import list_convs, load_conv
        for cv in list_convs()[:n]:
            if time.time() - float(cv.get("updated") or 0) > dias * 86400:
                break
            if cv["id"] in _trab:
                continue
            c = load_conv(cv["id"]) or {}
            if c.get("en_progreso"):
                out.append({"id": cv["id"], "title": c.get("title") or cv.get("title") or ""})
    except Exception as e:
        _log(f"a medias: {e}")
    return out


def _hay_a_medias():
    """Conversación que quedó a medias y que el director no va a continuar solo (se ofrece una vez cada 2 h)."""
    if (CONFIG.get("director") or {}).get("activo", True):
        return None
    for cv in _convs_a_medias():
        if time.time() - _E["ofrecidos"].get(cv["id"], 0) > 7200:
            return cv
    return None


def _vigilante():
    ultimo_chequeo, ultimo_medias = 0, time.time()
    while True:
        time.sleep(1.0)
        try:
            c = _cfg()
            ahora = time.time()
            if _pend and _pregunta_resuelta():
                tp = _pend.get("tipo")
                _pend.clear()
                if tp in ("permiso", "ayuda", "plan"):
                    _av({"cmd": "callar"})
                    _av({"cmd": "asentir"})
                    _reanimar()
            if ahora - ultimo_chequeo < 10:
                continue
            ultimo_chequeo = ahora
            if not c["activo"]:
                continue
            estado = _vivo()
            if estado is None:
                necesita = bool(_trab) or not _E["cerrado_usuario"]
                if necesita and not _E["reparando"] and not _lanzar_lock.locked():
                    threading.Thread(target=abrir, args=("vigilante",), daemon=True).start()
                continue
            nv = estado.get("noviq") or {}
            if not nv.get("conectado") and ahora - _E["latido"] > 25:
                _vincular()
            if _pref("ofrecerContinuar") and not _trab and not _pend and ahora - ultimo_medias > 60:
                ultimo_medias = ahora
                cv = _hay_a_medias()
                if cv:
                    _E["ofrecidos"][cv["id"]] = ahora
                    _cola.put(("fn", lambda cv=cv: _abrir_pregunta("continuar", fr("a_medias", t=_corto(cv.get("title"), 40)),
                                                                     cv["id"], None, False, 30, "pregunta")))
        except Exception as e:
            _log(f"vigilante: {type(e).__name__}: {e}")


def _al_listo():
    """El avatar terminó de arrancar. Si quedó algo a medias, Noviq saluda ofreciéndolo (y el avatar no repite saludo).
    Devuelve True si Noviq dio el saludo."""
    _E["listo_t"] = time.time()
    if _E["saludado"]:
        return bool(_trab)
    _E["saludado"] = True
    for _cid in list(_trab):
        _mandar({"cmd": "aviso", "tipo": "trabajando"})
        return True
    cv = _hay_a_medias() if _pref("ofrecerContinuar") else None
    if cv:
        _E["ofrecidos"][cv["id"]] = time.time()
        _cola.put(("fn", lambda: _abrir_pregunta("continuar", fr("hola_pend", t=_corto(cv.get("title"), 40)), cv["id"], None, False, 30,
                                                 "saludo")))
        return True
    return False


def iniciar(puerto, token):
    """Lo llama app.main() al arrancar Noviq."""
    _E["url"], _E["token"] = f"http://127.0.0.1:{puerto}", token
    if _E["iniciado"]:
        return
    _E["iniciado"] = True
    threading.Thread(target=_procesador, daemon=True, name="avatar-agente").start()
    threading.Thread(target=_vigilante, daemon=True, name="avatar-vigilante").start()

    def arranque():
        try:
            from . import voces as VC
            VC.asegurar()   # 🗣 voces de Noviq que el avatar puede usar (motor «noviq»)
        except Exception as e:
            _log(f"voces: {e}")
        try:
            from . import voz as V
            V.asegurar_motor()
        except Exception as e:
            _log(f"voz: {e}")
        if _cfg()["activo"]:
            if _vivo():
                _vincular()
            else:
                abrir("inicio de Noviq")
    threading.Thread(target=arranque, daemon=True, name="avatar-arranque").start()


# ═════════════════════════════ Voz: lo que es de Noviq ═════════════════════════════
def _norm(t):
    t = unicodedata.normalize("NFD", str(t or "").lower())
    t = "".join(ch for ch in t if unicodedata.category(ch) != "Mn")
    return re.sub(r"\s+", " ", re.sub(r"[^\w\s]", " ", t)).strip()


SI = re.compile(r"^(si|sip|claro|dale|ok|okay|vale|adelante|aprueba\w*|hazlo|de acuerdo|correcto|por supuesto|continua\w*|sigue|yes|sure|go ahead|approve\w*)\b")
NO = re.compile(r"^(no|nop|nel|rechaza\w*|cancela\w*|mejor no|no lo hagas|nope|deny|reject)\b")
NADA = re.compile(r"^(nada|nada mas|eso es todo|ya esta|por ahora nada|ninguna|nothing|that s all|no thanks|no gracias)\b")
DETENER = re.compile(r"^(detente|detenlo|deten\w*|para|paralo|alto|stop|cancela todo|basta de trabajar)\b")
CONTINUAR = re.compile(r"^(continua\w*|sigue|prosigue|retoma\w*|continue|keep going|resume)\b")
ESTADO = re.compile(r"^(estado|status)\b|que (estas|andas) haciendo|que haces|como vas|en que vas|que tal vas|what are you doing|how is it going")
ABRIR = re.compile(r"(abre|abrir|muestra\w*|ensena\w*|open|show)\s+(la ventana|el programa|el chat|noviq|me noviq|noviq por favor)")
NUEVA = re.compile(r"^(nueva conversacion|nuevo chat|new chat|new conversation)\b\W*", re.I)


def _mcp():
    import sys
    if str(BASE_DIR) not in sys.path:
        sys.path.insert(0, str(BASE_DIR))
    import noviq_mcp
    return noviq_mcp


def _trabajando():
    try:
        r = _mcp()._json("GET", "/api/trabajando")
        return r if isinstance(r, list) else []
    except Exception:
        return []




def _estado():
    try:
        return json.loads(ESTADO_F.read_text(encoding="utf-8"))
    except Exception:
        return {}


def _guardar_estado(**kw):
    d = _estado()
    d.update(kw)
    try:
        ESTADO_F.write_text(json.dumps(d, ensure_ascii=False), encoding="utf-8")
    except OSError:
        pass


def _continuar(cid):
    def trabajo():
        try:
            _E["voz_backend_t"] = time.time()
            _mcp().FUNCS["noviq_continuar"]({"conversation_id": cid, "esperar": False})
        except Exception as e:
            decir(str(e)[:150], "error")
    threading.Thread(target=trabajo, daemon=True).start()


def _existe_conv(cid):
    try:
        from .server_state import load_conv
        return bool(cid and load_conv(cid))
    except Exception:
        return False


def _pedir_backend(texto, nueva=False, aviso_ocupado=False, proyecto=None):
    """Noviq hace el pedido en la conversación de voz de ese proyecto (o la general), SIN tocar lo que tienes abierto en la
    ventana: así las consultas del avatar no se mezclan con tus chats de proyecto. Devuelve el id de la conversación."""
    try:
        ocupados = {x.get("id") for x in _trabajando()}
        est = _estado()
        convs = est.get("convs_voz") or {}
        clave = proyecto or ""
        cid = None
        if not nueva:
            c0 = convs.get(clave) or (est.get("conv") if not proyecto else None)
            if c0 and c0 not in ocupados and _existe_conv(c0):
                cid = c0
        if aviso_ocupado:
            decir(fr("ocupado"), "info")
        nuevo = cid or uuid.uuid4().hex[:16]   # id propio: se sabe al instante (sin esperar al trabajo)
        body = {"text": texto, "conversation_id": nuevo, "origen": "voz",
                "titulo": "🎙 " + (f"[{proyecto}] " if proyecto else "") + _corto(texto.split("\n\n(Pedido")[0], 50)}
        if proyecto and not cid:
            body["project"] = proyecto
        _E["voz_backend_t"] = time.time()
        r = _mcp()._api("POST", "/api/chat", body, stream=True, timeout=(10, 20))
        try:
            if r.status_code != 200:
                raise RuntimeError(f"{r.status_code}: {r.text[:200]}")
        finally:
            r.close()   # el trabajo sigue en Noviq (su propio hilo); el avatar lo sigue por los eventos
        convs[clave] = nuevo
        _guardar_estado(convs_voz=convs, **({} if proyecto else {"conv": nuevo}))
        _ui_push({"tipo": "trabajo", "conv": nuevo, "texto": _corto(texto.split("\n\n(Pedido")[0], 80), "proyecto": proyecto or ""})
        return nuevo
    except Exception as e:
        _log(f"pedir a Noviq: {type(e).__name__}: {e}")
        decir(("No pude mandarlo a Noviq: " if not _en() else "Couldn't send it to Noviq: ") + str(e)[:120], "error")
        return None


def _pedir(texto, nueva=False):
    """Pedido por voz al chat ABIERTO en la ventana de Noviq (se ve como si lo escribieras). Si no hay ventana o ese chat
    está ocupado, Noviq lo hace en la conversación de voz. → (destino, conv)"""
    if _UI and not nueva:
        it = {"id": uuid.uuid4().hex[:12], "texto": texto, "t": time.time(), "tomado": threading.Event(), "ok": False}
        _voz_items[it["id"]] = it
        _ui_push({"tipo": "voz", "id": it["id"], "texto": texto})
        if it["tomado"].wait(3.0) and it["ok"]:
            _E["voz_ui_t"] = time.time()
            _voz_items.pop(it["id"], None)
            return "ventana", _ui.get("conv")
        _voz_items.pop(it["id"], None)
        return "noviq", _pedir_backend(texto, False, it["tomado"].is_set(), proyecto=_ui.get("proyecto"))
    return "noviq", _pedir_backend(texto, nueva)


def tarea(texto, proyecto="", en_chat=False, nueva=False):
    """Orden de trabajo que manda el avatar: al chat abierto si es del mismo proyecto que estás viendo (o si lo pediste
    «en este chat»), si no a la conversación de voz de ese proyecto (sin tocar lo que tienes abierto)."""
    proj = proyecto or None
    ui_recien = _ui.get("conv") and time.time() - _ui.get("t", 0) < 900
    usar_ventana = bool(_UI) and not nueva and (en_chat or (proj and ui_recien and _ui.get("proyecto") == proj))
    if usar_ventana:
        return _pedir(texto)
    return "noviq", _pedir_backend(texto, nueva, proyecto=proj)


def escucha(texto, con_nombre=False):
    """Lo que el avatar oyó (ya sin su nombre): si es para Noviq lo resuelve aquí → {"tomado": True, …};
    si no, {"tomado": False} y lo decide la mente del avatar (charla, sus herramientas o una orden de trabajo)."""
    n = _norm(texto)
    tp = _pend.get("tipo")
    viva = bool(_pend)   # mientras Noviq espere la respuesta (sin su nombre solo dentro de la ventana que abre el avatar)
    if not n:
        return {"tomado": False}
    # ── respuestas a la pregunta abierta de Noviq
    if viva and tp == "permiso" and (SI.match(n) or NO.match(n)):
        if _pend.get("guardia"):
            decir(fr("permiso_g", l=""), "atencion")
            return {"tomado": True, "accion": "permiso_ventana"}
        from .agent import PENDING
        p = PENDING.get(_pend.get("id"))
        ok = bool(SI.match(n))
        if p:
            p["ok"], p["always"], p["via"] = ok, False, "voz"
            p["event"].set()
        _pend.clear()
        _mandar({"cmd": "callar"})
        decir(fr("aprobado" if ok else "rechazado"), "exito" if ok else "info")
        return {"tomado": True, "accion": "aprobado" if ok else "rechazado"}
    if viva and tp == "ayuda" and not DETENER.match(n):
        from .tools import ASK
        a = ASK.get(_pend.get("id"))
        if a:
            a["texto"], a["imagenes"] = texto, []
            a["event"].set()
        _pend.clear()
        _mandar({"cmd": "callar"})
        decir(fr("respuesta"), "info")
        return {"tomado": True, "accion": "respuesta"}
    if viva and tp == "plan" and (SI.match(n) or NO.match(n)):
        from . import cerebro as CB
        CB.responder(_pend.get("id"), "aprobar" if SI.match(n) else "cancelar")
        _pend.clear()
        _mandar({"cmd": "callar"})
        decir(fr("aprobado" if SI.match(n) else "rechazado"), "info")
        return {"tomado": True, "accion": "plan"}
    if viva and tp == "continuar" and (SI.match(n) or NO.match(n)):
        cid = _pend.get("cid")
        _pend.clear()
        if SI.match(n) and cid:
            decir(fr("continuo"), "trabajando")
            _continuar(cid)
            return {"tomado": True, "accion": "continuar"}
        decir(fr("vale"), "info")
        return {"tomado": True, "accion": "nada"}
    if viva and tp == "que_mas" and (NADA.match(n) or NO.match(n)):
        _pend.clear()
        decir(fr("aqui"), "info")
        return {"tomado": True, "accion": "nada"}
    # ── órdenes sobre los trabajos de Noviq (solo si hay trabajo: si no, lo responde el avatar)
    trab = _trabajando() if (DETENER.match(n) or ESTADO.search(n)) else []
    if DETENER.match(n) and trab:
        for j in trab if "todo" in n else trab[:1]:
            _mcp().FUNCS["noviq_detener"]({"conversation_id": j["id"]})
        return {"tomado": True, "accion": "detener"}
    if CONTINUAR.match(n) and len(n.split()) <= 4:
        cid = _pend.get("cid") if tp == "continuar" else None
        if not cid:
            medias = _convs_a_medias(20, dias=7)
            cid = medias[0]["id"] if medias else None
        if cid:
            _pend.clear()
            decir(fr("continuo"), "trabajando")
            _continuar(cid)
            return {"tomado": True, "accion": "continuar"}
    if ESTADO.search(n) and len(n.split()) <= 8 and trab:
        nombres = [f"«{_corto(j.get('title'), 32)}»" for j in trab[:3]]
        extra = ""
        t = _trab.get(trab[0].get("id")) or {}
        if t.get("tareas"):
            h, tot, act = t["tareas"]
            extra = (f" Voy en la tarea {min(h + 1, tot)} de {tot}" + (f": {_corto(act, 40)}." if act else ".")) if not _en() else \
                    f" Task {min(h + 1, tot)} of {tot}."
        if [j for j in trab if j.get("espera_permiso")]:
            extra += " Espera tu permiso." if not _en() else " Waiting for your permission."
        decir(fr("trabajando", l=(" y " if not _en() else " and ").join(nombres)) + extra, "info")
        return {"tomado": True, "accion": "estado"}
    if ABRIR.search(n) and len(n.split()) <= 6:
        decir(fr("abro"), "info", voz=False)
        _abrir_ventana()
        return {"tomado": True, "accion": "abrir"}
    m = NUEVA.match(n)
    if m:
        resto = texto.split(None, 2)[-1] if len(texto.split()) > 2 else ""
        if not resto.strip():
            _mandar({"cmd": "escuchar_respuesta", "segundos": 15})
            decir(fr("escucho"), "escuchando")
            return {"tomado": True, "accion": "escuchar", "escuchar_otra_vez": True}
        decir(fr("empiezo"), "trabajando")
        destino, cid = _pedir(resto, nueva=True)
        return {"tomado": True, "accion": "pedido", "destino": destino, "conv": cid}
    if tp in ("que_mas", "continuar"):
        _pend.clear()   # habló de otra cosa: la pregunta se da por contestada
    return {"tomado": False}


def _abrir_ventana():
    try:
        import webview
        if webview.windows:
            w = webview.windows[0]
            for f in ("restore", "show"):
                try:
                    getattr(w, f)()
                except Exception:
                    pass
            try:
                w.on_top = True
                time.sleep(0.25)
                w.on_top = False
            except Exception:
                pass
            return True
    except Exception:
        pass
    if not _UI:   # sin ninguna ventana de Noviq abierta: abrir una
        def abrir_app():
            try:
                import noviq_app
                if not noviq_app.ventana_app(_E["url"]):
                    import webbrowser
                    webbrowser.open(_E["url"])
            except Exception:
                import webbrowser
                webbrowser.open(_E["url"])
        threading.Thread(target=abrir_app, daemon=True).start()
    else:
        _ui_push({"tipo": "enfocar"})
    return True


# ═════════════════════════════ Ventanas de Noviq (SSE) ═════════════════════════════
def _ui_push(ev):
    for q in list(_UI):
        try:
            q.put_nowait(ev)
        except queue.Full:
            pass


@bp.get("/api/avatar/eventos")
def ui_eventos():
    q = queue.Queue(maxsize=100)
    _UI.append(q)

    def gen():
        try:
            yield "event: hola\ndata: " + json.dumps({"oido": _E["oido"], "vivo": _E["vivo"]}) + "\n\n"
            while True:
                try:
                    ev = q.get(timeout=20)
                except queue.Empty:
                    yield ": ping\n\n"
                    continue
                yield f"event: {ev.get('tipo', 'msg')}\ndata: {json.dumps(ev, ensure_ascii=False)}\n\n"
        finally:
            try:
                _UI.remove(q)
            except ValueError:
                pass
    return Response(stream_with_context(gen()), mimetype="text/event-stream", headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@bp.post("/api/avatar/tomado")
def ui_tomado():
    d = request.get_json(force=True, silent=True) or {}
    it = _voz_items.get(d.get("id"))
    if it:
        it["ok"] = bool(d.get("ok"))
        it["tomado"].set()
    return jsonify({"ok": bool(it)})


@bp.post("/api/avatar/contexto")
def ui_contexto():
    d = request.get_json(force=True, silent=True) or {}
    _ui["conv"], _ui["t"], _ui["proyecto"] = d.get("conversation_id") or None, time.time(), d.get("proyecto") or None
    return jsonify({"ok": True})


# ═════════════════════════════ Rutas que usa el avatar ═════════════════════════════
@bp.get("/api/avatar/latido")
def latido():
    _E["latido"] = time.time()
    return jsonify({"ok": True, "version": VERSION, "trabajando": len(_trab), "pregunta": _pend.get("tipo")})


@bp.post("/api/avatar/evento")
def av_evento():
    d = request.get_json(force=True, silent=True) or {}
    n, datos = d.get("nombre"), d.get("datos") or {}
    _E["latido"] = time.time()
    if n == "listo":
        return jsonify({"ok": True, "saludo": _al_listo()})
    if n == "ajustes":
        # preferencias del avatar que le importan a Noviq (cómo avisar de sus trabajos, su nombre…)
        prev = _cfg().get("desde_avatar") or {}
        nuevo = {"noviq": datos.get("noviq") or {}, "nombre": datos.get("nombre") or "Noviq", "voz": bool(datos.get("voz")),
                 "api": datos.get("api") or "", "version": datos.get("version") or ""}
        if nuevo != prev:
            CONFIG.setdefault("avatar", {})["desde_avatar"] = nuevo
            save_config()
        _ui_push({"tipo": "ajustes_avatar"})
    elif n == "oido":
        _E["oido"] = {k: datos.get(k) for k in ("modo", "estado", "error")}
        _ui_push({"tipo": "oido", "oido": _E["oido"]})
    elif n == "clic":
        if _pend.get("tipo") in ("permiso", "ayuda", "plan"):
            _abrir_ventana()
            decir(_pend.get("texto") or "", "atencion", fijo=True)
    elif n == "abrir":
        _abrir_ventana()
    elif n == "proyecto":
        _ui_push({"tipo": "proyecto", "proyecto": datos.get("proyecto")})
        if datos.get("abrir"):
            _abrir_ventana()
    elif n == "respuesta":
        pass   # (Noviq usa /api/avatar/escucha para sus preguntas)
    elif n == "salir":
        _E["cerrado_usuario"] = True
        _E["vivo"] = False
    return jsonify({"ok": True})


@bp.post("/api/avatar/escucha")
def av_escucha():
    """El avatar oyó algo: ¿es para Noviq? (permiso, pregunta de la IA, «detente», «continúa», «¿cómo vas?»…)."""
    d = request.get_json(force=True, silent=True) or {}
    try:
        r = escucha(str(d.get("texto") or ""), bool(d.get("con_nombre")))
    except Exception as e:
        _log(f"escucha: {type(e).__name__}: {e}")
        r = {"tomado": False}
    if r.get("tomado"):
        _ui_push({"tipo": "oi", "texto": d.get("texto"), "accion": r.get("accion")})
    return jsonify(dict(r, ok=True))


@bp.post("/api/avatar/tarea")
def av_tarea():
    """Orden de trabajo desde la mente del avatar → agentes de Noviq (con todas sus herramientas)."""
    d = request.get_json(force=True, silent=True) or {}
    texto = str(d.get("tarea") or "").strip()
    if not texto:
        return jsonify({"ok": False, "error": "falta «tarea»"}), 400
    proyecto = str(d.get("proyecto") or "").strip()
    if proyecto:
        try:
            ps = [p["name"] for p in (_mcp()._json("GET", "/api/projects").get("projects") or []) if p.get("name")]
            if proyecto not in ps:
                proyecto = ""
        except Exception:
            pass
    destino, cid = tarea(texto[:8000], proyecto, bool(d.get("en_chat")), bool(d.get("nueva")))
    if destino != "ventana" and not cid:
        return jsonify({"ok": False, "error": "Noviq no pudo empezar el trabajo"})
    return jsonify({"ok": True, "destino": destino, "conv": cid, "proyecto": proyecto or None})


@bp.get("/api/avatar/contexto-noviq")
def av_contexto_noviq():
    """Lo que pasa en Noviq, para que la mente del avatar lo tenga en cuenta."""
    try:
        ps = [p["name"] for p in (_mcp()._json("GET", "/api/projects").get("projects") or []) if p.get("name")]
    except Exception:
        ps = []
    trab = [{"titulo": t.get("titulo") or "", "voz": t.get("voz")} for t in _trab.values()]
    return jsonify({"ok": True, "proyectos": ps[:60], "trabajando": trab, "pregunta": _pend.get("texto"),
                    "ui": {"conv": _ui.get("conv"), "proyecto": _ui.get("proyecto")}})


# ── Herramientas de Noviq que el avatar puede usar directamente (las de trabajo pesado van por /api/avatar/tarea)
def _h_estado(a):
    trab = _trabajando()
    if not trab:
        return "Noviq está libre (no está trabajando en nada)."
    return "Noviq trabaja en: " + "; ".join(f"{_corto(j.get('title'), 50)}" + (" (espera permiso)" if j.get("espera_permiso") else "") for j in trab[:5])


def _h_proyectos(a):
    r = _mcp()._json("GET", "/api/projects")
    ps = r.get("projects") or []
    return "Proyectos: " + ", ".join(p.get("name") for p in ps[:40] if p.get("name")) if ps else "No hay proyectos."


def _h_agenda(a):
    from . import agenda
    dias = agenda.semana(dias=int(a.get("dias") or 3))
    out = []
    for d in dias:
        if d.get("items"):
            out.append(f"{d.get('dia') or d.get('fecha')}: " + "; ".join(f"{i['hora']} {i['nombre']}" for i in d["items"][:6]))
    return "\n".join(out) or "No hay tareas programadas en Noviq para esos días."


def _h_notas(a):
    from . import agenda
    ns = agenda.notas(12, buscar=a.get("buscar") or None)
    return "\n".join(f"- {_corto(n.get('texto'), 200)}" for n in ns) or "Sin notas."


def _h_detener(a):
    trab = _trabajando()
    for j in trab[:1] if not a.get("todo") else trab:
        _mcp().FUNCS["noviq_detener"]({"conversation_id": j["id"]})
    return f"Detuve {len(trab[:1] if not a.get('todo') else trab)} trabajo(s)." if trab else "No había nada trabajando."


def _h_continuar(a):
    medias = _convs_a_medias(20, dias=7)
    if not medias:
        return "No hay nada a medias."
    _continuar(medias[0]["id"])
    return f"Continúo «{_corto(medias[0].get('title'), 50)}»."


def _h_abrir(a):
    _abrir_ventana()
    return "Abrí la ventana de Noviq."


HERR_NOVIQ = {
    "noviq_estado": ("qué está haciendo Noviq ahora (trabajos en curso, si espera permiso)", "{}", True, _h_estado),
    "noviq_proyectos": ("lista los proyectos de Noviq", "{}", True, _h_proyectos),
    "noviq_agenda": ("tareas programadas de Noviq de los próximos días", '{"dias":3}', True, _h_agenda),
    "noviq_notas": ("notas recientes de lo que hizo Noviq (resultados de tareas, aprobaciones)", '{"buscar":"opcional"}', True, _h_notas),
    "noviq_detener": ("detiene el trabajo de Noviq", '{"todo":false}', False, _h_detener),
    "noviq_continuar": ("continúa lo que quedó a medias en Noviq", "{}", False, _h_continuar),
    "noviq_abrir": ("muestra la ventana de Noviq", "{}", False, _h_abrir),
}


@bp.get("/api/avatar/herramientas")
def av_herramientas():
    return jsonify({"ok": True, "herramientas": [{"nombre": k, "desc": v[0], "args": v[1], "info": v[2]} for k, v in HERR_NOVIQ.items()]})


@bp.post("/api/avatar/herramienta")
def av_herramienta():
    d = request.get_json(force=True, silent=True) or {}
    h = HERR_NOVIQ.get(str(d.get("nombre") or ""))
    if not h:
        return jsonify({"ok": False, "error": "herramienta desconocida"}), 404
    try:
        return jsonify({"ok": True, "resultado": h[3](d.get("args") or {})})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"[:300]})


@bp.post("/api/avatar/pensar")
def av_pensar():
    """La IA más rápida de Noviq (la del 🧪 banco de pruebas) para la mente del avatar."""
    from . import rapida
    d = request.get_json(force=True, silent=True) or {}
    msgs = [m for m in (d.get("mensajes") or []) if isinstance(m, dict) and m.get("role") in ("user", "assistant")]
    if not msgs or msgs[-1].get("role") != "user":
        return jsonify({"ok": False, "error": "falta el mensaje del usuario"}), 400
    try:
        txt, modelo, ms = rapida.responder(str(d.get("sistema") or "")[:20000], str(msgs[-1].get("content") or "")[:8000],
                                           max_tokens=int(d.get("max_tokens") or 500), limite_seg=20, intentos=2,
                                           historial=[{"role": m["role"], "content": str(m.get("content") or "")[:2000]} for m in msgs[:-1]][-14:],
                                           temperatura=float(d.get("temperatura") if d.get("temperatura") is not None else 0.6))
        return jsonify({"ok": True, "texto": txt, "modelo": modelo, "ms": ms})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:300]})


@bp.post("/api/avatar/stt")
def av_stt():
    """Oído de Noviq (faster-whisper local, NVIDIA, Groq…) para el avatar: audio WAV base64 → texto."""
    from . import voz as V
    d = request.get_json(force=True, silent=True) or {}
    try:
        texto, motor = V.transcribir(d.get("audio") or "")
        return jsonify({"ok": True, "texto": texto or "", "motor": motor})
    except LookupError:
        threading.Thread(target=V.asegurar_motor, daemon=True).start()
        return jsonify({"ok": False, "error": "Noviq no tiene un motor de voz listo"})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:200]})


# ═════════════════════════════ 🗣 Voces de Noviq (motor «noviq» del avatar) ═════════════════════════════
@bp.post("/api/avatar/tts")
def av_tts():
    from . import voces as VC
    d = request.get_json(force=True, silent=True) or {}

    def num(k, defecto=1.0):
        try:
            return float(d.get(k) or defecto)
        except (TypeError, ValueError):
            return defecto
    motor = d.get("motor") or "microsoft"
    voz = d.get("voz") or ("es-EC-LuisNeural" if motor == "microsoft" else None)
    r = VC.sintetizar(str(d.get("texto") or "")[:1500], estilo=d.get("estilo") or "", motor=motor, voz=voz, vel=num("vel"), tono=num("tono"))
    return jsonify(r)


@bp.get("/api/avatar/voces")
def av_voces():
    from . import voces as VC
    return jsonify(dict(VC.catalogo(), ok=True))


# ═════════════════════════════ Herencia: lo que el avatar tenía en Noviq ═════════════════════════════
@bp.get("/api/avatar/herencia")
def av_herencia():
    """Ajustes y memoria que el avatar tenía dentro de Noviq (antes de ser independiente). Se lleva una copia una vez."""
    mem = None
    try:
        mem = json.loads(MEM_VIEJA.read_text(encoding="utf-8"))
    except Exception:
        pass
    cfg = {k: v for k, v in _cfg().items() if k not in ("desde_avatar", "activo", "puerto")}
    return jsonify({"ok": True, "config": cfg, "memoria": mem})


@bp.post("/api/avatar/claves")
def av_claves():
    """Solo cuando pulsas «Traer mis claves de Noviq» en los ajustes del avatar (las guarda cifradas allá)."""
    d = request.get_json(force=True, silent=True) or {}
    if not d.get("confirmar"):
        return jsonify({"ok": False, "error": "falta confirmar"}), 400
    from . import vault
    out, todas = {}, {}
    for pid in ("nvidia", "groq", "gemini", "openai", "openrouter", "cerebras", "mistral", "deepseek"):
        try:
            ks = [k for k in vault.get_keys(pid) if k]
            if ks:
                out[pid] = ks[0]
                todas[pid] = ks[:6]  # el avatar prueba cada una y se queda con la que funcione
        except Exception:
            pass
    _log("el avatar pidió las claves de IA: " + ", ".join(out) if out else "el avatar pidió las claves: no hay")
    return jsonify({"ok": True, "claves": out, "claves_todas": todas})


# ═════════════════════════════ 🧠 Charla (compatibilidad: ahora la mente vive en el avatar) ═════════════════════════════
def clave_api():
    """Clave de la API de charla de Noviq (compatibilidad con lo que ya la usaba)."""
    from . import vault
    k = vault.get_secreto("avatar_api_clave")
    if not k:
        import secrets
        k = "nvq-" + secrets.token_urlsafe(24)
        vault.set_secreto("avatar_api_clave", k)
    return k


def clave_valida(tok):
    try:
        return bool(tok) and tok == clave_api()
    except Exception:
        return False


@bp.post("/api/avatar/charla")
def av_charla():
    """POST {"texto": "…", "hablar": false} → la mente del avatar responde (con su memoria, IA y herramientas)."""
    d = request.get_json(force=True, silent=True) or {}
    texto = str(d.get("texto") or d.get("text") or d.get("mensaje") or "").strip()
    if not texto:
        return jsonify({"ok": False, "error": "falta «texto»"}), 400
    if not _vivo(1.0):
        if not abrir("charla", forzar=True):
            return jsonify({"ok": False, "error": "el avatar no está abierto: " + (_E["error"] or "no pude abrirlo")}), 503
    r = _av_api("POST", "/charla", {"texto": texto[:4000], "hablar": bool(d.get("hablar")), "origen": "noviq"}, espera=90)
    return jsonify(r)


# ═════════════════════════════ Ajustes (⚙ → 🤖 Avatar) y MCP ═════════════════════════════
def estado_publico():
    from . import voz as V
    sano, motivo = motor_sano() if instalado() else (False, "")
    da = _cfg().get("desde_avatar") or {}
    return {"activo": bool(_cfg()["activo"]), "instalado": instalado(), "carpeta": str(CARPETA), "electron": _electron().exists(),
            "motor_sano": sano, "motor_problema": motivo, "vivo": bool(_vivo(0.8)), "conectado": time.time() - _E["latido"] < 25,
            "lanzado_por_noviq": _E["lanzado_por_mi"], "reparando": _E["reparando"], "reparacion": _E["reparacion"], "error": _E["error"],
            "oido": _E["oido"], "trabajos": len(_trab), "pregunta": _pend.get("texto"), "voz_noviq": V.estado_publico(), "puerto": _puerto(),
            "ajustes_url": f"http://127.0.0.1:{_puerto()}/ajustes", "nombre": _nombre_bot(), "version_avatar": da.get("version") or None,
            "node": bool(shutil.which("node")), "frozen": FROZEN}


@bp.route("/api/avatar", methods=["GET", "POST"])
def api_avatar():
    if request.method == "GET":
        return jsonify(estado_publico())
    d = request.get_json(force=True, silent=True) or {}
    from . import voz as V
    if isinstance(d.get("config"), dict) and "activo" in d["config"]:
        CONFIG.setdefault("avatar", {})["activo"] = bool(d["config"]["activo"])
        save_config()
        if not CONFIG["avatar"]["activo"] and _E["vivo"] and _E["lanzado_por_mi"]:
            cerrar(despedirse=True)
        elif CONFIG["avatar"]["activo"] and not _E["vivo"]:
            threading.Thread(target=abrir, args=("ajustes",), daemon=True).start()
    if d.get("abrir"):
        _E["cerrado_usuario"] = False
        threading.Thread(target=abrir, kwargs={"motivo": "botón", "forzar": True}, daemon=True).start()
    if d.get("cerrar"):
        cerrar(despedirse=True)
        _E["cerrado_usuario"] = True
    if d.get("reparar"):
        reparar(forzar_motor=bool(d.get("motor")))
    if d.get("instalar_voz") in ("nvidia", "local"):
        r = V.instalar(d["instalar_voz"])
        if not r.get("ok"):
            return jsonify(dict(estado_publico(), ok=False, error=r.get("error")))
    if d.get("instalar_tts") in ("microsoft", "nvidia", "piper"):
        from . import voces as VC
        r = VC.instalar(d["instalar_tts"])
        if not r.get("ok"):
            return jsonify(dict(estado_publico(), ok=False, error=r.get("error")))
    if d.get("probar"):
        _av({"cmd": "secuencia", "pasos": [{"cmd": "aviso", "tipo": "saludo", "texto": fr("hola").replace("Noviq", _nombre_bot())},
                                            {"cmd": "esperar", "ms": 2600}, {"cmd": "aviso", "tipo": "exito", "texto": fr("fin")},
                                            {"cmd": "esperar", "ms": 2400}, {"cmd": "aviso", "tipo": "pregunta", "texto": fr("que_mas")}]})
    if d.get("escuchar"):
        if not _E["vivo"]:
            abrir("escuchar", forzar=True)
        _av({"cmd": "microfono"})
    if d.get("ventana_ajustes"):
        _av({"cmd": "abrir_ajustes"})
    out = {"ok": True}
    if d.get("decir"):
        decir(str(d["decir"])[:400], d.get("tipo") or "info", voz=d.get("voz"))
    if isinstance(d.get("comando"), (dict, list, str)):
        out["avatar"] = _av(d["comando"], espera=5)
    return jsonify(dict(estado_publico(), **out))


# ═════════════════════════════ Herramienta para la IA ═════════════════════════════
TOOL_DEF = {"type": "function", "function": {
    "name": "avatar",
    "description": "Tu avatar (robot flotante en el escritorio del usuario) le habla en voz alta. Úsalo POCO: inicio, fin, "
                   "permisos y errores ya se avisan solos. Sirve para un aviso corto importante o el progreso de algo largo.",
    "parameters": {"type": "object", "properties": {
        "accion": {"type": "string", "enum": ["decir", "celebrar", "progreso", "expresion"]},
        "texto": {"type": "string", "description": "decir: 1 frase corta (máx. 150 caracteres)"},
        "valor": {"type": "string", "description": "progreso: 0-100 · expresion: feliz, pensando, sorpresa, triste…"}},
        "required": ["accion"]}}}


def tool_def():
    return TOOL_DEF if _cfg()["activo"] and _E["vivo"] else None


def tool(a, ctx=None):
    if not _E["vivo"]:
        return "El avatar no está abierto (el usuario lo activa en ⚙ Ajustes → 🤖 Avatar)."
    acc = (a.get("accion") or "decir").lower()
    if acc == "decir":
        decir(_corto(a.get("texto") or "", 180), "info")
    elif acc == "celebrar":
        decir(_corto(a.get("texto") or "", 180), "exito")
    elif acc == "progreso":
        try:
            v = max(0, min(100, int(float(a.get("valor") or 0))))
        except ValueError:
            v = 0
        _mandar({"cmd": "progreso", "valor": v, "etiqueta": _corto(a.get("texto") or "", 34)})
    elif acc == "expresion":
        _mandar({"cmd": "expresion", "valor": str(a.get("valor") or "feliz"), "duracion": 4000})
    else:
        return "ERROR: accion debe ser decir, celebrar, progreso o expresion."
    return "✔ El avatar se lo mostró al usuario."
