# -*- coding: utf-8 -*-
"""🧰 Herramientas del PROGRAMADOR EXPERTO que se suman a las de Noviq (sin cambiar cómo se llaman las de siempre):

  · rutas tolerantes en leer/editar/buscar/listar/mapa/deshacer (ver rutas.py)
  · explorar_codigo   → «¿dónde está X?» en una llamada (ver explorar.py)
  · crear_carpeta     → oculta: la usan las IAs que llaman «mkdir» (antes: «herramienta desconocida»)
  · verificar_codigo  → oculta en Noviq (ya prueba solo tras cada cambio); la usan el avatar y Claude Desktop por MCP
"""
from . import explorar as X
from . import parches as PA
from . import rutas as RT

# herramienta → (argumento con la ruta, qué debe ser)
CON_RUTA = {
    "leer_archivo": ("ruta", "cualquiera"),
    "editar_archivo": ("ruta", "archivo"),
    "deshacer_cambio": ("ruta", "cualquiera"),
    "buscar_en_archivos": ("ruta", "cualquiera"),
    "buscar_archivos": ("ruta", "carpeta"),
    "listar_directorio": ("ruta", "carpeta"),
    "mapa_codigo": ("ruta", "cualquiera"),
    "explorar_codigo": ("ruta", "cualquiera"),
    "versiones_archivo": ("ruta", "cualquiera"),
    "verificar_codigo": ("ruta", "cualquiera"),
}


def _raices():
    try:
        from ..config import all_roots
        return all_roots()
    except Exception:
        return []


def con_ruta_sana(nombre, fn):
    arg, quiere = CON_RUTA[nombre]

    def envuelta(a, ctx):
        ruta = a.get(arg)
        if not ruta or not str(ruta).strip() or str(ruta).strip() in (".", "./"):
            return fn(a, ctx)
        if nombre == "deshacer_cambio":  # el archivo pudo borrarse: solo se corrige si la ruta no existe y hay otra única
            p0 = ctx.resolve(ruta)
            if p0.exists():
                return fn(a, ctx)
        p, nota, cands = RT.sanar(ruta, ctx.cwd, _raices(), quiere)
        if p is None:
            if cands:
                return RT.mensaje_no_existe(ruta, cands, ctx.cwd)
            if nombre in ("editar_archivo", "deshacer_cambio", "versiones_archivo"):
                return fn(a, ctx)  # su propio error ya dice qué hacer (p. ej. «usa escribir_archivo para crearlo»)
            return RT.mensaje_no_existe(ruta, [], ctx.cwd)
        if not nota:
            return fn(a, ctx)
        a = dict(a)
        a[arg] = str(p)
        r = fn(a, ctx)
        aviso = f"[Ruta corregida: {nota}]"
        if isinstance(r, dict):
            r = dict(r)
            r["text"] = aviso + "\n" + str(r.get("text", ""))
            return r
        r = str(r)
        return (r.rstrip() + "\n" + aviso) if r.lstrip().startswith(("ERROR", "Error")) else aviso + "\n" + r
    envuelta.__name__ = getattr(fn, "__name__", nombre)
    envuelta._ruta_sana = True
    return envuelta


def t_explorar_codigo(a, ctx):
    pregunta = a.get("pregunta") or a.get("texto") or a.get("consulta") or ""
    raiz = ctx.resolve(a.get("ruta") or ".")
    try:
        n = max(1, min(8, int(a.get("max_resultados") or 5)))
    except (TypeError, ValueError):
        n = 5
    return X.explorar(pregunta, raiz, max_resultados=n)


def t_crear_carpeta(a, ctx):
    ruta = a.get("ruta") or ""
    if not str(ruta).strip():
        return "ERROR: indica la carpeta en 'ruta'."
    p = ctx.resolve(ruta)
    if p.exists() and not p.is_dir():
        return f"ERROR: {p} ya existe y es un archivo."
    existia = p.exists()
    p.mkdir(parents=True, exist_ok=True)
    return f"Carpeta {'ya existía' if existia else 'creada'}: {p}"


def t_verificar_codigo(a, ctx):
    """Revisión rápida de sintaxis/imports de archivos (o del proyecto), sin ejecutar nada pesado."""
    from .. import pruebas as PR
    root = ctx.cwd
    objetivo = ctx.resolve(a.get("ruta") or ".")
    solo = None
    if objetivo.is_file():
        try:
            solo = [objetivo.resolve().relative_to(root.resolve()).as_posix()]
        except ValueError:
            root, solo = objetivo.parent, [objetivo.name]
    elif objetivo.is_dir():
        root = objetivo
    archivos = a.get("archivos")
    if isinstance(archivos, list) and archivos:
        solo = [str(x).replace("\\", "/") for x in archivos]
    res = PR.run_checks(root, only=solo)
    return PR.report(res)


DEFS = [
    {"type": "function", "function": {
        "name": "explorar_codigo",
        "description": ("🔎 Encuentra DÓNDE está algo en el código con UNA pregunta en lenguaje normal (ej. '¿dónde se controla el salto "
                        "del jugador?'). Busca sinónimos español/inglés (salto=jump), nombres de funciones y comentarios, y devuelve "
                        "las mejores zonas con números de línea. Úsala ANTES de buscar_en_archivos o de leer archivos enteros."),
        "parameters": {"type": "object", "properties": {
            "pregunta": {"type": "string", "description": "Qué buscas, en palabras normales o nombres de funciones"},
            "ruta": {"type": "string", "description": "Carpeta o archivo (vacío = proyecto activo)"},
            "max_resultados": {"type": "integer", "description": "Zonas a devolver (def. 5)"}},
            "required": ["pregunta"]}}},
]
OCULTAS = {"crear_carpeta": t_crear_carpeta, "verificar_codigo": t_verificar_codigo, "aplicar_parche": PA.t_aplicar_parche}
DEFS_OCULTAS = [
    PA.DEF,
    {"type": "function", "function": {
        "name": "crear_carpeta", "description": "Crea una carpeta (y las que falten en el camino).",
        "parameters": {"type": "object", "properties": {"ruta": {"type": "string", "description": "Carpeta a crear"}}, "required": ["ruta"]}}},
    {"type": "function", "function": {
        "name": "verificar_codigo",
        "description": "Revisa rápido la sintaxis, imports y errores típicos de un archivo o del proyecto (Python, JS, JSON, HTML, PowerShell).",
        "parameters": {"type": "object", "properties": {
            "ruta": {"type": "string", "description": "Archivo o carpeta (vacío = proyecto)"},
            "archivos": {"type": "array", "items": {"type": "string"}, "description": "Solo estos archivos (opcional)"}}}}},
]


def esquema(nombre, builtin):
    """Propiedades del esquema de una herramienta (para traducir argumentos)."""
    for t in list(builtin) + DEFS + DEFS_OCULTAS:
        f = t.get("function") or {}
        if f.get("name") == nombre:
            return (f.get("parameters") or {}).get("properties") or {}
    return {}


def instalar(builtin, funcs):
    """Se llama al final de tools.py: suma las herramientas nuevas y envuelve las que usan rutas."""
    nombres = {t["function"]["name"] for t in builtin}
    for d in DEFS:
        if d["function"]["name"] not in nombres:
            builtin.append(d)
    funcs["explorar_codigo"] = t_explorar_codigo
    for k, f in OCULTAS.items():
        funcs.setdefault(k, f)
    for k in CON_RUTA:
        if k in funcs and not getattr(funcs[k], "_ruta_sana", False):
            funcs[k] = con_ruta_sana(k, funcs[k])
