'use strict';
/* ==========================================================================
   Noviq Avatar — 🧠 MENTE propia del avatar
   Conversa, recuerda, planifica y usa sus herramientas por su cuenta. Solo
   manda trabajo a Noviq (sus agentes con todas las herramientas del PC) con
   una orden directa o un plan ya concreto. Capas, de la más rápida a la más
   pesada:
     1. Reflejos (instantáneos, sin IA): saludos con tu nombre, hora/fecha,
        recordar datos, recordatorios, personalidad, lo que le enseñaste…
     1b. ⚡ Vía rápida (sin IA): abrir/cerrar programas, archivos, carpetas y
        proyectos, apagar, volumen, capturas, buscar archivos… en 0,1–2 s.
     2. La IA más rápida que tenga (propia o la de Noviq): charla, enseñar,
        planear, usar sus herramientas (internet, abrir, portapapeles…).
     3. Sus bots delegados (pc, proyectos, web…) para lo que lleva varios pasos.
     4. Noviq (si está abierto): SOLO para programar (crear o cambiar software)
        o si se lo pides a Noviq por su nombre.
   ========================================================================== */
const U = require('./util');
const { RX_DISPOSITIVO } = require('./rapido');
const T = require('./tiempo');
const P = require('./personalidad');
const S = require('./saberes');
const AT = require('./voz/atencion');

const { norm, corto, ahora, elegir } = U;

/* ------------------------------------------------- Palabra de activación */
// (2.5.1) + «Nodi», «Nomiq», «Nuvic»: así lo transcribió Whisper el 10-10 y lo tomaba como «le habla a otra persona»
const NOVIQ = '(?:no\\s?vi[ckqt]k?(?:ue)?|nobi[ckqt]k?|nov[iy][ckqt]k?|nubi[ckq]k?|robi[ckq]k?|novich|novix|novi|nobi|nodi[ckqt]?k?|nomi[ckqt]k?|nuvi[ckqt]?k?)';
function rxNombre(nombre, variantes) {
  const nn = norm(nombre || 'Noviq');
  const alts = [nn === 'noviq' ? NOVIQ : nn.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s?')];
  if (nn !== 'noviq') alts.push(NOVIQ);   // «Noviq» sigue funcionando aunque le pongas otro nombre
  for (const v of String(variantes || '').split(',').map(norm).filter(Boolean)) alts.push(v.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '\\s?'));
  return '(?:' + alts.join('|') + ')';
}

