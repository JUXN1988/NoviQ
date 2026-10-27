# -*- coding: utf-8 -*-
"""
Noviq 4.0 — agente de IA de escritorio para modelos de NVIDIA (build.nvidia.com), Gemini, OpenAI,
Ollama y LM Studio, con herramientas estilo Claude: proyectos, archivos, PowerShell, Python,
internet, imágenes, capturas, tareas, memoria y servidores MCP.

Uso:  python app.py        → se abre en el navegador (http://127.0.0.1:7860)
"""
import json
from html import escape as html_escape
import os
import queue
import re
import secrets
import subprocess
import sys
import threading
import time
import uuid
import webbrowser
from pathlib import Path

from flask import Flask, Response, abort, jsonify, request, send_file, stream_with_context

from noviq import tools as T
from noviq.agent import PENDING, run_agent
from noviq.config import BASE_DIR, CONFIG, IS_WINDOWS, MEMORY_FILE, general_dir, meta_file, project_path, projects_root, save_config
from noviq import estado as E
from noviq import vault
from noviq.mcp import MANAGER
from noviq.providers import APIError, list_models
from noviq.server_state import conv_path, list_convs, load_conv, new_conv, save_conv
from noviq import avatar_agente as AV  # 🤖 avatar: cara, voz y oído de Noviq
from noviq import bandeja as BJ        # 📥 peticiones en caliente (lo que pides mientras la IA trabaja)
from noviq import enrutador as ENR     # 🧭 a qué conversación/proyecto va cada pedido

PORT = int(os.environ.get("NVIDIA_CHAT_PORT", "7860"))
TOKEN = secrets.token_urlsafe(24)
STATIC = BASE_DIR / "static"
app = Flask(__name__, static_folder=str(STATIC), static_url_path="/static")
app.json.sort_keys = False  # conserva el orden de los proveedores
app.register_blueprint(AV.bp)  # rutas /api/avatar/* (usan el mismo token que el resto de la API)
STOP = {}
RUNNING = set()
JOBS = {}  # conversación → trabajo en curso (eventos para reengancharse)
ENR.registrar_ocupados(lambda: set(RUNNING))


# ───────────── Seguridad: solo esta PC y solo esta página ─────────────
@app.before_request
def guard():
    host = (request.host or "").split(":")[0]
    if host not in ("127.0.0.1", "localhost"):
        abort(403)
    if request.path.startswith("/api/") or request.path == "/f":
        tok = request.headers.get("X-Token") or request.args.get("t")
        if not tok and request.headers.get("Authorization", "").startswith("Bearer "):
            tok = request.headers["Authorization"][7:].strip()
        if tok != TOKEN:
            # 🤖 otros programas pueden conversar con el bot del avatar con su clave fija (⚙ Ajustes → 🤖 Avatar → API)
            if not ((request.path.startswith("/api/avatar/v1/") or request.path == "/api/avatar/charla") and AV.clave_valida(tok)):
                abort(403)


@app.get("/")
def index():
    html = (STATIC / "index.html").read_text(encoding="utf-8").replace("__TOKEN__", TOKEN)
    return Response(html, mimetype="text/html")


def J():
    return request.get_json(force=True, silent=True) or {}


# ───────────── Configuración ─────────────
def public_config():
    from noviq.config import CONFIG_AVISOS
    c = json.loads(json.dumps(CONFIG))
    for pid, p in c["providers"].items():
        keys = vault.get_keys(pid)
        p["api_keys"] = [vault.mask(k) for k in keys]
        p["has_key"] = bool(keys)
    c["vault"] = "Cifrada con DPAPI de Windows" if IS_WINDOWS else "Protegida con permisos de archivo"
    c["projects_root"] = str(projects_root())
    c["os"] = "Windows" if IS_WINDOWS else sys.platform
    c["avisos_config"] = list(CONFIG_AVISOS[-5:])
    return c


@app.get("/api/config")
def get_config():
    return jsonify(public_config())


# Tipos y rangos de los ajustes: lo que llega de la ventana se corrige (antes un «0» de temperatura se volvía 0.6 y un
# texto en un campo numérico podía dejar la configuración inservible).
_NUM = {"temperature": (float, 0.0, 2.0), "top_p": (float, 0.0, 1.0), "max_tokens": (int, 256, 262144),
        "max_steps": (int, 1, 500), "read_timeout": (int, 30, 3600), "fallback_rounds": (int, 1, 10),
        "equipo_max": (int, 1, 4), "revisar_plan_seg": (int, 0, 600)}
_NUM_SUB = {"local": {"vram_gb": (float, 1, 256), "ram_gb": (float, 2, 2048), "num_ctx": (int, 0, 1048576),
                      "max_ctx": (int, 2048, 1048576), "max_steps": (int, 10, 1000)},
            "guardian": {"max_razonamiento": (int, 3000, 400000), "max_seg_razonamiento": (int, 30, 3600)},
            "escalado": {"umbral": (int, 1, 50), "max_escalados": (int, 0, 10)},
            "director": {"max_continuaciones": (int, 0, 20), "max_minutos": (int, 5, 1440), "espera_error_seg": (int, 0, 600)},
            "evaluador": {"min_datos": (int, 1, 100)}, "entregas": {"max": (int, 1, 100)},
            "respaldos": {"max_por_archivo": (int, 3, 500)},
            "recursos": {"reserva_gb": (float, 0, 64), "vm_gb": (float, 1, 128), "vm_cpus": (int, 1, 64), "swap_gb": (float, 0, 64),
                         "navegadores": (int, 1, 4), "proc_mb": (int, 256, 131072), "cpu_pct": (int, 10, 100),
                         "vista_max_gb": (float, 0.5, 32)}}
_BOOL = {"fallback_enabled", "navegador_directo", "respaldo_auto", "verificar_modelos", "solo_operativos", "pruebas_auto",
         "diagnostico_auto"}


def _num(v, spec, actual):
    tipo, lo, hi = spec
    try:
        x = tipo(float(v))
    except (TypeError, ValueError):
        return actual
    return max(lo, min(hi, x))


def _guardar_claves(pid, lineas, informe):
    """Guarda las claves de un proveedor desde la caja de texto. Cada línea puede ser una clave enmascarada (ya guardada)
    o una clave nueva pegada de cualquier forma («Bearer nvapi-…», «clave 2 …», entre comillas…)."""
    before = vault.get_keys(pid)
    pool = {}
    for k in before:  # cada línea enmascarada recupera su clave real (aunque dos máscaras coincidan)
        pool.setdefault(vault.mask(k), []).append(k)
    if isinstance(lineas, str):
        lineas = lineas.splitlines()
    nuevas, pegadas, limpiadas, ignoradas = [], 0, 0, 0
    for x in lineas or []:
        x = (x or "").strip()
        if not x:
            continue
        if pool.get(x):
            nuevas.append(pool[x].pop(0))
            continue
        ks = vault.extraer_claves(x)
        if not ks:
            ignoradas += 1  # «Bearer» suelto, una máscara que ya no existe, texto sin clave…
            continue
        pegadas += len(ks)
        if len(ks) != 1 or ks[0] != x:
            limpiadas += 1
        nuevas.extend(ks)
    dup = len(nuevas) - len(dict.fromkeys(nuevas))
    guardadas = vault.set_keys(pid, nuevas)
    rep = {"guardadas": len(guardadas), "duplicadas": dup, "limpiadas": limpiadas, "ignoradas": ignoradas,
           "nuevas": len([k for k in guardadas if k not in before]), "quitadas": len([k for k in before if k not in guardadas]),
           "sospechosas": [f"clave {i + 1}: {vault.formato_sospechoso(pid, k)}" for i, k in enumerate(guardadas)
                           if vault.formato_sospechoso(pid, k)]}
    if guardadas != before:  # claves nuevas: se vuelve a probar qué modelos funcionan
        from noviq import salud as S, verificador
        from noviq.providers import olvidar_clave
        olvidar_clave(pid)
        S.reset_proveedor(pid)
        verificador.pedir(pid, forzar=True)
    if pegadas or rep["quitadas"] or dup or ignoradas:
        informe[pid] = rep


@app.post("/api/config")
def set_config():
    from noviq.config import CONFIG_AVISOS
    d = J()
    informe, ignorados = {}, []
    try:
        for k, v in d.items():
            if k == "providers" and isinstance(v, dict):
                for pid, pv in v.items():
                    if not isinstance(pv, dict):
                        continue
                    cur = CONFIG["providers"].setdefault(pid, {})
                    for kk, vv in pv.items():
                        if kk == "api_keys":
                            _guardar_claves(pid, vv, informe)
                        elif kk == "enabled":
                            cur[kk] = bool(vv)
                        elif kk in ("base_url", "name", "cuenta"):
                            cur[kk] = str(vv or "").strip()
                        elif kk != "has_key":
                            cur[kk] = vv
            elif k in _NUM:
                CONFIG[k] = _num(v, _NUM[k], CONFIG.get(k))
            elif k in _BOOL:
                CONFIG[k] = bool(v)
            elif k in _NUM_SUB and isinstance(v, dict):
                sub = dict(CONFIG.get(k) or {})
                for kk, vv in v.items():
                    spec = _NUM_SUB[k].get(kk)
                    sub[kk] = _num(vv, spec, sub.get(kk)) if spec else vv
                CONFIG[k] = sub
            elif k == "fallback_models" and isinstance(v, list):
                CONFIG[k] = [m for m in dict.fromkeys(str(x).strip() for x in v) if m and "::" in m]
            elif k in CONFIG and k not in ("model_overrides",):
                CONFIG[k] = v
            else:
                ignorados.append(k)
    except Exception as e:  # nunca se pierde lo ya aplicado: se guarda y se informa el problema
        save_config()
        return jsonify({"ok": False, "error": f"No se pudo aplicar un ajuste: {e}"}), 400
    if not save_config():
        return jsonify({"ok": False, "error": (CONFIG_AVISOS[-1] if CONFIG_AVISOS else "no se pudo guardar config.json")}), 500
    c = public_config()
    c["_guardado"] = True
    if informe:
        c["_claves"] = informe
    if ignorados:
        c["_ignorados"] = ignorados
    return jsonify(c)


@app.post("/api/reset_model_overrides")
def reset_overrides():
    CONFIG["model_overrides"] = {}
    save_config()
    return jsonify({"ok": True})


@app.get("/api/models")
def models():
    refresh = request.args.get("refresh") == "1"
    res = []
    threads = []
    out = {}

    def one(pid):
        out[pid] = list_models(pid, refresh)

    for pid, pc in CONFIG["providers"].items():
        if not pc.get("enabled"):
            out[pid] = {"id": pid, "name": pc.get("name", pid), "ok": False, "models": [], "error": "desactivado"}
            continue
        th = threading.Thread(target=one, args=(pid,))
        th.start()
        threads.append(th)
    for th in threads:
        th.join(25)
    for pid in CONFIG["providers"]:
        r = out.get(pid) or {"id": pid, "name": pid, "ok": False, "models": [], "error": "tiempo agotado"}
        res.append({k: r.get(k) for k in ("id", "name", "ok", "models", "error", "kind", "claves_malas")})
    return jsonify(res)


# ───────────── Proyectos ─────────────
@app.get("/api/projects")
def projects():
    ps = T.list_projects()
    convs_ = list_convs()
    for p in ps:
        cs = [c for c in convs_ if c.get("project") == p["name"]]
        p["conversaciones"] = len(cs)
        p["trabajando"] = sum(1 for c in cs if c["id"] in RUNNING)
        if cs:
            p["actividad"] = max(p.get("actividad", 0), cs[0]["updated"])
            p["ultima_conv"] = cs[0]["id"]
    ps.sort(key=lambda x: -x.get("actividad", 0))
    return jsonify({"root": str(projects_root()), "projects": ps, "tipos": list(T.TIPOS)})


