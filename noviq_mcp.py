# -*- coding: utf-8 -*-
"""🎛 Servidor MCP de CONTROL de Noviq: permite que una IA (Claude Desktop, Noviq mismo u otro cliente MCP) maneje el
programa completo mientras está abierto: ver qué está trabajando, mandar trabajos, continuarlos, detenerlos, ver el
estado y los errores, consultar el 🏆 ranking de IAs, calificar respuestas y ajustar el 🧭 director.

Uso (Noviq debe estar abierto; el servidor habla con él por http://127.0.0.1:7860 usando el token de datos/.token):
  Claude Desktop → claude_desktop_config.json:
    {"mcpServers": {"noviq": {"command": "python", "args": ["C:\\\\Users\\\\TU_USUARIO\\\\Proyectos_Programacion\\\\Noviq\\\\noviq_mcp.py"]}}}
  Noviq → 🔌 MCP → pega lo mismo (así una IA de Noviq puede supervisar otros chats y proyectos).
Transporte: stdio, JSON-RPC 2.0 (un mensaje por línea), protocolo MCP 2025-06-18. Solo usa la biblioteca estándar
y `requests` (que Noviq ya instala). Seguridad: solo habla con 127.0.0.1 y con el token local del programa."""
import json
import os
import sys
import time
from pathlib import Path

import requests

PROTO = "2025-06-18"
PORT = int(os.environ.get("NVIDIA_CHAT_PORT", "7860"))
BASE = f"http://127.0.0.1:{PORT}"


def _data_dir():
    if os.environ.get("NOVIQ_DATOS"):
        return Path(os.environ["NOVIQ_DATOS"]).expanduser()
    local = Path(__file__).resolve().parent / "datos"
    if local.exists():
        return local
    try:
        sys.path.insert(0, str(Path(__file__).resolve().parent))
        from noviq.config import user_data_dir
        return user_data_dir()
    except Exception:
        return local


def _token():
    f = _data_dir() / ".token"
    if not f.exists():
        raise RuntimeError("Noviq no está abierto (no encuentro datos/.token). Ábrelo y vuelve a intentar.")
    return f.read_text(encoding="utf-8").strip()


def _api(method, path, body=None, stream=False, timeout=30):
    try:
        r = requests.request(method, BASE + path, headers={"X-Token": _token(), "Content-Type": "application/json"},
                             data=json.dumps(body or {}) if body is not None else None, stream=stream, timeout=timeout)
    except requests.ConnectionError:
        raise RuntimeError(f"Noviq no responde en {BASE}: ¿está abierto?")
    if r.status_code == 403:
        raise RuntimeError("Noviq rechazó el token (¿se reinició? vuelve a intentar).")
    return r


def _json(method, path, body=None):
    r = _api(method, path, body)
    try:
        return r.json()
    except ValueError:
        return {"error": f"{r.status_code}: {r.text[:300]}"}


def _consume(r, max_seg):
    """Lee los eventos de un trabajo (SSE) y devuelve un resumen en texto."""
    t0, conv_id, texto, notas, herramientas, errores = time.time(), None, [], [], [], []
    ev = None
    try:
        for raw in r.iter_lines(decode_unicode=True):
            if raw is None:
                continue
            if raw.startswith("event:"):
                ev = raw[6:].strip()
            elif raw.startswith("data:") and ev:
                try:
                    p = json.loads(raw[5:].strip() or "{}")
                except ValueError:
                    p = {}
                if ev == "meta":
                    conv_id = p.get("conversation_id")
                elif ev == "token":
                    texto.append(p.get("text", ""))
                elif ev == "assistant_break":
                    texto.append("\n")
                elif ev == "reset_segment":
                    texto = []
                elif ev == "notice":
                    notas.append(p.get("text", ""))
                elif ev == "tool_start":
                    herramientas.append(p.get("label") or p.get("name"))
                elif ev == "error":
                    errores.append(p.get("text", ""))
                elif ev == "done":
                    break
                ev = None
            if time.time() - t0 > max_seg:
                notas.append(f"(dejé de esperar a los {max_seg} s: el trabajo SIGUE en Noviq; usa noviq_ver_conversacion)")
                break
    finally:
        r.close()
    out = [f"Conversación: {conv_id}"]
    if herramientas:
        out.append(f"Herramientas usadas ({len(herramientas)}): " + ", ".join(herramientas[-25:]))
    if notas:
        out.append("Avisos del programa:\n- " + "\n- ".join(n[:300] for n in notas[-15:]))
    if errores:
        out.append("ERRORES:\n- " + "\n- ".join(e[:500] for e in errores))
    final = "".join(texto).strip()
    if final:
        out.append("Respuesta de la IA:\n" + final[-6000:])
    return "\n\n".join(out)


