'use strict';
/* ==========================================================================
   Noviq Avatar — 🔎 Localizador: qué hay en el PC para ABRIR al instante
   Índice local (sin IA, sin internet) de:
     · programas del menú Inicio y apps de la Tienda (Get-StartApps)
     · lo que tienes en el ESCRITORIO de verdad (también el de OneDrive y el
       Escritorio público): accesos directos, programas, archivos y carpetas
     · tus proyectos de Noviq (Documentos\Noviq_Proyectos y los externos)
   Busca por nombre aproximado («hub ui» → «HubUI»), con pistas de tipo
   («el programa…», «la carpeta…», «el archivo…», «el proyecto…»).
   El índice se guarda en la carpeta del avatar y se renueva solo.
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { norm, parecido } = require('./util');

const WIN = process.platform === 'win32';
const VIGENCIA_MS = 30 * 60000;           // se reconstruye en segundo plano pasados 30 min
const REINTENTO_MS = 45000;                // si no encuentra algo y el índice tiene más de esto, lo rehace una vez
const LANZABLE = /\.(lnk|url|appref-ms|exe|bat|cmd)$/i;
const IGNORAR = /(^|\b)(uninstall|desinstalar|unins\d*|readme|leeme|léeme|license|licencia|help|ayuda|release notes|changelog|documentation|documentacion|website|sitio web)(\b|$)/i;
const DIR_PESADO = /^(node_modules|\.git|\.venv|venv|__pycache__|\$recycle\.bin|dist|build|\.cache|\.next|target|bin|obj|appdata)$/i;
const VACIAS = new Set(['el', 'la', 'los', 'las', 'de', 'del', 'un', 'una', 'mi', 'mis', 'y', 'para', 'en', 'al', 'a', 'que', 'esta', 'este']);

/* ----------------------------------------------------- Texto de búsqueda */
/** Quita lo que no es el nombre: «un programa que está en el escritorio Hub UI» → {q:'hub ui', pista:'app', lugar:'escritorio'} */
function limpiarConsulta(texto) {
  let t = norm(texto);
  let pista = null, lugar = null, editor = null;
  if (/\b(en|con) (el )?(vs ?code|visual studio code|code|vscode|editor)\b/.test(t)) { editor = 'vscode'; t = t.replace(/\b(en|con) (el )?(vs ?code|visual studio code|vscode|code|editor)\b/, ' '); }
  if (/\b(en|con) (el )?(explorador|explorador de archivos)\b/.test(t)) { editor = 'explorador'; t = t.replace(/\b(en|con) (el )?(explorador de archivos|explorador)\b/, ' '); }
  if (/\b(escritorio|desktop)\b/.test(t)) lugar = 'escritorio';
  if (/\b(descargas)\b/.test(t) && !/^(la )?(carpeta (de )?)?descargas$/.test(t)) lugar = 'descargas';
  t = t.replace(/\b(que (esta|tengo|hay|aparece|sale)|esta|que se llama|llamad[oa]|de nombre|con el nombre( de)?)\b/g, ' ')
    .replace(/\b(en|de|del|desde) (el |mi |la )?(escritorio|desktop|menu (de )?inicio|inicio|pc|computadora|compu|equipo)\b/g, ' ')
    .replace(/\b(escritorio)\b/g, ' ');
  const tipos = [
    [/\b(el |un |una |la |mi )?(programa|aplicacion|app|aplicativo|software|ejecutable|acceso directo)( de| del)?\b/, 'app'],
    [/\b(el |un |una |la |mi )?(juego|videojuego)( de| del)?\b/, 'juego'],
    [/\b(el |un |la |mi )?(proyecto)( de| del)?\b/, 'proyecto'],
    [/\b(la |una |mi )?(carpeta|directorio)( de| del)?\b/, 'carpeta'],
    [/\b(el |un |una |la |mi )?(archivo|documento|fichero|pdf|excel|word|hoja de calculo|presentacion|foto|imagen|video|cancion)( de| del)?\b/, 'archivo'],
    [/\b(la |una )?(pagina|pagina web|web|sitio|sitio web)( de| del)?\b/, 'web']
  ];
  let quitada = '';
  for (const [rx, p] of tipos) { const g = t.match(rx); if (g) { pista = pista || p; if (p === 'archivo') quitada = g[2]; t = t.replace(rx, ' '); } }
  t = t.replace(/\s+/g, ' ').trim().replace(/^((el|la|los|las|un|una|mi|mis|ese|esa|este|esta)\s+)+/, '').replace(/\s+(por favor|porfa|ahora|ya)$/, '').trim();
  // «abre Word» / «abre Microsoft Word» / «el Excel»: «word» y «excel» son el PROGRAMA, no una pista de archivo
  // (antes quedaba «microsoft» y abría Microsoft Edge)
  if ((quitada === 'word' || quitada === 'excel') && !distintivas(t).length) { t = (t + ' ' + quitada).trim(); pista = 'app'; }
  return { q: t, pista, lugar, editor };
}

