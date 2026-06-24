import React, { useEffect, useState, useMemo } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { Chart } from "primereact/chart";
import { Message } from "primereact/message";
import { getPreciosVigentesBulk } from "../../../services/materialPrecioService";
import { calcularCostosDosificacion, agruparCostosPorTipo } from "./costosUtils";

const formatCurrency = (val) => {
  if (val == null) return "-";
  return Number(val).toLocaleString("es-AR", { style: "currency", currency: "ARS", maximumFractionDigits: 0 });
};

const PIE_COLORS = ["#2563eb", "#f59e0b", "#10b981", "#ef4444", "#8b5cf6", "#06b6d4", "#ec4899"];

/**
 * CostosSection — displayed below dosification result when prices exist.
 *
 * Props:
 *  - resultado: the dosification result object
 *  - contexto: { cementoId, cementoLabel, adiciones: [{ sourceId, label }], aditivos: [{ sourceId, label }] }
 *  - visible: whether the section should render
 */
export default function CostosSection({ resultado, contexto }) {
  const [preciosMap, setPreciosMap] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  // Build the list of materials to fetch prices for
  const materialesParaPrecios = useMemo(() => {
    if (!resultado || !contexto) return [];
    const list = [];

    // Cemento
    if (contexto.cementoId) {
      list.push({ materialSource: "cemento", materialSourceId: contexto.cementoId });
    }

    // Adiciones
    (contexto.adiciones || []).forEach(ad => {
      if (ad.sourceId) list.push({ materialSource: "adicion", materialSourceId: ad.sourceId });
    });

    // Aditivos
    (contexto.aditivos || []).forEach(ad => {
      if (ad.sourceId) list.push({ materialSource: "aditivo", materialSourceId: ad.sourceId });
    });

    // Agregados
    if (resultado.agregados) {
      resultado.agregados.forEach(ag => {
        if (ag.idAgregado) list.push({ materialSource: "agregado", materialSourceId: ag.idAgregado });
      });
    }

    return list;
  }, [resultado, contexto]);

  // Fetch prices
  useEffect(() => {
    if (materialesParaPrecios.length === 0) {
      setPreciosMap(null);
      return;
    }

    let cancelled = false;
    setLoading(true);
    setError(null);

    getPreciosVigentesBulk(materialesParaPrecios)
      .then(data => { if (!cancelled) setPreciosMap(data); })
      .catch(err => {
        console.error("Error fetching prices:", err);
        if (!cancelled) setError("No se pudieron cargar los precios");
      })
      .finally(() => { if (!cancelled) setLoading(false); });

    return () => { cancelled = true; };
  }, [materialesParaPrecios]);

  // Calculate costs
  const costos = useMemo(() => {
    if (!preciosMap || !resultado) return null;
    return calcularCostosDosificacion(resultado, preciosMap, contexto);
  }, [preciosMap, resultado, contexto]);

  // Check if we have any prices at all
  const hasAnyPrices = preciosMap && Object.keys(preciosMap).length > 0;

  // Pie chart data
  const pieData = useMemo(() => {
    if (!costos || costos.totalMateriales === 0) return null;
    const groups = agruparCostosPorTipo(costos.items);
    return {
      labels: groups.map(g => g.label),
      datasets: [{
        data: groups.map(g => g.value),
        backgroundColor: PIE_COLORS.slice(0, groups.length),
      }],
    };
  }, [costos]);

  const pieOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: "right", labels: { font: { size: 11 } } },
      tooltip: {
        callbacks: {
          label: (ctx) => {
            const val = ctx.raw;
            const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
            const pct = total > 0 ? ((val / total) * 100).toFixed(1) : 0;
            return `${ctx.label}: ${formatCurrency(val)} (${pct}%)`;
          },
        },
      },
    },
  };

  // Don't render if no result
  if (!resultado) return null;

  // No prices loaded at all
  if (!loading && !hasAnyPrices) {
    return (
      <div className="surface-50 border-round p-3 mt-3">
        <Message
          severity="info"
          text="No hay precios cargados para los materiales de esta dosificación."
          className="w-full justify-content-start"
        />
      </div>
    );
  }

  if (loading) {
    return (
      <div className="surface-50 border-round p-3 mt-3">
        <i className="pi pi-spin pi-spinner mr-2" />
        Cargando precios...
      </div>
    );
  }

  if (error) {
    return (
      <div className="surface-50 border-round p-3 mt-3">
        <Message severity="error" text={error} className="w-full justify-content-start" />
      </div>
    );
  }

  if (!costos) return null;

  return (
    <div className="mt-4">
      <h4 className="mb-2 flex align-items-center gap-2">
        <i className="fa-solid fa-coins" />
        Costos por m³
      </h4>

      {/* Warning for partial prices */}
      {costos.missingPrecios.length > 0 && (
        <Message
          severity="warn"
          className="w-full mb-2 justify-content-start"
          text={`Costo parcial \u2014 faltan precios para: ${costos.missingPrecios.join(", ")}.`}
        />
      )}

      <div className="flex gap-3 flex-wrap">
        {/* Cost table */}
        <div className="flex-1" style={{ minWidth: "400px" }}>
          <DataTable responsiveLayout="scroll"
            value={costos.items.filter(i => i.subtotal != null)}
            size="small"
            stripedRows
            footer={
              <div className="flex flex-column gap-1">
                <div className="flex justify-content-between font-bold">
                  <span>TOTAL MATERIALES</span>
                  <span>{formatCurrency(costos.totalMateriales)}</span>
                </div>
                {costos.totalFlete > 0 && (
                  <>
                    <div className="flex justify-content-between text-color-secondary">
                      <span>Flete (agregados)</span>
                      <span>{formatCurrency(costos.totalFlete)}</span>
                    </div>
                    <div className="flex justify-content-between font-bold text-primary">
                      <span>TOTAL CON FLETE</span>
                      <span>{formatCurrency(costos.totalConFlete)}</span>
                    </div>
                  </>
                )}
              </div>
            }
          >
            <Column
              header="Componente"
              body={(r) => r.nombre}
              style={{ minWidth: "140px" }}
            />
            <Column
              header="Cantidad"
              body={(r) => `${r.cantidadLabel} ${r.unidadCantidad}`}
              style={{ width: "100px" }}
              align="right"
            />
            <Column
              header="P. Unit."
              body={(r) => r.precioUnit != null ? `${formatCurrency(r.precioUnit)}/${r.precioUnidad}` : "-"}
              style={{ width: "120px" }}
              align="right"
            />
            <Column
              header="Subtotal"
              body={(r) => formatCurrency(r.subtotal)}
              style={{ width: "100px" }}
              align="right"
            />
            <Column
              header="%"
              body={(r) => r.pct != null ? `${r.pct.toFixed(1)}%` : "-"}
              style={{ width: "60px" }}
              align="right"
            />
          </DataTable>
        </div>

        {/* Pie chart */}
        {pieData && (
          <div style={{ width: "100%", maxWidth: "280px", height: "clamp(160px, 30vh, 220px)" }}>
            <Chart type="pie" data={pieData} options={pieOptions} style={{ width: "100%", height: "100%" }} />
          </div>
        )}
      </div>
    </div>
  );
}
