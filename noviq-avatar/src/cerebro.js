'use strict';
/* ==========================================================================
   Noviq Avatar — Cerebro: la IA con la que piensa el avatar
   · Cada proveedor (Groq, Cerebras, Gemini, NVIDIA, Mistral, OpenRouter,
     DeepSeek, OpenAI, tu IA propia, Ollama, LM Studio, gratis sin cuenta o
     la de Noviq) con SU lista real de modelos: eliges uno o «automático».
   · En automático elige el que conviene para conversar rápido (pequeño, que
     no «piense» de más, ya cargado si es local) y, si falla porque no existe
     o se acabó su cuota, lo anota y usa el siguiente.
   · Locales: espera lo necesario la primera vez (cargar el modelo tarda),
     los deja cargados (keep_alive) y los precalienta al abrir.
   ========================================================================== */
const path = require('path');
const { limpiarIA } = require('./util');
const { leerJSON, escribirJSON, guardadoDiferido } = require('./almacen');
const PV = require('./proveedores');

const { PROVEEDORES } = PV;
const ORDEN_AUTO = ['groq', 'cerebras', 'noviq', 'gemini', 'nvidia', 'mistral', 'openrouter', 'deepseek', 'openai', 'propia', 'ollama', 'lmstudio', 'gratis'];
const MIN = 60000;
const MALO_MS = 6 * 60 * MIN;
const CALIENTE_MS = 25 * MIN;
const NUM_CTX = 8192;   // el mismo al precalentar y al conversar (si cambia, Ollama recarga el modelo)

function errorIA(ex, extra) { const e = new Error(ex.msg); e.tipo = ex.tipo; Object.assign(e, extra || {}); return e; }

class Cerebro {
  /** @param {{ajustes:any, noviq:any, log:Function, dir?:string}} o */
  constructor({ ajustes, noviq, log, dir }) {
    this.aj = ajustes; this.noviq = noviq; this.log = log || (() => {});
    this.ruta = dir ? path.join(dir, 'cerebro.json') : null;
    const g = (this.ruta && leerJSON(this.ruta)) || {};
    this.stats = g.stats || {};          // p → {ok, fallos, ms, ultimoError, tFallo}
    this.auto = g.auto || {};            // p → modelo elegido en automático
    this.malos = g.malos || {};          // «p|modelo» → {t, motivo}
    this.avisoGratis = !!g.avisoGratis;
    this.listas = {};                    // p → {t, modelos, error}
    this.locales = {};                   // p → {vivo, t, error}
    this.calentando = {};                // p → Promise
    this.calientes = {};                 // «p|modelo» → hasta (ms)
    this.ultimo = { proveedor: '', modelo: '', ms: 0, error: '' };
    this.guardarLuego = guardadoDiferido(() => this.guardar(), 1500);
    this.pensarAparte = {};              // modelos de Ollama que no saben «no pensar»: se les deja pensar aparte
  }

  guardar() {
    if (!this.ruta) return;
    try { escribirJSON(this.ruta, { stats: this.stats, auto: this.auto, malos: this.malos, avisoGratis: this.avisoGratis }, { bak: false }); } catch (_) { /* noop */ }
  }
  cfg() { return this.aj.datos.cerebro; }
  def(p) { return PROVEEDORES[p]; }
  raiz(p) {
    const c = this.cfg();
    const u = p === 'ollama' ? c.urlOllama : p === 'lmstudio' ? c.urlLmstudio : '';
    return String(u || (this.def(p) || {}).raiz || '').replace(/\/+$/, '').replace(/\/v1$/, '');
  }
  base(p) {
    if (p === 'propia') return String(this.cfg().urlPropia || '').replace(/\/+$/, '');
    if (this.def(p).local) return this.raiz(p) + '/v1';
    return this.def(p).base;
  }
  clave(p) { const d = this.def(p); return d && d.clave ? this.aj.clave(d.clave) : ''; }

  disponible(p) {
    const d = this.def(p);
    if (!d) return false;
    if (d.noviq) return !!(this.noviq && this.noviq.conectado && this.aj.datos.noviq.usar);
    if (p === 'propia') return !!this.cfg().urlPropia;
    if (d.local) return !!(this.locales[p] && this.locales[p].vivo);
    if (d.gratis) return this.cfg().gratis !== false;
    const k = this.clave(p);
    return !!k && !PV.revisarClave(p, k).error;   // una clave de otro servicio (p. ej. de Noviq) no cuenta
  }

