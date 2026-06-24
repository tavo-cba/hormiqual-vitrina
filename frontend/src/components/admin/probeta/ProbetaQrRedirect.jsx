import React, { useEffect, useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { ProgressSpinner } from 'primereact/progressspinner';
import axios from 'axios';
import { config } from '../../../config/config';
import { useUserContext } from '../../../context/UserContext';
import { hasRole, ROLES } from '../../../lib/roles';
import { ESTADOS_NO_ENSAYABLES } from '../../../lib/constants/estadoProbeta';
import { parseProbetaIdFromCodigo } from '../../../lib/probetaCodigo';

/**
 * N-01 (auditoría 08, Bloque 22 + sesión 2026-05-09) — handler de la URL
 * `/p/:id` que codifica el QR de las etiquetas de probetas.
 *
 * Smart redirect según rol y estado de la probeta:
 *   - Usuario operativo (OPERADOR / RESPONSABLE / DIRECTOR_TECNICO / ADMIN)
 *     + probeta ensayable (cualquier estado salvo Descartada/Perdida, INCLUYE
 *     Curando) → directo a la pantalla de carga del ensayo (ProbetaForm modo
 *     "editar"). Es el caso del operario que escanea en pileta el día de la
 *     rotura: un escaneo, un click en "Guardar".
 *   - Estado terminal (Descartada/Perdida) o usuario sin permiso de carga →
 *     ficha de la probeta (consulta).
 *   - Si el fetch falla → fallback a la ruta legacy (`?detail=`) que muestra
 *     el dialog con el error.
 *
 * Actualizado (sesión 2026-06-02): antes sólo abría la carga si el estado era
 * PENDIENTE; ahora abre la carga en cualquier estado ensayable (Curando
 * incluido), porque nada flipea Curando→Pendiente al vencer la fecha.
 */
export default function ProbetaQrRedirect() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { user } = useUserContext();
  const [resolving, setResolving] = useState(true);

  useEffect(() => {
    // El QR puede traer el código `PRB-AAAA-NNNNNN` (etiquetas nuevas) o el
    // id numérico pelado (etiquetas ya impresas). Resolvemos a id numérico.
    const idProbeta = parseProbetaIdFromCodigo(id);
    if (!idProbeta) {
      navigate('/calidad/ensayos/probetas', { replace: true });
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${config.backendUrl}/api/probetas/${idProbeta}`,
          { headers: config.headers },
        );
        if (cancelled) return;

        const estado = data?.idEstadoProbeta ?? null;
        const esOperativo = hasRole(
          user,
          ROLES.OPERADOR, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN,
        );
        // Ensayable = cualquier estado salvo los terminales (Descartada /
        // Perdida). Incluye Curando: nada flipea Curando→Pendiente al vencer
        // la fecha de rotura, así que una probeta lista para romper suele
        // seguir figurando "Curando". Mismo criterio que `ProbetaForm`.
        const ensayable = estado != null && !ESTADOS_NO_ENSAYABLES.includes(estado);

        // Smart routing: el operario escanea el QR en pileta el día de la
        // rotura → abrimos directo la pantalla de carga del ensayo
        // (ProbetaForm en modo "editar", con el EnsayoForm embebido).
        if (esOperativo && ensayable) {
          navigate(`/calidad/ensayos/probetas/editar/${idProbeta}`, { replace: true });
          return;
        }
        // Estado terminal o usuario sin permiso de carga → ficha de la probeta.
        navigate(`/calidad/ensayos/probetas?detail=${idProbeta}`, { replace: true });
      } catch (err) {
        // Fallback al comportamiento previo: la pantalla de probetas
        // muestra el error en el dialog.
        if (!cancelled) {
          console.error('Error resolviendo probeta del QR:', err);
          navigate(`/calidad/ensayos/probetas?detail=${idProbeta}`, { replace: true });
        }
      } finally {
        if (!cancelled) setResolving(false);
      }
    })();
    return () => { cancelled = true; };
  }, [id, navigate, user]);

  return (
    <div className="flex justify-content-center align-items-center" style={{ minHeight: '60vh' }}>
      <ProgressSpinner />
      {!resolving && null}
    </div>
  );
}