# ───────────── Herramientas ─────────────
def t_estado(a):
    trab = _json("GET", "/api/trabajando")
    convs = _json("GET", "/api/conversations")
    lines = ["🟢 Trabajando ahora:" if trab else "Nada trabajando ahora."]
    for j in trab if isinstance(trab, list) else []:
        lines.append(f"- {j.get('id')} · {j.get('title')} · {j.get('model')} · proyecto {j.get('project') or '-'}"
                     + (" · ⏳ espera tu permiso" if j.get("espera_permiso") else ""))
    lines.append("\nÚltimas conversaciones:")
    for c in (convs if isinstance(convs, list) else [])[:int(a.get("limite") or 12)]:
        lines.append(f"- {c.get('id')} · {c.get('title')} · {c.get('project') or '-'}" + (" · trabajando" if c.get("running") else ""))
    return "\n".join(lines)


def t_ver(a):
    cid = a["conversation_id"]
    c = _json("GET", f"/api/conversations/{cid}")
    if c.get("error"):
        return str(c["error"])
    est = _json("GET", f"/api/conversations/{cid}/estado")
    disp = c.get("display") or []
    n = int(a.get("ultimos") or 15)
    lines = [f"«{c.get('title')}» · modelo {c.get('model')} · {'TRABAJANDO' if c.get('running') else 'detenida'}"
             + (" · quedó a medias" if c.get("en_progreso") and not c.get("running") else "")]
    for t in c.get("tasks") or []:
        lines.append(f"  [{t.get('estado')}] {t.get('contenido')}")
    lines.append("\nÚltimos eventos:")
    for d in disp[-n:]:
        ty = d.get("type")
        if ty in ("assistant", "user"):
            lines.append(f"{'🧑' if ty == 'user' else '🤖'} {str(d.get('text') or '')[:800]}")
        elif ty == "tool":
            lines.append(f"🛠 {d.get('label')}")
        elif ty == "tool_result":
            lines.append(f"   → {str(d.get('result') or '')[:300]}")
        elif ty in ("notice", "error"):
            lines.append(f"{'ℹ' if ty == 'notice' else '❌'} {str(d.get('text') or '')[:400]}")
    lines.append("\n" + str(est.get("text", ""))[:5000])
    return "\n".join(lines)


def t_enviar(a):
    body = {"text": a["texto"], "conversation_id": a.get("conversation_id") or None, "project": a.get("proyecto") or None,
            "model": a.get("modelo") or None, "permiso": a.get("permiso") or None, "origen": a.get("origen") or None,
            "titulo": a.get("titulo") or None, "images": a.get("imagenes") or None,
            "sin_enrutar": True if a.get("sin_enrutar") else None}
    r = _api("POST", "/api/chat", {k: v for k, v in body.items() if v is not None}, stream=True, timeout=(10, 600))
    if r.status_code == 202:   # 📥 esa conversación estaba trabajando: el pedido quedó en su bandeja y se integra solo
        try:
            j = r.json()
        finally:
            r.close()
        return (f"Conversación: {j.get('conversation_id')}\n📥 La conversación estaba trabajando: el pedido quedó en su bandeja "
                f"y se integra en el siguiente paso ({j.get('pendientes', 1)} en cola). Sigue su avance con noviq_ver_conversacion.")
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:300]}"
    return _consume(r, int(a.get("max_segundos") or 300) if a.get("esperar", True) else 3)


