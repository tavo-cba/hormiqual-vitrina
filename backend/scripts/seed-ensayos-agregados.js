#!/usr/bin/env node
/**
 * Seed de tipos de ensayo de agregados (AgregadoEnsayoTipo).
 *
 * Uso:
 *   node scripts/seed-ensayos-agregados.js --tenant=hormiqual
 *   node scripts/seed-ensayos-agregados.js --tenant=hormiqual --reset
 *
 * --reset  Borra SOLO las tablas nuevas (AgregadoEnsayoArchivo, AgregadoEnsayo,
 *          AgregadoEnsayoTipo) y las recrea con los datos del JSON.
 *          No toca ninguna tabla legacy.
 */
require('dotenv').config();
process.env.DISABLE_CRON = '1';

const path = require('path');
const { createDbConnection } = require('../src/models');

// ─── CLI helpers ────────────────────────────────────────────

const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};

const log = (msg) => console.log(`${C.cyan}[seed-ensayos-agregados]${C.reset} ${msg}`);
const ok = (msg) => console.log(`${C.green}✔${C.reset} ${msg}`);
const warn = (msg) => console.log(`${C.yellow}⚠${C.reset} ${msg}`);
const fail = (msg) => console.error(`${C.red}✖${C.reset} ${msg}`);

const parseArgs = () => {
    const args = {};
    process.argv.slice(2).forEach((arg) => {
        if (arg.startsWith('--')) {
            const [key, val] = arg.slice(2).split('=');
            args[key] = val ?? true;
        }
    });
    return args;
};

// ─── Main ───────────────────────────────────────────────────

(async () => {
    const args = parseArgs();
    // [VITRINA] default al tenant del .env (DEV_TENANT) en vez de 'hormiqual'.
    const tenant = args.tenant || process.env.DEV_TENANT || 'vitrina';

    if (!tenant) {
        fail('Debe especificar --tenant=<nombre>');
        process.exit(1);
    }

    log(`Conectando a tenant: ${tenant}`);
    const db = await createDbConnection(tenant);

    try {
        // ── Reset (solo tablas nuevas) ──
        if (args.reset) {
            warn('--reset detectado. Eliminando datos de tablas nuevas…');
            await db.AgregadoEnsayoArchivo.destroy({ where: {}, truncate: true }).catch(() => {});
            await db.AgregadoEnsayo.destroy({ where: {}, truncate: true }).catch(() => {});
            await db.AgregadoEnsayoTipo.destroy({ where: {}, truncate: true }).catch(() => {});
            ok('Tablas vaciadas (AgregadoEnsayoArchivo, AgregadoEnsayo, AgregadoEnsayoTipo).');
        }

        // ── Cargar JSON ──
        const jsonPath = path.resolve(__dirname, '../seed-data/iram/ensayos_agregados_tipos.json');
        const seedData = require(jsonPath);
        const tipos = seedData.tipos;

        if (!Array.isArray(tipos) || tipos.length === 0) {
            fail('No se encontraron tipos en el archivo JSON.');
            process.exit(1);
        }

        log(`Procesando ${tipos.length} tipos de ensayo…`);

        let created = 0;
        let updated = 0;

        for (const t of tipos) {
            const values = {
                nombre: t.nombre,
                normaRef: t.normaRef ?? null,
                aplicaA: t.aplicaA ?? ['FINO', 'GRUESO'],
                unidad: t.unidad ?? '%',
                categoria: t.categoria ?? null,
                orden: t.orden ?? 0,
                schemaKey: t.schemaKey ?? null,
                material: t.material ?? 'AGREGADOS',
                // Defaults uniformes
                perfil: 'CORE',
                obligatorio: true,
                periodicidadMeses: 12,
                warningDays: 60,
                visibleEnUI: true,
                visibleEnCards: true,
                visibleEnDosificacion: false,
                isActive: true,
                esDerivado: false,
            };

            const existing = await db.AgregadoEnsayoTipo.findOne({ where: { codigo: t.codigo } });
            if (existing) {
                // Solo actualizar si --reset; de lo contrario, respetar config del usuario
                if (args.reset) {
                    await existing.update(values);
                    updated++;
                } else {
                    ok(`${t.codigo} ya existe — configuración del usuario respetada`);
                }
            } else {
                await db.AgregadoEnsayoTipo.create({ codigo: t.codigo, ...values });
                created++;
            }
        }

        ok(`Resultado: ${created} creados, ${updated} actualizados.`);
    } catch (err) {
        fail(`Error: ${err.message}`);
        console.error(err);
        process.exit(1);
    } finally {
        await db.sequelize.close();
        log('Conexión cerrada.');
        process.exit(0);
    }
})();
