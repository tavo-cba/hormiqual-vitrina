/**
 * Resolver de "resultado para mostrar" por código de ensayo.
 *
 * Cada tipo de ensayo guarda su resultado con un shape distinto en
 * `ultimoEnsayo.resultado` (densidad tiene 4 campos, granulometría tiene un
 * objeto, materia orgánica es cualitativo, etc). El mapeo a una celda de tabla
 * concisa vive acá para que el certificado/informe lo use sin duplicar lógica.
 *
 * Devuelve { display: string|null, unidad: string }. Si no hay valor, display
 * queda null y el renderer muestra "—".
 */

function fmt(n, dec = 2) {
  if (n == null || n === '') return null;
  const v = Number(n);
  if (!Number.isFinite(v)) return null;
  return v.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

function parseResultado(ensayo) {
  let r = ensayo?.ultimoEnsayo?.resultado;
  if (typeof r === 'string') {
    try { r = JSON.parse(r); } catch { r = null; }
  }
  return r || {};
}

/**
 * Devuelve `{ display, unidad }` listos para imprimir en la celda Resultado del
 * certificado. El mapeo se hace por substring del código canónico para tolerar
 * aliases (IRAM1520_DENSIDAD_ABSORCION_FINO, IRAM1533_DENSIDAD_GRUESO, etc).
 */
export function resolveResultadoDisplay(ensayo) {
  const codigo = ensayo?.tipo?.codigo || ensayo?.AgregadoEnsayoTipo?.codigo || '';
  const r = parseResultado(ensayo);

  // ── Densidad y absorción (IRAM 1520 / 1533) ──
  // Cuando ambos están presentes, se muestran en 2 líneas dentro de la celda
  // (autoTable respeta '\n') para evitar la mezcla "Abs X % · SSS Y" que se
  // veía como dos métricas distintas pegadas en una línea con un separador
  // que la fuente Helvetica rendea como '.' (confuso).
  // Decimales: absorción a 2 (acordado en cards) y SSS a 3
  // (IRAM 1533 reporta densidades a 3 decimales; alineado con la ficha
  // técnica que también usa fmtNum(..., 3)).
  if (codigo.includes('1520_DENSIDAD') || codigo.includes('1533_DENSIDAD') || codigo.includes('DENSIDAD_ABSORCION')) {
    const abs = fmt(r.absorcionPct, 2);
    const sss = fmt(r.densidadRelativaAparenteSSS, 3);
    if (abs && sss) return { display: `Absorción: ${abs} %\nDensidad SSS: ${sss}`, unidad: '' };
    if (abs)        return { display: abs, unidad: '%' };
    if (sss)        return { display: `Densidad SSS: ${sss}`, unidad: '' };
    return { display: null, unidad: '' };
  }

  // ── Material fino que pasa #200 (IRAM 1540 / 1674) ──
  // Decimales: 2 (acordado en cards de Caracterización; valores típicos
  // 0,5-5,0% requieren matiz por debajo del 1%).
  if (codigo.includes('1540') || codigo.includes('1674_MATERIAL') || codigo.includes('PASA_200')) {
    const v = fmt(r.pasa200Pct ?? r.valor, 2);
    return { display: v, unidad: '%' };
  }

  // ── Granulometría (IRAM 1505) ──
  // El resultado relevante a un certificado es el módulo de finura cuando aplica.
  if (codigo.includes('1505_GRANULOMETRIA') || codigo.includes('GRANULOMETRIA')) {
    const g = r.granulometria || {};
    const mf = g.evaluacionAuto?.moduloFinura?.valor
            ?? g.evaluacionAutoGrueso?.moduloFinura?.valor
            ?? g.evaluacion?.calculos?.moduloFinura?.valor
            ?? g.moduloFinura
            ?? g.reportado?.moduloFinura;
    const tmn = g.evaluacionAutoGrueso?.tmnMm ?? g.evaluacion?.calculos?.tmn?.valor ?? g.reportado?.tmnMm;
    const mfStr = fmt(mf, 2);
    if (mfStr && tmn != null) return { display: `MF ${mfStr} · TMN ${tmn} mm`, unidad: '' };
    if (mfStr)                return { display: `MF ${mfStr}`, unidad: '' };
    if (tmn != null)          return { display: `TMN ${tmn} mm`, unidad: '' };
    return { display: null, unidad: '' };
  }

  // ── Materia orgánica (IRAM 1647 colorimétrico) ──
  if (codigo.includes('MATERIA_ORGANICA')) {
    if (r.resultadoColorimetrico === 'menor_500') return { display: '< 500', unidad: 'mg/kg' };
    if (r.resultadoColorimetrico === 'igual_o_mayor_500') return { display: '≥ 500', unidad: 'mg/kg' };
    return { display: null, unidad: 'mg/kg' };
  }

  // ── Peso unitario (IRAM 1548) ──
  if (codigo.includes('PESO_UNITARIO') || codigo.includes('1548')) {
    const puc = fmt(r.puc, 0);
    const pus = fmt(r.pus, 0);
    if (puc && pus) return { display: `PUC ${puc} · PUS ${pus}`, unidad: 'kg/m³' };
    if (puc)        return { display: `PUC ${puc}`, unidad: 'kg/m³' };
    if (pus)        return { display: `PUS ${pus}`, unidad: 'kg/m³' };
    return { display: null, unidad: 'kg/m³' };
  }

  // ── Equivalente de arena (IRAM 1682) ──
  if (codigo.includes('EQUIVALENTE_ARENA') || codigo.includes('1682')) {
    const v = fmt(r.equivalenteArenaPct ?? r.ea_promedio ?? r.valor, 0);
    return { display: v, unidad: '%' };
  }

  // ── Forma: lajosidad / elongación (IRAM 1687) ──
  if (codigo.includes('LAJOSIDAD')) {
    const v = fmt(r.lajosidadPct ?? r.valor, 0);
    return { display: v, unidad: '%' };
  }
  if (codigo.includes('ELONGACION')) {
    const v = fmt(r.elongacionPct ?? r.valor, 0);
    return { display: v, unidad: '%' };
  }

  // ── Desgaste Los Ángeles ──
  if (codigo.includes('LOS_ANGELES') || codigo.includes('DESGASTE_LA')) {
    const v = fmt(r.losAngelesPct ?? r.perdidaPct ?? r.valor, 1);
    return { display: v, unidad: '%' };
  }

  // ── Partículas blandas — cualitativo o numérico ──
  if (codigo.includes('PARTICULAS_BLANDAS')) {
    if (r.resultadoCualitativo === 'no_contiene') return { display: 'No contiene', unidad: '' };
    return { display: fmt(r.valor, 1), unidad: '%' };
  }

  // ── Fallback genérico: valor + % (cubre IRAM 1647 sulfatos/sales/cloruros/terrones/carbonosas
  //    y todos los ensayos químicos donde el resultado es un único `valor`). ──
  // Soporta operador `<` cuando la medición es censurada.
  //
  // Prompt 4 C8 (D28 fix): precisión per-código en lugar del 3 decimales
  // fijos histórico. Valores típicos:
  //   - cloruros (IRAM 1882): ~0,003% → 3 decimales
  //   - sulfatos (IRAM 1647): ~0,01-0,1% → 3 decimales
  //   - terrones de arcilla (IRAM 1647): ~1-3% → 2 decimales
  //   - sales solubles (IRAM 1647): ~0,5-1,5% → 2 decimales
  //   - materias carbonosas (IRAM 1647): ~0,5-1,5% → 2 decimales
  //   - durabilidad por sulfato (IRAM 1525): ~5-12% → 1 decimal
  // Antes: todo con 3 decimales (ej. "Terrones 1,300 %" en lugar de "1,30 %").
  const PRECISION_BY_CODIGO = [
    { match: /CLORURO|1882/, dec: 3 },
    { match: /SULFATO|SO3/, dec: 3 },
    { match: /TERRONES|1647_TERRONES/, dec: 2 },
    { match: /SALES|1647_SALES/, dec: 2 },
    { match: /CARBONOSAS|1647_CARBONOSAS/, dec: 2 },
    { match: /DURABILIDAD|1525/, dec: 1 },
  ];
  const precRule = PRECISION_BY_CODIGO.find((rule) => rule.match.test(codigo));
  const dec = precRule ? precRule.dec : 3;  // 3 decimales como default conservador

  const op = r.operador || (r.esMenorQue ? 'menor_que' : null);
  const opPfx = op === 'menor_que' ? '< ' : op === 'mayor_que' ? '> ' : '';
  const v = fmt(r.valor, dec);
  if (v != null) return { display: `${opPfx}${v}`, unidad: '%' };
  return { display: null, unidad: '%' };
}
