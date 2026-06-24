import React, { useEffect, useMemo, useState } from "react";
import "./equipo.css";
import axios from "axios";
import { config } from "../../../config/config";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { InputText } from "primereact/inputtext";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { useNavigate } from "react-router-dom";
import { useMenuContext } from "../../../context/MenuContext";
import { isOnPhone, simpleDate } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";

const CATEGORY_META = {
    'Camión Tractor': { icon: 'fa-truck', tone: 'accent' },
    'Camión Mixer': { icon: 'fa-truck-monster', tone: 'warning' },
    'Camión Volcador': { icon: 'fa-dumpster', tone: 'info' },
    'Semirremolque': { icon: 'fa-trailer', tone: 'indigo' },
    'Acoplado': { icon: 'fa-trailer', tone: 'purple' },
    'Maquinaria': { icon: 'fa-tractor', tone: 'success' },
    'Grupo electrógeno': { icon: 'fa-bolt', tone: 'warning' },
    'Camioneta': { icon: 'fa-truck-pickup', tone: 'info' },
    'Automóvil': { icon: 'fa-car', tone: 'accent' },
    'Bomba pluma': { icon: 'fa-pump-medical', tone: 'danger' },
    'Bomba de arrastre': { icon: 'fa-water', tone: 'info' },
};

const getCategoryMeta = (name) => CATEGORY_META[name] || { icon: 'fa-truck', tone: 'muted' };

