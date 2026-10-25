# -*- coding: utf-8 -*-
"""🔤 Traductor de llamadas para IAs pequeñas.

Las IAs pequeñas (y las «destiladas» de Claude, Qwen, GPT…) llaman a las herramientas con los nombres con que las
entrenaron: Read, Edit, Grep, Bash, TodoWrite, read_file, str_replace_editor, mkdir… y con argumentos en inglés
(file_path, old_string, pattern, command…). Antes Noviq respondía «herramienta desconocida» o, peor, ignoraba el
argumento y hacía otra cosa (ej. ejecutar código vacío). Este módulo traduce todo eso a las herramientas de Noviq
SIN gastar otra llamada de la IA, y devuelve una nota corta para que la IA aprenda el nombre correcto.

Los nombres están en alias.json (los usa también el avatar). Solo se traduce un argumento si la herramienta
de destino lo tiene en su esquema y la IA no lo mandó ya con el nombre correcto: nunca se pisa nada.
"""
import difflib
import json
import re
import unicodedata
from pathlib import Path

_DATOS = json.loads((Path(__file__).with_name("alias.json")).read_text(encoding="utf-8"))


def clave(s):
    """'Read-File' → 'read_file'; sin tildes, sin prefijos 'functions.' / 'default_api.'."""
    s = unicodedata.normalize("NFKD", str(s or "")).encode("ascii", "ignore").decode().strip()
    s = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", s).lower()   # camelCase → snake_case
    s = re.sub(r"^(functions|function|tools|tool|default_api|api)[.:]", "", s)
    return re.sub(r"[\s\-./]+", "_", s).strip("_")


def _invertir(d):
    inv = {}
    for canon, lista in d.items():
        if canon.startswith("_"):
            continue
        for a in lista:
            inv.setdefault(clave(a), [])
            if canon not in inv[clave(a)]:
                inv[clave(a)].append(canon)
    return inv


HERR = _invertir(_DATOS["herramientas"])               # alias → [herramienta]
HERR_SIN = {k.replace("_", ""): v for k, v in HERR.items()}  # «askuserquestion» = «ask_user_question»
ARGS = _invertir(_DATOS["argumentos"])                 # alias → [argumentos posibles, en orden]
EDITOR = {clave(n) for n in _DATOS["editor"]["nombres"]}
EDITOR_CMD = _DATOS["editor"]["comandos"]
ESTADOS = {clave(k): v for k, v in _DATOS["estados"].items()}
VALORES = _invertir(_DATOS.get("valores") or {})       # valor en inglés → [valores de Noviq]


def nombre(n, validos):
    """Nombre de herramienta → (nombre_valido | None, nota)."""
    if n in validos:
        return n, ""
    k = clave(n)
    for v in validos:
        if clave(v) == k:
            return v, ""
    for cand in HERR.get(k, []) or HERR_SIN.get(k.replace("_", ""), []):
        if cand in validos:
            return cand, f"«{n}» es «{cand}» en Noviq"
    # parecido (errores de tipeo): solo si es MUY parecido para no ejecutar otra cosa
    cerca = difflib.get_close_matches(k, [clave(v) for v in validos], n=1, cutoff=0.86)
    if cerca:
        v = next(v for v in validos if clave(v) == cerca[0])
        return v, f"«{n}» → «{v}»"
    cerca = difflib.get_close_matches(k, list(HERR), n=1, cutoff=0.88)
    if cerca:
        for cand in HERR[cerca[0]]:
            if cand in validos:
                return cand, f"«{n}» es «{cand}» en Noviq"
    return None, ""


