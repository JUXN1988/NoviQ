# -*- coding: utf-8 -*-
"""📱 Agente de Telegram: tu Noviq en el celular.

- Vinculación (⚙ Ajustes → 📱 Telegram y correo): creas un bot con @BotFather, pegas su token y le mandas al bot el código
  de 6 dígitos que muestra Noviq. Desde ese momento SOLO tu chat puede darle órdenes (los demás reciben «no autorizado»).
- Le escribes como en el chat de Noviq («revisa mis correos no leídos y resúmelos», «cada lunes, miércoles y jueves a las 8
  ordena Descargas») → el trabajo se hace en Noviq con todos sus agentes y te llega la respuesta.
- ✅/❌ Aprobaciones: lo sensible (enviar, borrar, instalar, pagar) te llega con botones; también cualquier permiso que pida
  una conversación. Fotos que mandes al bot llegan a la IA como imágenes.
- Avisos: resultados de las tareas programadas, errores, trabajos terminados, notas importantes.
- Comandos: /estado /agenda /notas /nuevo /detener /continuar /captura /ranking /salud /ayuda.

Para manejar el programa usa las MISMAS herramientas que el servidor MCP de control de Noviq (noviq_mcp.py: noviq_estado,
noviq_enviar, noviq_continuar, noviq_detener, noviq_ranking, noviq_salud…), que hablan con Noviq por su API local.
Funciona con «long polling» (no hace falta abrir puertos ni tener IP pública)."""
import base64
import html
import json
import random
import re
import threading
import time
from pathlib import Path

import requests

from .config import CONFIG, DATA_DIR, save_config

API = "https://api.telegram.org"
ESTADO = DATA_DIR / "telegram_estado.json"
CARPETA = DATA_DIR / "telegram"
_lock = threading.RLock()
_hilo = {"t": None, "parar": threading.Event(), "error": "", "ultimo_ok": 0, "bot": ""}
_aprob = {}      # pid → {"chat", "msg", "titulo", "cerrada"}
_preguntas = {}  # id de pedir_ayuda_usuario → {"chat", "msg"}
_ocupado = threading.Lock()
COMANDOS = [("estado", "Qué está haciendo Noviq"), ("agenda", "Tareas programadas de la semana"), ("notas", "Notas importantes"),
            ("nuevo", "Empezar una conversación nueva"), ("detener", "Detener el trabajo actual"), ("continuar", "Continuar lo que quedó a medias"),
            ("captura", "Foto de la pantalla del PC"), ("ranking", "Mejores IAs ahora"), ("salud", "IAs que fallan"), ("ayuda", "Qué puedo hacer")]


# ───────────── configuración ─────────────
def _cfg():
    c = CONFIG.get("telegram")
    return c if isinstance(c, dict) else {}


def _set(**kw):
    c = dict(_cfg())
    c.update(kw)
    CONFIG["telegram"] = c
    save_config()


def token():
    from . import vault
    return vault.get_secreto("telegram_token")


def vinculado():
    return bool(token() and _cfg().get("chat_id") and _cfg().get("activo", True))


def _api(metodo, espera=30, files=None, **datos):
    tk = token()
    if not tk:
        raise RuntimeError("falta el token del bot")
    base = (_cfg().get("api_base") or API).rstrip("/")
    url = f"{base}/bot{tk}/{metodo}"
    if files:
        r = requests.post(url, data={k: (json.dumps(v) if isinstance(v, (dict, list)) else v) for k, v in datos.items()},
                          files=files, timeout=espera)
    else:
        r = requests.post(url, json=datos, timeout=espera)
    try:
        j = r.json()
    except ValueError:
        raise RuntimeError(f"Telegram respondió {r.status_code}")
    if not j.get("ok"):
        raise RuntimeError(j.get("description") or f"error {r.status_code}")
    return j.get("result")


