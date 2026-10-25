'use strict';
/* ==========================================================================
   Noviq Avatar — Voz (texto → audio) con motores propios
     microsoft · voces neuronales de Edge (gratis, sin clave)
     nvidia    · Magpie con emociones (tu clave nvapi-…)
     noviq     · las voces de Noviq (incluye Piper sin internet) si está conectado
     windows   · las voces instaladas en Windows (las pone el propio avatar)
   «auto» prueba en ese orden y recuerda cuál funcionó. Las frases repetidas
   salen de una caché en disco (instantáneas).
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const edge = require('./edge');
const riva = require('./riva');
const cat = require('./catalogo');
const { textoHablado } = require('../util');
const P = require('../personalidad');

class Voz {
  constructor({ ajustes, noviq, dir, log }) {
    this.aj = ajustes; this.noviq = noviq; this.log = log || (() => {});
    this.cache = path.join(dir, 'voz_cache');
    this.oficiales = null; this.tOficiales = 0;
    this.ultimo = { motor: '', ms: 0, error: '' };
    this.fallos = {};   // motor → hasta cuándo no probarlo (ms)
    try { fs.mkdirSync(this.cache, { recursive: true }); } catch (_) { /* noop */ }
  }

  motores() {
    const v = this.aj.datos.voz;
    if (v.motor && v.motor !== 'auto') {
      const resto = ['microsoft', 'nvidia', 'noviq'].filter((m) => m !== v.motor);
      return [v.motor].concat(resto);
    }
    return ['microsoft', 'nvidia', 'noviq'];
  }
  utilizable(m) {
    if ((this.fallos[m] || 0) > Date.now()) return false;
    if (m === 'nvidia') return !!this.aj.clave('nvidia');
    if (m === 'noviq') return !!(this.noviq && this.noviq.conectado && this.aj.datos.noviq.usar);
    return m === 'microsoft';
  }
  vozPara(m) {
    const v = this.aj.datos.voz;
    const elegido = v.motor === 'auto' ? 'microsoft' : v.motor;
    if (m === elegido && v.id) return v.id;
    const g = cat.generoDe(elegido, v.id);
    if (m === 'noviq') return 'microsoft:' + cat.parecida('microsoft', g);   // Noviq también tiene las de Microsoft
    return cat.parecida(m, g);
  }

  claveCache(m, voz, texto, vel, tono, estilo) {
    return crypto.createHash('sha1').update([m, voz, texto, vel, tono, estilo].join('|')).digest('hex').slice(0, 24);
  }
  desdeCache(k) {
    for (const ext of ['mp3', 'wav']) {
      const f = path.join(this.cache, k + '.' + ext);
      try { const b = fs.readFileSync(f); const t = new Date(); fs.utimesSync(f, t, t); return { audio: b, formato: ext }; } catch (_) { /* siguiente */ }
    }
    return null;
  }
  aCache(k, r) {
    try {
      fs.writeFileSync(path.join(this.cache, k + '.' + r.formato), r.audio);
      if (Math.random() < 0.05) {
        const fsx = fs.readdirSync(this.cache).map((n) => ({ n, t: fs.statSync(path.join(this.cache, n)).mtimeMs })).sort((a, b) => b.t - a.t);
        for (const x of fsx.slice(400)) fs.unlinkSync(path.join(this.cache, x.n));
      }
    } catch (_) { /* noop */ }
  }

  /**
   * texto → {ok, audio (base64), formato, motor} | {ok:false, error, windows:true}
   * op: {estilo, velocidad, tono, motor, voz} (motor/voz para «probar» una voz del catálogo)
   */
  async sintetizar(texto, op) {
    op = op || {};
    const v = this.aj.datos.voz;
    texto = textoHablado(texto).replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}\u{FE0F}]/gu, '').slice(0, 1500).trim();
    if (!texto) return { ok: false, error: 'texto vacío' };
    const pr = P.prosodia(this.aj.datos.identidad.personalidad, v.velocidad, v.tono);   // la personalidad cambia el ritmo y el tono
    const vel = +((Number(op.velocidad) || 1) * pr.velocidad).toFixed(2);
    const tono = +((Number(op.tono) || 1) * pr.tono).toFixed(2);
    op.estilo = op.estilo || P.estiloVoz(this.aj.datos.identidad.personalidad);
    const lista = op.motor ? [op.motor] : this.motores();
    if (op.motor === 'windows' || (!op.motor && v.motor === 'windows')) return { ok: false, windows: true, error: 'voz de Windows' };
    const errores = [];
    for (const m of lista) {
      if (!op.motor && !this.utilizable(m)) continue;
      const voz = op.voz || this.vozPara(m);
      const estilo = m === 'nvidia' ? (op.estilo || '') : '';
      const k = this.claveCache(m, voz, texto, vel, tono, estilo);
      const c = this.desdeCache(k);
      if (c) { this.ultimo = { motor: m, ms: 0, error: '' }; return { ok: true, audio: c.audio.toString('base64'), formato: c.formato, motor: m, cache: true }; }
      const t0 = Date.now();
      try {
        let r;
        if (m === 'microsoft') r = await edge.hablar(texto, { voz, velocidad: vel, tono });
        else if (m === 'nvidia') r = await riva.hablar(texto, { voz, clave: this.aj.clave('nvidia'), estilo });
        else if (m === 'noviq') {
          const [mm, vv] = String(voz || '').includes(':') ? String(voz).split(/:(.+)/) : ['', voz];
          const j = await this.noviq.tts(texto, { motor: mm || undefined, voz: vv || undefined, vel, tono, estilo: op.estilo || '' });
          if (!j || !j.ok || !j.audio) throw new Error((j && j.error) || 'Noviq no devolvió audio');
          r = { audio: Buffer.from(j.audio, 'base64'), formato: j.formato || 'mp3' };
        } else continue;
        this.aCache(k, r);
        delete this.fallos[m];
        this.ultimo = { motor: m, ms: Date.now() - t0, error: '' };
        return { ok: true, audio: r.audio.toString('base64'), formato: r.formato, motor: m };
      } catch (e) {
        errores.push(`${m}: ${String(e.message || e).slice(0, 120)}`);
        if (!op.motor) this.fallos[m] = Date.now() + 60000;   // un minuto sin probarlo
      }
    }
    this.ultimo = { motor: 'windows', ms: 0, error: errores.join('; ') };
    return { ok: false, windows: true, error: errores.join('; ') || 'sin motor de voz disponible' };
  }

  async catalogo() {
    if (!this.oficiales || Date.now() - this.tOficiales > 7 * 86400000) {
      this.tOficiales = Date.now();
      edge.voces().then((l) => { this.oficiales = l; }).catch(() => { /* lista de respaldo */ });
    }
    const motores = [
      { id: 'microsoft', nombre: 'Microsoft neuronales (las más naturales · gratis · sin clave)', listo: true, voces: cat.vocesMicrosoft(this.oficiales) },
      { id: 'nvidia', nombre: 'NVIDIA Magpie (con emociones · tu clave nvapi-)', listo: !!this.aj.clave('nvidia'), falta: this.aj.clave('nvidia') ? '' : 'pon tu clave de NVIDIA en «Cerebro»', voces: cat.vocesNvidia() },
      { id: 'windows', nombre: 'Voces de Windows (sin internet)', listo: true,
        voces: (this.vocesWindows || []).filter((x) => /^(es|en)/i.test(x.idioma || '')).map((x) => ({ motor: 'windows', id: x.id, nombre: String(x.nombre || x.id).replace(/^Microsoft /, '').replace(/ - .*$/, ''),
          idioma: String(x.idioma || '').slice(0, 2), pais: String(x.idioma || '').split('-')[1] || '', bandera: '🪟', genero: '' })) }
    ];
    if (this.noviq && this.noviq.conectado) {
      try {
        const r = await this.noviq.voces();
        const piper = r && r.motores && r.motores.find((m) => m.id === 'piper');
        if (piper) motores.push({ id: 'noviq', nombre: 'Noviq · Piper (sin internet)', listo: !!piper.listo, falta: piper.falta || '',
          voces: (piper.voces || []).map((x) => Object.assign({}, x, { motor: 'noviq', id: 'piper:' + x.id })) });
      } catch (_) { /* noop */ }
    }
    return { motores, elegida: { motor: this.aj.datos.voz.motor, voz: this.aj.datos.voz.id }, ultimo: this.ultimo };
  }
}

module.exports = { Voz };
