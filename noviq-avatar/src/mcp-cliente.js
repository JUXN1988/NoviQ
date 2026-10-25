'use strict';
/* ==========================================================================
   Noviq Avatar — Cliente MCP
   Conecta al avatar con CUALQUIER servidor MCP:
     · stdio  → un programa local (npx, uvx, python, node, un .exe…)
     · http   → un servidor MCP por URL (Streamable HTTP, respuestas JSON o SSE)
   y administra la lista de servidores (se guarda en mcp.json de la carpeta de
   datos del avatar; NO está dentro de ajustes.json a propósito: un programa
   que cambie ajustes por la API no puede añadir comandos que se ejecuten).
   Además registra servidores INTERNOS (windows, pc) con la misma interfaz.
   Sin dependencias. Cada herramienta lleva su «riesgo» (leer | accion | peligro)
   que usa el control de permisos antes de ejecutarla.
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const { spawn } = require('child_process');
const { leerJSON, escribirJSON } = require('./almacen');

const PROTO = '2025-06-18';
const SLUG = /^[a-z0-9][a-z0-9_-]{0,23}$/;
const RESERVADOS = new Set(['windows', 'pc', 'web', 'avatar', 'principal', 'proyectos']);   // ids de los bots/servidores internos

/** Presets listos para añadir con un clic (el usuario los confirma en la página). */
/** Python para los servidores de Noviq: el de su .venv (tiene requests, etc.); si no existe, el del sistema. */
function pythonDeNoviq(carpetaNoviq) {
  const win = process.platform === 'win32';
  const venv = win ? path.join(carpetaNoviq, '.venv', 'Scripts', 'python.exe') : path.join(carpetaNoviq, '.venv', 'bin', 'python');
  try { if (fs.existsSync(venv)) return venv; } catch (_) { /* sin acceso */ }
  return win ? 'python' : 'python3';
}