const compacto = (t) => norm(t).replace(/\s+/g, '');
function nombreVisible(archivo) {
  return String(archivo).replace(/\.(lnk|url|appref-ms|exe|bat|cmd)$/i, '').replace(/\s*-\s*(acceso directo|shortcut)$/i, '').replace(/\s*\((x64|x86|64-bit|32-bit)\)$/i, '').trim();
}
function palabras(t) { return norm(t).split(' ').filter((w) => w && !VACIAS.has(w)); }
// Palabras que comparten muchos programas: no bastan para decir que «Microsoft Word» es «Microsoft Edge»
const GENERICAS = new Set(['microsoft', 'google', 'windows', 'office', 'app', 'apps', 'aplicacion', 'programa', '365', 'online', 'web', 'desktop', 'pro', 'the',
  'adobe', 'studio', 'center', 'centro', 'herramienta', 'herramientas', 'para', 'nuevo', 'nueva']);
const distintivas = (t) => palabras(t).filter((w) => !GENERICAS.has(w));

/** 0..1: qué tanto se parece la consulta al nombre de una entrada. */
function puntuar(q, e) {
  const qn = norm(q), qc = qn.replace(/\s+/g, '');
  if (!qc) return 0;
  if (e.n === qn || e.c === qc) return 1;
  let s = 0;
  if (qc.length >= 3 && e.c.startsWith(qc)) s = Math.max(s, 0.9 + 0.05 * (qc.length / e.c.length));
  if (qc.length >= 4 && e.c.includes(qc)) s = Math.max(s, 0.84 + 0.08 * (qc.length / e.c.length));
  const qw = palabras(qn), ew = palabras(e.n);
  if (qw.length && ew.length) {
    let hit = 0;
    for (const w of qw) {
      if (ew.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (w.length >= 5 && x.length >= 5 && parecido(w, x) >= 0.8))) hit++;
      else if (w.length >= 3 && e.c.includes(w)) hit += 0.8;
    }
    const cob = hit / qw.length;
    if (cob >= 1) s = Math.max(s, 0.86 + 0.09 * Math.min(1, qw.length / ew.length));
    else if (cob >= 0.66 && qw.length >= 3) s = Math.max(s, 0.7 + 0.1 * cob);
  }
  const p = parecido(qc, e.c);
  s = Math.max(s, p * (qc.length >= 5 ? 0.95 : 0.85));
  // lo que distingue a la consulta («word» en «microsoft word») tiene que estar en el nombre
  const qd = distintivas(qn), ed = distintivas(e.n);
  const esta = (w) => ed.some((x) => x === w || (w.length >= 3 && x.startsWith(w)) || (x.length >= 3 && w.startsWith(x)) ||
      (w.length >= 5 && x.length >= 5 && parecido(w, x) >= 0.8)) || (w.length >= 3 && e.c.includes(w));
  if (qd.length && qd.every(esta)) {
    // «microsoft word» → «Word»: todas las palabras que importan están (las genéricas sobran)
    const extra = ed.filter((x) => !qd.some((w) => x === w || x.startsWith(w) || w.startsWith(x))).length;
    s = Math.max(s, extra ? 0.8 : 0.93);
  } else if (s < 1 && qd.length) s = Math.min(s, 0.55);
  return Math.min(1, s);
}

