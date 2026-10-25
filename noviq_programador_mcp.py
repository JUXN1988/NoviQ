# -*- coding: utf-8 -*-
"""🧑‍💻 Servidor MCP «Programador» de Noviq (stdio).

Da las herramientas de programación de Noviq (las mismas, mismo código) a cualquier cliente MCP: el avatar de Noviq
(bot «Programador»), Claude Desktop, VS Code, Cline… NO necesita que Noviq esté abierto.

Herramientas: proyectos, usar_proyecto, explorar_codigo, mapa_codigo, buscar_en_archivos, buscar_archivos,
listar_directorio, leer_archivo, editar_archivo, escribir_archivo, aplicar_parche, crear_carpeta, deshacer_cambio,
verificar_codigo, localizar_error, memoria.

Seguridad:
  · solo trabaja dentro de tus carpetas de proyectos (Documentos\\Noviq_Proyectos y los proyectos externos de Noviq)
  · nunca lee ni escribe claves: ni la bóveda de Noviq (este proceso no puede descifrarla: NOVIQ_SIN_BOVEDA),
    ni .env, .token, claves.*, llaves .pem/.key, id_rsa…
  · no ejecuta comandos (para eso están los bots del avatar y Noviq, con sus permisos)
  · cada cambio deja copia de respaldo (deshacer_cambio y el historial de versiones de Noviq la ven)

Uso en Claude Desktop (claude_desktop_config.json):
  "noviq-programador": {"command": "C:\\\\Users\\\\<tú>\\\\...\\\\Noviq\\\\.venv\\\\Scripts\\\\python.exe",
                        "args": ["C:\\\\Users\\\\<tú>\\\\...\\\\Noviq\\\\noviq_programador_mcp.py"]}
"""
import io
import json
import os
import re
import sys
import threading
import traceback
from pathlib import Path

os.environ["NOVIQ_SIN_BOVEDA"] = "1"          # ⚠ este proceso jamás descifra claves (lo abre el avatar)
os.environ.setdefault("PYTHONUTF8", "1")
AQUI = Path(__file__).resolve().parent
sys.path.insert(0, str(AQUI))
VERSION = "1.0.0"
PROTO = "2025-06-18"

_salida = sys.stdout.buffer                    # solo JSON-RPC sale por aquí
sys.stdout = sys.stderr                        # cualquier print() de las herramientas va a stderr

SECRETO = re.compile(r"(?i)(^|[\\/])(\.env(\..*)?|\.token|claves?\.(vault|json)(\.bak)?|.*\.vault(\.bak)?|id_rsa.*|id_ed25519.*|"
                     r".*\.(pem|key|pfx|p12|keystore|jks)|credentials?.*\.json|secrets?\..*|token\.json)$")


def _log(*a):
    print("[programador-mcp]", *a, file=sys.stderr, flush=True)


try:
    from noviq import tools as T
    from noviq.config import all_roots, project_path, projects_root
    from noviq.experto import alias as AL
    from noviq.experto import parches as PA
    IMPORT_ERROR = None
except Exception as e:  # sin dependencias (requests…): se informa en cada llamada en vez de morir en silencio
    IMPORT_ERROR = f"{type(e).__name__}: {e}"
    _log("no pude cargar Noviq:", IMPORT_ERROR)

ESTADO = {"proyecto": None, "conv": None}
_lock = threading.Lock()


def _conv():
    if ESTADO["conv"] is None:
        ESTADO["conv"] = {"id": "mcp_programador", "title": "Programador (MCP)", "project": None, "messages": [],
                          "display": [], "tasks": [], "respaldos": []}
    ESTADO["conv"]["project"] = ESTADO["proyecto"]
    return ESTADO["conv"]


def _proyectos():
    try:
        ps = T.list_projects()
    except Exception:
        ps = []
    return [p["name"] if isinstance(p, dict) else str(p) for p in ps]


