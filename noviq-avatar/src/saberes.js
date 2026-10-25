'use strict';
/* ==========================================================================
   Noviq Avatar — Saberes SIN IA (autonomía cuando no hay ninguna IA):
   clima (Open-Meteo), Wikipedia, noticias (Google Noticias), divisas,
   conversiones, cálculos dichos en voz y días que faltan. Todo gratis y
   sin clave. La mente los usa como reflejos y la IA como herramientas.
   ========================================================================== */
const { norm, corto } = require('./util');
const T = require('./tiempo');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) NoviqAvatar/2.1';
const enc = encodeURIComponent;
async function pedir(url, ms, texto) {
  const r = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'es' }, signal: AbortSignal.timeout(ms || 9000) });
  if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; throw e; }
  return texto ? r.text() : r.json();
}
const num = (x, dec) => Number(x).toLocaleString('es', { maximumFractionDigits: dec == null ? 2 : dec });

/* ------------------------------------------------- Dónde está el usuario */
const ZONA_PAIS = {
  'America/Guayaquil': 'EC', 'Pacific/Galapagos': 'EC', 'America/Bogota': 'CO', 'America/Lima': 'PE', 'America/Mexico_City': 'MX', 'America/Monterrey': 'MX',
  'America/Cancun': 'MX', 'America/Tijuana': 'MX', 'America/Santiago': 'CL', 'America/Argentina/Buenos_Aires': 'AR', 'America/Buenos_Aires': 'AR',
  'America/Caracas': 'VE', 'America/La_Paz': 'BO', 'America/Asuncion': 'PY', 'America/Montevideo': 'UY', 'America/Panama': 'PA', 'America/Costa_Rica': 'CR',
  'America/Guatemala': 'GT', 'America/El_Salvador': 'SV', 'America/Tegucigalpa': 'HN', 'America/Managua': 'NI', 'America/Santo_Domingo': 'DO',
  'America/Havana': 'CU', 'America/Puerto_Rico': 'PR', 'Europe/Madrid': 'ES', 'Atlantic/Canary': 'ES', 'America/New_York': 'US', 'America/Chicago': 'US',
  'America/Denver': 'US', 'America/Los_Angeles': 'US', 'America/Sao_Paulo': 'BR'
};
const zona = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || ''; } catch (_) { return ''; } };
const paisLocal = () => ZONA_PAIS[zona()] || '';

/* ---------------------------------------------------------------- Clima */
const CLIMA = { 0: 'despejado', 1: 'mayormente despejado', 2: 'parcialmente nublado', 3: 'nublado', 45: 'con niebla', 48: 'con niebla', 51: 'con llovizna ligera',
  53: 'con llovizna', 55: 'con llovizna intensa', 56: 'con llovizna helada', 57: 'con llovizna helada', 61: 'con lluvia ligera', 63: 'lloviendo', 65: 'con lluvia fuerte',
  66: 'con lluvia helada', 67: 'con lluvia helada', 71: 'con nieve ligera', 73: 'nevando', 75: 'con nieve fuerte', 77: 'con granizo fino', 80: 'con chubascos ligeros',
  81: 'con chubascos', 82: 'con chubascos fuertes', 85: 'con chubascos de nieve', 86: 'con chubascos de nieve', 95: 'con tormenta', 96: 'con tormenta y granizo', 99: 'con tormenta y granizo' };

async function lugar(nombre) {
  const j = await pedir(`https://geocoding-api.open-meteo.com/v1/search?name=${enc(nombre)}&count=8&language=es&format=json`);
  const rs = j.results || [];
  if (!rs.length) return null;
  const z = zona(), pais = paisLocal();
  return rs.find((r) => r.timezone === z) || rs.find((r) => r.country_code === pais) || rs.slice().sort((a, b) => (b.population || 0) - (a.population || 0))[0];
}

