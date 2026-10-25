'use strict';
/* ==========================================================================
   Noviq Avatar — Bots internos (agentes) y control de permisos
   El bot principal (la mente del avatar) conversa SIEMPRE y reparte el trabajo:
   cada bot interno es un especialista con SUS herramientas y su propio ciclo
   de pensar → usar herramienta → ver resultado → … → informar:
     · pc        → Windows: abrir/cerrar, apagar, volumen, buscar archivos al instante;
                   PowerShell, CMD, archivos, procesos, pantalla, ratón, teclado
     · proyectos → tus proyectos: listar, abrir, ejecutar, buscar y leer su código
                   (sin cambiarlo; programar es de Noviq)
     · noviq     → maneja el programa Noviq (su servidor MCP + sus agentes)
   Antes de pensar con la IA, los bots pc y proyectos prueban la VÍA RÁPIDA
   (rapido.js): si la orden es de un paso, la hacen al instante sin IA.
     · web     → internet: buscar, leer páginas, clima, noticias, Wikipedia
     · vision  → mira por la cámara conectada o la pantalla
     · uno por cada servidor MCP externo que conectes
   Los trabajos corren en segundo plano y en paralelo; el avatar sigue hablando
   y avisa cuando cada uno termina.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const U = require('./util');
const { corto } = U;

const RIESGOS = ['leer', 'accion', 'peligro'];

/* Nombres de herramientas que usan las IAs pequeñas (Read, Edit, read_file, mkdir…) → los nuestros.
   Es el MISMO archivo que usa Noviq (noviq/experto/alias.json): una sola lista para los dos programas. */
let _alias = null;
function alias() {
  if (_alias) return _alias;
  _alias = new Map();
  for (const f of [path.join(__dirname, '..', '..', 'noviq', 'experto', 'alias.json'), path.join(__dirname, 'alias.json')]) {
    try {
      const d = JSON.parse(fs.readFileSync(f, 'utf8'));
      for (const [canon, lista] of Object.entries(d.herramientas || {})) {
        for (const a of lista) for (const k of [clave(a), clave(a).replace(/_/g, '')]) if (!_alias.has(k)) _alias.set(k, canon);
      }
      for (const n of (d.editor && d.editor.nombres) || []) _alias.set(clave(n), 'editar_archivo');
      break;
    } catch (_) { /* sin Noviq al lado */ }
  }
  return _alias;
}
function clave(s) {
  return String(s || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '').trim().replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase()
    .replace(/^(functions|function|tools|tool|default_api|api)[.:]/, '').replace(/[\s\-./]+/g, '_').replace(/^_+|_+$/g, '');
}
/** Busca la herramienta que la IA quiso decir entre las del bot (o null). */
function herramientaParecida(nombre, hs) {
  const k = clave(nombre);
  if (!k) return null;
  const directa = hs.find((x) => clave(x.nombre) === k);
  if (directa) return directa;
  const canon = alias().get(k) || alias().get(k.replace(/_/g, ''));
  if (canon) {
    const t = hs.find((x) => x.nombre === canon || x.nombre.endsWith('_' + canon));
    if (t) return t;
    // equivalentes del bot de proyectos (sus herramientas tienen otros nombres)
    const eq = { leer_archivo: 'leer_archivo_proyecto', buscar_en_archivos: 'buscar_en_proyecto', listar_directorio: 'archivos_proyecto' }[canon];
    if (eq) return hs.find((x) => x.nombre === eq) || null;
  }
  return null;
}