@app.post("/api/projects")
def create_project():
    d = J()
    p, log = T.create_project(d.get("nombre"), d.get("tipo", "general"), d.get("descripcion", ""), d.get("instrucciones", ""))
    return jsonify({"ok": True, "name": p.name, "path": str(p), "log": log})


@app.post("/api/projects/<name>")
def update_project(name):
    p = project_path(name)
    if not p.exists():
        abort(404)
    meta = T.project_info(name)
    meta.update({k: v for k, v in J().items() if k in ("descripcion", "instrucciones", "tipo", "modelo")})
    for k in ("name", "path", "externo", "existe", "actividad", "conversaciones", "ultima_conv", "trabajando"):
        meta.pop(k, None)
    (meta_file(name)).write_text(json.dumps(meta, indent=2, ensure_ascii=False), encoding="utf-8")
    return jsonify({"ok": True})


# ───────────── Conversaciones ─────────────
@app.get("/api/conversations")
def convs():
    out = list_convs()
    for c in out:
        c["running"] = c["id"] in RUNNING
        c["en_cola"] = BJ.pendientes(c["id"])
    return jsonify(out)


@app.get("/api/conversations/<cid>")
def get_conv(cid):
    jb = JOBS.get(cid)
    if jb and not jb["done"]:
        c = jb["conv"]  # sigue trabajando: se devuelve lo previo al turno actual y el cliente reproduce los eventos
        out = {k: c.get(k) for k in ("id", "title", "project", "model", "tasks", "en_progreso")}
        out["display"] = c["display"][:jb["display_start"]]
        return jsonify(out | {"running": True})
    c = load_conv(cid)
    if not c:
        abort(404)
    return jsonify({k: c.get(k) for k in ("id", "title", "display", "project", "model", "tasks", "en_progreso")} |
                   {"running": cid in RUNNING, "calif": (c.get("_calif") or {}).get("valor")})


@app.get("/api/conversations/<cid>/estado")
def conv_estado(cid):
    c = load_conv(cid)
    if not c:
        abort(404)
    return jsonify({"text": E.build(c) or E.read_project_file(c.get("project")) or "Aún no hay trabajo registrado."})


@app.delete("/api/conversations/<cid>")
def del_conv(cid):
    conv_path(cid).unlink(missing_ok=True)
    return jsonify({"ok": True})


@app.post("/api/conversations/<cid>")
def patch_conv(cid):
    c = load_conv(cid)
    if not c:
        abort(404)
    d = J()
    for k in ("title", "project", "model"):
        if k in d:
            c[k] = d[k]
    save_conv(c)
    return jsonify({"ok": True})


@app.post("/api/confirm")
def confirm():
    d = J()
    p = PENDING.get(d.get("id"))
    if p:
        p["ok"], p["always"], p["via"] = bool(d.get("approved")), bool(d.get("always")) and not p.get("guardia"), "Noviq"
        p["event"].set()
        try:
            from noviq import telegram_bot as TG
            TG.cerrar_aprobacion(d.get("id"), bool(d.get("approved")), "Noviq")
        except Exception:
            pass
    return jsonify({"ok": bool(p)})


@app.post("/api/plan/<rid>")
def plan_resp(rid):
    from noviq import cerebro as CB
    d = J()
    return jsonify({"ok": CB.responder(rid, d.get("accion", "aprobar"), d.get("plan"))})


@app.post("/api/stop")
def stop():
    cid = J().get("conversation_id")
    if cid in STOP:
        STOP[cid].set()
    return jsonify({"ok": True})


def _enrutar(d):
    """🧭 Decide a qué conversación/proyecto va el pedido y ajusta `d` (conversation_id, project, text).
    → la decisión (o None si no aplica). En la ventana nunca se cambia de chat salvo que lo pidas («nueva conversación…»)."""
    texto = (d.get("text") or "").strip()
    if d.get("regenerate") or d.get("continuar") or not texto or d.get("sin_enrutar"):
        return None
    try:
        cid0 = d.get("conversation_id") or None
        canal_proj = d.get("project") or ((load_conv(cid0) or {}).get("project") if cid0 else None)
        modo = "ventana" if (d.get("origen") or "ventana") == "ventana" else "auto"
        ruta = ENR.decidir(texto, conv_actual=cid0, proyecto=canal_proj, modo=modo)
    except Exception as e:  # el enrutador ayuda; si falla, el pedido sigue como antes
        print(f"[enrutador] {type(e).__name__}: {e}")
        return None
    acc = ruta.get("accion")
    if acc in ("continuar", "en_caliente") and ruta.get("conv"):
        d["conversation_id"] = ruta["conv"]
    elif acc == "nueva":
        if d.get("conversation_id"):
            d["conversation_id"] = None
            d.pop("project", None)
        if ruta.get("proyecto"):
            d["project"] = ruta["proyecto"]
        d["text"] = ENR.preparar_texto(ruta, d.get("text") or "")
        if ruta.get("titulo") and not d.get("titulo"):
            d["titulo"] = ruta["titulo"]
    ruta["cambio"] = bool((acc in ("continuar", "en_caliente") and ruta.get("conv") != cid0)
                          or (acc == "nueva" and (cid0 or ruta.get("nuevo_proyecto")
                                                  or (ruta.get("proyecto") and ruta.get("proyecto") != canal_proj))))
    return ruta


_TITULO_SIS = ("Escribe un título MUY corto (de 2 a 6 palabras) para una conversación que empieza con el pedido del usuario. "
               "Usa el idioma del pedido, sin comillas, sin emojis y sin punto final. Responde SOLO el título.")


def _titulo_ia(cid, titulo_auto, texto):
    """🏷 Título automático: la IA más rápida resume el primer pedido en pocas palabras (antes el título eran los primeros
    60 caracteres del pedido). Los títulos claros ayudan a ti en la barra lateral y al 🧭 enrutador a reconocer temas.
    Idea de DeepSeek Harness (dsh-session-title-first-prompt-llm, MIT); implementación propia. Si falla, queda el de siempre."""
    if not texto or len(texto) < 25:   # pedidos cortos ya son un buen título
        return
    try:
        from noviq import rapida as R
        raw, _m, _ms = R.responder(_TITULO_SIS, texto[:1200], max_tokens=40, limite_seg=15, intentos=1, temperatura=0.2)
    except Exception:
        return
    t = re.sub(r"\s+", " ", re.sub(r"[\"«»“”*#`]", "", (raw or "").splitlines()[0] if raw else "")).strip(" .:-")
    if not (2 <= len(t) <= 70) or len(t.split()) > 9:
        return
    pref = re.match(r"^((?:🎙|📱|🤖)\s*(?:\[[^\]]{1,40}\]\s*)?)", titulo_auto or "")   # conserva «🎙 [proyecto] » / «📱 »
    nuevo = ((pref.group(1) if pref else "") + t)[:60]
    jb = JOBS.get(cid)
    if jb and not jb["done"]:
        if jb["conv"].get("title") == titulo_auto:   # el agente guarda la conversación seguido: lo lleva con él
            jb["conv"]["title"] = nuevo
        return
    with BJ.LOCK:
        if cid in RUNNING:
            return
        c = load_conv(cid)
        if c and c.get("title") == titulo_auto:
            c["title"] = nuevo
            save_conv(c)


def _avisar_ruta(job, conv, ruta):
    """Muestra en el chat a dónde se mandó el pedido (y le dice a la ventana que abra esa conversación al terminar)."""
    if not ruta or not (ruta.get("cambio") or ruta.get("sugerencia")):
        return
    if ruta.get("cambio"):
        acc = ruta["accion"]
        txt = {"nueva": "🧭 Conversación nueva", "continuar": "🧭 Retomo una conversación anterior",
               "en_caliente": "🧭 Lo agrego a un trabajo en curso"}.get(acc, "🧭 Enrutado")
        txt += (f" · proyecto «{ruta['proyecto']}»" if ruta.get("proyecto") else "") + f" ({ruta.get('motivo', '')})."
    else:
        sug = ruta["sugerencia"]
        txt = ("💡 Esto parece de otro proyecto («" + sug.split(":", 1)[1] + "»). Si quieres, dilo así: «en el proyecto "
               + sug.split(":", 1)[1] + ", …» o abre ese proyecto.") if sug.startswith("proyecto:") else \
            "💡 Esto parece un tema distinto de esta conversación. Si prefieres separarlo, empieza con «nueva conversación: …»."
    payload = {"text": txt}
    conv["display"].append({"type": "notice", **payload})
    with job["cond"]:
        job["events"].append(("notice", payload))
        if ruta.get("cambio"):
            job["events"].append(("ruta", {"conversation_id": conv["id"], "accion": ruta["accion"], "proyecto": ruta.get("proyecto"),
                                           "motivo": ruta.get("motivo", ""), "abrir": True}))
        job["cond"].notify_all()


def _encolar(cid, d, ruta=None):
    """📥 La conversación está trabajando: el pedido va a su bandeja y se integra en el siguiente paso.
    🧠 Si está esperando que revises su plan, lo que escribes es la respuesta al plan: «sí» lo aprueba, «no/cancela»
    detiene el trabajo y otro texto aprueba el plan y entra como cambio (antes se encolaba y el plan se aprobaba solo)."""
    try:
        from noviq import cerebro as CB
        resp = CB.respuesta_chat(cid, d.get("text"))
    except Exception:
        resp = None
    if resp == "detenido":
        return jsonify({"ok": True, "plan": "detenido", "conversation_id": cid,
                        "texto": "⏹ Cancelaste el plan: detuve el trabajo."})
    if resp == "aprobado":
        return jsonify({"ok": True, "plan": "aprobado", "conversation_id": cid, "texto": "✔ Plan aprobado: empiezo."})
    it = BJ.agregar(cid, d.get("text"), d.get("images"), d.get("files"), d.get("origen") or "ventana")
    if not it:
        return jsonify({"error": "No hay nada que agregar."}), 400
    return jsonify({"ok": True, "encolado": True, "conversation_id": cid, "id": it["id"], "pendientes": BJ.pendientes(cid),
                    "texto": "📥 Recibido: lo integro al trabajo en curso en el siguiente paso, sin detenerlo.",
                    "ruta": {k: ruta.get(k) for k in ("accion", "motivo", "proyecto")} if ruta else None}), 202


@app.post("/api/chat")
def chat():
    d = J()
    ruta = _enrutar(d)
    cid = d.get("conversation_id") or uuid.uuid4().hex[:16]
    with BJ.LOCK:  # «¿está trabajando?» y «encolar o empezar» en un solo paso (el trabajo puede estar terminando ahora mismo)
        if cid in RUNNING:
            if d.get("regenerate") or d.get("continuar"):
                return jsonify({"error": "Esta conversación ya está trabajando."}), 409
            return _encolar(cid, d, ruta)
        return _chat_iniciar(d, cid, ruta)


