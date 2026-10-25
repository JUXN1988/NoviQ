# -*- coding: utf-8 -*-
"""Pruebas unitarias del PROGRAMADOR EXPERTO (python -m pytest pruebas -q).
Cada prueba usa carpetas temporales: no toca tus proyectos ni tu memoria."""
import json
import os
import sys
import tempfile
import threading
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent
_TMP = Path(tempfile.mkdtemp(prefix="noviq_test_"))
os.environ["NOVIQ_DATOS"] = str(_TMP / "datos")
(_TMP / "datos").mkdir(parents=True, exist_ok=True)
(_TMP / "datos" / "config.json").write_text(json.dumps({"projects_dir": str(_TMP / "Noviq_Proyectos")}), encoding="utf-8")
sys.path.insert(0, str(RAIZ))

from noviq import edicion as ED  # noqa: E402
from noviq import tools as T  # noqa: E402
from noviq.experto import alias as AL  # noqa: E402
from noviq.experto import explorar as X  # noqa: E402
from noviq.experto import memoria as MEM  # noqa: E402
from noviq.experto import parches as PA  # noqa: E402
from noviq.experto import rutas as RT  # noqa: E402

JUGADOR = "class Jugador {\n  constructor() {\n    this.vida = 3;\n  }\n  jump() {\n    // impulso hacia arriba\n    this.vy = -9;\n  }\n}\n"


@pytest.fixture()
def proyecto(tmp_path):
    root = Path(T.projects_root()) / ("p_" + tmp_path.name[-12:])
    (root / "src" / "js").mkdir(parents=True, exist_ok=True)
    (root / "src" / "js" / "jugador.js").write_text(JUGADOR, encoding="utf-8")
    (root / "calc.py").write_text("def sumar(a, b):\n    return a + b\n", encoding="utf-8")
    conv = {"id": "t", "project": root.name, "messages": [], "display": [], "tasks": [], "respaldos": []}
    ctx = T.ToolContext(conv, lambda *a, **k: None, threading.Event())
    return root, ctx


VALIDOS = set(T.FUNCS)


# ─────────────── alias ───────────────
@pytest.mark.parametrize("nombre,esperado", [
    ("Read", "leer_archivo"), ("read_file", "leer_archivo"), ("Edit", "editar_archivo"), ("MultiEdit", "editar_archivo"),
    ("Write", "escribir_archivo"), ("Grep", "buscar_en_archivos"), ("Glob", "buscar_archivos"), ("Bash", "ejecutar_powershell"),
    ("TodoWrite", "actualizar_tareas"), ("mkdir", "crear_carpeta"), ("LS", "listar_directorio"), ("WebFetch", "leer_pagina_web"),
    ("functions.read_file", "leer_archivo"), ("leer-archivo", "leer_archivo"), ("apply_patch", "aplicar_parche"),
    ("leer_archivoo", "leer_archivo"),
])
def test_alias_nombres(nombre, esperado):
    assert AL.nombre(nombre, VALIDOS)[0] == esperado


def test_alias_valores_en_ingles_y_mayusculas():
    n, a, _ = AL.normalizar("memory", {"action": "add", "scope": "project", "text": "x"}, VALIDOS, T.esquema_de)
    assert n == "memoria" and a == {"accion": "agregar", "alcance": "proyecto", "texto": "x"}
    _, a, _ = AL.normalizar("editar_archivo", {"Ruta": "a", "Texto_Anterior": "b", "textoNuevo": "c"}, VALIDOS, T.esquema_de)
    assert a == {"ruta": "a", "texto_anterior": "b", "texto_nuevo": "c"}
    assert AL.nombre("AskUserQuestion", VALIDOS)[0] == "pedir_ayuda_usuario"


def test_alias_desconocido_no_inventa():
    assert AL.nombre("hacer_cafe", VALIDOS)[0] is None
    assert AL.nombre("delete_everything_now", VALIDOS)[0] is None


def test_alias_argumentos_edit_claude():
    n, a, nota = AL.normalizar("Edit", {"file_path": "x.js", "old_string": "a", "new_string": "b", "replace_all": "true"}, VALIDOS, T.esquema_de)
    assert n == "editar_archivo" and a == {"ruta": "x.js", "texto_anterior": "a", "texto_nuevo": "b", "reemplazar_todo": True}
    assert "file_path→ruta" in nota


def test_alias_no_pisa_argumentos_correctos():
    _, a, _ = AL.normalizar("editar_archivo", {"ruta": "bueno.js", "path": "malo.js", "texto_anterior": "x", "texto_nuevo": "y"}, VALIDOS, T.esquema_de)
    assert a["ruta"] == "bueno.js"


