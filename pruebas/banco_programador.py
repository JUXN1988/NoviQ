# -*- coding: utf-8 -*-
"""🧪 Banco del PROGRAMADOR EFICIENTE: tareas de programación SIMULADAS con una «IA débil».

Qué mide: si el agente de Noviq (el bucle real `run_agent`, con su modo compacto para IAs locales) logra terminar
tareas cuando la IA comete los errores típicos de los modelos pequeños que se vieron en los registros reales de
Gabriel (datos/registro.log y conversaciones del 27-09 al 10-10-2026):
  · nombres de herramientas de otros programas (Read, Edit, Grep, Glob, Bash, TodoWrite, read_file, mkdir…)
  · argumentos en inglés (file_path, old_string, pattern, command…)
  · rutas equivocadas (solo el nombre del archivo, otra carpeta de usuario, la carpeta del proyecto repetida)
  · fragmentos repetidos al editar (con la línea indicada), regex sin escapar, búsquedas en español sin tildes
  · llamadas escritas como TEXTO en formatos Qwen/Hermes, volver a ejecutar la prueba después de corregir
  · memoria de proyecto sin proyecto activo, la misma nota guardada dos veces
La «IA débil» es un guion reactivo: sigue un plan con esos errores y, si una herramienta falla, solo reintenta
cuando el mensaje de error le dice EXACTAMENTE qué hacer (como haría un modelo pequeño). No se usa internet.

Uso:   python pruebas/banco_programador.py            (todas las tareas)
       python pruebas/banco_programador.py -v         (con detalle de cada paso)
       python pruebas/banco_programador.py -k memoria (solo las tareas cuyo id contiene «memoria»)
Escribe el resultado en pruebas/resultados/banco_programador_<fecha>.json y .md
"""
import argparse
import difflib
import json
import os
import re
import shutil
import sys
import tempfile
import threading
import time
import uuid
from datetime import datetime
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

RAIZ = Path(__file__).resolve().parent.parent
TMP = Path(tempfile.mkdtemp(prefix="noviq_banco_"))
os.environ["NOVIQ_DATOS"] = str(TMP / "datos")
os.environ.setdefault("PYTHONUTF8", "1")
sys.path.insert(0, str(RAIZ))
PROYECTOS = TMP / "Noviq_Proyectos"
PROYECTOS.mkdir(parents=True, exist_ok=True)
VERBOSE = False


# ════════════════════════════ La «IA débil» (servidor compatible con OpenAI) ════════════════════════════
class Paso:
    def __init__(self, nombre, args, formato="nativo", critico=True, pista_linea=None, fin=None, si_no_existe=None):
        self.nombre, self.args, self.formato, self.critico, self.pista_linea, self.fin = nombre, args, formato, critico, pista_linea, fin
        self.si_no_existe = si_no_existe  # otro paso si el programa no ofrece esta herramienta (la IA usa lo que ve)


def C(nombre, args, **kw):
    return Paso(nombre, args, **kw)


def FIN(texto="Listo, terminé."):
    return Paso(None, None, fin=texto)


class Escenario:
    def __init__(self, id, pedido, archivos, pasos, verificar, proyecto=True, desc=""):
        self.id, self.pedido, self.archivos, self.pasos, self.verificar = id, pedido, archivos, pasos, verificar
        self.proyecto, self.desc = proyecto, desc or pedido
        self.i, self.reintento, self.ultimo, self.resultados, self.turnos, self.abortado = 0, 0, None, [], 0, False
        self.llamadas = 0

    # ── la IA decide su siguiente mensaje a partir del último resultado ──
    def responder(self, payload):
        self.turnos += 1
        if self.turnos > 40:
            return {"content": "No pude terminar."}
        msgs = payload.get("messages") or []
        ultimo_asist = max((k for k, m in enumerate(msgs) if m.get("role") == "assistant"), default=-1)
        res = [m for m in msgs[ultimo_asist + 1:] if m.get("role") == "tool"]
        texto_res = _texto(res[-1].get("content")) if res else None
        if texto_res is None and ultimo_asist >= 0:
            # en modo texto el resultado llega como mensaje de usuario con <tool_result>
            u = [m for m in msgs[ultimo_asist + 1:] if m.get("role") == "user" and "<tool_result" in _texto(m.get("content"))]
            texto_res = _texto(u[-1].get("content")) if u else None
        if self.ultimo is not None:
            paso = self.ultimo
            if texto_res is None:
                # el agente no reconoció la llamada (no hubo resultado): la IA pequeña insiste igual
                self.resultados.append((paso.nombre, "(sin resultado: la llamada no se reconoció)"))
                return self._emitir(paso, self._args_de(paso))
            self.resultados.append((paso.nombre, texto_res[:300]))
            if VERBOSE:
                print(f"      ← {paso.nombre}: {texto_res[:160].replace(chr(10), ' ')}")
            if _es_error(texto_res):
                otro = self._reintento(paso, texto_res)
                if otro is not None:
                    return otro
                if paso.critico:
                    self.abortado = True
                    self.ultimo = None
                    return {"content": "No pude completar la tarea: la herramienta falló."}
            self.i += 1
            self.reintento = 0
            self.ultimo = None
        if self.abortado:
            return {"content": "No pude completar la tarea."}
        if self.i >= len(self.pasos):
            return {"content": "Listo, terminé."}
        paso = self.pasos[self.i]
        if paso.fin is not None:
            self.i += 1
            return {"content": paso.fin}
        ofrecidas = {t.get("function", {}).get("name") for t in payload.get("tools") or []}
        if paso.si_no_existe is not None and ofrecidas and paso.nombre not in ofrecidas:
            paso = self.pasos[self.i] = paso.si_no_existe
        return self._emitir(paso, self._args_de(paso), payload)

    def _args_de(self, paso):
        return paso.args(self) if callable(paso.args) else dict(paso.args)

    def _emitir(self, paso, args, payload=None, nombre=None):
        self.ultimo = paso
        self.llamadas += 1
        nombre = nombre or paso.nombre
        self._args_actuales = args
        if VERBOSE:
            print(f"      → {nombre} {json.dumps(args, ensure_ascii=False)[:150]}")
        if paso.formato == "qwen":
            ps = "".join(f"<parameter={k}>\n{v if isinstance(v, str) else json.dumps(v, ensure_ascii=False)}\n</parameter>\n" for k, v in args.items())
            return {"content": f"Voy a usar la herramienta.\n<tool_call>\n<function={nombre}>\n{ps}</function>\n</tool_call>"}
        if paso.formato == "hermes":
            return {"content": "<tool_call>\n" + json.dumps({"name": nombre, "arguments": args}, ensure_ascii=False) + "\n</tool_call>"}
        if paso.formato == "lmstudio":
            return {"content": "[TOOL_REQUEST]\n" + json.dumps({"name": nombre, "arguments": args}, ensure_ascii=False) + "\n[END_TOOL_REQUEST]"}
        if paso.formato == "bloque":
            return {"content": "```json\n" + json.dumps({"tool": nombre, "args": args}, ensure_ascii=False) + "\n```"}
        return {"tool_calls": [{"id": "call_" + uuid.uuid4().hex[:8], "type": "function",
                                "function": {"name": nombre, "arguments": json.dumps(args, ensure_ascii=False)}}]}

    def _reintento(self, paso, err):
        """Una IA pequeña solo corrige si el error le dice EXACTAMENTE qué hacer (y como mucho 2 veces)."""
        if self.reintento >= 2:
            return None
        self.reintento += 1
        args = dict(self._args_actuales)
        m = re.search(r"Disponibles: ([^\n]+)", err)
        if "desconocida" in err and m:
            disp = [x.strip() for x in m.group(1).split(",")]
            cerca = difflib.get_close_matches(str(paso.nombre).lower(), disp, n=1, cutoff=0.45)
            if cerca:
                return self._emitir(paso, args, nombre=cerca[0])
            return None
        m = re.search(r"desde_linea=(\d+), hasta_linea=(\d+)", err)
        if m and any(k in args for k in ("old_string", "old_str", "texto_anterior", "edits", "ediciones")):
            nuevo = args.get("new_string", args.get("new_str", args.get("texto_nuevo", "")))
            ruta = {k: v for k, v in args.items() if k in ("file_path", "path", "ruta")}
            return self._emitir(paso, dict(ruta, desde_linea=int(m.group(1)), hasta_linea=int(m.group(2)), texto_nuevo=nuevo))
        if re.search(r"aparece \d+ veces", err) and paso.pista_linea:
            args.update({"desde_linea": paso.pista_linea, "hasta_linea": paso.pista_linea})
            return self._emitir(paso, args)
        return None


