import React, { useEffect, useState, useCallback, useMemo } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { useParams, useNavigate } from "react-router-dom";
import { Button } from "primereact/button";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import { Tag } from "primereact/tag";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Divider } from "primereact/divider";
import { ProgressBar } from "primereact/progressbar";
import { useToast } from "../../../context/ToastContext";
import CurvaChart from "./CurvaChart";

/* ══════════════════════════════════════════════════════
   CurvaSetDetail — detalle de un paquete de curvas
   Muestra las curvas del set y permite editar/pegar
   ══════════════════════════════════════════════════════ */
const CurvaSetDetail = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();

  const [loading, setLoading] = useState(true);
  const [set, setSet] = useState(null);

  const fetchSet = useCallback(async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${config.backendUrl}/api/curva-sets/${id}`, {
        headers: config.headers,
      });
      setSet(res.data);
    } catch (err) {
      console.error("Error al cargar set:", err);
      showToast("error", "Error al cargar el set de curvas");
    } finally {
      setLoading(false);
    }
  }, [id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    fetchSet();
  }, [fetchSet]);

  const curvas = useMemo(() => (set?.curvas || []).sort((a, b) => {
    const letterA = a.curveLetter || a.nombre || "";
    const letterB = b.curveLetter || b.nombre || "";
    return letterA.localeCompare(letterB);
  }), [set]);

  const estadoGlobal = useMemo(() => {
    if (curvas.length === 0) return "PENDIENTE";
    const allComplete = curvas.every((c) => {
      const pts = (c.puntos || []).filter((p) => !p.isNA);
      const withData = pts.filter((p) => p.targetPct != null || p.pasaPct != null || p.limInfPct != null || p.limSupPct != null);
      return withData.length >= 2;
    });
    return allComplete ? "COMPLETO" : "PENDIENTE";
  }, [curvas]);

  const getProgressForCurva = (curva) => {
    const pts = (curva.puntos || []).filter((p) => !p.isNA);
    const total = pts.length;
    if (total === 0) return 0;
    const specMode = curva.specMode || "RANGO";
    let filled;
    if (specMode === "OBJETIVO") {
      filled = pts.filter((p) => p.targetPct != null).length;
    } else if (specMode === "MAX_ONLY") {
      filled = pts.filter((p) => p.limSupPct != null).length;
    } else if (specMode === "MIN_ONLY") {
      filled = pts.filter((p) => p.limInfPct != null).length;
    } else {
      filled = pts.filter((p) => p.limInfPct != null && p.limSupPct != null).length;
    }
    return Math.round((filled / total) * 100);
  };

  const getEstadoCurva = (curva) => {
    const pts = (curva.puntos || []).filter((p) => !p.isNA);
    const specMode = curva.specMode || "RANGO";
    let filled;
    if (specMode === "OBJETIVO") {
      filled = pts.filter((p) => p.targetPct != null).length;
    } else if (specMode === "MAX_ONLY") {
      filled = pts.filter((p) => p.limSupPct != null).length;
    } else if (specMode === "MIN_ONLY") {
      filled = pts.filter((p) => p.limInfPct != null).length;
    } else {
      filled = pts.filter((p) => p.limInfPct != null && p.limSupPct != null).length;
    }
    return filled >= 2 ? "COMPLETO" : "PENDIENTE";
  };

  if (loading) {
    return (
      <div className="flex justify-content-center align-items-center" style={{ height: "60vh" }}>
        <i className="pi pi-spin pi-spinner" style={{ fontSize: "2rem" }} />
      </div>
    );
  }

  if (!set) {
    return (
      <div className="p-3">
        <DetailPageHeader title="Set no encontrado" subtitle="Verificá el ID o volvé al listado." />
        <div className="text-center text-500 py-6">
          <i className="fa-solid fa-triangle-exclamation text-3xl mb-2 block" />
          Set no encontrado
        </div>
      </div>
    );
  }

  return (
    <div className="p-3">
      <DetailPageHeader
        icon="fa-solid fa-layer-group"
        title={set.nombre}
        subtitle="Set de curvas — detalle por edad / serie"
        actions={(
          <Tag
            value={estadoGlobal}
            severity={estadoGlobal === "COMPLETO" ? "success" : "warning"}
            icon={estadoGlobal === "COMPLETO" ? "fa-solid fa-check" : "fa-solid fa-clock"}
          />
        )}
      />

      {/* Set info */}
      <div className="surface-100 border-round p-3 mb-3">
        <div className="grid">
          <div className="col-6 md:col-3">
            <span className="text-xs text-500 block">Serie</span>
            <span className="font-bold text-sm">{set.serieTamices || "IRAM"}</span>
          </div>
          <div className="col-6 md:col-3">
            <span className="text-xs text-500 block">Uso</span>
            <Tag
              value={set.materialUso || "—"}
              severity={set.materialUso === "FINO" ? "info" : set.materialUso === "GRUESO" ? "warning" : "success"}
              className="text-xs"
            />
          </div>
          <div className="col-6 md:col-3">
            <span className="text-xs text-500 block">TMN</span>
            <span className="font-bold text-sm">{set.tmnMm ? `${set.tmnMm} mm` : "—"}</span>
          </div>
          <div className="col-6 md:col-3">
            <span className="text-xs text-500 block">Norma</span>
            <span className="font-bold text-sm">{set.normaRef || "—"}</span>
          </div>
        </div>
        {set.descripcion && (
          <div className="mt-2 text-xs text-500">{set.descripcion}</div>
        )}
      </div>

      <Divider className="my-2" />

      {/* Curvas del set */}
      <h4 className="mt-0 mb-2 flex align-items-center gap-2">
        <i className="fa-solid fa-bezier-curve text-primary" />
        Curvas del set ({curvas.length})
      </h4>

      {curvas.length === 0 ? (
        <div className="text-center text-500 py-6">
          <i className="fa-solid fa-inbox text-3xl mb-2 block" />
          Este set no tiene curvas
        </div>
      ) : (
        <div className="grid">
          {curvas.map((curva) => {
            const progress = getProgressForCurva(curva);
            const estado = getEstadoCurva(curva);
            const previewPuntos = (curva.puntos || []).filter((p) => !p.isNA && p.targetPct != null);

            return (
              <div key={curva.idCurva} className="col-12 md:col-6 xl:col-4">
                <div className="surface-border border-1 border-round p-3 h-full">
                  {/* Curve header */}
                  <div className="flex align-items-center justify-content-between mb-2">
                    <div className="flex align-items-center gap-2">
                      {curva.curveLetter && (
                        <Tag value={`Curva ${curva.curveLetter}`} severity="help" className="text-xs" />
                      )}
                      <Tag
                        value={estado}
                        severity={estado === "COMPLETO" ? "success" : "warning"}
                        className="text-xs"
                      />
                    </div>
                    <Button
                      icon="fa-solid fa-pencil"
                      label="Editar / Pegar"
                      size="small"
                      text
                      severity="primary"
                      onClick={() => navigate(`/calidad/catalogos/curvas/editar/${curva.idCurva}`)}
                    />
                  </div>

                  {/* Curve name */}
                  <div
                    className="font-bold text-sm mb-2 cursor-pointer hover-blue"
                    onClick={() => navigate(`/calidad/catalogos/curvas/editar/${curva.idCurva}`)}
                  >
                    {curva.nombre}
                  </div>

                  {/* Progress */}
                  <div className="mb-2">
                    <div className="flex justify-content-between text-xs text-500 mb-1">
                      <span>Progreso</span>
                      <span>{progress}%</span>
                    </div>
                    <ProgressBar
                      value={progress}
                      showValue={false}
                      style={{ height: "clamp(160px, 30vh, 6px)" }}
                      color={progress === 100 ? "var(--green-500)" : progress > 0 ? "var(--blue-500)" : "var(--surface-400)"}
                    />
                  </div>

                  {/* Info */}
                  <div className="text-xs text-500 mb-2">
                    {(curva.puntos || []).length} tamices ·{" "}
                    {curva.specMode || "RANGO"} ·{" "}
                    {previewPuntos.length} con datos
                  </div>

                  {/* Mini chart */}
                  <div style={{ height: "clamp(160px, 30vh, 180px)" }}>
                    <CurvaChart
                      tipo={curva.tipo || "BANDA"}
                      puntos={previewPuntos.length >= 2 ? previewPuntos : []}
                      nombre={curva.curveLetter ? `Curva ${curva.curveLetter}` : curva.nombre}
                      specMode={curva.specMode || "RANGO"}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* All curves table view */}
      {curvas.length > 0 && (
        <>
          <Divider className="my-3" />
          <h4 className="mt-0 mb-2">Vista tabla</h4>
          <DataTable responsiveLayout="scroll"
            value={curvas}
            size="small"
            stripedRows
            dataKey="idCurva"
          >
            <Column
              field="nombre"
              header="Nombre"
              body={(c) => (
                <span
                  className="font-bold hover-blue cursor-pointer"
                  onClick={() => navigate(`/calidad/catalogos/curvas/editar/${c.idCurva}`)}
                >
                  {c.nombre}
                </span>
              )}
            />
            <Column
              header="Curva"
              style={{ width: "80px" }}
              body={(c) => c.curveLetter ? (
                <Tag value={`Curva ${c.curveLetter}`} severity="help" className="text-xs" />
              ) : "—"}
            />
            <Column
              header="Modo"
              style={{ width: "100px" }}
              body={(c) => (
                <Tag value={c.specMode || "RANGO"} severity="info" className="text-xs" />
              )}
            />
            <Column
              header="Progreso"
              style={{ width: "150px" }}
              body={(c) => {
                const p = getProgressForCurva(c);
                return (
                  <div>
                    <ProgressBar value={p} showValue={false} style={{ height: "clamp(160px, 30vh, 6px)" }} />
                    <span className="text-xs text-500">{p}%</span>
                  </div>
                );
              }}
            />
            <Column
              header="Estado"
              style={{ width: "100px" }}
              body={(c) => {
                const e = getEstadoCurva(c);
                return <Tag value={e} severity={e === "COMPLETO" ? "success" : "warning"} className="text-xs" />;
              }}
            />
            <Column
              header=""
              style={{ width: "120px" }}
              body={(c) => (
                <Button
                  icon="fa-solid fa-pencil"
                  label="Editar"
                  size="small"
                  text
                  onClick={() => navigate(`/calidad/catalogos/curvas/editar/${c.idCurva}`)}
                />
              )}
            />
          </DataTable>
        </>
      )}
    </div>
  );
};

export default CurvaSetDetail;
