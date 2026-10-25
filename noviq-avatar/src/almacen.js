'use strict';
/* ==========================================================================
   Noviq Avatar — Guardado seguro de JSON (escritura atómica + copia .bak)
   ========================================================================== */
const fs = require('fs');
const path = require('path');

function leerJSON(ruta) {
  for (const r of [ruta, ruta + '.bak']) {
    try { return JSON.parse(fs.readFileSync(r, 'utf8')); } catch (_) { /* siguiente */ }
  }
  return null;
}

function escribirJSON(ruta, datos, op) {
  op = op || {};
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = ruta + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(datos, null, op.sangria == null ? 1 : op.sangria), 'utf8');
  if (op.bak !== false && fs.existsSync(ruta)) { try { fs.copyFileSync(ruta, ruta + '.bak'); } catch (_) { /* noop */ } }
  try { fs.renameSync(tmp, ruta); } catch (_) { fs.copyFileSync(tmp, ruta); try { fs.unlinkSync(tmp); } catch (__) { /* noop */ } }
}

/** Guarda como mucho una vez cada `ms` (y siempre al final). */
function guardadoDiferido(fn, ms) {
  let timer = null, pendiente = false;
  const correr = () => { timer = null; if (!pendiente) return; pendiente = false; try { fn(); } catch (_) { /* noop */ } };
  const pedir = () => { pendiente = true; if (!timer) timer = setTimeout(correr, ms || 400); };
  pedir.ya = () => { clearTimeout(timer); timer = null; pendiente = true; correr(); };
  return pedir;
}

module.exports = { leerJSON, escribirJSON, guardadoDiferido };