def _resolver_proyecto(nombre):
    if not nombre:
        return None
    nombres = _proyectos()
    n = str(nombre).strip()
    if n in nombres:
        return n
    k = AL.clave(n)
    for x in nombres:
        if AL.clave(x) == k:
            return x
    cand = [x for x in nombres if k in AL.clave(x)]
    return cand[0] if len(cand) == 1 else None


def _dentro(p: Path):
    try:
        rp = p.resolve()
    except OSError:
        return False
    for r in all_roots():
        try:
            rp.relative_to(Path(r).resolve())
            return True
        except (ValueError, OSError):
            continue
    return False


def _rutas_de(nombre, args, ctx):
    rs = []
    for k in ("ruta", "origen", "destino"):
        if args.get(k):
            rs.append(str(args[k]))
    if nombre == "aplicar_parche":
        for op in PA.convertir(args.get("parche") or "", args.get("ruta")):
            if op.get("ruta"):
                rs.append(str(op["ruta"]))
    return [ctx.resolve(r) for r in rs]


S = lambda d: {"type": "string", "description": d}
I = lambda d: {"type": "integer", "description": d}
B = lambda d: {"type": "boolean", "description": d}
PROY = {"proyecto": S("Proyecto (nombre). Vacío = el elegido con usar_proyecto")}

HERRAMIENTAS = [
    ("proyectos", "Lista tus proyectos de programación (nombre y carpeta).", {}, [], True),
    ("usar_proyecto", "Elige el proyecto en el que vas a trabajar (las rutas relativas serán dentro de él).",
     {"nombre": S("Nombre del proyecto")}, ["nombre"], True),
    ("explorar_codigo", "🔎 Encuentra DÓNDE está algo con una pregunta normal ('¿dónde se controla el salto?'): busca sinónimos "
     "español/inglés, funciones y comentarios y devuelve archivo y líneas. Úsala primero.",
     {"pregunta": S("Qué buscas"), "ruta": S("Carpeta o archivo (opcional)"), **PROY}, ["pregunta"], True),
    ("mapa_codigo", "Mapa del proyecto: cada archivo con sus funciones/clases y número de línea.",
     {"ruta": S("Carpeta o archivo (opcional)"), **PROY}, [], True),
    ("buscar_en_archivos", "Busca texto o regex en el código (como grep). modo: lineas | archivos | conteo.",
     {"regex": S("Texto o regex"), "ruta": S("Carpeta o archivo (opcional)"), "incluir": S("Filtro, ej. '*.js'"),
      "modo": {"type": "string", "enum": ["lineas", "archivos", "conteo"]}, "contexto": I("Líneas de contexto (0-8)"), **PROY},
     ["regex"], True),
    ("buscar_archivos", "Busca archivos por nombre (glob, ej. '*.py', 'src/**/*.js'); los más recientes primero.",
     {"patron": S("Patrón"), "ruta": S("Carpeta (opcional)"), **PROY}, ["patron"], True),
    ("listar_directorio", "Lista archivos y carpetas.", {"ruta": S("Carpeta (vacío = proyecto)"), "recursivo": B("Con subcarpetas"), **PROY}, [], True),
    ("leer_archivo", "Lee un archivo con números de línea (usa desde_linea/hasta_linea para leer solo una parte).",
     {"ruta": S("Archivo"), "desde_linea": I("Desde"), "hasta_linea": I("Hasta"), **PROY}, ["ruta"], True),
    ("editar_archivo", "Cambia SOLO una parte de un archivo (copia de respaldo). texto_anterior (copiado SIN números de línea) + "
     "texto_nuevo; o desde_linea/hasta_linea + texto_nuevo; o despues_de_linea + texto_nuevo para insertar. Tolera espacios y sangría.",
     {"ruta": S("Archivo"), "texto_anterior": S("Texto que existe"), "texto_nuevo": S("Texto nuevo"),
      "ediciones": {"type": "array", "items": {"type": "object", "properties": {"texto_anterior": {"type": "string"},
                                                                                "texto_nuevo": {"type": "string"}}}},
      "desde_linea": I("Línea inicial (rango) o línea de la aparición a cambiar"), "hasta_linea": I("Línea final"),
      "despues_de_linea": I("Insertar después de esta línea"), "ocurrencia": I("Si se repite: cuál (1 = la primera)"),
      "reemplazar_todo": B("Cambiar todas las apariciones"), **PROY}, ["ruta"], False),
    ("escribir_archivo", "Crea un archivo NUEVO con su contenido completo (para cambiar uno existente usa editar_archivo).",
     {"ruta": S("Archivo"), "contenido": S("Contenido"), "sobrescribir": B("Reemplazar un archivo grande existente"), **PROY},
     ["ruta", "contenido"], False),
    ("aplicar_parche", "Aplica un parche: bloques <<<<<<< SEARCH/=======/>>>>>>> REPLACE, diff unificado o *** Begin Patch.",
     {"parche": S("El parche"), "ruta": S("Archivo (si el parche no lo dice)"), **PROY}, ["parche"], False),
    ("crear_carpeta", "Crea una carpeta.", {"ruta": S("Carpeta"), **PROY}, ["ruta"], False),
    ("deshacer_cambio", "Vuelve un archivo a la versión anterior al último cambio.", {"ruta": S("Archivo"), **PROY}, ["ruta"], False),
    ("verificar_codigo", "Revisa rápido sintaxis, imports y errores típicos (Python, JS, JSON, HTML, PowerShell) de un archivo o del proyecto.",
     {"ruta": S("Archivo o carpeta (opcional)"), **PROY}, [], True),
    ("localizar_error", "Con un mensaje de error o traza, muestra el archivo y la línea exacta del proyecto con el código alrededor.",
     {"texto_error": S("Error o traza"), **PROY}, ["texto_error"], True),
    ("memoria", "Memoria de Noviq: alcance usuario | proyecto | ajustes. accion: ver | agregar | buscar | olvidar.",
     {"accion": {"type": "string", "enum": ["ver", "agregar", "buscar", "olvidar"]},
      "alcance": {"type": "string", "enum": ["usuario", "proyecto", "ajustes", "todas"]}, "texto": S("Nota o qué buscar"), **PROY},
     ["accion"], False),
]
LEE = {h[0] for h in HERRAMIENTAS if h[4]}
NOMBRES = {h[0] for h in HERRAMIENTAS}


