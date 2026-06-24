import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart as PrimeChart } from 'primereact/chart';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Card } from 'primereact/card';
import { Dropdown } from 'primereact/dropdown';
import { Calendar } from 'primereact/calendar';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { dateToYMDLocal } from '../../../../common/functions';
import { formatNumber } from '../../../../lib/format';
import { useToast } from '../../../../context/ToastContext';
import { useConfig } from '../../../../context/ConfigContext';
import { getDashboard, getTiposHormigon } from '../../../../services/controlCalidadService';
import { listarAlertas, contarPendientes } from '../../../../services/alertaCalidadService';
import { exportTenantPDF, exportTenantExcel } from '../../exports/tableroCalidadExport';

/**
 * Tablero Calidad — vista del tenant (KPIs cross-planta, evolución
 * 28d, CV mensual, summary by tipo, actividad reciente).
 *
 * Extraído del antiguo TableroCalidadPage para que el nuevo wrapper
 * (con TabView) la componga junto con TableroPlantaView.
 */
const KpiCard = ({ label, value, icon, color, suffix = '' }) => (
  <div className="col-12 md:col-6 lg:col-3 xl:col-2">
    <Card className="shadow-1 h-full">
      <div className="flex align-items-center gap-3">
        <div
          className="flex align-items-center justify-content-center border-circle"
          style={{ width: 48, height: 48, backgroundColor: `${color}20`, color }}
        >
          <i className={icon} style={{ fontSize: '1.2rem' }} />
        </div>
        <div>
          <div className="text-500 text-sm">{label}</div>
          <div className="text-900 font-bold text-xl">
            {value != null ? `${value}${suffix}` : '—'}
          </div>
        </div>
      </div>
    </Card>
  </div>
);

