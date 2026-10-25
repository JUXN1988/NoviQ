'use strict';
/* ==========================================================================
   Noviq Avatar — 📄 Documentos de Word (.docx) SIN dependencias
   Un .docx es un ZIP con XML. Aquí se escribe y se lee directamente:
     · crear(ruta, {titulo, contenido})  ← contenido en Markdown sencillo:
         # Título · ## Sección · ### Subsección · párrafos · - viñetas ·
         1. listas numeradas · **negrita** · *cursiva* · [texto](url) ·
         > cita · tablas | a | b | · --- (salto de página)
     · texto(ruta) → el texto plano del documento (para resumirlo o buscar)
   Usa los estilos que Word ya conoce (Título, Título 1…, Lista con viñetas),
   así el documento se ve bien y el índice automático de Word funciona.
   ========================================================================== */
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

/* ------------------------------------------------------------------ ZIP */
const TABLA_CRC = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; }
  return t;
})();
function crc32(buf) {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) c = TABLA_CRC[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}
function fechaDOS(d) {
  const hora = (d.getHours() << 11) | (d.getMinutes() << 5) | Math.floor(d.getSeconds() / 2);
  const dia = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  return { hora, dia };
}
/** archivos: [{nombre, datos (Buffer|string)}] → Buffer del ZIP */
function zip(archivos) {
  const locales = [], centrales = [];
  let offset = 0;
  const { hora, dia } = fechaDOS(new Date());
  for (const a of archivos) {
    const nombre = Buffer.from(a.nombre, 'utf8');
    const datos = Buffer.isBuffer(a.datos) ? a.datos : Buffer.from(String(a.datos), 'utf8');
    const comp = zlib.deflateRawSync(datos, { level: 9 });
    const usar = comp.length < datos.length ? comp : datos;
    const metodo = usar === comp ? 8 : 0;
    const crc = crc32(datos);
    const lh = Buffer.alloc(30);
    lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(0x0800, 6); lh.writeUInt16LE(metodo, 8);
    lh.writeUInt16LE(hora, 10); lh.writeUInt16LE(dia, 12); lh.writeUInt32LE(crc, 14); lh.writeUInt32LE(usar.length, 18);
    lh.writeUInt32LE(datos.length, 22); lh.writeUInt16LE(nombre.length, 26); lh.writeUInt16LE(0, 28);
    locales.push(lh, nombre, usar);
    const ch = Buffer.alloc(46);
    ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(0x0800, 8); ch.writeUInt16LE(metodo, 10);
    ch.writeUInt16LE(hora, 12); ch.writeUInt16LE(dia, 14); ch.writeUInt32LE(crc, 16); ch.writeUInt32LE(usar.length, 20);
    ch.writeUInt32LE(datos.length, 24); ch.writeUInt16LE(nombre.length, 28); ch.writeUInt32LE(0, 30); ch.writeUInt32LE(0, 34);
    ch.writeUInt32LE(0, 38); ch.writeUInt32LE(offset, 42);
    centrales.push(ch, nombre);
    offset += 30 + nombre.length + usar.length;
  }
  const central = Buffer.concat(centrales);
  const fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(archivos.length, 8); fin.writeUInt16LE(archivos.length, 10);
  fin.writeUInt32LE(central.length, 12); fin.writeUInt32LE(offset, 16);
  return Buffer.concat(locales.concat([central, fin]));
}
/** Lee un ZIP → Map(nombre → Buffer) (solo «stored» y «deflate», que es lo que usan Word y LibreOffice). */
function unzip(buf) {
  let e = buf.length - 22;
  while (e >= 0 && buf.readUInt32LE(e) !== 0x06054b50) e--;
  if (e < 0) throw new Error('no es un archivo ZIP/DOCX válido');
  const n = buf.readUInt16LE(e + 10);
  let p = buf.readUInt32LE(e + 16);
  const out = new Map();
  for (let i = 0; i < n; i++) {
    if (buf.readUInt32LE(p) !== 0x02014b50) break;
    const metodo = buf.readUInt16LE(p + 10), tam = buf.readUInt32LE(p + 20);
    const ln = buf.readUInt16LE(p + 28), lx = buf.readUInt16LE(p + 30), lc = buf.readUInt16LE(p + 32), off = buf.readUInt32LE(p + 42);
    const nombre = buf.subarray(p + 46, p + 46 + ln).toString('utf8');
    const lnl = buf.readUInt16LE(off + 26), lxl = buf.readUInt16LE(off + 28);
    const datos = buf.subarray(off + 30 + lnl + lxl, off + 30 + lnl + lxl + tam);
    out.set(nombre, metodo === 8 ? zlib.inflateRawSync(datos) : metodo === 0 ? Buffer.from(datos) : null);
    p += 46 + ln + lx + lc;
  }
  return out;
}

