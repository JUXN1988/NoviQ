'use strict';
/* ==========================================================================
   Noviq Avatar — Memoria PERMANENTE propia del avatar
   memoria.json en su carpeta de datos (+ copia .bak): quién eres, lo que te
   gusta, lo que le contaste, planes, recordatorios, lo que aprendió y las
   últimas charlas. El portapapeles NUNCA se guarda aquí (solo en RAM).
   El formato es el mismo que usaba Noviq (datos/avatar_memoria.json), así que
   se importa tal cual la primera vez.
   ========================================================================== */
const path = require('path');
const fs = require('fs');
const { leerJSON, escribirJSON, guardadoDiferido } = require('./almacen');
const { ahora, norm, corto, uid, parecido } = require('./util');
const T = require('./tiempo');

/* ------------------------------------------- Palabras clave (para buscar y no repetir) */
const VACIAS = new Set(('de la el los las un una unos unas y o u a en con por para que se lo le les me mi mis tu tus su sus es son '
  + 'fue era del al como mas pero muy ya yo te nos hay esta este esto eso esa ese estos esas sus le gusta tiene quiere usa '
  + 'the and for with you your his her this that are was').split(' '));
// sinónimos → misma raíz, para que «le encanta X» y «disfruta X» cuenten como el MISMO hecho
const SINONIMOS = [
  [/\b(le |me )?(encanta|encantan|fascina|fascinan|apasiona|apasionan|disfruta|disfruto|gusta|gustan|ama|adora)\b/g, ' gusta '],
  [/\b(odia|odio|detesta|detesto|no soporta|no le gusta|no me gusta)\b/g, ' odia '],
  [/\b(trabaja|trabajo|labora)\b/g, ' trabaja '],
  [/\b(vive|vivo|reside|resido)\b/g, ' vive '],
  [/\b(computadora|ordenador|pc|laptop|portatil)\b/g, ' pc '],
  [/\b(programar|programacion|codigo|programando)\b/g, ' programar ']
];
function canon(t) { let n = ' ' + norm(t) + ' '; for (const [rx, r] of SINONIMOS) n = n.replace(rx, r); return n.replace(/\s+/g, ' ').trim(); }
function claves(t) {
  return [...new Set(canon(t).split(' ').filter((w) => w.length > 2 && !VACIAS.has(w)).map((w) => w.slice(0, 6)))];
}
/** 0..1: cuántas palabras clave de la consulta aparecen en el texto. */
function relevancia(cq, texto) {
  if (!cq.length) return 0;
  const ct = new Set(claves(texto));
  let n = 0;
  for (const w of cq) if (ct.has(w)) n++;
  return n / Math.sqrt(cq.length * Math.max(ct.size, 1));
}
// palabras de INTENCIÓN (qué se pide, no el tema): agrupan «resumen de Napoleón en Word» con «resumen de Waterloo en Word»
const INTENCION = new Set(('abre abrir cierra cerrar redacta redactar resume resumen resumir '
  + 'documento word excel hoja informe ensayo carta lista tabla presentacion diapositivas pdf archivo archivos carpeta carpetas '
  + 'mueve mover copia copiar borra borrar renombra busca buscar encuentra investiga internet pagina web video musica '
  + 'proyecto codigo programa programar error arregla corrige ejecuta instala app aplicacion juego correo email mensaje '
  + 'apaga reinicia volumen pantalla captura ventana configuracion sonido wifi bluetooth noviq bot clima noticias recordatorio')
  .split(' ').map((w) => w.slice(0, 6)));
function firma(t) {
  const c = claves(t);
  const f = c.filter((w) => INTENCION.has(w));
  return (f.length ? f : c.slice(0, 3)).sort();
}
function jaccard(a, b) {
  const A = new Set(a), B = new Set(b);
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / Math.max(1, A.size + B.size - n);
}
/** «se llama Gabriel», «Gabriel es el usuario»: ya está en usuario.nombre (no gastar un recuerdo ni tokens en eso). */
function repiteNombre(texto, nu) {
  if (!nu) return false;
  const n = norm(texto);
  return (/^(se llama|su nombre es|me llamo|mi nombre es|el usuario se llama)\b/.test(n) && n.includes(nu)) || n === nu + ' es el usuario' || n === 'el usuario es ' + nu;
}
const SECRETO = /(nvapi-[\w-]{12,}|sk-[\w-]{16,}|AIza[\w-]{20,}|gsk_[A-Za-z0-9]{16,}|ghp_[A-Za-z0-9]{20,}|github_pat_\w{20,}|xox[bpas]-[\w-]{10,}|\b\d{8,10}:[\w-]{30,})/;