def _chat_iniciar(d, cid, ruta):
    conv = load_conv(cid) or new_conv(cid, d.get("project"), d.get("model") or CONFIG["model"])
    if d.get("model"):
        conv["model"] = d["model"]
    if d.get("idioma") in ("es", "en"):
        conv["idioma"] = d["idioma"]
    if d.get("permiso") in ("preguntar", "auto_seguro", "auto"):
        conv["permiso"] = d["permiso"]  # (Telegram y tareas: se aprueba solo; lo sensible lo sigue preguntando la guardia)
    if d.get("origen"):
        conv["origen"] = str(d["origen"])[:20]
    if d.get("titulo") and not conv["messages"]:
        conv["title"] = str(d["titulo"])[:60]
    if "project" in d and not conv["messages"]:
        conv["project"] = d.get("project")
    # 🎮 Detector de intención multilingüe: si el mensaje habla de crear un videojuego, la conversación pasa a modo juego
    # (la IA recibe las herramientas y las reglas del Estudio de juegos). La ventana abre el Estudio por su lado.
    try:
        if d.get("modo_juego"):
            conv["modo_juego"] = True
        elif (CONFIG.get("juegos") or {}).get("detector", "auto") != "apagado" and not conv.get("modo_juego"):
            from noviq import intencion
            if intencion.detectar(d.get("text") or "")["juego"]:
                conv["modo_juego"] = True
    except Exception:
        pass

    conv["_turno_modelos"] = {}  # IAs que trabajan en este turno (para repartir el 👍/👎 del usuario)
    if d.get("regenerate"):
        # vuelve al último mensaje del usuario
        idx = max((i for i, x in enumerate(conv["display"]) if x["type"] == "user"), default=None)
        if idx is None:
            return jsonify({"error": "nada que regenerar"}), 400
        conv["messages"] = conv["messages"][:conv["display"][idx].get("msg_index", 0) + 1]
        conv["display"] = conv["display"][:idx + 1]
    else:
        text = (d.get("text") or "").strip()
        images = d.get("images") or []
        files = d.get("files") or []
        is_continue = bool(d.get("continuar")) or (not images and not files and re.fullmatch(
            r"(?i)\W*(contin[uú]a(r)?|sigue|seguir|prosigue|dale|contin[uú]a por favor)\W*", text or "") is not None)
        if is_continue and conv["messages"]:
            content = E.continue_message(conv)
            shown = text if text and not d.get("continuar") else "▶ Continuar el trabajo"
        else:
            E.record_user(conv, text)
            if files:
                text += "\n\n[Archivos adjuntos por el usuario: " + ", ".join(files) + " — léelos con leer_archivo]"
            content = ([{"type": "text", "text": text or "Describe esta imagen."}]
                       + [{"type": "image_url", "image_url": {"url": u}} for u in images[:8]]) if images else text
            shown = d.get("text", "")
        conv["display"].append({"type": "user", "text": shown, "images": images[:8], "files": files,
                                "msg_index": len(conv["messages"])})
        conv["messages"].append({"role": "user", "content": content})
        if conv["title"] == "Nueva conversación":
            conv["title"] = (d.get("text") or "Imagen").strip()[:60] or "Conversación"
    primer_turno = sum(1 for m in conv["messages"] if m.get("role") == "user") == 1
    save_conv(conv)

    job = start_job(conv)
    _avisar_ruta(job, conv, ruta)
    if primer_turno and not d.get("regenerate") and CONFIG.get("titulos_ia", True):
        threading.Thread(target=_titulo_ia, args=(cid, conv["title"], (d.get("text") or "").strip()), daemon=True).start()
    return _stream_response(cid, 0)


def start_job(conv):
    """Arranca el agente de una conversación en su propio hilo. Cada conversación/proyecto trabaja en paralelo
    e independiente: puedes cambiar de chat, abrir otro proyecto con otra IA, y volver cuando quieras."""
    cid = conv["id"]
    for k, jb in list(JOBS.items()):  # limpia trabajos terminados hace más de 15 min
        if jb["done"] and time.time() - jb["t_end"] > 900:
            JOBS.pop(k, None)
    job = {"events": [], "cond": threading.Condition(), "done": False, "conv": conv,
           "display_start": len(conv["display"]), "t": time.time(), "t_end": 0}
    JOBS[cid] = job
    stop_ev = threading.Event()
    STOP[cid] = stop_ev
    RUNNING.add(cid)
    AV.evento(cid, "inicio", {}, conv)  # 🤖 el avatar se pone a trabajar

    def emit(kind, payload):
        with job["cond"]:
            job["events"].append((kind, payload))
            job["cond"].notify_all()
        if kind in ("confirm", "ask_user"):  # 📱 permisos y preguntas también al Telegram del usuario
            try:
                from noviq import telegram_bot as TG
                TG.evento(cid, kind, payload, conv)
            except Exception:
                pass
        AV.evento(cid, kind, payload, conv)  # 🤖 herramientas, tareas, permisos y preguntas → avatar (no bloquea)

    def worker():
        error = None
        try:
            run_agent(conv, emit, stop_ev)
        except APIError as e:
            error = str(e)
            conv["en_progreso"] = True
            emit("error", {"text": str(e)})
            conv["display"].append({"type": "error", "text": str(e)})
        except Exception as e:
            import traceback
            traceback.print_exc()
            error = f"{type(e).__name__}: {e}"
            emit("error", {"text": f"{type(e).__name__}: {e}"})
            conv["display"].append({"type": "error", "text": f"{type(e).__name__}: {e}"})
        finally:
            job["detenido"] = stop_ev.is_set()
            hay_cola = BJ.pendientes(cid) > 0
            if not hay_cola or job["detenido"]:   # si hay más pedidos en cola, todavía no se anuncia «¡Ya terminé!»
                try:
                    _fin_trabajo(conv, job, error)
                except Exception:
                    pass
            try:
                if hay_cola and job["detenido"]:
                    # pulsaste Detener: lo que estaba en cola queda escrito en el chat y «▶ Continuar» lo retoma
                    BJ.inyectar(conv, lambda *a: None, en_curso=False)
                    conv["en_progreso"] = True
                save_conv(conv)
            finally:
                with BJ.LOCK:   # atómico con /api/chat: o se encola en este trabajo, o arranca el siguiente
                    RUNNING.discard(cid)
                    STOP.pop(cid, None)
                    if BJ.pendientes(cid) and not job["detenido"]:
                        # 📥 llegó un pedido justo cuando el trabajo terminaba: se arranca solo un turno nuevo con él
                        conv["_bandeja_turno_nuevo"] = True
                        with job["cond"]:
                            job["events"].append(("relevo_turno", {"conversation_id": cid, "pendientes": BJ.pendientes(cid)}))
                        try:
                            start_job(conv)
                        except Exception as e:
                            print(f"[bandeja] no pude arrancar el turno siguiente: {type(e).__name__}: {e}")
                            RUNNING.discard(cid)
                    with job["cond"]:
                        job["done"], job["t_end"] = True, time.time()
                        job["cond"].notify_all()

    threading.Thread(target=worker, daemon=True, name=f"agente-{cid}").start()
    return job


def _fin_trabajo(conv, job, error=None):
    """📅 Al terminar: el resultado de las tareas programadas va a la agenda y (si está vinculado) a Telegram."""
    resumen = ""
    for d in reversed(conv.get("display") or []):
        if d.get("type") == "assistant" and (d.get("text") or "").strip():
            resumen = d["text"].strip()
            break
    if not error:
        for kind, p in reversed(job["events"][-40:]):
            if kind == "error":
                error = p.get("text")
                break
    try:
        AV.fin_trabajo(conv, resumen, error, job.get("detenido"))  # 🤖 «¡Ya terminé!» / «¿Qué más hacemos?»
    except Exception:
        pass
    if conv.get("tarea_programada"):
        from noviq import agenda
        agenda.registrar_resultado(conv["tarea_programada"], conv["id"], resumen[:1500], error)
    from noviq import telegram_bot as TG
    TG.fin_trabajo(conv, resumen, error)


