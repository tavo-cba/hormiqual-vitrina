import React from "react";
import Home from "../home/home";
import InformeAceptacionLotePage from "../calidad/reportes/InformeAceptacionLotePage";
import PrensaForm from "../admin/prensa/uikit/prensaForm";
import AdminAgregado from "../admin/agregado/agregado";
import AgregadoForm from "../admin/agregado/uikit/agregadoForm";
import AdminCemento from "../admin/cemento/cemento";
import CementoForm from "../admin/cemento/uikit/cementoForm";
import AdminAditivo from "../admin/aditivo/aditivo";
import AditivoForm from "../admin/aditivo/uikit/aditivoForm";
import AdminDosificacion from "../admin/dosificacion/dosificacion";
import DosificacionForm from "../admin/dosificacion/uikit/dosificacionForm";
import MuestrasPage from "../admin/muestra/MuestrasPage";
import { MuestraFormStandalone } from "../admin/muestra/uikit/muestraForm";
import ProbetasPage from "../admin/probeta/ProbetasPage";
import ProbetaForm from "../admin/probeta/uikit/probetaForm";
import ProximasARomperPage from "../admin/probeta/ProximasARomperPage";
import ProbetaQrRedirect from "../admin/probeta/ProbetaQrRedirect";
import EtiquetasPendientesPage from "../admin/probeta/EtiquetasPendientesPage";
import EtiquetadoProbetasDocPage from "../admin/probeta/EtiquetadoProbetasDocPage";
import RouteRedirect from "../../common/components/RouteRedirect";
import CusumPage from "../calidad/estadisticas/CusumPage";
import PlacasElastomeroPage from "../calidad/placas-elastomero/PlacasElastomeroPage";
import AdminFibra from "../admin/fibra/fibra";
import FibraForm from "../admin/fibra/uikit/fibraForm";
import Settings from "../settings/settings";
import PreferenciasPage from "../admin/preferencias/PreferenciasPage";
import AdminUsers from "../admin/users/user";
import UsersForm from "../admin/users/uikit/userForm";
// [VITRINA] Reportes de Calidad (subset de reports/)
import ReporteAsentamientos from "../reports/uikit/report-settlement";
import ReporteAire from "../reports/uikit/report-air";
import ReporteTemperatura from "../reports/uikit/report-temperature";
import ReportFresh from "../reports/uikit/report-fresh";
import ReporteResistencias from "../reports/uikit/report-resistance";
import ReporteResistenciaFiles from "../reports/uikit/report-resistance-files";
import ReportProbetas from "../reports/uikit/report-probetas";
import MuestraTercerosForm from "../admin/muestra-terceros/uikit/muestraTercerosForm";
import TableroCalidadPage from "../calidad/tablero/TableroCalidadPage";
import ControlCalidadPage from "../calidad/control/ControlCalidadPage";
import RolesCalidadPage from "../calidad/roles/RolesCalidadPage";
import HerramientasPage from "../calidad/herramientas/HerramientasPage";
import CatalogosHub from "../calidad/CatalogosHub";
import MaterialList from "../calidad/materiales/MaterialList";
import MaterialDetailPage from "../calidad/materiales/MaterialDetailPage";
import MaterialForm from "../calidad/materiales/MaterialForm";
import AguaForm from "../calidad/materiales/AguaForm";
import MaterialDocRevision from "../calidad/materiales/MaterialDocRevision";
import MaterialLivianoForm from "../calidad/materiales/MaterialLivianoForm";
import CurvaList from "../calidad/curvas/CurvaList";
import CurvaForm from "../calidad/curvas/CurvaForm";
import CurvaSetDetail from "../calidad/curvas/CurvaSetDetail";
import RevisionesEnsayo from "../calidad/revisiones/RevisionesEnsayo";
import RevisionEnsayoPage from "../calidad/revisiones/RevisionEnsayoPage";
import RevisionesDosificaciones from "../calidad/revisiones/RevisionesDosificaciones";
import AgregadoEnsayosPage from "../calidad/ensayos-agregados/AgregadoEnsayosPage";
import AguaEnsayosPage from "../calidad/ensayos-agregados/AguaEnsayosPage";
import NormasPage from "../calidad/normas/NormasPage";
import TechnicalEvidencePage from "../calidad/compliance/TechnicalEvidencePage";
import DocumentApprovalsPanel from "../calidad/compliance/DocumentApprovalsPanel";
import CatalogoEnsayosPage from "../calidad/catalogo-ensayos/CatalogoEnsayosPage";
import MezclasPage from "../calidad/diseno/MezclasPage";
import MezclasCatalogoPage from "../calidad/mezclas/MezclasCatalogoPage";
import MezclaDetallePage from "../calidad/mezclas/MezclaDetallePage";
import DosificacionDisenoPage from "../calidad/dosificacion-diseno/DosificacionDisenoPage";
import DosificacionesCatalogoPage from "../calidad/dosificacion-diseno/DosificacionesCatalogoPage";
import DosificacionComparacionPage from "../calidad/dosificacion-diseno/DosificacionComparacionPage";
import InformeConfigurablePage from "../calidad/informes/InformeConfigurablePage";
import ParametrosMotorPage from "../calidad/parametros-motor/ParametrosMotorPage";
import TipologiasConfigPage from "../calidad/tipologias/TipologiasConfigPage";
import CurvaCementoPage from "../calidad/curvas-cemento/CurvaCementoPage";
import FactorAjusteCurvaPage from "../calidad/curvas-cemento/FactorAjusteCurvaPage";
// DashboardPlantaPage fusionado a TableroCalidadPage (sesión 2026-05-09).
// Su contenido vive ahora en `tablero/views/TableroPlantaView.jsx` como
// tab interno del Tablero unificado.

