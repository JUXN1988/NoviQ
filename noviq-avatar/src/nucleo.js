'use strict';
/* ==========================================================================
   Noviq Avatar — Núcleo: une ajustes, memoria, cerebro, voz, oído,
   herramientas y mente, y define su API. No depende de Electron (lo que
   necesita del sistema llega en `sis`), así se prueba con Node puro.
   ========================================================================== */
const path = require('path');
const { Ajustes } = require('./ajustes');
const { Memoria } = require('./memoria');
const { Cerebro, PROVEEDORES } = require('./cerebro');
const PV = require('./proveedores');
const { Voz } = require('./voz/tts');
const { Oido } = require('./voz/stt');
const { analizar: analizarVoz, PerfilVoz, Ambiente } = require('./voz/escucha');
const { Herramientas } = require('./herramientas');
const H = require('./herramientas');
const { Documentos, servidorDocumentos } = require('./documentos');
const { Conexiones, presets: presetsMcp } = require('./mcp-cliente');
const { servidorWindows, servidorPC, ejecutarPowerShell, ejecutarProceso, diagnosticoPS, psCargar, PS } = require('./mcp-interno');
const { servidorProyectos } = require('./mcp-proyectos');
const { Localizador } = require('./localizador');
const { Rapido } = require('./rapido');
const { Agentes, Permisos } = require('./agentes');
const { Vision } = require('./vision');
const { Mente } = require('./mente');
const P = require('./personalidad');
const { leerJSON } = require('./almacen');

/**
 * sis: {dir, cifrador, noviq, cuerpo(cmd), emitir(n,d), abrirURL, abrirRuta, carpeta(nombre), leerClip(), escribirClip(t),
 *       abrirAjustes(), abrirNoviq(), log, version}
 */