/* ---------------------------------------------------------- Markdown → XML */
const esc = (t) => String(t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
  .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f￾￿]/g, '');

/** Texto con **negrita**, *cursiva*, `código` y [enlaces](url) → runs de Word. */
function runs(texto, ctx, base) {
  base = base || {};
  const out = [];
  const rx = /(\*\*([^*]+)\*\*|__([^_]+)__|\*([^*\s][^*]*)\*|_([^_\s][^_]*)_|`([^`]+)`|\[([^\]]+)\]\((https?:\/\/[^\s)]+)\))/g;
  let i = 0, m;
  const run = (t, f) => {
    if (!t) return;
    const pr = [];
    if (f.b) pr.push('<w:b/><w:bCs/>');
    if (f.i) pr.push('<w:i/><w:iCs/>');
    if (f.code) pr.push('<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:cs="Consolas"/><w:shd w:val="clear" w:color="auto" w:fill="F2F2F2"/>');
    if (f.link) pr.push('<w:rStyle w:val="Hipervinculo"/>');
    out.push(`<w:r>${pr.length ? '<w:rPr>' + pr.join('') + '</w:rPr>' : ''}<w:t xml:space="preserve">${esc(t)}</w:t></w:r>`);
  };
  while ((m = rx.exec(texto))) {
    run(texto.slice(i, m.index), base);
    if (m[2] || m[3]) run(m[2] || m[3], Object.assign({}, base, { b: true }));
    else if (m[4] || m[5]) run(m[4] || m[5], Object.assign({}, base, { i: true }));
    else if (m[6]) run(m[6], Object.assign({}, base, { code: true }));
    else if (m[7]) {
      const id = ctx.enlace(m[8]);
      const ini = out.length;
      run(m[7], Object.assign({}, base, { link: true }));
      out[ini] = `<w:hyperlink r:id="${id}" w:history="1">${out[ini]}</w:hyperlink>`;
    }
    i = m.index + m[0].length;
  }
  run(texto.slice(i), base);
  return out.join('');
}
const parrafo = (estilo, contenido, extra) => `<w:p>${estilo || extra ? '<w:pPr>' + (estilo ? `<w:pStyle w:val="${estilo}"/>` : '') + (extra || '') + '</w:pPr>' : ''}${contenido}</w:p>`;

function tabla(filas, ctx) {
  const anchoCol = Math.floor(9000 / Math.max(1, filas[0].length));
  const xml = ['<w:tbl><w:tblPr><w:tblStyle w:val="TablaNoviq"/><w:tblW w:w="5000" w:type="pct"/><w:tblLook w:val="04A0" w:firstRow="1" w:lastRow="0" w:firstColumn="0" w:lastColumn="0" w:noHBand="0" w:noVBand="1"/></w:tblPr><w:tblGrid>'];
  for (let c = 0; c < filas[0].length; c++) xml.push(`<w:gridCol w:w="${anchoCol}"/>`);
  xml.push('</w:tblGrid>');
  filas.forEach((f, i) => {
    xml.push('<w:tr>' + (i === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''));
    for (let c = 0; c < filas[0].length; c++) {
      xml.push(`<w:tc><w:tcPr><w:tcW w:w="${anchoCol}" w:type="dxa"/>${i === 0 ? '<w:shd w:val="clear" w:color="auto" w:fill="D9E2F3"/>' : ''}</w:tcPr>` +
        parrafo('', runs(String(f[c] == null ? '' : f[c]).trim(), ctx, i === 0 ? { b: true } : {})) + '</w:tc>');
    }
    xml.push('</w:tr>');
  });
  xml.push('</w:tbl>');
  return xml.join('') + parrafo('', '');
}

/** Markdown sencillo → {cuerpo XML, enlaces, numeraciones} */
function cuerpoDesdeMarkdown(md, titulo) {
  const enlaces = [];
  const ctx = { enlace: (url) => { let i = enlaces.indexOf(url); if (i < 0) { enlaces.push(url); i = enlaces.length - 1; } return 'rIdLink' + (i + 1); } };
  const listasNum = [];   // cada lista numerada reinicia su numeración
  const xml = [];
  const lineas = String(md || '').replace(/\r\n?/g, '\n').split('\n');
  let tituloPuesto = false, parrafoAcum = [], numActual = 0;
  const vaciar = () => { if (parrafoAcum.length) { xml.push(parrafo('', runs(parrafoAcum.join(' '), ctx))); parrafoAcum = []; } };
  if (titulo && !/^\s*#\s+/.test(lineas.find((l) => l.trim()) || '')) { xml.push(parrafo('Titulo', runs(titulo, ctx))); tituloPuesto = true; }
  for (let k = 0; k < lineas.length; k++) {
    const l = lineas[k];
    const t = l.trim();
    let m;
    if (!t) { vaciar(); numActual = 0; continue; }
    if (/^(-{3,}|\*{3,}|_{3,})$/.test(t)) { vaciar(); xml.push('<w:p><w:r><w:br w:type="page"/></w:r></w:p>'); continue; }
    if ((m = t.match(/^(#{1,6})\s+(.+?)\s*#*$/))) {
      vaciar(); numActual = 0;
      const nivel = m[1].length;
      if (nivel === 1 && !tituloPuesto) { xml.push(parrafo('Titulo', runs(m[2], ctx))); tituloPuesto = true; }
      else xml.push(parrafo('Titulo' + Math.min(3, nivel === 1 ? 1 : nivel - 1), runs(m[2], ctx)));
      continue;
    }
    if (/^\|.*\|$/.test(t)) {
      vaciar();
      const filas = [];
      while (k < lineas.length && /^\|.*\|$/.test(lineas[k].trim())) {
        const celdas = lineas[k].trim().replace(/^\||\|$/g, '').split('|').map((c) => c.trim());
        if (!celdas.every((c) => /^:?-{2,}:?$/.test(c))) filas.push(celdas);
        k++;
      }
      k--;
      const ancho = Math.max(...filas.map((f) => f.length));
      if (filas.length) xml.push(tabla(filas.map((f) => f.concat(Array(ancho - f.length).fill(''))), ctx));
      continue;
    }
    if ((m = l.match(/^(\s*)[-*•+]\s+(.+)$/))) {
      vaciar(); numActual = 0;
      const nivel = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
      xml.push(parrafo('Vinetas', runs(m[2], ctx), `<w:numPr><w:ilvl w:val="${nivel}"/><w:numId w:val="1"/></w:numPr>`));
      continue;
    }
    if ((m = l.match(/^(\s*)\d{1,3}[.)]\s+(.+)$/))) {
      vaciar();
      if (!numActual) { listasNum.push(listasNum.length + 2); numActual = listasNum[listasNum.length - 1]; }
      const nivel = Math.min(2, Math.floor(m[1].replace(/\t/g, '  ').length / 2));
      xml.push(parrafo('Numerada', runs(m[2], ctx), `<w:numPr><w:ilvl w:val="${nivel}"/><w:numId w:val="${numActual}"/></w:numPr>`));
      continue;
    }
    if ((m = t.match(/^>\s?(.*)$/))) { vaciar(); xml.push(parrafo('Cita', runs(m[1], ctx))); continue; }
    parrafoAcum.push(t);
  }
  vaciar();
  if (!xml.length) xml.push(parrafo('', ''));
  return { cuerpo: xml.join(''), enlaces, listasNum };
}

/* ------------------------------------------------------------- Partes */
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"';
const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:styles ${NS}>
<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Calibri" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="es-EC" w:eastAsia="es-EC" w:bidi="ar-SA"/></w:rPr></w:rPrDefault>
<w:pPrDefault><w:pPr><w:spacing w:after="160" w:line="276" w:lineRule="auto"/><w:jc w:val="both"/></w:pPr></w:pPrDefault></w:docDefaults>
<w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>
<w:style w:type="paragraph" w:styleId="Titulo"><w:name w:val="Title"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:spacing w:after="240"/><w:jc w:val="left"/><w:pBdr><w:bottom w:val="single" w:sz="8" w:space="4" w:color="2F5496"/></w:pBdr></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:color w:val="1F3864"/><w:kern w:val="28"/><w:sz w:val="48"/><w:szCs w:val="48"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titulo1"><w:name w:val="heading 1"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="320" w:after="120"/><w:jc w:val="left"/><w:outlineLvl w:val="0"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="2F5496"/><w:sz w:val="32"/><w:szCs w:val="32"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titulo2"><w:name w:val="heading 2"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="240" w:after="80"/><w:jc w:val="left"/><w:outlineLvl w:val="1"/></w:pPr><w:rPr><w:rFonts w:ascii="Calibri Light" w:hAnsi="Calibri Light"/><w:b/><w:color w:val="2F5496"/><w:sz w:val="26"/><w:szCs w:val="26"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Titulo3"><w:name w:val="heading 3"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/><w:qFormat/><w:pPr><w:keepNext/><w:spacing w:before="200" w:after="60"/><w:jc w:val="left"/><w:outlineLvl w:val="2"/></w:pPr><w:rPr><w:b/><w:color w:val="1F3864"/><w:sz w:val="24"/><w:szCs w:val="24"/></w:rPr></w:style>
<w:style w:type="paragraph" w:styleId="Vinetas"><w:name w:val="List Bullet"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Numerada"><w:name w:val="List Number"/><w:basedOn w:val="Normal"/><w:pPr><w:spacing w:after="60"/><w:jc w:val="left"/></w:pPr></w:style>
<w:style w:type="paragraph" w:styleId="Cita"><w:name w:val="Quote"/><w:basedOn w:val="Normal"/><w:pPr><w:ind w:left="567" w:right="567"/><w:jc w:val="left"/></w:pPr><w:rPr><w:i/><w:color w:val="404040"/></w:rPr></w:style>
<w:style w:type="character" w:styleId="Hipervinculo"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style>
<w:style w:type="table" w:styleId="TablaNoviq"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:left w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:right w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="A6A6A6"/></w:tblBorders><w:tblCellMar><w:left w:w="108" w:type="dxa"/><w:right w:w="108" w:type="dxa"/></w:tblCellMar></w:tblPr></w:style>
</w:styles>`;

