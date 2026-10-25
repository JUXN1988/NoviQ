/* Noviq Game Kit — comun.js: lo que comparten los motores (3D, vóxel y 2D).
   Pantallas y HUD, teclado/ratón/táctil, sonidos sintetizados (sin archivos), calidad según la PC y FPS,
   ruido para generar mundos, carga de modelos .glb y estadoJuego() para las pruebas automáticas.
   No hace falta editar este archivo: el diseño está en juego.config.js y las reglas propias en juego.js. */
(function () {
  "use strict";
  const QS = new URLSearchParams(location.search);
  const NK = window.NK = {};
  const def = (o, d) => { for (const k in d) { if (o[k] === undefined || o[k] === null) o[k] = d[k]; else if (typeof d[k] === "object" && !Array.isArray(d[k]) && typeof o[k] === "object") def(o[k], d[k]); } return o; };
  NK.cfg = def(window.JUEGO || {}, {
    titulo: "Mi juego", descripcion: "", genero: "aventura", estilo: "lowpoly", motor: "3d", camara: "tercera", tema: "bosque",
    ambiente: { cielo: "#8ec5ff", horizonte: "#e3f1ff", suelo: ["#3f7a2e", "#5c9a3c", "#7a8f4a", "#9aa39a"], agua: "#2f6f9f", hora: "dia", niebla: 0.012, clima: "despejado" },
    mundo: { tamano: 160, relieve: 0.45, semilla: 1234, isla: false },
    jugador: { nombre: "Jugador", modelo: "jugador", color: "#3fa9f5", velocidad: 7, salto: 8, vida: 100, arma: "espada" },
    objetivo: { tipo: "recolectar", cantidad: 10, tiempo: 0, texto: "Recoge todos los objetos" },
    enemigos: [], objetos: [], decoracion: [], musica: true, calidad: {}
  });
  NK.activos = window.ACTIVOS || { modelos: {}, texturas: {}, cielos: [], creditos: [] };
  NK.prueba = QS.has("prueba");
  NK.reglas = window.REGLAS || {};
  NK.gancho = (nombre, ...args) => { try { const f = NK.reglas[nombre]; return f ? f(...args) : undefined; } catch (e) { NK.error("juego.js → " + nombre + ": " + e.message); } };

  /* ───────── Errores visibles (para principiantes) ───────── */
  NK.error = msg => {
    console.error(msg);
    let el = document.getElementById("nk-error");
    if (!el) { el = document.createElement("div"); el.id = "nk-error"; document.body.appendChild(el); }
    el.textContent = "⚠ " + msg + "\n(Pídele a la IA de Noviq: «arregla este error del juego»)"; el.style.display = "block";
  };
  window.addEventListener("error", e => { if (e && e.message && !/ResizeObserver/.test(e.message)) NK.error(e.message + (e.filename ? " (" + e.filename.split("/").pop() + ":" + e.lineno + ")" : "")); });

  /* ───────── Números al azar con semilla y ruido ───────── */
  NK.rand = seed => { let a = (seed >>> 0) || 1; return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  NK.ruido = seed => {
    const r = NK.rand(seed), p = new Uint8Array(512), g = new Float32Array(256);
    for (let i = 0; i < 256; i++) { p[i] = i; g[i] = r() * 2 - 1; }
    for (let i = 255; i > 0; i--) { const j = (r() * (i + 1)) | 0; const t = p[i]; p[i] = p[j]; p[j] = t; }
    for (let i = 0; i < 256; i++) p[i + 256] = p[i];
    const f = t => t * t * (3 - 2 * t);
    const h = (x, y) => g[p[p[x & 255] + (y & 255)]];
    const v2 = (x, y) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = f(xf), v = f(yf);
      const a = h(xi, yi), b = h(xi + 1, yi), c = h(xi, yi + 1), d = h(xi + 1, yi + 1);
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; };
    const fbm = (x, y, oct = 4) => { let s = 0, amp = 1, fr = 1, n = 0; for (let i = 0; i < oct; i++) { s += amp * v2(x * fr, y * fr); n += amp; amp *= 0.5; fr *= 2; } return s / n; };
    return { v2, fbm };
  };
  NK.lerp = (a, b, t) => a + (b - a) * t;
  NK.clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  NK.color = hex => { const n = parseInt(String(hex || "#888888").replace("#", ""), 16) || 0; return [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255]; };

  /* ───────── Calidad según la PC (la calcula Noviq; si no, se estima con la tarjeta que ve el navegador) ───────── */
  NK.gpuWebGL = () => {
    try { const c = document.createElement("canvas"), gl = c.getContext("webgl"); if (!gl) return "sin WebGL";
      const d = gl.getExtension("WEBGL_debug_renderer_info"); const s = d ? gl.getParameter(d.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
      const lose = gl.getExtension("WEBGL_lose_context"); if (lose) lose.loseContext(); return String(s); } catch (e) { return "?"; }
  };
  const NIVELES = {
    basico: { nivel: "basico", pixelRatio: 0.85, sombras: false, sombraTam: 512, antialias: false, distancia: 90, densidad: 0.45, terreno: 64, chunks: 3, fpsObjetivo: 40 },
    medio: { nivel: "medio", pixelRatio: 1, sombras: true, sombraTam: 1024, antialias: false, distancia: 140, densidad: 0.7, terreno: 112, chunks: 4, fpsObjetivo: 50 },
    alto: { nivel: "alto", pixelRatio: 1.25, sombras: true, sombraTam: 2048, antialias: true, distancia: 220, densidad: 1, terreno: 160, chunks: 6, fpsObjetivo: 55 },
    ultra: { nivel: "ultra", pixelRatio: 1.5, sombras: true, sombraTam: 4096, antialias: true, distancia: 320, densidad: 1.35, terreno: 224, chunks: 8, fpsObjetivo: 58 }
  };
  NK.calidad = () => {
    if (NK._q) return NK._q;
    let q = NK.cfg.calidad && NK.cfg.calidad.nivel ? Object.assign({}, NIVELES[NK.cfg.calidad.nivel] || NIVELES.medio, NK.cfg.calidad) : null;
    if (!q) {
      const g = NK.gpuWebGL().toLowerCase();
      q = Object.assign({}, /rtx|radeon rx [5-9]|arc a7/.test(g) ? NIVELES.alto : /gtx|radeon rx|nvidia|geforce/.test(g) ? NIVELES.medio : NIVELES.basico);
    }
    const lvl = QS.get("calidad"); if (lvl && NIVELES[lvl]) q = Object.assign({}, NIVELES[lvl]);
    q.pixelRatio = Math.min(q.pixelRatio, window.devicePixelRatio || 1);
    if (NK.prueba) { q.pixelRatio = Math.min(q.pixelRatio, 1); }
    return (NK._q = q);
  };
  /* FPS promedio y bajada automática de calidad si la PC va justa */
  NK.fps = { valor: 60, t: 0, n: 0, bajo: 0 };
  NK.medirFPS = (dt, alBajar) => {
    const F = NK.fps; F.t += dt; F.n++;
    if (F.t >= 1) { F.valor = Math.round(F.n / F.t); F.t = 0; F.n = 0;
      const obj = NK.calidad().fpsObjetivo || 45;
      if (F.valor < obj * 0.72 && !document.hidden) { if (++F.bajo >= 3) { F.bajo = 0; alBajar && alBajar(F.valor); } } else F.bajo = 0;
      const fe = document.querySelector("#nk-hud .fps"); if (fe && fe.style.display === "block") fe.textContent = F.valor + " FPS · " + (NK.infoRender ? NK.infoRender() : "");
    }
  };

  /* ───────── Entrada: teclado, ratón y táctil ───────── */
  const T = NK.teclas = new Set(); const PUL = new Set();
  const MAPA = { saltar: ["Space"], accion: ["KeyE", "KeyF", "Enter", "Mouse0"], correr: ["ShiftLeft", "ShiftRight"], pausa: ["Escape", "KeyP"],
    secundaria: ["Mouse2"], cambiarArma: ["KeyQ"], hablar: ["KeyE", "Enter"], musica: ["KeyM"], fps: ["F3"] };
  NK.tecla = c => T.has(c);
  NK.boton = n => (MAPA[n] || [n]).some(c => T.has(c));
  NK.pulso = n => { const hit = (MAPA[n] || [n]).some(c => PUL.has(c)); return hit; };
  NK.finFrame = () => PUL.clear();
  NK.eje = () => {
    let x = 0, y = 0;
    if (T.has("KeyA") || T.has("ArrowLeft")) x -= 1; if (T.has("KeyD") || T.has("ArrowRight")) x += 1;
    if (T.has("KeyW") || T.has("ArrowUp")) y += 1; if (T.has("KeyS") || T.has("ArrowDown")) y -= 1;
    if (NK.tactil.x || NK.tactil.y) { x = NK.tactil.x; y = NK.tactil.y; }
    const l = Math.hypot(x, y); return l > 1 ? { x: x / l, y: y / l } : { x, y };
  };
  NK.raton = { dx: 0, dy: 0, bloqueado: false, x: 0, y: 0, rueda: 0 };
  NK.tomarRaton = () => { const r = NK.raton, o = { dx: r.dx, dy: r.dy, rueda: r.rueda }; r.dx = 0; r.dy = 0; r.rueda = 0; return o; };
  const evitar = new Set(["Space", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "F3"]);
  addEventListener("keydown", e => { if (!e.repeat) PUL.add(e.code); T.add(e.code); if (evitar.has(e.code)) e.preventDefault();
    if (e.code === "KeyM") NK.musica(!NK._musicaOn); if (e.code === "F3") { const f = document.querySelector("#nk-hud .fps"); if (f) f.style.display = f.style.display === "block" ? "none" : "block"; }
    NK.audio(); });
  addEventListener("keyup", e => T.delete(e.code));
  addEventListener("blur", () => T.clear());
  addEventListener("mousemove", e => { const r = NK.raton; r.x = e.clientX; r.y = e.clientY; if (r.bloqueado || e.buttons & 2 || NK._arrastrar) { r.dx += e.movementX || 0; r.dy += e.movementY || 0; } });
  addEventListener("mousedown", e => { if (e.target && e.target.id === "lienzo") { T.add("Mouse" + e.button); PUL.add("Mouse" + e.button); NK.audio(); } });
  addEventListener("mouseup", e => T.delete("Mouse" + e.button));
  addEventListener("wheel", e => { NK.raton.rueda += Math.sign(e.deltaY); }, { passive: true });
  addEventListener("contextmenu", e => { if (e.target && e.target.id === "lienzo") e.preventDefault(); });
  document.addEventListener("pointerlockchange", () => { NK.raton.bloqueado = !!document.pointerLockElement; });
  NK.bloquearRaton = el => { try { if (!NK.prueba && el.requestPointerLock) { const p = el.requestPointerLock(); if (p && p.catch) p.catch(() => {}); } } catch (e) {} };
  NK.tactil = { x: 0, y: 0 };
  function tactil() {
    if (!("ontouchstart" in window)) return;
    const t = document.createElement("div"); t.id = "nk-tactil"; t.innerHTML = '<div class="pad"><i></i></div><div class="bts"><b data-b="accion">✊</b><b data-b="saltar">⤒</b></div>';
    document.body.appendChild(t); NK._tactilEl = t;
    const pad = t.querySelector(".pad"), bola = pad.querySelector("i"); let id = null;
    const mover = e => { for (const to of e.changedTouches) if (to.identifier === id) { const r = pad.getBoundingClientRect(); let x = (to.clientX - r.left - 65) / 50, y = (to.clientY - r.top - 65) / 50; const l = Math.hypot(x, y); if (l > 1) { x /= l; y /= l; } NK.tactil.x = x; NK.tactil.y = -y; bola.style.transform = `translate(${x * 40}px,${y * 40}px)`; } e.preventDefault(); };
    pad.addEventListener("touchstart", e => { id = e.changedTouches[0].identifier; mover(e); NK.audio(); }, { passive: false });
    pad.addEventListener("touchmove", mover, { passive: false });
    pad.addEventListener("touchend", () => { id = null; NK.tactil.x = NK.tactil.y = 0; bola.style.transform = ""; });
    t.querySelectorAll("[data-b]").forEach(b => { const c = b.dataset.b === "saltar" ? "Space" : "KeyE";
      b.addEventListener("touchstart", e => { T.add(c); PUL.add(c); e.preventDefault(); }, { passive: false });
      b.addEventListener("touchend", () => T.delete(c)); });
  }

  /* ───────── Sonido sintetizado (WebAudio, sin archivos) ───────── */
  let AC = null, master = null, musicaNodo = null;
  NK.audio = () => { if (NK.prueba && !QS.has("sonido")) return null; if (AC) { if (AC.state === "suspended") AC.resume(); return AC; } try { AC = new (window.AudioContext || window.webkitAudioContext)(); master = AC.createGain(); master.gain.value = 0.35; master.connect(AC.destination); if (NK.cfg.musica !== false && NK._musicaQuiere) NK.musica(true); } catch (e) { AC = null; } return AC; };
  const tono = (f0, f1, dur, tipo = "square", vol = 0.25, ret = 0) => {
    if (!AC) return; const t = AC.currentTime + ret, o = AC.createOscillator(), g = AC.createGain();
    o.type = tipo; o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(Math.max(20, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur); o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  };
  const ruidoCorto = (dur, vol = 0.3, fc = 900) => { if (!AC) return; const n = Math.floor(AC.sampleRate * dur), b = AC.createBuffer(1, n, AC.sampleRate), d = b.getChannelData(0);
    for (let i = 0; i < n; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / n); const s = AC.createBufferSource(), f = AC.createBiquadFilter(), g = AC.createGain();
    s.buffer = b; f.type = "lowpass"; f.frequency.value = fc; g.gain.value = vol; s.connect(f); f.connect(g); g.connect(master); s.start(); };
  NK.sonido = tipo => {
    if (!AC) return;
    switch (tipo) {
      case "moneda": tono(880, 1320, 0.09, "square", 0.18); tono(1320, 1760, 0.12, "square", 0.15, 0.08); break;
      case "salto": tono(260, 620, 0.16, "square", 0.15); break;
      case "golpe": ruidoCorto(0.12, 0.35, 700); tono(180, 80, 0.12, "sawtooth", 0.15); break;
      case "danio": tono(220, 90, 0.25, "sawtooth", 0.22); break;
      case "disparo": ruidoCorto(0.08, 0.25, 2500); tono(900, 200, 0.1, "square", 0.1); break;
      case "romper": ruidoCorto(0.15, 0.3, 500); break;
      case "poner": tono(160, 120, 0.06, "triangle", 0.25); break;
      case "vida": tono(523, 1046, 0.25, "triangle", 0.22); break;
      case "ganar": [523, 659, 784, 1046].forEach((f, i) => tono(f, f, 0.22, "square", 0.16, i * 0.13)); break;
      case "perder": [392, 330, 262, 196].forEach((f, i) => tono(f, f * 0.98, 0.26, "triangle", 0.2, i * 0.16)); break;
      case "motor": tono(90, 110, 0.12, "sawtooth", 0.05); break;
      case "paso": ruidoCorto(0.04, 0.08, 400); break;
      case "trueno": ruidoCorto(1.4, 0.55, 180); tono(60, 30, 1.2, "sawtooth", 0.12); break;
      case "logro": [659, 784, 988, 1319].forEach((f, i) => tono(f, f, 0.16, "triangle", 0.16, i * 0.09)); break;
      case "zona": [392, 523, 659, 784].forEach((f, i) => tono(f, f * 1.01, 0.3, "sine", 0.18, i * 0.14)); break;
      case "jefe": [110, 104, 98, 92].forEach((f, i) => tono(f, f * 0.98, 0.5, "sawtooth", 0.14, i * 0.28)); break;
      case "flecha": ruidoCorto(0.06, 0.18, 3500); break;
      case "magia": tono(700, 1400, 0.25, "sine", 0.16); tono(1050, 2100, 0.2, "triangle", 0.1, 0.05); break;
      case "fuego": ruidoCorto(0.3, 0.2, 900); break;
      case "potenciador": tono(523, 1568, 0.35, "sine", 0.2); break;
      case "trampa": ruidoCorto(0.1, 0.4, 1600); tono(300, 80, 0.2, "square", 0.15); break;
      case "dialogo": tono(620 + Math.random() * 120, 600, 0.04, "square", 0.05); break;
      default: tono(440, 440, 0.1);
    }
  };
  NK._musicaQuiere = NK.cfg.musica !== false;
  NK.musica = on => {
    NK._musicaQuiere = on; NK._musicaOn = on;
    if (!AC) return;
    if (musicaNodo) { clearInterval(musicaNodo); musicaNodo = null; }
    if (!on) return;
    // música ambiental suave generada (acordes lentos según la hora del juego)
    const noche = NK.cfg.ambiente.hora === "noche" || NK.cfg.tema === "terror";
    const prog = noche ? [[220, 261.6, 329.6], [196, 246.9, 293.7], [174.6, 220, 261.6], [196, 233.1, 293.7]] : [[261.6, 329.6, 392], [220, 261.6, 329.6], [174.6, 220, 261.6], [196, 246.9, 293.7]];
    let i = 0;
    const acorde = () => { if (!AC || document.hidden) return; const t = AC.currentTime; prog[i++ % prog.length].forEach(f => {
      const o = AC.createOscillator(), g = AC.createGain(); o.type = "sine"; o.frequency.value = f / 2;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.045, t + 0.8); g.gain.exponentialRampToValueAtTime(0.0001, t + 3.6);
      o.connect(g); g.connect(master); o.start(t); o.stop(t + 3.8); }); };
    acorde(); musicaNodo = setInterval(acorde, 3600);
  };

  /* ───────── Interfaz: pantallas y HUD ───────── */
  const C = NK.cfg;
  const CAMP = NK.campana = (C.campana && Array.isArray(C.campana.zonas) && C.campana.zonas.length) ? C.campana : null;
  const esc = s => String(s == null ? "" : s).replace(/[&<>"]/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
  const ctrlTxt = () => {
    const m = C.motor, a = C.jugador.arma, c = C.controles || {};
    const f = [["Moverse", c.mover || (m === "2d" && C.camara === "lateral" ? "A / D o ← →" : "W A S D o flechas")]];
    if (C.genero === "carreras") f[0] = ["Conducir", "W/S acelerar-frenar · A/D girar"];
    if (m !== "2d" || C.camara === "lateral") f.push(["Saltar", c.saltar || "Espacio"]);
    if (m === "voxel") f.push(["Romper / poner", "Clic izquierdo / derecho · 1-9 elegir bloque"]);
    else if (a === "disparo") f.push(["Disparar", c.accion || "Clic o E"]);
    else if (a === "espada") f.push(["Atacar", c.accion || "Clic o E"]);
    if (CAMP && (CAMP.armas || []).length > 1 && m === "3d") f.push(["Cambiar arma", "Q o 1-4"]);
    if (CAMP) f.push(["Hablar", "E (cerca de un personaje)"]);
    if (m !== "2d") f.push(["Cámara", m === "voxel" || C.camara === "primera" ? "Ratón (clic para capturarlo)" : "Ratón (clic para capturarlo) · rueda: zoom"]);
    f.push(["Correr", "Shift"], ["Pausa", "Esc o P"], ["Música", "M"]);
    return f.map(([k, v]) => `<b>${esc(k)}</b><span>${esc(v)}</span>`).join("");
  };
  // progreso guardado en este navegador (trajes y armas desbloqueados, logros, récord)
  const CLAVE = "noviq_juego_" + String(C.titulo || "juego").toLowerCase().replace(/[^a-z0-9]+/g, "_").slice(0, 40);
  NK.guardado = { puntos: 0, zonaMax: 0, logros: {}, record: 0 };
  try { Object.assign(NK.guardado, JSON.parse(localStorage.getItem(CLAVE) || "{}")); } catch (e) {}
  NK.guardar = () => { try { localStorage.setItem(CLAVE, JSON.stringify(NK.guardado)); } catch (e) {} };
  const icono = (tipo, id) => `assets/iconos/${tipo}_${id}.png`;
  const EMO_ARMA = { cuerpo: "⚔", disparo: "🏹", magia: "✨" };
  function crearUI() {
    const ui = document.createElement("div"); ui.id = "nk-ui";
    const hist = CAMP && CAMP.historia ? CAMP.historia : null;
    ui.innerHTML = `
      <div class="vineta"></div>
      <div class="pant ver" id="nk-inicio"><div class="caja"><h1>${esc(C.titulo)}</h1><p>${esc(hist ? hist.premisa : C.descripcion)}</p>
        <div class="mision">🎯 ${esc(C.objetivo.texto)}</div>${CAMP ? `<div class="ruta">${CAMP.zonas.map((z, i) => `<span class="${i <= NK.guardado.zonaMax ? "ok" : ""}">${i + 1}. ${esc(z.nombre)}</span>`).join("")}</div>` : ""}
        <div class="ctrl">${ctrlTxt()}</div>
        <button id="nk-jugar">▶ Jugar</button><br><button class="sec" id="nk-cred1">Créditos</button>${CAMP ? `<button class="sec" id="nk-logros1">🏆 Logros</button>` : ""}</div></div>
      <div class="pant" id="nk-elegir"><div class="caja ancha"><h2>Prepárate para la travesía</h2>
        <div class="grupo"><h3>👕 Elige tu personaje</h3><div class="cartas" id="nk-trajes"></div></div>
        <div class="grupo" id="nk-g-armas"><h3>⚔ Elige tu arma</h3><div class="cartas" id="nk-armas"></div></div>
        <div class="grupo"><h3>🎚 Dificultad</h3><div class="dif" id="nk-dif"><button class="sec" data-d="facil">Fácil</button><button class="sec sel" data-d="normal">Normal</button><button class="sec" data-d="dificil">Difícil</button></div></div>
        <button id="nk-comenzar">▶ Comenzar la travesía</button><button class="sec" id="nk-volver">Volver</button></div></div>
      <div class="pant" id="nk-pausa"><div class="caja"><h2>⏸ Pausa</h2><div class="mision" id="nk-pausa-m">🎯 ${esc(C.objetivo.texto)}</div><div class="ctrl">${ctrlTxt()}</div>
        <button id="nk-seguir">▶ Seguir</button><br><button class="sec" id="nk-reini">↻ Reiniciar</button><button class="sec" id="nk-cred2">Créditos</button>${CAMP ? `<button class="sec" id="nk-logros2">🏆 Logros</button>` : ""}</div></div>
      <div class="pant" id="nk-fin"><div class="caja"><h2 id="nk-fin-t"></h2><p id="nk-fin-p"></p><div id="nk-fin-x"></div><button id="nk-otra">↻ Jugar de nuevo</button><button class="sec" id="nk-menu">⌂ Menú</button></div></div>
      <div class="pant" id="nk-creditos"><div class="caja"><h2>Créditos</h2><p>Hecho con el 🎮 Estudio de juegos de Noviq.</p><ul id="nk-cred-l"></ul><button class="sec" id="nk-cred-x">Volver</button></div></div>
      <div class="pant" id="nk-logros"><div class="caja"><h2>🏆 Logros</h2><ul class="logros" id="nk-logros-l"></ul><button class="sec" id="nk-logros-x">Volver</button></div></div>
      <div class="pant sinfondo" id="nk-mejora"><div class="caja ancha"><h2>✨ Elige una mejora</h2><p id="nk-mejora-p"></p><div class="cartas" id="nk-mejoras"></div></div></div>
      <div id="nk-cine"><div class="franja a"></div><div class="franja b"></div><div class="texto"></div><div class="saltar">Saltar ⏎</div></div>
      <div id="nk-dialogo"><img alt=""><div><b></b><p></p></div><span>E ▸</span></div>
      <div id="nk-banner"><h1></h1><p></p></div>
      <div id="nk-logro"></div>
      <div id="nk-hud"><div class="sup"><div class="chip"><span class="vidas"></span> ❤ <span class="vt">100</span><div class="vida"><i></i></div></div><div class="chip">⭐ <span class="pt">0</span></div>
        <div class="chip tm" style="display:none">⏱ <span class="tt">0:00</span></div><div class="chip obj"><span class="zn"></span><span class="ot"></span><small class="op"></small></div></div>
        <div class="jefe"><b></b><div><i></i></div></div><div class="brujula"><i>➤</i><small></small></div>
        <div class="arma"><img alt=""><b></b><small>Q</small></div><div class="efectos"></div>
        <div class="mira"></div><div class="aviso"></div><div class="danio"></div><div class="flash"></div><div class="fps"></div><div class="barra"></div></div>`;
    document.body.appendChild(ui);
    const $ = s => ui.querySelector(s);
    const ver = (id, on) => $(id).classList.toggle("ver", on);
    let volverA = "#nk-inicio";
    $("#nk-jugar").onclick = () => (NK.travesia.activa ? NK.travesia.elegir() : NK.jugar());
    $("#nk-seguir").onclick = () => NK.pausar(false);
    $("#nk-reini").onclick = () => { ver("#nk-pausa", false); if (NK.travesia.activa) { NK.travesia.reintentar(true); } else { NK._reiniciar && NK._reiniciar(); NK.jugar(); } };
    $("#nk-otra").onclick = () => { ver("#nk-fin", false); if (NK.travesia.activa && NK.travesia.puedeReintentar() && !NK.travesia.gano) NK.travesia.reintentar(false); else if (NK.travesia.activa) { NK.travesia.reintentar(true); } else { NK._reiniciar && NK._reiniciar(); NK.jugar(); } };
    $("#nk-menu").onclick = () => { ver("#nk-fin", false); NK.estado = "menu"; NK._reiniciar && NK._reiniciar(); ver("#nk-inicio", true); };
    const cred = de => { volverA = de; ver(de, false); ver("#nk-creditos", true);
      const l = (NK.activos.creditos || []).map(c => `<li><b>${esc(c.nombre)}</b> — ${esc(c.autor || "?")} · ${esc(c.licencia)} (${esc(c.fuente)})</li>`);
      l.push("<li>Motor: Noviq Game Kit + Three.js (MIT)</li>"); $("#nk-cred-l").innerHTML = l.join(""); };
    const logros = de => { volverA = de; ver(de, false); ver("#nk-logros", true);
      $("#nk-logros-l").innerHTML = ((CAMP && CAMP.logros) || []).map(x => `<li class="${NK.guardado.logros[x.id] ? "ok" : ""}">${NK.guardado.logros[x.id] ? "🏆" : "🔒"} <b>${esc(x.nombre)}</b> — ${esc(x.descripcion)}</li>`).join(""); };
    $("#nk-cred1").onclick = () => cred("#nk-inicio"); $("#nk-cred2").onclick = () => cred("#nk-pausa");
    if ($("#nk-logros1")) { $("#nk-logros1").onclick = () => logros("#nk-inicio"); $("#nk-logros2").onclick = () => logros("#nk-pausa"); }
    $("#nk-cred-x").onclick = () => { ver("#nk-creditos", false); ver(volverA, true); };
    $("#nk-logros-x").onclick = () => { ver("#nk-logros", false); ver(volverA, true); };
    let tBanner = 0, tLogro = 0;
    NK.ui = {
      hud: on => ver("#nk-hud", on),
      mira: on => { $(".mira").style.display = on ? "block" : "none"; },
      aviso: (txt, ms = 1600) => { const a = $(".aviso"); a.textContent = txt; a.classList.add("ver"); clearTimeout(a._t); a._t = setTimeout(() => a.classList.remove("ver"), ms); },
      danio: () => { const d = $(".danio"); d.classList.add("ver"); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove("ver"), 180); },
      flash: (ms = 120) => { const d = $(".flash"); d.classList.add("ver"); clearTimeout(d._t); d._t = setTimeout(() => d.classList.remove("ver"), ms); },
      datos: s => {
        if (s.vida !== undefined) { $(".vt").textContent = Math.max(0, Math.ceil(s.vida)); $(".vida i").style.width = NK.clamp(100 * s.vida / (s.vidaMax || 100), 0, 100) + "%"; }
        if (s.puntos !== undefined) $(".pt").textContent = s.puntos;
        if (s.objetivo !== undefined) $(".ot").textContent = s.objetivo;
        if (s.progreso !== undefined) $(".op").textContent = s.progreso;
        if (s.tiempo !== undefined) { $(".tm").style.display = "block"; const t = Math.max(0, Math.floor(s.tiempo)); $(".tt").textContent = Math.floor(t / 60) + ":" + String(t % 60).padStart(2, "0"); }
        else if (s.sinTiempo) $(".tm").style.display = "none";
      },
      vidas: n => { $(".vidas").textContent = n > 0 ? "♥".repeat(Math.min(9, n)) : ""; },
      zona: (i, n, nombre) => { $(".zn").textContent = n > 1 ? `Zona ${i + 1}/${n} · ${nombre} — ` : ""; },
      banner: (t, sub, ms = 3200) => { const b = $("#nk-banner"); b.querySelector("h1").textContent = t; b.querySelector("p").textContent = sub || ""; b.classList.add("ver"); clearTimeout(tBanner); tBanner = setTimeout(() => b.classList.remove("ver"), ms); },
      jefe: (nombre, frac) => { const j = $(".jefe"); if (nombre == null) { j.classList.remove("ver"); return; } j.classList.add("ver"); j.querySelector("b").textContent = nombre; j.querySelector("i").style.width = NK.clamp(frac * 100, 0, 100) + "%"; },
      brujula: (ang, dist, txt) => { const b = $(".brujula"); if (ang == null) { b.classList.remove("ver"); return; } b.classList.add("ver"); b.querySelector("i").style.transform = `rotate(${ang - Math.PI / 2}rad)`; b.querySelector("small").textContent = (txt ? txt + " · " : "") + Math.round(dist) + " m"; },
      arma: (a, n) => { const e = $(".arma"); if (!a) { e.classList.remove("ver"); return; } e.classList.add("ver"); const img = e.querySelector("img"); img.onerror = () => { img.style.display = "none"; }; img.style.display = ""; img.src = icono("arma", a.id); e.querySelector("b").textContent = `${EMO_ARMA[a.tipo] || "⚔"} ${a.nombre}`; e.querySelector("small").textContent = n > 1 ? "Q / 1-" + n : ""; },
      efectos: lista => { $(".efectos").innerHTML = lista.map(x => `<span>${esc(x)}</span>`).join(""); },
      logro: (nombre, desc) => { const l = $("#nk-logro"); l.innerHTML = `🏆 <b>¡Logro!</b> ${esc(nombre)}<small>${esc(desc || "")}</small>`; l.classList.add("ver"); clearTimeout(tLogro); tLogro = setTimeout(() => l.classList.remove("ver"), 3800); },
      barra: html => { $(".barra").innerHTML = html; },
      fin: (gano, txt, extra) => { ver("#nk-hud", false); $("#nk-fin-t").textContent = gano ? "🏆 ¡Ganaste!" : "💀 Fin del juego"; $("#nk-fin-p").textContent = txt || ""; $("#nk-fin-x").innerHTML = extra || "";
        NK.travesia.gano = !!gano; $("#nk-otra").textContent = NK.travesia.activa && !gano && NK.travesia.puedeReintentar() ? "↻ Reintentar esta zona" : "↻ Jugar de nuevo"; ver("#nk-fin", true); },
      ver, $
    };
  }
  NK.estado = "menu";
  NK.jugar = () => {
    NK.audio(); ["#nk-inicio", "#nk-pausa", "#nk-fin", "#nk-creditos", "#nk-elegir", "#nk-mejora", "#nk-logros"].forEach(i => NK.ui.ver(i, false));
    NK.ui.hud(true); NK.estado = "jugando"; if (NK._musicaQuiere && NK.cfg.musica !== false) NK.musica(true);
    const cv = document.getElementById("lienzo"); if (cv && NK.cfg.motor !== "2d") NK.bloquearRaton(cv); if (cv) cv.focus();
    NK._alJugar && NK._alJugar();
  };
  NK.pausar = on => {
    if (NK.estado !== "jugando" && NK.estado !== "pausa") return;
    NK.estado = on ? "pausa" : "jugando"; NK.ui.ver("#nk-pausa", on);
    if (on && CAMP && NK.travesia.zona()) NK.ui.$("#nk-pausa-m").textContent = "🎯 " + NK.travesia.zona().nombre + ": " + NK.travesia.zona().objetivo.texto;
    if (on && document.pointerLockElement) document.exitPointerLock();
    if (!on) { const cv = document.getElementById("lienzo"); if (cv && NK.cfg.motor !== "2d") NK.bloquearRaton(cv); }
  };
  NK.terminar = (gano, txt, extra) => {
    if (NK.estado === "fin") return; NK.estado = "fin"; if (document.pointerLockElement) document.exitPointerLock();
    NK.sonido(gano ? "ganar" : "perder"); NK.gancho(gano ? "alGanar" : "alPerder", window.J); NK.ui.fin(gano, txt, extra);
  };
  addEventListener("keydown", e => {
    if (e.code === "Escape" || e.code === "KeyP") { if (NK.estado === "jugando") NK.pausar(true); else if (NK.estado === "pausa" && e.code === "KeyP") NK.pausar(false); }
    if (e.code === "Enter" && NK.estado === "menu") (NK.travesia.activa ? NK.travesia.elegir() : NK.jugar());
  });
  document.addEventListener("pointerlockchange", () => { if (!document.pointerLockElement && NK.estado === "jugando" && NK.cfg.motor !== "2d" && !NK.prueba && NK._pausaAlSoltar !== false) NK.pausar(true); });
  document.addEventListener("visibilitychange", () => { if (document.hidden && NK.estado === "jugando") NK.pausar(true); });

  /* ───────── Cinemáticas, diálogos y mejoras (devuelven promesas) ───────── */
  let cineFin = null, dialogoSig = null;
  NK.cinematica = (lineas, ms = 2600) => new Promise(ok => {
    if (NK.prueba && !QS.has("cine")) { ok(); return; }
    const el = document.getElementById("nk-cine"), tx = el.querySelector(".texto");
    const antes = NK.estado; NK.estado = "cine"; el.classList.add("ver"); NK.ui.hud(false);
    let i = 0, t = null;
    const fin = () => { clearTimeout(t); cineFin = null; PUL.clear(); el.classList.remove("ver"); tx.classList.remove("ver"); NK.estado = antes === "cine" ? "menu" : antes; ok(); };
    const sig = () => { if (i >= lineas.length) { fin(); return; } tx.classList.remove("ver"); setTimeout(() => { tx.textContent = lineas[i++]; tx.classList.add("ver"); }, 180); t = setTimeout(sig, ms); };
    cineFin = fin; sig();
  });
  NK.saltarCine = () => { if (cineFin) cineFin(); };
  NK.dialogo = (nombre, lineas, imagen) => new Promise(ok => {
    if (NK.prueba && !QS.has("cine")) { ok(); return; }
    const el = document.getElementById("nk-dialogo"), b = el.querySelector("b"), p = el.querySelector("p"), img = el.querySelector("img");
    const antes = NK.estado; NK.estado = "dialogo"; el.classList.add("ver"); b.textContent = nombre;
    img.style.display = imagen ? "" : "none"; if (imagen) { img.onerror = () => { img.style.display = "none"; }; img.src = imagen; }
    let i = 0, escribiendo = null;
    const mostrar = () => { const txt = lineas[i]; let k = 0; clearInterval(escribiendo);
      escribiendo = setInterval(() => { k += 2; p.textContent = txt.slice(0, k); if (k % 6 === 0) NK.sonido("dialogo"); if (k >= txt.length) { clearInterval(escribiendo); escribiendo = null; } }, 22); };
    dialogoSig = () => { if (escribiendo) { clearInterval(escribiendo); escribiendo = null; p.textContent = lineas[i]; return; }
      i++; if (i >= lineas.length) { dialogoSig = null; PUL.clear(); T.clear(); el.classList.remove("ver"); NK.estado = antes === "dialogo" ? "jugando" : antes; ok(); return; } mostrar(); };
    mostrar();
  });
  addEventListener("keydown", e => {
    if ((e.code === "Enter" || e.code === "Space" || e.code === "Escape") && cineFin) { e.preventDefault(); NK.saltarCine(); }
    else if ((e.code === "KeyE" || e.code === "Enter" || e.code === "Space") && dialogoSig && !e.repeat) { e.preventDefault(); dialogoSig(); }
  });
  addEventListener("mousedown", () => { if (dialogoSig) dialogoSig(); else if (cineFin) NK.saltarCine(); });
  NK.elegirMejora = (opciones, texto) => new Promise(ok => {
    if (NK.prueba && !QS.has("cine")) { ok(opciones[0] && opciones[0].id); return; }
    if (document.pointerLockElement) document.exitPointerLock();
    const antes = NK.estado; NK.estado = "mejora";
    NK.ui.$("#nk-mejora-p").textContent = texto || "";
    NK.ui.$("#nk-mejoras").innerHTML = opciones.map(o => `<button class="carta" data-m="${esc(o.id)}"><span class="emo">${esc(o.emo || "✨")}</span><b>${esc(o.nombre)}</b><small>${esc(o.desc || "")}</small></button>`).join("");
    NK.ui.ver("#nk-mejora", true);
    NK.ui.$("#nk-mejoras").querySelectorAll("[data-m]").forEach(b => b.onclick = () => { PUL.clear(); NK.ui.ver("#nk-mejora", false); NK.estado = antes === "mejora" ? "jugando" : antes; NK.sonido("potenciador"); ok(b.dataset.m);
      const cv = document.getElementById("lienzo"); if (cv && NK.cfg.motor !== "2d") NK.bloquearRaton(cv); });
  });

  /* ───────── 🗺 Travesía (zonas, vidas, trajes, armas, logros): la usan los 3 motores ───────── */
  const DIF = { facil: { danio: 0.6, vel: 0.9, vidas: 5, nombre: "Fácil" }, normal: { danio: 1, vel: 1, vidas: 0, nombre: "Normal" }, dificil: { danio: 1.45, vel: 1.15, vidas: 2, nombre: "Difícil" } };
  const MEJORA_INFO = { doble_salto: ["🦘", "Doble salto", "Salta otra vez en el aire"], danio_extra: ["🗡", "Más daño", "+25 % de daño"], vida_max: ["❤", "Más vida", "+25 de vida máxima"],
    velocidad: ["👟", "Más rápido", "+12 % de velocidad"], cadencia: ["⚡", "Ataque rápido", "Atacas un 20 % más rápido"], iman_permanente: ["🧲", "Imán", "Atraes lo que recoges"],
    alcance: ["🎯", "Más alcance", "+30 % de alcance"], regeneracion: ["🌿", "Regeneración", "Recuperas vida poco a poco"] };
  const TR = NK.travesia = {
    activa: !!CAMP, zonas: CAMP ? CAMP.zonas : [], i: 0, vidas: 3, dif: DIF.normal, traje: null, arma: null, armas: [], mejoras: new Set(),
    stats: { muertes: 0, derrotados: 0, recogidos: 0, miradores: 0, danioZona: 0, tZona: 0, t: 0, puntos: 0 }, adaptador: null,
    zona() { return this.zonas[this.i]; },
    trajes() { return (CAMP && CAMP.trajes && CAMP.trajes.length) ? CAMP.trajes : []; },
    armasTodas() { return (CAMP && CAMP.armas) || []; },
    desbloqueadoTraje(t) { return !t.desbloqueo || NK.guardado.puntos >= t.desbloqueo; },
    desbloqueadaArma(a, zona) { return !a.desbloqueo || Math.max(NK.guardado.zonaMax, zona == null ? this.i : zona) >= a.desbloqueo; },
    puedeReintentar() { return this.activa && this.i < this.zonas.length; },
    elegir() {
      const tr = this.trajes(), ar = this.armasTodas(), $ = NK.ui.$;
      if (NK.prueba) { this.traje = tr[0] || null; this.arma = ar[0] || null; this.comenzar(); return; }
      ["#nk-inicio"].forEach(i => NK.ui.ver(i, false)); NK.estado = "elegir";
      const selT = this.traje ? this.traje.id : (tr[0] && tr[0].id), selA = this.arma ? this.arma.id : (ar[0] && ar[0].id);
      const barra = (v, max) => `<div class="stat"><i style="width:${NK.clamp(v / max * 100, 5, 100)}%"></i></div>`;
      $("#nk-trajes").innerHTML = tr.map(t => { const ok = this.desbloqueadoTraje(t);
        return `<button class="carta ${t.id === selT ? "sel" : ""} ${ok ? "" : "bloq"}" data-t="${esc(t.id)}" ${ok ? "" : "disabled"}><img src="${icono("traje", t.id)}" onerror="this.outerHTML='<span class=emo style=color:${esc(t.color)}>🧍</span>'" alt="">
          <b>${esc(t.nombre)}</b><small>${esc(t.descripcion || "")}</small>${barra(t.vida || 1, 1.6)}${barra(t.velocidad || 1, 1.4)}${barra(t.salto || 1, 1.5)}
          ${ok ? "" : `<em>🔒 ${t.desbloqueo} puntos</em>`}</button>`; }).join("") || `<small>Personaje único</small>`;
      $("#nk-g-armas").style.display = ar.length ? "" : "none";
      $("#nk-armas").innerHTML = ar.map(a => { const ok = this.desbloqueadaArma(a, 0);
        return `<button class="carta ${a.id === selA ? "sel" : ""} ${ok ? "" : "bloq"}" data-a="${esc(a.id)}" ${ok ? "" : "disabled"}><img src="${icono("arma", a.id)}" onerror="this.outerHTML='<span class=emo>${EMO_ARMA[a.tipo] || "⚔"}</span>'" alt="">
          <b>${esc(a.nombre)}</b><small>${esc(a.descripcion || a.tipo)}</small>${barra(a.danio || 20, 50)}${barra(Math.min(a.alcance || 3, 40), 40)}
          ${ok ? "" : `<em>🔓 en la zona ${a.desbloqueo + 1}</em>`}</button>`; }).join("");
      const marcar = (sel, attr) => $(sel).querySelectorAll(`[data-${attr}]`).forEach(b => b.onclick = () => { $(sel).querySelectorAll(".carta").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); NK.sonido("poner"); });
      marcar("#nk-trajes", "t"); marcar("#nk-armas", "a");
      $("#nk-dif").querySelectorAll("[data-d]").forEach(b => b.onclick = () => { $("#nk-dif").querySelectorAll("button").forEach(x => x.classList.remove("sel")); b.classList.add("sel"); });
      $("#nk-volver").onclick = () => { NK.ui.ver("#nk-elegir", false); NK.ui.ver("#nk-inicio", true); NK.estado = "menu"; };
      $("#nk-comenzar").onclick = () => {
        const t = $("#nk-trajes .sel"), a = $("#nk-armas .sel"), d = $("#nk-dif .sel");
        this.traje = tr.find(x => t && x.id === t.dataset.t) || tr[0] || null; this.arma = ar.find(x => a && x.id === a.dataset.a) || ar[0] || null;
        this.dif = DIF[d ? d.dataset.d : "normal"] || DIF.normal; NK.ui.ver("#nk-elegir", false); this.comenzar();
      };
      NK.ui.ver("#nk-elegir", true);
    },
    armasDisponibles() { return this.armasTodas().filter(a => this.desbloqueadaArma(a)); },
    async comenzar() {
      this.i = 0; this.mejoras = new Set(); this.vidas = (CAMP.vidas || 3) + 0; if (this.dif.vidas) this.vidas = this.dif.vidas;
      Object.assign(this.stats, { muertes: 0, derrotados: 0, recogidos: 0, miradores: 0, danioZona: 0, tZona: 0, t: 0, puntos: 0 });
      NK.ui.vidas(this.vidas);
      const A = this.adaptador;
      if (A && A.preparar) await A.preparar(this.traje, this.arma, this.dif);
      if (CAMP.historia && CAMP.historia.intro && (CAMP.vistas || {}).intro !== false) { if (A && A.cine) A.cine("intro"); await NK.cinematica(CAMP.historia.intro, 2800); if (A && A.cine) A.cine(null); }
      await this.entrarZona(0);
    },
    async entrarZona(i) {
      this.i = i; const z = this.zona(); this.stats.danioZona = 0; this.stats.tZona = 0;
      NK.guardado.zonaMax = Math.max(NK.guardado.zonaMax, i); NK.guardar();
      NK.ui.zona(i, this.zonas.length, z.nombre); NK.ui.vidas(this.vidas);
      if (this.adaptador && this.adaptador.zona) await this.adaptador.zona(i, z);
      NK.jugar();
      NK.sonido("zona"); NK.ui.banner(z.nombre, z.descripcion || z.objetivo.texto, 3600);
      if (z.consejo && i === 0) setTimeout(() => NK.estado === "jugando" && NK.ui.aviso("💡 " + z.consejo, 5200), 3800);
      NK.gancho("alEntrarZona", window.J, z, i);
    },
    async zonaCompleta() {
      const z = this.zona(); if (!z || NK.estado === "fin") return;
      NK.gancho("alCompletarZona", window.J, z, this.i);
      if (this.stats.danioZona === 0) this.logro("sin_danio_zona", 1);
      if (this.stats.tZona < 90) this.logro("rapido", this.stats.tZona);
      if (this.i >= this.zonas.length - 1) { this.victoria(); return; }
      NK.sonido("ganar"); NK.ui.banner("✔ " + z.nombre, "¡Zona completada!", 2400);
      // nuevas armas que se desbloquean con la zona siguiente
      const nuevas = this.armasTodas().filter(a => a.desbloqueo === this.i + 1 && !this.desbloqueadaArma(a, this.i));
      const libres = ((CAMP.mejoras || []).filter(m => !this.mejoras.has(m) && MEJORA_INFO[m]));
      await new Promise(ok => setTimeout(ok, NK.prueba ? 10 : 1400));
      if (libres.length && NK.estado !== "fin") {
        const r = NK.rand((this.i + 1) * 97 + (NK.cfg.mundo.semilla | 0)); const ops = [];
        while (ops.length < Math.min(3, libres.length)) { const m = libres[Math.floor(r() * libres.length)]; if (!ops.includes(m)) ops.push(m); }
        const id = await NK.elegirMejora(ops.map(m => ({ id: m, emo: MEJORA_INFO[m][0], nombre: MEJORA_INFO[m][1], desc: MEJORA_INFO[m][2] })), `Antes de ${this.zonas[this.i + 1].nombre}`);
        if (id) { this.mejoras.add(id); if (this.adaptador && this.adaptador.mejora) this.adaptador.mejora(id); }
      }
      if (nuevas.length) setTimeout(() => NK.ui.aviso("🔓 Nueva arma: " + nuevas.map(a => a.nombre).join(", ") + " (Q)", 3500), 3800);
      await this.entrarZona(this.i + 1);
    },
    morir(motivo) {
      if (NK.estado === "fin") return;
      this.vidas--; this.stats.muertes++; NK.ui.vidas(this.vidas);
      if (this.vidas <= 0) { NK.terminar(false, (CAMP.historia && CAMP.historia.derrota) || "Te quedaste sin vidas.", `<p>Llegaste a <b>${esc(this.zona().nombre)}</b> (zona ${this.i + 1}/${this.zonas.length}).</p>`); return; }
      NK.sonido("perder"); NK.ui.banner("💔 " + (motivo || "¡Caíste!"), `Te quedan ${this.vidas} vida${this.vidas === 1 ? "" : "s"} · vuelves al punto de control`, 2600);
      if (this.adaptador && this.adaptador.respawn) this.adaptador.respawn();
    },
    async reintentar(desdeCero) {
      if (desdeCero) { NK._reiniciar && NK._reiniciar(); await this.comenzar(); return; }
      this.vidas = (CAMP.vidas || 3); if (this.dif.vidas) this.vidas = this.dif.vidas;
      await this.entrarZona(this.i);
    },
    victoria() {
      this.logro("jefe", 1); if (this.stats.muertes === 0) this.logro("sin_morir", 1);
      NK.guardado.puntos += this.stats.puntos; NK.guardado.record = Math.max(NK.guardado.record || 0, this.stats.puntos); NK.guardado.zonaMax = this.zonas.length; NK.guardar();
      const fin = async () => {
        if (CAMP.historia && CAMP.historia.final && !NK.prueba) { await NK.cinematica(CAMP.historia.final, 2600); }
        const lg = (CAMP.logros || []).filter(x => NK.guardado.logros[x.id]).map(x => "🏆 " + esc(x.nombre)).join(" · ");
        NK.terminar(true, `¡Travesía completada! ${this.stats.puntos} puntos · ${Math.round(this.stats.t)} s · ${this.stats.muertes} caída${this.stats.muertes === 1 ? "" : "s"}`,
          `<p>${lg || ""}</p><p class="small">Desbloqueas trajes con los puntos acumulados: ${NK.guardado.puntos}</p>`);
      };
      fin();
    },
    logro(tipo, valor) {
      for (const x of (CAMP && CAMP.logros) || []) {
        if (x.tipo !== tipo || NK.guardado.logros[x.id]) continue;
        const ok = tipo === "rapido" ? valor <= x.valor : tipo === "derrotar" ? valor >= x.valor : tipo === "miradores" ? valor >= x.valor : valor >= (x.valor || 1);
        if (!ok) continue;
        NK.guardado.logros[x.id] = Date.now(); NK.guardar(); NK.sonido("logro"); NK.ui.logro(x.nombre, x.descripcion); NK.gancho("alLogro", window.J, x);
      }
    }
  };
  /* ───────── Carga de modelos .glb (desde archivo, o desde activos_datos.js si se abrió con doble clic) ───────── */
  const cacheGLB = {};
  NK.tieneModelo = rol => !!(NK.activos.modelos && NK.activos.modelos[rol]);
  NK.cargarGLB = rol => {
    const url = NK.activos.modelos && NK.activos.modelos[rol];
    if (!url || !window.THREE || !THREE.GLTFLoader) return Promise.resolve(null);
    if (cacheGLB[url]) return cacheGLB[url];
    const loader = new THREE.GLTFLoader();
    const datos = window.ACTIVOS_DATOS && window.ACTIVOS_DATOS[url];
    cacheGLB[url] = new Promise(ok => {
      const fallo = e => { console.warn("No se pudo cargar el modelo", rol, url, e); ok(null); };
      if (datos && location.protocol === "file:") {
        const bin = atob(datos), buf = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
        try { loader.parse(buf.buffer, "", ok, fallo); } catch (e) { fallo(e); }
      } else if (location.protocol === "file:" && !datos) { fallo("abre el juego con jugar.bat para cargar modelos grandes"); }
      else loader.load(url, ok, undefined, fallo);
    });
    return cacheGLB[url];
  };

  /* ───────── Arranque ───────── */
  NK.iniciar = (alJugar, reiniciar, adaptador) => {
    NK._alJugar = alJugar; NK._reiniciar = reiniciar; if (adaptador) NK.travesia.adaptador = adaptador;
    if (!adaptador) NK.travesia.activa = false;
    crearUI(); tactil();
    const cv = document.getElementById("lienzo");
    if (cv) cv.addEventListener("click", () => { if (NK.estado === "jugando" && NK.cfg.motor !== "2d" && !NK.raton.bloqueado) NK.bloquearRaton(cv); });
    const car = document.querySelector(".nk-cargando"); if (car) car.remove();
    if (NK.prueba) setTimeout(() => (NK.travesia.activa ? NK.travesia.elegir() : NK.jugar()), 50);  // modo prueba (probar_web): empieza directo
  };
  window.estadoJuego = () => {
    const e = NK._estado ? NK._estado() : { estado: NK.estado };
    if (NK.travesia.activa) { const z = NK.travesia.zona(); Object.assign(e, { zona: NK.travesia.i + 1, zonas: NK.travesia.zonas.length, zonaNombre: z && z.nombre, vidas: NK.travesia.vidas,
      traje: NK.travesia.traje && NK.travesia.traje.id, arma: NK.travesia.arma && NK.travesia.arma.id, mejoras: [...NK.travesia.mejoras], logros: Object.keys(NK.guardado.logros) }); }
    return e;
  };
})();
