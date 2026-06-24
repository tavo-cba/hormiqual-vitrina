/**
 * [VITRINA] seed-parametricas-diseno.js — paramétricos que el motor de dosificación
 * necesita para CALCULAR en vivo (Diseñador /calidad/dosificacion-diseno).
 *
 * Origen de los datos (NO inventados):
 *   - AbacoCurvaICPA  ← domain/dosificacion/abacoIcpaDefaults.generarFilasDefault() (408 filas)
 *   - CurvaAguaAsentamiento / CurvaACResistencia / AireEsperado / DurabilidadExposicion /
 *     AireDurabilidad / PulverulentoMinimo ← scripts/data/parametricas-diseno.js
 *     (extraídos VERBATIM de migraciones de producción 20260308/20260310/20260314/20260507)
 *   - Consistencia ← 6 clases CIRSOC 200:2024 T.4.1/4.2. Rangos de asentamiento (mm) tomados de
 *     frontend lib/normativa/consistenciaCirsoc.js (fuente versionada). VER NOTA al pie.
 *
 * Idempotente por tabla: si la tabla ya tiene filas, NO inserta (no duplica).
 * Usa db.Model.bulkCreate (filtra columnas no presentes en el modelo, p.ej. conIncorporadorPct).
 *
 * Requiere esquema creado (init-schema). NO siembra materiales (esos van por UI).
 *
 * Uso:  cd backend && node scripts/seed-parametricas-diseno.js
 */
require('dotenv').config();
const { createDbConnection } = require('../src/models');
const { generarFilasDefault } = require('../src/domain/dosificacion/abacoIcpaDefaults');
const P = require('./data/parametricas-diseno');

const TENANT = process.env.DEV_TENANT || 'vitrina';

// ── Consistencia: 6 clases CIRSOC 200:2024 (T.4.1/4.2) ──────────────────────
// Valores REALES extraídos de la base de desarrollo del usuario (hormiqual_demo),
// que los tiene cargados desde la norma. Unidades: asentamiento y extendido en CM;
// remoldeo en SEGUNDOS (Vebe). Esquema idéntico al modelo de la vitrina.
const CONSISTENCIA = [
  { codigo: 'muy_seca',     nombre: 'Muy seca',     orden: 1, permiteRemoldeo: true,  permiteAsentamiento: false, permiteExtendido: false, metodoDefecto: 'remoldeo',     remoldeoMin: 5.0, remoldeoMax: 30.0, remoldeoTolerancia: 2.0, asentamientoMin: null, asentamientoMax: null, asentamientoTolerancia: null, extendidoMin: null, extendidoMax: null, extendidoTolerancia: null, requiereSuperplastificante: false, recomiendaFluidificante: false },
  { codigo: 'seca',         nombre: 'Seca',         orden: 2, permiteRemoldeo: true,  permiteAsentamiento: true,  permiteExtendido: false, metodoDefecto: 'asentamiento', remoldeoMin: 3.0, remoldeoMax: 8.0,  remoldeoTolerancia: 1.0, asentamientoMin: 2.0,  asentamientoMax: 5.0,  asentamientoTolerancia: 1.0,  extendidoMin: null, extendidoMax: null, extendidoTolerancia: null, requiereSuperplastificante: false, recomiendaFluidificante: false },
  { codigo: 'plastica',     nombre: 'Plástica',     orden: 3, permiteRemoldeo: false, permiteAsentamiento: true,  permiteExtendido: false, metodoDefecto: 'asentamiento', remoldeoMin: null, remoldeoMax: null, remoldeoTolerancia: null, asentamientoMin: 5.0,  asentamientoMax: 10.0, asentamientoTolerancia: 2.0,  extendidoMin: null, extendidoMax: null, extendidoTolerancia: null, requiereSuperplastificante: false, recomiendaFluidificante: false },
  { codigo: 'muy_plastica', nombre: 'Muy plástica', orden: 4, permiteRemoldeo: false, permiteAsentamiento: true,  permiteExtendido: true,  metodoDefecto: 'asentamiento', remoldeoMin: null, remoldeoMax: null, remoldeoTolerancia: null, asentamientoMin: 10.0, asentamientoMax: 15.0, asentamientoTolerancia: 2.0,  extendidoMin: 50.0, extendidoMax: 55.0, extendidoTolerancia: 1.0,  requiereSuperplastificante: false, recomiendaFluidificante: true  },
  { codigo: 'fluida',       nombre: 'Fluida',       orden: 5, permiteRemoldeo: false, permiteAsentamiento: true,  permiteExtendido: true,  metodoDefecto: 'asentamiento', remoldeoMin: null, remoldeoMax: null, remoldeoTolerancia: null, asentamientoMin: 15.0, asentamientoMax: 18.0, asentamientoTolerancia: 3.0,  extendidoMin: 55.0, extendidoMax: 60.0, extendidoTolerancia: 1.0,  requiereSuperplastificante: true,  recomiendaFluidificante: false },
  { codigo: 'muy_fluida',   nombre: 'Muy fluida',   orden: 6, permiteRemoldeo: false, permiteAsentamiento: false, permiteExtendido: true,  metodoDefecto: 'extendido',    remoldeoMin: null, remoldeoMax: null, remoldeoTolerancia: null, asentamientoMin: null, asentamientoMax: null, asentamientoTolerancia: null, extendidoMin: 60.0, extendidoMax: 65.0, extendidoTolerancia: 2.0,  requiereSuperplastificante: true,  recomiendaFluidificante: false },
];

