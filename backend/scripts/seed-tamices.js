#!/usr/bin/env node
/**
 * Seed idempotente del catálogo de Tamiz.
 *
 * La migración 20260423b siembra los 40 tamices iniciales. Este script se usa
 * para reconciliar el catálogo ante altas o ajustes posteriores (ej. agregar
 * una designación nueva, cambiar aptoTBS de algún tamiz existente).
 *
 * Uso:
 *   node scripts/seed-tamices.js --tenant=hormiqual
 *
 * Upsert por `designacion` (natural key). Nunca borra filas — si un tamiz
 * queda obsoleto, marcarlo activo=false manualmente.
 */
require('dotenv').config();
process.env.DISABLE_CRON = '1';

const { createDbConnection } = require('../src/models');

const C = {
    reset: '\x1b[0m',
    green: '\x1b[32m',
    yellow: '\x1b[33m',
    red: '\x1b[31m',
    cyan: '\x1b[36m',
};
const log = (m) => console.log(`${C.cyan}[seed-tamices]${C.reset} ${m}`);
const ok = (m) => console.log(`${C.green}✔${C.reset} ${m}`);
const warn = (m) => console.log(`${C.yellow}⚠${C.reset} ${m}`);
const fail = (m) => console.error(`${C.red}✖${C.reset} ${m}`);

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

