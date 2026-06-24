import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import React, { useEffect, useState } from "react";
import { useIsMobile } from "../../../common/hooks/useIsMobile";
import { Calendar } from "primereact/calendar";
import axios from "axios";
import { config } from "../../../config/config";
import { Checkbox } from "primereact/checkbox";
import { InputSwitch } from "primereact/inputswitch";
import { SelectButton } from "primereact/selectbutton";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { useConfig } from "../../../context/ConfigContext";

const ResistanceFilter = ({
  visible,
  setVisible,
  edadDiseno,
  tempFilters,
  handleApplyFilters,
  handleClearAllFilters,
  dispatch,
  setEdadDiseno,
  handleToggleAll,
  handleToggleColumn,
  visibleColumns,
  optionalColumns,
  exportToExcel,
  exportToPDF,
  allOptionalVisible,
  showCliente,
  setShowCliente,
  showDosificacion,
  setShowDosificacion,
  showPlanta,
  setShowPlanta,
  showObra,
  setShowObra,
  showSabana,
  setShowSabana,
  showHermanas,
  setShowHermanas,
  showListadoProbetas,
  setShowListadoProbetas,
  data10porciento,
  setData10porciento,
  showResumenEstadistico,
  setShowResumenEstadistico,
  criteriosCumplimiento,
  setCriteriosCumplimiento,
  showIram,
  setShowIram,
  showCirsocM1,
  setShowCirsocM1,
  showCirsocM2,
  setShowCirsocM2,
  muestrasTerceros,
  setMuestrasTerceros,
  tipoFecha,
  setTipoFecha,
  esOficial,
  setEsOficial,
  showGraficoComparativo,
  setShowGraficoComparativo,
  showGraficoEvolucion,
  setShowGraficoEvolucion,
}) => {

  const EDADES_DISENO = [
    { label: "7 días", value: 7 },
    { label: "14 días", value: 14 },
    { label: "28 días", value: 28 },
    { label: "56 días", value: 56 },
  ];

  const TIPOS_FECHA = [
    { label: "Confección", value: "confeccion" },
    { label: "Rotura", value: "rotura" },
  ];

  const cfg = useConfig();

  const [fechaDesde, setFechaDesde] = useState(tempFilters.fechaDesde || null);
  const [fechaHasta, setFechaHasta] = useState(tempFilters.fechaHasta || null);
  const [clienteOpts, setClienteOpts] = useState([]);
  const [obraOpts, setObraOpts] = useState([]);
  const [plantaOpts, setPlantaOpts] = useState([]);
  const [dosifOpts, setDosifOpts] = useState([]);
  const [hormigonOpts, setHormigonOpts] = useState([]);
  const [pdfDialog, setPdfDialog] = useState(false);
  const [firmaOpts, setFirmaOpts] = useState([]);
  const [firmaEmpleado, setFirmaEmpleado] = useState(null);
  const [productorHormigon, setProductorHormigon] = useState(cfg?.nombreEmpresa || "");

  useEffect(() => {
    const fetchData = async () => {
      try {
        const [clientes, obras, plantas, dosificaciones, tipos, empleados] = await Promise.all([
          axios.get(`${config.backendUrl}/api/clientes`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/obras`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/dosificaciones`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/muestras/tipohormigon`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/empleados`, { headers: config.headers }),
        ]);

        setClienteOpts(clientes.data.map(c => ({
          label: c.tipoPersona === 'Física' ? c.nombre : c.razonSocial,
          value: c.idCliente,
        })));

        setObraOpts(obras.data.map(o => ({ label: o.nombre, value: o.idObra })));
        setPlantaOpts(plantas.data.map(p => ({ label: p.nombre, value: p.idPlanta })));
        setDosifOpts(dosificaciones.data.map(d => ({
          label: `${d.nombre} (${d.planta?.nombre ?? 'sin planta'})`,
          value: d.idDosificacion,
        })));
        setHormigonOpts(tipos.data.map(t => ({
          label: t.tipoHormigon,
          value: t.idTipoHormigon,
        })));
        setFirmaOpts(
          empleados.data
            .filter(e => e.firmaElectronicaBase64)
            .map(e => ({ label: `${e.apellido}, ${e.nombre}`, ...e }))
        );
      } catch (err) {
        console.error('Error cargando opciones:', err);
      }
    };

    fetchData();
  }, []);

  // RES-10: debounce de 400 ms para evitar 4 fetches consecutivos al elegir
  // cliente/obra/planta/dosificación en cascada — cada cambio llamaba a la
  // API inmediatamente. El reducer dispatch sigue siendo síncrono; solo
  // diferimos la propagación al fetch.
  useEffect(() => {
    if (!edadDiseno) return undefined;
    const t = setTimeout(() => { handleApplyFilters(); }, 400);
    return () => clearTimeout(t);
  }, [tempFilters, edadDiseno]); // eslint-disable-line react-hooks/exhaustive-deps

  const isMobile = useIsMobile();
  const panelClass = `res-filter-panel ${visible && isMobile ? 'mobile-visible' : ''}`;

  // RES-09: en mobile preservamos el estado oculto vía display:none en lugar
  // de desmontar (return null), porque desmontar perdía las fechas locales
  // (fechaDesde/fechaHasta viven en useState dentro del componente).
  const hiddenOnMobile = !visible && isMobile;

  const handleClosePanel = () => {
    if (setVisible) {
      setVisible(false);
    }
  };

  return (
    <aside
      className={panelClass}
      style={hiddenOnMobile ? { display: 'none' } : undefined}
    >
      {/* Botón cerrar en móvil */}
      {isMobile && (
        <button className="res-filter-close-btn" onClick={handleClosePanel}>
          <i className="fa-solid fa-xmark" />
        </button>
      )}

      {/* Header del panel */}
      <div className="res-filter-header">
        <div className="res-filter-header-icon">
          <i className="fa-solid fa-sliders" />
        </div>
        <div className="res-filter-header-text">
          <h2 className="res-filter-header-title">Configuración</h2>
          <p className="res-filter-header-subtitle">Filtros y opciones del reporte</p>
        </div>
      </div>

      {/* Selector de Edad de Diseño */}
      <div className="res-filter-section res-age-selector">
        <h3 className="res-filter-section-title">Edad de diseño</h3>
        <div className="res-dropdown">
          <Dropdown
            value={edadDiseno}
            options={EDADES_DISENO}
            onChange={(e) => setEdadDiseno(e.value)}
            placeholder="Seleccionar edad..."
            showClear
          />
        </div>
      </div>

      {/* Toggle tipo de muestras */}
      <div className="res-sample-toggle">
        <div>
          <div className="res-sample-toggle-label">
            {muestrasTerceros ? 'Muestras de terceros' : 'Muestras propias'}
          </div>
          <div className="res-sample-toggle-hint">
            Cambiar origen de datos
          </div>
        </div>
        <InputSwitch
          checked={muestrasTerceros}
          onChange={(e) => setMuestrasTerceros(e.value)}
        />
      </div>

      {/* Filtros */}
      <div className="res-filter-section">
        <h3 className="res-filter-section-title">Filtros</h3>
        <div className="res-filters-grid">
          <div className="res-dropdown">
            <Dropdown
              value={tempFilters.idCliente ?? null}
              options={clienteOpts}
              placeholder="Cliente"
              filter
              showClear
              onChange={(e) => {
                dispatch({ type: 'SET_FILTER', payload: { field: 'idCliente', value: e.value } });
              }}
            />
          </div>

          <div className="res-dropdown">
            <Dropdown
              value={tempFilters.tipoHormigon ?? null}
              options={hormigonOpts}
              placeholder="Tipo hormigón"
              showClear
              onChange={(e) => {
                dispatch({ type: 'SET_FILTER', payload: { field: 'tipoHormigon', value: e.value } });
              }}
            />
          </div>

          <div className="res-dropdown">
            <Dropdown
              value={tempFilters.idDosificacion ?? null}
              options={dosifOpts}
              placeholder="Dosificación"
              filter
              showClear
              onChange={(e) => {
                dispatch({ type: 'SET_FILTER', payload: { field: 'idDosificacion', value: e.value } });
              }}
            />
          </div>

          <div className="res-dropdown">
            <Dropdown
              value={tempFilters.idObra ?? null}
              options={obraOpts}
              placeholder="Obra"
              showClear
              filter
              onChange={(e) => {
                dispatch({ type: 'SET_FILTER', payload: { field: 'idObra', value: e.value } });
              }}
            />
          </div>

          <div className="res-dropdown">
            <Dropdown
              value={tempFilters.idPlanta ?? null}
              options={plantaOpts}
              placeholder="Planta"
              filter
              showClear
              onChange={(e) => {
                dispatch({ type: 'SET_FILTER', payload: { field: 'idPlanta', value: e.value } });
              }}
            />
          </div>

          {/* Tipo de fecha y rango */}
          <div className="res-date-type">
            <label className="res-date-type-label">Filtrar por fecha de</label>
            <SelectButton
              value={tipoFecha}
              options={TIPOS_FECHA}
              onChange={(e) => e.value && setTipoFecha(e.value)}
              allowEmpty={false}
            />
          </div>
          <div className="res-date-range">
            <div className="res-calendar">
              <Calendar
                value={fechaDesde}
                onChange={(e) => {
                  const date = e.value;
                  setFechaDesde(date);
                  dispatch({
                    type: 'SET_FILTER',
                    payload: { field: 'fechaDesde', value: date },
                  });
                }}
                placeholder="Desde"
                dateFormat="dd/mm/yy"
                monthNavigator
                yearNavigator
                yearRange="2000:2035"
                showButtonBar
                locale="es"
              />
            </div>
            <div className="res-calendar">
              <Calendar
                value={fechaHasta}
                onChange={(e) => {
                  const date = e.value;
                  setFechaHasta(date);
                  dispatch({
                    type: 'SET_FILTER',
                    payload: { field: 'fechaHasta', value: date },
                  });
                }}
                placeholder="Hasta"
                dateFormat="dd/mm/yy"
                monthNavigator
                yearNavigator
                yearRange="2000:2035"
                showButtonBar
                locale="es"
              />
            </div>
          </div>
        </div>

        <Button
          label="Limpiar filtros"
          icon="fa-solid fa-eraser"
          className="res-clear-filters-btn"
          onClick={handleClearAllFilters}
        />
      </div>

      {/* Columnas visibles */}
      <div className="res-filter-section res-columns-section">
        <h3 className="res-filter-section-title">Columnas visibles</h3>
        <div className="res-columns-grid">
          <button
            className={`res-column-chip ${allOptionalVisible ? 'active' : ''}`}
            onClick={handleToggleAll}
          >
            {allOptionalVisible && <i className="fa-solid fa-check res-column-chip-icon" />}
            Todas
          </button>

          {optionalColumns.map((col) => {
            const isSelected = visibleColumns.includes(col.value);
            return (
              <button
                key={col.value}
                className={`res-column-chip ${isSelected ? 'active' : ''}`}
                onClick={() => handleToggleColumn(col.value)}
              >
                {isSelected && <i className="fa-solid fa-check res-column-chip-icon" />}
                {col.label}
              </button>
            );
          })}
        </div>
      </div>

      {/* Exportar */}
      <div className="res-filter-section res-export-section">
        <h3 className="res-filter-section-title">Generar informe</h3>
        <div className="res-export-buttons">
          <Button
            label="Excel"
            icon="fa-solid fa-file-excel"
            className="res-export-btn res-export-btn--excel"
            disabled={!edadDiseno}
            onClick={exportToExcel}
          />
          <Button
            label="PDF"
            icon="fa-solid fa-file-pdf"
            className="res-export-btn res-export-btn--pdf"
            disabled={!edadDiseno}
            onClick={() => setPdfDialog(true)}
          />
        </div>
      </div>

      {/* Dialog de PDF */}
      <Dialog
        visible={pdfDialog}
        onHide={() => setPdfDialog(false)}
        header="Configurar informe PDF"
        className="res-pdf-dialog"
        style={{ width: '90vw', maxWidth: '800px' }}
        dismissableMask
        modal
      >
        <div className="res-pdf-dialog-content">
          <div className="res-pdf-options-grid">
            {/* Datos a mostrar */}
            <div className="res-pdf-option-card">
              <h4 className="res-pdf-option-title">
                <i className="fa-solid fa-eye" style={{ marginRight: '0.5rem', opacity: 0.7 }} />
                Datos a mostrar
              </h4>
              <div className="res-pdf-option-list">
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showCliente"
                    checked={showCliente}
                    onChange={e => setShowCliente(e.checked)}
                  />
                  <label htmlFor="showCliente">Mostrar cliente</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showDosificacion"
                    checked={showDosificacion}
                    onChange={e => setShowDosificacion(e.checked)}
                  />
                  <label htmlFor="showDosificacion">Mostrar dosificación</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showPlanta"
                    checked={showPlanta}
                    onChange={e => setShowPlanta(e.checked)}
                  />
                  <label htmlFor="showPlanta">Mostrar planta</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showObra"
                    checked={showObra}
                    onChange={e => setShowObra(e.checked)}
                  />
                  <label htmlFor="showObra">Mostrar obra</label>
                </div>
              </div>
            </div>

            {/* Detalle de muestras */}
            <div className="res-pdf-option-card">
              <h4 className="res-pdf-option-title">
                <i className="fa-solid fa-list" style={{ marginRight: '0.5rem', opacity: 0.7 }} />
                Detalle de las muestras
              </h4>
              <div className="res-pdf-option-list">
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showResumen"
                    checked={showResumenEstadistico}
                    onChange={e => setShowResumenEstadistico(e.checked)}
                  />
                  <label htmlFor="showResumen">Resumen estadístico</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showSabana"
                    checked={showSabana}
                    onChange={e => setShowSabana(e.checked)}
                  />
                  <label htmlFor="showSabana">Lista sábana de muestras</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showHermanas"
                    checked={showHermanas}
                    onChange={e => setShowHermanas(e.checked)}
                    disabled={!showSabana}
                  />
                  <label htmlFor="showHermanas">Muestras hermanas</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showListadoProbetas"
                    checked={showListadoProbetas}
                    onChange={e => setShowListadoProbetas(e.checked)}
                  />
                  <label htmlFor="showListadoProbetas">Listado de probetas</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showGraficoComparativo"
                    checked={showGraficoComparativo}
                    onChange={e => setShowGraficoComparativo(e.checked)}
                  />
                  <label htmlFor="showGraficoComparativo">Incluir gráfico comparativo</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="showGraficoEvolucion"
                    checked={showGraficoEvolucion}
                    onChange={e => setShowGraficoEvolucion(e.checked)}
                  />
                  <label htmlFor="showGraficoEvolucion">Incluir gráfico de evolución temporal</label>
                </div>
              </div>
            </div>

            {/* Criterios de cumplimiento */}
            <div className="res-pdf-option-card">
              <h4 className="res-pdf-option-title">
                <i className="fa-solid fa-check-double" style={{ marginRight: '0.5rem', opacity: 0.7 }} />
                Criterios de cumplimiento
              </h4>
              <div className="res-pdf-option-list">
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="criterios"
                    checked={criteriosCumplimiento}
                    onChange={e => setCriteriosCumplimiento(e.checked)}
                    disabled={!showResumenEstadistico}
                  />
                  <label htmlFor="criterios">Incluir criterios</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="mostrarIram"
                    checked={showIram}
                    onChange={e => setShowIram(e.checked)}
                    disabled={!criteriosCumplimiento}
                  />
                  <label htmlFor="mostrarIram">Mostrar IRAM</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="mostrarM1"
                    checked={showCirsocM1}
                    onChange={e => setShowCirsocM1(e.checked)}
                    disabled={!criteriosCumplimiento}
                  />
                  <label htmlFor="mostrarM1">Mostrar CIRSOC M1</label>
                </div>
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="mostrarM2"
                    checked={showCirsocM2}
                    onChange={e => setShowCirsocM2(e.checked)}
                    disabled={!criteriosCumplimiento}
                  />
                  <label htmlFor="mostrarM2">Mostrar CIRSOC M2</label>
                </div>
              </div>
            </div>
            <div className="res-pdf-option-card">
              <h4 className="res-pdf-option-title">
                <i className="fa-solid fa-stamp" style={{ marginRight: '0.5rem', opacity: 0.7 }} />
                Tipo de reporte
              </h4>
              <div className="res-pdf-option-list">
                <div className="res-pdf-checkbox">
                  <Checkbox
                    inputId="esOficial"
                    checked={esOficial}
                    onChange={e => setEsOficial(e.checked)}
                  />
                  <label htmlFor="esOficial">¿Es un reporte oficial?</label>
                </div>
              </div>
            </div>
          </div>

          {/* Firma y productor */}
          <div className="res-pdf-footer-section">
            <div className="res-pdf-input-group">
              {muestrasTerceros && (
                <div className="res-pdf-input-wrapper">
                  <label className="res-pdf-input-label">Productor del hormigón</label>
                  <InputText
                    value={productorHormigon}
                    onChange={(e) => setProductorHormigon(e.target.value)}
                    className="w-full"
                    placeholder="Nombre del productor..."
                  />
                </div>
              )}
              <div className="res-pdf-input-wrapper">
                <label className="res-pdf-input-label">Firma del informe</label>
                <Dropdown
                  value={firmaEmpleado}
                  onChange={(e) => setFirmaEmpleado(e.value)}
                  options={firmaOpts}
                  optionLabel="label"
                  placeholder="Seleccionar empleado..."
                  filter
                  showClear
                  className="w-full"
                />
              </div>
            </div>
          </div>
        </div>

        {/* Footer del dialog */}
        <div className="res-pdf-dialog-footer">
          <Button
            label="Generar informe PDF"
            icon="fa-solid fa-file-pdf"
            onClick={() => {
              exportToPDF(firmaEmpleado, productorHormigon);
              setPdfDialog(false);
            }}
          />
        </div>
      </Dialog>
    </aside>
  );
};

export default ResistanceFilter;