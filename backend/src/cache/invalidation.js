/**
 * invalidation.js - Registra hooks de Sequelize para invalidar cache automaticamente.
 *
 * Cuando un modelo sufre afterCreate / afterUpdate / afterDestroy / afterBulkCreate /
 * afterBulkUpdate / afterBulkDestroy, se invalidan los namespaces asociados.
 *
 * De esta forma el cache siempre refleja el estado real de la DB sin necesidad
 * de polling ni TTLs extremadamente cortos.
 */
const { publishInvalidation } = require('./invalidationBus');

/**
 * Mapa de modelo -> namespaces que se invalidan al cambiar ese modelo.
 *
 * Ejemplo: cuando cambia un User, invalidamos 'auth' y 'usuarios'.
 * Cuando cambia un Dosificacion, invalidamos 'dosificaciones' y 'catalogos'.
 */
const MODEL_NAMESPACE_MAP = {
  // ─── Auth & permisos ───
  User:           ['auth', 'usuarios', 'menus'],
  PermisoMenu:    ['auth', 'menus'],
  Menu:           ['auth', 'menus'],
  UserPlanta:     ['auth'],

  // ─── Catalogos (cambian muy raramente) ───
  TipoHormigon:           ['catalogos'],
  EdadDisenio:             ['catalogos'],
  AsentamientoDisenio:     ['catalogos'],
  TamanioMaximoNominal:    ['catalogos'],
  TipoDescarga:            ['catalogos'],
  TipoCemento:             ['catalogos'],
  TipoProbeta:             ['catalogos'],
  ModalidadMuestra:        ['catalogos'],
  EstadoProbeta:           ['catalogos'],
  CategoriaVehiculo:       ['catalogos', 'vehiculos'],
  TipoSemirremolque:       ['catalogos'],
  TipoAcoplado:            ['catalogos'],
  TipoMaquina:             ['catalogos'],
  TipoGrupoElectrogeno:    ['catalogos'],
  TipoEstructura:          ['catalogos'],
  UnidadMedida:            ['catalogos'],
  UnidadMedidaPrensa:      ['catalogos'],
  Rol:                     ['catalogos', 'auth', 'candidatos'],

  // ─── Config ───
  Config:         ['config', 'auth', 'menus'],

  // ─── Entidades de negocio ───
  Planta:                  ['catalogos', 'plantas'],

  Dosificacion:            ['dosificaciones'],
  DosificacionCemento:     ['dosificaciones'],
  DosificacionAditivos:    ['dosificaciones'],
  DosificacionAgregados:   ['dosificaciones'],
  DosificacionFibras:      ['dosificaciones'],

  Cliente:                 ['clientes'],
  Obra:                    ['obras'],

  Empleado:                ['empleados'],
  EmpleadoRol:             ['empleados', 'auth'],

  Vehiculo:                ['vehiculos'],

  Despacho:                ['despachos', 'estadisticasDespachos'],
  DespachoEstado:          ['despachos', 'catalogos'],
  Muestra:                 ['muestras', 'despachos', 'estadisticasDespachos'],
  MuestraTerceros:         ['muestras', 'probetas'],
  Probeta:                 ['probetas', 'muestras', 'estadisticasDespachos'],
  EnsayoResistencia:       ['probetas', 'estadisticasDespachos'],
  ReporteResistencia:      ['probetas'],

  Cemento:                 ['catalogos', 'dosificaciones'],
  Aditivo:                 ['catalogos', 'dosificaciones'],
  Agregado:                ['catalogos', 'dosificaciones'],
  AgregadoFino:            ['catalogos', 'dosificaciones'],
  AgregadoGrueso:          ['catalogos', 'dosificaciones'],
  Fibra:                   ['catalogos', 'dosificaciones'],

  Pedido:                  ['pedidos', 'estadisticasDespachos'],

  // ─── Ventas / Facturación / Cobranzas ───
  OrdenVenta:              ['estadisticasDespachos'],
  FacturaVenta:            ['estadisticasDespachos'],
  Cobranza:                ['estadisticasDespachos'],
  RemitoVenta:             ['estadisticasDespachos'],

  // ─── Combustible ───
  FuenteCombustible:       ['combustibles', 'catalogos'],
  CategoriaFuenteCombustible: ['combustibles', 'catalogos'],
  RegistroCombustible:     ['estadisticasDespachos'],

  // ─── Sub-entidades (incluidas en clientes/obras/empleados/proveedores/candidatos/plantas) ───
  Entidad:                 ['clientes', 'obras', 'empleados', 'proveedores', 'candidatos', 'plantas'],
  Domicilio:               ['clientes', 'obras', 'empleados', 'proveedores', 'candidatos', 'plantas'],
  Telefono:                ['clientes', 'obras', 'empleados', 'proveedores', 'candidatos', 'plantas'],
  Email:                   ['clientes', 'obras', 'empleados', 'proveedores', 'candidatos', 'plantas'],
  Banco:                   ['empleados', 'catalogos'],
  NombreBanco:             ['empleados', 'catalogos'],
  ConvenioEmpleado:        ['empleados'],
  CategoriaConvenio:       ['empleados'],
  EmpleadoEquipo:          ['empleados'],

  // ─── Prensas ───
  Prensa:                  ['catalogos'],

  // ─── Compras / Ventas (catalogos) ───
  Proveedor:               ['proveedores'],
  ConceptoCompra:          ['catalogos'],
  ProductoServicio:        ['productosServicios'],
  ProductoServicioPlanta:  ['productosServicios'],
  SectorCosto:             ['catalogos'],
  CentroCosto:             ['catalogos'],

  // ─── Liquidación / RRHH ───
  ConceptoLiquidacion:         ['catalogos'],
  TipoConceptoLiquidacion:     ['catalogos'],
  ConceptoLiquidacionDefecto:  ['empleados'],
  TareaDesempenada:            ['catalogos'],
  RazonLicencia:               ['catalogos'],

  // ─── Candidatos ───
  Candidato:               ['candidatos'],
  CandidatoRol:            ['candidatos'],

  // ─── Matafuegos ───
  Matafuego:               ['vehiculos'],

  // ─── Reglamentos ───
  Reglamento:              ['reglamentos'],
  ReglamentoCambios:       ['reglamentos'],
  ReglamentoAceptaciones:  ['reglamentos'],

  // ─── Checklist mecánico ───
  CategoriaChecklistMecanico: ['vehiculos'],

  // ─── CRM ───
  SeguimientoPresupuesto:  ['seguimientos', 'crm'],
  EventoSeguimiento:       ['seguimientos', 'crm'],
  CategoriaCliente:        ['clientes', 'crm'],
  EtiquetaCliente:         ['clientes', 'crm'],
  ClienteEtiqueta:         ['clientes', 'crm'],

  // ─── Materiales extra en despacho ───
  DespachoAditivosExtra:   ['despachos'],
  DespachoCementosExtra:   ['despachos'],
  DespachoAgregadosExtra:  ['despachos'],
  DespachoFibrasExtra:     ['despachos'],
  DespachoAguaExtra:       ['despachos'],
};

/**
 * Hooks que queremos interceptar.
 * Usamos los hooks "after" para que la invalidacion ocurra
 * solo cuando la operacion fue exitosa.
 */
const HOOK_NAMES = [
  'afterCreate',
  'afterUpdate',
  'afterDestroy',
  'afterBulkCreate',
  'afterBulkUpdate',
  'afterBulkDestroy',
];

/**
 * Registrar hooks de invalidacion en todos los modelos de un db (tenant).
 *
 * @param {object} db  Objeto devuelto por createDbConnection (contiene los modelos)
 * @param {string} tenantId
 */
function registerInvalidationHooks(db, tenantId) {
  for (const [modelName, namespaces] of Object.entries(MODEL_NAMESPACE_MAP)) {
    const model = db[modelName];
    if (!model) continue; // modelo no existe en este tenant

    for (const hookName of HOOK_NAMES) {
      model.addHook(hookName, `cache_invalidate_${hookName}`, () => {
        // Invalida local + propaga a los demas workers (cluster). Fail-safe:
        // si el bus no esta disponible, degrada a invalidacion local + TTL.
        publishInvalidation(tenantId, namespaces);
      });
    }
  }
}

module.exports = { registerInvalidationHooks, MODEL_NAMESPACE_MAP };
