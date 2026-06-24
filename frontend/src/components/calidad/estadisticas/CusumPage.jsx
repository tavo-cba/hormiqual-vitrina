import React, { useState, useEffect, useCallback, useMemo, useContext } from 'react';
import { Chart as PrimeChart } from 'primereact/chart';
import { Card } from 'primereact/card';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { InputNumber } from 'primereact/inputnumber';
import { Button } from 'primereact/button';
import { TabView, TabPanel } from 'primereact/tabview';
import { Message } from 'primereact/message';
import { Panel } from 'primereact/panel';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Fade } from 'react-awesome-reveal';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { useToast } from '../../../context/ToastContext';
import { ThemeContext } from '../../../context/ThemeContext';
import { dateToYMDLocal } from '../../../common/functions';
import { formatNumber } from '../../../lib/format';
import { getCusum, getTiposHormigon } from '../../../services/controlCalidadService';

const CHART_COLORS = {
  cPlus:      '#3B82F6', // azul
  cMinus:     '#F97316', // naranja
  alert:      '#DC2626', // rojo
  threshold:  '#EF4444', // rojo claro (bandas ±h)
  zero:       '#9CA3AF', // gris (línea cero)
};

// Presets de k (slack) — NIST/SEMATECH §6.3.2. Cada uno está calibrado
// para shifts específicos en unidades de σ.
const K_PRESETS = [
  { label: '0,25σ — alta sensibilidad (shifts ≥0,5σ)', value: 0.25 },
  { label: '0,5σ — estándar NIST (shifts ≥1σ)',         value: 0.5  },
  { label: '0,75σ — moderada (shifts ≥1,5σ)',           value: 0.75 },
  { label: '1,0σ — baja (sólo shifts ≥2σ)',              value: 1.0  },
];

// Presets de h (umbral). Cada uno con su ARL₀ (avg run length bajo
// control) y ARL₁ para shift de 1σ — NIST/SEMATECH §6.3.2.
const H_PRESETS = [
  { label: '3σ — muy sensible (ARL₀ ~31)',          value: 3 },
  { label: '4σ — estándar NIST (ARL₀ ~168)',         value: 4 },
  { label: '5σ — conservador (ARL₀ ~465)',           value: 5 },
  { label: '6σ — muy conservador (ARL₀ ~1300)',      value: 6 },
  { label: '8σ — procesos críticos (ARL₀ ~6000)',    value: 8 },
];

// Clases CIRSOC 201 más usadas. Target = f'c declarado del hormigón.
const TARGET_PRESETS = [
  { clase: 'H-25', value: 25 },
  { clase: 'H-30', value: 30 },
  { clase: 'H-35', value: 35 },
  { clase: 'H-40', value: 40 },
  { clase: 'H-45', value: 45 },
];

// Calidad del control σ — clasificación basada en ACI 214R-11
// "Guide to Evaluation of Strength Test Results of Concrete" (overall
// variation, general construction). Los cortes (2,8/3,4/4,1/4,8/5,5 MPa)
// se corresponden con la conversión estándar de 400/500/600/700/800 psi
// con redondeo a 1 decimal. Las 5 categorías reproducen las del ACI
// (Excellent / Very good / Good / Fair / Poor). HormiQual NO usa esta
// clasificación para evaluar conformidad — sólo es ayuda al usuario para
// ingresar un σ realista. La validez normativa de CUSUM como método de
// evaluación está respaldada por IRAM 1666:2020 §A.7.10.1.2.
const SIGMA_PRESETS = [
  { label: '3,0', value: 3.0, calidad: 'Muy bueno (2,8–3,4 MPa)' },
  { label: '3,5', value: 3.5, calidad: 'Bueno (3,4–4,1 MPa)' },
  { label: '4,0', value: 4.0, calidad: 'Bueno (3,4–4,1 MPa)' },
  { label: '4,5', value: 4.5, calidad: 'Aceptable (4,1–4,8 MPa)' },
  { label: '5,0', value: 5.0, calidad: 'Deficiente (>4,8 MPa)' },
];

/**
 * CUSUM (Cumulative Sum) — Calidad → Set Estadístico (sesión 2026-05-09).
 *
 * Detecta desplazamientos pequeños y sostenidos de la media (0,5σ–1,5σ)
 * que la carta Shewhart no flagea hasta que ocurre una violación
 * Western Electric. Útil para anticipar problemas de mezcla, cemento
 * inconsistente o variación en agregados antes de que afecten un lote.
 *
 * Backend: domain/spc/cusumEngine.js (puro) + getCusumData service
 * (reusa la query base de la carta de control).
 */