const PREFERENCIA = { app: 0.04, uwp: 0.04, acceso: 0.035, proyecto: 0.02, carpeta: 0.01, archivo: 0 };
function ajustePorPista(e, pista, lugar) {
  let a = PREFERENCIA[e.tipo] || 0;
  if (pista === 'app' && (e.tipo === 'app' || e.tipo === 'uwp' || e.tipo === 'acceso')) a += 0.05;
  if (pista === 'app' && (e.tipo === 'archivo' || e.tipo === 'carpeta')) a -= 0.06;
  if (pista === 'carpeta') a += e.tipo === 'carpeta' || e.tipo === 'proyecto' ? 0.08 : -0.08;
  if (pista === 'archivo') a += e.tipo === 'archivo' ? 0.08 : -0.04;
  if (pista === 'proyecto') a += e.tipo === 'proyecto' ? 0.12 : -0.08;
  if (pista === 'juego') a += e.tipo === 'proyecto' || e.tipo === 'app' || e.tipo === 'acceso' || e.tipo === 'uwp' ? 0.04 : -0.04;
  if (lugar && e.fuente === lugar) a += 0.06;
  return a;
}

/* ===================================================================== */
class Localizador {
  /**
   * op: {dir, ejecutarPS(script, ms), log, rutaNoviq, carpeta(k), raices: {inicio:[], escritorio:[], documentos:[], proyectos:[]} (pruebas),
   *      sinSistema: true para no llamar a PowerShell (pruebas)}
   */
  constructor(op) {
    op = op || {};
    this.dir = op.dir || null; this.ps = op.ejecutarPS || null; this.log = op.log || (() => {});
    this.rutaNoviq = op.rutaNoviq || path.join(__dirname, '..', '..');
    this.carpeta = op.carpeta || (() => null);
    this.raicesFijas = op.raices || null; this.sinSistema = !!op.sinSistema || (!WIN && !op.ejecutarPS);
    this.idx = null; this.t = 0; this.construyendo = null; this.sistema = null;
    this.rutaCache = this.dir ? path.join(this.dir, 'indice_abrir.json') : null;
    this.cargarCache();
  }

  cargarCache() {
    if (!this.rutaCache) return;
    try {
      const c = JSON.parse(fs.readFileSync(this.rutaCache, 'utf8'));
      if (c && Array.isArray(c.entradas) && c.v === 2) { this.idx = c.entradas; this.t = c.t || 0; this.sistema = c.sistema || null; }
    } catch (_) { /* sin caché */ }
  }
  guardarCache() {
    if (!this.rutaCache || !this.idx) return;
    try { fs.mkdirSync(this.dir, { recursive: true }); fs.writeFileSync(this.rutaCache, JSON.stringify({ v: 2, t: this.t, sistema: this.sistema, entradas: this.idx })); } catch (_) { /* sin disco */ }
  }