def _stream_response(cid, since=0):
    job = JOBS.get(cid)
    conv = job["conv"]
    from noviq.tools import ASK
    from noviq import cerebro as CB

    def gen():
        yield f"event: meta\ndata: {json.dumps({'conversation_id': cid, 'title': conv['title'], 'project': conv.get('project'), 'model': conv.get('model')})}\n\n"
        i = since
        while True:
            with job["cond"]:
                if i >= len(job["events"]) and not job["done"]:
                    job["cond"].wait(15)
                evs = job["events"][i:]
                done = job["done"]
            if not evs and not done:
                yield ": ping\n\n"
                continue
            for kind, payload in evs:
                i += 1
                # al volver a una conversación, no se repiten preguntas ya respondidas
                if kind == "confirm" and payload.get("id") not in PENDING:
                    continue
                if kind == "ask_user" and payload.get("id") not in ASK:
                    continue
                if kind == "plan_review" and payload.get("id") not in CB.PLANS:
                    continue
                # «id»: si la conexión se corta, la ventana se reengancha desde aquí (/api/chat/<id>/stream?since=N)
                yield f"id: {i}\nevent: {kind}\ndata: {json.dumps(payload, ensure_ascii=False)}\n\n"
            if done and i >= len(job["events"]):
                break
        yield "event: done\ndata: {}\n\n"

    return Response(stream_with_context(gen()), mimetype="text/event-stream",
                    headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"})


@app.get("/api/chat/<cid>/stream")
def chat_stream(cid):
    """Reengancharse a una conversación que sigue trabajando (tras cambiar de chat o recargar la página)."""
    if cid not in JOBS:
        return jsonify({"error": "Esta conversación no está trabajando."}), 404
    return _stream_response(cid, int(request.args.get("since") or 0))


# ───────────── 📥 Bandeja de peticiones en caliente ─────────────
@app.get("/api/conversations/<cid>/bandeja")
def bandeja_ver(cid):
    return jsonify({"items": BJ.ver(cid), "running": cid in RUNNING})


@app.post("/api/conversations/<cid>/bandeja")
def bandeja_agregar(cid):
    """Agregar un pedido a una conversación SIN detenerla: si está trabajando se integra en el siguiente paso; si ya
    terminó (o terminó justo ahora), arranca un turno nuevo con el pedido. La ventana se reengancha con /stream."""
    d = J()
    with BJ.LOCK:
        if cid in RUNNING:
            return _encolar(cid, d)
        conv = load_conv(cid)
        if not conv:
            abort(404)
        if not BJ.agregar(cid, d.get("text"), d.get("images"), d.get("files"), d.get("origen") or "ventana"):
            return jsonify({"error": "No hay nada que agregar."}), 400
        conv["_bandeja_turno_nuevo"] = True
        start_job(conv)
    return jsonify({"ok": True, "iniciado": True, "conversation_id": cid,
                    "texto": "▶ La conversación ya había terminado: empiezo un turno nuevo con tu pedido."})


@app.delete("/api/conversations/<cid>/bandeja/<iid>")
def bandeja_quitar(cid, iid):
    return jsonify({"ok": BJ.quitar(cid, iid)})


@app.post("/api/enrutar")
def enrutar_api():
    """🧭 Solo consulta: a qué conversación/proyecto iría un pedido (no ejecuta nada). Lo usan el avatar y el MCP."""
    d = J()
    try:
        return jsonify(ENR.decidir(d.get("text") or "", conv_actual=d.get("conversation_id"), proyecto=d.get("project"),
                                   modo=d.get("modo") or "auto", usar_ia=d.get("usar_ia")))
    except Exception as e:
        return jsonify({"error": f"{type(e).__name__}: {e}"}), 500


# ───────────── 🏆 Evaluador de IAs ─────────────
@app.get("/api/evaluador")
def evaluador_get():
    from noviq import evaluador as EV
    return jsonify(EV.resumen())


@app.post("/api/evaluador")
def evaluador_set():
    from noviq import evaluador as EV
    d = J()
    if d.get("borrar"):
        EV.borrar(d.get("modelo") or None)
    if d.get("rehabilitar"):
        EV.rehabilitar(d["rehabilitar"])
        from noviq import tokens as TK
        TK.liberar(d["rehabilitar"])
    if isinstance(d.get("cupo"), dict) and d["cupo"].get("proveedor"):
        from noviq import tokens as TK
        TK.poner_cupo(d["cupo"]["proveedor"], int(d["cupo"].get("tokens_dia") or 0))
    if "liberar" in d:
        from noviq import tokens as TK
        TK.liberar(d["liberar"] or None)
    if isinstance(d.get("config"), dict):
        cur = dict(CONFIG.get("evaluador") or {})
        for k in ("activo", "elegir_al_inicio", "min_datos"):
            if k in d["config"]:
                cur[k] = d["config"][k]
        CONFIG["evaluador"] = cur
    if isinstance(d.get("director"), dict):
        cur = dict(CONFIG.get("director") or {})
        for k in ("activo", "max_continuaciones", "max_minutos"):
            if k in d["director"]:
                cur[k] = d["director"][k]
        CONFIG["director"] = cur
    save_config()
    return jsonify({"ok": True})


@app.route("/api/recursos", methods=["GET", "POST"])
def recursos_api():
    """⚙ Rendimiento: medición de la PC (RAM libre, CPU, GPU…), perfil de límites y acciones (analizar, aplicar a WSL)."""
    from noviq import recursos as R
    d = J() if request.method == "POST" else {}
    extra = {}
    if d.get("analizar") or request.args.get("completo"):
        R.medir(max_age=0, con_procesos=True)
        extra["resumen"] = R.resumen_texto()
    if d.get("aplicar_wsl"):
        cambio, texto = R.aplicar_wslconfig(forzar=True)
        extra["wsl"] = {"cambio": cambio, "archivo": str(R.WSLCONFIG), "texto": texto[:1500]}
        if d.get("reiniciar_wsl"):
            extra["wsl"]["reiniciado"] = R.reiniciar_wsl()
    if d.get("autoprueba"):
        extra["autoprueba"] = R.autoprueba()
    e = R.estado_publico()
    if request.args.get("completo") or d:
        e["medicion"] = R.medir(max_age=5, con_procesos=True)
    return jsonify(dict(e, **extra))


# ───────────── ✍ Taller de prompts ─────────────
@app.post("/api/prompt")
def prompt_api():
    """Corrige la ortografía/sintaxis o convierte el texto de la caja de mensaje en un prompt profesional."""
    from noviq import prompts as PR
    d = J()
    acc = d.get("accion") or "corregir"
    try:
        return jsonify(PR.mejorar(d.get("texto") or "", acc, d.get("modelo") or None, d.get("idioma") or "es"))
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


@app.get("/api/prompt/plantillas")
def prompt_plantillas():
    from noviq import prompts as PR
    return jsonify(PR.plantillas())


# ───────────── 🎮 Estudio de juegos ─────────────
@app.get("/api/juegos/lexico")
def juegos_lexico():
    from noviq import intencion
    return jsonify(dict(intencion.lexico(), detector=(CONFIG.get("juegos") or {}).get("detector", "auto")))


@app.post("/api/juegos/detectar")
def juegos_detectar():
    from noviq import intencion
    return jsonify(intencion.detectar(J().get("texto") or ""))


@app.get("/api/juegos/perfil")
def juegos_perfil():
    from noviq import juegos as JG
    en = request.args.get("idioma") == "en"
    p = JG.perfil_grafico("en" if en else "es")
    return jsonify(dict(p, generos={k: (JG.GENEROS_EN[k] if en else v["nombre"]) for k, v in JG.GENEROS.items()}, temas=list(JG.TEMAS)))


@app.post("/api/juegos/planificar")
def juegos_planificar():
    from noviq import juegos as JG
    d = J()
    idea = (d.get("idea") or "").strip()
    if not idea:
        return jsonify({"ok": False, "error": "Describe tu idea primero."}), 400
    r = JG.planificar(idea, d.get("estilo") or None, d.get("genero") or None, usar_ia=d.get("usar_ia", True) is not False)
    return jsonify(dict(r, ok=True))


@app.post("/api/juegos/activos")
def juegos_activos():
    from noviq import activos as A
    d = J()
    tipo = d.get("tipo") if d.get("tipo") in ("modelo", "textura", "hdri") else "modelo"
    r = A.buscar(d.get("consulta") or "", tipo, d.get("fuentes") or None, d.get("estilo") or None, d.get("nivel") or None,
                 int(d.get("limite") or 12), bool(d.get("solo_cc0", (CONFIG.get("juegos") or {}).get("solo_cc0"))),
                 rol=d.get("rol") or None, tema=d.get("tema") or None, genero=d.get("genero") or None)
    r["paquetes"] = A.paquetes(d.get("estilo"), d.get("tema"), d.get("genero"))
    return jsonify(r)


@app.post("/api/juegos/crear")
def juegos_crear():
    from noviq import juegos as JG
    d = J()
    if not isinstance(d.get("diseno"), dict):
        return jsonify({"ok": False, "error": "falta el diseño del juego"}), 400
    jid = JG.crear_en_segundo_plano(d["diseno"], d.get("nombre") or None, d.get("activos") or None, d.get("buscar_auto", True) is not False,
                                    sin_modelo=d.get("sin_modelo") if isinstance(d.get("sin_modelo"), list) else None)
    return jsonify({"ok": True, "trabajo": jid})


@app.route("/api/juegos/biblioteca", methods=["GET", "POST"])
def juegos_biblioteca():
    """📁 Tu carpeta 3D: GET = modelos encontrados (?escanear=1 vuelve a leer todo); POST {carpeta} = cambiarla («» = la estándar)."""
    from noviq import biblioteca3d as B
    try:
        if request.method == "POST":
            d = J()
            if "carpeta" in d:
                B.cambiar_carpeta(d.get("carpeta") or "")
            return jsonify(dict(B.resumen_publico(B.indice(forzar=True)), ok=True))
        return jsonify(dict(B.resumen_publico(B.indice(forzar=request.args.get("escanear") == "1")), ok=True))
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 400


@app.post("/api/juegos/biblioteca/miniatura")
def juegos_biblioteca_miniatura():
    """La ventana dibuja la vista previa de cada modelo (WebGL) y la guarda aquí para no volver a dibujarla."""
    from noviq import biblioteca3d as B
    import base64
    d = J()
    try:
        png = base64.b64decode((d.get("png") or "").split(",", 1)[-1])
        return jsonify({"ok": True, "url": B.guardar_miniatura(d.get("h") or "", png)})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:200]}), 400


@app.get("/api/juegos/biblioteca/mini/<h>.png")
def juegos_biblioteca_mini(h):
    from noviq import biblioteca3d as B
    import re as _re
    if not _re.fullmatch(r"[0-9a-f]{16}", h) or not (B.MINIS / f"{h}.png").is_file():
        abort(404)
    return send_file(B.MINIS / f"{h}.png", mimetype="image/png", max_age=3600)


@app.get("/api/juegos/trabajo/<jid>")
def juegos_trabajo(jid):
    from noviq import juegos as JG
    t = JG.TRABAJOS.get(jid)
    if not t:
        return jsonify({"estado": "desconocido"}), 404
    return jsonify({"estado": t["estado"], "log": t["log"][-40:], "resultado": t["resultado"]})


@app.post("/api/juegos/activos/descargar")
def juegos_descargar():
    from noviq import activos as A
    d = J()
    p = project_path(d.get("proyecto") or "")
    if not d.get("proyecto") or not p.exists():
        return jsonify({"ok": False, "error": "elige primero el proyecto del juego"}), 400
    try:
        ent = A.descargar(d.get("item") or {}, p, rol=(d.get("rol") or None))
        return jsonify({"ok": True, "activo": ent})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:300]})


@app.route("/api/juegos/claves", methods=["GET", "POST"])
def juegos_claves():
    """Claves opcionales de las galerías (Sketchfab para descargar, Poly Pizza para buscar low poly): en la bóveda cifrada."""
    if request.method == "POST":
        d = J()
        for k in ("sketchfab", "polypizza"):
            if k in d:
                v = (d.get(k) or "").strip()
                if v and "…" not in v and "•" not in v:
                    vault.set_keys(k, [v])
                elif v == "":
                    vault.set_keys(k, [])
    return jsonify({k: (vault.mask(vault.get_keys(k)[0]) if vault.get_keys(k) else "") for k in ("sketchfab", "polypizza")})


@app.get("/api/juegos/galerias")
def juegos_galerias():
    from noviq import activos as A
    return jsonify(A.probar())


@app.post("/api/juegos/director")
def juegos_director():
    """🎬 Director creativo: vuelve a mejorar un diseño (más épico, con la IA si hay) o aprende de uno que te gustó."""
    from noviq import director_juegos as DJ
    from noviq import juegos as JG
    d = J()
    diseno = d.get("diseno")
    if not isinstance(diseno, dict):
        return jsonify({"ok": False, "error": "falta el diseño"}), 400
    idea = (d.get("idea") or diseno.get("idea") or diseno.get("descripcion") or "").strip()
    try:
        if d.get("accion") == "aprender":
            return jsonify({"ok": True, "guardado": DJ.aprender(diseno, idea, int(d.get("votos") or 1))})
        perfil = JG.perfil_grafico()
        nuevo, info = DJ.dirigir(diseno, idea, perfil, usar_ia=d.get("usar_ia", True) is not False)
        return jsonify({"ok": True, "diseno": nuevo, "director": info, "texto": DJ.texto(nuevo)})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


def _rutas_disenos():
    from noviq import figuras3d as F
    from noviq import figuras2d as F2
    return [F.carpeta_creados().resolve(), F2.carpeta_creados().resolve()]


@app.get("/api/juegos/disenos")
def juegos_disenos():
    """🗂 Mis diseños: las figuras 3D animadas y los diseños 2D que Noviq creó y guardó en tus carpetas (para reutilizarlos)."""
    from noviq import figuras3d as F
    from noviq import figuras2d as F2
    tipo = request.args.get("tipo") or "todos"
    out = {"ok": True, "carpeta_3d": str(F.carpeta_creados()), "carpeta_2d": str(F2.carpeta_creados())}
    if tipo in ("3d", "todos"):
        out["d3"] = [{"nombre": x.get("nombre"), "categoria": (x.get("carpeta") or x.get("categoria") or "").split("/")[-1], "plantilla": x.get("plantilla"), "rig": x.get("rig"),
                      "animaciones": x.get("animaciones") or [], "creado": x.get("creado"), "ruta": x.get("ruta"), "img": x.get("miniatura_png"),
                      "bloques": (x.get("cambios") or {}).get("_estilo") == "bloques" or "Bloques" in str(x.get("carpeta") or "")} for x in F.creados()[:400]]
    if tipo in ("2d", "todos"):
        out["d2"] = [{"nombre": x.get("nombre"), "tipo": x.get("tipo"), "categoria": x.get("categoria"), "tema": x.get("tema"), "creado": x.get("creado"),
                      "img": x.get("png"), "capas": sorted((x.get("capas") or {}).keys()), "hoja": bool(x.get("hoja"))} for x in F2.creados()[:400]]
    if request.args.get("plantillas"):
        out["plantillas"] = F.plantillas_publicas()
    return jsonify(out)


@app.get("/api/juegos/disenos/img")
def juegos_disenos_img():
    """Sirve la imagen (.png) de un diseño guardado: solo dentro de las carpetas de diseños de Noviq."""
    ruta = Path(request.args.get("ruta") or "")
    try:
        r = ruta.resolve()
    except Exception:
        abort(404)
    if r.suffix.lower() != ".png" or not r.is_file() or not any(str(r).startswith(str(b) + os.sep) for b in _rutas_disenos()):
        abort(404)
    return send_file(r, mimetype="image/png", max_age=600)


@app.post("/api/juegos/disenos/crear")
def juegos_disenos_crear():
    """✨ Crear un diseño nuevo desde una descripción: figura 3D animada (tipo=3d) o diseño 2D (retrato, icono, sprites, fondo…)."""
    from noviq import figuras3d as F
    from noviq import figuras2d as F2
    d = J()
    texto = (d.get("texto") or "").strip()
    if not texto and not d.get("plantilla"):
        return jsonify({"ok": False, "error": "Describe lo que quieres crear (ej. «soldado de bloques», «dragón rojo», «fondo de bosque al atardecer»)."}), 400
    try:
        if (d.get("tipo") or "3d") == "2d":
            info = F2.crear_desde_texto(texto)
            return jsonify({"ok": True, "tipo": "2d", "nombre": info.get("nombre"), "categoria": info.get("categoria"), "img": info.get("png"),
                            "reutilizado": info.get("reutilizado")})
        if d.get("plantilla") in F.POR_ID:
            pl, cambios = F.POR_ID[d["plantilla"]], dict(d.get("cambios") or {})
        else:
            pl, cambios, _ = F.desde_texto(texto)
        if d.get("bloques") and pl["rig"] in ("humanoide", "cuadrupedo"):
            cambios["_estilo"] = "bloques"
        info = F.guardar(pl, cambios, float(d.get("detalle") or 1.0), nombre=d.get("nombre") or None, descripcion=texto)
        return jsonify({"ok": True, "tipo": "3d", "nombre": info.get("nombre"), "categoria": info.get("categoria"), "img": info.get("miniatura_png"),
                        "ruta": info.get("ruta"), "animaciones": info.get("animaciones"), "reutilizado": info.get("reutilizado"), "plantilla": pl["id"]})
    except Exception as e:
        return jsonify({"ok": False, "error": f"{type(e).__name__}: {e}"}), 500


