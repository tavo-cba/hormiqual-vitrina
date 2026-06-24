import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';
import { Dropdown } from 'primereact/dropdown';
import { InputText } from 'primereact/inputtext';
import { Message } from 'primereact/message';
import { crearOverride, aprobarOverride } from '../../../services/overrideRequestService';

/**
 * Diálogo de override CIRSOC §3.2.3.2 f) (Bloque K.3).
 *
 * Se abre cuando el backend devuelve un 422 con code=REQUIRES_TECHNICAL_EVIDENCE
 * al guardar o transicionar un diseño: la mezcla cumple banda A-C pero no A-B
 * y no hay TechnicalEvidence cargada. El responsable técnico declara motivo,
 * evidencia alternativa informal y ámbito (obra vs autocontrol), y el
 * backend registra el pedido + lo aprueba en un solo paso si el rol alcanza.
 *
 * Props:
 *   - visible: bool
 *   - onHide: () => void
 *   - onSuccess: (overrideRow) => void  // se invoca al aprobar → caller re-intenta la acción
 *   - context: {
 *       idDosificacionDisenada,  // requerido (el diseño que disparó el error)
 *       idMezcla,                // requerido
 *       mezclaNombre,
 *       motivoError,             // texto del mensaje 422 para mostrar al usuario
 *     }
 *   - rolUsuario: string  // 'DIRECTOR_TECNICO' | 'RESPONSABLE_CALIDAD' | ...
 */

const AMBITOS = [
  { label: 'Obra — Director Técnico (con matrícula)', value: 'OBRA' },
  { label: 'Autocontrol de planta — Responsable de Calidad', value: 'AUTOCONTROL_PLANTA' },
];

export default function OverrideRequestDialog({ visible, onHide, onSuccess, context, rolUsuario }) {
  const [ambito, setAmbito] = useState('OBRA');
  const [motivo, setMotivo] = useState('');
  const [evidenciaAlternativa, setEvidenciaAlternativa] = useState('');
  const [matricula, setMatricula] = useState('');
  const [observaciones, setObservaciones] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (visible) {
      setAmbito('OBRA');
      setMotivo('');
      setEvidenciaAlternativa('');
      setMatricula('');
      setObservaciones('');
      setErrorMsg(null);
      setEnviando(false);
    }
  }, [visible]);

  const puedeResolver = useMemo(() => {
    if (!rolUsuario) return false;
    if (rolUsuario === 'ADMIN') return true;
    if (ambito === 'OBRA') return rolUsuario === 'DIRECTOR_TECNICO';
    return rolUsuario === 'RESPONSABLE_CALIDAD' || rolUsuario === 'DIRECTOR_TECNICO';
  }, [ambito, rolUsuario]);

  const motivoValido = motivo.trim().length >= 10;
  const matriculaValida = ambito !== 'OBRA' || matricula.trim().length >= 3;
  const puedeEnviar = motivoValido && matriculaValida && !enviando && puedeResolver && context?.idDosificacionDisenada && context?.idMezcla;

  const handleSubmit = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorMsg(null);
    try {
      const creado = await crearOverride({
        idDosificacionDisenada: context.idDosificacionDisenada,
        idMezcla: context.idMezcla,
        ambito,
        motivo: motivo.trim(),
        evidenciaAlternativaDescripcion: evidenciaAlternativa.trim() || null,
      });
      const aprobado = await aprobarOverride(creado.id, {
        matricula: ambito === 'OBRA' ? matricula.trim() : null,
        observaciones: observaciones.trim() || null,
      });
      if (typeof onSuccess === 'function') onSuccess(aprobado);
      onHide();
    } catch (err) {
      const data = err.response?.data;
      setErrorMsg(data?.error || data?.message || err.message || 'No se pudo registrar el override.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="pi pi-times" outlined onClick={onHide} disabled={enviando} />
      <Button
        label="Registrar y firmar liberación"
        icon="pi pi-check"
        severity="warning"
        onClick={handleSubmit}
        disabled={!puedeEnviar}
        loading={enviando}
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header="Liberación bajo CIRSOC §3.2.3.2 f)"
      footer={footer}
      style={{ width: 640 }}
      modal
      dismissableMask={!enviando}
    >
      <Message
        severity="warn"
        text={
          context?.motivoError ||
          `La mezcla "${context?.mezclaNombre || ''}" requiere evidencia técnica respaldatoria (estudio de laboratorio o antecedente de obra). Al firmar el override, asumís la responsabilidad técnica bajo CIRSOC §3.2.3.2 f).`
        }
        style={{ width: '100%' }}
      />

      <p className="text-sm mt-3 mb-2">
        <strong>Ámbito de la liberación</strong>
      </p>
      <Dropdown
        value={ambito}
        options={AMBITOS}
        onChange={(e) => setAmbito(e.value)}
        className="w-full mb-3"
      />
      {!puedeResolver && (
        <Message
          severity="error"
          text={
            ambito === 'OBRA'
              ? 'Solo un Director Técnico puede firmar un override de ámbito OBRA.'
              : 'Solo un Responsable de Calidad o Director Técnico puede firmar este override.'
          }
          style={{ width: '100%', marginBottom: '0.75rem' }}
        />
      )}

      <p className="text-sm mt-2 mb-2">
        <strong>Motivo técnico</strong>{' '}
        <span className="text-color-secondary">(mínimo 10 caracteres)</span>
      </p>
      <InputTextarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        className="w-full mb-3"
        placeholder="Justificación técnica: experiencia previa, análisis de comportamiento, razón de excepción..."
      />

      <p className="text-sm mt-2 mb-2">
        <strong>Evidencia alternativa</strong>{' '}
        <span className="text-color-secondary">(opcional — evidencia informal que no llega a TechnicalEvidence formal)</span>
      </p>
      <InputTextarea
        value={evidenciaAlternativa}
        onChange={(e) => setEvidenciaAlternativa(e.target.value)}
        rows={2}
        className="w-full mb-3"
        placeholder="Ej: Obra Edificio Quebradas 2023, mismo proveedor de arena, sin incidentes reportados."
      />

      {ambito === 'OBRA' && (
        <>
          <p className="text-sm mt-2 mb-2">
            <strong>Matrícula profesional</strong>{' '}
            <span className="text-color-secondary">(requerida para firma en obra)</span>
          </p>
          <InputText
            value={matricula}
            onChange={(e) => setMatricula(e.target.value)}
            className="w-full mb-3"
            placeholder="Ej: CPIC 12345 / CAI 6789"
          />
        </>
      )}

      <p className="text-sm mt-2 mb-2">
        <strong>Observaciones de la firma</strong>{' '}
        <span className="text-color-secondary">(opcional)</span>
      </p>
      <InputTextarea
        value={observaciones}
        onChange={(e) => setObservaciones(e.target.value)}
        rows={2}
        className="w-full mb-2"
        placeholder="Comentarios adicionales para el log auditable."
      />

      {errorMsg && (
        <Message severity="error" text={errorMsg} style={{ width: '100%', marginTop: '0.75rem' }} />
      )}

      <p className="text-xs text-color-secondary mt-3 mb-0">
        Quedará registrado como log auditable junto a tu usuario y estampado en los PDFs del
        diseño (certificado, informe de dosificación). El override es por este diseño + mezcla
        específicos; cualquier cambio invalida la liberación y exige una nueva.
      </p>
    </Dialog>
  );
}
