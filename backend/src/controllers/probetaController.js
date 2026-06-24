const probetaService = require("../services/probetaService");

/**
 * GET /api/probetas
 */
const getProbetas = async (req, res) => {
  try {
    const { idEstadoProbeta, origen } = req.query;
    // origen: 'propias' | 'paston' | undefined ('todas' por back-compat).
    const origenValido = ['propias', 'paston', 'todas'].includes(origen) ? origen : 'todas';
    const data = await probetaService.getProbetas(
      req.db,
      idEstadoProbeta ? idEstadoProbeta : null,
      origenValido
    );
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener probetas" });
  }
};

const getProbetasTerceros = async (req, res) => {
  try {
    const data = await probetaService.getProbetasTerceros(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener probetas" });
  }
};

/**
 * GET /api/probetas/:id
 */
const getProbeta = async (req, res) => {
  try {
    const probeta = await probetaService.getProbeta(req.db, req.params.id);
    res.status(200).json(probeta);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener la probeta" });
  }
};

// [VITRINA] GET /api/probetas/estados — catálogo de estados de probeta (reemplaza
// al recortado /api/despachos/estadoprobeta).
const getEstadosProbeta = async (req, res) => {
  try {
    const estados = await probetaService.getEstadosProbeta(req.db);
    res.status(200).json(estados);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener los estados de probeta" });
  }
};

/**
 * POST /api/probetas
 */
const createProbeta = async (req, res) => {
  try {
    const nueva = await probetaService.createProbeta(req.db, req.body);
    res.status(201).json(nueva);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al crear la probeta" });
  }
};

/**
 * PUT /api/probetas/:id
 */
const updateProbeta = async (req, res) => {
  try {
    const act = await probetaService.updateProbeta(
      req.db,
      req.params.id,
      req.body
    );
    res.status(200).json(act);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar la probeta" });
  }
};

/**
 * DELETE /api/probetas/:id
 */
const deleteProbeta = async (req, res) => {
  try {
    await probetaService.deleteProbeta(req.db, req.params.id);
    res.status(200).json({ message: "Probeta eliminada correctamente" });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al eliminar la probeta" });
  }
};
const createEnsayo = async (req, res) => {
  try {
    // M-LOG-11 (auditoría 08, Bloque 13): pasamos `idEmpleado` para registrar
    // trazabilidad cuando la config global `aprobacionAutomaticaEnsayos` está
    // activada (queda firmado en el ensayo + log estructurado).
    const ensayo = await probetaService.createEnsayoResistencia(
      req.db,
      req.body,
      req.user?.idEmpleado ?? null
    );
    res.status(201).json(ensayo);
  } catch (err) {
    console.error(err);
    if (err.status) {
      return res.status(err.status).json({ error: err.message });
    }
    if (err.message.startsWith("El campo")) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: err.message });
  }
};
const updateEnsayo = async (req, res) => {
  try {
    const ensayo = await probetaService.updateEnsayoResistencia(
      req.db,
      req.params.id,
      req.body
    );
    res.status(200).json(ensayo);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al actualizar el ensayo" });
  }
};

const getResistencias = async (req, res) => {
  try {
    const rows = await probetaService.getResistencias(req.db, req.query);
    res.status(200).json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al generar el reporte" });
  }
};

const getProbetasFiltradas = async (req, res) => {
  try {
    const data = await probetaService.getProbetasFiltradas(req.db, req.query);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener probetas" });
  }
};
const getProbetasWeb = async (req, res) => {
  try {
    const data = await probetaService.getProbetasWeb(req.db, req.body);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener probetas" });
  }
};

const getProbetaTemperaturaWeb = async (req, res) => {
  try {
    const { razonSocial, cuit } = req.body || {};
    const data = await probetaService.getProbetaTemperaturaWeb(req.db, req.params.id, { razonSocial, cuit });
    if (data === null) return res.status(404).json({ error: 'No hay registros de temperatura para esta probeta' });
    if (data === 'forbidden') return res.status(403).json({ error: 'Esta probeta no pertenece a la cuenta' });
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getProbetaTemperaturaWeb:', err);
    res.status(500).json({ error: 'Error al obtener la temperatura de la probeta' });
  }
};