@app.route("/api/nvidia", methods=["GET", "POST"])
def nvidia_api():
    """🟩 GPU NVIDIA y herramientas: info (GET), textura o modelo 3D con IA para un proyecto (POST)."""
    from noviq import nvidia as NV
    if request.method == "GET":
        i = NV.info(max_age=0 if request.args.get("actualizar") else 120)
        return jsonify(dict(i, resumen=NV.resumen(i)))
    d = J()
    p = project_path(d.get("proyecto") or "")
    if not d.get("proyecto") or not p.exists():
        return jsonify({"ok": False, "error": "elige primero un proyecto"}), 400
    from noviq import activos as A
    try:
        if d.get("accion") == "textura":
            r = NV.textura(d.get("descripcion") or "", p / "assets" / "texturas", d.get("nombre") or "textura")
            rel = {k: Path(v).relative_to(p).as_posix() for k, v in r.items() if k in ("color", "normal")}
            A.registrar(p, {"id": "ia-" + (d.get("nombre") or "textura"), "fuente": "nvidia", "nombre": d.get("nombre") or "textura",
                            "tipo": "textura", "rol": d.get("rol") or d.get("nombre") or "", "licencia": "generada con IA",
                            "autor": "NVIDIA FLUX (build.nvidia.com)", "mapas": rel})
            return jsonify({"ok": True, **r})
        if d.get("accion") == "modelo_3d":
            r = NV.modelo_3d(d.get("descripcion") or "", p / "assets" / "modelos", d.get("rol") or d.get("nombre") or "modelo")
            A.registrar(p, {"id": "ia-" + Path(r["glb"]).stem, "fuente": "nvidia", "nombre": (d.get("descripcion") or "")[:60], "tipo": "modelo",
                            "rol": d.get("rol") or "", "licencia": "generado con IA", "autor": "Microsoft TRELLIS (build.nvidia.com)",
                            "archivo": Path(r["glb"]).relative_to(p).as_posix(), "bytes": r["bytes"]})
            return jsonify({"ok": True, **r})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)[:400]})
    return jsonify({"ok": False, "error": "accion: textura | modelo_3d"}), 400


@app.route("/api/banco", methods=["GET", "POST"])
def banco_api():
    """🧪 Banco de pruebas de IAs (preguntas y respuestas reales con tus claves)."""
    from noviq import banco
    if request.method == "POST":
        d = J()
        if d.get("detener"):
            banco.detener()
            return jsonify({"ok": True, "detenido": True})
        mods = [m for m in (d.get("modelos") or []) if isinstance(m, str) and "::" in m] or banco.modelos_sugeridos()
        ok = banco.iniciar(mods)
        return jsonify({"ok": ok, "modelos": mods, "error": "" if ok else "ya hay una prueba en marcha"})
    return jsonify(banco.estado())


@app.post("/api/calificar")
def calificar():
    """👍/👎 del usuario sobre la última respuesta: el evaluador lo usa para elegir la mejor IA por tipo de tarea."""
    from noviq import evaluador as EV
    d = J()
    cid = d.get("conversation_id")
    if cid in RUNNING:
        return jsonify({"ok": False, "error": "Espera a que termine el turno para calificarlo."}), 409
    c = load_conv(cid) if cid else None
    if not c:
        abort(404)
    modelos = EV.calificar(c, d.get("valor", 1))
    save_conv(c)
    return jsonify({"ok": True, "modelos": modelos})


@app.get("/api/trabajando")
def trabajando():
    out = []
    for cid, jb in JOBS.items():
        if not jb["done"]:
            c = jb["conv"]
            pend = any(k in ("confirm", "ask_user") and p.get("id") in PENDING for k, p in jb["events"][-50:]) if PENDING else False
            out.append({"id": cid, "title": c.get("title"), "project": c.get("project"), "model": c.get("model"),
                        "desde": jb["t"], "espera_permiso": pend})
    return jsonify(out)


# ───────────── Archivos ─────────────
@app.get("/f")
def serve_file():
    p = Path(request.args.get("p", ""))
    if not p.is_file():
        abort(404)
    return send_file(p, as_attachment=request.args.get("d") == "1", max_age=0)


@app.get("/raw/<tok>/<path:fp>")
def serve_raw(tok, fp):
    """Sirve archivos por ruta absoluta para la vista previa (HTML con sus CSS/JS relativos)."""
    if tok != TOKEN:
        abort(403)
    p = Path(fp if IS_WINDOWS else "/" + fp)
    if p.is_dir() and (p / "index.html").exists():
        p = p / "index.html"
    if not p.is_file():
        abort(404)
    return send_file(p, max_age=0)


@app.get("/api/file_text")
def file_text():
    p = Path(request.args.get("p", ""))
    if not p.is_file() or p.stat().st_size > 3_000_000:
        abort(404)
    return jsonify({"text": T._read_text(p), "name": p.name, "path": str(p)})


@app.post("/api/upload")
def upload():
    project = request.form.get("project") or ""
    base = project_path(project) if project and project_path(project).exists() else general_dir()
    dest = base / "adjuntos"
    dest.mkdir(exist_ok=True)
    saved = []
    for f in request.files.getlist("files"):
        name = T.safe_name(Path(f.filename).name) or "archivo"
        p = dest / name
        if p.exists():
            p = dest / f"{p.stem}_{int(time.time())}{p.suffix}"
        f.save(p)
        saved.append(str(p))
    return jsonify({"files": saved})


@app.post("/api/abrir")
def abrir():
    ruta = J().get("ruta") or str(projects_root())
    p = Path(ruta)
    if not p.exists():
        return jsonify({"ok": False}), 404
    if IS_WINDOWS:
        if p.is_file():
            subprocess.Popen(["explorer", "/select,", str(p)])
        else:
            os.startfile(str(p))  # type: ignore[attr-defined]
    elif sys.platform == "darwin":
        subprocess.Popen(["open", "-R", str(p)] if p.is_file() else ["open", str(p)])
    else:
        subprocess.Popen(["xdg-open", str(p.parent if p.is_file() else p)])
    return jsonify({"ok": True})


@app.post("/api/guardar_codigo")
def guardar_codigo():
    d = J()
    project = d.get("project")
    base = project_path(project) if project and project_path(project).exists() else general_dir()
    p = Path(d.get("nombre") or "codigo.txt")
    p = p if p.is_absolute() else base / p
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(d.get("contenido", ""), encoding="utf-8")
    return jsonify({"ok": True, "path": str(p), "name": p.name})


# ───────────── Memoria y MCP ─────────────
@app.get("/api/memoria")
def get_mem():
    return jsonify({"text": T.read_memory()})


@app.post("/api/memoria")
def set_mem():
    MEMORY_FILE.write_text(J().get("text", ""), encoding="utf-8")
    return jsonify({"ok": True})


@app.get("/api/mcp")
def mcp_get():
    return jsonify({"config": MANAGER.load_config_text(), "servers": MANAGER.status()})


@app.post("/api/mcp")
def mcp_set():
    try:
        MANAGER.save_config_text(J().get("config", "{}"))
    except Exception as e:
        return jsonify({"ok": False, "error": f"JSON inválido: {e}"}), 400
    MANAGER.reload()
    time.sleep(1.5)
    return jsonify({"ok": True, "servers": MANAGER.status()})


@app.post("/api/diagnostico")
def diagnostico():
    """Prueba rápida de un modelo: ¿responde?, ¿usa herramientas nativas?, ¿cuánto razona?"""
    from noviq.config import set_override
    from noviq.providers import parse_text_tool_calls, stream_chat, strip_tool_text
    model = J().get("model") or CONFIG["model"]
    tool = {"type": "function", "function": {"name": "obtener_hora", "description": "Devuelve la hora actual de una ciudad",
            "parameters": {"type": "object", "properties": {"ciudad": {"type": "string"}}, "required": ["ciudad"]}}}
    msgs = [{"role": "system", "content": "Eres un asistente. Cuando se pida, usa las herramientas disponibles."},
            {"role": "user", "content": "¿Qué hora es en Quito? Usa la herramienta obtener_hora."}]
    res = {"model": model}
    t0 = time.time()
    try:
        raw, reasoning, calls, finish = stream_chat(model, msgs, [tool], lambda k, v: None, threading.Event(), max_attempts=2)
        res.update(ok=True, finish=finish, reasoning_chars=len(reasoning), content=strip_tool_text(raw)[:300],
                   native=bool(calls), text_format=False)
        if calls:
            set_override(model, "tool_mode", "nativo")
            res["verdict"] = "✔ Usa herramientas nativas correctamente."
        else:
            tc = parse_text_tool_calls(raw, {"obtener_hora"})
            if tc:
                set_override(model, "tool_mode", "texto")
                res.update(text_format=True, verdict="✔ Usa herramientas escritas como texto (configurado en modo texto).")
            elif finish == "length":
                res["verdict"] = "⚠ Se quedó sin tokens razonando. El programa subirá el límite y reducirá el razonamiento automáticamente."
            else:
                res["verdict"] = "⚠ Respondió sin usar la herramienta. Puede funcionar para chat, pero no es bueno como agente."
    except APIError as e:
        res.update(ok=False, error=str(e)[:600], verdict="✖ Error: " + str(e)[:200])
    res["seconds"] = round(time.time() - t0, 1)
    return jsonify(res)


@app.get("/api/registro")
def registro():
    from noviq.config import DATA_DIR
    f = DATA_DIR / "registro.log"
    lines = f.read_text(encoding="utf-8").splitlines()[-80:] if f.exists() else []
    return jsonify({"lines": lines})


@app.post("/api/responder")
def responder():
    """Respuesta del usuario a pedir_ayuda_usuario (texto + capturas)."""
    d = J()
    p = T.ASK.get(d.get("id"))
    if p:
        p["texto"], p["imagenes"] = d.get("texto", ""), d.get("imagenes") or []
        p["event"].set()
    return jsonify({"ok": bool(p)})


@app.post("/api/mcp/preset")
def mcp_preset():
    from noviq.mcp import PRESETS
    key = J().get("key")
    if key not in PRESETS:
        abort(400)
    MANAGER.add_preset(key)
    time.sleep(2)
    return jsonify({"ok": True, "config": MANAGER.load_config_text(), "servers": MANAGER.status()})


@app.get("/api/sistema")
def sistema():
    import shutil
    chrome = edge = None
    if IS_WINDOWS:
        pf = [os.environ.get(k, "") for k in ("ProgramFiles", "ProgramFiles(x86)", "LOCALAPPDATA")]
        chrome = any(Path(b, "Google/Chrome/Application/chrome.exe").exists() for b in pf if b)
        edge = any(Path(b, "Microsoft/Edge/Application/msedge.exe").exists() for b in pf if b)
    return jsonify({"node": bool(shutil.which("npx")), "chrome": chrome, "edge": edge,
                    "navegador_activo": MANAGER.has_browser()})