const TableroTenantView = () => {
  const navigate = useNavigate();
  const showToast = useToast();
  const cfg = useConfig();
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState(null);
  const [tipos, setTipos] = useState([]);
  const [filters, setFilters] = useState({
    idTipoHormigon: null,
    desde: null,
    hasta: null,
  });
  const [alertasPendientes, setAlertasPendientes] = useState([]);
  const [alertCount, setAlertCount] = useState(0);
  const [recentFirst, setRecentFirst] = useState(0);

  useEffect(() => { setRecentFirst(0); }, [filters.idTipoHormigon, filters.desde, filters.hasta]);

  const fetchTipos = useCallback(async () => {
    try {
      const t = await getTiposHormigon();
      setTipos(t.map(x => ({ label: x.tipoHormigon, value: x.idTipoHormigon })));
    } catch (err) {
      console.error('[TableroTenant] fetchTipos:', err);
      showToast('error', 'No se pudieron cargar los tipos de hormigón.');
    }
  }, [showToast]);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filters.idTipoHormigon) params.idTipoHormigon = filters.idTipoHormigon;
      if (filters.desde) params.desde = dateToYMDLocal(filters.desde);
      if (filters.hasta) params.hasta = dateToYMDLocal(filters.hasta);
      const d = await getDashboard(params);
      setData(d);
    } catch (err) {
      console.error('[TableroTenant] fetchData:', err);
      showToast('error', 'No se pudo cargar el tablero de calidad.');
    } finally {
      setLoading(false);
    }
  }, [filters, showToast]);

  const fetchAlertas = useCallback(async () => {
    try {
      const [count, result] = await Promise.all([
        contarPendientes(),
        listarAlertas({ estado: 'PENDIENTE', limit: 5 }),
      ]);
      setAlertCount(count);
      setAlertasPendientes(Array.isArray(result) ? result : result.rows || []);
    } catch (err) {
      console.error('[TableroTenant] fetchAlertas:', err);
    }
  }, []);

  useEffect(() => { fetchTipos(); }, [fetchTipos]);
  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchAlertas(); }, [fetchAlertas]);

  const evoData = data?.evolution;
  const evoSeries = evoData?.series || [];
  const evoNorm = evoData?.normalizado;

  const evolutionChartData = evoSeries.length ? {
    labels: evoSeries.map(e => e.label),
    datasets: [
      {
        label: evoNorm ? 'Media 28d (% objetivo)' : 'Media 28d (MPa)',
        data: evoSeries.map(e => e.media),
        borderColor: '#3B82F6',
        backgroundColor: '#3B82F620',
        fill: true,
        tension: 0.3,
      },
      ...(!evoNorm ? [{
        label: "f'ck (MPa)",
        data: evoSeries.map(e => e.fck),
        borderColor: '#EF4444',
        borderDash: [5, 5],
        fill: false,
        tension: 0.3,
      }] : [{
        label: '100% (objetivo)',
        data: Array(evoSeries.length).fill(100),
        borderColor: '#10B981',
        borderDash: [5, 5],
        borderWidth: 1.5,
        pointRadius: 0,
        fill: false,
      }]),
    ],
  } : null;

  const evolutionChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: {
      legend: { position: 'top' },
      tooltip: { mode: 'index', intersect: false },
    },
    scales: {
      y: { title: { display: true, text: evoNorm ? '% del objetivo' : 'MPa' } },
    },
  };

  const cvChartData = evoSeries.length ? {
    labels: evoSeries.map(e => e.label),
    datasets: [{
      label: 'CV (%)',
      data: evoSeries.map(e => e.cv),
      borderColor: '#F59E0B',
      backgroundColor: '#F59E0B40',
      fill: true,
      tension: 0.3,
    }],
  } : null;

  const cvChartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    plugins: { legend: { position: 'top' } },
    scales: { y: { title: { display: true, text: '%' }, min: 0 } },
  };

  const cumplimientoTemplate = (row) => {
    const c = row.cumplimiento;
    const severity = c >= 95 ? 'success' : c >= 85 ? 'warning' : 'danger';
    return <Tag value={`${c}%`} severity={severity} />;
  };

  const pendienteTemplate = (row) => (
    <Tag
      value={row.pendiente ? 'Pendiente' : 'Revisado'}
      severity={row.pendiente ? 'warning' : 'success'}
      icon={row.pendiente ? 'pi pi-clock' : 'pi pi-check'}
    />
  );

  return (
    <div>
      <div className="flex flex-wrap gap-2 mb-3 align-items-end">
        <div>
          <label className="block text-sm mb-1">Tipo hormigón</label>
          <Dropdown
            value={filters.idTipoHormigon}
            options={tipos}
            onChange={(e) => setFilters(f => ({ ...f, idTipoHormigon: e.value }))}
            placeholder="Todos"
            showClear
            className="w-12rem"
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
        <Button
          icon="pi pi-refresh"
          label="Actualizar"
          onClick={fetchData}
          severity="secondary"
          outlined
        />
        <Button
          icon="pi pi-file-pdf"
          label="PDF"
          severity="danger"
          outlined
          disabled={!data || loading || exporting}
          loading={exporting}
          onClick={async () => {
            setExporting(true);
            try {
              await exportTenantPDF({
                data,
                filters,
                tipos,
                alertCount,
                alertasPendientes,
                configEmpresa: { thumbnail: cfg?.thumbnail, nombreEmpresa: cfg?.nombreEmpresa },
              });
            } catch (err) {
              console.error('[TableroTenant] exportPDF:', err);
              showToast('error', 'No se pudo generar el PDF.');
            } finally {
              setExporting(false);
            }
          }}
          tooltip="Exportar tablero a PDF"
          tooltipOptions={{ position: 'top' }}
        />
        <Button
          icon="pi pi-file-excel"
          label="Excel"
          severity="success"
          outlined
          disabled={!data || loading || exporting}
          onClick={() => {
            setExporting(true);
            try {
              exportTenantExcel({ data, filters, tipos, alertCount, alertasPendientes });
            } catch (err) {
              console.error('[TableroTenant] exportExcel:', err);
              showToast('error', 'No se pudo generar el Excel.');
            } finally {
              setExporting(false);
            }
          }}
          tooltip="Exportar tablero a Excel"
          tooltipOptions={{ position: 'top' }}
        />
      </div>

      {loading ? (
        <div className="flex justify-content-center p-6">
          <ProgressSpinner style={{ width: 50, height: 50 }} />
        </div>
      ) : !data ? (
        <Message severity="warn" text="No se pudieron cargar los datos." className="w-full" />
      ) : (
        <>
          {data.alerts?.length > 0 && (
            <div className="flex flex-column gap-2 mb-3">
              {data.alerts.map((a, i) => (
                <Message
                  key={i}
                  severity={a.severity === 'error' ? 'error' : 'warn'}
                  text={a.message}
                  className="w-full cursor-pointer"
                  onClick={() => a.action && navigate(a.action)}
                />
              ))}
            </div>
          )}

          {alertCount > 0 && (
            <Card className="shadow-1 mb-3">
              <div className="flex align-items-center justify-content-between mb-2">
                <div className="flex align-items-center gap-2">
                  <i className="fa-solid fa-bell text-orange-500" style={{ fontSize: '1.2rem' }} />
                  <span className="font-bold">{alertCount} alerta{alertCount !== 1 ? 's' : ''} pendiente{alertCount !== 1 ? 's' : ''}</span>
                </div>
                <Button
                  label="Ver todas"
                  icon="fa-solid fa-arrow-right"
                  iconPos="right"
                  size="small"
                  text
                  onClick={() => navigate('/calidad/alertas')}
                />
              </div>
              {alertasPendientes.length > 0 && (
                <div className="flex flex-column gap-1">
                  {alertasPendientes.map((a) => {
                    const nivelSev = { CRITICO: 'error', ALTO: 'warn', MEDIO: 'info', BAJO: 'success' };
                    return (
                      <Message
                        key={a.idAlertaCalidad}
                        severity={nivelSev[a.nivel] || 'info'}
                        text={a.mensaje}
                        className="w-full"
                      />
                    );
                  })}
                </div>
              )}
            </Card>
          )}

          <div className="grid mb-3">
            <KpiCard label="Muestras" value={data.kpis.totalMuestras} icon="fa-solid fa-flask" color="#3B82F6" />
            <KpiCard label="Probetas" value={data.kpis.totalProbetas} icon="fa-solid fa-vial" color="#8B5CF6" />
            <KpiCard label="Ensayos" value={data.kpis.totalEnsayos} icon="fa-solid fa-microscope" color="#10B981" />
            <KpiCard label="Cumplimiento 28d" value={data.kpis.cumplimiento28d} icon="fa-solid fa-check-circle" color="#10B981" suffix="%" />
            <KpiCard
              label="Peor tipo"
              value={data.kpis.peorTipo ? `${data.kpis.peorTipo.tipo} (${data.kpis.peorTipo.cumplimiento}%)` : null}
              icon="fa-solid fa-triangle-exclamation"
              color="#EF4444"
            />
            <KpiCard
              label="Bajo control"
              value={data.kpis.totalTipos > 0 ? `${data.kpis.tiposBajoControl}/${data.kpis.totalTipos}` : null}
              icon="fa-solid fa-shield-check"
              color="#10B981"
            />
          </div>

          <div className="grid mb-3">
            <div className="col-12 lg:col-6">
              <Card title={evoNorm ? 'Evolución resistencia 28d (% del objetivo)' : 'Evolución de resistencia 28d'} className="shadow-1 h-full">
                {evolutionChartData ? (
                  <div style={{ height: 280 }}>
                    <PrimeChart type="line" data={evolutionChartData} options={evolutionChartOptions} style={{ height: '100%' }} />
                  </div>
                ) : (
                  <p className="text-500 text-center p-4">Sin datos suficientes.</p>
                )}
              </Card>
            </div>
            <div className="col-12 lg:col-6">
              <Card title="Coeficiente de variación mensual" className="shadow-1 h-full">
                {cvChartData ? (
                  <div style={{ height: 280 }}>
                    <PrimeChart type="line" data={cvChartData} options={cvChartOptions} style={{ height: '100%' }} />
                  </div>
                ) : (
                  <p className="text-500 text-center p-4">Sin datos suficientes.</p>
                )}
              </Card>
            </div>
          </div>

          <Card title="Resumen por tipo de hormigón" className="shadow-1 mb-3">
            <DataTable responsiveLayout="scroll"
              value={data.summaryByTipo || []}
              emptyMessage="Sin datos."
              size="small"
              stripedRows
              sortField="n"
              sortOrder={-1}
            >
              <Column field="tipoHormigon" header="Tipo" sortable />
              <Column field="n" header="n" sortable style={{ width: '60px' }} />
              <Column field="media" header="Media (MPa)" sortable body={(r) => formatNumber(r.media, { precision: 2 })} />
              <Column field="desvio" header="Desvío" sortable body={(r) => formatNumber(r.desvio, { precision: 2 })} />
              <Column field="cv" header="CV (%)" sortable body={(r) => formatNumber(r.cv, { precision: 1 })} />
              <Column field="fck" header="f'ck" sortable body={(r) => formatNumber(r.fck, { precision: 2 })} />
              <Column field="min" header="Mín" body={(r) => formatNumber(r.min, { precision: 2 })} />
              <Column field="max" header="Máx" body={(r) => formatNumber(r.max, { precision: 2 })} />
              <Column field="cumplimiento" header="Cumplimiento" body={cumplimientoTemplate} sortable />
            </DataTable>
          </Card>

          <Card title="Actividad reciente" className="shadow-1">
            <DataTable responsiveLayout="scroll"
              value={data.recentActivity || []}
              emptyMessage="Sin actividad reciente."
              size="small"
              stripedRows
              rows={10}
              paginator={data.recentActivity?.length > 10}
              first={recentFirst}
              onPage={(e) => setRecentFirst(e.first)}
            >
              <Column field="fechaEnsayo" header="Fecha" sortable style={{ width: '100px' }} />
              <Column field="probeta" header="Probeta" />
              <Column field="remito" header="Remito" />
              <Column field="tipoHormigon" header="Tipo H°" />
              <Column field="edadEnsayo" header="Edad" style={{ width: '60px' }} />
              <Column field="resistencia" header="Resistencia (MPa)" sortable />
              <Column header="Estado" body={pendienteTemplate} style={{ width: '120px' }} />
            </DataTable>
          </Card>
        </>
      )}
    </div>
  );
};

export default TableroTenantView;
