# -*- coding: utf-8 -*-
"""Cliente MCP (Model Context Protocol) por stdio, compatible con el formato de Claude Desktop:

datos/mcp.json
{
  "mcpServers": {
    "filesystem": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/yo/Desktop"]},
    "otro": {"command": "uvx", "args": ["mcp-server-fetch"], "env": {"CLAVE": "valor"}}
  }
}
Soporta servidores modernos (2026-07-28, sin handshake) y clásicos (initialize).
"""
import json
import os
import queue
import re
import shutil
import subprocess
import threading

from .config import IS_WINDOWS, MCP_FILE, NO_WINDOW

MODERN = "2026-07-28"
LEGACY = "2025-06-18"
CLIENT_INFO = {"name": "Noviq", "version": "4.0"}

EXAMPLE = {
    "mcpServers": {
        "_ejemplo_desactivado_filesystem": {
            "command": "npx",
            "args": ["-y", "@modelcontextprotocol/server-filesystem", "C:/Users/TU_USUARIO/Desktop"],
            "disabled": True
        }
    }
}


# ───────────── Catálogo de servidores MCP (los más usados, listos con un clic) ─────────────
# modo: «pc» (los usa el agente del PC), «navegador» (los usa el agente navegador), «agente» (se usan con la herramienta
# agente_mcp: la IA principal no recibe sus decenas de herramientas en cada mensaje → ahorra tokens) o «directo» (pocas
# herramientas útiles siempre). {CARPETAS} se reemplaza por tus carpetas reales (Escritorio, Documentos, Descargas…).
CATALOGO = {
    "control_pc": {"nombre": "🖥 Windows-MCP (escritorio completo)", "cat": "Windows", "req": "uv", "modo": "pc",
                   "desc": "Maneja ventanas, clics, escritura, atajos y lee la pantalla como texto (menos capturas = menos tokens).",
                   "cfg": {"command": "uvx", "args": ["windows-mcp", "serve"],
                           "env": {"WINDOWS_MCP_EXCLUDE_TOOLS": "PowerShell,Registry,FileSystem", "ANONYMIZED_TELEMETRY": "false",
                                   "WINDOWS_MCP_SCREENSHOT_SCALE": "0.5"}}},
    "navegador_chrome": {"nombre": "🌐 Navegador automático (Chrome)", "cat": "Navegador", "req": "node", "modo": "navegador",
                         "desc": "Playwright: abre páginas, hace clic, llena formularios y lee datos en un Chrome aparte.",
                         "cfg": {"command": "npx", "args": ["-y", "@playwright/mcp@latest", "--browser", "chrome"]}},
    "navegador_edge": {"nombre": "🌐 Navegador automático (Edge)", "cat": "Navegador", "req": "node", "modo": "navegador",
                       "desc": "Lo mismo con Microsoft Edge (viene con Windows).",
                       "cfg": {"command": "npx", "args": ["-y", "@playwright/mcp@latest", "--browser", "msedge"]}},
    "chrome_real": {"nombre": "🧭 Tu Chrome abierto (con tus sesiones)", "cat": "Navegador", "req": "node", "modo": "navegador",
                    "desc": "Chrome DevTools MCP: usa el Chrome que ya tienes abierto (Gmail, Hotmail, bancos… con tu sesión). "
                            "Requiere Chrome 144+ y activar chrome://inspect/#remote-debugging; Chrome te pide «Permitir».",
                    "cfg": {"command": "npx", "args": ["-y", "chrome-devtools-mcp@latest", "--autoConnect"]}},
    "archivos": {"nombre": "📁 Archivos (tus carpetas)", "cat": "Windows", "req": "node", "modo": "agente",
                 "desc": "Leer, buscar, mover y organizar archivos en Escritorio, Documentos y Descargas.",
                 "cfg": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-filesystem", "{CARPETAS}"]}},
    "desktop_commander": {"nombre": "⌨ Desktop Commander", "cat": "Windows", "req": "node", "modo": "agente",
                          "desc": "Terminal y archivos con búsqueda y edición avanzada (muy usado con Claude Desktop).",
                          "cfg": {"command": "npx", "args": ["-y", "@wonderwhy-er/desktop-commander@latest"]}},
    "excel": {"nombre": "📊 Excel", "cat": "Office", "req": "uv", "modo": "agente",
              "desc": "Crea y edita libros de Excel (hojas, fórmulas, formatos, gráficos) sin abrir Excel.",
              "cfg": {"command": "uvx", "args": ["excel-mcp-server", "stdio"], "env": {"EXCEL_FILES_PATH": "{CARPETAS;}"}}},
    "gmail_oauth": {"nombre": "✉ Gmail (OAuth, avanzado)", "cat": "Correo", "req": "node", "modo": "agente",
                    "desc": "Leer, buscar, etiquetar y enviar con la API de Gmail. Necesita un gcp-oauth.keys.json en "
                            "%USERPROFILE%\\.gmail-mcp y ejecutar una vez: npx @gongrzhe/server-gmail-autoauth-mcp auth. "
                            "(Para enviar basta el correo integrado de ⚙ Ajustes → Telegram y correo).",
                    "cfg": {"command": "npx", "args": ["-y", "@gongrzhe/server-gmail-autoauth-mcp"]}},
    "buscar_web": {"nombre": "🔎 Búsqueda web (DuckDuckGo)", "cat": "Internet", "req": "uv", "modo": "directo",
                   "desc": "Busca en internet y lee páginas sin clave.", "cfg": {"command": "uvx", "args": ["duckduckgo-mcp-server"]}},
    "fetch": {"nombre": "🌍 Leer páginas (Fetch)", "cat": "Internet", "req": "uv", "modo": "directo",
              "desc": "Descarga una página y la convierte a texto (oficial de MCP).", "cfg": {"command": "uvx", "args": ["mcp-server-fetch"]}},
    "pensamiento": {"nombre": "🧠 Sequential Thinking", "cat": "IA", "req": "node", "modo": "directo",
                    "desc": "Ayuda a las IAs pequeñas a pensar paso a paso problemas difíciles.",
                    "cfg": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-sequential-thinking"]}},
    "memoria_grafo": {"nombre": "🗂 Memoria (grafo de conocimiento)", "cat": "IA", "req": "node", "modo": "agente",
                      "desc": "Recuerda personas, proyectos y datos entre conversaciones.",
                      "cfg": {"command": "npx", "args": ["-y", "@modelcontextprotocol/server-memory"]}},
    "context7": {"nombre": "📚 Context7 (documentación de programación)", "cat": "Programación", "req": "node", "modo": "directo",
                 "desc": "Documentación actualizada de librerías para programar sin errores de versión.",
                 "cfg": {"command": "npx", "args": ["-y", "@upstash/context7-mcp"]}},
}
PRESETS = {k: v["cfg"] for k, v in CATALOGO.items()}
PC_SERVERS = {"control_pc"}  # sus herramientas se delegan al agente del PC (no se envían en cada mensaje)
RECOMENDADOS = ["control_pc", "navegador_chrome", "archivos", "buscar_web"]  # «Conectar todo lo recomendado»


def modo_de(nombre, cfg=None):
    cfg = cfg or {}
    if isinstance(cfg.get("noviq"), dict) and cfg["noviq"].get("modo"):
        return cfg["noviq"]["modo"]
    if nombre in CATALOGO:
        return CATALOGO[nombre]["modo"]
    return "directo"


class MCPError(Exception):
    pass


class MCPServer:
    def __init__(self, name, cfg):
        self.name, self.cfg = name, cfg
        self.proc = None
        self.tools = []
        self.status = "detenido"
        self.error = ""
        self.modern = False
        self.version = LEGACY
        self._id = 0
        self._pending = {}
        self._lock = threading.Lock()
        self.stderr_tail = []

    # ── transporte ──
    def _cmd(self):
        cmd = self.cfg.get("command", "")
        exe = shutil.which(cmd) or cmd
        args = [str(a) for a in self.cfg.get("args", [])]
        if IS_WINDOWS and exe.lower().endswith((".cmd", ".bat")):
            return ["cmd", "/c", exe] + args
        return [exe] + args

    def start(self):
        self.status, self.error = "iniciando", ""
        env = dict(os.environ)
        env.update({k: str(v) for k, v in (self.cfg.get("env") or {}).items()})
        try:
            self.proc = subprocess.Popen(self._cmd(), stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                         stderr=subprocess.PIPE, env=env, cwd=self.cfg.get("cwd") or None,
                                         creationflags=NO_WINDOW)
        except Exception as e:
            self.status, self.error = "error", f"No se pudo iniciar '{self.cfg.get('command')}': {e}"
            return
        threading.Thread(target=self._read_out, daemon=True).start()
        threading.Thread(target=self._read_err, daemon=True).start()
        try:
            self._handshake()
            self.tools = self._list_tools()
            self.status = "conectado"
        except Exception as e:
            self.status = "error"
            self.error = f"{e} {' | '.join(self.stderr_tail[-3:])}"[:600]

    def _read_out(self):
        for raw in iter(self.proc.stdout.readline, b""):
            try:
                msg = json.loads(raw.decode("utf-8"))
            except Exception:
                continue
            if "id" in msg and ("result" in msg or "error" in msg):
                q = self._pending.pop(msg["id"], None)
                if q:
                    q.put(msg)
        self.status = "detenido" if self.status != "error" else self.status
        for q in list(self._pending.values()):
            q.put({"error": {"code": -1, "message": "el servidor MCP se cerró"}})

    def _read_err(self):
        for raw in iter(self.proc.stderr.readline, b""):
            self.stderr_tail = (self.stderr_tail + [raw.decode("utf-8", "replace").strip()])[-20:]

    def _send(self, obj):
        with self._lock:
            self.proc.stdin.write((json.dumps(obj, ensure_ascii=False) + "\n").encode("utf-8"))
            self.proc.stdin.flush()

    def request(self, method, params=None, timeout=60, meta=True):
        if not self.proc or self.proc.poll() is not None:
            raise MCPError("el servidor no está en ejecución")
        self._id += 1
        rid = self._id
        params = dict(params or {})
        if self.modern and meta:
            params["_meta"] = {**params.get("_meta", {}),
                               "io.modelcontextprotocol/protocolVersion": self.version,
                               "io.modelcontextprotocol/clientInfo": CLIENT_INFO,
                               "io.modelcontextprotocol/clientCapabilities": {}}
        q = queue.Queue()
        self._pending[rid] = q
        self._send({"jsonrpc": "2.0", "id": rid, "method": method, "params": params})
        try:
            msg = q.get(timeout=timeout)
        except queue.Empty:
            self._pending.pop(rid, None)
            try:
                self._send({"jsonrpc": "2.0", "method": "notifications/cancelled", "params": {"requestId": rid}})
            except Exception:
                pass
            raise MCPError(f"tiempo agotado esperando '{method}'")
        if "error" in msg:
            e = msg["error"]
            err = MCPError(f"{e.get('message')} (código {e.get('code')})")
            err.code, err.data = e.get("code"), e.get("data")
            raise err
        return msg.get("result") or {}

    # ── ciclo de vida ──
    def _handshake(self):
        # 1) sondeo moderno
        self.modern, self.version = True, MODERN
        try:  # (con uvx/npx la primera vez se instala el paquete: se espera un poco más)
            res = self.request("server/discover", {}, timeout=15 if self.cfg.get("command") in ("uvx", "npx") else 6)
            vers = res.get("supportedVersions") or [MODERN]
            self.version = MODERN if MODERN in vers else vers[0]
            return
        except MCPError as e:
            if getattr(e, "code", None) == -32022:  # moderno pero otra versión
                sup = (getattr(e, "data", None) or {}).get("supported") or []
                if sup:
                    self.version = sup[0]
                    return
        # 2) servidor clásico → initialize
        self.modern, self.version = False, LEGACY
        try:
            res = self.request("initialize", {"protocolVersion": LEGACY, "capabilities": {},
                                              "clientInfo": CLIENT_INFO},
                                             timeout=240 if self.cfg.get("command") in ("uvx", "npx") else 60)
        except MCPError as e:
            # Servidor moderno (2026-07-28, sin handshake) que tardó en arrancar (uvx/npx instalando la 1.ª vez) y no
            # contestó el sondeo a tiempo: rechaza initialize con -32022 («connection is serving the 2026-07-28 protocol»).
            txt = str(e)
            if getattr(e, "code", None) == -32022 or MODERN in txt or "not accepted" in txt:
                sup = (getattr(e, "data", None) or {}).get("supported") or []
                self.modern, self.version = True, (MODERN if not sup or MODERN in sup else sup[0])
                try:  # ya está en marcha: el sondeo contesta enseguida
                    res = self.request("server/discover", {}, timeout=60)
                    vers = res.get("supportedVersions") or [self.version]
                    self.version = MODERN if MODERN in vers else vers[0]
                except MCPError:
                    pass
                return
            raise
        self.version = res.get("protocolVersion", LEGACY)
        self._send({"jsonrpc": "2.0", "method": "notifications/initialized"})

    def _list_tools(self):
        tools, cursor = [], None
        for _ in range(20):
            res = self.request("tools/list", {"cursor": cursor} if cursor else {}, timeout=30)
            tools += res.get("tools", [])
            cursor = res.get("nextCursor")
            if not cursor:
                break
        return tools

    def call(self, tool, args, timeout=300):
        res = self.request("tools/call", {"name": tool, "arguments": args or {}}, timeout=timeout)
        if res.get("resultType") == "input_required":
            return {"text": "ERROR: el servidor MCP pidió datos adicionales (no soportado todavía).", "images": []}
        texts, images = [], []
        for c in res.get("content", []):
            t = c.get("type")
            if t == "text":
                texts.append(c.get("text", ""))
            elif t == "image" and c.get("data"):
                images.append(f"data:{c.get('mimeType', 'image/png')};base64,{c['data']}")
            elif t == "resource":
                r = c.get("resource", {})
                texts.append(r.get("text") or f"[recurso {r.get('uri')}]")
            else:
                texts.append(json.dumps(c, ensure_ascii=False)[:2000])
        if res.get("structuredContent") and not texts:
            texts.append(json.dumps(res["structuredContent"], ensure_ascii=False, indent=1))
        text = "\n".join(texts) or "(sin contenido)"
        if res.get("isError"):
            text = "ERROR: " + text
        return {"text": text, "images": images}

    def stop(self):
        if self.proc and self.proc.poll() is None:
            try:
                self.proc.stdin.close()
                self.proc.wait(timeout=3)
            except Exception:
                self.proc.kill()
        self.status = "detenido"


def _safe(s):
    return re.sub(r"[^a-zA-Z0-9_-]", "_", s)


class MCPManager:
    def __init__(self):
        self.servers = {}

    def load_config_text(self):
        if not MCP_FILE.exists():
            MCP_FILE.write_text(json.dumps(EXAMPLE, indent=2, ensure_ascii=False), encoding="utf-8")
        return MCP_FILE.read_text(encoding="utf-8")

    def save_config_text(self, text):
        json.loads(text)  # valida
        MCP_FILE.write_text(text, encoding="utf-8")

    def reload(self):
        rutas_extra()
        for s in self.servers.values():
            s.stop()
        self.servers = {}
        try:
            cfg = json.loads(self.load_config_text()).get("mcpServers", {})
        except Exception as e:
            self.servers["_config"] = type("X", (), {"status": "error", "error": f"mcp.json inválido: {e}",
                                                      "tools": [], "stop": lambda s: None})()
            return
        for name, c in cfg.items():
            if c.get("disabled") or not c.get("command"):
                continue
            s = MCPServer(name, c)
            self.servers[name] = s
            threading.Thread(target=s.start, daemon=True).start()

    def status(self):
        return [{"name": n, "status": s.status, "error": s.error, "tools": [t.get("name") for t in s.tools],
                 "modo": modo_de(n, getattr(s, "cfg", {})), "nombre": (CATALOGO.get(n) or {}).get("nombre", n)}
                for n, s in self.servers.items()]

    def modo(self, n):
        s = self.servers.get(n)
        return modo_de(n, getattr(s, "cfg", {}) if s else {})

    def tool_defs(self, include_browser=None):
        """Herramientas MCP. Las del navegador, del PC y de los servidores «agente» se delegan a subagentes salvo que
        se pidan todas (include_browser=True): la IA principal no recibe decenas de herramientas en cada mensaje."""
        from .config import CONFIG
        if include_browser is None:
            include_browser = bool(CONFIG.get("navegador_directo"))
        out, self._map = [], getattr(self, "_map", {})
        for n, s in self.servers.items():
            if getattr(s, "status", "") != "conectado":
                continue
            modo = self.modo(n)
            for t in s.tools:
                if not include_browser and (modo in ("pc", "navegador", "agente") or t["name"].startswith("browser_")):
                    fname = f"mcp__{_safe(n)}__{_safe(t['name'])}"[:64]
                    self._map[fname] = (n, t["name"])
                    continue
                fname = f"mcp__{_safe(n)}__{_safe(t['name'])}"[:64]
                self._map[fname] = (n, t["name"])
                schema = t.get("inputSchema") or {"type": "object", "properties": {}}
                schema = {k: v for k, v in schema.items() if k != "$schema"}
                out.append({"type": "function", "function": {
                    "name": fname, "description": f"[MCP {n}] " + (t.get("description") or t["name"])[:900],
                    "parameters": schema}})
        return out

    def has_browser(self):
        return any(getattr(s, "status", "") == "conectado" and (self.modo(n) == "navegador" or any(t["name"].startswith("browser_") for t in s.tools))
                   for n, s in self.servers.items())

    def conectados(self, modo=None):
        return [n for n, s in self.servers.items() if getattr(s, "status", "") == "conectado" and (modo is None or self.modo(n) == modo)]

    def server_tools(self, n):
        """Definiciones de las herramientas de UN servidor (para un subagente)."""
        s = self.servers.get(n)
        if not s or getattr(s, "status", "") != "conectado":
            return []
        self._map = getattr(self, "_map", {})
        out = []
        for t in s.tools:
            fname = f"mcp__{_safe(n)}__{_safe(t['name'])}"[:64]
            self._map[fname] = (n, t["name"])
            schema = {k: v for k, v in (t.get("inputSchema") or {"type": "object", "properties": {}}).items() if k != "$schema"}
            out.append({"type": "function", "function": {"name": fname, "description": (t.get("description") or t["name"])[:700],
                                                          "parameters": schema}})
        return out

    def navegador_preferido(self):
        """Servidor de navegador a usar: tu Chrome real (con tus sesiones) si está conectado y así se eligió, si no Playwright."""
        from .config import CONFIG
        navs = self.conectados("navegador") or [n for n, s in self.servers.items() if getattr(s, "status", "") == "conectado"
                                                  and any(t["name"].startswith("browser_") for t in s.tools)]
        if not navs:
            return None
        pref = (CONFIG.get("pc") or {}).get("navegador", "auto")
        if pref == "real" and "chrome_real" in navs:
            return "chrome_real"
        otros = [n for n in navs if n != "chrome_real"]
        if pref == "automatico" and otros:
            return otros[0]
        return otros[0] if otros else navs[0]

    def has_pc(self):
        return any(n in PC_SERVERS and getattr(s, "status", "") == "conectado" for n, s in self.servers.items())

    def pc_tools(self):
        self.tool_defs(include_browser=True)
        out = []
        for n, s in self.servers.items():
            if n in PC_SERVERS and getattr(s, "status", "") == "conectado":
                for t in s.tools:
                    schema = {k: v for k, v in (t.get("inputSchema") or {"type": "object", "properties": {}}).items() if k != "$schema"}
                    out.append({"type": "function", "function": {"name": f"mcp__{_safe(n)}__{_safe(t['name'])}"[:64],
                                                                  "description": (t.get("description") or t["name"])[:700],
                                                                  "parameters": schema}})
        return out

    def add_preset(self, key, reiniciar=True):
        from .config import DATA_DIR
        cfg = json.loads(self.load_config_text())
        work = DATA_DIR / "navegador"
        work.mkdir(exist_ok=True)
        c = json.loads(json.dumps(PRESETS[key]))
        if any("{CARPETAS" in str(x) for x in list(c.get("args", [])) + list((c.get("env") or {}).values())):
            try:
                from .perfil_windows import carpetas_usuario
                dirs = [str(p) for p in carpetas_usuario().values()]
            except Exception:
                dirs = []
            dirs = dirs or [str(os.path.expanduser("~"))]
            args = []
            for a in c.get("args", []):
                args += dirs if a == "{CARPETAS}" else [a]
            c["args"] = args
            c["env"] = {k: (os.pathsep.join(dirs) if v == "{CARPETAS;}" else v) for k, v in (c.get("env") or {}).items()}
        cfg.setdefault("mcpServers", {})[key] = dict(c, cwd=str(work))
        self.save_config_text(json.dumps(cfg, indent=2, ensure_ascii=False))
        if reiniciar:
            self.reload()

    def quitar(self, key):
        cfg = json.loads(self.load_config_text())
        cfg.get("mcpServers", {}).pop(key, None)
        self.save_config_text(json.dumps(cfg, indent=2, ensure_ascii=False))
        self.reload()

    def call(self, fname, args):
        if not hasattr(self, "_map") or fname not in self._map:
            self.tool_defs(include_browser=True)
        if fname not in self._map:
            return f"ERROR: herramienta MCP desconocida {fname}"
        server, tool = self._map[fname]
        return self.servers[server].call(tool, args)


MANAGER = MCPManager()


# ───────────── Requisitos (Node.js para npx, uv para uvx) e instalación con un clic ─────────────
def rutas_extra():
    """Carpetas donde quedan node/npx y uv/uvx al instalarlos (para usarlos sin reiniciar Noviq)."""
    la, pf, ad = os.environ.get("LOCALAPPDATA", ""), os.environ.get("ProgramFiles", ""), os.environ.get("APPDATA", "")
    extra = [os.path.join(pf, "nodejs") if pf else "", os.path.join(la, "Microsoft", "WinGet", "Links") if la else "",
             os.path.join(ad, "npm") if ad else "", os.path.expanduser(os.path.join("~", ".local", "bin")),
             os.path.expanduser(os.path.join("~", ".cargo", "bin"))]
    actual = os.environ.get("PATH", "")
    for d in extra:
        if d and os.path.isdir(d) and d.lower() not in actual.lower():
            actual = d + os.pathsep + actual
    os.environ["PATH"] = actual


def requisitos():
    rutas_extra()
    return {"node": bool(shutil.which("npx")), "uv": bool(shutil.which("uvx")), "winget": bool(shutil.which("winget")),
            "windows": IS_WINDOWS}


def instalar_requisito(req, log):
    """Instala Node.js (winget) o uv (pip o winget). Devuelve True si quedó disponible."""
    rutas_extra()
    if req == "node" and not shutil.which("npx"):
        if not shutil.which("winget"):
            log.append("✖ Falta Node.js y no hay winget: instálalo desde https://nodejs.org (versión LTS).")
            return False
        log.append("⬇ Instalando Node.js LTS con winget (1-3 min)…")
        r = subprocess.run(["winget", "install", "-e", "--id", "OpenJS.NodeJS.LTS", "--silent", "--accept-source-agreements",
                            "--accept-package-agreements"], capture_output=True, text=True, timeout=900, creationflags=NO_WINDOW)
        ult = [ln for ln in (r.stdout or r.stderr or "").strip().splitlines() if ln.strip()][-1:]
        log.append("   " + (ult[0][:160] if ult else "listo"))
    if req == "uv" and not shutil.which("uvx"):
        from .config import python_exe
        py = python_exe()
        if py:
            log.append("⬇ Instalando uv con pip…")
            r = subprocess.run([py, "-m", "pip", "install", "--upgrade", "uv"], capture_output=True, text=True, timeout=600,
                               creationflags=NO_WINDOW)
            scripts = os.path.join(os.path.dirname(py), "Scripts" if IS_WINDOWS else "")
            if os.path.isdir(scripts):
                os.environ["PATH"] = scripts + os.pathsep + os.environ.get("PATH", "")
            if r.returncode != 0:
                log.append("   pip falló: " + r.stderr[-200:])
        if not shutil.which("uvx") and shutil.which("winget"):
            log.append("⬇ Instalando uv con winget…")
            subprocess.run(["winget", "install", "-e", "--id", "astral-sh.uv", "--silent", "--accept-source-agreements",
                            "--accept-package-agreements"], capture_output=True, text=True, timeout=900, creationflags=NO_WINDOW)
    rutas_extra()
    ok = bool(shutil.which("npx" if req == "node" else "uvx"))
    log.append(("✔ " if ok else "✖ ") + ("Node.js" if req == "node" else "uv") + (" listo." if ok else " no quedó instalado."))
    return ok


def conectar(claves, log=None):
    """Instala lo que falte y agrega los servidores del catálogo (se reinician una sola vez)."""
    log = log if log is not None else []
    hechos = []
    for k in claves:
        if k not in CATALOGO:
            continue
        req = CATALOGO[k].get("req")
        if req and not instalar_requisito(req, log):
            log.append(f"✖ {CATALOGO[k]['nombre']}: falta {req}.")
            continue
        MANAGER.add_preset(k, reiniciar=False)
        hechos.append(k)
        log.append(f"✔ {CATALOGO[k]['nombre']} agregado.")
    if hechos:
        MANAGER.reload()
    return hechos


def catalogo_publico():
    est = {x["name"]: x for x in MANAGER.status()}
    try:
        cfg = json.loads(MANAGER.load_config_text()).get("mcpServers", {})
    except Exception:
        cfg = {}
    return [{"key": k, "nombre": v["nombre"], "cat": v["cat"], "desc": v["desc"], "req": v.get("req"), "modo": v["modo"],
             "agregado": k in cfg and not cfg[k].get("disabled"), "estado": (est.get(k) or {}).get("status"),
             "error": (est.get(k) or {}).get("error", ""), "herramientas": len((est.get(k) or {}).get("tools") or []),
             "recomendado": k in RECOMENDADOS} for k, v in CATALOGO.items()]
