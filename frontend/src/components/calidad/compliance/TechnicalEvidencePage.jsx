import React, { useCallback, useEffect, useState, useRef } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { Tag } from 'primereact/tag';
import { Calendar } from 'primereact/calendar';
import { Message } from 'primereact/message';
import { confirmDialog, ConfirmDialog } from 'primereact/confirmdialog';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { useToast } from '../../../context/ToastContext';
import { useUserContext } from '../../../context/UserContext';
import { hasRole, ROLES } from '../../../lib/roles';
import {
  listarEvidencias, crearEvidencia, actualizarEvidencia, eliminarEvidencia,
} from '../../../services/technicalEvidenceService';

/**
 * K.5 — Gestión CRUD de evidencias técnicas (CIRSOC §3.2.3.2 f).
 *
 * MVP textual: tipo (LAB_STUDY | PRIOR_PROJECT), referencia, fecha,
 * descripción, laboratorio, url, clase de resistencia aplicable, IDs de
 * materiales asociados (coma-separados).
 */

const TIPO_OPTS = [
  { label: 'Estudio de laboratorio', value: 'LAB_STUDY' },
  { label: 'Antecedente de obra', value: 'PRIOR_PROJECT' },
];

const emptyForm = () => ({
  id: null,
  tipo: 'LAB_STUDY',
  referencia: '',
  fecha: null,
  descripcion: '',
  laboratorio: '',
  urlAdjunto: '',
  claseResistenciaAplicable: '',
  materialesAsociadosCsv: '',
});

const toCsv = (arr) => (Array.isArray(arr) ? arr.join(', ') : '');
const fromCsv = (csv) => String(csv || '')
  .split(',')
  .map((s) => Number(s.trim()))
  .filter((n) => Number.isFinite(n) && n > 0);

const formatFecha = (d) => {
  if (!d) return '—';
  try { return new Date(d).toLocaleDateString('es-AR'); } catch { return String(d); }
};

