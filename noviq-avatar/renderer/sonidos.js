/* ==========================================================================
   Noviq Avatar — Sonidos de robot (sintetizados con WebAudio, sin archivos)
   Pitidos, chirridos y "charla" tipo droide. Cada receta devuelve su duración
   (s) para que el oído no se escuche a sí mismo mientras suena algo.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const aleatorio = (a, b) => a + Math.random() * (b - a);

  class Sonidos {
    constructor(cfg) {
      this.cfg = Object.assign({ activados: true, volumen: 0.5, automaticos: true, charla: true }, cfg || {});
      this.ctx = null; this.master = null; this.hastaT = 0; this.ruidoBuf = null;
    }

    _ctx() {
      if (!this.ctx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return null;
        this.ctx = new AC();
        this.master = this.ctx.createGain();
        this.master.gain.value = this._vol();
        const comp = this.ctx.createDynamicsCompressor();
        comp.threshold.value = -14; comp.ratio.value = 4;
        this.master.connect(comp); comp.connect(this.ctx.destination);
      }
      if (this.ctx.state === 'suspended') this.ctx.resume().catch(() => {});
      return this.ctx;
    }
    _vol() { return Math.max(0, Math.min(1, Number(this.cfg.volumen == null ? 0.5 : this.cfg.volumen))) * 0.9; }

    configurar(c) {
      Object.assign(this.cfg, c || {});
      if (this.master) this.master.gain.value = this._vol();
      return Object.assign({}, this.cfg);
    }

    /** true mientras suena algo (el oído se pausa para no transcribir al propio robot) */
    get ocupado() { return !!this.ctx && this.ctx.currentTime < this.hastaT; }

    tono(t0, o) {
      const ctx = this.ctx, dur = o.dur || 0.1, vol = o.vol == null ? 0.25 : o.vol;
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = o.tipo || 'square';
      osc.frequency.setValueAtTime(o.f, t0);
      if (o.f2) osc.frequency.exponentialRampToValueAtTime(Math.max(20, o.f2), t0 + dur);
      if (o.vib) {
        const lfo = ctx.createOscillator(), lg = ctx.createGain();
        lfo.frequency.value = o.vib; lg.gain.value = o.vibProf || o.f * 0.06;
        lfo.connect(lg); lg.connect(osc.frequency); lfo.start(t0); lfo.stop(t0 + dur + 0.05);
      }
      let salida = osc;
      if (osc.type === 'square' || osc.type === 'sawtooth') {   // suaviza lo chillón
        const f = ctx.createBiquadFilter(); f.type = 'lowpass'; f.frequency.value = o.corte || 3200;
        osc.connect(f); salida = f;
      }
      const at = o.ataque || 0.006;
      g.gain.setValueAtTime(0.0001, t0);
      g.gain.exponentialRampToValueAtTime(vol, t0 + at);
      g.gain.setValueAtTime(vol, t0 + Math.max(at, dur * 0.55));
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      salida.connect(g); g.connect(this.master);
      osc.start(t0); osc.stop(t0 + dur + 0.02);
      return t0 + dur;
    }

    ruido(t0, dur, vol, frec, frec2) {
      const ctx = this.ctx;
      if (!this.ruidoBuf) {
        const n = ctx.sampleRate * 1.0, b = ctx.createBuffer(1, n, ctx.sampleRate), d = b.getChannelData(0);
        for (let i = 0; i < n; i++) d[i] = Math.random() * 2 - 1;
        this.ruidoBuf = b;
      }
      const src = ctx.createBufferSource(); src.buffer = this.ruidoBuf;
      const f = ctx.createBiquadFilter(); f.type = 'bandpass'; f.Q.value = 1.2;
      f.frequency.setValueAtTime(frec || 2000, t0);
      if (frec2) f.frequency.exponentialRampToValueAtTime(frec2, t0 + dur);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(vol || 0.2, t0 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      src.connect(f); f.connect(g); g.connect(this.master);
      src.start(t0); src.stop(t0 + dur + 0.02);
      return t0 + dur;
    }

    /** Reproduce una receta por nombre. Devuelve la duración en segundos (0 si no suena). */
    reproducir(nombre, op) {
      if (!this.cfg.activados) return 0;
      const receta = RECETAS[String(nombre || '').toLowerCase()];
      if (!receta) return 0;
      const ctx = this._ctx();
      if (!ctx) return 0;
      const t = ctx.currentTime + 0.015;
      let fin = t;
      try { fin = receta(this, t, op || {}) || t; } catch (e) { console.warn('sonido', nombre, e); }
      this.hastaT = Math.max(this.hastaT, fin + 0.12);
      return Math.max(0, fin - t);
    }

    /** "Charla" de droide mientras habla sin voz del sistema: chirridos al ritmo del texto. */
    charla(texto, segundos) {
      if (!this.cfg.activados || !this.cfg.charla) return 0;
      const ctx = this._ctx();
      if (!ctx) return 0;
      const silabas = Math.max(2, Math.min(14, Math.round(String(texto || '').replace(/\s+/g, '').length / 5)));
      const total = Math.max(0.35, Math.min(2.2, segundos || silabas * 0.12));
      let t = ctx.currentTime + 0.02;
      const paso = total / silabas;
      for (let i = 0; i < silabas; i++) {
        const f = aleatorio(650, 1700), sube = Math.random() < 0.5;
        this.tono(t, { f, f2: sube ? f * aleatorio(1.2, 1.8) : f * aleatorio(0.55, 0.85), dur: paso * aleatorio(0.55, 0.85),
          tipo: Math.random() < 0.7 ? 'square' : 'triangle', vol: 0.11, corte: 2600 });
        t += paso;
      }
      this.hastaT = Math.max(this.hastaT, t + 0.1);
      return total;
    }
  }

  const NOTA = (n) => 440 * Math.pow(2, (n - 69) / 12);
  const arpegio = (s, t, notas, paso, o) => { for (const n of notas) { s.tono(t, Object.assign({ f: NOTA(n), dur: paso * 1.15, vol: 0.2 }, o)); t += paso; } return t; };

  const RECETAS = {
    encender: (s, t) => { s.tono(t, { f: 160, f2: 950, dur: 0.38, tipo: 'sawtooth', vol: 0.14 }); s.tono(t + 0.4, { f: 880, dur: 0.07, vol: 0.18 }); return s.tono(t + 0.5, { f: 1320, dur: 0.1, vol: 0.18 }); },
    apagar: (s, t) => { s.tono(t, { f: 1100, dur: 0.07, vol: 0.16 }); return s.tono(t + 0.09, { f: 900, f2: 120, dur: 0.45, tipo: 'sawtooth', vol: 0.13 }); },
    saludo: (s, t) => arpegio(s, t, [76, 72, 79], 0.085, { tipo: 'triangle', vol: 0.22 }),
    blip: (s, t) => s.tono(t, { f: 1250, dur: 0.06, tipo: 'triangle', vol: 0.2 }),
    info: (s, t) => { s.tono(t, { f: 990, dur: 0.06, tipo: 'triangle', vol: 0.18 }); return s.tono(t + 0.08, { f: 1480, dur: 0.08, tipo: 'triangle', vol: 0.18 }); },
    clic: (s, t) => s.tono(t, { f: 1900, f2: 1400, dur: 0.035, tipo: 'triangle', vol: 0.15 }),
    exito: (s, t) => { const f = arpegio(s, t, [72, 76, 79, 84], 0.075, { tipo: 'square', vol: 0.16 }); s.ruido(f - 0.05, 0.25, 0.05, 6000, 9000); return s.tono(f, { f: NOTA(88), dur: 0.22, tipo: 'triangle', vol: 0.16, vib: 9, vibProf: 25 }); },
    terminado: (s, t) => RECETAS.exito(s, t),
    celebrar: (s, t) => { let f = arpegio(s, t, [67, 72, 76, 79], 0.07, { tipo: 'square', vol: 0.15 }); f = arpegio(s, f + 0.03, [76, 79, 84], 0.09, { tipo: 'square', vol: 0.17 }); s.ruido(t + 0.2, 0.6, 0.05, 5000, 11000); return f; },
    error: (s, t) => { s.tono(t, { f: 240, f2: 170, dur: 0.22, tipo: 'sawtooth', vol: 0.2, vib: 32, vibProf: 22, corte: 1400 }); return s.tono(t + 0.26, { f: 180, f2: 110, dur: 0.34, tipo: 'sawtooth', vol: 0.2, vib: 28, vibProf: 18, corte: 1200 }); },
    atencion: (s, t) => { let f = t; for (let i = 0; i < 2; i++) { s.tono(f, { f: 1150, f2: 1850, dur: 0.09, vol: 0.18 }); f = s.tono(f + 0.1, { f: 1850, f2: 1150, dur: 0.09, vol: 0.18 }) + 0.08; } return f; },
    pregunta: (s, t) => { s.tono(t, { f: 700, dur: 0.08, tipo: 'triangle', vol: 0.2 }); return s.tono(t + 0.1, { f: 760, f2: 1500, dur: 0.22, tipo: 'triangle', vol: 0.2, vib: 12, vibProf: 30 }); },
    procesar: (s, t) => { let f = t; for (let i = 0; i < 5; i++) f = s.tono(f, { f: aleatorio(700, 1600), dur: 0.045, tipo: 'square', vol: 0.07, corte: 2200 }) + 0.025; return f; },
    pensar: (s, t) => { s.tono(t, { f: 520, f2: 680, dur: 0.16, tipo: 'sine', vol: 0.16 }); return s.tono(t + 0.2, { f: 640, f2: 560, dur: 0.18, tipo: 'sine', vol: 0.14 }); },
    escribir: (s, t, o) => { let f = t; const n = Math.max(3, Math.min(16, o.n || 8)); for (let i = 0; i < n; i++) { s.ruido(f, 0.02, 0.07, aleatorio(2500, 4200)); f += aleatorio(0.05, 0.1); } return f; },
    escuchar: (s, t) => { s.tono(t, { f: 660, f2: 1320, dur: 0.12, tipo: 'sine', vol: 0.2 }); return s.tono(t + 0.13, { f: 1320, dur: 0.05, tipo: 'sine', vol: 0.15 }); },
    oido_fin: (s, t) => s.tono(t, { f: 1320, f2: 620, dur: 0.14, tipo: 'sine', vol: 0.17 }),
    entendido: (s, t) => { s.tono(t, { f: 880, dur: 0.05, tipo: 'triangle', vol: 0.18 }); return s.tono(t + 0.07, { f: 1175, dur: 0.07, tipo: 'triangle', vol: 0.18 }); },
    no_entendi: (s, t) => { s.tono(t, { f: 900, f2: 600, dur: 0.14, tipo: 'triangle', vol: 0.18 }); return s.tono(t + 0.16, { f: 620, f2: 700, dur: 0.16, tipo: 'triangle', vol: 0.15 }); },
    risa: (s, t) => { let f = t; for (let i = 0; i < 6; i++) f = s.tono(f, { f: i % 2 ? 900 : 1300, f2: i % 2 ? 800 : 1200, dur: 0.07, tipo: 'square', vol: 0.13 - i * 0.012 }) + 0.03; return f; },
    sorpresa: (s, t) => s.tono(t, { f: 380, f2: 2100, dur: 0.24, tipo: 'triangle', vol: 0.2 }),
    triste: (s, t) => s.tono(t, { f: 720, f2: 300, dur: 0.6, tipo: 'triangle', vol: 0.18, vib: 6, vibProf: 18 }),
    confundido: (s, t) => { s.tono(t, { f: 600, f2: 900, dur: 0.12, tipo: 'triangle', vol: 0.16 }); return s.tono(t + 0.14, { f: 900, f2: 520, dur: 0.18, tipo: 'triangle', vol: 0.16 }); },
    dormir: (s, t) => { s.tono(t, { f: 520, f2: 380, dur: 0.35, tipo: 'sine', vol: 0.14 }); return s.tono(t + 0.4, { f: 390, f2: 240, dur: 0.5, tipo: 'sine', vol: 0.12 }); },
    despertar: (s, t) => { s.tono(t, { f: 300, f2: 700, dur: 0.25, tipo: 'sine', vol: 0.15 }); return s.tono(t + 0.28, { f: 800, f2: 1400, dur: 0.18, tipo: 'triangle', vol: 0.17 }); },
    volar: (s, t) => s.ruido(t, 0.45, 0.07, 700, 2600),
    agarrar: (s, t) => s.tono(t, { f: 1500, f2: 2300, dur: 0.08, tipo: 'triangle', vol: 0.14 }),
    herramienta: (s, t) => { s.tono(t, { f: 1400, dur: 0.035, vol: 0.09 }); return s.tono(t + 0.05, { f: 1800, dur: 0.035, vol: 0.09 }); },
    progreso: (s, t, o) => s.tono(t, { f: 500 + 12 * Math.max(0, Math.min(100, o.valor || 0)), dur: 0.05, tipo: 'triangle', vol: 0.1 })
  };

  N.Sonidos = Sonidos;
  N.RECETAS_SONIDO = Object.keys(RECETAS);
})();