def configurar(tk):
    """Guarda el token (bóveda), lo prueba con getMe y genera el código de vinculación."""
    from . import vault
    tk = (tk or "").strip()
    if not re.fullmatch(r"\d{5,}:[A-Za-z0-9_-]{30,}", tk):
        raise ValueError("Ese no parece un token de bot (tiene la forma 123456789:AA…). Cópialo de @BotFather.")
    vault.set_secreto("telegram_token", tk)
    try:
        me = _api("getMe", espera=20)
    except Exception as e:
        raise ValueError(f"Telegram no aceptó el token: {e}")
    codigo = f"{random.randint(0, 999999):06d}"
    _set(activo=True, bot=me.get("username", ""), codigo=codigo, chat_id=_cfg().get("chat_id", ""))
    try:
        _api("setMyCommands", commands=[{"command": c, "description": d} for c, d in COMANDOS])
    except Exception:
        pass
    reiniciar()
    return {"bot": me.get("username"), "codigo": codigo}


def desvincular(borrar_token=False):
    from . import vault
    _set(chat_id="", usuario="", codigo=f"{random.randint(0, 999999):06d}")
    if borrar_token:
        vault.set_secreto("telegram_token", "")
        _set(activo=False, bot="")
    reiniciar()


def estado_publico():
    c = _cfg()
    return {"activo": c.get("activo", False), "tiene_token": bool(token()), "bot": c.get("bot", ""), "vinculado": bool(c.get("chat_id")),
            "usuario": c.get("usuario", ""), "codigo": c.get("codigo", "") if not c.get("chat_id") else "",
            "avisos": dict({"tareas": True, "errores": True, "terminado": True, "aprobaciones": True, "notas": False}, **(c.get("avisos") or {})),
            "escuchando": bool(_hilo["t"] and _hilo["t"].is_alive() and token() and c.get("activo", True)), "error": _hilo["error"],
            "ultimo_ok": _hilo["ultimo_ok"]}


# ───────────── enviar ─────────────
def _chat():
    return str(_cfg().get("chat_id") or "")


def _trozos(texto, n=3900):
    texto = texto or "(vacío)"
    while texto:
        if len(texto) <= n:
            yield texto
            return
        corte = texto.rfind("\n", 0, n)
        corte = corte if corte > n // 2 else n
        yield texto[:corte]
        texto = texto[corte:].lstrip("\n")


def enviar(texto, chat=None, botones=None, html_mode=False, silencioso=False):
    """Manda un mensaje (en trozos si es largo). Devuelve el id del último mensaje o None."""
    chat = chat or _chat()
    if not chat or not token():
        return None
    ult = None
    partes = list(_trozos(texto))
    for i, t in enumerate(partes):
        datos = {"chat_id": chat, "text": t, "disable_web_page_preview": True, "disable_notification": silencioso}
        if html_mode:
            datos["parse_mode"] = "HTML"
        if botones and i == len(partes) - 1:
            datos["reply_markup"] = {"inline_keyboard": botones}
        try:
            ult = _api("sendMessage", **datos)["message_id"]
        except Exception as e:
            if html_mode:  # si el HTML no le gustó, va como texto plano
                datos.pop("parse_mode", None)
                datos["text"] = re.sub(r"<[^>]+>", "", html.unescape(t))
                try:
                    ult = _api("sendMessage", **datos)["message_id"]
                except Exception:
                    _hilo["error"] = str(e)[:200]
            else:
                _hilo["error"] = str(e)[:200]
    return ult


def enviar_foto(ruta, texto="", chat=None):
    chat = chat or _chat()
    if not chat:
        return None
    with open(ruta, "rb") as f:
        return _api("sendPhoto", espera=60, files={"photo": (Path(ruta).name, f)}, chat_id=chat, caption=(texto or "")[:1000])


def avisar(texto, tipo="general"):
    """Aviso importante (respeta lo que el usuario eligió recibir)."""
    if not vinculado():
        return False
    av = estado_publico()["avisos"]
    if tipo in av and not av[tipo]:
        return False
    return bool(enviar(texto))


