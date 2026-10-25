/* Noviq Game Kit — motorvoxel.js: mundo de bloques estilo Minecraft «pixelado pero de alta calidad».
   Texturas pixel art generadas al vuelo (sin archivos), oclusión ambiental por vértice (sombras suaves en las
   esquinas), niebla, cielo con degradado, nubes, ciclo de día y noche, agua, árboles/cactus/cristales según el
   tema, romper y poner bloques, criaturas, objetos y objetivos (recolectar, derrotar, sobrevivir, llegar, construir).

   RENDIMIENTO: el mundo se divide en «chunks» de 16×16×64; solo se dibujan las caras visibles, cada chunk es UNA
   malla (1 dibujo), se generan 1-2 por cuadro para no dar tirones y los lejanos se liberan (dispose). Funciona
   fluido en gráficos integrados. La distancia de dibujo sale de la calidad de la PC (juego.config.js → calidad). */
(function () {
  "use strict";
  const C = NK.cfg, Q = NK.calidad(), A = C.ambiente, R = C.mundo.relieve;
  // travesía: cada zona tiene su campamento en el mismo mundo (el terreno se aplana alrededor de cada uno)
  const CAMP = NK.campana;
  const ZONAS = CAMP ? CAMP.zonas : [{ nombre: C.titulo, tema: C.tema, hora: A.hora, objetivo: C.objetivo, enemigos: (C.enemigos || []).map((e, i) => ({ ref: i, cantidad: e.cantidad })), potenciadores: [] }];
  const CENTROS = ZONAS.map((z, i) => ({ x: i * 120 + 0.5, z: (i % 2 ? 24 : 0) + 0.5 }));
  const distCentro = (wx, wz) => { let m = 1e9; for (const c of CENTROS) { const d = Math.hypot(wx - c.x, wz - c.z); if (d < m) m = d; } return m; };
  document.title = C.titulo;
  const cv = document.getElementById("lienzo");
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !!Q.antialias, powerPreference: "high-performance" });
  renderer.setPixelRatio(Q.pixelRatio); renderer.setSize(innerWidth, innerHeight);
  NK.infoRender = () => `${renderer.info.render.calls} dibujos · ${renderer.info.memory.geometries} geometrías · ${chunks.size} chunks · ${renderer.getPixelRatio().toFixed(2)}x`;
  const escena = new THREE.Scene();
  const RADIO = Math.max(2, Q.chunks || 4), CS = 16, CH = 64, SEA = 14;
  const lejos = (RADIO + 0.5) * CS;
  const camara = new THREE.PerspectiveCamera(70, innerWidth / innerHeight, 0.08, lejos * 1.6);
  const rnd = NK.rand((C.mundo.semilla | 0) + 7), ruido = NK.ruido(C.mundo.semilla | 0), ruido2 = NK.ruido((C.mundo.semilla | 0) + 31);

  /* ───────── Bloques y atlas de texturas pixel art ───────── */
  const B = { AIRE: 0, PASTO: 1, TIERRA: 2, PIEDRA: 3, ARENA: 4, TRONCO: 5, HOJAS: 6, NIEVE: 7, TABLAS: 8, LADRILLO: 9, ADOQUIN: 10, CACTUS: 11, HIELO: 12, ORO: 13, CRISTAL: 14, OSCURO: 15, LAVA: 16, VIDRIO: 17, ARENISCA: 18, LUZ: 19 };
  const NOMBRE = ["aire", "pasto", "tierra", "piedra", "arena", "tronco", "hojas", "nieve", "tablas", "ladrillo", "adoquín", "cactus", "hielo", "oro", "cristal", "obsidiana", "lava", "vidrio", "arenisca", "farol"];
  const TRANSP = new Uint8Array(32); TRANSP[B.AIRE] = 1; TRANSP[B.HOJAS] = 2; TRANSP[B.VIDRIO] = 2; TRANSP[B.HIELO] = 0;
  const TEMA = C.tema;
  const hex = h => { const n = parseInt(String(h).replace("#", ""), 16); return [n >> 16 & 255, n >> 8 & 255, n & 255]; };
  const pastoC = hex(A.suelo[1] || "#6aa84f"), pastoC2 = hex(A.suelo[0] || "#4f8a3a");
  const TILE = 16, CELDA = 32, COLS = 8, ROWS = 4;
  const atlas = document.createElement("canvas"); atlas.width = COLS * CELDA; atlas.height = ROWS * CELDA;
  const ax = atlas.getContext("2d");
  const tiles = {}; let sig = 0;
  function pintar(nombre, fn) {
    const idx = sig++, cx = (idx % COLS) * CELDA, cy = Math.floor(idx / COLS) * CELDA, img = ax.createImageData(TILE, TILE), r = NK.rand(idx * 977 + 13);
    for (let y = 0; y < TILE; y++) for (let x = 0; x < TILE; x++) { const c = fn(x, y, r); const o = (y * TILE + x) * 4; img.data[o] = c[0]; img.data[o + 1] = c[1]; img.data[o + 2] = c[2]; img.data[o + 3] = c[3] === undefined ? 255 : c[3]; }
    // el tile se pinta con 8 px de borde repetido: los mipmaps no mezclan colores de tiles vecinos
    const tmp = document.createElement("canvas"); tmp.width = tmp.height = TILE; tmp.getContext("2d").putImageData(img, 0, 0);
    ax.imageSmoothingEnabled = false; ax.save(); ax.beginPath(); ax.rect(cx, cy, CELDA, CELDA); ax.clip();
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) ax.drawImage(tmp, cx + 8 + dx * TILE, cy + 8 + dy * TILE);
    ax.restore(); tiles[nombre] = idx; return idx;
  }
  const var_ = (c, r, k = 18) => { const v = (r() - 0.5) * k; return [NK.clamp(c[0] + v, 0, 255), NK.clamp(c[1] + v, 0, 255), NK.clamp(c[2] + v, 0, 255)]; };
  const tierraC = [121, 85, 58], piedraC = [128, 128, 128];
  pintar("pasto_arriba", (x, y, r) => var_(r() < 0.2 ? pastoC2 : pastoC, r, 26));
  pintar("pasto_lado", (x, y, r) => y < 3 + ((x * 7) % 3 === 0 ? 1 : 0) ? var_(pastoC, r, 22) : var_(r() < 0.12 ? [96, 66, 44] : tierraC, r, 20));
  pintar("tierra", (x, y, r) => var_(r() < 0.12 ? [96, 66, 44] : r() < 0.06 ? [150, 110, 80] : tierraC, r, 20));
  pintar("piedra", (x, y, r) => var_(((x + y * 3) % 7 === 0 && r() < 0.6) ? [100, 100, 100] : piedraC, r, 24));
  pintar("arena", (x, y, r) => var_([219, 206, 160], r, 18));
  pintar("tronco_lado", (x, y, r) => var_(x % 4 === 0 ? [80, 58, 34] : [110, 82, 50], r, 14));
  pintar("tronco_arriba", (x, y, r) => { const d = Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)); return var_(d > 6.5 ? [90, 66, 40] : Math.floor(d) % 2 ? [168, 132, 86] : [150, 116, 72], r, 10); });
  pintar("hojas", (x, y, r) => r() < 0.12 ? [0, 0, 0, 0] : var_([pastoC2[0] * 0.8, pastoC2[1] * 0.85, pastoC2[2] * 0.8], r, 30));
  pintar("nieve", (x, y, r) => var_([236, 242, 250], r, 10));
  pintar("nieve_lado", (x, y, r) => y < 4 + (x % 3 === 0 ? 1 : 0) ? var_([236, 242, 250], r, 8) : var_(tierraC, r, 20));
  pintar("tablas", (x, y, r) => var_(y % 4 === 0 ? [120, 88, 50] : (x + (Math.floor(y / 4) * 5)) % 16 === 0 ? [120, 88, 50] : [170, 130, 80], r, 12));
  pintar("ladrillo", (x, y, r) => { const fila = Math.floor(y / 4), off = fila % 2 ? 4 : 0; return (y % 4 === 3 || (x + off) % 8 === 7) ? var_([190, 180, 170], r, 8) : var_([160, 70, 55], r, 22); });
  pintar("adoquin", (x, y, r) => { const n = ruido2.v2(x * 0.45, y * 0.45); return var_(n > 0.25 ? [95, 95, 95] : [140, 140, 140], r, 20); });
  pintar("cactus_lado", (x, y, r) => var_(x % 4 === 1 ? [40, 100, 40] : (x % 4 === 3 && y % 5 === 2) ? [220, 220, 180] : [70, 140, 60], r, 12));
  pintar("cactus_arriba", (x, y, r) => var_(Math.max(Math.abs(x - 7.5), Math.abs(y - 7.5)) > 6.5 ? [40, 100, 40] : [90, 160, 80], r, 10));
  pintar("hielo", (x, y, r) => var_((x + y) % 9 === 0 ? [220, 240, 255] : [160, 200, 240], r, 10));
  pintar("oro", (x, y, r) => r() < 0.16 ? var_([250, 210, 60], r, 20) : var_(piedraC, r, 22));
  pintar("cristal", (x, y, r) => { const d = Math.abs(x - 7.5) + Math.abs(y - 7.5); return var_(d < 5 ? [190, 140, 255] : d < 9 ? [140, 90, 230] : [90, 60, 170], r, 16); });
  pintar("oscuro", (x, y, r) => var_(r() < 0.1 ? [70, 40, 100] : [34, 26, 44], r, 10));
  pintar("lava", (x, y, r) => var_(ruido2.v2(x * 0.3, y * 0.3) > 0 ? [255, 150, 40] : [220, 70, 20], r, 20));
  pintar("vidrio", (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15 || (x === y && x < 6)) ? [220, 235, 245, 255] : [0, 0, 0, 0]);
  pintar("arenisca", (x, y, r) => var_(y % 5 === 0 ? [200, 170, 110] : [226, 200, 140], r, 12));
  pintar("farol", (x, y, r) => (x === 0 || y === 0 || x === 15 || y === 15) ? [90, 70, 40] : var_([255, 230, 150], r, 20));
  // [arriba, lados, abajo] de cada bloque
  const CARAS = [];
  const def_ = (b, a, l, d) => CARAS[b] = [tiles[a], tiles[l || a], tiles[d || l || a]];
  def_(B.PASTO, "pasto_arriba", "pasto_lado", "tierra"); def_(B.TIERRA, "tierra"); def_(B.PIEDRA, "piedra"); def_(B.ARENA, "arena");
  def_(B.TRONCO, "tronco_arriba", "tronco_lado", "tronco_arriba"); def_(B.HOJAS, "hojas"); def_(B.NIEVE, "nieve", "nieve_lado", "tierra");
  def_(B.TABLAS, "tablas"); def_(B.LADRILLO, "ladrillo"); def_(B.ADOQUIN, "adoquin"); def_(B.CACTUS, "cactus_arriba", "cactus_lado", "cactus_arriba");
  def_(B.HIELO, "hielo"); def_(B.ORO, "oro"); def_(B.CRISTAL, "cristal"); def_(B.OSCURO, "oscuro"); def_(B.LAVA, "lava"); def_(B.VIDRIO, "vidrio");
  def_(B.ARENISCA, "arena", "arenisca", "arenisca"); def_(B.LUZ, "farol");
  const tex = new THREE.CanvasTexture(atlas);
  // píxeles nítidos de cerca (Nearest) y sin parpadeo de lejos (mipmaps + filtrado anisótropo en tarjetas que lo aguantan)
  tex.magFilter = THREE.NearestFilter; tex.minFilter = Q.nivel === "basico" ? THREE.NearestFilter : THREE.NearestMipmapNearestFilter;
  tex.generateMipmaps = Q.nivel !== "basico"; tex.anisotropy = Q.nivel === "basico" ? 1 : Math.min(Q.nivel === "medio" ? 4 : 8, renderer.capabilities.getMaxAnisotropy());
  const matBloques = new THREE.MeshBasicMaterial({ map: tex, vertexColors: true, alphaTest: 0.5 });
  const uvDe = t => { const cx = (t % COLS) * CELDA + 8, cy = Math.floor(t / COLS) * CELDA + 8; return [cx / atlas.width, 1 - (cy + TILE) / atlas.height, (cx + TILE) / atlas.width, 1 - cy / atlas.height]; };
  const UV = []; for (let t = 0; t < sig; t++) UV[t] = uvDe(t);

  /* ───────── Generación del mundo ───────── */
  const SUP = { desierto: B.ARENA, nieve: B.NIEVE, espacio: B.OSCURO, oceano: B.ARENA, ciudad: B.ADOQUIN, futurista: B.OSCURO }[TEMA] || B.PASTO;
  const alturaCol = (wx, wz) => {
    let h = SEA + 2 + ruido.fbm(wx * 0.018, wz * 0.018, 4) * 16 * (0.35 + R) + ruido2.fbm(wx * 0.005, wz * 0.005, 2) * 12 * R;
    if (C.mundo.isla || TEMA === "oceano") { const d = Math.hypot(wx, wz) / 70; h = h * 0.7 + 4 - d * d * 14; }
    if (TEMA === "ciudad" || TEMA === "futurista") h = SEA + 3 + Math.round(ruido.fbm(wx * 0.01, wz * 0.01, 2) * 2);
    const d0 = distCentro(wx, wz); if (d0 < 10) h = NK.lerp(SEA + 4, h, d0 / 10);
    return NK.clamp(Math.round(h), 2, CH - 10);
  };
  const hash = (x, z, s = 0) => { let h = (x * 374761393 + z * 668265263 + (C.mundo.semilla | 0) * 69069 + s * 2246822519) | 0; h = Math.imul(h ^ (h >>> 13), 1274126177); return ((h ^ (h >>> 16)) >>> 0) / 4294967296; };
  const densArbol = { bosque: 0.022, fantasia: 0.018, dinosaurios: 0.02, medieval: 0.012, andes: 0.006, nieve: 0.012, granja: 0.006, terror: 0.02, zombies: 0.008 }[TEMA] ?? 0.01;
  const ediciones = new Map(); // "x,y,z" → bloque (estructuras y cambios del jugador en chunks aún no generados)
  function generar(cx, cz) {
    const d = new Uint8Array(CS * CS * CH);
    const set = (x, y, z, b) => { if (x >= 0 && x < CS && z >= 0 && z < CS && y > 0 && y < CH) d[x + z * CS + y * CS * CS] = b; };
    for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const wx = cx * CS + x, wz = cz * CS + z, h = alturaCol(wx, wz);
      const nieveAlta = h > SEA + 20 && TEMA !== "desierto";
      for (let y = 0; y <= h; y++) {
        let b = y < h - 3 ? (hash(wx, wz, y) < 0.012 && y < h - 6 ? B.ORO : B.PIEDRA) : y < h ? (SUP === B.ARENA ? B.ARENA : SUP === B.OSCURO ? B.OSCURO : B.TIERRA) : (h <= SEA + 1 && SUP === B.PASTO ? B.ARENA : nieveAlta ? B.NIEVE : SUP);
        if (y === 0) b = B.OSCURO;
        if (TEMA === "desierto" && y < h - 2 && y > h - 7) b = B.ARENISCA;
        d[x + z * CS + y * CS * CS] = b;
      }
    }
    // vegetación (se revisa un margen alrededor para que los árboles no se corten en el borde del chunk)
    for (let z = -3; z < CS + 3; z++) for (let x = -3; x < CS + 3; x++) {
      const wx = cx * CS + x, wz = cz * CS + z; const r = hash(wx, wz, 99);
      if (r > densArbol * (1 + ruido2.v2(wx * 0.02, wz * 0.02)) || distCentro(wx, wz) < 6) continue;
      const h = alturaCol(wx, wz); if (h <= SEA + 1) continue;
      if (TEMA === "desierto") { const alto = 2 + Math.floor(hash(wx, wz, 3) * 3); for (let y = 1; y <= alto; y++) set(x, h + y, z, B.CACTUS); continue; }
      if (TEMA === "espacio" || TEMA === "futurista") { const alto = 1 + Math.floor(hash(wx, wz, 3) * 3); for (let y = 1; y <= alto; y++) set(x, h + y, z, B.CRISTAL); continue; }
      if (TEMA === "ciudad") { if (hash(wx, wz, 5) < 0.3) { for (let y = 1; y <= 4; y++) set(x, h + y, z, B.ADOQUIN); set(x, h + 5, z, B.LUZ); } continue; }
      const alto = 4 + Math.floor(hash(wx, wz, 4) * 3), pino = TEMA === "nieve" || TEMA === "andes" || hash(wx, wz, 6) < 0.25;
      for (let y = 1; y <= alto; y++) set(x, h + y, z, B.TRONCO);
      for (let dy = -2; dy <= 2; dy++) for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) {
        const rr = pino ? (2 - Math.max(0, dy + 1) * 0.7) : 2.3 - Math.abs(dy) * 0.3; if (Math.hypot(dx, dz) > rr || (dx === 0 && dz === 0 && dy < 1)) continue;
        const yy = h + alto + dy, i = (x + dx) + (z + dz) * CS + yy * CS * CS;
        if (x + dx >= 0 && x + dx < CS && z + dz >= 0 && z + dz < CS && yy > 0 && yy < CH && d[i] === B.AIRE) d[i] = TEMA === "nieve" && dy === 2 ? B.NIEVE : B.HOJAS;
      }
    }
    for (const [k, b] of ediciones) { const [x, y, z] = k.split(",").map(Number); if (Math.floor(x / CS) === cx && Math.floor(z / CS) === cz) d[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS] = b; }
    return d;
  }
  const chunks = new Map(); // "cx,cz" → {cx, cz, d, malla, sucio}
  const clave = (cx, cz) => cx + "," + cz;
  function datos(cx, cz) { const k = clave(cx, cz); let c = chunks.get(k); if (!c) { c = { cx, cz, d: generar(cx, cz), malla: null, sucio: true }; chunks.set(k, c); } return c; }
  function bloque(x, y, z) {
    if (y < 0) return B.OSCURO; if (y >= CH) return B.AIRE;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = chunks.get(clave(cx, cz));
    if (!c) return y <= alturaCol(x, z) ? B.PIEDRA : B.AIRE;
    return c.d[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS];
  }
  function ponerBloque(x, y, z, b) {
    if (y <= 0 || y >= CH) return false;
    const cx = Math.floor(x / CS), cz = Math.floor(z / CS), c = chunks.get(clave(cx, cz));
    if (!c) { ediciones.set(x + "," + y + "," + z, b); return true; }
    c.d[(x - cx * CS) + (z - cz * CS) * CS + y * CS * CS] = b; c.sucio = true; c.mod = true;
    const lx = x - cx * CS, lz = z - cz * CS; // si está en el borde, el vecino también se vuelve a dibujar
    if (lx === 0) marcar(cx - 1, cz); if (lx === CS - 1) marcar(cx + 1, cz); if (lz === 0) marcar(cx, cz - 1); if (lz === CS - 1) marcar(cx, cz + 1);
    return true;
  }
  const marcar = (cx, cz) => { const c = chunks.get(clave(cx, cz)); if (c) c.sucio = true; };
  const solido = b => b !== B.AIRE && TRANSP[b] !== 1;
  const sueloEn = (x, z, desde = CH - 1) => { const ix = Math.floor(x), iz = Math.floor(z); for (let y = Math.min(CH - 1, desde); y > 0; y--) if (solido(bloque(ix, y, iz))) return y + 1; return 1; };

  /* ───────── Mallado: solo caras visibles + oclusión ambiental por vértice ───────── */
  const DIRS = [ // normal, 4 esquinas (u,v) de la cara, sombra
    { n: [0, 1, 0], c: [[0, 1, 1], [1, 1, 1], [1, 1, 0], [0, 1, 0]], s: 1.0, cara: 0 },
    { n: [0, -1, 0], c: [[0, 0, 0], [1, 0, 0], [1, 0, 1], [0, 0, 1]], s: 0.5, cara: 2 },
    { n: [1, 0, 0], c: [[1, 0, 1], [1, 0, 0], [1, 1, 0], [1, 1, 1]], s: 0.8, cara: 1 },
    { n: [-1, 0, 0], c: [[0, 0, 0], [0, 0, 1], [0, 1, 1], [0, 1, 0]], s: 0.8, cara: 1 },
    { n: [0, 0, 1], c: [[0, 0, 1], [1, 0, 1], [1, 1, 1], [0, 1, 1]], s: 0.68, cara: 1 },
    { n: [0, 0, -1], c: [[1, 0, 0], [0, 0, 0], [0, 1, 0], [1, 1, 0]], s: 0.68, cara: 1 },
  ];
  const AO = [0.52, 0.68, 0.84, 1.0];
  function mallar(c) {
    const pos = [], uv = [], col = [], idx = []; const ox = c.cx * CS, oz = c.cz * CS, d = c.d;
    const get = (x, y, z) => (x >= 0 && x < CS && z >= 0 && z < CS && y >= 0 && y < CH) ? d[x + z * CS + y * CS * CS] : bloque(ox + x, y, oz + z);
    const op = (x, y, z) => { const b = get(x, y, z); return b !== B.AIRE && TRANSP[b] === 0 ? 1 : 0; };
    for (let y = 0; y < CH; y++) for (let z = 0; z < CS; z++) for (let x = 0; x < CS; x++) {
      const b = d[x + z * CS + y * CS * CS]; if (b === B.AIRE) continue;
      for (let f = 0; f < 6; f++) {
        const D = DIRS[f], nx = x + D.n[0], ny = y + D.n[1], nz = z + D.n[2], vb = get(nx, ny, nz);
        if (vb !== B.AIRE && (TRANSP[vb] === 0 || vb === b)) continue;  // cara tapada
        const tile = CARAS[b] ? CARAS[b][D.cara] : 0, u = UV[tile], base = pos.length / 3, aos = [];
        for (let k = 0; k < 4; k++) {
          const cc = D.c[k]; pos.push(ox + x + cc[0], y + cc[1], oz + z + cc[2]);
          // oclusión: los 3 bloques que rodean la esquina, del lado de la cara
          const sx = cc[0] ? 1 : -1, sy = cc[1] ? 1 : -1, sz = cc[2] ? 1 : -1; let a1, a2, a3;
          if (D.n[1]) { a1 = op(x + sx, ny, z); a2 = op(x, ny, z + sz); a3 = op(x + sx, ny, z + sz); }
          else if (D.n[0]) { a1 = op(nx, y + sy, z); a2 = op(nx, y, z + sz); a3 = op(nx, y + sy, z + sz); }
          else { a1 = op(x + sx, y, nz); a2 = op(x, y + sy, nz); a3 = op(x + sx, y + sy, nz); }
          const ao = a1 && a2 ? 0 : 3 - (a1 + a2 + a3); aos.push(ao);
          const L = D.s * AO[ao] * (b === B.LUZ || b === B.LAVA ? 1.25 : 1); col.push(L, L, L);
        }
        uv.push(u[0], u[1], u[2], u[1], u[2], u[3], u[0], u[3]);
        if (aos[0] + aos[2] > aos[1] + aos[3]) idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        else idx.push(base + 1, base + 2, base + 3, base + 1, base + 3, base);
      }
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    g.setIndex(pos.length / 3 > 65535 ? new THREE.Uint32BufferAttribute(idx, 1) : new THREE.Uint16BufferAttribute(idx, 1)); g.computeBoundingSphere();
    if (c.malla) { c.malla.geometry.dispose(); c.malla.geometry = g; } else { c.malla = new THREE.Mesh(g, matBloques); escena.add(c.malla); }
    c.sucio = false;
  }
  function listoParaMallar(cx, cz) { for (const [dx, dz] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) datos(cx + dx, cz + dz); return true; }
  function actualizarChunks(px, pz, max = Q.nivel === "ultra" || Q.nivel === "alto" ? 2 : 1) {
    const pcx = Math.floor(px / CS), pcz = Math.floor(pz / CS); let hechos = 0;
    const lista = [];
    for (let dz = -RADIO; dz <= RADIO; dz++) for (let dx = -RADIO; dx <= RADIO; dx++) if (dx * dx + dz * dz <= RADIO * RADIO + 1) lista.push([pcx + dx, pcz + dz, dx * dx + dz * dz]);
    lista.sort((a, b) => a[2] - b[2]);
    for (const [cx, cz] of lista) {  // se generan y dibujan pocos por cuadro (los más cercanos primero): sin tirones
      if (hechos >= max + 2) break;
      const c = chunks.get(clave(cx, cz));
      if (!c) { if (hechos < max) { listoParaMallar(cx, cz); mallar(datos(cx, cz)); hechos++; } continue; }
      if (c.sucio && hechos < max + (c.malla ? 2 : 0)) { listoParaMallar(cx, cz); mallar(c); hechos++; }
    }
    for (const [k, c] of chunks) {
      const d2 = (c.cx - pcx) ** 2 + (c.cz - pcz) ** 2;
      if (c.malla && d2 > (RADIO + 1.5) ** 2) { escena.remove(c.malla); c.malla.geometry.dispose(); c.malla = null; c.sucio = true; }
      if (!c.malla && !c.mod && d2 > (RADIO + 6) ** 2) chunks.delete(k);  // lejos y sin cambios: se vuelve a generar igual si regresas
    }
  }

  /* ───────── Cielo, nubes, agua, sol y luna ───────── */
  const cieloDia = new THREE.Color(A.cielo), horDia = new THREE.Color(A.horizonte), cieloNoche = new THREE.Color("#0b1026"), horNoche = new THREE.Color("#1c2440");
  const uCielo = { a: { value: new THREE.Color() }, b: { value: new THREE.Color() } };
  const cielo = new THREE.Mesh(new THREE.SphereGeometry(lejos * 1.4, 24, 12), new THREE.ShaderMaterial({ side: THREE.BackSide, depthWrite: false, fog: false, uniforms: uCielo,
    vertexShader: "varying vec3 p; void main(){ p = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "uniform vec3 a; uniform vec3 b; varying vec3 p; void main(){ float t = clamp(p.y*1.5+0.1,0.0,1.0); gl_FragColor = vec4(mix(b,a,t),1.0); }" }));
  cielo.frustumCulled = false; escena.add(cielo);
  escena.fog = new THREE.Fog(0xffffff, lejos * 0.55, lejos * 0.98);
  const astro = (color, tam) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(tam, tam), new THREE.MeshBasicMaterial({ color, fog: false, depthWrite: false })); m.frustumCulled = false; escena.add(m); return m; };
  const sol = astro(0xfff3b0, lejos * 0.12), luna = astro(0xdfe8ff, lejos * 0.08);
  let estrellas;
  { const n = 700, p = new Float32Array(n * 3); for (let i = 0; i < n; i++) { const th = rnd() * Math.PI * 2, ph = Math.acos(rnd()), R0 = lejos * 1.3; p[i * 3] = R0 * Math.sin(ph) * Math.cos(th); p[i * 3 + 1] = R0 * Math.cos(ph); p[i * 3 + 2] = R0 * Math.sin(ph) * Math.sin(th); }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(p, 3)); estrellas = new THREE.Points(g, new THREE.PointsMaterial({ color: 0xffffff, size: 1.5, sizeAttenuation: false, fog: false, transparent: true })); estrellas.frustumCulled = false; escena.add(estrellas); }
  const nNubes = Math.round(50 * Q.densidad), nubes = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.85 }), nNubes);
  const datosNubes = []; for (let i = 0; i < nNubes; i++) datosNubes.push({ x: (rnd() - 0.5) * lejos * 2.4, z: (rnd() - 0.5) * lejos * 2.4, w: 8 + rnd() * 18, d: 6 + rnd() * 14 });
  nubes.frustumCulled = false; if (TEMA !== "espacio") escena.add(nubes);
  const agua = new THREE.Mesh(new THREE.PlaneGeometry(lejos * 3, lejos * 3), new THREE.MeshBasicMaterial({ color: A.agua || "#2f6f9f", transparent: true, opacity: 0.72, depthWrite: false }));
  agua.rotation.x = -Math.PI / 2; agua.position.y = SEA + 0.88; agua.renderOrder = 2; if (A.agua !== null) escena.add(agua);

  /* ───────── Luz (los personajes de bloques .glb y los muñecos la necesitan; los bloques traen su propia luz) ───────── */
  document.body.classList.add("nk-voxel");
  const luzCielo = new THREE.HemisphereLight(0xe8f2ff, 0x5a4a3a, 0.9), luzSol = new THREE.DirectionalLight(0xfff2dd, 1.0);
  const luzAmb = new THREE.AmbientLight(0xffffff, 0.3);
  luzSol.position.set(30, 60, 20); escena.add(luzCielo, luzSol, luzAmb);

  /* ───────── Jugador ───────── */
  const jug = { pos: new THREE.Vector3(0.5, 40, 0.5), vel: new THREE.Vector3(), yaw: 0, pitch: 0, enSuelo: false, vida: C.jugador.vida, vidaMax: C.jugador.vida, puntos: 0, invul: 0,
    colocados: 0, rotos: 0, sel: 0, golpe: 0, enAgua: false, cd: 0, saltosAire: 0, mult: { vida: 1, vel: 1, salto: 1, danio: 1, cad: 1, alc: 1 }, efectos: {} };
  const ANCHO = 0.3, ALTO = 1.75, OJOS = 1.6;
  const TERCERA = C.camara === "tercera";
  const BARRA = [B.TABLAS, B.ADOQUIN, B.LADRILLO, B.VIDRIO, B.TRONCO, B.PIEDRA, SUP === B.PASTO ? B.TIERRA : SUP, B.LUZ, B.CRISTAL];
  // muñeco de bloques de respaldo (si no hay figura .glb)
  const matPJ = new THREE.MeshLambertMaterial({ vertexColors: true });
  function cajaColor(w, h, d, x, y, z, color) { const g = new THREE.BoxGeometry(w, h, d).toNonIndexed(); g.translate(x, y, z); const c = new THREE.Color(color), n = g.attributes.position.count, a = new Float32Array(n * 3); for (let i = 0; i < n; i++) { a[i * 3] = c.r; a[i * 3 + 1] = c.g; a[i * 3 + 2] = c.b; } g.setAttribute("color", new THREE.BufferAttribute(a, 3)); g.deleteAttribute("uv"); return g; }
  function fusionar(gs) { let n = 0; gs.forEach(g => n += g.attributes.position.count); const p = new Float32Array(n * 3), no = new Float32Array(n * 3), co = new Float32Array(n * 3); let o = 0;
    gs.forEach(g => { p.set(g.attributes.position.array, o * 3); no.set(g.attributes.normal.array, o * 3); co.set(g.attributes.color.array, o * 3); o += g.attributes.position.count; g.dispose(); });
    const r = new THREE.BufferGeometry(); r.setAttribute("position", new THREE.BufferAttribute(p, 3)); r.setAttribute("normal", new THREE.BufferAttribute(no, 3)); r.setAttribute("color", new THREE.BufferAttribute(co, 3)); r.computeBoundingSphere(); return r; }
  function muneco(ropa, piel, pantalon) {
    const g = new THREE.Group();
    const cuerpo = new THREE.Mesh(fusionar([cajaColor(0.5, 0.7, 0.28, 0, 1.1, 0, ropa), cajaColor(0.46, 0.46, 0.46, 0, 1.68, 0, piel), cajaColor(0.1, 0.08, 0.02, 0.1, 1.7, 0.235, "#222"), cajaColor(0.1, 0.08, 0.02, -0.1, 1.7, 0.235, "#222")]), matPJ);
    const pierna = () => { const m = new THREE.Mesh(fusionar([cajaColor(0.22, 0.72, 0.26, 0, -0.36, 0, pantalon)]), matPJ); m.position.y = 0.75; return m; };
    const brazo = () => { const m = new THREE.Mesh(fusionar([cajaColor(0.18, 0.7, 0.22, 0, -0.3, 0, ropa)]), matPJ); m.position.y = 1.4; return m; };
    const pi = pierna(), pd = pierna(), bi = brazo(), bd = brazo(); pi.position.x = -0.12; pd.position.x = 0.12; bi.position.x = -0.35; bd.position.x = 0.35;
    g.add(cuerpo, pi, pd, bi, bd); g.userData = { pi, pd, bi, bd }; return g;
  }
  /* figuras animadas .glb (las de bloques que crea Noviq): se clonan con su esqueleto y se animan con su mezclador */
  const animadas = new Set();
  function figura(rol, alto, respaldo) {
    const g = new THREE.Group(), f = { g, mixer: null, acc: {}, actual: null, glb: false, mano: null, alto, cuerpo: respaldo };
    g.add(respaldo); f.u = respaldo.userData || {};
    f.listo = (NK.tieneModelo(rol) ? NK.cargarGLB(rol) : Promise.resolve(null)).then(gltf => {
      if (!gltf) return f;
      if (!gltf.__srgb) {  // este motor pinta sin corrección gamma: los colores lineales del .glb se pasan a sRGB (una sola vez)
        gltf.__srgb = true;
        gltf.scene.traverse(o => { const c = o.geometry && o.geometry.attributes && o.geometry.attributes.color; if (c && !c.__srgb) { c.__srgb = true;
          for (let i = 0; i < c.array.length; i++) { const v = c.array[i]; c.array[i] = v <= 0.0031308 ? v * 12.92 : 1.055 * Math.pow(v, 1 / 2.4) - 0.055; } c.needsUpdate = true; }
          if (o.material && o.material.color) { const m = o.material; m.color.convertLinearToSRGB && m.color.convertLinearToSRGB(); } });
      }
      const m = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(gltf.scene) : gltf.scene.clone(true);
      m.updateMatrixWorld(true);
      const box = new THREE.Box3().setFromObject(m), h = (box.max.y - box.min.y) || 1, k = alto / h;
      m.scale.setScalar(k); m.position.y = -box.min.y * k;
      m.traverse(o => { if (o.isMesh || o.isSkinnedMesh) o.frustumCulled = false; if (o.isBone && !f.mano && /hand_?r$/i.test(o.name)) f.mano = o; });
      g.remove(respaldo); g.add(m); f.cuerpo = m; f.u = {}; f.glb = true;
      if (gltf.animations && gltf.animations.length) { f.mixer = new THREE.AnimationMixer(m); for (const c of gltf.animations) f.acc[c.name] = f.mixer.clipAction(c); animadas.add(f); animar(f, "Idle"); }
      return f;
    });
    return f;
  }
  function animar(f, nombre, unaVez) {
    if (!f || !f.mixer) return; const a = f.acc[nombre] || (nombre === "Walk" && f.acc.Run) || f.acc.Idle; if (!a) return;
    if (f.actual === a && !unaVez) return;
    a.reset(); a.setLoop(unaVez ? THREE.LoopOnce : THREE.LoopRepeat, Infinity); a.clampWhenFinished = !!unaVez; a.enabled = true; a.setEffectiveWeight(1);
    if (f.actual && f.actual !== a) a.crossFadeFrom(f.actual, 0.15, false); a.play(); f.actual = a; f.tUna = unaVez ? a.getClip().duration : 0;
  }
  const figurasJ = {};
  function figuraJugador(rol) { if (!figurasJ[rol]) { const f = figura(rol, 1.8, muneco(C.jugador.color, "#e0b48c", "#3a4a8a")); f.g.visible = false; escena.add(f.g); figurasJ[rol] = f; } return figurasJ[rol]; }
  let PJF = figuraJugador(NK.tieneModelo("jugador") ? "jugador" : "jugador");
  PJF.g.visible = TERCERA;
  // arma en la mano (3.ª persona)
  const armasMano = {};
  function armaEnMano(a) {
    for (const k in armasMano) { const o = armasMano[k]; if (o.parent) o.parent.remove(o); }
    if (!a || !TERCERA) return; const rol = a.modelo || ("arma_" + a.id);
    if (!NK.tieneModelo(rol)) return;
    NK.cargarGLB(rol).then(g => { if (!g || !PJF.mano) return; const piv = armasMano[a.id] || (armasMano[a.id] = (() => { const p = new THREE.Group(), m = g.scene.clone(true); p.add(m); if (a.tipo === "disparo") m.rotation.x = Math.PI / 2; return p; })());
      PJF.mano.add(piv); PJF.mano.updateMatrixWorld(true); const ws = PJF.mano.getWorldScale(new THREE.Vector3()); piv.scale.setScalar(1 / Math.max(0.001, ws.x)); });
  }

  /* ───────── Travesía: zonas en el mismo mundo (cada una con su campamento, guía, objetivo y peligros) ───────── */
  const TR = NK.travesia;
  const ARMAS = (CAMP && CAMP.armas) || [];
  const JEFE_CFG = CAMP && CAMP.jefe;
  let zi = 0, Z = ZONAS[0], OBJ = Z.objetivo || C.objetivo;
  const HORA_Z = { dia: 0.28, atardecer: 0.46, noche: 0.8 };

  /* ───────── Criaturas (pool) ───────── */
  const FORMA_MOB = {
    zombie: c => muneco("#3f6fa0", c, "#3a3a6a"), esqueleto: c => muneco("#e8e2d0", "#f3efe4", "#cfc8b8"), robot: c => muneco("#9aa3ad", "#b8c0c8", "#6b737c"),
    slime: c => { const g = new THREE.Group(); g.add(new THREE.Mesh(fusionar([cajaColor(0.9, 0.9, 0.9, 0, 0.45, 0, c), cajaColor(0.14, 0.14, 0.02, 0.18, 0.6, 0.455, "#111"), cajaColor(0.14, 0.14, 0.02, -0.18, 0.6, 0.455, "#111")]), matPJ)); g.userData = {}; return g; },
    lobo: c => { const g = new THREE.Group(); g.add(new THREE.Mesh(fusionar([cajaColor(0.5, 0.45, 1, 0, 0.6, 0, c), cajaColor(0.4, 0.4, 0.4, 0, 0.8, 0.62, c), cajaColor(0.06, 0.06, 0.02, 0.1, 0.86, 0.83, "#ff3"), cajaColor(0.06, 0.06, 0.02, -0.1, 0.86, 0.83, "#ff3"),
      cajaColor(0.14, 0.4, 0.14, 0.16, 0.2, 0.35, c), cajaColor(0.14, 0.4, 0.14, -0.16, 0.2, 0.35, c), cajaColor(0.14, 0.4, 0.14, 0.16, 0.2, -0.35, c), cajaColor(0.14, 0.4, 0.14, -0.16, 0.2, -0.35, c), cajaColor(0.1, 0.1, 0.45, 0, 0.75, -0.65, c)]), matPJ)); g.userData = {}; return g; },
  };
  FORMA_MOB.fantasma = c => muneco(c, c, c); FORMA_MOB.zorro = FORMA_MOB.lobo; FORMA_MOB.dinosaurio = c => { const g = FORMA_MOB.lobo(c); g.scale.setScalar(2); return g; };
  FORMA_MOB.escorpion = FORMA_MOB.slime; FORMA_MOB.cangrejo = FORMA_MOB.slime; FORMA_MOB.condor = FORMA_MOB.slime; FORMA_MOB.alien = FORMA_MOB.slime;
  FORMA_MOB.soldado = c => muneco("#4a5a3a", "#d9a27a", "#3f4a32"); FORMA_MOB.mercenario = c => muneco("#3a3a3a", "#d9a27a", "#4a4a3a");
  const altoForma = f => (f === "slime" ? 0.9 : f === "lobo" || f === "zorro" || f === "jabali" ? 1.1 : f === "dinosaurio" ? 1.6 : 1.8);
  const mobs = [];
  (C.enemigos || []).forEach((e, ti) => { if (e.comportamiento === "rival") return;
    const total = CAMP ? Math.max(...ZONAS.map(z => ((z.enemigos || []).find(r => r.ref === ti) || { cantidad: 0 }).cantidad || 0), 2) + 4 : Math.round(e.cantidad * (OBJ.tipo === "sobrevivir" ? 1.5 : 1));
    const n = Math.max(1, Math.min(14, total)), rol = e.modelo || (ti === 0 ? "enemigo" : "enemigo" + (ti + 1)), alto = altoForma(e.forma);
    for (let i = 0; i < n; i++) {
      const f = figura(rol, alto, (FORMA_MOB[e.forma] || FORMA_MOB.zombie)(e.color || "#6f9a5a")); f.g.visible = false; escena.add(f.g);
      mobs.push({ tipo: ti, cfg: e, f, g: f.g, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, activo: false, vida: e.vida || 30, vidaMax: e.vida || 30, cd: 0, golpe: 0, t: rnd() * 9, muriendo: 0, alto, ladron: false, robado: 0 });
    } });

  /* ───────── Objetos, potenciadores, meta, guía, fogata y partículas ───────── */
  const objetos = [];
  const gObj = { gema: new THREE.OctahedronGeometry(0.32, 0), moneda: new THREE.CylinderGeometry(0.3, 0.3, 0.08, 12).rotateX(Math.PI / 2), cristal: new THREE.OctahedronGeometry(0.28, 0).scale(1, 1.5, 1), estrella: new THREE.OctahedronGeometry(0.34, 0) };
  const conjObj = [];
  (C.objetos || []).forEach((o, oi) => { let n = Math.max(0, Math.round(o.cantidad || 0)); if (CAMP && oi === 0) n = Math.max(n, ...ZONAS.map(z => z.objetivo && z.objetivo.tipo === "recolectar" ? z.objetivo.cantidad + 3 : 0)); if (!n) return;
    const im = new THREE.InstancedMesh(gObj[o.forma] || gObj.gema, new THREE.MeshBasicMaterial({ color: o.color || "#39e6ff" }), n); im.frustumCulled = false; escena.add(im); conjObj[oi] = im;
    for (let i = 0; i < n; i++) objetos.push({ tipo: oi, cfg: o, i, im, pos: new THREE.Vector3(), activo: false, fase: rnd() * 6 }); });
  const POT_COL = { curacion: 0xff4a6a, vida_extra: 0x5aff8a, escudo: 0x7ad8ff, turbo: 0xffe27a, iman: 0xff7a3a, furia: 0xff3a1a };
  const potes = []; for (let k = 0; k < 6; k++) { const m = new THREE.Mesh(new THREE.IcosahedronGeometry(0.34, 0), new THREE.MeshBasicMaterial({ color: 0xffffff })); m.visible = false; escena.add(m); potes.push({ m, tipo: "curacion", activo: false, pos: new THREE.Vector3(), fase: rnd() * 6 }); }
  const tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new THREE.Vector3(), tmpV = new THREE.Vector3(), EJE_Y = new THREE.Vector3(0, 1, 0);
  let meta = null;
  const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 60, 8, 1, true), new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.35, depthWrite: false, side: THREE.DoubleSide })); haz.visible = false; escena.add(haz);
  const NP = 260, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), parts = [];
  const gP = new THREE.BufferGeometry(); gP.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); gP.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const nube = new THREE.Points(gP, new THREE.PointsMaterial({ size: 0.16, vertexColors: true })); nube.frustumCulled = false; escena.add(nube);
  for (let i = 0; i < NP; i++) { parts.push({ v: new THREE.Vector3(), vida: 0 }); pPos[i * 3 + 1] = -999; }
  let pSig = 0;
  const COLOR_B = { [B.PASTO]: "#5c9a3c", [B.TIERRA]: "#79553a", [B.PIEDRA]: "#808080", [B.ARENA]: "#dbcea0", [B.TRONCO]: "#6e5232", [B.HOJAS]: "#3f7a2e", [B.NIEVE]: "#eef2fa", [B.TABLAS]: "#aa8250", [B.LADRILLO]: "#a04637" };
  function particulas(x, y, z, color, n = 14) { const c = new THREE.Color(color); for (let k = 0; k < n; k++) { const i = pSig++ % NP, q = parts[i]; q.vida = 0.5 + rnd() * 0.4; q.v.set((rnd() - 0.5) * 4, rnd() * 4, (rnd() - 0.5) * 4); pPos[i * 3] = x; pPos[i * 3 + 1] = y; pPos[i * 3 + 2] = z; pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b; } }
  const marco = new THREE.LineSegments(new THREE.EdgesGeometry(new THREE.BoxGeometry(1.004, 1.004, 1.004)), new THREE.LineBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 })); marco.visible = false; escena.add(marco);
  // guías (uno por modelo) con su «!» encima
  const guias = {};
  function guia(z) { if (!z.npc) return null; const rol = z.npc.modelo || "npc"; if (!guias[rol]) { const f = figura(rol, 1.8, muneco("#7a5a3a", "#e0b48c", "#5a4a3a")); f.g.visible = false; escena.add(f.g);
      const marca = new THREE.Mesh(new THREE.OctahedronGeometry(0.18, 0), new THREE.MeshBasicMaterial({ color: 0xffd23f })); marca.position.y = 2.35; f.g.add(marca); f.marca = marca; guias[rol] = f; } return guias[rol]; }
  // proyectiles (del jugador y del jefe) y rocas del derrumbe
  const proys = []; for (let k = 0; k < 24; k++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 8, 6), new THREE.MeshBasicMaterial({ color: 0xffe27a })); m.visible = false; escena.add(m); proys.push({ m, vel: new THREE.Vector3(), vida: 0, enemigo: false, danio: 10 }); }
  const rocas = []; for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.8, 0.8), new THREE.MeshLambertMaterial({ color: 0x8a847a })); m.visible = false; escena.add(m); rocas.push({ m, vy: 0, activa: false }); }
  const lluviaN = 500, lluviaP = new Float32Array(lluviaN * 3), gLl = new THREE.BufferGeometry(); gLl.setAttribute("position", new THREE.BufferAttribute(lluviaP, 3));
  const lluvia = new THREE.Points(gLl, new THREE.PointsMaterial({ color: 0xaac4ff, size: 0.08, transparent: true, opacity: 0.7 })); lluvia.visible = false; lluvia.frustumCulled = false; escena.add(lluvia);
  for (let i = 0; i < lluviaN; i++) { lluviaP[i * 3] = (rnd() - 0.5) * 40; lluviaP[i * 3 + 1] = rnd() * 24; lluviaP[i * 3 + 2] = (rnd() - 0.5) * 40; }
  // jefe
  const jefe = { activo: false, presentado: false, f: null, pos: new THREE.Vector3(), vel: new THREE.Vector3(), yaw: 0, vida: 1, vidaMax: 1, fase: 0, hab: null, tHab: 0, cd: 2.5, t: 0, muriendo: 0, lanzo: false, alto: 3.6 };
  if (JEFE_CFG) { jefe.alto = NK.clamp(JEFE_CFG.altura || 3.6, 2.2, 6); jefe.f = figura("jefe", jefe.alto, (() => { const g = muneco("#6a1a1a", "#8a4a3a", "#3a1a1a"); g.scale.setScalar(jefe.alto / 1.8); return g; })()); jefe.f.g.visible = false; escena.add(jefe.f.g); }

  /* ───────── Estado, ciclo de día y noche ───────── */
  const DIA = 300; // segundos que dura un día completo
  const P = { t: 0, hora: A.hora === "noche" ? 0.75 : A.hora === "atardecer" ? 0.45 : 0.25, recogidos: 0, derrotados: 0, derrotadosTotal: 0, total: OBJ.cantidad || 1, tiempoRestante: 0, spawn: 0, noches: 0,
    completa: false, contra: null, contraT: 0, contraHecho: false, relampago: 3, centro: { x: 0.5, z: 0.5 }, niebla: 1 };
  let luz = 1;
  function cicloDia(dt) {
    P.hora = (P.hora + dt / DIA) % 1;
    const s = Math.sin(P.hora * Math.PI * 2); // 1 al mediodía, -1 a medianoche
    luz = NK.clamp(0.28 + (s + 0.25) * 0.75, 0.28, 1) * (P.contra && P.contra.tipo === "tormenta" ? 0.7 : 1);
    const k = NK.clamp((s + 0.3) / 0.6, 0, 1);
    uCielo.a.value.copy(cieloNoche).lerp(cieloDia, k); uCielo.b.value.copy(horNoche).lerp(horDia, k);
    if (P.contra && P.contra.tipo === "tormenta") { uCielo.a.value.lerp(new THREE.Color("#4a5260"), 0.6); uCielo.b.value.lerp(new THREE.Color("#6a7280"), 0.6); }
    if (jug.enAgua && camara.position.y < SEA + 0.88) { escena.fog.color.set(A.agua || "#2f6f9f"); escena.fog.near = 1; escena.fog.far = 18; }
    else { escena.fog.color.copy(uCielo.b.value); escena.fog.near = lejos * 0.55 / P.niebla; escena.fog.far = lejos * 0.98 / P.niebla; }
    matBloques.color.setScalar(luz); luzCielo.intensity = 0.35 + 0.7 * luz; luzSol.intensity = 0.15 + 0.95 * luz;
    estrellas.material.opacity = NK.clamp(-s * 2, 0, 1); estrellas.visible = s < 0.1;
    const ang = P.hora * Math.PI * 2 - Math.PI / 2, R0 = lejos * 1.2;
    sol.position.set(camara.position.x + Math.cos(ang) * R0, camara.position.y + Math.sin(ang) * R0, camara.position.z + R0 * 0.2); sol.lookAt(camara.position);
    luna.position.set(camara.position.x - Math.cos(ang) * R0, camara.position.y - Math.sin(ang) * R0, camara.position.z - R0 * 0.2); luna.lookAt(camara.position);
    luzSol.position.set(Math.cos(ang) * 50, Math.max(15, Math.sin(ang) * 60), 20);
    nubes.material.color.setScalar(Math.max(0.35, luz));
    return s;
  }

  /* ───────── Física del jugador ───────── */
  function choca(x, y, z) {
    for (let bx = Math.floor(x - ANCHO); bx <= Math.floor(x + ANCHO); bx++) for (let bz = Math.floor(z - ANCHO); bz <= Math.floor(z + ANCHO); bz++)
      for (let by = Math.floor(y); by <= Math.floor(y + ALTO - 0.01); by++) if (solido(bloque(bx, by, bz))) return true;
    return false;
  }
  function moverEje(e, cant) {
    if (!cant) return false;
    const pasos = Math.ceil(Math.abs(cant) / 0.25), d = cant / pasos;
    for (let i = 0; i < pasos; i++) { jug.pos[e] += d; if (choca(jug.pos.x, jug.pos.y, jug.pos.z)) { jug.pos[e] -= d; return true; } }
    return false;
  }
  function moverJugador(dt) {
    const e = NK.eje(), correr = NK.boton("correr") ? 1.55 : 1, v = Math.min(12, C.jugador.velocidad * 0.75) * correr * jug.mult.vel * (jug.efectos.turbo > 0 ? 1.45 : 1);
    const fx = -Math.sin(jug.yaw), fz = -Math.cos(jug.yaw), rx = Math.cos(jug.yaw), rz = -Math.sin(jug.yaw);
    const quiereX = (fx * e.y + rx * e.x) * v, quiereZ = (fz * e.y + rz * e.x) * v;
    const ac = jug.enSuelo ? 18 : 6; jug.vel.x = NK.lerp(jug.vel.x, quiereX, 1 - Math.exp(-ac * dt)); jug.vel.z = NK.lerp(jug.vel.z, quiereZ, 1 - Math.exp(-ac * dt));
    const bAgua = bloque(Math.floor(jug.pos.x), Math.floor(jug.pos.y + 0.4), Math.floor(jug.pos.z)) === B.AIRE && jug.pos.y + 0.4 < SEA + 0.88 && A.agua !== null;
    jug.enAgua = bAgua; if (jug.enSuelo) jug.saltosAire = 0;
    if (bAgua) { jug.vel.y = NK.lerp(jug.vel.y, NK.boton("saltar") ? 3.2 : -1.6, 1 - Math.exp(-4 * dt)); }
    else { jug.vel.y -= 28 * dt;
      if (NK.pulso("saltar")) { if (jug.enSuelo) { jug.vel.y = Math.max(7.6, C.jugador.salto * 0.95) * Math.sqrt(jug.mult.salto); jug.enSuelo = false; NK.sonido("salto"); }
        else if (TR.mejoras && TR.mejoras.has("doble_salto") && jug.saltosAire < 1) { jug.saltosAire++; jug.vel.y = 7.2; NK.sonido("salto"); } } }
    const chX = moverEje("x", jug.vel.x * dt), chZ = moverEje("z", jug.vel.z * dt);
    // salto automático al chocar con un escalón de 1 bloque (más fácil para principiantes)
    if ((chX || chZ) && jug.enSuelo && (e.x || e.y)) { const ax = Math.floor(jug.pos.x + Math.sign(quiereX) * 0.5), az = Math.floor(jug.pos.z + Math.sign(quiereZ) * 0.5), ay = Math.floor(jug.pos.y);
      if (!solido(bloque(ax, ay + 1, az)) && !solido(bloque(ax, ay + 2, az))) { jug.vel.y = 7.8; jug.enSuelo = false; } }
    const cayendo = jug.vel.y < 0, chY = moverEje("y", jug.vel.y * dt);
    if (chY) { if (cayendo) { if (jug.vel.y < -16) danio(Math.round((-jug.vel.y - 15) * 3), "caída"); jug.enSuelo = true; } jug.vel.y = 0; } else jug.enSuelo = false;
    if (jug.pos.y < -10) { jug.pos.set(P.centro.x, sueloEn(P.centro.x, P.centro.z) + 1, P.centro.z); jug.vel.set(0, 0, 0); danio(20, "vacío"); }
    const bajo = bloque(Math.floor(jug.pos.x), Math.floor(jug.pos.y - 0.1), Math.floor(jug.pos.z)); if (bajo === B.LAVA) danio(10, "lava");
    if (bajo === B.CACTUS || bloque(Math.floor(jug.pos.x), Math.floor(jug.pos.y + 0.5), Math.floor(jug.pos.z)) === B.CACTUS) danio(3, "cactus");
  }
  function danio(n, motivo) {
    if (jug.invul > 0 || NK.estado !== "jugando" || n <= 0 || jug.efectos.escudo > 0) return;
    if (NK.gancho("alDanio", J, n) === false) return;
    n *= TR.activa ? TR.dif.danio : 1;
    jug.vida -= n; jug.invul = 0.7; NK.sonido("danio"); NK.ui.danio(); if (TR.activa) TR.stats.danioZona += n;
    if (jug.vida <= 0) { jug.vida = 0; if (TR.activa) { NK.estado = "caida"; animar(PJF, "Death", true); setTimeout(() => TR.morir(motivo === "jefe" ? "¡El jefe te derrotó!" : "¡Caíste!"), 900); } else NK.terminar(false, `Te quedaste sin vida. Puntos: ${jug.puntos}`); }
  }

  /* ───────── Mirar, romper, poner y atacar (rayo por la cuadrícula) ───────── */
  const dir = new THREE.Vector3();
  function rayo(max = 6) {
    camara.getWorldDirection(dir); const o = camara.position;
    let x = Math.floor(o.x), y = Math.floor(o.y), z = Math.floor(o.z);
    const sx = Math.sign(dir.x), sy = Math.sign(dir.y), sz = Math.sign(dir.z);
    const tdx = Math.abs(1 / dir.x), tdy = Math.abs(1 / dir.y), tdz = Math.abs(1 / dir.z);
    let tmx = ((sx > 0 ? x + 1 - o.x : o.x - x)) * tdx, tmy = ((sy > 0 ? y + 1 - o.y : o.y - y)) * tdy, tmz = ((sz > 0 ? z + 1 - o.z : o.z - z)) * tdz;
    let px = x, py = y, pz = z, t = 0;
    while (t <= max) {
      const b = bloque(x, y, z); if (b !== B.AIRE) return { x, y, z, b, px, py, pz, t };
      px = x; py = y; pz = z;
      if (tmx < tmy && tmx < tmz) { x += sx; t = tmx; tmx += tdx; } else if (tmy < tmz) { y += sy; t = tmy; tmy += tdy; } else { z += sz; t = tmz; tmz += tdz; }
    }
    return null;
  }
  function mobApuntado(max = 4) {
    camara.getWorldDirection(dir); let best = null, bt = max + (TERCERA ? 4.2 : 0);
    const lista = jefe.activo && !jefe.muriendo ? [...mobs, jefe] : mobs;
    for (const m of lista) { if ((m !== jefe && !m.activo) || m.muriendo) continue; tmpV.set(m.pos.x, m.pos.y + m.alto / 2, m.pos.z).sub(camara.position); const t = tmpV.dot(dir); if (t < 0 || t > bt) continue;
      const d2 = tmpV.lengthSq() - t * t; if (d2 < (0.5 + m.alto * 0.25) ** 2) { best = m; bt = t; } }
    return best;
  }
  let armaAct = null;
  function equipar(a) { armaAct = a || null; armaEnMano(armaAct); if (NK.ui.arma) NK.ui.arma(armaAct, TR.activa ? TR.armasDisponibles().length : ARMAS.length); }
  function disparar(o, v, enemigo, dmg, color) { const p = proys.find(q => q.vida <= 0); if (!p) return; p.m.position.copy(o); p.vel.copy(v); p.vida = 2.2; p.enemigo = enemigo; p.danio = dmg; p.m.material.color.set(color || (enemigo ? 0xff7a3a : 0xffe27a)); p.m.visible = true; }
  function interactuar() {
    const golpear = NK.pulso("Mouse0") || (NK.pulso("KeyE") && !cercaGuia()), poner = NK.pulso("Mouse2") || (NK.pulso("KeyQ") && !(TR.activa && ARMAS.length > 1));
    const r = rayo();
    if (r) { marco.visible = true; marco.position.set(r.x + 0.5, r.y + 0.5, r.z + 0.5); } else marco.visible = false;
    jug.cd = Math.max(0, jug.cd - 1 / 60);
    if (golpear && jug.cd <= 0) {
      jug.golpe = 0.25; animar(PJF, armaAct && armaAct.tipo !== "cuerpo" ? "Shoot" : "Attack", true);
      const dmg = (armaAct ? armaAct.danio : 12) * jug.mult.danio * (jug.efectos.furia > 0 ? 2 : 1);
      jug.cd = (armaAct ? armaAct.cadencia : 0.3) * jug.mult.cad;
      if (armaAct && armaAct.tipo !== "cuerpo") { camara.getWorldDirection(dir); const o = camara.position.clone().addScaledVector(dir, TERCERA ? 4.6 : 0.6); disparar(o, dir.clone().multiplyScalar(armaAct.tipo === "magia" ? 26 : 42), false, dmg, armaAct.tipo === "magia" ? 0xc07aff : 0xffe27a); NK.sonido(armaAct.tipo === "magia" ? "magia" : "disparo"); return; }
      const m = mobApuntado((armaAct ? armaAct.alcance : 3) * jug.mult.alc + 1); if (m && (!r || m.pos.distanceTo(camara.position) < r.t + 0.5 + (TERCERA ? 4.2 : 0))) { if (m === jefe) herirJefe(dmg); else herirMob(m, dmg); return; }
      if (r && r.y > 0 && r.b !== B.OSCURO) { if (NK.gancho("alRomper", J, r) === false) return; ponerBloque(r.x, r.y, r.z, B.AIRE); jug.rotos++; NK.sonido("romper"); particulas(r.x + 0.5, r.y + 0.5, r.z + 0.5, COLOR_B[r.b] || "#888888"); }
    }
    if (poner && r) {
      const b = BARRA[jug.sel]; const x = r.px, y = r.py, z = r.pz;
      const dentro = x >= Math.floor(jug.pos.x - ANCHO) && x <= Math.floor(jug.pos.x + ANCHO) && z >= Math.floor(jug.pos.z - ANCHO) && z <= Math.floor(jug.pos.z + ANCHO) && y >= Math.floor(jug.pos.y) && y <= Math.floor(jug.pos.y + ALTO);
      if (!dentro && bloque(x, y, z) === B.AIRE) { if (NK.gancho("alPoner", J, { x, y, z, b }) === false) return; ponerBloque(x, y, z, b); jug.colocados++; NK.sonido("poner"); }
    }
    if (TR.activa && NK.pulso("KeyQ")) { const d = TR.armasDisponibles(); if (d.length > 1) { equipar(d[(d.indexOf(armaAct) + 1) % d.length]); NK.sonido("poner"); } }
    const rueda = NK.raton.rueda; if (rueda) { jug.sel = (jug.sel + (rueda > 0 ? 1 : -1) + BARRA.length) % BARRA.length; NK.raton.rueda = 0; pintarBarra(); }
    for (let i = 0; i < 9; i++) if (NK.pulso("Digit" + (i + 1))) { jug.sel = i; pintarBarra(); }
  }
  function pintarBarra() {
    NK.ui.barra(BARRA.map((b, i) => `<div class="ranura${i === jug.sel ? " sel" : ""}" title="${NOMBRE[b]}"><canvas data-t="${CARAS[b][1]}" width="16" height="16"></canvas><span>${i + 1}</span></div>`).join(""));
    document.querySelectorAll("#nk-hud .barra canvas").forEach(c => { const t = +c.dataset.t, x = c.getContext("2d"); x.imageSmoothingEnabled = false; x.drawImage(atlas, (t % COLS) * CELDA + 8, Math.floor(t / COLS) * CELDA + 8, TILE, TILE, 0, 0, 16, 16); });
  }

  /* ───────── Criaturas: IA ───────── */
  function refZona() { const l = (Z.enemigos && Z.enemigos.length) ? Z.enemigos : [{ ref: 0, cantidad: 4 }]; return l[Math.floor(rnd() * l.length)].ref || 0; }
  function spawnMob(m, cerca) {
    for (let k = 0; k < 12; k++) {
      const a = rnd() * Math.PI * 2, d = (cerca ? 6 : 14) + rnd() * (cerca ? 6 : 16), x = jug.pos.x + Math.cos(a) * d, z = jug.pos.z + Math.sin(a) * d;
      if (!chunks.has(clave(Math.floor(x / CS), Math.floor(z / CS)))) continue;
      const y = sueloEn(x, z); if (y <= SEA + 1 && A.agua !== null) continue;
      m.pos.set(x, y, z); m.vida = m.vidaMax = (m.cfg.vida || 30) * (CAMP ? 0.85 + 0.15 * (Z.dificultad || 1) : 1); m.activo = true; m.muriendo = 0; m.ladron = false; m.robado = 0; m.g.visible = true; m.g.scale.setScalar(1);
      m.g.position.copy(m.pos); animar(m.f, "Idle"); return true;
    }
    return false;
  }
  function herirMob(m, n) {
    if (m.muriendo) return;
    m.vida -= n; m.golpe = 0.25; camara.getWorldDirection(dir); m.vel.x += dir.x * 6; m.vel.z += dir.z * 6; m.vel.y = 4; NK.sonido("golpe"); animar(m.f, "Hit", true);
    if (m.vida <= 0) { m.muriendo = m.f.glb ? 1.2 : 0.4; animar(m.f, "Death", true); P.derrotados++; P.derrotadosTotal++; jug.puntos += 25; if (TR.activa) { TR.stats.derrotados++; TR.stats.puntos += 25; TR.logro("derrotar", P.derrotadosTotal); }
      particulas(m.pos.x, m.pos.y + 0.8, m.pos.z, m.cfg.color || "#6f9a5a", 22); if (m.robado) { P.recogidos += m.robado; NK.ui.aviso(`💰 ¡Recuperaste ${m.robado}!`, 2000); m.robado = 0; } NK.gancho("alDerrotar", J, m); }
  }
  function moverMobs(dt, s) {
    const noche = s < -0.05 || (P.contra && P.contra.tipo === "noche"), vista = noche ? 26 : 16, agres = noche ? 1.25 : 1;
    for (const m of mobs) {
      if (!m.activo) continue;
      if (m.muriendo > 0) { m.muriendo -= dt; if (!m.f.glb) m.g.scale.setScalar(Math.max(0.01, m.muriendo * 2.5)); else if (m.muriendo < 0.4) m.g.position.y -= dt * 1.5;
        if (m.muriendo <= 0) { m.activo = false; m.g.visible = false; } continue; }
      m.t += dt; m.cd = Math.max(0, m.cd - dt); m.golpe = Math.max(0, m.golpe - dt);
      const dx = jug.pos.x - m.pos.x, dz = jug.pos.z - m.pos.z, d = Math.hypot(dx, dz);
      if (d > lejos * 1.2) { m.activo = false; m.g.visible = false; continue; }
      const persigue = !m.ladron && (m.cfg.comportamiento !== "patrullar" && d < vista || OBJ.tipo === "sobrevivir" && d < vista * 1.5);
      let tx = Math.sin(m.t * 0.3 + m.tipo), tz = Math.cos(m.t * 0.23);
      if (persigue) { tx = dx / (d || 1); tz = dz / (d || 1); } else if (m.ladron) { tx = -dx / (d || 1); tz = -dz / (d || 1); }
      const vel = (m.cfg.velocidad || 3) * (persigue || m.ladron ? 1 : 0.35) * agres * (TR.activa ? TR.dif.vel : 1) * (m.ladron ? 1.6 : 1);
      if (!(persigue && d < 0.9)) { m.vel.x = NK.lerp(m.vel.x, tx * vel, 1 - Math.exp(-5 * dt)); m.vel.z = NK.lerp(m.vel.z, tz * vel, 1 - Math.exp(-5 * dt)); }
      m.vel.y -= 26 * dt;
      const nx = m.pos.x + m.vel.x * dt, nz = m.pos.z + m.vel.z * dt;
      const pie = Math.floor(m.pos.y);
      const bloqueado = solido(bloque(Math.floor(nx), pie, Math.floor(nz))) || solido(bloque(Math.floor(nx), pie + 1, Math.floor(nz)));
      if (bloqueado) { if (!solido(bloque(Math.floor(nx), pie + 1, Math.floor(nz))) && !solido(bloque(Math.floor(nx), pie + 2, Math.floor(nz))) && m.vel.y <= 0 && solido(bloque(Math.floor(m.pos.x), pie - 1, Math.floor(m.pos.z)))) m.vel.y = 7.5; m.vel.x *= -0.2; m.vel.z *= -0.2; }
      else { m.pos.x = nx; m.pos.z = nz; }
      m.pos.y += m.vel.y * dt;
      const piso = Math.floor(m.pos.y); if (solido(bloque(Math.floor(m.pos.x), piso, Math.floor(m.pos.z)))) { m.pos.y = piso + 1; m.vel.y = 0; }
      if (m.pos.y < -5) { m.activo = false; m.g.visible = false; continue; }
      const rap = Math.hypot(m.vel.x, m.vel.z);
      if (rap > 0.2) m.yaw = Math.atan2(m.vel.x, m.vel.z);
      if (d < 1.1 + m.alto * 0.1 && Math.abs(jug.pos.y - m.pos.y) < 1.6 && m.cd <= 0 && (m.cfg.danio || 0) > 0 && !m.ladron) { m.cd = 1; animar(m.f, "Attack", true); danio(m.cfg.danio, "enemigo"); jug.vel.x += dx / (d || 1) * 5; jug.vel.z += dz / (d || 1) * 5; jug.vel.y = 4; }
      m.g.position.copy(m.pos); m.g.rotation.y = m.yaw;
      if (m.f.glb) { if (!(m.f.tUna > 0)) animar(m.f, rap > 2.5 ? "Run" : rap > 0.4 ? "Walk" : "Idle"); }
      else { const u = m.f.u, sw = Math.sin(m.t * 9) * Math.min(1, rap / 2) * 0.7;
        if (u.pi) { u.pi.rotation.x = sw; u.pd.rotation.x = -sw; u.bi.rotation.x = persigue ? -1.4 : -sw; u.bd.rotation.x = persigue ? -1.4 : sw; }
        if (m.cfg.forma === "slime") m.g.scale.y = 1 + Math.sin(m.t * 7) * 0.12; }
    }
    if (NK.estado === "jugando" && mobs.length) {
      const vivos = mobs.filter(m => m.activo && !m.muriendo).length, base = CAMP ? ((Z.enemigos || []).reduce((a, e) => a + (e.cantidad || 0), 0) || 4) : Math.round((C.enemigos[0] || {}).cantidad || 4);
      const quiere = OBJ.tipo === "derrotar" ? Math.min(mobs.length, Math.max(0, P.total - P.derrotados), 8) : OBJ.tipo === "sobrevivir" ? Math.min(mobs.length, 2 + Math.floor(P.t / 15) + (noche ? 3 : 0)) : OBJ.tipo === "jefe" ? 1 : Math.min(mobs.length, Math.round(base * (noche ? 0.8 : 0.45)));
      if (vivos < quiere && P.t - P.spawn > 2.5) { const ti = CAMP ? refZona() : 0; const m = mobs.find(x => !x.activo && x.tipo === ti) || mobs.find(x => !x.activo); if (m && spawnMob(m)) P.spawn = P.t; }
    }
  }

  /* ───────── Jefe final (fases con habilidades) ───────── */
  function presentarJefe() {
    if (!JEFE_CFG || jefe.presentado) return;
    const x = P.centro.x + 16, z = P.centro.z;
    jefe.pos.set(x, sueloEn(x, z), z); jefe.vida = jefe.vidaMax = (JEFE_CFG.vida || 600) * 0.4 * (TR.activa ? TR.dif.danio : 1);
    Object.assign(jefe, { activo: true, presentado: true, fase: 0, hab: null, tHab: 0, cd: 2.5, muriendo: 0, lanzo: false });
    jefe.f.g.visible = true; jefe.f.g.position.copy(jefe.pos); animar(jefe.f, "Idle");
    NK.sonido("jefe"); NK.ui.jefe(JEFE_CFG.nombre, 1); NK.ui.banner("☠ " + JEFE_CFG.nombre, (JEFE_CFG.fases || []).length > 1 ? `${JEFE_CFG.fases.length} fases` : "¡Derrótalo!", 3000);
    if (!NK.prueba && (JEFE_CFG.dialogo || []).length) { NK.estado = "cine"; setTimeout(async () => { await NK.dialogo(JEFE_CFG.nombre, JEFE_CFG.dialogo.slice(0, 2), "assets/iconos/jefe.png"); if (NK.estado === "cine" || NK.estado === "dialogo") NK.estado = "jugando"; }, 800); }
  }
  function herirJefe(n) {
    if (!jefe.activo || jefe.muriendo) return; jefe.vida -= n; NK.sonido("golpe"); particulas(jefe.pos.x, jefe.pos.y + jefe.alto * 0.6, jefe.pos.z, "#ffffff", 8);
    NK.ui.jefe(JEFE_CFG.nombre, Math.max(0, jefe.vida) / jefe.vidaMax);
    if (jefe.vida <= 0) { jefe.muriendo = 1.6; animar(jefe.f, "Death", true); NK.sonido("ganar"); particulas(jefe.pos.x, jefe.pos.y + 1.5, jefe.pos.z, "#ffd23f", 40); setTimeout(() => { NK.ui.jefe(null); completarZona(); }, 1600); }
  }
  function actualizarJefe(dt) {
    if (!jefe.activo) return;
    jefe.t += dt;
    if (jefe.muriendo > 0) { jefe.muriendo -= dt; if (jefe.muriendo <= 0) { jefe.activo = false; jefe.f.g.visible = false; } return; }
    const fases = JEFE_CFG.fases && JEFE_CFG.fases.length ? JEFE_CFG.fases : [{ umbral: 1, habilidad: "embestida" }];
    const frac = jefe.vida / jefe.vidaMax; let f = 0; fases.forEach((q, i) => { if (frac <= q.umbral + 1e-6) f = i; });
    if (f !== jefe.fase) { jefe.fase = f; NK.ui.banner("⚡ " + JEFE_CFG.nombre, `Fase ${f + 1}: ${fases[f].habilidad}`, 2000); NK.sonido("jefe"); }
    const dx = jug.pos.x - jefe.pos.x, dz = jug.pos.z - jefe.pos.z, d = Math.hypot(dx, dz) || 1, vel = NK.clamp(JEFE_CFG.velocidad || 3.4, 1, 8) * (TR.activa ? TR.dif.vel : 1);
    jefe.yaw = Math.atan2(dx, dz); jefe.cd -= dt;
    if (!jefe.hab && jefe.cd <= 0) { jefe.hab = fases[f].habilidad; jefe.tHab = 0; jefe.lanzo = false; animar(jefe.f, "Attack", true); }
    let vx = 0, vz = 0;
    if (jefe.hab) {
      jefe.tHab += dt; const h = jefe.hab;
      if (h === "embestida") { if (jefe.tHab > 0.6) { vx = dx / d * vel * 3.2; vz = dz / d * vel * 3.2; } if (jefe.tHab > 1.8) terminarHab(); }
      else if (h === "proyectiles") { if (jefe.tHab > 0.5 && !jefe.lanzo) { jefe.lanzo = true; for (let k = -2; k <= 2; k++) { const a = Math.atan2(dz, dx) + k * 0.2; disparar(new THREE.Vector3(jefe.pos.x, jefe.pos.y + jefe.alto * 0.6, jefe.pos.z), new THREE.Vector3(Math.cos(a) * 14, 0.5, Math.sin(a) * 14), true, (JEFE_CFG.danio || 15) * 0.7); } NK.sonido("fuego"); } if (jefe.tHab > 1.2) terminarHab(); }
      else if (h === "invocar") { if (jefe.tHab > 0.6 && !jefe.lanzo) { jefe.lanzo = true; let n = 0; for (const m of mobs) { if (n >= 3) break; if (!m.activo && spawnMob(m, true)) n++; } NK.sonido("magia"); } if (jefe.tHab > 1.3) terminarHab(); }
      else if (h === "onda" || h === "salto") { if (jefe.tHab > 0.8 && !jefe.lanzo) { jefe.lanzo = true; NK.sonido("trueno"); particulas(jefe.pos.x, jefe.pos.y + 0.3, jefe.pos.z, "#c8b890", 30); if (d < 7 && jug.enSuelo) { danio(JEFE_CFG.danio || 15, "jefe"); jug.vel.y = 6; } } if (jefe.tHab > 1.4) terminarHab(); }
      else terminarHab();
    } else if (d > 2.2) { vx = dx / d * vel; vz = dz / d * vel; }
    jefe.pos.x += vx * dt; jefe.pos.z += vz * dt; jefe.pos.y = NK.lerp(jefe.pos.y, sueloEn(jefe.pos.x, jefe.pos.z), 1 - Math.exp(-8 * dt));
    if (!(jefe.f.tUna > 0)) animar(jefe.f, Math.hypot(vx, vz) > 0.5 ? "Run" : "Idle");
    jefe.f.g.position.copy(jefe.pos); jefe.f.g.rotation.y = jefe.yaw;
    if (d < 1.4 + jefe.alto * 0.25 && Math.abs(jug.pos.y - jefe.pos.y) < 2) { danio(JEFE_CFG.danio || 15, "jefe"); jug.vel.x += dx / d * 7; jug.vel.z += dz / d * 7; jug.vel.y = 5; }
  }
  function terminarHab() { jefe.hab = null; jefe.lanzo = false; jefe.cd = NK.clamp(2.6 - jefe.fase * 0.5, 1, 3); }
  function actualizarProyectiles(dt) {
    for (const p of proys) { if (p.vida <= 0) continue; p.vida -= dt; p.m.position.addScaledVector(p.vel, dt); const q = p.m.position;
      if (solido(bloque(Math.floor(q.x), Math.floor(q.y), Math.floor(q.z)))) { p.vida = 0; particulas(q.x, q.y, q.z, "#ffd8a0", 6); }
      else if (p.enemigo) { if (Math.hypot(q.x - jug.pos.x, q.z - jug.pos.z) < 0.7 && q.y > jug.pos.y && q.y < jug.pos.y + ALTO) { danio(p.danio, "jefe"); p.vida = 0; } }
      else { for (const m of mobs) if (m.activo && !m.muriendo && Math.hypot(q.x - m.pos.x, q.z - m.pos.z) < 0.6 + m.alto * 0.15 && q.y > m.pos.y - 0.2 && q.y < m.pos.y + m.alto) { herirMob(m, p.danio); p.vida = 0; break; }
        if (p.vida > 0 && jefe.activo && !jefe.muriendo && Math.hypot(q.x - jefe.pos.x, q.z - jefe.pos.z) < 1 + jefe.alto * 0.2 && q.y < jefe.pos.y + jefe.alto) { herirJefe(p.danio); p.vida = 0; } }
      if (p.vida <= 0) p.m.visible = false; }
    for (const r of rocas) { if (!r.activa) continue; r.vy -= 22 * dt; r.m.position.y += r.vy * dt; r.m.rotation.x += dt * 3;
      const q = r.m.position; if (Math.hypot(q.x - jug.pos.x, q.z - jug.pos.z) < 0.9 && q.y < jug.pos.y + ALTO && q.y > jug.pos.y) { danio(16, "roca"); r.activa = false; r.m.visible = false; }
      if (q.y < sueloEn(q.x, q.z)) { particulas(q.x, q.y + 0.4, q.z, "#9a948a", 10); r.activa = false; r.m.visible = false; } }
  }

  /* ───────── Contratiempos ───────── */
  function iniciarContratiempo(c) {
    P.contra = c; P.contraT = c.tipo === "emboscada" ? 1 : 32; P.contraHecho = true;
    NK.ui.banner("⚠ " + ({ tormenta: "¡Tormenta!", noche: "¡Cae la noche!", emboscada: "¡Emboscada!", ladron: "¡Un ladrón!", derrumbe: "¡Derrumbe!", niebla: "Niebla espesa" }[c.tipo] || "¡Contratiempo!"), c.texto || "", 3200);
    NK.sonido(c.tipo === "tormenta" ? "trueno" : "jefe"); NK.gancho("alContratiempo", J, c);
    if (c.tipo === "noche") P.horaAntes = P.hora, P.hora = 0.8;
    if (c.tipo === "niebla") P.niebla = 3.2;
    if (c.tipo === "tormenta") { lluvia.visible = true; P.niebla = 1.8; }
    if (c.tipo === "emboscada") { let n = 0; for (const m of mobs) { if (n >= 5) break; if (!m.activo && spawnMob(m, true)) n++; } }
    if (c.tipo === "ladron") { const m = mobs.find(x => !x.activo); if (m && spawnMob(m, true)) { m.ladron = true; const k = OBJ.tipo === "recolectar" ? Math.min(3, P.recogidos) : 0; m.robado = k; P.recogidos -= k; if (k) NK.ui.aviso(`💰 Te robó ${k}. ¡Atrápalo!`, 2600); } }
  }
  function actualizarContratiempo(dt) {
    const c = P.contra; if (!c) return; P.contraT -= dt;
    if (c.tipo === "tormenta") { P.relampago -= dt; if (P.relampago <= 0) { P.relampago = 4 + rnd() * 6; NK.ui.flash(140); setTimeout(() => NK.sonido("trueno"), 300 + rnd() * 700); }
      lluvia.position.set(jug.pos.x, jug.pos.y - 4, jug.pos.z); for (let i = 0; i < lluviaN; i++) { lluviaP[i * 3 + 1] -= dt * 22; if (lluviaP[i * 3 + 1] < 0) lluviaP[i * 3 + 1] += 24; } gLl.attributes.position.needsUpdate = true; }
    if (c.tipo === "derrumbe" && rnd() < dt * 1.4) { const r = rocas.find(q => !q.activa); if (r) { r.activa = true; r.vy = 0; r.m.visible = true; r.m.position.set(jug.pos.x + (rnd() - 0.5) * 10 + jug.vel.x * 0.5, jug.pos.y + 14, jug.pos.z + (rnd() - 0.5) * 10 + jug.vel.z * 0.5); } }
    if (P.contraT <= 0 && c.tipo !== "ladron") { if (c.tipo === "noche" && P.horaAntes != null) P.hora = P.horaAntes; P.niebla = 1; lluvia.visible = false; P.contra = null; NK.ui.aviso("🌤 El contratiempo pasó", 1800); }
  }

  /* ───────── Zonas y objetivos ───────── */
  function centroZona(i) { return CENTROS[i] || { x: 0.5, z: 0.5 }; }
  function colocarObjetos() {
    const c = P.centro;
    objetos.forEach(o => { o.activo = false;
      const n0 = objetos.filter(x => x.tipo === o.tipo).indexOf(o), quiere = CAMP ? (o.tipo === 0 ? (OBJ.tipo === "recolectar" ? (OBJ.cantidad || 5) + 3 : 3) : 2) : 999;
      if (n0 >= quiere) return;
      for (let k = 0; k < 20; k++) { const a = rnd() * Math.PI * 2, d = 8 + Math.sqrt(rnd()) * (CAMP ? 34 : 52), x = Math.floor(c.x + Math.cos(a) * d) + 0.5, z = Math.floor(c.z + Math.sin(a) * d) + 0.5;
        const h = alturaCol(Math.floor(x), Math.floor(z)); if (h <= SEA && A.agua !== null && k < 19) continue; o.pos.set(x, Math.max(h, SEA) + 1.6 + 3, z); o.activo = true; o.sinSuelo = true; break; } });
  }
  function colocarMeta() {
    const c = P.centro, a = CAMP ? 0 : rnd() * Math.PI * 2, d = CAMP ? 46 : 55 + rnd() * 20, x = Math.floor(c.x + Math.cos(a) * d), z = Math.floor(c.z + Math.sin(a) * d), h = Math.max(alturaCol(x, z), SEA + 1);
    for (let y = 1; y <= 4; y++) ediciones.set(x + "," + (h + y) + "," + z, B.ORO);
    ediciones.set(x + "," + (h + 5) + "," + z, B.LUZ);
    for (const [k, b] of ediciones) { const [ex, ey, ez] = k.split(",").map(Number); const ch = chunks.get(clave(Math.floor(ex / CS), Math.floor(ez / CS))); if (ch) ponerBloque(ex, ey, ez, b); }
    meta = { x: x + 0.5, y: h + 1, z: z + 0.5 }; haz.position.set(meta.x, meta.y + 30, meta.z); haz.visible = true;
  }
  function fogata(c) { const x = Math.floor(c.x + 3), z = Math.floor(c.z - 2), h = alturaCol(x, z); ponerBloque(x, h + 1, z, B.LUZ); ediciones.set(x + "," + (h + 1) + "," + z, B.LUZ); }
  function prepararZona(i) {
    zi = i; Z = ZONAS[i]; OBJ = Z.objetivo || C.objetivo; P.centro = centroZona(i);
    Object.assign(P, { recogidos: 0, derrotados: 0, total: OBJ.cantidad || 1, tiempoRestante: OBJ.tipo === "sobrevivir" ? (OBJ.cantidad || OBJ.tiempo || 60) : (OBJ.tiempo || 0), spawn: 0, completa: false,
      contra: null, contraT: 0, contraHecho: false, niebla: 1, colocados0: jug.colocados });
    lluvia.visible = false; if (CAMP) P.hora = HORA_Z[Z.hora] != null ? HORA_Z[Z.hora] : P.hora;
    for (let dz = -2; dz <= 2; dz++) for (let dx = -2; dx <= 2; dx++) { const cx = Math.floor(P.centro.x / CS) + dx, cz = Math.floor(P.centro.z / CS) + dz; const ch = datos(cx, cz); listoParaMallar(cx, cz); if (ch.sucio || !ch.malla) mallar(ch); }
    jug.pos.set(P.centro.x, sueloEn(P.centro.x, P.centro.z) + 0.05, P.centro.z); jug.vel.set(0, 0, 0); jug.yaw = CAMP ? -Math.PI / 2 : 0;
    mobs.forEach(m => { m.activo = false; m.g.visible = false; }); proys.forEach(p => { p.vida = 0; p.m.visible = false; });
    colocarObjetos();
    haz.visible = false; meta = null; if (OBJ.tipo === "llegar" || OBJ.tipo === "carrera") colocarMeta();
    if (OBJ.tipo === "recolectar") P.total = Math.min(OBJ.cantidad || 1, objetos.filter(o => o.tipo === 0 && o.activo).length || OBJ.cantidad || 1);
    potes.forEach(p => { p.activo = false; p.m.visible = false; });
    (Z.potenciadores || []).slice(0, potes.length).forEach((t, k) => { const p = potes[k], a = k * 2.1 + 0.6, x = P.centro.x + Math.cos(a) * 12, z = P.centro.z + Math.sin(a) * 12;
      p.tipo = t; p.activo = true; p.pos.set(x, sueloEn(x, z) + 1, z); p.m.material.color.setHex(POT_COL[t] || 0xffffff); p.m.visible = true; });
    Object.values(guias).forEach(f => { f.g.visible = false; });
    const gz = CAMP ? guia(Z) : null; if (gz) { const x = P.centro.x + 2.5, z = P.centro.z + 2.5; gz.g.position.set(x, sueloEn(x, z), z); gz.g.rotation.y = -Math.PI * 0.75; gz.g.visible = true; gz.hablado = false; gz.marca.visible = true; }
    if (CAMP) fogata(P.centro);
    if (jefe.f) { jefe.activo = false; jefe.presentado = false; jefe.f.g.visible = false; NK.ui.jefe && NK.ui.jefe(null); }
    NK.ui.datos({ sinTiempo: !(P.tiempoRestante > 0) });
  }
  function cercaGuia() { const gz = CAMP && Z.npc ? guias[Z.npc.modelo || "npc"] : null; return gz && gz.g.visible && gz.g.position.distanceTo(jug.pos) < 3.2 ? gz : null; }
  async function hablar(gz) { gz.hablado = true; gz.marca.visible = false; NK.sonido("dialogo"); if (document.pointerLockElement) document.exitPointerLock();
    await NK.dialogo(Z.npc.nombre, Z.npc.dialogo || ["¡Suerte!"], `assets/iconos/npc_${Z.npc.modelo || "npc"}.png`); }
  function completarZona() {
    if (P.completa) return; P.completa = true; jug.puntos += 100;
    if (TR.activa) { TR.stats.puntos += 100; if (OBJ.tipo === "recolectar" && !objetos.some(o => o.activo && o.tipo === 0)) TR.logro("recoger_todo", 1); NK.sonido("ganar"); setTimeout(() => { if (NK.estado !== "fin") TR.zonaCompleta(); }, NK.prueba ? 50 : 900); }
    else NK.terminar(true, `¡Objetivo cumplido! Puntos: ${jug.puntos}`);
  }
  function progresoZona() {
    switch (OBJ.tipo) { case "recolectar": return P.recogidos / Math.max(1, P.total); case "derrotar": return P.derrotados / Math.max(1, P.total); case "construir": return (jug.colocados - P.colocados0) / Math.max(1, P.total);
      case "sobrevivir": return 1 - P.tiempoRestante / Math.max(1, OBJ.cantidad || OBJ.tiempo || 60); case "jefe": return jefe.presentado ? 1 - jefe.vida / jefe.vidaMax : 0;
      default: return meta ? NK.clamp(1 - Math.hypot(meta.x - jug.pos.x, meta.z - jug.pos.z) / 46, 0, 1) : 0; }
  }
  function objetivos(dt) {
    let prog = "";
    if (!P.completa) switch (OBJ.tipo) {
      case "recolectar": prog = `${(C.objetos[0] || {}).nombre || "Objetos"}: ${P.recogidos}/${P.total}`; if (P.recogidos >= P.total) completarZona(); break;
      case "derrotar": prog = `Derrotados: ${P.derrotados}/${P.total}`; if (P.derrotados >= P.total) completarZona(); break;
      case "sobrevivir": P.tiempoRestante -= dt; prog = `Resiste: ${Math.max(0, Math.ceil(P.tiempoRestante))} s`; if (P.tiempoRestante <= 0) completarZona(); break;
      case "construir": prog = `Bloques colocados: ${jug.colocados - P.colocados0}/${P.total}`; if (jug.colocados - P.colocados0 >= P.total) completarZona(); break;
      case "jefe": prog = jefe.presentado ? `${JEFE_CFG.nombre}: ${Math.max(0, Math.round(100 * jefe.vida / jefe.vidaMax))} %` : "Busca al jefe"; if (!JEFE_CFG) completarZona(); else if (!jefe.presentado && (P.t > 2 || NK.prueba)) presentarJefe(); break;
      case "llegar": case "carrera": { const d = meta ? Math.hypot(meta.x - jug.pos.x, meta.z - jug.pos.z) : 0; prog = `Faro dorado a ${Math.round(d)} m`; if (meta && d < 2.2) completarZona(); break; }
      default: prog = `Puntos: ${jug.puntos}`;
    }
    if (OBJ.tiempo > 0 && OBJ.tipo !== "sobrevivir" && !P.completa) { P.tiempoRestante -= dt; if (P.tiempoRestante <= 0) { if (TR.activa) { P.tiempoRestante = OBJ.tiempo; TR.morir("¡Se acabó el tiempo!"); } else NK.terminar(false, "¡Se acabó el tiempo!"); } }
    if (CAMP && Z.contratiempo && !P.contraHecho && !P.completa && progresoZona() >= (Z.contratiempo.momento || 0.5)) iniciarContratiempo(Z.contratiempo);
    NK.ui.datos({ vida: jug.vida, vidaMax: jug.vidaMax, puntos: TR.activa ? TR.stats.puntos : jug.puntos, objetivo: OBJ.texto, progreso: prog, tiempo: OBJ.tiempo > 0 || OBJ.tipo === "sobrevivir" ? P.tiempoRestante : undefined });
    const ef = Object.keys(jug.efectos).filter(k => jug.efectos[k] > 0); NK.ui.efectos && NK.ui.efectos(ef.map(k => ({ escudo: "🛡", turbo: "⚡", iman: "🧲", furia: "🔥" }[k] + " " + Math.ceil(jug.efectos[k]))));
  }
  function actualizarObjetos(t, dt) {
    const iman = jug.efectos.iman > 0 || (TR.mejoras && TR.mejoras.has("iman_permanente"));
    for (const o of objetos) {
      if (o.activo) {
        if (o.sinSuelo && chunks.has(clave(Math.floor(o.pos.x / CS), Math.floor(o.pos.z / CS)))) { o.pos.y = sueloEn(o.pos.x, o.pos.z) + 0.8; o.sinSuelo = false; }
        const dd = Math.hypot(o.pos.x - jug.pos.x, o.pos.z - jug.pos.z);
        if (iman && dd < (jug.efectos.iman > 0 ? 9 : 4) && !o.sinSuelo) { o.pos.x = NK.lerp(o.pos.x, jug.pos.x, 1 - Math.exp(-5 * dt)); o.pos.z = NK.lerp(o.pos.z, jug.pos.z, 1 - Math.exp(-5 * dt)); }
        if (NK.estado === "jugando" && dd < 1.2 && Math.abs(o.pos.y - jug.pos.y - 0.8) < 1.8 && NK.gancho("alRecoger", J, o) !== false) {
          o.activo = false; particulas(o.pos.x, o.pos.y, o.pos.z, o.cfg.color || "#39e6ff", 16); jug.puntos += o.cfg.valor || 10; if (TR.activa) { TR.stats.recogidos++; TR.stats.puntos += o.cfg.valor || 10; }
          if (o.tipo === 0) P.recogidos++;
          if (o.cfg.efecto === "vida") { jug.vida = Math.min(jug.vidaMax, jug.vida + 25); NK.sonido("vida"); } else NK.sonido("moneda");
        }
      }
      tmpQ.setFromAxisAngle(EJE_Y, t * 1.8 + o.fase); tmpM.compose(tmpV.set(o.pos.x, o.pos.y + Math.sin(t * 2 + o.fase) * 0.15, o.pos.z), tmpQ, tmpS.setScalar(o.activo ? 1 : 0.0001)); o.im.setMatrixAt(o.i, tmpM);
    }
    conjObj.forEach(im => im && (im.instanceMatrix.needsUpdate = true));
    for (const p of potes) { if (!p.activo) continue; p.m.position.set(p.pos.x, p.pos.y + Math.sin(t * 2 + p.fase) * 0.2, p.pos.z); p.m.rotation.y = t * 2;
      if (NK.estado === "jugando" && p.pos.distanceTo(jug.pos) < 1.6) { p.activo = false; p.m.visible = false; NK.sonido("potenciador"); particulas(p.pos.x, p.pos.y, p.pos.z, "#8aff45", 14);
        if (p.tipo === "curacion") jug.vida = Math.min(jug.vidaMax, jug.vida + 35); else if (p.tipo === "vida_extra") { if (TR.activa) { TR.vidas++; NK.ui.vidas(TR.vidas); } } else jug.efectos[p.tipo] = p.tipo === "escudo" ? 8 : 10;
        NK.ui.aviso({ curacion: "❤ +35 de vida", vida_extra: "💚 ¡Vida extra!", escudo: "🛡 Escudo", turbo: "⚡ Turbo", iman: "🧲 Imán", furia: "🔥 Furia: daño doble" }[p.tipo] || "✨", 1800); } }
    for (let i = 0; i < NP; i++) { const q = parts[i]; if (q.vida <= 0) continue; q.vida -= dt; q.v.y -= 12 * dt; pPos[i * 3] += q.v.x * dt; pPos[i * 3 + 1] += q.v.y * dt; pPos[i * 3 + 2] += q.v.z * dt; if (q.vida <= 0) pPos[i * 3 + 1] = -999; }
    gP.attributes.position.needsUpdate = true; gP.attributes.color.needsUpdate = true;
  }

  /* ───────── API para juego.js ───────── */
  const J = window.J = { C, THREE, escena, camara, renderer, jugador: jug, enemigos: mobs, objetos, partida: P, B, bloque, ponerBloque, alturaEn: (x, z) => sueloEn(x, z),
    aviso: (t, ms) => NK.ui.aviso(t, ms), sonido: t => NK.sonido(t), sumarPuntos: n => { jug.puntos += n; if (TR.activa) TR.stats.puntos += n; }, danio, curar: n => { jug.vida = Math.min(jug.vidaMax, jug.vida + n); },
    ganar: t => NK.terminar(true, t), perder: t => NK.terminar(false, t), herirEnemigo: (m, n) => (m === jefe ? herirJefe(n) : herirMob(m, n)), particulas, jefe: () => (jefe.activo ? jefe : null), meta: () => meta,
    zonaIndice: () => zi, completarZona, contratiempo: tipo => iniciarContratiempo({ tipo, texto: "", momento: 0 }),
    construir: (x, y, z, plano) => plano.forEach((fila, dy) => fila.forEach((b, i) => b && ponerBloque(x + (i % 16), y + dy, z + Math.floor(i / 16), b))) };

  /* ───────── Cámara y bucle ───────── */
  function actualizarCamara(dt) {
    const r = NK.tomarRaton(); const sens = 0.0024;
    if (NK.raton.bloqueado || r.dx || r.dy) { jug.yaw -= r.dx * sens; jug.pitch = NK.clamp(jug.pitch - r.dy * sens, -1.5, 1.5); }
    if (TERCERA) {
      // la cámara no atraviesa los bloques: se acerca si hay una pared o una loma entre ella y el personaje
      let d = 4.2; const hx = jug.pos.x, hy = jug.pos.y + 1.5, hz = jug.pos.z;
      const ux = Math.sin(jug.yaw) * Math.cos(jug.pitch), uy = -Math.sin(jug.pitch), uz = Math.cos(jug.yaw) * Math.cos(jug.pitch);
      for (let t = 0.3; t <= 4.2; t += 0.15) { if (solido(bloque(Math.floor(hx + ux * t), Math.floor(hy + uy * t + 0.3), Math.floor(hz + uz * t)))) { d = Math.max(0.6, t - 0.35); break; } }
      jug.dCam = NK.lerp(jug.dCam || d, d, d < (jug.dCam || d) ? 1 : 1 - Math.exp(-4 * (dt || 0.016)));
      const cx = hx + ux * jug.dCam, cz = hz + uz * jug.dCam, cy = hy + uy * jug.dCam + 0.3;
      camara.position.set(cx, cy, cz); camara.lookAt(jug.pos.x, jug.pos.y + 1.4, jug.pos.z);
      PJF.g.visible = jug.dCam > 1.0;
      const g = PJF.g; g.position.copy(jug.pos); g.rotation.y = jug.yaw + Math.PI;
      const rap = Math.hypot(jug.vel.x, jug.vel.z);
      if (PJF.glb) { if (NK.estado === "jugando" && !(PJF.tUna > 0)) animar(PJF, !jug.enSuelo && !jug.enAgua ? "Jump" : rap > 5 ? "Run" : rap > 0.6 ? "Walk" : "Idle"); }
      else { const u = PJF.u, sw = Math.sin(P.t * 10) * Math.min(1, rap / 4) * 0.7; if (u.pi) { u.pi.rotation.x = sw; u.pd.rotation.x = -sw; u.bi.rotation.x = -sw; u.bd.rotation.x = jug.golpe > 0 ? -1.6 : sw; } }
    } else {
      camara.position.set(jug.pos.x, jug.pos.y + OJOS, jug.pos.z);
      camara.rotation.order = "YXZ"; camara.rotation.set(jug.pitch, jug.yaw, 0);
    }
  }
  function bajarCalidad(fps) {
    const pr = renderer.getPixelRatio();
    if (pr > 0.62) { renderer.setPixelRatio(Math.max(0.6, pr - 0.15)); renderer.setSize(innerWidth, innerHeight); console.info("Noviq: FPS bajos (" + fps + "), resolución " + renderer.getPixelRatio().toFixed(2)); }
  }
  const adaptador = {
    async preparar(traje, arma) {
      const rol = traje && traje.modelo ? traje.modelo : "jugador";
      Object.values(figurasJ).forEach(f => { f.g.visible = false; });
      PJF = figuraJugador(NK.tieneModelo(rol) ? rol : "jugador"); await PJF.listo; PJF.g.visible = TERCERA;
      jug.mult = { vida: (traje && traje.vida) || 1, vel: (traje && traje.velocidad) || 1, salto: (traje && traje.salto) || 1, danio: 1, cad: 1, alc: 1 };
      jug.vidaMax = Math.round(C.jugador.vida * jug.mult.vida); jug.vida = jug.vidaMax; jug.puntos = 0; P.derrotadosTotal = 0; jug.efectos = {};
      equipar(arma || ARMAS[0] || null); prepararZona(0);
    },
    cine() {},
    async zona(i) {
      if (i > 0) NK.ui.banner("🧭 Viajando…", ZONAS[i].nombre, 1500);
      prepararZona(i); jug.vida = jug.vida <= 0 ? jug.vidaMax : Math.max(jug.vida, Math.round(jug.vidaMax * 0.6)); jug.invul = 2;
      if (i > 0) { const d = TR.armasDisponibles(); if (armaAct && !d.includes(armaAct)) equipar(d[0]); else if (NK.ui.arma) NK.ui.arma(armaAct, d.length); }
    },
    respawn() { jug.pos.set(P.centro.x, sueloEn(P.centro.x, P.centro.z) + 0.05, P.centro.z); jug.vel.set(0, 0, 0); jug.vida = jug.vidaMax; jug.invul = 2; animar(PJF, "Idle");
      if (jefe.activo && jefe.presentado) { jefe.vida = Math.min(jefe.vidaMax, jefe.vida + jefe.vidaMax * 0.15); NK.ui.jefe(JEFE_CFG.nombre, jefe.vida / jefe.vidaMax); jefe.pos.set(P.centro.x + 16, jefe.pos.y, P.centro.z); }
      mobs.forEach(m => { if (m.activo && m.pos.distanceTo(jug.pos) < 8) { m.activo = false; m.g.visible = false; } }); NK.estado = "jugando"; },
    mejora(id) { const m = jug.mult; if (id === "danio_extra") m.danio *= 1.25; else if (id === "vida_max") { jug.vidaMax += 25; jug.vida += 25; } else if (id === "velocidad") m.vel *= 1.12; else if (id === "cadencia") m.cad *= 0.8; else if (id === "alcance") m.alc *= 1.3; }
  };
  function reiniciar() {
    jug.vida = jug.vidaMax; jug.puntos = 0; jug.colocados = 0; jug.rotos = 0; jug.invul = 1.5; jug.vel.set(0, 0, 0); jug.yaw = 0; jug.pitch = -0.1; jug.efectos = {};
    P.t = 0; P.derrotadosTotal = 0;
    prepararZona(0); pintarBarra(); NK.ui.mira(!TERCERA);
    NK.gancho("alIniciar", J);
  }
  let ultimo = performance.now(), frame = 0;
  function bucle(ahora) {
    requestAnimationFrame(bucle);
    const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora; frame++;
    if (document.hidden) return;
    const jugando = NK.estado === "jugando";
    if (!jugando && frame % 2 && NK.estado !== "caida") return;
    jug.invul = Math.max(0, jug.invul - dt); jug.golpe = Math.max(0, jug.golpe - dt);
    for (const k in jug.efectos) jug.efectos[k] = Math.max(0, jug.efectos[k] - dt);
    const s = cicloDia(jugando ? dt : dt * 0.2);
    if (jugando) {
      P.t += dt; if (TR.activa) { TR.stats.t += dt; TR.stats.tZona += dt; }
      if (TR.mejoras && TR.mejoras.has("regeneracion")) jug.vida = Math.min(jug.vidaMax, jug.vida + dt * 1.2);
      moverJugador(dt); interactuar(); moverMobs(dt, s); actualizarJefe(dt); actualizarProyectiles(dt); actualizarContratiempo(dt);
      const gz = cercaGuia(); if (gz) { if (!gz.hablado) NK.ui.aviso(`💬 E: hablar con ${Z.npc.nombre}`, 400); if (NK.pulso("KeyE")) hablar(gz); }
      NK.gancho("alActualizar", J, dt);
      if (NK.estado === "jugando") objetivos(dt);
      NK.medirFPS(dt, bajarCalidad);
    } else if (NK.estado === "menu") jug.yaw += dt * 0.08;
    for (const f of animadas) { if (f.g.visible && f.mixer) { f.mixer.update(dt); if (f.tUna > 0) { f.tUna -= dt; if (f.tUna <= 0) f.tUna = 0; } } }
    actualizarChunks(jug.pos.x, jug.pos.z);
    actualizarObjetos(ahora / 1000, dt);
    actualizarCamara(dt);
    cielo.position.copy(camara.position); agua.position.x = camara.position.x; agua.position.z = camara.position.z;
    datosNubes.forEach((n, i) => { n.x += dt * 1.2; if (n.x - camara.position.x > lejos * 1.2) n.x -= lejos * 2.4; tmpM.compose(tmpV.set(n.x, CH + 12, n.z), tmpQ.identity(), tmpS.set(n.w, 2, n.d)); nubes.setMatrixAt(i, tmpM); });
    nubes.instanceMatrix.needsUpdate = true;
    if (meta) haz.material.opacity = 0.25 + Math.sin(ahora / 300) * 0.1;
    renderer.render(escena, camara);
    NK.finFrame();
  }
  addEventListener("resize", () => { camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  NK._estado = () => ({ estado: NK.estado, puntos: TR.activa ? TR.stats.puntos : jug.puntos, vida: Math.round(jug.vida), completa: P.completa,
    objetivo: { tipo: OBJ.tipo, hecho: OBJ.tipo === "recolectar" ? P.recogidos : OBJ.tipo === "derrotar" ? P.derrotados : OBJ.tipo === "construir" ? jug.colocados - P.colocados0 : Math.round(P.t), total: P.total },
    tiempo: Math.round(P.t * 10) / 10, hora: +P.hora.toFixed(2), fps: NK.fps.valor, jugador: { x: +jug.pos.x.toFixed(2), y: +jug.pos.y.toFixed(2), z: +jug.pos.z.toFixed(2) }, enemigosActivos: mobs.filter(m => m.activo).length,
    objetosRestantes: objetos.filter(o => o.activo).length, chunks: chunks.size, mallas: [...chunks.values()].filter(c => c.malla).length, dibujos: renderer.info.render.calls, geometrias: renderer.info.memory.geometries,
    texturas: renderer.info.memory.textures, motor: "voxel", calidad: Q.nivel, figuras: [...animadas].length, jugadorGLB: PJF.glb, jefe: JEFE_CFG ? { activo: jefe.activo, vida: Math.round(jefe.vida), presentado: jefe.presentado } : null,
    contratiempo: P.contra ? P.contra.tipo : null });
  // arranque: se espera a las figuras (con límite) y se muestra el menú
  const esperar = p => Promise.race([p, new Promise(ok => setTimeout(ok, 8000))]);
  Promise.all([PJF.listo, ...mobs.slice(0, 3).map(m => m.f.listo), ...(jefe.f ? [jefe.f.listo] : [])].map(esperar)).then(() => {
    NK.iniciar(() => { jug.invul = 1; }, reiniciar, CAMP ? adaptador : null);
    if (!CAMP) equipar(null);
    reiniciar();
    requestAnimationFrame(bucle);
  });
})();
