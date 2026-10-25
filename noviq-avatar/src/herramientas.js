'use strict';
/* ==========================================================================
   Noviq Avatar — Herramientas PROPIAS del avatar (funcionan sin Noviq)
   + las de Noviq cuando está conectado. La mente las usa cuando la IA lo
   decide ({"accion":"herramienta","herramienta":{"nombre":…,"args":{…}}}).
   Nada de comandos libres en el PC: abrir solo webs, carpetas conocidas,
   programas del menú Inicio o apps conocidas.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { norm, corto, masParecido, esSecreto } = require('./util');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/143.0.0.0 Safari/537.36';
const SITIOS = { youtube: 'https://www.youtube.com', google: 'https://www.google.com', gmail: 'https://mail.google.com', facebook: 'https://www.facebook.com',
  instagram: 'https://www.instagram.com', 'whatsapp web': 'https://web.whatsapp.com', github: 'https://github.com', chatgpt: 'https://chatgpt.com',
  claude: 'https://claude.ai', netflix: 'https://www.netflix.com', 'spotify web': 'https://open.spotify.com', maps: 'https://maps.google.com',
  'google maps': 'https://maps.google.com', 'nvidia build': 'https://build.nvidia.com', drive: 'https://drive.google.com', 'google drive': 'https://drive.google.com',
  'outlook web': 'https://outlook.live.com', traductor: 'https://translate.google.com', 'google traductor': 'https://translate.google.com',
  wikipedia: 'https://es.wikipedia.org', 'mercado libre': 'https://www.mercadolibre.com.ec', tiktok: 'https://www.tiktok.com', x: 'https://x.com', twitter: 'https://x.com' };
const CARPETAS = { escritorio: 'desktop', documentos: 'documents', 'mis documentos': 'documents', descargas: 'downloads', imagenes: 'pictures',
  fotos: 'pictures', videos: 'videos', musica: 'music', 'carpeta personal': 'home', 'mi carpeta': 'home' };
const APPS = { 'bloc de notas': 'notepad', notepad: 'notepad', calculadora: 'calc', paint: 'mspaint', explorador: 'explorer', 'explorador de archivos': 'explorer',
  configuracion: 'ms-settings:', 'configuracion de windows': 'ms-settings:', 'administrador de tareas': 'taskmgr', 'panel de control': 'control',
  'configuracion de sonido': 'ms-settings:sound', 'configuracion del sonido': 'ms-settings:sound', 'configuracion de audio': 'ms-settings:sound',
  'configuracion del microfono': 'ms-settings:sound', 'configuracion de pantalla': 'ms-settings:display', 'configuracion de wifi': 'ms-settings:network-wifi',
  'configuracion de bluetooth': 'ms-settings:bluetooth', 'windows update': 'ms-settings:windowsupdate', 'aplicaciones instaladas': 'ms-settings:appsfeatures',
  terminal: 'wt', 'simbolo del sistema': 'cmd', cmd: 'cmd', powershell: 'powershell', word: 'winword', excel: 'excel', powerpoint: 'powerpnt',
  outlook: 'outlook', chrome: 'chrome', 'google chrome': 'chrome', edge: 'msedge', 'microsoft edge': 'msedge', navegador: 'msedge', firefox: 'firefox',
  spotify: 'spotify:', discord: 'discord:', steam: 'steam:', 'visual studio code': 'code', 'vs code': 'code', vscode: 'code', whatsapp: 'whatsapp:',
  telegram: 'tg:', camara: 'microsoft.windows.camera:', reloj: 'ms-clock:', alarmas: 'ms-clock:', calendario: 'outlookcal:', correo: 'outlookmail:',
  tienda: 'ms-windows-store:', 'recortes': 'ms-screenclip:', 'herramienta de recortes': 'ms-screenclip:' };

/* ------------------------------------------------------------ Calculadora */
function calcular(expr) {
  const s = String(expr || '').replace(/,/g, '.').replace(/×/g, '*').replace(/÷/g, '/').replace(/\s+/g, '');
  let i = 0;
  const F = { sqrt: Math.sqrt, raiz: Math.sqrt, sin: Math.sin, cos: Math.cos, tan: Math.tan, log: Math.log10, ln: Math.log, abs: Math.abs, round: Math.round, exp: Math.exp };
  const C = { pi: Math.PI, e: Math.E };
  const ver = () => s[i];
  function primario() {
    if (ver() === '(') { i++; const v = suma(); if (ver() !== ')') throw new Error('falta )'); i++; return v; }
    if (ver() === '-') { i++; return -primario(); }
    if (ver() === '+') { i++; return primario(); }
    const m = s.slice(i).match(/^(\d+(\.\d+)?|\.\d+)/);
    if (m) { i += m[0].length; let v = Number(m[0]); if (ver() === '%') { i++; v /= 100; } return v; }
    const w = s.slice(i).match(/^[a-z]+/i);
    if (w) {
      i += w[0].length; const k = w[0].toLowerCase();
      if (C[k] != null) return C[k];
      if (F[k]) { if (ver() !== '(') throw new Error('falta ( tras ' + k); return F[k](primario()); }
      throw new Error('no conozco «' + k + '»');
    }
    throw new Error('expresión inválida');
  }
  function potencia() { const b = primario(); if (ver() === '^' || s.slice(i, i + 2) === '**') { i += ver() === '^' ? 1 : 2; return Math.pow(b, potencia()); } return b; }
  function producto() { let v = potencia(); while (ver() === '*' || ver() === '/') { const o = s[i++]; const d = potencia(); v = o === '*' ? v * d : v / d; } return v; }
  function suma() { let v = producto(); while (ver() === '+' || ver() === '-') { const o = s[i++]; const d = producto(); v = o === '+' ? v + d : v - d; } return v; }
  const v = suma();
  if (i < s.length) throw new Error('sobra «' + s.slice(i) + '»');
  if (!isFinite(v)) throw new Error('resultado no válido');
  return Math.round(v * 1e10) / 1e10;
}