// Mismo catálogo que la migración 20260423b. Mantener sincronizados.
const TAMICES = [
    { designacion: '75 mm', aberturaMm: 75,    notacion: 'METRICA', orden: 1000, aptoHormigon: true,  aptoTBS: false },
    { designacion: '63 mm', aberturaMm: 63,    notacion: 'METRICA', orden: 1010, aptoHormigon: true,  aptoTBS: false },
    { designacion: '53 mm', aberturaMm: 53,    notacion: 'METRICA', orden: 1020, aptoHormigon: true,  aptoTBS: false },
    { designacion: '50 mm', aberturaMm: 50,    notacion: 'METRICA', orden: 1030, aptoHormigon: true,  aptoTBS: false },
    { designacion: '37.5 mm', aberturaMm: 37.5, notacion: 'METRICA', orden: 1040, aptoHormigon: true, aptoTBS: true  },
    { designacion: '26.5 mm', aberturaMm: 26.5, notacion: 'METRICA', orden: 1050, aptoHormigon: true, aptoTBS: false },
    { designacion: '25 mm', aberturaMm: 25,    notacion: 'METRICA', orden: 1060, aptoHormigon: true,  aptoTBS: true  },
    { designacion: '19 mm', aberturaMm: 19,    notacion: 'METRICA', orden: 1070, aptoHormigon: true,  aptoTBS: true  },
    { designacion: '13.2 mm', aberturaMm: 13.2, notacion: 'METRICA', orden: 1080, aptoHormigon: true, aptoTBS: false },
    { designacion: '12.5 mm', aberturaMm: 12.5, notacion: 'METRICA', orden: 1090, aptoHormigon: true, aptoTBS: true  },
    { designacion: '9.5 mm', aberturaMm: 9.5,  notacion: 'METRICA', orden: 1100, aptoHormigon: true,  aptoTBS: true  },
    { designacion: '4.75 mm', aberturaMm: 4.75, notacion: 'METRICA', orden: 1110, aptoHormigon: true, aptoTBS: true  },
    { designacion: '2.36 mm', aberturaMm: 2.36, notacion: 'METRICA', orden: 1120, aptoHormigon: true, aptoTBS: true  },
    { designacion: '1.18 mm', aberturaMm: 1.18, notacion: 'METRICA', orden: 1130, aptoHormigon: true, aptoTBS: true  },
    { designacion: '600 µm', aberturaMm: 0.6,  notacion: 'METRICA', orden: 1140, aptoHormigon: true,  aptoTBS: false },
    { designacion: '300 µm', aberturaMm: 0.3,  notacion: 'METRICA', orden: 1150, aptoHormigon: true,  aptoTBS: false },
    { designacion: '150 µm', aberturaMm: 0.15, notacion: 'METRICA', orden: 1160, aptoHormigon: true,  aptoTBS: true  },
    { designacion: '75 µm',  aberturaMm: 0.075,notacion: 'METRICA', orden: 1170, aptoHormigon: true,  aptoTBS: true  },

    { designacion: '4"',    aberturaMm: 100,   notacion: 'IMPERIAL', orden: 2000, aptoHormigon: true, aptoTBS: false },
    { designacion: '3½"',   aberturaMm: 90,    notacion: 'IMPERIAL', orden: 2010, aptoHormigon: true, aptoTBS: false },
    { designacion: '3"',    aberturaMm: 75,    notacion: 'IMPERIAL', orden: 2020, aptoHormigon: true, aptoTBS: false },
    { designacion: '2½"',   aberturaMm: 63,    notacion: 'IMPERIAL', orden: 2030, aptoHormigon: true, aptoTBS: false },
    { designacion: '2"',    aberturaMm: 50,    notacion: 'IMPERIAL', orden: 2040, aptoHormigon: true, aptoTBS: false },
    { designacion: '1½"',   aberturaMm: 37.5,  notacion: 'IMPERIAL', orden: 2050, aptoHormigon: true, aptoTBS: true  },
    { designacion: '1"',    aberturaMm: 25,    notacion: 'IMPERIAL', orden: 2060, aptoHormigon: true, aptoTBS: true  },
    { designacion: '¾"',    aberturaMm: 19,    notacion: 'IMPERIAL', orden: 2070, aptoHormigon: true, aptoTBS: true  },
    { designacion: '½"',    aberturaMm: 12.5,  notacion: 'IMPERIAL', orden: 2080, aptoHormigon: true, aptoTBS: true  },
    { designacion: '⅜"',    aberturaMm: 9.5,   notacion: 'IMPERIAL', orden: 2090, aptoHormigon: true, aptoTBS: true  },
    { designacion: 'N° 4',  aberturaMm: 4.75,  notacion: 'MESH',     orden: 2100, aptoHormigon: true, aptoTBS: true  },
    { designacion: 'N° 8',  aberturaMm: 2.36,  notacion: 'MESH',     orden: 2110, aptoHormigon: true, aptoTBS: true  },
    { designacion: 'N° 16', aberturaMm: 1.18,  notacion: 'MESH',     orden: 2120, aptoHormigon: true, aptoTBS: true  },
    { designacion: 'N° 30', aberturaMm: 0.6,   notacion: 'MESH',     orden: 2130, aptoHormigon: true, aptoTBS: false },
    { designacion: 'N° 50', aberturaMm: 0.3,   notacion: 'MESH',     orden: 2140, aptoHormigon: true, aptoTBS: false },
    { designacion: 'N° 100',aberturaMm: 0.15,  notacion: 'MESH',     orden: 2150, aptoHormigon: true, aptoTBS: true  },
    { designacion: 'N° 200',aberturaMm: 0.075, notacion: 'MESH',     orden: 2160, aptoHormigon: true, aptoTBS: true  },

    { designacion: '31.5 mm', aberturaMm: 31.5, notacion: 'METRICA', orden: 3000, aptoHormigon: false, aptoTBS: true },
    { designacion: '16 mm',   aberturaMm: 16,   notacion: 'METRICA', orden: 3010, aptoHormigon: false, aptoTBS: true },
    { designacion: '6.3 mm',  aberturaMm: 6.3,  notacion: 'METRICA', orden: 3020, aptoHormigon: false, aptoTBS: true },
    { designacion: '3.35 mm', aberturaMm: 3.35, notacion: 'METRICA', orden: 3030, aptoHormigon: false, aptoTBS: true },
    { designacion: '425 µm',  aberturaMm: 0.425,notacion: 'METRICA', orden: 3040, aptoHormigon: false, aptoTBS: true },
];

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
        let creados = 0, actualizados = 0, idem = 0;
        for (const t of TAMICES) {
            const [row, created] = await db.Tamiz.findOrCreate({
                where: { designacion: t.designacion },
                defaults: { ...t, activo: true },
            });
            if (created) {
                creados++;
            } else {
                const needsUpdate = row.aberturaMm.toString() !== t.aberturaMm.toString()
                    || row.notacion !== t.notacion
                    || row.orden !== t.orden
                    || row.aptoHormigon !== t.aptoHormigon
                    || row.aptoTBS !== t.aptoTBS;
                if (needsUpdate) {
                    await row.update(t);
                    actualizados++;
                } else {
                    idem++;
                }
            }
        }
        ok(`Resultado: ${creados} creados, ${actualizados} actualizados, ${idem} sin cambios (total ${TAMICES.length}).`);
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
