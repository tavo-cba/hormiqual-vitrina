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

const ProbetasFilter = ({
    visible,
    setVisible,
    tempFilters,
    handleApplyFilters,
    handleClearAllFilters,
    dispatch,
    exportToExcel,
    exportToPDF,
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
    showResistencia,
    setShowResistencia,
    muestrasTerceros,
    setMuestrasTerceros,
    tipoFecha,
    setTipoFecha,
}) => {
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
    const [estadoOpts, setEstadoOpts] = useState([]);
    const [firmaEmpleado, setFirmaEmpleado] = useState(null);
    const [productorHormigon, setProductorHormigon] = useState(cfg?.nombreEmpresa || "");

    useEffect(() => {
        const fetchData = async () => {
            try {
                // [VITRINA] estado-probeta vía despachos fuera de alcance (router /api/despachos
                // no montado). Se quita del Promise.all para no tumbar el resto del filtro.
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
                // [VITRINA] estado-probeta vía despachos fuera de alcance — dropdown sin opciones.
                setEstadoOpts([]);
            } catch (err) {
                console.error('Error cargando opciones:', err);
            }
        };

        fetchData();
    }, []);

    // Debounce de 400 ms para no disparar un fetch por cada keystroke /
    // selección en cascada de filtros.
    useEffect(() => {
        const t = setTimeout(() => { handleApplyFilters(); }, 400);
        return () => clearTimeout(t);
    }, [tempFilters]); // eslint-disable-line react-hooks/exhaustive-deps

    const isMobile = useIsMobile();
    const panelClass = `rpt-filter-panel ${visible && isMobile ? 'mobile-visible' : ''}`;

    // En mobile preservamos el estado interno vía display:none en lugar de
    // desmontar — desmontar perdía las fechas locales del state interno.
    const hiddenOnMobile = !visible && isMobile;

    const handleClosePanel = () => {
        if (setVisible) setVisible(false);
    };

    return (
        <aside
            className={panelClass}
            style={hiddenOnMobile ? { display: 'none' } : undefined}
        >
            {/* Botón cerrar en móvil */}
            {isMobile && (
                <button className="rpt-filter-close-btn" onClick={handleClosePanel}>
                    <i className="fa-solid fa-xmark" />
                </button>
            )}

            {/* Header del panel */}
            <div className="rpt-filter-header">
                <div className="rpt-filter-header-icon rpt-filter-header-icon--probetas">
                    <i className="fa-solid fa-vials" />
                </div>
                <div className="rpt-filter-header-text">
                    <h2 className="rpt-filter-header-title">Configuración</h2>
                    <p className="rpt-filter-header-subtitle">Filtros y opciones del listado</p>
                </div>
            </div>

            {/* Toggle tipo de probetas */}
            <div className="rpt-type-toggle">
                <div className="rpt-type-toggle-content">
                    <div className="rpt-type-toggle-label">
                        {muestrasTerceros ? 'Probetas de terceros' : 'Probetas propias'}
                    </div>
                    <div className="rpt-type-toggle-hint">
                        Cambiar origen de datos
                    </div>
                </div>
                <InputSwitch
                    checked={muestrasTerceros}
                    onChange={(e) => setMuestrasTerceros(e.value)}
                />
            </div>

            {/* Selector de estado destacado */}
            <div className="rpt-filter-section rpt-highlighted-selector">
                <h3 className="rpt-filter-section-title">Filtrar por estado</h3>
                <div className="rpt-dropdown">
                    <Dropdown
                        value={tempFilters.idEstadoProbeta ?? null}
                        options={estadoOpts}
                        onChange={(e) => {
                            dispatch({ type: 'SET_FILTER', payload: { field: 'idEstadoProbeta', value: e.value } });
                        }}
                        placeholder="Todos los estados"
                        showClear
                    />
                </div>
            </div>

            {/* Filtros */}
            <div className="rpt-filter-section">
                <h3 className="rpt-filter-section-title">Filtros adicionales</h3>
                <div className="rpt-filters-grid">
                    <div className="rpt-dropdown">
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

                    <div className="rpt-dropdown">
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

                    <div className="rpt-dropdown">
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

                    <div className="rpt-dropdown">
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

                    <div className="rpt-dropdown">
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
                    <div className="rpt-date-type">
                        <label className="rpt-date-type-label">Filtrar por fecha de</label>
                        <SelectButton
                            value={tipoFecha}
                            options={TIPOS_FECHA}
                            onChange={(e) => e.value && setTipoFecha(e.value)}
                            allowEmpty={false}
                        />
                    </div>
                    <div className="rpt-date-range">
                        <div className="rpt-calendar">
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
                        <div className="rpt-calendar">
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
                    className="rpt-clear-filters-btn"
                    onClick={handleClearAllFilters}
                />
            </div>

            {/* Exportar */}
            <div className="rpt-filter-section rpt-export-section">
                <h3 className="rpt-filter-section-title">Generar informe</h3>
                <div className="rpt-export-buttons">
                    <Button
                        label="Excel"
                        icon="fa-solid fa-file-excel"
                        className="rpt-export-btn rpt-export-btn--excel"
                        onClick={exportToExcel}
                    />
                    <Button
                        label="PDF"
                        icon="fa-solid fa-file-pdf"
                        className="rpt-export-btn rpt-export-btn--pdf"
                        onClick={() => setPdfDialog(true)}
                    />
                </div>
            </div>

            {/* Dialog de PDF */}
            <Dialog
                visible={pdfDialog}
                onHide={() => setPdfDialog(false)}
                header="Configurar informe de probetas"
                className="rpt-pdf-dialog"
                style={{ width: '90vw', maxWidth: '650px' }}
                dismissableMask
                modal
            >
                <div className="rpt-pdf-dialog-content">
                    <div className="rpt-pdf-options-grid">
                        {/* Datos a mostrar */}
                        <div className="rpt-pdf-option-card">
                            <h4 className="rpt-pdf-option-title">
                                <i className="fa-solid fa-eye" />
                                Datos a mostrar
                            </h4>
                            <div className="rpt-pdf-option-list">
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showCliente" checked={showCliente} onChange={e => setShowCliente(e.checked)} />
                                    <label htmlFor="showCliente">Mostrar cliente</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showDosificacion" checked={showDosificacion} onChange={e => setShowDosificacion(e.checked)} />
                                    <label htmlFor="showDosificacion">Mostrar dosificación</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showPlanta" checked={showPlanta} onChange={e => setShowPlanta(e.checked)} />
                                    <label htmlFor="showPlanta">Mostrar planta</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showObra" checked={showObra} onChange={e => setShowObra(e.checked)} />
                                    <label htmlFor="showObra">Mostrar obra</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showResistencia" checked={showResistencia} onChange={e => setShowResistencia(e.checked)} />
                                    <label htmlFor="showResistencia">Mostrar resistencia (ensayadas)</label>
                                </div>
                            </div>
                        </div>

                        {/* Detalle */}
                        <div className="rpt-pdf-option-card">
                            <h4 className="rpt-pdf-option-title">
                                <i className="fa-solid fa-list" />
                                Detalle de las muestras
                            </h4>
                            <div className="rpt-pdf-option-list">
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="showSabana" checked={showSabana} onChange={e => setShowSabana(e.checked)} />
                                    <label htmlFor="showSabana">Lista sábana de muestras</label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Firma y productor */}
                    <div className="rpt-pdf-footer-section">
                        <div className="rpt-pdf-input-group">
                            {muestrasTerceros && (
                                <div className="rpt-pdf-input-wrapper">
                                    <label className="rpt-pdf-input-label">Productor del hormigón</label>
                                    <InputText
                                        value={productorHormigon}
                                        onChange={(e) => setProductorHormigon(e.target.value)}
                                        className="w-full"
                                        placeholder="Nombre del productor..."
                                    />
                                </div>
                            )}
                            <div className="rpt-pdf-input-wrapper">
                                <label className="rpt-pdf-input-label">Firma del informe</label>
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
                <div className="rpt-pdf-dialog-footer">
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

export default ProbetasFilter;