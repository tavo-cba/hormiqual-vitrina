import React, { useState, useMemo, useCallback } from 'react';
import { Slider } from 'primereact/slider';
import { InputNumber } from 'primereact/inputnumber';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import {
  buildUnifiedGrid,
  calcularMezcla,
  evaluarContraBanda,
  evaluarContraTeorica,
} from './mezclaCalcEngine';

const round1 = (v) => Math.round(v * 10) / 10;
const round2 = (v) => Math.round(v * 100) / 100;

const MOTIVO_OPTIONS = [
  { label: 'Redondeo a valores pr\u00e1cticos', value: 'Redondeo a valores pr\u00e1cticos' },
  { label: 'Preferencia de costo por agregado', value: 'Preferencia de costo por agregado' },
  { label: 'Compensaci\u00f3n de stock disponible', value: 'Compensaci\u00f3n de stock disponible' },
  { label: 'Ajuste por experiencia del tecn\u00f3logo', value: 'Ajuste por experiencia del tecn\u00f3logo' },
  { label: 'Otro', value: '__otro__' },
];

function calcCalidad(maeOptimo, maeAjustado, cumpleBanda) {
  if (!cumpleBanda) return { label: 'NO CUMPLE', severity: 'danger', icon: 'fa-solid fa-xmark' };
  const delta = (maeAjustado ?? 0) - (maeOptimo ?? 0);
  if (delta < 0.5) return { label: 'EXCELENTE', severity: 'success', icon: 'fa-solid fa-star' };
  if (delta < 1.5) return { label: 'BUENO', severity: 'success', icon: 'fa-solid fa-check' };
  if (delta < 3.0) return { label: 'ACEPTABLE', severity: 'warning', icon: 'fa-solid fa-minus' };
  return { label: 'MARGINAL', severity: 'warning', icon: 'fa-solid fa-triangle-exclamation' };
}

/**
 * Post-optimization manual adjustment panel.
 * Allows the user to adjust proportions within feasible ranges.
 */