  /* ------------------------------------------------------------ Modelos */
  modeloElegido(p) {
    const c = this.cfg();
    const m = (c.modelos && c.modelos[p]) || '';
    if (m) return m;
    return c.proveedor === p && c.modelo ? c.modelo : '';   // ajuste viejo («modelo» único)
  }
  modeloActual(p) { return this.modeloElegido(p) || this.auto[p] || (this.def(p) || {}).modelo || ''; }
  esMalo(p, m) { const x = this.malos[p + '|' + m]; return !!(x && Date.now() - x.t < MALO_MS); }
  marcarMalo(p, m, motivo) {
    this.malos[p + '|' + m] = { t: Date.now(), motivo: String(motivo || '').slice(0, 160) };
    if (this.auto[p] === m) delete this.auto[p];
    this.guardarLuego();
  }
  olvidarLista(p) { delete this.listas[p]; if (!this.modeloElegido(p)) delete this.auto[p]; }

  /** Lista real de modelos (con caché). → {ok, modelos, error} */
  async listar(p, refrescar, ms) {
    const d = this.def(p);
    if (!d) return { ok: false, error: 'proveedor desconocido', modelos: [] };
    if (d.noviq) return { ok: true, modelos: [{ id: 'auto', nombre: 'La elige Noviq (la más rápida que tenga)' }] };
    const cache = this.listas[p];
    const vida = d.local ? 15000 : 10 * MIN;
    if (!refrescar && cache && Date.now() - cache.t < vida) return cache;
    if (d.clave && !d.claveOpcional && p !== 'propia' && !this.clave(p)) return { ok: false, error: `Falta la clave de ${d.nombre}.`, modelos: [] };
    if (p === 'propia' && !this.cfg().urlPropia) return { ok: false, error: 'Falta la URL de tu IA propia.', modelos: [] };
    let out;
    try {
      const modelos = await PV.listar(p, { base: this.base(p), raiz: this.raiz(p), clave: this.clave(p), ms: ms || (d.local ? 4000 : 10000) });
      for (const m of modelos) { if (this.esMalo(p, m.id)) m.malo = this.malos[p + '|' + m.id].motivo; if (m.cargado === undefined && this.calientes[p + '|' + m.id] > Date.now()) m.cargado = true; }
      modelos.sort((a, b) => (b.cargado ? 1 : 0) - (a.cargado ? 1 : 0) || a.id.localeCompare(b.id));
      out = { ok: true, t: Date.now(), modelos };
      if (d.local) this.locales[p] = { vivo: modelos.length > 0, t: Date.now(), error: modelos.length ? '' : 'no tiene modelos descargados' };
    } catch (e) {
      const ex = PV.explicar(p, { status: e.status, cuerpo: e.cuerpo, error: e.status ? null : e, clave: this.clave(p), url: this.base(p) });
      out = { ok: false, t: Date.now(), modelos: [], error: ex.msg, tipo: ex.tipo };
      if (d.local) this.locales[p] = { vivo: false, t: Date.now(), error: ex.msg };
    }
    this.listas[p] = out;
    return out;
  }

  recomendado(p, lista) { return PV.recomendar(p, lista || (this.listas[p] || {}).modelos || [], (id) => this.esMalo(p, id)); }

  /** El modelo que se usará ahora (elegido por ti, o el automático verificado contra la lista real). */
  async resolver(p) {
    const el = this.modeloElegido(p);
    if (el) return { modelo: el, elegido: true };
    const d = this.def(p);
    if (this.auto[p] && !this.esMalo(p, this.auto[p])) {
      if (!d.local) return { modelo: this.auto[p], elegido: false };
      const L = await this.listar(p);
      if (L.ok && L.modelos.some((m) => m.id === this.auto[p])) {
        const mejor = this.recomendado(p, L.modelos);
        const cargado = L.modelos.find((m) => m.cargado && m.id === mejor);   // si ya hay otro cargado que conviene, úsalo
        return { modelo: cargado ? cargado.id : this.auto[p], elegido: false };
      }
    }
    const L = await this.listar(p);
    if (L.ok && L.modelos.length) {
      const r = this.recomendado(p, L.modelos);
      if (r) { this.auto[p] = r; this.guardarLuego(); return { modelo: r, elegido: false }; }
    }
    if (d.modelo && !this.esMalo(p, d.modelo)) return { modelo: d.modelo, elegido: false };
    if (!L.ok) throw errorIA({ tipo: L.tipo || 'red', msg: L.error });
    throw errorIA({ tipo: 'modelo', msg: d.local ? `${d.nombre} no tiene modelos para conversar: descarga uno (por ejemplo llama3.2 o qwen2.5:7b).` : `No encontré modelos en ${d.nombre}.` });
  }

