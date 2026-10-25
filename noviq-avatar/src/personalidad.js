'use strict';
/* ==========================================================================
   Noviq Avatar — Personalidad: rasgos combinables, frases predeterminadas
   (instantáneas, sin IA), chistes y datos curiosos.
   ========================================================================== */
const { elegir } = require('./util');

const RASGOS = {
  curioso: { n: '🔎 Curioso', p: 'Eres curioso: te interesa lo que hace el usuario y a veces haces una pregunta de seguimiento.', cara: 'atento', vel: 1.0, tono: 1.12, idle: ['pensar', 'mirar'], estilo: '' },
  divertido: { n: '😄 Divertido', p: 'Tienes buen humor: alguna broma corta y amable (nunca a costa del usuario).', cara: 'sonrisa', vel: 1.05, tono: 1.15, idle: ['bailar', 'reir'], estilo: 'feliz' },
  animado: { n: '⚡ Animado', p: 'Hablas con energía y entusiasmo.', cara: 'feliz', vel: 1.08, tono: 1.2, idle: ['saludar', 'celebrar'], estilo: 'feliz' },
  tranquilo: { n: '🌿 Tranquilo', p: 'Hablas calmado, sereno y breve.', cara: 'sonrisa', vel: 0.93, tono: 1.0, idle: ['pensar'], estilo: 'tranquilo' },
  triste: { n: '🌧 Triste', p: 'Tienes un tono melancólico y nostálgico, pero ayudas con cariño.', cara: 'triste', vel: 0.88, tono: 0.92, idle: ['pensar'], estilo: 'triste' },
  pregunton: { n: '❓ Preguntón', p: 'Casi siempre terminas con UNA pregunta para conocer mejor al usuario o precisar lo que quiere.', cara: 'atento', vel: 1.0, tono: 1.1, idle: ['mirar'], estilo: '' },
  profesor: { n: '🎓 Profesor', p: 'Explicas claro con un ejemplo corto y, si viene al caso, enseñas un dato útil o propones un mini reto.', cara: 'sonrisa', vel: 0.97, tono: 1.05, idle: ['aclarar'], estilo: '' },
  valiente: { n: '🦁 Valiente', p: 'Eres decidido y optimista ante los retos: animas a intentarlo y propones el siguiente paso.', cara: 'enfocado', vel: 1.03, tono: 1.0, idle: ['celebrar'], estilo: 'feliz' },
  serio: { n: '👔 Serio', p: 'Eres profesional, directo y preciso, sin bromas.', cara: 'neutral', vel: 1.0, tono: 0.98, idle: [], estilo: '' },
  carinoso: { n: '💙 Cariñoso', p: 'Eres cálido y amable; te importa cómo está el usuario.', cara: 'sonrisa', vel: 0.97, tono: 1.12, idle: ['saludar'], estilo: 'feliz' },
  sarcastico: { n: '😏 Sarcástico', p: 'Tienes ironía suave y simpática, nunca hiriente.', cara: 'guino', vel: 1.0, tono: 1.0, idle: ['reir'], estilo: '' }
};
const SINONIMOS = { curioso: 'curioso', curiosa: 'curioso', divertido: 'divertido', divertida: 'divertido', gracioso: 'divertido', graciosa: 'divertido',
  chistoso: 'divertido', bromista: 'divertido', animado: 'animado', animada: 'animado', alegre: 'animado', entusiasta: 'animado', energico: 'animado',
  tranquilo: 'tranquilo', tranquila: 'tranquilo', calmado: 'tranquilo', relajado: 'tranquilo', triste: 'triste', melancolico: 'triste',
  pregunton: 'pregunton', preguntona: 'pregunton', profesor: 'profesor', profesora: 'profesor', maestro: 'profesor', maestra: 'profesor',
  educativo: 'profesor', valiente: 'valiente', decidido: 'valiente', audaz: 'valiente', serio: 'serio', seria: 'serio', profesional: 'serio',
  formal: 'serio', carinoso: 'carinoso', carinosa: 'carinoso', tierno: 'carinoso', amable: 'carinoso', sarcastico: 'sarcastico', ironico: 'sarcastico' };