/** dia: 0 hoy, 1 mañana, 2 pasado mañana */
async function clima(nombre, dia) {
  const L = await lugar(nombre);
  if (!L) return { ok: false, error: `No encontré «${nombre}».` };
  const j = await pedir(`https://api.open-meteo.com/v1/forecast?latitude=${L.latitude}&longitude=${L.longitude}` +
    '&current=temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,precipitation' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max&timezone=auto&forecast_days=3');
  const c = j.current || {}, d = j.daily || {};
  const i = Math.min(Number(dia) || 0, 2);
  const nombreL = L.name + (L.country_code && L.country_code !== paisLocal() && L.country ? ` (${L.country})` : '');
  const r = (x) => Math.round(Number(x));
  const lluvia = (k) => (d.precipitation_probability_max && d.precipitation_probability_max[k] != null ? `, ${d.precipitation_probability_max[k]}% de probabilidad de lluvia` : '');
  let texto;
  if (!i) {
    const sens = c.apparent_temperature != null && Math.abs(c.apparent_temperature - c.temperature_2m) >= 2 ? ` (se siente como ${r(c.apparent_temperature)})` : '';
    texto = `En ${nombreL} hay ${r(c.temperature_2m)} grados${sens} y está ${CLIMA[c.weather_code] || 'variable'}.` +
      (d.temperature_2m_max ? ` Hoy: máxima de ${r(d.temperature_2m_max[0])} y mínima de ${r(d.temperature_2m_min[0])}${lluvia(0)}.` : '');
  } else {
    texto = `${i === 1 ? 'Mañana' : 'Pasado mañana'} en ${nombreL}: ${CLIMA[d.weather_code[i]] || 'variable'}, entre ${r(d.temperature_2m_min[i])} y ${r(d.temperature_2m_max[i])} grados${lluvia(i)}.`;
  }
  return { ok: true, texto, lugar: nombreL, datos: { actual: c, diario: d } };
}

/* ------------------------------------------------------------ Wikipedia */
async function wikipedia(tema, idioma) {
  const w = `https://${idioma || 'es'}.wikipedia.org`;
  tema = String(tema || '').trim().replace(/[¿?¡!.]+$/g, '');
  if (!tema) return { ok: false, error: 'falta el tema' };
  let clave = null;
  for (const ruta of ['/w/rest.php/v1/search/title?limit=1&q=', '/w/rest.php/v1/search/page?limit=1&q=']) {
    try { const j = await pedir(w + ruta + enc(tema)); if (j.pages && j.pages[0]) { clave = j.pages[0].key; break; } } catch (_) { /* siguiente */ }
  }
  if (!clave) return { ok: false, error: `No encontré «${tema}» en Wikipedia.` };
  const s = await pedir(`${w}/api/rest_v1/page/summary/${enc(clave)}`);
  let ext = String(s.extract || '').replace(/\s*\([^)]*\)/g, '').replace(/\s+/g, ' ').trim();
  if (!ext || s.type === 'disambiguation') ext = s.description ? `${s.title}: ${s.description}.` : '';
  if (!ext) return { ok: false, error: `No encontré «${tema}» en Wikipedia.` };
  const frases = ext.match(/[^.!?]+[.!?]+/g) || [ext];
  let texto = '';
  for (const f of frases) { if ((texto + f).length > 330 && texto) break; texto += f; }
  return { ok: true, titulo: s.title, texto: texto.trim(), url: s.content_urls && s.content_urls.desktop && s.content_urls.desktop.page };
}

/* ------------------------------------------------------------- Noticias */
async function noticias(tema) {
  const pais = paisLocal() || 'US';
  const ceid = pais === 'ES' ? 'ES:es' : `${pais}:es-419`;
  const hl = pais === 'ES' ? 'es' : 'es-419';
  const url = tema ? `https://news.google.com/rss/search?q=${enc(tema)}&hl=${hl}&gl=${pais}&ceid=${ceid}` : `https://news.google.com/rss?hl=${hl}&gl=${pais}&ceid=${ceid}`;
  const xml = await pedir(url, 9000, true);
  const titulos = [];
  const rx = /<item>[\s\S]*?<title>([\s\S]*?)<\/title>/g;
  let m;
  while ((m = rx.exec(xml)) && titulos.length < 5) {
    const t = m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
      .replace(/\s+-\s+[^-]{2,60}$/, '').trim();
    if (t) titulos.push(t);
  }
  if (!titulos.length) return { ok: false, error: 'No conseguí noticias ahora.' };
  return { ok: true, titulos, texto: (tema ? `Sobre ${tema}: ` : 'Titulares de hoy: ') + titulos.slice(0, 3).map((t) => corto(t, 110)).join('. ') + '.' };
}

