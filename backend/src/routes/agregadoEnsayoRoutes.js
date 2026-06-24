const express = require('express');
const router = express.Router();
const multer = require('multer');

const agregadoEnsayoController = require('../controllers/agregadoEnsayoController');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const ensayoImportController = require('../controllers/ensayoImportController'); // extractor Claude
const { verifyJwt } = require('../middlewares/verifyToken');
const { requireRole } = require('../middlewares/permissions');
const { ROLES } = require('../domain/roles');

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 30 * 1024 * 1024 } });

// ─── Tipos de ensayo (catálogo) — gestionados por Admin ─────
router.get('/tipos', verifyJwt, agregadoEnsayoController.getTipos);
router.post('/tipos', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.createTipo);

// ─── Template (plantilla CORE) — must be before :id routes ──
router.post('/tipos/apply-template', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.applyTemplate);

// ─── Re-evaluación masiva (admin) ─────────────────────────────
// Recorre todos los ensayos del tenant y los re-evalúa con el motor
// actual, regenerando `evaluacion`, `_evaluacion`, `evaluacionAuto` y
// `reglasCIRSOC`. Útil cuando el motor cambia (PR8.1 eliminó el rango
// 2,3-3,1 del MF; PR8.8 cambió el wording de pasante #200; etc.).
// Soporta `dryRun: true` para auditar antes de persistir.
router.post('/ensayos/re-evaluar-masivo', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.reEvaluarMasivo);

// ─── Export/Import paquete de tipos ──────────────────────────
router.get('/tipos/export', verifyJwt, async (req, res) => {
    try {
        const tipos = await req.db.AgregadoEnsayoTipo.findAll({
            where: { isActive: true },
            order: [['orden', 'ASC'], ['nombre', 'ASC']],
        });
        const paquete = {
            tipo: 'ensayos',
            version_formato: '1.0',
            fecha_exportacion: new Date().toISOString(),
            cantidad: tipos.length,
            ensayos: tipos.map(t => {
                const plain = t.toJSON ? t.toJSON() : { ...t };
                return {
                    codigo: plain.codigo,
                    nombre: plain.nombre,
                    schema_key: plain.schemaKey,
                    norma_ref: plain.normaRef,
                    material: plain.material,
                    aplica_a: plain.aplicaA,
                    categoria: plain.categoria,
                    perfil: plain.perfil,
                    obligatorio: !!plain.obligatorio,
                    periodicidad_meses: plain.periodicidadMeses,
                    warning_dias: plain.warningDays,
                    orden: plain.orden,
                    visible_ui: plain.visibleEnUI !== false,
                    visible_cards: plain.visibleEnCards !== false,
                    es_derivado: !!plain.esDerivado,
                    derivado_de_codigo: plain.derivadoDeCodigo,
                    derivado_clave: plain.derivadoClave,
                    _clave_unica: plain.codigo,
                };
            }),
        };
        res.json(paquete);
    } catch (err) {
        console.error('[ensayoRoutes] export error:', err);
        res.status(500).json({ error: 'Error al exportar ensayos' });
    }
});

router.post('/tipos/import/preview', verifyJwt, async (req, res) => {
    try {
        const paquete = req.body;
        if (!paquete || paquete.tipo !== 'ensayos' || !Array.isArray(paquete.ensayos)) {
            return res.status(400).json({ error: 'Paquete inválido' });
        }

        const existentes = await req.db.AgregadoEnsayoTipo.findAll();
        const existMap = {};
        const schemaKeys = new Set();
        for (const t of existentes) {
            const plain = t.toJSON ? t.toJSON() : { ...t };
            existMap[plain.codigo] = plain;
            if (plain.schemaKey) schemaKeys.add(plain.schemaKey);
        }

        const CAMPOS = ['nombre', 'perfil', 'obligatorio', 'periodicidad_meses', 'warning_dias', 'orden', 'visible_ui', 'visible_cards'];
        const CAMPO_MAP = { nombre: 'nombre', perfil: 'perfil', obligatorio: 'obligatorio', periodicidad_meses: 'periodicidadMeses', warning_dias: 'warningDays', orden: 'orden', visible_ui: 'visibleEnUI', visible_cards: 'visibleEnCards' };

        let nNuevos = 0, nDifieren = 0, nIguales = 0;

        const preview = paquete.ensayos.map(item => {
            const codigo = item._clave_unica || item.codigo;
            const ex = existMap[codigo];
            const warnings = [];

            if (!ex) {
                nNuevos++;
                if (item.schema_key && !schemaKeys.has(item.schema_key)) {
                    warnings.push(`Schema "${item.schema_key}" no existe en este ambiente.`);
                }
                return { codigo, nombre: item.nombre, estado: 'nuevo', diferencias: [], warnings, selected: true };
            }

            const diferencias = [];
            for (const campo of CAMPOS) {
                const dbCampo = CAMPO_MAP[campo];
                const valEx = ex[dbCampo] != null ? String(ex[dbCampo]).trim() : '';
                const valIm = item[campo] != null ? String(item[campo]).trim() : '';
                if (valEx !== valIm) {
                    diferencias.push({ campo, antes: valEx || '(vacío)', despues: valIm || '(vacío)' });
                }
            }

            if (diferencias.length > 0) {
                nDifieren++;
                return { codigo, nombre: item.nombre, estado: 'difiere', diferencias, warnings, selected: true };
            }
            nIguales++;
            return { codigo, nombre: item.nombre, estado: 'igual', diferencias: [], warnings, selected: false };
        });

        res.json({
            tipo: paquete.tipo,
            version_formato: paquete.version_formato,
            fecha_exportacion: paquete.fecha_exportacion,
            cantidad: preview.length,
            nuevos: nNuevos,
            difieren: nDifieren,
            iguales: nIguales,
            preview,
        });
    } catch (err) {
        console.error('[ensayoRoutes] import preview error:', err);
        res.status(500).json({ error: 'Error al previsualizar importación' });
    }
});