def test_alias_read_offset_limit():
    _, a, _ = AL.normalizar("Read", {"file_path": "a.py", "offset": 10, "limit": 5}, VALIDOS, T.esquema_de)
    assert a["desde_linea"] == 10 and a["hasta_linea"] == 14


def test_alias_todowrite_estados():
    _, a, _ = AL.normalizar("TodoWrite", {"todos": [{"content": "x", "status": "in_progress", "activeForm": "X"},
                                                    {"content": "y", "status": "completed"}]}, VALIDOS, T.esquema_de)
    assert a["tareas"] == [{"contenido": "x", "estado": "en_progreso"}, {"contenido": "y", "estado": "completada"}]


def test_alias_grep_flags():
    _, a, _ = AL.normalizar("Grep", {"pattern": "vida", "output_mode": "files_with_matches", "-i": True, "-C": 2, "glob": "*.js"},
                            VALIDOS, T.esquema_de)
    assert a["regex"] == "vida" and a["modo"] == "archivos" and a["mayusculas"] is False and a["contexto"] == 2 and a["incluir"] == "*.js"


def test_alias_bash_milisegundos():
    _, a, _ = AL.normalizar("Bash", {"command": "dir", "timeout": 120000}, VALIDOS, T.esquema_de)
    assert a["comando"] == "dir" and a["timeout_segundos"] == 120 and a["explicacion"]


def test_alias_editor_unico():
    n, a, _ = AL.normalizar("str_replace_editor", {"command": "view", "path": "a.py", "view_range": [3, 9]}, VALIDOS, T.esquema_de)
    assert n == "leer_archivo" and a["ruta"] == "a.py" and (a["desde_linea"], a["hasta_linea"]) == (3, 9)
    n, a, _ = AL.normalizar("str_replace_editor", {"command": "insert", "path": "a.py", "insert_line": 4, "new_str": "x"}, VALIDOS, T.esquema_de)
    assert n == "editar_archivo" and a["despues_de_linea"] == 4 and a["texto_nuevo"] == "x"


def test_alias_parche_cline():
    n, a, _ = AL.normalizar("replace_in_file", {"path": "a.js", "diff": "<<<<<<< SEARCH\na\n=======\nb\n>>>>>>> REPLACE"}, VALIDOS, T.esquema_de)
    assert n == "aplicar_parche" and a["ruta"] == "a.js"


def test_alias_json_compartido_con_avatar():
    d = json.loads((RAIZ / "noviq" / "experto" / "alias.json").read_text(encoding="utf-8"))
    for herramienta in d["herramientas"]:
        assert herramienta in VALIDOS, herramienta  # todas las herramientas destino existen


# ─────────────── rutas ───────────────
def test_rutas_solo_nombre(proyecto):
    root, ctx = proyecto
    p, nota, _ = RT.sanar("jugador.js", ctx.cwd, [], "archivo")
    assert p == root / "src" / "js" / "jugador.js" and nota


def test_rutas_otro_usuario(proyecto):
    root, ctx = proyecto
    falsa = f"/home/otra/Documents/Noviq_Proyectos/{root.name}/src/js/jugador.js"
    p, _, _ = RT.sanar(falsa, ctx.cwd, [T.projects_root()], "archivo")
    assert p == root / "src" / "js" / "jugador.js"


def test_rutas_varias_candidatas_no_adivina(proyecto):
    root, ctx = proyecto
    (root / "otro").mkdir()
    (root / "otro" / "jugador.js").write_text("x", encoding="utf-8")
    p, _, cands = RT.sanar("jugador.js", ctx.cwd, [], "archivo")
    assert p is None and len(cands) == 2


def test_rutas_existente_sin_nota(proyecto):
    root, ctx = proyecto
    p, nota, _ = RT.sanar("calc.py", ctx.cwd, [], "archivo")
    assert p == root / "calc.py" and nota == ""


def test_herramienta_con_ruta_corregida(proyecto):
    root, ctx = proyecto
    r = T.FUNCS["leer_archivo"]({"ruta": "jugador.js"}, ctx)
    assert "[Ruta corregida" in r and "this.vida = 3;" in r


def test_buscar_en_archivo_inexistente_ya_no_engana(proyecto):
    root, ctx = proyecto
    r = T.FUNCS["buscar_en_archivos"]({"regex": "vida", "ruta": "jugador.js"}, ctx)
    assert "this.vida" in r


# ─────────────── edición ───────────────
REP = "function a() {\n  hacer();\n}\nfunction b() {\n  hacer();\n}\n"


