'use strict';
/* ==========================================================================
   Noviq Avatar — Servidores MCP INTERNOS (vienen con el avatar, sin instalar nada)
     · windows → PowerShell, CMD, archivos, carpetas, procesos, información del PC
     · pc      → pantalla, ratón, teclado, ventanas
   Misma interfaz que un servidor MCP externo: herramientas() y llamar().
   Seguridad (no se puede saltar ni con permiso del usuario):
     · bloqueados siempre: antivirus/Defender, -EncodedCommand/base64, DPAPI y la
       bóveda de claves, formatear/particionar, borrado recursivo de unidades,
       leer las claves/tokens del avatar y de Noviq.
     · cada herramienta declara su riesgo (leer | accion | peligro) y el control
       de permisos (agentes.js) decide si pregunta.
     · PowerShell recibe el script por la entrada estándar (no por la línea de
       comandos) y nunca codificado.
   ========================================================================== */
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawn } = require('child_process');
const { esSecreto } = require('./util');

const WIN = process.platform === 'win32';

/* ------------------------------------------------------- Clasificación */
// Nunca se ejecutan
const BLOQUEADO = [
  [/-enc(odedcommand)?\b|frombase64string|\[convert\]::frombase64/i, 'PowerShell codificado (base64)'],
  [/protecteddata|dpapi|claves\.vault|\.vault\b/i, 'leer la bóveda de claves'],
  [/set-mppreference|add-mppreference|disable-windowsoptionalfeature.*defender|sc\s+(stop|config|delete)\s+(windefend|wscsvc|sense)|\bmpcmdrun\b|exclusionpath|disablerealtimemonitoring|\bavast\b.*(stop|disable|uninstall)/i, 'tocar el antivirus o Windows Defender'],
  [/format-volume|\bformat\s+[a-z]:|diskpart|clear-disk|remove-partition|cipher\s+\/w|bcdedit|\bmbr2gpt/i, 'formatear o particionar discos'],
  [/(remove-item|del|rd|rmdir|rm)\b[^|;\n]*(\s|^)([a-z]:\\?(?=\s|$)|[a-z]:\\\*|\\windows\b|\\system32\b)/i, 'borrar unidades o carpetas del sistema'],
  [/vssadmin\s+delete|wbadmin\s+delete|wevtutil\s+cl\b|clear-eventlog/i, 'borrar copias de seguridad o registros del sistema'],
  [/net\s+user\b.*\/add|new-localuser|add-localgroupmember|net\s+localgroup\s+administrators/i, 'crear usuarios o dar permisos de administrador'],
  [/(invoke-webrequest|iwr|curl|wget|invoke-restmethod|irm|downloadstring|downloadfile|start-bitstransfer)\b[\s\S]*(\|\s*(iex|invoke-expression)|-outfile\s+\S+\.(exe|msi|bat|ps1|scr|dll))/i, 'descargar y ejecutar programas']
];
// Siempre piden permiso aunque el usuario esté en «solo lo peligroso»
const PELIGRO = /(remove-item|\bdel\b|\berase\b|\brd\b|\brmdir\b|\brm\b)[^|;\n]*(-recurse|\/s\b|-r\b|-force)|stop-process|taskkill|stop-service|restart-computer|stop-computer|shutdown|reg\s+(delete|add|import)|remove-itemproperty|set-itemproperty\s+(-path\s+)?['"]?hk|new-service|sc\s+(delete|create)|schtasks\s+\/(create|delete)|register-scheduledtask|unregister-scheduledtask|netsh\b|set-executionpolicy|disable-|uninstall|msiexec|winget\s+(install|uninstall)|choco\s+(install|uninstall)|pip\s+install|npm\s+(i|install|uninstall)\s+-g|invoke-expression|\biex\b|set-content[^|;\n]*\\windows\\|attrib\b.*\+s|icacls|takeown|move-item[^|;\n]*\\windows\\/i;
const SOLO_LEE = /^\s*(get-[\w-]+|test-path|select-[\w-]+|where-object|measure-[\w-]+|format-[\w-]+|sort-object|group-object|out-string|write-output|write-host|echo|hostname|whoami|dir|ls|gci|cat|type|pwd|cd|set-location|tree|ver|systeminfo|ipconfig|tasklist|findstr|find|more|date|time|path|set\s*$|where|nslookup|ping|netstat|getmac|vol|chcp|\$[\w:.]+(\s*\|)?)\b/i;

/** Devuelve {bloqueado, motivo} o {riesgo:'leer'|'accion'|'peligro'} para un comando de PowerShell/CMD. */
function clasificarComando(texto) {
  const t = String(texto || '');
  for (const [rx, motivo] of BLOQUEADO) if (rx.test(t)) return { bloqueado: true, motivo };
  if (PELIGRO.test(t)) return { riesgo: 'peligro' };
  const partes = t.split(/\r?\n|;|\|\||&&|(?<!\|)\|(?!\|)/).map((x) => x.trim()).filter(Boolean);
  if (partes.length && partes.every((p) => SOLO_LEE.test(p)) && !/(>|\bout-file\b|\bset-content\b|\badd-content\b|\bnew-item\b|\bremove-|\bstart-|\binvoke-|\bsetx?\b|\bcopy|\bmove|\brename|\bmkdir|\bmd\b)/i.test(t)) return { riesgo: 'leer' };
  return { riesgo: 'accion' };
}

const SECRETOS_ARCHIVO = /(^|[\\/])(claves\.(json|vault)|\.token|\.env(\.\w+)?|id_rsa[\w.]*|id_ed25519[\w.]*|login data|cookies|web data|key[34]\.db|logins\.json|credentials(\.json)?|\.npmrc|\.pypirc|\.netrc|secrets?\.(json|ya?ml|txt)|[\w.-]+\.(pem|pfx|p12|kdbx|vault))$/i;
const ZONA_SISTEMA = /^([a-z]:\\(windows|program files( \(x86\))?|programdata)(\\|$)|\/(etc|bin|sbin|usr|boot|sys|proc)(\/|$))/i;

function rutaSegura(p, escribir) {
  p = String(p || '').trim().replace(/^"|"$/g, '');
  if (!p) throw new Error('falta la ruta');
  if (p.startsWith('~')) p = path.join(os.homedir(), p.slice(1));
  const abs = path.resolve(p);
  if (SECRETOS_ARCHIVO.test(abs)) throw new Error('ese archivo guarda claves o datos privados: no lo toco');
  if (escribir && (ZONA_SISTEMA.test(abs) || ZONA_SISTEMA.test(p))) throw new Error('no escribo en carpetas del sistema (Windows, Program Files…)');
  return abs;
}

/* ------------------------------------------------------------ Ejecución */
function ejecutarProceso(cmd, args, stdin, ms, opciones) {
  return new Promise((resolve) => {
    let out = '', err = '', hecho = false, p;
    const fin = (r) => { if (hecho) return; hecho = true; clearTimeout(t); resolve(r); };
    const t = setTimeout(() => { try { p.kill(); } catch (_) { /* ya */ } fin({ ok: false, codigo: null, salida: out, error: 'tardó más de ' + Math.round(ms / 1000) + ' s y la detuve', tiempo: true }); }, ms);
    try { p = spawn(cmd, args, Object.assign({ windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] }, opciones || {})); }
    catch (e) { return fin({ ok: false, salida: '', error: e.message }); }
    p.on('error', (e) => fin({ ok: false, salida: out, error: e.code === 'ENOENT' ? 'no encuentro «' + cmd + '» en este equipo' : e.message }));
    p.stdout.setEncoding('utf8'); p.stderr.setEncoding('utf8');
    p.stdout.on('data', (d) => { if (out.length < 200000) out += d; });
    p.stderr.on('data', (d) => { if (err.length < 50000) err += d; });
    p.on('close', (codigo) => fin({ ok: codigo === 0, codigo, salida: out, error: err.trim() }));
    p.stdin.on('error', () => {});
    try { if (stdin != null) p.stdin.write(stdin); p.stdin.end(); } catch (_) { /* cerrado */ }
  });
}