  /* ----------------------------------------------- Carpetas del sistema */
  /** Una sola llamada a PowerShell: escritorios reales (OneDrive incluido), menú Inicio, Documentos y apps (Get-StartApps). */
  async descubrirSistema() {
    if (this.sinSistema || !this.ps) return null;
    const script = "$o=[ordered]@{};$o.escritorio=@([Environment]::GetFolderPath('Desktop'),[Environment]::GetFolderPath('CommonDesktopDirectory'));" +
      "$o.inicio=@([Environment]::GetFolderPath('StartMenu'),[Environment]::GetFolderPath('CommonStartMenu'));" +
      "$o.documentos=@([Environment]::GetFolderPath('MyDocuments'));$o.perfil=$env:USERPROFILE;" +
      "try{$o.apps=@(Get-StartApps | Select-Object Name,AppID)}catch{$o.apps=@()};$o | ConvertTo-Json -Depth 3 -Compress";
    const arr = (v) => (Array.isArray(v) ? v : v ? [v] : []).filter(Boolean);
    let r = null;
    try {
      r = await this.ps(script, 25000);
      const txt = String(r.salida || '').trim();
      if (txt.indexOf('{') < 0) throw new Error('Windows no devolvió nada' + (r.codigo != null ? ` (código ${r.codigo})` : '') + (r.error ? ': ' + String(r.error).slice(0, 160) : ''));
      const j = JSON.parse(txt.slice(txt.indexOf('{')));
      return { escritorio: arr(j.escritorio), inicio: arr(j.inicio), documentos: arr(j.documentos), perfil: j.perfil || '', apps: arr(j.apps).filter((a) => a && a.Name && a.AppID) };
    } catch (e) {
      this.log('localizador: no pude preguntar a Windows: ' + e.message);
      // plan B: solo las apps, en texto simple (una por línea) — las carpetas las saco yo de las variables de Windows
      try {
        const r2 = await this.ps("Get-StartApps | ForEach-Object { $_.Name + [char]9 + $_.AppID }", 25000);
        const apps = String(r2.salida || '').split(/\r?\n/).map((l) => l.split('\t')).filter((x) => x.length === 2 && x[0].trim() && x[1].trim()).map(([Name, AppID]) => ({ Name: Name.trim(), AppID: AppID.trim() }));
        if (apps.length) { this.log(`localizador: plan B, ${apps.length} apps de Windows`); return { escritorio: [], inicio: [], documentos: [], perfil: '', apps }; }
      } catch (_) { /* sin apps de la Tienda */ }
      return null;
    }
  }