function nueva() {
  return { version: 1, usuario: { nombre: '', datos: {} }, hechos: [], planes: [], aprendido: [], recordatorios: [], charla: [], experiencias: [],
    contexto: { proyecto: '', desde: 0 }, stats: { turnos: 0, desde: ahora(), saludo_dia: '', reflejos: 0, ia: 0, a_noviq: 0, herramientas: 0 } };
}
function completar(m) {
  const base = nueva();
  m = m && typeof m === 'object' ? m : base;
  for (const [k, v] of Object.entries(base)) if (m[k] === undefined) m[k] = v;
  for (const [k, v] of Object.entries(base.stats)) if (m.stats[k] === undefined) m.stats[k] = v;
  if (!m.usuario.datos) m.usuario.datos = {};
  delete m.convs_voz;   // eso es de Noviq (sus conversaciones de voz)
  return m;
}

class Memoria {
  constructor({ dir, log }) {
    this.ruta = path.join(dir, 'memoria.json');
    this.log = log || (() => {});
    const leida = leerJSON(this.ruta);
    this.nueva = !leida;
    this.m = completar(leida);
    this.guardarDiferido = guardadoDiferido(() => this.guardarYa(), 500);
    this.notasNoviq = { mtime: 0, lineas: [] };
    try { const q = this.depurar(); if (q) this.log(`[memoria] quité ${q} hechos repetidos`); } catch (_) {}
  }