def _texto(c):
    if isinstance(c, list):
        return " ".join(x.get("text", "") for x in c if isinstance(x, dict))
    return str(c or "")


def _es_error(t):
    t = t.lstrip()
    return bool(re.match(r"(ERROR|Error|Sin coincidencias|No encontr|No existe)", t)) or "herramienta desconocida" in t[:200] \
        or "ya hiciste exactamente esta acción" in t[:300] or t.startswith("(sin resultado")


class Servidor:
    def __init__(self):
        self.escenarios = {}
        srv = self

        class H(BaseHTTPRequestHandler):
            def log_message(self, *a):
                pass

            def do_GET(self):
                body = json.dumps({"data": [{"id": "debil-4b", "object": "model"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

            def do_POST(self):
                n = int(self.headers.get("Content-Length") or 0)
                payload = json.loads(self.rfile.read(n) or b"{}")
                r = srv.responder(payload)
                if payload.get("stream"):
                    self.send_response(200)
                    self.send_header("Content-Type", "text/event-stream")
                    self.end_headers()
                    delta = {"role": "assistant"}
                    if r.get("content"):
                        delta["content"] = r["content"]
                    if r.get("tool_calls"):
                        delta["tool_calls"] = [dict(tc, index=i) for i, tc in enumerate(r["tool_calls"])]
                    fin = "tool_calls" if r.get("tool_calls") else "stop"
                    for ch in ({"choices": [{"index": 0, "delta": delta}]}, {"choices": [{"index": 0, "delta": {}, "finish_reason": fin}]}):
                        self.wfile.write(b"data: " + json.dumps(ch, ensure_ascii=False).encode() + b"\n\n")
                    self.wfile.write(b"data: [DONE]\n\n")
                    return
                body = json.dumps({"choices": [{"index": 0, "message": {"role": "assistant", "content": r.get("content") or "",
                                                                         "tool_calls": r.get("tool_calls")},
                                                "finish_reason": "stop"}]}).encode()
                self.send_response(200)
                self.send_header("Content-Type", "application/json")
                self.send_header("Content-Length", str(len(body)))
                self.end_headers()
                self.wfile.write(body)

        self.httpd = ThreadingHTTPServer(("127.0.0.1", 0), H)
        self.puerto = self.httpd.server_address[1]
        threading.Thread(target=self.httpd.serve_forever, daemon=True).start()

    def responder(self, payload):
        todo = json.dumps(payload.get("messages") or [], ensure_ascii=False)
        m = re.search(r"\[ESC:([\w-]+)\]", todo)
        eid = m.group(1) if m else next((k for k in self.escenarios if re.search(r"[\\/]" + re.escape(k) + r"\b", todo)), None)
        if not eid or eid not in self.escenarios:
            return {"content": "ok"}  # peticiones auxiliares (no son del agente)
        if not payload.get("tools") and "<tool_call>" not in json.dumps(payload.get("messages")[:1], ensure_ascii=False) \
                and "HERRAMIENTAS" not in _texto((payload.get("messages") or [{}])[0].get("content")):
            return {"content": "ok"}
        return self.escenarios[eid].responder(payload)


# ════════════════════════════ Las tareas ════════════════════════════
def L(root, rel):
    p = root / rel
    return p.read_text(encoding="utf-8") if p.exists() else ""


def R(patron, texto):
    return bool(re.search(patron, texto or ""))


def _py_ok(root, codigo):
    """Comprueba el COMPORTAMIENTO (no el texto exacto): sirve para medir modelos reales que arreglan a su manera."""
    import subprocess
    try:
        r = subprocess.run([sys.executable, "-c", codigo], cwd=str(root), capture_output=True, timeout=30)
        return r.returncode == 0
    except Exception:
        return False


def _mem_todas():
    out = ""
    datos = Path(os.environ["NOVIQ_DATOS"])
    for f in list(datos.glob("memoria*.md")) + list(PROYECTOS.glob("*/.noviq/memoria.md")):
        out += f.read_text(encoding="utf-8") + "\n"
    return out


MOTOR = """// motor del juego
const NK = {};
NK.velocidad = 5;
function iniciar(lienzo) {
  NK.lienzo = lienzo;
  return true;
}
function saltar(jugador) {
  if (jugador.enSuelo) {
    jugador.vy = -12;
  }
}
module.exports = { NK, iniciar, saltar };
"""
JUGADOR = """class Jugador {
  constructor() {
    this.x = 0;
    this.vida = 3;
  }
  jump() {
    // impulso hacia arriba al pulsar espacio
    this.vy = -9;
  }
  mover(dx) {
    this.x += dx;
  }
}
module.exports = Jugador;
"""
CALC = '''def sumar(a, b):
    return a + b


def promedio(lista):
    return sum(lista) / len(lista)


if __name__ == "__main__":
    print("promedio:", promedio([]))
'''
REPETIDO = """function a() {
  if (x) {
    hacer();
  }
}
function b() {
  if (x) {
    hacer();
  }
}
"""
CONFIG_JS = """const datos = [
  {
    "tipo": "valla",
    "modelo": "valla_4",
    "cantidad": 4
  },
  {
    "tipo": "roca",
    "modelo": "roca_2",
    "cantidad": 6
  }
];
module.exports = datos;
"""


def escenarios():
    E = []
    # 1-3 · herramientas y argumentos con nombres de Claude Code (los modelos «distill» los usan)
    E.append(Escenario("claude-read-edit-nombre", "Cambia la velocidad inicial del motor a 8.", {"src/js/motor.js": MOTOR},
                       [C("Read", {"file_path": "motor.js"}),
                        C("Edit", {"file_path": "motor.js", "old_string": "NK.velocidad = 5;", "new_string": "NK.velocidad = 8;"}),
                        FIN()],
                       lambda r: R(r"NK\.velocidad\s*=\s*8\b", L(r, "src/js/motor.js")),
                       desc="Read/Edit estilo Claude con solo el nombre del archivo (está en src/js/)"))
    E.append(Escenario("claude-multiedit", "En jugador.js cambia la vida a 5 y el impulso a -10.", {"jugador.js": JUGADOR},
                       [C("MultiEdit", {"file_path": "jugador.js", "edits": [
                           {"old_string": "this.vida = 3;", "new_string": "this.vida = 5;"},
                           {"old_string": "this.vy = -9;", "new_string": "this.vy = -10;"}]}), FIN()],
                       lambda r: R(r"this\.vida\s*=\s*5\b", L(r, "jugador.js")) and R(r"this\.vy\s*=\s*-10\b", L(r, "jugador.js"))))
    E.append(Escenario("claude-write-mkdir", "Crea utils/formato.py con una función que ponga el texto en mayúsculas.", {},
                       [C("mkdir", {"path": "utils"}),
                        C("Write", {"file_path": "utils/formato.py", "content": "def mayus(t):\n    return t.upper()\n"}), FIN()],
                       lambda r: ".upper()" in L(r, "utils/formato.py")))
    E.append(Escenario("str-replace-editor", "En calc.py cambia sumar para que redondee el resultado.", {"calc.py": CALC},
                       [C("str_replace_based_edit_tool", {"command": "view", "path": "calc.py"}),
                        C("str_replace_based_edit_tool", {"command": "str_replace", "path": "calc.py", "old_str": "    return a + b",
                                                          "new_str": "    return round(a + b, 2)"}), FIN()],
                       lambda r: "round(a + b, 2)" in L(r, "calc.py")))
    E.append(Escenario("openai-nombres", "Lee calc.py y agrega una función restar.", {"calc.py": CALC},
                       [C("read_file", {"path": "calc.py"}),
                        C("edit_file", {"path": "calc.py", "old_str": "def promedio(lista):",
                                        "new_str": "def restar(a, b):\n    return a - b\n\n\ndef promedio(lista):"}), FIN()],
                       lambda r: "def restar" in L(r, "calc.py")))
    E.append(Escenario("args-ingles-en-noviq", "En calc.py cambia sumar por multiplicar.", {"calc.py": CALC},
                       [C("editar_archivo", {"path": "calc.py", "old_string": "return a + b", "new_string": "return a * b"}), FIN()],
                       lambda r: "return a * b" in L(r, "calc.py")))
    E.append(Escenario("nombres-espanol-sueltos", "Crea notas.txt con la palabra hola.", {},
                       [C("crear_archivo", {"archivo": "notas.txt", "texto": "hola\n"}), FIN()],
                       lambda r: L(r, "notas.txt").strip() == "hola"))
    # 4 · rutas equivocadas
    E.append(Escenario("ruta-otro-usuario", "Cambia la vida del jugador a 4.", {"src/jugador.js": JUGADOR},
                       [C("leer_archivo", lambda e: {"ruta": _ruta_falsa(e, "src/jugador.js")}),
                        C("editar_archivo", lambda e: {"ruta": _ruta_falsa(e, "src/jugador.js"), "texto_anterior": "this.vida = 3;",
                                                       "texto_nuevo": "this.vida = 4;"}), FIN()],
                       lambda r: "this.vida = 4;" in L(r, "src/jugador.js"),
                       desc="ruta absoluta con otra carpeta de usuario (pasó con «C:\\Users\\gclaudio\\…»)"))
    E.append(Escenario("ruta-proyecto-repetido", "Cambia el impulso del salto a -14.", {"src/js/motor.js": MOTOR},
                       [C("editar_archivo", lambda e: {"ruta": f"{e.id}/src/js/motor.js", "texto_anterior": "jugador.vy = -12;",
                                                       "texto_nuevo": "jugador.vy = -14;"}), FIN()],
                       lambda r: R(r"vy\s*=\s*-14\b", L(r, "src/js/motor.js"))))
    E.append(Escenario("buscar-en-archivo-anidado", "¿Qué valor tiene NK.velocidad? Cámbialo a 7.", {"lib/motor3d.js": MOTOR},
                       [C("buscar_en_archivos", {"regex": "NK.velocidad", "ruta": "motor3d.js"}),
                        C("editar_archivo", {"ruta": "lib/motor3d.js", "texto_anterior": "NK.velocidad = 5;", "texto_nuevo": "NK.velocidad = 7;"}),
                        FIN()],
                       lambda r: R(r"NK\.velocidad\s*=\s*7\b", L(r, "lib/motor3d.js")),
                       desc="buscar_en_archivos con ruta=«motor3d.js» cuando está en lib/ (antes: «Sin coincidencias» engañoso)"))
    # 5 · edición
    E.append(Escenario("editar-repetido-con-linea", "En la función b cambia hacer() por hacerB().", {"dup.js": REPETIDO},
                       [C("editar_archivo", {"ruta": "dup.js", "texto_anterior": "    hacer();", "texto_nuevo": "    hacerB();",
                                             "desde_linea": 8, "hasta_linea": 8}), FIN()],
                       lambda r: L(r, "dup.js").count("hacer();") == 1 and L(r, "dup.js").splitlines()[7].strip() == "hacerB();",
                       desc="texto repetido 2 veces + la línea indicada (antes fallaba aunque la IA daba la línea)"))
    E.append(Escenario("editar-repetido-ocurrencia", "En la función b cambia hacer() por hacerB().", {"dup.js": REPETIDO},
                       [C("Edit", {"file_path": "dup.js", "old_string": "    hacer();", "new_string": "    hacerB();"}, pista_linea=8), FIN()],
                       lambda r: L(r, "dup.js").splitlines()[7].strip() == "hacerB();" and L(r, "dup.js").count("hacer();") == 1))
    E.append(Escenario("editar-numeros-copiados", "Cambia el promedio para que devuelva 0 con lista vacía.", {"calc.py": CALC},
                       [C("editar_archivo", {"ruta": "calc.py", "texto_anterior": "     6\t    return sum(lista) / len(lista)",
                                             "texto_nuevo": "     6\t    return sum(lista) / len(lista) if lista else 0"}), FIN()],
                       lambda r: "if lista else 0" in L(r, "calc.py")))
    E.append(Escenario("editar-sangria", "Cambia mover para que limite x a 100.", {"jugador.js": JUGADOR},
                       [C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "mover(dx) {\nthis.x += dx;\n}",
                                             "texto_nuevo": "mover(dx) {\n  this.x = Math.min(100, this.x + dx);\n}"}), FIN()],
                       lambda r: "Math.min(100" in L(r, "jugador.js")))
    E.append(Escenario("editar-parecido-97", "Cambia la cantidad de vallas a 5.", {"config.js": CONFIG_JS},
                       [C("editar_archivo", {"ruta": "config.js", "texto_anterior": '  {\n    "tipo": "valla",\n    "modelo": "valla_4",\n    "cantidad": 4,\n  },',
                                             "texto_nuevo": '  {\n    "tipo": "valla",\n    "modelo": "valla_4",\n    "cantidad": 5\n  },'}), FIN()],
                       lambda r: '"cantidad": 5' in L(r, "config.js") and '"cantidad": 6' in L(r, "config.js")))
    # 6 · el ciclo editar → probar → corregir → probar (antes la 3.ª prueba se bloqueaba como «bucle»)
    E.append(Escenario("ciclo-probar-corregir", "Arregla calc.py: falla con lista vacía. Pruébalo.", {"calc.py": CALC},
                       [C("ejecutar_python", {"codigo": "import runpy; runpy.run_path('calc.py', run_name='__main__')", "explicacion": "probar"}, critico=False),
                        C("editar_archivo", {"ruta": "calc.py", "texto_anterior": "    return sum(lista) / len(lista)",
                                             "texto_nuevo": "    return sum(lista) / len(lista) if lista else None"}),
                        C("ejecutar_python", {"codigo": "import runpy; runpy.run_path('calc.py', run_name='__main__')", "explicacion": "probar"}),
                        C("editar_archivo", {"ruta": "calc.py", "texto_anterior": "if lista else None", "texto_nuevo": "if lista else 0"}),
                        C("ejecutar_python", {"codigo": "import runpy; runpy.run_path('calc.py', run_name='__main__')", "explicacion": "probar"}),
                        FIN()],
                       lambda r: _py_ok(r, "import calc; assert calc.promedio([2, 4]) == 3; calc.promedio([])"),
                       desc="ejecutar la misma prueba 3 veces con cambios entre medio (antes: «ya hiciste exactamente esta acción»)"))
    E.append(Escenario("bash-claude", "Comprueba que Python funciona.", {},
                       [C("Bash", {"command": "python -c \"print(6*7)\"", "description": "probar python"}), FIN()],
                       lambda r: True, desc="Bash estilo Claude (command/description)"))
    E.append(Escenario("python-arg-code", "Calcula 6*7 y guárdalo en r.txt.", {},
                       [C("ejecutar_python", {"code": "open('r.txt','w').write(str(6*7))", "explicacion": "calcular"}), FIN()],
                       lambda r: L(r, "r.txt") == "42"))
    # 7 · búsquedas
    E.append(Escenario("grep-regex-sin-escapar", "Busca dónde se llama iniciar( y cambia el nombre del parámetro a canvas.", {"motor.js": MOTOR},
                       [C("buscar_en_archivos", {"regex": "iniciar("}),
                        C("editar_archivo", {"ruta": "motor.js", "texto_anterior": "function iniciar(lienzo) {\n  NK.lienzo = lienzo;",
                                             "texto_nuevo": "function iniciar(canvas) {\n  NK.lienzo = canvas;"}), FIN()],
                       lambda r: "function iniciar(canvas)" in L(r, "motor.js")))
    E.append(Escenario("grep-claude-modos", "¿En qué archivos se usa vida? Sube la vida a 9.", {"src/jugador.js": JUGADOR, "src/motor.js": MOTOR},
                       [C("Grep", {"pattern": "vida", "output_mode": "files_with_matches", "path": "."}),
                        C("Edit", {"file_path": "src/jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 9;"}), FIN()],
                       lambda r: "this.vida = 9;" in L(r, "src/jugador.js")))
    E.append(Escenario("grep-sin-tildes", "Busca la función de impulso (comentario «impulso hacia arriba») y cambia -9 por -11.",
                       {"jugador.js": JUGADOR.replace("impulso hacia arriba", "impulsó hacia arriba")},
                       [C("buscar_en_archivos", {"regex": "impulso hacia arriba"}),
                        C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "this.vy = -9;", "texto_nuevo": "this.vy = -11;"}), FIN()],
                       lambda r: R(r"this\.vy\s*=\s*-11\b", L(r, "jugador.js"))))
    E.append(Escenario("glob-doble-asterisco", "Busca los .js de src y cambia la vida a 2.", {"src/jugador.js": JUGADOR},
                       [C("Glob", {"pattern": "src/**/*.js"}),
                        C("Edit", lambda e: {"file_path": _primer_archivo(e), "old_string": "this.vida = 3;", "new_string": "this.vida = 2;"}),
                        FIN()],
                       lambda r: "this.vida = 2;" in L(r, "src/jugador.js"),
                       desc="Glob «src/**/*.js» con el archivo directo en src/ (antes no lo encontraba)"))
    E.append(Escenario("concepto-en-espanol", "¿Dónde está el salto del jugador? Haz el salto más alto (-13).", {"src/jugador.js": JUGADOR},
                       [C("explorar_codigo", {"pregunta": "¿dónde se controla el salto del jugador?"},
                          si_no_existe=C("buscar_en_archivos", {"regex": "salto"})),
                        C("editar_archivo", lambda e: {"ruta": "src/jugador.js", "texto_anterior": "this.vy = -9;", "texto_nuevo": "this.vy = -13;"}),
                        FIN()],
                       lambda r: R(r"this\.vy\s*=\s*-13\b", L(r, "src/jugador.js")),
                       desc="pregunta en español, código en inglés (jump): la IA pequeña busca «salto»"))
    # 8 · llamadas escritas como texto (modelos locales)
    E.append(Escenario("texto-qwen-ingles", "Cambia la vida a 6.", {"jugador.js": JUGADOR},
                       [C("read_file", {"path": "jugador.js"}, formato="qwen"),
                        C("str_replace", {"path": "jugador.js", "old_str": "this.vida = 3;", "new_str": "this.vida = 6;"}, formato="qwen"),
                        FIN()],
                       lambda r: "this.vida = 6;" in L(r, "jugador.js")))
    E.append(Escenario("texto-hermes-noviq", "Cambia la vida a 7.", {"jugador.js": JUGADOR},
                       [C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "this.vida = 3;", "texto_nuevo": "this.vida = 7;"}, formato="hermes"),
                        FIN()],
                       lambda r: "this.vida = 7;" in L(r, "jugador.js"), desc="control: formato que ya funcionaba"))
    E.append(Escenario("texto-bloque-json", "Cambia la vida a 8.", {"jugador.js": JUGADOR},
                       [C("Edit", {"file_path": "jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 8;"}, formato="bloque"),
                        FIN()],
                       lambda r: "this.vida = 8;" in L(r, "jugador.js")))
    # 9 · tareas y memoria
    E.append(Escenario("todowrite-claude", "Planifica: 1) leer 2) cambiar 3) probar.", {"calc.py": CALC},
                       [C("TodoWrite", {"todos": [{"content": "Leer calc.py", "status": "completed", "activeForm": "Leyendo"},
                                                 {"content": "Cambiar promedio", "status": "in_progress", "activeForm": "Cambiando"},
                                                 {"content": "Probar", "status": "pending", "activeForm": "Probando"}]}), FIN()],
                       lambda r: True, desc="TodoWrite estilo Claude (content/status)"))
    E.append(Escenario("memoria-sin-proyecto", "Recuerda que el juego se ejecuta con jugar.bat.", {},
                       [C("memoria", {"accion": "agregar", "alcance": "proyecto", "texto": "El juego se ejecuta con jugar.bat"}), FIN()],
                       lambda r: "jugar.bat" in _mem_todas(), proyecto=False,
                       desc="memoria de proyecto sin proyecto activo (pasó 2 veces en los registros)"))
    E.append(Escenario("memoria-sin-repetir", "Recuerda que prefiero Python 3.13.", {},
                       [C("memoria", {"accion": "agregar", "alcance": "usuario", "texto": "Gabriel prefiere Python 3.13 para sus programas"}),
                        C("memoria", {"accion": "agregar", "alcance": "usuario", "texto": "Gabriel prefiere Python 3.13 para sus programas."}), FIN()],
                       lambda r: _mem_todas().lower().count("prefiere python 3.13") == 1, proyecto=False,
                       desc="la misma nota dos veces (la memoria general tenía el resumen del Tetris repetido)"))
    # 10 · controles que ya funcionaban (no deben romperse)
    E.append(Escenario("control-noviq-normal", "Cambia la vida a 1.", {"jugador.js": JUGADOR},
                       [C("leer_archivo", {"ruta": "jugador.js", "desde_linea": 1, "hasta_linea": 6}),
                        C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "this.vida = 3;", "texto_nuevo": "this.vida = 1;"}), FIN()],
                       lambda r: "this.vida = 1;" in L(r, "jugador.js"), desc="control"))
    E.append(Escenario("control-escribir", "Crea index.html.", {},
                       [C("escribir_archivo", {"ruta": "index.html", "contenido": "<!doctype html>\n<title>Hola</title>\n<p>Hola</p>\n"}), FIN()],
                       lambda r: "<" in L(r, "index.html") and "html" in L(r, "index.html").lower(), desc="control"))
    E.append(Escenario("control-rango", "Reemplaza la línea 3 de calc.py.", {"calc.py": CALC},
                       [C("editar_archivo", {"ruta": "calc.py", "desde_linea": 2, "hasta_linea": 2, "texto_nuevo": "    return (a + b)"}), FIN()],
                       lambda r: "return (a + b)" in L(r, "calc.py"), desc="control"))
    return E


