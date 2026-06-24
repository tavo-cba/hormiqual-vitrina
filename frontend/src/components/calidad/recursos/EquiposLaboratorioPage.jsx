import React, { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { Fade } from 'react-awesome-reveal';
import axios from 'axios';
import { config } from '../../../config/config';
import { useToast } from '../../../context/ToastContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { Dialog } from 'primereact/dialog';
import { listEquipos, deleteEquipo, bulkAssignLab } from '../../../services/equipoLaboratorioService';
import { listLaboratorios } from '../../../services/laboratorioService';
import EquipoForm from './uikit/EquipoForm';
import CalibracionForm from './uikit/CalibracionForm';
import CalibracionStatusBadge from './uikit/CalibracionStatusBadge';
import dayjs from 'dayjs';

const TIPO_LABELS = {
  PRENSA: 'Prensa',
  BALANZA: 'Balanza',
  HORNO: 'Horno',
  ESTUFA: 'Estufa',
  AGITADOR: 'Agitador',
  VIBRADOR: 'Vibrador',
  MESA_FLUIDEZ: 'Mesa de fluidez',
  CONO_ABRAMS: 'Cono de Abrams',
  CONO_SLUMP: 'Cono de slump',
  PICNOMETRO: 'Picnómetro',
  VASO_VOLUMETRICO: 'Vaso volumétrico',
  TERMOMETRO: 'Termómetro',
  HIGROMETRO: 'Higrómetro',
  CRONOMETRO: 'Cronómetro',
  MEDIDOR_AIRE: 'Medidor de aire (Washington)',
  OTRO: 'Otro',
};

const ESTADO_FILTER_OPTIONS = [
  { label: 'Todos los estados', value: null },
  { label: 'Vigente', value: 'vigente' },
  { label: 'Por vencer', value: 'por_vencer' },
  { label: 'Vencida', value: 'vencida' },
  { label: 'Sin calibrar', value: 'sin_calibrar' },
];

const EquiposLaboratorioPage = () => {
  const showToast = useToast();
  const navigate = useNavigate();
  const [equipos, setEquipos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [plantas, setPlantas] = useState([]);
  const [filtros, setFiltros] = useState({ tipo: null, idPlanta: null, estado: null, busqueda: '' });
  const [first, setFirst] = useState(0);

  // Form states
  const [equipoForm, setEquipoForm] = useState({ visible: false, equipo: null });
  const [calForm, setCalForm] = useState({ visible: false, equipo: null });
  // Bulk assign — selección + diálogo
  const [selectedEquipos, setSelectedEquipos] = useState([]);
  const [bulkDialog, setBulkDialog] = useState({ visible: false, idLaboratorio: null });
  const [labsForBulk, setLabsForBulk] = useState([]);
  const [bulkLoading, setBulkLoading] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filtros.tipo) params.tipo = filtros.tipo;
      if (filtros.idPlanta) params.idPlanta = filtros.idPlanta;
      const list = await listEquipos(params);
      setEquipos(list);
    } catch (err) {
      console.error('[EquiposLab] fetchData:', err);
      showToast('error', 'No se pudieron cargar los equipos.');
    } finally {
      setLoading(false);
    }
  }, [filtros.tipo, filtros.idPlanta, showToast]);

  const fetchPlantas = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers });
      setPlantas(data || []);
    } catch (err) {
      console.error('[EquiposLab] plantas:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchPlantas(); }, [fetchPlantas]);
  useEffect(() => { setFirst(0); }, [filtros.tipo, filtros.idPlanta, filtros.estado, filtros.busqueda]);

  // Cargar labs disponibles al abrir el diálogo de bulk-assign.
  const openBulkDialog = async () => {
    try {
      const data = await listLaboratorios();
      setLabsForBulk(Array.isArray(data) ? data : []);
      setBulkDialog({ visible: true, idLaboratorio: null });
    } catch (err) {
      console.error('[EquiposLab] listLaboratorios:', err);
      showToast('error', 'No se pudieron cargar los laboratorios.');
    }
  };

  const handleBulkAssign = async () => {
    if (!bulkDialog.idLaboratorio) {
      showToast('warn', 'Seleccioná un laboratorio.');
      return;
    }
    if (selectedEquipos.length === 0) {
      showToast('warn', 'No hay equipos seleccionados.');
      return;
    }
    setBulkLoading(true);
    try {
      const r = await bulkAssignLab({
        idLaboratorio: bulkDialog.idLaboratorio,
        idsEquipo: selectedEquipos.map((e) => e.idEquipo),
      });
      showToast('success', `${r.updated} equipo(s) asignado(s) al laboratorio.`);
      if (r.skippedNotFound?.length) {
        showToast('warn', `${r.skippedNotFound.length} id(s) no se encontraron y se ignoraron.`);
      }
      setBulkDialog({ visible: false, idLaboratorio: null });
      setSelectedEquipos([]);
      fetchData();
    } catch (err) {
      console.error('[EquiposLab] bulkAssignLab:', err);
      showToast('error', err?.response?.data?.error || 'No se pudo asignar el laboratorio.');
    } finally {
      setBulkLoading(false);
    }
  };

  const filtered = equipos.filter((e) => {
    if (filtros.estado && e.estadoCalibracion !== filtros.estado) return false;
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      const hay = [e.nombre, e.marca, e.modelo, e.numeroSerie, e.ubicacion]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  });

  const handleNuevoEquipo = () => setEquipoForm({ visible: true, equipo: null });
  const handleEditar = (equipo) => setEquipoForm({ visible: true, equipo });

  const handleEliminar = (equipo) => {
    confirmDialog({
      message: `¿Dar de baja el equipo "${equipo.nombre}"? Los ensayos históricos que lo referencian seguirán visibles.`,
      header: 'Confirmar baja',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Dar de baja',
      rejectLabel: 'Cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await deleteEquipo(equipo.idEquipo);
          showToast('success', 'Equipo dado de baja.');
          fetchData();
        } catch (err) {
          console.error('[EquiposLab] delete:', err);
          showToast('error', err?.response?.data?.error || 'No se pudo eliminar.');
        }
      },
    });
  };

  const handleNuevaCalibracion = (equipo) => setCalForm({ visible: true, equipo });

  const tipoBody = (row) => (
    <span className="text-color-secondary">{TIPO_LABELS[row.tipo] || row.tipo}</span>
  );

  const estadoBody = (row) => (
    <CalibracionStatusBadge estado={row.estadoCalibracion} diasParaVencer={row.diasParaVencer} />
  );

  const nombreBody = (row) => {
    const nombreLink = (
      <span
        className="cursor-pointer text-primary hover:underline"
        onClick={() => navigate(`/calidad/laboratorio/equipos/${row.idEquipo}`)}
      >
        {row.nombre}
      </span>
    );
    if (!row.alertaPendiente) return nombreLink;
    const color = row.alertaPendiente.nivel === 'CRITICO' ? 'var(--red-500)' : 'var(--orange-500)';
    const tooltip = row.alertaPendiente.tipo === 'CALIBRACION_VENCIDA'
      ? 'Tiene una alerta pendiente: calibración vencida. Click para ver.'
      : 'Tiene una alerta pendiente: calibración próxima a vencer. Click para ver.';
    return (
      <div className="flex align-items-center gap-2">
        {nombreLink}
        <i
          className="fa-solid fa-bell cursor-pointer"
          style={{ color, fontSize: '0.95rem' }}
          title={tooltip}
          onClick={(e) => {
            e.stopPropagation();
            navigate('/calidad/alertas');
          }}
        />
      </div>
    );
  };

  const ultimaCalibracionBody = (row) => {
    if (!row.ultimaCalibracion) return <span className="text-color-secondary">—</span>;
    return (
      <div className="flex flex-column">
        <span>{dayjs(row.ultimaCalibracion.fechaCalibracion).format('DD/MM/YYYY')}</span>
        <small className="text-color-secondary">Vence: {dayjs(row.ultimaCalibracion.fechaVencimiento).format('DD/MM/YYYY')}</small>
      </div>
    );
  };

  const accionesBody = (row) => (
    <div className="flex gap-1">
      <Button
        icon="fa-solid fa-plus"
        size="small"
        severity="success"
        outlined
        tooltip="Registrar calibración"
        tooltipOptions={{ position: 'top' }}
        onClick={() => handleNuevaCalibracion(row)}
      />
      <Button
        icon="fa-solid fa-pen"
        size="small"
        severity="secondary"
        outlined
        tooltip="Editar equipo"
        tooltipOptions={{ position: 'top' }}
        onClick={() => handleEditar(row)}
      />
      <Button
        icon="fa-solid fa-trash"
        size="small"
        severity="danger"
        outlined
        tooltip="Dar de baja"
        tooltipOptions={{ position: 'top' }}
        onClick={() => handleEliminar(row)}
      />
    </div>
  );

  const laboratorioBody = (row) => (
    row.laboratorio?.nombre || <span className="text-color-secondary">—</span>
  );

  const tipoFilterOptions = [
    { label: 'Todos los tipos', value: null },
    ...Object.entries(TIPO_LABELS).map(([value, label]) => ({ value, label })),
  ];
  const plantaFilterOptions = [
    { label: 'Todas las plantas', value: null },
    ...plantas.map((p) => ({ label: p.nombre, value: p.idPlanta })),
  ];

  // Resumen rápido por estado
  const resumen = equipos.reduce((acc, e) => {
    acc[e.estadoCalibracion] = (acc[e.estadoCalibracion] || 0) + 1;
    return acc;
  }, {});

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-3">
        <PageHeader
          icon="fa-solid fa-boxes-stacked"
          title="Equipos de laboratorio"
          subtitle="Catálogo de instrumentos sujetos a calibración trazable (ISO 17025 §6.4 / IRAM 1546 §6.4)."
        />

        <ConfirmDialog />

        {/* Resumen de estados */}
        {!loading && equipos.length > 0 && (
          <div className="grid mb-3">
            <div className="col-6 md:col-3">
              <Card className="shadow-1 text-center">
                <div className="text-500 text-sm">Vigentes</div>
                <div className="text-900 font-bold text-2xl" style={{ color: 'var(--green-500)' }}>{resumen.vigente || 0}</div>
              </Card>
            </div>
            <div className="col-6 md:col-3">
              <Card className="shadow-1 text-center">
                <div className="text-500 text-sm">Por vencer</div>
                <div className="text-900 font-bold text-2xl" style={{ color: 'var(--orange-500)' }}>{resumen.por_vencer || 0}</div>
              </Card>
            </div>
            <div className="col-6 md:col-3">
              <Card className="shadow-1 text-center">
                <div className="text-500 text-sm">Vencidas</div>
                <div className="text-900 font-bold text-2xl" style={{ color: 'var(--red-500)' }}>{resumen.vencida || 0}</div>
              </Card>
            </div>
            <div className="col-6 md:col-3">
              <Card className="shadow-1 text-center">
                <div className="text-500 text-sm">Sin calibrar</div>
                <div className="text-900 font-bold text-2xl" style={{ color: 'var(--blue-500)' }}>{resumen.sin_calibrar || 0}</div>
              </Card>
            </div>
          </div>
        )}

        {(resumen.vencida > 0 || resumen.por_vencer > 0) && (
          <Message
            severity={resumen.vencida > 0 ? 'error' : 'warn'}
            className="w-full mb-3"
            text={
              resumen.vencida > 0
                ? `Hay ${resumen.vencida} equipo(s) con calibración vencida. Los ensayos hechos con esos equipos podrían ser cuestionados en auditoría (ISO 17025 §6.4.7).`
                : `Hay ${resumen.por_vencer} equipo(s) con calibración próxima a vencer.`
            }
          />
        )}

        {/* Filtros */}
        <Card className="w-full mb-3">
          <div className="grid">
            <div className="col-12 md:col-3">
              <label className="text-sm font-semibold mb-1 block">Tipo</label>
              <Dropdown value={filtros.tipo} options={tipoFilterOptions} onChange={(e) => setFiltros((f) => ({ ...f, tipo: e.value }))} className="w-full" />
            </div>
            <div className="col-12 md:col-3">
              <label className="text-sm font-semibold mb-1 block">Planta</label>
              <Dropdown value={filtros.idPlanta} options={plantaFilterOptions} onChange={(e) => setFiltros((f) => ({ ...f, idPlanta: e.value }))} className="w-full" />
            </div>
            <div className="col-12 md:col-3">
              <label className="text-sm font-semibold mb-1 block">Estado calibración</label>
              <Dropdown value={filtros.estado} options={ESTADO_FILTER_OPTIONS} onChange={(e) => setFiltros((f) => ({ ...f, estado: e.value }))} className="w-full" />
            </div>
            <div className="col-12 md:col-3">
              <label className="text-sm font-semibold mb-1 block">Buscar</label>
              <InputText
                value={filtros.busqueda}
                onChange={(e) => setFiltros((f) => ({ ...f, busqueda: e.target.value }))}
                placeholder="Nombre, marca, modelo, serie…"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex justify-content-between mt-2 flex-wrap gap-2">
            <Button icon="fa-solid fa-arrows-rotate" label="Actualizar" severity="secondary" outlined onClick={fetchData} />
            <div className="flex gap-2 flex-wrap">
              {selectedEquipos.length > 0 && (
                <Button
                  icon="fa-solid fa-flask-vial"
                  label={`Asignar a laboratorio (${selectedEquipos.length})`}
                  severity="help"
                  outlined
                  onClick={openBulkDialog}
                />
              )}
              <Button icon="fa-solid fa-plus" label="Nuevo equipo" onClick={handleNuevoEquipo} />
            </div>
          </div>
        </Card>

        {/* Lista */}
        {loading ? (
          <div className="flex justify-content-center p-6"><ProgressSpinner /></div>
        ) : (
          <DataTable
            value={filtered}
            paginator
            rows={20}
            first={first}
            onPage={(e) => setFirst(e.first)}
            stripedRows
            responsiveLayout="scroll"
            emptyMessage="No hay equipos con estos filtros."
            size="small"
            selection={selectedEquipos}
            onSelectionChange={(e) => setSelectedEquipos(e.value)}
            dataKey="idEquipo"
            selectionMode="checkbox"
          >
            <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
            <Column field="tipo" header="Tipo" body={tipoBody} sortable style={{ width: '110px' }} />
            <Column field="nombre" header="Nombre" sortable body={nombreBody} />
            <Column field="marca" header="Marca" sortable />
            <Column field="modelo" header="Modelo" sortable />
            <Column field="capacidad" header="Capacidad" />
            <Column header="Laboratorio" body={laboratorioBody} />
            <Column header="Última calibración" body={ultimaCalibracionBody} />
            <Column header="Estado" body={estadoBody} style={{ width: '180px' }} />
            <Column header="Acciones" body={accionesBody} style={{ width: '140px' }} />
          </DataTable>
        )}

        <EquipoForm
          visible={equipoForm.visible}
          onHide={() => setEquipoForm({ visible: false, equipo: null })}
          equipo={equipoForm.equipo}
          plantas={plantas}
          onSaved={fetchData}
        />
        <CalibracionForm
          visible={calForm.visible}
          onHide={() => setCalForm({ visible: false, equipo: null })}
          equipo={calForm.equipo}
          onSaved={fetchData}
        />

        <Dialog
          header={`Asignar ${selectedEquipos.length} equipo(s) a un laboratorio`}
          visible={bulkDialog.visible}
          onHide={() => setBulkDialog({ visible: false, idLaboratorio: null })}
          modal
          style={{ width: '90vw', maxWidth: '480px' }}
          footer={
            <div className="flex justify-content-end gap-2">
              <Button label="Cancelar" severity="secondary" outlined onClick={() => setBulkDialog({ visible: false, idLaboratorio: null })} disabled={bulkLoading} />
              <Button label="Asignar" icon="fa-solid fa-check" onClick={handleBulkAssign} loading={bulkLoading} />
            </div>
          }
        >
          <p className="text-sm text-color-secondary mt-0 mb-2">
            Los equipos seleccionados pasarán a pertenecer al laboratorio elegido. Las plantas heredan del lab vía LaboratorioPlanta.
          </p>
          <Dropdown
            value={bulkDialog.idLaboratorio}
            options={labsForBulk.map((l) => ({ label: l.nombre, value: l.idLaboratorio }))}
            onChange={(e) => setBulkDialog({ ...bulkDialog, idLaboratorio: e.value })}
            placeholder="Seleccionar laboratorio…"
            className="w-full"
            filter
          />
        </Dialog>
      </div>
    </Fade>
  );
};

export default EquiposLaboratorioPage;
