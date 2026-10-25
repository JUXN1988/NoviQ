/* Noviq — 🖥 PC, 📅 agenda, 🔌 catálogo MCP, 📱 Telegram, ✉ correo y 🛡 aprobaciones (se carga después de app.js y usa sus utilidades). */
"use strict";
(function () {
  const DIAS_C = ["Lun", "Mar", "Mié", "Jue", "Vie", "Sáb", "Dom"];

  /* ═════════════ 📅 Agenda ═════════════ */
  async function renderAgenda() {
    let r; try { r = await jget("/api/agenda"); } catch (e) { return; }
    $("#agSemana").innerHTML = r.semana.map((d, i) => `<div class="agdia ${i === 0 ? "hoy" : ""}"><b>${i === 0 ? "Hoy" : i === 1 ? "Mañana" : esc(d.dia[0].toUpperCase() + d.dia.slice(1))}</b><span class="small">${d.fecha.slice(8)}/${d.fecha.slice(5, 7)}</span>
      ${d.items.length ? d.items.map(it => `<div class="agit ${it.activa ? "" : "off"}" title="${esc(it.descripcion || "")}"><span>${esc(it.hora)}</span> ${esc(it.nombre)}</div>`).join("") : `<div class="small muted">—</div>`}</div>`).join("");
    $("#agNotas").innerHTML = r.notas.length ? r.notas.map(n => `<div class="agnota ${n.importante ? "imp" : ""} t-${esc(n.tipo)}"><span class="small">${new Date(n.t * 1000).toLocaleString()}</span> ${n.importante ? "⭐ " : ""}${esc(n.texto)}
      <button class="ib" data-bn="${esc(n.id)}" title="Borrar nota">✕</button></div>`).join("") : `<div class="small">Aún no hay notas.</div>`;
    $("#agNotas").querySelectorAll("[data-bn]").forEach(b => b.onclick = async () => { await jpost("/api/agenda", {borrar: b.dataset.bn}); renderAgenda(); });
  }
  $("#agNotaAdd").onclick = async () => { const t = $("#agNota").value.trim(); if (!t) return; await jpost("/api/agenda", {texto: t, importante: $("#agImp").checked}); $("#agNota").value = ""; renderAgenda(); };
  $("#agNota").onkeydown = e => { if (e.key === "Enter") $("#agNotaAdd").click(); };

  // «Cuándo» en palabras → rellena el formulario (tipo, hora, días, fecha)
  let tCuando;
  $("#tpCuando").oninput = () => {
    clearTimeout(tCuando);
    tCuando = setTimeout(async () => {
      const t = $("#tpCuando").value.trim(), out = $("#tpCuandoOut");
      if (!t) { out.textContent = ""; return; }
      const r = await jpost("/api/agenda/interpretar", {texto: t});
      if (!r.ok) { out.innerHTML = `<span class="bad-t">No entendí cuándo. Ej.: «lunes, miércoles y jueves a las 9», «cada 2 horas», «mañana a las 10».</span>`; return; }
      const c = r.cuando;
      if (c.tipo === "intervalo") { $("#tpTipo").value = "intervalo"; $("#tpCada").value = c.cada_min; }
      else if (c.tipo === "una_vez") { $("#tpTipo").value = "una_vez"; $("#tpFecha").value = c.fecha; }
      else { $("#tpTipo").value = "diario"; $("#tpHora").value = c.hora; const ds = c.dias || [0, 1, 2, 3, 4, 5, 6]; $("#tpDias").querySelectorAll("input").forEach(x => x.checked = ds.includes(+x.value)); }
      $("#tpTipo").onchange();
      out.innerHTML = `<span class="ok-t">✔ ${c.tipo === "intervalo" ? `cada ${c.cada_min} min` : c.tipo === "una_vez" ? "una vez: " + new Date(c.fecha).toLocaleString() : ((c.dias || []).length && c.dias.length < 7 ? c.dias.map(d => DIAS_C[d]).join(", ") : "todos los días") + " a las " + c.hora}</span>`;
    }, 350);
  };

  /* ═════════════ 🖱 Control del PC y 🪪 perfil ═════════════ */
  async function renderPerfil(forzar) {
    $("#pcPerfil").textContent = forzar ? "Averiguando (unos segundos)…" : "…";
    try { const p = await jget("/api/pc/perfil" + (forzar ? "?forzar=1" : "")); $("#pcPerfil").textContent = p.resumen || "(sin datos)"; }
    catch (e) { $("#pcPerfil").textContent = "No pude leer el perfil: " + e; }
  }
  $("#pcPerfilR").onclick = () => renderPerfil(true);
  $("#pcOcr").onclick = async () => { $("#pcOut").innerHTML = `<span class="spin"></span> Leyendo la pantalla con el OCR de Windows…`; const r = await jpost("/api/pc/leer_pantalla");
    $("#pcOut").innerHTML = `<pre style="white-space:pre-wrap;max-height:200px;overflow:auto" class="${r.ok ? "" : "bad-t"}">${esc(r.texto)}</pre>`; };
  $("#pcNav").onchange = () => jpost("/api/pc/navegador", {navegador: $("#pcNav").value});

  /* ═════════════ 🔌 Catálogo MCP ═════════════ */
  function pintarCatalogo(r) {
    const q = r.requisitos || {};
    $("#mcpReq").innerHTML = `${q.node ? `<span class="ok-t">✔ Node.js</span>` : `<span class="bad-t">✖ Node.js</span> <button class="linkbtn" data-req="node">instalar</button>`} ·
      ${q.uv ? `<span class="ok-t">✔ uv</span>` : `<span class="bad-t">✖ uv</span> <button class="linkbtn" data-req="uv">instalar</button>`}${q.winget ? "" : " · (sin winget: instala Node.js desde nodejs.org)"}`;
    if (r.navegador && $("#pcNav")) $("#pcNav").value = r.navegador;
    const cats = {};
    (r.catalogo || []).forEach(x => (cats[x.cat] = cats[x.cat] || []).push(x));
    $("#mcpCat").innerHTML = Object.entries(cats).map(([c, xs]) => `<h4>${esc(c)}</h4><div class="mcpgrid">${xs.map(x => `<div class="mcpc ${x.agregado ? "on" : ""}">
      <div><b>${esc(x.nombre)}</b>${x.recomendado ? ` <span class="badge g">recomendado</span>` : ""} <span class="badge">${x.modo === "agente" ? "subagente" : x.modo === "directo" ? "directo" : x.modo}</span></div>
      <div class="small">${esc(x.desc)}</div>
      <div class="small">${x.agregado ? (x.estado === "conectado" ? `<span class="ok-t">✔ conectado · ${x.herramientas} herramientas</span>` : x.estado === "error" ? `<span class="bad-t">✖ ${esc((x.error || "").slice(0, 160))}</span>` : `<span class="spin"></span> ${esc(x.estado || "iniciando")}`) : `requiere ${esc(x.req === "uv" ? "uv (Python)" : "Node.js")}`}</div>
      <div class="btns">${x.agregado ? `<button class="btn" data-mq="${esc(x.key)}">Quitar</button>` : `<button class="btn ok" data-ma="${esc(x.key)}">＋ Agregar</button>`}</div></div>`).join("")}</div>`).join("");
    const acc = async (body, msg) => {
      $("#mcpCatOut").innerHTML = `<span class="spin"></span> ${msg}`;
      const rr = await jpost("/api/mcp/catalogo", body); $("#mcpCatOut").innerHTML = esc((rr.log || []).join(" · ")); pintarCatalogo(rr); vigilar();
    };
    $("#mcpCat").querySelectorAll("[data-ma]").forEach(b => b.onclick = () => acc({accion: "agregar", key: b.dataset.ma}, "Instalando y arrancando (la primera vez puede tardar 1-3 min)…"));
    $("#mcpCat").querySelectorAll("[data-mq]").forEach(b => b.onclick = () => acc({accion: "quitar", key: b.dataset.mq}, "Quitando…"));
    $("#mcpReq").querySelectorAll("[data-req]").forEach(b => b.onclick = () => acc({accion: "requisito", req: b.dataset.req}, "Instalando con winget (1-3 min)…"));
  }
  let vig = null;
  function vigilar() {
    clearInterval(vig); let n = 0;
    vig = setInterval(async () => { const r = await jget("/api/mcp/catalogo"); pintarCatalogo(r);
      if (++n > 40 || !(r.catalogo || []).some(x => x.agregado && x.estado === "iniciando")) clearInterval(vig); }, 4000);
  }
  async function renderCatalogo() { try { pintarCatalogo(await jget("/api/mcp/catalogo")); } catch (e) {} }
  $("#mcpRec").onclick = async () => { $("#mcpCatOut").innerHTML = `<span class="spin"></span> Conectando Windows-MCP, navegador, archivos y búsqueda (instala lo que falte)…`;
    const r = await jpost("/api/mcp/catalogo", {accion: "recomendados"}); $("#mcpCatOut").innerHTML = esc((r.log || []).join(" · ")); pintarCatalogo(r); vigilar(); };
  const verCat = $("#mcpVerCat"); if (verCat) verCat.onclick = () => { $("#mcpModal").classList.remove("show"); $("#openPc").onclick(); const b = document.querySelector('[data-tab="pc-mcp"]'); if (b) b.click(); };

  // abrir el modal: además de lo de siempre, agenda + perfil + catálogo
  const renderPcBase = renderPc;
  window.renderPc = renderPc = async function () { await renderPcBase(); renderAgenda(); };  // eslint-disable-line no-global-assign
  $("#openPc").onclick = () => { openModal("#pcModal"); $("#tpTipo").onchange(); renderPc(); renderPerfil(false); renderCatalogo(); };

  /* ═════════════ ⚙ Ajustes → 📱 Telegram y correo ═════════════ */
  const AVISOS = {aprobaciones: "✅ Aprobaciones", tareas: "⏰ Resultados de tareas", errores: "❌ Errores", terminado: "✔ Trabajos terminados", notas: "⭐ Notas importantes"};
  function pintarTelegram(t) {
    $("#tgEstado").innerHTML = !t.tiene_token ? `<span class="small">Sin bot configurado.</span>`
      : `${t.vinculado ? `<span class="ok-t">✔ Vinculado con ${esc(t.usuario || "tu chat")}</span>` : `<span class="bad-t">⏳ Falta vincular tu chat</span>`} · bot <b>@${esc(t.bot)}</b>
         · ${t.escuchando ? `<span class="ok-t">escuchando</span>` : `<span class="bad-t">detenido</span>`}${t.error ? ` · <span class="bad-t">${esc(t.error)}</span>` : ""}`;
    $("#tgCodigo").innerHTML = t.tiene_token && !t.vinculado && t.codigo ? `<div class="tgcod">Mándale este código a <a href="https://t.me/${esc(t.bot)}" target="_blank">@${esc(t.bot)}</a>: <b>${esc(t.codigo)}</b> <button class="linkbtn" id="tgRefresh">ya lo mandé ↻</button></div>` : "";
    const rf = $("#tgRefresh"); if (rf) rf.onclick = llenarTelegram;
    $("#tgAvisos").innerHTML = Object.entries(AVISOS).map(([k, n]) => `<label class="chk"><input type="checkbox" data-av="${k}" ${t.avisos[k] ? "checked" : ""}> ${n}</label>`).join("");
    $("#tgAvisos").querySelectorAll("[data-av]").forEach(c => c.onchange = () => jpost("/api/telegram", {avisos: {[c.dataset.av]: c.checked}}));
    $("#tg-activo").checked = !!t.activo;
  }
  async function llenarTelegram() { try { pintarTelegram(await jget("/api/telegram")); } catch (e) {} }
  $("#tg-guardar").onclick = async () => {
    const tk = $("#tg-token").value.trim(); if (!tk) { toast("Pega el token del bot"); return; }
    $("#tgEstado").innerHTML = `<span class="spin"></span> Probando el token con Telegram…`;
    const r = await jpost("/api/telegram", {token: tk}); $("#tg-token").value = "";
    if (!r.ok) toast("✖ " + r.error); pintarTelegram(r);
    if (r.ok && !r.vinculado) { let n = 0; const iv = setInterval(async () => { const t = await jget("/api/telegram"); pintarTelegram(t); if (t.vinculado || ++n > 60) { clearInterval(iv); if (t.vinculado) toast("📱 ¡Telegram vinculado!"); } }, 3000); }
  };
  $("#tg-probar").onclick = async () => { const r = await jpost("/api/telegram", {probar: true}); toast(r.ok ? "📨 Mensaje enviado: revisa Telegram" : "✖ " + r.error); pintarTelegram(r); };
  $("#tg-desv").onclick = async () => { if (!confirm("¿Desvincular tu chat de Telegram? (tendrás que volver a mandar el código)")) return; pintarTelegram(await jpost("/api/telegram", {desvincular: true})); };
  $("#tg-activo").onchange = async () => pintarTelegram(await jpost("/api/telegram", {activo: $("#tg-activo").checked}));

  // ✉ correo
  let CO = null;
  function pintarCorreo(r) {
    CO = r;
    $("#coList").innerHTML = r.cuentas.length ? r.cuentas.map(c => `<div class="tprow"><div><b>${esc(c.correo || c.nombre || r.presets[c.tipo].nombre)}</b> <span class="badge">${esc(r.presets[c.tipo].nombre)}</span>
        ${c.id === r.predeterminada ? `<span class="badge g">★ predeterminada</span>` : ""} ${c.tipo === "outlook_app" ? "" : c.tiene_clave ? `<span class="small ok-t">clave guardada</span>` : `<span class="small bad-t">sin clave</span>`}</div>
      <div class="pa"><button data-cp="${esc(c.id)}">🩺 Probar</button><button data-ce="${esc(c.id)}" title="Te envía un correo a ti mismo">📨 Correo de prueba</button>${c.id === r.predeterminada ? "" : `<button data-cd="${esc(c.id)}">★</button>`}<button data-cx="${esc(c.id)}">🗑</button></div></div>`).join("")
      : `<div class="small">No hay cuentas. ${r.outlook_instalado ? "Tienes Outlook de escritorio: se usará ese si no agregas otra." : "Agrega una abajo."}</div>`;
    const go = async (url, body, msg) => {
      $("#coOut").textContent = msg; const x = await jpost(url, body);
      if (url.endsWith("/probar")) $("#coOut").innerHTML = `<span class="${x.ok ? "ok-t" : "bad-t"}">${esc(x.texto)}</span>`;
      else { $("#coOut").textContent = x.error ? "✖ " + x.error : ""; pintarCorreo(x); }
    };
    $("#coList").querySelectorAll("[data-cp]").forEach(b => b.onclick = () => go("/api/correo/probar", {id: b.dataset.cp}, "Probando la conexión…"));
    $("#coList").querySelectorAll("[data-ce]").forEach(b => b.onclick = () => go("/api/correo/probar", {id: b.dataset.ce, enviar_prueba: true}, "Enviándote un correo de prueba…"));
    $("#coList").querySelectorAll("[data-cd]").forEach(b => b.onclick = () => go("/api/correo", {predeterminada: b.dataset.cd}, ""));
    $("#coList").querySelectorAll("[data-cx]").forEach(b => b.onclick = () => { if (confirm("¿Quitar esta cuenta?")) go("/api/correo", {quitar: b.dataset.cx}, ""); });
    tipoCorreo();
  }
  function tipoCorreo() {
    const t = $("#co-tipo").value;
    $("#co-smtpRow").style.display = t === "smtp" ? "" : "none";
    $("#co-claveRow").style.display = t === "outlook_app" ? "none" : "";
    $("#co-claveLbl").textContent = t === "gmail" ? "Contraseña de aplicación (16 letras)" : "Contraseña";
    $("#co-correo").placeholder = t === "gmail" ? "tu@gmail.com" : t === "hotmail" ? "tu@hotmail.com" : t === "outlook_app" ? "(opcional) cuenta de Outlook a usar" : "tu@empresa.com";
    const p = CO && CO.presets[t];
    $("#coAyuda").innerHTML = (p ? "💡 " + esc(p.ayuda) : "") + (t === "gmail" ? ` <a href="https://myaccount.google.com/apppasswords" target="_blank">Crear contraseña de aplicación</a>` : "");
  }
  $("#co-tipo").onchange = tipoCorreo;
  $("#co-guardar").onclick = async () => {
    const t = $("#co-tipo").value, body = {tipo: t, correo: $("#co-correo").value.trim(), nombre: $("#co-nombre").value.trim(), clave: $("#co-clave").value};
    if (t !== "outlook_app" && (!body.correo || !body.clave)) { toast("Pon el correo y la contraseña"); return; }
    if (t === "smtp") Object.assign(body, {smtp: $("#co-smtp").value.trim(), puerto_smtp: +$("#co-psmtp").value || 587, seguridad: $("#co-seg").value,
      imap: $("#co-imap").value.trim(), usuario: $("#co-usuario").value.trim()});
    const r = await jpost("/api/correo", body);
    if (!r.ok) { $("#coOut").textContent = "✖ " + r.error; return; }
    $("#co-clave").value = ""; pintarCorreo(r);
    const nueva = r.cuentas[r.cuentas.length - 1];
    if (nueva) { $("#coOut").textContent = "Probando la cuenta…"; const x = await jpost("/api/correo/probar", {id: nueva.id}); $("#coOut").innerHTML = `<span class="${x.ok ? "ok-t" : "bad-t"}">${esc(x.texto)}</span>`; }
  };
  async function llenarCorreo() { try { pintarCorreo(await jget("/api/correo")); } catch (e) {} }

  // 🛡 aprobaciones y permisos recordados
  function pintarGuardia(r) {
    const g = r.guardia;
    $("#gdCats").innerHTML = `<label class="chk"><input type="checkbox" data-g="activo" ${g.activo ? "checked" : ""}> <b>Guardia activa</b></label>` +
      Object.entries(r.categorias).map(([k, n]) => `<label class="chk"><input type="checkbox" data-g="${k}" ${g[k] ? "checked" : ""}> ${esc(n)}</label>`).join("");
    $("#gdCats").querySelectorAll("[data-g]").forEach(c => c.onchange = async () => pintarGuardia(await jpost("/api/permisos", {guardia: {[c.dataset.g]: c.checked}})));
    $("#gd-espera").value = g.espera_min;
    $("#gdPermisos").innerHTML = r.permisos_siempre.length ? r.permisos_siempre.map(p => `<span class="badge">${esc(p)} <button class="linkbtn" data-pq="${esc(p)}" title="Volver a preguntar">✕</button></span>`).join(" ") : "(ninguno)";
    $("#gdPermisos").querySelectorAll("[data-pq]").forEach(b => b.onclick = async () => pintarGuardia(await jpost("/api/permisos", {quitar: b.dataset.pq})));
  }
  $("#gd-espera").onchange = async () => pintarGuardia(await jpost("/api/permisos", {guardia: {espera_min: +$("#gd-espera").value || 30}}));
  async function llenarGuardia() { try { pintarGuardia(await jget("/api/permisos")); } catch (e) {} }

  window.windowsLlenarAjustes = () => { llenarTelegram(); llenarCorreo(); llenarGuardia(); };
  const tgTab = document.querySelector('[data-tab="t-tg"]'); if (tgTab) tgTab.addEventListener("click", () => window.windowsLlenarAjustes());
})();
