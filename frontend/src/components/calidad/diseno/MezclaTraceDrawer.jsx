import React, { useState } from "react";
import { Sidebar } from "primereact/sidebar";
import { TabView, TabPanel } from "primereact/tabview";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Tag } from "primereact/tag";
import { Accordion, AccordionTab } from "primereact/accordion";

/* ════════════════════════════════════════════════════════
   Severity helpers
   ════════════════════════════════════════════════════════ */
const METODO_COLORS = {
  REAL: "success",
  INTERPOLADO: "info",
  DEDUCIDO: "warning",
  EQUIV: "info",
  EXTRAPOLADO: "danger",
};

const ESTADO_COLORS = { DENTRO: "success", FUERA: "danger" };

/* ════════════════════════════════════════════════════════
   Tab: Tamices
   ════════════════════════════════════════════════════════ */
function TabTamices({ trazabilidad }) {
  const { tamices = [], tamicesResumen } = trazabilidad;
  return (
    <div className="flex flex-column gap-3">
      {tamicesResumen && (
        <div className="flex flex-wrap gap-2">
          <Tag value={`Total: ${tamicesResumen.total}`} severity="secondary" />
          {tamicesResumen.REAL > 0 && <Tag value={`Reales: ${tamicesResumen.REAL}`} severity="success" />}
          {tamicesResumen.INTERPOLADO > 0 && <Tag value={`Interpolados: ${tamicesResumen.INTERPOLADO}`} severity="info" />}
          {tamicesResumen.DEDUCIDO > 0 && <Tag value={`Deducidos: ${tamicesResumen.DEDUCIDO}`} severity="warning" />}
          {tamicesResumen.EQUIV > 0 && <Tag value={`Equivalentes: ${tamicesResumen.EQUIV}`} severity="info" />}
          {tamicesResumen.EXTRAPOLADO > 0 && <Tag value={`Extrapolados: ${tamicesResumen.EXTRAPOLADO}`} severity="danger" />}
        </div>
      )}
      <DataTable responsiveLayout="scroll" value={tamices} size="small" scrollable scrollHeight="400px" stripedRows>
        <Column field="tamiz" header="Tamiz" style={{ width: "100px" }} />
        <Column field="aberturaMm" header="Abertura (mm)" style={{ width: "100px" }} />
        <Column
          field="pasaMix"
          header="% Pasa mezcla"
          body={(row) => row.pasaMix != null ? row.pasaMix.toFixed(2) : "—"}
          style={{ width: "100px" }}
        />
        <Column
          field="fuenteMix"
          header="Fuente"
          body={(row) => row.fuenteMix ? <Tag value={row.fuenteMix} severity={METODO_COLORS[row.fuenteMix] || "secondary"} /> : "—"}
          style={{ width: "120px" }}
        />
        <Column field="observacion" header="Observación" />
      </DataTable>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Tab: Cálculos
   ════════════════════════════════════════════════════════ */
function TabCalculos({ trazabilidad }) {
  const { mixBreakdown = [], tmn, mf, banda, curvaTeorica } = trazabilidad;
  return (
    <div className="flex flex-column gap-2">
      <Accordion multiple>
        {/* Curva de mezcla breakdown */}
        <AccordionTab header="Curva de mezcla (desglose)">
          <p className="text-sm text-600 mt-0 mb-2">
            PASA_mezcla(tamiz) = Σ [ porcentaje_j × PASA_j(tamiz) ]
          </p>
          <DataTable responsiveLayout="scroll" value={mixBreakdown} size="small" scrollable scrollHeight="350px" stripedRows>
            <Column field="tamiz" header="Tamiz" frozen style={{ width: "80px" }} />
            {mixBreakdown[0]?.componentes?.map((c, j) => (
              <Column
                key={c.agregadoId}
                header={<span className="text-xs">{c.nombre}<br /><small>{c.porcentaje}%</small></span>}
                body={(row) => {
                  const comp = row.componentes[j];
                  if (!comp || comp.pasaAgregado == null) return "—";
                  return (
                    <span className="text-xs">
                      {comp.pasaAgregado.toFixed(1)}
                      <span className="text-400"> → {comp.aportePonderado?.toFixed(2)}</span>
                    </span>
                  );
                }}
                style={{ width: "110px" }}
              />
            ))}
            <Column
              field="pasaFinal"
              header="Final"
              body={(row) => row.pasaFinal != null ? <b>{row.pasaFinal.toFixed(2)}</b> : "—"}
              style={{ width: "80px" }}
            />
          </DataTable>
        </AccordionTab>

        {/* TMN */}
        <AccordionTab header={`TMN${tmn?.resultadoMm != null ? ` = ${tmn.resultadoMm} mm` : ""}`}>
          <p className="text-sm text-600 mt-0 mb-2">{tmn?.criterio}</p>
          <DataTable responsiveLayout="scroll" value={tmn?.candidatos || []} size="small" scrollable scrollHeight="300px" stripedRows>
            <Column field="tamiz" header="Tamiz" style={{ width: "100px" }} />
            <Column
              field="pasaPct"
              header="% Pasa"
              body={(row) => row.pasaPct != null ? row.pasaPct.toFixed(2) : "—"}
              style={{ width: "100px" }}
            />
            <Column
              field="cumple95"
              header="≥ 95%"
              body={(row) => (
                <Tag
                  value={row.cumple95 ? "SÍ" : "NO"}
                  severity={row.cumple95 ? "success" : "danger"}
                />
              )}
              style={{ width: "80px" }}
            />
          </DataTable>
        </AccordionTab>

        {/* MF */}
        <AccordionTab header={`Módulo de finura${mf?.resultado != null ? ` = ${mf.resultado}` : ""}`}>
          <p className="text-sm text-600 mt-0 mb-2">
            MF = Σ (% retenido acumulado en tamices estándar) / 100
          </p>
          <DataTable responsiveLayout="scroll" value={mf?.tamicesUsados || []} size="small" scrollable scrollHeight="300px" stripedRows>
            <Column field="aberturaMm" header="Abertura (mm)" style={{ width: "100px" }} />
            <Column
              field="pasaPct"
              header="% Pasa"
              body={(row) => row.pasaPct != null ? row.pasaPct.toFixed(2) : "—"}
              style={{ width: "100px" }}
            />
            <Column
              field="retenidoAcum"
              header="% Ret. acum."
              body={(row) => row.retenidoAcum != null ? row.retenidoAcum.toFixed(2) : "—"}
              style={{ width: "100px" }}
            />
            <Column
              field="disponible"
              header="Disponible"
              body={(row) => <Tag value={row.disponible ? "SÍ" : "NO"} severity={row.disponible ? "success" : "warning"} />}
              style={{ width: "80px" }}
            />
          </DataTable>
          {mf?.suma != null && (
            <p className="text-sm font-bold mt-2">Suma retenidos: {mf.suma} → MF = {mf.resultado}</p>
          )}
        </AccordionTab>

        {/* Banda normativa */}
        {banda?.evaluada && (
          <AccordionTab header="Banda normativa">
            <DataTable responsiveLayout="scroll" value={banda.rows} size="small" scrollable scrollHeight="300px" stripedRows>
              <Column field="tamiz" header="Tamiz" style={{ width: "90px" }} />
              <Column
                field="pasaMix"
                header="% Pasa"
                body={(row) => row.pasaMix != null ? row.pasaMix.toFixed(2) : "—"}
                style={{ width: "80px" }}
              />
              <Column field="limInf" header="Lím. inf." style={{ width: "80px" }} />
              <Column field="limSup" header="Lím. sup." style={{ width: "80px" }} />
              <Column
                field="estado"
                header="Estado"
                body={(row) => <Tag value={row.estado} severity={ESTADO_COLORS[row.estado] || "secondary"} />}
                style={{ width: "90px" }}
              />
              <Column
                field="desvio"
                header="Desvío"
                body={(row) => row.desvio != null && row.desvio !== 0 ? row.desvio.toFixed(2) : "—"}
                style={{ width: "80px" }}
              />
            </DataTable>
          </AccordionTab>
        )}

        {/* Curva teórica */}
        {curvaTeorica?.evaluada && (
          <AccordionTab header="Curva teórica">
            <DataTable responsiveLayout="scroll" value={curvaTeorica.rows} size="small" scrollable scrollHeight="300px" stripedRows>
              <Column field="aberturaMm" header="Abertura (mm)" style={{ width: "100px" }} />
              <Column
                field="pasaMix"
                header="% Pasa mezcla"
                body={(row) => row.pasaMix?.toFixed(2) ?? "—"}
                style={{ width: "100px" }}
              />
              <Column
                field="pasaObjetivo"
                header="% Pasa objetivo"
                body={(row) => row.pasaObjetivo?.toFixed(2) ?? "—"}
                style={{ width: "100px" }}
              />
              <Column
                field="errorAbsoluto"
                header="Error abs."
                body={(row) => row.errorAbsoluto?.toFixed(2) ?? "—"}
                style={{ width: "80px" }}
              />
            </DataTable>
          </AccordionTab>
        )}
      </Accordion>
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Tab: Optimización
   ════════════════════════════════════════════════════════ */
function TabOptimizacion({ trazabilidad, metricas }) {
  const opt = trazabilidad.optimizacion;
  if (!opt?.disponible) {
    return <p className="text-500">No se ha ejecutado una optimización aún.</p>;
  }

  return (
    <div className="flex flex-column gap-3">
      {/* Resumen */}
      <div className="surface-100 border-round p-3">
        <div className="flex flex-wrap gap-3">
          <div className="flex flex-column">
            <small className="text-500 font-bold">Método</small>
            <span>{opt.metodo || "—"}</span>
          </div>
          <div className="flex flex-column">
            <small className="text-500 font-bold">Factibilidad</small>
            <Tag value={opt.factibilidad} severity={opt.factibilidad === "FACTIBLE" ? "success" : "danger"} />
          </div>
          <div className="flex flex-column">
            <small className="text-500 font-bold">Exitosa</small>
            <span>{opt.exitosa ? "Sí" : "No"}</span>
          </div>
          {opt.comparableSievesCount != null && (
            <div className="flex flex-column">
              <small className="text-500 font-bold">Tamices comparables</small>
              <span>{opt.comparableSievesCount}</span>
            </div>
          )}
        </div>
        {opt.mensaje && <p className="text-sm mt-2 mb-0">{opt.mensaje}</p>}
      </div>

      {/* Rangos por agregado */}
      {opt.rangos?.length > 0 && (
        <div>
          <h4 className="text-sm font-bold mb-2">Rangos factibles por agregado</h4>
          <DataTable responsiveLayout="scroll" value={opt.rangos} size="small" stripedRows>
            <Column field="id" header="Agregado ID" style={{ width: "100px" }} />
            <Column
              field="optimalPct"
              header="% Óptimo"
              body={(row) => row.optimalPct != null ? `${row.optimalPct.toFixed(1)}%` : "—"}
              style={{ width: "90px" }}
            />
            <Column
              field="minPct"
              header="Mín %"
              body={(row) => row.minPct != null ? `${row.minPct.toFixed(1)}%` : "—"}
              style={{ width: "80px" }}
            />
            <Column
              field="maxPct"
              header="Máx %"
              body={(row) => row.maxPct != null ? `${row.maxPct.toFixed(1)}%` : "—"}
              style={{ width: "80px" }}
            />
          </DataTable>
        </div>
      )}

      {/* Métricas */}
      {metricas && (
        <div className="surface-100 border-round p-3">
          <h4 className="text-sm font-bold mt-0 mb-2">Métricas del resultado</h4>
          <div className="flex flex-wrap gap-3">
            {metricas.bandaCumple != null && (
              <div className="flex flex-column align-items-center">
                <small className="text-500 font-bold">Banda</small>
                <Tag value={metricas.bandaCumple ? "Cumple" : "No cumple"} severity={metricas.bandaCumple ? "success" : "danger"} />
              </div>
            )}
            {metricas.errorTeorico?.mae != null && (
              <div className="flex flex-column align-items-center">
                <small className="text-500 font-bold">MAE</small>
                <span className="font-bold">{metricas.errorTeorico.mae}</span>
              </div>
            )}
            {metricas.errorTeorico?.rmse != null && (
              <div className="flex flex-column align-items-center">
                <small className="text-500 font-bold">RMSE</small>
                <span className="font-bold">{metricas.errorTeorico.rmse}</span>
              </div>
            )}
            {metricas.errorTeorico?.maxDesvio != null && (
              <div className="flex flex-column align-items-center">
                <small className="text-500 font-bold">Max desvío</small>
                <span className="font-bold">{metricas.errorTeorico.maxDesvio}</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Debug (collapsed) */}
      {opt._debug && (
        <Accordion>
          <AccordionTab header="Debug técnico">
            <pre className="text-xs overflow-auto" style={{ maxHeight: 300 }}>
              {JSON.stringify(opt._debug, null, 2)}
            </pre>
          </AccordionTab>
        </Accordion>
      )}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Tab: Definiciones / Glosario
   ════════════════════════════════════════════════════════ */
const GLOSARIO = [
  { termino: "TMN", definicion: "Menor tamiz por el que pasa al menos el 95% del material." },
  { termino: "MF", definicion: "Indicador de finura global calculado a partir de retenidos acumulados en tamices estándar (150, 75, 37.5, 19, 9.5, 4.75, 2.36, 1.18, 0.6, 0.3, 0.15 mm). MF = Σ(%ret.acum.) / 100." },
  { termino: "MAE", definicion: "Promedio del error absoluto entre la mezcla y la curva objetivo en cada tamiz comparable." },
  { termino: "RMSE", definicion: "Error cuadrático medio. Penaliza más los desvíos grandes que el MAE." },
  { termino: "R²", definicion: "Coeficiente de determinación. Indica qué tan bien la mezcla se ajusta a la curva objetivo (1 = perfecto, <0 = peor que el promedio)." },
  { termino: "Factible", definicion: "Existe una solución que cumple todas las restricciones planteadas (suma=100%, rangos de %, banda normativa)." },
  { termino: "Banda", definicion: "Rango admisible entre un límite inferior y un límite superior para cada tamiz, según la norma o especificación elegida." },
  { termino: "Curva teórica", definicion: "Curva objetivo ideal (Fuller, Andreasen, MAA, etc.) usada como referencia para optimizar la compacidad o el ajuste granulométrico." },
  { termino: "Interpolado", definicion: "Valor de % pasa obtenido por interpolación log-lineal entre dos tamices adyacentes con datos reales." },
  { termino: "Deducido", definicion: "Valor deducido por saturación: si el material pasa 100% en un tamiz, todos los tamices mayores también pasan 100%." },
  { termino: "Equivalente", definicion: "Tamiz usado en reemplazo de otro equivalente (ej. 13.2 ↔ 12.5, 25 ↔ 26.5, 50 ↔ 53)." },
];

function TabDefiniciones() {
  return (
    <div className="flex flex-column gap-2">
      {GLOSARIO.map((g) => (
        <div key={g.termino} className="surface-100 border-round p-3">
          <span className="font-bold text-primary mr-2">{g.termino}</span>
          <span className="text-sm">{g.definicion}</span>
        </div>
      ))}
    </div>
  );
}

/* ════════════════════════════════════════════════════════
   Main Drawer
   ════════════════════════════════════════════════════════ */
export default function MezclaTraceDrawer({ visible, onHide, trazabilidad, metricas }) {
  const [activeTab, setActiveTab] = useState(0);

  const hasTrazabilidad = trazabilidad && (trazabilidad.tamices?.length > 0 || trazabilidad.mixBreakdown?.length > 0);

  return (
    <Sidebar
      visible={visible}
      onHide={onHide}
      position="right"
      style={{ width: "55vw", minWidth: 420, maxWidth: 900 }}
      header={
        <div className="flex align-items-center gap-2">
          <i className="fa-solid fa-magnifying-glass-chart text-primary" />
          <span className="font-bold text-lg">Trazabilidad del cálculo</span>
        </div>
      }
    >
      {!hasTrazabilidad ? (
        <div className="flex flex-column align-items-center justify-content-center" style={{ minHeight: 200 }}>
          <i className="fa-solid fa-circle-info text-4xl text-400 mb-3" />
          <p className="text-500">No hay trazabilidad disponible para este cálculo.</p>
        </div>
      ) : (
        <TabView activeIndex={activeTab} onTabChange={(e) => setActiveTab(e.index)}>
          <TabPanel header="Tamices">
            <TabTamices trazabilidad={trazabilidad} />
          </TabPanel>
          <TabPanel header="Cálculos">
            <TabCalculos trazabilidad={trazabilidad} />
          </TabPanel>
          <TabPanel header="Optimización">
            <TabOptimizacion trazabilidad={trazabilidad} metricas={metricas} />
          </TabPanel>
          <TabPanel header="Definiciones">
            <TabDefiniciones />
          </TabPanel>
        </TabView>
      )}
    </Sidebar>
  );
}
