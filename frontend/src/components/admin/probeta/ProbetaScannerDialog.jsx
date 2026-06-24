import React, { useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import QrScanner from '../../../common/components/QrScanner/QrScanner';
import { useToast } from '../../../context/ToastContext';
import { extractProbetaRefFromScan } from '../../../lib/probetaCodigo';

/**
 * Scanner de QR de probetas (sesión 2026-06-02).
 *
 * Abre la cámara del dispositivo, lee el QR de la etiqueta (que codifica
 * `…/p/PRB-AAAA-NNNNNN`) y navega a `/p/{ref}`, reusando el smart-redirect de
 * `ProbetaQrRedirect`: para un usuario operativo y probeta ensayable, abre
 * directo la pantalla de carga del ensayo.
 *
 * Pensado para el operario en pileta el día de la rotura: en vez de usar la
 * cámara nativa del teléfono, escanea desde la propia app (Calidad → Ensayos
 * → Probetas) y queda en sesión.
 *
 * Requiere HTTPS (o localhost) para acceder a la cámara — limitación del
 * navegador (getUserMedia).
 *
 * Delega la cámara en el componente común `QrScanner`, que difiere la
 * instanciación de `Html5Qrcode` hasta que el div del modal existe en el DOM
 * (fix 2026-06-22): la versión previa construía el scanner sincrónicamente al
 * abrir el diálogo, antes de que el portal de PrimeReact montara el contenedor,
 * y el constructor tiraba "HTML Element ... not found" fuera del `.catch()` del
 * `.start()`, dejando la cámara muerta sin aviso al usuario.
 */
export default function ProbetaScannerDialog({ visible, onHide }) {
  const navigate = useNavigate();
  const toast = useToast();

  const handleScan = useCallback((decodedText) => {
    onHide();
    const ref = extractProbetaRefFromScan(decodedText);
    if (ref) {
      navigate(`/p/${encodeURIComponent(ref)}`);
    } else {
      toast('warn', 'El código escaneado no corresponde a una probeta.');
    }
  }, [navigate, onHide, toast]);

  return (
    <QrScanner
      visible={visible}
      onClose={onHide}
      onScan={handleScan}
      title="Escanear QR de probeta"
    />
  );
}
