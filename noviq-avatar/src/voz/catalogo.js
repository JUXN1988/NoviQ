'use strict';
/* ==========================================================================
   Noviq Avatar — Catálogo de voces (hombre y mujer, sobre todo latinas)
   ========================================================================== */
const BANDERAS = { EC: '🇪🇨', MX: '🇲🇽', CO: '🇨🇴', AR: '🇦🇷', PE: '🇵🇪', CL: '🇨🇱', VE: '🇻🇪', US: '🇺🇸', BO: '🇧🇴', UY: '🇺🇾', PY: '🇵🇾',
  CR: '🇨🇷', PA: '🇵🇦', DO: '🇩🇴', CU: '🇨🇺', PR: '🇵🇷', SV: '🇸🇻', NI: '🇳🇮', GT: '🇬🇹', HN: '🇭🇳', ES: '🇪🇸', GQ: '🇬🇶', GB: '🇬🇧' };
const PAISES = { EC: 'Ecuador', MX: 'México', CO: 'Colombia', AR: 'Argentina', PE: 'Perú', CL: 'Chile', VE: 'Venezuela', US: 'Latina (EE. UU.)',
  BO: 'Bolivia', UY: 'Uruguay', PY: 'Paraguay', CR: 'Costa Rica', PA: 'Panamá', DO: 'Rep. Dominicana', CU: 'Cuba', PR: 'Puerto Rico',
  SV: 'El Salvador', NI: 'Nicaragua', GT: 'Guatemala', HN: 'Honduras', ES: 'España', GQ: 'Guinea Ecuatorial', GB: 'Reino Unido' };
const NO_LATINOS = new Set(['ES', 'GQ', 'GB']);
const ACENTO = { Salome: 'Salomé', Tomas: 'Tomás', Sebastian: 'Sebastián', Sofia: 'Sofía', Maria: 'María', Victor: 'Víctor', Alvaro: 'Álvaro', Ramon: 'Ramón' };
const MS = [['EC', 'Andrea', 'F'], ['EC', 'Luis', 'M'], ['MX', 'Dalia', 'F'], ['MX', 'Jorge', 'M'], ['CO', 'Salome', 'F'], ['CO', 'Gonzalo', 'M'],
  ['AR', 'Elena', 'F'], ['AR', 'Tomas', 'M'], ['PE', 'Camila', 'F'], ['PE', 'Alex', 'M'], ['CL', 'Catalina', 'F'], ['CL', 'Lorenzo', 'M'],
  ['VE', 'Paola', 'F'], ['VE', 'Sebastian', 'M'], ['US', 'Paloma', 'F'], ['US', 'Alonso', 'M'], ['BO', 'Sofia', 'F'], ['BO', 'Marcelo', 'M'],
  ['UY', 'Valentina', 'F'], ['UY', 'Mateo', 'M'], ['PY', 'Tania', 'F'], ['PY', 'Mario', 'M'], ['CR', 'Maria', 'F'], ['CR', 'Juan', 'M'],
  ['PA', 'Margarita', 'F'], ['PA', 'Roberto', 'M'], ['DO', 'Ramona', 'F'], ['DO', 'Emilio', 'M'], ['CU', 'Belkys', 'F'], ['CU', 'Manuel', 'M'],
  ['PR', 'Karina', 'F'], ['PR', 'Victor', 'M'], ['SV', 'Lorena', 'F'], ['SV', 'Rodrigo', 'M'], ['NI', 'Yolanda', 'F'], ['NI', 'Federico', 'M'],
  ['GT', 'Marta', 'F'], ['GT', 'Andres', 'M'], ['HN', 'Karla', 'F'], ['HN', 'Carlos', 'M'], ['ES', 'Elvira', 'F'], ['ES', 'Alvaro', 'M']];
const NV = [['Magpie-Multilingual.ES-US.Isabela', 'Isabela', 'F', 'US', 'es'], ['Magpie-Multilingual.ES-US.Diego', 'Diego', 'M', 'US', 'es'],
  ['Magpie-Multilingual.EN-US.Aria', 'Aria', 'F', 'US', 'en'], ['Magpie-Multilingual.EN-US.Jason', 'Jason', 'M', 'US', 'en']];

function deco(v) {
  const p = v.pais || '';
  return Object.assign({ bandera: BANDERAS[p] || '🌎', paisNombre: PAISES[p] || p, latina: !!p && !NO_LATINOS.has(p) && (v.idioma || 'es') === 'es' }, v);
}
function vocesMicrosoft(oficiales) {
  if (oficiales && oficiales.length) {
    return oficiales.map((v) => {
      const loc = v.Locale || '';
      let nom = String(v.ShortName || '').split('-').slice(2).join('-').replace(/(Multilingual)?Neural$/, '');
      return deco({ motor: 'microsoft', id: v.ShortName, nombre: ACENTO[nom] || nom, genero: v.Gender === 'Female' ? 'F' : 'M', pais: loc.split('-').pop(), idioma: loc.slice(0, 2) });
    });
  }
  return MS.map(([p, n, g]) => deco({ motor: 'microsoft', id: `es-${p}-${n}Neural`, nombre: ACENTO[n] || n, genero: g, pais: p, idioma: 'es' }))
    .concat([deco({ motor: 'microsoft', id: 'en-US-AvaNeural', nombre: 'Ava', genero: 'F', pais: 'US', idioma: 'en' }),
      deco({ motor: 'microsoft', id: 'en-US-AndrewNeural', nombre: 'Andrew', genero: 'M', pais: 'US', idioma: 'en' })]);
}
const vocesNvidia = () => NV.map(([id, n, g, p, i]) => deco({ motor: 'nvidia', id, nombre: n, genero: g, pais: p, idioma: i }));

/** Género de una voz (para elegir una parecida si su motor falla). */
function generoDe(motor, id) {
  const todas = vocesMicrosoft().concat(vocesNvidia());
  const v = todas.find((x) => x.id === id);
  return v ? v.genero : 'M';
}
function parecida(motor, genero) {
  if (motor === 'microsoft') return genero === 'F' ? 'es-EC-AndreaNeural' : 'es-EC-LuisNeural';
  if (motor === 'nvidia') return genero === 'F' ? 'Magpie-Multilingual.ES-US.Isabela' : 'Magpie-Multilingual.ES-US.Diego';
  return '';
}

module.exports = { vocesMicrosoft, vocesNvidia, generoDe, parecida, BANDERAS, PAISES };