// Tablero Financiero

// Tablero Comercial & Financiero (combinado)
// Tablero RRHH (recursos humanos)

// Betonmatic

// CRM — seguimiento comercial de presupuestos

export const publicRoutes = [
    { path: "/", element: <Home />, tabLabel: "Inicio" },
    // Sesión 2026-05-27 — Catálogos de materiales (agregados, cementos,
    // aditivos, fibras) movidos de /admin/* a /calidad/catalogos/* para
    // alinear con la jerarquía de Calidad (donde el operador llega desde el
    // Catálogo de Materiales). Las rutas /admin/* quedan como alias para
    // preservar bookmarks y links externos. Se montan en publicRoutes para
    // que el redirect NO sea bloqueado por MenuGuard (un usuario de Calidad
    // que llega a la URL vieja debe poder redirigir aunque no tenga la ruta
    // /admin/* en su árbol de menús). El target /calidad/... sigue gateado
    // normalmente por MenuGuard.
    { path: "/admin/agregados", element: <RouteRedirect to="/calidad/catalogos/agregados" /> },
    { path: "/admin/agregados/nuevo", element: <RouteRedirect to="/calidad/catalogos/agregados/nuevo" /> },
    { path: "/admin/agregados/editar/:tipo/:id", element: <RouteRedirect to="/calidad/catalogos/agregados/editar/:tipo/:id" /> },
    { path: "/admin/cementos", element: <RouteRedirect to="/calidad/catalogos/cementos" /> },
    { path: "/admin/cementos/nuevo", element: <RouteRedirect to="/calidad/catalogos/cementos/nuevo" /> },
    { path: "/admin/cementos/editar/:id", element: <RouteRedirect to="/calidad/catalogos/cementos/editar/:id" /> },
    { path: "/admin/aditivos", element: <RouteRedirect to="/calidad/catalogos/aditivos" /> },
    { path: "/admin/aditivos/nuevo", element: <RouteRedirect to="/calidad/catalogos/aditivos/nuevo" /> },
    { path: "/admin/aditivos/editar/:id", element: <RouteRedirect to="/calidad/catalogos/aditivos/editar/:id" /> },
    { path: "/admin/fibras", element: <RouteRedirect to="/calidad/catalogos/fibras" /> },
    { path: "/admin/fibras/nuevo", element: <RouteRedirect to="/calidad/catalogos/fibras/nuevo" /> },
    { path: "/admin/fibras/editar/:id", element: <RouteRedirect to="/calidad/catalogos/fibras/editar/:id" /> },
];

