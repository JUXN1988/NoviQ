/* Noviq Game Kit — motor3d.js v2: mundo 3D REALISTA con TRAVESÍA por zonas (Three.js r128).
   Lee el diseño de juego.config.js (window.JUEGO, con JUEGO.campana del 🎬 director creativo), los modelos de
   assets/activos.js (tuyos, descargados o creados por Noviq, con animaciones) y las reglas propias de juego.js.

   Lo que trae: valle con un camino que cruza todas las zonas (cada una con su bioma, hora, clima, enemigos, obstáculos,
   contratiempo, guía con diálogos, mirador con vista panorámica, punto de control y puerta), cielo con sol, nubes y
   estrellas, luz ambiental del cielo (PBR), hierba con viento, agua con reflejos, niebla por zona, selección de trajes y
   armas (cuerpo a cuerpo, disparo y magia), vidas, potenciadores, mejoras entre zonas, logros y jefe final con fases.

   RENDIMIENTO (probado para no colgar la PC): todo lo pesado se crea UNA vez al iniciar; lo repetido (árboles, hierba,
   monedas) usa InstancedMesh; enemigos, balas, rocas y partículas vienen de «pools» reutilizables. Si van pocos FPS se
   baja la resolución y luego las sombras. En tarjetas NVIDIA RTX se usa la calidad «ultra» (sombras 4K, hierba densa). */