function numeracion(listasNum) {
  const nivel = (i, fmt, txt, ind, fuente) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${txt}"/><w:lvlJc w:val="left"/>` +
    `<w:pPr><w:ind w:left="${ind}" w:hanging="360"/></w:pPr>${fuente ? `<w:rPr><w:rFonts w:ascii="${fuente}" w:hAnsi="${fuente}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
  let xml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
    '<w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>' +
    nivel(0, 'bullet', '\uF0B7', 720, 'Symbol') + nivel(1, 'bullet', 'o', 1080, 'Courier New') + nivel(2, 'bullet', '\uF0A7', 1440, 'Wingdings') + '</w:abstractNum>' +
    '<w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>' +
    nivel(0, 'decimal', '%1.', 720) + nivel(1, 'lowerLetter', '%2)', 1080) + nivel(2, 'lowerRoman', '%3.', 1440) + '</w:abstractNum>' +
    '<w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>';
  for (const id of listasNum) xml += `<w:num w:numId="${id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="1"/></w:lvlOverride></w:num>`;
  if (!listasNum.length) xml += '<w:num w:numId="2"><w:abstractNumId w:val="1"/></w:num>';
  return xml + '</w:numbering>';
}

/** Construye el .docx en memoria. op: {titulo, contenido (markdown), autor} → Buffer */
function construir(op) {
  op = op || {};
  const titulo = String(op.titulo || '').trim();
  const { cuerpo, enlaces, listasNum } = cuerpoDesdeMarkdown(op.contenido || '', titulo);
  const ahoraISO = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const documento = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${cuerpo}` +
    '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1417" w:right="1418" w:bottom="1417" w:left="1418" w:header="708" w:footer="708" w:gutter="0"/></w:sectPr></w:body></w:document>';
  const rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rIdEstilos" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>' +
    '<Relationship Id="rIdNumeracion" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/>' +
    enlaces.map((u, i) => `<Relationship Id="rIdLink${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="${esc(u)}" TargetMode="External"/>`).join('') +
    '</Relationships>';
  const tipos = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
    '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>' +
    '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
    '<Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>' +
    '<Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>' +
    '<Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/>' +
    '<Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>';
  const raiz = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
    '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
    '<Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/>' +
    '<Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>';
  const core = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" ' +
    'xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">' +
    `<dc:title>${esc(titulo)}</dc:title><dc:creator>${esc(op.autor || 'Noviq')}</dc:creator><cp:lastModifiedBy>Noviq</cp:lastModifiedBy>` +
    `<dcterms:created xsi:type="dcterms:W3CDTF">${ahoraISO}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${ahoraISO}</dcterms:modified></cp:coreProperties>`;
  const app = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Noviq</Application></Properties>';
  return zip([
    { nombre: '[Content_Types].xml', datos: tipos }, { nombre: '_rels/.rels', datos: raiz },
    { nombre: 'word/document.xml', datos: documento }, { nombre: 'word/_rels/document.xml.rels', datos: rels },
    { nombre: 'word/styles.xml', datos: ESTILOS }, { nombre: 'word/numbering.xml', datos: numeracion(listasNum) },
    { nombre: 'docProps/core.xml', datos: core }, { nombre: 'docProps/app.xml', datos: app }
  ]);
}

