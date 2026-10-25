'use strict';
/* ==========================================================================
   Noviq Avatar — 🎯 ¿Me están hablando A MÍ?
   Junta todas las pistas de un segmento oído y decide si responder o callar:
     · lo que dijo (¿una orden o pregunta para el asistente? ¿responde a lo que
       le pregunté? ¿segunda persona? ¿o es una frase suelta de la tele?)
     · cómo sonó (¿es la voz de Gabriel o la del fondo? ¿cerca del micrófono?)
     · el ambiente (¿hay algo sonando todo el tiempo? → más exigente)
     · la confianza de Whisper (las frases inventadas sobre ruido)
   Decir su nombre o hacerle clic SIEMPRE cuenta. Sin nombre solo responde si
   la suma de pistas pasa el umbral. Devuelve también los motivos (registro).
   ========================================================================== */
const { norm } = require('../util');

const PALABRA_RESPUESTA = /^(si|sip|si claro|claro|dale|ok|okay|vale|bueno|listo|no|nop|nel|para nada|mejor no|exacto|correcto|eso|ese|esa|esos|el primero|la primera|el segundo|la segunda|el tercero|el ultimo|ninguno|ambos|los dos|gracias|perfecto|genial|de acuerdo|adelante|hazlo|no lo hagas|cancela|espera|un momento|nada|no nada)\b/;
// muletillas y vocativos al inicio («Google, abre…», «Oye, …», «Mira, …», «Solo crea…»)
const MULETILLA = /^(?:(?:oye|ey|hey|eh|mira|mire|bro|amigo|robot|google|alexa|siri|asistente|porfa|por favor|ahora|ya|y|entonces|bueno|ok|okay|vale|solo|solamente|nada mas|a ver|pues|ah|ay)\s+)+/;
const VERBO = '(abre|cierra|busca|pon|dime|dame|explica|crea|haz|escribe|redacta|resume|recuerda|apaga|enciende|sube|baja|silencia|minimiza|muestra|ensena|lee|traduce|calcula|cuenta|ayuda|revisa|ejecuta|inicia|deten|detente|cancela|continua|sigue|repite|habla|callate|guarda|anota|envia|manda|llama|activa|desactiva|cambia|programa|prueba|corrige|arregla|organiza|ordena|copia|pega|borra|elimina|instala|descarga|reproduce|toma|captura|aprende|olvida|ignora|di|ve|mira)';
const ORDEN = new RegExp('^' + VERBO + '(?:me|lo|la|los|las|nos|melo|mela|selo|sela)?\\b');
const IMPERATIVO_ENCLITICO = /\b(buscalo|buscala|buscalos|abrelo|abrela|abrelos|cierralo|cierrala|ponlo|ponla|ponme|hazlo|hazla|hazme|dimelo|dime|dame|damelo|escribelo|escribela|guardalo|guardala|mandalo|envialo|leelo|leemelo|muestramelo|ensenamelo|borralo|quitalo|apagalo|subelo|bajalo|revisalo|arreglalo|corrigelo|repitelo|explicamelo)\b/;
const NEGATIVO = /^no\s+(hagas|abras|cierres|digas|busques|pongas|escribas|apagues|borres|toques|sigas|hables|respondas|contestes|te\s+\w+)\b/;
const SUBJUNTIVO = /^que\s+(me\s+)?(hagas|abras|crees|escribas|busques|pongas|cierres|apagues|leas|muestres|digas|expliques|ayudes|revises|arregles|guardes|mandes)\b/;
const PETICION_2P = /^(puedes|podrias|pudieras|quieres|quiero que|quisiera que|necesito que|me gustaria que|te pido que|seria posible|sabes|tienes|conoces|me dices|me puedes|me ayudas|me haces|me abres|me buscas|me pones|me explicas|me cuentas|me lees|me recuerdas|vas a|ya (hiciste|terminaste|esta)|como (vas|va|te va|estas)|(me )?escuchas|(me )?oyes|estas (ahi|escuchando|despierto))\b/;
const PREGUNTA_GENERAL = /^(que (hora|dia|fecha|clima|tiempo)|cuanto|cuantos|cuantas|cual|cuales|donde|por que|que (es|son|significa|paso)|quien (es|fue)|como (se|hago|puedo|funciona))\b/;
const SEGUNDA = /\b(tu|tus|te|ti|contigo|puedes|podrias|sabes|tienes|estas|estes|eres|seas|haces|hagas|hiciste|dijiste|entiendes|entiendas|escuchas|escuches|oyes|ves|haz|dime|hablas|hables|respondes|contestas|suenas|trabajando|puedas|tengas)\b/;
const SOBRE_EL_AVATAR = /\b(tu voz|no te (escucho|oigo|entiendo)|no (suenas|hablas|me hablas|me respondes|me escuchas)|ruido|de fondo|la tele|el televisor|microfono|volumen|parlantes|bocinas|motor de voz|me escuchas|me oyes|estas escuchando|no estas hablando|solo (estas )?escribiendo)\b/;
const NARRATIVA = /^(el|la|los|las|un|una|y|pero|entonces|despues|luego|ademas|porque|cuando|mientras|aunque|eso|ese|esa|esto|este|ella|ellos|ellas|nosotros|usted|ustedes|mi|mis|su|sus|ahi|alli|aqui|asi|tambien|tampoco|nunca|siempre|quien|de donde)\b/;
const STOP = new Set(('de la que el en y a los se del las un por con no una su para es al lo como mas pero sus le ya o este si porque esta entre cuando muy sin sobre tambien me hasta hay donde quien desde todo nos durante todos uno les ni contra otros ese eso ante ellos e esto mi antes algunos unos yo otro otras otra tanto esa estos mucho quienes nada muchos cual poco ella estar estas algunas algo nosotros mis tu te ti tus ellas mio mia tuyo tuya suyo suya nuestro nuestra esos esas estoy esta estamos estan hola buenas gracias bueno vale claro juan noviq').split(' '));
const contenido = (t) => norm(t).split(' ').filter((w) => w.length >= 4 && !STOP.has(w));

