'use strict';
/* ==========================================================================
   Noviq Avatar — Catálogo de comandos, alias y normalización de parámetros
   Acepta nombres en español o inglés, con o sin tildes.
   ========================================================================== */

const quitarAcentos = (s) => String(s == null ? '' : s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
const clave = (s) => quitarAcentos(s).replace(/[\s-]+/g, '_');

// nombre canónico → { alias, destino ('avatar' | 'ventana'), desc, ejemplo }
const CATALOGO = {
  // ---- Acciones del cuerpo
  saludar: { alias: ['saludo', 'hola', 'wave', 'hello'], desc: 'Saluda con la mano.', ejemplo: { cmd: 'saludar', lado: 'derecha' } },
  reir: { alias: ['risa', 'reirse', 'carcajada', 'laugh', 'jaja'], desc: 'Se ríe (cara de risa, rebote y partículas "JA").', ejemplo: { cmd: 'reir', duracion: 3000 } },
  sonreir: { alias: ['sonrisa', 'smile'], desc: 'Sonríe unos segundos.', ejemplo: { cmd: 'sonreir' } },
  pensar: { alias: ['pensamiento', 'piensa', 'think', 'thought'], desc: 'Pose pensativa. Con "texto" muestra una burbuja de pensamiento.', ejemplo: { cmd: 'pensar', texto: 'Mmm... déjame revisar eso' } },
  textear: { alias: ['escribir', 'teclear', 'tipear', 'type', 'typing'], desc: 'Teclea en un teclado holográfico. Con "texto" lo escribe en una burbuja letra a letra.', ejemplo: { cmd: 'textear', texto: 'Listo, ya envié el reporte.' } },
  trabajar: { alias: ['trabajo', 'work', 'working'], desc: 'Manipula un panel de instrumentos holográfico.', ejemplo: { cmd: 'trabajar', duracion: 6000 } },
  analizar: { alias: ['analisis', 'escanear', 'analyze', 'scan'], desc: 'Análisis del sistema: circuitos salen de la cabeza y aparecen paneles de datos.', ejemplo: { cmd: 'analizar', duracion: 5000 } },
  herramientas: { alias: ['tools', 'mostrar_herramientas'], desc: 'Las herramientas emergen de la cabeza y orbitan alrededor.', ejemplo: { cmd: 'herramientas', lista: ['engranaje', 'codigo', 'lupa', 'base_datos'] } },
  herramienta: { alias: ['tool', 'icono_visor', 'visor'], desc: 'Muestra el icono de una herramienta dentro del visor (la cara).', ejemplo: { cmd: 'herramienta', nombre: 'engranaje', duracion: 2500 } },
  escuchar: { alias: ['oir', 'listen'], desc: 'Escucha atento con ondas de sonido.', ejemplo: { cmd: 'escuchar', duracion: 0 } },
  aclarar: { alias: ['explicar', 'clarify', 'gesticular'], desc: 'Gesto de aclaración con ambas manos.', ejemplo: { cmd: 'aclarar' } },
  senalar: { alias: ['apuntar', 'point'], desc: 'Señala: izquierda, derecha, arriba, abajo o frente.', ejemplo: { cmd: 'senalar', direccion: 'izquierda' } },
  asentir: { alias: ['si', 'nod', 'yes'], desc: 'Asiente con la cabeza.', ejemplo: { cmd: 'asentir' } },
  negar: { alias: ['no', 'shake'], desc: 'Niega con la cabeza.', ejemplo: { cmd: 'negar' } },
  celebrar: { alias: ['festejar', 'celebrate'], desc: 'Celebra con los brazos arriba y destellos.', ejemplo: { cmd: 'celebrar' } },
  sorpresa: { alias: ['sorprender', 'asombro', 'surprise'], desc: 'Salto de sorpresa con "!".', ejemplo: { cmd: 'sorpresa' } },
  confundido: { alias: ['confundir', 'duda', 'confused'], desc: 'Se rasca la cabeza con "?".', ejemplo: { cmd: 'confundido' } },
  dormir: { alias: ['dormido', 'sleep'], desc: 'Se duerme (hasta otra orden) con "Zzz".', ejemplo: { cmd: 'dormir' } },
  despertar: { alias: ['wake', 'wakeup'], desc: 'Se despierta estirándose.', ejemplo: { cmd: 'despertar' } },
  bailar: { alias: ['baile', 'dance'], desc: 'Baila con notas musicales.', ejemplo: { cmd: 'bailar', duracion: 5000 } },
  progreso: { alias: ['cargar', 'carga', 'progress', 'loading'], desc: 'Sostiene una tableta con barra de progreso (0–100). Llámalo varias veces para actualizar.', ejemplo: { cmd: 'progreso', valor: 45, etiqueta: 'Descargando' } },

  // ---- Habla y mensajes
  decir: { alias: ['hablar', 'habla', 'say', 'speak', 'talk'], desc: 'Habla: burbuja + movimiento de boca sincronizado. "voz": true usa la voz del sistema.', ejemplo: { cmd: 'decir', texto: 'Hola Gabriel, ¿en qué te ayudo?', voz: false } },
  mensaje: { alias: ['message', 'burbuja', 'bubble', 'nota'], desc: 'Muestra un mensaje escrito sin mover la boca.', ejemplo: { cmd: 'mensaje', texto: 'Tarea completada ✔', duracion: 3000 } },
  callar: { alias: ['silencio', 'ocultar_mensaje', 'cerrar_mensaje', 'hide_message'], desc: 'Oculta la burbuja y detiene la voz.', ejemplo: { cmd: 'callar' } },
  boca: { alias: ['mouth', 'labios', 'lipsync'], desc: 'Abre la boca 0–1 (para sincronizar con tu propio audio, envíalo ~30 veces/s).', ejemplo: { cmd: 'boca', abrir: 0.7 } },
  aviso: { alias: ['avisar', 'notificar', 'notify', 'alerta', 'alert'], desc: 'Mensaje corto con sonido de robot + gesto + expresión. tipo: exito, error, atencion, permiso, pregunta, info, trabajando, escuchando, saludo, adios.', ejemplo: { cmd: 'aviso', tipo: 'exito', texto: '¡Ya terminé!', voz: true } },

  // ---- Sonidos y oído
  sonido: { alias: ['pitido', 'beep', 'sound', 'play'], desc: 'Reproduce un sonido de robot: exito, error, atencion, pregunta, info, blip, clic, procesar, pensar, escribir, escuchar, risa, celebrar, sorpresa, triste, dormir, despertar, encender, apagar…', ejemplo: { cmd: 'sonido', nombre: 'exito' } },
  sonidos: { alias: ['efectos_sonido', 'sounds', 'audio_robot'], desc: 'Configura los sonidos: activo, volumen (0–1), automaticos (al hacer acciones), charla (pitidos al hablar sin voz).', ejemplo: { cmd: 'sonidos', activo: true, volumen: 0.5 } },
  microfono: { alias: ['oido', 'mic', 'escuchame', 'escucha_ahora', 'hablar_con_noviq', 'ptt', 'push_to_talk'], desc: 'Oído: sin parámetros escucha UNA frase ahora (sin decir «Noviq»). modo: apagado | palabra (reacciona a «Noviq…») | siempre | pulsar.', ejemplo: { cmd: 'microfono', modo: 'palabra' } },

  // ---- Cara y control fino
  expresion: { alias: ['emocion', 'cara', 'rostro', 'expression', 'emotion', 'face'], desc: 'Cambia la expresión base (o temporal con "duracion").', ejemplo: { cmd: 'expresion', valor: 'feliz' } },
  mirar: { alias: ['look', 'ver'], desc: 'Mira a una dirección o a x/y (−1..1). "frente" o "cursor" para soltar.', ejemplo: { cmd: 'mirar', direccion: 'derecha', duracion: 2000 } },
  mirar_cursor: { alias: ['seguir_mirada', 'track_cursor'], desc: 'Activa/desactiva que los ojos sigan al puntero.', ejemplo: { cmd: 'mirar_cursor', activo: true } },
  cabeza: { alias: ['head'], desc: 'Control directo: giro (−1..1), inclinacion (−1..1), rotacion (grados).', ejemplo: { cmd: 'cabeza', giro: 0.4, rotacion: 10, duracion: 2000 } },
  brazo: { alias: ['arm'], desc: 'Control directo: lado, hombro (0–180°), codo (−160..120°), muneca (grados), gesto.', ejemplo: { cmd: 'brazo', lado: 'derecha', hombro: 90, codo: 60, gesto: 'abierta', duracion: 2000 } },
  mano: { alias: ['hand', 'gesto'], desc: 'Gesto de mano: abierta, relajada, puno, senalar, paz, pulgar, agarrar, garra.', ejemplo: { cmd: 'mano', lado: 'ambos', gesto: 'pulgar', duracion: 2000 } },
  pose: { alias: ['postura'], desc: 'Varias partes a la vez: cabeza, brazoIzquierdo, brazoDerecho, manoIzquierda, manoDerecha, expresion.', ejemplo: { cmd: 'pose', cabeza: { rotacion: -8 }, brazoDerecho: { hombro: 120, codo: 40 }, manoDerecha: 'paz', duracion: 3000 } },
  soltar: { alias: ['liberar', 'release'], desc: 'Quita el control manual (cabeza/brazo/mano/pose).', ejemplo: { cmd: 'soltar' } },

  // ---- Modo
  icono: { alias: ['minimizar', 'compacto', 'icon', 'minimize'], desc: 'Se transforma en el icono minimalista de estado.', ejemplo: { cmd: 'icono' } },
  expandir: { alias: ['restaurar', 'maximizar', 'expand', 'restore'], desc: 'Vuelve de icono a avatar.', ejemplo: { cmd: 'expandir' } },
  detener: { alias: ['parar', 'stop', 'reposo', 'idle', 'reset'], desc: 'Detiene acciones, voz, secuencias y vuelo; vuelve al reposo.', ejemplo: { cmd: 'detener' } },

  // ---- Ventana / pantalla (lo hace el proceso principal)
  mover: { alias: ['move', 'moveto', 'mover_a'], destino: 'ventana', desc: 'Vuela a x,y de la pantalla (píxeles o "50%"). Es el centro del robot.', ejemplo: { cmd: 'mover', x: 800, y: 500, duracion: 1200 } },
  ir: { alias: ['ir_a', 'go', 'goto', 'lugar'], destino: 'ventana', desc: 'Vuela a: centro, arriba, abajo, izquierda, derecha, arriba-izquierda, abajo-derecha…, o "cursor".', ejemplo: { cmd: 'ir', a: 'abajo-derecha' } },
  desplazar: { alias: ['moveby', 'move_by'], destino: 'ventana', desc: 'Se desplaza dx, dy píxeles.', ejemplo: { cmd: 'desplazar', dx: -200, dy: 0 } },
  escala: { alias: ['tamano', 'scale', 'size'], destino: 'ventana', desc: 'Tamaño del avatar (0.3–2).', ejemplo: { cmd: 'escala', valor: 0.8 } },
  ocultar: { alias: ['esconder', 'hide'], destino: 'ventana', desc: 'Oculta el avatar.', ejemplo: { cmd: 'ocultar' } },
  mostrar: { alias: ['aparecer', 'show'], destino: 'ventana', desc: 'Muestra el avatar.', ejemplo: { cmd: 'mostrar' } },
  pasear: { alias: ['deambular', 'wander'], destino: 'ventana', desc: 'Pasea solo por la pantalla (activo: true/false).', ejemplo: { cmd: 'pasear', activo: true } },
  seguir: { alias: ['seguir_cursor', 'follow'], destino: 'ventana', desc: 'Sigue al puntero del ratón (activo: true/false).', ejemplo: { cmd: 'seguir', activo: true } },
  interactivo: { alias: ['interactive'], destino: 'ventana', desc: 'Si es false, los clics atraviesan al avatar por completo.', ejemplo: { cmd: 'interactivo', activo: false } },
  configurar: { alias: ['config', 'configure'], destino: 'ventana', desc: 'Cambia y guarda sus ajustes (los mismos de su página /ajustes): voz {activada, motor, id, velocidad, tono, volumen}, oido {modo, motor}, sonidos {activados, volumen}, identidad {nombre, personalidad}, cerebro {proveedor, modelo}, escala, mirarCursor…', ejemplo: { cmd: 'configurar', voz: { activada: true, velocidad: 1.1 }, oido: { modo: 'palabra' } } },
  abrir_ajustes: { alias: ['ajustes', 'settings', 'abrir_configuracion', 'preferencias'], destino: 'ventana', desc: 'Abre la ventana de ajustes del avatar.', ejemplo: { cmd: 'abrir_ajustes' } },
  vincular: { alias: ['conectar', 'link', 'connect', 'noviq'], destino: 'ventana', desc: 'Conecta el avatar con Noviq (lo hace Noviq solo al arrancar): url y token de su API local.', ejemplo: { cmd: 'vincular', url: 'http://127.0.0.1:7860', token: '…' } },
  portapapeles: { alias: ['clipboard', 'leer_portapapeles'], destino: 'ventana', desc: 'Devuelve el texto copiado (las claves y contraseñas no se devuelven).', ejemplo: { cmd: 'portapapeles' } },
  abrir_noviq: { alias: ['abrir_programa', 'open_noviq', 'mostrar_noviq'], destino: 'ventana', desc: 'Pide a Noviq que muestre su ventana.', ejemplo: { cmd: 'abrir_noviq' } },
  secuencia: { alias: ['sequence', 'guion', 'script'], destino: 'ventana', desc: 'Ejecuta pasos en orden. Cada paso espera al anterior salvo "paralelo": true.', ejemplo: { cmd: 'secuencia', pasos: [{ cmd: 'saludar' }, { cmd: 'decir', texto: 'Hola' }, { cmd: 'esperar', ms: 500 }, { cmd: 'reir' }] } },
  esperar: { alias: ['pausa', 'wait', 'delay'], destino: 'ventana', desc: 'Pausa dentro de una secuencia (ms).', ejemplo: { cmd: 'esperar', ms: 1000 } },
  salir: { alias: ['cerrar', 'quit', 'exit'], destino: 'ventana', desc: 'Cierra la aplicación del avatar.', ejemplo: { cmd: 'salir' } },

  // ---- Ojos (cámara conectada; solo si el usuario la activó en Ajustes → Visión)
  foto: { alias: ['capturar_camara', 'camara_foto', 'photo'], desc: 'Toma UN cuadro de la cámara conectada y lo devuelve (imagen JPEG base64). Solo si la cámara está activada en Ajustes → Visión. Parámetros: dispositivo (id), ancho (px).', ejemplo: { cmd: 'foto', ancho: 960 } },
  camaras: { alias: ['listar_camaras', 'cameras'], desc: 'Lista las cámaras conectadas [{id, nombre}].', ejemplo: { cmd: 'camaras' } },

  // ---- Mente (memoria, conversación, preguntas): lo hace su cerebro propio
  charlar: { alias: ['chat', 'conversar', 'preguntale', 'ask'], destino: 'mente', desc: 'Conversa con su mente: responde (y lo dice) con su personalidad, memoria y herramientas.', ejemplo: { cmd: 'charlar', texto: '¿Qué tengo para hoy?' } },
  preguntar: { alias: ['pregunta', 'question'], destino: 'mente', desc: 'Pregunta algo al usuario y escucha su respuesta sin que diga el nombre; llega como evento "respuesta" {id, valor: si|no|otro, texto}.', ejemplo: { cmd: 'preguntar', id: 'p1', texto: '¿Guardo los cambios?', segundos: 30 } },
  escuchar_respuesta: { alias: ['ventana_libre', 'escuchar_sin_nombre'], destino: 'mente', desc: 'Durante unos segundos acepta lo que digas sin decir su nombre.', ejemplo: { cmd: 'escuchar_respuesta', segundos: 20 } },
  recordar: { alias: ['memorizar', 'anotar', 'remember'], destino: 'mente', desc: 'Guarda un dato en su memoria permanente.', ejemplo: { cmd: 'recordar', texto: 'A Gabriel le gusta el café sin azúcar' } },
  recordatorio: { alias: ['recordatorios', 'alarma', 'reminder'], destino: 'mente', desc: 'Crea un recordatorio («cuando» en palabras).', ejemplo: { cmd: 'recordatorio', texto: 'Llamar a Ana', cuando: 'mañana a las 9' } },
  evento_app: { alias: ['evento', 'noticia', 'app_event'], destino: 'mente', desc: 'Otro programa le cuenta algo (queda en su memoria de charla). tipo: nota | fin_trabajo.', ejemplo: { cmd: 'evento_app', app: 'mi-app', tipo: 'nota', texto: 'Se publicó la versión 2.0' } }
};

const ALIAS = {};
for (const [nombre, def] of Object.entries(CATALOGO)) {
  ALIAS[nombre] = nombre;
  for (const a of def.alias) ALIAS[clave(a)] = nombre;
}
ALIAS['alternar_icono'] = 'alternar_icono';

const PARAM_ALIAS = {
  texto: ['texto', 'text', 'msg', 'contenido', 'content'],
  duracion: ['duracion', 'duration', 'tiempo', 'time'],
  voz: ['voz', 'voice'],
  direccion: ['direccion', 'direction', 'dir', 'hacia'],
  valor: ['valor', 'value', 'v', 'nivel', 'porcentaje', 'percent'],
  lado: ['lado', 'side'],
  gesto: ['gesto', 'gesture', 'forma'],
  lista: ['lista', 'list', 'items', 'herramientas', 'tools'],
  nombre: ['nombre', 'name', 'icono', 'icon'],
  expresion: ['expresion', 'expression', 'emocion', 'emotion', 'cara'],
  velocidad: ['velocidad', 'speed', 'rate'],
  etiqueta: ['etiqueta', 'label', 'titulo', 'title'],
  pasos: ['pasos', 'steps', 'comandos', 'commands'],
  repetir: ['repetir', 'repeat', 'veces', 'times'],
  activo: ['activo', 'active', 'on', 'activar', 'enabled', 'enable'],
  hombro: ['hombro', 'shoulder'], codo: ['codo', 'elbow'], muneca: ['muneca', 'wrist'], escorzo: ['escorzo'],
  giro: ['giro', 'yaw', 'turn'], inclinacion: ['inclinacion', 'pitch', 'cabeceo'], rotacion: ['rotacion', 'roll', 'ladeo'],
  abrir: ['abrir', 'open', 'apertura', 'amplitud', 'nivel_boca'],
  pantalla: ['pantalla', 'screen', 'monitor', 'display'],
  fijo: ['fijo', 'persistente', 'sticky', 'pin'],
  esperar: ['esperar', 'wait', 'await', 'bloquear'],
  paralelo: ['paralelo', 'parallel', 'async', 'sin_esperar'],
  tipo: ['tipo', 'type', 'estilo'],
  accion: ['accion', 'animacion'],
  gestos: ['gestos', 'gestures'],
  a: ['a', 'hacia_lugar', 'lugar', 'destino', 'to', 'posicion', 'position', 'place'],
  ms: ['ms', 'milisegundos'],
  segundos: ['segundos', 'seconds', 'secs'],
  cuando: ['cuando', 'when', 'hora_fecha'],
  mantener: ['mantener', 'hold'],
  x: ['x'], y: ['y'], dx: ['dx'], dy: ['dy']
};
const PALIAS = {};
for (const [canon, lista] of Object.entries(PARAM_ALIAS)) for (const a of lista) PALIAS[clave(a)] = canon;

function normalizarParams(obj) {
  const out = {};
  for (const [k, v] of Object.entries(obj || {})) {
    const kk = clave(k);
    if (['cmd', 'comando', 'command', 'action'].includes(kk)) continue;
    const canon = PALIAS[kk] || k;
    out[canon] = v;
  }
  if (out.lado) out.lado = quitarAcentos(out.lado);
  if (out.direccion) out.direccion = quitarAcentos(out.direccion);
  if (out.duracion != null) out.duracion = Number(out.duracion);
  if (typeof out.lista === 'string') out.lista = out.lista.split(',').map((s) => s.trim()).filter(Boolean);
  return out;
}

/**
 * Convierte cualquier forma aceptada en { nombre, params }.
 * Formas: "reir" | "decir Hola mundo" | { cmd|comando|accion|action: "reir", ...params }
 */
function normalizar(entrada) {
  let obj = entrada;
  if (typeof obj === 'string') {
    const s = obj.trim();
    const i = s.search(/\s/);
    obj = i < 0 ? { cmd: s } : { cmd: s.slice(0, i), texto: s.slice(i + 1).trim() };
  }
  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) return { error: 'El comando debe ser un objeto JSON, un texto o una lista.' };
  const bruto = obj.cmd != null ? obj.cmd : obj.comando != null ? obj.comando : obj.command != null ? obj.command : obj.action;
  if (bruto == null) return { error: 'Falta el nombre del comando ("cmd").' };
  const k = clave(bruto);
  const nombre = ALIAS[k];
  const params = normalizarParams(obj);
  if (!nombre && EXPRESIONES.includes(k)) return { nombre: 'expresion', params: Object.assign(params, { valor: k }), destino: 'avatar' };
  if (!nombre) return { error: `Comando desconocido: "${bruto}".`, sugerencias: sugerir(k) };
  if (params.a == null && nombre === 'ir') params.a = params.direccion || params.valor || params.nombre;
  if (nombre === 'esperar' && params.ms == null) params.ms = params.duracion != null ? params.duracion : params.valor;
  return { nombre, params, destino: (CATALOGO[nombre] && CATALOGO[nombre].destino) || 'avatar' };
}