/* ===================================================================== */
class Permisos {
  /** op: {ajustes, dir, confirmar(info)→Promise<bool>, avisar(texto), log} */
  constructor(op) {
    this.aj = op.ajustes; this.dir = op.dir; this.confirmar = op.confirmar || null; this.avisar = op.avisar || (() => {}); this.log = op.log || (() => {});
    this.cola = [];        // aprobaciones pendientes cuando no hay diálogo propio (API/página)
    this.hist = [];        // auditoría reciente (RAM) y en acciones.log
    this.n = 0;
  }
  get cfg() { return this.aj.datos.agentes; }
  nivel() { return this.cfg.permisos; }
  /** ¿Pregunta? leer: no (salvo «pregunta_todo»); accion: salvo «solo_peligro»; peligro: siempre. */
  pregunta(riesgo) {
    if (riesgo === 'peligro') return true;
    if (riesgo === 'leer') return this.nivel() === 'pregunta_todo';
    return this.nivel() !== 'solo_peligro';
  }
  auditar(r) {
    const linea = Object.assign({ t: new Date().toISOString() }, r);
    this.hist.push(linea); if (this.hist.length > 100) this.hist.shift();
    try {
      const f = path.join(this.dir, 'acciones.log');
      try { if (fs.statSync(f).size > 400000) fs.renameSync(f, f + '.1'); } catch (_) { /* nuevo */ }
      fs.appendFileSync(f, JSON.stringify(linea) + '\n');
    } catch (_) { /* sin disco */ }
  }
  /** → {ok:true} | {ok:false, error, denegado?} */
  async autorizar(info) {
    const { quien, que, riesgo, detalle } = info;
    if (!this.cfg.activar) return { ok: false, error: 'Los bots internos están apagados en mis Ajustes.', denegado: true };
    if (!this.pregunta(riesgo)) { this.auditar({ quien, que, riesgo, auto: true, detalle: corto(detalle, 160) }); return { ok: true }; }
    const texto = `${quien} quiere ${riesgo === 'peligro' ? '⚠ (PELIGROSO) ' : ''}${que}`;
    let si = false;
    if (this.confirmar) {
      this.avisar('Necesito tu permiso: ' + corto(que, 80) + '. Mira la ventana que apareció.');
      try { si = !!(await this.confirmar({ titulo: 'Permiso para el bot interno', texto, detalle: corto(detalle, 600), peligro: riesgo === 'peligro' })); } catch (_) { si = false; }
    } else {
      si = await new Promise((resolve) => {
        const id = ++this.n;
        const e = { id, quien, que, riesgo, detalle: corto(detalle, 600), t: Date.now(), resolver: resolve };
        this.cola.push(e);
        this.avisar('Necesito tu permiso: ' + corto(que, 80) + '. Aprueba o rechaza en mis Ajustes → Bots.');
        setTimeout(() => { const i = this.cola.indexOf(e); if (i >= 0) { this.cola.splice(i, 1); resolve(false); } }, (this.cfg.aprobarSegundos || 90) * 1000);
      });
    }
    this.auditar({ quien, que, riesgo, permitido: si, detalle: corto(detalle, 160) });
    return si ? { ok: true } : { ok: false, error: 'No me diste permiso para eso.', denegado: true };
  }
  pendientes() { return this.cola.map((e) => ({ id: e.id, quien: e.quien, que: e.que, riesgo: e.riesgo, detalle: e.detalle, hace: Math.round((Date.now() - e.t) / 1000) })); }
  resolver(id, si) {
    const i = this.cola.findIndex((e) => e.id === Number(id));
    if (i < 0) return false;
    const [e] = this.cola.splice(i, 1); e.resolver(!!si);
    return true;
  }
}

/* ===================================================================== */
const PROMPT_BOT = (nombreBot, bot, herramientas, maxPasos, extra) => [
  `Eres «${bot.nombre}», un bot interno de ${nombreBot} (un asistente de escritorio). ${bot.desc}`,
  bot.guia || '',
  'El bot principal te da una ORDEN. La cumples TÚ, usando SOLO estas herramientas, una por turno, viendo cada resultado antes de seguir:',
  herramientas.map((h) => `- ${h.nombre} ${h.args}: ${h.desc}`).join('\n'),
  '',
  'Responde SIEMPRE un único JSON, sin texto fuera de él:',
  '• Para usar una herramienta: {"pensamiento":"qué haces y por qué (1 frase)","accion":"herramienta","herramienta":{"nombre":"…","args":{…}}}',
  '• Al terminar (o si no se puede): {"accion":"fin","ok":true,"resultado":"lo que hiciste o encontraste, con los datos concretos, claro y breve (máx. 120 palabras)"}',
  `Reglas: máximo ${maxPasos} pasos. No inventes resultados: usa solo lo que devuelven las herramientas. Si una falla, prueba otra forma o termina diciendo por qué.`,
  'Primero mira/lee, después actúa. No hagas nada que no pidan. Nunca pidas ni escribas claves o contraseñas. Si la orden es peligrosa o confusa, termina explicándolo.',
  'SÉ RÁPIDO: nada de planes largos ni explicaciones. Usa la herramienta más directa (abrir, cerrar_app, energia, volumen, buscar_en_mis_carpetas, buscar_en_proyecto…) antes que PowerShell. Si la orden es de 1 paso: 1 herramienta y termina. En cuanto tengas el resultado, termina con accion="fin".',
  `Hoy es ${U.fechaTxt()}, ${U.horaTxt()}. Sistema: ${process.platform === 'win32' ? 'Windows' : process.platform}.`,
  extra ? 'Indicaciones del usuario para ti: ' + extra : ''
].filter(Boolean).join('\n');