/* ------------------------------------------------------------- Divisas */
const MONEDAS = [[/^(dolar|dolares|usd|\$)( americanos?| estadounidenses?)?$/, 'USD'], [/^(euro|euros|eur|€)$/, 'EUR'], [/^pesos? mexicanos?$|^mxn$/, 'MXN'],
  [/^pesos? colombianos?$|^cop$/, 'COP'], [/^pesos? chilenos?$|^clp$/, 'CLP'], [/^pesos? argentinos?$|^ars$/, 'ARS'], [/^pesos? dominicanos?$|^dop$/, 'DOP'],
  [/^(soles?|soles peruanos?|pen)$/, 'PEN'], [/^(libras?( esterlinas?)?|gbp)$/, 'GBP'], [/^(yenes|yen|jpy)$/, 'JPY'], [/^(reales?|brl)$/, 'BRL'],
  [/^(quetzales?|gtq)$/, 'GTQ'], [/^(bolivianos?|bob)$/, 'BOB'], [/^(colones?|crc)$/, 'CRC'], [/^(yuanes?|yuan|cny)$/, 'CNY'], [/^(dolares? canadienses?|cad)$/, 'CAD'],
  [/^(francos? suizos?|chf)$/, 'CHF'], [/^(guaranies?|pyg)$/, 'PYG'], [/^(pesos? uruguayos?|uyu)$/, 'UYU']];
const moneda = (t) => { const x = MONEDAS.find(([rx]) => rx.test(norm(t))); return x ? x[1] : null; };
async function divisas(cant, de, a) {
  const D = moneda(de) || String(de).toUpperCase(), A = moneda(a) || String(a).toUpperCase();
  const j = await pedir(`https://open.er-api.com/v6/latest/${enc(D)}`);
  const tasa = j.rates && j.rates[A];
  if (!tasa) return { ok: false, error: 'No conozco esa moneda.' };
  const v = Number(cant) * tasa;
  return { ok: true, valor: v, texto: `${num(cant)} ${D} son unos ${num(v, v < 10 ? 4 : 2)} ${A} (tasa de hoy: ${num(tasa, 4)}).` };
}

