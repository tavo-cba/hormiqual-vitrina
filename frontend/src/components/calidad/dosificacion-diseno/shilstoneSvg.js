/**
 * shilstoneSvg.js — Gráfico de Shilstone como SVG templado
 *
 * Ecuaciones exactas (Shilstone 1990):
 *   lim_inf(FdG) = 0.125 * FdG + 27.25
 *   lim_sup(FdG) = 0.125 * FdG + 35.25
 *
 * Zonas MUTUAMENTE EXCLUYENTES (sin superposición de polígonos):
 *   I:   FdG > 75 (todo WF)
 *   II:  banda entre inf y sup, FdG 0-75
 *   III: FdG < 25, WF < inf
 *   IV:  WF > sup, FdG 0-75
 *   V:   WF < inf, 25 <= FdG <= 75
 *
 * M14 (auditoría 02-dosi) — Este módulo se mantiene en CommonJS
 * (`module.exports`) para soportar `require()` dinámico desde
 * `dosificacionInformePdf.js:3055` y `mezclaInformePdf.js:1488`. Migrarlo a
 * ESM (`export {...}`) requiere cambiar también los dos call sites de
 * `require(...)` a `await import(...)` y verificar que jsPDF/webpack manejen
 * el async; por riesgo, queda como deuda. `iram1627Svg.js` ya usa ESM
 * estático porque sus callers lo importan con `import` también estático.
 */

// PR6.b — Margen derecho ampliado de 60 a 80 para que el label del eje Y
// derecho ("Factor de trabajabilidad - FdT (%)") no se recorte cuando el SVG
// se reduce al insertarse en el PDF. Con margen 60 el label quedaba en
// x=705 dentro de un viewBox de 720, demasiado pegado al borde.
// M13 — VH ampliado de 440 a 460 para que la leyenda (y≈428) y la cita
// "Shilstone (1990)" (y=VH-3) tengan margen visible respecto al borde
// inferior del viewBox. AH se mantiene aumentando M.bottom en paralelo.
const VW = 720, VH = 460;
const M = { top: 20, right: 80, bottom: 80, left: 55 };
const AW = VW - M.left - M.right;
const AH = VH - M.top - M.bottom;

