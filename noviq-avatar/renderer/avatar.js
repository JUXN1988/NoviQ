/* ==========================================================================
   Noviq Avatar — Rig vectorial (SVG por partes articuladas)
   Escena lógica de 440 x 600 unidades. El robot se dibuja por piezas para
   que cada articulación (cabeza, hombros, codos, muñecas, dedos, ojos, boca)
   pueda animarse de forma independiente.
   ========================================================================== */
(function () {
  'use strict';
  const N = (window.N = window.N || {});

  const G = (N.G = {
    ancho: 440, alto: 600, CX: 220,
    pivCabeza: [220, 326],     // pivote del cuello
    centroCabeza: [220, 232],
    hombroY: 356, hombroL: 147, hombroR: 293,
    lBrazo: 58, lAnte: 52,
    ojoL: [185, 238], ojoR: [255, 238], boca: [220, 276]
  });

  const r2 = (n) => Math.round(n * 100) / 100;
  const r3 = (n) => Math.round(n * 1000) / 1000;
  const lerp = (a, b, t) => a + (b - a) * t;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const smooth = (e0, e1, x) => { const t = clamp((x - e0) / (e1 - e0), 0, 1); return t * t * (3 - 2 * t); };
  N.util = { r2, r3, lerp, clamp, smooth };

  /* ---------------------------------------------------------------- Formas */
  const LARGO_DEDOS = [19, 21, 19, 15];            // índice, medio, anular, meñique
  const TRAZO = '#2c5f93';

  function dedo(S, i, x, len) {
    const a = len * 0.55, b = len * 0.45;
    return `<g id="d${S}${i}" transform="translate(${x},33)">
      <rect x="-3.2" y="-2" width="6.4" height="${r2(a + 3)}" rx="3.2" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".7"/>
      <g id="dd${S}${i}" transform="translate(0,${r2(a)})">
        <circle r="2.7" fill="url(#gJunta)"/>
        <rect x="-2.9" y="1.2" width="5.8" height="${r2(b)}" rx="2.9" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".7"/>
        <rect x="-1.1" y="${r2(b - 3.2)}" width="2.2" height="2.6" rx="1.1" fill="#8ff7ff"/>
      </g>
    </g>`;
  }

  function mano(S) {
    const ts = S === 'L' ? -1 : 1;                   // lado del pulgar (hacia afuera)
    let dedos = '';
    for (let i = 0; i < 4; i++) dedos += dedo(S, i, r2(ts * (10.5 - 7 * i)), LARGO_DEDOS[i]);
    return `
      <g id="pu${S}" transform="translate(${ts * 12},12)">
        <rect x="-3.5" y="-2" width="7" height="12" rx="3.5" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".7"/>
        <g transform="translate(0,10)">
          <circle r="2.7" fill="url(#gJunta)"/>
          <rect x="-3.1" y="1.2" width="6.2" height="9" rx="3.1" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".7"/>
          <rect x="-1.1" y="6.8" width="2.2" height="2.6" rx="1.1" fill="#8ff7ff"/>
        </g>
      </g>
      ${dedos}
      <path d="M-13.5,4 Q-13.5,1.5 -10.5,1.5 L10.5,1.5 Q13.5,1.5 13.5,4 L15.5,28 Q15.5,34 10,34 L-10,34 Q-15.5,34 -15.5,28 Z"
            fill="url(#gCasco2)" stroke="${TRAZO}" stroke-width=".9"/>
      <path d="M-8,9 L-8,23 M8,9 L8,23" stroke="#5aa9d8" stroke-width="1.4" stroke-linecap="round" opacity=".7"/>
      <rect x="-2.2" y="11" width="4.4" height="11" rx="2.2" fill="#7ef3ff" opacity=".9"/>
      <rect x="-15" y="29.5" width="30" height="6.5" rx="3.2" fill="url(#gJunta)"/>
      <circle r="9" fill="url(#gJunta)"/>
      <circle r="3" fill="#7ff3ff"/>`;
  }

  function brazo(S) {
    const x = S === 'L' ? G.hombroL : G.hombroR;
    return `<g id="brazo${S}" data-hit="1" transform="translate(${x},${G.hombroY})">
      <g id="hu${S}">
        <rect x="-12.5" y="4" width="25" height="${G.lBrazo}" rx="12.5" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".9"/>
        <rect x="-12.5" y="40" width="25" height="4.5" fill="#23508a" opacity=".45"/>
        <circle r="23" fill="url(#gBola)" stroke="${TRAZO}" stroke-width="1"/>
        <path d="M-19,9 A21,21 0 0 0 19,9" fill="none" stroke="#1d3f6e" stroke-width="3.2" opacity=".8"/>
        <ellipse cx="-7" cy="-9" rx="7" ry="4" fill="#fff" opacity=".45" transform="rotate(-25 -7 -9)"/>
        <g id="an${S}" transform="translate(0,${G.lBrazo})">
          <g id="ae${S}">
            <path d="M-11,2 L11,2 L14,44 Q14,53 6,53 L-6,53 Q-14,53 -14,44 Z" fill="url(#gCil)" stroke="${TRAZO}" stroke-width=".9"/>
            <rect x="-2.4" y="12" width="4.8" height="6" rx="1.5" fill="#76f2ff"/>
            <rect x="-2.4" y="21" width="4.8" height="6" rx="1.5" fill="#76f2ff" opacity=".85"/>
            <rect x="-2.4" y="30" width="4.8" height="6" rx="1.5" fill="#76f2ff" opacity=".7"/>
            <rect x="-14" y="44" width="28" height="4" fill="#23508a" opacity=".4"/>
          </g>
          <circle r="12" fill="url(#gJunta)"/>
          <circle r="7.5" fill="none" stroke="#4d86c2" stroke-width="1.4"/>
          <circle r="3.3" fill="#7ff3ff"/>
          <g id="mu${S}" transform="translate(0,${G.lAnte})">${mano(S)}</g>
        </g>
      </g>
    </g>`;
  }

  function rejilla() {
    let d = '';
    for (let y = 186; y <= 300; y += 11) d += `M130,${y} Q220,${r2(y + (y - 244) * 0.28)} 310,${y} `;
    for (let x = 142; x <= 298; x += 13) d += `M${x},172 Q${r2(x + (x - 220) * 0.32)},240 ${x},310 `;
    return `<path d="${d}" fill="none" stroke="#5fdcff" stroke-width=".9" opacity=".55"/>`;
  }

  function ondas() {
    let s = '';
    for (const lado of ['L', 'R']) {
      const x = lado === 'L' ? 90 : 350, sw = lado === 'L' ? 0 : 1;
      s += `<g id="ondas${lado}" transform="translate(${x},244)">`;
      for (let i = 0; i < 3; i++) s += `<path id="onda${lado}${i}" d="M0,-12 A12,12 0 0 ${sw} 0,12" fill="none" stroke="#7ff3ff" stroke-width="2.6" stroke-linecap="round" filter="url(#fBrillo)" opacity="0"/>`;
      s += '</g>';
    }
    return s;
  }

  // Visor con dos lóbulos superiores (forma característica del diseño Noviq)
  const VISOR = 'M134,244 C134,206 146,180 174,178 C197,177 204,196 220,196 C236,196 243,177 266,178 C294,180 306,206 306,244 C306,286 270,308 220,308 C170,308 134,286 134,244 Z';

  N.construirSVG = function () {
    return `<svg id="lienzo" viewBox="0 0 440 600" width="440" height="600" xmlns="http://www.w3.org/2000/svg">
<defs>
  <radialGradient id="gCasco" cx=".38" cy=".26" r=".82">
    <stop offset="0" stop-color="#f2feff"/><stop offset=".22" stop-color="#b6eff4"/>
    <stop offset=".55" stop-color="#78d0e4"/><stop offset=".82" stop-color="#4a9fcf"/><stop offset="1" stop-color="#2d6fae"/>
  </radialGradient>
  <radialGradient id="gCasco2" cx=".38" cy=".25" r=".9">
    <stop offset="0" stop-color="#effdff"/><stop offset=".35" stop-color="#b0e6f5"/>
    <stop offset=".75" stop-color="#68b1dc"/><stop offset="1" stop-color="#3977ba"/>
  </radialGradient>
  <linearGradient id="gVidrio" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#ffffff" stop-opacity=".55"/><stop offset=".45" stop-color="#ffffff" stop-opacity=".08"/><stop offset="1" stop-color="#ffffff" stop-opacity="0"/>
  </linearGradient>
  <linearGradient id="gCil" x1="0" y1="0" x2="1" y2="0">
    <stop offset="0" stop-color="#5a9ad2"/><stop offset=".32" stop-color="#e4f7ff"/>
    <stop offset=".6" stop-color="#abdcf4"/><stop offset="1" stop-color="#3b79ba"/>
  </linearGradient>
  <linearGradient id="gJunta" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#3d6599"/><stop offset=".5" stop-color="#1c355f"/><stop offset="1" stop-color="#0f213f"/>
  </linearGradient>
  <radialGradient id="gBola" cx=".35" cy=".3" r=".8">
    <stop offset="0" stop-color="#f4fcff"/><stop offset=".45" stop-color="#a9dcf6"/>
    <stop offset=".85" stop-color="#5091cf"/><stop offset="1" stop-color="#2f69a6"/>
  </radialGradient>
  <linearGradient id="gVisor" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#16305c"/><stop offset=".55" stop-color="#0b1c3b"/><stop offset="1" stop-color="#07142c"/>
  </linearGradient>
  <linearGradient id="gAro" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d9f7fc"/><stop offset=".6" stop-color="#a6e3f3"/><stop offset="1" stop-color="#78c3e6"/>
  </linearGradient>
  <linearGradient id="gOjo" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#d8ffff"/><stop offset=".45" stop-color="#8ff4ff"/><stop offset="1" stop-color="#46d2f2"/>
  </linearGradient>
  <linearGradient id="gBoca" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#b8fdff"/><stop offset="1" stop-color="#4fd6f3"/>
  </linearGradient>
  <radialGradient id="gOreja" cx=".3" cy=".35" r=".85">
    <stop offset="0" stop-color="#e9fbff"/><stop offset=".5" stop-color="#93d4ef"/><stop offset="1" stop-color="#3f7fc0"/>
  </radialGradient>
  <radialGradient id="gNucleo" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#1c4d86"/><stop offset="1" stop-color="#0a1a38"/>
  </radialGradient>
  <radialGradient id="gAura" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#58d4ff" stop-opacity=".30"/><stop offset=".55" stop-color="#3aa8f0" stop-opacity=".12"/><stop offset="1" stop-color="#2a8ae0" stop-opacity="0"/>
  </radialGradient>
  <radialGradient id="gHalo" cx=".5" cy=".5" r=".5">
    <stop offset="0" stop-color="#c8feff" stop-opacity=".95"/><stop offset=".35" stop-color="#5fe0ff" stop-opacity=".55"/><stop offset="1" stop-color="#2aa6ff" stop-opacity="0"/>
  </radialGradient>
  <linearGradient id="gIcono" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0" stop-color="#3fe9c4"/><stop offset="1" stop-color="#4a8cf2"/>
  </linearGradient>
  <linearGradient id="gHolo" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#5fe3ff" stop-opacity=".30"/><stop offset="1" stop-color="#2a8ae0" stop-opacity=".10"/>
  </linearGradient>
  <filter id="fBrillo" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="2.2" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <filter id="fBrilloG" x="-60%" y="-60%" width="220%" height="220%">
    <feGaussianBlur stdDeviation="4" result="b"/>
    <feMerge><feMergeNode in="b"/><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge>
  </filter>
  <clipPath id="cVisor"><path id="cVisorPath" d="${VISOR}"/></clipPath>
  <clipPath id="cBoca"><path id="cBocaPath" d=""/></clipPath>
</defs>

<g id="aura" pointer-events="none"><ellipse cx="220" cy="340" rx="200" ry="235" fill="url(#gAura)"/></g>

<g id="envoltura">
  <ellipse id="halo" cx="0" cy="0" rx="46" ry="10" fill="url(#gHalo)" pointer-events="none"/>
  <g id="robot">
    <g id="fxAtras" pointer-events="none"></g>

    <!-- Cuerpo inferior flotante -->
    <g id="torso" data-hit="1">
      <path d="M176,452 C176,490 200,516 220,518 C240,516 264,490 264,452 Z" fill="url(#gCasco2)" stroke="${TRAZO}" stroke-width="1.1"/>
      <path d="M182,474 Q220,488 258,474" stroke="#1f4579" stroke-width="3" fill="none" opacity=".55"/>
      <path d="M191,496 Q220,506 249,496" stroke="#1f4579" stroke-width="2.6" fill="none" opacity=".5"/>
      <ellipse cx="206" cy="470" rx="10" ry="4" fill="#fff" opacity=".35"/>
      <ellipse id="propulsor" cx="220" cy="516" rx="12" ry="4.6" fill="#d4feff" filter="url(#fBrillo)"/>
      <rect x="178" y="442" width="84" height="18" rx="9" fill="url(#gJunta)"/>
      <path d="M190,451 L250,451" stroke="#62e6ff" stroke-width="1.8" stroke-linecap="round" opacity=".8"/>
      <!-- Pecho -->
      <path d="M150,360 C150,340 166,332 188,332 L252,332 C274,332 290,340 290,360 L285,408 C281,434 263,448 240,448 L200,448 C177,448 159,434 155,408 Z"
            fill="url(#gCasco2)" stroke="${TRAZO}" stroke-width="1.2"/>
      <path d="M166,350 Q220,338 274,350" stroke="#fff" stroke-width="4.5" opacity=".38" fill="none" stroke-linecap="round"/>
      <path d="M165,412 Q175,436 199,443 M275,412 Q265,436 241,443" stroke="#2f69a8" stroke-width="1.5" opacity=".5" fill="none"/>
      <circle cx="176" cy="424" r="1.6" fill="#2f69a8" opacity=".5"/><circle cx="182" cy="430" r="1.6" fill="#2f69a8" opacity=".5"/>
      <circle cx="264" cy="424" r="1.6" fill="#2f69a8" opacity=".5"/><circle cx="258" cy="430" r="1.6" fill="#2f69a8" opacity=".5"/>
      <ellipse cx="220" cy="336" rx="38" ry="9" fill="url(#gJunta)"/>
      <g id="emblema" transform="translate(220,390)">
        <circle r="27" fill="#0a1a38" stroke="#5de8ff" stroke-width="3" filter="url(#fBrillo)"/>
        <circle r="22" fill="url(#gNucleo)"/>
        <path d="M-16,1 L-8,1 L-4,-10 L1,12 L5,-5 L8,1 L16,1" fill="none" stroke="#5fdfff" stroke-width="2.6"
              stroke-linecap="round" stroke-linejoin="round" filter="url(#fBrillo)"/>
        <path id="pulso" d="M-16,1 L-8,1 L-4,-10 L1,12 L5,-5 L8,1 L16,1" fill="none" stroke="#f0ffff" stroke-width="2.8"
              stroke-linecap="round" stroke-linejoin="round"/>
      </g>
    </g>

    <!-- Cuello -->
    <g id="cuello" data-hit="1">
      <rect x="200" y="312" width="40" height="28" rx="8" fill="url(#gJunta)"/>
      <path d="M202,321 L238,321 M202,329 L238,329" stroke="#4f86c4" stroke-width="1.6" opacity=".85"/>
    </g>

    <!-- Cabeza -->
    <g id="cabeza" data-hit="1">
      <g id="fxCabeza" pointer-events="none"></g>
      <g id="orejaL"><g id="orejaLs">
        <rect x="94" y="204" width="46" height="80" rx="21" fill="url(#gOreja)" stroke="${TRAZO}" stroke-width="1.1"/>
        <rect x="100" y="216" width="14" height="56" rx="7" fill="#dff8ff" opacity=".45"/>
      </g></g>
      <g id="orejaR"><g id="orejaRs">
        <rect x="300" y="204" width="46" height="80" rx="21" fill="url(#gOreja)" stroke="${TRAZO}" stroke-width="1.1"/>
        <rect x="326" y="216" width="14" height="56" rx="7" fill="#9fd8f0" opacity=".45"/>
      </g></g>
      <ellipse id="casco" cx="220" cy="232" rx="108" ry="103" fill="url(#gCasco)" stroke="${TRAZO}" stroke-width="1.3"/>
      <ellipse cx="220" cy="190" rx="96" ry="60" fill="url(#gVidrio)"/>
      <g id="brilloCasco">
        <ellipse cx="220" cy="146" rx="42" ry="13" fill="#e2fbff" opacity=".75"/>
        <path d="M140,200 C146,176 166,156 190,146" stroke="#fff" stroke-width="7" stroke-linecap="round" fill="none" opacity=".5"/>
        <ellipse cx="282" cy="165" rx="6" ry="3.6" fill="#fff" opacity=".85" transform="rotate(35 282 165)"/>
        <ellipse cx="296" cy="179" rx="4" ry="2.6" fill="#fff" opacity=".75" transform="rotate(45 296 179)"/>
        <ellipse cx="270" cy="155" rx="3" ry="2" fill="#fff" opacity=".6" transform="rotate(25 270 155)"/>
      </g>
      <g id="visor">
        <path d="${VISOR}" fill="none" stroke="#3f8fc4" stroke-width="15" stroke-linejoin="round"/>
        <path d="${VISOR}" fill="none" stroke="url(#gAro)" stroke-width="11" stroke-linejoin="round"/>
        <path d="${VISOR}" fill="url(#gVisor)"/>
        <path d="${VISOR}" fill="none" stroke="#5fdcff" stroke-width="1.4" opacity=".55"/>
        <path d="M160,205 C168,190 182,186 192,188" stroke="#cfefff" stroke-width="4" opacity=".14" fill="none" stroke-linecap="round"/>
      </g>
      <g clip-path="url(#cVisor)">
        <g id="rejilla" opacity="0">${rejilla()}</g>
        <g id="cara">
          <path id="ojoL" fill="url(#gOjo)" filter="url(#fBrillo)"/>
          <path id="ojoR" fill="url(#gOjo)" filter="url(#fBrillo)"/>
          <ellipse id="hlL" rx="3.2" ry="2.4" fill="#ffffff" opacity=".95"/>
          <ellipse id="hlR" rx="3.2" ry="2.4" fill="#ffffff" opacity=".95"/>
          <path id="boca" fill="url(#gBoca)" filter="url(#fBrillo)"/>
          <g id="rejillaBoca" clip-path="url(#cBoca)" opacity="0">
            <path id="barrasBoca" d="" stroke="#0a2448" stroke-width="2.4"/>
          </g>
        </g>
        <g id="iconoVisor" opacity="0" transform="translate(220,244)"></g>
      </g>
      ${ondas()}
    </g>

    <g id="fxMedio" pointer-events="none"></g>
    ${brazo('L')}
    ${brazo('R')}
    <g id="fxFrente" pointer-events="none"></g>
  </g>
</g>

<!-- Forma minimalista (modo icono) -->
<g id="modoIcono" opacity="0" data-hit="1" style="display:none">
  <circle cx="220" cy="508" r="44" fill="#07152e" opacity=".9"/>
  <circle cx="220" cy="508" r="38" fill="none" stroke="url(#gIcono)" stroke-width="6" filter="url(#fBrillo)"/>
  <path id="pulsoIcono" d="M194,510 L205,510 L211,494 L219,526 L226,502 L231,510 L246,510" fill="none" stroke="url(#gIcono)"
        stroke-width="5" stroke-linecap="round" stroke-linejoin="round"/>
  <text x="220" y="578" text-anchor="middle" font-family="Segoe UI, system-ui, sans-serif" font-size="22" font-weight="600"
        fill="#bff4ff" letter-spacing="1" style="paint-order:stroke" stroke="#07152e" stroke-width="4">noviq</text>
</g>

<g id="particulas" pointer-events="none"></g>
</svg>`;
  };

  /* ------------------------------------------------ Geometría paramétrica */
  // Ojo: forma de "lápida" (arriba redondeado, abajo más plano) que se transforma
  // en arco feliz (^), línea dormida (u), o se inclina (enojado / triste).
  function pathOjo(cx, cy, o) {
    const k = 1.333;
    const rx = 13.5 * o.size * (1 + 0.1 * o.squint);
    const ry = 18.5 * o.size * Math.max(0.05, o.open) * (1 - 0.5 * o.squint);
    let top = -k * ry, bot = 0.62 * ry, endY = 0.3 * ry;
    const h = o.happy;
    if (h > 0) {
      const ra = 14 * o.size;
      const topH = -k * ra * 0.75, botH = topH + 11.5 * o.size;
      top = lerp(top, topH, h); bot = lerp(bot, botH, h); endY = lerp(endY, ra * 0.28, h);
    } else if (h < 0) {
      const q = -h, ra = 12 * o.size;
      const botU = k * ra * 0.42, topU = botU - 8.5 * o.size;
      top = lerp(top, topU, q); bot = lerp(bot, botU, q); endY = lerp(endY, -ra * 0.12, q);
    }
    let t1 = top, t2 = top;
    const s = o.slant * ry * 1.25 * (1 - Math.abs(h));
    if (o.side < 0) { if (s > 0) t2 += s; else t1 -= s; }
    else { if (s > 0) t1 += s; else t2 -= s; }
    const L = cx - rx, R = cx + rx, y0 = cy + endY;
    return `M${r2(L)},${r2(y0)} C${r2(L)},${r2(cy + t1)} ${r2(R)},${r2(cy + t2)} ${r2(R)},${r2(y0)} C${r2(R)},${r2(cy + bot)} ${r2(L)},${r2(cy + bot)} ${r2(L)},${r2(y0)}Z`;
  }

  // Boca: media luna rellena (sonrisa), se abre en "D" (risa) u "O" (sorpresa).
  function pathBoca(cx, cy, m) {
    const w = 20 * m.width * (1 - 0.42 * m.round);
    const corner = -m.smile * 5.5;
    const mid = m.smile * 7;
    const grosor = 3.2 + 2.6 * Math.abs(m.smile) * (1 - m.open);
    let upMid = lerp(mid, corner + 1.5, clamp(m.open * 0.8, 0, 1));
    upMid -= m.open * m.round * 9;
    const loMid = upMid + grosor + m.open * (22 + 6 * m.round);
    const cU = 2 * upMid - corner;                       // control cuadrático
    const cL = (8 * loMid - 2 * corner) / 6;             // control cúbico
    const Lx = cx - w, Rx = cx + w, yc = cy + corner;
    const lx = w * (0.95 - 0.25 * m.round);
    const d = `M${r2(Lx)},${r2(yc)} Q${cx},${r2(cy + cU)} ${r2(Rx)},${r2(yc)} C${r2(cx + lx)},${r2(cy + cL)} ${r2(cx - lx)},${r2(cy + cL)} ${r2(Lx)},${r2(yc)}Z`;
    return d;
  }
  N.pathOjo = pathOjo; N.pathBoca = pathBoca;

  /* ------------------------------------------------------------------ Rig */
  class Rig {
    constructor(svg) {
      this.svg = svg;
      const q = (id) => svg.getElementById(id);
      const ids = ['envoltura', 'robot', 'halo', 'aura', 'cabeza', 'cara', 'visor', 'rejilla', 'brilloCasco', 'orejaL', 'orejaR',
        'orejaLs', 'orejaRs', 'ojoL', 'ojoR', 'hlL', 'hlR', 'boca', 'cBocaPath', 'cVisorPath', 'rejillaBoca', 'barrasBoca',
        'propulsor', 'pulso', 'emblema', 'modoIcono', 'pulsoIcono', 'iconoVisor'];
      this.$ = {};
      for (const id of ids) this.$[id] = q(id);
      for (const S of ['L', 'R']) {
        for (const p of ['hu', 'an', 'ae', 'mu', 'pu']) this.$[p + S] = q(p + S);
        for (let i = 0; i < 4; i++) { this.$['d' + S + i] = q('d' + S + i); this.$['dd' + S + i] = q('dd' + S + i); }
      }
      this.largoPulso = this.$.pulso.getTotalLength ? this.$.pulso.getTotalLength() : 60;
      this.$.pulso.setAttribute('stroke-dasharray', `${r2(this.largoPulso * 0.28)} ${r2(this.largoPulso * 1.2)}`);
      this.iconoVisible = false;
    }

    aplicar(p, t, extra) {
      const $ = this.$;
      const blink = extra && extra.blink != null ? extra.blink : 1;

      // Modo icono / avatar
      const it = clamp(p.iconT, 0, 1);
      const sEnv = 1 - 0.85 * it;
      $.envoltura.setAttribute('transform',
        `translate(220 508) scale(${r3(sEnv)}) translate(-220 -508) rotate(${r2(p.lean)} 220 430)`);
      $.envoltura.setAttribute('opacity', r3(1 - smooth(0.1, 0.8, it)));
      $.envoltura.style.display = it > 0.985 ? 'none' : '';
      $.aura.setAttribute('opacity', r3(p.glow * (1 - it)));
      $.modoIcono.style.display = it < 0.02 ? 'none' : '';
      $.modoIcono.setAttribute('opacity', r3(smooth(0.3, 1, it)));
      $.modoIcono.setAttribute('transform', `translate(220 508) scale(${r3(0.6 + 0.4 * it)}) translate(-220 -508)`);
      if (it > 0.02) {
        const beat = Math.pow(Math.max(0, Math.sin(t * 3.2)), 12);
        $.pulsoIcono.setAttribute('stroke-width', r2(5 + beat * 1.6));
      }

      // Cuerpo
      $.robot.setAttribute('transform',
        `translate(${r2(p.bodyX)},${r2(p.bodyY)}) rotate(${r2(p.bodyRot)} 220 470) translate(220 516) scale(${r3(p.bodySX)} ${r3(p.bodySY)}) translate(-220 -516)`);
      const alto = clamp(-p.bodyY / 40, -0.5, 1);
      $.halo.setAttribute('transform', `translate(220 ${r2(538 + p.bodyY * 0.15)}) scale(${r3(1 - alto * 0.3)} ${r3(1 - alto * 0.25)})`);
      $.halo.setAttribute('opacity', r3((0.75 + 0.25 * Math.sin(t * 5)) * (1 - alto * 0.35) * p.glow));
      $.propulsor.setAttribute('opacity', r3((0.65 + 0.35 * Math.sin(t * 9)) * p.glow));
      $.pulso.setAttribute('stroke-dashoffset', r2(this.largoPulso * 0.28 - ((t * 38) % (this.largoPulso * 1.48))));
      const latido = 1 + 0.04 * Math.pow(Math.max(0, Math.sin(t * 3.4)), 16);
      $.emblema.setAttribute('transform', `translate(220,390) scale(${r3(latido)})`);

      // Cabeza (giro 2.5D: la cara y el visor se desplazan sobre el casco)
      const yaw = p.headYaw, pit = p.headPitch;
      $.cabeza.setAttribute('transform', `translate(0,${r2(p.headY)}) rotate(${r2(p.headRot)} ${G.pivCabeza[0]} ${G.pivCabeza[1]})`);
      $.visor.setAttribute('transform', `translate(${r2(yaw * 8)},${r2(pit * 5)})`);
      $.cVisorPath.setAttribute('transform', `translate(${r2(yaw * 8)},${r2(pit * 5)})`);
      $.cara.setAttribute('transform', `translate(${r2(yaw * 17)},${r2(pit * 13)})`);
      $.rejilla.setAttribute('transform', `translate(${r2(yaw * 12)},${r2(pit * 8)})`);
      $.rejilla.setAttribute('opacity', r3(p.grid * 0.9));
      $.brilloCasco.setAttribute('transform', `translate(${r2(-yaw * 6)},${r2(-pit * 3)})`);
      $.orejaL.setAttribute('transform', `translate(${r2(yaw * 5 + Math.max(0, yaw) * 4)},${r2(pit * 3)})`);
      $.orejaR.setAttribute('transform', `translate(${r2(yaw * 5 + Math.min(0, yaw) * 4)},${r2(pit * 3)})`);
      $.orejaLs.setAttribute('transform', `translate(117 244) scale(${r3(1 - 0.3 * Math.max(0, -yaw))} 1) translate(-117 -244)`);
      $.orejaRs.setAttribute('transform', `translate(323 244) scale(${r3(1 - 0.3 * Math.max(0, yaw))} 1) translate(-323 -244)`);

      // Ojos
      const lx = p.lookX * 8, ly = p.lookY * 6;
      const visorIcon = clamp(p.visorIcon, 0, 1);
      $.cara.setAttribute('opacity', r3(1 - visorIcon));
      $.iconoVisor.setAttribute('opacity', r3(visorIcon));
      const ojoBase = { happy: p.eyeHappy, slant: p.eyeSlant, squint: p.eyeSquint };
      const oL = Object.assign({}, ojoBase, { size: p.eyeSize * p.eyeLs, open: p.eyeOpen * p.eyeLo * blink, side: -1 });
      const oR = Object.assign({}, ojoBase, { size: p.eyeSize * p.eyeRs, open: p.eyeOpen * p.eyeRo * blink, side: 1 });
      const cxL = G.ojoL[0] + lx, cxR = G.ojoR[0] + lx, cy = G.ojoL[1] + ly;
      $.ojoL.setAttribute('d', pathOjo(cxL, cy, oL));
      $.ojoR.setAttribute('d', pathOjo(cxR, cy, oR));
      const vis = (o) => clamp(o.open * 1.4 - 0.4, 0, 1) * (1 - clamp(Math.abs(o.happy) * 1.5, 0, 1)) * (1 - o.squint * 0.6);
      const hl = (el, cx0, o) => {
        const ry = 18.5 * o.size * Math.max(0.05, o.open) * (1 - 0.5 * o.squint);
        el.setAttribute('cx', r2(cx0 - 5 * o.size));
        el.setAttribute('cy', r2(cy - ry * 0.55));
        el.setAttribute('opacity', r3(vis(o) * 0.95));
      };
      hl($.hlL, cxL, oL); hl($.hlR, cxR, oR);

      // Boca
      const m = { smile: p.mouthSmile, open: clamp(p.mouthOpen, 0, 1.2), width: p.mouthWidth, round: p.mouthRound };
      const dBoca = pathBoca(G.boca[0] + lx * 0.6, G.boca[1] + ly * 0.5, m);
      $.boca.setAttribute('d', dBoca);
      const g = clamp(p.mouthGrille, 0, 1) * smooth(0.08, 0.25, m.open);
      $.rejillaBoca.setAttribute('opacity', r3(g));
      if (g > 0.01) {
        $.cBocaPath.setAttribute('d', dBoca);
        const bx = G.boca[0] + lx * 0.6;
        let d = '';
        for (let i = -3; i <= 3; i++) d += `M${r2(bx + i * 6)},250 L${r2(bx + i * 6)},320 `;
        d += `M${r2(bx - 30)},${r2(G.boca[1] + ly * 0.5 + 6 + m.open * 9)} L${r2(bx + 30)},${r2(G.boca[1] + ly * 0.5 + 6 + m.open * 9)}`;
        $.barrasBoca.setAttribute('d', d);
      }

      // Brazos (ángulos en convención "hacia afuera positivo" para ambos lados)
      for (const S of ['L', 'R']) {
        const sg = S === 'L' ? 1 : -1, ts = S === 'L' ? -1 : 1;
        const fs = clamp(p[S + 'fs'], 0.35, 1.2);
        $['hu' + S].setAttribute('transform', `rotate(${r2(sg * p[S + 'sh'])})`);
        $['an' + S].setAttribute('transform', `translate(0,${G.lBrazo}) rotate(${r2(sg * p[S + 'el'])})`);
        $['ae' + S].setAttribute('transform', `scale(1,${r3(fs)})`);
        $['mu' + S].setAttribute('transform', `translate(0,${r2(G.lAnte * fs)}) rotate(${r2(sg * p[S + 'wr'])}) scale(${r3(p[S + 'hs'])},${r3(p[S + 'hs'] * p[S + 'hy'])})`);
        const sp = p[S + 'sp'];
        for (let i = 0; i < 4; i++) {
          const c = clamp(p[S + 'c' + (i + 1)], 0, 1);
          const ang = -ts * sp * (1.5 - i) * 6.5;
          $['d' + S + i].setAttribute('transform', `translate(${r2(ts * (10.5 - 7 * i))},33) rotate(${r2(ang)}) scale(1,${r3(1 - 0.58 * c)})`);
          $['dd' + S + i].setAttribute('transform', `translate(0,${r2(LARGO_DEDOS[i] * 0.55)}) scale(1,${r3(1 - 0.4 * c)})`);
        }
        const c0 = clamp(p[S + 'c0'], 0, 1);
        $['pu' + S].setAttribute('transform', `translate(${ts * 12},12) rotate(${r2(-ts * (48 - 80 * c0))}) scale(1,${r3(1 - 0.25 * c0)})`);
      }
    }
  }
  N.Rig = Rig;
})();
