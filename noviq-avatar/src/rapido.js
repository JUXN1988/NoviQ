'use strict';
/* ==========================================================================
   Noviq Avatar — ⚡ VÍA RÁPIDA: órdenes del PC al instante, SIN IA
   «abre Hub UI», «cierra Chrome», «apaga la PC», «sube el volumen»,
   «minimiza todo», «toma una captura», «busca el pdf de la factura»,
   «ejecuta el juego Aventura en los Andes», «abre el proyecto X en VS Code»…
   Se entienden con reglas (español latino, con «por favor», «puedes…»,
   «quiero que…») y se hacen en 0,1–2 s con el localizador. Nada pasa por
   la IA ni por Noviq. Lo que necesita varios pasos va a un bot delegado:
     · bot «pc»        → archivos y carpetas (crear, mover, organizar, borrar…)
     · bot «proyectos» → mirar/buscar/leer el código de tus proyectos
     · Noviq           → SOLO programar (crear o cambiar software)
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { norm, corto } = require('./util');
const { limpiarConsulta, buscarArchivos } = require('./localizador');
const H = require('./herramientas');
const T = require('./tiempo');

const WIN = process.platform === 'win32';

/* ------------------------------------------------------------ Gramática */
const RELLENO_INI = /^(?:(?:si|sip|ok|okay|vale|bueno|dale|ya|oye|ey|hey|eh|porfa|por favor|please|a ver|mira|ahora|entonces|y|tambien|listo|ahora si|rapido|noviq|solo|solamente|nada mas)\s+)+/;
const PETICION = /^(?:(?:me |nos )?(?:puedes|podrias|pudieras|puedas|quieres|quisieras|serias tan amable de|seria posible|podemos)\s+|(?:quiero|necesito|deseo|me gustaria|quisiera|ocupo)\s+(?:que\s+)?|ayudame a\s+|hazme el favor de\s+|haz el favor de\s+|te pido que\s+|anda y\s+|ve y\s+|vamos a\s+|tienes que\s+|debes\s+)/;
const PETICION_SUAVE = /^(?:(?:me |nos )?(?:puedes|podrias|pudieras|puedas|serias tan amable de)\s+|(?:quiero|necesito|deseo|me gustaria|quisiera) que\s+(?:me\s+)?|ayudame a\s+|hazme el favor de\s+|haz el favor de\s+|te pido que\s+)/;
const FIN = /\s+(?:por favor|porfa|porfavor|please|ahora|ahorita|ya mismo|ya|rapido|de una|gracias|si)$/;
const DISPOSITIVO = '(?:(?:la|el|mi|esta|este|tu)\\s+)?(?:pc|computadora|computador|compu|ordenador|equipo|maquina|laptop|portatil|computer|pc de escritorio)';
const RX_DISPOSITIVO = /\b(pc|computadora|computador|compu|ordenador|equipo|maquina|laptop|portatil|computer)\b/;

const ABRIR = '(?:me\\s+|te\\s+)?(?:abre(?:me|lo|la|los|las)?|abrir(?:me|lo|la)?|abras|abres|abrime|abri|open|lanza(?:me)?|lanzar|inicia(?:me|lo)?|iniciar|inicies|arranca(?:me|lo)?|arrancar|arranques|ejecuta(?:me|lo|la)?|ejecutar|ejecutes|corre(?:me|lo)?|correr|muestra(?:me)?|mostrar|mostrarme|ensena(?:me)?|ve a|vete a|entra a|entra en|llevame a|pon(?:me)? en pantalla)';
const RX = {
  apagar: new RegExp('^(?:apaga(?:me)?|apagar|apagues|apague|shut ?down|desconecta)\\s+' + DISPOSITIVO + '\\b'),
  reiniciar: new RegExp('^(?:reinicia(?:me)?|reiniciar|reinicies|reinicie|restart|resetea)\\s+' + DISPOSITIVO + '\\b'),
  suspender: new RegExp('^(?:suspende|suspender|suspendas|pon(?:er)? a dormir|manda a dormir|duerme|hiberna)\\s+' + DISPOSITIVO + '\\b|^(?:pon|poner|deja)\\s+' + DISPOSITIVO + '\\s+(?:en suspension|a dormir|en reposo)\\b'),
  bloquear: new RegExp('^(?:bloquea|bloquear|bloquees|bloquee)\\s+(?:(?:la|el|mi)\\s+)?(?:pc|computadora|computador|compu|pantalla|sesion|equipo|laptop)\\b'),
  cancelarApagado: /^(?:cancela(?:r)?|anula(?:r)?|deten(?:er)?|para(?:r)?|aborta(?:r)?)\s+(?:el\s+|ese\s+)?(?:apagado|reinicio|apagar|reiniciar)\b|^no\s+(?:la\s+|lo\s+)?(?:apagues|reinicies)\b|^ya no (?:la )?(?:apagues|reinicies)\b/,
  volFijar: /^(?:pon(?:me)?|ajusta|deja|sube(?:le)?|baja(?:le)?|cambia)\s+(?:el\s+)?(?:volumen|sonido|audio)\s+(?:al|a|en)\s+(\d{1,3})\b/,
  volSubir: /^(?:sube(?:le)?|subir|aumenta(?:le)?|aumentar|mas|dale mas)\s+(?:el\s+|al\s+)?(?:volumen|sonido|audio)\b/,
  volBajar: /^(?:baja(?:le)?|bajar|disminuye|reduce|menos|bajale al)\s+(?:el\s+|al\s+)?(?:volumen|sonido|audio)\b/,
  volMudo: /^(?:silencia(?:r)?(?:\s+(?:la|el)\s+(?:pc|computadora|sonido|audio))?|mutea(?:r)?|mute|sin sonido|quita(?:r)?\s+el\s+(?:sonido|audio|volumen)|apaga\s+el\s+(?:sonido|volumen|audio)|activa\s+el\s+(?:sonido|audio)|quita(?:r)?\s+el\s+silencio|desmutea(?:r)?)$/,
  minimizar: /^(?:minimiza(?:r)?\s+(?:todo|todas las ventanas|las ventanas|todas)|muestra(?:me)?\s+el\s+escritorio|ve al escritorio|ensena(?:me)?\s+el\s+escritorio|llevame al escritorio)$/,
  restaurar: /^(?:restaura(?:r)?|vuelve a (?:abrir|mostrar)|regresa)\s+(?:todas\s+)?las\s+ventanas$/,
  captura: /^(?:toma(?:me)?|tomar|haz(?:me)?|hacer|saca(?:me)?|sacar)\s+(?:una\s+)?(?:captura(?:\s+de\s+(?:la\s+)?pantalla)?|screenshot|pantallazo|foto\s+(?:a|de)\s+(?:la\s+)?pantalla)$|^captura(?:r)?\s+(?:de\s+)?(?:la\s+)?pantalla$|^(?:screenshot|pantallazo|captura de pantalla)$/,
  cerrar: /^(?:me\s+)?(?:cierra(?:me|lo|la|los|las)?|cerrar(?:lo|la)?|cierres|close)\s+(.+)$|^(?:mata|matar|termina|terminar)\s+(?:el\s+)?(?:proceso|programa)\s+(?:de\s+)?(.+)$/,
  buscarArchivo: /^(?:busca(?:me)?|buscar|encuentra(?:me)?|encontrar|localiza(?:me)?|donde (?:esta|estan|quedo|quedaron|guarde|deje|tengo))\s+(?:el |la |los |las |mi |mis |un |una )?((?:archivo|archivos|documento|documentos|carpeta|carpetas|pdf|excel|word|foto|fotos|imagen|imagenes|video|videos|presentacion|cancion|zip)\b.*)$/,
  elegir: /^(?:abre\s+|abreme\s+|ese\s+|esa\s+|el\s+|la\s+|numero\s+|opcion\s+)*(primer[oa]?|segund[oa]|tercer[oa]?|cuart[oa]|quint[oa]|ultim[oa]|1|2|3|4|5|uno|dos|tres|cuatro|cinco)(?:\s+(?:archivo|opcion|uno|una|de la lista))?$/,
  pcPasos: /^(?:crea(?:me)?|crear|haz(?:me)?)\s+(?:una?\s+)?(?:nueva\s+)?(?:carpeta|carpetas|archivo de texto|nota de texto|txt|acceso directo)\b|^(?:mueve|muevelos|mover|copia|copiar|pega|renombra|renombrar|cambia(?:le)? el nombre|borra|borrar|elimina|eliminar|organiza|organizar|ordena|ordenar|limpia|limpiar|comprime|comprimir|descomprime|descomprimir|extrae|extraer|vacia|vaciar|instala|instalar|desinstala|desinstalar|actualiza windows|libera)\b[\s\S]*\b(?:archivo|archivos|carpeta|carpetas|descargas|escritorio|documentos|fotos|imagenes|videos|musica|pdf|pdfs|zip|rar|papelera|disco|temporales|programa|programas|app|aplicacion)\b|^(?:cuanta|cuanto|cuantos|que|cual|revisa|mira|dime|verifica)\b.*\b(?:ram|memoria ram|espacio (?:en|del) disco|disco duro|procesador|cpu|direccion ip|mi ip|wifi|bateria|temperatura|uso de (?:la )?memoria)\b/,
  programar: /^(?:crea(?:me)?|crear|haz(?:me)?|hacer|programa(?:me)?|programar|desarrolla(?:r)?|construye|construir|genera(?:r)?|arregla(?:r|lo)?|corrige|corregir|repara(?:r)?|mejora(?:r)?|optimiza(?:r)?|modifica(?:r)?|cambia(?:r|le)?|agrega(?:le)?|agregar|anade(?:le)?|actualiza(?:r)?|implementa(?:r)?|refactoriza(?:r)?|termina(?:r)?|continua(?:r)?|sigue con|depura(?:r)?|compila(?:r)?|publica(?:r)?|despliega(?:r)?|sube a github)\b/,
  codigoCtx: /\b(programa|app|aplicacion|pagina|pagina web|web|sitio|juego|videojuego|script|codigo|funcion|clase|metodo|proyecto|bot|api|base de datos|interfaz|boton|nivel|niveles|personaje|personajes|mapa|servidor|backend|frontend|formulario|login|error|bug|errores|index|html|css|javascript|python|archivo)\b/,
  consultaProyecto: /^(?:muestra(?:me)?|ensena(?:me)?|busca(?:me)?|encuentra(?:me)?|donde (?:esta|estan)|que hace|como (?:funciona|hace|se hace)|lee(?:me)?|revisa|explica(?:me)?|dime|quiero ver|ver|abre)\b/,
  objetoCodigo: /\b(codigo|fragmento|funcion|funciones|clase|metodo|archivo|archivos|linea|lineas|parte|logica|script)\b/,
  ctxProyecto: /\b(proyecto|juego|app|aplicacion|programa)\b/,
  aNoviq: /\b(?:mandaselo|mandale|pasaselo|pasale|encargaselo|encargale|dile|pidele)\s+a\s+noviq\b|\b(?:en|con)\s+noviq\b|\bque lo haga noviq\b|\bal programa noviq\b/,
  noviqApp: /^(?:el\s+programa\s+|la\s+app\s+|la\s+ventana\s+de\s+)?(?:noviq|novi)$/
};
/* --------------------------------------------- Documentos (bot «documentos») */
const VERBO_DOC = '(?:haz|hazme|hagas|hacer|crea|creame|crees|crear|escribe|escribeme|escribas|escribir|redacta|redactame|redactes|redactar|genera|generame|generes|generar|' +
  'elabora|elaborame|elabores|elaborar|prepara|preparame|prepares|preparar|arma|armame|armes|armar|saca|sacame|dame|ponme|pon)';
