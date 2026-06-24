import { useMemo } from 'react';
import { hasRole, ROLES } from './index';

/**
 * Tabla central de acciones del sistema y los roles que pueden ejecutarlas.
 *
 * Esta tabla es el espejo del gating del backend en
 * `hormiqual-backend/src/routes/*` (Fase 1 RBAC). Mantenerlas alineadas:
 * si una acción cambia su lista de roles permitidos, hay que actualizar
 * ambos lados. El backend es la fuente de verdad — esto solo evita mostrar
 * botones que el servidor rebotaría con 403.
 *
 * Filosofía: jerarquía prescriptiva. La flexibilidad para empresas chicas
 * viene de asignar varios roles a una persona (en `Administrar → Cuentas
 * de usuario`), NO de relajar lo que cada rol puede hacer.
 *
 * Convención de nombres: `dominio.accion` en minúsculas, separado por punto.
 */

const ROLES_OPERATIVOS = [
  ROLES.OPERADOR,
  ROLES.RESPONSABLE,
  ROLES.DIRECTOR_TECNICO,
  ROLES.ADMIN,
];
const ROLES_CATALOGO = [ROLES.RESPONSABLE, ROLES.ADMIN];
const ROLES_APROBACION = [ROLES.RESPONSABLE, ROLES.ADMIN];

const ACCIONES = Object.freeze({
  // Dosificaciones — operación de diseño y cálculo
  'dosif.ver':                ROLES_OPERATIVOS,
  'dosif.crear':              ROLES_OPERATIVOS,
  'dosif.editar':             ROLES_OPERATIVOS,
  'dosif.calcular':           ROLES_OPERATIVOS,
  'dosif.guardar':            ROLES_OPERATIVOS,
  'dosif.crearVersion':       ROLES_OPERATIVOS,
  'dosif.nuevaRondaPrueba':   ROLES_OPERATIVOS,
  'dosif.exportarPDF':        ROLES_OPERATIVOS,

  // Dosificaciones — transiciones de estado críticas (jerarquía dura)
  'dosif.enviarRevision':     ROLES_APROBACION,
  'dosif.aprobarRevision':    ROLES_APROBACION,
  'dosif.rechazarRevision':   ROLES_APROBACION,
  'dosif.aprobarProduccion':  ROLES_APROBACION,
  'dosif.suspender':          ROLES_APROBACION,
  'dosif.reactivar':          ROLES_APROBACION,
  'dosif.archivar':           ROLES_APROBACION,
  'dosif.descartar':          ROLES_APROBACION,

  // Dosificaciones — destructivo
  'dosif.eliminar':           [ROLES.ADMIN],

  // Pastones, correcciones, redosificaciones (operación técnica)
  'paston.crear':             ROLES_OPERATIVOS,
  'paston.editar':            ROLES_OPERATIVOS,
  'paston.eliminar':          ROLES_OPERATIVOS,
  'medicion.registrar':       ROLES_OPERATIVOS,
  'correccion.aplicar':       ROLES_OPERATIVOS,
  'redosificacion.registrar': ROLES_OPERATIVOS,

  // Override de pastón (Fase 3) — cualquier rol con autoridad puede firmar.
  // Si en el tenant hay DT, la UI sugiere su firma; si no hay, el aprobador
  // firma con confirmación explícita y queda destacado en auditoría.
  'paston.overrideFirmar':    [ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN],

  // Catálogos del tenant (curvas, tablas normativas, materiales-planta)
  'catalogo.ver':             ROLES_OPERATIVOS,
  'catalogo.crear':           ROLES_CATALOGO,
  'catalogo.editar':          ROLES_CATALOGO,
  'catalogo.eliminar':        ROLES_CATALOGO,
  'catalogo.vincular':        ROLES_CATALOGO,

  // Alertas técnicas
  'alerta.ver':               ROLES_OPERATIVOS,
  'alerta.resolver':          ROLES_OPERATIVOS,

  // Administración de usuarios (Fase 6)
  'admin.gestionarUsuarios':  [ROLES.ADMIN],
  'admin.gestionarRoles':     [ROLES.ADMIN],

  // Probetas — gestión individual y vinculación con ensayos
  'probeta.ver':              ROLES_OPERATIVOS,
  'probeta.crear':            ROLES_OPERATIVOS,
  'probeta.editar':           ROLES_OPERATIVOS,
  'probeta.anular':           ROLES_APROBACION,  // Mej-16 — con motivo + trazabilidad
  'probeta.eliminar':         [ROLES.ADMIN],     // DELETE físico, sólo Admin

  // Muestras — alta, edición, confirmación con número de lote, baja
  'muestra.ver':              ROLES_OPERATIVOS,
  'muestra.crear':            ROLES_OPERATIVOS,
  'muestra.editar':           ROLES_OPERATIVOS,
  'muestra.confirmar':        ROLES_OPERATIVOS,
  'muestra.eliminar':         ROLES_APROBACION,

  // Ensayos de resistencia — carga (operativa), aprobación (jerárquica), PDF
  'ensayo.crear':             ROLES_OPERATIVOS,
  'ensayo.editar':            ROLES_OPERATIVOS,
  'ensayo.aprobar':           ROLES_APROBACION,
  'ensayo.aprobarMasivo':     ROLES_APROBACION,
  // Sprint 2 (sesión 2026-05-10) — aprobación masiva CON DESVÍOS sube
  // a DT. Si el lote incluye ensayos rojos/naranjas/indeterminados, el
  // RC no alcanza — solo DT puede firmarlo. Mismo gate que en backend
  // (calidadGates.ACCIONES.APROBAR_ENSAYO_MASIVO_CON_DESVIOS).
  'ensayo.aprobarMasivoConDesvios': [ROLES.DIRECTOR_TECNICO, ROLES.ADMIN],
  // Desaprobar requiere DT general, pero el service permite también al
  // RC firmante original (gate especial puedeDesaprobarEnsayo). El UI
  // muestra el botón si el user es DT/Admin O si idAprobadoPor coincide
  // con su idEmpleado — eso se chequea en la pantalla, no acá.
  'ensayo.desaprobar':        [ROLES.DIRECTOR_TECNICO, ROLES.ADMIN, ROLES.RESPONSABLE],
  'ensayo.exportarPDF':       ROLES_OPERATIVOS,
  // Cambiar el toggle "aprobación automática" requiere DT (afecta el
  // protocolo de control de calidad, IRAM 1666 §A.7 segregación de
  // funciones).
  'config.aprobacionAutomatica': [ROLES.DIRECTOR_TECNICO, ROLES.ADMIN],
});

