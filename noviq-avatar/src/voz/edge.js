'use strict';
/* ==========================================================================
   Noviq Avatar — Voces neuronales de Microsoft (las del «Leer en voz alta» de
   Edge): gratis, sin clave, muy naturales y con acentos latinos.
   Mismo protocolo que el paquete edge-tts (WebSocket + Sec-MS-GEC).
   ========================================================================== */
const crypto = require('crypto');
const WebSocket = require('ws');

const TOKEN = '6A5AA1D4EAFF4E9FB37E23D68491D6F4';
const CHROMIUM = '143.0.3650.75';
const MAYOR = CHROMIUM.split('.')[0];
const BASE = 'speech.platform.bing.com/consumer/speech/synthesize/readaloud';
const WSS = process.env.NOVIQ_EDGE_WSS || `wss://${BASE}/edge/v1?TrustedClientToken=${TOKEN}`;
const LISTA = `https://${BASE}/voices/list?trustedclienttoken=${TOKEN}`;
const UA = `Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/${MAYOR}.0.0.0 Safari/537.36 Edg/${MAYOR}.0.0.0`;
let desfase = 0;   // corrección del reloj (si el del PC está desfasado, el servidor responde 403)

function secMsGec() {
  let ticks = Date.now() / 1000 + desfase + 11644473600;
  ticks -= ticks % 300;
  ticks *= 1e7;
  return crypto.createHash('sha256').update(`${ticks.toFixed(0)}${TOKEN}`, 'ascii').digest('hex').toUpperCase();
}
const fechaJS = () => new Date().toUTCString().replace(/GMT$/, 'GMT+0000 (Coordinated Universal Time)').replace(/^(\w{3}), (\d{2}) (\w{3}) (\d{4})/, '$1 $3 $2 $4');
const escaparXML = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&apos;');
const limpiar = (t) => String(t).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, ' ');
const pct = (v) => { const n = Math.round((Number(v) || 1) * 100 - 100); return (n >= 0 ? '+' : '') + n + '%'; };
const hz = (t) => { const n = Math.round(((Number(t) || 1) - 1) * 50); return (n >= 0 ? '+' : '') + n + 'Hz'; };

/** «es-EC-LuisNeural» → «Microsoft Server Speech Text to Speech Voice (es-EC, LuisNeural)» (como edge-tts) */
function nombreLargo(voz) {
  const m = String(voz).match(/^([a-z]{2,})-([A-Z]{2,})-(.+Neural)$/);
  if (!m) return String(voz);
  let region = m[2], nombre = m[3];
  const i = nombre.indexOf('-');
  if (i !== -1) { region = region + '-' + nombre.slice(0, i); nombre = nombre.slice(i + 1); }
  return `Microsoft Server Speech Text to Speech Voice (${m[1]}-${region}, ${nombre})`;
}

function ssml(texto, voz, vel, tono) {
  return `<speak version='1.0' xmlns='http://www.w3.org/2001/10/synthesis' xml:lang='en-US'><voice name='${escaparXML(nombreLargo(voz))}'>` +
    `<prosody pitch='${hz(tono)}' rate='${pct(vel)}' volume='+0%'>${escaparXML(limpiar(texto))}</prosody></voice></speak>`;
}

function conectar() {
  const url = `${WSS}&ConnectionId=${crypto.randomUUID().replace(/-/g, '')}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM}`;
  return new WebSocket(url, {
    headers: { Pragma: 'no-cache', 'Cache-Control': 'no-cache', Origin: 'chrome-extension://jdiccldimpdaibmpdkjnbmckianbfold',
      'User-Agent': UA, 'Accept-Encoding': 'gzip, deflate, br, zstd', 'Accept-Language': 'en-US,en;q=0.9',
      Cookie: `muid=${crypto.randomBytes(16).toString('hex').toUpperCase()};` },
    perMessageDeflate: true, handshakeTimeout: 8000
  });
}

/** → {audio: Buffer mp3, formato: 'mp3'} */
function hablar(texto, op, reintento) {
  op = op || {};
  const voz = op.voz || 'es-EC-LuisNeural';
  return new Promise((resolve, reject) => {
    const ws = conectar();
    const trozos = [];
    let listo = false;
    const fin = (e, v) => { if (listo) return; listo = true; clearTimeout(timer); try { ws.terminate(); } catch (_) { /* noop */ } e ? reject(e) : resolve(v); };
    const timer = setTimeout(() => fin(new Error('Microsoft no respondió a tiempo')), op.limiteMs || 12000);
    ws.on('unexpected-response', (_req, res) => {
      const fecha = res.headers && res.headers.date;
      if (res.statusCode === 403 && fecha && !reintento) {   // reloj desfasado: se corrige y se reintenta una vez
        desfase += Date.parse(fecha) / 1000 - (Date.now() / 1000 + desfase);
        listo = true; clearTimeout(timer);
        return hablar(texto, op, true).then(resolve, reject);
      }
      fin(new Error('Microsoft rechazó la conexión (HTTP ' + res.statusCode + ')'));
    });
    ws.on('error', (e) => fin(e));
    ws.on('open', () => {
      ws.send(`X-Timestamp:${fechaJS()}\r\nContent-Type:application/json; charset=utf-8\r\nPath:speech.config\r\n\r\n` +
        '{"context":{"synthesis":{"audio":{"metadataoptions":{"sentenceBoundaryEnabled":"true","wordBoundaryEnabled":"false"},' +
        '"outputFormat":"audio-24khz-48kbitrate-mono-mp3"}}}}\r\n');
      ws.send(`X-RequestId:${crypto.randomUUID().replace(/-/g, '')}\r\nContent-Type:application/ssml+xml\r\nX-Timestamp:${fechaJS()}Z\r\nPath:ssml\r\n\r\n` +
        ssml(texto, voz, op.velocidad, op.tono));
    });
    ws.on('message', (datos, binario) => {
      if (!binario) {
        const t = datos.toString('utf8');
        if (/Path:turn\.end/.test(t)) {
          const audio = Buffer.concat(trozos);
          return audio.length ? fin(null, { audio, formato: 'mp3' }) : fin(new Error('Microsoft no devolvió audio (¿voz inválida?)'));
        }
        return;
      }
      const b = Buffer.isBuffer(datos) ? datos : Buffer.from(datos);
      if (b.length < 2) return;
      const lc = b.readUInt16BE(0);
      const cab = b.subarray(2, 2 + lc).toString('utf8');
      if (!/Path:audio/.test(cab)) return;
      const cuerpo = b.subarray(2 + lc);
      if (cuerpo.length) trozos.push(cuerpo);
    });
    ws.on('close', () => { if (!listo) { const audio = Buffer.concat(trozos); audio.length ? fin(null, { audio, formato: 'mp3' }) : fin(new Error('Microsoft cerró sin audio')); } });
  });
}

/** Lista oficial de voces (solo español e inglés de EE. UU.). */
async function voces() {
  const r = await fetch(`${LISTA}&Sec-MS-GEC=${secMsGec()}&Sec-MS-GEC-Version=1-${CHROMIUM}`, {
    headers: { 'User-Agent': UA, Accept: '*/*', 'Sec-CH-UA-Mobile': '?0', 'Accept-Language': 'en-US,en;q=0.9' }, signal: AbortSignal.timeout(8000)
  });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return (await r.json()).filter((v) => /^(es-|en-US)/.test(v.Locale || ''));
}

module.exports = { hablar, voces, secMsGec, ssml, nombreLargo };