def lista_mcp():
    out = []
    for n, d, props, req, lee in HERRAMIENTAS:
        out.append({"name": n, "description": d, "inputSchema": {"type": "object", "properties": props, "required": req},
                    "annotations": {"readOnlyHint": lee, "destructiveHint": False, "openWorldHint": False}})
    return out


def _esquema(n):
    for h in HERRAMIENTAS:
        if h[0] == n:
            return h[2]
    return {}


def llamar(nombre, args):
    """Devuelve (texto, es_error)."""
    if IMPORT_ERROR:
        return (f"No pude cargar las herramientas de Noviq ({IMPORT_ERROR}). Abre Noviq una vez con iniciar.bat "
                "(instala lo que falta) y vuelve a intentarlo."), True
    args = dict(args or {})
    n2, args, nota = AL.normalizar(nombre, args, NOMBRES, _esquema)
    if not n2:
        return f"ERROR: herramienta desconocida «{nombre}». Disponibles: {', '.join(sorted(NOMBRES))}.", True
    nombre = n2
    with _lock:
        if args.get("proyecto"):
            p = _resolver_proyecto(args.pop("proyecto"))
            if p:
                ESTADO["proyecto"] = p
        else:
            args.pop("proyecto", None)
        if nombre == "proyectos":
            ps = _proyectos()
            return ("Proyectos (" + str(projects_root()) + "):\n" + "\n".join(f"- {x} — {project_path(x)}" for x in ps)
                    + (f"\n\nProyecto elegido: {ESTADO['proyecto']}" if ESTADO["proyecto"] else "\n\n(Elige uno con usar_proyecto.)")), False
        if nombre == "usar_proyecto":
            p = _resolver_proyecto(args.get("nombre"))
            if not p:
                return f"ERROR: no encontré el proyecto «{args.get('nombre')}». Usa proyectos para ver los nombres.", True
            ESTADO["proyecto"] = p
            return f"Proyecto elegido: {p} ({project_path(p)}). Las rutas relativas serán dentro de él.", False
        conv = _conv()
        ctx = T.ToolContext(conv, lambda *a, **k: None, threading.Event(), "mcp")
        for r in _rutas_de(nombre, args, ctx):
            if not _dentro(r):
                return (f"ERROR: {r} está fuera de tus carpetas de proyectos. Este servidor solo trabaja dentro de "
                        f"{', '.join(str(x) for x in all_roots())}."), True
            if SECRETO.search(str(r).replace("\\", "/")):
                return "ERROR: ese archivo guarda claves o datos privados: no lo leo ni lo cambio.", True
        try:
            res = T.FUNCS[nombre](args, ctx)
        except Exception as e:
            _log(traceback.format_exc())
            return f"ERROR ejecutando {nombre}: {type(e).__name__}: {e}", True
    if isinstance(res, dict):
        res = res.get("text", "")
    res = str(res)
    if nota:
        res = (res.rstrip() + "\n" + AL.nota_para_ia(nota)) if res.lstrip().startswith("ERROR") else AL.nota_para_ia(nota) + res
    if len(res) > 60000:
        res = res[:40000] + f"\n…[recortado: {len(res)} caracteres]…\n" + res[-15000:]
    return res, res.lstrip().startswith("ERROR")


