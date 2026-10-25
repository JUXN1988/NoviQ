/* ==========================================================================
   Noviq Avatar — Motor de animación
   Mezcla por capas: reposo → expresión → acción → habla → control manual →
   mirada, y suaviza cada articulación hacia su objetivo en cada fotograma.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const { lerp, clamp, smooth } = N.util;

  const quitarAcentos = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

  function ladoDe(v, def) {
    const k = quitarAcentos(v || def || 'derecha');
    if (['izquierda', 'izq', 'left', 'l', 'i'].includes(k)) return ['L'];
    if (['ambos', 'ambas', 'dos', 'both', 'todos'].includes(k)) return ['L', 'R'];
    return ['R'];
  }

  /* ------------------------------------------------------------- Visemas */
  function visema(ch) {
    const c = quitarAcentos(ch);
    if ('a'.includes(c)) return [1, 0];
    if ('e'.includes(c)) return [0.7, 0];
    if ('iy'.includes(c)) return [0.45, 0];
    if ('o'.includes(c)) return [0.85, 0.8];
    if ('uw'.includes(c)) return [0.55, 1];
    if ('mbp'.includes(c)) return [0.02, 0];
    if ('fv'.includes(c)) return [0.15, 0];
    if (/[a-z0-9ñ]/.test(c)) return [0.32, 0];
    return [0, 0];
  }
  function lineaDeTiempo(texto, cps) {
    const tl = new Float32Array(texto.length + 1);
    let acc = 0;
    for (let i = 0; i < texto.length; i++) {
      tl[i] = acc;
      const c = texto[i];
      acc += (/[.!?…]/.test(c) ? 7 : /[,;:]/.test(c) ? 4 : c === '\n' ? 5 : c === ' ' ? 1.2 : 1) / cps;
    }
    tl[texto.length] = acc;
    return tl;
  }
  function indiceEn(tl, t) {
    let lo = 0, hi = tl.length - 1;
    if (t >= tl[hi]) return hi;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (tl[mid] <= t) lo = mid; else hi = mid - 1; }
    return lo + clamp((t - tl[lo]) / Math.max(1e-4, (tl[lo + 1] || tl[lo]) - tl[lo]), 0, 0.999);
  }

  /* --------------------------------------------------------------- Habla */
  class Habla {
    constructor(m) { this.m = m; this.s = null; this.voces = []; this.cargarVoces(); }

    cargarVoces() {
      if (!window.speechSynthesis) return;
      const cargar = () => { this.voces = window.speechSynthesis.getVoices() || []; };
      cargar();
      window.speechSynthesis.onvoiceschanged = cargar;
    }

    elegirVoz(cfg) {
      const vs = this.voces;
      if (!vs.length) return null;
      if (cfg.nombre) { const v = vs.find((x) => x.name.toLowerCase().includes(String(cfg.nombre).toLowerCase())); if (v) return v; }
      const idioma = (cfg.idioma || 'es').toLowerCase();
      return vs.find((x) => x.lang && x.lang.toLowerCase().startsWith(idioma) && x.localService) ||
             vs.find((x) => x.lang && x.lang.toLowerCase().startsWith(idioma)) || null;
    }

    decir(texto, o) {
      o = o || {};
      this.detener();
      const m = this.m;
      texto = String(texto == null ? '' : texto).trim();
      if (!texto) return Promise.resolve({ vacio: true });
      const vel = clamp(Number(o.velocidad) || 1, 0.3, 3);
      const cps = 14 * vel;
      const s = (this.s = { texto, t0: m.t, cps, tl: lineaDeTiempo(texto, cps), idx: 0, boca: 0, redondez: 0, voz: false, finVoz: true,
        gestos: o.gestos !== false, cerrado: false });
      s.burbuja = m.burbuja.mostrar({ texto, tipo: o.tipo || 'habla', modo: 'sync', fijo: o.fijo, duracion: o.duracionBurbuja });
      const cfg = Object.assign({}, m.config.voz || {});
      const quiereVoz = o.voz != null ? !!o.voz : !!cfg.activada;
      // Sin voz del sistema: "charla" de droide al ritmo del texto (sonidos de robot)
      if (!quiereVoz && m.sonidos && o.charla !== false) m.sonidos.charla(texto, Math.min(2.2, s.tl[texto.length] * 0.6));
      if (o.audio) this.reproducir(s, o.audio, cfg).catch(() => this.vozSistema(s, texto, cfg, vel));
      else if (quiereVoz && cfg.motor && cfg.motor !== 'windows' && m.puenteTTS) {
        // 🗣 Voz moderna (Microsoft neuronal, NVIDIA Magpie o las de Noviq): la sintetiza el avatar; si no llega, voz de Windows
        s.voz = true; s.finVoz = false; s.esperando = true; s.vozT0 = m.t;
        const planB = () => { if (this.s === s && s.esperando) { s.esperando = false; this.vozSistema(s, texto, cfg, vel); } };
        const tm = setTimeout(planB, 9000);
        m.puenteTTS(texto, { estilo: o.expresion || '', velocidad: o.velocidad }).then((r) => {
          clearTimeout(tm);
          if (this.s !== s || !s.esperando) return;
          s.esperando = false;
          if (r && r.ok && r.audio) this.reproducir(s, r.audio, cfg).catch(() => this.vozSistema(s, texto, cfg, vel));
          else this.vozSistema(s, texto, cfg, vel);
        }, () => { clearTimeout(tm); planB(); });
      } else if (quiereVoz) this.vozSistema(s, texto, cfg, vel);
      m.emitir('habla_inicio', { texto });
      m.emitirEstado();
      return new Promise((res) => (s.resolver = res));
    }

    /** Voces instaladas en Windows (SpeechSynthesis): respaldo cuando no hay voz moderna. */
    vozSistema(s, texto, cfg, vel) {
      const m = this.m;
      if (!window.speechSynthesis || !window.SpeechSynthesisUtterance) { s.voz = false; s.finVoz = true; return; }
      try {
        const u = new SpeechSynthesisUtterance(texto);
        const v = this.elegirVoz(cfg);
        if (v) { u.voice = v; u.lang = v.lang; } else u.lang = cfg.idioma || 'es-ES';
        u.rate = clamp((cfg.velocidad || 1) * vel, 0.3, 3);
        u.pitch = clamp(cfg.tono || 1, 0, 2);
        u.volume = clamp(cfg.volumen == null ? 1 : cfg.volumen, 0, 1);
        u.onboundary = (e) => {
          if (e.name && e.name !== 'word') return;
          let fin = e.charIndex + (e.charLength || 0);
          if (!e.charLength) { const r = texto.slice(e.charIndex).match(/^\S+/); fin = e.charIndex + (r ? r[0].length : 1); }
          s.palabra = { ini: e.charIndex, fin, t0: m.t };
          s.hayLimites = true;
        };
        u.onend = u.onerror = () => { s.finVoz = true; };
        s.utter = u; s.voz = true; s.finVoz = false; s.vozT0 = m.t;
        window.speechSynthesis.cancel();
        window.speechSynthesis.speak(u);
      } catch (e) { s.voz = false; s.finVoz = true; }
    }

    /** Reproduce audio (mp3/wav en base64) y mueve la boca con su energía real. */
    async reproducir(s, b64, cfg) {
      const m = this.m;
      s.voz = true; s.finVoz = false; s.esperando = false; s.vozT0 = m.t;
      const AC = window.AudioContext || window.webkitAudioContext;
      const ctx = this.ctx || (this.ctx = new AC());
      if (ctx.state === 'suspended') { try { await ctx.resume(); } catch (_) { /* noop */ } }
      const bin = atob(b64), bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
      const buf = await ctx.decodeAudioData(bytes.buffer);
      if (this.s !== s || s.cerrado) return;
      const src = ctx.createBufferSource(); src.buffer = buf;
      const an = ctx.createAnalyser(); an.fftSize = 1024; an.smoothingTimeConstant = 0.3;
      const g = ctx.createGain(); g.gain.value = clamp(cfg && cfg.volumen != null ? Number(cfg.volumen) : 1, 0, 1.5);
      src.connect(an); an.connect(g); g.connect(ctx.destination);
      src.onended = () => { s.finVoz = true; };
      s.audio = { src, an, ctx, dur: buf.duration, t0: ctx.currentTime, datos: new Float32Array(an.fftSize) };
      src.start();
    }

    aplicar(T, dt) {
      const s = this.s, m = this.m;
      if (!s) return;
      const t = m.t - s.t0;
      let idx, cerrada = false;
      if (s.voz) {
        if (s.finVoz) idx = s.texto.length;
        else if (s.esperando) idx = 0;
        else if (s.audio) idx = Math.min(s.texto.length - 0.5, s.texto.length * (s.audio.ctx.currentTime - s.audio.t0) / Math.max(0.1, s.audio.dur));
        else if (s.hayLimites && s.palabra) {
          idx = Math.min(s.palabra.fin, s.palabra.ini + (m.t - s.palabra.t0) * s.cps * 1.15);
          if (idx >= s.palabra.fin) cerrada = true;
        } else idx = Math.min(s.texto.length - 0.5, indiceEn(s.tl, m.t - s.vozT0));
        if (!s.finVoz && m.t - s.vozT0 > 120) s.finVoz = true; // salvaguarda
      } else idx = indiceEn(s.tl, t);
      s.idx = Math.max(s.idx, idx);
      const propia = m.burbuja.s && m.burbuja.s.token === s.burbuja.token;
      if (!propia && !s.cerrado) { this.detener(); return; }   // otra burbuja la reemplazó
      if (propia) m.burbuja.progreso(s.idx);

      const hablando = s.voz ? !s.finVoz : s.idx < s.texto.length;
      if (!hablando && !s.cerrado) {
        s.cerrado = true;
        if (m.burbuja.s && m.burbuja.s.token === s.burbuja.token) m.burbuja.finSync();
        m.emitir('habla_fin', { texto: s.texto });
        s.burbuja.promesa.then(() => {
          if (this.s === s) this.s = null;
          if (s.resolver) s.resolver({ ok: true });
          m.emitirEstado();
        });
      }
      let objetivo = 0, red = 0;
      if (hablando && !cerrada && s.audio) {
        // boca según la energía del audio real
        s.audio.an.getFloatTimeDomainData(s.audio.datos);
        let e = 0; for (let i = 0; i < s.audio.datos.length; i++) e += s.audio.datos[i] * s.audio.datos[i];
        const rms = Math.sqrt(e / s.audio.datos.length);
        objetivo = clamp((rms - 0.012) * 7, 0, 1);
        red = 0.25 + 0.25 * Math.sin(m.t * 7.3);
      } else if (hablando && !cerrada && !s.esperando) {
        const [a, r] = visema(s.texto[Math.floor(s.idx)] || ' ');
        objetivo = a * (0.85 + 0.15 * Math.sin(m.t * 31)); red = r;
      }
      s.boca = lerp(s.boca, objetivo, 1 - Math.exp(-28 * dt));
      s.redondez = lerp(s.redondez, red, 1 - Math.exp(-18 * dt));
      if (s.boca > 0.01 || hablando) {
        T.mouthOpen = Math.max(T.mouthOpen, s.boca * 0.6);
        T.mouthRound = Math.max(T.mouthRound, s.redondez * s.boca);
        T.mouthGrille = Math.max(T.mouthGrille, hablando ? 0.8 : 0);
      }
      if (hablando) {
        if (s.gestos && (!m.accion || m.accion.nombre === 'reposo')) N.ACCIONES._gestos.pose(T, t);
        m.fx.want.ondasHabla = 1;
      }
    }

    detener() {
      const s = this.s;
      if (!s) return;
      this.s = null;
      s.esperando = false;
      if (s.audio) { try { s.audio.src.onended = null; s.audio.src.stop(); } catch (_) { /* noop */ } }
      else if (s.voz && window.speechSynthesis) window.speechSynthesis.cancel();
      this.m.burbuja.ocultar(s.burbuja.token);
      if (s.resolver) s.resolver({ interrumpido: true });
    }

    get activo() { return !!this.s && !this.s.cerrado; }
  }

  /* --------------------------------------------------------------- Motor */
  function tasaDe(k) {
    if (k === 'mouthOpen') return 30;
    if (k.startsWith('mouth')) return 18;
    if (k.startsWith('eye') || k.startsWith('look')) return 16;
    if (/^[LR](c\d|sp)$/.test(k)) return 16;
    if (/^[LR]/.test(k)) return 11;
    if (k.startsWith('head')) return 10;
    if (k === 'iconT') return 5;
    if (k === 'grid' || k === 'glow' || k === 'visorIcon') return 5;
    if (k === 'lean') return 5;
    return 9;
  }

  class Motor {
    constructor({ rig, fx, burbuja, config, emitir, sonidos }) {
      this.rig = rig; this.fx = fx; this.burbuja = burbuja;
      this.sonidos = sonidos || null;   // N.Sonidos (pitidos de robot)
      this.oido = null;                  // N.Oido (lo conecta app.js)
      this.config = config || {};
      this._emitir = emitir || (() => {});
      this.p = N.poseBase();
      this.claves = Object.keys(this.p);
      this.tasas = {}; for (const k of this.claves) this.tasas[k] = tasaDe(k);
      this.t = 0; this.ultimo = null;
      this.exprBase = 'neutral'; this.exprTemp = null;
      this.accion = null;
      this.manual = {}; this.manualHasta = null;
      this.mirada = null;
      this.cursor = null; this.mirarCursor = this.config.mirarCursor !== false;
      this.vuelo = { vx: 0, vy: 0 };
      this.bocaExt = { v: 0, hasta: 0 };
      this.visor = null;
      this.modo = 'avatar';
      this.agarrado = false; this.hover = false;
      this.parpadeo = { prox: 2 + Math.random() * 3, ini: -1, doble: false };
      this.ocio = { prox: 6, x: 0, y: 0, hasta: 0 };
      this.habla = new Habla(this);
      this.congelado = false;
    }

    emitir(n, d) { try { this._emitir(n, d || {}); } catch (e) { /* noop */ } }
    emitirEstado() { this.emitir('_estado', this.estado()); }
    estado() {
      return {
        modo: this.modo,
        accion: this.accion ? this.accion.nombre : 'reposo',
        expresion: (this.accion && this.accion.expr) || this.exprTemp && this.exprTemp.nombre || this.exprBase,
        expresionBase: this.exprBase,
        hablando: this.habla.activo,
        burbuja: this.burbuja.visible ? this.burbuja.texto : null,
        oido: this.oido ? this.oido.info() : null,
        sonidos: this.sonidos ? !!this.sonidos.cfg.activados : false
      };
    }

    sonar(nombre, op) { return this.sonidos ? this.sonidos.reproducir(nombre, op) : 0; }

    iniciar() {
      const bucle = (ts) => { this.paso(ts); requestAnimationFrame(bucle); };
      requestAnimationFrame(bucle);
    }

    /* ---------------------------------------------------------- Fotograma */
    paso(ts, dtForzado) {
      if (this.ultimo == null) this.ultimo = ts;
      const dt = dtForzado != null ? dtForzado : Math.min(0.05, Math.max(0, (ts - this.ultimo) / 1000));
      this.ultimo = ts;
      if (this.congelado && dtForzado == null) return;
      this.t += dt;
      const t = this.t;
      const T = N.poseBase();
      this.fx.resetWant();

      N.ACCIONES.reposo.pose(T, t);
      const exprNombre = (this.accion && this.accion.expr) || (this.exprTemp ? this.exprTemp.nombre : this.exprBase);
      N.aplicarExpresion(T, exprNombre);
      if (this.exprTemp && t > this.exprTemp.hasta) { this.exprTemp = null; this.emitirEstado(); }

      let rapidez = 1;
      if (this.accion) {
        const a = this.accion, ta = t - a.t0;
        rapidez = a.def.rapidez || 1;
        a.def.pose(T, ta, a.P, this, a);
        if (a.hecho || (a.dur != null && ta >= a.dur)) this.terminarAccion(false);
      }
      this.habla.aplicar(T, dt);
      if (this.agarrado) { N.ACCIONES._agarrado.pose(T, t); rapidez = 1.6; }

      // Control manual
      if (this.manualHasta != null && t > this.manualHasta) { this.manual = {}; this.manualHasta = null; }
      for (const k in this.manual) T[k] = this.manual[k];

      // Mirada: explícita > cursor > mirada ociosa
      const dormido = exprNombre === 'dormido';
      if (this.mirada && this.mirada.hasta != null && t > this.mirada.hasta) this.mirada = null;
      if (this.mirada) {
        T.lookX = this.mirada.x; T.lookY = this.mirada.y;
        T.headYaw += this.mirada.x * 0.28; T.headPitch += this.mirada.y * 0.14;
      } else if (!dormido && this.mirarCursor && this.cursor && t - this.cursor.t < 1.5 && this.modo === 'avatar') {
        const dx = this.cursor.x - 220, dy = this.cursor.y - (232 + this.p.bodyY);
        const d = Math.hypot(dx, dy);
        const w = (this.hover || this.agarrado ? 1 : 1 - smooth(500, 1400, d)) * (this.accion && this.accion.def.mira ? 0.3 : 0.75);
        const lx = clamp(dx / 260, -1, 1), ly = clamp(dy / 260, -1, 1);
        T.lookX = lerp(T.lookX, lx, w); T.lookY = lerp(T.lookY, ly, w);
        T.headYaw += lx * 0.14 * w; T.headPitch += ly * 0.07 * w;
      } else if (!dormido && !this.accion && !this.habla.activo) {
        const o = this.ocio;
        if (t > o.prox) { o.x = (Math.random() - 0.5) * 1.4; o.y = (Math.random() - 0.6) * 0.8; o.hasta = t + 0.9 + Math.random() * 0.9; o.prox = t + 5 + Math.random() * 6; }
        if (t < o.hasta) { T.lookX = o.x; T.lookY = o.y; T.headYaw += o.x * 0.15; }
      }

      // Boca externa (lip-sync desde otro programa)
      if (t < this.bocaExt.hasta) { T.mouthOpen = Math.max(T.mouthOpen, this.bocaExt.v * 0.75); T.mouthGrille = Math.max(T.mouthGrille, 0.7); }

      // Icono en el visor
      if (this.visor) { T.visorIcon = 1; if (this.visor.hasta != null && t > this.visor.hasta) this.visor = null; }

      // Vuelo por la pantalla
      const vx = this.vuelo.vx, vel = Math.hypot(vx, this.vuelo.vy);
      if (vel > 20) {
        T.lean = clamp(vx * 0.012, -14, 14);
        const tr = clamp(vel / 1500, 0, 1);
        T.Lsh += 18 * tr; T.Rsh += 18 * tr; T.Lel -= 10 * tr; T.Rel -= 10 * tr;
        T.headRot -= T.lean * 0.3;
      }

      T.iconT = this.modo === 'icono' ? 1 : 0;

      // Suavizado
      const p = this.p;
      for (const k of this.claves) {
        let tasa = this.tasas[k];
        if (/^[LR]|^head|^body/.test(k)) tasa *= rapidez;
        p[k] = lerp(p[k], T[k], 1 - Math.exp(-tasa * dt));
      }

      // Parpadeo
      let blink = 1;
      const pb = this.parpadeo;
      if (t > pb.prox && pb.ini < 0) pb.ini = t;
      if (pb.ini >= 0) {
        const k = (t - pb.ini) / 0.15;
        if (k >= 1) { pb.ini = -1; pb.prox = t + (pb.doble ? 0.12 : 2.2 + Math.random() * 3.8); pb.doble = !pb.doble && Math.random() < 0.2; }
        else blink = 1 - 0.95 * Math.sin(k * Math.PI);
      }
      if (dormido) blink = 1;

      this.rig.aplicar(p, t, { blink });
      this.fx.frame(dt, t, p);
      const ancla = this.anclaBurbuja();
      this.burbuja.frame(dt, ancla.x, ancla.y);
    }

    anclaBurbuja() {
      const it = this.p.iconT;
      const yAv = 126 + this.p.bodyY + this.p.headY, yIc = 460;
      return { x: 220 + this.p.bodyX, y: lerp(yAv, yIc, it) };
    }

    /* ------------------------------------------------------------ Acciones */
    iniciarAccion(nombre, P) {
      const def = N.ACCIONES[nombre];
      if (this.accion) this.terminarAccion(true);
      this.manual = {}; this.manualHasta = null;
      let dur = def.dur;
      if (P.duracion != null) dur = Number(P.duracion) > 0 ? Number(P.duracion) / 1000 : null;
      const exprP = N.resolverExpresion(P.expresion);
      const a = { nombre, def, P, t0: this.t, dur, expr: exprP || def.expr || null, estado: {}, hecho: false };
      this.accion = a;
      if (this.sonidos && this.sonidos.cfg.automaticos && !P._sinSonido) {
        const son = SONIDO_ACCION[nombre];
        if (son) this.sonar(son, { n: P.texto ? Math.min(16, Math.round(String(P.texto).length / 4)) : 8 });
      }
      if (def.inicio) def.inicio(P, this, a);
      if (P.duracion != null && Number(P.duracion) > 0) a.dur = Number(P.duracion) / 1000;
      const promesa = new Promise((res) => (a.resolver = res));
      this.emitir('accion_inicio', { accion: nombre });
      this.emitirEstado();
      return { a, promesa };
    }

    terminarAccion(interrumpida) {
      const a = this.accion;
      if (!a) return;
      this.accion = null;
      try { if (a.def.fin) a.def.fin(a.P, this, a, interrumpida); } catch (e) { console.error(e); }
      if (a.resolver) a.resolver({ accion: a.nombre, interrumpida: !!interrumpida });
      this.emitir('accion_fin', { accion: a.nombre, interrumpida: !!interrumpida });
      this.emitirEstado();
    }

    detenerTodo() {
      if (this.accion) this.terminarAccion(true);
      this.habla.detener();
      this.burbuja.ocultar();
      this.manual = {}; this.manualHasta = null; this.mirada = null; this.visor = null; this.exprTemp = null;
      this.emitirEstado();
    }

    /* ----------------------------------------------------------- Comandos */
    // Devuelve una promesa que se resuelve cuando el comando termina.
    // Acciones en bucle se resuelven al instante con { bucle: true }.
    ejecutar(nombre, P) {
      P = P || {};
      const n = quitarAcentos(nombre).replace(/[\s-]+/g, '_');
      const accion = N.ACCION_ALIAS[n];
      const dur = P.duracion != null ? Number(P.duracion) : null;

      if (n === 'progreso') {
        this.fx.setProgreso(P.valor != null ? P.valor : 0, P.etiqueta != null ? P.etiqueta : (P.texto != null ? P.texto : null));
        let a = this.accion && this.accion.nombre === 'progreso' ? this.accion : null;
        let promesa;
        if (!a) { const r = this.iniciarAccion('progreso', P); a = r.a; promesa = r.promesa; }
        else { a.P = Object.assign(a.P, P); promesa = new Promise((res) => { const prev = a.resolver; a.resolver = (x) => { prev && prev(x); res(x); }; }); }
        if (this.fx.progreso.completo) { if (!a.estado.completo) a.estado.completo = this.t; return promesa; }
        a.estado.completo = null;
        return Promise.resolve({ progreso: this.fx.progreso.valor });
      }

      if (accion) {
        if (n === 'reposo') { this.detenerTodo(); return Promise.resolve({ ok: true }); }
        const { a, promesa } = this.iniciarAccion(accion, P);
        if (P.texto && accion !== 'pensar' && accion !== 'textear') this.habla.decir(P.texto, Object.assign({}, P, { gestos: false }));
        if (a.dur == null && !a.P.texto) return Promise.resolve({ accion, bucle: true });
        return promesa;
      }

      switch (n) {
        case 'decir': {
          if (P.accion) { const acc = N.ACCION_ALIAS[quitarAcentos(P.accion)]; if (acc) this.iniciarAccion(acc, {}); }
          if (P.expresion) { const e = N.resolverExpresion(P.expresion); if (e) this.exprTemp = { nombre: e, hasta: this.t + 60 }; }
          const pr = this.habla.decir(P.texto, P);
          if (P.expresion) pr.then(() => { this.exprTemp = null; this.emitirEstado(); });
          return pr;
        }
        case 'mensaje': {
          const b = this.burbuja.mostrar({ texto: P.texto, tipo: P.tipo || 'mensaje', modo: P.modo || (P.escribir === false ? 'instantaneo' : 'maquina'),
            cps: P.cps || 38, fijo: P.fijo, duracion: dur });
          this.emitirEstado();
          return b.promesa.then((r) => { this.emitirEstado(); return r; });
        }
        case 'callar':
          this.habla.detener(); this.burbuja.ocultar(); this.emitirEstado();
          return Promise.resolve({ ok: true });
        case 'sonido': {
          const nom = quitarAcentos(P.nombre || P.valor || P.texto || 'blip');
          const d = this.sonar(nom, P);
          if (!d && this.sonidos && this.sonidos.cfg.activados) return Promise.reject(new Error('Sonido desconocido: ' + nom + '. Usa: ' + (N.RECETAS_SONIDO || []).join(', ')));
          return new Promise((res) => setTimeout(() => res({ sonido: nom, segundos: +d.toFixed(2) }), d * 1000));
        }
        case 'sonidos':
          if (!this.sonidos) return Promise.resolve({ ok: false });
          return Promise.resolve(this.sonidos.configurar({
            activados: P.activo != null ? P.activo !== false : P.valor != null && typeof P.valor === 'boolean' ? P.valor : this.sonidos.cfg.activados,
            volumen: P.volumen != null ? Number(P.volumen) : this.sonidos.cfg.volumen,
            automaticos: P.automaticos != null ? !!P.automaticos : this.sonidos.cfg.automaticos,
            charla: P.charla != null ? !!P.charla : this.sonidos.cfg.charla
          }));
        case 'microfono': {
          if (!this.oido) return Promise.reject(new Error('El oído no está disponible.'));
          if (P.modo) return this.oido.configurar({ modo: quitarAcentos(P.modo), sensibilidad: P.sensibilidad, maxSeg: P.maxSeg });
          if (P.activo === false) { if (this.oido.forzado) this.oido.cancelarForzado(); return Promise.resolve(this.oido.info()); }
          return this.oido.escucharAhora({ segundos: P.segundos, silencioso: P.silencioso });
        }
        case 'foto': {
          if (!this.camara) this.camara = new N.Camara();
          return this.camara.capturar(P);
        }
        case 'camaras': {
          if (!this.camara) this.camara = new N.Camara();
          return this.camara.listar();
        }
        case 'aviso': {
          const tipo = quitarAcentos(P.tipo || P.valor || 'info');
          const def = AVISOS[tipo] || AVISOS.info;
          if (this.modo === 'icono' && def.expandir) { this.modo = 'avatar'; this.emitir('modo', { modo: 'avatar' }); }
          if (this.accion && this.accion.nombre === 'dormir') this.terminarAccion(true);
          const d = P.sonido === false ? 0 : this.sonar(P.sonido || def.son);
          // gesto: el del tipo de aviso, uno propio (p. ej. "reir", "saludar", "aclarar") o ninguno (false)
          const gesto = typeof P.gesto === 'string' ? N.ACCION_ALIAS[quitarAcentos(P.gesto)] : (P.gesto === false ? null : def.acc);
          if (gesto) this.iniciarAccion(gesto, { _sinSonido: true, duracion: gesto === def.acc ? def.dur : undefined });
          if (!P.texto) return new Promise((res) => setTimeout(() => res({ aviso: tipo }), d * 1000));
          return new Promise((res) => setTimeout(() => {
            this.ejecutar('decir', { texto: P.texto, voz: P.voz, expresion: P.expresion || def.expr, fijo: P.fijo, gestos: !gesto,
              charla: P.voz ? false : undefined, velocidad: P.velocidad }).then(res, res);
          }, Math.min(650, d * 1000)));
        }
        case 'expresion':
        case 'sonreir': {
          const e = n === 'sonreir' ? 'sonrisa' : N.resolverExpresion(P.valor || P.nombre || P.expresion);
          if (!e) return Promise.reject(new Error('Expresión desconocida: ' + (P.valor || P.nombre) + '. Usa: ' + Object.keys(N.EXPRESIONES).join(', ')));
          const d = n === 'sonreir' && dur == null ? 2500 : dur;
          if (d) { this.exprTemp = { nombre: e, hasta: this.t + d / 1000 }; } else { this.exprBase = e; this.exprTemp = null; }
          if (this.accion && this.accion.expr && !this.accion.P.expresion) this.accion.expr = e;
          this.emitirEstado();
          return Promise.resolve({ expresion: e });
        }
        case 'herramienta': {
          if (P.nombre === false || P.valor === false || P.activo === false) { this.visor = null; return Promise.resolve({ ok: true }); }
          this.fx.setIconoVisor(P.nombre || P.valor || 'engranaje');
          this.visor = { hasta: dur === 0 ? null : this.t + (dur || 2500) / 1000 };
          return new Promise((res) => setTimeout(() => res({ ok: true }), dur || 2500));
        }
        case 'mirar': {
          const dir = quitarAcentos(P.direccion || P.valor || '');
          const mapa = { izquierda: [-1, 0], derecha: [1, 0], arriba: [0, -1], abajo: [0, 1], frente: null, centro: null, cursor: 'cursor' };
          let v = null;
          if (P.x != null || P.y != null) v = [clamp(Number(P.x) || 0, -1, 1), clamp(Number(P.y) || 0, -1, 1)];
          else if (dir in mapa) v = mapa[dir];
          else if (dir) return Promise.reject(new Error('Dirección no válida: ' + dir));
          if (v === 'cursor') { this.mirada = null; this.mirarCursor = true; }
          else if (!v) { this.mirada = null; }
          else this.mirada = { x: v[0], y: v[1], hasta: dur ? this.t + dur / 1000 : null };
          return Promise.resolve({ ok: true });
        }
        case 'mirar_cursor':
          this.mirarCursor = P.activo !== false && P.valor !== false;
          return Promise.resolve({ mirarCursor: this.mirarCursor });
        case 'boca': {
          const v = clamp(Number(P.abrir != null ? P.abrir : P.valor) || 0, 0, 1);
          this.bocaExt = { v, hasta: this.t + (dur || 180) / 1000 };
          return Promise.resolve({ ok: true });
        }
        case 'brazo': {
          for (const S of ladoDe(P.lado)) {
            if (P.hombro != null) this.manual[S + 'sh'] = Number(P.hombro);
            if (P.codo != null) this.manual[S + 'el'] = Number(P.codo);
            if (P.muneca != null) this.manual[S + 'wr'] = Number(P.muneca);
            if (P.escorzo != null) this.manual[S + 'fs'] = Number(P.escorzo);
            if (P.gesto) this.aplicarGestoManual(S, P.gesto);
          }
          this.manualHasta = dur ? this.t + dur / 1000 : null;
          return Promise.resolve({ ok: true });
        }
        case 'mano': {
          const g = N.GESTO_ALIAS[quitarAcentos(P.gesto || P.valor || P.nombre)];
          if (!g) return Promise.reject(new Error('Gesto no válido. Usa: ' + Object.keys(N.GESTOS).join(', ')));
          for (const S of ladoDe(P.lado)) this.aplicarGestoManual(S, g);
          this.manualHasta = dur ? this.t + dur / 1000 : null;
          return Promise.resolve({ ok: true });
        }
        case 'cabeza': {
          if (P.giro != null) this.manual.headYaw = clamp(Number(P.giro), -1, 1);
          if (P.inclinacion != null) this.manual.headPitch = clamp(Number(P.inclinacion), -1, 1) * 0.4;
          if (P.rotacion != null) this.manual.headRot = clamp(Number(P.rotacion), -35, 35);
          this.manualHasta = dur ? this.t + dur / 1000 : null;
          return Promise.resolve({ ok: true });
        }
        case 'pose': {
          const mapa = { cabeza: 'cabeza', brazoIzquierdo: 'L', brazoDerecho: 'R', brazo_izquierdo: 'L', brazo_derecho: 'R', manoIzquierda: 'mL', manoDerecha: 'mR', mano_izquierda: 'mL', mano_derecha: 'mR' };
          for (const k in P) {
            const dest = mapa[k]; const v = P[k];
            if (!dest || v == null) continue;
            if (dest === 'cabeza') this.ejecutar('cabeza', Object.assign({}, v, { duracion: dur }));
            else if (dest === 'L' || dest === 'R') this.ejecutar('brazo', Object.assign({}, v, { lado: dest === 'L' ? 'izquierda' : 'derecha', duracion: dur }));
            else this.ejecutar('mano', { gesto: typeof v === 'string' ? v : v.gesto, lado: dest === 'mL' ? 'izquierda' : 'derecha', duracion: dur });
          }
          if (P.expresion) this.ejecutar('expresion', { valor: P.expresion });
          return Promise.resolve({ ok: true });
        }
        case 'soltar':
          this.manual = {}; this.manualHasta = null;
          return Promise.resolve({ ok: true });
        case 'icono':
        case 'expandir': {
          const nuevo = n === 'icono' ? (P.activo === false ? 'avatar' : 'icono') : 'avatar';
          if (nuevo !== this.modo) { this.modo = nuevo; this.emitir('modo', { modo: nuevo }); this.emitirEstado(); }
          return new Promise((res) => setTimeout(() => res({ modo: this.modo }), 700));
        }
        case 'alternar_icono':
          return this.ejecutar(this.modo === 'icono' ? 'expandir' : 'icono', {});
        case 'detener':
          this.detenerTodo();
          return Promise.resolve({ ok: true });
        case '_agarre':
          this.agarrado = !!P.activo;
          return Promise.resolve({ ok: true });
        default:
          return Promise.reject(new Error('Comando no reconocido por el avatar: ' + nombre));
      }
    }

    aplicarGestoManual(S, gestoNombre) {
      const g = N.GESTOS[N.GESTO_ALIAS[quitarAcentos(gestoNombre)] || gestoNombre];
      if (!g) return;
      for (let i = 0; i < 5; i++) this.manual[S + 'c' + i] = g[i];
      this.manual[S + 'sp'] = g[5];
    }
  }

  const SONIDO_ACCION = {
    saludar: 'saludo', reir: 'risa', celebrar: 'celebrar', sorpresa: 'sorpresa', confundido: 'confundido', dormir: 'dormir',
    despertar: 'despertar', analizar: 'procesar', pensar: 'pensar', herramientas: 'herramienta', textear: 'escribir',
    trabajar: 'procesar', asentir: 'entendido', negar: 'no_entendi', bailar: 'celebrar'
  };
  // aviso: mensaje corto con sonido + gesto + expresión («ya terminé», «necesito tu permiso», recordatorios…)
  const AVISOS = {
    exito: { son: 'exito', acc: 'celebrar', expr: 'feliz', expandir: true },
    terminado: { son: 'exito', acc: 'celebrar', expr: 'feliz', expandir: true },
    error: { son: 'error', acc: 'confundido', expr: 'triste', expandir: true },
    atencion: { son: 'atencion', acc: 'aclarar', expr: 'atento', expandir: true },
    permiso: { son: 'atencion', acc: 'aclarar', expr: 'atento', expandir: true },
    pregunta: { son: 'pregunta', acc: 'aclarar', expr: 'atento', expandir: true },
    info: { son: 'info', acc: null, expr: 'sonrisa' },
    charla: { son: null, acc: null, expr: null },
    trabajando: { son: 'procesar', acc: 'trabajar', expr: 'enfocado', dur: 0 },
    escuchando: { son: 'escuchar', acc: 'escuchar', expr: 'atento', dur: 0 },
    saludo: { son: 'saludo', acc: 'saludar', expr: 'feliz', expandir: true },
    adios: { son: 'apagar', acc: 'saludar', expr: 'sonrisa' }
  };

  N.Motor = Motor;
  N.quitarAcentos = quitarAcentos;
})();
