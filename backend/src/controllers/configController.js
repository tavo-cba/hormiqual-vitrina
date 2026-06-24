const configService = require('../services/configService');
const axios = require('axios');
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// const { invalidatePortalConfigCache } = require('../routes/publicTenantRoutes');
const invalidatePortalConfigCache = () => {}; // no-op (portal público fuera de alcance)

const getConfig = async (req, res) => {
  try {
    const data = await configService.getConfig(req.db);
    // [DEBUG-DOSIF] Exponemos el flag de ambiente (no es config de tenant) para
    // que el frontend muestre la opción de dosificación de depuración sólo
    // cuando está habilitada. Removible con grep.
    const allowDebugDosificacion =
      String(process.env.ALLOW_DEBUG_DOSIFICACION || '').toLowerCase() === 'true';
    res.status(200).json({ ...data, allowDebugDosificacion });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
};
const getAllConfig = async (req, res) => {
  try {
    const data = await configService.getAllConfig(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
};

const getFacturacionConfig = async (req, res) => {
  try {
    const data = await configService.getFacturacionConfig(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
};

const getPlanillaConfig = async (req, res) => {
  try {
    const data = await configService.getPlanillaConfig(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
};

const getProbetasConfig = async (req, res) => {
  try {
    const data = await configService.getProbetasConfig(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener la configuración' });
  }
};

const getKeys = async (req, res) => {
  try {
    const data = await configService.getKeys(req.db);
    res.status(200).json(data);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al obtener las keys' });
  }
};

const updateConfig = async (req, res) => {
  try {
    // Sprint 3 (sesión 2026-05-10) — gate específico para campos sensibles.
    // Si el body incluye `aprobacionAutomaticaEnsayos`, exigir que el user
    // tenga la acción CAMBIAR_CONFIG_APROBACION_AUTOMATICA (rol DT).
    // El resto de los campos sigue con el gate general del endpoint.
    if (Object.prototype.hasOwnProperty.call(req.body, 'aprobacionAutomaticaEnsayos')) {
      const { puedeAccionCalidad, ACCIONES } = require('../domain/roles/calidadGates');
      const r = puedeAccionCalidad(req.user, ACCIONES.CAMBIAR_CONFIG_APROBACION_AUTOMATICA);
      if (!r.allowed) {
        return res.status(403).json({
          error: 'Cambiar la aprobación automática de ensayos requiere rol Director Técnico (IRAM 1666:2020 §A.7).',
          accion: ACCIONES.CAMBIAR_CONFIG_APROBACION_AUTOMATICA,
          motivo: r.motivo,
        });
      }
    }
    const updated = await configService.updateConfig(req.db, req.body, {
      user: req.user,
      ip: req.ip || req.headers['x-forwarded-for'] || null,
      motivo: req.body?._motivo || null,
    });
    // Cualquier cambio en Config invalida el cache de portal-config (themeColor,
    // logos, portalUrl, etc.) para que el portal vea los cambios al toque.
    try { invalidatePortalConfigCache(); } catch (e) { /* best-effort */ }
    res.status(200).json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al actualizar la configuración' });
  }
};

const getConfigHealth = async (req, res) => {
  try {
    const config = await req.db.Config.findOne({ raw: true });
    if (!config) {
      return res.json({ ok: false, error: 'No hay Config cargada', checks: {} });
    }

    const fs = require('fs');
    const checks = {
      nombreEmpresa: !!config.nombreEmpresa,
      logo: !!(config.logoLink || config.thumbnail),
      mail: !!(config.mailHost && config.mailUser && config.mailPassword),
      s3: !!(config.s3Bucket && config.s3AccessKeyId && config.s3SecretAccessKey),
      afipCuit: !!config.facturacionCuit,
      afipCerts: !!(config.afipKeyPath && config.afipCertPath),
      afipCertsExisten: !!(
        config.afipKeyPath && config.afipCertPath &&
        fs.existsSync(config.afipKeyPath) && fs.existsSync(config.afipCertPath)
      ),
      afipPuntoVenta: !!config.facturacionPuntoVenta,
      afipCbu: !!config.facturacionCbu,
    };

    const faltantes = Object.entries(checks)
      .filter(([, ok]) => !ok)
      .map(([key]) => key);

    res.json({
      ok: faltantes.length === 0,
      tenant: req.db._tenantId,
      faltantes,
      checks,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Error al validar configuración' });
  }
};

const getLogo = async (req, res) => {
  try {
    const config = await req.db.Config.findOne({ attributes: ['logoLink', 'logoLightLink'] });
    // variant=light → logo para fondos claros (PDFs). El logoLink por defecto
    // suele ser el de tema oscuro (claro/blanco) e "se pierde" sobre papel.
    const imageUrl = req.query.variant === 'light'
      ? (config?.logoLightLink || config?.logoLink)
      : (config?.logoLink || config?.logoLightLink);
    if (!imageUrl) {
      return res.status(404).send('No logo configured');
    }
    const response = await axios.get(imageUrl, {
      responseType: 'arraybuffer',
      timeout: 10000,
    });
    const ct = response.headers['content-type'] || 'image/png';
    res.setHeader('Content-Type', ct);
    res.setHeader('Cache-Control', 'public, max-age=86400');
    res.send(Buffer.from(response.data));
  } catch (err) {
    console.error('Error al obtener logo:', err.message);
    res.status(502).send('Logo fetch error');
  }
};

/**
 * Resuelve un short link de Google Maps (maps.app.goo.gl/...).
 * Sigue los redirects paso a paso recolectando todas las URLs intermedias,
 * luego busca coordenadas en cualquiera de ellas.
 */
const resolveMapShortLink = async (req, res) => {
  const { url } = req.query;
  if (!url || typeof url !== 'string') {
    return res.status(400).json({ error: 'Falta el parámetro url' });
  }
  const allowed = ['maps.app.goo.gl', 'goo.gl', 'maps.google.com', 'www.google.com'];
  try {
    const parsed = new URL(url);
    if (!allowed.some(d => parsed.hostname === d || parsed.hostname.endsWith('.' + d))) {
      return res.status(400).json({ error: 'URL no válida' });
    }
  } catch {
    return res.status(400).json({ error: 'URL no válida' });
  }

  try {
    // Estrategia: seguir todos los redirects con headers de browser real,
    // luego buscar coordenadas en la URL final + body HTML
    const response = await axios.get(url, {
      maxRedirects: 10,
      timeout: 10000,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'es-AR,es;q=0.9,en;q=0.8',
      },
      // Capturar la URL final después de todos los redirects
      responseType: 'text',
    });

    const finalUrl = response.request?.res?.responseUrl || response.request?.responseURL || url;
    const body = typeof response.data === 'string' ? response.data : '';

    // Patrones para extraer coordenadas (orden de prioridad: más preciso primero).
    // `!8m2!3d!4d` y `!3d!4d` son la geometría real del pin (precisión completa).
    // `@lat,lng,zoom` es el centro de cámara y suele estar redondeado para el viewport,
    // por eso queda último entre las URL params.
    const patterns = [
      /!8m2!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
      /!3d(-?\d+\.\d+)!4d(-?\d+\.\d+)/,
      /\/search\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /[?&]q=(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /place\/(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /destination=(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /center=(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /@(-?\d+\.\d+),\+?(-?\d+\.\d+)/,
      /\\u0022(-?\d+\.\d{4,}),(-?\d+\.\d{4,})\\u0022/,
      /\[null,null,(-?\d+\.\d{4,}),(-?\d+\.\d{4,})\]/,
    ];

    // Buscar en la URL final primero
    for (const regex of patterns) {
      const match = finalUrl.match(regex);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return res.json({ resolvedUrl: finalUrl, lat, lng });
        }
      }
    }

    // Buscar en el body HTML (Google embeds coords en el markup)
    for (const regex of patterns) {
      const match = body.match(regex);
      if (match) {
        const lat = parseFloat(match[1]);
        const lng = parseFloat(match[2]);
        if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180) {
          return res.json({ resolvedUrl: finalUrl, lat, lng });
        }
      }
    }

    // Fallback: buscar cualquier par de coordenadas en el body que parezcan lat/lng de Argentina
    const fallbackMatch = body.match(/(-?\d{1,2}\.\d{5,})[,\s]+(-?\d{1,3}\.\d{5,})/);
    if (fallbackMatch) {
      const lat = parseFloat(fallbackMatch[1]);
      const lng = parseFloat(fallbackMatch[2]);
      if (Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && lat !== 0 && lng !== 0) {
        return res.json({ resolvedUrl: finalUrl, lat, lng });
      }
    }

    res.json({ resolvedUrl: finalUrl, lat: null, lng: null });
  } catch (err) {
    // En caso de error, intentar extraer de headers de redirect
    if (err.response?.request?.res?.responseUrl) {
      const redirectUrl = err.response.request.res.responseUrl;
      const match = redirectUrl.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/);
      if (match) {
        return res.json({ resolvedUrl: redirectUrl, lat: parseFloat(match[1]), lng: parseFloat(match[2]) });
      }
    }
    console.error('Error resolviendo short link:', err.message);
    res.status(502).json({ error: 'No se pudo resolver el link' });
  }
};

module.exports = { getConfig, updateConfig, getKeys, getAllConfig, getFacturacionConfig, getPlanillaConfig, getProbetasConfig, getConfigHealth, getLogo, resolveMapShortLink };