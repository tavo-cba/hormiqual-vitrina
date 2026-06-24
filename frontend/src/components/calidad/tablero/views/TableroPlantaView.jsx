import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Chart as PrimeChart } from 'primereact/chart';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Card } from 'primereact/card';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import axios from 'axios';
import { config } from '../../../../config/config';
import { useToast } from '../../../../context/ToastContext';
import { useConfig } from '../../../../context/ConfigContext';
import { exportPlantaPDF, exportPlantaExcel } from '../../exports/tableroCalidadExport';
import 'chart.js/auto';

/**
 * Tablero Calidad — vista por planta (KPIs operativos: agregados,
 * mezclas aprobadas, dosificaciones, alertas pendientes; doughnuts por
 * estado; tablas de dosificaciones y mezclas recientes; sumario de
 * materiales).
 *
 * Extraído del antiguo DashboardPlantaPage (sesión 2026-05-09) para
 * fusionarlo con TableroTenantView en una sola pantalla con TabView.
 */
const ESTADO_SEVERITY = {
  BORRADOR: 'info', A_PRUEBA: 'warning', PENDIENTE_REVISION: 'warning',
  APROBADO: 'success', SUSPENDIDO: 'danger', ARCHIVADO: 'secondary',
};
const ESTADO_LABEL = {
  BORRADOR: 'Borrador', A_PRUEBA: 'A prueba', PENDIENTE_REVISION: 'Pend. revisión',
  APROBADO: 'Aprobado', SUSPENDIDO: 'Suspendido', ARCHIVADO: 'Archivado',
};

