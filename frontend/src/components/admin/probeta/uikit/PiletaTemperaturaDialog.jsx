import React, { useEffect, useState, useMemo, useContext } from "react";
import { Dialog } from "primereact/dialog";
import { Chart as PrimeChart } from "primereact/chart";
import ChartJS from "chart.js/auto";
import axios from "axios";
import { config } from "../../../../config/config";
import { useToast } from "../../../../context/ToastContext";
import { ThemeContext } from "../../../../context/ThemeContext";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";
import "./PiletaTemperaturaDialog.css";

const StatCard = ({ label, value, unit = "°C", color }) => (
  <div className="pileta-temp-stat">
    <span className="pileta-temp-stat__label">{label}</span>
    <span className="pileta-temp-stat__value" style={{ color }}>
      {value != null ? `${value}${unit}` : "—"}
    </span>
  </div>
);

const PiletaTemperaturaDialog = ({ visible, onHide, idProbeta, nombreProbeta }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const showToast = useToast();
  const { isDark } = useContext(ThemeContext);

  useEffect(() => {
    if (!visible || !idProbeta) return;
    setData(null);
    const fetchData = async () => {
      try {
        setLoading(true);
        const res = await axios.get(
          `${config.backendUrl}/api/probetas/${idProbeta}/temperatura`,
          { headers: config.headers }
        );
        setData(res.data);
      } catch (err) {
        console.error("Error cargando temperatura:", err);
        showToast("error", err.response?.data?.error || "No se pudo cargar la temperatura");
        onHide();
      } finally {
        setLoading(false);
      }
    };
    fetchData();
  }, [visible, idProbeta]);

  const chartData = useMemo(() => {
    if (!data?.dailyData?.length) return null;
    const labels = data.dailyData.map((d) => {
      const [y, m, day] = d.fecha.split("-");
      return `${day}/${m}`;
    });
    const textColor = isDark ? "#e2e8f0" : "#374151";
    const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";

    const objetivo = data.stats?.objetivo;
    const umbral = data.stats?.umbral ?? 3;

    const datasets = [
      {
        label: "Promedio",
        data: data.dailyData.map((d) => d.avg),
        borderColor: "#3b82f6",
        backgroundColor: "rgba(59,130,246,0.12)",
        fill: true,
        tension: 0.35,
        pointRadius: data.dailyData.length > 30 ? 2 : 4,
        pointBackgroundColor: data.dailyData.map((d) =>
          d.fueraRango ? "#ef4444" : "#3b82f6"
        ),
        pointBorderColor: data.dailyData.map((d) =>
          d.fueraRango ? "#ef4444" : "#3b82f6"
        ),
        borderWidth: 2,
      },
      {
        label: "Mínima",
        data: data.dailyData.map((d) => d.min),
        borderColor: isDark ? "#94a3b8" : "#9ca3af",
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
      },
      {
        label: "Máxima",
        data: data.dailyData.map((d) => d.max),
        borderColor: isDark ? "#f97316" : "#f59e0b",
        borderDash: [4, 4],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
      },
    ];

    if (objetivo) {
      datasets.push({
        label: "Objetivo",
        data: data.dailyData.map(() => objetivo),
        borderColor: "#10b981",
        borderDash: [6, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1.5,
      });
      datasets.push({
        label: `+${umbral}°C`,
        data: data.dailyData.map(() => objetivo + umbral),
        borderColor: "rgba(239,68,68,0.4)",
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
      });
      datasets.push({
        label: `-${umbral}°C`,
        data: data.dailyData.map(() => objetivo - umbral),
        borderColor: "rgba(239,68,68,0.4)",
        borderDash: [3, 3],
        pointRadius: 0,
        fill: false,
        borderWidth: 1,
      });
    }

    return {
      labels,
      datasets,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: "index", intersect: false },
        plugins: {
          legend: {
            labels: { color: textColor, boxWidth: 12, font: { size: 11 } },
          },
          tooltip: {
            callbacks: {
              label: (ctx) => `${ctx.dataset.label}: ${ctx.parsed.y}°C`,
            },
          },
        },
        scales: {
          x: {
            ticks: { color: textColor, maxRotation: 45, font: { size: 10 } },
            grid: { color: gridColor },
          },
          y: {
            ticks: {
              color: textColor,
              callback: (v) => `${v}°C`,
              font: { size: 10 },
            },
            grid: { color: gridColor },
          },
        },
      },
    };
  }, [data, isDark]);

  const pileta = data?.pileta;
  const stats = data?.stats;
  const porcentajeEnRango =
    stats && stats.totalDias > 0
      ? Math.round(((stats.totalDias - stats.diasFueraRango) / stats.totalDias) * 100)
      : null;

  const header = (
    <div className="flex align-items-center gap-2">
      <i className="fa-solid fa-temperature-half" style={{ color: "#3b82f6" }} />
      <span>Temperatura de curado — {nombreProbeta}</span>
    </div>
  );

  return (
    <Dialog
      header={header}
      visible={visible}
      onHide={onHide}
      style={{ width: "min(900px, 96vw)" }}
      className="pileta-temp-dialog"
      dismissableMask
    >
      {loading ? (
        <div className="flex justify-content-center py-5">
          <LoadSpinner />
        </div>
      ) : !data ? null : (
        <div className="pileta-temp-body">
          {/* Cabecera pileta */}
          <div className="pileta-temp-info">
            <div className="pileta-temp-info__row">
              <i className="fa-solid fa-water mr-2" style={{ color: "#3b82f6" }} />
              <span className="font-bold">{pileta?.nombre}</span>
              {pileta?.planta && (
                <span className="pileta-temp-info__planta ml-2">
                  — {pileta.planta.nombre}
                </span>
              )}
            </div>
            <div className="pileta-temp-info__state">
              {pileta?.estado?.temperaturaActual != null && (
                <span className="pileta-temp-badge pileta-temp-badge--blue">
                  <i className="fa-solid fa-thermometer-half mr-1" />
                  Actual: {pileta.estado.temperaturaActual}°C
                </span>
              )}
              {pileta?.estado?.temperaturaObjetivo != null && (
                <span className="pileta-temp-badge pileta-temp-badge--green">
                  <i className="fa-solid fa-bullseye mr-1" />
                  Objetivo: {pileta.estado.temperaturaObjetivo}°C
                </span>
              )}
              {pileta?.estado?.bombasEncendidas && (
                <span className="pileta-temp-badge pileta-temp-badge--orange">
                  <i className="fa-solid fa-pump mr-1" />
                  Bombas ON
                </span>
              )}
              {pileta?.estado?.resistenciasEncendidas && (
                <span className="pileta-temp-badge pileta-temp-badge--red">
                  <i className="fa-solid fa-fire mr-1" />
                  Resistencias ON
                </span>
              )}
            </div>
          </div>

          {!data.dailyData?.length ? (
            <div className="pileta-temp-empty">
              <i className="fa-solid fa-chart-line mb-2" style={{ fontSize: "2rem", opacity: 0.4 }} />
              <p>Sin registros de temperatura para este período de curado.</p>
            </div>
          ) : (
            <>
              {/* Stats */}
              <div className="pileta-temp-stats">
                <StatCard label="Temp. promedio" value={stats?.avg} color="#3b82f6" />
                <StatCard label="Mínima registrada" value={stats?.min} color={isDark ? "#94a3b8" : "#6b7280"} />
                <StatCard label="Máxima registrada" value={stats?.max} color={isDark ? "#f97316" : "#f59e0b"} />
                <StatCard label="Días en rango" value={porcentajeEnRango} unit="%" color={porcentajeEnRango >= 80 ? "#10b981" : "#ef4444"} />
                <StatCard label="Días monitoreados" value={stats?.totalDias} unit=" días" color="var(--text-color)" />
                <StatCard label="Total lecturas" value={stats?.totalRegistros?.toLocaleString()} unit="" color="var(--text-color-secondary)" />
              </div>

              {stats?.diasFueraRango > 0 && (
                <div className="pileta-temp-alert">
                  <i className="fa-solid fa-triangle-exclamation mr-2" />
                  <span>
                    <strong>{stats.diasFueraRango} día{stats.diasFueraRango !== 1 ? "s" : ""}</strong> con temperatura fuera del rango permitido
                    {stats.objetivo ? ` (objetivo ${stats.objetivo}°C ± ${stats.umbral}°C)` : ""}.
                    Los puntos rojos en el gráfico indican esos días.
                  </span>
                </div>
              )}

              {/* Gráfico */}
              <div className="pileta-temp-chart">
                <PrimeChart
                  type="line"
                  data={{ labels: chartData.labels, datasets: chartData.datasets }}
                  options={chartData.options}
                  style={{ height: "300px" }}
                />
              </div>

              {/* Tabla resumen por día (solo si pocos días) */}
              {data.dailyData.length <= 35 && (
                <div className="pileta-temp-table-wrap">
                  <table className="pileta-temp-table">
                    <thead>
                      <tr>
                        <th>Día</th>
                        <th>Promedio</th>
                        <th>Mín</th>
                        <th>Máx</th>
                        <th>Estado</th>
                      </tr>
                    </thead>
                    <tbody>
                      {data.dailyData.map((d) => (
                        <tr key={d.fecha} className={d.fueraRango ? "pileta-temp-table__row--alert" : ""}>
                          <td>{(() => { const [y,m,day] = d.fecha.split("-"); return `${day}/${m}/${y}`; })()}</td>
                          <td><strong>{d.avg}°C</strong></td>
                          <td>{d.min}°C</td>
                          <td>{d.max}°C</td>
                          <td>
                            {d.fueraRango ? (
                              <span className="pileta-temp-badge pileta-temp-badge--red">Fuera de rango</span>
                            ) : (
                              <span className="pileta-temp-badge pileta-temp-badge--green">OK</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </>
          )}
        </div>
      )}
    </Dialog>
  );
};

export default PiletaTemperaturaDialog;