const PS = { modo: 'stdin', fallosStdin: 0, ultimo: null, avisado: false, diagnosticado: false, diag: null, ruta: null, resultado: null, log: () => {} };
const PRE_PS = '[Console]::OutputEncoding=[System.Text.Encoding]::UTF8;$ProgressPreference="SilentlyContinue";$ErrorActionPreference="Continue";';
const MODOS_PS = ['stdin', 'argumento', 'linea'];
/** (2.6) Recuerda qué modo de PowerShell funciona en ESTE PC (así el primer uso del día ya sale bien). */
function psCargar(dir) {
  if (!dir) return;
  PS.ruta = path.join(dir, 'powershell.json');
  try {
    const j = JSON.parse(fs.readFileSync(PS.ruta, 'utf8'));
    if (MODOS_PS.includes(j.modo)) { PS.modo = j.modo; PS.resultado = j.resultado || null; PS.diagnosticado = true; }
  } catch (_) { /* primera vez */ }
}
function psGuardar() {
  if (!PS.ruta) return;
  try { fs.writeFileSync(PS.ruta, JSON.stringify({ modo: PS.modo, resultado: PS.resultado, t: new Date().toISOString() }, null, 1)); } catch (_) { /* sin disco */ }
}
const ARGS_PS = ['-NoLogo', '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command'];
/**
 * El script va como UN argumento, con sus saltos de línea (powershell.exe directo, sin cmd.exe): sirve para scripts de
 * varias líneas, con tildes (Windows pasa la línea de comandos en UTF-16) y comillas. Sin archivos temporales ni
 * -EncodedCommand (el antivirus los mira mal). Límite de Windows: ~32 000 caracteres.
 */