def escenarios_extra():
    """Tareas «de control externo»: se escribieron DESPUÉS de las mejoras y no se usaron para ajustarlas
    (formatos de Cline/Aider/Codex/LM Studio y variantes que no salieron en los registros)."""
    E = []
    E.append(Escenario("x-cline-replace-in-file", "Cambia la vida a 12.", {"jugador.js": JUGADOR},
                       [C("replace_in_file", {"path": "jugador.js", "diff": "<<<<<<< SEARCH\n    this.vida = 3;\n=======\n    this.vida = 12;\n>>>>>>> REPLACE"}), FIN()],
                       lambda r: "this.vida = 12;" in L(r, "jugador.js"), desc="Cline: bloques SEARCH/REPLACE"))
    E.append(Escenario("x-cline-write-to-file", "Crea a.txt con hola.", {},
                       [C("write_to_file", {"path": "a.txt", "content": "hola"}), FIN()], lambda r: L(r, "a.txt") == "hola"))
    E.append(Escenario("x-cline-list-files", "Lista los archivos y cambia la vida a 13.", {"src/jugador.js": JUGADOR},
                       [C("list_files", {"path": ".", "recursive": True}),
                        C("replace_in_file", {"path": "src/jugador.js", "diff": "<<<<<<< SEARCH\nthis.vida = 3;\n=======\nthis.vida = 13;\n>>>>>>> REPLACE"}), FIN()],
                       lambda r: "this.vida = 13;" in L(r, "src/jugador.js")))
    E.append(Escenario("x-cline-execute", "Ejecuta python y escribe 5 en n.txt.", {},
                       [C("execute_command", {"command": "python -c \"open('n.txt','w').write('5')\"", "requires_approval": False}), FIN()],
                       lambda r: L(r, "n.txt") == "5"))
    E.append(Escenario("x-cline-search-files", "Busca vida en los .js y cámbiala a 14.", {"src/jugador.js": JUGADOR, "notas.md": "vida"},
                       [C("search_files", {"path": ".", "regex": "this\\.vida", "file_pattern": "*.js"}),
                        C("Edit", {"file_path": "src/jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 14;"}), FIN()],
                       lambda r: "this.vida = 14;" in L(r, "src/jugador.js")))
    E.append(Escenario("x-read-start-end", "Lee las líneas 6 a 9 y cambia -9 por -15.", {"jugador.js": JUGADOR},
                       [C("read_file", {"path": "jugador.js", "start_line": 6, "end_line": 9}),
                        C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "this.vy = -9;", "texto_nuevo": "this.vy = -15;"}), FIN()],
                       lambda r: "this.vy = -15;" in L(r, "jugador.js")))
    E.append(Escenario("x-codex-apply-patch", "Cambia la vida a 16.", {"jugador.js": JUGADOR},
                       [C("apply_patch", {"input": "*** Begin Patch\n*** Update File: jugador.js\n@@\n-    this.vida = 3;\n+    this.vida = 16;\n*** End Patch"}), FIN()],
                       lambda r: "this.vida = 16;" in L(r, "jugador.js"), desc="Codex: apply_patch"))
    E.append(Escenario("x-unified-diff", "Cambia la vida a 17.", {"jugador.js": JUGADOR},
                       [C("apply_diff", {"path": "jugador.js", "diff": "--- a/jugador.js\n+++ b/jugador.js\n@@ -3,2 +3,2 @@\n     this.x = 0;\n-    this.vida = 3;\n+    this.vida = 17;\n"}), FIN()],
                       lambda r: "this.vida = 17;" in L(r, "jugador.js"), desc="diff unificado"))
    E.append(Escenario("x-barras-invertidas", "Cambia la vida a 18.", {"src/jugador.js": JUGADOR},
                       [C("editar_archivo", {"ruta": "src\\jugador.js", "texto_anterior": "this.vida = 3;", "texto_nuevo": "this.vida = 18;"}), FIN()],
                       lambda r: "this.vida = 18;" in L(r, "src/jugador.js")))
    E.append(Escenario("x-grep-type", "Busca promedio en los .py y haz que use round.", {"calc.py": CALC, "otro.js": "promedio"},
                       [C("Grep", {"pattern": "def promedio", "type": "py", "-n": True}),
                        C("Edit", {"file_path": "calc.py", "old_string": "return sum(lista) / len(lista)", "new_string": "return round(sum(lista) / len(lista), 2)"}), FIN()],
                       lambda r: "round(sum(lista)" in L(r, "calc.py")))
    E.append(Escenario("x-lmstudio-tool-request", "Cambia la vida a 19.", {"jugador.js": JUGADOR},
                       [C("Edit", {"file_path": "jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 19;"}, formato="lmstudio"), FIN()],
                       lambda r: "this.vida = 19;" in L(r, "jugador.js"), desc="formato [TOOL_REQUEST] de LM Studio"))
    E.append(Escenario("x-memoria-buscar", "¿Qué te dije de mi PC?", {},
                       [C("memoria", {"accion": "agregar", "texto": "La PC de Gabriel tiene una RTX 5060 Ti de 16 GB"}),
                        C("memoria", {"accion": "buscar", "texto": "RTX"}), FIN()],
                       lambda r: True, proyecto=False))
    E.append(Escenario("x-mayusculas-ruta", "Cambia la vida a 20.", {"src/jugador.js": JUGADOR},
                       [C("Read", {"file_path": "SRC/Jugador.js"}),
                        C("Edit", {"file_path": "SRC/Jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 20;"}), FIN()],
                       lambda r: R(r"this\.vida\s*=\s*20\b", L(r, "src/jugador.js")), desc="mayúsculas distintas en la ruta"))
    E.append(Escenario("x-aider-numeros-barra", "Cambia mover para sumar el doble.", {"jugador.js": JUGADOR},
                       [C("editar_archivo", {"ruta": "jugador.js", "texto_anterior": "11| this.x += dx;", "texto_nuevo": "11| this.x += 2 * dx;"}), FIN()],
                       lambda r: "this.x += 2 * dx;" in L(r, "jugador.js")))
    E.append(Escenario("x-espacios-al-final", "Cambia la vida a 21.", {"jugador.js": JUGADOR.replace("this.vida = 3;", "this.vida = 3;   ")},
                       [C("Edit", {"file_path": "jugador.js", "old_string": "    this.vida = 3;\n  }", "new_string": "    this.vida = 21;\n  }"}), FIN()],
                       lambda r: "this.vida = 21;" in L(r, "jugador.js")))
    E.append(Escenario("x-escribir-lista-lineas", "Crea lista.txt.", {},
                       [C("Write", {"file_path": "lista.txt", "content": ["uno", "dos"]}), FIN()],
                       lambda r: L(r, "lista.txt").split() == ["uno", "dos"]))
    return E