const generatePDF = async (req, res) => {
  try {
    const parseBoolean = (value, fallback = false) => {
      if (value === undefined || value === null) return fallback;
      if (typeof value === 'boolean') return value;
      if (typeof value === 'number') return value === 1;
      if (typeof value === 'string') {
        const normalized = value.trim().toLowerCase();
        if (normalized === 'true' || normalized === '1') return true;
        if (normalized === 'false' || normalized === '0') return false;
      }
      return fallback;
    };

    const clienteNombre = req.body.params.idCliente
      ? req.body.clienteNombre || 'Cliente'
      : 'Todos';

    const safeCliente = (clienteNombre || 'Cliente')
      .toString()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[\\/*?"<>|]+/g, '');

    const dayjs = require('dayjs');
    const fechaHora = dayjs().format('DD-MM-YYYY HH:mm');
    const fileName = `Reporte Resistencias ${safeCliente} ${fechaHora}.pdf`;

    const params = { ...(req.body.params || {}) };

    if (params.tipoHormigon && !params.idTipoHormigon) {
      params.idTipoHormigon = params.tipoHormigon;
    }
    if (params.fechaDesde && !params.desde) {
      const desde = dayjs(params.fechaDesde);
      if (desde.isValid()) {
        params.desde = desde.format('YYYY-MM-DD');
      }
    }
    if (params.fechaHasta && !params.hasta) {
      const hasta = dayjs(params.fechaHasta);
      if (hasta.isValid()) {
        params.hasta = hasta.add(1, 'day').format('YYYY-MM-DD');
      }
    }

    const esOficial = parseBoolean(req.body?.esOficial ?? req.body?.params?.esOficial, false);
    const pdfBuffer = await probetaService.generateResistancePDF(
      req.db,
      params,
      req.body.empleadoFirma,
      req.body.productorHormigon,
      req.body.configEmpresa,
      {
        esOficial,
        idEmpleado: req.user?.idEmpleado,
        fileName,
      }
    );

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
    res.send(Buffer.from(pdfBuffer));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Error al generar el PDF' });
  }
};

const getEnsayosPendientesRevision = async (req, res) => {
  try {
    const data = await probetaService.getEnsayosPendientesRevision(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al obtener ensayos pendientes de revisión" });
  }
};

const getEnsayoRevisionDetalle = async (req, res) => {
  try {
    const data = await probetaService.getEnsayoRevisionDetalle(req.db, req.params.id);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || "Error al obtener detalle del ensayo" });
  }
};

const aprobarEnsayo = async (req, res) => {
  try {
    // C-SEC-04 (auditoría 08): si el body trae `motivoAjuste`, lo
    // pasamos al service. Si hay diff entre lo que el revisor envía y el
    // ensayo original, el service exige el motivo (status 400).
    const { motivoAjuste, ...datosActualizados } = req.body || {};
    const ensayo = await probetaService.aprobarEnsayo(
      req.db,
      req.params.id,
      datosActualizados,
      req.user.idEmpleado,
      motivoAjuste,
    );
    res.status(200).json(ensayo);
  } catch (err) {
    console.error(err);
    if (err.status) {
      return res.status(err.status).json({
        error: err.message,
        diffs: err.diffs || undefined,
      });
    }
    if (err.message === 'Ensayo no encontrado' || err.message === 'El ensayo ya fue aprobado') {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: "Error al aprobar el ensayo" });
  }
};

const aprobarEnsayosMasivo = async (req, res) => {
  try {
    // Admin → null (sin filtro de planta). Resto → su lista de plantas.
    // El service descarta silenciosamente ensayos fuera de las plantas del usuario
    // (ver `ignoradosPorPlanta` en la respuesta). El log estructurado registra
    // qué se aprobó y qué se descartó por filtro.
    const plantaIds = req.user?.isAdmin === true ? null : (req.user?.plantaIds || []);
    const result = await probetaService.aprobarEnsayosMasivo(
      req.db,
      req.body.ids,
      req.user.idEmpleado,
      plantaIds,
      { user: req.user, motivoAprobacionMasiva: req.body.motivoAprobacionMasiva },
    );
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({
      error: err.message,
      motivo: err.motivo,
      desvios: err.desvios,
      requierePermisoDesvios: err.requierePermisoDesvios,
    });
    console.error(err);
    res.status(500).json({ error: "Error al aprobar los ensayos" });
  }
};

const getCountEnsayosPendientes = async (req, res) => {
  try {
    const count = await probetaService.getCountEnsayosPendientes(req.db);
    res.status(200).json({ count });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: "Error al contar ensayos pendientes" });
  }
};

/**
 * POST /api/probetas/:id/anular
 * Mej-16 auditoría 08: anular una probeta con motivo (estado DESCARTADA
 * + trazabilidad). Rechaza si la probeta tiene ensayo aprobado.
 */
async function anularProbeta(req, res) {
  try {
    const { motivo } = req.body || {};
    const result = await probetaService.anularProbeta(
      req.db,
      req.params.id,
      motivo,
      req.user?.idEmpleado,
    );
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message });
    console.error('Error anularProbeta:', err);
    res.status(500).json({ error: err.message || 'Error al anular la probeta' });
  }
}

/**
 * POST /api/probetas/ensayo/:id/desaprobar
 * Mej-17 auditoría 08: revertir aprobación de un ensayo con motivo.
 * El ensayo vuelve a `pendienteRevision = true` y queda trazabilidad.
 */
async function desaprobarEnsayo(req, res) {
  try {
    const { motivo } = req.body || {};
    const result = await probetaService.desaprobarEnsayo(
      req.db,
      req.params.id,
      motivo,
      req.user?.idEmpleado,
      { user: req.user },
    );
    res.status(200).json(result);
  } catch (err) {
    if (err.status) return res.status(err.status).json({ error: err.message, motivo: err.motivo });
    console.error('Error desaprobarEnsayo:', err);
    res.status(500).json({ error: err.message || 'Error al desaprobar el ensayo' });
  }
}

/**
 * POST /api/probetas/aceptacion-lote
 * N-03 auditoría 08: informe de aceptación de obra/lote (CIRSOC §4.3).
 *
 * Recibe filtros via body (POST porque la lista de filtros es compleja
 * y queremos evitar problemas de URL-encoding).
 */
async function getAceptacionLote(req, res) {
  try {
    const params = req.body || {};
    if (!params.edadDiseno) {
      return res.status(400).json({ error: 'edadDiseno es obligatorio.' });
    }
    if (!params.idDosificacion && !params.idTipoHormigon) {
      return res.status(400).json({
        error: 'Para emitir un informe de aceptación de lote es obligatorio filtrar por idDosificacion o idTipoHormigon (lote homogéneo).',
      });
    }
    const data = await probetaService.getAceptacionLote(req.db, params);
    if (!data) {
      return res.status(404).json({ error: 'No se encontraron muestras que cumplan los filtros.' });
    }
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getAceptacionLote:', err);
    res.status(500).json({ error: err.message || 'Error al obtener informe de aceptación' });
  }
}

/**
 * POST /api/probetas/aceptacion-lote/pdf
 *
 * Renderiza el informe N-03 como PDF usando el motor HTML→Puppeteer.
 * Reemplaza el generador cliente-side jsPDF (que tenía limitaciones
 * serias de diseño y la capa de texto rota). Devuelve directamente el
 * stream binario `application/pdf`.
 *
 * Se elimina el toggle PRESCRIPTIVO/PRESTACIONAL — la distinción no
 * tiene sentido en el ámbito de aceptación de probetas (ver discusión
 * en commit del refactor; f'c es un valor objetivo y medible, no hay
 * "catálogo del tenant" que pueda relativizarlo).
 */
async function getAceptacionLotePdf(req, res) {
  try {
    const params = req.body || {};
    if (!params.edadDiseno) {
      return res.status(400).json({ error: 'edadDiseno es obligatorio.' });
    }
    if (!params.idDosificacion && !params.idTipoHormigon) {
      return res.status(400).json({
        error: 'Para emitir un informe de aceptación de lote es obligatorio filtrar por idDosificacion o idTipoHormigon (lote homogéneo).',
      });
    }

    const data = await probetaService.getAceptacionLote(req.db, params);
    if (!data) {
      return res.status(404).json({ error: 'No se encontraron muestras que cumplan los filtros.' });
    }

    // Cargar datos del tenant (logo + nombre + dirección + cuit) para el header.
    const config = await req.db.Config.findOne({
      attributes: ['nombreEmpresa', 'direccionEmpresa', 'cuitEmpresa', 'logoLink', 'logoLightLink', 'thumbnail'],
    });
    let logoDataUrl = null;
    // Probamos URLs en orden: thumbnail (es el que dosificacionInformePdf
    // usa con éxito en este tenant — empíricamente probado) → logoLink →
    // logoLightLink. Si thumbnail es null, caemos a las otras opciones.
    const candidates = [config?.thumbnail, config?.logoLink, config?.logoLightLink].filter(Boolean);
    if (candidates.length === 0) {
      console.warn('[aceptacionLote PDF] Tenant sin logo configurado (logoLink/logoLightLink/thumbnail todos null).');
    }
    for (const logoUrl of candidates) {
      try {
        const axios = require('axios');
        const response = await axios.get(logoUrl, { responseType: 'arraybuffer', timeout: 10000 });
        const ct = response.headers['content-type'] || 'image/png';
        // Intentar aplanar con Sharp si está disponible. Si Sharp no se
        // instaló o el formato es exótico, hacemos fallback a base64 directo.
        let pngBuffer = null;
        try {
          const sharp = require('sharp');
          pngBuffer = await sharp(Buffer.from(response.data))
            .flatten({ background: { r: 255, g: 255, b: 255 } })
            .png({ compressionLevel: 8 })
            .toBuffer();
          logoDataUrl = `data:image/png;base64,${pngBuffer.toString('base64')}`;
          console.log(`[aceptacionLote PDF] Logo cargado (sharp.flatten) desde ${logoUrl.substring(0, 80)}...`);
        } catch (sharpErr) {
          logoDataUrl = `data:${ct};base64,${Buffer.from(response.data).toString('base64')}`;
          console.warn(`[aceptacionLote PDF] Sharp no disponible o falló (${sharpErr.message}); usando logo crudo de ${logoUrl.substring(0, 80)}...`);
        }
        break; // Funcionó, no probamos los siguientes candidatos.
      } catch (err) {
        console.warn(`[aceptacionLote PDF] Falló descarga de ${logoUrl?.substring(0, 80)}: ${err.message}. Probando siguiente...`);
      }
    }

    const { renderTemplate } = require('../services/pdfRenderer');
    const pdfBuffer = await renderTemplate('aceptacionLote', {
      ...data,
      empresa: {
        nombre: config?.nombreEmpresa || 'HormiQual',
        direccion: config?.direccionEmpresa || null,
        cuit: config?.cuitEmpresa || null,
        logoDataUrl,
      },
    });

    const obraSlug = String(data.lote?.obra || 'obra')
      .toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
    const filename = `aceptacion-lote-${obraSlug}-${data.lote?.tipoHormigon || 'hormigon'}.pdf`;
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `inline; filename="${filename}"`);
    res.send(pdfBuffer);
  } catch (err) {
    console.error('Error getAceptacionLotePdf:', err);
    res.status(500).json({ error: err.message || 'Error al generar PDF del informe' });
  }
}