def t_continuar(a):
    r = _api("POST", "/api/chat", {"conversation_id": a["conversation_id"], "continuar": True, "text": ""},
             stream=True, timeout=(10, 600))
    if r.status_code != 200:
        return f"ERROR {r.status_code}: {r.text[:300]}"
    return _consume(r, int(a.get("max_segundos") or 300) if a.get("esperar", True) else 3)


def t_agregar(a):
    """📥 Agrega un pedido a una conversación SIN detenerla (se integra en su siguiente paso)."""
    r = _api("POST", f"/api/conversations/{a['conversation_id']}/bandeja",
             {"text": a["texto"], "origen": a.get("origen") or "mcp"}, timeout=(10, 30))
    try:
        j = r.json()
    except ValueError:
        j = {}
    finally:
        r.close()
    if r.status_code == 202:
        return f"📥 Agregado a la conversación {a['conversation_id']} (está trabajando): se integra en el siguiente paso ({j.get('pendientes', 1)} en cola)."
    if r.status_code == 200 and j.get("iniciado"):
        return f"▶ La conversación {a['conversation_id']} ya había terminado: empezó un turno nuevo con el pedido."
    return f"ERROR {r.status_code}: {(j.get('error') if j else '') or r.text[:300]}"


def t_enrutar(a):
    """🧭 Solo consulta a qué conversación/proyecto iría un pedido (no ejecuta nada)."""
    j = _json("POST", "/api/enrutar", {"text": a["texto"], "conversation_id": a.get("conversation_id") or None,
                                       "project": a.get("proyecto") or None, "modo": "auto"})
    return json.dumps(j, ensure_ascii=False, indent=1)


def t_detener(a):
    _json("POST", "/api/stop", {"conversation_id": a["conversation_id"]})
    return "Pedí a Noviq que detenga ese trabajo (lo hecho queda guardado)."


def t_ranking(a):
    d = _json("GET", "/api/evaluador")
    tipos = [a["tipo"]] if a.get("tipo") in (d.get("tipos") or {}) else list((d.get("tipos") or {}).keys())
    out = []
    for t in tipos:
        out.append(f"## {d['tipos'][t]}")
        for i, x in enumerate((d.get("ranking") or {}).get(t, [])[:int(a.get("n") or 6)]):
            extra = " · EN ENFRIAMIENTO" if x.get("enfriando") else ""
            if x.get("degradada"):
                extra += " · DEGRADADA: " + x["degradada"][:100]
            if x.get("sin_cuota"):
                extra += " · SIN CUOTA"
            if x.get("tokens"):
                extra += " · " + x["tokens"]
            if x.get("up"):
                extra += " · 👍" + str(x["up"])
            if x.get("down"):
                extra += " · 👎" + str(x["down"])
            out.append(f"{i + 1}. {x['modelo']} — {x['puntaje']:.0f}/100 (catálogo {x.get('catalogo')}, "
                       f"{x.get('datos_tipo', 0)} datos){extra}")
    tk = (d.get("tokens") or {}).get("proveedores") or {}
    if tk:
        out.append("\n## 🪙 Tokens por proveedor (hoy / mes)")
        out += [f"- {p}: {e.get('hoy', 0):,} / {e.get('mes', 0):,}" + (" · AGOTADO" if e.get("agotado") else "") for p, e in tk.items()]
    ev = d.get("eventos") or []
    if ev and a.get("eventos", True):
        out.append("\n## Últimos eventos")
        out += [f"- {e['modelo']}: {e['evento']} ({e['tipo']}) {e.get('detalle', '')[:120]}" for e in ev[:15]]
    return "\n".join(out)


