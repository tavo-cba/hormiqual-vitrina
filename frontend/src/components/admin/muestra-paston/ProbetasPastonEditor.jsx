import React, { useEffect, useMemo } from "react";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import "../probeta/probeta.css"; // reusa .probeta-paston-badge (override dark)

/**
 * Editor de probetas de una MuestraPaston. Permite corregir cantidad, tipo,
 * edad de rotura, código y observaciones de las probetas moldeadas en un
 * pastón cuando el operador se equivocó al guardarlo.
 *
 * Integridad (decisión 2026-05-18): las probetas ya ENSAYADAS (tienen
 * `idEnsayoResistencia` o estado "Ensayada"=3) quedan BLOQUEADAS — se muestran
 * en solo lectura, no se pueden borrar ni editar. El backend las protege
 * igual; acá solo es feedback visual.
 *
 * Props:
 *  - value: Array de probetas (forma API o forma editor).
 *  - onChange(list): emite la lista completa (bloqueadas incluidas).
 *  - tipos: catálogo [{ idTipoProbeta, tipo }].
 *  - edadesSugeridas: number[] para el botón "Agregar".
 *  - disabled: deshabilita todo el editor.
 */
const ESTADO_ENSAYADA = 3;
const esBloqueada = (p) =>
  p?.idEnsayoResistencia != null || Number(p?.idEstadoProbeta) === ESTADO_ENSAYADA;

const normalizar = (p) => ({
  idProbeta: p.idProbeta ?? null,
  nombre: p.nombre ?? null,
  idTipoProbeta:
    p.idTipoProbeta ?? p.tipoProbeta?.idTipoProbeta ?? null,
  diasRotura: p.diasRotura ?? 28,
  codigo: p.codigo ?? "",
  observaciones: p.observaciones ?? "",
  idEstadoProbeta: p.idEstadoProbeta ?? 1,
  idEnsayoResistencia: p.idEnsayoResistencia ?? null,
  _bloqueada: esBloqueada(p),
});

const ProbetasPastonEditor = ({
  value = [],
  onChange,
  tipos = [],
  edadesSugeridas = [7, 28],
  disabled = false,
}) => {
  const rows = useMemo(() => (value || []).map(normalizar), [value]);

  // Asegura un tipo por defecto cuando hay catálogo y filas sin tipo.
  useEffect(() => {
    if (!tipos.length) return;
    const def = tipos.find((t) => /15x30/.test(t.tipo)) || tipos[0];
    let touched = false;
    const next = rows.map((r) => {
      if (!r._bloqueada && r.idTipoProbeta == null) {
        touched = true;
        return { ...r, idTipoProbeta: def.idTipoProbeta };
      }
      return r;
    });
    if (touched) onChange?.(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tipos, rows.length]);

  const emit = (next) => onChange?.(next);

  const updateRow = (idx, patch) => {
    emit(rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  const removeRow = (idx) => {
    emit(rows.filter((_, i) => i !== idx));
  };

  const addRow = () => {
    const def =
      (tipos.find((t) => /15x30/.test(t.tipo)) || tipos[0])?.idTipoProbeta ?? null;
    emit([
      ...rows,
      {
        idProbeta: null,
        nombre: null,
        idTipoProbeta: def,
        diasRotura: edadesSugeridas[0] || 28,
        codigo: "",
        observaciones: "",
        idEstadoProbeta: 1,
        idEnsayoResistencia: null,
        _bloqueada: false,
      },
    ]);
  };

  const tipoOptions = tipos.map((t) => ({ label: t.tipo, value: t.idTipoProbeta }));
  const editables = rows.filter((r) => !r._bloqueada).length;
  const bloqueadas = rows.length - editables;

  return (
    <div className="flex flex-column gap-2">
      <div className="flex justify-content-between align-items-center flex-wrap gap-2">
        <small className="text-color-secondary">
          {rows.length} probeta(s) · {editables} editable(s)
          {bloqueadas > 0 && ` · ${bloqueadas} ensayada(s) bloqueada(s)`}
        </small>
        <Button
          type="button"
          label="Agregar probeta"
          icon="fa-solid fa-plus"
          size="small"
          outlined
          disabled={disabled}
          onClick={addRow}
        />
      </div>

      {rows.length === 0 && (
        <div
          className="p-3 text-center border-round"
          style={{ background: "var(--surface-100)", color: "var(--text-color-secondary)" }}
        >
          Sin probetas. Usá “Agregar probeta” para registrar las moldeadas.
        </div>
      )}

      {rows.map((r, idx) => (
        <div
          key={r.idProbeta ?? `n${idx}`}
          className="grid formgrid align-items-end p-2 border-round"
          style={{
            background: r._bloqueada ? "var(--surface-100)" : "var(--surface-50)",
            border: "1px solid var(--surface-border)",
            margin: 0,
          }}
        >
          <div className="col-12 md:col-3 flex flex-column gap-1">
            <small className="text-color-secondary">
              {r.nombre || "Nueva"}
              {r._bloqueada && (
                <span className="probeta-paston-badge ml-2" title="Probeta ya ensayada — no editable">
                  <i className="fa-solid fa-lock mr-1" />Ensayada
                </span>
              )}
            </small>
            <Dropdown
              value={r.idTipoProbeta}
              options={tipoOptions}
              onChange={(e) => updateRow(idx, { idTipoProbeta: e.value })}
              placeholder="Tipo"
              className="w-full"
              disabled={disabled || r._bloqueada}
            />
          </div>
          <div className="col-6 md:col-2 flex flex-column gap-1">
            <small className="text-color-secondary">Edad rotura (días)</small>
            <InputNumber
              value={r.diasRotura}
              onValueChange={(e) => updateRow(idx, { diasRotura: e.value })}
              min={1}
              max={365}
              className="w-full"
              inputClassName="w-full"
              disabled={disabled || r._bloqueada}
            />
          </div>
          <div className="col-6 md:col-3 flex flex-column gap-1">
            <small className="text-color-secondary">Código</small>
            <InputText
              value={r.codigo}
              onChange={(e) => updateRow(idx, { codigo: e.target.value })}
              className="w-full"
              disabled={disabled || r._bloqueada}
            />
          </div>
          <div className="col-10 md:col-3 flex flex-column gap-1">
            <small className="text-color-secondary">Observaciones</small>
            <InputText
              value={r.observaciones}
              onChange={(e) => updateRow(idx, { observaciones: e.target.value })}
              className="w-full"
              disabled={disabled || r._bloqueada}
            />
          </div>
          <div className="col-2 md:col-1 flex justify-content-end">
            <Button
              type="button"
              icon="fa-solid fa-trash"
              severity="danger"
              text
              rounded
              disabled={disabled || r._bloqueada}
              tooltip={r._bloqueada ? "Probeta ensayada — no se puede borrar" : "Quitar probeta"}
              tooltipOptions={{ position: "top" }}
              onClick={() => removeRow(idx)}
            />
          </div>
        </div>
      ))}
    </div>
  );
};

export default ProbetasPastonEditor;
