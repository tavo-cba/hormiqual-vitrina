/**
 * Resolver de "especificación normativa" por código de ensayo (P2.11).
 *
 * El certificado/informe debe mostrar el LÍMITE aplicable al lado del
 * resultado, no solo el resultado. Antes el campo `especificacion` venía
 * hardcoded vacío y se renderizaba como "— %".
 *
 * Las specs reflejan los límites de:
 *   - CIRSOC 200:2024 §3.2.3.3 Tabla 3.4 (sustancias nocivas en agregado fino)
 *   - CIRSOC 200:2024 §3.2.4 Tabla 3.6 (agregado grueso)
 *   - IRAM 1505 / 1627 (granulometría)
 *   - IRAM 1512 §5.2.2 (suma de sustancias nocivas)
 *   - IRAM 1647 (sulfatos, sales, terrones, carbonosas, materia orgánica)
 *   - IRAM 1882 (cloruros)
 *
 * Cuando el límite depende del contexto (ej: pasante #200 con/sin desgaste),
 * la spec muestra ambos valores con la regla aplicada implícita.
 */

/**
 * Devuelve la especificación visible para la celda "Especificación" del PDF.
 *
 * @param {Object} ensayo - shape del item del listado: { tipo: { codigo, ... }, ... }
 * @param {Object} [material] - { tipo: 'FINO'|'GRUESO', subtipo? }
 * @returns {string|null}
 */
export function resolveSpecDisplay(ensayo, material = {}) {
  const codigo = ensayo?.tipo?.codigo || ensayo?.AgregadoEnsayoTipo?.codigo || '';
  const esFino = (material?.tipo || material?.tipoAgregado || '').toUpperCase() === 'FINO';

  // ── Densidad y absorción ──
  // CIRSOC no fija límite directo de densidad; IRAM 1531 (AG) e IRAM 1512 (AF)
  // tratan absorción como caracterización. Se muestra como referencia para que
  // el lector sepa la fuente.
  if (codigo.includes('DENSIDAD_ABSORCION') || codigo.includes('1520_DENSIDAD') || codigo.includes('1533_DENSIDAD')) {
    return esFino ? 'Caracterización (IRAM 1512)' : 'Caracterización (IRAM 1531)';
  }

  // ── Material fino que pasa #200 ──
  if (codigo.includes('1540') || codigo.includes('1674_MATERIAL') || codigo.includes('PASA_200')) {
    if (esFino) return '≤ 3% / 5% (con/sin desgaste)';
    return '≤ 1% / 1,5% (grava/piedra partida)';
  }

  // ── Granulometría (IRAM 1505 + IRAM 1627 bandas) ──
  if (codigo.includes('1505_GRANULOMETRIA') || codigo.includes('GRANULOMETRIA')) {
    if (esFino) return 'IRAM 1627 banda A-B';
    return 'IRAM 1627 / Tabla 3.5 CIRSOC';
  }

  // ── Sustancias nocivas individuales (IRAM 1647 + IRAM 1882) ──
  if (codigo.includes('TERRONES_ARCILLA')) return esFino ? '≤ 3,0%' : '≤ 2,0%';
  if (codigo.includes('SALES_SOLUBLES')) return '≤ 1,5%';
  if (codigo.includes('SULFATOS_SO3')) return esFino ? '≤ 0,1%' : '≤ 0,075%';
  if (codigo.includes('CLORUROS')) return esFino ? '≤ 0,04%' : '≤ 0,003%';
  if (codigo.includes('MATERIAS_CARBONOSAS')) return '≤ 0,5% / 1,0% (aspecto superficial)';
  if (codigo.includes('MATERIA_ORGANICA')) return '< 500 mg/kg (colorimétrico)';

  // ── Equivalente arena (IRAM 1682) ──
  if (codigo.includes('EQUIVALENTE_ARENA') || codigo.includes('1682')) return '≥ 75%';

  // ── Forma (IRAM 1687) — solo grueso ──
  if (codigo.includes('LAJOSIDAD')) return '≤ 30% / 25% (H≥50)';
  if (codigo.includes('ELONGACION')) return '≤ 45% / 40% (H≥50)';

  // ── Mecánica ──
  if (codigo.includes('LOS_ANGELES') || codigo.includes('DESGASTE_LA') || codigo.includes('1532')) {
    return '≤ 50% / 30% (con desgaste)';
  }

  // ── Durabilidad (IRAM 1525) ──
  if (codigo.includes('1525_DURABILIDAD') || codigo.includes('SULFATO_SODIO')) {
    return esFino ? '≤ 10%' : '≤ 12%';
  }

  // ── Estabilidad basálticas (IRAM 1519) ──
  if (codigo.includes('1519') || codigo.includes('BASALTICAS')) return '≤ 12% pérdida';

  // ── Petrográfico ──
  if (codigo.includes('PETROGRAFICO') || codigo.includes('1649')) return 'Caracterización mineralógica';

  // ── Peso unitario (sin límite) ──
  if (codigo.includes('PESO_UNITARIO') || codigo.includes('1548')) {
    return esFino ? 'Sin requisito' : 'PUS ≥ 1.120 kg/m³ (AG)';
  }

  // ── Partículas blandas (IRAM 1644) ──
  if (codigo.includes('PARTICULAS_BLANDAS')) return '≤ 5,0%';

  // ── Polvo adherido (IRAM 1883) ──
  if (codigo.includes('POLVO_ADHERIDO') || codigo.includes('1883')) return '≤ 1,5% (referencia)';

  // ── Suma sustancias nocivas (IRAM 1512) ──
  if (codigo.includes('SUMA_NOCIVAS')) return '≤ 5% / 7% (con/sin desgaste)';

  return null;
}