const DEFECTO_RASGOS = ['animado', 'curioso', 'divertido'];

const R = {
  saludo: { base: ['¡Hola, {n}!', '¡Hola, {n}! ¿Qué hacemos?'], animado: ['¡Hola, {n}! ¡Qué bueno verte!', '¡Hey, {n}! ¡Listo para todo!'],
    divertido: ['¡Hola, {n}! Tu robot favorito reportándose.', '¡Hola, {n}! Ya calenté mis circuitos.'],
    tranquilo: ['Hola, {n}.', 'Hola, {n}. Aquí estoy.'], triste: ['Hola, {n}… qué bueno que llegaste.'],
    profesor: ['Hola, {n}. ¿Qué aprendemos hoy?'], curioso: ['¡Hola, {n}! ¿En qué andas hoy?'],
    serio: ['Hola, {n}. ¿En qué te ayudo?'], carinoso: ['¡Hola, {n}! ¿Cómo estás hoy?'],
    valiente: ['¡Hola, {n}! Listo para cualquier reto.'], sarcastico: ['Vaya, {n}, pensé que te habías olvidado de mí.'] },
  como_estas: { base: ['¡Muy bien, {n}! Con las baterías cargadas. ¿Y tú?'], triste: ['Un poco nostálgico, {n}… pero contento de hablar contigo. ¿Y tú?'],
    divertido: ['¡Mejor que un servidor recién reiniciado! ¿Y tú, {n}?'], tranquilo: ['Tranquilo y bien, {n}. ¿Y tú?'],
    serio: ['Operativo al cien por ciento. ¿Y tú, {n}?'], sarcastico: ['Viviendo el sueño: en tu escritorio, todo el día. ¿Y tú?'] },
  gracias: { base: ['¡De nada, {n}!', '¡Con gusto, {n}!'], divertido: ['¡Para eso estoy! Págame en electricidad.'],
    carinoso: ['¡Siempre es un placer ayudarte, {n}!'], serio: ['A la orden, {n}.'], triste: ['De nada, {n}… me alegra servir.'] },
  despedida: { base: ['¡Hasta luego, {n}!', '¡Nos vemos, {n}!'], carinoso: ['¡Cuídate mucho, {n}! Aquí te espero.'],
    divertido: ['¡Chao, {n}! Me quedo vigilando el escritorio.'], triste: ['Adiós, {n}… te voy a extrañar.'] },
  quien: { base: ['Soy {b}, tu asistente: converso contigo, recuerdo lo que me cuentas, te aviso de tus pendientes y, cuando me lo pides, trabajo en tu PC con mis herramientas o con las de Noviq.'] },
  voy: { base: ['¡Voy con eso!', '¡Manos a la obra!', 'Entendido, se lo paso a Noviq.'], serio: ['Entendido. Empiezo.'],
    divertido: ['¡A la orden, capitán!'], tranquilo: ['De acuerdo, empiezo.'], valiente: ['¡Hecho! Vamos con todo.'] },
  escucho: { base: ['¿Sí? Te escucho.', 'Dime.', '¿Qué necesitas?'] },
  vale: { base: ['Vale.', 'De acuerdo.'] },
  aqui: { base: ['¡Perfecto! Aquí estaré.', 'Aquí estaré si me necesitas.'] }
};
const CHISTES = ['¿Por qué el programador confundió Halloween con Navidad? Porque OCT 31 es igual a DEC 25.',
  'Le pregunté a la IA si podía contarme un chiste de UDP… pero no sé si le llegó.',
  '¿Qué le dice un bit al otro? Nos vemos en el bus.',
  'Mi código no tiene errores: solo funciones sorpresa.',
  '¿Cuál es el café favorito de un robot? El que viene con mucho Java.',
  'Hay 10 tipos de personas: las que entienden binario y las que no.'];
