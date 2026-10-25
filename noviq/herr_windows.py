# -*- coding: utf-8 -*-
"""Herramientas de la IA para Windows, Office, correo, agenda, Telegram y los servidores MCP del catálogo (las registra
tools.py). Pensadas para gastar pocos tokens: primero texto (perfil de Windows, UI Automation, OCR, archivos), imágenes
solo si hace falta; las decenas de herramientas de cada MCP las usa un subagente (agente_mcp), no la IA principal."""
import re

from . import agenda as _AG
from . import correo as _CO
from . import oficina as _OF
from . import telegram_bot as _TG

MCP_SYSTEM = """Eres un agente que completa UNA tarea usando SOLO las herramientas del servidor MCP «{nombre}» ({desc}).
- Lee el esquema de cada herramienta y úsalo exactamente. Trabaja paso a paso y verifica los resultados.
- Carpetas reales del usuario: {carpetas}
- No borres, envíes, publiques ni pagues nada que la tarea no pida explícitamente (igual se le pide aprobación al usuario).
Al terminar responde SOLO con un RESUMEN en español: qué hiciste, datos exactos obtenidos y qué falló si algo falló."""


def t_agente_mcp(a, ctx):
    from . import subagente
    from .mcp import CATALOGO, MANAGER
    srv = (a.get("servidor") or "").strip()
    disponibles = MANAGER.conectados("agente")
    if srv not in disponibles:
        return (f"ERROR: el servidor «{srv}» no está conectado. Disponibles: {', '.join(disponibles) or 'ninguno'}. "
                "El usuario los activa en 🔌 MCP → Catálogo.")
    tools = MANAGER.server_tools(srv)
    info = CATALOGO.get(srv) or {"nombre": srv, "desc": ""}
    try:
        from .perfil_windows import carpetas_usuario
        carp = " · ".join(f"{k}: {v}" for k, v in carpetas_usuario().items())
    except Exception:
        carp = "(desconocidas)"
    with subagente.recurso("mcp_" + srv, ctx):
        res = subagente.run(ctx.conv, ctx, a.get("tarea") or "", tools, MCP_SYSTEM.format(nombre=info["nombre"], desc=info["desc"], carpetas=carp),
                            label=f"Agente {info['nombre']}", max_steps=30)
    if res is None:
        return "ERROR: ningún modelo disponible pudo usar ese servidor (se necesita un modelo con herramientas nativas)."
    return f"Resultado del agente {info['nombre']}:\n{res}"


def def_agente_mcp():
    """Definición dinámica: solo aparece si hay servidores del catálogo en modo «agente» conectados."""
    from .mcp import CATALOGO, MANAGER
    srvs = MANAGER.conectados("agente")
    if not srvs:
        return None
    lista = "; ".join(f"{s}: {(CATALOGO.get(s) or {}).get('desc', s)[:120]}" for s in srvs)
    return {"type": "function", "function": {
        "name": "agente_mcp",
        "description": f"Delega una tarea a un subagente que usa un servidor MCP conectado. Servidores: {lista}",
        "parameters": {"type": "object", "properties": {"servidor": {"type": "string", "enum": srvs},
                                                        "tarea": {"type": "string", "description": "Tarea completa y concreta"}},
                       "required": ["servidor", "tarea"]}}}


DEFS = [_OF.TOOL_DEF, _CO.TOOL_DEF, _AG.TOOL_DEF, _TG.TOOL_DEF]
FUNCS = {"oficina": _OF.tool, "correo": _CO.tool, "agenda": _AG.tool, "telegram": _TG.tool, "agente_mcp": t_agente_mcp}
LABELS = {"oficina": "📎 Oficina (Word/Excel/PDF/carpetas)", "correo": "✉ Correo", "agenda": "📅 Agenda", "telegram": "📱 Telegram",
          "agente_mcp": "🔌 Agente MCP"}
LECTURA = {("oficina", "word_leer"), ("oficina", "excel_leer"), ("oficina", "pdf_leer"), ("oficina", "buscar"), ("oficina", "recientes"),
           ("correo", "leer"), ("correo", "cuentas")}

RX_AGENDA = re.compile(r"(?i)\b(cada\s+(d[ií]a|lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo|semana|mes|ma[nñ]ana|noche|\d+\s*(min|hora))|"
                       r"todos los (d[ií]as|lunes|martes|mi[eé]rcoles|jueves|viernes)|todas las (ma[nñ]anas|tardes|noches)|"
                       r"los (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bados|domingos)|de lunes a viernes|entre semana|"
                       r"recu[eé]rdame|progr[aá]malo|progr[aá]mame|ag[eé]ndalo|a diario|diariamente|semanalmente)")


def necesita_permiso(name, args, mode):
    """Permisos «normales» (los sensibles los decide la guardia). None = no opina."""
    if name not in FUNCS:
        return None
    if name in ("agenda", "telegram", "agente_mcp"):
        return False
    if (name, (args.get("accion") or "").lower()) in LECTURA:
        return False
    return mode == "preguntar"


def prompt_extra(conv):
    """Sección corta del prompt (≈700 caracteres + perfil): rutas reales y cómo trabajar en Windows gastando pocos tokens."""
    from .config import IS_WINDOWS
    partes = []
    try:
        from .perfil_windows import resumen_prompt
        pr = resumen_prompt()
        if pr:
            partes.append("## Tu PC (perfil de Windows ya averiguado: úsalo, no lo busques)\n" + pr)
    except Exception:
        pass
    if IS_WINDOWS:
        partes.append(
            "## Windows, Office, correo y agenda (gasta pocos tokens)\n"
            "- Documentos: `oficina` (Word/Excel/PDF/buscar/ordenar) sin abrir programas. Correo: `correo`.\n"
            "- Escritorio: `agente_pc` para tareas largas; paso a paso `control_pc`: primero 'elementos' o 'leer_texto' (OCR, sin imagen), "
            "'clic_texto' para pulsar lo que ves escrito; 'captura' solo si el texto no alcanza.\n"
            "- Webs: `agente_navegador` (Gmail/Hotmail web con la sesión del usuario si está «Tu Chrome abierto»).\n"
            "- Enviar, borrar/sobrescribir, instalar y pagar SIEMPRE piden aprobación (Noviq + Telegram): no lo evites ni lo repitas si lo rechazan.\n"
            "- Si el usuario dice cuándo repetir algo («los lunes, miércoles y jueves…») usa `programar_tarea` con cuando='<sus palabras>'. "
            "Guarda lo importante con `agenda` accion='nota' (importante=true avisa por Telegram).")
    txt = ""
    for m in reversed(conv.get("messages") or []):
        if m.get("role") == "user":
            c = m.get("content")
            txt = c if isinstance(c, str) else " ".join(p.get("text", "") for p in c if isinstance(p, dict))
            break
    if txt and RX_AGENDA.search(txt) and "[Tarea programada" not in txt:
        partes.append("⏰ El último mensaje pide algo REPETIDO o para OTRO MOMENTO: créalo con `programar_tarea` (accion='crear', "
                      "cuando=<cómo lo dijo el usuario>, instruccion=<qué hacer, completo>) y confirma la próxima fecha (si además pide hacerlo ya, hazlo también).")
    return ("\n\n" + "\n\n".join(partes) + "\n") if partes else ""