/* --------------------------------------------------------- Internet */
function urlSegura(u) {
  let x;
  try { x = new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u); } catch (_) { return null; }
  if (!/^https?:$/.test(x.protocol)) return null;
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.|172\.(1[6-9]|2\d|3[01])\.|0\.|\[?::1\]?$)/i.test(x.hostname)) return null;
  return x.toString();
}
const entidades = (t) => t.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#39;|&#x27;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
const sinEtiquetas = (h) => entidades(String(h || '').replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();

async function buscarInternet(consulta) {
  const r = await fetch('https://html.duckduckgo.com/html/', { method: 'POST', headers: { 'User-Agent': UA, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ q: consulta, kl: 'wt-wt' }).toString(), signal: AbortSignal.timeout(12000) });
  const html = await r.text();
  const out = [];
  const rx = /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>([\s\S]*?)(?=<a[^>]+class="result__a"|$)/g;
  let m;
  while ((m = rx.exec(html)) && out.length < 8) {
    let href = m[1];
    const q = href.match(/uddg=([^&]+)/);
    if (q) href = decodeURIComponent(q[1]);
    const snip = m[3].match(/class="result__snippet"[^>]*>([\s\S]*?)<\/a>/);
    out.push({ titulo: sinEtiquetas(m[2]), url: href, resumen: sinEtiquetas(snip ? snip[1] : '') });
  }
  if (out.length) return out;
  const b = await fetch('https://www.bing.com/search?q=' + encodeURIComponent(consulta), { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(12000) });
  const hb = await b.text();
  const rb = /<li class="b_algo"[\s\S]*?<h2><a href="([^"]+)"[^>]*>([\s\S]*?)<\/a><\/h2>[\s\S]*?(?:<p[^>]*>([\s\S]*?)<\/p>)?/g;
  while ((m = rb.exec(hb)) && out.length < 8) out.push({ titulo: sinEtiquetas(m[2]), url: m[1], resumen: sinEtiquetas(m[3] || '') });
  return out;
}
async function leerPagina(url) {
  const u = urlSegura(url);
  if (!u) throw new Error('dirección no permitida');
  const r = await fetch(u, { headers: { 'User-Agent': UA, 'Accept-Language': 'es,en;q=0.8' }, signal: AbortSignal.timeout(15000), redirect: 'follow' });
  const tipo = r.headers.get('content-type') || '';
  let t = await r.text();
  if (/html/.test(tipo)) t = sinEtiquetas(t.replace(/<(script|style|noscript|svg|nav|footer|header)[\s\S]*?<\/\1>/gi, ' ').replace(/<\/(p|div|h\d|li|tr|br)>/gi, '\n'));
  return corto(t, 6000);
}

