require("dotenv").config();   // lee .env y llena process.env

const express = require('express');
const bodyParser = require('body-parser');

// Importo rutas
const authRoutes = require('./src/routes/authRoutes');
const empleadoRoutes = require('./src/routes/empleadoRoutes');
const clienteRoutes = require('./src/routes/clienteRoutes');
const obraRoutes = require('./src/routes/obraRoutes');
const plantaRoutes = require('./src/routes/plantaRoutes');
const prensaRoutes = require('./src/routes/prensaRoutes');
const equipoLaboratorioRoutes = require('./src/routes/equipoLaboratorioRoutes');
const laboratorioRoutes = require('./src/routes/laboratorioRoutes');
const calibracionEquipoRoutes = require('./src/routes/calibracionEquipoRoutes');
const herramientasCalidadRoutes = require('./src/routes/herramientasCalidadRoutes');
const agregadoRoutes = require('./src/routes/agregadoRoutes');
const cementoRoutes = require('./src/routes/cementoRoutes');
const aguaRoutes = require('./src/routes/aguaRoutes');
const aditivoRoutes = require('./src/routes/aditivoRoutes');
const dosificacionRoutes = require("./src/routes/dosificacionRoutes");
const muestraRoutes = require("./src/routes/muestraRoutes");
const probetaRoutes = require("./src/routes/probetaRoutes");
const docsRoutes = require("./src/routes/docsRoutes");
const userRoutes = require("./src/routes/userRoutes");
const rolCalidadRoutes = require("./src/routes/rolCalidadRoutes");
const archivoRoutes = require("./src/routes/archivoRoutes");
const fibraRoutes = require("./src/routes/fibraRoutes");
const configRoutes = require('./src/routes/configRoutes');
const menuRoutes = require('./src/routes/menuRoutes');
const muestraTercerosRoutes = require('./src/routes/muestraTercerosRoutes');
const muestraPastonRoutes = require('./src/routes/muestraPastonRoutes');
const reporteResistenciaRoutes = require('./src/routes/reporteResistenciaRoutes');
const materialRoutes = require('./src/routes/materialRoutes');
const materialPrecioRoutes = require('./src/routes/materialPrecioRoutes');
const materialPlantaRoutes = require('./src/routes/materialPlantaRoutes');
const cementoPlantaRoutes = require('./src/routes/cementoPlantaRoutes');
const materialDocumentoRoutes = require('./src/routes/materialDocumentoRoutes');
const curvaGranulometricaRoutes = require('./src/routes/curvaGranulometricaRoutes');
const curvaSetRoutes = require('./src/routes/curvaSetRoutes');
const tamicesRoutes = require('./src/routes/tamicesRoutes');
const agregadoEnsayoRoutes = require('./src/routes/agregadoEnsayoRoutes');
const normaRoutes = require('./src/routes/normaRoutes');
const piletaRoutes = require('./src/routes/piletaRoutes');
const mezclaRoutes = require('./src/routes/mezclaRoutes');
const dosificacionDisenoRoutes = require('./src/routes/dosificacionDisenoRoutes');
const materialLivianoRoutes = require('./src/routes/materialLivianoRoutes');
const technicalEvidenceRoutes = require('./src/routes/technicalEvidenceRoutes');
const overrideRequestRoutes = require('./src/routes/overrideRequestRoutes');
const documentApprovalRequestRoutes = require('./src/routes/documentApprovalRequestRoutes');
const tipologiaHormigonRoutes = require('./src/routes/tipologiaHormigonRoutes');
const recetaObraRoutes = require('./src/routes/recetaObraRoutes');
const curvaCementoRoutes = require('./src/routes/curvaCementoRoutes');
const laboratorioReporteRoutes = require('./src/routes/laboratorioReporteRoutes');
const estadisticasDespachoRoutes = require('./src/routes/estadisticasDespachoRoutes');
const controlCalidadRoutes = require('./src/routes/controlCalidadRoutes');
const dashboardPlantaRoutes = require('./src/routes/dashboardPlantaRoutes');
const placaElastomeroRoutes = require('./src/routes/placaElastomeroRoutes');
const alertaCalidadRoutes = require('./src/routes/alertaCalidadRoutes');
const parametroTrabajabilidadRoutes = require('./src/routes/parametroTrabajabilidadRoutes');
const cors = require('cors');
const path = require('path');
const { connectMainDb, createDbConnection } = require('./src/models');
const { extractTenantFromRequest } = require("./src/middlewares/extractTenant");
const { onlyLocalhost } = require("./src/middlewares/onlyLocalhost");
const cacheManager = require('./src/cache/CacheManager');
const {
  initInvalidationBus,
  publishInvalidation,
  publishClear,
  publishClearAll,
} = require('./src/cache/invalidationBus');

