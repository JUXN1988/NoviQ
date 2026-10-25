/**
 * Cliente JavaScript para Noviq Avatar (Node 18+ o navegador/Electron; sin dependencias).
 *
 *   const { NoviqAvatar } = require('./noviq-avatar');
 *   const av = new NoviqAvatar();                 // http://127.0.0.1:7777
 *   await av.decir('Hola Gabriel');
 *   await av.comando('textear', { texto: 'Enviando...' }, { esperar: true });
 *   av.eventos((nombre, datos) => console.log(nombre, datos));   // clic, accion_fin, habla_fin...
 */
'use strict';

class NoviqAvatar {
  constructor({ host = '127.0.0.1', puerto = 7777, token = '' } = {}) {
    this.base = `http://${host}:${puerto}`;
    this.token = token;
  }

  async _peticion(metodo, ruta, cuerpo) {
    const cab = { 'Content-Type': 'application/json' };
    if (this.token) cab['X-Noviq-Token'] = this.token;
    let r;
    try {
      r = await fetch(this.base + ruta, { method: metodo, headers: cab, body: cuerpo == null ? undefined : JSON.stringify(cuerpo) });
    } catch (e) {
      throw new Error(`No se pudo conectar con el avatar en ${this.base}. ¿Está abierto?`);
    }
    const j = await r.json();
    if (!j.ok) throw new Error(j.error || 'Error del avatar');
    return j;
  }

  /** Envía cualquier comando. opciones.esperar = true → resuelve cuando la animación termina. */
  comando(cmd, params = {}, { esperar = false } = {}) {
    return this._peticion('POST', '/comando' + (esperar ? '?esperar=1' : ''), Object.assign({ cmd }, params));
  }
  secuencia(pasos, { esperar = false, repetir = 1 } = {}) { return this.comando('secuencia', { pasos, repetir }, { esperar }); }
  estado() { return this._peticion('GET', '/estado'); }

  decir(texto, params = {}, op) { return this.comando('decir', Object.assign({ texto }, params), op); }
  pensar(texto = '', params = {}, op) { return this.comando('pensar', Object.assign(texto ? { texto } : {}, params), op); }
  textear(texto = '', params = {}, op) { return this.comando('textear', Object.assign(texto ? { texto } : {}, params), op); }
  mensaje(texto, params = {}) { return this.comando('mensaje', Object.assign({ texto }, params)); }
  expresion(valor, duracion) { return this.comando('expresion', { valor, duracion }); }
  ir(a, op) { return this.comando('ir', { a }, op); }
  mover(x, y, duracion, op) { return this.comando('mover', { x, y, duracion }, op); }
  progreso(valor, etiqueta) { return this.comando('progreso', { valor, etiqueta }); }
  herramientas(lista, op) { return this.comando('herramientas', { lista }, op); }
  boca(abrir) { return this.comando('boca', { abrir }); }
  detener() { return this.comando('detener'); }
  // v1.1: avisos cortos con sonido, sonidos de robot y oído
  aviso(tipo, texto, params = {}) { return this.comando('aviso', Object.assign({ tipo, texto }, params)); }
  sonido(nombre, op) { return this.comando('sonido', { nombre }, op); }
  microfono(modo) { return this.comando('microfono', modo ? { modo } : {}); }
  configurar(params) { return this.comando('configurar', params); }
  // 🧠 conversa con su mente propia (memoria, personalidad, IA y herramientas)
  charlar(texto, { hablar = true } = {}) { return this._peticion('POST', '/charla', { texto, hablar }); }
  // v2: el avatar es independiente (sus ajustes, memoria y herramientas)
  ajustes() { return this._peticion('GET', '/api/ajustes').then((r) => r.ajustes); }
  cambiarAjustes(parcial) { return this._peticion('POST', '/api/ajustes', parcial); }
  memoria() { return this._peticion('GET', '/api/memoria').then((r) => r.memoria); }
  recordar(texto) { return this.comando('recordar', { texto }); }
  recordatorio(texto, cuando) { return this.comando('recordatorio', { texto, cuando }, { esperar: true }); }
  /** Pregunta al usuario; la respuesta llega por eventos(): {nombre:'respuesta', datos:{id, valor, texto}} */
  preguntar(texto, { id, segundos = 30 } = {}) { return this.comando('preguntar', { texto, id, segundos }, { esperar: true }); }
  contar(texto, app = 'js') { return this._peticion('POST', '/api/eventos-app', { app, tipo: 'nota', texto }); }
  usarHerramienta(nombre, args = {}) { return this._peticion('POST', '/api/herramienta', { nombre, args }); }

  /** Suscripción a eventos en vivo. Devuelve una función para cancelar. */
  eventos(callback) {
    const WS = typeof WebSocket !== 'undefined' ? WebSocket : require('ws');
    const url = this.base.replace('http://', 'ws://') + '/ws' + (this.token ? `?token=${encodeURIComponent(this.token)}` : '');
    let ws, cerrado = false;
    const conectar = () => {
      ws = new WS(url);
      ws.onmessage = (m) => { const j = JSON.parse(m.data); if (j.tipo === 'evento') callback(j.nombre, j.datos); };
      ws.onclose = () => { if (!cerrado) setTimeout(conectar, 2000); };
      ws.onerror = () => {};
    };
    conectar();
    return () => { cerrado = true; try { ws.close(); } catch (_) { /* noop */ } };
  }
}

// Atajos para cualquier acción: av.reir(), av.saludar(), av.trabajar({duracion: 5000})...
for (const n of ['reir', 'saludar', 'trabajar', 'analizar', 'escuchar', 'aclarar', 'senalar', 'asentir', 'negar', 'celebrar',
  'sorpresa', 'confundido', 'dormir', 'despertar', 'bailar', 'icono', 'expandir', 'ocultar', 'mostrar', 'callar', 'soltar']) {
  if (!NoviqAvatar.prototype[n]) NoviqAvatar.prototype[n] = function (params = {}, op) { return this.comando(n, params, op); };
}

if (typeof module !== 'undefined') module.exports = { NoviqAvatar };

// Demostración: node noviq-avatar.js
if (typeof require !== 'undefined' && require.main === module) {
  (async () => {
    const av = new NoviqAvatar();
    av.eventos((n, d) => console.log('evento:', n, JSON.stringify(d)));
    await av.ir('centro', { esperar: true });
    await av.saludar();
    await av.decir('Hola, me controlas desde JavaScript.', {}, { esperar: true });
    await av.comando('herramientas', { lista: ['codigo', 'terminal', 'web'] }, { esperar: true });
    await av.reir({}, { esperar: true });
    await av.ir('abajo-derecha', { esperar: true });
    process.exit(0);
  })().catch((e) => { console.error(e.message); process.exit(1); });
}
