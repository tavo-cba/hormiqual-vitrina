import React, { useEffect, useMemo, useState, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Dropdown } from 'primereact/dropdown';
import { InputTextarea } from 'primereact/inputtextarea';
import { Checkbox } from 'primereact/checkbox';
import { Message } from 'primereact/message';
import { listarFirmantesOverride } from '../../../services/dosificacionDisenoService';

/**
 * Override de pastón aprobado (Fase 3).
 *
 * Se abre cuando el backend devuelve 422 con `code: PASTON_REQUERIDO` al
 * intentar la transición A_PRUEBA → EN_PRODUCCION. Permite a un firmante
 * autorizado (RESPONSABLE_CALIDAD, DIRECTOR_TECNICO o ADMIN) habilitar la
 * transición declarando un motivo ≥50 caracteres.
 *
 * Filosofía: el sistema NO traba a una persona que cubre todo el ciclo. Si
 * en el tenant no hay un firmante distinto del aprobador, la UI lo permite
 * con un check explícito y el backend marca `firmaConcentrada=true` en el
 * timeline para auditoría.
 *
 * Props:
 *   - visible: bool
 *   - onHide: () => void
 *   - onConfirm: ({ firmadoPor, motivo }) => Promise — el caller hace retry de la transición
 *   - userActual: { nombre, name, lastname, username, ... } — para identificar firma concentrada
 *   - motivoError: string — texto del 422 a mostrar arriba como contexto
 */

const MOTIVO_MIN = 50;
const MOTIVO_MAX = 1000;

function nombreCompleto(user) {
  if (!user) return '';
  if (user.displayName) return user.displayName;
  if (user.nombre) return user.nombre;
  return `${user.name || ''} ${user.lastname || ''}`.trim() || user.username || '';
}

