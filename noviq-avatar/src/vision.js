'use strict';
/* ==========================================================================
   Noviq Avatar — Visión: los ojos del avatar
   · cámara conectada (si el usuario la activó en Ajustes → Visión) o pantalla
   · UN cuadro cada vez que se le pide mirar: no graba, no guarda nada en disco
     (la imagen vive en RAM solo el tiempo de preguntarle a la IA).
   · prefiere una IA con visión LOCAL (Ollama / LM Studio): la foto no sale del PC.
     Con «Solo local» activado, nunca la manda a internet.
   ========================================================================== */
const { corto } = require('./util');

class Vision {
  /** op: {ajustes, cerebro, cuerpo(cmd, op), capturarPantalla(): Promise<base64 jpeg>, aviso(texto), log} */
  constructor(op) {
    Object.assign(this, { aj: op.ajustes, cerebro: op.cerebro, cuerpo: op.cuerpo || (async () => ({ ok: false })), capturarPantalla: op.capturarPantalla || null,
      aviso: op.aviso || (() => {}), log: op.log || (() => {}) });
    this.ultima = null;   // {t, fuente, modelo, ms, local} — solo metadatos, nunca la imagen
  }
  get cfg() { return this.aj.datos.vision; }
  camaraActiva() { return !!this.cfg.camara; }

  async camaras() {
    if (!this.camaraActiva()) return { ok: false, error: 'La cámara está apagada: actívala en Ajustes → Visión.', camaras: [] };
    const r = await this.cuerpo({ cmd: 'camaras' }, { esperar: true, interno: true });
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'No pude consultar las cámaras', camaras: [] };
    return r.resultado || { ok: false, camaras: [] };
  }

  /** → {ok, imagen} | {ok:false, error} (la imagen es JPEG en base64) */
  async capturar(fuente) {
    if (fuente === 'pantalla') {
      if (!this.capturarPantalla) return { ok: false, error: 'No puedo capturar la pantalla en este modo.' };
      try { const b = await this.capturarPantalla(); return b ? { ok: true, imagen: b } : { ok: false, error: 'La captura de pantalla salió vacía.' }; }
      catch (e) { return { ok: false, error: 'No pude capturar la pantalla: ' + corto(e.message, 120) }; }
    }
    if (!this.camaraActiva()) return { ok: false, apagada: true, error: 'Mi cámara está apagada. Por tu privacidad solo la puedes encender tú: Ajustes → Visión → «Permitir que use la cámara».' };
    this.cuerpo({ cmd: 'herramienta', nombre: 'camara', duracion: 3500 }, { interno: true }).catch(() => {});
    this.cuerpo({ cmd: 'sonido', nombre: 'clic' }, { interno: true }).catch(() => {});
    const r = await this.cuerpo({ cmd: 'foto', dispositivo: this.cfg.dispositivo || undefined, ancho: this.cfg.ancho || 960 }, { esperar: true, interno: true });
    if (!r || r.ok === false) return { ok: false, error: (r && r.error) || 'La cámara no respondió.' };
    const f = r.resultado || r;
    if (!f.ok) return { ok: false, error: f.error || 'No pude usar la cámara.' };
    return { ok: true, imagen: f.imagen, camara: f.camara };
  }

  /** Mira y responde. opc: {fuente: 'camara'|'pantalla'}. → {ok, datos, decir, modelo, local} */
  async mirar(pregunta, opc) {
    const fuente = (opc && opc.fuente) || 'camara';
    const foto = await this.capturar(fuente);
    if (!foto.ok) return { ok: false, error: foto.error, apagada: !!foto.apagada };
    try {
      const r = await this.cerebro.ver({ pregunta: String(pregunta || '').slice(0, 600), imagen: foto.imagen });
      this.ultima = { t: Date.now(), fuente, modelo: r.modelo, proveedor: r.proveedor, ms: r.ms, local: r.local };
      return { ok: true, datos: r.texto, decir: r.texto, modelo: r.modelo, proveedor: r.proveedor, local: r.local, fuente };
    } catch (e) {
      return { ok: false, error: e.message, sinVision: !!e.sinVision };
    }
  }
  estado() { return { camara: this.camaraActiva(), dispositivo: this.cfg.dispositivo || '', soloLocal: !!this.cfg.soloLocal, ultima: this.ultima }; }
}

module.exports = { Vision };
