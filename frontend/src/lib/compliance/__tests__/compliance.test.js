/**
 * Tests del lib/compliance del frontend (Prompt 3 C2).
 *
 * Verifica:
 *   - Los 10 builders construyen ComplianceResult válido + validan inputs requeridos.
 *   - Los 10 type guards distinguen correctamente.
 *   - isAcceptable cubre pass + passWithObservations + conditionalPass.
 *   - isBlocking cubre fail + inconclusive + notEvaluated + expired + pending.
 *   - match() (legacy 5 handlers) rutea los 5 estados nuevos al handler más cercano.
 *   - matchExt() (10 handlers) es exhaustivo y lanza si falta alguno.
 *   - fromLegacyEval cubre los nuevos legacy strings (PENDIENTE, VENCIDO, informativo).
 *   - VEREDICTO_LABELS mapea los 10 status a las 7 categorías visuales.
 *   - getCategoriaVeredicto acepta ComplianceResult o status string suelto.
 *   - CATEGORIA_COLORS expone las 7 entries con shape estable.
 *   - getCategoriaColor mapea correctamente.
 *   - APTO y APTO CON OBSERVACIONES tienen el mismo color base pero distinto icon (D17).
 *   - (Prompt 4 C4) getDisplayLabel/Severity/Color eliminados — cobertura
 *     de presentación queda exclusivamente en getCategoriaColor + pdfPresentation tests.
 */

import {
  STATUS, ALL_STATUSES, Compliance,
  isPass, isFail, isConditionalPass, isInconclusive, isNotEvaluated,
  isPassWithObservations, isInformative, isExpired, isPending, isNotApplicable,
  isAcceptable, isBlocking,
  match, matchExt,
  fromLegacyEval,
  VEREDICTO, VEREDICTO_LABELS, CATEGORIA_COLORS,
  getCategoriaVeredicto, getCategoriaColor,
} from '../index';

/* ───────── Builders ───────── */

describe('Compliance builders — los 10 estados canónicos', () => {
  test('pass() construye con metadata mínima', () => {
    const r = Compliance.pass({ message: 'cumple', measured: 5, limit: 10, norm: 'IRAM X' });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.message).toBe('cumple');
    expect(r.measured).toBe(5);
    expect(r.norm).toBe('IRAM X');
    expect(Object.isFrozen(r)).toBe(true);
  });

  test('fail() requiere reasons no vacío', () => {
    expect(() => Compliance.fail({ reasons: [] })).toThrow(/al menos una razón/i);
    expect(() => Compliance.fail({})).toThrow();
    const r = Compliance.fail({ reasons: ['supera'], severity: 'bloqueante' });
    expect(r.status).toBe(STATUS.FAIL);
    expect(r.severity).toBe('bloqueante');
  });

  test('conditionalPass() requiere conditions con key+description', () => {
    expect(() => Compliance.conditionalPass({ conditions: [] })).toThrow(/al menos una condición/i);
    expect(() => Compliance.conditionalPass({ conditions: [{ key: 'k' }] })).toThrow(/key.*description/i);
    const r = Compliance.conditionalPass({
      conditions: [{ kind: 'exclude_destination', key: 'k', description: 'd' }],
    });
    expect(r.status).toBe(STATUS.CONDITIONAL_PASS);
    expect(r.conditions).toHaveLength(1);
    expect(Object.isFrozen(r.conditions[0])).toBe(true);
  });

  test('inconclusive() requiere reason', () => {
    expect(() => Compliance.inconclusive({})).toThrow(/reason/i);
    const r = Compliance.inconclusive({ reason: 'precision', detection_limit: 0.01 });
    expect(r.status).toBe(STATUS.INCONCLUSIVE);
    expect(r.detection_limit).toBe(0.01);
  });

  test('notEvaluated() funciona sin args (default)', () => {
    const r = Compliance.notEvaluated();
    expect(r.status).toBe(STATUS.NOT_EVALUATED);
    expect(r.reason).toMatch(/Sin datos/i);
  });

  test('passWithObservations() requiere observation', () => {
    expect(() => Compliance.passWithObservations({})).toThrow(/observation/i);
    const r = Compliance.passWithObservations({ observation: 'cerca del límite' });
    expect(r.status).toBe(STATUS.PASS_WITH_OBSERVATIONS);
    expect(r.observation).toBe('cerca del límite');
  });

  test('informative() funciona sin args', () => {
    const r = Compliance.informative({ message: 'puc 1500' });
    expect(r.status).toBe(STATUS.INFORMATIVE);
    expect(r.message).toBe('puc 1500');
  });

  test('expired() construye reason desde test_date+expiry_date', () => {
    const r = Compliance.expired({ test_date: '2023-01-01', expiry_date: '2024-01-01' });
    expect(r.status).toBe(STATUS.EXPIRED);
    expect(r.test_date).toBe('2023-01-01');
    expect(r.reason).toMatch(/2023-01-01/);
    expect(r.reason).toMatch(/2024-01-01/);
  });

  test('pending() funciona con reason default', () => {
    const r = Compliance.pending();
    expect(r.status).toBe(STATUS.PENDING);
    expect(r.reason).toMatch(/exigible/i);
  });

  test('notApplicable() requiere reason', () => {
    expect(() => Compliance.notApplicable({})).toThrow(/reason/i);
    const r = Compliance.notApplicable({ reason: 'no exigible para este uso' });
    expect(r.status).toBe(STATUS.NOT_APPLICABLE);
  });
});