const CusumPage = () => {
  const showToast = useToast();
  const { isDark } = useContext(ThemeContext);

  const [tipos, setTipos] = useState([]);
  const [filters, setFilters] = useState({ idTipoHormigon: null, desde: null, hasta: null });
  const [params, setParams] = useState({ target: null, sigma: null, kSigmas: 0.5, hSigmas: 4 });
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [selectedEdad, setSelectedEdad] = useState(28);
  // Ventana de puntos visibles en el chart. Con 900+ puntos la lectura es
  // imposible; por defecto mostramos los últimos 200. null = todos.
  const [ventana, setVentana] = useState(200);
  // Bump de key para forzar re-mount del InputNumber cuando el valor lo
  // setea un chip (workaround de un quirk de PrimeReact InputNumber que
  // no siempre refleja el cambio de `value` externo). El bump no se
  // incrementa al escribir manualmente (eso ya lo maneja onValueChange).
  const [targetKey, setTargetKey] = useState(0);
  const [sigmaKey, setSigmaKey] = useState(0);

  const setTargetFromChip = (value) => {
    setParams((p) => ({ ...p, target: value }));
    setTargetKey((k) => k + 1);
  };
  const setSigmaFromChip = (value) => {
    setParams((p) => ({ ...p, sigma: value }));
    setSigmaKey((k) => k + 1);
  };

  const fetchTipos = useCallback(async () => {
    try {
      const t = await getTiposHormigon();
      setTipos(t.map((x) => ({ label: x.tipoHormigon, value: x.idTipoHormigon })));
    } catch (err) {
      console.error('[Cusum] fetchTipos:', err);
      showToast('error', 'No se pudieron cargar los tipos de hormigón.');
    }
  }, [showToast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const q = {};
      if (filters.idTipoHormigon) q.idTipoHormigon = filters.idTipoHormigon;
      if (filters.desde) q.desde = dateToYMDLocal(filters.desde);
      if (filters.hasta) q.hasta = dateToYMDLocal(filters.hasta);
      if (Number.isFinite(Number(params.target))) q.target = params.target;
      if (Number.isFinite(Number(params.sigma)) && Number(params.sigma) > 0) q.sigma = params.sigma;
      if (Number.isFinite(Number(params.kSigmas))) q.kSigmas = params.kSigmas;
      if (Number.isFinite(Number(params.hSigmas))) q.hSigmas = params.hSigmas;
      const d = await getCusum(q);
      setData(d);
    } catch (err) {
      console.error('[Cusum] fetchData:', err);
      showToast('error', 'No se pudo calcular el CUSUM.');
    } finally {
      setLoading(false);
    }
  }, [filters, params, showToast]);

  useEffect(() => { fetchTipos(); }, [fetchTipos]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const currentData = data?.[`edad${selectedEdad}`];
  const allPoints = currentData?.points || [];
  const stats = currentData?.stats;
  // points = slice del final si hay ventana; el indexado original se
  // preserva en `_origIndex` para los tooltips.
  const points = useMemo(() => {
    if (!ventana || allPoints.length <= ventana) {
      return allPoints.map((p, i) => ({ ...p, _origIndex: i }));
    }
    return allPoints
      .slice(-ventana)
      .map((p, i) => ({ ...p, _origIndex: allPoints.length - ventana + i }));
  }, [allPoints, ventana]);

  const chartData = useMemo(() => {
    if (!points.length || !stats) return null;
    const labels = points.map((p) => `#${(p._origIndex ?? 0) + 1}`);
    // Con series largas (>200 pts) ocultamos los puntos normales y dejamos
    // sólo la línea continua + triángulos en las alertas. Con series cortas
    // mostramos un círculo pequeño en cada punto para ver la cadencia.
    const dense = points.length > 200;
    const normalRadius = dense ? 0 : 2;
    return {
      labels,
      datasets: [
        {
          label: 'C+ (acumulado positivo)',
          data: points.map((p) => p.cPlus),
          borderColor: CHART_COLORS.cPlus,
          backgroundColor: points.map((p) => p.alertaPlus ? CHART_COLORS.alert : CHART_COLORS.cPlus),
          pointBorderColor: points.map((p) => p.alertaPlus ? CHART_COLORS.alert : CHART_COLORS.cPlus),
          pointRadius: points.map((p) => p.alertaPlus ? 5 : normalRadius),
          pointHoverRadius: points.map((p) => p.alertaPlus ? 7 : 4),
          pointStyle: points.map((p) => p.alertaPlus ? 'triangle' : 'circle'),
          borderWidth: 1.5,
          fill: false,
          tension: 0,
          order: 1,
        },
        {
          label: 'C− (acumulado negativo)',
          data: points.map((p) => p.cMinus),
          borderColor: CHART_COLORS.cMinus,
          backgroundColor: points.map((p) => p.alertaMinus ? CHART_COLORS.alert : CHART_COLORS.cMinus),
          pointBorderColor: points.map((p) => p.alertaMinus ? CHART_COLORS.alert : CHART_COLORS.cMinus),
          pointRadius: points.map((p) => p.alertaMinus ? 5 : normalRadius),
          pointHoverRadius: points.map((p) => p.alertaMinus ? 7 : 4),
          pointStyle: points.map((p) => p.alertaMinus ? 'triangle' : 'circle'),
          borderWidth: 1.5,
          fill: false,
          tension: 0,
          order: 1,
        },
        // Línea cero (referencia visual del eje del CUSUM)
        {
          label: 'Cero',
          data: Array(points.length).fill(0),
          borderColor: CHART_COLORS.zero,
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 3,
        },
        // Líneas de umbral ±h
        {
          label: `+h (${formatNumber(stats.h, { precision: 2 })})`,
          data: Array(points.length).fill(stats.h),
          borderColor: CHART_COLORS.threshold,
          borderDash: [8, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 2,
        },
        {
          label: `−h (${formatNumber(-stats.h, { precision: 2 })})`,
          data: Array(points.length).fill(-stats.h),
          borderColor: CHART_COLORS.threshold,
          borderDash: [8, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 2,
        },
      ],
    };
  }, [points, stats]);

  const chartOptions = useMemo(() => {
    const tickColor = isDark ? '#E5E7EB' : '#374151';
    const gridColor = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    const titleColor = isDark ? '#F3F4F6' : '#111827';
    const legendColor = isDark ? '#E5E7EB' : '#374151';
    return {
      responsive: true,
      maintainAspectRatio: false,
      interaction: { mode: 'nearest', intersect: true },
      plugins: {
        legend: {
          position: 'bottom',
          labels: {
            usePointStyle: true,
            boxWidth: 10,
            font: { size: 11 },
            color: legendColor,
            filter: (item) => item.text !== 'Cero',
          },
        },
        tooltip: {
          callbacks: {
            title: (items) => {
              const idx = items[0]?.dataIndex;
              const p = points[idx];
              if (!p) return `#${(idx ?? 0) + 1}`;
              return `#${(p._origIndex ?? idx) + 1} · ${p.fecha || '—'} · ${p.tipoHormigon || ''}`;
            },
            afterLabel: (ctx) => {
              const idx = ctx.dataIndex;
              const p = points[idx];
              if (!p) return null;
              const lines = [`Valor medido: ${formatNumber(p.valor, { precision: 2 })}`];
              if (p.alertaPlus) lines.push('⚠️ Alerta C+: drift positivo sostenido.');
              if (p.alertaMinus) lines.push('⚠️ Alerta C−: drift negativo sostenido.');
              return lines;
            },
          },
        },
      },
      scales: {
        y: {
          title: { display: true, text: 'Suma acumulada', color: titleColor },
          ticks: { color: tickColor },
          grid: { color: gridColor },
        },
        x: {
          title: { display: true, text: 'Punto cronológico', color: titleColor },
          ticks: { color: tickColor, maxRotation: 60, minRotation: 45, autoSkip: true, maxTicksLimit: 30 },
          grid: { color: gridColor },
        },
      },
    };
  }, [points, isDark]);

  const tipoOpts = [{ label: 'Todos los tipos', value: null }, ...tipos];

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
        <PageHeader
          icon="fa-solid fa-chart-line"
          title="CUSUM"
          subtitle="Suma acumulada — detecta drift sostenido de la media (0,5σ–1,5σ) antes que la carta Shewhart"
        />

        {/* PR9 NO aplica acá: CUSUM es control estadístico sobre
            ensayos de probetas ya colocadas. La dualidad
            prescriptivo/prestacional solo aplica a evaluación de
            aptitud de materiales y dosificaciones — la norma es
            soberana siempre cuando el hormigón ya está colocado. */}

        <Panel
          header={<span><i className="fa-solid fa-circle-question mr-2" />¿Cómo funciona y cómo se lee?</span>}
          toggleable
          collapsed
          className="w-full mb-3"
        >
          <div className="grid">
            <div className="col-12 lg:col-6">
              <h4 className="mt-0">¿Qué es CUSUM?</h4>
              <p className="text-sm line-height-3 text-color-secondary">
                <strong>Cumulative Sum</strong> (suma acumulada). En cada ensayo computa la desviación
                respecto del <em>target</em>, le resta un <em>slack</em> (k) y la acumula. Detecta
                <strong> drifts pequeños y sostenidos</strong> (0,5σ–1,5σ) que la carta Shewhart no
                flagea hasta cruzar ±3σ. Útil para anticipar problemas de cemento, agregados o relación
                a/c <em>antes</em> de que un lote se rechace.
              </p>
              <p className="text-xs text-color-secondary mt-1">
                <i className="fa-solid fa-scale-balanced mr-1" />
                <strong>Anclaje normativo:</strong> IRAM 1666:2020 §A.7.10.1.2 valida explícitamente
                CUSUM ("sumas acumulativas") como método alternativo de evaluación analítica de
                conformidad. Referencias internacionales: EN 206:2013+A1:2016, CEN/TR 16369,
                NIST/SEMATECH §6.3.2.
              </p>

              <h4>Cómo leer el gráfico</h4>
              <ul className="text-sm line-height-3 text-color-secondary pl-3 mt-1 mb-0">
                <li><span style={{ color: CHART_COLORS.cPlus, fontWeight: 'bold' }}>● Línea azul (C+)</span>: acumulado de desviaciones positivas. Sube cuando las resistencias quedan sistemáticamente <strong>por encima</strong> del target.</li>
                <li><span style={{ color: CHART_COLORS.cMinus, fontWeight: 'bold' }}>● Línea naranja (C−)</span>: acumulado de desviaciones negativas (graficado en el eje negativo). Cuando se aleja del cero hacia abajo, las resistencias caen <strong>por debajo</strong> del target.</li>
                <li><span style={{ color: CHART_COLORS.alert, fontWeight: 'bold' }}>▲ Triángulos rojos</span>: el punto en que C+ o C− cruzó ±h → señal de alarma.</li>
                <li><span style={{ color: CHART_COLORS.threshold }}>--- Líneas punteadas ±h</span>: umbral de detección. Cuanto más tiempo se mantiene la curva pegada al umbral, más fuerte es el drift.</li>
              </ul>
            </div>

            <div className="col-12 lg:col-6">
              <h4 className="mt-0">Parámetros ajustables</h4>
              <ul className="text-sm line-height-3 text-color-secondary pl-3 mt-1 mb-3">
                <li><strong>Target (MPa)</strong>: valor de referencia. <em>Auto</em> = media de la serie. Para control normativo, ingresar el f'c objetivo (ej. 30 MPa).</li>
                <li><strong>σ</strong>: <em>overall variation</em> (desviación estándar del proceso). <em>Auto</em> = σ muestral de la serie. Para control objetivo, ingresar el σ histórico de la planta. Los presets sugeridos siguen la clasificación cualitativa de <strong>ACI 214R-11</strong> (Excelente/Muy bueno/Bueno/Aceptable/Deficiente).</li>
                <li><strong>k (σ)</strong>: <em>slack</em> o sensibilidad. Default <strong>0,5σ</strong> — óptimo para detectar shifts de 1σ. Bajarlo aumenta sensibilidad pero genera más falsos positivos.</li>
                <li><strong>h (σ)</strong>: umbral de alarma. Default <strong>4σ</strong>. Subirlo reduce falsos positivos pero aumenta la latencia de detección.</li>
              </ul>

              <h4>Combinaciones típicas (NIST/SEMATECH §6.3.2)</h4>
              <table className="text-sm w-full" style={{ borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid var(--surface-border)' }}>
                    <th className="text-left p-1">k</th>
                    <th className="text-left p-1">h</th>
                    <th className="text-left p-1">ARL₀ (bajo control)</th>
                    <th className="text-left p-1">ARL₁ (shift 1σ)</th>
                  </tr>
                </thead>
                <tbody className="text-color-secondary">
                  <tr><td className="p-1">0,5σ</td><td className="p-1">4σ</td><td className="p-1">~168</td><td className="p-1">~8 (default)</td></tr>
                  <tr><td className="p-1">0,5σ</td><td className="p-1">5σ</td><td className="p-1">~465</td><td className="p-1">~10</td></tr>
                  <tr><td className="p-1">0,25σ</td><td className="p-1">8σ</td><td className="p-1">~741</td><td className="p-1">~17</td></tr>
                </tbody>
              </table>
              <p className="text-xs text-color-secondary mt-1 mb-0">
                <em>ARL = Average Run Length</em>. ARL₀ alto = pocos falsos positivos; ARL₁ bajo = detecta rápido el drift real.
              </p>
            </div>
          </div>
        </Panel>

        {/* ── 1. Filtros del análisis (qué ensayos entran al cálculo) ── */}
        <Card
          title={<span className="text-base"><i className="fa-solid fa-filter mr-2 text-primary" />Filtros del análisis</span>}
          className="w-full mb-3"
        >
          <div className="grid">
            <div className="col-12 md:col-6 lg:col-6">
              <label className="text-sm font-semibold mb-1 block">Tipo de hormigón</label>
              <Dropdown
                value={filters.idTipoHormigon}
                options={tipoOpts}
                onChange={(e) => setFilters((f) => ({ ...f, idTipoHormigon: e.value }))}
                placeholder="Todos"
                className="w-full"
              />
              <small className="text-color-secondary">Filtra los ensayos de probetas a analizar.</small>
            </div>
            <div className="col-6 md:col-3 lg:col-3">
              <label className="text-sm font-semibold mb-1 block">Desde</label>
              <Calendar value={filters.desde} onChange={(e) => setFilters((f) => ({ ...f, desde: e.value }))} dateFormat="dd/mm/yy" showButtonBar className="w-full" />
            </div>
            <div className="col-6 md:col-3 lg:col-3">
              <label className="text-sm font-semibold mb-1 block">Hasta</label>
              <Calendar value={filters.hasta} onChange={(e) => setFilters((f) => ({ ...f, hasta: e.value }))} dateFormat="dd/mm/yy" showButtonBar className="w-full" />
            </div>
          </div>
        </Card>

        {/* ── 2. Parámetros del cálculo CUSUM ── */}
        <Card
          title={<span className="text-base"><i className="fa-solid fa-sliders mr-2 text-primary" />Parámetros del cálculo</span>}
          className="w-full mb-3"
        >
          <div className="grid">

            {/* Valor objetivo (target) */}
            <div className="col-12 md:col-6">
              <label className="text-sm font-semibold mb-1 block">
                Valor objetivo (target) <span className="text-color-secondary font-normal">— MPa</span>
              </label>
              <InputNumber
                key={`target-${targetKey}`}
                value={params.target}
                onValueChange={(e) => setParams((p) => ({ ...p, target: e.value }))}
                placeholder="auto — media de la serie"
                minFractionDigits={1}
                maxFractionDigits={2}
                suffix=" MPa"
                className="w-full"
                inputClassName="w-full"
              />
              <small className="text-color-secondary block mt-1">
                Resistencia de referencia contra la que se compara cada ensayo. Vacío = usa la media de la serie filtrada.
              </small>
              <div className="flex flex-wrap align-items-center gap-1 mt-2">
                <Button
                  label="Auto"
                  severity={params.target == null ? 'primary' : 'secondary'}
                  outlined={params.target != null}
                  size="small"
                  onClick={() => setTargetFromChip(null)}
                  className="py-1 px-2 text-xs"
                />
                {TARGET_PRESETS.map((t) => (
                  <Button
                    key={t.clase}
                    label={`${t.clase} (${t.value})`}
                    severity={params.target === t.value ? 'primary' : 'secondary'}
                    outlined={params.target !== t.value}
                    size="small"
                    onClick={() => setTargetFromChip(t.value)}
                    className="py-1 px-2 text-xs"
                  />
                ))}
                <small className="text-color-secondary ml-2">Clases CIRSOC 201</small>
              </div>
            </div>

            {/* Desviación estándar (σ) */}
            <div className="col-12 md:col-6">
              <label className="text-sm font-semibold mb-1 block">
                Desviación estándar del proceso (σ) <span className="text-color-secondary font-normal">— MPa</span>
              </label>
              <InputNumber
                key={`sigma-${sigmaKey}`}
                value={params.sigma}
                onValueChange={(e) => setParams((p) => ({ ...p, sigma: e.value }))}
                placeholder="auto — σ muestral"
                minFractionDigits={1}
                maxFractionDigits={2}
                suffix=" MPa"
                className="w-full"
                inputClassName="w-full"
              />
              <small className="text-color-secondary block mt-1">
                Variabilidad del proceso productivo (<em>overall variation</em>). Vacío = usa el σ muestral calculado de la serie.
              </small>
              <div className="flex flex-wrap align-items-center gap-1 mt-2">
                <Button
                  label="Auto"
                  severity={params.sigma == null ? 'primary' : 'secondary'}
                  outlined={params.sigma != null}
                  size="small"
                  onClick={() => setSigmaFromChip(null)}
                  className="py-1 px-2 text-xs"
                />
                {SIGMA_PRESETS.map((s) => (
                  <Button
                    key={s.label}
                    label={s.label}
                    tooltip={s.calidad}
                    tooltipOptions={{ position: 'top' }}
                    severity={params.sigma === s.value ? 'primary' : 'secondary'}
                    outlined={params.sigma !== s.value}
                    size="small"
                    onClick={() => setSigmaFromChip(s.value)}
                    className="py-1 px-2 text-xs"
                  />
                ))}
                <small className="text-color-secondary ml-2">
                  <span title="Clasificación de calidad del control según ACI 214R-11 (overall variation): <2,8 Excelente · 2,8-3,4 Muy bueno · 3,4-4,1 Bueno · 4,1-4,8 Aceptable · >4,8 Deficiente.">
                    Calidad control ACI 214R-11 <i className="fa-solid fa-circle-info" />
                  </span>
                </small>
              </div>
            </div>

            {/* Sensibilidad (k) */}
            <div className="col-12 md:col-6">
              <label className="text-sm font-semibold mb-1 block">
                Sensibilidad k (slack) <span className="text-color-secondary font-normal">— unidades de σ</span>
              </label>
              <Dropdown
                value={params.kSigmas}
                options={K_PRESETS}
                onChange={(e) => setParams((p) => ({ ...p, kSigmas: e.value }))}
                className="w-full"
                valueTemplate={(opt) => opt ? <span>{opt.value.toString().replace('.', ',')}σ — {opt.label.split('—')[1]?.trim()}</span> : null}
              />
              <small className="text-color-secondary block mt-1">
                Cuán reactivo es a desvíos pequeños. Default <strong>0,5σ</strong> detecta shifts ≥1σ óptimamente.
              </small>
            </div>

            {/* Umbral (h) */}
            <div className="col-12 md:col-6">
              <label className="text-sm font-semibold mb-1 block">
                Umbral de alarma h <span className="text-color-secondary font-normal">— unidades de σ</span>
              </label>
              <Dropdown
                value={params.hSigmas}
                options={H_PRESETS}
                onChange={(e) => setParams((p) => ({ ...p, hSigmas: e.value }))}
                className="w-full"
                valueTemplate={(opt) => opt ? <span>{opt.value}σ — {opt.label.split('—')[1]?.trim()}</span> : null}
              />
              <small className="text-color-secondary block mt-1">
                Cuándo dispara la alarma. Default <strong>4σ</strong> da ARL₀ ≈ 168 puntos bajo control. Subirlo reduce falsos positivos.
              </small>
            </div>

          </div>
        </Card>

        {loading ? (
          <div className="w-full flex justify-content-center p-5"><ProgressSpinner /></div>
        ) : !points.length ? (
          <Message severity="info" className="w-full" text="No hay ensayos en el rango seleccionado." />
        ) : (
          <>
            {stats?.totalAlertas > 0 && (
              <Message
                severity="warn"
                className="w-full mb-3"
                text={`CUSUM detectó ${stats.totalAlertas} alerta(s) (C+: ${stats.alertasPlus}, C−: ${stats.alertasMinus}). El proceso muestra drift sostenido respecto del target.`}
              />
            )}

            <div className="grid mb-3 w-full">
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">Target</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.target, { precision: 2 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">σ del proceso</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.sigma, { precision: 3 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">k (slack)</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.k, { precision: 3 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">h (umbral)</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.h, { precision: 2 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">Alertas C+</div>
                  <div className="text-900 font-bold text-xl" style={{ color: stats.alertasPlus ? 'var(--red-500)' : 'var(--green-500)' }}>{stats.alertasPlus}</div>
                </Card>
              </div>
              <div className="col-12 md:col-2">
                <Card className="text-center shadow-1">
                  <div className="text-500 text-sm">Alertas C−</div>
                  <div className="text-900 font-bold text-xl" style={{ color: stats.alertasMinus ? 'var(--red-500)' : 'var(--green-500)' }}>{stats.alertasMinus}</div>
                </Card>
              </div>
            </div>

            <div className="flex flex-wrap align-items-center justify-content-between mb-2 gap-2">
              <span className="text-sm text-color-secondary">
                Mostrando <strong>{points.length}</strong> de {allPoints.length} ensayos
                {allPoints.length > points.length && (
                  <> · <span className="text-primary">últimos {points.length}</span></>
                )}
              </span>
              <div className="flex align-items-center gap-2">
                <label className="text-xs text-500 font-semibold uppercase">Ventana</label>
                <Dropdown
                  value={ventana}
                  options={[
                    { label: 'Últimos 100', value: 100 },
                    { label: 'Últimos 200', value: 200 },
                    { label: 'Últimos 500', value: 500 },
                    { label: 'Todos', value: null },
                  ]}
                  onChange={(e) => setVentana(e.value)}
                  className="w-12rem"
                />
              </div>
            </div>

            <TabView className="w-full" activeIndex={selectedEdad === 7 ? 0 : 1} onTabChange={(e) => setSelectedEdad(e.index === 0 ? 7 : 28)}>
              <TabPanel header="7 días">
                <Card className="shadow-1">
                  {chartData ? (
                    <div style={{ height: 'clamp(320px, 50vh, 480px)' }}>
                      <PrimeChart type="line" data={chartData} options={chartOptions} style={{ height: '100%' }} />
                    </div>
                  ) : <p className="text-500 text-center p-4">Sin puntos para graficar.</p>}
                </Card>
              </TabPanel>
              <TabPanel header="28 días">
                <Card className="shadow-1">
                  {chartData ? (
                    <div style={{ height: 'clamp(320px, 50vh, 480px)' }}>
                      <PrimeChart type="line" data={chartData} options={chartOptions} style={{ height: '100%' }} />
                    </div>
                  ) : <p className="text-500 text-center p-4">Sin puntos para graficar.</p>}
                </Card>
              </TabPanel>
            </TabView>

            {/* Interpretación dinámica — lee stats y traduce a lenguaje
                operativo. Tres dimensiones: intensidad (ratio alertas/n),
                signo dominante (drift positivo vs negativo) y diagnóstico
                de configuración (si target/σ auto pueden estar inflando
                las alertas). */}
            {stats && allPoints.length > 0 && (() => {
              const n = allPoints.length;
              const total = (stats.alertasPlus || 0) + (stats.alertasMinus || 0);
              const ratio = total / n;
              const dominaPlus = stats.alertasPlus > stats.alertasMinus * 1.5;
              const dominaMinus = stats.alertasMinus > stats.alertasPlus * 1.5;
              const targetAuto = params.target == null;
              const sigmaAuto = params.sigma == null;

              let nivel, severity, titulo;
              if (ratio < 0.05) {
                nivel = 'bajo'; severity = 'success';
                titulo = 'Proceso bajo control estadístico';
              } else if (ratio < 0.2) {
                nivel = 'medio'; severity = 'info';
                titulo = 'Drift puntual o cambio progresivo';
              } else if (ratio < 0.5) {
                nivel = 'alto'; severity = 'warn';
                titulo = 'Drift sostenido — revisar proceso';
              } else {
                nivel = 'muy alto'; severity = 'error';
                titulo = 'Proceso fuera de control consistente';
              }

              return (
                <Card className="w-full mt-3 shadow-1">
                  <div className="flex align-items-center gap-2 mb-2">
                    <i className="fa-solid fa-lightbulb text-primary" />
                    <h4 className="m-0">Interpretación de los resultados</h4>
                    <Tag severity={severity} value={titulo} />
                  </div>

                  <div className="text-sm line-height-3">
                    <p className="mt-2 mb-2">
                      Se procesaron <strong>{n}</strong> ensayos. El CUSUM disparó <strong>{total}</strong> alerta(s)
                      ({stats.alertasPlus} en C+, {stats.alertasMinus} en C−) — eso es un{' '}
                      <strong>{(ratio * 100).toFixed(1)}%</strong> de los puntos. Ratio considerado{' '}
                      <strong>{nivel}</strong>.
                    </p>

                    {nivel === 'bajo' && (
                      <p className="m-0 text-color-secondary">
                        El proceso se mantiene estable respecto del target. No se observan corrimientos
                        sostenidos. Mantener los parámetros actuales y seguir monitoreando.
                      </p>
                    )}

                    {nivel === 'medio' && (
                      <p className="m-0 text-color-secondary">
                        Hay drifts puntuales o un cambio progresivo en el proceso. Revisar si coincide con
                        cambios de partida de cemento, de fuente de agregados, o ajustes recientes en la dosificación.
                        No es urgente pero conviene investigar el origen.
                      </p>
                    )}

                    {(nivel === 'alto' || nivel === 'muy alto') && (
                      <>
                        {dominaPlus && (
                          <p className="m-0 mb-2">
                            <i className="fa-solid fa-arrow-up text-blue-500 mr-1" />
                            <strong>Drift positivo predominante</strong> (C+ ≫ C−): las resistencias se ubican
                            sistemáticamente <strong>por encima del target</strong>. Posibles causas:
                            cemento mejor que el considerado, cambio de dosificación más conservadora,
                            mejora en agregados, o el target original quedó desactualizado.
                          </p>
                        )}
                        {dominaMinus && (
                          <p className="m-0 mb-2">
                            <i className="fa-solid fa-arrow-down text-orange-500 mr-1" />
                            <strong>Drift negativo predominante</strong> (C− ≫ C+): las resistencias caen
                            sistemáticamente <strong>por debajo del target</strong>. Investigar urgente:
                            relación a/c desviada, cemento de partida inferior, contaminación de agregados,
                            curado deficiente, error de calibración de prensa.
                          </p>
                        )}
                        {!dominaPlus && !dominaMinus && (
                          <p className="m-0 mb-2">
                            <i className="fa-solid fa-arrows-up-down text-purple-500 mr-1" />
                            Drift bidireccional balanceado: el proceso oscila alrededor del target con
                            corrimientos a ambos lados. Sugiere alta variabilidad (revisar σ del proceso)
                            más que un sesgo unidireccional.
                          </p>
                        )}

                        {(targetAuto || sigmaAuto) && (
                          <p className="m-0 mb-2 text-color-secondary">
                            <i className="fa-solid fa-triangle-exclamation text-yellow-500 mr-1" />
                            <strong>Verificar configuración antes de actuar:</strong> estás usando
                            {targetAuto ? ' target=auto (media de la serie)' : ''}
                            {targetAuto && sigmaAuto ? ' y' : ''}
                            {sigmaAuto ? ' σ=auto (σ muestral)' : ''}.
                            Si la serie contiene tipos de hormigón mezclados o cambios de receta, esos valores
                            "auto" pueden no reflejar un punto de control real. Probá ingresar el{' '}
                            f'c objetivo {targetAuto ? 'y σ histórico ' : ''}explícitos para una lectura
                            más significativa.
                          </p>
                        )}

                        {ratio >= 0.5 && (
                          <p className="m-0 text-color-secondary">
                            Con más del 50 % de puntos en alerta, es probable que <strong>k y h estén demasiado
                            sensibles</strong> para la variabilidad real del proceso, o que el target/σ no
                            sean los adecuados. Sugerido: subir h a 5σ o 6σ y comparar.
                          </p>
                        )}
                      </>
                    )}
                  </div>
                </Card>
              );
            })()}

            <p className="text-color-secondary text-sm mt-2">
              Parámetros NIST/SEMATECH §6.3.2: <strong>k=0,5σ</strong> y <strong>h=4σ</strong> dan ARL ≈ 8 puntos para detectar shifts de 1σ. Aumentar h reduce falsos positivos a costa de más latencia.
            </p>
          </>
        )}
      </div>
    </Fade>
  );
};

export default CusumPage;
