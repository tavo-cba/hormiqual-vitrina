/**
 * iram1627Svg.js — Gráfico granulométrico IRAM 1627 como SVG templado
 *
 * Muestra las 3 curvas (A, B, C) de IRAM 1627 para mezcla total,
 * con zonas de color diferenciadas:
 *   - Zona A-B (verde): banda más restrictiva
 *   - Zona B-C (ámbar): banda extendida/permisiva
 * La curva de mezcla se superpone con puntos indicando cumplimiento.
 *
 * Eje X logarítmico (abertura en mm), eje Y lineal (0-100 % pasante).
 * Integración PDF: svg2pdf.js (vector) con fallback Canvas 4× DPR.
 */

const VW = 720, VH = 400;
const M = { top: 22, right: 30, bottom: 58, left: 50 };
const AW = VW - M.left - M.right;
const AH = VH - M.top - M.bottom;

const TAMIZ_LABELS = {
  0.075: '0,075', 0.15: '0,15', 0.3: '0,30', 0.6: '0,60',
  1.18: '1,18', 2.36: '2,36', 4.75: '4,75', 9.5: '9,5',
  13.2: '13,2', 19: '19', 26.5: '26,5', 37.5: '37,5', 53: '53', 75: '75',
};

const GRID_SIEVES = [0.075, 0.15, 0.3, 0.6, 1.18, 2.36, 4.75, 9.5, 13.2, 19, 26.5, 37.5, 53, 75];

// M17 (auditoría 01-calidad): patrones de trazo extraídos a constantes para
// no duplicarlos entre curvas y, eventualmente, una leyenda gráfica que los
// quiera replicar. Las dos bandas restrictivas (A y B) comparten dash; la
// banda permisiva C usa un dash más fino para diferenciarla visualmente.
const DASH_BANDA_RESTRICTIVA = '6,3'; // Curvas A y B (banda A-B)
const DASH_BANDA_PERMISIVA   = '4,4'; // Curva C  (banda extendida B-C / A-C)

/**
 * @param {Object} params
 * @param {Array}  params.curvaA   — [{aberturaMm, target}] Curva A (límite inferior)
 * @param {Array}  params.curvaB   — [{aberturaMm, target}] Curva B (límite superior restrictivo)
 * @param {Array}  params.curvaC   — [{aberturaMm, target}] Curva C (límite superior permisivo)
 * @param {Array}  params.medida   — [{aberturaMm, pasaPct}] Curva de mezcla combinada
 * @param {Object} [params.opts]
 * @param {number} [params.opts.tmnMm]
 * @param {Set}    [params.opts.fueraAB]  — aberturas fuera de banda A-B
 * @param {Set}    [params.opts.fueraAC]  — aberturas fuera de banda A-C
 * @param {string} [params.opts.tablaRef] — ej. "Tabla 4"
 * @returns {string} SVG markup
 */
