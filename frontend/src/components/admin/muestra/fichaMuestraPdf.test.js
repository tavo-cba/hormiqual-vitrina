/**
 * Verificación del PDF "Ficha de muestra" (sesión 2026-06-17):
 *
 *  1. Una probeta Ensayada debe mostrar su resistencia y la relación H/D
 *     (no "—"). Regresión reportada: probeta ensayada sin resistencia.
 *  2. El label de consistencia con "≤" (U+2264) debe sanitizarse a "<=" en la
 *     capa de texto del PDF (sin mojibake byte-por-byte que producía
 *     "A 'd" y el espaciado roto letra-por-letra).
 *
 * Mockeamos jspdf-autotable para capturar las filas que el generador arma,
 * que es exactamente lo que termina renderizado.
 */

jest.mock('jspdf', () => {
  const make = () => {
    const doc = {
      internal: { pageSize: { getWidth: () => 210, getHeight: () => 297 } },
      lastAutoTable: { finalY: 0 },
      getNumberOfPages: () => 1,
      getTextWidth: () => 10,
      splitTextToSize: (t) => (Array.isArray(t) ? t : [t]),
      output: () => new ArrayBuffer(8),
    };
    // Proxy: cualquier método de dibujo no mockeado es un no-op encadenable.
    return new Proxy(doc, {
      get(target, prop) {
        if (prop in target) return target[prop];
        return () => doc;
      },
    });
  };
  return { __esModule: true, default: function jsPDFMock() { return make(); } };
});

global.__AT_CALLS = [];
jest.mock('jspdf-autotable', () => {
  const fn = (doc, opts) => {
    global.__AT_CALLS.push(opts);
    if (doc) doc.lastAutoTable = { finalY: (opts.startY || 0) + 20 };
  };
  return { __esModule: true, default: fn };
});

jest.mock('../../../lib/format/dejavuFont', () => ({
  registerDejavuOnDoc: jest.fn(async () => {}),
  hasDejavuLoaded: () => false,
}));

jest.mock('../../../lib/format/pdfHeader', () => ({
  drawPdfHeader: jest.fn(async () => 30),
}));


import { generarFichaMuestraPdf } from './fichaMuestraPdf';

const datos = {
  muestra: {
    idMuestra: 862,
    fecha: '2026-01-21',
    cliente: { tipoPersona: 'Física', nombre: 'Raul Roberto' },
    planta: { nombre: 'Planta Beltrán' },
    probetas: [
      {
        idProbeta: 1, nombre: 'L1P1', codigo: null, diasRotura: 7,
        fechaRotura: '2026-01-29', idEstadoProbeta: 3, // 3 = Ensayada
        ensayo: { resistencia: 12.29, peso: 3800, altura: 200, diametro: 100, tipoRotura: 'CONO' },
      },
    ],
  },
  fresco: {
    asentamiento: {
      severity: 'warning',
      motivo: 'Asentamiento 90 mm fuera de tolerancia [100, 140] mm respecto al objetivo 120 mm (clase Muy plástica (10,0 < A ≤ 15,0 cm)).',
    },
  },
  fresco_inputs: { asentamientoMmMedido: 90 },
};

beforeEach(() => { global.__AT_CALLS.length = 0; });

test('una probeta Ensayada muestra resistencia y H/D (no "—")', async () => {
  await generarFichaMuestraPdf(datos, { nombreEmpresa: 'HormiQual' });

  // La tabla de probetas es la que tiene 12 columnas en el head.
  const tablaProbetas = global.__AT_CALLS.find((c) => Array.isArray(c.head?.[0]) && c.head[0].length === 12);
  expect(tablaProbetas).toBeTruthy();
  const fila = tablaProbetas.body[0];
  // Columna 9 = Resistencia, 10 = H/D (ver PROBETA_COL_HALIGN).
  expect(fila[9]).toBe('12,29 MPa');
  expect(fila[10]).not.toBe('—');
  expect(fila[10]).toContain('2');
});

test('el "≤" del label de consistencia se sanitiza a "<=" (sin mojibake)', async () => {
  await generarFichaMuestraPdf(datos, { nombreEmpresa: 'HormiQual' });

  const tablaFresco = global.__AT_CALLS.find((c) => c.head?.[0]?.[3] === 'Observación');
  expect(tablaFresco).toBeTruthy();
  const obsAsent = tablaFresco.body[0][3];
  expect(obsAsent).toContain('<=');
  expect(obsAsent).not.toContain('≤');
});