/* --------------------------------------------------------- Conversiones */
const UNIDADES = {
  longitud: { kilometro: 1000, km: 1000, metro: 1, m: 1, centimetro: 0.01, cm: 0.01, milimetro: 0.001, mm: 0.001, milla: 1609.344, yarda: 0.9144, pie: 0.3048, pulgada: 0.0254 },
  masa: { tonelada: 1000, kilo: 1, kilogramo: 1, kg: 1, gramo: 0.001, g: 0.001, libra: 0.45359237, lb: 0.45359237, onza: 0.028349523 },
  volumen: { litro: 1, l: 1, mililitro: 0.001, ml: 0.001, galon: 3.785411784, taza: 0.24, cucharada: 0.015, 'metro cubico': 1000 },
  velocidad: { 'kilometro por hora': 1, 'km/h': 1, kmh: 1, 'milla por hora': 1.609344, mph: 1.609344, 'metro por segundo': 3.6, 'm/s': 3.6, nudo: 1.852 },
  tiempo: { segundo: 1, minuto: 60, hora: 3600, dia: 86400, semana: 604800, mes: 2629800, ano: 31557600 },
  datos: { byte: 1, kilobyte: 1024, kb: 1024, megabyte: 1048576, mb: 1048576, gigabyte: 1073741824, gb: 1073741824, terabyte: 1099511627776, tb: 1099511627776 },
  area: { 'metro cuadrado': 1, m2: 1, hectarea: 10000, 'kilometro cuadrado': 1e6, acre: 4046.8564224, 'pie cuadrado': 0.09290304 }
};
function singular(u) {
  return norm(u).replace(/^(un|una|unos|unas|los|las|el|la)\s+/, '').split(' ').map((w) => (w.length > 3 && /(on|or|ar|al)es$/.test(w) ? w.slice(0, -2) : w.length > 3 && /s$/.test(w) && !/(ss|us|is)$/.test(w) ? w.slice(0, -1) : w)).join(' ').replace(/\bpor\b/, 'por');
}
const TEMP = { celsius: 'C', centigrado: 'C', c: 'C', fahrenheit: 'F', f: 'F', kelvin: 'K', k: 'K' };
function unidad(u) {
  const s = singular(u).replace(/^grados? /, '').replace(/^grado$/, '');
  if (TEMP[s]) return { tipo: 'temperatura', k: TEMP[s] };
  for (const [tipo, tabla] of Object.entries(UNIDADES)) if (tabla[s] != null) return { tipo, k: s, f: tabla[s] };
  return null;
}
function convertir(cant, de, a) {
  const D = unidad(de), A = unidad(a);
  if (!D || !A || D.tipo !== A.tipo) return null;
  let v;
  if (D.tipo === 'temperatura') {
    const c = D.k === 'C' ? cant : D.k === 'F' ? (cant - 32) * 5 / 9 : cant - 273.15;
    v = A.k === 'C' ? c : A.k === 'F' ? c * 9 / 5 + 32 : c + 273.15;
  } else v = (cant * D.f) / A.f;
  return { valor: v, texto: `${num(cant)} ${de} son ${num(v, Math.abs(v) < 1 ? 4 : 2)} ${a}.` };
}

/* ------------------------------------------------- Números y cálculos por voz */
const UNI = { cero: 0, un: 1, uno: 1, una: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11, doce: 12, trece: 13,
  catorce: 14, quince: 15, dieciseis: 16, diecisiete: 17, dieciocho: 18, diecinueve: 19, veinte: 20, veintiuno: 21, veintiun: 21, veintidos: 22, veintitres: 23,
  veinticuatro: 24, veinticinco: 25, veintiseis: 26, veintisiete: 27, veintiocho: 28, veintinueve: 29, treinta: 30, cuarenta: 40, cincuenta: 50, sesenta: 60,
  setenta: 70, ochenta: 80, noventa: 90, cien: 100, ciento: 100, doscientos: 200, trescientos: 300, cuatrocientos: 400, quinientos: 500, seiscientos: 600,
  setecientos: 700, ochocientos: 800, novecientos: 900, mil: 1000, millon: 1e6, millones: 1e6 };