def escenarios_ciegos():
    """Tercer grupo, escrito al FINAL y ejecutado UNA sola vez sin ajustar nada (medida honesta de lo que pasará
    con errores que no se vieron antes)."""
    E = []
    E.append(Escenario("c-read-carpeta", "Mira qué hay en src y cambia la vida a 30.", {"src/jugador.js": JUGADOR},
                       [C("Read", {"file_path": "src"}),
                        C("Edit", {"file_path": "src/jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 30;"}), FIN()],
                       lambda r: "this.vida = 30;" in L(r, "src/jugador.js"), desc="Read sobre una carpeta"))
    E.append(Escenario("c-args-mayusculas", "Cambia la vida a 31.", {"jugador.js": JUGADOR},
                       [C("editar_archivo", {"Ruta": "jugador.js", "Texto_Anterior": "this.vida = 3;", "Texto_Nuevo": "this.vida = 31;"}), FIN()],
                       lambda r: "this.vida = 31;" in L(r, "jugador.js"), desc="argumentos con mayúsculas"))
    E.append(Escenario("c-cat-ruta-punto", "Lee y cambia la vida a 32.", {"jugador.js": JUGADOR},
                       [C("cat", {"path": "./jugador.js"}),
                        C("edit_file", {"target_file": "./jugador.js", "old_text": "this.vida = 3;", "new_text": "this.vida = 32;"}), FIN()],
                       lambda r: "this.vida = 32;" in L(r, "jugador.js")))
    E.append(Escenario("c-grep-en-subcarpeta-inexistente", "Busca vida en la carpeta scripts y cámbiala a 33.", {"src/jugador.js": JUGADOR},
                       [C("Grep", {"pattern": "vida", "path": "scripts"}, critico=False),
                        C("Edit", {"file_path": "src/jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 33;"}), FIN()],
                       lambda r: "this.vida = 33;" in L(r, "src/jugador.js"), desc="la carpeta pedida no existe"))
    E.append(Escenario("c-write-sobre-existente-corto", "Reemplaza notas.txt por «adiós».", {"notas.txt": "hola\n"},
                       [C("Write", {"file_path": "notas.txt", "content": "adiós\n"}), FIN()],
                       lambda r: L(r, "notas.txt") == "adiós\n"))
    E.append(Escenario("c-edit-sin-cambios", "Deja la vida en 3 y cambia el impulso a -8.", {"jugador.js": JUGADOR},
                       [C("Edit", {"file_path": "jugador.js", "old_string": "this.vida = 3;", "new_string": "this.vida = 3;"}, critico=False),
                        C("Edit", {"file_path": "jugador.js", "old_string": "this.vy = -9;", "new_string": "this.vy = -8;"}), FIN()],
                       lambda r: "this.vy = -8;" in L(r, "jugador.js")))
    E.append(Escenario("c-insertar-linea", "Agrega un comentario al inicio de calc.py.", {"calc.py": CALC},
                       [C("str_replace_editor", {"command": "insert", "path": "calc.py", "insert_line": 0, "new_str": "# calculadora"}), FIN()],
                       lambda r: L(r, "calc.py").lstrip().startswith("#") and "def sumar" in L(r, "calc.py")))
    E.append(Escenario("c-qwen-parametros-json", "Cambia la vida a 34 (dos ediciones).", {"jugador.js": JUGADOR},
                       [C("MultiEdit", {"file_path": "jugador.js", "edits": [{"old_string": "this.vida = 3;", "new_string": "this.vida = 34;"},
                                                                          {"old_string": "this.x = 0;", "new_string": "this.x = 1;"}]}, formato="qwen"), FIN()],
                       lambda r: "this.vida = 34;" in L(r, "jugador.js") and "this.x = 1;" in L(r, "jugador.js"),
                       desc="lista de ediciones dentro de <parameter> (formato Qwen)"))
    E.append(Escenario("c-memoria-alcance-ingles", "Recuerda que el proyecto usa Three.js r128.", {"index.html": "<p>x</p>"},
                       [C("memory", {"action": "add", "scope": "project", "text": "El proyecto usa Three.js r128"}), FIN()],
                       lambda r: "Three.js r128" in _mem_todas(), desc="memoria con acción/alcance en inglés"))
    E.append(Escenario("c-glob-sin-ruta-relativa", "Encuentra los .py y suma 1 al resultado.", {"app/core/calc.py": CALC},
                       [C("Glob", {"pattern": "**/*.py"}),
                        C("Edit", lambda e: {"file_path": _primer_archivo_ext(e, ".py"), "old_string": "    return a + b", "new_string": "    return a + b + 1"}),
                        FIN()],
                       lambda r: "return a + b + 1" in L(r, "app/core/calc.py")))
    return E