export default function OverridePastonDialog({ visible, onHide, onConfirm, userActual, motivoError }) {
  const [firmantes, setFirmantes] = useState([]);
  const [cargandoFirmantes, setCargandoFirmantes] = useState(false);
  const [errorCarga, setErrorCarga] = useState(null);
  const [firmanteId, setFirmanteId] = useState(null);
  const [motivo, setMotivo] = useState('');
  const [aceptaFirmaPropia, setAceptaFirmaPropia] = useState(false);
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [errorEnvio, setErrorEnvio] = useState(null);

  const userActualNombre = useMemo(() => nombreCompleto(userActual), [userActual]);

  useEffect(() => {
    if (!visible) return;
    setFirmanteId(null);
    setMotivo('');
    setAceptaFirmaPropia(false);
    setErrorEnvio(null);
    setErrorCarga(null);
    setCargandoFirmantes(true);
    listarFirmantesOverride()
      .then((rows) => {
        setFirmantes(rows);
        // Pre-seleccionar el primer DT distinto del user actual; si no hay,
        // pre-selecciona al user actual (planta chica) y exige check.
        const sugerido =
          rows.find((r) => r.roles.includes('DIRECTOR_TECNICO') && nombreCompleto(r) !== userActualNombre) ||
          rows.find((r) => r.roles.includes('DIRECTOR_TECNICO')) ||
          rows.find((r) => nombreCompleto(r) !== userActualNombre) ||
          rows[0];
        setFirmanteId(sugerido?.id ?? null);
      })
      .catch((err) => {
        setErrorCarga(err.response?.data?.error || err.message || 'No se pudo cargar la lista de firmantes.');
      })
      .finally(() => setCargandoFirmantes(false));
  }, [visible, userActualNombre]);

  const firmanteSeleccionado = useMemo(
    () => firmantes.find((f) => f.id === firmanteId) || null,
    [firmantes, firmanteId]
  );

  const firmaConcentrada = useMemo(() => {
    if (!firmanteSeleccionado || !userActualNombre) return false;
    return nombreCompleto(firmanteSeleccionado).toLowerCase() === userActualNombre.toLowerCase();
  }, [firmanteSeleccionado, userActualNombre]);

  const motivoLen = motivo.trim().length;
  const motivoValido = motivoLen >= MOTIVO_MIN && motivoLen <= MOTIVO_MAX;
  const checkAdicionalOk = !firmaConcentrada || aceptaFirmaPropia;
  const puedeFirmar = !!firmanteSeleccionado && motivoValido && checkAdicionalOk && !enviando;

  const handleSubmit = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorEnvio(null);
    try {
      const firmadoPor = nombreCompleto(firmanteSeleccionado);
      await onConfirm({ firmadoPor, motivo: motivo.trim() });
      onHide();
    } catch (err) {
      const data = err.response?.data;
      setErrorEnvio(data?.error || err.message || 'No se pudo firmar el override.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const dropdownOptions = useMemo(
    () =>
      firmantes.map((f) => {
        const display = nombreCompleto(f);
        const rolesTxt = f.roles.join(', ');
        const esActual = display.toLowerCase() === userActualNombre.toLowerCase();
        return {
          label: `${display} — ${rolesTxt}${esActual ? ' (vos)' : ''}`,
          value: f.id,
        };
      }),
    [firmantes, userActualNombre]
  );

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="pi pi-times" outlined onClick={onHide} disabled={enviando} />
      <Button
        label="Firmar override"
        icon="pi pi-check"
        severity="warning"
        onClick={handleSubmit}
        disabled={!puedeFirmar}
        loading={enviando}
      />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header="Override de pastón aprobado"
      footer={footer}
      style={{ width: '90vw', maxWidth: '640px' }}
      modal
      dismissableMask={!enviando}
    >
      <Message
        severity="warn"
        text={
          motivoError ||
          'No hay un pastón con veredicto APROBADO. Para pasar a producción sin pastón, un firmante autorizado debe declarar un motivo. Quedará registrado en el historial de auditoría.'
        }
        style={{ width: '100%' }}
      />

      {errorCarga && (
        <Message severity="error" text={errorCarga} style={{ width: '100%', marginTop: '0.75rem' }} />
      )}

      <div className="mt-3 mb-2">
        <label className="text-sm font-bold block mb-2">Firmante</label>
        <Dropdown
          value={firmanteId}
          options={dropdownOptions}
          onChange={(e) => setFirmanteId(e.value)}
          placeholder={cargandoFirmantes ? 'Cargando firmantes...' : 'Seleccionar firmante'}
          disabled={cargandoFirmantes || enviando}
          className="w-full"
          filter
          showClear
        />
        <small className="block mt-1" style={{ color: 'var(--text-color-secondary)' }}>
          El firmante debe tener rol Responsable de Calidad, Director Técnico o Admin.
          Si en tu organización hay un Director Técnico distinto a vos, conviene que firme él.
        </small>
      </div>

      {firmaConcentrada && (
        <div className="mb-3 p-3 border-round" style={{ background: 'var(--yellow-50, #fefce8)', border: '1px solid var(--yellow-200, #fde68a)' }}>
          <div className="flex align-items-start gap-2 mb-2">
            <i className="fa-solid fa-circle-exclamation mt-1" style={{ color: 'var(--yellow-700, #a16207)' }} />
            <strong style={{ color: 'var(--yellow-900, #713f12)' }}>Firma concentrada</strong>
          </div>
          <p className="text-sm m-0 mb-2" style={{ color: 'var(--yellow-900, #713f12)' }}>
            Estás firmando el override sobre una transición que vos mismo aprobaste o iniciaste.
            Esto se permite para empresas chicas donde una sola persona cubre el ciclo, pero quedará
            registrado como concentración de responsabilidad en la auditoría.
          </p>
          <div className="flex align-items-start gap-2">
            <Checkbox
              inputId="acepta-firma-propia"
              checked={aceptaFirmaPropia}
              onChange={(e) => setAceptaFirmaPropia(e.checked)}
              disabled={enviando}
            />
            <label htmlFor="acepta-firma-propia" className="text-sm" style={{ cursor: 'pointer' }}>
              Confirmo que asumo la responsabilidad técnica al no haber otro firmante disponible.
            </label>
          </div>
        </div>
      )}

      <div className="mb-2">
        <label className="text-sm font-bold block mb-1">
          Motivo del override <span style={{ color: 'var(--text-color-secondary)' }}>(mínimo {MOTIVO_MIN} caracteres)</span>
        </label>
        <InputTextarea
          value={motivo}
          onChange={(e) => setMotivo(e.target.value.slice(0, MOTIVO_MAX))}
          rows={4}
          className="w-full"
          placeholder="Ej: Versión derivada de DOS-XXX.v3 con cambio menor de metadata; las dosis y proporciones no cambiaron y no requieren validación experimental adicional."
          disabled={enviando}
        />
        <small
          className="block mt-1"
          style={{ color: motivoLen < MOTIVO_MIN ? 'var(--red-600, #dc2626)' : 'var(--text-color-secondary)' }}
        >
          {motivoLen} / {MOTIVO_MAX} caracteres {motivoLen < MOTIVO_MIN ? `(faltan ${MOTIVO_MIN - motivoLen})` : ''}
        </small>
      </div>

      {errorEnvio && (
        <Message severity="error" text={errorEnvio} style={{ width: '100%', marginTop: '0.5rem' }} />
      )}

      <p className="text-xs m-0 mt-3" style={{ color: 'var(--text-color-secondary)' }}>
        El override se incluye en el hash de integridad de la dosificación y en el evento
        <code> override_paston </code> del historial. Cualquier modificación posterior invalida el hash.
      </p>
    </Dialog>
  );
}