const AdminEquipo = () => {
    const [equipos, setEquipos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const { searchTerm, setSearchTerm, first, setFirst } = useListParams();
    const [categoriaFilter, setCategoriaFilter] = useState(null);

    const [viewDialog, setViewDialog] = useState(false);
    const [viewEquipo, setViewEquipo] = useState(null);

    const navigate = useNavigate();
    const showToast = useToast();
    const { getActions } = useMenuContext();
    const { puedeAgregar, puedeEditar, puedeBorrar } = getActions('/flota/equipos');
    const todosPermisos = puedeAgregar && puedeEditar && puedeBorrar;

    const getEquipos = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${config.backendUrl}/api/equipos`, { headers: config.headers });
            setEquipos(response.data || []);
        } catch (error) {
            console.error('Error cargando equipos:', error);
            showToast('error', 'Error al cargar equipos');
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        getEquipos();
    }, []);

    const descargarExcel = async () => {
        try {
            const response = await axios.get(`${config.backendUrl}/api/equipos/excel`, {
                headers: config.headers,
                responseType: "arraybuffer",
            });
            const blob = new Blob([response.data], {
                type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            });
            const contentDisposition = response.headers["content-disposition"];
            const fileNameMatch = contentDisposition?.match(/filename="?([^";]+)"?/i);
            const fileName = fileNameMatch?.[1] || "equipos.xlsx";
            const url = window.URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.setAttribute("download", fileName);
            document.body.appendChild(link);
            link.click();
            link.remove();
            window.URL.revokeObjectURL(url);
            showToast("success", "Descarga iniciada");
        } catch (error) {
            console.error('Error descargando Excel:', error);
            showToast("error", "Error al descargar el listado de equipos");
        }
    };

    const openNew = () => {
        navigate('/flota/equipos/nuevo');
    };

    const openEdit = (equipo) => {
        navigate(`/flota/equipos/editar/${equipo.idVehiculo}`);
    };

    const mostrarDocumentacion = (equipo) => {
        navigate(`/admin/archivo/2/${equipo.idVehiculo}`);
    };

    const mostrarEquipo = (equipo) => {
        setViewEquipo(equipo);
        setViewDialog(true);
    };

    const confirmarBorrado = (equipo) => {
        confirmDialog({
            header: "Eliminar equipo",
            message: (
                <div className="eq-confirm-body">
                    <div className="eq-confirm-icon">
                        <i className="fa-solid fa-triangle-exclamation"></i>
                    </div>
                    <div className="eq-confirm-text">
                        <strong>¿Eliminar este equipo?</strong>
                        <span>{equipo.patente || equipo.interno || equipo.marca || 'Equipo'} — Esta acción no se puede deshacer.</span>
                    </div>
                </div>
            ),
            defaultFocus: "reject",
            acceptLabel: (<span><i className="fa-solid fa-trash mr-2"></i>Eliminar</span>),
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: () => borrarEquipo(equipo),
        });
    };

    const borrarEquipo = async (equipo) => {
        try {
            setDeleteLoading(true);
            await axios.delete(`${config.backendUrl}/api/equipos/${equipo.idVehiculo}`, { headers: config.headers });
            setEquipos((prev) => prev.filter((e) => e.idVehiculo !== equipo.idVehiculo));
            showToast("success", "Equipo eliminado");
        } catch (error) {
            console.error('Error eliminando equipo:', error);
            showToast("error", "Error al eliminar el equipo");
        } finally {
            setDeleteLoading(false);
        }
    };

    const categoriaOptions = useMemo(() => {
        const set = new Set();
        equipos.forEach(e => { if (e.categoria?.nombre) set.add(e.categoria.nombre); });
        return [...set].sort().map(c => ({ label: c, value: c }));
    }, [equipos]);

    const filteredEquipos = useMemo(() => {
        const term = searchTerm.toLowerCase();
        return equipos.filter((eq) => {
            if (categoriaFilter && eq.categoria?.nombre !== categoriaFilter) return false;
            if (!term) return true;
            const textToSearch = [eq.marca, eq.modelo, eq.patente, eq.interno, eq.categoria?.nombre, eq.descripcion]
                .filter(Boolean)
                .join(" ")
                .toLowerCase();
            return textToSearch.includes(term);
        });
    }, [equipos, searchTerm, categoriaFilter]);

    const stats = useMemo(() => {
        const sinPatente = equipos.filter(e => !e.patente).length;
        const rtoProximo = equipos.filter(e => {
            if (!e.vencimientoRto) return false;
            const diff = (new Date(e.vencimientoRto) - new Date()) / (1000 * 60 * 60 * 24);
            return diff >= 0 && diff <= 30;
        }).length;
        return {
            total: equipos.length,
            sinPatente,
            rtoProximo,
        };
    }, [equipos]);

    // Identificador primario del equipo: patente > interno > "Sin identificador"
    const primaryLabel = (eq) => {
        if (eq.patente) return { text: eq.patente, kind: 'patente' };
        if (eq.interno) return { text: eq.interno, kind: 'interno' };
        return { text: 'Sin identificar', kind: 'none' };
    };

    const equipoCellTemplate = (eq) => {
        const cat = eq.categoria?.nombre;
        const meta = getCategoryMeta(cat);
        const primary = primaryLabel(eq);
        const subtitle = [eq.marca, eq.modelo].filter(Boolean).join(' ');
        return (
            <div className="eq-equipo-cell" onClick={() => mostrarEquipo(eq)} role="button">
                <div className={`eq-equipo-avatar eq-tone-${meta.tone}`}>
                    <i className={`fa-solid ${meta.icon}`}></i>
                </div>
                <div className="eq-equipo-meta">
                    <div className="eq-equipo-primary">
                        <span className={`eq-equipo-name ${primary.kind === 'none' ? 'sin-identificar' : ''}`}>
                            {primary.text}
                        </span>
                        {primary.kind === 'interno' && (
                            <span className="eq-equipo-tag" title="Equipo sin patente — mostrando número interno">INT</span>
                        )}
                        {primary.kind === 'none' && (
                            <span className="eq-equipo-tag warn" title="Sin patente ni interno">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                                Falta ID
                            </span>
                        )}
                    </div>
                    {subtitle && <span className="eq-equipo-sub">{subtitle}</span>}
                </div>
            </div>
        );
    };

    const categoriaTemplate = (eq) => {
        const cat = eq.categoria?.nombre;
        if (!cat) return <span className="eq-dim">—</span>;
        const meta = getCategoryMeta(cat);
        return (
            <span className={`eq-categoria-badge eq-tone-${meta.tone}`}>
                <i className={`fa-solid ${meta.icon}`}></i>
                {cat}
            </span>
        );
    };

    const marcaModeloTemplate = (eq) => {
        const value = [eq.marca, eq.modelo].filter(Boolean).join(' ');
        if (!value) return <span className="eq-dim">—</span>;
        return <span className="eq-marca">{value}</span>;
    };

    const internoTemplate = (eq) => eq.interno
        ? <span className="eq-interno">{eq.interno}</span>
        : <span className="eq-dim">—</span>;

    const rtoTemplate = (eq) => {
        if (!eq.vencimientoRto) return <span className="eq-dim">—</span>;
        const diff = Math.ceil((new Date(eq.vencimientoRto) - new Date()) / (1000 * 60 * 60 * 24));
        const tone = diff < 0 ? 'danger' : diff <= 30 ? 'warning' : 'success';
        return (
            <span className={`eq-rto-pill eq-tone-${tone}`}>
                <i className="fa-regular fa-calendar"></i>
                {simpleDate(eq.vencimientoRto)}
            </span>
        );
    };

    const accionesTemplate = (equipo) => (
        <div className="eq-row-actions">
            {puedeEditar && (
                <Button
                    icon="fa-solid fa-pencil"
                    rounded
                    text
                    size="small"
                    severity="info"
                    tooltip="Editar"
                    tooltipOptions={{ position: 'top' }}
                    onClick={(e) => { e.stopPropagation(); openEdit(equipo); }}
                />
            )}
            {todosPermisos && (
                <Button
                    icon="fa-solid fa-folder-open"
                    rounded
                    text
                    size="small"
                    severity="secondary"
                    tooltip="Documentación"
                    tooltipOptions={{ position: 'top' }}
                    onClick={(e) => { e.stopPropagation(); mostrarDocumentacion(equipo); }}
                />
            )}
            {puedeBorrar && (
                <Button
                    icon="fa-solid fa-trash"
                    rounded
                    text
                    size="small"
                    severity="danger"
                    loading={deleteLoading}
                    tooltip="Eliminar"
                    tooltipOptions={{ position: 'top' }}
                    onClick={(e) => { e.stopPropagation(); confirmarBorrado(equipo); }}
                />
            )}
        </div>
    );

    const handlePage = (e) => {
        setFirst(e.first);
    };

    const renderEmpty = () => (
        <div className="eq-empty-state">
            <div className="eq-empty-icon">
                <i className="fa-solid fa-truck"></i>
            </div>
            <span className="eq-empty-title">
                {searchTerm || categoriaFilter ? 'Sin resultados' : 'No hay equipos cargados'}
            </span>
            <span className="eq-empty-sub">
                {searchTerm || categoriaFilter
                    ? 'Ajustá los filtros o la búsqueda.'
                    : 'Creá tu primer equipo para comenzar a gestionar la flota.'}
            </span>
            {!searchTerm && !categoriaFilter && puedeAgregar && (
                <Button
                    label="Agregar equipo"
                    icon="fa-solid fa-plus"
                    rounded
                    size="small"
                    className="mt-2"
                    onClick={openNew}
                />
            )}
        </div>
    );

    return (
        <Fade direction="up" duration={500} triggerOnce>
            {/* View Dialog */}
            <Dialog
                visible={viewDialog}
                onHide={() => setViewDialog(false)}
                className="eq-view-dialog"
                style={{ width: isOnPhone ? '95vw' : '680px' }}
                dismissableMask
                header={
                    viewEquipo ? (
                        <div className="eq-dialog-header">
                            <div className="eq-dialog-header-left">
                                <div className={`eq-dialog-header-icon eq-tone-${getCategoryMeta(viewEquipo.categoria?.nombre).tone}`}>
                                    <i className={`fa-solid ${getCategoryMeta(viewEquipo.categoria?.nombre).icon}`}></i>
                                </div>
                                <div className="eq-dialog-header-text">
                                    <span className="eq-dialog-title">
                                        {primaryLabel(viewEquipo).text}
                                    </span>
                                    <span className="eq-dialog-subtitle">
                                        {viewEquipo.categoria?.nombre || '—'}
                                        {[viewEquipo.marca, viewEquipo.modelo].filter(Boolean).length > 0 && ` · ${[viewEquipo.marca, viewEquipo.modelo].filter(Boolean).join(' ')}`}
                                    </span>
                                </div>
                            </div>
                        </div>
                    ) : <span>Detalles del equipo</span>
                }
                footer={
                    <div className="eq-dialog-footer">
                        <div className="eq-dialog-footer-left">
                            {todosPermisos && (
                                <Button
                                    label="Documentación"
                                    icon="fa-solid fa-folder-open"
                                    rounded
                                    outlined
                                    size="small"
                                    onClick={() => mostrarDocumentacion(viewEquipo)}
                                />
                            )}
                        </div>
                        <div className="eq-dialog-footer-right">
                            {puedeBorrar && (
                                <Button
                                    icon="fa-solid fa-trash"
                                    rounded
                                    outlined
                                    severity="danger"
                                    size="small"
                                    loading={deleteLoading}
                                    tooltip="Eliminar"
                                    tooltipOptions={{ position: 'top' }}
                                    onClick={() => { setViewDialog(false); confirmarBorrado(viewEquipo); }}
                                />
                            )}
                            {puedeEditar && (
                                <Button
                                    label="Editar"
                                    icon="fa-solid fa-pencil"
                                    rounded
                                    severity="info"
                                    size="small"
                                    onClick={() => { setViewDialog(false); openEdit(viewEquipo); }}
                                />
                            )}
                        </div>
                    </div>
                }
            >
                {viewEquipo && (
                    <div className="eq-view-content">
                        {/* Identificación */}
                        <div className="eq-view-section">
                            <div className="eq-view-section-title">
                                <i className="fa-solid fa-id-card"></i>
                                Identificación
                            </div>
                            <div className="eq-view-grid">
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Patente</span>
                                    <span className="eq-view-value">{viewEquipo.patente || <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Interno</span>
                                    <span className="eq-view-value">{viewEquipo.interno || <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Marca</span>
                                    <span className="eq-view-value">{viewEquipo.marca || <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Modelo</span>
                                    <span className="eq-view-value">{viewEquipo.modelo || <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Año</span>
                                    <span className="eq-view-value">{viewEquipo.anio ? new Date(viewEquipo.anio).getFullYear() : <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Color</span>
                                    <span className="eq-view-value">{viewEquipo.color || <span className="eq-dim">—</span>}</span>
                                </div>
                            </div>
                        </div>

                        {/* Especificaciones */}
                        <div className="eq-view-section">
                            <div className="eq-view-section-title">
                                <i className="fa-solid fa-gauge-high"></i>
                                Operación
                            </div>
                            <div className="eq-view-grid">
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Kilómetros</span>
                                    <span className="eq-view-value">
                                        {viewEquipo.kilometros != null ? `${Number(viewEquipo.kilometros).toLocaleString('es-AR')} km` : <span className="eq-dim">—</span>}
                                    </span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Horas</span>
                                    <span className="eq-view-value">
                                        {viewEquipo.horas != null ? `${Number(viewEquipo.horas).toLocaleString('es-AR')} hs` : <span className="eq-dim">—</span>}
                                    </span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Capacidad</span>
                                    <span className="eq-view-value">{viewEquipo.capacidad || <span className="eq-dim">—</span>}</span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Potencia</span>
                                    <span className="eq-view-value">{viewEquipo.potencia || <span className="eq-dim">—</span>}</span>
                                </div>
                            </div>
                        </div>

                        {/* RTO */}
                        <div className="eq-view-section">
                            <div className="eq-view-section-title">
                                <i className="fa-solid fa-calendar-check"></i>
                                Revisión técnica
                            </div>
                            <div className="eq-view-grid">
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Vencimiento RTO</span>
                                    <span className="eq-view-value">
                                        {viewEquipo.vencimientoRto ? rtoTemplate(viewEquipo) : <span className="eq-dim">—</span>}
                                    </span>
                                </div>
                                <div className="eq-view-field">
                                    <span className="eq-view-label">Turno RTO</span>
                                    <span className="eq-view-value">
                                        {viewEquipo.turnoRto ? simpleDate(viewEquipo.turnoRto) : <span className="eq-dim">—</span>}
                                    </span>
                                </div>
                            </div>
                        </div>

                        {viewEquipo.descripcion && (
                            <div className="eq-view-section">
                                <div className="eq-view-section-title">
                                    <i className="fa-solid fa-file-lines"></i>
                                    Descripción
                                </div>
                                <div className="eq-view-description">
                                    {viewEquipo.descripcion}
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </Dialog>

            <div className="eq-container md:pt-0">
                <PageHeader
                    icon="fa-solid fa-truck"
                    title="Equipos"
                    subtitle="Gestión de vehículos y equipamiento de la flota"
                    className="mb-0"
                />

                {/* Hero */}
                <div className="eq-hero">
                    <div className="eq-stats">
                        <div className="eq-stat-card total">
                            <div className="eq-stat-icon">
                                <i className="fa-solid fa-truck"></i>
                            </div>
                            <div className="eq-stat-content">
                                <span className="eq-stat-label">Equipos totales</span>
                                <div className="eq-stat-row">
                                    <span className="eq-stat-count">{stats.total}</span>
                                    <span className="eq-stat-unit">{stats.total === 1 ? 'equipo' : 'equipos'}</span>
                                </div>
                            </div>
                        </div>
                        <div className={`eq-stat-card warning ${stats.rtoProximo === 0 ? 'is-empty' : ''}`}>
                            <div className="eq-stat-icon">
                                <i className="fa-solid fa-calendar-check"></i>
                            </div>
                            <div className="eq-stat-content">
                                <span className="eq-stat-label">RTO próximo</span>
                                <div className="eq-stat-row">
                                    <span className="eq-stat-count">{stats.rtoProximo}</span>
                                    <span className="eq-stat-unit">vence en 30 días</span>
                                </div>
                            </div>
                        </div>
                        <div className={`eq-stat-card alert ${stats.sinPatente === 0 ? 'is-empty' : ''}`}>
                            <div className="eq-stat-icon">
                                <i className="fa-solid fa-triangle-exclamation"></i>
                            </div>
                            <div className="eq-stat-content">
                                <span className="eq-stat-label">Sin patente</span>
                                <div className="eq-stat-row">
                                    <span className="eq-stat-count">{stats.sinPatente}</span>
                                    <span className="eq-stat-unit">{stats.sinPatente === 1 ? 'equipo' : 'equipos'}</span>
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="eq-hero-actions">
                        <Button
                            label={isOnPhone ? null : 'Descargar'}
                            icon="fa-solid fa-file-excel"
                            rounded
                            outlined
                            severity="secondary"
                            size="small"
                            onClick={descargarExcel}
                            tooltip="Descargar listado Excel"
                            tooltipOptions={{ position: 'bottom' }}
                        />
                        {puedeAgregar && (
                            <Button
                                label="Nuevo equipo"
                                icon="fa-solid fa-plus"
                                rounded
                                onClick={openNew}
                            />
                        )}
                    </div>
                </div>

                {/* Toolbar */}
                <div className="eq-toolbar">
                    <div className="eq-search-wrapper">
                        <i className="fa-solid fa-magnifying-glass"></i>
                        <InputText
                            value={searchTerm}
                            onChange={(e) => setSearchTerm(e.target.value)}
                            placeholder="Buscar por patente, interno, marca, modelo o categoría…"
                            className="eq-search-input"
                        />
                        {searchTerm && (
                            <button
                                type="button"
                                className="eq-search-clear"
                                onClick={() => setSearchTerm('')}
                                title="Limpiar"
                            >
                                <i className="fa-solid fa-xmark"></i>
                            </button>
                        )}
                    </div>
                    <div className="eq-toolbar-divider" />
                    <div className="eq-toolbar-filter">
                        <Dropdown
                            value={categoriaFilter}
                            options={categoriaOptions}
                            onChange={(e) => setCategoriaFilter(e.value)}
                            placeholder="Todas las categorías"
                            showClear
                            className="w-full"
                        />
                    </div>
                    <div className="eq-results-count">
                        {filteredEquipos.length}
                        {(searchTerm || categoriaFilter) && filteredEquipos.length !== equipos.length ? ` de ${equipos.length}` : ''}
                        {' '}
                        {filteredEquipos.length === 1 ? 'equipo' : 'equipos'}
                    </div>
                </div>

                {/* Table */}
                <div className="eq-table-wrapper">
                    <DataTable
                        value={filteredEquipos}
                        loading={loading}
                        paginator={filteredEquipos.length > 10}
                        rows={20}
                        rowsPerPageOptions={[10, 20, 50, 100]}
                        first={first}
                        onPage={handlePage}
                        stripedRows
                        responsiveLayout="scroll"
                        emptyMessage={renderEmpty()}
                        className="eq-datatable"
                    >
                        <Column
                            field="patente"
                            header="Equipo"
                            body={equipoCellTemplate}
                            sortable
                            style={{ minWidth: '280px' }}
                        />
                        <Column
                            field="categoria.nombre"
                            header="Categoría"
                            body={categoriaTemplate}
                            sortable
                            style={{ minWidth: '180px' }}
                        />
                        <Column
                            field="marca"
                            header="Marca / Modelo"
                            body={marcaModeloTemplate}
                            sortable
                            style={{ minWidth: '180px' }}
                        />
                        <Column
                            field="interno"
                            header="Interno"
                            body={internoTemplate}
                            sortable
                            style={{ minWidth: '130px' }}
                        />
                        <Column
                            field="vencimientoRto"
                            header="RTO"
                            body={rtoTemplate}
                            sortable
                            style={{ minWidth: '160px' }}
                        />
                        <Column header="" body={accionesTemplate} style={{ width: '160px', textAlign: 'right' }} />
                    </DataTable>
                </div>
            </div>
        </Fade>
    );
};

export default AdminEquipo;