(function () {
  "use strict";
  const C = NK.cfg, Q = NK.calidad(), A = C.ambiente, G = C.genero, CAMP = NK.campana, TR = NK.travesia;
  const lin = h => new THREE.Color(h).convertSRGBToLinear();
  const V3 = THREE.Vector3, tmpV = new V3(), tmpV2 = new V3(), tmpV3 = new V3(), tmpM = new THREE.Matrix4(), tmpQ = new THREE.Quaternion(), tmpS = new V3(), tmpE = new THREE.Euler();
  const tmpC = new THREE.Color(), tmpC2 = new THREE.Color();
  const smooth = (a, b, x) => { const t = NK.clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
  document.title = C.titulo;
  const ALTO = Q.nivel === "alto" || Q.nivel === "ultra", ULTRA = Q.nivel === "ultra";
  const cv = document.getElementById("lienzo");
  const renderer = new THREE.WebGLRenderer({ canvas: cv, antialias: !!Q.antialias, powerPreference: "high-performance" });
  renderer.setPixelRatio(Q.pixelRatio); renderer.setSize(innerWidth, innerHeight);
  renderer.outputEncoding = THREE.sRGBEncoding; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.enabled = !!Q.sombras; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  const ANISO = Math.min(ULTRA ? 16 : 8, renderer.capabilities.getMaxAnisotropy());
  NK.infoRender = () => `${renderer.info.render.calls} dibujos · ${(renderer.info.render.triangles / 1000).toFixed(0)}k triángulos · ${renderer.info.memory.geometries} geometrías · ${renderer.info.memory.textures} texturas · ${renderer.getPixelRatio().toFixed(2)}x`;
  const escena = new THREE.Scene();
  const rnd = NK.rand((C.mundo.semilla | 0) + 99), ruido = NK.ruido(C.mundo.semilla | 0);

  /* ───────── Zonas de la travesía (sin campaña: una sola zona con el objetivo clásico) ───────── */
  const ZONAS = CAMP ? CAMP.zonas : [{ nombre: C.titulo, tema: C.tema, hora: A.hora, clima: A.clima, objetivo: Object.assign({}, C.objetivo),
    enemigos: (C.enemigos || []).map((e, i) => ({ ref: i, cantidad: e.cantidad })), obstaculos: [], mirador: false, dificultad: 1 }];
  const NZ = ZONAS.length;
  ZONAS.forEach(z => { z.paleta = z.paleta || { cielo: A.cielo, horizonte: A.horizonte, suelo: A.suelo, agua: A.agua, niebla: A.niebla }; });
  const PLATAF = G === "plataformas", CARRERA = G === "carreras" || (C.objetivo || {}).tipo === "carrera" || ZONAS.some(z => z.objetivo.tipo === "carrera");
  const S = NZ > 1 && !CARRERA ? NK.clamp(120 + 58 * NZ, 170, 440) : C.mundo.tamano, MITAD = S / 2, R = C.mundo.relieve;
  const lejos = Q.distancia * (NZ > 1 ? 1.25 : 1);

  /* ───────── Cámara, niebla y cielo (atmósfera con sol, nubes y estrellas) ───────── */
  const camara = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.1, lejos * 1.6);
  escena.fog = new THREE.FogExp2(0xcfe0f0, 0.01);
  const cieloU = { arriba: { value: new THREE.Color() }, horizonte: { value: new THREE.Color() }, solDir: { value: new V3(0.4, 0.6, 0.3).normalize() },
    solColor: { value: new THREE.Color(1, 0.95, 0.85) }, nubes: { value: 0.5 }, noche: { value: 0 }, tiempo: { value: 0 }, bruma: { value: new THREE.Color() } };
  const CIELO_VS = "varying vec3 vDir; void main(){ vDir = normalize(position); vec4 p = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix * p; gl_Position.z = gl_Position.w; }";
  const CIELO_FS = `uniform vec3 arriba; uniform vec3 horizonte; uniform vec3 solDir; uniform vec3 solColor; uniform vec3 bruma; uniform float nubes; uniform float noche; uniform float tiempo; varying vec3 vDir;
    float h(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
    float n(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.0-2.0*f); return mix(mix(h(i), h(i+vec2(1,0)), f.x), mix(h(i+vec2(0,1)), h(i+vec2(1,1)), f.x), f.y); }
    float fbm(vec2 p){ float s = 0.0, a = 0.5; for (int i = 0; i < 5; i++){ s += a*n(p); p *= 2.03; a *= 0.5; } return s; }
    void main(){ vec3 d = normalize(vDir); float y = d.y;
      float t = clamp(y*1.25 + 0.06, 0.0, 1.0); vec3 col = mix(horizonte, arriba, pow(t, 0.55));
      col = mix(col, bruma, (1.0 - smoothstep(-0.02, 0.18, y)) * 0.85);
      float sd = max(dot(d, normalize(solDir)), 0.0);
      col += solColor * (pow(sd, 700.0) * 18.0 * (1.0 - noche*0.6) + pow(sd, 8.0) * 0.28 + pow(sd, 2.0) * 0.08) * smoothstep(-0.08, 0.02, y);
      if (y > 0.0) { vec2 uv = d.xz / (y + 0.18) * 1.6 + vec2(tiempo*0.012, tiempo*0.004);
        float c = smoothstep(0.52 - nubes*0.28, 0.95, fbm(uv)); float borde = smoothstep(0.0, 0.25, y);
        vec3 nubeCol = mix(vec3(1.0), solColor, 0.25) * mix(0.95, 0.35, noche) + pow(sd, 6.0)*0.4*solColor;
        col = mix(col, nubeCol * mix(0.78, 1.0, fbm(uv*1.7+3.0)), c * borde * 0.9);
        float e = step(0.9965, h(floor(d.xz / (y+0.02) * 220.0))) * noche * smoothstep(0.05, 0.4, y); col += vec3(e); }
      gl_FragColor = vec4(col, 1.0);
      #include <tonemapping_fragment>
      #include <encodings_fragment>
    }`;
  const matCielo = new THREE.ShaderMaterial({ uniforms: cieloU, vertexShader: CIELO_VS, fragmentShader: CIELO_FS, side: THREE.BackSide, depthWrite: false, fog: false });
  const cielo = new THREE.Mesh(new THREE.SphereGeometry(lejos * 1.4, 32, 16), matCielo); cielo.frustumCulled = false; cielo.renderOrder = -1; escena.add(cielo);
  // IBL: la luz del cielo ilumina los materiales PBR (reflejos realistas). Un mapa por ambiente (en caché, máx. 6).
  const pmrem = new THREE.PMREMGenerator(renderer), envCache = {}, envOrden = [];
  function ambienteIBL(clave) {
    if (!envCache[clave]) {
      const c = document.createElement("canvas"); c.width = 256; c.height = 128; const x = c.getContext("2d");
      const hx = col => "#" + col.getHexString(), suelo = tmpC2.set((ZONAS[P.zi || 0].paleta.suelo || A.suelo)[0]).multiplyScalar(0.55);
      const g = x.createLinearGradient(0, 0, 0, 128); g.addColorStop(0, hx(amb.arriba)); g.addColorStop(0.47, hx(amb.horizonte)); g.addColorStop(0.53, hx(suelo)); g.addColorStop(1, hx(suelo.multiplyScalar(0.6)));
      x.fillStyle = g; x.fillRect(0, 0, 256, 128);
      const sy = 64 - Math.asin(NK.clamp(amb.alt / Math.hypot(0.45, amb.alt, 0.35), -1, 1)) / Math.PI * 128, rg = x.createRadialGradient(80, sy, 0, 80, sy, 26);
      rg.addColorStop(0, "rgba(255,250,235," + (1 - amb.noche * 0.8) + ")"); rg.addColorStop(1, "rgba(255,240,210,0)"); x.fillStyle = rg; x.fillRect(0, 0, 256, 128);
      const t = new THREE.CanvasTexture(c); t.encoding = THREE.sRGBEncoding; t.mapping = THREE.EquirectangularReflectionMapping;
      envCache[clave] = pmrem.fromEquirectangular(t); t.dispose(); envOrden.push(clave);
      while (envOrden.length > 6) { const vieja = envOrden.shift(); if (envCache[vieja]) { envCache[vieja].dispose(); delete envCache[vieja]; } }  // sin fugas
    }
    escena.environment = envCache[clave].texture;
  }

  /* ───────── Luces ───────── */
  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x445533, 0.6); escena.add(hemi);
  const sol = new THREE.DirectionalLight(0xfff2dd, 1.2); sol.castShadow = !!Q.sombras; sol.shadow.mapSize.set(Q.sombraTam, Q.sombraTam);
  const SC = ULTRA ? 60 : 46, sc = sol.shadow.camera; sc.left = -SC; sc.right = SC; sc.top = SC; sc.bottom = -SC; sc.near = 1; sc.far = 260; sol.shadow.bias = -0.0005; sol.shadow.normalBias = 0.035;
  escena.add(sol); escena.add(sol.target);
  const linterna = new THREE.SpotLight(0xfff1d0, 0, 42, 0.5, 0.45, 1.2); escena.add(linterna); escena.add(linterna.target);
  const luzFogata = new THREE.PointLight(0xff9a4a, 0, 16, 1.6); escena.add(luzFogata);

  /* ───────── Ambiente dinámico (cada zona y cada contratiempo cambia el cielo, la luz y la niebla) ───────── */
  const HORA = { dia: { sol: 1.6, hemi: 0.34, exp: 0.95, alt: 0.85, color: "#fff4e0", noche: 0 }, atardecer: { sol: 1.25, hemi: 0.3, exp: 1.0, alt: 0.2, color: "#ffb070", noche: 0.1 },
    noche: { sol: 0.3, hemi: 0.22, exp: 1.1, alt: 0.55, color: "#9fb4ff", noche: 1 } };
  const amb = { arriba: new THREE.Color(), horizonte: new THREE.Color(), solColor: new THREE.Color(), sol: 1, hemi: 0.5, exp: 1, niebla: 0.01, noche: 0, alt: 0.8, nubes: 0.45, lluvia: 0, nieve: 0 };
  const obj = { arriba: new THREE.Color(), horizonte: new THREE.Color(), solColor: new THREE.Color(), sol: 1, hemi: 0.5, exp: 1, niebla: 0.01, noche: 0, alt: 0.8, nubes: 0.45, lluvia: 0, nieve: 0 };
  const evento = { niebla: 1, noche: false, tormenta: false };
  function objetivoAmbiente(z, inmediato) {
    const p = z.paleta, hr = HORA[evento.noche ? "noche" : z.hora] || HORA.dia;
    obj.arriba.set(p.cielo); obj.horizonte.set(p.horizonte);
    if (hr.noche > 0.5) { obj.arriba.multiplyScalar(0.12).lerp(tmpC.set("#0b1230"), 0.6); obj.horizonte.multiplyScalar(0.18).lerp(tmpC.set("#1a2240"), 0.5); }
    else if (z.hora === "atardecer") { obj.horizonte.lerp(tmpC.set("#ffb27a"), 0.45); obj.arriba.lerp(tmpC.set("#5a6aa8"), 0.25); }
    obj.solColor.set(hr.color); obj.sol = hr.sol; obj.hemi = hr.hemi; obj.exp = hr.exp; obj.noche = hr.noche; obj.alt = hr.alt;
    const nb = camino ? Math.max(Math.min(p.niebla || 0.008, 0.0085), 1.05 / lejos) : Math.max(p.niebla || 0, 1.2 / lejos);
    obj.niebla = nb * (z.clima === "niebla" ? 3.2 : z.clima === "lluvia" ? 1.8 : z.clima === "nieve" ? 1.6 : 1) * evento.niebla * (evento.tormenta ? 1.8 : 1);
    obj.nubes = z.clima === "despejado" ? 0.35 : 0.85; obj.lluvia = (z.clima === "lluvia" || evento.tormenta) ? 1 : 0; obj.nieve = z.clima === "nieve" ? 1 : 0;
    if (evento.tormenta) { obj.sol *= 0.45; obj.arriba.multiplyScalar(0.55); obj.horizonte.multiplyScalar(0.6); }
    if (inmediato) { for (const k of ["sol", "hemi", "exp", "niebla", "noche", "alt", "nubes", "lluvia", "nieve"]) amb[k] = obj[k]; amb.arriba.copy(obj.arriba); amb.horizonte.copy(obj.horizonte); amb.solColor.copy(obj.solColor); }
  }
  let claveIBL = "";
  function actualizarAmbiente(dt) {
    const k = 1 - Math.exp(-dt * 0.9);
    for (const c of ["sol", "hemi", "exp", "niebla", "noche", "alt", "nubes", "lluvia", "nieve"]) amb[c] += (obj[c] - amb[c]) * k;
    amb.arriba.lerp(obj.arriba, k); amb.horizonte.lerp(obj.horizonte, k); amb.solColor.lerp(obj.solColor, k);
    cieloU.arriba.value.copy(amb.arriba).convertSRGBToLinear(); cieloU.horizonte.value.copy(amb.horizonte).convertSRGBToLinear(); cieloU.bruma.value.copy(cieloU.horizonte.value);
    cieloU.solColor.value.copy(amb.solColor).convertSRGBToLinear(); cieloU.noche.value = amb.noche; cieloU.nubes.value = amb.nubes;
    cieloU.solDir.value.set(0.45, amb.alt, 0.35).normalize();
    escena.fog.color.copy(amb.horizonte).convertSRGBToLinear(); escena.fog.density = amb.niebla;
    hemi.color.copy(amb.arriba).convertSRGBToLinear(); hemi.intensity = amb.hemi * 1.15; sol.color.copy(amb.solColor).convertSRGBToLinear(); sol.intensity = amb.sol;
    renderer.toneMappingExposure = amb.exp;
    linterna.intensity = amb.noche > 0.4 || C.tema === "terror" ? 1.8 * Math.max(amb.noche, 0.5) : 0;
    const clave = `${Math.round(amb.noche * 4)}|${amb.arriba.getHexString().slice(0, 3)}|${amb.horizonte.getHexString().slice(0, 3)}`;
    if (clave !== claveIBL && (Math.abs(amb.noche - obj.noche) < 0.05)) { claveIBL = clave; ambienteIBL(clave); }
  }

  /* ───────── El camino de la travesía (y en qué zona está cada punto) ───────── */
  let camino = null;
  if (NZ > 1 && !CARRERA) {
    const pts = [], K = 3 * NZ + 2, ini = new V3(-0.36 * S, 0, -0.3 * S), fin = new V3(0.33 * S, 0, 0.34 * S);
    const dir = tmpV.copy(fin).sub(ini).normalize(), perp = new V3(-dir.z, 0, dir.x);
    for (let k = 0; k <= K; k++) { const t = k / K, p = ini.clone().lerp(fin, t); const lat = Math.sin(t * Math.PI * 2.3 + 0.4) * 0.26 * S * (1 - 0.35 * Math.abs(t - 0.5)) + (rnd() - 0.5) * 0.05 * S;
      p.addScaledVector(perp, lat); p.x = NK.clamp(p.x, -0.42 * S, 0.42 * S); p.z = NK.clamp(p.z, -0.42 * S, 0.42 * S); pts.push(p); }
    const curva = new THREE.CatmullRomCurve3(pts, false, "centripetal"), N = 90 * NZ, muestras = curva.getSpacedPoints(N), L = curva.getLength();
    const alt = muestras.map((m, i) => ruido.fbm(i * 0.012 + 3, 7.1, 3) * 7 * (0.4 + R) + Math.sin(i / N * Math.PI * 2) * 2);
    const tang = muestras.map((m, i) => curva.getTangentAt(Math.min(0.9999, i / N)));
    // zonas: tramos iguales del camino; la última termina en la arena del jefe
    const limites = ZONAS.map((z, i) => ({ ini: Math.round(i / NZ * N), fin: Math.round((i + 1) / NZ * N) }));
    // rejilla para encontrar rápido el punto del camino más cercano
    const CEL = 4, NG = Math.ceil(S / CEL) + 1, rej = new Int32Array(NG * NG);
    for (let gz = 0; gz < NG; gz++) for (let gx = 0; gx < NG; gx++) { const x = -MITAD + gx * CEL, z = -MITAD + gz * CEL; let best = 0, bd = 1e18;
      for (let i = 0; i <= N; i += 2) { const m = muestras[i], d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = i; } } rej[gz * NG + gx] = best; }
    camino = { curva, N, muestras, L, alt, tang, limites, rej, CEL, NG };
  }
  const cercaCamino = (x, z) => {
    const cm = camino, gx = NK.clamp(Math.round((x + MITAD) / cm.CEL), 0, cm.NG - 1), gz = NK.clamp(Math.round((z + MITAD) / cm.CEL), 0, cm.NG - 1);
    let i0 = cm.rej[gz * cm.NG + gx], best = i0, bd = 1e18;
    for (let i = Math.max(0, i0 - 5); i <= Math.min(cm.N, i0 + 5); i++) { const m = cm.muestras[i], d = (m.x - x) ** 2 + (m.z - z) ** 2; if (d < bd) { bd = d; best = i; } }
    return { i: best, d: Math.sqrt(bd), t: best / cm.N };
  };
  const zonaDe = i => { if (!camino) return 0; for (let k = 0; k < NZ; k++) if (i < camino.limites[k].fin) return k; return NZ - 1; };
  const puntoCamino = (i, lateral = 0, dest = new V3()) => { const cm = camino, m = cm.muestras[NK.clamp(Math.round(i), 0, cm.N)], t = cm.tang[NK.clamp(Math.round(i), 0, cm.N)];
    return dest.set(m.x - t.z * lateral, 0, m.z + t.x * lateral); };

  /* ───────── Lagunas junto al camino (zonas con agua) ───────── */
  const lagunas = [];
  if (camino && !PLATAF) ZONAS.forEach((z, zi) => { if (!(z.paleta || {}).agua || zi === NZ - 1) return; const lim = camino.limites[zi], i = Math.round(lim.ini + (lim.fin - lim.ini) * (0.3 + 0.4 * rnd())), lado = rnd() < 0.5 ? -1 : 1;
    const c = puntoCamino(i, lado * (15 + rnd() * 5), new V3()); lagunas.push({ x: c.x, z: c.z, r: 9 + rnd() * 4, nivel: camino.alt[i] - 0.5, color: z.paleta.agua, zona: zi }); });
  const lagunaEn = (x, z) => { for (const l of lagunas) { const d = Math.hypot(x - l.x, z - l.z); if (d < l.r * 1.25) return { l, d }; } return null; };

  /* ───────── Terreno: valle realista con montañas a los lados del camino ───────── */
  const segs = Math.round(Q.terreno * (NZ > 1 ? 1.35 : 1));
  function alturaBase(x, z) {
    let h;
    if (PLATAF && !camino) h = -3.5 + ruido.fbm(x * 0.03, z * 0.03, 2) * 1.5;
    else {
      h = ruido.fbm(x * 0.011, z * 0.011, 4) * 20 * R + ruido.fbm(x * 0.05 + 50, z * 0.05, 2) * 2.2 * R;
      if (C.mundo.isla && !camino) { const d = Math.hypot(x, z) / MITAD; h = h * 0.55 + 5 - d * d * 13; }
    }
    if (camino) {
      const c = cercaCamino(x, z), hc = camino.alt[c.i];
      const arena = c.i > camino.N - 8 ? 26 : c.i < 6 ? 16 : 0;  // la arena del jefe y el inicio son más anchos y planos
      const valle = smooth(9 + arena, 44 + arena, c.d);
      const monte = ruido.fbm(x * 0.018 + 9, z * 0.018, 5);
      h = hc + ruido.fbm(x * 0.09, z * 0.09, 2) * 0.35 + valle * valle * (16 + 26 * R) * (0.75 + monte * 0.7) + valle * h * 0.6;
      if (PLATAF) h = NK.lerp(-7.5, h, smooth(6, 16, c.d));  // abismo con agua/lava bajo las plataformas
      const lg = lagunas.length ? lagunaEn(x, z) : null;
      if (lg) { const f = smooth(lg.l.r * 1.25, lg.l.r * 0.55, lg.d); h = NK.lerp(h, lg.l.nivel - 2.6 * (1 - lg.d / (lg.l.r * 1.25)), f); }  // cuenco de la laguna
    } else if (!PLATAF) {
      const d0 = Math.hypot(x, z); h = NK.lerp(h * 0.25 + (C.mundo.isla ? 2 : 0), h, smooth(4, 16, d0));
    }
    h += smooth(MITAD * 0.8, MITAD, Math.max(Math.abs(x), Math.abs(z))) * 20 * (0.4 + R);  // montañas en el borde del mundo
    if (PLATAF && !camino) { const d0 = Math.hypot(x, z); return d0 < 9 ? NK.lerp(2, h, smooth(6, 9, d0)) : h; }
    return h;
  }
  const nivelAgua = PLATAF ? (camino ? -5.5 : 0.2) : (A.agua && !camino ? (C.mundo.isla ? 0.6 : -2.2 - 6 * R) : -1e9);
  const aguaEn = (x, z) => { if (lagunas.length) { const lg = lagunaEn(x, z); if (lg && lg.d < lg.l.r) return lg.l.nivel; } return nivelAgua; };
  const gT = new THREE.PlaneGeometry(S, S, segs, segs); gT.rotateX(-Math.PI / 2);
  const pT = gT.attributes.position, colT = new Float32Array(pT.count * 3);
  for (let i = 0; i < pT.count; i++) pT.setY(i, alturaBase(pT.getX(i), pT.getZ(i)));
  gT.computeVertexNormals();
  const nT = gT.attributes.normal, arena = lin("#d8c89a"), roca = lin("#7a746c"), nieve = lin("#f4f7fa");
  const palZ = ZONAS.map(z => (z.paleta.suelo || A.suelo).map(c => lin(c)));
  function colorSuelo(x, z, h, ny, out) {
    let zi = 0, f = 0;
    if (camino) { const c = cercaCamino(x, z); zi = zonaDe(c.i); const lim = camino.limites[zi]; f = smooth(lim.fin - 10, lim.fin + 10, c.i); }
    const mezcla = (pal) => { const hh = camino ? h - camino.alt[cercaCamino(x, z).i] : h; const k = NK.clamp((hh + 4) / (22 * Math.max(0.3, R) + 10), 0, 1) * (pal.length - 1), j = Math.floor(k);
      return tmpC2.copy(pal[Math.min(j, pal.length - 1)]).lerp(pal[Math.min(j + 1, pal.length - 1)], k - j); };
    out.copy(mezcla(palZ[zi])); if (f > 0 && zi + 1 < NZ) out.lerp(mezcla(palZ[zi + 1]), f);
    out.lerp(roca, smooth(0.78, 0.55, ny) * 0.85);  // laderas empinadas: roca
    const altN = camino ? h - camino.alt[cercaCamino(x, z).i] : h; if (altN > 26 + 10 * R) out.lerp(nieve, smooth(26 + 10 * R, 34 + 10 * R, altN) * 0.9);  // cumbres nevadas
    const na = aguaEn(x, z); if (h < na + 0.6 && na > -1e8) out.lerp(arena, 0.55);
    const v = (0.8 + ruido.v2(x * 0.3, z * 0.3) * 0.14) * (0.9 + 0.1 * ruido.v2(x * 0.03 + 7, z * 0.03)); out.multiplyScalar(v); return out;
  }
  for (let i = 0; i < pT.count; i++) { colorSuelo(pT.getX(i), pT.getZ(i), pT.getY(i), nT.getY(i), tmpC); colT[i * 3] = tmpC.r; colT[i * 3 + 1] = tmpC.g; colT[i * 3 + 2] = tmpC.b; }
  gT.setAttribute("color", new THREE.BufferAttribute(colT, 3));
  // texturas de detalle generadas (sin archivos): grano del suelo + mapa normal
  // ruido repetible (sin costuras) para texturas que se repiten sobre el terreno
  const TN = (() => { const r = NK.rand(4242), g = new Float32Array(256 * 256); for (let i = 0; i < g.length; i++) g[i] = r() * 2 - 1;
    return (x, y, per) => { const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi, u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
      const m = k => ((k % per) + per) % per, a = g[m(yi) * 256 + m(xi)], b = g[m(yi) * 256 + m(xi + 1)], c = g[m(yi + 1) * 256 + m(xi)], d = g[m(yi + 1) * 256 + m(xi + 1)];
      return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v; }; })();
  const fbmT = (u, v, f0, oct) => { let s = 0, amp = 1, n = 0, f = f0; for (let o = 0; o < oct; o++) { s += amp * TN(u * f, v * f, f); n += amp; amp *= 0.5; f *= 2; } return s / n; };
  function texturaDetalle(tam, fn, normal) {
    const c = document.createElement("canvas"); c.width = c.height = tam; const x = c.getContext("2d"), img = x.createImageData(tam, tam), d = img.data, alt = new Float32Array(tam * tam);
    for (let j = 0; j < tam; j++) for (let i = 0; i < tam; i++) alt[j * tam + i] = fn(i / tam, j / tam);
    for (let j = 0; j < tam; j++) for (let i = 0; i < tam; i++) { const k = (j * tam + i) * 4, a = alt[j * tam + i];
      if (normal) { const dx = alt[j * tam + (i + 1) % tam] - alt[j * tam + (i - 1 + tam) % tam], dy = alt[((j + 1) % tam) * tam + i] - alt[((j - 1 + tam) % tam) * tam + i];
        const nx = -dx * 3, ny = -dy * 3, nz = 1, l = Math.hypot(nx, ny, nz); d[k] = (nx / l * 0.5 + 0.5) * 255; d[k + 1] = (ny / l * 0.5 + 0.5) * 255; d[k + 2] = (nz / l * 0.5 + 0.5) * 255; }
      else { const v = 212 + a * 50; d[k] = v; d[k + 1] = v; d[k + 2] = v; } d[k + 3] = 255; }
    x.putImageData(img, 0, 0); const t = new THREE.CanvasTexture(c); t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = ANISO; if (!normal) t.encoding = THREE.sRGBEncoding; return t;
  }
  const grano = (u, v) => fbmT(u, v, 8, 4) * 0.65 + TN(u * 96, v * 96, 96) * 0.35;
  const texSueloD = texturaDetalle(ALTO ? 512 : 256, grano, false), texSueloN = texturaDetalle(ALTO ? 512 : 256, grano, true);
  texSueloD.repeat.set(S / 5, S / 5); texSueloN.repeat.set(S / 5, S / 5);
  const matT = new THREE.MeshStandardMaterial({ vertexColors: true, map: texSueloD, normalMap: texSueloN, normalScale: new THREE.Vector2(1.1, 1.1), roughness: 0.97, metalness: 0, envMapIntensity: 0.55 });
  const terreno = new THREE.Mesh(gT, matT); terreno.receiveShadow = !!Q.sombras; escena.add(terreno);
  const texSuelo = NK.activos.texturas && (NK.activos.texturas.suelo || NK.activos.texturas[Object.keys(NK.activos.texturas)[0]]);
  if (texSuelo && texSuelo.color && location.protocol !== "file:") {
    new THREE.TextureLoader().load(texSuelo.color, t => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(S / 8, S / 8); t.encoding = THREE.sRGBEncoding; t.anisotropy = ANISO; matT.map = t; matT.needsUpdate = true; });
  }
  const alturaGrid = (x, z) => {
    const fx = NK.clamp((x + MITAD) / S * segs, 0, segs - 1e-4), fz = NK.clamp((z + MITAD) / S * segs, 0, segs - 1e-4);
    const ix = Math.floor(fx), iz = Math.floor(fz), dx = fx - ix, dz = fz - iz, w = segs + 1;
    const h00 = pT.getY(iz * w + ix), h10 = pT.getY(iz * w + ix + 1), h01 = pT.getY((iz + 1) * w + ix), h11 = pT.getY((iz + 1) * w + ix + 1);
    return dx + dz <= 1 ? h00 + (h10 - h00) * dx + (h01 - h00) * dz : h11 + (h01 - h11) * (1 - dx) + (h10 - h11) * (1 - dz);
  };
  // la cinta del camino (tierra apisonada) sobre el terreno
  if (camino && !PLATAF) {
    const cm = camino, pos = [], col = [], uv = [], idx = [], W = 3.4, cTierra = lin("#8a7152");
    for (let i = 0; i <= cm.N; i++) { const m = cm.muestras[i], t = cm.tang[i];
      for (const s of [-1, 0, 1]) { const x = m.x - t.z * W / 2 * s, z = m.z + t.x * W / 2 * s; pos.push(x, alturaGrid(x, z) + 0.05 + (s === 0 ? 0.02 : 0), z);
        tmpC.copy(cTierra).lerp(palZ[zonaDe(i)][2] || cTierra, 0.35).multiplyScalar(s === 0 ? 1 : 0.9); col.push(tmpC.r, tmpC.g, tmpC.b); uv.push(s * 0.5 + 0.5, i * 0.6); }
      if (i < cm.N) for (let q = 0; q < 2; q++) { const a = i * 3 + q; idx.push(a, a + 1, a + 3, a + 1, a + 4, a + 3); } }
    const gc = new THREE.BufferGeometry(); gc.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gc.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
    gc.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); gc.setIndex(idx); gc.computeVertexNormals();
    const tc = texSueloD.clone(); tc.repeat.set(1, 1); tc.needsUpdate = true;
    const mc = new THREE.MeshStandardMaterial({ vertexColors: true, map: tc, roughness: 1, polygonOffset: true, polygonOffsetFactor: -2 });
    const cinta = new THREE.Mesh(gc, mc); cinta.receiveShadow = !!Q.sombras; escena.add(cinta);
  }
  // agua con reflejos del cielo y olas (mapa normal animado)
  let agua = null, texAguaN = null;
  if (nivelAgua > -1e8) {
    texAguaN = texturaDetalle(256, (u, v) => Math.sin((u * 4 + fbmT(u, v, 4, 2) * 0.5) * Math.PI * 2) * 0.35 + fbmT(u, v, 8, 3) * 0.6, true); texAguaN.repeat.set(S / 14, S / 14);
    const colA = PLATAF && !A.agua ? "#ff6a2a" : (A.agua || "#2f6f9f");
    agua = new THREE.Mesh(new THREE.PlaneGeometry(S * 3, S * 3, 1, 1).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: lin(colA), roughness: 0.06, metalness: 0.25,
      normalMap: texAguaN, normalScale: new THREE.Vector2(0.45, 0.45), transparent: true, opacity: 0.86, emissive: PLATAF && !A.agua ? 0x661800 : 0x000000 }));
    agua.position.y = nivelAgua; agua.receiveShadow = !!Q.sombras; escena.add(agua);
  }

  if (lagunas.length) {
    if (!texAguaN) { texAguaN = texturaDetalle(256, (u, v) => Math.sin((u * 4 + fbmT(u, v, 4, 2) * 0.5) * Math.PI * 2) * 0.35 + fbmT(u, v, 8, 3) * 0.6, true); texAguaN.repeat.set(6, 6); }
    for (const l of lagunas) { const m = new THREE.Mesh(new THREE.CircleGeometry(l.r * 1.12, 40).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: lin(l.color), roughness: 0.05, metalness: 0.25,
      normalMap: texAguaN, normalScale: new THREE.Vector2(0.35, 0.35), transparent: true, opacity: 0.88 })); m.position.set(l.x, l.nivel, l.z); m.receiveShadow = !!Q.sombras; escena.add(m); l.malla = m; }
  }

  /* ───────── Utilidades de geometría (todo se crea una vez) ───────── */
  function parte(geo, color, x = 0, y = 0, z = 0, sx = 1, sy = 1, sz = 1, rx = 0, ry = 0, rz = 0) {
    const g = geo.index ? geo.toNonIndexed() : geo.clone();
    tmpE.set(rx, ry, rz); tmpQ.setFromEuler(tmpE); tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(sx, sy, sz)); g.applyMatrix4(tmpM);
    const c = lin(color), n = g.attributes.position.count, col = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) { col[i * 3] = c.r; col[i * 3 + 1] = c.g; col[i * 3 + 2] = c.b; }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3)); if (g.attributes.uv) g.deleteAttribute("uv");
    return g;
  }
  function fusionar(partes) {
    let n = 0; partes.forEach(p => n += p.attributes.position.count);
    const pos = new Float32Array(n * 3), nor = new Float32Array(n * 3), col = new Float32Array(n * 3); let o = 0;
    partes.forEach(p => { pos.set(p.attributes.position.array, o * 3); nor.set(p.attributes.normal.array, o * 3); col.set(p.attributes.color.array, o * 3); o += p.attributes.position.count; p.dispose(); });
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("normal", new THREE.BufferAttribute(nor, 3)); g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    g.computeBoundingSphere(); g.computeBoundingBox(); return g;
  }
  // esfera «orgánica» (copas de árboles, arbustos, rocas): se deforma con ruido para que no se vea de juguete
  function blob(r, det, amp, semilla) { const g = new THREE.IcosahedronGeometry(r, det), p = g.attributes.position, rn = NK.ruido(semilla);
    for (let i = 0; i < p.count; i++) { tmpV.fromBufferAttribute(p, i); const f = 1 + amp * rn.fbm(tmpV.x * 1.3 + 5, tmpV.z * 1.3 + tmpV.y, 3); tmpV.multiplyScalar(f); p.setXYZ(i, tmpV.x, tmpV.y, tmpV.z); }
    g.computeVertexNormals(); return g; }
  const oscuro = (hex, f) => "#" + new THREE.Color(hex).multiplyScalar(f).getHexString();
  const verde = A.suelo[1] || "#5c9a3c";
  const GEO = { box: new THREE.BoxGeometry(1, 1, 1), cil: new THREE.CylinderGeometry(0.5, 0.5, 1, 10), cono: new THREE.ConeGeometry(0.5, 1, 10), esf: new THREE.SphereGeometry(0.5, 14, 10),
    ico: new THREE.IcosahedronGeometry(0.5, 0), dod: new THREE.DodecahedronGeometry(0.5, 0), oct: new THREE.OctahedronGeometry(0.5, 0), cono4: new THREE.ConeGeometry(0.72, 1, 4),
    copa: blob(0.5, 2, 0.28, 11), copa2: blob(0.5, 2, 0.32, 23), roca: blob(0.5, 2, 0.34, 5), tronco: new THREE.CylinderGeometry(0.36, 0.5, 1, 10) };
  const DECO = {
    arbol: () => [fusionar([parte(GEO.tronco, "#5a3d26", 0, 1.5, 0, 0.55, 3.0, 0.55), parte(GEO.cil, "#5a3d26", 0.5, 2.9, 0.1, 0.16, 1.4, 0.16, 0, 0, -0.8), parte(GEO.cil, "#5a3d26", -0.45, 3.0, -0.1, 0.14, 1.3, 0.14, 0.2, 0, 0.8),
      parte(GEO.copa, verde, 0, 4.1, 0, 3.2, 2.6, 3.2), parte(GEO.copa2, oscuro(verde, 0.82), 1.0, 3.6, 0.4, 2.2, 1.8, 2.2), parte(GEO.copa2, oscuro(verde, 1.1), -0.9, 4.6, -0.3, 2.0, 1.7, 2.0)]), 5.8, 0.6],
    pino: () => [fusionar([parte(GEO.tronco, "#4a3322", 0, 1.2, 0, 0.4, 2.4, 0.4), parte(GEO.cono, oscuro(verde, 0.62), 0, 2.6, 0, 3.4, 2.6, 3.4), parte(GEO.cono, oscuro(verde, 0.72), 0, 3.9, 0, 2.7, 2.3, 2.7),
      parte(GEO.cono, oscuro(verde, 0.82), 0, 5.0, 0, 2.0, 2.0, 2.0), parte(GEO.cono, oscuro(verde, 0.9), 0, 6.0, 0, 1.2, 1.6, 1.2)]), 6.8, 0.5],
    palmera: () => { const p = [parte(GEO.cil, "#8a6a3f", 0, 1.5, 0, 0.35, 3, 0.35, 0, 0, 0.08), parte(GEO.cil, "#7d5e36", 0.25, 4.2, 0, 0.3, 2.6, 0.3, 0, 0, 0.18)];
      for (let i = 0; i < 7; i++) { const a = i / 7 * Math.PI * 2; p.push(parte(GEO.cono, "#3f8f3a", 0.45 + Math.cos(a) * 1.3, 5.4, Math.sin(a) * 1.3, 0.7, 3, 0.25, Math.sin(a) * 1.25, -a, -Math.cos(a) * 1.25)); }
      return [fusionar(p), 6.5, 0.4]; },
    roca: () => [fusionar([parte(GEO.roca, "#8a8a86", 0, 0.45, 0, 1.9, 1.2, 1.6), parte(GEO.roca, "#9a9a94", 0.7, 0.3, 0.4, 1, 0.7, 0.9)]), 1.3, 0.9],
    arbusto: () => [fusionar([parte(GEO.copa, oscuro(verde, 0.9), 0, 0.5, 0, 1.5, 1.05, 1.5), parte(GEO.copa2, verde, 0.5, 0.6, 0.2, 1.05, 0.85, 1.05), parte(GEO.copa, oscuro(verde, 1.08), -0.45, 0.55, -0.2, 0.9, 0.75, 0.9)]), 1.1, 0.5],
    cactus: () => [fusionar([parte(GEO.cil, "#3f8f4a", 0, 1.3, 0, 0.55, 2.6, 0.55), parte(GEO.cil, "#3f8f4a", 0.55, 1.4, 0, 0.35, 0.9, 0.35, 0, 0, 1.57), parte(GEO.cil, "#3f8f4a", 0.75, 1.9, 0, 0.32, 1, 0.32), parte(GEO.esf, "#3f8f4a", 0, 2.6, 0, 0.55, 0.4, 0.55)]), 2.8, 0.4],
    casa: () => [fusionar([parte(GEO.box, "#d8c8a8", 0, 1.5, 0, 5, 3, 4), parte(GEO.cono4, "#9a3b2b", 0, 4, 0, 5.2, 2.2, 4.4, 0, Math.PI / 4, 0), parte(GEO.box, "#5a3d22", 0, 0.9, 2.02, 1, 1.8, 0.1), parte(GEO.box, "#9fd0ff", 1.5, 1.8, 2.02, 0.8, 0.7, 0.1), parte(GEO.box, "#9fd0ff", -1.5, 1.8, 2.02, 0.8, 0.7, 0.1)]), 5, 3],
    torre: () => [fusionar([parte(GEO.cil, "#a9a39a", 0, 5, 0, 4, 10, 4), parte(GEO.cono, "#5a4a8a", 0, 11.5, 0, 5, 3.5, 5), parte(GEO.box, "#3a3a3a", 0, 7, 1.95, 0.8, 1.4, 0.2)]), 13, 2.2],
    edificio: () => [fusionar([parte(GEO.box, "#7d8792", 0, 7, 0, 8, 14, 8), parte(GEO.box, "#9fd0ff", 0, 7, 4.02, 6.5, 12, 0.05), parte(GEO.box, "#9fd0ff", 4.02, 7, 0, 0.05, 12, 6.5), parte(GEO.box, "#5a626b", 0, 14.3, 0, 8.4, 0.6, 8.4)]), 15, 5],
    cristal: () => [fusionar([parte(GEO.oct, "#8fe8ff", 0, 1, 0, 0.9, 2.2, 0.9), parte(GEO.oct, "#b89fff", 0.6, 0.6, 0.3, 0.5, 1.3, 0.5, 0.3, 0, 0.3), parte(GEO.oct, "#8fe8ff", -0.5, 0.5, -0.2, 0.45, 1.1, 0.45, -0.3, 0, -0.2)]), 2.2, 0.6],
    hongo: () => [fusionar([parte(GEO.cil, "#f2e6d0", 0, 0.5, 0, 0.35, 1, 0.35), parte(GEO.esf, "#e0403a", 0, 1.05, 0, 1.4, 0.8, 1.4), parte(GEO.esf, "#ffffff", 0.3, 1.35, 0.2, 0.2, 0.12, 0.2)]), 1.4, 0.4],
    farola: () => [fusionar([parte(GEO.cil, "#2f3338", 0, 2, 0, 0.18, 4, 0.18), parte(GEO.box, "#2f3338", 0.4, 4, 0, 0.9, 0.12, 0.12), parte(GEO.esf, "#fff2b0", 0.8, 3.8, 0, 0.45, 0.35, 0.45)]), 4.2, 0.3],
    caja: () => [fusionar([parte(GEO.box, "#a0763f", 0, 0.5, 0, 1, 1, 1), parte(GEO.box, "#6b4a2b", 0, 0.5, 0, 1.02, 0.12, 1.02), parte(GEO.box, "#6b4a2b", 0, 0.5, 0, 0.12, 1.02, 1.02)]), 1, 0.7],
    lapida: () => [fusionar([parte(GEO.box, "#8f9192", 0, 0.6, 0, 0.9, 1.2, 0.25), parte(GEO.cil, "#8f9192", 0, 1.2, 0, 0.9, 0.25, 0.9, 1.57, 0, 0), parte(GEO.box, "#6d6f70", 0, 0.05, 0.25, 1.1, 0.1, 0.6)]), 1.4, 0.5],
    piramide: () => [fusionar([parte(GEO.cono4, "#d8b878", 0, 7, 0, 20, 14, 20, 0, Math.PI / 4, 0)]), 14, 8],
  };
  DECO.ruina = DECO.torre; DECO.planta = DECO.arbusto; DECO.flor = DECO.arbusto; DECO.abeto = DECO.pino;
  const matVC = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.88, metalness: 0 });
  const TAM_OBJETIVO = { arbol: 6, pino: 7, palmera: 7, roca: 1.6, arbusto: 1.3, cactus: 2.8, casa: 5, torre: 13, edificio: 15, cristal: 2.2, hongo: 1.4, farola: 4.2, caja: 1, lapida: 1.3, piramide: 14,
    vehiculo: 1.7, senal: 2.8, urbano: 1.1, cono: 0.75, barril: 1.1, contenedor: 2.4, escombros: 0.8, valla: 1.3, banco: 1, calabaza: 0.7, ataud: 0.8, hueso: 0.6, vela: 0.6 };
  function piezasGLTF(gltf, altura) {
    const root = gltf.scene; root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root), tam = box.getSize(new V3());
    const k = altura / Math.max(0.001, tam.y || Math.max(tam.x, tam.z));
    const norm = new THREE.Matrix4().makeScale(k, k, k).multiply(new THREE.Matrix4().makeTranslation(-(box.min.x + box.max.x) / 2, -box.min.y, -(box.min.z + box.max.z) / 2));
    const piezas = [];
    root.traverse(o => { if (o.isMesh && !o.isSkinnedMesh) piezas.push({ geo: o.geometry, mat: o.material, m: new THREE.Matrix4().multiplyMatrices(norm, o.matrixWorld) }); });
    return { piezas, radio: Math.max(tam.x, tam.z) * k * 0.35 };
  }
  function Conjunto(piezas, n, sombras) { this.n = n; this.mallas = piezas.map(p => { const im = new THREE.InstancedMesh(p.geo, p.mat, n); im.castShadow = sombras; im.receiveShadow = !!Q.sombras; im.userData.base = p.m; im.frustumCulled = false; escena.add(im); return im; }); }
  const tmpM2 = new THREE.Matrix4();
  Conjunto.prototype.fijar = function (i, x, y, z, ry = 0, s = 1) { tmpQ.setFromAxisAngle(tmpV2.set(0, 1, 0), ry); tmpM.compose(tmpV.set(x, y, z), tmpQ, tmpS.set(s, s, s));
    for (const im of this.mallas) { tmpM2.multiplyMatrices(tmpM, im.userData.base); im.setMatrixAt(i, tmpM2); } };
  Conjunto.prototype.listo = function () { for (const im of this.mallas) { im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; } };
  Conjunto.prototype.color = function (i, c) { for (const im of this.mallas) im.setColorAt(i, c); };

  /* ───────── Colisiones y lugares libres ───────── */
  const choques = lagunas.map(l => ({ x: l.x, z: l.z, r: l.r * 0.8, agua: true }));
  const libre = (x, z, r) => { if (!camino && Math.hypot(x, z) < 10) return false; for (const c of choques) if (Math.hypot(c.x - x, c.z - z) < c.r + r) return false; return true; };
  function lugarLibre(r = 1, minDist = 12, maxDist = MITAD * 0.86, intentos = 40) {
    for (let k = 0; k < intentos; k++) {
      const a = rnd() * Math.PI * 2, d = minDist + Math.sqrt(rnd()) * (maxDist - minDist), x = Math.cos(a) * d, z = Math.sin(a) * d;
      const L = validar(x, z, r); if (L) return L;
    }
    return null;
  }
  function validar(x, z, r, sinCamino = true) {
    if (Math.abs(x) > MITAD - 3 || Math.abs(z) > MITAD - 3) return null;
    const h = alturaGrid(x, z); if (h < aguaEn(x, z) + 0.4) return null;
    if (Math.abs(alturaGrid(x + 1.5, z) - h) > 2.2 || Math.abs(alturaGrid(x, z + 1.5) - h) > 2.2) return null;
    if (camino && sinCamino && cercaCamino(x, z).d < 3.2 + r) return null;
    return libre(x, z, r) ? { x, z, y: h } : null;
  }
  // un lugar dentro de una zona, cerca del camino (lateral en metros)
  function lugarEnZona(zi, r = 1, latMin = 3, latMax = 20, margen = 6, intentos = 40) {
    if (!camino) return lugarLibre(r, 12, MITAD * 0.8);
    const lim = camino.limites[zi];
    for (let k = 0; k < intentos; k++) { const i = lim.ini + margen + rnd() * Math.max(1, lim.fin - lim.ini - 2 * margen), lat = (rnd() < 0.5 ? -1 : 1) * (latMin + rnd() * (latMax - latMin));
      puntoCamino(i, lat, tmpV3); const L = validar(tmpV3.x, tmpV3.z, r, latMin > 2.5); if (L) { L.i = i; return L; } }
    return null;
  }

  /* ───────── Pista de carreras ───────── */
  let pista = null;
  if (CARRERA) {
    const pts = [], n = 10, r0 = MITAD * 0.55;
    for (let i = 0; i < n; i++) { const a = i / n * Math.PI * 2, r = r0 * (0.75 + rnd() * 0.45); pts.push(new V3(Math.cos(a) * r, 0, Math.sin(a) * r)); }
    const curva = new THREE.CatmullRomCurve3(pts, true, "centripetal");
    const N = 400, ancho = 11, pos = [], col = [], idx = [], L = curva.getLength();
    const muestras = curva.getSpacedPoints(N);
    for (let i = 0; i <= N; i++) {
      const p = muestras[i % N], t = curva.getTangentAt((i % N) / N), nx = -t.z, nz = t.x;
      for (const s of [-1, 1]) { const x = p.x + nx * ancho / 2 * s, z = p.z + nz * ancho / 2 * s; pos.push(x, 0, z); const c = (i % 20 < 10) ? 0.2 : 0.18; col.push(c, c, c * 1.05); }
      if (i < N) { const a = i * 2; idx.push(a, a + 2, a + 1, a + 1, a + 2, a + 3); }
    }
    const cerca = (x, z) => { let best = 1e9; for (let i = 0; i < N; i += 2) { const p = muestras[i]; const d = (p.x - x) ** 2 + (p.z - z) ** 2; if (d < best) best = d; } return Math.sqrt(best); };
    for (let i = 0; i < pT.count; i++) { const x = pT.getX(i), z = pT.getZ(i), d = cerca(x, z); if (d < ancho * 1.6) pT.setY(i, NK.lerp(0.4, pT.getY(i), smooth(ancho * 0.6, ancho * 1.6, d))); }
    pT.needsUpdate = true; gT.computeVertexNormals();
    for (let i = 0; i < pos.length; i += 3) pos[i + 1] = alturaGrid(pos[i], pos[i + 2]) + 0.06;
    const gp = new THREE.BufferGeometry(); gp.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); gp.setAttribute("color", new THREE.Float32BufferAttribute(col, 3)); gp.setIndex(idx); gp.computeVertexNormals();
    const mp = new THREE.Mesh(gp, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75, polygonOffset: true, polygonOffsetFactor: -2 })); mp.receiveShadow = !!Q.sombras; escena.add(mp);
    const meta = new THREE.Mesh(new THREE.BoxGeometry(ancho, 0.05, 1.2), new THREE.MeshBasicMaterial({ color: 0xffffff }));
    const p0 = muestras[0], t0 = curva.getTangentAt(0); meta.position.set(p0.x, alturaGrid(p0.x, p0.z) + 0.1, p0.z); meta.rotation.y = Math.atan2(t0.x, t0.z); escena.add(meta);
    const arco = new THREE.Mesh(GEO.box, new THREE.MeshStandardMaterial({ color: 0xff3b3b, roughness: 0.5 })); arco.scale.set(ancho + 2, 0.8, 0.8); arco.position.copy(meta.position).y += 6; arco.rotation.y = meta.rotation.y; escena.add(arco);
    pista = { curva, muestras, N, L, ancho, cerca, checkpoints: 8 };
    for (let i = 0; i < N; i += 6) choques.push({ x: muestras[i].x, z: muestras[i].z, r: ancho * 0.9, pista: true });
  }

  /* ───────── Plataformas (género plataformas): sobre el abismo, siguiendo el camino ───────── */
  const plataformas = []; let matPlat = null;
  if (PLATAF) {
    matPlat = new THREE.MeshStandardMaterial({ color: lin(A.suelo[2] || "#8b7a5a"), roughness: 0.9 });
    const matTop = new THREE.MeshStandardMaterial({ color: lin(A.suelo[1] || "#6aa84f"), roughness: 0.95 });
    if (camino) {
      let y = camino.alt[0] + 1;
      for (let k = 0; k < NZ; k++) { const lim = camino.limites[k];
        for (let i = lim.ini; i <= lim.fin; i += 5 + Math.floor(rnd() * 2)) { const inicioZ = i - lim.ini < 3, finZ = lim.fin - i < 5;
          puntoCamino(i, (rnd() - 0.5) * 2.4, tmpV3); y = NK.clamp(y + (rnd() - 0.45) * 1.3, camino.alt[i] - 1.5, camino.alt[i] + 4.5);
          const grande = inicioZ || finZ || (i - lim.ini) % 30 < 5;
          plataformas.push({ x: tmpV3.x, y: grande ? camino.alt[i] + 0.6 : y, z: tmpV3.z, w: grande ? 6 : 2.6 + rnd() * 1.6, d: grande ? 6 : 2.6 + rnd() * 1.6, zona: k, i,
            mueve: !grande && k > 0 && rnd() < 0.18 + 0.06 * k ? { eje: rnd() < 0.5 ? "x" : "z", amp: 1.6 + 0.3 * k, vel: 0.8 + rnd() * 0.6, x0: tmpV3.x, z0: tmpV3.z } : null }); } }
    } else {
      const n = 12 + Math.round(S / 40); let x = 0, y = 2, z = 0, ang = rnd() * Math.PI * 2;
      for (let i = 0; i < n; i++) { ang += (rnd() - 0.5) * 1.1; const dd = 5 + rnd() * 2.2; x += Math.cos(ang) * dd; z += Math.sin(ang) * dd; y += 0.3 + rnd() * 1.3 - (i % 5 === 4 ? 1.2 : 0);
        if (Math.abs(x) > MITAD * 0.8 || Math.abs(z) > MITAD * 0.8) { ang += Math.PI; x = NK.clamp(x, -MITAD * 0.8, MITAD * 0.8); z = NK.clamp(z, -MITAD * 0.8, MITAD * 0.8); }
        const w = i === n - 1 ? 6 : 2.6 + rnd() * 1.6, d2 = i === n - 1 ? 6 : 2.6 + rnd() * 1.6;
        plataformas.push({ x, y, z, w, d: d2, zona: 0, mueve: i > 3 && i < n - 1 && i % 4 === 2 ? { eje: rnd() < 0.5 ? "x" : "z", amp: 1.8, vel: 0.9 + rnd() * 0.6, x0: x, z0: z } : null }); }
    }
    const im = new THREE.InstancedMesh(GEO.box, matPlat, plataformas.length), top = new THREE.InstancedMesh(GEO.box, matTop, plataformas.length);
    im.castShadow = top.castShadow = !!Q.sombras; im.receiveShadow = top.receiveShadow = !!Q.sombras; escena.add(im); escena.add(top); NK._plat = { im, top };
  }
  function actualizarPlataformas(t) {
    if (!PLATAF) return;
    const { im, top } = NK._plat;
    plataformas.forEach((p, i) => {
      if (p.fija) return;
      if (p.mueve) { const o = Math.sin(t * p.mueve.vel) * p.mueve.amp; const nx = p.mueve.x0 + (p.mueve.eje === "x" ? o : 0), nz = p.mueve.z0 + (p.mueve.eje === "z" ? o : 0); p.dx = nx - p.x; p.dz = nz - p.z; p.x = nx; p.z = nz; } else { p.dx = p.dz = 0; }
      tmpM.compose(tmpV.set(p.x, p.y - 0.45, p.z), tmpQ.identity(), tmpS.set(p.w, 0.9, p.d)); im.setMatrixAt(i, tmpM);
      tmpM.compose(tmpV.set(p.x, p.y - 0.02, p.z), tmpQ.identity(), tmpS.set(p.w + 0.05, 0.12, p.d + 0.05)); top.setMatrixAt(i, tmpM);
    });
    im.instanceMatrix.needsUpdate = true; top.instanceMatrix.needsUpdate = true;
  }
  function sueloEn(x, z, yMax = 1e9) {
    let h = alturaGrid(x, z), plat = null;
    for (const p of plataformas) if (Math.abs(x - p.x) <= p.w / 2 + 0.25 && Math.abs(z - p.z) <= p.d / 2 + 0.25 && p.y <= yMax + 0.35 && p.y > h) { h = p.y; plat = p; }
    return { h, plat };
  }

  /* ───────── Decoración (por zona: cada bioma trae la suya) ───────── */
  const cargas = [];
  function ponerDecoracion() {
    const lista = [];
    if (camino && CAMP) ZONAS.forEach((z, zi) => (z.decoracion || C.decoracion || []).forEach(d => lista.push(Object.assign({}, d, { zona: zi }))));
    else (C.decoracion || []).forEach(d => lista.push(Object.assign({}, d, { zona: -1 })));
    const porZona = camino ? 1 / NZ : 1;
    for (const d of lista) {
      const tipo = (d.tipo || "roca").toLowerCase();
      const n = Math.round((d.cantidad || 20) * Q.densidad * (S / 160) ** 2 * porZona * (PLATAF ? 0.35 : 1) * (camino ? 1.15 : 1));
      if (n <= 0) continue;
      const rol = d.modelo || tipo;
      cargas.push(NK.cargarGLB(rol).then(gltf => {
        let piezas, radio, alt = +d.altura > 0 ? +d.altura : (TAM_OBJETIVO[tipo] || 3);
        if (gltf) { const r = piezasGLTF(gltf, alt); if (r.piezas.length) { piezas = r.piezas; radio = r.radio; } else gltf = null; }
        if (!gltf) { const f = (DECO[tipo] || DECO.roca)(); piezas = [{ geo: f[0], mat: matVC, m: new THREE.Matrix4() }]; radio = f[2]; }
        const lugares = [];
        for (let i = 0; i < n; i++) { const L = d.zona >= 0 ? lugarEnZona(d.zona, radio + 0.3, 5, 34, 0) : lugarLibre(radio + 0.3, 11); if (L) { lugares.push(L); choques.push({ x: L.x, z: L.z, r: radio }); } }
        if (!lugares.length) return;
        const cj = new Conjunto(piezas, lugares.length, !!Q.sombras && tipo !== "arbusto");
        const col = new THREE.Color();
        lugares.forEach((L, i) => { const s = 0.75 + rnd() * 0.55; cj.fijar(i, L.x, L.y - 0.05, L.z, rnd() * Math.PI * 2, s); if (!gltf) cj.color(i, col.setHSL(0, 0, 0.85 + rnd() * 0.3)); });
        cj.listo();
      }));
    }
  }

  /* ───────── Hierba con viento (tarjetas NVIDIA / gama media en adelante) ───────── */
  let matHierba = null;
  function ponerHierba() {
    const cant = { ultra: 30000, alto: 17000, medio: 6000 }[Q.nivel] || 0;
    if (!cant || C.tema === "espacio" || C.tema === "futurista" || C.tema === "ciudad" || PLATAF) return;
    const c = document.createElement("canvas"); c.width = 64; c.height = 128; const x = c.getContext("2d");
    for (let i = 0; i < 14; i++) { const bx = 6 + Math.random() * 52, h = 70 + Math.random() * 55, w = 3 + Math.random() * 3, dx = (Math.random() - 0.5) * 16;
      const gr = x.createLinearGradient(0, 128, 0, 128 - h); gr.addColorStop(0, "rgba(150,160,135,1)"); gr.addColorStop(1, "rgba(255,255,235,1)"); x.fillStyle = gr;
      x.beginPath(); x.moveTo(bx - w, 128); x.quadraticCurveTo(bx + dx * 0.4, 128 - h * 0.6, bx + dx, 128 - h); x.quadraticCurveTo(bx + dx * 0.4 + 1, 128 - h * 0.6, bx + w, 128); x.fill(); }
    const tex = new THREE.CanvasTexture(c); tex.encoding = THREE.sRGBEncoding;
    const g = new THREE.BufferGeometry(), pos = [], uv = [], idx = [];
    for (let k = 0; k < 3; k++) { const a = k * Math.PI / 3, cx = Math.cos(a) * 0.35, cz = Math.sin(a) * 0.35, b = pos.length / 3;
      pos.push(-cx, 0, -cz, cx, 0, cz, cx, 0.75, cz, -cx, 0.75, -cz); uv.push(0, 0, 1, 0, 1, 1, 0, 1);
      idx.push(b, b + 1, b + 2, b, b + 2, b + 3, b, b + 2, b + 1, b, b + 3, b + 2); }  // las dos caras con la normal hacia arriba (se iluminan igual)
    g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.Float32BufferAttribute(uv, 2)); g.setIndex(idx);
    g.setAttribute("normal", new THREE.Float32BufferAttribute(new Array(pos.length).fill(0).map((v, i) => i % 3 === 1 ? 1 : 0), 3));
    matHierba = new THREE.MeshLambertMaterial({ map: tex, alphaTest: 0.5 });
    matHierba.onBeforeCompile = sh => { sh.uniforms.uT = { value: 0 }; matHierba.userData.u = sh.uniforms;
      sh.vertexShader = "uniform float uT;\n" + sh.vertexShader.replace("#include <begin_vertex>", `#include <begin_vertex>
        #ifdef USE_INSTANCING
        vec4 wp = instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0);
        float h = position.y; transformed.x += sin(uT * 1.8 + wp.x * 0.35 + wp.z * 0.21) * 0.16 * h; transformed.z += cos(uT * 1.4 + wp.z * 0.33) * 0.1 * h;
        #endif`); };
    const im = new THREE.InstancedMesh(g, matHierba, cant); im.frustumCulled = false; im.receiveShadow = !!Q.sombras;
    let n = 0; const col = new THREE.Color();
    for (let k = 0; k < cant * 3 && n < cant; k++) {
      let xx, zz;
      if (camino) { puntoCamino(rnd() * camino.N, (rnd() < 0.5 ? -1 : 1) * (2.2 + Math.pow(rnd(), 1.3) * 26), tmpV3); xx = tmpV3.x; zz = tmpV3.z; }
      else { xx = (rnd() - 0.5) * S * 0.8; zz = (rnd() - 0.5) * S * 0.8; }
      const h = alturaGrid(xx, zz); if (h < aguaEn(xx, zz) + 0.3) continue;
      if (Math.abs(alturaGrid(xx + 1, zz) - h) > 0.8) continue;
      if (camino && cercaCamino(xx, zz).d < 2.1) continue;
      const s = 0.7 + rnd() * 0.8; tmpQ.setFromAxisAngle(tmpV2.set(0, 1, 0), rnd() * Math.PI); tmpM.compose(tmpV.set(xx, h - 0.05, zz), tmpQ, tmpS.set(s, s * (0.8 + rnd() * 0.6), s)); im.setMatrixAt(n, tmpM);
      let zi = 0; if (camino) zi = zonaDe(cercaCamino(xx, zz).i);
      col.copy(palZ[zi][1] || palZ[zi][0]).lerp(palZ[zi][0], rnd() * 0.5).multiplyScalar(1.25 + rnd() * 0.35); im.setColorAt(n, col); n++;
    }
    im.count = n; im.instanceMatrix.needsUpdate = true; if (im.instanceColor) im.instanceColor.needsUpdate = true; escena.add(im);
  }

  /* ───────── Personajes: modelo .glb (con esqueleto y animaciones) o figura del motor ───────── */
  const matCuerpo = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.75 });
  function geoHumanoide(ropa, piel = "#f1c9a5", extra = {}) {
    const p = [parte(GEO.cil, ropa, 0, 0.95, 0, 0.62, 0.9, 0.42), parte(GEO.esf, ropa, 0, 1.38, 0, 0.64, 0.4, 0.46), parte(GEO.esf, piel, 0, 1.62, 0, 0.5, 0.52, 0.5),
      parte(GEO.esf, "#111111", 0.1, 1.66, 0.22, 0.07, 0.09, 0.05), parte(GEO.esf, "#111111", -0.1, 1.66, 0.22, 0.07, 0.09, 0.05),
      parte(GEO.cil, oscuro(ropa, 0.6), 0.14, 0.3, 0, 0.2, 0.62, 0.22), parte(GEO.cil, oscuro(ropa, 0.6), -0.14, 0.3, 0, 0.2, 0.62, 0.22),
      parte(GEO.cil, ropa, 0.36, 1.05, 0, 0.14, 0.62, 0.14, 0, 0, 0.18), parte(GEO.cil, ropa, -0.36, 1.05, 0, 0.14, 0.62, 0.14, 0, 0, -0.18)];
    if (extra.casco) p.push(parte(GEO.esf, extra.casco, 0, 1.72, 0, 0.56, 0.36, 0.56));
    if (extra.cuernos) p.push(parte(GEO.cono, extra.cuernos, 0.18, 1.95, 0, 0.1, 0.3, 0.1, 0, 0, -0.4), parte(GEO.cono, extra.cuernos, -0.18, 1.95, 0, 0.1, 0.3, 0.1, 0, 0, 0.4));
    return fusionar(p);
  }
  function geoCuadrupedo(c, g = 1) {
    return fusionar([parte(GEO.box, c, 0, 0.75 * g, 0, 0.6 * g, 0.55 * g, 1.3 * g), parte(GEO.box, c, 0, 1.0 * g, 0.78 * g, 0.45 * g, 0.42 * g, 0.5 * g),
      parte(GEO.box, oscuro(c, 0.8), 0, 0.9 * g, 1.05 * g, 0.26 * g, 0.2 * g, 0.3 * g), parte(GEO.esf, "#ffdd33", 0.12 * g, 1.1 * g, 1.02 * g, 0.08 * g, 0.08 * g, 0.05 * g), parte(GEO.esf, "#ffdd33", -0.12 * g, 1.1 * g, 1.02 * g, 0.08 * g, 0.08 * g, 0.05 * g),
      parte(GEO.cono, c, 0.13 * g, 1.3 * g, 0.72 * g, 0.12 * g, 0.22 * g, 0.1 * g), parte(GEO.cono, c, -0.13 * g, 1.3 * g, 0.72 * g, 0.12 * g, 0.22 * g, 0.1 * g),
      ...[[0.2, 0.45], [-0.2, 0.45], [0.2, -0.45], [-0.2, -0.45]].map(([x, z]) => parte(GEO.cil, oscuro(c, 0.75), x * g, 0.28 * g, z * g, 0.16 * g, 0.56 * g, 0.16 * g)),
      parte(GEO.cono, c, 0, 0.85 * g, -0.8 * g, 0.18 * g, 0.6 * g, 0.18 * g, -1.1, 0, 0)]);
  }
  const FORMAS = {
    slime: c => [fusionar([parte(GEO.esf, c, 0, 0.5, 0, 1.2, 0.95, 1.2), parte(GEO.esf, "#ffffff", 0.22, 0.72, 0.45, 0.22, 0.26, 0.12), parte(GEO.esf, "#ffffff", -0.22, 0.72, 0.45, 0.22, 0.26, 0.12), parte(GEO.esf, "#111", 0.22, 0.72, 0.52, 0.1, 0.13, 0.06), parte(GEO.esf, "#111", -0.22, 0.72, 0.52, 0.1, 0.13, 0.06)]), 1.0, 0.6],
    lobo: c => [geoCuadrupedo(c), 1.3, 0.7], zorro: c => [geoCuadrupedo(c, 0.8), 1.0, 0.55], dinosaurio: c => [geoCuadrupedo(c, 1.9), 2.6, 1.3],
    esqueleto: c => [geoHumanoide(c, "#f3efe4"), 1.8, 0.4], zombie: c => [geoHumanoide("#4a5a7a", c), 1.8, 0.4],
    robot: c => [fusionar([parte(GEO.box, "#9aa3ad", 0, 0.9, 0, 0.8, 0.9, 0.55), parte(GEO.box, "#b8c0c8", 0, 1.6, 0, 0.6, 0.5, 0.5), parte(GEO.box, c, 0, 1.62, 0.26, 0.42, 0.12, 0.04), parte(GEO.cil, "#555", 0, 2.0, 0, 0.05, 0.4, 0.05), parte(GEO.esf, c, 0, 2.22, 0, 0.14, 0.14, 0.14), parte(GEO.box, "#6b737c", 0.2, 0.25, 0, 0.25, 0.5, 0.35), parte(GEO.box, "#6b737c", -0.2, 0.25, 0, 0.25, 0.5, 0.35), parte(GEO.box, "#8a929b", 0.55, 0.95, 0, 0.18, 0.7, 0.2), parte(GEO.box, "#8a929b", -0.55, 0.95, 0, 0.18, 0.7, 0.2)]), 2.2, 0.5],
    fantasma: c => [fusionar([parte(GEO.esf, c, 0, 1.5, 0, 1, 1, 1), parte(GEO.cono, c, 0, 0.75, 0, 1.05, 1.4, 1.05, Math.PI, 0, 0), parte(GEO.esf, "#111", 0.18, 1.6, 0.42, 0.14, 0.2, 0.08), parte(GEO.esf, "#111", -0.18, 1.6, 0.42, 0.14, 0.2, 0.08), parte(GEO.esf, "#111", 0, 1.3, 0.45, 0.18, 0.12, 0.06)]), 2.0, 0.5],
    escorpion: c => [fusionar([parte(GEO.box, c, 0, 0.3, 0, 0.8, 0.3, 1), parte(GEO.box, c, 0.55, 0.3, 0.6, 0.35, 0.18, 0.5), parte(GEO.box, c, -0.55, 0.3, 0.6, 0.35, 0.18, 0.5), parte(GEO.cil, c, 0, 0.6, -0.6, 0.18, 0.7, 0.18, -0.8, 0, 0), parte(GEO.cil, c, 0, 1.05, -0.65, 0.16, 0.5, 0.16, 0.6, 0, 0), parte(GEO.cono, "#222", 0, 1.2, -0.4, 0.14, 0.3, 0.14, 1.9, 0, 0)]), 1.2, 0.6],
    cangrejo: c => [fusionar([parte(GEO.esf, c, 0, 0.35, 0, 1.2, 0.5, 0.9), parte(GEO.esf, c, 0.75, 0.45, 0.3, 0.45, 0.35, 0.35), parte(GEO.esf, c, -0.75, 0.45, 0.3, 0.45, 0.35, 0.35), parte(GEO.esf, "#111", 0.15, 0.65, 0.35, 0.1, 0.1, 0.1), parte(GEO.esf, "#111", -0.15, 0.65, 0.35, 0.1, 0.1, 0.1)]), 0.8, 0.6],
    condor: c => [fusionar([parte(GEO.esf, c, 0, 0, 0, 0.6, 0.5, 1.2), parte(GEO.esf, "#f2f2f2", 0, 0.12, 0.62, 0.36, 0.3, 0.3), parte(GEO.cono, "#e8c040", 0, 0.1, 0.9, 0.12, 0.3, 0.12, 1.57, 0, 0), parte(GEO.box, c, 1.1, 0.05, 0, 1.8, 0.06, 0.6), parte(GEO.box, c, -1.1, 0.05, 0, 1.8, 0.06, 0.6)]), 1.0, 0.8, true],
    auto: c => [fusionar([parte(GEO.box, c, 0, 0.6, 0, 1.8, 0.55, 3.6), parte(GEO.box, oscuro(c, 0.7), 0, 1.05, -0.2, 1.5, 0.45, 1.7), parte(GEO.box, "#9fd0ff", 0, 1.05, 0.66, 1.4, 0.36, 0.05),
      ...[[0.9, 1.1], [-0.9, 1.1], [0.9, -1.2], [-0.9, -1.2]].map(([x, z]) => parte(GEO.cil, "#1a1a1a", x, 0.38, z, 0.76, 0.35, 0.76, 0, 0, 1.57)), parte(GEO.box, "#ffffcc", 0.55, 0.65, 1.81, 0.35, 0.18, 0.04), parte(GEO.box, "#ffffcc", -0.55, 0.65, 1.81, 0.35, 0.18, 0.04)]), 1.4, 1.2],
  };
  FORMAS.dino = FORMAS.dinosaurio; FORMAS.alien = FORMAS.zombie; FORMAS.monstruo = FORMAS.slime; FORMAS.guardia = FORMAS.esqueleto; FORMAS.soldado = FORMAS.zombie; FORMAS.bandido = FORMAS.zombie;
  FORMAS.nave = FORMAS.auto; FORMAS.coche = FORMAS.auto; FORMAS.carro = FORMAS.auto; FORMAS.oso = c => [geoCuadrupedo(c, 1.4), 1.8, 0.9]; FORMAS.jabali = c => [geoCuadrupedo(c, 0.9), 1.0, 0.6];
  FORMAS.bruja = c => [geoHumanoide(c, "#b8d8a0", { casco: "#222" }), 1.9, 0.4]; FORMAS.demonio = c => [geoHumanoide(c, "#c0392b", { cuernos: "#222" }), 1.9, 0.4];
  FORMAS.cuervo = FORMAS.condor; FORMAS.murcielago = FORMAS.condor; FORMAS.dron = FORMAS.condor; FORMAS.abeja = FORMAS.condor; FORMAS.espantapajaros = c => [geoHumanoide("#6a7a4a", "#c8a672", { casco: "#d9b25a" }), 1.8, 0.4];
  FORMAS.calabaza = c => [fusionar([parte(GEO.esf, c, 0, 0.45, 0, 1.0, 0.8, 1.0), parte(GEO.cil, "#4a6a2a", 0, 0.9, 0, 0.1, 0.25, 0.1)]), 0.9, 0.5];
  FORMAS.arana = c => [fusionar([parte(GEO.esf, c, 0, 0.35, 0, 0.8, 0.5, 1), ...[-0.6, -0.2, 0.2, 0.6].flatMap(z => [parte(GEO.cil, c, 0.6, 0.35, z, 0.06, 0.9, 0.06, 0, 0, 1.0), parte(GEO.cil, c, -0.6, 0.35, z, 0.06, 0.9, 0.06, 0, 0, -1.0)])]), 0.7, 0.6];
  FORMAS.serpiente = c => [fusionar([parte(GEO.cil, c, 0, 0.12, 0, 0.22, 2.4, 0.22, 1.57, 0, 0), parte(GEO.esf, c, 0, 0.18, 1.25, 0.34, 0.24, 0.42)]), 0.35, 0.4];
  FORMAS.golem = c => [geoHumanoide("#8a847a", "#6a665e"), 2.4, 0.6]; FORMAS.yeti = c => [geoHumanoide("#f0f4f8", "#9ab0c8"), 2.3, 0.6]; FORMAS.momia = FORMAS.zombie;
  FORMAS.goblin = c => [geoHumanoide("#6a4a2a", "#8ab04a"), 1.2, 0.35]; FORMAS.orco = c => [geoHumanoide("#5a3a22", "#6f9a4a"), 2.1, 0.5]; FORMAS.caballero = c => [geoHumanoide("#3a3a44", "#f1c9a5", { casco: "#3a3a44" }), 1.9, 0.45];
  FORMAS.vampiro = FORMAS.demonio; FORMAS.perro = FORMAS.zorro; FORMAS.gato = FORMAS.zorro; FORMAS.toro = FORMAS.oso; FORMAS.llama = FORMAS.lobo; FORMAS.ciervo = FORMAS.lobo;
  const VUELAN = new Set(["condor", "cuervo", "murcielago", "dron", "abeja", "fantasma"]);
  const RE_MANO = /(right.?hand|hand.?r$|handr$|r.?hand$|hand_r|wrist.?r|mano.?d)/i;
  function Personaje(rol, forma, color, altura, rolAlterno) {
    const obj = new THREE.Group(); const info = { grupo: obj, mixer: null, acciones: {}, actual: null, mano: null, modelo: null };
    const proc = () => { const f = (FORMAS[forma] || FORMAS.slime)(color); const m = new THREE.Mesh(f[0], matCuerpo); m.castShadow = !!Q.sombras; obj.add(m); info.malla = m; info.altura = f[1] * (altura / (f[1] || 1)); info.radio = f[2] * (altura / (f[1] || 1)); m.scale.setScalar(altura / (f[1] || 1)); info.vuela = VUELAN.has(forma) || !!f[3]; };
    const cargar = r => NK.cargarGLB(r).then(g => g || (rolAlterno && r !== rolAlterno ? NK.cargarGLB(rolAlterno) : null));
    info.listo = cargar(rol).then(gltf => {
      if (!gltf) { proc(); return info; }
      const src = gltf.scene, clon = THREE.SkeletonUtils ? THREE.SkeletonUtils.clone(src) : src.clone(true);
      const box = new THREE.Box3().setFromObject(src), tam = box.getSize(new V3()); const k = altura / Math.max(0.01, tam.y);
      clon.scale.setScalar(k); clon.position.set(-(box.min.x + box.max.x) / 2 * k, -box.min.y * k, -(box.min.z + box.max.z) / 2 * k);
      clon.traverse(o => { if (o.isMesh) { o.castShadow = !!Q.sombras; o.frustumCulled = false; if (o.material && o.material.isMeshStandardMaterial) o.material.envMapIntensity = 0.9; }
        if (o.isBone && !info.mano && RE_MANO.test(o.name)) info.mano = o; });
      obj.add(clon); info.modelo = clon; info.altura = altura; info.radio = Math.max(0.35, Math.min(tam.x, tam.z) * k * 0.45); info.vuela = VUELAN.has(forma);
      if (gltf.animations && gltf.animations.length) {
        info.mixer = new THREE.AnimationMixer(clon);
        const busca = rx => gltf.animations.find(a => rx.test(a.name));
        const mapa = { quieto: busca(/idle|stand|breath|quiet/i), caminar: busca(/walk|fly/i), correr: busca(/run|sprint|gallop/i) || busca(/walk/i), atacar: busca(/attack|punch|slash|sword|bite/i),
          disparar: busca(/shoot|fire|gun/i), magia: busca(/cast|spell|magic/i), saltar: busca(/jump/i), morir: busca(/death|die|dead/i), golpe: busca(/hit|hurt|damage|react/i), hablar: busca(/talk|wave|greet/i) };
        for (const k2 in mapa) if (mapa[k2]) { const a = info.mixer.clipAction(mapa[k2]); if (/^(atacar|disparar|magia|morir|golpe)$/.test(k2)) { a.setLoop(THREE.LoopOnce); a.clampWhenFinished = true; } info.acciones[k2] = a; }
        if (!info.acciones.quieto) info.acciones.quieto = info.mixer.clipAction(gltf.animations[0]);
        info.acciones.quieto.play(); info.actual = "quieto";
      }
      return info;
    });
    info.anim = (nombre, forzar) => { if (!info.mixer) return; const a = info.acciones[nombre] || (nombre === "disparar" || nombre === "magia" ? info.acciones.atacar : null) || info.acciones.quieto;
      if (!a || (info.actual === nombre && !forzar)) return; const prev = info.acciones[info.actual]; a.reset().play(); if (prev && prev !== a) a.crossFadeFrom(prev, 0.18, false); info.actual = nombre; };
    return info;
  }

  /* ───────── Jugador ───────── */
  const VEHICULO = CARRERA;
  const jug = { pos: new V3(0, 5, 0), vel: new V3(), yaw: 0, enSuelo: false, vida: C.jugador.vida, vidaMax: C.jugador.vida, puntos: 0, invul: 0, turbo: 0, velAuto: 0, ultimaPlat: null,
    ataque: 0, anim: 0, paso: 0, vuelta: 0, cp: 0, progreso: 0, saltos: 0, inmovil: 0, lento: 1, resbala: 0, escudo: 0, furia: 0, iman: 0, mult: { vida: 1, vel: 1, salto: 1, danio: 1, cad: 1, alc: 1 } };
  FORMAS.humano = c => [geoHumanoide(c, "#f1c9a5", { casco: C.tema === "medieval" ? "#9aa3ad" : null }), 1.8, 0.4];
  const grupoJ = new THREE.Group(); escena.add(grupoJ);
  const modelosJ = {}; let PJ = null;
  function modeloJugador(rol, color) {
    if (!modelosJ[rol]) { const p = Personaje(rol, VEHICULO ? "auto" : "humano", color || C.jugador.color, VEHICULO ? 1.4 : 1.8, "jugador"); modelosJ[rol] = p; p.grupo.visible = false; grupoJ.add(p.grupo); }
    return modelosJ[rol];
  }
  PJ = modeloJugador("jugador"); PJ.grupo.visible = true;

  /* ───────── Armas: modelos (tuyos, creados por Noviq o del motor) y proyectiles ───────── */
  const ARMAS = (CAMP && CAMP.armas && CAMP.armas.length) ? CAMP.armas : (C.jugador.arma === "espada" ? [{ id: "espada", nombre: "Espada", tipo: "cuerpo", danio: 20, alcance: 2.6, cadencia: 0.35 }]
    : C.jugador.arma === "disparo" ? [{ id: "pistola", nombre: "Disparo", tipo: "disparo", proyectil: "bala", danio: 15, alcance: 40, cadencia: 0.16 }] : []);
  let armaAct = ARMAS[0] || null;
  const modelosArma = {};
  function geoArmaMotor(a) {
    const p = a.plantilla || a.id || "";
    if (a.tipo === "disparo" && /arco|ballesta/.test(p)) return fusionar([parte(GEO.cil, "#6b4a2b", 0, 0, 0, 0.04, 1.1, 0.04, 0, 0, 0), parte(GEO.cil, "#eee", 0, 0, -0.18, 0.01, 1.0, 0.01)]);
    if (a.tipo === "disparo" && /tirachinas/.test(p)) return fusionar([parte(GEO.cil, "#6b4a2b", 0, -0.08, 0, 0.04, 0.2, 0.04), parte(GEO.cil, "#6b4a2b", 0.05, 0.06, 0, 0.03, 0.16, 0.03, 0, 0, -0.5), parte(GEO.cil, "#6b4a2b", -0.05, 0.06, 0, 0.03, 0.16, 0.03, 0, 0, 0.5)]);
    if (a.tipo === "disparo") return fusionar([parte(GEO.box, "#2f3338", 0, 0, 0.15, 0.1, 0.13, 0.46), parte(GEO.box, "#2f3338", 0, -0.12, 0, 0.09, 0.2, 0.09)]);
    if (a.tipo === "magia") return fusionar([parte(GEO.cil, "#5a3a22", 0, 0, 0.3, 0.05, 1.2, 0.05, Math.PI / 2, 0, 0), parte(GEO.oct, "#b89fff", 0, 0, 0.95, 0.18, 0.18, 0.18)]);
    if (/hacha/.test(p)) return fusionar([parte(GEO.cil, "#6b4a2b", 0, 0, 0.3, 0.05, 0.8, 0.05, Math.PI / 2, 0, 0), parte(GEO.box, "#cfd5dc", 0, 0.1, 0.62, 0.03, 0.26, 0.16)]);
    return fusionar([parte(GEO.box, "#d8dde3", 0, 0, 0.5, 0.03, 0.07, 0.85), parte(GEO.box, "#c9a64a", 0, 0, 0.06, 0.05, 0.24, 0.05), parte(GEO.cil, "#5a3d22", 0, 0, -0.06, 0.06, 0.22, 0.06, Math.PI / 2, 0, 0)]);
  }
  function modeloArma(a) {
    if (!a) return Promise.resolve(null);
    if (modelosArma[a.id]) return Promise.resolve(modelosArma[a.id]);
    const rol = a.modelo || ("arma_" + a.id);
    return NK.cargarGLB(rol).then(g => g || NK.cargarGLB("arma")).then(gltf => {
      const piv = new THREE.Group(), orient = new THREE.Group(); piv.add(orient);
      if (gltf) { const m = gltf.scene.clone(true); m.traverse(o => { if (o.isMesh) { o.castShadow = !!Q.sombras; o.frustumCulled = false; } }); orient.add(m);
        const box = new THREE.Box3().setFromObject(m), largo = box.getSize(new V3()).length(); if (largo > 3.5) m.scale.setScalar(1.6 / largo); }
      else { const m = new THREE.Mesh(geoArmaMotor(a), matCuerpo); m.castShadow = !!Q.sombras; orient.add(m); }
      if (a.tipo === "disparo") orient.rotation.x = Math.PI / 2;  // el cañón apunta como el brazo (así al disparar apunta al frente)
      piv.visible = false; modelosArma[a.id] = piv; return piv;
    });
  }
  function equiparArma(a) {
    armaAct = a || null;
    for (const k in modelosArma) { const m = modelosArma[k]; if (m.parent) m.parent.remove(m); m.visible = false; }
    if (!a || VEHICULO) { (NK.ui || {}).arma && NK.ui.arma(null); return; }
    modeloArma(a).then(piv => {
      if (!piv || armaAct !== a) return;
      if (PJ.mano) { PJ.mano.add(piv); PJ.mano.updateMatrixWorld(true); const ws = PJ.mano.getWorldScale(tmpV); piv.scale.setScalar(1 / Math.max(0.001, ws.x)); piv.position.set(0, 0, 0); }
      else { PJ.grupo.add(piv); piv.scale.setScalar(1); piv.position.set(0.42, 0.95, 0.12); }
      piv.visible = true;
    });
    if ((NK.ui || {}).arma) NK.ui.arma(a, TR.activa ? TR.armasDisponibles().length : ARMAS.length);
  }
  // proyectiles (del jugador y del jefe) — pool
  const PROY = { bala: { geo: new THREE.SphereGeometry(0.09, 8, 6), color: 0xffe27a, vel: 70, g: 0, esc: [1, 1, 2.5] }, flecha: { geo: new THREE.CylinderGeometry(0.02, 0.02, 0.8, 5).rotateX(Math.PI / 2), color: 0xd8c8a0, vel: 42, g: 7 },
    piedra: { geo: GEO.roca, color: 0x9a948a, vel: 34, g: 9, esc: [0.28, 0.24, 0.28] }, fuego: { geo: new THREE.SphereGeometry(0.22, 10, 8), color: 0xff7a1a, vel: 30, g: 0 },
    magia: { geo: new THREE.IcosahedronGeometry(0.2, 1), color: 0xb87aff, vel: 24, g: 0 }, laser: { geo: new THREE.CylinderGeometry(0.05, 0.05, 1.2, 6).rotateX(Math.PI / 2), color: 0x3bffe8, vel: 80, g: 0 },
    enemigo: { geo: new THREE.SphereGeometry(0.34, 12, 10), color: 0xff3a5a, vel: 16, g: 0 } };
  const matProy = {}; for (const k in PROY) matProy[k] = new THREE.MeshBasicMaterial({ color: PROY[k].color, toneMapped: false });
  const proys = [];
  for (let i = 0; i < 60; i++) { const m = new THREE.Mesh(PROY.bala.geo, matProy.bala); m.visible = false; m.frustumCulled = false; escena.add(m); proys.push({ m, vel: new V3(), vida: 0, tipo: "bala", danio: 0, deJugador: true, objetivo: null }); }
  function disparar(tipo, desde, dir, danio, deJugador, objetivo) {
    const p = proys.find(x => x.vida <= 0); if (!p) return; const d = PROY[tipo] || PROY.bala;
    p.tipo = tipo; p.m.geometry = d.geo; p.m.material = matProy[tipo] || matProy.bala; p.m.position.copy(desde); p.vel.copy(dir).normalize().multiplyScalar(d.vel);
    p.vida = deJugador ? 2.2 : 5; p.danio = danio; p.deJugador = deJugador; p.objetivo = objetivo || null; p.m.visible = true;
    const e = d.esc || [1, 1, 1]; p.m.scale.set(e[0], e[1], e[2]); p.m.lookAt(tmpV.copy(desde).add(dir));
  }

  /* ───────── Enemigos (pool por tipo; cada zona decide cuántos y cuáles) ───────── */
  const enemigos = [];
  const tiposEnemigo = (C.enemigos || []);
  const ALTURA_E = { dinosaurio: 2.6, robot: 2.2, fantasma: 2, condor: 1, cuervo: 0.6, murcielago: 0.55, dron: 0.6, abeja: 0.6, cangrejo: 0.8, slime: 1, escorpion: 1.1, zorro: 1,
    lobo: 1.3, arana: 0.8, serpiente: 0.45, calabaza: 0.9, golem: 2.4, yeti: 2.3, oso: 1.6, jabali: 1.0, goblin: 1.2, orco: 2.1 };
  function maxPorTipo(ti) {
    let m = 0; ZONAS.forEach(z => (z.enemigos || []).forEach(e => { if (e.ref === ti) m = Math.max(m, e.cantidad || 0); }));
    if (!CAMP) m = Math.max(m, Math.round(((tiposEnemigo[ti] || {}).cantidad || 0) * ((C.objetivo || {}).tipo === "sobrevivir" ? 1.6 : 1)));
    return Math.min(Q.nivel === "basico" ? 8 : 14, m + (CAMP ? 4 : 0));
  }
  tiposEnemigo.forEach((e, ti) => {
    const n = maxPorTipo(ti);
    for (let i = 0; i < n; i++) {
      const alt = ALTURA_E[e.forma] || (e.comportamiento === "rival" ? 1.4 : 1.8);
      const pj = Personaje(e.modelo || (ti === 0 ? "enemigo" : `enemigo${ti + 1}`), e.comportamiento === "rival" ? "auto" : e.forma, e.color || "#8a5aff", alt);
      pj.grupo.visible = false; escena.add(pj.grupo);
      enemigos.push({ tipo: ti, cfg: e, pj, activo: false, pos: new V3(), vel: new V3(), yaw: 0, vida: e.vida || 30, cd: 0, estado: "patrullar", destino: new V3(), casa: new V3(), muriendo: 0, golpe: 0,
        t: rnd() * 10, pista: 0, vuelta: 0, carril: (i % 3 - 1) * 3, zona: 0, ladron: false, robado: 0, jefe: false });
    }
  });
  // jefe final
  const JEFE_CFG = CAMP && CAMP.jefe ? CAMP.jefe : null;
  let jefe = null;
  if (JEFE_CFG) {
    const pj = Personaje("jefe", JEFE_CFG.forma || "humano", "#8a1f1f", JEFE_CFG.altura || 4.2);
    pj.grupo.visible = false; escena.add(pj.grupo);
    jefe = { cfg: Object.assign({ nombre: JEFE_CFG.nombre, vida: JEFE_CFG.vida || 600, danio: JEFE_CFG.danio || 18, velocidad: JEFE_CFG.velocidad || 3.4, comportamiento: "jefe", forma: JEFE_CFG.forma }, {}),
      pj, activo: false, pos: new V3(), vel: new V3(), yaw: 0, vida: 0, vidaMax: JEFE_CFG.vida || 600, cd: 2, fase: 0, hab: 0, carga: null, muriendo: 0, golpe: 0, t: 0, jefe: true, presentado: false,
      onda: null, salto: null };
  }
  // anillo de la onda expansiva y marca de caída del jefe (reutilizables)
  const ondaMalla = new THREE.Mesh(new THREE.RingGeometry(0.85, 1, 48).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0xff5a3a, transparent: true, opacity: 0.8, side: THREE.DoubleSide, depthWrite: false }));
  ondaMalla.visible = false; escena.add(ondaMalla);
  const marca = new THREE.Mesh(new THREE.CircleGeometry(1, 32).rotateX(-Math.PI / 2), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.45, depthWrite: false }));
  marca.visible = false; escena.add(marca);

  /* ───────── Guías (NPC) con diálogos ───────── */
  const npcs = [];
  ZONAS.forEach((z, zi) => {
    if (!z.npc || !camino) return;
    const pj = Personaje(z.npc.modelo || "npc", "humano", "#6a8a5a", 1.8); escena.add(pj.grupo);
    const i = camino.limites[zi].ini + 5; puntoCamino(i, 3.6, tmpV3); const y = sueloEn(tmpV3.x, tmpV3.z).h;
    pj.grupo.position.set(tmpV3.x, y, tmpV3.z);
    const marcador = new THREE.Mesh(GEO.oct, new THREE.MeshBasicMaterial({ color: 0xffd23f, toneMapped: false })); marcador.scale.set(0.28, 0.5, 0.28); marcador.position.set(tmpV3.x, y + 2.4, tmpV3.z); escena.add(marcador);
    choques.push({ x: tmpV3.x, z: tmpV3.z, r: 0.6 });
    npcs.push({ zona: zi, cfg: z.npc, pj, pos: new V3(tmpV3.x, y, tmpV3.z), marcador, hablado: false });
  });

  /* ───────── Coleccionables (InstancedMesh animado) ───────── */
  const estrellaGeo = (() => { const s = new THREE.Shape(); for (let i = 0; i < 10; i++) { const r = i % 2 ? 0.22 : 0.5, a = i / 10 * Math.PI * 2 + Math.PI / 2; i ? s.lineTo(Math.cos(a) * r, Math.sin(a) * r) : s.moveTo(Math.cos(a) * r, Math.sin(a) * r); } const g = new THREE.ExtrudeGeometry(s, { depth: 0.16, bevelEnabled: false }); g.translate(0, 0, -0.08); return g; })();
  const FORMA_OBJ = {
    gema: c => fusionar([parte(GEO.oct, c, 0, 0, 0, 0.7, 1, 0.7)]), cristal: c => fusionar([parte(GEO.oct, c, 0, 0, 0, 0.5, 1.2, 0.5)]),
    moneda: c => fusionar([parte(GEO.cil, c, 0, 0, 0, 0.8, 0.12, 0.8, Math.PI / 2, 0, 0), parte(GEO.cil, oscuro(c, 0.8), 0, 0, 0, 0.55, 0.14, 0.55, Math.PI / 2, 0, 0)]),
    estrella: c => fusionar([parte(estrellaGeo, c)]), fruta: c => fusionar([parte(GEO.esf, c, 0, 0, 0, 0.7, 0.7, 0.7), parte(GEO.cono, "#3f8f3a", 0.1, 0.4, 0, 0.12, 0.25, 0.3, 0, 0, -0.6)]),
    llave: c => fusionar([parte(new THREE.TorusGeometry(0.22, 0.07, 6, 12), c, 0, 0.3, 0), parte(GEO.box, c, 0, -0.15, 0, 0.1, 0.6, 0.08), parte(GEO.box, c, 0.1, -0.35, 0, 0.18, 0.08, 0.08)]),
    huevo: c => fusionar([parte(GEO.esf, c, 0, 0, 0, 0.55, 0.75, 0.55)]),
    botiquin: c => fusionar([parte(GEO.box, "#f5f5f5", 0, 0, 0, 0.8, 0.6, 0.35), parte(GEO.box, c, 0, 0, 0.18, 0.5, 0.14, 0.02), parte(GEO.box, c, 0, 0, 0.18, 0.14, 0.44, 0.02)]),
    cofre: c => fusionar([parte(GEO.box, "#8a5a2b", 0, -0.12, 0, 1, 0.55, 0.65), parte(GEO.box, "#a0703a", 0, 0.24, 0, 1.02, 0.22, 0.67), parte(GEO.box, c, 0, 0.05, 0.335, 0.2, 0.22, 0.03), parte(GEO.box, c, 0, 0.05, 0, 1.05, 0.08, 0.7)]),
    calabaza: c => fusionar([parte(GEO.esf, c, 0, 0, 0, 1, 0.75, 1), parte(GEO.cil, "#4a7a2a", 0, 0.42, 0, 0.1, 0.25, 0.1)])
  };
  const objetos = [], conjuntosObj = [];
  function cantidadObjetos(oi) {
    if (!CAMP) return Math.max(0, Math.round((C.objetos[oi] || {}).cantidad || 0));
    if (oi === 0) return ZONAS.reduce((s, z) => s + (z.objetivo.tipo === "recolectar" ? z.objetivo.cantidad : 0), 0) || Math.min(12, (C.objetos[0] || {}).cantidad || 0);
    return Math.min(8, Math.round((C.objetos[oi] || {}).cantidad || 0));
  }
  function prepararObjetos() {
    (C.objetos || []).forEach((o, oi) => {
      const n = cantidadObjetos(oi); if (!n) return;
      cargas.push(NK.cargarGLB(o.modelo || "coleccionable").then(gltf => {
        let piezas;
        if (gltf) piezas = piezasGLTF(gltf, 1.1).piezas;
        if (!piezas || !piezas.length) { const color = o.color || "#ffd23f", g = (FORMA_OBJ[o.forma] || FORMA_OBJ.gema)(color);
          const m = new THREE.MeshStandardMaterial({ vertexColors: true, emissive: lin(color).multiplyScalar(0.35), roughness: 0.3, metalness: o.forma === "moneda" ? 0.7 : 0.1 });
          piezas = [{ geo: g, mat: m, m: new THREE.Matrix4() }]; }
        const cj = new Conjunto(piezas, n, !!Q.sombras); conjuntosObj[oi] = cj;
        for (let i = 0; i < n; i++) objetos.push({ tipo: oi, cfg: o, i, cj, pos: new V3(), activo: false, fase: rnd() * 6, zona: 0 });
      }));
    });
  }
  function colocarObjetos(soloZona) {
    const porTipo = {};
    objetos.forEach(ob => { (porTipo[ob.tipo] = porTipo[ob.tipo] || []).push(ob); });
    for (const k in porTipo) {
      // reparto por zona: cada zona recibe lo que pide su objetivo (el resto va a cualquier zona)
      const asign = []; if (CAMP && +k === 0) ZONAS.forEach((z, zi) => { if (z.objetivo.tipo === "recolectar") for (let q = 0; q < z.objetivo.cantidad; q++) asign.push(zi); });
      porTipo[k].forEach((ob, j) => {
        const zi = asign[j] != null ? asign[j] : (CAMP ? Math.floor(rnd() * Math.max(1, NZ - 1)) : 0);
        if (soloZona != null && zi !== soloZona) return;
        ob.zona = zi; let L = null;
        const platZ = plataformas.filter(p => !camino || p.zona === zi);
        if (PLATAF && platZ.length > 1) { const p = platZ[1 + (j * 3 + ob.tipo) % (platZ.length - 1)]; L = { x: p.x + (rnd() - 0.5) * p.w * 0.5, z: p.z + (rnd() - 0.5) * p.d * 0.5, y: p.y, plat: p }; }
        else if (pista) { const s = pista.muestras[Math.floor((j + 0.5) / porTipo[k].length * pista.N) % pista.N]; L = { x: s.x + (rnd() - 0.5) * 5, z: s.z + (rnd() - 0.5) * 5 }; L.y = alturaGrid(L.x, L.z); }
        else if (camino) L = lugarEnZona(zi, 0.8, 1.5, 16, 4) || lugarEnZona(zi, 0.5, 0, 10, 2) || { x: camino.muestras[camino.limites[zi].ini + 8].x, z: camino.muestras[camino.limites[zi].ini + 8].z };
        else L = lugarLibre(0.8, 8, MITAD * 0.8) || { x: (rnd() - 0.5) * S * 0.6, z: (rnd() - 0.5) * S * 0.6 };
        if (L.y === undefined) L.y = alturaGrid(L.x, L.z);
        ob.pos.set(L.x, L.y + 1.1, L.z); ob.plat = L.plat || null; ob.activo = true;
      });
    }
  }
  function dibujarObjetos(t) {
    for (const ob of objetos) { if (ob.activo) ob.cj.fijar(ob.i, ob.pos.x, ob.pos.y + Math.sin(t * 2 + ob.fase) * 0.2, ob.pos.z, t * 1.6 + ob.fase, 1); else ob.cj.fijar(ob.i, 0, -999, 0, 0, 0.0001); }
    conjuntosObj.forEach(cj => cj && cj.listo());
  }

  /* ───────── Potenciadores (imán, escudo, turbo, curación, vida extra, furia) ───────── */
  const POT = { curacion: 0xff4a6a, iman: 0x3aa0ff, escudo: 0x8affff, turbo: 0xffe23a, vida_extra: 0x3fdc2b, furia: 0xff5a1a };
  const potes = [];
  const imPot = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(0.42, 1), new THREE.MeshStandardMaterial({ roughness: 0.2, metalness: 0.1, emissive: 0x333333 }), 24);
  const imAro = new THREE.InstancedMesh(new THREE.TorusGeometry(0.62, 0.05, 6, 24), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false }), 24);
  imPot.frustumCulled = imAro.frustumCulled = false; escena.add(imPot); escena.add(imAro);
  function colocarPotenciadores() {
    potes.length = 0;
    if (!camino) { ["curacion", "turbo", "escudo"].forEach(t => { const L = lugarLibre(0.8, 10, MITAD * 0.7); if (L) potes.push({ tipo: t, pos: new V3(L.x, L.y + 1.2, L.z), activo: true }); }); }
    else ZONAS.forEach((z, zi) => (z.potenciadores || []).slice(0, 3).forEach(t => { if (!POT[t] || potes.length >= 24) return; const L = lugarEnZona(zi, 0.6, 0, 8, 8); if (L) potes.push({ tipo: t, pos: new V3(L.x, L.y + 1.2, L.z), activo: true, zona: zi }); }));
    potes.forEach((p, i) => { imPot.setColorAt(i, tmpC.setHex(POT[p.tipo])); });
    imPot.count = imAro.count = potes.length; if (imPot.instanceColor) imPot.instanceColor.needsUpdate = true;
  }
  function dibujarPotenciadores(t) {
    potes.forEach((p, i) => { const y = p.activo ? p.pos.y + Math.sin(t * 2.4 + i) * 0.18 : -999;
      tmpQ.setFromEuler(tmpE.set(0, t * 1.5, 0)); tmpM.compose(tmpV.set(p.pos.x, y, p.pos.z), tmpQ, tmpS.set(1, 1, 1)); imPot.setMatrixAt(i, tmpM);
      tmpQ.setFromEuler(tmpE.set(Math.PI / 2 + Math.sin(t + i) * 0.3, 0, t)); tmpM.compose(tmpV.set(p.pos.x, y, p.pos.z), tmpQ, tmpS.set(1, 1, 1)); imAro.setMatrixAt(i, tmpM); });
    imPot.instanceMatrix.needsUpdate = true; imAro.instanceMatrix.needsUpdate = true;
  }
  const escudoMalla = new THREE.Mesh(new THREE.SphereGeometry(1.2, 20, 14), new THREE.MeshBasicMaterial({ color: 0x8affff, transparent: true, opacity: 0.22, depthWrite: false, toneMapped: false }));
  escudoMalla.visible = false; escena.add(escudoMalla);

  /* ───────── Partículas (chispas, fuego, magia) y clima (lluvia/nieve) ───────── */
  const NP = ULTRA ? 700 : ALTO ? 480 : 260, pPos = new Float32Array(NP * 3), pCol = new Float32Array(NP * 3), parts = [];
  const gP = new THREE.BufferGeometry(); gP.setAttribute("position", new THREE.BufferAttribute(pPos, 3)); gP.setAttribute("color", new THREE.BufferAttribute(pCol, 3));
  const puntosP = new THREE.Points(gP, new THREE.PointsMaterial({ size: 0.26, vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false }));
  puntosP.frustumCulled = false; escena.add(puntosP);
  for (let i = 0; i < NP; i++) { parts.push({ v: new V3(), vida: 0, g: 12 }); pPos[i * 3 + 1] = -999; }
  let pSig = 0;
  function explosion(p, color, n = 18, fuerza = 5, grav = 12) { const c = lin(color); for (let k = 0; k < n; k++) { const i = pSig++ % NP, q = parts[i]; q.vida = 0.6 + rnd() * 0.5; q.g = grav;
    q.v.set((rnd() - 0.5) * fuerza, rnd() * fuerza, (rnd() - 0.5) * fuerza); pPos[i * 3] = p.x; pPos[i * 3 + 1] = p.y; pPos[i * 3 + 2] = p.z; pCol[i * 3] = c.r; pCol[i * 3 + 1] = c.g; pCol[i * 3 + 2] = c.b; } }
  function actualizarParticulas(dt) { for (let i = 0; i < NP; i++) { const q = parts[i]; if (q.vida <= 0) continue; q.vida -= dt; q.v.y -= q.g * dt; pPos[i * 3] += q.v.x * dt; pPos[i * 3 + 1] += q.v.y * dt; pPos[i * 3 + 2] += q.v.z * dt; if (q.vida <= 0) pPos[i * 3 + 1] = -999; }
    gP.attributes.position.needsUpdate = true; gP.attributes.color.needsUpdate = true; }
  const NLL = Math.round(2600 * Q.densidad), posLL = new Float32Array(NLL * 3); for (let i = 0; i < NLL * 3; i++) posLL[i] = (rnd() - 0.5) * 60;
  const gLL = new THREE.BufferGeometry(); gLL.setAttribute("position", new THREE.BufferAttribute(posLL, 3));
  const lluvia = new THREE.Points(gLL, new THREE.PointsMaterial({ color: 0xaac4e8, size: 0.09, transparent: true, opacity: 0.75, depthWrite: false })); lluvia.frustumCulled = false; lluvia.visible = false; escena.add(lluvia);
  let relampago = 0;

  /* ───────── Obstáculos de cada zona ───────── */
  const obst = [];
  const matMetal = new THREE.MeshStandardMaterial({ color: 0xb8bec6, roughness: 0.35, metalness: 0.85 }), matMadera = new THREE.MeshStandardMaterial({ color: lin("#6b4a2b"), roughness: 0.85 });
  const matFuego = new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent: true, opacity: 0.85, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false });
  const matLodo = new THREE.MeshStandardMaterial({ color: lin("#3f2c1c"), roughness: 0.15, metalness: 0.05, transparent: true, opacity: 0.92, polygonOffset: true, polygonOffsetFactor: -3 });
  const matHielo = new THREE.MeshStandardMaterial({ color: lin("#cfeeff"), roughness: 0.05, metalness: 0.1, transparent: true, opacity: 0.8, polygonOffset: true, polygonOffsetFactor: -3 });
  const matZarza = new THREE.MeshStandardMaterial({ color: lin("#3a2a1e"), roughness: 0.9 });
  const geoPinchos = fusionar([parte(GEO.box, "#4a4a4e", 0, 0.04, 0, 1.8, 0.08, 1.8), ...Array.from({ length: 16 }, (_, k) => parte(GEO.cono, "#c0c6ce", -0.66 + (k % 4) * 0.44, 0.35, -0.66 + Math.floor(k / 4) * 0.44, 0.16, 0.6, 0.16))]);
  const geoTronco = new THREE.CylinderGeometry(0.45, 0.45, 3.2, 14).rotateZ(Math.PI / 2);
  const geoDisco = (r, seg = 24) => { const g = new THREE.CircleGeometry(r, seg); g.rotateX(-Math.PI / 2); return g; };
  function decal(x, z, r, mat) { const g = geoDisco(r, 28), p = g.attributes.position; for (let i = 0; i < p.count; i++) p.setY(i, alturaGrid(x + p.getX(i), z + p.getZ(i)) + 0.06);
    const m = new THREE.Mesh(g, mat); m.position.set(x, 0, z); m.receiveShadow = !!Q.sombras; escena.add(m); return m; }
  function crearObstaculo(tipo, zi, L) {
    const o = { tipo, zona: zi, pos: new V3(L.x, L.y, L.z), t: rnd() * 3, cd: 0, estado: 0, malla: null };
    switch (tipo) {
      case "pinchos": o.malla = new THREE.Mesh(geoPinchos, matCuerpo); o.malla.position.copy(o.pos); o.malla.castShadow = !!Q.sombras; escena.add(o.malla); o.r = 1.1; break;
      case "tronco": { const i0 = L.i || 0; o.a = Math.max(0, i0 - 4); o.b = Math.min(camino ? camino.N : 0, i0 + 6); o.u = rnd(); o.dir = 1; o.malla = new THREE.Mesh(geoTronco, matMadera); o.malla.castShadow = !!Q.sombras; escena.add(o.malla); o.r = 1.2; break; }
      case "lodo": o.malla = decal(L.x, L.z, 2.8, matLodo); o.r = 2.8; break;
      case "hielo": o.malla = decal(L.x, L.z, 3.4, matHielo); o.r = 3.4; break;
      case "fuego": { o.malla = new THREE.Group(); o.malla.position.copy(o.pos); for (let k = 0; k < 5; k++) { const f = new THREE.Mesh(GEO.cono, matFuego); f.position.set((rnd() - 0.5) * 1.8, 0.5, (rnd() - 0.5) * 1.8); f.scale.set(0.6, 1.2, 0.6); o.malla.add(f); }
        escena.add(o.malla); decal(L.x, L.z, 1.8, new THREE.MeshStandardMaterial({ color: 0x1a1210, roughness: 1, polygonOffset: true, polygonOffsetFactor: -3 })); o.r = 1.6; break; }
      case "rocas": o.r = 7; o.malla = null; break;
      case "pendulo": { const g = new THREE.Group(); g.position.copy(o.pos); const ang = camino ? Math.atan2(camino.tang[NK.clamp(Math.round(L.i || 0), 0, camino.N)].x, camino.tang[NK.clamp(Math.round(L.i || 0), 0, camino.N)].z) : 0;
        g.rotation.y = ang + Math.PI / 2; for (const s of [-1, 1]) { const p = new THREE.Mesh(GEO.box, matMadera); p.scale.set(0.3, 5.5, 0.3); p.position.set(s * 2.4, 2.75, 0); p.castShadow = !!Q.sombras; g.add(p); }
        const tv = new THREE.Mesh(GEO.box, matMadera); tv.scale.set(5.2, 0.3, 0.3); tv.position.y = 5.5; g.add(tv);
        const piv = new THREE.Group(); piv.position.y = 5.4; g.add(piv); const cad = new THREE.Mesh(GEO.cil, matMetal); cad.scale.set(0.06, 3.6, 0.06); cad.position.y = -1.8; piv.add(cad);
        const hoja = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 0.9, 0.08, 20, 1, false, 0, Math.PI).rotateX(Math.PI / 2).rotateZ(Math.PI / 2), matMetal); hoja.position.y = -3.8; hoja.castShadow = !!Q.sombras; piv.add(hoja);
        escena.add(g); o.malla = g; o.piv = piv; o.r = 1.3; o.ang = ang; break; }
      case "trampa": { const g = new THREE.Group(); g.position.copy(o.pos); const base = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.45, 0.05, 18), matMetal); base.position.y = 0.03; g.add(base);
        o.mandibulas = []; for (const s of [-1, 1]) { const q = new THREE.Group(); const aro = new THREE.Mesh(new THREE.TorusGeometry(0.4, 0.03, 5, 16, Math.PI), matMetal); aro.rotation.x = s > 0 ? 0 : Math.PI; q.add(aro); q.position.y = 0.05; q.rotation.x = s * 1.35; g.add(q); o.mandibulas.push(q); }
        escena.add(g); o.malla = g; o.r = 0.75; break; }
      case "zarzas": { const g = new THREE.Group(); g.position.copy(o.pos); for (let k = 0; k < 9; k++) { const r = new THREE.Mesh(GEO.cono, matZarza); const a = rnd() * 6.28; r.position.set(Math.cos(a) * rnd() * 1.4, 0.4, Math.sin(a) * rnd() * 1.4);
        r.scale.set(0.12, 0.9 + rnd() * 0.6, 0.12); r.rotation.set((rnd() - 0.5) * 1.2, 0, (rnd() - 0.5) * 1.2); g.add(r); } escena.add(g); o.malla = g; o.r = 1.8; break; }
      default: return null;
    }
    obst.push(o); return o;
  }
  // rocas que caen (obstáculo «rocas» y contratiempo «derrumbe»): pool de 5
  const rocas = [];
  for (let k = 0; k < 5; k++) { const m = new THREE.Mesh(GEO.roca, new THREE.MeshStandardMaterial({ color: lin("#7a746c"), roughness: 0.95 })); m.scale.setScalar(1.3); m.visible = false; m.castShadow = !!Q.sombras; escena.add(m);
    const s = new THREE.Mesh(geoDisco(1, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.4, depthWrite: false })); s.visible = false; escena.add(s);
    rocas.push({ m, s, t: 0, activa: false, pos: new V3() }); }
  function soltarRoca(x, z) { const r = rocas.find(q => !q.activa); if (!r) return; r.activa = true; r.t = 1.3; r.pos.set(x, alturaGrid(x, z), z); r.m.visible = true; r.s.visible = true; r.s.position.set(x, r.pos.y + 0.07, z); }
  function colocarObstaculos() {
    if (!camino) return;
    ZONAS.forEach((z, zi) => (z.obstaculos || []).forEach((tipo, k) => {
      const n = tipo === "rocas" ? 1 : tipo === "pendulo" ? 2 : 3 + (z.dificultad > 1.3 ? 1 : 0);
      for (let q = 0; q < n; q++) { const lim = camino.limites[zi], i = lim.ini + 14 + (lim.fin - lim.ini - 24) * ((q + 0.5 + k * 0.37) / n % 1);
        const lat = tipo === "pendulo" || tipo === "tronco" ? 0 : (rnd() - 0.5) * 3; puntoCamino(i, lat, tmpV3);
        crearObstaculo(tipo, zi, { x: tmpV3.x, z: tmpV3.z, y: sueloEn(tmpV3.x, tmpV3.z).h, i }); }
    }));
  }

  /* ───────── Puntos de control (fogatas), miradores y puertas entre zonas ───────── */
  const hitos = { fogatas: [], miradores: [], puertas: [] };
  const matBarrera = new THREE.MeshBasicMaterial({ color: 0x8aff45, transparent: true, opacity: 0.35, side: THREE.DoubleSide, depthWrite: false, toneMapped: false });
  const matHaz = new THREE.MeshBasicMaterial({ color: 0xffe27a, transparent: true, opacity: 0.22, depthWrite: false, side: THREE.DoubleSide, toneMapped: false, blending: THREE.AdditiveBlending });
  function colocarHitos() {
    if (!camino) return;
    ZONAS.forEach((z, zi) => {
      const lim = camino.limites[zi];
      // punto de control al inicio de la zona
      puntoCamino(lim.ini + 2, -3.2, tmpV3); const yF = sueloEn(tmpV3.x, tmpV3.z).h;
      const fg = { zona: zi, pos: new V3(tmpV3.x, yF, tmpV3.z), respawn: puntoCamino(lim.ini + 3, 0, new V3()) }; fg.respawn.y = sueloEn(fg.respawn.x, fg.respawn.z).h;
      cargas.push(NK.cargarGLB("fogata").then(g => { let m; if (g) { m = g.scene.clone(true); const b = new THREE.Box3().setFromObject(m), k = 1.0 / Math.max(0.01, b.getSize(tmpV).y); m.scale.setScalar(k); }
        else { m = new THREE.Group(); for (let k = 0; k < 4; k++) { const l = new THREE.Mesh(GEO.cil, matMadera); l.scale.set(0.14, 1.1, 0.14); l.rotation.set(Math.PI / 2, k * Math.PI / 4, 0.5); l.position.y = 0.12; m.add(l); }
          const f = new THREE.Mesh(GEO.cono, matFuego); f.scale.set(0.6, 1.1, 0.6); f.position.y = 0.5; m.add(f); }
        m.position.copy(fg.pos); escena.add(m); fg.malla = m; }));
      choques.push({ x: fg.pos.x, z: fg.pos.z, r: 0.8 }); hitos.fogatas.push(fg);
      // mirador: roca alta junto al camino con un haz de luz dorado
      if (z.mirador) { const i = lim.ini + (lim.fin - lim.ini) * 0.55, lado = zi % 2 ? 1 : -1; puntoCamino(i, lado * 9, tmpV3);
        const y = alturaGrid(tmpV3.x, tmpV3.z); const base = new THREE.Mesh(GEO.roca, new THREE.MeshStandardMaterial({ color: lin("#8a847a"), roughness: 0.95 }));
        base.scale.set(4.4, 2.2, 4.4); base.position.set(tmpV3.x, y + 0.2, tmpV3.z); base.castShadow = base.receiveShadow = !!Q.sombras; escena.add(base);
        const haz = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.9, 40, 12, 1, true), matHaz); haz.position.set(tmpV3.x, y + 21, tmpV3.z); escena.add(haz);
        const est = new THREE.Mesh(GEO.oct, new THREE.MeshBasicMaterial({ color: 0xffe27a, toneMapped: false })); est.scale.set(0.35, 0.6, 0.35); est.position.set(tmpV3.x, y + 2.8, tmpV3.z); escena.add(est);
        hitos.miradores.push({ zona: zi, pos: new V3(tmpV3.x, y + 1.1, tmpV3.z), haz, est, visto: false, plat: { x: tmpV3.x, y: y + 1.1, z: tmpV3.z, w: 3.6, d: 3.6, fija: true } });
        plataformas.push(hitos.miradores[hitos.miradores.length - 1].plat); }
      // puerta al final (menos en la última zona): arco de piedra con una barrera de energía
      if (zi < NZ - 1) { const i = lim.fin; puntoCamino(i, 0, tmpV3); const y = alturaGrid(tmpV3.x, tmpV3.z); const t = camino.tang[i], ang = Math.atan2(t.x, t.z);
        const g = new THREE.Group(); g.position.set(tmpV3.x, y, tmpV3.z); g.rotation.y = ang;
        const piedra = new THREE.MeshStandardMaterial({ color: lin("#8a847a"), roughness: 0.92 });
        for (const s of [-1, 1]) { const col = new THREE.Mesh(GEO.box, piedra); col.scale.set(0.9, 5.4, 0.9); col.position.set(s * 3.1, 2.7, 0); col.castShadow = !!Q.sombras; g.add(col); }
        const din = new THREE.Mesh(GEO.box, piedra); din.scale.set(7.4, 0.9, 1.0); din.position.y = 5.6; din.castShadow = !!Q.sombras; g.add(din);
        const barrera = new THREE.Mesh(new THREE.PlaneGeometry(5.3, 5.2), matBarrera.clone()); barrera.position.y = 2.6; g.add(barrera);
        escena.add(g); hitos.puertas.push({ zona: zi, pos: new V3(tmpV3.x, y, tmpV3.z), g, barrera, abierta: false }); }
    });
  }
  // meta (objetivo «llegar» sin camino)
  let meta = null;
  function prepararMeta() {
    const g = new THREE.Group();
    const haz = new THREE.Mesh(new THREE.CylinderGeometry(1.2, 1.6, 30, 16, 1, true), new THREE.MeshBasicMaterial({ color: 0x8aff45, transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }));
    haz.position.y = 15; g.add(haz);
    const aro = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.18, 8, 32), new THREE.MeshBasicMaterial({ color: 0xffe27a })); aro.rotation.x = Math.PI / 2; aro.position.y = 0.3; g.add(aro);
    const mastil = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.08, 4, 6), new THREE.MeshStandardMaterial({ color: 0xdddddd, metalness: 0.6, roughness: 0.3 })); mastil.position.y = 2; g.add(mastil);
    const bandera = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 0.9), new THREE.MeshStandardMaterial({ color: 0xff3b3b, side: THREE.DoubleSide })); bandera.position.set(0.72, 3.5, 0); g.add(bandera);
    g.visible = false; escena.add(g); meta = { grupo: g, pos: new V3(), aro };
  }
  function colocarMeta(zi) {
    if (!meta) return;
    let p;
    if (camino) { const lim = camino.limites[zi]; const i = zi < NZ - 1 ? lim.fin - 3 : lim.fin - 2; puntoCamino(i, 0, tmpV3); p = new V3(tmpV3.x, sueloEn(tmpV3.x, tmpV3.z).h, tmpV3.z);
      if (PLATAF) { const pl = plataformas.filter(q => q.zona === zi && q.w >= 6).pop(); if (pl) { p.set(pl.x, pl.y, pl.z); meta.plat = pl; } } }
    else if (PLATAF && plataformas.length) { const u = plataformas[plataformas.length - 1]; p = new V3(u.x, u.y, u.z); meta.plat = u; }
    else { let best = null; for (let k = 0; k < 30; k++) { const L = lugarLibre(2, MITAD * 0.55, MITAD * 0.8); if (L && (!best || Math.hypot(L.x, L.z) > Math.hypot(best.x, best.z))) best = L; } best = best || { x: MITAD * 0.6, z: MITAD * 0.6, y: alturaGrid(MITAD * 0.6, MITAD * 0.6) }; p = new V3(best.x, best.y, best.z); }
    meta.pos.copy(p); meta.grupo.position.copy(p); meta.grupo.visible = true;
  }

  /* ───────── Estado de la partida y de la zona ───────── */
  const P = { t: 0, zi: 0, tiempoRestante: 0, recogidos: 0, derrotados: 0, total: 1, posicion: 1, generadoHasta: 0, contra: null, contraT: 0, contraHecho: false, jefeZona: false,
    completa: false, avisoPuerta: 0, derrotadosTotal: 0 };
  const zonaAct = () => ZONAS[P.zi];
  const DIF = () => (TR.activa ? TR.dif : { danio: 1, vel: 1 });
  function vivosEnZona() { return enemigos.filter(e => e.activo && !e.muriendo).length; }
  function spawnEnemigo(en, cerca) {
    const zi = P.zi, z = zonaAct(), dif = (z.dificultad || 1);
    en.zona = zi; en.ladron = false; en.robado = 0;
    if (en.cfg.comportamiento === "rival" && pista) { en.pista = (enemigos.indexOf(en) % 6) * -0.006 - 0.004; en.vuelta = 0; const s = pista.curva.getPointAt((en.pista + 1) % 1); en.pos.set(s.x, alturaGrid(s.x, s.z), s.z); }
    else if (PLATAF && plataformas.length > 3) { const pz = plataformas.filter(p => !p.fija && (!camino || p.zona === zi) && p.w < 6); const p = pz.length ? pz[Math.floor(rnd() * pz.length)] : plataformas[3]; en.pos.set(p.x, p.y, p.z); en.plat = p; }
    else if (cerca) { let L = null; for (let k = 0; k < 12 && !L; k++) { const a = rnd() * 6.28, d = 12 + rnd() * 10; L = validar(jug.pos.x + Math.cos(a) * d, jug.pos.z + Math.sin(a) * d, 0.8, false); } L = L || { x: jug.pos.x + 14, z: jug.pos.z, y: alturaGrid(jug.pos.x + 14, jug.pos.z) }; en.pos.set(L.x, L.y, L.z); }
    else if (camino) { let L = null; for (let k = 0; k < 15 && !L; k++) { const c = lugarEnZona(zi, 0.8, 1, 18, 10); if (c && Math.hypot(c.x - jug.pos.x, c.z - jug.pos.z) > 18) L = c; } L = L || lugarEnZona(zi, 0.5, 0, 12, 6) || { x: jug.pos.x + 20, z: jug.pos.z, y: 0 }; en.pos.set(L.x, alturaGrid(L.x, L.z), L.z); }
    else { let L = null; for (let k = 0; k < 20 && !L; k++) { const c = lugarLibre(1, 16, MITAD * 0.85); if (c && Math.hypot(c.x - jug.pos.x, c.z - jug.pos.z) > 22) L = c; } L = L || { x: -jug.pos.x * 0.7 + 20, z: -jug.pos.z * 0.7 - 20, y: 0 }; en.pos.set(L.x, alturaGrid(L.x, L.z), L.z); }
    en.casa.copy(en.pos); en.destino.copy(en.pos); en.vida = (en.cfg.vida || 30) * (0.8 + 0.25 * dif); en.activo = true; en.muriendo = 0; en.cd = 1; en.pj.grupo.visible = true; en.pj.grupo.scale.setScalar(1);
    en.velZ = (en.cfg.velocidad || 3) * (0.85 + 0.15 * dif) * DIF().vel; en.danioZ = (en.cfg.danio || 10) * (0.8 + 0.2 * dif) * DIF().danio;
    en.pj.anim && en.pj.anim("quieto", true);
  }
  function poblarZona() {
    enemigos.forEach(en => { en.activo = false; en.pj.grupo.visible = false; });
    const z = zonaAct(); const obj = z.objetivo.tipo;
    if (obj === "carrera") { enemigos.forEach(en => { if (en.cfg.comportamiento === "rival") spawnEnemigo(en); }); return; }
    const inicial = obj === "sobrevivir" ? 0.4 : 1;
    (z.enemigos || []).forEach(m => { const lst = enemigos.filter(e => e.tipo === m.ref); for (let k = 0; k < Math.min(lst.length, Math.round(m.cantidad * inicial)); k++) spawnEnemigo(lst[k]); });
  }
  function prepararZona(i, reinicioTotal) {
    P.zi = i; const z = zonaAct(), ob = z.objetivo;
    Object.assign(P, { recogidos: 0, derrotados: 0, total: ob.cantidad || 1, tiempoRestante: ob.tipo === "sobrevivir" ? (ob.cantidad || 60) : (ob.tiempo || 0), contra: null, contraT: 0, contraHecho: false,
      completa: false, generadoHasta: P.t, jefeZona: ob.tipo === "jefe" });
    if (ob.tipo === "recolectar") { const n = objetos.filter(o => o.tipo === 0 && o.zona === i).length; if (CAMP) P.total = Math.min(ob.cantidad, n || ob.cantidad); else P.total = Math.min(ob.cantidad || n, n || ob.cantidad); }
    if (ob.tipo === "carrera") { P.total = Math.max(1, ob.cantidad || 3); jug.vuelta = 0; jug.cp = 0; jug.progreso = 0; }
    evento.niebla = 1; evento.noche = false; evento.tormenta = false; objetivoAmbiente(z, reinicioTotal);
    if (!reinicioTotal) for (const o of objetos) if (o.zona === i && o.tipo === 0 && !o.activo && CAMP) o.activo = true;
    irA(i);
    poblarZona();
    if (jefe) { jefe.activo = false; jefe.pj.grupo.visible = false; jefe.presentado = false; NK.ui.jefe && NK.ui.jefe(null); }
    if (meta) { meta.grupo.visible = false; if (ob.tipo === "llegar") colocarMeta(i); }
    const fg = hitos.fogatas[i]; if (fg) { luzFogata.position.set(fg.pos.x, fg.pos.y + 1.2, fg.pos.z); luzFogata.intensity = ALTO ? 2.2 : 0; }
    NK.ui.datos({ sinTiempo: !(P.tiempoRestante > 0) });
    for (const pu of hitos.puertas) { pu.abierta = pu.zona < i; pu.barrera.visible = !pu.abierta; }
  }
  function irA(i) {  // al punto de control de la zona
    jug.vel.set(0, 0, 0); jug.velAuto = 0; jug.invul = 1.5; jug.inmovil = 0;
    if (pista) { const s = pista.curva.getPointAt(0.004), t = pista.curva.getTangentAt(0.004); jug.pos.set(s.x, alturaGrid(s.x, s.z) + 0.5, s.z); jug.yaw = Math.atan2(t.x, t.z); jug.vuelta = 0; jug.cp = 0; }
    else if (camino) { const fg = hitos.fogatas[i]; const r = fg ? fg.respawn : puntoCamino(camino.limites[i].ini + 3, 0, new V3()); const t = camino.tang[camino.limites[i].ini + 4];
      let y = sueloEn(r.x, r.z).h; if (PLATAF) { const pl = plataformas.find(p => p.zona === i && !p.fija); if (pl) { r.set(pl.x, 0, pl.z); y = pl.y; jug.ultimaPlat = pl; } } jug.pos.set(r.x, y + 0.5, r.z); jug.yaw = Math.atan2(t.x, t.z); }
    else { jug.pos.set(0, sueloEn(0, 0).h + 1, 0); jug.yaw = 0; }
    camYaw = jug.yaw + Math.PI; camPitch = 0.3;
  }

  /* ───────── Contratiempos ───────── */
  function iniciarContratiempo(c) {
    P.contra = c; P.contraT = c.tipo === "emboscada" ? 1 : 40; P.contraHecho = true;
    NK.ui.banner("⚠ " + ({ tormenta: "¡Tormenta!", noche: "¡Cae la noche!", emboscada: "¡Emboscada!", ladron: "¡Un ladrón!", derrumbe: "¡Derrumbe!", niebla: "Niebla espesa" }[c.tipo] || "¡Contratiempo!"), c.texto, 3600);
    NK.gancho("alContratiempo", J, c);
    switch (c.tipo) {
      case "tormenta": evento.tormenta = true; objetivoAmbiente(zonaAct()); break;
      case "noche": evento.noche = true; objetivoAmbiente(zonaAct()); break;
      case "niebla": evento.niebla = 3.2; objetivoAmbiente(zonaAct()); break;
      case "emboscada": { let n = 0; for (const en of enemigos) { if (n >= 5) break; if (!en.activo && en.cfg.comportamiento !== "rival") { spawnEnemigo(en, true); n++; } } break; }
      case "ladron": { const en = enemigos.find(e => !e.activo && e.cfg.comportamiento !== "rival") || enemigos.find(e => e.activo && !e.muriendo);
        if (en) { if (!en.activo) spawnEnemigo(en, true); en.ladron = true; en.velZ = (en.cfg.velocidad || 3) * 1.6; en.vida = (en.cfg.vida || 30) * 0.7;
          const k = zonaAct().objetivo.tipo === "recolectar" ? Math.min(3, P.recogidos) : 0; en.robado = k; P.recogidos -= k; if (k) NK.ui.aviso(`💰 Te robó ${k}. ¡Atrápalo!`, 2600); } break; }
      case "derrumbe": NK.sonido("trueno"); break;
    }
    NK.sonido(c.tipo === "tormenta" ? "trueno" : "jefe");
  }
  function actualizarContratiempo(dt) {
    const c = P.contra; if (!c) return;
    P.contraT -= dt;
    if (c.tipo === "tormenta") { relampago -= dt; if (relampago <= 0) { relampago = 4 + rnd() * 7; NK.ui.flash(140); setTimeout(() => NK.sonido("trueno"), 300 + rnd() * 900); } }
    if (c.tipo === "derrumbe" && rnd() < dt * 1.6) soltarRoca(jug.pos.x + (rnd() - 0.5) * 12 + jug.vel.x * 0.6, jug.pos.z + (rnd() - 0.5) * 12 + jug.vel.z * 0.6);
    if (P.contraT <= 0 && c.tipo !== "ladron") { if (evento.tormenta || evento.noche || evento.niebla !== 1) { evento.tormenta = false; evento.noche = false; evento.niebla = 1; objetivoAmbiente(zonaAct()); NK.ui.aviso("🌤 El contratiempo pasó", 1800); } P.contra = null; }
  }
  function devolverRobado(en, atrapado) {
    if (!en.robado) return;
    if (atrapado) { P.recogidos += en.robado; NK.ui.aviso(`💰 ¡Recuperaste ${en.robado}!`, 2000); NK.sonido("moneda"); }
    else { let k = en.robado; for (const o of objetos) { if (k <= 0) break; if (o.zona === P.zi && o.tipo === 0 && !o.activo) { const L = lugarEnZona(P.zi, 0.6, 1, 14, 6); if (L) { o.pos.set(L.x, L.y + 1.1, L.z); o.activo = true; k--; } } }
      NK.ui.aviso("💨 El ladrón escapó: dejó caer lo robado por la zona", 2600); }
    en.robado = 0; en.ladron = false;
  }

  /* ───────── Cámara (tercera/primera persona y cámaras de cine: presentación, miradores y jefe) ───────── */
  let camYaw = Math.PI, camPitch = 0.3, camDist = VEHICULO ? 8.5 : 6.4;
  const PRIMERA = C.camara === "primera" && !VEHICULO;
  const cine = { modo: null, t: 0, dur: 1, centro: new V3(), desde: new V3() };
  function camaraCine(modo, dur, centro) { cine.modo = modo; cine.t = 0; cine.dur = dur; if (centro) cine.centro.copy(centro); cine.desde.copy(camara.position); }
  function actualizarCamara(dt) {
    if (cine.modo) {
      cine.t += dt; const f = Math.min(1, cine.t / cine.dur);
      if (cine.modo === "intro" && camino) {  // vuelo panorámico por toda la travesía
        const u = NK.clamp(f * 1.02, 0, 1), i = u * camino.N * 0.97, j = Math.min(camino.N, i + camino.N * 0.06);
        puntoCamino(i, 18 * Math.sin(u * 3), tmpV); tmpV.y = camino.alt[Math.round(i)] + 30 + 16 * Math.sin(u * Math.PI);
        camara.position.lerp(tmpV, 1 - Math.exp(-dt * 2.2)); puntoCamino(j, 0, tmpV2); tmpV2.y = camino.alt[Math.round(j)] + 2; camara.lookAt(tmpV2);
      } else if (cine.modo === "orbita") {  // mirador: vista panorámica alrededor
        const a = cine.t * 0.45 + camYaw, r = 34 + 8 * Math.sin(cine.t * 0.5);
        tmpV.set(cine.centro.x + Math.sin(a) * r, cine.centro.y + 20, cine.centro.z + Math.cos(a) * r); camara.position.lerp(tmpV, 1 - Math.exp(-dt * 2.5)); camara.lookAt(cine.centro.x, cine.centro.y + 2, cine.centro.z);
        if (f >= 1) cine.modo = null;
      } else if (cine.modo === "jefe" && jefe) {
        tmpV.set(jefe.pos.x - Math.sin(jefe.yaw) * -10, jefe.pos.y + 4.5, jefe.pos.z - Math.cos(jefe.yaw) * -10); camara.position.lerp(tmpV, 1 - Math.exp(-dt * 3)); camara.lookAt(jefe.pos.x, jefe.pos.y + (jefe.pj.altura || 4) * 0.6, jefe.pos.z);
        if (f >= 1) cine.modo = null;
      } else if (cine.modo === "menu") { camYaw += dt * 0.1; cine.modo = null; }
      if (cine.modo) return;
    }
    const r = NK.tomarRaton(); const sens = 0.0026;
    if (NK.raton.bloqueado || r.dx || r.dy) { camYaw -= r.dx * sens; camPitch = NK.clamp(camPitch + r.dy * sens * (PRIMERA ? -1 : 1), PRIMERA ? -1.3 : -0.25, PRIMERA ? 1.3 : 1.2); }
    if (r.rueda) camDist = NK.clamp(camDist + r.rueda * 0.8, 3, 16);
    if (PRIMERA) {
      camara.position.set(jug.pos.x, jug.pos.y + 1.62, jug.pos.z);
      tmpV.set(Math.sin(camYaw + Math.PI) * Math.cos(camPitch), Math.sin(camPitch), Math.cos(camYaw + Math.PI) * Math.cos(camPitch));
      camara.lookAt(tmpV.add(camara.position)); grupoJ.visible = false; return;
    }
    if (VEHICULO && !NK.raton.bloqueado) camYaw = NK.lerp(camYaw, jug.yaw + Math.PI, 1 - Math.exp(-dt * 3));
    const d = camDist, hx = jug.pos.x + Math.sin(camYaw) * Math.cos(camPitch) * d, hz = jug.pos.z + Math.cos(camYaw) * Math.cos(camPitch) * d;
    let hy = jug.pos.y + 1.6 + Math.sin(camPitch) * d; hy = Math.max(hy, sueloEn(hx, hz).h + 0.6);
    tmpV.set(hx, hy, hz); camara.position.lerp(tmpV, 1 - Math.exp(-dt * 12));
    camara.lookAt(jug.pos.x, jug.pos.y + 1.3, jug.pos.z);
  }

  /* ───────── Jugador: movimiento, daño, ataques ───────── */
  function danio(n, fuente) {
    if (jug.invul > 0 || jug.escudo > 0 || NK.estado !== "jugando") return;
    const r = NK.gancho("alDanio", J, n, fuente); if (r === false) return;
    jug.vida -= n; jug.invul = 0.8; TR.stats.danioZona += n; NK.sonido("danio"); NK.ui.danio(); PJ.anim && PJ.anim("golpe", true);
    if (jug.vida <= 0) { jug.vida = 0; morir(fuente && fuente.tipo ? "¡Cuidado con los obstáculos!" : "¡Caíste!"); }
  }
  function morir(motivo) {
    if (TR.activa) { TR.morir(motivo); }
    else NK.terminar(false, `Te quedaste sin vida. Puntos: ${jug.puntos}`);
  }
  function objetivoCercano(maxAng, maxDist) {
    camara.getWorldDirection(tmpV); tmpV.y = 0; tmpV.normalize(); let best = null, bs = -1;
    const cands = enemigos.filter(e => e.activo && !e.muriendo); if (jefe && jefe.activo && !jefe.muriendo) cands.push(jefe);
    for (const en of cands) { tmpV2.set(en.pos.x - jug.pos.x, 0, en.pos.z - jug.pos.z); const d = tmpV2.length(); if (d > maxDist) continue; tmpV2.normalize(); const c = tmpV2.dot(tmpV); if (c > Math.cos(maxAng) && c / (1 + d * 0.02) > bs) { bs = c / (1 + d * 0.02); best = en; } }
    return best;
  }
  function atacar() {
    const a = armaAct; if (!a || jug.ataque > 0 || VEHICULO) return;
    const m = jug.mult, dmg = (a.danio || 20) * m.danio * (jug.furia > 0 ? 2 : 1);
    jug.ataque = (a.cadencia || 0.4) * m.cad;
    if (a.tipo === "cuerpo") {
      NK.sonido("golpe"); PJ.anim("atacar", true); jug.anim = 0.55;
      const fx = Math.sin(jug.yaw), fz = Math.cos(jug.yaw), alc = (a.alcance || 2.6) * m.alc;
      const lista = enemigos.filter(e => e.activo && !e.muriendo); if (jefe && jefe.activo && !jefe.muriendo) lista.push(jefe);
      for (const en of lista) { const dx = en.pos.x - jug.pos.x, dz = en.pos.z - jug.pos.z, d = Math.hypot(dx, dz); if (d < alc + (en.pj.radio || 0.5) && (dx * fx + dz * fz) / (d || 1) > 0.25) herirEnemigo(en, dmg, dx / (d || 1), dz / (d || 1)); }
      if (a.proyectil === "fuego") explosion(tmpV.set(jug.pos.x + fx * 1.6, jug.pos.y + 1.1, jug.pos.z + fz * 1.6), "#ff8a2a", 10, 2, -2);
    } else {
      const obj = objetivoCercano(a.tipo === "magia" ? 0.9 : 0.22, a.alcance || 40);
      camara.getWorldDirection(tmpV); if (!PRIMERA) { tmpV.y = Math.max(tmpV.y, -0.05); }
      if (obj) { tmpV.set(obj.pos.x - jug.pos.x, obj.pos.y + (obj.pj.altura || 1.6) * 0.55 - (jug.pos.y + 1.3), obj.pos.z - jug.pos.z); }
      tmpV.normalize(); jug.yaw = Math.atan2(tmpV.x, tmpV.z);
      const tipo = a.proyectil || (a.tipo === "magia" ? "magia" : "bala");
      tmpV2.set(jug.pos.x + tmpV.x * 0.9, jug.pos.y + 1.35, jug.pos.z + tmpV.z * 0.9);
      if (tipo === "flecha" || tipo === "piedra") tmpV.y += 0.06;
      disparar(tipo, tmpV2, tmpV, dmg, true, a.tipo === "magia" ? obj : null);
      NK.sonido(tipo === "flecha" ? "flecha" : tipo === "magia" ? "magia" : tipo === "fuego" ? "fuego" : "disparo"); PJ.anim(a.tipo === "magia" ? "magia" : "disparar", true); jug.anim = 0.4;
    }
  }
  function herirEnemigo(en, n, kx = 0, kz = 0) {
    if (en.muriendo) return;
    en.vida -= n; en.golpe = 0.2; if (!en.jefe) { en.vel.x += kx * 8; en.vel.z += kz * 8; en.pj.anim && en.pj.anim("golpe", true); }
    explosion(tmpV.set(en.pos.x, en.pos.y + (en.pj.altura || 1.6) * 0.6, en.pos.z), "#ffffff", 6, 3);
    if (en.jefe) { NK.ui.jefe(en.cfg.nombre, Math.max(0, en.vida) / en.vidaMax); if (en.vida <= 0) derrotarJefe(); return; }
    if (en.vida <= 0) { en.muriendo = en.pj.acciones && en.pj.acciones.morir ? 1.3 : 0.5; en.pj.anim && en.pj.anim("morir", true);
      P.derrotados++; P.derrotadosTotal++; TR.stats.derrotados++; TR.logro("derrotar", P.derrotadosTotal); jug.puntos += 25; NK.sonido("golpe");
      explosion(tmpV.set(en.pos.x, en.pos.y + 1, en.pos.z), en.cfg.color || "#ff4a4a", 24, 6); if (en.ladron) devolverRobado(en, true); NK.gancho("alDerrotar", J, en); }
  }
  function cambiarArma(dir, idx) {
    const disp = TR.activa ? TR.armasDisponibles() : ARMAS; if (disp.length < 2) return;
    let k = disp.indexOf(armaAct); k = idx != null ? idx : (k + dir + disp.length) % disp.length; if (!disp[k] || disp[k] === armaAct) return;
    equiparArma(disp[k]); NK.sonido("poner"); NK.ui.aviso(`${disp[k].nombre}`, 900);
  }
  function moverJugador(dt) {
    const e = NK.eje(), correr = NK.boton("correr") ? 1.6 : 1, turbo = jug.turbo > 0 ? 1.45 : 1, m = jug.mult;
    for (const k of ["invul", "ataque", "turbo", "anim", "inmovil", "escudo", "furia", "iman"]) jug[k] = Math.max(0, jug[k] - dt);
    if (TR.mejoras && TR.mejoras.has("regeneracion")) jug.vida = Math.min(jug.vidaMax, jug.vida + dt * 1.2);
    if (VEHICULO) {
      const max = C.jugador.velocidad * turbo * m.vel, fuera = pista && pista.cerca(jug.pos.x, jug.pos.z) > pista.ancho * 0.65;
      jug.velAuto += (e.y > 0 ? 18 : e.y < 0 ? -26 : -jug.velAuto * 1.2) * dt; jug.velAuto = NK.clamp(jug.velAuto, -max * 0.35, max * (fuera ? 0.45 : 1));
      jug.yaw -= e.x * dt * 1.9 * NK.clamp(jug.velAuto / 12, -1, 1);
      jug.pos.x += Math.sin(jug.yaw) * jug.velAuto * dt; jug.pos.z += Math.cos(jug.yaw) * jug.velAuto * dt;
      jug.pos.y = alturaGrid(jug.pos.x, jug.pos.z); jug.enSuelo = true;
      if (Math.abs(jug.velAuto) > 3 && Math.random() < dt * 8) NK.sonido("motor");
    } else {
      const lento = jug.inmovil > 0 ? 0 : jug.lento, velo = C.jugador.velocidad * correr * turbo * m.vel * lento, fx = Math.sin(camYaw + Math.PI), fz = Math.cos(camYaw + Math.PI);
      const dx = (fx * e.y - fz * e.x), dz = (fz * e.y + fx * e.x);
      const acel = jug.enSuelo ? (jug.resbala > 0 ? 1.6 : 14) : 5;
      jug.vel.x = NK.lerp(jug.vel.x, dx * velo, 1 - Math.exp(-acel * dt)); jug.vel.z = NK.lerp(jug.vel.z, dz * velo, 1 - Math.exp(-acel * dt));
      if ((e.x || e.y) && jug.anim <= 0) jug.yaw = NK.lerp(jug.yaw, jug.yaw + (((Math.atan2(dx, dz) - jug.yaw + Math.PI) % (2 * Math.PI) + 2 * Math.PI) % (2 * Math.PI) - Math.PI), 1 - Math.exp(-12 * dt));
      if (PRIMERA) jug.yaw = camYaw + Math.PI;
      const maxSaltos = TR.mejoras && TR.mejoras.has("doble_salto") ? 2 : 1;
      if (NK.pulso("saltar") && jug.inmovil <= 0 && (jug.enSuelo || jug.saltos < maxSaltos)) { jug.vel.y = C.jugador.salto * m.salto * (jug.enSuelo ? 1 : 0.9); jug.saltos = jug.enSuelo ? 1 : jug.saltos + 1; jug.enSuelo = false; NK.sonido("salto"); PJ.anim("saltar", true); }
      jug.vel.y -= 24 * dt;
      const yAntes = jug.pos.y;
      jug.pos.x += jug.vel.x * dt; jug.pos.z += jug.vel.z * dt; jug.pos.y += jug.vel.y * dt;
      const s = sueloEn(jug.pos.x, jug.pos.z, yAntes);
      if (jug.pos.y <= s.h) { jug.pos.y = s.h; jug.vel.y = 0; jug.enSuelo = true; jug.saltos = 0; if (s.plat) { if (!s.plat.fija) jug.ultimaPlat = s.plat; jug.pos.x += s.plat.dx || 0; jug.pos.z += s.plat.dz || 0; } } else if (jug.pos.y - s.h > 0.15) jug.enSuelo = false;
      for (const c of choques) { if (c.pista) continue; if (c.agua) { if (Math.hypot(jug.pos.x - c.x, jug.pos.z - c.z) < c.r * 1.25) jug.lento = Math.min(jug.lento, 0.55); continue; } const ddx = jug.pos.x - c.x, ddz = jug.pos.z - c.z, d = Math.hypot(ddx, ddz), mm = c.r + 0.4; if (d < mm && d > 0.001) { jug.pos.x = c.x + ddx / d * mm; jug.pos.z = c.z + ddz / d * mm; } }
      const hv = Math.hypot(jug.vel.x, jug.vel.z);
      if (jug.anim <= 0 && jug.invul < 0.6) PJ.anim(!jug.enSuelo ? "saltar" : hv > 7.5 ? "correr" : hv > 0.6 ? "caminar" : "quieto");
      if (jug.enSuelo && hv > 1) { jug.paso += dt * hv; if (jug.paso > 2.2) { jug.paso = 0; NK.sonido("paso"); } }
    }
    // límites: el borde del mundo, el valle del camino y la puerta de la zona (se abre al cumplir el objetivo)
    jug.pos.x = NK.clamp(jug.pos.x, -MITAD + 2, MITAD - 2); jug.pos.z = NK.clamp(jug.pos.z, -MITAD + 2, MITAD - 2);
    if (camino && !VEHICULO) {
      const c = cercaCamino(jug.pos.x, jug.pos.z), maxLat = PLATAF ? 9 : 30;
      if (c.d > maxLat) { const m2 = camino.muestras[c.i]; const f = (c.d - maxLat) / c.d; jug.pos.x -= (jug.pos.x - m2.x) * f; jug.pos.z -= (jug.pos.z - m2.z) * f; }
      const lim = camino.limites[P.zi];
      if (!P.completa && c.i > lim.fin - 1 && P.zi < NZ - 1) { const m2 = camino.muestras[lim.fin - 2], t = camino.tang[lim.fin - 2]; const dd = (jug.pos.x - m2.x) * t.x + (jug.pos.z - m2.z) * t.z;
        if (dd > 0) { jug.pos.x -= t.x * dd; jug.pos.z -= t.z * dd; jug.vel.x *= -0.3; jug.vel.z *= -0.3; }
        if (P.t - P.avisoPuerta > 3) { P.avisoPuerta = P.t; NK.ui.aviso("🔒 " + zonaAct().objetivo.texto + " para abrir el paso", 2400); } }
    }
    const naJ = aguaEn(jug.pos.x, jug.pos.z); if (naJ > -1e8 && jug.pos.y < naJ - 0.9 && !PLATAF) { jug.pos.y = naJ - 0.9; jug.vel.y = Math.max(jug.vel.y, 0); jug.enSuelo = true; }
    if (jug.pos.y < nivelAgua - 0.2 && !VEHICULO) {
      if (PLATAF) { danio(20, "caida"); const p = jug.ultimaPlat || plataformas.find(q => !q.fija) || { x: 0, y: 2, z: 0 }; jug.pos.set(p.x, p.y + 0.5, p.z); jug.vel.set(0, 0, 0); jug.invul = Math.max(jug.invul, 1); }
      else if (jug.pos.y < nivelAgua - 1.2) jug.vel.y = Math.max(jug.vel.y, 3);
    }
    if (NK.pulso("cambiarArma")) cambiarArma(1);
    for (let k = 0; k < 4; k++) if (NK.pulso("Digit" + (k + 1))) cambiarArma(0, k);
    const cercaNPC = npcs.find(n => n.zona === P.zi && n.pos.distanceTo(jug.pos) < 3.2);
    if (cercaNPC && NK.pulso("hablar")) hablarCon(cercaNPC);
    else if ((NK.pulso("accion") || (NK.boton("Mouse0") && armaAct && armaAct.tipo !== "cuerpo")) && NK.estado === "jugando") atacar();
    grupoJ.position.copy(jug.pos); grupoJ.rotation.y = jug.yaw; grupoJ.visible = !PRIMERA && (jug.invul <= 0 || Math.floor(jug.invul * 12) % 2 === 0);
    if (!PJ.mixer && PJ.malla && !VEHICULO) { const hv = Math.hypot(jug.vel.x, jug.vel.z); PJ.malla.position.y = jug.enSuelo ? Math.abs(Math.sin(P.t * 10)) * Math.min(1, hv / 6) * 0.12 : 0; PJ.malla.rotation.z = Math.sin(P.t * 10) * Math.min(1, hv / 6) * 0.06; }
    if (!PJ.mano && modelosArma[armaAct && armaAct.id]) { const piv = modelosArma[armaAct.id]; piv.rotation.x = armaAct.tipo === "cuerpo" ? (jug.anim > 0 ? 0.3 - Math.sin((0.55 - jug.anim) / 0.55 * Math.PI) * 2.2 : 0.3) : 0; }
    if (PJ.mixer) PJ.mixer.update(dt);
    escudoMalla.visible = jug.escudo > 0; if (jug.escudo > 0) escudoMalla.position.set(jug.pos.x, jug.pos.y + 1, jug.pos.z);
    jug.lento = 1; jug.resbala = 0;
  }
  async function hablarCon(n) {
    if (NK.estado !== "jugando") return;
    n.hablado = true; n.marcador.material.color.setHex(0x9aa3ad);
    const lookYaw = Math.atan2(jug.pos.x - n.pos.x, jug.pos.z - n.pos.z); n.pj.grupo.rotation.y = lookYaw; n.pj.anim && n.pj.anim("hablar", true);
    await NK.dialogo(n.cfg.nombre, n.cfg.dialogo || ["¡Hola!"], `assets/iconos/npc_${n.cfg.modelo || "npc"}.png`);
    n.pj.anim && n.pj.anim("quieto", true);
  }

  /* ───────── Enemigos: IA ───────── */
  function moverEnemigos(dt) {
    const radioVista = (amb.noche > 0.5 || C.tema === "terror") ? 30 : 22, agresivo = evento.noche ? 1.2 : 1;
    for (const en of enemigos) {
      if (!en.activo) continue;
      const g = en.pj.grupo;
      if (en.muriendo > 0) { en.muriendo -= dt; if (!en.pj.acciones || !en.pj.acciones.morir) g.scale.setScalar(Math.max(0.01, en.muriendo * 2)); else if (en.muriendo < 0.3) g.scale.setScalar(Math.max(0.01, en.muriendo / 0.3));
        if (en.pj.mixer) en.pj.mixer.update(dt); if (en.muriendo <= 0) { en.activo = false; g.visible = false; g.scale.setScalar(1); } continue; }
      en.cd = Math.max(0, en.cd - dt); en.golpe = Math.max(0, en.golpe - dt); en.t += dt;
      const v = (en.velZ || en.cfg.velocidad || 3) * agresivo;
      if (en.cfg.comportamiento === "rival" && pista) {
        const factor = 0.86 + ((enemigos.indexOf(en) * 37) % 13) / 100 + (P.t < 3 ? -0.5 : 0) + 0.04 * ((zonaAct().dificultad || 1) - 1);
        const antes = en.pista; en.pista += v * factor * dt / pista.L; if (en.pista >= 1) { en.pista -= 1; en.vuelta++; } if (antes < 0 && en.pista >= 0) en.vuelta = 0;
        const u = ((en.pista % 1) + 1) % 1, s = pista.curva.getPointAt(u), t = pista.curva.getTangentAt(u);
        en.pos.set(s.x - t.z * en.carril, 0, s.z + t.x * en.carril); en.pos.y = alturaGrid(en.pos.x, en.pos.z); en.yaw = Math.atan2(t.x, t.z);
        if (en.vuelta >= P.total && NK.estado === "jugando" && !P.completa) { P.completa = true; P.fallo = true; if (TR.activa) { TR.morir("Un rival llegó primero"); } else NK.terminar(false, `Un rival llegó primero. Tú ibas en la vuelta ${Math.min(P.total, jug.vuelta + 1)}/${P.total}.`); }
      } else {
        const dx = jug.pos.x - en.pos.x, dz = jug.pos.z - en.pos.z, d = Math.hypot(dx, dz);
        const obj = zonaAct().objetivo.tipo;
        const persigue = !en.ladron && (en.cfg.comportamiento !== "patrullar" && d < radioVista * agresivo || (obj === "sobrevivir" && d < radioVista * 2.5) || (P.contra && P.contra.tipo === "emboscada" && d < 40));
        let tx, tz;
        if (en.ladron) { tx = en.pos.x - dx * 3; tz = en.pos.z - dz * 3; if (d > 55 || en.t > 40) { devolverRobado(en, false); en.activo = false; g.visible = false; continue; } }
        else if (persigue) { tx = jug.pos.x; tz = jug.pos.z; en.estado = "perseguir"; }
        else { if (Math.hypot(en.destino.x - en.pos.x, en.destino.z - en.pos.z) < 1.5 || rnd() < dt * 0.15) { en.destino.set(en.casa.x + (rnd() - 0.5) * 22, 0, en.casa.z + (rnd() - 0.5) * 22); if (en.plat) en.destino.set(en.plat.x + (rnd() - 0.5) * en.plat.w, 0, en.plat.z + (rnd() - 0.5) * en.plat.d); } tx = en.destino.x; tz = en.destino.z; en.estado = "patrullar"; }
        const ex = tx - en.pos.x, ez = tz - en.pos.z, el = Math.hypot(ex, ez) || 1, vel = (persigue || en.ladron) ? v : v * 0.45;
        if (!(persigue && d < 1.1 + en.pj.radio)) { en.vel.x = NK.lerp(en.vel.x, ex / el * vel, 1 - Math.exp(-6 * dt)); en.vel.z = NK.lerp(en.vel.z, ez / el * vel, 1 - Math.exp(-6 * dt)); }
        else { en.vel.x *= 0.8; en.vel.z *= 0.8; }
        en.pos.x += en.vel.x * dt; en.pos.z += en.vel.z * dt;
        if (en.plat) { en.pos.x = NK.clamp(en.pos.x, en.plat.x - en.plat.w / 2 + 0.3, en.plat.x + en.plat.w / 2 - 0.3); en.pos.z = NK.clamp(en.pos.z, en.plat.z - en.plat.d / 2 + 0.3, en.plat.z + en.plat.d / 2 - 0.3); en.pos.x += en.plat.dx || 0; en.pos.z += en.plat.dz || 0; }
        en.pos.x = NK.clamp(en.pos.x, -MITAD + 2, MITAD - 2); en.pos.z = NK.clamp(en.pos.z, -MITAD + 2, MITAD - 2);
        if (camino && !en.plat) { const c = cercaCamino(en.pos.x, en.pos.z); if (c.d > 30) { const m2 = camino.muestras[c.i]; en.pos.x = NK.lerp(en.pos.x, m2.x, 0.05); en.pos.z = NK.lerp(en.pos.z, m2.z, 0.05); } }
        const suelo = en.plat ? en.plat.y : alturaGrid(en.pos.x, en.pos.z); en.pos.y = en.pj.vuela ? suelo + 2.6 + Math.sin(en.t * 2) * 0.5 - (persigue && d < 5 ? 1.6 : 0) : Math.max(suelo, nivelAgua - 0.5);
        if (Math.hypot(en.vel.x, en.vel.z) > 0.2) en.yaw = Math.atan2(en.vel.x, en.vel.z);
        const dy = jug.pos.y - en.pos.y, alcance = 0.9 + en.pj.radio;
        if (d < alcance && Math.abs(dy) < (en.pj.altura || 1.8) + 0.4 && !en.ladron) {
          if (armaAct == null && jug.vel.y < -1 && dy > (en.pj.altura || 1) * 0.45) { herirEnemigo(en, 999); jug.vel.y = C.jugador.salto * 0.8; NK.sonido("salto"); }
          else if (en.cd <= 0 && (en.danioZ || 0) > 0) { en.cd = 0.9; danio(en.danioZ, en); en.pj.anim && en.pj.anim("atacar", true); jug.vel.x += ex / el * 6; jug.vel.z += ez / el * 6; }
        }
        if (en.pj.mixer && en.golpe <= 0 && (!en.pj.acciones.atacar || !en.pj.acciones.atacar.isRunning())) en.pj.anim(Math.hypot(en.vel.x, en.vel.z) > 3 ? "correr" : Math.hypot(en.vel.x, en.vel.z) > 0.4 ? "caminar" : "quieto");
      }
      g.position.copy(en.pos); g.rotation.y = en.yaw;
      if (en.pj.malla) { const hv = Math.hypot(en.vel.x, en.vel.z); en.pj.malla.position.y = Math.abs(Math.sin(en.t * 9)) * Math.min(1, hv / 4) * 0.15; }
      if (en.pj.mixer && Math.abs(en.pos.x - jug.pos.x) + Math.abs(en.pos.z - jug.pos.z) < 70) en.pj.mixer.update(dt);
    }
    // población de la zona: reaparecen / oleadas
    if (NK.estado === "jugando" && !P.completa) {
      const z = zonaAct(), obj = z.objetivo.tipo;
      if (obj !== "carrera" && obj !== "jefe") {
        const quiere = (z.enemigos || []).reduce((s2, m2) => s2 + m2.cantidad, 0);
        const vivos = vivosEnZona(), faltan = obj === "derrotar" ? Math.max(0, P.total - P.derrotados) : 1e9;
        const tope = obj === "sobrevivir" ? Math.min(enemigos.length, 3 + Math.floor((P.t - P.generadoHasta) / 12) + quiere) : Math.min(quiere, faltan);
        if (vivos < tope && P.t - (P.ultimoSpawn || 0) > (obj === "sobrevivir" ? 2.2 : 7)) {
          const tipos = (z.enemigos || []).map(m2 => m2.ref); const en = enemigos.find(e2 => !e2.activo && tipos.includes(e2.tipo) && e2.cfg.comportamiento !== "rival");
          if (en) { spawnEnemigo(en, obj === "sobrevivir"); P.ultimoSpawn = P.t; } }
      }
    }
  }

  /* ───────── Jefe final: fases con habilidades ───────── */
  function presentarJefe() {
    const lim = camino ? camino.limites[NZ - 1] : null;
    if (camino) puntoCamino(lim.fin - 2, 0, tmpV3); else tmpV3.set(jug.pos.x + 20, 0, jug.pos.z + 20);
    jefe.pos.set(tmpV3.x, alturaGrid(tmpV3.x, tmpV3.z), tmpV3.z); jefe.vida = jefe.vidaMax * (0.85 + 0.15 * DIF().danio); jefe.vidaMax = jefe.vida;
    jefe.activo = true; jefe.presentado = true; jefe.fase = 0; jefe.cd = 3; jefe.muriendo = 0; jefe.pj.grupo.visible = true; jefe.pj.grupo.scale.setScalar(1);
    jefe.yaw = Math.atan2(jug.pos.x - jefe.pos.x, jug.pos.z - jefe.pos.z); jefe.pj.grupo.position.copy(jefe.pos); jefe.pj.grupo.rotation.y = jefe.yaw;
    NK.ui.jefe(jefe.cfg.nombre, 1); NK.sonido("jefe"); NK.ui.banner("👑 " + jefe.cfg.nombre, "Jefe final", 3200);
    if (!NK.prueba) { camaraCine("jefe", 2.6); NK.estado = "cine"; setTimeout(async () => { await NK.dialogo(jefe.cfg.nombre, (JEFE_CFG.dialogo || []).slice(0, 2), `assets/iconos/jefe.png`); if (NK.estado === "cine" || NK.estado === "dialogo") NK.estado = "jugando"; cine.modo = null; }, 2600); }
    NK.gancho("alJefe", J, jefe);
  }
  function moverJefe(dt) {
    if (!jefe || !jefe.activo) return;
    const j = jefe, g = j.pj.grupo;
    if (j.muriendo > 0) { j.muriendo -= dt; if (j.pj.mixer) j.pj.mixer.update(dt); if (j.muriendo < 0.6) g.scale.setScalar(Math.max(0.01, j.muriendo / 0.6)); if (rnd() < dt * 20) explosion(tmpV.set(j.pos.x + (rnd() - 0.5) * 3, j.pos.y + rnd() * 4, j.pos.z + (rnd() - 0.5) * 3), "#ffb13a", 10, 7);
      if (j.muriendo <= 0) { j.activo = false; g.visible = false; } return; }
    j.t += dt; j.cd -= dt; j.golpe = Math.max(0, j.golpe - dt);
    const frac = j.vida / j.vidaMax, fases = JEFE_CFG.fases || [{ umbral: 1, habilidad: "embestida" }];
    let f = 0; fases.forEach((fa, i) => { if (frac <= fa.umbral + 1e-6) f = i; });
    if (f !== j.fase) { j.fase = f; NK.ui.aviso(`⚠ ${j.cfg.nombre}: ¡${{ embestida: "embiste", proyectiles: "lanza proyectiles", invocar: "invoca esbirros", onda: "golpea el suelo", salto: "salta sobre ti" }[fases[f].habilidad] || "cambia de ataque"}!`, 2200); NK.sonido("jefe"); }
    const hab = fases[j.fase].habilidad, dx = jug.pos.x - j.pos.x, dz = jug.pos.z - j.pos.z, d = Math.hypot(dx, dz), v = (j.cfg.velocidad || 3.4) * DIF().vel * (1 + 0.15 * j.fase);
    if (j.carga) {  // embestida: se lanza en línea recta
      j.carga.t -= dt; if (j.carga.t > 0.7) { j.yaw = Math.atan2(j.carga.dx, j.carga.dz); }
      else { j.pos.x += j.carga.dx * v * 4.2 * dt; j.pos.z += j.carga.dz * v * 4.2 * dt; if (rnd() < dt * 30) explosion(tmpV.set(j.pos.x, j.pos.y + 0.3, j.pos.z), "#b8a58a", 3, 2); }
      if (j.carga.t <= 0) j.carga = null;
    } else if (j.salto) {
      j.salto.t -= dt; const u = 1 - j.salto.t / 1.2; j.pos.x = NK.lerp(j.salto.x0, j.salto.x1, u); j.pos.z = NK.lerp(j.salto.z0, j.salto.z1, u);
      marca.visible = true; marca.position.set(j.salto.x1, alturaGrid(j.salto.x1, j.salto.z1) + 0.08, j.salto.z1); marca.scale.setScalar(1 + u * 3.2);
      if (j.salto.t <= 0) { marca.visible = false; j.salto = null; ondaExpansiva(3.8); }
    } else if (d > 3.2) { j.pos.x += dx / d * v * dt; j.pos.z += dz / d * v * dt; j.yaw = Math.atan2(dx, dz); }
    if (j.cd <= 0 && !j.carga && !j.salto) {
      j.cd = 3.4 - 0.5 * j.fase;
      if (hab === "embestida" || (hab !== "salto" && d > 18 && rnd() < 0.4)) { j.carga = { t: 1.9, dx: dx / (d || 1), dz: dz / (d || 1) }; NK.ui.aviso("¡Esquiva hacia un lado!", 1000); j.pj.anim && j.pj.anim("correr", true); }
      else if (hab === "proyectiles") { for (let k = -3; k <= 3; k++) { const a = Math.atan2(dx, dz) + k * 0.16; tmpV.set(Math.sin(a), 0, Math.cos(a)); disparar("enemigo", tmpV2.set(j.pos.x, j.pos.y + (j.pj.altura || 4) * 0.55, j.pos.z), tmpV, j.cfg.danio * 0.7 * DIF().danio, false); } NK.sonido("magia"); j.pj.anim && j.pj.anim("atacar", true); }
      else if (hab === "invocar") { let n = 0; for (const en of enemigos) { if (n >= 3) break; if (!en.activo && en.cfg.comportamiento !== "rival") { spawnEnemigo(en, true); n++; } } NK.ui.aviso("¡Esbirros!", 1200); j.pj.anim && j.pj.anim("atacar", true); }
      else if (hab === "onda") { ondaExpansiva(0); j.pj.anim && j.pj.anim("atacar", true); }
      else if (hab === "salto") { j.salto = { t: 1.2, x0: j.pos.x, z0: j.pos.z, x1: jug.pos.x, z1: jug.pos.z }; }
    }
    if (j.onda) { j.onda.r += dt * 14; ondaMalla.scale.setScalar(j.onda.r); ondaMalla.position.set(j.onda.x, alturaGrid(j.onda.x, j.onda.z) + 0.15, j.onda.z); ondaMalla.material.opacity = 0.85 * (1 - j.onda.r / 22);
      const dj = Math.hypot(jug.pos.x - j.onda.x, jug.pos.z - j.onda.z); if (!j.onda.pego && Math.abs(dj - j.onda.r) < 1.1 && jug.enSuelo) { j.onda.pego = true; danio(j.cfg.danio * DIF().danio, { tipo: "onda" }); jug.vel.y = 6; }
      if (j.onda.r > 22) { j.onda = null; ondaMalla.visible = false; } }
    const suelo = alturaGrid(j.pos.x, j.pos.z); j.pos.y = j.salto ? suelo + Math.sin((1 - j.salto.t / 1.2) * Math.PI) * 7 : suelo;
    if (d < 1.8 + j.pj.radio && Math.abs(jug.pos.y - j.pos.y) < 3 && j.cd < 3) { danio(j.cfg.danio * DIF().danio, j); jug.vel.x += dx / (d || 1) * 10; jug.vel.z += dz / (d || 1) * 10; }
    g.position.copy(j.pos); g.rotation.y = j.yaw;
    if (j.pj.mixer) { if (!j.pj.acciones.atacar || !j.pj.acciones.atacar.isRunning()) j.pj.anim(j.carga && j.carga.t < 0.7 ? "correr" : d > 3.2 ? "caminar" : "quieto"); j.pj.mixer.update(dt); }
    else if (j.pj.malla) j.pj.malla.position.y = Math.abs(Math.sin(j.t * 6)) * 0.2;
  }
  function ondaExpansiva(r0) { jefe.onda = { r: r0 || 0.5, x: jefe.pos.x, z: jefe.pos.z, pego: false }; ondaMalla.visible = true; NK.sonido("trueno"); explosion(tmpV.set(jefe.pos.x, jefe.pos.y + 0.3, jefe.pos.z), "#c8b48a", 30, 8); }
  function derrotarJefe() {
    if (jefe.muriendo) return; jefe.muriendo = 2.2; jefe.pj.anim && jefe.pj.anim("morir", true); NK.ui.jefe(null); jug.puntos += 500; NK.sonido("ganar");
    ondaMalla.visible = false; marca.visible = false; jefe.onda = null; jefe.salto = null; jefe.carga = null;
    enemigos.forEach(e => { if (e.activo && !e.muriendo) { e.vida = 0; herirEnemigo(e, 1); } });
    NK.gancho("alDerrotarJefe", J, jefe);
    setTimeout(() => completarZona(), NK.prueba ? 50 : 2200);
  }

  /* ───────── Proyectiles ───────── */
  function moverProyectiles(dt) {
    for (const p of proys) {
      if (p.vida <= 0) continue; p.vida -= dt;
      const d = PROY[p.tipo] || PROY.bala;
      if (p.objetivo && p.objetivo.activo && !p.objetivo.muriendo) { tmpV.set(p.objetivo.pos.x - p.m.position.x, p.objetivo.pos.y + (p.objetivo.pj.altura || 1.6) * 0.55 - p.m.position.y, p.objetivo.pos.z - p.m.position.z).normalize().multiplyScalar(d.vel); p.vel.lerp(tmpV, 1 - Math.exp(-dt * 5)); }
      p.vel.y -= d.g * dt; p.m.position.addScaledVector(p.vel, dt); if (p.tipo === "flecha" || p.tipo === "laser") p.m.lookAt(tmpV.copy(p.m.position).add(p.vel));
      if (p.tipo === "fuego" || p.tipo === "magia" || p.tipo === "enemigo") { if (rnd() < dt * 40) explosion(p.m.position, p.tipo === "magia" ? "#c89aff" : p.tipo === "enemigo" ? "#ff5a7a" : "#ffb13a", 1, 1, -1); p.m.rotation.x += dt * 5; }
      if (p.m.position.y < sueloEn(p.m.position.x, p.m.position.z).h) { p.vida = 0; explosion(p.m.position, "#aaaaaa", 5, 2); }
      if (p.deJugador) {
        const lista = enemigos.filter(e => e.activo && !e.muriendo); if (jefe && jefe.activo && !jefe.muriendo) lista.push(jefe);
        for (const en of lista) { const alt = (en.pj.altura || 1.5); if (Math.hypot(p.m.position.x - en.pos.x, p.m.position.z - en.pos.z) < (en.pj.radio || 0.5) + 0.6 && p.m.position.y > en.pos.y - 0.2 && p.m.position.y < en.pos.y + alt + 0.3) {
          herirEnemigo(en, p.danio, p.vel.x / 40, p.vel.z / 40); if (p.tipo === "fuego") explosion(p.m.position, "#ff8a2a", 16, 4); p.vida = 0; break; } }
      } else if (p.m.position.distanceTo(tmpV.set(jug.pos.x, jug.pos.y + 1, jug.pos.z)) < 1.0) { danio(p.danio, { tipo: "proyectil" }); p.vida = 0; }
      if (p.vida <= 0) p.m.visible = false;
    }
  }

  /* ───────── Obstáculos: movimiento y daño ───────── */
  function actualizarObstaculos(dt, t) {
    const vivo = NK.estado === "jugando";
    for (const o of obst) {
      const cercaZona = Math.abs(o.zona - P.zi) <= 1; if (!cercaZona) continue;
      o.t += dt; o.cd = Math.max(0, o.cd - dt);
      const dx = jug.pos.x - o.pos.x, dz = jug.pos.z - o.pos.z, d = Math.hypot(dx, dz), enPiso = jug.pos.y - o.pos.y < 0.6;
      switch (o.tipo) {
        case "pinchos": { const ciclo = o.t % 3, arriba = ciclo < 1.3; o.malla.position.y = o.pos.y + (arriba ? 0 : -0.55) + (ciclo > 2.6 ? (ciclo - 2.6) * 1.2 : 0);
          if (vivo && arriba && Math.abs(dx) < 1 && Math.abs(dz) < 1 && enPiso) { danio(15, o); jug.vel.y = 6; } break; }
        case "tronco": { if (!camino) break; o.u += dt * o.dir * 5 / Math.max(1, (o.b - o.a) * camino.L / camino.N); if (o.u > 1 || o.u < 0) { o.dir *= -1; o.u = NK.clamp(o.u, 0, 1); }
          const i = o.a + (o.b - o.a) * o.u; puntoCamino(i, 0, tmpV3); o.pos.set(tmpV3.x, alturaGrid(tmpV3.x, tmpV3.z) + 0.45, tmpV3.z);
          const tg = camino.tang[Math.round(i)]; o.giro = (o.giro || 0) + dt * o.dir * 11; o.malla.position.copy(o.pos); o.malla.rotation.order = "YXZ"; o.malla.rotation.set(o.giro, Math.atan2(tg.x, tg.z), 0);
          if (vivo && d < 1.6 && jug.pos.y < o.pos.y + 0.55 && o.cd <= 0) { o.cd = 1; danio(18, o); jug.vel.x += dx / (d || 1) * 9; jug.vel.z += dz / (d || 1) * 9; jug.vel.y = 5; } break; }
        case "lodo": if (d < o.r && enPiso) jug.lento = Math.min(jug.lento, 0.45); break;
        case "hielo": if (d < o.r && enPiso) jug.resbala = 1; break;
        case "zarzas": if (d < o.r && enPiso) { jug.lento = Math.min(jug.lento, 0.6); if (vivo && o.cd <= 0) { o.cd = 0.8; danio(5, o); } } break;
        case "fuego": { o.malla.children.forEach((f, k) => { f.scale.y = 1.0 + Math.sin(t * 9 + k * 1.7) * 0.35; f.scale.x = f.scale.z = 0.55 + Math.sin(t * 7 + k) * 0.1; });
          if (rnd() < dt * 12) explosion(tmpV.set(o.pos.x + (rnd() - 0.5) * 1.8, o.pos.y + 0.4, o.pos.z + (rnd() - 0.5) * 1.8), "#ff9a3a", 1, 1.2, -3);
          if (vivo && d < o.r && enPiso && o.cd <= 0) { o.cd = 0.5; danio(8, o); } break; }
        case "rocas": if (vivo && d < o.r * 2.2 && o.cd <= 0) { o.cd = 1.8 + rnd(); soltarRoca(jug.pos.x + (rnd() - 0.5) * 6 + jug.vel.x * 0.8, jug.pos.z + (rnd() - 0.5) * 6 + jug.vel.z * 0.8); } break;
        case "pendulo": { const a = Math.sin(o.t * 2.3) * 1.15; o.piv.rotation.x = a;
          const lx = Math.sin(a) * 3.8; tmpV.set(0, 5.4 - Math.cos(a) * 3.8, lx).applyAxisAngle(tmpV2.set(0, 1, 0), o.ang + Math.PI / 2).add(o.pos);
          if (vivo && Math.hypot(jug.pos.x - tmpV.x, jug.pos.z - tmpV.z) < 1.2 && Math.abs(jug.pos.y + 1 - tmpV.y) < 1.4 && o.cd <= 0) { o.cd = 1; danio(25, o); jug.vel.x += Math.cos(o.ang) * 9 * Math.sign(Math.cos(o.t * 2.3)); jug.vel.z -= Math.sin(o.ang) * 9 * Math.sign(Math.cos(o.t * 2.3)); } break; }
        case "trampa": { const cerrada = o.estado > 0; o.estado = Math.max(0, o.estado - dt);
          o.mandibulas.forEach((q, k) => { q.rotation.x = NK.lerp(q.rotation.x, cerrada ? (k ? -0.15 : 0.15) : (k ? -1.35 : 1.35), 1 - Math.exp(-dt * (cerrada ? 30 : 3))); });
          if (vivo && !cerrada && d < o.r && enPiso && o.cd <= 0) { o.estado = 1.4; o.cd = 6; jug.inmovil = 1.2; danio(12, o); NK.sonido("trampa"); NK.ui.aviso("🪤 ¡Trampa!", 1000); } break; }
      }
    }
    for (const r of rocas) { if (!r.activa) continue; r.t -= dt; const u = Math.max(0, r.t / 1.3);
      r.s.scale.setScalar(0.4 + (1 - u) * 1.4); r.s.material.opacity = 0.2 + (1 - u) * 0.4; r.m.position.set(r.pos.x, r.pos.y + 1 + u * u * 26, r.pos.z); r.m.rotation.x += dt * 4;
      if (r.t <= 0) { r.activa = false; r.m.visible = false; r.s.visible = false; explosion(tmpV.set(r.pos.x, r.pos.y + 0.5, r.pos.z), "#9a948a", 22, 6); NK.sonido("romper");
        if (vivo && Math.hypot(jug.pos.x - r.pos.x, jug.pos.z - r.pos.z) < 1.8 && jug.pos.y - r.pos.y < 2) danio(20, { tipo: "rocas" }); } }
  }

  /* ───────── Recoger, potenciadores, miradores, guías y puertas ───────── */
  function recoger(dt) {
    const radioIman = (jug.iman > 0 ? 9 : 0) + (TR.mejoras && TR.mejoras.has("iman_permanente") ? 4 : 0);
    for (const ob of objetos) {
      if (!ob.activo) continue;
      if (ob.plat) { ob.pos.x += ob.plat.dx || 0; ob.pos.z += ob.plat.dz || 0; }
      const d = Math.hypot(ob.pos.x - jug.pos.x, ob.pos.z - jug.pos.z);
      if (radioIman && d < radioIman && d > 0.5 && ob.zona === P.zi) { ob.pos.x += (jug.pos.x - ob.pos.x) * Math.min(1, dt * 5); ob.pos.z += (jug.pos.z - ob.pos.z) * Math.min(1, dt * 5); ob.pos.y = NK.lerp(ob.pos.y, jug.pos.y + 1, Math.min(1, dt * 4)); }
      if (d < 1.5 && Math.abs(ob.pos.y - (jug.pos.y + 0.9)) < 1.9) {
        if (NK.gancho("alRecoger", J, ob) === false) continue;
        ob.activo = false; explosion(ob.pos, ob.cfg.color || "#ffd23f", 16, 4);
        const ef = ob.cfg.efecto; if (ef === "vida") { jug.vida = Math.min(jug.vidaMax, jug.vida + 25); NK.sonido("vida"); } else if (ef === "velocidad") { jug.turbo = 6; NK.sonido("vida"); NK.ui.aviso("⚡ ¡Turbo!", 900); } else NK.sonido("moneda");
        jug.puntos += ob.cfg.valor || 10; TR.stats.recogidos++;
        if (ob.tipo === 0 && (ob.zona === P.zi || !CAMP)) { P.recogidos++; if (CAMP && zonaAct().objetivo.tipo === "recolectar" && P.recogidos >= P.total) TR.logro("recoger_todo", 1); }
      }
    }
    for (const p of potes) {
      if (!p.activo || Math.hypot(p.pos.x - jug.pos.x, p.pos.z - jug.pos.z) > 1.5 || Math.abs(p.pos.y - jug.pos.y - 1) > 2) continue;
      p.activo = false; NK.sonido("potenciador"); explosion(p.pos, "#" + new THREE.Color(POT[p.tipo]).getHexString(), 22, 5);
      switch (p.tipo) {
        case "curacion": jug.vida = Math.min(jug.vidaMax, jug.vida + 40); NK.ui.aviso("❤ +40 de vida", 1200); break;
        case "vida_extra": if (TR.activa) { TR.vidas++; NK.ui.vidas(TR.vidas); } else jug.vida = jug.vidaMax; NK.ui.aviso("💚 ¡Vida extra!", 1400); break;
        case "iman": jug.iman = 10; NK.ui.aviso("🧲 Imán (10 s)", 1200); break;
        case "escudo": jug.escudo = 7; NK.ui.aviso("🛡 Escudo (7 s)", 1200); break;
        case "turbo": jug.turbo = 7; NK.ui.aviso("⚡ Turbo (7 s)", 1200); break;
        case "furia": jug.furia = 9; NK.ui.aviso("🔥 Furia: daño doble (9 s)", 1400); break;
      }
      NK.gancho("alPotenciador", J, p);
    }
    for (const m of hitos.miradores) {
      if (m.visto || Math.hypot(m.pos.x - jug.pos.x, m.pos.z - jug.pos.z) > 3 || jug.pos.y < m.pos.y - 1.2) continue;
      m.visto = true; TR.stats.miradores++; jug.puntos += 50; m.haz.visible = false; m.est.material.color.setHex(0x9aa3ad);
      NK.sonido("logro"); NK.ui.banner("✦ Mirador", "+50 puntos · vista panorámica de " + ZONAS[m.zona].nombre, 3200); TR.logro("miradores", TR.stats.miradores);
      if (!NK.prueba && (!CAMP || (CAMP.vistas || {}).miradores !== false)) { camYaw = jug.yaw; tmpV3.copy(m.pos); if (camino) { const lim = camino.limites[m.zona]; puntoCamino((lim.ini + lim.fin) / 2, 0, tmpV3); tmpV3.y = camino.alt[Math.round((lim.ini + lim.fin) / 2)]; }
        camaraCine("orbita", 4.5, tmpV3); }
    }
    for (const n of npcs) { n.marcador.position.y = n.pos.y + 2.4 + Math.sin(P.t * 3) * 0.12; n.marcador.rotation.y += dt * 2; if (n.pj.mixer) n.pj.mixer.update(dt);
      if (n.zona === P.zi && !n.hablado && P.zi === 0 && n.pos.distanceTo(jug.pos) < 5 && NK.estado === "jugando" && !NK.prueba) hablarCon(n); }
  }
  function actualizarPuertas(t) {
    for (const pu of hitos.puertas) { if (!pu.barrera.visible) continue; pu.barrera.material.opacity = pu.abierta ? Math.max(0, pu.barrera.material.opacity - 0.02) : 0.28 + Math.sin(t * 3) * 0.08; if (pu.abierta && pu.barrera.material.opacity <= 0) pu.barrera.visible = false; }
  }

  /* ───────── Objetivo de la zona ───────── */
  function progresoZona() {
    const ob = zonaAct().objetivo;
    switch (ob.tipo) {
      case "recolectar": return P.recogidos / Math.max(1, P.total);
      case "derrotar": return P.derrotados / Math.max(1, P.total);
      case "sobrevivir": return 1 - P.tiempoRestante / Math.max(1, ob.cantidad || 60);
      case "llegar": if (camino) { const c = cercaCamino(jug.pos.x, jug.pos.z), lim = camino.limites[P.zi]; return NK.clamp((c.i - lim.ini) / (lim.fin - lim.ini), 0, 1); } return 0;
      case "carrera": return jug.progreso / Math.max(1, P.total);
      case "jefe": return jefe && jefe.presentado ? 1 - jefe.vida / jefe.vidaMax : 0;
    }
    return 0;
  }
  function completarZona() {
    if (P.completa && zonaAct().objetivo.tipo !== "jefe") return;
    P.completa = true; jug.puntos += 100;
    const pu = hitos.puertas.find(q => q.zona === P.zi); if (pu) { pu.abierta = true; NK.sonido("zona"); }
    if (TR.activa) { TR.stats.puntos = jug.puntos; TR.zonaCompleta(); }
    else NK.terminar(true, finTexto());
  }
  function finTexto() { const ob = zonaAct().objetivo;
    return { recolectar: `¡Recogiste todo! Puntos: ${jug.puntos} · Tiempo: ${Math.round(P.t)} s`, derrotar: `¡Derrotaste a todos! Puntos: ${jug.puntos}`, sobrevivir: `¡Sobreviviste! Puntos: ${jug.puntos}`,
      llegar: `¡Llegaste a la meta en ${Math.round(P.t)} s! Puntos: ${jug.puntos}`, carrera: `¡Ganaste la carrera en ${Math.round(P.t)} s!`, jefe: `¡Derrotaste al jefe! Puntos: ${jug.puntos}` }[ob.tipo] || `Puntos: ${jug.puntos}`; }
  function objetivos(dt) {
    const z = zonaAct(), ob = z.objetivo; let prog = "";
    TR.stats.t += dt; TR.stats.tZona += dt;
    if (!P.completa) switch (ob.tipo) {
      case "recolectar": prog = `${(C.objetos[0] || {}).nombre || "Objetos"}: ${P.recogidos}/${P.total}`; if (P.recogidos >= P.total) completarZona(); break;
      case "derrotar": prog = `Derrotados: ${P.derrotados}/${P.total}`; if (P.derrotados >= P.total) completarZona(); break;
      case "sobrevivir": P.tiempoRestante -= dt; prog = `Resiste: ${Math.max(0, Math.ceil(P.tiempoRestante))} s`; if (P.tiempoRestante <= 0) completarZona(); break;
      case "llegar": { const d = meta && meta.grupo.visible ? Math.hypot(meta.pos.x - jug.pos.x, meta.pos.z - jug.pos.z) : 0; prog = `Meta a ${Math.round(d)} m`; if (meta && d < 2.4 && Math.abs(jug.pos.y - meta.pos.y) < 3) completarZona(); break; }
      case "carrera": {
        const n = pista.checkpoints; let best = 0, bd = 1e9; for (let i = 0; i < pista.N; i += 2) { const s = pista.muestras[i], d = (s.x - jug.pos.x) ** 2 + (s.z - jug.pos.z) ** 2; if (d < bd) { bd = d; best = i; } }
        const prox = Math.floor(best / pista.N * n);
        if (prox === (jug.cp + 1) % n) { jug.cp = prox; if (prox === 0) { jug.vuelta++; NK.sonido("moneda"); if (jug.vuelta < P.total) NK.ui.aviso(`Vuelta ${jug.vuelta + 1}/${P.total}`); } }
        jug.progreso = jug.vuelta + best / pista.N;
        P.posicion = 1 + enemigos.filter(e => e.activo && e.cfg.comportamiento === "rival" && e.vuelta + e.pista > jug.progreso).length;
        prog = `Vuelta ${Math.min(P.total, jug.vuelta + 1)}/${P.total} · Posición ${P.posicion}/${1 + enemigos.filter(e => e.cfg.comportamiento === "rival").length}`;
        if (jug.vuelta >= P.total) { if (P.posicion === 1) completarZona(); else { P.completa = true; P.fallo = true; if (TR.activa) TR.morir(`Terminaste en la posición ${P.posicion}`); else NK.terminar(false, `Terminaste en la posición ${P.posicion}.`); } }
        break; }
      case "jefe": {
        if (jefe && !jefe.presentado && camino) { const c = cercaCamino(jug.pos.x, jug.pos.z); if (c.i > camino.limites[NZ - 1].ini + (camino.limites[NZ - 1].fin - camino.limites[NZ - 1].ini) * 0.35) presentarJefe(); }
        else if (jefe && !jefe.presentado && !camino) presentarJefe();
        prog = jefe && jefe.presentado ? `${jefe.cfg.nombre}: ${Math.max(0, Math.round(jefe.vida / jefe.vidaMax * 100))} %` : "Avanza hasta la guarida"; break; }
      default: prog = `Puntos: ${jug.puntos}`;
    }
    else prog = zonaAct().objetivo.tipo === "jefe" ? "¡Victoria!" : "✔ Zona completada: ¡sigue el camino!";
    if (!P.completa && z.contratiempo && !P.contraHecho && progresoZona() >= (z.contratiempo.momento || 0.5)) iniciarContratiempo(z.contratiempo);
    actualizarContratiempo(dt);
    if (ob.tiempo > 0 && ob.tipo !== "sobrevivir" && !P.completa) { P.tiempoRestante -= dt; if (P.tiempoRestante <= 0) { P.completa = true; P.fallo = true; if (TR.activa) TR.morir("¡Se acabó el tiempo!"); else NK.terminar(false, "¡Se acabó el tiempo!"); } }
    const efectos = []; if (jug.escudo > 0) efectos.push(`🛡 ${Math.ceil(jug.escudo)} s`); if (jug.turbo > 0) efectos.push(`⚡ ${Math.ceil(jug.turbo)} s`); if (jug.iman > 0) efectos.push(`🧲 ${Math.ceil(jug.iman)} s`); if (jug.furia > 0) efectos.push(`🔥 ${Math.ceil(jug.furia)} s`);
    if (NK.ui.efectos && (P.t * 4 | 0) !== P._ef) { P._ef = P.t * 4 | 0; NK.ui.efectos(efectos); }
    NK.ui.datos({ vida: jug.vida, vidaMax: jug.vidaMax, puntos: jug.puntos, objetivo: ob.texto || "", progreso: prog, tiempo: ob.tiempo > 0 || ob.tipo === "sobrevivir" ? P.tiempoRestante : undefined });
    brujula();
  }
  function brujula() {
    if (!NK.ui.brujula) return;
    let obj = null, txt = "";
    if (P.completa && camino && P.zi < NZ - 1) { const pu = hitos.puertas.find(q => q.zona === P.zi); if (pu) { obj = pu.pos; txt = "Puerta"; } }
    else if (!P.completa) {
      const ob = zonaAct().objetivo.tipo;
      if (ob === "recolectar") { let bd = 1e9; for (const o of objetos) { if (!o.activo || o.tipo !== 0 || (CAMP && o.zona !== P.zi)) continue; const d = (o.pos.x - jug.pos.x) ** 2 + (o.pos.z - jug.pos.z) ** 2; if (d < bd) { bd = d; obj = o.pos; } } txt = (C.objetos[0] || {}).nombre || ""; }
      else if (ob === "llegar" && meta && meta.grupo.visible) { obj = meta.pos; txt = "Meta"; }
      else if (ob === "jefe" && camino) { obj = jefe && jefe.presentado ? jefe.pos : puntoCamino(camino.limites[NZ - 1].fin - 2, 0, tmpV3).clone(); txt = jefe && jefe.presentado ? "Jefe" : "Guarida"; }
      else if (ob === "derrotar") { let bd = 1e9; for (const e of enemigos) { if (!e.activo || e.muriendo) continue; const d = (e.pos.x - jug.pos.x) ** 2 + (e.pos.z - jug.pos.z) ** 2; if (d < bd) { bd = d; obj = e.pos; } } txt = "Enemigo"; }
    }
    if (!obj || VEHICULO) { NK.ui.brujula(null); return; }
    const ang = Math.atan2(obj.x - jug.pos.x, obj.z - jug.pos.z), camA = camYaw + Math.PI;
    NK.ui.brujula(-(ang - camA), Math.hypot(obj.x - jug.pos.x, obj.z - jug.pos.z), txt);
  }

  /* ───────── API para juego.js (window.J) ───────── */
  const J = window.J = {
    C, THREE, escena, camara, renderer, jugador: jug, enemigos, objetos, partida: P, alturaEn: (x, z) => sueloEn(x, z).h, plataformas, meta: () => meta, jefe: () => jefe, zona: () => zonaAct(),
    zonaIndice: () => P.zi, zonas: ZONAS, obstaculos: obst, npcs, potenciadores: potes, camino: () => camino,
    aviso: (t, ms) => NK.ui.aviso(t, ms), banner: (t, s, ms) => NK.ui.banner(t, s, ms), sonido: t => NK.sonido(t), sumarPuntos: n => { jug.puntos += n; }, danio, curar: n => { jug.vida = Math.min(jug.vidaMax, jug.vida + n); },
    ganar: t => { if (TR.activa) completarZona(); else NK.terminar(true, t); }, perder: t => (TR.activa ? TR.morir(t) : NK.terminar(false, t)), completarZona,
    explosion: (x, y, z, color, n) => explosion(new V3(x, y, z), color || "#ffffff", n || 18), reaparecerEnemigo: en => spawnEnemigo(en), herirEnemigo, soltarRoca, disparar,
    contratiempo: tipo => iniciarContratiempo({ tipo, texto: "", momento: 0 }), cambiarArma, geometrias: GEO, materialColores: matVC, fusionar, parte
  };

  /* ───────── Bucle ───────── */
  function bajarCalidad(fps) {
    const pr = renderer.getPixelRatio();
    if (pr > 0.62) { renderer.setPixelRatio(Math.max(0.6, pr - 0.15)); renderer.setSize(innerWidth, innerHeight); console.info("Noviq: FPS bajos (" + fps + "): resolución " + renderer.getPixelRatio().toFixed(2)); }
    else if (renderer.shadowMap.enabled) { renderer.shadowMap.enabled = false; sol.castShadow = false; escena.traverse(o => { if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.needsUpdate = true); }); console.info("Noviq: sombras desactivadas para ganar FPS"); }
  }
  let ultimo = performance.now(), frame = 0, tPlat = 0;
  function bucle(ahora) {
    requestAnimationFrame(bucle);
    const dt = Math.min(0.05, (ahora - ultimo) / 1000); ultimo = ahora; frame++;
    if (document.hidden) return;
    const jugando = NK.estado === "jugando", cineOn = NK.estado === "cine" || !!cine.modo;
    if (!jugando && !cineOn && frame % 2) return;
    const tt = ahora / 1000;
    if (jugando && !cine.modo) {
      P.t += dt;
      moverJugador(dt); moverEnemigos(dt); moverJefe(dt); moverProyectiles(dt); recoger(dt);
      NK.gancho("alActualizar", J, dt);
      if (NK.estado === "jugando") objetivos(dt);
      NK.medirFPS(dt, bajarCalidad);
    } else if (NK.estado === "menu") { camYaw += dt * 0.12; }
    if (PJ.mixer && !jugando) PJ.mixer.update(dt);
    actualizarObstaculos(jugando && !cine.modo ? dt : 0, tt);
    tPlat += dt; actualizarPlataformas(tPlat); dibujarObjetos(tt); dibujarPotenciadores(tt); actualizarParticulas(dt); actualizarPuertas(tt); actualizarAmbiente(dt);
    if (meta && meta.grupo.visible) { meta.aro.rotation.z += dt; if (meta.plat) { meta.pos.set(meta.plat.x, meta.plat.y, meta.plat.z); meta.grupo.position.copy(meta.pos); } }
    lluvia.visible = amb.lluvia > 0.3 || amb.nieve > 0.3;
    if (lluvia.visible) { lluvia.material.color.setHex(amb.nieve > 0.3 ? 0xffffff : 0xaac4e8); lluvia.material.size = amb.nieve > 0.3 ? 0.2 : 0.09; lluvia.position.set(camara.position.x, camara.position.y, camara.position.z);
      const pp = gLL.attributes.position; for (let i = 1; i < pp.array.length; i += 3) { pp.array[i] -= dt * (amb.nieve > 0.3 ? 3 : 24); if (pp.array[i] < -30) pp.array[i] += 60; } pp.needsUpdate = true; }
    if (agua) { agua.position.y = nivelAgua + Math.sin(ahora / 1400) * 0.05; if (texAguaN) { texAguaN.offset.x = tt * 0.01; texAguaN.offset.y = tt * 0.006; } }
    if (matHierba && matHierba.userData.u) matHierba.userData.u.uT.value = tt;
    cieloU.tiempo.value = tt;
    actualizarCamara(dt);
    sol.position.set(jug.pos.x + 45, jug.pos.y + 20 + amb.alt * 70, jug.pos.z + 30); sol.target.position.copy(jug.pos);
    if (linterna.intensity > 0) { linterna.position.set(jug.pos.x, jug.pos.y + 1.6, jug.pos.z); camara.getWorldDirection(tmpV); linterna.target.position.set(jug.pos.x + tmpV.x * 10, jug.pos.y + 1.2 + tmpV.y * 10, jug.pos.z + tmpV.z * 10); }
    cielo.position.copy(camara.position);
    renderer.render(escena, camara);
    NK.finFrame();
  }
  addEventListener("resize", () => { camara.aspect = innerWidth / innerHeight; camara.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight); });
  NK._estado = () => ({ estado: NK.estado, puntos: jug.puntos, vida: Math.round(jug.vida), objetivo: { tipo: zonaAct().objetivo.tipo, hecho: ({ recolectar: P.recogidos, derrotar: P.derrotados, carrera: jug.vuelta, jefe: jefe && jefe.presentado ? Math.round((1 - jefe.vida / jefe.vidaMax) * 100) : 0 })[zonaAct().objetivo.tipo] ?? Math.round(P.t), total: P.total },
    completa: P.completa, tiempo: Math.round(P.t * 10) / 10, fps: NK.fps.valor, jugador: { x: +jug.pos.x.toFixed(2), y: +jug.pos.y.toFixed(2), z: +jug.pos.z.toFixed(2) }, enemigosActivos: enemigos.filter(e => e.activo).length,
    objetosRestantes: objetos.filter(o => o.activo && (!CAMP || o.zona === P.zi)).length, jefe: jefe ? { activo: jefe.activo, vida: Math.round(jefe.vida) } : null, contratiempo: P.contra ? P.contra.tipo : null,
    obstaculos: obst.length, dibujos: renderer.info.render.calls, triangulos: renderer.info.render.triangles, geometrias: renderer.info.memory.geometries, texturas: renderer.info.memory.textures, motor: "3d", calidad: Q.nivel });

  /* ───────── Travesía: lo que la capa común (comun.js) le pide al motor ───────── */
  const adaptador = {
    async preparar(traje, arma, dif) {
      const rol = traje && traje.modelo ? traje.modelo : "jugador";
      Object.values(modelosJ).forEach(p => { p.grupo.visible = false; });
      PJ = modeloJugador(rol, traje && traje.color); await PJ.listo; PJ.grupo.visible = true;
      jug.mult = { vida: (traje && traje.vida) || 1, vel: (traje && traje.velocidad) || 1, salto: (traje && traje.salto) || 1, danio: 1, cad: 1, alc: 1 };
      jug.vidaMax = Math.round(C.jugador.vida * jug.mult.vida); jug.vida = jug.vidaMax; jug.puntos = 0; P.derrotadosTotal = 0;
      equiparArma(arma || ARMAS[0] || null);
      for (const m of hitos.miradores) { m.visto = false; m.haz.visible = true; m.est.material.color.setHex(0xffe27a); }
      for (const n of npcs) { n.hablado = false; n.marcador.material.color.setHex(0xffd23f); }
      for (const p of potes) p.activo = true;
      colocarObjetos(); prepararZona(0, true);
    },
    cine(tipo) { if (tipo === "intro" && camino) { camaraCine("intro", 3 * 2.8 + 0.5); } else cine.modo = null; },
    async zona(i, z) {
      prepararZona(i, false); P.fallo = false;
      jug.vida = jug.vida <= 0 ? jug.vidaMax : Math.max(jug.vida, Math.round(jug.vidaMax * 0.6));  // el punto de control cura
      if (i > 0) { const disp = TR.armasDisponibles(); if (armaAct && !disp.includes(armaAct)) equiparArma(disp[0]); else if (NK.ui.arma) NK.ui.arma(armaAct, disp.length); }
    },
    respawn() { if (P.fallo) { P.fallo = false; prepararZona(P.zi, false); } else irA(P.zi); jug.vida = jug.vidaMax; jug.invul = 2; if (jefe && jefe.presentado && jefe.activo) { jefe.vida = Math.min(jefe.vidaMax, jefe.vida + jefe.vidaMax * 0.15); NK.ui.jefe(jefe.cfg.nombre, jefe.vida / jefe.vidaMax); }
      enemigos.forEach(e => { if (e.activo && e.pos.distanceTo(jug.pos) < 10) { e.pos.x += 12; e.pos.z += 12; } }); NK.estado = "jugando"; },
    mejora(id) { const m = jug.mult;
      if (id === "danio_extra") m.danio *= 1.25; else if (id === "vida_max") { jug.vidaMax += 25; jug.vida += 25; } else if (id === "velocidad") m.vel *= 1.12; else if (id === "cadencia") m.cad *= 0.8; else if (id === "alcance") m.alc *= 1.3; }
  };
  function reiniciar() {  // Reiniciar sin travesía (modo clásico) o antes de volver a empezar la travesía
    jug.vida = jug.vidaMax; jug.puntos = 0; jug.invul = 1.5; jug.turbo = 0; jug.escudo = 0; jug.furia = 0; jug.iman = 0; jug.velAuto = 0; jug.vel.set(0, 0, 0);
    P.t = 0; P.derrotadosTotal = 0; balasOff(); colocarObjetos(); for (const p of potes) p.activo = true;
    prepararZona(0, true);
    NK.gancho("alIniciar", J);
  }
  function balasOff() { proys.forEach(b => { b.vida = 0; b.m.visible = false; }); rocas.forEach(r => { r.activa = false; r.m.visible = false; r.s.visible = false; }); }

  /* ───────── Arranque: se construye el mundo, se esperan los modelos y se muestra el menú ───────── */
  objetivoAmbiente(ZONAS[0], true); actualizarAmbiente(0.016); ambienteIBL("inicio");
  colocarHitos(); ponerDecoracion(); ponerHierba(); prepararObjetos(); colocarObstaculos(); colocarPotenciadores();
  if (ZONAS.some(z => z.objetivo.tipo === "llegar")) prepararMeta();
  Promise.all([...cargas, PJ.listo, ...enemigos.map(e => e.pj.listo), ...(jefe ? [jefe.pj.listo] : []), ...npcs.map(n => n.pj.listo)]).then(() => {
    NK.iniciar(() => { jug.invul = Math.max(jug.invul, 1); }, reiniciar, CAMP ? adaptador : null);
    equiparArma(ARMAS[0] || null);
    reiniciar(); camara.position.set(jug.pos.x + 8, jug.pos.y + 6, jug.pos.z + 8);
    requestAnimationFrame(bucle);
  }).catch(e => NK.error("No se pudo iniciar el juego: " + (e && e.message || e)));
})();
