const express = require('express');
const router = express.Router();
const multer = require('multer');

const normaController = require('../controllers/normaController');
const { verifyJwt } = require('../middlewares/verifyToken');

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024 }, // 30 MB
    fileFilter: (_req, file, cb) => {
        if (file.mimetype === 'application/pdf') {
            cb(null, true);
        } else {
            cb(new Error('Solo se aceptan archivos PDF'), false);
        }
    },
});

// ─── "Aplica a" lookup (MUST come before /:id) ──────────────
router.get('/aplica-a', verifyJwt, async (req, res) => {
    try {
        const data = await req.db.NormaAplicaA.findAll({
            where: { activo: true },
            order: [['orden', 'ASC'], ['nombre', 'ASC']],
        });
        res.json(data);
    } catch (err) {
        console.error('[normaRoutes] aplica-a list error:', err);
        res.status(500).json({ error: 'Error al obtener opciones' });
    }
});
router.post('/aplica-a', verifyJwt, async (req, res) => {
    try {
        const { nombre } = req.body;
        if (!nombre?.trim()) return res.status(400).json({ error: 'Nombre requerido' });
        const [maxRow] = await req.db.NormaAplicaA.findAll({ order: [['orden', 'DESC']], limit: 1 });
        const nextOrden = (maxRow?.orden || 0) + 1;
        const option = await req.db.NormaAplicaA.create({ nombre: nombre.trim(), orden: nextOrden });
        res.status(201).json(option);
    } catch (err) {
        if (err.name === 'SequelizeUniqueConstraintError') {
            return res.status(409).json({ error: 'Ya existe esa opcion' });
        }
        console.error('[normaRoutes] aplica-a create error:', err);
        res.status(500).json({ error: 'Error al crear opcion' });
    }
});

// ─── Export/Import paquete ───────────────────────────────────
router.get('/export', verifyJwt, async (req, res) => {
    try {
        const normas = await req.db.Norma.findAll({
            include: [
                { model: req.db.NormaAplicaA, as: 'aplicaAOpcion', attributes: ['nombre'] },
            ],
            order: [['codigo', 'ASC']],
        });
        const paquete = {
            tipo: 'normas',
            version_formato: '1.0',
            fecha_exportacion: new Date().toISOString(),
            cantidad: normas.length,
            normas: normas.map(n => {
                const plain = n.toJSON ? n.toJSON() : { ...n };
                return {
                    codigo: plain.codigo,
                    titulo: plain.titulo,
                    organismo: plain.organismo,
                    anio: plain.anio,
                    version: plain.version,
                    aplica_a: plain.aplicaAOpcion?.nombre || null,
                    descripcion: plain.descripcion,
                    _clave_unica: plain.codigo,
                };
            }),
        };
        res.json(paquete);
    } catch (err) {
        console.error('[normaRoutes] export error:', err);
        res.status(500).json({ error: 'Error al exportar normas' });
    }
});

router.post('/import/preview', verifyJwt, async (req, res) => {
    try {
        const paquete = req.body;
        if (!paquete || paquete.tipo !== 'normas' || !Array.isArray(paquete.normas)) {
            return res.status(400).json({ error: 'Paquete inválido' });
        }

        const existentes = await req.db.Norma.findAll({
            include: [{ model: req.db.NormaAplicaA, as: 'aplicaAOpcion', attributes: ['nombre'] }],
        });
        const existMap = {};
        for (const n of existentes) {
            const plain = n.toJSON ? n.toJSON() : { ...n };
            existMap[plain.codigo] = plain;
        }

        const CAMPOS = ['titulo', 'organismo', 'anio', 'version', 'aplica_a', 'descripcion'];
        let nNuevas = 0, nDifieren = 0, nIguales = 0;

        const preview = paquete.normas.map(item => {
            const codigo = item._clave_unica || item.codigo;
            const ex = existMap[codigo];
            if (!ex) {
                nNuevas++;
                return { codigo, titulo: item.titulo, estado: 'nueva', diferencias: [], selected: true };
            }
            // Compare field by field
            const diferencias = [];
            for (const campo of CAMPOS) {
                let valEx, valIm;
                if (campo === 'aplica_a') {
                    valEx = ex.aplicaAOpcion?.nombre || '';
                    valIm = item.aplica_a || '';
                } else {
                    valEx = ex[campo] != null ? String(ex[campo]).trim() : '';
                    valIm = item[campo] != null ? String(item[campo]).trim() : '';
                }
                if (valEx !== valIm) {
                    diferencias.push({ campo, antes: valEx || '(vacío)', despues: valIm || '(vacío)' });
                }
            }
            if (diferencias.length > 0) {
                nDifieren++;
                return { codigo, titulo: item.titulo, estado: 'difiere', diferencias, selected: true };
            }
            nIguales++;
            return { codigo, titulo: item.titulo, estado: 'igual', diferencias: [], selected: false };
        });

        res.json({
            tipo: paquete.tipo,
            version_formato: paquete.version_formato,
            fecha_exportacion: paquete.fecha_exportacion,
            cantidad: preview.length,
            nuevas: nNuevas,
            difieren: nDifieren,
            iguales: nIguales,
            preview,
        });
    } catch (err) {
        console.error('[normaRoutes] import preview error:', err);
        res.status(500).json({ error: 'Error al previsualizar importación' });
    }
});