def test_edicion_repetido_con_linea():
    t, n, err, nota = ED.aplicar(REP, "  hacer();", "  hacerB();", rango=(5, 5))
    assert err is None and t.split("\n")[4] == "  hacerB();" and t.count("hacer();") == 1


def test_edicion_repetido_con_ocurrencia():
    t, n, err, _ = ED.aplicar(REP, "  hacer();", "  hacerB();", ocurrencia=2)
    assert err is None and t.split("\n")[4] == "  hacerB();"


def test_edicion_repetido_sin_pista_explica():
    _, _, err, _ = ED.aplicar(REP, "  hacer();", "  x();")
    assert "aparece 2 veces" in err and "ocurrencia=N" in err and "línea 2" in err and "línea 5" in err


def test_edicion_unica_sin_cambios_de_comportamiento():
    t, n, err, _ = ED.aplicar("a = 1\nb = 2\n", "b = 2", "b = 3")
    assert err is None and t == "a = 1\nb = 3\n"


def test_editar_archivo_ocurrencia(proyecto):
    root, ctx = proyecto
    (root / "dup.js").write_text(REP, encoding="utf-8")
    r = T.FUNCS["editar_archivo"]({"ruta": "dup.js", "texto_anterior": "  hacer();", "texto_nuevo": "  hacerB();", "ocurrencia": 2}, ctx)
    assert not r.startswith("ERROR") and (root / "dup.js").read_text(encoding="utf-8").split("\n")[4] == "  hacerB();"


# ─────────────── búsquedas ───────────────
def test_grep_modos_y_literal(proyecto):
    root, ctx = proyecto
    f = T.FUNCS["buscar_en_archivos"]
    assert "src/js/jugador.js" in f({"regex": "vida", "modo": "archivos"}, ctx).replace("\\", "/")
    assert ": 1" in f({"regex": "vida", "modo": "conteo"}, ctx)
    r = f({"regex": "jump("}, ctx)  # regex mal escrita → literal
    assert "jump()" in r and "texto literal" in r


def test_grep_sin_tildes(proyecto):
    root, ctx = proyecto
    (root / "n.py").write_text("# función principal\n", encoding="utf-8")
    r = T.FUNCS["buscar_en_archivos"]({"regex": "funcion principal"}, ctx)
    assert "n.py:1" in r and "tildes" in r


def test_glob_doble_asterisco(proyecto):
    root, ctx = proyecto
    (root / "src" / "main.js").write_text("x", encoding="utf-8")
    r = T.FUNCS["buscar_archivos"]({"patron": "src/**/*.js"}, ctx).replace("\\", "/")
    assert "src/main.js" in r and "src/js/jugador.js" in r


def test_explorar_codigo_espanol_ingles(proyecto):
    root, ctx = proyecto
    r = T.FUNCS["explorar_codigo"]({"pregunta": "¿dónde está el salto del jugador?"}, ctx)
    assert "src/js/jugador.js" in r.replace("\\", "/") and "jump" in r


def test_explorar_salta_librerias(tmp_path):
    (tmp_path / "lib").mkdir()
    (tmp_path / "lib" / "three.min.js").write_text("function jump(){}" * 10, encoding="utf-8")
    (tmp_path / "juego.js").write_text("function saltar(){ jugador.vy = -5 }\n", encoding="utf-8")
    r = X.explorar("salto", tmp_path)
    assert "juego.js" in r and "three.min.js" not in r


def test_leer_linea_minificada(proyecto):
    root, ctx = proyecto
    (root / "min.js").write_text("x" * 10000 + "\n", encoding="utf-8")
    r = T.FUNCS["leer_archivo"]({"ruta": "min.js"}, ctx)
    assert "recortada" in r and len(r) < 4000


def test_crear_carpeta(proyecto):
    root, ctx = proyecto
    assert "creada" in T.FUNCS["crear_carpeta"]({"ruta": "a/b"}, ctx) and (root / "a" / "b").is_dir()


# ─────────────── parches ───────────────
def test_parche_search_replace(proyecto):
    root, ctx = proyecto
    r = T.FUNCS["aplicar_parche"]({"ruta": "calc.py", "parche": "<<<<<<< SEARCH\n    return a + b\n=======\n    return a * b\n>>>>>>> REPLACE"}, ctx)
    assert not r.startswith("ERROR") and "a * b" in (root / "calc.py").read_text(encoding="utf-8")