/* ───────── Type guards ───────── */

describe('Type guards — los 10', () => {
  const ofEach = {
    pass:                 Compliance.pass({}),
    fail:                 Compliance.fail({ reasons: ['x'] }),
    conditionalPass:      Compliance.conditionalPass({ conditions: [{ key: 'k', description: 'd' }] }),
    inconclusive:         Compliance.inconclusive({ reason: 'x' }),
    notEvaluated:         Compliance.notEvaluated(),
    passWithObservations: Compliance.passWithObservations({ observation: 'o' }),
    informative:          Compliance.informative(),
    expired:              Compliance.expired(),
    pending:              Compliance.pending(),
    notApplicable:        Compliance.notApplicable({ reason: 'r' }),
  };

  test.each([
    ['isPass',                 isPass,                 'pass'],
    ['isFail',                 isFail,                 'fail'],
    ['isConditionalPass',      isConditionalPass,      'conditionalPass'],
    ['isInconclusive',         isInconclusive,         'inconclusive'],
    ['isNotEvaluated',         isNotEvaluated,         'notEvaluated'],
    ['isPassWithObservations', isPassWithObservations, 'passWithObservations'],
    ['isInformative',          isInformative,          'informative'],
    ['isExpired',              isExpired,              'expired'],
    ['isPending',              isPending,              'pending'],
    ['isNotApplicable',        isNotApplicable,        'notApplicable'],
  ])('%s identifica solo el estado correcto', (name, fn, key) => {
    for (const [k, r] of Object.entries(ofEach)) {
      expect(fn(r)).toBe(k === key);
    }
    expect(fn(null)).toBe(false);
    expect(fn(undefined)).toBe(false);
    expect(fn({})).toBe(false);
  });

  test('isAcceptable: pass + passWithObservations + conditionalPass', () => {
    expect(isAcceptable(ofEach.pass)).toBe(true);
    expect(isAcceptable(ofEach.passWithObservations)).toBe(true);
    expect(isAcceptable(ofEach.conditionalPass)).toBe(true);
    expect(isAcceptable(ofEach.fail)).toBe(false);
    expect(isAcceptable(ofEach.inconclusive)).toBe(false);
    expect(isAcceptable(ofEach.notEvaluated)).toBe(false);
  });

  test('isBlocking: fail + inconclusive + notEvaluated + expired + pending', () => {
    expect(isBlocking(ofEach.fail)).toBe(true);
    expect(isBlocking(ofEach.inconclusive)).toBe(true);
    expect(isBlocking(ofEach.notEvaluated)).toBe(true);
    expect(isBlocking(ofEach.expired)).toBe(true);
    expect(isBlocking(ofEach.pending)).toBe(true);
    expect(isBlocking(ofEach.pass)).toBe(false);
    expect(isBlocking(ofEach.passWithObservations)).toBe(false);
    expect(isBlocking(ofEach.conditionalPass)).toBe(false);
  });
});

/* ───────── match (5) y matchExt (10) ───────── */

