import React, { useEffect, useState } from "react";
import { Tag } from "primereact/tag";
import { obtenerAnalisisEficiencia } from "../../../services/dosificacionDisenoService";

const fmtNum = (v, d = 1) =>
  v != null ? Number(v).toLocaleString("es-AR", { minimumFractionDigits: d, maximumFractionDigits: d }) : "—";

/**
 * Panel de análisis de eficiencia para un pastón de prueba.
 * Consume GET /pastones/:id/analisis-eficiencia y muestra las métricas calculadas.
 */
export default function AnalisisEficienciaPanel({ idPastonPrueba }) {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (!idPastonPrueba || !expanded) return;
    if (data) return; // ya cargado
    setLoading(true);
    obtenerAnalisisEficiencia(idPastonPrueba)
      .then(setData)
      .catch(() => setData(null))
      .finally(() => setLoading(false));
  }, [idPastonPrueba, expanded, data]);

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(!expanded)}
        className="text-sm font-bold text-primary"
        style={{ background: "none", border: "none", cursor: "pointer", padding: "4px 0" }}
      >
        <i className={`fa-solid fa-${expanded ? "chevron-down" : "chevron-right"} mr-2`} />
        <i className="fa-solid fa-chart-line mr-1" />
        Análisis de eficiencia
      </button>

      {expanded && loading && (
        <div className="text-xs text-color-secondary p-2">
          <i className="fa-solid fa-spinner fa-spin mr-1" />Calculando...
        </div>
      )}

      {expanded && data && (
        <div className="surface-50 border-round p-3 mt-1">
          {/* Resumen */}
          <div className="grid text-xs mb-2">
            {data.resumen?.slumpInicial != null && (
              <div className="col-6 md:col-3">
                <div className="text-color-secondary">Slump inicial</div>
                <div className="font-bold text-lg">{data.resumen.slumpInicial} cm</div>
              </div>
            )}
            {data.resumen?.slumpFinal != null && (
              <div className="col-6 md:col-3">
                <div className="text-color-secondary">Slump final</div>
                <div className="font-bold text-lg">{data.resumen.slumpFinal} cm</div>
              </div>
            )}
            {data.resumen?.velocidadPerdidaActivaCmHora != null && (
              <div className="col-6 md:col-3">
                <div className="text-color-secondary" title="Promedio de las tasas de los tramos donde el slump efectivamente cayó. Útil para decidir cuándo redosear.">
                  Velocidad de pérdida activa
                </div>
                <div className="font-bold text-lg" style={{ color: "var(--red-600)" }}>
                  {fmtNum(data.resumen.velocidadPerdidaActivaCmHora, 1)} cm/h
                </div>
              </div>
            )}
            {data.resumen?.decaimientoNetoPromedioCmHora != null && (
              <div className="col-6 md:col-3">
                <div className="text-color-secondary" title="(Slump final − Slump inicial) / tiempo total. Mide la durabilidad neta del aditivo en el pastón.">
                  Decaimiento neto promedio
                </div>
                <div className="font-bold text-lg" style={{ color: data.resumen.decaimientoNetoPromedioCmHora < 0 ? "var(--red-600)" : "var(--green-600)" }}>
                  {fmtNum(data.resumen.decaimientoNetoPromedioCmHora, 1)} cm/h
                </div>
              </div>
            )}
            {data.resumen?.tiempoTotalMin != null && (
              <div className="col-6 md:col-3">
                <div className="text-color-secondary">Tiempo total</div>
                <div className="font-bold text-lg">{data.resumen.tiempoTotalMin} min</div>
              </div>
            )}
          </div>

          {/* Rendimiento por material */}
          {data.resumen?.rendimientoPromedioPorMaterial && Object.keys(data.resumen.rendimientoPromedioPorMaterial).length > 0 && (
            <div className="mb-2">
              <div className="text-xs font-bold mb-1">
                <i className="fa-solid fa-gauge-high mr-1 text-primary" />
                Rendimiento promedio por material
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--surface-300)" }}>
                    <th className="text-left py-1 px-2">Material</th>
                    <th className="text-right py-1 px-2">Rendimiento</th>
                    <th className="text-right py-1 px-2">Datos</th>
                  </tr>
                </thead>
                <tbody>
                  {Object.entries(data.resumen.rendimientoPromedioPorMaterial).map(([mat, d]) => (
                    <tr key={mat} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                      <td className="py-1 px-2 font-bold">{mat}</td>
                      <td className="text-right py-1 px-2">
                        <Tag value={`${d.promedio} ${d.unidad}`} severity="info" />
                      </td>
                      <td className="text-right py-1 px-2 text-color-secondary">{d.observaciones} acción(es)</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Detalle de acciones con efecto */}
          {data.accionesEficiencia?.filter(e => e.deltaSlumpMm != null).length > 0 && (
            <div className="mb-2">
              <div className="text-xs font-bold mb-1">
                <i className="fa-solid fa-flask mr-1 text-primary" />
                Acciones con efecto medido
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--surface-300)" }}>
                    <th className="text-left py-1 px-2">Material</th>
                    <th className="text-right py-1 px-2">Cantidad</th>
                    <th className="text-left py-1 px-2">Etapa</th>
                    <th className="text-right py-1 px-2">Antes</th>
                    <th className="text-right py-1 px-2">Después</th>
                    <th className="text-right py-1 px-2">Delta</th>
                    <th className="text-right py-1 px-2">Rendimiento</th>
                  </tr>
                </thead>
                <tbody>
                  {data.accionesEficiencia.filter(e => e.deltaSlumpMm != null).map((e, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                      <td className="py-1 px-2 font-bold">{e.material}</td>
                      <td className="text-right py-1 px-2">{fmtNum(e.cantidad, e.cantidad < 10 ? 2 : 1)} {e.unidad}</td>
                      <td className="py-1 px-2">
                        <Tag value={e.etapa} severity={e.etapa === "PLANTA" ? "warning" : e.etapa === "TRANSPORTE" ? "info" : "success"} />
                      </td>
                      <td className="text-right py-1 px-2">{fmtNum(e.slumpAntesMm / 10, 1)} cm</td>
                      <td className="text-right py-1 px-2">{fmtNum(e.slumpDespuesMm / 10, 1)} cm</td>
                      <td className="text-right py-1 px-2" style={{ color: e.deltaSlumpCm >= 0 ? "var(--green-600)" : "var(--red-600)", fontWeight: 600 }}>
                        {e.deltaSlumpCm > 0 ? "+" : ""}{fmtNum(e.deltaSlumpCm, 1)} cm
                      </td>
                      <td className="text-right py-1 px-2 font-bold text-primary">
                        {e.rendimientoLabel || "—"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Balance a/c */}
          {data.balanceAgua && (
            <div className="surface-100 border-round p-2 text-xs">
              <div className="font-bold mb-1">
                <i className="fa-solid fa-droplet mr-1" style={{ color: "var(--blue-500)" }} />
                Balance de agua y relación a/c
              </div>
              <div className="flex flex-wrap gap-4">
                <span>Dosificada: <strong>{fmtNum(data.balanceAgua.aguaDosificada, 1)} {data.balanceAgua.unidad}</strong></span>
                {data.balanceAgua.aguaAgregada > 0 && (
                  <span style={{ color: "var(--orange-500)" }}>Agregada: <strong>+{fmtNum(data.balanceAgua.aguaAgregada, 1)} {data.balanceAgua.unidad}</strong></span>
                )}
                <span>Real: <strong>{fmtNum(data.balanceAgua.aguaReal, 1)} {data.balanceAgua.unidad}</strong></span>
              </div>
              {data.balanceAgua.acDosificada != null && (
                <div className="flex gap-4 mt-1">
                  <span>a/c dosificada: <strong>{data.balanceAgua.acDosificada.toFixed(3)}</strong></span>
                  <span>a/c real: <strong>{data.balanceAgua.acReal.toFixed(3)}</strong></span>
                  <Tag
                    value={`${data.balanceAgua.deltaAc > 0 ? "+" : ""}${data.balanceAgua.deltaAc.toFixed(3)} ${data.balanceAgua.acOk ? "OK" : "ATENCIÓN"}`}
                    severity={data.balanceAgua.acOk ? "success" : "danger"}
                  />
                </div>
              )}
            </div>
          )}

          {/* Slump loss por tramo */}
          {data.slumpLoss?.length > 0 && (
            <div className="mt-2">
              <div className="text-xs font-bold mb-1">
                <i className="fa-solid fa-chart-area mr-1 text-primary" />
                Slump loss por tramo
              </div>
              <table className="w-full text-xs" style={{ borderCollapse: "collapse" }}>
                <thead>
                  <tr style={{ borderBottom: "1px solid var(--surface-300)" }}>
                    <th className="text-left py-1 px-2">Tramo</th>
                    <th className="text-right py-1 px-2">Delta</th>
                    <th className="text-right py-1 px-2">Tiempo</th>
                    <th className="text-right py-1 px-2">Tasa</th>
                    <th className="text-right py-1 px-2">T° H°</th>
                  </tr>
                </thead>
                <tbody>
                  {data.slumpLoss.map((t, i) => (
                    <tr key={i} style={{ borderBottom: "1px solid var(--surface-200)" }}>
                      <td className="py-1 px-2">
                        {fmtNum(t.desde.slumpMm / 10, 1)} → {fmtNum(t.hasta.slumpMm / 10, 1)} cm
                      </td>
                      <td className="text-right py-1 px-2" style={{ color: t.deltaSlumpMm < 0 ? "var(--red-600)" : "var(--green-600)", fontWeight: 600 }}>
                        {t.deltaSlumpMm > 0 ? "+" : ""}{fmtNum(t.deltaSlumpMm / 10, 1)} cm
                      </td>
                      <td className="text-right py-1 px-2">{fmtNum(t.deltaTiempoMin, 0)} min</td>
                      <td className="text-right py-1 px-2 text-color-secondary">
                        {t.tasaMmPorMin != null ? `${fmtNum(t.tasaMmPorMin * 6, 1)} cm/h` : "—"}
                      </td>
                      <td className="text-right py-1 px-2">{t.tempHormigon != null ? `${fmtNum(t.tempHormigon, 1)}°` : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {expanded && !loading && !data && (
        <div className="text-xs text-color-secondary p-2" style={{ fontStyle: "italic" }}>
          Sin datos suficientes para calcular eficiencia. Registre mediciones y acciones de agregado vinculadas.
        </div>
      )}
    </div>
  );
}
