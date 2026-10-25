'use strict';
/* ==========================================================================
   Noviq Avatar — NVIDIA Riva en build.nvidia.com (con tu clave nvapi-…)
   · Voz: Magpie TTS Multilingual (Isabela, Diego… con emociones)
   · Oído: Whisper large-v3
   ========================================================================== */
const { pb, decodificar, unario } = require('./grpc');

const URL_NVCF = process.env.NOVIQ_RIVA_URL || 'https://grpc.nvcf.nvidia.com:443';
const FN_TTS = '877104f7-e885-42b9-8de8-f6e4c6303969';       // nvidia/magpie-tts-multilingual
const FN_WHISPER = 'b702f636-f60c-4a3d-a6f4-f3568c13bd7d';   // openai/whisper-large-v3
const LINEAR_PCM = 1;
const EMOCION = { triste: 'Sad', feliz: 'Happy', risa: 'Happy', sonrisa: 'Happy', enojado: 'Angry', sorpresa: 'Happy', tranquilo: 'Calm', dormido: 'Calm', miedo: 'Fearful' };

function pcmAWav(pcm, sr) {
  const h = Buffer.alloc(44);
  h.write('RIFF', 0); h.writeUInt32LE(36 + pcm.length, 4); h.write('WAVE', 8); h.write('fmt ', 12);
  h.writeUInt32LE(16, 16); h.writeUInt16LE(1, 20); h.writeUInt16LE(1, 22); h.writeUInt32LE(sr, 24);
  h.writeUInt32LE(sr * 2, 28); h.writeUInt16LE(2, 32); h.writeUInt16LE(16, 34); h.write('data', 36); h.writeUInt32LE(pcm.length, 40);
  return Buffer.concat([h, pcm]);
}

async function hablar(texto, op) {
  op = op || {};
  if (!op.clave) throw new Error('falta la clave de NVIDIA (nvapi-…)');
  let voz = op.voz || 'Magpie-Multilingual.ES-US.Diego';
  const emo = EMOCION[String(op.estilo || '').toLowerCase()];
  const idioma = /\.EN-US\./.test(voz) ? 'en-US' : 'es-US';
  const sr = 44100;
  const meta = { 'function-id': FN_TTS, authorization: 'Bearer ' + op.clave };
  const pedir = (v) => Buffer.concat([pb.cadena(1, texto), pb.cadena(2, idioma), pb.entero(3, LINEAR_PCM), pb.entero(4, sr), pb.cadena(5, v)]);
  let resp;
  try { resp = await unario(URL_NVCF, '/nvidia.riva.tts.RivaSpeechSynthesis/Synthesize', pedir(emo && voz.split('.').length === 3 ? `${voz}.${emo}` : voz), meta, op.limiteMs || 15000); }
  catch (e) {
    if (!(emo && voz.split('.').length === 3)) throw e;
    resp = await unario(URL_NVCF, '/nvidia.riva.tts.RivaSpeechSynthesis/Synthesize', pedir(voz), meta, op.limiteMs || 15000);   // sin emoción
  }
  const d = decodificar(resp);
  const audio = d[1] && d[1][0];
  if (!audio || !audio.length) throw new Error('NVIDIA no devolvió audio');
  return { audio: pcmAWav(Buffer.from(audio), sr), formato: 'wav' };
}

/** wav: Buffer WAV 16 kHz mono. → texto */
async function transcribir(wav, op) {
  op = op || {};
  if (!op.clave) throw new Error('falta la clave de NVIDIA (nvapi-…)');
  const sr = wav.length > 28 && wav.toString('ascii', 0, 4) === 'RIFF' ? wav.readUInt32LE(24) : 16000;
  const config = [pb.entero(1, LINEAR_PCM), pb.entero(2, sr), pb.cadena(3, op.idioma || 'es'), pb.entero(4, 1), pb.entero(7, 1), pb.bool(11, true)];
  const msg = Buffer.concat([pb.mensaje(1, config), pb.bytes(2, wav)]);
  const resp = await unario(URL_NVCF, '/nvidia.riva.asr.RivaSpeechRecognition/Recognize', msg,
    { 'function-id': FN_WHISPER, authorization: 'Bearer ' + op.clave }, op.limiteMs || 30000);
  const d = decodificar(resp);
  const partes = [];
  for (const r of d[1] || []) {
    const res = decodificar(r);
    const alt = res[1] && res[1][0];
    if (alt) { const a = decodificar(alt); if (a[1]) partes.push(a[1][0].toString('utf8').trim()); }
  }
  return partes.join(' ').trim();
}

module.exports = { hablar, transcribir, pcmAWav, FN_TTS, FN_WHISPER };