def _h(t):
    return html.escape(str(t or ""), quote=False)


# ───────────── aprobaciones ─────────────
def pedir_aprobacion(pid, titulo, detalle="", conv_titulo="", conv_id=None):
    if not vinculado() or not estado_publico()["avisos"].get("aprobaciones", True):
        return False
    txt = (f"🛡 <b>Noviq necesita tu aprobación</b>\n{_h(titulo)}" + (f"\n<i>Conversación: {_h(conv_titulo)}</i>" if conv_titulo else "")
           + (f"\n\n<pre>{_h(detalle[:2500])}</pre>" if detalle else ""))
    mid = enviar(txt, botones=[[{"text": "✅ Aprobar", "callback_data": f"ap:{pid}"}, {"text": "❌ Rechazar", "callback_data": f"no:{pid}"}]],
                 html_mode=True)
    if mid:
        _aprob[pid] = {"chat": _chat(), "msg": mid, "titulo": titulo, "cerrada": False}
        return True
    return False


def cerrar_aprobacion(pid, ok, via="Noviq"):
    a = _aprob.get(pid)
    if not a or a["cerrada"]:
        return
    a["cerrada"] = True
    try:
        _api("editMessageText", chat_id=a["chat"], message_id=a["msg"], parse_mode="HTML",
             text=f"{'✅ Aprobado' if ok else '❌ Rechazado'} ({_h(via)})\n{_h(a['titulo'])}")
    except Exception:
        pass


def _resolver(pid, ok):
    from .agent import PENDING
    p = PENDING.get(pid)
    if not p:
        return False
    p["ok"], p["always"], p["via"] = bool(ok), False, "Telegram"
    p["event"].set()
    return True


# ───────────── observador de los trabajos (lo registra app.py) ─────────────
def evento(cid, kind, payload, conv):
    """Reenvía a Telegram los permisos y preguntas de cualquier conversación (si está vinculado)."""
    if not vinculado():
        return
    try:
        if kind == "confirm" and not payload.get("guardia"):
            a = payload.get("args") or {}
            det = a.get("explicacion") or a.get("comando") or a.get("codigo") or json.dumps(a, ensure_ascii=False)[:1500]
            pedir_aprobacion(payload.get("id"), f"Permiso: {payload.get('label') or payload.get('name')}", str(det), conv.get("title", ""), cid)
        elif kind == "ask_user":
            mid = enviar(f"🙋 La IA necesita tu ayuda ({conv.get('title', '')}):\n\n{payload.get('instrucciones', '')}\n\n"
                         "Respóndeme aquí mismo (texto o foto).")
            if mid:
                _preguntas[payload.get("id")] = {"chat": _chat(), "msg": mid}
    except Exception as e:
        _hilo["error"] = str(e)[:200]


def fin_trabajo(conv, resumen, error=None):
    """Lo llama app.py al terminar un trabajo: avisa de tareas programadas y errores."""
    if not vinculado() or conv.get("origen") == "telegram":
        return
    try:
        if conv.get("origen") == "programada":
            avisar(f"⏰ Tarea «{conv.get('title', '').lstrip('⏰ ')}» terminada" + (f" con error: {error}" if error else "")
                   + f"\n\n{(resumen or '(sin resumen)')[:3000]}", "tareas")
        elif error:
            avisar(f"❌ «{conv.get('title', '')}» se detuvo con un error:\n{error[:1500]}", "errores")
        elif estado_publico()["avisos"].get("terminado") and conv.get("_avisar_fin"):
            avisar(f"✅ Terminé «{conv.get('title', '')}»:\n\n{(resumen or '')[:3000]}", "terminado")
    except Exception:
        pass


