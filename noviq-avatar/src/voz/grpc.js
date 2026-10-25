'use strict';
/* ==========================================================================
   Noviq Avatar — gRPC mínimo (unario) sobre HTTP/2 + protobuf a mano.
   Lo justo para hablar con NVIDIA Riva en build.nvidia.com (voz Magpie y
   Whisper) sin instalar nada: solo usa el módulo http2 de Node.
   ========================================================================== */
const http2 = require('http2');

/* ------------------------------------------------------------ Protobuf */
function varint(n) {
  const out = [];
  n = BigInt(n);
  if (n < 0n) n += 1n << 64n;
  do { let b = Number(n & 0x7fn); n >>= 7n; if (n > 0n) b |= 0x80; out.push(b); } while (n > 0n);
  return Buffer.from(out);
}
const etiqueta = (campo, tipo) => varint((campo << 3) | tipo);
const pb = {
  cadena: (campo, s) => (s == null || s === '' ? Buffer.alloc(0) : pb.bytes(campo, Buffer.from(String(s), 'utf8'))),
  bytes: (campo, b) => (!b || !b.length ? Buffer.alloc(0) : Buffer.concat([etiqueta(campo, 2), varint(b.length), b])),
  entero: (campo, n) => (!n ? Buffer.alloc(0) : Buffer.concat([etiqueta(campo, 0), varint(n)])),
  bool: (campo, v) => (!v ? Buffer.alloc(0) : Buffer.concat([etiqueta(campo, 0), varint(1)])),
  flotante: (campo, f) => { if (!f) return Buffer.alloc(0); const b = Buffer.alloc(4); b.writeFloatLE(f); return Buffer.concat([etiqueta(campo, 5), b]); },
  mensaje: (campo, partes) => pb.bytes(campo, Buffer.concat(partes.filter(Boolean)))
};

/** Decodifica un mensaje en {campo: [valores]} (bytes como Buffer, varint como Number). */
function decodificar(buf) {
  const out = {};
  let i = 0;
  const leerVarint = () => {
    let r = 0n, s = 0n, b;
    do { b = buf[i++]; r |= BigInt(b & 0x7f) << s; s += 7n; } while (b & 0x80 && i < buf.length);
    return r;
  };
  while (i < buf.length) {
    const tag = Number(leerVarint());
    const campo = tag >> 3, tipo = tag & 7;
    let v;
    if (tipo === 0) v = Number(leerVarint());
    else if (tipo === 2) { const n = Number(leerVarint()); v = buf.subarray(i, i + n); i += n; }
    else if (tipo === 5) { v = buf.readFloatLE(i); i += 4; }
    else if (tipo === 1) { v = buf.readDoubleLE(i); i += 8; }
    else throw new Error('protobuf: tipo de cable desconocido ' + tipo);
    (out[campo] || (out[campo] = [])).push(v);
  }
  return out;
}

/* ---------------------------------------------------------------- gRPC */
const conexiones = new Map();
function conexion(url) {
  let c = conexiones.get(url);
  if (c && !c.closed && !c.destroyed) return c;
  c = http2.connect(url);
  c.on('error', () => conexiones.delete(url));
  c.on('close', () => conexiones.delete(url));
  c.setTimeout(60000, () => c.close());
  conexiones.set(url, c);
  return c;
}

/**
 * Llamada unaria. url: 'https://grpc.nvcf.nvidia.com:443'. ruta: '/nvidia.riva.tts.RivaSpeechSynthesis/Synthesize'.
 * Devuelve el Buffer del mensaje de respuesta.
 */
function unario(url, ruta, mensaje, metadatos, limiteMs) {
  return new Promise((resolve, reject) => {
    let cliente;
    try { cliente = conexion(url); } catch (e) { return reject(e); }
    const cab = Object.assign({ ':method': 'POST', ':path': ruta, 'content-type': 'application/grpc', te: 'trailers', 'user-agent': 'noviq-avatar-grpc/1.0' }, metadatos || {});
    const req = cliente.request(cab);
    const trozos = [];
    let estado = null, mensajeError = '', http = 0, listo = false;
    const fin = (e, v) => { if (listo) return; listo = true; clearTimeout(timer); e ? reject(e) : resolve(v); };
    const timer = setTimeout(() => { try { req.close(http2.constants.NGHTTP2_CANCEL); } catch (_) { /* noop */ } fin(new Error('tiempo agotado')); }, limiteMs || 20000);
    req.on('response', (h) => {
      http = Number(h[':status']);
      if (h['grpc-status'] != null) { estado = Number(h['grpc-status']); mensajeError = decodeURIComponent(h['grpc-message'] || ''); }
    });
    req.on('trailers', (h) => { if (h['grpc-status'] != null) { estado = Number(h['grpc-status']); mensajeError = decodeURIComponent(h['grpc-message'] || ''); } });
    req.on('data', (d) => trozos.push(d));
    req.on('error', (e) => fin(e));
    req.on('end', () => {
      const todo = Buffer.concat(trozos);
      if (estado != null && estado !== 0) return fin(new Error(`gRPC ${estado}: ${mensajeError || 'error'}`));
      if (http && http !== 200) return fin(new Error(`HTTP ${http}`));
      if (todo.length < 5) return fin(new Error('respuesta gRPC vacía'));
      const n = todo.readUInt32BE(1);
      fin(null, todo.subarray(5, 5 + n));
    });
    const marco = Buffer.alloc(5);
    marco.writeUInt8(0, 0); marco.writeUInt32BE(mensaje.length, 1);
    req.end(Buffer.concat([marco, mensaje]));
  });
}

function cerrarTodo() { for (const c of conexiones.values()) { try { c.close(); } catch (_) { /* noop */ } } conexiones.clear(); }

module.exports = { pb, decodificar, unario, cerrarTodo, varint };