function psPorArgumento(script, ms, opciones) {
  return ejecutarProceso(WIN ? 'powershell.exe' : 'pwsh', ARGS_PS.concat([PRE_PS + '\n' + String(script)]), null, ms || 30000, opciones);
}
/** Plan C (si el anterior no funcionara): todo en una línea (solo scripts de una línea y sin tildes). */
function psPorLinea(script, ms, opciones) {
  return ejecutarProceso(WIN ? 'powershell.exe' : 'pwsh', ARGS_PS.concat([(PRE_PS + String(script)).replace(/\r?\n/g, '; ')]), null, ms || 30000, opciones);
}
function psPorStdin(script, ms, opciones) {
  const exe = WIN ? 'powershell.exe' : 'pwsh';
  const args = ARGS_PS.concat(['-']);
  if (WIN && /[^\x00-\x7f]/.test(String(script))) {
    return ejecutarProceso('cmd.exe', ['/d', '/s', '/c', '"chcp 65001>nul & powershell.exe ' + args.join(' ') + '"'], PRE_PS + '\n' + script + '\n', ms || 30000, Object.assign({ windowsVerbatimArguments: true }, opciones || {}));
  }
  return ejecutarProceso(exe, args, PRE_PS + '\n' + script + '\n', ms || 30000, opciones);
}
// (inyectables en las pruebas)
const RUN_PS = { stdin: psPorStdin, argumento: psPorArgumento, linea: psPorLinea };
const vacia = (r) => r && !String(r.salida || '').trim() && !r.tiempo;
const cabeEnArgumento = (s) => String(s).length < 30000;
const unaLineaAscii = (s) => String(s).length < 7000 && !/[^\x00-\x7f]/.test(String(s)) && !/[\r\n]/.test(String(s).trim());

/**
 * Ejecutor de PowerShell (inyectable en pruebas). Formas de pasarle el script, según cuál funcione en el PC:
 * «stdin» (por la entrada estándar), «argumento» (-Command con el script entero) o «linea» (-Command en una línea).
 * En la PC de Gabriel (10-10) PowerShell NO devolvía nada por la entrada estándar (código 0, salida vacía): el
 * localizador, el apagado y el bot de PC recibían «nada». Ahora, la primera vez que pasa, se hace el diagnóstico, se
 * repite el script por el modo que sí funciona y se recuerda para siempre (powershell.json). op.env: variables extra.
 */
async function ejecutarPowerShell(script, ms, op) {
  op = op || {};
  const opciones = op.env ? { env: Object.assign({}, process.env, op.env) } : undefined;
  const marca = (modo, r) => { PS.ultimo = { modo, codigo: r.codigo, vacia: vacia(r), error: String(r.error || '').slice(0, 200) }; return r; };
  if (WIN && PS.modo === 'argumento' && cabeEnArgumento(script)) return marca('argumento', await RUN_PS.argumento(script, ms, opciones));
  if (WIN && PS.modo === 'linea' && unaLineaAscii(script)) return marca('linea', await RUN_PS.linea(script, ms, opciones));
  const r = marca('stdin', await RUN_PS.stdin(script, ms, opciones));
  if (!WIN || !vacia(r)) return r;
  // salida vacía por la entrada estándar: ¿falla este modo en este PC? (se averigua UNA vez y se recuerda)
  if (!PS.diagnosticado && !op.sinDiagnostico) {
    await diagnosticoPS();
    if (PS.modo !== 'stdin') { PS.log(`[powershell] por la entrada estándar no responde; uso «${PS.modo}» desde ahora (y lo recuerdo)`); return ejecutarPowerShell(script, ms, Object.assign({}, op, { sinDiagnostico: true })); }
  }
  if ((r.codigo !== 0 || r.error) && cabeEnArgumento(script)) {
    PS.fallosStdin++;
    const r2 = await RUN_PS.argumento(script, ms, opciones);
    if (String(r2.salida || '').trim()) {
      if (PS.fallosStdin >= 2 && PS.modo === 'stdin') { PS.modo = 'argumento'; psGuardar(); PS.log('[powershell] por la entrada estándar no devuelve nada (código ' + r.codigo + (r.error ? ', ' + r.error.slice(0, 120) : '') + '); uso -Command desde ahora'); }
      return marca('argumento', r2);
    }
    if (!PS.avisado) { PS.avisado = true; PS.log('[powershell] no devuelve salida (código ' + r.codigo + '/' + r2.codigo + '; ' + String(r.error || r2.error || 'sin errores').slice(0, 160) + ').'); }
  }
  return r;
}
/** Prueba PowerShell en sus modos con un script de VARIAS líneas, con tilde y comillas; elige el que funciona y lo recuerda. */
function diagnosticoPS(op) {
  if (PS.diag && !(op && op.repetir)) return PS.diag;
  PS.diag = (async () => {
    const t0 = Date.now();
    const prueba = "$a = 'ñandú \"40\"'\nif ($a.Length -gt 3) {\n  'NQ' + (40 + 2)   # comentario\n}\nelse { 'x' }";
    const a = await RUN_PS.stdin(prueba, 15000);
    const b = WIN ? await RUN_PS.argumento(prueba, 15000) : { salida: '' };
    const c = WIN ? await RUN_PS.linea("'NQ'+(40+2)", 15000) : { salida: '' };
    const ok = (x) => /NQ42/.test((x && x.salida) || '');
    const txt = (x) => ok(x) ? 'ok' : `falla (código ${x.codigo}${x.error ? ': ' + String(x.error).slice(0, 120) : ''})`;
    PS.modo = ok(a) ? 'stdin' : ok(b) ? 'argumento' : ok(c) ? 'linea' : 'stdin';
    PS.diagnosticado = true;
    PS.resultado = { stdin: txt(a), argumento: WIN ? txt(b) : 'no aplica', linea: WIN ? txt(c) : 'no aplica', modo: PS.modo, ms: Date.now() - t0, t: new Date().toISOString() };
    psGuardar();
    return PS.resultado;
  })();
  return PS.diag;
}
function ejecutarCmd(comando, ms) {
  if (!WIN) return ejecutarProceso('sh', ['-c', comando], null, ms || 30000);
  return ejecutarProceso('cmd.exe', ['/d', '/s', '/c', 'chcp 65001>nul & ' + comando], null, ms || 30000, { windowsVerbatimArguments: true });
}

