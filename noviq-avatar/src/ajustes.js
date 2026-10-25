'use strict';
/* ==========================================================================
   Noviq Avatar — Ajustes PROPIOS del avatar (no dependen de Noviq)
   · ajustes.json en la carpeta de datos del avatar (%APPDATA%\Noviq Avatar)
   · claves.json: las claves de las IAs, cifradas con la cuenta de Windows
     (DPAPI vía safeStorage de Electron). Nunca se devuelven por la API: solo
     se informa si están puestas y sus últimas 4 letras.
   Se cambian desde su página (/ajustes), desde Noviq (que muestra esa misma
   página) o por la API (comando "configurar" o POST /api/ajustes).
   ========================================================================== */
const path = require('path');
const crypto = require('crypto');
const { leerJSON, escribirJSON } = require('./almacen');
const { DEFECTO_RASGOS, valida } = require('./personalidad');

const DEFECTO = {
  version: 2,
  identidad: { nombre: 'Noviq', variantes: '', personalidad: DEFECTO_RASGOS.slice(), autonomia: 2, instrucciones: '', idioma: 'es' },
  voz: { activada: true, motor: 'auto', id: 'es-EC-LuisNeural', velocidad: 1, tono: 1, volumen: 1, nombreWindows: '' },
  // filtro: distingue TU voz de la TV / radio / otras personas (apagado | normal | estricto)
  oido: { modo: 'palabra', motor: 'auto', sensibilidad: 1, maxSeg: 20, filtro: 'normal' },
  cerebro: { proveedor: 'auto', modelo: '', urlPropia: '', urlOllama: 'http://127.0.0.1:11434', urlLmstudio: 'http://127.0.0.1:1234', gratis: true,
    temperatura: 0.6, maxTokens: 450,
    modelos: { groq: '', cerebras: '', gemini: '', nvidia: '', mistral: '', openrouter: '', deepseek: '', openai: '', propia: '', ollama: '', lmstudio: '', gratis: '' } },
  sonidos: { activados: true, volumen: 0.5, automaticos: true, charla: true },
  portapapeles: { modo: 'observar', ayudaErrores: true },
  apariencia: { mirarCursor: true, atajoHablar: 'Control+Alt+Space', saludoInicial: true, dormirMin: 15, iniciarConWindows: false },
  herramientas: { abrir: true, internet: true, portapapeles: true, recordatorios: true },
  vision: { camara: false, dispositivo: '', ancho: 960, proveedor: 'auto', modelo: '', soloLocal: false },
  agentes: { activar: true, permisos: 'pregunta_cambios', maxPasos: 8, aprobarSegundos: 90, segundoPlano: true,
    pc: { activo: true, instrucciones: '' }, proyectos: { activo: true, instrucciones: '' }, web: { activo: true, instrucciones: '' }, noviq: { activo: true, instrucciones: '' }, vision: { activo: true, instrucciones: '' },
    documentos: { activo: true, instrucciones: '' } },
  // ⚡ vía rápida: órdenes del PC sin IA; Noviq solo para programar
  rapido: { activar: true, apagadoSeg: 60, noviqSoloProgramar: true },
  // escalar: si mis bots no pueden algo y Noviq está abierto, se lo paso (cerrado: pregunto si lo abro)
  noviq: { usar: true, herramientas: true, avisosTrabajo: true, burbujasHerramientas: false, anunciarInicio: false, queMas: true,
    ofrecerContinuar: true, cerrarConNoviq: true, escalar: true },
  api: { origenes: [] },
  migrado: { local: false, noviq: false, memoria: false }
};

