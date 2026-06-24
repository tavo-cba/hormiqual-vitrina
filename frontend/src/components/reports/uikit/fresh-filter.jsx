import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Dialog } from "primereact/dialog";
import { Checkbox } from "primereact/checkbox";
import React, { useEffect, useState } from "react";
import axios from "axios";
import { config } from "../../../config/config";
import { useIsMobile } from "../../../common/hooks/useIsMobile";

const FreshFilter = ({
    visible,
    setVisible,
    tempFilters,
    dispatch,
    handleApplyFilters,
    handleClearAllFilters,
    exportToPDF,
    showLote,
    setShowLote,
    showAire,
    setShowAire,
    showAsent,
    setShowAsent,
    showTempAmb,
    setShowTempAmb,
    showTempHorm,
    setShowTempHorm,
    onOptionsLoaded,
}) => {
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
                const hormOpts = tipos.data.map(t => ({ label: t.tipoHormigon, value: t.idTipoHormigon }));
                setHormigonOpts(hormOpts);
                setFirmaOpts(
                    empleados.data
                        .filter(e => e.firmaElectronicaBase64)
                        .map(e => ({ label: `${e.apellido}, ${e.nombre}`, ...e }))
                );
                if (typeof onOptionsLoaded === 'function') {
                    onOptionsLoaded({
                        clienteOpts: clientes.data.map(c => ({
                            label: c.tipoPersona === 'Física' ? c.nombre : c.razonSocial,
                            value: c.idCliente,
                        })),
                        obraOpts: obras.data.map(o => ({ label: o.nombre, value: o.idObra })),
                        plantaOpts: plantas.data.map(p => ({ label: p.nombre, value: p.idPlanta })),
                        dosifOpts: dosificaciones.data.map(d => ({
                            label: `${d.nombre} (${d.planta?.nombre ?? 'sin planta'})`,
                            value: d.idDosificacion,
                        })),
                        hormigonOpts: hormOpts,
                    });
                }
            } catch (err) {
                console.error('Error cargando opciones:', err);
            }
        };
        fetchData();
    }, [onOptionsLoaded]);

    // Debounce de 400 ms para no disparar un fetch por cada keystroke /
    // selección en cascada (cliente → obra → planta → dosificación).
    useEffect(() => {
        const t = setTimeout(() => { handleApplyFilters(); }, 400);
        return () => clearTimeout(t);
    }, [tempFilters]); // eslint-disable-line react-hooks/exhaustive-deps

    const isMobile = useIsMobile();
    const panelClass = `rpt-filter-panel ${visible && isMobile ? 'mobile-visible' : ''}`;

    // En mobile preservamos el estado interno (fechaDesde/fechaHasta) vía
    // display:none en lugar de desmontar el componente (return null).
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
                <div className="rpt-filter-header-icon rpt-filter-header-icon--fresh">
                    <i className="fa-solid fa-droplet" />
                </div>
                <div className="rpt-filter-header-text">
                    <h2 className="rpt-filter-header-title">Filtros</h2>
                    <p className="rpt-filter-header-subtitle">Muestras en estado fresco</p>
                </div>
            </div>

            {/* Filtros */}
            <div className="rpt-filter-section">
                <h3 className="rpt-filter-section-title">Filtrar por</h3>
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

                    {/* Rango de fechas */}
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
                <div className="rpt-export-buttons rpt-export-buttons--single">
                    <Button
                        label="Exportar PDF"
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
                header="Configurar informe PDF"
                className="rpt-pdf-dialog"
                style={{ width: '90vw', maxWidth: '500px' }}
                dismissableMask
                modal
            >
                <div className="rpt-pdf-dialog-content">
                    <div className="rpt-pdf-options-grid">
                        <div className="rpt-pdf-option-card">
                            <h4 className="rpt-pdf-option-title">
                                <i className="fa-solid fa-table-columns" />
                                Columnas a mostrar
                            </h4>
                            <div className="rpt-pdf-option-list">
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="lote" checked={showLote} onChange={e => setShowLote(e.checked)} />
                                    <label htmlFor="lote">Tamaño de lote</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="aire" checked={showAire} onChange={e => setShowAire(e.checked)} />
                                    <label htmlFor="aire">Aire incorporado</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="asent" checked={showAsent} onChange={e => setShowAsent(e.checked)} />
                                    <label htmlFor="asent">Asentamiento</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="tempamb" checked={showTempAmb} onChange={e => setShowTempAmb(e.checked)} />
                                    <label htmlFor="tempamb">Temperatura ambiente</label>
                                </div>
                                <div className="rpt-pdf-checkbox">
                                    <Checkbox inputId="temphorm" checked={showTempHorm} onChange={e => setShowTempHorm(e.checked)} />
                                    <label htmlFor="temphorm">Temp. del hormigón</label>
                                </div>
                            </div>
                        </div>
                    </div>

                    {/* Firma */}
                    <div className="rpt-pdf-footer-section">
                        <div className="rpt-pdf-input-group">
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
                            exportToPDF(firmaEmpleado);
                            setPdfDialog(false);
                        }}
                    />
                </div>
            </Dialog>
        </aside>
    );
};

export default FreshFilter;