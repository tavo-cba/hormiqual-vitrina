/**
 * N-01 (sesión 2026-06-02) — salida ZPL nativa de etiquetas QR de probetas.
 *
 * El layout (coordenadas / fuentes / magnificación) está congelado contra la
 * impresora de producción: estos tests fijan los comandos clave para que un
 * cambio accidental los rompa.
 */
const { generarEtiquetasProbetaZpl } = require('../etiquetasProbetaZpl');

const probetasMock = [
  {
    idProbeta: 100,
    nombre: 'M1P1', codigo: 'M1P1',
    tipoHormigon: 'H-25', diasRotura: 7,
    fechaConfeccion: '2026-05-12',
    cliente: 'Constructora Andina S.A.',
  },
  {
    idProbeta: 101,
    nombre: 'M1P2',
    tipoHormigon: 'H-25', diasRotura: 28,
    fechaConfeccion: '2026-05-12',
    cliente: 'Constructora Andina S.A.',
  },
];

describe('N-01 — etiquetasProbetaZpl', () => {
  test('Una etiqueta = un bloque ^XA … ^XZ', () => {
    const zpl = generarEtiquetasProbetaZpl(probetasMock, { baseUrl: 'https://hormiqual.app/p/' });
    expect((zpl.match(/\^XA/g) || []).length).toBe(2);
    expect((zpl.match(/\^XZ/g) || []).length).toBe(2);
  });

  test('Layout congelado: encabezado y comandos clave', () => {
    const zpl = generarEtiquetasProbetaZpl([probetasMock[0]]);
    expect(zpl).toContain('^CI28');
    expect(zpl).toContain('^PW400');
    expect(zpl).toContain('^LL200');
    expect(zpl).toContain('^FO75,12^A0N,40,30^FDPRB-2026-000100^FS'); // código grande
    expect(zpl).toContain('^FO152,64^A0N,35,23^FDId: M1P1^FS');       // nombre probeta
    expect(zpl).toContain('^FO152,108^A0N,35,23^FDClase: H-25^FS');
    expect(zpl).toContain('^FO152,152^A0N,35,23^FDEdad: 7d^FS');
    // Cliente vertical (reemplaza "Moldeo"), truncado a 16 chars.
    expect(zpl).toContain('^FO355,20^A0R,32,23^FDConstructora And^FS');
    expect(zpl).not.toContain('Moldeo');
    expect(zpl).toContain('^FO312,60^A0R,35,25^FD12/05/26^FS');       // dd/mm/aa
  });

  test('QR nativo (^BQ) apunta a /p/{codigo PRB} con el baseUrl', () => {
    const zpl = generarEtiquetasProbetaZpl([probetasMock[0]], { baseUrl: 'https://hormiqual.app/p/' });
    expect(zpl).toContain('^FO10,58^BQN,2,4^FDMA,https://hormiqual.app/p/PRB-2026-000100^FS');
  });

  test('Lista vacía → string vacío, no rompe', () => {
    expect(generarEtiquetasProbetaZpl([])).toBe('');
  });

  test('Campos faltantes caen a "-" sin romper el comando', () => {
    const zpl = generarEtiquetasProbetaZpl([{ idProbeta: 5, nombre: 'X' }]);
    expect(zpl).toContain('^FDId: X^FS');
    expect(zpl).toContain('^FDClase: -^FS');
    expect(zpl).toContain('^FDEdad: -^FS');
  });

  test('Cliente se trunca a 16 chars y se sanitiza ^/~', () => {
    const zpl = generarEtiquetasProbetaZpl([
      { idProbeta: 9, nombre: 'P1', tipoHormigon: 'H-30', diasRotura: 28, fechaConfeccion: '2026-05-12',
        cliente: 'Hormi^gon~Sur del Litoral' },
    ]);
    // Sanitiza ^/~ ANTES de truncar → 'Hormi-gon-Sur del Litoral'.slice(0,16) = 'Hormi-gon-Sur de'
    expect(zpl).toContain('^FO355,20^A0R,32,23^FDHormi-gon-Sur de^FS');
  });

  test('Código PRB cae a nombre/id si el id no es válido', () => {
    const zpl = generarEtiquetasProbetaZpl([
      { idProbeta: 0, nombre: 'T1-P-P1', tipoHormigon: 'H-25', diasRotura: 28 },
    ]);
    expect(zpl).toContain('^FO75,12^A0N,40,30^FDT1-P-P1^FS'); // fallback a nombre
  });
});