  guardarYa() {
    const m = this.m;
    m.charla = m.charla.slice(-80);
    m.hechos = m.hechos.slice(-300);
    m.aprendido = m.aprendido.sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 400);
    m.recordatorios = m.recordatorios.filter((r) => !r.hecho || ahora() - (r.cuando || 0) < 7 * 86400).slice(-200);
    m.planes = m.planes.slice(-60);
    m.experiencias = (m.experiencias || []).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 150);
    try { escribirJSON(this.ruta, m); } catch (e) { this.log('no pude guardar la memoria: ' + e.message); }
  }
  guardar() { this.guardarDiferido(); }

  /** Trae la memoria que tenía Noviq (mismo formato). Solo agrega lo que falta. */
  importar(vieja) {
    if (!vieja || typeof vieja !== 'object') return 0;
    vieja = completar(JSON.parse(JSON.stringify(vieja)));
    const m = this.m;
    let n = 0;
    if (!m.usuario.nombre && vieja.usuario.nombre) { m.usuario.nombre = vieja.usuario.nombre; n++; }
    for (const [k, v] of Object.entries(vieja.usuario.datos || {})) if (m.usuario.datos[k] === undefined) { m.usuario.datos[k] = v; n++; }
    for (const lista of ['hechos', 'planes', 'aprendido', 'recordatorios', 'charla']) {
      const ids = new Set(m[lista].map((x) => x.id || JSON.stringify(x)));
      for (const x of vieja[lista] || []) if (!ids.has(x.id || JSON.stringify(x))) { m[lista].push(x); n++; }
    }
    if (!m.contexto.proyecto && vieja.contexto && vieja.contexto.proyecto) m.contexto = vieja.contexto;
    for (const k of ['turnos', 'reflejos', 'ia', 'a_noviq']) m.stats[k] = (m.stats[k] || 0) + (vieja.stats[k] || 0);
    m.charla.sort((a, b) => (a.t || 0) - (b.t || 0));
    this.guardarYa();
    return n;
  }

  /* ------------------------------------------------------------ Usuario */
  usuario() { return this.m.usuario.nombre || ''; }
  ponerNombre(nombre, nombreBot) {
    let n = String(nombre || '').replace(/[^\p{L}\p{N} \-]/gu, '').trim();
    if (n.length < 2 || n.length > 30 || ['noviq', norm(nombreBot || ''), 'yo', 'nadie', 'nada'].includes(norm(n))) return false;
    n = n.split(/\s+/).slice(0, 2).map((w) => w[0].toUpperCase() + w.slice(1)).join(' ');
    this.m.usuario.nombre = n;
    this.guardar();
    return true;
  }
  dato(k, v) { this.m.usuario.datos[k] = v; this.guardar(); }

  /* ------------------------------------------------------------- Hechos */
  recordar(texto, fuente) {
    texto = corto(String(texto || '').replace(/^[\s.,]+|[\s.,]+$/g, ''), 220);
    if (texto.length < 4 || SECRETO.test(texto)) return false;   // nunca claves ni tokens
    // «se llama Gabriel» ya está en usuario.nombre: no se repite como hecho
    const nu = norm(this.usuario());
    if (repiteNombre(texto, nu)) return true;
    const nt = canon(texto);
    for (const h of this.m.hechos) {
      const nh = canon(h.texto);
      // casi igual, o uno contiene al otro (se queda la versión más completa)
      if (parecido(nh, nt) > 0.82 || (nh.length > 12 && nt.includes(nh)) || (nt.length > 12 && nh.includes(nt))) {
        if (nt.length >= nh.length) h.texto = texto;
        h.t = ahora(); this.guardar(); return true;
      }
    }
    this.m.hechos.push({ id: uid(8), texto, t: ahora(), fuente: fuente || 'voz' });
    this.guardar();
    return true;
  }
  olvidar(q) {
    q = norm(q);
    const antes = this.m.hechos.length;
    this.m.hechos = this.m.hechos.filter((h) => parecido(norm(h.texto), q) < 0.6 && !norm(h.texto).includes(q));
    this.guardar();
    return antes - this.m.hechos.length;
  }

  /* ------------------------------------------------------------- Charla */
  registrar(rol, texto, origen) {
    this.m.charla.push({ rol, texto: corto(texto, 600), t: ahora(), origen: origen || 'voz' });
    if (rol === 'user') this.m.stats.turnos++;
    this.guardar();
  }
  historial(n) {
    return this.m.charla.slice(-(n || 12)).filter((t) => t.rol === 'user' || t.rol === 'assistant')
      .map((t) => ({ role: t.rol === 'user' ? 'user' : 'assistant', content: t.texto }));
  }
  contar(k) { this.m.stats[k] = (this.m.stats[k] || 0) + 1; this.guardar(); }

  /* ------------------------------------------------------- Recordatorios */
  crearRecordatorio(que, cuandoTxt) {
    const c = T.interpretar(cuandoTxt || '');
    if (!c) return null;
    let rep = null, ts;
    if (c.tipo === 'una_vez') ts = T.proxima(c);
    else { rep = c; ts = T.proxima(c); }
    if (!ts) return null;
    const r = { id: uid(8), texto: corto(que, 200), cuando: ts, repetir: rep, hecho: false, creado: ahora() };
    this.m.recordatorios.push(r);
    this.guardar();
    return r;
  }
  recordatoriosPendientes() { return this.m.recordatorios.filter((r) => !r.hecho).sort((a, b) => a.cuando - b.cuando); }
  vencidos() { const t = ahora(); return this.m.recordatorios.filter((r) => !r.hecho && (r.cuando || 0) <= t); }
  cumplido(r) {
    if (r.repetir) {
      const nx = T.proxima(r.repetir, new Date((ahora() + 61) * 1000));
      if (nx) r.cuando = nx; else r.hecho = true;
    } else r.hecho = true;
    this.guardar();
  }
  borrarRecordatorio(idOTexto) {
    const q = norm(idOTexto);
    const antes = this.m.recordatorios.length;
    this.m.recordatorios = this.m.recordatorios.filter((r) => r.id !== idOTexto && !(q && !r.hecho && (norm(r.texto).includes(q) || parecido(norm(r.texto), q) > 0.7)));
    this.guardar();
    return antes - this.m.recordatorios.length;
  }

  /* -------------------------------------------------------------- Planes */
  planActivo() {
    const ps = this.m.planes.filter((p) => p.estado === 'borrador' && ahora() - (p.act || 0) < 6 * 3600);
    return ps.length ? ps[ps.length - 1] : null;
  }
  guardarPlan(texto) {
    let p = this.planActivo();
    if (p) { p.texto = corto(texto, 600); p.act = ahora(); }
    else { p = { id: uid(8), texto: corto(texto, 600), estado: 'borrador', t: ahora(), act: ahora(), proyecto: this.proyectoActivo() }; this.m.planes.push(p); }
    this.guardar();
    return p;
  }
  estadoPlan(p, estado, extra) { if (!p) return; p.estado = estado; p.act = ahora(); Object.assign(p, extra || {}); this.guardar(); }
  planPorConv(conv) { return this.m.planes.find((p) => p.conv === conv && p.estado === 'en_marcha') || null; }

  /* ------------------------------------------------------- Proyecto activo */
  proyectoActivo() {
    const c = this.m.contexto;
    return c.proyecto && ahora() - Number(c.desde || 0) < 8 * 3600 ? c.proyecto : '';
  }
  ponerProyecto(p) { this.m.contexto = { proyecto: p || '', desde: ahora() }; this.guardar(); }

  /* --------------------------------------------------------- Aprendido */
  aprendido(n, soloUsuario) {
    let mejor = null, pm = 0;
    for (const a of this.m.aprendido) {
      if (soloUsuario && a.fuente !== 'usuario') continue;
      const p = parecido(a.q, n);
      const umbral = a.fuente === 'usuario' ? 0.86 : 0.93;
      if (p >= umbral && p > pm) { mejor = a; pm = p; }
    }
    if (mejor) { mejor.veces = (mejor.veces || 0) + 1; mejor.t = ahora(); this.guardar(); }
    return mejor;
  }
  aprender(pregunta, respuesta, fuente) {
    const q = norm(pregunta);
    this.m.aprendido = this.m.aprendido.filter((a) => a.q !== q);
    this.m.aprendido.push({ q, p: pregunta, r: respuesta, fuente: fuente || 'ia', veces: 0, t: ahora() });
    this.guardar();
  }
  olvidarAprendidoDeIA() { this.m.aprendido = this.m.aprendido.filter((a) => a.fuente === 'usuario'); this.guardar(); }

  /** Une hechos repetidos que ya estaban guardados (misma idea con otras palabras). Devuelve cuántos quitó. */
  depurar() {
    const h = this.m.hechos;
    const nu = norm(this.usuario());
    const out = [];
    for (const x of h.slice().sort((a, b) => (a.t || 0) - (b.t || 0))) {
      if (!x || !x.texto || SECRETO.test(x.texto)) continue;
      const nx = canon(x.texto);
      if (repiteNombre(x.texto, nu)) continue;
      const igual = out.find((o) => { const no = canon(o.texto); return parecido(no, nx) > 0.82 || (no.length > 12 && nx.includes(no)) || (nx.length > 12 && no.includes(nx)); });
      if (igual) { if (nx.length >= canon(igual.texto).length) igual.texto = x.texto; igual.t = Math.max(igual.t || 0, x.t || 0); }
      else out.push(x);
    }
    const q = h.length - out.length;
    if (q > 0) { this.m.hechos = out; this.guardar(); }
    return q;
  }

  /* ---------------------------------------- Experiencia: qué bot resolvió qué */
  /** Aprende de cada trabajo: para pedidos parecidos, qué bot funcionó (o falló) y cuánto tardó. */
  experiencia(texto, bot, ok, ms) {
    if (!texto || !bot) return;
    const f = firma(texto);
    if (!f.length) return;
    const lista = this.m.experiencias || (this.m.experiencias = []);
    let e = lista.find((x) => x.bot === bot && jaccard(f, x.f || firma(x.ej)) >= 0.6);
    if (!e) { e = { id: uid(8), ej: corto(texto, 90), f, bot, ok: 0, mal: 0, ms: 0, t: ahora() }; lista.push(e); }
    e.ej = corto(texto, 90); e.f = e.f || f;
    if (ok) e.ok++; else e.mal++;
    e.ms = Math.round(((e.ms || 0) * 0.6) + (Number(ms) || 0) * 0.4);
    e.t = ahora();
    this.guardar();
  }
  /** Bot que mejor resolvió pedidos parecidos (≥2 éxitos y ≥70 % de aciertos) o null. */
  botSugerido(texto) {
    const f = firma(texto);
    let mejor = null, pm = 0;
    for (const e of this.m.experiencias || []) {
      const r = jaccard(f, e.f || firma(e.ej));
      const tasa = e.ok / Math.max(1, e.ok + e.mal);
      if (r >= 0.6 && e.ok >= 2 && tasa >= 0.7 && r * tasa > pm) { pm = r * tasa; mejor = e.bot; }
    }
    return mejor;
  }

  /* -------------------------------- Notas de Noviq (solo LECTURA, nunca la bóveda) */
  /** Líneas de datos/memoria.md y memoria_ajustes.md de Noviq (cache por fecha de cambio). */
  leerNotasNoviq(rutaNoviq) {
    if (!rutaNoviq) return [];
    const dirs = [process.env.NOVIQ_DATOS, path.join(rutaNoviq, 'datos')].filter(Boolean);
    const archivos = [];
    for (const d of dirs) for (const f of ['memoria.md', 'memoria_ajustes.md']) archivos.push(path.join(d, f));
    let mt = 0;
    const exist = archivos.filter((f) => { try { mt += fs.statSync(f).mtimeMs; return true; } catch (_) { return false; } });
    if (mt === this.notasNoviq.mtime) return this.notasNoviq.lineas;
    const lineas = [];
    for (const f of exist) {
      let txt = '';
      try { txt = fs.readFileSync(f, 'utf8').slice(0, 60000); } catch (_) { continue; }
      for (const ln of txt.split(/\r?\n/)) {
        const l = ln.replace(/^\s*[-*•]\s+/, '').trim();
        if (l.length < 6 || /^#/.test(l) || SECRETO.test(l)) continue;
        lineas.push({ texto: corto(l, 160), de: /ajustes/.test(f) ? 'ajustes' : 'usuario' });
      }
    }
    this.notasNoviq = { mtime: mt, lineas: lineas.slice(0, 400) };
    return this.notasNoviq.lineas;
  }

  /**
   * 🧠 Memoria COMPACTA para la IA: solo lo que sirve para ESTA frase (ahorra tokens).
   * Nombre y datos básicos + hechos relevantes (y los 2 más nuevos) + planes + experiencias parecidas + notas de Noviq.
   * presupuesto: caracteres máximos (≈ 4 caracteres por token).
   */
  contexto(texto, op) {
    op = op || {};
    const presupuesto = op.presupuesto || 1100;
    const m = this.m, cq = claves(texto);
    const L = [];
    const datos = Object.entries(m.usuario.datos || {}).slice(0, 6).map(([k, v]) => `${k}: ${corto(String(v), 40)}`);
    L.push(`- Usuario: ${m.usuario.nombre || '(nombre desconocido: pregúntalo)'}` + (datos.length ? ' (' + datos.join('; ') + ')' : '') + '.');
    // hechos: los relevantes primero; siempre los 2 más recientes
    const hs = m.hechos.map((h, i) => ({ h, r: relevancia(cq, h.texto), i }));
    const elegidos = hs.filter((x) => x.r >= 0.25).sort((a, b) => b.r - a.r).slice(0, 5).map((x) => x.h);
    for (const h of m.hechos.slice(-2)) if (!elegidos.includes(h)) elegidos.push(h);
    if (elegidos.length) L.push('- Sabes de él: ' + elegidos.map((h) => corto(h.texto, 110)).join(' | '));
    if (m.hechos.length > elegidos.length) L.push(`  (tienes ${m.hechos.length - elegidos.length} recuerdos más; solo te paso los que sirven ahora)`);
    const planes = m.planes.filter((p) => p.estado === 'borrador').slice(-2);
    if (planes.length) L.push('- Planes en borrador: ' + planes.map((p) => corto(p.texto, 110)).join(' | '));
    const pa = this.proyectoActivo();
    if (pa) L.push(`- Proyecto activo: «${pa}».`);
    // experiencia propia: qué bot resolvió pedidos parecidos
    const fq = firma(texto);
    const ex = (m.experiencias || []).map((e) => ({ e, r: jaccard(fq, e.f || firma(e.ej)) })).filter((x) => x.r >= 0.6).sort((a, b) => b.r - a.r).slice(0, 2);
    if (ex.length) L.push('- Tu experiencia: ' + ex.map(({ e }) => `«${corto(e.ej, 50)}» → bot ${e.bot} (${e.ok} bien, ${e.mal} mal)`).join('; '));
    // notas de Noviq relevantes (memoria general y de ajustes; solo lectura)
    const nn = this.leerNotasNoviq(op.rutaNoviq).map((x) => ({ x, r: relevancia(cq, x.texto) })).filter((y) => y.r >= 0.34).sort((a, b) => b.r - a.r).slice(0, 3);
    if (nn.length) L.push('- Notas de Noviq: ' + nn.map(({ x }) => corto(x.texto, 110)).join(' | '));
    let out = L.join('\n');
    if (out.length > presupuesto) out = out.slice(0, presupuesto - 1) + '…';
    return out;
  }

  /** Historial corto para la IA: últimas n intervenciones, recortadas (las viejas más). */
  historialCompacto(n, max) {
    const h = this.historial(n || 8);
    const lim = max || 240;
    return h.map((x, i) => ({ role: x.role, content: corto(x.content, i >= h.length - 2 ? lim * 2 : lim) }));
  }

  /* ------------------------------------------------- Ajustes → memoria */
  publico() {
    const m = this.m;
    return { usuario: m.usuario, hechos: m.hechos.slice(-120), planes: m.planes.slice(-30), recordatorios: this.recordatoriosPendientes().slice(0, 40),
      aprendido: m.aprendido.slice(0, 60).map((a) => ({ p: a.p, r: a.r, fuente: a.fuente, veces: a.veces || 0 })),
      charla: m.charla.slice(-30), stats: m.stats, contexto: m.contexto,
      experiencias: (m.experiencias || []).slice(0, 40).map((e) => ({ ej: e.ej, bot: e.bot, ok: e.ok, mal: e.mal })) };
  }
  editar(d) {
    const m = this.m;
    if ('nombre' in d) { if (d.nombre) this.ponerNombre(d.nombre); else m.usuario.nombre = ''; }
    if (d.dato && d.dato.clave) { if (d.dato.valor) m.usuario.datos[String(d.dato.clave).slice(0, 40)] = String(d.dato.valor).slice(0, 200); else delete m.usuario.datos[d.dato.clave]; }
    if (d.borrar_hecho) m.hechos = m.hechos.filter((h) => h.id !== d.borrar_hecho);
    if (d.agregar_hecho) this.recordar(d.agregar_hecho, 'ajustes');
    if (d.borrar_plan) m.planes = m.planes.filter((p) => p.id !== d.borrar_plan);
    if (d.borrar_recordatorio) m.recordatorios = m.recordatorios.filter((r) => r.id !== d.borrar_recordatorio);
    if (d.agregar_recordatorio && d.agregar_recordatorio.que) this.crearRecordatorio(d.agregar_recordatorio.que, d.agregar_recordatorio.cuando);
    if (d.borrar_aprendido != null) m.aprendido = m.aprendido.filter((a) => a.p !== d.borrar_aprendido);
    if (d.agregar_aprendido && d.agregar_aprendido.p && d.agregar_aprendido.r) this.aprender(d.agregar_aprendido.p, d.agregar_aprendido.r, 'usuario');
    if (d.borrar_charla) m.charla = [];
    if (d.olvidar_todo) this.m = nueva();
    this.guardarYa();
    return this.publico();
  }
}

module.exports = { Memoria, nueva, claves, relevancia, canon, firma };
