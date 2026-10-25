/* Noviq Game Kit — motor2d.js v2: juegos 2D en canvas (sin librerías), vista LATERAL (plataformas, aventura) o SUPERIOR
   (aventura, disparos, supervivencia, rol).
   • Gráficos HD (si el Estudio los creó: C.graficos2d): sprites animados sacados de las figuras 3D (Idle, correr, saltar,
     atacar, golpe, caer), fondos panorámicos por capas con parallax, baldosas con textura por tema, retratos en los diálogos.
     Sin ellos, sprites pixel art dibujados al vuelo (lo más liviano).
   • Travesía épica (C.campana): zonas encadenadas con su tema, objetivo, enemigos, obstáculos y contratiempo, guía que habla,
     punto de control, mirador panorámico, potenciadores, mejoras entre zonas, trajes y armas para elegir y el JEFE final
     con fases. Vidas y logros los lleva comun.js (NK.travesia).
   Diseño en juego.config.js · reglas propias en juego.js · sin crear objetos en el bucle (pools). */
(function () {
  "use strict";
  const C = NK.cfg, Q = NK.calidad(), TR = NK.travesia;
  const CAMP = NK.campana, G2 = C.graficos2d || null, HD = !!G2;
  document.title = C.titulo;
  const cv = document.getElementById("lienzo");
  const ctx = cv.getContext("2d");
  const W = 384, H = 216, T = 16;
  const K = HD ? (Q.nivel === "basico" ? 2 : 3) : 1;
  const LATERAL = C.camara !== "superior";
  if (!HD) cv.classList.add("pixel");
  function ajustar() { const f = Math.min(innerWidth / W, innerHeight / H);
    cv.width = W * K; cv.height = H * K; cv.style.width = W * f + "px"; cv.style.height = H * f + "px"; cv.style.margin = `${(innerHeight - H * f) / 2}px auto 0`;
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.imageSmoothingEnabled = HD; ctx.imageSmoothingQuality = "high"; }
  ajustar(); addEventListener("resize", ajustar);
  NK.infoRender = () => `2D ${W * K}×${H * K}${HD ? " HD" : " pixel"} · ${LATERAL ? "lateral" : "superior"}`;
  const semilla0 = (C.mundo.semilla | 0) + 3;
  let rnd = NK.rand(semilla0), ruido = NK.ruido(C.mundo.semilla | 0);

  /* ───────── Imágenes (hojas de sprites, fondos, baldosas) ───────── */
  const IMGS = {};
  const cargar = url => { if (!url) return null; if (IMGS[url]) return IMGS[url]; const im = new Image(); im.decoding = "async"; im.src = url; IMGS[url] = im; return im; };
  const lista = im => !!(im && im.complete && im.naturalWidth > 0);
  const esperar = im => new Promise(ok => { if (!im || im.complete) return ok(); im.addEventListener("load", ok, { once: true }); im.addEventListener("error", ok, { once: true }); setTimeout(ok, 8000); });
  function Hoja(def, altoMundo) {
    if (!def || !def.hoja || !def.meta) return null;
    const im = cargar(def.hoja), m = def.meta, fw = m.cuadro[0], fh = m.cuadro[1];
    const alto = altoMundo || NK.clamp(28 * (m.altura_m || 1.8) / 1.8, 10, 96);
    const s = alto / (m.alto_figura || fh);
    const ancho = NK.clamp((m.ancho_cuerpo_px || fw * 0.4) * s * (m.rig === "humanoide" ? 0.45 : 0.72), 8, 64);
    return { im, m, fw, fh, s, alto, ancho, px: m.pivote[0], py: m.pivote[1],
      anim(nombre, dir) { const A = m.anims; return A[dir ? `${nombre}_${dir}` : nombre] || A[nombre] || A[`${nombre}_abajo`] || A.Idle || A.Idle_abajo || A[Object.keys(A)[0]]; },
      dur(nombre) { const a = this.anim(nombre); return a ? a.cuadros / a.fps : 0.5; },
      dibujar(nombre, t, x, y, voltear, dir, alfa, escala) {
        if (!lista(im)) return false;
        const a = this.anim(nombre, dir); if (!a) return false;
        let f = Math.floor(t * a.fps); f = a.bucle ? ((f % a.cuadros) + a.cuadros) % a.cuadros : Math.min(a.cuadros - 1, Math.max(0, f));
        const k = s * (escala || 1), dw = fw * k, dh = fh * k;
        if (alfa != null && alfa < 1) ctx.globalAlpha = alfa;
        if (voltear) { ctx.save(); ctx.translate(Math.round(x), Math.round(y)); ctx.scale(-1, 1); ctx.drawImage(im, f * fw, a.fila * fh, fw, fh, -this.px * k, -this.py * k, dw, dh); ctx.restore(); }
        else ctx.drawImage(im, f * fw, a.fila * fh, fw, fh, x - this.px * k, y - this.py * k, dw, dh);
        ctx.globalAlpha = 1; return true;
      } };
  }

  /* ───────── Paleta y sprites pixel (respaldo sin gráficos HD) ───────── */
  const A0 = C.ambiente;
  const rgb = h => { const n = parseInt(String(h || "#888").replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const hx = c => "#" + c.map(v => Math.round(NK.clamp(v, 0, 255)).toString(16).padStart(2, "0")).join("");
  const mul = (h, f) => hx(rgb(h).map(v => v * f));
  const lienzo = (w, h) => { const c = document.createElement("canvas"); c.width = w; c.height = h; const x = c.getContext("2d"); x.imageSmoothingEnabled = false; return [c, x]; };
  function sprite(mapa, pal) { const h = mapa.length, w = mapa[0].length, [c, x] = lienzo(w, h);
    for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) { const k = mapa[j][i]; if (k !== "." && pal[k]) { x.fillStyle = pal[k]; x.fillRect(i, j, 1, 1); } } return c; }
  const espejo = img => { const [c, x] = lienzo(img.width, img.height); x.translate(img.width, 0); x.scale(-1, 1); x.drawImage(img, 0, 0); return c; };
  const PJ_COL = C.jugador.color || "#3fa9f5";
  const palJ = { o: "#1a1a1a", p: "#f1c9a5", r: PJ_COL, R: mul(PJ_COL, 0.7), b: "#3a3a5a", w: "#ffffff", h: C.tema === "medieval" ? "#aab2bc" : "#5a3a22" };
  const jugFr = [
    ["....hhhh....", "...hhhhhh...", "...pppppp...", "...pwopwo...", "...pppppp...", "....pppp....", "..rrrrrrrr..", ".prrrrrrrrp.", ".prrRRRRrrp.", "..rrrrrrrr..", "...bbbbbb...", "...bb..bb...", "...bb..bb...", "..ooo..ooo.."],
    ["....hhhh....", "...hhhhhh...", "...pppppp...", "...pwopwo...", "...pppppp...", "....pppp....", "..rrrrrrrr..", ".prrrrrrrrp.", ".prrRRRRrrp.", "..rrrrrrrr..", "...bbbbbb...", "..bb....bb..", ".bb......bb.", ".oo......oo."],
    ["....hhhh....", "...hhhhhh...", "...pppppp...", "...pwopwo...", "...pppppp...", "....pppp....", "..rrrrrrrr..", ".prrrrrrrrp.", ".prrRRRRrrp.", "..rrrrrrrr..", "...bbbbbb...", "....bbbb....", "....bb.bb...", "....oo.oo..."],
    ["....hhhh....", "...hhhhhh...", "...pppppp...", "...pwopwo...", "p..pppppp..p", "p...pppp...p", "prrrrrrrrrrp", "..rrrrrrrr..", "..rrRRRRrr..", "..rrrrrrrr..", "...bbbbbb...", "..bb....bb..", "..oo....oo..", "............"],
  ].map(m => sprite(m, palJ));
  const jugFrI = jugFr.map(espejo);
  const EC = (C.enemigos[0] || {}).color || "#8a5aff";
  const FORMAS2 = {
    slime: [["....eeeeee....", "..eeeeeeeeee..", ".eeewweeweeee.", ".eeewoeewoeee.", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", ".eeeeeeeeeeee.", "..EEEEEEEEEE.."], ["..............", "....eeeeee....", "..eeewweeweee..", ".eeeewoeewoeee.", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", "eeeeeeeeeeeeee", ".EEEEEEEEEEEE."]],
    humano: [["....eeee....", "...eeeeee...", "...ewweww...", "...eoeeoe...", "....eeee....", "..cccccccc..", ".ecccccccce.", ".ecccccccce.", "..cccccccc..", "...cccccc...", "...cc..cc...", "...cc..cc...", "..EEE..EEE.."], ["....eeee....", "...eeeeee...", "...ewweww...", "...eoeeoe...", "....eeee....", "..cccccccc..", "ecccccccccce", "..cccccccc..", "..cccccccc..", "...cccccc...", "..cc....cc..", ".cc......cc.", ".EE......EE."]],
    lobo: [["..............ee", ".............eee", ".eeeeeeeeeeeeewe", "eeeeeeeeeeeeeeee", "eeeeeeeeeeeeee..", ".ee..........ee.", ".ee..........ee.", ".EE..........EE."], ["..............ee", ".............eee", ".eeeeeeeeeeeeewe", "eeeeeeeeeeeeeeee", "eeeeeeeeeeeeee..", "..ee........ee..", "...ee......ee...", "...EE......EE..."]],
    vuela: [["e............e", "ee....ee....ee", ".eee.eeee.eee.", "..eeeweweeee..", "....eeeeee....", ".....eeee....."], ["..............", "......ee......", "..eeeeeeeeee..", "eeeeeweweeeeee", "e...eeeeee...e", ".....eeee....."]],
    robot: [["...eeeeee...", "...ewwwwe...", "...eoeeoe...", "...eeeeee...", ".....cc.....", "..cccccccc..", "c.cccccccc.c", "c.ccEEEEcc.c", "..cccccccc..", "...cc..cc...", "...cc..cc...", "..EEE..EEE.."], ["...eeeeee...", "...ewwwwe...", "...eoeeoe...", "...eeeeee...", ".....cc.....", "..cccccccc..", "c.cccccccc.c", "c.ccEEEEcc.c", "..cccccccc..", "...cc..cc...", "..cc....cc..", "..EE....EE.."]],
  };
  const FORMA2 = { mercenario: "humano", soldado: "humano", slime: "slime", alien: "slime", cangrejo: "slime", escorpion: "slime", zombie: "humano", esqueleto: "humano", fantasma: "humano", lobo: "lobo", zorro: "lobo", dinosaurio: "lobo", condor: "vuela", murcielago: "vuela", cuervo: "vuela", robot: "robot", humano: "humano" };
  const VUELAN = { condor: 1, murcielago: 1, cuervo: 1, fantasma: 1, abeja: 1, dron: 1, vuela: 1 };
  function spritesPixel(e) { const f = FORMAS2[FORMA2[e.forma] || "slime"], col = e.color || EC;
    const pal = { e: col, E: mul(col, 0.6), w: "#ffffff", o: "#111111", c: e.forma === "zombie" ? "#4a5a7a" : mul(col, 0.8) };
    if (e.forma === "esqueleto") Object.assign(pal, { e: "#f3efe4", E: "#bdb6a4", c: "#e8e2d0" });
    const fr = f.map(m => sprite(m, pal)); return { der: fr, izq: fr.map(espejo) }; }
  const OC = (C.objetos[0] || {}).color || "#ffd23f";
  const OBJ_SPR = {
    moneda: ["...yyyy...", "..yYYYYy..", ".yYyyyyYy.", ".yYyYYyYy.", ".yYyYYyYy.", ".yYyYYyYy.", ".yYyyyyYy.", "..yYYYYy..", "...yyyy..."],
    gema: ["....y....", "...yYy...", "..yYYYy..", ".yYwYYYy.", "yYwYYYYYy", ".yYYYYYy.", "..yYYYy..", "...yYy...", "....y...."],
    estrella: ["....y....", "....y....", "...yYy...", "yyyYYYyyy", ".yYYwYYy.", "..yYYYy..", ".yYy.yYy.", ".yy...yy.", "........."],
    corazon: [".yy...yy.", "yYYy.yYYy", "yYwYyYYYy", "yYYYYYYYy", ".yYYYYYy.", "..yYYYy..", "...yYy...", "....y...."],
  };
  OBJ_SPR.cristal = OBJ_SPR.gema; OBJ_SPR.fruta = OBJ_SPR.corazon; OBJ_SPR.botiquin = OBJ_SPR.corazon; OBJ_SPR.llave = OBJ_SPR.moneda; OBJ_SPR.huevo = OBJ_SPR.gema;
  const sprObj = (C.objetos || []).map(o => { const c = o.color || OC; return sprite(OBJ_SPR[o.forma] || OBJ_SPR.gema, { y: mul(c, 0.7), Y: c, w: "#ffffff" }); });

  /* ───────── Gráficos HD ───────── */
  const G = { jug: {}, enem: [], obj: [], npc: {}, jefe: null, fondos: {}, tiles: {} };
  const ALTO_J = LATERAL ? 30 : 27;
  if (HD) {
    for (const k in G2.jugador || {}) G.jug[k] = Hoja(G2.jugador[k], ALTO_J);
    G.enem = (G2.enemigos || []).map(h => Hoja(h));
    G.obj = (G2.objetos || []).map(h => Hoja(h, 12));
    for (const k in G2.npcs || {}) G.npc[k] = Hoja(G2.npcs[k], ALTO_J);
    G.jefe = Hoja(G2.jefe, NK.clamp(ALTO_J * ((CAMP && CAMP.jefe && CAMP.jefe.altura) || 3.6) / 1.8, 40, 110));
    for (const k in G2.fondos || {}) { const f = G2.fondos[k]; G.fondos[k] = { cielo: cargar(f.cielo), lejos: cargar(f.lejos), medio: cargar(f.medio), cerca: cargar(f.cerca) }; }
    for (const k in G2.tiles || {}) G.tiles[k] = cargar(G2.tiles[k]);
  }
  const ORDEN_T = (G2 && G2.orden_tiles) || ["tope", "tierra", "piedra", "ladrillo", "madera", "pinchos", "agua", "pared", "pasto", "arbol"];
  const TI = {}; ORDEN_T.forEach((n, i) => { TI[n] = i; });

  /* ───────── Zonas (travesía) o nivel único ───────── */
  const ZONAS = CAMP ? CAMP.zonas : [{ nombre: C.titulo, tema: C.tema, hora: A0.hora, objetivo: C.objetivo, enemigos: (C.enemigos || []).map((e, i) => ({ ref: i, cantidad: e.cantidad })),
    obstaculos: [], potenciadores: [], contratiempo: null, dificultad: 1, paleta: { cielo: A0.cielo, horizonte: A0.horizonte, suelo: A0.suelo, agua: A0.agua } }];
  const ARMAS = (CAMP && CAMP.armas) || [];
  const JEFE_CFG = CAMP && CAMP.jefe;
  let Z = ZONAS[0], zi = 0;
  const pal = () => Z.paleta || { cielo: A0.cielo, horizonte: A0.horizonte, suelo: A0.suelo, agua: A0.agua };
  const horaZ = () => (["dia", "noche", "atardecer"].includes(Z.hora) ? Z.hora : "dia");

  /* ───────── Tiles pixel (respaldo) ───────── */
  let TILES = {};
  function tilesPixel() {
    const P = pal(), S1 = P.suelo[1], S2 = P.suelo[2] || "#8b7a5a", S3 = P.suelo[3] || "#a8a39a";
    function tile(fn) { const [c, x] = lienzo(T, T); const r = NK.rand(Math.floor(rnd() * 1e6)); for (let j = 0; j < T; j++) for (let i = 0; i < T; i++) { const col = fn(i, j, r); if (col) { x.fillStyle = col; x.fillRect(i, j, 1, 1); } } return c; }
    const varc = (h, r, k = 0.12) => mul(h, 1 - k + r() * k * 2);
    TILES = {
      tope: tile((i, j, r) => j < 4 + (i % 5 === 0 ? 1 : 0) ? varc(S1, r) : varc(j % 7 === 0 && i % 4 === 1 ? mul(S2, 0.8) : S2, r)),
      tierra: tile((i, j, r) => varc(r() < 0.1 ? mul(S2, 0.8) : S2, r)), piedra: tile((i, j, r) => varc((i + j * 3) % 9 === 0 ? mul(S3, 0.75) : S3, r)),
      ladrillo: tile((i, j) => (j % 8 === 7 || (i + (Math.floor(j / 8) % 2 ? 8 : 0)) % 16 === 15) ? mul(S3, 0.6) : mul(S3, 0.95)),
      madera: tile((i, j, r) => j < 5 ? (j === 0 || j === 4 ? "#5a3d22" : varc("#a0763f", r, 0.08)) : null),
      pinchos: tile((i, j) => j > 8 && Math.abs((i % 8) - 3.5) < (j - 8) * 0.55 ? "#cfd6dc" : null),
      agua: tile((i, j, r) => j < 2 ? "#cde8ff" : varc(P.agua || "#2f6f9f", r, 0.05)), pared: tile((i, j, r) => varc((i % 8 === 0 || j % 8 === 0) ? mul(S3, 0.7) : S3, r, 0.08)),
      pasto: tile((i, j, r) => varc(r() < 0.08 ? mul(S1, 1.25) : S1, r, 0.1)),
      arbol: tile((i, j, r) => { const d = Math.hypot(i - 7.5, j - 6.5); return j > 11 && Math.abs(i - 7.5) < 2 ? "#6b4a2b" : d < 7 ? varc(d < 5 ? mul(S1, 0.8) : mul(S1, 0.6), r) : null; }),
    };
  }

  /* ───────── Nivel (se genera por zona) ───────── */
  // 0 aire, 1 sólido, 2 plataforma, 3 pinchos, 4 agua, 5 árbol/pared, 6 lodo, 7 fuego, 8 hielo, 9 zarzas (6-9: superficie peligrosa sobre el suelo)
  let MW = 0, MH = 0, mapa = new Uint8Array(1), lugares = [], enemigosIni = [], inicio = { x: 32, y: 0 }, metaPos = null, arena = null, miradorPos = null, npcPos = null;
  const at = (x, y) => (x < 0 || x >= MW) ? 1 : (y < 0 ? 0 : y >= MH ? (LATERAL ? 0 : 1) : mapa[x + y * MW]);
  const set = (x, y, v) => { if (x >= 0 && x < MW && y >= 0 && y < MH) mapa[x + y * MW] = v; };
  const solidoT = v => v === 1 || v === 5;
  const trampas = [];  // péndulos, troncos, cepos, rocas (pool)
  function generar(i) {
    rnd = NK.rand(semilla0 + i * 101); ruido = NK.ruido((C.mundo.semilla | 0) + i * 17);
    const dif = Z.dificultad || 1, ob = Z.objetivo || C.objetivo;
    const base = Math.round(NK.clamp(C.mundo.tamano || 120, 60, 400));
    const tamano = CAMP ? Math.round(NK.clamp(base * (0.75 + 0.2 * dif), 80, 260)) : base;
    lugares = []; enemigosIni = []; trampas.length = 0; metaPos = null; arena = null; miradorPos = null; npcPos = null;
    const obst = (Z.obstaculos || []).map(o => (typeof o === "string" ? o : o.tipo));
    const superficie = obst.find(o => ["lodo", "fuego", "hielo", "zarzas"].includes(o));
    if (LATERAL) {
      MW = tamano + (ob.tipo === "jefe" ? 34 : 0); MH = 18;
      mapa = new Uint8Array(MW * MH);
      let h = 13, sinHueco = 0;
      const fin = MW - (ob.tipo === "jefe" ? 36 : 10);
      for (let x = 0; x < MW; x++) {
        if (x > 12 && x < fin && sinHueco > 7 && rnd() < 0.1 + 0.03 * dif) { const ancho = 2 + Math.floor(rnd() * (dif > 1.2 ? 3 : 2)); for (let k = 0; k < ancho && x < fin; k++, x++) { if (Z.paleta && Z.paleta.agua) set(x, MH - 1, 4); } sinHueco = 0; x--; continue; }
        if (x > 8 && x < fin && rnd() < 0.18) h = NK.clamp(h + (rnd() < 0.5 ? -1 : 1), 9, 15);
        if (x >= fin) h = 13;
        for (let y = h; y < MH; y++) set(x, y, 1);
        if (x > 14 && x < fin && rnd() < 0.035 * dif && (obst.includes("pinchos") || !CAMP)) set(x, h - 1, 3);
        if (superficie && x > 16 && x < fin && x % 23 < 3) set(x, h - 1, { lodo: 6, fuego: 7, hielo: 8, zarzas: 9 }[superficie]);
        if (x > 8 && x % 11 === 0 && x < fin - 4) { const py = h - 3 - Math.floor(rnd() * 2), pw = 3 + Math.floor(rnd() * 3); for (let k = 0; k < pw; k++) set(x + k, py, 2); lugares.push({ x: (x + pw / 2) * T, y: (py - 1) * T }); }
        if (x > 16 && x % 9 === 4 && x < fin - 4) enemigosIni.push({ x: x * T, y: (h - 3) * T });
        if (x > 6 && x % 5 === 2 && x < fin - 2) lugares.push({ x: x * T + 8, y: (h - 2) * T - (x % 3) * 8 });
        if (x > 20 && x < fin - 6 && x % 37 === 17) {
          if (obst.includes("pendulo")) trampas.push({ tipo: "pendulo", x: x * T + 8, y: (h - 7) * T, t: rnd() * 6, l: 70 });
          else if (obst.includes("trampa")) trampas.push({ tipo: "cepo", x: x * T + 4, y: (h - 1) * T + 10, cerrado: 0 });
        }
        if (x === 5) npcPos = { x: x * T, y: (h - 2) * T };
        if (x === Math.round(tamano * 0.5) && Z.mirador) miradorPos = { x: x * T, y: (h - 2) * T };
        sinHueco++;
      }
      for (let y = 0; y < MH; y++) if (at(2, y)) { inicio = { x: 2 * T, y: (y - 2) * T }; break; }
      if (ob.tipo === "jefe") { const ax = fin + 2; arena = { x0: ax * T, x1: (MW - 2) * T, y: 13 * T }; for (let x = fin; x < MW; x++) for (let y = 0; y < MH; y++) set(x, y, y >= 13 ? 1 : 0); set(MW - 1, 12, 1); }
      for (let y = 0; y < MH; y++) if (at(fin - 3, y)) { metaPos = { x: (fin - 3) * T, y: (y - 2) * T }; break; }
      if (obst.includes("tronco")) trampas.push({ tipo: "tronco", x: 0, y: 0, vx: 0, vy: 0, activo: false, cd: 3, r: 7 });
      if (obst.includes("rocas")) for (let k = 0; k < 4; k++) trampas.push({ tipo: "roca", x: 0, y: 0, vy: 0, activo: false, cd: 1 + k * 1.3, aviso: 0 });
    } else {
      MW = Math.round(tamano / 2.2); MH = Math.round(tamano / 3.2);
      mapa = new Uint8Array(MW * MH);
      for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) {
        const borde = x === 0 || y === 0 || x === MW - 1 || y === MH - 1, n = ruido.fbm(x * 0.12, y * 0.12, 3), d0 = Math.hypot(x - MW / 2, y - MH / 2);
        if (borde) set(x, y, 1); else if (d0 > 4 && n > 0.32) set(x, y, pal().agua ? 4 : 5); else if (d0 > 4 && rnd() < 0.05) set(x, y, 5);
        else if (superficie && d0 > 6 && rnd() < 0.02) set(x, y, { lodo: 6, fuego: 7, hielo: 8, zarzas: 9 }[superficie]);
        else if (obst.includes("pinchos") && d0 > 6 && rnd() < 0.012) set(x, y, 3);
      }
      inicio = { x: MW / 2 * T, y: MH / 2 * T };
      npcPos = { x: inicio.x + 28, y: inicio.y - 10 };
      for (let k = 0; k < 400 && lugares.length < 60; k++) { const x = 1 + Math.floor(rnd() * (MW - 2)), y = 1 + Math.floor(rnd() * (MH - 2)); if (!at(x, y) && Math.hypot(x - MW / 2, y - MH / 2) > 4) lugares.push({ x: x * T + 8, y: y * T + 8 }); }
      for (let k = 0; k < 400 && enemigosIni.length < 40; k++) { const x = 1 + Math.floor(rnd() * (MW - 2)), y = 1 + Math.floor(rnd() * (MH - 2)); if (!at(x, y) && Math.hypot(x - MW / 2, y - MH / 2) > 9) enemigosIni.push({ x: x * T, y: y * T }); }
      let best = null; for (const L of lugares) if (!best || Math.hypot(L.x - inicio.x, L.y - inicio.y) > Math.hypot(best.x - inicio.x, best.y - inicio.y)) best = L;
      metaPos = best ? { x: best.x - 8, y: best.y - 8 } : { x: T * 2, y: T * 2 };
      if (ob.tipo === "jefe" && best) { arena = { x0: best.x - 90, x1: best.x + 90, y: best.y }; for (let y = 0; y < MH; y++) for (let x = 0; x < MW; x++) if (Math.hypot(x * T - best.x, y * T - best.y) < 110 && !(x === 0 || y === 0 || x === MW - 1 || y === MH - 1)) set(x, y, 0); }
      if (Z.mirador && lugares.length > 5) miradorPos = { x: lugares[5].x, y: lugares[5].y };
      if (obst.includes("rocas")) for (let k = 0; k < 4; k++) trampas.push({ tipo: "roca", x: 0, y: 0, vy: 0, activo: false, cd: 1 + k * 1.3, aviso: 0 });
    }
    construirCapa();
  }

  /* capa estática del nivel pre-dibujada por trozos (1 drawImage por trozo visible) */
  const TROZO = 48;
  let trozos = [];
  function tileImg(nombre) { const set_ = HD && G.tiles[Z.tema] ? G.tiles[Z.tema] : HD ? G.tiles[Object.keys(G.tiles)[0]] : null;
    return set_ && lista(set_) ? [set_, TI[nombre] * set_.height, set_.height] : null; }
  function construirCapa() {
    const ts = HD ? (G.tiles[Z.tema] || G.tiles[Object.keys(G.tiles)[0]]) : null;
    if (!ts || !lista(ts)) tilesPixel();
    const R = HD ? 2 : 1; trozos = [];
    for (let x0 = 0; x0 < MW; x0 += TROZO) {
      const w = Math.min(TROZO, MW - x0), [c, cx] = lienzo(w * T * R, MH * T * R); cx.imageSmoothingEnabled = HD; if (HD) cx.imageSmoothingQuality = "high";
      const dib = (n, x, y) => { const ti = tileImg(n); if (ti) cx.drawImage(ti[0], ti[1], 0, ti[2], ti[2], (x - x0) * T * R, y * T * R, T * R, T * R); else if (TILES[n]) cx.drawImage(TILES[n], (x - x0) * T * R, y * T * R, T * R, T * R); };
      for (let y = 0; y < MH; y++) for (let x = x0; x < x0 + w; x++) {
        const v = mapa[x + y * MW];
        if (!LATERAL && v !== 1) dib("pasto", x, y);
        if (v === 1) dib(LATERAL ? (at(x, y - 1) === 1 || at(x, y - 1) >= 6 ? (y > MH - 4 ? "piedra" : "tierra") : "tope") : "pared", x, y);
        else if (v === 2) dib("madera", x, y);
        else if (v === 3) dib("pinchos", x, y);
        else if (v === 4) dib("agua", x, y);
        else if (v === 5) dib("arbol", x, y);
        else if (v >= 6) { const col = { 6: "rgba(80,56,30,.85)", 7: "rgba(255,110,30,.9)", 8: "rgba(190,230,255,.85)", 9: "rgba(60,90,40,.95)" }[v];
          cx.fillStyle = col; cx.fillRect((x - x0) * T * R, (y * T + (LATERAL ? 11 : 2)) * R, T * R, (LATERAL ? 5 : 12) * R);
          if (v === 9 || v === 7) for (let k = 0; k < 4; k++) { cx.fillStyle = v === 7 ? "rgba(255,220,90,.9)" : "rgba(40,60,25,1)"; const px = ((x - x0) * T + 2 + k * 4) * R; cx.beginPath(); cx.moveTo(px, (y * T + 12) * R); cx.lineTo(px + 2 * R, (y * T + (v === 7 ? 4 : 6)) * R); cx.lineTo(px + 4 * R, (y * T + 12) * R); cx.fill(); } }
      }
      trozos.push({ x: x0 * T, w: w * T, c, R });
    }
  }
  // fondo pixel de respaldo (montañas y nubes pre-dibujadas)
  let fondoPix = null, montePix = null;
  const nubes = []; for (let i = 0; i < 7; i++) nubes.push({ x: Math.random() * W * 2, y: 10 + Math.random() * 60, w: 30 + Math.random() * 40 });
  function fondoPixel() {
    const P = pal(), noche = horaZ() === "noche"; const S1 = P.suelo[1], S3 = P.suelo[3] || "#a8a39a";
    const [f, fx] = lienzo(W * 2, H); const g = fx.createLinearGradient(0, 0, 0, H); g.addColorStop(0, noche ? mul(P.cielo, 0.4) : P.cielo); g.addColorStop(1, noche ? mul(P.horizonte, 0.5) : P.horizonte);
    fx.fillStyle = g; fx.fillRect(0, 0, W * 2, H);
    const [m, mx] = lienzo(W * 2, H);
    for (const [col, alto, fr] of [[mul(S3, noche ? 0.4 : 0.85), 70, 0.013], [mul(S1, noche ? 0.35 : 0.7), 45, 0.03]]) { mx.fillStyle = col; mx.beginPath(); mx.moveTo(0, H); for (let x = 0; x <= W * 2; x += 4) mx.lineTo(x, H - alto - ruido.fbm(x * fr, alto, 3) * alto * 0.9 - 20); mx.lineTo(W * 2, H); mx.fill(); }
    fondoPix = f; montePix = m;
  }

  /* ───────── Entidades ───────── */
  const ALTO_E = 28;
  const jug = { x: 0, y: 0, vx: 0, vy: 0, w: HD ? (LATERAL ? 12 : 10) : 10, h: HD ? (LATERAL ? 26 : 8) : 14, enSuelo: false, coyote: 0, buffer: 0, dir: 1, dir4: "abajo", t: 0, vida: C.jugador.vida, vidaMax: C.jugador.vida,
    puntos: 0, invul: 0, ataque: 0, cd: 0, anim: "Idle", tAnim: 0, saltosAire: 0, lento: 1, hielo: 0, cepo: 0, mult: { vida: 1, vel: 1, salto: 1, danio: 1, cad: 1, alc: 1 }, efectos: {} };
  const VEL0 = NK.clamp(C.jugador.velocidad || 7, 3, 20) * 13, SALTO0 = NK.clamp(C.jugador.salto || 8, 4, 16) * (HD && LATERAL ? 40 : 36), GRAV = 900;
  const tiposE = (C.enemigos || []).map((e, i) => ({ e, i, hoja: G.enem[i] || null, pix: spritesPixel(e), vuela: !!VUELAN[e.forma] }));
  const enemigos = [];
  for (let k = 0; k < 44; k++) enemigos.push({ activo: false, tp: null, cfg: {}, x: 0, y: 0, x0: 0, y0: 0, vx: 0, vy: 0, w: 12, h: 12, dir: 1, vida: 30, vidaMax: 30, t: 0, muriendo: 0, cd: 0, golpe: 0, ladron: 0, robado: 0 });
  const objetos = []; for (let k = 0; k < 80; k++) objetos.push({ activo: false, oi: 0, cfg: {}, x: 0, y: 0, t: 0, zona: 0 });
  const potes = []; for (let k = 0; k < 8; k++) potes.push({ activo: false, tipo: "curacion", x: 0, y: 0, t: 0 });
  const balas = []; for (let i = 0; i < 40; i++) balas.push({ x: 0, y: 0, vx: 0, vy: 0, vida: 0, enemiga: false, danio: 10, col: "#ffe27a", r: 2 });
  const parts = []; for (let i = 0; i < 260; i++) parts.push({ x: 0, y: 0, vx: 0, vy: 0, vida: 0, c: "#fff", g: 400 });
  const gotas = []; for (let i = 0; i < 140; i++) gotas.push({ x: Math.random() * W, y: Math.random() * H, v: 200 + Math.random() * 120 });
  const jefe = { activo: false, presentado: false, x: 0, y: 0, vx: 0, vy: 0, w: 30, h: 50, dir: -1, vida: 1, vidaMax: 1, t: 0, fase: 0, hab: null, tHab: 0, cd: 2, golpe: 0, muriendo: 0, enSuelo: false, anim: "Idle", tAnim: 0 };
  const npc = { activo: false, x: 0, y: 0, hablado: false, t: 0 };
  let pSig = 0, sacudida = 0;
  const chispa = (x, y, c, n = 10, f = 90, g = 400) => { for (let k = 0; k < n; k++) { const p = parts[pSig++ % parts.length]; p.x = x; p.y = y; p.vx = (rnd() - 0.5) * f * 2; p.vy = (rnd() - 0.8) * f * 1.6; p.vida = 0.4 + rnd() * 0.4; p.c = c; p.g = g; } };
  const P = { t: 0, recogidos: 0, derrotados: 0, derrotadosTotal: 0, total: 1, tiempoRestante: 0, spawn: 0, completa: false, contra: null, contraT: 0, contraHecho: false, relampago: 3, miradorVisto: false, cine: 0, cineX: 0 };
  let OBJ = Z.objetivo || C.objetivo;
  let ultimoSeguro = { x: 0, y: 0 };

  /* ───────── Física con tiles ───────── */
  const solidoEn = (px, py, desdeArriba) => { const v = at(Math.floor(px / T), Math.floor(py / T)); return v === 1 || v === 5 || (v === 2 && desdeArriba && LATERAL); };
  function mover(o, dt, esJug) {
    o.x += o.vx * dt; o.chocoX = false;
    const ys = o.h > 18 ? [o.y + 1, o.y + o.h / 2, o.y + o.h - 1] : [o.y + 1, o.y + o.h - 1];
    for (const yy of ys) { if (o.vx > 0 && solidoEn(o.x + o.w, yy)) { o.x = Math.floor((o.x + o.w) / T) * T - o.w - 0.01; o.vx = 0; o.chocoX = true; } else if (o.vx < 0 && solidoEn(o.x, yy)) { o.x = (Math.floor(o.x / T) + 1) * T + 0.01; o.vx = 0; o.chocoX = true; } }
    const piesAntes = o.y + o.h; o.y += o.vy * dt; o.enSuelo = false;
    for (const xx of [o.x + 1, o.x + o.w - 1]) {
      if (o.vy >= 0) { const ty = Math.floor((o.y + o.h) / T), v = at(Math.floor(xx / T), ty); const tope = v === 1 || v === 5 || (v === 2 && LATERAL && piesAntes <= ty * T + 1); if (tope) { o.y = ty * T - o.h; o.vy = 0; o.enSuelo = true; } }
      else if (solidoEn(xx, o.y) && at(Math.floor(xx / T), Math.floor(o.y / T)) !== 2) { o.y = (Math.floor(o.y / T) + 1) * T; o.vy = 0; }
    }
    if (esJug) {
      const cx = Math.floor((o.x + o.w / 2) / T), t = at(cx, Math.floor((o.y + o.h - 2) / T));
      o.lento = 1; o.hielo = 0;
      if (t === 3) danio(15, "pinchos");
      if (t === 4 && LATERAL) { danio(20, "agua"); reaparecer(); }
      if (t === 6) o.lento = 0.55;
      if (t === 7) danio(8, "fuego");
      if (t === 8) o.hielo = 1;
      if (t === 9) { o.lento = 0.7; danio(5, "zarzas"); }
    }
  }
  function reaparecer() { jug.x = ultimoSeguro.x; jug.y = ultimoSeguro.y - 4; jug.vx = jug.vy = 0; }
  function danio(n, motivo) {
    if (jug.invul > 0 || NK.estado !== "jugando" || jug.efectos.escudo > 0) return; if (NK.gancho("alDanio", J, n) === false) return;
    n *= (TR.activa ? TR.dif.danio : 1);
    jug.vida -= n; jug.invul = 1; sacudida = 0.25; NK.sonido("danio"); NK.ui.danio(); chispa(jug.x + jug.w / 2, jug.y + jug.h / 2, "#ff4a4a", 8);
    jug.anim = "Hit"; jug.tAnim = 0; if (TR.activa) TR.stats.danioZona += n;
    if (jug.vida <= 0) { jug.vida = 0; jug.anim = "Death"; jug.tAnim = 0; morir(motivo); }
  }
  function morir(motivo) {
    if (TR.activa) { NK.estado = "caida"; setTimeout(() => TR.morir(motivo === "agua" ? "¡Caíste al agua!" : motivo === "jefe" ? "¡El jefe te derrotó!" : "¡Caíste!"), 900); }
    else NK.terminar(false, `Te quedaste sin vida. Puntos: ${jug.puntos}`);
  }
  function herir(en, n) { if (en.muriendo) return; en.vida -= n; en.golpe = 0.18; en.vx += jug.dir * 80; NK.sonido("golpe"); chispa(en.x + en.w / 2, en.y + en.h / 2, "#ffffff", 5);
    if (en.vida <= 0) { en.muriendo = 0.6; en.tAnim = 0; P.derrotados++; P.derrotadosTotal++; jug.puntos += 25; if (TR.activa) { TR.stats.derrotados++; TR.stats.puntos += 25; TR.logro("derrotar", P.derrotadosTotal); }
      chispa(en.x + en.w / 2, en.y + en.h / 2, en.cfg.color || EC, 16); if (en.robado) { P.recogidos += en.robado; NK.ui.aviso(`💰 ¡Recuperaste ${en.robado}!`, 2000); en.robado = 0; } NK.gancho("alDerrotar", J, en); } }
  function herirJefe(n) { if (!jefe.activo || jefe.muriendo) return; jefe.vida -= n; jefe.golpe = 0.15; NK.sonido("golpe"); chispa(jefe.x + jefe.w / 2, jefe.y + jefe.h / 3, "#ffffff", 6);
    NK.ui.jefe(JEFE_CFG.nombre, Math.max(0, jefe.vida) / jefe.vidaMax);
    if (jefe.vida <= 0) { jefe.muriendo = 1.4; jefe.anim = "Death"; jefe.tAnim = 0; sacudida = 0.6; NK.sonido("ganar"); chispa(jefe.x + jefe.w / 2, jefe.y + jefe.h / 2, "#ffd23f", 40, 160); setTimeout(() => { NK.ui.jefe(null); completarZona(); }, 1500); } }

  /* ───────── Zona: preparar, poblar, completar ───────── */
  function ref(e) { return tiposE[e.ref] || tiposE[0]; }
  function activarEnemigo(tp, L, extra) {
    const en = enemigos.find(x => !x.activo); if (!en || !tp) return null;
    const h = tp.hoja, alto = h ? h.alto : 12, ancho = h ? h.ancho : 12, v = (tp.e.vida || 30) * (0.85 + 0.15 * (Z.dificultad || 1));
    Object.assign(en, { activo: true, tp, cfg: tp.e, x: L.x, y: L.y - (alto - 12), x0: L.x, y0: L.y, vx: 0, vy: 0, w: HD ? ancho : 12, h: HD ? (LATERAL ? alto * 0.9 : 8) : 12, dir: rnd() < 0.5 ? -1 : 1,
      vida: v, vidaMax: v, t: rnd() * 5, muriendo: 0, cd: 0, golpe: 0, ladron: 0, robado: 0, tAnim: 0 }, extra || {});
    if (!LATERAL && HD) en.y = L.y;
    return en;
  }
  function poblar() {
    enemigos.forEach(e => { e.activo = false; });
    const lst = (Z.enemigos && Z.enemigos.length ? Z.enemigos : [{ ref: 0, cantidad: 3 }]);
    let k = 0;
    for (const e of lst) { const tp = ref(e); if (!tp || tp.e.comportamiento === "rival") continue; const n = Math.round((e.cantidad || 3) * (OBJ.tipo === "sobrevivir" ? 0.6 : OBJ.tipo === "jefe" ? 0.45 : 1));
      for (let i = 0; i < n; i++) { const L = enemigosIni[k++ % Math.max(1, enemigosIni.length)]; if (L && Math.abs(L.x - inicio.x) > 80) activarEnemigo(tp, L); } }
    objetos.forEach(o => { o.activo = false; });
    const libres = lugares.slice().sort(() => rnd() - 0.5); let li = 0;
    (C.objetos || []).forEach((o, oi) => { const n = oi === 0 && OBJ.tipo === "recolectar" ? Math.max(OBJ.cantidad || 5, 3) + 2 : Math.round((o.cantidad || 0) * (CAMP ? 0.4 : 1));
      for (let i = 0; i < n && li < libres.length; i++) { const ob = objetos.find(x => !x.activo); if (!ob) break; const L = libres[li++]; Object.assign(ob, { activo: true, oi, cfg: o, x: L.x, y: L.y, t: rnd() * 6, zona: zi }); } });
    potes.forEach(p => { p.activo = false; });
    (Z.potenciadores || []).slice(0, potes.length).forEach((tipo, i) => { const L = libres[li++]; if (L) Object.assign(potes[i], { activo: true, tipo, x: L.x, y: L.y, t: 0 }); });
    npc.activo = !!(Z.npc && npcPos); npc.hablado = false; if (npc.activo) { npc.x = npcPos.x; npc.y = npcPos.y; }
    if (JEFE_CFG) { jefe.activo = false; jefe.presentado = false; jefe.muriendo = 0; }
  }
  function prepararZona(i) {
    zi = i; Z = ZONAS[i]; OBJ = Z.objetivo || C.objetivo;
    generar(i); if (!HD || !G.fondos[`${Z.tema}_${horaZ()}`]) fondoPixel();
    Object.assign(P, { recogidos: 0, derrotados: 0, total: OBJ.cantidad || 1, tiempoRestante: OBJ.tipo === "sobrevivir" ? (OBJ.cantidad || OBJ.tiempo || 60) : (OBJ.tiempo || 0), spawn: 0,
      completa: false, contra: null, contraT: 0, contraHecho: false, miradorVisto: false, cine: 0 });
    poblar();
    if (OBJ.tipo === "recolectar") P.total = Math.min(OBJ.cantidad || 5, objetos.filter(o => o.activo && o.oi === 0).length || 1);
    if (OBJ.tipo === "jefe") P.total = 1;
    Object.assign(jug, { x: inicio.x, y: inicio.y, vx: 0, vy: 0, invul: 1.5, dir: 1, anim: "Idle", tAnim: 0, efectos: {} });
    ultimoSeguro = { x: inicio.x, y: inicio.y }; balas.forEach(b => { b.vida = 0; });
    cam.x = jug.x - W / 2; cam.y = jug.y - H / 2;
    NK.ui.datos({ sinTiempo: !(P.tiempoRestante > 0) }); NK.ui.jefe && NK.ui.jefe(null);
  }
  function completarZona() {
    if (P.completa) return; P.completa = true; jug.puntos += 100; if (TR.activa) TR.stats.puntos += 100;
    if (OBJ.tipo === "recolectar" && !objetos.some(o => o.activo && o.oi === 0)) TR.activa && TR.logro("recoger_todo", 1);
    if (TR.activa) { NK.sonido("ganar"); setTimeout(() => { if (NK.estado !== "fin") TR.zonaCompleta(); }, NK.prueba ? 50 : 900); }
    else NK.terminar(true, `¡Objetivo cumplido! Puntos: ${jug.puntos}`);
  }
  function progresoZona() {
    switch (OBJ.tipo) { case "recolectar": case "construir": return P.recogidos / Math.max(1, P.total); case "derrotar": return P.derrotados / Math.max(1, P.total);
      case "sobrevivir": return 1 - P.tiempoRestante / Math.max(1, OBJ.cantidad || OBJ.tiempo || 60); case "jefe": return jefe.presentado ? 1 - jefe.vida / jefe.vidaMax : 0;
      default: return metaPos ? NK.clamp((jug.x - inicio.x) / Math.max(1, metaPos.x - inicio.x), 0, 1) : 0; }
  }

  /* ───────── Contratiempos ───────── */
  function iniciarContratiempo(c) {
    P.contra = c; P.contraT = c.tipo === "emboscada" ? 1 : 30; P.contraHecho = true;
    NK.ui.banner("⚠ " + ({ tormenta: "¡Tormenta!", noche: "¡Cae la noche!", emboscada: "¡Emboscada!", ladron: "¡Un ladrón!", derrumbe: "¡Derrumbe!", niebla: "Niebla espesa" }[c.tipo] || "¡Contratiempo!"), c.texto || "", 3200);
    NK.sonido(c.tipo === "tormenta" ? "trueno" : "jefe"); NK.gancho("alContratiempo", J, c);
    if (c.tipo === "emboscada") { const tp = ref((Z.enemigos || [])[0] || { ref: 0 }); for (let k = 0; k < 4; k++) activarEnemigo(tp, { x: jug.x + (k % 2 ? 1 : -1) * (90 + k * 20), y: jug.y - 30 }, {}); }
    if (c.tipo === "ladron") { const tp = ref((Z.enemigos || [])[0] || { ref: 0 }); const en = activarEnemigo(tp, { x: jug.x + 70, y: jug.y - 20 }, { ladron: 1 });
      if (en) { const k = OBJ.tipo === "recolectar" ? Math.min(3, P.recogidos) : 0; en.robado = k; P.recogidos -= k; en.vida *= 0.7; if (k) NK.ui.aviso(`💰 Te robó ${k}. ¡Atrápalo!`, 2600); } }
    if (c.tipo === "derrumbe" && !trampas.some(t => t.tipo === "roca")) for (let k = 0; k < 4; k++) trampas.push({ tipo: "roca", x: 0, y: 0, vy: 0, activo: false, cd: k * 0.8, aviso: 0, temporal: true });
  }
  function actualizarContratiempo(dt) {
    const c = P.contra; if (!c) return; P.contraT -= dt;
    if (c.tipo === "tormenta") { P.relampago -= dt; if (P.relampago <= 0) { P.relampago = 4 + rnd() * 6; NK.ui.flash(140); setTimeout(() => NK.sonido("trueno"), 300 + rnd() * 700); } if (LATERAL) jug.vx -= 22 * dt; }
    if (P.contraT <= 0 && c.tipo !== "ladron") { P.contra = null; for (let k = trampas.length - 1; k >= 0; k--) if (trampas[k].temporal) trampas.splice(k, 1); NK.ui.aviso("🌤 El contratiempo pasó", 1800); }
  }

  /* ───────── Jefe ───────── */
  function presentarJefe() {
    if (!JEFE_CFG || jefe.presentado) return;
    const hj = G.jefe, alto = hj ? hj.alto : 40;
    const jh = LATERAL ? alto * 0.92 : 14;
    Object.assign(jefe, { activo: true, presentado: true, x: arena ? (LATERAL ? Math.min(arena.x1 - 60, Math.max(jug.x + 150, arena.x0 + 170)) : arena.x0 + 120) : jug.x + 140, y: arena ? arena.y - jh - (LATERAL ? 2 : 0) : jug.y - jh, vx: 0, vy: 0,
      w: hj ? NK.clamp(hj.ancho * 1.1, 20, 70) : 30, h: jh, vida: (JEFE_CFG.vida || 500) * 0.35 * (TR.activa ? TR.dif.danio : 1), fase: 0, hab: null, tHab: 0, cd: 2.5, dir: -1, t: 0, muriendo: 0, anim: "Idle", tAnim: 0 });
    jefe.vidaMax = jefe.vida; NK.sonido("jefe"); sacudida = 0.4;
    NK.ui.jefe(JEFE_CFG.nombre, 1); NK.ui.banner("☠ " + JEFE_CFG.nombre, (JEFE_CFG.fases || []).length > 1 ? `${JEFE_CFG.fases.length} fases` : "¡Derrótalo!", 3000);
    if (!NK.prueba && (JEFE_CFG.dialogo || []).length) { NK.estado = "cine"; setTimeout(async () => { await NK.dialogo(JEFE_CFG.nombre, JEFE_CFG.dialogo.slice(0, 2), "assets/iconos/jefe.png"); if (NK.estado === "cine" || NK.estado === "dialogo") NK.estado = "jugando"; }, 900); }
  }
  function disparar(x, y, vx, vy, enemiga, danioN, col, r) { const b = balas.find(q => q.vida <= 0); if (!b) return; Object.assign(b, { x, y, vx, vy, vida: 1.6, enemiga, danio: danioN, col: col || "#ffe27a", r: r || 2 }); }
  function actualizarJefe(dt) {
    if (!jefe.activo) return;
    jefe.t += dt; jefe.tAnim += dt; jefe.golpe = Math.max(0, jefe.golpe - dt);
    if (jefe.muriendo > 0) { jefe.muriendo -= dt; if (jefe.muriendo <= 0) jefe.activo = false; return; }
    const fases = JEFE_CFG.fases && JEFE_CFG.fases.length ? JEFE_CFG.fases : [{ umbral: 1, habilidad: "embestida" }];
    const frac = jefe.vida / jefe.vidaMax; let f = 0; fases.forEach((q, i) => { if (frac <= q.umbral + 1e-6) f = i; });
    if (f !== jefe.fase) { jefe.fase = f; NK.ui.banner("⚡ " + JEFE_CFG.nombre, `Fase ${f + 1}: ${fases[f].habilidad}`, 2000); NK.sonido("jefe"); sacudida = 0.3; }
    const dx = jug.x - jefe.x, dy = jug.y - jefe.y, vel = NK.clamp(JEFE_CFG.velocidad || 3.4, 1, 8) * 12 * (TR.activa ? TR.dif.vel : 1);
    jefe.dir = Math.sign(dx) || jefe.dir;
    jefe.cd -= dt;
    if (!jefe.hab && jefe.cd <= 0) { jefe.hab = fases[f].habilidad; jefe.tHab = 0; jefe.anim = "Attack"; jefe.tAnim = 0; }
    const h = jefe.hab;
    if (h) {
      jefe.tHab += dt;
      if (h === "embestida") { jefe.vx = jefe.tHab < 0.5 ? 0 : jefe.dir * vel * 4.2; if (jefe.tHab > 1.6) terminarHab(); }
      else if (h === "proyectiles") { if (jefe.tHab > 0.4 && !jefe.lanzo) { jefe.lanzo = true; for (let k = -2; k <= 2; k++) { const a = Math.atan2(dy, dx) + k * 0.22; disparar(jefe.x + jefe.w / 2, jefe.y + jefe.h * 0.3, Math.cos(a) * 150, Math.sin(a) * 150, true, (JEFE_CFG.danio || 15) * 0.7, "#ff7a3a", 3); } NK.sonido("fuego"); } if (jefe.tHab > 1) terminarHab(); }
      else if (h === "invocar") { if (jefe.tHab > 0.5 && !jefe.lanzo) { jefe.lanzo = true; const tp = ref((Z.enemigos || [])[0] || { ref: 0 }); for (let k = 0; k < 3; k++) activarEnemigo(tp, { x: jefe.x + (k - 1) * 40, y: jefe.y }); NK.sonido("magia"); } if (jefe.tHab > 1.2) terminarHab(); }
      else if (h === "onda") { if (jefe.tHab > 0.6 && !jefe.lanzo) { jefe.lanzo = true; sacudida = 0.4; NK.sonido("trueno"); for (const s of [-1, 1]) disparar(jefe.x + jefe.w / 2, jefe.y + jefe.h - 6, s * 170, 0, true, JEFE_CFG.danio || 15, "#ffd23f", 5); } if (jefe.tHab > 1.1) terminarHab(); }
      else if (h === "salto") { if (jefe.tHab < 0.1 && jefe.enSuelo !== false) { jefe.vy = LATERAL ? -380 : 0; jefe.vx = dx * 1.1; } if (jefe.tHab > 1.3) { sacudida = 0.35; terminarHab(); } }
      else terminarHab();
    } else { jefe.vx = NK.lerp(jefe.vx, Math.sign(dx) * vel * 0.8, 1 - Math.exp(-4 * dt)); if (!LATERAL) jefe.vy = NK.lerp(jefe.vy, Math.sign(dy) * vel * 0.8, 1 - Math.exp(-4 * dt)); jefe.anim = Math.abs(jefe.vx) > 5 ? "Run" : "Idle"; }
    if (LATERAL) { jefe.vy = Math.min(jefe.vy + GRAV * dt, 600); mover(jefe, dt); if (arena) jefe.x = NK.clamp(jefe.x, arena.x0 - 60, arena.x1 - jefe.w); }
    else { jefe.x += jefe.vx * dt; jefe.y += jefe.vy * dt; }
    if (jug.x < jefe.x + jefe.w && jug.x + jug.w > jefe.x && jug.y < jefe.y + jefe.h && jug.y + jug.h > jefe.y) {
      if (LATERAL && jug.vy > 60 && jug.y + jug.h - jefe.y < 10) { herirJefe(30 * jug.mult.danio); jug.vy = -SALTO0 * 0.8; }
      else { danio(JEFE_CFG.danio || 15, "jefe"); jug.vx = Math.sign(dx || 1) * 220; if (LATERAL) jug.vy = -200; }
    }
  }
  function terminarHab() { jefe.hab = null; jefe.lanzo = false; jefe.cd = NK.clamp(2.4 - jefe.fase * 0.5, 0.9, 3); jefe.anim = "Idle"; }

  /* ───────── Armas ───────── */
  let armaAct = null;
  function equipar(a) { armaAct = a || null; if (NK.ui.arma) NK.ui.arma(armaAct, TR.activa ? TR.armasDisponibles().length : ARMAS.length); }
  function atacar() {
    const tipo = armaAct ? armaAct.tipo : (C.jugador.arma === "disparo" ? "disparo" : C.jugador.arma === "espada" ? "cuerpo" : null);
    if (!tipo) return;
    const dmg = (armaAct ? armaAct.danio : 20) * jug.mult.danio * (jug.efectos.furia > 0 ? 2 : 1);
    const cad = (armaAct ? armaAct.cadencia : 0.35) * jug.mult.cad;
    jug.cd = cad; jug.ataque = 0.25; jug.anim = "Attack"; jug.tAnim = 0;
    if (tipo === "cuerpo") {
      const alc = NK.clamp((armaAct ? armaAct.alcance : 2) * 9 * jug.mult.alc, 14, 60); NK.sonido("golpe");
      const cx = jug.x + jug.w / 2 + jug.dir * alc * 0.55, cy = jug.y + jug.h * 0.5;
      for (const en of enemigos) if (en.activo && !en.muriendo && Math.abs(en.x + en.w / 2 - cx) < alc * 0.6 + en.w / 2 && Math.abs(en.y + en.h / 2 - cy) < Math.max(18, en.h / 2 + 8)) herir(en, dmg);
      if (jefe.activo && Math.abs(jefe.x + jefe.w / 2 - cx) < alc * 0.6 + jefe.w / 2 && Math.abs(jefe.y + jefe.h / 2 - cy) < jefe.h / 2 + 10) herirJefe(dmg);
      chispa(cx, cy, "rgba(255,255,255,.9)", 4, 40, 0);
    } else {
      let dx = jug.dir, dy = 0; const e = NK.eje(); if (!LATERAL && (e.x || e.y)) { dx = e.x; dy = -e.y; }
      const l = Math.hypot(dx, dy) || 1, magia = tipo === "magia";
      disparar(jug.x + jug.w / 2 + dx / l * 8, jug.y + jug.h * 0.45, dx / l * (magia ? 220 : 300), dy / l * (magia ? 220 : 300), false, dmg, magia ? "#c07aff" : (armaAct && armaAct.proyectil === "fuego" ? "#ff7a1a" : "#ffe27a"), magia ? 3 : 2);
      NK.sonido(magia ? "magia" : armaAct && armaAct.proyectil === "flecha" ? "flecha" : "disparo");
    }
  }

  /* ───────── Actualización ───────── */
  const cam = { x: 0, y: 0 };
  async function hablar() {
    if (!npc.activo || !Z.npc) return;
    npc.hablado = true; NK.sonido("dialogo");
    await NK.dialogo(Z.npc.nombre, Z.npc.dialogo || ["¡Suerte en tu travesía!"], `assets/iconos/npc_${Z.npc.modelo || "npc"}.png`);
  }
  function actualizar(dt) {
    P.t += dt; jug.t += dt; jug.tAnim += dt; if (TR.activa) { TR.stats.t += dt; TR.stats.tZona += dt; }
    jug.invul = Math.max(0, jug.invul - dt); jug.ataque = Math.max(0, jug.ataque - dt); jug.cd = Math.max(0, jug.cd - dt); jug.cepo = Math.max(0, jug.cepo - dt);
    for (const k in jug.efectos) jug.efectos[k] = Math.max(0, jug.efectos[k] - dt);
    if (TR.mejoras && TR.mejoras.has("regeneracion")) jug.vida = Math.min(jug.vidaMax, jug.vida + dt * 1.2);
    if (P.cine > 0) { P.cine -= dt; return; }
    const e = NK.eje(), correr = NK.boton("correr") ? 1.4 : 1;
    const VEL = VEL0 * jug.mult.vel * (TR.activa ? 1 : 1) * (jug.efectos.turbo > 0 ? 1.5 : 1) * jug.lento * (P.contra && P.contra.tipo === "tormenta" ? 0.9 : 1), SALTO = SALTO0 * jug.mult.salto;
    const mueve = jug.cepo > 0 ? 0 : 1;
    if (LATERAL) {
      const agarre = jug.hielo ? 2.5 : (jug.enSuelo ? 16 : 7);
      jug.vx = NK.lerp(jug.vx, e.x * VEL * correr * mueve, 1 - Math.exp(-agarre * dt));
      jug.coyote = jug.enSuelo ? 0.1 : jug.coyote - dt; if (jug.enSuelo) jug.saltosAire = 0;
      if (NK.pulso("saltar") || NK.pulso("KeyW") || NK.pulso("ArrowUp")) jug.buffer = 0.12; else jug.buffer -= dt;
      if (jug.buffer > 0 && mueve) {
        if (jug.coyote > 0) { jug.vy = -SALTO; jug.buffer = 0; jug.coyote = 0; NK.sonido("salto"); chispa(jug.x + jug.w / 2, jug.y + jug.h, "#ffffff", 4, 40); }
        else if (TR.mejoras && TR.mejoras.has("doble_salto") && jug.saltosAire < 1) { jug.saltosAire++; jug.vy = -SALTO * 0.85; jug.buffer = 0; NK.sonido("salto"); chispa(jug.x + jug.w / 2, jug.y + jug.h, "#bfe8ff", 8, 60); }
      }
      if (!NK.boton("saltar") && !NK.boton("KeyW") && !NK.boton("ArrowUp") && jug.vy < -SALTO * 0.62) jug.vy = -SALTO * 0.62;
      jug.vy = Math.min(jug.vy + GRAV * dt, 560);
    } else {
      jug.vx = NK.lerp(jug.vx, e.x * VEL * correr * mueve, 1 - Math.exp(-(jug.hielo ? 3 : 14) * dt)); jug.vy = NK.lerp(jug.vy, -e.y * VEL * correr * mueve, 1 - Math.exp(-(jug.hielo ? 3 : 14) * dt));
      if (Math.abs(e.x) > Math.abs(e.y)) jug.dir4 = e.x > 0 ? "derecha" : "izquierda"; else if (e.y) jug.dir4 = e.y > 0 ? "arriba" : "abajo";
    }
    if (e.x) jug.dir = e.x > 0 ? 1 : -1;
    mover(jug, dt, true);
    if (jug.enSuelo && LATERAL && at(Math.floor((jug.x + jug.w / 2) / T), Math.floor((jug.y + jug.h + 2) / T)) === 1) ultimoSeguro = { x: jug.x, y: jug.y };
    if (LATERAL && jug.y > MH * T + 40) { danio(20, "agua"); if (NK.estado === "jugando") reaparecer(); }
    jug.x = NK.clamp(jug.x, 0, MW * T - jug.w);
    // animación del jugador
    if (jug.anim !== "Hit" && jug.anim !== "Death" && !(jug.anim === "Attack" && jug.ataque > 0)) {
      const a = LATERAL && !jug.enSuelo ? "Jump" : Math.hypot(jug.vx, jug.vy) > 14 ? (LATERAL ? "Run" : "Walk") : "Idle";
      if (a !== jug.anim) { jug.anim = a; jug.tAnim = 0; }
    } else if (jug.anim === "Hit" && jug.tAnim > 0.35) { jug.anim = "Idle"; jug.tAnim = 0; }
    // ataque y armas (cerca del guía o del mirador, E habla / mira; el clic siempre ataca)
    const cercaNPC = npc.activo && Math.abs(npc.x - jug.x) < 26 && Math.abs(npc.y - jug.y) < 34;
    const cercaMir = miradorPos && !P.miradorVisto && Math.abs(miradorPos.x - jug.x) < 22 && Math.abs(miradorPos.y - jug.y) < 34;
    const pideAtaque = NK.pulso("Mouse0") || (NK.boton("Mouse0") && armaAct && armaAct.tipo !== "cuerpo") || ((NK.pulso("KeyF") || NK.pulso("Enter") || NK.pulso("KeyE")) && !cercaNPC && !cercaMir);
    if (pideAtaque && jug.cd <= 0) atacar();
    if (NK.pulso("KeyQ") && TR.activa) { const d = TR.armasDisponibles(); if (d.length > 1) { equipar(d[(d.indexOf(armaAct) + 1) % d.length]); NK.sonido("poner"); } }
    for (let k = 1; k <= 4; k++) if (NK.pulso("Digit" + k) && TR.activa) { const d = TR.armasDisponibles(); if (d[k - 1]) equipar(d[k - 1]); }
    // guía y mirador
    if (cercaNPC) { if (!npc.hablado) NK.ui.aviso(`💬 E: hablar con ${Z.npc.nombre}`, 400); if (NK.pulso("KeyE")) hablar(); }
    if (cercaMir) {
      NK.ui.aviso("🔭 E: mirador panorámico", 400);
      if (NK.pulso("KeyE")) { P.miradorVisto = true; P.cine = 3.2; P.cineX = cam.x; NK.ui.banner("🔭 " + Z.nombre, Z.descripcion || "", 3000); NK.sonido("zona"); if (TR.activa) { TR.stats.miradores++; TR.logro("miradores", TR.stats.miradores); } }
    }
    // balas
    for (const b of balas) { if (b.vida <= 0) continue; b.vida -= dt; b.x += b.vx * dt; b.y += b.vy * dt; if (solidoEn(b.x, b.y)) { b.vida = 0; chispa(b.x, b.y, b.col, 3, 30); continue; }
      if (b.enemiga) { if (b.x > jug.x && b.x < jug.x + jug.w && b.y > jug.y - 4 && b.y < jug.y + jug.h) { danio(b.danio, "jefe"); b.vida = 0; } continue; }
      for (const en of enemigos) if (en.activo && !en.muriendo && b.x > en.x && b.x < en.x + en.w && b.y > en.y && b.y < en.y + en.h) { herir(en, b.danio); b.vida = 0; break; }
      if (b.vida > 0 && jefe.activo && !jefe.muriendo && b.x > jefe.x && b.x < jefe.x + jefe.w && b.y > jefe.y && b.y < jefe.y + jefe.h) { herirJefe(b.danio); b.vida = 0; } }
    // enemigos
    const agresivo = P.contra && P.contra.tipo === "noche" ? 1.3 : 1;
    for (const en of enemigos) {
      if (!en.activo) continue; en.tAnim += dt;
      if (en.muriendo > 0) { en.muriendo -= dt; if (en.muriendo <= 0) en.activo = false; continue; }
      en.t += dt; en.cd = Math.max(0, en.cd - dt); en.golpe = Math.max(0, en.golpe - dt);
      const v = NK.clamp(en.cfg.velocidad || 3, 1, 12) * 12 * agresivo * (TR.activa ? TR.dif.vel : 1) * (en.ladron ? 1.7 : 1), dx = jug.x - en.x, dy = jug.y - en.y, d = Math.hypot(dx, dy);
      const persigue = !en.ladron && (en.cfg.comportamiento === "perseguir" && d < 170 || OBJ.tipo === "sobrevivir" || d < 60);
      const huye = en.ladron ? -1 : 1;
      if (en.tp.vuela) { en.vx = NK.lerp(en.vx, (persigue ? Math.sign(dx) : en.dir) * v * huye, 1 - Math.exp(-3 * dt)); en.vy = persigue ? Math.sign(dy) * v * 0.6 : Math.sin(en.t * 2) * 30; en.x += en.vx * dt; en.y += en.vy * dt; if (Math.abs(en.x - en.x0) > 110 && !persigue) en.dir = -Math.sign(en.x - en.x0); }
      else if (LATERAL) {
        en.vx = NK.lerp(en.vx, (persigue || en.ladron ? Math.sign(dx) * huye : en.dir) * v, 1 - Math.exp(-6 * dt)); en.vy = Math.min(en.vy + GRAV * dt, 560); mover(en, dt);
        const delante = Math.floor((en.x + (en.vx > 0 ? en.w + 2 : -2)) / T); if (en.chocoX || (en.enSuelo && !at(delante, Math.floor((en.y + en.h + 2) / T)))) { en.dir *= -1; en.vx = en.dir * v * 0.3; }
        if (en.y > MH * T + 40) en.activo = false;
      } else {
        const tx = persigue ? Math.sign(dx) : Math.cos(en.t * 0.7 + en.tp.i) * huye, ty = persigue ? Math.sign(dy) : Math.sin(en.t * 0.5);
        en.vx = NK.lerp(en.vx, tx * v * (persigue ? 1 : 0.4) * (en.ladron ? -1 : 1), 1 - Math.exp(-5 * dt)); en.vy = NK.lerp(en.vy, ty * v * (persigue ? 1 : 0.4), 1 - Math.exp(-5 * dt)); mover(en, dt);
      }
      if (Math.abs(en.vx) > 5) en.dir = Math.sign(en.vx);
      if (jug.x < en.x + en.w && jug.x + jug.w > en.x && jug.y < en.y + en.h && jug.y + jug.h > en.y) {
        if (LATERAL && jug.vy > 60 && jug.y + jug.h - en.y < 9) { herir(en, 999); jug.vy = -SALTO * 0.7; NK.sonido("salto"); }
        else if (en.cd <= 0 && !en.ladron) { en.cd = 0.9; danio(en.cfg.danio || 10, "enemigo"); jug.vx = Math.sign(dx || 1) * 170; if (LATERAL) jug.vy = -160; }
      }
    }
    // reaparición / oleadas
    const vivos = enemigos.filter(x => x.activo && !x.muriendo).length;
    const quiere = OBJ.tipo === "sobrevivir" ? Math.min(14, 3 + Math.floor(P.t / 10)) : OBJ.tipo === "derrotar" ? Math.min(10, Math.max(0, P.total - P.derrotados)) : 0;
    if (vivos < quiere && P.t - P.spawn > 1.6) { const L = enemigosIni[Math.floor(rnd() * enemigosIni.length)]; if (L && Math.abs(L.x - jug.x) > 110) { const tp = ref((Z.enemigos || [])[Math.floor(rnd() * Math.max(1, (Z.enemigos || []).length))] || { ref: 0 }); activarEnemigo(tp, L); P.spawn = P.t; } }
    // objetos y potenciadores
    const iman = jug.efectos.iman > 0 || (TR.mejoras && TR.mejoras.has("iman_permanente"));
    for (const o of objetos) { if (!o.activo) continue; o.t += dt;
      const cx = jug.x + jug.w / 2, cy = jug.y + jug.h / 2;
      if (iman && Math.hypot(o.x - cx, o.y - cy) < (jug.efectos.iman > 0 ? 90 : 40)) { o.x = NK.lerp(o.x, cx, 1 - Math.exp(-6 * dt)); o.y = NK.lerp(o.y, cy, 1 - Math.exp(-6 * dt)); }
      if (Math.abs(o.x - cx) < 11 + jug.w / 2 && Math.abs(o.y - cy) < 8 + jug.h / 2 && NK.gancho("alRecoger", J, o) !== false) {
        o.activo = false; chispa(o.x, o.y, o.cfg.color || OC, 10); jug.puntos += o.cfg.valor || 10; if (TR.activa) { TR.stats.recogidos++; TR.stats.puntos += o.cfg.valor || 10; }
        if (o.oi === 0) P.recogidos++;
        if (o.cfg.efecto === "vida") { jug.vida = Math.min(jug.vidaMax, jug.vida + 25); NK.sonido("vida"); } else NK.sonido("moneda"); } }
    for (const p of potes) { if (!p.activo) continue; p.t += dt;
      if (Math.abs(p.x - (jug.x + jug.w / 2)) < 14 && Math.abs(p.y - (jug.y + jug.h / 2)) < 18) { p.activo = false; NK.sonido("potenciador"); chispa(p.x, p.y, "#8aff45", 14);
        const tx = { curacion: "❤ +35 de vida", vida_extra: "💚 ¡Vida extra!", escudo: "🛡 Escudo", turbo: "⚡ Turbo", iman: "🧲 Imán", furia: "🔥 Furia: daño doble" }[p.tipo] || "✨";
        if (p.tipo === "curacion") jug.vida = Math.min(jug.vidaMax, jug.vida + 35); else if (p.tipo === "vida_extra") { if (TR.activa) { TR.vidas++; NK.ui.vidas(TR.vidas); } else jug.vida = jug.vidaMax; }
        else jug.efectos[p.tipo] = p.tipo === "escudo" ? 8 : 10;
        NK.ui.aviso(tx, 1800); } }
    NK.ui.efectos && NK.ui.efectos(Object.keys(jug.efectos).filter(k => jug.efectos[k] > 0).map(k => ({ escudo: "🛡", turbo: "⚡", iman: "🧲", furia: "🔥" }[k] + " " + Math.ceil(jug.efectos[k]))));
    // trampas
    for (const tr of trampas) {
      if (tr.tipo === "pendulo") { tr.t += dt; const a = Math.sin(tr.t * 1.8) * 1.1, bx = tr.x + Math.sin(a) * tr.l, by = tr.y + Math.cos(a) * tr.l; tr.bx = bx; tr.by = by;
        if (Math.hypot(bx - (jug.x + jug.w / 2), by - (jug.y + jug.h / 2)) < 14) { danio(18, "trampa"); jug.vx = Math.sign(jug.x - bx) * 200; } }
      else if (tr.tipo === "cepo") { if (!tr.cerrado && Math.abs(tr.x + 4 - (jug.x + jug.w / 2)) < 8 && Math.abs(tr.y - (jug.y + jug.h)) < 8) { tr.cerrado = 1; jug.cepo = 1.2; danio(10, "trampa"); NK.sonido("trampa"); NK.ui.aviso("🪤 ¡Un cepo! Espera…", 1200); } }
      else if (tr.tipo === "tronco") { if (!tr.activo) { tr.cd -= dt; if (tr.cd <= 0) { tr.activo = true; tr.x = jug.x + W * 0.6; tr.y = jug.y - 60; tr.vx = -150; tr.vy = 0; } }
        else { tr.vy = Math.min(tr.vy + GRAV * dt, 500); tr.x += tr.vx * dt; tr.y += tr.vy * dt; const ty = Math.floor((tr.y + tr.r) / T); if (solidoT(at(Math.floor(tr.x / T), ty))) { tr.y = ty * T - tr.r; tr.vy = 0; }
          if (Math.hypot(tr.x - (jug.x + jug.w / 2), tr.y - (jug.y + jug.h - 6)) < tr.r + 6) { danio(15, "trampa"); jug.vy = -220; }
          if (tr.x < jug.x - W || tr.y > MH * T + 40) { tr.activo = false; tr.cd = 4 + rnd() * 4; } } }
      else if (tr.tipo === "roca") { if (!tr.activo) { tr.cd -= dt; if (tr.cd <= 0) { tr.activo = true; tr.aviso = 0.9; tr.x = jug.x + jug.w / 2 + jug.vx * 0.6 + (rnd() - 0.5) * 60; tr.y = cam.y - 20; tr.vy = 0; } }
        else if (tr.aviso > 0) tr.aviso -= dt;
        else { tr.vy = Math.min(tr.vy + GRAV * dt, 600); tr.y += tr.vy * dt * (LATERAL ? 1 : 0.8);
          if (Math.hypot(tr.x - (jug.x + jug.w / 2), tr.y - (jug.y + jug.h / 2)) < 12) { danio(16, "roca"); tr.activo = false; tr.cd = 2 + rnd() * 3; }
          if (solidoEn(tr.x, tr.y + 6) || tr.y > cam.y + H + 30) { chispa(tr.x, tr.y, "#9a948a", 8, 60); tr.activo = false; tr.cd = 2 + rnd() * 3; sacudida = Math.max(sacudida, 0.1); } } }
    }
    for (const p of parts) { if (p.vida <= 0) continue; p.vida -= dt; p.vy += p.g * dt; p.x += p.vx * dt; p.y += p.vy * dt; }
    sacudida = Math.max(0, sacudida - dt);
    actualizarContratiempo(dt);
    if (CAMP && Z.contratiempo && !P.contraHecho && !P.completa && progresoZona() >= (Z.contratiempo.momento || 0.5)) iniciarContratiempo(Z.contratiempo);
    if (JEFE_CFG && OBJ.tipo === "jefe" && !jefe.presentado && arena && (LATERAL ? jug.x > arena.x0 - 40 : Math.hypot(jug.x - arena.x0 - 90, jug.y - arena.y) < 170)) presentarJefe();
    actualizarJefe(dt);
    NK.gancho("alActualizar", J, dt);
    // objetivo de la zona
    let prog = "";
    if (!P.completa) switch (OBJ.tipo) {
      case "recolectar": case "construir": prog = `${(C.objetos[0] || {}).nombre || "Objetos"}: ${P.recogidos}/${P.total}`; if (P.recogidos >= P.total) completarZona(); break;
      case "derrotar": prog = `Derrotados: ${P.derrotados}/${P.total}`; if (P.derrotados >= P.total) completarZona(); break;
      case "sobrevivir": P.tiempoRestante -= dt; prog = `Resiste: ${Math.max(0, Math.ceil(P.tiempoRestante))} s`; if (P.tiempoRestante <= 0) completarZona(); break;
      case "jefe": prog = jefe.presentado ? `${JEFE_CFG ? JEFE_CFG.nombre : "Jefe"}: ${Math.max(0, Math.round(100 * jefe.vida / jefe.vidaMax))} %` : "Llega a la guarida del jefe ➜"; if (!JEFE_CFG) completarZona(); break;
      default: { const d = metaPos ? Math.abs(metaPos.x - jug.x) + (LATERAL ? 0 : Math.abs(metaPos.y - jug.y)) : 0; prog = `Meta a ${Math.round(d / T)} m`;
        if (metaPos && Math.abs(metaPos.x + 8 - (jug.x + jug.w / 2)) < 16 && Math.abs(metaPos.y + 8 - (jug.y + jug.h / 2)) < 28) completarZona(); }
    }
    if (OBJ.tiempo > 0 && OBJ.tipo !== "sobrevivir" && !P.completa) { P.tiempoRestante -= dt; if (P.tiempoRestante <= 0) { if (TR.activa) { P.tiempoRestante = OBJ.tiempo; TR.morir("¡Se acabó el tiempo!"); } else NK.terminar(false, "¡Se acabó el tiempo!"); } }
    NK.ui.datos({ vida: jug.vida, vidaMax: jug.vidaMax, puntos: TR.activa ? TR.stats.puntos : jug.puntos, objetivo: OBJ.texto, progreso: prog, tiempo: OBJ.tiempo > 0 || OBJ.tipo === "sobrevivir" ? P.tiempoRestante : undefined });
  }

  /* ───────── Dibujo ───────── */
  function capaParallax(im, f, yoff) { if (!lista(im)) return false; const s = H / im.height, w = im.width * s; let x = -((cam.x * f) % w); if (x > 0) x -= w; for (; x < W; x += w) ctx.drawImage(im, x, yoff || 0, w + 0.5, H); return true; }
  function dibujarFondo() {
    const fo = HD ? G.fondos[`${Z.tema}_${horaZ()}`] || G.fondos[Object.keys(G.fondos).find(k => k.startsWith(Z.tema + "_")) || ""] : null;
    if (LATERAL && fo && lista(fo.cielo)) {
      const dy = NK.clamp(-(cam.y - (MH * T - H)) * 0.08, -10, 18);
      capaParallax(fo.cielo, 0.02, 0); capaParallax(fo.lejos, 0.1, dy * 0.3); capaParallax(fo.medio, 0.25, dy * 0.6); capaParallax(fo.cerca, 0.45, dy);
      return;
    }
    if (LATERAL && fondoPix) {
      ctx.drawImage(fondoPix, 0, 0);
      ctx.drawImage(montePix, -((cam.x * 0.25) % W), 0); ctx.drawImage(montePix, -((cam.x * 0.25) % W) + W * 2 - 2, 0);
      ctx.fillStyle = horaZ() === "noche" ? "rgba(255,255,255,.25)" : "rgba(255,255,255,.85)";
      for (const n of nubes) { const nx = ((n.x - cam.x * 0.1 + P.t * 4) % (W * 1.4) + W * 1.4) % (W * 1.4) - 60; ctx.fillRect(Math.round(nx), n.y, n.w, 6); ctx.fillRect(Math.round(nx) + 6, n.y - 4, n.w - 12, 4); }
    } else { ctx.fillStyle = pal().suelo[1]; ctx.fillRect(0, 0, W, H); }
  }
  function sombraPies(x, y, w) { if (!HD) return; ctx.fillStyle = "rgba(0,0,0,.28)"; ctx.beginPath(); ctx.ellipse(x, y, w * 0.6, Math.max(1.5, w * 0.16), 0, 0, 7); ctx.fill(); }
  function dibujar(dt) {
    let tx = jug.x + jug.w / 2 - W / 2 + jug.dir * 30, ty = LATERAL ? Math.min(jug.y - H * 0.55, MH * T - H) : jug.y + jug.h / 2 - H / 2;
    if (P.cine > 0) { tx = P.cineX + (3.2 - P.cine) * 90; }
    if (jefe.activo && jefe.presentado && LATERAL && Math.abs(jefe.x - jug.x) < W * 0.9) tx = (jug.x + jug.w / 2 + jefe.x + jefe.w / 2) / 2 - W / 2;
    cam.x = NK.clamp(NK.lerp(cam.x, tx, 1 - Math.exp(-(P.cine > 0 ? 3 : 6) * dt)), 0, Math.max(0, MW * T - W)); cam.y = NK.clamp(NK.lerp(cam.y, ty, 1 - Math.exp(-6 * dt)), LATERAL ? -H : 0, Math.max(0, MH * T - H));
    const sx = sacudida > 0 ? (rnd() - 0.5) * 6 : 0, sy = sacudida > 0 ? (rnd() - 0.5) * 6 : 0;
    const X = cam.x + sx, Y = cam.y + sy;
    dibujarFondo();
    for (const tz of trozos) if (tz.x + tz.w > X && tz.x < X + W) ctx.drawImage(tz.c, 0, 0, tz.c.width, tz.c.height, tz.x - X, -Y, tz.w, MH * T);
    // meta / puerta
    if (metaPos && OBJ.tipo !== "recolectar" && OBJ.tipo !== "derrotar" && OBJ.tipo !== "sobrevivir" && OBJ.tipo !== "jefe") {
      const mxp = metaPos.x - X, myp = metaPos.y - Y;
      if (LATERAL) { ctx.fillStyle = "#ddd"; ctx.fillRect(mxp + 7, myp - 24, 2, 42); ctx.fillStyle = "#3fdc2b"; ctx.fillRect(mxp + 9, myp - 24 + Math.sin(P.t * 4), 14, 9); }
      else { ctx.fillStyle = `rgba(138,255,69,${0.5 + Math.sin(P.t * 4) * 0.25})`; ctx.beginPath(); ctx.arc(mxp + 8, myp + 8, 9, 0, 7); ctx.fill(); }
    }
    // fogata (punto de control) y mirador
    if (CAMP) { const fx = inicio.x + 24 - X, fy = inicio.y + (LATERAL ? jug.h : 8) - Y; ctx.fillStyle = "#5a3a22"; ctx.fillRect(fx - 5, fy - 2, 10, 3);
      for (let k = 0; k < 3; k++) { ctx.fillStyle = ["#ff7a1a", "#ffb13a", "#fff0a0"][k]; const hh = (7 - k * 2) + Math.sin(P.t * 12 + k) * 1.5; ctx.beginPath(); ctx.moveTo(fx - 4 + k * 1.3, fy - 2); ctx.lineTo(fx, fy - 2 - hh); ctx.lineTo(fx + 4 - k * 1.3, fy - 2); ctx.fill(); } }
    if (miradorPos) { const mx = miradorPos.x - X, my = miradorPos.y - Y + (LATERAL ? 20 : 0); ctx.fillStyle = "#6b4a2b"; ctx.fillRect(mx, my - 18, 2, 18); ctx.fillStyle = P.miradorVisto ? "#9aa" : "#ffe27a"; ctx.fillRect(mx - 5, my - 22, 12, 6); ctx.fillStyle = "#222"; ctx.font = "5px sans-serif"; ctx.fillText("🔭", mx - 3, my - 17); }
    // trampas
    for (const tr of trampas) {
      if (tr.tipo === "pendulo" && tr.bx != null) { ctx.strokeStyle = "#555"; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.moveTo(tr.x - X, tr.y - Y); ctx.lineTo(tr.bx - X, tr.by - Y); ctx.stroke(); ctx.fillStyle = "#b8c0c8"; ctx.beginPath(); ctx.arc(tr.bx - X, tr.by - Y, 8, 0, 7); ctx.fill(); ctx.fillStyle = "#6a7078"; ctx.fillRect(tr.bx - X - 1, tr.by - Y - 8, 2, 16); }
      else if (tr.tipo === "cepo") { ctx.fillStyle = tr.cerrado ? "#6a6a6a" : "#9aa0a8"; ctx.fillRect(tr.x - X, tr.y - Y - 2, 9, 3); if (!tr.cerrado) for (let k = 0; k < 4; k++) ctx.fillRect(tr.x - X + k * 2.5, tr.y - Y - 5, 1, 3); }
      else if (tr.tipo === "tronco" && tr.activo) { ctx.save(); ctx.translate(tr.x - X, tr.y - Y); ctx.rotate(-tr.x / tr.r); ctx.fillStyle = "#7a5230"; ctx.beginPath(); ctx.arc(0, 0, tr.r, 0, 7); ctx.fill(); ctx.strokeStyle = "#c8a070"; ctx.lineWidth = 1; ctx.beginPath(); ctx.arc(0, 0, tr.r * 0.55, 0, 7); ctx.stroke(); ctx.fillRect(-1, -tr.r, 2, tr.r); ctx.restore(); }
      else if (tr.tipo === "roca" && tr.activo) { if (tr.aviso > 0) { ctx.fillStyle = `rgba(0,0,0,${0.25 + 0.2 * Math.sin(P.t * 20)})`; const gy = jug.y + jug.h - Y; ctx.beginPath(); ctx.ellipse(tr.x - X, gy, 8, 2.5, 0, 0, 7); ctx.fill(); }
        else { ctx.fillStyle = "#8a847a"; ctx.beginPath(); ctx.arc(tr.x - X, tr.y - Y, 6, 0, 7); ctx.fill(); ctx.fillStyle = "#a8a296"; ctx.beginPath(); ctx.arc(tr.x - X - 2, tr.y - Y - 2, 2.5, 0, 7); ctx.fill(); } }
    }
    // objetos y potenciadores
    for (const o of objetos) if (o.activo) { const hy = Math.sin(o.t * 3) * 2; const g = G.obj[o.oi];
      if (g && g.dibujar("Spin", o.t, o.x - X, o.y - Y + hy, false)) continue; const s = sprObj[o.oi]; if (s) ctx.drawImage(s, Math.round(o.x - s.width / 2 - X), Math.round(o.y - s.height / 2 - Y + hy)); }
    for (const p of potes) if (p.activo) { const px = p.x - X, py = p.y - Y + Math.sin(p.t * 3) * 2; const gr = ctx.createRadialGradient(px, py, 1, px, py, 9);
      gr.addColorStop(0, "rgba(255,255,255,.95)"); gr.addColorStop(1, "rgba(138,255,69,0)"); ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, 9, 0, 7); ctx.fill();
      ctx.font = "8px sans-serif"; ctx.textAlign = "center"; ctx.fillText({ curacion: "❤", vida_extra: "💚", escudo: "🛡", turbo: "⚡", iman: "🧲", furia: "🔥" }[p.tipo] || "✨", px, py + 3); ctx.textAlign = "left"; }
    // guía
    if (npc.activo) { const hN = G.npc[Z.npc.modelo || "npc"]; const nx = npc.x + 6 - X, ny = npc.y + (LATERAL ? 32 : 8) - Y;
      sombraPies(nx, ny, 10); if (!(hN && hN.dibujar("Idle", P.t, nx, ny, jug.x < npc.x, LATERAL ? null : "abajo"))) { ctx.drawImage(jugFr[0], nx - 6, ny - 14); }
      if (!npc.hablado) { ctx.fillStyle = "#ffd23f"; ctx.font = "bold 9px sans-serif"; ctx.textAlign = "center"; ctx.fillText("!", nx, ny - (hN ? hN.alto : 14) - 4 + Math.sin(P.t * 5) * 1.5); ctx.textAlign = "left"; } }
    // enemigos
    for (const en of enemigos) if (en.activo) {
      const h = en.tp.hoja, alfa = en.muriendo > 0 ? NK.clamp(en.muriendo / 0.6, 0, 1) : 1;
      const px = en.x + en.w / 2 - X, py = en.y + en.h - Y + (h && LATERAL ? en.h * 0.1 / 0.9 * 0.0 : 0);
      const an = en.muriendo > 0 ? "Death" : en.golpe > 0 ? "Hit" : Math.abs(en.vx) > 6 ? (LATERAL ? "Run" : "Walk") : "Idle";
      if (h) { sombraPies(px, py, en.w); const d4 = LATERAL ? null : Math.abs(en.vx) > Math.abs(en.vy) ? (en.vx > 0 ? "derecha" : "izquierda") : (en.vy > 0 ? "abajo" : "arriba");
        if (en.golpe > 0) ctx.filter = "brightness(2.2)"; h.dibujar(an, en.muriendo > 0 ? 0.6 - en.muriendo : en.t, px, py, LATERAL && en.dir < 0, d4, alfa); ctx.filter = "none"; }
      else { const fr = en.tp.pix[en.dir > 0 ? "der" : "izq"][Math.floor(en.t * 6) % 2]; ctx.globalAlpha = alfa; ctx.drawImage(fr, Math.round(px - fr.width / 2), Math.round(py - fr.height)); ctx.globalAlpha = 1; }
      if (en.ladron) { ctx.fillStyle = "#ffd23f"; ctx.font = "7px sans-serif"; ctx.fillText("💰", px - 3, py - (h ? h.alto : 14) - 3); }
    }
    // jefe
    if (jefe.activo) { const hj = G.jefe, px = jefe.x + jefe.w / 2 - X, py = jefe.y + jefe.h - Y, alfa = jefe.muriendo > 0 ? NK.clamp(jefe.muriendo / 1.4, 0, 1) : 1;
      sombraPies(px, py, jefe.w); if (jefe.golpe > 0) ctx.filter = "brightness(2)";
      if (!(hj && hj.dibujar(jefe.anim, jefe.tAnim, px, py, LATERAL && jefe.dir < 0, LATERAL ? null : "abajo", alfa))) { ctx.fillStyle = "#6a1a1a"; ctx.fillRect(jefe.x - X, jefe.y - Y, jefe.w, jefe.h); }
      ctx.filter = "none"; if (jefe.hab && jefe.tHab < 0.5) { ctx.strokeStyle = "rgba(255,80,40,.8)"; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(px, py - jefe.h / 2, jefe.h * 0.7 + Math.sin(P.t * 30) * 2, 0, 7); ctx.stroke(); } }
    // jugador
    if (jug.invul <= 0 || Math.floor(jug.invul * 14) % 2 === 0 || NK.estado !== "jugando") {
      const hoja = HD ? (G.jug[TR.traje && TR.traje.id] || G.jug[Object.keys(G.jug)[0]]) : null;
      const px = jug.x + jug.w / 2 - X, py = jug.y + jug.h - Y;
      if (hoja) { sombraPies(px, py, jug.w * 1.2); const ta = jug.anim === "Jump" ? NK.clamp((jug.vy + SALTO0) / (2 * SALTO0), 0, 0.99) * hoja.dur("Jump") : jug.tAnim;
        if (jug.efectos.furia > 0) ctx.filter = "drop-shadow(0 0 3px #ff4a1a)"; else if (jug.efectos.escudo > 0) ctx.filter = "drop-shadow(0 0 3px #7ad8ff)";
        hoja.dibujar(jug.anim, ta, px, py, LATERAL && jug.dir < 0, LATERAL ? null : jug.dir4); ctx.filter = "none"; }
      else { const mov = Math.abs(jug.vx) > 12, fr = LATERAL && !jug.enSuelo ? 3 : mov ? 1 + Math.floor(jug.t * 9) % 2 : 0, img = (jug.dir > 0 ? jugFr : jugFrI)[fr];
        ctx.drawImage(img, Math.round(px - img.width / 2), Math.round(py - img.height));
        if (jug.ataque > 0) { ctx.fillStyle = "rgba(255,255,255,.8)"; ctx.fillRect(Math.round(px + jug.dir * 3), Math.round(py - 10), jug.dir * 12, 3); } }
    }
    for (const b of balas) if (b.vida > 0) { ctx.fillStyle = b.col; ctx.beginPath(); ctx.arc(b.x - X, b.y - Y, b.r, 0, 7); ctx.fill(); }
    for (const p of parts) if (p.vida > 0) { ctx.fillStyle = p.c; ctx.fillRect(p.x - X, p.y - Y, 2, 2); }
    // clima y luz
    const c = P.contra;
    if (c && c.tipo === "tormenta") { ctx.strokeStyle = "rgba(190,210,255,.55)"; ctx.lineWidth = 0.8; ctx.beginPath(); for (const g of gotas) { g.y += g.v * dt; g.x -= 60 * dt; if (g.y > H) { g.y = -5; g.x = Math.random() * (W + 60); } ctx.moveTo(g.x, g.y); ctx.lineTo(g.x - 3, g.y + 7); } ctx.stroke(); ctx.fillStyle = "rgba(20,25,45,.28)"; ctx.fillRect(0, 0, W, H); }
    if (c && c.tipo === "niebla") { const gr = ctx.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "rgba(220,225,235,.25)"); gr.addColorStop(1, "rgba(220,225,235,.65)"); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
    if (horaZ() === "noche" || Z.tema === "terror" || (c && c.tipo === "noche")) { const gx = jug.x + jug.w / 2 - X, gy = jug.y + jug.h / 2 - Y, gr = ctx.createRadialGradient(gx, gy, 30, gx, gy, 180);
      gr.addColorStop(0, "rgba(0,0,10,0)"); gr.addColorStop(1, `rgba(0,0,10,${c && c.tipo === "noche" ? 0.82 : 0.66})`); ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H); }
    if (P.cine > 0) { ctx.fillStyle = "#000"; ctx.fillRect(0, 0, W, 18); ctx.fillRect(0, H - 18, W, 18); }
  }

  /* ───────── API, travesía, reinicio y bucle ───────── */
  const J = window.J = { C, ctx, W, H, T, jugador: jug, enemigos, objetos, partida: P, mapa: { at, set, get MW() { return MW; }, get MH() { return MH; } }, aviso: (t, ms) => NK.ui.aviso(t, ms), sonido: t => NK.sonido(t),
    sumarPuntos: n => { jug.puntos += n; if (TR.activa) TR.stats.puntos += n; }, danio, curar: n => { jug.vida = Math.min(jug.vidaMax, jug.vida + n); }, ganar: t => NK.terminar(true, t), perder: t => NK.terminar(false, t), chispa,
    herirEnemigo: (en, n) => (en === jefe ? herirJefe(n) : herir(en, n)), jefe: () => (jefe.activo ? jefe : null), meta: () => metaPos, arena: () => arena, zonaIndice: () => zi, completarZona,
    contratiempo: tipo => iniciarContratiempo({ tipo, texto: "", momento: 0 }), irAJefe: () => { if (arena) { jug.x = LATERAL ? arena.x0 - 20 : arena.x0 + 60; jug.y = arena.y - jug.h - 4; } } };
  const adaptador = {
    async preparar(traje, arma, dif) {
      jug.mult = { vida: (traje && traje.vida) || 1, vel: (traje && traje.velocidad) || 1, salto: (traje && traje.salto) || 1, danio: 1, cad: 1, alc: 1 };
      jug.vidaMax = Math.round(C.jugador.vida * jug.mult.vida); jug.vida = jug.vidaMax; jug.puntos = 0; P.derrotadosTotal = 0;
      const h = G.jug[traje && traje.id]; if (h) await esperar(h.im);
      equipar(arma || ARMAS[0] || null); prepararZona(0);
    },
    cine() {},
    async zona(i) {
      const z = ZONAS[i], hz = ["dia", "noche", "atardecer"].includes(z.hora) ? z.hora : "dia";
      await Promise.all([...Object.values(G.fondos[`${z.tema}_${hz}`] || {}), G.tiles[z.tema]].map(esperar));
      prepararZona(i); jug.vida = jug.vida <= 0 ? jug.vidaMax : Math.max(jug.vida, Math.round(jug.vidaMax * 0.6));
      if (i > 0) { const d = TR.armasDisponibles(); if (armaAct && !d.includes(armaAct)) equipar(d[0]); else if (NK.ui.arma) NK.ui.arma(armaAct, d.length); }
    },
    respawn() { Object.assign(jug, { x: inicio.x, y: inicio.y, vx: 0, vy: 0, vida: jug.vidaMax, invul: 2, anim: "Idle", tAnim: 0 }); ultimoSeguro = { x: inicio.x, y: inicio.y };
      if (jefe.activo && jefe.presentado) { jefe.vida = Math.min(jefe.vidaMax, jefe.vida + jefe.vidaMax * 0.15); NK.ui.jefe(JEFE_CFG.nombre, jefe.vida / jefe.vidaMax); }
      enemigos.forEach(e => { if (e.activo && Math.abs(e.x - jug.x) < 90) e.x += 140; }); NK.estado = "jugando"; },
    mejora(id) { const m = jug.mult; if (id === "danio_extra") m.danio *= 1.25; else if (id === "vida_max") { jug.vidaMax += 25; jug.vida += 25; } else if (id === "velocidad") m.vel *= 1.12; else if (id === "cadencia") m.cad *= 0.8; else if (id === "alcance") m.alc *= 1.3; }
  };
  function reiniciar() {
    Object.assign(jug, { vida: jug.vidaMax, puntos: 0, invul: 1, dir: 1, efectos: {} }); P.t = 0; P.derrotadosTotal = 0;
    prepararZona(0);
    NK.gancho("alIniciar", J);
  }
  let ultimo = performance.now();
  function bucle(ahora) {
    requestAnimationFrame(bucle);
    const dt = Math.min(0.04, (ahora - ultimo) / 1000); ultimo = ahora;
    if (document.hidden) return;
    if (NK.estado === "jugando") { actualizar(dt); NK.medirFPS(dt); }
    else if (NK.estado === "caida") { jug.tAnim += dt; for (const p of parts) if (p.vida > 0) { p.vida -= dt; p.x += p.vx * dt; p.y += p.vy * dt; } }
    else if (NK.estado === "menu") { jug.t += dt; cam.x = (cam.x + dt * 20) % Math.max(1, MW * T - W); }
    else if (NK.estado === "cine" || NK.estado === "dialogo") { jug.tAnim += dt; jefe.tAnim += dt; }
    ctx.setTransform(K, 0, 0, K, 0, 0); ctx.imageSmoothingEnabled = HD;
    dibujar(dt); NK.finFrame();
  }
  NK._estado = () => ({ estado: NK.estado, puntos: TR.activa ? TR.stats.puntos : jug.puntos, vida: Math.round(jug.vida), completa: P.completa,
    objetivo: { tipo: OBJ.tipo, hecho: OBJ.tipo === "derrotar" ? P.derrotados : OBJ.tipo === "sobrevivir" ? Math.round(P.t) : P.recogidos, total: P.total },
    tiempo: Math.round(P.t * 10) / 10, fps: NK.fps.valor, jugador: { x: Math.round(jug.x), y: Math.round(jug.y), anim: jug.anim }, enemigosActivos: enemigos.filter(e => e.activo).length,
    objetosRestantes: objetos.filter(o => o.activo).length, motor: "2d", vista: LATERAL ? "lateral" : "superior", hd: HD, jefe: JEFE_CFG ? { activo: jefe.activo, vida: Math.round(jefe.vida), presentado: jefe.presentado } : null,
    contratiempo: P.contra ? P.contra.tipo : null, graficos: HD ? { hojas: Object.keys(IMGS).length, cargadas: Object.values(IMGS).filter(lista).length } : null });
  // arranque: se esperan las imágenes principales (con límite) y se muestra el menú
  const primeras = HD ? [...Object.values(G.jug).slice(0, 1).map(h => h && h.im), ...Object.values(G.fondos[`${ZONAS[0].tema}_${(["dia", "noche", "atardecer"].includes(ZONAS[0].hora) ? ZONAS[0].hora : "dia")}`] || {}), ...Object.values(G.tiles).slice(0, 1)] : [];
  Promise.all(primeras.map(esperar)).then(() => {
    NK.iniciar(() => { jug.invul = Math.max(jug.invul, 1); }, reiniciar, CAMP ? adaptador : null);
    if (!CAMP) equipar(null);
    reiniciar();
    requestAnimationFrame(bucle);
  });
})();
