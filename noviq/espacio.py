# -*- coding: utf-8 -*-
"""🗂 Espacio de trabajo de cada pedido: carpeta propia, proyecto propio y archivos base preparados.

Problemas que resuelve (casos reales):
1. Todas las conversaciones sin proyecto compartían la carpeta _General: allí se acumulaban config.json, .env y
   scripts de pedidos viejos, y cada conversación NUEVA recibía ese árbol de archivos, su ESTADO.md y su memoria,
   así que la IA leía todo lo anterior antes de hacer lo nuevo (lento y con errores: mezclaba trabajos).
   → Cada conversación nueva sin proyecto trabaja en su PROPIA carpeta (_General/conversaciones/<fecha>_<tema>_<id>).
     Las conversaciones antiguas siguen en _General para no perder sus archivos.
2. Un programa nuevo («crea una página de recetas») se construía en _General junto a todo lo demás.
   → Si el pedido es construir algo nuevo y no hay proyecto, se crea su proyecto propio ANTES de empezar.
3. La IA perdía tiempo creando carpetas y archivos vacíos del plan.
   → Un agente preparador (sin IA) crea las carpetas, PLAN.md, README.md y los archivos base que el arquitecto definió
     (con contenido mínimo válido), para que la IA solo los complete con editar_archivo/escribir_archivo.

Así trabajan los agentes grandes: una carpeta por trabajo (Claude Code, DeepSeek Harness: espacio de trabajo por
sesión), contexto solo de ese trabajo y archivos de proyecto (CLAUDE.md / AGENTS.md / PLAN) que la IA mantiene."""
import re
import unicodedata
from datetime import datetime
from pathlib import Path

from .config import general_dir, project_path, projects_root

_VERBOS = re.compile(r"^(?:por favor|porfa|oye|noviq|quiero|quisiera|necesito|me puedes|puedes|podrias|crea(?:r|me)?|haz(?:me)?|hacer|"
                     r"desarrolla(?:r)?|construye|programa(?:r)?|implementa|disena|genera|arma(?:me)?|un|una|el|la|nuevo|nueva|"
                     r"de|del|para|que|me|mi)\b\s*", re.I)


def es_real(proyecto):
    """Proyecto «de verdad» (no las carpetas internas como _General)."""
    return bool(proyecto) and not str(proyecto).startswith("_")


def _slug(texto, n=40):
    t = unicodedata.normalize("NFKD", str(texto or "")).encode("ascii", "ignore").decode()
    t = re.sub(r"[^A-Za-z0-9]+", "_", t).strip("_").lower()
    return t[:n].strip("_") or "trabajo"


def carpeta_conversacion(conv):
    """Carpeta de trabajo de una conversación sin proyecto real. → Path"""
    if conv.get("carpeta"):
        p = Path(conv["carpeta"])
        p.mkdir(parents=True, exist_ok=True)
        return p
    if not conv.get("carpeta_propia"):          # conversaciones de antes de la 4.7.3: siguen en _General
        return general_dir()
    titulo = conv.get("title") or ""
    if titulo in ("", "Nueva conversación"):
        titulo = next((str(m.get("content"))[:60] for m in conv.get("messages") or [] if m.get("role") == "user"), "trabajo")
    p = general_dir() / "conversaciones" / f"{datetime.now():%Y-%m-%d}_{_slug(titulo, 30)}_{str(conv.get('id', ''))[:4]}"
    p.mkdir(parents=True, exist_ok=True)
    conv["carpeta"] = str(p)
    return p