const TIPO_DOC = '(resumen|resumenes|informe|ensayo|reporte|carta|oficio|lista|guia|apuntes|biografia|articulo|cuento|redaccion|investigacion|tarea|acta|documento|' +
  'hoja completa|pagina completa|hoja|pagina|escrito|texto|algo|trabajo|deber)';
const ADJ_DOC = '(?:(?:pequeno|pequena|corto|corta|breve|completo|completa|buen|buena|nuevo|nueva|detallado|detallada|lindo|bonito|formal)\\s+)?';
const RXD = {
  // «abre un documento nuevo de Word», «crea un documento en blanco», «abre un Word nuevo»
  nuevoA: /^(?:abre|abreme|crea|creame|haz|hazme|inicia|pon|ponme|dame|quiero)\s+(?:(?:un|una|otro|otra)\s+)?(?:(?:nuevo|nueva)\s+)?(?:documento|hoja|archivo)(?:\s+(?:nuevo|nueva|en blanco|vacio|vacia|limpio))?(?:\s+(?:de|en)\s+(?:microsoft\s+)?word)?(?:\s+(?:nuevo|nueva|en blanco|vacio))?(?:\s+(?:que se llame|llamado|llamada|con (?:el )?(?:nombre|titulo))\s+(.+))?$/,
  nuevoB: /^(?:abre|abreme|crea|creame|inicia|pon|dame)\s+(?:(?:un|una|otro|otra)\s+(?:(?:nuevo|nueva)\s+)?word(?:\s+(?:nuevo|en blanco))?|word\s+(?:nuevo|en blanco|vacio))(?:\s+(?:que se llame|llamado|con (?:el )?(?:nombre|titulo))\s+(.+))?$/,
  redactar: new RegExp('^' + VERBO_DOC + '\\s+(?:(?:un|una|el|la|unos|unas|otro|otra|mi|ese|esa|este|esta)\\s+)?' + ADJ_DOC + TIPO_DOC + '\\b(.*)$'),
  sinVerbo: new RegExp('^(?:(?:un|una|el|la)\\s+)?' + ADJ_DOC + TIPO_DOC + '\\s+(?:de|del|sobre|acerca de|acerca del)\\s+(.+)$'),
  resumirDoc: /^(?:resume(?:me)?|resumir|hazme un resumen de|haz un resumen de|lee(?:me)?)\s+(?:el|este|ese|mi)\s+(?:documento|word|archivo)(?:\s+(?:que (?:tengo|esta) abierto|abierto|de word))?$/,
  enAbierto: /\b(?:en (?:el|la|ese|este|esa|mi)|dentro (?:de (?:el|la|ese|este|esa|mi)|del))\s+(?:word|documento|hoja)\b|\b(?:el|la)\s+(?:word|documento|hoja)\s+(?:que\s+)?(?:esta|tengo)\s+(?:ahi|alli|abiert[oa])\b/,
  docMencion: /\b(word|documento|archivo|hoja|pagina|paginas|escrito|imprimir|guardalo|guardala)\b/,
  vago: /^(?:(?:el|la|lo|eso|esto|ese|esa)\b.*\b(?:que te pedi|que te dije|de antes|anterior)|que te pedi|que te dije|lo que (?:te pedi|encuentres|encuentras|halles|haya)(?: en internet)?|de lo que (?:encuentres|encuentras) en internet|eso|esto|lo mismo|el tema|ese tema|lo de antes|completo|completa)$/
};
const TIPO_FUERTE = /^(informe|ensayo|reporte|carta|oficio|biografia|articulo|investigacion|redaccion|acta|documento|hoja completa|pagina completa|escrito)$/;
const TIPO_DOC_CANON = { resumenes: 'resumen', 'hoja completa': 'resumen', 'pagina completa': 'resumen', hoja: 'resumen', pagina: 'resumen', escrito: 'documento', texto: 'documento', reporte: 'informe', tarea: 'documento', cuento: 'cuento', algo: 'documento', trabajo: 'documento', deber: 'documento' };
/** Páginas de la Configuración de Windows («abre la configuración de sonido»). */
const CONFIG_WIN = [[/\b(sonido|audio|altavoces|parlantes|bocinas|volumen)\b/, 'ms-settings:sound', 'la configuración de sonido'], [/\b(microfono|micro)\b/, 'ms-settings:sound', 'la configuración del micrófono'],
  [/\b(pantalla|monitor|resolucion|brillo)\b/, 'ms-settings:display', 'la configuración de pantalla'], [/\b(wifi|wi fi|red|internet)\b/, 'ms-settings:network-wifi', 'la configuración de wifi'],
  [/\bbluetooth\b/, 'ms-settings:bluetooth', 'la configuración de Bluetooth'], [/\b(actualizaciones|windows update|actualizar windows)\b/, 'ms-settings:windowsupdate', 'Windows Update'],
  [/\b(aplicaciones|programas instalados|apps)\b/, 'ms-settings:appsfeatures', 'las aplicaciones instaladas'], [/\b(impresoras?|escaner)\b/, 'ms-settings:printers', 'las impresoras'],
  [/\b(bateria|energia)\b/, 'ms-settings:powersleep', 'la configuración de energía'], [/\b(privacidad|camara)\b/, 'ms-settings:privacy-webcam', 'la privacidad de la cámara'],
  [/\b(fondo|fondo de pantalla|personalizar|personalizacion)\b/, 'ms-settings:personalization-background', 'el fondo de pantalla'], [/\b(fecha|hora)\b/, 'ms-settings:dateandtime', 'la fecha y hora'],
  [/\b(almacenamiento|disco|espacio)\b/, 'ms-settings:storagesense', 'el almacenamiento'], [/\b(mouse|raton)\b/, 'ms-settings:mousetouchpad', 'el mouse']];
const RX_CONFIG_WIN = /^(?:abre|abreme|muestra(?:me)?|ve a|entra a|llevame a|pon)\s+(?:la\s+)?(?:configuracion|ajustes|opciones|preferencias)\s+(?:de|del|de la|de los)\s+(.+)$/;

/** El tema se entiende en minúsculas y sin tildes; para el título del documento se recupera como lo dijiste
 *  («revolucion francesa» → «Revolución Francesa», «batalla de pichincha» → «Batalla de Pichincha»). */
