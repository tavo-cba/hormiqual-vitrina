/**
 * PR9.3 — Tests de DualVeredictoBadge.
 *
 * El componente muestra ambos veredictos (PRESTACIONAL + PRESCRIPTIVO)
 * en simultáneo. Cubrimos:
 *  - Sin items: ambos INCOMPLETO.
 *  - Item obligatorio cargado OK + petrográfico no obligatorio ausente:
 *    Prestacional APTO / Prescriptivo INCOMPLETO (caso típico de divergencia).
 *  - Render compact vs detallado.
 *  - Labels correctos.
 */

import React from 'react';
import { render, screen } from '@testing-library/react';
import DualVeredictoBadge from '../DualVeredictoBadge';

const tipoOblig = (codigo, nombre = codigo) => ({
  codigo, nombre, normaRef: 'IRAM XX', aplicaAHormigon: true, obligatorioHormigon: true,
});

const itemOk = (tipo) => ({
  tipo,
  ultimoEnsayo: { resultado: { x: 1 } },
  compliance: { status: 'pass' },
});

describe('PR9.3 — DualVeredictoBadge', () => {
  test('Sin items: ambos modos en INCOMPLETO', () => {
    render(<DualVeredictoBadge items={[]} contextoAgregado="HORMIGON" />);
    // Ambos badges aparecen con label "Incompleto".
    const incompletos = screen.getAllByText('Incompleto');
    expect(incompletos.length).toBeGreaterThanOrEqual(2);
  });

  test('Items obligatorios OK + sin contexto normativo extra → Prestacional APTO', () => {
    const items = [itemOk(tipoOblig('IRAM1505_GRANULOMETRIA', 'Granulometría'))];
    render(<DualVeredictoBadge items={items} contextoAgregado="HORMIGON" />);
    // Al menos uno debe ser Apto (el prestacional).
    const aptos = screen.getAllByText('Apto');
    expect(aptos.length).toBeGreaterThanOrEqual(1);
  });

  // Decisión 2026-05-28: los labels de modo en el badge cambiaron a
  // "Catálogo" (el lado del catálogo del tenant, antes "Prestacional") y
  // "Norma" (la matriz CIRSOC/IRAM, antes "Prescriptivo").
  test('Layout detallado muestra los dos labels de modo', () => {
    render(<DualVeredictoBadge items={[]} contextoAgregado="HORMIGON" compact={false} />);
    expect(screen.getByText('Catálogo:')).toBeInTheDocument();
    expect(screen.getByText('Norma:')).toBeInTheDocument();
  });

  test('Layout compact muestra abreviaturas', () => {
    render(<DualVeredictoBadge items={[]} contextoAgregado="HORMIGON" compact={true} />);
    // En compact los labels son primeros 4 chars + ".": "Catá." / "Norm."
    const cat = screen.getAllByText(/Catá\.|Norm\./);
    expect(cat.length).toBeGreaterThanOrEqual(2);
  });

  test('Caso típico de divergencia: catálogo permisivo + contexto exigente', () => {
    // Catálogo del tenant: sólo granulometría obligatoria, cargada.
    // Contexto prescriptivo: f'c=40, clase C2 → norma exige más cosas (petrográfico, durabilidad).
    const items = [itemOk(tipoOblig('IRAM1505_GRANULOMETRIA', 'Granulometría'))];
    render(
      <DualVeredictoBadge
        items={items}
        contextoAgregado="HORMIGON"
        tipoAgregado="GRUESO"
        claseExposicion="C2"
        fceMpa={40}
        evaluacionRas="NO_REACTIVO"
        tipoRoca="GRANITICA"
      />
    );
    // Prestacional debe ser APTO (catálogo cumplido).
    expect(screen.getAllByText('Apto').length).toBeGreaterThanOrEqual(1);
    // Prescriptivo debe ser INCOMPLETO (faltan ensayos exigidos por la matriz).
    expect(screen.getAllByText('Incompleto').length).toBeGreaterThanOrEqual(1);
  });
});