def t_calificar(a):
    r = _json("POST", "/api/calificar", {"conversation_id": a["conversation_id"], "valor": 1 if a.get("valor", 1) > 0 else -1})
    return "Calificación anotada para: " + ", ".join(r.get("modelos") or []) if r.get("ok") else f"ERROR: {r.get('error')}"


def t_ajustes(a):
    body = {}
    if any(k in a for k in ("director_activo", "max_continuaciones")):
        body["director"] = {k2: a[k] for k, k2 in (("director_activo", "activo"), ("max_continuaciones", "max_continuaciones")) if k in a}
    if any(k in a for k in ("evaluador_activo", "elegir_al_inicio")):
        body["config"] = {k2: a[k] for k, k2 in (("evaluador_activo", "activo"), ("elegir_al_inicio", "elegir_al_inicio")) if k in a}
    if a.get("modelo_principal"):
        _json("POST", "/api/config", {"model": a["modelo_principal"]})
    if body:
        _json("POST", "/api/evaluador", body)
    return "Ajustes aplicados." if body or a.get("modelo_principal") else "No indicaste ningún ajuste."


def t_avatar(a):
    """🤖 El avatar flotante de Noviq: hablarle al usuario, mostrar un aviso, abrirlo/cerrarlo, escuchar o mandarle un comando."""
    acc = (a.get("accion") or "estado").lower()
    body = {}
    if acc in ("decir", "aviso"):
        if not a.get("texto"):
            return "ERROR: falta «texto»."
        body = {"decir": a["texto"], "tipo": a.get("tipo") or ("info" if acc == "decir" else "atencion")}
    elif acc == "abrir":
        body = {"abrir": True}
    elif acc == "cerrar":
        body = {"cerrar": True}
    elif acc == "escuchar":
        body = {"escuchar": True}
    elif acc == "probar":
        body = {"probar": True}
    elif acc == "comando":
        if not a.get("comando"):
            return "ERROR: falta «comando» (JSON del avatar, p. ej. {\"cmd\":\"celebrar\"})."
        cmd = a["comando"]
        if isinstance(cmd, str):
            try:
                cmd = json.loads(cmd)
            except ValueError:
                pass
        body = {"comando": cmd}
    elif acc == "configurar":
        # los ajustes son del avatar: se cambian con su comando «configurar»; en Noviq solo queda si se abre con Noviq
        cmd = {"cmd": "configurar"}
        if "voz" in a:
            cmd["voz"] = {"activada": bool(a["voz"])}
        if "sonidos" in a or "volumen" in a:
            cmd["sonidos"] = {k: v for k, v in (("activados", a.get("sonidos")), ("volumen", a.get("volumen"))) if v is not None}
        if a.get("escuchar") or a.get("motor_voz"):
            cmd["oido"] = {k: v for k, v in (("modo", a.get("escuchar")), ("motor", a.get("motor_voz"))) if v}
        body = {"comando": cmd} if len(cmd) > 1 else {}
        if "activo" in a:
            body["config"] = {"activo": bool(a["activo"])}
    e = _json("POST" if body else "GET", "/api/avatar", body or None)
    if e.get("error") and "vivo" not in e:
        return f"ERROR: {e['error']}"
    v = e.get("voz_noviq") or {}
    motores = ", ".join(f"{m['id']}{'' if m.get('listo') else ' (no)'}" for m in v.get("motores") or [])
    out = [f"Avatar «{e.get('nombre') or 'Noviq'}»: {'abierto' if e.get('vivo') else 'cerrado'} · {'conectado con Noviq' if e.get('conectado') else 'sin conexión'}"
           + (f" · reparando: {e.get('reparacion')}" if e.get("reparando") else "") + (f" · error: {e['error']}" if e.get("error") else ""),
           f"Se abre con Noviq: {'sí' if e.get('activo') else 'no'} · sus ajustes: {e.get('ajustes_url')} · oído de Noviq disponible: {motores or '—'}",
           f"Trabajos que vigila: {e.get('trabajos', 0)}" + (f" · pregunta abierta: {e['pregunta']}" if e.get("pregunta") else "")]
    if e.get("avatar"):
        out.append("Respuesta del avatar: " + json.dumps(e["avatar"], ensure_ascii=False)[:500])
    return "\n".join(out)


