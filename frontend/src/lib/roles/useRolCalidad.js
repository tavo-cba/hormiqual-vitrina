import { useMemo } from 'react';
import { useUserContext } from '../../context/UserContext';
import {
    ROLES_CALIDAD,
    ACCIONES,
    rolCalidadDe,
    tieneRolMinimo,
    puedeAccionCalidad,
} from './calidadGates';

/**
 * useRolCalidad — hook para que componentes lean el rol de Calidad del user
 * actual y consulten gates por acción.
 *
 * Uso típico (mostrar/ocultar botón Aprobar):
 *
 *   const { puedeAprobarDosificacion } = useRolCalidad();
 *   if (puedeAprobarDosificacion({ idMenuDosificaciones }).allowed) {
 *       return <Button label="Aprobar" onClick={...} />;
 *   }
 *
 * IMPORTANTE: la verdad sigue siendo el backend. Si alguien manipula el JSON
 * del estado en el navegador, el endpoint le devuelve 403. Este hook es
 * para UX (no mostrar botones sin sentido), no para seguridad.
 */
export function useRolCalidad() {
    const { user } = useUserContext();

    return useMemo(() => {
        const rol = rolCalidadDe(user);
        const isAdmin = !!(user?.isAdmin || user?.permissions?.esAdmin);

        const can = (accion, ctx = {}) => puedeAccionCalidad(user, accion, ctx);

        return {
            user,
            rol,
            isAdmin,
            esResponsableOrSuperior: tieneRolMinimo(user, ROLES_CALIDAD.RESPONSABLE_CALIDAD),
            esDirectorTecnico: tieneRolMinimo(user, ROLES_CALIDAD.DIRECTOR_TECNICO),
            puede: can,
            puedeAprobarDosificacion:    (ctx) => can(ACCIONES.APROBAR_DOSIFICACION, ctx),
            puedeSuspenderDosificacion:  (ctx) => can(ACCIONES.SUSPENDER_DOSIFICACION, ctx),
            puedeArchivarDosificacion:   (ctx) => can(ACCIONES.ARCHIVAR_DOSIFICACION, ctx),
            puedeAprobarPaston:          (ctx) => can(ACCIONES.APROBAR_PASTON_PRODUCCION, ctx),
            puedeEditarParametrosPlanta: (ctx) => can(ACCIONES.EDITAR_PARAMETROS_PLANTA, ctx),
            puedeEmitirCertificado:      (ctx) => can(ACCIONES.EMITIR_CERTIFICADO, ctx),
            puedeFirmarCertificado:      (ctx) => can(ACCIONES.FIRMAR_CERTIFICADO, ctx),
        };
    }, [user]);
}
