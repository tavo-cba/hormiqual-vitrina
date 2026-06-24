import React, { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { Card } from 'primereact/card';
import { Button } from 'primereact/button';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Tag } from 'primereact/tag';
import { ProgressSpinner } from 'primereact/progressspinner';
import { Message } from 'primereact/message';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import { Fade } from 'react-awesome-reveal';
import axios from 'axios';
import { config } from '../../../config/config';
import { useToast } from '../../../context/ToastContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import {
  getEquipo,
  anularCalibracion,
  deleteEquipo,
} from '../../../services/equipoLaboratorioService';
import CalibracionStatusBadge from './uikit/CalibracionStatusBadge';
import CalibracionForm from './uikit/CalibracionForm';
import EquipoForm from './uikit/EquipoForm';
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

/**
 * Vista detalle del equipo de laboratorio (Recursos MVP Fase D).
 *
 * Cierra el ciclo de trazabilidad: un perito o auditor llega acá y ve:
 *  - Datos identificatorios del equipo (incluido número de serie).
 *  - Estado actual de la calibración (badge color-coded).
 *  - Histórico completo de calibraciones con fecha, vencimiento, ente,
 *    incertidumbre, certificado adjunto descargable.
 *  - Cuántos ensayos de resistencia están atados a cada calibración
 *    (snapshot vía `EnsayoResistencia.idCalibracionAplicada` —
 *    visible una vez que la Fase C empiece a poblar el campo).
 */