def _primer_archivo_ext(e, ext):
    for nombre, res in reversed(e.resultados):
        for ln in res.splitlines()[1:]:
            ln = ln.strip()
            if ln.endswith(ext):
                return ln
    return "calc" + ext


def _ruta_falsa(e, rel):
    if os.name == "nt":
        return "C:\\Users\\gclaudio\\OneDrive\\Public\\Documents\\" + PROYECTOS.name + "\\" + e.id + "\\" + rel.replace("/", "\\")
    return "/home/gclaudio/Documents/" + PROYECTOS.name + "/" + e.id + "/" + rel


def _primer_archivo(e):
    for nombre, res in reversed(e.resultados):
        if nombre and nombre.lower() == "glob":
            for ln in res.splitlines()[1:]:
                ln = ln.strip()
                if ln.endswith(".js"):
                    return ln
    return "jugador.js"  # no encontró nada: la IA adivina


# ════════════════════════════ Ejecución ════════════════════════════
def preparar_config(puerto):
    datos = Path(os.environ["NOVIQ_DATOS"])
    datos.mkdir(parents=True, exist_ok=True)
    cfg = {"model": "lmstudio::debil-4b", "projects_dir": str(PROYECTOS), "permission_mode": "auto", "tool_mode": "auto",
           "fallback_enabled": False, "fallback_models": [], "vanguardia": {"activo": False, "planificar": False},
           "modelo_cerebro": "", "verificar_modelos": False, "revisar_plan_seg": 0, "diagnostico_auto": False,
           "pruebas_auto": True, "evaluador": {"activo": False, "elegir_al_inicio": "nunca", "min_datos": 6},
           "director": {"activo": False, "max_continuaciones": 0, "max_minutos": 5, "espera_error_seg": 1},
           "escalado": {"activo": False, "umbral": 5, "max_escalados": 0, "permitir_pago": False},
           "entregas": {"auto": False, "max": 3}, "telegram": {"activo": False}, "avatar": {"activo": False},
           "local": {"modo_compacto": "siempre", "max_steps": 40, "pensar": "no"},
           "providers": {"lmstudio": {"name": "LM Studio (local)", "base_url": f"http://127.0.0.1:{puerto}/v1", "enabled": True,
                                      "local": True, "context_chars": 60000},
                         "nvidia": {"enabled": False}, "ollama": {"enabled": False}}}
    (datos / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


REALES = ["claude-read-edit-nombre", "claude-multiedit", "claude-write-mkdir", "openai-nombres", "ruta-proyecto-repetido",
          "buscar-en-archivo-anidado", "editar-repetido-ocurrencia", "ciclo-probar-corregir", "grep-sin-tildes",
          "concepto-en-espanol", "memoria-sin-proyecto", "control-escribir", "x-mayusculas-ruta", "c-insertar-linea"]


def preparar_real(modelo):
    """Modo REAL: usa tu config de Noviq (y tus claves, en este mismo usuario de Windows) con UN modelo, sobre proyectos
    temporales. Mide de verdad cuántas tareas termina ese modelo. No toca tus proyectos ni tus conversaciones."""
    real = RAIZ / "datos"
    datos = Path(os.environ["NOVIQ_DATOS"])
    datos.mkdir(parents=True, exist_ok=True)
    cfg = json.loads((real / "config.json").read_text(encoding="utf-8")) if (real / "config.json").exists() else {}
    cfg.update({"model": modelo, "projects_dir": str(PROYECTOS), "permission_mode": "auto", "fallback_enabled": False,
                "revisar_plan_seg": 0, "diagnostico_auto": False, "verificar_modelos": False, "entregas": {"auto": False, "max": 3},
                "telegram": {"activo": False}, "avatar": dict(cfg.get("avatar") or {}, activo=False)})
    for f in ("claves.vault", "claves.vault.bak"):
        if (real / f).exists():
            shutil.copy2(real / f, datos / f)
    (datos / "config.json").write_text(json.dumps(cfg, ensure_ascii=False, indent=1), encoding="utf-8")


def correr(esc, srv, timeout=90, modelo="lmstudio::debil-4b"):
    from noviq.agent import run_agent
    from noviq.server_state import new_conv
    root = PROYECTOS / esc.id
    if root.exists():
        shutil.rmtree(root)
    root.mkdir(parents=True)
    for rel, txt in esc.archivos.items():
        p = root / rel
        p.parent.mkdir(parents=True, exist_ok=True)
        p.write_text(txt, encoding="utf-8")
    if srv is not None:
        srv.escenarios[esc.id] = esc
    conv = new_conv(uuid.uuid4().hex[:16], project=esc.id if esc.proyecto else None, model=modelo)
    conv["title"] = esc.id
    conv["messages"].append({"role": "user", "content": esc.pedido if srv is None else f"{esc.pedido} [ESC:{esc.id}]"})
    stop = threading.Event()
    t0 = time.time()
    th = threading.Thread(target=run_agent, args=(conv, lambda k, p: None, stop), daemon=True)
    th.start()
    th.join(timeout)
    if th.is_alive():
        stop.set()
        th.join(10)
    ok = False
    try:
        ok = bool(esc.verificar(root if esc.proyecto else (PROYECTOS / "_General")))
    except Exception as e:
        if VERBOSE:
            print("      verificación falló:", e)
    if srv is None:  # modo real: se cuentan las llamadas y errores del agente de verdad
        res_tools = [str(m.get("content", "")) for m in conv.get("messages", []) if m.get("role") == "tool"]
        esc.llamadas = len(res_tools)
        esc.turnos = sum(1 for m in conv.get("messages", []) if m.get("role") == "assistant")
        esc.resultados = [("", x) for x in res_tools]
    errores = sum(1 for _, r in esc.resultados if _es_error(r))
    return {"id": esc.id, "ok": ok and not esc.abortado, "abortado": esc.abortado, "turnos": esc.turnos, "llamadas": esc.llamadas,
            "errores_herramientas": errores, "segundos": round(time.time() - t0, 1), "desc": esc.desc,
            "ultimo_error": next((r[:220] for _, r in reversed(esc.resultados) if _es_error(r)), "")}


def main():
    global VERBOSE
    ap = argparse.ArgumentParser()
    ap.add_argument("-v", action="store_true")
    ap.add_argument("-k", default="")
    ap.add_argument("--salida", default=str(RAIZ / "pruebas" / "resultados"))
    ap.add_argument("--etiqueta", default="")
    ap.add_argument("--real", default="", help="modelo REAL a medir (ej. lmstudio::opus4.7-gods.ghost.codex.distill.4b o "
                                               "nvidia::nvidia/nemotron-3-super-120b-a12b): usa tu config y tus claves")
    ap.add_argument("--timeout", type=int, default=0, help="segundos máximos por tarea (def. 90 simulado · 300 real)")
    ap.add_argument("--grupo", choices=["registros", "control", "ciegas", "todos"], default="todos",
                    help="registros = tareas sacadas de los errores reales · control y ciegas = tareas escritas después, sin ajustar")
    a = ap.parse_args()
    VERBOSE = a.v
    base = (escenarios() if a.grupo in ("registros", "todos") else []) + (escenarios_extra() if a.grupo in ("control", "todos") else []) \
        + (escenarios_ciegos() if a.grupo in ("ciegas", "todos") else [])
    if a.real:
        srv, modelo, tmax = None, a.real, a.timeout or 300
        preparar_real(modelo)
        base = [e for e in base if e.id in REALES]
        print(f"🧪 Banco REAL del programador: {modelo}")
    else:
        srv, modelo, tmax = Servidor(), "lmstudio::debil-4b", a.timeout or 90
        preparar_config(srv.puerto)
        print("🧪 Banco del programador eficiente con una IA débil simulada")
    lista = [e for e in base if a.k in e.id]
    res = []
    print(f"   {len(lista)} tareas")
    for e in lista:
        if VERBOSE:
            print(f"  ▶ {e.id}: {e.desc}")
        r = correr(e, srv, tmax, modelo)
        res.append(r)
        print(f"  {'✔' if r['ok'] else '✖'} {r['id']:<28} {r['turnos']:>2} turnos · {r['errores_herramientas']} errores · {r['segundos']} s"
              + ("" if r["ok"] else f"   ← {r['ultimo_error'][:110]}"))
    n_ok = sum(r["ok"] for r in res)
    pct = round(100 * n_ok / max(1, len(res)), 1)
    errs = sum(r["errores_herramientas"] for r in res)
    llam = sum(r["llamadas"] for r in res)
    print(f"\nRESULTADO: {n_ok}/{len(res)} tareas completadas = {pct} %  ·  {errs} errores de herramientas en {llam} llamadas")
    out = Path(a.salida)
    out.mkdir(parents=True, exist_ok=True)
    marca = datetime.now().strftime("%Y%m%d_%H%M%S") + (("_" + a.etiqueta) if a.etiqueta else "") + ("_real" if a.real else "")
    data = {"fecha": datetime.now().isoformat(timespec="seconds"), "modelo": modelo, "real": bool(a.real),
            "python": sys.version.split()[0], "plataforma": sys.platform,
            "tareas": len(res), "completadas": n_ok, "porcentaje": pct, "errores_herramientas": errs, "llamadas": llam, "detalle": res}
    (out / f"banco_programador_{marca}.json").write_text(json.dumps(data, ensure_ascii=False, indent=1), encoding="utf-8")
    md = [f"# Banco del programador eficiente — {data['fecha']}", "",
          f"Modelo: `{modelo}` ({'REAL' if a.real else 'IA débil simulada'})", "",
          f"**{n_ok}/{len(res)} tareas completadas ({pct} %)** · {errs} errores de herramientas en {llam} llamadas · "
          f"Python {data['python']} · {sys.platform}", "", "| Tarea | Resultado | Turnos | Errores | Qué prueba |", "|---|---|---|---|---|"]
    for r in res:
        md.append(f"| {r['id']} | {'✔' if r['ok'] else '✖'} | {r['turnos']} | {r['errores_herramientas']} | {r['desc']} |")
    (out / f"banco_programador_{marca}.md").write_text("\n".join(md) + "\n", encoding="utf-8")
    shutil.rmtree(TMP, ignore_errors=True)
    return 0 if pct >= 90 else 1


if __name__ == "__main__":
    sys.exit(main())
