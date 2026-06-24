import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputText } from 'primereact/inputtext';
import { Checkbox } from 'primereact/checkbox';
import { SelectButton } from 'primereact/selectbutton';

const LS_KEY = 'hormiqual_pdf_export_prefs';

const ORDEN_OPTIONS = [
  { label: 'Orden actual', value: 'actual' },
  { label: 'Automático', value: 'auto' },
];

function loadPrefs() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}

function savePrefs(p) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(p)); } catch { /* ignore */ }
}

/**
 * Pre-export modal for PDF informe de mezcla.
 *
 * @param {Object}   props
 * @param {boolean}  props.visible
 * @param {Function} props.onHide
 * @param {Function} props.onConfirm  — called with { titulo, includeAnexo, includeGlosario, ordenAgregados }
 * @param {string}   props.defaultTitulo — default title for the PDF
 * @param {boolean}  props.hasTrazabilidad — whether trazabilidad data is available
 */
export default function PdfExportDialog({ visible, onHide, onConfirm, defaultTitulo = '', hasTrazabilidad = false }) {
  const [titulo, setTitulo] = useState('');
  const [includeAnexo, setIncludeAnexo] = useState(false);
  const [includeGlosario, setIncludeGlosario] = useState(true);
  const [ordenAgregados, setOrdenAgregados] = useState('actual');

  useEffect(() => {
    if (visible) {
      const prefs = loadPrefs();
      setTitulo(defaultTitulo || '');
      setIncludeAnexo(prefs.includeAnexo ?? false);
      setIncludeGlosario(prefs.includeGlosario ?? true);
      setOrdenAgregados(prefs.ordenAgregados ?? 'actual');
    }
  }, [visible, defaultTitulo]);

  const handleConfirm = () => {
    const prefs = { includeAnexo, includeGlosario, ordenAgregados };
    savePrefs(prefs);
    onConfirm({ titulo: titulo.trim() || null, includeAnexo, includeGlosario, ordenAgregados });
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="fa-solid fa-xmark" className="p-button-text p-button-sm" onClick={onHide} />
      <Button label="Generar PDF" icon="fa-solid fa-file-pdf" className="p-button-sm" onClick={handleConfirm} />
    </div>
  );

  return (
    <Dialog
      header="Exportar informe PDF"
      visible={visible}
      onHide={onHide}
      footer={footer}
      style={{ width: '90vw', maxWidth: '28rem' }}
      modal
      draggable={false}
    >
      <div className="flex flex-column gap-3">
        {/* Título */}
        <div className="flex flex-column gap-1">
          <label htmlFor="pdf-titulo" className="font-semibold text-sm">Título del informe</label>
          <InputText
            id="pdf-titulo"
            value={titulo}
            onChange={e => setTitulo(e.target.value)}
            placeholder="Dejar vacío para título automático"
            className="p-inputtext-sm"
          />
        </div>

        {/* Incluir anexo */}
        {hasTrazabilidad && (
          <div className="flex align-items-center gap-2">
            <Checkbox
              inputId="pdf-anexo"
              checked={includeAnexo}
              onChange={e => setIncludeAnexo(e.checked)}
            />
            <label htmlFor="pdf-anexo" className="text-sm">
              Incluir Anexo A — Trazabilidad del cálculo
            </label>
          </div>
        )}

        {/* Incluir glosario */}
        <div className="flex align-items-center gap-2">
          <Checkbox
            inputId="pdf-glosario"
            checked={includeGlosario}
            onChange={e => setIncludeGlosario(e.checked)}
          />
          <label htmlFor="pdf-glosario" className="text-sm">Incluir glosario de términos</label>
        </div>

        {/* Orden de agregados */}
        <div className="flex flex-column gap-1">
          <label className="font-semibold text-sm">Orden de agregados</label>
          <SelectButton
            value={ordenAgregados}
            onChange={e => setOrdenAgregados(e.value)}
            options={ORDEN_OPTIONS}
            className="p-selectbutton-sm"
          />
          <small className="text-color-secondary">
            {ordenAgregados === 'auto'
              ? 'Finos primero, luego gruesos; por porcentaje descendente'
              : 'Respeta el orden definido en el diseño'}
          </small>
        </div>
      </div>
    </Dialog>
  );
}
