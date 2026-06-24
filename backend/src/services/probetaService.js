/**
 * Helpers
 * --------------------------------------------------
 * Si recibimos sólo "diasRotura" calculamos "fechaRotura"
 * usando la fecha + hora del despacho asociado a la muestra.
 */
const { jsPDF } = require("jspdf");

// En CommonJS a veces viene como .default, a veces directo
const autoTableModule = require("jspdf-autotable");
const _autoTable = autoTableModule.default || autoTableModule;

/**
 * Wrapper de autoTable con defaults que arreglan bugs de paginación
 * reportados por la auditoría visual smoke-pdf-visual:
 *   - showHead: 'everyPage' → repetir header en cada página (antes una
 *     tabla larga arrancaba la página 5 sin encabezado y el lector no
 *     sabía qué columna era qué).
 *   - rowPageBreak: 'avoid' → evitar que una fila quede partida entre
 *     dos páginas (antes la fila ID-82 aparecía con el ID en una página
 *     y la resistencia en otra).
 * Cualquier opción que el caller pase tiene precedencia sobre estos
 * defaults; pasar `showHead: 'firstPage'` los sobrescribe.
 */
function autoTable(doc, opts) {
  // El logo de tenant se imprime en cada página en (pageW - 25, 10, 10, 10),
  // ocupando de y=10 a y=20. Si una tabla salta de página, autoTable usa
  // `margin.top` para decidir donde retomar; sin este default, la tabla se
  // solapaba con el logo (auditoría visual reportó el bug en el "Listado
  // de probetas" del informe de resistencias).
  const userMargin = opts.margin || {};
  return _autoTable(doc, {
    showHead: 'everyPage',
    rowPageBreak: 'avoid',
    ...opts,
    margin: {
      top: 22,
      ...userMargin,
    },
  });
}
const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const dayjs = require('dayjs');
const { Op } = require('sequelize');
const archivoService = require('./archivoService');
const { getCacheForDb } = require('./cacheHelpers');
const {
  evaluarEnsayoResistencia,
  factorCorreccionHD: lookupFactorHD,
  validarHDProbetaMoldeada,
  valoresCoinciden,
  TIPOS_ROTURA,
} = require('../domain/ensayoResistenciaEvalEngine');
const {
  ESTADO_PROBETA,
  ESTADOS_NO_ENSAYABLES,
} = require('../domain/normRef/estadoProbeta');

const msDia = 24 * 60 * 60 * 1000;

/** TTLs en segundos */
const PROBETAS_TTL = 120;       // 2 min para listas (datos cambian con ensayos)
const RESISTENCIAS_TTL = 300;   // 5 min para reportes de resistencia (data historica)

const buildDosificacionInclude = (db) => ({
  model: db.Dosificacion,
  as: "dosificacion",
  attributes: [
    "idDosificacion",
    "nombre",
    "agua",
    "descripcion",
    "idTipoHormigon",
    "idEdadDisenio",
    "idAsentamientoDisenio",
    "idTamanioMaximoNominal",
    "idTipoDescarga",
    "idPlanta",
    "codigoEnPlanta",
  ],
  include: [
    {
      model: db.TipoHormigon,
      as: "tipoHormigon",
      attributes: ["tipoHormigon"],
    },
    {
      model: db.DosificacionCemento,
      as: "cementos",
      include: [{ model: db.Cemento, as: "cemento" }],
    },
    {
      model: db.DosificacionAditivos,
      as: "aditivos",
      include: [{ model: db.Aditivo, as: "aditivo" }],
    },
    {
      model: db.DosificacionAgregados,
      as: "agregados",
      include: [{ model: db.Agregado, as: "agregado" }],
    },
    {
      model: db.DosificacionFibras,
      as: "fibras",
      include: [{ model: db.Fibra, as: "fibra" }],
    },
  ],
});

/**
 * Include de Sequelize para `Muestra` que carga el snapshot directo
 * (cliente, obra, planta, tipoHormigon, dosificacion) y, como fallback
 * opcional para registros legacy, también el `Despacho` con sus mismas
 * asociaciones.
 *
 * C-LOG-03 fix (auditoría 08, Bloque 2): la versión anterior solo cargaba
 * estos datos vía `Muestra → Despacho → cliente/...`, lo que dejaba sin
 * datos de contexto a las muestras post-mig 20260505g sin despacho.
 */
