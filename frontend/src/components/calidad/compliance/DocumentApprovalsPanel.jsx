import React, { useCallback, useEffect, useState, useRef } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Tag } from 'primereact/tag';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { useToast } from '../../../context/ToastContext';
import { useUserContext } from '../../../context/UserContext';
import { hasRole, ROLES } from '../../../lib/roles';
import {
  listarAprobaciones, aprobarCertificado, rechazarCertificado,
} from '../../../services/documentApprovalRequestService';

/**
 * Panel de pedidos de firma de certificados (Fase 2 RBAC).
 *
 * - Todos los usuarios pueden ver el panel.
 * - Solo DT/Admin pueden aprobar (requiere matrícula).
 * - RC/DT/Admin pueden rechazar.
 */

const ESTADO_OPTS = [
  { label: 'Todos', value: null },
  { label: 'Pendientes', value: 'PENDIENTE' },
  { label: 'Aprobados', value: 'APROBADO' },
  { label: 'Rechazados', value: 'RECHAZADO' },
];

const TIPO_DOC_LABEL = {
  CERTIFICADO: 'Certificado',
  INFORME_EVALUACION: 'Informe',
  CERTIFICADO_DOSIFICACION: 'Cert. dosificación',
};

const fmtFecha = (d) => { if (!d) return '—'; try { return new Date(d).toLocaleString('es-AR'); } catch { return String(d); } };