# ───────────── recibir ─────────────
def _mcp():
    """Las herramientas del servidor MCP de control de Noviq (noviq_mcp.py), en proceso."""
    import sys
    from .config import BASE_DIR
    if str(BASE_DIR) not in sys.path:
        sys.path.insert(0, str(BASE_DIR))
    import noviq_mcp
    return noviq_mcp.FUNCS


def _conv_id():
    try:
        return json.loads(ESTADO.read_text(encoding="utf-8")).get("conv") or None
    except Exception:
        return None


def _guardar_estado(**kw):
    try:
        d = json.loads(ESTADO.read_text(encoding="utf-8"))
    except Exception:
        d = {}
    d.update(kw)
    ESTADO.write_text(json.dumps(d), encoding="utf-8")


def _offset():
    try:
        return int(json.loads(ESTADO.read_text(encoding="utf-8")).get("offset") or 0)
    except Exception:
        return 0


def _descargar(file_id):
    info = _api("getFile", file_id=file_id)
    base = (_cfg().get("api_base") or API).rstrip("/")
    r = requests.get(f"{base}/file/bot{token()}/{info['file_path']}", timeout=60)
    r.raise_for_status()
    CARPETA.mkdir(parents=True, exist_ok=True)
    p = CARPETA / f"{int(time.time())}_{Path(info['file_path']).name}"
    p.write_bytes(r.content)
    return p


def _trabajar(texto, imagenes=None, continuar=False):
    """Manda el pedido a Noviq (herramienta noviq_enviar del MCP de control) y contesta con el resultado."""
    if not _ocupado.acquire(blocking=False):
        enviar("⏳ Sigo con el pedido anterior. Te aviso al terminar (o usa /detener).")
        return
    try:
        enviar("⏳ Trabajando en eso…", silencioso=True)
        F = _mcp()
        cid = _conv_id()
        if continuar:
            if not cid:
                enviar("No hay ningún trabajo de Telegram para continuar.")
                return
            res = F["noviq_continuar"]({"conversation_id": cid, "esperar": True, "max_segundos": 3600})
        else:
            args = {"texto": texto, "esperar": True, "max_segundos": 3600, "permiso": "auto", "origen": "telegram",
                    "titulo": "📱 " + (texto or "Telegram")[:50]}
            if cid:
                args["conversation_id"] = cid
            if imagenes:
                args["imagenes"] = imagenes
            res = F["noviq_enviar"](args)
        m = re.search(r"Conversación: (\w+)", res or "")
        if m and m.group(1) != "None":
            _guardar_estado(conv=m.group(1))
        final = res.split("Respuesta de la IA:\n", 1)[-1] if "Respuesta de la IA:" in (res or "") else res
        errores = re.search(r"ERRORES:\n(.*?)(\n\n|$)", res or "", re.S)
        enviar((final or "(sin respuesta)").strip() + (f"\n\n⚠ {errores.group(1)[:800]}" if errores and "Respuesta de la IA" not in res else ""))
    except Exception as e:
        enviar(f"❌ No pude hacerlo: {e}")
    finally:
        _ocupado.release()


