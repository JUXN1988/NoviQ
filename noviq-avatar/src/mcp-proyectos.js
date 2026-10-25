'use strict';
/* ==========================================================================
   Noviq Avatar — Servidor MCP interno «proyectos» (el bot de proyectos)
   Mira tus proyectos de programación AL INSTANTE y sin cambiar nada:
   listarlos, ver sus archivos, buscar en su código, leer un trozo, abrirlos
   (carpeta o VS Code en la línea exacta) y ejecutarlos (jugar.bat, index.html,
   main.py, npm…). Cambiar código NO es de este bot: eso lo hace Noviq.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const { norm } = require('./util');
const { SECRETOS_ARCHIVO } = require('./mcp-interno');

const TEXTO = /\.(js|mjs|cjs|ts|tsx|jsx|py|html?|css|scss|json|md|txt|bat|cmd|ps1|sh|cs|java|kt|kts|gd|lua|cpp|cc|c|h|hpp|go|rs|php|rb|vue|svelte|ya?ml|xml|sql|ini|cfg|toml|gradle|swift|dart|r|m|glsl|wgsl|shader|csv)$/i;
const PESADO = /^(node_modules|\.git|\.venv|venv|env|__pycache__|dist|build|\.next|\.cache|target|bin|obj|\.idea|\.vscode|\.noviq|entregas|lib|vendor|assets|activos|docs|\.gradle)$/i;
const tope = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n) + `\n… (recortado: ${t.length} caracteres)` : t; };
const S = (d) => ({ type: 'string', description: d });
const N = (d) => ({ type: 'number', description: d });

function servidorProyectos(op) {
  const L = op.localizador, R = op.rapido;
  async function proy(nombre) {
    if (!String(nombre || '').trim()) throw new Error('falta el nombre del proyecto (usa listar_proyectos)');
    const p = await L.proyecto(String(nombre));
    if (!p) throw new Error(`no encontré el proyecto «${String(nombre).slice(0, 60)}». Usa listar_proyectos para ver los nombres`);
    return p;
  }
  function dentro(p, rel) {
    const base = path.resolve(p.ruta);
    const abs = path.resolve(base, String(rel || '.').replace(/^[\\/]+/, ''));
    if (abs !== base && !abs.toLowerCase().startsWith(base.toLowerCase() + path.sep)) throw new Error('esa ruta está fuera del proyecto');
    if (SECRETOS_ARCHIVO.test(abs)) throw new Error('ese archivo guarda claves o datos privados: no lo leo');
    return abs;
  }
  /** Archivos de texto del proyecto (con límites para que sea rápido). */
  function archivos(raiz, max) {
    const out = [];
    const rec = (d, prof) => {
      if (out.length >= max || prof > 7) return;
      let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
      for (const e of es) {
        if (out.length >= max) return;
        const p = path.join(d, e.name);
        if (e.isDirectory()) { if (!PESADO.test(e.name) && !e.name.startsWith('.')) rec(p, prof + 1); }
        else if (TEXTO.test(e.name) && !SECRETOS_ARCHIVO.test(p) && !/\.min\.(js|css)$/i.test(e.name) && !/^activos_datos\.js$/i.test(e.name)) out.push(p);
      }
    };
    rec(raiz, 0);
    return out;
  }

  const T = [
    { name: 'listar_proyectos', description: 'Lista tus proyectos (nombre, carpeta y cómo se ejecuta).', inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() {
        const ps = await L.proyectos();
        if (!ps.length) return { ok: true, datos: 'No encontré proyectos (¿la carpeta Documentos\\Noviq_Proyectos existe?).' };
        return { ok: true, datos: ps.slice(0, 60).map((p) => { const c = R ? R.comoEjecutar(p.ruta) : null; return `- ${p.nombre} — ${p.ruta}${c ? ' (se ejecuta con ' + (c.archivo ? path.basename(c.archivo) : c.cmd) + ')' : ''}`; }).join('\n') };
      } },
    { name: 'archivos_proyecto', description: 'Muestra los archivos y carpetas de un proyecto (2 niveles; sin node_modules ni .git).',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto'), carpeta: S('subcarpeta (opcional)') }, required: ['proyecto'] }, riesgo: 'leer',
      async run(a) {
        const p = await proy(a.proyecto); const d = dentro(p, a.carpeta);
        const L2 = [];
        const rec = (dir, prof, pref) => {
          let es = []; try { es = fs.readdirSync(dir, { withFileTypes: true }); } catch (_) { return; }
          es.sort((x, y) => (y.isDirectory() - x.isDirectory()) || x.name.localeCompare(y.name));
          for (const e of es) {
            if (L2.length > 250) return;
            if (e.name.startsWith('.') && prof === 0 && e.name !== '.noviq.json') continue;
            let kb = ''; if (!e.isDirectory()) { try { kb = ' ' + Math.max(1, Math.round(fs.statSync(path.join(dir, e.name)).size / 1024)) + ' KB'; } catch (_) { /* sin acceso */ } }
            L2.push(pref + (e.isDirectory() ? '📁 ' + e.name + '/' : e.name + kb));
            if (e.isDirectory() && prof < 1 && !PESADO.test(e.name)) rec(path.join(dir, e.name), prof + 1, pref + '   ');
          }
        };
        rec(d, 0, '');
        return { ok: true, datos: `${p.nombre} (${d}):\n` + (L2.join('\n') || '(vacía)') };
      } },
    { name: 'buscar_en_proyecto', description: 'Busca un texto o expresión regular en el código de un proyecto (sin distinguir mayúsculas ni tildes). Devuelve archivo:línea: texto.',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto'), texto: S('qué buscar; varias opciones con | (ej. «condor|vuelo|alas»)'), extension: S('opcional, ej. «.js»') }, required: ['proyecto', 'texto'] }, riesgo: 'leer',
      async run(a) {
        const p = await proy(a.proyecto);
        const q = String(a.texto || '').trim();
        if (!q) return { ok: false, error: 'falta el texto a buscar' };
        const partes = q.split('|').map((x) => norm(x)).filter(Boolean);
        let rx = null; if (/[\\^$*+?()[\]{}]/.test(q)) { try { rx = new RegExp(q, 'i'); } catch (_) { rx = null; } }
        const t0 = Date.now(), hits = [], porArchivo = {};
        const lista = archivos(p.ruta, 4000).filter((f) => !a.extension || f.toLowerCase().endsWith(String(a.extension).toLowerCase()));
        for (const f of lista) {
          if (hits.length >= 60 || Date.now() - t0 > 4000) break;
          let st; try { st = fs.statSync(f); } catch (_) { continue; }
          if (st.size > 1500000) continue;
          let txt; try { txt = fs.readFileSync(f, 'utf8'); } catch (_) { continue; }
          const lineas = txt.split(/\r?\n/);
          for (let i = 0; i < lineas.length && hits.length < 60; i++) {
            const l = lineas[i];
            if (l.length > 2000) continue;
            const nl = norm(l);
            if (rx ? rx.test(l) : partes.some((x) => nl.includes(x))) {
              const rel = path.relative(p.ruta, f);
              porArchivo[rel] = (porArchivo[rel] || 0) + 1;
              if (porArchivo[rel] <= 12) hits.push(`${rel}:${i + 1}: ${l.trim().slice(0, 160)}`);
            }
          }
        }
        const resumen = Object.entries(porArchivo).sort((x, y) => y[1] - x[1]).slice(0, 8).map(([f, k]) => `${f} (${k})`).join(', ');
        return { ok: true, datos: hits.length ? `Coincidencias por archivo: ${resumen}\n` + hits.join('\n') : `No encontré «${q}» en ${lista.length} archivos de ${p.nombre}.` };
      } },
    { name: 'leer_archivo_proyecto', description: 'Lee un archivo de un proyecto con números de línea (desde/hasta; máx. 250 líneas por vez).',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto'), ruta: S('ruta dentro del proyecto, ej. «juego.js»'), desde: N('línea inicial (def. 1)'), hasta: N('línea final') }, required: ['proyecto', 'ruta'] }, riesgo: 'leer',
      async run(a) {
        const p = await proy(a.proyecto); const f = dentro(p, a.ruta);
        const st = fs.statSync(f);
        if (st.isDirectory()) return { ok: false, error: 'es una carpeta: usa archivos_proyecto' };
        if (st.size > 3000000) return { ok: false, error: 'el archivo es muy grande' };
        const lineas = fs.readFileSync(f, 'utf8').split(/\r?\n/);
        const d = Math.max(1, Math.floor(Number(a.desde) || 1));
        const h = Math.min(lineas.length, Math.max(d, Math.floor(Number(a.hasta) || d + 149)), d + 249);
        return { ok: true, datos: tope(`${path.relative(p.ruta, f)} (${lineas.length} líneas)\n` + lineas.slice(d - 1, h).map((l, i) => `${String(d + i).padStart(5)}  ${l}`).join('\n'), 20000) };
      } },
    { name: 'abrir_proyecto', description: 'Abre la carpeta del proyecto (con="explorador") o el proyecto en VS Code (con="vscode").',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto'), con: S('explorador | vscode') }, required: ['proyecto'] }, riesgo: 'leer',
      async run(a) { const p = await proy(a.proyecto); const r = R.abrirProyecto(p, /code/i.test(String(a.con || '')) ? 'vscode' : 'explorador'); return { ok: r.ok !== false, datos: r.respuesta }; } },
    { name: 'abrir_en_editor', description: 'Abre un archivo del proyecto en VS Code justo en una línea (para mostrarle el código al usuario).',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto'), ruta: S('archivo dentro del proyecto'), linea: N('línea') }, required: ['proyecto', 'ruta'] }, riesgo: 'leer',
      async run(a) { const p = await proy(a.proyecto); const f = dentro(p, a.ruta); if (!fs.existsSync(f)) return { ok: false, error: 'no existe ' + a.ruta }; R.enCode(f, a.linea); return { ok: true, datos: `abierto ${path.relative(p.ruta, f)}${a.linea ? ' en la línea ' + a.linea : ''}` }; } },
    { name: 'ejecutar_proyecto', description: 'Ejecuta el proyecto como lo haría el usuario (jugar.bat, iniciar.bat, index.html, main.py, npm run dev…).',
      inputSchema: { type: 'object', properties: { proyecto: S('nombre del proyecto') }, required: ['proyecto'] }, riesgo: 'accion',
      async run(a) { const p = await proy(a.proyecto); const r = R.ejecutarProyecto(p); return { ok: r.ok !== false, datos: r.respuesta }; } }
  ];
  const lista = () => T.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, riesgo: t.riesgo || 'accion' }));
  return {
    id: 'proyectos', nombre: 'Proyectos (mirar, abrir y ejecutar)', bot: 'Tus proyectos de programación al instante', interno: true,
    herramientas: lista,
    riesgoDeLlamada(nombreTool) { const t = T.find((x) => x.name === nombreTool); return { riesgo: (t && t.riesgo) || 'accion' }; },
    async llamar(nombreTool, args) {
      const t = T.find((x) => x.name === nombreTool);
      if (!t) return { ok: false, error: 'no existe la herramienta «' + nombreTool + '»' };
      try { return await t.run(args || {}); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
    }
  };
}

module.exports = { servidorProyectos };