function generarIRAM1627SVG(params, opts = {}) {
  // Support legacy call signature: generarIRAM1627SVG(series, opts)
  // where series = { medida, bandaMin, bandaMax }.
  //
  // M11 — el modo legacy (`bandaMin`/`bandaMax` con dos curvas) DESCARTA la
  // curva intermedia C porque el shape antiguo no la transportaba. Si el
  // caller usa el shape legacy y necesita la banda A-B-C completa, debe
  // migrar al shape nuevo: { curvaA, curvaB, curvaC, medida }. La banda A-C
  // se renderiza solo en el shape nuevo.
  let curvaA, curvaB, curvaC, medida;
  if (params.curvaA) {
    // New format — soporta banda A-B-C completa (IRAM 1627)
    curvaA = params.curvaA;
    curvaB = params.curvaB;
    curvaC = params.curvaC;
    medida = params.medida || [];
  } else {
    // Legacy format: { medida, bandaMin, bandaMax } → solo banda A-B (sin C)
    medida = params.medida || [];
    curvaA = (params.bandaMin || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct }));
    curvaB = (params.bandaMax || []).map(p => ({ aberturaMm: p.aberturaMm, target: p.pasaPct }));
    curvaC = null;
  }

  if (medida.length < 2) return '';

  // Collect all aberturas for axis range
  const allAb = [
    ...medida.map(p => p.aberturaMm),
    ...(curvaA || []).map(p => p.aberturaMm),
    ...(curvaB || []).map(p => p.aberturaMm),
    ...(curvaC || []).map(p => p.aberturaMm),
  ].filter(a => a > 0);
  const logMin = Math.log10(Math.min(...allAb) * 0.8);
  const logMax = Math.log10(Math.max(...allAb) * 1.2);
  const logRange = logMax - logMin;

  const sx = (ab) => M.left + ((Math.log10(ab) - logMin) / logRange) * AW;
  const sy = (pasa) => M.top + AH - (pasa / 100) * AH;
  const sortAsc = (arr) => [...arr].sort((a, b) => a.aberturaMm - b.aberturaMm);
  const polyStr = (arr, key = 'target') => arr.map(p => `${sx(p.aberturaMm).toFixed(1)},${sy(p[key]).toFixed(1)}`).join(' ');

  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}" style="font-family:Helvetica,Arial,sans-serif">`);

  // Background
  p.push(`<rect x="0" y="0" width="${VW}" height="${VH}" fill="#FAFBFC" rx="6"/>`);
  p.push(`<rect x="${M.left}" y="${M.top}" width="${AW}" height="${AH}" fill="white" stroke="#E0E0E0" stroke-width="0.5"/>`);

  // Grid — Y axis
  for (let pct = 0; pct <= 100; pct += 10) {
    const yy = sy(pct);
    p.push(`<line x1="${M.left}" y1="${yy.toFixed(1)}" x2="${M.left + AW}" y2="${yy.toFixed(1)}" stroke="#E8E8E8" stroke-width="0.5"/>`);
    p.push(`<text x="${M.left - 5}" y="${(yy + 3).toFixed(1)}" text-anchor="end" font-size="9" fill="#666">${pct}</text>`);
  }

  // Grid — X axis (solo tamices IRAM)
  for (const t of GRID_SIEVES) {
    const xx = sx(t);
    if (xx < M.left - 1 || xx > M.left + AW + 1) continue;
    p.push(`<line x1="${xx.toFixed(1)}" y1="${M.top}" x2="${xx.toFixed(1)}" y2="${(M.top + AH).toFixed(1)}" stroke="#E8E8E8" stroke-width="0.5"/>`);
    const label = TAMIZ_LABELS[t] || String(t);
    p.push(`<text x="${xx.toFixed(1)}" y="${(M.top + AH + 12).toFixed(1)}" text-anchor="middle" font-size="8" fill="#666" transform="rotate(-45 ${xx.toFixed(1)} ${(M.top + AH + 12).toFixed(1)})">${label}</text>`);
  }

  // Axis titles
  p.push(`<text x="${(M.left + AW / 2).toFixed(0)}" y="${(VH - 5).toFixed(0)}" text-anchor="middle" font-size="11" font-weight="bold" fill="#333">Abertura (mm)</text>`);
  p.push(`<text x="13" y="${(M.top + AH / 2).toFixed(0)}" text-anchor="middle" font-size="11" font-weight="bold" fill="#333" transform="rotate(-90 13 ${(M.top + AH / 2).toFixed(0)})">% Pasante</text>`);

  // ── Zone fills ──
  const sA = curvaA ? sortAsc(curvaA) : [];
  const sB = curvaB ? sortAsc(curvaB) : [];
  const sC = curvaC ? sortAsc(curvaC) : [];

  // Helper: build polygon between two curves
  const buildPoly = (upper, lower, keyU = 'target', keyL = 'target') => {
    if (upper.length < 2 || lower.length < 2) return null;
    const pts = [
      ...upper.map(pt => `${sx(pt.aberturaMm).toFixed(1)},${sy(pt[keyU]).toFixed(1)}`),
      ...[...lower].reverse().map(pt => `${sx(pt.aberturaMm).toFixed(1)},${sy(pt[keyL]).toFixed(1)}`),
    ].join(' ');
    return pts;
  };

  // Zone B-C (ámbar — banda extendida): between curva B and curva C
  if (sB.length >= 2 && sC.length >= 2) {
    const poly = buildPoly(sC, sB);
    if (poly) p.push(`<polygon points="${poly}" fill="#FFF3CD" fill-opacity="0.5" stroke="none"/>`);
  }

  // Zone A-B (verde — banda restrictiva): between curva A and curva B
  if (sA.length >= 2 && sB.length >= 2) {
    const poly = buildPoly(sB, sA);
    if (poly) p.push(`<polygon points="${poly}" fill="#C8E6C9" fill-opacity="0.45" stroke="none"/>`);
  }

  // ── Curve lines (dashed) ──
  if (sA.length >= 2) {
    p.push(`<polyline points="${polyStr(sA)}" fill="none" stroke="#2E7D32" stroke-width="1.2" stroke-dasharray="${DASH_BANDA_RESTRICTIVA}" stroke-opacity="0.8"/>`);
  }
  if (sB.length >= 2) {
    p.push(`<polyline points="${polyStr(sB)}" fill="none" stroke="#F57F17" stroke-width="1.2" stroke-dasharray="${DASH_BANDA_RESTRICTIVA}" stroke-opacity="0.8"/>`);
  }
  if (sC.length >= 2) {
    p.push(`<polyline points="${polyStr(sC)}" fill="none" stroke="#D32F2F" stroke-width="1.0" stroke-dasharray="${DASH_BANDA_PERMISIVA}" stroke-opacity="0.7"/>`);
  }

  // ── Mix curve (solid blue) ──
  const sortedMedida = sortAsc(medida);
  p.push(`<polyline points="${polyStr(sortedMedida, 'pasaPct')}" fill="none" stroke="#1565C0" stroke-width="2.2" stroke-linejoin="round"/>`);

  // ── Points ──
  const fueraAB = opts.fueraAB || opts.fueraAberturas || new Set();
  const fueraAC = opts.fueraAC || new Set();
  for (const pt of sortedMedida) {
    const xx = sx(pt.aberturaMm);
    const yy = sy(pt.pasaPct);
    const outAC = fueraAC.has(pt.aberturaMm);
    const outAB = fueraAB.has(pt.aberturaMm);
    const color = outAC ? '#D32F2F' : outAB ? '#F57F17' : '#1565C0';
    const r = (outAC || outAB) ? 4.5 : 3.5;
    p.push(`<circle cx="${xx.toFixed(1)}" cy="${yy.toFixed(1)}" r="${r}" fill="${color}" stroke="white" stroke-width="1.5"/>`);
  }

  // ── Curve labels (at rightmost point of each curve) ──
  // M12 — offsets verticales asimétricos para que A/B/C no se superpongan
  // cuando los puntos finales de las 3 curvas terminan cerca en pasaPct.
  // A: -3 (arriba), B: +4 (centro), C: +11 (abajo).
  if (sA.length) {
    const last = sA[sA.length - 1];
    p.push(`<text x="${(sx(last.aberturaMm) + 4).toFixed(1)}" y="${(sy(last.target) - 3).toFixed(1)}" font-size="8" font-weight="bold" fill="#2E7D32">A</text>`);
  }
  if (sB.length) {
    const last = sB[sB.length - 1];
    p.push(`<text x="${(sx(last.aberturaMm) + 4).toFixed(1)}" y="${(sy(last.target) + 4).toFixed(1)}" font-size="8" font-weight="bold" fill="#F57F17">B</text>`);
  }
  if (sC.length) {
    const last = sC[sC.length - 1];
    p.push(`<text x="${(sx(last.aberturaMm) + 4).toFixed(1)}" y="${(sy(last.target) + 11).toFixed(1)}" font-size="8" font-weight="bold" fill="#D32F2F">C</text>`);
  }

  // ── Legend ──
  const lx = M.left + 8, ly = M.top + 10;
  // Mix curve
  p.push(`<rect x="${lx}" y="${ly}" width="10" height="2.5" fill="#1565C0"/>`);
  p.push(`<text x="${lx + 14}" y="${ly + 3}" font-size="8" fill="#333">Mezcla</text>`);
  // Band A-B
  p.push(`<rect x="${lx + 65}" y="${ly - 1}" width="10" height="6" fill="#C8E6C9" fill-opacity="0.6" stroke="#2E7D32" stroke-width="0.5"/>`);
  p.push(`<text x="${lx + 79}" y="${ly + 3}" font-size="8" fill="#333">Banda A-B</text>`);
  // Band B-C
  p.push(`<rect x="${lx + 145}" y="${ly - 1}" width="10" height="6" fill="#FFF3CD" fill-opacity="0.6" stroke="#F57F17" stroke-width="0.5"/>`);
  p.push(`<text x="${lx + 159}" y="${ly + 3}" font-size="8" fill="#333">Banda B-C</text>`);
  // Out of band indicators
  if (fueraAB.size > 0 || fueraAC.size > 0) {
    p.push(`<circle cx="${lx + 235}" cy="${ly + 1.5}" r="3" fill="#F57F17" stroke="white" stroke-width="0.8"/>`);
    p.push(`<text x="${lx + 241}" y="${ly + 3}" font-size="7" fill="#F57F17">Fuera de banda A-B</text>`);
    if (fueraAC.size > 0) {
      p.push(`<circle cx="${lx + 325}" cy="${ly + 1.5}" r="3" fill="#D32F2F" stroke="white" stroke-width="0.8"/>`);
      p.push(`<text x="${lx + 331}" y="${ly + 3}" font-size="7" fill="#D32F2F">Fuera de banda A-C</text>`);
    }
  }

  p.push('</svg>');
  return p.join('\n');
}

export { generarIRAM1627SVG };