export default function TechnicalEvidencePage() {
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [dialogVisible, setDialogVisible] = useState(false);
  const [form, setForm] = useState(emptyForm());
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [error, setError] = useState(null);
  const showToast = useToast();
  const { user } = useUserContext();
  const puedeGestionar = hasRole(user, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const items = await listarEvidencias();
      setRows(items);
    } catch (err) {
      showToast?.('error', err.response?.data?.error || 'No se pudo cargar el listado.');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { refresh(); }, [refresh]);

  const openNew = () => {
    setForm(emptyForm());
    setError(null);
    setDialogVisible(true);
  };

  const openEdit = (row) => {
    setForm({
      id: row.id,
      tipo: row.tipo || 'LAB_STUDY',
      referencia: row.referencia || '',
      fecha: row.fecha ? new Date(row.fecha) : null,
      descripcion: row.descripcion || '',
      laboratorio: row.laboratorio || '',
      urlAdjunto: row.urlAdjunto || '',
      claseResistenciaAplicable: row.claseResistenciaAplicable || '',
      materialesAsociadosCsv: toCsv(row.materialesAsociados),
    });
    setError(null);
    setDialogVisible(true);
  };

  const handleSave = async () => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setError(null);
    try {
      const payload = {
        tipo: form.tipo,
        referencia: form.referencia.trim(),
        fecha: form.fecha ? new Date(form.fecha).toISOString().slice(0, 10) : null,
        descripcion: form.descripcion.trim(),
        laboratorio: form.laboratorio.trim() || null,
        urlAdjunto: form.urlAdjunto.trim() || null,
        claseResistenciaAplicable: form.claseResistenciaAplicable.trim() || null,
        materialesAsociados: fromCsv(form.materialesAsociadosCsv),
      };
      if (form.id) {
        await actualizarEvidencia(form.id, payload);
        showToast?.('success', 'Evidencia actualizada');
      } else {
        await crearEvidencia(payload);
        showToast?.('success', 'Evidencia registrada');
      }
      setDialogVisible(false);
      refresh();
    } catch (err) {
      setError(err.response?.data?.error || err.message || 'Error al guardar');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const handleDelete = (row) => {
    confirmDialog({
      message: `¿Retirar la evidencia "${row.referencia}" del repositorio? Quedará marcada como inactiva.`,
      header: 'Confirmar retiro',
      icon: 'pi pi-exclamation-triangle',
      acceptClassName: 'p-button-danger',
      accept: async () => {
        try {
          await eliminarEvidencia(row.id);
          showToast?.('success', 'Evidencia retirada');
          refresh();
        } catch (err) {
          showToast?.('error', err.response?.data?.error || 'No se pudo retirar');
        }
      },
    });
  };

  const tipoBody = (row) => (
    <Tag
      value={row.tipo === 'LAB_STUDY' ? 'Estudio' : 'Antecedente'}
      severity={row.tipo === 'LAB_STUDY' ? 'info' : 'warning'}
    />
  );

  const materialesBody = (row) => {
    const arr = Array.isArray(row.materialesAsociados) ? row.materialesAsociados : [];
    return arr.length > 0 ? arr.join(', ') : '—';
  };

  const accionesBody = (row) => (
    <div className="flex gap-1">
      <Button
        icon="pi pi-pencil"
        size="small"
        rounded
        text
        tooltip="Editar"
        tooltipOptions={{ position: 'top' }}
        disabled={!puedeGestionar}
        onClick={() => openEdit(row)}
      />
      <Button
        icon="pi pi-trash"
        size="small"
        rounded
        text
        severity="danger"
        tooltip="Retirar"
        tooltipOptions={{ position: 'top' }}
        disabled={!puedeGestionar}
        onClick={() => handleDelete(row)}
      />
    </div>
  );

  const formValido = form.referencia.trim().length >= 3
    && form.descripcion.trim().length >= 10
    && !!form.fecha
    && !!form.tipo;

  return (
    <div className="p-4">
      <ConfirmDialog />
      <PageHeader
        icon="fa-solid fa-file-shield"
        title="Evidencias técnicas"
        subtitle="Repositorio CIRSOC §3.2.3.2 f): estudios de laboratorio y antecedentes de obra que respaldan el uso de mezclas CUMPLE_AC."
      />

      <div className="flex justify-content-end mb-3">
        <Button
          label="Nueva evidencia"
          icon="pi pi-plus"
          onClick={openNew}
          disabled={!puedeGestionar}
          tooltip={!puedeGestionar ? 'Requiere rol Responsable de Calidad o Director Técnico' : undefined}
        />
      </div>

      <DataTable responsiveLayout="scroll"
        value={rows}
        loading={loading}
        dataKey="id"
        emptyMessage="No hay evidencias cargadas."
        paginator
        rows={20}
        rowsPerPageOptions={[10, 20, 50]}
      >
        <Column header="Tipo" body={tipoBody} style={{ width: '8rem' }} />
        <Column field="referencia" header="Referencia" sortable />
        <Column field="fecha" header="Fecha" body={(r) => formatFecha(r.fecha)} sortable style={{ width: '8rem' }} />
        <Column field="laboratorio" header="Lab / obra" />
        <Column field="claseResistenciaAplicable" header="Clase" style={{ width: '6rem' }} />
        <Column header="Materiales" body={materialesBody} style={{ width: '10rem' }} />
        <Column field="responsableCarga" header="Cargado por" style={{ width: '10rem' }} />
        <Column header="" body={accionesBody} style={{ width: '7rem' }} />
      </DataTable>

      <Dialog
        visible={dialogVisible}
        onHide={() => !saving && setDialogVisible(false)}
        header={form.id ? `Editar evidencia #${form.id}` : 'Nueva evidencia técnica'}
        style={{ width: 640 }}
        modal
        dismissableMask={!saving}
        footer={
          <div className="flex justify-content-end gap-2">
            <Button label="Cancelar" icon="pi pi-times" outlined onClick={() => setDialogVisible(false)} disabled={saving} />
            <Button label="Guardar" icon="pi pi-save" onClick={handleSave} disabled={!formValido || saving} loading={saving} />
          </div>
        }
      >
        <div className="grid formgrid">
          <div className="col-12 md:col-6 field">
            <label className="text-sm font-bold">Tipo *</label>
            <Dropdown
              value={form.tipo}
              options={TIPO_OPTS}
              onChange={(e) => setForm({ ...form, tipo: e.value })}
              className="w-full"
            />
          </div>
          <div className="col-12 md:col-6 field">
            <label className="text-sm font-bold">Fecha *</label>
            <Calendar
              value={form.fecha}
              onChange={(e) => setForm({ ...form, fecha: e.value })}
              dateFormat="dd/mm/yy"
              showIcon
              className="w-full"
            />
          </div>
          <div className="col-12 field">
            <label className="text-sm font-bold">Referencia * <span className="text-color-secondary">(ID de informe, código, nombre de obra)</span></label>
            <InputText
              value={form.referencia}
              onChange={(e) => setForm({ ...form, referencia: e.target.value })}
              className="w-full"
              placeholder="INF-LAB-2026-0042 / Obra Edificio Quebradas 2023"
            />
          </div>
          <div className="col-12 field">
            <label className="text-sm font-bold">Descripción * <span className="text-color-secondary">(mínimo 10 caracteres)</span></label>
            <InputTextarea
              value={form.descripcion}
              onChange={(e) => setForm({ ...form, descripcion: e.target.value })}
              rows={3}
              className="w-full"
              placeholder="Alcance del estudio, condiciones, resultados relevantes..."
            />
          </div>
          <div className="col-12 md:col-6 field">
            <label className="text-sm font-bold">Laboratorio / obra</label>
            <InputText
              value={form.laboratorio}
              onChange={(e) => setForm({ ...form, laboratorio: e.target.value })}
              className="w-full"
            />
          </div>
          <div className="col-12 md:col-6 field">
            <label className="text-sm font-bold">Clase aplicable <span className="text-color-secondary">(ej: H20)</span></label>
            <InputText
              value={form.claseResistenciaAplicable}
              onChange={(e) => setForm({ ...form, claseResistenciaAplicable: e.target.value })}
              className="w-full"
              placeholder="H20 / H25 / vacío = sin restricción"
            />
          </div>
          <div className="col-12 field">
            <label className="text-sm font-bold">URL del documento <span className="text-color-secondary">(opcional)</span></label>
            <InputText
              value={form.urlAdjunto}
              onChange={(e) => setForm({ ...form, urlAdjunto: e.target.value })}
              className="w-full"
              placeholder="https://..."
            />
          </div>
          <div className="col-12 field">
            <label className="text-sm font-bold">IDs de materiales asociados <span className="text-color-secondary">(coma-separados)</span></label>
            <InputText
              value={form.materialesAsociadosCsv}
              onChange={(e) => setForm({ ...form, materialesAsociadosCsv: e.target.value })}
              className="w-full"
              placeholder="Ej: 101, 102, 203"
            />
            <small className="text-color-secondary">
              Los IDs se ven en la URL de la ficha técnica del material.
            </small>
          </div>
        </div>

        {error && <Message severity="error" text={error} style={{ width: '100%', marginTop: '0.75rem' }} />}
      </Dialog>
    </div>
  );
}