def _bool(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return bool(v)
    s = clave(v)
    if s in ("true", "si", "yes", "1", "verdadero", "y", "on"):
        return True
    if s in ("false", "no", "0", "falso", "n", "off", "", "none", "null"):
        return False
    return v


def _int(v):
    if isinstance(v, bool):
        return v
    if isinstance(v, (int, float)):
        return int(v)
    m = re.match(r"^\s*(-?\d+)", str(v or ""))
    return int(m.group(1)) if m else v


def _valor_enum(v, opciones):
    """'add' → 'agregar', 'project' → 'proyecto', 'Files_With_Matches' → 'archivos' (solo si cae en las opciones)."""
    if v in opciones:
        return v
    k = clave(v)
    for o in opciones:
        if clave(o) == k:
            return o
    for cand in VALORES.get(k, []) + ([ESTADOS[k]] if k in ESTADOS else []):
        if cand in opciones:
            return cand
    cerca = difflib.get_close_matches(k, [clave(o) for o in opciones], n=1, cutoff=0.8)
    return next((o for o in opciones if clave(o) == cerca[0]), v) if cerca else v


def _coercer(args, props):
    for k, v in list(args.items()):
        t = (props.get(k) or {}).get("type")
        if v is None:
            continue
        en = (props.get(k) or {}).get("enum")
        if en and isinstance(v, str) and v not in en:
            args[k] = _valor_enum(v, en)
            continue
        if t == "integer":
            args[k] = _int(v)
        elif t == "boolean":
            args[k] = _bool(v)
        elif t == "string" and isinstance(v, list) and all(isinstance(x, str) for x in v):
            args[k] = "\n".join(v)  # contenido mandado como lista de líneas
        elif t == "string" and isinstance(v, (int, float)) and not isinstance(v, bool):
            args[k] = str(v)
        elif t == "array" and isinstance(v, str) and v.strip().startswith("["):
            try:
                args[k] = json.loads(v)
            except ValueError:
                pass
    return args


def _mapear(obj, props):
    """Cambia las claves desconocidas por las del esquema (sin pisar las que ya vienen bien)."""
    if not props:
        return dict(obj), []
    out, notas = dict(obj), []
    por_clave = {clave(p): p for p in props}
    por_clave.update({clave(p).replace("_", ""): p for p in props})
    for k, v in obj.items():
        if k in props:
            continue
        kk = clave(k).lstrip("_")
        pk = por_clave.get(kk) or por_clave.get(kk.replace("_", ""))
        if pk and pk not in out:  # «Ruta», «Texto_Anterior», «textoAnterior», «textoanterior»…
            out[pk] = v
            out.pop(k, None)
            notas.append(f"{k}→{pk}")
            continue
        for cand in ARGS.get(kk, []):
            if cand in props and cand not in out:
                out[cand] = v
                out.pop(k, None)
                notas.append(f"{k}→{cand}")
                break
    return out, notas


def _item_edicion(e):
    if not isinstance(e, dict):
        return e
    o, _ = _mapear(e, {"texto_anterior": {}, "texto_nuevo": {}, "reemplazar_todo": {}})
    return o


def _item_tarea(t):
    if isinstance(t, str):
        return {"contenido": t, "estado": "pendiente"}
    if not isinstance(t, dict):
        return t
    o, _ = _mapear(t, {"contenido": {}, "estado": {}})
    o.pop("activeForm", None)
    if "contenido" not in o:
        o["contenido"] = str(t.get("content") or t.get("task") or t.get("title") or t.get("texto") or t.get("descripcion") or "")
    o["estado"] = ESTADOS.get(clave(o.get("estado") or "pendiente"), o.get("estado") or "pendiente")
    if o["estado"] not in ("pendiente", "en_progreso", "completada"):
        o["estado"] = "pendiente"
    return o


def normalizar(n, args, validos, props_de=None):
    """Traduce una llamada. validos: nombres que existen. props_de(nombre) → dict de propiedades del esquema.
    Devuelve (nombre | None, args, nota). nota = texto corto para la IA ('' si no hubo nada que traducir)."""
    args = dict(args) if isinstance(args, dict) else {}
    notas = []
    k = clave(n)
    # «str_replace_editor» (una herramienta con 'command'): se decide por el comando
    if k in EDITOR and n not in validos:
        cmd = clave(args.pop("command", "") or args.pop("comando", "") or "view")
        dest = EDITOR_CMD.get(cmd, "leer_archivo")
        if cmd == "view" and isinstance(args.get("view_range"), list) and len(args["view_range"]) == 2:
            args["desde_linea"], args["hasta_linea"] = args.pop("view_range")
        if cmd == "insert" and "insert_line" in args:
            args["despues_de_linea"] = args.pop("insert_line")
        notas.append(f"«{n}» con command={cmd} es «{dest}»")
        n = dest
    # parches (Cline «replace_in_file» con diff SEARCH/REPLACE, Codex «apply_patch», diff unificado) → aplicar_parche
    if "aplicar_parche" in validos and n != "aplicar_parche":
        from .parches import es_parche
        for kk in ("diff", "patch", "parche", "input", "unified_diff", "changes"):
            if isinstance(args.get(kk), str) and es_parche(args[kk]):
                ruta = next((args.get(x) for x in ("ruta", "path", "file_path", "file", "filename", "target_file") if args.get(x)), None)
                notas.append(f"«{n}» con un parche es «aplicar_parche»")
                n, args = "aplicar_parche", {"parche": args[kk], **({"ruta": ruta} if ruta else {})}
                break
    real, nota = nombre(n, validos)
    if not real:
        return None, args, ""
    if nota:
        notas.append(nota)
    props = (props_de(real) if props_de else None) or {}
    # ── casos especiales antes de mapear ──
    if real == "leer_archivo" and "limit" in args and "hasta_linea" not in args:
        try:
            ini = int(args.get("offset") or args.get("desde_linea") or 1)
            args["hasta_linea"] = ini + int(args.pop("limit")) - 1
            args.setdefault("desde_linea", ini)
            args.pop("offset", None)
        except (TypeError, ValueError):
            pass
    if real == "buscar_en_archivos":
        if args.get("-i") is True and "mayusculas" not in args:
            args["mayusculas"] = False
        ctxs = [args.pop(x) for x in ("-A", "-B", "-C", "-a", "-b", "-c") if x in args]
        if ctxs and "contexto" not in args:
            args["contexto"] = max(_int(x) if isinstance(_int(x), int) else 0 for x in ctxs)
        for x in ("-i", "-n"):
            args.pop(x, None)
        om = clave(args.get("output_mode") or args.get("modo") or "")
        if om:
            args.pop("output_mode", None)
            args["modo"] = {"files_with_matches": "archivos", "files": "archivos", "count": "conteo", "content": "lineas"}.get(om, args.get("modo", om))
    if real == "ejecutar_powershell" and "timeout" in args and "timeout_segundos" not in args:
        t = _int(args.pop("timeout"))
        if isinstance(t, int):
            args["timeout_segundos"] = t // 1000 if t > 3600 else t  # Bash de Claude usa milisegundos
    if props:
        args, mapeados = _mapear(args, props)
        if mapeados:
            notas.append("argumentos: " + ", ".join(mapeados))
        _coercer(args, props)
    # ── listas anidadas ──
    if real == "editar_archivo" and isinstance(args.get("ediciones"), list):
        args["ediciones"] = [_item_edicion(e) for e in args["ediciones"]]
    if real == "actualizar_tareas" and isinstance(args.get("tareas"), list):
        args["tareas"] = [_item_tarea(t) for t in args["tareas"]]
    if real == "marcar_tarea" and args.get("estado"):
        args["estado"] = ESTADOS.get(clave(args["estado"]), args["estado"])
    if real in ("ejecutar_powershell", "ejecutar_python") and not args.get("explicacion") and "explicacion" in props:
        args["explicacion"] = "(sin explicación)"
    return real, args, ("; ".join(notas) if notas else "")


def nota_para_ia(nota):
    return f"[Noviq tradujo tu llamada: {nota}. Usa esos nombres la próxima vez.]\n" if nota else ""