/**
 * p: {texto, conNombre, forzado, modo ('palabra'|'siempre'|'pulsar'), libre (ventana de conversación abierta),
 *     preguntaAbierta: el avatar espera un dato libre («¿sobre qué tema?», «¿de qué ciudad?»),
 *     ultimo: {texto, t, pregunta} (lo último que dijo el avatar), recientes: [textos de la charla de los últimos 2 min],
 *     esOrden (la vía rápida la entiende como una orden), pendiente (espera una respuesta suya),
 *     voz: {listo, diferencia}, acustica: {snrDb, vozFrac, dur}, ambiente: {tv}, stt: {confianza, sinVoz},
 *     filtro: 'apagado' | 'normal' | 'estricto', ahora}
 * → {aceptar, puntaje, umbral, motivos: []}
 */
function evaluar(p) {
  const motivos = [];
  const crudo = String(p.texto || '');
  const n0 = norm(crudo);
  const pal = n0 ? n0.split(' ') : [];
  if (!pal.length) return { aceptar: false, puntaje: -1, umbral: 0, motivos: ['vacío'] };
  if (p.forzado) return { aceptar: true, puntaje: 1, umbral: 0, motivos: ['clic o atajo'] };
  const st = p.stt || {};
  if (st.sinVoz != null && st.sinVoz > 0.75 && !p.conNombre) return { aceptar: false, puntaje: -1, umbral: 0, motivos: ['Whisper: no había voz'] };
  if (p.conNombre) return { aceptar: true, puntaje: 1, umbral: 0, motivos: ['dijo mi nombre'] };
  const filtro = p.filtro || 'normal';
  const ahora = p.ahora || Date.now();
  if (p.modo === 'palabra' && !p.libre && !p.pendiente && !p.preguntaAbierta) return { aceptar: false, puntaje: 0, umbral: 1, motivos: ['sin nombre y sin charla abierta'] };
  if (filtro === 'apagado') return { aceptar: true, puntaje: 1, umbral: 0, motivos: ['filtro apagado'] };

  // «Mira, Belico…» → «mira» es muletilla si va con coma; «Google, abre…» → «abre…»
  // las muletillas se quitan para buscar el verbo, pero «ya terminaste…» conserva su «ya» (es parte de la pregunta)
  const n = n0.replace(MULETILLA, '').trim() || n0;
  const nYa = /^ya\s+(hiciste|terminaste|acabaste|esta|estas)\b/.test(n0) ? n0 : n;
  const comaInicial = /^\s*[¿¡]?\s*(mira|mire|oye|bueno|pues|ay|ah)\s*,/i.test(crudo);
  let s = 0;
  const ult = p.ultimo || {};
  const reciente = ult.t && ahora - ult.t < 30000;
  // 1) ¿qué dijo?
  const orden = (ORDEN.test(n) && !(comaInicial && /^(mira|ve)\b/.test(n))) || IMPERATIVO_ENCLITICO.test(n) || NEGATIVO.test(n) || SUBJUNTIVO.test(n0) || !!p.esOrden;
  const peticion2p = PETICION_2P.test(nYa);
  const preguntaGeneral = PREGUNTA_GENERAL.test(n);
  const segunda = SEGUNDA.test(n);
  if (orden) { s += 0.45; motivos.push(p.esOrden ? '+orden que entiendo' : '+orden'); }
  else if (peticion2p) { s += 0.45; motivos.push('+pedido o pregunta para mí'); }
  else if (preguntaGeneral) { s += segunda ? 0.35 : (/\?\s*$/.test(crudo.trim()) && pal.length <= 8 ? 0.35 : 0.2); motivos.push('+pregunta'); }
  // «¿Dónde estabas anoche, Carlos?»: le habla a OTRA persona por su nombre
  const vocativo = crudo.match(/,\s*([A-ZÁÉÍÓÚÑ][a-záéíóúñ]{2,})\s*[?!.]*\s*$/);
  if (vocativo && !/^(noviq|novi|nobi)$/i.test(vocativo[1])) { s -= 0.35; motivos.push('-le habla a otra persona («' + vocativo[1] + '»)'); }
  if (segunda) { s += 0.2; motivos.push('+le habla a alguien («tú»)'); }
  if (segunda && /\?\s*$/.test(crudo.trim()) && pal.length <= 6) { s += 0.15; motivos.push('+pregunta corta en segunda persona'); }
  if (SOBRE_EL_AVATAR.test(n)) { s += 0.3; motivos.push('+habla del asistente'); }
  const respuesta = PALABRA_RESPUESTA.test(n) && (pal.length <= 4 || /^\s*[¿¡]?\s*(si|no|claro|vale|ok|dale|bueno)\s*[,.]/i.test(crudo));
  if ((p.pendiente || (reciente && ult.pregunta)) && respuesta) { s += 0.5; motivos.push('+responde a mi pregunta'); }
  // le pregunté algo ABIERTO («¿sobre qué tema?», «¿de qué ciudad?»): la respuesta puede ser cualquier frase corta
  const abierta = !respuesta && !!p.preguntaAbierta && pal.length <= 14 && !vocativo && !(NARRATIVA.test(n) && pal.length > 6);
  if (abierta) { s += 0.45; motivos.push('+responde a mi pregunta abierta'); }
  const temas = new Set([].concat(reciente && ult.texto ? [ult.texto] : [], p.recientes || []).flatMap(contenido));
  const comunes = [...new Set(contenido(n))].filter((w) => temas.has(w));
  if (comunes.length) { s += Math.min(0.3, 0.15 * comunes.length); motivos.push('+sigue el tema (' + comunes.slice(0, 3).join(', ') + ')'); }
  const sinIntencion = !orden && !peticion2p && !segunda && !respuesta && !abierta;
  if (NARRATIVA.test(n) && sinIntencion) { s -= 0.25; motivos.push('-frase suelta, en tercera persona'); }
  if (comaInicial && sinIntencion) { s -= 0.15; motivos.push('-empieza con muletilla y no pide nada'); }
  if (pal.length <= 2 && !PALABRA_RESPUESTA.test(n) && !orden && !segunda) { s -= 0.3; motivos.push('-muy corta y sin sentido de orden'); }
  if (pal.length >= 22 && !orden && !peticion2p) { s -= 0.15; motivos.push('-muy larga (¿diálogo de la tele?)'); }
  // 2) confianza de Whisper
  if (st.confianza != null) {
    if (st.confianza < -1.0) { s -= 0.35; motivos.push('-Whisper no está seguro de lo que oyó'); }
    else if (st.confianza < -0.7) { s -= 0.15; motivos.push('-Whisper duda'); }
  }
  // 3) ¿quién habla?
  const v = p.voz || {};
  if (v.listo && v.diferencia != null) {
    let k = Math.max(-0.45, Math.min(0.45, v.diferencia * 0.5));
    // «no se parece a ti» pesa poco si TAMPOCO se parece al fondo aprendido (tu voz cambia con la distancia, un
    // resfriado o otro micrófono); pesa todo cuando suena como la TV que ya aprendió
    if (k < 0 && !(v.fondo != null && v.fondo > (v.usuario || 0))) k = Math.max(k, -0.08);
    s += k; motivos.push((k >= 0 ? '+' : '') + 'voz ' + (k >= 0 ? 'parecida a la tuya' : 'parecida al fondo') + ' (' + v.diferencia + ')');
  }
  const ac = p.acustica || {};
  if (ac.snrDb != null) {
    if (ac.snrDb < 10) { s -= 0.15; motivos.push('-se oyó lejos o bajito'); }
    else if (ac.snrDb > 24) { s += 0.08; motivos.push('+cerca del micrófono'); }
  }
  // 4) ambiente
  let umbral = filtro === 'estricto' ? 0.5 : 0.35;
  if (p.ambiente && p.ambiente.tv) { umbral += 0.15; motivos.push('(hay sonido de fondo constante: más exigente)'); }
  if (p.modo === 'siempre' && !p.libre) umbral += 0.1;
  const aceptar = s >= umbral;
  return { aceptar, puntaje: +s.toFixed(2), umbral: +umbral.toFixed(2), motivos };
}

