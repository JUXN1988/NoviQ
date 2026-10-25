'use strict';
/* ==========================================================================
   Noviq Avatar — Proceso principal (Electron)
   Un asistente INDEPENDIENTE: su propia mente, memoria, ajustes, voz, oído,
   herramientas y API. Vive en una ventana transparente, sin marco, siempre
   encima, que deja pasar los clics salvo sobre el robot. Si Noviq está
   abierto se conecta solo y usa también todas sus herramientas; y cualquier
   otro programa lo puede usar por su API local (HTTP, WebSocket, OpenAI o MCP).
   ========================================================================== */
const { app, BrowserWindow, screen, ipcMain, Tray, Menu, nativeImage, shell, session, globalShortcut, clipboard, safeStorage, dialog, desktopCapturer } = require('electron');
const path = require('path');
const fs = require('fs');
const { crearAPI } = require('./src/api');
const { Controlador } = require('./src/controlador');
const { quitarAcentos } = require('./src/comandos');
const { PuenteNoviq } = require('./src/puente-noviq');
const { crearNucleo } = require('./src/nucleo');
const { leerJSON } = require('./src/almacen');
const P = require('./src/personalidad');

const VERSION = '2.6.0';

// Carpeta de datos propia (memoria, ajustes, claves): %APPDATA%\Noviq Avatar, o la que digas con NOVIQ_AVATAR_PERFIL o
// --perfil=<carpeta> (modo portátil: llévalo a otra PC con su memoria; también sirve para pruebas sin tocar la real)
const perfil = process.env.NOVIQ_AVATAR_PERFIL || (process.argv.find((a) => a.startsWith('--perfil=')) || '').slice(9);
if (perfil) { try { fs.mkdirSync(perfil, { recursive: true }); app.setPath('userData', path.resolve(perfil)); } catch (_) { /* noop */ } }

/* ----------------------- Traza de arranque: si algo lo tumba, aquí queda en qué paso fue */
const RUTA_TRAZA = path.join(process.env.NOVIQ_DATOS || app.getPath('userData'), 'avatar_arranque.log');
const T0 = Date.now();
function marca(etapa) {
  try { fs.appendFileSync(RUTA_TRAZA, `${new Date().toISOString()} +${Date.now() - T0}ms ${etapa}\n`); } catch (_) { /* noop */ }
}
try { fs.writeFileSync(RUTA_TRAZA, ''); } catch (_) { /* noop */ }
marca(`inicio v${VERSION} electron ${process.versions.electron} pid ${process.pid}`);
process.on('uncaughtException', (e) => { marca('EXCEPCIÓN ' + (e && e.stack || e)); console.error(e); });
process.on('unhandledRejection', (e) => { marca('PROMESA ' + (e && e.stack || e)); });
// Carpeta de Noviq: normalmente la de arriba (Noviq\noviq-avatar). Si alguien copió el avatar en la raíz de Noviq, la misma.
const RUTA_NOVIQ = fs.existsSync(path.join(__dirname, 'app.py')) && fs.existsSync(path.join(__dirname, 'noviq')) ? __dirname : path.join(__dirname, '..');
if (RUTA_NOVIQ === __dirname) marca('AVISO: el avatar está en la raíz de Noviq (debería estar en Noviq\\noviq-avatar)');
const BASE_W = 440, BASE_H = 600, ANCLA_Y = 380;   // centro del robot dentro de la escena

/* ------------------------------------------- Configuración técnica (config.json)
   Lo del CUERPO y la API (puerto, posición, nivel encima…). Todo lo demás
   —voz, oído, cerebro, personalidad, memoria…— está en SUS ajustes (/ajustes). */
const DEFECTO = {
  puerto: 7777, host: '127.0.0.1', token: '', origenesPermitidos: [],
  escala: 0.8, posicionInicial: 'abajo-derecha', recordarPosicion: true, interactivo: true, dobleClicIcono: true,
  desactivarGPU: false, mostrarEnBarraTareas: false, nivelEncima: 'screen-saver'
};
function cargarConfig() {
  const rutas = [path.join(__dirname, 'config.json'), path.join(path.dirname(process.execPath), 'config.json'),
    process.env.PORTABLE_EXECUTABLE_DIR ? path.join(process.env.PORTABLE_EXECUTABLE_DIR, 'config.json') : null,
    path.join(app.getPath('userData'), 'config.json')].filter(Boolean);
  let cfg = JSON.parse(JSON.stringify(DEFECTO));
  for (const r of rutas) { const c = leerJSON(r); if (c) { cfg = Object.assign(cfg, c); cfg._ruta = r; } }
  if (process.env.NOVIQ_PUERTO) cfg.puerto = Number(process.env.NOVIQ_PUERTO);
  if (process.env.NOVIQ_TOKEN) cfg.token = process.env.NOVIQ_TOKEN;
  return cfg;
}
const config = cargarConfig();
if (config.desactivarGPU) app.disableHardwareAcceleration();
app.commandLine.appendSwitch('disable-renderer-backgrounding');
app.commandLine.appendSwitch('enable-transparent-visuals');
app.commandLine.appendSwitch('autoplay-policy', 'no-user-gesture-required');   // sonidos de robot sin clic previo

if (!app.requestSingleInstanceLock()) { app.quit(); process.exit(0); }

/* -------------------------------------------------------------------- Estado */
let win = null, tray = null, api = null, controlador = null, nucleo = null, ventanaAjustes = null;
let escala = Math.max(0.3, Math.min(2, Number(config.escala) || 0.8));
let W = Math.round(BASE_W * escala), H = Math.round(BASE_H * escala);
const estado = { visible: true, pasear: false, seguir: false, interactivo: config.interactivo !== false, mirarCursor: true, renderer: {} };
const pendientes = new Map();
let seqIPC = 0;
let listo = false; const colaListo = [];
const rutaEstado = () => path.join(app.getPath('userData'), 'estado.json');
const aj = () => nucleo.ajustes.datos;
const log = (t) => console.log('[noviq-avatar] ' + t);

