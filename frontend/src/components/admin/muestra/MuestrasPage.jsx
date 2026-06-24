import React, { useState, useMemo } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { SelectButton } from "primereact/selectbutton";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import AdminMuestra from "./muestra";
import AdminMuestraTerceros from "../muestra-terceros/muestraTerceros";
import AdminMuestraPaston from "../muestra-paston/muestraPaston";

/**
 * Wrapper de Muestras con 3 pestañas en un mismo mount.
 *
 * Refactor 2026-05-20 — antes el cambio de pestaña navegaba a otra ruta, lo
 * que remontaba `PageHeader` y todo el layout. Acá el wrapper mantiene el
 * header + el `SelectButton` + el buscador fijos, y solo cambia el
 * sub-componente activo. Cada sub-componente conserva sus filtros y acciones
 * propios.
 *
 * Deep-linking: URLs viejas `/calidad/ensayos/muestras-terceros` y
 * `/calidad/ensayos/muestras-pastones` siguen funcionando porque apuntan al
 * wrapper y la pestaña inicial se elige según el pathname. El query
 * `?vista=propias|terceros|pastones` también se respeta.
 */

const tabOptions = [
  { label: 'Propias',  value: 'propias' },
  { label: 'Terceros', value: 'terceros' },
  { label: 'Pastones', value: 'pastones' },
];

const MuestrasPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Vista inicial: (1) URL legacy gana sobre query param;
  // (2) `?vista=...`; (3) default Propias.
  let vistaPorPath = null;
  if (location.pathname.includes('/muestras-terceros')) vistaPorPath = 'terceros';
  else if (location.pathname.includes('/muestras-pastones')) vistaPorPath = 'pastones';

  const vistaParam = (searchParams.get('vista') || '').toLowerCase();
  const aliases = { propio: 'propias', tercero: 'terceros', paston: 'pastones' };
  const vistaInicial = vistaPorPath || aliases[vistaParam] || vistaParam || 'propias';
  const [vista, setVista] = useState(
    tabOptions.find((t) => t.value === vistaInicial) ? vistaInicial : 'propias'
  );

  // Buscador compartido entre las 3 pestañas.
  const [searchTerm, setSearchTerm] = useState('');

  const cambiarVista = (v) => {
    if (!v) return;
    setVista(v);
    const next = new URLSearchParams(searchParams);
    next.set('vista', v);
    setSearchParams(next, { replace: true });
  };

  const subtitulo = useMemo(() => {
    if (vista === 'terceros') return 'Muestras de hormigón de proveedores externos';
    if (vista === 'pastones') return 'Probetas moldeadas durante un pastón de prueba';
    return 'Gestión de muestras de hormigón para control de calidad';
  }, [vista]);

  return (
    <Fade direction="up" duration={500} triggerOnce>
      {/* Sesión 2026-05-28: padding derecho reducido de xl:p-6 (24 px) a
          xl:p-3 (12 px) para que la tabla (especialmente la columna
          "ACCIONES" con sus 3 botones) no quede cortada en el borde derecho.
          El componente embebido (muestra.jsx / muestraTerceros.jsx /
          muestraPaston.jsx) ahora no aplica padding propio, así este es el
          único margen activo. */}
      <div className="w-full flex flex-column align-items-start xl:p-3 xl:pl-0 xl:pt-0">
        <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
          <PageHeader
            icon="fa-solid fa-vials"
            title="Muestras"
            subtitle={subtitulo}
          />
          <SelectButton
            value={vista}
            options={tabOptions}
            onChange={(e) => cambiarVista(e.value)}
            className="mb-2"
          />
        </div>

        {vista === 'propias' && (
          <AdminMuestra embedded searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        )}
        {vista === 'terceros' && (
          <AdminMuestraTerceros embedded searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        )}
        {vista === 'pastones' && (
          <AdminMuestraPaston embedded searchTerm={searchTerm} onSearchChange={setSearchTerm} />
        )}
      </div>
    </Fade>
  );
};

export default MuestrasPage;
