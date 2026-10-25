# -*- coding: utf-8 -*-
"""🛡 Guardia de acciones sensibles: lo que el usuario pidió aprobar SIEMPRE (aunque esté en ⚡ Todo automático, en una tarea
programada o lo haga un subagente del navegador / del PC / de un MCP):

  ✉ enviar     correos, mensajes y formularios (correo, Gmail MCP, clic en «Enviar/Send/Publicar»…)
  🗑 eliminar   borrar archivos o carpetas, vaciar, sobrescribir documentos del usuario
  📦 instalar   instalar programas (winget, msiexec, instaladores) y comandos de riesgo (formatear, registro, apagar…)
  💳 pagos      pagar, comprar, transferir, escribir números de tarjeta

La petición aparece en Noviq y, si Telegram está vinculado, en tu Telegram con botones ✅ Aprobar / ❌ Rechazar. Lo que
llegue primero decide. Sin respuesta en N minutos (⚙ Ajustes → 📱 Telegram y correo) se cancela. Todo lo demás se aprueba
solo (según el modo de permisos). Cada decisión queda anotada en la agenda (notas)."""
import json
import re
import threading
import time
import uuid

from .config import CONFIG

CATEGORIAS = {"enviar": "✉ Enviar", "eliminar": "🗑 Eliminar o sobrescribir", "instalar": "📦 Instalar / comando de riesgo",
              "pagos": "💳 Pago o compra"}

RX_ENVIAR = re.compile(r"(?i)\b(enviar|env[ií]a|send|submit|publicar|publish|post(ear)?|responder a todos|reply all|compartir|share|"
                       r"tuitear|tweet|mandar)\b")
RX_PAGAR = re.compile(r"(?i)\b(pagar|pago|comprar|compra ahora|buy|purchase|checkout|pay|place order|realizar pedido|confirmar pedido|"
                      r"confirmar compra|finalizar compra|transferir|transferencia|suscribirme|subscribe|donar|donate)\b")
RX_BORRAR = re.compile(r"(?i)\b(eliminar|borrar|delete|remove|vaciar|empty|papelera|trash|descartar|discard|desinstalar|uninstall)\b")
RX_TARJETA = re.compile(r"\b(?:\d[ -]?){13,19}\b")
RX_CMD_BORRAR = re.compile(r"(?i)(\bremove-item\b|\bdel\b\s|\berase\b|\brd\b\s+/s|\brmdir\b|\brm\s+-[rf]|clear-recyclebin|"
                           r"shutil\.rmtree|os\.remove|os\.unlink|\.unlink\(|send2trash|format-volume|\bformat\s+[a-z]:|diskpart|"
                           r"remove-appxpackage|uninstall-package|\breg\s+delete|remove-itemproperty)")
RX_CMD_INSTALAR = re.compile(r"(?i)(winget\s+(install|upgrade|uninstall)|choco\s+install|scoop\s+install|msiexec|"
                             r"add-appxpackage|install-module|install-package|npm\s+(install|i)\s+(-g|--global)|"
                             r"setup\.exe|installer\.exe|\.msi\b|start-process[^\n]*\.(exe|msi)[^\n]*(/s\b|/silent|/quiet|/verysilent)|"
                             r"set-executionpolicy|stop-computer|restart-computer|shutdown\s+/[sr]|bcdedit|"
                             r"set-itemproperty\s+['\"]?hk(lm|cu)|new-itemproperty\s+['\"]?hklm|reg\s+add|netsh\s+advfirewall|"
                             r"set-mppreference|disable-computerrestore)")
MCP_ENVIAR = re.compile(r"(?i)(send|reply|forward|draft_send|post_message|publish|tweet)")
MCP_BORRAR = re.compile(r"(?i)(delete|remove|trash|purge|destroy|drop|uninstall|move_to_trash)")
MCP_PAGAR = re.compile(r"(?i)(pay|purchase|checkout|charge|transfer|order)")


def _cfg():
    g = CONFIG.get("guardia")
    return g if isinstance(g, dict) else {}


def activa(cat):
    g = _cfg()
    return g.get("activo", True) and g.get(cat, True)


def _corto(v, n=700):
    v = v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)
    return v if len(v) <= n else v[:n] + "…"


def _es_de_usuario(ruta, ctx):
    """¿La ruta es un documento del usuario (fuera de la carpeta de proyectos de Noviq)?"""
    try:
        from .tools import inside_root
        p = ctx.resolve(ruta)
        return p.exists() and not inside_root(p)
    except Exception:
        return False


