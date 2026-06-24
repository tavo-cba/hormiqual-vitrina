import React, { useState, useMemo } from "react";
import { useSearchParams, useLocation } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { SelectButton } from "primereact/selectbutton";
import { Button } from "primereact/button";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import AdminProbeta from "./probeta";
import AdminProbetaTerceros from "../probeta-terceros/probetaTerceros";
import ProbetaScannerDialog from "./ProbetaScannerDialog";

/**
 * Wrapper de Probetas con 3 pestañas en un mismo mount.
 *
 * Refactor 2026-05-20 — antes cada pestaña era una ruta separada con su propio
 * mount, lo que recargaba `PageHeader` y todo el layout en cada cambio. Acá
 * el wrapper mantiene `PageHeader` + `SelectButton` fijos y solo cambia el
 * sub-componente activo.
 *
 * - Propias  → `AdminProbeta` con `origen='propias'` (excluye pastón).
 * - Terceros → `AdminProbetaTerceros`.
 * - Pastones → `AdminProbeta` con `origen='paston'` (filtra al backend).
 *
 * El buscador se mantiene en este wrapper y se pasa a cada sub-componente
 * como prop controlada. Filtros específicos (estado, rangos) viven dentro
 * de cada sub-componente porque su set varía por pestaña.
 *
 * Deep-linking: la URL `?vista=propias|terceros|pastones` se respeta al
 * cargar; el cambio de tab actualiza el query param sin remontar.
 */

const tabOptions = [
  { label: 'Propias',  value: 'propias' },
  { label: 'Terceros', value: 'terceros' },
  { label: 'Pastones', value: 'pastones' },
];

const ProbetasPage = () => {
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();

  // Vista inicial: (1) detectar URL legacy `/probetas-terceros` → Terceros;
  // (2) query `?vista=propias|terceros|pastones`; (3) default Propias.
  // Aliases por back-compat: 'propio' → propias, 'tercero' → terceros, 'paston' → pastones.
  const vistaPorPath = location.pathname.includes('/probetas-terceros') ? 'terceros' : null;
  const vistaParam = (searchParams.get('vista') || '').toLowerCase();
  const aliases = { propio: 'propias', tercero: 'terceros', paston: 'pastones' };
  const vistaInicial = vistaPorPath || aliases[vistaParam] || vistaParam || 'propias';
  const [vista, setVista] = useState(
    tabOptions.find((t) => t.value === vistaInicial) ? vistaInicial : 'propias'
  );

  // Buscador compartido entre las 3 pestañas. Persiste al cambiar tab para
  // que el operario no pierda lo escrito si saltó a verificar otra fuente.
  const [searchTerm, setSearchTerm] = useState('');

  // Scanner de QR: abre la cámara y, al leer la etiqueta, navega a la carga
  // del ensayo de esa probeta (vía /p/:ref → ProbetaQrRedirect).
  const [scannerVisible, setScannerVisible] = useState(false);

  const cambiarVista = (v) => {
    if (!v) return;
    setVista(v);
    // Actualizamos el query param para deep-linking sin remontar
    // (setSearchParams con replace evita ensuciar el history).
    const next = new URLSearchParams(searchParams);
    next.set('vista', v);
    setSearchParams(next, { replace: true });
  };

  const subtitulo = useMemo(() => {
    if (vista === 'terceros') return 'Probetas de proveedores externos';
    if (vista === 'pastones') return 'Probetas moldeadas en pastones de prueba';
    return 'Probetas propias para control de calidad';
  }, [vista]);

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
        <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
          <PageHeader
            icon="fa-solid fa-flask"
            title="Probetas"
            subtitle={subtitulo}
          />
          <div className="flex align-items-center gap-2 flex-wrap mb-2">
            <Button
              label="Escanear QR"
              icon="fa-solid fa-qrcode"
              size="small"
              outlined
              onClick={() => setScannerVisible(true)}
              tooltip="Escanear el QR de una probeta para cargar su ensayo"
              tooltipOptions={{ position: 'bottom' }}
            />
            <SelectButton
              value={vista}
              options={tabOptions}
              onChange={(e) => cambiarVista(e.value)}
            />
          </div>
        </div>

        <ProbetaScannerDialog
          visible={scannerVisible}
          onHide={() => setScannerVisible(false)}
        />

        {vista === 'propias' && (
          <AdminProbeta
            embedded
            origen="propias"
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        )}
        {vista === 'terceros' && (
          <AdminProbetaTerceros
            embedded
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        )}
        {vista === 'pastones' && (
          <AdminProbeta
            embedded
            origen="paston"
            searchTerm={searchTerm}
            onSearchChange={setSearchTerm}
          />
        )}
      </div>
    </Fade>
  );
};

export default ProbetasPage;