const app = express();
const PORT = 3002;

// Servir archivos estáticos desde la carpeta uploads
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// [VITRINA] "*" se pasa como comodín real (string), no como ["*"] (whitelist literal,
// que el paquete cors nunca matchea -> no emite Access-Control-Allow-Origin). Solo se
// hace split() cuando hay una lista concreta de orígenes separados por coma.
const corsOrigins = process.env.CORS_ORIGINS;
const corsOriginConfig = (!corsOrigins || corsOrigins.trim() === '*')
  ? '*'
  : corsOrigins.split(',').map(o => o.trim());

const corsOptions = {
  origin: corsOriginConfig,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'x-tipo-agregado', 'x-tipo-equipo', 'x-tenant', 'x-lab-api-key'],
};

app.use(cors(corsOptions));

// Middleware para parsear JSON
app.use(bodyParser.json({ limit: '50mb' }));

// Middleware para ver subdominio
let tenant;
app.use(async (req, res, next) => {
  // [VITRINA] Bypass de tenant simplificado: quitados whatsapp/betonmatic/anviz.
  if (req.path.startsWith('/api/public') || req.path.startsWith('/api/laboratorio/reporte') || req.path.startsWith('/api/tamices')) return next();
  try {
    tenant = extractTenantFromRequest(req);
    req.db = await createDbConnection(tenant);
    next();
  } catch (err) {
    //console.error("Error creando conexión para tenant:", err.message, tenant);
    res.status(500).json({ error: 'Error de conexión con la base de datos del cliente' });
  }
});

