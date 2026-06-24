import React, { useMemo, useState, useRef } from "react";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { guardarPrediccionFresco } from "../../../services/dosificacionDisenoService";

/**
 * Panel de "Predicción de comportamiento fresco esperado" (V1 heurística).
 *
 * Recibe la predicción ya calculada (viene con el resultado del backend o se
 * lee desde persistencia). Muestra los 7 índices con su clase y score, la
 * interpretación textual, riesgos y recomendaciones. El nivel de confianza
 * siempre es visible.
 *
 * Props:
 *   - prediccion: objeto devuelto por el motor (puede venir de resultado.prediccionFresco
 *     o de /prediccion-fresco). Si es null, el panel muestra un estado vacío.
 *   - dosificacionId: opcional, si está presente y hay predicción calculada,
 *     se habilita el botón "Guardar predicción" para persistirla.
 *   - onPersisted: callback opcional tras guardar.
 *   - showToast: helper de feedback.
 */

const LABELS_CLASE = {
  MUY_SECA: 'Muy seca', SECA: 'Seca', PLASTICA: 'Plástica',
  MUY_PLASTICA: 'Muy plástica', FLUIDA: 'Fluida', MUY_FLUIDA: 'Muy fluida',
  BAJA: 'Baja', MEDIA_BAJA: 'Media-baja', MEDIA: 'Media',
  MEDIA_ALTA: 'Media-alta', ALTA: 'Alta',
  INESTABLE: 'Inestable', SENSIBLE: 'Sensible',
  MODERADAMENTE_ESTABLE: 'Moderadamente estable', ESTABLE: 'Estable',
  BAJO: 'Bajo', MEDIO: 'Medio', ALTO: 'Alto',
  NO_RECOMENDABLE: 'No recomendable', CONDICIONADA: 'Condicionada',
  RAZONABLE: 'Razonable', BUENA: 'Buena', MUY_BUENA: 'Muy buena',
  ASPERA: 'Áspera', ACEPTABLE: 'Aceptable',
  MUY_SENSIBLE: 'Muy sensible',
  MEDIANAMENTE_ROBUSTA: 'Medianamente robusta', ROBUSTA: 'Robusta',
};
const label = (c) => LABELS_CLASE[c] || c || '—';

// Severidades de PrimeReact para colorear los tags según la clase.
// Se asignan semánticamente: bueno → success, medio → warning, malo → danger.
const SEVERITY_INDEX = {
  // Mejor a peor — se usa el índice score [0..1] para pintar
  bueno: 'success',
  medio: 'warning',
  malo: 'danger',
  neutral: 'info',
};

/** Elige severidad según score y si el índice es "directo" o "inverso". */
function severityForScore(score, invertido = false) {
  if (score == null) return 'info';
  const v = invertido ? 1 - score : score;
  if (v >= 0.65) return SEVERITY_INDEX.bueno;
  if (v >= 0.40) return SEVERITY_INDEX.medio;
  return SEVERITY_INDEX.malo;
}

const pct = (s) => s == null ? '—' : `${Math.round(Number(s) * 100)}%`;

function IndiceCard({ titulo, score, clase, invertido = false, descripcion }) {
  const sev = severityForScore(score, invertido);
  return (
    <div className="surface-card p-3 border-round border-1 border-200 h-full">
      <div className="flex align-items-start justify-content-between gap-2 mb-1">
        <div>
          <div className="text-xs text-color-secondary">{titulo}</div>
          <div className="text-sm font-bold mt-1">{label(clase)}</div>
        </div>
        <Tag value={pct(score)} severity={sev} className="text-xs" />
      </div>
      {descripcion && (
        <div className="text-xs text-color-secondary mt-1" style={{ lineHeight: 1.3 }}>
          {descripcion}
        </div>
      )}
    </div>
  );
}