/** Escribe el .docx en disco (escritura atómica). */
function crear(ruta, op) {
  const buf = construir(op);
  fs.mkdirSync(path.dirname(ruta), { recursive: true });
  const tmp = ruta + '.tmp' + process.pid;
  fs.writeFileSync(tmp, buf);
  fs.renameSync(tmp, ruta);
  return { ruta, bytes: buf.length };
}

/** Texto plano de un .docx (párrafos, viñetas y tablas). */
function texto(rutaOBuffer) {
  const buf = Buffer.isBuffer(rutaOBuffer) ? rutaOBuffer : fs.readFileSync(rutaOBuffer);
  const partes = unzip(buf);
  const doc = partes.get('word/document.xml');
  if (!doc) throw new Error('el archivo no tiene contenido de Word');
  const xml = doc.toString('utf8');
  const ent = (t) => t.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
  const parrafos = [];
  for (const p of xml.split(/<\/w:p>/)) {
    let t = '';
    const rx = /<w:t(?:\s[^>]*)?>([^<]*)<\/w:t>|<w:tab\/>|<w:br[^>]*\/>/g;
    let m;
    while ((m = rx.exec(p))) t += m[1] != null ? ent(m[1]) : m[0].startsWith('<w:tab') ? '\t' : '\n';
    if (/<w:numPr>/.test(p) && t.trim()) t = '• ' + t;
    if (t.trim()) parrafos.push(t);
  }
  return parrafos.join('\n');
}

module.exports = { crear, construir, texto, zip, unzip, crc32, cuerpoDesdeMarkdown };