def clasificar(name, args, ctx=None):
    """{"cat", "titulo", "detalle"} si la acción necesita la aprobación del usuario; si no, None."""
    args = args if isinstance(args, dict) else {}
    base = name.split("__")[-1] if name.startswith("mcp__") else name
    txt_args = json.dumps(args, ensure_ascii=False)
    acc = str(args.get("accion") or "").lower()

    def res(cat, titulo, detalle=""):
        return {"cat": cat, "titulo": titulo, "detalle": detalle} if activa(cat) else None

    # ── correo / mensajes ──
    if name == "correo" and acc == "enviar":
        adj = args.get("adjuntos") or []
        return res("enviar", f"Enviar correo a {args.get('para')}",
                   f"Para: {args.get('para')}" + (f"\nCC: {args['cc']}" if args.get("cc") else "") + f"\nAsunto: {args.get('asunto')}\n\n"
                   + _corto(args.get("cuerpo") or "", 900) + (f"\n\n📎 {', '.join(map(str, adj))}" if adj else ""))
    if name == "telegram" and acc == "enviar_a":
        return res("enviar", f"Enviar mensaje de Telegram a {args.get('destino')}", _corto(args.get("texto") or ""))
    # ── borrar / sobrescribir ──
    if name == "eliminar":
        return res("eliminar", f"Eliminar {args.get('ruta')}", "Se envía a la Papelera de reciclaje.")
    if name == "oficina" and acc in ("word_reemplazar", "excel_escribir", "word_crear") and ctx is not None:
        if _es_de_usuario(args.get("ruta") or "", ctx) or (acc == "word_reemplazar"):
            from .oficina import _ruta
            p = _ruta(ctx, args.get("ruta"))
            if p.exists():
                return res("eliminar", f"Modificar el documento {p.name}", f"{p}\n(se guarda una copia de respaldo antes)\n"
                           + _corto({k: v for k, v in args.items() if k not in ("accion", "ruta")}, 500))
    if name in ("escribir_archivo", "editar_archivo") and ctx is not None and _es_de_usuario(args.get("ruta") or "", ctx):
        return res("eliminar", f"Sobrescribir {args.get('ruta')}", "Es un archivo tuyo fuera de los proyectos de Noviq (queda respaldo).")
    # ── comandos ──
    if name in ("ejecutar_powershell", "ejecutar_python", "ejecutar_linux"):
        cmd = str(args.get("comando") or args.get("codigo") or "")
        if RX_CMD_INSTALAR.search(cmd):
            return res("instalar", "Instalar o cambiar el sistema", _corto(cmd, 900))
        if RX_CMD_BORRAR.search(cmd):
            return res("eliminar", "Comando que borra archivos", _corto(cmd, 900))
    if name in ("instalar_herramienta",):
        return res("instalar", f"Instalar {args.get('nombre') or args.get('herramienta') or ''}".strip(), _corto(args, 500))
    # ── navegador / escritorio (texto del botón o de lo que se escribe) ──
    if name == "control_pc" or base.startswith("browser_") or name.startswith("mcp__"):
        destino = ""
        if name == "control_pc":
            if acc in ("clic", "doble_clic", "clic_texto"):
                ref = (args.get("ref") or "").strip("[]")
                if ref and ctx is not None:
                    destino = ((ctx.conv.get("_pc_refs") or {}).get(ref) or {}).get("nombre", "")
                destino = destino or args.get("texto_objetivo") or (args.get("texto") if acc == "clic_texto" else "") or ""
            elif acc == "escribir" and RX_TARJETA.search(str(args.get("texto") or "")):
                return res("pagos", "Escribir un número de tarjeta", "La IA quiere escribir un número que parece de tarjeta.")
        else:
            destino = " ".join(str(args.get(k) or "") for k in ("element", "text", "name", "label", "description", "selector"))
            if RX_TARJETA.search(str(args.get("text") or args.get("value") or "")) or \
                    any(RX_TARJETA.search(str(f.get("value") or "")) for f in (args.get("fields") or []) if isinstance(f, dict)):
                return res("pagos", "Escribir datos de tarjeta en una página", _corto(args, 400))
        es_clic = name == "control_pc" or re.search(r"(?i)click|tap|press|submit", base)
        if destino and es_clic:
            if RX_PAGAR.search(destino):
                return res("pagos", f"Pulsar «{destino.strip()[:60]}»", "Parece un pago o una compra.")
            if RX_ENVIAR.search(destino):
                return res("enviar", f"Pulsar «{destino.strip()[:60]}»", "Parece que envía o publica algo.")
            if RX_BORRAR.search(destino):
                return res("eliminar", f"Pulsar «{destino.strip()[:60]}»", "Parece que borra algo.")
        if name.startswith("mcp__") and not base.startswith("browser_"):
            if MCP_PAGAR.search(base):
                return res("pagos", f"{base} (MCP)", _corto(args, 600))
            if MCP_ENVIAR.search(base):
                return res("enviar", f"{base} (MCP)", _corto(args, 900))
            if MCP_BORRAR.search(base):
                return res("eliminar", f"{base} (MCP)", _corto(args, 600))
            if base.lower() in ("powershell", "shell", "execute_command", "run_command", "start_process") or "command" in base.lower():
                cmd = " ".join(str(v) for v in args.values())
                if RX_CMD_INSTALAR.search(cmd):
                    return res("instalar", f"{base}: instalar o cambiar el sistema", _corto(cmd, 800))
                if RX_CMD_BORRAR.search(cmd):
                    return res("eliminar", f"{base}: comando que borra", _corto(cmd, 800))
    if name == "agente_mcp" and re.search(r"(?i)\b(env[ií]a|enviar|send|borra|elimina|delete|paga|compra)\b", str(args.get("tarea") or "")):
        return None  # la tarea se revisa dentro del subagente, acción por acción
    del txt_args
    return None


