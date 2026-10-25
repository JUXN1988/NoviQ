'use strict';
/* ==========================================================================
   Noviq Avatar — 📄 Bot de DOCUMENTOS (sin Noviq)
   «haz un resumen de la Batalla de Pichincha en Word», «crea un documento
   nuevo», «escribe un informe sobre … en el Word que tengo abierto»,
   «resume este documento»…
     1. investiga (Wikipedia completa + internet) o usa el texto que le des
     2. redacta con la IA (si no hay IA, arma el documento con lo encontrado)
     3. crea el .docx con títulos, viñetas y fuentes (src/docx.js, sin
        programas extra) en Documentos\Noviq Documentos y lo abre en Word
     4. si pediste «en el Word que está abierto», lo inserta ahí
   Nunca sobrescribe: cada documento lleva su nombre con la fecha.
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const DOCX = require('./docx');
const { norm, corto, limpiarIA } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const TIPOS = { resumen: 'un resumen', informe: 'un informe', ensayo: 'un ensayo', reporte: 'un reporte', carta: 'una carta', oficio: 'un oficio',
  lista: 'una lista', guia: 'una guía', apuntes: 'unos apuntes', presentacion: 'un texto para presentar', documento: 'un documento', biografia: 'una biografía',
  articulo: 'un artículo', cuento: 'un cuento', redaccion: 'una redacción', investigacion: 'una investigación', tarea: 'una tarea', acta: 'un acta' };

const nombreSeguro = (t) => String(t || 'Documento').replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 70).replace(/[. ]+$/, '') || 'Documento';
const hoy = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };
const MAYUS = (t) => { t = String(t || '').trim(); return t ? t[0].toUpperCase() + t.slice(1) : t; };

async function pedirJSON(url, ms) {
  const r = await fetch(url, { headers: { 'User-Agent': 'NoviqAvatar/2.5 (asistente de escritorio)', Accept: 'application/json' }, signal: AbortSignal.timeout(ms || 12000) });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return r.json();
}

class Documentos {
  /**
   * op: {carpeta(k), cerebro, ejecutarPS(script, ms, {env}), abrirRuta, log, web: {buscarInternet, leerPagina}, windows}
   */
  constructor(op) {
    op = op || {};
    Object.assign(this, { carpetaSis: op.carpeta || (() => null), cerebro: op.cerebro || null, ps: op.ejecutarPS || null, abrirRuta: op.abrirRuta || (() => {}),
      log: op.log || (() => {}), web: op.web || {}, win: op.windows != null ? !!op.windows : process.platform === 'win32', dirFijo: op.dir || null });
    this.ultimo = null;   // {ruta, titulo, t}: el documento con el que estamos trabajando («agrégale…», «ábrelo»)
  }

  carpeta() {
    const base = this.dirFijo || path.join(this.carpetaSis('documents') || path.join(os.homedir(), 'Documents'), 'Noviq Documentos');
    fs.mkdirSync(base, { recursive: true });
    return base;
  }
  rutaNueva(titulo, ext) {
    const dir = this.carpeta();
    const base = `${nombreSeguro(titulo)} - ${hoy()}`;
    let r = path.join(dir, base + (ext || '.docx')), k = 2;
    while (fs.existsSync(r)) r = path.join(dir, `${base} (${k++})${ext || '.docx'}`);
    return r;
  }

  /** Documento de Word con el contenido (Markdown sencillo). */
  crear(op) {
    op = op || {};
    const titulo = MAYUS(op.titulo || 'Documento');
    const ruta = op.ruta || this.rutaNueva(titulo, '.docx');
    DOCX.crear(ruta, { titulo, contenido: op.contenido || '' });
    this.ultimo = { ruta, titulo, t: Date.now() };
    if (op.abrir !== false) this.abrirRuta(ruta);
    return { ok: true, ruta, titulo };
  }

  /** «abre un documento nuevo de Word»: un .docx en blanco que ya tiene nombre (así luego puedo escribir en él). */
  nuevo(op) {
    op = op || {};
    const titulo = MAYUS(op.titulo || 'Documento nuevo');
    const ruta = this.rutaNueva(titulo, '.docx');
    DOCX.crear(ruta, { titulo: op.titulo ? titulo : '', contenido: '' });
    this.ultimo = { ruta, titulo, t: Date.now(), vacio: true };
    if (op.abrir !== false) this.abrirRuta(ruta);
    return { ok: true, ruta, titulo };
  }

  /** Texto de un documento (.docx, .txt, .md, .csv, .html). */
  leer(ruta) {
    let r = String(ruta || (this.ultimo && this.ultimo.ruta) || '');
    if (!r) throw new Error('¿qué documento? dime el nombre o la ruta');
    // (2.5.1) «Resumen_Batalla_Pichincha.docx» o «batalla de pichincha»: se busca por nombre parecido (antes: «no existe»)
    if (!fs.existsSync(r)) { const b = this.resolver(r); if (!b) throw new Error('no encontré «' + path.basename(r) + '» en ' + this.carpeta() + '. Mis documentos: ' + (this.recientes(5).map((x) => x.nombre).join(' | ') || 'ninguno')); r = b; }
    const ext = path.extname(r).toLowerCase();
    if (ext === '.docx') return DOCX.texto(r);
    if (['.txt', '.md', '.csv', '.log', '.json'].includes(ext)) return fs.readFileSync(r, 'utf8');
    if (['.html', '.htm'].includes(ext)) return fs.readFileSync(r, 'utf8').replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    throw new Error('todavía no sé leer archivos ' + ext + ' (Noviq sí: PDF, Excel…)');
  }

  /**
   * Documento por nombre aproximado: «batalla de pichincha», «el resumen de Pichincha», «Resumen_Batalla_Pichincha.docx».
   * Busca en Noviq Documentos, Documentos y el Escritorio (sin subcarpetas). Sin nombre: el último que creé o el más nuevo.
   */
  resolver(nombre) {
    const q = String(nombre || '').trim();
    if (q && fs.existsSync(q) && fs.statSync(q).isFile()) return q;
    const dirs = [this.carpeta(), this.carpetaSis('documents'), this.carpetaSis('desktop')].filter(Boolean);
    const lista = [];
    for (const d of [...new Set(dirs)]) {
      let es = [];
      try { es = fs.readdirSync(d); } catch (_) { continue; }
      for (const x of es) {
        if (x.startsWith('~$') || !/\.(docx|txt|md)$/i.test(x)) continue;
        const r = path.join(d, x);
        try { lista.push({ nombre: x, ruta: r, t: fs.statSync(r).mtimeMs }); } catch (_) { /* sin permiso */ }
      }
    }
    if (!lista.length) return null;
    lista.sort((a, b) => b.t - a.t);
    const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'que', 'dice', 'se', 'llama', 'documento', 'archivo', 'word', 'docx', 'sobre', 'y', 'en', 'mi', 'ese', 'este']);
    const pq = norm(q.replace(/\.(docx|txt|md)$/i, '').replace(/[_-]+/g, ' ')).split(' ').filter((w) => w && !VACIAS.has(w));
    if (!pq.length) return (this.ultimo && fs.existsSync(this.ultimo.ruta) ? this.ultimo.ruta : lista[0].ruta);
    let mejor = null, pm = 0;
    for (const e of lista) {
      const pe = norm(e.nombre.replace(/\.(docx|txt|md)$/i, '').replace(/[_-]+/g, ' ')).split(' ');
      const hit = pq.filter((w) => pe.some((x) => x === w || (w.length >= 4 && (x.startsWith(w.slice(0, 5)) || w.startsWith(x.slice(0, 5)))))).length;
      const puntaje = hit / pq.length;
      if (puntaje > pm) { pm = puntaje; mejor = e; }
    }
    return pm >= 0.5 ? mejor.ruta : null;
  }

  /** Texto del documento ABIERTO en Word (lo que está en la pantalla), por COM. → {ok, texto, titulo, fuente:'word'} */
  async textoWordActivo() {
    if (!this.win || !this.ps) return { ok: false, error: 'Word solo en Windows' };
    const script = "try{$w=[System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}catch{'NOWORD';exit}" +
      ";if($w.Documents.Count -lt 1){'NODOC';exit};$d=$w.ActiveDocument;'OK:'+$d.Name;'---';$d.Content.Text";
    let r;
    try { r = await this.ps(script, 30000); } catch (e) { return { ok: false, error: e.message }; }
    const out = String((r && r.salida) || '');
    if (/^\s*NOWORD/.test(out)) return { ok: false, error: 'Word no está abierto', noword: true };
    if (/^\s*NODOC/.test(out)) return { ok: false, error: 'Word está abierto pero sin documentos', noword: true };
    const m = out.match(/OK:([^\r\n]*)\r?\n---\r?\n([\s\S]*)$/);
    if (!m) return { ok: false, error: 'Word no respondió' + (r && r.error ? ': ' + corto(r.error, 120) : '') };
    return { ok: true, titulo: m[1].trim().replace(/\.docx?$/i, ''), texto: m[2].replace(/\r/g, '\n').replace(/[\x07\x0b\x0c]/g, '\n').replace(/\n{3,}/g, '\n\n').trim(), fuente: 'word' };
  }

  /**
   * Para LEER EN VOZ ALTA: el documento abierto en Word (si pidió «el de la pantalla» o no dijo cuál) o el que se
   * llama parecido. → {ok, texto, titulo, fuente, ruta} | {ok:false, error}
   */
  async textoParaLeer(op) {
    op = op || {};
    if (op.pantalla || !op.nombre) {
      const w = await this.textoWordActivo();
      if (w.ok && w.texto && (!op.nombre || norm(w.titulo).includes(norm(op.nombre).split(' ')[0] || ''))) return w;
    }
    const ruta = this.resolver(op.nombre || '');
    if (!ruta) return { ok: false, error: op.nombre ? `No encontré un documento que se llame «${op.nombre}». Los últimos: ${this.recientes(3).map((x) => x.nombre.replace(/\.docx$/i, '')).join(' · ') || 'ninguno'}.` : 'No tengo ningún documento para leer. Dime cuál o ábrelo en Word.' };
    let texto;
    try { texto = this.leer(ruta); } catch (e) { return { ok: false, error: e.message }; }
    return { ok: true, texto: String(texto).trim(), titulo: path.basename(ruta).replace(/\.(docx|txt|md)$/i, ''), fuente: 'archivo', ruta };
  }

  recientes(n) {
    let es = [];
    try { es = fs.readdirSync(this.carpeta()).filter((x) => /\.docx$/i.test(x) && !x.startsWith('~$')); } catch (_) { return []; }
    return es.map((x) => { const r = path.join(this.carpeta(), x); return { nombre: x, ruta: r, t: fs.statSync(r).mtimeMs }; }).sort((a, b) => b.t - a.t).slice(0, n || 10);
  }

  /* ------------------------------------------------------- Investigar */
  /** Wikipedia COMPLETA (no solo el resumen) + algunas páginas de internet. → {texto, fuentes:[{titulo,url}]} */
  async investigar(tema, op) {
    op = op || {};
    const fuentes = [], partes = [];
    const tope = op.maxChars || 14000;
    // 1) Wikipedia en español: artículo entero en texto plano
    try {
      const w = 'https://es.wikipedia.org';
      const b = await pedirJSON(`${w}/w/rest.php/v1/search/page?limit=1&q=${encodeURIComponent(tema)}`, 10000);
      const pg = b.pages && b.pages[0];
      if (pg) {
        const j = await pedirJSON(`${w}/w/api.php?action=query&prop=extracts&explaintext=1&exsectionformat=wiki&redirects=1&format=json&titles=${encodeURIComponent(pg.title)}`, 15000);
        const p = Object.values((j.query && j.query.pages) || {})[0] || {};
        let t = String(p.extract || '').replace(/\n{3,}/g, '\n\n');
        t = t.split(/\n==\s*(Referencias|Notas|Bibliografía|Enlaces externos|Véase también)\s*==/)[0];
        if (t.trim()) { partes.push(`### Wikipedia: ${pg.title}\n${t.slice(0, Math.round(tope * 0.65))}`); fuentes.push({ titulo: `Wikipedia: ${pg.title}`, url: `${w}/wiki/${encodeURIComponent(String(pg.key || pg.title).replace(/ /g, '_'))}` }); }
      }
    } catch (e) { this.log('documentos: Wikipedia: ' + e.message); }
    // 2) internet (DuckDuckGo) → lee 1-2 páginas que no sean Wikipedia
    if (this.web.buscarInternet && op.internet !== false) {
      try {
        const rs = (await this.web.buscarInternet(tema)) || [];
        const otras = rs.filter((r) => r.url && !/wikipedia\.org|youtube\.com|facebook\.com|tiktok\.com|instagram\.com/.test(r.url)).slice(0, 4);
        let leidas = 0;
        for (const r of otras) {
          if (leidas >= 2 || partes.join('').length > tope) break;
          try {
            const t = await this.web.leerPagina(r.url);
            if (t && t.length > 400) { partes.push(`### ${r.titulo}\n${t.slice(0, 3500)}`); fuentes.push({ titulo: r.titulo, url: r.url }); leidas++; }
          } catch (_) { /* siguiente */ }
        }
        if (!leidas && otras.length) for (const r of otras.slice(0, 3)) { partes.push(`### ${r.titulo}\n${r.resumen || ''}`); fuentes.push({ titulo: r.titulo, url: r.url }); }
      } catch (e) { this.log('documentos: internet: ' + e.message); }
    }
    return { texto: partes.join('\n\n').slice(0, tope), fuentes };
  }

  /* --------------------------------------------------------- Redactar */
  /**
   * Investiga (o usa el texto dado), redacta y crea el documento.
   * op: {tema, tipo, extension, instrucciones, texto (material propio), fuente: internet|texto, enAbierto, abrir, titulo}
   * → {ok, ruta, titulo, palabras, fuentes, conIA, insertado}
   */
  async redactar(op) {
    op = op || {};
    const tema = String(op.tema || '').trim().replace(/[¿?¡!.]+$/g, '');
    if (!tema && !op.texto) return { ok: false, error: 'falta el tema del documento' };
    const tipo = TIPOS[norm(op.tipo || 'resumen')] ? norm(op.tipo || 'resumen') : 'resumen';
    const extension = op.extension || (tipo === 'resumen' ? 'una página (unas 450-650 palabras)' : 'unas 700-1000 palabras');
    let material = { texto: String(op.texto || ''), fuentes: [] };
    if (!material.texto) material = await this.investigar(tema);
    const titulo = MAYUS(op.titulo || (tipo === 'documento' ? tema : `${MAYUS(TIPOS[tipo].replace(/^(un|una|unos)\s+/, ''))}: ${tema}`));
    let md = '', conIA = false;
    if (this.cerebro && material.texto.trim().length > 80) {
      const sistema = [
        `Eres un redactor experto en español latino. Escribe ${TIPOS[tipo]} sobre «${tema || titulo}» de ${extension}.`,
        'Formato Markdown: «# título» en la primera línea, luego «## secciones» con párrafos claros; usa viñetas o una tabla solo cuando ayuden a entender.',
        tipo === 'resumen' ? 'Estructura sugerida: Introducción · Antecedentes/contexto · Desarrollo (hechos principales en orden) · Consecuencias o importancia · Conclusión.' : '',
        'Usa SOLO la información del MATERIAL: no inventes fechas, cifras ni nombres. Si algo no está en el material, no lo pongas.',
        'No pongas las URLs en el texto: yo agrego la sección de fuentes. No escribas nada antes del título ni después de la conclusión.',
        op.instrucciones ? 'Indicaciones del usuario: ' + String(op.instrucciones).slice(0, 600) : ''
      ].filter(Boolean).join('\n');
      try {
        const r = await this.cerebro.pensar({ sistema, usuario: 'MATERIAL:\n' + material.texto, limiteSeg: op.limiteSeg || 90, maxTokens: op.maxTokens || 2200, temperatura: 0.4, intentos: 3 });
        md = limpiarIA(String(r.texto || '')).replace(/^```(?:markdown|md)?\s*|```\s*$/g, '').trim();
        conIA = md.length > 200;
      } catch (e) { this.log('documentos: IA: ' + e.message); }
    }
    if (!conIA) md = this.armarSinIA(titulo, material.texto);
    if (!md.trim()) return { ok: false, error: `No encontré información sobre «${tema}» (¿hay internet?). Dime el contenido o pásame un texto.` };
    if (!/^\s*#\s/.test(md)) md = `# ${titulo}\n\n${md}`;
    if (material.fuentes.length) md += '\n\n## Fuentes\n\n' + material.fuentes.map((f) => `- [${f.titulo.replace(/[[\]]/g, '')}](${f.url})`).join('\n');
    const tituloFinal = (md.match(/^\s*#\s+(.+)/) || [])[1] || titulo;
    const palabras = md.replace(/[#*>|`-]/g, ' ').split(/\s+/).filter(Boolean).length;
    const ruta = this.rutaNueva(tituloFinal.replace(/[*_`]/g, ''), '.docx');
    DOCX.crear(ruta, { titulo: tituloFinal, contenido: md });
    this.ultimo = { ruta, titulo: tituloFinal, t: Date.now() };
    let insertado = false;
    if (op.enAbierto) {
      const w = await this.insertarEnWord(ruta);
      insertado = w.ok;
      if (!w.ok && op.abrir !== false) this.abrirRuta(ruta);
      return { ok: true, ruta, titulo: tituloFinal, palabras, fuentes: material.fuentes, conIA, insertado, motivo: w.error || '' };
    }
    if (op.abrir !== false) this.abrirRuta(ruta);
    return { ok: true, ruta, titulo: tituloFinal, palabras, fuentes: material.fuentes, conIA, insertado };
  }

  /** Sin IA: arma un documento ordenado con lo que encontró (secciones de Wikipedia, primeros párrafos). */
  armarSinIA(titulo, texto) {
    const t = String(texto || '').trim();
    if (!t) return '';
    const secciones = [];
    let actual = { titulo: 'Resumen', parrafos: [] };
    for (const linea of t.split('\n')) {
      const l = linea.trim();
      if (!l) continue;
      const m = l.match(/^={2,}\s*(.+?)\s*={2,}$/) || l.match(/^#{2,}\s+(.+)$/);
      if (m) { if (actual.parrafos.length) secciones.push(actual); actual = { titulo: m[1].replace(/^Wikipedia:\s*/, ''), parrafos: [] }; continue; }
      if (l.length > 60) actual.parrafos.push(l);
    }
    if (actual.parrafos.length) secciones.push(actual);
    let md = `# ${titulo}\n\n`, palabras = 0;
    for (const s of secciones) {
      if (palabras > 650) break;
      const ps = s.parrafos.slice(0, 2).map((p) => corto(p, 900));
      md += `## ${s.titulo}\n\n${ps.join('\n\n')}\n\n`;
      palabras += ps.join(' ').split(/\s+/).length;
    }
    return md.trim();
  }

  /* ---------------------------------------------------- Word abierto */
  /** Inserta un .docx al final del documento activo de Word (si Word está abierto). → {ok, error} */
  async insertarEnWord(ruta) {
    if (!this.win || !this.ps) return { ok: false, error: 'solo en Windows con Word abierto' };
    const script = "try{$w=[System.Runtime.InteropServices.Marshal]::GetActiveObject('Word.Application')}catch{'NOWORD';exit}" +
      ";if($w.Documents.Count -lt 1){'NODOC';exit};$d=$w.ActiveDocument;$s=$w.Selection;$null=$s.EndKey(6)" +
      ";if($d.Content.Text.Trim().Length -gt 0){$s.TypeParagraph()};$s.InsertFile($env:NQ_DOCX);'OK:'+$d.Name";
    let r;
    try { r = await this.ps(script, 30000, { env: { NQ_DOCX: ruta } }); } catch (e) { return { ok: false, error: e.message }; }
    const out = String((r && r.salida) || '').trim();
    if (/^OK:/m.test(out)) return { ok: true, documento: (out.match(/OK:(.*)/) || [])[1] || '' };
    if (/NOWORD/.test(out)) return { ok: false, error: 'Word no está abierto' };
    if (/NODOC/.test(out)) return { ok: false, error: 'Word no tiene un documento abierto' };
    return { ok: false, error: corto((r && r.error) || out || 'Word no respondió', 200) };
  }
}

/* --------------------------------------------- Servidor MCP interno */
const S = (d) => ({ type: 'string', description: d });
function servidorDocumentos(D) {
  const T = [
    { name: 'redactar_documento', riesgo: 'accion',
      description: 'Investiga un tema (Wikipedia + internet), escribe un documento de Word bien presentado (resumen, informe, ensayo, carta, guía…) con sus fuentes, lo guarda en Documentos\\Noviq Documentos y lo abre. Con en_word_abierto=true lo agrega al documento que el usuario tiene abierto en Word.',
      inputSchema: { type: 'object', properties: { tema: S('tema, ej. «la Batalla de Pichincha»'), tipo: S('resumen | informe | ensayo | carta | guia | lista | apuntes | biografia | articulo'),
        extension: S('ej. «una página», «dos páginas», «10 viñetas»'), instrucciones: S('indicaciones extra del usuario (tono, público, puntos a incluir)'),
        texto: S('material propio a usar en vez de investigar (opcional)'), en_word_abierto: { type: 'boolean', description: 'escribirlo en el Word que está abierto' } }, required: ['tema'] },
      async run(a) {
        const r = await D.redactar({ tema: a.tema, tipo: a.tipo, extension: a.extension, instrucciones: a.instrucciones, texto: a.texto, enAbierto: !!a.en_word_abierto });
        if (!r.ok) return r;
        return { ok: true, datos: `${r.insertado ? 'Lo escribí en tu Word abierto' : 'Creé y abrí'} «${r.titulo}» (${r.palabras} palabras${r.fuentes.length ? ', ' + r.fuentes.length + ' fuentes' : ''}${r.conIA ? '' : ', sin IA: con lo que encontré'}). Archivo: ${r.ruta}${r.motivo && !r.insertado ? ' (no pude escribir en tu Word: ' + r.motivo + ')' : ''}` };
      } },
    { name: 'crear_documento', riesgo: 'accion',
      description: 'Crea un documento de Word con el contenido que TÚ escribes (Markdown: # título, ## secciones, - viñetas, 1. listas, **negrita**, tablas |a|b|) y lo abre.',
      inputSchema: { type: 'object', properties: { titulo: S('título'), contenido: S('texto en Markdown sencillo') }, required: ['titulo', 'contenido'] },
      async run(a) { const r = D.crear({ titulo: a.titulo, contenido: a.contenido }); return { ok: true, datos: `Creé y abrí «${r.titulo}»: ${r.ruta}` }; } },
    { name: 'documento_nuevo', riesgo: 'accion', description: 'Crea un documento de Word EN BLANCO (con nombre) y lo abre.',
      inputSchema: { type: 'object', properties: { titulo: S('título opcional') } },
      async run(a) { const r = D.nuevo({ titulo: a.titulo }); return { ok: true, datos: `Abrí un documento nuevo: ${r.ruta}` }; } },
    { name: 'leer_documento', riesgo: 'leer', description: 'Lee el texto de un documento (.docx, .txt, .md). Sin ruta: el último que creé.',
      inputSchema: { type: 'object', properties: { ruta: S('ruta del archivo (opcional)') } },
      async run(a) { return { ok: true, datos: corto(D.leer(a.ruta), 12000) }; } },
    { name: 'mis_documentos', riesgo: 'leer', description: 'Lista los últimos documentos creados por mí (Documentos\\Noviq Documentos).',
      inputSchema: { type: 'object', properties: {} },
      async run() { const l = D.recientes(10); return { ok: true, datos: l.length ? l.map((x) => `- ${x.nombre}`).join('\n') : 'Todavía no he creado documentos.' }; } }
  ];
  return {
    id: 'documentos', nombre: 'Documentos (Word)', bot: 'Crea, redacta y lee documentos de Word', interno: true,
    herramientas: () => T.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, riesgo: t.riesgo })),
    riesgoDeLlamada(n) { const t = T.find((x) => x.name === n); return { riesgo: (t && t.riesgo) || 'accion' }; },
    async llamar(n, args) {
      const t = T.find((x) => x.name === n);
      if (!t) return { ok: false, error: 'no existe la herramienta «' + n + '»' };
      try { return await t.run(args || {}); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
    }
  };
}

module.exports = { Documentos, servidorDocumentos, TIPOS, nombreSeguro };