/* ------------------------------------------------------- Abrir cosas */
function lanzar(objetivo) {
  if (process.platform === 'win32') {
    const o = String(objetivo).replace(/["&|<>^%]/g, '');
    const p = spawn('cmd.exe', ['/d', '/s', '/c', `"start "" "${o}""`], { detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: true });
    p.on('error', () => {});
    p.unref();
    return;
  }
  const p = spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [objetivo], { detached: true, stdio: 'ignore' });
  p.on('error', () => {});
  p.unref();
}
let accesos = null, tAccesos = 0;
function accesosInicio() {
  if (accesos && Date.now() - tAccesos < 10 * 60000) return accesos;
  const raices = [process.env.APPDATA && path.join(process.env.APPDATA, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    process.env.ProgramData && path.join(process.env.ProgramData, 'Microsoft', 'Windows', 'Start Menu', 'Programs'),
    path.join(os.homedir(), 'Desktop')].filter(Boolean);
  const out = [];
  const recorrer = (d, prof) => {
    let es = [];
    try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
    for (const e of es) {
      const p = path.join(d, e.name);
      if (e.isDirectory() && prof < 3) recorrer(p, prof + 1);
      else if (/\.(lnk|url|appref-ms)$/i.test(e.name) && !/(uninstall|desinstalar|readme|léeme|help|ayuda)/i.test(e.name)) out.push({ n: norm(e.name.replace(/\.[^.]+$/, '')), ruta: p });
    }
  };
  raices.forEach((r) => recorrer(r, 0));
  accesos = out; tAccesos = Date.now();
  return out;
}

/** «youtube», «descargas», «el bloc de notas», «lm studio», «noticias.com» → abre y devuelve el texto a decir, o null.
 *  op.sinAccesos: solo webs, carpetas conocidas y apps de siempre (el resto lo busca el localizador, que es más completo). */
function abrir(que, ctx, op) {
  op = op || {};
  const o = norm(que).replace(/^(la pagina de |la web de |el programa |la aplicacion |la app |la carpeta (de )?|el |la |los |las |mi |mis )/, '').trim();
  if (!o) return null;
  const dicho = String(que).trim();
  if (SITIOS[o]) { ctx.abrirURL(SITIOS[o]); return `Abro ${dicho}.`; }
  const dom = o.replace(/ punto /g, '.').replace(/\s+/g, '');
  if (/^[\w.-]+\.(com|net|org|ec|io|ai|dev|app|edu|gob\.ec|es|mx|co)(\/.*)?$/.test(dom)) { ctx.abrirURL('https://' + dom); return `Abro ${dicho}.`; }
  if (CARPETAS[o] && ctx.carpeta) { const p = ctx.carpeta(CARPETAS[o]); if (p) { ctx.abrirRuta(p); return `Abro ${dicho}.`; } }
  if (/^(el )?proyecto /.test(o)) return null;
  if (APPS[o]) { (ctx.lanzarApp || lanzar)(APPS[o]); return `Abro ${dicho}.`; }
  if (process.platform === 'win32' && !op.sinAccesos) {
    const lista = accesosInicio();
    const exacto = lista.find((a) => a.n === o) || lista.find((a) => a.n.startsWith(o + ' ') || a.n.endsWith(' ' + o));
    const nombre = exacto ? exacto.n : masParecido(o, lista.map((a) => a.n), 0.72);
    const a = exacto || (nombre && lista.find((x) => x.n === nombre));
    if (a) { ctx.abrirRuta(a.ruta); return `Abro ${dicho}.`; }
  }
  return null;
}

/* ------------------------------------------------------------ Registro */
/** Herramientas propias. ctx: {aj, memoria, noviq, abrirURL, abrirRuta, carpeta, leerClip, escribirClip} */
const PROPIAS = {
  buscar_internet: { desc: 'busca información ACTUAL en internet (noticias, precios, clima, resultados, personas, datos que cambian)', args: '{"consulta":"…"}', permiso: 'internet', info: true,
    async ejecutar(a) { const r = await buscarInternet(String(a.consulta || a.q || '').slice(0, 200)); return { ok: true, datos: r.length ? r : 'sin resultados' }; } },
  leer_pagina: { desc: 'lee el texto de una página web (para resumirla o responder con ella)', args: '{"url":"https://…"}', permiso: 'internet', info: true,
    async ejecutar(a) { return { ok: true, datos: await leerPagina(String(a.url || '')) }; } },
  abrir: { desc: 'abre al instante una web, una carpeta, un programa, un acceso del escritorio, un archivo o un proyecto por su nombre', args: '{"que":"youtube | descargas | bloc de notas | Hub UI | …"}', permiso: 'abrir',
    async ejecutar(a, ctx) {
      const que = String(a.que || a.objetivo || '');
      if (ctx.rapido) { const r = await ctx.rapido.abrir(que, { desdeBot: true }); if (r && r.ok !== false && r.accion !== 'delegar') return { ok: true, decir: r.respuesta }; }
      const t = abrir(que, ctx); return t ? { ok: true, decir: t } : { ok: false, error: 'no encontré «' + corto(que, 40) + '» para abrirlo' };
    } },
  orden_pc: { desc: 'hace AL INSTANTE una orden sencilla del PC: abrir/cerrar programas, archivos, carpetas o proyectos, ejecutar un proyecto o juego, apagar/reiniciar/suspender/bloquear (o cancelar el apagado), volumen, minimizar todo, captura de pantalla, buscar un archivo',
    args: '{"orden":"abre Hub UI | cierra chrome | apaga la pc | sube el volumen | ejecuta el juego X | busca el pdf factura"}', permiso: 'abrir',
    async ejecutar(a, ctx) {
      if (!ctx.rapido) return { ok: false, error: 'la vía rápida no está activa' };
      const r = await ctx.rapido.ejecutarTexto(String(a.orden || ''));
      if (!r.ok && r.delegar && ctx.agentes) { const l = await ctx.agentes.lanzar({ bot: r.delegar.bot, orden: r.delegar.orden, origen: 'ia' }); if (l.ok) return { ok: true, decir: 'Se lo pasé a mi ' + l.trabajo.botNombre.replace(/^Bot/, 'bot') + '; te aviso al terminar.' }; }
      return r.ok ? { ok: true, decir: r.decir } : { ok: false, error: r.error };
    } },
  buscar_en_navegador: { desc: 'abre el navegador con una búsqueda de Google o YouTube para que el usuario la vea', args: '{"consulta":"…","sitio":"google|youtube"}', permiso: 'abrir',
    async ejecutar(a, ctx) {
      const q = encodeURIComponent(String(a.consulta || '').slice(0, 200));
      ctx.abrirURL(/youtube/i.test(a.sitio || '') ? 'https://www.youtube.com/results?search_query=' + q : 'https://www.google.com/search?q=' + q);
      return { ok: true, decir: 'Te lo busco en el navegador.' };
    } },
  portapapeles_leer: { desc: 'lee el texto que el usuario copió (las claves y contraseñas nunca se leen)', args: '{}', permiso: 'portapapeles', info: true,
    async ejecutar(a, ctx) { const t = await ctx.leerClip(); if (!t.trim()) return { ok: true, datos: '(el portapapeles está vacío)' }; return esSecreto(t) ? { ok: true, datos: '(es una clave o contraseña: no se lee)' } : { ok: true, datos: corto(t, 4000) }; } },
  portapapeles_escribir: { desc: 'copia un texto al portapapeles para que el usuario lo pegue', args: '{"texto":"…"}', permiso: 'portapapeles',
    async ejecutar(a, ctx) { ctx.escribirClip(String(a.texto || '')); return { ok: true, decir: 'Listo, ya está copiado.' }; } },
  recordatorios: { desc: 'lista los recordatorios pendientes del usuario', args: '{}', permiso: 'recordatorios', info: true,
    async ejecutar(a, ctx) { const { cuandoTxt } = require('./util'); const l = ctx.memoria.recordatoriosPendientes().slice(0, 10); return { ok: true, datos: l.length ? l.map((r) => `${cuandoTxt(r.cuando)}: ${r.texto}`).join('\n') : 'ninguno' }; } },
  borrar_recordatorio: { desc: 'borra un recordatorio', args: '{"que":"texto del recordatorio"}', permiso: 'recordatorios',
    async ejecutar(a, ctx) { const n = ctx.memoria.borrarRecordatorio(String(a.que || '')); return n ? { ok: true, decir: 'Listo, lo borré.' } : { ok: false, error: 'no encontré ese recordatorio' }; } },
  ver: { desc: 'mira por la cámara conectada (o la pantalla) y responde una pregunta sobre lo que ve', args: '{"pregunta":"…","fuente":"camara|pantalla"}', info: true,
    async ejecutar(a, ctx) { if (!ctx.vision) return { ok: false, error: 'no tengo ojos en este modo' }; const r = await ctx.vision.mirar(String(a.pregunta || 'Describe lo que ves.'), { fuente: a.fuente === 'pantalla' ? 'pantalla' : 'camara' }); return r.ok ? { ok: true, datos: r.datos } : { ok: false, error: r.error }; } },
  calcular: { desc: 'calcula una expresión matemática exacta', args: '{"expresion":"(25*4)/3 + sqrt(16)"}', info: true,
    async ejecutar(a) { return { ok: true, datos: String(calcular(a.expresion || a.expr || '')) }; } },
  clima: { desc: 'clima actual y pronóstico de una ciudad (dia: 0 hoy, 1 mañana)', args: '{"lugar":"Quito","dia":0}', permiso: 'internet', info: true,
    async ejecutar(a, ctx) {
      const lugar = String(a.lugar || a.ciudad || (ctx.memoria && ctx.memoria.m.usuario.datos && ctx.memoria.m.usuario.datos.ciudad) || '').trim();
      if (!lugar) return { ok: false, error: 'falta la ciudad' };
      const r = await require('./saberes').clima(lugar, a.dia);
      return r.ok ? { ok: true, datos: r.texto, decir: r.texto } : { ok: false, error: r.error };
    } },
  wikipedia: { desc: 'resumen de Wikipedia sobre una persona, lugar, cosa o concepto', args: '{"tema":"Simón Bolívar"}', permiso: 'internet', info: true,
    async ejecutar(a) { const r = await require('./saberes').wikipedia(String(a.tema || a.consulta || '')); return r.ok ? { ok: true, datos: r.texto } : { ok: false, error: r.error }; } },
  noticias: { desc: 'titulares de noticias de hoy (opcional: de un tema)', args: '{"tema":""}', permiso: 'internet', info: true,
    async ejecutar(a) { const r = await require('./saberes').noticias(String(a.tema || '').trim()); return r.ok ? { ok: true, datos: r.titulos.join('\n') } : { ok: false, error: r.error }; } },
  convertir: { desc: 'convierte unidades (km, millas, libras, °C…) o monedas (dólares, euros, pesos…) con la tasa de hoy', args: '{"cantidad":10,"de":"dólares","a":"euros"}', info: true,
    async ejecutar(a) {
      const S = require('./saberes');
      const c = Number(String(a.cantidad).replace(',', '.'));
      if (!isFinite(c)) return { ok: false, error: 'falta la cantidad' };
      const u = S.convertir(c, String(a.de || ''), String(a.a || ''));
      if (u) return { ok: true, datos: u.texto };
      if (S.moneda(a.de) && S.moneda(a.a)) { const r = await S.divisas(c, a.de, a.a); return r.ok ? { ok: true, datos: r.texto } : { ok: false, error: r.error }; }
      return { ok: false, error: 'no sé convertir esas unidades' };
    } }
};

class Herramientas {
  constructor(ctx) { this.ctx = ctx; }

  propiasActivas() {
    const h = this.ctx.aj.datos.herramientas;
    return Object.entries(PROPIAS).filter(([, d]) => !d.permiso || h[d.permiso] !== false);
  }
  async deNoviq() {
    const n = this.ctx.noviq;
    if (!n || !n.conectado || !this.ctx.aj.datos.noviq.usar || !this.ctx.aj.datos.noviq.herramientas) return [];
    try { return await n.herramientas(); } catch (_) { return []; }
  }
  /** Texto para el prompt de la IA. */
  async descripcion() {
    const lineas = this.propiasActivas().map(([n, d]) => `- ${n} ${d.args}: ${d.desc}`);
    for (const t of await this.deNoviq()) lineas.push(`- ${t.nombre} ${t.args || '{}'}: ${t.desc} (de Noviq)`);
    return lineas.join('\n');
  }
  async lista() {
    return { propias: this.propiasActivas().map(([n, d]) => ({ nombre: n, desc: d.desc, args: d.args })), noviq: await this.deNoviq() };
  }
  async ejecutar(nombre, args) {
    nombre = String(nombre || '').trim();
    const propia = this.propiasActivas().find(([n]) => n === nombre);
    try {
      if (propia) { const r = await propia[1].ejecutar(args || {}, this.ctx); return Object.assign({ info: !!propia[1].info }, r); }
      const nv = (await this.deNoviq()).find((t) => t.nombre === nombre);
      if (nv) {
        const r = await this.ctx.noviq.usar(nombre, args || {});
        if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'Noviq no pudo' };
        return { ok: true, info: nv.info !== false, datos: r.resultado != null ? r.resultado : r.datos, decir: r.decir };
      }
      return { ok: false, error: 'no tengo la herramienta «' + nombre + '»' };
    } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 200) }; }
  }
}

module.exports = { Herramientas, PROPIAS, calcular, abrir, buscarInternet, leerPagina, urlSegura, SITIOS };