def test_parche_unificado_y_codex():
    ops = PA.convertir("--- a/x.py\n+++ b/x.py\n@@ -1,2 +1,2 @@\n def f():\n-    return 1\n+    return 2\n")
    assert ops[0]["ruta"] == "x.py" and ops[0]["ediciones"][0]["texto_nuevo"] == "def f():\n    return 2"
    ops = PA.convertir("*** Begin Patch\n*** Add File: n.txt\n+hola\n*** Update File: x.py\n@@\n-a\n+b\n*** Delete File: z\n*** End Patch")
    assert [o["op"] for o in ops] == ["crear", "editar", "borrar"] and ops[0]["contenido"] == "hola\n"


def test_parche_no_borra(proyecto):
    root, ctx = proyecto
    r = T.FUNCS["aplicar_parche"]({"parche": "*** Begin Patch\n*** Delete File: calc.py\n*** End Patch"}, ctx)
    assert (root / "calc.py").exists() and "No borré" in r


# ─────────────── memoria ───────────────
def test_memoria_sin_repetir_y_actualiza(tmp_path):
    f = MEM.MEMORY_FILE
    f.write_text("", encoding="utf-8")
    assert MEM.agregar("Gabriel usa Python 3.13 en sus programas", "usuario")[1] == "nueva"
    assert MEM.agregar("Gabriel usa Python 3.13 en sus programas.", "usuario")[1] == "igual"
    assert MEM.agregar("Gabriel usa Python 3.13 en todos sus programas", "usuario")[1] == "actualizada"
    assert f.read_text(encoding="utf-8").count("Python 3.13") == 1


def test_memoria_limpiar_bloque_repetido():
    bloque = "RESUMEN tetris:\n- Canvas HTML5\n- Bloques que caen\n- Controles WASD\nEjecutar: index.html\n"
    MEM.MEMORY_FILE.write_text(bloque + "- " + bloque + "- otra nota\n", encoding="utf-8")
    assert MEM.limpiar(MEM.MEMORY_FILE) >= 4
    t = MEM.MEMORY_FILE.read_text(encoding="utf-8")
    assert t.count("Controles WASD") == 1 and "otra nota" in t


def test_memoria_proyecto_sin_proyecto_no_falla():
    ctx = T.ToolContext({"id": "x", "project": None, "messages": [], "display": [], "tasks": []}, lambda *a: None, threading.Event())
    r = MEM.tool({"accion": "agregar", "alcance": "proyecto", "texto": "se ejecuta con jugar.bat"}, ctx)
    assert not r.startswith("ERROR") and "memoria general" in r


def test_memoria_ajustes_y_buscar():
    ctx = T.ToolContext({"id": "x", "project": None, "messages": [], "display": [], "tasks": []}, lambda *a: None, threading.Event())
    r = MEM.tool({"accion": "agregar", "texto": "gemini-2.5-pro no tiene crédito"}, ctx)
    assert "ajustes" in r
    assert "gemini" in MEM.tool({"accion": "buscar", "texto": "gemini"}, ctx)


def test_memoria_rechaza_claves():
    ctx = T.ToolContext({"id": "x", "project": None, "messages": [], "display": [], "tasks": []}, lambda *a: None, threading.Event())
    r = MEM.tool({"accion": "agregar", "texto": "mi clave es nvapi-ABCDEFGHIJKLMNOPQRSTUV123"}, ctx)
    assert r.startswith("ERROR")
    todo = "".join(f.read_text(encoding="utf-8") for f in (MEM.MEMORY_FILE, MEM.AJUSTES_FILE) if f.exists())
    assert "nvapi-ABCDEFGHIJKLMNOPQRSTUV123" not in todo


# ─────────────── parser de llamadas escritas como texto ───────────────
def test_parser_texto_con_nombres_ajenos():
    from noviq.providers import parse_text_tool_calls
    t = "<tool_call>\n<function=read_file>\n<parameter=path>\na.js\n</parameter>\n</function>\n</tool_call>"
    calls = parse_text_tool_calls(t, VALIDOS)
    assert calls and calls[0]["function"]["name"] == "leer_archivo"
    calls = parse_text_tool_calls("[TOOL_REQUEST]\n{\"name\": \"Edit\", \"arguments\": {\"file_path\": \"a\"}}\n[END_TOOL_REQUEST]", VALIDOS)
    assert calls and calls[0]["function"]["name"] == "editar_archivo"


# ─────────────── seguridad ───────────────
def test_boveda_bloqueada_en_procesos_auxiliares(monkeypatch):
    from noviq import vault
    monkeypatch.setenv("NOVIQ_SIN_BOVEDA", "1")
    assert vault.load() == {}
    with pytest.raises(PermissionError):
        vault.save({"nvidia": ["x"]})
    with pytest.raises(PermissionError):
        vault._decrypt("OBF:AAAA")