router.post('/tipos/import', verifyJwt, async (req, res) => {
    try {
        const { ensayos: items, seleccionados } = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'Paquete inválido: se esperaba array ensayos[]' });
        }

        const selectedSet = Array.isArray(seleccionados) ? new Set(seleccionados) : null;
        const resultados = { creados: 0, actualizados: 0, sin_cambios: 0, errores: [], detalle: [] };

        for (const item of items) {
            const codigo = item._clave_unica || item.codigo;

            if (selectedSet && !selectedSet.has(codigo)) {
                resultados.sin_cambios++;
                continue;
            }

            try {
                const existente = await req.db.AgregadoEnsayoTipo.findOne({ where: { codigo } });

                if (existente) {
                    await existente.update({
                        nombre: item.nombre,
                        perfil: item.perfil || existente.perfil,
                        obligatorio: item.obligatorio !== undefined ? item.obligatorio : existente.obligatorio,
                        periodicidadMeses: item.periodicidad_meses !== undefined ? item.periodicidad_meses : existente.periodicidadMeses,
                        warningDays: item.warning_dias !== undefined ? item.warning_dias : existente.warningDays,
                        orden: item.orden !== undefined ? item.orden : existente.orden,
                        visibleEnUI: item.visible_ui !== undefined ? item.visible_ui : existente.visibleEnUI,
                        visibleEnCards: item.visible_cards !== undefined ? item.visible_cards : existente.visibleEnCards,
                    });
                    resultados.actualizados++;
                    resultados.detalle.push({ codigo, accion: 'actualizado' });
                } else {
                    await req.db.AgregadoEnsayoTipo.create({
                        codigo: item.codigo,
                        nombre: item.nombre,
                        schemaKey: item.schema_key || null,
                        normaRef: item.norma_ref || null,
                        material: item.material || 'AGREGADOS',
                        aplicaA: item.aplica_a || null,
                        categoria: item.categoria || null,
                        perfil: item.perfil || 'AVANZADO',
                        obligatorio: !!item.obligatorio,
                        periodicidadMeses: item.periodicidad_meses || null,
                        warningDays: item.warning_dias || null,
                        orden: item.orden || 0,
                        visibleEnUI: item.visible_ui !== false,
                        visibleEnCards: item.visible_cards !== false,
                        esDerivado: !!item.es_derivado,
                        derivadoDeCodigo: item.derivado_de_codigo || null,
                        derivadoClave: item.derivado_clave || null,
                        isActive: true,
                    });
                    resultados.creados++;
                    resultados.detalle.push({ codigo, accion: 'creado' });
                }
            } catch (itemErr) {
                resultados.errores.push({ codigo, error: itemErr.message });
            }
        }

        res.json(resultados);
    } catch (err) {
        console.error('[ensayoRoutes] import error:', err);
        res.status(500).json({ error: 'Error al importar ensayos: ' + err.message });
    }
});

// ─── Snapshots de configuración del catálogo ────────────────
// Mismo flujo que export/import pero persistido server-side: el usuario
// guarda fotos con nombre y restaura desde la UI sin manejar archivos.
const snapshotSvc = require('../services/catalogoEnsayoSnapshotService');

router.get('/snapshots', verifyJwt, async (req, res) => {
    try {
        const material = req.query.material || undefined;
        const rows = await snapshotSvc.listarSnapshots(req.db, { material });
        res.json(rows);
    } catch (err) {
        console.error('[ensayoRoutes] listar snapshots:', err);
        res.status(500).json({ error: 'No se pudieron listar los snapshots' });
    }
});

router.post('/snapshots', verifyJwt, requireRole(ROLES.ADMIN), async (req, res) => {
    try {
        const idEmpleado = req.user?.idEmpleado || null;
        const snap = await snapshotSvc.crearSnapshot(req.db, req.body || {}, { idEmpleado });
        res.status(201).json(snap);
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message || 'Error al crear snapshot' });
    }
});

