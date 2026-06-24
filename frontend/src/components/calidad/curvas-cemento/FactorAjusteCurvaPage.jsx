import React, { useState, useEffect, useCallback, useRef } from 'react';
import { InputNumber } from 'primereact/inputnumber';
import { Button } from 'primereact/button';
import { Message } from 'primereact/message';
import { ProgressSpinner } from 'primereact/progressspinner';
import { useToast } from '../../../context/ToastContext';
import { getFactorAjusteFamilia, updateFactorAjusteFamilia } from '../../../services/dosificacionDisenoService';
import PageHeader from '../../../common/components/PageHeader/PageHeader';

const FAMILIAS = [
  { codigo: 'CP30', label: 'CP30', desc: 'Cementos de baja resistencia (30 MPa a 28 días)' },
  { codigo: 'CP40', label: 'CP40', desc: 'Cementos de resistencia media (40 MPa a 28 días)' },
  { codigo: 'CP50', label: 'CP50', desc: 'Cementos de alta resistencia (50 MPa a 28 días)' },
];

export default function FactorAjusteCurvaPage() {
  const showToast = useToast();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState({});
  const savingRef = useRef({});
  const [factores, setFactores] = useState({});

  const cargar = useCallback(async () => {
    setLoading(true);
    try {
      const results = await Promise.all(
        FAMILIAS.map(f => getFactorAjusteFamilia(f.codigo).catch(() => ({ factorAjuste: 1.0 })))
      );
      const map = {};
      FAMILIAS.forEach((f, i) => { map[f.codigo] = Number(results[i].factorAjuste) || 1.0; });
      setFactores(map);
    } catch (e) {
      showToast('error', 'Error cargando factores de ajuste');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => { cargar(); }, [cargar]);

  const guardar = async (familia) => {
    if (savingRef.current[familia]) return;
    savingRef.current[familia] = true;
    setSaving(prev => ({ ...prev, [familia]: true }));
    try {
      await updateFactorAjusteFamilia(familia, factores[familia]);
      showToast('success', `Factor ${familia} actualizado a ${factores[familia].toFixed(2)}`);
    } catch (e) {
      showToast('error', e.response?.data?.error || 'Error al guardar');
    } finally {
      savingRef.current[familia] = false;
      setSaving(prev => ({ ...prev, [familia]: false }));
    }
  };

  if (loading) return <div className="flex justify-content-center p-6"><ProgressSpinner /></div>;

  return (
    <div className="p-4">
      <PageHeader
        icon="fa-solid fa-sliders"
        title="Factor de ajuste — curva de referencia general"
        subtitle="Corrección sobre las curvas estándar a/c-resistencia por familia de cemento."
      />

      <Message
        severity="warn"
        className="mb-4 w-full"
        text="Esta página queda en modo histórico: el factor de ajuste ahora se configura por cemento y por planta desde el catálogo de Cementos. Los valores cargados aquí no se aplican al motor de dosificación."
      />
      <Message
        severity="info"
        className="mb-4 w-full"
        text="El factor de ajuste modifica la resistencia de búsqueda en la curva de referencia general. Un factor > 1.00 indica que los cementos de esa familia rinden más que la curva estándar (menor consumo de cemento). Un factor < 1.00 indica lo contrario."
      />

      <div className="grid">
        {FAMILIAS.map(f => {
          const val = factores[f.codigo] ?? 1.0;
          const changed = Math.abs(val - 1.0) > 0.005;
          return (
            <div key={f.codigo} className="col-12 md:col-4">
              <div className="surface-card border-round p-4 shadow-1 h-full">
                <div className="flex align-items-center gap-2 mb-2">
                  <span className="font-bold text-lg">{f.label}</span>
                  {changed && <span className="text-xs border-round px-2 py-1" style={{ background: 'rgba(245,158,11,0.2)', color: 'var(--yellow-500)' }}>Ajustado</span>}
                </div>
                <small className="text-color-secondary block mb-3">{f.desc}</small>

                <div className="flex align-items-end gap-2 mb-2">
                  <div className="flex flex-column flex-grow-1">
                    <small className="font-bold mb-1">Factor de ajuste</small>
                    <InputNumber
                      value={val}
                      onValueChange={(e) => setFactores(prev => ({ ...prev, [f.codigo]: e.value }))}
                      min={0.50} max={2.00} step={0.01}
                      minFractionDigits={2} maxFractionDigits={2}
                      className="w-full"
                    />
                  </div>
                  <Button
                    icon="fa-solid fa-check"
                    severity="success"
                    size="small"
                    loading={saving[f.codigo]}
                    disabled={saving[f.codigo]}
                    onClick={() => guardar(f.codigo)}
                    tooltip="Guardar"
                  />
                </div>

                <div className="text-xs text-color-secondary">
                  {val > 1.005
                    ? <span style={{ color: 'var(--green-400)' }}>
                        <i className="fa-solid fa-arrow-up mr-1" />
                        Cemento rinde {((val - 1) * 100).toFixed(0)}% más que la curva estándar
                      </span>
                    : val < 0.995
                      ? <span style={{ color: 'var(--red-400)' }}>
                          <i className="fa-solid fa-arrow-down mr-1" />
                          Cemento rinde {((1 - val) * 100).toFixed(0)}% menos que la curva estándar
                        </span>
                      : <span>Sin ajuste (curva de referencia estándar)</span>
                  }
                </div>

                {changed && (
                  <div className="mt-2 text-xs">
                    <i className="fa-solid fa-info-circle mr-1 text-primary" />
                    Efecto: f'cm se divide por {val.toFixed(2)} antes de buscar a/c en la curva.
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <div className="mt-4 p-3 surface-ground border-round text-sm">
        <strong><i className="fa-solid fa-book mr-2" />Referencia</strong>
        <p className="mt-2 mb-0 text-color-secondary">
          Las curvas de referencia general relacionan resistencia media (f'cm) con relación a/c para cada familia de cemento (CP30, CP40, CP50).
          Estas curvas fueron calibradas con datos históricos y pueden no reflejar el rendimiento actual de los cementos del mercado.
          El factor de ajuste permite corregir esta diferencia sin modificar los datos originales de la curva.
        </p>
        <p className="mt-2 mb-0 text-color-secondary">
          El factor se aplica automáticamente al calcular dosificaciones con el modo de curva "Referencia general".
          Queda registrado en la trazabilidad del informe técnico.
        </p>
      </div>
    </div>
  );
}
