/**
 * Tests del hook `useCanPerform` y la tabla central de acciones.
 *
 * Refactor 2026-05-20 — single-read: los users se construyen con flags
 * directos y `rolCalidad` (no más con array `roles: [...]`).
 *
 *   ADMIN                → { isAdmin: true }
 *   OPERADOR             → { rolCalidad: ROLES.OPERADOR }
 *   RESPONSABLE_CALIDAD  → { rolCalidad: ROLES.RESPONSABLE }
 *   DIRECTOR_TECNICO     → { rolCalidad: ROLES.DIRECTOR_TECNICO }
 *
 * El rol CLIENTE se eliminó en la misma sesión: no hay portal cliente activo.
 *
 * Verificamos:
 *   - Predicado puro (lógica de la tabla, sin necesidad de mounting React).
 *   - Espejo del gating del backend: OPERADOR no aprueba, ADMIN puede todo, etc.
 *   - Acciones desconocidas devuelven false (fail-closed).
 */

import { renderHook } from '@testing-library/react';
import { useCanPerform, rolesParaAccion, listarAcciones } from './useCanPerform';
import { ROLES } from './index';

// Helpers para construir users del modelo single-read.
const asOperador = () => ({ rolCalidad: ROLES.OPERADOR });
const asResponsable = () => ({ rolCalidad: ROLES.RESPONSABLE });
const asDirectorTecnico = () => ({ rolCalidad: ROLES.DIRECTOR_TECNICO });
const asAdmin = () => ({ isAdmin: true });

function setupCan(user) {
  const { result } = renderHook(() => useCanPerform(user));
  return result.current;
}

describe('useCanPerform — jerarquía prescriptiva', () => {
  test('OPERADOR puede operar pero NO aprueba ni elimina', () => {
    const can = setupCan(asOperador());
    // Sí puede:
    expect(can('dosif.crear')).toBe(true);
    expect(can('dosif.calcular')).toBe(true);
    expect(can('dosif.crearVersion')).toBe(true);
    expect(can('paston.crear')).toBe(true);
    expect(can('correccion.aplicar')).toBe(true);
    expect(can('alerta.resolver')).toBe(true);
    // No puede:
    expect(can('dosif.aprobarProduccion')).toBe(false);
    expect(can('dosif.suspender')).toBe(false);
    expect(can('dosif.archivar')).toBe(false);
    expect(can('dosif.eliminar')).toBe(false);
    expect(can('catalogo.crear')).toBe(false);
    expect(can('catalogo.editar')).toBe(false);
    expect(can('admin.gestionarUsuarios')).toBe(false);
  });

  test('RESPONSABLE puede aprobar y editar catálogos pero NO eliminar', () => {
    const can = setupCan(asResponsable());
    expect(can('dosif.aprobarProduccion')).toBe(true);
    expect(can('dosif.suspender')).toBe(true);
    expect(can('dosif.archivar')).toBe(true);
    expect(can('catalogo.crear')).toBe(true);
    expect(can('catalogo.editar')).toBe(true);
    expect(can('paston.overrideFirmar')).toBe(true);
    // Pero no:
    expect(can('dosif.eliminar')).toBe(false);
    expect(can('admin.gestionarUsuarios')).toBe(false);
  });

  test('DIRECTOR_TECNICO puede operar pero NO aprueba transiciones', () => {
    const can = setupCan(asDirectorTecnico());
    expect(can('dosif.calcular')).toBe(true);
    expect(can('dosif.crearVersion')).toBe(true);
    expect(can('paston.overrideFirmar')).toBe(true);
    // No aprueba transiciones críticas — eso es del Responsable de Calidad.
    expect(can('dosif.aprobarProduccion')).toBe(false);
    expect(can('dosif.suspender')).toBe(false);
    expect(can('dosif.archivar')).toBe(false);
    expect(can('dosif.eliminar')).toBe(false);
  });

  test('ADMIN puede todo lo declarado en la tabla', () => {
    const can = setupCan(asAdmin());
    for (const accion of listarAcciones()) {
      expect(can(accion)).toBe(true);
    }
  });

  test('Acción desconocida → false (fail-closed)', () => {
    const can = setupCan(asAdmin());
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    expect(can('accion.no.existe')).toBe(false);
    warn.mockRestore();
  });

  test('Sin user → todo false', () => {
    const can = setupCan(null);
    expect(can('dosif.crear')).toBe(false);
    expect(can('dosif.aprobarProduccion')).toBe(false);
  });

  test('User sin rol ni flags → todo false', () => {
    const can = setupCan({});
    expect(can('dosif.crear')).toBe(false);
  });
});