def etiqueta_de(args, texto):
    """Texto del elemento que se va a pulsar, buscado en el último snapshot (Playwright «[ref=e12]», Chrome DevTools «uid=1_5»,
    control_pc «[e3] Button «Enviar»»). Así la guardia sabe si el botón dice «Enviar», «Pagar» o «Eliminar»."""
    if not texto or not isinstance(args, dict):
        return ""
    for k in ("ref", "uid", "element_ref", "target", "elementRef"):
        v = str(args.get(k) or "").strip()
        if not v:
            continue
        for ln in texto.splitlines():
            if f"ref={v}]" in ln or f"ref={v} " in ln or f"uid={v} " in ln or ln.rstrip().endswith(f"uid={v}") or f"[{v}]" in ln:
                return ln.strip()[:160]
    return ""


# ───────────── Pedir la aprobación (Noviq + Telegram) ─────────────
HISTORIAL = []  # últimas decisiones (para la agenda y /estado de Telegram)
_lock = threading.Lock()


def aprobar(ctx, name, args, info, stop_ev=None):
    """Bloquea hasta que el usuario decide (en Noviq o en Telegram). Devuelve True si aprobó."""
    from .agent import PENDING
    pid = uuid.uuid4().hex
    ev = threading.Event()
    PENDING[pid] = {"event": ev, "ok": False, "always": False, "guardia": True}
    cat = info["cat"]
    label = f"{CATEGORIAS.get(cat, '⚠')}: {info['titulo']}"
    conv = getattr(ctx, "conv", {}) or {}
    try:
        ctx.emit("confirm", {"id": pid, "name": name, "label": label, "args": {"explicacion": info.get("detalle") or info["titulo"]},
                             "riesgo": "alto", "fuente_riesgo": "guardia", "guardia": cat})
    except Exception:
        pass
    enviado_tg = False
    try:
        from . import telegram_bot as TG
        enviado_tg = TG.pedir_aprobacion(pid, label, info.get("detalle") or "", conv.get("title") or "", conv.get("id"))
    except Exception:
        pass
    espera = max(1, int(_cfg().get("espera_min") or 30)) * 60
    t0 = time.time()
    stop_ev = stop_ev or getattr(ctx, "stop_ev", None)
    while not ev.wait(0.5):
        if (stop_ev is not None and stop_ev.is_set()) or time.time() - t0 > espera:
            break
    ans = PENDING.pop(pid, {})
    ok = bool(ans.get("ok"))
    via = ans.get("via") or ("Noviq" if ans else ("tiempo agotado" if time.time() - t0 > espera else "detenido"))
    with _lock:
        HISTORIAL.append({"t": time.time(), "cat": cat, "titulo": info["titulo"], "ok": ok, "via": via, "conv": conv.get("id")})
        del HISTORIAL[:-50]
    try:
        from . import agenda
        agenda.nota(f"{'✅ Aprobado' if ok else '❌ Rechazado'} ({via}): {label}", tipo="aprobacion", conv=conv.get("id"))
    except Exception:
        pass
    if enviado_tg:
        try:
            from . import telegram_bot as TG
            TG.cerrar_aprobacion(pid, ok, via)
        except Exception:
            pass
    return ok


def revisar(ctx, name, args, stop_ev=None):
    """Atajo para subagentes: None si puede seguir; si no, el texto de rechazo para la IA."""
    info = clasificar(name, args, ctx)
    if not info:
        return None
    if aprobar(ctx, name, args, info, stop_ev):
        return None
    return (f"El usuario RECHAZÓ (o no respondió a tiempo) esta acción: {info['titulo']}. No la repitas; termina con un "
            "resumen de lo que falta o propón otra alternativa.")
