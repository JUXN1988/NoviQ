# -*- coding: utf-8 -*-
"""Prueba el servidor MCP del programador como lo usa el avatar: proceso aparte por stdio (JSON-RPC)."""
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

import pytest

RAIZ = Path(__file__).resolve().parent.parent


class Cliente:
    def __init__(self, env):
        self.p = subprocess.Popen([sys.executable, str(RAIZ / "noviq_programador_mcp.py")], stdin=subprocess.PIPE,
                                  stdout=subprocess.PIPE, stderr=subprocess.PIPE, env=env)
        self.n = 0

    def rpc(self, metodo, params=None):
        self.n += 1
        self.p.stdin.write((json.dumps({"jsonrpc": "2.0", "id": self.n, "method": metodo, "params": params or {}}) + "\n").encode())
        self.p.stdin.flush()
        r = json.loads(self.p.stdout.readline().decode("utf-8"))
        assert r["id"] == self.n
        return r

    def herramienta(self, nombre, args):
        r = self.rpc("tools/call", {"name": nombre, "arguments": args})["result"]
        return r["content"][0]["text"], r["isError"]

    def cerrar(self):
        self.p.stdin.close()
        self.p.wait(10)


@pytest.fixture(scope="module")
def cli():
    tmp = Path(tempfile.mkdtemp(prefix="noviq_mcp_"))
    proy = tmp / "Noviq_Proyectos"
    (proy / "Juego" / "src").mkdir(parents=True)
    (proy / "Juego" / "src" / "jugador.js").write_text("class J {\n  jump() {\n    this.vy = -9;\n  }\n}\n", encoding="utf-8")
    (proy / "Juego" / ".env").write_text("CLAVE=secreta\n", encoding="utf-8")
    (tmp / "fuera.txt").write_text("privado", encoding="utf-8")
    (tmp / "datos").mkdir()
    (tmp / "datos" / "config.json").write_text(json.dumps({"projects_dir": str(proy)}), encoding="utf-8")
    env = dict(os.environ, NOVIQ_DATOS=str(tmp / "datos"), PYTHONUTF8="1")
    env.pop("NOVIQ_SIN_BOVEDA", None)
    c = Cliente(env)
    c.tmp = tmp
    yield c
    c.cerrar()


def test_inicio_y_lista(cli):
    r = cli.rpc("initialize", {"protocolVersion": "2025-06-18", "capabilities": {}, "clientInfo": {"name": "prueba", "version": "1"}})
    assert r["result"]["serverInfo"]["name"] == "noviq-programador"
    cli.p.stdin.write(b'{"jsonrpc":"2.0","method":"notifications/initialized"}\n')
    tools = {t["name"]: t for t in cli.rpc("tools/list")["result"]["tools"]}
    for n in ("explorar_codigo", "leer_archivo", "editar_archivo", "aplicar_parche", "verificar_codigo", "memoria"):
        assert n in tools
    assert tools["leer_archivo"]["annotations"]["readOnlyHint"] is True
    assert tools["editar_archivo"]["annotations"]["readOnlyHint"] is False
    assert not any(n.startswith("ejecutar") for n in tools)  # no ejecuta comandos


def test_flujo_completo(cli):
    t, err = cli.herramienta("usar_proyecto", {"nombre": "juego"})
    assert not err and "Juego" in t
    t, err = cli.herramienta("explorar_codigo", {"pregunta": "dónde se salta"})
    assert not err and "jugador.js" in t
    t, err = cli.herramienta("Edit", {"file_path": "jugador.js", "old_string": "this.vy = -9;", "new_string": "this.vy = -12;"})
    assert not err, t
    assert "-12" in (cli.tmp / "Noviq_Proyectos" / "Juego" / "src" / "jugador.js").read_text(encoding="utf-8")
    t, err = cli.herramienta("verificar_codigo", {"ruta": "src/jugador.js"})
    assert not err and "OK" in t
    t, err = cli.herramienta("deshacer_cambio", {"ruta": "src/jugador.js"})
    assert not err and "-9" in (cli.tmp / "Noviq_Proyectos" / "Juego" / "src" / "jugador.js").read_text(encoding="utf-8")


def test_seguridad(cli):
    t, err = cli.herramienta("leer_archivo", {"ruta": str(cli.tmp / "fuera.txt")})
    assert err and "fuera de tus carpetas" in t
    t, err = cli.herramienta("leer_archivo", {"ruta": ".env", "proyecto": "Juego"})
    assert err and "claves" in t
    t, err = cli.herramienta("escribir_archivo", {"ruta": "../../fuera2.txt", "contenido": "x"})
    assert err and not (cli.tmp / "fuera2.txt").exists()
    t, err = cli.herramienta("ejecutar_powershell", {"comando": "dir"})
    assert err


def test_metodo_desconocido(cli):
    r = cli.rpc("algo/raro")
    assert r["error"]["code"] == -32601