export default function DocumentApprovalsPanel() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [filterEstado, setFilterEstado] = useState('PENDIENTE');
  const [resolveDialog, setResolveDialog] = useState({ visible: false, row: null, modo: 'approve' });
  const [matricula, setMatricula] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [error, setError] = useState(null);
  const showToast = useToast();
  const { user } = useUserContext();
  const puedeAprobar = hasRole(user, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN);
  const puedeRechazar = hasRole(user, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listarAprobaciones(filterEstado ? { estado: filterEstado, includeInactive: 'true' } : { includeInactive: 'true' });
      setRows(items);
    } catch (err) {
      showToast?.('error', err.response?.data?.error || 'No se pudo cargar el listado.');
    } finally {
      setLoading(false);
    }
  }, [filterEstado, showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const openResolveDialog = (row, modo) => {
    setResolveDialog({ visible: true, row, modo });
    setMatricula('');
    setObservaciones('');
    setError(null);
  };

  const handleResolve = async () => {
    if (enviandoRef.current) return;
    if (!resolveDialog.row) return;
    enviandoRef.current = true;
    setEnviando(true);
    setError(null);
    try {
      if (resolveDialog.modo === 'approve') {
        if (matricula.trim().length < 3) {
          setError('La matrícula profesional es obligatoria para firmar un certificado.');
          enviandoRef.current = false;
          setEnviando(false);
          return;
        }
        await aprobarCertificado(resolveDialog.row.id, {
          matricula: matricula.trim(),
          observaciones: observaciones.trim() || null,
        });
        showToast?.('success', 'Certificado aprobado y firmado');
      } else {
        await rechazarCertificado(resolveDialog.row.id, {
          observaciones: observaciones.trim() || null,
        });
        showToast?.('warn', 'Pedido rechazado');
      }
      setResolveDialog({ visible: false, row: null, modo: 'approve' });
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al resolver');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const estadoBody = (row) => {
    const severity =
      row.estado === 'PENDIENTE' ? 'warning'
      : row.estado === 'APROBADO' ? 'success'
      : row.estado === 'RECHAZADO' ? 'danger'
      : 'info';
    return <Tag severity={severity} value={row.estado} />;
  };

  const tipoBody = (row) => TIPO_DOC_LABEL[row.tipoDocumento] || row.tipoDocumento;

  const entidadBody = (row) => {
    if (row.idMaterial) return `Material #${row.idMaterial}`;
    if (row.idDosificacionDisenada) return `Dosif. #${row.idDosificacionDisenada}`;
    return '—';
  };

  const resolutorBody = (row) => {
    if (!row.resueltoPor) return '—';
    const mat = row.matriculaResolutor ? ` (Mat. ${row.matriculaResolutor})` : '';
    return `${row.resueltoPor}${mat}`;
  };

  const accionesBody = (row) => {
    if (row.estado !== 'PENDIENTE') return null;
    return (
      <div className="flex gap-1">
        <Button
          icon="pi pi-check"
          size="small"
          rounded
          text
          severity="success"
          tooltip="Aprobar y firmar"
          tooltipOptions={{ position: 'top' }}
          disabled={!puedeAprobar}
          onClick={() => openResolveDialog(row, 'approve')}
        />
        <Button
          icon="pi pi-times"
          size="small"
          rounded
          text
          severity="danger"
          tooltip="Rechazar"
          tooltipOptions={{ position: 'top' }}
          disabled={!puedeRechazar}
          onClick={() => openResolveDialog(row, 'reject')}
        />
      </div>
    );
  };

  return (
    <div className="p-4">
      <PageHeader
        icon="fa-solid fa-signature"
        title="Aprobaciones de certificados"
        subtitle="Pedidos de firma pendientes y resueltos (Fase 2 RBAC)."
      />

      <div className="flex justify-content-between align-items-center mb-3">
        <Dropdown
          value={filterEstado}
          options={ESTADO_OPTS}
          onChange={(e) => setFilterEstado(e.value)}
          placeholder="Filtrar por estado"
          style={{ width: 200 }}
        />
        <Button label="Refrescar" icon="pi pi-refresh" outlined onClick={refresh} />
      </div>

      <DataTable responsiveLayout="scroll"
        value={rows}
        loading={loading}
        dataKey="id"
        emptyMessage="No hay pedidos con ese filtro."
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50]}
      >
        <Column header="Estado" body={estadoBody} style={{ width: '7rem' }} />
        <Column header="Tipo" body={tipoBody} style={{ width: '7rem' }} />
        <Column header="Entidad" body={entidadBody} style={{ width: '10rem' }} />
        <Column field="solicitadoPor" header="Solicitante" style={{ width: '10rem' }} />
        <Column header="Fecha solicitud" body={(r) => fmtFecha(r.fechaSolicitud)} style={{ width: '11rem' }} />
        <Column header="Firmante" body={resolutorBody} />
        <Column header="Fecha resolución" body={(r) => fmtFecha(r.fechaResolucion)} style={{ width: '11rem' }} />
        <Column header="" body={accionesBody} style={{ width: '7rem' }} />
      </DataTable>

      <Dialog
        visible={resolveDialog.visible}
        onHide={() => !enviando && setResolveDialog({ visible: false, row: null, modo: 'approve' })}
        header={resolveDialog.modo === 'approve' ? 'Aprobar y firmar certificado' : 'Rechazar pedido'}
        style={{ width: 540 }}
        modal
        dismissableMask={!enviando}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" icon="pi pi-times" outlined onClick={() => setResolveDialog({ visible: false, row: null, modo: 'approve' })} disabled={enviando} />
            <Button
              label={resolveDialog.modo === 'approve' ? 'Firmar' : 'Rechazar'}
              icon={resolveDialog.modo === 'approve' ? 'pi pi-check' : 'pi pi-times'}
              severity={resolveDialog.modo === 'approve' ? 'success' : 'danger'}
              onClick={handleResolve}
              loading={enviando}
              disabled={enviando}
            />
          </div>
        }
      >
        {resolveDialog.row && (
          <>
            <p className="text-sm text-color-secondary mb-3">
              {resolveDialog.modo === 'approve'
                ? 'Al firmar, el certificado queda aprobado y puede descargarse con tu firma y matrícula estampadas.'
                : 'El pedido queda marcado como rechazado. Se puede crear uno nuevo tras subsanar las observaciones.'}
            </p>

            {resolveDialog.row.motivoSolicitud && (
              <Message
                severity="info"
                text={`Motivo del solicitante: ${resolveDialog.row.motivoSolicitud}`}
                style={{ width: '100%', marginBottom: '0.75rem' }}
              />
            )}

            {resolveDialog.modo === 'approve' && (
              <>
                <label className="text-sm font-bold">Matrícula profesional *</label>
                <InputText
                  value={matricula}
                  onChange={(e) => setMatricula(e.target.value)}
                  className="w-full mb-3"
                  placeholder="Ej: CPIC 12345"
                />
              </>
            )}

            <label className="text-sm font-bold">Observaciones</label>
            <InputTextarea
              value={observaciones}
              onChange={(e) => setObservaciones(e.target.value)}
              rows={3}
              className="w-full"
              placeholder={resolveDialog.modo === 'approve' ? 'Comentarios del firmante (opcional).' : 'Razón del rechazo (se guarda en el log).'}
            />

            {error && <Message severity="error" text={error} style={{ width: '100%', marginTop: '0.75rem' }} />}
          </>
        )}
      </Dialog>
    </div>
  );
}