function temaOriginal(texto, temaN) {
  const tq = norm(temaN).split(' ').filter(Boolean);
  if (!tq.length) return temaN;
  const pals = [...String(texto).matchAll(/[\p{L}\p{N}]+/gu)].map((m) => ({ w: norm(m[0]), i: m.index, f: m.index + m[0].length }));
  for (let j = 0; j + tq.length <= pals.length; j++) {
    let k = 0;
    while (k < tq.length && pals[j + k].w === tq[k]) k++;
    if (k === tq.length) return String(texto).slice(pals[j].i, pals[j + tq.length - 1].f);
  }
  return temaN;
}

const VERBO_EJECUTAR = /^(?:ejecuta(?:me|lo)?|ejecutar|ejecutes|corre(?:me|lo)?|correr|arranca(?:me)?|arrancar|inicia(?:me)?|iniciar|juega|jugar|probar|prueba|lanza(?:me)?|lanzar|pon a correr)\s+(?:el |la |mi |un )?(juego|videojuego|proyecto|programa|app|aplicacion)\s+(?:de |del )?(.+)$/;
const ORDINAL = { primero: 0, primer: 0, primera: 0, 1: 0, uno: 0, segundo: 1, segunda: 1, 2: 1, dos: 1, tercero: 2, tercer: 2, tercera: 2, 3: 2, tres: 2, cuarto: 3, cuarta: 3, 4: 3, cuatro: 3, quinto: 4, quinta: 4, 5: 4, cinco: 4 };

/** Procesos de los programas más comunes (para «cierra …»). */
const PROCESOS = { 'bloc de notas': ['notepad'], notepad: ['notepad'], calculadora: ['CalculatorApp', 'calc'], paint: ['mspaint'], chrome: ['chrome'], 'google chrome': ['chrome'],
  edge: ['msedge'], 'microsoft edge': ['msedge'], navegador: ['msedge', 'chrome', 'firefox', 'brave', 'opera'], firefox: ['firefox'], brave: ['brave'], opera: ['opera'],
  word: ['WINWORD'], excel: ['EXCEL'], powerpoint: ['POWERPNT'], outlook: ['OUTLOOK', 'olk'], 'visual studio code': ['Code'], 'vs code': ['Code'], vscode: ['Code'], code: ['Code'],
  spotify: ['Spotify'], discord: ['Discord'], whatsapp: ['WhatsApp', 'WhatsApp.Root'], telegram: ['Telegram'], steam: ['steam'], obs: ['obs64'], 'lm studio': ['LM Studio'],
  vlc: ['vlc'], teams: ['ms-teams', 'Teams'], zoom: ['Zoom'], 'administrador de tareas': ['Taskmgr'], cmd: ['cmd'], powershell: ['powershell', 'pwsh'], terminal: ['WindowsTerminal'],
  anydesk: ['AnyDesk'], 'github desktop': ['GitHubDesktop'], cursor: ['Cursor'], windsurf: ['Windsurf'], blender: ['blender'], 'unity hub': ['Unity Hub'] };
const PROTEGIDOS = /^(system|idle|csrss|wininit|winlogon|lsass|services|smss|svchost|explorer|dwm|fontdrvhost|sihost|ctfmon|runtimebroker|searchhost|startmenuexperiencehost|shellexperiencehost|textinputhost|msmpeng|nissrv|securityhealth\w*|avast\w*|avg\w*|asw\w*|afwserv|electron|noviq\w*|python\w*|pythonw|claude|msedgewebview2)$/i;