/* ------------------------------------------------------ Portapapeles (solo RAM) */
// En Electron 44 clipboard.readText() puede devolver una promesa: se normaliza siempre a texto
async function leerClip() {
  try { const t = await Promise.resolve(clipboard.readText()); return typeof t === 'string' ? t : ''; } catch (_) { return ''; }
}
let ultimoClip = null;
async function vigilarPortapapeles() {
  ultimoClip = await leerClip();   // lo que ya había no cuenta
  if (process.env.NOVIQ_AVATAR_SIN_PORTAPAPELES) return;
  setInterval(async () => {
    if (aj().portapapeles.modo !== 'observar') return;
    const t = await leerClip();
    if (t === ultimoClip) return;
    ultimoClip = t;
    if (t.trim()) nucleo.mente.nuevoClip(t);   // las claves y contraseñas se descartan ahí mismo
  }, 1500);
}

/* --------------------------------------------------- Conector con Noviq */
const EVENTOS_A_NOVIQ = new Set(['clic', 'doble_clic', 'oido', 'visibilidad', 'modo', 'salir']);
const puente = new PuenteNoviq({
  log,
  alCambiar: (conectado, e) => {
    enviar('config', { noviq: e });
    emitir('noviq', e);
    actualizarBandeja();
    if (conectado && nucleo) {
      informarANoviq();
      if (!aj().migrado.noviq || !aj().migrado.memoria) nucleo.heredar().then((r) => { if (r) aplicarAjustes(['identidad.nombre', 'voz.activada', 'oido.modo', 'sonidos.activados']); });
    }
  }
});
/** Noviq necesita saber cómo quieres que te avise de sus trabajos (y cómo se llama el avatar). */
function informarANoviq() {
  if (!nucleo || !puente.conectado) return;
  const d = aj();
  puente.evento('ajustes', { noviq: d.noviq, nombre: d.identidad.nombre, voz: d.voz.activada, api: `http://127.0.0.1:${config.puerto}`, version: VERSION });
}
/** Abre Noviq: si ya está abierto, muestra su ventana; si no, lo lanza (si el avatar vive en su carpeta). */
async function abrirNoviq() {
  if (puente.conectado) { puente.evento('abrir', { motivo: 'avatar' }); return true; }
  const candidatos = [RUTA_NOVIQ !== __dirname && path.join(RUTA_NOVIQ, 'iniciar.bat'), path.join(RUTA_NOVIQ, 'Noviq.exe'),
    process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Programs', 'Noviq', 'Noviq.exe')].filter(Boolean);
  for (const c of candidatos) if (fs.existsSync(c)) { const e = await shell.openPath(c); if (!e) return true; }
  return false;
}

/* ---------------------------------------------------------- Geometría pantalla */
function posVentana() { const [x, y] = win.getPosition(); return { x, y }; }
function anclaActual() { const p = posVentana(); return { x: p.x + W / 2, y: p.y + ANCLA_Y * escala }; }
function ventanaDesdeAncla(ax, ay) { return { x: Math.round(ax - W / 2), y: Math.round(ay - ANCLA_Y * escala) }; }
function limites(area) {
  return {
    minX: area.x + 120 * escala, maxX: area.x + area.width - 120 * escala,
    minY: area.y + ANCLA_Y * escala - 90 * escala, maxY: area.y + area.height - 150 * escala
  };
}
function areaDe(ax, ay) { return screen.getDisplayNearestPoint({ x: Math.round(ax), y: Math.round(ay) }).workArea; }
function limitar(ax, ay) {
  const L = limites(areaDe(ax, ay));
  return { x: Math.min(L.maxX, Math.max(L.minX, ax)), y: Math.min(L.maxY, Math.max(L.minY, ay)) };
}
function pantallaN(n) {
  const ds = screen.getAllDisplays();
  if (n == null || n === '') return null;
  const i = Number(n);
  if (!isNaN(i) && ds[i]) return ds[i];
  if (quitarAcentos(n) === 'principal' || n === 'primary') return screen.getPrimaryDisplay();
  return null;
}
function lugar(nombre, pantalla) {
  const k = quitarAcentos(nombre || '').replace(/[_\s]+/g, '-');
  const a = anclaActual();
  if (k === 'cursor' || k === 'puntero' || k === 'raton') {
    const c = screen.getCursorScreenPoint();
    return { x: c.x + 150 * escala, y: c.y - 40 * escala };
  }
  const d = pantallaN(pantalla) || screen.getDisplayNearestPoint({ x: Math.round(a.x), y: Math.round(a.y) });
  const L = limites(d.workArea);
  const cx = (L.minX + L.maxX) / 2, cy = (L.minY + L.maxY) / 2;
  const mapa = {
    'centro': [cx, cy], 'center': [cx, cy], 'medio': [cx, cy],
    'arriba': [cx, L.minY], 'top': [cx, L.minY], 'abajo': [cx, L.maxY], 'bottom': [cx, L.maxY],
    'izquierda': [L.minX, cy], 'left': [L.minX, cy], 'derecha': [L.maxX, cy], 'right': [L.maxX, cy],
    'arriba-izquierda': [L.minX, L.minY], 'top-left': [L.minX, L.minY], 'arriba-derecha': [L.maxX, L.minY], 'top-right': [L.maxX, L.minY],
    'abajo-izquierda': [L.minX, L.maxY], 'bottom-left': [L.minX, L.maxY], 'abajo-derecha': [L.maxX, L.maxY], 'bottom-right': [L.maxX, L.maxY]
  };
  const v = mapa[k];
  return v ? { x: v[0], y: v[1] } : null;
}
function coord(v, base, tam) {
  if (typeof v === 'string' && v.trim().endsWith('%')) return base + (parseFloat(v) / 100) * tam;
  return Number(v);
}

/* ------------------------------------------------------------------- Vuelo */
let anim = null;
function fijarPos(x, y) {
  if (!win || win.isDestroyed()) return;
  win.setBounds({ x: Math.round(x), y: Math.round(y), width: W, height: H });
}
function cancelarVuelo(motivo) {
  if (!anim) return;
  clearInterval(anim.timer);
  const a = anim; anim = null;
  enviar('vuelo', { vx: 0, vy: 0 });
  a.resolver({ interrumpido: true, motivo });
}
function volarA(ax, ay, opciones) {
  opciones = opciones || {};
  cancelarVuelo('nuevo destino');
  const destino = limitar(ax, ay);
  const ini = anclaActual();
  const dist = Math.hypot(destino.x - ini.x, destino.y - ini.y);
  const velocidad = Number(opciones.velocidad) || 1;
  const dur = opciones.duracion != null && !isNaN(Number(opciones.duracion)) ? Math.max(0, Number(opciones.duracion))
    : Math.min(3000, Math.max(350, dist / (0.85 * velocidad)));
  return new Promise((resolver) => {
    if (dist < 1 || dur === 0) {
      const v = ventanaDesdeAncla(destino.x, destino.y); fijarPos(v.x, v.y); guardarPos();
      return resolver({ x: Math.round(destino.x), y: Math.round(destino.y) });
    }
    const t0 = Date.now();
    let prev = { x: ini.x, y: ini.y, t: t0 };
    const a = { resolver };
    a.timer = setInterval(() => {
      const k = Math.min(1, (Date.now() - t0) / dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const x = ini.x + (destino.x - ini.x) * e, y = ini.y + (destino.y - ini.y) * e;
      const v = ventanaDesdeAncla(x, y);
      fijarPos(v.x, v.y);
      const now = Date.now(), dt = Math.max(1, now - prev.t) / 1000;
      enviar('vuelo', k < 1 ? { vx: (x - prev.x) / dt, vy: (y - prev.y) / dt } : { vx: 0, vy: 0 });
      prev = { x, y, t: now };
      if (k >= 1) {
        clearInterval(a.timer); anim = null; guardarPos();
        emitir('movimiento_fin', { x: Math.round(x), y: Math.round(y) });
        resolver({ x: Math.round(x), y: Math.round(y) });
      }
    }, 16);
    anim = a;
  });
}

/* ------------------------------------------------------ Pasear / seguir */
let timerPasear = null, timerSeguir = null;
function setPasear(on) {
  estado.pasear = !!on;
  clearTimeout(timerPasear);
  if (!on) return;
  const ciclo = () => {
    if (!estado.pasear) return;
    const a = anclaActual();
    const L = limites(areaDe(a.x, a.y));
    const x = L.minX + Math.random() * (L.maxX - L.minX), y = L.minY + Math.random() * (L.maxY - L.minY);
    volarA(x, y, { velocidad: 0.45 }).then(() => { timerPasear = setTimeout(ciclo, 4000 + Math.random() * 7000); });
  };
  timerPasear = setTimeout(ciclo, 600);
}
function setSeguir(on) {
  estado.seguir = !!on;
  clearInterval(timerSeguir);
  if (!on) return;
  timerSeguir = setInterval(() => {
    if (arrastre || !win) return;
    const c = screen.getCursorScreenPoint(), a = anclaActual();
    const objetivo = { x: c.x + 170 * escala, y: c.y - 30 * escala };
    if (Math.hypot(objetivo.x - a.x, objetivo.y - a.y) > 220 * escala && !anim) volarA(objetivo.x, objetivo.y, { velocidad: 1.2 });
  }, 300);
}

/* ---------------------------------------------------------------- Escala */
function setEscala(s) {
  const a = anclaActual();
  escala = Math.max(0.3, Math.min(2, Number(s) || 1));
  W = Math.round(BASE_W * escala); H = Math.round(BASE_H * escala);
  const v = ventanaDesdeAncla(a.x, a.y);
  fijarPos(v.x, v.y);
  enviar('escala', escala);
  guardarPos();
  return { escala };
}

/* ------------------------------------------------------------- Persistencia */
let timerGuardar = null;
function guardarPos() {
  if (!config.recordarPosicion || !win) return;
  clearTimeout(timerGuardar);
  timerGuardar = setTimeout(() => {
    try { const a = anclaActual(); fs.writeFileSync(rutaEstado(), JSON.stringify({ x: Math.round(a.x), y: Math.round(a.y), escala, escalaConfig: config.escala })); } catch (_) { /* noop */ }
  }, 400);
}

/* ---------------------------------------------------------- Comunicación */
function enviar(canal, datos) { if (win && !win.isDestroyed()) win.webContents.send(canal, datos); }
function emitir(nombre, datos) { if (api) api.emitir(nombre, datos); }

function alAvatar(nombre, params) {
  return new Promise((resolve, reject) => {
    const mandar = () => {
      const id = ++seqIPC;
      const timer = setTimeout(() => { pendientes.delete(id); resolve({ tiempoAgotado: true }); }, 10 * 60 * 1000);
      pendientes.set(id, { resolve, reject, timer });
      enviar('comando', { id, nombre, params });
    };
    if (listo) mandar(); else colaListo.push(mandar);
  });
}


/* ---------------------------------------- Ajustes: aplicarlos al cuerpo y a Noviq */
function configRenderer() {
  const d = aj();
  const pr = P.prosodia(d.identidad.personalidad, d.voz.velocidad, d.voz.tono);
  return {
    voz: { activada: !!d.voz.activada, motor: d.voz.motor === 'windows' ? 'windows' : 'avatar', nombre: d.voz.nombreWindows, velocidad: pr.velocidad,
      tono: pr.tono, volumen: d.voz.volumen, idioma: d.identidad.idioma === 'en' ? 'en' : 'es' },
    sonidos: d.sonidos, oido: { modo: d.oido.modo, sensibilidad: d.oido.sensibilidad, maxSeg: d.oido.maxSeg }, mirarCursor: d.apariencia.mirarCursor,
    nombre: d.identidad.nombre
  };
}
function aplicarAjustes(cambios) {
  if (!nucleo) return;
  const d = aj();
  const c = cambios || [];
  const toca = (pref) => c.some((x) => x === pref || x.startsWith(pref + '.'));
  if (toca('voz') || toca('sonidos') || toca('oido') || toca('apariencia.mirarCursor') || toca('identidad')) {
    estado.mirarCursor = d.apariencia.mirarCursor;
    enviar('config', configRenderer());
  }
  if (toca('identidad.personalidad') && listo) controlador.ejecutar({ cmd: 'expresion', valor: P.caraBase(d.identidad.personalidad) });
  if (toca('apariencia.atajoHablar')) registrarAtajo();
  if (toca('apariencia.iniciarConWindows')) iniciarConWindows(d.apariencia.iniciarConWindows);
  if (toca('noviq.usar')) puente.activar(d.noviq.usar);
  if (toca('noviq') || toca('identidad.nombre') || toca('voz.activada')) informarANoviq();
  if (c.length) emitir('ajustes', { cambios: c });
  actualizarBandeja();
}
function iniciarConWindows(si) {
  try {
    const op = { openAtLogin: !!si, path: process.execPath };
    if (!app.isPackaged) op.args = [app.getAppPath()];
    app.setLoginItemSettings(op);
  } catch (e) { log('inicio con Windows: ' + e.message); }
}
/** Comando «configurar» (de Noviq, de la API o del menú). Acepta el formato nuevo y el antiguo. */
function configurar(Pm) {
  Pm = Pm || {};
  const parcial = {};
  for (const k of ['identidad', 'voz', 'oido', 'cerebro', 'sonidos', 'portapapeles', 'apariencia', 'herramientas', 'noviq', 'api']) if (Pm[k] && typeof Pm[k] === 'object') parcial[k] = Object.assign({}, Pm[k]);
  // Noviq ≤ 4.3 mandaba su propia voz/ritmo al arrancar: ahora la voz es del avatar, así que de eso solo se toma «activada»
  if (parcial.voz && parcial.voz.idioma != null && parcial.voz.motor != null) parcial.voz = { activada: parcial.voz.activada };
  if (parcial.voz && parcial.voz.nombre != null) { parcial.voz.nombreWindows = parcial.voz.nombre; delete parcial.voz.nombre; }
  if (Pm.mirarCursor != null) parcial.apariencia = Object.assign(parcial.apariencia || {}, { mirarCursor: !!Pm.mirarCursor });
  if (Pm.atajoHablar != null) parcial.apariencia = Object.assign(parcial.apariencia || {}, { atajoHablar: String(Pm.atajoHablar) });
  if (typeof Pm.portapapeles === 'string') parcial.portapapeles = { modo: Pm.portapapeles };
  if (Pm.nombre) parcial.identidad = Object.assign(parcial.identidad || {}, { nombre: Pm.nombre });
  if (Pm.personalidad) parcial.identidad = Object.assign(parcial.identidad || {}, { personalidad: Pm.personalidad });
  if (Pm.escala != null) setEscala(Pm.escala);
  const cambios = nucleo.ajustes.actualizar(parcial);
  return { cambios, ajustes: nucleo.ajustes.publico() };
}

/* ----------------------------------------------------- Ventana de ajustes */
function abrirAjustes(seccion) {
  const url = `http://127.0.0.1:${config.puerto}/ajustes${seccion ? '#' + seccion : ''}`;
  if (ventanaAjustes && !ventanaAjustes.isDestroyed()) { ventanaAjustes.show(); ventanaAjustes.focus(); if (seccion) ventanaAjustes.loadURL(url); return; }
  ventanaAjustes = new BrowserWindow({
    width: 980, height: 760, minWidth: 720, minHeight: 520, title: `Ajustes de ${aj().identidad.nombre}`, autoHideMenuBar: true,
    icon: path.join(__dirname, 'assets', 'icono.png'), backgroundColor: '#0f1420',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false }
  });
  ventanaAjustes.setMenu(null);
  ventanaAjustes.loadURL(url);
  ventanaAjustes.webContents.setWindowOpenHandler(({ url: u }) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); return { action: 'deny' }; });
  ventanaAjustes.webContents.on('will-navigate', (e, u) => { if (!u.startsWith(`http://127.0.0.1:${config.puerto}/`)) { e.preventDefault(); if (/^https?:\/\//.test(u)) shell.openExternal(u); } });
  ventanaAjustes.on('closed', () => { ventanaAjustes = null; });
}

const ventana = {
  detener() { cancelarVuelo('detener'); },
  async ejecutar(nombre, Pm) {
    switch (nombre) {
      case 'mover': {
        const a = anclaActual();
        const area = areaDe(a.x, a.y);
        if (Pm.x == null && Pm.y == null) throw new Error('Indica "x" y/o "y".');
        const x = Pm.x != null ? coord(Pm.x, area.x, area.width) : a.x;
        const y = Pm.y != null ? coord(Pm.y, area.y, area.height) : a.y;
        if (isNaN(x) || isNaN(y)) throw new Error('Coordenadas inválidas.');
        return volarA(x, y, Pm);
      }
      case 'ir': {
        const destino = lugar(Pm.a, Pm.pantalla);
        if (!destino) throw new Error(`Lugar no válido: "${Pm.a}". Usa centro, arriba, abajo, izquierda, derecha, arriba-izquierda, arriba-derecha, abajo-izquierda, abajo-derecha o cursor.`);
        return volarA(destino.x, destino.y, Pm);
      }
      case 'desplazar': {
        const a = anclaActual();
        return volarA(a.x + (Number(Pm.dx) || 0), a.y + (Number(Pm.dy) || 0), Pm);
      }
      case 'escala': return setEscala(Pm.valor != null ? Pm.valor : Pm.escala);
      case 'ocultar': if (win) win.hide(); estado.visible = false; emitir('visibilidad', { visible: false }); return { visible: false };
      case 'mostrar': if (win) win.showInactive(); estado.visible = true; emitir('visibilidad', { visible: true }); return { visible: true };
      case 'pasear': setPasear(Pm.activo !== false && Pm.valor !== false); return { pasear: estado.pasear };
      case 'seguir': setSeguir(Pm.activo !== false && Pm.valor !== false); return { seguir: estado.seguir };
      case 'interactivo':
        estado.interactivo = Pm.activo !== false && Pm.valor !== false;
        if (!estado.interactivo && win) win.setIgnoreMouseEvents(true, { forward: true });
        return { interactivo: estado.interactivo };
      case 'configurar': return configurar(Pm);
      case 'abrir_ajustes': abrirAjustes(Pm.seccion || Pm.valor); return { abierto: true };
      case 'vincular': { const r = puente.vincular(Pm); enviar('config', { noviq: r }); return r; }
      case 'abrir_noviq': return { abierto: await abrirNoviq() };
      case 'portapapeles': {
        if (aj().portapapeles.modo === 'apagado') throw new Error('El acceso al portapapeles está apagado en mis ajustes.');
        const t = await leerClip();
        const { esSecreto } = require('./src/util');
        return esSecreto(t) ? { sensible: true, largo: t.length } : { texto: t.slice(0, 6000), largo: t.length };
      }
      case 'salir': setTimeout(() => app.quit(), Pm.ms != null ? Number(Pm.ms) : 150); return { saliendo: true };
      default: throw new Error('Comando de ventana desconocido: ' + nombre);
    }
  }
};

function estadoPublico() {
  const a = win ? anclaActual() : { x: 0, y: 0 };
  const d = nucleo ? aj() : null;
  return Object.assign({
    version: VERSION, visible: estado.visible, posicion: { x: Math.round(a.x), y: Math.round(a.y) }, escala,
    pasear: estado.pasear, seguir: estado.seguir, interactivo: estado.interactivo, volando: !!anim,
    noviq: puente.estado(), atajoHablar: atajoActual, voz: { activada: !!(d && d.voz.activada) },
    nombre: d ? d.identidad.nombre : 'Noviq', mente: nucleo ? nucleo.mente.estado() : null, ajustes: `http://127.0.0.1:${config.puerto}/ajustes`
  }, estado.renderer);
}

/* ------------------------------------------ Atajo global: hablarle al avatar */
let atajoActual = null, atajoError = '';
function registrarAtajo() {
  try { if (atajoActual) globalShortcut.unregister(atajoActual); } catch (_) { /* noop */ }
  atajoActual = null; atajoError = '';
  const a = String(aj().apariencia.atajoHablar || '').trim();
  if (!a) return;
  const alPulsar = () => { if (!estado.visible) ventana.ejecutar('mostrar', {}); controlador.ejecutar({ cmd: 'microfono' }); };
  // si el atajo elegido ya lo usa otro programa, prueba otros parecidos
  for (const intento of [a, 'Control+Alt+N', 'Control+Shift+Space', 'Alt+Shift+N']) {
    try { if (globalShortcut.register(intento, alPulsar)) { atajoActual = intento; break; } } catch (e) { atajoError = 'atajo inválido: ' + a; }
  }
  if (atajoActual && atajoActual !== a) { atajoError = `«${a}» lo usa otro programa: uso ${atajoActual}`; log(atajoError); }
  if (!atajoActual) { atajoError = atajoError || `«${a}» lo usa otro programa`; log(atajoError); }
}

/* --------------------------------------------------------------- Ventana */
function crearVentana() {
  const guardado = config.recordarPosicion ? leerJSON(rutaEstado()) : null;
  if (guardado && guardado.escala && guardado.escalaConfig === config.escala) escala = Math.max(0.3, Math.min(2, guardado.escala));
  W = Math.round(BASE_W * escala); H = Math.round(BASE_H * escala);
  const primaria = screen.getPrimaryDisplay().workArea;
  let ancla = guardado && guardado.x != null ? limitar(guardado.x, guardado.y) : null;
  if (!ancla) {
    const L = limites(primaria);
    const k = quitarAcentos(config.posicionInicial || 'abajo-derecha');
    ancla = { x: k.includes('izquierda') ? L.minX : k.includes('derecha') ? L.maxX : (L.minX + L.maxX) / 2,
      y: k.includes('arriba') ? L.minY : k.includes('abajo') ? L.maxY : (L.minY + L.maxY) / 2 };
  }
  const v = ventanaDesdeAncla(ancla.x, ancla.y);

  win = new BrowserWindow({
    x: v.x, y: v.y, width: W, height: H,
    transparent: true, frame: false, resizable: false, movable: true, hasShadow: false,
    alwaysOnTop: true, skipTaskbar: !config.mostrarEnBarraTareas, focusable: false, fullscreenable: false,
    maximizable: false, minimizable: false, backgroundColor: '#00000000', show: false, title: 'Noviq Avatar',
    icon: path.join(__dirname, 'assets', 'icono.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, backgroundThrottling: false, spellcheck: false }
  });
  win.setAlwaysOnTop(true, config.nivelEncima || 'screen-saver');
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.setIgnoreMouseEvents(true, { forward: true });
  win.setMenu(null);
  win.loadFile(path.join(__dirname, 'renderer', 'index.html'));
  win.once('ready-to-show', () => { win.showInactive(); });
  win.on('closed', () => { win = null; });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.on('render-process-gone', (_, d) => { console.error('[noviq-avatar] renderer caído:', d.reason); listo = false; setTimeout(() => win && win.reload(), 800); });

  // Reafirmar "siempre encima" (algunas apps a pantalla completa lo quitan)
  setInterval(() => { if (win && estado.visible && !win.isDestroyed()) win.setAlwaysOnTop(true, config.nivelEncima || 'screen-saver'); }, 5000);

  // Posición del puntero para que los ojos lo sigan
  let ultimo = '';
  setInterval(() => {
    if (!win || !estado.visible || !listo) return;
    const c = screen.getCursorScreenPoint(), p = posVentana();
    const x = Math.round((c.x - p.x) / escala), y = Math.round((c.y - p.y) / escala);
    const k = x + ',' + y;
    if (k !== ultimo) { ultimo = k; enviar('cursor', { x, y }); }
  }, 50);
}

/* ------------------------------------------------------------------ Arrastre */
let arrastre = null;
function iniciarArrastre() {
  cancelarVuelo('arrastre');
  const c = screen.getCursorScreenPoint(), p = posVentana();
  arrastre = { dx: c.x - p.x, dy: c.y - p.y, timer: null, prev: c };
  arrastre.timer = setInterval(() => {
    if (!arrastre || !win) return;
    const q = screen.getCursorScreenPoint();
    fijarPos(q.x - arrastre.dx, q.y - arrastre.dy);
    enviar('vuelo', { vx: (q.x - arrastre.prev.x) * 40, vy: (q.y - arrastre.prev.y) * 40 });
    arrastre.prev = q;
  }, 16);
}
function finArrastre() {
  if (!arrastre) return;
  clearInterval(arrastre.timer);
  arrastre = null;
  enviar('vuelo', { vx: 0, vy: 0 });
  const a = anclaActual(), l = limitar(a.x, a.y);
  if (Math.abs(l.x - a.x) > 2 || Math.abs(l.y - a.y) > 2) volarA(l.x, l.y, { duracion: 300 });
  guardarPos();
  emitir('arrastre_fin', { x: Math.round(a.x), y: Math.round(a.y) });
}


/* ------------------------------------------------------------ Menús y bandeja */
function plantillaMenu() {
  const d = aj();
  const modo = d.oido.modo;
  const nv = puente.estado();
  const nombre = d.identidad.nombre;
  return [
    { label: `⚙  Ajustes de ${nombre}…`, click: () => abrirAjustes() },
    { type: 'separator' },
    { label: nv.conectado ? '● Conectado con Noviq (usa sus herramientas)' : d.noviq.usar ? '○ Noviq no está abierto' : '○ Conexión con Noviq apagada', enabled: false },
    { label: nv.conectado ? 'Mostrar Noviq' : 'Abrir Noviq', click: () => abrirNoviq() },
    { label: `Háblame ahora${atajoActual ? '  (' + atajoActual.replace('Control', 'Ctrl') + ')' : ''}`, click: () => controlador.ejecutar({ cmd: 'microfono' }) },
    { label: 'Escuchar', submenu: [[`Cuando digo «${nombre}…»`, 'palabra'], ['Siempre (todo lo que oiga)', 'siempre'], ['Solo al hacer clic en el micrófono', 'pulsar'], ['Apagado', 'apagado']]
      .map(([l, m]) => ({ label: l, type: 'radio', checked: modo === m, click: () => nucleo.ajustes.actualizar({ oido: { modo: m } }) })) },
    { label: 'Hablar en voz alta', type: 'checkbox', checked: !!d.voz.activada, click: (i) => nucleo.ajustes.actualizar({ voz: { activada: i.checked } }) },
    { label: 'Sonidos de robot', type: 'checkbox', checked: !!d.sonidos.activados, click: (i) => nucleo.ajustes.actualizar({ sonidos: { activados: i.checked } }) },
    { type: 'separator' },
    { label: estado.renderer.modo === 'icono' ? 'Expandir avatar' : 'Modo icono', click: () => controlador.ejecutar({ cmd: 'alternar_icono' }) },
    { label: estado.visible ? 'Ocultar' : 'Mostrar', click: () => controlador.ejecutar({ cmd: estado.visible ? 'ocultar' : 'mostrar' }) },
    { label: 'Ir a…', submenu: [['Centro', 'centro'], ['Arriba izquierda', 'arriba-izquierda'], ['Arriba derecha', 'arriba-derecha'], ['Abajo izquierda', 'abajo-izquierda'], ['Abajo derecha', 'abajo-derecha']]
      .map(([l, k]) => ({ label: l, click: () => controlador.ejecutar({ cmd: 'ir', a: k }) })) },
    { label: 'Tamaño', submenu: [['Pequeño', 0.55], ['Mediano', 0.8], ['Grande', 1.0], ['Muy grande', 1.3]]
      .map(([l, s]) => ({ label: l, type: 'radio', checked: Math.abs(escala - s) < 0.01, click: () => controlador.ejecutar({ cmd: 'escala', valor: s }) })) },
    { label: 'Pasear por la pantalla', type: 'checkbox', checked: estado.pasear, click: (i) => controlador.ejecutar({ cmd: 'pasear', activo: i.checked }) },
    { label: 'Seguir al puntero', type: 'checkbox', checked: estado.seguir, click: (i) => controlador.ejecutar({ cmd: 'seguir', activo: i.checked }) },
    { label: 'Ojos siguen al puntero', type: 'checkbox', checked: !!d.apariencia.mirarCursor, click: (i) => nucleo.ajustes.actualizar({ apariencia: { mirarCursor: i.checked } }) },
    { type: 'separator' },
    { label: 'Panel de pruebas de la API', click: () => shell.openExternal(`http://127.0.0.1:${config.puerto}/panel`) },
    { label: `API: 127.0.0.1:${config.puerto}`, enabled: false },
    { type: 'separator' },
    { label: puente.lanzadoPorNoviq ? 'Cerrar (vuelve cuando Noviq trabaje)' : 'Salir', click: () => { puente.evento('salir', { por: 'usuario' }).finally(() => app.quit()); setTimeout(() => app.quit(), 1500); } }
  ];
}
function actualizarBandeja() {
  if (!tray || !nucleo) return;
  const nv = puente.estado();
  try { tray.setToolTip(`${aj().identidad.nombre} — ${nv.conectado ? 'conectado con Noviq' : 'independiente'} · API 127.0.0.1:${config.puerto}`); } catch (_) { /* noop */ }
}
function crearBandeja() {
  try {
    const img = nativeImage.createFromPath(path.join(__dirname, 'assets', 'icono-bandeja.png'));
    tray = new Tray(img.isEmpty() ? nativeImage.createEmpty() : img);
    actualizarBandeja();
    tray.on('click', () => controlador.ejecutar({ cmd: estado.visible ? 'ocultar' : 'mostrar' }));
    tray.on('double-click', () => abrirAjustes());
    tray.on('right-click', () => tray.popUpContextMenu(Menu.buildFromTemplate(plantillaMenu())));
    tray.setContextMenu(null);
  } catch (e) { log('bandeja no disponible: ' + e.message); }
}

/* --------------------------------------------------------------------- IPC */
ipcMain.handle('config', () => Object.assign(configRenderer(), { escala, noviq: puente.estado(), version: VERSION, sonidoArranque: true }));
// 🗣 Texto → voz moderna con SUS motores (Microsoft neuronal, NVIDIA Magpie o las de Noviq); si no, voz de Windows
ipcMain.handle('tts', async (_, { texto, op }) => {
  if (!texto || typeof texto !== 'string' || !nucleo) return { ok: false };
  try { return await nucleo.voz.sintetizar(texto.slice(0, 1500), op || {}); } catch (e) { return { ok: false, error: e.message }; }
});
// 🎙 Lo que oyó el micrófono (WAV base64) → su oído lo transcribe → su mente decide
ipcMain.handle('voz', async (_, { audio, op }) => {
  if (!audio || typeof audio !== 'string' || audio.length > 8 * 1024 * 1024 || !nucleo) return { ok: false, error: 'audio inválido' };
  try { return await nucleo.oirMicrofono(audio, op || {}); } catch (e) { log('voz: ' + e.message); return { ok: false, error: e.message }; }
});
ipcMain.on('hecho', (_, { id, r }) => { const p = pendientes.get(id); if (p) { clearTimeout(p.timer); pendientes.delete(id); p.resolve(r); } });
ipcMain.on('fallo', (_, { id, e }) => { const p = pendientes.get(id); if (p) { clearTimeout(p.timer); pendientes.delete(id); p.reject(new Error(e)); } });
ipcMain.on('estado', (_, s) => { estado.renderer = s || {}; });
ipcMain.on('ignorar', (_, ignorar) => {
  if (!win) return;
  const v = !estado.interactivo ? true : !!ignorar;
  win.setIgnoreMouseEvents(v, { forward: true });
});
ipcMain.on('arrastre', (_, fase) => { if (!estado.interactivo) return; if (fase === 'inicio') iniciarArrastre(); else finArrastre(); });
ipcMain.on('menu', () => { if (win) Menu.buildFromTemplate(plantillaMenu()).popup({ window: win }); });
ipcMain.on('dobleClic', () => { if (config.dobleClicIcono) controlador.ejecutar({ cmd: 'alternar_icono' }); });
ipcMain.on('evento', (_, { n, d }) => {
  if (n === 'listo') alListo();
  if (n === 'clic' && nucleo) { nucleo.mente.actividad(); if (d && d.callar) nucleo.mente.pararLectura(); }   // clic mientras habla: se calla
  if (n === 'voces' && nucleo && d && Array.isArray(d.voces)) nucleo.voz.vocesWindows = d.voces.slice(0, 200);
  if (EVENTOS_A_NOVIQ.has(n)) puente.evento(n, d);
  emitir(n, d);
});
let arranqueSaludado = false;
async function alListo() {
  listo = true;
  while (colaListo.length) colaListo.shift()();
  controlador.ejecutar({ cmd: 'expresion', valor: P.caraBase(aj().identidad.personalidad) });
  if (arranqueSaludado) return;
  arranqueSaludado = true;
  // Si Noviq tiene algo pendiente (un trabajo a medias), el saludo lo da Noviq; si no, saluda la mente del avatar
  let r = null;
  if (puente.lanzadoPorNoviq || (await puente.latido())) r = await puente.evento('listo', { version: VERSION });
  if (r && r.saludo) return;
  if (!aj().apariencia.saludoInicial) return;
  const [texto, tipo] = nucleo.mente.saludoInicial();
  nucleo.mente.decir(texto, tipo);
}

/* -------------------------------------------------------------- Arranque */
app.on('second-instance', (_e, argv) => {
  if (argv.includes('--ajustes')) return abrirAjustes();
  if (win) { win.showInactive(); estado.visible = true; controlador.ejecutar({ cmd: 'saludar' }); }
});
app.on('window-all-closed', () => { /* sigue vivo en la bandeja aunque cierres los ajustes */ });
app.on('before-quit', () => { guardarPos(); puente.detener(); if (nucleo) { nucleo.agentes.cancelarTodos(); nucleo.conexiones.cerrarTodo(); nucleo.memoria.guardarYa(); } if (api) api.cerrar(); });
app.on('will-quit', () => { try { globalShortcut.unregisterAll(); } catch (_) { /* noop */ } });

/** Cifrado de las claves con la cuenta de Windows (DPAPI). */
function cifrador() {
  try {
    if (!safeStorage.isEncryptionAvailable()) return null;
    return { disponible: true, cifrar: (t) => safeStorage.encryptString(String(t)).toString('base64'), descifrar: (b) => safeStorage.decryptString(Buffer.from(String(b), 'base64')) };
  } catch (_) { return null; }
}
const CARPETAS = { desktop: 'desktop', documents: 'documents', downloads: 'downloads', pictures: 'pictures', videos: 'videos', music: 'music', home: 'home' };

app.whenReady().then(async () => {
  marca('ready');
  if (process.platform === 'win32') app.setAppUserModelId('com.noviq.avatar');
  // 🎙 Micrófono siempre; 📷 cámara SOLO si el usuario la activó en Ajustes → Visión (nada de pantalla, ubicación…)
  const camaraPermitida = () => !!(nucleo && nucleo.ajustes && nucleo.ajustes.datos.vision && nucleo.ajustes.datos.vision.camara);
  session.defaultSession.setPermissionRequestHandler((_wc, permiso, cb, detalles) => {
    const tipos = (detalles && detalles.mediaTypes) || [];
    cb(permiso === 'media' && (!tipos.includes('video') || camaraPermitida()));
  });
  session.defaultSession.setPermissionCheckHandler((_wc, permiso, _origen, detalles) => {
    if (permiso !== 'media') return false;
    return detalles && detalles.mediaType === 'video' ? camaraPermitida() : true;
  });
  marca('permisos');

  nucleo = crearNucleo({
    dir: app.getPath('userData'), cifrador: cifrador(), noviq: puente, version: VERSION, log, urlAPI: `http://127.0.0.1:${config.puerto}`,
    cuerpo: (cmd, op) => (controlador ? controlador.ejecutar(cmd, op) : Promise.resolve({ ok: false })),
    emitir: (n, d) => emitir(n, d),
    rutaNoviqMcp: path.join(RUTA_NOVIQ, 'noviq_mcp.py'),
    rutaNoviq: RUTA_NOVIQ,
    dirCapturas: path.join(app.getPath('userData'), 'capturas'),
    // Permisos de los bots internos: un cuadro de Windows (nunca por voz): Permitir / Rechazar
    confirmar: async (info) => {
      const r = await dialog.showMessageBox({ type: info.peligro ? 'warning' : 'question', buttons: ['Permitir', 'Rechazar'], defaultId: 1, cancelId: 1, noLink: true,
        title: 'Noviq Avatar · permiso', message: String(info.texto || '').slice(0, 300), detail: String(info.detalle || '').slice(0, 800) });
      return r.response === 0;
    },
    // Ojos: captura de la pantalla principal reducida (JPEG en base64; no se guarda en disco)
    capturarPantalla: async () => {
      const d = screen.getPrimaryDisplay();
      const k = Math.min(1, 1280 / d.size.width);
      const fuentes = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: Math.round(d.size.width * k), height: Math.round(d.size.height * k) } });
      const f = fuentes.find((x) => String(x.display_id) === String(d.id)) || fuentes[0];
      return f ? f.thumbnail.toJPEG(80).toString('base64') : '';
    },
    abrirURL: (u) => { if (/^https?:\/\//.test(u)) shell.openExternal(u); },
    abrirRuta: (p) => shell.openPath(p),
    carpeta: (k) => { try { return app.getPath(CARPETAS[k] || k); } catch (_) { return null; } },
    leerClip, escribirClip: (t) => clipboard.writeText(String(t)),
    abrirAjustes: () => abrirAjustes(), abrirNoviq,
    infoExtra: () => ({ atajo: atajoActual, atajoError, puerto: config.puerto })
  });
  nucleo.ajustes.alCambiar((cambios) => aplicarAjustes(cambios));
  estado.mirarCursor = aj().apariencia.mirarCursor;
  marca('nucleo');
  // Primera vez: trae lo que tenía en la versión anterior (preferencias del avatar y memoria de Noviq)
  if (!aj().migrado.local) {
    const pref = leerJSON(path.join(app.getPath('userData'), 'preferencias.json'));
    if (pref) {
      const pa = {};
      if (pref.voz) pa.voz = { activada: !!pref.voz.activada };
      if (pref.sonidos) pa.sonidos = pref.sonidos;
      if (pref.oido) pa.oido = { modo: pref.oido.modo, sensibilidad: pref.oido.sensibilidad, maxSeg: pref.oido.maxSeg };
      if (pref.mirarCursor != null) pa.apariencia = { mirarCursor: !!pref.mirarCursor };
      if (typeof pref.portapapeles === 'string') pa.portapapeles = { modo: pref.portapapeles };
      nucleo.ajustes.actualizar(pa, { silencioso: true });
    }
    nucleo.ajustes.marcarMigrado('local');
  }
  if (!aj().migrado.memoria) {
    const vieja = [process.env.NOVIQ_DATOS && path.join(process.env.NOVIQ_DATOS, 'avatar_memoria.json'), path.join(__dirname, '..', 'datos', 'avatar_memoria.json')]
      .filter(Boolean).find((f) => fs.existsSync(f));
    if (vieja) { const n = nucleo.memoria.importar(leerJSON(vieja)); nucleo.ajustes.marcarMigrado('memoria'); log(`memoria heredada de Noviq: ${n} datos`); }
  }

  crearVentana();
  marca('ventana');
  controlador = new Controlador({ avatar: alAvatar, ventana, emitir, mente: (n, p) => nucleo.comandoMente(n, p) });
  api = crearAPI({
    puerto: config.puerto, host: config.host, token: config.token, origenesPermitidos: (config.origenesPermitidos || []).concat(aj().api.origenes || []),
    ejecutar: (e, o) => controlador.ejecutar(e, o), estado: estadoPublico, rutaPanel: path.join(__dirname, 'panel', 'panel.html'), version: VERSION,
    charlar: (cuerpo) => nucleo.charlar(cuerpo), rutas: nucleo.rutas, claveApi: () => nucleo.ajustes.claveApi(),
    estaticos: { '/ajustes': path.join(__dirname, 'ajustes') }
  });
  api.escuchando.catch((e) => {
    log(`No se pudo abrir la API en el puerto ${config.puerto}: ${e.message}`);
    if (tray) tray.setToolTip(`Noviq Avatar — ERROR: puerto ${config.puerto} ocupado`);
  });
  marca('api');
  crearBandeja();
  marca('bandeja');
  registrarAtajo();
  marca('atajo');
  puente.iniciar(10000);
  marca('puente');
  vigilarPortapapeles();
  setInterval(() => { try { nucleo.mente.vigilar(); } catch (e) { log('vigilar: ' + e.message); } }, 1000);
  setInterval(() => nucleo.cerebro.sondearLocales().catch(() => {}), 60000);
  if (aj().apariencia.iniciarConWindows) iniciarConWindows(true);
  if (process.argv.includes('--ajustes')) setTimeout(() => abrirAjustes(), 800);
  marca('listo');
  if (process.env.NOVIQ_AVATAR_PRUEBA_MS) setTimeout(() => { marca('fin de prueba'); app.quit(); }, Number(process.env.NOVIQ_AVATAR_PRUEBA_MS));
  screen.on('display-removed', () => { const a = anclaActual(), l = limitar(a.x, a.y); volarA(l.x, l.y, { duracion: 0 }); });
});
