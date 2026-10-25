'use strict';
/* ==========================================================================
   Noviq Avatar — Oído (audio → texto) con motores propios
     nvidia · Whisper large-v3 en build.nvidia.com (tu clave nvapi-…)
     groq   · Whisper large-v3 turbo (muy rápido; tu clave de Groq)
     openai · gpt-4o-mini-transcribe (tu clave de OpenAI)
     noviq  · lo transcribe Noviq (incluye faster-whisper SIN internet)
     gratis · Whisper en LLM7 (con tu clave gratis de LLM7; la trae de Noviq)
     windows· el reconocedor de voz de Windows: SIN internet ni clave (menos preciso; solo si lo eliges)
   «auto» usa el más rápido que funcione y recuerda los que fallan.
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const riva = require('./riva');

// Frases que Whisper «inventa» con ruido o silencio
const ALUCINACIONES = /^(gracias\.?|¡?gracias!?|muchas gracias\.?|gracias por ver( el video)?\.?|subt[ií]tulos? (realizados )?por.*|amara\.org.*|suscr[ií]bete.*|thank you\.?|thanks for watching.*|\.+|…|música|music|aplausos|\[.*\]|\(.*\)|ah+!?|eh+\.?|mm+\.?|¡?oh!?|¡?ay!?|uh+\.?|hm+\.?|nos vemos en el pr[oó]ximo (video|cap[ií]tulo)\.?|.*(dale like|deja tu comentario|activa la campanita|nos vemos en el pr[oó]ximo).*)$/i;

class Oido {
  constructor({ ajustes, noviq, log }) {
    this.aj = ajustes; this.noviq = noviq; this.log = log || (() => {});
    this.fallos = {}; this.ultimo = { motor: '', ms: 0, error: '' };
  }

  disponible(m) {
    if ((this.fallos[m] || 0) > Date.now()) return false;
    if (m === 'noviq') return !!(this.noviq && this.noviq.conectado && this.aj.datos.noviq.usar);
    if (m === 'gratis') return this.aj.datos.cerebro.gratis !== false && !!this.aj.clave('llm7');
    if (m === 'windows') return process.platform === 'win32' && this.aj.datos.oido.motor === 'windows';   // solo si lo eliges
    return !!this.aj.clave(m);
  }
  motores() {
    const elegido = this.aj.datos.oido.motor;
    const todos = ['groq', 'nvidia', 'openai', 'noviq', 'gratis', 'windows'];
    if (elegido && elegido !== 'auto') return [elegido].concat(todos.filter((m) => m !== elegido));
    return todos;
  }
  hayMotor() { return this.motores().some((m) => this.disponible(m) || (!['noviq', 'gratis', 'windows'].includes(m) && this.aj.clave(m))); }

  async whisperHTTP(m, wav, pista) {
    const conf = m === 'groq' ? { base: 'https://api.groq.com/openai/v1', modelo: 'whisper-large-v3-turbo' }
      : m === 'gratis' ? { base: 'https://api.llm7.io/v1', modelo: 'whisper-large-v3-turbo', clave: this.aj.clave('llm7') } : { base: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini-transcribe' };
    const fd = new FormData();
    fd.append('file', new Blob([wav], { type: 'audio/wav' }), 'voz.wav');
    fd.append('model', conf.modelo);
    fd.append('language', this.aj.datos.identidad.idioma || 'es');
    if (pista) fd.append('prompt', pista);
    // Groq (Whisper): verbose_json trae cuánto confía en cada trozo (avg_logprob) y si cree que no había voz (no_speech_prob):
    // así las frases inventadas sobre el ruido de la tele se reconocen. Si el servicio no lo acepta, se vuelve a «json».
    const detallado = m === 'groq' && !this.sinDetalle;
    fd.append('response_format', detallado ? 'verbose_json' : 'json');
    const r = await fetch(conf.base + '/audio/transcriptions', { method: 'POST', headers: { Authorization: 'Bearer ' + (conf.clave || this.aj.clave(m)) }, body: fd, signal: AbortSignal.timeout(30000) });
    const t = await r.text();
    if (!r.ok) {
      if (detallado && r.status === 400 && /response_format|verbose/i.test(t)) { this.sinDetalle = true; return this.whisperHTTP(m, wav, pista); }
      throw new Error(`HTTP ${r.status}: ${t.slice(0, 160)}`);
    }
    const j = JSON.parse(t);
    const texto = String(j.text || '').trim();
    if (!detallado || !Array.isArray(j.segments) || !j.segments.length) return texto;
    let peso = 0, lp = 0, ns = 0;
    for (const sg of j.segments) { const d = Math.max(0.1, (Number(sg.end) || 0) - (Number(sg.start) || 0)); peso += d; lp += (Number(sg.avg_logprob) || 0) * d; ns += (Number(sg.no_speech_prob) || 0) * d; }
    return { texto, confianza: +(lp / peso).toFixed(3), sinVoz: +(ns / peso).toFixed(3) };
  }

  /** Reconocedor de voz de Windows (System.Speech, sin internet): WAV → texto. Usa el script visible oido-windows.ps1. */
  windows(wav) {
    return new Promise((resolve, reject) => {
      const archivo = path.join(os.tmpdir(), `noviq-oido-${process.pid}-${Date.now()}.wav`);
      fs.writeFileSync(archivo, wav);
      const script = path.join(__dirname, 'oido-windows.ps1').replace('app.asar' + path.sep, 'app.asar.unpacked' + path.sep);
      const ps = spawn('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', script, '-Wav', archivo, '-Idioma', this.aj.datos.identidad.idioma || 'es'],
        { windowsHide: true });
      let out = '';
      const fin = (e, t) => { clearTimeout(timer); try { fs.unlinkSync(archivo); } catch (_) { /* noop */ } e ? reject(e) : resolve(t); };
      const timer = setTimeout(() => { try { ps.kill(); } catch (_) { /* noop */ } fin(new Error('el reconocedor de Windows no respondió')); }, 20000);
      ps.stdout.on('data', (d) => { out += d; });
      ps.on('error', (e) => fin(e));
      ps.on('close', () => {
        const m = out.match(/OK:([A-Za-z0-9+/=]*)/);
        if (m) return fin(null, Buffer.from(m[1], 'base64').toString('utf8').trim());
        fin(new Error(((out.match(/ERR:(.*)/) || [])[1] || 'sin respuesta').slice(0, 160)));
      });
    });
  }

  /** wav (Buffer) → {ok, texto, motor, ms} | {ok:false, error, sinMotor} */
  async transcribir(wav, op) {
    op = op || {};
    const pista = op.pista || this.aj.datos.identidad.nombre || 'Noviq';
    const errores = [];
    let probados = 0;
    for (const m of this.motores()) {
      if (!this.disponible(m)) continue;
      probados++;
      const t0 = Date.now();
      try {
        let texto;
        if (m === 'nvidia') texto = await riva.transcribir(wav, { clave: this.aj.clave('nvidia'), idioma: this.aj.datos.identidad.idioma || 'es' });
        let extra = {};
        if (m === 'groq' || m === 'openai' || m === 'gratis') {
          const w = await this.whisperHTTP(m, wav, pista);
          if (w && typeof w === 'object') { texto = w.texto; extra = { confianza: w.confianza, sinVoz: w.sinVoz }; } else texto = w;
        }
        else if (m === 'windows') texto = await this.windows(wav);
        else if (m === 'noviq') {
          const r = await this.noviq.stt(wav.toString('base64'), { pista });
          if (!r || !r.ok) throw new Error((r && r.error) || 'Noviq no transcribió');
          texto = String(r.texto || '').trim();
        }
        delete this.fallos[m];
        const ms = Date.now() - t0;
        this.ultimo = { motor: m, ms, error: '' };
        this.log(`[oído] ${m} ${ms} ms → «${texto}»` + (extra.confianza != null ? ` (confianza ${extra.confianza}, sin voz ${extra.sinVoz})` : ''));
        return Object.assign({ ok: true, texto: ALUCINACIONES.test(texto.trim()) ? '' : texto, bruto: texto, motor: m, ms }, extra);
      } catch (e) {
        errores.push(`${m}: ${String(e.message || e).slice(0, 120)}`);
        this.fallos[m] = Date.now() + (/sin reconocedor/.test(String(e.message)) ? 3600000 : 45000);
      }
    }
    this.ultimo = { motor: '', ms: 0, error: errores.join('; ') };
    if (!probados) return { ok: false, sinMotor: true, error: 'Para entenderte necesito un motor de voz: pon tu clave de Groq o de NVIDIA en mis Ajustes (pestaña Cerebro), conéctame con Noviq, o elige «Windows» en la pestaña Oído (sin internet, menos preciso).' };
    return { ok: false, error: 'No pude entenderte: ' + errores.join('; ') };
  }

  estado() {
    return { motores: ['groq', 'nvidia', 'openai', 'noviq', 'gratis', 'windows'].map((m) => ({ id: m, disponible: this.disponible(m) })), ultimo: this.ultimo };
  }
}

module.exports = { Oido, ALUCINACIONES };
