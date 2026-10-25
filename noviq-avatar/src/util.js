'use strict';
/* ==========================================================================
   Noviq Avatar — Utilidades de texto, tiempo, JSON y parecido de frases
   (sin dependencias de Electron: se prueban con Node puro)
   ========================================================================== */
const crypto = require('crypto');

const ahora = () => Date.now() / 1000;   // segundos (igual que la memoria que venía de Noviq)

function norm(t) {
  return String(t == null ? '' : t).toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}_\s]/gu, ' ').replace(/\s+/g, ' ').trim();
}
function sinAcentos(t) { return String(t == null ? '' : t).normalize('NFD').replace(/[̀-ͯ]/g, ''); }
function corto(t, n) {
  n = n || 80;
  t = String(t == null ? '' : t).replace(/\s+/g, ' ').trim();
  return t.length <= n ? t : t.slice(0, n - 1).trimEnd() + '…';
}
const uid = (n) => crypto.randomBytes(Math.ceil((n || 8) / 2)).toString('hex').slice(0, n || 8);
const elegir = (lista) => lista[Math.floor(Math.random() * lista.length)];
const limitar = (v, a, b) => Math.min(b, Math.max(a, v));

/* ---------------------------------------------------------- Fechas en español */
const DIAS = ['lunes', 'martes', 'miércoles', 'jueves', 'viernes', 'sábado', 'domingo'];
const MESES = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const diaSemana = (d) => (d.getDay() + 6) % 7;   // lunes = 0 (como Python)
function horaTxt(d) {
  d = d || new Date();
  const h = d.getHours() % 12 || 12;
  const franja = d.getHours() < 12 ? 'mañana' : d.getHours() < 19 ? 'tarde' : 'noche';
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} de la ${franja}`;
}
function fechaTxt(d) { d = d || new Date(); return `${DIAS[diaSemana(d)]} ${d.getDate()} de ${MESES[d.getMonth()]}`; }
function mismoDia(a, b) { return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate(); }
function cuandoTxt(ts) {
  const d = new Date(ts * 1000), hoy = new Date(), man = new Date(); man.setDate(man.getDate() + 1);
  const dia = mismoDia(d, hoy) ? 'hoy' : mismoDia(d, man) ? 'mañana' : `el ${fechaTxt(d)}`;
  return `${dia} a las ${horaTxt(d)}`;
}

/* ------------------------------------------------- Secretos y errores copiados */
const RX_SECRETO = /(nvapi-|sk-[A-Za-z0-9_-]{12,}|gsk_[A-Za-z0-9]{12,}|ghp_|github_pat_|xox[abpr]-|AKIA[0-9A-Z]{16}|AIza[0-9A-Za-z_-]{20,}|-----BEGIN [A-Z ]*PRIVATE KEY|\b(?:\d[ -]?){13,19}\b|contrase[nñ]a\s*[:=]|password\s*[:=])/i;
const RX_ERROR = /(Traceback \(most recent call last\)|\b\w*(Error|Exception)\b[:\s]|error\s+[A-Z]{1,4}\d{3,5}|npm ERR!|\bfailed\b|\bfallo\b|\berror:|at .+\(.+:\d+:\d+\)|SyntaxError|undefined is not)/i;
function esSecreto(t) {
  t = String(t == null ? '' : t);
  if (RX_SECRETO.test(t)) return true;
  const s = t.trim();
  return s.length >= 8 && s.length <= 64 && !/\s/.test(s) && /[A-Z]/.test(s) && /[a-z]/.test(s) && /\d/.test(s) && /[^\w]/.test(s);
}

/* ------------------------------------------- Parecido de frases (como difflib) */
function bloques(a, b, alo, ahi, blo, bhi, out) {
  // subcadena común más larga en a[alo:ahi] y b[blo:bhi] (Ratcliff/Obershelp)
  let mejorI = alo, mejorJ = blo, mejorN = 0;
  let previo = new Map();
  for (let i = alo; i < ahi; i++) {
    const actual = new Map();
    for (let j = blo; j < bhi; j++) {
      if (a[i] !== b[j]) continue;
      const k = (previo.get(j - 1) || 0) + 1;
      actual.set(j, k);
      if (k > mejorN) { mejorI = i - k + 1; mejorJ = j - k + 1; mejorN = k; }
    }
    previo = actual;
  }
  if (!mejorN) return;
  out.n += mejorN;
  if (alo < mejorI && blo < mejorJ) bloques(a, b, alo, mejorI, blo, mejorJ, out);
  if (mejorI + mejorN < ahi && mejorJ + mejorN < bhi) bloques(a, b, mejorI + mejorN, ahi, mejorJ + mejorN, bhi, out);
}
function parecido(a, b) {
  a = String(a || ''); b = String(b || '');
  if (!a.length && !b.length) return 1;
  const out = { n: 0 };
  bloques(a, b, 0, a.length, 0, b.length, out);
  return (2 * out.n) / (a.length + b.length);
}
function masParecido(q, lista, corte) {
  let mejor = null, pm = 0;
  for (const x of lista) { const p = parecido(q, x); if (p > pm) { pm = p; mejor = x; } }
  return pm >= (corte == null ? 0.6 : corte) ? mejor : null;
}

/* ------------------------------------------------------ Respuestas de una IA */
function limpiarIA(t) {
  t = String(t || '').replace(/<think(ing)?>[\s\S]*?(<\/think(ing)?>|$)/g, '').trim();
  const m = t.match(/^```[\w-]*\n([\s\S]*?)\n?```$/);
  return (m ? m[1] : t).trim();
}
function jsonLaxo(s) {
  try { return JSON.parse(s); } catch (_) { /* sigue */ }
  try { return JSON.parse(s.replace(/,\s*([}\]])/g, '$1').replace(/[“”]/g, '"')); } catch (_) { return undefined; }
}
/** Primer objeto JSON dentro de una respuesta (con o sin ```json). */
function jsonDe(texto) {
  const t = limpiarIA(texto);
  const d = jsonLaxo(t);
  if (d && typeof d === 'object') return d;
  let i = t.indexOf('{');
  while (i >= 0) {
    let prof = 0, enCadena = false, esc = false;
    for (let j = i; j < t.length; j++) {
      const c = t[j];
      if (enCadena) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') enCadena = false; continue; }
      if (c === '"') enCadena = true;
      else if (c === '{') prof++;
      else if (c === '}') {
        prof--;
        if (prof === 0) { const v = jsonLaxo(t.slice(i, j + 1)); if (v && typeof v === 'object') return v; break; }
      }
    }
    i = t.indexOf('{', i + 1);
  }
  return null;
}

/** Quita markdown para hablarlo en voz alta. */
function textoHablado(t) {
  return String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`([^`]*)`/g, '$1').replace(/\*\*?|__|#+\s*/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1').replace(/^\s*[-*•]\s+/gm, '').replace(/https?:\/\/\S+/g, 'el enlace').replace(/\s+/g, ' ').trim();
}

module.exports = {
  ahora, norm, sinAcentos, corto, uid, elegir, limitar, DIAS, MESES, diaSemana, horaTxt, fechaTxt, cuandoTxt, mismoDia,
  RX_SECRETO, RX_ERROR, esSecreto, parecido, masParecido, limpiarIA, jsonDe, textoHablado
};