const KpiCard = ({ label, value, icon, color, suffix = '', onClick }) => (
  <div className="col-12 md:col-6 lg:col-3">
    <Card className="shadow-1 h-full cursor-pointer hover:shadow-3 transition-all transition-duration-200" onClick={onClick}>
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

const TableroPlantaView = () => {
  const navigate = useNavigate();
  const showToast = useToast();
  const cfg = useConfig();
  const [exporting, setExporting] = useState(false);
  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);
  const [plantas, setPlantas] = useState([]);
  const [plantaId, setPlantaId] = useState(null);

  useEffect(() => {
    axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers })
      .then(res => {
        const list = (res.data || []).map(p => ({ label: p.nombre, value: p.idPlanta }));
        setPlantas(list);
        if (list.length === 1) setPlantaId(list[0].value);
      })
      .catch((err) => {
        console.error('[TableroPlanta] plantas:', err);
        setPlantas([]);
      });
  }, []);

  const fetchData = useCallback(async () => {
    if (!plantaId) return;
    setLoading(true);
    try {
      const res = await axios.get(`${config.backendUrl}/api/dashboard-planta`, {
        headers: config.headers,
        params: { idPlanta: plantaId },
      });
      setData(res.data);
    } catch (err) {
      console.error('[TableroPlanta]', err);
      showToast('error', 'No se pudo cargar el dashboard por planta.');
      setData(null);
    } finally {
      setLoading(false);
    }
  }, [plantaId, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const dosifChartData = data?.dosificaciones?.porEstado ? {
    labels: Object.keys(data.dosificaciones.porEstado).map(k => ESTADO_LABEL[k] || k),
    datasets: [{
      data: Object.values(data.dosificaciones.porEstado),
      backgroundColor: Object.keys(data.dosificaciones.porEstado).map(k => {
        const map = { BORRADOR: '#60A5FA', A_PRUEBA: '#FBBF24', PENDIENTE_REVISION: '#F59E0B', APROBADO: '#34D399', SUSPENDIDO: '#F87171', ARCHIVADO: '#9CA3AF' };
        return map[k] || '#A78BFA';
      }),
    }],
  } : null;

  const mezclasChartData = data?.mezclas?.porEstado ? {
    labels: Object.keys(data.mezclas.porEstado).map(k => ESTADO_LABEL[k] || k),
    datasets: [{
      data: Object.values(data.mezclas.porEstado),
      backgroundColor: Object.keys(data.mezclas.porEstado).map(k => {
        const map = { BORRADOR: '#60A5FA', A_PRUEBA: '#FBBF24', PENDIENTE_REVISION: '#F59E0B', APROBADO: '#34D399', SUSPENDIDO: '#F87171', ARCHIVADO: '#9CA3AF' };
        return map[k] || '#A78BFA';
      }),
    }],
  } : null;

  const chartOptions = {
    responsive: true, maintainAspectRatio: false,
    plugins: { legend: { position: 'bottom', labels: { font: { size: 11 }, padding: 12 } } },
  };

  return (
    <div>
      <div className="flex flex-wrap align-items-center gap-2 mb-4">
        <Dropdown
          value={plantaId}
          options={plantas}
          onChange={(e) => setPlantaId(e.value)}
          placeholder="Seleccionar planta"
          className="w-full md:w-20rem"
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
              const plantaLabel = plantas.find((p) => p.value === plantaId)?.label || '';
              await exportPlantaPDF({
                data,
                plantaLabel,
                configEmpresa: { thumbnail: cfg?.thumbnail, nombreEmpresa: cfg?.nombreEmpresa },
              });
            } catch (err) {
              console.error('[TableroPlanta] exportPDF:', err);
              showToast('error', 'No se pudo generar el PDF.');
            } finally {
              setExporting(false);
            }
          }}
          tooltip="Exportar dashboard a PDF"
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
              const plantaLabel = plantas.find((p) => p.value === plantaId)?.label || '';
              exportPlantaExcel({ data, plantaLabel });
            } catch (err) {
              console.error('[TableroPlanta] exportExcel:', err);
              showToast('error', 'No se pudo generar el Excel.');
            } finally {
              setExporting(false);
            }
          }}
          tooltip="Exportar dashboard a Excel"
          tooltipOptions={{ position: 'top' }}
        />
      </div>

      {!plantaId && (
        <Message severity="info" text="Seleccione una planta para ver la vista operativa." className="w-full" />
      )}

      {loading && plantaId && (
        <div className="flex align-items-center justify-content-center" style={{ height: 200 }}>
          <ProgressSpinner strokeWidth="4" style={{ width: 50, height: 50 }} />
        </div>
      )}

      {!loading && data && (
        <>
          <div className="grid mb-4">
            <KpiCard
              label="Agregados" value={data.materiales?.total} icon="fa-solid fa-cubes" color="#3B82F6"
              onClick={() => navigate('/calidad/catalogos/materiales')}
            />
            <KpiCard
              label="Mezclas aprobadas" value={data.mezclas?.aprobadas} icon="fa-solid fa-layer-group" color="#10B981"
              onClick={() => navigate('/calidad/catalogos/mezclas')}
            />
            <KpiCard
              label="Dosificaciones" value={data.dosificaciones?.total} icon="fa-solid fa-flask" color="#8B5CF6"
              onClick={() => navigate('/calidad/catalogos/dosificaciones')}
            />
            <KpiCard
              label="Alertas pendientes" value={data.alertas?.total} icon="fa-solid fa-bell"
              color={data.alertas?.total > 0 ? '#EF4444' : '#6B7280'}
              onClick={() => navigate('/calidad/alertas')}
            />
          </div>

          <div className="grid mb-4">
            {dosifChartData && (
              <div className="col-12 md:col-6">
                <Card title="Dosificaciones por estado" className="shadow-1 h-full">
                  <div style={{ height: 220 }}>
                    <PrimeChart type="doughnut" data={dosifChartData} options={chartOptions} style={{ width: '100%', height: '100%' }} />
                  </div>
                </Card>
              </div>
            )}
            {mezclasChartData && (
              <div className="col-12 md:col-6">
                <Card title="Mezclas por estado" className="shadow-1 h-full">
                  <div style={{ height: 220 }}>
                    <PrimeChart type="doughnut" data={mezclasChartData} options={chartOptions} style={{ width: '100%', height: '100%' }} />
                  </div>
                </Card>
              </div>
            )}
          </div>

          {data.alertas?.items?.length > 0 && (
            <Card title="Alertas pendientes" className="shadow-1 mb-4">
              {data.alertas.items.map((a, i) => {
                // Bug TAB-12 audit: comparación de severidad pasaba en
                // minúsculas pero los datos llegan en MAYÚSCULAS → todas
                // caían como info. Normalizamos con .toUpperCase().
                const nivel = String(a.nivel || '').toUpperCase();
                const severity = nivel === 'CRITICO' ? 'error' : nivel === 'ALTO' ? 'warn' : 'info';
                return (
                  <Message
                    key={i}
                    severity={severity}
                    text={`${a.nombreMaterial || 'Material'}: ${a.mensaje}`}
                    className="w-full mb-2"
                  />
                );
              })}
            </Card>
          )}

          {data.dosificaciones?.recientes?.length > 0 && (
            <Card title="Dosificaciones recientes" className="shadow-1 mb-4">
              <DataTable responsiveLayout="scroll" value={data.dosificaciones.recientes} size="small" stripedRows>
                <Column field="nombre" header="Nombre" body={row => (
                  <span className="cursor-pointer text-primary hover:underline" onClick={() => navigate(`/calidad/catalogos/dosificaciones/${row.id}`)}>
                    {row.nombre || `#${row.id}`}
                  </span>
                )} />
                <Column field="estado" header="Estado" body={row => (
                  <Tag value={ESTADO_LABEL[row.estado] || row.estado} severity={ESTADO_SEVERITY[row.estado] || 'info'} />
                )} style={{ width: '120px' }} />
                <Column field="version" header="v" style={{ width: '40px', textAlign: 'center' }} />
                <Column field="fecha" header="Fecha" body={row => row.fecha ? new Date(row.fecha).toLocaleDateString('es-AR') : '—'} style={{ width: '100px' }} />
              </DataTable>
            </Card>
          )}

          {data.mezclas?.recientes?.length > 0 && (
            <Card title="Mezclas recientes" className="shadow-1 mb-4">
              <DataTable responsiveLayout="scroll" value={data.mezclas.recientes} size="small" stripedRows>
                <Column field="nombre" header="Nombre" body={row => (
                  <span className="cursor-pointer text-primary hover:underline" onClick={() => navigate(`/calidad/catalogos/mezclas/${row.id}`)}>
                    {row.nombre || `#${row.id}`}
                  </span>
                )} />
                <Column field="tipo" header="Tipo" style={{ width: '80px' }} />
                <Column field="estado" header="Estado" body={row => (
                  <Tag value={ESTADO_LABEL[row.estado] || row.estado} severity={ESTADO_SEVERITY[row.estado] || 'info'} />
                )} style={{ width: '120px' }} />
                <Column field="tmn" header="TMN" body={row => row.tmn ? `${row.tmn} mm` : '—'} style={{ width: '80px' }} />
                <Column field="fecha" header="Fecha" body={row => row.fecha ? new Date(row.fecha).toLocaleDateString('es-AR') : '—'} style={{ width: '100px' }} />
              </DataTable>
            </Card>
          )}

          <Card title="Materiales" className="shadow-1 mb-4">
            <div className="grid text-center">
              <div className="col-12 sm:col-6 md:col-4">
                <div className="text-2xl font-bold text-blue-500">{data.materiales?.finos || 0}</div>
                <div className="text-sm text-500">Finos</div>
              </div>
              <div className="col-12 sm:col-6 md:col-4">
                <div className="text-2xl font-bold text-orange-500">{data.materiales?.gruesos || 0}</div>
                <div className="text-sm text-500">Gruesos</div>
              </div>
              <div className="col-12 sm:col-6 md:col-4">
                <div className="text-2xl font-bold text-purple-500">{data.cementos || 0}</div>
                <div className="text-sm text-500">Cementos</div>
              </div>
            </div>
          </Card>
        </>
      )}
    </div>
  );
};

export default TableroPlantaView;
