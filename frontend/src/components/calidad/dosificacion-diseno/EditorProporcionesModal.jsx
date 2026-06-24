import React, { useEffect, useMemo, useRef, useState } from "react";
import { Dialog } from "primereact/dialog";
import { Button } from "primereact/button";
import { InputNumber } from "primereact/inputnumber";
import { Slider } from "primereact/slider";
import { Tag } from "primereact/tag";
import { previewMezcla } from "../../../services/dosificacionDisenoService";

/**
 * Editor interactivo de proporciones para una mezcla previamente sugerida.
 *
 * Recibe:
 *   - visible, onHide: control del diálogo
 *   - sugerencia: objeto { componentes:[{id,nombre,tipo,porcentaje,...,aptitudSummary}], granulometria, indicadores, cumplimientoAptitud, _meta }
 *   - parametros: los mismos parámetros que alimentaron el sugeridor (expuestoDesgaste, fc, asentamiento, etc.)
 *   - onConfirm(solucionAjustada): callback cuando el usuario acepta el ajuste
 *   - modoEdicion ('sugerencia' | 'mezcla'): cambia los textos del header y
 *     muestra un banner adicional cuando se editan proporciones de una mezcla
 *     ya guardada en el catálogo (Issue 2 — sesión 2026-05-27). En modo
 *     'mezcla' el caller es responsable de invocar el endpoint que persiste
 *     los cambios y maneja el fork si la mezcla está compartida.
 *
 * El modal abre con las proporciones originales y deja al usuario editar cada una.
 * Cada cambio dispara un preview contra el backend (debounced 300 ms) que devuelve
 * los indicadores actualizados. La filosofía es prestacional: se muestran warnings
 * pero no se bloquea la confirmación por desvíos (solo por Σ ≠ 100 o preview fallido).
 */