const AjustePostOptimizacion = ({
  agregados,
  optResult,
  onApply,
  onCancel,
  bandaPuntos,
  teoricaPuntos,
}) => {
  const rangos = optResult?.optimizacion?.rangos || [];
  const optAgregados = optResult?.agregados || [];

  // Build per-aggregate config: { id, nombre, optPct, minPct, maxPct, fixed }
  const aggConfig = useMemo(() => {
    return rangos.map((r) => {
      const agg = agregados.find((a) => Number(a.id) === Number(r.id));
      const optAgg = optAgregados.find((a) => Number(a.id) === Number(r.id));
      return {
        id: Number(r.id),
        nombre: agg?.nombre || `Agregado ${r.id}`,
        optPct: round1(optAgg?.porcentaje ?? r.optimalPct ?? r.minPct),
        minPct: round1(r.minPct ?? 0),
        maxPct: round1(r.maxPct ?? 100),
        fixed: !!r.fixed,
        granulometria: agg?.granulometria,
        tipoAgregado: agg?.tipoAgregado,
      };
    }).filter((c) => !c.fixed || c.minPct !== c.maxPct);
  }, [rangos, agregados, optAgregados]);

  // Internal adjusted percentages: { [id]: number }
  const [adjusted, setAdjusted] = useState(() => {
    const init = {};
    for (const c of aggConfig) init[c.id] = c.optPct;
    return init;
  });

  // Motivo
  const [motivoOption, setMotivoOption] = useState(null);
  const [motivoTexto, setMotivoTexto] = useState('');

  // Redistribute when one aggregate changes
  const handleChange = useCallback((changedId, newVal) => {
    setAdjusted((prev) => {
      const cfg = aggConfig.find((c) => c.id === changedId);
      if (!cfg) return prev;

      // Clamp to range
      const clamped = round1(Math.min(cfg.maxPct, Math.max(cfg.minPct, newVal)));
      const delta = clamped - prev[changedId];
      if (Math.abs(delta) < 0.05) return { ...prev, [changedId]: clamped };

      // Distribute -delta among others proportionally
      const others = aggConfig.filter((c) => c.id !== changedId && !c.fixed);
      const otherTotal = others.reduce((s, c) => s + prev[c.id], 0);
      const next = { ...prev, [changedId]: clamped };

      if (others.length === 0 || otherTotal < 0.01) return next;

      let remaining = -delta;
      const eligible = [...others];

      // Iterative redistribution to respect limits
      for (let iter = 0; iter < 5 && Math.abs(remaining) > 0.05; iter++) {
        const totalElig = eligible.reduce((s, c) => s + (next[c.id] || 0), 0);
        if (totalElig < 0.01) break;

        const toRemove = [];
        let distributed = 0;
        for (const c of eligible) {
          const share = (next[c.id] / totalElig) * remaining;
          let target = round1(next[c.id] + share);
          if (target < c.minPct) { target = c.minPct; toRemove.push(c.id); }
          if (target > c.maxPct) { target = c.maxPct; toRemove.push(c.id); }
          distributed += target - next[c.id];
          next[c.id] = target;
        }
        remaining -= distributed;
        for (const id of toRemove) {
          const idx = eligible.findIndex((c) => c.id === id);
          if (idx >= 0) eligible.splice(idx, 1);
        }
      }

      return next;
    });
  }, [aggConfig]);

  // Restore optimal
  const handleRestoreOptimal = useCallback(() => {
    const init = {};
    for (const c of aggConfig) init[c.id] = c.optPct;
    setAdjusted(init);
  }, [aggConfig]);

  // Total
  const total = useMemo(() => {
    return round1(Object.values(adjusted).reduce((s, v) => s + v, 0));
  }, [adjusted]);

  // Compute optimal metrics (once)
  const optMetrics = useMemo(() => {
    const withPuntos = aggConfig
      .filter((c) => c.granulometria?.puntos?.length)
      .map((c) => {
        let puntos = c.granulometria.puntos;
        if (typeof puntos === 'string') { try { puntos = JSON.parse(puntos); } catch { puntos = []; } }
        return { id: c.id, nombre: c.nombre, porcentaje: c.optPct, peso: c.optPct / 100, puntos };
      });
    if (withPuntos.length < 2) return null;
    const grid = buildUnifiedGrid(withPuntos.map((a) => a.puntos));
    const mix = calcularMezcla(withPuntos, grid);
    const banda = bandaPuntos ? evaluarContraBanda(mix.curvaMix, bandaPuntos) : null;
    const teorica = teoricaPuntos ? evaluarContraTeorica(mix.curvaMix, teoricaPuntos) : null;
    // Use optResult metrics if available (more accurate from backend)
    const resumen = optResult?.resumen;
    return {
      rmse: resumen?.rmse ?? teorica?.rmse ?? banda?.rmse ?? null,
      mae: resumen?.mae ?? teorica?.mae ?? banda?.mae ?? null,
      r2: resumen?.r2 ?? teorica?.r2 ?? null,
      maxDesvio: resumen?.maxDesvio ?? teorica?.maxDesvio ?? null,
      mf: mix.moduloFinura?.valor ?? null,
      cumpleBanda: banda?.cumple ?? true,
      curvaMix: mix.curvaMix,
    };
  }, [aggConfig, bandaPuntos, teoricaPuntos, optResult]);

  // Compute adjusted metrics (reactive)
  const adjMetrics = useMemo(() => {
    const withPuntos = aggConfig
      .filter((c) => c.granulometria?.puntos?.length)
      .map((c) => {
        let puntos = c.granulometria.puntos;
        if (typeof puntos === 'string') { try { puntos = JSON.parse(puntos); } catch { puntos = []; } }
        const pct = adjusted[c.id] ?? c.optPct;
        return { id: c.id, nombre: c.nombre, porcentaje: pct, peso: pct / 100, puntos };
      });
    if (withPuntos.length < 2) return null;
    const grid = buildUnifiedGrid(withPuntos.map((a) => a.puntos));
    const mix = calcularMezcla(withPuntos, grid);
    const banda = bandaPuntos ? evaluarContraBanda(mix.curvaMix, bandaPuntos) : null;
    const teorica = teoricaPuntos ? evaluarContraTeorica(mix.curvaMix, teoricaPuntos) : null;
    return {
      rmse: teorica?.rmse ?? banda?.rmse ?? null,
      mae: teorica?.mae ?? banda?.mae ?? null,
      r2: teorica?.r2 ?? null,
      maxDesvio: teorica?.maxDesvio ?? null,
      mf: mix.moduloFinura?.valor ?? null,
      cumpleBanda: banda?.cumple ?? true,
      fueraDeBanda: banda?.fueraDeBanda || [],
      curvaMix: mix.curvaMix,
    };
  }, [aggConfig, adjusted, bandaPuntos, teoricaPuntos]);

  const calidad = useMemo(() => {
    if (!adjMetrics) return { label: '--', severity: 'info' };
    return calcCalidad(optMetrics?.mae, adjMetrics.mae, adjMetrics.cumpleBanda);
  }, [optMetrics, adjMetrics]);

  const isChanged = useMemo(() => {
    return aggConfig.some((c) => Math.abs(adjusted[c.id] - c.optPct) > 0.05);
  }, [aggConfig, adjusted]);

  const canApply = calidad.label !== 'NO CUMPLE' && Math.abs(total - 100) < 0.2;

  // Build metadata for saving
  const handleApply = useCallback(() => {
    const propOptimas = {};
    const propAdoptadas = {};
    const rangosMap = {};
    const newPctInputs = {};

    for (const c of aggConfig) {
      propOptimas[c.nombre] = c.optPct;
      propAdoptadas[c.nombre] = adjusted[c.id];
      rangosMap[c.nombre] = { min: c.minPct, max: c.maxPct };
      newPctInputs[c.id] = String(adjusted[c.id]);
    }

    const motivo = motivoOption === '__otro__' ? motivoTexto : motivoOption;

    const metadata = {
      tipo_optimizacion: isChanged ? 'automatica_con_ajuste' : 'automatica',
      metodo_optimizador: optResult?.optimizacion?.metodo || null,
      proporciones_optimas: propOptimas,
      rangos: rangosMap,
      proporciones_adoptadas: propAdoptadas,
      metricas_optimo: optMetrics ? {
        rmse: optMetrics.rmse, mae: optMetrics.mae, r2: optMetrics.r2,
        max_desvio: optMetrics.maxDesvio, mf: optMetrics.mf,
      } : null,
      metricas_ajustado: adjMetrics ? {
        rmse: adjMetrics.rmse, mae: adjMetrics.mae, r2: adjMetrics.r2,
        max_desvio: adjMetrics.maxDesvio, mf: adjMetrics.mf,
      } : null,
      calidad_ajuste: calidad.label.toLowerCase(),
      motivo_ajuste: motivo || null,
    };

    onApply(newPctInputs, metadata);
  }, [aggConfig, adjusted, motivoOption, motivoTexto, isChanged, optResult, optMetrics, adjMetrics, calidad, onApply]);

  const fmtDelta = (opt, adj) => {
    if (opt == null || adj == null) return '';
    const d = round2(adj - opt);
    if (Math.abs(d) < 0.01) return '';
    return d > 0 ? `+${d}` : `${d}`;
  };

  return (
    <div className="surface-card border-round p-3 shadow-1 mt-3">
      {/* Header */}
      <div className="flex align-items-center justify-content-between mb-3">
        <div>
          <h4 className="m-0 mb-1 text-base">
            <i className="fa-solid fa-sliders mr-2 text-primary" />
            Ajuste manual post-optimizacion
          </h4>
          <small className="text-500">
            Ajuste las proporciones dentro de los rangos factibles calculados por el optimizador.
          </small>
        </div>
        <Tag value={calidad.label} severity={calidad.severity} className="text-xs" />
      </div>

      {/* Sliders */}
      <div className="flex flex-column gap-3 mb-3">
        {aggConfig.map((c) => {
          const val = adjusted[c.id] ?? c.optPct;
          const delta = round1(val - c.optPct);
          const range = c.maxPct - c.minPct;
          const optPos = range > 0 ? ((c.optPct - c.minPct) / range) * 100 : 50;

          return (
            <div key={c.id} className="surface-50 border-round p-2">
              <div className="flex align-items-center justify-content-between mb-1">
                <span className="text-sm font-semibold">{c.nombre}</span>
                <div className="flex align-items-center gap-2">
                  <InputNumber
                    value={val}
                    onValueChange={(e) => handleChange(c.id, e.value ?? c.optPct)}
                    min={c.minPct}
                    max={c.maxPct}
                    minFractionDigits={1}
                    maxFractionDigits={1}
                    suffix=" %"
                    inputClassName="text-right text-sm p-1"
                    inputStyle={{ width: '70px' }}
                    showButtons
                    buttonLayout="horizontal"
                    step={0.5}
                    incrementButtonClassName="p-button-text p-button-sm"
                    decrementButtonClassName="p-button-text p-button-sm"
                    incrementButtonIcon="fa-solid fa-plus text-xs"
                    decrementButtonIcon="fa-solid fa-minus text-xs"
                  />
                </div>
              </div>

              {/* Slider with optimal marker */}
              <div className="relative" style={{ padding: '0 4px' }}>
                <Slider
                  value={val}
                  onChange={(e) => handleChange(c.id, e.value)}
                  min={c.minPct}
                  max={c.maxPct}
                  step={0.5}
                  className="w-full"
                />
                {/* Optimal position marker */}
                {range > 0 && (
                  <div
                    className="absolute"
                    style={{
                      left: `calc(${optPos}% - 4px)`,
                      top: '-2px',
                      width: '8px',
                      height: 'clamp(160px, 30vh, 8px)',
                      background: 'var(--primary-color)',
                      transform: 'rotate(45deg)',
                      opacity: 0.5,
                      pointerEvents: 'none',
                      zIndex: 1,
                    }}
                    title={`Optimo: ${c.optPct}%`}
                  />
                )}
              </div>

              {/* Labels */}
              <div className="flex justify-content-between mt-1">
                <small className="text-400">{c.minPct}%</small>
                <small className="text-500">
                  Optimo: {c.optPct}%
                  {Math.abs(delta) > 0.05 && (
                    <span className={delta > 0 ? 'text-orange-500 ml-2' : 'text-blue-500 ml-2'}>
                      {delta > 0 ? `+${delta}` : delta}%
                    </span>
                  )}
                </small>
                <small className="text-400">{c.maxPct}%</small>
              </div>
            </div>
          );
        })}
      </div>

      {/* Total indicator */}
      <div className="flex align-items-center justify-content-between surface-100 border-round p-2 mb-3">
        <span className="text-sm font-semibold">
          Total: {total}%
          {Math.abs(total - 100) < 0.2 ? (
            <i className="fa-solid fa-check text-green-500 ml-2" />
          ) : (
            <i className="fa-solid fa-triangle-exclamation text-orange-500 ml-2" />
          )}
        </span>
        {isChanged && (
          <Button
            label="Restaurar optimo"
            icon="fa-solid fa-undo"
            severity="secondary"
            text
            size="small"
            onClick={handleRestoreOptimal}
          />
        )}
      </div>

      {/* Metrics comparison */}
      {optMetrics && adjMetrics && isChanged && (
        <div className="surface-50 border-round p-2 mb-3">
          <div className="text-sm font-semibold mb-2">
            <i className="fa-solid fa-chart-line mr-2 text-primary" />
            Metricas: Optimo vs Ajustado
          </div>
          <div className="grid text-sm">
            {[
              { label: 'Cumple banda', opt: optMetrics.cumpleBanda ? 'Si' : 'No', adj: adjMetrics.cumpleBanda ? 'Si' : 'No' },
              { label: 'MAE', opt: optMetrics.mae, adj: adjMetrics.mae, unit: '%', digits: 2 },
              { label: 'RMSE', opt: optMetrics.rmse, adj: adjMetrics.rmse, digits: 2 },
              { label: 'R2', opt: optMetrics.r2, adj: adjMetrics.r2, digits: 2 },
              { label: 'Max desvio', opt: optMetrics.maxDesvio, adj: adjMetrics.maxDesvio, unit: '%', digits: 2 },
              { label: 'MF', opt: optMetrics.mf, adj: adjMetrics.mf, digits: 2 },
            ].map((m) => (
              <React.Fragment key={m.label}>
                <div className="col-12 sm:col-6 md:col-4 text-500">{m.label}</div>
                <div className="col-6 md:col-3 text-right">
                  {typeof m.opt === 'string' ? m.opt : (m.opt != null ? round2(m.opt) : '--')}{m.unit || ''}
                </div>
                <div className="col-6 md:col-3 text-right font-semibold">
                  {typeof m.adj === 'string' ? m.adj : (m.adj != null ? round2(m.adj) : '--')}{m.unit || ''}
                </div>
                <div className="col-6 md:col-2 text-right text-400 text-xs">
                  {typeof m.opt !== 'string' && fmtDelta(m.opt, m.adj)}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      )}

      {/* Out-of-band warning */}
      {adjMetrics && !adjMetrics.cumpleBanda && adjMetrics.fueraDeBanda?.length > 0 && (
        <Message
          severity="error"
          className="w-full mb-3"
          text={`No cumple banda en tamiz(es): ${adjMetrics.fueraDeBanda.map((f) => f.tamiz || `${f.aberturaMm} mm`).join(', ')}. Ajuste los valores o restaure el optimo.`}
        />
      )}

      {/* Motivo */}
      {isChanged && (
        <div className="mb-3">
          <label className="text-sm text-500 block mb-1">Motivo del ajuste (opcional)</label>
          <div className="flex gap-2">
            <Dropdown
              value={motivoOption}
              options={MOTIVO_OPTIONS}
              onChange={(e) => setMotivoOption(e.value)}
              placeholder="Seleccionar motivo..."
              className="flex-1"
              size="small"
            />
            {motivoOption === '__otro__' && (
              <InputText
                value={motivoTexto}
                onChange={(e) => setMotivoTexto(e.target.value)}
                placeholder="Describir motivo..."
                className="flex-1"
              />
            )}
          </div>
        </div>
      )}

      {/* Action buttons */}
      <div className="flex justify-content-end gap-2">
        <Button
          label="Cancelar"
          severity="secondary"
          text
          size="small"
          onClick={onCancel}
        />
        <Button
          label={isChanged ? 'Aplicar ajuste' : 'Aceptar optimo'}
          icon={isChanged ? 'fa-solid fa-check' : 'fa-solid fa-thumbs-up'}
          size="small"
          onClick={handleApply}
          disabled={!canApply}
        />
      </div>
    </div>
  );
};

export default AjustePostOptimizacion;
