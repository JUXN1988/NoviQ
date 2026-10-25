'use strict';
/* ==========================================================================
   Noviq Avatar — Conector con Noviq
   El avatar es independiente (su memoria, ajustes, voz, oído e IA son suyos).
   Cuando Noviq está abierto, este conector le deja usar TODO lo de Noviq:
     · sus herramientas y agentes (tareas en el PC, proyectos, internet…)
     · su IA más rápida, sus voces (Piper sin internet) y su oído (faster-whisper)
     · los avisos de sus trabajos (Noviq le manda comandos por la API del avatar)
   Encuentra Noviq solo (variables NOVIQ_APP_URL/NOVIQ_APP_TOKEN, comando
   "vincular" o el archivo datos/.token de la carpeta de Noviq) y comprueba
   cada 10 s que siga vivo. Solo habla con 127.0.0.1.
   ========================================================================== */
const http = require('http');
const fs = require('fs');
const path = require('path');
const { URL } = require('url');

function rutasToken() {
  const r = [];
  if (process.env.NOVIQ_DATOS) r.push(path.join(process.env.NOVIQ_DATOS, '.token'));
  r.push(path.join(__dirname, '..', '..', 'datos', '.token'));                     // …\Noviq\noviq-avatar\src → …\Noviq\datos
  r.push(path.join(__dirname, '..', 'datos', '.token'));                           // (si el avatar quedó copiado en la raíz de Noviq)
  if (process.env.PORTABLE_EXECUTABLE_DIR) r.push(path.join(process.env.PORTABLE_EXECUTABLE_DIR, '..', 'datos', '.token'));
  r.push(path.join(path.dirname(process.execPath), '..', 'datos', '.token'));
  if (process.env.APPDATA) r.push(path.join(process.env.APPDATA, 'Noviq', '.token'));   // Noviq instalado (.exe)
  return r;
}

class PuenteNoviq {
  constructor(op) {
    op = op || {};
    this.log = op.log || console.log;
    this.alCambiar = op.alCambiar || (() => {});
    this.url = (process.env.NOVIQ_APP_URL || '').replace(/\/+$/, '');
    this.token = process.env.NOVIQ_APP_TOKEN || '';
    this.lanzadoPorNoviq = !!process.env.NOVIQ_APP_URL;
    this.activo = op.activo !== false;      // ajustes → noviq.usar
    this.conectado = false; this.fallos = 0; this.ultimoOk = 0; this.info = {};
    this.timer = null; this.cache = {};
    if (!this.url || !this.token) this.descubrir();
  }

  descubrir() {
    for (const f of rutasToken()) {
      try {
        const t = fs.readFileSync(f, 'utf8').trim();
        if (t) { this.token = t; if (!this.url) this.url = 'http://127.0.0.1:' + (process.env.NVIDIA_CHAT_PORT || 7860); return true; }
      } catch (_) { /* siguiente */ }
    }
    return false;
  }

  vincular(p) {
    p = p || {};
    if (p.url) {
      const u = new URL(String(p.url));
      if (!['127.0.0.1', 'localhost'].includes(u.hostname)) throw new Error('Solo se puede vincular con Noviq en esta PC (127.0.0.1).');
      this.url = u.origin;
    }
    if (p.token) this.token = String(p.token);
    if (p.lanzado != null) this.lanzadoPorNoviq = !!p.lanzado;
    this.fallos = 0;
    this.latido();
    return this.estado();
  }

  estado() { return { conectado: this.conectado, url: this.url || null, lanzadoPorNoviq: this.lanzadoPorNoviq, ultimoOk: this.ultimoOk || null, activo: this.activo, version: this.info.version || null }; }

  peticion(metodo, ruta, cuerpo, espera) {
    return new Promise((resolve) => {
      if (!this.activo) return resolve({ ok: false, error: 'La conexión con Noviq está apagada en los ajustes del avatar.', sinNoviq: true });
      if (!this.url || !this.token) this.descubrir();
      if (!this.url || !this.token) return resolve({ ok: false, error: 'Noviq no está vinculado', sinNoviq: true });
      let u;
      try { u = new URL(this.url + ruta); } catch (e) { return resolve({ ok: false, error: 'URL inválida' }); }
      const datos = cuerpo != null ? Buffer.from(JSON.stringify(cuerpo), 'utf8') : null;
      const req = http.request({ hostname: u.hostname, port: u.port, path: u.pathname + u.search, method: metodo,
        headers: Object.assign({ 'X-Token': this.token, 'Accept': 'application/json' }, datos ? { 'Content-Type': 'application/json', 'Content-Length': datos.length } : {}) }, (res) => {
        const trozos = [];
        res.on('data', (c) => trozos.push(c));
        res.on('end', () => {
          const txt = Buffer.concat(trozos).toString('utf8');
          if (res.statusCode === 403) { this.descubrir(); return resolve({ ok: false, error: 'Noviq rechazó el token (se reinició): vuelvo a intentarlo', codigo: 403 }); }
          if (res.statusCode === 404) return resolve({ ok: false, codigo: 404, error: 'Esta versión de Noviq no tiene esa función (actualízalo).' });
          try { resolve(Object.assign({ codigo: res.statusCode }, JSON.parse(txt || '{}'))); }
          catch (_) { resolve({ ok: false, codigo: res.statusCode, error: txt.slice(0, 200) }); }
        });
      });
      req.setTimeout(espera || 8000, () => { req.destroy(new Error('Noviq no respondió a tiempo')); });
      req.on('error', (e) => resolve({ ok: false, error: e.code === 'ECONNREFUSED' ? 'Noviq no está abierto' : String(e.message || e), sinNoviq: e.code === 'ECONNREFUSED' }));
      if (datos) req.write(datos);
      req.end();
    });
  }