export default function EditorProporcionesModal({ visible, onHide, sugerencia, parametros, onConfirm, modoEdicion = 'sugerencia' }) {
  const [proporciones, setProporciones] = useState([]);
  const [preview, setPreview] = useState(null);
  const [previewError, setPreviewError] = useState(null);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const abortRef = useRef(null);

  // Inicializar proporciones desde la sugerencia al abrir
  useEffect(() => {
    if (!visible || !sugerencia) return;
    const ini = (sugerencia.componentes || []).map(c => Number(c.porcentaje) || 0);
    setProporciones(ini);
    setPreview(sugerencia);
    setPreviewError(null);
  }, [visible, sugerencia]);

  // Σ y Δ
  const suma = useMemo(
    () => proporciones.reduce((a, b) => a + Number(b || 0), 0),
    [proporciones]
  );
  const delta = useMemo(() => Math.round((suma - 100) * 100) / 100, [suma]);
  const sumaOk = Math.abs(delta) < 0.5;

  // Dispara preview al backend, con debounce.
  useEffect(() => {
    if (!visible || !sugerencia) return;
    if (!sumaOk) { setPreviewError(null); return; } // esperá a que sume 100
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        if (abortRef.current) abortRef.current = null;
        const { solucion } = await previewMezcla(
          sugerencia.componentes,
          proporciones,
          parametros || {},
        );
        setPreview(solucion);
        setPreviewError(null);
      } catch (err) {
        setPreviewError(err?.response?.data?.error || err.message || "Error en preview");
        setPreview(null);
      } finally {
        setLoading(false);
      }
    }, 300);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [proporciones, visible, sugerencia, parametros, sumaOk]);

  const setProp = (idx, val) => {
    setProporciones(prev => {
      const next = [...prev];
      next[idx] = Math.max(0, Math.min(100, Number(val) || 0));
      return next;
    });
  };

  // Distribuye automáticamente el exceso/déficit entre los otros componentes.
  const rebalancear = () => {
    if (sumaOk || proporciones.length === 0) return;
    const diff = 100 - suma;
    // Distribuye proporcionalmente al peso actual.
    const otros = proporciones.filter(p => p > 0);
    const total = otros.reduce((a, b) => a + b, 0);
    if (total <= 0) {
      setProporciones(proporciones.map((_, i) => i === 0 ? 100 : 0));
      return;
    }
    const ajuste = proporciones.map(p => {
      if (p <= 0) return 0;
      return Math.round((p + (p / total) * diff) * 10) / 10;
    });
    // Redondeo: empujar el resto al primer componente >0
    const sumaAj = ajuste.reduce((a, b) => a + b, 0);
    const resto = Math.round((100 - sumaAj) * 10) / 10;
    if (resto !== 0) {
      const firstIdx = ajuste.findIndex(p => p > 0);
      if (firstIdx >= 0) ajuste[firstIdx] = Math.round((ajuste[firstIdx] + resto) * 10) / 10;
    }
    setProporciones(ajuste);
  };

  // Para el display de kg/m³ necesitaríamos el volumen total de agregados (no
  // está en el preview), así que en v1 mostramos solo % y el kg se estima
  // asumiendo 1 m³ de agregado total × densidad SSS individual.
  // TODO (v2): recibir volumen de agregados real del dosificador.

  const handleConfirm = () => {
    if (!sumaOk) return;
    if (!preview) return;
    // Construir solución ajustada con las proporciones editadas.
    const componentesAjustados = sugerencia.componentes.map((c, i) => ({
      ...c,
      porcentaje: proporciones[i],
    }));
    onConfirm({
      ...preview,
      componentes: componentesAjustados,
      proporciones: [...proporciones],
      _edicionManual: true,
    });
  };

  const ind = preview?.indicadores || {};
  const ca = preview?.cumplimientoAptitud;

  const fmt = (v, d = 2) => (v == null || isNaN(v) ? "—" : Number(v).toFixed(d).replace(".", ","));

  const aptitudSev = ca?.estado === "cumple" ? "success"
    : ca?.estado === "sin_dato" ? "info"
    : ca?.estado === "cumple_con_atencion" ? "warning"
    : "danger";
  const aptitudLabel = ca?.estado === "cumple" ? "Aptitud: cumple"
    : ca?.estado === "sin_dato" ? "Aptitud: sin datos"
    : ca?.estado === "cumple_con_atencion" ? "Aptitud: al borde"
    : ca?.estado ? "Aptitud: desvíos" : "Aptitud: —";

  const esModoMezcla = modoEdicion === 'mezcla';

  return (
    <Dialog
      header={esModoMezcla
        ? "Modificar proporciones de mezcla guardada"
        : "Editor de proporciones"}
      visible={visible}
      onHide={onHide}
      style={{ width: "90vw", maxWidth: "52rem" }}
      modal
      draggable={false}
      footer={(
        <div className="flex justify-content-between align-items-center">
          <small className="text-color-secondary">
            Σ = <strong style={{ color: sumaOk ? "var(--green-500)" : "var(--orange-400)" }}>{fmt(suma, 1)}%</strong>
            {!sumaOk && (
              <>
                {" "}(<span style={{ color: "var(--orange-400)" }}>Δ {delta > 0 ? "+" : ""}{fmt(delta, 1)}</span>)
                <Button label="Rebalancear" icon="fa-solid fa-scale-balanced" className="p-button-text p-button-sm ml-2" onClick={rebalancear} />
              </>
            )}
          </small>
          <div className="flex gap-2">
            <Button label="Cancelar" className="p-button-text p-button-sm" onClick={onHide} />
            <Button
              label="Confirmar ajuste"
              icon="fa-solid fa-check"
              className="p-button-sm"
              onClick={handleConfirm}
              disabled={!sumaOk || !preview || loading}
            />
          </div>
        </div>
      )}
    >
      <div className="flex flex-column gap-3">
        <small className="text-color-secondary">
          Ajustá las proporciones de cada fracción. La suma debe ser 100%. Los indicadores se recalculan en vivo.
        </small>
        {esModoMezcla && (
          <div
            className="p-2 border-round text-xs"
            style={{ background: 'rgba(59, 130, 246, 0.08)', borderLeft: '3px solid var(--blue-500)' }}
          >
            <i className="fa-solid fa-info-circle mr-2" style={{ color: 'var(--blue-500)' }} />
            Estos cambios se guardan en la mezcla del catálogo. Si la mezcla la usan otras dosificaciones,
            se va a crear automáticamente una nueva versión y solo se va a actualizar esta dosificación —
            las otras no se ven afectadas.
          </div>
        )}

        {/* Tabla de proporciones editables */}
        <div className="surface-card p-2 border-round">
          <div className="grid text-xs font-semibold text-color-secondary mb-1 px-2">
            <div className="col-12 md:col-6">Fracción</div>
            <div className="col-6 md:col-2 text-center">Tipo</div>
            <div className="col-12 sm:col-6 md:col-4 text-center">% Mezcla</div>
          </div>
          {(sugerencia?.componentes || []).map((c, idx) => {
            const tipo = (c.tipo || "").toUpperCase();
            const tipoColor = tipo === "FINO" ? "var(--yellow-500)" : "var(--orange-400)";
            return (
              <div key={c.id ?? idx} className="grid align-items-center py-1 px-2 border-top-1 border-200">
                <div className="col-12 md:col-6 text-sm">
                  <i className={`fa-solid ${tipo === "FINO" ? "fa-hourglass" : "fa-mountain"} mr-2`} style={{ color: tipoColor }} />
                  {c.nombre || `Material ${idx + 1}`}
                </div>
                <div className="col-6 md:col-2 text-center">
                  <Tag value={tipo === "FINO" ? "AF" : "AG"} severity={tipo === "FINO" ? "warning" : "info"} />
                </div>
                <div className="col-12 sm:col-6 md:col-4">
                  <div className="flex align-items-center gap-2">
                    <Slider
                      value={proporciones[idx] || 0}
                      min={0} max={100} step={1}
                      onChange={(e) => setProp(idx, e.value)}
                      className="flex-1"
                    />
                    <InputNumber
                      value={proporciones[idx] || 0}
                      onValueChange={(e) => setProp(idx, e.value ?? 0)}
                      min={0} max={100}
                      suffix=" %"
                      showButtons
                      buttonLayout="horizontal"
                      incrementButtonIcon="fa-solid fa-plus"
                      decrementButtonIcon="fa-solid fa-minus"
                      minFractionDigits={0} maxFractionDigits={1}
                      inputStyle={{ width: "4rem", textAlign: "right" }}
                      style={{ minWidth: "8rem" }}
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        {/* Preview de indicadores */}
        <div className="surface-card p-3 border-round">
          <div className="flex justify-content-between align-items-center mb-2">
            <strong className="text-sm">Indicadores en vivo</strong>
            {loading && <small className="text-color-secondary"><i className="fa-solid fa-spinner fa-spin mr-1" />Calculando…</small>}
            {previewError && <small className="text-red-400"><i className="fa-solid fa-triangle-exclamation mr-1" />{previewError}</small>}
          </div>

          {/* Aptitud tag */}
          {ca && (
            <div className="mb-2">
              <Tag value={aptitudLabel} severity={aptitudSev} />
              {ca.sumaNocivasPond != null && (
                <small className="ml-2 text-color-secondary" style={{ fontSize: "0.75rem" }}>
                  suma nocivas pond. {fmt(ca.sumaNocivasPond, 2)}% ({ca.contexto?.expuestoDesgaste ? "con desgaste" : "sin desgaste"})
                </small>
              )}
              {ca.problemas && ca.problemas.length > 0 && (
                <div className="text-xs mt-1" style={{ color: "var(--orange-400)" }}>
                  <i className="fa-solid fa-triangle-exclamation mr-1" />{ca.problemas[0]}
                </div>
              )}
            </div>
          )}

          <div className="grid text-xs">
            <div className="col-6 md:col-3">MF: <strong>{fmt(ind.mf, 2)}</strong></div>
            <div className="col-6 md:col-3">TMN: <strong>{ind.tmn || "—"} mm</strong></div>
            <div className="col-6 md:col-3">FdG: <strong>{fmt(ind.fdg, 1)}%</strong></div>
            <div className="col-6 md:col-3">FdT: <strong>{fmt(ind.fdt, 1)}%</strong></div>
            <div className="col-6 md:col-3">SE: <strong>{fmt(ind.se, 1)}</strong></div>
            <div className="col-6 md:col-3">FdA: <strong>{fmt(ind.fda, 1)}</strong></div>
            <div className="col-6 md:col-3">
              Zona: <strong>{ind.zona?.zona || "—"}</strong>
              {ind.zona?.nombre && <small className="text-color-secondary"> — {ind.zona.nombre}</small>}
            </div>
            <div className="col-6 md:col-3">Cemento est.: <strong>{ind.cemento ? Math.round(ind.cemento) : "—"} kg/m³</strong></div>
            <div className="col-6 md:col-3">% Finos: <strong>{fmt(ind.proporcionFinos, 0)}%</strong></div>
            <div className="col-6 md:col-3">
              Banda IRAM:{" "}
              <strong style={{
                color: ind.bandaTier === "AB" ? "var(--green-500)"
                  : ind.bandaTier === "AC" ? "var(--yellow-500)"
                  : ind.bandaTier === "ninguna" ? "var(--orange-400)"
                  : "inherit"
              }}>
                {ind.bandaTier === "AB" ? "Cumple A-B"
                  : ind.bandaTier === "AC" ? "Cumple A-C (no A-B)"
                  : ind.bandaTier === "ninguna" ? `Fuera (${ind.bandaACFuera || 0} tamices)`
                  : "—"}
              </strong>
            </div>
          </div>

          {/* Advertencias blandas — filosofía prestacional, no bloquean */}
          {ind.bandaTier === "ninguna" && (
            <div className="text-xs mt-2" style={{ color: "var(--orange-400)" }}>
              <i className="fa-solid fa-info-circle mr-1" />
              La mezcla queda fuera de banda IRAM 1627. Gestionable con pastón de prueba; no bloquea la confirmación.
            </div>
          )}
        </div>
      </div>
    </Dialog>
  );
}
