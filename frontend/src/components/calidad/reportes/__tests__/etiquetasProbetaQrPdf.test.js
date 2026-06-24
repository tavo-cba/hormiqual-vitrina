/**
 * Smoke render del N-01 (Bloque 19 auditoría 08) — etiquetas QR de probetas.
 *
 * Polyfill de TextEncoder/TextDecoder porque jsdom (CRA + Jest 27) los omite
 * y la lib `qrcode` los usa internamente. En el navegador real ya existen.
 */
const util = require('util');
if (typeof global.TextEncoder === 'undefined') global.TextEncoder = util.TextEncoder;
if (typeof global.TextDecoder === 'undefined') global.TextDecoder = util.TextDecoder;

const { generarEtiquetasProbetaQrPdf } = require('../etiquetasProbetaQrPdf');

const probetasMock = [
  {
    idProbeta: 100,
    nombre: 'L42P1', codigo: 'L42P1',
    tipoHormigon: 'H-25', diasRotura: 7,
    fechaConfeccion: '2026-04-15', fechaRotura: '2026-04-22',
    fcMpa: 25,
    cliente: 'Constructora Test S.A.', obra: 'Edificio Belgrano', planta: 'La Plata',
  },
  {
    idProbeta: 101,
    nombre: 'L42P2', codigo: 'L42P2',
    tipoHormigon: 'H-25', diasRotura: 28,
    fechaConfeccion: '2026-04-15', fechaRotura: '2026-05-13',
    fcMpa: 25,
    cliente: 'Constructora Test S.A.', obra: 'Edificio Belgrano', planta: 'La Plata',
  },
];

describe('N-01 — etiquetasProbetaQrPdf', () => {
  test('Genera PDF con 2 probetas (1 página)', async () => {
    const doc = await generarEtiquetasProbetaQrPdf(probetasMock);
    expect(doc).toBeDefined();
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
  });

  test('Lista vacía no rompe (PDF en blanco)', async () => {
    const doc = await generarEtiquetasProbetaQrPdf([]);
    expect(doc).toBeDefined();
  });

  test('25 probetas → 2 páginas (capacidad 21 por hoja: 3×7)', async () => {
    const muchas = Array.from({ length: 25 }, (_, i) => ({
      idProbeta: 200 + i,
      nombre: `L99P${i + 1}`,
      tipoHormigon: 'H-30', diasRotura: 28,
    }));
    const doc = await generarEtiquetasProbetaQrPdf(muchas);
    // jsPDF.internal.pages: index 0 es placeholder; cada página ocupa un slot.
    expect(doc.internal.pages.length).toBe(3); // placeholder + página 1 + página 2
  });

  test('baseUrl personalizado se usa en el QR', async () => {
    const doc = await generarEtiquetasProbetaQrPdf(probetasMock, {
      baseUrl: 'https://app.cliente-x.com.ar/probeta/',
    });
    expect(doc).toBeDefined();
  });

  test('Modo térmica: 1 etiqueta por página, formato 60×40mm', async () => {
    const doc = await generarEtiquetasProbetaQrPdf(probetasMock, { formato: 'termica' });
    // 2 probetas → 2 páginas (placeholder + 2)
    expect(doc.internal.pages.length).toBe(3);
    // Cada página mide 60×40mm en landscape (long×short).
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(60, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(40, 0);
  });

  test('Modo a4 explícito sigue siendo el default', async () => {
    const doc = await generarEtiquetasProbetaQrPdf(probetasMock, { formato: 'a4' });
    expect(doc.internal.pageSize.getWidth()).toBeCloseTo(210, 0);
    expect(doc.internal.pageSize.getHeight()).toBeCloseTo(297, 0);
  });
});
