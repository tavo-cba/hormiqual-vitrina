import React, { useMemo } from "react";
// chart.js/auto registers everything globally
import "chart.js/auto";
import { Chart as PrimeChart } from "primereact/chart";

/* ══════════════════════════════════════════════════════
   GranulometriaChart — Curva granulométrica
   X: abertura (mm) — logarithmic scale
   Y: % pasa (0-100)
   ══════════════════════════════════════════════════════ */
// Separación mínima en log10(mm) entre dos labels vecinos del eje X.
// A ~700 px y 2-3 décadas visibles, 0.045 décadas ≈ 10 px → mínimo razonable
// para que "12.5" y "13.2", o "25" y "26.5", no se pisen.
const SEP_MIN_LOG_X = 0.045;

/**
 * Recibe la lista ordenada ascendente de aberturas candidatas a label y devuelve
 * el subconjunto que preserva separación mínima en log (greedy desde la más chica).
 */
function filtrarLabelsPorSeparacion(aberturas) {
  const ordenadas = [...aberturas].sort((a, b) => a - b);
  const visibles = [];
  let ultimoLog = -Infinity;
  for (const a of ordenadas) {
    const l = Math.log10(a);
    if (l - ultimoLog >= SEP_MIN_LOG_X) {
      visibles.push(a);
      ultimoLog = l;
    }
  }
  return visibles;
}

const GranulometriaChart = ({ tamices, tipoAgregado, husoAberturas = null }) => {
  const isFineScale = tipoAgregado === "FINO" || tipoAgregado === "TOTAL";
  // Sort by abertura ascending for the chart line
  const sorted = useMemo(() => {
    if (!tamices || tamices.length < 2) return [];
    return [...tamices]
      .filter((t) => t.pasaPct !== null && t.pasaPct !== undefined)
      .map((t) => ({
        aberturaMm: Number(t.aberturaMm),
        pasaPct: Number(t.pasaPct),
        tamiz: t.tamiz,
      }))
      .sort((a, b) => a.aberturaMm - b.aberturaMm);
  }, [tamices]);

  const chartData = useMemo(() => {
    if (sorted.length < 2) return null;
    return {
      datasets: [
        {
          label: "% Pasa",
          data: sorted.map((t) => ({ x: t.aberturaMm, y: t.pasaPct })),
          borderColor: "#3B82F6",
          backgroundColor: "rgba(59,130,246,0.1)",
          fill: true,
          tension: 0,
          pointRadius: 5,
          pointHoverRadius: 7,
          pointBackgroundColor: "#3B82F6",
          pointBorderColor: "#fff",
          pointBorderWidth: 2,
          borderWidth: 2,
        },
      ],
    };
  }, [sorted]);

  // Compute dynamic X bounds from actual data
  const xBounds = useMemo(() => {
    if (sorted.length < 2) {
      return isFineScale ? { min: 0.1, max: 12 } : { min: 0.05, max: 100 };
    }
    const dataMin = sorted[0].aberturaMm;
    const dataMax = sorted[sorted.length - 1].aberturaMm;
    return {
      min: Math.max(0.01, dataMin / 2),
      max: dataMax * 1.5,
    };
  }, [sorted, isFineScale]);

  const chartOptions = useMemo(
    () => ({
      responsive: true,
      maintainAspectRatio: false,
      interaction: {
        mode: "nearest",
        intersect: false,
      },
      scales: {
        x: {
          type: "logarithmic",
          title: {
            display: true,
            text: "Abertura (mm)",
            font: { size: 12, weight: "bold" },
          },
          min: xBounds.min,
          max: xBounds.max,
          ticks: {
            callback: (val) => {
              const candidatas = isFineScale
                ? [0.15, 0.3, 0.425, 0.6, 1.18, 2.36, 4.75, 9.5]
                : [0.075, 0.15, 0.3, 0.425, 0.6, 1.18, 2.36, 3.35, 4.75, 6.3, 9.5, 12.5, 13.2, 16, 19, 25, 26.5, 31.5, 37.5, 50, 53, 63, 75];
              const esCerca = (a, b) => Math.abs(a - b) / Math.max(b, 0.001) < 0.01;
              const match = candidatas.find((l) => esCerca(val, l));
              if (match == null) return "";
              // Si hay huso apuntado, labels SÓLO en sus aberturas.
              if (Array.isArray(husoAberturas) && husoAberturas.length > 0) {
                if (!husoAberturas.some((a) => esCerca(val, Number(a)))) return "";
              } else {
                // Fallback: respetar separación mínima en log entre labels.
                const visibles = filtrarLabelsPorSeparacion(candidatas);
                if (!visibles.some((l) => esCerca(val, l))) return "";
              }
              if (match < 1) return `${Math.round(match * 1000)} µm`;
              return `${match}`;
            },
            autoSkip: false,
            maxRotation: 45,
            font: { size: 10 },
          },
          grid: {
            color: "rgba(0,0,0,0.08)",
          },
        },
        y: {
          title: {
            display: true,
            text: "% Pasa",
            font: { size: 12, weight: "bold" },
          },
          min: 0,
          max: 100,
          ticks: {
            stepSize: 10,
            font: { size: 11 },
          },
          grid: {
            color: "rgba(0,0,0,0.08)",
          },
        },
      },
      plugins: {
        legend: {
          display: false,
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const pt = items[0];
              const match = sorted.find(
                (t) => Math.abs(t.aberturaMm - pt.parsed.x) < 0.001
              );
              return match ? match.tamiz : `${pt.parsed.x} mm`;
            },
            label: (item) => `% Pasa: ${item.parsed.y.toFixed(1)}%`,
          },
          backgroundColor: "rgba(0,0,0,0.85)",
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 10,
          cornerRadius: 6,
        },
      },
    }),
    [sorted, isFineScale, xBounds, husoAberturas]
  );

  if (!chartData || sorted.length < 2) return null;

  return (
    <div>
      <div className="font-bold text-sm mb-2 flex align-items-center gap-2">
        <i className="fa-solid fa-chart-line text-primary" />
        Curva granulométrica
      </div>
      <div
        className="surface-border border-1 border-round p-2"
        style={{ height: "clamp(200px, 40vh, 280px)" }}
      >
        <PrimeChart
          type="line"
          data={chartData}
          options={chartOptions}
          style={{ height: "100%", width: "100%" }}
        />
      </div>
    </div>
  );
};

export default GranulometriaChart;
