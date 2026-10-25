/* ==========================================================================
   Noviq Avatar — Efectos holográficos: circuitos, paneles de datos,
   herramientas que emergen de la cabeza, teclado, panel de trabajo,
   tableta de progreso, ondas de sonido y partículas.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});
  const { lerp, clamp, smooth, r2, r3 } = N.util;
  const NS = 'http://www.w3.org/2000/svg';
  const CX = 220, CY = 232, RX = 108, RY = 103;

  function el(tag, attrs, padre) {
    const e = document.createElementNS(NS, tag);
    for (const k in attrs) e.setAttribute(k, attrs[k]);
    if (padre) padre.appendChild(e);
    return e;
  }

  // Iconos de herramientas (trazos en caja 24x24)
  function engranaje() {
    let d = '';
    const n = 8;
    for (let i = 0; i < n * 2; i++) {
      const a0 = (i / (n * 2)) * Math.PI * 2, a1 = ((i + 1) / (n * 2)) * Math.PI * 2;
      const r = i % 2 ? 7.2 : 9.6;
      const p0 = [12 + Math.cos(a0) * r, 12 + Math.sin(a0) * r], p1 = [12 + Math.cos(a1) * r, 12 + Math.sin(a1) * r];
      d += (i === 0 ? 'M' : 'L') + r2(p0[0]) + ',' + r2(p0[1]) + ' L' + r2(p1[0]) + ',' + r2(p1[1]) + ' ';
    }
    return d + 'Z M15.2,12 A3.2,3.2 0 1 1 8.8,12 A3.2,3.2 0 1 1 15.2,12';
  }
  N.ICONOS = {
    engranaje: engranaje(),
    llave: 'M14.5,4.5 A4.5,4.5 0 0 0 9.8,10.6 L3.8,16.6 L7.4,20.2 L13.4,14.2 A4.5,4.5 0 0 0 19.5,9.5 L16.6,12.4 L14.2,11.8 L13.6,9.4 Z',
    codigo: 'M8,7 L3,12 L8,17 M16,7 L21,12 L16,17 M14,4.5 L10,19.5',
    terminal: 'M3.5,5 H20.5 V19 H3.5 Z M7,10 L10,12.5 L7,15 M12,15.5 H17',
    lupa: 'M16.2,10.4 A5.8,5.8 0 1 1 4.6,10.4 A5.8,5.8 0 1 1 16.2,10.4 M14.6,14.6 L20.5,20.5',
    grafico: 'M4,20 H20 M7,17 V12 M12,17 V6.5 M17,17 V9.5',
    base_datos: 'M5,6 C5,3.8 19,3.8 19,6 C19,8.2 5,8.2 5,6 M5,6 V18 C5,20.2 19,20.2 19,18 V6 M5,12 C5,14.2 19,14.2 19,12',
    chip: 'M7,7 H17 V17 H7 Z M10,10 H14 V14 H10 Z M9.5,3.5 V7 M14.5,3.5 V7 M9.5,17 V20.5 M14.5,17 V20.5 M3.5,9.5 H7 M3.5,14.5 H7 M17,9.5 H20.5 M17,14.5 H20.5',
    nube: 'M7,18 H17 A4,4 0 0 0 17.5,10 A5.5,5.5 0 0 0 6.9,11.5 A3.3,3.3 0 0 0 7,18 Z',
    documento: 'M7,3 H14 L18,7 V21 H7 Z M14,3 V7 H18 M9.5,12 H15.5 M9.5,15.5 H15.5',
    rayo: 'M13,2.5 L5,13 H11 L10,21.5 L18.5,11 H12.5 Z',
    carpeta: 'M3,6.5 H9 L11,8.5 H21 V19 H3 Z',
    web: 'M21,12 A9,9 0 1 1 3,12 A9,9 0 1 1 21,12 M3,12 H21 M12,3 C15.5,6 15.5,18 12,21 M12,3 C8.5,6 8.5,18 12,21',
    escudo: 'M12,3 L19,6 V11 C19,16 15.5,19 12,21 C8.5,19 5,16 5,11 V6 Z M9,12 L11.2,14.2 L15.5,9.8',
    mensaje: 'M4,5 H20 V16 H9 L4,20 Z M8,9.5 H16 M8,12.5 H13',
    red: 'M12,4 A2,2 0 1 1 11.99,4 M5,18 A2,2 0 1 1 4.99,18 M19,18 A2,2 0 1 1 18.99,18 M12,6 L12,11 L5.5,16.2 M12,11 L18.5,16.2',
    camara: 'M4,8 H8 L9.5,5.5 H14.5 L16,8 H20 V19 H4 Z M15.5,13 A3.5,3.5 0 1 1 8.5,13 A3.5,3.5 0 1 1 15.5,13',
    microfono: 'M9,5 A3,3 0 0 1 15,5 V11 A3,3 0 0 1 9,11 Z M6,11 A6,6 0 0 0 18,11 M12,17 V21 M9,21 H15',
    musica: 'M9,18 V5.5 L19,3.5 V16 M9,18 A2.5,2.5 0 1 1 8.99,18 M19,16 A2.5,2.5 0 1 1 18.99,16',
    reloj: 'M21,12 A9,9 0 1 1 3,12 A9,9 0 1 1 21,12 M12,7 V12 L15.5,14',
    candado: 'M6,11 H18 V20 H6 Z M8.5,11 V8 A3.5,3.5 0 0 1 15.5,8 V11 M12,14.5 V16.5',
    ok: 'M4.5,12.5 L9.5,17.5 L19.5,7'
  };
  N.ICONO_ALIAS = {
    engranaje: 'engranaje', ajustes: 'engranaje', config: 'engranaje', configuracion: 'engranaje', gear: 'engranaje', settings: 'engranaje',
    llave: 'llave', herramienta: 'llave', reparar: 'llave', wrench: 'llave', tool: 'llave',
    codigo: 'codigo', code: 'codigo', programar: 'codigo', terminal: 'terminal', consola: 'terminal', cmd: 'terminal',
    lupa: 'lupa', buscar: 'lupa', search: 'lupa', grafico: 'grafico', estadisticas: 'grafico', chart: 'grafico',
    base_datos: 'base_datos', basededatos: 'base_datos', bd: 'base_datos', database: 'base_datos', db: 'base_datos',
    chip: 'chip', cpu: 'chip', procesador: 'chip', hardware: 'chip', nube: 'nube', cloud: 'nube',
    documento: 'documento', archivo: 'documento', doc: 'documento', file: 'documento', rayo: 'rayo', energia: 'rayo', bolt: 'rayo',
    carpeta: 'carpeta', folder: 'carpeta', web: 'web', internet: 'web', globo: 'web', escudo: 'escudo', seguridad: 'escudo', security: 'escudo',
    mensaje: 'mensaje', chat: 'mensaje', red: 'red', network: 'red', camara: 'camara', camera: 'camara',
    microfono: 'microfono', mic: 'microfono', musica: 'musica', music: 'musica', reloj: 'reloj', tiempo: 'reloj', clock: 'reloj',
    candado: 'candado', lock: 'candado', ok: 'ok', check: 'ok', listo: 'ok'
  };
  N.resolverIcono = (n) => {
    const k = String(n || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim().replace(/[\s-]+/g, '_');
    return N.ICONO_ALIAS[k] || (N.ICONOS[k] ? k : null);
  };
  const HERR_DEF = ['engranaje', 'llave', 'codigo', 'lupa', 'grafico', 'base_datos', 'chip'];

  // Generador pseudoaleatorio estable
  function rng(seed) { let s = seed; return () => (s = (s * 16807) % 2147483647) / 2147483647; }

  class Efectos {
    constructor(svg) {
      this.svg = svg;
      const g = (id) => svg.getElementById(id);
      this.gCab = g('fxCabeza'); this.gMedio = g('fxMedio'); this.gFrente = g('fxFrente'); this.gPart = g('particulas');
      this.gIconoVisor = g('iconoVisor');
      this.v = { circuitos: 0, paneles: 0, herramientas: 0, teclado: 0, panelTrabajo: 0, tableta: 0, ondas: 0, ondasHabla: 0 };
      this.want = Object.assign({}, this.v);
      this.parts = [];
      this.progresoTrabajo = 0;
      this.progreso = { valor: 0, mostrado: 0, etiqueta: 'Procesando', completo: false };
      this.construirCircuitos();
      this.construirPaneles();
      this.gHerr = el('g', {}, this.gCab);
      this.herr = [];
      this.construirTeclado();
      this.construirPanelTrabajo();
      this.construirTableta();
      this.ondas = { L: [0, 1, 2].map((i) => g('ondaL' + i)), R: [0, 1, 2].map((i) => g('ondaR' + i)) };
      this.setHerramientas();
      this.iconoVisorNombre = null;
    }

    resetWant() { for (const k in this.want) this.want[k] = 0; }

    /* ---------------------------------------------- Circuitos desde la cabeza */
    construirCircuitos() {
      const R = rng(7);
      this.gCirc = el('g', { opacity: 0 }, this.gCab);
      this.trazas = [];
      const angulos = [-172, -156, -140, -124, -108, -92, -76, -60, -44, -28, -12, 8, 172, 190];
      angulos.forEach((deg, i) => {
        const a = (deg * Math.PI) / 180;
        const x0 = CX + Math.cos(a) * RX * 0.9, y0 = CY + Math.sin(a) * RY * 0.9;
        const l1 = 26 + R() * 22;
        const x1 = CX + Math.cos(a) * (RX + l1), y1 = CY + Math.sin(a) * (RY + l1);
        let x2, y2;
        const lateral = Math.abs(Math.cos(a)) > 0.72;
        if (lateral) { x2 = x1 + Math.sign(Math.cos(a)) * (14 + R() * 26); y2 = y1; }
        else { x2 = x1; y2 = y1 - (12 + R() * 30); }
        const x3 = clamp(x2, 8, 432), y3 = clamp(y2, 8, 590);
        const d = `M${r2(x0)},${r2(y0)} L${r2(x1)},${r2(y1)} L${r2(x3)},${r2(y3)}`;
        const p = el('path', { d, fill: 'none', stroke: '#6ff0ff', 'stroke-width': 1.8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round',
          pathLength: 1, 'stroke-dasharray': '1 1', 'stroke-dashoffset': 1, filter: 'url(#fBrillo)' }, this.gCirc);
        const nodo = el('circle', { cx: r2(x3), cy: r2(y3), r: 3.4, fill: '#07152e', stroke: '#8ff7ff', 'stroke-width': 1.6, opacity: 0 }, this.gCirc);
        const chispa = el('circle', { r: 2.2, fill: '#e9ffff', opacity: 0 }, this.gCirc);
        this.trazas.push({ p, nodo, chispa, retardo: R() * 0.35, vel: 0.5 + R() * 0.7, fase: R() });
      });
    }

    construirPaneles() {
      this.gPan = el('g', { opacity: 0 }, this.gCab);
      const defs = [[6, 150, 76, 44], [2, 262, 70, 40], [358, 140, 78, 46], [366, 256, 70, 42]];
      this.paneles = defs.map(([x, y, w, h], i) => {
        const g = el('g', {}, this.gPan);
        el('rect', { x, y, width: w, height: h, rx: 5, fill: 'url(#gHolo)', stroke: '#6fe9ff', 'stroke-width': 1.1 }, g);
        el('rect', { x: x + 4, y: y + 4, width: w * 0.45, height: 3, rx: 1.5, fill: '#9ff6ff', opacity: 0.9 }, g);
        const barras = [];
        if (i % 2 === 0) {
          for (let b = 0; b < 3; b++) barras.push(el('rect', { x: x + 4, y: y + 12 + b * 8, width: w - 8, height: 3, rx: 1.5, fill: '#56d8ff', opacity: 0.7 }, g));
        } else {
          for (let b = 0; b < 7; b++) barras.push(el('rect', { x: x + 6 + b * ((w - 12) / 7), y: y + 12, width: (w - 12) / 7 - 2, height: h - 16, fill: '#56d8ff', opacity: 0.7 }, g));
        }
        const onda = el('path', { d: '', fill: 'none', stroke: '#c9ffff', 'stroke-width': 1.2, opacity: 0.8 }, g);
        return { g, x, y, w, h, barras, onda, tipo: i % 2 };
      });
    }

    setHerramientas(lista) {
      let nombres = Array.isArray(lista) ? lista : (typeof lista === 'string' && lista ? lista.split(',') : HERR_DEF);
      nombres = nombres.map((n) => N.resolverIcono(n) || 'engranaje').slice(0, 9);
      while (this.gHerr.firstChild) this.gHerr.removeChild(this.gHerr.firstChild);
      const n = nombres.length;
      this.herr = nombres.map((nombre, i) => {
        const a0 = -168, a1 = -12;
        const deg = n === 1 ? -90 : a0 + ((a1 - a0) * i) / (n - 1);
        const a = (deg * Math.PI) / 180;
        const tx = CX + Math.cos(a) * 176, ty = CY + Math.sin(a) * 152;
        const linea = el('path', { d: '', fill: 'none', stroke: '#6ff0ff', 'stroke-width': 1.5, 'stroke-dasharray': '3 3', opacity: 0.8 }, this.gHerr);
        const g = el('g', {}, this.gHerr);
        el('circle', { r: 21, fill: '#071a36', opacity: 0.92 }, g);
        el('circle', { r: 21, fill: 'none', stroke: '#6ff0ff', 'stroke-width': 2, filter: 'url(#fBrillo)' }, g);
        el('circle', { r: 16.5, fill: 'none', stroke: '#2f8fd0', 'stroke-width': 1, opacity: 0.8 }, g);
        const ico = el('g', { transform: 'translate(-12,-12)' }, g);
        el('path', { d: N.ICONOS[nombre], fill: 'none', stroke: '#b8fcff', 'stroke-width': 1.9, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#fBrillo)' }, ico);
        return { g, ico, linea, tx, ty, a, nombre, retardo: i * 0.09 };
      });
    }

    setIconoVisor(nombre) {
      const k = N.resolverIcono(nombre) || 'engranaje';
      if (k === this.iconoVisorNombre) return;
      this.iconoVisorNombre = k;
      const g = this.gIconoVisor;
      while (g.firstChild) g.removeChild(g.firstChild);
      const w = el('g', { transform: 'scale(3.1) translate(-12,-12)' }, g);
      el('path', { d: N.ICONOS[k], fill: 'none', stroke: '#9ff6ff', 'stroke-width': 1.7, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', filter: 'url(#fBrillo)' }, w);
      this.iconoVisorRot = k === 'engranaje';
    }

    /* ---------------------------------------------------- Teclado holográfico */
    construirTeclado() {
      this.gTec = el('g', { opacity: 0 }, this.gMedio);
      const y0 = 466, y1 = 502;
      el('path', { d: `M150,${y0} L290,${y0} L312,${y1} L128,${y1} Z`, fill: 'url(#gHolo)', stroke: '#72ecff', 'stroke-width': 1.3, filter: 'url(#fBrillo)' }, this.gTec);
      this.teclas = [];
      const filas = 3, cols = 10;
      for (let f = 0; f < filas; f++) {
        const ya = y0 + 4 + f * 10.5, yb = ya + 8;
        const ka = (ya - y0) / (y1 - y0), kb = (yb - y0) / (y1 - y0);
        const xa0 = lerp(154, 132, ka), xa1 = lerp(286, 308, ka), xb0 = lerp(154, 132, kb), xb1 = lerp(286, 308, kb);
        for (let c = 0; c < cols; c++) {
          const u0 = (c + 0.1) / cols, u1 = (c + 0.9) / cols;
          const d = `M${r2(lerp(xa0, xa1, u0))},${r2(ya)} L${r2(lerp(xa0, xa1, u1))},${r2(ya)} L${r2(lerp(xb0, xb1, u1))},${r2(yb)} L${r2(lerp(xb0, xb1, u0))},${r2(yb)} Z`;
          const k = el('path', { d, fill: '#8ff7ff', opacity: 0.18 }, this.gTec);
          this.teclas.push({ el: k, brillo: 0 });
        }
      }
    }
    pulsarTecla() {
      const k = this.teclas[(Math.random() * this.teclas.length) | 0];
      k.brillo = 1;
    }

    /* ------------------------------------------------------ Panel de trabajo */
    construirPanelTrabajo() {
      const g = (this.gTrab = el('g', { opacity: 0 }, this.gMedio));
      el('path', { d: 'M132,468 L308,468 L330,528 L110,528 Z', fill: 'url(#gHolo)', stroke: '#72ecff', 'stroke-width': 1.3, filter: 'url(#fBrillo)' }, g);
      // deslizadores
      this.desl = [];
      for (let i = 0; i < 3; i++) {
        const x = 136 + i * 13;
        el('line', { x1: x, y1: 478, x2: x - 3, y2: 520, stroke: '#5fd8ff', 'stroke-width': 2, opacity: 0.8 }, g);
        this.desl.push({ el: el('rect', { x: x - 6, y: 492, width: 10, height: 5, rx: 2, fill: '#c9ffff' }, g), x });
      }
      // perilla
      el('circle', { cx: 196, cy: 500, r: 13, fill: '#0a2448', stroke: '#72ecff', 'stroke-width': 1.6 }, g);
      this.perilla = el('line', { x1: 196, y1: 500, x2: 196, y2: 489, stroke: '#e9ffff', 'stroke-width': 2.2, 'stroke-linecap': 'round' }, g);
      // radar
      el('circle', { cx: 244, cy: 498, r: 17, fill: 'none', stroke: '#72ecff', 'stroke-width': 1.3 }, g);
      el('circle', { cx: 244, cy: 498, r: 9, fill: 'none', stroke: '#3aa8e0', 'stroke-width': 1 }, g);
      this.radar = el('line', { x1: 244, y1: 498, x2: 244, y2: 481, stroke: '#c9ffff', 'stroke-width': 1.8 }, g);
      this.blip = el('circle', { cx: 250, cy: 490, r: 2, fill: '#e9ffff' }, g);
      // progreso
      el('text', { x: 274, y: 488, 'font-family': 'Consolas, monospace', 'font-size': 7, fill: '#b8fcff', 'letter-spacing': 0.5 }, g).textContent = 'DATA';
      el('rect', { x: 272, y: 505, width: 44, height: 7, rx: 3.5, fill: 'none', stroke: '#72ecff', 'stroke-width': 1 }, g);
      this.barTrab = el('rect', { x: 273.5, y: 506.5, width: 0, height: 4, rx: 2, fill: '#8ff7ff' }, g);
      this.pctTrab = el('text', { x: 274, y: 499, 'font-family': 'Consolas, monospace', 'font-size': 8, fill: '#e9ffff', 'font-weight': 700 }, g);
    }

    /* ------------------------------------------------------ Tableta progreso */
    construirTableta() {
      const g = (this.gTab = el('g', { opacity: 0 }, this.gMedio));
      this.gTabIn = el('g', { transform: 'translate(220,428)' }, g);
      const t = this.gTabIn;
      el('rect', { x: -76, y: -32, width: 152, height: 64, rx: 8, fill: '#071a36', opacity: 0.7 }, t);
      el('rect', { x: -76, y: -32, width: 152, height: 64, rx: 8, fill: 'url(#gHolo)', stroke: '#72ecff', 'stroke-width': 1.5, filter: 'url(#fBrillo)' }, t);
      this.tabEtiqueta = el('text', { x: 0, y: -14, 'text-anchor': 'middle', 'font-family': 'Segoe UI, system-ui, sans-serif', 'font-size': 10.5, fill: '#cffaff', 'font-weight': 600 }, t);
      el('rect', { x: -58, y: -3, width: 116, height: 10, rx: 5, fill: '#0a2448', stroke: '#5fd8ff', 'stroke-width': 1 }, t);
      this.tabBarra = el('rect', { x: -56.5, y: -1.5, width: 0, height: 7, rx: 3.5, fill: '#8ff7ff', filter: 'url(#fBrillo)' }, t);
      this.tabPct = el('text', { x: 0, y: 23, 'text-anchor': 'middle', 'font-family': 'Consolas, monospace', 'font-size': 13, fill: '#e9ffff', 'font-weight': 700 }, t);
      this.tabCheck = el('path', { d: 'M24,17 L29,22 L38,13', fill: 'none', stroke: '#8ff7ff', 'stroke-width': 2.6, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', opacity: 0 }, t);
    }
    setProgreso(valor, etiqueta) {
      const v = clamp(Number(valor) || 0, 0, 100);
      this.progreso.valor = v;
      if (etiqueta != null) this.progreso.etiqueta = String(etiqueta).slice(0, 24);
      this.progreso.completo = v >= 100;
    }

    /* ------------------------------------------------------------ Partículas */
    particula(tipo, x, y, o) {
      o = o || {};
      let e;
      const color = '#9ff6ff';
      if (tipo === 'ja' || tipo === 'z' || tipo === 'excl' || tipo === 'preg' || tipo === 'nota') {
        const txt = { ja: 'JA', z: 'Z', excl: '!', preg: '?', nota: Math.random() < 0.5 ? '♪' : '♫' }[tipo];
        const size = { ja: 17, z: 18, excl: 34, preg: 30, nota: 22 }[tipo];
        e = el('text', { x: 0, y: 0, 'text-anchor': 'middle', 'dominant-baseline': 'middle', 'font-family': 'Segoe UI, system-ui, sans-serif',
          'font-weight': 800, 'font-size': size, fill: color, stroke: '#0a2448', 'stroke-width': 2.5, style: 'paint-order:stroke', filter: 'url(#fBrillo)' }, this.gPart);
        e.textContent = txt;
      } else {
        e = el('path', { d: 'M0,-7 L1.8,-1.8 L7,0 L1.8,1.8 L0,7 L-1.8,1.8 L-7,0 L-1.8,-1.8 Z', fill: '#d9ffff', filter: 'url(#fBrillo)' }, this.gPart);
      }
      const vida = o.vida || { ja: 1.2, z: 2.4, excl: 1.4, preg: 1.8, nota: 1.8 }[tipo] || 1;
      this.parts.push({ e, tipo, x, y, vx: o.vx != null ? o.vx : (Math.random() - 0.5) * 30, vy: o.vy != null ? o.vy : -40 - Math.random() * 20,
        vida, edad: 0, escala: o.escala || 1, rot: (Math.random() - 0.5) * 30 });
      if (this.parts.length > 60) { const p = this.parts.shift(); p.e.remove(); }
    }

    /* ----------------------------------------------------------------- Frame */
    frame(dt, t, p) {
      const v = this.v, w = this.want;
      for (const k in v) {
        const vel = w[k] > v[k] ? 3.2 : 4.5;
        v[k] = lerp(v[k], w[k], 1 - Math.exp(-vel * dt));
        if (Math.abs(v[k] - w[k]) < 0.002) v[k] = w[k];
      }

      // Circuitos
      if (v.circuitos > 0.003) {
        this.gCirc.style.display = '';
        this.gCirc.setAttribute('opacity', r3(Math.min(1, v.circuitos * 1.5)));
        for (const tr of this.trazas) {
          const k = clamp((v.circuitos * 1.5 - tr.retardo) / 0.7, 0, 1);
          tr.p.setAttribute('stroke-dashoffset', r3(1 - k));
          tr.nodo.setAttribute('opacity', r3(smooth(0.85, 1, k)));
          if (k > 0.98) {
            const u = (t * tr.vel + tr.fase) % 1;
            const L = tr.p.getTotalLength();
            const pt = tr.p.getPointAtLength(u * L);
            tr.chispa.setAttribute('cx', r2(pt.x)); tr.chispa.setAttribute('cy', r2(pt.y));
            tr.chispa.setAttribute('opacity', r3(Math.sin(u * Math.PI)));
          } else tr.chispa.setAttribute('opacity', 0);
        }
      } else this.gCirc.style.display = 'none';

      // Paneles de datos
      if (v.paneles > 0.003) {
        this.gPan.style.display = '';
        this.gPan.setAttribute('opacity', r3(smooth(0.3, 1, v.paneles)));
        this.paneles.forEach((pn, i) => {
          const s = 0.6 + 0.4 * smooth(0.3, 1, v.paneles);
          const cx = pn.x + pn.w / 2, cy = pn.y + pn.h / 2;
          pn.g.setAttribute('transform', `translate(${cx} ${cy}) scale(${r3(s)}) translate(${-cx} ${-cy})`);
          if (pn.tipo === 0) {
            pn.barras.forEach((b, j) => b.setAttribute('width', r2((pn.w - 8) * (0.35 + 0.6 * Math.abs(Math.sin(t * (1.3 + j * 0.7) + i + j))))));
          } else {
            pn.barras.forEach((b, j) => {
              const hh = (pn.h - 16) * (0.2 + 0.8 * Math.abs(Math.sin(t * 2.1 + j * 0.9 + i)));
              b.setAttribute('y', r2(pn.y + pn.h - 4 - hh)); b.setAttribute('height', r2(hh));
            });
          }
          if (pn.tipo === 0) {
            let d = '';
            for (let q = 0; q <= 16; q++) {
              const x = pn.x + 4 + (q / 16) * (pn.w - 8);
              const y = pn.y + pn.h - 7 + Math.sin(q * 0.9 + t * 5 + i) * 3;
              d += (q ? 'L' : 'M') + r2(x) + ',' + r2(y);
            }
            pn.onda.setAttribute('d', d);
          }
        });
      } else this.gPan.style.display = 'none';

      // Herramientas
      if (v.herramientas > 0.003) {
        this.gHerr.style.display = '';
        const orb = Math.sin(t * 0.45) * 0.06;
        this.herr.forEach((h, i) => {
          const k = clamp((v.herramientas * 1.3 - h.retardo) / 0.75, 0, 1);
          const e = 1 - Math.pow(1 - k, 3);
          const a = h.a + orb;
          const tx = CX + Math.cos(a) * 176, ty = CY + Math.sin(a) * 152 + Math.sin(t * 2 + i) * 3;
          const x = lerp(CX, tx, e), y = lerp(CY - 20, ty, e);
          h.g.setAttribute('transform', `translate(${r2(x)},${r2(y)}) scale(${r3(0.25 + 0.75 * e)})`);
          h.g.setAttribute('opacity', r3(smooth(0, 0.35, k)));
          if (h.nombre === 'engranaje') h.ico.setAttribute('transform', `rotate(${r2(t * 60)}) translate(-12,-12)`);
          const x0 = CX + Math.cos(a) * RX * 0.95, y0 = CY + Math.sin(a) * RY * 0.95;
          h.linea.setAttribute('d', `M${r2(x0)},${r2(y0)} L${r2(lerp(x0, x, 0.55))},${r2(lerp(y0, y, 0.55))} L${r2(x)},${r2(y)}`);
          h.linea.setAttribute('opacity', r3(0.8 * e));
        });
      } else this.gHerr.style.display = 'none';

      // Icono en el visor
      if (p.visorIcon > 0.01 && this.iconoVisorRot) {
        const w0 = this.gIconoVisor.firstChild;
        if (w0) w0.setAttribute('transform', `rotate(${r2(t * 50)}) scale(3.1) translate(-12,-12)`);
      }

      // Teclado
      if (v.teclado > 0.003) {
        this.gTec.style.display = '';
        this.gTec.setAttribute('opacity', r3(v.teclado));
        for (const k of this.teclas) {
          k.brillo = Math.max(0, k.brillo - dt * 5);
          k.el.setAttribute('opacity', r3(0.16 + 0.84 * k.brillo));
        }
      } else this.gTec.style.display = 'none';

      // Panel de trabajo
      if (v.panelTrabajo > 0.003) {
        this.gTrab.style.display = '';
        this.gTrab.setAttribute('opacity', r3(v.panelTrabajo));
        this.desl.forEach((s, i) => s.el.setAttribute('y', r2(488 + Math.sin(t * (1.7 + i * 0.6) + i) * 11)));
        const ang = Math.sin(t * 2.3 + 1) * 70;
        const rad = (ang - 90) * Math.PI / 180;
        this.perilla.setAttribute('x2', r2(196 + Math.cos(rad) * 11)); this.perilla.setAttribute('y2', r2(500 + Math.sin(rad) * 11));
        const ra = t * 3.2;
        this.radar.setAttribute('x2', r2(244 + Math.cos(ra) * 17)); this.radar.setAttribute('y2', r2(498 + Math.sin(ra) * 17));
        this.blip.setAttribute('opacity', r3(0.3 + 0.7 * Math.abs(Math.sin(t * 2))));
        const pr = this.progresoTrabajo;
        this.barTrab.setAttribute('width', r2(41 * pr));
        this.pctTrab.textContent = Math.round(pr * 100) + '%';
      } else this.gTrab.style.display = 'none';

      // Tableta de progreso
      if (v.tableta > 0.003) {
        this.gTab.style.display = '';
        const s = 0.7 + 0.3 * v.tableta;
        this.gTab.setAttribute('opacity', r3(v.tableta));
        this.gTab.setAttribute('transform', `translate(220 428) scale(${r3(s)}) translate(-220 -428)`);
        const pr = this.progreso;
        pr.mostrado = lerp(pr.mostrado, pr.valor, 1 - Math.exp(-6 * dt));
        this.tabBarra.setAttribute('width', r2(113 * pr.mostrado / 100));
        this.tabPct.textContent = Math.round(pr.mostrado) + '%';
        this.tabEtiqueta.textContent = pr.etiqueta;
        this.tabCheck.setAttribute('opacity', pr.completo && pr.mostrado > 99 ? 1 : 0);
      } else { this.gTab.style.display = 'none'; this.progreso.mostrado = 0; }

      // Ondas de sonido (escuchar / hablar)
      const on = Math.max(v.ondas, v.ondasHabla * 0.7);
      for (const lado of ['L', 'R']) {
        this.ondas[lado].forEach((o, i) => {
          if (on < 0.01) { o.setAttribute('opacity', 0); return; }
          const u = (t * (v.ondas > v.ondasHabla ? 0.9 : 1.6) + i / 3) % 1;
          const sg = lado === 'L' ? -1 : 1;
          o.setAttribute('transform', `translate(${r2(sg * u * 26)},0) scale(${r3(0.7 + u * 0.9)})`);
          o.setAttribute('opacity', r3(on * Math.sin(u * Math.PI) * 0.95));
        });
      }

      // Partículas
      for (let i = this.parts.length - 1; i >= 0; i--) {
        const q = this.parts[i];
        q.edad += dt;
        const k = q.edad / q.vida;
        if (k >= 1) { q.e.remove(); this.parts.splice(i, 1); continue; }
        q.x += q.vx * dt; q.y += q.vy * dt;
        if (q.tipo === 'z') q.x += Math.sin(q.edad * 3) * 0.6;
        const s = q.escala * (q.tipo === 'chispa' ? Math.sin(k * Math.PI) * 1.2 : 0.6 + 0.4 * smooth(0, 0.2, k) + k * 0.3);
        const op = smooth(0, 0.12, k) * (1 - smooth(0.6, 1, k));
        q.e.setAttribute('transform', `translate(${r2(q.x)},${r2(q.y)}) rotate(${r2(q.rot * k)}) scale(${r3(s)})`);
        q.e.setAttribute('opacity', r3(op));
      }
    }
  }
  N.Efectos = Efectos;
})();
