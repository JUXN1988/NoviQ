/* ==========================================================================
   Noviq Avatar — Poses, expresiones, gestos de mano y acciones
   Convención de brazos: ángulos en grados, "hacia afuera" positivo en ambos
   lados. sh = hombro (0 = colgando, 90 = horizontal, 180 = arriba),
   el = codo (+ hacia afuera/arriba, − cruzando hacia el cuerpo),
   wr = muñeca, fs = escorzo del antebrazo (1 = normal, <1 apunta a cámara).
   L = brazo del lado izquierdo de la pantalla, R = lado derecho.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const { lerp, clamp, smooth } = N.util;
  const sin = Math.sin, cos = Math.cos, abs = Math.abs;

  N.poseBase = function () {
    const p = {
      bodyX: 0, bodyY: 0, bodyRot: 0, bodySX: 1, bodySY: 1, lean: 0,
      headRot: 0, headYaw: 0, headPitch: 0, headY: 0,
      eyeOpen: 1, eyeHappy: 0, eyeSize: 1, eyeSlant: 0, eyeSquint: 0, eyeLs: 1, eyeRs: 1, eyeLo: 1, eyeRo: 1,
      lookX: 0, lookY: 0,
      mouthSmile: 0.5, mouthOpen: 0, mouthWidth: 1, mouthRound: 0, mouthGrille: 0,
      grid: 0, glow: 1, iconT: 0, visorIcon: 0
    };
    for (const S of ['L', 'R']) {
      Object.assign(p, { [S + 'sh']: 12, [S + 'el']: -10, [S + 'wr']: 4, [S + 'fs']: 1, [S + 'hs']: 1.22, [S + 'hy']: 1, [S + 'sp']: 0.35,
        [S + 'c0']: 0.15, [S + 'c1']: 0.1, [S + 'c2']: 0.12, [S + 'c3']: 0.16, [S + 'c4']: 0.2 });
    }
    return p;
  };

  /* --------------------------------------------------------- Expresiones */
  const NEUTRAL = {
    eyeOpen: 1, eyeHappy: 0, eyeSize: 1, eyeSlant: 0, eyeSquint: 0, eyeLs: 1, eyeRs: 1, eyeLo: 1, eyeRo: 1,
    lookX: 0, lookY: 0, mouthSmile: 0.5, mouthOpen: 0, mouthWidth: 1, mouthRound: 0, mouthGrille: 0, grid: 0, glow: 1
  };
  N.EXPRESIONES = {
    neutral: {},
    feliz: { eyeHappy: 1, mouthSmile: 1, mouthOpen: 0.28, mouthWidth: 1.1 },
    sonrisa: { mouthSmile: 1, mouthWidth: 1.08, eyeSize: 1.02 },
    risa: { eyeHappy: 1, mouthSmile: 1, mouthOpen: 0.85, mouthWidth: 1.22 },
    sorpresa: { eyeSize: 1.25, eyeOpen: 1.08, mouthSmile: 0, mouthOpen: 0.55, mouthRound: 1, mouthWidth: 0.95 },
    enfocado: { eyeSquint: 0.5, eyeSlant: 0.2, mouthSmile: 0.15, mouthWidth: 0.72, grid: 0.6 },
    pensando: { eyeSlant: -0.5, eyeSize: 0.95, mouthSmile: -0.35, mouthWidth: 0.62, lookX: 0.35, lookY: -0.5 },
    procesando: { grid: 1, eyeSize: 0.85, eyeSquint: 0.25, mouthSmile: 0.2, mouthWidth: 0.7 },
    dormido: { eyeHappy: -1, mouthSmile: 0.3, mouthWidth: 0.55, glow: 0.55 },
    triste: { eyeSlant: -0.75, mouthSmile: -0.85, mouthWidth: 0.85, lookY: 0.35 },
    enojado: { eyeSlant: 0.85, eyeSquint: 0.2, mouthSmile: -0.6, mouthWidth: 0.9 },
    guino: { eyeRo: 0.06, mouthSmile: 1, mouthWidth: 1.1, eyeLs: 1.05 },
    confundido: { eyeLs: 1.14, eyeRs: 0.8, eyeSlant: -0.25, mouthSmile: -0.2, mouthWidth: 0.6, lookY: -0.3 },
    atento: { eyeSize: 1.1, mouthSmile: 0.7 },
    hablando: { mouthSmile: 0.55, mouthGrille: 0.85 }
  };
  N.EXPR_ALIAS = {
    normal: 'neutral', neutro: 'neutral', reposo: 'neutral', neutral: 'neutral',
    feliz: 'feliz', alegre: 'feliz', contento: 'feliz', happy: 'feliz',
    sonrisa: 'sonrisa', sonreir: 'sonrisa', smile: 'sonrisa',
    risa: 'risa', reir: 'risa', laugh: 'risa', carcajada: 'risa',
    sorpresa: 'sorpresa', sorprendido: 'sorpresa', surprise: 'sorpresa', asombro: 'sorpresa',
    enfocado: 'enfocado', concentrado: 'enfocado', focused: 'enfocado', focus: 'enfocado',
    pensando: 'pensando', pensativo: 'pensando', thinking: 'pensando', duda: 'pensando',
    procesando: 'procesando', processing: 'procesando', calculando: 'procesando',
    dormido: 'dormido', dormir: 'dormido', asleep: 'dormido', sleep: 'dormido',
    triste: 'triste', sad: 'triste',
    enojado: 'enojado', enfadado: 'enojado', molesto: 'enojado', angry: 'enojado',
    guino: 'guino', wink: 'guino',
    confundido: 'confundido', confused: 'confundido',
    atento: 'atento', attentive: 'atento', hablando: 'hablando', talking: 'hablando'
  };
  N.aplicarExpresion = function (T, nombre, peso) {
    const e = Object.assign({}, NEUTRAL, N.EXPRESIONES[nombre] || {});
    const w = peso == null ? 1 : peso;
    for (const k in e) T[k] = w >= 1 ? e[k] : lerp(T[k], e[k], w);
  };
  N.resolverExpresion = function (v) {
    if (!v) return null;
    const k = String(v).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
    return N.EXPR_ALIAS[k] || (N.EXPRESIONES[k] ? k : null);
  };

  /* ------------------------------------------------------ Gestos de mano */
  // [pulgar, índice, medio, anular, meñique, apertura]
  N.GESTOS = {
    abierta: [0, 0, 0, 0, 0, 1],
    relajada: [0.15, 0.1, 0.12, 0.16, 0.2, 0.35],
    puno: [0.85, 1, 1, 1, 1, 0],
    senalar: [0.8, 0, 1, 1, 1, 0.1],
    paz: [0.9, 0, 0, 1, 1, 1],
    pulgar: [0, 1, 1, 1, 1, 0],
    agarrar: [0.5, 0.55, 0.6, 0.62, 0.66, 0.1],
    teclear: [0.3, 0.35, 0.4, 0.42, 0.48, 0.25],
    garra: [0.4, 0.45, 0.45, 0.45, 0.45, 0.8]
  };
  N.GESTO_ALIAS = { abierta: 'abierta', abrir: 'abierta', open: 'abierta', relajada: 'relajada', normal: 'relajada', relax: 'relajada',
    puno: 'puno', cerrada: 'puno', fist: 'puno', senalar: 'senalar', apuntar: 'senalar', point: 'senalar', indice: 'senalar',
    paz: 'paz', victoria: 'paz', peace: 'paz', pulgar: 'pulgar', ok: 'pulgar', like: 'pulgar', thumbsup: 'pulgar',
    agarrar: 'agarrar', sostener: 'agarrar', grab: 'agarrar', teclear: 'teclear', type: 'teclear', garra: 'garra', claw: 'garra' };

  function brazo(T, S, sh, el, wr, fs) {
    T[S + 'sh'] = sh; T[S + 'el'] = el;
    if (wr != null) T[S + 'wr'] = wr;
    if (fs != null) T[S + 'fs'] = fs;
  }
  function gesto(T, S, nombre, peso) {
    const g = N.GESTOS[nombre] || N.GESTOS.relajada;
    const w = peso == null ? 1 : peso;
    for (let i = 0; i < 5; i++) T[S + 'c' + i] = lerp(T[S + 'c' + i], g[i], w);
    T[S + 'sp'] = lerp(T[S + 'sp'], g[5], w);
  }
  N.brazo = brazo; N.gesto = gesto;

  const osc = (t, f, a, fase) => sin(t * f + (fase || 0)) * a;
  const entrada = (t, d) => smooth(0, d || 0.35, t);

  function emitirCada(a, clave, intervalo, t, fn) {
    const e = a.estado;
    if (e[clave] == null) e[clave] = t;
    if (t >= e[clave]) { e[clave] = t + intervalo; fn(); }
  }

  /* ------------------------------------------------------------ Acciones */
  // dur: segundos (null = bucle hasta nueva orden). expr: expresión por defecto.
  N.ACCIONES = {
    reposo: {
      dur: null,
      pose(T, t) {
        T.bodyY = sin(t * 1.6) * 5;
        T.bodyRot = sin(t * 0.6) * 0.8;
        T.headRot = sin(t * 0.8) * 1.6;
        T.headPitch = sin(t * 0.5) * 0.04;
        brazo(T, 'L', 12 + osc(t, 1.3, 2.5), -10 + osc(t, 1.1, 3), 4);
        brazo(T, 'R', 12 + osc(t, 1.3, 2.5, 1.2), -10 + osc(t, 1.1, 3, 0.8), 4);
      }
    },

    saludar: {
      dur: 2.6, expr: 'feliz', rapidez: 1.8,
      pose(T, t, P) {
        const S = P.lado === 'izquierda' ? 'L' : 'R', O = S === 'L' ? 'R' : 'L';
        const e = entrada(t, 0.3);
        brazo(T, S, lerp(12, 112, e), lerp(-10, 58, e) + osc(t, 10, 20 * e), osc(t, 10, 12 * e, 0.7));
        gesto(T, S, 'abierta');
        T.headRot = (S === 'R' ? -7 : 7) * e; T.headYaw = (S === 'R' ? 0.12 : -0.12) * e;
        T.bodyRot = (S === 'R' ? -2 : 2) * e;
        brazo(T, O, 14, -12, 4);
      }
    },

    reir: {
      dur: 2.8, expr: 'risa', rapidez: 2,
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.25), b = abs(sin(t * 13));
        T.bodyY = -b * 4 * e + sin(t * 1.6) * 2;
        T.bodySY = 1 - b * 0.012 * e;
        T.headPitch = -0.22 * e + b * 0.05; T.headRot = osc(t, 6.5, 4 * e) - 3 * e;
        brazo(T, 'L', 12 + b * 4, -84 + b * 6, 28, 0.75);
        brazo(T, 'R', 12 + b * 4, -84 + b * 6, 28, 0.75);
        T.Lhy = 0.85; T.Rhy = 0.85;
        gesto(T, 'L', 'puno', 0.7); gesto(T, 'R', 'puno', 0.7);
        T.mouthOpen = 0.65 + b * 0.25;
        emitirCada(a, 'ja', 0.32, t, () => {
          const lado = (a.estado.n = (a.estado.n || 0) + 1) % 2 ? -1 : 1;
          m.fx.particula('ja', 220 + lado * (95 + Math.random() * 20), 170 + Math.random() * 30, { vx: lado * 25 });
        });
      }
    },

    pensar: {
      dur: 3.8, expr: 'pensando',
      inicio(P, m, a) {
        if (P.texto) {
          a.burbuja = m.burbuja.mostrar({ texto: P.texto, tipo: 'pensamiento', modo: 'maquina', cps: 34, fijo: P.fijo, duracion: P.duracionBurbuja });
          a.dur = null;
          a.burbuja.promesa.then(() => { a.hecho = true; });
        } else {
          a.burbuja = m.burbuja.mostrar({ tipo: 'pensamiento', modo: 'puntos', fijo: true });
        }
      },
      pose(T, t) {
        const e = entrada(t, 0.45);
        brazo(T, 'R', lerp(12, 3, e), lerp(-10, -153, e), lerp(4, 4, e));
        gesto(T, 'R', 'senalar', e);
        brazo(T, 'L', lerp(12, 10, e), lerp(-10, -88, e), lerp(4, 40, e), lerp(1, 0.72, e));
        gesto(T, 'L', 'agarrar', e);
        T.headRot = 6 * e + osc(t, 0.9, 1.5); T.headYaw = -0.1 * e; T.headPitch = -0.05 * e;
        T.bodyRot = -1.5 * e;
      },
      fin(P, m, a) { if (a.burbuja && !P.fijo) m.burbuja.ocultar(a.burbuja.token); }
    },

    textear: {
      dur: 4, expr: 'enfocado', rapidez: 1.6,
      inicio(P, m, a) {
        if (P.texto) {
          a.dur = null;
          a.burbuja = m.burbuja.mostrar({
            texto: P.texto, tipo: 'mensaje', modo: 'maquina', cps: 17 * (P.velocidad || 1), fijo: P.fijo,
            duracion: P.duracionBurbuja, alCompletar: () => { a.estado.fin = m.t + 0.6; }
          });
          a.burbuja.promesa.then(() => { if (!a.estado.fin) a.estado.fin = m.t; });
        } else {
          a.burbuja = m.burbuja.mostrar({ tipo: 'mensaje', modo: 'puntos', fijo: true });
        }
      },
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.4);
        brazo(T, 'L', lerp(12, 10, e), lerp(-10, -70, e), lerp(4, 60, e), lerp(1, 0.75, e));
        brazo(T, 'R', lerp(12, 10, e), lerp(-10, -70, e), lerp(4, 60, e), lerp(1, 0.75, e));
        T.Lhy = lerp(1, 0.72, e); T.Rhy = lerp(1, 0.72, e);
        gesto(T, 'L', 'teclear', e); gesto(T, 'R', 'teclear', e);
        const tecleando = !a.estado.fin || m.t < a.estado.fin;
        if (tecleando && e > 0.8) {
          for (const S of ['L', 'R']) for (let i = 1; i < 5; i++) {
            const f = sin(t * 17 + i * 1.9 + (S === 'L' ? 0 : 2.4));
            if (f > 0.55) T[S + 'c' + i] = 0.1;
          }
          T.Lwr += osc(t, 8, 4); T.Rwr += osc(t, 8, 4, 2);
          emitirCada(a, 'tecla', 0.07, t, () => m.fx.pulsarTecla());
        }
        T.headPitch = 0.22 * e; T.lookY = 0.55 * e; T.lookX = osc(t, 1.3, 0.25) * e;
        m.fx.want.teclado = 1;
        if (a.estado.fin && m.t > a.estado.fin) a.hecho = true;
      },
      fin(P, m, a) { if (a.burbuja && !P.texto) m.burbuja.ocultar(a.burbuja.token); }
    },

    trabajar: {
      dur: 6, expr: 'enfocado', rapidez: 1.4,
      pose(T, t, P, m) {
        const e = entrada(t, 0.45);
        const s1 = sin(t * 1.7), s2 = sin(t * 2.3 + 1);
        brazo(T, 'L', lerp(12, 26, e), lerp(-10, -58 + s1 * 14, e), lerp(4, 22 + s1 * 8, e), lerp(1, 0.7, e));
        brazo(T, 'R', lerp(12, 24, e), lerp(-10, -54 + s2 * 12, e), lerp(4, 18 + s2 * 18, e), lerp(1, 0.7, e));
        gesto(T, 'L', 'senalar', e); gesto(T, 'R', 'agarrar', e);
        T.headPitch = 0.2 * e; T.lookY = 0.5 * e; T.lookX = sin(t * 0.9) * 0.45 * e; T.headYaw = sin(t * 0.9) * 0.12 * e;
        m.fx.want.panelTrabajo = 1;
        m.fx.progresoTrabajo = ((t / (P.ciclo || 4)) % 1);
      }
    },

    analizar: {
      dur: 5.5, expr: 'procesando',
      pose(T, t, P, m) {
        const e = entrada(t, 0.6);
        brazo(T, 'L', lerp(12, 42, e) + osc(t, 1.2, 4), lerp(-10, 42, e) + osc(t, 1.5, 6), lerp(4, -12, e));
        brazo(T, 'R', lerp(12, 42, e) + osc(t, 1.2, 4, 1), lerp(-10, 42, e) + osc(t, 1.5, 6, 1), lerp(4, -12, e));
        gesto(T, 'L', 'abierta', e); gesto(T, 'R', 'abierta', e);
        T.bodyY = -8 * e + sin(t * 1.4) * 4; T.headPitch = -0.08 * e;
        T.lookX = sin(t * 1.1) * 0.6; T.lookY = -0.15;
        m.fx.want.circuitos = 1; m.fx.want.paneles = 1;
      }
    },

    herramientas: {
      dur: 5.5, expr: 'sonrisa',
      inicio(P, m) { m.fx.setHerramientas(P.lista); },
      pose(T, t, P, m) {
        const e = entrada(t, 0.5);
        brazo(T, 'R', lerp(12, 128, e), lerp(-10, 52, e) + osc(t, 1.4, 5), lerp(4, 10, e));
        gesto(T, 'R', 'abierta', e);
        brazo(T, 'L', lerp(12, 34, e), lerp(-10, 36, e), lerp(4, -8, e));
        gesto(T, 'L', 'abierta', e);
        T.grid = 0.55; T.headRot = -4 * e; T.lookY = -0.45 * e; T.lookX = 0.3 * sin(t * 0.8);
        T.bodyY = -5 * e + sin(t * 1.4) * 4;
        m.fx.want.circuitos = 0.75; m.fx.want.herramientas = 1;
      }
    },

    escuchar: {
      dur: 4, expr: 'atento',
      pose(T, t, P, m) {
        const e = entrada(t, 0.4);
        T.headRot = 9 * e + osc(t, 0.8, 1.5); T.headYaw = -0.12 * e; T.lookY = -0.12 * e;
        brazo(T, 'L', lerp(12, 150, e), lerp(-10, 5, e), lerp(4, -20, e));
        gesto(T, 'L', 'garra', e);
        m.fx.want.ondas = 1;
      }
    },

    aclarar: {
      dur: 2.4, expr: 'atento', rapidez: 1.4,
      pose(T, t) {
        const e = entrada(t, 0.3), s = sin(t * 5) * 0.5 + 0.5;
        brazo(T, 'L', lerp(12, 52, e) + s * 6, lerp(-10, 72, e), lerp(4, -6, e));
        brazo(T, 'R', lerp(12, 52, e) + s * 6, lerp(-10, 72, e), lerp(4, -6, e));
        gesto(T, 'L', 'abierta', e); gesto(T, 'R', 'abierta', e);
        T.headRot = 6 * e; T.bodyY = -s * 3 * e; T.mouthOpen = 0.12;
      }
    },

    senalar: {
      dur: 2.4, expr: 'sonrisa', rapidez: 1.4,
      pose(T, t, P) {
        const e = entrada(t, 0.3);
        const dir = P.direccion || 'derecha';
        if (dir === 'arriba') {
          brazo(T, 'R', lerp(12, 168, e), lerp(-10, 4, e), 0); gesto(T, 'R', 'senalar', e);
          T.lookY = -0.8 * e; T.headPitch = -0.15 * e; T.lookX = 0.2 * e;
        } else if (dir === 'abajo') {
          brazo(T, 'R', lerp(12, 38, e), lerp(-10, 8, e), 10); gesto(T, 'R', 'senalar', e);
          T.lookY = 0.8 * e; T.headPitch = 0.2 * e; T.lookX = 0.3 * e;
        } else if (dir === 'frente') {
          brazo(T, 'R', lerp(12, 30, e), lerp(-10, -58, e), -10, lerp(1, 0.55, e)); gesto(T, 'R', 'senalar', e);
          T.lookY = 0.1;
        } else {
          const S = dir === 'izquierda' ? 'L' : 'R', sg = S === 'L' ? -1 : 1;
          brazo(T, S, lerp(12, 88, e), lerp(-10, 4, e), 2); gesto(T, S, 'senalar', e);
          T.headYaw = 0.35 * sg * e; T.lookX = 0.9 * sg * e; T.headRot = -3 * sg * e;
        }
      }
    },

    asentir: {
      dur: 1.5, expr: 'sonrisa', rapidez: 1.8,
      pose(T, t) { const d = 1 - smooth(1, 1.5, t); T.headPitch = sin(t * 10) * 0.3 * d; T.lookY = 0.1; T.headY = sin(t * 10) * 2 * d; }
    },

    negar: {
      dur: 1.6, rapidez: 1.8,
      pose(T, t) { const d = 1 - smooth(1.1, 1.6, t); T.headYaw = sin(t * 9) * 0.42 * d; T.headRot = sin(t * 9) * 3 * d; T.mouthSmile = -0.25; T.eyeSlant = -0.2; }
    },

    celebrar: {
      dur: 2.8, expr: 'risa', rapidez: 1.8,
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.25), b = abs(sin(t * 6));
        brazo(T, 'L', lerp(12, 125, e) + osc(t, 12, 7), lerp(-10, 35, e), 5);
        brazo(T, 'R', lerp(12, 125, e) + osc(t, 12, 7, 1.6), lerp(-10, 35, e), 5);
        gesto(T, 'L', 'puno', e); gesto(T, 'R', 'puno', e);
        T.bodyY = -b * 13 * e; T.bodySY = 1 + b * 0.02; T.headPitch = -0.12 * e;
        emitirCada(a, 'chispa', 0.12, t, () => m.fx.particula('chispa', 120 + Math.random() * 200, 110 + Math.random() * 160));
      }
    },

    sorpresa: {
      dur: 1.9, expr: 'sorpresa', rapidez: 2,
      inicio(P, m) { m.fx.particula('excl', 300, 140, { vy: -35, escala: 1.4 }); },
      pose(T, t) {
        const salto = t < 0.5 ? -20 * sin((t / 0.5) * Math.PI) : 0;
        T.bodyY = salto + sin(t * 1.6) * 3;
        const e = entrada(t, 0.15);
        brazo(T, 'L', lerp(12, 56, e), lerp(-10, 38, e), -10); brazo(T, 'R', lerp(12, 56, e), lerp(-10, 38, e), -10);
        gesto(T, 'L', 'abierta', e); gesto(T, 'R', 'abierta', e);
        T.headPitch = -0.12 * e;
      }
    },

    confundido: {
      dur: 2.8, expr: 'confundido',
      inicio(P, m) { m.fx.particula('preg', 312, 150, { vy: -22, escala: 1.3 }); },
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.45);
        T.headRot = 12 * e; T.headYaw = -0.1 * e;
        brazo(T, 'R', lerp(12, 166, e), lerp(-10, 6, e), lerp(4, 46, e) + osc(t, 14, 7 * e));
        gesto(T, 'R', 'garra', e);
        emitirCada(a, 'q', 1.2, t + 0.9, () => m.fx.particula('preg', 290 + Math.random() * 40, 150, { vy: -20 }));
      }
    },

    dormir: {
      dur: null, expr: 'dormido', rapidez: 0.5,
      pose(T, t, P, m, a) {
        const e = entrada(t, 1.2);
        T.bodyY = sin(t * 0.9) * 7 + 6 * e; T.headPitch = 0.3 * e; T.headRot = 9 * e;
        brazo(T, 'L', 6, -4, 2); brazo(T, 'R', 6, -4, 2);
        gesto(T, 'L', 'relajada'); gesto(T, 'R', 'relajada');
        emitirCada(a, 'z', 1.1, t + 0.6, () => m.fx.particula('z', 300, 170, { vx: 12, vy: -24 }));
      }
    },

    despertar: {
      dur: 2.2, expr: 'sorpresa',
      pose(T, t) {
        const e = t < 1.3 ? entrada(t, 0.4) : 1 - smooth(1.3, 2.0, t);
        brazo(T, 'L', lerp(12, 128, e), lerp(-10, 32, e), 5); brazo(T, 'R', lerp(12, 128, e), lerp(-10, 32, e), 5);
        gesto(T, 'L', 'abierta', e); gesto(T, 'R', 'abierta', e);
        T.bodySY = 1 + 0.03 * e; T.headPitch = -0.18 * e;
        if (t > 1.1) N.aplicarExpresion(T, 'feliz');
      }
    },

    bailar: {
      dur: 4.5, expr: 'feliz', rapidez: 1.7,
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.3), s = sin(t * 6.2);
        brazo(T, 'L', 95 + s * 40 * e, 60 - s * 30, 0); brazo(T, 'R', 95 - s * 40 * e, 60 + s * 30, 0);
        gesto(T, 'L', 'paz'); gesto(T, 'R', 'paz');
        T.bodyRot = s * 6 * e; T.bodyX = s * 6 * e; T.bodyY = -abs(sin(t * 6.2)) * 9 * e; T.headRot = sin(t * 6.2 + 0.5) * 9 * e;
        emitirCada(a, 'nota', 0.45, t, () => m.fx.particula('nota', 100 + Math.random() * 240, 190, { vy: -30 }));
      }
    },

    progreso: {
      dur: null, expr: 'sonrisa',
      pose(T, t, P, m, a) {
        const e = entrada(t, 0.4);
        brazo(T, 'L', lerp(12, 8, e), lerp(-10, -62, e), lerp(4, 68, e), lerp(1, 0.7, e));
        brazo(T, 'R', lerp(12, 8, e), lerp(-10, -62, e), lerp(4, 68, e), lerp(1, 0.7, e));
        gesto(T, 'L', 'agarrar', e); gesto(T, 'R', 'agarrar', e);
        T.Lhy = lerp(1, 0.8, e); T.Rhy = lerp(1, 0.8, e);
        T.headPitch = 0.2 * e; T.lookY = 0.6 * e; T.headRot = 3 * e;
        m.fx.want.tableta = 1;
        if (a.estado.completo) {
          N.aplicarExpresion(T, 'feliz');
          if (m.t > a.estado.completo + (P.mantener != null ? P.mantener / 1000 : 1.6)) a.hecho = true;
        }
      }
    },

    // ----- internas -----
    _gestos: {
      pose(T, t) {
        brazo(T, 'R', 34 + osc(t, 2.1, 10), 72 + osc(t, 3.1, 16), osc(t, 2.4, 14));
        gesto(T, 'R', 'abierta', 0.8);
        brazo(T, 'L', 14 + osc(t, 1.7, 5), -14 + osc(t, 2.2, 10), 4);
        T.headPitch += osc(t, 4.3, 0.06); T.headRot += osc(t, 1.9, 2.5);
      }
    },
    _agarrado: {
      pose(T, t) {
        brazo(T, 'L', 48 + osc(t, 11, 10), 30 + osc(t, 9, 14), 0);
        brazo(T, 'R', 48 + osc(t, 11, 10, 2), 30 + osc(t, 9, 14, 1), 0);
        gesto(T, 'L', 'abierta'); gesto(T, 'R', 'abierta');
        N.aplicarExpresion(T, 'sorpresa', 0.6); T.mouthSmile = 0.6;
      }
    },
    _manual: { dur: null, pose() {} }
  };

  N.ACCION_ALIAS = {
    reir: 'reir', saludar: 'saludar', pensar: 'pensar', textear: 'textear', trabajar: 'trabajar', analizar: 'analizar',
    herramientas: 'herramientas', escuchar: 'escuchar', aclarar: 'aclarar', senalar: 'senalar', asentir: 'asentir',
    negar: 'negar', celebrar: 'celebrar', sorpresa: 'sorpresa', confundido: 'confundido', dormir: 'dormir',
    despertar: 'despertar', bailar: 'bailar', progreso: 'progreso', reposo: 'reposo'
  };
})();
