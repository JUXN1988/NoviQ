/* Noviq — ✍ Taller de prompts + 🎮 Estudio de juegos (se carga después de app.js y usa sus utilidades).
   - Barra sobre la caja de mensaje: corregir ortografía/sintaxis, prompt profesional, estructurar, más específico, inglés,
     plantillas y piezas, medidor de calidad del prompt, deshacer y ver cambios.
   - Detector multilingüe de videojuegos: mientras escribes sugiere el Estudio; al enviar lo abre solo (⚙ Ajustes → Juegos).
   - Estudio de juegos: tu PC → estilo → idea (o una sugerencia) → diseño con IA → tus modelos 3D (📁 carpeta estándar docs/3D)
     + activos 3D libres → IA de NVIDIA → crear y jugar. */
"use strict";
(function () {
  const LANG_EN = () => window.NOVIQ_LANG === "en";
  const tr = (es, en) => (LANG_EN() ? en : es);
  const inpEl = () => $("#inp");

  /* ═════════════ ✍ TALLER DE PROMPTS ═════════════ */
  const PT = {pila: [], datos: null, ultimo: null, tLocal: null, ocupado: false};
  const NOMBRE_ACC = {corregir: "🔤 Corregido", profesional: "✨ Prompt profesional", estructurar: "🧱 Estructurado", especifico: "🎯 Más específico",
    ingles: "🌐 Traducido", juego: "🎮 Prompt de juego", resumir: "✂ Resumido"};
  function ponerTexto(nuevo) {
    const el = inpEl(); el.focus(); el.select();
    let ok = false; try { ok = document.execCommand("insertText", false, nuevo); } catch (e) {}
    if (!ok || el.value !== nuevo) el.value = nuevo;  // execCommand conserva Ctrl+Z nativo
    el.dispatchEvent(new Event("input")); el.setSelectionRange(0, 0); el.scrollTop = 0;
  }
  function difPalabras(a, b) {  // diferencias palabra a palabra (LCS) para «Ver cambios»
    const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
    if (A.length * B.length > 250000) return `<del>${esc(a)}</del>\n\n<ins>${esc(b)}</ins>`;
    const n = A.length, m = B.length, dp = Array.from({length: n + 1}, () => new Uint16Array(m + 1));
    for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    let i = 0, j = 0, out = "";
    while (i < n && j < m) { if (A[i] === B[j]) { out += esc(A[i]); i++; j++; } else if (dp[i + 1][j] >= dp[i][j + 1]) { out += `<del>${esc(A[i])}</del>`; i++; } else { out += `<ins>${esc(B[j])}</ins>`; j++; } }
    while (i < n) out += `<del>${esc(A[i++])}</del>`; while (j < m) out += `<ins>${esc(B[j++])}</ins>`;
    return out;
  }
  function mensaje(html) { $("#ptMsg").innerHTML = html; }
  async function accion(acc) {
    const el = inpEl(), t = el.value.trim();
    if (!t) { toast(tr("✍ Escribe primero tu instrucción en la caja; luego la corrijo o la convierto en un prompt profesional.", "✍ Type your instruction first; then I can fix it or turn it into a professional prompt.")); el.focus(); return; }
    if (PT.ocupado) return;
    PT.ocupado = true; $$("#ptools button[data-pa]").forEach(b => b.disabled = true);
    const btn = document.querySelector(`#ptools [data-pa="${acc}"]`); if (btn) btn.classList.add("run");
    mensaje(`<span class="spin"></span> ${tr("Trabajando en tu prompt con la IA más rápida…", "Working on your prompt with the fastest AI…")}`);
    try {
      const r = await jpost("/api/prompt", {accion: acc, texto: t, idioma: window.NOVIQ_LANG || "es"});
      if (!r.ok) { mensaje(`<span class="bad-t">✖ ${esc(r.error || "error")}</span>`); return; }
      PT.pila.push(el.value); PT.ultimo = {antes: el.value, despues: r.texto};
      ponerTexto(r.texto);
      $("#ptUndo").style.display = "";
      const quien = r.local ? tr("solo corrección local", "local fixes only") : `${esc((r.modelo || "").split("::").pop())} · ${(r.ms / 1000).toFixed(1)} s`;
      mensaje(`${NOMBRE_ACC[acc] || "✔"} (${quien})${r.cambios && r.cambios.length ? ` · ${r.cambios.length} ${tr("correcciones rápidas", "quick fixes")}` : ""}
        <button class="linkbtn" data-m="ver">${tr("Ver cambios", "Show changes")}</button><button class="linkbtn" data-m="undo">↩ ${tr("Deshacer", "Undo")}</button><button class="linkbtn" data-m="x">✕</button>
        ${r.aviso ? `<div class="bad-t">⚠ ${esc(r.aviso)}</div>` : ""}`);
      bindMsg();
    } catch (e) { mensaje(`<span class="bad-t">✖ ${esc(e.message || e)}</span>`); }
    finally { PT.ocupado = false; $$("#ptools button[data-pa]").forEach(b => { b.disabled = false; b.classList.remove("run"); }); calidad(); }
  }
  function bindMsg() {
    const m = $("#ptMsg");
    const v = m.querySelector("[data-m=ver]"); if (v) v.onclick = () => { const d = m.querySelector(".dif"); if (d) { d.remove(); return; } const x = document.createElement("div"); x.className = "dif"; x.innerHTML = difPalabras(PT.ultimo.antes, PT.ultimo.despues); m.append(x); };
    const u = m.querySelector("[data-m=undo]"); if (u) u.onclick = deshacer;
    const c = m.querySelector("[data-m=x]"); if (c) c.onclick = () => mensaje("");
  }
  function deshacer() {
    if (!PT.pila.length) return;
    ponerTexto(PT.pila.pop()); if (!PT.pila.length) $("#ptUndo").style.display = "none";
    mensaje(`↩ ${tr("Texto anterior restaurado.", "Previous text restored.")}`);
  }
  // Calidad del prompt (heurística local e instantánea)
  const RX = {
    objetivo: /\b(crea|cre[aá]me|haz|hazme|genera|escribe|programa|desarrolla|dise[ñn]a|analiza|explica|corrige|arregla|revisa|mejora|traduce|resume|calcula|busca|convierte|automatiza|instala|optimiza|make|create|build|write|fix|explain|analy[sz]e|generate|improve|translate)\b/i,
    contexto: /\b(tengo|tenemos|mi |mis |nuestro|actual|existente|ya funciona|carpeta|archivo|proyecto|porque|para (que|mi|un)|usuarios?|cliente|i have|my |current|existing|project|file)\b|[A-Za-z]:\\/i,
    requisitos: /(^|\n)\s*(\d+[.)]|[-*•])\s|\b(debe|deben|tiene que|que tenga|necesito que|requisitos?|incluy|con (un|una|botones|men[uú])|must|should|include|requirements?)\b/i,
    restricciones: /\b(no (debe|uses?|dañes|rompas|borres|cambies|toques)|sin (romper|usar|internet|librer)|evita|solo |[uú]nicamente|m[aá]ximo|m[ií]nimo|l[ií]mite|don'?t|avoid|only|without)\b/i,
    formato: /\b(formato|en (excel|word|pdf|json|csv|una tabla|una lista|markdown)|\.(py|js|html|xlsx|docx|pdf|csv|json)\b|archivo|tabla|lista|c[oó]digo|informe|gr[aá]fico|pasos|format|table|list|report)\b/i,
    criterios: /\b(que funcione|funcione sin errores|pru[eé]ba(lo)?|verifica|comprueba|criterios?|aceptaci[oó]n|listo cuando|test|verify|acceptance|make sure)\b/i,
  };
  const NOMBRES_CAL = {objetivo: tr("qué quieres (verbo claro)", "a clear goal"), contexto: tr("contexto (qué hay ya)", "context"),
    requisitos: tr("requisitos concretos", "concrete requirements"), restricciones: tr("restricciones (qué no hacer)", "constraints"),
    formato: tr("formato del resultado", "output format"), criterios: tr("cómo comprobar que quedó bien", "acceptance criteria"), largo: tr("más detalle", "more detail")};
  function evaluar(t) {
    const pal = (t.match(/\S+/g) || []).length, falta = [];
    let p = Math.min(25, pal * 1.4);
    for (const [k, w] of Object.entries({objetivo: 18, contexto: 12, requisitos: 14, restricciones: 10, formato: 11, criterios: 10})) { if (RX[k].test(t)) p += w; else falta.push(k); }
    if (pal < 8) falta.push("largo");
    return {p: Math.round(Math.min(100, p)), falta};
  }
  function calidad() {
    const t = inpEl().value.trim(), c = $("#ptCal");
    if (!t) { c.innerHTML = ""; return; }
    const {p, falta} = evaluar(t), col = p >= 75 ? "var(--accent)" : p >= 45 ? "var(--warn)" : "var(--danger)";
    c.innerHTML = `${tr("Calidad", "Quality")}<i><b style="width:${p}%;background:${col}"></b></i>${p}`;
    c.title = falta.length ? tr("Para mejorarlo agrega: ", "To improve it add: ") + falta.map(f => NOMBRES_CAL[f]).join(", ") + tr(". Clic: consejos.", ". Click: tips.") : tr("¡Prompt completo!", "Complete prompt!");
  }
  function mostrarConsejos() {
    const t = inpEl().value.trim(); if (!t) return;
    const {p, falta} = evaluar(t), pop = $("#ptPop");
    pop.innerHTML = `<b>${tr("Calidad del prompt", "Prompt quality")}: ${p}/100</b>
      <ul class="tips">${falta.map(f => `<li>➕ ${esc(NOMBRES_CAL[f])}</li>`).join("") || `<li>✅ ${tr("Tiene todo lo importante.", "It has everything important.")}</li>`}</ul>
      <div class="gs-row"><button class="btn ok" data-a="pro">✨ ${tr("Hacerlo profesional con IA", "Make it professional with AI")}</button><button class="btn" data-a="piezas">＋ ${tr("Agregar piezas", "Add pieces")}</button><button class="btn" data-a="x">✕</button></div>`;
    pop.classList.add("show");
    pop.querySelector("[data-a=pro]").onclick = () => { pop.classList.remove("show"); accion("profesional"); };
    pop.querySelector("[data-a=piezas]").onclick = () => mostrarLista("piezas");
    pop.querySelector("[data-a=x]").onclick = () => pop.classList.remove("show");
  }
  async function mostrarLista(que) {
    const pop = $("#ptPop");
    if (pop.classList.contains("show") && pop.dataset.que === que) { pop.classList.remove("show"); return; }
    if (!PT.datos) { try { PT.datos = await jget("/api/prompt/plantillas"); } catch (e) { toast("No pude cargar las plantillas"); return; } }
    const lista = que === "plantillas" ? PT.datos.plantillas : PT.datos.piezas;
    pop.dataset.que = que;
    pop.innerHTML = `<div class="small" style="margin-bottom:6px">${que === "plantillas" ? tr("Plantillas profesionales: elige una y rellena lo que está entre [corchetes] (Tab salta al siguiente).", "Professional templates: pick one and fill the [brackets] (Tab jumps to the next).") : tr("Piezas de un buen prompt: se agregan al final de lo que escribiste.", "Pieces of a good prompt: added at the end.")}</div>
      <div class="pp">${lista.map((x, i) => `<button data-i="${i}" title="${esc(x.texto)}">${esc(x.icono ? x.icono + " " + x.nombre : x.nombre)}</button>`).join("")}</div>`;
    pop.classList.add("show");
    pop.querySelectorAll("[data-i]").forEach(b => b.onclick = () => {
      const x = lista[+b.dataset.i], el = inpEl(), actual = el.value.trim();
      PT.pila.push(el.value); $("#ptUndo").style.display = "";
      if (que === "plantillas") { if (actual && !confirm(tr("¿Reemplazar lo que escribiste por la plantilla? (Cancelar = agregarla al final)", "Replace your text with the template? (Cancel = append)"))) ponerTexto(actual + "\n\n" + x.texto); else ponerTexto(x.texto); saltarMarcador(0); }
      else ponerTexto((actual ? actual + "\n" : "") + x.texto);
      pop.classList.remove("show");
    });
  }
  function saltarMarcador(desde) {  // selecciona el siguiente [marcador] para escribir encima
    const el = inpEl(), rx = /\[[^\]\n]{2,80}\]/g; rx.lastIndex = desde; let m = rx.exec(el.value);
    if (!m && desde > 0) { rx.lastIndex = 0; m = rx.exec(el.value); }
    if (m) { el.focus(); el.setSelectionRange(m.index, m.index + m[0].length); return true; }
    return false;
  }
  function revisarLocal() {
    clearTimeout(PT.tLocal);
    const t = inpEl().value;
    if ((CFG.prompt_tools || {}).correccion_local === false || t.trim().length < 3) { $("#ptN").textContent = ""; return; }
    PT.tLocal = setTimeout(async () => {
      try { const r = await jpost("/api/prompt", {accion: "local", texto: t});
        const n = (r.cambios || []).filter(c => !/espacios/.test(c)).length; $("#ptN").textContent = n ? String(n) : "";
        $("#ptN").title = (r.cambios || []).join(" · "); } catch (e) {}
    }, 900);
  }
  function montarBarra() {
    $$("#ptools [data-pa]").forEach(b => b.onclick = () => accion(b.dataset.pa));
    $("#ptPlant").onclick = () => mostrarLista("plantillas");
    $("#ptPiezas").onclick = () => mostrarLista("piezas");
    $("#ptUndo").onclick = deshacer;
    $("#ptCal").onclick = mostrarConsejos;
    const el = inpEl();
    el.addEventListener("input", () => { calidad(); revisarLocal(); detectarMientrasEscribe(); });
    el.addEventListener("keydown", e => {
      if (e.ctrlKey && e.altKey && (e.key === "c" || e.key === "C")) { e.preventDefault(); accion("corregir"); }
      else if (e.ctrlKey && e.altKey && (e.key === "m" || e.key === "M")) { e.preventDefault(); accion("profesional"); }
      else if (e.key === "Tab" && !e.shiftKey && /\[[^\]\n]{2,80}\]/.test(el.value)) { if (saltarMarcador(el.selectionEnd)) e.preventDefault(); }
    });
    $("#ptools").style.display = (CFG.prompt_tools || {}).barra === false ? "none" : "";
  }

  /* ═════════════ 🎮 DETECTOR DE VIDEOJUEGOS (misma lógica que noviq/intencion.py) ═════════════ */
  const GJ = {lex: null, descartado: new Set(), t: null};
  const norm = s => (s || "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
  const latino = s => /[a-z0-9]/.test(s) && [...s].every(c => c.charCodeAt(0) < 0x250);
  function dl1(a, b) {
    if (a === b) return true; const la = a.length, lb = b.length; if (Math.abs(la - lb) > 1) return false;
    if (la === lb) { const d = []; for (let i = 0; i < la; i++) if (a[i] !== b[i]) d.push(i); return d.length === 1 || (d.length === 2 && d[1] === d[0] + 1 && a[d[0]] === b[d[1]] && a[d[1]] === b[d[0]]); }
    if (la > lb) [a, b] = [b, a]; for (let i = 0; i < b.length; i++) if (a === b.slice(0, i) + b.slice(i + 1)) return true; return false;
  }
  function buscar(lista, txt, toks, difuso) {
    const hits = [];
    for (const f of lista) {
      if (latino(f)) {
        if (/[ .\-]/.test(f)) { if (new RegExp("(?<![a-z0-9])" + f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9])").test(txt)) hits.push(f); }
        else if (toks.has(f)) hits.push(f);
        else if (difuso && f.length >= 7) { for (const t of toks) if (t.length >= 6 && dl1(f, t)) { hits.push(f + "~"); break; } }
      } else if (txt.includes(f)) hits.push(f);
    }
    return hits;
  }
  function detectarJuego(texto) {
    const L = GJ.lex; if (!L) return {juego: false, confianza: 0};
    let txt = norm(texto).slice(0, 4000);
    for (const n of L.negativas) txt = txt.replace(new RegExp("(?<![a-z0-9])" + n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "(?![a-z0-9])", "g"), " ");
    const toks = new Set(txt.match(/[a-z0-9ñ]+/g) || []);
    let f = buscar(L.fuertes, txt, toks, true); if (f.some(h => !h.endsWith("~"))) f = f.filter(h => !h.endsWith("~"));
    const a = buscar(L.apoyo, txt, toks), v = buscar(L.verbos, txt, toks).length > 0;
    let c = f.length ? 0.7 + (v ? 0.2 : 0) + 0.05 * Math.min(3, a.length) + (f.length > 1 ? 0.05 : 0) : (a.length >= 3 || (a.length >= 2 && v)) ? 0.62 : (a.length && v) ? 0.35 : 0.1 * a.length;
    c = Math.min(1, Math.round(c * 100) / 100);
    return {juego: c >= 0.6, confianza: c, abrir: c >= 0.7 && (v || c >= 0.8), palabras: [...f, ...a]};
  }
  const detectorModo = () => ((CFG.juegos || {}).detector || (GJ.lex && GJ.lex.detector) || "auto");
  function detectarMientrasEscribe() {
    clearTimeout(GJ.t);
    GJ.t = setTimeout(() => {
      const d = detectarJuego(inpEl().value), clave = convId || "nuevo";
      $("#ptJuego").style.display = d.juego || ES.modoConv ? "" : "none";
      const h = $("#gameHint");
      if (!d.juego || detectorModo() === "apagado" || GJ.descartado.has(clave) || ($("#preview").classList.contains("show") && $("#pvGame").style.display !== "none")) { h.style.display = "none"; return; }
      h.innerHTML = `<span>🎮 ${tr("¿Quieres crear un videojuego? El <b>Estudio de juegos</b> te guía: mide tu PC, diseña el juego con IA y busca modelos 3D gratis.", "Want to make a video game? The <b>Game Studio</b> guides you: checks your PC, designs the game with AI and finds free 3D models.")}</span><span class="grow"></span>
        <button class="btn ok" data-a="abrir">${tr("Abrir el Estudio", "Open the Studio")}</button><button class="btn" data-a="no">${tr("No, gracias", "No, thanks")}</button>`;
      h.style.display = "flex";
      h.querySelector("[data-a=abrir]").onclick = () => { h.style.display = "none"; abrirEstudio({idea: inpEl().value.trim()}); };
      h.querySelector("[data-a=no]").onclick = () => { GJ.descartado.add(clave); h.style.display = "none"; };
    }, 350);
  }
  // al enviar: si el mensaje habla de crear un juego, el chat pasa a modo juego y (en «auto») se abre el Estudio en modo seguimiento
  window.estudioAlEnviar = texto => {
    $("#gameHint").style.display = "none"; $("#ptPop").classList.remove("show"); mensaje("");
    if (ES.interno) { ES.interno = false; return {modo_juego: true}; }
    const d = detectarJuego(texto);
    if (!d.juego || detectorModo() === "apagado") return null;
    ES.modoConv = true;
    if (detectorModo() === "auto" && d.abrir) abrirEstudio({idea: texto, seguimiento: true});
    return {modo_juego: true};
  };
  document.addEventListener("noviq:conv", () => { ES.modoConv = false; $("#gameHint").style.display = "none"; mensaje(""); PT.pila = []; $("#ptUndo").style.display = "none"; });

  /* ═════════════ 🎮 ESTUDIO DE JUEGOS ═════════════ */
  const ES = {perfil: null, estilo: null, estiloElegido: false, genero: "", idea: "", diseno: null, modeloIA: "", aviso: "", activos: {}, trabajo: null, resultado: null,
    seguimiento: null, cargandoPerfil: false, disenando: false, creando: false, log: [], modoConv: false, interno: false, extras: {textura: true, modelo: false, rolModelo: "coleccionable", descModelo: ""},
    bib: null, bibCargando: false, bibAbierta: false, bibFiltro: {q: "", rol: "", paquete: ""}, bibVer: 48, bibSel: null, bibInfo: "",
    director: null, mejorando: false, mis: null, misAbierto: false, misTab: "3d", misCat: "", misTexto: "", misTipo: "3d", misBloques: false, misCreando: false, misVer: 60};
  // Ideas de ejemplo: [icono, idea, pistas {genero, estilo}] (la pista de estilo solo si la idea lo pide: Minecraft → vóxel, 2D → pixel art)
  const IDEAS = [
    ["🏔", "Aventura en los Andes: recojo gemas sagradas mientras cóndores ladrones me persiguen", {genero: "aventura"}],
    ["🧟", "Sobrevivir 3 minutos a oleadas de zombies en un mundo de bloques estilo Minecraft", {genero: "supervivencia", estilo: "voxel"}],
    ["🏎", "Carreras de autos en la ciudad contra 4 rivales, 3 vueltas", {genero: "carreras"}],
    ["🚀", "Nave espacial que dispara a aliens en un planeta morado", {genero: "disparos"}],
    ["🍄", "Plataformas 2D pixel art en un bosque mágico con monedas y slimes", {genero: "plataformas", estilo: "pixel2d"}],
    ["👻", "Terror de noche en un cementerio: encuentra la salida con tu linterna", {genero: "terror"}],
    ["🏝", "Isla pirata: busca 10 cofres del tesoro antes del anochecer", {genero: "exploracion"}],
    ["🦖", "Explorar una selva con dinosaurios y recoger huevos", {genero: "exploracion"}]];
  // Ideas pensadas para los paquetes de TU carpeta 3D (según las temáticas que se detectaron)
  const IDEAS_CARPETA = {
    ciudad: ["🚓", "Carreras por la ciudad contra 4 autos, 3 vueltas, entre edificios, semáforos y farolas", {genero: "carreras"}],
    terror: ["🎃", "Noche de Halloween en el cementerio: recoge 15 calabazas entre lápidas y criptas mientras te persiguen fantasmas", {genero: "terror"}],
    zombies: ["🔫", "Shooter de zombies en la ciudad: derrota a 20 zombies con tu pistola y recoge botiquines", {genero: "disparos"}],
    disparos: ["🪖", "Soldado en una base militar: derrota a 15 enemigos entre barriles, contenedores y barreras", {genero: "disparos"}],
    granja: ["🚜", "Granja: recoge 20 frutas antes de que los zorros se las coman", {genero: "aventura"}],
    medieval: ["🏰", "Caballero en un castillo: derrota a 10 esqueletos y encuentra la llave", {genero: "rpg"}],
    bosque: ["🌲", "Explorar un bosque y recoger 15 gemas escondidas entre los árboles", {genero: "exploracion"}],
    espacio: ["👨‍🚀", "Astronauta en un planeta: recoge 12 cristales y esquiva a los aliens", {genero: "aventura"}],
  };
  const ROL_NOMBRE = {jugador: "🧍 Jugador", enemigo: "👾 Enemigo", coleccionable: "💎 Objeto", arma: "🔫 Arma", meta: "🏁 Meta", arbol: "🌳 Árboles", pino: "🌲 Pinos",
    palmera: "🌴 Palmeras", arbusto: "🌿 Arbustos", roca: "🪨 Rocas", hongo: "🍄 Hongos", cactus: "🌵 Cactus", cristal: "💠 Cristales", casa: "🏠 Casas", edificio: "🏢 Edificios",
    torre: "🗼 Torres", farola: "💡 Farolas", senal: "🚦 Señales", urbano: "📮 Mobiliario urbano", cono: "🚧 Conos", caja: "📦 Cajas", barril: "🛢 Barriles",
    contenedor: "🗑 Contenedores", escombros: "🧱 Escombros", valla: "🚧 Vallas", banco: "🪑 Bancos", lapida: "🪦 Lápidas", calabaza: "🎃 Calabazas", ataud: "⚰ Ataúdes",
    hueso: "💀 Huesos", vela: "🕯 Velas", vehiculo: "🚗 Autos (decoración)", personaje: "🧍 Personajes", animal: "🐺 Animales", trampa: "🪤 Trampas", suelo: "▦ Suelo",
    pared: "🖼 Pared", otro: "❔ Otros", adorno: "✨ Adornos"};
  const nombreRol = rol => { const b = (rol || "").replace(/(_v?\d+|\d+)$/, ""); const n = ROL_NOMBRE[b] || b; return rol !== b ? `${n} ${rol.slice(b.length).replace(/^_/, "")}` : n; };
  const ROLES_PERSONAJE = /^(jugador|enemigo\d*|coleccionable\d*|arma|meta)$/;
  const CANT_DECO = {vehiculo: 10, farola: 16, senal: 10, banco: 10, urbano: 12, cono: 16, contenedor: 7, arbusto: 30, arbol: 30, lapida: 30, calabaza: 18, vela: 12, ataud: 5,
    hueso: 12, valla: 16, barril: 14, escombros: 12, caja: 14, roca: 30, pino: 30, hongo: 15, cristal: 15, palmera: 25, casa: 8, edificio: 25, adorno: 12};
  const DECO_ROLES = new Set(Object.keys(CANT_DECO).concat(["torre", "cactus"]));
  const conToken = u => u && u.startsWith("/api/") ? u + (u.includes("?") ? "&" : "?") + "t=" + TOKEN : u;
  const PIXEL = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

  window.estudioMostrar = () => { if (!ES.perfil && !ES.cargandoPerfil) cargarPerfil(); if (!ES.bib && !ES.bibCargando) cargarBiblioteca(); pintar(); };
  function abrirEstudio(o = {}) {
    if (o.idea) ES.idea = o.idea;
    if (o.seguimiento) { ES.seguimiento = {pasos: {pc: "run", diseno: "pend", motor: "pend", activos: "pend", probar: "pend"}, proyecto: null, index: null}; }
    showPanel("game");
  }
  window.abrirEstudio = abrirEstudio;
  async function cargarPerfil() {
    ES.cargandoPerfil = true; pintar();
    try { ES.perfil = await jget("/api/juegos/perfil?idioma=" + (window.NOVIQ_LANG || "es")); if (!ES.estilo) ES.estilo = ES.perfil.recomendado; }
    catch (e) { ES.perfil = {error: String(e.message || e)}; }
    ES.cargandoPerfil = false;
    if (ES.seguimiento && ES.seguimiento.pasos.pc === "run") ES.seguimiento.pasos.pc = "ok";
    pintar();
  }
  async function cargarBiblioteca(o = {}) {
    ES.bibCargando = true; if (o.pintar !== false) pintar();
    try {
      const r = o.carpeta !== undefined ? await jpost("/api/juegos/biblioteca", {carpeta: o.carpeta}) : await jget("/api/juegos/biblioteca" + (o.escanear ? "?escanear=1" : ""));
      if (r.ok === false) throw new Error(r.error || "error");
      ES.bib = r; ES.bibInfo = "";
      if (o.carpeta !== undefined) CFG.juegos = Object.assign({}, CFG.juegos || {}, {carpeta_3d: r.es_defecto ? "" : r.carpeta});
      if (o.escanear) ES.bibInfo = `✔ ${tr("Carpeta escaneada", "Folder scanned")}: ${r.modelos.length} ${tr("modelos", "models")}` + (r.zips.length ? ` · ${tr("descomprimidos", "unzipped")}: ${r.zips.join(", ")}` : "");
    } catch (e) { ES.bib = ES.bib || {modelos: [], paquetes: {}, carpeta: "", error: String(e.message || e)}; ES.bibInfo = "✖ " + (e.message || e); }
    ES.bibCargando = false; pintar();
  }
  const EMO_NIVEL = {basico: "🟠", medio: "🟡", alto: "🟢", ultra: "💎"};
  function htmlPC() {
    const p = ES.perfil;
    if (ES.cargandoPerfil || !p) return `<div class="gs-card"><span class="spin"></span> ${tr("Midiendo tu tarjeta gráfica y la memoria…", "Checking your graphics card and memory…")}</div>`;
    if (p.error) return `<div class="gs-card bad-t">✖ ${esc(p.error)}</div>`;
    const actual = ES.estilo || p.recomendado;
    return `<div class="gs-card"><h3>🖥 ${tr("Tu PC para juegos", "Your PC for games")}</h3>
      <div class="gs-pc"><div class="nv">${p.nvidia ? "🟩" : "🖥"}</div><div><b>${esc(p.gpu)}</b>${p.vram_gb ? ` · ${p.vram_gb} GB VRAM` : ""} · RAM ${tr("libre", "free")} ${p.ram_libre_gb} GB
        <div>${tr("Nivel", "Level")}: <span class="gs-badge ${p.nivel === "basico" ? "warn" : "ok"}">${EMO_NIVEL[p.nivel] || ""} ${esc(p.nivel)}</span></div>
        <div class="small">${esc(p.consejo)}</div></div></div>
      <div class="gs-est">${Object.entries(p.estilos).map(([k, e]) => `<button data-est="${k}" class="${actual === k ? "sel" : ""} ${e.ok ? "" : "no"}" title="${esc(e.desc + (e.aviso ? " — " + e.aviso : ""))}">
        ${k === p.recomendado ? `<span class="rec">★ ${tr("recomendado", "recommended")}</span>` : ""}<b>${esc(e.nombre)}</b><span class="small">${esc(e.desc)}</span>${e.ok ? "" : `<div class="small" style="color:var(--warn)">⚠ ${tr("puede ir lento", "may be slow")}</div>`}</button>`).join("")}</div>
      <div class="small" style="margin-top:6px">${ES.estiloElegido ? `🔒 ${tr("Estilo elegido por ti: se respeta al diseñar.", "Style chosen by you: it will be used.")} <button class="linkbtn" data-a="estiloAuto">${tr("Que lo elija la IA según la idea", "Let the AI pick it from the idea")}</button>`
        : `✨ ${tr("Si no eliges, se usa el estilo que pida tu idea (Minecraft → vóxel, 2D → pixel art) o el recomendado para tu PC.", "If you don't pick one, the idea decides (Minecraft → voxel, 2D → pixel art) or the one recommended for your PC.")}`}</div></div>`;
  }
  function htmlSeguimiento() {
    const s = ES.seguimiento; if (!s) return "";
    const P = s.pasos, n = {pc: tr("Medir tu PC y elegir el estilo gráfico", "Check your PC and pick the graphics style"), diseno: tr("Convertir tu idea en el diseño del juego", "Turn your idea into a game design"),
      motor: tr("Instalar el motor y crear el proyecto", "Install the engine and create the project"), activos: tr("Usar tus modelos 3D y buscar los que falten", "Use your 3D models and find the missing ones"), probar: tr("Probar el juego y programar tus reglas", "Test the game and code your rules")};
    return `<div class="gs-card"><h3>🤖 ${tr("La IA está creando tu juego en el chat", "The AI is creating your game in the chat")}</h3>
      <ul class="gs-pasos">${Object.keys(n).map(k => `<li class="${P[k]}">${esc(n[k])}</li>`).join("")}</ul>
      ${s.index ? `<div class="gs-row"><button class="btn ok" data-a="jugarSeg">▶ ${tr("Jugar aquí", "Play here")}</button><button class="btn" data-a="extSeg">↗ ${tr("Navegador", "Browser")}</button><button class="btn" data-a="carpetaSeg">📂 ${tr("Carpeta", "Folder")}</button></div>` : ""}
      <div class="small">${tr("Puedes seguir escribiendo en el chat para cambiar el juego (ej. «que los enemigos sean más lentos», «agrega un jefe final»).", "Keep chatting to change the game (e.g. “make the enemies slower”, “add a final boss”).")}</div>
      <button class="linkbtn" data-a="manual">${tr("Prefiero usar el asistente paso a paso ↓", "I prefer the step-by-step wizard ↓")}</button></div>`;
  }
  function ideasCarpeta() {  // una idea por temática de tus paquetes (máx. 3)
    const b = ES.bib; if (!b || !b.paquetes) return [];
    const hay = new Set(); for (const p of Object.values(b.paquetes)) for (const t of p.temas || []) hay.add(t);
    return Object.keys(IDEAS_CARPETA).filter(t => hay.has(t)).slice(0, 3).map(t => IDEAS_CARPETA[t]);  // en el orden de IDEAS_CARPETA
  }
  function todasIdeas() { return ideasCarpeta().map(x => [x[0], x[1], Object.assign({carpeta: true}, x[2])]).concat(IDEAS); }
  function htmlIdea() {
    const gen = (ES.perfil && ES.perfil.generos) || {};
    return `<div class="gs-card"><h3>💡 ${tr("Tu idea", "Your idea")}</h3>
      <textarea id="gsIdea" spellcheck="true" lang="es" placeholder="${tr("Ej: un juego donde soy un cóndor que vuela por los Andes recogiendo gemas y esquivando tormentas…", "E.g.: a game where I'm a condor flying over the Andes collecting gems…")}">${esc(ES.idea)}</textarea>
      <div class="gs-ideas">${todasIdeas().map(([i, t, h], k) => `<button type="button" data-idea="${k}" class="${h.carpeta ? "loc" : ""}" title="${esc(t)}${h.carpeta ? " — " + tr("usa los modelos de tu carpeta 3D", "uses the models in your 3D folder") : ""}">${i} ${esc(t.split(":")[0].split(" ").slice(0, 4).join(" "))}…${h.carpeta ? ' <span class="gs-badge loc">📁</span>' : ""}</button>`).join("")}</div>
      <div class="gs-row"><select id="gsGenero"><option value="">${tr("Género: automático (según la idea)", "Genre: automatic")}</option>${Object.entries(gen).map(([k, v]) => `<option value="${k}" ${ES.genero === k ? "selected" : ""}>${esc(v)}</option>`).join("")}</select>
        <button class="btn" data-a="corregirIdea" title="${tr("Corregir la ortografía de la idea", "Fix spelling")}">🔤</button>
        <button class="btn ok ${ES.pulso ? "pulso" : ""}" id="gsDisenar" data-a="disenar" ${ES.disenando ? "disabled" : ""}>${ES.disenando ? `<span class="spin"></span> ${tr("Diseñando…", "Designing…")}` : "✨ " + tr("Diseñar mi juego", "Design my game")}</button></div>
      <div class="small">${tr("La IA traduce tu idea en el diseño (género, objetivo, enemigos, mundo, modelos de tu carpeta 3D). Tú solo apruebas.", "The AI turns your idea into a design (genre, goal, enemies, world, models from your 3D folder). You just approve it.")}</div></div>`;
  }
  /* ───── 📁 Tus modelos 3D (la carpeta estándar) ───── */
  function modelosFiltrados() {
    const b = ES.bib, f = ES.bibFiltro; if (!b) return [];
    const q = norm(f.q).split(/\s+/).filter(Boolean);
    return b.modelos.filter(m => (!f.rol || m.rol === f.rol) && (!f.paquete || m.paquete === f.paquete) &&
      (!q.length || q.every(w => norm(`${m.nombre} ${m.paquete} ${m.rol} ${nombreRol(m.rol)} ${(m.temas || []).join(" ")}`).includes(w))));
  }
  function htmlBiblioteca() {
    const b = ES.bib;
    if (!b) return `<div class="gs-card"><span class="spin"></span> ${tr("Leyendo tu carpeta de modelos 3D…", "Reading your 3D models folder…")}</div>`;
    const paq = Object.entries(b.paquetes || {}), n = b.modelos.length, ign = Object.entries(b.ignorados || {}).map(([e, k]) => `${k} ${e}`).join(", ");
    let html = `<div class="gs-card gs-bib"><h3>📁 ${tr("Tus modelos 3D", "Your 3D models")} <span class="small">${n} ${tr("modelos", "models")} · ${paq.length} ${tr("paquetes", "packs")}${ES.bibCargando ? ' · <span class="spin"></span>' : ""}</span></h3>
      <div class="small">${tr("Carpeta estándar", "Standard folder")}: <code class="gs-ruta" title="${esc(b.carpeta)}">${esc(b.carpeta)}</code>${b.es_defecto === false ? ` <span class="gs-badge warn">${tr("personalizada", "custom")}</span>` : ""}</div>
      <div class="small">${tr("Todo lo que pongas ahí (.glb / .gltf, o .zip con ellos) se usa solo según el juego: personajes, enemigos, objetos, armas y decoración que encajen con la temática.", "Everything you put there (.glb / .gltf, or .zip with them) is used automatically depending on the game: characters, enemies, items, weapons and scenery that fit the theme.")}</div>
      <div class="gs-row"><button class="btn" data-a="bibAbrir">📂 ${tr("Abrir carpeta", "Open folder")}</button><button class="btn" data-a="bibEscanear" ${ES.bibCargando ? "disabled" : ""}>🔄 ${tr("Volver a escanear", "Rescan")}</button>
        <button class="btn" data-a="bibCambiar">📁 ${tr("Cambiar carpeta…", "Change folder…")}</button>${b.es_defecto === false ? `<button class="btn" data-a="bibDefecto">↺ ${tr("Usar la estándar", "Use the standard one")}</button>` : ""}
        <button class="btn ${ES.bibAbierta ? "" : "ok"}" data-a="bibVer">${ES.bibAbierta ? "▲ " + tr("Ocultar modelos", "Hide models") : "▼ " + tr("Ver y elegir modelos", "Browse & pick models")}</button></div>
      ${paq.length ? `<div class="gs-paqs">${paq.map(([k, p]) => `<button type="button" data-paq="${esc(k)}" class="${ES.bibFiltro.paquete === k ? "sel" : ""}" title="${esc((p.autor ? p.autor + " · " : "") + (p.licencia || tr("licencia: revisa el paquete", "license: check the pack")))}"><b>${esc(k)}</b> · ${p.n}${(p.temas || []).length ? ` · <span class="small">${esc(p.temas.join(", "))}</span>` : ""}</button>`).join("")}</div>`
        : `<div class="small" style="margin-top:6px">💡 ${tr("Está vacía: copia ahí tus paquetes de modelos (por ejemplo de kenney.nl, quaternius.com o poly.pizza) y pulsa «Volver a escanear».", "It's empty: copy your model packs there (e.g. from kenney.nl, quaternius.com or poly.pizza) and press “Rescan”.")}</div>`}
      ${ign ? `<div class="small" style="margin-top:4px">ℹ ${tr("Ignorados (el motor usa .glb/.gltf; expórtalos a .glb con Blender):", "Ignored (the engine uses .glb/.gltf; export them to .glb with Blender):")} ${esc(ign)}</div>` : ""}
      ${(b.errores || []).length ? `<div class="small bad-t">⚠ ${b.errores.slice(0, 3).map(esc).join(" · ")}</div>` : ""}
      ${ES.bibInfo ? `<div class="small">${esc(ES.bibInfo)}</div>` : ""}`;
    if (ES.bibAbierta && n) {
      const lista = modelosFiltrados(), roles = {};
      b.modelos.forEach(m => { roles[m.rol] = (roles[m.rol] || 0) + 1; });
      html += `<div class="gs-row"><input id="gsBibQ" placeholder="${tr("Buscar: árbol, zombie, car, lápida…", "Search: tree, zombie, car, grave…")}" value="${esc(ES.bibFiltro.q)}">
          <select id="gsBibRol"><option value="">${tr("Todas las categorías", "All categories")}</option>${Object.entries(roles).sort((a, b2) => b2[1] - a[1]).map(([r, k]) => `<option value="${esc(r)}" ${ES.bibFiltro.rol === r ? "selected" : ""}>${esc(nombreRol(r))} (${k})</option>`).join("")}</select></div>
        <div class="gs-mods">${lista.slice(0, ES.bibVer).map(m => `<button type="button" class="gs-mod ${ES.bibSel === m.h ? "sel" : ""} ${m.no_soportado && m.no_soportado.length ? "no" : ""}" data-mod="${m.h}" title="${esc(`${m.nombre} · ${m.paquete} · ${nombreRol(m.rol)}${m.caras ? " · " + m.caras.toLocaleString() + " " + tr("caras", "faces") : ""}${m.animaciones ? " · " + m.animaciones + " " + tr("animaciones", "animations") : ""}`)}">
            <img data-mini="${m.h}" src="${esc(conToken(m.miniatura) || PIXEL)}" alt=""><span class="nm">${esc(m.nombre)}${m.variante ? ` <i>${esc(m.variante.slice(0, 3))}</i>` : ""}</span><span class="small">${esc(nombreRol(m.rol))}${m.animaciones ? " · 🎞" : ""}</span></button>`).join("") || `<div class="small">${tr("Nada coincide con el filtro.", "Nothing matches the filter.")}</div>`}</div>
        ${lista.length > ES.bibVer ? `<button class="linkbtn" data-a="bibMas">${tr("Mostrar más", "Show more")} (${lista.length - ES.bibVer})</button>` : ""}
        ${htmlUsarComo()}`;
    }
    return html + "</div>";
  }
  function htmlUsarComo() {  // ficha del modelo elegido en la galería + «Usar como…»
    const m = ES.bib && ES.bib.modelos.find(x => x.h === ES.bibSel); if (!m) return "";
    const d = ES.diseno, en3d = d && d.motor === "3d";
    const roles = en3d ? Object.keys(d.activos || {}) : [];
    const decoNueva = en3d && DECO_ROLES.has(m.rol) && !roles.includes(m.rol) ? m.rol : (en3d && !roles.includes("adorno") && !ROLES_PERSONAJE.test(m.rol) && !DECO_ROLES.has(m.rol) ? "adorno" : "");
    return `<div class="gs-ficha"><b>${esc(m.nombre)}</b> <span class="small">${esc(m.paquete)} · ${esc(nombreRol(m.rol))}${m.caras ? " · " + m.caras.toLocaleString() + " " + tr("caras", "faces") : ""}${m.animaciones ? ` · 🎞 ${m.animaciones} ${tr("animaciones", "animations")}` : ""} · ${esc(m.licencia || "")}</span>
      ${en3d ? `<div class="small" style="margin:4px 0">${tr("Usar en tu juego como:", "Use it in your game as:")}</div><div class="gs-paqs">${roles.map(r => `<button type="button" data-usar="${esc(r)}">${esc(nombreRol(r))}</button>`).join("")}
          ${decoNueva ? `<button type="button" data-usar="${esc(decoNueva)}" data-nueva="1">＋ ${esc(nombreRol(decoNueva))} (${tr("decoración nueva", "new scenery")})</button>` : ""}</div>`
        : `<div class="small">${d ? tr("El estilo elegido no usa modelos 3D (vóxel y 2D dibujan todo solos). Elige 3D realista o low poly para usarlo.", "The chosen style doesn't use 3D models. Pick realistic 3D or low poly to use it.") : tr("Diseña tu juego primero y luego elige aquí para qué usar cada modelo (o deja que el Estudio los elija solo según la temática).", "Design your game first and then choose here what to use each model for (or let the Studio pick them by theme).")}</div>`}
      <div class="gs-row"><button class="btn" data-a="bibVerArchivo">📂 ${tr("Ver el archivo", "Show file")}</button></div></div>`;
  }
  function htmlDiseno() {
    const d = ES.diseno; if (!d) return "";
    const obj = d.objetivo || {}, nLoc = Object.keys(d.locales || {}).length;
    return `<div class="gs-card gs-dis"><h3>📜 ${tr("Diseño del juego", "Game design")} ${ES.modeloIA ? `<span class="small">(${esc(ES.modeloIA.split("::").pop())})</span>` : ""}</h3>
      ${ES.aviso ? `<div class="small" style="color:var(--warn)">⚠ ${esc(ES.aviso)}</div>` : ""}
      <div class="gs-row"><input id="gsTitulo" value="${esc(d.titulo)}" title="${tr("Título", "Title")}"></div>
      <div class="gs-row"><input id="gsObj" value="${esc(obj.texto || "")}" title="${tr("Misión", "Mission")}"><input id="gsCant" type="number" min="1" max="600" value="${obj.cantidad || 1}" style="max-width:90px" title="${tr("Cantidad", "Amount")}"></div>
      <dl><dt>${tr("Género", "Genre")}</dt><dd>${esc(d.genero)} · ${esc(d.tema)}</dd>
        <dt>${tr("Estilo", "Style")}</dt><dd>${esc((ES.perfil && ES.perfil.estilos[d.estilo] || {}).nombre || d.estilo)} · ${tr("motor", "engine")} ${esc(d.motor)} · ${tr("cámara", "camera")} ${esc(d.camara)}</dd>
        <dt>${tr("Jugador", "Player")}</dt><dd>${esc(d.jugador.nombre)} · ${tr("vida", "health")} ${d.jugador.vida} · ${tr("arma", "weapon")}: ${esc(d.jugador.arma)}</dd>
        <dt>${tr("Enemigos", "Enemies")}</dt><dd>${(d.enemigos || []).map(e => `${esc(e.nombre)} ×${e.cantidad}`).join(", ") || "—"}</dd>
        <dt>${tr("Objetos", "Items")}</dt><dd>${(d.objetos || []).map(o => `${esc(o.nombre)} ×${o.cantidad}`).join(", ") || "—"}</dd>
        <dt>${tr("Mundo", "World")}</dt><dd>${(d.decoracion || []).map(x => esc(nombreRol(x.tipo).replace(/^\S+\s/, ""))).join(", ")} · ${esc(d.ambiente.hora)}${d.ambiente.clima !== "despejado" ? " · " + esc(d.ambiente.clima) : ""}</dd>
        ${nLoc ? `<dt>📁</dt><dd>${tr(`${nLoc} roles con modelos de tu carpeta 3D (puedes cambiarlos abajo)`, `${nLoc} roles use models from your 3D folder (change them below)`)}</dd>` : ""}
        ${(d.reglas_extra || []).length ? `<dt>${tr("Extra", "Extra")}</dt><dd>${d.reglas_extra.map(esc).join("<br>")}</dd>` : ""}</dl>${htmlEpico(d)}</div>`;
  }
  function htmlEpico(d) {  // 🎬 lo que el director creativo agregó a la idea: travesía, trajes, armas, jefe, contratiempos, logros
    const c = d.campana; if (!c) return "";
    const dir = ES.director || {}, pt = dir.puntaje != null ? dir.puntaje : null;
    const zonas = (c.zonas || []).map((z, i) => `<li><b>${esc(z.nombre)}</b> — ${esc((z.objetivo || {}).texto || "")}
      <span class="small">${esc(z.tema || "")}${z.hora ? " · " + esc(z.hora) : ""}${z.mirador ? " · 🔭" : ""}${z.npc ? " · 💬 " + esc(z.npc.nombre) : ""}${z.contratiempo ? " · ⚠ " + esc(z.contratiempo.tipo) : ""}${(z.obstaculos || []).length ? " · 🪤 " + esc(z.obstaculos.map(o => o.tipo || o).join(", ")) : ""}${i === c.zonas.length - 1 && c.jefe ? " · ☠" : ""}</span></li>`).join("");
    const j = c.jefe;
    return `<div class="gs-epico"><div class="gs-row"><b>🎬 ${tr("Diseño épico del director", "Director's epic design")}</b>${pt != null ? `<span class="gs-badge ${pt >= 85 ? "ok" : "warn"}" title="${tr("Calidad según la lista de lo que tienen los mejores juegos", "Quality against what the best games have")}">${pt}/100</span>` : ""}
        <span class="grow"></span><button class="btn" data-a="mejorar" ${ES.mejorando ? "disabled" : ""}>${ES.mejorando ? `<span class="spin"></span> ${tr("Mejorando…", "Improving…")}` : "✨ " + tr("Mejorar más", "Improve more")}</button>
        <button class="btn" data-a="meGusta" title="${tr("Me gusta: el director aprende de este diseño para los próximos", "I like it: the director learns from this design")}">👍</button></div>
      ${c.historia ? `<div class="small" style="margin-top:6px">📖 ${esc(c.historia.premisa || "")}</div>` : ""}
      <ol class="gs-zonas">${zonas}</ol>
      <dl><dt>👕 ${tr("Trajes", "Outfits")}</dt><dd>${(c.trajes || []).map(t => `${esc(t.nombre)}${t.desbloqueo ? " 🔒" : ""}`).join(", ") || "—"}</dd>
        <dt>⚔ ${tr("Armas", "Weapons")}</dt><dd>${(c.armas || []).map(a => `${esc(a.nombre)}${a.desbloqueo ? " 🔓" + (a.desbloqueo + 1) : ""}`).join(", ") || "—"}</dd>
        ${j ? `<dt>☠ ${tr("Jefe", "Boss")}</dt><dd>${esc(j.nombre)} · ${(j.fases || []).map(f => esc(f.habilidad)).join(" → ")}</dd>` : ""}
        <dt>❤ ${tr("Vidas", "Lives")}</dt><dd>${c.vidas || 3} · ${tr("mejoras", "upgrades")}: ${(c.mejoras || []).length} · ${tr("logros", "achievements")}: ${(c.logros || []).length}</dd>
        ${(c.referentes || []).length ? `<dt>🏆</dt><dd class="small">${tr("Inspirado en", "Inspired by")} ${esc(c.referentes.slice(0, 3).join(", "))}</dd>` : ""}</dl></div>`;
  }
  function htmlMisDisenos() {  // 🗂 las figuras 3D animadas y los diseños 2D creados por Noviq (en tus carpetas)
    const m = ES.mis;
    let html = `<div class="gs-card gs-mis"><h3>🗂 ${tr("Mis diseños 2D y 3D", "My 2D & 3D designs")} ${m ? `<span class="small">${(m.d3 || []).length} 3D · ${(m.d2 || []).length} 2D</span>` : ""}</h3>
      <div class="small">${tr("Personajes, enemigos, animales, armas, objetos y escenarios en 3D (normales o de BLOQUES estilo vóxel, todos animados) y diseños 2D (retratos, iconos, sprites, fondos por capas, texturas). Se guardan por categorías y los juegos los reutilizan.", "3D characters, enemies, animals, weapons, items and scenery (regular or BLOCK style, all animated) and 2D designs (portraits, icons, sprites, layered backgrounds, textures). Saved by category and reused by your games.")}</div>
      <div class="gs-row"><input id="gsMisTexto" placeholder="${tr("Describe: soldado camuflado, vaca de bloques, dragón rojo, fondo de nieve al atardecer…", "Describe: camo soldier, block cow, red dragon, snowy sunset background…")}" value="${esc(ES.misTexto)}">
        <select id="gsMisTipo"><option value="3d" ${ES.misTipo === "3d" ? "selected" : ""}>🧍 ${tr("Figura 3D animada", "Animated 3D figure")}</option><option value="2d" ${ES.misTipo === "2d" ? "selected" : ""}>🎨 ${tr("Diseño 2D", "2D design")}</option></select>
        <label class="chk" style="flex:0 0 auto"><input type="checkbox" id="gsMisBloques" ${ES.misBloques ? "checked" : ""}> 🧊 ${tr("Bloques", "Blocks")}</label>
        <button class="btn ok" data-a="misCrear" ${ES.misCreando ? "disabled" : ""}>${ES.misCreando ? `<span class="spin"></span> ${tr("Creando…", "Creating…")}` : "✨ " + tr("Crear", "Create")}</button></div>
      <div class="gs-row"><button class="btn ${ES.misAbierto ? "" : "ok"}" data-a="misVer">${ES.misAbierto ? "▲ " + tr("Ocultar", "Hide") : "▼ " + tr("Ver mis diseños", "Browse my designs")}</button>
        ${m ? `<button class="btn" data-a="misAbrir3d">📂 ${tr("Carpeta 3D", "3D folder")}</button><button class="btn" data-a="misAbrir2d">📂 ${tr("Carpeta 2D", "2D folder")}</button>` : ""}</div>`;
    if (ES.misAbierto) {
      if (!m) html += `<div class="small"><span class="spin"></span> ${tr("Cargando…", "Loading…")}</div>`;
      else {
        const lista = (ES.misTab === "3d" ? m.d3 : m.d2) || [], cats = {};
        lista.forEach(x => { const c = ES.misTab === "3d" ? (x.bloques ? "🧊 " : "") + (x.categoria || "") : x.categoria || x.tipo; cats[c] = (cats[c] || 0) + 1; });
        const filtrada = lista.filter(x => !ES.misCat || (ES.misTab === "3d" ? (x.bloques ? "🧊 " : "") + (x.categoria || "") : x.categoria || x.tipo) === ES.misCat);
        html += `<div class="gs-paqs"><button type="button" data-mistab="3d" class="${ES.misTab === "3d" ? "sel" : ""}">🧍 3D (${(m.d3 || []).length})</button><button type="button" data-mistab="2d" class="${ES.misTab === "2d" ? "sel" : ""}">🎨 2D (${(m.d2 || []).length})</button>
            ${Object.entries(cats).sort().map(([c, k]) => `<button type="button" data-miscat="${esc(c)}" class="${ES.misCat === c ? "sel" : ""}">${esc(c)} · ${k}</button>`).join("")}</div>
          <div class="gs-mods">${filtrada.slice(0, ES.misVer).map(x => `<button type="button" class="gs-mod" data-misarch="${esc(x.img || x.ruta || "")}" title="${esc(`${x.nombre} · ${x.categoria || x.tipo || ""}${x.animaciones && x.animaciones.length ? " · 🎞 " + x.animaciones.join(", ") : ""}${x.creado ? " · " + x.creado : ""}`)}">
              <img loading="lazy" src="${x.img ? esc(conToken("/api/juegos/disenos/img?ruta=" + encodeURIComponent(x.img))) : PIXEL}" alt=""><span class="nm">${esc(x.nombre)}</span>
              <span class="small">${esc(ES.misTab === "3d" ? (x.animaciones && x.animaciones.length ? "🎞 " + x.animaciones.length : "") : (x.tipo || "") + (x.capas && x.capas.length ? " · " + x.capas.length + " " + tr("capas", "layers") : ""))}</span></button>`).join("")
            || `<div class="small">${tr("Aún no hay diseños aquí: crea uno arriba o crea un juego (los genera solo).", "No designs yet: create one above or create a game.")}</div>`}</div>
          ${filtrada.length > ES.misVer ? `<button class="linkbtn" data-a="misMas">${tr("Mostrar más", "Show more")} (${filtrada.length - ES.misVer})</button>` : ""}`;
      }
    }
    return html + "</div>";
  }
  async function cargarMis() {
    try { ES.mis = await jget("/api/juegos/disenos"); } catch (e) { ES.mis = {d3: [], d2: [], error: String(e.message || e)}; }
    pintar();
  }
  function ordenRoles(d) {
    const orden = r => /^jugador$/.test(r) ? 0 : /^enemigo/.test(r) ? 1 : /^coleccionable/.test(r) ? 2 : r === "arma" ? 3 : 4;
    return Object.keys(d.activos || {}).sort((a, b) => orden(a) - orden(b));
  }
  function htmlActivos() {
    const d = ES.diseno; if (!d) return "";
    if (d.motor !== "3d") return d.motor === "voxel" ? `<div class="gs-card"><h3>🧊 ${tr("Personajes de bloques", "Block characters")}</h3><div class="small">${tr("El estilo vóxel usa figuras de BLOQUES que Noviq crea para tu juego (jugador, trajes, enemigos, guías y jefe), totalmente animadas y guardadas en tu carpeta 3D → Noviq Creados/Bloques.", "The voxel style uses BLOCK figures Noviq creates for your game (player, outfits, enemies, guides and boss), fully animated and saved in your 3D folder → Noviq Creados/Bloques.")}</div></div>`
      : `<div class="gs-card"><h3>🎞 ${tr("Gráficos 2D", "2D graphics")}</h3><div class="small">${tr("Noviq dibuja los sprites animados (desde sus figuras 3D), los fondos por capas de cada zona, las baldosas y los retratos, y los guarda en tu carpeta 2D para reutilizarlos.", "Noviq draws the animated sprites (from its 3D figures), layered backgrounds, tiles and portraits, and saves them in your 2D folder.")}</div></div>`;
    const roles = ordenRoles(d);
    return `<div class="gs-card"><h3>🧱 ${tr("Modelos 3D para tu juego", "3D models for your game")}</h3>
      <div class="small">${tr("Primero los de tu carpeta 📁 (ya preseleccionados según la temática), luego galerías gratis de internet. Elige uno por rol o deja «formas del motor».", "Your folder's models first 📁 (preselected by theme), then free online galleries. Pick one per role or keep “engine shapes”.")}</div>
      ${roles.map(rol => { const a = ES.activos[rol] || {};
        return `<div class="gs-rol" data-rol="${esc(rol)}"><div class="t"><b>${esc(nombreRol(rol))}</b><input value="${esc(a.consulta || d.activos[rol])}" data-q="${esc(rol)}" title="${tr("Buscar otra cosa (Enter)", "Search something else (Enter)")}"><button class="ib" data-buscar="${esc(rol)}" title="${tr("Buscar en tu carpeta y en internet", "Search your folder and online")}">🔍</button></div>
          <div class="gs-act">${a.cargando ? `<span class="small"><span class="spin"></span> ${tr("buscando…", "searching…")}</span>` : ""}
            <label class="${a.sel == null ? "sel" : ""}"><input type="radio" name="r-${esc(rol)}" value="" ${a.sel == null ? "checked" : ""}><span class="ninguno">🧩</span><span class="nm">${tr("Formas del motor", "Engine shapes")}</span></label>
            ${(a.resultados || []).slice(0, 8).map((x, i) => `<label class="${a.sel === i ? "sel" : ""} ${x.fuente === "local" ? "loc" : ""}" title="${esc(x.nombre)} — ${esc(x.autor || "")} · ${esc(x.licencia)} · ${x.fuente === "local" ? tr("tu carpeta 3D", "your 3D folder") + " (" + esc(x.paquete || "") + ")" : esc(x.fuente)}${x.caras ? " · " + x.caras + " " + tr("caras", "faces") : ""}">
              <input type="radio" name="r-${esc(rol)}" value="${i}" ${a.sel === i ? "checked" : ""}>${x.fuente === "local" ? `<img loading="lazy" data-mini="${esc(x.h)}" src="${esc(conToken(x.miniatura) || PIXEL)}" alt="">` : x.miniatura ? `<img loading="lazy" src="${esc(x.miniatura)}" alt="">` : `<span class="ninguno">📦</span>`}
              <span class="nm">${esc(x.nombre)}</span>${x.fuente === "local" ? `<span class="gs-badge loc">📁 ${tr("tuyo", "yours")}</span>` : `<span class="gs-badge ${x.licencia === "CC0" ? "ok" : "cc"}">${esc(x.licencia)}</span> <span class="small">${esc(x.fuente)}</span>`}</label>`).join("")}
            ${a.error ? `<span class="small bad-t">${esc(a.error)}</span>` : ""}</div></div>`; }).join("")}
      <div class="gs-credito">${tr("Galerías: tu carpeta 3D · Poly Haven (CC0) · ambientCG (CC0) · Sketchfab (CC0/CC-BY) · Poly Pizza (CC0/CC-BY). Los créditos se anotan solos en CREDITOS.md y en la pantalla de créditos del juego.", "Galleries: your 3D folder · Poly Haven (CC0) · ambientCG (CC0) · Sketchfab (CC0/CC-BY) · Poly Pizza (CC0/CC-BY). Credits are added to CREDITOS.md and the in-game credits.")} Powered by Poly Haven.
        ${ES.sinClave && ES.sinClave.length ? `<br>💡 ${tr("Más modelos: agrega tu clave gratuita de", "More models: add your free key for")} ${ES.sinClave.join(", ")} ${tr("en ⚙ Ajustes → 🎮 Juegos y NVIDIA.", "in ⚙ Settings → 🎮 Games & NVIDIA.")}` : ""}</div>
      ${ES.paquetes && ES.paquetes.length ? `<div class="small" style="margin-top:6px">📦 ${tr("Paquetes CC0 recomendados (descárgalos y ponlos en tu carpeta 3D):", "Recommended CC0 packs (download them into your 3D folder):")} ${ES.paquetes.slice(0, 4).map(p => `<a href="${esc(p.url)}" target="_blank">${esc(p.nombre)}</a>`).join(" · ")}</div>` : ""}</div>`;
  }
  function htmlNvidia() {
    const d = ES.diseno; if (!d) return "";
    const p = ES.perfil || {}, x = ES.extras;
    if (!p.clave_nvidia) return `<div class="gs-card"><h3>🟩 ${tr("IA de NVIDIA", "NVIDIA AI")}</h3><div class="small">${tr("Con tu API key gratuita de build.nvidia.com (⚙ Ajustes → Proveedores → NVIDIA) el Estudio genera texturas (FLUX) y modelos 3D (TRELLIS) a medida, y animaciones faciales desde una voz (Audio2Face-3D, pídelo en el chat).", "With your free build.nvidia.com key the Studio generates textures (FLUX), 3D models (TRELLIS) and facial animation (Audio2Face-3D).")}</div></div>`;
    const roles = ["coleccionable", "enemigo", "jugador", "meta"].concat((d.decoracion || []).map(z => z.tipo));
    return `<div class="gs-card"><h3>🟩 ${tr("IA de NVIDIA para tu juego", "NVIDIA AI for your game")}</h3>
      ${d.motor === "3d" ? `<label class="chk"><input type="checkbox" id="gsTex" ${x.textura ? "checked" : ""}> 🎨 ${tr("Textura del suelo con IA (FLUX, sin costuras + mapa normal)", "AI ground texture (FLUX, seamless + normal map)")}</label>
      <div class="gs-row"><input id="gsTexDesc" value="${esc(x.descTex || d.textura_suelo || "grass")}" title="${tr("Descripción en inglés", "Description in English")}"></div>` : ""}
      ${d.motor === "3d" ? `<label class="chk" style="margin-top:8px"><input type="checkbox" id="gsMod" ${x.modelo ? "checked" : ""}> 🧊 ${tr("Modelo 3D a medida con IA (TRELLIS, 30-90 s)", "Custom AI 3D model (TRELLIS, 30-90 s)")}</label>
      <div class="gs-row"><select id="gsModRol">${[...new Set(roles)].map(r => `<option ${x.rolModelo === r ? "selected" : ""}>${esc(r)}</option>`).join("")}</select><input id="gsModDesc" maxlength="77" value="${esc(x.descModelo || "")}" placeholder="${tr("en inglés, ej. low poly golden gem", "e.g. low poly golden gem")}"></div>` : ""}
      <div class="small" style="margin-top:6px">🙂 ${tr("¿Personajes que hablan? Pide en el chat «anima la cara con esta voz» y se usa Audio2Face-3D.", "Talking characters? Ask in chat to animate a face from a voice (Audio2Face-3D).")}</div></div>`;
  }
  function htmlCrear() {
    const d = ES.diseno; if (!d) return "";
    const r = ES.resultado;
    return `<div class="gs-card"><h3>🚀 ${tr("Crear", "Create")}</h3>
      ${r && r.ok ? `<div>✅ <b>${tr("¡Tu juego está listo!", "Your game is ready!")}</b> <span class="small">${esc(r.ruta)}</span></div>
        <div class="gs-row"><button class="btn ok" data-a="jugar">▶ ${tr("Jugar aquí", "Play here")}</button><button class="btn" data-a="ext">↗ ${tr("En el navegador", "In the browser")}</button><button class="btn" data-a="carpeta">📂 ${tr("Carpeta", "Folder")}</button></div>
        <div class="small">${tr("La IA del chat ya está probando el juego y programando las reglas especiales de tu idea. Para jugar fuera de Noviq: doble clic en jugar.bat.", "The chat AI is now testing the game and coding your special rules. Outside Noviq: double-click jugar.bat.")}</div>`
      : `<div class="gs-row"><input id="gsNombre" value="${esc((ES.nombre || d.titulo || "Mi juego").replace(/\s+/g, "_"))}" title="${tr("Nombre de la carpeta", "Folder name")}"><button class="btn ok" data-a="crear" ${ES.creando ? "disabled" : ""}>${ES.creando ? `<span class="spin"></span> ${tr("Creando…", "Creating…")}` : "🚀 " + tr("Crear mi juego", "Create my game")}</button></div>`}
      ${ES.log.length ? `<div class="gs-log">${ES.log.map(esc).join("\n")}</div>` : ""}</div>`;
  }
  function pintar() {
    const b = $("#gameBody"); if (!b) return;
    const act = document.activeElement, foco = act && act.id, selIni = foco && act.selectionStart, selFin = foco && act.selectionEnd;
    const scroll = b.parentElement ? b.parentElement.scrollTop : 0;
    b.innerHTML = `<div class="gs-h"><h2>🎮 ${tr("Estudio de juegos", "Game Studio")}</h2><span class="grow"></span><button class="linkbtn" data-a="nuevo" title="${tr("Empezar otro juego", "Start another game")}">＋ ${tr("Nuevo", "New")}</button></div>
      <div class="small" style="margin:-6px 0 10px">${tr("Describe tu idea: la IA diseña el juego, elige el estilo que tu PC puede mover, usa tus modelos 3D (y busca gratis los que falten) y lo deja listo para jugar.", "Describe your idea: the AI designs the game, picks a style your PC can run, uses your 3D models (and finds free ones for the rest) and makes it playable.")}</div>
      ${htmlSeguimiento()}${htmlPC()}${ES.seguimiento && !ES.manual ? htmlBiblioteca() + htmlMisDisenos() : htmlIdea() + htmlBiblioteca() + htmlMisDisenos() + htmlDiseno() + htmlActivos() + htmlNvidia() + htmlCrear()}`;
    enlazar(b);
    if (b.parentElement) b.parentElement.scrollTop = scroll;
    if (foco && $("#" + foco)) { const el = $("#" + foco); el.focus(); try { if (selIni != null) el.setSelectionRange(selIni, selFin); } catch (e) {} }
    miniaturasPendientes();
  }
  function guardarCampos() {
    const d = ES.diseno; const v = id => { const el = $("#" + id); return el ? el.value : null; };
    if ($("#gsIdea")) ES.idea = v("gsIdea");
    if ($("#gsGenero")) ES.genero = v("gsGenero");
    if ($("#gsBibQ")) ES.bibFiltro.q = v("gsBibQ");
    if ($("#gsMisTexto")) ES.misTexto = v("gsMisTexto");
    if ($("#gsMisTipo")) ES.misTipo = v("gsMisTipo");
    if ($("#gsMisBloques")) ES.misBloques = $("#gsMisBloques").checked;
    if (d) {
      if (v("gsTitulo") !== null) d.titulo = v("gsTitulo").trim() || d.titulo;
      if (v("gsObj") !== null) d.objetivo.texto = v("gsObj").trim() || d.objetivo.texto;
      if (v("gsCant") !== null) d.objetivo.cantidad = Math.max(1, parseInt(v("gsCant"), 10) || d.objetivo.cantidad);
      if ($("#gsNombre")) ES.nombre = v("gsNombre");
      if ($("#gsTex")) ES.extras.textura = $("#gsTex").checked; if ($("#gsTexDesc")) ES.extras.descTex = v("gsTexDesc");
      if ($("#gsMod")) ES.extras.modelo = $("#gsMod").checked; if ($("#gsModRol")) ES.extras.rolModelo = v("gsModRol"); if ($("#gsModDesc")) ES.extras.descModelo = v("gsModDesc");
    }
  }
  function nuevoJuego() {
    Object.assign(ES, {diseno: null, resultado: null, activos: {}, log: [], nombre: "", aviso: "", modeloIA: ""});
  }
  function elegirIdea(k) {  // clic en una idea de ejemplo: la escribe, fija el género (y el estilo si la idea lo pide) y deja listo «Diseñar»
    const x = todasIdeas()[k]; if (!x) return;
    const h = x[2] || {};
    nuevoJuego();
    ES.idea = x[1]; ES.genero = h.genero || "";
    if (h.estilo && ES.perfil && ES.perfil.estilos && ES.perfil.estilos[h.estilo]) { ES.estilo = h.estilo; ES.estiloElegido = true; }
    else { ES.estiloElegido = false; ES.estilo = (ES.perfil && ES.perfil.recomendado) || ES.estilo; }
    ES.pulso = true; pintar(); ES.pulso = false;
    const bt = $("#gsDisenar"); if (bt) { bt.scrollIntoView({block: "nearest", behavior: "smooth"}); bt.focus({preventScroll: true}); }
  }
  function usarModeloComo(h, rol, nueva) {  // «Usar como…» desde la galería de tu carpeta
    const d = ES.diseno, m = ES.bib && ES.bib.modelos.find(x => x.h === h); if (!d || !m) return;
    d.activos = d.activos || {};
    if (nueva) {
      if (!(d.decoracion || []).some(x => x.modelo === rol)) (d.decoracion = d.decoracion || []).push({tipo: rol, modelo: rol, cantidad: CANT_DECO[rol] || 12, altura: m.altura || 1.5});
    }
    if (!d.activos[rol]) d.activos[rol] = m.nombre;
    const item = {fuente: "local", id: m.id, h: m.h, nombre: m.nombre + (m.variante ? ` (${m.variante.slice(0, 4)})` : ""), tipo: "modelo", licencia: m.licencia || "", autor: m.autor || m.paquete,
      miniatura: m.miniatura || "", paquete: m.paquete, ruta: m.ruta, caras: m.caras, relevancia: 1};
    const a = ES.activos[rol] = ES.activos[rol] || {};
    a.resultados = [item].concat((a.resultados || []).filter(x => !(x.fuente === "local" && x.id === m.id)));
    a.sel = 0; a.explicito = true; a.cargando = false; a.error = "";
    d.locales = Object.assign({}, d.locales || {}, {[rol]: m.id});
    toast(`📁 ${m.nombre} → ${nombreRol(rol)}`);
    pintar();
    const fila = document.querySelector(`.gs-rol[data-rol="${CSS.escape(rol)}"]`); if (fila) fila.scrollIntoView({block: "center", behavior: "smooth"});
  }
  function enlazar(b) {
    const on = (sel, fn) => b.querySelectorAll(sel).forEach(el => el.onclick = e => { guardarCampos(); fn(el, e); });
    on("[data-est]", el => { ES.estilo = el.dataset.est; ES.estiloElegido = true; if (ES.diseno && ES.diseno.estilo !== ES.estilo) { ES.diseno = null; ES.resultado = null; ES.activos = {}; toast(tr("Estilo cambiado: vuelve a pulsar «Diseñar mi juego».", "Style changed: press “Design my game” again.")); } pintar(); });
    on("[data-a=estiloAuto]", () => { ES.estiloElegido = false; ES.estilo = (ES.perfil && ES.perfil.recomendado) || ES.estilo; pintar(); });
    on("[data-idea]", el => elegirIdea(+el.dataset.idea));
    on("[data-a=disenar]", () => disenar());
    on("[data-a=corregirIdea]", async () => { const t = (ES.idea || "").trim(); if (!t) return; const r = await jpost("/api/prompt", {accion: "corregir", texto: t}); if (r.ok) { ES.idea = r.texto; pintar(); } else toast("✖ " + (r.error || "error")); });
    on("[data-a=crear]", () => crear());
    on("[data-a=nuevo]", () => { nuevoJuego(); Object.assign(ES, {idea: "", genero: "", seguimiento: null, manual: false, estiloElegido: false, estilo: (ES.perfil && ES.perfil.recomendado) || ES.estilo}); pintar(); });
    on("[data-a=manual]", () => { ES.manual = true; pintar(); });
    const jugar = idx => { openPreview(idx); setTimeout(() => { if (typeof htmlPreview === "function") htmlPreview(idx, $("#pvBody"), true); }, 60); };
    on("[data-a=jugar]", () => jugar(ES.resultado.index)); on("[data-a=ext]", () => window.open(rawUrl(ES.resultado.index), "_blank")); on("[data-a=carpeta]", () => openInFolder(ES.resultado.ruta));
    on("[data-a=jugarSeg]", () => jugar(ES.seguimiento.index)); on("[data-a=extSeg]", () => window.open(rawUrl(ES.seguimiento.index), "_blank"));
    on("[data-a=carpetaSeg]", () => openInFolder(ES.seguimiento.ruta || ES.seguimiento.index));
    on("[data-buscar]", el => buscarRol(el.dataset.buscar, (b.querySelector(`[data-q="${el.dataset.buscar}"]`) || {}).value));
    b.querySelectorAll("[data-q]").forEach(el => el.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); guardarCampos(); buscarRol(el.dataset.q, el.value); } });
    b.querySelectorAll(".gs-act input[type=radio]").forEach(el => el.onchange = () => { guardarCampos(); const rol = el.name.slice(2); ES.activos[rol] = ES.activos[rol] || {}; ES.activos[rol].sel = el.value === "" ? null : +el.value; ES.activos[rol].explicito = true; pintar(); });
    const idea = $("#gsIdea"); if (idea) idea.oninput = () => { ES.idea = idea.value; };
    const gen = $("#gsGenero"); if (gen) gen.onchange = () => { ES.genero = gen.value; };
    // 📁 tu carpeta 3D
    on("[data-a=bibAbrir]", () => ES.bib && openInFolder(ES.bib.carpeta));
    on("[data-a=bibEscanear]", () => cargarBiblioteca({escanear: true}));
    on("[data-a=bibVer]", () => { ES.bibAbierta = !ES.bibAbierta; pintar(); });
    on("[data-a=bibMas]", () => { ES.bibVer += 48; pintar(); });
    on("[data-a=bibDefecto]", () => cargarBiblioteca({carpeta: ""}));
    on("[data-a=bibCambiar]", async () => { const r = await jpost("/api/elegir_carpeta"); if (r && r.ruta) cargarBiblioteca({carpeta: r.ruta}); });
    on("[data-a=bibVerArchivo]", () => { const m = ES.bib && ES.bib.modelos.find(x => x.h === ES.bibSel); if (m) openInFolder(m.ruta); });
    // 🎬 director: mejorar más (con la IA) y aprender de lo que te gusta
    on("[data-a=mejorar]", async () => {
      if (!ES.diseno || ES.mejorando) return; ES.mejorando = true; pintar();
      try { const r = await jpost("/api/juegos/director", {diseno: ES.diseno, idea: ES.idea, usar_ia: true});
        if (!r.ok) throw new Error(r.error || "error"); ES.diseno = r.diseno; ES.director = r.director; ES.activos = {};
        toast(`🎬 ${tr("Diseño mejorado", "Design improved")}: ${r.director.puntaje}/100${r.director.modelo ? " · " + r.director.modelo.split("::").pop() : ""}`); }
      catch (e) { toast("✖ " + (e.message || e)); }
      ES.mejorando = false; pintar();
    });
    on("[data-a=meGusta]", async () => { if (!ES.diseno) return; const r = await jpost("/api/juegos/director", {diseno: ES.diseno, idea: ES.idea, accion: "aprender"});
      toast(r.ok ? "👍 " + tr("¡Anotado! El director lo usará como ejemplo en tus próximos juegos.", "Noted! The director will use it as an example.") : "✖ " + (r.error || "error")); });
    // 🗂 mis diseños
    on("[data-a=misVer]", () => { ES.misAbierto = !ES.misAbierto; if (ES.misAbierto && !ES.mis) cargarMis(); pintar(); });
    on("[data-a=misMas]", () => { ES.misVer += 60; pintar(); });
    on("[data-mistab]", el => { ES.misTab = el.dataset.mistab; ES.misCat = ""; ES.misVer = 60; pintar(); });
    on("[data-miscat]", el => { ES.misCat = ES.misCat === el.dataset.miscat ? "" : el.dataset.miscat; ES.misVer = 60; pintar(); });
    on("[data-misarch]", el => el.dataset.misarch && openInFolder(el.dataset.misarch));
    on("[data-a=misAbrir3d]", () => ES.mis && openInFolder(ES.mis.carpeta_3d));
    on("[data-a=misAbrir2d]", () => ES.mis && openInFolder(ES.mis.carpeta_2d));
    on("[data-a=misCrear]", async () => {
      const texto = (ES.misTexto || "").trim(); if (!texto) { toast(tr("Describe lo que quieres crear.", "Describe what to create.")); return; }
      ES.misCreando = true; pintar();
      try { const r = await jpost("/api/juegos/disenos/crear", {texto, tipo: ES.misTipo, bloques: ES.misBloques});
        if (!r.ok) throw new Error(r.error || "error");
        toast(`${r.reutilizado ? "♻" : "✨"} ${r.nombre} · ${r.categoria || ""}${r.animaciones ? " · 🎞 " + r.animaciones.length : ""}`);
        ES.misAbierto = true; ES.misTab = r.tipo === "2d" ? "2d" : "3d"; ES.misCat = ""; await cargarMis(); }
      catch (e) { toast("✖ " + (e.message || e)); }
      ES.misCreando = false; pintar();
    });
    const mt = $("#gsMisTexto"); if (mt) mt.onkeydown = e => { if (e.key === "Enter") { e.preventDefault(); guardarCampos(); const bt = b.querySelector("[data-a=misCrear]"); if (bt) bt.click(); } };
    on("[data-paq]", el => { ES.bibFiltro.paquete = ES.bibFiltro.paquete === el.dataset.paq ? "" : el.dataset.paq; ES.bibAbierta = true; ES.bibVer = 48; pintar(); });
    on("[data-mod]", el => { ES.bibSel = ES.bibSel === el.dataset.mod ? null : el.dataset.mod; pintar(); const f = $(".gs-ficha"); if (f) f.scrollIntoView({block: "nearest", behavior: "smooth"}); });
    on("[data-usar]", el => usarModeloComo(ES.bibSel, el.dataset.usar, el.dataset.nueva === "1"));
    const bq = $("#gsBibQ"); if (bq) { let t; bq.oninput = () => { clearTimeout(t); t = setTimeout(() => { ES.bibFiltro.q = bq.value; ES.bibVer = 48; pintar(); }, 250); }; }
    const br = $("#gsBibRol"); if (br) br.onchange = () => { ES.bibFiltro.rol = br.value; ES.bibVer = 48; pintar(); };
  }
  async function disenar() {
    const idea = (ES.idea || "").trim();
    if (!idea) { toast(tr("Escribe tu idea (o elige una de ejemplo).", "Write your idea (or pick an example).")); const t = $("#gsIdea"); if (t) t.focus(); return; }
    if (ES.disenando) return;
    ES.disenando = true; ES.resultado = null; ES.log = []; pintar();
    try {
      const r = await jpost("/api/juegos/planificar", {idea, estilo: ES.estiloElegido ? ES.estilo : undefined, genero: ES.genero || undefined});
      if (!r.ok) throw new Error(r.error || "error");
      ES.diseno = r.diseno; ES.modeloIA = r.modelo; ES.aviso = r.aviso; ES.activos = {}; ES.nombre = ""; ES.director = r.director || null;
      ES.estilo = r.diseno.estilo;  // se ve el estilo que se usó (sin fijarlo: la próxima idea puede pedir otro)
      ES.extras.descModelo = ES.extras.descModelo || (r.diseno.activos || {}).coleccionable || "";
      if (r.biblioteca && r.biblioteca.roles.length) toast(`📁 ${tr("Usaré", "I'll use")} ${r.biblioteca.roles.length} ${tr("modelos de tu carpeta 3D", "models from your 3D folder")}`);
    } catch (e) { toast("✖ " + (e.message || e)); }
    ES.disenando = false; pintar();
    if (ES.diseno && ES.diseno.motor === "3d") {
      const d = ES.diseno, loc = d.locales || {};
      // primero los roles principales (con internet); la decoración que ya tiene modelo tuyo solo busca en tu carpeta (rápido)
      for (const rol of ordenRoles(d)) { if (ES.diseno !== d) return; await buscarRol(rol, d.activos[rol], true, !ROLES_PERSONAJE.test(rol) && !!loc[rol]); }
    }
  }
  async function buscarRol(rol, consulta, auto, soloLocal) {
    const d = ES.diseno; if (!d) return;
    const a = ES.activos[rol] = Object.assign(ES.activos[rol] || {}, {cargando: true, consulta: consulta || d.activos[rol], error: ""}); pintar();
    try {
      const r = await jpost("/api/juegos/activos", {consulta: a.consulta, tipo: "modelo", estilo: d.estilo, nivel: (ES.perfil || {}).nivel,
        tema: d.tema, genero: d.genero, rol, limite: 8, fuentes: soloLocal ? ["local"] : undefined});
      const previo = (a.resultados || []).filter(x => x.fuente === "local" && a.explicito && a.sel != null && a.resultados[a.sel] === x);
      a.resultados = previo.concat((r.resultados || []).filter(x => (x.fuente !== "sketchfab" || !(r.sin_clave || []).includes("sketchfab")) && !previo.some(p => p.id === x.id)));
      if (previo.length) a.sel = 0;
      if (!soloLocal) { ES.sinClave = r.sin_clave; ES.paquetes = r.paquetes; }
      const errs = Object.entries(r.errores || {}).map(([f, e]) => `${f}: ${e}`);
      if (!a.resultados.length) a.error = errs.length ? tr("Galerías sin conexión: ", "Galleries offline: ") + errs.join(" · ") : tr("Sin resultados: prueba otra palabra (mejor en inglés).", "No results: try another word.");
      // preselección: tu modelo elegido para este rol; si no, el más relevante que encaje (personajes de Poly Haven no: casi siempre son estatuas)
      if (auto && a.sel == null && !a.explicito && a.resultados.length) {
        const idLoc = (d.locales || {})[rol], i = idLoc ? a.resultados.findIndex(x => x.fuente === "local" && x.id === idLoc) : -1;
        const j = a.resultados.findIndex(x => x.fuente !== "local");
        const personaje = /^(jugador|enemigo|jefe|npc)/.test(rol);
        if (i >= 0 && !(personaje && !a.resultados[i].animaciones)) a.sel = i;  // el de tu carpeta que el Estudio eligió para esta temática
        else if (j >= 0 && !personaje) a.sel = j;  // personajes de internet no: Noviq crea los suyos, totalmente animados
      }
    } catch (e) { a.error = String(e.message || e); }
    a.cargando = false; pintar();
  }
  async function crear() {
    const d = ES.diseno; if (!d || ES.creando) return;
    const elegidos = Object.entries(ES.activos).filter(([, a]) => a.sel != null && a.resultados && a.resultados[a.sel]).map(([rol, a]) => Object.assign({}, a.resultados[a.sel], {rol}));
    const sinModelo = Object.entries(ES.activos).filter(([, a]) => a.explicito && a.sel == null).map(([rol]) => rol);
    ES.creando = true; ES.log = [tr("Creando el proyecto…", "Creating the project…")]; pintar();
    try {
      const r = await jpost("/api/juegos/crear", {diseno: d, nombre: ES.nombre || d.titulo, activos: elegidos, sin_modelo: sinModelo, buscar_auto: false});
      if (!r.ok) throw new Error(r.error || "error");
      let t;
      for (;;) { await new Promise(ok => setTimeout(ok, 700)); t = await jget("/api/juegos/trabajo/" + r.trabajo); ES.log = t.log.slice(); pintar(); if (t.estado !== "trabajando") break; }
      if (t.estado !== "listo" || !t.resultado || !t.resultado.ok) throw new Error((t.resultado && t.resultado.error) || tr("no se pudo crear", "could not create"));
      const res = t.resultado; ES.resultado = res;
      const x = ES.extras;
      if (d.motor === "3d" && x.textura && (ES.perfil || {}).clave_nvidia) {
        ES.log.push("🎨 " + tr("Generando la textura del suelo con FLUX…", "Generating the ground texture with FLUX…")); pintar();
        const q = await jpost("/api/nvidia", {accion: "textura", proyecto: res.proyecto, descripcion: x.descTex || d.textura_suelo || "grass", nombre: "suelo", rol: "suelo"});
        ES.log.push(q.ok ? "✔ " + tr("Textura lista (assets/texturas/suelo)", "Texture ready") : "⚠ " + tr("Textura: ", "Texture: ") + q.error);
      }
      if (d.motor === "3d" && x.modelo && (x.descModelo || "").trim() && (ES.perfil || {}).clave_nvidia) {
        ES.log.push("🧊 " + tr("Generando el modelo 3D con TRELLIS (30-90 s)…", "Generating the 3D model with TRELLIS…")); pintar();
        const q = await jpost("/api/nvidia", {accion: "modelo_3d", proyecto: res.proyecto, descripcion: x.descModelo, rol: x.rolModelo});
        ES.log.push(q.ok ? `✔ ${tr("Modelo listo", "Model ready")}: ${q.glb.split(/[\\/]/).pop()}` : "⚠ TRELLIS: " + q.error);
      }
      ES.log.push("✅ " + tr("¡Listo! Ahora la IA del chat lo prueba y programa tus reglas especiales.", "Done! The chat AI now tests it and codes your special rules."));
      ES.creando = false; pintar();
      // la IA del chat continúa sobre la base (nuevo chat en el proyecto del juego, en modo juego)
      curProject = res.proyecto; await loadProjects();
      newChat(); ES.interno = true; inpEl().value = res.mensaje_ia; send();
      showPanel("game");
    } catch (e) { ES.log.push("✖ " + (e.message || e)); ES.creando = false; pintar(); }
  }
  // lo que pasa en el chat actualiza el seguimiento del Estudio
  window.estudioEvento = (ev, p) => {
    const s = ES.seguimiento; if (!s) return;
    if (ev === "tool_start" && p.name === "crear_juego") { Object.assign(s.pasos, {pc: "ok", diseno: "run", motor: "pend"}); pintar(); }
    else if (ev === "tool_result" && p.name === "crear_juego") { const ok = !/^ERROR/.test(p.result || ""); Object.assign(s.pasos, {diseno: ok ? "ok" : "pend", motor: ok ? "ok" : "pend", activos: ok ? "ok" : "pend", probar: ok ? "run" : "pend"}); pintar(); }
    else if (ev === "tool_start" && (p.name === "buscar_activos_3d" || p.name === "descargar_activo")) { if (s.pasos.activos !== "ok") s.pasos.activos = "run"; pintar(); }
    else if (ev === "tool_result" && p.name === "probar_web" && s.pasos.motor === "ok") { s.pasos.probar = "ok"; pintar(); }
    else if (ev === "project" && p.path) { s.ruta = p.path; s.index = p.path.replace(/[\\/]+$/, "") + (p.path.includes("\\") ? "\\" : "/") + "index.html"; pintar(); }
  };

  /* ───── Miniaturas de tus modelos: se dibujan una vez con WebGL (three.js del motor) y se guardan en datos/ ───── */
  const MINI = {cola: [], enCola: new Set(), fallos: new Set(), trabajando: false, r: null, three: null};
  function cargarThree() {
    if (MINI.three) return MINI.three;
    const js = src => new Promise((ok, mal) => { const s = document.createElement("script"); s.src = src; s.onload = ok; s.onerror = () => mal(new Error("no cargó " + src)); document.head.append(s); });
    MINI.three = (window.THREE ? Promise.resolve() : js("/static/juegos/lib/three.min.js")).then(() => (THREE.GLTFLoader ? null : js("/static/juegos/lib/GLTFLoader.js")));
    MINI.three.catch(() => { MINI.three = null; });
    return MINI.three;
  }
  function rutaDe(h) {
    const m = ES.bib && ES.bib.modelos.find(x => x.h === h); if (m) return m.ruta;
    for (const a of Object.values(ES.activos)) for (const x of a.resultados || []) if (x.h === h && x.ruta) return x.ruta;
    return null;
  }
  function miniaturasPendientes() {
    document.querySelectorAll("#gameBody img[data-mini]").forEach(img => {
      const h = img.dataset.mini; if (!h || !img.src.startsWith("data:") || MINI.fallos.has(h) || MINI.enCola.has(h)) return;
      MINI.enCola.add(h); MINI.cola.push(h);
    });
    if (MINI.cola.length && !MINI.trabajando) procesarMiniaturas();
  }
  function ponerMiniatura(h, url) {
    const src = conToken(url);
    if (ES.bib) ES.bib.modelos.forEach(m => { if (m.h === h) m.miniatura = url; });
    Object.values(ES.activos).forEach(a => (a.resultados || []).forEach(x => { if (x.h === h) x.miniatura = url; }));
    document.querySelectorAll(`#gameBody img[data-mini="${h}"]`).forEach(i => { i.src = src; });
  }
  async function procesarMiniaturas() {
    MINI.trabajando = true;
    try { await cargarThree(); } catch (e) { MINI.cola.forEach(h => MINI.fallos.add(h)); MINI.cola = []; MINI.trabajando = false; return; }
    while (MINI.cola.length) {
      const h = MINI.cola.shift(), ruta = rutaDe(h);
      if (!ruta || !document.querySelector(`#gameBody img[data-mini="${h}"]`)) { MINI.enCola.delete(h); continue; }  // ya no se ve: se dibuja cuando vuelva a aparecer
      try {
        const png = await dibujarMiniatura(ruta);
        const r = await jpost("/api/juegos/biblioteca/miniatura", {h, png});
        if (r.ok) ponerMiniatura(h, r.url); else MINI.fallos.add(h);
      } catch (e) { MINI.fallos.add(h); console.warn("miniatura", ruta, e); }
      await new Promise(ok => setTimeout(ok, 15));
    }
    MINI.trabajando = false;
  }
  async function dibujarMiniatura(ruta) {
    if (!MINI.r) {
      const c = document.createElement("canvas"); c.width = 176; c.height = 132;
      const r = new THREE.WebGLRenderer({canvas: c, antialias: true, alpha: true, preserveDrawingBuffer: true});
      r.setPixelRatio(1); r.setSize(176, 132, false); r.outputEncoding = THREE.sRGBEncoding; r.setClearColor(0x000000, 0);
      const escena = new THREE.Scene();
      escena.add(new THREE.HemisphereLight(0xffffff, 0x556070, 1.05));
      const sol = new THREE.DirectionalLight(0xffffff, 0.95); sol.position.set(3, 6, 5); escena.add(sol);
      MINI.r = {c, r, escena, cam: new THREE.PerspectiveCamera(32, 176 / 132, 0.01, 5000), loader: new THREE.GLTFLoader()};
    }
    const {c, r, escena, cam, loader} = MINI.r;
    const gltf = await new Promise((ok, mal) => loader.load(rawUrl(ruta), ok, undefined, mal));
    const obj = gltf.scene; escena.add(obj); obj.updateMatrixWorld(true);
    try {
      const box = new THREE.Box3().setFromObject(obj), esfera = box.getBoundingSphere(new THREE.Sphere());
      const rad = esfera.radius > 0 ? esfera.radius : 1, dist = rad / Math.sin(THREE.MathUtils.degToRad(cam.fov / 2)) * 1.02;
      cam.position.copy(esfera.center).addScaledVector(new THREE.Vector3(0.95, 0.62, 1.25).normalize(), dist);
      cam.near = dist / 200; cam.far = dist * 20; cam.updateProjectionMatrix(); cam.lookAt(esfera.center);
      r.clear(); r.render(escena, cam);
      return c.toDataURL("image/png");
    } finally {
      escena.remove(obj);
      obj.traverse(o => { if (o.geometry) o.geometry.dispose(); const ms = o.material ? (Array.isArray(o.material) ? o.material : [o.material]) : [];
        ms.forEach(m => { for (const k in m) if (m[k] && m[k].isTexture) m[k].dispose(); m.dispose(); }); });
    }
  }

  /* ═════════════ ⚙ Ajustes → 🎮 Juegos y NVIDIA ═════════════ */
  window.estudioLlenarAjustes = async () => {
    const J = CFG.juegos || {}, P = CFG.prompt_tools || {};
    $("#jg-detector").value = J.detector || "auto"; $("#jg-cc0").checked = !!J.solo_cc0; $("#jg-auto").checked = J.buscar_activos !== false;
    $("#pt-barra").checked = P.barra !== false; $("#pt-local").checked = P.correccion_local !== false; $("#pt-modelo").value = CFG.modelo_rapido || "";
    if ($("#jg-carpeta3d")) $("#jg-carpeta3d").value = J.carpeta_3d || "";
    try { const k = await jget("/api/juegos/claves"); $("#jg-sketchfab").value = k.sketchfab || ""; $("#jg-polypizza").value = k.polypizza || ""; } catch (e) {}
    try { const b = await jget("/api/juegos/biblioteca"); if (b && b.defecto && $("#jg-carpeta3d")) $("#jg-carpeta3d").placeholder = b.defecto; } catch (e) {}
  };
  const guardarClaves = async () => { try { await jpost("/api/juegos/claves", {sketchfab: $("#jg-sketchfab").value.trim(), polypizza: $("#jg-polypizza").value.trim()}); } catch (e) {} };
  $("#jg-sketchfab").addEventListener("change", guardarClaves); $("#jg-polypizza").addEventListener("change", guardarClaves);
  if ($("#jg-carpeta3d-elegir")) $("#jg-carpeta3d-elegir").onclick = async () => { const r = await jpost("/api/elegir_carpeta"); if (r && r.ruta) $("#jg-carpeta3d").value = r.ruta; };
  if ($("#jg-carpeta3d-abrir")) $("#jg-carpeta3d-abrir").onclick = async () => { const v = $("#jg-carpeta3d").value.trim(); if (v) openInFolder(v); else { const b = await jget("/api/juegos/biblioteca"); if (b && b.carpeta) openInFolder(b.carpeta); } };
  $("#jg-probar").onclick = async () => {
    await guardarClaves(); $("#jg-out").textContent = tr("Probando las galerías…", "Testing galleries…");
    const r = await jget("/api/juegos/galerias");
    $("#jg-out").textContent = Object.entries(r).map(([f, x]) => `${x.ok ? "✔" : "✖"} ${f === "local" ? tr("tu carpeta 3D", "your 3D folder") : f}: ${x.ok ? `${x.n} ${f === "local" ? tr("modelos", "models") : tr("resultados", "results")} · ${x.ms} ms${x.descarga === false ? tr(" · falta el token para descargar", " · token needed to download") : ""}` : x.error}`).join("\n");
  };
  $("#jg-gpu").onclick = async () => { $("#jg-out").textContent = tr("Analizando la GPU…", "Analyzing the GPU…"); const r = await jget("/api/nvidia?actualizar=1"); $("#jg-out").textContent = r.resumen; };
  $("#pt-barra").addEventListener("change", () => { $("#ptools").style.display = $("#pt-barra").checked ? "" : "none"; });

  /* ═════════════ Arranque ═════════════ */
  $("#openGame").onclick = () => { $("#side").classList.remove("open"); abrirEstudio({}); };
  montarBarra();
  jget("/api/juegos/lexico").then(l => { GJ.lex = l; }).catch(() => {});
  document.addEventListener("click", e => { const pop = $("#ptPop"); if (pop.classList.contains("show") && !e.target.closest("#ptPop,#ptools")) pop.classList.remove("show"); });
})();