// ── Catálogos lookup mínimos para poder seleccionar en el Diseñador ─────────
// TamanioMaximoNominal: NOT NULL = tamanio (FLOAT, unique).
const TMN = [9.5, 12.5, 13.2, 19, 25, 37.5, 53].map(t => ({ tamanio: t }));
// TipoHormigon: NOT NULL = tipoHormigon. Escala IRAM 1666 / CIRSOC 200 (clases comunes).
const TIPO_HORMIGON = [8, 13, 17, 21, 25, 30, 35, 40, 45, 50].map(n => ({ tipoHormigon: `H-${n}` }));
// TipologiaHormigon: NOT NULL = codigo, nombre. (curvaFamilia/curvaExponente tienen default).
// NOTA: tipologías mínimas para seleccionar; el usuario puede ajustar curvaFamilia/exponente.
const TIPOLOGIA = [
  { codigo: 'ESTRUCTURAL', nombre: 'Estructural (general)' },
  { codigo: 'BOMBEABLE',   nombre: 'Bombeable' },
];

// MaterialTipo: define las PESTAÑAS del catálogo unificado de Materiales.
// IDs semánticos (el form de adiciones usa idMaterialTipo=4) → se respetan los
// mismos ids que producción. Idempotente por idMaterialTipo (no pisa Agua=6).
// UnidadMedida: unidades para aditivos/adiciones (form de aditivo las pide al cargar).
// Valores REALES de hormiqual_demo (solo lectura). Idempotente por idUnidadMedida.
const UNIDAD_MEDIDA = [
  { idUnidadMedida: 1, unidad: 'grs',      descripcion: 'Gramos' },
  { idUnidadMedida: 2, unidad: 'Kg',       descripcion: 'Kilogramos' },
  { idUnidadMedida: 3, unidad: 'Lts',      descripcion: 'Litros' },
  { idUnidadMedida: 4, unidad: 'cm3',      descripcion: 'Centímetros cúbicos' },
  { idUnidadMedida: 5, unidad: 'm3',       descripcion: 'Metros cúbicos' },
  { idUnidadMedida: 6, unidad: 'unidades', descripcion: 'Unidades' },
  { idUnidadMedida: 7, unidad: 'horas',    descripcion: 'Horas' },
  { idUnidadMedida: 8, unidad: 'lote',     descripcion: 'Lote' },
];