const resumenSchema = (s) => {
  const p = (s && s.properties) || {}, req = new Set((s && s.required) || []);
  const cs = Object.entries(p).slice(0, 8).map(([k, v]) => `"${k}":${(v && v.type) || 'string'}${req.has(k) ? '*' : ''}`);
  return '{' + cs.join(',') + '}';
};

class Agentes {
  /**
   * @param {object} o {ajustes, cerebro, conexiones, herramientas, noviq, permisos, vision, log, alTerminar(trabajo), alAvanzar(trabajo)}
   */
  constructor(o) {
    Object.assign(this, { aj: o.ajustes, cerebro: o.cerebro, con: o.conexiones, herr: o.herramientas, noviq: o.noviq, permisos: o.permisos, vision: o.vision || null, rapido: o.rapido || null,
      documentos: o.documentos || null,
      log: o.log || (() => {}), alTerminar: o.alTerminar || (() => {}), alAvanzar: o.alAvanzar || (() => {}) });
    this.jobs = []; this.nId = 0;
  }
  get cfg() { return this.aj.datos.agentes; }
  nombreBot() { return this.aj.datos.identidad.nombre || 'Noviq'; }

  /* ----------------------------------------------------------- Bots */
  async bots() {
    const c = this.cfg, L = [];
    const on = (k) => c[k] && c[k].activo !== false;
    if (!c.activar) return [];
    if (on('pc')) L.push({ id: 'pc', nombre: 'Bot de Windows y PC', desc: 'Trabaja en el PC al instante: abre y cierra programas, archivos y carpetas, apaga/bloquea, volumen, busca archivos; y con PowerShell/CMD crea, mueve, organiza o borra archivos, revisa procesos, pantalla, ratón y teclado.', fuentes: ['windows', 'pc'], instrucciones: c.pc.instrucciones, rapido: true,
      guia: 'Las carpetas del usuario: usa buscar_en_mis_carpetas para encontrar rutas (Escritorio puede estar en OneDrive). Para crear/mover/copiar/renombrar usa powershell con rutas completas entre comillas simples. Antes de borrar, lista lo que vas a borrar.' });
    const puenteNv = !!(this.noviq && this.noviq.conectado && this.aj.datos.noviq.usar);
    const prog = this.con && this.con.def('programador');
    const hayProg = !!(prog && prog.activo);
    if (on('proyectos') && this.con && this.con.internos.has('proyectos')) L.push({ id: 'proyectos', nombre: 'Bot de proyectos', desc: 'Tus proyectos de programación al instante: los lista, abre (carpeta o VS Code), ejecuta, y busca o lee su código para mostrarte dónde está algo. No cambia código: ' + (hayProg ? 'los cambios pequeños los hace el bot «programador» y los grandes Noviq.' : 'para eso encarga a Noviq.'), fuentes: ['proyectos'], encargoNoviq: puenteNv, instrucciones: (c.proyectos || {}).instrucciones, rapido: true,
      guia: 'Para MOSTRAR código: 1) buscar_en_proyecto con varias palabras clave separadas por | (con y sin tilde, español e inglés: «condor|vuelo|volar|fly»); 2) leer_archivo_proyecto solo el trozo que importa; 3) abrir_en_editor en esa línea para que el usuario lo vea; 4) fin: archivo, líneas y qué hace, en 2-3 frases. No pegues el código entero en el resultado.' });
    if (this.documentos && this.con && this.con.internos.has('documentos') && (!c.documentos || c.documentos.activo !== false)) L.push({ id: 'documentos', nombre: 'Bot de documentos',
      desc: 'Documentos de Word: investiga un tema (Wikipedia e internet) y escribe resúmenes, informes, ensayos, cartas o guías bien presentados; crea documentos en blanco; escribe en el Word abierto; lee y resume documentos.',
      fuentes: ['documentos'], propias: ['buscar_internet', 'leer_pagina'], instrucciones: (c.documentos || {}).instrucciones, maxTokens: 2500, pasos: 6,
      guia: 'Para un documento sobre un tema usa redactar_documento (hace TODO: investiga, escribe y abre Word). Si el usuario te dio el texto, crear_documento. Termina diciendo el título y que ya está abierto.',
      atajo: (orden, op) => this.atajoDocumentos(orden, op) });
    if (on('web')) L.push({ id: 'web', nombre: 'Bot de internet', desc: 'Busca en internet, lee páginas, clima, noticias, Wikipedia, divisas.', propias: ['buscar_internet', 'leer_pagina', 'clima', 'wikipedia', 'noticias', 'convertir', 'calcular', 'abrir', 'buscar_en_navegador'], instrucciones: c.web.instrucciones });
    if (on('vision') && this.vision) L.push({ id: 'vision', nombre: 'Bot de visión', desc: 'Mira por la cámara conectada o la pantalla y describe, lee o responde sobre lo que ve.', vision: true, instrucciones: c.vision.instrucciones });
    const nv = this.con && this.con.def('noviq');
    const puente = !!(this.noviq && this.noviq.conectado && this.aj.datos.noviq.usar);
    // (2.6) solo con Noviq ABIERTO: cerrado, sus herramientas fallan y la IA lo elegía igual (el avatar debe ser autónomo)
    if (on('noviq') && puente) L.push({ id: 'noviq', nombre: 'Bot de Noviq', desc: 'Maneja el programa Noviq: ve qué trabaja, manda y continúa trabajos a sus agentes, ranking de IAs, ajustes.', fuentes: nv && nv.activo ? ['noviq'] : [], noviq: puente, instrucciones: c.noviq.instrucciones });
    if (hayProg) L.push({ id: 'programador', nombre: 'Bot programador', pasos: 12,
      desc: 'Cambios PEQUEÑOS en el código de tus proyectos (un valor, un texto, un error puntual, una función corta) y preguntas sobre el código («¿dónde se controla el salto?»): encuentra el lugar, lo lee, lo cambia con copia de respaldo y verifica. Para crear programas nuevos o cambios grandes: Noviq.',
      fuentes: ['programador'], instrucciones: prog.instrucciones,
      guia: 'MÉTODO (eficiente, sin rodeos): 1) usar_proyecto con el nombre del proyecto (si no lo sabes: proyectos); 2) explorar_codigo con una pregunta normal para encontrar archivo y líneas; 3) leer_archivo SOLO de esas líneas (desde_linea/hasta_linea); 4) editar_archivo con texto_anterior copiado EXACTO del resultado (sin los números de línea) o con desde_linea/hasta_linea; 5) verificar_codigo de ese archivo; si falla, corrige o usa deshacer_cambio; 6) fin: qué cambiaste, archivo y línea. Si el cambio es grande (crear un programa, varias partes o archivos), NO lo hagas: termina diciendo que es trabajo para Noviq.' });
    if (this.con) for (const s of this.con.d.servidores) {
      if (!s.activo || s.id === 'noviq' || s.id === 'programador') continue;
      L.push({ id: s.id, nombre: 'Bot de ' + s.nombre, desc: s.bot || ('Usa el servidor MCP «' + s.nombre + '».'), fuentes: [s.id], externo: true, instrucciones: s.instrucciones });
    }
    return L;
  }
  async roster() { return (await this.bots()).map((b) => ({ id: b.id, nombre: b.nombre, desc: b.desc })); }
  async bot(id) {
    id = String(id || '').trim().toLowerCase();
    const bs = await this.bots();
    return bs.find((b) => b.id === id) || bs.find((b) => b.nombre.toLowerCase().includes(id)) || null;
  }