# ───────────── Catálogo de modelos (globo informativo) ─────────────
@app.get("/api/catalogo")
def catalogo_api():
    from noviq import catalogo as K
    infos = K.all_infos(max_age=0 if request.args.get("refresh") else (3 if request.args.get("rapido") else 20))
    return jsonify({"modelos": infos, "recomendaciones": K.recomendaciones(infos),
                    "vanguardia": K.ranking(infos, need_tools=True), "cerebros": K.ranking(infos, need_tools=False, n=3),
                    "config_vanguardia": CONFIG.get("vanguardia") or {}, "modelo_cerebro": CONFIG.get("modelo_cerebro", "auto")})


@app.post("/api/vanguardia")
def vanguardia_api():
    """Modo vanguardia: usar siempre los modelos gratuitos más inteligentes (principal + respaldo)."""
    from noviq import catalogo as K
    d = request.get_json(silent=True) or {}
    V = dict(CONFIG.get("vanguardia") or {})
    for k in ("activo", "planificar"):
        if k in d:
            V[k] = bool(d[k])
    if "modelo_cerebro" in d:
        CONFIG["modelo_cerebro"] = (d.get("modelo_cerebro") or "auto").strip()
    out = {}
    if d.get("aplicar"):
        from noviq.providers import probe
        infos = K.all_infos(max_age=0)
        cand = K.ranking(infos, need_tools=True, n=10)
        res = {}
        ths = [threading.Thread(target=lambda m=m: res.__setitem__(m, probe(m, 40)), daemon=True) for m in cand]
        for t in ths:
            t.start()
        for t in ths:
            t.join(50)
        rank = [m for m in cand if (res.get(m) or {}).get("ok")][:6]
        out["descartados"] = {m: r for m, r in res.items() if not r.get("ok")}
        if not rank:
            return jsonify({"ok": False, "error": "Ningún modelo gratuito en la nube respondió. Conecta alguno en 🎁 IA gratis.", **out})
        CONFIG["model"] = rank[0]
        CONFIG["fallback_models"] = rank[1:]
        CONFIG["fallback_enabled"] = True
        V["activo"] = True
        out.update({"modelo": rank[0], "respaldo": rank[1:]})
    CONFIG["vanguardia"] = V
    save_config()
    return jsonify({"ok": True, "vanguardia": V, **out})


# ───────────── Salud de modelos ─────────────
@app.get("/api/salud")
def salud_api():
    from noviq import salud as S
    from noviq.providers import _models_cache
    prov = []
    for pid, pc in CONFIG["providers"].items():
        if not pc.get("enabled"):
            continue
        c = _models_cache.get(pid) or {}
        st = S.provider_state(pid)
        if (c and not c.get("ok")) or st:
            prov.append({"id": pid, "nombre": pc.get("name", pid), "error": c.get("error") or (st or {}).get("motivo", ""),
                         "kind": c.get("kind") or (st or {}).get("kind"), "solucion": (st or {}).get("solucion", "")})
    return jsonify({"problemas": prov, **S.resumen()})


@app.post("/api/claves/probar")
def claves_probar():
    """Prueba CADA API key de un proveedor por separado: lista de modelos + un mensaje real corto (con el tiempo que
    tardó). Así se sabe qué clave funciona, cuál está vencida y si dos cuentas ven modelos distintos."""
    import requests as rq
    from noviq import salud as S
    from noviq.providers import _headers, _models_cache, provider_cfg
    d = J()
    pid = d.get("pid")
    try:
        p = provider_cfg(pid)
    except Exception as e:
        return jsonify({"error": str(e)})
    keys = vault.get_keys(pid)
    if not keys:
        return jsonify({"claves": [], "error": "No hay claves guardadas: pégalas en la caja y pulsa Guardar."})
    test_model = d.get("modelo") or next((m.split("::", 1)[1] for m, t in S._load().get("verificados", {}).items()
                                          if m.startswith(pid + "::")), None)
    if not test_model:  # sin modelos verificados: uno pequeño y estable de la lista del proveedor
        lista = (_models_cache.get(pid) or {}).get("models") or []
        pref = ("meta/llama-3.1-8b-instruct", "meta/llama-3.3-70b-instruct", "gemini-2.5-flash", "gpt-4o-mini")
        test_model = next((m for m in pref if m in lista), lista[0] if lista else None)
    out = []
    iguales = {}
    for n, k in enumerate(keys, 1):
        iguales.setdefault(k, []).append(n)
        item = {"n": n, "mask": vault.mask(k), "ok": False, "modelos": None, "error": "", "ms": None, "modelo_prueba": test_model,
                "aviso": vault.formato_sospechoso(pid, k)}
        try:
            r = rq.get(p["base_url"].rstrip("/") + "/models", headers=_headers(k, p), timeout=20)
            if r.status_code in (401, 403):
                item["error"] = "clave inválida, vencida o revocada (" + str(r.status_code) + ")"
            else:
                try:
                    item["modelos"] = len((r.json() or {}).get("data") or [])
                except ValueError:
                    pass
                item["ok"] = r.status_code == 200
                if test_model:
                    t0 = time.time()
                    c = rq.post(p["base_url"].rstrip("/") + "/chat/completions", headers=_headers(k, p), timeout=60,
                                json={"model": test_model, "messages": [{"role": "user", "content": "Responde solo: ok"}],
                                      "max_tokens": 16})
                    item["ms"] = int((time.time() - t0) * 1000)
                    if c.status_code in (401, 403):
                        item.update(ok=False, error="la clave no tiene permiso para chatear")
                    elif c.status_code == 404 and "account" in c.text.lower():
                        item["nota"] = f"{test_model} no está en esta cuenta"
                    elif c.status_code == 429:
                        item["nota"] = "límite por minuto alcanzado (la clave funciona; espera un momento)"
                    elif c.status_code == 200:
                        try:
                            msg = (c.json().get("choices") or [{}])[0].get("message") or {}
                            item["respuesta"] = (msg.get("content") or msg.get("reasoning_content") or "")[:60]
                        except ValueError:
                            pass
                    elif c.status_code >= 500:
                        item["nota"] = f"{test_model} respondió {c.status_code} (servidor ocupado; la clave es válida)"
                if not item["ok"] and not item["error"]:
                    item["error"] = f"respondió {r.status_code}"
        except rq.RequestException as e:
            item["error"] = f"sin conexión ({type(e).__name__})"
        out.append(item)
    dups = [v for v in iguales.values() if len(v) > 1]
    return jsonify({"claves": out, "modelo_prueba": test_model,
                    "nota": ("Hay claves repetidas: " + "; ".join(" = ".join(f"clave {x}" for x in v) for v in dups)) if dups else ""})


@app.post("/api/salud/probar")
def salud_probar():
    from noviq.providers import probe
    ids = (J().get("ids") or [])[:12]
    res = {}
    ths = [threading.Thread(target=lambda m=m: res.__setitem__(m, probe(m, 40)), daemon=True) for m in ids]
    for t in ths:
        t.start()
    for t in ths:
        t.join(50)
    return jsonify(res)


@app.route("/api/verificador", methods=["GET", "POST"])
def verificador_api():
    from noviq import verificador
    if request.method == "POST":
        d = J()
        verificador.pedir(d.get("pid") or None, forzar=bool(d.get("forzar")))
    return jsonify(verificador.estado())


@app.post("/api/salud/reset")
def salud_reset():
    from noviq import salud as S
    S.reset(J().get("model") or None)
    return jsonify({"ok": True})


# ───────────── IA local ─────────────
@app.post("/api/optimizar_ollama")
def optimizar_ollama():
    from noviq import local as LOC
    env = LOC.optimizar_ollama_windows()
    done = []
    if IS_WINDOWS:
        for k, v in env.items():
            r = subprocess.run(["setx", k, v], capture_output=True, text=True, creationflags=0x08000000)
            done.append({"var": k, "valor": v, "ok": r.returncode == 0})
        CONFIG.setdefault("local", {})["kv_q8"] = True
        save_config()
        return jsonify({"ok": True, "hecho": done, "nota": "Cierra Ollama (icono junto al reloj → Quit) y vuelve a abrirlo para aplicar."})
    return jsonify({"ok": False, "hecho": [], "nota": "En este sistema agrega estas variables al servicio de Ollama: "
                    + ", ".join(f"{k}={v}" for k, v in env.items())})


# ───────────── Proyectos existentes ─────────────
@app.post("/api/elegir_carpeta")
def elegir_carpeta():
    """Abre el selector de carpetas nativo del sistema y devuelve la ruta elegida."""
    code = ("import tkinter as tk\nfrom tkinter import filedialog\nr=tk.Tk();r.withdraw();r.attributes('-topmost',True)\n"
            "print(filedialog.askdirectory(title='Elige la carpeta raíz del proyecto') or '')")
    ruta = ""
    try:
        from noviq.config import FROZEN
        cmd = [sys.executable, "--elegir-carpeta"] if FROZEN else [sys.executable, "-c", code]
        r = subprocess.run(cmd, capture_output=True, text=True, timeout=600)
        ruta = r.stdout.strip()
    except Exception:
        pass
    if not ruta and IS_WINDOWS:
        ps = ("Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog;"
              "$d.Description='Elige la carpeta raíz del proyecto'; if($d.ShowDialog() -eq 'OK'){$d.SelectedPath}")
        try:
            r = subprocess.run(["powershell", "-NoProfile", "-STA", "-Command", ps], capture_output=True, text=True, timeout=600)
            ruta = r.stdout.strip()
        except Exception:
            pass
    return jsonify({"ruta": ruta})


@app.get("/api/projects/<name>/estado")
def project_estado(name):
    return jsonify({"text": E.read_project_file(name) or ""})


@app.post("/api/projects/<name>/entrega")
def proyecto_entrega(name):
    """📦 ZIP de entrega del proyecto (botón en la ficha del proyecto)."""
    from noviq import versiones as VR
    root = project_path(name)
    if not root.exists():
        return jsonify({"ok": False, "error": "no existe la carpeta del proyecto"})
    try:
        z, n, size = VR.crear_entrega(root, name, (J().get("nota") or "").strip())
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})
    return jsonify({"ok": True, "nombre": z.name, "ruta": str(z), "carpeta": str(z.parent), "archivos": n, "bytes": size})


@app.post("/api/projects/importar")
def importar_proyecto():
    d = J()
    try:
        name, p, det = T.import_project(d.get("ruta", ""), d.get("nombre", ""))
    except ValueError as e:
        return jsonify({"ok": False, "error": str(e)}), 400
    return jsonify({"ok": True, "name": name, "path": str(p), **det})


@app.post("/api/projects/<name>/quitar")
def quitar_proyecto(name):
    return jsonify({"ok": T.unlink_project(name)})


# ───────────── Explorador de archivos ─────────────
def _safe_write_path(ruta):
    p = Path(ruta).resolve()
    if not T.inside_root(p):
        abort(403, "Solo se puede modificar dentro de tus proyectos")
    return p


@app.get("/api/ruta_info")
def ruta_info():
    raw = (request.args.get("p") or "").strip().strip('"').strip("'")
    if raw.startswith("file:///"):
        raw = raw[8:] if IS_WINDOWS else raw[7:]
    from urllib.parse import unquote
    p = Path(unquote(raw)).expanduser()
    if not p.is_absolute():
        cands = [project_path(n) / p for n in ([request.args.get("proyecto")] if request.args.get("proyecto") else [])] + [projects_root() / p]
        p = next((c for c in cands if c.exists()), p)
    return jsonify({"existe": p.exists(), "dir": p.is_dir(), "ruta": str(p)})


