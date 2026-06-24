/**
 * Tests del detector de auto-aprobación frontend (Fase 2 — UX).
 *
 * Espejo del backend `politicaRevision.js`. El propósito de estos tests es
 * detectar drift: si la lógica de detección frontend deja de coincidir con
 * la clasificación backend, el confirm informativo dejaría de aparecer
 * cuando corresponde (la auditoría seguiría correcta, pero la UX sería peor).
 */

import { detectarAutoAprobacion, mismoUsuario, obtenerNombreUsuario } from './clasificacionAutoAprobacion';

describe('mismoUsuario', () => {
  test('Strings exactos → true', () => {
    expect(mismoUsuario('gusta', 'gusta')).toBe(true);
  });

  test('Trim y case-insensitive', () => {
    expect(mismoUsuario('Gusta ', 'gusta')).toBe(true);
    expect(mismoUsuario('Gustavo Pérez', 'GUSTAVO PÉREZ')).toBe(true);
  });

  test('Vacío/null → false', () => {
    expect(mismoUsuario(null, 'a')).toBe(false);
    expect(mismoUsuario('a', null)).toBe(false);
    expect(mismoUsuario('', '')).toBe(false);
  });
});

describe('obtenerNombreUsuario', () => {
  test('Prefiere user.nombre cuando existe', () => {
    expect(obtenerNombreUsuario({ nombre: 'Gusta', name: 'X', lastname: 'Y' })).toBe('Gusta');
  });

  test('Cae a name + lastname si falta nombre', () => {
    expect(obtenerNombreUsuario({ name: 'Gustavo', lastname: 'Asinari' })).toBe('Gustavo Asinari');
  });

  test('Cae a username como último recurso', () => {
    expect(obtenerNombreUsuario({ username: 'gusta' })).toBe('gusta');
  });

  test('Usuario null → string vacío', () => {
    expect(obtenerNombreUsuario(null)).toBe('');
    expect(obtenerNombreUsuario(undefined)).toBe('');
  });
});

describe('detectarAutoAprobacion — PENDIENTE_REVISION → A_PRUEBA', () => {
  test('Mismo usuario aprueba lo que envió → flag AUTO_APROBACION_REVISION', () => {
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    const out = detectarAutoAprobacion(dosif, user, 'A_PRUEBA');
    expect(out).toBeTruthy();
    expect(out.flag).toBe('AUTO_APROBACION_REVISION');
    expect(out.titulo).toMatch(/Auto-aprobación/);
    expect(out.descripcion).toMatch(/auditor/i);
  });

  test('Otro usuario aprueba → null (caso normal)', () => {
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'autor' };
    const user = { nombre: 'revisor' };
    expect(detectarAutoAprobacion(dosif, user, 'A_PRUEBA')).toBeNull();
  });

  test('User construido como name + lastname coincide con backend', () => {
    // verifyToken.js arma `usuario` como `${name} ${lastname}`. El detector
    // frontend debe replicar este shape para no perder casos.
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'Gustavo Asinari' };
    const user = { name: 'Gustavo', lastname: 'Asinari' };
    expect(detectarAutoAprobacion(dosif, user, 'A_PRUEBA')).toBeTruthy();
  });
});

describe('detectarAutoAprobacion — PENDIENTE_REVISION → BORRADOR', () => {
  test('Autor rechaza su propio envío → AUTO_RECHAZO_REVISION', () => {
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    const out = detectarAutoAprobacion(dosif, user, 'BORRADOR');
    expect(out.flag).toBe('AUTO_RECHAZO_REVISION');
  });

  test('Otro usuario rechaza → null', () => {
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'autor' };
    const user = { nombre: 'revisor' };
    expect(detectarAutoAprobacion(dosif, user, 'BORRADOR')).toBeNull();
  });
});

describe('detectarAutoAprobacion — A_PRUEBA → EN_PRODUCCION', () => {
  test('Aprobador participó como autor del envío → AUTO_APROBACION_PRODUCCION', () => {
    const dosif = { estado: 'A_PRUEBA', enviadoRevisionPor: 'Gusta', aprobadoPor: 'revisor' };
    const user = { nombre: 'Gusta' };
    const out = detectarAutoAprobacion(dosif, user, 'EN_PRODUCCION');
    expect(out.flag).toBe('AUTO_APROBACION_PRODUCCION');
  });

  test('Aprobador participó como aprobador previo → AUTO_APROBACION_PRODUCCION', () => {
    const dosif = { estado: 'A_PRUEBA', enviadoRevisionPor: 'autor', aprobadoPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    const out = detectarAutoAprobacion(dosif, user, 'EN_PRODUCCION');
    expect(out.flag).toBe('AUTO_APROBACION_PRODUCCION');
  });

  test('Tres roles distintos → null', () => {
    const dosif = { estado: 'A_PRUEBA', enviadoRevisionPor: 'autor', aprobadoPor: 'revisor' };
    const user = { nombre: 'jefe_calidad' };
    expect(detectarAutoAprobacion(dosif, user, 'EN_PRODUCCION')).toBeNull();
  });

  test('Una sola persona en planta chica → marca concentración', () => {
    const dosif = { estado: 'A_PRUEBA', enviadoRevisionPor: 'Gusta', aprobadoPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    const out = detectarAutoAprobacion(dosif, user, 'EN_PRODUCCION');
    expect(out.flag).toBe('AUTO_APROBACION_PRODUCCION');
  });

  test('Legacy estadoNuevo=APROBADO se trata igual', () => {
    const dosif = { estado: 'A_PRUEBA', enviadoRevisionPor: 'Gusta', aprobadoPor: null };
    const user = { nombre: 'Gusta' };
    expect(detectarAutoAprobacion(dosif, user, 'APROBADO')).toBeTruthy();
  });
});

describe('detectarAutoAprobacion — casos sin concentración', () => {
  test('Inputs nulos → null', () => {
    expect(detectarAutoAprobacion(null, null, 'A_PRUEBA')).toBeNull();
    expect(detectarAutoAprobacion({}, null, 'A_PRUEBA')).toBeNull();
    expect(detectarAutoAprobacion(null, {}, 'A_PRUEBA')).toBeNull();
  });

  test('User sin identificadores → null (fail-soft, no false positive)', () => {
    const dosif = { estado: 'PENDIENTE_REVISION', enviadoRevisionPor: 'Gusta' };
    expect(detectarAutoAprobacion(dosif, {}, 'A_PRUEBA')).toBeNull();
  });

  test('BORRADOR → PENDIENTE_REVISION (envío) nunca es auto-aprobación', () => {
    const dosif = { estado: 'BORRADOR', enviadoRevisionPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    expect(detectarAutoAprobacion(dosif, user, 'PENDIENTE_REVISION')).toBeNull();
  });

  test('Suspender / archivar (post-producción) no entran en este detector', () => {
    const dosif = { estado: 'EN_PRODUCCION', enviadoRevisionPor: 'Gusta', aprobadoPor: 'Gusta' };
    const user = { nombre: 'Gusta' };
    expect(detectarAutoAprobacion(dosif, user, 'SUSPENDIDO')).toBeNull();
    expect(detectarAutoAprobacion(dosif, user, 'ARCHIVADO')).toBeNull();
  });
});