/**
 * GET /api/probetas/proximas-a-romper?dias=7
 * N-05 auditoría 08: vista de planificación diaria del laboratorio.
 */
async function getProximasARomper(req, res) {
  try {
    const dias = Number(req.query.dias) || 7;
    if (dias < 1 || dias > 60) {
      return res.status(400).json({ error: 'Parámetro `dias` debe estar entre 1 y 60.' });
    }
    // Admin → null (sin filtro). Resto → su lista de plantas.
    const plantaIds = req.user?.isAdmin === true ? null : (req.user?.plantaIds || []);
    const data = await probetaService.getProximasARomper(req.db, { dias, plantaIds });
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getProximasARomper:', err);
    res.status(500).json({ error: 'Error al obtener probetas próximas a romper' });
  }
}

async function getProbetaTemperatura(req, res) {
  try {
    const data = await probetaService.getProbetaTemperatura(req.db, req.params.id);
    if (!data) return res.status(404).json({ error: 'Sin datos de temperatura (probeta sin pileta asignada)' });
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getProbetaTemperatura:', err);
    res.status(500).json({ error: 'Error al obtener temperatura de la probeta' });
  }
}

/**
 * POST /api/probetas/etiquetas-impresas
 * N-01 etiqueta QR (sesión 2026-05-09): el frontend llama a este endpoint
 * después de generar exitosamente el PDF de etiquetas, pasando el listado
 * de IDs de probetas incluidas. El backend marca cada una con timestamp +
 * empleado.
 */
