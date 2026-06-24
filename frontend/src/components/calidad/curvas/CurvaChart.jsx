import React, { useMemo } from "react";
import "chart.js/auto";
import { Chart as PrimeChart } from "primereact/chart";

/* ══════════════════════════════════════════════════════
   CurvaChart — Gráfico de curvas granulométricas
   Soporta: TEORICA/TABULADA (línea % pasa) y BANDA (área)
   X: abertura (mm) — log scale
   Y: % pasa (0-100)
   ══════════════════════════════════════════════════════ */
const CurvaChart = ({ tipo, puntos, nombre, tamicesMuestra, specMode, curvasHermanas }) => {
  const sorted = useMemo(() => {
    if (!puntos || puntos.length < 2) return [];
    return [...puntos]
      .filter((t) => {
        if (t.isNA) return false;
        if (specMode === "OBJETIVO") return t.targetPct != null;
        if (specMode === "MAX_ONLY") return t.limSupPct != null;
        if (specMode === "MIN_ONLY") return t.limInfPct != null;
        if (tipo === "BANDA") return t.limInfPct != null || t.limSupPct != null;
        return t.pasaPct != null;
      })
      .sort((a, b) => a.aberturaMm - b.aberturaMm);
  }, [puntos, tipo, specMode]);

  const sortedMuestra = useMemo(() => {
    if (!tamicesMuestra || tamicesMuestra.length < 2) return [];
    return [...tamicesMuestra]
      .filter((t) => t.pasaPct !== null && t.pasaPct !== undefined)
      .map((t) => ({ aberturaMm: Number(t.aberturaMm), pasaPct: Number(t.pasaPct), tamiz: t.tamiz }))
      .sort((a, b) => a.aberturaMm - b.aberturaMm);
  }, [tamicesMuestra]);

  const chartData = useMemo(() => {
    if (sorted.length < 2) return null;

    const datasets = [];

    if (specMode === "OBJETIVO") {
      // OBJETIVO: single line for target % — works for both BANDA and TABULADA
      datasets.push({
        label: nombre || "Objetivo",
        data: sorted.map((t) => ({ x: t.aberturaMm, y: t.targetPct })),
        borderColor: "#8B5CF6",
        backgroundColor: "rgba(139,92,246,0.1)",
        fill: true,
        tension: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#8B5CF6",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        borderWidth: 2,
      });
    } else if (tipo === "BANDA") {
      if (specMode === "MAX_ONLY") {
        // MAX_ONLY: single line for maximum limit
        datasets.push({
          label: "Máximo",
          data: sorted.map((t) => ({ x: t.aberturaMm, y: t.limSupPct })),
          borderColor: "#EF4444",
          backgroundColor: "rgba(239,68,68,0.08)",
          fill: true,
          tension: 0,
          pointRadius: 4,
          pointBackgroundColor: "#EF4444",
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          borderWidth: 2,
          borderDash: [6, 3],
        });
      } else if (specMode === "MIN_ONLY") {
        // MIN_ONLY: single line for minimum limit
        datasets.push({
          label: "Mínimo",
          data: sorted.map((t) => ({ x: t.aberturaMm, y: t.limInfPct })),
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245,158,11,0.08)",
          fill: true,
          tension: 0,
          pointRadius: 4,
          pointBackgroundColor: "#F59E0B",
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          borderWidth: 2,
          borderDash: [6, 3],
        });
      } else {
        // RANGO: upper + lower with fill between
        // Upper limit
        datasets.push({
          label: "Límite superior",
          data: sorted.map((t) => ({ x: t.aberturaMm, y: t.limSupPct })),
          borderColor: "#EF4444",
          backgroundColor: "rgba(239,68,68,0.08)",
          fill: false,
          tension: 0,
          pointRadius: 4,
          pointBackgroundColor: "#EF4444",
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          borderWidth: 2,
          borderDash: [6, 3],
        });
        // Lower limit
        datasets.push({
          label: "Límite inferior",
          data: sorted.map((t) => ({ x: t.aberturaMm, y: t.limInfPct })),
          borderColor: "#F59E0B",
          backgroundColor: "rgba(245,158,11,0.12)",
          fill: "-1", // fill between this and previous dataset
          tension: 0,
          pointRadius: 4,
          pointBackgroundColor: "#F59E0B",
          pointBorderColor: "#fff",
          pointBorderWidth: 1,
          borderWidth: 2,
          borderDash: [6, 3],
        });
      }
    } else {
      // TEORICA or TABULADA — single line
      datasets.push({
        label: nombre || "Curva",
        data: sorted.map((t) => ({ x: t.aberturaMm, y: t.pasaPct })),
        borderColor: "#8B5CF6",
        backgroundColor: "rgba(139,92,246,0.1)",
        fill: true,
        tension: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#8B5CF6",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        borderWidth: 2,
      });
    }

    // Add muestra overlay if present
    if (sortedMuestra.length >= 2) {
      datasets.push({
        label: "Muestra",
        data: sortedMuestra.map((t) => ({ x: t.aberturaMm, y: t.pasaPct })),
        borderColor: "#3B82F6",
        backgroundColor: "rgba(59,130,246,0.08)",
        fill: false,
        tension: 0,
        pointRadius: 5,
        pointHoverRadius: 7,
        pointBackgroundColor: "#3B82F6",
        pointBorderColor: "#fff",
        pointBorderWidth: 2,
        borderWidth: 2,
      });
    }

    // Add hermanas (individual curves from CurvaSet) as thin dashed lines
    const hermanasColors = ["#A855F7", "#EC4899", "#14B8A6", "#F97316"];
    if (curvasHermanas && curvasHermanas.length > 0) {
      curvasHermanas.forEach((h, idx) => {
        const pts = (h.puntos || [])
          .filter((p) => p.pasaPct != null)
          .sort((a, b) => a.aberturaMm - b.aberturaMm);
        if (pts.length < 2) return;
        const color = hermanasColors[idx % hermanasColors.length];
        datasets.push({
          label: h.curveLetter || h.nombre || `Curva ${idx + 1}`,
          data: pts.map((p) => ({ x: p.aberturaMm, y: p.pasaPct })),
          borderColor: color,
          backgroundColor: "transparent",
          fill: false,
          tension: 0,
          pointRadius: 2,
          pointHoverRadius: 4,
          pointBackgroundColor: color,
          borderWidth: 1.5,
          borderDash: [4, 2],
        });
      });
    }

    return { datasets };
  }, [sorted, sortedMuestra, tipo, nombre, curvasHermanas]);

  /* Collect all unique aberturas from data + muestra + hermanas for tick forcing */
  const allAberturas = useMemo(() => {
    const set = new Set();
    sorted.forEach((t) => set.add(t.aberturaMm));
    (sortedMuestra || []).forEach((t) => set.add(t.aberturaMm));
    (curvasHermanas || []).forEach((h) =>
      (h.puntos || []).forEach((p) => set.add(p.aberturaMm))
    );
    return [...set].sort((a, b) => a - b);
  }, [sorted, sortedMuestra, curvasHermanas]);

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
          min: allAberturas.length > 0 ? Math.max(0.05, allAberturas[0] * 0.7) : 0.05,
          max: allAberturas.length > 0 ? allAberturas[allAberturas.length - 1] * 1.3 : 100,
          afterBuildTicks: (axis) => {
            /* Force ticks at every data-point abertura */
            if (allAberturas.length > 0) {
              axis.ticks = allAberturas.map((v) => ({ value: v }));
            }
          },
          ticks: {
            callback: (val) => {
              /* Format: show compact number */
              if (val >= 1) return val;
              return val;
            },
            autoSkip: false,
            maxRotation: 60,
            minRotation: 30,
            font: { size: 10 },
          },
          grid: { color: "rgba(0,0,0,0.08)" },
        },
        y: {
          title: {
            display: true,
            text: "% Pasa",
            font: { size: 12, weight: "bold" },
          },
          min: 0,
          max: 100,
          ticks: { stepSize: 10, font: { size: 11 } },
          grid: { color: "rgba(0,0,0,0.08)" },
        },
      },
      plugins: {
        legend: {
          display: true,
          position: "top",
          labels: { font: { size: 11 }, usePointStyle: true },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              if (!items.length) return "";
              const pt = items[0];
              const allPuntos = [...sorted, ...sortedMuestra];
              const match = allPuntos.find(
                (t) => Math.abs(t.aberturaMm - pt.parsed.x) < 0.001
              );
              return match?.tamiz ? match.tamiz : `${pt.parsed.x} mm`;
            },
            label: (item) => `${item.dataset.label}: ${item.parsed.y.toFixed(1)}%`,
          },
          backgroundColor: "rgba(0,0,0,0.85)",
          titleColor: "#fff",
          bodyColor: "#fff",
          padding: 10,
          cornerRadius: 6,
        },
      },
    }),
    [sorted, sortedMuestra, allAberturas]
  );

  if (!chartData || sorted.length < 2) {
    let msg;
    if (tipo === "TEORICA") {
      msg = "Completá los parámetros de fórmula para ver el gráfico";
    } else if (tipo === "BANDA") {
      const modeHint = specMode === "OBJETIVO" ? "objetivo" : specMode === "MAX_ONLY" ? "máximo" : specMode === "MIN_ONLY" ? "mínimo" : "límites";
      msg = `Ingresá al menos 2 puntos con ${modeHint} para ver el gráfico`;
    } else {
      msg = "Ingresá al menos 2 puntos con % pasa para ver el gráfico";
    }
    return (
      <div
        className="flex align-items-center justify-content-center text-500"
        style={{ height: "clamp(200px, 40vh, 300px)" }}
      >
        <div className="text-center">
          <i className={`fa-solid ${tipo === "TEORICA" ? "fa-square-root-variable" : tipo === "BANDA" ? "fa-arrows-up-down" : "fa-chart-line"} text-3xl mb-2 block`} />
          <span className="text-sm">{msg}</span>
        </div>
      </div>
    );
  }

  return (
    <div style={{ height: "clamp(240px, 50vh, 350px)" }}>
      <PrimeChart
        type="line"
        data={chartData}
        options={chartOptions}
        style={{ height: "100%", width: "100%" }}
      />
    </div>
  );
};

export default CurvaChart;
