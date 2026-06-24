import React, { useState, useEffect, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { createEquipo, updateEquipo } from '../../../../services/equipoLaboratorioService';
import { listLaboratorios } from '../../../../services/laboratorioService';
import { useToast } from '../../../../context/ToastContext';
import PlantasMaterialSection from '../../../common/PlantasMaterialSection';

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

const tipoOptions = Object.entries(TIPO_LABELS).map(([value, label]) => ({ value, label }));

const TIPO_OPERACION_OPTIONS = [
  { value: 'MANUAL', label: 'Manual — lectura con dial + ecuación de calibración' },
  { value: 'AUTOMATICA', label: 'Automática — la prensa reporta la carga directa' },
  { value: 'SEMIAUTOMATICA', label: 'Semiautomática — carga directa, control de velocidad manual' },
];

/**
 * Form de alta/edición de EquipoLaboratorio.
 *
 * Props:
 *   visible: boolean
 *   onHide: () => void
 *   equipo: object | null (null = alta nueva)
 *   plantas: Array<{ idPlanta, nombre }>
 *   onSaved: (equipo) => void
 */
const EquipoForm = ({ visible, onHide, equipo, plantas = [], onSaved }) => {
  const showToast = useToast();
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [form, setForm] = useState({});
  const [plantasConfig, setPlantasConfig] = useState([]);
  const [laboratorios, setLaboratorios] = useState([]);

  useEffect(() => {
    if (!visible) return;
    listLaboratorios()
      .then((data) => setLaboratorios(Array.isArray(data) ? data : []))
      .catch(() => setLaboratorios([]));
  }, [visible]);

  useEffect(() => {
    if (visible) {
      setForm(equipo ? { ...equipo, tipoOperacion: equipo.tipoOperacion || 'MANUAL' } : {
        tipo: 'PRENSA',
        nombre: '',
        marca: '',
        modelo: '',
        numeroSerie: '',
        capacidad: '',
        ubicacion: '',
        tipoOperacion: 'MANUAL',
        descripcion: '',
        observaciones: '',
      });
      // Multi-planta: cargar desde `equipo.plantas` si viene del backend
      // (nuevo formato). Fallback: si solo viene `idPlanta` legacy,
      // sintetizamos un único row.
      if (equipo) {
        if (Array.isArray(equipo.plantas) && equipo.plantas.length > 0) {
          setPlantasConfig(equipo.plantas.map((p) => ({
            idPlanta: p.idPlanta,
            nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
            activo: p.activo !== false,
            observaciones: p.observaciones || null,
          })));
        } else if (equipo.idPlanta) {
          const planta = plantas.find((pl) => pl.idPlanta === equipo.idPlanta);
          setPlantasConfig([{
            idPlanta: equipo.idPlanta,
            nombrePlanta: planta?.nombre || equipo.planta?.nombre || `Planta ${equipo.idPlanta}`,
            activo: true,
            observaciones: null,
          }]);
        } else {
          setPlantasConfig([]);
        }
      } else {
        setPlantasConfig([]);
      }
    }
  }, [visible, equipo, plantas]);

  const setField = (key) => (value) => setForm((f) => ({ ...f, [key]: value }));

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!form.nombre?.trim()) {
      showToast('warn', 'El nombre del equipo es obligatorio.');
      return;
    }
    if (!form.tipo) {
      showToast('warn', 'Seleccione el tipo de equipo.');
      return;
    }
    savingRef.current = true;
    setSaving(true);
    try {
      const payload = {
        ...form,
        plantasConfig: plantasConfig.map((p) => ({
          idPlanta: p.idPlanta,
          activo: p.activo !== false,
          observaciones: p.observaciones || null,
        })),
      };
      const saved = equipo?.idEquipo
        ? await updateEquipo(equipo.idEquipo, payload)
        : await createEquipo(payload);
      showToast('success', equipo?.idEquipo ? 'Equipo actualizado.' : 'Equipo creado.');
      onSaved?.(saved);
      onHide();
    } catch (err) {
      console.error('[EquipoForm] save:', err);
      showToast('error', err?.response?.data?.error || 'No se pudo guardar el equipo.');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <Dialog
      header={equipo?.idEquipo ? `Editar equipo: ${equipo.nombre}` : 'Nuevo equipo'}
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
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Tipo de equipo *</label>
          <Dropdown
            value={form.tipo}
            options={tipoOptions}
            onChange={(e) => setField('tipo')(e.value)}
            placeholder="Seleccionar..."
            className="w-full"
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Laboratorio</label>
          <Dropdown
            value={form.idLaboratorio || null}
            options={[
              { label: 'Sin laboratorio asignado', value: null },
              ...laboratorios.map((l) => ({ label: l.nombre, value: l.idLaboratorio })),
            ]}
            onChange={(e) => setField('idLaboratorio')(e.value)}
            className="w-full"
            placeholder="Sin laboratorio asignado"
          />
        </div>
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Nombre *</label>
          <InputText
            value={form.nombre || ''}
            onChange={(e) => setField('nombre')(e.target.value)}
            className="w-full"
            maxLength={100}
          />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Marca</label>
          <InputText value={form.marca || ''} onChange={(e) => setField('marca')(e.target.value)} className="w-full" maxLength={50} />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Modelo</label>
          <InputText value={form.modelo || ''} onChange={(e) => setField('modelo')(e.target.value)} className="w-full" maxLength={50} />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Número de serie</label>
          <InputText value={form.numeroSerie || ''} onChange={(e) => setField('numeroSerie')(e.target.value)} className="w-full" maxLength={100} />
        </div>
        <div className="col-12 md:col-6">
          <label className="text-sm font-semibold mb-1 block">Capacidad</label>
          <InputText
            value={form.capacidad || ''}
            onChange={(e) => setField('capacidad')(e.target.value)}
            className="w-full"
            placeholder='ej. "3000 kN", "500 g"'
            maxLength={50}
          />
        </div>
        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Ubicación</label>
          <InputText
            value={form.ubicacion || ''}
            onChange={(e) => setField('ubicacion')(e.target.value)}
            className="w-full"
            placeholder="ej. Laboratorio principal, sala de curado..."
            maxLength={100}
          />
        </div>

        {form.tipo === 'PRENSA' && (
          <>
            <div className="col-12">
              <label className="text-sm font-semibold mb-1 block">Modo de operación</label>
              <Dropdown
                value={form.tipoOperacion || 'MANUAL'}
                options={TIPO_OPERACION_OPTIONS}
                onChange={(e) => setField('tipoOperacion')(e.value)}
                className="w-full"
              />
              <small className="text-color-secondary block mt-1">
                {form.tipoOperacion === 'AUTOMATICA' || form.tipoOperacion === 'SEMIAUTOMATICA'
                  ? 'La prensa reporta la carga aplicada directamente. En el ensayo se carga la carga, no se necesita ecuación.'
                  : 'La prensa muestra un dial/divisor. El sistema calcula la carga usando la ecuación de calibración.'}
              </small>
            </div>
            {(form.tipoOperacion || 'MANUAL') === 'MANUAL' && (
              <>
                <div className="col-12">
                  <h5 className="mt-3 mb-2">Coeficientes de calibración (prensa manual)</h5>
                  <small className="text-color-secondary block mb-2">
                    Estos valores los completa la calibración vigente. Sirven para conversión lineal o polinómica de la lectura.
                  </small>
                </div>
                <div className="col-12 md:col-4">
                  <label className="text-sm font-semibold mb-1 block">Coef. 1</label>
                  <InputNumber value={form.coeficienteUno} onValueChange={(e) => setField('coeficienteUno')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
                </div>
                <div className="col-12 md:col-4">
                  <label className="text-sm font-semibold mb-1 block">Coef. 2</label>
                  <InputNumber value={form.coeficienteDos} onValueChange={(e) => setField('coeficienteDos')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
                </div>
                <div className="col-12 md:col-4">
                  <label className="text-sm font-semibold mb-1 block">Coef. 3</label>
                  <InputNumber value={form.coeficienteTres} onValueChange={(e) => setField('coeficienteTres')(e.value)} minFractionDigits={2} maxFractionDigits={6} className="w-full" inputClassName="w-full" />
                </div>
              </>
            )}
          </>
        )}

        <div className="col-12">
          <label className="text-sm font-semibold mb-1 block">Descripción</label>
          <InputTextarea
            value={form.descripcion || ''}
            onChange={(e) => setField('descripcion')(e.target.value)}
            rows={2}
            className="w-full"
            autoResize
          />
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
            tituloMaterial="este equipo"
            hidePrecio
          />
        </div>
      </div>
    </Dialog>
  );
};

export default EquipoForm;