router.get('/snapshots/:id', verifyJwt, async (req, res) => {
    try {
        const snap = await snapshotSvc.obtenerSnapshot(req.db, req.params.id);
        if (!snap) return res.status(404).json({ error: 'Snapshot no encontrado' });
        res.json(snap);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

router.delete('/snapshots/:id', verifyJwt, requireRole(ROLES.ADMIN), async (req, res) => {
    try {
        const r = await snapshotSvc.eliminarSnapshot(req.db, req.params.id);
        res.json(r);
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

router.get('/snapshots/:id/preview', verifyJwt, async (req, res) => {
    try {
        const r = await snapshotSvc.previewRestauracion(req.db, req.params.id);
        res.json(r);
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

router.post('/snapshots/:id/restore', verifyJwt, requireRole(ROLES.ADMIN), async (req, res) => {
    try {
        const r = await snapshotSvc.restaurarSnapshot(req.db, req.params.id, {
            seleccionados: req.body?.seleccionados,
        });
        res.json(r);
    } catch (err) {
        const status = err.statusCode || 500;
        res.status(status).json({ error: err.message });
    }
});

// ─── Ensayo counts per tipo (for catalog table) ─────────────
router.get('/tipos/counts', verifyJwt, agregadoEnsayoController.getEnsayoCountsByTipo);

// ─── Ensayos by tipo (browse ensayos for a specific tipo) ───
router.get('/tipos/:id/ensayos', verifyJwt, agregadoEnsayoController.getEnsayosByTipo);

// RBAC Fase 1: editar/borrar catálogo de tipos solo Admin
router.put('/tipos/:id', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.updateTipo);
router.patch('/tipos/:id', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.updateTipo);
router.delete('/tipos/:id', verifyJwt, requireRole(ROLES.ADMIN), agregadoEnsayoController.deleteTipo);

// ─── Schema Key options (para wizard) ───────────────────────
router.get('/schema-keys', verifyJwt, agregadoEnsayoController.getSchemaKeyOptions);

// ─── Suggestion by norma (para wizard autocompletar) ────────
router.get('/tipos/sugerencia', verifyJwt, agregadoEnsayoController.getSugerencia);

// ─── Resumen ────────────────────────────────────────────────
router.get('/resumen/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.getResumen);

// ─── AgregadoMeta (tipo agregado grueso, etc.) ──────────────
router.get('/meta/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.getAgregadoMeta);
router.put('/meta/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.upsertAgregadoMeta);

// ─── Evaluación granulometría (preview) ─────────────────────
router.post('/granulometria/evaluar', verifyJwt, agregadoEnsayoController.evaluarGranulometria);
router.post('/granulometria/evaluar-banda-compuesta', verifyJwt, agregadoEnsayoController.evaluarBandaCompuesta);

// ─── Ajuste contra curva teórica (preview) ──────────────────
router.post('/granulometria/ajuste-teorico', verifyJwt, agregadoEnsayoController.ajustarContraTeorica);

// ─── Caracterización (computed from ensayos) ────────────────
router.get('/caracterizacion/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.getCaracterizacion);
// PR4: vista normativa CIRSOC sin política del catálogo (auditoría/supervisión).
router.get('/vista-normativa/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.getVistaNormativa);

// ─── Form Spec (formulario por tipo) ────────────────────────
router.get('/form-spec', verifyJwt, agregadoEnsayoController.getFormSpecAll);
router.get('/form-spec/:codigo', verifyJwt, agregadoEnsayoController.getFormSpecByCodigo);

// ─── Importación PDF (Claude) ───────────────────────────────
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// router.post('/import/pdf', verifyJwt, upload.single('file'), ensayoImportController.previewPdfImport);
// router.post('/import/pdf/confirm', verifyJwt, ensayoImportController.confirmPdfImport);

// ─── PDF de ensayos (antes de :id para evitar colisión) ────
router.post('/pdf-batch', verifyJwt, agregadoEnsayoController.generarPdfEnsayosBatchHandler);
router.post('/:id/pdf', verifyJwt, agregadoEnsayoController.generarPdfEnsayoHandler);

// ─── Ensayos ────────────────────────────────────────────────
router.get('/', verifyJwt, agregadoEnsayoController.getEnsayos);
router.get('/ultimo-por-tipo/:legacyAgregadoId', verifyJwt, agregadoEnsayoController.getUltimoPorTipo);
router.get('/:id', verifyJwt, agregadoEnsayoController.getEnsayo);
router.post('/', verifyJwt, agregadoEnsayoController.createEnsayo);
router.post('/batch', verifyJwt, agregadoEnsayoController.createBatch);
router.put('/:id', verifyJwt, agregadoEnsayoController.updateEnsayo);
router.delete('/:id', verifyJwt, agregadoEnsayoController.deleteEnsayo);

// Re-evaluación masiva de ensayos (sin evaluación o forzando re-evaluación de todos)
router.post('/reevaluar-antiguos', verifyJwt, async (req, res) => {
  try {
    const { reevaluarEnsayosAntiguos } = require('../services/agregadoEnsayoService');
    const result = await reevaluarEnsayosAntiguos(req.db, { forzar: req.body.forzar === true });
    res.json(result);
  } catch (err) {
    console.error('[reevaluar-antiguos]', err);
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