def _comando(cmd, arg, chat):
    F = None
    try:
        F = _mcp()
    except Exception as e:
        _hilo["error"] = f"noviq_mcp: {e}"
    if cmd in ("ayuda", "help", "start"):
        enviar("🤖 Soy tu Noviq. Escríbeme lo que quieres que haga en tu PC (correos, archivos, Office, navegador, programas, "
               "tareas programadas…). Lo delicado te lo pregunto con ✅/❌.\n\nComandos: " + " · ".join("/" + c for c, _ in COMANDOS))
    elif cmd == "estado" and F:
        enviar(F["noviq_estado"]({"limite": 6}))
    elif cmd == "ranking" and F:
        enviar(F["noviq_ranking"]({"n": 5, "eventos": False, "tipo": arg or "general"}))
    elif cmd == "salud" and F:
        enviar(F["noviq_salud"]({}))
    elif cmd == "nuevo":
        _guardar_estado(conv=None)
        enviar("🆕 Listo: lo próximo que me pidas empieza una conversación nueva.")
    elif cmd == "detener" and F:
        cid = _conv_id()
        enviar(F["noviq_detener"]({"conversation_id": cid}) if cid else "No hay un trabajo de Telegram en curso.")
    elif cmd == "continuar":
        threading.Thread(target=_trabajar, args=("", None, True), daemon=True).start()
    elif cmd == "agenda":
        from . import agenda
        enviar(agenda.texto_semana())
    elif cmd == "notas":
        from . import agenda
        enviar(agenda.texto_notas(15))
    elif cmd == "captura":
        try:
            from PIL import ImageGrab
            CARPETA.mkdir(parents=True, exist_ok=True)
            p = CARPETA / "captura.jpg"
            im = ImageGrab.grab().convert("RGB")
            im.thumbnail((1600, 1600))
            im.save(p, "JPEG", quality=70)
            enviar_foto(p, f"🖥 Pantalla del PC · {time.strftime('%H:%M')}")
        except Exception as e:
            enviar(f"No pude capturar la pantalla: {e}")
    else:
        enviar("No conozco ese comando. /ayuda")


def _procesar(u):
    c = _cfg()
    if "callback_query" in u:
        q = u["callback_query"]
        chat = str(((q.get("message") or {}).get("chat") or {}).get("id") or "")
        if chat != str(c.get("chat_id")):
            return
        dato = q.get("data") or ""
        ok = dato.startswith("ap:")
        pid = dato.split(":", 1)[-1]
        vivo = _resolver(pid, ok)
        try:
            _api("answerCallbackQuery", callback_query_id=q["id"], text=("✅ Aprobado" if ok else "❌ Rechazado") if vivo else "Ya no está pendiente")
        except Exception:
            pass
        if vivo:
            cerrar_aprobacion(pid, ok, "Telegram")
        else:
            a = _aprob.get(pid)
            if a and not a["cerrada"]:
                cerrar_aprobacion(pid, False, "ya no estaba pendiente")
        return
    m = u.get("message") or u.get("edited_message")
    if not m:
        return
    chat = str((m.get("chat") or {}).get("id") or "")
    texto = (m.get("text") or m.get("caption") or "").strip()
    # ── vinculación ──
    if not c.get("chat_id"):
        cod = re.sub(r"\D", "", texto)
        if c.get("codigo") and cod == c["codigo"]:
            nombre = (m.get("from") or {}).get("first_name") or (m.get("from") or {}).get("username") or ""
            _set(chat_id=chat, usuario=nombre, codigo="")
            enviar(f"✅ ¡Vinculado! Hola {nombre}. Desde ahora solo este chat puede darle órdenes a tu Noviq.\n/ayuda para ver qué puedo hacer.", chat=chat)
        else:
            enviar("👋 Para vincular este chat escribe aquí el código de 6 dígitos que muestra Noviq en ⚙ Ajustes → 📱 Telegram y correo.", chat=chat)
        return
    if chat != str(c.get("chat_id")):
        enviar("⛔ No estás autorizado para usar este Noviq.", chat=chat)
        return
    # ── respuesta a una pregunta de la IA (pedir_ayuda_usuario) ──
    resp = (m.get("reply_to_message") or {}).get("message_id")
    pend = [k for k, v in _preguntas.items() if v["msg"] == resp] or list(_preguntas)[-1:]
    if pend and not texto.startswith("/"):
        from . import tools as T
        p = T.ASK.get(pend[0])
        if p:
            imgs = []
            if m.get("photo"):
                ruta = _descargar(m["photo"][-1]["file_id"])
                imgs.append("data:image/jpeg;base64," + base64.b64encode(ruta.read_bytes()).decode())
            p["texto"], p["imagenes"] = texto, imgs
            p["event"].set()
            _preguntas.pop(pend[0], None)
            enviar("👍 Se lo paso a la IA.", silencioso=True)
            return
        _preguntas.pop(pend[0], None)
    # ── comandos ──
    if texto.startswith("/"):
        cmd, _, arg = texto[1:].partition(" ")
        _comando(cmd.split("@")[0].lower(), arg.strip(), chat)
        return
    # ── fotos / documentos ──
    imagenes = []
    if m.get("photo"):
        try:
            ruta = _descargar(m["photo"][-1]["file_id"])
            imagenes.append("data:image/jpeg;base64," + base64.b64encode(ruta.read_bytes()).decode())
        except Exception as e:
            enviar(f"No pude bajar la foto: {e}")
    if m.get("document"):
        try:
            ruta = _descargar(m["document"]["file_id"])
            texto = (texto + f"\n\n[El usuario mandó por Telegram el archivo {ruta} — léelo con leer_archivo / oficina]").strip()
        except Exception as e:
            enviar(f"No pude bajar el archivo: {e}")
    if m.get("voice") or m.get("audio"):
        enviar("🎤 Todavía no entiendo audios: escríbemelo, por favor.")
        return
    if not texto and not imagenes:
        return
    threading.Thread(target=_trabajar, args=(texto or "Mira la imagen", imagenes), daemon=True, name="telegram-trabajo").start()


