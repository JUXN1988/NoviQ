'use strict';
/* ==========================================================================
   Noviq Avatar — 👂 ¿Quién habla? Separar TU voz de la TV, la radio y el ruido
   Sin dependencias ni internet. Tres piezas:
     1. analizar(wav)  → cómo suena el segmento: duración, nivel sobre el ruido
        (SNR), cuánto es voz, tono medio (F0) y una «huella» del timbre
        (coeficientes MFCC: lo que distingue una voz de otra y un micrófono
        cercano de unos parlantes lejanos).
     2. PerfilVoz      → aprende tu huella (cuando dices su nombre o le haces
        clic) y la del fondo (cuando le dices «eso fue la tele»). Se guarda en
        voz_perfil.json (solo números: no guarda audio).
     3. Ambiente       → nota si hay algo sonando todo el tiempo (TV encendida).
   La decisión final (¿me hablan a mí?) está en atencion.js.
   ========================================================================== */
const fs = require('fs');

const SR = 16000, VENT = 400, PASO = 160, NFFT = 512, NMEL = 26, NCEP = 13;

/* ------------------------------------------------------------------- WAV */
function leerWav(buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF') return null;
  let p = 12, sr = SR, bits = 16, canales = 1, datos = null;
  while (p + 8 <= buf.length) {
    const id = buf.toString('ascii', p, p + 4), tam = buf.readUInt32LE(p + 4);
    if (id === 'fmt ') { canales = buf.readUInt16LE(p + 10); sr = buf.readUInt32LE(p + 12); bits = buf.readUInt16LE(p + 22); }
    else if (id === 'data') { datos = buf.subarray(p + 8, Math.min(buf.length, p + 8 + tam)); break; }
    p += 8 + tam + (tam & 1);
  }
  if (!datos || bits !== 16) return null;
  const n = Math.floor(datos.length / 2 / canales), x = new Float32Array(n);
  for (let i = 0; i < n; i++) x[i] = datos.readInt16LE(i * 2 * canales) / 32768;
  return { x, sr };
}

/* ------------------------------------------------------------- FFT y MFCC */
const VENTANA = (() => { const w = new Float32Array(VENT); for (let i = 0; i < VENT; i++) w[i] = 0.54 - 0.46 * Math.cos((2 * Math.PI * i) / (VENT - 1)); return w; })();
const REV = (() => { const r = new Uint16Array(NFFT), b = Math.log2(NFFT); for (let i = 0; i < NFFT; i++) { let x = i, y = 0; for (let k = 0; k < b; k++) { y = (y << 1) | (x & 1); x >>= 1; } r[i] = y; } return r; })();
function fft(re, im) {
  for (let i = 0; i < NFFT; i++) { const j = REV[i]; if (j > i) { let t = re[i]; re[i] = re[j]; re[j] = t; t = im[i]; im[i] = im[j]; im[j] = t; } }
  for (let tam = 2; tam <= NFFT; tam <<= 1) {
    const mitad = tam >> 1, ang = (-2 * Math.PI) / tam;
    for (let i = 0; i < NFFT; i += tam) {
      for (let k = 0; k < mitad; k++) {
        const c = Math.cos(ang * k), s = Math.sin(ang * k);
        const a = i + k, b = a + mitad;
        const tr = re[b] * c - im[b] * s, ti = re[b] * s + im[b] * c;
        re[b] = re[a] - tr; im[b] = im[a] - ti; re[a] += tr; im[a] += ti;
      }
    }
  }
}
const mel = (f) => 2595 * Math.log10(1 + f / 700), hzDeMel = (m) => 700 * (10 ** (m / 2595) - 1);
const BANCO = (() => {
  const bins = NFFT / 2 + 1, lo = mel(80), hi = mel(7600), puntos = [];
  for (let i = 0; i < NMEL + 2; i++) puntos.push(Math.floor(((NFFT + 1) * hzDeMel(lo + ((hi - lo) * i) / (NMEL + 1))) / SR));
  const F = [];
  for (let m = 1; m <= NMEL; m++) {
    const f = new Float32Array(bins);
    for (let k = puntos[m - 1]; k < puntos[m]; k++) f[k] = (k - puntos[m - 1]) / Math.max(1, puntos[m] - puntos[m - 1]);
    for (let k = puntos[m]; k < puntos[m + 1]; k++) f[k] = (puntos[m + 1] - k) / Math.max(1, puntos[m + 1] - puntos[m]);
    F.push(f);
  }
  return F;
})();
const DCT = (() => { const D = []; for (let c = 0; c < NCEP; c++) { const r = new Float32Array(NMEL); for (let m = 0; m < NMEL; m++) r[m] = Math.cos((Math.PI * c * (m + 0.5)) / NMEL); D.push(r); } return D; })();

