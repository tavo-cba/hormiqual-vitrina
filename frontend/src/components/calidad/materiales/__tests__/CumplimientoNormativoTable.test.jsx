/**
 * Tests Prompt 3 C3 — CumplimientoNormativoTable.jsx
 *
 * Verifica:
 *   - El componente renderiza filas por requisito normativo.
 *   - Cada fila trae una categoría visual canónica (de las 7 de VEREDICTO).
 *   - Override canónico: si `ensayoSrc.resultado._evaluacion.compliance`
 *     existe, la categoría de la fila se deriva de ese compliance (no
 *     de la re-evaluación local).
 *   - Hybrid Option B activo: ensayos en passWithObservations canónico
 *     (D15+D20) se ven como APTO CON OBSERVACIONES, no NO APTO.
 *   - Fallback legacy: ensayos sin compliance persistido usan fromLegacyEval
 *     o re-evaluación local.
 *   - Sub-aspectos calculados (granulometría: 4 filas; densidad: 4 filas;
 *     PUC/PUS): NO sobreescriben con compliance global del ensayo.
 *   - STATUS_CONFIG eliminado — el componente consume CATEGORIA_COLORS del lib.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import CumplimientoNormativoTable from '../CumplimientoNormativoTable';
import { Compliance, VEREDICTO } from '../../../../lib/compliance';

/* ───────── Fixtures ───────── */

function makeEnsayo(codigo, resultado, opts = {}) {
  return {
    tipo: { codigo },
    resultado,
    cumple: opts.cumple || null,
    fechaVencimiento: opts.fechaVencimiento || null,
  };
}

function makeEnsayoConCompliance(codigo, resultado, compliance, opts = {}) {
  // Embedded compliance dentro del shape `resultado._evaluacion.compliance`
  // (post-C6 backend).
  const r = { ...resultado, _evaluacion: { compliance } };
  return makeEnsayo(codigo, r, opts);
}

/* ───────── Renderizado básico ───────── */

describe('CumplimientoNormativoTable — renderizado', () => {
  test('Render sin ensayos: muestra filas con "Sin dato" / "EVALUACIÓN INCOMPLETA"', () => {
    render(<CumplimientoNormativoTable ensayos={[]} tipoAgregado="Fino" />);
    // Tabla aparece (DataTable mounting)
    // Hay categorías "EVALUACIÓN INCOMPLETA" (sin_dato → INCOMPLETA)
    const incompletas = screen.getAllByText(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(incompletas.length).toBeGreaterThan(0);
  });

  test('Render con ensayo terrones cumpliendo: muestra "APTO"', () => {
    const ensayo = makeEnsayo('IRAM1647_TERRONES_ARCILLA', { valor: 1.0 }, { cumple: 'CUMPLE' });
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    // El requisito "Terrones de arcilla y p.f." aparece
    expect(screen.getByText(/Terrones de arcilla/i)).toBeInTheDocument();
    // Y trae APTO en alguna fila
    expect(screen.getAllByText(VEREDICTO.APTO).length).toBeGreaterThan(0);
  });

  test('Render con ensayo de cloruros NO_CUMPLE: muestra "NO APTO"', () => {
    // Ensayo de cloruros con valor que supera el límite AF (0.04%)
    const ensayo = makeEnsayo('IRAM1882_CLORUROS_SOLUBLES', { valor: 0.08 }, { cumple: 'NO_CUMPLE' });
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    // NO APTO debe aparecer en alguna fila
    expect(screen.getAllByText(VEREDICTO.NO_APTO).length).toBeGreaterThan(0);
  });
});

/* ───────── Override canónico ───────── */

describe('CumplimientoNormativoTable — override canónico (Hybrid Option B)', () => {
  test('Petrográfico reactivo (compliance canónico = conditionalPass): se renderiza como APTITUD CONDICIONADA', () => {
    const compliance = Compliance.conditionalPass({
      conditions: [{
        kind: 'requires_mitigation',
        key: 'ras_mitigation',
        description: 'Apto con cemento bajo álcali',
      }],
    });
    // Materias carbonosas con valor en zona dual + compliance canónico
    // sobreescribiendo a APTITUD CONDICIONADA
    const ensayo = makeEnsayoConCompliance(
      'IRAM1647_MATERIAS_CARBONOSAS',
      { valor: 0.7 }, // zona dual 0.5-1.0%
      compliance,
      { cumple: 'NO_CUMPLE' }, // legacy dice NO_CUMPLE pero canónico manda
    );
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.APTITUD_CONDICIONADA).length).toBeGreaterThan(0);
  });

  test('Materia orgánica con excepción §3.2.3.4 b (compliance = passWithObservations): se renderiza como APTO CON OBSERVACIONES', () => {
    const compliance = Compliance.passWithObservations({
      observation: 'Aprobado por excepción IRAM 1647 §3.2.3.4 b)',
    });
    const ensayo = makeEnsayoConCompliance(
      'IRAM1647_MATERIA_ORGANICA',
      { resultadoColorimetrico: 'igual_o_mayor_500', excepcionValida: true },
      compliance,
    );
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.APTO_CON_OBSERVACIONES).length).toBeGreaterThan(0);
  });

  test('Compliance fail bloqueante: se renderiza como NO APTO', () => {
    const compliance = Compliance.fail({
      reasons: ['supera límite estricto'],
      severity: 'bloqueante',
    });
    const ensayo = makeEnsayoConCompliance(
      'IRAM1647_TERRONES_ARCILLA',
      { valor: 4.0 }, // supera 3% AF
      compliance,
    );
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.NO_APTO).length).toBeGreaterThan(0);
  });
});