describe('match() — 5 handlers, rutea los 5 nuevos al más cercano', () => {
  const handlers = {
    pass:            () => 'P',
    fail:            () => 'F',
    conditionalPass: () => 'C',
    inconclusive:    () => 'I',
    notEvaluated:    () => 'N',
  };

  test('pass→pass, passWithObservations→pass, informative→pass', () => {
    expect(match(Compliance.pass(), handlers)).toBe('P');
    expect(match(Compliance.passWithObservations({ observation: 'o' }), handlers)).toBe('P');
    expect(match(Compliance.informative(), handlers)).toBe('P');
  });

  test('expired/pending/notApplicable → notEvaluated handler', () => {
    expect(match(Compliance.expired(), handlers)).toBe('N');
    expect(match(Compliance.pending(), handlers)).toBe('N');
    expect(match(Compliance.notApplicable({ reason: 'r' }), handlers)).toBe('N');
  });

  test('lanza si falta algún handler de los 5 obligatorios', () => {
    expect(() => match(Compliance.pass(), { pass: () => 'p' })).toThrow(/faltan handlers/i);
  });
});

describe('matchExt() — 10 handlers exhaustivos', () => {
  const handlers = {
    pass:                 () => 'pass',
    fail:                 () => 'fail',
    conditionalPass:      () => 'cp',
    inconclusive:         () => 'inc',
    notEvaluated:         () => 'ne',
    passWithObservations: () => 'pwo',
    informative:          () => 'info',
    expired:              () => 'exp',
    pending:              () => 'pen',
    notApplicable:        () => 'na',
  };

  test('cada estado rutea a SU propio handler', () => {
    expect(matchExt(Compliance.pass(), handlers)).toBe('pass');
    expect(matchExt(Compliance.passWithObservations({ observation: 'o' }), handlers)).toBe('pwo');
    expect(matchExt(Compliance.informative(), handlers)).toBe('info');
    expect(matchExt(Compliance.expired(), handlers)).toBe('exp');
    expect(matchExt(Compliance.pending(), handlers)).toBe('pen');
    expect(matchExt(Compliance.notApplicable({ reason: 'r' }), handlers)).toBe('na');
  });

  test('lanza si falta cualquiera de los 10', () => {
    const incomplete = { ...handlers };
    delete incomplete.passWithObservations;
    expect(() => matchExt(Compliance.pass(), incomplete)).toThrow(/passWithObservations/);
  });
});

/* ───────── fromLegacyEval — casos nuevos ───────── */

describe('fromLegacyEval — adapter desde shape legacy', () => {
  test('legacy con compliance canónico anidado → passthrough directo', () => {
    const canonical = Compliance.passWithObservations({ observation: 'cerca' });
    const r = fromLegacyEval({ cumple: 'CUMPLE', compliance: canonical });
    expect(r).toBe(canonical);
  });

  test('estado=PENDIENTE → pending', () => {
    const r = fromLegacyEval({ estado: 'PENDIENTE', mensaje: 'falta cargar' });
    expect(r.status).toBe(STATUS.PENDING);
    expect(r.reason).toBe('falta cargar');
  });

  test('estado=VENCIDO → expired', () => {
    const r = fromLegacyEval({ estado: 'VENCIDO', mensaje: 'venció hace 30d' });
    expect(r.status).toBe(STATUS.EXPIRED);
    expect(r.reason).toBe('venció hace 30d');
  });

  test('informativo:true → informative (no Pass como antes)', () => {
    const r = fromLegacyEval({ informativo: true, mensaje: 'puc 1500' });
    expect(r.status).toBe(STATUS.INFORMATIVE);
  });

  test('null/undefined → notEvaluated', () => {
    expect(fromLegacyEval(null).status).toBe(STATUS.NOT_EVALUATED);
    expect(fromLegacyEval(undefined).status).toBe(STATUS.NOT_EVALUATED);
  });

  test('CUMPLE + condicional=true + condiciones[] → conditionalPass', () => {
    const r = fromLegacyEval({
      cumple: 'CUMPLE',
      condicional: true,
      condiciones: [{ key: 'exclude', description: 'no usar en pisos' }],
    });
    expect(r.status).toBe(STATUS.CONDITIONAL_PASS);
    expect(r.conditions).toHaveLength(1);
  });

  test('REGRESIÓN C3: detalle/observaciones no-array no rompe (null, string, undefined)', () => {
    // Ensayos reales en BD pueden tener observaciones como null/string/undefined.
    // El adapter debe ser robusto.
    expect(() => fromLegacyEval({ cumple: 'CUMPLE', observaciones: null })).not.toThrow();
    expect(() => fromLegacyEval({ cumple: 'CUMPLE', observaciones: 'string suelto' })).not.toThrow();
    expect(() => fromLegacyEval({ cumple: 'NO_CUMPLE', detalle: null, observaciones: null })).not.toThrow();
    expect(() => fromLegacyEval({ cumple: 'CUMPLE', detalle: 'string', observaciones: undefined })).not.toThrow();

    // Con detalle/observaciones inválidos, el resultado debe ser válido (sin contenido extra).
    const r = fromLegacyEval({ cumple: 'CUMPLE', detalle: null, observaciones: 'foo' });
    expect(r.status).toBe(STATUS.PASS);
    expect(r.details).toEqual([]);
  });
});