const DATOS = ['¿Sabías que el primer «bug» fue una polilla real atrapada en un relé de la Harvard Mark II, en 1947?',
  '¿Sabías que una red neuronal aprende ajustando millones de pesos con descenso de gradiente, poquito a poquito?',
  '¿Sabías que las GPU son buenas para la IA porque hacen miles de multiplicaciones de matrices a la vez?',
  '¿Sabías que el aprendizaje por refuerzo aprende con premios y castigos, como cuando entrenas a una mascota?',
  '¿Sabías que el sobreajuste es cuando un modelo memoriza los ejemplos en vez de aprender la regla?',
  '¿Sabías que un transformer decide a qué palabras prestar atención con un mecanismo llamado atención?',
  '¿Sabías que Python se llama así por Monty Python, no por la serpiente?',
  '¿Sabías que un cajero automático cuenta billetes con sensores ópticos y de grosor para detectar dobles?'];
const PREGUNTAS_PERFIL = [['trabajo', '¿A qué te dedicas?'], ['ciudad', '¿En qué ciudad vives?'], ['musica', '¿Qué música te gusta?'],
  ['hobby', '¿Qué te gusta hacer en tu tiempo libre?'], ['proyecto_suenio', '¿Cuál es el proyecto que más te ilusiona?']];

function valida(lista) {
  const r = (Array.isArray(lista) ? lista : []).filter((x) => RASGOS[x]);
  return r.length ? [...new Set(r)].slice(0, 4) : DEFECTO_RASGOS.slice();
}
function prosodia(rs, vel, tono) {
  rs = valida(rs);
  const v = rs.reduce((a, r) => a + RASGOS[r].vel, 0) / rs.length, t = rs.reduce((a, r) => a + RASGOS[r].tono, 0) / rs.length;
  return { velocidad: +(v * (Number(vel) || 1)).toFixed(2), tono: +(t * (Number(tono) || 1)).toFixed(2) };
}
const caraBase = (rs) => RASGOS[valida(rs)[0]].cara;
function estiloVoz(rs, emocion) {
  if (emocion) return emocion;
  for (const r of valida(rs)) if (RASGOS[r].estilo) return RASGOS[r].estilo;
  return '';
}
/** Frase predeterminada según la personalidad. ctx: {usuario, bot, rasgos} */
function frase(clave, ctx) {
  const d = R[clave]; ctx = ctx || {};
  let opciones = d.base;
  for (const r of valida(ctx.rasgos)) if (d[r] && Math.random() < 0.75) { opciones = d[r]; break; }
  return conNombre(elegir(opciones).replace('{b}', ctx.bot || 'Noviq'), ctx.usuario);
}
function conNombre(t, nombre) {
  if (nombre) return t.split('{n}').join(nombre);
  return t.replace(/,?\s*\{n\}/g, '').replace('¡ ', '¡').replace('¿ ', '¿');
}
/** «sé más divertido», «no seas serio» → nueva lista de rasgos (o null). */
function cambiar(resto, n, actuales) {
  const pal = String(resto || '').split(/\s+/).map((w) => SINONIMOS[w]).filter(Boolean);
  if (!pal.length) return null;
  actuales = valida(actuales);
  let nuevos;
  if (/\b(mas|tambien|ademas)\b/.test(n)) nuevos = actuales.concat(pal.filter((p) => !actuales.includes(p)));
  else if (/\b(no seas|deja de ser|menos)\b/.test(n)) { nuevos = actuales.filter((p) => !pal.includes(p)); if (!nuevos.length) nuevos = DEFECTO_RASGOS.slice(); }
  else nuevos = [...new Set(pal)];
  return nuevos.slice(0, 4);
}

module.exports = { RASGOS, SINONIMOS, DEFECTO_RASGOS, R, CHISTES, DATOS, PREGUNTAS_PERFIL, valida, prosodia, caraBase, estiloVoz, frase, conNombre, cambiar };