/* ───────── Fallback legacy ───────── */

describe('CumplimientoNormativoTable — fallback legacy (ensayos pre-C6)', () => {
  test('Ensayo legacy con cumple=CUMPLE pero sin compliance persistido: usa fromLegacyEval → APTO', () => {
    // Ensayo persistido pre-C6 — `cumple` legacy + `resultado` sin _evaluacion.
    const ensayo = {
      tipo: { codigo: 'IRAM1647_TERRONES_ARCILLA' },
      resultado: { valor: 1.0 },
      cumple: 'CUMPLE',
    };
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.APTO).length).toBeGreaterThan(0);
  });

  test('Ensayo sin cumple ni compliance: usa re-evaluación local del componente', () => {
    // Sales solubles = 0.5% < límite 1.5% → cumple por re-evaluación local
    const ensayo = {
      tipo: { codigo: 'IRAM1647_SALES_SOLUBLES' },
      resultado: { valor: 0.5 },
      // sin cumple, sin compliance
    };
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.APTO).length).toBeGreaterThan(0);
  });
});

/* ───────── Sub-aspectos NO sobreescriben ───────── */

describe('CumplimientoNormativoTable — sub-aspectos calculados (no canónico)', () => {
  test('Granulometría AF: el compliance global del ensayo NO se aplica a las 4 filas de banda/tolerancia/fracción', () => {
    // Granulometría con compliance global = passWithObservations (banda fuera).
    // Sub-aspectos: banda A-B no_cumple, banda A-C cumple, etc.
    // Las filas individuales deben mostrar su evaluación local, no el compliance global.
    const compliance = Compliance.passWithObservations({
      observation: 'Banda fuera — informativo Nivel 1',
    });
    const ensayo = makeEnsayoConCompliance(
      'IRAM1505_GRANULOMETRIA',
      {
        granulometria: {
          evaluacionAuto: {
            resultadoGlobal: { bandaAB: 'no_cumple', bandaAC: 'cumple', mf: 'cumple', fraccion: 'cumple' },
            bandaAB: { fueraDeBanda: 3, peorDesvio: 5 },
            bandaAC: { fueraDeBanda: 0 },
            tolerancia10pp: { aplica: false },
            fraccionMaxima: { peorValor: 30, peorEntre: 'No.4 / No.8' },
          },
        },
      },
      compliance,
    );
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    // banda A-B con 3 fuera → re-evaluación local manda → NO APTO en esa fila
    expect(screen.getByText(/Granulometría banda A-B/i)).toBeInTheDocument();
    expect(screen.getAllByText(VEREDICTO.NO_APTO).length).toBeGreaterThan(0);
    // banda A-C cumple → APTO
    expect(screen.getAllByText(VEREDICTO.APTO).length).toBeGreaterThan(0);
  });

  test('Densidad: 4 filas info (no sobreescriben con compliance del ensayo)', () => {
    // Compliance del ensayo dice fail, pero las filas de densidad son info
    // por construcción ("Sin requisito" — solo data, no veredicto).
    const compliance = Compliance.fail({ reasons: ['x'] });
    const ensayo = makeEnsayoConCompliance(
      'IRAM1520_DENSIDAD_ABSORCION_FINO',
      { densidadRelativaAparenteSSS: 2.6, absorcionPct: 1.5 },
      compliance,
    );
    render(<CumplimientoNormativoTable ensayos={[ensayo]} tipoAgregado="Fino" />);
    expect(screen.getAllByText(VEREDICTO.INFORMATIVO).length).toBeGreaterThan(0);
  });
});

/* ───────── STATUS_CONFIG eliminado ───────── */

describe('CumplimientoNormativoTable — consume CATEGORIA_COLORS del lib', () => {
  test('No exporta STATUS_CONFIG ni similar local', async () => {
    const mod = await import('../CumplimientoNormativoTable');
    // Solo debe exportar el componente default.
    expect(mod.STATUS_CONFIG).toBeUndefined();
  });
});