  raices(sis) {
    if (this.raicesFijas) return Object.assign({ inicio: [], escritorio: [], documentos: [], proyectos: [] }, this.raicesFijas);
    const h = os.homedir();
    const env = process.env;
    const uniq = (l) => [...new Set(l.filter(Boolean).map((p) => path.resolve(p)))].filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } });
    const escritorio = uniq([...(sis ? sis.escritorio : []), path.join(h, 'Desktop'), path.join(h, 'Escritorio'), path.join(h, 'OneDrive', 'Desktop'), path.join(h, 'OneDrive', 'Escritorio'),
      env.PUBLIC && path.join(env.PUBLIC, 'Desktop'), this.carpeta('desktop')]);
    const inicio = uniq([...(sis ? sis.inicio : []), env.APPDATA && path.join(env.APPDATA, 'Microsoft', 'Windows', 'Start Menu'), env.ProgramData && path.join(env.ProgramData, 'Microsoft', 'Windows', 'Start Menu')]);
    const documentos = uniq([...(sis ? sis.documentos : []), this.carpeta('documents'), path.join(h, 'Documents'), path.join(h, 'OneDrive', 'Documents'), path.join(h, 'OneDrive', 'Documentos')]);
    return { inicio, escritorio, documentos, proyectos: this.raicesProyectos(documentos) };
  }

  /** Carpetas de proyectos de Noviq: su ajuste projects_dir, Documentos\Noviq_Proyectos y los proyectos externos. */
  raicesProyectos(documentos) {
    const out = [], externos = {};
    let cfg = null;
    try { cfg = JSON.parse(fs.readFileSync(path.join(this.rutaNoviq, 'datos', 'config.json'), 'utf8')); } catch (_) { cfg = null; }
    if (cfg && String(cfg.projects_dir || '').trim()) out.push(String(cfg.projects_dir).trim().replace(/%([^%]+)%/g, (_, k) => process.env[k] || ''));
    for (const d of documentos || []) out.push(path.join(d, 'Noviq_Proyectos'));
    if (cfg && cfg.proyectos_externos && typeof cfg.proyectos_externos === 'object') {
      for (const [n, v] of Object.entries(cfg.proyectos_externos)) { const r = typeof v === 'string' ? v : v && (v.ruta || v.path); if (r) externos[n] = r; }
    }
    const raices = [...new Set(out.map((p) => path.resolve(p)))].filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } });
    return raices.concat(Object.entries(externos).map(([n, r]) => ({ nombre: n, ruta: r })));
  }

  /* ---------------------------------------------------------- Índice */
  async construir() {
    const t0 = Date.now();
    const sis = await this.descubrirSistema();
    if (sis) this.sistema = { escritorio: sis.escritorio, inicio: sis.inicio, documentos: sis.documentos, perfil: sis.perfil };
    const R = this.raices(sis || this.sistema);
    const E = [], vistos = new Set();
    const poner = (e) => {
      const nombre = e.nombre.trim();
      if (!nombre || IGNORAR.test(nombre)) return;
      const clave = e.tipo + '|' + (e.ruta || e.appId).toLowerCase();
      if (vistos.has(clave)) return;
      vistos.add(clave);
      E.push(Object.assign(e, { nombre, n: norm(nombre), c: compacto(nombre) }));
    };
    let visitados = 0;
    const recorrer = (d, prof, max, fn) => {
      if (visitados > 60000 || prof > max) return;
      let es = [];
      try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of es) { visitados++; fn(d, e, prof); }
    };
    // menú Inicio (accesos)
    for (const r of R.inicio) {
      const rec = (d, prof) => recorrer(d, prof, 5, (dd, e) => {
        const p = path.join(dd, e.name);
        if (e.isDirectory()) rec(p, prof + 1);
        else if (/\.(lnk|url|appref-ms)$/i.test(e.name)) poner({ nombre: nombreVisible(e.name), tipo: 'acceso', ruta: p, fuente: 'inicio' });
      });
      rec(r, 0);
    }
    // apps de Windows (Tienda y escritorio) con su AppID: se abren con shell:AppsFolder\<AppID>
    for (const a of (sis && sis.apps) || []) poner({ nombre: String(a.Name), tipo: 'uwp', appId: String(a.AppID), fuente: 'apps' });
    // escritorios: TODO lo que hay (accesos, programas, archivos, carpetas) y los programas dentro de sus carpetas
    for (const r of R.escritorio) {
      recorrer(r, 0, 0, (dd, e) => {
        const p = path.join(dd, e.name);
        if (/^desktop\.ini$/i.test(e.name) || e.name.startsWith('~$')) return;
        if (e.isDirectory()) {
          poner({ nombre: e.name, tipo: 'carpeta', ruta: p, fuente: 'escritorio' });
          recorrer(p, 1, 1, (d2, e2) => { if (!e2.isDirectory() && LANZABLE.test(e2.name)) poner({ nombre: nombreVisible(e2.name), tipo: /\.exe$/i.test(e2.name) ? 'app' : 'acceso', ruta: path.join(d2, e2.name), fuente: 'escritorio' }); });
        } else poner({ nombre: nombreVisible(e.name), tipo: LANZABLE.test(e.name) ? (/\.exe$/i.test(e.name) ? 'app' : 'acceso') : 'archivo', ruta: p, fuente: 'escritorio', ext: path.extname(e.name).toLowerCase() });
      });
    }
    // proyectos de Noviq
    for (const r of R.proyectos) {
      if (typeof r === 'object') { poner({ nombre: r.nombre, tipo: 'proyecto', ruta: r.ruta, fuente: 'proyectos', id: r.nombre }); continue; }
      recorrer(r, 0, 0, (dd, e) => { if (e.isDirectory() && !/^[._]/.test(e.name)) poner({ nombre: e.name.replace(/_/g, ' '), tipo: 'proyecto', ruta: path.join(dd, e.name), fuente: 'proyectos', id: e.name }); });
    }
    this.idx = E; this.t = Date.now();
    this.raicesUsadas = R;
    this.guardarCache();
    this.log(`localizador: ${E.length} cosas para abrir (${Date.now() - t0} ms)`);
    return E;
  }

  /** Índice listo (usa la caché y la renueva en segundo plano si es vieja). */
  async indice(forzar) {
    if (this.construyendo) return this.construyendo;
    const viejo = !this.idx || Date.now() - this.t > VIGENCIA_MS;
    if (!forzar && this.idx && !viejo) return this.idx;
    const p = this.construir().catch((e) => { this.log('localizador: ' + e.message); return this.idx || []; }).finally(() => { this.construyendo = null; });
    this.construyendo = p;
    if (!forzar && this.idx) return this.idx;   // caché vieja: responde ya y se renueva detrás
    return p;
  }
  /** Para arrancar sin esperar (lo llama el avatar al iniciar). */
  precalentar() { return this.indice().catch(() => null); }

  /**
   * Busca «qué abrir». texto: lo que dijiste (se limpia solo). op: {tipos:[…], pista, lugar}
   * → {mejor, puntaje, candidatos:[{…, puntaje}], consulta}
   */
  async buscar(texto, op) {
    op = op || {};
    const lim = limpiarConsulta(texto);
    const q = lim.q, pista = op.pista || lim.pista, lugar = op.lugar || lim.lugar;
    if (!q) return { mejor: null, puntaje: 0, candidatos: [], consulta: lim };
    // orden por puntaje SIN tope (un nombre exacto + pistas gana a uno que solo empieza igual); el puntaje que se muestra sí va de 0 a 1
    const evaluar = (lista) => lista.filter((e) => !op.tipos || op.tipos.includes(e.tipo))
      .map((e) => { const base = puntuar(q, e); const orden = base + (base >= 0.6 ? ajustePorPista(e, pista, lugar) : 0) + (base >= 1 ? 0.1 : 0); return Object.assign({}, e, { orden, puntaje: Math.min(1, orden) }); })
      .filter((e) => e.puntaje >= 0.6).sort((a, b) => b.orden - a.orden);
    let c = evaluar(await this.indice());
    if ((!c.length || c[0].puntaje < 0.8) && Date.now() - this.t > REINTENTO_MS) c = evaluar(await this.indice(true));   // ¿algo nuevo? rehace el índice una vez
    const mejor = c[0] && c[0].puntaje >= (op.corte || 0.74) ? c[0] : null;
    return { mejor, puntaje: mejor ? mejor.puntaje : (c[0] ? c[0].puntaje : 0), candidatos: c.slice(0, 5), consulta: Object.assign(lim, { pista, lugar }) };
  }

  /** Proyectos (para el bot de proyectos y «abre/ejecuta el proyecto X»). */
  // id = nombre real de la carpeta (el que usa Noviq, con «_»); nombre = cómo se dice
  async proyectos() { return (await this.indice()).filter((e) => e.tipo === 'proyecto').map((e) => ({ nombre: e.nombre, ruta: e.ruta, id: e.id || path.basename(e.ruta) })); }
  async proyecto(nombre) {
    const r = await this.buscar(nombre, { tipos: ['proyecto'], corte: 0.66 });
    return r.mejor ? { nombre: r.mejor.nombre, ruta: r.mejor.ruta, id: r.mejor.id || path.basename(r.mejor.ruta) } : null;
  }
  /** Carpetas donde buscar archivos del usuario (escritorios, documentos, descargas, imágenes…). */
  carpetasUsuario() {
    const R = this.raicesUsadas || this.raices(this.sistema);
    const h = os.homedir();
    const extra = ['downloads', 'pictures', 'videos', 'music'].map((k) => this.carpeta(k)).concat([path.join(h, 'Downloads'), path.join(h, 'Descargas'), path.join(h, 'OneDrive')]);
    return [...new Set([...R.escritorio, ...R.documentos, ...extra].filter(Boolean).map((p) => path.resolve(p)))]
      .filter((p) => { try { return fs.statSync(p).isDirectory(); } catch (_) { return false; } });
  }
}