def nombre_proyecto(texto, nombre=""):
    """Nombre corto y único para un proyecto nuevo, a partir del pedido (o del nombre que dio el usuario)."""
    from .tools import safe_name
    base = (nombre or "").strip()
    if not base:
        t = re.sub(r"\s+", " ", str(texto or "")).strip()
        t = re.sub(r"[¿?¡!.,:;«»\"']", " ", t)
        prev = None
        while prev != t:
            prev, t = t, _VERBOS.sub("", t.strip())
        palabras = [w for w in t.split() if len(w) > 1][:5]
        base = " ".join(palabras) or "Proyecto"
        base = base[:1].upper() + base[1:]
    base = safe_name(base)[:40].strip() or "Proyecto"
    root, n, cand = projects_root(), 2, base
    while (root / cand).exists():
        cand = f"{base} {n}"
        n += 1
    return cand


def tipo_de(texto):
    t = unicodedata.normalize("NFKD", str(texto or "").lower()).encode("ascii", "ignore").decode()
    for tipo, rx in (("android", r"\bandroid|apk\b"), ("flutter", r"\bflutter"), ("arduino", r"\barduino|esp32|esp8266"),
                     ("python", r"\bpython|script|\bbot\b|telegram|automatiza"), ("node", r"\bnode|express|react|next\.?js"),
                     ("php", r"\bphp|laravel|wordpress"), ("java", r"\bjava\b|spring"), ("csharp", r"c#|\.net|csharp"),
                     ("datos", r"\bdatos|excel|csv|grafic|estadistic"),
                     ("web", r"pagina|sitio|web|landing|tienda|html|portafolio|blog")):
        if re.search(rx, t):
            return tipo
    return "general"


_HINT_NUEVO = re.compile(r"\n\n\(Es un PROYECTO NUEVO: créalo primero con crear_proyecto[^)]*\)")


def crear_proyecto_auto(conv, texto, emit, nombre=""):
    """Crea el proyecto propio de un pedido «construir algo nuevo» sin proyecto. → nombre o None."""
    from . import tools as T
    m = re.search(r"con el nombre «([^»]{1,60})»", texto or "")
    nombre = nombre_proyecto(texto, nombre or (m.group(1) if m else ""))
    try:
        p, _log = T.create_project(nombre, tipo_de(texto), (texto or "")[:300], "")
    except Exception as e:
        emit("notice", {"text": f"(no pude crear la carpeta del proyecto: {type(e).__name__}: {str(e)[:100]}; sigo en una carpeta propia)"})
        return None
    conv["project"] = p.name
    conv.pop("carpeta", None)
    # si el pedido traía la indicación «créalo primero con crear_proyecto», ya está hecho: que la IA no cree otro
    for msg in reversed(conv.get("messages") or []):
        if msg.get("role") == "user" and isinstance(msg.get("content"), str):
            msg["content"] = _HINT_NUEVO.sub(f"\n\n(El proyecto «{p.name}» ya fue creado por Noviq: trabaja dentro de él.)", msg["content"])
            break
    emit("project", {"name": p.name, "path": str(p)})
    emit("notice", {"text": f"🗂 Proyecto nuevo «{p.name}» con su propia carpeta: este trabajo no se mezcla con los anteriores."})
    return p.name


# ───────────── 🧰 Agente preparador: carpetas y archivos base del plan ─────────────
_RUTA = re.compile(r"^\s*[-*•]?\s*`?([\w.\-/\\]+?)`?\s*(?:[:—–-]\s+|$)")
_EXT_OK = {".html", ".htm", ".css", ".js", ".mjs", ".py", ".md", ".txt", ".json", ".ts", ".php", ".java", ".cs"}


