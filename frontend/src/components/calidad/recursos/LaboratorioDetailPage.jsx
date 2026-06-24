import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { Tag } from 'primereact/tag';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { Fade } from 'react-awesome-reveal';
import { useToast } from '../../../context/ToastContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { getLaboratorio, deleteLaboratorio } from '../../../services/laboratorioService';
import LaboratorioForm from './uikit/LaboratorioForm';

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

const Field = ({ label, value, fullWidth = false }) => (
  <div className={`col-12 ${fullWidth ? '' : 'md:col-6'}`}>
    <div className="text-sm text-color-secondary mb-1">{label}</div>
    <div className="font-semibold">
      {value || <span className="text-color-secondary font-normal">—</span>}
    </div>
  </div>
);

const LaboratorioDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [lab, setLab] = useState(null);
  const [loading, setLoading] = useState(true);
  const [formState, setFormState] = useState({ visible: false });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getLaboratorio(id);
      setLab(data);
    } catch (err) {
      console.error('[LaboratorioDetail] fetch:', err);
      showToast('error', 'No se pudo cargar el laboratorio.');
      setLab(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const handleEliminar = async () => {
    try {
      await deleteLaboratorio(id);
      showToast('success', 'Laboratorio dado de baja.');
      navigate('/calidad/laboratorio/laboratorios');
    } catch (err) {
      showToast('error', err?.response?.data?.error || 'No se pudo eliminar.');
    }
  };

  if (loading) {
    return <div className="flex justify-content-center p-6"><ProgressSpinner /></div>;
  }
  if (!lab) {
    return (
      <div className="p-3">
        <Message severity="warn" text="No se encontró el laboratorio." className="w-full" />
        <Button label="Volver al listado" icon="fa-solid fa-arrow-left" outlined className="mt-3"
          onClick={() => navigate('/calidad/laboratorio/laboratorios')} />
      </div>
    );
  }

  const plantasActivas = (lab.plantas || []).filter((p) => p.activo !== false);
  const equipos = lab.equipos || [];
  const piletas = lab.piletas || [];
  const prensaDefault = lab.prensaPorDefecto;

  const tipoEquipoBody = (row) => TIPO_LABELS[row.tipo] || row.tipo;
  const nombreEquipoBody = (row) => (
    <span
      className="cursor-pointer text-primary hover:underline"
      onClick={() => navigate(`/calidad/laboratorio/equipos/${row.idEquipo}`)}
      title="Ver detalle del equipo"
    >
      {row.nombre}
    </span>
  );

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-3">
        <PageHeader
          icon="fa-solid fa-flask-vial"
          title={lab.nombre}
          subtitle={lab.direccion || 'Sin dirección registrada'}
        />

        <div className="flex flex-wrap gap-2 mb-3">
          <Button
            label="Volver al listado"
            icon="fa-solid fa-arrow-left"
            severity="secondary"
            outlined
            onClick={() => navigate('/calidad/laboratorio/laboratorios')}
          />
          <Button
            label="Editar laboratorio"
            icon="fa-solid fa-pen"
            severity="secondary"
            outlined
            onClick={() => setFormState({ visible: true })}
          />
          <div className="flex-1" />
          <Button
            label="Dar de baja"
            icon="fa-solid fa-trash"
            severity="danger"
            outlined
            onClick={handleEliminar}
          />
        </div>

        {/* Datos generales + prensa por defecto */}
        <div className="grid mb-3">
          <div className="col-12 lg:col-8">
            <Card title="Identificación" className="shadow-1 h-full">
              <div className="grid">
                <Field label="Nombre" value={lab.nombre} />
                <Field label="Dirección" value={lab.direccion} />
                <Field
                  label="Plantas asignadas"
                  value={
                    plantasActivas.length > 0
                      ? plantasActivas.map((p) => p.planta?.nombre || `Planta ${p.idPlanta}`).join(', ')
                      : null
                  }
                  fullWidth
                />
                {lab.observaciones && (
                  <Field label="Observaciones" value={lab.observaciones} fullWidth />
                )}
              </div>
            </Card>
          </div>
          <div className="col-12 lg:col-4">
            <Card title="Prensa por defecto" className="shadow-1 h-full">
              {prensaDefault ? (
                <div className="flex flex-column gap-2 align-items-start">
                  <span
                    className="cursor-pointer text-primary hover:underline font-bold"
                    onClick={() => navigate(`/calidad/laboratorio/equipos/${prensaDefault.idEquipo}`)}
                  >
                    {prensaDefault.nombre}
                  </span>
                  <Tag value="Pre-seleccionada en ensayos" severity="info" icon="fa-solid fa-flask-vial" />
                  <small className="text-color-secondary">
                    Si el lab tiene >1 prensa, ésta se pre-selecciona en el formulario de ensayo de probeta.
                  </small>
                </div>
              ) : (
                <div className="text-color-secondary text-sm">
                  Sin prensa por defecto.
                  <br />
                  <small>
                    Si el laboratorio tiene una sola prensa, se autoselecciona en los ensayos
                    sin necesidad de configurar default acá.
                  </small>
                </div>
              )}
            </Card>
          </div>
        </div>

        {/* Equipos del laboratorio */}
        <Card title={`Equipos del laboratorio (${equipos.length})`} className="shadow-1 mb-3">
          {equipos.length === 0 ? (
            <div className="p-4 text-center text-color-secondary">
              Este laboratorio todavía no tiene equipos asignados.
              <br />
              <Button
                label="Ir a Equipos"
                icon="fa-solid fa-arrow-right"
                severity="secondary"
                outlined
                className="mt-3"
                onClick={() => navigate('/calidad/laboratorio/equipos')}
              />
            </div>
          ) : (
            <DataTable value={equipos} stripedRows responsiveLayout="scroll" size="small">
              <Column header="Tipo" body={tipoEquipoBody} style={{ width: '110px' }} />
              <Column header="Nombre" body={nombreEquipoBody} />
              <Column field="marca" header="Marca" />
              <Column field="modelo" header="Modelo" />
              <Column field="capacidad" header="Capacidad" />
            </DataTable>
          )}
        </Card>

        {/* Piletas del laboratorio */}
        <Card title={`Piletas del laboratorio (${piletas.length})`} className="shadow-1">
          {piletas.length === 0 ? (
            <div className="p-4 text-center text-color-secondary">
              Este laboratorio todavía no tiene piletas asignadas.
            </div>
          ) : (
            <DataTable value={piletas} stripedRows responsiveLayout="scroll" size="small">
              <Column field="nombre" header="Nombre" />
              <Column field="hashId" header="Hash ID" />
              <Column header="Umbral alerta" body={(r) => `${Number(r.umbralAlerta).toFixed(1)} °C`} />
            </DataTable>
          )}
        </Card>

        <LaboratorioForm
          visible={formState.visible}
          onHide={() => setFormState({ visible: false })}
          laboratorio={lab}
          onSaved={fetchData}
        />
      </div>
    </Fade>
  );
};

export default LaboratorioDetailPage;
