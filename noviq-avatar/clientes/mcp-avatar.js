#!/usr/bin/env node
'use strict';
/* ==========================================================================
   Noviq Avatar — Servidor MCP (stdio) para usar al avatar desde cualquier app
   compatible con MCP (Claude Desktop, VS Code, Cursor, LM Studio, Noviq…).
   Sin dependencias: Node 18+.

   Configuración típica:
     { "mcpServers": { "noviq-avatar": { "command": "node",
         "args": ["C:\\...\\noviq-avatar\\clientes\\mcp-avatar.js"],
         "env": { "NOVIQ_AVATAR_URL": "http://127.0.0.1:7777" } } } }
   (NOVIQ_AVATAR_TOKEN si configuraste un token en config.json)
   ========================================================================== */
const BASE = (process.env.NOVIQ_AVATAR_URL || 'http://127.0.0.1:7777').replace(/\/+$/, '');
const TOKEN = process.env.NOVIQ_AVATAR_TOKEN || '';

async function api(metodo, ruta, cuerpo, espera) {
  const r = await fetch(BASE + ruta, {
    method: metodo, signal: AbortSignal.timeout(espera || 60000),
    headers: Object.assign({ 'Content-Type': 'application/json' }, TOKEN ? { 'X-Noviq-Token': TOKEN } : {}),
    body: cuerpo ? JSON.stringify(cuerpo) : undefined
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.ok === false) throw new Error(j.error || `HTTP ${r.status}`);
  return j;
}

const HERRAMIENTAS = [
  { name: 'avatar_charlar', description: 'Conversa con el avatar (su mente propia: memoria del usuario, personalidad, IA y herramientas). Devuelve su respuesta; con hablar=true además la dice en voz alta.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, hablar: { type: 'boolean', default: false } }, required: ['texto'] },
    run: async (a) => { const r = await api('POST', '/charla', { texto: a.texto, hablar: !!a.hablar }, 90000); return r.respuesta || '(sin respuesta)'; } },
  { name: 'avatar_decir', description: 'El avatar dice un texto con burbuja, gesto y sonido (tipo: info | exito | error | atencion | pregunta | trabajando | saludo).',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, tipo: { type: 'string', default: 'info' }, voz: { type: 'boolean' } }, required: ['texto'] },
    run: async (a) => { await api('POST', '/comando', { cmd: 'aviso', tipo: a.tipo || 'info', texto: a.texto, voz: a.voz }); return 'dicho'; } },
  { name: 'avatar_comando', description: 'Ejecuta cualquier comando del cuerpo del avatar (reir, bailar, celebrar, ir {a:"centro"}, progreso {valor}, expresion {valor}…). Lista completa: GET /comandos.',
    inputSchema: { type: 'object', properties: { cmd: { type: 'string' }, params: { type: 'object' } }, required: ['cmd'] },
    run: async (a) => JSON.stringify(await api('POST', '/comando', Object.assign({ cmd: a.cmd }, a.params || {}))) },
  { name: 'avatar_recordar', description: 'Guarda un dato del usuario en la memoria permanente del avatar.',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
    run: async (a) => { await api('POST', '/comando?esperar=1', { cmd: 'recordar', texto: a.texto }); return 'recordado'; } },
  { name: 'avatar_recordatorio', description: 'Crea un recordatorio (cuando en palabras: «mañana a las 9», «en 20 minutos», «los lunes a las 7»).',
    inputSchema: { type: 'object', properties: { texto: { type: 'string' }, cuando: { type: 'string' } }, required: ['texto', 'cuando'] },
    run: async (a) => JSON.stringify((await api('POST', '/comando?esperar=1', { cmd: 'recordatorio', texto: a.texto, cuando: a.cuando })).resultado) },
  { name: 'avatar_memoria', description: 'Lee lo que el avatar sabe del usuario (nombre, datos, hechos, recordatorios, planes).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => { const m = (await api('GET', '/api/memoria')).memoria; return JSON.stringify({ usuario: m.usuario, hechos: m.hechos.map((h) => h.texto), recordatorios: m.recordatorios, planes: m.planes }, null, 1); } },
  { name: 'avatar_herramienta', description: 'Usa una herramienta del avatar (buscar_internet, leer_pagina, abrir, portapapeles_leer, calcular… y las de Noviq si está abierto).',
    inputSchema: { type: 'object', properties: { nombre: { type: 'string' }, args: { type: 'object' } }, required: ['nombre'] },
    run: async (a) => { const r = await api('POST', '/api/herramienta', { nombre: a.nombre, args: a.args || {} }, 90000); return typeof r.datos === 'string' ? r.datos : JSON.stringify(r.datos || r.decir || r); } },
  { name: 'avatar_bots', description: 'Lista los bots internos del avatar (pc, web, vision, noviq y los MCP conectados).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => JSON.stringify((await api('GET', '/api/agentes')).bots, null, 1) },
  { name: 'avatar_delegar', description: 'Manda una orden a un bot interno y espera su resultado (esperar:false = segundo plano).',
    inputSchema: { type: 'object', properties: { bot: { type: 'string' }, orden: { type: 'string' }, esperar: { type: 'boolean' } }, required: ['bot', 'orden'] },
    run: async (a) => { const r = await api('POST', '/api/agentes/delegar', { bot: a.bot, orden: a.orden, esperar: a.esperar !== false }, 300000); return JSON.stringify(r); } },
  { name: 'avatar_ver', description: 'Mira por la cámara (si el usuario la activó) o la pantalla y describe lo que ve.',
    inputSchema: { type: 'object', properties: { pregunta: { type: 'string' }, fuente: { type: 'string', enum: ['camara', 'pantalla'] } } },
    run: async (a) => { const r = await api('POST', '/api/vision/ver', { pregunta: a.pregunta || 'Describe lo que ves.', fuente: a.fuente || 'camara' }, 120000); return r.ok ? r.respuesta : 'Error: ' + r.error; } },
  { name: 'avatar_estado', description: 'Estado del avatar (visible, posición, conexión con Noviq, mente…).',
    inputSchema: { type: 'object', properties: {} },
    run: async () => JSON.stringify(await api('GET', '/estado'), null, 1) }
];

function responder(id, result, error) {
  process.stdout.write(JSON.stringify(error ? { jsonrpc: '2.0', id, error } : { jsonrpc: '2.0', id, result }) + '\n');
}
async function manejar(m) {
  const { id, method, params } = m;
  if (method === 'initialize') return responder(id, { protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'noviq-avatar', version: '2.0.0' } });
  if (method === 'ping') return responder(id, {});
  if (method === 'tools/list') return responder(id, { tools: HERRAMIENTAS.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
  if (method === 'tools/call') {
    const h = HERRAMIENTAS.find((x) => x.name === (params && params.name));
    if (!h) return responder(id, null, { code: -32602, message: 'Herramienta desconocida' });
    try { return responder(id, { content: [{ type: 'text', text: String(await h.run((params && params.arguments) || {})) }] }); }
    catch (e) { return responder(id, { content: [{ type: 'text', text: 'Error: ' + e.message + ` (¿está abierto el avatar en ${BASE}?)` }], isError: true }); }
  }
  if (id !== undefined && !String(method || '').startsWith('notifications/')) responder(id, null, { code: -32601, message: 'Método no soportado: ' + method });
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf('\n')) >= 0) {
    const linea = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
    if (!linea) continue;
    let m; try { m = JSON.parse(linea); } catch (_) { continue; }
    manejar(m).catch((e) => responder(m.id, null, { code: -32603, message: e.message }));
  }
});