  /** Herramientas de un bot: [{nombre, desc, args, riesgo, ejecutar(args)→{ok,datos|error}, fuente}] */
  async herramientasDe(bot) {
    const out = [];
    const poner = (h) => { let n = h.nombre; if (out.some((x) => x.nombre === n)) n = (h.fuente || 'x') + '_' + n; out.push(Object.assign(h, { nombre: n })); };
    for (const sid of bot.fuentes || []) {
      let tools = [];
      try { tools = await this.con.herramientas(sid); } catch (e) { this.log('bot ' + bot.id + ': ' + sid + ': ' + e.message); continue; }
      for (const t of tools) poner({ nombre: t.name, desc: corto(t.description, 220), args: resumenSchema(t.inputSchema), fuente: sid, riesgo: t.riesgo,
        riesgoDeLlamada: (a) => (this.con.internos.has(sid) && this.con.internos.get(sid).riesgoDeLlamada ? this.con.internos.get(sid).riesgoDeLlamada(t.name, a) : { riesgo: t.riesgo }),
        ejecutar: (a) => this.con.llamar(sid, t.name, a) });
    }
    if (bot.propias) {
      const lista = this.herr.propiasActivas();
      for (const [n, d] of lista) if (bot.propias.includes(n)) poner({ nombre: n, desc: d.desc, args: d.args, fuente: 'avatar', riesgo: ['abrir', 'buscar_en_navegador'].includes(n) ? 'accion' : 'leer',
        ejecutar: (a) => this.herr.ejecutar(n, a) });
    }
    if (bot.encargoNoviq && !bot.noviq) {
      poner({ nombre: 'encargar_a_noviq', desc: 'SOLO si el usuario pidió CAMBIAR o crear código: manda la tarea completa a los agentes de Noviq', args: '{"tarea":string*,"proyecto":string}', fuente: 'noviq', riesgo: 'accion',
        ejecutar: async (a) => { const r = await this.noviq.tarea({ tarea: String(a.tarea || '').slice(0, 4000) + '\n\n(Encargado por el bot de proyectos del avatar.)', proyecto: String(a.proyecto || ''), en_chat: false, origen: 'bot' }); return r && r.ok ? { ok: true, datos: 'Noviq recibió el trabajo' } : { ok: false, error: (r && r.error) || 'Noviq no respondió' }; } });
    }
    if (bot.noviq) {
      poner({ nombre: 'encargar_trabajo', desc: 'manda una tarea completa a los agentes de Noviq (programar, archivos, correo, proyectos…) y sigue su avance en Noviq', args: '{"tarea":string*,"proyecto":string}', fuente: 'noviq', riesgo: 'accion',
        ejecutar: async (a) => { const r = await this.noviq.tarea({ tarea: String(a.tarea || '').slice(0, 4000) + '\n\n(Encargado por el bot de Noviq del avatar.)', proyecto: String(a.proyecto || ''), en_chat: false, origen: 'bot' }); return r && r.ok ? { ok: true, datos: 'Noviq recibió el trabajo' + (r.destino ? ' (' + r.destino + ')' : '') } : { ok: false, error: (r && r.error) || 'Noviq no respondió' }; } });
      let nt = []; try { nt = await this.herr.deNoviq(); } catch (_) { /* sin Noviq */ }
      for (const t of nt.slice(0, 40)) poner({ nombre: t.nombre, desc: corto(t.desc, 200), args: t.args || '{}', fuente: 'noviq', riesgo: t.info === false ? 'accion' : 'leer', ejecutar: (a) => this.herr.ejecutar(t.nombre, a) });
    }
    if (bot.vision && this.vision) {
      poner({ nombre: 'ver_camara', desc: 'mira por la cámara conectada y responde la pregunta sobre lo que ve (la foto no se guarda)', args: '{"pregunta":string}', fuente: 'vision', riesgo: 'leer',
        ejecutar: (a) => this.vision.mirar(String(a.pregunta || 'Describe lo que ves.'), { fuente: 'camara' }) });
      poner({ nombre: 'ver_pantalla', desc: 'captura la pantalla y responde la pregunta sobre lo que se ve (se envía a una IA con visión)', args: '{"pregunta":string}', fuente: 'vision', riesgo: 'accion',
        ejecutar: (a) => this.vision.mirar(String(a.pregunta || 'Describe lo que hay en la pantalla.'), { fuente: 'pantalla' }) });
    }
    return out;
  }

