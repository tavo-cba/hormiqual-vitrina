import React, { useEffect, useState, useCallback } from "react";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { verificarAptitudMateriales } from "../../../services/dosificacionDisenoService";
import {
  CATEGORIA_COLORS,
  VEREDICTO,
  getCategoriaVeredicto,
  fromLegacyEval,
} from "../../../lib/compliance";

/**
 * AptitudMaterialesPanel — verificación CIRSOC §3.2.3.3 Tabla 3.4 sobre
 * los materiales de la dosificación.
 *
 * Prompt 3 C5 — migración a categorías visuales canónicas:
 *   - ESTADO_ICON local eliminado: cada item se mapea a una de las 7 categorías
 *     vía `getCategoriaVeredicto`. Si el item trae `compliance.status`
 *     (post-C7 backend de Prompt 2), ese manda; sino fallback a
 *     `fromLegacyEval(item)` o al `estado` legacy del item.
 *   - GLOBAL_TAG local eliminado: el resultado global del verif lo mapeamos
 *     desde `verif.compliance` (post-C7) o desde `resultadoGlobal` legacy.
 *
 * Hybrid Option B activo: items en passWithObservations / conditionalPass
 * canónicos se ven como "APTO CON OBSERVACIONES" / "APTITUD CONDICIONADA",
 * NO aplastados a "Cumple" o "No cumple".
 */

const fmtDate = (d) => d ? new Date(d).toLocaleDateString("es-AR") : null;

/** Mapeo del vocabulario `estado` de items (aptitud backend) → categoría canónica.
 * Usado solo cuando el item NO trae `compliance` canónico. */
