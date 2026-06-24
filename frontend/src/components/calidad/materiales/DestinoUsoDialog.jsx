import React, { useState, useEffect } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { InputSwitch } from 'primereact/inputswitch';
import { Dropdown } from 'primereact/dropdown';
import { InputNumber } from 'primereact/inputnumber';

/**
 * Diálogo para capturar el contexto de uso bajo el cual se emite un certificado
 * o informe de evaluación de un agregado (P1.5 / P1.9).
 *
 * El contexto determina qué límites normativos aplican y qué ensayos son
 * obligatorios. Se ofrece "sin contexto específico" como salida válida — en
 * ese caso el documento usa criterios estándar y deja constancia explícita.
 */

const CLASES_EXPOSICION = [
  { label: 'A1 — interior protegido', value: 'A1' },
  { label: 'A2 — interior con humedad', value: 'A2' },
  { label: 'CL — exterior templado', value: 'CL' },
  { label: 'C1 — exterior con humedad', value: 'C1' },
  { label: 'C2 — exterior con ciclos hielo/deshielo', value: 'C2' },
  { label: 'M1 — abrasión moderada', value: 'M1' },
  { label: 'M2 — abrasión severa', value: 'M2' },
  { label: 'Q1 — agresividad química leve', value: 'Q1' },
  { label: 'Q2 — agresividad química moderada', value: 'Q2' },
  { label: 'Q3 — agresividad química fuerte', value: 'Q3' },
];

export default function DestinoUsoDialog({ visible, onHide, onConfirm }) {
  const [especificar, setEspecificar] = useState(false);
  const [expuestoDesgaste, setExpuestoDesgaste] = useState(false);
  const [claseExposicion, setClaseExposicion] = useState(null);
  const [fceMpa, setFceMpa] = useState(null);

  useEffect(() => {
    if (visible) {
      setEspecificar(false);
      setExpuestoDesgaste(false);
      setClaseExposicion(null);
      setFceMpa(null);
    }
  }, [visible]);

  const handleConfirm = () => {
    if (!especificar) {
      onConfirm({});
    } else {
      onConfirm({
        expuestoDesgaste,
        claseExposicion,
        fceMpa,
      });
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="fa-solid fa-xmark" outlined onClick={onHide} />
      <Button label="Emitir documento" icon="fa-solid fa-file-export" onClick={handleConfirm} severity="success" />
    </div>
  );

  return (
    <Dialog
      visible={visible}
      onHide={onHide}
      header="Contexto de uso del material"
      footer={footer}
      style={{ width: 540 }}
      modal
    >
      <p className="text-sm text-color-secondary mb-3">
        El cumplimiento normativo depende del destino del agregado. Especificar el contexto
        permite validar requisitos adicionales (Los Ángeles si hay desgaste, durabilidad
        sulfato si hay ataque químico, petrográfico para H ≥ 35, etc).
      </p>

      <div className="flex align-items-center gap-2 mb-3 surface-100 border-round p-3">
        <InputSwitch checked={especificar} onChange={(e) => setEspecificar(e.value)} />
        <div className="flex-1">
          <strong>Especificar contexto de uso</strong>
          <div className="text-xs text-color-secondary">
            Si se desactiva, el documento aclara que se usaron criterios estándar sin destino específico.
          </div>
        </div>
      </div>

      {especificar && (
        <div className="flex flex-column gap-3">
          <div className="flex align-items-center gap-3">
            <InputSwitch checked={expuestoDesgaste} onChange={(e) => setExpuestoDesgaste(e.value)} />
            <div className="flex-1">
              <strong>Expuesto a desgaste superficial</strong>
              <div className="text-xs text-color-secondary">
                Pavimentos, pisos industriales, piletas. Aplica límites estrictos (suma nocivas ≤ 5%, Los Ángeles obligatorio en grueso).
              </div>
            </div>
          </div>

          <div>
            <label className="block mb-1 font-bold text-sm">Clase de exposición (CIRSOC 200:2024)</label>
            <Dropdown
              value={claseExposicion}
              options={CLASES_EXPOSICION}
              onChange={(e) => setClaseExposicion(e.value)}
              placeholder="Seleccionar clase…"
              showClear
              className="w-full"
            />
            <small className="text-color-secondary">
              Q1/Q2/Q3 exigen ensayo de durabilidad por sulfatos (IRAM 1525).
            </small>
          </div>

          <div>
            <label className="block mb-1 font-bold text-sm">Resistencia característica máx. (f'c)</label>
            <InputNumber
              value={fceMpa}
              onValueChange={(e) => setFceMpa(e.value)}
              suffix=" MPa"
              min={5}
              max={80}
              showButtons
              step={5}
              className="w-full"
            />
            <small className="text-color-secondary">
              f'c ≥ 35 MPa exige examen petrográfico (IRAM 1649).
            </small>
          </div>
        </div>
      )}
    </Dialog>
  );
}