/** ¿Le está diciendo que lo último fue ruido / la tele / que no le hablaba? */
const RX_FUE_RUIDO = /\b(eso|esa|ese|lo de antes|lo anterior|lo ultimo)\s+(fue|era|es|vino de|lo dijo)\s+(un |una |el |la )?(ruido|sonido de fondo|fondo|la tele|la television|el televisor|la tv|la radio|otra persona|alguien mas|el video|la pelicula|la musica)\b|\bno (te )?(hablaba|estaba hablando|hable|dije eso|era) (a ti|contigo|para ti)\b|\bno era para ti\b|\bignora (eso|lo que oiste|lo anterior)\b|\b(esa|esa voz) no (es|era) (mi voz|la mia|yo)\b|\bese no (soy|era) yo\b|\beso fue (un )?ruido\b|\bfue (la tele|la television|ruido)\b/;
const RX_APRENDE_VOZ = /\b(aprende|aprender|reconoce|reconocer|memoriza|memorizar|registra|registrar|guarda|guardar|graba|grabar|conoce|conocer)\s+(bien\s+)?(mi voz|como hablo|como suena mi voz|mi forma de hablar)\b/;
const RX_ESTADO_VOZ = /\b(reconoces|distingues|sabes cual es|conoces) mi voz\b|\bpuedes (distinguir|diferenciar|reconocer) (las )?voces\b/;
const RX_OLVIDA_VOZ = /\b(olvida|borra|resetea|reinicia)\s+(mi voz|lo que sabes de mi voz|el perfil de (mi )?voz)\b/;

module.exports = { evaluar, RX_FUE_RUIDO, RX_APRENDE_VOZ, RX_ESTADO_VOZ, RX_OLVIDA_VOZ, ORDEN };
