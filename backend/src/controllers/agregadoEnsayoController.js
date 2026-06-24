const agregadoEnsayoService = require('../services/agregadoEnsayoService');
const { evalAgainstSpec, normalizeMedidos, calcularModuloFinura, calcularTMN } = require('../services/granulometriaEvalService');
const curvaGranulometricaService = require('../services/curvaGranulometricaService');
const { getFormSpec, getFormSpecBySchemaKey, getAllFormSpecs, SPEC_VERSION } = require('../domain/ensayoFormSpecRegistry');
const { isAliasCodigo, getCanonicalCodigo } = require('../domain/ensayoResultRegistry');

// ─── Tipos ──────────────────────────────────────────────────

const getTipos = async (req, res) => {
    try {
        const data = await agregadoEnsayoService.getTipos(req.db, req.query);
        // Enrich with alias info so frontend can hide alias duplicates
        const enriched = data.map((row) => {
            const plain = row.toJSON ? row.toJSON() : row;
            const codigo = plain.codigo || '';
            plain.esAlias = isAliasCodigo(codigo);
            if (plain.esAlias) {
                plain.canonicalCodigo = getCanonicalCodigo(codigo);
            }
            return plain;
        });
        res.status(200).json(enriched);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener tipos de ensayo de agregados' });
    }
};

const createTipo = async (req, res) => {
    try {
        const tipo = await agregadoEnsayoService.createTipo(req.db, req.body);
        res.status(201).json(tipo);
    } catch (err) {
        console.error(err);
        const msg = err.message || 'Error al crear tipo de ensayo';
        const status = msg.includes('requerido') || msg.includes('Ya existe') || msg.includes('debe ser') ? 400 : 500;
        res.status(status).json({ error: msg });
    }
};

const updateTipo = async (req, res) => {
    try {
        const tipo = await agregadoEnsayoService.updateTipo(req.db, req.params.id, req.body);
        res.status(200).json(tipo);
    } catch (err) {
        console.error(err);
        if (err.code === 'APLICA_A_CONFIRM') {
            return res.status(409).json({ error: err.message, code: 'APLICA_A_CONFIRM', ensayoCount: err.ensayoCount });
        }
        const msg = err.message || 'Error al actualizar tipo de ensayo';
        const status = msg.includes('no encontrado') ? 404 : msg.includes('No se puede') || msg.includes('debe ser') ? 400 : 500;
        res.status(status).json({ error: msg });
    }
};

const deleteTipo = async (req, res) => {
    try {
        const result = await agregadoEnsayoService.deleteTipo(req.db, req.params.id, {
            force: req.body.force === true,
            reassignToId: req.body.reassignToId || null,
        });
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        if (err.code === 'DELETE_TIPO_CONFIRM') {
            return res.status(409).json({ error: err.message, code: 'DELETE_TIPO_CONFIRM', ensayoCount: err.ensayoCount });
        }
        const msg = err.message || 'Error al eliminar tipo de ensayo';
        const status = msg.includes('no encontrado') ? 404 : 500;
        res.status(status).json({ error: msg });
    }
};

const applyTemplate = async (req, res) => {
    try {
        const result = await agregadoEnsayoService.applyTemplate(req.db, req.body);
        res.status(200).json(result);
    } catch (err) {
        console.error(err);
        const msg = err.message || 'Error al aplicar plantilla';
        const status = msg.includes('no encontrada') || msg.includes('no es para') ? 400 : 500;
        res.status(status).json({ error: msg });
    }
};

/**
 * POST /api/agregados/ensayos/re-evaluar-masivo
 *
 * Re-evalúa ensayos del tenant con el motor actual y persiste los cambios.
 * Soporta `dryRun` para auditar qué cambiaría sin escribir.
 *
 * Body:
 *   - dryRun: boolean (default false)
 *   - batchSize: number (default 100, máx 500)
 *   - filtros: { idAgregado?, codigoTipo?, fechaDesde? }
 *   - sampleCambios: number (default 50)
 *
 * Response:
 *   - stats: { total, evaluados, cambiaron, errores, dryRun }
 *   - sampleCambios: array (hasta sampleMax)
 *   - completadoEnMs: number
 */
const reEvaluarMasivo = async (req, res) => {
    try {
        const { reEvaluarTodosLosEnsayos } = require('../services/reEvaluarEnsayosMasivoService');
        const result = await reEvaluarTodosLosEnsayos(req.db, req.body || {});
        res.status(200).json(result);
    } catch (err) {
        console.error('[reEvaluarMasivo] Error:', err);
        res.status(500).json({ error: err.message || 'Error en re-evaluación masiva' });
    }
};