// TipoProbeta + ModalidadMuestra: catálogos que habilitan la carga de probetas
// en el form de Muestras. Valores REALES de hormiqual_demo (solo lectura).
// Idempotente por id. Estos endpoints SE CACHEAN → reiniciar backend tras sembrar.
const TIPO_PROBETA = [
  { idTipoProbeta: 1, tipo: '10x20', descripcion: 'Probeta cilíndrica estándar de 10 cm de diámetro y 20 cm de altura' },
  { idTipoProbeta: 2, tipo: '15x30', descripcion: 'Probeta cilíndrica estándar de 15 cm de diámetro y 30 cm de altura' },
  { idTipoProbeta: 3, tipo: 'Otra',  descripcion: 'Probetas de dimensiones personalizadas' },
];
const MODALIDAD_MUESTRA = [
  { idModalidadMuestra: 1, modalidad: 'En planta', descripcion: 'Muestra tomada en la planta de hormigón.' },
  { idModalidadMuestra: 2, modalidad: 'En obra',   descripcion: 'Muestra tomada directamente en la obra.' },
  { idModalidadMuestra: 3, modalidad: 'Remota',    descripcion: 'Muestra cargada de forma remota.' },
];
// EstadoProbeta: estados del ciclo de vida de la probeta. El service de muestras
// asigna idEstadoProbeta (1=Curando / 2=Pendiente) al crear probetas → sin esta
// tabla, la FK probeta_ibfk_6 falla y "Error al guardar". Valores REALES de demo.
const ESTADO_PROBETA = [
  { idEstadoProbeta: 1, estado: 'Curando',    descripcion: 'En cámara de curado, a la espera de ensayo' },
  { idEstadoProbeta: 2, estado: 'Pendiente',  descripcion: 'Ya cumplida la fecha de ensayo, a la espera de ensayo' },
  { idEstadoProbeta: 3, estado: 'Ensayada',   descripcion: 'Probeta ya ensayada' },
  { idEstadoProbeta: 4, estado: 'Descartada', descripcion: 'Probeta descartada por problemas de confección' },
  { idEstadoProbeta: 5, estado: 'Perdida',    descripcion: 'Probeta perdida en el proceso' },
];

const MATERIAL_TIPO = [
  { idMaterialTipo: 1, nombre: 'Agregados', descripcion: 'Agregados finos y gruesos',       icono: 'fa-solid fa-mountain',     orden: 1  },
  { idMaterialTipo: 2, nombre: 'Cementos',  descripcion: 'Cementos portland y especiales',  icono: 'fa-solid fa-industry',     orden: 2  },
  { idMaterialTipo: 3, nombre: 'Aditivos',  descripcion: 'Aditivos químicos',               icono: 'fa-solid fa-flask',        orden: 3  },
  { idMaterialTipo: 4, nombre: 'Adiciones', descripcion: 'Adiciones minerales',             icono: 'fa-solid fa-gem',          orden: 4  },
  { idMaterialTipo: 5, nombre: 'Fibras',    descripcion: 'Fibras de refuerzo',              icono: 'fa-solid fa-grip-lines',   orden: 5  },
  { idMaterialTipo: 6, nombre: 'Agua',      descripcion: 'Agua de amasado y curado',        icono: 'fa-solid fa-droplet',      orden: 6  },
  { idMaterialTipo: 7, nombre: 'Liviano',   descripcion: 'Agregados livianos manufacturados (fuera de CIRSOC 200, sólo Hormigón Alivianado).', icono: 'fa-solid fa-circle-nodes', orden: 90 },
];

async function seedTabla(db, modelName, rows, etiqueta) {
  const Model = db[modelName];
  if (!Model) { console.log(`  [skip] modelo ${modelName} no registrado`); return; }
  const n = await Model.count();
  if (n > 0) { console.log(`  [skip] ${etiqueta}: ya tenía ${n} fila(s), no se toca`); return; }
  await Model.bulkCreate(rows);  // bulkCreate filtra columnas no definidas en el modelo
  console.log(`  [+]    ${etiqueta}: ${rows.length} fila(s) insertada(s)`);
}