function sx(fdg) { return M.left + (100 - fdg) / 100 * AW; }
function sy(wf) { return M.top + (48 - wf) / (48 - 22) * AH; }
function limInf(g) { return 0.125 * g + 27.25; }
function limSup(g) { return 0.125 * g + 35.25; }
function pts(arr) { return arr.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(' '); }
function esc(s) { return String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function label(x, y, text, fill, size, weight) {
  const fs = size || 11;
  const w = text.length * fs * 0.55;
  const h = fs + 4;
  return `<rect x="${(x - w / 2).toFixed(1)}" y="${(y - h + 3).toFixed(1)}" width="${w.toFixed(0)}" height="${h}" rx="3" fill="white" fill-opacity="0.85"/>` +
    `<text x="${x.toFixed(1)}" y="${y.toFixed(1)}" text-anchor="middle" font-size="${fs}" font-weight="${weight || 500}" fill="${fill}">${text}</text>`;
}

function generarShilstoneSVG(fdg, wf, zona) {
  const p = [];
  p.push(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${VW} ${VH}" width="${VW}" height="${VH}" style="font-family:Helvetica,Arial,sans-serif">`);

  // Fondo
  p.push(`<rect x="${M.left}" y="${M.top}" width="${AW}" height="${AH}" fill="#fafafa"/>`);
  p.push(`<defs><clipPath id="sc"><rect x="${M.left}" y="${M.top}" width="${AW}" height="${AH}"/></clipPath></defs>`);

  // Grilla
  p.push(`<g stroke="#e0e0e0" stroke-width="0.5" clip-path="url(#sc)">`);
  for (let g = 0; g <= 100; g += 10) p.push(`<line x1="${sx(g)}" y1="${M.top}" x2="${sx(g)}" y2="${M.top + AH}"/>`);
  for (let w = 22; w <= 48; w += 2) p.push(`<line x1="${M.left}" y1="${sy(w)}" x2="${M.left + AW}" y2="${sy(w)}"/>`);
  p.push(`</g>`);

  // === POLÍGONOS MUTUAMENTE EXCLUYENTES (orden: I, V, III, II, IV) ===
  p.push(`<g clip-path="url(#sc)">`);

  // Zona I: FdG > 75, todo WF → rectángulo (100,48)-(75,48)-(75,22)-(100,22)
  p.push(`<polygon points="${pts([[sx(100),sy(48)],[sx(75),sy(48)],[sx(75),sy(22)],[sx(100),sy(22)]])}" fill="#FFE0B2" fill-opacity="0.25"/>`);

  // Zona V: debajo de inf, 25 <= FdG <= 75 → (25,inf(25))-(75,inf(75))-(75,22)-(25,22)
  const v5 = [[sx(25), sy(limInf(25))]];
  for (let g = 26; g <= 75; g++) v5.push([sx(g), sy(limInf(g))]);
  v5.push([sx(75), sy(22)], [sx(25), sy(22)]);
  p.push(`<polygon points="${pts(v5)}" fill="#D7CCC8" fill-opacity="0.25"/>`);

  // Zona III: FdG < 25, WF < inf → (0,inf(0))-(25,inf(25))-(25,22)-(0,22)
  const v3 = [[sx(0), sy(limInf(0))]];
  for (let g = 1; g <= 25; g++) v3.push([sx(g), sy(limInf(g))]);
  v3.push([sx(25), sy(22)], [sx(0), sy(22)]);
  p.push(`<polygon points="${pts(v3)}" fill="#BBDEFB" fill-opacity="0.20"/>`);

  // Zona II: banda entre inf y sup, FdG 0-75 → paralelogramo
  const v2 = [];
  for (let g = 0; g <= 75; g++) v2.push([sx(g), sy(limSup(g))]);
  for (let g = 75; g >= 0; g--) v2.push([sx(g), sy(limInf(g))]);
  p.push(`<polygon points="${pts(v2)}" fill="#C8E6C9" fill-opacity="0.35"/>`);

  // Zona IV: arriba de sup, FdG 0-75 → (0,48)-(75,48)-(75,sup(75))-(0,sup(0))
  const v4 = [[sx(0), sy(48)], [sx(75), sy(48)]];
  for (let g = 75; g >= 0; g--) v4.push([sx(g), sy(limSup(g))]);
  p.push(`<polygon points="${pts(v4)}" fill="#FFF9C4" fill-opacity="0.30"/>`);

  p.push(`</g>`);

  // === LÍNEAS ===
  p.push(`<g clip-path="url(#sc)">`);
  // Banda sup e inf (verdes punteadas)
  p.push(`<line x1="${sx(0)}" y1="${sy(limSup(0))}" x2="${sx(100)}" y2="${sy(limSup(100))}" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="6,3"/>`);
  p.push(`<line x1="${sx(0)}" y1="${sy(limInf(0))}" x2="${sx(100)}" y2="${sy(limInf(100))}" stroke="#2E7D32" stroke-width="1.5" stroke-dasharray="6,3"/>`);
  // Verticales — primarias (FdG=75, FdG=25) y secundaria (FdG=45)
  p.push(`<line x1="${sx(75)}" y1="${sy(22)}" x2="${sx(75)}" y2="${sy(48)}" stroke="#795548" stroke-width="1" stroke-dasharray="6,4"/>`);
  p.push(`<line x1="${sx(25)}" y1="${sy(22)}" x2="${sx(25)}" y2="${sy(48)}" stroke="#795548" stroke-width="1" stroke-dasharray="6,4"/>`);
  p.push(`<line x1="${sx(45)}" y1="${sy(22)}" x2="${sx(45)}" y2="${sy(48)}" stroke="#BDBDBD" stroke-width="0.5" stroke-dasharray="3,3"/>`);
  p.push(`</g>`);

  // Borde
  p.push(`<rect x="${M.left}" y="${M.top}" width="${AW}" height="${AH}" fill="none" stroke="#E0E0E0" stroke-width="0.5"/>`);

  // === LABELS (centrados en centroide de cada zona) ===
  p.push(label(sx(87), sy(35), 'I Mal Graduado', '#BF360C', 11, 'bold'));
  const wfCentroII = (limSup(45) + limInf(45)) / 2; // ~36.85
  p.push(label(sx(45), sy(wfCentroII), 'II Deseable', '#1B5E20', 11, 'bold'));
  p.push(label(sx(12), sy(25), 'III Óptima', '#0D47A1', 10, '500'));
  p.push(label(sx(12), sy(23.5), '(Dmax &lt;= 12,5 mm)', '#0D47A1', 8, '400'));
  p.push(label(sx(25), sy(46), 'IV Muy Fino', '#E65100', 11, 'bold'));
  p.push(label(sx(50), sy(25.5), 'V Muy Grueso', '#4E342E', 11, 'bold'));

  // === PUNTO (última capa, r=4) ===
  if (fdg != null && wf != null) {
    p.push(`<circle cx="${sx(fdg).toFixed(1)}" cy="${sy(wf).toFixed(1)}" r="4" fill="#FF9800" stroke="#E65100" stroke-width="1.2"/>`);
  }

  // === EJES ===
  p.push(`<g fill="#616161" font-size="10" text-anchor="middle">`);
  for (let g = 0; g <= 100; g += 10) {
    p.push(`<line x1="${sx(g)}" y1="${M.top + AH}" x2="${sx(g)}" y2="${M.top + AH + 4}" stroke="#616161" stroke-width="0.5"/>`);
    p.push(`<text x="${sx(g)}" y="${M.top + AH + 16}">${g}</text>`);
  }
  p.push(`</g>`);
  p.push(`<text x="${M.left + AW / 2}" y="${M.top + AH + 35}" fill="#424242" font-size="12" font-weight="bold" text-anchor="middle">Factor de grosor - FdG (%)</text>`);

  p.push(`<g fill="#616161" font-size="10" text-anchor="start">`);
  for (let w = 22; w <= 48; w += 2) {
    p.push(`<line x1="${M.left + AW}" y1="${sy(w)}" x2="${M.left + AW + 4}" y2="${sy(w)}" stroke="#616161" stroke-width="0.5"/>`);
    p.push(`<text x="${M.left + AW + 7}" y="${sy(w) + 3.5}">${w}</text>`);
  }
  p.push(`</g>`);
  // ytx — antes M.left+AW+45 con margen derecho 60 quedaba muy pegado al borde.
  // Con margen 80, +35 deja respiración cómoda al texto rotado.
  const ytx = M.left + AW + 35, yty = M.top + AH / 2;
  p.push(`<text x="${ytx}" y="${yty}" fill="#424242" font-size="12" font-weight="bold" text-anchor="middle" transform="rotate(90,${ytx},${yty})">Factor de trabajabilidad - FdT (%)</text>`);

  // Leyenda
  if (fdg != null && wf != null) {
    const ly = M.top + AH + 48;
    p.push(`<circle cx="${M.left + 6}" cy="${ly - 3}" r="3.5" fill="#FF9800" stroke="#E65100" stroke-width="1"/>`);
    p.push(`<text x="${M.left + 15}" y="${ly}" fill="#424242" font-size="10">Mezcla actual (FdG: ${fdg.toFixed(1)}% ; FdT: ${wf.toFixed(1)}%) - Zona ${esc(zona || '?')}</text>`);
  }

  // Referencia
  p.push(`<text x="${M.left}" y="${VH - 3}" fill="#9E9E9E" font-size="9" font-style="italic">Shilstone, J.M. (1990) "Concrete Mixture Optimization"</text>`);

  p.push(`</svg>`);
  return p.join('\n');
}

module.exports = { generarShilstoneSVG };