/** Tono (F0) de una ventana por autocorrelación normalizada; 0 si no hay tono claro. */
function tono(x, ini) {
  const minL = Math.floor(SR / 400), maxL = Math.floor(SR / 70), n = VENT;
  let e0 = 0; for (let i = 0; i < n; i++) e0 += x[ini + i] * x[ini + i];
  if (e0 <= 1e-6) return 0;
  let mejor = 0, lag = 0;
  for (let L = minL; L <= maxL; L++) {
    let s = 0, e1 = 0;
    for (let i = 0; i + L < n; i++) { s += x[ini + i] * x[ini + i + L]; e1 += x[ini + i + L] * x[ini + i + L]; }
    const r = s / Math.sqrt(e0 * e1 + 1e-12);
    if (r > mejor) { mejor = r; lag = L; }
  }
  return mejor > 0.5 && lag ? SR / lag : 0;
}

/**
 * Analiza un segmento. entrada: Buffer WAV o {x: Float32Array, sr}.
 * → {dur, rmsDb, snrDb, vozFrac, f0, f0var, huella: number[] (2*NCEP-2 + 1), frames}
 */
function analizar(entrada) {
  const w = Buffer.isBuffer(entrada) ? leerWav(entrada) : entrada;
  if (!w || !w.x || w.x.length < VENT * 4) return null;
  let x = w.x;
  if (w.sr && w.sr !== SR) {   // remuestreo simple
    const k = w.sr / SR, y = new Float32Array(Math.floor(x.length / k));
    for (let i = 0; i < y.length; i++) y[i] = x[Math.floor(i * k)];
    x = y;
  }
  const nFr = Math.floor((x.length - VENT) / PASO) + 1;
  const energia = new Float32Array(nFr);
  const re = new Float64Array(NFFT), im = new Float64Array(NFFT);
  const ceps = [];
  for (let f = 0; f < nFr; f++) {
    const ini = f * PASO;
    let e = 0;
    for (let i = 0; i < VENT; i++) e += x[ini + i] * x[ini + i];
    energia[f] = 10 * Math.log10(e / VENT + 1e-10);
  }
  const orden = Array.from(energia).sort((a, b) => a - b);
  const p10 = orden[Math.floor(nFr * 0.1)], p90 = orden[Math.floor(nFr * 0.9)];
  // sonido CONSTANTE (TV con música, un tramo sin pausas): p90-p10 < 6 dB → antes no quedaba ningún cuadro «con voz» y
  // no se podía aprender ni comparar; ahora se usa todo el tramo que no sea el 10 % más bajo
  const umbral = p90 - p10 < 6 ? p10 : Math.max(p10 + 6, p90 - 25);
  const f0s = [];
  let voz = 0;
  for (let f = 0; f < nFr; f++) {
    if (energia[f] < umbral) continue;
    voz++;
    const ini = f * PASO;
    re.fill(0); im.fill(0);
    let prev = ini > 0 ? x[ini - 1] : 0;
    for (let i = 0; i < VENT; i++) { const s = x[ini + i]; re[i] = (s - 0.97 * prev) * VENTANA[i]; prev = s; }
    fft(re, im);
    const pot = new Float64Array(NFFT / 2 + 1);
    for (let k = 0; k <= NFFT / 2; k++) pot[k] = (re[k] * re[k] + im[k] * im[k]) / NFFT;
    const logMel = new Float64Array(NMEL);
    for (let m = 0; m < NMEL; m++) { let s = 0; const F = BANCO[m]; for (let k = 0; k < F.length; k++) if (F[k]) s += F[k] * pot[k]; logMel[m] = Math.log(s + 1e-10); }
    const c = new Float64Array(NCEP);
    for (let j = 0; j < NCEP; j++) { let s = 0; for (let m = 0; m < NMEL; m++) s += logMel[m] * DCT[j][m]; c[j] = s; }
    ceps.push(c);
    if (f % 2 === 0) { const t = tono(x, ini); if (t) f0s.push(t); }
  }
  const dur = x.length / SR;
  const vozFrac = voz / nFr;
  if (ceps.length < 8) return { dur, rmsDb: p90, snrDb: p90 - p10, vozFrac, f0: 0, f0var: 0, huella: null, frames: nFr };
  // huella: media y desviación de c1..c12 (c0 = volumen, no sirve para saber QUIÉN habla) + log(F0)
  const media = new Array(NCEP - 1).fill(0), desv = new Array(NCEP - 1).fill(0);
  for (const c of ceps) for (let j = 1; j < NCEP; j++) media[j - 1] += c[j] / ceps.length;
  for (const c of ceps) for (let j = 1; j < NCEP; j++) desv[j - 1] += ((c[j] - media[j - 1]) ** 2) / ceps.length;
  for (let j = 0; j < desv.length; j++) desv[j] = Math.sqrt(desv[j]);
  f0s.sort((a, b) => a - b);
  const f0 = f0s.length >= 3 ? f0s[Math.floor(f0s.length / 2)] : 0;
  const f0var = f0s.length >= 3 ? (f0s[Math.floor(f0s.length * 0.9)] - f0s[Math.floor(f0s.length * 0.1)]) / Math.max(1, f0) : 0;
  const huella = media.concat(desv).concat([f0 ? Math.log(f0) * 4 : 0]).map((v) => +v.toFixed(4));
  return { dur: +dur.toFixed(2), rmsDb: +p90.toFixed(1), snrDb: +(p90 - p10).toFixed(1), vozFrac: +vozFrac.toFixed(2), f0: Math.round(f0), f0var: +f0var.toFixed(2), huella, frames: nFr };
}

