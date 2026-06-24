/**
 * MotivoDialog — modal genérico para capturar un motivo de texto antes
 * de ejecutar una acción auditada.
 *
 * Usado por (auditoría 08, sesión 2026-05-08 parte 5):
 *  - Mej-16: anular probeta.
 *  - Mej-17: desaprobar ensayo.
 *  - C-SEC-04: aprobar ensayo con cambios respecto al original.
 *
 * Props:
 *  - visible: boolean
 *  - onHide: () => void
 *  - onConfirm: (motivo: string) => Promise<void> | void
 *  - title: string (header del dialog, ej. "Anular probeta")
 *  - icon: string (font-awesome class, ej. 'fa-solid fa-ban')
 *  - severity: 'danger' | 'warning' | 'info' (default 'danger')
 *  - confirmLabel: string (ej. 'Anular')
 *  - mensaje: ReactNode (opcional, descripción contextual)
 *  - extraInfo: ReactNode (opcional, ej. lista de campos cambiados)
 *  - minChars: number (default 5, debe coincidir con el backend)
 */

import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';

const SEVERITY_BG = {
  danger:  { color: 'var(--red-500)', bg: 'var(--red-50)' },
  warning: { color: 'var(--orange-500)', bg: 'var(--orange-50)' },
  info:    { color: 'var(--blue-500)', bg: 'var(--blue-50)' },
};

export default function MotivoDialog({
  visible,
  onHide,
  onConfirm,
  title,
  icon = 'fa-solid fa-pencil',
  severity = 'danger',
  confirmLabel = 'Confirmar',
  mensaje = null,
  extraInfo = null,
  minChars = 5,
}) {
  const [motivo, setMotivo] = useState('');
  const [saving, setSaving] = useState(false);

  // Reset al abrir/cerrar.
  useEffect(() => {
    if (!visible) setMotivo('');
  }, [visible]);

  const sev = SEVERITY_BG[severity] || SEVERITY_BG.danger;
  const trimmed = motivo.trim();
  const valido = trimmed.length >= minChars;

  const handleConfirm = async () => {
    if (!valido) return;
    setSaving(true);
    try {
      await onConfirm(trimmed);
      onHide();
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header={(
        <div className="flex align-items-center gap-2">
          <i className={icon} style={{ color: sev.color }} />
          <span>{title}</span>
        </div>
      )}
      style={{ width: '90vw', maxWidth: '550px' }}
      dismissableMask
      draggable={false}
      footer={(
        <div className="flex gap-2 justify-content-end">
          <Button
            label="Cancelar"
            icon="fa-solid fa-xmark"
            onClick={onHide}
            outlined
            severity="secondary"
            disabled={saving}
          />
          <Button
            label={confirmLabel}
            icon={icon}
            onClick={handleConfirm}
            severity={severity}
            disabled={!valido || saving}
            loading={saving}
          />
        </div>
      )}
    >
      <div className="flex flex-column gap-3">
        {mensaje && (
          <div style={{ background: sev.bg, padding: '0.75rem', borderRadius: 6 }}>
            {mensaje}
          </div>
        )}
        {extraInfo && (
          <div className="text-500" style={{ fontSize: '0.85rem' }}>{extraInfo}</div>
        )}
        <div>
          <label htmlFor="motivo" className="block mb-2 font-semibold">
            Motivo <span style={{ color: 'var(--red-500)' }}>*</span>
          </label>
          <InputTextarea
            id="motivo"
            value={motivo}
            onChange={(e) => setMotivo(e.target.value)}
            rows={4}
            autoFocus
            className={`w-full${motivo.length > 0 && !valido ? ' p-invalid' : ''}`}
            placeholder={`Mínimo ${minChars} caracteres. Quedará registrado para auditoría.`}
          />
          <small className="text-500 block mt-1">
            {trimmed.length}/{minChars} mínimos · queda registrado con tu nombre y fecha.
          </small>
        </div>
      </div>
    </Dialog>
  );
}
