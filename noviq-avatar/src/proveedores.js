'use strict';
/* ==========================================================================
   Noviq Avatar — Proveedores de IA: qué hay, cómo se llaman sus claves,
   la LISTA REAL de modelos de cada uno (para elegir), cuál conviene para
   conversar rápido y errores explicados en español.
   ========================================================================== */
const { norm } = require('./util');

const PROVEEDORES = {
  ollama: { nombre: 'Ollama', desc: 'en tu PC, sin internet ni clave', raiz: 'http://127.0.0.1:11434', local: true, web: 'https://ollama.com/download' },
  lmstudio: { nombre: 'LM Studio', desc: 'en tu PC, sin internet ni clave', raiz: 'http://127.0.0.1:1234', local: true, web: 'https://lmstudio.ai' },
  groq: { nombre: 'Groq', desc: 'muy rápida · gratis con cuenta', base: 'https://api.groq.com/openai/v1', modelo: 'llama-3.1-8b-instant', clave: 'groq', prefijo: 'gsk_', web: 'https://console.groq.com/keys' },
  gemini: { nombre: 'Google Gemini', desc: 'gratis con tu cuenta de Google', base: 'https://generativelanguage.googleapis.com/v1beta/openai', nativa: 'https://generativelanguage.googleapis.com/v1beta', modelo: 'gemini-flash-lite-latest', clave: 'gemini', prefijo: 'AIza', web: 'https://aistudio.google.com/apikey' },
  cerebras: { nombre: 'Cerebras', desc: 'rapidísima · gratis con cuenta', base: 'https://api.cerebras.ai/v1', modelo: 'llama3.1-8b', clave: 'cerebras', prefijo: 'csk-', web: 'https://cloud.cerebras.ai' },
  nvidia: { nombre: 'NVIDIA', desc: 'gratis con cuenta', base: 'https://integrate.api.nvidia.com/v1', modelo: 'meta/llama-3.1-8b-instruct', clave: 'nvidia', prefijo: 'nvapi-', web: 'https://build.nvidia.com' },
  mistral: { nombre: 'Mistral', desc: 'gratis con cuenta (plan Experiment)', base: 'https://api.mistral.ai/v1', modelo: 'mistral-small-latest', clave: 'mistral', web: 'https://console.mistral.ai/api-keys' },
  openrouter: { nombre: 'OpenRouter', desc: 'cientos de modelos, varios gratis', base: 'https://openrouter.ai/api/v1', modelo: '', clave: 'openrouter', prefijo: 'sk-or-', web: 'https://openrouter.ai/keys' },
  deepseek: { nombre: 'DeepSeek', desc: 'de pago, muy barata', base: 'https://api.deepseek.com/v1', modelo: 'deepseek-chat', clave: 'deepseek', prefijo: 'sk-', web: 'https://platform.deepseek.com/api_keys' },
  openai: { nombre: 'OpenAI', desc: 'de pago', base: 'https://api.openai.com/v1', modelo: 'gpt-4o-mini', clave: 'openai', prefijo: 'sk-', web: 'https://platform.openai.com/api-keys' },
  propia: { nombre: 'Otra compatible con OpenAI', desc: 'tu servidor o servicio (URL abajo)', base: '', modelo: '', clave: 'propia' },
  gratis: { nombre: 'Gratis sin cuenta', desc: 'LLM7 y Kilo: sin clave, con límites', gratis: true, clave: 'llm7', claveOpcional: true, web: 'https://token.llm7.io' },
  noviq: { nombre: 'La IA de Noviq', desc: 'la más rápida que tenga Noviq', noviq: true }
};
const CON_CLAVE = Object.keys(PROVEEDORES).filter((p) => PROVEEDORES[p].clave);
/** «llm7» → «gratis»; «groq» → «groq» (el nombre de la clave o el del proveedor) */
const proveedorDeClave = (n) => (PROVEEDORES[n] && PROVEEDORES[n].clave ? n : Object.keys(PROVEEDORES).find((p) => PROVEEDORES[p].clave === n) || null);
const GRATIS = {
  llm7: { nombre: 'LLM7', base: 'https://api.llm7.io/v1', auth: 'Bearer unused' },
  kilo: { nombre: 'Kilo', base: 'https://api.kilo.ai/api/gateway', auth: '' }
};