def t_charlar(a):
    """🧠 Conversa con la mente del avatar (su memoria, personalidad, IA y herramientas): charla, planes o trabajo para Noviq."""
    r = _json("POST", "/api/avatar/charla", {"texto": a.get("texto") or "", "hablar": bool(a.get("hablar"))})
    if r.get("error") and not r.get("respuesta"):
        return f"ERROR: {r['error']}"
    out = [r.get("respuesta") or "(sin respuesta)"]
    if r.get("accion") and r["accion"] != "charla":
        out.append(f"[acción: {r['accion']}" + (f" · tarea para Noviq: {r['tarea']}" if r.get("tarea") else "")
                   + (f" · plan: {r['plan']}" if r.get("plan") else "") + "]")
    return "\n".join(out)


def t_salud(a):
    h = _json("GET", "/api/salud")
    lines = ["Modelos/proveedores NO operativos ahora (Noviq los salta y los reintenta solo):"]
    for k, e in list((h.get("proveedores") or {}).items()) + list((h.get("modelos") or {}).items()):
        lines.append(f"- {k}: {e.get('kind')} — {e.get('motivo', '')[:160]}")
    return "\n".join(lines) if len(lines) > 1 else "Todos los modelos conocidos están operativos."


def t_banco(a):
    """🧪 Banco de pruebas: preguntas y respuestas reales a las IAs de Noviq (con las claves guardadas en su bóveda)."""
    import time as _t
    mods = a.get("modelos") or []
    r = _json("POST", "/api/banco", {"modelos": mods})
    if not r.get("ok"):
        return f"ERROR: {r.get('error')}"
    fin = _t.time() + int(a.get("max_segundos") or 600)
    e = {}
    while _t.time() < fin:
        e = _json("GET", "/api/banco")
        if not e.get("activo"):
            break
        _t.sleep(3)
    if e.get("activo"):
        return f"Sigue probando ({e.get('hechos')}/{e.get('total')}): vuelve a consultar con noviq_banco_resultado."
    return _banco_texto(e)


def _banco_texto(e):
    out = ["| Modelo | Aciertos | Herramientas | Vacías | Errores | 1.ª letra (s) | Prom. (s) | Nota |", "|---|---|---|---|---|---|---|---|"]
    for r in sorted(e.get("resultados") or [], key=lambda x: x.get("nota", 0), reverse=True):
        out.append(f"| {r['modelo']} | {r['aciertos']}/{r['total']} | {'sí' if r.get('herramientas') else 'no'} | {r['vacias']} | "
                   f"{r['errores']} | {r.get('seg_primero')} | {r.get('seg_prom')} | {r.get('nota')} |")
        for p_ in r.get("pruebas") or []:
            out.append(f"  - {'OK' if p_['ok'] else 'VACÍA' if p_.get('vacia') else 'FALLA'} {p_['nombre']}: {p_.get('detalle', '')}"
                       + (f" ({p_['ms'] / 1000:.1f} s)" if p_.get("ms") else "") + (f" — {p_['error']}" if p_.get("error") else ""))
    if e.get("informe"):
        out.append(f"\nInforme: {e['informe']}")
    return "\n".join(out)