export default function PrediccionFrescoPanel({ prediccion, dosificacionId, onPersisted, showToast }) {
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Cards ordenadas por relevancia técnica
  const cards = useMemo(() => {
    if (!prediccion?.indices) return [];
    const ix = prediccion.indices;
    return [
      { key: 'fluidez',        titulo: 'Fluidez esperada',         ind: ix.fluidez,        invertido: false, descripcion: 'Facilidad de deformación según asentamiento, a/c, pasta y aditivo.' },
      { key: 'cohesion',       titulo: 'Cohesión esperada',        ind: ix.cohesion,       invertido: false, descripcion: 'Capacidad de la mezcla de mantenerse armada.' },
      { key: 'estabilidad',    titulo: 'Estabilidad',              ind: ix.estabilidad,    invertido: false, descripcion: 'Tendencia inversa a segregar en transporte/descarga.' },
      { key: 'exudacion',      titulo: 'Riesgo de exudación',      ind: ix.exudacion,      invertido: true,  descripcion: 'Tendencia a liberar agua libre tras colado.' },
      { key: 'bombeabilidad',  titulo: 'Bombeabilidad',            ind: ix.bombeabilidad,  invertido: false, descripcion: 'Aptitud estimada para transporte por bomba.' },
      { key: 'terminabilidad', titulo: 'Terminabilidad',           ind: ix.terminabilidad, invertido: false, descripcion: 'Calidad de acabado esperada.' },
      { key: 'robustez',       titulo: 'Robustez operativa',       ind: ix.robustez,       invertido: false, descripcion: 'Resistencia a pequeñas variaciones (humedad, finos, aditivo).' },
    ].filter(c => c.ind);
  }, [prediccion]);

  if (!prediccion || !prediccion.indices) {
    return (
      <div className="surface-card border-round p-3 text-center text-color-secondary text-sm">
        <i className="fa-solid fa-wave-square mr-2" />
        Sin predicción disponible. Se calcula automáticamente al dosificar.
      </div>
    );
  }

  const conf = prediccion.nivelConfianza || {};
  const confSev = conf.clase === 'ALTO' ? 'success' : conf.clase === 'MEDIO' ? 'warning' : 'danger';

  const handleSave = async () => {
    if (savingRef.current) return;
    if (!dosificacionId) return;
    try {
      savingRef.current = true;
      setSaving(true);
      await guardarPrediccionFresco(dosificacionId, prediccion);
      showToast?.('success', 'Predicción guardada.');
      onPersisted?.();
    } catch (err) {
      showToast?.('error', err?.response?.data?.error || 'No se pudo guardar la predicción');
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  return (
    <div className="flex flex-column gap-3">
      {/* Header: confianza + acción */}
      <div className="flex justify-content-between align-items-center flex-wrap gap-2">
        <div className="flex align-items-center gap-2">
          <Tag value={`Confianza del modelo: ${label(conf.clase)}`} severity={confSev} />
          {conf.score != null && (
            <small className="text-color-secondary">{pct(conf.score)} de datos disponibles</small>
          )}
          {prediccion.versionModelo && (
            <small className="text-color-secondary">· {prediccion.versionModelo}</small>
          )}
        </div>
        {dosificacionId && (
          <Button
            label="Guardar predicción"
            icon="fa-solid fa-save"
            size="small"
            className="p-button-outlined"
            loading={saving}
            disabled={saving}
            onClick={handleSave}
          />
        )}
      </div>

      {/* Índices en grid */}
      <div className="grid">
        {cards.map(c => (
          <div key={c.key} className="col-12 md:col-6 lg:col-3">
            <IndiceCard titulo={c.titulo} score={c.ind.score} clase={c.ind.clase} invertido={c.invertido} descripcion={c.descripcion} />
          </div>
        ))}
      </div>

      {/* Interpretación */}
      {prediccion.perfilTexto && (
        <div className="surface-card p-3 border-round border-1 border-200">
          <div className="text-xs font-bold text-color-secondary mb-1">Lectura técnica</div>
          <div className="text-sm" style={{ lineHeight: 1.5 }}>{prediccion.perfilTexto}</div>
        </div>
      )}

      {/* Riesgos */}
      {prediccion.riesgos?.length > 0 && (
        <div className="surface-card p-3 border-round border-1 border-200">
          <div className="text-xs font-bold text-color-secondary mb-2">Riesgos detectados</div>
          <div className="flex flex-column gap-2">
            {prediccion.riesgos.map((r, i) => (
              <div key={i} className="flex align-items-start gap-2">
                <i className="fa-solid fa-triangle-exclamation mt-1" style={{ color: 'var(--orange-400)' }} />
                <div>
                  <div className="text-sm font-semibold">{r.titulo || r.codigo}</div>
                  <div className="text-xs text-color-secondary" style={{ lineHeight: 1.4 }}>{r.mensaje}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recomendaciones */}
      {prediccion.recomendaciones?.length > 0 && (
        <div className="surface-card p-3 border-round border-1 border-200">
          <div className="text-xs font-bold text-color-secondary mb-2">Recomendaciones operativas</div>
          <ul className="text-sm pl-4 my-0" style={{ lineHeight: 1.5 }}>
            {prediccion.recomendaciones.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Aviso de prudencia — siempre visible */}
      <div className="text-xs text-color-secondary" style={{ fontStyle: 'italic' }}>
        <i className="fa-solid fa-circle-info mr-1" />
        Esta predicción es una estimación técnica heurística. No reemplaza el pastón de prueba ni los ensayos de planta.
      </div>
    </div>
  );
}
