'use strict';
/* ==========================================================================
   Noviq Avatar — Controlador de comandos (independiente de Electron)
   Recibe comandos de la API, los normaliza, decide si van al avatar
   (renderer) o a la ventana (proceso principal) y gestiona secuencias.
   ========================================================================== */
const { normalizar } = require('./comandos');

const pausa = (ms) => new Promise((r) => setTimeout(r, ms));

class Controlador {
  /**
   * @param {object} o
   * @param {(nombre:string, params:object)=>Promise<any>} o.avatar  envía al renderer
   * @param {{ejecutar:(n:string,p:object)=>Promise<any>, detener:()=>void}} o.ventana
   * @param {(nombre:string, datos:object)=>void} o.emitir
   */
  constructor({ avatar, ventana, emitir, mente }) {
    this.avatar = avatar;
    this.ventana = ventana;
    this.mente = mente || (async () => { throw new Error('La mente del avatar no está lista.'); });
    this.emitir = emitir || (() => {});
    this.seq = 0;
    this.tokenSec = 0;
  }

  async ejecutar(entrada, opciones) {
    const esperar = !!(opciones && opciones.esperar);
    if (Array.isArray(entrada)) entrada = { cmd: 'secuencia', pasos: entrada };
    const c = normalizar(entrada);
    if (c.error) return { ok: false, error: c.error, sugerencias: c.sugerencias };
    if ((c.nombre === 'foto' || c.nombre === 'camaras') && !(opciones && opciones.interno)) return { ok: false, error: 'La cámara solo la usa el bot de visión del avatar: pídele «¿qué ves?» por /charla o por voz (hay que activarla antes en Ajustes → Visión).' };
    const id = ++this.seq;
    const promesa = this.despachar(c);
    if (esperar) {
      try { return { ok: true, id, comando: c.nombre, resultado: (await promesa) || {} }; }
      catch (e) { return { ok: false, id, comando: c.nombre, error: String(e && e.message || e) }; }
    }
    // Sin esperar: se devuelve enseguida, pero se capturan los errores inmediatos (parámetros inválidos)
    const rapido = await Promise.race([promesa.then(() => null, (e) => e), pausa(120).then(() => null)]);
    promesa.catch((e) => this.emitir('error', { id, comando: c.nombre, error: String(e && e.message || e) }));
    if (rapido) return { ok: false, id, comando: c.nombre, error: String(rapido.message || rapido) };
    return { ok: true, id, comando: c.nombre };
  }

  despachar(c) {
    const { nombre, params } = c;
    switch (nombre) {
      case 'detener':
        this.tokenSec++;
        try { this.ventana.detener(); } catch (_) { /* noop */ }
        return this.avatar('detener', params);
      case 'secuencia':
        return this.secuencia(params);
      case 'esperar':
        return pausa(Math.max(0, Math.min(600000, Number(params.ms) || 0))).then(() => ({ ok: true }));
      default:
        if (c.destino === 'ventana') return this.ventana.ejecutar(nombre, params);
        if (c.destino === 'mente') return this.mente(nombre, params);
        return this.avatar(nombre, params);
    }
  }

  async secuencia(P) {
    const pasos = Array.isArray(P.pasos) ? P.pasos : [];
    if (!pasos.length) throw new Error('La secuencia no tiene "pasos".');
    const veces = Math.max(1, Math.min(1000, Number(P.repetir) || 1));
    const tok = this.tokenSec;
    // Validar todo antes de empezar
    const norm = pasos.map((p) => (Array.isArray(p) ? { error: 'Las secuencias anidadas deben usar {cmd:"secuencia"}' } : normalizar(p)));
    const malo = norm.findIndex((c) => c.error);
    if (malo >= 0) throw new Error(`Paso ${malo + 1}: ${norm[malo].error}`);
    let n = 0;
    for (let v = 0; v < veces; v++) {
      for (const c of norm) {
        if (this.tokenSec !== tok) return { cancelada: true, pasos: n };
        const pr = this.despachar(c);
        n++;
        if (c.params.paralelo) pr.catch((e) => this.emitir('error', { comando: c.nombre, error: String(e.message || e) }));
        else await pr;
      }
    }
    return { pasos: n };
  }
}

module.exports = { Controlador, pausa };
