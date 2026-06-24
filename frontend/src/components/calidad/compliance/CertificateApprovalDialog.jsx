import React, { useEffect, useState, useRef } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputTextarea } from 'primereact/inputtextarea';
import { Message } from 'primereact/message';
import { crearAprobacion } from '../../../services/documentApprovalRequestService';

/**
 * Dialog de solicitud de firma de certificado (Fase 2 RBAC).
 *
 * Se abre cuando `CertificateIssuancePolicy.canIssue` devuelve
 * REQUIRES_APPROVAL. El operador escribe el motivo del pedido y el sistema
 * crea un DocumentApprovalRequest en estado PENDIENTE. Luego el Director
 * Técnico lo ve en el panel de pendientes y resuelve.
 *
 * Props:
 *   - visible: bool
 *   - onHide: () => void
 *   - onSolicitado: (row) => void  // se invoca tras crear con éxito
 *   - approvalContext: snapshot del issuance (decision + ensayos + metadata)
 *   - tipoDocumento: 'CERTIFICADO' | 'INFORME_EVALUACION' | 'CERTIFICADO_DOSIFICACION'
 *   - idMaterial / idDosificacionDisenada
 *   - razon: motivo emitido por la policy (alta resistencia, política tenant)
 */

export default function CertificateApprovalDialog({
  visible, onHide, onSolicitado,
  approvalContext, tipoDocumento, idMaterial, idDosificacionDisenada, razon,
}) {
  const [motivo, setMotivo] = useState('');
  const [enviando, setEnviando] = useState(false);
  const enviandoRef = useRef(false);
  const [errorMsg, setErrorMsg] = useState(null);

  useEffect(() => {
    if (visible) {
      setMotivo('');
      setErrorMsg(null);
      setEnviando(false);
    }
  }, [visible]);

  const puedeEnviar = !enviando && (!!idMaterial || !!idDosificacionDisenada) && !!approvalContext;

  const handleSubmit = async () => {
    if (enviandoRef.current) return;
    enviandoRef.current = true;
    setEnviando(true);
    setErrorMsg(null);
    try {
      const row = await crearAprobacion({
        tipoDocumento,
        idMaterial: idMaterial || null,
        idDosificacionDisenada: idDosificacionDisenada || null,
        contextoJson: approvalContext,
        motivoSolicitud: motivo.trim() || null,
      });
      if (typeof onSolicitado === 'function') onSolicitado(row);
      onHide();
    } catch (err) {
      const data = err.response?.data;
      setErrorMsg(data?.error || data?.message || err.message || 'No se pudo solicitar la firma.');
    } finally {
      enviandoRef.current = false;
      setEnviando(false);
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="pi pi-times" outlined onClick={onHide} disabled={enviando} />
      <Button
        label="Enviar a firma del Director Técnico"
        icon="pi pi-paper-plane"
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
      header="Solicitar firma del certificado"
      footer={footer}
      style={{ width: 620 }}
      modal
      dismissableMask={!enviando}
    >
      <Message
        severity="warn"
        text={razon || 'La emisión de este certificado requiere firma del Director Técnico antes de descargarse.'}
        style={{ width: '100%' }}
      />

      <p className="text-sm mt-3 mb-2">
        <strong>Nota para el firmante</strong>{' '}
        <span className="text-color-secondary">(opcional)</span>
      </p>
      <InputTextarea
        value={motivo}
        onChange={(e) => setMotivo(e.target.value)}
        rows={3}
        className="w-full"
        placeholder="Contexto del pedido: obra, cliente, urgencia, etc."
      />

      <p className="text-xs text-color-secondary mt-3 mb-0">
        Al enviar, queda registrado un pedido de firma en el log auditable. El Director Técnico
        lo verá en su panel de pendientes y podrá aprobarlo o rechazarlo. Hasta que se apruebe,
        el PDF del certificado no se genera.
      </p>

      {errorMsg && (
        <Message severity="error" text={errorMsg} style={{ width: '100%', marginTop: '0.75rem' }} />
      )}
    </Dialog>
  );
}
