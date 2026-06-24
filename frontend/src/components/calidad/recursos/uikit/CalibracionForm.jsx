import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputNumber } from 'primereact/inputnumber';
import { Calendar } from 'primereact/calendar';
import { Button } from 'primereact/button';
import { FileUpload } from 'primereact/fileupload';
import axios from 'axios';
import { config } from '../../../../config/config';
import { createCalibracion } from '../../../../services/equipoLaboratorioService';
import { useToast } from '../../../../context/ToastContext';
import dayjs from 'dayjs';

/**
 * Form de alta de calibración para un equipo. Persiste con upload
 * opcional del certificado (idArchivoCertificado se setea aparte tras
 * subir el archivo). Para esta primera versión, se permite ingresar
 * sólo número de certificado + ente calibrador; el upload del PDF se
 * agrega en Fase B.2 (requiere flujo de Archivos pre-existente).
 *
 * Coeficientes JSON shape (para prensas):
 *   { uno: number, dos: number, tres: number, r2?: number }
 */
const CalibracionForm = ({ visible, onHide, equipo, onSaved }) => {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form, setForm] = useState({});
  const [certificadoFile, setCertificadoFile] = useState(null);
  const [uploading, setUploading] = useState(false);
  const fileUploadRef = useRef(null);

  useEffect(() => {
    if (visible) {
      const today = new Date();
      const nextYear = new Date();
      nextYear.setFullYear(today.getFullYear() + 1);
      setForm({
        fechaCalibracion: today,
        fechaVencimiento: nextYear,
        enteCalibrador: '',
        numeroCertificado: '',
        incertidumbre: null,
        unidadIncertidumbre: '',
        observaciones: '',
        coefUno: equipo?.coeficienteUno ?? null,
        coefDos: equipo?.coeficienteDos ?? null,
        coefTres: equipo?.coeficienteTres ?? null,
      });
      setCertificadoFile(null);
      fileUploadRef.current?.clear?.();
    }
  }, [visible, equipo]);

  const uploadCertificadoIfNeeded = async () => {
    if (!certificadoFile) return null;
    setUploading(true);
    try {
      const fd = new FormData();
      fd.append('files', certificadoFile);
      if (equipo?.idPlanta) fd.append('idPlanta', equipo.idPlanta);
      const { data } = await axios.post(
        `${config.backendUrl}/api/archivos`,
        fd,
        { headers: { ...config.headers, 'Content-Type': 'multipart/form-data' } },
      );
      const arr = Array.isArray(data) ? data : [data];
      const idArchivo = arr[0]?.idArchivo;
      if (!idArchivo) throw new Error('El servidor no devolvió idArchivo');
      return idArchivo;
    } finally {
      setUploading(false);
    }
  };

  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.fechaCalibracion || !form.fechaVencimiento) {
      showToast('warn', 'Las fechas de calibración y vencimiento son obligatorias.');
      return;
    }
    if (form.fechaVencimiento < form.fechaCalibracion) {
      showToast('warn', 'La fecha de vencimiento debe ser posterior a la de calibración.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      // Subir certificado primero (si hay) para obtener idArchivo y
      // referenciarlo desde la calibración.
      let idArchivoCertificado = null;
      try {
        idArchivoCertificado = await uploadCertificadoIfNeeded();
      } catch (uploadErr) {
        console.error('[CalibracionForm] uploadCertificado:', uploadErr);
        showToast('warn', 'No se pudo subir el certificado. La calibración se guarda sin certificado adjunto.');
      }

      const coeficientes = (equipo?.tipo === 'PRENSA' && (form.coefUno != null || form.coefDos != null || form.coefTres != null))
        ? { uno: form.coefUno, dos: form.coefDos, tres: form.coefTres }
        : null;
      const payload = {
        idEquipo: equipo.idEquipo,
        fechaCalibracion: dayjs(form.fechaCalibracion).format('YYYY-MM-DD'),
        fechaVencimiento: dayjs(form.fechaVencimiento).format('YYYY-MM-DD'),
        enteCalibrador: form.enteCalibrador || null,
        numeroCertificado: form.numeroCertificado || null,
        idArchivoCertificado,
        coeficientes,
        incertidumbre: form.incertidumbre ?? null,
        unidadIncertidumbre: form.unidadIncertidumbre || null,
        observaciones: form.observaciones || null,
      };
      const saved = await createCalibracion(payload);
      showToast('success', 'Calibración registrada.');
      onSaved?.(saved);
      onHide();
    } catch (err) {
      console.error('[CalibracionForm] save:', err);
      showToast('error', err?.response?.data?.error || 'No se pudo registrar la calibración.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={`Registrar calibración: ${equipo?.nombre || ''}`}
      visible={visible}
      onHide={onHide}
      modal
      style={{ width: '90vw', maxWidth: '640px' }}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" severity="secondary" outlined onClick={onHide} disabled={saving || uploading} />
          <Button label="Registrar" icon="fa-solid fa-floppy-disk" onClick={handleSave} loading={saving || uploading} disabled={saving || uploading} />
        </div>
      }
    >
      <div className="grid">
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Fecha de calibración *</label>
          <Calendar
            value={form.fechaCalibracion}
            onChange={(e) => setField('fechaCalibracion')(e.value)}
            dateFormat="dd/mm/yy"
            showIcon
            className="w-full"
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Fecha de vencimiento *</label>
          <Calendar
            value={form.fechaVencimiento}
            onChange={(e) => setField('fechaVencimiento')(e.value)}
            dateFormat="dd/mm/yy"
            showIcon
            className="w-full"
          />
          <small className="text-color-secondary">Hasta cuándo es válida. Típicamente 1 año (ISO 17025).</small>
        </div>
        <div className="col-12 md:col-7">
          <label className="text-sm font-semibold mb-1 block">Ente calibrador</label>
          <InputText
            value={form.enteCalibrador || ''}
            onChange={(e) => setField('enteCalibrador')(e.target.value)}
            placeholder="ej. INTI, laboratorio acreditado"
            className="w-full"
            maxLength={200}
          />
        </div>
        <div className="col-12 md:col-5">
          <label className="text-sm font-semibold mb-1 block">Nº de certificado</label>
          <InputText
            value={form.numeroCertificado || ''}
            onChange={(e) => setField('numeroCertificado')(e.target.value)}
            className="w-full"
            maxLength={100}
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Incertidumbre expandida (k=2)</label>
          <InputNumber
            value={form.incertidumbre}
            onValueChange={(e) => setField('incertidumbre')(e.value)}
            minFractionDigits={2}
            maxFractionDigits={4}
            className="w-full"
            inputClassName="w-full"
            placeholder="ej. 0,5"
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Unidad</label>
          <InputText
            value={form.unidadIncertidumbre || ''}
            onChange={(e) => setField('unidadIncertidumbre')(e.target.value)}
            placeholder="ej. kN, %, g, ºC"
            className="w-full"
            maxLength={20}
          />
        </div>

        {equipo?.tipo === 'PRENSA' && (
          <>
            <div className="col-12">
              <h5 className="mt-2 mb-1">Coeficientes (opcional)</h5>
              <small className="text-color-secondary block mb-2">
                Si se completan, se aplican al equipo y se utilizarán para convertir la lectura de la prensa en los ensayos posteriores.
              </small>
            </div>
            <div className="col-12 md:col-4">
              <label className="text-sm font-semibold mb-1 block">Coef. 1</label>
              <InputNumber value={form.coefUno} onValueChange={(e) => setField('coefUno')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
            </div>
            <div className="col-12 md:col-4">
              <label className="text-sm font-semibold mb-1 block">Coef. 2</label>
              <InputNumber value={form.coefDos} onValueChange={(e) => setField('coefDos')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
            </div>
            <div className="col-12 md:col-4">
              <label className="text-sm font-semibold mb-1 block">Coef. 3</label>
              <InputNumber value={form.coefTres} onValueChange={(e) => setField('coefTres')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
            </div>
          </>
        )}

        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Certificado de calibración (PDF/imagen)</label>
          <FileUpload
            ref={fileUploadRef}
            mode="basic"
            name="files"
            accept="application/pdf,image/*"
            maxFileSize={10 * 1024 * 1024}
            chooseLabel={certificadoFile ? `Archivo: ${certificadoFile.name}` : 'Seleccionar archivo'}
            chooseOptions={{ icon: 'fa-solid fa-paperclip', className: 'p-button-outlined p-button-secondary' }}
            customUpload
            auto={false}
            onSelect={(e) => setCertificadoFile(e.files?.[0] || null)}
            onClear={() => setCertificadoFile(null)}
          />
          <small className="text-color-secondary block mt-1">
            Opcional. PDF o imagen del certificado emitido por el ente calibrador. Máx 10 MB. Se sube al guardar.
          </small>
        </div>
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Observaciones</label>
          <InputTextarea
            value={form.observaciones || ''}
            onChange={(e) => setField('observaciones')(e.target.value)}
            rows={2}
            className="w-full"
            autoResize
          />
        </div>
      </div>
    </Dialog>
  );
};

export default CalibracionForm;
