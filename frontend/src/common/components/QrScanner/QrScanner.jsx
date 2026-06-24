/**
 * N-01 (auditoría 08, Bloque 22) — Scanner de QR interno con cámara web.
 *
 * Razón de existir: el scanner genérico del teléfono Android/iOS abre el QR
 * como URL en el navegador del sistema, pero a veces falla por permisos,
 * dominios bloqueados, o porque el sistema no asocia bien el subdominio del
 * tenant. Con un scanner integrado en la app:
 *  - El permiso de cámara lo otorga el operario una sola vez al PWA.
 *  - El QR se interpreta dentro de la app; si la URL apunta al mismo origen
 *    (es lo que hacemos en Bloque 22), la navegación es interna y rápida.
 *
 * Uso:
 *   <QrScanner visible={open} onClose={...} onScan={(text) => navigate(...)} />
 *
 * El callback `onScan(text)` recibe el contenido textual del QR. Si es una
 * URL del mismo origen, el caller la transforma en `navigate(pathname)`. Si
 * es una URL externa, abrir en pestaña nueva.
 *
 * Lib: `html5-qrcode` (estable, mantenida, ~70KB gzip).
 */

import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';

const SCANNER_DOM_ID = 'hormiqual-qr-scanner';

export default function QrScanner({ visible, onClose, onScan, title = 'Escanear etiqueta QR' }) {
  const scannerRef = useRef(null);
  const [error, setError] = useState(null);
  const [running, setRunning] = useState(false);

  useEffect(() => {
    if (!visible) return;
    let cancelled = false;
    const start = async () => {
      try {
        setError(null);
        // Pequeño delay para que el div del modal exista en el DOM antes
        // de que html5-qrcode intente leerlo.
        await new Promise((r) => setTimeout(r, 100));
        if (cancelled) return;
        const scanner = new Html5Qrcode(SCANNER_DOM_ID);
        scannerRef.current = scanner;

        // Preferimos cámara trasera (environment). Algunos dispositivos no la
        // exponen como facingMode constraint; pasamos {facingMode:'environment'}
        // o caemos a deviceId del primer device disponible.
        const config = {
          fps: 10,
          qrbox: (vw, vh) => {
            const minDim = Math.min(vw, vh);
            const size = Math.floor(minDim * 0.7);
            return { width: size, height: size };
          },
        };

        await scanner.start(
          { facingMode: 'environment' },
          config,
          (decodedText) => {
            // Match. Detener el scanner y pasarle al caller.
            scanner.stop().catch(() => {});
            onScan?.(decodedText);
          },
          (_errMsg) => { /* errores de frame: silenciosos, son normales */ }
        );
        if (cancelled) {
          await scanner.stop().catch(() => {});
          return;
        }
        setRunning(true);
      } catch (err) {
        console.error('[QrScanner] error iniciando cámara:', err);
        setError(
          err?.name === 'NotAllowedError'
            ? 'Permiso de cámara denegado. Otorgalo desde la configuración del navegador.'
            : (err?.message || 'No se pudo iniciar la cámara.')
        );
      }
    };
    start();
    return () => {
      cancelled = true;
      const s = scannerRef.current;
      if (s) {
        s.stop().catch(() => {}).finally(() => { scannerRef.current = null; setRunning(false); });
      }
    };
  }, [visible, onScan]);

  return (
    <Dialog
      visible={visible}
      onHide={onClose}
      header={(
        <div className="flex align-items-center gap-2">
          <i className="fa-solid fa-qrcode" />
          <span>{title}</span>
        </div>
      )}
      style={{ width: '90vw', maxWidth: '500px' }}
      dismissableMask
      footer={(
        <div className="flex justify-content-end">
          <Button label="Cerrar" icon="fa-solid fa-xmark" onClick={onClose} outlined severity="secondary" />
        </div>
      )}
    >
      <div className="flex flex-column gap-2">
        <small className="text-500">
          Apuntá la cámara a la etiqueta de la probeta. Cuando reconozca el QR,
          se abrirá automáticamente el detalle.
        </small>
        {error && (
          <div className="p-3" style={{ background: 'var(--red-50)', borderRadius: 6 }}>
            <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--red-500)' }} />
            <span>{error}</span>
          </div>
        )}
        <div
          id={SCANNER_DOM_ID}
          style={{
            width: '100%',
            minHeight: '300px',
            background: '#000',
            borderRadius: 6,
            overflow: 'hidden',
          }}
        />
        {!running && !error && (
          <small className="text-500 text-center">Pidiendo permiso de cámara…</small>
        )}
      </div>
    </Dialog>
  );
}