// Rutas
app.use('/api/auth', authRoutes);
app.use('/api/empleados', empleadoRoutes);
app.use('/api/clientes', clienteRoutes);
app.use('/api/obras', obraRoutes);
app.use('/api/plantas', plantaRoutes);
app.use('/api/prensas', prensaRoutes);
app.use('/api/equipos-laboratorio', equipoLaboratorioRoutes);
app.use('/api/laboratorios', laboratorioRoutes);
app.use('/api/calibraciones-equipo', calibracionEquipoRoutes);
app.use('/api/herramientas-calidad', herramientasCalidadRoutes);
app.use('/api/agregados', agregadoRoutes);
app.use('/api/cementos', cementoRoutes);
app.use('/api/aguas', aguaRoutes);
app.use('/api/aditivos', aditivoRoutes);
app.use("/api/dosificaciones", dosificacionRoutes);
app.use("/api/muestras", muestraRoutes);
app.use("/api/probetas", probetaRoutes);
app.use("/api/docs", docsRoutes);
app.use("/api/users", userRoutes);
app.use("/api/calidad/roles", rolCalidadRoutes);
app.use("/api/archivos", archivoRoutes);
app.use("/api/fibras", fibraRoutes);
app.use("/api/config", configRoutes);
app.use('/api/menus', menuRoutes);
app.use("/api/muestras-terceros", muestraTercerosRoutes);
app.use('/api/muestras-pastones', muestraPastonRoutes);
// Endpoints internos del Portal de Empleados (sin requerir x-tenant) — DEBEN ir
// antes que internalRoutes para que express los matchee primero.
app.use('/api/reportes-resistencia', reporteResistenciaRoutes);
app.use('/api/materiales', materialRoutes);
app.use('/api/material-precios', materialPrecioRoutes);
app.use('/api/material-plantas', materialPlantaRoutes);
app.use('/api/cemento-plantas', cementoPlantaRoutes);
app.use('/api/calidad', materialDocumentoRoutes);
app.use('/api/curvas-granulometricas', curvaGranulometricaRoutes);
app.use('/api/tamices', tamicesRoutes);
app.use('/api/curva-sets', curvaSetRoutes);
app.use('/api/agregados-ensayos', agregadoEnsayoRoutes);
app.use('/api/normas', normaRoutes);
app.use('/api/piletas', piletaRoutes);
app.use('/api/mezclas', mezclaRoutes);
app.use('/api/dosificaciones-diseno', dosificacionDisenoRoutes);
app.use('/api/materiales-livianos', materialLivianoRoutes);
app.use('/api/technical-evidence', technicalEvidenceRoutes);
app.use('/api/override-requests', overrideRequestRoutes);
app.use('/api/document-approvals', documentApprovalRequestRoutes);
app.use('/api/tipologias-hormigon', tipologiaHormigonRoutes);
app.use('/api/recetas-obra', recetaObraRoutes);
app.use('/api/curvas-cemento', curvaCementoRoutes);
app.use('/api/laboratorio/reporte', laboratorioReporteRoutes);
app.use('/api/estadisticas-despachos', estadisticasDespachoRoutes);
app.use('/api/control-calidad', controlCalidadRoutes);

// Compensaciones

// Retenciones impositivas

// CRM — seguimiento comercial de presupuestos
app.use('/api/dashboard-planta', dashboardPlantaRoutes);
app.use('/api/placas-elastomero', placaElastomeroRoutes);
app.use('/api/alertas-calidad', alertaCalidadRoutes);

// Tablero Financiero

// Tablero Comercial (complementario al Financiero)

// Tablero RRHH (recursos humanos: dotación, asistencia, nómina, cumplimiento)

// Editor de PDF (firmas guardadas para estampar en documentos)

// Betonmatic
// Webhooks Betonmatic (sin JWT — autenticación por token en path, tenant por path)
// Stock propio de materiales (Fase 1)
app.use('/api/parametros-trabajabilidad', parametroTrabajabilidadRoutes);

// Solicitantes de presupuestos

// Pagos a empleados

// Configuración del dominio del Portal de Empleados (Vercel API)

// Cache stats (solo accesible desde localhost)
app.get('/internal/cache/stats', onlyLocalhost, (req, res) => {
  res.json(cacheManager.getAllStats());
});
app.post('/internal/cache/clear', onlyLocalhost, (req, res) => {
  const { tenant, namespace } = req.query;
  // Se propaga a todos los workers via bus (no solo al que atendio el request).
  if (tenant && namespace) {
    publishInvalidation(tenant, [namespace]);
  } else if (tenant) {
    publishClear(tenant);
  } else {
    publishClearAll();
  }
  res.json({ ok: true });
});

// Middleware de manejo global de errores
app.use((err, req, res, next) => {
  console.error('Error no controlado:', {
    path: req.path,
    method: req.method,
    tenant,
    message: err.message,
    stack: err.stack,
  });
  res.status(500).json({ error: 'Ocurrió un error inesperado' });
});

// Arrancar el servidor
// Referencia al server HTTP. Se asigna recien al hacer listen() (despues del
// warmup) para que el worker NO entre al balanceo de PM2 mientras esta frio.
let server;