/* ------------------------------------------------------------- Perfiles */
const MAX_N = 80;   // memoria «deslizante»: con muchas muestras, las nuevas pesan más (la voz y el cuarto cambian)
function nuevoModelo() { return { n: 0, media: null, var: null }; }
function sumar(mod, v, peso) {
  peso = peso || 1;
  if (!mod.media || mod.media.length !== v.length) { mod.media = v.slice(); mod.var = v.map(() => 0); mod.n = peso; return; }
  mod.n += peso;
  const a = Math.min(1, peso / Math.min(mod.n, MAX_N));
  for (let i = 0; i < v.length; i++) {
    const d = v[i] - mod.media[i];
    mod.media[i] += a * d;
    mod.var[i] = (1 - a) * (mod.var[i] + a * d * d);
  }
}
/** Distancia «normalizada» (Mahalanobis diagonal, con varianza mínima para no exagerar con pocas muestras). */
function distancia(mod, v, varBase) {
  if (!mod || !mod.media || mod.n < 1 || mod.media.length !== v.length) return null;
  let d = 0;
  for (let i = 0; i < v.length; i++) d += ((v[i] - mod.media[i]) ** 2) / Math.max(varBase[i], mod.var[i] || 0);
  return d / v.length;
}

class PerfilVoz {
  constructor(ruta) {
    this.ruta = ruta || null;
    this.d = { v: 1, usuario: nuevoModelo(), fondo: nuevoModelo(), global: nuevoModelo(), t: 0 };
    if (ruta) { try { const j = JSON.parse(fs.readFileSync(ruta, 'utf8')); if (j && j.v === 1) this.d = Object.assign(this.d, j); } catch (_) { /* nuevo */ } }
  }
  guardar() { if (!this.ruta) return; try { this.d.t = Date.now(); fs.writeFileSync(this.ruta, JSON.stringify(this.d)); } catch (_) { /* sin disco */ } }
  listo() { return this.d.usuario.n >= 4; }
  estado() { return { usuario: Math.round(this.d.usuario.n), fondo: Math.round(this.d.fondo.n), listo: this.listo() }; }
  olvidar(que) { if (!que || que === 'usuario') this.d.usuario = nuevoModelo(); if (!que || que === 'fondo') this.d.fondo = nuevoModelo(); this.guardar(); }
  /** tipo: 'usuario' | 'fondo'. Solo con segmentos de calidad (voz suficiente). */
  aprender(a, tipo, peso) {
    if (!a || !a.huella || a.vozFrac < 0.15 || a.dur < 0.6) return false;
    sumar(this.d[tipo === 'fondo' ? 'fondo' : 'usuario'], a.huella, peso || 1);
    sumar(this.d.global, a.huella, 1);
    this.guardar();
    return true;
  }
  /** → {listo, usuario (0..1), fondo (0..1 o null), diferencia (-1..1): >0 parece TU voz, <0 parece el fondo} */
  puntuar(a) {
    if (!a || !a.huella || !this.d.usuario.media) return { listo: false, usuario: null, fondo: null, diferencia: 0 };
    // varianza base: la del conjunto de todo lo oído (o una fija si aún hay poco)
    const g = this.d.global;
    const varBase = a.huella.map((_, i) => Math.max(0.25, g.n > 3 && g.var ? g.var[i] * 0.35 : 4));
    const du = distancia(this.d.usuario, a.huella, varBase), df = distancia(this.d.fondo, a.huella, varBase);
    const su = Math.exp(-du / 4), sf = df == null ? null : Math.exp(-df / 4);
    // «¿se parece a TI?» manda (una voz de TV distinta a todo lo aprendido NO es tuya); si además se parece más al
    // fondo aprendido que a ti, resta más. Antes (su − sf): una voz nueva de la tele, lejos de ambos, salía neutra (0).
    let dif = (su - 0.35) * 1.6;
    if (sf != null && sf > su) dif -= (sf - su) * 0.8;
    dif = Math.max(-1, Math.min(1, dif));
    return { listo: this.listo(), usuario: +su.toFixed(2), fondo: sf == null ? null : +sf.toFixed(2), diferencia: +dif.toFixed(2) };
  }
}

/* --------------------------------------------------------------- Ambiente */
class Ambiente {
  constructor() { this.seg = []; }
  /** Cada segmento oído: {t, dur, aceptado} */
  anotar(dur, aceptado) { const t = Date.now(); this.seg.push({ t, dur: Number(dur) || 0, aceptado: !!aceptado }); this.seg = this.seg.filter((s) => t - s.t < 180000); }
  estado(ahoraMs) {
    const t = ahoraMs || Date.now(), v = this.seg.filter((s) => t - s.t < 90000);
    const ocupacion = Math.min(1, v.reduce((a, s) => a + s.dur, 0) / 90);
    const ignorados = v.filter((s) => !s.aceptado).length;
    // «TV encendida»: mucho sonido con voz que NO era para mí
    const tv = (ignorados >= 3 && ocupacion > 0.12) || ocupacion > 0.4;
    return { ocupacion: +ocupacion.toFixed(2), ignorados, segmentos: v.length, tv };
  }
}

module.exports = { analizar, leerWav, PerfilVoz, Ambiente, SR };