/** «veinticinco» → 25, «tres mil quinientos» → 3500 (en una frase normalizada). */
function numerosEnPalabras(t) {
  const pal = t.split(' ');
  const out = [];
  let acc = null, total = 0;
  const cerrar = () => { if (acc !== null || total) { out.push(String(total + (acc || 0))); acc = null; total = 0; } };
  for (let i = 0; i < pal.length; i++) {
    const w = pal[i];
    if (UNI[w] != null && !(w === 'un' || w === 'una') || ((w === 'un' || w === 'una') && UNI[pal[i + 1]] >= 1000)) {
      const v = UNI[w];
      if (v === 1000 || v === 1e6) { total += (acc || 1) * v; acc = null; if (v === 1e6) { /* noop */ } }
      else acc = (acc || 0) + v;
      continue;
    }
    if (w === 'y' && acc !== null && UNI[pal[i + 1]] != null && UNI[pal[i + 1]] < 10) continue;
    cerrar();
    out.push(w);
  }
  cerrar();
  return out.join(' ');
}
const RX_CALC = /^(?:cuanto es|cuanto son|cuanto da|cuanto seria|calcula(?:me)?|resuelve|dime cuanto es|hazme la cuenta de|cuanto)\s+(.+)$/;
/** «cuánto es 25 por 4» → {expr, valor, texto} o null */
function calculoDicho(texto) {
  let n = norm(String(texto).replace(/(\d),(\d)/g, '$1.$2').replace(/(\d)\.(\d{3})\b/g, '$1$2'));
  n = n.replace(/(\d) (\d)/g, '$1 $2');
  const m = n.match(RX_CALC);
  let e = m ? m[1] : n;
  if (!m && !/^[\d\s+\-*/^().x]+$/.test(e)) return null;
  // decimales que norm() partió: «2 5» de «2.5» → se reconstruyen desde el texto original
  const orig = String(texto).replace(/(\d),(\d)/g, '$1.$2');
  const decs = orig.match(/\d+\.\d+/g) || [];
  for (const d of decs) e = e.replace(d.replace('.', ' '), d);
  e = numerosEnPalabras(e.replace(/\bpor ?ciento\b/g, 'porciento'));
  e = e.replace(/\braiz cuadrada de\s+([\d.]+)/g, 'sqrt($1)').replace(/\braiz cubica de\s+([\d.]+)/g, '($1)^(1/3)')
    .replace(/([\d.]+)\s*(?:por ciento|porciento)\s+de\s+([\d.]+)/g, '($1/100*$2)')
    .replace(/\bel\s+([\d.]+)\s*(?:por ciento|porciento)\s+de\s+([\d.]+)/g, '($1/100*$2)')
    .replace(/\bal cuadrado\b/g, '^2').replace(/\bal cubo\b/g, '^3').replace(/\belevado (?:a la |al |a )?([\d.]+)/g, '^$1')
    .replace(/\bmultiplicado por\b|\bpor\b|\bx\b|\bveces\b/g, '*').replace(/\bdividido (?:entre|para|por)\b|\bentre\b|\bsobre\b/g, '/')
    .replace(/\bmas\b/g, '+').replace(/\bmenos\b/g, '-').replace(/\bmenos\b/g, '-')
    .replace(/\b(el|la|los|las|resultado de|de)\b/g, ' ').replace(/\s+/g, '');
  if (!/^[\d+\-*/^().sqrt]+$/.test(e) || !/\d/.test(e) || !/[+\-*/^]|sqrt/.test(e)) return null;
  try {
    const { calcular } = require('./herramientas');
    const v = calcular(e);
    return { expr: e, valor: v, texto: `${num(v, 6)}` };
  } catch (_) { return null; }
}

/* ------------------------------------------------------- Días que faltan */
const FECHAS = { navidad: '25 de diciembre', 'noche buena': '24 de diciembre', nochebuena: '24 de diciembre', 'ano nuevo': '1 de enero',
  'fin de ano': '31 de diciembre', 'san valentin': '14 de febrero', 'dia de la madre': '10 de mayo', halloween: '31 de octubre', 'dia de los difuntos': '2 de noviembre' };
function diasHasta(texto) {
  let t = norm(texto).replace(/^(cuantos dias|cuanto)\s+(faltan?|quedan?)\s+(para|hasta)\s+/, '').replace(/^(el|la)\s+/, '');
  for (const [k, v] of Object.entries(FECHAS)) if (t.includes(k)) t = v;
  const c = T.interpretar(t);
  if (!c || c.tipo !== 'una_vez') return null;
  const ts = T.proxima(c);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const d = new Date(ts * 1000); d.setHours(0, 0, 0, 0);
  const n = Math.round((d - hoy) / 86400000);
  return n < 0 ? null : { dias: n, texto: n === 0 ? '¡Es hoy!' : n === 1 ? 'Falta 1 día: es mañana.' : `Faltan ${n} días.` };
}

module.exports = { clima, lugar, wikipedia, noticias, divisas, moneda, convertir, unidad, calculoDicho, numerosEnPalabras, diasHasta, paisLocal, zona, ZONA_PAIS };