const EquipoDetailPage = () => {
  const { id } = useParams();
  const navigate = useNavigate();
  const showToast = useToast();
  const [equipo, setEquipo] = useState(null);
  const [loading, setLoading] = useState(true);
  const [plantas, setPlantas] = useState([]);
  const [calForm, setCalForm] = useState({ visible: false });
  const [equipoForm, setEquipoForm] = useState({ visible: false });

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const eq = await getEquipo(id);
      setEquipo(eq);
    } catch (err) {
      console.error('[EquipoDetail] fetch:', err);
      showToast('error', err?.response?.data?.error || 'No se pudo cargar el equipo.');
      setEquipo(null);
    } finally {
      setLoading(false);
    }
  }, [id, showToast]);

  const fetchPlantas = useCallback(async () => {
    try {
      const { data } = await axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers });
      setPlantas(data || []);
    } catch (err) {
      console.error('[EquipoDetail] plantas:', err);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);
  useEffect(() => { fetchPlantas(); }, [fetchPlantas]);

  const handleDescargarCertificado = (cal) => {
    const idArchivo = cal.idArchivoCertificado;
    if (!idArchivo) return;
    const url = `${config.backendUrl}/api/archivos/${idArchivo}/download`;
    const token = localStorage.getItem('token');
    // El endpoint requiere JWT — abrir en una pestaña nueva con el header
    // no es posible directo desde un <a>, usamos fetch + blob.
    axios.get(url, { headers: { ...config.headers, Authorization: `Bearer ${token}` }, responseType: 'blob' })
      .then((res) => {
        const blob = new Blob([res.data], { type: res.headers['content-type'] || 'application/octet-stream' });
        const dlUrl = window.URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = dlUrl;
        const fileName = cal.certificadoArchivo?.nombreOriginal
          || `certificado_calibracion_${cal.idCalibracion}.pdf`;
        link.download = fileName;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        window.URL.revokeObjectURL(dlUrl);
      })
      .catch((err) => {
        console.error('[EquipoDetail] descarga:', err);
        showToast('error', 'No se pudo descargar el certificado.');
      });
  };

  const handleAnularCalibracion = (cal) => {
    confirmDialog({
      message: `¿Anular la calibración del ${dayjs(cal.fechaCalibracion).format('DD/MM/YYYY')}? La calibración queda registrada en el histórico (no se borra) pero deja de aplicar.`,
      header: 'Confirmar anulación',
      icon: 'fa-solid fa-triangle-exclamation',
      acceptLabel: 'Anular',
      rejectLabel: 'Cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await anularCalibracion(cal.idCalibracion);
          showToast('success', 'Calibración anulada.');
          fetchData();
        } catch (err) {
          console.error('[EquipoDetail] anular:', err);
          showToast('error', err?.response?.data?.error || 'No se pudo anular.');
        }
      },
    });
  };

  const handleEliminarEquipo = () => {
    confirmDialog({
      message: `¿Dar de baja el equipo "${equipo.nombre}"? Los ensayos históricos que lo referencian seguirán visibles.`,
      header: 'Confirmar baja',
      icon: 'fa-solid fa-triangle-exclamation',
      acceptLabel: 'Dar de baja',
      rejectLabel: 'Cancelar',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await deleteEquipo(equipo.idEquipo);
          showToast('success', 'Equipo dado de baja.');
          navigate('/calidad/laboratorio/equipos');
        } catch (err) {
          console.error('[EquipoDetail] delete:', err);
          showToast('error', err?.response?.data?.error || 'No se pudo eliminar.');
        }
      },
    });
  };

  if (loading) {
    return (
      <div className="flex justify-content-center p-6">
        <ProgressSpinner />
      </div>
    );
  }
  if (!equipo) {
    return (
      <div className="p-3">
        <Message severity="warn" text="No se encontró el equipo." className="w-full" />
        <Button label="Volver al listado" icon="fa-solid fa-arrow-left" outlined className="mt-3"
          onClick={() => navigate('/calidad/laboratorio/equipos')} />
      </div>
    );
  }

  const calibraciones = equipo.calibraciones || [];
  const activas = calibraciones.filter((c) => c.activo);

  /* ── Templates de columnas ── */
  const fechaBody = (row, field) => row[field] ? dayjs(row[field]).format('DD/MM/YYYY') : '—';

  const certificadoBody = (row) => {
    if (!row.idArchivoCertificado) return <span className="text-color-secondary">—</span>;
    return (
      <Button
        icon="fa-solid fa-file-arrow-down"
        size="small"
        outlined
        tooltip={row.certificadoArchivo?.nombreOriginal || 'Descargar certificado'}
        tooltipOptions={{ position: 'top' }}
        onClick={() => handleDescargarCertificado(row)}
      />
    );
  };

  const incertidumbreBody = (row) => {
    if (row.incertidumbre == null) return <span className="text-color-secondary">—</span>;
    return `± ${row.incertidumbre} ${row.unidadIncertidumbre || ''}`.trim();
  };

  const estadoBody = (row) => {
    if (!row.activo) return <Tag severity="secondary" value="Anulada" />;
    const venc = new Date(row.fechaVencimiento);
    const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
    venc.setHours(0, 0, 0, 0);
    if (venc < hoy) return <Tag severity="danger" value="Vencida" icon="fa-solid fa-circle-xmark" />;
    return <Tag severity="success" value="Vigente" icon="fa-solid fa-circle-check" />;
  };

  const accionesBody = (row) => {
    if (!row.activo) return null;
    return (
      <Button
        icon="fa-solid fa-ban"
        size="small"
        severity="danger"
        outlined
        tooltip="Anular calibración"
        tooltipOptions={{ position: 'top' }}
        onClick={() => handleAnularCalibracion(row)}
      />
    );
  };

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-3">
        <ConfirmDialog />

        <PageHeader
          icon="fa-solid fa-boxes-stacked"
          title={equipo.nombre}
          subtitle={`${TIPO_LABELS[equipo.tipo] || equipo.tipo} · ${equipo.marca || ''} ${equipo.modelo || ''}`.trim()}
        />

        <div className="flex flex-wrap gap-2 mb-3">
          <Button
            label="Volver al listado"
            icon="fa-solid fa-arrow-left"
            severity="secondary"
            outlined
            onClick={() => navigate('/calidad/laboratorio/equipos')}
          />
          <Button
            label="Editar equipo"
            icon="fa-solid fa-pen"
            severity="secondary"
            outlined
            onClick={() => setEquipoForm({ visible: true })}
          />
          <Button
            label="Registrar calibración"
            icon="fa-solid fa-plus"
            severity="success"
            onClick={() => setCalForm({ visible: true })}
          />
          <div className="flex-1" />
          <Button
            label="Dar de baja"
            icon="fa-solid fa-trash"
            severity="danger"
            outlined
            onClick={handleEliminarEquipo}
          />
        </div>

        {/* Datos del equipo + estado de calibración */}
        <div className="grid mb-3">
          <div className="col-12 lg:col-8">
            <Card title="Identificación" className="shadow-1 h-full">
              <div className="grid">
                <Field label="Tipo" value={TIPO_LABELS[equipo.tipo] || equipo.tipo} />
                <Field label="Marca" value={equipo.marca} />
                <Field label="Modelo" value={equipo.modelo} />
                <Field label="Número de serie" value={equipo.numeroSerie} />
                <Field label="Capacidad" value={equipo.capacidad} />
                <Field label="Año" value={equipo.anio ? dayjs(equipo.anio).format('YYYY') : null} />
                <Field label="Ubicación" value={equipo.ubicacion} fullWidth />
                <Field label="Laboratorio" value={equipo.laboratorio?.nombre} />
                <Field label="Planta" value={equipo.planta?.nombre} />
                {equipo.tipo === 'PRENSA' && (
                  <>
                    <Field label="Coef. 1" value={equipo.coeficienteUno} />
                    <Field label="Coef. 2" value={equipo.coeficienteDos} />
                    <Field label="Coef. 3" value={equipo.coeficienteTres} />
                  </>
                )}
                {equipo.descripcion && <Field label="Descripción" value={equipo.descripcion} fullWidth />}
                {equipo.observaciones && <Field label="Observaciones" value={equipo.observaciones} fullWidth />}
              </div>
            </Card>
          </div>
          <div className="col-12 lg:col-4">
            <Card title="Estado de calibración" className="shadow-1 h-full">
              <div className="flex flex-column gap-3 align-items-center">
                <CalibracionStatusBadge
                  estado={equipo.estadoCalibracion}
                  diasParaVencer={equipo.diasParaVencer}
                />
                {equipo.ultimaCalibracion && (
                  <div className="text-sm text-color-secondary text-center">
                    Última: {dayjs(equipo.ultimaCalibracion.fechaCalibracion).format('DD/MM/YYYY')}
                    <br />
                    Vence: <strong>{dayjs(equipo.ultimaCalibracion.fechaVencimiento).format('DD/MM/YYYY')}</strong>
                  </div>
                )}
                {!equipo.ultimaCalibracion && (
                  <div className="text-sm text-color-secondary text-center">
                    Este equipo todavía no tiene calibraciones registradas.
                    <br />
                    <small>ISO 17025 §6.4.7 exige trazabilidad activa.</small>
                  </div>
                )}
                {equipo.alertaPendiente && (
                  <Message
                    severity={equipo.alertaPendiente.nivel === 'CRITICO' ? 'error' : 'warn'}
                    className="w-full"
                    text={equipo.alertaPendiente.tipo === 'CALIBRACION_VENCIDA'
                      ? 'Tiene alerta pendiente: calibración VENCIDA.'
                      : 'Tiene alerta pendiente: calibración por vencer.'}
                  />
                )}
              </div>
            </Card>
          </div>
        </div>

        {/* Histórico de calibraciones */}
        <Card title={`Histórico de calibraciones (${activas.length} activa${activas.length !== 1 ? 's' : ''} de ${calibraciones.length})`} className="shadow-1">
          {calibraciones.length === 0 ? (
            <div className="p-4 text-center text-color-secondary">
              No hay calibraciones registradas para este equipo.
              <br />
              <Button
                label="Registrar la primera calibración"
                icon="fa-solid fa-plus"
                severity="success"
                outlined
                className="mt-3"
                onClick={() => setCalForm({ visible: true })}
              />
            </div>
          ) : (
            <DataTable
              value={calibraciones}
              stripedRows
              responsiveLayout="scroll"
              size="small"
            >
              <Column header="Fecha calibración" body={(r) => fechaBody(r, 'fechaCalibracion')} sortable sortField="fechaCalibracion" />
              <Column header="Vencimiento" body={(r) => fechaBody(r, 'fechaVencimiento')} sortable sortField="fechaVencimiento" />
              <Column field="enteCalibrador" header="Ente calibrador" />
              <Column field="numeroCertificado" header="Nº certificado" />
              <Column header="Incertidumbre" body={incertidumbreBody} />
              <Column header="Certificado" body={certificadoBody} style={{ width: '100px' }} />
              <Column header="Estado" body={estadoBody} style={{ width: '130px' }} />
              <Column header="" body={accionesBody} style={{ width: '70px' }} />
            </DataTable>
          )}
        </Card>

        <CalibracionForm
          visible={calForm.visible}
          onHide={() => setCalForm({ visible: false })}
          equipo={equipo}
          onSaved={fetchData}
        />
        <EquipoForm
          visible={equipoForm.visible}
          onHide={() => setEquipoForm({ visible: false })}
          equipo={equipo}
          plantas={plantas}
          onSaved={fetchData}
        />
      </div>
    </Fade>
  );
};

/** Helper visual: par label/value en la grid de identificación. */
const Field = ({ label, value, fullWidth }) => (
  <div className={fullWidth ? 'col-12' : 'col-12 md:col-6 lg:col-4'}>
    <div className="text-xs text-500 mb-1">{label}</div>
    <div className="text-900">{value || <span className="text-color-secondary">—</span>}</div>
  </div>
);

export default EquipoDetailPage;