// ─── Ensayo counts / browse by tipo ─────────────────────────

const getEnsayoCountsByTipo = async (req, res) => {
    try {
        const counts = await agregadoEnsayoService.getEnsayoCountsByTipo(req.db);
        res.status(200).json(counts);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener conteos de ensayos' });
    }
};

const getEnsayosByTipo = async (req, res) => {
    try {
        const includeInactive = req.query.includeInactive === 'true';
        const data = await agregadoEnsayoService.getEnsayosByTipo(req.db, req.params.id, { includeInactive });
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener ensayos del tipo' });
    }
};

// ─── Ensayos ────────────────────────────────────────────────

const getEnsayos = async (req, res) => {
    try {
        const data = await agregadoEnsayoService.getEnsayos(req.db, req.query);
        // Ensure resultado is parsed JSON (MySQL may return it as string)
        const parsed = data.map(e => {
            const j = e.toJSON();
            if (typeof j.resultado === 'string') {
                try { j.resultado = JSON.parse(j.resultado); } catch {}
            }
            return j;
        });
        res.status(200).json(parsed);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener ensayos de agregados' });
    }
};

const getEnsayo = async (req, res) => {
    try {
        const ensayo = await agregadoEnsayoService.getEnsayo(req.db, req.params.id);
        // Ensure resultado is parsed JSON (MySQL may return it as string)
        const json = ensayo.toJSON();
        if (typeof json.resultado === 'string') {
            try { json.resultado = JSON.parse(json.resultado); } catch {}
        }
        res.status(200).json(json);
    } catch (err) {
        console.error(err);
        const status = err.message.includes('no encontrado') ? 404 : 500;
        res.status(status).json({ error: err.message || 'Error al obtener el ensayo' });
    }
};

const getUltimoPorTipo = async (req, res) => {
    try {
        const data = await agregadoEnsayoService.getUltimoPorTipo(req.db, req.params.legacyAgregadoId);
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: 'Error al obtener últimos ensayos por tipo' });
    }
};

const createEnsayo = async (req, res) => {
    try {
        const ensayo = await agregadoEnsayoService.createEnsayo(req.db, req.body);
        res.status(201).json(ensayo);
    } catch (err) {
        console.error(err);
        const status = err.message.includes('requerido') || err.message.includes('debe ser') ? 400 : 500;
        res.status(status).json({ error: err.message || 'Error al crear ensayo' });
    }
};

/**
 * POST /batch — Create multiple ensayos at once (campaign mode).
 * Body: { legacyAgregadoId, fechaEnsayo, fechaMuestreo?, laboratorio?, nroInforme?, observaciones?, ensayos: [{ idAgregadoEnsayoTipo, resultado }] }
 */
const createBatch = async (req, res) => {
    try {
        const { legacyAgregadoId, fechaEnsayo, fechaMuestreo, laboratorio, nroInforme, observaciones, ensayos: items } = req.body;
        if (!legacyAgregadoId || !fechaEnsayo || !Array.isArray(items) || items.length === 0) {
            return res.status(400).json({ error: 'legacyAgregadoId, fechaEnsayo y ensayos[] son requeridos.' });
        }
        const created = [];
        const errors = [];
        for (const item of items) {
            try {
                const payload = {
                    legacyAgregadoId,
                    idAgregadoEnsayoTipo: item.idAgregadoEnsayoTipo,
                    fechaEnsayo,
                    fechaMuestreo: fechaMuestreo || null,
                    laboratorio: laboratorio || null,
                    nroInforme: nroInforme || null,
                    observaciones: item.observaciones || observaciones || null,
                    cumple: 'NO_EVAL',
                    resultado: item.resultado || null,
                    tipoAgregado: item.tipoAgregado || null,
                };
                const ensayo = await agregadoEnsayoService.createEnsayo(req.db, payload);
                const json = ensayo.toJSON ? ensayo.toJSON() : ensayo;
                if (typeof json.resultado === 'string') {
                    try { json.resultado = JSON.parse(json.resultado); } catch {}
                }
                created.push(json);
            } catch (err) {
                errors.push({ idAgregadoEnsayoTipo: item.idAgregadoEnsayoTipo, error: err.message });
            }
        }
        res.status(201).json({ created, errors, total: items.length });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al crear campaña de ensayos' });
    }
};