(async () => {
  const db = await createDbConnection(TENANT);
  console.log(`[seed-parametricas] tenant="${TENANT}" — sembrando paramétricos del Diseñador...`);

  // (a) Ábaco ICPA (agua base) — 408 filas desde el default de código
  await seedTabla(db, 'AbacoCurvaICPA', generarFilasDefault(), 'AbacoCurvaICPA (Ábaco 1 ICPA)');

  // (b) Curvas agua/asentamiento y a/c-resistencia (ACI + ICPA)
  await seedTabla(db, 'CurvaAguaAsentamiento', [...P.curvaAguaACI, ...P.curvaAguaICPA], 'CurvaAguaAsentamiento (ACI+ICPA)');
  await seedTabla(db, 'CurvaACResistencia',    [...P.curvaACACI, ...P.curvaACICPA],     'CurvaACResistencia (ACI+ICPA)');
  await seedTabla(db, 'AireEsperado',          P.aireEsperado,                          'AireEsperado');

  // (c) Durabilidad CIRSOC T.2.5 (14 clases, fcmin ya corregido en la fuente)
  await seedTabla(db, 'DurabilidadExposicion', P.durabilidad,                           'DurabilidadExposicion (T.2.5)');

  // (d) CIRSOC T.4.3 / T.4.4
  await seedTabla(db, 'AireDurabilidad',       P.aireDurabilidad,                       'AireDurabilidad (T.4.3)');
  await seedTabla(db, 'PulverulentoMinimo',    P.pulverulento,                          'PulverulentoMinimo (T.4.4)');

  // (e) Consistencia (T.4.1/4.2) — 6 clases
  await seedTabla(db, 'Consistencia', CONSISTENCIA, 'Consistencia (T.4.1/4.2)');

  // Catálogos lookup mínimos
  await seedTabla(db, 'TamanioMaximoNominal', TMN,            'TamanioMaximoNominal');
  await seedTabla(db, 'TipoHormigon',         TIPO_HORMIGON,  'TipoHormigon (H-N)');
  await seedTabla(db, 'TipologiaHormigon',    TIPOLOGIA,      'TipologiaHormigon');

  // TipoProbeta + ModalidadMuestra: idempotente POR ID (habilitan carga de probetas)
  if (db.TipoProbeta) {
    let creados = 0;
    for (const tp of TIPO_PROBETA) {
      const [, created] = await db.TipoProbeta.findOrCreate({ where: { idTipoProbeta: tp.idTipoProbeta }, defaults: tp });
      if (created) creados++;
    }
    console.log(`  [+]    TipoProbeta: ${creados} fila(s) nueva(s)`);
  }
  if (db.ModalidadMuestra) {
    let creados = 0;
    for (const mm of MODALIDAD_MUESTRA) {
      const [, created] = await db.ModalidadMuestra.findOrCreate({ where: { idModalidadMuestra: mm.idModalidadMuestra }, defaults: mm });
      if (created) creados++;
    }
    console.log(`  [+]    ModalidadMuestra: ${creados} fila(s) nueva(s)`);
  }
  if (db.EstadoProbeta) {
    let creados = 0;
    for (const ep of ESTADO_PROBETA) {
      const [, created] = await db.EstadoProbeta.findOrCreate({ where: { idEstadoProbeta: ep.idEstadoProbeta }, defaults: ep });
      if (created) creados++;
    }
    console.log(`  [+]    EstadoProbeta: ${creados} fila(s) nueva(s)`);
  }

  // UnidadMedida: idempotente POR ID (form de aditivo / adiciones)
  if (db.UnidadMedida) {
    let creados = 0;
    for (const um of UNIDAD_MEDIDA) {
      const [, created] = await db.UnidadMedida.findOrCreate({
        where: { idUnidadMedida: um.idUnidadMedida },
        defaults: um,
      });
      if (created) creados++;
    }
    console.log(`  [+]    UnidadMedida (aditivos/adiciones): ${creados} fila(s) nueva(s)`);
  }

  // MaterialTipo: idempotente POR ID (la tabla ya tiene Agua=6; insertamos los faltantes)
  if (db.MaterialTipo) {
    let creados = 0;
    for (const mt of MATERIAL_TIPO) {
      const [, created] = await db.MaterialTipo.findOrCreate({
        where: { idMaterialTipo: mt.idMaterialTipo },
        defaults: mt,
      });
      if (created) creados++;
    }
    console.log(`  [+]    MaterialTipo (pestañas del catálogo): ${creados} fila(s) nueva(s)`);
  }

  console.log('[seed-parametricas] Listo. Materiales (cemento/agregados/mezcla) se cargan por UI.');
  process.exit(0);
})().catch((e) => {
  console.error('[seed-parametricas] ERROR:', e);
  process.exit(1);
});