describe('rolesParaAccion', () => {
  test('Devuelve la lista de roles permitidos', () => {
    expect(rolesParaAccion('dosif.aprobarProduccion')).toEqual(
      expect.arrayContaining([ROLES.RESPONSABLE, ROLES.ADMIN])
    );
    expect(rolesParaAccion('dosif.eliminar')).toEqual([ROLES.ADMIN]);
  });

  test('Acción desconocida → []', () => {
    expect(rolesParaAccion('accion.no.existe')).toEqual([]);
  });
});

describe('Espejo backend — invariantes de jerarquía', () => {
  // Estos invariantes deben mantenerse en sincro con
  // `routes/dosificacionDisenoRoutes.js`. Si alguno falla, hay drift entre
  // frontend y backend que hay que reconciliar.

  test('dosif.aprobarProduccion: solo Responsable y Admin', () => {
    const roles = rolesParaAccion('dosif.aprobarProduccion');
    expect(roles).toEqual(expect.arrayContaining([ROLES.RESPONSABLE, ROLES.ADMIN]));
    expect(roles).not.toContain(ROLES.OPERADOR);
  });

  test('dosif.eliminar: solo Admin', () => {
    const roles = rolesParaAccion('dosif.eliminar');
    expect(roles).toEqual([ROLES.ADMIN]);
  });

  test('catalogo.editar: solo Responsable y Admin', () => {
    const roles = rolesParaAccion('catalogo.editar');
    expect(roles).toEqual(expect.arrayContaining([ROLES.RESPONSABLE, ROLES.ADMIN]));
    expect(roles).not.toContain(ROLES.OPERADOR);
  });
});

describe('Probetas, muestras y ensayos — Bloque 1 RBAC (auditoría 08)', () => {
  test('OPERADOR carga probetas/muestras/ensayos pero NO aprueba ni elimina', () => {
    const can = setupCan(asOperador());
    // Sí puede:
    expect(can('probeta.ver')).toBe(true);
    expect(can('probeta.crear')).toBe(true);
    expect(can('probeta.editar')).toBe(true);
    expect(can('muestra.crear')).toBe(true);
    expect(can('muestra.editar')).toBe(true);
    expect(can('ensayo.crear')).toBe(true);
    expect(can('ensayo.editar')).toBe(true);
    expect(can('ensayo.exportarPDF')).toBe(true);
    // No puede (jerarquía dura):
    expect(can('probeta.eliminar')).toBe(false);
    expect(can('muestra.eliminar')).toBe(false);
    expect(can('ensayo.aprobar')).toBe(false);
    expect(can('ensayo.aprobarMasivo')).toBe(false);
  });

  test('RESPONSABLE confirma muestras y aprueba ensayos pero NO elimina probetas', () => {
    const can = setupCan(asResponsable());
    expect(can('muestra.confirmar')).toBe(true);
    expect(can('muestra.eliminar')).toBe(true);
    expect(can('ensayo.aprobar')).toBe(true);
    expect(can('ensayo.aprobarMasivo')).toBe(true);
    // Pero no:
    expect(can('probeta.eliminar')).toBe(false);
  });

  test('DIRECTOR_TECNICO puede operar pero NO aprueba ensayos comunes', () => {
    const can = setupCan(asDirectorTecnico());
    expect(can('ensayo.crear')).toBe(true);
    expect(can('ensayo.aprobar')).toBe(false); // aprobación común es de RESPONSABLE/ADMIN
    expect(can('probeta.eliminar')).toBe(false);
  });

  test('ADMIN puede eliminar probetas (acción destructiva exclusiva)', () => {
    const can = setupCan(asAdmin());
    expect(can('probeta.eliminar')).toBe(true);
    expect(can('muestra.eliminar')).toBe(true);
    expect(can('ensayo.aprobar')).toBe(true);
    expect(can('ensayo.aprobarMasivo')).toBe(true);
  });

  test('probeta.eliminar: solo Admin (coherente con dosif.eliminar)', () => {
    const roles = rolesParaAccion('probeta.eliminar');
    expect(roles).toEqual([ROLES.ADMIN]);
  });

  test('ensayo.aprobar: Responsable y Admin (coherente con dosif.aprobarProduccion)', () => {
    const roles = rolesParaAccion('ensayo.aprobar');
    expect(roles).toEqual(expect.arrayContaining([ROLES.RESPONSABLE, ROLES.ADMIN]));
    expect(roles).not.toContain(ROLES.OPERADOR);
  });
});