/* ───────── Categorías visuales ───────── */

describe('VEREDICTO + VEREDICTO_LABELS — mapping 10 status → 8 categorías', () => {
  test('VEREDICTO expone 8 categorías canónicas (PR2 sumó APTITUD_NO_DETERMINADA)', () => {
    expect(Object.values(VEREDICTO)).toHaveLength(8);
    expect(VEREDICTO.APTO).toBe('APTO');
    expect(VEREDICTO.APTO_CON_OBSERVACIONES).toBe('APTO CON OBSERVACIONES');
    expect(VEREDICTO.APTITUD_CONDICIONADA).toBe('APTITUD CONDICIONADA');
    expect(VEREDICTO.NO_APTO).toBe('NO APTO');
    expect(VEREDICTO.EVALUACION_INCOMPLETA).toBe('EVALUACIÓN INCOMPLETA');
    expect(VEREDICTO.APTITUD_NO_DETERMINADA).toBe('APTITUD NO DETERMINADA');
    expect(VEREDICTO.INFORMATIVO).toBe('INFORMATIVO');
    expect(VEREDICTO.NO_APLICA).toBe('NO APLICA');
  });

  test('VEREDICTO_LABELS cubre los 10 status', () => {
    for (const status of ALL_STATUSES) {
      expect(VEREDICTO_LABELS[status]).toBeDefined();
    }
  });

  test('mapping: pending/inconclusive/notEvaluated/expired → EVALUACIÓN INCOMPLETA', () => {
    expect(VEREDICTO_LABELS[STATUS.PENDING]).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(VEREDICTO_LABELS[STATUS.INCONCLUSIVE]).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(VEREDICTO_LABELS[STATUS.NOT_EVALUATED]).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(VEREDICTO_LABELS[STATUS.EXPIRED]).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('getCategoriaVeredicto() — acepta compliance, status, o null', () => {
  test('compliance object completo', () => {
    expect(getCategoriaVeredicto(Compliance.pass())).toBe(VEREDICTO.APTO);
    expect(getCategoriaVeredicto(Compliance.passWithObservations({ observation: 'o' }))).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
    expect(getCategoriaVeredicto(Compliance.conditionalPass({ conditions: [{ key: 'k', description: 'd' }] }))).toBe(VEREDICTO.APTITUD_CONDICIONADA);
    expect(getCategoriaVeredicto(Compliance.fail({ reasons: ['x'] }))).toBe(VEREDICTO.NO_APTO);
    expect(getCategoriaVeredicto(Compliance.pending())).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(getCategoriaVeredicto(Compliance.informative())).toBe(VEREDICTO.INFORMATIVO);
    expect(getCategoriaVeredicto(Compliance.notApplicable({ reason: 'r' }))).toBe(VEREDICTO.NO_APLICA);
  });

  test('status string suelto (caso .map() sobre items)', () => {
    expect(getCategoriaVeredicto('pass')).toBe(VEREDICTO.APTO);
    expect(getCategoriaVeredicto('passWithObservations')).toBe(VEREDICTO.APTO_CON_OBSERVACIONES);
    expect(getCategoriaVeredicto('conditionalPass')).toBe(VEREDICTO.APTITUD_CONDICIONADA);
    expect(getCategoriaVeredicto('fail')).toBe(VEREDICTO.NO_APTO);
  });

  test('null/undefined/objeto sin status → EVALUACIÓN INCOMPLETA (default seguro)', () => {
    expect(getCategoriaVeredicto(null)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(getCategoriaVeredicto(undefined)).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
    expect(getCategoriaVeredicto({})).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });

  test('status desconocido → EVALUACIÓN INCOMPLETA (default seguro)', () => {
    expect(getCategoriaVeredicto('unknownStatus')).toBe(VEREDICTO.EVALUACION_INCOMPLETA);
  });
});

describe('CATEGORIA_COLORS + getCategoriaColor()', () => {
  test('CATEGORIA_COLORS expone shape estable para las 7 categorías', () => {
    for (const cat of Object.values(VEREDICTO)) {
      const cfg = CATEGORIA_COLORS[cat];
      expect(cfg).toBeDefined();
      expect(cfg.severity).toBeDefined();
      expect(cfg.bgClass).toMatch(/^bg-/);
      expect(cfg.textClass).toMatch(/^text-/);
      expect(cfg.borderClass).toMatch(/^border-/);
      expect(cfg.icon).toMatch(/^pi /);
      expect(cfg.hex).toMatch(/^#[0-9a-f]{6}$/i);
      expect(Object.isFrozen(cfg)).toBe(true);
    }
  });

  test('D17: APTO y APTO CON OBSERVACIONES comparten color base pero distinto icon', () => {
    const apto = CATEGORIA_COLORS[VEREDICTO.APTO];
    const aptoObs = CATEGORIA_COLORS[VEREDICTO.APTO_CON_OBSERVACIONES];
    // Mismo severity (verde / success)
    expect(apto.severity).toBe('success');
    expect(aptoObs.severity).toBe('success');
    expect(apto.bgClass).toBe(aptoObs.bgClass);
    // Pero distinto icon — el usuario debe poder distinguir
    expect(apto.icon).not.toBe(aptoObs.icon);
    expect(aptoObs.icon).toMatch(/info/);
  });

  test('Severity por categoría', () => {
    expect(CATEGORIA_COLORS[VEREDICTO.APTO].severity).toBe('success');
    expect(CATEGORIA_COLORS[VEREDICTO.APTITUD_CONDICIONADA].severity).toBe('warning');
    expect(CATEGORIA_COLORS[VEREDICTO.NO_APTO].severity).toBe('danger');
    expect(CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA].severity).toBe('info');
    expect(CATEGORIA_COLORS[VEREDICTO.INFORMATIVO].severity).toBe('secondary');
    expect(CATEGORIA_COLORS[VEREDICTO.NO_APLICA].severity).toBe('secondary');
  });

  test('getCategoriaColor acepta compliance / status / categoría label', () => {
    const c1 = getCategoriaColor(Compliance.fail({ reasons: ['x'] }));
    const c2 = getCategoriaColor('fail');
    const c3 = getCategoriaColor(VEREDICTO.NO_APTO);
    expect(c1).toBe(c2);
    expect(c2).toBe(c3);
    expect(c1.severity).toBe('danger');
  });

  test('getCategoriaColor con input desconocido → color de EVALUACIÓN INCOMPLETA', () => {
    expect(getCategoriaColor(null)).toBe(CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA]);
    expect(getCategoriaColor('xyz')).toBe(CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA]);
  });
});

/* ───────── Helpers de display legacy — eliminados en Prompt 4 C4 ─────────
 *
 * El bloque "getDisplayLabel/Severity/Color" fue eliminado junto con los
 * helpers deprecated. La presentación canónica vive en `getCategoriaColor`,
 * `getCategoriaVeredicto`, `CATEGORIA_COLORS` (frontend web) y en
 * `pdfPresentation.js` (PDFs). Cobertura per-categoría de presentación
 * mantenida vía los tests de `pdfPresentation` y de `CumplimientoBadge`.
 */

/* ───────── aggregate() eliminada ───────── */

describe('aggregate() eliminada en C2 — la agregación es lógica de dominio del backend', () => {
  test('aggregate() ya no se exporta', async () => {
    const lib = await import('../index');
    expect(lib.aggregate).toBeUndefined();
  });
});