const updateEnsayo = async (req, res) => {
    try {
        const ensayo = await agregadoEnsayoService.updateEnsayo(req.db, req.params.id, req.body);
        res.status(200).json(ensayo);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al actualizar ensayo' });
    }
};

const deleteEnsayo = async (req, res) => {
    try {
        const data = await agregadoEnsayoService.deleteEnsayo(req.db, req.params.id);
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al eliminar ensayo' });
    }
};

// ─── Resumen ────────────────────────────────────────────────

const getResumen = async (req, res) => {
    try {
        // `modo` opcional (decisión 2026-05-28): DESCRIPTIVO default no
        // computa veredicto ni filtra por catálogo; NORMATIVO evalúa contra
        // la matriz CIRSOC 200:2024 + IRAM completa. Acepta los aliases
        // viejos PRESTACIONAL/PRESCRIPTIVO (normalizados service-side).
        const data = await agregadoEnsayoService.getResumen(
            req.db,
            req.params.legacyAgregadoId,
            { uso: req.query.uso, modo: req.query.modo },
        );
        res.status(200).json(data);
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al obtener resumen de ensayos' });
    }
};

// ─── Evaluación granulometría (preview, sin guardar) ────────

const evaluarGranulometria = async (req, res) => {
    try {
        const { serieTamices, medidos, idCurvaObjetivo, tipoAgregado } = req.body;
        if (!idCurvaObjetivo) {
            return res.status(400).json({ error: 'idCurvaObjetivo es requerido' });
        }
        if (!Array.isArray(medidos) || medidos.length === 0) {
            return res.status(400).json({ error: 'medidos es requerido (array de puntos)' });
        }

        // Load curve with points
        const curva = await curvaGranulometricaService.getCurva(req.db, idCurvaObjetivo);
        if (!curva) return res.status(404).json({ error: 'Curva objetivo no encontrada' });

        // Build spec from curve
        const specPuntos = curva.tipo === 'TEORICA'
            ? (curva.puntosCalculados || [])
            : (curva.puntos || []);

        const evalResult = evalAgainstSpec({
            medidos,
            spec: { specMode: curva.specMode, puntos: specPuntos },
            serieTamices: serieTamices || curva.serieTamices,
            tipoAgregado: tipoAgregado || curva.uso,
        });

        res.status(200).json({
            ...evalResult,
            objetivo: {
                idCurvaObjetivo: curva.idCurva,
                nombre: curva.nombre,
                normaRef: curva.normaRef,
                specMode: curva.specMode,
                serieTamices: curva.serieTamices,
                uso: curva.uso,
                tmnMm: curva.tmnMm,
                curveLetter: curva.curveLetter,
            },
        });
    } catch (err) {
        console.error('[evaluarGranulometria]', err);
        res.status(500).json({ error: err.message || 'Error al evaluar granulometría' });
    }
};

// ─── Evaluación banda compuesta (2 curvas → RANGO) ──────────

