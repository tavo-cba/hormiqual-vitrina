import React, { useState, useEffect } from 'react';
import { useSearchParams, useNavigate, useLocation } from 'react-router-dom';
import { TabView, TabPanel } from 'primereact/tabview';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import TableroTenantView from './views/TableroTenantView';
import TableroPlantaView from './views/TableroPlantaView';

/**
 * Tablero de Calidad — wrapper unificado (sesión 2026-05-09).
 *
 * Antes existían DOS páginas paralelas no integradas:
 *   - /calidad/tablero          → vista general (todas las plantas)
 *   - /calidad/dashboard-planta → vista operativa por planta
 *
 * El audit detectó que esto generaba confusión (mismo icono, mismo
 * concepto, sin link cruzado, dashboard-planta no estaba siquiera en
 * el menú). Las fusionamos en una sola URL `/calidad/tablero` con
 * TabView que conmuta entre ambas vistas.
 *
 * Para abrir directo en una vista específica usar `?vista=planta` o
 * `?vista=general` (default general). El redirect de la URL legacy
 * `/calidad/dashboard-planta` agrega `?vista=planta` automáticamente.
 *
 * Nota terminológica: el componente interno se llama
 * `TableroTenantView` (jerga interna del multi-tenant). En UI nunca
 * usamos "tenant" — siempre "general" o "consolidado". El URL param
 * acepta `tenant` como alias de `general` por back-compat.
 */
const TableroCalidadPage = () => {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const location = useLocation();
  const rawVista = (searchParams.get('vista') || 'general').toLowerCase();
  const vista = rawVista === 'tenant' ? 'general' : rawVista;
  const [activeIndex, setActiveIndex] = useState(vista === 'planta' ? 1 : 0);

  // Sincronizar tab → query param (sin reload). Permite que el usuario
  // copie la URL con la vista actual.
  useEffect(() => {
    setActiveIndex(vista === 'planta' ? 1 : 0);
  }, [vista]);

  const handleTabChange = (e) => {
    setActiveIndex(e.index);
    const next = e.index === 1 ? 'planta' : 'general';
    const params = new URLSearchParams(location.search);
    params.set('vista', next);
    navigate(`${location.pathname}?${params.toString()}`, { replace: true });
  };

  return (
    <div className="p-3">
      <PageHeader
        icon="fa-solid fa-gauge-high"
        title="Tablero de Calidad"
        subtitle="Indicadores generales y vista operativa por planta"
      />

      {/* PR9 NO aplica acá: el Tablero muestra ensayos de probetas y
          conteos operativos. El criterio normativo es contractual
          (CIRSOC §6.2.3/§6.2.4) — la norma es soberana siempre.
          Ver CLAUDE.md raíz §"Modelo dual de evaluación → IMPORTANTE
          - DÓNDE APLICA LA DUALIDAD". */}

      <TabView activeIndex={activeIndex} onTabChange={handleTabChange}>
        <TabPanel header="Vista general" leftIcon="pi pi-globe mr-2">
          <TableroTenantView />
        </TabPanel>
        <TabPanel header="Vista por planta" leftIcon="pi pi-building mr-2">
          <TableroPlantaView />
        </TabPanel>
      </TabView>
    </div>
  );
};

export default TableroCalidadPage;