def responder(msg):
    mid, metodo, params = msg.get("id"), msg.get("method"), msg.get("params") or {}
    if metodo == "initialize":
        return {"protocolVersion": params.get("protocolVersion") or PROTO, "capabilities": {"tools": {"listChanged": False}},
                "serverInfo": {"name": "noviq-programador", "title": "Programador de Noviq", "version": VERSION},
                "instructions": ("Herramientas de programación para los proyectos del usuario. Flujo eficiente: explorar_codigo → "
                                 "leer_archivo (solo las líneas) → editar_archivo → verificar_codigo. Rutas relativas = proyecto "
                                 "elegido con usar_proyecto.")}
    if metodo == "ping":
        return {}
    if metodo == "tools/list":
        return {"tools": lista_mcp()}
    if metodo == "tools/call":
        texto, err = llamar(params.get("name"), params.get("arguments") or {})
        return {"content": [{"type": "text", "text": texto}], "isError": bool(err)}
    if mid is not None:
        raise LookupError(f"método no soportado: {metodo}")
    return None


def _enviar(obj):
    _salida.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
    _salida.flush()


def main():
    _log(f"v{VERSION} listo ({'sin Noviq: ' + IMPORT_ERROR if IMPORT_ERROR else 'herramientas cargadas'})")
    entrada = io.TextIOWrapper(sys.stdin.buffer, encoding="utf-8", errors="replace")
    for linea in entrada:
        linea = linea.strip()
        if not linea:
            continue
        try:
            msg = json.loads(linea)
        except ValueError:
            _enviar({"jsonrpc": "2.0", "id": None, "error": {"code": -32700, "message": "JSON inválido"}})
            continue
        lote = msg if isinstance(msg, list) else [msg]
        for m in lote:
            if not isinstance(m, dict) or "method" not in m:
                continue
            try:
                r = responder(m)
                if m.get("id") is not None:
                    _enviar({"jsonrpc": "2.0", "id": m["id"], "result": r})
            except LookupError as e:
                _enviar({"jsonrpc": "2.0", "id": m.get("id"), "error": {"code": -32601, "message": str(e)}})
            except Exception as e:
                _log(traceback.format_exc())
                if m.get("id") is not None:
                    _enviar({"jsonrpc": "2.0", "id": m["id"], "error": {"code": -32603, "message": f"{type(e).__name__}: {e}"}})


if __name__ == "__main__":
    main()