function resolveCategoriaEstadoLegacy(estado, informativo) {
  switch (estado) {
    case 'cumple':              return informativo ? VEREDICTO.INFORMATIVO : VEREDICTO.APTO;
    case 'atencion':
    case 'cumple_con_atencion': return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'cumple_condicional':  return VEREDICTO.APTITUD_CONDICIONADA;
    case 'no_cumple':           return VEREDICTO.NO_APTO;
    case 'sin_dato':            return VEREDICTO.EVALUACION_INCOMPLETA;
    case 'informativo':         return VEREDICTO.INFORMATIVO;
    case 'excepcion':           return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'pendiente':           return VEREDICTO.EVALUACION_INCOMPLETA;
    default:                    return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

/** Mapeo del `resultadoGlobal` legacy de la verificación → categoría canónica. */
function resolveCategoriaResultadoGlobal(resultado) {
  switch (resultado) {
    case 'cumple':              return VEREDICTO.APTO;
    case 'cumple_con_atencion': return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'cumple_condicional':  return VEREDICTO.APTITUD_CONDICIONADA;
    case 'no_cumple':           return VEREDICTO.NO_APTO;
    case 'incompleto':          return VEREDICTO.EVALUACION_INCOMPLETA;
    default:                    return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

/**
 * Decide la categoría visual de un item de la verificación. Preferencias:
 *   1. `item.compliance.status` canónico (post-C7).
 *   2. `fromLegacyEval(item)` si el item trae shape legacy completo.
 *   3. Mapeo desde `item.estado` directo.
 */
function resolveCategoriaItem(item) {
  if (!item) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (item.compliance?.status) return getCategoriaVeredicto(item.compliance);
  if (item.cumple || item.estado) return getCategoriaVeredicto(fromLegacyEval(item));
  return resolveCategoriaEstadoLegacy(item.estado, item.informativo);
}

/**
 * Decide la categoría del veredicto global de una verificación.
 * Prefiere `verif.compliance` canónico (C7); fallback a resultadoGlobal legacy.
 */
function resolveCategoriaVerifGlobal(verif) {
  if (!verif) return VEREDICTO.EVALUACION_INCOMPLETA;
  if (verif.compliance?.status) return getCategoriaVeredicto(verif.compliance);
  return resolveCategoriaResultadoGlobal(verif.resultadoGlobal);
}

const AptitudMaterialesPanel = ({ dosifId }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const fetchAptitud = useCallback(async () => {
    if (!dosifId) return;
    setLoading(true);
    setError(null);
    try {
      const result = await verificarAptitudMateriales(dosifId);
      setData(result);
    } catch (err) {
      setError(err?.response?.data?.error || "Error al verificar aptitud");
    } finally {
      setLoading(false);
    }
  }, [dosifId]);

  useEffect(() => { fetchAptitud(); }, [fetchAptitud]);

  if (!dosifId) return null;

  return (
    <div className="card mt-3">
      <div className="flex align-items-center justify-content-between mb-3">
        <h3 className="m-0">
          <i className="fa-solid fa-clipboard-check mr-2 text-primary" />
          Aptitud de materiales
        </h3>
        <Button
          icon="pi pi-refresh"
          className="p-button-text p-button-sm"
          onClick={fetchAptitud}
          loading={loading}
          tooltip="Actualizar verificación"
          tooltipOptions={{ position: "left" }}
        />
      </div>

      <small className="block text-color-secondary mb-3">
        Verificación según CIRSOC 200-2024 §3.2.3.3 Tabla 3.4
      </small>

      {error && (
        <div className="p-3 border-round surface-100 text-sm text-color-secondary mb-3">
          <i className="fa-solid fa-exclamation-triangle text-orange-500 mr-2" />
          {error}
        </div>
      )}

      {loading && !data && (
        <div className="p-3 text-sm text-color-secondary">
          <i className="fa-solid fa-spinner fa-spin mr-2" />
          Verificando aptitud...
        </div>
      )}

      {data && data.aplicaCirsoc === false && (
        <div className="p-3 border-round surface-100 text-sm">
          <i className="fa-solid fa-circle-info text-primary mr-2" />
          La verificación de aptitud según CIRSOC 200 (Tablas 3.4/3.6) <strong>no aplica</strong> para esta tipología (HRDC).
          {data.motivo && <small className="block mt-1 text-color-secondary">{data.motivo}</small>}
        </div>
      )}

      {data && data.aplicaCirsoc !== false && data.verificaciones?.map((verif) => {
        const catGlobal = resolveCategoriaVerifGlobal(verif);
        const cfgGlobal = CATEGORIA_COLORS[catGlobal];

        return (
          <div key={verif.agregadoId} className="mb-3">
            <div className="flex align-items-center gap-2 mb-2">
              <i className="fa-solid fa-mountain text-color-secondary" />
              <span className="font-bold text-sm">{verif.agregadoNombre}</span>
              <Tag value={catGlobal} severity={cfgGlobal.severity} icon={cfgGlobal.icon} className="text-xs" />
            </div>

            <table className="w-full text-sm" style={{ borderCollapse: "collapse" }}>
              <thead>
                <tr style={{ borderBottom: "2px solid var(--surface-300)" }}>
                  <th className="text-left py-1 px-2" style={{ width: "35%" }}>Sustancia</th>
                  <th className="text-right py-1 px-2" style={{ width: "15%" }}>Límite</th>
                  <th className="text-right py-1 px-2" style={{ width: "15%" }}>Resultado</th>
                  <th className="text-center py-1 px-2" style={{ width: "10%" }}>Estado</th>
                  <th className="text-right py-1 px-2" style={{ width: "25%" }}>Fecha / Informe</th>
                </tr>
              </thead>
              <tbody>
                {verif.items.map((item) => {
                  const cat = resolveCategoriaItem(item);
                  const cfg = CATEGORIA_COLORS[cat];
                  const limiteText = item.informativo
                    ? "—"
                    : item.cualitativo
                    ? `< ${item.max} ${item.unidad}`
                    : item.max != null
                    ? `≤ ${item.max.toLocaleString("es-AR")} ${item.unidad}`
                    : "—";
                  const valorText = item.valor != null ? `${item.valor} ${item.unidad || ""}`.trim() : "—";

                  return (
                    <tr key={item.key} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                      <td className="py-1 px-2">
                        {item.parametro}
                        {item.condicion && (
                          <small className="block text-xs text-color-secondary" title={item.condicion}>
                            {item.condicion.length > 50 ? item.condicion.slice(0, 50) + "..." : item.condicion}
                          </small>
                        )}
                      </td>
                      <td className="text-right py-1 px-2 text-color-secondary">{limiteText}</td>
                      <td className="text-right py-1 px-2 font-bold">{valorText}</td>
                      <td className="text-center py-1 px-2">
                        <i className={cfg.icon} style={{ color: cfg.hex }} title={cat} />
                      </td>
                      <td className="text-right py-1 px-2 text-xs text-color-secondary">
                        {fmtDate(item.fecha)}
                        {item.informe && ` · ${item.informe}`}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>

            {verif.notas?.length > 0 && (
              <div className="mt-2 surface-100 border-round p-2">
                {verif.notas.map((n, i) => (
                  <small key={i} className="block text-xs text-color-secondary">
                    <i className="fa-solid fa-info-circle mr-1" />{n}
                  </small>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {data && !data.verificaciones?.length && (
        <div className="p-3 text-sm text-color-secondary">
          No hay agregados finos en la mezcla para verificar.
        </div>
      )}
    </div>
  );
};

export default AptitudMaterialesPanel;