const buildMuestraInclude = (db) => ({
  model: db.Muestra,
  as: 'muestra',
  required: false,
  attributes: ['idMuestra', 'fecha', 'remito', 'idCliente', 'idObra', 'idPlanta', 'idTipoHormigon', 'idDosificacion'],
  include: [
    { model: db.Cliente,      as: 'cliente',      attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
    { model: db.Obra,         as: 'obra',         attributes: ['nombre'] },
    { model: db.Planta,       as: 'planta',       attributes: ['idPlanta', 'nombre', 'marca', 'modelo'] },
    { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'] },
    { ...buildDosificacionInclude(db) },
    {
      model: db.Despacho, as: 'despacho', required: false,
      attributes: ['idDespacho', 'fecha', 'remito'],
      include: [
        { ...buildDosificacionInclude(db) },
        { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
        { model: db.Obra,    as: 'obra',    attributes: ['nombre'] },
        { model: db.Planta,  as: 'planta',  attributes: ['idPlanta', 'nombre', 'marca', 'modelo'] },
      ],
    },
  ],
});

/**
 * Include de `MuestraPaston` (3ra fuente de probetas, PARALELA a Muestra y
 * MuestraTerceros). Las probetas de pastón son PROPIAS (idMuestraTerceros
 * NULL) y además están ligadas a un pastón de prueba; deben verse en el
 * listado de propias y en "próximas a romper". LEFT JOIN (required:false):
 * una probeta tiene `muestra` O `muestraPaston`, nunca ambas.
 */
const buildMuestraPastonInclude = (db) => ({
  model: db.MuestraPaston,
  as: 'muestraPaston',
  required: false,
  attributes: ['idMuestraPaston', 'idPastonPrueba', 'origen', 'loteNumero', 'fecha',
    'idPlanta', 'idObra', 'idCliente', 'idTipoHormigon', 'estado'],
  include: [
    { model: db.Cliente,      as: 'cliente',      attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
    { model: db.Obra,         as: 'obra',         attributes: ['idObra', 'nombre'] },
    { model: db.Planta,       as: 'planta',       attributes: ['idPlanta', 'nombre'] },
    { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'] },
    // Fallback 2026-05-20: si `MuestraPaston.idTipoHormigon` quedó NULL (registros
    // creados antes del fix 2026-05-20 o pastones cuya dosificación no proviene
    // del catálogo legacy), exponemos `dosificacion.tipoHormigon` para que el
    // frontend pueda caer a ese valor sin un round-trip extra.
    ...(db.DosificacionDisenada
      ? [{
          model: db.DosificacionDisenada,
          as: 'dosificacion',
          attributes: ['id', 'nombre', 'idTipoHormigon'],
          required: false,
          include: [
            { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon'], required: false },
          ],
        }]
      : []),
  ],
});

/**
 * Marca las probetas de pastón con flags top-level para que el frontend no
 * tenga que ramificar todos los accessors: `esPaston`, `pastonOrigen`
 * ('PLANTA'|'OBRA'), `idPastonPrueba`. NO se finge un objeto `Muestra`:
 * `muestraPaston` queda como su fuente real.
 */
const marcarProbetasPaston = (filas) => filas.map((p) => {
  if (p && p.muestraPaston && !p.muestra) {
    return {
      ...p,
      esPaston: true,
      pastonOrigen: p.muestraPaston.origen || null,
      idPastonPrueba: p.muestraPaston.idPastonPrueba ?? null,
    };
  }
  return p;
});

const normalizeDosificacion = (dosificacion) => {
  if (!dosificacion) return null;
  return typeof dosificacion.get === "function"
    ? dosificacion.get({ plain: true })
    : dosificacion;
};


const calcEdadEnsayo = async (db, idProbeta, fechaEnsayo, horaEnsayo = "00:00:00") => {
  const probeta = await db.Probeta.findByPk(idProbeta, {
    include: [
      { model: db.Muestra, as: "muestra", include: { model: db.Despacho, as: "despacho" } },
      { model: db.MuestraTerceros, as: "muestraTerceros" },
      // Fix 2026-05-20: las probetas de pastón usan MuestraPaston como fuente
      // de la fecha de moldeo. Sin este include la edad quedaba null y el
      // create de EnsayoResistencia fallaba con "edadEnsayo cannot be null".
      ...(db.MuestraPaston ? [{ model: db.MuestraPaston, as: "muestraPaston" }] : []),
    ],
  });

  // Preferimos despacho.fecha cuando la muestra tiene despacho — es la fecha
  // real de confección que muestra el reporte. El campo Muestra.fecha es un
  // snapshot que en data legacy (ventana entre migraciones 20260505g/i) puede
  // estar NULL o '0000-00-00'. Si no hay despacho (flujo standalone), caemos
  // al snapshot propio. Mismo patrón que muestraService.confirmarMuestra.
  let baseDate;
  const fechaMuestra = probeta?.muestra?.despacho?.fecha ?? probeta?.muestra?.fecha;
  if (fechaMuestra) {
    const hora = probeta.muestra.despacho?.hora || '12:00:00';
    baseDate = new Date(`${fechaMuestra}T${hora}`);
  } else if (probeta?.muestraTerceros) {
    baseDate = new Date(`${probeta.muestraTerceros.fecha}T12:00:00`);
  } else if (probeta?.muestraPaston?.fecha) {
    // Probeta de pastón: la fecha de moldeo es MuestraPaston.fecha (DATEONLY).
    // Usamos 12:00 como hora por defecto para coherencia con el resto del
    // cálculo (la hora real del moldeo en pastones no se registra a nivel
    // de muestra, solo en mediciones del timeline).
    baseDate = new Date(`${probeta.muestraPaston.fecha}T12:00:00`);
  } else {
    return null;
  }
  if (Number.isNaN(baseDate.getTime())) return null;

  const ensayoDate = new Date(`${fechaEnsayo}T${horaEnsayo}`);
  // M-CAL-01 fix (auditoría 08, Bloque 14): la edad es el número de días
  // calendario COMPLETOS transcurridos. IRAM 1546:2013 §10.1 reporta edad
  // entera (no fraccionaria); el redondeo `Math.round` anterior subía la edad
  // a 28 cuando el ensayo se hacía a las 27,6 días, falseando el cumplimiento
  // a 28 días. `Math.floor` garantiza que solo se rotule "28 días" si el
  // ensayo se hizo después de cumplido el día 28 (criterio de día calendario
  // completo).
  return Math.floor((ensayoDate - baseDate) / msDia);
};
const calcFechaRotura = async (db, idMuestra, diasRotura) => {
  if (!diasRotura) return null;

  const muestra = await db.Muestra.findByPk(idMuestra, {
    include: { model: db.Despacho, as: "despacho" },
  });

  if (!muestra?.fecha) return null;

  const hora = muestra.despacho?.hora || '12:00:00';
  const base = new Date(`${muestra.fecha}T${hora}`);
  return new Date(base.getTime() + diasRotura * 24 * 60 * 60 * 1000);
};

/* ══════════════════════════════════════════════
   CRUD
   ══════════════════════════════════════════════ */

/**
 * Lista probetas propias (no de terceros). Acepta filtros por estado y por
 * origen de la muestra ('propias' = directas, 'paston' = de pastón, o `todas`
 * para no discriminar — comportamiento histórico).
 *
 * Refactor 2026-05-20 — filtro `origen` agregado para la pestaña "Pastones"
 * del nuevo listado tabular en frontend. Sin `origen` se devuelven TODAS las
 * propias (incluyendo las de pastón) por back-compat con callers viejos que
 * agrupan ambas en el mismo grid.
 *
 * @param {string} [origen='todas'] - 'propias' | 'paston' | 'todas'.
 */
const getProbetas = async (db, estadoId = null, origen = 'todas') => {
  const tc = getCacheForDb(db);
  const cacheKey = `list:${origen}:${estadoId || 'all'}`;
  const cached = tc.get('probetas', cacheKey);
  if (cached) return cached;

  const estadoInclude = {
    model: db.EstadoProbeta,
    as: 'estadoProbeta',
  };

  if (estadoId) {
    estadoInclude.where = { idEstadoProbeta: estadoId };
    estadoInclude.required = true;
  }

  // Filtro de origen: las probetas siempre son "propias" o "de terceros". Las
  // propias se subdividen en "directas" (idMuestra populated) y "de pastón"
  // (idMuestraPaston populated). Nunca ambas.
  const whereOrigen = { idMuestraTerceros: { [Op.is]: null } };
  if (origen === 'propias') {
    whereOrigen.idMuestraPaston = { [Op.is]: null };
  } else if (origen === 'paston') {
    whereOrigen.idMuestraPaston = { [Op.not]: null };
  }

  const result = await db.Probeta.findAll({
    where: whereOrigen,
    include: [
      estadoInclude,
      { model: db.Archivo, as: 'archivos' },
      {
        model: db.Muestra, as: 'muestra',
        include: [
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          {
            model: db.Dosificacion, as: 'dosificacion',
            include: [{ model: db.TipoHormigon, as: 'tipoHormigon' }],
          },
          {
            model: db.Despacho, as: 'despacho',
            required: false,
            attributes: ['fecha', 'hora', 'idPlanta', 'remito'],
            include: [
              { model: db.Planta, as: 'planta', attributes: ['nombre', 'idPlanta'] },
              { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
              {
                model: db.Dosificacion, as: 'dosificacion',
                include: [{ model: db.TipoHormigon, as: 'tipoHormigon' }],
              },
            ],
          },
        ],
      },
      { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
      { model: db.EnsayoResistencia, as: 'ensayo' },
      // 3ra fuente: probetas de pastón (propias, ligadas a un pastón).
      buildMuestraPastonInclude(db),
    ],
    order: [['idProbeta', 'DESC']],
  });

  const plain = marcarProbetasPaston(result.map(r => r.get({ plain: true })));
  tc.set('probetas', cacheKey, plain, PROBETAS_TTL);
  return plain;
};

const getProbetasTerceros = async (db) => {
  const tc = getCacheForDb(db);
  const cached = tc.get('probetas', 'terceros');
  if (cached) return cached;

  const probetas = await db.Probeta.findAll({
    where: { idMuestraTerceros: { [Op.not]: null } },
    include: [
      { model: db.EstadoProbeta, as: 'estadoProbeta' },
      { model: db.Archivo, as: 'archivos' },
      { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
      {
        model: db.MuestraTerceros,
        as: 'muestraTerceros',
        include: [
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Obra, as: 'obra', attributes: ['nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
        ],
      },
      { model: db.EnsayoResistencia, as: 'ensayo' },
    ],
    order: [['idProbeta', 'DESC']],
  });

  const result = probetas.map((probeta) => {
    const plain = probeta.get({ plain: true });

    if (!plain.muestra && plain.muestraTerceros?.planta) {
      plain.muestra = { planta: plain.muestraTerceros.planta };
    }

    return plain;
  });

  tc.set('probetas', 'terceros', result, PROBETAS_TTL);
  return result;
};

const getProbeta = async (db, id) =>
  db.Probeta.findByPk(id, {
    include: [
      { model: db.EstadoProbeta, as: "estadoProbeta" },
      { model: db.MuestraTerceros, as: "muestraTerceros", include: [{ model: db.Planta, as: 'planta' }, { model: db.TipoProbeta, as: 'tipoProbeta' }] },
      buildMuestraPastonInclude(db),
      { model: db.Archivo, as: 'archivos' },
      { model: db.UnidadMedidaPrensa, as: "unidadMedida" },
      {
        model: db.Muestra,
        as: "muestra",
        include: [
          { model: db.TipoProbeta, as: "tipoprobeta" },
          // [VITRINA] Muestra standalone (sin despacho): la planta y la fecha de
          // confección viven directo en la Muestra (idPlanta/fecha), no en un
          // Despacho (módulo recortado). Incluimos la planta propia para que el
          // form de probeta pueda mostrar Planta/Fecha sin pasar por despacho.
          { model: db.Planta, as: "planta", attributes: ['idPlanta', 'nombre'] },
          {
            model: db.Despacho,
            as: "despacho",
            include: [
              {
                model: db.Planta,
                as: 'planta',
                attributes: ['idPlanta', 'nombre']
              }
            ]
          }
        ],
      },
      {
        model: db.EnsayoResistencia, as: "ensayo",
        include: [
          { model: db.Empleado, as: "operarioEnsayo", attributes: ['nombre', 'apellido'] },
          { model: db.Prensa, as: "prensa", attributes: ['nombre'] },
        ],
      },
    ],
  });

const createProbeta = async (db, data) => {
  // 1. calculo (o uso) fechaRotura
  let fechaRotura =
    data.fechaRotura ??
    (await calcFechaRotura(db, data.idMuestra, data.diasRotura));

  // 2. flip de estado según fechaRotura
  // Mej-05 (auditoría 08, Bloque 6): magic numbers reemplazados por
  // constantes canónicas del dominio.
  const ahora = new Date();
  let estado = data.idEstadoProbeta ?? ESTADO_PROBETA.PENDIENTE;
  if (fechaRotura) {
    if (estado === ESTADO_PROBETA.PENDIENTE && fechaRotura > ahora) {
      estado = ESTADO_PROBETA.CURANDO;
    } else if (estado === ESTADO_PROBETA.CURANDO && fechaRotura < ahora) {
      estado = ESTADO_PROBETA.PENDIENTE;
    }
  }

  // 3. guardo
  return db.Probeta.create({
    ...data,
    fechaRotura,
    idEstadoProbeta: estado,
  });
};


const updateProbeta = async (db, id, data) => {
  const probeta = await db.Probeta.findByPk(id);
  if (!probeta) throw new Error("Probeta no encontrada");

  // 1. recalcular fechaRotura si cambian los diasRotura
  if (data.diasRotura != null && !data.fechaRotura) {
    data.fechaRotura = await calcFechaRotura(
      db,
      probeta.idMuestra,
      data.diasRotura
    );
  }

  // 2. flip de estado según la nueva fechaRotura
  if (data.fechaRotura) {
    const ahora = new Date();
    const origen = probeta.idEstadoProbeta;
    if (origen === ESTADO_PROBETA.PENDIENTE && data.fechaRotura > ahora) {
      data.idEstadoProbeta = ESTADO_PROBETA.CURANDO;
    } else if (origen === ESTADO_PROBETA.CURANDO && data.fechaRotura < ahora) {
      data.idEstadoProbeta = ESTADO_PROBETA.PENDIENTE;
    }
  }

  // 3. actualizo en BDD
  await probeta.update(data);
  return probeta;
};



const deleteProbeta = async (db, id) => {
  const probeta = await db.Probeta.findByPk(id);
  if (!probeta) throw new Error("Probeta no encontrada");
  await probeta.destroy();
};
const createEnsayoResistencia = async (db, data, idEmpleado = null) => {
  // 0) Validación de placa de elastómero (IRAM 1709) ANTES de iniciar la
  //    transacción del ensayo. Si la placa alcanzó su límite normativo y
  //    no fue extendida, o si está agotada, no se permite ensayar.
  if (db.PlacaElastomero && data.idPrensa && data.diametro) {
    const prensa = await db.Prensa.findByPk(data.idPrensa);
    if (prensa) {
      const { getEstadoParaEnsayo } = require('./placaElastomeroService');
      const estado = await getEstadoParaEnsayo(db, prensa.nombre, Number(data.diametro));
      if (estado && !estado.sinPlaca && estado.placa) {
        if (estado.estado === 'bloqueado') {
          throw Object.assign(
            new Error(`Placas Ø${estado.placa.diametroMm} mm agotadas (${estado.placa.reusosActuales}/${estado.limiteTotal}). Reemplace el juego antes de ensayar.`),
            { status: 422 }
          );
        }
        if (estado.estado === 'necesita_extension') {
          throw Object.assign(
            new Error(`Placas Ø${estado.placa.diametroMm} mm alcanzaron el límite normativo (${estado.placa.reusosActuales}/${estado.limiteTotal} usos). Extienda el uso o reemplace antes de ensayar.`),
            { status: 422 }
          );
        }
      }
    }
  }

  const transaction = await db.sequelize.transaction();
  try {
    // 1) Validar que venga todo lo obligatorio.
    // C-LOG-01 fix (Bloque 3): `cargaAplicada` y `resistencia` ahora son
    // OPCIONALES en el payload — si vienen, se validan contra el recálculo;
    // si no vienen, se calculan. La validez del valor enviado lo decide el
    // engine, no el cliente.
    //
    // Fix prensa nueva (2026-05-13): `lecturaPrensa` NO es obligatorio para
    // toda prensa. Depende del `tipoOperacion`:
    //   - MANUAL: el operador transcribe la lectura del dial y el engine le
    //     aplica la ecuación de calibración → `lecturaPrensa` obligatorio.
    //   - AUTOMATICA / SEMIAUTOMATICA: la prensa entrega la carga directa →
    //     `cargaAplicada` obligatorio, `lecturaPrensa` no aplica.
    // Por eso cargamos la prensa ANTES de armar la lista de obligatorios
    // (antes se cargaba después y la guarda rechazaba prensas automáticas).
    if (data.idPrensa == null || data.idPrensa === "") {
      throw new Error("El campo 'idPrensa' es obligatorio");
    }
    const prensaParaCalculo = await db.Prensa.findByPk(data.idPrensa, {
      include: [{ model: db.UnidadMedidaPrensa, as: 'unidadMedida' }],
    });
    if (!prensaParaCalculo) {
      throw Object.assign(new Error('Prensa no encontrada'), { status: 400 });
    }
    const tipoOperacion = prensaParaCalculo.tipoOperacion || 'MANUAL';

    const required = [
      "peso",
      "altura",
      "diametro",
      "fechaEnsayo",
      "horaEnsayo",
      "idOperarioEnsayo",
      "idPrensa",
      tipoOperacion === 'MANUAL' ? "lecturaPrensa" : "cargaAplicada",
    ];
    for (const field of required) {
      if (data[field] == null || data[field] === "") {
        throw new Error(`El campo '${field}' es obligatorio`);
      }
    }

    // 2) Validar tipoRotura si vino (IRAM 1546:2013 §11).
    if (data.tipoRotura != null && data.tipoRotura !== ''
        && !TIPOS_ROTURA.includes(data.tipoRotura)) {
      throw Object.assign(
        new Error(`Tipo de rotura inválido. Valores permitidos: ${TIPOS_ROTURA.join(', ')}.`),
        { status: 400 }
      );
    }

    // R5 (revisor-civil 2026-05-08): validar H/D = 2 ± 5% para probetas
    // moldeadas (IRAM 1524/1534). Si está fuera, la probeta debe
    // descartarse. El factor de IRAM 1551 sólo aplica a testigos
    // extraídos (no implementado aún en el sistema).
    const validacionHD = validarHDProbetaMoldeada(data.altura, data.diametro);
    if (!validacionHD.valido) {
      throw Object.assign(
        new Error(validacionHD.motivo),
        { status: 422, hdReal: validacionHD.hdReal, hdEsperado: 2 }
      );
    }

    // 3) C-LOG-01 fix — recalcular en el backend usando el engine puro
    //    `ensayoResistenciaEvalEngine`. El backend es la fuente de verdad;
    //    si el cliente envió valores divergentes, se rechaza con 400.
    //    `prensaParaCalculo` ya se cargó arriba (paso 1) para decidir qué
    //    campos son obligatorios según `tipoOperacion`.
    // Importante: NO pasamos el factorCorreccionHD del cliente al engine —
    // el engine debe calcular el factor autoritativo desde altura/diámetro
    // contra la tabla IRAM 1546:2013 §10.4. Si el cliente envió un factor
    // distinto, lo rechazaremos abajo con el valor esperado.
    const calc = evaluarEnsayoResistencia({
      lecturaPrensa: data.lecturaPrensa,
      cargaAplicada: data.cargaAplicada, // sólo se usa si tipoOperacion != MANUAL
      prensa: {
        tipoOperacion,
        coeficienteUno: prensaParaCalculo.coeficienteUno,
        coeficienteDos: prensaParaCalculo.coeficienteDos,
        coeficienteTres: prensaParaCalculo.coeficienteTres,
        unidad: prensaParaCalculo.unidadMedida?.unidad ?? null,
      },
      diametro: data.diametro,
      altura: data.altura,
    });
    if (!calc) {
      const msg = tipoOperacion === 'MANUAL'
        ? 'No se pudo calcular la resistencia con los datos enviados (verificar lecturaPrensa, diámetro y altura).'
        : 'No se pudo calcular la resistencia con los datos enviados (verificar cargaAplicada, diámetro y altura).';
      throw Object.assign(new Error(msg), { status: 400 });
    }

    // Validar que los valores enviados por el cliente coincidan con el
    // recálculo (tolerancia 1 %). Si no coinciden, rechazar.
    if (data.cargaAplicada != null
        && !valoresCoinciden(calc.cargaAplicada, data.cargaAplicada)) {
      throw Object.assign(
        new Error(`Carga aplicada enviada (${data.cargaAplicada}) no coincide con el recálculo del backend (${calc.cargaAplicada}). Verificá la lectura de prensa y los coeficientes de calibración.`),
        { status: 400 }
      );
    }
    if (data.resistencia != null
        && !valoresCoinciden(calc.resistencia, data.resistencia)) {
      throw Object.assign(
        new Error(`Resistencia enviada (${data.resistencia} MPa) no coincide con el recálculo del backend (${calc.resistencia} MPa). El backend recalcula con el mismo engine: si los valores difieren, hay tampering o un error en los coeficientes de calibración.`),
        { status: 400 }
      );
    }
    if (data.factorCorreccionHD != null
        && !valoresCoinciden(calc.factorCorreccionHD, data.factorCorreccionHD, 0.005)) {
      // R5 (revisor-civil): para probetas moldeadas siempre se persiste
      // factor 1.000. Si el cliente envía otro valor, rechazar.
      throw Object.assign(
        new Error(`Factor H/D enviado (${data.factorCorreccionHD}) no es válido. Para probetas moldeadas la norma exige H/D=2 (factor 1.000); el valor enviado se descarta. El factor de IRAM 1551 sólo aplica a testigos extraídos.`),
        { status: 400 }
      );
    }

    // Sustituir los valores autoritativos calculados por el engine
    // (sobre-escribimos lo que vino del cliente para guardar la verdad
    // del backend).
    data.cargaAplicada = calc.cargaAplicada;
    data.resistencia = calc.resistencia;
    data.factorCorreccionHD = calc.factorCorreccionHD;

    // 4) Calcula edad y marca estado de probeta
    const edad = await calcEdadEnsayo(db, data.idProbeta, data.fechaEnsayo, data.horaEnsayo);
    const probeta = await db.Probeta.findByPk(data.idProbeta, { transaction });
    if (!probeta) throw new Error("Probeta no encontrada");

    // M-LOG-10 fix (auditoría 08, Bloque 6): no permitir cargar ensayo
    // sobre probetas en estado terminal (Descartada/Perdida) — pisar el
    // estado borraría la decisión previa del responsable de calidad.
    if (ESTADOS_NO_ENSAYABLES.includes(probeta.idEstadoProbeta)) {
      throw Object.assign(
        new Error(`No se puede cargar ensayo sobre una probeta en estado ${probeta.idEstadoProbeta}: la probeta fue marcada como Descartada o Perdida. Si el estado es incorrecto, primero corregir el estado.`),
        { status: 422 }
      );
    }

    await probeta.update(
      { idEstadoProbeta: ESTADO_PROBETA.ENSAYADA, idUnidadMedidaPrensa: data.idUnidadMedidaPrensa },
      { transaction }
    );

    // 5) Verificar si la aprobacion automatica esta habilitada.
    // M-LOG-11 fix (auditoría 08, Bloque 13): cuando la config global
    // `aprobacionAutomaticaEnsayos` está activada, el ensayo se crea ya
    // aprobado SIN firma humana. Antes esto pasaba sin trazabilidad. Ahora
    // firmamos con el `idEmpleado` que carga el ensayo y emitimos un log
    // estructurado para que quede explícito que la aprobación fue automática.
    const configRow = await db.Config.findOne({ attributes: ['aprobacionAutomaticaEnsayos'] });
    const aprobacionAutomatica = configRow?.aprobacionAutomaticaEnsayos ?? false;

    // 6) Upsert del ensayo.
    // M-LOG-05 fix (auditoría 08, Bloque 9): si ya existe ensayo y está
    // APROBADO, rechazar. Antes el upsert sobrescribía silenciosamente
    // un ensayo aprobado, perdiendo la firma del Responsable de Calidad.
    // Para reemplazar un ensayo aprobado hay que primero desaprobarlo
    // (endpoint pendiente Mej-17).
    let ensayo = await db.EnsayoResistencia.findOne({
      where: { idProbeta: data.idProbeta },
      transaction,
    });
    if (ensayo) {
      if (ensayo.pendienteRevision === false && ensayo.idAprobadoPor != null) {
        throw Object.assign(
          new Error(
            `La probeta #${data.idProbeta} ya tiene un ensayo aprobado por el Responsable de Calidad (id ${ensayo.idAprobadoPor}). Para reemplazarlo hay que desaprobarlo primero.`
          ),
          { status: 422 }
        );
      }
      await ensayo.update({ ...data, edadEnsayo: edad }, { transaction });
    } else {
      // M-LOG-11: si la aprobación automática está activa, firmamos con el
      // empleado que carga el ensayo y registramos un evento estructurado.
      const camposAutoAprobacion = aprobacionAutomatica
        ? {
            pendienteRevision: false,
            idAprobadoPor: idEmpleado,
            fechaAprobacion: new Date(),
          }
        : { pendienteRevision: true };
      ensayo = await db.EnsayoResistencia.create(
        { ...data, edadEnsayo: edad, ...camposAutoAprobacion },
        { transaction }
      );
      if (aprobacionAutomatica) {
        console.log(JSON.stringify({
          event: 'ensayoResistencia.aprobacionAutomatica',
          idEnsayoResistencia: ensayo.idEnsayoResistencia,
          idProbeta: data.idProbeta,
          idEmpleado,
          configOrigen: 'global.aprobacionAutomaticaEnsayos',
          fecha: new Date().toISOString(),
        }));
      }
    }

    await transaction.commit();

    // ── Registrar uso de placa de elastómero (IRAM 1709) ──
    try {
      if (db.PlacaElastomero && data.idPrensa && data.diametro) {
        const prensa = await db.Prensa.findByPk(data.idPrensa);
        if (prensa) {
          const { registrarUso } = require('./placaElastomeroService');
          const resultado = await registrarUso(db, prensa.nombre, Number(data.diametro));
          if (resultado?.alerta) {
            ensayo._placaAlerta = resultado; // attach for frontend consumption
          }
        }
      }
    } catch (placaErr) {
      console.warn('[ensayoResistencia] Error registrando uso de placa:', placaErr.message);
      // Non-blocking: placa tracking failure should not prevent test save
    }

    return ensayo;
  } catch (err) {
    await transaction.rollback();
    throw err;
  }
};

const updateEnsayoResistencia = async (db, id, data) => {
  const ensayo = await db.EnsayoResistencia.findByPk(id);
  if (!ensayo) throw new Error("Ensayo no encontrado");

  /* si cambia la fecha recalculamos la edad */
  if (data.fechaEnsayo) {
    data.edadEnsayo = await calcEdadEnsayo(
      db,
      ensayo.idProbeta,
      data.fechaEnsayo,
      data.horaEnsayo ?? ensayo.horaEnsayo
    );
  }
  await ensayo.update(data);
  return ensayo;
};
// Mej-03 (auditoría 08, Bloque 15): tabla movida a `domain/normRef/iram1666.js`.
// Re-exportamos acá el alias con el nombre legacy para no romper callers.
const { tStudentK } = require('../domain/normRef/iram1666');
/* ════════════════════════════════════════════════════════════════════════
   PR8.3 — Consistencia entre probetas de una misma muestra
   ────────────────────────────────────────────────────────────────────────
   CIRSOC 200:2024 §6.1.6.3 / IRAM 1666:2020 §5.2.1 establecen que el
   resultado de un ensayo es el promedio de ≥2 probetas (15×30) o ≥3
   probetas (10×20) ensayadas a la misma edad. La diferencia entre las
   resistencias extremas debe ser MENOR al 15% de la resistencia media
   de las probetas que constituyen el grupo.

   Decisión PR8.3 (sesión 2026-05-03): emitir WARNING (no rechazo
   automático). El usuario decide si descarta o acepta el ensayo.

   Reglas implementadas:
   - Si rango (max-min) > 15% de la media → warning + flag descarteSugerido
   - Si ≥3 probetas y rango > 15% pero las 2 más cercanas difieren ≤10%
     respecto a su promedio → marcar la divergente como flag descartable
     (idProbeta), sin descartar automáticamente.
   - Sin rechazo automático del ensayo.

   @param {Array<{idProbeta: number, resistencia: number}>} ensayos
   @param {number} idMuestra
   @returns {Array<{idMuestra, idProbeta, motivo, sugerencia, severity, descarteSugerido?}>}
   ════════════════════════════════════════════════════════════════════════ */
/**
 * Coeficiente de corrección 10×20 → 15×30 según CIRSOC 200-2024 §6.1.6.1.
 * Por defecto 0,95. Si la planta tiene ensayos previos que correlacionen
 * sus dos tipos, debería reemplazar este valor por uno calibrado.
 *
 * M-CAL-06 (revisor-civil 2026-05-08).
 */
const COEF_CORRECCION_10X20_A_15X30_DEFAULT = 0.95;

/**
 * IDs de TipoProbeta del proyecto (espejo del seed):
 *   1: 10x20 (cilíndrica D=100, h=200)
 *   2: 15x30 (cilíndrica D=150, h=300) ← canónica
 *   3: Otra
 *
 * §6.1.6.1: el resultado de un ensayo es el promedio de:
 *   - 2 probetas si son 15×30 (canónicas)
 *   - 3 probetas si son 10×20
 */
const N_MINIMO_POR_TIPO_PROBETA = Object.freeze({
  1: 3,  // 10x20
  2: 2,  // 15x30
});

function evaluarConsistenciaProbetas(ensayos, idMuestra, opts = {}) {
  const warnings = [];
  if (!Array.isArray(ensayos) || ensayos.length < 2) return warnings;

  const valores = ensayos.map((e) => Number(e.resistencia)).filter((v) => Number.isFinite(v) && v > 0);
  if (valores.length < 2) return warnings;

  // M-CAL-06: si recibimos idTipoProbeta, validamos n contra mínimo §6.1.6.1.
  const { idTipoProbeta } = opts;
  if (idTipoProbeta != null) {
    const nMin = N_MINIMO_POR_TIPO_PROBETA[idTipoProbeta];
    if (nMin && valores.length < nMin) {
      const labelTipo = idTipoProbeta === 1 ? '10×20' : (idTipoProbeta === 2 ? '15×30' : `tipo ${idTipoProbeta}`);
      warnings.push({
        idMuestra,
        idProbeta: null,
        severity: 'warning',
        motivo: `Ensayo con ${valores.length} probetas ${labelTipo}; CIRSOC §6.1.6.1 requiere mínimo ${nMin} probetas para promediar.`,
        sugerencia: 'Cargar las probetas faltantes antes de emitir veredicto definitivo.',
        norma: 'CIRSOC 200-2024 §6.1.6.1',
      });
    }
  }

  const media = valores.reduce((s, v) => s + v, 0) / valores.length;
  if (media <= 0) return warnings;

  const max = Math.max(...valores);
  const min = Math.min(...valores);
  const rango = max - min;
  const rangoPct = (rango / media) * 100;

  if (rangoPct <= 15) return warnings; // dentro del límite, sin warnings

  /* ─────────── R2 (revisor-civil 2026-05-08) + M-CAL-06 (Bloque 14) ──────
   * IRAM 1666:2020 §5.2.1: cuando el rango entre probetas individuales
   * supera el 15 % de la media, hay que analizar los procedimientos de
   * moldeo / curado / ensayo. La norma NO especifica un criterio numérico
   * para "rescatar" el resultado descartando la divergente — esa es una
   * práctica de campo aceptada en laboratorios pero no aparece textual.
   *
   * Política HormiQual (NO normativa):
   *   1. Si rango > 15% y n ≥ 3 y existe un par con diferencia ≤ 10%
   *      → severity=warning + sugerencia de descartar la(s) divergente(s).
   *      La decisión final queda en manos del Director de Obra.
   *   2. Si rango > 15% sin par concordante (n=2 o n≥3 sin par ≤10%)
   *      → severity=critical (la norma exige analizar procedimientos antes
   *      de aceptar el resultado).
   *
   * El umbral del 10% es heurística de la casa (no figura en IRAM 1666).
   * Si en el futuro un tenant pide otro umbral, se parametriza acá.
   */

  // 1. Buscar par cercano para decidir severidad.
  let mejorPar = null;
  if (ensayos.length >= 3) {
    const ensayosConValor = ensayos
      .map((e) => ({ idProbeta: e.idProbeta, resistencia: Number(e.resistencia) }))
      .filter((e) => Number.isFinite(e.resistencia) && e.resistencia > 0);

    let menorDiferencia = Infinity;
    for (let i = 0; i < ensayosConValor.length - 1; i++) {
      for (let j = i + 1; j < ensayosConValor.length; j++) {
        const a = ensayosConValor[i];
        const b = ensayosConValor[j];
        const promedioPar = (a.resistencia + b.resistencia) / 2;
        const dif = Math.abs(a.resistencia - b.resistencia);
        const difPct = (dif / promedioPar) * 100;
        if (difPct < menorDiferencia) {
          menorDiferencia = difPct;
          mejorPar = { a, b, difPct, promedioPar, ensayosConValor };
        }
      }
    }
  }

  const hayParConcordante = !!(mejorPar && mejorPar.difPct <= 10);
  const severidadGlobal = hayParConcordante ? 'warning' : 'critical';
  const motivoNorma = hayParConcordante
    ? 'Política interna: par concordante (≤10%) detectado — sugerimos descartar la probeta divergente y aceptar el promedio del par. La decisión final corresponde al Director de Obra.'
    : 'IRAM 1666:2020 §5.2.1: rango > 15% — analizar procedimientos de moldeo, curado y ensayo antes de emitir veredicto.';

  // 2. Warning/rechazo sobre la muestra completa.
  warnings.push({
    idMuestra,
    idProbeta: null,
    severity: severidadGlobal,
    motivo: `Rango entre probetas extremas (${rango.toFixed(2)} MPa) excede 15% de la media (${media.toFixed(2)} MPa) — diferencia ${rangoPct.toFixed(1)}%`,
    sugerencia: motivoNorma,
    norma: 'IRAM 1666:2020 §5.2.1',
  });

  // 3. Si hay par concordante, marcar las divergentes como descartables.
  if (hayParConcordante) {
    const idsCercanas = new Set([mejorPar.a.idProbeta, mejorPar.b.idProbeta]);
    const divergentes = mejorPar.ensayosConValor.filter((e) => !idsCercanas.has(e.idProbeta));
    for (const div of divergentes) {
      const desviacionVsPromedioPar = Math.abs(div.resistencia - mejorPar.promedioPar);
      const desviacionPct = (desviacionVsPromedioPar / mejorPar.promedioPar) * 100;
      warnings.push({
        idMuestra,
        idProbeta: div.idProbeta,
        severity: 'warning',
        descarteSugerido: true,
        motivo: `Probeta ${div.idProbeta}: ${div.resistencia.toFixed(2)} MPa difiere ${desviacionPct.toFixed(1)}% del promedio de las 2 más cercanas (${mejorPar.promedioPar.toFixed(2)} MPa). Las 2 cercanas (${mejorPar.a.resistencia.toFixed(2)} y ${mejorPar.b.resistencia.toFixed(2)} MPa) están dentro de ±10%.`,
        sugerencia: 'Considerar descartar esta probeta y aceptar el promedio de las dos cercanas. La decisión final corresponde al Director de Obra.',
        norma: 'IRAM 1666:2020 §5.2.1',
      });
    }
  }

  return warnings;
}

/**
 * Constantes normativas de aceptación de resistencia.
 *
 * - K_CIRSOC_LOTE: factor del cuantil 0,90 de la normal (≈ 1,2816). CIRSOC
 *   200-2024 §6.2.3.8 (Modo 1 vía estadística, n ≥ 30) lo cita como **1,28**.
 *   Antes del fix M-CAL-04 (auditoría 08 Bloque 4), `cumpleCirsoc` usaba
 *   1.282 y `loteCumpleCirsoc` usaba 1.28 — inconsistencia de 0,002 que
 *   producía veredictos divergentes según el path llamador para σ alto.
 *   Unificamos.
 *
 * - DELTA_INDIVIDUAL_CIRSOC: tolerancia "ningún resultado individual menor
 *   que f'c − 3,5 MPa" — CIRSOC 200-2024 §6.2.3.7.b Ec. 6-4 (Modo 1,
 *   condición individual; aplica para f'c ≤ 35 MPa). Para f'c > 35 MPa la
 *   tolerancia es 10% de f'c (Ec. 6-5, ramificada inline en getResistencias).
 *   El comentario inline anterior atribuía esto a §4.3.4.5; corregido
 *   contra norma impresa (auditoría revisor-civil 2026-05-09 M3).
 */
const K_CIRSOC_LOTE = 1.28;
const DELTA_INDIVIDUAL_CIRSOC = 3.5;

/**
 * Bloque 17 auditoría 08 — distinción semántica de los 3 criterios:
 *
 *   1. CIRSOC 200-2024 §6.2.3 (Modo 1, aceptación cliente "blanda"):
 *      individual ≥ f'c − 3,5 MPa (o 0,10·f'c si f'c > 35), MM3 ≥ f'c.
 *
 *   2. CIRSOC 200-2024 §6.2.4 (Modo 2, aceptación cliente "estricta"):
 *      individual ≥ f'c (sin tolerancia), MM3 ≥ f'c + 5.
 *
 *   3. IRAM 1666:2020 §A.7.10.1.1 + Tabla A.3 (autocontrol del PRODUCTOR):
 *      MM3 ≥ f'c + k(n)·σ, donde k(n) viene de la tabla. NO es criterio
 *      de aceptación cliente — es control interno del productor para
 *      detectar corrimiento del proceso antes que el cliente reciba un
 *      hormigón fuera de norma.
 *
 * Antes existía una función `cumpleIram` que en realidad implementaba
 * §6.2.3 individual (no IRAM). Se mantiene como alias deprecado para no
 * romper callers, pero la lógica correcta de IRAM autocontrol vive ahora
 * en `cumpleIramAutocontrol`.
 */

const { getKIram1666 } = require('../domain/normRef/iram1666');

/** CIRSOC §6.2.3 condición individual M1: media ≥ f'c − 3,5 MPa. */
function cumpleCirsocM1Individual(media, objBase) {
  return media >= objBase - DELTA_INDIVIDUAL_CIRSOC;
}

/** CIRSOC §6.2.3.8 condición de lote estadística: media ≥ f'c + 1,28·σ. */
function cumpleCirsoc(media, desviacion, objBase) {
  return media >= objBase + K_CIRSOC_LOTE * desviacion;
}

/**
 * IRAM 1666:2020 §A.7.10.1.1 (autocontrol del productor) — verifica que
 * la media móvil de 3 muestras consecutivas (3-MA) sea ≥ f'c + k(n)·σ.
 * Devuelve `{cumple, viaAplicada, detalles, k, sigma}`.
 *
 * Para n < 3: la media móvil no existe → null (informativo, no fail).
 * Para n < 15: σ es referencial — IRAM 1666:2020 Tabla A.3 NO tabula k
 *   bajo n=15. Devolvemos `cumple: null` con motivo claro: el control
 *   estadístico no aplica con tan pocas muestras (la σ tiene escaso
 *   valor estadístico). Antes (auditoría revisor-civil 2026-05-09 C1)
 *   este path hacía fallback silencioso a k=1,000, lo que producía un
 *   "umbral" sin sustento normativo.
 * Para 15 ≤ n < 30: k de Tabla A.3.
 * Para n ≥ 30: k = 1,000 (no requiere corrección por tamaño de muestra).
 */
function cumpleIramAutocontrol(valoresOrdenados, fck, sigma) {
  const n = Array.isArray(valoresOrdenados) ? valoresOrdenados.length : 0;
  const CITA_IRAM = 'IRAM 1666:2020 §A.7.10.1.1 + Tabla A.3 (autocontrol del productor)';
  if (n < 3) {
    return { cumple: null, motivo: 'n < 3: 3-MA no calculable.', n, cita: CITA_IRAM };
  }
  if (sigma == null || !Number.isFinite(sigma) || sigma <= 0) {
    return { cumple: null, motivo: 'σ no calculable (necesita ≥ 2 valores con dispersión).', n, cita: CITA_IRAM };
  }
  const k = getKIram1666(n);
  if (k == null) {
    return {
      cumple: null,
      n,
      sigma: +sigma.toFixed(3),
      desviacionReferencial: true,
      motivo: 'n < 15: autocontrol IRAM 1666:2020 Tabla A.3 no aplicable; σ referencial.',
      cita: CITA_IRAM,
    };
  }
  const umbral = fck + k * sigma;
  let cumple = true;
  const fallos = [];
  for (let i = 0; i + 2 < n; i++) {
    const prom3 = (valoresOrdenados[i] + valoresOrdenados[i + 1] + valoresOrdenados[i + 2]) / 3;
    if (prom3 < umbral) {
      cumple = false;
      fallos.push({ ventanaInicio: i, prom3: +prom3.toFixed(2), umbral: +umbral.toFixed(2) });
    }
  }
  return {
    cumple,
    n,
    k,
    sigma: +sigma.toFixed(3),
    umbral: +umbral.toFixed(2),
    desviacionReferencial: n < 15,
    fallos,
    cita: CITA_IRAM,
    motivo: cumple
      ? `Autocontrol IRAM cumple: todas las 3-MA ≥ f'c + ${k.toFixed(3)}·σ = ${umbral.toFixed(2)} MPa.`
      : `Autocontrol IRAM NO cumple: ${fallos.length} ventana(s) de 3-MA bajo umbral ${umbral.toFixed(2)} MPa.`,
  };
}

/**
 * @deprecated Bloque 17 auditoría 08 — esta función SE LLAMABA "cumpleIram"
 * pero implementaba la condición individual M1 de CIRSOC §6.2.3 (no IRAM).
 * Mantenida como alias para no romper callers en `getResistencias`. Para
 * autocontrol IRAM real usar `cumpleIramAutocontrol`.
 */
function cumpleIram(media, objBase) {
  return cumpleCirsocM1Individual(media, objBase);
}

function loteCumpleIram(media, objBase) {
  return cumpleCirsocM1Individual(media, objBase);
}

function loteCumpleCirsoc(media, desviacion, objBase) {
  return media >= objBase + K_CIRSOC_LOTE * desviacion;
}

/**
 * Extrae la información de contexto de un ensayo de muestra propia.
 *
 * C-LOG-02 fix (auditoría 08, Bloque 2): la versión anterior accedía a
 * `e.probeta.muestra.despacho.dosificacion.tipoHormigon.tipoHormigon` sin
 * guards. Para muestras creadas sin despacho (válido desde mig 20260505g) el
 * acceso crasheaba con TypeError y rompía el reporte completo.
 *
 * Ahora leemos primero del snapshot directo de `Muestra` (campos disponibles
 * desde mig 20260505g) y caemos a `Muestra.despacho` solo si el snapshot está
 * vacío (registros legacy sin backfill).
 */
/**
 * Extrae f'c (resistencia característica en MPa) desde un objeto
 * `tipoHormigon`. M-CAL-05 (auditoría 08): prefiere el campo numérico
 * `fcMpa` (poblado por migración 20260508d). Si está NULL (registro
 * legacy o tipo no estándar), cae al regex sobre el nombre.
 */
function extractFckFromTipoHormigon(tipoHormigon) {
  if (!tipoHormigon) return 0;
  if (tipoHormigon.fcMpa != null && Number.isFinite(Number(tipoHormigon.fcMpa))) {
    return Number(tipoHormigon.fcMpa);
  }
  // Fallback: extraer del string. "H-30" → 30, "HRC30" → 30, "H-300" → 300
  // (bug histórico que se cubre con valores fuera de rango — los rejecta el
  // backfill de la migración).
  const tipoStr = tipoHormigon.tipoHormigon ?? '';
  return parseInt(String(tipoStr).replace(/\D/g, ''), 10) || 0;
}

function extractMuestraContext(e) {
  const muestra = e.probeta?.muestra;
  if (!muestra) return null;
  const despacho = muestra.despacho ?? null;
  // Snapshot directo > dosificación de la muestra > dosificación del despacho
  const tipoHormigon = muestra.tipoHormigon
                    ?? muestra.dosificacion?.tipoHormigon
                    ?? despacho?.dosificacion?.tipoHormigon
                    ?? null;
  const tipoStr = tipoHormigon?.tipoHormigon ?? null;
  if (!tipoStr) return null; // sin tipo: no se puede agrupar/evaluar — skip
  return {
    idMuestra:    muestra.idMuestra,
    tipoStr,
    fck:          extractFckFromTipoHormigon(tipoHormigon),
    fecha:        muestra.fecha    ?? despacho?.fecha    ?? null,
    remito:       muestra.remito   ?? despacho?.remito   ?? null,
    cliente:      muestra.cliente  ?? despacho?.cliente  ?? null,
    obra:         muestra.obra     ?? despacho?.obra     ?? null,
    planta:       muestra.planta   ?? despacho?.planta   ?? null,
    dosificacion: muestra.dosificacion ?? despacho?.dosificacion ?? null,
  };
}

/**
 * Extrae el contexto de una probeta de MuestraTerceros (probetas que llegan
 * para ensayar pero no fueron producidas en una planta del tenant). Espejo
 * de `extractMuestraContext` para terceros — usado por `buildChartData` y
 * `buildChartDataWithFactor` cuando el caller indica el modo terceros
 * (M-LOG-08 — auditoría 08, Bloque 9: deduplicación de buildChartData*).
 */
function extractMuestraTercerosContext(e) {
  const mt = e.probeta?.muestraTerceros;
  if (!mt) return null;
  const tipoHormigon = mt.tipoHormigon ?? null;
  const tipoStr = tipoHormigon?.tipoHormigon ?? null;
  if (!tipoStr) return null;
  return {
    idMuestra:    mt.idMuestraTerceros,
    tipoStr,
    fck:          extractFckFromTipoHormigon(tipoHormigon),
    fecha:        mt.fecha ?? null,
    remito:       mt.remito ?? null,
    cliente:      mt.cliente ?? null,
    obra:         mt.obra ?? null,
    planta:       mt.planta ?? null,
    dosificacion: null,  // Las muestras de terceros no tienen dosificación del tenant
  };
}

/**
 * M-LOG-08 fix (auditoría 08, Bloque 9): `buildChartData` ahora acepta un
 * extractor opcional. Por default usa `extractMuestraContext` (muestras
 * propias). Para terceros se pasa `extractMuestraTercerosContext`. Antes
 * existía `buildChartDataTerceros` con ~200 LOC duplicadas — quedó como
 * wrapper liviano y cualquier fix se aplica a ambos paths.
 */
function buildChartData(ensayos, extractor = extractMuestraContext) {
  /* ─────────── agrupar ensayos por muestra ─────────── */
  const muestraMap = new Map(); // idMuestra → { tipo, fck, ensayos[], ejemplo }
  let descartadosSinTipo = 0;

  for (const e of ensayos) {
    if (e.operarioEnsayo) {
      e.operador = `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`;
    }
    const ctx = extractor(e);
    if (!ctx) {
      descartadosSinTipo += 1;
      continue;
    }
    const tipoStr = ctx.tipoStr;
    const fck = ctx.fck;
    const idMuestra = ctx.idMuestra;
    // Adjuntamos el contexto al ensayo para que el resto de la función pueda
    // leerlo sin volver a navegar el grafo (mantenemos compatibilidad con el
    // código existente que accede a `e.probeta.muestra.despacho.*`).
    e._ctx = ctx;

    if (!muestraMap.has(idMuestra)) {
      muestraMap.set(idMuestra, {
        tipo: tipoStr,
        fck,
        ensayos: [],
        ejemplo: e,
      });
    }
    muestraMap.get(idMuestra).ensayos.push(e);
  }

  /* ─────────── agrupar muestras por tipo de hormigón ─────────── */
  const tipoMap = new Map(); // tipo → { fck, ejemplo, muestras[] }

  for (const { tipo, fck, ensayos, ejemplo } of muestraMap.values()) {
    // Promedio de las probetas de la muestra
    const probetaResis = ensayos.map((e) => Number(e.resistencia)).filter(Number.isFinite);
    const prom = probetaResis.length
      ? probetaResis.reduce((a, b) => a + b, 0) / probetaResis.length
      : 0;
    // Dispersión entre probetas de la misma muestra (rango / promedio).
    // IRAM 1666:2020 §5.2.1 marca el 15 % como límite — útil para detectar
    // problemas de moldeo/curado/ensayo.
    const dispersionPct = probetaResis.length >= 2 && prom > 0
      ? ((Math.max(...probetaResis) - Math.min(...probetaResis)) / prom) * 100
      : null;

    const m0 = ensayos[0];
    // C-LOG-02 fix: leer del contexto consolidado (snapshot Muestra > Despacho)
    // en vez de asumir que `muestra.despacho` existe.
    const ctx = m0._ctx;
    const fechaConf = ctx.fecha;

    const plantaModelo = ctx.planta && ctx.planta.marca
      ? `${ctx.planta.marca} - ${ctx.planta.modelo}`
      : null;
    const prensaModelo = m0.prensa
      ? `${m0.prensa.marca} - ${m0.prensa.modelo}`
      : null;

    // PR8.3 — warnings de consistencia entre probetas (CIRSOC §6.1.6.3).
    const consistenciaWarnings = evaluarConsistenciaProbetas(
      ensayos.map((e) => ({ idProbeta: e.probeta?.idProbeta ?? e.idProbeta, resistencia: e.resistencia })),
      ctx.idMuestra
    );

    // Recursos MVP Fase D: contar ensayos sin calibración aplicada.
    // El hook beforeCreate de EnsayoResistencia popla `idCalibracionAplicada`
    // con la calibración vigente al momento del ensayo. Si está NULL es
    // porque no había calibración vigente — ISO 17025 §6.4.7 lo llama
    // "trazabilidad débil". El reporte lo expone para que un auditor lo vea.
    const probetasSinCalibracion = ensayos
      .filter((e) => e.idCalibracionAplicada == null)
      .map((e) => e.probeta?.idProbeta ?? e.idProbeta)
      .filter(Boolean);

    const muestraInfo = {
      idMuestra: ctx.idMuestra,
      fechaToma: ctx.fecha,
      remito: ctx.remito,
      fechaRotura: m0.fechaEnsayo,
      fechaConfeccion: fechaConf,
      edadEnsayo: m0.edadEnsayo,
      resistenciaPromedio: prom,
      dispersionPct,                                  // dispersión entre probetas de la muestra
      cantidadProbetas: probetaResis.length,
      probetasSinCalibracion,                         // Recursos MVP — trazabilidad ISO 17025
      consistenciaWarnings,                           // PR8.3 — warnings por muestra
      planta: ctx.planta?.nombre ?? null,
      plantaModelo,
      prensaModelo,
      operador: m0.operador,
      obra: ctx.obra?.nombre ?? null,
      cliente:
        ctx.cliente?.tipoPersona === 'Física'
          ? ctx.cliente.nombre
          : ctx.cliente?.razonSocial ?? null,
    };

    if (!tipoMap.has(tipo)) {
      tipoMap.set(tipo, { fck, ejemplo, muestras: [] });
    }
    tipoMap.get(tipo).muestras.push(muestraInfo);
  }

  /* ─────────── util: k de IRAM 1666:2020 Tabla A.3 ───────────
   *
   * R1 (revisor-civil 2026-05-08): los valores 1,68/1,34/1,28 según fck que
   * se usaban antes NO figuran en IRAM 1666:2020. La tabla A.3 expresa k
   * en función del PERCENTIL DE CASOS DEFECTUOSOS admitido, no del fck:
   *
   *   k = 1,65  → 5% defectuosos
   *   k = 1,28  → 10% defectuosos (CIRSOC 201:2005, default del proyecto)
   *   k = 0,84  → 20% defectuosos (sólo no estructurales con f'c ≤ 15 MPa)
   *
   * Adoptamos 1,28 alineado con CIRSOC 201:2005 (referenciado por
   * IRAM 1666:2020). Si en el futuro el catálogo del tenant configura
   * un percentil distinto, el valor se lee de ahí. Mantenemos el helper
   * `kIRAM` con la nueva firma para no propagar el cambio a callers.
   */
  const kIRAM = () => 1.28;

  /* ─────────── recorrer cada tipo y calcular estadísticas ─────────── */
  const salida = [];

  for (const [tipo, { fck, ejemplo, muestras: muestrasRaw }] of tipoMap) {
    // CIRSOC 200-2024 §6.1.6.1 + IRAM 1666:2020: el resultado de un ensayo
    // es el promedio de al menos 2 probetas (15×30) o 3 (10×20). Una
    // muestra con cantidadProbetas < 2 NO es un ensayo válido y se descarta
    // del cálculo del lote (no entra en estadística, 3-MA, ni veredicto).
    // Se reporta aparte para trazabilidad.
    const muestrasInvalidas = muestrasRaw.filter((m) => (m.cantidadProbetas ?? 0) < 2);
    const muestras = muestrasRaw.filter((m) => (m.cantidadProbetas ?? 0) >= 2);
    if (muestras.length === 0) {
      // Si todas las muestras son inválidas, no podemos emitir un lote.
      // Lo registramos en salida con mensaje explícito.
      salida.push({
        tipoHormigon: tipo,
        resistencia_diseno: fck,
        tamanoLote: 0,
        muestrasInvalidas,
        detalles: [],
        cumpleLote: null, cumpleCirsocM1: null, cumpleCirsocM2: null,
        cumpleIramAutocontrol: null,
        evaluacionMetodologia: 'sin_muestras_validas',
        loteSinMuestras: true,
      });
      continue;
    }
    // Orden cronológico.
    // M-LOG-14 (auditoría 08, Bloque 13): el ordenamiento es por
    // `fechaConfeccion`, NO por `fechaEnsayo`. Lo correcto frente a CIRSOC
    // 200-2024 §6.2.3 es la confección porque define el correlativo de la
    // entrega (la muestra n+1 corresponde al hormigón colado después de la
    // muestra n; la rotura es un evento posterior con jitter por planificación
    // del laboratorio). Las "muestras consecutivas" del cálculo de media móvil
    // son las del hormigón consecutivo, no las del ensayo consecutivo.
    // Bug fix (auditoría 09): `fechaConfeccion` puede llegar como string ISO
    // ('2025-10-17') porque Sequelize serializa DATEONLY como string. Hacer
    // `string - string` da NaN y el comparator devuelve siempre NaN, que JS
    // interpreta como "mantener orden" → array no ordenado realmente.
    // Resultado: los mmPromedio se calculaban en orden raw del query mientras
    // que el frontend los mostraba en orden cronológico, los valores caían
    // en filas equivocadas y algunos parecían "faltantes".
    muestras.sort((a, b) => {
      const da = a.fechaConfeccion instanceof Date ? a.fechaConfeccion.getTime() : new Date(a.fechaConfeccion).getTime();
      const db = b.fechaConfeccion instanceof Date ? b.fechaConfeccion.getTime() : new Date(b.fechaConfeccion).getTime();
      return da - db;
    });

    const n = muestras.length;
    const valores = muestras.map(m => m.resistenciaPromedio);

    /* ═════ Medias móviles de 3 muestras consecutivas (3-MA) ═════
     *
     * Bug fix (auditoría 09): antes esto solo se calculaba cuando n < 15.
     * Pero CIRSOC §6.2.3.7.a y IRAM 1666 §A.7.10 verifican 3-MA SIEMPRE
     * que haya ≥ 3 muestras — el límite n=15 era un comentario equivocado
     * que dejaba la columna 3-MA vacía en lotes grandes (caso reportado:
     * lote H-25 de Bramix con n=21 sin 3-MA visible).
     *
     * Cada ventana se asigna a la 3.ª muestra del triplete (la que cierra
     * la ventana) — convención CIRSOC.
     */
    const mediasMoviles = [];
    muestras.forEach(m => { m.mmPromedio = null; m.mmOk = null; });
    if (n >= 3) {
      // CIRSOC 200-2024 §6.2.3.7.a Ec. 6-3: prom3 ≥ f'c. NO existe el
      // término "+ rango"; antes (auditoría revisor-civil 2026-05-09 C2)
      // este path hacía `promMM ≥ fck + rango`, criterio sin sustento
      // normativo (mezcla con un legacy de tipo ACI/IRAM viejo). El
      // veredicto final M1 abajo (línea ~1285) ya usaba la fórmula
      // correcta; este flag persistido en `muestras[i+2].mmOk` también
      // ahora la respeta.
      for (let i = 0; i + 2 < n; i++) {
        const promMM = (valores[i] + valores[i + 1] + valores[i + 2]) / 3;
        const okMM = promMM >= fck;
        mediasMoviles.push({ promedio: promMM, cumpleMM: okMM, idx: i + 2 });
        muestras[i + 2].mmPromedio = promMM;
        muestras[i + 2].mmOk = okMM;
      }
    }

    /* ═════ Estadística global ═════
     *
     * f'ck (estimador estadístico): f'cm − k_fractil × t(n) × σ.
     *   - k_fractil: K_CIRSOC_LOTE = 1,28 → fractil 10% adoptado por HormiQual
     *     (CIRSOC 201:2005, referenciado por IRAM 1666:2020). Documentado en
     *     comentario de kIRAM líneas ~1140-1170.
     *   - t(n): corrección IRAM 1666:2020 Tabla A.3 cuando 15 ≤ n < 30. Para
     *     n < 15 la tabla no aplica → t = 1 (σ se reporta como referencial).
     *     Para n ≥ 30 → t = 1 (no requiere corrección).
     *
     * Fix auditoría revisor-civil 2026-05-09: antes esta línea usaba
     *   kCar = n >= 30 ? 1.64 : (tStudentK[n] ?? 1.64)
     * mezclando el fractil 5% (1.64) con el factor t-Student. Resultado:
     * para n=8 calculaba con 1.64 mientras el glosario y kIRAM declaraban
     * 1.28 → tres versiones del coeficiente flotando. Unificado a 1.28. */
    const media = valores.reduce((a, b) => a + b, 0) / n;
    const var_ = n > 1
      ? valores.reduce((s, v) => s + (v - media) ** 2, 0) / (n - 1)
      : 0;
    const desv = Math.sqrt(var_);
    const tCar = n >= 30 ? 1 : (tStudentK[n] ?? 1);
    const fckCalc = media - K_CIRSOC_LOTE * tCar * desv;
    const cv = media ? (desv / media) * 100 : 0;

    const min = Math.min(...valores);
    const max = Math.max(...valores);

    /* ═════ Cumplimiento lote IRAM ═════ */
    let cumpleLote = null;
    if (n >= 15) {
      const k = kIRAM();
      const t = n >= 30 ? 1 : (tStudentK[n] ?? 1);
      cumpleLote = media >= fck + k * t * desv;
    } else if (n >= 3) {
      cumpleLote = mediasMoviles.every(({ cumpleMM }) => cumpleMM);
    }

    /* ═════ CIRSOC 200-2024 §6.2.3 (Modo 1) y §6.2.4 (Modo 2) ═════
     *
     * R9 fixes (revisor-civil 2026-05-08, sesión 2):
     *
     * R9-1: condición individual M1 ramificada por f'c.
     *   - f'c ≤ 35 MPa: f'ci ≥ f'c − 3,5  (§6.2.3.7.b Ec. 6-4)
     *   - f'c > 35 MPa: f'ci ≥ 0,90·f'c   (§6.2.3.7.c Ec. 6-5, NUEVA en CIRSOC 200-2024)
     *
     * R9-2: M1 ahora se separa en VÍAS según §6.2.3:
     *   - §6.2.3.6 (lote pleno, 100%): f'cm ≥ f'c + condición individual.
     *     Aplica cuando se midió todo el lote. Por ahora, aproximamos con
     *     `via_lote_pleno`.
     *   - §6.2.3.7 (estimadores, mín. n=3): MM3 + condición individual.
     *     Es la vía MÁS USADA en obra. Default que devolvemos en cumpleCirsocM1.
     *   - §6.2.3.8 (estadístico, requiere n=30 a 40): f'cm ≥ f'c + 1,28·s.
     *     Solo aplicable a estructuras grandes con histórico. Antes el
     *     código aplicaba esto a TODO lote desde n≥3 (bug conceptual H-2).
     *
     * R9-3: σ no se usa para criterio normativo si n<15. CIRSOC §6.2.3.4
     *   establece que Sn no es calculable bajo n=15. Etiquetamos
     *   `desviacion_referencial: true` cuando n<15.
     *
     * R9-4: M2 con n<3 evalúa SOLO la condición individual (§6.2.4 último
     *   párrafo, "menos de 3 pastones aplicar exclusivamente Ec. 6-8").
     *
     * R9-5: §6.2.2.4 exige mínimo 5 muestras/lote. Si n<5, agregamos flag
     *   `loteSubdimensionado` para que el PDF/UI lo muestre con disclaimer.
     */

    // R9-1: condición individual M1 ramificada por f'c.
    const TOL_INDIVIDUAL_M1 = fck > 35
      ? fck * 0.10                  // 10% de f'c (Ec. 6-5)
      : DELTA_INDIVIDUAL_CIRSOC;    // 3,5 MPa (Ec. 6-4)
    const NORMA_INDIVIDUAL_M1 = fck > 35
      ? `§6.2.3.7.c Ec. 6-5 (f'c > 35: tolerancia 10% de f'c = ${(fck * 0.10).toFixed(2)} MPa)`
      : `§6.2.3.7.b Ec. 6-4 (f'c ≤ 35: tolerancia fija 3,5 MPa)`;

    let cumpleCirsocM1 = null;
    let cumpleCirsocM2 = null;
    let evaluacionMetodologia = 'no_aplica';
    let viaM1Aplicada = null;
    let detalleM1 = null;
    let detalleM2 = null;
    let loteSubdimensionado = false;

    if (n >= 1) {
      // R9-5: warning si n < 5 (CIRSOC §6.2.2.4).
      loteSubdimensionado = n < 5;

      // Condición individual común: M1 (con tolerancia ramificada) y M2 (sin tolerancia).
      const condInd1 = valores.every((v) => v >= fck - TOL_INDIVIDUAL_M1);
      const condInd2 = valores.every((v) => v >= fck);

      // Medias móviles de 3 consecutivas (solo aplica con n≥3).
      let condMM1 = null; // §6.2.3.7.a Ec. 6-3 — prom3 ≥ f'c
      let condMM2 = null; // §6.2.4.a Ec. 6-7 — prom3 ≥ f'c + 5
      if (n >= 3) {
        condMM1 = true;
        condMM2 = true;
        for (let i = 0; i + 2 < n; i++) {
          const prom3 = (valores[i] + valores[i + 1] + valores[i + 2]) / 3;
          if (prom3 < fck) condMM1 = false;
          if (prom3 < fck + 5) condMM2 = false;
        }
      }

      // R9-2 + R9-3: vías de M1 según §6.2.3.
      if (n >= 30) {
        // Vía estadística §6.2.3.8 (requiere 30-40 resultados).
        evaluacionMetodologia = 'lote_pleno';
        viaM1Aplicada = '§6.2.3.8 (estadística)';
        const condLoteEstadistica = media >= fck + K_CIRSOC_LOTE * desv;
        cumpleCirsocM1 = condLoteEstadistica && condMM1 && condInd1;
        detalleM1 = {
          via: viaM1Aplicada,
          condLote: condLoteEstadistica,
          condMM1,
          condInd1,
          tolIndividualMPa: TOL_INDIVIDUAL_M1,
          normaIndividual: NORMA_INDIVIDUAL_M1,
        };
      } else if (n >= 3) {
        // Vía estimadores §6.2.3.7 — MM3 + individual, sin condición de lote estadística.
        evaluacionMetodologia = 'lote_estimadores';
        viaM1Aplicada = '§6.2.3.7 (estimadores)';
        cumpleCirsocM1 = condMM1 && condInd1;
        detalleM1 = {
          via: viaM1Aplicada,
          condMM1,
          condInd1,
          tolIndividualMPa: TOL_INDIVIDUAL_M1,
          normaIndividual: NORMA_INDIVIDUAL_M1,
        };
      } else {
        // n < 3 — no se puede aplicar M1 (no hay grupos de 3 consecutivos).
        evaluacionMetodologia = 'no_aplica_m1';
        viaM1Aplicada = null;
        cumpleCirsocM1 = null;
      }

      // R9-4: M2 con excepción n<3 (solo individual).
      if (n >= 3) {
        cumpleCirsocM2 = condMM2 && condInd2;
        detalleM2 = { via: '§6.2.4 (general)', condMM2, condInd2 };
      } else {
        // §6.2.4 último párrafo: con menos de 3 pastones, solo Ec. 6-8.
        cumpleCirsocM2 = condInd2;
        detalleM2 = { via: '§6.2.4 (excepción n<3, solo individual Ec. 6-8)', condInd2 };
      }
    }

    // R9-3: marcar la desviación como referencial si n<15.
    const desviacionReferencial = n < 15;

    /* ═════ compilar salida ═════ */
    // C-LOG-02 fix: snapshot de Muestra con fallback a Despacho.
    const ctx0 = ejemplo._ctx;
    const plantaModeloMain = ctx0.planta && ctx0.planta.marca
      ? `${ctx0.planta.marca} - ${ctx0.planta.modelo}`
      : null;
    const prensaModeloMain = ejemplo.prensa
      ? `${ejemplo.prensa.marca} - ${ejemplo.prensa.modelo}`
      : null;
    const dosificacion = normalizeDosificacion(ctx0.dosificacion);
    // Recursos MVP Fase D: agregado del lote — cuántos ensayos del lote
    // se hicieron sin calibración aplicada (trazabilidad débil ISO 17025
    // §6.4.7). Total = todas las probetas del lote. SinCalibracion =
    // sumatoria de probetas sin idCalibracionAplicada.
    const probetasDelLoteSinCal = muestras
      .flatMap((m) => m.probetasSinCalibracion || []);
    const totalProbetasLote = muestras
      .reduce((acc, m) => acc + (m.cantidadProbetas ?? 0), 0);
    const trazabilidadCalibracion = {
      totalEnsayos: totalProbetasLote,
      sinCalibracionAplicada: probetasDelLoteSinCal.length,
      probetasSinCalibracion: probetasDelLoteSinCal,
    };

    salida.push({
      tipoHormigon: tipo,
      resistencia_media: media.toFixed(2),
      desviacion_estandar: desv.toFixed(2),
      caracteristica: fckCalc.toFixed(2),
      coef_variacion: `${cv.toFixed(2)}%`,
      resistencia_diseno: fck,
      tamanoLote: n,
      muestrasInvalidas,                              // CIRSOC §6.1.6.1 / IRAM 1666
      trazabilidadCalibracion,                        // Recursos MVP — ISO 17025 §6.4.7
      minima: min.toFixed(2),
      maxima: max.toFixed(2),
      cliente: ctx0.cliente?.tipoPersona === 'Física'
        ? ctx0.cliente.nombre
        : ctx0.cliente?.razonSocial ?? null,
      obra: ctx0.obra?.nombre ?? null,
      planta: ctx0.planta?.nombre ?? null,
      plantaModelo: plantaModeloMain,
      prensaModelo: prensaModeloMain,
      idDosificacion: dosificacion?.idDosificacion ?? null,
      dosificacionId: dosificacion?.idDosificacion ?? null,
      dosificacionNombre: dosificacion?.nombre ?? null,
      dosificacion,
      detalles: muestras,          // ← con mmPromedio / mmOk + consistenciaWarnings
      // PR8.3 — agregamos warnings de consistencia entre probetas (CIRSOC §6.1.6.3).
      // No descarta automáticamente; el usuario decide. Cada warning incluye
      // {idMuestra, idProbeta, motivo, sugerencia, severity, descarteSugerido?}.
      muestreosDescartados: muestras.flatMap((m) => m.consistenciaWarnings ?? []),
      mediasMoviles,
      cumpleLote,
      cumpleCirsocM1,
      cumpleCirsocM2,
      // Bloque 17 auditoría 08: autocontrol IRAM 1666 §A.7.10.1.1 + Tabla A.3
      // como tercer veredicto paralelo. NO es criterio de aceptación cliente —
      // es control interno del productor. El usuario elige cuál mostrar
      // según su contexto (productor vs cliente, M1 vs M2).
      cumpleIramAutocontrol: cumpleIramAutocontrol(valores, fck, desv),
      // 'lote_pleno' (n≥30, vía estadística §6.2.3.8)
      // | 'lote_estimadores' (3≤n<30, vía §6.2.3.7)
      // | 'no_aplica_m1' (n<3) | 'no_aplica' (sin datos)
      evaluacionMetodologia,
      // R9 (revisor-civil 2026-05-08): metadata adicional por vía CIRSOC §6.2.
      viaM1Aplicada,
      detalleM1,
      detalleM2,
      loteSubdimensionado,    // R9-5: n < 5 según §6.2.2.4
      desviacionReferencial,  // R9-3: σ no normativa si n < 15 (§6.2.3.4)
    });
  }

  if (descartadosSinTipo > 0) {
    // C-LOG-02 fix: visibilidad de ensayos descartados por falta de tipo
    // (muestras sin dosificación ni tipoHormigon snapshoteados).
    console.warn(`[probetaService.buildChartData] ${descartadosSinTipo} ensayo(s) descartado(s) por no poder determinar tipo de hormigón (muestra sin snapshot ni despacho con dosificación).`);
  }
  /* ─────────── ordenar por fck de diseño ─────────── */
  return salida.sort((a, b) => a.resistencia_diseno - b.resistencia_diseno);
}



function buildChartDataWithFactor(ensayos, factor, extractor = extractMuestraContext) {
  const muestraMap = new Map();
  let descartadosSinTipo = 0;

  for (const e of ensayos) {
    // C-LOG-02 fix: usar el extractor con snapshot Muestra > Despacho.
    // M-LOG-08 fix (auditoría 08, Bloque 9): extractor parametrizable
    // (terceros usa otro). Quedó dedup'd con el path de muestras propias.
    const ctx = extractor(e);
    if (!ctx) {
      descartadosSinTipo += 1;
      continue;
    }
    e._ctx = ctx;
    const tipoStr = ctx.tipoStr;
    const objBase = ctx.fck;  // mismo cálculo que antes (regex sobre tipoStr)
    const idMue = ctx.idMuestra;

    if (!muestraMap.has(idMue)) {
      muestraMap.set(idMue, {
        tipo: tipoStr,
        objBase,
        resistencias: [],
        ejemplo: e,
        muestras: [],
      });
    }
    muestraMap.get(idMue).resistencias.push(Number(e.resistencia));
    muestraMap.get(idMue).muestras.push(e);
  }

  const tipoMap = new Map();

  for (const { tipo, objBase, resistencias, ejemplo, muestras } of muestraMap.values()) {
    // “objSub” es objBase * factor
    const objSub = objBase * factor;
    const mediaMuestra =
      resistencias.reduce((a, b) => a + b, 0) / resistencias.length;
    // criterio: mediaMuestra >= objSub - 3.5
    const cumple = mediaMuestra >= objSub - 3.5;

    if (!tipoMap.has(tipo)) {
      tipoMap.set(tipo, {
        objSub,
        allResistencias: [],
        loteCount: 0,
        ejemplo,
        muestrasValidas: 0,
        detalles: [],
      });
    }

    const entry = tipoMap.get(tipo);
    entry.allResistencias.push(mediaMuestra);
    entry.loteCount += 1;
    if (cumple) entry.muestrasValidas += 1;

    // detalle individual — C-LOG-02 fix: usar contexto consolidado.
    const muestraEj = muestras[0];
    const ctxEj = muestraEj._ctx;
    const detalleDosificacion = normalizeDosificacion(ctxEj.dosificacion);
    entry.detalles.push({
      idMuestra: ctxEj.idMuestra,
      fechaToma: ctxEj.fecha,
      remito: ctxEj.remito,
      fechaConfeccion: ctxEj.fecha,
      fechaRotura: muestraEj.fechaEnsayo,
      edadEnsayo: muestraEj.edadEnsayo,
      operador: muestraEj.operador,
      resistenciaPromedio: mediaMuestra,
      planta: ctxEj.planta?.nombre ?? null,
      obra:   ctxEj.obra?.nombre ?? null,
      cliente:
        ctxEj.cliente?.tipoPersona === "Física"
          ? ctxEj.cliente.nombre
          : ctxEj.cliente?.razonSocial ?? null,
      cumple,
      dosificacion: detalleDosificacion?.nombre ?? null,
    });
  }

  if (descartadosSinTipo > 0) {
    console.warn(`[probetaService.buildChartDataWithFactor] ${descartadosSinTipo} ensayo(s) descartado(s) por no poder determinar tipo de hormigón.`);
  }

  return Array.from(tipoMap.entries())
    .map(
      ([tipo, { objSub, allResistencias, loteCount, ejemplo, muestrasValidas, detalles }]) => {
        const n = allResistencias.length;
        const media = allResistencias.reduce((a, b) => a + b, 0) / n;
        const variance =
          allResistencias.reduce(
            (sum, val) => sum + Math.pow(val - media, 2),
            0
          ) /
          (n - 1);
        const desviacion = Math.sqrt(variance);
        // f'ck = f'cm − K_CIRSOC_LOTE · t(n) · σ. Ver explicación detallada
        // en getResistencias (mismo fix unificado a 1,28, fractil 10%).
        const tCar = n >= 30 ? 1 : (tStudentK[n] ?? 1);
        const caracteristica = media - K_CIRSOC_LOTE * tCar * desviacion;

        const cv = (desviacion / media) * 100;

        const minima = Math.min(...allResistencias);
        const maxima = Math.max(...allResistencias);

        const ctxEj = ejemplo._ctx;
        const dosificacion = normalizeDosificacion(ctxEj.dosificacion);

        const cumplimientoPct =
          loteCount > 0 ? (muestrasValidas / loteCount) * 100 : 0;

        return {
          tipoHormigon: tipo,
          resistencia_media: media.toFixed(2),
          desviacion_estandar: desviacion.toFixed(2),
          caracteristica: caracteristica.toFixed(2),
          coef_variacion: `${cv.toFixed(2)}%`,
          // C-NORM-01 (auditoría 08, Bloque 4): los factores 0,70 (7d→28d)
          // y 0,87 (14d→28d) son aproximaciones bibliográficas (ACI 209R)
          // que dependen del cemento, a/c y curado — NO normativos para
          // aceptación. CIRSOC 200-2024 §6.2 (aceptación) evalúa a edad
          // de diseño. Etiquetamos el resultado como estimación
          // informativa para que el PDF/UI lo muestre con disclaimer.
          // Sprint 6 B5: comment previo citaba "§4.3" — §4.3 es Aire
          // incorporado en CIRSOC 200-2024, no aceptación.
          resistencia_diseno: objSub.toFixed(2),
          tamanoLote: loteCount,
          minima: minima.toFixed(2),
          maxima: maxima.toFixed(2),
          cumpleIram: cumpleIram(media, objSub),
          cumpleCirsoc: cumpleCirsoc(media, desviacion, objSub),
          cumplimiento: `${cumplimientoPct.toFixed(0)}%`,
          esEstimacion: true,
          factorAplicado: factor,
          notaEstimacion: `Estimación a edad de diseño aplicando factor ${factor.toFixed(2)} (referencia ACI 209R). NO normativo para aceptación CIRSOC 200-2024 §6.2.`,
          cliente:
            ctxEj.cliente?.tipoPersona === "Física"
              ? ctxEj.cliente.nombre
              : ctxEj.cliente?.razonSocial ?? null,
          obra:   ctxEj.obra?.nombre || null,
          planta: ctxEj.planta?.nombre || null,
          idDosificacion: dosificacion?.nombre || null,
          dosificacionId: dosificacion?.idDosificacion ?? null,
          dosificacionNombre: dosificacion?.nombre ?? null,
          dosificacion,
          detalles,
        };
      }
    )
    .sort((a, b) => a.resistencia_diseno - b.resistencia_diseno);
}

/**
 * Wrapper liviano: terceros usa el extractor especializado.
 * M-LOG-08 fix (auditoría 08, Bloque 9): antes este archivo tenía ~170
 * LOC duplicados de `buildChartData`. Ahora delega.
 */
function buildChartDataTerceros(ensayos) {
  return buildChartData(ensayos, extractMuestraTercerosContext);
}

/**
 * Wrapper liviano para terceros con factor de extrapolación 0.7/0.87.
 * M-LOG-08 fix (auditoría 08, Bloque 9): legacy ~270 LOC eliminado.
 */
function buildChartDataWithFactorTerceros(ensayos, factor) {
  return buildChartDataWithFactor(ensayos, factor, extractMuestraTercerosContext);
}

const getResistencias = async (db, params) => {
  const { edadDiseno, muestrasTerceros, tipoFecha, ...f } = params;
  if (!edadDiseno) throw new Error("edadDiseno es obligatorio");
  const filtrarPorConfeccion = tipoFecha !== 'rotura';

  // Cache de reportes de resistencia (data mayormente historica)
  const tc = getCacheForDb(db);
  const sortedParams = JSON.stringify(params, Object.keys(params).sort());
  const cacheKey = `resistencias:${sortedParams}`;
  const cached = tc.get('probetas', cacheKey);
  if (cached) return cached;

  const terceros = muestrasTerceros === true || muestrasTerceros === 'true';
  if (terceros) {
    const whereM = {
      ...(f.idPlanta && { idPlanta: f.idPlanta }),
      ...(f.idCliente && { idCliente: f.idCliente }),
      ...(f.idObra && { idObra: f.idObra }),
      ...(f.idTipoHormigon && { idTipoHormigon: f.idTipoHormigon }),
      ...(filtrarPorConfeccion && (f.desde || f.hasta)) && {
        fecha: {
          ...(f.desde && { [Op.gte]: f.desde }),
          ...(f.hasta && { [Op.lte]: f.hasta }),
        },
      },
    };
    const muestras = await db.MuestraTerceros.findAll({
      attributes: ['idMuestraTerceros'],
      where: whereM,
    });
    if (!muestras.length) return { main: [], probetas: [] };
    let mIds = muestras.map((m) => m.idMuestraTerceros);

    // M-LOG-07 (auditoría 08, Bloque 13): la igualdad estricta es deliberada.
    // CIRSOC 200-2024 §6.2 evalúa cumplimiento a la edad nominal de diseño,
    // así que mezclar 27d y 28d en el mismo análisis falsearía la estadística.
    // Si aparecen probetas con `diasRotura` off-by-1 son bug de carga de datos
    // (la fechaRotura debería derivar de `muestra.fecha + diasRotura`); el fix
    // va en el formulario de carga, NO en este query.
    const probetasDiseno = await db.Probeta.findAll({
      attributes: ['idProbeta', 'idMuestraTerceros', 'diasRotura', 'codigo', 'idEstadoProbeta', "observaciones"],
      where: { idMuestraTerceros: mIds, diasRotura: edadDiseno },
    });
    if (!probetasDiseno.length) return { main: [], probetas: [] };

    const whereEnsayoTerceros = {
      idProbeta: probetasDiseno.map((p) => p.idProbeta),
      pendienteRevision: false,
      ...(!filtrarPorConfeccion && (f.desde || f.hasta)) && {
        fechaEnsayo: {
          ...(f.desde && { [Op.gte]: f.desde }),
          ...(f.hasta && { [Op.lte]: f.hasta }),
        },
      },
    };
    const ensayosDiseno = await db.EnsayoResistencia.findAll({
      where: whereEnsayoTerceros,
      order: [['fechaEnsayo', 'DESC']],
      include: [
        {
          model: db.Probeta,
          as: 'probeta',
          attributes: ['idProbeta', 'idMuestraTerceros', 'observaciones'],
          include: [
            {
              model: db.MuestraTerceros,
              as: 'muestraTerceros',
              attributes: ['idMuestraTerceros', 'fecha', 'remito'],
              include: [
                { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
                { model: db.Obra, as: 'obra', attributes: ['nombre'] },
                { model: db.Planta, as: 'planta', attributes: ['nombre', 'marca', 'modelo'] },
                { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
              ],
            },
          ],
        },
        { model: db.Prensa, as: 'prensa', attributes: ['nombre', 'marca', 'modelo'] },
        { model: db.Empleado, as: 'operarioEnsayo', attributes: ['nombre', 'apellido'] },
      ],
    });

    for (const e of ensayosDiseno) {
      if (e.operarioEnsayo) {
        e.operador = `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`;
      }
    }

    const mainResult = buildChartDataTerceros(ensayosDiseno);
    const probetaIdsReporte = new Set(ensayosDiseno.map((e) => e.idProbeta));

    const probetaEnsayoMap = new Map();
    for (const ensayo of ensayosDiseno) {
      probetaEnsayoMap.set(ensayo.idProbeta, ensayo);
    }

    // Cuando se filtra por fecha de rotura, acotar mIds a solo las que tienen ensayos en rango
    if (!filtrarPorConfeccion && (f.desde || f.hasta)) {
      const validMIds = new Set(
        ensayosDiseno.map(e => e.probeta?.idMuestraTerceros).filter(Boolean)
      );
      mIds = mIds.filter(id => validMIds.has(id));
    }

    // M-LOG-06 fix (auditoría 08, Bloque 13): SQL trata `<col> != X` como NULL
    // cuando el valor es NULL, así que las probetas con `diasRotura IS NULL` se
    // perdían del listado de hermanas. Combinamos `Op.ne` con `Op.is: null`
    // para incluirlas (típicamente probetas legacy o con planificación abierta).
    const probetasHermanas = await db.Probeta.findAll({
      attributes: ['idProbeta', 'idMuestraTerceros', 'diasRotura', 'codigo', 'idEstadoProbeta', "observaciones"],
      where: {
        idMuestraTerceros: mIds,
        [Op.or]: [
          { diasRotura: { [Op.ne]: edadDiseno } },
          { diasRotura: { [Op.is]: null } },
        ],
      },
    });

    const hermanas = {};
    if (probetasHermanas.length) {
      const agrupadas = {};
      for (const p of probetasHermanas) {
        if (!agrupadas[p.diasRotura]) agrupadas[p.diasRotura] = [];
        agrupadas[p.diasRotura].push(p.idProbeta);
      }

      for (const [dias, ids] of Object.entries(agrupadas)) {
        const ensayos = await db.EnsayoResistencia.findAll({
          where: { idProbeta: ids, pendienteRevision: false },
          order: [['fechaEnsayo', 'DESC']],
          include: [
            {
              model: db.Probeta,
              as: 'probeta',
              attributes: ['idProbeta', 'idMuestraTerceros', 'observaciones'],
              include: [
                {
                  model: db.MuestraTerceros,
                  as: 'muestraTerceros',
                  attributes: ['idMuestraTerceros', 'fecha', 'remito'],
                  include: [
                    { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
                    { model: db.Obra, as: 'obra', attributes: ['nombre'] },
                    { model: db.Planta, as: 'planta', attributes: ['nombre', 'marca', 'modelo'] },
                    { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
                  ],
                },
              ],
            },
            { model: db.Prensa, as: 'prensa', attributes: ['nombre', 'marca', 'modelo'] },
            { model: db.Empleado, as: 'operarioEnsayo', attributes: ['nombre', 'apellido'] },
          ],
        });
        for (const e of ensayos) {
          if (e.operarioEnsayo) {
            e.operador = `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`;
          }
          probetaEnsayoMap.set(e.idProbeta, e);
          probetaIdsReporte.add(e.idProbeta);
        }
        const dNum = Number(dias);
        if (dNum === 7) hermanas[dias] = buildChartDataWithFactorTerceros(ensayos, 0.7);
        else if (dNum === 14) hermanas[dias] = buildChartDataWithFactorTerceros(ensayos, 0.87);
        else hermanas[dias] = buildChartDataTerceros(ensayos);
      }
    }

    const probetasList = [...probetasDiseno, ...probetasHermanas]
      .filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA)
      .filter((p) => probetaEnsayoMap.has(p.idProbeta)) // Excluir probetas con ensayo pendiente de revisión
      .filter((p) => filtrarPorConfeccion || !(f.desde || f.hasta) || probetaIdsReporte.has(p.idProbeta))
      .map((p) => ({
        idProbeta: p.idProbeta,
        idMuestra: p.idMuestraTerceros ?? null,
        codigo: p.codigo ?? null,
        edad: p.diasRotura,
        observaciones: p.observaciones ?? null,
        resistencia: probetaEnsayoMap.get(p.idProbeta)?.resistencia ?? null,
      }));

    const resultTerceros = {
      main: mainResult,
      hermanas,
      probetas: probetasList,
      probetaIdsReporte: Array.from(probetaIdsReporte),
    };
    tc.set('probetas', cacheKey, resultTerceros, RESISTENCIAS_TTL);
    return resultTerceros;
  }

  // ═══════════════════════════════════════════════════════════
  // MUESTRAS PROPIAS (NO TERCEROS)
  //
  // C-LOG-03 + C-LOG-04 fix (auditoría 08, Bloque 2):
  //  - Ya no pre-filtramos por Despacho. Las muestras post-mig 20260505g
  //    pueden no tener idDespacho y antes quedaban excluidas del reporte.
  //  - Filtramos directamente sobre Muestra usando los snapshots
  //    (idCliente, idObra, idPlanta, idTipoHormigon, idDosificacion).
  //  - El filtro de fecha por confección usa Muestra.fecha (DATEONLY de
  //    moldeo) en vez de Muestra.createdAt (timestamp de inserción), que
  //    daba resultados incorrectos cuando una muestra se cargaba con
  //    retraso.
  // ═══════════════════════════════════════════════════════════

  const whereMue = {
    ...(f.idPlanta       && { idPlanta:       f.idPlanta }),
    ...(f.idCliente      && { idCliente:      f.idCliente }),
    ...(f.idObra         && { idObra:         f.idObra }),
    ...(f.idTipoHormigon && { idTipoHormigon: f.idTipoHormigon }),
    ...(f.idDosificacion && { idDosificacion: f.idDosificacion }),
    ...(filtrarPorConfeccion && (f.desde || f.hasta)) && {
      fecha: {
        ...(f.desde && { [Op.gte]: f.desde }),
        ...(f.hasta && { [Op.lte]: f.hasta }),
      },
    },
  };
  const muestras = await db.Muestra.findAll({
    attributes: ["idMuestra"],
    where: whereMue,
  });
  if (!muestras.length) return { main: [], probetas: [], hermanas: {}, probetaIdsReporte: [] };

  let muestraIds = muestras.map((m) => m.idMuestra);

  // 4) Buscar Probetas con diasRotura = edadDiseno (sin filtrar por idEdadDisenio de dosificación)
  const probetasDiseno = await db.Probeta.findAll({
    attributes: ["idProbeta", "idEnsayoResistencia", "idMuestra", "codigo", "diasRotura", "idEstadoProbeta", "observaciones"],
    where: {
      idMuestra: muestraIds,
      diasRotura: edadDiseno,
    },
  });
  if (!probetasDiseno.length) return { main: [], probetas: [], hermanas: {}, probetaIdsReporte: [] };

  // 5) Obtener EnsayoResistencia de las probetas de diseño
  const whereEnsayoPropias = {
    idProbeta: probetasDiseno.map((p) => p.idProbeta),
    pendienteRevision: false,
    ...(!filtrarPorConfeccion && (f.desde || f.hasta)) && {
      fechaEnsayo: {
        ...(f.desde && { [Op.gte]: f.desde }),
        ...(f.hasta && { [Op.lte]: f.hasta }),
      },
    },
  };
  const ensayosDiseno = await db.EnsayoResistencia.findAll({
    where: whereEnsayoPropias,
    order: [["fechaEnsayo", "DESC"]],
    include: [
      {
        model: db.Probeta,
        as: "probeta",
        attributes: ["idProbeta", "idMuestra", 'observaciones'],
        include: [buildMuestraInclude(db)],
      },
      { model: db.Prensa, as: "prensa", attributes: ["nombre", "marca", "modelo"] },
      { model: db.Empleado, as: "operarioEnsayo", attributes: ["nombre", "apellido"] },
    ],
  });

  for (const e of ensayosDiseno) {
    if (e.operarioEnsayo) {
      e.operador = `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`;
    }
  }

  const probetaEnsayoMap = new Map();
  const probetaIdsReporte = new Set(ensayosDiseno.map((e) => e.idProbeta));
  for (const ensayo of ensayosDiseno) {
    probetaEnsayoMap.set(ensayo.idProbeta, ensayo);
  }

  const mainResult = buildChartData(ensayosDiseno);

  // Cuando se filtra por fecha de rotura, acotar muestraIds a solo las que tienen ensayos en rango
  if (!filtrarPorConfeccion && (f.desde || f.hasta)) {
    const validMuestraIds = new Set(
      ensayosDiseno.map(e => e.probeta?.idMuestra).filter(Boolean)
    );
    muestraIds = muestraIds.filter(id => validMuestraIds.has(id));
  }

  // 6) Buscar probetas hermanas (otras edades).
  // M-LOG-06 fix (auditoría 08, Bloque 13): incluimos `diasRotura IS NULL`
  // junto con `Op.ne` para no perder probetas legacy o sin planificación.
  const probetasHermanas = await db.Probeta.findAll({
    attributes: ["idProbeta", "idMuestra", "diasRotura", "codigo", "idEstadoProbeta", "observaciones"],
    where: {
      idMuestra: muestraIds,
      [Op.or]: [
        { diasRotura: { [Op.ne]: edadDiseno } },
        { diasRotura: { [Op.is]: null } },
      ],
    },
  });

  const hermanas = {};
  if (probetasHermanas.length) {
    const agrupadas = {};
    for (const p of probetasHermanas) {
      if (!agrupadas[p.diasRotura]) agrupadas[p.diasRotura] = [];
      agrupadas[p.diasRotura].push(p.idProbeta);
    }

    for (const [dias, ids] of Object.entries(agrupadas)) {
      const ensayos = await db.EnsayoResistencia.findAll({
        where: { idProbeta: ids, pendienteRevision: false },
        order: [["fechaEnsayo", "DESC"]],
        include: [
          {
            model: db.Probeta,
            as: "probeta",
            attributes: ["idProbeta", "idMuestra", 'observaciones'],
            include: [buildMuestraInclude(db)],
          },
          { model: db.Prensa, as: "prensa", attributes: ["nombre", "marca", "modelo"] },
          { model: db.Empleado, as: "operarioEnsayo", attributes: ["nombre", "apellido"] },
        ],
      });
      for (const e of ensayos) {
        if (e.operarioEnsayo) {
          e.operador = `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`;
        }
        probetaEnsayoMap.set(e.idProbeta, e);
        probetaIdsReporte.add(e.idProbeta);
      }
      const dNum = Number(dias);
      if (dNum === 7) hermanas[dias] = buildChartDataWithFactor(ensayos, 0.7);
      else if (dNum === 14) hermanas[dias] = buildChartDataWithFactor(ensayos, 0.87);
      else hermanas[dias] = buildChartData(ensayos);
    }
  }

  const resultPropias = {
    main: mainResult,
    hermanas,
    probetas: [...probetasDiseno, ...probetasHermanas]
      .filter((p) => p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA)
      .filter((p) => probetaEnsayoMap.has(p.idProbeta)) // Excluir probetas con ensayo pendiente de revisión
      .filter((p) => filtrarPorConfeccion || !(f.desde || f.hasta) || probetaIdsReporte.has(p.idProbeta))
      .map((p) => ({
        idProbeta: p.idProbeta,
        idMuestra: p.idMuestra ?? null,
        codigo: p.codigo ?? null,
        edad: p.diasRotura,
        observaciones: p.observaciones ?? null,
        resistencia: probetaEnsayoMap.get(p.idProbeta)?.resistencia ?? null,
      })),
    probetaIdsReporte: Array.from(probetaIdsReporte),
  };
  tc.set('probetas', cacheKey, resultPropias, RESISTENCIAS_TTL);
  return resultPropias;
};
const getProbetasFiltradas = async (db, params) => {
  const { muestrasTerceros, tipoFecha, ...f } = params;
  const filtrarPorConfeccion = tipoFecha !== 'rotura';

  const terceros = muestrasTerceros === true || muestrasTerceros === 'true';

  if (terceros) {
    const whereM = {
      ...(f.idPlanta && { idPlanta: f.idPlanta }),
      ...(f.idCliente && { idCliente: f.idCliente }),
      ...(f.idObra && { idObra: f.idObra }),
      ...(f.idTipoHormigon && { idTipoHormigon: f.idTipoHormigon }),
      ...(filtrarPorConfeccion && (f.desde || f.hasta)) && {
        fecha: {
          ...(f.desde && { [Op.gte]: f.desde }),
          ...(f.hasta && { [Op.lte]: f.hasta }),
        },
      },
    };

    const muestras = await db.MuestraTerceros.findAll({
      attributes: ['idMuestraTerceros', 'remito'],
      where: whereM,
    });
    if (!muestras.length) return [];

    return db.Probeta.findAll({
      where: {
        idMuestraTerceros: muestras.map((m) => m.idMuestraTerceros),
        ...(f.idEstadoProbeta && { idEstadoProbeta: f.idEstadoProbeta }),
        ...(!filtrarPorConfeccion && (f.desde || f.hasta)) && {
          fechaRotura: {
            ...(f.desde && { [Op.gte]: f.desde }),
            ...(f.hasta && { [Op.lte]: f.hasta }),
          },
        },
      },
      include: [
        { model: db.EstadoProbeta, as: 'estadoProbeta' },
        { model: db.Archivo, as: 'archivos' },
        { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
        {
          model: db.MuestraTerceros,
          as: 'muestraTerceros',
          include: [
            { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
            { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
            { model: db.Obra, as: 'obra', attributes: ['nombre'] },
            { model: db.TipoHormigon, as: 'tipoHormigon' },
          ],
        },
        { model: db.EnsayoResistencia, as: 'ensayo' },
      ],
      order: [['fechaRotura', 'DESC']],
    });
  }

  // Filtramos directamente sobre los campos snapshot de Muestra. Esto cubre
  // muestras propias con y sin despacho. El despacho queda como include
  // opcional para complementar datos exclusivos (hora, remito), pero no es
  // requerido para la búsqueda.
  const whereMue = {
    ...(f.idTipoHormigon && { idTipoHormigon: f.idTipoHormigon }),
    ...(f.idDosificacion && { idDosificacion: f.idDosificacion }),
    ...(f.idPlanta && { idPlanta: f.idPlanta }),
    ...(f.idCliente && { idCliente: f.idCliente }),
    ...(f.idObra && { idObra: f.idObra }),
    ...((filtrarPorConfeccion && (f.desde || f.hasta)) && {
      fecha: {
        ...(f.desde && { [Op.gte]: f.desde }),
        ...(f.hasta && { [Op.lte]: f.hasta }),
      },
    }),
  };

  const muestras = await db.Muestra.findAll({
    attributes: ['idMuestra'],
    where: whereMue,
  });
  if (!muestras.length) return [];

  return db.Probeta.findAll({
    where: {
      idMuestra: muestras.map((m) => m.idMuestra),
      ...(f.idEstadoProbeta && { idEstadoProbeta: f.idEstadoProbeta }),
      ...((!filtrarPorConfeccion && (f.desde || f.hasta)) && {
        fechaRotura: {
          ...(f.desde && { [Op.gte]: f.desde }),
          ...(f.hasta && { [Op.lte]: f.hasta }),
        },
      }),
    },
    include: [
      { model: db.EstadoProbeta, as: 'estadoProbeta' },
      { model: db.Archivo, as: 'archivos' },
      { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
      {
        model: db.Muestra,
        as: 'muestra',
        include: [
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre', 'marca', 'modelo'] },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          {
            model: db.Dosificacion,
            as: 'dosificacion',
            attributes: ['idDosificacion', 'nombre'],
            include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
          },
          {
            model: db.Despacho,
            as: 'despacho',
            required: false,
            attributes: ['fecha', 'hora', 'idPlanta', 'remito'],
            include: [
              { model: db.Planta, as: 'planta', attributes: ['nombre', 'marca', 'modelo', 'idPlanta'] },
              { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
              { model: db.Obra, as: 'obra', attributes: ['nombre'] },
              {
                model: db.Dosificacion,
                as: 'dosificacion',
                attributes: ['idDosificacion', 'nombre'],
                include: [{ model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] }],
              },
            ],
          },
        ],
      },
      { model: db.EnsayoResistencia, as: 'ensayo' },
    ],
    order: [['fechaRotura', 'DESC']],
  });
};

const getProbetasWeb = async (db, { razonSocial, cuit }) => {
  const cliente = await db.Cliente.findOne({
    where: { razonSocial: razonSocial, cuil_cuit: cuit },
  });

  if (!cliente) {
    return { probetas: [], probetasTerceros: [] };
  }

  const probetas = await db.Probeta.findAll({
    include: [
      { model: db.EstadoProbeta, as: 'estadoProbeta' },
      { model: db.Archivo, as: 'archivos' },
      { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
      {
        model: db.Muestra,
        as: 'muestra',
        required: true,
        include: [
          {
            model: db.Despacho,
            as: 'despacho',
            required: true,
            where: { idCliente: cliente.idCliente },
            attributes: ['fecha', 'hora', 'idPlanta', "remito"],
            include: [
              { model: db.Planta, as: 'planta', attributes: ['nombre', 'marca', 'modelo', 'idPlanta'] },
              { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
              { model: db.Obra, as: 'obra', attributes: ['nombre'] },
              {
                model: db.Dosificacion,
                as: 'dosificacion',
                attributes: ['idDosificacion', 'nombre'],
                include: [
                  { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
                  { model: db.EdadDisenio, as: 'edadDisenio', attributes: ['dias'] },
                ],
              },
            ],
          },
        ],
      },
      { model: db.EnsayoResistencia, as: 'ensayo', required: false, where: { pendienteRevision: false } },
      { model: db.Pileta, as: 'pileta', required: false, attributes: ['idPileta', 'nombre'] },
    ],
    order: [['fechaRotura', 'DESC']],
  });

  const probetasTerceros = await db.Probeta.findAll({
    include: [
      { model: db.EstadoProbeta, as: 'estadoProbeta' },
      { model: db.Archivo, as: 'archivos' },
      { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
      {
        model: db.MuestraTerceros,
        as: 'muestraTerceros',
        required: true,
        where: { idCliente: cliente.idCliente },
        include: [
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Obra, as: 'obra', attributes: ['nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
        ],
      },
      { model: db.EnsayoResistencia, as: 'ensayo', required: false, where: { pendienteRevision: false } },
      { model: db.Pileta, as: 'pileta', required: false, attributes: ['idPileta', 'nombre'] },
    ],
    order: [['fechaRotura', 'DESC']],
  });
  return {
    // Excluir probetas cuyo ensayo está pendiente de revisión (estado Ensayada pero sin ensayo aprobado)
    probetas: probetas
      .filter((p) => !(p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA && !p.ensayo))
      .map((p) => ({
        idProbeta: p.idProbeta,
        nombre: p.nombre,
        codigo: p.codigo ?? null,
        idMuestra: p.idMuestra ?? null,
        estado: p.estadoProbeta?.estado,
        fechaConfeccion: p.muestra?.despacho?.fecha,
        fechaRotura: p.ensayo?.fechaEnsayo ?? null,
        dias: p.diasRotura ?? null,
        remito: p.muestra?.despacho?.remito ?? null,
        resistencia: p.ensayo?.resistencia,
        tipoHormigon: p.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon,
        edadDisenio: p.muestra?.despacho?.dosificacion?.edadDisenio?.dias ?? null,
        idPileta: p.idPileta ?? null,
        piletaNombre: p.pileta?.nombre ?? null,
        planta: p.muestra?.despacho?.planta?.nombre ?? null,
        obra: p.muestra?.despacho?.obra?.nombre ?? null,
        dosificacion: p.muestra?.despacho?.dosificacion?.nombre ?? null,
      })),
    // Excluir probetas terceros cuyo ensayo está pendiente de revisión
    probetasTerceros: probetasTerceros
      .filter((p) => !(p.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA && !p.ensayo))
      .map((p) => ({
        idProbeta: p.idProbeta,
        nombre: p.nombre,
        codigo: p.codigo ?? null,
        idMuestraTerceros: p.idMuestraTerceros ?? null,
        estado: p.estadoProbeta?.estado,
        fechaConfeccion: p.muestraTerceros?.fecha,
        fechaRotura: p.ensayo?.fechaEnsayo ?? null,
        dias: p.diasRotura ?? null,
        resistencia: p.ensayo?.resistencia,
        tipoHormigon: p.muestraTerceros?.tipoHormigon?.tipoHormigon,
        edadDisenio: null,
        idPileta: p.idPileta ?? null,
        piletaNombre: p.pileta?.nombre ?? null,
        planta: p.muestraTerceros?.planta?.nombre ?? null,
        obra: p.muestraTerceros?.obra?.nombre ?? null,
        dosificacion: null,
      })),
  };
};

const generateResistancePDF = async (db, params, empleadoFirma, productorHormigon, configEmpresa, options = {}) => {
  const { esOficial = false, idEmpleado, fileName } = options;
  // Obtener los datos usando la función existente
  const resData = await getResistencias(db, params);
  const {
    main: mainData,
    hermanas: hermanasData,
    probetas: probetasData,
    probetaIdsReporte,
  } = resData;

  if (!mainData || mainData.length === 0) {
    throw new Error('No hay datos disponibles para generar el PDF');
  }

  const doc = new jsPDF('l');

  // Configuración
  const {
    edadDiseno,
    muestrasTerceros,
    showCliente,
    showDosificacion,
    showPlanta,
    showObra,
    data10porciento,
    showSabana,
    showHermanas,
    showListadoProbetas,
    showResumenEstadistico,
    criteriosCumplimiento,
    showIram,
    showCirsocM1,
    showCirsocM2,
    showGraficoComparativo,
    showGraficoEvolucion,
    // T7 PR9 sweep: modo de evaluación que viaja desde el frontend (default
    // PRESTACIONAL si no llega). En modo PRESCRIPTIVO el PDF dibuja un banner
    // amarillo cerca del header indicando que la norma es soberana — útil para
    // auditorías externas. No cambia los cálculos, sólo la presentación.
    modoEvaluacion = 'PRESTACIONAL',
  } = params;

  // Variables de trabajo
  let logoData = null;
  let firmaData = null;

  // Cargar logo si existe
  if (configEmpresa?.thumbnail) {
    try {
      const axios = require('axios');
      const response = await axios.get(configEmpresa.thumbnail, { responseType: 'arraybuffer' });
      logoData = `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;
    } catch (err) {
      console.error("No se pudo cargar el logo para el PDF", err);
    }
  }

  // Cargar firma si existe
  if (empleadoFirma?.firma) {
    try {
      const axios = require('axios');
      const response = await axios.get(empleadoFirma.firma, { responseType: 'arraybuffer' });
      firmaData = `data:image/png;base64,${Buffer.from(response.data).toString('base64')}`;
    } catch (err) {
      console.error("No se pudo cargar la firma para el PDF", err);
    }
  }

  // Config columnas de resumen
  let resumenColumns = [
    "tipoHormigon",
    "resistencia_diseno",
    "resistencia_media",
    "caracteristica",
    "minima",
    "maxima",
    "desviacion_estandar",
    "coef_variacion",
  ];

  let edadesHermanas = [];
  if (showHermanas) {
    edadesHermanas = Object.keys(hermanasData)
      .map(e => parseInt(e, 10))
      .sort((a, b) => a - b);
  }

  if (criteriosCumplimiento && showIram) resumenColumns.push("cumpleLote");
  if (criteriosCumplimiento && showCirsocM1) resumenColumns.push("cumpleCirsocM1");
  if (criteriosCumplimiento && showCirsocM2) resumenColumns.push("cumpleCirsocM2");
  resumenColumns.push("tamanoLote");

  const columnHeaders = {
    tipoHormigon: "Tipo de Hormigón",
    resistencia_media: "Resist. Media",
    desviacion_estandar: "Desviación",
    minima: "Resist. Mín.",
    maxima: "Resist. Máx.",
    caracteristica: "Resist. Característica",
    coef_variacion: "Coef. Variación",
    resistencia_diseno: "Resist. Objetivo",
    cumpleLote: "Cumple Lote",
    cumpleCirsocM1: "Cumple CIRSOC M1",
    cumpleCirsocM2: "Cumple CIRSOC M2",
    tamanoLote: "Tamaño del Lote",
  };

  // Encabezado
  doc.setFontSize(16);
  doc.setFont("Helvetica", "bold");
  doc.text("Reporte de Resistencias", 14, 15);
  doc.setFontSize(9);
  doc.setFont("Helvetica", "normal");
  // M-PDF-06 fix (auditoría 08, Bloque 9): IRAM 1546 es la norma de
  // procedimiento del ensayo de compresión, no la norma de aceptación. Los
  // criterios de aceptación estadística aplicados en este reporte son de
  // IRAM 1666 / CIRSOC 200-2024 §6.2 (revisor-civil sesión 2026-05-09:
  // confirmado §6.2 — la edición 2024 mantiene la numeración del Cap. 6).
  doc.text("Procedimiento de ensayo: IRAM 1546:2013 (3ra edición)", 14, 21);
  doc.text("Criterio de aceptación: IRAM 1666 / CIRSOC 200-2024 §6.2", 14, 26);
  doc.setFontSize(11);

  let yPos = 32;

  // T7 PR9 sweep: banner de modo PRESCRIPTIVO (auditorías externas). Patrón
  // tomado de `agregadoFichaTecnicaPdf.js:597-625` (regla 2 PR9 CLAUDE.md).
  if (modoEvaluacion === 'PRESCRIPTIVO') {
    const bannerY = yPos;
    const bannerH = 7;
    doc.setFillColor(255, 243, 205);             // amarillo claro
    doc.setDrawColor(255, 193, 7);               // borde amarillo
    doc.rect(14, bannerY, 270, bannerH, 'FD');
    doc.setTextColor(120, 80, 0);
    doc.setFontSize(8);
    doc.setFont("Helvetica", "bold");
    doc.text(
      'Modo PRESCRIPTIVO — la norma CIRSOC 200-2024 + serie IRAM es soberana (auditoría externa).',
      18,
      bannerY + 5
    );
    doc.setTextColor(0, 0, 0);
    doc.setFont("Helvetica", "normal");
    yPos += bannerH + 3;
  }
  const productor = muestrasTerceros
    ? (productorHormigon || "—")
    : (configEmpresa?.nombreEmpresa ?? "—");

  const generalInfo = [
    ["Fecha", dayjs().format("DD/MM/YYYY")],
    ["Edad de diseño", `${edadDiseno} días`],
    ["ID Planta", mainData[0]?.plantaModelo ?? "—"],
    ["ID Prensa", mainData[0]?.prensaModelo ?? "—"],
    ["Productor del Hormigón", productor],
  ];

  autoTable(doc, {
    startY: yPos,
    body: generalInfo,
    theme: "grid",
    styles: { fontSize: 9 },
  });

  yPos = doc.lastAutoTable.finalY + 10;
  const pageH = doc.internal.pageSize.getHeight();
  const bottomMargin = 23;

  // Datos combinados
  const todosResumen = [
    ...(mainData ?? []),
    ...(showHermanas ? Object.values(hermanasData).flat() : [])
  ];

  const todosDetalles = todosResumen.flatMap(
    (d) => d.probetas ?? d.detalles ?? []
  );

  const uniqCount = (k) => new Set(todosDetalles.map((x) => x[k]).filter(Boolean)).size;

  // Filtros aplicados
  yPos += 3;
  doc.setFontSize(13);
  doc.text("Filtros aplicados", 14, yPos);
  yPos += 4;

  const tipoFechaLabel = params.tipoFecha === 'rotura' ? 'rotura' : 'confección';
  const filtrosLabels = ["Cliente", "Obra", "Planta", "Dosificación", "Tipo Hormigón", `Fecha ${tipoFechaLabel} desde`, `Fecha ${tipoFechaLabel} hasta`];
  const filtrosValues = [
    params.idCliente ? todosResumen[0]?.cliente ?? "—" : "Todos",
    params.idObra ? todosResumen[0]?.obra ?? "—" : "Todas",
    params.idPlanta ? todosResumen[0]?.planta ?? "—" : "Todas",
    params.idDosificacion ? (todosResumen[0]?.dosificacionNombre || todosResumen[0]?.idDosificacion || "—") : "Todas",
    params.idTipoHormigon ? todosResumen[0]?.tipoHormigon ?? "—" : "Todos",
    params.desde ? dayjs(params.desde).format("DD/MM/YYYY") : "—",
    params.hasta ? dayjs(params.hasta).format("DD/MM/YYYY") : "—",
  ];

  autoTable(doc, {
    startY: yPos,
    head: [filtrosLabels],
    body: [filtrosValues],
    styles: { fontSize: 9 },
    headStyles: { fillColor: [56, 111, 194] },
  });

  yPos = doc.lastAutoTable.finalY + 10;

  // Funciones helper
  function ensureSpace(need, yStart) {
    if (yStart + need > pageH - bottomMargin) {
      doc.addPage();
      const currentPage = doc.internal.getNumberOfPages();
      return currentPage > 1 ? 27 : 20;
    }
    return yStart;
  }

  function addNotaResumen(yStart) {
    const notas = [
      "(*) Criterio de cumplimiento basado en evaluación de los resultados por método analítico según normas IRAM 1666/2020.",
    ];
    if (showIram) {
      notas.push("IRAM 1546: requiere un mínimo de 3 muestras para evaluación estadística.");
    }
    if (showCirsocM1) {
      notas.push("CIRSOC M1: requiere un mínimo de 6 resultados consecutivos.");
    }
    if (showCirsocM2) {
      notas.push("CIRSOC M2: requiere un mínimo de 15 resultados consecutivos (verificación por método analítico).");
    }

    yStart = ensureSpace(10 + notas.length * 4, yStart);
    doc.setFontSize(8);

    const maxW = doc.internal.pageSize.getWidth() - 28;
    notas.forEach(texto => {
      const lines = doc.splitTextToSize(texto, maxW);
      lines.forEach(l => {
        doc.text(l, 14, yStart);
        yStart += 3.5;
      });
    });

    return yStart + 6;
  }

  function addResumen(etq, rawArr, sortedArr, yStart) {
    if (!rawArr || !rawArr.length) return yStart;

    yStart = ensureSpace(20, yStart);
    doc.setFontSize(13);
    doc.text(`Resumen estadístico a ${etq} días`, 14, yStart);
    yStart += 4;

    const rows = (sortedArr ?? rawArr).map((r) =>
      resumenColumns.map((c) => {
        const val = r[c];
        if (["cumpleLote", "cumpleCirsocM1", "cumpleCirsocM2"].includes(c)) {
          if (val === true) return "Sí (*)";
          if (val === false) return "No (*)";
          return "Muestras insuficientes";
        }
        if (c === "resistencia_diseno") return `${val} MPa`;
        return val;
      })
    );

    const head = resumenColumns.map(c => columnHeaders[c]);

    autoTable(doc, {
      startY: yStart,
      head: [head],
      body: rows,
      theme: "grid",
      styles: { fontSize: 9, cellPadding: 2 },
      headStyles: { fillColor: [56, 111, 194] },
      didParseCell: ({ section, column, row, cell }) => {
        if (section !== "body") return;
        const colKey = resumenColumns[column.index];
        if (["cumpleLote", "cumpleCirsocM1", "cumpleCirsocM2"].includes(colKey)) {
          const v = row.raw[column.index];
          if (v === "Sí (*)") {
            cell.styles.textColor = [0, 128, 0];
            cell.styles.fontStyle = "bold";
          } else if (v === "No (*)") {
            cell.styles.textColor = [208, 0, 0];
            cell.styles.fontStyle = "bold";
          }
        }
      },
    });

    return doc.lastAutoTable.finalY + 10;
  }

  function addResumenHermanas(yStart) {
    if (!showHermanas || edadesHermanas.length === 0) return yStart;

    const rows = [];
    for (const ed of edadesHermanas) {
      const arr = hermanasData[ed] || [];
      for (const resumen of arr) {
        rows.push([
          `Muestras ${resumen.tipoHormigon} a ${ed} días`,
          `${resumen.resistencia_media} MPa`,
          resumen.tamanoLote,
        ]);
      }
    }

    if (!rows.length) return yStart;

    yStart = ensureSpace(20, yStart);
    doc.setFontSize(13);
    doc.text("Resumen de muestras hermanas", 14, yStart);
    yStart += 4;

    autoTable(doc, {
      startY: yStart,
      head: [["Detalle", "Resistencia media", "Tamaño de lote"]],
      body: rows,
      theme: "grid",
      styles: { fontSize: 9 },
      headStyles: { fillColor: [56, 111, 194] },
    });

    return doc.lastAutoTable.finalY + 10;
  }

  function addDetalle(arrRes, etq, yStart) {
    if (!arrRes || !arrRes.length) return yStart;

    for (const resumen of arrRes) {
      const dets = resumen.probetas ?? resumen.detalles ?? [];
      if (!dets.length) continue;

      const showMM = showResumenEstadistico && criteriosCumplimiento && dets.some(d => d.mmPromedio != null);

      const cols = [
        "ID",
        "Remito",
        "Fecha confección",
        "Fecha rotura",
        "Edad",
        "Resistencia",
      ];
      if (showMM) cols.push("Media Móvil");

      const multi = (k, f) => f && uniqCount(k) > 1;
      const mCli = multi("cliente", showCliente);
      const mPla = multi("planta", showPlanta);
      const mObr = multi("obra", showObra);
      const mDos = multi("dosificacion", showDosificacion);

      if (mCli) cols.push("Cliente");
      if (mPla) cols.push("Planta");
      if (mObr) cols.push("Obra");
      if (mDos) cols.push("Dosificación");
      cols.push("Operador");

      const body = [];
      const mmOkFlags = [];

      dets.forEach(m => {
        const edadDisplay = (m.fechaConfeccion && m.fechaRotura)
          ? Math.round((new Date(m.fechaRotura) - new Date(m.fechaConfeccion)) / msDia)
          : m.edadEnsayo;
        const row = [
          m.idMuestra,
          m.remito ? m.remito : "—",
          m.fechaConfeccion ? dayjs(m.fechaConfeccion).format("DD/MM/YYYY") : "—",
          m.fechaRotura ? dayjs(m.fechaRotura).format("DD/MM/YYYY") : "—",
          `${edadDisplay} días`,
          `${m.resistenciaPromedio.toFixed(2)} MPa`,
        ];

        if (showMM) {
          row.push(m.mmPromedio != null ? m.mmPromedio.toFixed(2) : "—");
          mmOkFlags.push(m.mmOk);
        }
        if (mCli) row.push(m.cliente);
        if (mPla) row.push(m.planta);
        if (mObr) row.push(m.obra);
        if (mDos) row.push(m.dosificacion);
        row.push(m.operador ?? "—");

        body.push(row);
      });

      yStart = ensureSpace(20, yStart);
      doc.setFontSize(13);
      doc.text(`Detalle muestras ${resumen.tipoHormigon} a ${etq} días`, 14, yStart);
      yStart += 4;

      autoTable(doc, {
        startY: yStart,
        head: [cols],
        body,
        styles: { fontSize: 8, cellWidth: "wrap" },
        headStyles: { fillColor: [56, 111, 194] },
        didParseCell: ({ section, column, row, cell }) => {
          if (section !== "body" || !showMM) return;
          const mmIdx = cols.indexOf("Media Móvil");
          if (column.index !== mmIdx) return;
          const ok = mmOkFlags[row.index];
          if (ok === true) {
            cell.styles.textColor = [0, 128, 0];
            cell.styles.fontStyle = "bold";
          } else if (ok === false) {
            cell.styles.textColor = [200, 0, 0];
            cell.styles.fontStyle = "bold";
          }
        },
      });

      yStart = doc.lastAutoTable.finalY + 10;
    }

    return yStart;
  }

  function addDetalle10(detArray, yStart) {
    if (!detArray || !detArray.length) return yStart;

    const multi = (k, f) => f && uniqCount(k) > 1;
    const mCli = multi("cliente", showCliente);
    const mPla = multi("planta", showPlanta);
    const mObr = multi("obra", showObra);
    const mDos = multi("dosificacion", showDosificacion);

    yStart = ensureSpace(20, yStart);

    doc.setFontSize(13);
    doc.text("Muestras descartadas en estadística", 14, yStart);
    yStart += 4;

    // C-PDF-01 fix (auditoría 08, Bloque 2): la columna "Fecha" estaba
    // declarada en headers pero nunca se armaba un valor para ella en `row`,
    // y la columna "Fecha confección" la duplicaba conceptualmente. Resultado:
    // todas las columnas posteriores se desplazaban una posición. Eliminamos
    // la columna duplicada y dejamos los 6 headers que sí tienen 6 valores.
    const cols = [
      "ID",
      "Fecha confección",
      "Fecha rotura",
      "Edad",
      "Resistencia",
      "Remito"
    ];
    if (mCli) cols.push("Cliente");
    if (mPla) cols.push("Planta");
    if (mObr) cols.push("Obra");
    if (mDos) cols.push("Dosificación");
    cols.push("Operador");

    const body = detArray.map((m) => {
      const edadDisplay = (m.fechaConfeccion && m.fechaRotura)
        ? Math.round((new Date(m.fechaRotura) - new Date(m.fechaConfeccion)) / msDia)
        : m.edadEnsayo;
      const row = [
        m.idMuestra,
        m.fechaConfeccion ? dayjs(m.fechaConfeccion).format("DD/MM/YYYY") : "-",
        m.fechaRotura ? dayjs(m.fechaRotura).format("DD/MM/YYYY") : "-",
        `${edadDisplay} días`,
        `${m.resistenciaPromedio.toFixed(2)} MPa`,
        m.remito ? m.remito : '—'
      ];
      if (mCli) row.push(m.cliente);
      if (mPla) row.push(m.planta);
      if (mObr) row.push(m.obra);
      if (mDos) row.push(m.dosificacion);
      row.push(m.operador ?? "-");
      return row;
    });

    autoTable(doc, {
      startY: yStart,
      head: [cols],
      body,
      styles: { fontSize: 8, cellWidth: "wrap" },
      headStyles: { fillColor: [56, 111, 194] },
    });

    return doc.lastAutoTable.finalY + 10;
  }

  function addListadoProbetas(probetasArr, yStart) {
    if (!probetasArr || !probetasArr.length) return yStart;

    const body = probetasArr
      .map((p) => {
        const idMuestra = p.idMuestra ?? "—";
        const codigo = p.codigo ?? "—";
        const observaciones = p.observaciones ?? "—";
        const edadNum = Number(p.edad);
        const edadLabel = Number.isFinite(edadNum) ? `${edadNum} días` : "—";
        const resNum = Number(p.resistencia);
        const resLabel = Number.isFinite(resNum) ? `${resNum.toFixed(2)} MPa` : "—";

        return [idMuestra, codigo, observaciones, edadLabel, resLabel];
      })
      .filter((row) => row.some((v) => v !== "—"));

    if (!body.length) return yStart;

    yStart = ensureSpace(20, yStart);
    doc.setFontSize(13);
    doc.text("Listado de probetas", 14, yStart);
    yStart += 4;

    autoTable(doc, {
      startY: yStart,
      head: [["ID Muestra", "Código Probeta", "Observaciones", "Edad", "Resistencia (MPa)"]],
      body,
      styles: { fontSize: 8, cellWidth: "wrap" },
      headStyles: { fillColor: [56, 111, 194] },
    });

    return doc.lastAutoTable.finalY + 10;
  }

  // Instanciar canvas para gráficos
  const chartJSNodeCanvas = new ChartJSNodeCanvas({
    width: 640,
    height: 320,
    backgroundColour: 'white'
  });

  // Gráfico de barras comparativo (entre filtros y resumen)
  if (showGraficoComparativo) {
    const barTipos = todosResumen.filter(r => r.tamanoLote > 0);
    if (barTipos.length > 0) {
      const barConfig = {
        type: 'bar',
        data: {
          labels: barTipos.map(r => r.tipoHormigon),
          datasets: [
            {
              label: 'Resist. Característica (MPa)',
              data: barTipos.map(r => Number(r.caracteristica) || 0),
              backgroundColor: 'rgba(59, 89, 152, 0.75)',
              borderColor: 'rgba(59, 89, 152, 1)',
              borderWidth: 1,
              borderRadius: 4,
            },
            {
              label: 'Resist. Media (MPa)',
              data: barTipos.map(r => Number(r.resistencia_media) || 0),
              backgroundColor: 'rgba(46, 204, 113, 0.75)',
              borderColor: 'rgba(46, 204, 113, 1)',
              borderWidth: 1,
              borderRadius: 4,
            },
            {
              label: 'Resist. Objetivo (MPa)',
              data: barTipos.map(r => Number(r.resistencia_diseno) || 0),
              backgroundColor: 'rgba(241, 196, 15, 0.75)',
              borderColor: 'rgba(241, 196, 15, 1)',
              borderWidth: 1,
              borderRadius: 4,
            },
          ],
        },
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: {
              labels: { color: '#161616', font: { size: 10 } },
            },
          },
          scales: {
            x: {
              ticks: { color: '#000', font: { size: 10 } },
              grid: { color: '#ddd' },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Resistencia (MPa)', color: '#000' },
              ticks: { color: '#000' },
              grid: { color: '#bbb' },
            },
          },
        },
      };

      const barBuffer = await chartJSNodeCanvas.renderToBuffer(barConfig);
      const barImg = `data:image/png;base64,${barBuffer.toString('base64')}`;

      const barNeedH = 80;
      if (yPos + barNeedH > pageH - bottomMargin) {
        doc.addPage();
        const cp = doc.internal.getNumberOfPages();
        yPos = cp > 1 ? 27 : 20;
      }

      doc.setFontSize(13);
      doc.text('Comparativa de resistencias por tipo de hormigón', 14, yPos);
      yPos += 4;
      doc.addImage(barImg, 'PNG', 14, yPos, 170, 70);
      yPos += 80;
    }
  }

  // Gráfico de evolución temporal
  if (showGraficoEvolucion) {
    // Collect all detalles across tipos with fecha and resistencia
    const allPoints = [];
    for (const r of todosResumen) {
      if (!r.detalles?.length) continue;
      for (const d of r.detalles) {
        if (d.resistenciaPromedio != null && d.fecha) {
          allPoints.push({ tipo: r.tipoHormigon, fecha: d.fecha, resistencia: d.resistenciaPromedio });
        }
      }
    }

    if (allPoints.length >= 3) {
      const tiposEvol = [...new Set(allPoints.map(p => p.tipo))];
      const colores = ['#3b5998', '#2ecc71', '#e74c3c', '#f1c40f', '#9b59b6', '#1abc9c', '#e67e22'];

      // Build unique sorted date labels across all tipos
      const allDates = [...new Set(allPoints.map(p => new Date(p.fecha).toISOString().split('T')[0]))].sort();
      const formatLabel = (iso) => { const [y, m, d] = iso.split('-'); return `${d}/${m}/${y.slice(2)}`; };
      const labels = allDates.map(formatLabel);

      const datasets = tiposEvol.map((tipo, i) => {
        const puntosByDate = {};
        allPoints
          .filter(p => p.tipo === tipo)
          .forEach(p => { puntosByDate[new Date(p.fecha).toISOString().split('T')[0]] = p.resistencia; });
        return {
          label: tipo,
          data: allDates.map(d => puntosByDate[d] ?? null),
          borderColor: colores[i % colores.length],
          backgroundColor: colores[i % colores.length],
          fill: false,
          tension: 0.3,
          pointRadius: 3,
          spanGaps: true,
        };
      });

      const evolConfig = {
        type: 'line',
        data: { labels, datasets },
        options: {
          responsive: false,
          animation: false,
          plugins: {
            legend: { labels: { color: '#161616', font: { size: 10 } } },
          },
          scales: {
            x: {
              title: { display: true, text: 'Fecha de confección', color: '#000' },
              ticks: { color: '#000', font: { size: 9 }, maxRotation: 45 },
              grid: { color: '#ddd' },
            },
            y: {
              beginAtZero: true,
              title: { display: true, text: 'Resistencia (MPa)', color: '#000' },
              ticks: { color: '#000' },
              grid: { color: '#bbb' },
            },
          },
        },
      };

      try {
        const evolBuffer = await chartJSNodeCanvas.renderToBuffer(evolConfig);
        const evolImg = `data:image/png;base64,${evolBuffer.toString('base64')}`;

        const evolNeedH = 80;
        if (yPos + evolNeedH > pageH - bottomMargin) {
          doc.addPage();
          const cp = doc.internal.getNumberOfPages();
          yPos = cp > 1 ? 27 : 20;
        }

        doc.setFontSize(13);
        doc.text('Evolución temporal de resistencias', 14, yPos);
        yPos += 4;
        doc.addImage(evolImg, 'PNG', 14, yPos, 170, 70);
        yPos += 80;
      } catch (err) {
        console.error('Error renderizando gráfico de evolución temporal:', err);
      }
    }
  }

  // Generar resúmenes
  if (showResumenEstadistico) {
    yPos = addResumen(edadDiseno, mainData, mainData, yPos);
    if (criteriosCumplimiento) {
      yPos = addNotaResumen(yPos - 5);
    }
    if (showHermanas) {
      yPos = addResumenHermanas(yPos);
    }
  }

  // Generar detalles
  if (showSabana) {
    yPos = addDetalle(mainData, edadDiseno, yPos + 3);
    if (showHermanas) {
      const edades = Object.keys(hermanasData).sort((a, b) => parseInt(a) - parseInt(b));
      for (const ed of edades) {
        const arr = hermanasData[ed];
        yPos = addDetalle(arr, ed, yPos);
      }
    }
    if (data10porciento) {
      const descartadas = todosResumen.flatMap(
        (d) => d.muestreosDescartados ?? []
      );
      if (descartadas.length) yPos = addDetalle10(descartadas, yPos);
    }
  }

  // Generar gráficos scatter
  const tipos = [...new Set(todosResumen.map((r) => r.tipoHormigon))];

  for (const tipo of tipos) {
    const resumenTipo = todosResumen.find((r) => r.tipoHormigon === tipo);
    if (!resumenTipo) continue;

    if (!resumenTipo.tamanoLote || resumenTipo.tamanoLote === 0) continue;

    const puntos = (resumenTipo.detalles ?? [])
      .filter(d => Number.isFinite(d.resistenciaPromedio))
      .map((d, i) => ({ x: i + 1, y: d.resistenciaPromedio }));

    if (puntos.length < 3) continue;

    const xVals = puntos.map(p => p.x);
    const yVals = puntos.map(p => p.y);
    const xMin = Math.min(...xVals) - 1;
    const xMax = Math.max(...xVals) + 1;

    const media = Number(resumenTipo.resistencia_media);
    const caract = Number(resumenTipo.caracteristica);
    const obj = Number(resumenTipo.resistencia_diseno);

    const yMin = 0;
    // Auditoría visual smoke-pdf-visual: el "+10" daba ejes Y feos tipo 40,9.
    // Ahora aplicamos +5% y redondeamos al múltiplo de 5 superior para que
    // los ticks queden en valores redondos (35, 40, 50, 55, ...).
    const _yMaxRaw = Math.max(...yVals, media, caract, obj) * 1.05;
    const yMax = Math.ceil(_yMaxRaw / 5) * 5;

    const configuration = {
      type: 'scatter',
      data: {
        datasets: [
          {
            label: 'Ensayos individuales',
            data: puntos,
            showLine: false,
            borderWidth: 0,
            pointStyle: 'circle',
            pointRadius: 4,
            pointBorderWidth: 1.5,
            pointBackgroundColor: '#1a57ff',
            pointBorderColor: '#1a57ff',
          },
          {
            label: `Media: ${media.toFixed(1)} MPa`,
            data: [
              { x: xMin, y: media },
              { x: xMax, y: media },
            ],
            type: 'line',
            borderColor: '#008000',
            borderWidth: 2,
            fill: false,
          },
          {
            label: `Característica: ${caract.toFixed(1)} MPa`,
            data: [
              { x: xMin, y: caract },
              { x: xMax, y: caract },
            ],
            type: 'line',
            borderColor: '#d79a00',
            borderDash: [6, 4],
            borderWidth: 2,
            fill: false,
          },
          {
            label: `Solicitada: ${obj.toFixed(0)} MPa`,
            data: [
              { x: xMin, y: obj },
              { x: xMax, y: obj },
            ],
            type: 'line',
            borderColor: '#d40000',
            borderDash: [8, 4],
            borderWidth: 2,
            fill: false,
          },
        ],
      },
      options: {
        responsive: false,
        animation: false,
        plugins: {
          legend: {
            labels: { color: '#161616ff', font: { size: 10 } },
          },
          tooltip: {
            backgroundColor: '#fff',
            borderColor: '#888',
            borderWidth: 1,
            titleColor: '#000',
            bodyColor: '#000',
          },
        },
        scales: {
          x: {
            min: xMin,
            max: xMax,
            title: {
              display: true,
              text: 'Muestra N°',
              color: '#131313ff',
            },
            ticks: { color: '#000' },
            grid: { color: '#bbb' },
          },
          y: {
            min: yMin,
            max: yMax,
            title: {
              display: true,
              text: 'Resistencia (MPa)',
              color: '#000',
            },
            ticks: { color: '#000' },
            grid: { color: '#bbb' },
          },
        },
      },
    };

    const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
    const imgData = `data:image/png;base64,${imageBuffer.toString('base64')}`;

    const needH = 75;
    if (yPos + needH > pageH - bottomMargin) {
      doc.addPage();
      const currentPage = doc.internal.getNumberOfPages();
      yPos = currentPage > 1 ? 27 : 20;
    }

    doc.setFontSize(13);
    doc.text(`Dispersión de resistencias – ${tipo}`, 14, yPos);
    yPos += 4;
    doc.addImage(imgData, 'PNG', 14, yPos, 160, 70);
    yPos += 80;
  }

  // Listado de probetas
  if (showListadoProbetas) {
    yPos = addListadoProbetas(probetasData, yPos);
  }

  // Footer y firma
  const totalPages = doc.internal.getNumberOfPages();
  const pageW = doc.internal.pageSize.getWidth();

  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    // M-PDF-07 fix (auditoría 08, Bloque 9): antes el logo solo aparecía
    // en la página 1. En documentos largos las páginas siguientes quedaban
    // sin marca de la planta productora. Ahora se imprime en todas.
    if (logoData) {
      doc.addImage(logoData, 'PNG', pageW - 25, 10, 10, 10);
    }
    // M-PDF-08 fix (auditoría 08, Bloque 9): "Pagina" → "Página".
    const footer = `Página ${i}/${totalPages}`;
    doc.setFontSize(9);
    const txtW = doc.getTextWidth(footer);
    doc.text(footer, pageW - txtW - 10, pageH - 7);

    if (i === totalPages && empleadoFirma && firmaData) {
      const yFirma = pageH - bottomMargin + 2;
      const imgW = 30;
      const imgH = 8;
      doc.addImage(firmaData, 'PNG', (pageW - imgW) / 2, yFirma, imgW, imgH);
      const yNombre = yFirma + imgH + 5;
      const nombre = `${empleadoFirma.apellido}, ${empleadoFirma.nombre}`;
      doc.text(nombre, pageW / 2, yNombre, { align: 'center' });
      const yEmpresa = yNombre + 2;
      if (configEmpresa?.nombreEmpresa) {
        doc.setFontSize(8);
        const disclaimer = `${configEmpresa.nombreEmpresa} no se responsabiliza por el mal uso o interpretación del presente informe.`;
        const lines = doc.splitTextToSize(disclaimer, pageW - 40);
        doc.text(lines, pageW / 2, yEmpresa + 3, { align: 'center' });
        doc.setFontSize(9);
      }
    }
  }

  const pdfArrayBuffer = doc.output('arraybuffer');
  const pdfBuffer = Buffer.from(pdfArrayBuffer);
  const reportFileName = fileName || `Reporte Resistencias ${dayjs().format('DD-MM-YYYY HH:mm')}.pdf`;

  const { url } = await archivoService.uploadToS3Only({
    originalname: reportFileName,
    buffer: pdfBuffer,
    mimetype: 'application/pdf',
    size: pdfBuffer.length,
  }, { prefix: 'reportes-resistencia' });

  if (!idEmpleado) {
    throw new Error('idEmpleado es requerido para registrar el reporte');
  }

  const transaction = await db.sequelize.transaction();
  try {
    const reporte = await db.ReporteResistencia.create({
      link: url,
      fechaDesde: params?.desde ? new Date(params.desde) : null,
      fechaHasta: params?.hasta ? new Date(params.hasta) : null,
      oficial: esOficial,
      idEmpleado,
    }, { transaction });

    if (esOficial) {
      const probetaIds = [...new Set((probetaIdsReporte || []).filter(Boolean))];
      if (probetaIds.length) {
        await db.ReporteResistenciaProbeta.bulkCreate(
          probetaIds.map((idProbeta) => ({
            idReporteResistencia: reporte.idReporteResistencia,
            idProbeta,
          })),
          { transaction },
        );
      }
    }

    await transaction.commit();
  } catch (error) {
    await transaction.rollback();
    throw error;
  }

  return pdfArrayBuffer;
};


/* ═══════════════════════════════════════════════════════════
   REVISIÓN DE ENSAYOS
   ═══════════════════════════════════════════════════════════ */

const getEnsayosPendientesRevision = async (db) => {
  const ensayos = await db.EnsayoResistencia.findAll({
    where: { pendienteRevision: true },
    order: [['fechaEnsayo', 'DESC']],
    include: [
      {
        model: db.Probeta,
        as: 'probeta',
        attributes: ['idProbeta', 'nombre', 'codigo', 'diasRotura', 'idMuestra', 'idMuestraTerceros', 'observaciones'],
        include: [
          { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['estado'] },
          {
            model: db.Muestra,
            as: 'muestra',
            required: false,
            attributes: ['idMuestra'],
            include: [{
              model: db.Despacho,
              as: 'despacho',
              attributes: ['idDespacho', 'fecha', 'remito', 'idPlanta'],
              include: [
                { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
                { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
                { model: db.Obra, as: 'obra', attributes: ['nombre'] },
                {
                  model: db.Dosificacion,
                  as: 'dosificacion',
                  attributes: ['idDosificacion', 'nombre'],
                  include: [
                    { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon', 'fcMpa'] },
                    { model: db.EdadDisenio, as: 'edadDisenio', attributes: ['dias'] },
                  ],
                },
              ],
            }],
          },
          {
            model: db.MuestraTerceros,
            as: 'muestraTerceros',
            required: false,
            attributes: ['idMuestraTerceros', 'fecha', 'remito'],
            include: [
              { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
              { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
              { model: db.Obra, as: 'obra', attributes: ['nombre'] },
              { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon', 'fcMpa'] },
            ],
          },
        ],
      },
      { model: db.Empleado, as: 'operarioEnsayo', attributes: ['idEmpleado', 'nombre', 'apellido'] },
      { model: db.Prensa, as: 'prensa', attributes: ['idPrensa', 'nombre'] },
    ],
  });
  return ensayos;
};

const getEnsayoRevisionDetalle = async (db, idEnsayoResistencia) => {
  const ensayo = await db.EnsayoResistencia.findByPk(idEnsayoResistencia, {
    include: [
      {
        model: db.Probeta,
        as: 'probeta',
        include: [
          { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['estado'] },
          { model: db.UnidadMedidaPrensa, as: 'unidadMedida' },
          {
            model: db.Muestra,
            as: 'muestra',
            required: false,
            include: [{
              model: db.Despacho,
              as: 'despacho',
              include: [
                { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
                { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
                { model: db.Obra, as: 'obra', attributes: ['nombre'] },
                {
                  model: db.Dosificacion,
                  as: 'dosificacion',
                  include: [
                    { model: db.TipoHormigon, as: 'tipoHormigon' },
                    { model: db.EdadDisenio, as: 'edadDisenio', attributes: ['dias'] },
                  ],
                },
              ],
            }],
          },
          {
            model: db.MuestraTerceros,
            as: 'muestraTerceros',
            required: false,
            include: [
              { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
              { model: db.Cliente, as: 'cliente', attributes: ['tipoPersona', 'nombre', 'razonSocial'] },
              { model: db.Obra, as: 'obra', attributes: ['nombre'] },
              { model: db.TipoHormigon, as: 'tipoHormigon' },
            ],
          },
        ],
      },
      { model: db.Empleado, as: 'operarioEnsayo', attributes: ['idEmpleado', 'nombre', 'apellido'] },
      { model: db.Prensa, as: 'prensa', attributes: ['idPrensa', 'nombre', 'marca', 'modelo'] },
      // Fase 2 Laboratorio (2026-05-12): snapshot del lab donde se ejecutó el
      // ensayo. Si es legacy o el equipo no tenía lab asignado al momento del
      // create, queda null y la UI muestra '—'.
      ...(db.Laboratorio ? [{ model: db.Laboratorio, as: 'laboratorio', attributes: ['idLaboratorio', 'nombre'], required: false }] : []),
    ],
  });
  if (!ensayo) throw new Error('Ensayo no encontrado');

  // Buscar hermanas: otras probetas de la misma muestra que ya tengan ensayo
  const probeta = ensayo.probeta;
  let hermanas = [];
  if (probeta.idMuestra) {
    hermanas = await db.Probeta.findAll({
      where: {
        idMuestra: probeta.idMuestra,
        idProbeta: { [Op.ne]: probeta.idProbeta },
      },
      include: [
        { model: db.EnsayoResistencia, as: 'ensayo', required: false },
        { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['estado'] },
      ],
    });
  } else if (probeta.idMuestraTerceros) {
    hermanas = await db.Probeta.findAll({
      where: {
        idMuestraTerceros: probeta.idMuestraTerceros,
        idProbeta: { [Op.ne]: probeta.idProbeta },
      },
      include: [
        { model: db.EnsayoResistencia, as: 'ensayo', required: false },
        { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['estado'] },
      ],
    });
  }

  return { ensayo, hermanas };
};

/**
 * Aprueba un ensayo pendiente de revisión.
 *
 * C-SEC-04 (auditoría 08, sesión 2026-05-08): si el revisor modifica
 * valores cargados por el operario al aprobar (ej. corrige peso,
 * altura, observaciones), debe declarar el motivo. Sin diff → motivo
 * opcional. Con diff → motivo obligatorio.
 *
 * Los campos auditados como "modificables al aprobar" son los que
 * cualquier revisor podría rectificar: peso, altura, diametro,
 * lecturaPrensa, observaciones, tipoRotura, fechaEnsayo, horaEnsayo,
 * idOperarioEnsayo.
 *
 * Sprint 4 (sesión 2026-05-10) — Hallazgo M5: agregar idPrensa,
 * cargaAplicada y factorCorreccionHD. Si el revisor cambia la prensa
 * al aprobar, eso afecta la calibración aplicada y por tanto la
 * resistencia derivada — debe quedar auditado con motivo. Igual
 * para cargaAplicada (la lectura cruda) y factorCorreccionHD
 * (IRAM 1546:2013 §10.4 — afecta directamente el cálculo de Q).
 */
const CAMPOS_AUDITADOS_APROBACION = [
  'peso', 'altura', 'diametro', 'lecturaPrensa',
  'observaciones', 'tipoRotura',
  'fechaEnsayo', 'horaEnsayo', 'idOperarioEnsayo',
  // Sprint 4 — M5
  'idPrensa', 'cargaAplicada', 'factorCorreccionHD',
];

function detectarDiffAprobacion(ensayoOriginal, datosActualizados) {
  const diffs = [];
  for (const campo of CAMPOS_AUDITADOS_APROBACION) {
    if (!Object.prototype.hasOwnProperty.call(datosActualizados, campo)) continue;
    const original = ensayoOriginal[campo];
    const propuesto = datosActualizados[campo];
    // Coerción suave: comparar como string para evitar 23 vs "23".
    if (String(original ?? '') !== String(propuesto ?? '')) {
      diffs.push({ campo, original, propuesto });
    }
  }
  return diffs;
}

const aprobarEnsayo = async (db, idEnsayoResistencia, datosActualizados, idEmpleado, motivoAjuste = null) => {
  const ensayo = await db.EnsayoResistencia.findByPk(idEnsayoResistencia);
  if (!ensayo) throw new Error('Ensayo no encontrado');
  if (!ensayo.pendienteRevision) throw new Error('El ensayo ya fue aprobado');

  // C-SEC-04: si hay diff, exigir motivo.
  const diffs = detectarDiffAprobacion(ensayo, datosActualizados);
  if (diffs.length > 0 && (!motivoAjuste || String(motivoAjuste).trim().length < 5)) {
    const camposCambiados = diffs.map((d) => d.campo).join(', ');
    throw Object.assign(
      new Error(`Aprobar el ensayo modifica ${diffs.length} campo(s) (${camposCambiados}). Se requiere un motivo de ajuste de al menos 5 caracteres.`),
      { status: 400, diffs }
    );
  }

  // Si cambia la fecha recalcular edad
  if (datosActualizados.fechaEnsayo) {
    datosActualizados.edadEnsayo = await calcEdadEnsayo(
      db,
      ensayo.idProbeta,
      datosActualizados.fechaEnsayo,
      datosActualizados.horaEnsayo ?? ensayo.horaEnsayo
    );
  }

  // Sprint 4 (sesión 2026-05-10) — pasamos `motivoAjuste` por options
  // para que el hook beforeUpdate lo persista en EnsayoResistenciaHistory.
  // Si no hay motivo (caso "aprobar sin cambios"), queda null en History.
  await ensayo.update(
    {
      ...datosActualizados,
      pendienteRevision: false,
      idAprobadoPor: idEmpleado,
      fechaAprobacion: new Date(),
    },
    {
      motivoAjuste: diffs.length > 0 ? String(motivoAjuste).trim() : null,
    }
  );

  // Log estructurado del motivo de ajuste (queda en el History via hooks).
  if (diffs.length > 0) {
    console.log(JSON.stringify({
      event: 'ensayoResistencia.aprobacion.conDiff',
      idEnsayoResistencia,
      idAprobador: idEmpleado,
      diffs,
      motivoAjuste,
      fecha: new Date().toISOString(),
    }));
  }

  // Invalidar cache de resistencias
  const tc = getCacheForDb(db);
  tc.del('probetas');

  return ensayo;
};

/**
 * Aprueba en lote ensayos pendientes de revisión.
 *
 * Bloque 1 auditoría 08 — restricción de planta:
 *   - Si `plantaIdsUsuario === null` → admin/sin restricción (compatibilidad).
 *   - Si es array vacío → el usuario no tiene plantas asignadas, no aprueba nada.
 *   - Si es array con valores → solo aprueba ensayos cuyo origen (Muestra propia
 *     o MuestraTerceros) pertenece a alguna de esas plantas. Los ensayos que
 *     pasan por el body pero no cumplen el filtro se ignoran (no error, se
 *     reportan en `ignoradosPorPlanta`). Esto evita que un Responsable de
 *     planta A apruebe ensayos de planta B vía el endpoint /aprobar-masivo.
 */
/**
 * Mej-16 (auditoría 08): anular una probeta con motivo. La probeta pasa
 * a estado DESCARTADA y se registra el motivo + idEmpleado + fecha.
 *
 * Reglas:
 *  - Probeta con ensayo APROBADO → rechazar (debe desaprobarse antes).
 *  - Probeta ya en estado terminal (DESCARTADA, PERDIDA) → no-op informativo.
 *  - Motivo obligatorio (mín 5 chars).
 */
const anularProbeta = async (db, idProbeta, motivo, idEmpleado) => {
  if (!motivo || String(motivo).trim().length < 5) {
    throw Object.assign(
      new Error('Se requiere un motivo de anulación de al menos 5 caracteres.'),
      { status: 400 }
    );
  }
  const probeta = await db.Probeta.findByPk(idProbeta, {
    include: [{ model: db.EnsayoResistencia, as: 'ensayo', required: false }],
  });
  if (!probeta) throw Object.assign(new Error('Probeta no encontrada'), { status: 404 });

  if (ESTADOS_NO_ENSAYABLES.includes(probeta.idEstadoProbeta)) {
    return { idProbeta, yaAnulada: true, mensaje: 'La probeta ya está en estado terminal.' };
  }

  const ensayo = probeta.ensayo;
  if (ensayo && ensayo.pendienteRevision === false && ensayo.idAprobadoPor != null) {
    throw Object.assign(
      new Error('La probeta tiene un ensayo aprobado. Desaprobar el ensayo primero (Mej-17) antes de anular la probeta.'),
      { status: 422 }
    );
  }

  await probeta.update({
    idEstadoProbeta: ESTADO_PROBETA.DESCARTADA,
    motivoAnulacion: String(motivo).trim(),
    idAnuladoPor: idEmpleado,
    fechaAnulacion: new Date(),
  });

  // Log estructurado para auditoría.
  console.log(JSON.stringify({
    event: 'probeta.anulada',
    idProbeta,
    idAnuladoPor: idEmpleado,
    motivo: String(motivo).trim(),
    fecha: new Date().toISOString(),
  }));

  const tc = getCacheForDb(db);
  tc.del('probetas');
  return { idProbeta, anulada: true, motivo: String(motivo).trim() };
};

/**
 * N-01 etiqueta QR (sesión 2026-05-09): marca un set de probetas como
 * "etiqueta impresa" tras una descarga exitosa del PDF de etiquetas.
 *
 * Idempotente: re-imprimir actualiza el timestamp y el empleado, no falla.
 *
 * @param {object} db
 * @param {Array<number>} idsProbeta  IDs de las probetas para las que se
 *   acaba de imprimir la etiqueta.
 * @param {number|null} idEmpleado    Empleado que disparó la impresión.
 * @returns {Promise<{actualizadas: number, ids: Array<number>}>}
 */
const marcarEtiquetasImpresas = async (db, idsProbeta, idEmpleado) => {
  const ids = (Array.isArray(idsProbeta) ? idsProbeta : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    throw Object.assign(
      new Error('Se requiere al menos un idProbeta válido.'),
      { status: 400 }
    );
  }
  const now = new Date();
  const [actualizadas] = await db.Probeta.update(
    { etiquetaImpresaAt: now, idEtiquetaImpresaPor: idEmpleado ?? null },
    { where: { idProbeta: ids } }
  );
  const tc = getCacheForDb(db);
  tc.del('probetas');
  return { actualizadas, ids };
};

/**
 * N-01 etiqueta QR: lista probetas cuyas etiquetas todavía NO se han
 * impreso (`etiquetaImpresaAt IS NULL`). Filtra por estados ensayables
 * (CURANDO + PENDIENTE) — no tiene sentido reimprimir etiquetas para
 * probetas DESCARTADAS / ENSAYADAS / PERDIDAS.
 *
 * Soporta filtro opcional por planta y rango de fechas de moldeo.
 */
const getEtiquetasPendientes = async (db, { idPlanta = null, desde = null, hasta = null } = {}) => {
  const { Op } = db.Sequelize;
  const muestraWhere = {};
  if (idPlanta) muestraWhere.idPlanta = Number(idPlanta);
  if (desde || hasta) {
    muestraWhere.fecha = {};
    if (desde) muestraWhere.fecha[Op.gte] = desde;
    if (hasta) muestraWhere.fecha[Op.lte] = hasta;
  }

  const probetas = await db.Probeta.findAll({
    where: {
      etiquetaImpresaAt: null,
      idEstadoProbeta: { [Op.in]: [ESTADO_PROBETA.CURANDO, ESTADO_PROBETA.PENDIENTE] },
    },
    include: [
      {
        model: db.Muestra,
        as: 'muestra',
        required: !!Object.keys(muestraWhere).length,
        where: Object.keys(muestraWhere).length ? muestraWhere : undefined,
        attributes: ['idMuestra', 'fecha', 'remito'],
        include: [
          { model: db.Cliente, as: 'cliente', attributes: ['idCliente', 'tipoPersona', 'nombre', 'razonSocial'] },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['idTipoHormigon', 'tipoHormigon', 'fcMpa'] },
        ],
      },
      { model: db.EstadoProbeta, as: 'estadoProbeta', attributes: ['idEstadoProbeta', 'estadoProbeta'] },
    ],
    order: [
      [{ model: db.Muestra, as: 'muestra' }, 'fecha', 'DESC'],
      ['idProbeta', 'ASC'],
    ],
    limit: 500,
  });

  return probetas;
};

/**
 * N-01 etiqueta QR (sesión 2026-05-28): trae todas las probetas activas
 * (CURANDO + PENDIENTE) de un conjunto de muestras, listas para imprimir
 * sus etiquetas QR desde la pantalla de Muestras (multi-select).
 *
 * A diferencia de `getEtiquetasPendientes`, NO filtra por `etiquetaImpresaAt`
 * — el operador puede querer reimprimir intencionalmente.
 *
 * Limita a 200 ids de muestra como guard contra payloads erróneos.
 *
 * El parámetro `origen` decide contra qué FK joinear:
 *   - 'propia'  → Probeta.idMuestra IN (...)              (default)
 *   - 'tercero' → Probeta.idMuestraTerceros IN (...)
 *
 * @param {object} db
 * @param {Array<number>} idsMuestra
 * @param {object} [opts]
 * @param {'propia'|'tercero'} [opts.origen='propia']
 */
const getProbetasParaEtiquetasPorMuestras = async (db, idsMuestra, opts = {}) => {
  const { origen = 'propia' } = opts;
  if (origen !== 'propia' && origen !== 'tercero') {
    throw Object.assign(
      new Error(`Origen inválido: '${origen}'. Debe ser 'propia' o 'tercero'.`),
      { status: 400 }
    );
  }
  const ids = (Array.isArray(idsMuestra) ? idsMuestra : [])
    .map((x) => Number(x))
    .filter((n) => Number.isInteger(n) && n > 0);
  if (ids.length === 0) {
    throw Object.assign(
      new Error('Se requiere al menos un idMuestra válido.'),
      { status: 400 }
    );
  }
  if (ids.length > 200) {
    throw Object.assign(
      new Error('Demasiadas muestras seleccionadas (máximo 200).'),
      { status: 400 }
    );
  }
  const { Op } = db.Sequelize;
  const fkCol = origen === 'tercero' ? 'idMuestraTerceros' : 'idMuestra';
  // No restringimos `attributes` en los includes: tablas chicas (catálogo +
  // headers de muestra). Restringir invita a romper por errores de typo en
  // nombres de columna (p.ej. EstadoProbeta.estado vs estadoProbeta) y los
  // FKs que necesitan los nested-includes deben estar igual sí o sí.
  const muestraInclude = origen === 'tercero'
    ? {
        model: db.MuestraTerceros,
        as: 'muestraTerceros',
        include: [
          { model: db.Cliente, as: 'cliente' },
          { model: db.Obra, as: 'obra' },
          { model: db.Planta, as: 'planta' },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
        ],
      }
    : {
        model: db.Muestra,
        as: 'muestra',
        include: [
          { model: db.Cliente, as: 'cliente' },
          { model: db.Obra, as: 'obra' },
          { model: db.Planta, as: 'planta' },
          { model: db.TipoHormigon, as: 'tipoHormigon' },
        ],
      };
  const includes = [
    muestraInclude,
    { model: db.EstadoProbeta, as: 'estadoProbeta' },
  ];

  const probetas = await db.Probeta.findAll({
    where: {
      [fkCol]: { [Op.in]: ids },
      idEstadoProbeta: { [Op.in]: [ESTADO_PROBETA.CURANDO, ESTADO_PROBETA.PENDIENTE] },
    },
    include: includes,
    order: [['idProbeta', 'ASC']],
  });
  return probetas;
};

/**
 * Mej-17 (auditoría 08): desaprobar un ensayo previamente aprobado para
 * permitir re-cargar valores corregidos. Vuelve `pendienteRevision = true`
 * y registra el motivo + idEmpleado + fecha.
 */
const desaprobarEnsayo = async (db, idEnsayoResistencia, motivo, idEmpleado, opts = {}) => {
  if (!motivo || String(motivo).trim().length < 5) {
    throw Object.assign(
      new Error('Se requiere un motivo de desaprobación de al menos 5 caracteres.'),
      { status: 400 }
    );
  }
  const ensayo = await db.EnsayoResistencia.findByPk(idEnsayoResistencia);
  if (!ensayo) throw Object.assign(new Error('Ensayo no encontrado'), { status: 404 });

  if (ensayo.pendienteRevision === true) {
    throw Object.assign(
      new Error('El ensayo no está aprobado: nada que desaprobar.'),
      { status: 422 }
    );
  }

  // Sprint 2 — gate combinado: DT (siempre) o RC firmante original.
  // Si `user` no viene en opts, se omite el chequeo (compatibilidad con
  // callers internos legacy que ya validaron autoridad upstream).
  if (opts.user) {
    const { puedeDesaprobarEnsayo } = require('../domain/roles/calidadGates');
    const r = puedeDesaprobarEnsayo(opts.user, {
      idMenu: null,                                  // gate de rol puro
      idAprobadoPorOriginal: ensayo.idAprobadoPor,
    });
    if (!r.allowed) {
      const err = new Error(
        'Para desaprobar este ensayo se requiere rol DIRECTOR_TECNICO ' +
        '(o ser el Responsable de Calidad que firmó originalmente).'
      );
      err.status = 403;
      err.motivo = r.motivo;
      throw err;
    }
  }

  await ensayo.update({
    pendienteRevision: true,
    motivoDesaprobacion: String(motivo).trim(),
    idDesaprobadoPor: idEmpleado,
    fechaDesaprobacion: new Date(),
    // Mantenemos idAprobadoPor / fechaAprobacion como histórico de quién
    // había aprobado antes (no se borra para auditoría).
  });

  console.log(JSON.stringify({
    event: 'ensayoResistencia.desaprobado',
    idEnsayoResistencia,
    idDesaprobadoPor: idEmpleado,
    idAprobadoPorOriginal: ensayo.idAprobadoPor,     // para auditoría
    motivo: String(motivo).trim(),
    fecha: new Date().toISOString(),
  }));

  const tc = getCacheForDb(db);
  tc.del('probetas');
  return { idEnsayoResistencia, desaprobado: true };
};

/**
 * Sprint 2 (sesión 2026-05-10) — aprobación masiva con safeguard server-side.
 *
 * Reglas:
 *   1. Filtro por plantas del usuario (existente).
 *   2. NUEVO: clasificar cada ensayo por veredicto de edad (verde/naranja/
 *      rojo/indeterminado) usando `clasificarColorEnsayoPorEdad`.
 *   3. Si hay ensayos con desvíos (naranja/rojo/indeterminado), exigir que
 *      el `user` pueda APROBAR_ENSAYO_MASIVO_CON_DESVIOS (rol mínimo DT).
 *   4. Si tiene permiso para desvíos, exigir `motivoAprobacionMasiva`.
 *
 * El RC con permiso solo de APROBAR_ENSAYO_MASIVO solo puede aprobar
 * verdes; si el lote tiene un rojo, el endpoint rechaza con 403 y
 * detalle de los ids con desvío.
 */
const aprobarEnsayosMasivo = async (db, ids, idEmpleado, plantaIdsUsuario = null, opts = {}) => {
  if (!Array.isArray(ids) || ids.length === 0) throw new Error('No se enviaron IDs');
  const { user, motivoAprobacionMasiva } = opts;
  const { puedeAccionCalidad, ACCIONES } = require('../domain/roles/calidadGates');
  const { segregarPorVeredicto } = require('../domain/ensayos/clasificadorVeredictoEdad');

  // Filtro de planta — solo se aplica si plantaIdsUsuario es array (admin pasa null).
  let idsAFiltrar = ids;
  let ignoradosPorPlanta = 0;
  if (Array.isArray(plantaIdsUsuario)) {
    if (plantaIdsUsuario.length === 0) {
      // Sin plantas asignadas → no aprueba nada.
      return { aprobados: 0, ignoradosPorPlanta: ids.length };
    }
    const plantaSet = new Set(plantaIdsUsuario.map(Number));
    const detalle = await db.EnsayoResistencia.findAll({
      attributes: ['idEnsayoResistencia'],
      where: { idEnsayoResistencia: ids },
      include: [{
        model: db.Probeta, as: 'probeta',
        attributes: ['idProbeta'],
        required: true,
        include: [
          { model: db.Muestra,         as: 'muestra',         attributes: ['idPlanta'], required: false },
          { model: db.MuestraTerceros, as: 'muestraTerceros', attributes: ['idPlanta'], required: false },
        ],
      }],
    });
    idsAFiltrar = detalle
      .filter((e) => {
        const idPlanta = e.probeta?.muestra?.idPlanta ?? e.probeta?.muestraTerceros?.idPlanta;
        return idPlanta != null && plantaSet.has(Number(idPlanta));
      })
      .map((e) => e.idEnsayoResistencia);
    ignoradosPorPlanta = ids.length - idsAFiltrar.length;
    if (idsAFiltrar.length === 0) {
      return { aprobados: 0, ignoradosPorPlanta };
    }
  }

  // Sprint 2 — clasificar veredicto por edad de los ensayos a aprobar
  // (para safeguard server-side). Trae los datos mínimos necesarios.
  const ensayosParaClasificar = await db.EnsayoResistencia.findAll({
    attributes: ['idEnsayoResistencia', 'resistencia', 'edadEnsayo'],
    where: { idEnsayoResistencia: idsAFiltrar },
    include: [{
      model: db.Probeta, as: 'probeta', attributes: ['idProbeta'], required: true,
      include: [
        {
          model: db.Muestra, as: 'muestra', attributes: ['idMuestra'], required: false,
          include: [{
            model: db.Despacho, as: 'despacho', attributes: ['idDespacho'], required: false,
            include: [{
              model: db.Dosificacion, as: 'dosificacion', attributes: ['idEdadDisenio'], required: false,
              include: [
                { model: db.EdadDisenio,  as: 'edadDisenio',  attributes: ['dias'], required: false },
                { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'], required: false },
              ],
            }],
          }],
        },
        {
          model: db.MuestraTerceros, as: 'muestraTerceros', attributes: ['idMuestraTerceros'], required: false,
          include: [
            { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'], required: false },
          ],
        },
      ],
    }],
  });
  const parseObjetivo = (tipoStr) => {
    if (!tipoStr) return null;
    const m = String(tipoStr).match(/\d+/);
    return m ? Number(m[0]) : null;
  };
  const datosClasificacion = ensayosParaClasificar.map((e) => {
    const tipoPropia = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
    const tipoTerc   = e.probeta?.muestraTerceros?.tipoHormigon?.tipoHormigon;
    const edadDiseno = e.probeta?.muestra?.despacho?.dosificacion?.edadDisenio?.dias ?? 28;
    return {
      idEnsayoResistencia: e.idEnsayoResistencia,
      resistencia: Number(e.resistencia),
      resistenciaObjetivo: parseObjetivo(tipoPropia || tipoTerc),
      edadEnsayo: Number(e.edadEnsayo),
      edadDiseno,
    };
  });
  const veredicto = segregarPorVeredicto(datosClasificacion);

  // Safeguard: si hay desvíos, exigir permiso DT + motivo.
  if (veredicto.tieneDesvios && user) {
    const checkDT = puedeAccionCalidad(user, ACCIONES.APROBAR_ENSAYO_MASIVO_CON_DESVIOS, { idMenu: null });
    if (!checkDT.allowed) {
      const err = new Error(
        'El lote incluye ensayos fuera del rango esperado para la edad (resultados naranjas / rojos / indeterminados). ' +
        'Para aprobarlos en masivo se requiere rol DIRECTOR_TECNICO.'
      );
      err.status = 403;
      err.motivo = 'aprobacion_masiva_con_desvios_sin_rol_dt';
      err.requierePermisoDesvios = true;
      err.desvios = {
        verdes: veredicto.verdes,
        naranjas: veredicto.naranjas,
        rojos: veredicto.rojos,
        indeterminados: veredicto.indeterminados,
      };
      throw err;
    }
    if (!motivoAprobacionMasiva || !String(motivoAprobacionMasiva).trim()) {
      const err = new Error(
        'Aprobar en masivo ensayos con desvíos requiere `motivoAprobacionMasiva` documentado.'
      );
      err.status = 400;
      err.motivo = 'motivo_aprobacion_masiva_faltante';
      err.desvios = {
        verdes: veredicto.verdes,
        naranjas: veredicto.naranjas,
        rojos: veredicto.rojos,
        indeterminados: veredicto.indeterminados,
      };
      throw err;
    }
  }

  const fechaAprobacion = new Date();
  const [updated] = await db.EnsayoResistencia.update(
    { pendienteRevision: false, idAprobadoPor: idEmpleado, fechaAprobacion },
    { where: { idEnsayoResistencia: idsAFiltrar, pendienteRevision: true } }
  );

  // Log estructurado de aprobación masiva (auditable).
  console.log(JSON.stringify({
    event: 'ensayoResistencia.aprobacionMasiva',
    idEmpleado,
    plantaIds: plantaIdsUsuario === null ? 'admin' : plantaIdsUsuario,
    idsSolicitados: ids.length,
    idsTrasFiltroPlanta: idsAFiltrar.length,
    aprobados: updated,
    ignoradosPorPlanta,
    veredicto: {
      verdes:         veredicto.verdes.length,
      naranjas:       veredicto.naranjas.length,
      rojos:          veredicto.rojos.length,
      indeterminados: veredicto.indeterminados.length,
    },
    motivoAprobacionMasiva: motivoAprobacionMasiva || null,
    fechaAprobacion: fechaAprobacion.toISOString(),
  }));

  const tc = getCacheForDb(db);
  tc.del('probetas');
  return {
    aprobados: updated,
    ignoradosPorPlanta,
    veredicto: {
      verdes:         veredicto.verdes.length,
      naranjas:       veredicto.naranjas.length,
      rojos:          veredicto.rojos.length,
      indeterminados: veredicto.indeterminados.length,
    },
  };
};

const getCountEnsayosPendientes = async (db) => {
  return db.EnsayoResistencia.count({ where: { pendienteRevision: true } });
};

/**
 * N-05 (auditoría 08, Bloque 7): probetas próximas a romper en los
 * próximos `dias` (default 7), agrupadas por planta + fecha. Útil para
 * planificación diaria del laboratorio.
 *
 * Filtra solo probetas ACTIVAS (CURANDO + PENDIENTE). Excluye las que
 * ya tienen ensayo (idEnsayoResistencia ≠ null).
 *
 * @param {object} db
 * @param {object} params { dias = 7, plantaIds (opcional, filtro por planta del usuario) }
 * @returns {{ porDia: Array<{ fecha, plantas: Array<{ idPlanta, nombre, probetas }> }>, total }}
 */
const getProximasARomper = async (db, { dias = 7, plantaIds = null } = {}) => {
  const ahora = new Date();
  ahora.setHours(0, 0, 0, 0);
  const limite = new Date(ahora.getTime() + Number(dias) * 24 * 60 * 60 * 1000);

  const probetas = await db.Probeta.findAll({
    where: {
      idEstadoProbeta: { [Op.in]: [ESTADO_PROBETA.CURANDO, ESTADO_PROBETA.PENDIENTE] },
      fechaRotura: { [Op.between]: [ahora, limite] },
      idEnsayoResistencia: null,
    },
    attributes: ['idProbeta', 'nombre', 'codigo', 'fechaRotura', 'diasRotura', 'idEstadoProbeta', 'idMuestra', 'idMuestraTerceros', 'idMuestraPaston'],
    include: [
      {
        model: db.Muestra, as: 'muestra', required: false,
        attributes: ['idMuestra', 'fecha', 'idPlanta'],
        include: [
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
        ],
      },
      {
        model: db.MuestraTerceros, as: 'muestraTerceros', required: false,
        attributes: ['idMuestraTerceros', 'fecha', 'idPlanta'],
        include: [
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
        ],
      },
      {
        // 3ra fuente: probetas de pastón (propias). Sin esto volvían con
        // muestra/muestraTerceros null → sin planta → filtradas para no-admin.
        model: db.MuestraPaston, as: 'muestraPaston', required: false,
        attributes: ['idMuestraPaston', 'idPastonPrueba', 'origen', 'fecha', 'idPlanta'],
        include: [
          { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
          { model: db.Cliente, as: 'cliente', attributes: ['nombre', 'razonSocial', 'tipoPersona'] },
          { model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] },
          { model: db.TipoHormigon, as: 'tipoHormigon', attributes: ['tipoHormigon'] },
        ],
      },
    ],
    order: [['fechaRotura', 'ASC']],
  });

  // Filtro por planta del usuario (si no es admin).
  const probetasFiltradas = Array.isArray(plantaIds)
    ? probetas.filter((p) => {
        const idPlanta = p.muestra?.idPlanta ?? p.muestraTerceros?.idPlanta ?? p.muestraPaston?.idPlanta;
        return idPlanta != null && plantaIds.map(Number).includes(Number(idPlanta));
      })
    : probetas;

  // Agrupar por día + planta.
  const porDiaMap = new Map();
  for (const p of probetasFiltradas) {
    const fechaStr = new Date(p.fechaRotura).toISOString().slice(0, 10);
    const ctx = p.muestra ?? p.muestraTerceros ?? p.muestraPaston;
    const planta = ctx?.planta ?? null;
    const idPlanta = planta?.idPlanta ?? 0;

    if (!porDiaMap.has(fechaStr)) {
      porDiaMap.set(fechaStr, new Map());
    }
    const plantaMap = porDiaMap.get(fechaStr);
    if (!plantaMap.has(idPlanta)) {
      plantaMap.set(idPlanta, {
        idPlanta,
        nombre: planta?.nombre ?? 'Sin planta',
        probetas: [],
      });
    }
    plantaMap.get(idPlanta).probetas.push({
      idProbeta: p.idProbeta,
      nombre: p.nombre,
      codigo: p.codigo,
      fechaRotura: p.fechaRotura,
      diasRotura: p.diasRotura,
      idEstadoProbeta: p.idEstadoProbeta,
      idMuestra: p.idMuestra ?? null,
      idMuestraTerceros: p.idMuestraTerceros ?? null,
      idMuestraPaston: p.idMuestraPaston ?? null,
      esPaston: !!p.muestraPaston,
      pastonOrigen: p.muestraPaston?.origen ?? null,
      idPastonPrueba: p.muestraPaston?.idPastonPrueba ?? null,
      cliente: ctx?.cliente
        ? (ctx.cliente.tipoPersona === 'Física' ? ctx.cliente.nombre : ctx.cliente.razonSocial)
        : null,
      obra: ctx?.obra?.nombre ?? null,
      tipoHormigon: ctx?.tipoHormigon?.tipoHormigon ?? null,
    });
  }

  const porDia = Array.from(porDiaMap.entries())
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([fecha, plantasMap]) => ({
      fecha,
      plantas: Array.from(plantasMap.values()),
    }));

  return {
    porDia,
    total: probetasFiltradas.length,
    rango: { desde: ahora.toISOString().slice(0, 10), hasta: limite.toISOString().slice(0, 10) },
  };
};

/**
 * N-03 (auditoría 08, Bloque 7): informe de aceptación de obra/lote.
 *
 * Diferencia con `getResistencias`:
 *  - getResistencias agrupa por tipo de hormigón → puede devolver varios
 *    tipos en una sola consulta (vista period-wide del laboratorio).
 *  - getAceptacionLote se enfoca en UN lote homogéneo (cliente + obra +
 *    dosificación) para emitir un informe entregable al director de obra
 *    con veredicto CIRSOC §6.2.3 (Modo 1) y §6.2.4 (Modo 2). El comment
 *    previo decía "§4.3" — §4.3 en CIRSOC 200-2024 es "Aire incorporado"
 *    (Tablas 4.3), no aceptación. La aceptación cliente está en §6.2.3
 *    y §6.2.4 (sí citadas correctamente en líneas 3912–3914). Sprint 6 B5.
 *
 * Flujo:
 *  1. Reusa getResistencias con filtros estrictos.
 *  2. Toma el primer tipo de hormigón (debería haber UNO solo si los
 *    filtros aciertan; si hay varios, el endpoint exige idDosificacion).
 *  3. Por cada muestra del lote, ejecuta `evaluarMuestraFresco` para
 *    obtener veredicto de asentamiento, temperatura y aire.
 *  4. Determina veredicto global: APTO si M1 o M2 cumplen + sin críticos
 *    de fresco; ACEPTABLE_CON_RESERVAS si hay warnings de fresco pero
 *    aceptación CIRSOC OK; NO_APTO si CIRSOC no cumple.
 *
 * @param {object} db
 * @param {object} params
 * @param {number} params.edadDiseno
 * @param {number} [params.idCliente]
 * @param {number} [params.idObra]
 * @param {number} [params.idDosificacion]
 * @param {number} [params.idPlanta]
 * @param {number} [params.idTipoHormigon]
 * @param {string} [params.desde]                YYYY-MM-DD
 * @param {string} [params.hasta]                YYYY-MM-DD
 * @param {string} [params.modoEvaluacion]       'PRESCRIPTIVO' | 'PRESTACIONAL'
 * @param {string} [params.claseExposicion]      Para evaluación de aire (Tabla 4.3 CIRSOC).
 * @returns {object|null}
 */
const getAceptacionLote = async (db, params) => {
  const { evaluarMuestraFresco } = require('../domain/ensayoFrescoEvalEngine');

  // 1. Datos del lote vía getResistencias.
  const resData = await getResistencias(db, params);
  const main = (resData && Array.isArray(resData.main)) ? resData.main : [];
  if (main.length === 0) return null;

  // El informe es por UN lote — si hay varios tipos de hormigón, advertimos
  // y devolvemos el primero (el caller debería filtrar por idDosificacion).
  const lote = main[0];
  const variosTipos = main.length > 1;

  // 2. Cargar muestras completas (con datos de fresco) para evaluación de
  //    asentamiento/temperatura/aire. Reusamos buildMuestraInclude.
  const detalles = lote.detalles || [];
  const idMuestraList = detalles.map((d) => d.idMuestra).filter(Boolean);
  let muestrasFresco = [];
  if (idMuestraList.length > 0) {
    muestrasFresco = await db.Muestra.findAll({
      where: { idMuestra: idMuestraList },
      attributes: [
        'idMuestra', 'fecha', 'temperaturaHormigon', 'temperaturaAmbiente',
        'asentamientoMm', 'asentamiento', 'aireincorporado',
      ],
      include: [
        {
          model: db.Dosificacion, as: 'dosificacion',
          attributes: ['idDosificacion', 'nombre', 'idTamanioMaximoNominal', 'idAsentamientoDisenio'],
          include: [
            { model: db.AsentamientoDisenio, as: 'asentamientoDisenio', attributes: ['asentamiento'] },
            { model: db.TamanioMaximoNominal, as: 'tamanioMaximoNominal', attributes: ['tamanio'] },
          ],
        },
      ],
    });
  }
  const muestrasFrescoMap = new Map(muestrasFresco.map((m) => [m.idMuestra, m]));

  // 3. Evaluar fresco por muestra.
  const detallesConFresco = detalles.map((d) => {
    const m = muestrasFrescoMap.get(d.idMuestra);
    if (!m) return { ...d, fresco: null };
    // asentamientoMm preferido; fallback al campo legacy `asentamiento`
    // (en cm; el migration lo backfilleó pero quedó por si acaso).
    const asentMm = m.asentamientoMm != null
      ? Number(m.asentamientoMm)
      : (m.asentamiento != null ? Number(m.asentamiento) * 10 : null);
    const fresco = evaluarMuestraFresco({
      temperaturaHormigon: m.temperaturaHormigon != null ? Number(m.temperaturaHormigon) : null,
      asentamientoMm: asentMm,
      aireincorporado: m.aireincorporado != null ? Number(m.aireincorporado) : null,
    }, {
      dosificacion: {
        asentamientoObjetivoMm: m.dosificacion?.asentamientoDisenio?.asentamiento != null
          ? Number(m.dosificacion.asentamientoDisenio.asentamiento) * 10  // suponemos cm en catalogo
          : null,
        tmnMm: m.dosificacion?.tamanioMaximoNominal?.tamanio != null
          ? Number(m.dosificacion.tamanioMaximoNominal.tamanio)
          : null,
      },
      claseExposicion: params.claseExposicion ?? null,
    });
    return {
      ...d,
      fresco,
      asentamientoMmMedido: asentMm,
      temperaturaHormigon: m.temperaturaHormigon,
      aireincorporado: m.aireincorporado,
    };
  });

  // 4. Veredicto global de aceptación.
  //
  // Criterio contractual (M7 — auditoría revisor-civil 2026-05-09): el lote
  // se acepta según el modo CIRSOC pactado en contrato. Antes este path
  // hacía `cumpleCirsoc = (M1 || M2)` — un OR ciego que aprobaba el lote
  // si CUALQUIERA de los dos modos cumplía. Pero si el contrato exige M2
  // estricto y M1 cumple por la tolerancia ±3,5 MPa mientras M2 falla, el
  // lote NO debería aceptarse contra ese contrato.
  //
  // Default 'M1' por compatibilidad: la mayoría de los contratos de obra
  // privada usan Modo 1 (§6.2.3, aceptación cliente con tolerancia). El
  // caller que pacta Modo 2 (típicamente obra pública o estructuras de
  // alta responsabilidad) debe pasar 'M2' explícitamente.
  const criterioContractual = (params.criterioContractual === 'M2') ? 'M2' : 'M1';
  const cumpleModoElegido = criterioContractual === 'M2'
    ? lote.cumpleCirsocM2
    : lote.cumpleCirsocM1;
  let veredictoGlobal;
  let cumpleCirsoc = false;
  if (cumpleModoElegido === true) {
    cumpleCirsoc = true;
  } else if (cumpleModoElegido === null && lote.cumpleLote === true) {
    // Lote en escenario donde el modo elegido no es evaluable (ej. n<3
    // para M1) pero IRAM 1666 vía medias móviles sí cumple → fallback.
    cumpleCirsoc = true;
  }
  const algunCriticoFresco = detallesConFresco.some((d) =>
    d.fresco?.summary?.warnings?.some((w) => w.severity === 'critical')
  );
  const algunWarningFresco = detallesConFresco.some((d) =>
    d.fresco?.summary?.warnings?.length > 0
  );

  // Cita normativa del criterio aplicado al veredicto. El template del PDF
  // (aceptacionLote.ejs) la muestra en el banner. Si el veredicto se
  // determinó por fallback IRAM (modo elegido null pero cumpleLote=true),
  // citamos esa norma en su lugar.
  let criterioCita;
  if (cumpleModoElegido === null && lote.cumpleLote === true) {
    criterioCita = 'IRAM 1666:2020 §A.7.10 (medias móviles, fallback con M1/M2 no evaluables)';
  } else if (criterioContractual === 'M2') {
    criterioCita = 'CIRSOC 200-2024 §6.2.4 (Modo 2)';
  } else {
    criterioCita = 'CIRSOC 200-2024 §6.2.3 (Modo 1)';
  }

  let codigoVeredicto;
  if (!cumpleCirsoc) {
    codigoVeredicto = 'NO_APTO';
  } else if (algunCriticoFresco) {
    codigoVeredicto = 'NO_APTO';
  } else if (algunWarningFresco) {
    codigoVeredicto = 'ACEPTABLE_CON_RESERVAS';
  } else {
    codigoVeredicto = 'APTO';
  }
  veredictoGlobal = { codigo: codigoVeredicto, criterio: criterioCita };

  return {
    lote: {
      tipoHormigon: lote.tipoHormigon,
      resistencia_diseno: lote.resistencia_diseno,
      resistencia_media: lote.resistencia_media,
      desviacion_estandar: lote.desviacion_estandar,
      caracteristica: lote.caracteristica,
      coef_variacion: lote.coef_variacion,
      tamanoLote: lote.tamanoLote,
      minima: lote.minima,
      maxima: lote.maxima,
      cliente: lote.cliente,
      obra: lote.obra,
      planta: lote.planta,
      plantaModelo: lote.plantaModelo,
      prensaModelo: lote.prensaModelo,
      idDosificacion: lote.idDosificacion,
      dosificacionNombre: lote.dosificacionNombre,
      dosificacion: lote.dosificacion,
    },
    cumplimiento: {
      // Bloque 17 auditoría 08: 3 veredictos paralelos. El usuario elige
      // cuál destacar según el contexto (productor → IRAM autocontrol;
      // cliente → CIRSOC M1 o M2 según el contrato).
      cumpleLote: lote.cumpleLote,                   // legacy histórico HormiQual
      cumpleCirsocM1: lote.cumpleCirsocM1,           // §6.2.3 — aceptación cliente
      cumpleCirsocM2: lote.cumpleCirsocM2,           // §6.2.4 — aceptación cliente estricto
      cumpleIramAutocontrol: lote.cumpleIramAutocontrol, // §A.7.10 — autocontrol productor
      evaluacionMetodologia: lote.evaluacionMetodologia,
      mediasMoviles: lote.mediasMoviles,
      // M7: el modo CIRSOC contra el que se evaluó el veredicto global.
      // El frontend lo usa para mostrar la cita normativa correcta y
      // resaltar la card del modo aplicado.
      criterioContractual,                            // 'M1' | 'M2'
    },
    detalles: detallesConFresco,
    muestrasInvalidas: lote.muestrasInvalidas || [],  // CIRSOC §6.1.6.1: n<2 descartadas
    muestreosDescartados: lote.muestreosDescartados,
    trazabilidadCalibracion: lote.trazabilidadCalibracion || {     // Recursos MVP — ISO 17025 §6.4.7
      totalEnsayos: 0,
      sinCalibracionAplicada: 0,
      probetasSinCalibracion: [],
    },
    hermanas: resData.hermanas || {},
    veredictoGlobal,
    contexto: {
      edadDiseno: params.edadDiseno,
      modoEvaluacion: params.modoEvaluacion ?? 'PRESTACIONAL',
      claseExposicion: params.claseExposicion ?? null,
      filtros: {
        idCliente:      params.idCliente,
        idObra:         params.idObra,
        idDosificacion: params.idDosificacion,
        idPlanta:       params.idPlanta,
        idTipoHormigon: params.idTipoHormigon,
        desde:          params.desde,
        hasta:          params.hasta,
      },
    },
    advertencias: variosTipos
      ? [`Se detectaron ${main.length} tipos de hormigón en el lote filtrado. Se está informando el primero (${lote.tipoHormigon}). Para emitir un informe entregable, filtrar por idDosificacion.`]
      : [],
  };
};

/**
 * GET temperatura de la pileta asociada a una probeta
 * Agrupa registros por día y calcula stats
 */
const getProbetaTemperatura = async (db, idProbeta) => {
  const probeta = await db.Probeta.findByPk(idProbeta, {
    attributes: ['idProbeta', 'idPileta', 'fechaRotura', 'nombre'],
    include: [
      {
        model: db.Muestra, as: 'muestra', attributes: ['idMuestra', 'fecha'],
        include: [{ model: db.Despacho, as: 'despacho', attributes: ['fecha'] }],
      },
    ],
  });

  if (!probeta || !probeta.idPileta) return null;

  const pileta = await db.Pileta.findByPk(probeta.idPileta, {
    include: [
      { model: db.PiletaEstado, as: 'estado' },
      { model: db.Planta, as: 'planta', attributes: ['idPlanta', 'nombre'] },
    ],
  });

  // C-LOG-02 fix (auditoría 08, Bloque 2): preferir Muestra.fecha (snapshot
  // de moldeo) sobre Despacho.fecha. Para muestras post-mig 20260505g sin
  // despacho, antes esta función retornaba siempre todos los registros desde
  // el inicio de los tiempos porque fechaInicio era null.
  const fechaBase = probeta.muestra?.fecha ?? probeta.muestra?.despacho?.fecha ?? null;
  const fechaInicio = fechaBase ? new Date(fechaBase) : null;
  // Cap superior: si la probeta ya fue ensayada (fechaRotura presente), el
  // curado terminó ese día. Mostrar temperaturas posteriores es engañoso —
  // la probeta ya no estaba en la pileta. Si sigue curando, no se acota.
  let fechaFin = null;
  if (probeta.fechaRotura) {
    fechaFin = new Date(probeta.fechaRotura);
    fechaFin.setHours(23, 59, 59, 999);
  }

  const where = { idPileta: probeta.idPileta };
  if (fechaInicio || fechaFin) {
    where.timestamp = {};
    if (fechaInicio) where.timestamp[Op.gte] = fechaInicio;
    if (fechaFin) where.timestamp[Op.lte] = fechaFin;
  }

  const registros = await db.PiletaRegistroTemperatura.findAll({
    where,
    order: [['timestamp', 'ASC']],
    limit: 50000,
  });

  if (!registros.length) {
    return { pileta: pileta?.get({ plain: true }), registros: [], dailyData: [], stats: null };
  }

  // Agrupar por día
  const byDay = {};
  for (const r of registros) {
    const d = new Date(r.timestamp);
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    if (!byDay[key]) byDay[key] = [];
    byDay[key].push(Number(r.temperatura));
  }

  const umbral = Number(pileta?.umbralAlerta ?? 3);
  const objetivo = pileta?.estado ? Number(pileta.estado.temperaturaObjetivo ?? 0) : 0;

  const dailyData = Object.entries(byDay).map(([fecha, temps]) => {
    const avg = parseFloat((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1));
    const min = parseFloat(Math.min(...temps).toFixed(1));
    const max = parseFloat(Math.max(...temps).toFixed(1));
    const fueraRango = objetivo > 0 && Math.abs(avg - objetivo) > umbral;
    return { fecha, avg, min, max, fueraRango, n: temps.length };
  });

  const allTemps = registros.map(r => Number(r.temperatura));
  const avgGlobal = parseFloat((allTemps.reduce((a, b) => a + b, 0) / allTemps.length).toFixed(1));
  const minGlobal = parseFloat(Math.min(...allTemps).toFixed(1));
  const maxGlobal = parseFloat(Math.max(...allTemps).toFixed(1));
  const diasFueraRango = dailyData.filter(d => d.fueraRango).length;

  return {
    pileta: pileta?.get({ plain: true }),
    dailyData,
    stats: {
      avg: avgGlobal,
      min: minGlobal,
      max: maxGlobal,
      totalRegistros: registros.length,
      totalDias: dailyData.length,
      diasFueraRango,
      objetivo: objetivo || null,
      umbral,
    },
  };
};

/**
 * Variante de getProbetaTemperatura con verificación de ownership por
 * razonSocial + cuit del cliente. Se invoca desde el endpoint interno usado
 * por el Portal de Clientes, ya que el endpoint principal está protegido por
 * JWT de empleado interno.
 *
 * Retorna:
 *  - null si la probeta existe pero no tiene pileta asociada o no hay registros
 *  - 'forbidden' si la probeta no pertenece al cliente identificado
 *  - el objeto normal de temperatura cuando todo es válido
 */
const getProbetaTemperaturaWeb = async (db, idProbeta, { razonSocial, cuit }) => {
  if (!razonSocial || !cuit) return 'forbidden';
  const cliente = await db.Cliente.findOne({ where: { razonSocial, cuil_cuit: cuit } });
  if (!cliente) return 'forbidden';

  const probeta = await db.Probeta.findByPk(idProbeta, {
    attributes: ['idProbeta', 'idMuestra', 'idMuestraTerceros'],
    include: [
      {
        model: db.Muestra,
        as: 'muestra',
        required: false,
        attributes: ['idMuestra'],
        include: [{ model: db.Despacho, as: 'despacho', required: false, attributes: ['idCliente'] }],
      },
      {
        model: db.MuestraTerceros,
        as: 'muestraTerceros',
        required: false,
        attributes: ['idCliente'],
      },
    ],
  });
  if (!probeta) return 'forbidden';

  const idClienteOwner =
    probeta.muestra?.despacho?.idCliente ?? probeta.muestraTerceros?.idCliente ?? null;
  if (idClienteOwner !== cliente.idCliente) return 'forbidden';

  return getProbetaTemperatura(db, idProbeta);
};

// [VITRINA] Catálogo de estados de probeta. En producción este listado lo servía
// el módulo Despachos (GET /api/despachos/estadoprobeta), recortado en la vitrina.
// Lo exponemos vía el router de probetas (montado) para que el form de carga de
// ensayo pueble el dropdown de Estado. Lee la tabla EstadoProbeta (ya sembrada).
const getEstadosProbeta = async (db) =>
  db.EstadoProbeta.findAll({ order: [['idEstadoProbeta', 'ASC']] });

module.exports = {
  getProbetas,
  getProbeta,
  getEstadosProbeta,
  createProbeta,
  updateProbeta,
  deleteProbeta,
  createEnsayoResistencia,
  updateEnsayoResistencia,
  getResistencias,
  getProbetasTerceros,
  getProbetasFiltradas,
  getProbetasWeb,
  getProbetaTemperaturaWeb,
  generateResistancePDF,
  getEnsayosPendientesRevision,
  getEnsayoRevisionDetalle,
  aprobarEnsayo,
  aprobarEnsayosMasivo,
  getCountEnsayosPendientes,
  getProbetaTemperatura,
  evaluarConsistenciaProbetas,  // PR8.3 — exportado para tests
  calcEdadEnsayo,               // M-CAL-01 (Bloque 14) — exportado para tests
  cumpleIramAutocontrol,        // R9-H5 (Bloque 17) — autocontrol del productor
  cumpleCirsocM1Individual,     // R9-H5 (Bloque 17) — condición individual §6.2.3
  extractMuestraContext,        // Bloque 2 auditoría 08 — exportado para tests
  buildChartData,               // Bloque 2 auditoría 08 — exportado para tests de regresión
  getProximasARomper,           // N-05 auditoría 08, Bloque 7
  getAceptacionLote,            // N-03 auditoría 08, Bloque 7
  COEF_CORRECCION_10X20_A_15X30_DEFAULT,  // M-CAL-06
  N_MINIMO_POR_TIPO_PROBETA,              // M-CAL-06
  anularProbeta,                          // Mej-16 auditoría 08
  desaprobarEnsayo,                       // Mej-17 auditoría 08
  marcarEtiquetasImpresas,                // N-01 etiqueta QR (sesión 2026-05-09)
  getEtiquetasPendientes,                 // N-01 etiqueta QR (sesión 2026-05-09)
  getProbetasParaEtiquetasPorMuestras,    // N-01 etiqueta QR (sesión 2026-05-28)
  marcarProbetasPaston,                   // Probetas de pastón (sesión 2026-05-18) — exportado para tests
};