const tope = (t, n) => { t = String(t == null ? '' : t); return t.length > n ? t.slice(0, n) + `\n… (recortado: ${t.length} caracteres)` : t; };
const S = (d) => ({ type: 'string', description: d });
const N = (d) => ({ type: 'number', description: d });

/* =========================================================================
   Servidor «windows»
   ========================================================================= */
function servidorWindows(op) {
  op = op || {};
  const ps = op.ejecutarPS || ejecutarPowerShell, cmd = op.ejecutarCmd || ejecutarCmd;
  const T = [
    { name: 'powershell', description: 'Ejecuta comandos de PowerShell en este PC y devuelve su salida (Get-Process, Get-ChildItem, Get-Service, instalar, configurar…).',
      inputSchema: { type: 'object', properties: { comando: S('el script/comando de PowerShell'), segundos: N('límite de tiempo (def. 30, máx. 300)') }, required: ['comando'] },
      riesgoDe: (a) => clasificarComando(a.comando),
      async run(a) {
        const r = await ps(String(a.comando), Math.min(300, Math.max(3, Number(a.segundos) || 30)) * 1000);
        const texto = tope((r.salida || '').trim() + (r.error ? '\n[errores]\n' + r.error : ''), 6000);
        return r.ok || r.salida ? { ok: r.ok !== false || !!r.salida, datos: texto || '(sin salida)' } : { ok: false, error: r.error || 'falló' };
      } },
    { name: 'cmd', description: 'Ejecuta un comando del Símbolo del sistema (CMD) y devuelve su salida (dir, ipconfig, ping, tasklist…).',
      inputSchema: { type: 'object', properties: { comando: S('el comando de CMD'), segundos: N('límite (def. 30, máx. 300)') }, required: ['comando'] },
      riesgoDe: (a) => clasificarComando(a.comando),
      async run(a) {
        const r = await cmd(String(a.comando), Math.min(300, Math.max(3, Number(a.segundos) || 30)) * 1000);
        const texto = tope((r.salida || '').trim() + (r.error ? '\n[errores]\n' + r.error : ''), 6000);
        return { ok: r.ok || !!r.salida, datos: texto || '(sin salida)' };
      } },
    { name: 'leer_archivo', description: 'Lee un archivo de texto (código, notas, registros…).',
      inputSchema: { type: 'object', properties: { ruta: S('ruta del archivo'), maximo: N('caracteres máx. (def. 6000)') }, required: ['ruta'] }, riesgo: 'leer',
      async run(a) {
        const f = rutaSegura(a.ruta, false);
        const st = fs.statSync(f);
        if (st.isDirectory()) return { ok: false, error: 'es una carpeta: usa listar_carpeta' };
        if (st.size > 20 * 1024 * 1024) return { ok: false, error: 'el archivo pesa más de 20 MB' };
        const fd = fs.openSync(f, 'r'); const buf = Buffer.alloc(Math.min(st.size, 200000)); fs.readSync(fd, buf, 0, buf.length, 0); fs.closeSync(fd);
        if (buf.includes(0)) return { ok: false, error: 'parece un archivo binario (no es texto)' };
        return { ok: true, datos: tope(buf.toString('utf8'), Math.min(20000, Number(a.maximo) || 6000)) };
      } },
    { name: 'escribir_archivo', description: 'Crea o modifica un archivo de texto (con anexar=true añade al final).',
      inputSchema: { type: 'object', properties: { ruta: S('ruta del archivo'), texto: S('contenido'), anexar: { type: 'boolean' } }, required: ['ruta', 'texto'] }, riesgo: 'accion',
      async run(a) {
        const f = rutaSegura(a.ruta, true);
        if (esSecreto(String(a.texto || '')) && /claves?|secret|token|password/i.test(f)) return { ok: false, error: 'no guardo claves ni contraseñas en archivos' };
        fs.mkdirSync(path.dirname(f), { recursive: true });
        a.anexar ? fs.appendFileSync(f, String(a.texto)) : fs.writeFileSync(f, String(a.texto));
        return { ok: true, datos: (a.anexar ? 'anexado a ' : 'escrito ') + f };
      } },
    { name: 'listar_carpeta', description: 'Lista los archivos y subcarpetas de una carpeta (con tamaño y fecha).',
      inputSchema: { type: 'object', properties: { ruta: S('carpeta') }, required: ['ruta'] }, riesgo: 'leer',
      async run(a) {
        const d = rutaSegura(a.ruta, false);
        const es = fs.readdirSync(d, { withFileTypes: true }).slice(0, 300);
        const L = es.map((e) => { let st = {}; try { st = fs.statSync(path.join(d, e.name)); } catch (_) { /* sin acceso */ } return `${e.isDirectory() ? '[carpeta]' : '         '} ${e.name}${e.isDirectory() ? '' : '  ' + Math.round((st.size || 0) / 1024) + ' KB'}  ${st.mtime ? st.mtime.toISOString().slice(0, 16).replace('T', ' ') : ''}`; });
        return { ok: true, datos: L.join('\n') || '(vacía)' };
      } },
    { name: 'buscar_archivos', description: 'Busca archivos por nombre dentro de una carpeta (recursivo, máx. 60 resultados).',
      inputSchema: { type: 'object', properties: { carpeta: S('dónde buscar'), nombre: S('parte del nombre, ej. «factura» o «.pdf»') }, required: ['carpeta', 'nombre'] }, riesgo: 'leer',
      async run(a) {
        const raiz = rutaSegura(a.carpeta, false), q = String(a.nombre || '').toLowerCase();
        if (!q) return { ok: false, error: 'falta el nombre' };
        const out = []; let visitados = 0;
        const rec = (d, prof) => {
          if (out.length >= 60 || prof > 8 || visitados > 20000) return;
          let es = []; try { es = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
          for (const e of es) {
            visitados++;
            if (e.name.toLowerCase().includes(q) && !SECRETOS_ARCHIVO.test(e.name)) out.push(path.join(d, e.name));
            if (e.isDirectory() && !/^(node_modules|\.git|\$recycle\.bin|windows)$/i.test(e.name)) rec(path.join(d, e.name), prof + 1);
            if (out.length >= 60) return;
          }
        };
        rec(raiz, 0);
        return { ok: true, datos: out.join('\n') || 'no encontré nada' };
      } },
    { name: 'info_sistema', description: 'Información del PC: Windows, procesador, memoria, disco, usuario, hora.',
      inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() {
        const gb = (b) => (b / 1073741824).toFixed(1) + ' GB';
        return { ok: true, datos: [`Sistema: ${os.type()} ${os.release()} (${os.arch()})`, `Equipo: ${os.hostname()} · usuario: ${os.userInfo().username}`, `Procesador: ${(os.cpus()[0] || {}).model || '?'} (${os.cpus().length} núcleos)`,
          `Memoria: ${gb(os.freemem())} libres de ${gb(os.totalmem())}`, `Encendido hace: ${Math.round(os.uptime() / 3600)} h`, `Hora: ${new Date().toLocaleString('es-EC')}`].join('\n') };
      } },
    { name: 'procesos', description: 'Lista los programas/procesos en ejecución (los que más memoria usan), con filtro opcional por nombre.',
      inputSchema: { type: 'object', properties: { filtro: S('parte del nombre (opcional)') } }, riesgo: 'leer',
      async run(a) {
        const f = String(a.filtro || '').replace(/[^\w .-]/g, '');
        const r = await ps(`Get-Process${f ? ` -Name "*${f}*" -ErrorAction SilentlyContinue` : ''} | Sort-Object WorkingSet -Descending | Select-Object -First 25 Name,Id,@{n='MB';e={[int]($_.WorkingSet/1MB)}},MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200`, 20000);
        return r.ok || r.salida ? { ok: true, datos: tope(r.salida.trim(), 5000) || 'ninguno' } : { ok: false, error: r.error };
      } },
    ...(op.rapido ? herramientasRapidas(op.rapido, op.localizador) : []),
    { name: 'cerrar_programa', description: 'Cierra un programa por su nombre de proceso (ej. notepad). Pide permiso.',
      inputSchema: { type: 'object', properties: { nombre: S('nombre del proceso sin .exe') }, required: ['nombre'] }, riesgo: 'peligro',
      async run(a) {
        const n = String(a.nombre || '').replace(/\.exe$/i, '');
        if (!/^[\w .-]{1,60}$/.test(n)) return { ok: false, error: 'nombre no válido' };
        if (/^(system|csrss|wininit|winlogon|lsass|services|smss|svchost|explorer|dwm|msmpeng|avast\w*|avg\w*|aswidsagent|electron|noviq)$/i.test(n)) return { ok: false, error: '«' + n + '» es del sistema, del antivirus o de Noviq: no lo cierro' };
        const r = await ps(`Stop-Process -Name "${n}" -ErrorAction Stop; "cerrado"`, 15000);
        return r.ok ? { ok: true, datos: 'cerrado ' + n } : { ok: false, error: r.error || 'no pude cerrarlo' };
      } }
  ];
  return construir('windows', 'Windows (PowerShell, CMD y archivos)', 'Hace cosas en el PC: PowerShell, CMD, archivos y carpetas, procesos', T);
}

/* -------------------------------------------- Herramientas de la vía rápida
   Lo más común en un solo paso (el bot no tiene que inventar PowerShell). */
function herramientasRapidas(R, L) {
  const res = (r) => (r ? { ok: r.ok !== false && r.accion !== 'delegar', datos: r.respuesta || 'hecho', error: r.ok === false ? r.respuesta : undefined } : { ok: false, error: 'no pude hacerlo' });
  return [
    { name: 'abrir', description: 'Abre al instante un programa, app, acceso del escritorio, archivo, carpeta, web o proyecto por su nombre (ej. «Hub UI», «descargas», «chrome», «factura.pdf»).',
      inputSchema: { type: 'object', properties: { que: S('qué abrir, como lo diría el usuario') }, required: ['que'] }, riesgo: 'leer',
      async run(a) { return res(await R.abrir(String(a.que || ''), { desdeBot: true })); } },
    { name: 'buscar_en_mis_carpetas', description: 'Busca archivos o carpetas por nombre en Escritorio, Documentos, Descargas, Imágenes, Videos, Música y OneDrive (rápido). Ej. «pdf factura», «carpeta tareas».',
      inputSchema: { type: 'object', properties: { nombre: S('parte del nombre; puede llevar el tipo: pdf, excel, foto, video…') }, required: ['nombre'] }, riesgo: 'leer',
      async run(a) {
        const { buscarArchivos } = require('./localizador');
        const l = buscarArchivos(String(a.nombre || ''), L.carpetasUsuario(), { max: 12, maxMs: 5000, profundidad: 6 });
        return { ok: true, datos: l.length ? l.map((x) => `${x.tipo === 'carpeta' ? '[carpeta] ' : ''}${x.ruta}`).join('\n') : 'no encontré nada con ese nombre' };
      } },
    { name: 'cerrar_app', description: 'Cierra un programa abierto como la X de su ventana (si hay algo sin guardar, el programa pregunta). Ej. «chrome», «bloc de notas».',
      inputSchema: { type: 'object', properties: { nombre: S('programa o título de la ventana') }, required: ['nombre'] }, riesgo: 'accion',
      async run(a) { return res(await R.cerrar(String(a.nombre || ''))); } },
    { name: 'energia', description: 'Apagar o reiniciar la PC (con 1 minuto para cancelar), suspender, bloquear, o cancelar un apagado.',
      inputSchema: { type: 'object', properties: { accion: S('apagar | reiniciar | suspender | bloquear | cancelar') }, required: ['accion'] },
      riesgoDe: (a) => ({ riesgo: /^(cancelar|bloquear)$/.test(String(a.accion)) ? 'accion' : 'peligro' }),
      async run(a) { const ac = String(a.accion || '').toLowerCase(); if (!/^(apagar|reiniciar|suspender|bloquear|cancelar)$/.test(ac)) return { ok: false, error: 'acción no válida' }; return res(await R.energia(ac)); } },
    { name: 'volumen', description: 'Sube, baja, silencia o fija el volumen (valor 0-100).',
      inputSchema: { type: 'object', properties: { accion: S('subir | bajar | mudo | fijar'), valor: N('para fijar: 0-100') }, required: ['accion'] }, riesgo: 'leer',
      async run(a) { const ac = String(a.accion || '').toLowerCase(); if (!/^(subir|bajar|mudo|fijar)$/.test(ac)) return { ok: false, error: 'acción no válida' }; return res(await R.volumen(ac, Number(a.valor) || 0)); } },
    { name: 'minimizar_todo', description: 'Minimiza todas las ventanas (muestra el escritorio).', inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() { return res(await R.ventanas('minimizar')); } }
  ];
}

/* =========================================================================
   Servidor «pc»: pantalla, ratón, teclado, ventanas (solo Windows)
   ========================================================================= */
const TECLAS = { enter: '{ENTER}', intro: '{ENTER}', tab: '{TAB}', esc: '{ESC}', escape: '{ESC}', borrar: '{BACKSPACE}', backspace: '{BACKSPACE}', suprimir: '{DELETE}', delete: '{DELETE}',
  arriba: '{UP}', abajo: '{DOWN}', izquierda: '{LEFT}', derecha: '{RIGHT}', inicio: '{HOME}', fin: '{END}', 'repag': '{PGUP}', 'avpag': '{PGDN}', espacio: ' ', f1: '{F1}', f2: '{F2}', f3: '{F3}', f4: '{F4}', f5: '{F5}', f6: '{F6}', f7: '{F7}', f8: '{F8}', f9: '{F9}', f10: '{F10}', f11: '{F11}', f12: '{F12}' };
/** «ctrl+shift+s» → «^+s» para SendKeys. null si no la entiendo. */
function teclasSendKeys(combo) {
  const partes = String(combo || '').toLowerCase().split(/\s*\+\s*/).filter(Boolean);
  if (!partes.length || partes.length > 4) return null;
  let mod = '';
  for (const p of partes.slice(0, -1)) { if (/^(ctrl|control)$/.test(p)) mod += '^'; else if (p === 'shift' || p === 'mayus') mod += '+'; else if (p === 'alt') mod += '%'; else return null; }
  const k = partes[partes.length - 1];
  if (TECLAS[k]) return mod + TECLAS[k];
  if (/^[a-z0-9]$/.test(k)) return mod + k;
  return null;
}
const escSend = (t) => String(t).replace(/[+^%~(){}[\]]/g, (c) => '{' + c + '}');
const psq = (t) => "'" + String(t).replace(/'/g, "''") + "'";
const WINAPI = `Add-Type -Namespace NQ -Name W -MemberDefinition '[DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y); [DllImport("user32.dll")] public static extern void mouse_event(int f,int dx,int dy,int d,int e); [DllImport("user32.dll")] public static extern bool GetCursorPos(out POINT p); [StructLayout(LayoutKind.Sequential)] public struct POINT{public int X;public int Y;}' -UsingNamespace System.Runtime.InteropServices;`;

function servidorPC(op) {
  op = op || {};
  const ps = op.ejecutarPS || ejecutarPowerShell;
  const dirCap = op.dirCapturas || path.join(os.tmpdir(), 'noviq-avatar-capturas');
  const sinWin = () => (WIN || op.forzarWindows ? null : { ok: false, error: 'Esto solo funciona en Windows.' });
  const T = [
    { name: 'pantalla_info', description: 'Tamaño de la pantalla, posición del ratón y ventana activa.', inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() {
        const e = sinWin(); if (e) return e;
        const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;${WINAPI}$s=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;$p=New-Object NQ.W+POINT;[NQ.W]::GetCursorPos([ref]$p)|Out-Null;"pantalla $($s.Width)x$($s.Height); ratón en $($p.X),$($p.Y)"`, 15000);
        return r.ok ? { ok: true, datos: r.salida.trim() } : { ok: false, error: r.error || 'falló' };
      } },
    { name: 'captura_pantalla', description: 'Toma una captura de la pantalla y la guarda como imagen PNG (devuelve la ruta). No se envía a ningún sitio.',
      inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() {
        const e = sinWin(); if (e) return e;
        fs.mkdirSync(dirCap, { recursive: true });
        const f = path.join(dirCap, 'pantalla_' + Date.now() + '.png');
        const r = await ps(`Add-Type -AssemblyName System.Windows.Forms,System.Drawing;$b=[System.Windows.Forms.Screen]::PrimaryScreen.Bounds;$bm=New-Object System.Drawing.Bitmap $b.Width,$b.Height;$g=[System.Drawing.Graphics]::FromImage($bm);$g.CopyFromScreen($b.Location,[System.Drawing.Point]::Empty,$b.Size);$bm.Save(${psq(f)},[System.Drawing.Imaging.ImageFormat]::Png);$g.Dispose();$bm.Dispose();"ok"`, 20000);
        try { for (const x of fs.readdirSync(dirCap)) { const p = path.join(dirCap, x); if (Date.now() - fs.statSync(p).mtimeMs > 3600000) fs.unlinkSync(p); } } catch (_) { /* limpieza */ }
        return r.ok ? { ok: true, datos: 'captura guardada en ' + f } : { ok: false, error: r.error || 'no pude capturar' };
      } },
    { name: 'ventanas', description: 'Lista las ventanas abiertas (título y programa).', inputSchema: { type: 'object', properties: {} }, riesgo: 'leer',
      async run() {
        const e = sinWin(); if (e) return e;
        const r = await ps('Get-Process | Where-Object {$_.MainWindowTitle} | Select-Object Name,Id,MainWindowTitle | Format-Table -AutoSize | Out-String -Width 200', 15000);
        return r.ok ? { ok: true, datos: tope(r.salida.trim(), 4000) || 'ninguna' } : { ok: false, error: r.error };
      } },
    { name: 'enfocar_ventana', description: 'Trae al frente una ventana por parte de su título.', inputSchema: { type: 'object', properties: { titulo: S('parte del título') }, required: ['titulo'] }, riesgo: 'accion',
      async run(a) {
        const e = sinWin(); if (e) return e;
        const r = await ps(`Add-Type -AssemblyName Microsoft.VisualBasic;try{[Microsoft.VisualBasic.Interaction]::AppActivate(${psq(String(a.titulo).slice(0, 120))});"ok"}catch{"no encontré esa ventana"}`, 15000);
        return { ok: /ok/.test(r.salida), datos: r.salida.trim(), error: /ok/.test(r.salida) ? undefined : r.salida.trim() || r.error };
      } },
    { name: 'mover_raton', description: 'Mueve el cursor del ratón a una posición de la pantalla (x, y en píxeles).', inputSchema: { type: 'object', properties: { x: N('x'), y: N('y') }, required: ['x', 'y'] }, riesgo: 'accion',
      async run(a) {
        const e = sinWin(); if (e) return e;
        const x = Math.round(Number(a.x)), y = Math.round(Number(a.y));
        if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) return { ok: false, error: 'posición no válida' };
        const r = await ps(`${WINAPI}[NQ.W]::SetCursorPos(${x},${y})|Out-Null;"ok"`, 15000);
        return r.ok ? { ok: true, datos: `ratón en ${x},${y}` } : { ok: false, error: r.error };
      } },
    { name: 'clic', description: 'Hace clic con el ratón en una posición (boton: izquierdo|derecho; dobles=true para doble clic).',
      inputSchema: { type: 'object', properties: { x: N('x'), y: N('y'), boton: S('izquierdo | derecho'), dobles: { type: 'boolean' } }, required: ['x', 'y'] }, riesgo: 'accion',
      async run(a) {
        const e = sinWin(); if (e) return e;
        const x = Math.round(Number(a.x)), y = Math.round(Number(a.y));
        if (!isFinite(x) || !isFinite(y) || x < 0 || y < 0 || x > 20000 || y > 20000) return { ok: false, error: 'posición no válida' };
        const der = /der|right/i.test(String(a.boton || ''));
        const [d, u] = der ? [8, 16] : [2, 4];
        const veces = a.dobles ? 2 : 1;
        const r = await ps(`${WINAPI}[NQ.W]::SetCursorPos(${x},${y})|Out-Null;Start-Sleep -Milliseconds 80;1..${veces}|ForEach-Object{[NQ.W]::mouse_event(${d},0,0,0,0);[NQ.W]::mouse_event(${u},0,0,0,0);Start-Sleep -Milliseconds 60};"ok"`, 15000);
        return r.ok ? { ok: true, datos: `clic ${der ? 'derecho' : 'izquierdo'}${a.dobles ? ' doble' : ''} en ${x},${y}` } : { ok: false, error: r.error };
      } },
    { name: 'escribir_texto', description: 'Escribe un texto con el teclado en la ventana activa (nunca claves ni contraseñas).',
      inputSchema: { type: 'object', properties: { texto: S('texto a escribir') }, required: ['texto'] }, riesgo: 'accion',
      async run(a) {
        const e = sinWin(); if (e) return e;
        const t = String(a.texto || '');
        if (!t || t.length > 2000) return { ok: false, error: 'texto vacío o demasiado largo' };
        if (esSecreto(t)) return { ok: false, error: 'eso parece una clave o contraseña: no la escribo' };
        const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;Start-Sleep -Milliseconds 150;[System.Windows.Forms.SendKeys]::SendWait(${psq(escSend(t))});"ok"`, 30000);
        return r.ok ? { ok: true, datos: 'escrito' } : { ok: false, error: r.error };
      } },
    { name: 'tecla', description: 'Pulsa una tecla o combinación en la ventana activa (ej. «enter», «ctrl+c», «alt+tab» no, «ctrl+shift+s», «f5»).',
      inputSchema: { type: 'object', properties: { combinacion: S('ej. ctrl+s') }, required: ['combinacion'] }, riesgo: 'accion',
      async run(a) {
        const e = sinWin(); if (e) return e;
        const k = teclasSendKeys(a.combinacion);
        if (!k) return { ok: false, error: 'no entiendo la combinación «' + String(a.combinacion).slice(0, 30) + '»' };
        const r = await ps(`Add-Type -AssemblyName System.Windows.Forms;Start-Sleep -Milliseconds 120;[System.Windows.Forms.SendKeys]::SendWait(${psq(k)});"ok"`, 15000);
        return r.ok ? { ok: true, datos: 'pulsé ' + a.combinacion } : { ok: false, error: r.error };
      } }
  ];
  return construir('pc', 'Control del PC (pantalla, ratón, teclado)', 'Maneja el escritorio: captura de pantalla, ventanas, ratón y teclado', T);
}

/* ------------------------------------------------------------ Armado */
function construir(id, nombre, bot, T) {
  const lista = () => T.map((t) => ({ name: t.name, description: t.description, inputSchema: t.inputSchema, riesgo: t.riesgo || 'accion' }));
  return {
    id, nombre, bot, interno: true,
    herramientas: lista,
    /** Riesgo de ESTA llamada (powershell/cmd lo deducen del comando). {bloqueado, motivo} | {riesgo} */
    riesgoDeLlamada(nombreTool, args) {
      const t = T.find((x) => x.name === nombreTool);
      if (!t) return { riesgo: 'accion' };
      return t.riesgoDe ? t.riesgoDe(args || {}) : { riesgo: t.riesgo || 'accion' };
    },
    async llamar(nombreTool, args) {
      const t = T.find((x) => x.name === nombreTool);
      if (!t) return { ok: false, error: 'no existe la herramienta «' + nombreTool + '»' };
      if (t.riesgoDe) { const c = t.riesgoDe(args || {}); if (c.bloqueado) return { ok: false, error: 'Bloqueado por seguridad: ' + c.motivo + '.', bloqueado: true }; }
      try { return await t.run(args || {}); } catch (e) { return { ok: false, error: String(e.message || e).slice(0, 300) }; }
    }
  };
}

module.exports = { servidorWindows, servidorPC, clasificarComando, rutaSegura, teclasSendKeys, ejecutarPowerShell, ejecutarCmd, ejecutarProceso, diagnosticoPS, psCargar, PS, RUN_PS, SECRETOS_ARCHIVO };
