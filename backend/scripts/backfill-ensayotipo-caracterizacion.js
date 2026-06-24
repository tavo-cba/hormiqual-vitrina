/**
 * [VITRINA] backfill-ensayotipo-caracterizacion.js
 *
 * El seed `seed-ensayos-agregados.js` crea los 18 AgregadoEnsayoTipo de la vertical
 * Calidad pero SIN la metadata de caracterización (caractFields, nivelCaracterizacion*,
 * visibleEnCaracterizacion, etc.). En producción esa metadata la setean MIGRACIONES
 * (20260502d split-granulometria, y otras) que la base de desarrollo (hormiqual_demo)
 * ya acumuló.
 *
 * Sin esa metadata, `getCaracterizacion` NO extrae densidad/absorción/MF/TMN desde los
 * ensayos cargados (ver dosificacionDisenoService líneas ~903-934 + agregadoEnsayoService
 * líneas 2330/2333), y el motor de dosificación falla con "no tiene densidad".
 *
 * Este script copia las columnas de metadata desde hormiqual_demo (SOLO LECTURA) hacia
 * hormiqual_vitrina, emparejando por `codigo`. Caso especial: el código legacy
 * `IRAM1505_GRANULOMETRIA` (que en la vitrina no se dividió) toma su metadata del
 * equivalente `IRAM1505_GRANULOMETRIA_HORMIGON` de la demo.
 *
 * Idempotente: re-aplica los mismos valores. Escribe SOLO en hormiqual_vitrina.
 * La conexión a hormiqual_demo es exclusivamente SELECT.
 *
 * Uso:  cd backend && node scripts/backfill-ensayotipo-caracterizacion.js
 */
require('dotenv').config();
const mysql = require('mysql2/promise');

const DB_VITRINA = process.env.DATABASE_VITRINA || 'hormiqual_vitrina';
const DB_DEMO = 'hormiqual_demo'; // fuente de verdad (solo lectura)
const HOST = process.env.DB_HOST_VITRINA || '127.0.0.1';
const USER = process.env.DB_USERNAME_VITRINA || 'root';
const PASS = process.env.DB_PASSWORD_VITRINA || '';

// Columnas de metadata a sincronizar (NO se tocan id/codigo/nombre/descripcion).
const META_COLS = [
  'aplicaA', 'unidad', 'orden', 'categoria', 'resultadoSchema',
  'visibleEnDosificacion', 'visibleEnCards', 'visibleEnUI', 'schemaKey',
  'visibleEnCaracterizacion', 'caractFields',
  'aplicaATBS', 'aplicaAHormigon',
  'nivelCaracterizacionHormigon', 'nivelCaracterizacionTBS',
];

// Mapeo de códigos vitrina → código fuente en demo (cuando difieren).
const CODIGO_FUENTE = {
  IRAM1505_GRANULOMETRIA: 'IRAM1505_GRANULOMETRIA_HORMIGON',
};

(async () => {
  const v = await mysql.createConnection({ host: HOST, user: USER, password: PASS, database: DB_VITRINA });
  const d = await mysql.createConnection({ host: HOST, user: USER, password: PASS, database: DB_DEMO });

  const [demoRows] = await d.query(`SELECT codigo, ${META_COLS.join(', ')} FROM AgregadoEnsayoTipo`);
  const demoByCodigo = new Map(demoRows.map((r) => [r.codigo, r]));

  const [vitRows] = await v.query('SELECT idAgregadoEnsayoTipo, codigo FROM AgregadoEnsayoTipo');

  let actualizados = 0, sinFuente = 0;
  for (const row of vitRows) {
    const codigoFuente = CODIGO_FUENTE[row.codigo] || row.codigo;
    const src = demoByCodigo.get(codigoFuente);
    if (!src) { console.log(`  [skip] ${row.codigo} — sin equivalente en demo`); sinFuente++; continue; }

    const sets = META_COLS.map((c) => `${c} = ?`).join(', ');
    const vals = META_COLS.map((c) => src[c]);
    await v.query(
      `UPDATE AgregadoEnsayoTipo SET ${sets} WHERE idAgregadoEnsayoTipo = ?`,
      [...vals, row.idAgregadoEnsayoTipo]
    );
    const fuenteNota = codigoFuente !== row.codigo ? ` (← ${codigoFuente})` : '';
    console.log(`  [ok]   ${row.codigo}${fuenteNota}`);
    actualizados++;
  }

  console.log(`\n[backfill] Listo. Tipos actualizados: ${actualizados} | sin fuente en demo: ${sinFuente}.`);
  await v.end();
  await d.end();
  process.exit(0);
})().catch((e) => {
  console.error('[backfill] ERROR:', e.message);
  process.exit(1);
});