  evento(nombre, datos) {
    if (!this.url || !this.activo) return Promise.resolve({ ok: false });
    return this.peticion('POST', '/api/avatar/evento', { nombre, datos: datos || {} }, 4000);
  }

  /* ----------------------------------------- Lo que el avatar usa de Noviq */
  /** ¿Es para Noviq? (respuesta a su pregunta abierta, «detente», «¿cómo vas?», «continúa»…) */
  escucha(texto, op) { return this.peticion('POST', '/api/avatar/escucha', Object.assign({ texto }, op || {}), 3500); }
  /** Manda una orden de trabajo a los agentes de Noviq. */
  tarea(op) { return this.peticion('POST', '/api/avatar/tarea', op, 25000); }
  /** Herramientas de Noviq que el avatar puede usar directamente. */
  async herramientas() {
    const c = this.cache.herr;
    if (c && Date.now() - c.t < 60000) return c.v;
    const r = await this.peticion('GET', '/api/avatar/herramientas', null, 5000);
    const v = r && r.ok ? r.herramientas || [] : [];
    this.cache.herr = { t: Date.now(), v };
    return v;
  }
  usar(nombre, args) { return this.peticion('POST', '/api/avatar/herramienta', { nombre, args: args || {} }, 90000); }
  /** Lo que pasa en Noviq (trabajos, proyectos, chat abierto) para que el avatar lo tenga en cuenta. */
  async contexto() {
    const c = this.cache.ctx;
    if (c && Date.now() - c.t < 8000) return c.v;
    const r = await this.peticion('GET', '/api/avatar/contexto-noviq', null, 3000);
    const v = r && r.ok ? r : null;
    this.cache.ctx = { t: Date.now(), v };
    return v;
  }
  pensar(op, espera) { return this.peticion('POST', '/api/avatar/pensar', op, espera || 25000); }
  tts(texto, op) { return this.peticion('POST', '/api/avatar/tts', Object.assign({ texto: String(texto).slice(0, 1500) }, op || {}), 25000); }
  stt(audioB64, op) { return this.peticion('POST', '/api/avatar/stt', Object.assign({ audio: audioB64 }, op || {}), 60000); }
  voces() { return this.peticion('GET', '/api/avatar/voces', null, 6000); }
  /** Lo que el avatar tenía en Noviq antes de ser independiente (ajustes y memoria), para traerlo una vez. */
  herencia() { return this.peticion('GET', '/api/avatar/herencia', null, 8000); }
  /** Claves de IA de Noviq (solo cuando el usuario pulsa «Traer mis claves de Noviq»). */
  claves() { return this.peticion('POST', '/api/avatar/claves', { confirmar: true }, 6000); }

  async latido() {
    if (!this.activo) { const antes = this.conectado; this.conectado = false; if (antes) this.alCambiar(false, this.estado()); return false; }
    if (!this.url || !this.token) this.descubrir();
    const r = await this.peticion('GET', '/api/avatar/latido', null, 4000);
    const antes = this.conectado;
    if (r && r.ok) { this.conectado = true; this.fallos = 0; this.ultimoOk = Date.now(); this.info = r; }
    else { this.fallos++; if (this.fallos >= 2) this.conectado = false; }
    if (antes !== this.conectado) { this.cache = {}; try { this.alCambiar(this.conectado, this.estado()); } catch (_) { /* noop */ } }
    return this.conectado;
  }

  activar(v) { this.activo = !!v; this.cache = {}; this.latido(); }
  iniciar(cadaMs) {
    clearInterval(this.timer);
    this.latido();
    this.timer = setInterval(() => this.latido(), cadaMs || 10000);
  }
  detener() { clearInterval(this.timer); }
}

module.exports = { PuenteNoviq };