router.post('/import', verifyJwt, async (req, res) => {
    try {
        const { normas: items, seleccionados } = req.body;
        if (!Array.isArray(items)) {
            return res.status(400).json({ error: 'Paquete inválido: se esperaba array normas[]' });
        }

        // Only process selected codigos
        const selectedSet = Array.isArray(seleccionados) ? new Set(seleccionados) : null;

        // Load aplica_a options for matching
        const aplicaAOpts = await req.db.NormaAplicaA.findAll();
        const aplicaAMap = {};
        for (const o of aplicaAOpts) {
            aplicaAMap[o.nombre.toLowerCase()] = o.id;
        }

        const resultados = { creadas: 0, actualizadas: 0, sin_cambios: 0, errores: [], detalle: [] };

        for (const item of items) {
            const codigo = item._clave_unica || item.codigo;

            // Skip if not selected
            if (selectedSet && !selectedSet.has(codigo)) {
                resultados.sin_cambios++;
                continue;
            }

            try {
                const existente = await req.db.Norma.findOne({ where: { codigo } });

                // Resolve aplica_a name to ID
                let aplicaAId = null;
                if (item.aplica_a) {
                    aplicaAId = aplicaAMap[item.aplica_a.toLowerCase()] || null;
                    if (!aplicaAId) {
                        const [maxRow] = await req.db.NormaAplicaA.findAll({ order: [['orden', 'DESC']], limit: 1 });
                        const nextOrden = (maxRow?.orden || 0) + 1;
                        const newOpt = await req.db.NormaAplicaA.create({ nombre: item.aplica_a, orden: nextOrden });
                        aplicaAId = newOpt.id;
                        aplicaAMap[item.aplica_a.toLowerCase()] = aplicaAId;
                    }
                }

                if (existente) {
                    await existente.update({
                        titulo: item.titulo,
                        organismo: item.organismo || null,
                        anio: item.anio || null,
                        version: item.version || null,
                        descripcion: item.descripcion || null,
                        aplicaAId: aplicaAId,
                        // PDF archivos NOT touched
                    });
                    resultados.actualizadas++;
                    resultados.detalle.push({ codigo, accion: 'actualizada' });
                } else {
                    await req.db.Norma.create({
                        codigo: item.codigo,
                        titulo: item.titulo,
                        organismo: item.organismo || null,
                        anio: item.anio || null,
                        version: item.version || null,
                        descripcion: item.descripcion || null,
                        aplicaAId: aplicaAId,
                    });
                    resultados.creadas++;
                    resultados.detalle.push({ codigo, accion: 'creada' });
                }
            } catch (itemErr) {
                resultados.errores.push({ codigo, error: itemErr.message });
            }
        }

        res.json(resultados);
    } catch (err) {
        console.error('[normaRoutes] import error:', err);
        res.status(500).json({ error: 'Error al importar normas: ' + err.message });
    }
});

// ─── CRUD ───────────────────────────────────────────────────
router.get('/', verifyJwt, normaController.getNormas);
router.get('/:id', verifyJwt, normaController.getNorma);
router.post('/', verifyJwt, normaController.createNorma);
router.put('/:id', verifyJwt, normaController.updateNorma);
router.delete('/:id', verifyJwt, normaController.deleteNorma);

// ─── Archivo (PDF) ──────────────────────────────────────────
router.post('/:id/upload', verifyJwt, upload.single('file'), normaController.uploadArchivo);
router.get('/:id/download', verifyJwt, normaController.downloadArchivo);
router.delete('/:id/file', verifyJwt, normaController.deleteArchivo);

module.exports = router;
