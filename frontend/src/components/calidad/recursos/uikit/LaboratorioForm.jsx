import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import axios from 'axios';
import { config } from '../../../../config/config';
import { createLaboratorio, updateLaboratorio } from '../../../../services/laboratorioService';
import { useToast } from '../../../../context/ToastContext';
import PlantasMaterialSection from '../../../common/PlantasMaterialSection';

/**
 * Form de alta/edición de Laboratorio.
 *
 * Props:
 *   visible: boolean
 *   onHide: () => void
 *   laboratorio: object | null (null = alta nueva)
 *   onSaved: (laboratorio) => void
 */
const LaboratorioForm = ({ visible, onHide, laboratorio, onSaved }) => {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form, setForm] = useState({});
  const [plantasConfig, setPlantasConfig] = useState([]);
  const [prensasOptions, setPrensasOptions] = useState([]);

  useEffect(() => {
    if (!visible) return;
    setForm(laboratorio
      ? {
          nombre: laboratorio.nombre || '',
          direccion: laboratorio.direccion || '',
          observaciones: laboratorio.observaciones || '',
          idPrensaPorDefecto: laboratorio.idPrensaPorDefecto || null,
        }
      : { nombre: '', direccion: '', observaciones: '', idPrensaPorDefecto: null });

    if (laboratorio && Array.isArray(laboratorio.plantas)) {
      setPlantasConfig(laboratorio.plantas.map((p) => ({
        idPlanta: p.idPlanta,
        nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
        activo: p.activo !== false,
        observaciones: p.observaciones || null,
      })));
    } else {
      setPlantasConfig([]);
    }
  }, [visible, laboratorio]);

  // Cargar TODAS las prensas activas (sin filtrar por lab). Las que no estén
  // asignadas a este laboratorio aparecen con un sufijo aclaratorio: si el user
  // las elige como default, el backend las reasigna a este lab automáticamente.
  useEffect(() => {
    if (!visible) return;
    axios.get(`${config.backendUrl}/api/equipos-laboratorio`, {
      headers: config.headers,
      params: { tipo: 'PRENSA' },
    })
      .then(({ data }) => {
        const all = Array.isArray(data) ? data : [];
        const idLabActual = laboratorio?.idLaboratorio
          ? Number(laboratorio.idLaboratorio)
          : null;
        setPrensasOptions([
          { label: 'Sin prensa por defecto', value: null },
          ...all.map((e) => {
            const labEq = e.idLaboratorio != null ? Number(e.idLaboratorio) : null;
            let sufijo = '';
            if (idLabActual != null) {
              if (labEq === null) sufijo = ' — sin laboratorio (se asignará a éste)';
              else if (labEq !== idLabActual) sufijo = ` — actualmente en "${e.laboratorio?.nombre || `Lab ${labEq}`}" (se moverá a éste)`;
            } else if (labEq === null) {
              sufijo = ' — sin laboratorio';
            } else {
              sufijo = ` — en "${e.laboratorio?.nombre || `Lab ${labEq}`}"`;
            }
            return {
              label: `${e.nombre}${e.marca ? ` (${e.marca})` : ''}${sufijo}`,
              value: e.idEquipo,
            };
          }),
        ]);
      })
      .catch(() => setPrensasOptions([{ label: 'Sin prensa por defecto', value: null }]));
  }, [visible, laboratorio]);

  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.nombre?.trim()) {
      showToast('warn', 'El nombre del laboratorio es obligatorio.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        nombre: form.nombre.trim(),
        direccion: form.direccion?.trim() || null,
        observaciones: form.observaciones?.trim() || null,
        idPrensaPorDefecto: form.idPrensaPorDefecto || null,
        plantasConfig: plantasConfig.map((p) => ({
          idPlanta: p.idPlanta,
          activo: p.activo !== false,
          observaciones: p.observaciones || null,
        })),
      };
      const saved = laboratorio?.idLaboratorio
        ? await updateLaboratorio(laboratorio.idLaboratorio, payload)
        : await createLaboratorio(payload);
      showToast('success', laboratorio?.idLaboratorio ? 'Laboratorio actualizado.' : 'Laboratorio creado.');
      onSaved?.(saved);
      onHide();
    } catch (err) {
      console.error('[LaboratorioForm] save:', err);
      showToast('error', err?.response?.data?.error || 'No se pudo guardar el laboratorio.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={laboratorio?.idLaboratorio ? `Editar laboratorio: ${laboratorio.nombre}` : 'Nuevo laboratorio'}
      visible={visible}
      onHide={onHide}
      modal
      style={{ width: '90vw', maxWidth: '720px' }}
      footer={
        <div className="flex justify-content-end gap-2">
          <Button label="Cancelar" severity="secondary" outlined onClick={onHide} disabled={saving} />
          <Button label="Guardar" icon="fa-solid fa-floppy-disk" onClick={handleSave} loading={saving} disabled={saving} />
        </div>
      }
    >
      <div className="grid">
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Nombre *</label>
          <InputText
            value={form.nombre || ''}
            onChange={(e) => setField('nombre')(e.target.value)}
            className="w-full"
            maxLength={150}
            placeholder='ej. "Laboratorio principal Beltrán"'
          />
        </div>
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Dirección</label>
          <InputText
            value={form.direccion || ''}
            onChange={(e) => setField('direccion')(e.target.value)}
            className="w-full"
            maxLength={255}
          />
        </div>
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Prensa por defecto</label>
          <Dropdown
            value={form.idPrensaPorDefecto || null}
            options={prensasOptions}
            onChange={(e) => setField('idPrensaPorDefecto')(e.value)}
            className="w-full"
            placeholder="Sin prensa por defecto"
          />
          <small className="text-color-secondary block mt-1">
            Si el laboratorio tiene una sola prensa, se autoseleccionará en los ensayos.
            Si tiene más de una, ésta se preselecciona y el operador puede cambiarla.
            Si elegís una prensa que está sin laboratorio o en otro, al guardar se asigna a éste.
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

        <div className="col-12 mt-3">
          <PlantasMaterialSection
            value={plantasConfig}
            onChange={setPlantasConfig}
            tituloMaterial="este laboratorio"
            hidePrecio
          />
        </div>
      </div>
    </Dialog>
  );
};

export default LaboratorioForm;
