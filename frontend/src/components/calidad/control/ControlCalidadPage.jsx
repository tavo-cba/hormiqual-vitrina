import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Chart as PrimeChart } from 'primereact/chart';
import { Card } from 'primereact/card';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { Button } from 'primereact/button';
import { TabView, TabPanel } from 'primereact/tabview';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { SelectButton } from 'primereact/selectbutton';
import { ToggleButton } from 'primereact/togglebutton';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { dateToYMDLocal } from '../../../common/functions';
import { formatNumber } from '../../../lib/format';
import { useToast } from '../../../context/ToastContext';
import { useConfig } from '../../../context/ConfigContext';
import { getControlChart, getTiposHormigon } from '../../../services/controlCalidadService';
import { exportControlPDF, exportControlExcel } from '../exports/controlCalidadExport';

const edadOptions = [
  { label: '7 dias', value: 7 },
  { label: '28 dias', value: 28 },
];

const COLORS = {
  point: '#3B82F6',
  mean: '#10B981',
  sigma1: '#F59E0B',
  sigma2: '#F97316',
  sigma3: '#EF4444',
  violation: '#DC2626',
  target: '#8B5CF6',
};

const ControlCalidadPage = () => {
  const showToast = useToast();
  const cfg = useConfig();
  const chartRef = useRef(null);
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [selectedEdad, setSelectedEdad] = useState(28);
  const [normalizado, setNormalizado] = useState(false);
  const [filters, setFilters] = useState({
    idTipoHormigon: null,
    desde: null,
    hasta: null,
  });
  const [datosFirst, setDatosFirst] = useState(0);

  // Resetea paginación de la tab "Datos" al cambiar cualquier filtro
  // (regla CLAUDE.md: setFirst(0) al filtrar).
  useEffect(() => { setDatosFirst(0); }, [filters.idTipoHormigon, filters.desde, filters.hasta, selectedEdad, normalizado]);

  const fetchTipos = useCallback(async () => {
    try {
      const t = await getTiposHormigon();
      setTipos(t.map(x => ({ label: x.tipoHormigon, value: x.idTipoHormigon })));
    } catch (err) {
      console.error('[ControlCalidad] fetchTipos:', err);
      showToast('error', 'No se pudieron cargar los tipos de hormigón.');
    }
  }, [showToast]);

  // Determine if we should fetch: need either a tipo selected OR normalized mode
  const canFetch = !!filters.idTipoHormigon || normalizado;

  const fetchData = useCallback(async () => {
    if (!canFetch) {
      setData(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const params = {};
      if (filters.idTipoHormigon) params.idTipoHormigon = filters.idTipoHormigon;
      if (filters.desde) params.desde = dateToYMDLocal(filters.desde);
      if (filters.hasta) params.hasta = dateToYMDLocal(filters.hasta);
      if (normalizado) params.modo = 'normalizado';
      const d = await getControlChart(params);
      setData(d);
    } catch (err) {
      console.error('[ControlCalidad] fetchData:', err);
      showToast('error', 'No se pudo cargar la carta de control.');
    } finally {
      setLoading(false);
    }
  }, [filters, normalizado, canFetch, showToast]);

  useEffect(() => { fetchTipos(); }, [fetchTipos]);
  useEffect(() => { fetchData(); }, [fetchData]);

  const isNormMode = data?.modo === 'normalizado';
  const unitLabel = isNormMode ? '% del objetivo' : 'MPa';

  const currentData = data?.[`edad${selectedEdad}`];
  const { points = [], stats, westernElectric = [] } = currentData || {};

  // Build Shewhart chart
  const chartData = useMemo(() => {
    if (!points.length || !stats) return null;

    const labels = points.map((p, i) => `#${i + 1}`);
    const violationIndices = new Set(westernElectric.map(v => v.index));

    return {
      labels,
      datasets: [
        // Data points
        {
          label: isNormMode ? `% objetivo ${selectedEdad}d` : `Resistencia ${selectedEdad}d`,
          data: points.map(p => p.valor != null ? p.valor : p.resistencia),
          borderColor: COLORS.point,
          backgroundColor: points.map((_, i) =>
            violationIndices.has(i) ? COLORS.violation : COLORS.point
          ),
          pointRadius: points.map((_, i) => violationIndices.has(i) ? 6 : 3),
          pointStyle: points.map((_, i) => violationIndices.has(i) ? 'triangle' : 'circle'),
          tension: 0.1,
          fill: false,
          order: 1,
        },
        // Mean line
        {
          label: `Media (${stats.mean} ${unitLabel})`,
          data: Array(points.length).fill(stats.mean),
          borderColor: COLORS.mean,
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          order: 2,
        },
        // 100% reference line (only in normalized mode)
        ...(isNormMode ? [{
          label: '100% (objetivo)',
          data: Array(points.length).fill(100),
          borderColor: COLORS.target,
          borderDash: [6, 3],
          borderWidth: 2,
          pointRadius: 0,
          fill: false,
          order: 2,
        }] : []),
        // UCL 3σ
        {
          label: `UCL 3σ (${stats.ucl})`,
          data: Array(points.length).fill(stats.ucl),
          borderColor: COLORS.sigma3,
          borderDash: [8, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 3,
        },
        // LCL 3σ
        {
          label: `LCL 3σ (${stats.lcl})`,
          data: Array(points.length).fill(stats.lcl),
          borderColor: COLORS.sigma3,
          borderDash: [8, 4],
          borderWidth: 1.5,
          pointRadius: 0,
          fill: false,
          order: 3,
        },
        // ±2σ bands
        {
          label: `+2σ (${stats.ucl2})`,
          data: Array(points.length).fill(stats.ucl2),
          borderColor: COLORS.sigma2,
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 4,
        },
        {
          label: `−2σ (${stats.lcl2})`,
          data: Array(points.length).fill(stats.lcl2),
          borderColor: COLORS.sigma2,
          borderDash: [4, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 4,
        },
        // ±1σ bands
        {
          label: `+1σ (${stats.ucl1})`,
          data: Array(points.length).fill(stats.ucl1),
          borderColor: COLORS.sigma1,
          borderDash: [2, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 5,
        },
        {
          label: `−1σ (${stats.lcl1})`,
          data: Array(points.length).fill(stats.lcl1),
          borderColor: COLORS.sigma1,
          borderDash: [2, 4],
          borderWidth: 1,
          pointRadius: 0,
          fill: false,
          order: 5,
        },
      ],
    };
  }, [points, stats, westernElectric, selectedEdad, isNormMode, unitLabel]);

  const chartOptions = useMemo(() => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'nearest', intersect: true },
    plugins: {
      legend: { position: 'bottom', labels: { usePointStyle: true, boxWidth: 10, font: { size: 11 } } },
      tooltip: {
        callbacks: {
          title: (items) => {
            const idx = items[0]?.dataIndex;
            const p = points[idx];
            if (!p) return '';
            return `${p.tipoHormigon} — ${p.fecha}`;
          },
          afterBody: (items) => {
            const idx = items[0]?.dataIndex;
            const p = points[idx];
            if (!p) return '';
            const lines = [];
            if (p.remito) lines.push(`Remito: ${p.remito}`);
            if (p.target) lines.push(`Target: ${p.target} MPa`);
            if (isNormMode) lines.push(`Resistencia: ${p.resistencia} MPa`);
            const v = westernElectric.filter(w => w.index === idx);
            if (v.length) lines.push(`Regla ${v.map(w => w.rule).join(', ')}`);
            return lines;
          },
        },
      },
    },
    scales: {
      y: {
        title: { display: true, text: unitLabel },
      },
      x: {
        title: { display: true, text: 'Ensayo' },
      },
    },
  }), [points, westernElectric, isNormMode, unitLabel]);

  // Histogram data
  // CTL-07 fix (sesión 2026-05-09): el último bin usaba `v < b + binSize`
  // que excluye el valor máximo exacto (típico en histogramas con valores
  // enteros como resistencias en MPa). Ahora el último bin acepta `v <= max`.
  const histogramData = useMemo(() => {
    if (!points.length) return null;
    const values = points.map(p => p.valor != null ? p.valor : p.resistencia);
    const min = Math.floor(Math.min(...values));
    const max = Math.ceil(Math.max(...values));
    const binSize = Math.max(1, Math.round((max - min) / 10));
    const bins = [];
    for (let b = min; b <= max; b += binSize) {
      const isLast = (b + binSize) > max;
      const count = values.filter(v => v >= b && (isLast ? v <= max : v < b + binSize)).length;
      bins.push({ label: `${b}–${b + binSize}`, count });
    }
    return {
      labels: bins.map(b => b.label),
      datasets: [{
        label: 'Frecuencia',
        data: bins.map(b => b.count),
        backgroundColor: '#3B82F680',
        borderColor: '#3B82F6',
        borderWidth: 1,
      }],
    };
  }, [points]);

  /* Capacidad del proceso (Cpk inferior) — sesión 2026-05-09.
   *
   * Hormigón típicamente tiene SPEC unilateral: f'c es el límite
   * inferior (LSL); no hay USL operativo (más resistencia no es
   * problema). Por eso solo calculamos Cpk inferior:
   *   CpkL = (μ − LSL) / (3σ)
   *
   * Interpretación industrial:
   *   < 1,00 → proceso incapaz, defectos esperados.
   *   1,00–1,33 → mínimo aceptable, requiere control estricto.
   *   1,33–1,67 → bueno (defectos < 64 ppm).
   *   > 1,67 → excelente.
   *
   * Solo se calcula si todos los puntos comparten el mismo target
   * (tipo de hormigón único o modo normalizado). Sino devuelve null.
   */
  const cpk = useMemo(() => {
    if (!points.length || !stats || !stats.sd || stats.sd === 0) return null;
    const targets = [...new Set(points.map(p => p.target).filter(Number.isFinite))];
    if (targets.length !== 1) return null;
    const lsl = isNormMode ? 100 : targets[0];
    const cpkL = (stats.mean - lsl) / (3 * stats.sd);
    let nivel;
    if (cpkL < 1) nivel = 'incapaz';
    else if (cpkL < 1.33) nivel = 'minimo';
    else if (cpkL < 1.67) nivel = 'bueno';
    else nivel = 'excelente';
    return { cpkL, lsl, nivel };
  }, [points, stats, isNormMode]);

  const histogramOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { display: false } },
    scales: {
      y: { title: { display: true, text: 'Frecuencia' }, beginAtZero: true },
      x: { title: { display: true, text: unitLabel } },
    },
  };

  const ruleSeverity = (rule) => {
    if (rule === 1) return 'danger';
    if (rule === 2) return 'warning';
    return 'info';
  };

  // Prompt state: no tipo selected and not in normalized mode
  const showSelectPrompt = !canFetch && !loading;

  const hasExportableData = !!points.length && !loading;

  const handleExportPDF = async () => {
    if (!hasExportableData) return;
    setExporting(true);
    try {
      // PrimeReact Chart expone getCanvas() via ref → toDataURL para
      // embeber la imagen del Shewhart chart en el PDF.
      let chartImageDataUrl = null;
      try {
        const canvas = chartRef.current?.getCanvas?.();
        if (canvas?.toDataURL) chartImageDataUrl = canvas.toDataURL('image/png', 1.0);
      } catch { /* chart no listo, exportar sin imagen */ }
      await exportControlPDF({
        data,
        selectedEdad,
        filters,
        tipos,
        westernElectric,
        cpk,
        chartImageDataUrl,
        configEmpresa: {
          thumbnail: cfg?.thumbnail,
          nombreEmpresa: cfg?.nombreEmpresa,
        },
      });
    } catch (err) {
      console.error('[ControlCalidad] exportPDF:', err);
      showToast('error', 'No se pudo generar el PDF.');
    } finally {
      setExporting(false);
    }
  };

  const handleExportExcel = () => {
    if (!hasExportableData) return;
    setExporting(true);
    try {
      exportControlExcel({ data, selectedEdad, filters, tipos, westernElectric, cpk });
    } catch (err) {
      console.error('[ControlCalidad] exportExcel:', err);
      showToast('error', 'No se pudo generar el Excel.');
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-3">
      <PageHeader
        icon="fa-solid fa-clipboard-check"
        title="Control Estadistico"
        subtitle="Graficos de control de Shewhart con reglas de Western Electric para seguimiento de resistencia."
      />

      {/* PR9 NO aplica acá: el SPC trabaja sobre ensayos de probetas
          ya colocadas. El criterio normativo es contractual (CIRSOC
          §6.2.3 / §6.2.4 + IRAM 1666 §A.7.10) y la norma es soberana
          siempre. El catálogo del tenant no puede relativizar f'c.
          Ver CLAUDE.md raíz §"Modelo dual de evaluación". */}

      {/* Filters */}
      <div className="flex flex-wrap gap-2 mb-3 align-items-end">
        <div>
          <label className="block text-sm mb-1">Tipo hormigon {!normalizado && <span style={{ color: 'var(--red-500)' }}>*</span>}</label>
          <Dropdown
            value={filters.idTipoHormigon}
            options={tipos}
            onChange={(e) => setFilters(f => ({ ...f, idTipoHormigon: e.value }))}
            placeholder="Seleccionar tipo"
            showClear
            className={`w-12rem ${!filters.idTipoHormigon && !normalizado ? 'p-invalid' : ''}`}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Desde</label>
          <Calendar
            value={filters.desde}
            onChange={(e) => setFilters(f => ({ ...f, desde: e.value }))}
            dateFormat="dd/mm/yy"
            showIcon
            className="w-10rem"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Hasta</label>
          <Calendar
            value={filters.hasta}
            onChange={(e) => setFilters(f => ({ ...f, hasta: e.value }))}
            dateFormat="dd/mm/yy"
            showIcon
            className="w-10rem"
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Edad</label>
          <SelectButton
            value={selectedEdad}
            options={edadOptions}
            onChange={(e) => e.value != null && setSelectedEdad(e.value)}
          />
        </div>
        <div>
          <label className="block text-sm mb-1">Modo</label>
          <ToggleButton
            checked={normalizado}
            onChange={(e) => setNormalizado(e.value)}
            onLabel="% objetivo"
            offLabel="MPa absoluto"
            onIcon="fa-solid fa-percent"
            offIcon="fa-solid fa-ruler-vertical"
            className="w-10rem"
          />
        </div>
        <Button
          icon="pi pi-refresh"
          label="Actualizar"
          onClick={fetchData}
          severity="secondary"
          outlined
          disabled={!canFetch}
        />
        <Button
          icon="pi pi-file-pdf"
          label="PDF"
          onClick={handleExportPDF}
          severity="danger"
          outlined
          disabled={!hasExportableData || exporting}
          loading={exporting}
          tooltip="Exportar carta de control a PDF"
          tooltipOptions={{ position: 'top' }}
        />
        <Button
          icon="pi pi-file-excel"
          label="Excel"
          onClick={handleExportExcel}
          severity="success"
          outlined
          disabled={!hasExportableData || exporting}
          tooltip="Exportar datos y violaciones a Excel"
          tooltipOptions={{ position: 'top' }}
        />
      </div>

      {/* Normalized mode info */}
      {normalizado && !filters.idTipoHormigon && (
        <Message
          severity="info"
          text="Modo normalizado: cada ensayo se muestra como % de su resistencia objetivo. Esto permite comparar distintos tipos de hormigon en una misma carta."
          className="w-full mb-3"
        />
      )}

      {showSelectPrompt ? (
        <Card className="shadow-1">
          <div className="flex flex-column align-items-center justify-content-center p-6 gap-3">
            <i className="fa-solid fa-chart-line" style={{ fontSize: '3rem', opacity: 0.2 }} />
            <h3 className="m-0">Selecciona un tipo de hormigon</h3>
            <p className="text-500 text-center m-0">
              La carta de control requiere analizar un tipo de hormigon a la vez para que los limites estadisticos tengan sentido.
              <br />
              Alternativamente, activa el modo <strong>% objetivo</strong> para ver todos los tipos normalizados.
            </p>
          </div>
        </Card>
      ) : loading ? (
        <div className="flex justify-content-center p-6">
          <ProgressSpinner style={{ width: 50, height: 50 }} />
        </div>
      ) : !currentData || !points.length ? (
        <Message severity="info" text="Sin datos para los filtros seleccionados." className="w-full" />
      ) : (
        <>
          {/* Stats summary */}
          {stats && (
            <div className="grid mb-3">
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">n</div>
                  <div className="text-900 font-bold text-xl">{stats.n}</div>
                </Card>
              </div>
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">Media</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.mean, { precision: 2 })} {unitLabel}</div>
                </Card>
              </div>
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">Desvio (σ)</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.sd, { precision: 2 })} {unitLabel}</div>
                </Card>
              </div>
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">UCL (3σ)</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.ucl, { precision: 2 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">LCL (3σ)</div>
                  <div className="text-900 font-bold text-xl">{formatNumber(stats.lcl, { precision: 2 })}</div>
                </Card>
              </div>
              <div className="col-12 md:col-6 lg:col-2">
                <Card className="shadow-1 text-center">
                  <div className="text-500 text-sm">Violaciones WE</div>
                  <div className="text-900 font-bold text-xl" style={{ color: westernElectric.length ? 'var(--red-500)' : 'var(--green-500)' }}>
                    {westernElectric.length}
                  </div>
                </Card>
              </div>
              {cpk && (
                <div className="col-12 md:col-6 lg:col-2">
                  <Card
                    className="shadow-1 text-center"
                    title={`Capacidad inferior del proceso. LSL = ${formatNumber(cpk.lsl, { precision: 2 })} ${unitLabel}. ` +
                      'Interpretación: <1,00 incapaz · 1,00-1,33 mínimo · 1,33-1,67 bueno · >1,67 excelente.'}
                  >
                    <div className="text-500 text-sm">Cpk inferior</div>
                    <div
                      className="text-900 font-bold text-xl"
                      style={{
                        color:
                          cpk.nivel === 'incapaz' ? 'var(--red-500)' :
                            cpk.nivel === 'minimo' ? 'var(--orange-500)' :
                              cpk.nivel === 'bueno' ? 'var(--green-500)' : 'var(--blue-500)',
                      }}
                    >
                      {formatNumber(cpk.cpkL, { precision: 2 })}
                    </div>
                    <div className="text-xs text-color-secondary mt-1" style={{ textTransform: 'capitalize' }}>{cpk.nivel}</div>
                  </Card>
                </div>
              )}
            </div>
          )}

          {/* CTL-24: banner global cuando hay violaciones WE — el usuario
              debe verlo de un vistazo, no recién al abrir el tab dedicado. */}
          {westernElectric.length > 0 && (
            <Message
              severity="warn"
              className="w-full mb-3"
              text={
                `Se detectaron ${westernElectric.length} violación(es) de Western Electric. ` +
                `El proceso muestra señales de fuera de control estadístico — revisar el tab "Reglas Western Electric".`
              }
            />
          )}

          <TabView>
            {/* Shewhart Chart */}
            <TabPanel header="Grafico de Control" leftIcon="pi pi-chart-line mr-2">
              <Card className="shadow-1">
                {chartData ? (
                  <div style={{ height: 420 }}>
                    <PrimeChart ref={chartRef} type="line" data={chartData} options={chartOptions} style={{ height: '100%' }} />
                  </div>
                ) : (
                  <p className="text-500 text-center p-4">Sin puntos para graficar.</p>
                )}
              </Card>
            </TabPanel>

            {/* Histogram */}
            <TabPanel header="Histograma" leftIcon="pi pi-chart-bar mr-2">
              <Card className="shadow-1">
                {histogramData ? (
                  <div style={{ height: 350 }}>
                    <PrimeChart type="bar" data={histogramData} options={histogramOptions} style={{ height: '100%' }} />
                  </div>
                ) : (
                  <p className="text-500 text-center p-4">Sin datos.</p>
                )}
              </Card>
            </TabPanel>

            {/* Western Electric Rules */}
            <TabPanel header="Reglas Western Electric" leftIcon="pi pi-exclamation-triangle mr-2">
              <Card className="shadow-1">
                <div className="mb-3">
                  <h4 className="mt-0 mb-2">Reglas aplicadas:</h4>
                  <ul className="text-sm text-600 line-height-3 pl-3">
                    <li><strong>Regla 1:</strong> Un punto mas alla de 3σ del centro.</li>
                    <li><strong>Regla 2:</strong> 2 de 3 puntos consecutivos mas alla de 2σ (mismo lado).</li>
                    <li><strong>Regla 3:</strong> 4 de 5 puntos consecutivos mas alla de 1σ (mismo lado).</li>
                    <li><strong>Regla 4:</strong> 8 puntos consecutivos del mismo lado de la linea central.</li>
                  </ul>
                </div>

                {westernElectric.length === 0 ? (
                  <Message severity="success" text="No se detectaron violaciones. El proceso esta bajo control estadistico." className="w-full" />
                ) : (
                  <DataTable responsiveLayout="scroll" value={westernElectric} size="small" stripedRows>
                    <Column field="index" header="Punto #" body={(row) => `#${row.index + 1}`} style={{ width: '80px' }} />
                    <Column
                      field="rule"
                      header="Regla"
                      body={(row) => <Tag value={`Regla ${row.rule}`} severity={ruleSeverity(row.rule)} />}
                      style={{ width: '100px' }}
                    />
                    <Column
                      field="range"
                      header="Rango"
                      body={(row) => row.range ? `#${row.range[0] + 1}–#${row.range[1] + 1}` : `#${row.index + 1}`}
                      style={{ width: '110px' }}
                    />
                    <Column
                      field="side"
                      header="Lado"
                      body={(row) => row.side ? (
                        <Tag
                          value={row.side === 'above' ? 'Sobre media' : 'Bajo media'}
                          severity={row.side === 'above' ? 'info' : 'warning'}
                        />
                      ) : null}
                      style={{ width: '130px' }}
                    />
                    <Column field="message" header="Descripcion" />
                  </DataTable>
                )}
              </Card>
            </TabPanel>

            {/* Data Table */}
            <TabPanel header="Datos" leftIcon="pi pi-table mr-2">
              <Card className="shadow-1">
                <DataTable responsiveLayout="scroll"
                  value={points}
                  size="small"
                  stripedRows
                  paginator
                  rows={20}
                  first={datosFirst}
                  onPage={(e) => setDatosFirst(e.first)}
                  emptyMessage="Sin datos."
                  sortField="fecha"
                  sortOrder={1}
                >
                  <Column header="#" body={(_, opts) => opts.rowIndex + 1} style={{ width: '50px' }} />
                  <Column field="fecha" header="Fecha ensayo" sortable />
                  <Column field="fechaDespacho" header="Fecha despacho" sortable />
                  <Column field="remito" header="Remito" />
                  <Column field="tipoHormigon" header="Tipo H" />
                  <Column field="resistencia" header="Resistencia (MPa)" sortable />
                  <Column field="target" header="Target" />
                  {isNormMode && (
                    <Column field="valor" header="% objetivo" sortable body={(row) => `${row.valor}%`} />
                  )}
                </DataTable>
              </Card>
            </TabPanel>
          </TabView>
        </>
      )}
    </div>
  );
};

export default ControlCalidadPage;