@app.get("/api/arbol")
def arbol():
    p = Path(request.args.get("ruta", "")).resolve()
    if not p.is_dir():
        abort(404)
    items = []
    try:
        for c in sorted(p.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            if c.name in (".git", "node_modules", "__pycache__", ".venv", "venv", ".noviq", ".pytest_cache"):
                continue
            try:
                st = c.stat()
            except OSError:
                continue
            items.append({"name": c.name, "path": str(c), "dir": c.is_dir(), "size": st.st_size if c.is_file() else None,
                          "mtime": st.st_mtime})
            if len(items) >= 500:
                break
    except PermissionError:
        pass
    return jsonify({"path": str(p), "items": items, "editable": T.inside_root(p)})


@app.post("/api/archivo/guardar")
def archivo_guardar():
    d = J()
    p = _safe_write_path(d.get("ruta", ""))
    if p.exists():
        ctx = T.ToolContext({"project": d.get("proyecto"), "respaldos": []}, lambda *a: None, threading.Event())
        T._backup(ctx, p)
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(d.get("contenido", ""), encoding="utf-8", newline="")
    return jsonify({"ok": True, "size": p.stat().st_size})


@app.post("/api/archivo/mover")
def archivo_mover():
    import shutil as _sh
    d = J()
    src = _safe_write_path(d.get("origen", ""))
    dst_dir = _safe_write_path(d.get("destino", ""))
    if not dst_dir.is_dir():
        dst_dir = dst_dir.parent
    dst = dst_dir / src.name
    if dst.exists() or str(dst_dir).startswith(str(src)):
        return jsonify({"ok": False, "error": "Ya existe un archivo con ese nombre en el destino o destino inválido."}), 400
    _sh.move(str(src), str(dst))
    return jsonify({"ok": True, "path": str(dst)})


@app.post("/api/archivo/renombrar")
def archivo_renombrar():
    d = J()
    src = _safe_write_path(d.get("ruta", ""))
    nuevo = T.safe_name(d.get("nombre", ""))
    dst = src.parent / nuevo
    if dst.exists():
        return jsonify({"ok": False, "error": "Ya existe ese nombre."}), 400
    src.rename(dst)
    return jsonify({"ok": True, "path": str(dst)})


@app.post("/api/archivo/nuevo")
def archivo_nuevo():
    d = J()
    carpeta = _safe_write_path(d.get("carpeta", ""))
    p = carpeta / T.safe_name(d.get("nombre", "nuevo.txt"))
    if p.exists():
        return jsonify({"ok": False, "error": "Ya existe."}), 400
    if d.get("tipo") == "carpeta":
        p.mkdir(parents=True)
    else:
        p.write_text("", encoding="utf-8")
    return jsonify({"ok": True, "path": str(p)})


@app.post("/api/archivo/eliminar")
def archivo_eliminar():
    p = _safe_write_path(J().get("ruta", ""))
    ctx = T.ToolContext({"project": None}, lambda *a: None, threading.Event())
    r = T.t_eliminar({"ruta": str(p)}, ctx)
    return jsonify({"ok": not r.startswith("ERROR"), "msg": r})


# ───────────── IA gratis ─────────────
@app.get("/api/gratis")
def gratis_list():
    from noviq import gratis as G
    from noviq.providers import _models_cache
    out = []
    for g in G.GRATIS:
        p = CONFIG["providers"].get(g["id"], {})
        c = _models_cache.get(g["id"]) or {}
        out.append(dict(g, activo=bool(p.get("enabled")), tiene_clave=bool(vault.get_keys(g["id"])),
                        ok=bool(c.get("ok")), modelos=len(c.get("models") or []), error=c.get("error", ""),
                        solo_gratis=p.get("solo_gratis"), cuenta=p.get("cuenta", ""),
                        url=(p.get("base_url") or "").removesuffix("/v1") if g.get("remoto") else ""))
    return jsonify(out)


@app.post("/api/gratis/guardar")
def gratis_guardar():
    from noviq.providers import list_models
    d = J()
    pid, key = d.get("id"), (d.get("clave") or "").strip()
    if pid not in CONFIG["providers"]:
        abort(400)
    if key:
        vault.set_keys(pid, list(dict.fromkeys(vault.get_keys(pid) + [key])))
        from noviq import salud as S
        S.reset_proveedor(pid)
    if d.get("cuenta"):
        CONFIG["providers"][pid]["cuenta"] = d["cuenta"].strip()
    if d.get("url"):
        u = d["url"].strip().rstrip("/")
        CONFIG["providers"][pid]["base_url"] = u if u.endswith("/v1") else u + "/v1"
    if key and CONFIG["providers"][pid].get("remoto"):
        vault.set_keys(pid, [key])  # el token del servidor remoto cambia en cada sesión
    CONFIG["providers"][pid]["enabled"] = True
    if CONFIG["providers"][pid].get("decisor"):
        save_config()
        from noviq import decisor
        nivel, fuente = decisor.riesgo("ejecutar_powershell", {"comando": "Get-ChildItem"})
        return jsonify({"ok": True, "modelos": 0, "error": "", "ejemplos": [],
                        "nota": f"Decisor: {'Jev respondió ✔' if fuente == 'jev' else 'Jev no respondió; se usan las reglas locales (' + decisor.estado().get('ultimo_error', '') + ')'}"})
    if "solo_gratis" in d:
        CONFIG["providers"][pid]["solo_gratis"] = bool(d["solo_gratis"])
    save_config()
    r = list_models(pid, refresh=True)
    if r["ok"]:
        from noviq import verificador
        verificador.pedir(pid, forzar=bool(key))  # el verificador comprueba qué modelos responden de verdad
    return jsonify({"ok": r["ok"], "modelos": len(r["models"]), "error": r["error"], "ejemplos": r["models"][:6]})


@app.get("/api/remoto/cuaderno")
def remoto_cuaderno():
    from noviq import remoto
    nb, token = remoto.cuaderno(request.args.get("modelo") or "qwen3-coder:30b")
    return Response(nb, mimetype="application/x-ipynb+json",
                    headers={"Content-Disposition": "attachment; filename=noviq_servidor_gpu_kaggle.ipynb"})


@app.get("/api/decisor")
def decisor_estado():
    from noviq import decisor
    return jsonify(decisor.estado())


@app.post("/api/gratis/openrouter")
def gratis_openrouter():
    from noviq import gratis as G
    return jsonify({"url": G.openrouter_auth_url(PORT)})


@app.get("/oauth/openrouter")
def oauth_openrouter():
    from noviq import gratis as G
    from noviq.providers import list_models
    try:
        key = G.openrouter_exchange(request.args.get("state", ""), request.args.get("code", ""))
        vault.set_keys("openrouter", list(dict.fromkeys(vault.get_keys("openrouter") + [key])))
        CONFIG["providers"]["openrouter"]["enabled"] = True
        CONFIG["providers"]["openrouter"].setdefault("solo_gratis", True)
        save_config()
        list_models("openrouter", refresh=True)
        msg, color = "✅ ¡OpenRouter conectado! Ya puedes cerrar esta pestaña y volver a Noviq.", "#3fdc2b"
    except Exception as e:
        msg, color = f"❌ No se pudo conectar: {e}", "#ef5350"
    return Response(f"""<!doctype html><meta charset="utf-8"><title>Noviq</title>
<body style="background:#0a0f14;color:#e8f0ec;font:18px Segoe UI,sans-serif;display:grid;place-items:center;height:100vh;margin:0">
<div style="text-align:center"><img src="/static/noviq_icon.png" width="96" style="border-radius:18px"><p style="color:{color}">{html_escape(msg)}</p></div>
<script>setTimeout(()=>window.close(),2500)</script></body>""", mimetype="text/html")


@app.get("/api/tools")
def tools_list():
    return jsonify([{"name": t["function"]["name"], "desc": t["function"]["description"]} for t in T.BUILTIN + MANAGER.tool_defs(include_browser=True)])


# ───────────── Tareas programadas ─────────────
def _run_scheduled(t):
    """Arranca una tarea programada como una conversación más (trabaja en paralelo con las demás)."""
    from noviq import programador as PG  # noqa: F401
    cid = t.get("conv_id") if t.get("misma_conv") and t.get("conv_id") else None
    conv = load_conv(cid) if cid else None
    if conv and conv["id"] in RUNNING:
        return None
    if not conv:
        cid = uuid.uuid4().hex[:16]
        conv = new_conv(cid, t.get("proyecto"), t.get("modelo") or CONFIG["model"])
        conv["title"] = "⏰ " + (t.get("nombre") or "Tarea programada")[:55]
    if t.get("autonomo", True):
        conv["permiso"] = "auto"
    conv["origen"], conv["tarea_programada"] = "programada", t.get("id")
    text = f"[Tarea programada «{t.get('nombre')}» · {time.strftime('%Y-%m-%d %H:%M')}]\n{t.get('instruccion', '')}"
    E.record_user(conv, text)
    conv["display"].append({"type": "user", "text": text, "images": [], "files": [], "msg_index": len(conv["messages"])})
    conv["messages"].append({"role": "user", "content": text})
    save_conv(conv)
    start_job(conv)
    return conv["id"]


@app.get("/api/programadas")
def prog_list():
    from noviq import programador as PG
    return jsonify(PG.listar())


@app.post("/api/programadas")
def prog_save():
    from noviq import programador as PG
    d = J()
    try:
        cuando = d.get("cuando") or {}
        if isinstance(cuando, str):  # «los lunes y jueves a las 9» escrito tal cual
            from noviq.agenda import interpretar
            cuando = interpretar(cuando) or {}
        t = PG.crear(d.get("nombre"), d.get("instruccion") or "", cuando, d.get("proyecto"), d.get("modelo"),
                     d.get("autonomo", True), d.get("misma_conv", False), d.get("recuperar", True), d.get("id"))
        return jsonify({"ok": True, "tarea": dict(t, descripcion=PG.describe(t))})
    except Exception as e:
        return jsonify({"ok": False, "error": str(e)})


@app.post("/api/programadas/<tid>/<accion>")
def prog_action(tid, accion):
    from noviq import programador as PG
    if accion == "ejecutar":
        return jsonify({"ok": True, "conv": PG.ejecutar_ahora(tid)})
    if accion in ("pausar", "reanudar"):
        PG.activar(tid, accion == "reanudar")
    elif accion == "eliminar":
        PG.eliminar(tid)
    return jsonify({"ok": True})


@app.route("/api/inicio_windows", methods=["GET", "POST"])
def inicio_windows():
    """Acceso directo en la carpeta Inicio de Windows para que Noviq (y sus tareas programadas) arranque con el PC."""
    if not IS_WINDOWS:
        return jsonify({"ok": False, "activo": False, "error": "Solo en Windows."})
    import subprocess
    startup = Path(os.environ.get("APPDATA", "")) / "Microsoft/Windows/Start Menu/Programs/Startup"
    lnk = startup / "Noviq.lnk"
    if request.method == "GET":
        return jsonify({"ok": True, "activo": lnk.exists()})
    on = bool(J().get("activo"))
    if not on:
        lnk.unlink(missing_ok=True)
        return jsonify({"ok": True, "activo": False})
    from noviq.config import FROZEN
    target = Path(sys.executable) if FROZEN else BASE_DIR / "iniciar.bat"
    ico = BASE_DIR / "static" / "noviq.ico"
    ps = (f"$s=(New-Object -ComObject WScript.Shell).CreateShortcut('{lnk}'); $s.TargetPath='{target}'; "
          + ("$s.Arguments='--no-browser'; " if FROZEN else "")
          + f"$s.WorkingDirectory='{target.parent}'; $s.WindowStyle=7; $s.IconLocation='{ico}'; $s.Save()")
    r = subprocess.run(["powershell", "-NoProfile", "-Command", ps], capture_output=True, text=True)
    return jsonify({"ok": lnk.exists(), "activo": lnk.exists(), "error": r.stderr[-300:]})


# ───────────── Control del PC ─────────────
@app.get("/api/pc")
def pc_estado():
    from noviq.mcp import PC_SERVERS
    st = [x for x in MANAGER.status() if x["name"] in PC_SERVERS]
    import shutil
    return jsonify({"windows": IS_WINDOWS, "windows_mcp": st[0] if st else None, "uv": bool(shutil.which("uvx"))})


@app.post("/api/pc/probar")
def pc_probar():
    from noviq import pc
    return jsonify(pc.probar())


@app.post("/api/pc/activar")
def pc_activar():
    """Instala uv (si falta) y agrega Windows-MCP como servidor MCP."""
    import shutil
    import subprocess
    log = []
    if not shutil.which("uvx"):
        from noviq.config import python_exe
        py = python_exe()
        if not py:
            return jsonify({"ok": False, "error": "Falta Python en tu PC. Instala uv con: winget install astral-sh.uv", "log": log})
        r = subprocess.run([py, "-m", "pip", "install", "--upgrade", "uv"], capture_output=True, text=True, timeout=300)
        log.append("pip install uv: " + ("ok" if r.returncode == 0 else r.stderr[-300:]))
        scripts = Path(py).parent / ("Scripts" if IS_WINDOWS else "")
        if (scripts / "uvx.exe").exists() or (scripts / "uvx").exists():
            os.environ["PATH"] = str(scripts) + os.pathsep + os.environ.get("PATH", "")
    if not shutil.which("uvx"):
        return jsonify({"ok": False, "error": "No pude instalar uv. Instálalo con: winget install astral-sh.uv", "log": log})
    MANAGER.add_preset("control_pc")
    return jsonify({"ok": True, "log": log, "nota": "Windows-MCP se está iniciando (la primera vez descarga Python 3.13 y tarda 1-2 min)."})


# ───────────── 🔌 Catálogo MCP, 🪪 perfil de Windows ─────────────
@app.route("/api/mcp/catalogo", methods=["GET", "POST"])
def mcp_catalogo():
    from noviq import mcp as M
    if request.method == "POST":
        d = J()
        log = []
        acc = d.get("accion")
        if acc == "agregar":
            M.conectar([d.get("key")], log)
        elif acc == "recomendados":
            M.conectar(M.RECOMENDADOS, log)
        elif acc == "quitar" and d.get("key") in M.CATALOGO:
            MANAGER.quitar(d["key"])
            log.append("✔ Quitado.")
        elif acc == "requisito" and d.get("req") in ("node", "uv"):
            M.instalar_requisito(d["req"], log)
        time.sleep(1)
        return jsonify({"ok": True, "log": log, "catalogo": M.catalogo_publico(), "requisitos": M.requisitos(), "servers": MANAGER.status()})
    return jsonify({"catalogo": M.catalogo_publico(), "requisitos": M.requisitos(), "servers": MANAGER.status(),
                    "navegador": (CONFIG.get("pc") or {}).get("navegador", "auto")})


@app.post("/api/pc/navegador")
def pc_navegador():
    v = J().get("navegador")
    if v in ("auto", "real", "automatico"):
        CONFIG["pc"] = dict(CONFIG.get("pc") or {}, navegador=v)
        from noviq.config import save_config
        save_config()
    return jsonify({"ok": True})


@app.get("/api/pc/perfil")
def pc_perfil():
    from noviq import perfil_windows as PW
    d = PW.perfil(forzar=request.args.get("forzar") == "1")
    return jsonify(dict({k: v for k, v in d.items() if k != "apps"}, n_apps=len(d.get("apps") or []), resumen=PW.resumen_prompt()))


@app.post("/api/pc/leer_pantalla")
def pc_leer_pantalla():
    """Prueba del OCR de Windows sobre la pantalla (sin imágenes para la IA)."""
    from noviq import pantalla
    from noviq.tools import ToolContext
    try:
        return jsonify({"ok": True, "texto": pantalla.leer_texto(ToolContext({}, lambda *a: None, threading.Event()), "pantalla", 60)})
    except Exception as e:
        return jsonify({"ok": False, "texto": f"✖ {e}"})


@app.route("/api/permisos", methods=["GET", "POST"])
def permisos():
    """Permisos que el usuario ya dio con «Permitir siempre» (se recuerdan entre conversaciones) y la 🛡 guardia."""
    from noviq import guardia as G
    from noviq.config import save_config
    if request.method == "POST":
        d = J()
        if "quitar" in d:
            CONFIG["permisos_siempre"] = [x for x in CONFIG.get("permisos_siempre") or [] if x != d["quitar"]]
        if isinstance(d.get("guardia"), dict):
            g = dict(CONFIG.get("guardia") or {})
            for k in ("activo", "enviar", "eliminar", "instalar", "pagos"):
                if k in d["guardia"]:
                    g[k] = bool(d["guardia"][k])
            if "espera_min" in d["guardia"]:
                g["espera_min"] = max(1, min(1440, int(d["guardia"]["espera_min"] or 30)))
            CONFIG["guardia"] = g
        save_config()
    return jsonify({"permisos_siempre": CONFIG.get("permisos_siempre") or [], "guardia": dict({"activo": True, "enviar": True, "eliminar": True,
                    "instalar": True, "pagos": True, "espera_min": 30}, **(CONFIG.get("guardia") or {})), "categorias": G.CATEGORIAS,
                    "historial": G.HISTORIAL[-15:][::-1]})


# ───────────── ✉ Correo ─────────────
@app.route("/api/correo", methods=["GET", "POST"])
def correo_api():
    from noviq import correo as CO
    if request.method == "POST":
        d = J()
        try:
            if d.get("quitar"):
                CO.quitar_cuenta(d["quitar"])
            elif d.get("predeterminada") and not d.get("tipo"):
                c = CONFIG.get("correo") or {}
                c["predeterminada"] = d["predeterminada"]
                CONFIG["correo"] = c
                from noviq.config import save_config
                save_config()
            else:
                CO.guardar_cuenta(d)
        except Exception as e:
            return jsonify(dict(CO.publico(), ok=False, error=str(e)))
    return jsonify(dict(CO.publico(), ok=True))


@app.post("/api/correo/probar")
def correo_probar():
    from noviq import correo as CO
    d = J()
    r = CO.probar(d.get("id"))
    if r["ok"] and d.get("enviar_prueba"):
        c = CO.cuenta(d.get("id"))
        try:
            r["texto"] += " " + CO.enviar(c.get("correo") or "", "Prueba de Noviq ✔", "Si ves este correo, Noviq ya puede enviar correos por ti.",
                                          cuenta_id=c["id"])
        except Exception as e:
            r.update(ok=False, texto=r["texto"] + f" ✖ Envío de prueba: {e}")
    return jsonify(r)


# ───────────── 📱 Telegram ─────────────
@app.route("/api/telegram", methods=["GET", "POST"])
def telegram_api():
    from noviq import telegram_bot as TG
    if request.method == "POST":
        d = J()
        try:
            if d.get("token"):
                TG.configurar(d["token"])
            if d.get("desvincular"):
                TG.desvincular(bool(d.get("borrar_token")))
            if isinstance(d.get("avisos"), dict):
                c = dict(CONFIG.get("telegram") or {})
                c["avisos"] = dict(c.get("avisos") or {}, **{k: bool(v) for k, v in d["avisos"].items()})
                CONFIG["telegram"] = c
                from noviq.config import save_config
                save_config()
            if "activo" in d:
                c = dict(CONFIG.get("telegram") or {})
                c["activo"] = bool(d["activo"])
                CONFIG["telegram"] = c
                from noviq.config import save_config
                save_config()
                TG.reiniciar()
            if d.get("probar"):
                if not TG.enviar("👋 Prueba de Noviq: ¡funciona! Escríbeme lo que quieres que haga en tu PC. /ayuda"):
                    return jsonify(dict(TG.estado_publico(), ok=False, error="No pude enviar el mensaje (¿vinculaste tu chat?)."))
        except Exception as e:
            return jsonify(dict(TG.estado_publico(), ok=False, error=str(e)))
        time.sleep(0.3)
    return jsonify(dict(TG.estado_publico(), ok=True))


# ───────────── 📅 Agenda ─────────────
@app.route("/api/agenda", methods=["GET", "POST"])
def agenda_api():
    from noviq import agenda as AG
    if request.method == "POST":
        d = J()
        if d.get("borrar"):
            AG.borrar_nota(d["borrar"])
        elif d.get("texto"):
            AG.nota(d["texto"], "nota", importante=bool(d.get("importante")))
    return jsonify({"semana": AG.semana(), "notas": AG.notas(int(request.args.get("n") or 40))})


@app.post("/api/agenda/interpretar")
def agenda_interpretar():
    from noviq import agenda as AG
    c = AG.interpretar(J().get("texto") or "")
    return jsonify({"ok": bool(c), "cuando": c})


# ───────────── Aprendizaje ─────────────
@app.get("/api/aprendizaje")
def apr_list():
    from noviq import aprendizaje as A
    return jsonify(A.listar())


@app.post("/api/aprendizaje")
def apr_set():
    from noviq import aprendizaje as A
    d = J()
    if "activo" in d:
        CONFIG["aprendizaje"] = bool(d["activo"])
        save_config()
    if d.get("borrar") is not None:
        A.borrar(d.get("borrar") or None)
    return jsonify({"ok": True})


@app.post("/api/apagar")
def apagar():
    """Cierra Noviq por completo (botón ⏻ o el icono de la bandeja)."""
    try:
        from noviq import evaluador as EV
        EV.flush()  # estadísticas y 🪙 tokens pendientes (os._exit no corre atexit)
    except Exception:
        pass
    try:
        AV.apagar()  # 🤖 el avatar se despide
    except Exception:
        pass
    threading.Timer(0.5, lambda: os._exit(0)).start()
    return jsonify({"ok": True})


def puerto_ocupado(port=PORT):
    import socket
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as s_:
        s_.settimeout(0.5)
        return s_.connect_ex(("127.0.0.1", port)) == 0


def main(abrir_navegador=True, bloquear=True, abrir_si_ocupado=True):
    """Arranca el servidor. Si Noviq ya estaba abierto, solo muestra su ventana/página."""
    url = f"http://127.0.0.1:{PORT}"
    if puerto_ocupado():
        if abrir_si_ocupado:
            try:
                import noviq_app
                if not (noviq_app.ventana_nativa(url) or noviq_app.ventana_app(url)):
                    webbrowser.open(url)
            except Exception:
                webbrowser.open(url)
        return None
    from noviq.config import DATA_DIR, VERSION
    try:
        (DATA_DIR / ".token").write_text(TOKEN, encoding="utf-8")  # para «noviq --stop» y la bandeja
    except OSError:
        pass
    print("=" * 64)
    print(f"  Noviq {VERSION} listo en:", url)
    print("  Proyectos en:            ", projects_root())
    print("  Datos en:                ", DATA_DIR)
    print("=" * 64)
    threading.Thread(target=MANAGER.reload, daemon=True).start()
    from noviq import evaluador as _EV
    threading.Thread(target=_EV.importar_registro, daemon=True).start()  # una sola vez: aprende del registro técnico
    from noviq import recursos as _R
    _R.iniciar()  # vigilante de memoria + limpieza de navegadores de prueba que quedaron abiertos
    from noviq import programador, verificador
    programador.iniciar(_run_scheduled)
    verificador.iniciar()
    try:
        from noviq import perfil_windows, telegram_bot
        threading.Thread(target=perfil_windows.perfil, daemon=True, name="perfil-windows").start()
        telegram_bot.iniciar()  # 📱 solo escucha si hay un bot configurado
    except Exception as e:
        print("[telegram/perfil]", e)
    try:
        AV.iniciar(PORT, TOKEN)  # 🤖 abre el avatar, lo conecta y lo vigila
    except Exception as e:
        print("[avatar]", e)
    if abrir_navegador:
        threading.Timer(1.2, lambda: webbrowser.open(url)).start()
    kw = dict(host="127.0.0.1", port=PORT, threaded=True, debug=False, use_reloader=False)
    if bloquear:
        app.run(**kw)
        return None
    th = threading.Thread(target=lambda: app.run(**kw), daemon=True)
    th.start()
    return url


if __name__ == "__main__":
    main("--no-browser" not in sys.argv)