  /** Bot de documentos: si la orden ya viene entendida (datos de la vía rápida) o se entiende sola, lo hace directo (sin gastar la IA en decidir). */
  async atajoDocumentos(orden, op) {
    if (!this.documentos) return null;
    let d = op && op.datos;
    if (!d && this.rapido) { const o = this.rapido.interpretarDocumento(String(orden)); if (o && o.tipo === 'documento' && o.tema) d = { tema: o.tema, tipo: o.tipoDoc, enAbierto: o.enAbierto, extension: o.extension, instrucciones: o.instrucciones }; }
    if (!d || !d.tema) return null;
    // crear un documento NUEVO en «Documentos\Noviq Documentos» no cambia nada tuyo (nunca sobrescribe): se pide permiso
    // como para leer; escribir DENTRO de tu Word abierto sí cambia un documento tuyo → permiso de acción
    const riesgo = d.enAbierto ? 'accion' : 'leer';
    const perm = await this.permisos.autorizar({ quien: 'Bot de documentos', que: d.enAbierto ? `escribir en tu Word abierto sobre «${corto(d.tema, 60)}»` : `crear un documento de Word sobre «${corto(d.tema, 60)}»`, riesgo, detalle: 'redactar_documento ' + JSON.stringify(d).slice(0, 300) });
    if (!perm.ok) return { ok: false, resultado: 'No me diste permiso para crear el documento.', denegado: true, pasos: [] };
    op.alPaso && op.alPaso({ paso: 1, herramienta: 'redactar_documento', riesgo });
    const t0 = Date.now();
    const r = await this.documentos.redactar(d);
    this.permisos.auditar({ quien: 'Bot de documentos', que: 'redactar_documento', riesgo, auto: true, detalle: r.ok ? r.ruta : r.error });
    if (!r.ok) return { ok: false, resultado: r.error, pasos: [{ herramienta: 'redactar_documento', ok: false, ms: Date.now() - t0 }] };
    const dicho = `Listo: ${r.insertado ? 'lo escribí en tu Word abierto' : 'creé y abrí en Word'} «${corto(r.titulo, 80)}» (${r.palabras} palabras${r.fuentes.length ? ', ' + r.fuentes.length + (r.fuentes.length === 1 ? ' fuente' : ' fuentes') : ''}).` +
      (r.conIA ? '' : ' Mi IA no respondió, así que lo armé con lo que encontré.') + (d.enAbierto && !r.insertado ? ' No pude escribir en tu Word abierto (' + (r.motivo || 'no respondió') + '), así que lo abrí aparte.' : '');
    return { ok: true, resultado: dicho, archivo: r.ruta, hablado: true, pasos: [{ herramienta: 'redactar_documento', ok: true, ms: Date.now() - t0 }] };
  }

