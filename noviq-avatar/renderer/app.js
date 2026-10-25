/* ==========================================================================
   Noviq Avatar — Arranque del renderer, puente con Electron y ratón
   ========================================================================== */
(function () {
  'use strict';
  const N = window.N;
  const puente = window.noviqPuente || null;
  const escena = document.getElementById('escena');

  async function arrancar() {
    const config = puente ? await puente.config() : { escala: 1, mirarCursor: true, voz: { activada: false } };
    escena.insertAdjacentHTML('afterbegin', N.construirSVG());
    const svg = document.getElementById('lienzo');
    const rig = new N.Rig(svg);
    const fx = new N.Efectos(svg);
    const burbuja = new N.Burbuja(escena);
    const sonidos = new N.Sonidos(config.sonidos);

    let ultimoEstado = '';
    const motor = new N.Motor({
      rig, fx, burbuja, config, sonidos,
      emitir: (nombre, datos) => {
        if (!puente) return;
        if (nombre === '_estado') {
          const j = JSON.stringify(datos);
          if (j !== ultimoEstado) { ultimoEstado = j; puente.estado(datos); }
        } else puente.evento(nombre, datos);
      }
    });
    aplicarEscala(config.escala || 1);
    motor.iniciar();

    // 🎙 Oído (micrófono) y punto de conexión con Noviq
    const oido = new N.Oido({ motor, sonidos, puente, escena, config: Object.assign({ nombre: config.nombre }, config.oido) });
    motor.oido = oido;
    motor.puenteTTS = puente && puente.tts ? (texto, op) => puente.tts(texto, op) : null;
    const enlace = document.createElement('div');
    enlace.className = 'enlace';
    escena.appendChild(enlace);
    let conNoviq = false;
    const pintarEnlace = (n) => {
      if (n && n.conectado != null) conNoviq = !!n.conectado;
      enlace.className = 'enlace' + (conNoviq ? ' si' : '') + (motor.modo === 'icono' ? ' escondido' : '');
    };
    pintarEnlace(config.noviq);

    // Modo depuración (navegador sin Electron): expone el motor para pruebas
    window.noviqDebug = { motor, fx, rig, burbuja, sonidos, oido, ejecutar: (n, p) => motor.ejecutar(n, p) };

    if (!puente) return;

    puente.onComando(async ({ id, nombre, params }) => {
      try {
        const r = await motor.ejecutar(nombre, params || {});
        puente.hecho(id, r || { ok: true });
      } catch (e) {
        puente.fallo(id, String(e && e.message ? e.message : e));
      }
    });
    puente.onCursor((c) => { motor.cursor = { x: c.x, y: c.y, t: motor.t }; });
    puente.onVuelo((v) => { motor.vuelo = v; });
    puente.onEscala((s) => aplicarEscala(s));
    puente.onConfig((c) => {
      c = c || {};
      if (c.voz) motor.config.voz = Object.assign({}, motor.config.voz || {}, c.voz);
      if (c.mirarCursor != null) { motor.config.mirarCursor = c.mirarCursor; motor.mirarCursor = c.mirarCursor; }
      if (c.sonidos) sonidos.configurar(c.sonidos);
      if (c.oido || c.nombre) oido.configurar(Object.assign({}, c.oido, c.nombre ? { nombre: c.nombre } : {}));
      if (c.noviq) pintarEnlace(c.noviq);
      motor.emitirEstado();
    });

    configurarRaton(motor);
    // Voces de Windows instaladas (aparecen en sus Ajustes junto a las modernas)
    const informarVoces = () => {
      const vs = (window.speechSynthesis && window.speechSynthesis.getVoices()) || [];
      if (vs.length) puente.evento('voces', { voces: vs.map((v) => ({ id: v.name, nombre: v.name, idioma: v.lang, local: v.localService })) });
    };
    if (window.speechSynthesis) window.speechSynthesis.addEventListener('voiceschanged', informarVoces);
    setTimeout(informarVoces, 1500);
    const arranque = () => {
      puente.evento('listo', { version: config.version || '2.0.0' });
      motor.emitirEstado();
      if (config.oido && (config.oido.modo === 'palabra' || config.oido.modo === 'siempre')) oido.configurar(config.oido);
    };
    if (config.sonidoArranque !== false) sonidos.reproducir('encender');
    arranque();
    // Si cambia a modo icono, se esconde el micrófono/indicador
    setInterval(() => { oido.pintar(); pintarEnlace(null); }, 1500);
  }

  function aplicarEscala(s) {
    escena.style.transform = `scale(${s})`;
  }

  /* ------------------------------------------------ Ratón y click-through */
  function configurarRaton(motor) {
    let sobre = false, arrastrando = false, inicio = null, movido = false, ultimoClic = 0, timerClic = null;

    const esHit = (x, y) => {
      const el = document.elementFromPoint(x, y);
      return !!(el && el.closest && el.closest('[data-hit]'));
    };
    const setSobre = (v) => {
      if (v === sobre) return;
      sobre = v; motor.hover = v;
      puente.ignorar(!v);
    };

    window.addEventListener('mousemove', (e) => { if (!arrastrando) setSobre(esHit(e.clientX, e.clientY)); });
    document.addEventListener('mouseleave', () => { if (!arrastrando) setSobre(false); });

    window.addEventListener('pointerdown', (e) => {
      if (e.button !== 0 || !esHit(e.clientX, e.clientY)) return;
      arrastrando = true; movido = false;
      inicio = { x: e.screenX, y: e.screenY };
      try { document.body.setPointerCapture(e.pointerId); } catch (_) { /* noop */ }
      puente.arrastre('inicio');
    });
    window.addEventListener('pointermove', (e) => {
      if (!arrastrando || movido) return;
      if (Math.hypot(e.screenX - inicio.x, e.screenY - inicio.y) > 5) { movido = true; motor.ejecutar('_agarre', { activo: true }); }
    });
    const fin = (e) => {
      if (!arrastrando) return;
      arrastrando = false;
      puente.arrastre('fin');
      motor.ejecutar('_agarre', { activo: false });
      if (!movido && e && e.type === 'pointerup') {
        const ahora = Date.now();
        if (ahora - ultimoClic < 350) {
          clearTimeout(timerClic); ultimoClic = 0;
          puente.evento('doble_clic', {});
          puente.dobleClic();
        } else {
          ultimoClic = ahora;
          const pos = { x: Math.round(e.clientX), y: Math.round(e.clientY) };
          timerClic = setTimeout(() => {
            // (2.6) un clic mientras habla o lee un documento lo hace callar (el micrófono está en pausa mientras habla)
            if (motor.habla && motor.habla.activo) { puente.evento('clic', Object.assign({ callar: true }, pos)); motor.ejecutar('callar', {}); return; }   // (primero el aviso: así no empieza la parte siguiente)
            puente.evento('clic', pos);
            if (motor.modo === 'icono') motor.ejecutar('expandir', {});
            else if (!motor.accion && !motor.habla.activo) motor.ejecutar('expresion', { valor: 'feliz', duracion: 1200 });
          }, 360);
        }
      }
      setSobre(e ? esHit(e.clientX, e.clientY) : false);
    };
    window.addEventListener('pointerup', fin);
    window.addEventListener('pointercancel', fin);
    window.addEventListener('blur', () => fin(null));
    window.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      if (esHit(e.clientX, e.clientY)) puente.menu();
    });
  }

  arrancar().catch((e) => console.error('Noviq Avatar: error al arrancar', e));
})();