def _base(ruta, para, plan):
    ext = Path(ruta).suffix.lower()
    nota = (para or "").strip()
    if ext in (".html", ".htm"):
        titulo = (plan.get("resumen") or Path(ruta).stem)[:60]
        estructura = [str(x) for x in plan.get("estructura") or []]
        css = [m.group(1) for x in estructura for m in [_RUTA.match(x)] if m and m.group(1).lower().endswith(".css")]
        js = [m.group(1) for x in estructura for m in [_RUTA.match(x)] if m and m.group(1).lower().endswith((".js", ".mjs"))]
        links = "".join(f'  <link rel="stylesheet" href="{c.replace(chr(92), "/")}">\n' for c in css[:4])
        scripts = "".join(f'  <script src="{j.replace(chr(92), "/")}"></script>\n' for j in js[:6])
        return ("<!DOCTYPE html>\n<html lang=\"es\">\n<head>\n  <meta charset=\"UTF-8\">\n"
                "  <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">\n"
                f"  <title>{titulo}</title>\n{links}</head>\n<body>\n  <!-- {nota} -->\n{scripts}</body>\n</html>\n")
    if ext in (".css",):
        return f"/* {nota} */\n"
    if ext in (".js", ".mjs", ".ts", ".java", ".cs"):
        return f"// {nota}\n"
    if ext == ".php":
        return f"<?php\n// {nota}\n"
    if ext == ".py":
        return f'"""{nota}"""\n'
    if ext == ".json":
        return "{}\n"
    return f"{nota}\n" if nota else ""


def preparar(cwd, plan, max_archivos=25):
    """Crea (sin IA) las carpetas y archivos base que el arquitecto definió en «estructura», más PLAN.md y README.md.
    No pisa nada que ya exista. → lista de rutas creadas (relativas)."""
    creados = []
    cwd = Path(cwd)
    try:
        base = cwd.resolve()
    except OSError:
        return creados
    for item in (plan.get("estructura") or [])[:60]:
        m = _RUTA.match(str(item))
        if not m:
            continue
        ruta = m.group(1).replace("\\", "/").strip("/")
        para = str(item)[m.end():].strip() if m.end() < len(str(item)) else ""
        if not ruta or ".." in ruta.split("/") or ruta.startswith((".git", ".noviq")):
            continue
        destino = (cwd / ruta).resolve()
        if base not in destino.parents and destino != base:
            continue   # nunca fuera de la carpeta del proyecto
        try:
            if str(item).rstrip().endswith("/") or (not Path(ruta).suffix and "." not in Path(ruta).name):
                if not destino.exists():
                    destino.mkdir(parents=True, exist_ok=True)
                    creados.append(ruta + "/")
            elif Path(ruta).suffix.lower() in _EXT_OK and not destino.exists() and len(creados) < max_archivos:
                destino.parent.mkdir(parents=True, exist_ok=True)
                destino.write_text(_base(ruta, para or "Por completar según PLAN.md", plan), encoding="utf-8")
                creados.append(ruta)
        except OSError:
            continue
    try:
        lineas = ["# Plan del proyecto", ""]
        if plan.get("resumen"):
            lineas += [str(plan["resumen"]), ""]
        if plan.get("tecnologia"):
            lineas += ["## Tecnología", str(plan["tecnologia"]), ""]
        if plan.get("estructura"):
            lineas += ["## Estructura"] + [f"- {x}" for x in plan["estructura"][:40]] + [""]
        lineas += ["## Tareas"] + [f"{k}. {t}" for k, t in enumerate(plan.get("tareas") or [], 1)] + [""]
        if plan.get("pruebas"):
            lineas += ["## Cómo probar", str(plan["pruebas"]), ""]
        if plan.get("riesgos"):
            lineas += ["## Cuidado con"] + [f"- {x}" for x in plan["riesgos"][:10]] + [""]
        (cwd / "PLAN.md").write_text("\n".join(lineas), encoding="utf-8")
        creados.append("PLAN.md")
        readme = cwd / "README.md"
        if not readme.exists() or len(readme.read_text(encoding="utf-8", errors="ignore").strip().splitlines()) <= 3:
            readme.write_text(f"# {cwd.name}\n\n{plan.get('resumen') or ''}\n\n"
                              + (f"**Tecnología:** {plan['tecnologia']}\n\n" if plan.get("tecnologia") else "")
                              + "Plan y tareas: ver `PLAN.md`.\n", encoding="utf-8")
            creados.append("README.md")
    except OSError:
        pass
    return creados