  /* -------------------------------------------- Ciclo de un bot */
  async correr(botId, orden, op) {
    op = op || {};
    const bot = typeof botId === 'object' ? botId : await this.bot(botId);
    if (!bot) return { ok: false, error: 'No tengo un bot «' + botId + '». Bots: ' + ((await this.roster()).map((b) => b.id).join(', ') || 'ninguno') };
    // atajo propio del bot (p. ej. documentos): lo que ya está claro se hace sin pensar con la IA
    if (bot.atajo && !op.sinRapido) {
      const r = await bot.atajo(String(orden), op).catch((e) => ({ ok: false, resultado: 'No pude: ' + corto(e.message, 200), pasos: [] }));
      if (r) return Object.assign({ bot: bot.id, pasos: [] }, r);
    }
    // ⚡ vía rápida: una orden de un paso se hace al instante, sin gastar la IA
    if (bot.rapido && this.rapido && !op.sinRapido) {
      const o = this.rapido.interpretar(String(orden));
      if (o && o.directo) {
        op.alPaso && op.alPaso({ paso: 1, herramienta: 'vía rápida', riesgo: 'leer' });
        const r = await this.rapido.atender(o, { desdeBot: true }).catch((e) => ({ ok: false, respuesta: e.message }));
        if (r && r.accion !== 'delegar' && r.ok !== false) return { ok: true, resultado: r.respuesta || 'Hecho.', pasos: [{ herramienta: 'vía rápida', ok: true, ms: r.ms || 0 }], bot: bot.id, rapido: true };
      }
    }
    const hs = await this.herramientasDe(bot);
    if (!hs.length) return { ok: false, error: bot.nombre + ' no tiene herramientas disponibles ahora' + (bot.externo ? ' (¿el servidor MCP está bien configurado? pruébalo en Ajustes → Bots)' : bot.id === 'noviq' ? ' (¿Noviq está abierto?)' : '') + '.' };
    const maxPasos = bot.pasos ? Math.min(20, Math.max(bot.pasos, this.cfg.maxPasos || 8)) : Math.min(bot.rapido ? 6 : 20, Math.max(1, this.cfg.maxPasos || 8));
    const sistema = PROMPT_BOT(this.nombreBot(), bot, hs, maxPasos, bot.instrucciones);
    const hist = []; let usuario = 'ORDEN: ' + String(orden).slice(0, 3000);
    const pasos = []; let ultimaClave = '', repetida = 0, resultadoFinal = null;
    for (let paso = 1; paso <= maxPasos + 1; paso++) {
      if (op.cancelado && op.cancelado()) return { ok: false, error: 'cancelado', pasos };
      let r;
      try { r = await this.cerebro.pensar({ sistema, historial: hist, usuario, limiteSeg: bot.rapido ? 30 : bot.maxTokens > 1500 ? 90 : 45, maxTokens: bot.maxTokens || 700, temperatura: 0.2, intentos: 3 }); }
      catch (e) { return { ok: false, error: 'No pude pensar: ' + corto(e.message, 200), pasos }; }
      const d = U.jsonDe(r.texto);
      hist.push({ role: 'user', content: usuario });
      hist.push({ role: 'assistant', content: corto(r.texto, 1200) });
      if (hist.length > 24) hist.splice(0, 2);
      if (!d || typeof d !== 'object') { if (pasos.length) { resultadoFinal = { ok: true, resultado: corto(U.limpiarIA ? U.limpiarIA(r.texto) : r.texto, 600) }; break; } usuario = 'Tu respuesta no fue un JSON válido. Responde solo el JSON pedido.'; continue; }
      if (String(d.accion).toLowerCase() === 'fin' || (!d.herramienta && d.resultado)) { resultadoFinal = { ok: d.ok !== false, resultado: String(d.resultado || d.respuesta || '').slice(0, 1500) || '(sin resultado)' }; break; }
      const h = d.herramienta || {};
      const t = hs.find((x) => x.nombre === String(h.nombre || '').trim()) || hs.find((x) => x.nombre.toLowerCase() === String(h.nombre || '').trim().toLowerCase())
        || herramientaParecida(h.nombre, hs);  // Read/Edit/read_file/mkdir… → la nuestra (las IAs pequeñas usan esos nombres)
      if (!t) { usuario = `RESULTADO: no existe la herramienta «${corto(h.nombre, 40)}». Usa solo: ${hs.map((x) => x.nombre).join(', ')}.`; continue; }
      if (paso > maxPasos) { resultadoFinal = { ok: false, resultado: 'Llegué al máximo de pasos sin terminar. Lo hecho: ' + pasos.map((p) => p.herramienta + (p.ok ? ' ✔' : ' ✖')).join(', ') }; break; }
      const args = h.args && typeof h.args === 'object' ? h.args : {};
      const clave = t.nombre + JSON.stringify(args);
      repetida = clave === ultimaClave ? repetida + 1 : 0; ultimaClave = clave;
      if (repetida >= 2) { resultadoFinal = { ok: false, resultado: 'Repetí la misma acción sin avanzar; paro aquí.' }; break; }
      // riesgo de esta llamada (powershell/cmd lo deducen del comando)
      let riesgo = RIESGOS.includes(t.riesgo) ? t.riesgo : 'accion';
      if (t.riesgoDeLlamada) { const c = t.riesgoDeLlamada(args) || {}; if (c.bloqueado) { usuario = `RESULTADO de ${t.nombre}: BLOQUEADO por seguridad (${c.motivo}). Busca otra forma o termina con accion="fin".`; pasos.push({ herramienta: t.nombre, ok: false, bloqueado: true }); this.permisos.auditar({ quien: bot.nombre, que: t.nombre, bloqueado: c.motivo, detalle: corto(JSON.stringify(args), 160) }); continue; } if (c.riesgo) riesgo = c.riesgo; }
      const quien = bot.nombre;
      const resumenArgs = corto(Object.values(args).map((v) => typeof v === 'string' ? v : JSON.stringify(v)).join(' · '), 300);
      const que = `usar «${t.nombre}»` + (resumenArgs ? ': ' + resumenArgs : '') + (d.pensamiento ? ' — ' + corto(d.pensamiento, 120) : '');
      const perm = await this.permisos.autorizar({ quien, que, riesgo, detalle: t.nombre + ' ' + JSON.stringify(args) });
      op.alPaso && op.alPaso({ paso, herramienta: t.nombre, riesgo });
      const t0 = Date.now();
      let res;
      if (!perm.ok) res = { ok: false, error: perm.error, denegado: true };
      else { try { res = await t.ejecutar(args); } catch (e) { res = { ok: false, error: String(e.message || e).slice(0, 300) }; } }
      res = res || { ok: false, error: 'sin respuesta' };
      pasos.push({ herramienta: t.nombre, args: corto(resumenArgs, 120), ok: res.ok !== false, ms: Date.now() - t0, denegado: !!res.denegado });
      if (res.denegado) { resultadoFinal = { ok: false, resultado: 'No me diste permiso para ' + corto(que, 120) + '. No hice nada más.', denegado: true }; break; }
      const dato = res.ok === false ? 'ERROR: ' + (res.error || 'falló') : typeof res.datos === 'string' ? res.datos : JSON.stringify(res.datos != null ? res.datos : res.decir || 'ok');
      usuario = `RESULTADO de ${t.nombre}: ${corto(dato, 3500)}\n(Paso ${paso} de ${maxPasos}. Sigue o termina con accion="fin".)`;
    }
    if (!resultadoFinal) resultadoFinal = { ok: false, resultado: 'No logré terminar.' };
    return Object.assign({ pasos, bot: bot.id }, resultadoFinal);
  }