/* ------------------------------------------------- Lanzar cosas en Windows */
const idProyecto = (p) => p.id || (p.ruta ? path.basename(p.ruta) : p.nombre);
const sinComillas = (t) => String(t).replace(/["^&|<>%]/g, '');
function lanzarDefecto(cmd, args) {
  const p = spawn(cmd, args || [], { detached: true, windowsHide: true, stdio: 'ignore', windowsVerbatimArguments: cmd === 'cmd.exe' });
  p.on('error', () => {});
  p.unref();
  return true;
}

/* ===================================================================== */
class Rapido {
  /**
   * op: {localizador, ajustes, ejecutarPS, lanzar(cmd,args), abrirRuta, abrirURL, carpeta(k), noviq, conNoviq(), abrirNoviq(), log,
   *      herrCtx (contexto de herramientas.js para «abrir»)}
   */
  constructor(op) {
    Object.assign(this, { loc: op.localizador, aj: op.ajustes, ps: op.ejecutarPS, lanzar: op.lanzar || lanzarDefecto, abrirRuta: op.abrirRuta || (() => {}),
      abrirURL: op.abrirURL || (() => {}), carpeta: op.carpeta || (() => null), noviq: op.noviq || null, conNoviq: op.conNoviq || (() => false),
      abrirNoviq: op.abrirNoviq || (async () => false), log: op.log || (() => {}), herrCtx: op.herrCtx || null, agentes: op.agentes || null,
      win: op.windows != null ? !!op.windows : WIN, proceso: op.ejecutarProceso || null });
    this.documentos = op.documentos || null;
    this.ultimoTemaDoc = null; this.docEsperando = null;
    this.eleccion = null;   // {opciones:[{nombre, ruta}], hasta}
    this.stats = { ordenes: 0, ms: 0 };
  }
  get cfg() { return (this.aj && this.aj.datos.rapido) || { activar: true, apagadoSeg: 60 }; }
  activo() { return this.cfg.activar !== false; }
  bot(id) { const a = this.aj && this.aj.datos.agentes; return !!(this.agentes && a && a.activar && (!a[id] || a[id].activo !== false)); }

  /* ---------------------------------------------------------- Entender */
  /** Quita «sí», «por favor», «puedes…», «quiero que…» y deja la orden.
   *  suave: no quita los deseos («quiero hacer…», «vamos a…»): sirven para saber si es una idea o una orden de programar. */
  limpiar(texto, suave) {
    let n = norm(texto).replace(/^que\s+(?=(?:abras|cierres|apagues|reinicies|bloquees|subas|bajes|crees|hagas|escribas|redactes|busques|pongas|minimices|ejecutes|leas|me leas)\b)/, '');
    for (let i = 0; i < 4; i++) {
      const a = n;
      n = n.replace(RELLENO_INI, '').replace(suave ? PETICION_SUAVE : PETICION, '').replace(FIN, '').trim();
      if (n === a) break;
    }
    // subjuntivo / infinitivo → imperativo: «que apagues la pc», «apagar la pc»
    // Whisper oye «haz» como «hace» o «has»: «hace un resumen de…» es una orden
    n = n.replace(/^(?:hace|has)\s+(?=(?:un|una|el|la|me|lo|otro|otra)\b)/, 'haz ').replace(/^(?:me\s+)?(leas|leer)\b/, 'lee');
    return n.replace(/^(?:me\s+)?(apagues|apagar)\b/, 'apaga').replace(/^(?:me\s+)?(reinicies|reiniciar)\b/, 'reinicia').replace(/^(?:me\s+)?(cierres|cerrar)\b/, 'cierra')
      .replace(/^(?:me\s+)?(abras|abrir|abres)\b/, 'abre').replace(/^(?:me\s+)?(crees|crear)\b/, 'crea').replace(/^(?:me\s+)?(hagas|hacer)\b/, 'haz')
      .replace(/^(?:me\s+)?(escribas|escribir)\b/, 'escribe').replace(/^(?:me\s+)?(redactes|redactar)\b/, 'redacta').replace(/^(?:me\s+)?(resumas)\b/, 'resume').replace(/^(?:me\s+)?(bloquees|bloquear)\b/, 'bloquea').replace(/^(?:me\s+)?(subas|subir)\b/, 'sube').replace(/^(?:me\s+)?(bajes|bajar)\b/, 'baja');
  }

  /**
   * ¿Es una orden del PC que se hace sin IA? → {tipo, …, directo} o null.
   * directo=true: se hace aquí mismo; si no, va a un bot delegado o a Noviq.
   */
  /** Igual que interpretar() pero SIN efectos (no gasta la respuesta a «¿sobre qué tema?» ni la lista de opciones):
   *  para preguntar «¿esto es una orden?» desde el oído o al repartir trabajos. */
  probar(texto) {
    const g = { d: this.docEsperando, u: this.ultimoTemaDoc, e: this.eleccion };
    try { return this.interpretar(texto); } finally { this.docEsperando = g.d; this.ultimoTemaDoc = g.u; this.eleccion = g.e; }
  }

  interpretar(texto) {
    if (!this.activo()) return null;
    const n = this.limpiar(texto);
    if (!n || n.split(' ').length > 40) return null;
    let g;
    // elegir de la lista que acabo de decir («el segundo»)
    if (this.eleccion && Date.now() < this.eleccion.hasta && (g = n.match(RX.elegir))) {
      const k = /ultim/.test(g[1]) ? this.eleccion.opciones.length - 1 : ORDINAL[g[1]];
      if (k != null && this.eleccion.opciones[k]) return { tipo: 'elegir', i: k, directo: true, texto: n };
    }
    // energía
    if (RX.cancelarApagado.test(n)) return { tipo: 'energia', accion: 'cancelar', directo: true, texto: n };
    if (RX.apagar.test(n)) return { tipo: 'energia', accion: 'apagar', directo: true, texto: n, segundos: this.segundosHasta(texto) };
    if (RX.reiniciar.test(n)) return { tipo: 'energia', accion: 'reiniciar', directo: true, texto: n, segundos: this.segundosHasta(texto) };
    if (RX.suspender.test(n)) return { tipo: 'energia', accion: 'suspender', directo: true, texto: n };
    if (RX.bloquear.test(n)) return { tipo: 'energia', accion: 'bloquear', directo: true, texto: n };
    // volumen, ventanas, captura
    if ((g = n.match(RX.volFijar))) return { tipo: 'volumen', accion: 'fijar', valor: Math.min(100, Number(g[1])), directo: true, texto: n };
    if (RX.volSubir.test(n)) return { tipo: 'volumen', accion: 'subir', directo: true, texto: n };
    if (RX.volBajar.test(n)) return { tipo: 'volumen', accion: 'bajar', directo: true, texto: n };
    if (RX.volMudo.test(n)) return { tipo: 'volumen', accion: 'mudo', directo: true, texto: n };
    if (RX.minimizar.test(n)) return { tipo: 'ventanas', accion: 'minimizar', directo: true, texto: n };
    if (RX.restaurar.test(n)) return { tipo: 'ventanas', accion: 'restaurar', directo: true, texto: n };
    if (RX.captura.test(n)) return { tipo: 'captura', directo: true, texto: n };
    // Noviq a propósito («pásaselo a Noviq», «hazlo en Noviq»)
    if (RX.aNoviq.test(n)) return { tipo: 'noviq', orden: texto, texto: n };
    // 📖 leer en voz alta un documento («léeme el documento», «lee el archivo que dice Batalla de Pichincha»,
    // «lee lo que está en la pantalla»): lo hace el avatar (Word abierto o sus documentos)
    const leer = this.interpretarLeer(n);
    if (leer) return leer;
    // documentos de Word (los hace el avatar: bot «documentos», sin Noviq)
    const doc = this.interpretarDocumento(texto, n);
    if (doc) return doc;
    // páginas de la Configuración de Windows
    if ((g = n.match(RX_CONFIG_WIN))) {
      const c = CONFIG_WIN.find(([rx]) => rx.test(g[1]));
      if (c) return { tipo: 'config_win', uri: c[1], nombre: c[2], directo: true, texto: n };
    }
    // cerrar un programa
    if ((g = n.match(RX.cerrar))) {
      const obj = (g[1] || g[2] || '').replace(/^(el|la|los|las|mi|mis|ese|esa|este|esta)\s+/, '').trim();
      if (obj && !/^(sesion|la sesion|todo|todos|el proyecto|proyecto)\b/.test(obj) && obj.split(' ').length <= 6) return { tipo: 'cerrar', objetivo: obj, directo: true, texto: n };
    }
    // buscar archivos
    if ((g = n.match(RX.buscarArchivo))) return { tipo: 'buscar_archivo', objetivo: g[1], directo: true, texto: n };
    // varios pasos en archivos/carpetas/sistema → bot de PC
    if (RX.pcPasos.test(n) && !(RX.programar.test(n) && /\b(programa|app|aplicacion|juego|pagina|codigo|script|proyecto)\b/.test(n) && !/\b(carpeta|carpetas|archivo de texto|acceso directo)\b/.test(n)))
      return { tipo: 'delegar', bot: 'pc', orden: texto, texto: n };
    // programar (crear o cambiar software) → Noviq. Solo si es una ORDEN («crea…», «puedes arreglar…»);
    // «quiero hacer un juego» es una idea: la conversa la mente (plan) sin mandar nada.
    const nd = this.limpiar(texto, true);
    if (RX.programar.test(nd) && RX.codigoCtx.test(nd) && nd.split(' ').length >= 3) return { tipo: 'noviq', orden: texto, texto: nd };
    // mirar el código de un proyecto → bot de proyectos (rápido, sin cambiar nada)
    if (RX.consultaProyecto.test(n) && RX.objetoCodigo.test(n) && RX.ctxProyecto.test(n)) return { tipo: 'delegar', bot: 'proyectos', orden: texto, texto: n };
    // ejecutar un proyecto/juego
    if ((g = n.match(VERBO_EJECUTAR))) return { tipo: 'ejecutar', objetivo: g[2], pista: g[1], directo: true, texto: n };
    // abrir (programas, archivos, carpetas, webs, proyectos)
    if ((g = n.match(new RegExp('^' + ABRIR + '\\s+(.+)$')))) {
      const obj = g[1].trim();
      if (obj.split(' ').length <= 14 && !/^(los ojos|la boca|tu mente|tus ajustes|tu configuracion)\b/.test(obj)) return { tipo: 'abrir', objetivo: obj, directo: true, texto: n };
    }
    return null;
  }

  /**
   * Pedidos de documentos. → {tipo:'doc_nuevo', titulo} | {tipo:'documento', tema, tipoDoc, enAbierto, extension, instrucciones} | {tipo:'doc_resumir'} | null
   * Si no dice el tema («haz el documento que te pedí», «crea una hoja completa de lo que encuentres en internet»)
   * usa el último tema pedido (hasta 30 min); si tampoco hay, pregunta.
   */
  interpretarDocumento(texto, n) {
    n = (n || this.limpiar(texto)).replace(/^que\s+(?=(?:hagas|crees|escribas|redactes|generes|prepares|armes|haz|crea|escribe|redacta)\b)/, '');
    n = this.limpiar(n);
    // «escribe en el Word un resumen de X» → «escribe un resumen de X en el word»
    n = n.replace(new RegExp('^(' + VERBO_DOC + ')\\s+((?:en|dentro de|dentro del)\\s+(?:(?:el|la|ese|este|mi)\\s+)?(?:word|documento|hoja)(?:\\s+(?:que\\s+)?(?:esta\\s+)?(?:ahi|abierto|abierta))?)\\s+(.+)$'), '$1 $3 $2');
    let g;
    if ((g = n.match(RXD.nuevoA) || n.match(RXD.nuevoB))) return { tipo: 'doc_nuevo', titulo: g[1] ? g[1].trim() : '', directo: true, texto: n };
    if (RXD.resumirDoc.test(n)) return { tipo: 'doc_resumir', directo: false, texto: n };
    // respuesta a «¿sobre qué tema?»
    if (this.docEsperando && Date.now() < this.docEsperando.hasta && !/^(no|nada|cancela|olvidalo|dejalo)\b/.test(n) && n.split(' ').length <= 16) {
      const e = this.docEsperando; this.docEsperando = null;
      const tema = temaOriginal(texto, n.replace(/^(sobre|de|del|acerca de)\s+/, '').trim());
      if (tema) { this.ultimoTemaDoc = { tema, t: Date.now() }; return Object.assign({}, e, { tema, texto: n }); }
    }
    g = n.match(RXD.redactar) || (n.match(RXD.sinVerbo) ? [null, n.match(RXD.sinVerbo)[1], ' de ' + n.match(RXD.sinVerbo)[2]] : null);
    if (!g) return null;
    const tipoDicho = g[1], resto = String(g[2] || '');
    const tipoDoc = TIPO_DOC_CANON[tipoDicho] || tipoDicho;
    // ¿de verdad es un documento? (no «dame una lista de 5 frutas» ni «hazme un resumen» para charlar)
    if (!TIPO_FUERTE.test(tipoDicho) && !RXD.docMencion.test(resto) && !RXD.enAbierto.test(n) && !/internet/.test(resto)) return null;
    if (/^(lista|texto|cuento)$/.test(tipoDicho) && !RXD.docMencion.test(n)) return null;
    const enAbierto = RXD.enAbierto.test(n) && !/\b(nuevo|nueva|otro|otra)\s+(documento|word)\b/.test(n);
    let tema = resto
      .replace(/\b(?:de|con)?\s*(?:una|1|dos|2|tres|3|media|cuatro|4|cinco|5)\s+(?:pagina|paginas|hoja|hojas)\b/, ' ')
      .replace(/\s+(?:y\s+)?(?:guardalo|guardala|ponlo|ponla|abrelo|abrela|escribelo|escribela|pasalo|pasala)\b.*$/, '')
      .replace(/\s*\b(?:y\s+)?(?:lo|la)\s+(?:abres|abras|guardas|guardes|pones|pongas|escribes|escribas)\b.*$/, '')
      .replace(/\s*\b(?:y\s+)?(?:en|dentro de|dentro del)\s+(?:un|una|el|la|ese|este|esa|mi|tu)?\s*(?:nuevo\s+|nueva\s+)?(?:word|documento|archivo|hoja|pagina)\b.*$/, '')
      .replace(/\s+(?:como|en forma de)?\s*(?:un|una)\s+(?:resumen|informe|ensayo)$/, '')
      .replace(/\s+(?:por favor|porfa|gracias|ahora|ya)$/, '').replace(/\s+/g, ' ').trim()
      .replace(/\s+para\s+(?:el|la|mi|mis|los)\s+(?:colegio|escuela|clase|clases|universidad|u|profe|profesor|profesora|maestro|maestra|deber|deberes|tarea|tareas)\b.*$|\s+para\s+(?:manana|hoy|el lunes|el martes|el miercoles|el jueves|el viernes)$/, '')
      .replace(/^(?:de|del|sobre|acerca de|acerca del|que hable de|que trate de|referente a)\s+/, '').trim();
    if (RXD.vago.test(tema) || /^(?:de )?lo que (?:encuentres|encuentras|halles|haya)\b/.test(tema) || tema.length < 3) tema = '';
    if (/\binternet\b/.test(tema) && tema.split(' ').length <= 6) tema = '';
    tema = tema.replace(/^(?:breve|corto|corta|completo|completa|detallado|detallada|pequeno|pequena|formal|bonito|lindo)\s+/, '').replace(/^(?:sobre|de|acerca de)\s+/, '').trim();
    let extension = '';
    const ext = n.match(/\b(una|1|dos|2|tres|3|media|cuatro|4|cinco|5)\s+(pagina|paginas|hoja|hojas)\b(?!\s+completa)/) || n.match(/\b(\d{2,4})\s+palabras\b/);
    if (/\b(hoja|pagina) completa\b/.test(n)) extension = 'una página completa (unas 550-700 palabras)';
    else if (ext) extension = ext[0];
    else if (/\b(breve|corto|corta|pequeno|pequena)\b/.test(n)) extension = 'media página (unas 250 palabras)';
    let tipoFinal = tipoDoc, deMemoria = false;
    const previo = this.ultimoTemaDoc && Date.now() - this.ultimoTemaDoc.t < 30 * 60000 ? this.ultimoTemaDoc : null;
    if (!tema && previo) { tema = previo.tema; deMemoria = true; if (tipoDoc === 'documento' && previo.tipoDoc) tipoFinal = previo.tipoDoc; }
    const o = { tipo: 'documento', tipoDoc: tipoFinal, tema, enAbierto: enAbierto || !!(deMemoria && previo.enAbierto && /\b(ahi|abierto|ese|el word)\b/.test(n)),
      extension, instrucciones: String(texto).slice(0, 400), directo: false, texto: n, temaDeMemoria: deMemoria };
    if (tema && !deMemoria) { tema = temaOriginal(texto, tema); o.tema = tema; }
    if (tema) this.ultimoTemaDoc = { tema, tipoDoc: tipoFinal, enAbierto: o.enAbierto, t: Date.now() };
    return o;
  }

  /** «léeme el documento / el archivo que dice X / lo que está en la pantalla / todo» → {tipo:'leer_doc', nombre, pantalla} */
  interpretarLeer(n) {
    const pantalla = /\bpantalla\b/.test(n);
    // «no escucho que estés leyendo» / «no estás leyendo»: repetir la última lectura pedida
    if (/\b(no (te )?(escucho|oigo)|no estas) (que )?(estes |estas )?leyendo\b/.test(n)) {
      const u = this.ultimoLeer && Date.now() - this.ultimoLeer.t < 15 * 60000 ? this.ultimoLeer : { nombre: '', pantalla: false };
      return { tipo: 'leer_doc', nombre: u.nombre, pantalla: u.pantalla, directo: true, texto: n };
    }
    // «captura la pantalla y leo» (Whisper oyó «leo» por «léelo»)
    if (/^(?:captura(?:r)? (?:la )?pantalla|toma (?:una )?captura(?: de (?:la )?pantalla)?) y (?:leo|lee\w*)\b/.test(n)) {
      this.ultimoLeer = { nombre: '', pantalla: true, t: Date.now() };
      return { tipo: 'leer_doc', nombre: '', pantalla: true, directo: true, texto: n };
    }
    let g = n.match(/^(?:captura (?:la )?pantalla y |ve a la pantalla y )?(?:lee|leeme|leelo|leela|leeas|lee todo|leemelo|leemela)\b\s*(.*)$/);
    let enMedio = false;
    // «si pero lees tú, lees todo el documento», «sé lo que hiciste pero quiero que leas el documento todo»
    if (!g && (g = n.match(/\b(?:lee|leeme|leelo|leela|lees|leas|leer|leemelo|leemela)\b\s+(.*)$/))) enMedio = true;
    if (!g) return null;
    let resto = g[1].replace(/\b(?:por favor|porfa|completo|completa|entero|entera|en voz alta|desde el (?:primer|principio|inicio)\b.*|desde el primer parrafo|todo)\b/g, ' ').replace(/\s+/g, ' ').trim();
    const mencion = /\b(documento|archivo|word|resumen|informe|ensayo|carta|escrito|texto|hoja|lo que (?:escribiste|escribio|hiciste|hizo|creaste|creo|pusiste|puso|hay|dice|sale|esta)|eso|esto|pantalla)\b/.test(resto) || (!resto && !enMedio);
    if (enMedio && !mencion) return null;
    let nombre = '';
    const h = resto.match(/\b(?:que dice|que se llama|llamado|llamada|titulado|de nombre|sobre|del?)\s+(.+)$/);
    if (h) nombre = h[1];
    else if (!mencion) nombre = resto;   // «lee batalla de pichincha»
    nombre = nombre.replace(/\b(?:que esta|que tengo|en la pantalla|en el word|en word|abierto|abierta)\b.*$/, '').replace(/^(?:el|la|los|las|un|una|mi)\s+/, '').trim();
    if (!mencion && !nombre) return null;
    // «lee la noticia», «lee mis correos»… no son documentos (salvo que exista uno con ese nombre)
    if (!mencion && this.documentos && !this.documentos.resolver(nombre)) return null;
    this.ultimoLeer = { nombre, pantalla, t: Date.now() };
    return { tipo: 'leer_doc', nombre, pantalla, directo: true, texto: n };
  }

  /** «abre un documento nuevo de Word» → .docx en blanco con nombre, abierto en Word. */
  docNuevo(o) {
    if (!this.documentos) return this.abrir('word', {});
    const r = this.documentos.nuevo({ titulo: o.titulo || '' });
    return this.r(`Listo, abrí un documento nuevo de Word${o.titulo ? ' «' + o.titulo + '»' : ''}. Dime qué escribo en él (por ejemplo: «escribe un resumen de la Batalla de Pichincha en el Word»).`,
      { gesto: 'senalar', abierto: r.ruta, documento: r.ruta });
  }

  /** Pedido de documento → al bot «documentos» (en segundo plano). Sin tema: pregunta. */
  async documento(o, op) {
    if (!o.tema) {
      this.docEsperando = Object.assign({}, o, { hasta: Date.now() + 90000 });
      return this.r(`¿Sobre qué tema hago ${o.tipoDoc === 'documento' ? 'el documento' : 'el ' + o.tipoDoc}?`, { tipo: 'pregunta', escuchar: true });
    }
    const datos = { tema: o.tema, tipo: o.tipoDoc, enAbierto: o.enAbierto, extension: o.extension, instrucciones: o.instrucciones };
    if (op.desdeBot || !this.bot('documentos')) {
      if (!this.documentos) return null;
      const r = await this.documentos.redactar(datos);
      return r.ok ? this.r(`Listo: ${r.insertado ? 'lo escribí en tu Word' : 'creé y abrí'} «${r.titulo}» (${r.palabras} palabras).`, { abierto: r.ruta })
        : this.r('No pude hacer el documento: ' + r.error, { ok: false, tipo: 'error' });
    }
    const donde = o.enAbierto ? 'en tu Word abierto' : 'en un documento de Word';
    return { respuesta: `Voy: investigo «${corto(o.tema, 60)}» y te lo escribo ${donde}. Te aviso cuando esté listo.`, accion: 'delegar', bot: 'documentos',
      orden: `Redacta ${o.tipoDoc} sobre «${o.tema}» ${donde}.`, datos, via: 'rapido', tipo: 'trabajando' };
  }

  /** «resume el documento» → el último que hice o el que tienes abierto en Word. */
  async docResumir(op) {
    if (!this.documentos) return null;
    let ruta = this.documentos.ultimo && this.documentos.ultimo.ruta;
    if (this.documentos.rutaWordActivo) { const r = await this.documentos.rutaWordActivo().catch(() => null); if (r) ruta = r; }
    if (!ruta) return this.r('¿Qué documento resumo? Ábrelo en Word o dime su nombre.', { tipo: 'pregunta', escuchar: true });
    let texto = '';
    try { texto = this.documentos.leer(ruta); } catch (e) { return this.r('No pude leer el documento: ' + corto(e.message, 120), { ok: false }); }
    if (texto.trim().length < 80) return this.r('Ese documento está casi vacío: no hay nada que resumir.', { ok: false });
    return this.documento({ tipo: 'documento', tipoDoc: 'resumen', tema: path.basename(ruta).replace(/\.[^.]+$/, ''), extension: 'media página', instrucciones: 'Resume el documento del material.' }, op)
      .then((r) => { if (r && r.datos) r.datos.texto = texto.slice(0, 14000); return r; });
  }

  /** «apaga la pc en 20 minutos / a las 22:30» → segundos (o null si no dijo cuándo). */
  segundosHasta(texto) {
    const c = T.interpretar(texto);
    if (!c || c.tipo !== 'una_vez') return null;
    const ts = c.exacto ? c.exacto * 1000 : new Date(c.fecha).getTime();
    const s = Math.round((ts - Date.now()) / 1000);
    return s > 0 && s <= 3 * 86400 ? s : null;
  }

  /* ------------------------------------------------------------ Hacer */
  r(respuesta, extra) { return Object.assign({ respuesta, accion: 'charla', via: 'rapido' }, extra || {}); }

  /**
   * Hace la orden. → respuesta para la mente ({respuesta, accion, via:'rapido', …}) o null si no aplica.
   * op: {desdeBot: true} cuando lo usa un bot (no delega de vuelta), {textoOriginal}
   */
  async atender(o, op) {
    op = op || {};
    const t0 = Date.now();
    let r;
    try {
      switch (o.tipo) {
        case 'abrir': r = await this.abrir(o.objetivo, op); break;
        case 'ejecutar': r = await this.ejecutar(o.objetivo, o.pista, op); break;
        case 'elegir': r = await this.elegir(o.i); break;
        case 'cerrar': r = await this.cerrar(o.objetivo); break;
        case 'energia': r = await this.energia(o.accion, o.segundos); break;
        case 'volumen': r = await this.volumen(o.accion, o.valor); break;
        case 'ventanas': r = await this.ventanas(o.accion); break;
        case 'captura': r = await this.captura(); break;
        case 'buscar_archivo': r = await this.buscarArchivo(o.objetivo, op); break;
        case 'doc_nuevo': r = this.docNuevo(o); break;
        case 'documento': r = await this.documento(o, op); if (!r) return null; break;
        case 'doc_resumir': r = await this.docResumir(op); if (!r) return null; break;
        case 'config_win': this.abrirURLoApp(o.uri); r = this.r(`Abro ${o.nombre}.`, { gesto: 'senalar' }); break;
        case 'leer_doc': {   // (la mente lo lee en voz alta por partes; aquí, para bots y la API, el texto)
          if (!this.documentos) return null;
          const d = await this.documentos.textoParaLeer(o);
          r = d.ok ? this.r(corto(d.texto, 3000), { documento: d.ruta || d.titulo }) : this.r(d.error, { ok: false });
          break;
        }
        case 'delegar':
          if (op.desdeBot || !this.bot(o.bot)) return null;
          r = { respuesta: o.bot === 'proyectos' ? 'Voy, lo busco en tu proyecto.' : 'Voy, se lo paso a mi bot de PC.', accion: 'delegar', bot: o.bot, orden: o.orden, via: 'rapido', tipo: 'trabajando' };
          break;
        case 'noviq': return op.desdeBot ? null : { respuesta: '', accion: 'ejecutar', tarea: o.orden, via: 'orden', tipo: 'trabajando' };
        default: return null;
      }
    } catch (e) {
      this.log('vía rápida: ' + e.message);
      r = this.r('No pude: ' + corto(e.message, 140) + '.', { ok: false, tipo: 'error' });
    }
    if (r) { this.stats.ordenes++; this.stats.ms = Date.now() - t0; r.ms = Date.now() - t0; }
    return r;
  }

  /** Desde la herramienta «orden_pc» de la IA o desde un bot. → {ok, decir|error, delegar?} */
  async ejecutarTexto(texto, op) {
    const o = this.interpretar(texto);
    if (!o) return { ok: false, error: 'no entendí esa orden del PC' };
    const r = await this.atender(o, op);
    if (!r) return { ok: false, error: 'eso necesita varios pasos', delegar: o.bot ? { bot: o.bot, orden: o.orden } : null, noviq: o.tipo === 'noviq' };
    if (r.accion === 'delegar' || r.accion === 'ejecutar') return { ok: false, error: 'eso necesita varios pasos', delegar: r.accion === 'delegar' ? { bot: r.bot, orden: r.orden } : null, noviq: r.accion === 'ejecutar' };
    return { ok: r.ok !== false, decir: r.respuesta, error: r.ok === false ? r.respuesta : undefined };
  }

  /* -------------------------------------------------------------- Abrir */
  async abrir(objetivo, op) {
    op = op || {};
    const lim = limpiarConsulta(objetivo);
    const o = norm(objetivo);
    // Noviq (el programa)
    if (RX.noviqApp.test(o) || RX.noviqApp.test(lim.q)) {
      if (this.conNoviq()) { if (this.noviq) this.noviq.evento('abrir', {}); return this.r('Te muestro Noviq.'); }
      const ok = await this.abrirNoviq();
      return this.r(ok ? 'Abro Noviq. Dame unos segundos.' : 'No encontré cómo abrir Noviq desde aquí.', { ok });
    }
    // «Word», «Microsoft Word», «Excel»…: si el menú Inicio tiene ESE programa, se abre ese acceso (el atajo fijo
    // «winword» falla en algunas instalaciones de Office y no avisa)
    const q0 = lim.q || o;
    // (solo Office: las apps del sistema y las de enlace — calculadora, whatsapp:, spotify: — siguen con su atajo instantáneo)
    if (this.loc && q0 && lim.pista !== 'proyecto' && lim.pista !== 'juego' && /^(microsoft\s+)?(office\s+)?(word|excel|powerpoint|outlook|onenote|access|publisher)(\s+\d{2,4})?$/.test(q0)) {
      const b0 = await this.loc.buscar(q0.replace(/^microsoft\s+/, ''), { tipos: ['acceso', 'uwp', 'app'], corte: 0.97 });
      if (b0.mejor) { this.lanzarEntrada(b0.mejor, lim.editor); return this.r(`Abro «${b0.mejor.nombre}».`, { gesto: 'senalar', abierto: b0.mejor.ruta || b0.mejor.appId }); }
    }
    // webs, carpetas conocidas y apps de siempre (instantáneo)
    if (this.herrCtx && lim.pista !== 'proyecto' && lim.pista !== 'archivo') {
      for (const intento of [objetivo, lim.q]) {
        if (!intento) continue;
        const dicho = H.abrir(intento, this.herrCtx, { sinAccesos: !!this.loc });
        if (dicho) return this.r(dicho, { gesto: 'senalar' });
      }
    }
    if (!this.loc) return null;
    // proyectos
    if (lim.pista === 'proyecto' || lim.pista === 'juego') {
      const p = await this.loc.proyecto(lim.q);
      if (p) return lim.pista === 'juego' && !lim.editor ? this.ejecutarProyecto(p) : this.abrirProyecto(p, lim.editor);
    }
    // todo lo demás: escritorio, menú Inicio, apps, proyectos
    const b = await this.loc.buscar(objetivo);
    if (b.mejor) {
      const e = b.mejor;
      if (e.tipo === 'proyecto') return lim.pista === 'juego' ? this.ejecutarProyecto(e) : this.abrirProyecto(e, lim.editor);
      this.lanzarEntrada(e, lim.editor);
      const casi = b.puntaje < 0.9 ? ' (es lo más parecido que encontré)' : '';
      return this.r(`Abro «${e.nombre}»${casi}.`, { gesto: 'senalar', abierto: e.ruta || e.appId });
    }
    // ¿un archivo o carpeta con ese nombre en tus carpetas?
    if (lim.q && lim.q.length >= 3) {
      const fs_ = buscarArchivos(objetivo, this.loc.carpetasUsuario(), { max: 5, maxMs: 2500 });
      const buenos = fs_.filter((x) => x.puntaje >= 0.85);
      if (buenos.length === 1 || (buenos.length > 1 && buenos[0].puntaje - buenos[1].puntaje > 0.1)) {
        this.abrirRuta(buenos[0].ruta);
        return this.r(`Abro «${buenos[0].nombre}» de ${this.lugarTxt(buenos[0].carpeta)}.`, { gesto: 'senalar', abierto: buenos[0].ruta });
      }
      if (buenos.length > 1) return this.ofrecer(buenos.slice(0, 3), `Encontré ${buenos.length} con ese nombre`);
    }
    if (!op.desdeBot && this.bot('pc')) {
      return { respuesta: `No encontré «${corto(lim.q || objetivo, 40)}» en tu escritorio ni en el menú Inicio. Le pido al bot de PC que lo busque.`, accion: 'delegar', bot: 'pc',
        orden: `Busca en este PC y abre «${lim.q || objetivo}» (puede ser un programa, un acceso directo, un archivo o una carpeta; el usuario dijo: «${objetivo}»). Usa buscar_en_mis_carpetas y abrir; si hay varios, di cuáles encontraste.`,
        via: 'rapido', tipo: 'trabajando' };
    }
    return this.r(`No encontré «${corto(lim.q || objetivo, 40)}» para abrirlo. ¿Cómo se llama exactamente?`, { ok: false, tipo: 'pregunta', escuchar: true });
  }

  abrirURLoApp(uri) { if (/^https?:/.test(uri)) this.abrirURL(uri); else if (this.win) this.lanzar('cmd.exe', ['/d', '/s', '/c', `"start "" "${sinComillas(uri)}""`]); }
  lanzarEntrada(e, editor) {
    if (e.tipo === 'uwp' && e.appId) { this.lanzar('explorer.exe', ['shell:AppsFolder\\' + e.appId]); return; }
    if (editor === 'vscode' && e.ruta) { this.enCode(e.ruta); return; }
    this.abrirRuta(e.ruta);
  }
  enCode(ruta, linea) {
    if (!this.win) { this.abrirRuta(ruta); return; }
    const objetivo = linea ? `${sinComillas(ruta)}:${Number(linea) || 1}` : sinComillas(ruta);
    this.lanzar('cmd.exe', ['/d', '/s', '/c', `"code ${linea ? '-g ' : ''}"${objetivo}""`]);
  }
  lugarTxt(dir) {
    const d = String(dir || '').toLowerCase();
    if (/desktop|escritorio/.test(d)) return 'tu escritorio';
    if (/download|descargas/.test(d)) return 'Descargas';
    if (/documents|documentos/.test(d)) return 'Documentos';
    if (/pictures|imagenes/.test(d)) return 'Imágenes';
    return path.basename(dir || '') || 'tus carpetas';
  }
  ofrecer(lista, prefijo) {
    this.eleccion = { opciones: lista.map((x) => ({ nombre: x.nombre, ruta: x.ruta })), hasta: Date.now() + 120000 };
    const ords = ['el primero', 'el segundo', 'el tercero'];
    const txt = lista.map((x, i) => `${ords[i]}, ${x.nombre} en ${this.lugarTxt(x.carpeta)}`).join('; ');
    return this.r(`${prefijo}: ${txt}. ¿Cuál abro?`, { tipo: 'pregunta', escuchar: true, opciones: lista.map((x) => x.ruta) });
  }
  async elegir(i) {
    const x = this.eleccion && this.eleccion.opciones[i];
    this.eleccion = null;
    if (!x) return this.r('Ya no tengo esa lista. Pídemelo otra vez.');
    this.abrirRuta(x.ruta);
    return this.r(`Abro «${x.nombre}».`, { gesto: 'senalar', abierto: x.ruta });
  }

  /* ----------------------------------------------------------- Proyectos */
  abrirProyecto(p, editor) {
    if (!editor && this.conNoviq() && this.noviq) {
      this.noviq.evento('proyecto', { proyecto: idProyecto(p), abrir: true });
      return this.r(`Abro «${p.nombre}» en Noviq.`, { proyecto: idProyecto(p) });
    }
    if (editor === 'vscode') { this.enCode(p.ruta); return this.r(`Abro «${p.nombre}» en VS Code.`, { proyecto: idProyecto(p) }); }
    this.abrirRuta(p.ruta);
    return this.r(`Abro la carpeta del proyecto «${p.nombre}».`, { proyecto: idProyecto(p) });
  }
  /** Cómo se ejecuta un proyecto: jugar.bat, iniciar.bat, index.html, main.py, npm… → {tipo, archivo, cmd} */
  comoEjecutar(dir) {
    let es = [];
    try { es = fs.readdirSync(dir); } catch (_) { return null; }
    const tiene = (n) => es.find((x) => x.toLowerCase() === n);
    for (const b of ['jugar.bat', 'iniciar.bat', 'ejecutar.bat', 'run.bat', 'start.bat', 'abrir.bat', 'main.bat']) if (tiene(b)) return { tipo: 'bat', archivo: path.join(dir, tiene(b)) };
    const exe = es.filter((x) => /\.exe$/i.test(x) && !/unins|setup|install/i.test(x));
    if (exe.length === 1) return { tipo: 'exe', archivo: path.join(dir, exe[0]) };
    if (tiene('package.json')) {
      try { const pk = JSON.parse(fs.readFileSync(path.join(dir, tiene('package.json')), 'utf8')); const sc = pk.scripts || {};
        if (sc.dev || sc.start) return { tipo: 'npm', cmd: 'npm run ' + (sc.dev ? 'dev' : 'start') }; } catch (_) { /* sigue */ }
    }
    for (const py of ['main.py', 'app.py', 'juego.py', 'game.py', 'run.py']) if (tiene(py)) return { tipo: 'python', archivo: path.join(dir, tiene(py)), cmd: 'python ' + tiene(py) };
    if (tiene('index.html')) return { tipo: 'html', archivo: path.join(dir, tiene('index.html')) };
    for (const sub of ['dist', 'build', 'web', 'public']) { const h = path.join(dir, sub, 'index.html'); if (fs.existsSync(h)) return { tipo: 'html', archivo: h }; }
    return null;
  }
  ejecutarProyecto(p) {
    const c = this.comoEjecutar(p.ruta);
    if (!c) { this.abrirRuta(p.ruta); return this.r(`No vi cómo se ejecuta «${p.nombre}» (no tiene jugar.bat, index.html ni main.py). Te abro su carpeta.`, { ok: false }); }
    const dir = sinComillas(p.ruta);
    if (c.tipo === 'bat' || c.tipo === 'exe') { this.win ? this.lanzar('cmd.exe', ['/d', '/s', '/c', `"start "" /D "${dir}" "${sinComillas(c.archivo)}""`]) : this.abrirRuta(c.archivo); }
    else if (c.tipo === 'html') this.abrirRuta(c.archivo);
    else if (this.win) this.lanzar('cmd.exe', ['/d', '/s', '/c', `"start "${sinComillas(p.nombre)}" /D "${dir}" cmd /k ${c.cmd}"`]);
    else this.abrirRuta(p.ruta);
    return this.r(`Ejecuto «${p.nombre}»${c.archivo ? ' (' + path.basename(c.archivo) + ')' : ' (' + c.cmd + ')'}.`, { gesto: 'celebrar', proyecto: idProyecto(p), abierto: c.archivo || p.ruta });
  }
  async ejecutar(objetivo, pista, op) {
    if (this.loc) {
      const p = await this.loc.proyecto(objetivo);
      if (p) return this.ejecutarProyecto(p);
    }
    return this.abrir((pista === 'juego' ? 'el juego ' : '') + objetivo, op);   // un programa instalado («ejecuta el programa OBS»)
  }

  /* -------------------------------------------------------------- Cerrar */
  async cerrar(objetivo) {
    if (!this.ps) return null;
    const o = norm(objetivo).replace(/^(el|la|mi)\s+(programa|app|aplicacion|ventana( de)?)\s+/, '').trim();
    if (/^(noviq|el avatar|avatar|tu|ti)$/.test(o)) return this.r('A mí no me cierro así: usa el icono de la bandeja → Salir.');
    const nombres = PROCESOS[o] || [];
    const q = o.replace(/'/g, '');
    const script = `$q='${q}';$n=@(${nombres.map((x) => `'${x.replace(/'/g, '')}'`).join(',')});` +
      "$ps=Get-Process | Where-Object { $_.MainWindowHandle -ne 0 };" +
      "$m=@($ps | Where-Object { ($n -contains $_.ProcessName) -or ($_.ProcessName -like ('*'+($q -replace ' ','')+'*')) -or ($_.MainWindowTitle -like ('*'+$q+'*')) });" +
      "if(-not $m.Count){'NADA';exit};$res=@();foreach($p in $m){ $res+=($p.ProcessName+'|'+$p.Id+'|'+$p.MainWindowTitle) };$res -join \"`n\"";
    const r = await this.ps(script, 15000);
    const lineas = String(r.salida || '').trim().split(/\r?\n/).filter(Boolean);
    if (!lineas.length || lineas[0] === 'NADA') return this.r(`No veo «${corto(objetivo, 40)}» abierto.`, { ok: false });
    const procs = lineas.map((l) => { const [nom, id, ...t] = l.split('|'); return { nom, id: Number(id), titulo: t.join('|') }; }).filter((p) => p.id && !PROTEGIDOS.test(p.nom));
    if (!procs.length) return this.r(`«${corto(objetivo, 40)}» es del sistema, del antivirus o de Noviq: no lo cierro.`, { ok: false });
    // cierre amable (como la X de la ventana): si tiene algo sin guardar, el programa te pregunta
    const ids = procs.slice(0, 8).map((p) => p.id).join(',');
    const r2 = await this.ps(`$ids=@(${ids});foreach($i in $ids){try{(Get-Process -Id $i -ErrorAction Stop).CloseMainWindow()|Out-Null}catch{}};Start-Sleep -Milliseconds 2500;` +
      '$vivos=@($ids | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue });"VIVOS:"+$vivos.Count', 15000);
    const vivos = Number((String(r2.salida || '').match(/VIVOS:(\d+)/) || [])[1] || 0);
    const nombre = procs[0].titulo && procs.length === 1 ? procs[0].titulo : procs[0].nom;
    if (vivos) return this.r(`Le pedí a «${corto(nombre, 40)}» que se cierre, pero sigue abierto: quizá te pregunta si quieres guardar.`, { ok: true, tipo: 'atencion' });
    return this.r(`Cerré «${corto(nombre, 40)}»${procs.length > 1 ? ` (${procs.length} ventanas)` : ''}.`, { gesto: 'asentir' });
  }

  /* ------------------------------------------------------------- Energía */
  async energia(accion, segundos) {
    if (!this.ps) return null;
    const seg = segundos ? Math.max(10, Math.round(segundos)) : Math.max(10, Math.min(600, Number(this.cfg.apagadoSeg) || 60));
    const aviso = 'Noviq: apagado pedido por voz. Para anularlo di: cancela el apagado.';   // sin tildes: va a la línea de comandos
    if (accion === 'cancelar') {
      const r = await this.ps('shutdown.exe /a 2>&1; "COD:" + $LASTEXITCODE', 15000);
      let cod = Number((String(r.salida || '').match(/COD:(-?\d+)/) || [])[1]);
      if (Number.isNaN(cod) && this.proceso) { const r2 = await this.proceso('shutdown.exe', ['/a'], null, 15000); cod = Number(r2.codigo); }
      return this.r(cod === 0 ? 'Listo, cancelé el apagado.' : 'No había ningún apagado ni reinicio programado.', { gesto: 'asentir' });
    }
    if (accion === 'apagar' || accion === 'reiniciar') {
      const r = await this.ps(`shutdown.exe ${accion === 'apagar' ? '/s' : '/r'} /t ${seg} /c "${aviso}" 2>&1; "COD:" + $LASTEXITCODE`, 15000);
      let cod = Number((String(r.salida || '').match(/COD:(-?\d+)/) || [])[1]);
      if (Number.isNaN(cod) && this.proceso) {   // PowerShell no respondió: shutdown.exe sin PowerShell
        const r2 = await this.proceso('shutdown.exe', [accion === 'apagar' ? '/s' : '/r', '/t', String(seg), '/c', aviso], null, 15000);
        cod = r2.codigo == null ? NaN : Number(r2.codigo);
        if (!Number.isNaN(cod) && cod !== 0) r.salida = (r2.salida || '') + (r2.error || '');
      }
      if (cod === 1190) return this.r('Ya hay un apagado programado. Si quieres anularlo, di «cancela el apagado».');
      if (cod !== 0) return this.r('Windows no me dejó ' + (accion === 'apagar' ? 'apagar' : 'reiniciar') + ' la PC' + ((r.salida || r.error) ? ': ' + corto(r.salida || r.error, 120) : ' (PowerShell no respondió; revisa si el antivirus lo bloquea)') + '.', { ok: false, tipo: 'error' });
      const min = Math.round(seg / 60);
      const cuando = seg >= 5400 ? `${(seg / 3600).toFixed(1).replace('.0', '').replace('.', ',')} horas (a las ${new Date(Date.now() + seg * 1000).toTimeString().slice(0, 5)})`
        : seg >= 60 ? `${min} minuto${min > 1 ? 's' : ''}` : `${seg} segundos`;
      return this.r(`${accion === 'apagar' ? 'Apago' : 'Reinicio'} la PC en ${cuando}. Guarda lo que tengas abierto. Si cambias de idea, di «cancela el apagado».`, { tipo: 'atencion', energia: accion, segundos: seg });
    }
    if (accion === 'bloquear') {
      await this.ps('Start-Sleep -Milliseconds 1800; rundll32.exe user32.dll,LockWorkStation; "ok"', 15000);
      return this.r('Bloqueo la PC.');
    }
    if (accion === 'suspender') {
      this.ps('Start-Sleep -Seconds 4; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.Application]::SetSuspendState([System.Windows.Forms.PowerState]::Suspend, $false, $false) | Out-Null; "ok"', 20000).catch(() => {});
      return this.r('Pongo la PC a dormir en unos segundos.');
    }
    return null;
  }

  /* -------------------------------------------- Volumen, ventanas, captura */
  async volumen(accion, valor) {
    if (!this.ps) return null;
    const teclas = (cod, n) => `$w=New-Object -ComObject WScript.Shell;1..${n}|ForEach-Object{$w.SendKeys([char]${cod})};"ok"`;
    if (accion === 'subir') { await this.ps(teclas(175, 5), 10000); return this.r('Subí el volumen.'); }
    if (accion === 'bajar') { await this.ps(teclas(174, 5), 10000); return this.r('Bajé el volumen.'); }
    if (accion === 'mudo') { await this.ps(teclas(173, 1), 10000); return this.r('Listo, cambié el silencio.'); }
    if (accion === 'fijar') {
      const n = Math.round(Math.max(0, Math.min(100, valor)) / 2);
      await this.ps(`$w=New-Object -ComObject WScript.Shell;1..50|ForEach-Object{$w.SendKeys([char]174)};${n ? `1..${n}|ForEach-Object{$w.SendKeys([char]175)};` : ''}"ok"`, 15000);
      return this.r(`Volumen al ${valor} %.`);
    }
    return null;
  }
  async ventanas(accion) {
    if (!this.ps) return null;
    await this.ps(`(New-Object -ComObject Shell.Application).${accion === 'restaurar' ? 'UndoMinimizeALL' : 'MinimizeAll'}();"ok"`, 10000);
    return this.r(accion === 'restaurar' ? 'Restauré las ventanas.' : 'Listo, minimicé todo.');
  }
  async captura() {
    if (!this.ps) return null;
    const base = this.carpeta('pictures') || path.join(os.homedir(), 'Pictures');
    const dir = path.join(base, 'Capturas de Noviq');
    try { fs.mkdirSync(dir, { recursive: true }); } catch (_) { /* la crea PowerShell */ }
    const d = new Date(), z = (x) => String(x).padStart(2, '0');
    const f = path.join(dir, `captura_${d.getFullYear()}${z(d.getMonth() + 1)}${z(d.getDate())}_${z(d.getHours())}${z(d.getMinutes())}${z(d.getSeconds())}.png`);
    // las rutas van por variables de entorno: «Imágenes» con tilde no se rompe
    const r = await this.ps('Add-Type -AssemblyName System.Windows.Forms,System.Drawing;New-Item -ItemType Directory -Force -Path $env:NQ_DIR|Out-Null;$b=[System.Windows.Forms.SystemInformation]::VirtualScreen;' +
      '$bm=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bm);$g.CopyFromScreen($b.Left,$b.Top,0,0,$bm.Size);$bm.Save($env:NQ_ARCHIVO,[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bm.Dispose();"ok"', 20000, { env: { NQ_DIR: dir, NQ_ARCHIVO: f } });
    if (!/ok/.test(String(r.salida || ''))) return this.r('No pude tomar la captura: ' + corto(r.error || r.salida, 120), { ok: false, tipo: 'error' });
    return this.r('Listo, guardé la captura en Imágenes, carpeta «Capturas de Noviq».', { gesto: 'asentir', archivo: f });
  }

  /* ------------------------------------------------------ Buscar archivos */
  async buscarArchivo(objetivo, op) {
    if (!this.loc) return null;
    const lista = buscarArchivos(objetivo, this.loc.carpetasUsuario(), { max: 6, maxMs: 3500, soloCarpetas: /^carpetas?\b/.test(norm(objetivo)) });
    if (!lista.length) {
      if (!op.desdeBot && this.bot('pc')) return { respuesta: 'No lo vi en tus carpetas de siempre. Le pido al bot de PC que busque más a fondo.', accion: 'delegar', bot: 'pc',
        orden: `Busca en este PC «${objetivo}» (archivos o carpetas del usuario). Di dónde está cada uno que encuentres (máx. 5).`, via: 'rapido', tipo: 'trabajando' };
      return this.r(`No encontré «${corto(objetivo, 40)}» en tus carpetas.`, { ok: false });
    }
    if (lista.length === 1) {
      this.eleccion = { opciones: [{ nombre: lista[0].nombre, ruta: lista[0].ruta }], hasta: Date.now() + 120000 };
      return this.r(`Está en ${this.lugarTxt(lista[0].carpeta)}: «${lista[0].nombre}». ¿Lo abro? Di «abre el primero».`, { tipo: 'pregunta', escuchar: true, resultado: lista });
    }
    return this.ofrecer(lista.slice(0, 3), `Encontré ${lista.length}`);
  }
}

module.exports = { Rapido, RX, RXD, RX_DISPOSITIVO, PROCESOS };