const evaluarBandaCompuesta = async (req, res) => {
    try {
        const { serieTamices, medidos, idCurvaMin, idCurvaMax, idCurvaMiddle, tipoAgregado } = req.body;
        if (!idCurvaMin || !idCurvaMax) {
            return res.status(400).json({ error: 'idCurvaMin e idCurvaMax son requeridos' });
        }
        if (!Array.isArray(medidos) || medidos.length === 0) {
            return res.status(400).json({ error: 'medidos es requerido (array de puntos)' });
        }

        const curvaPromises = [
            curvaGranulometricaService.getCurva(req.db, idCurvaMin),
            curvaGranulometricaService.getCurva(req.db, idCurvaMax),
        ];
        if (idCurvaMiddle) curvaPromises.push(curvaGranulometricaService.getCurva(req.db, idCurvaMiddle));

        const [curvaMin, curvaMax, curvaMiddle] = await Promise.all(curvaPromises);
        if (!curvaMin) return res.status(404).json({ error: 'Curva límite inferior no encontrada' });
        if (!curvaMax) return res.status(404).json({ error: 'Curva límite superior no encontrada' });

        const puntosMin = curvaMin.puntos || [];
        const puntosMax = curvaMax.puntos || [];

        // Merge points: for each aperture present in either curve, build a RANGO point
        const aberturaMap = new Map();
        for (const p of puntosMin) {
            if (p.isNA) continue;
            aberturaMap.set(p.aberturaMm, { aberturaMm: p.aberturaMm, tamiz: p.tamiz, limInfPct: p.limSupPct ?? p.pasaPct ?? p.targetPct });
        }
        for (const p of puntosMax) {
            if (p.isNA) continue;
            const existing = aberturaMap.get(p.aberturaMm) || { aberturaMm: p.aberturaMm, tamiz: p.tamiz };
            existing.limSupPct = p.limSupPct ?? p.pasaPct ?? p.targetPct;
            if (existing.limInfPct == null) existing.limInfPct = null;
            aberturaMap.set(p.aberturaMm, existing);
        }

        const specPuntos = [...aberturaMap.values()]
            .filter(p => p.limInfPct != null || p.limSupPct != null)
            .sort((a, b) => a.aberturaMm - b.aberturaMm);

        const evalResult = evalAgainstSpec({
            medidos,
            spec: { specMode: 'RANGO', puntos: specPuntos },
            serieTamices: serieTamices || curvaMin.serieTamices,
            tipoAgregado: tipoAgregado || curvaMin.uso || curvaMax.uso,
        });

        // Build middle curve series if provided
        let bandaMid = null;
        if (curvaMiddle) {
            bandaMid = (curvaMiddle.puntos || [])
                .filter(p => !p.isNA)
                .map(p => ({ aberturaMm: p.aberturaMm, pasaPct: p.limSupPct ?? p.pasaPct ?? p.targetPct }))
                .sort((a, b) => a.aberturaMm - b.aberturaMm);
        }

        const letters = [curvaMin.curveLetter, curvaMiddle?.curveLetter, curvaMax.curveLetter].filter(Boolean);
        const bandaNombre = `Banda ${letters.join('-')}`;
        const result = {
            ...evalResult,
            objetivo: {
                nombre: bandaNombre,
                normaRef: curvaMin.normaRef || curvaMax.normaRef,
                specMode: 'RANGO',
                serieTamices: curvaMin.serieTamices,
                uso: curvaMin.uso,
                curvaMin: { idCurva: curvaMin.idCurva, nombre: curvaMin.nombre, curveLetter: curvaMin.curveLetter },
                curvaMax: { idCurva: curvaMax.idCurva, nombre: curvaMax.nombre, curveLetter: curvaMax.curveLetter },
            },
        };
        if (curvaMiddle) {
            result.objetivo.curvaMiddle = { idCurva: curvaMiddle.idCurva, nombre: curvaMiddle.nombre, curveLetter: curvaMiddle.curveLetter };
        }
        if (bandaMid) {
            result.series.bandaMid = bandaMid;
        }
        res.status(200).json(result);
    } catch (err) {
        console.error('[evaluarBandaCompuesta]', err);
        res.status(500).json({ error: err.message || 'Error al evaluar banda compuesta' });
    }
};

// ─── Ajuste contra curva teórica (preview, sin guardar) ─────

const ajustarContraTeorica = async (req, res) => {
    try {
        const { serieTamices, medidos, idCurvaTeorica, tipoAgregado } = req.body;
        if (!idCurvaTeorica) {
            return res.status(400).json({ error: 'idCurvaTeorica es requerido' });
        }
        if (!Array.isArray(medidos) || medidos.length === 0) {
            return res.status(400).json({ error: 'medidos es requerido (array de puntos)' });
        }

        // Load curve with points
        const curva = await curvaGranulometricaService.getCurva(req.db, idCurvaTeorica);
        if (!curva) return res.status(404).json({ error: 'Curva teórica no encontrada' });

        // Build tamicesGrano
        const tamicesGrano = medidos
            .filter(m => m.pasaPct !== null && m.pasaPct !== undefined && m.pasaPct !== '')
            .map(m => ({
                tamiz: m.tamiz || `${Number(m.aberturaMm)} mm`,
                aberturaMm: Number(m.aberturaMm),
                pasaPct: Number(m.pasaPct),
            }));

        const result = curvaGranulometricaService.compararConCurva(tamicesGrano, curva);
        if (!result) {
            return res.status(400).json({ error: 'No se pudo comparar con la curva teórica (datos insuficientes)' });
        }

        // Cálculos derivados (MF, TMN) sobre la muestra
        const medidosNorm = normalizeMedidos(medidos);
        const mfResult = calcularModuloFinura(medidosNorm, tipoAgregado || curva.uso);
        const tmnResult = calcularTMN(medidosNorm);

        res.status(200).json({
            ...result,
            calculos: {
                moduloFinura: mfResult ? { valor: mfResult.valor, completo: mfResult.completo, disponibles: mfResult.disponibles, total: mfResult.total } : null,
                tmn: tmnResult ? { valor: tmnResult.valor, tamiz: tmnResult.tamiz } : null,
            },
            curva: {
                idCurva: curva.idCurva,
                nombre: curva.nombre,
                normaRef: curva.normaRef,
                tipo: curva.tipo,
                parametros: curva.parametros,
            },
        });
    } catch (err) {
        console.error('[ajustarContraTeorica]', err);
        res.status(500).json({ error: err.message || 'Error al ajustar contra curva teórica' });
    }
};

