import React, { useMemo } from 'react';
import { Tag } from 'primereact/tag';
import { Tooltip } from 'primereact/tooltip';
import {
  evaluarDual,
  VEREDICTO,
  MODO_NORMATIVO,
  MODO_DESCRIPTIVO,
} from '../../../lib/evaluacion';

/**
 * DualVeredictoBadge — PR9.3.
 *
 * Muestra LADO A LADO los dos veredictos del modelo dual (PRESTACIONAL +
 * PRESCRIPTIVO) sobre los mismos datos del material. Pensado para cards
 * internas, dashboards y listados del CRM donde el operador necesita ver
 * en simultáneo:
 *
 *   - Prestacional: lo que el catálogo del tenant declara obligatorio.
 *   - Prescriptivo: lo que la norma exige según el contexto declarado.
 *
 * Política arquitectónica (decisión 4 confirmada): los PDFs hacia afuera
 * usan SÓLO el modo elegido; las pantallas internas muestran AMBOS.
 *
 * Props:
 *   - items:        array de items del resumen del agregado (con tipo + compliance).
 *   - contextoAgregado: 'HORMIGON' | 'TBS' | 'AMBOS' (default 'HORMIGON').
 *   - claseExposicion / fceMpa / tipoAgregado / etc.: contexto para el
 *     engine prescriptivo.
 *   - compact: boolean — si true, dos badges chiquitos uno al lado del otro.
 *     Si false, layout vertical con detalle.
 *   - className: extra CSS.
 *
 * El componente NO hace fetch; recibe items ya cargados. Para queries
 * livianas (sin items completos) puede pasar items=[] y los badges
 * mostrarán INCOMPLETO en ambos modos.
 */

const VEREDICTO_LABEL = {
  [VEREDICTO.APTO]: 'Apto',
  [VEREDICTO.APTO_CON_OBSERVACIONES]: 'Apto c/obs',
  [VEREDICTO.NO_APTO]: 'No apto',
  [VEREDICTO.INCOMPLETO]: 'Incompleto',
};

const VEREDICTO_SEVERITY = {
  [VEREDICTO.APTO]: 'success',
  [VEREDICTO.APTO_CON_OBSERVACIONES]: 'warning',
  [VEREDICTO.NO_APTO]: 'danger',
  [VEREDICTO.INCOMPLETO]: 'info',
};

const MODO_LABEL = {
  [MODO_DESCRIPTIVO]: 'Catálogo',
  [MODO_NORMATIVO]:   'Norma',
};

const MODO_TOOLTIP = {
  [MODO_DESCRIPTIVO]: 'Veredicto operativo según el catálogo de obligatoriedad del tenant. Útil internamente para decidir si avanzar con el material; no se publica en documentos hacia afuera (la ficha técnica descriptiva no emite veredicto).',
  [MODO_NORMATIVO]:   'Veredicto según la matriz normativa estricta CIRSOC 200:2024 + serie IRAM. Independiente del catálogo del tenant.',
};

/**
 * Badge interno (un solo modo). Reutilizable.
 */
function ModoBadge({ modo, veredicto, conteo, compact, tooltipId }) {
  // El engine descriptivo devuelve veredicto: null en algunos casos (modo
  // que no juzga). Mostramos un placeholder "Informativo" para que el badge
  // siga siendo legible sin engañar al lector con un veredicto inexistente.
  const isNullVeredicto = veredicto == null;
  const label = isNullVeredicto ? 'Informativo' : (VEREDICTO_LABEL[veredicto] || veredicto);
  const severity = isNullVeredicto ? 'secondary' : (VEREDICTO_SEVERITY[veredicto] || 'info');
  const modoLabel = MODO_LABEL[modo];
  const tooltipBase = MODO_TOOLTIP[modo];
  const noConc = conteo?.noConcluyentes || 0;
  const detalleConteo = conteo
    ? ` · ${conteo.ok} OK / ${conteo.fail} fail / ${conteo.faltantes} faltantes${noConc ? ` / ${noConc} no concluyentes` : ''}`
    : '';

  if (compact) {
    return (
      <>
        <Tooltip target={`#${tooltipId}`} content={`${modoLabel}: ${label}${detalleConteo}\n${tooltipBase}`} position="top" />
        <span id={tooltipId} className="inline-flex align-items-center gap-1 mr-2">
          <span className="text-xs text-500" style={{ minWidth: 36 }}>{modoLabel.slice(0, 4)}.</span>
          <Tag value={label} severity={severity} className="text-xs" />
        </span>
      </>
    );
  }

  return (
    <>
      <Tooltip target={`#${tooltipId}`} content={tooltipBase} position="top" />
      <div id={tooltipId} className="flex align-items-center gap-2 mb-1">
        <span className="text-xs text-500" style={{ minWidth: 80 }}>{modoLabel}:</span>
        <Tag value={label} severity={severity} className="text-xs" />
        {conteo && (
          <span className="text-xs text-500">
            {conteo.ok} OK · {conteo.fail} fail · {conteo.faltantes} faltantes
            {noConc ? ` · ${noConc} no concluyentes` : ''}
          </span>
        )}
      </div>
    </>
  );
}

const DualVeredictoBadge = ({
  items = [],
  contextoAgregado = 'HORMIGON',
  claseExposicion = null,
  fceMpa = null,
  tipoAgregado = null,
  tipoRoca = null,
  evaluacionRas = null,
  tiposCatalogo = null,
  compact = false,
  className = '',
  idPrefix = 'dvb',
}) => {
  const dual = useMemo(() => {
    return evaluarDual({
      items,
      contextoAgregado,
      tiposCatalogo,
      // Contexto prescriptivo:
      tipoAgregado,
      claseExposicion,
      fceMpa,
      tipoRoca,
      evaluacionRas,
    });
  }, [items, contextoAgregado, tiposCatalogo, tipoAgregado, claseExposicion, fceMpa, tipoRoca, evaluacionRas]);

  const layoutClass = compact ? 'inline-flex align-items-center' : 'flex flex-column';

  return (
    <div className={`${layoutClass} ${className}`}>
      <ModoBadge
        modo={MODO_DESCRIPTIVO}
        veredicto={dual.descriptivo.veredicto}
        conteo={dual.descriptivo.conteo}
        compact={compact}
        tooltipId={`${idPrefix}-cat`}
      />
      <ModoBadge
        modo={MODO_NORMATIVO}
        veredicto={dual.normativo.veredicto}
        conteo={dual.normativo.conteo}
        compact={compact}
        tooltipId={`${idPrefix}-norm`}
      />
    </div>
  );
};

export default DualVeredictoBadge;