S = lambda d: {"type": "string", "description": d}
TOOLS = [
    ("noviq_banco", "🧪 Banco de pruebas de Noviq: hace 5 preguntas reales (obedecer, cálculo, código que se ejecuta, usar una herramienta, explicar) a cada IA con las claves guardadas y mide aciertos, tiempos y respuestas vacías. Actualiza el ranking.",
     {"modelos": {"type": "array", "items": {"type": "string"}, "description": "proveedor::modelo (vacío = el elegido + el respaldo)"},
      "max_segundos": {"type": "integer", "description": "máximo a esperar (def. 600)"}}, [], t_banco),
    ("noviq_banco_resultado", "Resultado del último banco de pruebas.", {}, [], lambda a: _banco_texto(_json("GET", "/api/banco"))),
    ("noviq_estado", "Qué está trabajando Noviq ahora y sus últimas conversaciones (con sus ids).", {"limite": {"type": "integer"}}, [], t_estado),
    ("noviq_ver_conversacion", "Detalle de una conversación: tareas, últimos mensajes, herramientas, avisos, errores y el ESTADO DEL TRABAJO.",
     {"conversation_id": S("id de la conversación"), "ultimos": {"type": "integer", "description": "cuántos eventos (def. 15)"}}, ["conversation_id"], t_ver),
    ("noviq_enviar", "Manda un pedido a Noviq (nueva conversación o una existente) y devuelve el resultado. El trabajo corre dentro de Noviq con sus agentes, el evaluador y el director.",
     {"texto": S("Qué debe hacer Noviq"), "conversation_id": S("Conversación existente (opcional)"), "proyecto": S("Proyecto (opcional, para una conversación nueva)"),
      "modelo": S("proveedor::modelo (opcional)"), "esperar": {"type": "boolean", "description": "esperar el resultado (def. sí)"},
      "permiso": {"type": "string", "enum": ["preguntar", "auto_seguro", "auto"], "description": "modo de permisos de ESA conversación (lo sensible siempre se pregunta)"},
      "max_segundos": {"type": "integer", "description": "máximo a esperar (def. 300); el trabajo sigue aunque se deje de esperar"}}, ["texto"], t_enviar),
    ("noviq_continuar", "Continúa un trabajo que quedó a medias, exactamente donde quedó.",
     {"conversation_id": S("id"), "esperar": {"type": "boolean"}, "max_segundos": {"type": "integer"}}, ["conversation_id"], t_continuar),
    ("noviq_agregar", "Agrega un pedido a una conversación que está trabajando SIN detenerla: los agentes lo integran a su plan en el siguiente paso. Si ya terminó, empieza un turno nuevo con el pedido.",
     {"conversation_id": S("id de la conversación"), "texto": S("Lo que hay que agregar o cambiar")}, ["conversation_id", "texto"], t_agregar),
    ("noviq_enrutar", "Consulta (sin ejecutar) a qué conversación o proyecto iría un pedido: misma, continuar otra, en caliente o nueva.",
     {"texto": S("El pedido"), "conversation_id": S("Conversación actual (opcional)"), "proyecto": S("Proyecto actual (opcional)")}, ["texto"], t_enrutar),
    ("noviq_detener", "Detiene el trabajo en curso de una conversación.", {"conversation_id": S("id")}, ["conversation_id"], t_detener),
    ("noviq_ranking", "Ranking de IAs del evaluador de Noviq por tipo de tarea (crear, arreglar, web, analizar, general) y últimos eventos (fallos, bucles, 👍/👎…).",
     {"tipo": S("crear | arreglar | web | analizar | general (vacío = todos)"), "n": {"type": "integer"}, "eventos": {"type": "boolean"}}, [], t_ranking),
    ("noviq_salud", "Modelos o proveedores que no están operativos ahora (sin clave, sin crédito, 404, límite…).", {}, [], t_salud),
    ("noviq_calificar", "Califica la última respuesta de una conversación (👍 = 1, 👎 = -1). El evaluador lo usa para elegir la mejor IA.",
     {"conversation_id": S("id"), "valor": {"type": "integer", "enum": [1, -1]}}, ["conversation_id", "valor"], t_calificar),
    ("noviq_avatar", "🤖 Avatar flotante de Noviq (robot en el escritorio con voz, sonidos y micrófono): estado, decir/aviso al usuario "
     "(tipo: info, exito, error, atencion, pregunta), abrir, cerrar, escuchar (una frase ahora), probar, configurar sus ajustes "
     "(activo = abrirlo con Noviq, voz, sonidos, volumen, escuchar: apagado|palabra|siempre|pulsar, motor_voz) o un comando crudo de su API.",
     {"accion": {"type": "string", "enum": ["estado", "decir", "aviso", "abrir", "cerrar", "escuchar", "probar", "configurar", "comando"]},
      "texto": S("decir/aviso: frase corta"), "tipo": S("aviso: info | exito | error | atencion | pregunta"),
      "comando": {"type": "object", "description": "comando: JSON del avatar, p. ej. {\"cmd\":\"celebrar\"}"},
      "activo": {"type": "boolean"}, "voz": {"type": "boolean"}, "sonidos": {"type": "boolean"}, "volumen": {"type": "number"},
      "escuchar": {"type": "string", "enum": ["apagado", "palabra", "siempre", "pulsar"]}, "motor_voz": S("motor del oído del avatar: auto | groq | nvidia | openai | noviq")},
     ["accion"], t_avatar),
    ("noviq_charlar", "🧠 Conversa con el avatar (asistente independiente: recuerda al usuario, tiene personalidad, sus propias "
     "herramientas e IA rápida). Si le das una orden directa la pasa a Noviq; si es una idea, la guarda como plan.",
     {"texto": S("lo que le dices"), "hablar": {"type": "boolean", "description": "que el robot lo diga en voz alta (def. no)"}},
     ["texto"], t_charlar),
    ("noviq_ajustes", "Cambia ajustes del programa: director (continuar solo los trabajos a medias), evaluador y modelo principal.",
     {"director_activo": {"type": "boolean"}, "max_continuaciones": {"type": "integer"}, "evaluador_activo": {"type": "boolean"},
      "elegir_al_inicio": {"type": "string", "enum": ["si_falla", "siempre", "nunca"]}, "modelo_principal": S("proveedor::modelo")}, [], t_ajustes),
]
FUNCS = {n: f for n, _, _, _, f in TOOLS}