// ─── Form Spec ──────────────────────────────────────────────

const getFormSpecByCodigo = (req, res) => {
    const { codigo } = req.params;
    // Try by schemaKey first (if the param looks like a schemaKey), then fall back to codigo
    const specBySchema = getFormSpecBySchemaKey(codigo);
    const spec = specBySchema || getFormSpec(codigo);
    if (!spec) return res.status(404).json({ error: `No hay spec para código "${codigo}"` });
    res.json(spec);
};

const getFormSpecAll = (_req, res) => {
    res.json({ specVersion: SPEC_VERSION, specs: getAllFormSpecs() });
};

// ─── AgregadoMeta (subtipoMaterial, cantera, productor, nroExpediente) ───

const VALID_SUBTIPO_GRUESO = ['CANTO_RODADO', 'TRITURADO_NATURAL', 'TRITURADO_ARTIFICIAL', 'ESCORIA_ALTO_HORNO', 'LIVIANO'];
const VALID_SUBTIPO_FINO   = ['ARENA_NATURAL', 'ARENA_TRITURACION'];
const VALID_SUBTIPO_ALL    = [...VALID_SUBTIPO_GRUESO, ...VALID_SUBTIPO_FINO];

const getAgregadoMeta = async (req, res) => {
    try {
        const { legacyAgregadoId } = req.params;
        const payload = await agregadoEnsayoService.getAgregadoMetaConAptitudes(req.db, legacyAgregadoId);
        res.json(payload);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const upsertAgregadoMeta = async (req, res) => {
    try {
        const { legacyAgregadoId } = req.params;
        const { subtipoMaterial, cantera, productor, nroExpediente, tipoAgregado } = req.body;

        // productor is required
        if (!productor || !productor.trim()) {
            return res.status(400).json({ error: 'productor es requerido' });
        }

        // subtipoMaterial is required
        if (!subtipoMaterial) {
            return res.status(400).json({ error: 'subtipoMaterial es requerido' });
        }

        // Validate enum value
        if (!VALID_SUBTIPO_ALL.includes(subtipoMaterial)) {
            return res.status(400).json({
                error: `subtipoMaterial debe ser ${VALID_SUBTIPO_ALL.join(', ')}`,
            });
        }

        // Cross-validate with tipoAgregado (Fino/Grueso) if provided
        if (tipoAgregado) {
            const tipoUpper = tipoAgregado.toUpperCase();
            if (tipoUpper === 'GRUESO' && VALID_SUBTIPO_FINO.includes(subtipoMaterial)) {
                return res.status(400).json({
                    error: `subtipoMaterial '${subtipoMaterial}' no es válido para agregado GRUESO. Valores permitidos: ${VALID_SUBTIPO_GRUESO.join(', ')}`,
                });
            }
            if (tipoUpper === 'FINO' && VALID_SUBTIPO_GRUESO.includes(subtipoMaterial)) {
                return res.status(400).json({
                    error: `subtipoMaterial '${subtipoMaterial}' no es válido para agregado FINO. Valores permitidos: ${VALID_SUBTIPO_FINO.join(', ')}`,
                });
            }
        }

        const updateData = {
            subtipoMaterial,
            cantera: cantera || null,
            productor: productor.trim(),
            nroExpediente: nroExpediente || null,
        };

        const [meta, created] = await req.db.AgregadoMeta.findOrCreate({
            where: { legacyAgregadoId },
            defaults: { legacyAgregadoId, ...updateData },
        });

        if (!created) {
            await meta.update(updateData);
        }

        res.json(meta);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

// ─── Caracterización (computed from ensayos) ────────────────
const getCaracterizacion = async (req, res) => {
    try {
        const { legacyAgregadoId } = req.params;
        const uso = req.query.uso || null;
        const service = require('../services/agregadoEnsayoService');
        const result = await service.getCaracterizacion(req.db, legacyAgregadoId, uso);
        res.json(result);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
};

const getSchemaKeyOptions = (_req, res) => {
    const { SCHEMA_KEY_OPTIONS } = require('../domain/ensayoFormSpecRegistry');
    res.json(SCHEMA_KEY_OPTIONS);
};

// ─── Vista normativa CIRSOC (PR4) ─────────────────────────────
// Devuelve la verificación de aptitud sin aplicar la política del catálogo
// del tenant. Para auditoría / supervisión externa.
const getVistaNormativa = async (req, res) => {
    try {
        const { legacyAgregadoId } = req.params;
        const opts = {};
        if (req.query.expuestoDesgaste !== undefined) opts.expuestoDesgaste = req.query.expuestoDesgaste === 'true';
        if (req.query.aspectoSuperficialImportante !== undefined) opts.aspectoSuperficialImportante = req.query.aspectoSuperficialImportante === 'true';
        if (req.query.tipoArmadura) opts.tipoArmadura = req.query.tipoArmadura;
        if (req.query.claseExposicion) opts.claseExposicion = req.query.claseExposicion;
        if (req.query.fc) opts.fc = req.query.fc;
        if (req.query.subtipoOverride) opts.subtipoOverride = req.query.subtipoOverride;

        const { getVistaNormativaCirsoc } = require('../services/vistaNormativaService');
        const result = await getVistaNormativaCirsoc(req.db, Number(legacyAgregadoId), opts);
        res.json(result);
    } catch (err) {
        console.error('[getVistaNormativa]', err);
        res.status(err.statusCode || 500).json({ error: err.message || 'Error al construir vista normativa' });
    }
};

// ─── Sugerencia por norma (wizard autocompletar) ────────────

const getSugerencia = (req, res) => {
    const { getSuggestionForNorma, getConsistencyWarnings } = require('../domain/ensayoTipoSuggestions');
    const { material, norma } = req.query;
    if (!material || !norma) {
        return res.status(400).json({ error: 'material y norma son requeridos' });
    }
    const suggestion = getSuggestionForNorma({ material, normaCodigo: norma });
    if (!suggestion) return res.status(204).send();
    res.json(suggestion);
};

// ─── PDF generation (individual + batch) ────────────────────────────────────

const generarPdfEnsayoHandler = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!id || isNaN(id)) return res.status(400).json({ error: 'id inválido' });

        const opciones = req.body || {};
        const { generarPdfEnsayoIndividual } = require('../services/ensayoPdfService');
        const buffer = await generarPdfEnsayoIndividual(req.db, id, opciones);

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ensayo-${id}.pdf"`);
        res.send(buffer);
    } catch (err) {
        console.error('[generarPdfEnsayo]', err);
        res.status(500).json({ error: err.message });
    }
};

const generarPdfEnsayosBatchHandler = async (req, res) => {
    try {
        const { idAgregado, ensayos, modoEvaluacion } = req.body || {};
        if (!idAgregado || !Array.isArray(ensayos) || ensayos.length === 0) {
            return res.status(400).json({ error: 'idAgregado y ensayos[] son obligatorios' });
        }
        const { generarPdfEnsayosBatch } = require('../services/ensayoPdfService');
        const buffer = await generarPdfEnsayosBatch(req.db, { idAgregado, ensayos, modoEvaluacion });

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader('Content-Disposition', `inline; filename="ensayos-agregado-${idAgregado}.pdf"`);
        res.send(buffer);
    } catch (err) {
        console.error('[generarPdfEnsayosBatch]', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = {
    getTipos,
    createTipo,
    updateTipo,
    deleteTipo,
    applyTemplate,
    reEvaluarMasivo,
    getSugerencia,
    getEnsayoCountsByTipo,
    getEnsayosByTipo,
    getEnsayos,
    getEnsayo,
    getUltimoPorTipo,
    createEnsayo,
    createBatch,
    updateEnsayo,
    deleteEnsayo,
    getResumen,
    evaluarGranulometria,
    evaluarBandaCompuesta,
    ajustarContraTeorica,
    getFormSpecByCodigo,
    getFormSpecAll,
    getSchemaKeyOptions,
    getVistaNormativa,
    getAgregadoMeta,
    upsertAgregadoMeta,
    getCaracterizacion,
    generarPdfEnsayoHandler,
    generarPdfEnsayosBatchHandler,
};
