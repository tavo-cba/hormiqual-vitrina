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
import { Fade } from 'react-awesome-reveal';
import axios from 'axios';
import { config } from '../../../config/config';
import { useToast } from '../../../context/ToastContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { listLaboratorios, deleteLaboratorio } from '../../../services/laboratorioService';
import LaboratorioForm from './uikit/LaboratorioForm';

const LaboratoriosPage = () => {
  const showToast = useToast();
  const navigate = useNavigate();
  const [labs, setLabs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [plantas, setPlantas] = useState([]);
  const [filtros, setFiltros] = useState({ idPlanta: null, busqueda: '' });
  const [first, setFirst] = useState(0);
  const [formState, setFormState] = useState({ visible: false, lab: null });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const params = {};
      if (filtros.idPlanta) params.idPlanta = filtros.idPlanta;
      const list = await listLaboratorios(params);
      setLabs(list);
    } catch (err) {
      console.error('[Laboratorios] fetchData:', err);
      showToast('error', 'No se pudieron cargar los laboratorios.');
    } finally {
      setLoading(false);
    }
  }, [filtros.idPlanta, showToast]);

  const fetchPlantas = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers });
      setPlantas(data || []);
    } catch (err) {
      console.error('[Laboratorios] plantas:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchPlantas(); }, [fetchPlantas]);
  useEffect(() => { setFirst(0); }, [filtros.idPlanta, filtros.busqueda]);

  const filtered = labs.filter((l) => {
    if (filtros.busqueda) {
      const q = filtros.busqueda.toLowerCase();
      const hay = [l.nombre, l.direccion, l.observaciones]
        .filter(Boolean).some((v) => String(v).toLowerCase().includes(q));
      if (!hay) return false;
    }
    return true;
  });

  const handleNuevo = () => setFormState({ visible: true, lab: null });
  const handleEditar = (lab) => setFormState({ visible: true, lab });

  const handleEliminar = (lab) => {
    confirmDialog({
      message: `¿Dar de baja el laboratorio "${lab.nombre}"? Los equipos y piletas asignados no se borran.`,
      header: 'Confirmar baja',
      icon: 'pi pi-exclamation-triangle',
      acceptLabel: 'Dar de baja',
      rejectLabel: 'Cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await deleteLaboratorio(lab.idLaboratorio);
          showToast('success', 'Laboratorio dado de baja.');
          fetchData();
        } catch (err) {
          console.error('[Laboratorios] delete:', err);
          showToast('error', err?.response?.data?.error || 'No se pudo eliminar.');
        }
      },
    });
  };

  const nombreBody = (row) => (
    <span
      className="cursor-pointer text-primary hover:underline font-bold"
      onClick={() => navigate(`/calidad/laboratorio/laboratorios/${row.idLaboratorio}`)}
      title="Ver detalle del laboratorio"
    >
      {row.nombre}
    </span>
  );

  const plantasBody = (row) => {
    const activas = Array.isArray(row.plantas)
      ? row.plantas.filter((p) => p.activo !== false)
      : [];
    if (activas.length === 0) return <span className="text-color-secondary">—</span>;
    return activas.map((p) => p.planta?.nombre || `Planta ${p.idPlanta}`).join(', ');
  };

  const prensaDefaultBody = (row) => {
    if (!row.prensaPorDefecto) return <span className="text-color-secondary">—</span>;
    return row.prensaPorDefecto.nombre;
  };

  const accionesBody = (row) => (
    <div className="flex gap-1">
      <Button
        icon="fa-solid fa-pen"
        size="small"
        severity="secondary"
        outlined
        tooltip="Editar"
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

  const plantaFilterOptions = [
    { label: 'Todas las plantas', value: null },
    ...plantas.map((p) => ({ label: p.nombre, value: p.idPlanta })),
  ];

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-3">
        <PageHeader
          icon="fa-solid fa-flask-vial"
          title="Laboratorios"
          subtitle="Recintos físicos que agrupan equipos y piletas y atienden a una o varias plantas."
        />

        <ConfirmDialog />

        <Card className="w-full mb-3">
          <div className="grid">
            <div className="col-12 md:col-4">
              <label className="text-sm font-semibold mb-1 block">Planta</label>
              <Dropdown
                value={filtros.idPlanta}
                options={plantaFilterOptions}
                onChange={(e) => setFiltros((f) => ({ ...f, idPlanta: e.value }))}
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-8">
              <label className="text-sm font-semibold mb-1 block">Buscar</label>
              <InputText
                value={filtros.busqueda}
                onChange={(e) => setFiltros((f) => ({ ...f, busqueda: e.target.value }))}
                placeholder="Nombre, dirección, observaciones…"
                className="w-full"
              />
            </div>
          </div>
          <div className="flex justify-content-between mt-2">
            <Button icon="fa-solid fa-arrows-rotate" label="Actualizar" severity="secondary" outlined onClick={fetchData} />
            <Button icon="fa-solid fa-plus" label="Nuevo laboratorio" onClick={handleNuevo} />
          </div>
        </Card>

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
            emptyMessage="No hay laboratorios con estos filtros."
            size="small"
          >
            <Column field="nombre" header="Nombre" sortable body={nombreBody} />
            <Column field="direccion" header="Dirección" />
            <Column header="Plantas" body={plantasBody} />
            <Column header="Equipos" body={(r) => r.cantidadEquipos ?? 0} style={{ width: '100px', textAlign: 'right' }} />
            <Column header="Piletas" body={(r) => r.cantidadPiletas ?? 0} style={{ width: '100px', textAlign: 'right' }} />
            <Column header="Prensa por defecto" body={prensaDefaultBody} />
            <Column header="Acciones" body={accionesBody} style={{ width: '110px' }} />
          </DataTable>
        )}

        <LaboratorioForm
          visible={formState.visible}
          onHide={() => setFormState({ visible: false, lab: null })}
          laboratorio={formState.lab}
          onSaved={fetchData}
        />
      </div>
    </Fade>
  );
};

export default LaboratoriosPage;
