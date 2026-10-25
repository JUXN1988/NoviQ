'use strict';
/* ==========================================================================
   Noviq Avatar — API local HTTP + WebSocket
   Solo escucha en 127.0.0.1. Protecciones: validación de Host (anti DNS
   rebinding), bloqueo de peticiones de otras webs (Origin / Sec-Fetch-Site),
   token opcional y límite de tamaño del cuerpo.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const { URL } = require('url');
const { WebSocketServer } = require('ws');
const { listaComandos, EXPRESIONES, GESTOS, ICONOS, LUGARES } = require('./comandos');

const MAX_CUERPO = 8 * 1024 * 1024;   // (los audios de voz caben de sobra)

function crearAPI(op) {
  const { puerto, host = '127.0.0.1', token = '', origenesPermitidos = [], ejecutar, estado, rutaPanel, version = '1.0.0', log = console.log, charlar } = op;
  const rutas = op.rutas || [];                 // [{metodo, ruta: '/x' | RegExp, manejador(ctx) → {codigo, datos} | {html} | {archivo}}]
  const claveApi = op.claveApi || (() => '');   // clave «av-…» para otros programas (obligatoria en /v1/*)
  const estaticos = op.estaticos || {};         // {'/ajustes/': carpeta}
  const hostsValidos = new Set([`127.0.0.1:${puerto}`, `localhost:${puerto}`, `[::1]:${puerto}`]);
  const origenesPropios = new Set([`http://127.0.0.1:${puerto}`, `http://localhost:${puerto}`]);

  function origenPermitido(origen) {
    if (!origen || origen === 'null') return true;
    if (origenesPropios.has(origen)) return true;
    return origenesPermitidos.includes('*') || origenesPermitidos.includes(origen);
  }

  function validar(req, url) {
    if (!hostsValidos.has(String(req.headers.host || '').toLowerCase())) return [403, 'Host no permitido'];
    const origen = req.headers.origin;
    if (origen && !origenPermitido(origen)) return [403, 'Origen no permitido: ' + origen + ' (añádelo a "origenesPermitidos" en config.json)'];
    if (!origen && req.headers['sec-fetch-site'] === 'cross-site' && !origenesPermitidos.includes('*')) return [403, 'Petición entre sitios bloqueada'];
    const t = req.headers['x-noviq-token'] || (url && url.searchParams.get('token')) || String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    const ruta = url ? url.pathname : '';
    if (/^\/(v1\/|mcp$)/.test(ruta)) {   // compatible con OpenAI: siempre con la clave del avatar
      const k = claveApi();
      if (!k || t !== k) return [401, 'Falta la clave del avatar (Authorization: Bearer av-…). Está en sus Ajustes → API.'];
      return null;
    }
    if (token && t !== token && !(claveApi() && t === claveApi())) return [401, 'Token inválido o ausente (cabecera X-Noviq-Token)'];
    return null;
  }

  function cabecerasCors(req) {
    const origen = req.headers.origin;
    if (!origen || !origenPermitido(origen)) return {};
    return {
      'Access-Control-Allow-Origin': origen,
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Noviq-Token, Authorization',
      'Vary': 'Origin'
    };
  }

  function responder(req, res, codigo, datos, tipo, extra) {
    const cuerpo = tipo ? datos : JSON.stringify(datos, null, 2);
    res.writeHead(codigo, Object.assign({ 'Content-Type': tipo || 'application/json; charset=utf-8', 'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff' }, cabecerasCors(req), extra || {}));
    res.end(cuerpo);
  }
  const TIPOS = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.svg': 'image/svg+xml',
    '.png': 'image/png', '.ico': 'image/x-icon', '.json': 'application/json; charset=utf-8', '.woff2': 'font/woff2' };
  // Las páginas propias (ajustes) solo se pueden incrustar desde esta PC (Noviq las muestra en su pestaña Avatar)
  const CSP_PAGINA = { 'Content-Security-Policy': "frame-ancestors 'self' http://127.0.0.1:* http://localhost:*", 'Referrer-Policy': 'no-referrer' };
  function servirEstatico(req, res, ruta) {
    for (const [pref, dir] of Object.entries(estaticos)) {
      if (!ruta.startsWith(pref.replace(/\/$/, ''))) continue;
      let rel = ruta.slice(pref.replace(/\/$/, '').length).replace(/^\/+/, '') || 'index.html';
      const abs = require('path').resolve(dir, rel);
      if (!abs.startsWith(require('path').resolve(dir))) return responder(req, res, 403, { ok: false, error: 'Ruta no permitida' }), true;
      let datos;
      try { datos = fs.readFileSync(abs); } catch (_) { return false; }
      const ext = require('path').extname(abs).toLowerCase();
      let cuerpo = datos;
      if (ext === '.html') cuerpo = datos.toString('utf8').replace(/__TOKEN__/g, token ? JSON.stringify(token).slice(1, -1) : '');
      responder(req, res, 200, cuerpo, TIPOS[ext] || 'application/octet-stream', ext === '.html' ? CSP_PAGINA : {});
      return true;
    }
    return false;
  }
  async function leerJSONCuerpo(req) {
    const txt = await leerCuerpo(req);
    if (!txt.trim()) return {};
    try { return JSON.parse(txt); } catch (e) { throw Object.assign(new Error('JSON inválido'), { codigo: 400 }); }
  }

  function leerCuerpo(req) {
    return new Promise((resolve, reject) => {
      let tam = 0; const trozos = [];
      req.on('data', (c) => { tam += c.length; if (tam > MAX_CUERPO) { reject(Object.assign(new Error('Cuerpo demasiado grande'), { codigo: 413 })); req.destroy(); } else trozos.push(c); });
      req.on('end', () => resolve(Buffer.concat(trozos).toString('utf8')));
      req.on('error', reject);
    });
  }

  function valorQuery(v) {
    if (v === 'true') return true;
    if (v === 'false') return false;
    if (v !== '' && !isNaN(Number(v))) return Number(v);
    return v;
  }

  const ayuda = () => ({
    nombre: 'Noviq Avatar API', version,
    base: `http://127.0.0.1:${puerto}`,
    endpoints: {
      'POST /comando': 'Cuerpo JSON: {"cmd":"reir"} | ["...lista = secuencia"] | "decir Hola". Añade ?esperar=1 (o "esperar": true) para responder cuando termine.',
      'GET /cmd/{nombre}?param=valor': 'Atajo rápido para probar desde el navegador. Ej: /cmd/decir?texto=Hola',
      'GET /estado': 'Estado actual (posición, acción, expresión, modo, visible...).',
      'GET /comandos': 'Lista de comandos con descripción y ejemplo.',
      'GET /panel': 'Panel de pruebas con botones.',
      'POST /charla': 'Conversa con el bot: {"texto":"Hola"} → {"respuesta":…}. Con "hablar": false no lo dice en voz alta.',
      'GET /ajustes': 'Página de ajustes del avatar (voz, oído, cerebro, personalidad, memoria, herramientas, API).',
      'GET|POST /api/ajustes': 'Lee o cambia sus ajustes (JSON parcial: {"voz":{"velocidad":1.1}}).',
      'GET|POST /api/memoria': 'Su memoria propia (quién eres, datos, recordatorios, planes, lo aprendido).',
      'GET /api/herramientas · POST /api/herramienta': 'Sus herramientas (y las de Noviq si está conectado). {"nombre":"buscar_internet","args":{…}}',
      'GET /api/agentes · POST /api/agentes/delegar|cancelar': 'Bots internos y trabajos en segundo plano. {"bot":"pc","orden":"…","esperar":false}.',
      'GET|POST /api/mcp/servidores · POST /api/mcp/probar|llamar': 'Servidores MCP que usa el avatar (stdio/HTTP).',
      'POST /api/vision/ver': 'Mira por la cámara o la pantalla: {"fuente":"camara|pantalla","pregunta":"…"}.',
      'POST /mcp': 'El avatar como servidor MCP (clave av-… obligatoria).',
      'POST /api/voz/hablar · POST /api/voz/escuchar': 'Texto → audio (base64) · audio WAV base64 → texto (y lo entiende si "entender": true).',
      'POST /api/eventos-app': 'Otros programas le cuentan cosas: {"app":"mi-app","tipo":"nota","texto":"…"}.',
      'GET /v1/models · POST /v1/chat/completions': 'Compatible con OpenAI (Authorization: Bearer av-…): úsalo como si fuera un modelo.',
      'WS /ws': 'WebSocket: envía comandos JSON; recibe {tipo:"evento"} y {tipo:"respuesta"}.'
    },
    expresiones: EXPRESIONES, gestos: GESTOS, iconos: ICONOS, lugares: LUGARES
  });

  async function correr(entrada, esperar) {
    return await ejecutar(entrada, { esperar });
  }

  const servidor = http.createServer(async (req, res) => {
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${puerto}`); } catch (_) { return responder(req, res, 400, { ok: false, error: 'URL inválida' }); }
    const err = validar(req, url);
    if (err) return responder(req, res, err[0], { ok: false, error: err[1] });
    if (req.method === 'OPTIONS') { res.writeHead(204, cabecerasCors(req)); return res.end(); }

    const ruta = url.pathname.replace(/\/+$/, '') || '/';
    try {
      if (req.method === 'GET' && (ruta === '/' || ruta === '/ayuda' || ruta === '/help')) return responder(req, res, 200, ayuda());
      if (req.method === 'GET' && (ruta === '/estado' || ruta === '/state' || ruta === '/status')) return responder(req, res, 200, Object.assign({ ok: true }, estado()));
      if (req.method === 'GET' && (ruta === '/comandos' || ruta === '/commands')) return responder(req, res, 200, { ok: true, comandos: listaComandos() });
      if (req.method === 'GET' && ruta === '/panel') {
        const html = fs.readFileSync(rutaPanel, 'utf8').replace('__TOKEN__', token ? JSON.stringify(token).slice(1, -1) : '');
        return responder(req, res, 200, html, 'text/html; charset=utf-8');
      }
      if (req.method === 'GET' && ruta.startsWith('/cmd/')) {
        const params = {};
        for (const [k, v] of url.searchParams) if (k !== 'token' && k !== 'esperar') params[k] = valorQuery(v);
        const cmd = Object.assign({ cmd: decodeURIComponent(ruta.slice(5)) }, params);
        const r = await correr(cmd, url.searchParams.get('esperar') === '1' || url.searchParams.get('esperar') === 'true');
        return responder(req, res, r.ok ? 200 : 400, r);
      }
      if (req.method === 'POST' && (ruta === '/charla' || ruta === '/chat') && charlar) {
        let cuerpo;
        try { cuerpo = JSON.parse((await leerCuerpo(req)) || '{}'); } catch (e) { return responder(req, res, 400, { ok: false, error: 'JSON inválido' }); }
        const r = await charlar(cuerpo || {});
        return responder(req, res, r && r.ok === false ? 502 : 200, r);
      }
      for (const r of rutas) {
        if (r.metodo && r.metodo !== req.method && !(Array.isArray(r.metodo) && r.metodo.includes(req.method))) continue;
        const m = r.ruta instanceof RegExp ? ruta.match(r.ruta) : (ruta === r.ruta ? [ruta] : null);
        if (!m) continue;
        const cuerpo = req.method === 'POST' ? await leerJSONCuerpo(req) : {};
        const out = await r.manejador({ req, res, url, cuerpo, m, query: Object.fromEntries(url.searchParams) });
        if (!out || out.manejado) return;   // la ruta ya respondió (p. ej. streaming)
        if (out.html != null) return responder(req, res, out.codigo || 200, out.html, 'text/html; charset=utf-8', CSP_PAGINA);
        return responder(req, res, out.codigo || (out.datos && out.datos.ok === false ? 400 : 200), out.datos != null ? out.datos : out);
      }
      if (req.method === 'GET' && servirEstatico(req, res, ruta)) return;
      if (req.method === 'POST' && (ruta === '/comando' || ruta === '/command' || ruta === '/cmd')) {
        const ct = String(req.headers['content-type'] || '');
        if (req.headers.origin && !ct.includes('application/json')) return responder(req, res, 415, { ok: false, error: 'Usa Content-Type: application/json' });
        const texto = await leerCuerpo(req);
        let entrada;
        try { entrada = texto.trim().startsWith('{') || texto.trim().startsWith('[') || texto.trim().startsWith('"') ? JSON.parse(texto) : texto.trim(); }
        catch (e) { return responder(req, res, 400, { ok: false, error: 'JSON inválido: ' + e.message }); }
        const esperar = url.searchParams.get('esperar') === '1' || url.searchParams.get('esperar') === 'true' || (entrada && entrada.esperar === true);
        const r = await correr(entrada, esperar);
        return responder(req, res, r.ok ? 200 : 400, r);
      }
      return responder(req, res, 404, { ok: false, error: 'Ruta no encontrada. Visita GET / para ver la ayuda.' });
    } catch (e) {
      return responder(req, res, e.codigo || 500, { ok: false, error: String(e && e.message || e) });
    }
  });

  // ---------------------------------------------------------------- WebSocket
  const wss = new WebSocketServer({ noServer: true, maxPayload: MAX_CUERPO });
  servidor.on('upgrade', (req, socket, head) => {
    let url;
    try { url = new URL(req.url, `http://127.0.0.1:${puerto}`); } catch (_) { return socket.destroy(); }
    const err = validar(req, url);
    if (err || url.pathname.replace(/\/+$/, '') !== '/ws') {
      socket.write(`HTTP/1.1 ${err ? err[0] : 404} ${err ? 'Forbidden' : 'Not Found'}\r\n\r\n`);
      return socket.destroy();
    }
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  wss.on('connection', (ws) => {
    ws.send(JSON.stringify({ tipo: 'bienvenida', version, estado: estado() }));
    ws.on('message', async (buf) => {
      let msg;
      const txt = buf.toString('utf8');
      try { msg = txt.trim().startsWith('{') || txt.trim().startsWith('[') ? JSON.parse(txt) : txt.trim(); }
      catch (e) { return ws.send(JSON.stringify({ tipo: 'respuesta', ok: false, error: 'JSON inválido' })); }
      const ref = msg && msg.ref;
      const esperar = !!(msg && msg.esperar);
      const r = await correr(msg, esperar);
      if (ws.readyState === 1) ws.send(JSON.stringify(Object.assign({ tipo: 'respuesta', ref }, r)));
    });
  });

  function emitir(nombre, datos) {
    const j = JSON.stringify({ tipo: 'evento', nombre, datos: datos || {}, t: Date.now() });
    for (const c of wss.clients) if (c.readyState === 1) c.send(j);
  }

  const escuchando = new Promise((resolve, reject) => {
    servidor.once('error', reject);
    servidor.listen(puerto, host, () => { log(`[noviq-avatar] API en http://${host}:${puerto}  (panel: /panel)`); resolve(); });
  });

  return { emitir, escuchando, responder, cerrar: () => new Promise((r) => { for (const c of wss.clients) c.terminate(); servidor.close(() => r()); }) };
}

module.exports = { crearAPI };