/* ------------------------------------------------- Buscar archivos por nombre */
const EXT_PISTA = { pdf: ['.pdf'], excel: ['.xlsx', '.xls', '.csv', '.xlsm'], 'hoja de calculo': ['.xlsx', '.xls', '.csv', '.ods'], word: ['.docx', '.doc', '.odt', '.rtf'],
  documento: ['.docx', '.doc', '.pdf', '.txt', '.odt', '.rtf', '.md'], foto: ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.gif'], imagen: ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.bmp', '.svg'],
  video: ['.mp4', '.mkv', '.avi', '.mov', '.webm'], cancion: ['.mp3', '.wav', '.m4a', '.flac', '.ogg'], musica: ['.mp3', '.wav', '.m4a', '.flac', '.ogg'],
  presentacion: ['.pptx', '.ppt', '.odp'], powerpoint: ['.pptx', '.ppt'], zip: ['.zip', '.rar', '.7z'], texto: ['.txt', '.md'] };
/**
 * Busca archivos y carpetas por nombre en las carpetas dadas (rápido: con límite de tiempo y de entradas).
 * → [{nombre, ruta, carpeta, tipo:'archivo'|'carpeta', puntaje, mtime}]
 */
function buscarArchivos(consulta, carpetas, op) {
  op = op || {};
  const t0 = Date.now(), maxMs = op.maxMs || 3500, maxEntradas = op.maxEntradas || 50000;
  let q = norm(consulta);
  let exts = null;
  for (const [k, v] of Object.entries(EXT_PISTA)) if (new RegExp('\\b' + k + '\\b').test(q)) { exts = v; q = q.replace(new RegExp('\\b(un |una |el |la |mi )?' + k + 's?\\b'), ' ').trim(); break; }
  const m = q.match(/\b(\w{2,4})$/);
  const extDicha = m && /^(pdf|txt|docx?|xlsx?|csv|pptx?|png|jpe?g|mp3|mp4|zip|exe|bat|py|js|html|json)$/.test(m[1]) ? '.' + m[1] : null;
  if (extDicha) { exts = [extDicha]; q = q.replace(/\s*\b\w{2,4}$/, '').trim(); }
  q = q.replace(/^((el|la|los|las|un|una|mi|mis)\s+)+/, '').trim();
  const qw = palabras(q);
  if (!qw.length && !exts) return [];
  const out = [];
  let vistos = 0;
  const visitar = (d, prof) => {
    if (prof > (op.profundidad || 5) || vistos > maxEntradas || Date.now() - t0 > maxMs) return;
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of es) {
      vistos++;
      if (e.name.startsWith('.') || e.name.startsWith('~$') || /^desktop\.ini$/i.test(e.name)) continue;
      const dir = e.isDirectory();
      const ext = dir ? '' : path.extname(e.name).toLowerCase();
      const base = norm(dir ? e.name : e.name.slice(0, e.name.length - ext.length));
      if ((!exts || exts.includes(ext)) && (op.soloCarpetas ? dir : true)) {
        let p = 0;
        if (!qw.length) p = 0.75;
        else {
          const hit = qw.filter((w) => base.includes(w) || (w.length >= 5 && base.split(' ').some((x) => x.length >= 5 && parecido(w, x) >= 0.8))).length;
          p = hit === qw.length ? 0.8 + 0.2 * (q.replace(/\s+/g, '').length / Math.max(1, base.replace(/\s+/g, '').length)) : 0;
        }
        if (p >= 0.75) { let mt = 0; try { mt = fs.statSync(path.join(d, e.name)).mtimeMs; } catch (_) { /* sin acceso */ } out.push({ nombre: e.name, ruta: path.join(d, e.name), carpeta: d, tipo: dir ? 'carpeta' : 'archivo', puntaje: Math.min(1, p), mtime: mt }); }
      }
      if (dir && !DIR_PESADO.test(e.name)) visitar(path.join(d, e.name), prof + 1);
    }
  };
  for (const c of carpetas) visitar(c, 0);
  const vistosRuta = new Set();
  return out.filter((x) => (vistosRuta.has(x.ruta.toLowerCase()) ? false : vistosRuta.add(x.ruta.toLowerCase())))
    .sort((a, b) => (b.puntaje - a.puntaje) || (b.mtime - a.mtime)).slice(0, op.max || 8);
}

module.exports = { Localizador, limpiarConsulta, puntuar, buscarArchivos, nombreVisible, compacto, distintivas };