// Standalone routes render WITHOUT navbar, topbar or auth
export const standaloneRoutes = [
];

export const protectedRoutes = [
    /* Set Estadístico (sesión 2026-05-09): Eficiencia del Cemento se
     * mueve bajo Calidad → Set Estadístico. Redirect desde la URL vieja.
     * CUSUM nueva. */
    { path: "/calidad/estadisticas/cusum", element: <CusumPage />, tabLabel: "CUSUM" },
    { path: "/reportes/eficiencia-cemento", element: <RouteRedirect to="/calidad/estadisticas/eficiencia-cemento" /> },
    // N-03 auditoría 08: informe de aceptación de obra/lote (CIRSOC §6.2).
    { path: "/reportes/aceptacion-lote", element: <InformeAceptacionLotePage />, tabLabel: "Aceptación obra" },
    { path: "/reportes/asentamientos", element: <ReporteAsentamientos />, tabLabel: "Asentamientos" },
    { path: "/reportes/aire", element: <ReporteAire />, tabLabel: "Aire" },
    { path: "/reportes/temperatura", element: <ReporteTemperatura />, tabLabel: "Temperatura" },
    { path: "/reportes/muestras-frescas", element: <ReportFresh />, tabLabel: "Muestras frescas" },
    { path: "/reportes/resistencias/edad-diseno", element: <ReporteResistencias />, tabLabel: "Resistencias" },
    { path: "/reportes/resistencias/reportes", element: <ReporteResistenciaFiles />, tabLabel: "Reportes resistencia" },
    { path: "/reportes/probetas", element: <ReportProbetas />, tabLabel: "Probetas" },
    /* Recursos MVP Fase D (2026-05-10): el listado de prensas se
       reemplaza por /calidad/laboratorio/equipos?tipo=PRENSA. El form de
       crear/editar prensa queda funcional para back-compat con
       bookmarks, pero ya no aparece en el menú. El hook PrensaHooks
       en backend sincroniza Prensa → EquipoLaboratorio en cada
       create/update para que ambas vistas queden coherentes. */
    { path: "/admin/prensas", element: <RouteRedirect to="/calidad/laboratorio/equipos?tipo=PRENSA" /> },
    { path: "/admin/prensas/nuevo", element: <PrensaForm modo="crear" />, tabLabel: "Nueva prensa" },
    { path: "/admin/prensas/editar/:id", element: <PrensaForm />, tabLabel: "Editar prensa" },
    // Sesión 2026-05-11 — Equipos movido del grupo Administrar al grupo Flota.
    // Rutas viejas /admin/equipos* redirigen a /flota/equipos* para no romper
    // bookmarks ni links internos. Migración 20260511m.
    { path: "/admin/equipos",            element: <RouteRedirect to="/flota/equipos" /> },
    { path: "/admin/equipos/nuevo",      element: <RouteRedirect to="/flota/equipos/nuevo" /> },
    { path: "/admin/equipos/editar/:id", element: <RouteRedirect to="/flota/equipos/editar/:id" /> },
    // Sesión 2026-05-27 — rutas canónicas movidas a /calidad/catalogos/{tipo}/*
    // para alinear con la jerarquía del Catálogo de Materiales del módulo
    // Calidad. Las URLs /admin/{tipo}/* siguen funcionando como redirect
    // (publicRoutes) para back-compat con bookmarks. Permisos: el operador
    // que accede al Catálogo de Materiales (/calidad/catalogos/materiales)
    // automáticamente puede crear/editar agregados/cementos/aditivos/fibras
    // porque comparten el prefijo /calidad/catalogos.
    { path: "/calidad/catalogos/agregados", element: <AdminAgregado />, tabLabel: "Agregados" },
    { path: "/calidad/catalogos/agregados/nuevo", element: <AgregadoForm modo="crear" />, tabLabel: "Nuevo agregado" },
    { path: "/calidad/catalogos/agregados/editar/:tipo/:id", element: <AgregadoForm />, tabLabel: "Editar agregado" },
    { path: "/calidad/catalogos/cementos", element: <AdminCemento />, tabLabel: "Cementos" },
    { path: "/calidad/catalogos/cementos/nuevo", element: <CementoForm modo="crear" />, tabLabel: "Nuevo cemento" },
    { path: "/calidad/catalogos/cementos/editar/:id", element: <CementoForm />, tabLabel: "Editar cemento" },
    { path: "/calidad/catalogos/aditivos", element: <AdminAditivo />, tabLabel: "Aditivos" },
    { path: "/calidad/catalogos/aditivos/nuevo", element: <AditivoForm modo="crear" />, tabLabel: "Nuevo aditivo" },
    { path: "/calidad/catalogos/aditivos/editar/:id", element: <AditivoForm />, tabLabel: "Editar aditivo" },
    { path: "/calidad/catalogos/fibras", element: <AdminFibra />, tabLabel: "Fibras" },
    { path: "/calidad/catalogos/fibras/nuevo", element: <FibraForm modo="crear" />, tabLabel: "Nueva fibra" },
    { path: "/calidad/catalogos/fibras/editar/:id", element: <FibraForm />, tabLabel: "Editar fibra" },
    { path: "/admin/dosificaciones", element: <AdminDosificacion />, tabLabel: "Dosificaciones" },
    { path: "/admin/dosificaciones/nueva", element: <DosificacionForm modo="crear" />, tabLabel: "Nueva dosificación" },
    { path: "/admin/dosificaciones/editar/:id", element: <DosificacionForm />, tabLabel: "Editar dosificación" },
    // Sesión 2026-05-11 — Mantenimiento (registro de actividades) movido a
    // Flota. URL vieja /admin/mantenimiento redirige para preservar bookmarks
    // y los openInTab(...) que tienen anchors (#checklists, #vencimientos-rto,
    // etc.). Migración 20260511m.
    { path: "/admin/mantenimiento", element: <RouteRedirect to="/flota/mantenimiento" /> },
    // Sesión 2026-05-11 — Categorías de archivos movido a Configuración.
    // URL vieja /admin/categorias/archivos redirige a /configuracion/categorias-archivos.
    // Migración 20260511t-mover-categorias-archivos-a-configuracion.
    { path: "/admin/categorias/archivos", element: <RouteRedirect to="/configuracion/categorias-archivos" /> },
    /* ───────── Muestras: ubicación canónica Calidad → Ensayos ─────────
     * Mismo movimiento que probetas (sesión 2026-05-09): el menú las
     * muestra bajo Calidad → Ensayos, así que las URLs físicas se alinean.
     * Redirects desde /produccion/muestras* preservan back-compat. */
    // Refactor 2026-05-20 — wrapper unificado con 3 tabs (Propias/Terceros/Pastones).
    { path: "/calidad/ensayos/muestras", element: <MuestrasPage />, tabLabel: "Muestras" },
    { path: "/calidad/ensayos/muestras/:modo/:id?", element: <MuestraFormStandalone />, tabLabel: "Muestra" },
    // Compat URL viejas — apuntan al wrapper que detecta el path para la tab inicial.
    { path: "/calidad/ensayos/muestras-terceros", element: <MuestrasPage />, tabLabel: "Muestras terceros" },
    { path: "/calidad/ensayos/muestras-terceros/:modo/:id?", element: <MuestraTercerosForm />, tabLabel: "Muestra terceros" },
    { path: "/calidad/ensayos/muestras-pastones", element: <MuestrasPage />, tabLabel: "Muestras de pastón" },
    /* Redirects de back-compat para muestras (path específico primero). */
    { path: "/produccion/muestras/:modo/:id?", element: <RouteRedirect to="/calidad/ensayos/muestras/:modo/:id?" /> },
    { path: "/produccion/muestras", element: <RouteRedirect to="/calidad/ensayos/muestras" /> },
    { path: "/produccion/muestras-terceros/:modo/:id?", element: <RouteRedirect to="/calidad/ensayos/muestras-terceros/:modo/:id?" /> },
    { path: "/produccion/muestras-terceros", element: <RouteRedirect to="/calidad/ensayos/muestras-terceros" /> },
    /* ───────── Probetas: ubicación canónica Calidad → Ensayos ─────────
     * Antes vivían en /produccion/probetas* — pero el menú las muestra
     * bajo Calidad → Ensayos. Para evitar desorientación al usuario
     * (especialmente porque el procedimiento operativo cita la ruta del
     * menú) las movimos a /calidad/ensayos/probetas* (sesión 2026-05-09).
     * Redirects desde la URL vieja debajo: bookmarks, links externos y
     * etiquetas QR viejas siguen funcionando. */
    // Refactor 2026-05-20 — el listado de probetas pasa a un wrapper con 3
    // tabs (Propias / Terceros / Pastones) que no remontan al cambiar.
    { path: "/calidad/ensayos/probetas", element: <ProbetasPage />, tabLabel: "Probetas" },
    { path: "/calidad/ensayos/probetas/proximas-a-romper", element: <ProximasARomperPage />, tabLabel: "Próximas a romper" },
    { path: "/calidad/ensayos/probetas/etiquetas-pendientes", element: <EtiquetasPendientesPage />, tabLabel: "Etiquetas pendientes" },
    { path: "/calidad/ensayos/probetas/etiquetado-doc", element: <EtiquetadoProbetasDocPage />, tabLabel: "Procedimiento etiquetas" },
    { path: "/calidad/ensayos/probetas/:modo/:id?", element: <ProbetaForm />, tabLabel: "Probeta" },
    // Compat URL vieja — redirige al wrapper con la tab Terceros activa.
    { path: "/calidad/ensayos/probetas-terceros", element: <ProbetasPage />, tabLabel: "Probetas terceros" },
    { path: "/calidad/ensayos/probetas-terceros/:modo/:id?", element: <ProbetaForm />, tabLabel: "Probeta terceros" },
    // N-01 (Bloque 22): URL corta del QR de etiquetas. NO se mueve — el
    // QR es agnóstico al menú y las etiquetas ya impresas dependen de él.
    { path: "/p/:id", element: <ProbetaQrRedirect />, tabLabel: "Probeta" },
    /* Redirects de back-compat (sesión 2026-05-09). El path más específico
     * primero porque react-router matchea por orden. Cualquier link viejo
     * cae en el redirect y mantiene query string + params. */
    { path: "/produccion/probetas/proximas-a-romper", element: <RouteRedirect to="/calidad/ensayos/probetas/proximas-a-romper" /> },
    { path: "/produccion/probetas/etiquetas-pendientes", element: <RouteRedirect to="/calidad/ensayos/probetas/etiquetas-pendientes" /> },
    { path: "/produccion/probetas/etiquetado-doc", element: <RouteRedirect to="/calidad/ensayos/probetas/etiquetado-doc" /> },
    { path: "/produccion/probetas/:modo/:id?", element: <RouteRedirect to="/calidad/ensayos/probetas/:modo/:id?" /> },
    { path: "/produccion/probetas", element: <RouteRedirect to="/calidad/ensayos/probetas" /> },
    { path: "/produccion/probetas-terceros/:modo/:id?", element: <RouteRedirect to="/calidad/ensayos/probetas-terceros/:modo/:id?" /> },
    { path: "/produccion/probetas-terceros", element: <RouteRedirect to="/calidad/ensayos/probetas-terceros" /> },
    { path: "/configuracion", element: <Settings />, tabLabel: "Configuración" },
    { path: "/configuracion/preferencias", element: <PreferenciasPage />, tabLabel: "Preferencias" },
    { path: "/admin/usuarios", element: <AdminUsers />, tabLabel: "Cuentas de usuario" },
    { path: "/admin/usuarios/nuevo", element: <UsersForm />, tabLabel: "Nuevo usuario" },
    { path: "/admin/usuarios/editar/:id", element: <UsersForm />, tabLabel: "Editar usuario" },

    // ── Calidad ──────────────────────────────────────────────────
    { path: "/calidad/revisiones-ensayos", element: <RevisionesEnsayo />, tabLabel: "Revisiones ensayos" },
    { path: "/calidad/revisiones-ensayos/revisar/:id", element: <RevisionEnsayoPage />, tabLabel: "Revision ensayo" },
    { path: "/calidad/placas-elastomero", element: <PlacasElastomeroPage />, tabLabel: "Placas de elastómero" },
    { path: "/calidad/revisiones-dosificaciones", element: <RevisionesDosificaciones />, tabLabel: "Revisiones dosificaciones" },
    { path: "/calidad/tablero",      element: <TableroCalidadPage />, tabLabel: "Tablero Calidad" },
    /* Sesión 2026-05-09: dashboard-planta fusionado al Tablero unificado.
     * Redirect agregando ?vista=planta para abrir directamente la pestaña
     * operativa por planta. Bookmarks viejos preservados. */
    { path: "/calidad/dashboard-planta", element: <RouteRedirect to="/calidad/tablero?vista=planta" /> },
    { path: "/calidad/catalogos",    element: <CatalogosHub />, tabLabel: "Catálogos" },
    { path: "/calidad/catalogos/materiales",           element: <MaterialList />,                tabLabel: "Materiales" },
    { path: "/calidad/catalogos/materiales/detalle/:source/:sourceId", element: <MaterialDetailPage />, tabLabel: "Detalle Material" },
    { path: "/calidad/catalogos/materiales/nuevo",     element: <MaterialForm />,                tabLabel: "Nuevo Material" },
    { path: "/calidad/catalogos/materiales/editar/:id", element: <MaterialForm />,               tabLabel: "Editar Material" },
    { path: "/calidad/catalogos/materiales/agua/nuevo",  element: <AguaForm />,                   tabLabel: "Nueva Agua" },
    { path: "/calidad/catalogos/materiales/agua/editar/:id", element: <AguaForm />,               tabLabel: "Editar Agua" },
    { path: "/calidad/catalogos/materiales/documentos/:materialDocumentoId/revision", element: <MaterialDocRevision />, tabLabel: "Revisión de Documento" },
    { path: "/calidad/catalogos/materiales/liviano/nuevo",     element: <MaterialLivianoForm />, tabLabel: "Nuevo material liviano" },
    { path: "/calidad/catalogos/materiales/liviano/editar/:id", element: <MaterialLivianoForm />, tabLabel: "Editar material liviano" },
    { path: "/calidad/catalogos/curvas",               element: <CurvaList />,    tabLabel: "Curvas Granulométricas" },
    { path: "/calidad/catalogos/curvas/nueva",          element: <CurvaForm />,    tabLabel: "Nueva Curva" },
    { path: "/calidad/catalogos/curvas/editar/:id",     element: <CurvaForm />,    tabLabel: "Editar Curva" },
    { path: "/calidad/catalogos/curvas/set/:id",        element: <CurvaSetDetail />, tabLabel: "Detalle Set" },
    { path: "/calidad/catalogos/normas",                  element: <NormasPage />,     tabLabel: "Normas" },
    { path: "/calidad/catalogos/evidencias-tecnicas",     element: <TechnicalEvidencePage />, tabLabel: "Evidencias técnicas" },
    { path: "/calidad/aprobaciones",                      element: <DocumentApprovalsPanel />, tabLabel: "Aprobaciones" },
    { path: "/calidad/catalogos/ensayos",                   element: <CatalogoEnsayosPage />, tabLabel: "Catálogo de ensayos" },
    { path: "/calidad/catalogos/mezclas",                    element: <MezclasCatalogoPage />, tabLabel: "Mezclas" },
    { path: "/calidad/catalogos/mezclas/:id",               element: <MezclaDetallePage />, tabLabel: "Detalle Mezcla" },
    { path: "/calidad/catalogos/dosificaciones",             element: <DosificacionesCatalogoPage />, tabLabel: "Dosificaciones" },
    { path: "/calidad/dosificaciones-comparar",              element: <DosificacionComparacionPage />, tabLabel: "Comparar dosificaciones" },
    { path: "/calidad/catalogos/parametros-motor",          element: <ParametrosMotorPage />, tabLabel: "Parámetros motor dosificación" },
    { path: "/calidad/catalogos/tipologias",               element: <TipologiasConfigPage />, tabLabel: "Tipologías de hormigón" },
    { path: "/calidad/catalogos/curvas-cemento",            element: <CurvaCementoPage />, tabLabel: "Curvas de cemento" },
    { path: "/calidad/catalogos/factor-ajuste-curva",      element: <FactorAjusteCurvaPage />, tabLabel: "Factor de ajuste de curva" },
    // Alias de back-compat: la ruta vieja /factor-ajuste-icpa sigue funcionando para bookmarks existentes.
    { path: "/calidad/catalogos/factor-ajuste-icpa",       element: <FactorAjusteCurvaPage />, tabLabel: "Factor de ajuste de curva" },
    { path: "/calidad/agregados/:legacyAgregadoId/ensayos", element: <AgregadoEnsayosPage />, tabLabel: "Ensayos Agregado" },
    { path: "/calidad/agua/:idAgua/ensayos",              element: <AguaEnsayosPage />,     tabLabel: "Ensayos Agua" },
    { path: "/calidad/diseno",       element: <MezclasPage />, tabLabel: "Diseño" },
    { path: "/calidad/dosificacion-diseno", element: <DosificacionDisenoPage />, tabLabel: "Diseño dosificación" },
    // CU8 — Informe técnico configurable + preview. `:id?` opcional: sin id la
    // pantalla ofrece un selector de dosificación; con id arranca sobre esa.
    { path: "/calidad/informes/:id?", element: <InformeConfigurablePage />, tabLabel: "Informes" },
    { path: "/calidad/control",      element: <ControlCalidadPage />, tabLabel: "Control" },
    { path: "/calidad/herramientas", element: <HerramientasPage />, tabLabel: "Herramientas" },
    { path: "/calidad/roles",        element: <RolesCalidadPage />, tabLabel: "Roles de Calidad" },
    // Sesión 2026-05-11 — placeholders para los 4 módulos sin gestión de
    // roles implementada todavía. La migración 20260511i-agrupar-roles-en-
    // configuracion agrega las entradas al menú; estas rutas resuelven a
    // <EnConstruccion> hasta que cada módulo implemente su pantalla real.
    // /produccion/roles → ya tiene página real (ver más arriba: RolesProduccionPage).
    // No agregar placeholder acá porque el orden gana y deja la pantalla en "En construcción".
    /* Laboratorio — MVP Fase B (sesión 2026-05-10) y modelo Laboratorio
       fase 1 (sesión 2026-05-12). Las pantallas viven bajo /calidad/laboratorio/.
       Las URLs viejas /calidad/recursos/... quedan como redirect por back-compat
       con bookmarks y links externos hasta que se considere seguro removerlas. */
    // Back-compat (bookmarks viejos).

    // ── CRM — seguimiento comercial de presupuestos ───────────────

];

export const appRoutes = [...publicRoutes, ...protectedRoutes];
