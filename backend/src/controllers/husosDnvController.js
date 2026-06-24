'use strict';

/**
 * GET /api/husos-dnv
 *
 * Devuelve la lista de HusoDNV activos. Opcionalmente filtrada por TMN del
 * agregado: ?tmnMm=19 incluye husos con tmnMm entre [tmn-5, tmn+15] (heurística
 * razonable según rangos típicos del Pliego).
 *
 * Si tmnMm no se provee, devuelve todos los husos.
 */
const getHusosDnv = async (req, res) => {
    try {
        const tmnQ = req.query.tmnMm != null ? Number(req.query.tmnMm) : null;

        const husos = await req.db.HusoDNV.findAll({
            where: { activo: true },
            order: [['orden', 'ASC']],
            include: [{
                model: req.db.HusoDNVPunto,
                as: 'puntos',
                include: [{ model: req.db.Tamiz, as: 'tamiz' }],
            }],
        });

        let list = husos.map((h) => ({
            idHusoDNV: h.idHusoDNV,
            codigo: h.codigo,
            nombre: h.nombre,
            tipoTBS: h.tipoTBS,
            capa: h.capa,
            tmnMm: Number(h.tmnMm),
            tablaPliego: h.tablaPliego,
        }));

        if (tmnQ != null && !isNaN(tmnQ)) {
            // Filtrar por cercanía al TMN del agregado:
            //   - Incluir husos con tmnMm en [tmn - 5, tmn + 15]
            //   - Si ninguno matchea, devolver todos (para no dejar al usuario sin opciones)
            const filtrados = list.filter((h) => h.tmnMm >= tmnQ - 5 && h.tmnMm <= tmnQ + 15);
            if (filtrados.length > 0) list = filtrados;
        }

        res.json(list);
    } catch (err) {
        console.error('[getHusosDnv]', err);
        res.status(500).json({ error: err.message });
    }
};

/**
 * GET /api/husos-dnv/:id
 *
 * Devuelve un HusoDNV con sus puntos (% pasa min/max) y el detalle del tamiz
 * de cada punto (abertura + designación). Usado por el editor de granulometría
 * para resaltar los tamices recomendados por el huso declarado como referencia.
 */
const getHusoDnvById = async (req, res) => {
    try {
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
            return res.status(400).json({ error: 'id inválido' });
        }
        const huso = await req.db.HusoDNV.findByPk(id, {
            include: [{
                model: req.db.HusoDNVPunto,
                as: 'puntos',
                include: [{ model: req.db.Tamiz, as: 'tamiz' }],
            }],
        });
        if (!huso) return res.status(404).json({ error: 'Huso no encontrado' });
        res.json({
            idHusoDNV: huso.idHusoDNV,
            codigo: huso.codigo,
            nombre: huso.nombre,
            tipoTBS: huso.tipoTBS,
            capa: huso.capa,
            tmnMm: Number(huso.tmnMm),
            tablaPliego: huso.tablaPliego,
            puntos: (huso.puntos || [])
                .map((p) => ({
                    aberturaMm: Number(p.tamiz?.aberturaMm),
                    designacion: p.tamiz?.designacion,
                    pasaPctMin: Number(p.pasaPctMin),
                    pasaPctMax: Number(p.pasaPctMax),
                }))
                .sort((a, b) => (b.aberturaMm ?? 0) - (a.aberturaMm ?? 0)),
        });
    } catch (err) {
        console.error('[getHusoDnvById]', err);
        res.status(500).json({ error: err.message });
    }
};

module.exports = { getHusosDnv, getHusoDnvById };
