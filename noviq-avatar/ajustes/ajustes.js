/* ==========================================================================
   Noviq Avatar — Página de ajustes (la sirve el propio avatar en /ajustes;
   Noviq la muestra en su pestaña «Avatar»). Todo se guarda al instante.
   ========================================================================== */
(function () {
  'use strict';
  const $ = (s, r) => (r || document).querySelector(s);
  const $$ = (s, r) => Array.from((r || document).querySelectorAll(s));
  const esc = (t) => String(t == null ? '' : t).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const TOKEN = '__TOKEN__';
  let A = null;                 // ajustes actuales
  let catalogo = null, memoria = null;
  const filtro = { genero: '', origen: 'latina', motor: '', texto: '' };

  async function api(metodo, ruta, cuerpo) {
    const h = { 'Content-Type': 'application/json', 'X-Avatar-Pagina': '1' };
    if (TOKEN && TOKEN !== '__TOKEN__') h['X-Noviq-Token'] = TOKEN;
    const r = await fetch(ruta, { method: metodo, headers: h, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
    const j = await r.json().catch(() => ({ ok: false, error: 'respuesta inválida' }));
    if (!r.ok && j.ok !== false) j.ok = false;
    return j;
  }
  let tToast = null;
  function toast(t, error) {
    const el = $('#toast');
    el.textContent = t; el.className = 'ver' + (error ? ' error' : '');
    clearTimeout(tToast); tToast = setTimeout(() => { el.className = ''; }, error ? 4200 : 1600);
  }
  const obtener = (o, k) => k.split('.').reduce((a, p) => (a == null ? a : a[p]), o);
  const parcial = (k, v) => k.split('.').reverse().reduce((acc, p) => ({ [p]: acc }), v);

  /* --------------------------------------------------------- Guardado */
  const cola = {}; let tGuardar = null;
  function guardar(k, v) {
    Object.assign(cola, { [k]: v });
    clearTimeout(tGuardar);
    tGuardar = setTimeout(async () => {
      const lote = Object.assign({}, cola);
      for (const x of Object.keys(cola)) delete cola[x];
      let cuerpo = {};
      for (const [kk, vv] of Object.entries(lote)) cuerpo = mezclar(cuerpo, parcial(kk, vv));
      const r = await api('POST', '/api/ajustes', cuerpo);
      if (r.ok) { A = r.ajustes; pintarTodo(false); toast(r.cambios && r.cambios.length ? '✔ Guardado' : 'Sin cambios'); }
      else toast('No se guardó: ' + (r.error || 'error'), true);
    }, 280);
  }
  function mezclar(a, b) {
    for (const [k, v] of Object.entries(b)) a[k] = v && typeof v === 'object' && !Array.isArray(v) ? mezclar(a[k] || {}, v) : v;
    return a;
  }

  /* ------------------------------------------------- Controles genéricos */
  function enlazar() {
    for (const el of $$('[data-k]')) {
      const k = el.dataset.k;
      if (el.classList.contains('opciones')) {
        el.addEventListener('click', (e) => { const b = e.target.closest('button[data-v]'); if (b) { marcarOpcion(el, b.dataset.v); guardar(k, b.dataset.v); } });
        continue;
      }
      const ev = el.type === 'checkbox' || el.tagName === 'SELECT' ? 'change' : el.type === 'range' ? 'input' : 'change';
      el.addEventListener(ev, () => {
        const v = el.type === 'checkbox' ? el.checked : el.dataset.num != null ? Number(el.value) : el.value;
        if (el.type === 'range') pintarSalidas();
        guardar(k, v);
      });
    }
  }
  function marcarOpcion(el, v) { for (const b of $$('button', el)) b.classList.toggle('on', b.dataset.v === v); }
  function pintarControles() {
    for (const el of $$('[data-k]')) {
      const v = obtener(A, el.dataset.k);
      if (el.classList.contains('opciones')) { marcarOpcion(el, v); continue; }
      if (document.activeElement === el && el.type !== 'checkbox' && el.type !== 'range') continue;
      if (el.type === 'checkbox') el.checked = !!v; else if (v != null) el.value = v;
    }
    pintarSalidas();
  }
  function pintarSalidas() {
    const val = (id) => $('#' + id).value;
    const AUT = ['callado', 'poca', 'normal', 'mucha'];
    const set = (o, t) => { const e = $('#' + o); if (e) e.textContent = t; };
    set('o-autonomia', AUT[Number(val('i-autonomia'))] || '');
    set('o-dormir', Number(val('i-dormir')) ? val('i-dormir') + ' min' : 'nunca');
    set('o-vel', Number(val('v-vel')).toFixed(2) + '×'); set('o-tono', Number(val('v-tono')).toFixed(2)); set('o-volumen', Math.round(val('v-volumen') * 100) + '%');
    set('o-svol', Math.round(val('s-vol') * 100) + '%'); set('o-osens', Number(val('o-sens')).toFixed(1) + '×'); set('o-omax', val('o-max') + ' s');
    set('o-ctemp', Number(val('c-temp')).toFixed(2)); set('o-cmax', val('c-max'));
    if ($('#r-apagado')) { const sg = Number(val('r-apagado')); set('o-apagado', sg >= 60 ? (sg / 60).toFixed(sg % 60 ? 1 : 0) + ' min' : sg + ' s'); }
  }

  /* ------------------------------------------------------------ Cabecera */
  function pintarCabecera() {
    const i = A._info || {};
    $('#tNombre').textContent = A.identidad.nombre;
    document.title = 'Ajustes de ' + A.identidad.nombre;
    $('#tSub').textContent = `Versión ${i.version || ''} · sus ajustes, memoria, voz e IA son propios`;
    const nv = i.noviq || {};
    const pN = $('#pNoviq');
    pN.className = 'pill ' + (nv.conectado ? 'ok' : A.noviq.usar ? 'medio' : '');
    pN.querySelector('b').textContent = nv.conectado ? 'Noviq conectado' : A.noviq.usar ? 'Noviq cerrado' : 'Sin Noviq';
    const cb = i.cerebro || {}, orden = cb.orden || [];
    const pI = $('#pIA');
    pI.className = 'pill ' + (orden.length ? 'ok' : '');
    const u = cb.ultimo || {};
    pI.querySelector('b').textContent = A.cerebro.proveedor === 'ninguno' ? 'Sin IA (saberes)' : orden.length ? `IA: ${(cb.proveedores[orden[0]] || {}).nombre || orden[0]}${u.ms && u.proveedor === orden[0] ? ' · ' + u.ms + ' ms' : ''}` : 'IA sin configurar';
    const oi = i.oido || {}, dispo = (oi.motores || []).filter((m) => m.disponible).map((m) => m.id);
    const pO = $('#pOido');
    pO.className = 'pill ' + (dispo.length ? 'ok' : '');
    pO.querySelector('b').textContent = dispo.length ? 'Oído: ' + dispo[0] : 'Oído sin motor';
  }

  /* ---------------------------------------------------------- Identidad */
  function pintarRasgos() {
    const cont = $('#rasgos');
    const todos = (A._info && A._info.rasgos) || {};
    cont.innerHTML = Object.entries(todos).map(([k, n]) => `<button class="chip ${A.identidad.personalidad.includes(k) ? 'on' : ''}" data-r="${k}">${esc(n)}</button>`).join('');
  }
  $('#rasgos').addEventListener('click', (e) => {
    const b = e.target.closest('[data-r]'); if (!b) return;
    let l = A.identidad.personalidad.slice();
    if (l.includes(b.dataset.r)) l = l.filter((x) => x !== b.dataset.r); else { l.push(b.dataset.r); if (l.length > 4) l.shift(); }
    if (!l.length) return toast('Deja al menos un rasgo', true);
    A.identidad.personalidad = l; pintarRasgos(); guardar('identidad.personalidad', l);
  });

  /* ---------------------------------------------------------------- Voz */
  async function cargarVoces() {
    const r = await api('GET', '/api/voces');
    if (!r.ok) return;
    catalogo = r;
    const sel = $('#fMotor');
    const actual = sel.value;
    sel.innerHTML = '<option value="">Todos los motores</option>' + r.motores.map((m) => `<option value="${m.id}">${esc(m.nombre)}${m.listo ? '' : ' (no listo)'}</option>`).join('');
    sel.value = actual;
    pintarVoces();
  }
  function nombreVoz() {
    const v = A.voz;
    if (v.motor === 'windows') return (v.nombreWindows || 'la voz de Windows por defecto') + ' · Windows';
    if (!catalogo) return v.id;
    for (const m of catalogo.motores) { const x = m.voces.find((y) => y.id === v.id); if (x) return `${x.bandera || ''} ${x.nombre} · ${x.paisNombre || x.pais || ''} · ${m.id}`; }
    return v.id;
  }
  function pintarVoces() {
    if (!catalogo) return;
    $('#vozElegida').textContent = nombreVoz();
    const u = A._info && A._info.voz;
    $('#vozEstado').textContent = u && u.motor ? `(última: ${u.motor}${u.ms ? ', ' + u.ms + ' ms' : ''}${u.error ? ' · ' + u.error.slice(0, 80) : ''})` : '';
    const q = filtro.texto.toLowerCase();
    const items = [];
    for (const m of catalogo.motores) {
      if (filtro.motor && m.id !== filtro.motor) continue;
      for (const v of m.voces) {
        if (filtro.genero && v.genero && v.genero !== filtro.genero) continue;
        if (filtro.origen === 'latina' && m.id !== 'windows' && !v.latina) continue;
        if (filtro.origen === 'es' && (v.idioma || 'es') !== 'es') continue;
        if (q && !(`${v.nombre} ${v.paisNombre || ''} ${v.pais || ''} ${v.id}`).toLowerCase().includes(q)) continue;
        const elegida = (A.voz.motor === 'windows' ? m.id === 'windows' && A.voz.nombreWindows === v.id : v.id === A.voz.id && (A.voz.motor === m.id || A.voz.motor === 'auto'));
        items.push(`<div class="voz ${elegida ? 'on' : ''} ${m.listo ? '' : 'no'}"><span class="band">${v.bandera || '🌎'}</span>
          <span class="nom">${esc(v.nombre)} ${v.genero === 'F' ? '👩' : v.genero === 'M' ? '👨' : ''}</span>
          <span class="bts"><button class="btn" data-probar="${esc(v.id)}" data-m="${m.id}" title="Escuchar">▶</button><button class="btn ${elegida ? 'prim' : ''}" data-usar="${esc(v.id)}" data-m="${m.id}">${elegida ? '✔' : 'Usar'}</button></span>
          <span class="det">${esc(v.paisNombre || v.pais || '')} · ${m.id}${m.listo ? '' : ' · ' + esc(m.falta || 'no listo')}</span></div>`);
      }
    }
    $('#voces').innerHTML = items.join('') || '<div class="vacio">No hay voces con esos filtros.</div>';
  }
  $('#voces').addEventListener('click', async (e) => {
    const p = e.target.closest('[data-probar]'), u = e.target.closest('[data-usar]');
    if (p) {
      if (p.dataset.m === 'windows') { const s = new SpeechSynthesisUtterance(frasePrueba()); const vv = speechSynthesis.getVoices().find((x) => x.name === p.dataset.probar); if (vv) s.voice = vv; speechSynthesis.speak(s); return; }
      p.disabled = true; p.textContent = '…';
      const r = await api('POST', '/api/voz/hablar', { texto: frasePrueba(), motor: p.dataset.m, voz: p.dataset.probar });
      p.disabled = false; p.textContent = '▶';
      if (r.ok && r.audio) { const a = $('#audio'); a.src = `data:audio/${r.formato === 'wav' ? 'wav' : 'mpeg'};base64,${r.audio}`; a.play(); }
      else toast('No pude con esa voz: ' + (r.error || ''), true);
    }
    if (u) {
      const motor = u.dataset.m;
      if (motor === 'windows') guardar('voz.motor', 'windows'), guardar('voz.nombreWindows', u.dataset.usar);
      else { guardar('voz.motor', motor); guardar('voz.id', u.dataset.usar); }
      A.voz.motor = motor; if (motor === 'windows') A.voz.nombreWindows = u.dataset.usar; else A.voz.id = u.dataset.usar;
      pintarVoces();
    }
  });
  const frasePrueba = () => `¡Hola${memoria && memoria.usuario && memoria.usuario.nombre ? ', ' + memoria.usuario.nombre : ''}! Soy ${A.identidad.nombre}. Así sueno con esta voz.`;
  $('#probarAvatar').addEventListener('click', () => api('POST', '/api/voz/hablar', { texto: frasePrueba(), enAvatar: true }));
  for (const [id, k] of [['#fGenero', 'genero'], ['#fOrigen', 'origen']]) {
    $(id).addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; filtro[k] = b.dataset.v; marcarOpcion($(id), b.dataset.v); pintarVoces(); });
  }
  $('#fMotor').addEventListener('change', (e) => { filtro.motor = e.target.value; pintarVoces(); });
  $('#fTexto').addEventListener('input', (e) => { filtro.texto = e.target.value; pintarVoces(); });

  /* ---------------------------------------------------------------- Oído */
  function pintarOido() {
    const oi = (A._info && A._info.oido) || {};
    const NOM = { groq: 'Groq', nvidia: 'NVIDIA', openai: 'OpenAI', noviq: 'Noviq', gratis: 'LLM7', windows: 'Windows (sin internet)' };
    $('#motoresOido').innerHTML = (oi.motores || []).map((m) => `<span><i class="punto ${m.disponible ? 'si' : ''}"></i>${NOM[m.id] || m.id}${m.disponible ? '' : m.id === 'noviq' ? ' (cerrado)' : m.id === 'windows' ? ' (solo Windows)' : ' (sin clave)'}</span>`).join('') +
      (oi.ultimo && oi.ultimo.motor ? `<span>último: ${oi.ultimo.motor} · ${oi.ultimo.ms} ms</span>` : '') + (oi.ultimo && oi.ultimo.error ? `<span title="${esc(oi.ultimo.error)}">⚠ ${esc(oi.ultimo.error.slice(0, 60))}</span>` : '');
    const es = (A._info && A._info.escucha) || {};
    const pf = es.perfil || {}, am = es.ambiente || {};
    if ($('#perfilVoz')) $('#perfilVoz').innerHTML = `<span><i class="punto ${pf.listo ? 'si' : ''}"></i>${pf.listo ? 'Conoce tu voz' : 'Aún no conoce tu voz'} (${pf.usuario || 0} muestras)</span>` +
      `<span>Fondo aprendido: ${pf.fondo || 0} muestras</span>` + (am.tv ? '<span>📺 Ahora hay voces de fondo</span>' : '');
  }
  if ($('#olvidarVoz')) $('#olvidarVoz').addEventListener('click', async () => {
    const r = await api('POST', '/api/oido/perfil', { accion: 'olvidar' });
    if (r && r.ok) { A._info = A._info || {}; A._info.escucha = Object.assign({}, A._info.escucha, { perfil: r.perfil }); pintarOido(); }
  });

  /* ------------------------------------------------------------- Cerebro */
  const PISTA_CLAVE = { groq: 'gsk_…', cerebras: 'csk-…', gemini: 'AIza…', nvidia: 'nvapi-…', mistral: 'tu clave de Mistral', openrouter: 'sk-or-…', deepseek: 'sk-…', openai: 'sk-…', propia: 'clave (si tu servidor la pide)', gratis: 'clave de LLM7, opcional: más límite y oído' };
  const URL_DE = { ollama: 'cerebro.urlOllama', lmstudio: 'cerebro.urlLmstudio', propia: 'cerebro.urlPropia' };
  const listas = {};          // proveedor → {modelos, recomendado, elegido, error}
  let tarjetasHechas = false;
  const info = () => (A._info && A._info.cerebro) || { proveedores: {}, orden: [] };
  const nombreP = (p) => ((info().proveedores[p] || {}).nombre || p);

  function construirTarjetas() {
    const cb = info();
    const ps = Object.keys(cb.proveedores);
    if (!ps.length) return;
    $('#provs').innerHTML = ps.map((p) => {
      const d = cb.proveedores[p];
      const url = URL_DE[p] ? `<div class="pv-fila"><input data-url="${p}" placeholder="${p === 'propia' ? 'https://tu-servidor/v1' : p === 'ollama' ? 'http://127.0.0.1:11434' : 'http://127.0.0.1:1234'}" title="Dirección de ${esc(d.nombre)}"></div>` : '';
      const clave = d.clave ? `<div class="pv-fila"><input type="password" data-clave="${p}" autocomplete="off" placeholder="pega aquí tu clave (${esc(PISTA_CLAVE[p] || 'clave')})"><button class="btn" data-guardar="${p}">Guardar</button><button class="btn rojo" data-quitar="${p}" hidden>Quitar</button></div>` : '';
      const web = d.web && !d.noviq ? `<a class="pv-web" href="${d.web}" target="_blank" rel="noopener">${d.local ? 'Descargar →' : d.gratis ? 'Más info →' : 'Conseguir clave →'}</a>` : '';
      return `<div class="pv" data-p="${p}">
        <div class="pv-cab"><i class="punto"></i><b>${esc(d.nombre)}</b><span class="pv-desc">${esc(d.desc || '')}</span><span class="pv-pos" hidden></span>${web}</div>
        ${url}${clave}<div class="pv-aviso" hidden></div>
        <div class="pv-fila"><select data-modelo="${p}" title="Modelo"><option value="">Automático</option></select><button class="btn" data-recargar="${p}" title="Volver a leer su lista de modelos">↻</button><button class="btn" data-probar="${p}">Probar</button></div>
        <input type="search" class="pv-filtro" data-filtro="${p}" hidden>
        <div class="pv-res" data-res="${p}"></div></div>`;
    }).join('');
    tarjetasHechas = true;
    for (const p of ps) cargarModelos(p);
  }

  function etiqueta(m) {
    const t = [];
    if (m.cargado) t.push('● cargado');
    if (m.gratis) t.push('gratis');
    if (m.piensa) t.push('🧠 piensa');
    if (m.vision) t.push('👁');
    if (m.params) t.push(m.params + 'B');
    if (m.tam) t.push(m.tam + ' GB');
    if (m.malo) t.push('⚠ falló');
    return m.id + (t.length ? '  ·  ' + t.join(' · ') : '');
  }
  function pintarModelos(p) {
    const sel = $(`[data-modelo="${p}"]`); if (!sel) return;
    const L = listas[p] || {};
    const d = info().proveedores[p] || {};
    const filtro = (($(`[data-filtro="${p}"]`) || {}).value || '').toLowerCase();
    const elegido = (A.cerebro.modelos || {})[p] || '';
    const auto = L.recomendado || d.auto || d.modelo || '';
    let html = `<option value="">Automático${auto ? ' — ' + esc(auto) : ''}</option>`;
    const ms = (L.modelos || []).filter((m) => !filtro || m.id.toLowerCase().includes(filtro) || m.id === elegido);
    html += ms.map((m) => `<option value="${esc(m.id)}" title="${esc(m.nombre || m.id)}">${esc(etiqueta(m))}</option>`).join('');
    if (elegido && !ms.some((m) => m.id === elegido)) html += `<option value="${esc(elegido)}">${esc(elegido)} (elegido)</option>`;
    if (document.activeElement !== sel) { sel.innerHTML = html; sel.value = elegido; }
    sel.disabled = !!(d.noviq || (!L.ok && !(L.modelos || []).length && !elegido));
    const f = $(`[data-filtro="${p}"]`);
    if (f) { f.hidden = (L.modelos || []).length <= 25; f.placeholder = `Filtrar ${(L.modelos || []).length} modelos…`; }
  }
  async function cargarModelos(p, refrescar, silencioso) {
    const d = info().proveedores[p] || {};
    if (d.noviq) { listas[p] = { ok: true, modelos: [] }; pintarModelos(p); return; }
    if (d.clave && !d.gratis && !(A.claves[d.clave] || {}).puesta && p !== 'propia') { listas[p] = { ok: false, modelos: [], error: 'Pon la clave para ver sus modelos.' }; pintarModelos(p); actualizarTarjeta(p); return; }
    if (refrescar && !silencioso) resultado(p, 'Leyendo su lista de modelos…');
    const r = await api('GET', `/api/cerebro/modelos?proveedor=${p}${refrescar ? '&refrescar=1' : ''}`);
    listas[p] = r;
    pintarModelos(p);
    actualizarTarjeta(p);
    if (refrescar && !silencioso) resultado(p, r.ok ? `${(r.modelos || []).length} modelos${r.recomendado ? ' · recomendado: ' + r.recomendado : ''}` : r.error, r.ok ? '' : 'mal');
  }
  function resultado(p, texto, clase) { const el = $(`[data-res="${p}"]`); if (el) { el.textContent = texto || ''; el.className = 'pv-res' + (clase ? ' ' + clase : ''); } }

  function actualizarTarjeta(p) {
    const cb = info(), d = cb.proveedores[p]; if (!d) return;
    const el = $(`.pv[data-p="${p}"]`); if (!el) return;
    const L = listas[p] || {};
    const pos = cb.orden.indexOf(p);
    el.classList.toggle('si', !!d.disponible);
    el.classList.toggle('primero', pos === 0);
    const punto = $('.punto', el);
    const kk = d.clave ? (A.claves || {})[d.clave] || {} : {};
    punto.className = 'punto ' + (d.disponible && !d.error && !(d.stats && d.stats.ultimoError && !d.stats.ok) ? 'si' : d.disponible ? 'medio' : (L.error && (d.local || kk.puesta)) ? 'mal' : '');
    const pp = $('.pv-pos', el); pp.hidden = pos < 0; pp.textContent = pos >= 0 ? '#' + (pos + 1) : '';
    const ci = $(`[data-clave="${p}"]`);
    if (ci) {
      const k = kk;
      ci.placeholder = k.puesta ? `puesta (…${k.fin}) — pega otra para cambiarla` : `pega aquí tu clave (${PISTA_CLAVE[p] || 'clave'})`;
      $(`[data-quitar="${p}"]`).hidden = !k.puesta;
    }
    const ui = $(`[data-url="${p}"]`);
    if (ui && document.activeElement !== ui) ui.value = obtener(A, URL_DE[p]) || '';
    const av = $('.pv-aviso', el);
    const k = kk;
    const aviso = k.aviso || (L.error && (d.local || k.puesta || (p === 'propia' && obtener(A, 'cerebro.urlPropia'))) ? L.error : '');
    av.hidden = !aviso; av.textContent = aviso ? '⚠ ' + aviso : '';
    const res = $(`[data-res="${p}"]`);
    if (res && !res.textContent) {
      const s = d.stats;
      res.textContent = d.noviq ? (d.disponible ? 'Noviq abierto: usa su IA más rápida.' : 'Se usa cuando Noviq está abierto.')
        : s && s.ok ? `${s.ms} ms de media · ${s.ok} respuestas${s.fallos ? ' · ' + s.fallos + ' fallos' : ''}` : d.local && !d.vivo ? 'Cerrado o sin modelos.' : '';
    }
  }

  function pintarCerebro() {
    const cb = info();
    const sel = $('#c-prov');
    if (document.activeElement !== sel) {
      sel.innerHTML = '<option value="auto">Automático: la más rápida que responda</option>' +
        Object.entries(cb.proveedores).map(([k, p]) => `<option value="${k}">${esc(p.nombre)}${p.disponible ? '' : ' (no disponible ahora)'}</option>`).join('') + '<option value="ninguno">Ninguna IA (solo sus saberes y respuestas rápidas)</option>';
      sel.value = A.cerebro.proveedor;
    }
    const u = cb.ultimo || {}, primero = cb.orden[0];
    $('#cEstado').innerHTML = A.cerebro.proveedor === 'ninguno' ? 'Sin IA: responde con sus saberes (clima, Wikipedia, cálculos…).'
      : primero ? `<b>${esc(nombreP(primero))}</b> · ${esc((cb.proveedores[primero] || {}).modelo || 'automático')}${u.ms && u.proveedor === primero ? ` · ${u.ms} ms` : ''}${u.error ? `<span class="err">Último error: ${esc(u.error.slice(0, 220))}</span>` : ''}`
        : 'Ninguna disponible: pon una clave o abre Ollama / LM Studio.';
    const cl = A.claves || {};
    $('#cifradas').textContent = cl.cifradas ? '· claves cifradas con tu cuenta de Windows' : '· (sin cifrado disponible en este sistema)';
    if (!tarjetasHechas) construirTarjetas();
    for (const p of Object.keys(cb.proveedores)) actualizarTarjeta(p);
  }

  $('#provs').addEventListener('change', (e) => {
    const s2 = e.target.closest('[data-modelo]');
    if (s2) {
      const p = s2.dataset.modelo;
      A.cerebro.modelos = Object.assign({}, A.cerebro.modelos, { [p]: s2.value });
      guardar('cerebro.modelos.' + p, s2.value);
      resultado(p, s2.value ? `Elegido: ${s2.value}${(info().proveedores[p] || {}).local ? ' · lo cargo en la memoria…' : ''}` : 'Automático: usa el recomendado.');
      return;
    }
    const u = e.target.closest('[data-url]');
    if (u) { guardar(URL_DE[u.dataset.url], u.value.trim()); setTimeout(() => cargarModelos(u.dataset.url, true), 900); }
  });
  $('#provs').addEventListener('input', (e) => { const f = e.target.closest('[data-filtro]'); if (f) pintarModelos(f.dataset.filtro); });
  $('#provs').addEventListener('keydown', (e) => { const c = e.target.closest('[data-clave]'); if (c && e.key === 'Enter') $(`[data-guardar="${c.dataset.clave}"]`).click(); });
  $('#provs').addEventListener('click', async (e) => {
    const b = e.target.closest('button'); if (!b) return;
    if (b.dataset.guardar || b.dataset.quitar) {
      const p = b.dataset.guardar || b.dataset.quitar;
      const valor = b.dataset.guardar ? $(`[data-clave="${p}"]`).value.trim() : '';
      if (b.dataset.guardar && !valor) return toast('Pega primero la clave', true);
      b.disabled = true; const txt = b.textContent; b.textContent = b.dataset.guardar ? 'Probando…' : '…';
      const r = await api('POST', '/api/claves', { nombre: p, valor });
      b.disabled = false; b.textContent = txt;
      if (!r.ok) { resultado(p, '✖ ' + r.error, 'mal'); toast('No guardé la clave', true); return; }
      $(`[data-clave="${p}"]`).value = '';
      const destino = r.destino || p;
      if (r.quitada) resultado(p, 'Clave quitada.');
      else {
        const msg = (r.movida ? `✔ ${r.aviso} ` : '✔ Guardada') + (r.prueba && r.prueba.ok ? ' y probada' + (r.prueba.modelos ? ` (${r.prueba.modelos} modelos)` : '') : r.prueba && r.prueba.error ? ` (no pude probarla: ${r.prueba.error})` : '');
        resultado(destino, msg, 'ok'); if (destino !== p) resultado(p, msg, 'ok');
        toast('✔ Clave guardada');
      }
      await recargar();
      cargarModelos(destino, true, true);
      return;
    }
    if (b.dataset.recargar) { cargarModelos(b.dataset.recargar, true); return; }
    if (b.dataset.probar) {
      const p = b.dataset.probar;
      const modelo = ($(`[data-modelo="${p}"]`) || {}).value || '';
      const d = info().proveedores[p] || {};
      b.disabled = true; b.textContent = '…';
      resultado(p, d.local ? 'Probando… (si el modelo no estaba cargado puede tardar hasta un par de minutos)' : 'Probando…');
      const r = await api('POST', '/api/cerebro/probar', { proveedor: p, modelo });
      b.disabled = false; b.textContent = 'Probar';
      resultado(p, r.ok ? `✔ ${r.ms} ms · ${r.modelo}${r.frio ? ' (lo cargó en la memoria)' : ''} · «${r.texto}»` : '✖ ' + r.error, r.ok ? 'ok' : 'mal');
      await recargar();
      cargarModelos(p, d.local, true);
    }
  });
  $('#traerClaves').addEventListener('click', async () => {
    const b = $('#traerClaves'); b.disabled = true;
    $('#traerInfo').textContent = (A._info && A._info.noviq && A._info.noviq.conectado) ? 'Pidiéndoselas a Noviq y probándolas…' : 'Noviq está cerrado: lo abro y le pido las claves (puede tardar un poco)…';
    const r = await api('POST', '/api/claves/importar-noviq');
    b.disabled = false;
    if (!r.ok) { $('#traerInfo').textContent = '✖ ' + r.error; return; }
    const det = Object.entries(r.detalle || {}).map(([p, t]) => `${nombreP(p)}: ${t}`).join(' · ');
    $('#traerInfo').textContent = (r.traidas.length ? '✔ Traje: ' + r.traidas.map(nombreP).join(', ') : 'No traje ninguna nueva') + (det ? ' — ' + det : '');
    await recargar();
    for (const p of r.traidas) { resultado(p, '✔ Clave traída de Noviq y probada', 'ok'); cargarModelos(p, true, true); }
  });

  /* ---------------------------------------------------------- Herramientas */
  async function pintarHerramientas() {
    const r = await api('GET', '/api/herramientas');
    if (!r.ok) return;
    $('#listaHerr').innerHTML = r.propias.map((h) => `<div class="herr"><b>${esc(h.nombre)}</b>${esc(h.desc)}</div>`).join('') +
      (r.noviq || []).map((h) => `<div class="herr nv"><b>${esc(h.nombre)}</b>${esc(h.desc)}</div>`).join('');
  }


  /* ------------------------------------------------------- Bots y MCP */
  const PERM = { solo_peligro: 'peligroso', pregunta_cambios: 'cambios', pregunta_todo: 'todo' };
  function estadoMcp(s) { return ({ conectado: '● conectado', apagado: '○ apagado', error: '⚠ error', sin_iniciar: '… sin iniciar' })[s.estado] || s.estado; }
  async function pintarBots() {
    const [b, m, l] = await Promise.all([api('GET', '/api/agentes'), api('GET', '/api/mcp/servidores'), api('GET', '/api/acciones')]);
    if (b.ok) {
      $('#aBots').innerHTML = (b.bots || []).map((x) => `<div class="item"><b>${esc(x.nombre || x.id)}</b> <small>(${esc(x.id)})</small><br><span class="tenue">${esc(x.desc || '')}</span></div>`).join('') || '<div class="vacio">Sin bots (están apagados).</div>';
      $('#aPend').innerHTML = (b.pendientes || []).map((p) => `<div class="item"><b>${esc(p.quien || '')}</b>: ${esc(p.que || '')} <small class="tenue">${esc(p.riesgo || '')} · ${esc(p.detalle || '')}</small>
        <button class="btn" data-ap="${esc(p.id)}" data-si="1">Permitir</button><button class="btn rojo" data-ap="${esc(p.id)}" data-si="0">Rechazar</button></div>`).join('') || '<div class="vacio">Nada por aprobar.</div>';
    }
    if (m.ok) {
      $('#mcpLista').innerHTML = m.servidores.map((s) => `<div class="item"><b>${esc(s.nombre || s.id)}</b> <small>${esc(s.id)} · ${esc(s.tipo)}</small> <span class="tenue">${estadoMcp(s)}${s.herramientas != null ? ' · ' + s.herramientas + ' herramientas' : ''}</span>
        ${s.error ? `<div class="tenue">${esc(s.error)}</div>` : ''}
        ${s.interno ? '' : `<button class="btn" data-mact="${esc(s.id)}" data-v="${s.activo ? 0 : 1}">${s.activo ? 'Apagar' : 'Encender'}</button><button class="btn rojo" data-mdel="${esc(s.id)}">Quitar</button>`}</div>`).join('');
      const tengo = new Set(m.servidores.map((s) => s.id));
      $('#mcpPresets').innerHTML = (m.presets || []).filter((p) => !tengo.has(p.id)).map((p) => `<button class="chip" data-preset="${esc(p.id)}" title="${esc(p.desc)}">＋ ${esc(p.nombre)}</button>`).join('') || '<span class="tenue">Ya tienes todos.</span>';
      pintarBots.presets = m.presets;
    }
    if (l.ok) $('#aLog').innerHTML = (l.acciones || []).map((a) => `<div class="item tenue">${esc(a.quien || '')} · ${esc(a.que || '')} · ${a.permitido === false ? 'rechazado' : 'ok'} · ${esc(a.detalle || '')}</div>`).join('') || '<div class="vacio">Sin acciones todavía.</div>';
  }
  document.addEventListener('click', async (e) => {
    const t = e.target.closest('[data-ap],[data-mact],[data-mdel],[data-preset]'); if (!t) return;
    let r;
    if (t.dataset.ap) r = await api('POST', '/api/aprobaciones/resolver', { id: t.dataset.ap, si: t.dataset.si === '1' });
    else if (t.dataset.mact) r = await api('POST', '/api/mcp/servidores/activar', { id: t.dataset.mact, activo: t.dataset.v === '1' });
    else if (t.dataset.mdel) { if (!confirm('¿Quitar este servidor MCP?')) return; r = await api('POST', '/api/mcp/servidores/quitar', { id: t.dataset.mdel }); }
    else { const p = (pintarBots.presets || []).find((x) => x.id === t.dataset.preset); if (!p) return; r = await api('POST', '/api/mcp/servidores', { servidor: { id: p.id, nombre: p.nombre, tipo: p.tipo, comando: p.comando, args: p.args, bot: p.bot, activo: true } }); }
    toast(r.ok ? '✔ Hecho' : (r.error || 'Error'), !r.ok); pintarBots();
  });
  function defMcp() {
    const tipo = $('#mcp-tipo').value, d = { id: $('#mcp-id').value.trim(), tipo, bot: $('#mcp-bot').value.trim(), activo: true };
    if (tipo === 'http') { d.url = $('#mcp-url').value.trim(); if ($('#mcp-tok').value) d.token = $('#mcp-tok').value; }
    else { const partes = ($('#mcp-cmd').value.match(/"[^"]*"|\S+/g) || []).map((x) => x.replace(/^"|"$/g, '')); d.comando = partes[0] || ''; d.args = partes.slice(1); }
    return d;
  }
  $('#mcp-tipo').addEventListener('change', () => { const h = $('#mcp-tipo').value === 'http'; $('#mcp-f-cmd').hidden = h; $('#mcp-f-url').hidden = !h; $('#mcp-f-tok').hidden = !h; });
  $('#mcpProbar').addEventListener('click', async () => {
    $('#mcpInfo').textContent = 'Probando…'; const r = await api('POST', '/api/mcp/probar', { servidor: defMcp() });
    $('#mcpInfo').textContent = r.ok ? `✔ Conecta (${r.herramientas != null ? (Array.isArray(r.herramientas) ? r.herramientas.length : r.herramientas) : '?'} herramientas)` : '✖ ' + (r.error || 'no conecta');
  });
  $('#mcpAgregar').addEventListener('click', async () => {
    const r = await api('POST', '/api/mcp/servidores', { servidor: defMcp() });
    if (r.ok) { toast('✔ Añadido'); $('#mcp-id').value = ''; $('#mcp-cmd').value = ''; $('#mcp-url').value = ''; $('#mcp-tok').value = ''; $('#mcp-bot').value = ''; } else toast(r.error || 'Error', true);
    pintarBots();
  });

  /* --------------------------------------------------------- Vía rápida */
  const QUE = { abrir: 'Abrir', ejecutar: 'Ejecutar', cerrar: 'Cerrar', energia: 'Energía', volumen: 'Volumen', ventanas: 'Ventanas', captura: 'Captura de pantalla',
    buscar_archivo: 'Buscar archivo', elegir: 'Elegir de la lista', delegar: 'Bot delegado', noviq: 'Noviq (programar)' };
  async function probarRapido() {
    const t = $('#r-probar').value.trim(); if (!t) return;
    const r = await api('POST', '/api/rapido/entender', { texto: t });
    const o = r.ok ? r.orden : null;
    let txt = !o ? 'No es una orden del PC: lo conversa la IA (o, si hay que hacer algo, ella elige el bot).'
      : `${QUE[o.tipo] || o.tipo}${o.accion ? ' → ' + o.accion : ''}${o.bot ? ' → bot «' + o.bot + '»' : ''}${o.objetivo ? ' → «' + o.objetivo + '»' : ''}${o.valor != null ? ' ' + o.valor + ' %' : ''}`;
    if (o && (o.tipo === 'abrir' || o.tipo === 'ejecutar')) {
      const b = await api('POST', '/api/rapido/buscar', { texto: o.objetivo });
      if (b.ok) txt += '\n' + (b.mejor ? `Abriría: ${b.mejor.nombre} (${b.mejor.tipo}, ${Math.round(b.mejor.puntaje * 100)} %)\n${b.mejor.ruta || ''}` : 'Con ese nombre no encuentro nada en el escritorio, el menú Inicio ni tus proyectos (probaría con tus carpetas y luego con el bot de PC).') +
        (b.candidatos && b.candidatos.length > 1 ? '\nOtros: ' + b.candidatos.slice(1, 4).map((c) => `${c.nombre} (${Math.round(c.puntaje * 100)} %)`).join(', ') : '');
    }
    $('#rRes').hidden = false; $('#rRes').textContent = txt;
  }
  $('#rProbar').addEventListener('click', probarRapido);
  $('#r-probar').addEventListener('keydown', (e) => { if (e.key === 'Enter') probarRapido(); });
  $('#rReindexar').addEventListener('click', async () => { const r = await api('POST', '/api/rapido/reindexar'); toast(r.ok ? `✔ ${r.cosas} cosas para abrir` : (r.error || 'Error'), !r.ok); });

  /* ------------------------------------------------------------ Visión */
  $('#vCamaras').addEventListener('click', async () => {
    const r = await api('GET', '/api/vision/camaras');
    if (!r.ok && r.error) { $('#vInfo').textContent = r.error; return; }
    const cur = A.vision.dispositivo || '';
    $('#v-disp').innerHTML = '<option value="">Predeterminada</option>' + (r.camaras || []).map((c) => `<option value="${esc(c.id)}"${c.id === cur ? ' selected' : ''}>${esc(c.nombre || c.id)}</option>`).join('');
    $('#vInfo').textContent = (r.camaras || []).length + ' cámara(s)';
  });
  async function probarVer(fuente) {
    $('#vInfo').textContent = 'Mirando…'; const r = await api('POST', '/api/vision/ver', { fuente, pregunta: 'Describe brevemente lo que ves.' });
    $('#vRes').hidden = false; $('#vRes').textContent = r.ok ? r.respuesta + '\n\n(' + (r.modelo || '?') + (r.local ? ', local' : ', nube') + ')' : r.error;
    $('#vInfo').textContent = r.ok ? '✔' : '✖';
  }
  $('#vProbarCam').addEventListener('click', () => probarVer('camara'));
  $('#vProbarPan').addEventListener('click', () => probarVer('pantalla'));

  /* -------------------------------------------------------------- Memoria */
  async function cargarMemoria() {
    const r = await api('GET', '/api/memoria');
    if (r.ok) { memoria = r.memoria; pintarMemoria(); }
  }
  async function editarMemoria(d) {
    const r = await api('POST', '/api/memoria', d);
    if (r.ok) { memoria = r.memoria; pintarMemoria(); toast('✔ Memoria actualizada'); } else toast(r.error || 'error', true);
  }
  const fecha = (t) => { const d = new Date(t * 1000); return d.toLocaleDateString('es', { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString('es', { hour: '2-digit', minute: '2-digit' }); };
  function lista(sel, items, fn) { $(sel).innerHTML = items.length ? items.map(fn).join('') : '<div class="vacio">Nada todavía.</div>'; }
  function pintarMemoria() {
    const m = memoria;
    if (document.activeElement !== $('#m-nombre')) $('#m-nombre').value = m.usuario.nombre || '';
    const s = m.stats || {};
    $('#mStats').innerHTML = [['Charlas', s.turnos], ['Respuestas rápidas', s.reflejos], ['Con IA', s.ia], ['A Noviq', s.a_noviq], ['Herramientas', s.herramientas]]
      .map(([n, v]) => `<span class="stat"><b>${v || 0}</b>${n}</span>`).join('');
    lista('#mDatos', Object.entries(m.usuario.datos || {}).filter(([, v]) => v !== '(preguntado)'), ([k, v]) => `<div class="item"><span class="tx"><b>${esc(k)}:</b> ${esc(v)}</span><button class="x" data-bdato="${esc(k)}" title="Borrar">✕</button></div>`);
    lista('#mHechos', m.hechos.slice().reverse(), (h) => `<div class="item"><span class="tx">${esc(h.texto)}</span><span class="me">${fecha(h.t)}</span><button class="x" data-bhecho="${h.id}" title="Olvidar">✕</button></div>`);
    lista('#mRecs', m.recordatorios, (r) => `<div class="item"><span class="tx">⏰ ${esc(r.texto)}</span><span class="me">${fecha(r.cuando)}${r.repetir ? ' · se repite' : ''}</span><button class="x" data-brec="${r.id}" title="Borrar">✕</button></div>`);
    lista('#mPlanes', m.planes.slice().reverse(), (p) => `<div class="item"><span class="tx">${esc(p.texto)}</span><span class="me">${esc(p.estado)}</span><button class="x" data-bplan="${p.id}" title="Borrar">✕</button></div>`);
    lista('#mAprendido', m.aprendido, (a) => `<div class="item"><span class="tx">«${esc(a.p)}» → ${esc(a.r)}</span><span class="me">${a.fuente === 'usuario' ? 'tú' : 'IA'} · ${a.veces}×</span><button class="x" data-bap="${esc(a.p)}" title="Borrar">✕</button></div>`);
    $('#mCharla').innerHTML = m.charla.length ? m.charla.map((c) => `<div class="burb ${c.rol === 'user' ? 'user' : ''}">${esc(c.texto)}<small class="tenue">${fecha(c.t)} · ${esc(c.origen || '')}</small></div>`).join('') : '<div class="vacio">Sin charlas.</div>';
    const ch = $('#mCharla'); ch.scrollTop = ch.scrollHeight;
  }
  $('#s-memoria').addEventListener('click', (e) => {
    const t = e.target;
    if (t.dataset.bdato) editarMemoria({ dato: { clave: t.dataset.bdato, valor: '' } });
    if (t.dataset.bhecho) editarMemoria({ borrar_hecho: t.dataset.bhecho });
    if (t.dataset.brec) editarMemoria({ borrar_recordatorio: t.dataset.brec });
    if (t.dataset.bplan) editarMemoria({ borrar_plan: t.dataset.bplan });
    if (t.dataset.bap != null) editarMemoria({ borrar_aprendido: t.dataset.bap });
  });
  $('#m-nombre').addEventListener('change', (e) => editarMemoria({ nombre: e.target.value.trim() }));
  $('#mDatoAdd').addEventListener('click', () => { const k = $('#mDatoK').value.trim(), v = $('#mDatoV').value.trim(); if (k && v) { editarMemoria({ dato: { clave: k, valor: v } }); $('#mDatoK').value = $('#mDatoV').value = ''; } });
  $('#mHechoAdd').addEventListener('click', () => { const v = $('#mHecho').value.trim(); if (v) { editarMemoria({ agregar_hecho: v }); $('#mHecho').value = ''; } });
  $('#mRecAdd').addEventListener('click', () => {
    const que = $('#mRecQue').value.trim(), cuando = $('#mRecCuando').value.trim();
    if (!que || !cuando) return toast('Escribe qué y cuándo', true);
    const antes = memoria.recordatorios.length;
    editarMemoria({ agregar_recordatorio: { que, cuando } }).then(() => { if (memoria.recordatorios.length === antes) toast('No entendí «cuándo» (ej.: mañana a las 9, en 20 minutos, los lunes a las 7)', true); else $('#mRecQue').value = $('#mRecCuando').value = ''; });
  });
  $('#mApAdd').addEventListener('click', () => { const p = $('#mApQ').value.trim(), r = $('#mApR').value.trim(); if (p && r) { editarMemoria({ agregar_aprendido: { p, r } }); $('#mApQ').value = $('#mApR').value = ''; } });
  for (const id of ['#mHecho', '#mRecCuando', '#mApR', '#mDatoV']) $(id).addEventListener('keydown', (e) => { if (e.key === 'Enter') $(id).parentElement.querySelector('button').click(); });
  $('#mBorrarCharla').addEventListener('click', () => { if (confirm('¿Borrar las últimas charlas? (lo demás se queda)')) editarMemoria({ borrar_charla: true }); });
  $('#mOlvidar').addEventListener('click', () => {
    if (!confirm('¿Seguro? Olvidará TODO: tu nombre, lo que sabe de ti, recordatorios, planes y lo aprendido.')) return;
    if (prompt('Escribe OLVIDAR para confirmar') === 'OLVIDAR') editarMemoria({ olvidar_todo: true });
  });

  /* ---------------------------------------------------------------- Noviq */
  $('#heredar').addEventListener('click', async () => {
    const r = await api('POST', '/api/heredar');
    $('#heredarInfo').textContent = r.ok ? `✔ Memoria: +${r.memoria} datos · ajustes: ${r.ajustes.length}` : '✖ ' + r.error;
    await recargar(); cargarMemoria();
  });

  /* ------------------------------------------------------------------ API */
  let verClave = false;
  function pintarAPI() {
    const base = (A._info && A._info.api) || location.origin;
    $('#apiBase').textContent = base;
    $('#apiClave').textContent = verClave ? A.claveApi : A.claveApi.slice(0, 5) + '•'.repeat(18);
    $('#apiClave').dataset.valor = A.claveApi;
    pintarEjemplo();
    const R = [['POST /charla', 'Conversa con su mente: {"texto":"¿qué tengo hoy?"} → {"respuesta":…}'], ['POST /comando', 'Mueve/anima/hace hablar: {"cmd":"decir","texto":"Hola"} · lista: GET /comandos'],
      ['POST /v1/chat/completions', 'Compatible con OpenAI (clave del avatar)'], ['GET|POST /api/ajustes', 'Sus ajustes (JSON parcial)'], ['GET|POST /api/memoria', 'Su memoria'],
      ['POST /api/herramienta', '{"nombre":"buscar_internet","args":{"consulta":"…"}}'], ['POST /api/voz/hablar', 'Texto → audio (base64)'], ['POST /api/voz/escuchar', 'WAV base64 → texto ("entender": true para que actúe)'],
      ['POST /api/preguntar', 'Pregunta al usuario; la respuesta llega por WebSocket (evento «respuesta»)'], ['POST /api/eventos-app', 'Cuéntale algo: {"app":"mi-app","tipo":"nota","texto":"…"}'], ['WS /ws', 'Comandos y eventos en tiempo real']];
    $('#rutas').innerHTML = R.map(([a, b]) => `<div class="ruta"><code>${a}</code><span>${esc(b)}</span></div>`).join('');
  }
  let ejemplo = 'curl';
  function pintarEjemplo() {
    const b = (A._info && A._info.api) || location.origin, k = verClave ? A.claveApi : 'av-…TU_CLAVE…';
    const carpeta = 'C:\\\\…\\\\noviq-avatar';
    const E = {
      curl: `curl -X POST ${b}/charla -H "Content-Type: application/json" -d "{\\"texto\\":\\"Hola, ¿qué tengo para hoy?\\"}"\n\ncurl -X POST ${b}/comando -H "Content-Type: application/json" -d "{\\"cmd\\":\\"aviso\\",\\"tipo\\":\\"exito\\",\\"texto\\":\\"¡Compilación lista!\\"}"`,
      py: `import requests\nAV = "${b}"\nr = requests.post(f"{AV}/charla", json={"texto": "Recuérdame mañana a las 9 llamar a Ana"})\nprint(r.json()["respuesta"])\nrequests.post(f"{AV}/comando", json={"cmd": "celebrar"})\n# o con el cliente listo: clientes/noviq_avatar.py → Avatar().charlar("hola")`,
      js: `const AV = '${b}';\nconst r = await fetch(AV + '/charla', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ texto: '¿Cómo estás?' }) });\nconsole.log((await r.json()).respuesta);\n// cliente listo: clientes/noviq-avatar.js`,
      openai: `from openai import OpenAI\nc = OpenAI(base_url="${b}/v1", api_key="${k}")\nr = c.chat.completions.create(model="noviq-avatar", messages=[{"role": "user", "content": "¿Qué recuerdas de mí?"}])\nprint(r.choices[0].message.content)\n# añade extra_body={"hablar": True} para que además lo diga en voz alta`,
      mcp: `{\n  "mcpServers": {\n    "noviq-avatar": {\n      "command": "node",\n      "args": ["${carpeta}\\\\clientes\\\\mcp-avatar.js"],\n      "env": { "NOVIQ_AVATAR_URL": "${b}" }\n    }\n  }\n}`,
      ws: `const ws = new WebSocket('${b.replace('http', 'ws')}/ws');\nws.onmessage = (e) => console.log(JSON.parse(e.data));   // eventos: dice, charla, voz, respuesta, recordatorio…\nws.onopen = () => ws.send(JSON.stringify({ cmd: 'preguntar', id: 'p1', texto: '¿Publico la versión?' }));`
    };
    $('#codigo').textContent = E[ejemplo];
  }
  $('#ejemplos').addEventListener('click', (e) => { const b = e.target.closest('button'); if (!b) return; ejemplo = b.dataset.e; for (const x of $$('#ejemplos button')) x.classList.toggle('on', x === b); pintarEjemplo(); });
  $('#verClave').addEventListener('click', () => { verClave = !verClave; $('#verClave').textContent = verClave ? 'Ocultar' : 'Ver'; pintarAPI(); });
  $('#nuevaClave').addEventListener('click', async () => {
    if (!confirm('Las apps que usen la clave actual dejarán de funcionar. ¿Generar una nueva?')) return;
    const r = await api('POST', '/api/clave-api/nueva'); if (r.ok) { toast('✔ Clave nueva'); await recargar(); }
  });
  document.addEventListener('click', (e) => {
    const b = e.target.closest('[data-copiar]'); if (!b) return;
    const el = $('#' + b.dataset.copiar);
    navigator.clipboard.writeText(el.dataset.valor || el.textContent).then(() => toast('✔ Copiado'), () => toast('No pude copiar', true));
  });

  /* ------------------------------------------------------------- Secciones */
  function mostrar(s) {
    if (!$('#s-' + s)) s = 'identidad';
    for (const x of $$('.sec')) x.classList.toggle('on', x.id === 's-' + s);
    for (const a of $$('#nav a')) a.classList.toggle('on', a.dataset.s === s);
    if (s === 'voz' && !catalogo) cargarVoces();
    if (s === 'memoria') cargarMemoria();
    if (s === 'herramientas') pintarHerramientas();
    if (s === 'bots') pintarBots();
    $('#main').scrollTop = 0; window.scrollTo(0, 0);
  }
  window.addEventListener('hashchange', () => mostrar(location.hash.slice(1)));

  function pintarTodo(completo) {
    pintarCabecera(); pintarControles(); pintarRasgos(); pintarOido(); pintarCerebro(); pintarAPI();
    if (catalogo) pintarVoces();
    const inf = A._info || {};
    $('#atajoInfo').textContent = inf.atajoError ? '⚠ ' + inf.atajoError : inf.atajo ? 'Activo: ' + inf.atajo : '';
    $('#nvIntro').textContent = (A._info && A._info.noviq && A._info.noviq.conectado)
      ? '● Conectado: usa las herramientas y agentes de Noviq, y Noviq le avisa de sus trabajos.'
      : 'Noviq no está abierto. El avatar sigue funcionando con su propia mente, voz, oído y herramientas.';
    if (completo) enlazar();
  }
  async function recargar() {
    const r = await api('GET', '/api/ajustes');
    if (r.ok) { A = r.ajustes; pintarTodo(false); }
    return r;
  }

  async function iniciar() {
    const r = await api('GET', '/api/ajustes');
    if (!r.ok) { document.body.innerHTML = '<p style="padding:30px">No pude leer los ajustes: ' + esc(r.error) + '</p>'; return; }
    A = r.ajustes;
    pintarTodo(true);
    mostrar(location.hash.slice(1) || 'identidad');
    cargarMemoria();
    // refresco suave del estado (conexión, IA, oído)
    setInterval(async () => { if (!document.hidden && !Object.keys(cola).length) { const j = await api('GET', '/api/ajustes'); if (j.ok) { A = j.ajustes; pintarCabecera(); pintarOido(); if ($('#s-cerebro').classList.contains('on')) pintarCerebro(); } } }, 5000);
    // eventos en vivo del avatar (cambios hechos por voz o desde Noviq)
    try {
      const ws = new WebSocket(location.origin.replace('http', 'ws') + '/ws' + (TOKEN && TOKEN !== '__TOKEN__' ? '?token=' + encodeURIComponent(TOKEN) : ''));
      ws.onmessage = (e) => { const m = JSON.parse(e.data); if (m.tipo === 'evento' && (m.nombre === 'ajustes')) recargar(); if (m.tipo === 'evento' && ['charla', 'recordatorio'].includes(m.nombre) && $('#s-memoria').classList.contains('on')) cargarMemoria(); };
    } catch (_) { /* noop */ }
  }
  iniciar();
})();