function crearNucleo(sis) {
  const log = sis.log || (() => {});
  const ajustes = new Ajustes({ dir: sis.dir, cifrador: sis.cifrador, log });
  const memoria = new Memoria({ dir: sis.dir, log });
  const noviq = sis.noviq;
  if (noviq) noviq.activo = ajustes.datos.noviq.usar;
  const cerebro = new Cerebro({ ajustes, noviq, log, dir: sis.dir });
  ajustes.alCambiar((cambios) => cerebro.alCambiar(cambios));
  const voz = new Voz({ ajustes, noviq, dir: sis.dir, log });
  const oido = new Oido({ ajustes, noviq, log });
  const herramientas = new Herramientas({ aj: ajustes, memoria, noviq, abrirURL: sis.abrirURL || (() => {}), abrirRuta: sis.abrirRuta || (() => {}),
    carpeta: sis.carpeta || (() => null), leerClip: sis.leerClip || (async () => ''), escribirClip: sis.escribirClip || (() => {}), lanzarApp: sis.lanzarApp });
  /* ----- ⚡ Vía rápida: abrir/cerrar/apagar/volumen/proyectos al instante, sin IA */
  const ps = sis.ejecutarPS || ejecutarPowerShell;
  // PowerShell: el modo que funciona en este PC (stdin / archivo / argumento) se recuerda entre sesiones
  if (process.platform === 'win32' && !sis.ejecutarPS) { psCargar(sis.dir); PS.log = log; }
  const localizador = new Localizador({ dir: sis.dir, ejecutarPS: sis.ejecutarPS || (process.platform === 'win32' ? ejecutarPowerShell : null), log, rutaNoviq: sis.rutaNoviq,
    carpeta: sis.carpeta, raices: sis.raicesLocalizador, sinSistema: sis.sinSistema });
  /* ----- 📄 Documentos de Word (investiga, redacta, crea y abre; sin Noviq) */
  const documentos = new Documentos({ carpeta: sis.carpeta || (() => null), cerebro, ejecutarPS: ps, abrirRuta: sis.abrirRuta || (() => {}), log, windows: sis.windows,
    dir: sis.dirDocumentos, web: { buscarInternet: H.buscarInternet, leerPagina: H.leerPagina } });
  const rapido = new Rapido({ localizador, ajustes, ejecutarPS: ps, lanzar: sis.lanzar, abrirRuta: sis.abrirRuta, abrirURL: sis.abrirURL, carpeta: sis.carpeta, noviq,
    conNoviq: () => !!(noviq && noviq.conectado && ajustes.datos.noviq.usar), abrirNoviq: sis.abrirNoviq, log, herrCtx: herramientas.ctx, windows: sis.windows,
    documentos, ejecutarProceso: sis.ejecutarPS ? null : ejecutarProceso });
  herramientas.ctx.rapido = rapido;
  /* ----- MCP, permisos, ojos y bots internos */
  const conexiones = new Conexiones({ dir: sis.dir, log, rutaNoviqMcp: sis.rutaNoviqMcp });
  conexiones.registrarInterno(servidorWindows({ ejecutarPS: sis.ejecutarPS, ejecutarCmd: sis.ejecutarCmd, rapido, localizador }));
  conexiones.registrarInterno(servidorProyectos({ localizador, rapido }));
  conexiones.registrarInterno(servidorDocumentos(documentos));
  conexiones.registrarInterno(servidorPC({ ejecutarPS: sis.ejecutarPS, dirCapturas: sis.dirCapturas, forzarWindows: !!sis.ejecutarPS }));
  conexiones.sembrar();
  const permisos = new Permisos({ ajustes, dir: sis.dir, confirmar: sis.confirmar, log,
    avisar: (texto) => { if (sis.cuerpo) sis.cuerpo({ cmd: 'aviso', tipo: 'permiso', texto, voz: false }).catch(() => {}); } });
  const vision = new Vision({ ajustes, cerebro, cuerpo: sis.cuerpo, capturarPantalla: sis.capturarPantalla, log });
  let mente = null;
  const agentes = new Agentes({ ajustes, cerebro, conexiones, herramientas, noviq, permisos, vision, log, rapido, documentos,
    alTerminar: (j) => (mente ? mente.alTerminarTrabajo(j) : null) });
  rapido.agentes = agentes;
  const perfilVoz = new PerfilVoz(sis.dir ? path.join(sis.dir, 'voz_perfil.json') : null);
  const ambiente = new Ambiente();
  mente = new Mente({ ajustes, memoria, cerebro, herramientas, noviq, cuerpo: sis.cuerpo, emitir: sis.emitir, abrirAjustes: sis.abrirAjustes,
    abrirNoviq: sis.abrirNoviq, log, agentes, vision, rapido, voz, escucha: { perfil: perfilVoz, ambiente }, rutaNoviq: sis.rutaNoviq,
    estadoSistema: () => estadoSistema() });
  // PowerShell: ¿responde? (en la PC de Gabriel devolvía salidas vacías). Queda en el registro y en el estado.
  let estadoPS = null;
  if (process.platform === 'win32' && !sis.ejecutarPS && sis.precalentarMs !== 0) {
    if (PS.diagnosticado && PS.resultado) { estadoPS = PS.resultado; log(`[powershell] uso «${PS.modo}» (lo que funcionó en este PC el ${String(PS.resultado.t || '').slice(0, 10)})`); }
    else {
      const tps = setTimeout(() => diagnosticoPS().then((d) => { estadoPS = d; log(`[powershell] por la entrada: ${d.stdin} · como argumento: ${d.argumento} · en una línea: ${d.linea} → uso «${d.modo}» (${d.ms} ms)`); }).catch(() => {}), 1500);
      if (tps.unref) tps.unref();
    }
  }
  /** Estado REAL de sus partes, para el 🩺 autodiagnóstico (nada inventado). */
  function estadoSistema() {
    const ce = cerebro.ultimo || {};
    const avisos = [];
    for (const [p, st] of Object.entries(cerebro.stats || {})) {
      if (st && st.tFallo && Date.now() - st.tFallo < 6 * 3600000 && st.fallos) avisos.push({ proveedor: p, tipo: st.tipoError || 'otro', fallos: st.fallos, ok: st.ok || 0 });
    }
    let preferido = '';
    try { preferido = ajustes.datos.cerebro.proveedor || ''; } catch (_) { /* sin ajustes */ }
    return { voz: Object.assign({ activada: !!ajustes.datos.voz.activada }, voz.ultimo || {}), oido: oido.estado(), ps: estadoPS || PS.resultado || null,
      cerebro: { proveedor: ce.proveedor || '', modelo: ce.modelo || '', error: ce.error || '', preferido, avisos },
      noviq: noviq ? noviq.estado() : { conectado: false } };
  }
  PS.log = log;
  herramientas.ctx.vision = vision; herramientas.ctx.conexiones = conexiones; herramientas.ctx.agentes = agentes;
  const limpiezaMcp = setInterval(() => conexiones.soltarInactivos(), 5 * 60000); if (limpiezaMcp.unref) limpiezaMcp.unref();
  setTimeout(() => cerebro.precalentarSiToca().catch(() => {}), sis.precalentarMs != null ? sis.precalentarMs : 2500);
  if (sis.precalentarMs !== 0) { const tl = setTimeout(() => localizador.precalentar(), 4000); if (tl.unref) tl.unref(); }   // índice de «qué abrir» listo antes de que lo pidas

  /* ------------------------------------------- Herencia: lo que tenía en Noviq */
  /** Primera vez: trae la memoria y los ajustes que el avatar tenía dentro de Noviq (una sola vez). */
  async function heredar(desdeArchivo) {
    const out = { memoria: 0, ajustes: [] };
    let h = null;
    if (desdeArchivo) h = { memoria: leerJSON(desdeArchivo) };
    else if (noviq && noviq.conectado) { const r = await noviq.herencia(); if (r && r.ok) h = r; }
    if (!h) return null;
    if (h.memoria && !ajustes.datos.migrado.memoria) { out.memoria = memoria.importar(h.memoria); ajustes.marcarMigrado('memoria'); }
    const c = h.config || null;
    if (c && !ajustes.datos.migrado.noviq) {
      const parcial = { identidad: {}, voz: {}, oido: {}, portapapeles: {}, apariencia: {}, noviq: {} };
      if (c.nombre_bot) parcial.identidad.nombre = c.nombre_bot;
      if (Array.isArray(c.personalidad)) parcial.identidad.personalidad = c.personalidad;
      if (c.autonomia != null) parcial.identidad.autonomia = c.autonomia;
      if (c.instrucciones_extra) parcial.identidad.instrucciones = c.instrucciones_extra;
      if (c.voz != null) parcial.voz.activada = !!c.voz;
      if (c.voz_motor && ['microsoft', 'nvidia', 'windows'].includes(c.voz_motor)) parcial.voz.motor = c.voz_motor;
      if (c.voz_motor === 'piper') parcial.voz.motor = 'noviq';
      if (c.voz_id) parcial.voz.id = c.voz_motor === 'piper' ? 'piper:' + c.voz_id : c.voz_id;
      if (c.voz_vel) parcial.voz.velocidad = c.voz_vel;
      if (c.voz_tono) parcial.voz.tono = c.voz_tono;
      if (c.escuchar) parcial.oido.modo = c.escuchar;
      if (c.motor_voz && ['nvidia', 'noviq'].includes(c.motor_voz)) parcial.oido.motor = c.motor_voz;
      if (c.portapapeles) parcial.portapapeles.modo = c.portapapeles;
      if (c.ayuda_portapapeles != null) parcial.portapapeles.ayudaErrores = !!c.ayuda_portapapeles;
      if (c.dormir_min != null) parcial.apariencia.dormirMin = c.dormir_min;
      for (const [a, b] of [['que_mas', 'queMas'], ['anunciar_inicio', 'anunciarInicio'], ['burbujas_herramientas', 'burbujasHerramientas'],
        ['cerrar_con_noviq', 'cerrarConNoviq'], ['ofrecer_continuar', 'ofrecerContinuar'], ['herramientas', 'avisosTrabajo']]) if (c[a] != null) parcial.noviq[b] = !!c[a];
      out.ajustes = ajustes.actualizar(parcial);
      ajustes.marcarMigrado('noviq');
    }
    log(`[herencia] memoria +${out.memoria}, ajustes ${out.ajustes.length}`);
    return out;
  }

  /* -------------------------------------------------------- Estado público */
  function estadoAjustes() {
    return Object.assign(ajustes.publico(), {
      _info: Object.assign({
        version: sis.version, rasgos: Object.fromEntries(Object.entries(P.RASGOS).map(([k, v]) => [k, v.n])),
        noviq: noviq ? noviq.estado() : { conectado: false }, cerebro: cerebro.estado(), oido: oido.estado(), voz: voz.ultimo,
        mente: mente.estado(), carpeta: sis.dir, api: sis.urlAPI || null,
        escucha: { perfil: perfilVoz.estado(), ambiente: ambiente.estado(), powershell: estadoPS }
      }, sis.infoExtra ? sis.infoExtra() : {})
    });
  }

  /**
   * Claves de IA de Noviq: se las pide a Noviq. Si está cerrado y op.abrir, lo abre y espera a que conteste
   * (el avatar NUNCA lee la bóveda de Noviq por su cuenta: eso lo hace solo Noviq).
   */
  async function clavesDeNoviq(op) {
    op = op || {};
    if (noviq && !noviq.conectado && op.abrir && sis.abrirNoviq) {
      const abierto = await sis.abrirNoviq();
      if (!abierto) throw new Error('No encontré cómo abrir Noviq. Ábrelo tú y vuelve a pulsar «Traer mis claves de Noviq».');
      const hasta = Date.now() + (sis.esperaNoviqMs || 60000);
      while (Date.now() < hasta && !noviq.conectado) {
        await new Promise((ok2) => setTimeout(ok2, 1500));
        try { if (noviq.descubrir) noviq.descubrir(); await noviq.latido(); } catch (_) { /* sigue esperando */ }
      }
    }
    if (!noviq || !noviq.conectado) throw new Error('Noviq está cerrado: ábrelo y vuelve a pulsar «Traer mis claves de Noviq».');
    const r = await noviq.claves();
    if (!r || !r.ok) throw new Error((r && r.error) || 'Noviq no dio sus claves.');
    const claves = {};
    for (const [k, v] of Object.entries(r.claves_todas || r.claves || {})) claves[k] = (Array.isArray(v) ? v : [v]).filter(Boolean);
    return { fuente: 'noviq', claves };
  }

  /* ------------------------------------------------------------ API HTTP */
  const ok = (datos) => ({ datos: Object.assign({ ok: true }, datos) });
  const mal = (error, codigo) => ({ codigo: codigo || 400, datos: { ok: false, error } });
  const rutas = [
    { metodo: 'GET', ruta: '/api/ajustes', manejador: () => ok({ ajustes: estadoAjustes() }) },
    { metodo: 'POST', ruta: '/api/ajustes', manejador: ({ cuerpo, req }) => {
      // Lo delicado (cámara, permisos de los bots) solo lo cambia la página de ajustes o quien tenga la clave del avatar: nunca la IA ni un comando de voz
      const h = (req && req.headers) || {};
      const autorizado = h['x-avatar-pagina'] === '1' || String(h.authorization || '').replace(/^Bearer\s+/i, '') === ajustes.claveApi();
      const c = cuerpo || {};
      if (!autorizado && (c.vision && c.vision.camara !== undefined || c.agentes && (c.agentes.activar !== undefined || c.agentes.permisos !== undefined)))
        return mal('Eso solo se cambia desde la página de Ajustes del avatar (o con la clave del avatar en Authorization).', 403);
      return ok({ cambios: ajustes.actualizar(c), ajustes: estadoAjustes() });
    } },
    { metodo: 'POST', ruta: '/api/claves', manejador: async ({ cuerpo }) => {
      const nombre = PV.proveedorDeClave(String(cuerpo.nombre || ''));   // acepta «gratis» o «llm7», «groq»…
      if (!nombre) return mal('Clave desconocida: ' + cuerpo.nombre);
      const crudo = String(cuerpo.valor || '');
      if (!crudo.trim()) { ajustes.ponerClave(PROVEEDORES[nombre].clave, ''); return ok({ claves: ajustes.estadoClaves(), quitada: true }); }
      const [valor] = PV.limpiarClave(crudo);
      if (!valor) return mal('No encontré una clave en lo que pegaste.');
      const rev = PV.revisarClave(nombre, valor);
      if (rev.error) return mal(rev.error);
      const destino = rev.mover || nombre;
      const prueba = cuerpo.probar === false ? { ok: null } : await cerebro.validarClave(destino, valor);
      if (prueba.ok === false) return mal(prueba.error);
      ajustes.ponerClave(PROVEEDORES[destino].clave, valor);
      return ok({ claves: ajustes.estadoClaves(), destino, movida: destino !== nombre, aviso: rev.aviso || '', prueba });
    } },
    { metodo: 'GET', ruta: '/api/claves/noviq', manejador: async () => {
      const r = await clavesDeNoviq().catch((e) => ({ error: e.message }));
      if (r.error) return mal(r.error);
      return ok({ fuente: r.fuente, proveedores: Object.fromEntries(Object.entries(r.claves).filter(([k]) => PV.proveedorDeClave(k)).map(([k, v]) => [PV.proveedorDeClave(k), v.length])) });
    } },
    { metodo: 'POST', ruta: '/api/claves/importar-noviq', manejador: async () => {
      let r;
      try { r = await clavesDeNoviq({ abrir: true }); } catch (e) { return mal(e.message); }
      const traidas = [], detalle = {};
      for (const p of PV.CON_CLAVE) {
        const nombreClave = PROVEEDORES[p].clave;
        const lista = (r.claves[nombreClave] || r.claves[p] || []).filter((k) => !PV.revisarClave(p, k).error);
        if (!lista.length || p === 'propia') continue;
        const actual = ajustes.clave(nombreClave);
        if (actual && (await cerebro.validarClave(p, actual)).ok !== false) { detalle[p] = 'ya tenía una que funciona'; continue; }
        detalle[p] = 'las de Noviq no funcionan';
        for (const k of lista) {
          const v = await cerebro.validarClave(p, k);
          if (v.ok === false) continue;
          ajustes.ponerClave(nombreClave, k, true);
          traidas.push(p);
          detalle[p] = v.ok ? 'traída y probada' : 'traída (no pude probarla ahora)';
          break;
        }
      }
      if (traidas.length) ajustes.avisar(traidas.map((k) => 'claves.' + PROVEEDORES[k].clave));
      return ok({ traidas, detalle, fuente: r.fuente, claves: ajustes.estadoClaves() });
    } },
    { metodo: 'POST', ruta: '/api/clave-api/nueva', manejador: () => ok({ claveApi: ajustes.nuevaClaveApi() }) },
    { metodo: 'POST', ruta: '/api/heredar', manejador: async () => { const r = await heredar(); return r ? ok(r) : mal('Noviq no está abierto o no tiene nada que traer.'); } },
    { metodo: 'GET', ruta: '/api/memoria', manejador: () => ok({ memoria: memoria.publico() }) },
    { metodo: 'POST', ruta: '/api/memoria', manejador: ({ cuerpo }) => ok({ memoria: memoria.editar(cuerpo || {}) }) },
    { metodo: 'GET', ruta: '/api/voces', manejador: async () => ok(await voz.catalogo()) },
    { metodo: 'POST', ruta: '/api/voz/hablar', manejador: async ({ cuerpo }) => {
      const r = await voz.sintetizar(String(cuerpo.texto || ''), { motor: cuerpo.motor, voz: cuerpo.voz, estilo: cuerpo.estilo, velocidad: cuerpo.velocidad });
      if (cuerpo.enAvatar) sis.cuerpo({ cmd: 'decir', texto: String(cuerpo.texto || ''), audio: r.ok ? r.audio : undefined, voz: true }).catch(() => {});
      return { datos: r };
    } },
    { metodo: 'POST', ruta: '/api/voz/escuchar', manejador: async ({ cuerpo }) => {
      if (!cuerpo.audio) return mal('Falta "audio" (WAV en base64).');
      const r = await oido.transcribir(Buffer.from(String(cuerpo.audio), 'base64'));
      if (r.ok && cuerpo.entender && r.texto) r.mente = await mente.oir(r.texto, { forzado: true });
      return { datos: r };
    } },
    { metodo: 'GET', ruta: '/api/cerebro', manejador: () => ok(cerebro.estado()) },
    { metodo: 'GET', ruta: '/api/cerebro/modelos', manejador: async ({ query }) => {
      const p = String(query.proveedor || '');
      if (!PROVEEDORES[p]) return mal('Proveedor desconocido');
      const L = await cerebro.listar(p, query.refrescar === '1' || query.refrescar === 'true');
      return { codigo: 200, datos: { ok: L.ok, error: L.error || '', modelos: L.modelos, elegido: cerebro.modeloElegido(p), auto: cerebro.auto[p] || '',
        recomendado: L.ok ? cerebro.recomendado(p, L.modelos) : '', actual: cerebro.modeloActual(p) } };
    } },
    { metodo: 'POST', ruta: '/api/cerebro/probar', manejador: async ({ cuerpo }) => {
      const p = String(cuerpo.proveedor || '');
      if (!PROVEEDORES[p]) return mal('Proveedor desconocido');
      return { datos: await cerebro.probar(p, cuerpo.modelo ? String(cuerpo.modelo) : '') };
    } },
    { metodo: 'POST', ruta: '/api/cerebro/precalentar', manejador: async ({ cuerpo }) => {
      const p = String(cuerpo.proveedor || '');
      if (!PROVEEDORES[p] || !PROVEEDORES[p].local) return mal('Solo para Ollama o LM Studio');
      return { datos: await cerebro.precalentar(p, cuerpo.modelo ? String(cuerpo.modelo) : '') };
    } },
    /* ---- MCP: conectar el avatar con cualquier programa + bots internos + ojos */
    { metodo: 'GET', ruta: '/api/mcp/servidores', manejador: () => ok({ servidores: conexiones.publica(), presets: presetsMcp({ rutaNoviqMcp: sis.rutaNoviqMcp }) }) },
    { metodo: 'POST', ruta: '/api/mcp/servidores', manejador: ({ cuerpo }) => {
      try { const n = conexiones.poner((cuerpo && cuerpo.servidor) || cuerpo || {}); return ok({ id: n.id, servidores: conexiones.publica() }); } catch (e) { return mal(e.message); }
    } },
    { metodo: 'POST', ruta: '/api/mcp/servidores/activar', manejador: ({ cuerpo }) => conexiones.activar(String(cuerpo.id || ''), cuerpo.activo !== false) ? ok({ servidores: conexiones.publica() }) : mal('No existe ese servidor') },
    { metodo: 'POST', ruta: '/api/mcp/servidores/quitar', manejador: ({ cuerpo }) => conexiones.quitar(String(cuerpo.id || '')) ? ok({ servidores: conexiones.publica() }) : mal('No existe ese servidor') },
    { metodo: 'POST', ruta: '/api/mcp/probar', manejador: async ({ cuerpo }) => {
      try {
        const r = cuerpo.servidor ? await conexiones.probarDef(cuerpo.servidor) : await conexiones.probar(String(cuerpo.id || ''));
        return { codigo: 200, datos: Object.assign({}, r, { servidores: conexiones.publica() }) };
      } catch (e) { return { codigo: 200, datos: { ok: false, error: e.message } }; }
    } },
    { metodo: 'GET', ruta: '/api/mcp/herramientas', manejador: async ({ query }) => {
      try { return ok({ herramientas: (await conexiones.herramientas(String(query.servidor || ''))).map((t) => ({ nombre: t.name, desc: t.description, riesgo: t.riesgo, esquema: t.inputSchema })) }); } catch (e) { return mal(e.message); }
    } },
    { metodo: 'POST', ruta: '/api/mcp/llamar', manejador: async ({ cuerpo }) => {
      const id = String(cuerpo.servidor || ''), nombre = String(cuerpo.nombre || ''), args = cuerpo.args || {};
      try {
        const tools = await conexiones.herramientas(id);
        const t = tools.find((x) => x.name === nombre);
        if (!t) return mal('«' + id + '» no tiene la herramienta «' + nombre + '»');
        let riesgo = t.riesgo;
        const itn = conexiones.internos.get(id);
        if (itn && itn.riesgoDeLlamada) { const c = itn.riesgoDeLlamada(nombre, args); if (c.bloqueado) return mal('Bloqueado por seguridad: ' + c.motivo, 403); riesgo = c.riesgo || riesgo; }
        const perm = await permisos.autorizar({ quien: 'Un programa por la API', que: `usar «${nombre}» de ${id}: ${JSON.stringify(args).slice(0, 160)}`, riesgo, detalle: nombre + ' ' + JSON.stringify(args) });
        if (!perm.ok) return mal(perm.error, 403);
        return { datos: await conexiones.llamar(id, nombre, args) };
      } catch (e) { return mal(e.message); }
    } },
    { metodo: 'GET', ruta: '/api/agentes', manejador: async () => ok({ bots: await agentes.roster(), trabajos: agentes.trabajos(), pendientes: permisos.pendientes(), permisos: ajustes.datos.agentes.permisos }) },
    { metodo: 'POST', ruta: '/api/agentes/delegar', manejador: async ({ cuerpo }) => {
      if (!String(cuerpo.orden || '').trim()) return mal('Falta "orden".');
      if (cuerpo.esperar === false) { const l = await agentes.lanzar({ bot: cuerpo.bot, orden: cuerpo.orden, origen: 'api' }); return l.ok ? ok({ trabajo: l.trabajo }) : mal(l.error); }
      const r = await agentes.delegar({ bot: cuerpo.bot, orden: cuerpo.orden, origen: 'api' });
      return r.trabajo ? ok(r) : mal(r.error);
    } },
    { metodo: 'POST', ruta: '/api/agentes/cancelar', manejador: ({ cuerpo }) => { if (cuerpo.todos) { agentes.cancelarTodos(); return ok({}); } return agentes.cancelar(cuerpo.id) ? ok({}) : mal('No hay ese trabajo en marcha'); } },
    { metodo: 'GET', ruta: '/api/aprobaciones', manejador: () => ok({ pendientes: permisos.pendientes() }) },
    { metodo: 'POST', ruta: '/api/aprobaciones/resolver', manejador: ({ cuerpo }) => permisos.resolver(cuerpo.id, cuerpo.si === true) ? ok({}) : mal('Esa aprobación ya no está pendiente') },
    { metodo: 'GET', ruta: '/api/acciones', manejador: () => ok({ acciones: permisos.hist.slice(-60).reverse() }) },
    /* ---- ⚡ Vía rápida (sin IA) */
    // 👂 perfil de voz (TU voz vs. TV/fondo): ver y olvidar. Aprender se hace hablando («Noviq, aprende mi voz»)
    { metodo: 'GET', ruta: '/api/oido/perfil', manejador: () => ok({ perfil: perfilVoz.estado(), ambiente: ambiente.estado() }) },
    { metodo: 'POST', ruta: '/api/oido/perfil', manejador: ({ cuerpo }) => {
      const a = String((cuerpo && cuerpo.accion) || '');
      if (a === 'olvidar') perfilVoz.olvidar();
      else if (a === 'olvidar_fondo') perfilVoz.olvidar('fondo');
      else return { codigo: 400, datos: { ok: false, error: 'accion: olvidar | olvidar_fondo' } };
      return ok({ perfil: perfilVoz.estado() });
    } },
    { metodo: 'POST', ruta: '/api/rapido/entender', manejador: ({ cuerpo }) => ok({ orden: rapido.probar(String((cuerpo && cuerpo.texto) || '')) }) },
    { metodo: 'POST', ruta: '/api/rapido/buscar', manejador: async ({ cuerpo }) => {
      const b = await localizador.buscar(String((cuerpo && cuerpo.texto) || ''));
      return ok({ mejor: b.mejor && { nombre: b.mejor.nombre, tipo: b.mejor.tipo, ruta: b.mejor.ruta || b.mejor.appId, puntaje: b.puntaje }, candidatos: b.candidatos.map((c) => ({ nombre: c.nombre, tipo: c.tipo, puntaje: Math.round(c.puntaje * 100) / 100 })), consulta: b.consulta });
    } },
    { metodo: 'POST', ruta: '/api/rapido/reindexar', manejador: async () => ok({ cosas: (await localizador.indice(true)).length }) },
    { metodo: 'GET', ruta: '/api/rapido', manejador: async () => ok({ activo: rapido.activo(), stats: rapido.stats, indice: { cosas: (localizador.idx || []).length, hace: localizador.t ? Math.round((Date.now() - localizador.t) / 1000) : null } }) },
    { metodo: 'GET', ruta: '/api/vision', manejador: () => ok(vision.estado()) },
    { metodo: 'GET', ruta: '/api/vision/camaras', manejador: async () => ({ datos: await vision.camaras() }) },
    { metodo: 'POST', ruta: '/api/vision/ver', manejador: async ({ cuerpo }) => {
      const r = await vision.mirar(String(cuerpo.pregunta || 'Describe lo que ves.'), { fuente: cuerpo.fuente === 'pantalla' ? 'pantalla' : 'camara' });
      return { codigo: 200, datos: Object.assign({ ok: r.ok }, r.ok ? { respuesta: r.datos, modelo: r.modelo, local: r.local } : { error: r.error }) };
    } },
    { metodo: 'POST', ruta: '/mcp', manejador: async ({ cuerpo }) => mcpAvatar(cuerpo) },
    { metodo: 'GET', ruta: '/api/herramientas', manejador: async () => ok(await herramientas.lista()) },
    { metodo: 'POST', ruta: '/api/herramienta', manejador: async ({ cuerpo }) => ({ datos: await herramientas.ejecutar(cuerpo.nombre, cuerpo.args || {}) }) },
    { metodo: 'POST', ruta: '/api/eventos-app', manejador: ({ cuerpo }) => ({ datos: mente.alEventoApp(cuerpo) }) },
    { metodo: 'POST', ruta: '/api/preguntar', manejador: ({ cuerpo }) => ok(mente.preguntar(cuerpo || {})) },
    { metodo: 'GET', ruta: '/api/mente', manejador: () => ok(mente.estado()) },
    { metodo: 'POST', ruta: '/api/abrir-ajustes', manejador: () => { sis.abrirAjustes && sis.abrirAjustes(); return ok({}); } },
    /* ---- Compatible con OpenAI: base_url = http://127.0.0.1:7777/v1 · api_key = av-… */
    { metodo: 'GET', ruta: '/v1/models', manejador: () => ({ datos: { object: 'list', data: [{ id: 'noviq-avatar', object: 'model', created: 0, owned_by: 'noviq' }] } }) },
    { metodo: 'POST', ruta: '/v1/chat/completions', manejador: async ({ cuerpo, res, req }) => {
      const msgs = Array.isArray(cuerpo.messages) ? cuerpo.messages : [];
      const ult = [...msgs].reverse().find((m) => m.role === 'user');
      const texto = ult ? (typeof ult.content === 'string' ? ult.content : (ult.content || []).map((p) => p.text || '').join(' ')) : '';
      if (!texto.trim()) return mal('No hay mensaje del usuario.');
      const hablar = cuerpo.hablar === true || String(req.headers['x-avatar-hablar'] || '') === '1';
      const r = await mente.conversar(texto, 'api', { hablar, esperar: true });
      const contenido = r.respuesta || '';
      const id = 'chatcmpl-' + Date.now().toString(36), creado = Math.floor(Date.now() / 1000);
      if (cuerpo.stream) {
        res.writeHead(200, { 'Content-Type': 'text/event-stream; charset=utf-8', 'Cache-Control': 'no-cache', Connection: 'keep-alive' });
        const trozo = (delta, fin) => res.write('data: ' + JSON.stringify({ id, object: 'chat.completion.chunk', created: creado, model: 'noviq-avatar',
          choices: [{ index: 0, delta, finish_reason: fin || null }] }) + '\n\n');
        trozo({ role: 'assistant' });
        for (const parte of contenido.match(/.{1,40}(\s|$)|.{1,40}/g) || []) trozo({ content: parte });
        trozo({}, 'stop');
        res.end('data: [DONE]\n\n');
        return { manejado: true };
      }
      return { datos: { id, object: 'chat.completion', created: creado, model: 'noviq-avatar',
        choices: [{ index: 0, message: { role: 'assistant', content: contenido }, finish_reason: 'stop' }],
        usage: { prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 }, avatar: { accion: r.accion, via: r.via, herramienta: r.herramienta || null } } };
    } }
  ];

  /* ------------------------------------------------ Servidor MCP del avatar (POST /mcp, JSON-RPC)
     Cualquier programa compatible con MCP (por URL, con la clave del avatar) puede hablar con él y mandar a sus bots. */
  const TOOLS_MCP = [
    { name: 'avatar_charlar', description: 'Conversa con el avatar (memoria, personalidad, IA y herramientas). Devuelve su respuesta; hablar=true la dice en voz alta.',
      inputSchema: { type: 'object', properties: { texto: { type: 'string' }, hablar: { type: 'boolean' } }, required: ['texto'] },
      run: async (a) => (await mente.conversar(String(a.texto || ''), 'api', { hablar: !!a.hablar, esperar: true })).respuesta || '(sin respuesta)' },
    { name: 'avatar_delegar', description: 'Manda una orden a un bot interno del avatar (pc, web, vision, noviq o un servidor MCP) y espera su resultado. Mira avatar_bots.',
      inputSchema: { type: 'object', properties: { bot: { type: 'string' }, orden: { type: 'string' }, esperar: { type: 'boolean', description: 'false = segundo plano' } }, required: ['bot', 'orden'] },
      run: async (a) => {
        if (a.esperar === false) { const l = await agentes.lanzar({ bot: a.bot, orden: a.orden, origen: 'api' }); return l.ok ? 'trabajo #' + l.trabajo.id + ' en marcha' : 'ERROR: ' + l.error; }
        const r = await agentes.delegar({ bot: a.bot, orden: a.orden, origen: 'api' });
        return r.trabajo ? (r.trabajo.estado === 'listo' ? '' : '[' + r.trabajo.estado + '] ') + r.resultado : 'ERROR: ' + r.error;
      } },
    { name: 'avatar_bots', description: 'Lista los bots internos del avatar y los trabajos que están haciendo.', inputSchema: { type: 'object', properties: {} },
      run: async () => JSON.stringify({ bots: await agentes.roster(), trabajos: agentes.trabajos().slice(0, 10) }, null, 1) },
    { name: 'avatar_ver', description: 'El avatar mira (cámara conectada o pantalla) y responde la pregunta. La cámara debe estar activada por el usuario en sus Ajustes.',
      inputSchema: { type: 'object', properties: { pregunta: { type: 'string' }, fuente: { type: 'string', enum: ['camara', 'pantalla'] } } },
      run: async (a) => { const r = await vision.mirar(String(a.pregunta || 'Describe lo que ves.'), { fuente: a.fuente === 'pantalla' ? 'pantalla' : 'camara' }); return r.ok ? r.datos : 'ERROR: ' + r.error; } },
    { name: 'avatar_herramienta', description: 'Usa una herramienta sencilla del avatar (buscar_internet, leer_pagina, clima, calcular…).',
      inputSchema: { type: 'object', properties: { nombre: { type: 'string' }, args: { type: 'object' } }, required: ['nombre'] },
      run: async (a) => { const r = await herramientas.ejecutar(a.nombre, a.args || {}); return r.ok === false ? 'ERROR: ' + r.error : typeof r.datos === 'string' ? r.datos : JSON.stringify(r.datos != null ? r.datos : r.decir || 'ok'); } },
    { name: 'avatar_decir', description: 'El avatar dice un texto con voz y gesto.', inputSchema: { type: 'object', properties: { texto: { type: 'string' } }, required: ['texto'] },
      run: async (a) => { await sis.cuerpo({ cmd: 'aviso', tipo: 'info', texto: String(a.texto || '').slice(0, 400), voz: true }); return 'dicho'; } }
  ];
  async function mcpAvatar(msg) {
    msg = msg || {};
    const { id, method, params } = msg;
    const resp = (result) => ({ codigo: 200, datos: { jsonrpc: '2.0', id, result } });
    const err = (code, message) => ({ codigo: 200, datos: { jsonrpc: '2.0', id, error: { code, message } } });
    if (id === undefined || id === null) return { codigo: 202, datos: {} };   // notificación
    if (method === 'initialize') return resp({ protocolVersion: (params && params.protocolVersion) || '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'noviq-avatar', version: sis.version || '2' },
      instructions: 'Avatar con bots internos. Usa avatar_bots para ver sus bots y avatar_delegar para darles órdenes.' });
    if (method === 'ping') return resp({});
    if (method === 'tools/list') return resp({ tools: TOOLS_MCP.map(({ name, description, inputSchema }) => ({ name, description, inputSchema })) });
    if (method === 'tools/call') {
      const t = TOOLS_MCP.find((x) => x.name === (params && params.name));
      if (!t) return resp({ content: [{ type: 'text', text: 'Herramienta desconocida' }], isError: true });
      try { const texto = await t.run((params && params.arguments) || {}); return resp({ content: [{ type: 'text', text: String(texto) }] }); }
      catch (e) { return resp({ content: [{ type: 'text', text: 'ERROR: ' + e.message }], isError: true }); }
    }
    return err(-32601, 'Método no soportado: ' + method);
  }

  /** POST /charla (y comando «charlar»). */
  async function charlar(cuerpo) {
    const texto = String((cuerpo && (cuerpo.texto || cuerpo.text)) || '');
    if (!texto.trim()) return { ok: false, error: 'Falta "texto".' };
    const r = await mente.conversar(texto, cuerpo.origen || 'api', { hablar: cuerpo.hablar !== false, esperar: true });
    return Object.assign({ ok: true }, r);
  }

  /** Audio del micrófono (WAV base64) → texto → mente. */
  async function oirMicrofono(audioB64, op) {
    op = op || {};
    const wav = Buffer.from(String(audioB64 || ''), 'base64');
    if (wav.length < 2000) return { ok: true, ignorado: true };
    // 👂 ¿quién habla? (huella de la voz, nivel sobre el ruido) y ¿hay algo sonando todo el tiempo?
    let acustica = null;
    try { acustica = analizarVoz(wav); } catch (e) { log('oído: análisis: ' + e.message); }
    if (acustica && op.rms && op.ruido) acustica.snrDb = +(20 * Math.log10(Math.max(1e-6, op.rms) / Math.max(1e-5, op.ruido))).toFixed(1);   // del micrófono real (antes de normalizar)
    const vozP = perfilVoz.puntuar(acustica);
    const amb = ambiente.estado();
    const filtro = ajustes.datos.oido.filtro || 'normal';
    // ahorro: con tu voz bien aprendida, lo que suena IGUAL al fondo ya aprendido (con la TV puesta) ni se manda a
    // transcribir. Conservador a propósito: si dudara, podría perderse tu «Noviq…» (solo se salta lo muy parecido al fondo).
    if (!op.forzado && filtro !== 'apagado' && amb.tv && perfilVoz.d.usuario.n >= 8 && perfilVoz.d.fondo.n >= 4 &&
        vozP.fondo != null && vozP.fondo >= 0.6 && vozP.usuario <= 0.15) {
      ambiente.anotar(acustica ? acustica.dur : op.segundos, false);
      log(`[oído] no lo transcribo: suena al fondo (voz ${vozP.diferencia}, TV encendida)`);
      return { ok: true, ignorado: true, texto: '' };
    }
    const t = await oido.transcribir(wav);
    if (!t.ok) {
      // sin motor: lo avisa como mucho una vez cada 10 min (salvo si le hablaste con clic o atajo)
      const avisar = !!op.forzado || (t.sinMotor && Date.now() - (oirMicrofono.tAviso || 0) > 600000);
      if (avisar && t.sinMotor) oirMicrofono.tAviso = Date.now();
      return { ok: false, error: t.error, avisar, sinMotor: !!t.sinMotor };
    }
    if (!t.texto) { ambiente.anotar(acustica ? acustica.dur : op.segundos, false); return { ok: true, ignorado: true, texto: '' }; }
    const r = await mente.oir(t.texto, { forzado: !!op.forzado, auto: !!op.auto, modo: op.modo, acustica, voz: vozP, ambiente: amb, stt: { confianza: t.confianza, sinVoz: t.sinVoz } });
    ambiente.anotar(acustica ? acustica.dur : op.segundos, !r.ignorado);
    sis.emitir && sis.emitir('voz', { texto: t.texto, motor: t.motor, ms: t.ms, ignorado: !!r.ignorado, accion: r.accion || null });
    return r;
  }

  /** Comandos que van a la mente (destino «mente» en el catálogo). */
  async function comandoMente(nombre, P_) {
    switch (nombre) {
      case 'charlar': return charlar(Object.assign({ hablar: true }, P_));
      case 'preguntar': return mente.preguntar(P_);
      case 'escuchar_respuesta': return mente.escucharSinNombre(P_.segundos != null ? P_.segundos : P_.duracion / 1000);
      case 'recordar': return { ok: memoria.recordar(String(P_.texto || ''), 'api') };
      case 'recordatorio': { const r = memoria.crearRecordatorio(String(P_.texto || P_.que || ''), String(P_.cuando || '')); if (!r) throw new Error('No entendí «cuando» (ej.: «mañana a las 8», «en 20 minutos»).'); return r; }
      case 'evento_app': return mente.alEventoApp(P_);
      default: throw new Error('Comando de la mente desconocido: ' + nombre);
    }
  }

  return { ajustes, memoria, cerebro, voz, oido, herramientas, mente, conexiones, agentes, permisos, vision, localizador, rapido, documentos, perfilVoz, ambiente, estadoPS: () => estadoPS, rutas, charlar, oirMicrofono, comandoMente, heredar, estadoAjustes };
}

module.exports = { crearNucleo };