(async () => {
  // ── Warmup ANTES de listen() ──────────────────────────────────────────────
  // listen() es lo que mete al worker al pool de balanceo de PM2 (NO el 'ready';
  // wait_ready solo retrasa cuando PM2 mata al worker viejo). Si escuchamos antes
  // de calentar, PM2 rutea conexiones nuevas al worker frio -> "F5 trabado".
  // Calentando primero, el worker viejo (ya caliente) sigue atendiendo y el nuevo
  // recien recibe trafico cuando termino de cargar modelos + abrir la conexion.
  // En paralelo + authenticate() para primar el pool y achicar la ventana.
  const t0 = Date.now();
  const tenants = Object.keys(process.env)
    .filter(k => k.startsWith('DATABASE_') && process.env[k])
    .map(k => k.replace('DATABASE_', '').toLowerCase());

  await Promise.allSettled(tenants.map(async (t) => {
    try {
      const db = await createDbConnection(t);
      await db.sequelize.authenticate();   // abre la conexion real (prima el pool)
      console.log(`[warmup] Tenant "${t}" listo`);
    } catch (err) {
      console.error(`[warmup] Error inicializando tenant "${t}":`, err.message);
    }
  }));
  console.log(`[warmup] Todos los tenants inicializados en ${Date.now() - t0}ms`);

  // Activar el bus de invalidacion de cache entre workers (cluster). Fail-safe:
  // si no corre bajo PM2, degrada a invalidacion local + TTL.
  initInvalidationBus();

  // ── Recien ahora escuchamos: el worker entra al balanceo YA caliente ──
  server = app.listen(PORT, () => {
    console.log(`Servidor corriendo en el puerto ${PORT}`);
    if (process.send) process.send('ready');
  });
  server.timeout = 600000;       // 10 min — para rutas largas (ej: resumen bancario con Claude Opus)
  server.headersTimeout = 610000;
  server.keepAliveTimeout = 600000;
})();

/* ─────────── Graceful shutdown ───────────
 * En reload/stop, PM2 pide cierre y recien tras kill_timeout manda SIGKILL.
 * Cerramos el server para drenar las requests en vuelo antes de salir.
 * - Linux/produccion: SIGINT / SIGTERM.
 * - Windows: PM2 manda el mensaje 'shutdown' (shutdown_with_message: true).
 */
let shuttingDown = false;
function gracefulShutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[shutdown] ${signal} recibido; cerrando servidor (drenando requests)...`);

  // Si el shutdown llega durante el warmup (antes del listen()), no hay server.
  if (!server) { process.exit(0); return; }

  // Dejar de aceptar conexiones nuevas; cuando terminen las en vuelo, salir.
  server.close((err) => {
    if (err) {
      console.error('[shutdown] Error cerrando servidor:', err.message);
      process.exit(1);
    }
    console.log('[shutdown] Servidor cerrado limpio, sin requests en vuelo.');
    process.exit(0);
  });

  // CLAVE para el reload sin freeze: cerrar los sockets keep-alive OCIOSOS para
  // que los clientes reconecten al worker vivo, en vez de quedar pegados a este
  // (que esta drenando) hasta el kill_timeout. Las requests ACTIVAS NO se cortan:
  // closeIdleConnections solo cierra sockets sin request en curso. Se repite
  // porque un socket puede volver a quedar ocioso. (Node >= 18.2.)
  const releaseIdle = () => { try { server.closeIdleConnections?.(); } catch (_) {} };
  releaseIdle();
  const idleTimer = setInterval(releaseIdle, 250);
  if (idleTimer.unref) idleTimer.unref();

  // Fallback: si una request queda colgada, forzar cierre antes del SIGKILL (kill_timeout 10s).
  setTimeout(() => {
    console.warn('[shutdown] Timeout de drenado; cerrando conexiones restantes.');
    try { server.closeAllConnections?.(); } catch (_) {}
    process.exit(0);
  }, 8000).unref();
}
process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));
process.on('message', (msg) => {
  if (msg === 'shutdown') gracefulShutdown('shutdown');
});