/* ------------------------------------------------------------- Claves */
const INVISIBLES = /[​-‏⁠﻿ ]/g;
const RUIDO = /^(bearer|authorization|auth|token|api[-_ ]?key|apikey|key|clave|llave|export|set|header|[-–—•*#:=|,;]+)$/i;
/** Saca la clave de lo que pegó el usuario («Bearer gsk_…», «GEMINI_API_KEY=AIza…», entre comillas…). */
function limpiarClave(texto) {
  const t = String(texto == null ? '' : texto).replace(INVISIBLES, ' ');
  const out = [];
  for (let linea of t.split(/[\r\n,;]+/)) {
    linea = linea.trim().replace(/^["'`]+|["'`]+$/g, '').trim();
    if (!linea) continue;
    const asig = linea.match(/^["']?([A-Za-z_][\w-]*)["']?\s*[:=]\s*(.+)$/);
    if (asig && /(key|token|auth|api|clave|bearer|secret)/i.test(asig[1]) && asig[2].trim().length >= 6) linea = asig[2].trim();
    for (let tok of linea.split(/\s+/)) {
      tok = tok.replace(/^["'`{[(<]+|["'`}\])>:,;]+$/g, '');
      if (!tok || RUIDO.test(tok) || tok.length < 6 || /[…•]/.test(tok)) continue;
      out.push(tok);
    }
  }
  return [...new Set(out)];
}
const PREFIJOS = [['sk-or-', 'openrouter'], ['sk-ant-', 'anthropic'], ['gsk_', 'groq'], ['nvapi-', 'nvidia'], ['AIza', 'gemini'], ['csk-', 'cerebras'],
  ['nvq', 'noviq'], ['av-', 'avatar'], ['hf_', 'huggingface'], ['xai-', 'xai'], ['sk-proj-', 'openai'], ['sk-', 'sk']];
const OTROS = { anthropic: 'Anthropic (Claude)', huggingface: 'Hugging Face', xai: 'xAI (Grok)' };
function deQuien(k) { const x = PREFIJOS.find(([pre]) => String(k).startsWith(pre)); return x ? x[1] : null; }

/** Revisa la forma de una clave SIN conectarse. → {error} | {mover: otroProveedor} | {aviso} | {} */
function revisarClave(p, k) {
  const d = PROVEEDORES[p] || { nombre: p };
  k = String(k || '');
  if (!k) return { error: 'La clave está vacía.' };
  const q = deQuien(k);
  if (q === 'noviq') return { error: `Esa es una clave de Noviq (empieza por «${k.slice(0, 4)}»), no de ${d.nombre}. No hace falta ponerla aquí: con Noviq abierto el avatar ya usa su IA. ` + (d.web ? `La clave de ${d.nombre} se saca en ${d.web}` : '') };
  if (q === 'avatar') return { error: 'Esa es la clave de la API del propio avatar (para otras apps), no la de una IA.' };
  if (OTROS[q]) return { error: `Esa clave es de ${OTROS[q]}; el avatar todavía no usa ese servicio.` };
  if (q && q !== 'sk' && q !== p && PROVEEDORES[q] && p !== 'propia' && p !== 'gratis') return { mover: q, aviso: `Esa clave es de ${PROVEEDORES[q].nombre}: la guardo ahí.` };
  if (q === 'sk' && !['openai', 'deepseek', 'propia', 'gratis'].includes(p)) return { mover: 'openai', aviso: 'Esa clave parece de OpenAI (empieza por «sk-»): la guardo en OpenAI.' };
  if (k.length < (p === 'propia' || p === 'gratis' ? 4 : 16)) return { error: `Es muy corta para ser una clave de ${d.nombre} (tiene ${k.length} caracteres).` };
  if (/\s/.test(k)) return { error: 'La clave tiene espacios en medio: cópiala otra vez completa.' };
  if (d.prefijo && !k.startsWith(d.prefijo) && p !== 'propia') return { aviso: `No empieza por «${d.prefijo}» como las claves de ${d.nombre}; revísala si falla.` };
  return {};
}

/* ------------------------------------------------- Modelos: filtrar y ordenar */
const NO_CHAT = /(embed|whisper|\btts\b|-tts|transcri|speech|audio|realtime|dall-?e|gpt-image|image-gen|-image\b|image-preview|imagen|\bveo\b|sora|lyria|guard|rerank|reward|moderation|safety|\bclip\b|bge-|\be5-|nv-embed|parakeet|canary|riva|fastpitch|flux|stable-diffusion|sdxl|cosmos|kling|seedance|voxtral|chroma-|deplot|paligemma|kosmos|fuyu|\bvila\b|neva|retriever|nvclip|\baqa\b|antigravity|deep-research|computer-use|native-audio|-live\b|live-|robotics|learnlm|tokenizer|\bocr\b|grounding|nano-banana|music|-search|search-|playai|orpheus|distil-whisper|prompt-guard|tts-)/i;
const PIENSA = /(\br1\b|-r1|r1-|qwq|think|reason|magistral|o1-|o3-|o4-|\bo1\b|\bo3\b|gpt-oss|deepseek-v4-pro|glm-5\.\d(?!-flash)|kimi-k)/i;
const params = (s) => { const m = String(s || '').match(/(\d+(?:\.\d+)?)\s*[bB]\b/); return m ? Number(m[1]) : null; };
const version = (id) => { const m = String(id).match(/(\d+(?:\.\d+)?)/); return m ? Number(m[1]) : 0; };

/** Puntaje para modelos locales (menos = mejor para conversar en voz). */
function puntajeLocal(m) {
  let s = 0;
  if (m.cargado) s -= 8;      // ya cargado: responde al instante…
  if (m.piensa) s += 12;     // …pero uno que «piensa» es lento SIEMPRE: pesa más
  if (/coder|code\b|-code|codestral|starcoder/i.test(m.id)) s += 4;
  if (m.vision && /vl\b|-vl|vision|llava/i.test(m.id)) s += 2;
  if (m.tam && m.tam > 9) s += 8 + (m.tam - 9);
  const b = m.params || params(m.id);
  if (b && b < 1.5) s += 5;
  s += Math.abs(Math.log2((b || 7) / 5)) * 2;
  return s;
}

const PREFIERE = {
  groq: [/^llama-3\.1-8b-instant$/, /llama.*8b/, /^llama-3\.3-70b/, /gemma/, /^llama/, /qwen/, /gpt-oss-20b/],
  cerebras: [/^llama3\.1-8b$/, /llama.*8b/, /^llama/, /qwen/, /gpt-oss/],
  nvidia: [/^meta\/llama-3\.1-8b-instruct$/, /llama-3\.\d-8b-instruct/, /nemotron.*nano/, /mistral.*small/, /llama.*instruct/],
  gemini: [/^gemini-flash-lite-latest$/, /^gemini-[\d.]+-flash-lite$/, /^gemini-flash-latest$/, /^gemini-[\d.]+-flash$/, /flash-lite/, /flash/],
  mistral: [/^mistral-small-latest$/, /^ministral-8b/, /mistral-small/, /open-mistral-nemo/, /^mistral-medium/],
  openai: [/^gpt-4o-mini$/, /^gpt-4\.1-mini$/, /^gpt-5(\.\d)?-mini$/, /-mini$/, /^gpt-4o$/],
  deepseek: [/^deepseek-chat$/],
  openrouter: [/llama-3\.[13]-8b.*:free$/, /gemma.*:free$/, /mistral.*:free$/, /qwen.*:free$/, /:free$/],
  gratis: [/^llm7:deepseek-v4-flash-0731$/i, /^llm7:glm-5\.3-flash$/i, /^llm7:.*flash/i, /^llm7:(?!.*(claude|anthropic|opus|sonnet|fable|haiku|gpt-[5-9]|grok)).*(mini|small|nemo|lite|turbo)/i, /^kilo:.*(flash|mini|nano|lightning|small|lite).*:free$/i, /^kilo:.*:free$/i]
};
const esPreview = (id) => /(preview|exp\b|experimental|-\d{2}-\d{2}$|beta)/i.test(id);

/** El modelo que conviene para conversar rápido (o null). esMalo(id) → true si falló hace poco. */
function recomendar(p, lista, esMalo) {
  const vale = (lista || []).filter((m) => !m.noChat && !(esMalo && esMalo(m.id)));
  if (!vale.length) return null;
  const def = PROVEEDORES[p] || {};
  if (def.local) return vale.slice().sort((a, b) => puntajeLocal(a) - puntajeLocal(b))[0].id;
  for (const rx of PREFIERE[p] || []) {
    const c = vale.filter((m) => rx.test(m.id));
    if (!c.length) continue;
    const estables = c.filter((m) => !esPreview(m.id));
    return (estables.length ? estables : c).sort((a, b) => version(b.id) - version(a.id) || a.id.length - b.id.length)[0].id;
  }
  if (def.modelo && vale.some((m) => m.id === def.modelo)) return def.modelo;
  const rapidos = vale.filter((m) => /(8b|7b|mini|flash|instant|lite|small|nano|haiku|turbo)/i.test(m.id) && !m.piensa);
  return (rapidos[0] || vale.find((m) => !m.piensa) || vale[0]).id;
}

/* ------------------------------------------------------- Listar modelos */
async function pedirJSON(url, op) {
  op = op || {};
  const r = await fetch(url, { method: op.method || 'GET', headers: op.headers || {}, body: op.body, signal: AbortSignal.timeout(op.ms || 9000) });
  const txt = await r.text();
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; e.cuerpo = txt; throw e; }
  try { return JSON.parse(txt); } catch (_) { const e = new Error('respuesta no es JSON'); e.cuerpo = txt.slice(0, 200); throw e; }
}
const autorizacion = (clave) => (clave ? { Authorization: 'Bearer ' + clave } : {});

function deOpenAI(j) {
  const arr = Array.isArray(j) ? j : j.data || j.models || [];
  return arr.map((m) => (typeof m === 'string' ? { id: m } : m)).filter((m) => m && (m.id || m.name)).map((m) => {
    const id = String(m.id || m.name);
    const precio = m.pricing ? Number(m.pricing.prompt || m.pricing.input || 0) + Number(m.pricing.completion || m.pricing.output || 0) : null;
    return {
      id, nombre: m.name && m.name !== id ? String(m.name).slice(0, 80) : undefined,
      ctx: m.context_length || m.context_window || (m.top_provider && m.top_provider.context_length) || undefined,
      gratis: /:free$/.test(id) || precio === 0 || undefined,
      piensa: PIENSA.test(id) || undefined,
      vision: /(vision|-vl\b|vl-|llava|pixtral)/i.test(id) || undefined,
      noChat: NO_CHAT.test(id) || (m.model_type && m.model_type !== 'chat') || (m.type && /embed|image|audio|speech|rerank/i.test(m.type)) || undefined,
      inactivo: m.active === false || undefined
    };
  }).filter((m) => !m.noChat && !m.inactivo);
}

/** Lista REAL de modelos de un proveedor. ctx: {base, raiz, clave, ms} → [{id, nombre, cargado, gratis, piensa, vision, tam, params, ctx}] */
async function listar(p, ctx) {
  ctx = ctx || {};
  const ms = ctx.ms || 9000;
  if (p === 'ollama') {
    const raiz = ctx.raiz;
    const [tags, ps] = await Promise.all([pedirJSON(raiz + '/api/tags', { ms }), pedirJSON(raiz + '/api/ps', { ms }).catch(() => ({ models: [] }))]);
    const cargados = new Set((ps.models || []).map((m) => m.name || m.model));
    return (tags.models || []).filter((m) => {
      const caps = m.capabilities;
      if (Array.isArray(caps)) return caps.includes('completion');
      return !/embed/i.test(m.name) && !/bert/i.test((m.details && m.details.family) || '');
    }).map((m) => {
      const caps = m.capabilities || [];
      const det = m.details || {};
      return { id: m.name || m.model, cargado: cargados.has(m.name) || cargados.has(m.model), tam: m.size ? Math.round(m.size / 1e8) / 10 : undefined,
        params: params(det.parameter_size) || params(m.name) || undefined, piensa: caps.includes('thinking') || undefined, vision: caps.includes('vision') || undefined,
        familia: det.family || undefined };
    });
  }
  if (p === 'lmstudio') {
    const raiz = ctx.raiz;
    let j = null;
    for (const ruta of ['/api/v0/models', '/api/v1/models']) {
      try { j = await pedirJSON(raiz + ruta, { ms }); if (j && (j.data || j.models)) break; } catch (e) { if (!e.status) throw e; }
    }
    if (j && (j.data || j.models)) {
      return (j.data || j.models).map((m) => {
        const id = String(m.id || m.key || m.model_key || m.path || '');
        const tipo = String(m.type || '');
        const cargado = m.state === 'loaded' || (Array.isArray(m.loaded_instances) && m.loaded_instances.length > 0);
        return { id, nombre: m.display_name || undefined, tipo, cargado: !!cargado, tam: m.size_bytes ? Math.round(m.size_bytes / 1e8) / 10 : undefined,
          params: params(m.params_string) || params(id) || undefined, piensa: PIENSA.test(id) || /qwen3(?!.*instruct)/i.test(id) || undefined,
          vision: tipo === 'vlm' || m.vision === true || undefined, ctx: m.max_context_length || undefined };
      }).filter((m) => m.id && !/embed/i.test(m.tipo) && !NO_CHAT.test(m.id));
    }
    const o = await pedirJSON(raiz + '/v1/models', { ms });
    return deOpenAI(o).map((m) => Object.assign(m, { params: params(m.id) || undefined, piensa: m.piensa || /qwen3(?!.*instruct)/i.test(m.id) || undefined }));
  }
  if (p === 'gemini') {
    const j = await pedirJSON(PROVEEDORES.gemini.nativa + '/models?pageSize=1000', { ms, headers: { 'x-goog-api-key': ctx.clave } });
    return (j.models || []).filter((m) => (m.supportedGenerationMethods || []).includes('generateContent'))
      .map((m) => ({ id: String(m.name).replace(/^models\//, ''), nombre: m.displayName, ctx: m.inputTokenLimit, piensa: m.thinking === true && !/lite/i.test(m.name) || undefined }))
      .filter((m) => !NO_CHAT.test(m.id) && !/(-tts|image|embedding)/i.test(m.id));
  }
  if (p === 'gratis') {
    const out = [];
    const errores = [];
    for (const [k, g] of Object.entries(GRATIS)) {
      try {
        const auth = k === 'llm7' && ctx.clave ? 'Bearer ' + ctx.clave : g.auth;
        const j = await pedirJSON(g.base + '/models', { ms, headers: auth ? { Authorization: auth } : {} });
        for (const m of deOpenAI(j)) {
          if (k === 'kilo' && !m.gratis) continue;   // en Kilo sin cuenta solo sirven los «:free»
          if (k === 'llm7' && /(claude|anthropic|opus|sonnet|fable|haiku|gpt-[5-9]|grok|gpt-image|kling|seedance|dark-beast|jev-)/i.test(m.id)) continue;
          out.push(Object.assign(m, { id: k + ':' + m.id, nombre: `${g.nombre} · ${m.nombre || m.id}`, gratis: true }));
        }
      } catch (e) { errores.push(g.nombre + ': ' + e.message); }
    }
    if (!out.length && errores.length) throw new Error(errores.join(' · '));
    return out;
  }
  const j = await pedirJSON(ctx.base.replace(/\/+$/, '') + '/models', { ms, headers: autorizacion(ctx.clave) });
  return deOpenAI(j);
}

/** «llm7:GLM-5.3-Flash» → {base, headers, id} */
function fuenteGratis(modelo, claveLlm7) {
  const i = String(modelo).indexOf(':');
  const k = String(modelo).slice(0, i), g = GRATIS[k];
  if (!g) throw new Error('modelo gratis desconocido: ' + modelo);
  const auth = k === 'llm7' && claveLlm7 ? 'Bearer ' + claveLlm7 : g.auth;
  return { base: g.base, headers: auth ? { Authorization: auth } : {}, id: String(modelo).slice(i + 1), nombre: g.nombre };
}

/* ----------------------------------------------------- Errores explicados */
function mensajeDe(cuerpo) {
  try {
    let j = JSON.parse(cuerpo);
    if (Array.isArray(j)) j = j[0];
    const e = j.error || j;
    return String((e && (e.message || e.msg || e.detail || e.error)) || j.detail || j.message || cuerpo).slice(0, 220);
  } catch (_) { return String(cuerpo || '').replace(/\s+/g, ' ').slice(0, 220); }
}
/**
 * → {tipo: red|tiempo|clave|credito|cuota|modelo|servidor|otro, msg}
 * x: {status, cuerpo, error, clave, url}
 */
function explicar(p, x, modelo) {
  const d = PROVEEDORES[p] || { nombre: p };
  const N = d.nombre;
  const m = modelo ? `«${modelo}»` : 'ese modelo';
  const e = x.error;
  if (e && (e.name === 'TimeoutError' || e.name === 'AbortError')) {
    return { tipo: 'tiempo', msg: d.local ? `${m} tardó demasiado en ${N}. La primera vez se carga en la memoria y tarda; si pasa siempre, elige un modelo más pequeño (3 a 8B).`
      : `${N} tardó demasiado en responder.` };
  }
  if (e && !x.status) {
    const cod = (e.cause && e.cause.code) || e.code || '';
    if (p === 'lmstudio') return { tipo: 'red', msg: 'LM Studio no está abierto o su servidor está apagado. Ábrelo y en la pestaña «Developer» pulsa «Start Server» (puerto 1234).' };
    if (p === 'ollama') return { tipo: 'red', msg: 'Ollama no está abierto. Ábrelo (el icono de la llama) y vuelve a probar.' };
    if (p === 'propia') return { tipo: 'red', msg: `No pude conectar con tu IA propia${x.url ? ' en ' + x.url : ''} (${cod || e.message}).` };
    return { tipo: 'red', msg: `No pude conectar con ${N} (${cod || 'sin internet'}).` };
  }
  const st = x.status || 0;
  const txt = mensajeDe(x.cuerpo || (e && e.message) || '');
  if (st === 401 || st === 403 || /api key not valid|invalid.?api.?key|pass a valid api key|unauthori[sz]ed|incorrect api key|authentication|invalid_api_key|no auth|missing.*(key|token)|invalid token|forbidden|authorization header|key is invalid|expired|revoked/i.test(txt)) {
    let pista = '';
    if (x.clave) { const r = revisarClave(p, x.clave); pista = r.error ? ' ' + r.error : r.aviso ? ' ' + r.aviso : ''; }
    return { tipo: 'clave', msg: `${N} rechazó la clave: no es válida.${pista || (d.web ? ` Saca una nueva en ${d.web}` : '')}` };
  }
  if (st === 402 || /insufficient|credit|billing|payment required|balance/i.test(txt)) return { tipo: 'credito', msg: `${N}: tu cuenta no tiene crédito para ${m}. Elige un modelo gratis.` };
  if (st === 429 || /quota|rate.?limit|resource_exhausted|too many requests|exceeded/i.test(txt)) return { tipo: 'cuota', msg: `${N}: se acabó la cuota gratis de ${m} por ahora. Prueba otro modelo o espera un rato.` };
  if (st === 404 || /model.{0,40}(not found|does not exist|not exist|unknown|invalid|no such|not available|unavailable|decommission|deprecated)|is not found|not supported for generatecontent|only supports|does not support (chat|this)|not a chat model|unsupported model|no endpoints found|developer instruction is not enabled/i.test(txt)) {
    return { tipo: 'modelo', msg: `${m} no sirve para conversar en ${N} (${txt.slice(0, 90)}). Elige otro modelo de la lista.` };
  }
  if (st >= 500) return { tipo: 'servidor', msg: `${N} tiene problemas ahora (error ${st}). Prueba en un rato u otro proveedor.` };
  return { tipo: 'otro', msg: `${N}: ${txt || 'error ' + st}` };
}

module.exports = { PROVEEDORES, CON_CLAVE, proveedorDeClave, GRATIS, limpiarClave, deQuien, revisarClave, recomendar, puntajeLocal, listar, fuenteGratis, explicar, mensajeDe, NO_CHAT, PIENSA, params, pedirJSON, norm };