const ENUMS = {
  'voz.motor': ['auto', 'microsoft', 'nvidia', 'noviq', 'windows'],
  'oido.modo': ['apagado', 'palabra', 'siempre', 'pulsar'],
  'oido.filtro': ['apagado', 'normal', 'estricto'],
  'oido.motor': ['auto', 'nvidia', 'groq', 'openai', 'noviq', 'gratis', 'windows'],
  'cerebro.proveedor': ['auto', 'noviq', 'groq', 'cerebras', 'gemini', 'nvidia', 'mistral', 'openrouter', 'deepseek', 'openai', 'lmstudio', 'ollama', 'propia', 'gratis', 'ninguno'],
  'portapapeles.modo': ['observar', 'pregunta', 'apagado'],
  'identidad.idioma': ['es', 'en'],
  'agentes.permisos': ['pregunta_todo', 'pregunta_cambios', 'solo_peligro'],
  'vision.proveedor': ['auto', 'ollama', 'lmstudio', 'gemini', 'openai', 'groq', 'mistral']
};
const RANGOS = {
  'voz.velocidad': [0.5, 2], 'voz.tono': [0.5, 1.6], 'voz.volumen': [0, 1.5], 'oido.sensibilidad': [0.3, 3], 'oido.maxSeg': [4, 60],
  'cerebro.temperatura': [0, 1.5], 'cerebro.maxTokens': [64, 2000], 'sonidos.volumen': [0, 1], 'identidad.autonomia': [0, 3],
  'apariencia.dormirMin': [0, 240], 'agentes.maxPasos': [1, 20], 'agentes.aprobarSegundos': [15, 300], 'vision.ancho': [320, 1920], 'rapido.apagadoSeg': [10, 600]
};
const LARGOS = { 'identidad.nombre': 24, 'identidad.variantes': 200, 'identidad.instrucciones': 1500, 'voz.id': 120, 'voz.nombreWindows': 120,
  'cerebro.modelo': 160, 'cerebro.urlPropia': 300, 'cerebro.urlOllama': 200, 'cerebro.urlLmstudio': 200, 'apariencia.atajoHablar': 60,
  'vision.dispositivo': 300, 'vision.modelo': 160, 'agentes.pc.instrucciones': 600, 'agentes.web.instrucciones': 600, 'agentes.noviq.instrucciones': 600, 'agentes.vision.instrucciones': 600, 'agentes.proyectos.instrucciones': 600, 'agentes.documentos.instrucciones': 600 };
const CLAVES = ['nvidia', 'groq', 'cerebras', 'gemini', 'mistral', 'openrouter', 'deepseek', 'openai', 'propia', 'llm7'];
const URLS = ['cerebro.urlPropia', 'cerebro.urlOllama', 'cerebro.urlLmstudio'];

const copia = (o) => JSON.parse(JSON.stringify(o));
function mezclarDefecto(base, d) {
  const out = copia(d);
  for (const k of Object.keys(d)) {
    if (base && base[k] !== undefined) {
      if (d[k] && typeof d[k] === 'object' && !Array.isArray(d[k])) out[k] = mezclarDefecto(base[k], d[k]);
      else out[k] = base[k];
    }
  }
  return out;
}

/** Cifrador por defecto (sin Electron): guarda tal cual, marcado como no cifrado. */
const SIN_CIFRAR = { disponible: false, cifrar: (t) => Buffer.from(String(t), 'utf8').toString('base64'), descifrar: (b) => Buffer.from(String(b), 'base64').toString('utf8') };

class Ajustes {
  constructor({ dir, cifrador, log }) {
    this.dir = dir;
    this.ruta = path.join(dir, 'ajustes.json');
    this.rutaClaves = path.join(dir, 'claves.json');
    this.cif = cifrador || SIN_CIFRAR;
    this.log = log || (() => {});
    this.oyentes = [];
    this.d = mezclarDefecto(leerJSON(this.ruta) || {}, DEFECTO);
    this.d.identidad.personalidad = valida(this.d.identidad.personalidad);
    // ajuste viejo: un solo «modelo» para el proveedor elegido → ahora cada proveedor tiene el suyo
    const cb = this.d.cerebro;
    if (cb.modelo && cb.modelos[cb.proveedor] === '') { cb.modelos[cb.proveedor] = cb.modelo; cb.modelo = ''; }
    this.claves = leerJSON(this.rutaClaves) || {};
    if (!this.claves.api) this.ponerClave('api', 'av-' + crypto.randomBytes(16).toString('hex'), true);
  }

  get datos() { return this.d; }
  guardar() { try { escribirJSON(this.ruta, this.d); } catch (e) { this.log('no pude guardar los ajustes: ' + e.message); } }