def tool_list():
    return [{"name": n, "description": d, "inputSchema": {"type": "object", "properties": p, "required": r}} for n, d, p, r, _ in TOOLS]


def handle(msg):
    mid, method, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if method == "initialize":
        return {"protocolVersion": params.get("protocolVersion") or PROTO, "capabilities": {"tools": {}},
                "serverInfo": {"name": "noviq-control", "version": "1.0"},
                "instructions": "Controla el programa Noviq (agente de IA de escritorio). Empieza con noviq_estado."}
    if method == "ping":
        return {}
    if method == "tools/list":
        return {"tools": tool_list()}
    if method == "tools/call":
        name, args = params.get("name"), params.get("arguments") or {}
        if name not in FUNCS:
            return {"content": [{"type": "text", "text": f"Herramienta desconocida: {name}"}], "isError": True}
        try:
            return {"content": [{"type": "text", "text": FUNCS[name](args)}]}
        except Exception as e:
            return {"content": [{"type": "text", "text": f"ERROR: {e}"}], "isError": True}
    if mid is None:
        return None  # notificación
    raise LookupError(method)


def main():
    out = sys.stdout.buffer
    for raw in sys.stdin.buffer:
        try:
            msg = json.loads(raw.decode("utf-8"))
        except Exception:
            continue
        try:
            res = handle(msg)
            if msg.get("id") is None:
                continue
            reply = {"jsonrpc": "2.0", "id": msg["id"], "result": res}
        except LookupError as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32601, "message": f"Método no soportado: {e}"}}
        except Exception as e:
            reply = {"jsonrpc": "2.0", "id": msg.get("id"), "error": {"code": -32603, "message": str(e)}}
        out.write((json.dumps(reply, ensure_ascii=False) + "\n").encode("utf-8"))
        out.flush()


if __name__ == "__main__":
    main()