  infoModelo(p, m) { return ((this.listas[p] || {}).modelos || []).find((x) => x.id === m) || {}; }
  estaFrio(p, m) {
    if (!this.def(p).local) return false;
    const info = this.infoModelo(p, m);
    if (info.cargado !== undefined) return !info.cargado;
    return !(this.calientes[p + '|' + m] > Date.now());
  }
  marcarCargado(p, m) { this.calientes[p + '|' + m] = Date.now() + CALIENTE_MS; const info = this.infoModelo(p, m); if (info.id) info.cargado = true; }

  /* --------------------------------------------------------- Llamadas */
  async llamar(p, modelo, mensajes, op) {
    if (p === 'ollama') return this.llamarOllama(modelo, mensajes, op);
    const d = this.def(p);
    let base = this.base(p), headers = { 'Content-Type': 'application/json' }, id = modelo;
    const clave = this.clave(p);
    if (d.gratis) { const f = PV.fuenteGratis(modelo, clave); base = f.base; id = f.id; Object.assign(headers, f.headers); }
    else if (clave) headers.Authorization = 'Bearer ' + clave;
    if (p === 'openrouter') Object.assign(headers, { 'HTTP-Referer': 'https://github.com/noviq', 'X-Title': 'Noviq Avatar' });
    let msgs = mensajes;
    if (p === 'gemini' && /gemma/i.test(id) && msgs[0] && msgs[0].role === 'system') {   // Gemma en Gemini no acepta «system»
      const [s, ...resto] = msgs;
      const i = resto.findIndex((x) => x.role === 'user');
      msgs = resto.map((x, k) => (k === i ? { role: 'user', content: s.content + '\n\n' + x.content } : x));
    }
    msgs = msgs.map((m) => (m.imagenes && m.imagenes.length ? { role: m.role, content: [{ type: 'text', text: m.content }].concat(m.imagenes.map((b) => ({ type: 'image_url', image_url: { url: 'data:image/jpeg;base64,' + b } }))) } : m));
    const cuerpo = { model: id, messages: msgs, temperature: op.temperatura, max_tokens: op.maxTokens, stream: false };
    if (p === 'gemini' && /^gemini-2\.5-flash(?!-lite)/.test(id)) cuerpo.reasoning_effort = 'none';   // sin «pensar»: responde en 1 s
    if (p === 'openrouter') cuerpo.provider = { sort: 'latency' };
    if (p === 'lmstudio') cuerpo.ttl = 1800;   // LM Studio lo deja cargado 30 min
    const t0 = Date.now();
    let r, txt;
    try {
      r = await fetch(base.replace(/\/+$/, '') + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(op.limiteMs), headers, body: JSON.stringify(cuerpo) });
      txt = await r.text();
    } catch (e) { throw errorIA(PV.explicar(p, { error: e, url: base }, modelo)); }
    if (!r.ok) {
      if (cuerpo.reasoning_effort && /reasoning|thinking/i.test(txt)) { delete cuerpo.reasoning_effort; return this.llamar(p, modelo, mensajes, Object.assign({}, op, { sinRazonar: true })); }
      throw errorIA(PV.explicar(p, { status: r.status, cuerpo: txt, clave }, modelo), { status: r.status });
    }
    let j;
    try { j = JSON.parse(txt); } catch (_) { throw errorIA({ tipo: 'otro', msg: `${d.nombre} respondió algo que no entiendo.` }); }
    if (j.error) throw errorIA(PV.explicar(p, { status: 400, cuerpo: txt, clave }, modelo));
    const msg = (j.choices && j.choices[0] && j.choices[0].message) || {};
    let contenido = msg.content;
    if (Array.isArray(contenido)) contenido = contenido.map((x) => x.text || '').join('');
    const texto = limpiarIA(contenido || '');
    if (d.local) this.marcarCargado(p, modelo);
    if (!texto) {
      if (msg.reasoning_content || msg.reasoning) throw errorIA({ tipo: 'vacio', msg: `«${modelo}» se quedó pensando y no llegó a responder. Elige un modelo que no «piense» o sube el largo máximo.` });
      throw errorIA({ tipo: 'vacio', msg: `«${modelo}» devolvió una respuesta vacía.` });
    }
    return { texto, modelo, ms: Date.now() - t0 };
  }

  /** Ollama por su API propia: deja el modelo cargado 30 min y apaga el «pensar» de los modelos que piensan. */
  async llamarOllama(modelo, mensajes, op) {
    const info = this.infoModelo('ollama', modelo);
    const aparte = !!this.pensarAparte[modelo];
    const cuerpo = { model: modelo, messages: mensajes.map((m) => (m.imagenes && m.imagenes.length ? { role: m.role, content: m.content, images: m.imagenes } : m)), stream: false, keep_alive: '30m', options: { temperature: op.temperatura, num_predict: op.maxTokens, num_ctx: NUM_CTX } };
    if (info.piensa || aparte) cuerpo.think = aparte;   // false: que no piense; true: que piense APARTE (la respuesta sale limpia)
    if (aparte) cuerpo.options.num_predict = (op.maxTokens || 450) + 1500;
    const url = this.raiz('ollama') + '/api/chat';
    const t0 = Date.now();
    let r, txt;
    try {
      r = await fetch(url, { method: 'POST', signal: AbortSignal.timeout(op.limiteMs), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(cuerpo) });
      txt = await r.text();
    } catch (e) { throw errorIA(PV.explicar('ollama', { error: e, url }, modelo)); }
    if (!r.ok) {
      if (cuerpo.think !== undefined && /think/i.test(txt)) { info.piensa = false; delete this.pensarAparte[modelo]; return this.llamarOllama(modelo, mensajes, op); }
      throw errorIA(PV.explicar('ollama', { status: r.status, cuerpo: txt }, modelo), { status: r.status });
    }
    let j;
    try { j = JSON.parse(txt); } catch (_) { throw errorIA({ tipo: 'otro', msg: 'Ollama respondió algo que no entiendo.' }); }
    if (j.error) throw errorIA(PV.explicar('ollama', { status: 400, cuerpo: txt }, modelo));
    this.marcarCargado('ollama', modelo);
    const texto = limpiarIA((j.message && j.message.content) || '');
    // algunos modelos (p. ej. qwen3 «thinking») no saben no pensar y sueltan su razonamiento en la respuesta
    if (!aparte && cuerpo.think === false && /^(okay|ok|alright|so|hmm+|let me|let's|first|the user|we need|i need|wait|bueno, el usuario|el usuario)\b[\s,.]/i.test(texto) && !/^\s*[{[]/.test(texto)) {
      this.pensarAparte[modelo] = true;
      return this.llamarOllama(modelo, mensajes, op);
    }
    if (!texto) throw errorIA({ tipo: 'vacio', msg: `«${modelo}» ${j.message && j.message.thinking ? 'se quedó pensando y no respondió' : 'devolvió una respuesta vacía'}.` });
    return { texto, modelo, ms: Date.now() - t0, cargaMs: j.load_duration ? Math.round(j.load_duration / 1e6) : 0 };
  }

  /** Un proveedor: resuelve el modelo, llama y, si el automático falla por el modelo, prueba el siguiente. */
  async intento(p, mensajes, op) {
    const d = this.def(p);
    if (d.noviq) {
      const r = await this.noviq.pensar({ sistema: mensajes[0].content, mensajes: mensajes.slice(1), max_tokens: op.maxTokens, temperatura: op.temperatura }, Math.min(op.limiteMs, 30000));
      if (!r || !r.ok || !r.texto) throw errorIA({ tipo: 'otro', msg: (r && r.error) || 'Noviq no respondió' });
      return { texto: limpiarIA(r.texto), modelo: r.modelo || 'noviq' };
    }
    if (d.local && (!this.locales[p] || Date.now() - this.locales[p].t > 15000)) await this.listar(p, true);
    for (let vuelta = 0; vuelta < 3; vuelta++) {
      const { modelo, elegido } = await this.resolver(p);
      if (this.calentando[p]) { try { await Promise.race([this.calentando[p], new Promise((ok) => setTimeout(ok, op.limiteMs))]); } catch (_) { /* noop */ } }
      const frio = this.estaFrio(p, modelo);
      if (op.alEmpezar) op.alEmpezar({ proveedor: p, modelo, frio, local: !!d.local });
      try {
        return await this.llamar(p, modelo, mensajes, Object.assign({}, op, { limiteMs: d.local ? (frio ? op.limiteFrioMs : op.limiteLocalMs) : op.limiteMs }));
      } catch (e) {
        const otroModelo = ['modelo', 'cuota', 'credito', 'vacio'].includes(e.tipo) || (d.gratis && ['servidor', 'tiempo', 'otro'].includes(e.tipo));
        if (!elegido && otroModelo) { this.marcarMalo(p, modelo, e.message); continue; }
        if (elegido && ['modelo'].includes(e.tipo)) this.marcarMalo(p, modelo, e.message);
        throw e;
      }
    }
    throw errorIA({ tipo: 'modelo', msg: `Ningún modelo de ${d.nombre} respondió.` });
  }

  /* ------------------------------------------------------------ Orden */
  async sondearLocales() { await Promise.all(['lmstudio', 'ollama'].map((p) => this.listar(p, true, 1500).catch(() => {}))); }

  orden() {
    const c = this.cfg();
    if (c.proveedor === 'ninguno') return [];
    if (c.proveedor !== 'auto') {
      const resto = ORDEN_AUTO.filter((p) => p !== c.proveedor && this.disponible(p));
      return [c.proveedor].concat(resto.slice(0, 2));
    }
    const lista = ORDEN_AUTO.filter((p) => this.disponible(p));
    const nota = (p) => {
      const s = this.stats[p];
      const base = ORDEN_AUTO.indexOf(p) * 10 + (this.def(p).gratis ? 15000 : 0);   // lo gratis sin cuenta, siempre al final
      if (!s || !s.ok) return 2500 + base + (s && Date.now() - (s.tFallo || 0) < MIN ? 30000 : 0) + (s && s.tipoError === 'clave' && Date.now() - (s.tFallo || 0) < 10 * MIN ? 60000 : 0);
      const penal = (s.fallos > s.ok * 2 ? 20000 : 0) + (s.tipoError === 'clave' && Date.now() - (s.tFallo || 0) < 10 * MIN ? 60000 : 0);
      return (s.ms || 3000) + base + penal + (Date.now() - (s.tFallo || 0) < MIN ? 30000 : 0);
    };
    return lista.sort((a, b) => nota(a) - nota(b));
  }

  anotar(p, ok, ms, err) {
    const s = this.stats[p] || (this.stats[p] = { ok: 0, fallos: 0, ms: 0 });
    if (ok) { s.ok++; s.ms = s.ms ? Math.round(s.ms * 0.7 + ms * 0.3) : ms; s.ultimoError = ''; }
    else { s.fallos++; s.ultimoError = String((err && err.message) || err || '').slice(0, 220); s.tipoError = (err && err.tipo) || ''; s.tFallo = Date.now(); }
    this.guardarLuego();
  }

  /**
   * Pide una respuesta. op: {sistema, historial, usuario, temperatura, maxTokens, limiteSeg, intentos, alEmpezar(info)}
   * Devuelve {texto, proveedor, modelo, ms, gratisPrimeraVez}. Lanza Error (con .detalles) si ninguna IA responde.
   */
  async pensar(op) {
    const c = this.cfg();
    const mensajes = [{ role: 'system', content: op.sistema }].concat(op.historial || [], [{ role: 'user', content: op.usuario }]);
    const temperatura = op.temperatura != null ? op.temperatura : c.temperatura;
    const maxTokens = op.maxTokens || c.maxTokens;
    const errores = [];
    let lista = this.orden();
    if (c.proveedor !== 'ninguno' && (!lista.length || lista.every((p) => this.def(p).gratis))) { await this.sondearLocales(); lista = this.orden(); }
    const t0 = Date.now(), limite = (op.limiteSeg || 25) * 1000;
    for (const p of lista.slice(0, op.intentos || 3)) {
      const d = this.def(p);
      const resta = limite - (Date.now() - t0);
      if (!d.local && resta < 1500) continue;
      const t1 = Date.now();
      try {
        const r = await this.intento(p, mensajes, { temperatura, maxTokens, limiteMs: Math.min(Math.max(resta, 1500), 22000), limiteLocalMs: 60000, limiteFrioMs: 150000, alEmpezar: op.alEmpezar });
        const ms = Date.now() - t1;
        this.anotar(p, true, ms);
        this.ultimo = { proveedor: p, modelo: r.modelo, ms, error: '' };
        let gratisPrimeraVez = false;
        if (d.gratis && !this.avisoGratis) { this.avisoGratis = true; gratisPrimeraVez = true; this.guardarLuego(); }
        return { texto: r.texto, proveedor: p, modelo: r.modelo, ms, gratisPrimeraVez };
      } catch (e) {
        this.anotar(p, false, 0, e);
        errores.push({ proveedor: p, tipo: e.tipo || 'otro', msg: String(e.message || e) });
      }
    }
    const msg = errores.length ? errores.map((x) => x.msg).join(' · ') : 'No tengo ninguna IA configurada: pon una clave gratis en Ajustes → Cerebro, abre Ollama o LM Studio, o conéctame con Noviq.';
    this.ultimo = Object.assign({}, this.ultimo, { error: msg.slice(0, 300) });
    const e = new Error(msg);
    e.detalles = errores; e.sinIA = !errores.length;
    throw e;
  }

  /* ------------------------------------------------------------- Visión */
  /** Modelo con visión de un proveedor (o '' si no hay): primero el que elijas en Ajustes → Visión. */
  async modeloVision(p) {
    const v = this.aj.datos.vision || {};
    if (v.modelo && (v.proveedor === p)) return v.modelo;
    const d = this.def(p);
    if (!d || d.noviq || d.gratis) return '';
    if (d.local) {
      const L = await this.listar(p);
      const vs = (L.modelos || []).filter((m) => m.vision && !this.esMalo(p, m.id));
      if (!vs.length) return '';
      const peso = (m) => (m.cargado ? -20 : 0) + (m.params || 8) + (m.piensa ? 6 : 0);
      return vs.sort((a, b) => peso(a) - peso(b))[0].id;
    }
    const act = this.modeloActual(p);
    switch (p) {
      case 'gemini': return /^gemini/i.test(act) ? act : 'gemini-flash-latest';
      case 'openai': return /gpt-4o|gpt-4\.1|gpt-5|o4/i.test(act) ? act : 'gpt-4o-mini';
      case 'groq': return 'meta-llama/llama-4-scout-17b-16e-instruct';
      case 'mistral': return /pixtral|small|medium|large/i.test(act) ? act : 'mistral-small-latest';
      default: return '';
    }
  }
  /** Proveedores que pueden mirar una imagen, los locales primero (la foto no sale de tu PC). */
  async ordenVision() {
    const v = this.aj.datos.vision || {};
    const todos = ['ollama', 'lmstudio', 'gemini', 'openai', 'groq', 'mistral'];
    const out = [];
    const lista = v.proveedor && v.proveedor !== 'auto' ? [v.proveedor].concat(todos.filter((x) => x !== v.proveedor)) : todos;
    if (!lista.some((p) => this.def(p) && this.def(p).local && this.locales[p] && this.locales[p].vivo)) await this.sondearLocales();
    for (const p of lista) {
      if (!this.def(p) || !this.disponible(p)) continue;
      if (v.soloLocal && !this.def(p).local) continue;
      let m = ''; try { m = await this.modeloVision(p); } catch (_) { m = ''; }
      if (m) out.push({ p, modelo: m });
    }
    return out;
  }
  /** Mira una imagen (JPEG base64) y responde. → {texto, proveedor, modelo, ms, local}. Lanza con .sinVision si no hay IA con visión. */
  async ver(op) {
    const cand = await this.ordenVision();
    if (!cand.length) {
      const e = new Error('No tengo ninguna IA con visión: instala un modelo con visión en Ollama (por ejemplo qwen3-vl:4b o gemma3:4b), o pon una clave de Gemini en Ajustes → Cerebro.');
      e.sinVision = true; throw e;
    }
    const mensajes = [{ role: 'system', content: op.sistema || 'Eres los ojos de un asistente de escritorio. Describe con precisión y brevedad lo que ves y responde la pregunta. Si no estás seguro, dilo. Responde en español.' },
      { role: 'user', content: String(op.pregunta || 'Describe lo que ves.'), imagenes: [op.imagen] }];
    const errores = [];
    for (const { p, modelo } of cand.slice(0, 3)) {
      const d = this.def(p), t0 = Date.now();
      try {
        const frio = d.local && this.estaFrio(p, modelo);
        const r = await this.llamar(p, modelo, mensajes, { temperatura: 0.3, maxTokens: op.maxTokens || 400, limiteMs: d.local ? (frio ? 180000 : 90000) : 40000 });
        this.ultimo = { proveedor: p, modelo: r.modelo, ms: Date.now() - t0, error: '' };
        return { texto: r.texto, proveedor: p, modelo: r.modelo, ms: Date.now() - t0, local: !!d.local };
      } catch (e) {
        errores.push(`${d.nombre}: ${e.message}`);
        if (e.tipo === 'modelo') this.marcarMalo(p, modelo, e.message);
      }
    }
    const e = new Error('Ninguna IA con visión pudo mirar la imagen. ' + errores.join(' · ').slice(0, 300));
    e.detalles = errores; throw e;
  }

  /** Prueba desde Ajustes (con el modelo que digas o el automático, que si falla prueba el siguiente). */
  async probar(p, modelo) {
    const d = this.def(p);
    if (!d) return { ok: false, error: 'Proveedor desconocido' };
    if (d.clave && !d.claveOpcional && p !== 'propia' && !this.clave(p)) return { ok: false, error: `Falta la clave de ${d.nombre}: pégala y pulsa Guardar.`, tipo: 'clave' };
    if (p === 'propia' && !this.cfg().urlPropia) return { ok: false, error: 'Falta la URL de tu IA propia.', tipo: 'red' };
    const t0 = Date.now();
    try {
      const mensajes = [{ role: 'system', content: 'Responde en español con una frase muy corta.' }, { role: 'user', content: 'Saluda en 3 palabras.' }];
      let r, frio = false;
      if (d.local) await this.listar(p, true);
      if (d.noviq) r = await this.intento(p, mensajes, { temperatura: 0.2, maxTokens: 30, limiteMs: 25000 });
      else if (modelo) {
        frio = this.estaFrio(p, modelo);
        r = await this.llamar(p, modelo, mensajes, { temperatura: 0.2, maxTokens: 120, limiteMs: d.local ? 180000 : 30000 });
      } else {
        let info = null;
        r = await this.intento(p, mensajes, { temperatura: 0.2, maxTokens: 120, limiteMs: 30000, limiteLocalMs: 120000, limiteFrioMs: 180000, alEmpezar: (x) => { info = x; } });
        frio = !!(info && info.frio);
      }
      const ms = Date.now() - t0;
      this.anotar(p, true, ms);
      if (d.local) this.listar(p, true).catch(() => {});
      return { ok: true, ms, modelo: r.modelo, texto: String(r.texto || '').slice(0, 80), frio, cargaMs: r.cargaMs || 0 };
    } catch (e) {
      this.anotar(p, false, 0, e);
      return { ok: false, error: String(e.message || e).slice(0, 400), tipo: e.tipo || 'otro' };
    }
  }

  /** Comprueba una clave con el servicio (sin gastar casi nada). → {ok:true, modelos} | {ok:false, error} | {ok:null, error} si no se pudo comprobar */
  async validarClave(p, clave) {
    const d = this.def(p);
    if (!d || !d.clave) return { ok: null };
    try {
      if (p === 'nvidia') {   // su lista de modelos es pública: se prueba con una respuesta de 1 palabra
        const r = await fetch(d.base + '/chat/completions', { method: 'POST', signal: AbortSignal.timeout(15000), headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + clave },
          body: JSON.stringify({ model: d.modelo, messages: [{ role: 'user', content: 'hola' }], max_tokens: 1 }) });
        const txt = await r.text();
        if (r.ok || r.status === 429) return { ok: true };
        const ex = PV.explicar(p, { status: r.status, cuerpo: txt, clave });
        return ex.tipo === 'clave' ? { ok: false, error: ex.msg } : { ok: null, error: ex.msg };
      }
      if (p === 'openrouter') {
        const r = await fetch(d.base + '/key', { signal: AbortSignal.timeout(10000), headers: { Authorization: 'Bearer ' + clave } });
        const txt = await r.text();
        if (r.ok) return { ok: true };
        const ex = PV.explicar(p, { status: r.status, cuerpo: txt, clave });
        return ex.tipo === 'clave' ? { ok: false, error: ex.msg } : { ok: null, error: ex.msg };
      }
      if (p === 'propia' && !this.cfg().urlPropia) return { ok: null };
      const modelos = await PV.listar(p, { base: p === 'propia' ? this.base(p) : d.base, clave, ms: 10000 });
      return { ok: true, modelos: modelos.length };
    } catch (e) {
      const ex = PV.explicar(p, { status: e.status, cuerpo: e.cuerpo, error: e.status ? null : e, clave });
      return ex.tipo === 'clave' ? { ok: false, error: ex.msg } : { ok: null, error: ex.msg };
    }
  }

  /** Carga el modelo local en memoria para que la primera respuesta no tarde. */
  precalentar(p, modelo) {
    const d = this.def(p);
    if (!d || !d.local) return Promise.resolve({ ok: false });
    if (this.calentando[p]) return this.calentando[p];
    const tarea = (async () => {
      try {
        const L = await this.listar(p, true);
        if (!L.ok) return { ok: false, error: L.error };
        const m = modelo || (await this.resolver(p)).modelo;
        if (!this.estaFrio(p, m)) return { ok: true, modelo: m, yaEstaba: true };
        const t0 = Date.now();
        if (p === 'ollama') {
          const r = await fetch(this.raiz(p) + '/api/generate', { method: 'POST', signal: AbortSignal.timeout(180000), headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ model: m, keep_alive: '30m', options: { num_ctx: NUM_CTX } }) });
          await r.text();
          if (!r.ok) return { ok: false, error: 'Ollama no pudo cargar ' + m };
        } else await this.llamar(p, m, [{ role: 'user', content: 'hola' }], { temperatura: 0, maxTokens: 1, limiteMs: 180000 }).catch((e) => { if (e.tipo !== 'vacio') throw e; });
        this.marcarCargado(p, m);
        this.log(`[cerebro] ${p}: ${m} cargado en ${Math.round((Date.now() - t0) / 100) / 10} s`);
        return { ok: true, modelo: m, ms: Date.now() - t0 };
      } catch (e) { return { ok: false, error: e.message }; } finally { delete this.calentando[p]; }
    })();
    this.calentando[p] = tarea;
    return tarea;
  }

  /** Si el que va a usar primero es local, lo deja cargado (al abrir o al cambiar los ajustes). */
  async precalentarSiToca() {
    await this.sondearLocales();
    const c = this.cfg();
    const primero = c.proveedor !== 'auto' ? c.proveedor : this.orden()[0];
    if (primero && this.def(primero) && this.def(primero).local && this.disponible(primero)) return this.precalentar(primero);
    return null;
  }

  /** Avisos de ajustes: limpia cachés y precalienta si cambió algo del cerebro. */
  alCambiar(cambios) {
    let tocar = false;
    for (const k of cambios || []) {
      const m = k.match(/^claves\.(\w+)/);
      if (m) this.olvidarLista(PV.proveedorDeClave(m[1]) || m[1]);
      if (/^cerebro\.(urlOllama|urlLmstudio)/.test(k)) { delete this.listas.ollama; delete this.listas.lmstudio; tocar = true; }
      if (/^cerebro\.urlPropia/.test(k)) this.olvidarLista('propia');
      if (/^cerebro\.(proveedor|modelos\.(ollama|lmstudio))/.test(k)) tocar = true;
    }
    if (tocar) setTimeout(() => this.precalentarSiToca().catch(() => {}), 300);
  }

  estado() {
    const lista = {};
    const orden = this.orden();
    for (const [p, d] of Object.entries(PROVEEDORES)) {
      const L = this.listas[p];
      lista[p] = {
        nombre: d.nombre, desc: d.desc, disponible: this.disponible(p), web: d.web || null, local: !!d.local, gratis: !!d.gratis, noviq: !!d.noviq,
        clave: d.clave || null, modelo: d.noviq ? 'automático' : this.modeloActual(p), elegido: this.modeloElegido(p), auto: this.auto[p] || '',
        stats: this.stats[p] || null, error: L && !L.ok ? L.error : '', modelos: L && L.ok ? L.modelos.length : null,
        vivo: d.local ? !!(this.locales[p] && this.locales[p].vivo) : undefined, cargando: !!this.calentando[p], posicion: orden.indexOf(p)
      };
    }
    return { orden, proveedores: lista, ultimo: this.ultimo };
  }
}

module.exports = { Cerebro, PROVEEDORES, ORDEN_AUTO };
