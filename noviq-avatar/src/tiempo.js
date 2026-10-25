'use strict';
/* ==========================================================================
   Noviq Avatar — Entender cuándo («mañana a las 8», «en 20 minutos»,
   «los lunes y jueves a las 7», «cada 2 horas») y calcular la próxima vez.
   Formato de «cuando»:
     {tipo:'una_vez', fecha:'AAAA-MM-DDTHH:MM'} · {tipo:'intervalo', cada_min}
     {tipo:'diario', hora:'HH:MM'} · {tipo:'semanal', dias:[0..6 (lunes=0)], hora}
   ========================================================================== */
const { diaSemana } = require('./util');

const n = (t) => String(t || '').toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '');
const DIA_RX = { 0: 'lunes|lun\\b', 1: 'martes|mar\\b', 2: 'miercoles|mie\\b|mier\\b', 3: 'jueves|jue\\b', 4: 'viernes|vie\\b',
  5: 'sabados?|sab\\b', 6: 'domingos?|dom\\b' };
const MESES = { enero: 1, febrero: 2, marzo: 3, abril: 4, mayo: 5, junio: 6, julio: 7, agosto: 8, septiembre: 9, setiembre: 9,
  octubre: 10, noviembre: 11, diciembre: 12 };
const NUM = { un: 1, una: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9, diez: 10, once: 11,
  doce: 12, quince: 15, veinte: 20, treinta: 30, cuarenta: 40, 'cuarenta y cinco': 45 };
const p2 = (x) => String(x).padStart(2, '0');
const iso = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
const isoDia = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const masDias = (d, k) => { const x = new Date(d); x.setDate(x.getDate() + k); return x; };

function numeros(t) {   // «en cinco minutos» → «en 5 minutos»
  return t.replace(/\b(cuarenta y cinco|un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve|diez|once|doce|quince|veinte|treinta|cuarenta)\b(?=\s+(minutos?|min|horas?|h\b|dias?))/g, (m) => String(NUM[m]));
}

/** «a las 9», «9:30», «3 pm», «8 de la noche», «mediodía» → "HH:MM" o null. */
function hora(t) {
  if (/medio ?dia/.test(t)) return '12:00';
  if (/medianoche/.test(t)) return '00:00';
  const m = t.match(/\b(\d{1,2})(?::|h|\.)(\d{2})\s*(am|pm|a\.m\.|p\.m\.)?/) ||
    t.match(/\b(?:a las|a la|las|alas|at)\s+(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche|horas|hrs|h)?/) ||
    t.match(/\b(\d{1,2})()\s*(am|pm|a\.m\.|p\.m\.|de la manana|de la tarde|de la noche)\b/);
  if (!m) return null;
  let h = Number(m[1]); const mi = Number(m[2] || 0); const suf = m[3] || '';
  if (/^(pm|p\.m|de la tarde|de la noche)/.test(suf) && h < 12) h += 12;
  if (/^(am|a\.m)/.test(suf) && h === 12) h = 0;
  if (!/(am|pm|a\.m|p\.m|de la)/.test(suf) && /\b(de la|por la|en la) (tarde|noche)\b/.test(t) && h < 12) h += 12;
  if (h > 23 || mi > 59) return null;
  return `${p2(h)}:${p2(mi)}`;
}