async function marcarEtiquetasImpresas(req, res) {
  try {
    const { idsProbeta } = req.body || {};
    const result = await probetaService.marcarEtiquetasImpresas(
      req.db,
      idsProbeta,
      req.user?.idEmpleado ?? null,
    );
    res.status(200).json(result);
  } catch (err) {
    console.error('Error marcarEtiquetasImpresas:', err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    res.status(500).json({ error: 'Error al marcar etiquetas como impresas' });
  }
}

/**
 * GET /api/probetas/etiquetas-pendientes
 * N-01 etiqueta QR: probetas en estados ensayables (CURANDO/PENDIENTE) cuya
 * etiqueta aún no se imprimió. Soporta filtros opcionales: idPlanta, desde,
 * hasta (rango de fechas de moldeo).
 */
async function getEtiquetasPendientes(req, res) {
  try {
    const { idPlanta, desde, hasta } = req.query || {};
    const data = await probetaService.getEtiquetasPendientes(req.db, {
      idPlanta: idPlanta ? Number(idPlanta) : null,
      desde: desde || null,
      hasta: hasta || null,
    });
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getEtiquetasPendientes:', err);
    res.status(500).json({ error: 'Error al obtener etiquetas pendientes' });
  }
}

/**
 * POST /api/probetas/etiquetas-por-muestras
 * N-01 etiqueta QR (sesión 2026-05-28): trae todas las probetas activas
 * (CURANDO/PENDIENTE) asociadas a un set de muestras. Lo invoca el botón
 * "Etiquetas QR" de la pantalla de Muestras (multi-select). El frontend
 * después llama a `POST /etiquetas-impresas` con los `idsProbeta` impresos.
 *
 * Body: { idsMuestra: number[], origen?: 'propia'|'tercero' }
 */
async function getEtiquetasPorMuestras(req, res) {
  try {
    const { idsMuestra, origen } = req.body || {};
    const data = await probetaService.getProbetasParaEtiquetasPorMuestras(
      req.db,
      idsMuestra,
      { origen: origen || 'propia' },
    );
    res.status(200).json(data);
  } catch (err) {
    console.error('Error getEtiquetasPorMuestras:', err && err.stack ? err.stack : err);
    if (err.status) return res.status(err.status).json({ error: err.message });
    const detail = process.env.NODE_ENV === 'production' ? undefined : err.message;
    res.status(500).json({
      error: 'Error al obtener probetas de las muestras seleccionadas',
      ...(detail ? { detail } : {}),
    });
  }
}

module.exports = {
  getProbetas,
  getProbeta,
  getEstadosProbeta,
  createProbeta,
  updateProbeta,
  deleteProbeta,
  createEnsayo,
  updateEnsayo,
  getResistencias,
  getProbetasTerceros,
  getProbetasFiltradas,
  getProbetasWeb,
  getProbetaTemperaturaWeb,
  generatePDF,
  getEnsayosPendientesRevision,
  getEnsayoRevisionDetalle,
  aprobarEnsayo,
  aprobarEnsayosMasivo,
  getCountEnsayosPendientes,
  getProbetaTemperatura,
  getProximasARomper,
  getAceptacionLote,
  getAceptacionLotePdf,    // Render HTML→PDF (Puppeteer) — reemplaza jsPDF cliente.
  anularProbeta,        // Mej-16 auditoría 08
  desaprobarEnsayo,     // Mej-17 auditoría 08
  marcarEtiquetasImpresas,    // N-01 etiqueta QR (sesión 2026-05-09)
  getEtiquetasPendientes,     // N-01 etiqueta QR (sesión 2026-05-09)
  getEtiquetasPorMuestras,    // N-01 etiqueta QR (sesión 2026-05-28)
};