function distancia(a, b) {
  const m = Array.from({ length: a.length + 1 }, (_, i) => [i]);
  for (let j = 1; j <= b.length; j++) m[0][j] = j;
  for (let i = 1; i <= a.length; i++) for (let j = 1; j <= b.length; j++)
    m[i][j] = Math.min(m[i - 1][j] + 1, m[i][j - 1] + 1, m[i - 1][j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
  return m[a.length][b.length];
}
function sugerir(k) {
  return Object.keys(ALIAS).map((a) => [a, distancia(a, k)]).sort((x, y) => x[1] - y[1]).slice(0, 3)
    .filter((x) => x[1] <= 3).map((x) => ALIAS[x[0]]).filter((v, i, arr) => arr.indexOf(v) === i);
}

function listaComandos() {
  return Object.entries(CATALOGO).map(([nombre, d]) => ({ nombre, alias: d.alias, destino: d.destino || 'avatar', descripcion: d.desc, ejemplo: d.ejemplo }));
}

const EXPRESIONES = ['neutral', 'feliz', 'sonrisa', 'risa', 'sorpresa', 'enfocado', 'pensando', 'procesando', 'dormido', 'triste', 'enojado', 'guino', 'confundido', 'atento', 'hablando'];
const GESTOS = ['abierta', 'relajada', 'puno', 'senalar', 'paz', 'pulgar', 'agarrar', 'teclear', 'garra'];
const ICONOS = ['engranaje', 'llave', 'codigo', 'terminal', 'lupa', 'grafico', 'base_datos', 'chip', 'nube', 'documento', 'rayo', 'carpeta', 'web', 'escudo', 'mensaje', 'red', 'camara', 'microfono', 'musica', 'reloj', 'candado', 'ok'];
const LUGARES = ['centro', 'arriba', 'abajo', 'izquierda', 'derecha', 'arriba-izquierda', 'arriba-derecha', 'abajo-izquierda', 'abajo-derecha', 'cursor'];

module.exports = { normalizar, normalizarParams, listaComandos, quitarAcentos, clave, CATALOGO, EXPRESIONES, GESTOS, ICONOS, LUGARES };