  /* ------------------------------------------------------------- Claves */
  clave(nombre) {
    const c = this.claves[nombre];
    if (!c || !c.v) return '';
    try { return c.c ? this.cif.descifrar(c.v) : Buffer.from(c.v, 'base64').toString('utf8'); } catch (_) { return ''; }
  }
  ponerClave(nombre, valor, silencioso) {
    if (nombre !== 'api' && !CLAVES.includes(nombre)) throw new Error('Clave desconocida: ' + nombre);
    valor = String(valor || '').trim();
    if (!valor) delete this.claves[nombre];
    else if (this.cif.disponible) this.claves[nombre] = { v: this.cif.cifrar(valor), c: true };
    else this.claves[nombre] = { v: Buffer.from(valor, 'utf8').toString('base64'), c: false };
    try { escribirJSON(this.rutaClaves, this.claves); } catch (e) { this.log('no pude guardar las claves: ' + e.message); }
    if (!silencioso) this.avisar(['claves.' + nombre]);
  }
  estadoClaves() {
    const out = {};
    const { revisarClave } = require('./proveedores');
    for (const k of CLAVES) {
      const v = this.clave(k);
      if (!v) { out[k] = { puesta: false }; continue; }
      const r = revisarClave(k === 'llm7' ? 'gratis' : k, v);
      out[k] = { puesta: true, fin: v.slice(-4), aviso: r.error || (r.mover ? r.aviso : '') || undefined };
    }
    out.cifradas = !!this.cif.disponible;
    return out;
  }
  claveApi() { return this.clave('api'); }
  nuevaClaveApi() { this.ponerClave('api', 'av-' + crypto.randomBytes(16).toString('hex')); return this.claveApi(); }

  /* ------------------------------------------------------------ Lectura */
  publico() {
    const p = copia(this.d);
    delete p.migrado;
    p.claves = this.estadoClaves();
    p.claveApi = this.claveApi();
    return p;
  }

  /* --------------------------------------------------------- Escritura */
  validar(ruta, v, actual) {
    if (ENUMS[ruta]) return ENUMS[ruta].includes(v) ? v : undefined;
    if (RANGOS[ruta]) { const n = Number(v); return isNaN(n) ? undefined : Math.min(RANGOS[ruta][1], Math.max(RANGOS[ruta][0], n)); }
    if (ruta === 'identidad.personalidad') return Array.isArray(v) ? valida(v) : typeof v === 'string' ? valida(v.split(/[,\s]+/)) : undefined;
    if (ruta === 'api.origenes') return Array.isArray(v) ? v.map(String).filter((o) => /^https?:\/\/[^\s/]+$|^\*$/.test(o)).slice(0, 20) : undefined;
    if (typeof actual === 'boolean') return typeof v === 'boolean' ? v : v === 'true' ? true : v === 'false' ? false : undefined;
    if (typeof actual === 'number') { const n = Number(v); return isNaN(n) ? undefined : n; }
    if (typeof actual === 'string') {
      let s = String(v == null ? '' : v).slice(0, LARGOS[ruta] || 200);
      if (ruta === 'identidad.nombre') s = s.replace(/[^\p{L}\p{N} \-]/gu, '').trim() || 'Noviq';
      if (URLS.includes(ruta)) { s = s.trim().replace(/\/+$/, ''); if (s && !/^https?:\/\/[^\s]+$/.test(s)) return undefined; if (!s && ruta !== 'cerebro.urlPropia') s = DEFECTO.cerebro[ruta.split('.')[1]]; }
      if (ruta.startsWith('cerebro.modelos.')) s = s.trim();
      return s;
    }
    return undefined;
  }

  /** Cambia una parte ({voz:{velocidad:1.1}}). Devuelve la lista de rutas cambiadas. */
  actualizar(parcial, op) {
    op = op || {};
    const cambios = [];
    const recorrer = (obj, base, prefijo) => {
      for (const [k, v] of Object.entries(obj || {})) {
        const ruta = prefijo ? prefijo + '.' + k : k;
        if (!(k in base) || ruta === 'version' || ruta.startsWith('migrado')) continue;
        if (base[k] && typeof base[k] === 'object' && !Array.isArray(base[k]) && v && typeof v === 'object' && !Array.isArray(v)) { recorrer(v, base[k], ruta); continue; }
        const nv = this.validar(ruta, v, base[k]);
        if (nv === undefined) continue;
        if (JSON.stringify(nv) !== JSON.stringify(base[k])) { base[k] = nv; cambios.push(ruta); }
      }
    };
    recorrer(parcial, this.d, '');
    if (parcial && parcial.claves && typeof parcial.claves === 'object') {
      for (const [k, v] of Object.entries(parcial.claves)) if (CLAVES.includes(k) && typeof v === 'string') { this.ponerClave(k, v, true); cambios.push('claves.' + k); }
    }
    if (cambios.length) { this.guardar(); if (!op.silencioso) this.avisar(cambios); }
    return cambios;
  }
  marcarMigrado(que) { this.d.migrado[que] = true; this.guardar(); }

  alCambiar(cb) { this.oyentes.push(cb); }
  avisar(cambios) { for (const cb of this.oyentes) { try { cb(cambios, this); } catch (e) { this.log('ajustes: ' + e.message); } } }
}

module.exports = { Ajustes, DEFECTO, ENUMS, RANGOS, CLAVES };