def _bucle():
    parar = _hilo["parar"]
    espera = 2
    while not parar.is_set():
        if not token() or not _cfg().get("activo", True):
            parar.wait(10)
            continue
        try:
            ups = _api("getUpdates", espera=65, timeout=50, allowed_updates=["message", "edited_message", "callback_query"],
                       **({"offset": _offset() + 1} if _offset() else {}))
            _hilo["error"], _hilo["ultimo_ok"], espera = "", time.time(), 2
            for u in ups or []:
                _guardar_estado(offset=u["update_id"])
                try:
                    _procesar(u)
                except Exception as e:
                    _hilo["error"] = f"{type(e).__name__}: {e}"[:200]
        except Exception as e:
            _hilo["error"] = str(e)[:200]
            parar.wait(espera)
            espera = min(60, espera * 2)


def iniciar():
    with _lock:
        if _hilo["t"] and _hilo["t"].is_alive():
            return
        _hilo["parar"] = threading.Event()
        _hilo["t"] = threading.Thread(target=_bucle, daemon=True, name="telegram")
        _hilo["t"].start()


def reiniciar():
    with _lock:
        _hilo["parar"].set()
        t = _hilo["t"]
    if t and t.is_alive():
        t.join(timeout=2)
    _hilo["t"] = None
    if token() and _cfg().get("activo", True):
        iniciar()


# ───────────── Herramienta para la IA ─────────────
def tool(a, ctx):
    acc = (a.get("accion") or "avisar").lower()
    if not vinculado():
        return "Telegram no está vinculado (el usuario lo configura en ⚙ Ajustes → 📱 Telegram y correo)."
    if acc == "avisar":
        return "✔ Aviso enviado al Telegram del usuario." if enviar("📣 " + (a.get("texto") or "")) else "ERROR: Telegram no respondió."
    if acc == "foto":
        from .oficina import _ruta
        p = _ruta(ctx, a.get("ruta") or "")
        if not p.is_file():
            return f"ERROR: no existe {p}"
        enviar_foto(p, a.get("texto") or "")
        return "✔ Imagen enviada al Telegram del usuario."
    return "ERROR: accion debe ser avisar o foto."


TOOL_DEF = {"type": "function", "function": {
    "name": "telegram",
    "description": "Manda un aviso importante (o una imagen/captura) al Telegram del usuario: resultados de trabajos largos, algo urgente o que necesita saber aunque no esté en el PC.",
    "parameters": {"type": "object", "properties": {"accion": {"type": "string", "enum": ["avisar", "foto"]},
                                                    "texto": {"type": "string"}, "ruta": {"type": "string", "description": "foto: ruta de la imagen"}},
                   "required": ["accion", "texto"]}}}