// pedir que CREE algo en Word / un documento (no «abre el documento X», que es del bot de PC)
const RX_DOC_GENERICO = /\b(crea\w*|haz|hazme|hacer|prepara\w*|escrib\w*|redact\w*|arma\w*|genera\w*|elabora\w*)\b.*\b(en|un|una|como)\s+(un\s+|una\s+|el\s+)?(documento|archivo)?\s*(de\s+)?(word|docx)\b|\b(crea\w*|haz|hazme|prepara\w*|escrib\w*|redact\w*|elabora\w*)\b.*\b(documento|informe|ensayo|resumen)\b/;
// La IA dice que HACE algo… pero contesta «charla» (no delegó ni usó nada): el 10-10 decía «acabo de delegar al bot»,
// «voy a leer el documento», «estoy delegando» y no pasaba nada. Esto lo detecta y lo cumple (o lo dice claro).
const RX_PROMESA = /\b(acabo de (delegar|pedir|pasar|mandar|encargar|crear|hacer|abrir|enviar)|estoy (delegando|trabajando en|haciendo|creando|escribiendo|leyendo|revisando|buscando|analizando|preparando)|sigo (delegando|trabajando|revisando)|(voy a|ahora mismo|enseguida|ya mismo) (delegar|pedir|pasar|mandar|encargar|crear|hacer|escribir|leer|leerte|revisar|buscar|abrir|capturar|analizar|investigar|retomar|preparar|generar)|le (pido|paso|mando|encargo) (a|al) (mi |un )?bot|retomo (la|el) (tarea|trabajo)|ya (esta|quedo) (creado|listo|hecho|abierto|guardado))\b/;
// «no escucho que estés leyendo el archivo» habla de la LECTURA, no de su voz
const RX_SOBRE_LEER = /\b(le(e|er|as|yendo|iste)|archivo|documento)\b/;
// un bot respondió que NO puede (y no dejó un archivo): con Noviq abierto se le pasa a Noviq
const RX_NO_PUEDO = /\b(no (puedo|pude|logre|consegui|es posible|encontre como|tengo (herramientas|como|acceso|la herramienta)|dispongo)|fuera de mis capacidades|solo (manejo|puedo)|sin herramientas para|no tengo forma)\b/;
const SI = /^(si|sip|claro|dale|ok|okay|vale|adelante|aprueba\w*|hazlo|de acuerdo|correcto|por supuesto|continua\w*|sigue|yes|sure|go ahead|approve\w*)\b/;
const NO = /^(no|nop|nel|rechaza\w*|cancela\w*|mejor no|no lo hagas|nope|deny|reject)\b/;
const CTRL = {
  callar: /^(callate|silencio|shh+|quiet|be quiet|shut up|ya callate)\b/,
  // mientras lee un documento: «para», «detente», «basta», «ya»
  pararLectura: /^(para|parale|detente|deten|basta|stop|ya esta|ya basta|suficiente|deja de leer|no leas mas)\b/,
  // 🩺 «hazte un autodiagnóstico», «revisa tus errores», «dame un informe de tus errores», «¿qué te pasa?»
  diagnostico: /\b(auto ?diagnostico|diagnosticate|haz(te)? un diagnostico|revisa(te)? (tus|los|que) (errores|fallos|problemas)|que (errores|fallos|problemas) tienes|(informe|reporte) de (tus )?(errores|fallos|problemas)|por que no (estas )?(funcionas|funcionando)|que te (esta )?pasa(ndo)?|revisa(te)? (lo )?que te (esta )?pasa(ndo)?|analiza (que|lo que) te (esta )?pasa(ndo)?)\b/,
  // 🤝 «pásaselo a Noviq / que lo haga Noviq»
  aNoviq: /\b(pasa(selo|lo)? a noviq|que lo haga noviq|manda(selo|lo)? a noviq|hazlo (con|en) noviq|usa (a )?noviq)\b/,
  dormir: /^(duerme\w*|a dormir|descansa\w*|go to sleep|sleep)\b/,
  despertar: /^(despierta\w*|wake up)\b/,
  ocultar: /^(escondete|ocultate|vete|desaparece|hide)\b/,
  mostrar: /^(ven|aparece|muestrate|ven aca|come here|show yourself)\b/,
  micOff: /(deja de escuchar|no escuches|apaga el microfono|stop listening|mute)/,
  ajustes: /^(abre |muestra(me)? |ensena(me)? )?(tus ajustes|tu configuracion|tus configuraciones|configuracion del avatar|ajustes del avatar)\b/,
  // 🔊 su propia voz: «habla en voz alta», «no te escucho», «solo estás escribiendo», «revisa tu motor de voz»
  vozOn: /\b(habla(me)? en voz alta|activa (tu|la) voz|enciende (tu|la) voz|prende (tu|la) voz|usa (tu|la) voz|quiero escucharte|habla por (los|el) (parlantes|altavoces|bocinas)|no te (escucho|oigo)|no (suenas|se te oye|se te escucha)|no (estas|me estas) hablando|solo (estas )?(escribiendo|haces (ruidos|sonidos))|solo (estas )?haciendo (ruidos|sonidos)|revisa tu (motor de )?voz|tu voz no (sale|suena|funciona))\b/,
  vozOff: /\b(no hables en voz alta|habla solo (con|en) texto|solo (escribe|escribeme|en burbujas)|desactiva (tu|la) voz|apaga (tu|la) voz|silencia tu voz|sin voz)\b/
};
const RX = {
  saludo: /^(hola|holi|ola|buenas|buenos dias|buen dia|buenas tardes|buenas noches|hey|que tal|que hubo|quiubo|saludos|hello|hi|good morning)\b/,
  despedida: /^(adios|chao|chau|hasta luego|hasta manana|nos vemos|me voy|bye|see you)\b/,
  gracias: /^(gracias|muchas gracias|mil gracias|te agradezco|thanks|thank you|grax)\b/,
  como_estas: /^(como estas|que tal estas|como te va|como andas|como te sientes|how are you)\b/,
  quien: /^(quien eres|que eres|cual es tu nombre|como te llamas|que puedes hacer|que sabes hacer|who are you)\b/,
  mi_nombre_q: /(como me llamo|sabes (como me llamo|mi nombre)|cual es mi nombre|quien soy yo|what s my name)/,
  hora: /^(que hora es|que horas son|dime la hora|me dices la hora|what time is it)/,
  fecha: /(que dia es hoy|que fecha es hoy|a que fecha estamos|en que fecha estamos|what day is (it|today))/,
  recuerdame: /^(recuerdame|avisame|remind me|pon(me)? un recordatorio|pon(me)? una alarma)\b\s*(.*)$/,
  recuerda: /^(recuerda que|acuerdate (de )?que|no olvides que|anota que|guarda que|apunta que|remember that)\s+(.+)$/,
  que_sabes: /(que sabes de mi|que recuerdas de mi|que sabes sobre mi|what do you know about me)/,
  olvida: /^(olvida|olvidate de|borra de tu memoria|forget)\s+(que\s+)?(.+)$/,
  agenda: /(que tengo (para )?(hoy|manana)|mi agenda|que hay para (hoy|manana)|mis recordatorios|que planes tenemos|que ibamos a hacer|what do i have)/,
  chiste: /(cuentame un chiste|dime un chiste|un chiste|tell me a joke)/,
  dato: /^(dime algo interesante|cuentame algo( interesante| curioso)?|dame un dato( curioso| interesante)?|ensename algo( nuevo| interesante)?)$/,
  trabajar: /^(vamos a |voy a |quiero |empecemos a |a )?(trabajar|seguir|continuar)( trabajando)? (en|con) (el |la )?(proyecto )?(.+)$/,
  salir_proy: /(ya )?(terminamos|salgamos|sal|salir|dejemos) (con |del |de |el )?(el )?proyecto/,
  nuevo: /(empecemos|empezar|comencemos|vamos a (empezar|crear|hacer)) (algo nuevo|un proyecto nuevo|un nuevo proyecto|desde cero)/,
  clip_q: /(que (copie|he copiado|tengo copiado)|lee lo que copie|leeme lo que copie|que hay en el portapapeles)/,
  en_chat: /\b(en este chat|aqui en el chat|en el chat abierto|en esta conversacion)\b/,
  personalidad: /^(se|ponte|estate|volvete|vuelvete|modo|actua|habla|cambia tu personalidad a|personalidad)\s+(.*)$/,
  normal: /^(se normal|vuelve a (ser )?normal|como antes|personalidad normal|resetea tu personalidad)/,
  trabajos_q: /^(como va(n)?( todo| eso| el trabajo| lo que (te|les) pedi)?|que (estas|estan|andas|andan) haciendo|en que (estas|andas|estan)|ya (terminaste|terminaron|acabaste|esta listo)|que (tal|como) va(n)?|estado de (tus |los )?(trabajos|bots|tareas)|que trabajos tienes|como van los bots)\b/,
  // (2.6) «¿ya hiciste el documento?», «¿estás trabajando en ello o no?», «eso ya lo hiciste hace media hora y nada»
  trabajos_q2: /\b(como (vas|vamos)( con)?|ya (hiciste|creaste|escribiste|terminaste|acabaste|lo hiciste|esta (listo|hecho)|quedo)|(estas|sigues) (trabajando|haciendo(lo)?)( en (eso|ello|el|la|lo))?|lo (hiciste|estas haciendo) o no|que (paso|fue) con (el|la|lo|mi|ese|esa) (documento|trabajo|tarea|resumen|archivo|pedido)|(ya )?lo hiciste hace .* y nada|cuanto (te )?falta|avanzaste)\b/,
  trabajos_stop: /^(cancela|cancelame|detiene|deten|detenga|para|parame|aborta)\s+(todo|los trabajos|las tareas|lo que (estas|estan) haciendo|a los bots|los bots)\b/,
  mira: /(\bque (ves|estas viendo|ves ahi|ves ahora)\b|\bme ves\b|\bcomo me ves\b|\bque hay en (la |mi )?camara\b|\bmira(me)? (a )?(la |por la )?camara\b|^mirame\b|^(mira|echa un vistazo a?|ve) (esto|lo que (tengo|hay|llevo)|que tengo|como (estoy|ando|me veo))|\bque tengo (en la mano|puesto|aqui|enfrente)\b|\bdescribe (lo que ves|la imagen|lo que hay)|\bque (dice|hay) (aqui|en esto|en este (papel|texto|cartel))\b|^lee (esto|lo que (dice|tengo)) (que tengo )?(en la camara|aqui|enfrente)?$)/,
  mira_pantalla: /(\bque (hay|ves|estas viendo|aparece) en (mi |la )?pantalla\b|\bmira (mi |la )?pantalla\b|\bdescribe (mi |la )?pantalla\b|\bque (estoy|estamos) viendo\b)/,
  abre: /^(abre|abreme|abrir|open|lanza|inicia|ejecuta)\s+(el |la |los |las |mi |mis )?(.+)$/,
  voz_rapida: /^(habla|hablame) (mas )?(rapido|despacio|lento|normal)\b/,
  ayuda: /^(que (mas )?(puedes|sabes) hacer|que haces|ayuda|en que me (puedes )?ayudar|para que sirves|que cosas (puedes|sabes) hacer|what can you do|help)\b/,
  clima: /(que (clima|tiempo) (hace|hay|habra|va a hacer|tendremos)|como (esta|estara|va a estar) el (clima|tiempo)|^(el )?clima\b|\bel clima (de|en|para)\b|va a llover|llovera|esta lloviendo|pronostico|cuantos grados (hace|hay)|que temperatura (hace|hay)|hace (mucho )?(calor|frio) (en|hoy))/,
  noticias: /^(dame |dime |cuentame |leeme |lee |quiero )?(las |unas )?(ultimas |principales )?(noticias|titulares)( de hoy| del dia| de ahora)?( (de|sobre|del|acerca de) (.+))?$|^que (noticias hay|hay de nuevo|esta pasando en el mundo)\b/,
  conv1: /^(?:cuantos?|cuantas?)\s+(.+?)\s+(?:son|hay en|equivalen a|tiene|caben en)\s+([\d.]+|un|una|uno)\s+(.+?)$/,
  conv2: /^(?:convierte|convierteme|pasa|pasame|cambia|cuanto es|cuanto son|a cuanto equivalen?|cuanto equivalen?)\s+([\d.]+|un|una|uno)\s+(.+?)\s+(?:a|en)\s+(.+?)$/,
  dias_hasta: /^cuantos dias (faltan?|quedan?) (para|hasta)\s+(.+)$/,
  temporizador: /^(?:pon(?:me)?|activa|inicia|programa)\s+(?:un |una )?(?:temporizador|cronometro|timer|cuenta regresiva)\s+(?:de |por |para )?(.+)$|^(?:temporizador|timer)\s+(?:de\s+)?(.+)$/,
  musica: /^(?:pon(?:me)?|reproduce|quiero (?:escuchar|ver)|busca en youtube|abre en youtube)\s+(.+)$/,
  google: /^(?:busca(?:me)?|googlea)\s+(?:en google\s+)(.+)$|^(?:busca(?:me)?|googlea)\s+(.+?)\s+en (?:google|el navegador|internet)$/,
  busca: /^(?:busca(?:me)?|investiga|averigua)\s+(?:sobre |acerca de |informacion (?:de|sobre) )?(.+)$/,
  wiki: /^(?:que es (?:el |la |los |las |un |una )?|que son (?:los |las )?|quien es |quien era |quien fue |quienes son |quienes fueron |que significa |define |definicion de |hablame (?:de|sobre) |cuentame (?:de|sobre) |que sabes (?:de|sobre) (?!mi\b))(.+)$/
};
const RX_ORDEN = /^(crea|creame|crear|haz|hazme|programa|programame|genera|desarrolla|construye|instala|descarga|envia|manda|redacta|ordena|organiza|borra|elimina|mueve|copia|convierte|compila|prueba|actualiza|agrega|anade|cambia|modifica|limpia|arregla|corrige|repara|revisa)\b/;
const RX_PC = /\b(proyecto|archivo|archivos|carpeta|programa|app|aplicacion|pagina web|sitio web|juego|script|codigo|correo|correos|email|excel|word|pdf|documento|descargas|escritorio|pantalla|windows|pc|computadora|servidor|base de datos|repositorio|github|python|javascript|html|instalador|zip|imagen|imagenes|foto|video)\b/;
const RX_NOMBRE_DICE = /\b(?:me llamo|mi nombre es|ll[aá]mame|puedes llamarme|my name is|call me)\s+([A-Za-zÁÉÍÓÚÑáéíóúñ][\wáéíóúñÁÉÍÓÚÑ]+(?:\s+[A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)?)/i;
const RX_SOY = /^\s*(?:soy|i am|i'm)\s+([A-ZÁÉÍÓÚÑ][\wáéíóúñ]+)\s*[.!]?\s*$/;
const RX_ENSENA = /(?:cuando te (?:diga|pregunte)|si te (?:digo|pregunto))\s+[«"']?(.+?)[»"']?\s*,?\s*(?:responde(?: con)?|dime|di|contesta)\s+[«"']?(.+?)[»"']?\s*$/i;

const ESQUEMA = `Responde SOLO un JSON (sin texto fuera):
{"respuesta": "lo que dices en voz alta",
 "accion": "charla | herramienta | delegar | ver | ejecutar | plan | recordatorio | cancelar_plan",
 "bot": "si accion=delegar: id del bot interno (de la lista de bots)", "orden": "si accion=delegar: la orden COMPLETA y concreta para ese bot (qué hacer, con qué datos)",
 "tareas": "si accion=delegar y hay VARIAS cosas independientes: lista de {\\"bot\\":…,\\"orden\\":…} que trabajarán en paralelo",
 "mirar": "si accion=ver: lo que quieres saber de la imagen; fuente: camara | pantalla",
 "herramienta": {"nombre": "…", "args": {}},
 "tarea": "si accion=ejecutar: instrucción COMPLETA y concreta para Noviq (qué hacer, dónde, con los detalles que dio el usuario)",
 "proyecto": "nombre EXACTO de un proyecto de la lista si la tarea es de ese proyecto, o \\"\\"",
 "plan": "si accion=plan: resumen actualizado de lo que el usuario quiere lograr (todavía NO se ejecuta)",
 "que": "si accion=recordatorio: qué recordar", "cuando": "si accion=recordatorio: cuándo, en palabras",
 "recordar": ["datos NUEVOS y duraderos del usuario (gustos, trabajo, familia, metas…), cada uno en una frase"],
 "nombre": "nombre del usuario si lo acaba de decir, o \\"\\"",
 "emocion": "feliz | sonrisa | risa | sorpresa | pensando | triste | atento | confundido | guino",
 "gesto": "opcional: saludar | reir | celebrar | aclarar | asentir | negar | bailar | pensar",
 "aprender": false}`;

/** Algunos modelos (qwen, llama) responden con su formato nativo de herramientas en vez del JSON pedido:
 *  «<tool_call><function=portapapeles_leer>…» → {accion:'herramienta', herramienta:{nombre, args}} (nunca se dice en voz alta). */
function llamadaNativa(texto) {
  const t = String(texto || '');
  let m = t.match(/<function=([\w.-]+)>([\s\S]*?)(?:<\/function>|$)/);
  if (m) {
    const args = {};
    for (const p of m[2].matchAll(/<parameter=([\w.-]+)>\s*([\s\S]*?)\s*<\/parameter>/g)) args[p[1]] = p[2];
    return { accion: 'herramienta', herramienta: { nombre: m[1], args }, respuesta: '' };
  }
  m = t.match(/<tool_call>\s*(\{[\s\S]*?\})\s*(?:<\/tool_call>|$)/);
  if (m) { const j = U.jsonDe(m[1]); if (j && j.name) return { accion: 'herramienta', herramienta: { nombre: j.name, args: j.arguments || j.parameters || {} }, respuesta: '' }; }
  return null;
}
const limpiarMarcas = (t) => String(t || '').replace(/<\/?(tool_call|function|parameter)[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();

/** Texto de un documento → partes para decir en voz alta (párrafos; los largos, por oraciones; sin URLs). */
function partirParaLeer(texto) {
  const out = [];
  const pars = String(texto || '').replace(/https?:\/\/\S+/g, '').replace(/[*#>`|]/g, ' ').split(/\n+/).map((p) => p.replace(/\s+/g, ' ').trim()).filter((p) => /[\p{L}\p{N}]/u.test(p));
  for (const p of pars) {
    if (p.length <= 420) { out.push(p); continue; }
    let actual = '';
    for (const o of p.split(/(?<=[.!?;:])\s+/)) {
      if (actual && (actual + ' ' + o).length > 380) { out.push(actual); actual = o; }
      else actual = actual ? actual + ' ' + o : o;
    }
    if (actual) out.push(actual);
  }
  return out;
}

class Mente {
  /**
   * @param {object} o {ajustes, memoria, cerebro, herramientas, noviq, cuerpo(cmd), emitir(n,d), abrirAjustes(), abrirNoviq(), log}
   */
  constructor(o) {
    Object.assign(this, { aj: o.ajustes, mem: o.memoria, cerebro: o.cerebro, herr: o.herramientas, noviq: o.noviq,
      cuerpo: o.cuerpo || (async () => ({})), emitir: o.emitir || (() => {}), abrirAjustes: o.abrirAjustes || (() => {}),
      abrirNoviq: o.abrirNoviq || (async () => false), log: o.log || (() => {}), agentes: o.agentes || null, vision: o.vision || null, rapido: o.rapido || null,
      voz: o.voz || null, escucha: o.escucha || null, rutaNoviq: o.rutaNoviq || null, estadoSistema: o.estadoSistema || (() => ({})) });
    this.lectura = null;         // documento que está leyendo en voz alta: {id, titulo, partes, i, cancelada}
    this.ultimaVoz = null;       // último segmento ACEPTADO: {acustica, texto, t} (para «eso fue la tele»)
    this.aprendiendoVoz = 0;     // «aprende mi voz»: cuántas frases faltan
    this.ultimoDicho = { texto: '', t: 0, pregunta: false };
    this.pend = {};              // pregunta propia abierta: nombre | recordatorio | portapapeles
    this.preguntaApp = null;     // {id, app, texto, hasta, tipo}
    this.ventanaLibre = 0;       // hasta cuándo (ms) acepta frases sin su nombre (charla fluida)
    this.clips = [];             // portapapeles reciente (solo RAM)
    this.e = { pensando: false, ultimaCharla: 0, ofertaClip: 0, actividad: Date.now(), dormido: false, tIniciativa: Date.now() };
  }

  /** Un paso de «aprende mi voz». Devuelve la respuesta de oir(), o null si la frase debe seguir su camino normal. */
  pasoAprenderVoz(texto, op) {
    const esc = this.escucha;
    const n = norm(texto);
    const fin = (msg, tipo) => { this.aprendiendoVoz = 0; if (msg) this.decir(msg, tipo || 'info'); };
    if (!esc || !esc.perfil || Date.now() - (this.tAprenderVoz || 0) > 180000) { fin(); return null; }
    if (/^(cancela|para|deja|ya no|olvidalo|basta|detente)\b/.test(n)) { fin('Vale, dejo de aprender tu voz por ahora.'); return { ok: true, texto, accion: 'aprender_voz' }; }
    if (!op.acustica) return null;   // escrito o sin audio: no cuenta (no lo bloquea)
    const ok = esc.perfil.aprender(op.acustica, 'usuario', 2);
    // una orden con mi nombre o «eso fue la tele» siguen su camino (igual aprendí la voz)
    if (this.quitarNombreEnMedio(texto) !== null || AT.RX_FUE_RUIDO.test(n)) { if (ok) this.aprendiendoVoz--; return null; }
    this.actividad();
    this.intentosVoz = (this.intentosVoz || 0) + 1;
    if (ok) this.aprendiendoVoz--;
    if (!ok && this.intentosVoz >= 8) { this.intentosVoz = 0; fin(esc.perfil.listo() ? 'Con lo que oí ya reconozco tu voz. Listo.' : 'No logro oírte bien (¿micrófono lejos o con ruido?). Lo intentamos luego.'); return { ok: true, texto, accion: 'aprender_voz' }; }
    if (this.aprendiendoVoz <= 0) {
      this.intentosVoz = 0;
      const e = esc.perfil.estado();
      fin(`¡Listo! Ya conozco tu voz (${e.usuario} muestras). Si la tele me confunde, dime «eso fue la tele» y aprendo cómo suena.`, 'exito');
      return { ok: true, texto, accion: 'aprender_voz' };
    }
    this.decir(ok ? `Bien. ${this.aprendiendoVoz === 1 ? 'Una frase más' : 'Otra frase'}, por favor.` : 'No te oí bien. Repite con una frase un poco más larga, por favor.', 'escuchando');
    return { ok: true, texto, accion: 'aprender_voz', escuchar_otra_vez: true };
  }

  /* ------------------------------------------------------ 📖 Leer en voz alta */
  /**
   * Lee un documento EN VOZ ALTA, completo y por partes (el abierto en Word o uno de sus documentos). «para» lo detiene.
   * El 10-10 le pediste cinco veces «léelo todo» y solo te repetía un resumen de una frase: no tenía cómo leer.
   */
  async leerDocumento(o, origen) {
    const D = this.rapido && this.rapido.documentos;
    if (!D) return this.r('Ahora no tengo acceso a los documentos.');
    const doc = await D.textoParaLeer({ nombre: o.nombre, pantalla: o.pantalla });
    if (!doc.ok && o.pantalla && this.vision) {   // no hay Word: lee lo que se ve en la pantalla
      return { respuesta: 'Miro tu pantalla y te leo lo que dice.', accion: 'ver', fuente: 'pantalla', via: 'reflejo', leer: true,
        mirar: 'Lee en voz alta, palabra por palabra, el texto principal que se ve en la pantalla (máximo 150 palabras). Si no hay texto, di qué se ve.' };
    }
    if (!doc.ok) return this.r(doc.error, 'charla', { tipo: 'pregunta', escuchar: true });
    const partes = partirParaLeer(doc.texto);
    if (!partes.length) return this.r(`«${corto(doc.titulo, 60)}» está vacío.`);
    const palabras = doc.texto.split(/\s+/).filter(Boolean).length;
    const min = Math.max(1, Math.round(palabras / (150 * (this.d.voz.velocidad || 1))));
    if (this.lectura) this.lectura.cancelada = true;
    const L = this.lectura = { id: Date.now(), titulo: doc.titulo, partes, i: 0, cancelada: false };
    const conVoz = !!this.d.voz.activada;
    const intro = `Te leo «${corto(doc.titulo, 60)}»${doc.fuente === 'word' ? ', el que tienes abierto en Word' : ''}: ${palabras} palabras, ${min === 1 ? 'más o menos un minuto' : 'unos ' + min + ' minutos'}. Dime «para» cuando quieras.` +
      (conVoz ? '' : ' Tengo la voz apagada, así que va en burbujas; para oírlo dime «habla en voz alta».');
    (async () => {
      try {
        await this.decir(intro, 'info');
        for (; L.i < L.partes.length; L.i++) {
          if (L.cancelada || this.lectura !== L) return;
          this.actividad();
          await this.decir(L.partes[L.i], 'charla');
        }
        if (this.lectura === L) { this.lectura = null; this.decir('Ese es todo el documento.', 'exito'); this.ventanaLibre = Date.now() + 8000; }
      } catch (e) { this.log('leer: ' + e.message); }
    })();
    return { respuesta: intro, accion: 'leer', via: 'reflejo', yaDicho: true, documento: doc.ruta || doc.titulo };
  }

  /** «para» o un clic mientras lee: deja de leer. */
  pararLectura() { if (this.lectura) { this.lectura.cancelada = true; this.lectura = null; return true; } return false; }

  /* ------------------------------------------------------ 🩺 Autodiagnóstico */
  /**
   * Revisa su estado REAL (voz, oído, PowerShell, IA, Noviq, trabajos que fallaron) y lo dice claro. El 10-10 la IA
   * inventó «bloqueos del antivirus, controladores, permisos» y recomendó desactivar el antivirus: eso no vuelve a pasar.
   */
  async autodiagnostico(texto) {
    const s = this.estadoSistema() || {};
    const d = this.d, mal = [], bien = [], arreglos = [];
    // voz
    const vz = s.voz || {};
    if (!d.voz.activada) { mal.push('mi voz está apagada (solo escribo en burbujas)'); arreglos.push('dime «habla en voz alta»'); }
    else if (vz.error) mal.push(`mi voz moderna falló (${corto(vz.error, 90)}); uso la de Windows`);
    else bien.push(`voz encendida${vz.motor ? ' (' + vz.motor + ')' : ''}`);
    // oído
    const oi = s.oido || {};
    if (d.oido.modo === 'apagado') mal.push('el micrófono está apagado');
    if (oi.ultimo && oi.ultimo.error) mal.push(`el oído (${oi.ultimo.motor || '?'}) falló: ${corto(oi.ultimo.error, 90)}`);
    const pv = this.escucha && this.escucha.perfil ? this.escucha.perfil.estado() : null;
    if (pv && !pv.listo) { mal.push('todavía no conozco bien tu voz'); arreglos.push('dime «aprende mi voz» (4 frases)'); }
    const am = this.escucha && this.escucha.ambiente ? this.escucha.ambiente.estado() : null;
    if (am && am.tv) { mal.push(`hay mucha voz de fondo (ignoré ${am.ignorados} frases en el último minuto y medio)`); arreglos.push(d.oido.modo === 'siempre' ? 'con la tele puesta usa el modo «cuando lo llamo» y di «Noviq…» al hablarme' : 'di «Noviq…» al hablarme'); }
    // PowerShell (las órdenes del PC)
    const ps = s.ps;
    if (ps && ps.modo) {
      const nada = !/^ok$/.test(ps.stdin || '') && !/^ok$/.test(ps.argumento || '') && !/^ok$/.test(ps.linea || '');
      if (nada) { mal.push('PowerShell no responde: las órdenes del PC (abrir, apagar, Word) pueden fallar'); arreglos.push('reinicia la PC; si sigue igual, revisa si algún programa de seguridad bloquea powershell.exe (yo nunca toco el antivirus)'); }
      else if (ps.modo === 'linea') { mal.push('PowerShell solo me responde en órdenes de una línea: las de Word y las largas pueden fallar'); }
      else if (ps.modo !== 'stdin') bien.push('PowerShell funciona (como argumento; por la entrada estándar no responde en este PC, ya lo tengo en cuenta)');
      else bien.push('PowerShell funciona');
    }
    // IA: la que uso y si la principal se queda sin cuota (entonces respondo con una más débil)
    const ce = s.cerebro || {};
    if (ce.error) mal.push(`mi IA (${ce.proveedor || '?'}) falló hace poco: ${corto(ce.error, 110)}`);
    else if (ce.proveedor) bien.push(`IA: ${ce.proveedor}${ce.modelo ? ' · ' + ce.modelo : ''}`);
    for (const a of (ce.avisos || []).slice(0, 2)) {
      const porque = { cuota: 'se quedó sin cuota gratis', credito: 'no tiene crédito', clave: 'rechazó la clave', red: 'no respondió (red)', tiempo: 'tardó demasiado' }[a.tipo] || 'falló';
      mal.push(`la IA ${a.proveedor} ${porque} ${a.fallos} ${a.fallos === 1 ? 'vez' : 'veces'} hace poco${ce.proveedor && ce.proveedor !== a.proveedor ? `; entonces respondo con ${ce.proveedor}${ce.modelo ? ' (' + ce.modelo + ')' : ''}, que es más débil` : ''}`);
      if (a.tipo === 'cuota' || a.tipo === 'credito') arreglos.push(`agrega otra clave gratis en mis Ajustes → Cerebro (Gemini, Cerebras u OpenRouter) para cuando ${a.proveedor} se agote`);
    }
    // Noviq
    if (this.conNoviq()) bien.push('conectado con Noviq (le paso lo que mis bots no pueden)');
    else if (this.noviq && this.d.noviq.usar) bien.push('trabajo solo: Noviq está cerrado (si algo no lo puedo hacer, te ofrezco abrirlo)');
    // trabajos de los bots
    const js = this.agentes ? this.agentes.trabajos().slice(0, 8) : [];
    const malos = js.filter((j) => j.estado === 'error' || (RX_NO_PUEDO.test(norm(j.resultado || '')) && !/\.docx/.test(j.resultado || '')));
    if (malos.length) mal.push(`${malos.length} de mis últimos ${js.length} trabajos salieron mal: ` + malos.slice(0, 3).map((j) => `${j.botNombre.replace(/^Bot de /, '')} — ${corto(j.resultado, 70)}`).join(' | '));
    else if (js.length) bien.push(`mis últimos ${js.length} trabajos salieron bien`);
    const reporte = { fecha: `${U.fechaTxt()} ${U.horaTxt()}`, mal, bien, arreglos, ps, oido: { modo: d.oido.modo, filtro: d.oido.filtro, perfil: pv, ambiente: am, ultimo: oi.ultimo || null },
      ia: ce, trabajos: js.map((j) => ({ bot: j.botNombre, estado: j.estado, orden: corto(j.orden, 120), resultado: corto(j.resultado, 200) })) };
    this.log('[diagnóstico] ' + JSON.stringify({ mal, bien, arreglos }));
    let dicho = mal.length ? `Encontré ${mal.length === 1 ? 'un problema' : mal.length + ' problemas'}: ${mal.slice(0, 3).join('; ')}${mal.length > 3 ? '; y más' : ''}.` + (arreglos.length ? ' Para arreglarlo: ' + arreglos.slice(0, 3).join('; ') + '.' : '')
      : `No encontré errores ahora: ${bien.slice(0, 4).join(', ')}.`;
    if (/\b(informe|reporte|documento|word|escrito)\b/.test(norm(texto))) dicho += ' ' + this.guardarInforme(reporte);
    else { this.pend = { tipo: 'informe_diag', reporte, t: ahora() }; dicho += ' ¿Te lo dejo completo en un documento de Word?'; }
    return this.r(dicho, 'charla', { tipo: mal.length ? 'atencion' : 'exito', escuchar: /\?$/.test(dicho) });
  }
  guardarInforme(rep) {
    const D = this.rapido && this.rapido.documentos;
    if (!D) return 'No pude guardar el informe.';
    const L = [`# Diagnóstico del avatar`, '', `*${rep.fecha}*`, '', '## Problemas', '', ...(rep.mal.length ? rep.mal.map((x) => '- ' + x) : ['- Ninguno']),
      '', '## Cómo arreglarlos', '', ...(rep.arreglos.length ? rep.arreglos.map((x) => '- ' + x) : ['- Nada que hacer']), '', '## Lo que funciona bien', '', ...rep.bien.map((x) => '- ' + x),
      '', '## Detalles', '', `- PowerShell: ${rep.ps ? `por la entrada ${rep.ps.stdin || '?'} · como argumento ${rep.ps.argumento || '?'} · en una línea ${rep.ps.linea || '?'} → uso «${rep.ps.modo}»` : 'sin datos'}`,
      `- Oído: modo ${rep.oido.modo}, filtro ${rep.oido.filtro || 'normal'}${rep.oido.perfil ? `, tu voz ${rep.oido.perfil.usuario} muestras, fondo ${rep.oido.perfil.fondo}` : ''}${rep.oido.ultimo && rep.oido.ultimo.motor ? `, último motor ${rep.oido.ultimo.motor}` : ''}`,
      `- IA: ${rep.ia.proveedor || '?'} ${rep.ia.modelo || ''}${rep.ia.error ? ' — último error: ' + rep.ia.error : ''}`,
      '', '## Últimos trabajos de los bots', '', ...(rep.trabajos.length ? rep.trabajos.map((j) => `- **${j.bot}** (${j.estado}): ${j.orden} → ${j.resultado}`) : ['- Ninguno'])];
    try { const r = D.crear({ titulo: 'Diagnóstico del avatar', contenido: L.join('\n') }); return `Dejé el informe completo en Word: «${r.titulo}».`; }
    catch (e) { return 'No pude guardar el informe: ' + e.message; }
  }

  /* --------------------------------------------- 🤝 Noviq: lo que yo no puedo */
  /** «pásaselo a Noviq»: lo último que pediste (si esta frase es solo eso) va a sus agentes. */
  async pasarANoviq(texto) {
    // (sin tildes para reconocer «pásaselo»)
    let tarea = texto.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\b(pasa(selo|lo)?|manda(selo|lo)?|que lo haga|hazlo (con|en)|usa( a)?)\s+(a\s+)?noviq\b[.,!]?/i, '').replace(/^[\s,.;:¡!¿?-]+|[\s,.;:¡!¿?-]+$/g, '').trim();
    if (tarea.split(/\s+/).length >= 3) tarea = texto;   // la orden venía en la misma frase («busca X y pásaselo a Noviq»)
    if (tarea.split(/\s+/).length < 3) {
      const previo = this.mem.m.charla.slice(0, -1).reverse().find((c) => c.rol === 'user' && !CTRL.aNoviq.test(norm(c.texto)));
      tarea = previo ? previo.texto : '';
    }
    if (!tarea) return this.r('¿Qué le paso a Noviq?', 'charla', { tipo: 'pregunta', escuchar: true });
    const r = await this.encargarANoviq(tarea, 'voz', 'El usuario pidió que lo haga Noviq.');
    return this.r(r.respuesta, 'charla', { tipo: r.ok ? 'trabajando' : r.tipo || 'info', escuchar: !r.ok && !!r.pregunta });
  }
  /** Manda un trabajo a los agentes de Noviq. Sin Noviq abierto: pregunta si lo abre (y luego se lo pasa). */
  async encargarANoviq(tarea, origen, nota) {
    if (!this.noviq || !this.d.noviq.usar) return { ok: false, respuesta: 'No tengo cómo hacer eso yo solo y no estoy usando a Noviq (está desactivado en mis ajustes).' };
    if (!this.conNoviq()) {
      this.pend = { tipo: 'abrir_noviq', tarea, t: ahora() };
      return { ok: false, pregunta: true, tipo: 'pregunta', respuesta: 'Eso lo puede hacer Noviq, pero está cerrado. ¿Lo abro y se lo paso?' };
    }
    const u = this.mem.usuario();
    const r = await this.noviq.tarea({ tarea: `${tarea}\n\n(Pedido al avatar${u ? ' por ' + u : ''}.${nota ? ' ' + nota : ''})`, proyecto: this.mem.proyectoActivo(), origen: origen || 'voz' }).catch((e) => ({ ok: false, error: e.message }));
    if (r && r.ok) { this.mem.contar('a_noviq'); return { ok: true, conv: r.conv, respuesta: 'Se lo pasé a Noviq; te aviso cuando termine.' }; }
    return { ok: false, respuesta: 'No pude pasárselo a Noviq: ' + ((r && r.error) || 'no respondió') + '.' };
  }
  /** «sí, ábrelo»: abre Noviq, espera a que conecte (hasta 90 s) y le pasa el trabajo. */
  async abrirYEncargar(tarea, origen) {
    try {
      if (!this.conNoviq()) await this.abrirNoviq();
      const t0 = Date.now();
      while (!this.conNoviq() && Date.now() - t0 < 90000) { await new Promise((r) => setTimeout(r, 2000)); if (this.noviq.latido) await this.noviq.latido().catch(() => {}); }
      if (!this.conNoviq()) { this.decir('Noviq no terminó de abrir. Cuando lo veas listo, dime «pásaselo a Noviq».', 'error'); return; }
      const r = await this.encargarANoviq(tarea, origen);
      this.mem.registrar('assistant', r.respuesta, origen);
      this.decir(r.respuesta, r.ok ? 'trabajando' : 'error');
    } catch (e) { this.log('abrir Noviq: ' + e.message); }
  }

  /**
   * Revisa lo que decidió la IA ANTES de decirlo (las IAs gratis/pequeñas inventan):
   * · dice que hace algo y no hace nada → se cumple de verdad (o se dice claro que no se puede);
   * · delega pero dice «listo, ya está creado» → se cambia por un aviso honesto;
   * · nunca recomienda desactivar el antivirus (el 10-10 lo hizo sin ningún dato).
   */
  async verificarDecision(d, texto, origen) {
    const acc = String(d.accion || 'charla').toLowerCase();
    let resp = String(d.respuesta || '');
    if (/\b(antivirus|avast|defender)\b/i.test(resp)) {
      const sin = resp.split(/(?<=[.!?])\s+/).filter((o) => !/\b(antivirus|avast|defender)\b/i.test(o)).join(' ').trim();
      this.log('[verdad] quité un consejo sobre el antivirus: ' + corto(resp, 160));
      resp = (sin ? sin + ' ' : '') + 'No hace falta tocar el antivirus; si algo mío falla, dime «hazte un autodiagnóstico».';
      d = Object.assign({}, d, { respuesta: resp });
    }
    const nr = norm(resp);
    if ((acc === 'delegar' || acc === 'ejecutar') && /\b(listo|ya (esta|quedo|lo (hice|cree|escribi))|termine|ya (esta )?(creado|hecho|abierto|guardado)|creado y abierto)\b/.test(nr)) {
      this.log('[verdad] la IA decía que ya estaba hecho y recién lo encarga: ' + corto(resp, 120));
      d = Object.assign({}, d, { respuesta: '' });   // entregar pone «se lo paso al bot…, te aviso cuando termine»
    }
    if (acc === 'charla' && RX_PROMESA.test(nr)) {
      this.log('[verdad] la IA prometió sin hacer nada: ' + corto(resp, 120));
      const c = await this.cumplirPromesa(texto, origen).catch((e) => { this.log('cumplir: ' + e.message); return null; });
      if (c) return Object.assign({ via: 'verificado' }, c);
      // una PREGUNTA que la IA no respondió («voy a buscar…»): la busca de verdad el bot de internet
      const nt = norm(texto);
      if (this.agentes && (/\?/.test(texto) || /^(que|quien|quienes|cual|cuales|como|cuando|donde|cuanto|cuantos|por que)\b/.test(nt))) {
        const { lanzados } = await this.delegarTareas({ bot: 'web', orden: texto }, texto, origen);
        if (lanzados.length) return { respuesta: 'Lo busco en internet y te digo.', accion: 'delegar', trabajos: lanzados, tipo: 'trabajando', via: 'verificado' };
      }
      // si no: se quita la promesa vacía y queda lo demás (o se dice claro)
      const resto = resp.split(/(?<=[.!?])\s+/).filter((o) => !RX_PROMESA.test(norm(o))).join(' ').trim();
      return Object.assign({}, d, { respuesta: resto || 'Todavía no hice nada con eso. Dime exactamente qué necesitas y lo hago ahora (o se lo paso a Noviq).', via: 'verificado' });
    }
    return d;
  }

  /**
   * La IA dijo que HACÍA algo pero contestó «charla» (no hizo nada). Se cumple de verdad: vía rápida → bot que ya lo
   * resolvió antes → Noviq (si está abierto; si no, pregunta si lo abre). null si no se pudo hacer nada mejor.
   */
  async cumplirPromesa(texto, origen) {
    const n = norm(texto);
    if (this.rapido) {
      const o = this.rapido.interpretar(texto);
      if (o && o.tipo === 'leer_doc') return this.leerDocumento(o, origen);
      if (o && o.tipo !== 'noviq') {
        const r = await this.rapido.atender(o, { origen });
        if (r && r.accion === 'delegar') {
          const { lanzados } = await this.delegarTareas(r, texto, origen);
          if (lanzados.length) return { respuesta: r.respuesta, accion: 'delegar', trabajos: lanzados, tipo: 'trabajando' };
        } else if (r && r.respuesta) return Object.assign({ via: 'rapido' }, r);
      }
    }
    const bot = this.mem.botSugerido ? this.mem.botSugerido(texto) : null;
    if (bot && this.agentes) {
      const { lanzados } = await this.delegarTareas({ bot, orden: texto }, texto, origen);
      if (lanzados.length) return { respuesta: `Le pido a mi ${lanzados[0].botNombre.replace(/^Bot de /, 'bot de ')} que lo haga. Te aviso cuando termine.`, accion: 'delegar', trabajos: lanzados, tipo: 'trabajando' };
    }
    const nl = this.rapido ? this.rapido.limpiar(texto) : n;
    if (RX_ORDEN.test(nl) || /^(lee\w*|analiza|captura|busca|investiga|escribe|abre|cierra|pon|revisa\w*|haz\w*|envia|manda)\b/.test(nl) || /\b(quiero que|puedes|podrias|necesito que|hazme|dame)\b/.test(n)) {
      const r = await this.encargarANoviq(texto, origen, 'El avatar no tenía cómo hacerlo con sus bots.');
      return { respuesta: r.ok ? 'Mis bots no tienen cómo hacer eso; ' + r.respuesta.charAt(0).toLowerCase() + r.respuesta.slice(1) : r.respuesta, accion: r.ok ? 'a_noviq' : 'charla', tipo: r.ok ? 'trabajando' : r.tipo || 'info', escuchar: !!r.pregunta };
    }
    return null;
  }

  /** «eso fue la tele / no te hablaba a ti»: lo último que acepté sin nombre era el fondo → lo aprendo y lo saco de la charla. */
  fueRuido() {
    const esc = this.escucha;
    const u = this.ultimaVoz;
    let aprendido = false;
    // si me dijiste mi nombre o hiciste clic, ESA voz era la tuya: no la aprendo como fondo (solo la saco de la charla)
    if (u && Date.now() - u.t < 180000 && u.acustica && !u.conNombre) aprendido = esc.perfil.aprender(u.acustica, 'fondo', 2);
    // la charla no debe quedar con lo que dijo la tele (ni mi respuesta a eso)
    const ch = this.mem.m.charla;
    if (u && ch.length) {
      const i = ch.map((c) => c.texto).lastIndexOf(u.texto);
      if (i >= 0 && ch.length - i <= 3) ch.splice(i, ch.length - i);
      this.mem.guardar();
    }
    this.ultimaVoz = null;
    const e = esc.perfil.estado();
    this.decir(aprendido ? `Entendido: eso era ruido de fondo. Ya lo aprendí (${e.fondo} muestras del fondo) para no confundirme.` : 'Entendido, eso no era para mí. Lo ignoro.', 'asentir');
    return { accion: 'fue_ruido' };
  }

  /** «no te escucho / habla en voz alta / revisa tu voz»: la enciende y PRUEBA de verdad que el motor responde. */
  apagarVoz(op) {
    const dicho = 'Vale, desde ahora solo te escribo en burbujas. Para volver a oírme, dime «habla en voz alta».';
    this.aj.actualizar({ voz: { activada: false } });
    this.mem.registrar('assistant', dicho, 'voz');
    this.decir(dicho, 'info', { voz: false });
    return { accion: 'voz_off', respuesta: dicho, via: 'reflejo' };
  }

  async revisarVoz(texto, op) {
    if (!(op && op.registrado)) this.mem.registrar('user', texto, 'voz');
    const estaba = !!this.d.voz.activada;
    if (!estaba) this.aj.actualizar({ voz: { activada: true } });
    let prueba = null;
    if (this.voz) { try { prueba = await this.voz.sintetizar('Prueba de voz.'); } catch (e) { prueba = { ok: false, error: e.message }; } }
    let dicho;
    if (!estaba) dicho = 'Tenía la voz apagada: solo te escribía en burbujas y hacía sonidos de robot. Ya la encendí. ¿Me escuchas ahora?';
    else if (prueba && prueba.ok) dicho = `Mi voz está encendida y el motor ${prueba.motor === 'microsoft' ? 'de Microsoft' : prueba.motor} responde bien. Si no me oyes, revisa el volumen de Windows o qué parlantes están elegidos. ¿Te abro la configuración de sonido?`;
    else if (prueba && !prueba.ok && prueba.error === 'voz de Windows') dicho = 'Mi voz está encendida y uso la voz de Windows. Si no me oyes, revisa el volumen o los parlantes. ¿Te abro la configuración de sonido?';
    else if (prueba && !prueba.ok) dicho = 'Mi voz moderna no responde (' + corto(prueba.error, 80) + '). Uso la voz de Windows mientras tanto.';
    else dicho = 'Mi voz está encendida. Si no me oyes, revisa el volumen de Windows o los parlantes.';
    if (/configuracion de sonido$/.test(norm(dicho))) this.pend = { tipo: 'config_sonido', t: ahora() };
    this.mem.registrar('assistant', dicho, 'voz');
    this.decir(dicho, estaba ? 'info' : 'exito', { voz: true });
    return { accion: 'voz', escuchar_otra_vez: estaba, respuesta: dicho, via: 'reflejo' };
  }

  /* ------------------------------------------------------------- Ayudas */
  get d() { return this.aj.datos; }
  nombreBot() { return this.d.identidad.nombre || 'Noviq'; }
  rasgos() { return P.valida(this.d.identidad.personalidad); }
  ctx() { return { usuario: this.mem.usuario(), bot: this.nombreBot(), rasgos: this.rasgos() }; }
  frase(k) { return P.frase(k, this.ctx()); }
  conNombre(t) { return P.conNombre(t, this.mem.usuario()); }
  conNoviq() { return !!(this.noviq && this.noviq.conectado && this.d.noviq.usar); }
  actividad() { this.e.actividad = Date.now(); if (this.e.dormido) { this.e.dormido = false; this.cuerpo({ cmd: 'despertar' }).catch(() => {}); } }

  /** Dice algo con aviso (sonido + gesto + burbuja + voz si está activada). */
  decir(texto, tipo, extra) {
    if (!texto) return;
    const cmd = Object.assign({ cmd: 'aviso', tipo: tipo || 'charla', texto, voz: !!this.d.voz.activada }, extra || {});
    this.emitir('dice', { texto, tipo: cmd.tipo });
    return this.cuerpo(cmd).catch((e) => this.log('decir: ' + e.message));
  }

  /* ------------------------------------------------ Palabra de activación */
  /** «abre YouTube, Noviq» / «…no te escucho, Nobic, revisa…» → quita el nombre de en medio o del final; null si no está. */
  quitarNombreEnMedio(texto) {
    const rx = new RegExp('^' + rxNombre(this.nombreBot(), this.d.identidad.variantes) + '$');
    const tok = String(texto).split(/(\s+)/);
    let hallado = false;
    for (let i = 0; i < tok.length; i++) {
      const limpio = norm(tok[i].replace(/[,.;:!?¿¡…"«»()]/g, ''));
      if (limpio && rx.test(limpio)) { tok[i] = /[?!.,]$/.test(tok[i]) ? tok[i].slice(-1) : ''; hallado = true; }
    }
    if (!hallado) return null;
    return tok.join('').replace(/\s+([,.;:!?…»)])/g, '$1').replace(/,\s*([,.?!])/g, '$1').replace(/\s+/g, ' ')
      .replace(/^[\s,.:;…-]+|[\s,:;…-]+$/g, '').trim();
  }

  quitarPalabra(texto) {
    const n = norm(texto);
    const nombre = rxNombre(this.nombreBot(), this.d.identidad.variantes);
    const m = n.match(new RegExp('^(?:(?:oye|hey|ey|ok|okay|hola|eh|hi|hello|buenas)\\s+)?(?:' + nombre + '|robot)\\b\\s*(.*)$'));
    const tokens = String(texto).replace(/([,.;:!?¿¡…"«»()-])/g, ' $1 ').split(/\s+/).filter(Boolean);
    const recortar = (quitadas) => {   // quita del texto ORIGINAL tantas palabras como tenía el saludo + el nombre
      let vistas = 0, i = 0;
      while (i < tokens.length && vistas < quitadas) { if (/[\p{L}\p{N}]/u.test(tokens[i])) vistas++; i++; }
      return tokens.slice(i).join(' ').replace(/\s+([,.;:!?…»)])/g, '$1').replace(/([¿¡«(])\s+/g, '$1').replace(/^[\s,.:;!¡?¿…-]+|[\s,.:;!¡?¿…-]+$/g, '');
    };
    // «No vi.» / «No vi, ¿qué haces?»: así transcribe Whisper a veces «Novi»; solo cuenta si va sola o seguida de una pausa
    const nv = String(texto).match(/^\s*(?:(?:oye|hey|ey|ok)\s+)?no\s+vi[ckqt]?\s*(?:[.,…:;!?¿¡]+|$)\s*(.*)$/i);
    if (nv) return [true, nv[1].replace(/^[\s,.:;!¡?¿]+|[\s,.:;!¡?¿]+$/g, '')];
    if (m) return [true, recortar(n.split(' ').length - (m[1] ? m[1].split(' ').length : 0))];
    const pal = n.split(' ');
    const solo = new RegExp('^' + nombre + '$');
    for (let i = 0; i < Math.min(4, pal.length); i++) if (solo.test(pal[i])) {
      // «bueno Noviq, abre…» → quita el saludo; «abre youtube Noviq por favor» → la orden está ANTES del nombre: se queda
      const antes = pal.slice(0, i).join(' ');
      if (!antes || /^((oye|hey|ey|ok|okay|hola|eh|buenas|bueno|mira|a ver|hi|hello|disculpa|perdon|y|pues|ya|ahora)\s*)+$/.test(antes)) return [true, recortar(i + 1)];
      const sin = this.quitarNombreEnMedio(texto);
      return [true, sin == null ? texto : sin];
    }
    return [false, texto];
  }

  /* ----------------------------------------------------- Entrada por voz */
  /**
   * Lo que oyó el micrófono (ya transcrito). op: {forzado, modo}
   * → {ok, texto, ignorado, mostrar, escuchar_otra_vez, accion}
   */
  async oir(texto, op) {
    op = op || {};
    texto = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!texto) return { ok: true, ignorado: true, texto: '' };
    const modo = op.modo || this.d.oido.modo;
    let [conNombre, resto] = this.quitarPalabra(texto);
    // «abre Google Studio, Noviq» / «…no te escucho Nobi…»: su nombre también vale en medio o al final
    if (!conNombre) { const sin = this.quitarNombreEnMedio(texto); if (sin !== null) { conNombre = true; resto = sin; } }
    const libre = Date.now() < this.ventanaLibre || (this.preguntaApp && Date.now() < this.preguntaApp.hasta);
    let frase = conNombre ? resto : texto;
    const pendiente = this.aceptaSinNombre(texto) || !!(this.preguntaApp && Date.now() < this.preguntaApp.hasta);
    const preguntaAbierta = this.esperaDatoLibre();
    const esc = this.escucha;
    // 🎓 «aprende mi voz»: las frases siguientes son TUYAS (se aprenden aunque no digas el nombre)
    if (this.aprendiendoVoz > 0) {
      const r = this.pasoAprenderVoz(texto, op);
      if (r) return r;
    }
    // 🎯 ¿me hablan A MÍ? (TV, radio, otra persona, ruido…): nombre o clic siempre; sin nombre, según las pistas
    const dec = AT.evaluar({ texto, conNombre, forzado: !!op.forzado, modo: op.auto && modo === 'pulsar' ? 'siempre' : modo, libre: libre || !!op.auto, pendiente, preguntaAbierta,
      esOrden: !!(this.rapido && this.rapido.probar(texto)), ultimo: this.ultimoDicho, recientes: this.mem.m.charla.slice(-4).filter((c) => ahora() - (c.t || 0) < 120).map((c) => c.texto || ''),
      voz: op.voz, acustica: op.acustica, ambiente: op.ambiente, stt: op.stt, filtro: this.d.oido.filtro || 'normal' });
    if (!dec.aceptar) {
      if (libre || op.auto || modo === 'siempre') this.log(`[oído] ignoro «${corto(texto, 70)}» (${dec.puntaje}/${dec.umbral}: ${dec.motivos.join(' ')})`);
      return { ok: true, ignorado: true, texto, motivos: dec.motivos };
    }
    // aprende TU voz poco a poco: cuando dices su nombre o le haces clic (seguro que eres tú). (2.5.1) Solo si se te oye
    // claro y NO hay TV de fondo: el 10-10 aprendió la tele mezclada con tu voz y luego la tele «sonaba como tú»
    const limpio = op.acustica && (op.acustica.snrDb == null || op.acustica.snrDb >= 14) && !(op.ambiente && op.ambiente.tv);
    if (esc && esc.perfil && limpio && (conNombre || op.forzado)) esc.perfil.aprender(op.acustica, 'usuario', 1);
    this.actividad();
    if (!norm(frase)) {
      this.ventanaLibre = Date.now() + 12000;
      this.decir(this.frase('escucho'), 'escuchando');
      return { ok: true, texto, accion: 'escuchar', escuchar_otra_vez: true };
    }
    const r = await this.entender(frase, { conNombre, forzado: !!op.forzado, origen: 'voz' });
    // lo recuerdo DESPUÉS: así «eso fue la tele» se refiere a lo anterior, no a sí mismo
    if (!r || r.accion !== 'fue_ruido') this.ultimaVoz = { acustica: op.acustica || null, texto: frase, t: Date.now(), conNombre: conNombre || !!op.forzado };
    return Object.assign({ ok: true, texto }, r);
  }

  /** ¿Acabo de preguntar algo ABIERTO y espero la respuesta? («¿Sobre qué tema…?», «¿De qué ciudad…?», «¿Cómo te llamas?») */
  esperaDatoLibre() {
    const r = this.rapido;
    if (r && r.docEsperando && Date.now() < r.docEsperando.hasta) return true;
    const tp = this.pend.tipo;
    if ((tp === 'ciudad' || tp === 'nombre' || tp === 'recordatorio') && ahora() - (this.pend.t || 0) < 60) return true;
    const u = this.ultimoDicho;
    if (!u || !u.pregunta || Date.now() - u.t > 30000) return false;
    const ultima = String(u.texto).split(/(?<=[.!])\s+/).pop();
    return /¿?\s*(qu[eé]|cu[aá]l(es)?|c[oó]mo|d[oó]nde|cu[aá]ndo|cu[aá]nto|qui[eé]n|sobre qu[eé]|de qu[eé]|para qu[eé])\b[^?]*\?\s*$/i.test(ultima);
  }

  /** Sin decir su nombre solo vale lo que responde a SU pregunta (no la charla de fondo). */
  aceptaSinNombre(texto) {
    const tp = this.pend.tipo;
    const lim = { nombre: 60, recordatorio: 90, portapapeles: 60, config_sonido: 60, ciudad: 60, abrir_noviq: 90, informe_diag: 90 }[tp] || 0;
    if (!lim || ahora() - (this.pend.t || 0) > lim) return false;
    const n = norm(texto);
    if (tp === 'nombre') return n.split(' ').length <= 3 || RX_NOMBRE_DICE.test(texto);
    if (tp === 'recordatorio') return !!T.interpretar(texto);
    if (tp === 'ciudad') return n.split(' ').length <= 5;
    return /^(si|claro|dale|ok|vale|ayudame|por favor|no|nop|ahora no|deja|yes)\b/.test(n) && n.split(' ').length <= 5;
  }

  async entender(texto, op) {
    op = op || {};
    const n = norm(texto);
    // ── control del cuerpo
    if (CTRL.callar.test(n) || (this.lectura && CTRL.pararLectura.test(n))) {
      if (this.lectura) { this.lectura.cancelada = true; this.lectura = null; }
      await this.cuerpo({ cmd: 'callar' }); return { accion: 'callar', mostrar: false };
    }
    if (CTRL.dormir.test(n) && n.split(' ').length <= 3 && !RX_DISPOSITIVO.test(n)) { this.e.dormido = true; this.cuerpo({ cmd: 'dormir' }); return { accion: 'dormir' }; }
    if (CTRL.despertar.test(n) && n.split(' ').length <= 3) { this.cuerpo({ cmd: 'despertar' }); return { accion: 'despertar' }; }
    if (CTRL.ocultar.test(n) && n.split(' ').length <= 3) { this.cuerpo({ cmd: 'ocultar' }); return { accion: 'ocultar' }; }
    if (CTRL.mostrar.test(n) && n.split(' ').length <= 3) { this.cuerpo([{ cmd: 'mostrar' }, { cmd: 'ir', a: 'cursor' }, { cmd: 'saludar' }]); return { accion: 'mostrar' }; }
    if (CTRL.micOff.test(n)) {
      this.aj.actualizar({ oido: { modo: 'pulsar' } });
      this.decir('Dejo de escuchar. Haz clic en el micrófono cuando me necesites.', 'info');
      return { accion: 'mic_off' };
    }
    if (CTRL.ajustes.test(n)) { this.abrirAjustes(); this.decir('Te abro mis ajustes.', 'info'); return { accion: 'ajustes' }; }
    // ── 👂 aprender a distinguir tu voz del fondo
    const esc = this.escucha;
    if (esc && esc.perfil) {
      if (AT.RX_FUE_RUIDO.test(n)) return this.fueRuido();
      if (AT.RX_APRENDE_VOZ.test(n)) {
        this.aprendiendoVoz = 4; this.tAprenderVoz = Date.now(); this.intentosVoz = 0;
        this.mem.registrar('user', texto, 'voz');
        this.decir('¡Vale! Dime cuatro frases normales, una a la vez, como me hablas siempre. Por ejemplo: «abre YouTube», «¿qué hora es?»…', 'escuchando');
        return { accion: 'aprender_voz', escuchar_otra_vez: true };
      }
      if (AT.RX_OLVIDA_VOZ.test(n)) { esc.perfil.olvidar(); this.decir('Listo, olvidé tu voz y la del fondo. Cuando quieras, dime «aprende mi voz».', 'info'); return { accion: 'olvidar_voz' }; }
      if (AT.RX_ESTADO_VOZ.test(n)) {
        const e = esc.perfil.estado();
        const t = e.listo ? `Sí: tengo ${e.usuario} muestras de tu voz${e.fondo ? ' y ' + e.fondo + ' del fondo' : ''}. Respondo a tu voz y a lo que me pides; la tele y las frases sueltas las ignoro. Si me equivoco, dime «eso fue la tele».`
          : `Todavía estoy aprendiendo tu voz (${e.usuario} de 4 muestras). Mientras tanto me guío por lo que dices. Dime «aprende mi voz» y lo hacemos ahora.`;
        this.mem.registrar('user', texto, 'voz'); this.decir(t, 'info'); return { accion: 'estado_voz' };
      }
    }
    // ── 🔊 su propia voz (antes respondía «mi motor de voz está perfecto» sin saber que estaba apagada)
    if (CTRL.vozOff.test(n)) return this.apagarVoz({});
    if (CTRL.vozOn.test(n) && !RX_SOBRE_LEER.test(n)) return this.revisarVoz(texto);
    // ── 🩺 «hazte un autodiagnóstico» / «revisa tus errores»: con datos REALES (antes la IA inventaba causas)
    if (CTRL.diagnostico.test(n)) { this.mem.registrar('user', texto, op.origen || 'voz'); return this.entregar(await this.autodiagnostico(texto), texto, op.origen || 'voz', true); }
    // ── respuesta a la pregunta de otro programa
    if (this.preguntaApp && Date.now() < this.preguntaApp.hasta) {
      const q = this.preguntaApp;
      this.preguntaApp = null;
      const valor = SI.test(n) ? 'si' : NO.test(n) ? 'no' : 'otro';
      const resp = { id: q.id, app: q.app, texto, valor };
      this.emitir('respuesta', resp);
      if (q.app === 'noviq' && this.noviq) this.noviq.evento('respuesta', resp);
      if (valor !== 'otro' || q.tipo === 'libre') { this.cuerpo({ cmd: 'asentir' }).catch(() => {}); return { accion: 'respuesta', valor }; }
    }
    // ── ¿es para Noviq? (su pregunta abierta, «detente», «¿cómo vas?», «continúa», «nueva conversación…»)
    //    Una orden directa del PC («abre…», «apaga la PC») no espera a Noviq: la hace la vía rápida.
    const directa = this.rapido ? this.rapido.probar(texto) : null;
    if (this.conNoviq() && !(directa && directa.directo)) {
      const r = await this.noviq.escucha(texto, { con_nombre: !!op.conNombre, forzado: !!op.forzado });
      if (r && r.ok && r.tomado) { this.mem.registrar('user', texto, 'voz'); return { accion: r.accion || 'noviq', mostrar: r.mostrar !== false, escuchar_otra_vez: !!r.escuchar_otra_vez }; }
    }
    const r = await this.conversar(texto, op.origen || 'voz');
    return { accion: r.accion || 'charla', destino: r.destino, via: r.via };
  }

  /* --------------------------------------------------------- Conversar */
  /** Punto de entrada: una frase del usuario (voz, API /charla, otro programa). */
  async conversar(texto, origen, op) {
    op = op || {};
    const hablar = op.hablar !== false;
    texto = String(texto || '').replace(/\s+/g, ' ').trim();
    if (!texto) return { respuesta: '', accion: 'nada' };
    this.actividad();
    this.mem.registrar('user', texto, origen || 'voz');
    // «no te escucho / habla en voz alta / solo con texto» también escritos (la API y la página de ajustes)
    const nn = norm(texto);
    if (CTRL.vozOff.test(nn)) return this.apagarVoz({ registrado: true });
    if (CTRL.vozOn.test(nn) && !RX_SOBRE_LEER.test(nn)) return this.revisarVoz(texto, { registrado: true });
    if (CTRL.diagnostico.test(nn)) return this.entregar(await this.autodiagnostico(texto), texto, origen, hablar);
    // «pásaselo a Noviq»: lo último que pediste (o esta misma frase) va a los agentes de Noviq
    if (CTRL.aNoviq.test(nn)) return this.entregar(await this.pasarANoviq(texto, origen), texto, origen, hablar);
    const ref = await this.reflejo(texto, origen);
    if (ref) return this.entregar(ref, texto, origen, hablar);
    if (op.esperar || !hablar) return this.entregar(await this.pensar(texto, origen), texto, origen, hablar);
    this.cuerpo({ cmd: 'pensar' }).catch(() => {});   // mano al mentón + pitido mientras piensa
    this.e.pensando = true;
    (async () => {
      try { await this.entregar(await this.pensar(texto, origen), texto, origen, hablar); }
      catch (e) { this.log('pensar: ' + e.message); }
      finally { this.e.pensando = false; }
    })();
    return { accion: 'pensando', respuesta: '' };
  }

  r(respuesta, accion, extra) { return Object.assign({ respuesta, accion: accion || 'charla', via: 'reflejo' }, extra || {}); }

  pedirNombre(prefijo) {
    this.pend = { tipo: 'nombre', t: ahora() };
    return this.r((prefijo ? prefijo + ' ' : '') + elegir(['Todavía no sé cómo te llamas. ¿Cómo te llamo?', 'Por cierto, ¿cómo te llamas?']),
      'charla', { tipo: 'pregunta', escuchar: true, emocion: 'atento' });
  }

  async proyectos() {
    if (!this.conNoviq()) return [];
    const c = await this.noviq.contexto();
    return (c && c.proyectos) || [];
  }
  async buscarProyecto(nombre) {
    let q = norm(nombre).replace(/^(el|la|mi|nuestro)\s+(proyecto\s+)?/, '').replace(/^proyecto\s+/, '').trim();
    if (!q) return null;
    const ps = await this.proyectos();
    const mapa = new Map(ps.map((p) => [norm(p), p]));
    if (mapa.has(q)) return mapa.get(q);
    for (const [k, p] of mapa) if (k.includes(q) || q.includes(k)) return p;
    const m = U.masParecido(q, [...mapa.keys()], 0.6);
    return m ? mapa.get(m) : null;
  }

  agendaDe(dia) {
    const d0 = new Date(); d0.setDate(d0.getDate() + dia);
    const recs = this.mem.recordatoriosPendientes().filter((r) => U.mismoDia(new Date(r.cuando * 1000), d0));
    const partes = [];
    if (recs.length) partes.push('recordatorios: ' + recs.slice(0, 4).map((r) => `${U.horaTxt(new Date(r.cuando * 1000))}, ${r.texto}`).join('; '));
    const planes = this.mem.m.planes.filter((p) => p.estado === 'borrador').slice(-2);
    if (planes.length) partes.push('planes pendientes: ' + planes.map((p) => corto(p.texto, 60)).join('; '));
    return partes;
  }

  /** Respuesta instantánea si la frase es sencilla y conocida; null si hace falta pensar. */
  async reflejo(texto, origen) {
    const n = norm(texto), pal = n.split(' ');
    const mem = this.mem;
    // ── preguntas abiertas de la mente
    const tp = this.pend.tipo;
    if (tp === 'nombre' && ahora() - this.pend.t < 120) {
      const g = texto.match(RX_NOMBRE_DICE) || texto.match(RX_SOY);
      const cand = g ? g[1] : (pal.length >= 1 && pal.length <= 2 ? texto.replace(/^[\s.!¡¿?]+|[\s.!¡¿?]+$/g, '') : '');
      this.pend = {};
      if (cand && mem.ponerNombre(cand, this.nombreBot())) return this.r(this.conNombre(elegir(['¡Mucho gusto, {n}! Ya no lo olvido.', '¡Encantado, {n}! Lo guardo en mi memoria.'])), 'charla', { emocion: 'feliz', gesto: 'saludar' });
    }
    if (tp === 'recordatorio' && ahora() - this.pend.t < 120) {
      const que = this.pend.que;
      this.pend = {};
      const r = mem.crearRecordatorio(que, texto);
      if (r) return this.r(`Listo, te lo recuerdo ${U.cuandoTxt(r.cuando)}.`, 'charla', { emocion: 'sonrisa' });
      return this.r('No entendí cuándo. Dime, por ejemplo, «mañana a las 8» o «en 20 minutos».');
    }
    if (tp === 'ciudad' && ahora() - this.pend.t < 120) {
      const dia = this.pend.dia || 0;
      this.pend = {};
      const ciudad = texto.replace(/^\s*(en|de|desde|vivo en|estoy en|soy de)\s+/i, '').replace(/[.!¡¿?]+$/g, '').trim();
      if (ciudad && ciudad.split(/\s+/).length <= 5) {
        const r = await this.saber(() => S.clima(ciudad, dia));
        if (r && r.ok) { mem.dato('ciudad', r.lugar || ciudad); return this.r(r.texto + ' Ya recuerdo tu ciudad.', 'charla', { via: 'saberes' }); }
        return this.r(r && r.error ? r.error : 'No pude ver el clima ahora.');
      }
    }
    if (tp === 'config_sonido' && ahora() - this.pend.t < 120) {
      this.pend = {};
      if (/^(si|claro|dale|ok|vale|abrela|por favor)\b/.test(n) && this.rapido) { this.rapido.abrirURLoApp('ms-settings:sound'); return this.r('Te abro la configuración de sonido.'); }
    }
    // «¿Abro Noviq y se lo paso?» → «sí»: lo abre, espera a que conecte y le manda el trabajo
    if (tp === 'abrir_noviq' && ahora() - this.pend.t < 120) {
      const tarea = this.pend.tarea;
      this.pend = {};
      if (SI.test(n)) { this.abrirYEncargar(tarea, origen); return this.r('Abro Noviq y, en cuanto esté listo, le paso el trabajo. Te aviso.', 'charla', { tipo: 'trabajando' }); }
      if (NO.test(n)) return this.r('Vale, lo dejamos así.');
    }
    if (tp === 'informe_diag' && ahora() - this.pend.t < 120) {
      const rep = this.pend.reporte;
      this.pend = {};
      if (SI.test(n) && rep) return this.r(this.guardarInforme(rep), 'charla', { tipo: 'exito' });
      if (NO.test(n)) return this.r('Vale.');
    }
    if (tp === 'portapapeles' && ahora() - this.pend.t < 120) {
      this.pend = {};
      if (/^(si|claro|dale|ok|vale|ayudame|por favor|yes)\b/.test(n)) return null;   // la IA responde con el error copiado en el contexto
      if (/^(no|nop|ahora no|deja)\b/.test(n)) return this.r('Vale, no te molesto.');
    }
    // ── lo que TÚ le enseñaste va primero («cuando te diga X responde Y»)
    if (pal.length <= 14) { const a = mem.aprendido(n, true); if (a) return this.r(this.conNombre(a.r), 'charla', { via: 'aprendido' }); }
    // ── nombre del usuario
    const g0 = texto.match(RX_NOMBRE_DICE) || (pal.length <= 3 ? texto.match(RX_SOY) : null);
    if (g0 && mem.ponerNombre(g0[1], this.nombreBot())) return this.r(this.conNombre('¡Mucho gusto, {n}! Ya lo tengo en mi memoria.'), 'charla', { emocion: 'feliz', gesto: 'saludar' });
    if (RX.mi_nombre_q.test(n)) return mem.usuario() ? this.r(this.conNombre('Te llamas {n}. ¡No se me olvida!')) : this.pedirNombre();
    // ── abrir un proyecto en la ventana de Noviq (si está abierto y no pediste VS Code / la carpeta)
    let gA = n.match(RX.abre);
    if (gA && pal.length <= 8 && /^(el )?proyecto /.test(gA[3]) && this.conNoviq() && !/\b(vs ?code|visual studio|code|explorador|carpeta)\b/.test(n)) {
      const p = await this.buscarProyecto(gA[3]);
      if (p) { mem.ponerProyecto(p); this.noviq.evento('proyecto', { proyecto: p, abrir: true }); return this.r(`Abro «${p}» en Noviq.`, 'charla', { via: 'rapido' }); }
    }
    // ── ⚡ VÍA RÁPIDA: órdenes del PC al instante y sin IA (abrir, cerrar, apagar, volumen, proyectos, buscar archivos…)
    if (this.rapido && this.rapido.activo() && this.d.herramientas.abrir !== false) {
      const o = this.rapido.interpretar(texto);
      if (o) {
        if (o.tipo === 'noviq') {
          // programar de verdad → Noviq (con su proyecto activo); sin Noviq lo explica entregar()
          return this.r(this.frase('voy'), 'ejecutar', { tarea: texto.trim(), via: 'orden', tipo: 'trabajando' });
        }
        if (o.tipo === 'leer_doc') return this.leerDocumento(o, origen);
        const r = await this.rapido.atender(o, { origen });
        if (r) {
          if (r.proyecto) mem.ponerProyecto(r.proyecto);
          return Object.assign({ via: 'rapido' }, r);
        }
      }
    }
    // ── saludos y cortesía
    const gs = n.match(RX.saludo);
    if (gs && pal.length <= 8) {
      const restoN = n.slice(gs[0].length).trim();
      const resto = texto.replace(/^\s*(hola|holi|ola|buenas( tardes| noches)?|buenos d[ií]as|buen d[ií]a|hey|qu[eé] tal|saludos|hello|hi)[\s,!.¡]*/i, '').trim();
      if (restoN && resto && !RX.saludo.test(norm(resto))) {
        const r2 = await this.reflejo(resto, origen);   // «hola, ¿quién eres?» → saluda y responde lo otro
        if (!r2) return null;
        if (r2.respuesta) r2.respuesta = (mem.usuario() ? this.conNombre('¡Hola, {n}! ') : '¡Hola! ') + r2.respuesta;
        return r2;
      }
      if (!mem.usuario()) return this.pedirNombre(elegir(['¡Hola!', '¡Hola, hola!']));
      return this.r(this.frase('saludo'), 'charla', { emocion: 'feliz', gesto: 'saludar' });
    }
    if (RX.despedida.test(n) && pal.length <= 6) return this.r(this.frase('despedida'), 'charla', { gesto: 'saludar' });
    if (RX.gracias.test(n) && pal.length <= 6) return this.r(this.frase('gracias'), 'charla', { emocion: 'sonrisa' });
    if (RX.como_estas.test(n) && pal.length <= 6) return this.r(this.frase('como_estas'), 'charla', { emocion: 'sonrisa' });
    if (RX.ayuda.test(n) && pal.length <= 9) return this.r(this.capacidades(), 'charla', { gesto: 'aclarar' });
    if (RX.quien.test(n) && pal.length <= 7) return this.r(this.frase('quien'), 'charla', { gesto: 'aclarar' });
    if (RX.hora.test(n)) return this.r(`Son las ${U.horaTxt()}.`);
    if (RX.fecha.test(n)) return this.r(`Hoy es ${U.fechaTxt()}.`);
    // ── ojos: cámara conectada / pantalla (se resuelve en entregar: tarda unos segundos)
    if (this.vision && pal.length <= 14) {
      if (RX.mira_pantalla.test(n)) return { respuesta: 'Déjame mirar tu pantalla…', accion: 'ver', fuente: 'pantalla', pregunta: texto, via: 'reflejo' };
      if (RX.mira.test(n)) return { respuesta: 'Déjame mirar…', accion: 'ver', fuente: 'camara', pregunta: texto, via: 'reflejo' };
    }
    // ── mis bots internos: cómo van / pararlos
    if (this.agentes && pal.length <= 9) {
      if (RX.trabajos_stop.test(n)) { const k = this.agentes.enCurso().length; this.agentes.cancelarTodos(); return this.r(k ? `Listo, detuve ${k} trabajo${k > 1 ? 's' : ''}.` : 'No tengo nada en marcha.'); }
      if (RX.trabajos_q.test(n)) return this.r(await this.estadoTrabajos());
    }
    if (this.agentes && pal.length <= 14 && RX.trabajos_q2.test(n) && !(this.rapido && this.rapido.probar(texto))) {
      return this.r(await this.estadoTrabajos(true));
    }
    // ── memoria
    let g = n.match(RX.recuerda);
    if (g) {
      const partes = texto.split(/\bque\b/i);
      mem.recordar(partes.length > 1 ? partes.slice(1).join('que').trim() : g[2], 'usuario');
      return this.r(elegir(['Anotado, no lo olvido.', 'Guardado en mi memoria.', '¡Listo, lo recordaré!']), 'charla', { emocion: 'sonrisa', gesto: 'asentir' });
    }
    if (RX.que_sabes.test(n)) {
      const hs = mem.m.hechos.slice(-6).map((h) => h.texto);
      const base = mem.usuario() ? `Sé que te llamas ${mem.usuario()}` : 'Aún no sé tu nombre';
      return this.r(base + (hs.length ? '. También recuerdo: ' + hs.join('; ') + '.' : '. Cuéntame más de ti.'));
    }
    g = n.match(RX.olvida);
    if (g && pal.length <= 14) {
      if (/^(todo|todo lo que sabes|todo de mi)$/.test(g[3])) return this.r('Para borrar toda mi memoria usa mis Ajustes, pestaña Memoria. Así no se borra por accidente.');
      return this.r(mem.olvidar(g[3]) ? 'Listo, lo olvidé.' : 'No tenía eso guardado.');
    }
    // ── recordatorios y agenda
    g = n.match(RX.recuerdame);
    if (g) {
      const resto = texto.replace(/^\s*(recu[eé]rdame|av[ií]same|remind me|pon(me)? un recordatorio|pon(me)? una alarma)\s*(que\s+|de\s+|para\s+)?/i, '').replace(/[\s.]+$/, '');
      const c = T.interpretar(resto);
      const que = T.quitarTiempo(resto).replace(/^(que|de|para)\s+/i, '') || resto;
      if (!c) { this.pend = { tipo: 'recordatorio', que, t: ahora() }; return this.r(`¿Cuándo te recuerdo «${corto(que, 50)}»?`, 'charla', { tipo: 'pregunta', escuchar: true }); }
      const r = mem.crearRecordatorio(que, resto);
      if (r) return this.r(`Listo, te recuerdo ${U.cuandoTxt(r.cuando)}: ${corto(r.texto, 60)}.`, 'charla', { emocion: 'sonrisa', gesto: 'asentir' });
    }
    if (RX.agenda.test(n)) {
      const dia = /manana/.test(n) ? 1 : 0;
      const partes = this.agendaDe(dia);
      if (!partes.length) return this.r(`${dia ? 'Mañana' : 'Hoy'} no tienes nada anotado. ¿Agendamos algo?`);
      return this.r(`${dia ? 'Para mañana' : 'Hoy'} tienes ` + partes.join('. ') + '.');
    }
    // ── personalidad y voz
    if (RX.normal.test(n)) { this.aplicarPersonalidad(P.DEFECTO_RASGOS.slice()); return this.r('Listo, vuelvo a ser yo: animado, curioso y divertido.', 'charla', { emocion: 'feliz' }); }
    g = n.match(RX.voz_rapida);
    if (g) {
      const v = { rapido: 1.2, despacio: 0.85, lento: 0.85, normal: 1 }[g[3]] || 1;
      this.aj.actualizar({ voz: { velocidad: v } });
      return this.r(v > 1 ? '¡Vale, hablo más rápido!' : v < 1 ? 'Vale, hablo más despacio.' : 'Vuelvo a mi velocidad normal.');
    }
    g = n.match(RX.personalidad);
    if (g) {
      const nuevos = P.cambiar(g[2], n, this.rasgos());
      if (nuevos) {
        this.aplicarPersonalidad(nuevos);
        const nombres = nuevos.map((r) => P.RASGOS[r].n.split(' ').slice(1).join(' ').toLowerCase()).join(', ');
        return this.r(`¡Hecho! Desde ahora soy ${nombres}.`, 'charla', { emocion: P.RASGOS[nuevos[0]].cara });
      }
    }
    // ── lo que le enseñaste
    g = texto.match(RX_ENSENA);
    if (g) { mem.aprender(g[1], g[2], 'usuario'); return this.r('¡Aprendido! La próxima vez te respondo eso.', 'charla', { emocion: 'feliz', gesto: 'asentir' }); }
    if (pal.length <= 14) { const a = mem.aprendido(n); if (a) return this.r(this.conNombre(a.r), 'charla', { via: 'aprendido' }); }
    // ── saberes sin IA: cálculos, conversiones, clima, noticias, temporizadores, música…
    const sab = await this.saberesRapidos(texto, n, pal);
    if (sab) return sab;
    // ── chistes y datos
    if (RX.chiste.test(n) && pal.length <= 6) return this.r(elegir(P.CHISTES), 'charla', { emocion: 'risa', gesto: 'reir' });
    if (RX.dato.test(n)) return this.r(elegir(P.DATOS), 'charla', { gesto: 'aclarar' });
    // ── proyectos de Noviq: modo trabajo
    if (this.conNoviq()) {
      g = n.match(RX.trabajar);
      if (g) {
        const p = await this.buscarProyecto(g[7]);
        if (p) { mem.ponerProyecto(p); this.noviq.evento('proyecto', { proyecto: p }); return this.r(`¡Listo! Trabajamos en «${p}». ¿Qué hacemos primero?`, 'charla', { tipo: 'pregunta', escuchar: true, gesto: 'celebrar' }); }
      }
      if (RX.salir_proy.test(n) && mem.proyectoActivo()) { const p = mem.proyectoActivo(); mem.ponerProyecto(''); return this.r(`Listo, dejamos «${p}» por ahora.`); }
    }
    if (RX.nuevo.test(n)) { mem.ponerProyecto(''); return this.r('¡Genial! ¿Qué vamos a crear? Cuéntame la idea.', 'plan', { tipo: 'pregunta', escuchar: true, gesto: 'celebrar' }); }
    // ── portapapeles
    if (RX.clip_q.test(n)) {
      const c = await this.clipReciente();
      if (!c) return this.r('No vi nada copiado hace poco.');
      if (c.sensible) return this.r('Copiaste algo que parece una clave o contraseña: no lo leo ni lo guardo.');
      return this.r('Copiaste: ' + corto(c.texto, 220));
    }
    g = n.match(RX.abre);
    // ── (vía rápida apagada) abrir con la herramienta, como antes
    if (!this.rapido || !this.rapido.activo()) {
      if (g && pal.length <= 6 && this.d.herramientas.abrir !== false) {
        if (/^(noviq|el programa noviq)$/.test(g[3]) && !this.conNoviq()) { const ok = await this.abrirNoviq(); return this.r(ok ? 'Abro Noviq. Dame unos segundos.' : 'No encontré cómo abrir Noviq desde aquí.'); }
        const r = await this.herr.ejecutar('abrir', { que: g[3] });
        if (r.ok) return this.r(r.decir || 'Listo.', 'charla', { gesto: 'senalar', via: 'herramienta' });
      }
      if (this.conNoviq() && RX_ORDEN.test(n) && RX_PC.test(n) && pal.length >= 3) return this.r(this.frase('voy'), 'ejecutar', { tarea: texto.trim(), via: 'orden', tipo: 'trabajando' });
    }
    return null;
  }

  /** Lo que sabe hacer (cambia según tenga IA o no). */
  capacidades() {
    const ia = this.cerebro.orden().length > 0;
    return (ia ? 'Puedo conversar de lo que quieras, enseñarte y ayudarte a planear. ' : 'Aunque ahora no tengo una IA para conversar, ') +
      'te digo la hora, el clima y las noticias, busco en Wikipedia y en internet, calculo y convierto unidades o monedas, pongo recordatorios y temporizadores, ' +
      'abro y cierro programas, archivos, carpetas, webs y proyectos al instante, apago o bloqueo la PC, manejo el volumen, tomo capturas, busco tus archivos, pongo música en YouTube y recuerdo lo que me cuentas.' + (this.conNoviq() ? ' Y con Noviq programo en tus proyectos.' : '') +
      (this.agentes ? ' Tengo bots internos que trabajan en segundo plano (PC, proyectos, internet, Noviq y tus servidores MCP) mientras seguimos hablando' + (this.vision && this.vision.camaraActiva() ? ', y puedo mirar por la cámara.' : '.') : '');
  }

  /* ------------------------------------------- Bots internos y ojos */
  /** Líneas del prompt: qué bots tengo y qué están haciendo. */
  async textoBots() {
    if (!this.agentes) return [];
    let r = []; try { r = await this.agentes.roster(); } catch (_) { r = []; }
    const L = [];
    if (r.length) L.push('Tus bots internos (úsalos con accion="delegar"; tú eres el bot principal y das las órdenes):\n' + r.map((b) => `- ${b.id}: ${b.desc}`).join('\n'));
    const ec = this.agentes.enCurso();
    if (ec.length) L.push('Trabajos en marcha ahora: ' + ec.map((j) => `#${j.id} ${j.botNombre} «${corto(j.orden, 60)}» (${Math.round((Date.now() - j.inicio) / 1000)} s${j.actual ? ', ' + j.actual : ''})`).join('; ') + '. Si te preguntan cómo van, díselo; no repitas un trabajo que ya está en marcha.');
    return L;
  }
  /** Lo que de verdad está pasando (bots y Noviq). Nunca inventa: si no hay nada en marcha, lo dice. */
  async estadoTrabajos(honesto) {
    if (!this.agentes) return 'No tengo bots internos activos.';
    const ec = this.agentes.enCurso();
    let nv = [];
    if (this.conNoviq()) { const c = await this.noviq.contexto().catch(() => null); nv = ((c && c.trabajando) || []).map((t) => t.titulo).filter(Boolean); }
    const partes = [];
    if (ec.length) partes.push('Estoy en ' + ec.map((j) => `${j.botNombre.replace(/^Bot de /, 'el bot de ')}: «${corto(j.orden, 50)}»${j.actual ? ' (usando ' + j.actual + ')' : ''}`).join('; '));
    if (nv.length) partes.push('Noviq está trabajando en ' + nv.slice(0, 2).map((t) => `«${corto(t, 50)}»`).join(' y '));
    if (partes.length) return partes.join('. ') + '. Te aviso apenas terminen.';
    const ult = this.agentes.trabajos()[0];
    const desde = ult ? ult.segundos : 0;
    if (!ult) return honesto ? 'No, no tengo ningún trabajo hecho ni en marcha: no llegó a empezar. Dime otra vez qué necesitas y lo hago ahora.' : 'No tengo ningún trabajo en marcha. Pídeme algo y se lo paso a mis bots.';
    return `No hay nada en marcha. Lo último: ${ult.botNombre.replace(/^Bot de /, 'el bot de ')} ${ult.estado === 'listo' ? 'terminó' : ult.estado === 'cancelado' ? 'fue detenido' : 'tuvo un problema'}${desde ? '' : ''}: ${corto(ult.resultado, 160)}` +
      (honesto && ult.estado !== 'listo' ? ' ¿Lo intento de nuevo?' : '');
  }
  /** Para el prompt de la IA: trabajos REALES (así no inventa «estoy trabajando en tu documento»). */
  trabajosReales() {
    if (!this.agentes) return 'ninguno';
    const js = this.agentes.jobs || [];
    const ahoraMs = Date.now();
    const L = js.filter((j) => j.estado === 'en_curso' || ahoraMs - (j.fin || j.inicio) < 30 * 60000).slice(-4).reverse()
      .map((j) => `${j.bot}: «${corto(j.orden, 60)}» → ${j.estado === 'en_curso' ? 'EN CURSO' : j.estado}${j.estado !== 'en_curso' && j.resultado ? ' (' + corto(j.resultado, 80) + ')' : ''}`);
    return L.length ? L.join(' | ') : 'ninguno (no hay nada en marcha ni hecho en la última media hora)';
  }
  /** Un bot interno terminó: avisa en voz alta con su resultado (el bot principal siempre informa). */
  async alTerminarTrabajo(j) {
    if (j.estado === 'cancelado') return;
    let texto = j.resultado || (j.estado === 'listo' ? 'Listo.' : 'No pude terminarlo.');
    // lo que el bot ya dice en una frase clara (p. ej. el de documentos) no se re-resume con la IA (se perdían avisos)
    if (j.estado === 'listo' && texto.length > 140 && !j.hablado) texto = await this.resumirResultado(j.orden, j.botNombre, texto, j.origen);
    else texto = corto(texto, j.hablado ? 420 : 260);
    const pref = j.estado === 'listo' ? '' : j.denegado ? '' : 'No salió bien: ';
    let dicho = (pref + texto).trim();
    // 🤝 (2.6) un bot NO pudo (error o «no tengo herramientas para…») → lo hace Noviq si está abierto; si no, pregunta
    const noPudo = (j.estado === 'error' && !j.denegado) || (j.estado === 'listo' && !j.archivo && RX_NO_PUEDO.test(norm(j.resultado || '')));
    if (noPudo && j.bot !== 'noviq' && !j.escalado && this.noviq && this.d.noviq.usar && this.d.noviq.escalar !== false) {
      j.escalado = true;
      const tarea = j.texto || j.orden;
      if (this.conNoviq()) {
        const r = await this.encargarANoviq(tarea, j.origen || 'voz', `Mi ${j.botNombre} no pudo: ${corto(j.resultado, 200)}`);
        dicho = `Mi ${j.botNombre.replace(/^Bot de /, 'bot de ')} no pudo (${corto(j.resultado, 90)}). ` + (r.ok ? 'Se lo pasé a Noviq, que tiene más herramientas; te aviso cuando termine.' : r.respuesta);
      } else {
        this.pend = { tipo: 'abrir_noviq', tarea, t: ahora() };
        dicho += ' Eso lo puede hacer Noviq, pero está cerrado. ¿Lo abro y se lo paso?';
        this.ventanaLibre = Date.now() + 20000;
      }
    }
    this.mem.registrar('assistant', dicho, j.origen || 'bot');
    this.mem.contar('bots');
    if (this.mem.experiencia) this.mem.experiencia(j.texto || j.orden, j.bot, j.estado === 'listo' && !noPudo, Date.now() - (j.inicio || Date.now()));
    const espera = Date.now() - (this.e.ultimaCharla || 0) < 3000 ? 2500 : 200;
    // si está leyendo un documento en voz alta, el aviso espera a que termine (antes lo cortaba a la mitad)
    const avisar = () => { if (this.lectura && Date.now() - t0aviso < 600000) return setTimeout(avisar, 1000); this.decir(dicho, j.estado === 'listo' ? 'exito' : j.denegado ? 'atencion' : 'error', {}); };
    const t0aviso = Date.now();
    setTimeout(avisar, espera);
    this.emitir('trabajo', { id: j.id, bot: j.bot, estado: j.estado, resultado: corto(j.resultado, 600) });
  }
  /** Reparte órdenes a los bots (en segundo plano) y devuelve enseguida. */
  async delegarTareas(d, texto, origen) {
    const lista = (Array.isArray(d.tareas) && d.tareas.length ? d.tareas : [{ bot: d.bot, orden: d.orden || d.tarea || texto, datos: d.datos }])
      .filter((t) => t && t.bot).slice(0, 4);
    if (this.rapido) for (const t of lista) {
      const id = String(t.bot).toLowerCase();
      const o = this.rapido.probar(String(t.orden || texto)) || (id !== 'documentos' && lista.length === 1 ? this.rapido.probar(texto) : null);
      // documentos (resúmenes, informes, Word) → bot de documentos, aunque la IA haya elegido «pc» o «noviq»
      if (o && o.tipo === 'documento' && id !== 'documentos' && o.tema) { t.bot = 'documentos'; t.datos = t.datos || { tema: o.tema, tipo: o.tipoDoc, enAbierto: o.enAbierto, extension: o.extension, instrucciones: o.instrucciones }; continue; }
      // «prepara algo sobre X en un documento de Word» (sin «resumen/informe»): igual es del bot de documentos
      if (id !== 'documentos' && this.agentes && this.agentes.documentos && RX_DOC_GENERICO.test(norm(String(t.orden || texto)))) { t.bot = 'documentos'; continue; }
      // lo que es del PC o de mirar un proyecto no va al bot de Noviq (lento): va a los bots propios
      if (id === 'noviq' && o && (o.directo || o.tipo === 'delegar')) t.bot = o.bot || 'pc';
    }
    const lanzados = [], fallos = [], repetidos = [];
    for (const t of lista) {
      // el 10-10 se crearon DOS documentos iguales en un minuto: lo mismo, en curso o recién hecho, no se repite
      const rep = this.trabajoRepetido(t.bot, String(t.orden || texto), t.datos, d.via === 'ia');
      if (rep) { repetidos.push(rep); continue; }
      const l = await this.agentes.lanzar({ bot: t.bot, orden: String(t.orden || texto), origen, texto, datos: t.datos || null });
      l.ok ? lanzados.push(l.trabajo) : fallos.push(l.error);
    }
    return { lanzados, fallos, repetidos };
  }
  /**
   * ¿Ese mismo trabajo ya está EN CURSO? (o, si lo decidió la IA, ¿el mismo documento se terminó hace < 1 min?)
   * → texto para decir, o null. Si TÚ lo pides otra vez cuando ya terminó, se hace otra vez.
   */
  trabajoRepetido(bot, orden, datos, deLaIA) {
    const js = (this.agentes && this.agentes.jobs) || [];
    const id = String(bot || '').toLowerCase();
    const tema = datos && datos.tema ? norm(datos.tema) : '';
    const cq = new Set(norm(orden).split(' ').filter((w) => w.length > 3));
    for (const j of js.slice().reverse()) {
      if (j.bot !== id) continue;
      const hecho = deLaIA && tema && j.estado === 'listo' && Date.now() - (j.fin || 0) < 60000 && j.datos && !!j.datos.enAbierto === !!(datos && datos.enAbierto);
      if (j.estado !== 'en_curso' && !hecho) continue;
      let igual = tema && j.datos && j.datos.tema && norm(j.datos.tema) === tema;
      if (!igual && cq.size) {
        const cj = new Set(norm(j.orden).split(' ').filter((w) => w.length > 3));
        let n = 0; for (const w of cq) if (cj.has(w)) n++;
        igual = n / Math.max(cq.size, cj.size) >= 0.7;
      }
      if (igual) return j.estado === 'en_curso' ? `Eso ya lo estoy haciendo (${j.botNombre.replace(/^Bot de /, 'bot de ')}). Te aviso al terminar.` : `Eso ya lo hice hace un momento: ${corto(j.resultado, 160)}`;
    }
    return null;
  }

  /** Ejecuta un saber con internet sin romper la charla. */
  async saber(fn) { try { return await fn(); } catch (e) { return { ok: false, error: /fetch|ENOTFOUND|ECONN|Timeout|abort/i.test(String(e && (e.message || e.name))) ? 'No tengo internet ahora mismo.' : String(e.message || e) }; } }

  diaDe(n) { return /pasado manana/.test(n) ? 2 : /\bmanana\b/.test(n.replace(/(de|por|en) la manana|esta manana/g, ' ')) ? 1 : 0; }

  /** Reflejos que consultan servicios gratis (sin IA). null si la frase no es de este tipo. */
  async saberesRapidos(texto, n, pal) {
    const h = this.d.herramientas;
    const internet = h.internet !== false;
    // cálculos dichos en voz
    const calc = S.calculoDicho(texto);
    if (calc) { this.mem.contar('herramientas'); return this.r(`Son ${calc.texto}.`, 'charla', { via: 'saberes', gesto: 'aclarar' }); }
    // conversiones de unidades y monedas
    let g = n.match(RX.conv2), cant, de, a;
    if (g) { cant = g[1]; de = g[2]; a = g[3]; } else if ((g = n.match(RX.conv1))) { cant = g[2]; de = g[3]; a = g[1]; }
    if (g) {
      const c = /^(un|una|uno)$/.test(cant) ? 1 : Number(cant);
      const u = S.convertir(c, de, a);
      if (u) return this.r(u.texto, 'charla', { via: 'saberes' });
      if (S.moneda(de) && S.moneda(a) && internet) {
        const r = await this.saber(() => S.divisas(c, de, a));
        return this.r(r.ok ? r.texto : 'No pude ver el cambio de moneda: ' + r.error, 'charla', { via: 'saberes' });
      }
    }
    // días que faltan
    g = n.match(RX.dias_hasta);
    if (g) { const r = S.diasHasta(texto); if (r) return this.r(r.texto, 'charla', { via: 'saberes' }); }
    // temporizador
    g = n.match(RX.temporizador);
    if (g && h.recordatorios !== false) {
      const dur = (g[1] || g[2] || '').replace(/^(de|por|para)\s+/, '');
      const r = this.mem.crearRecordatorio('⏱ ¡Se acabó el tiempo del temporizador!', 'en ' + dur.replace(/^en\s+/, ''));
      if (r) return this.r(`Temporizador listo: te aviso ${U.cuandoTxt(r.cuando).replace(/^hoy /, '')}.`, 'charla', { via: 'saberes', gesto: 'asentir' });
    }
    if (!internet) return null;
    // clima
    if (RX.clima.test(n)) {
      const dia = this.diaDe(n);
      let lugar = '';
      const m = texto.replace(/[¿?¡!.]+/g, ' ').match(/\b(?:en|de|para)\s+((?:[A-ZÁÉÍÓÚÑ][\wáéíóúñü.-]*|de|del|la|los|las)(?:\s+(?:[A-ZÁÉÍÓÚÑ][\wáéíóúñü.-]*|de|del|la|los|las))*)\s*$/) ||
        texto.replace(/[¿?¡!.]+/g, ' ').replace(/\b(hoy|ma[nñ]ana|pasado ma[nñ]ana|ahora|esta (tarde|noche))\b/gi, ' ').trim().match(/\b(?:en|de|para)\s+([\wáéíóúñü .-]{3,40})$/i);
      if (m) lugar = m[1].trim().replace(/\s+(hoy|ma[nñ]ana|ahora)$/i, '');
      if (/^(hoy|ma[nñ]ana|ahora|la tarde|la noche|el dia|la semana)$/i.test(lugar)) lugar = '';
      lugar = lugar || this.mem.m.usuario.datos.ciudad || '';
      if (!lugar) { this.pend = { tipo: 'ciudad', t: ahora(), dia }; return this.r('¿De qué ciudad quieres el clima?', 'charla', { tipo: 'pregunta', escuchar: true }); }
      const r = await this.saber(() => S.clima(lugar, dia));
      return this.r(r.ok ? r.texto : r.error, 'charla', { via: 'saberes', gesto: r.ok ? 'aclarar' : undefined });
    }
    // noticias
    g = n.match(RX.noticias);
    if (g && pal.length <= 12) {
      const tema = (g[8] || '').trim();
      const r = await this.saber(() => S.noticias(tema));
      return this.r(r.ok ? r.texto : r.error, 'charla', { via: 'saberes' });
    }
    // música y videos en YouTube / búsquedas en Google (abre el navegador)
    g = n.match(RX.musica);
    if (g && /\b(musica|cancion|canciones|video|videos|youtube|playlist|tema|album|disco|reggaeton|salsa|bachata|rock|pop|cumbia|vallenato|baladas?)\b/.test(n) && h.abrir !== false) {
      const q = texto.replace(/^\s*(p[oó]n(me)?|reproduce|quiero (escuchar|ver)|busca en youtube|abre en youtube)\s+/i, '').replace(/\s+en youtube\s*$/i, '').replace(/^(m[uú]sica de|la canci[oó]n|canciones de|el video de|videos de)\s+/i, '').trim();
      await this.herr.ejecutar('buscar_en_navegador', { consulta: q, sitio: 'youtube' });
      return this.r(`Te pongo «${corto(q, 50)}» en YouTube.`, 'charla', { via: 'herramienta', gesto: 'bailar' });
    }
    g = n.match(RX.google);
    if (g && h.abrir !== false) {
      const q = (g[1] || g[2] || '').trim();
      await this.herr.ejecutar('buscar_en_navegador', { consulta: q, sitio: 'google' });
      return this.r(`Te lo busco en Google: ${corto(q, 60)}.`, 'charla', { via: 'herramienta' });
    }
    // sin ninguna IA: «busca…» y «¿qué es…?» los responde con internet y Wikipedia
    if (!this.cerebro.orden().length) return this.sinIA(texto, n);
    return null;
  }

  /** Respuesta con Wikipedia o internet cuando no hay IA (o falló). null si no aplica. */
  async sinIA(texto, n) {
    if (this.d.herramientas.internet === false) return null;
    let g = n.match(RX.wiki);
    const pregunta = /^(que|quien|quienes|como|cuando|donde|por que|cual|cuales|cuanto|cuanta|cuantos|cuantas|para que)\b/.test(n) || /\?\s*$/.test(texto);
    if (g) {
      const tema = texto.replace(/[¿?¡!]/g, '').replace(/^\s*(qu[eé] (es|son|significa)|qui[eé]n(es)? (es|era|fue|son|fueron)|define|definici[oó]n de|h[aá]blame (de|sobre)|cu[eé]ntame (de|sobre)|qu[eé] sabes (de|sobre))\s+(el |la |los |las |un |una )?/i, '').trim();
      const r = await this.saber(() => S.wikipedia(tema));
      if (r.ok) return this.r(r.texto, 'charla', { via: 'saberes', gesto: 'aclarar' });
    }
    g = n.match(RX.busca);
    if (g || pregunta) {
      const q = g ? texto.replace(/^\s*(b[uú]sca(me)?|investiga|averigua)\s+(sobre |acerca de |informaci[oó]n (de|sobre) )?/i, '') : texto;
      const r = await this.saber(async () => ({ ok: true, lista: await require('./herramientas').buscarInternet(q.slice(0, 200)) }));
      const x = r.ok && Array.isArray(r.lista) && r.lista.find((i) => i.resumen);
      if (x) return this.r(`Encontré esto: ${corto(x.resumen, 260)}`, 'charla', { via: 'saberes', resultado: r.lista.slice(0, 3) });
      if (!r.ok && g) return this.r(r.error);
    }
    return null;
  }

  aplicarPersonalidad(nuevos) {
    this.aj.actualizar({ identidad: { personalidad: nuevos } });
    this.mem.olvidarAprendidoDeIA();   // las respuestas guardadas de la IA cambian de tono
  }

  /* --------------------------------------------------------------- IA */
  async prompt(texto, origen) {
    const d = this.d, mem = this.mem;
    const nb = this.nombreBot(), nu = mem.usuario();
    const conNv = this.conNoviq();
    const L = [
      `Eres ${nb}, un robot avatar que vive en el escritorio de ${nu || 'tu usuario'} y es su asistente personal, independiente, valiente, inteligente y con personalidad.`,
      origen === 'api' ? 'Te escriben desde otro programa: responde claro y útil (máx. ~120 palabras), sin markdown pesado.'
        : 'Hablas por VOZ: responde en 1 a 3 frases cortas y naturales (máx. ~45 palabras), sin markdown, sin listas, sin emojis.',
      d.identidad.idioma === 'en' ? 'Language: answer in English unless spoken to in another language.' : 'Idioma: responde en el idioma en que te hablan (normalmente español latino).',
      'Personalidad: ' + this.rasgos().map((r) => P.RASGOS[r].p).join(' '),
      'Sabes mucho de programación, electrónica, IA y aprendizaje automático; enseñas con ejemplos sencillos. Ayudas a organizar la vida diaria (recordatorios, planes, agenda).',
      'Tus herramientas (úsalas con accion="herramienta"):',
      await this.herr.descripcion(),
      ...(await this.textoBots()),
      conNv ? 'Además está Noviq (CONECTADO): agentes pesados con muchas más herramientas. Úsalo (accion="ejecutar") para PROGRAMAR en grande y para lo que tus herramientas y bots NO pueden (si un bot tuyo ya falló en eso, o no tienes herramienta para ello). Son lentos: lo demás hazlo tú.'
        : 'Noviq (los agentes que programan) NO está abierto ahora: si piden crear software o cambios grandes, di que necesitas a Noviq y ofrece abrirlo ("abre Noviq").'
          + (this.agentes && this.agentes.con && this.agentes.con.def('programador') && this.agentes.con.def('programador').activo ? ' Los cambios PEQUEÑOS de código sí los hace tu bot «programador» (no necesita Noviq).' : ''),
      'ORDEN DE PREFERENCIA para HACER algo (de lo más rápido a lo más lento): 1) tu herramienta orden_pc o abrir si es UN paso (abrir/cerrar algo, apagar, volumen, captura, buscar un archivo, ejecutar un proyecto); 2) accion="delegar" a tu bot «pc» (archivos y carpetas, varios pasos) o «proyectos» (mirar/buscar código de un proyecto) o «web»'
        + (this.agentes && this.agentes.documentos ? ' o «documentos» (crear documentos de Word: resúmenes, informes, ensayos, cartas, listas; investiga en internet, crea el .docx y también escribe DENTRO del Word abierto; pon el tema en «orden»)' : '')
        + (this.agentes && this.agentes.con && this.agentes.con.def('programador') && this.agentes.con.def('programador').activo ? ' o «programador» (cambios PEQUEÑOS de código: un valor, un texto, un error puntual; o preguntas como «¿dónde está X en el código?»)' : '')
        + '; 3) accion="ejecutar" (Noviq) SOLO si NINGUNA herramienta ni bot tuyo puede (programar en grande, o algo para lo que no tienes herramienta). NUNCA mandes a Noviq abrir programas, apagar la PC, mover archivos, crear documentos ni mirar código: eso lo hacen tus bots en segundos.',
      'VERDAD (obligatorio): nunca digas que delegaste, que estás trabajando, leyendo o revisando, o que algo ya está listo, si no lo haces con accion=delegar/ejecutar/herramienta/ver EN ESTA respuesta o si no aparece en «Trabajos reales». Si no puedes hacer algo, dilo claro y ofrece una salida (otro bot, Noviq). Nunca culpes ni mandes desactivar el antivirus, ni inventes fallas de «conexión», «controladores» o «permisos»: para revisar tus errores el usuario dice «hazte un autodiagnóstico».',
      'Reglas para «accion»:',
      '- charla: saludos, conocimiento general, consejos, explicar/enseñar, conversación. Lo respondes TÚ.',
      '- herramienta: si hace falta un dato ACTUAL (noticias, precios, clima, resultados), abrir algo, el portapapeles o cálculos exactos. No inventes datos actuales: búscalos.',
      '- SIEMPRE contestas tú primero (1 frase breve: lo que entendiste o harás). Nunca te quedas callado ni esperas a que un trabajo largo termine.',
      '- delegar: si hay que HACER algo en el PC (comandos, archivos, programas, ventanas, ratón/teclado), manejar Noviq u otro servidor MCP, o investigar a fondo en internet: da la orden al bot interno que corresponda y sigue conversando; ellos trabajan en segundo plano y tú avisas cuando terminen. Si hay varias cosas independientes usa «tareas» (en paralelo).',
      '- ver: mirar por la cámara conectada o la pantalla («¿qué ves?», «mira esto», «¿qué hay en mi pantalla?»).',
      conNv ? '- ejecutar: SOLO para programar o cambiar software («crea una app…», «arregla el juego X», «agrega un nivel») o el correo, o si confirma un plan de programación ya concreto.' : '',
      '- plan: el usuario cuenta algo que quiere o piensa hacer pero NO lo ordenó o faltan datos. Ayúdalo a concretarlo con UNA pregunta. No ejecutes.',
      '- recordatorio: «recuérdame…». cancelar_plan: si desiste del plan.',
      '- Si no sabes su nombre, pregúntalo. Usa su nombre a veces, sin abusar.',
      '- aprender=true solo si tu respuesta es de conocimiento general que no cambia con el tiempo.',
      '- Sobre TI mismo (voz, micrófono, filtro de voces) usa SOLO «Tu estado» de abajo: nunca digas que algo funciona si ahí dice que está apagado.',
      ESQUEMA, '', '## Contexto',
      `- Ahora: ${U.fechaTxt()}, ${U.horaTxt()}.`,
      '- Tu estado: ' + this.estadoPropio() + '.',
      '- Trabajos reales de tus bots: ' + this.trabajosReales() + '.',
      // memoria COMPACTA: solo lo relevante para esta frase (antes iban 25 hechos + 25 proyectos en cada mensaje)
      mem.contexto(texto, { rutaNoviq: this.rutaNoviq, presupuesto: 1100 })
    ].filter(Boolean);
    if (conNv) {
      const c = await this.noviq.contexto();
      if (c) {
        const pa = mem.proyectoActivo();
        const nt0 = norm(texto);
        const ps = c.proyectos || [];
        const mencionados = ps.filter((x) => { const nx = norm(x); return nx.length > 2 && nt0.includes(nx); });
        const lista = mencionados.concat(ps.filter((x) => !mencionados.includes(x))).slice(0, 8);
        if (ps.length) L.push('- Proyectos de Noviq (' + ps.length + '): ' + lista.join(', ') + (ps.length > lista.length ? ', …' : '') + (pa ? `. Están trabajando en: «${pa}».` : '.'));
        const tr = (c.trabajando || []).map((t) => t.titulo || t.title).filter(Boolean);
        L.push('- Noviq ahora: ' + (tr.length ? 'trabajando en ' + tr.slice(0, 3).map((x) => `«${corto(x, 40)}»`).join('; ') : 'libre') + '.');
      }
    }
    const recs = mem.recordatoriosPendientes().slice(0, 3);
    if (recs.length) L.push('- Recordatorios: ' + recs.map((r) => `${U.cuandoTxt(r.cuando)}: ${r.texto}`).join('; '));
    const nt = norm(texto);
    if (/\b(esto|este|esta|eso|copie|copiado|portapapeles|lo que copie|ese error|este error|este texto|este codigo)\b/.test(nt) || this.pend.tipo === 'portapapeles' || /^(si|ayudame)\b/.test(nt)) {
      const clip = await this.clipReciente();
      if (clip && clip.texto) L.push('- Portapapeles (lo que copió hace poco):\n```\n' + clip.texto.slice(0, 2500) + '\n```');
    }
    if (d.identidad.instrucciones) L.push('- Indicaciones del usuario para ti: ' + d.identidad.instrucciones.slice(0, 1200));
    return L.join('\n');
  }

  /** Estado REAL del propio avatar (para que la IA no invente «mi motor de voz está perfecto»). */
  estadoPropio() {
    const d = this.d;
    const pv = this.escucha && this.escucha.perfil ? this.escucha.perfil.estado() : null;
    const am = this.escucha && this.escucha.ambiente ? this.escucha.ambiente.estado() : null;
    const modo = { palabra: 'escucha cuando dicen tu nombre', siempre: 'escucha siempre', pulsar: 'solo al hacer clic', apagado: 'apagado' }[d.oido.modo] || d.oido.modo;
    return [
      d.voz.activada ? 'voz ENCENDIDA (hablas en voz alta)' : 'voz APAGADA (solo escribes en burbujas; si te piden hablar, di que se activa con «habla en voz alta»)',
      'micrófono: ' + modo,
      'filtro de voces de fondo: ' + (d.oido.filtro || 'normal'),
      pv ? (pv.listo ? `conoces la voz del usuario (${pv.usuario} muestras)` : 'aún no conoces bien su voz (puede decir «aprende mi voz»)') : '',
      am && am.tv ? 'hay TV/ruido de voces de fondo ahora' : ''
    ].filter(Boolean).join('; ');
  }

  /** IA más rápida → decisión. Nunca lanza: si falla, responde con sus saberes (Wikipedia, internet) o explica qué pasa. */
  async pensar(texto, origen) {
    const hist = this.mem.historialCompacto(9, 240).slice(0, -1);   // 8 mensajes recortados (antes 12 completos)
    const t0 = Date.now();
    let aviso = null;
    const alEmpezar = (info) => {
      clearTimeout(aviso);
      if (origen === 'api') return;
      const dicho = info.frio ? `🧠 Cargo «${corto(info.modelo, 40)}» en la memoria… la primera vez tarda unos segundos.` : '🤔 Sigo pensando…';
      aviso = setTimeout(() => this.cuerpo({ cmd: 'mensaje', texto: dicho, tipo: 'pensamiento', duracion: info.frio ? 15000 : 6000 }).catch(() => {}), info.frio ? 1200 : 6000);
    };
    try {
      const r = await this.cerebro.pensar({ sistema: await this.prompt(texto, origen), historial: hist, usuario: texto, limiteSeg: 25, intentos: 3, alEmpezar });
      let d = U.jsonDe(r.texto) || llamadaNativa(r.texto);
      if (!d || typeof d !== 'object' || (!d.respuesta && !d.herramienta && !d.tarea && !d.orden && !d.tareas && !d.mirar)) d = { respuesta: limpiarMarcas(r.texto).replace(/[{}[\]"]/g, '').slice(0, 400), accion: 'charla' };
      d.via = 'ia'; d.modelo = r.modelo; d.proveedor = r.proveedor; d.ms = r.ms;
      if (r.gratisPrimeraVez && origen !== 'api') {
        setTimeout(() => this.cuerpo({ cmd: 'mensaje', texto: 'ℹ Usé una IA gratis de internet (sin cuenta) porque no tengo otra. Puedes cambiarlo en mis Ajustes → Cerebro.', tipo: 'info', duracion: 12000 }).catch(() => {}), 4000);
      }
      this.mem.contar('ia');
      return d;
    } catch (e) {
      this.log('IA: ' + e.message);
      if (this.conNoviq() && RX_ORDEN.test(norm(texto))) return { respuesta: 'Mi IA no responde; se lo paso directo a Noviq.', accion: 'ejecutar', tarea: texto, via: 'respaldo' };
      // autonomía: lo que pueda resolver con Wikipedia o internet
      const sab = await this.sinIA(texto, norm(texto)).catch(() => null);
      if (sab) return Object.assign(sab, { ms: Date.now() - t0 });
      const det = (e.detalles || [])[0];
      let respuesta;
      if (e.sinIA || !det) respuesta = 'Para conversar de eso necesito una IA: abre Ollama o LM Studio, pon una clave gratis (Groq, Gemini…) en mis Ajustes → Cerebro, o conéctame con Noviq. Mientras tanto te ayudo con la hora, el clima, recordatorios, cálculos, noticias o Wikipedia.';
      else if (det.tipo === 'clave') respuesta = 'No puedo pensar: ' + corto(det.msg, 200) + ' Revísala en mis Ajustes, pestaña Cerebro.';
      else if (det.tipo === 'red' && (det.proveedor === 'ollama' || det.proveedor === 'lmstudio')) respuesta = corto(det.msg, 220);
      else if (det.tipo === 'tiempo') respuesta = 'Mi IA tardó demasiado: ' + corto(det.msg, 180);
      else respuesta = 'Ahora mismo mi IA no responde (' + corto(det.msg, 140) + '). ¿Lo intentamos en un momento?';
      return { respuesta, accion: 'charla', via: 'respaldo', ms: Date.now() - t0, emocion: 'confundido', error: e.message };
    } finally { clearTimeout(aviso); }
  }

  /** Con el resultado de una herramienta, responde la pregunta en 1–3 frases. */
  async resumirResultado(texto, nombre, datos, origen) {
    const crudo = typeof datos === 'string' ? datos : JSON.stringify(datos);
    try {
      const r = await this.cerebro.pensar({
        sistema: `Eres ${this.nombreBot()}, el asistente de ${this.mem.usuario() || 'tu usuario'}. ` +
          (origen === 'api' ? 'Responde claro y útil (máx. ~120 palabras).' : 'Respondes por VOZ: 1 a 3 frases cortas, sin markdown, sin enlaces, sin listas.') +
          ' Usa SOLO la información del resultado; si no alcanza, dilo. Fecha de hoy: ' + U.fechaTxt() + '.',
        usuario: `Pregunta: ${texto}\n\nResultado de «${nombre}»:\n${crudo.slice(0, 5000)}`, limiteSeg: 20, maxTokens: 300, temperatura: 0.3
      });
      return U.limpiarIA(r.texto).replace(/^["{]|["}]$/g, '');
    } catch (_) {
      if (Array.isArray(datos) && datos[0]) return `Encontré esto: ${datos[0].titulo}. ${corto(datos[0].resumen, 160)}`;
      return corto(U.textoHablado(crudo), 220);
    }
  }

  /**
   * La IA quiso mandar algo a Noviq: si NO es programar, lo hacen sus propias herramientas o bots (mucho más rápido).
   * → true si lo resolvió aquí (deja out.respuesta), false si sí es para Noviq.
   */
  async redirigirANoviq(d, texto, origen, out) {
    const tarea = String(d.tarea || '').trim() || texto;
    let o = this.rapido.interpretar(tarea);
    if (!o || o.tipo === 'noviq') o = o || this.rapido.interpretar(texto);
    if (!o || o.tipo === 'noviq') return false;
    if (o.tipo === 'documento' || o.tipo === 'doc_nuevo' || o.tipo === 'doc_resumir') {
      const r = await this.rapido.atender(o, { origen });
      if (!r) return false;
      if (r.accion === 'delegar') {
        const { lanzados } = await this.delegarTareas(r, texto, origen);
        if (!lanzados.length) return false;
        out.trabajos = lanzados; out.accion = 'delegar'; out._tipo = 'trabajando'; out.respuesta = r.respuesta;
        return true;
      }
      out.respuesta = r.respuesta; out.via = 'rapido'; out.accion = 'charla'; out._tipo = r.tipo;
      return true;
    }
    if (o.directo) {
      const r = await this.rapido.atender(o, { origen });
      if (!r) return false;
      if (r.accion === 'delegar') { o = { tipo: 'delegar', bot: r.bot, orden: r.orden }; out.respuesta = r.respuesta; }
      else { out.respuesta = r.respuesta; out.via = 'rapido'; out.accion = 'charla'; out._tipo = r.tipo; return true; }
    }
    if (o.tipo === 'delegar' && this.agentes) {
      const { lanzados } = await this.delegarTareas({ bot: o.bot, orden: o.orden || tarea }, texto, origen);
      if (!lanzados.length) return false;
      out.trabajos = lanzados; out.accion = 'delegar'; out._tipo = 'trabajando';
      out.respuesta = out.respuesta || `Voy, se lo paso a mi ${lanzados[0].botNombre.replace(/^Bot/, 'bot')}. Te aviso al terminar.`;
      this.mem.contar('delegados');
      return true;
    }
    return false;
  }

  /* ---------------------------------------------------- Decidir y actuar */
  async entregar(d, texto, origen, hablar) {
    const mem = this.mem;
    if (d && d.via === 'ia') d = await this.verificarDecision(d, texto, origen);
    const acc = String(d.accion || 'charla').toLowerCase();
    const out = { respuesta: d.respuesta || '', accion: acc, via: d.via, modelo: d.modelo, proveedor: d.proveedor, ms: d.ms };
    if (d.nombre) mem.ponerNombre(d.nombre, this.nombreBot());
    for (const h of (Array.isArray(d.recordar) ? d.recordar : []).slice(0, 5)) if (typeof h === 'string') mem.recordar(h, 'ia');
    let tipo = d.tipo || { ejecutar: 'trabajando', plan: 'pregunta' }[acc] || 'charla';
    if (acc === 'plan') out.plan = mem.guardarPlan(d.plan || texto).texto;
    else if (acc === 'cancelar_plan') mem.estadoPlan(mem.planActivo(), 'descartado');
    else if (acc === 'recordatorio') {
      const r = mem.crearRecordatorio(d.que || texto, d.cuando || texto);
      if (r) out.respuesta = out.respuesta || `Listo, te lo recuerdo ${U.cuandoTxt(r.cuando)}.`;
      else { this.pend = { tipo: 'recordatorio', que: d.que || texto, t: ahora() }; out.respuesta = `¿Cuándo te recuerdo «${corto(d.que || texto, 50)}»?`; tipo = 'pregunta'; }
    } else if (acc === 'herramienta' && d.herramienta && d.herramienta.nombre) {
      const h = d.herramienta;
      out.herramienta = h.nombre;
      mem.contar('herramientas');
      if (hablar && out.respuesta) this.decir(out.respuesta, 'trabajando', { voz: false });   // «Déjame buscar…» (sin voz para no esperar)
      this.cuerpo({ cmd: 'herramienta', nombre: /internet|pagina|buscar/.test(h.nombre) ? 'web' : /portapapeles/.test(h.nombre) ? 'documento' : /calcular/.test(h.nombre) ? 'chip' : 'engranaje', duracion: 0 }).catch(() => {});
      const r = await this.herr.ejecutar(h.nombre, h.args || {});
      this.cuerpo({ cmd: 'herramienta', nombre: false }).catch(() => {});
      if (!r.ok) { out.respuesta = 'No pude: ' + (r.error || 'falló la herramienta') + '.'; tipo = 'error'; }
      else if (r.info && r.datos != null) out.respuesta = await this.resumirResultado(texto, h.nombre, r.datos, origen);
      else out.respuesta = r.decir || out.respuesta || 'Listo.';
      out.resultado = r.datos;
    } else if (acc === 'ver') {
      if (!this.vision) { out.respuesta = 'Todavía no tengo ojos en este modo.'; tipo = 'info'; }
      else {
        if (hablar && out.respuesta) this.decir(out.respuesta, 'trabajando', { voz: false });
        mem.contar('mirar');
        const pregunta = String(d.mirar || d.pregunta || texto) + (origen === 'api' || d.leer ? '' : '\n(Responde en 1 a 3 frases cortas, para decirlo en voz alta.)');
        const r = await this.vision.mirar(pregunta, { fuente: d.fuente === 'pantalla' ? 'pantalla' : 'camara' });
        if (!r.ok && d.fuente === 'pantalla' && this.conNoviq() && this.d.noviq.escalar !== false) {
          // mis ojos no pudieron → Noviq (tiene su propia captura de pantalla con una IA que ve)
          const e = await this.encargarANoviq(d.leer ? 'Toma una captura de pantalla y léeme en voz alta el texto principal que se ve.' : 'Toma una captura de pantalla y dime: ' + texto, origen, 'La visión del avatar falló: ' + (r.error || ''));
          out.respuesta = 'No pude ver la pantalla yo solo. ' + e.respuesta; tipo = e.ok ? 'trabajando' : 'info';
        } else if (!r.ok) { out.respuesta = r.error || 'No pude ver nada ahora.'; tipo = r.apagada ? 'atencion' : 'error'; }
        else { out.respuesta = U.textoHablado ? U.textoHablado(r.decir) : r.decir; out.vision = { modelo: r.modelo, local: r.local, fuente: r.fuente }; tipo = 'charla'; }
      }
    } else if (acc === 'delegar') {
      if (!this.agentes) { out.respuesta = 'Mis bots internos no están activos.'; tipo = 'info'; }
      else {
        const { lanzados, fallos, repetidos } = d.trabajos ? { lanzados: d.trabajos, fallos: [], repetidos: [] } : await this.delegarTareas(d, texto, origen);
        out.trabajos = lanzados;
        if (!lanzados.length && repetidos && repetidos.length) { out.respuesta = repetidos[0]; tipo = 'info'; }
        else if (lanzados.length) {
          mem.contar('delegados');
          out.respuesta = d.respuesta || (lanzados.length > 1 ? `Listo, puse a ${lanzados.length} bots a trabajar. Te aviso cuando terminen.` : `Listo, se lo paso al ${lanzados[0].botNombre.replace(/^Bot de /, 'bot de ')}. Te aviso cuando termine.`);
          this.cuerpo({ cmd: 'herramienta', nombre: 'engranaje', duracion: 2500 }).catch(() => {});
          tipo = 'trabajando';
        } else { out.respuesta = 'No pude encargarlo: ' + (fallos[0] || 'no hay un bot para eso') + '.'; tipo = 'error'; }
      }
    } else if (acc === 'ejecutar' && d.via === 'ia' && this.rapido && this.d.rapido && this.d.rapido.noviqSoloProgramar !== false && (await this.redirigirANoviq(d, texto, origen, out))) {
      tipo = out._tipo || 'charla'; delete out._tipo;
    } else if (acc === 'ejecutar') {
      let tarea = String(d.tarea || '').trim() || texto;
      let plan = mem.planActivo();
      if (plan && /^(si|dale|hazlo|empieza|adelante|de una|listo|ok|vale|va|procede|ejecutalo|comienza|manos a la obra)\b/.test(norm(texto))) {
        tarea = plan.texto + (texto.split(' ').length > 2 ? '\n\nDetalle final del usuario: ' + texto : '');
      } else if (d.via !== 'ia') plan = null;
      out.tarea = tarea;
      if (!this.conNoviq()) {
        // (2.6) se queda la tarea: con «sí» abre Noviq, espera a que conecte y se la pasa
        this.pend = { tipo: 'abrir_noviq', tarea, t: ahora() };
        out.respuesta = 'Eso es para Noviq, que trabaja en tu PC, y está cerrado. ¿Lo abro y se lo paso?';
        tipo = 'pregunta';
        d.escuchar = true;
      } else {
        mem.contar('a_noviq');
        const proyecto = d.proyecto ? (await this.buscarProyecto(d.proyecto)) || '' : mem.proyectoActivo();
        const r = await this.noviq.tarea({ tarea: tarea + `\n\n(Pedido por voz al avatar${mem.usuario() ? ' de ' + mem.usuario() : ''}.)`, proyecto,
          en_chat: RX.en_chat.test(norm(texto)), origen });
        if (r && r.ok) {
          out.destino = r.destino; out.conv = r.conv;
          if (plan) mem.estadoPlan(plan, 'en_marcha', { conv: r.conv || null });
        } else { out.respuesta = 'No pude mandárselo a Noviq: ' + ((r && r.error) || 'no respondió') + '.'; tipo = 'error'; }
      }
    } else if (acc === 'charla' && d.aprender && d.via === 'ia' && texto.split(' ').length >= 2 && texto.split(' ').length <= 14 &&
      !/\b(hoy|ahora|ayer|manana|precio|clima|noticia|actual|ultimo)\b/.test(norm(texto))) mem.aprender(texto, out.respuesta, 'ia');
    if (['reflejo', 'aprendido', 'orden'].includes(d.via)) mem.contar('reflejos');
    if (d.via === 'rapido') mem.contar('rapido');
    if (out.respuesta) mem.registrar('assistant', out.respuesta, origen);
    if (hablar && out.respuesta && !d.yaDicho) {
      const extra = {};
      if (d.emocion) extra.expresion = d.emocion;
      if (d.gesto) extra.gesto = d.gesto;
      this.decir(out.respuesta, tipo, extra);
      this.e.ultimaCharla = Date.now();
      // conversación fluida: escucha tu respuesta sin que digas su nombre (pasa por el filtro de voces).
      // Si preguntó algo, la ventana es más larga; si no, corta (antes 10-20 s tras CADA respuesta: la tele se colaba)
      const pregunto = /\?\s*$/.test(out.respuesta.trim());
      this.ventanaLibre = Date.now() + (pregunto ? 15000 : 7000) + (out.respuesta.length / 16) * 1000;
      this.ultimoDicho = { texto: out.respuesta, t: Date.now(), pregunta: pregunto };
      if (d.escuchar && this.d.oido.modo === 'pulsar') this.cuerpo({ cmd: 'microfono', segundos: 10, silencioso: true }).catch(() => {});
    }
    this.emitir('charla', { texto, respuesta: out.respuesta, accion: out.accion, via: out.via });
    return out;
  }

  /* ---------------------------------------------- Preguntas de otros programas */
  /** Comando «preguntar»: otro programa pregunta algo al usuario; la respuesta sale como evento «respuesta». */
  preguntar(p) {
    const id = String(p.id || U.uid(8));
    const seg = Math.max(5, Math.min(300, Number(p.segundos) || 30));
    this.preguntaApp = { id, app: p.app || 'api', tipo: p.tipo || 'si_no', hasta: Date.now() + seg * 1000 };
    if (p.texto) this.decir(String(p.texto), p.aviso || 'pregunta');
    if (this.d.oido.modo === 'pulsar' || this.d.oido.modo === 'apagado') this.cuerpo({ cmd: 'microfono', segundos: Math.min(seg, 15), silencioso: true }).catch(() => {});
    return { id, hasta: this.preguntaApp.hasta };
  }
  /** Comando «escuchar_respuesta»: acepta frases sin su nombre durante unos segundos (lo usa Noviq al preguntar). */
  escucharSinNombre(seg) { this.ventanaLibre = Date.now() + Math.max(3, Math.min(300, Number(seg) || 30)) * 1000; return { hasta: this.ventanaLibre }; }

  /** Avisos de otros programas (p. ej. Noviq terminó un trabajo): quedan en su memoria de charla y en el plan. */
  alEventoApp(ev) {
    ev = ev || {};
    const app = !ev.app || ev.app === 'noviq' ? 'Noviq' : String(ev.app).slice(0, 30);
    if (ev.tipo === 'fin_trabajo') {
      const p = this.mem.planPorConv(ev.conv);
      if (p) this.mem.estadoPlan(p, ev.error ? 'borrador' : 'hecho');
      if (ev.resumen || ev.error) this.mem.registrar('assistant', ev.error ? `[${app} falló] ${corto(ev.error, 200)}` : `[${app} terminó] ${corto(ev.resumen, 300)}`, app.toLowerCase());
    } else if (ev.tipo === 'nota' && ev.texto) this.mem.registrar('assistant', `[${app}] ${corto(ev.texto, 300)}`, app.toLowerCase());
    if (ev.actividad !== false) this.actividad();
    return { ok: true };
  }

  /* -------------------------------------------------------- Portapapeles */
  nuevoClip(t) {
    t = String(t || '');
    if (!t.trim()) return;
    if (U.esSecreto(t)) { this.clips.push({ t: ahora(), texto: '', sensible: true, largo: t.length }); this.clips = this.clips.slice(-8); return; }
    this.clips.push({ t: ahora(), texto: t.slice(0, 6000), largo: t.length });
    this.clips = this.clips.slice(-8);
    // 🔎 si copiaste un error, ofrece ayuda (sin hablar, sin insistir)
    if (this.d.portapapeles.ayudaErrores && U.RX_ERROR.test(t) && Date.now() - this.e.ofertaClip > 180000 && Date.now() - this.e.ultimaCharla > 20000) {
      this.e.ofertaClip = Date.now();
      this.pend = { tipo: 'portapapeles', t: ahora() };
      this.cuerpo([{ cmd: 'sonido', nombre: 'pregunta' }, { cmd: 'mensaje', texto: '🔎 Copiaste un error. ¿Te ayudo? Dime «sí».', tipo: 'pensamiento', duracion: 9000 }]).catch(() => {});
    }
  }
  async clipReciente(maxSeg) {
    const c = this.clips[this.clips.length - 1];
    if (c && ahora() - c.t <= (maxSeg || 900)) return c;
    if (this.d.portapapeles.modo !== 'apagado' && this.herr.ctx.leerClip) {
      const t = await this.herr.ctx.leerClip();
      if (t && t.trim()) return { t: ahora(), texto: U.esSecreto(t) ? '' : t.slice(0, 6000), sensible: U.esSecreto(t), largo: t.length };
    }
    return null;
  }

  /* --------------------------------------------- Vida propia (cada segundo) */
  vigilar() {
    for (const r of this.mem.vencidos()) {
      const texto = this.conNombre(`⏰ {n}, te recuerdo: ${r.texto}`);
      this.actividad();
      this.decir(texto, 'atencion', { fijo: true });
      this.mem.registrar('assistant', texto, 'recordatorio');
      this.mem.cumplido(r);
      this.emitir('recordatorio', { texto: r.texto, id: r.id });
    }
    const ap = this.d.apariencia;
    const quieto = Date.now() - this.e.actividad;
    if (ap.dormirMin && !this.e.dormido && !this.e.pensando && quieto > ap.dormirMin * 60000 && !(this.noviq && this.noviq.info && this.noviq.info.trabajando)) {
      this.e.dormido = true;
      this.cuerpo({ cmd: 'dormir' }).catch(() => {});
    }
    const nivel = Number(this.d.identidad.autonomia) || 0;
    if (nivel && !this.e.dormido && !this.e.pensando && !this.pend.tipo && quieto > 480000 && Date.now() - this.e.tIniciativa > ({ 1: 1800, 2: 1200 }[nivel] || 900) * 1000) {
      this.e.tIniciativa = Date.now();
      this.cuerpo({ cmd: 'secuencia', pasos: this.iniciativa() }).catch(() => {});
    }
  }

  iniciativa() {
    const nivel = Number(this.d.identidad.autonomia) || 0;
    const rs = this.rasgos();
    const gestos = rs.flatMap((r) => P.RASGOS[r].idle);
    const g = elegir(gestos.length ? gestos : ['mirar']);
    const cmds = [g === 'mirar' ? { cmd: 'mirar', direccion: elegir(['izquierda', 'derecha', 'arriba']), duracion: 1800 } : g === 'bailar' ? { cmd: g, duracion: 2600 } : { cmd: g }];
    if (nivel >= 2 && Math.random() < 0.6) {
      const datos = this.mem.m.usuario.datos;
      const faltan = P.PREGUNTAS_PERFIL.filter(([k]) => datos[k] === undefined);
      let texto;
      if ((rs.includes('pregunton') || rs.includes('curioso')) && faltan.length && Math.random() < 0.5) {
        const [k, q] = faltan[0];
        texto = this.mem.usuario() ? this.conNombre(`{n}, ${q[0].toLowerCase()}${q.slice(1)}`) : q;
        this.mem.dato(k, '(preguntado)');
      } else if (!this.mem.usuario()) texto = 'Por cierto, aún no sé cómo te llamas.';
      else texto = elegir(P.DATOS);
      this.mem.registrar('assistant', texto, 'iniciativa');
      cmds.push(nivel >= 3 ? { cmd: 'aviso', tipo: 'info', texto, voz: !!this.d.voz.activada } : { cmd: 'mensaje', texto, tipo: 'pensamiento', duracion: 9000 });
    }
    return cmds;
  }

  /** Saludo al abrirse: con tu nombre y lo que tienes hoy (o pregunta cómo te llamas). */
  saludoInicial() {
    const m = this.mem.m;
    const hoy = new Date().toISOString().slice(0, 10);
    if (!this.mem.usuario()) { this.pend = { tipo: 'nombre', t: ahora() }; return [`¡Hola! Soy ${this.nombreBot()}, tu asistente. ¿Cómo te llamas?`, 'saludo']; }
    const h = new Date().getHours();
    const franja = h < 12 ? '¡Buenos días' : h < 19 ? '¡Buenas tardes' : '¡Buenas noches';
    if (m.stats.saludo_dia !== hoy) {
      m.stats.saludo_dia = hoy; this.mem.guardar();
      const partes = this.agendaDe(0);
      return [this.conNombre(`${franja}, {n}!`) + (partes.length ? ' Hoy tienes ' + partes.join('. ') + '.' : ''), 'saludo'];
    }
    return [this.frase('saludo'), 'saludo'];
  }

  estado() {
    return { nombre: this.nombreBot(), rasgos: this.rasgos(), usuario: this.mem.usuario(), pensando: this.e.pensando, dormido: this.e.dormido,
      preguntaAbierta: this.pend.tipo || (this.preguntaApp ? 'app' : null), ventanaLibre: Date.now() < this.ventanaLibre, clips: this.clips.length,
      ia: this.cerebro.ultimo, trabajos: this.agentes ? this.agentes.enCurso().length : 0 };
  }
}

module.exports = { Mente, rxNombre, SI, NO, ESQUEMA };
