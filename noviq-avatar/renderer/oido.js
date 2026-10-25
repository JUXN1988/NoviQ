/* ==========================================================================
   Noviq Avatar — Oído: micrófono + detector de voz
   Modos:  apagado · palabra (reacciona cuando dices su nombre: «Noviq…») ·
           siempre (todo lo que oiga) · pulsar (solo al hacer clic en el
           micrófono o con el atajo de teclado).
   Graba solo cuando detecta voz (energía adaptativa al ruido del cuarto),
   corta tras ~0,9 s de silencio, convierte a WAV 16 kHz mono y lo manda al
   proceso principal: SU oído lo transcribe y SU mente decide. Mientras habla o
   suena, no escucha (para no oírse a sí mismo).
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const MODOS = ['apagado', 'palabra', 'siempre', 'pulsar'];
  const SR = 16000;

  function wav16(muestras) {
    const n = muestras.length, buf = new ArrayBuffer(44 + n * 2), v = new DataView(buf);
    const txt = (o, s) => { for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i)); };
    txt(0, 'RIFF'); v.setUint32(4, 36 + n * 2, true); txt(8, 'WAVE'); txt(12, 'fmt ');
    v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true); v.setUint32(24, SR, true);
    v.setUint32(28, SR * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true); txt(36, 'data'); v.setUint32(40, n * 2, true);
    let pico = 0;
    for (let i = 0; i < n; i++) pico = Math.max(pico, Math.abs(muestras[i]));
    const g = pico > 0 && pico < 0.5 ? Math.min(4, 0.7 / pico) : 1;   // normaliza voces bajas
    for (let i = 0; i < n; i++) { const s = Math.max(-1, Math.min(1, muestras[i] * g)); v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true); }
    return new Uint8Array(buf);
  }
  function base64(bytes) {
    let s = '';
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    return btoa(s);
  }

  class Oido {
    constructor({ motor, sonidos, puente, escena, config }) {
      this.motor = motor; this.sonidos = sonidos; this.puente = puente;
      const c = Object.assign({ modo: 'palabra', maxSeg: 20, sensibilidad: 1 }, config || {});
      this.modo = MODOS.includes(c.modo) ? c.modo : 'palabra';
      this.maxSeg = c.maxSeg; this.sensibilidad = c.sensibilidad; this.nombre = c.nombre || 'Noviq';
      this.stream = null; this.ctx = null; this.proc = null; this.abriendo = null;
      this.estado = 'apagado';            // apagado | listo | oyendo | procesando | error
      this.forzado = false; this.hastaForzado = 0;
      this.ruido = 0.008; this.hablando = false; this.cuenta = 0; this.silencio = 0; this.voz = 0;
      this.seg = []; this.segN = 0; this.previo = []; this.resto = 0;
      this.procesando = false; this.error = '';
      this.crearInsignia(escena);
      this.pintar();
    }

    /* ---------------------------------------------------------------- UI */
    crearInsignia(escena) {
      const d = document.createElement('div');
      d.className = 'oido';
      d.setAttribute('data-hit', '1');
      d.title = 'Clic: háblame · Clic derecho: menú';
      d.innerHTML = '<svg viewBox="0 0 24 24" width="22" height="22"><rect x="9" y="3" width="6" height="11" rx="3"/><path d="M6 11a6 6 0 0 0 12 0M12 17v4M9 21h6" fill="none"/></svg><i></i>';
      d.addEventListener('pointerdown', (e) => { e.stopPropagation(); if (e.button === 0) this.escucharAhora(); });
      d.addEventListener('pointerup', (e) => e.stopPropagation());
      escena.appendChild(d);
      this.el = d;
    }
    pintar() {
      if (!this.el) return;
      const oculto = this.motor.modo === 'icono' && this.estado !== 'oyendo' && this.estado !== 'procesando';
      this.el.className = 'oido ' + this.estado + (this.forzado ? ' forzado' : '') + (oculto ? ' escondido' : '') + (this.modo === 'apagado' ? ' off' : '');
      this.el.title = ({ apagado: 'Micrófono apagado · clic para hablarme', listo: this.modo === 'palabra' ? `Escuchando: di «${this.nombre}…» (o haz clic y habla)` : 'Escuchando',
        oyendo: 'Te estoy oyendo…', procesando: 'Entendiendo lo que dijiste…', error: 'Micrófono: ' + this.error })[this.estado] || '';
    }
    setEstado(e) { if (e !== this.estado) { this.estado = e; this.pintar(); this.informar(); } }
    informar() { try { this.puente && this.puente.evento('oido', this.info()); } catch (_) { /* noop */ } }
    info() { return { modo: this.modo, estado: this.estado, error: this.error || null }; }

    /* --------------------------------------------------------- Micrófono */
    async abrir() {
      if (this.stream) return true;
      if (this.abriendo) return this.abriendo;
      this.abriendo = (async () => {
        try {
          this.stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
          this.ctx = new (window.AudioContext || window.webkitAudioContext)();
          const src = this.ctx.createMediaStreamSource(this.stream);
          this.proc = this.ctx.createScriptProcessor(4096, 1, 1);
          const mudo = this.ctx.createGain(); mudo.gain.value = 0;
          src.connect(this.proc); this.proc.connect(mudo); mudo.connect(this.ctx.destination);
          this.proc.onaudioprocess = (e) => this.alAudio(e.inputBuffer.getChannelData(0));
          this.error = ''; this.setEstado('listo');
          return true;
        } catch (e) {
          this.error = /denied|permission|NotAllowed/i.test(String(e)) ? 'Windows no deja usar el micrófono (Configuración → Privacidad → Micrófono → permitir apps de escritorio)'
            : /NotFound|device/i.test(String(e)) ? 'no encontré ningún micrófono' : String(e && e.message || e);
          this.cerrar(); this.setEstado('error');
          return false;
        } finally { this.abriendo = null; }
      })();
      return this.abriendo;
    }
    cerrar() {
      try { if (this.proc) this.proc.onaudioprocess = null; } catch (_) { /* noop */ }
      try { if (this.stream) this.stream.getTracks().forEach((t) => t.stop()); } catch (_) { /* noop */ }
      try { if (this.ctx) this.ctx.close(); } catch (_) { /* noop */ }
      this.stream = null; this.ctx = null; this.proc = null; this.reiniciarSegmento();
      if (this.estado !== 'error') this.setEstado('apagado');
    }

    async configurar(c) {
      c = c || {};
      if (c.modo && MODOS.includes(c.modo)) this.modo = c.modo;
      if (c.maxSeg) this.maxSeg = Math.max(4, Math.min(60, Number(c.maxSeg)));
      if (c.sensibilidad) this.sensibilidad = Math.max(0.3, Math.min(3, Number(c.sensibilidad)));
      if (c.nombre) this.nombre = String(c.nombre);
      if (this.modo === 'palabra' || this.modo === 'siempre') await this.abrir();
      else if (!this.forzado) this.cerrar();
      this.pintar(); this.informar();
      return this.info();
    }

    /** Clic en el micrófono o atajo: escucha UNA frase sin necesidad de decir su nombre. */
    async escucharAhora(op) {
      op = op || {};
      if (this.forzado && !op.repetir) { this.cancelarForzado(); return this.info(); }
      if (!(await this.abrir())) {
        this.motor.ejecutar('decir', { texto: 'No puedo usar el micrófono: ' + this.error, expresion: 'triste' });
        return this.info();
      }
      this.forzado = true; this.hastaForzado = Date.now() + (op.segundos || 8) * 1000;
      this.forzadoAuto = !!(op.silencioso || op.repetir);   // ventana que abrí yo solo (no un clic tuyo): pasa por el filtro de voces
      this.reiniciarSegmento();
      this.sonidos.reproducir('escuchar');
      if (!op.silencioso) this.motor.ejecutar('escuchar', { duracion: 0 });
      this.pintar();
      clearTimeout(this.timerForzado);
      this.timerForzado = setTimeout(() => { if (this.forzado && !this.hablando) this.cancelarForzado(); }, (op.segundos || 8) * 1000);
      return this.info();
    }
    cancelarForzado() {
      this.forzado = false; clearTimeout(this.timerForzado);
      if (this.motor.accion && this.motor.accion.nombre === 'escuchar') this.motor.terminarAccion(true);
      this.sonidos.reproducir('oido_fin');
      if (this.modo === 'pulsar' || this.modo === 'apagado') this.cerrar(); else this.pintar();
    }

    /* ----------------------------------------------- Detector de actividad */
    silenciado() { return this.procesando || this.motor.habla.activo || this.sonidos.ocupado; }
    reiniciarSegmento() { this.hablando = false; this.cuenta = 0; this.silencio = 0; this.voz = 0; this.seg = []; this.segN = 0; }

    alAudio(x) {
      if (!this.ctx) return;
      const sr = this.ctx.sampleRate, ms = (x.length / sr) * 1000;
      // RMS del bloque
      let e = 0; for (let i = 0; i < x.length; i++) e += x[i] * x[i];
      const rms = Math.sqrt(e / x.length);
      // Remuestreo simple a 16 kHz (promedio por ventanas)
      const paso = sr / SR, out = new Float32Array(Math.floor((x.length - this.resto) / paso));
      let pos = this.resto;
      for (let i = 0; i < out.length; i++, pos += paso) {
        const a = Math.floor(pos), b = Math.min(x.length, Math.floor(pos + paso));
        let s = 0; for (let j = a; j < b; j++) s += x[j];
        out[i] = s / Math.max(1, b - a);
      }
      this.resto = pos - x.length; if (this.resto < 0) this.resto = 0;

      if (this.silenciado()) { this.reiniciarSegmento(); this.previo = []; if (this.estado === 'oyendo') this.setEstado('listo'); return; }
      if (!this.forzado && this.modo !== 'palabra' && this.modo !== 'siempre') return;

      const k = this.sensibilidad;
      const on = Math.max(0.012 / k, this.ruido * 3.2 / k), off = Math.max(0.008 / k, this.ruido * 2.0 / k);
      if (!this.hablando) {
        this.ruido = this.ruido * 0.96 + Math.min(rms, 0.05) * 0.04;
        this.previo.push(out); if (this.previo.length > 5) this.previo.shift();
        if (rms > on) {
          if (++this.cuenta >= 2) {
            this.hablando = true; this.silencio = 0; this.voz = ms * 2;
            this.seg = this.previo.slice(); this.segN = this.seg.reduce((a, b) => a + b.length, 0); this.previo = [];
            this.setEstado('oyendo');
            if (this.forzado) clearTimeout(this.timerForzado);
          }
        } else this.cuenta = 0;
        return;
      }
      this.seg.push(out); this.segN += out.length;
      if (rms < off) this.silencio += ms; else { this.silencio = 0; this.voz += ms; }
      const durSeg = (this.segN / SR) * 1000;
      if (this.silencio >= 900 || durSeg >= this.maxSeg * 1000) {
        const muestras = new Float32Array(this.segN); let o = 0;
        for (const b of this.seg) { muestras.set(b, o); o += b.length; }
        const util = this.voz;
        this.reiniciarSegmento();
        if (util >= 350) this.enviar(muestras);
        else this.setEstado('listo');
      }
    }

    async enviar(muestras) {
      const forzado = this.forzado, auto = !!this.forzadoAuto;
      let e = 0; for (let i = 0; i < muestras.length; i++) e += muestras[i] * muestras[i];
      const rms = Math.sqrt(e / Math.max(1, muestras.length));
      if (forzado) { this.forzado = false; clearTimeout(this.timerForzado); if (this.motor.accion && this.motor.accion.nombre === 'escuchar') this.motor.terminarAccion(false); }
      this.procesando = true; this.setEstado('procesando');
      let r = null;
      try {
        r = this.puente ? await this.puente.voz(base64(wav16(muestras)), { forzado: forzado && !auto, auto, modo: this.modo, segundos: +(muestras.length / SR).toFixed(2),
          rms: +rms.toFixed(5), ruido: +this.ruido.toFixed(5) })
          : { ok: false, error: 'sin puente' };
      } catch (e) { r = { ok: false, error: String(e && e.message || e) }; }
      this.procesando = false;
      if (this.modo === 'pulsar' && !this.forzado) this.cerrar(); else this.setEstado(this.stream ? 'listo' : 'apagado');
      r = r || {};
      if (r.ignorado) return r;                                  // no te hablaba a ti (no dijo su nombre)
      if (!r.ok) {
        if (forzado || r.avisar) {
          this.sonidos.reproducir('no_entendi');
          this.motor.ejecutar('decir', { texto: r.error || 'No pude entenderte.', expresion: 'confundido' });
        }
        return r;
      }
      if (r.texto && r.mostrar !== false) {
        this.sonidos.reproducir('entendido');
        this.motor.ejecutar('mensaje', { texto: '🎙 «' + r.texto + '»', duracion: 2600, tipo: 'pensamiento' });
      }
      if (r.escuchar_otra_vez) setTimeout(() => this.escucharAhora({ repetir: true, silencioso: true, segundos: 8 }), 700);
      this.forzadoAuto = false;
      return r;
    }
  }

  N.Oido = Oido;
  N.OIDO_MODOS = MODOS;
})();