function interpretar(texto, ahora) {
  let t = numeros(n(texto));
  ahora = ahora || new Date();
  const h = hora(t);
  let m = t.match(/cada\s+(\d+)\s*(minutos?|min|horas?|h)\b/) || t.match(/cada\s+(media hora|hora)\b/);
  if (m) {
    if (m[1] === 'media hora' || m[1] === 'hora') return { tipo: 'intervalo', cada_min: m[1] === 'media hora' ? 30 : 60 };
    const k = Number(m[1]);
    return { tipo: 'intervalo', cada_min: Math.max(5, /^h/.test(m[2]) ? k * 60 : k) };
  }
  const dias = new Set();
  if (/todos los dias|cada dia|diari[oa]|todas las (mananas|tardes|noches)|a diario|everyday|every day/.test(t)) for (let i = 0; i < 7; i++) dias.add(i);
  if (/entre semana|dias (laborables|habiles)|de lunes a viernes/.test(t)) for (let i = 0; i < 5; i++) dias.add(i);
  if (/fines? de semana/.test(t)) { dias.add(5); dias.add(6); }
  const r = t.match(/de\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)\s+a\s+(lunes|martes|miercoles|jueves|viernes|sabado|domingo)/);
  const idx = (w) => Number(Object.keys(DIA_RX).find((k) => new RegExp('^(' + DIA_RX[k] + ')').test(w)));
  if (r) {
    const a = idx(r[1]), b = idx(r[2]);
    if (a <= b) for (let i = a; i <= b; i++) dias.add(i); else { for (let i = a; i < 7; i++) dias.add(i); for (let i = 0; i <= b; i++) dias.add(i); }
  } else {
    for (const [k, rx] of Object.entries(DIA_RX)) if (new RegExp('\\b(' + rx + ')').test(t)) dias.add(Number(k));
  }
  const repetido = /\b(cada|todos|todas|los (lunes|martes|miercoles|jueves|viernes|sabados|domingos)|semanal|siempre)\b/.test(t) || dias.size > 1;
  let fecha = null;
  if (/\bpasado manana\b/.test(t)) fecha = masDias(ahora, 2);
  else if (/\bmanana\b/.test(t.replace(/(de|por|en) la manana|las mananas|cada manana/g, ' '))) fecha = masDias(ahora, 1);
  else if (/\bhoy\b|esta (tarde|noche|manana)/.test(t)) fecha = new Date(ahora);
  m = t.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (m) fecha = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  m = t.match(new RegExp('\\b(\\d{1,2})\\s+de\\s+(' + Object.keys(MESES).join('|') + ')(?:\\s+(?:de\\s+)?(\\d{4}))?'));
  if (m) {
    const y = Number(m[3] || ahora.getFullYear());
    let f = new Date(y, MESES[m[2]] - 1, Number(m[1]));
    if (f < new Date(ahora.getFullYear(), ahora.getMonth(), ahora.getDate()) && !m[3]) f = new Date(y + 1, MESES[m[2]] - 1, Number(m[1]));
    fecha = f;
  }
  m = t.match(/\ben\s+(\d+|media)\s*(minutos?|min|horas?|hora|dias?)\b/) || t.match(/\ben\s+(media) (hora)\b/);
  if (m && !dias.size) {
    const k = m[1] === 'media' ? 0.5 : Number(m[1]);
    const mins = /^h/.test(m[2]) ? k * 60 : /^d/.test(m[2]) ? k * 1440 : k;
    return { tipo: 'una_vez', fecha: iso(new Date(ahora.getTime() + mins * 60000)), exacto: ahora.getTime() / 1000 + mins * 60 };
  }
  if (fecha && !repetido) return { tipo: 'una_vez', fecha: `${isoDia(fecha)}T${h || '09:00'}` };
  if (dias.size) {
    if (!repetido && dias.size === 1) {   // «el jueves a las 5»: el próximo jueves, una vez
      const k = [...dias][0];
      const hh = h || '09:00';
      let d = masDias(ahora, (k - diaSemana(ahora) + 7) % 7);
      d.setHours(Number(hh.slice(0, 2)), Number(hh.slice(3)), 0, 0);
      if (d <= ahora) d = masDias(d, 7);
      return { tipo: 'una_vez', fecha: iso(d) };
    }
    const c = { tipo: dias.size < 7 ? 'semanal' : 'diario', hora: h || '08:00' };
    if (dias.size < 7) c.dias = [...dias].sort((a, b) => a - b);
    return c;
  }
  if (h && /\b(cada|todos|todas|diario)\b/.test(t)) return { tipo: 'diario', hora: h };
  if (h) {   // «a las 5»: hoy si no pasó, si no mañana
    const d = new Date(ahora); d.setHours(Number(h.slice(0, 2)), Number(h.slice(3)), 0, 0);
    return { tipo: 'una_vez', fecha: iso(d <= ahora ? masDias(d, 1) : d) };
  }
  return null;
}

/** Próxima vez (segundos epoch) o null. */
function proxima(cuando, despues) {
  const now = despues || new Date();
  const c = cuando || {};
  try {
    if (c.tipo === 'una_vez') {
      if (c.exacto) return c.exacto;
      const [f, hh] = String(c.fecha).split('T');
      const [y, mo, d] = f.split('-').map(Number);
      const [hr, mi] = (hh || '09:00').split(':').map(Number);
      return new Date(y, mo - 1, d, hr, mi, 0, 0).getTime() / 1000;
    }
    if (c.tipo === 'intervalo') return now.getTime() / 1000 + Math.max(5, Number(c.cada_min) || 60) * 60;
    if (c.tipo === 'diario' || c.tipo === 'semanal') {
      const [hr, mi] = String(c.hora || '08:00').split(':').map(Number);
      const dias = c.dias && c.dias.length ? c.dias : [0, 1, 2, 3, 4, 5, 6];
      for (let k = 0; k < 8; k++) {
        const d = masDias(now, k); d.setHours(hr, mi, 0, 0);
        if (d > now && dias.includes(diaSemana(d))) return d.getTime() / 1000;
      }
    }
  } catch (_) { return null; }
  return null;
}

function describir(c) {
  if (!c) return '';
  if (c.tipo === 'intervalo') return `cada ${c.cada_min} min`;
  const D = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
  if (c.tipo === 'diario') return `todos los días a las ${c.hora}`;
  if (c.tipo === 'semanal') return `${(c.dias || []).map((d) => D[d]).join(', ')} a las ${c.hora}`;
  return '';
}

/** Quita de la frase las palabras de tiempo: «recuérdame mañana a las 8 llamar a Ana» → «llamar a Ana». */
function quitarTiempo(texto) {
  return String(texto || '').replace(/\b(hoy|ma[nñ]ana|pasado ma[nñ]ana|en (\d+|un|una|media|dos|tres|cinco|diez|quince|veinte|treinta) (minutos?|horas?|hora|d[ií]as?)|a las? \d{1,2}(:\d{2})?( ?(am|pm))?|(de|por) la (ma[nñ]ana|tarde|noche)|el (lunes|martes|mi[eé]rcoles|jueves|viernes|s[aá]bado|domingo)|cada (d[ií]a|lunes|martes|mi[eé]rcoles|jueves|viernes|semana|\d+ (minutos?|horas?))|todos los d[ií]as)\b/gi, '')
    .replace(/\s+/g, ' ').replace(/^[\s,.]+|[\s,.]+$/g, '');
}

module.exports = { interpretar, proxima, describir, quitarTiempo, hora };