  /* ------------------------------------------ Trabajos en segundo plano */
  /** Lanza ya y devuelve el trabajo (no espera). Varios a la vez = varios bots en paralelo. */
  async lanzar(p) {
    const bot = await this.bot(p.bot);
    if (!bot) return { ok: false, error: 'No tengo un bot «' + p.bot + '». Tengo: ' + ((await this.roster()).map((b) => b.id).join(', ') || 'ninguno (están apagados en Ajustes → Bots)') + '.' };
    const activos = this.jobs.filter((j) => j.estado === 'en_curso').length;
    if (activos >= 6) return { ok: false, error: 'Ya tengo ' + activos + ' trabajos en marcha; espera a que termine alguno.' };
    const job = { id: ++this.nId, bot: bot.id, botNombre: bot.nombre, orden: String(p.orden || '').slice(0, 1000), estado: 'en_curso', inicio: Date.now(), fin: 0, paso: 0, actual: '', resultado: '', origen: p.origen || '', texto: p.texto || '', cancelar: false, datos: p.datos || null };
    this.jobs.push(job); if (this.jobs.length > 40) this.jobs.splice(0, this.jobs.length - 40);
    job.promesa = (async () => {
      let r;
      try { r = await this.correr(bot, job.orden, { datos: job.datos, cancelado: () => job.cancelar, alPaso: (x) => { job.paso = x.paso; job.actual = x.herramienta; this.alAvanzar(job); } }); }
      catch (e) { r = { ok: false, error: String(e.message || e) }; }
      job.fin = Date.now(); job.pasos = r.pasos || []; job.actual = '';
      job.estado = job.cancelar ? 'cancelado' : r.ok ? 'listo' : 'error';
      job.resultado = r.resultado || r.error || ''; job.denegado = !!r.denegado; job.archivo = r.archivo || ''; job.hablado = !!r.hablado;
      try { await this.alTerminar(job); } catch (e) { this.log('agentes: ' + e.message); }
      return job;
    })();
    return { ok: true, trabajo: this.publico(job), job };
  }
  /** Lanza y espera (para la API y las pruebas). */
  async delegar(p) { const l = await this.lanzar(p); if (!l.ok) return l; await l.job.promesa; return { ok: l.job.estado === 'listo', trabajo: this.publico(l.job), resultado: l.job.resultado }; }
  publico(j) { return { id: j.id, bot: j.bot, botNombre: j.botNombre, orden: j.orden, estado: j.estado, segundos: Math.round(((j.fin || Date.now()) - j.inicio) / 1000), paso: j.paso, actual: j.actual, resultado: j.resultado, pasos: (j.pasos || []).length }; }
  trabajos() { return this.jobs.slice().reverse().map((j) => this.publico(j)); }
  enCurso() { return this.jobs.filter((j) => j.estado === 'en_curso'); }
  cancelar(id) { const j = this.jobs.find((x) => x.id === Number(id)); if (!j || j.estado !== 'en_curso') return false; j.cancelar = true; return true; }
  cancelarTodos() { for (const j of this.enCurso()) j.cancelar = true; }
}

module.exports = { Agentes, Permisos, RIESGOS, herramientaParecida };