/**
 * Devuelve la lista de roles permitidos para una acción. Útil para
 * mostrar mensajes de UX explicativos ("Esta acción requiere rol X").
 */
export function rolesParaAccion(accion) {
  return ACCIONES[accion] || [];
}

/**
 * Lista todas las acciones definidas. Útil para tests y para una pantalla
 * de auditoría de permisos por rol (Fase 6).
 */
export function listarAcciones() {
  return Object.keys(ACCIONES);
}

/**
 * Hook React que devuelve un predicado `can(accion)` cerrado sobre el
 * usuario actual. Memoizado por user para evitar recomputar en cada render.
 *
 * Uso:
 *   const can = useCanPerform(user);
 *   {can('dosif.aprobarProduccion') && <Button>Aprobar</Button>}
 *
 * Si `accion` no existe en la tabla → false (fail-closed). Esto detecta
 * typos en tiempo de QA en lugar de mostrar botones de manera silenciosa.
 */
export function useCanPerform(user) {
  return useMemo(() => {
    return (accion) => {
      const rolesPermitidos = ACCIONES[accion];
      if (!rolesPermitidos || rolesPermitidos.length === 0) {
        if (process.env.NODE_ENV === 'development') {
          // eslint-disable-next-line no-console
          console.warn(`[useCanPerform] Acción "${accion}" no está en la tabla.`);
        }
        return false;
      }
      return hasRole(user, ...rolesPermitidos);
    };
  }, [user]);
}

export default useCanPerform;
