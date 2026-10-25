/* Noviq — 🤖 Avatar: botón 🎙 del chat, pedidos por voz que entran al chat como si los escribieras y la pestaña
   ⚙ Ajustes → 🤖 Avatar (se carga después de app.js y usa sus utilidades: $, jget, jpost, toast, send, busy, convId). */
"use strict";
(function () {
  const est = document.createElement("style");
  est.textContent = `
    #avMic{position:relative;transition:transform .15s ease}
    #avMic.listo::after{content:"";position:absolute;right:3px;top:3px;width:7px;height:7px;border-radius:50%;background:#3fe9c4;box-shadow:0 0 6px #3fe9c4}
    #avMic.oyendo,#avMic.forzado{color:#3fe9c4;animation:avPulso .9s ease-in-out infinite}
    #avMic.procesando{color:#ffc861}
    #avMic.error{color:#ff6b7d}
    #avMic.off{opacity:.55}
    @keyframes avPulso{50%{transform:scale(1.18)}}
    .avmot{display:flex;gap:8px;align-items:center;margin:3px 0}
    .avmot b{min-width:18px}
    .avvoces{max-height:300px;overflow:auto;border:1px solid var(--border);border-radius:10px;margin-top:6px}
    .avvoz{display:flex;gap:8px;align-items:center;padding:6px 10px;border-bottom:1px solid var(--border)}
    .avvoz:last-child{border-bottom:none}
    .avvoz.on{background:rgba(63,220,43,.10)}
    .avvoz .b{font-size:18px}
    .avvoz .grow{flex:1}
    .avmem{display:flex;gap:6px;align-items:baseline;margin:2px 0}
    .avmem .ib{opacity:.5}
    .avmem .ib:hover{opacity:1}`;
  document.head.append(est);

  const MIC = $("#avMic");
  let OIDO = {};

  function pintarMic(o) {
    OIDO = o || {};
    if (!MIC) return;
    const e = OIDO.estado || "apagado";
    MIC.className = "ibtn " + e + (OIDO.modo === "apagado" ? " off" : "");
    MIC.title = {listo: OIDO.modo === "palabra" ? "🎙 Te escucho cuando dices «Noviq…» · clic para hablar ya" : "🎙 Escuchando · clic para hablar ya",
                 oyendo: "🎙 Te está oyendo…", procesando: "🎙 Entendiendo lo que dijiste…",
                 error: "🎙 Micrófono: " + (OIDO.error || "error"), apagado: "🎙 Háblale a Noviq (usa el micrófono del avatar · Ctrl+Alt+Espacio)"}[e] || MIC.title;
  }

  if (MIC) MIC.onclick = async () => {
    MIC.className = "ibtn forzado";
    const r = await jpost("/api/avatar", {escuchar: true}).catch(() => null);
    if (!r || !r.vivo) toast(r && r.error ? "🤖 " + r.error : "🤖 Abriendo el avatar para escucharte…");
  };

  /* ── Pedido por voz → al chat abierto (se ve igual que si lo escribieras) ── */
  async function tomarVoz(d) {
    let ok = false, enCola = false;
    try {
      const caja = $("#inp");
      if (!busy && typeof send === "function" && hasAnyProvider() && !(attachments && attachments.length) && !(attFiles && attFiles.length)) {
        const borrador = caja.value;
        caja.value = d.texto;
        send();                // lee el texto y limpia la caja antes de su primer await
        caja.value = borrador;  // tu borrador vuelve a su lugar
        autoGrow();
        ok = true;
      } else if (busy && convId) {
        // 📥 el chat abierto está trabajando: si el pedido es de ese mismo trabajo, se integra a su plan sin detenerlo;
        //    si es otro tema, Noviq lo hace aparte (en su propia conversación)
        const cid = convId;
        const ru = await jpost("/api/enrutar", {text: d.texto, conversation_id: cid, modo: "auto", usar_ia: false}).catch(() => null);
        if (ru && ru.conv === cid && (ru.accion === "en_caliente" || ru.accion === "misma")) {
          const j = await jpost(`/api/conversations/${cid}/bandeja`, {text: d.texto, origen: "voz"});
          if (j && j.encolado) { (COLAS[cid] = COLAS[cid] || []).push({id: j.id, texto: d.texto}); renderCola(); ok = enCola = true; }
          else if (j && j.iniciado) { REENGANCHAR = cid; ok = true; }
        }
      }
    } catch (e) { console.warn("voz", e); }
    jpost("/api/avatar/tomado", {id: d.id, ok}).catch(() => {});
    if (ok) toast((enCola ? "📥 🎙 " : "🎙 ") + d.texto);
  }

  let es = null;
  function conectar() {
    if (es) return;
    try { es = new EventSource("/api/avatar/eventos?t=" + encodeURIComponent(TOKEN)); } catch (e) { return; }
    es.addEventListener("hola", ev => { try { pintarMic(JSON.parse(ev.data).oido); } catch (e) {} });
    es.addEventListener("oido", ev => { try { pintarMic(JSON.parse(ev.data).oido); } catch (e) {} });
    es.addEventListener("voz", ev => { try { tomarVoz(JSON.parse(ev.data)); } catch (e) {} });
    es.addEventListener("enfocar", () => { try { window.focus(); } catch (e) {} });
    es.addEventListener("ajustes_avatar", () => { try { llenar(); } catch (e) {} });
    // Noviq empezó un trabajo pedido por voz (en su propia conversación: no toca el chat que tienes abierto)
    es.addEventListener("trabajo", ev => { try { const d = JSON.parse(ev.data); toast(`🎙 Noviq empezó: ${d.texto}${d.proyecto ? " · " + d.proyecto : ""} (clic para verlo)`, () => openConv(d.conv)); } catch (e) {} });
    // «Noviq, vamos a trabajar en el proyecto X»
    es.addEventListener("proyecto", ev => { try { const d = JSON.parse(ev.data); if (busy) { toast("🗂 Proyecto activo: " + d.proyecto); return; }
      curProject = d.proyecto; loadProjects(); newChat(); toast("🗂 Trabajando en «" + d.proyecto + "»"); } catch (e) {} });
    es.onerror = () => { if (es && es.readyState === 2) { es = null; setTimeout(conectar, 5000); } };
  }
  conectar();

  // Conversación que tienes abierta (para que «Noviq, …» siga en ese mismo chat aunque la ventana esté oculta)
  let ultimaConv;
  setInterval(() => {
    const k = (convId || "") + "|" + (convProject || curProject || "");
    if (k !== ultimaConv) { ultimaConv = k; jpost("/api/avatar/contexto", {conversation_id: convId, proyecto: convProject || curProject || null}).catch(() => {}); }
  }, 2500);

  /* ═════════════ ⚙ Ajustes → 🤖 Avatar ═════════════
     El avatar es independiente: sus ajustes son SUYOS y aquí se muestra su propia página de ajustes (la misma que abre
     él desde su menú). Noviq solo decide si lo abre consigo, lo repara y le presta sus voces y su oído. */
  const ICON = v => v === true ? "✅" : v === false ? "⬜" : "⏳";
  let ULT = null;
  function pintar(r) {
    if (!r || r.instalado === undefined) return;
    ULT = r;
    const act = $("#avActivo"); if (act && document.activeElement !== act) act.checked = !!r.activo;
    const partes = [];
    if (!r.instalado) partes.push(`<span class="bad-t">✖ No encuentro la carpeta del avatar (${esc(r.carpeta)})</span>`);
    else if (!r.electron) partes.push(`<span class="bad-t">⚠ Falta su motor (Electron): pulsa «Reparar»; Noviq lo descarga y verifica solo.</span>`);
    else if (r.motor_sano === false) partes.push(`<span class="bad-t">⚠ ${esc(r.motor_problema || "su motor está dañado")}: pulsa «Reparar».</span>`);
    partes.push(r.vivo ? `<span class="ok-t">● ${esc(r.nombre || "Avatar")} abierto</span>` : `<span class="small">○ Cerrado</span>`);
    if (r.vivo) partes.push(r.conectado ? `<span class="ok-t">conectado con Noviq</span>` : `<span class="bad-t">sin conexión con Noviq</span>`);
    if (r.version_avatar) partes.push("v" + esc(r.version_avatar));
    if (r.oido && r.oido.estado) partes.push("🎙 " + esc({listo: "escuchando", oyendo: "oyendo", procesando: "entendiendo", apagado: "micrófono apagado", error: "error: " + (r.oido.error || "")}[r.oido.estado] || r.oido.estado));
    if (r.trabajos) partes.push(`vigila ${r.trabajos} trabajo(s)`);
    if (r.pregunta) partes.push(`❓ ${esc(r.pregunta)}`);
    if (r.reparando || r.reparacion) partes.push(`🛠 ${esc(r.reparacion)}`);
    if (r.error && !r.reparando) partes.push(`<span class="bad-t">${esc(r.error)}</span>`);
    $("#avEstado").innerHTML = partes.join(" · ");
    // su página de ajustes, incrustada (solo si está abierto)
    const marco = $("#avMarco"), ifr = $("#avIframe");
    if (r.vivo && r.ajustes_url) {
      marco.style.display = ""; $("#avCerrado").style.display = "none";
      if (ifr.dataset.url !== r.ajustes_url) { ifr.dataset.url = r.ajustes_url; ifr.src = r.ajustes_url; }
    } else {
      marco.style.display = "none"; $("#avCerrado").style.display = "";
      if (ifr.dataset.url) { ifr.dataset.url = ""; ifr.src = "about:blank"; }
    }
    const v = r.voz_noviq || {};
    $("#avMotores").innerHTML = (v.motores || []).map(m => `<div class="avmot"><b>${ICON(m.listo)}</b> ${esc(m.nombre)} ${m.falta ? `<span class="small muted">— ${esc(m.falta)}</span>` : ""}</div>`).join("")
      + (v.instalando ? `<div><span class="spin"></span> ${esc(v.log || "Instalando…")}</div>` : v.log ? `<div>${esc(v.log)}</div>` : "");
    if (r.reparando || v.instalando) { clearTimeout(pintar.t); pintar.t = setTimeout(llenar, 2000); }
  }
  async function llenar() { try { pintar(await jget("/api/avatar")); } catch (e) {} }
  async function accion(body, msg) {
    if (msg) $("#avOut").textContent = msg;
    const r = await jpost("/api/avatar", body).catch(e => ({error: String(e)}));
    $("#avOut").textContent = r.error && r.ok === false ? "✖ " + r.error : "";
    pintar(r);
    setTimeout(llenar, 2500);
    return r;
  }
  $("#avActivo").onchange = e => accion({config: {activo: e.target.checked}});
  $("#av-abrir").onclick = () => accion({abrir: true}, "Abriendo el avatar… (la primera vez puede descargar su motor, ~160 MB)");
  $("#av-cerrar").onclick = () => accion({cerrar: true});
  $("#av-probar").onclick = () => accion({probar: true});
  $("#av-hablar").onclick = () => accion({escuchar: true}, "🎙 Habla ahora…");
  $("#av-ventana").onclick = () => accion({ventana_ajustes: true});
  $("#av-reparar").onclick = () => accion({reparar: true, motor: !!(ULT && ULT.motor_sano === false)}, "🛠 Revisando y reparando el avatar…");
  $("#av-inst-nvidia").onclick = () => accion({instalar_voz: "nvidia"}, "⬇ Instalando el cliente de NVIDIA…");
  $("#av-inst-local").onclick = () => { if (confirm("Instalar faster-whisper (≈ 200 MB) y, la primera vez que hables, su modelo (≈ 150–500 MB). ¿Seguir?")) accion({instalar_voz: "local"}, "⬇ Instalando faster-whisper…"); };
  $("#av-inst-piper").onclick = () => accion({instalar_tts: "piper"}, "⬇ Instalando las voces Piper (sin internet)…");

  const tab = document.querySelector('[data-tab="t-avatar"]');
  if (tab) tab.addEventListener("click", () => llenar());
  setInterval(() => { const p = $("#t-avatar"); if (p && p.classList.contains("on") && !document.hidden) llenar(); }, 8000);
})();
