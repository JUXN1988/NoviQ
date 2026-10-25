# -*- coding: utf-8 -*-
"""🩹 Parches en los formatos que usan otras herramientas de programación, convertidos a ediciones de Noviq.

  · bloques SEARCH/REPLACE (Cline, Aider, Roo):  <<<<<<< SEARCH … ======= … >>>>>>> REPLACE
  · diff unificado (git diff):                   --- a/x  +++ b/x  @@ -3,2 +3,2 @@  ' ' / '-' / '+'
  · apply_patch de Codex:                        *** Begin Patch / *** Update File: x / *** Add File: x / *** End Patch
Cada cambio se aplica con editar_archivo (copia de respaldo, tolerancia a espacios y sangría, mensajes claros);
los archivos nuevos con escribir_archivo. Borrar archivos con un parche NO se hace (eso pide permiso aparte).
"""
import re

SR = re.compile(r"<{5,9} ?SEARCH[^\n]*\n(.*?)\n?={5,9}\s*\n(.*?)\n?>{5,9} ?REPLACE", re.S)


def es_parche(t):
    t = str(t or "")
    return bool(SR.search(t) or "*** Begin Patch" in t or re.search(r"^@@ .*@@", t, re.M) or re.search(r"^(---|\+\+\+) ", t, re.M))


def _sr(texto):
    return [{"texto_anterior": a, "texto_nuevo": b} for a, b in SR.findall(texto)]


def _hunks(lineas):
    """Líneas de un diff (desde el primer @@) → ediciones (contexto + quitado → contexto + agregado)."""
    eds, viejo, nuevo, en = [], [], [], False
    for ln in lineas + ["@@"]:
        if ln.startswith("@@"):
            while viejo and nuevo and viejo[-1] == "" and nuevo[-1] == "":  # salto de línea final del diff
                viejo.pop()
                nuevo.pop()
            if en and (viejo or nuevo) and viejo != nuevo:
                eds.append({"texto_anterior": "\n".join(viejo), "texto_nuevo": "\n".join(nuevo)})
            viejo, nuevo, en = [], [], True
            continue
        if not en or ln.startswith(("\\ No newline", "*** End of File")):
            continue
        if ln.startswith("-"):
            viejo.append(ln[1:])
        elif ln.startswith("+"):
            nuevo.append(ln[1:])
        else:
            ln = ln[1:] if ln.startswith(" ") else ln
            viejo.append(ln)
            nuevo.append(ln)
    # sin líneas de contexto, un bloque que solo agrega no se puede ubicar: se descarta (la IA debe dar contexto)
    return [e for e in eds if e["texto_anterior"].strip()]


def convertir(texto, ruta=None):
    """Devuelve una lista de operaciones: {"op": "editar"|"crear"|"borrar", "ruta", "ediciones"|"contenido"}."""
    texto = str(texto or "").replace("\r\n", "\n")
    ops = []
    if "*** Begin Patch" in texto or "*** Update File:" in texto or "*** Add File:" in texto:
        actual, modo, lineas = None, None, []

        def cerrar():
            if actual is None:
                return
            if modo == "crear":
                ops.append({"op": "crear", "ruta": actual, "contenido": "\n".join(l[1:] if l.startswith("+") else l for l in lineas) + "\n"})
            elif modo == "editar":
                eds = _hunks(["@@"] + [l for l in lineas if not l.startswith("@@")] if not any(l.startswith("@@") for l in lineas) else lineas)
                ops.append({"op": "editar", "ruta": actual, "ediciones": eds})
            elif modo == "borrar":
                ops.append({"op": "borrar", "ruta": actual})
        for ln in texto.split("\n"):
            m = re.match(r"\*\*\* (Update|Add|Delete) File: (.+)", ln)
            if m:
                cerrar()
                actual, modo, lineas = m.group(2).strip(), {"Update": "editar", "Add": "crear", "Delete": "borrar"}[m.group(1)], []
                continue
            if ln.startswith(("*** Begin Patch", "*** End Patch", "*** Move to:")):
                continue
            if actual is not None:
                lineas.append(ln)
        cerrar()
        return ops
    eds = _sr(texto)
    if eds:
        return [{"op": "editar", "ruta": ruta, "ediciones": eds}]
    if re.search(r"^@@", texto, re.M) or re.search(r"^--- ", texto, re.M):
        actual, lineas = ruta, []
        for ln in texto.split("\n"):
            m = re.match(r"\+\+\+ (?:b/)?(\S+)", ln)
            if m and m.group(1) != "/dev/null":
                if lineas and actual:
                    ops.append({"op": "editar", "ruta": actual, "ediciones": _hunks(lineas)})
                actual, lineas = (ruta or m.group(1)), []
                continue
            if ln.startswith("--- ") or ln.startswith("diff --git") or ln.startswith("index "):
                continue
            lineas.append(ln)
        if lineas and actual:
            ops.append({"op": "editar", "ruta": actual, "ediciones": _hunks(lineas)})
        return ops
    return []


def t_aplicar_parche(a, ctx):
    from ..tools import FUNCS
    texto = a.get("parche") or a.get("diff") or a.get("patch") or a.get("input") or a.get("contenido") or ""
    ruta = a.get("ruta")
    ops = convertir(texto, ruta)
    if not ops:
        return ("ERROR: no reconocí el parche. Formatos válidos: bloques <<<<<<< SEARCH / ======= / >>>>>>> REPLACE, diff unificado "
                "(@@ … @@ con líneas -/+) o *** Begin Patch. Más simple: editar_archivo con texto_anterior y texto_nuevo.")
    out, fallos = [], 0
    for op in ops:
        if not op.get("ruta"):
            fallos += 1
            out.append("ERROR: el parche no dice a qué archivo va: indica 'ruta'.")
            continue
        if op["op"] == "borrar":
            out.append(f"No borré {op['ruta']}: para borrar usa la herramienta eliminar (pide permiso).")
            continue
        if op["op"] == "crear":
            r = FUNCS["escribir_archivo"]({"ruta": op["ruta"], "contenido": op["contenido"]}, ctx)
        else:
            if not op["ediciones"]:
                fallos += 1
                out.append(f"ERROR: el parche de {op['ruta']} no tiene líneas de contexto para ubicar el cambio.")
                continue
            r = FUNCS["editar_archivo"]({"ruta": op["ruta"], "ediciones": op["ediciones"]}, ctx)
        r = str(r if not isinstance(r, dict) else r.get("text", ""))
        if r.lstrip().startswith("ERROR"):
            fallos += 1
        out.append(r)
    txt = "\n\n".join(out)
    return ("ERROR al aplicar el parche: " if fallos and fallos == len(ops) else "") + txt


DEF = {"type": "function", "function": {
    "name": "aplicar_parche",
    "description": "Aplica un parche (bloques SEARCH/REPLACE, diff unificado o *** Begin Patch) con copia de respaldo.",
    "parameters": {"type": "object", "properties": {
        "ruta": {"type": "string", "description": "Archivo (si el parche no lo dice)"},
        "parche": {"type": "string", "description": "El parche"}}, "required": ["parche"]}}}
