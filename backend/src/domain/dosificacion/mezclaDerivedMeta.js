'use strict';

function getAggregateName(item) {
  return item?.nombre || item?.nombreAgregado || item?.agregado?.nombre || null;
}

function getAggregateId(item) {
  return item?.idAgregado || item?.agregado?.idAgregado || null;
}

function inferFormaFromName(name) {
  if (!name) return null;
  const normalized = String(name).toLowerCase();
  if (/ripio|grava|canto\s*rodado|rodado/.test(normalized)) return 'CANTO_RODADO';
  if (/triturad|piedra\s*partida|part[ií]d|grueso/.test(normalized)) return 'TRITURADO';
  return null;
}

function inferAggregateKindFromName(name) {
  if (!name) return null;
  const normalized = String(name).toLowerCase();
  // Si contiene "arena" en cualquier parte, es fino
  if (/\barena\b/.test(normalized)) return 'FINO';
  // Si contiene "ripio", "grava", "piedra" en cualquier parte, es grueso
  if (/\bripio\b|\bgrava\b|\bpiedra\b|gravilla|pedregullo|cascajo|canto\s*rodado|rodado/.test(normalized)) return 'GRUESO';
  return null;
}

function normalizeSubtipoToForma(subtipo) {
  if (!subtipo) return null;
  if (subtipo === 'CANTO_RODADO') return 'CANTO_RODADO';
  if (subtipo === 'PIEDRA_PARTIDA') return 'TRITURADO';
  if (String(subtipo).startsWith('TRITURADO')) return 'TRITURADO';
  return null;
}

function isItemCoarse(item, metaMap = {}) {
  if (!item) return false;
  if (item.esFino || item?.agregado?.agregadoFino) return false;

  const inferredKind = inferAggregateKindFromName(getAggregateName(item));
  if (inferredKind === 'FINO') return false;
  if (item.esGrueso || item?.agregado?.agregadoGrueso) return true;
  const itemId = getAggregateId(item);
  if (itemId && normalizeSubtipoToForma(metaMap[itemId])) return true;
  if (inferredKind === 'GRUESO') return true;
  return !!inferFormaFromName(getAggregateName(item));
}

function deriveFormaFromItems(items = [], metaMap = {}) {
  const coarseItems = items.filter((item) => isItemCoarse(item, metaMap));
  if (coarseItems.length === 0) return 'NO_DEFINIDO';

  const formas = coarseItems.map((item) => {
    const itemId = getAggregateId(item);
    const fromMeta = itemId ? normalizeSubtipoToForma(metaMap[itemId]) : null;
    return fromMeta || inferFormaFromName(getAggregateName(item));
  });

  if (formas.some((forma) => !forma)) return 'NO_DEFINIDO';

  const uniques = [...new Set(formas)];
  if (uniques.length === 1) return uniques[0];
  return 'MIXTO';
}

module.exports = {
  deriveFormaFromItems,
  inferAggregateKindFromName,
  inferFormaFromName,
  normalizeSubtipoToForma,
  isItemCoarse,
};