function presets(opc) {
  opc = opc || {};
  const noviqMcp = opc.rutaNoviqMcp || path.join(__dirname, '..', '..', 'noviq_mcp.py');
  const progMcp = opc.rutaProgramadorMcp || path.join(path.dirname(noviqMcp), 'noviq_programador_mcp.py');
  const win = process.platform === 'win32';
  return [
    { id: 'noviq', nombre: 'Noviq (control del programa)', tipo: 'stdio', comando: win ? 'python' : 'python3', args: [noviqMcp],
      desc: 'Deja que el avatar maneje Noviq: ver qué trabaja, mandar y continuar trabajos, ranking de IAs, ajustes. Noviq debe estar abierto.', bot: 'Maneja el programa Noviq' },
    { id: 'programador', nombre: 'Programador de Noviq', tipo: 'stdio', comando: pythonDeNoviq(path.dirname(progMcp)), args: [progMcp],
      desc: 'El bot programador: encuentra dónde está algo en el código, lo lee, hace cambios pequeños con copia de respaldo y verifica que quede bien. Solo dentro de tus proyectos; no ejecuta comandos; no necesita que Noviq esté abierto.',
      bot: 'Cambios pequeños y preguntas sobre el código de tus proyectos' },
    { id: 'archivos', nombre: 'Archivos (oficial)', tipo: 'stdio', comando: 'npx', args: ['-y', '@modelcontextprotocol/server-filesystem', opc.carpeta || (process.env.USERPROFILE || process.env.HOME || '.')],
      desc: 'Leer y escribir archivos solo dentro de la carpeta que elijas (cambia la ruta al final).', bot: 'Archivos de una carpeta' },
    { id: 'navegador', nombre: 'Navegador Playwright (oficial de Microsoft)', tipo: 'stdio', comando: 'npx', args: ['-y', '@playwright/mcp@latest'],
      desc: 'Maneja un navegador: abrir páginas, hacer clic, rellenar formularios, leer.', bot: 'Maneja un navegador web' },
    { id: 'fetch', nombre: 'Fetch (leer páginas)', tipo: 'stdio', comando: 'uvx', args: ['mcp-server-fetch'], desc: 'Descarga y convierte páginas web a texto. Necesita «uv».', bot: 'Lee páginas web' },
    { id: 'memoria', nombre: 'Memoria de grafo (oficial)', tipo: 'stdio', comando: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'], desc: 'Memoria con entidades y relaciones.', bot: 'Memoria de grafo' },
    { id: 'windows-mcp', nombre: 'Windows-MCP (comunidad)', tipo: 'stdio', comando: 'uvx', args: ['windows-mcp'],
      desc: 'Control de escritorio de Windows con captura y clics (proyecto de la comunidad; revisa que sea de tu confianza). Necesita «uv».', bot: 'Controla el escritorio de Windows' }
  ];
}

/* ------------------------------------------------------------- stdio */
function ordenParaShell(cmd, args) {
  // En Windows npx/uvx/npm son .cmd: hace falta shell, y entonces hay que comillar lo que lleva espacios.
  const q = (s) => (/[\s"]/.test(s) ? '"' + String(s).replace(/"/g, '\\"') + '"' : String(s));
  return { comando: q(cmd), args: args.map(q) };
}

class ClienteStdio {
  constructor(def, log) { this.def = def; this.log = log || (() => {}); this.proc = null; this.buf = ''; this.id = 0; this.esp = new Map(); this.stderr = ''; this.listo = false; }

  async iniciar() {
    const d = this.def;
    const win = process.platform === 'win32';
    const env = Object.assign({}, process.env, d.env || {});
    let comando = d.comando, args = (d.args || []).slice(), shell = false;
    if (win && /^(npx|npm|pnpm|yarn|uvx|uv|bunx|bun)$/i.test(comando)) { shell = true; const o = ordenParaShell(comando, args); comando = o.comando; args = o.args; }
    await new Promise((resolve, reject) => {
      let hecho = false;
      const fin = (e) => { if (hecho) return; hecho = true; e ? reject(e) : resolve(); };
      try { this.proc = spawn(comando, args, { env, shell, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'], cwd: d.carpeta || undefined }); }
      catch (e) { return fin(e); }
      this.proc.on('error', (e) => { this.alMorir(e); fin(new Error(e.code === 'ENOENT' ? `No encuentro el programa «${d.comando}». Instálalo o escribe su ruta completa.` : e.message)); });
      this.proc.on('exit', (c) => { this.alMorir(new Error('el servidor MCP se cerró (código ' + c + ')' + (this.stderr ? ': ' + this.stderr.slice(-200) : ''))); fin(new Error('se cerró al arrancar' + (this.stderr ? ': ' + this.stderr.slice(-200) : ''))); });
      this.proc.stdout.setEncoding('utf8');
      this.proc.stdout.on('data', (t) => this.recibir(t));
      this.proc.stderr.setEncoding('utf8');
      this.proc.stderr.on('data', (t) => { this.stderr = (this.stderr + t).slice(-2000); });
      this.proc.stdin.on('error', () => {});
      setImmediate(() => fin());
    });
    const r = await this.llamar('initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'noviq-avatar', version: '2.3.0' } }, 45000);
    this.info = r || {};
    this.notificar('notifications/initialized');
    this.listo = true;
    return this.info;
  }
  alMorir(e) { this.listo = false; for (const [, p] of this.esp) p.reject(e); this.esp.clear(); }
  recibir(t) {
    this.buf += t;
    let i;
    while ((i = this.buf.indexOf('\n')) >= 0) {
      const linea = this.buf.slice(0, i).trim(); this.buf = this.buf.slice(i + 1);
      if (!linea) continue;
      let m; try { m = JSON.parse(linea); } catch (_) { continue; }
      if (m.id != null && this.esp.has(m.id) && (m.result !== undefined || m.error)) {
        const p = this.esp.get(m.id); this.esp.delete(m.id); clearTimeout(p.t);
        m.error ? p.reject(new Error(m.error.message || 'error MCP')) : p.resolve(m.result);
      } else if (m.id != null && m.method) {   // petición del servidor: no soportamos nada (roots, sampling…)
        this.enviar({ jsonrpc: '2.0', id: m.id, error: { code: -32601, message: 'no soportado' } });
      }
    }
  }
  enviar(o) { try { this.proc.stdin.write(JSON.stringify(o) + '\n'); } catch (_) { /* cerrado */ } }
  notificar(metodo, params) { this.enviar({ jsonrpc: '2.0', method: metodo, params }); }
  llamar(metodo, params, ms) {
    return new Promise((resolve, reject) => {
      if (!this.proc || this.proc.exitCode != null) return reject(new Error('el servidor MCP no está en marcha'));
      const id = ++this.id;
      const t = setTimeout(() => { this.esp.delete(id); reject(new Error('el servidor MCP no respondió a tiempo (' + metodo + ')')); }, ms || 60000);
      this.esp.set(id, { resolve, reject, t });
      this.enviar({ jsonrpc: '2.0', id, method: metodo, params: params || {} });
    });
  }
  cerrar() { try { this.proc && this.proc.kill(); } catch (_) { /* ya */ } this.listo = false; }
}

/* -------------------------------------------------------------- http */
class ClienteHttp {
  constructor(def, log) { this.def = def; this.log = log || (() => {}); this.sesion = ''; this.id = 0; this.listo = false; }
  cab() {
    const h = Object.assign({ 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' }, this.def.cabeceras || {});
    if (this.def.token) h.Authorization = 'Bearer ' + this.def.token;
    if (this.sesion) h['Mcp-Session-Id'] = this.sesion;
    return h;
  }
  async post(cuerpo, ms) {
    const r = await fetch(this.def.url, { method: 'POST', headers: this.cab(), body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(ms || 60000) });
    const s = r.headers.get('mcp-session-id'); if (s) this.sesion = s;
    if (r.status === 202 || cuerpo.id == null) return null;
    if (!r.ok) throw new Error('HTTP ' + r.status + ' ' + (await r.text()).slice(0, 160));
    const tipo = r.headers.get('content-type') || '';
    const txt = await r.text();
    let m = null;
    if (/event-stream/.test(tipo)) {
      for (const bloque of txt.split(/\n\n+/)) {
        const datos = bloque.split('\n').filter((l) => l.startsWith('data:')).map((l) => l.slice(5).trim()).join('');
        if (!datos) continue;
        try { const j = JSON.parse(datos); if (j.id === cuerpo.id) { m = j; break; } } catch (_) { /* siguiente */ }
      }
    } else { try { m = JSON.parse(txt); } catch (_) { throw new Error('respuesta no válida del servidor MCP'); } }
    if (!m) throw new Error('el servidor MCP no devolvió respuesta');
    if (m.error) throw new Error(m.error.message || 'error MCP');
    return m.result;
  }
  async iniciar() {
    const r = await this.llamar('initialize', { protocolVersion: PROTO, capabilities: {}, clientInfo: { name: 'noviq-avatar', version: '2.3.0' } }, 30000);
    this.info = r || {};
    await this.post({ jsonrpc: '2.0', method: 'notifications/initialized' }, 10000).catch(() => {});
    this.listo = true;
    return this.info;
  }
  llamar(metodo, params, ms) { return this.post({ jsonrpc: '2.0', id: ++this.id, method: metodo, params: params || {} }, ms); }
  cerrar() { this.listo = false; if (this.sesion) fetch(this.def.url, { method: 'DELETE', headers: this.cab(), signal: AbortSignal.timeout(3000) }).catch(() => {}); }
}

/* ------------------------------------------------- riesgo de una herramienta */
function riesgoDe(t) {
  const a = (t && t.annotations) || {};
  if (a.readOnlyHint === true) return 'leer';
  if (a.destructiveHint === true) return 'peligro';
  const n = String((t && t.name) || '').toLowerCase();
  if (/^(get|list|read|search|find|fetch|query|view|show|describe|status|snapshot|screenshot|take_screenshot|ver|leer|listar|buscar|estado|ranking)\b|^(get|list|read|search|find|fetch|query|view)[_-]/.test(n)) return 'leer';
  if (/(delete|remove|drop|kill|destroy|erase|format|wipe|uninstall|borrar|eliminar)/.test(n)) return 'peligro';
  return 'accion';
}

/* =========================================================================
   Conexiones: lista de servidores + conexiones vivas
   ========================================================================= */
class Conexiones {
  constructor(op) {
    this.dir = op.dir; this.log = op.log || (() => {});
    this.ruta = path.join(op.dir, 'mcp.json');
    this.d = leerJSON(this.ruta) || { version: 1, servidores: [], iniciado: false };
    if (!Array.isArray(this.d.servidores)) this.d.servidores = [];
    this.internos = new Map();        // id → {id, nombre, desc, bot, herramientas(), llamar(nombre,args)}
    this.vivos = new Map();           // id → {cli, tools, t, error}
    this.rutaNoviqMcp = op.rutaNoviqMcp;
    this.oyentes = [];
  }
  guardar() { try { escribirJSON(this.ruta, this.d); } catch (e) { this.log('mcp: no pude guardar: ' + e.message); } }
  alCambiar(cb) { this.oyentes.push(cb); }
  avisar() { for (const cb of this.oyentes) { try { cb(); } catch (_) { /* nada */ } } }

  registrarInterno(s) { this.internos.set(s.id, s); }

  /** Primera vez: deja listo el servidor MCP de Noviq si el archivo existe. */
  sembrar() {
    // (2.3) si la primera vez no lo encontró —p. ej. el avatar se abrió desde otra carpeta—, lo intenta una vez más
    // (2.4) el servidor «programador» se agrega UNA vez (si lo quitas en Ajustes no vuelve a aparecer)
    if (this.d.iniciado && this.d.noviqSembrado && this.d.programadorSembrado) return;
    const primera = !this.d.iniciado;
    this.d.iniciado = true;
    const ps = presets({ rutaNoviqMcp: this.rutaNoviqMcp });
    const p = ps.find((x) => x.id === 'noviq');
    try {
      if (p && fs.existsSync(p.args[0]) && !this.d.noviqSembrado) {
        if (!this.def('noviq') && (primera || !this.d.noviqSembrado)) this.d.servidores.push(this.normalizar(Object.assign({ activo: true }, p)));
        this.d.noviqSembrado = true;
      }
    } catch (_) { /* sin Noviq local */ }
    const pg = ps.find((x) => x.id === 'programador');
    try {
      if (pg && fs.existsSync(pg.args[0]) && !this.d.programadorSembrado) {
        if (!this.def('programador')) this.d.servidores.push(this.normalizar(Object.assign({ activo: true }, pg)));
        this.d.programadorSembrado = true;
      }
    } catch (_) { /* sin Noviq local */ }
    this.guardar();
  }

  normalizar(s) {
    if (!s || typeof s !== 'object') throw new Error('servidor inválido');
    const id = String(s.id || '').trim().toLowerCase();
    if (!SLUG.test(id)) throw new Error('El id debe tener 1–24 letras minúsculas, números, - o _ (ej.: «archivos»).');
    if (RESERVADOS.has(id)) throw new Error('«' + id + '» es un nombre reservado de un bot interno.');
    const tipo = s.tipo === 'http' ? 'http' : 'stdio';
    const out = { id, nombre: String(s.nombre || id).slice(0, 60), tipo, activo: s.activo !== false, bot: String(s.bot || s.desc || '').slice(0, 200),
      instrucciones: String(s.instrucciones || '').slice(0, 800), confianza: s.confianza === 'alta' ? 'alta' : 'normal' };
    if (tipo === 'stdio') {
      const comando = String(s.comando || '').trim();
      if (!comando || comando.length > 300 || /[\r\n]/.test(comando)) throw new Error('Falta el comando (ej.: npx, uvx, python, node o la ruta de un programa).');
      out.comando = comando;
      out.args = (Array.isArray(s.args) ? s.args : String(s.args || '').match(/"[^"]*"|\S+/g) || []).map((a) => String(a).replace(/^"|"$/g, '')).filter((a) => a.length <= 400 && !/[\r\n]/.test(a)).slice(0, 40);
      const env = {};
      for (const [k, v] of Object.entries(s.env || {})) if (/^[A-Za-z_][A-Za-z0-9_]{0,60}$/.test(k)) env[k] = String(v).slice(0, 500);
      out.env = env;
      if (s.carpeta) out.carpeta = String(s.carpeta).slice(0, 300);
    } else {
      let u;
      try { u = new URL(String(s.url || '')); } catch (_) { throw new Error('La URL no es válida (ej.: http://127.0.0.1:8000/mcp).'); }
      if (!/^https?:$/.test(u.protocol)) throw new Error('La URL debe empezar por http:// o https://');
      out.url = u.toString();
      if (s.token) out.token = String(s.token).slice(0, 500);
      const cab = {};
      for (const [k, v] of Object.entries(s.cabeceras || {})) if (/^[A-Za-z0-9-]{1,60}$/.test(k) && !/^(host|content-length)$/i.test(k)) cab[k] = String(v).slice(0, 500);
      out.cabeceras = cab;
    }
    return out;
  }

  /** Añade o reemplaza (por id). Las claves/tokens no se devuelven por la API (ver publica). */
  poner(s) {
    const previo = this.d.servidores.find((x) => x.id === String(s.id || '').toLowerCase());
    if (previo && s.token == null && previo.token) s = Object.assign({}, s, { token: previo.token });
    const n = this.normalizar(s);
    const i = this.d.servidores.findIndex((x) => x.id === n.id);
    this.cerrar(n.id);
    if (i >= 0) this.d.servidores[i] = n; else this.d.servidores.push(n);
    this.guardar(); this.avisar();
    return n;
  }
  quitar(id) {
    const i = this.d.servidores.findIndex((x) => x.id === id);
    if (i < 0) return false;
    this.cerrar(id); this.d.servidores.splice(i, 1); this.guardar(); this.avisar();
    return true;
  }
  activar(id, si) {
    const s = this.d.servidores.find((x) => x.id === id);
    if (!s) return false;
    s.activo = !!si; if (!si) this.cerrar(id);
    this.guardar(); this.avisar();
    return true;
  }
  def(id) { return this.d.servidores.find((x) => x.id === id) || null; }

  /** Lista para la página: sin tokens ni valores de variables de entorno. */
  publica() {
    const ext = this.d.servidores.map((s) => {
      const v = this.vivos.get(s.id);
      return { id: s.id, nombre: s.nombre, tipo: s.tipo, activo: s.activo, bot: s.bot, instrucciones: s.instrucciones, confianza: s.confianza,
        comando: s.comando || null, args: s.args || null, url: s.url || null, envClaves: s.env ? Object.keys(s.env) : [], conToken: !!s.token,
        estado: !s.activo ? 'apagado' : v && v.cli && v.cli.listo ? 'conectado' : v && v.error ? 'error' : 'sin_iniciar',
        error: (v && v.error) || '', herramientas: v && v.tools ? v.tools.length : null, interno: false };
    });
    const int = [...this.internos.values()].map((s) => ({ id: s.id, nombre: s.nombre, tipo: 'interno', activo: true, bot: s.bot || '', estado: 'conectado', error: '',
      herramientas: s.herramientas().length, interno: true }));
    return int.concat(ext);
  }

  /* ---- conexión viva ---- */
  async conectar(id) {
    if (this.internos.has(id)) return this.internos.get(id);
    const def = this.def(id);
    if (!def) throw new Error('No existe el servidor MCP «' + id + '».');
    if (!def.activo) throw new Error('El servidor «' + id + '» está apagado.');
    let v = this.vivos.get(id);
    if (v && v.cli && v.cli.listo) return v;
    if (v && v.pendiente) return v.pendiente;
    v = { cli: null, tools: null, error: '', t: 0 };
    this.vivos.set(id, v);
    v.pendiente = (async () => {
      try {
        const cli = def.tipo === 'http' ? new ClienteHttp(def, this.log) : new ClienteStdio(def, this.log);
        v.cli = cli;
        await cli.iniciar();
        v.error = '';
        v.tools = await this.listarDe(cli);
        v.t = Date.now();
        return v;
      } catch (e) {
        v.error = String(e.message || e).slice(0, 300);
        try { v.cli && v.cli.cerrar(); } catch (_) { /* ya */ }
        throw e;
      } finally { delete v.pendiente; }
    })();
    return v.pendiente;
  }
  async listarDe(cli) {
    const out = []; let cursor;
    for (let i = 0; i < 10; i++) {
      const r = await cli.llamar('tools/list', cursor ? { cursor } : {}, 30000);
      for (const t of (r && r.tools) || []) out.push({ name: t.name, description: String(t.description || '').slice(0, 600), inputSchema: t.inputSchema || { type: 'object', properties: {} }, riesgo: riesgoDe(t) });
      cursor = r && r.nextCursor; if (!cursor) break;
    }
    return out;
  }
  /** Herramientas de un servidor (interno o externo): [{name, description, inputSchema, riesgo}] */
  async herramientas(id) {
    if (this.internos.has(id)) return this.internos.get(id).herramientas();
    const v = await this.conectar(id);
    return v.tools || [];
  }
  async llamar(id, nombre, args) {
    if (this.internos.has(id)) return this.internos.get(id).llamar(nombre, args || {});
    const v = await this.conectar(id);
    if (!(v.tools || []).some((t) => t.name === nombre)) throw new Error('«' + id + '» no tiene la herramienta «' + nombre + '».');
    const r = await v.cli.llamar('tools/call', { name: nombre, arguments: args || {} }, 120000);
    const texto = ((r && r.content) || []).map((c) => c.type === 'text' ? c.text : c.type === 'image' ? '[imagen ' + (c.mimeType || '') + ' omitida]' : c.type === 'resource' ? JSON.stringify(c.resource || {}).slice(0, 2000) : '').filter(Boolean).join('\n');
    if (r && r.isError) return { ok: false, error: texto.slice(0, 600) || 'el servidor devolvió un error' };
    return { ok: true, datos: texto || (r && r.structuredContent ? JSON.stringify(r.structuredContent) : '(sin contenido)') };
  }
  async probar(id) {
    try {
      const v = this.internos.has(id) ? null : (this.cerrar(id), await this.conectar(id));
      const tools = v ? v.tools : this.internos.get(id).herramientas();
      return { ok: true, herramientas: tools.map((t) => ({ nombre: t.name, desc: t.description, riesgo: t.riesgo })), servidor: v && v.cli && v.cli.info && v.cli.info.serverInfo || null };
    } catch (e) { return { ok: false, error: String(e.message || e) }; }
  }
  /** Prueba una definición SIN guardarla (para el botón «Probar» antes de añadir). */
  async probarDef(s) {
    const n = this.normalizar(Object.assign({ activo: true }, s));
    const cli = n.tipo === 'http' ? new ClienteHttp(n, this.log) : new ClienteStdio(n, this.log);
    try {
      await cli.iniciar();
      const tools = await this.listarDe(cli);
      return { ok: true, herramientas: tools.map((t) => ({ nombre: t.name, desc: t.description, riesgo: t.riesgo })) };
    } catch (e) { return { ok: false, error: String(e.message || e) }; } finally { cli.cerrar(); }
  }
  cerrar(id) { const v = this.vivos.get(id); if (v && v.cli) v.cli.cerrar(); this.vivos.delete(id); }
  cerrarTodo() { for (const id of [...this.vivos.keys()]) this.cerrar(id); }
  /** Cierra los que llevan rato sin usarse (ahorra memoria). */
  soltarInactivos(ms) { for (const [id, v] of this.vivos) if (v.cli && v.cli.listo && Date.now() - (v.uso || v.t) > (ms || 15 * 60000)) this.cerrar(id); }
}

module.exports = { Conexiones, ClienteStdio, ClienteHttp, presets, pythonDeNoviq, riesgoDe, SLUG, RESERVADOS, PROTO };
