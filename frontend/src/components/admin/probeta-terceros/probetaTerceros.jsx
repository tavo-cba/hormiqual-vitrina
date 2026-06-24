import React, { useEffect, useMemo, useState } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { Fade } from "react-awesome-reveal";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { useNavigate, useSearchParams } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDate, formatDateDMY } from "../../../common/functions";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { Checkbox } from "primereact/checkbox";
import { SelectButton } from "primereact/selectbutton";
import { useMenuContext } from "../../../context/MenuContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import ProbetaDetailDialog from "../probeta/uikit/ProbetaDetailDialog";
import QrScanner from "../../../common/components/QrScanner/QrScanner";
import { downloadEtiquetasProbetaQr } from "../../calidad/reportes/etiquetasProbetaQrPdf";
import { downloadPlanillaCampoMoldeo } from "../../calidad/reportes/planillaCampoMoldeoPdf";
// Refactor 2026-05-20 — unificar estilos de columna Estado con probetas propias.
// Antes este archivo tenía `estadoStyle` inline con colores hex hardcoded
// (sin dark mode); ahora usa la misma clase CSS canónica que probeta.jsx.
import { ESTADO_PROBETA_LABEL, ESTADO_PROBETA_CLASS, ESTADO_PROBETA_FILTRO_OPCIONES } from "../../../lib/constants/estadoProbeta";
import "../probeta/probeta.css";

const origenOptions = [
  { label: 'Propio', value: 'propio' },
  { label: 'Tercero', value: 'tercero' },
];

/**
 * Refactor 2026-05-20 — admite render embebido en `ProbetasPage` con
 * buscador compartido. Props:
 *  - embedded: si true, oculta PageHeader y SelectButton (los pone el wrapper).
 *  - searchTerm / onSearchChange: si vienen, el buscador es controlado.
 */
const AdminProbetaTerceros = ({ embedded = false, searchTerm, onSearchChange } = {}) => {
    const [probetas, setProbetas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [searchLocal, setSearchLocal] = useState("");
    const isSearchControlled = typeof searchTerm === 'string';
    const search = isSearchControlled ? searchTerm : searchLocal;
    const setSearch = isSearchControlled
        ? (v) => onSearchChange?.(typeof v === 'function' ? v(searchTerm) : v)
        : setSearchLocal;
    const [criteria, setCriteria] = useState({ nombre: true, cliente: true, fechaMuestra: true, fechaRotura: true, fechaEnsayo: true });
    const [searchParams] = useSearchParams();
    // Refactor 2026-05-20 — default 'ALL' por consistencia con la pestaña Propias
    // (antes era 'PEND', que ocultaba todo lo demás al entrar a la pestaña).
    const [filtro, setFiltro] = useState(searchParams.get("estado")?.toUpperCase() || "ALL");

    // Refactor 2026-05-20 — rango de fechas de rotura prevista, igual que Propias.
    const [rangoFechaRotura, setRangoFechaRotura] = useState(null); // [Date, Date] | null
    const [qrScannerOpen, setQrScannerOpen] = useState(false);

    const toast = useToast();
    const navigate = useNavigate();
    const { user } = useUserContext();
    const [delLoad, setDelLoad] = useState(false);
    const [detailId, setDetailId] = useState(null);
    const { getActions } = useMenuContext();
    const { puedeEditar, puedeBorrar } = getActions('/calidad/ensayos/probetas-terceros');

    const setRangoHoy = () => {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        setRangoFechaRotura([hoy, hoy]);
    };
    const setRangoProximaSemana = () => {
        const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
        const en7 = new Date(hoy); en7.setDate(en7.getDate() + 7);
        setRangoFechaRotura([hoy, en7]);
    };
    const limpiarRango = () => setRangoFechaRotura(null);


    const visiblePlantaIds = useMemo(() => {
        if (user?.plantaIds?.length) return user.plantaIds.map(Number);
        if (user?.allPlantas?.length) return user.allPlantas.map((p) => Number(p.idPlanta));
        return [];
    }, [user]);

    const loadProbetas = async () => {
        try {
            setLoading(true);
            const { data } = await axios.get(`${config.backendUrl}/api/probetas/terceros`, { headers: config.headers });
            setProbetas(data);
        } catch {
            toast("error", "No se pudieron cargar las probetas");
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadProbetas();
    }, []);

    /* ---------- borrar ---------- */
    const borrarProbeta = async (id) => {
        try {
            setDelLoad(true);
            await axios.delete(`${config.backendUrl}/api/probetas/${id}`, {
                headers: config.headers,
            });
            setProbetas((prev) => prev.filter((p) => p.idProbeta !== id));
            toast("success", "Probeta eliminada");
        } catch (error) {
            console.error("Error al borrar probeta:", error);
            toast("error", "Error al eliminar");
        } finally {
            setDelLoad(false);
        }
    };

    const confirmarBorrado = (id) =>
        confirmDialog({
            header: "Eliminar probeta",
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}></i>
                    <span>¿Estás seguro que quieres borrar esta probeta?</span>
                </div>
            ),
            acceptClassName: "p-button-danger",
            acceptLabel: (
                <span>
                    <i className="fa-solid fa-trash mr-2" />
                    Borrar
                </span>
            ),
            accept: () => borrarProbeta(id),
            rejectLabel: "Cancelar",
        });

    const byFechaAsc = (a, b) => new Date(a.fechaRotura) - new Date(b.fechaRotura);
    const byFechaDesc = (a, b) => -byFechaAsc(a, b);

    const probetasVisibles = useMemo(() => {
        if (!visiblePlantaIds.length) return probetas;
        return probetas.filter((p) => visiblePlantaIds.includes(p.muestraTerceros?.planta?.idPlanta));
    }, [probetas, visiblePlantaIds]);

    const getListado = () => {
        switch (filtro) {
            case "PEND":
                return probetasVisibles.filter((p) => p.idEstadoProbeta === 2).sort(byFechaAsc);
            case "CUR":
                return probetasVisibles.filter((p) => p.idEstadoProbeta === 1).sort(byFechaAsc);
            case "ENS":
                return probetasVisibles.filter((p) => p.idEstadoProbeta === 3).sort(byFechaDesc);
            case "DES":
                return probetasVisibles.filter((p) => p.idEstadoProbeta === 4);
            case "PER":
                return probetasVisibles.filter((p) => p.idEstadoProbeta === 5);
            default:
                return [...probetasVisibles].sort(byFechaAsc);
        }
    };

    // Refactor 2026-05-20 — aplicamos primero el filtro de rango de rotura prevista
    // (igual que Propias) y después el filtro textual. Esto sirve para acotar la
    // lista al día/semana del laboratorio y para la impresión de etiquetas QR.
    const listado = getListado().filter((p) => {
        if (!rangoFechaRotura || !rangoFechaRotura[0]) return true;
        if (!p.fechaRotura) return false;
        const fr = new Date(p.fechaRotura); fr.setHours(0, 0, 0, 0);
        const desde = new Date(rangoFechaRotura[0]); desde.setHours(0, 0, 0, 0);
        const hasta = rangoFechaRotura[1] ? new Date(rangoFechaRotura[1]) : new Date(rangoFechaRotura[0]);
        hasta.setHours(23, 59, 59, 999);
        return fr >= desde && fr <= hasta;
    }).filter((p) => {
        const q = search.toLowerCase();
        if (!q) return true;
        let match = false;
        if (criteria.nombre && p.nombre.toLowerCase().includes(q)) match = true;
        if (criteria.cliente) {
            const cliente = p.muestraTerceros?.cliente;
            const clienteNombre = cliente?.tipoPersona === 'Jurídica'
                ? cliente?.razonSocial
                : [cliente?.nombre, cliente?.apellido].filter(Boolean).join(' ') || cliente?.nombre;
            if (clienteNombre?.toLowerCase().includes(q)) match = true;
        }
        if (criteria.fechaMuestra && formatDate(p.muestraTerceros?.fecha).toLowerCase().includes(q)) match = true;
        if (criteria.fechaRotura && formatDateDMY(p.fechaRotura).toLowerCase().includes(q)) match = true;
        if (criteria.fechaEnsayo && formatDate(p.ensayo?.fechaEnsayo).toLowerCase().includes(q)) match = true;
        return match;
    });

    const cols = [
        { header: "Fecha muestra", body: (p) => formatDate(p.muestraTerceros?.fecha), frozen: true },
        {
            header: "Nombre",
            body: (p) => (
                <div className="flex align-items-center">
                    <span className="font-bold mr-1 hover-blue cursor-pointer" onClick={() => setDetailId(p.idProbeta)}>{p.nombre}</span>
                    <Button
                        rounded
                        icon="fa-solid fa-pencil"
                        size="small"
                        style={{ scale: '0.8', display: !puedeEditar ? 'none' : null }}
                        onClick={() => navigate(`/calidad/ensayos/probetas-terceros/editar/${p.idProbeta}`)}
                    />
                </div>
            ),
            frozen: true,
        },
        { header: "Cliente", body: (p) => <span>{p.muestraTerceros?.cliente?.tipoPersona === 'Jurídica' ? p.muestraTerceros?.cliente?.razonSocial : p.muestraTerceros?.cliente?.nombre}</span> },
        { header: "Tipo H°", body: (p) => <span className="font-bold">{p.muestraTerceros?.tipoHormigon?.tipoHormigon}</span> },
        { header: "Rotura prevista", body: (p) => formatDateDMY(p.fechaRotura) },
        { header: "Rotura real", body: (p) => formatDate(p.ensayo?.fechaEnsayo) || "—" },
        { header: "Planta", body: (p) => <span className="font-medium">{p.muestraTerceros?.planta?.nombre}</span>, sortable: true },
        { header: "Estado", body: (p) => <span className={ESTADO_PROBETA_CLASS[p.idEstadoProbeta] || 'estado-badge'}>{ESTADO_PROBETA_LABEL[p.idEstadoProbeta] || '-'}</span> },
        { header: "Muestra", body: (p) => <div className="flex align-items-center justify-content-center"><span className="flex-1 truncate font-bold hover-blue cursor-pointer" onClick={() => navigate(`/calidad/ensayos/muestras-terceros/editar/${p.muestraTerceros?.idMuestraTerceros}`)}>{p.muestraTerceros?.idMuestraTerceros}</span></div> },
        ...(puedeBorrar ? [{
            // Refactor 2026-05-20 — header explícito "Acciones" (antes vacío)
            // por consistencia con las pestañas Propias y Pastones.
            header: "Acciones",
            body: (p) => (
                <Button
                    rounded
                    icon="fa-solid fa-trash"
                    size="small"
                    severity="danger"
                    text
                    loading={delLoad}
                    onClick={() => confirmarBorrado(p.idProbeta)}
                />
            ),
        }] : []),
    ];

    if (loading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    // Refactor 2026-05-20 — modo embebido en ProbetasPage (sin header propio).
    const Container = embedded ? React.Fragment : Fade;
    const containerProps = embedded ? {} : { direction: "up", duration: 500, triggerOnce: true };

    return (
        <Container {...containerProps}>
            <div className={embedded ? "w-full flex flex-column align-items-start" : "w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0"}>
                {!embedded && (
                    <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
                        <PageHeader
                            icon="fa-solid fa-flask"
                            title="Probetas de terceros"
                            subtitle="Gestión de probetas de proveedores externos"
                        />
                        <SelectButton
                            value="tercero"
                            options={origenOptions}
                            onChange={(e) => { if (e.value === 'propio') navigate('/calidad/ensayos/probetas'); }}
                            className="mb-2"
                        />
                    </div>
                )}
                {/* Refactor 2026-05-20 — toolbar reorganizada en 2 filas semánticas
                    (igual que Probetas Propias):
                      (1) BÚSQUEDA: input + criterios.
                      (2) FILTROS Y ACCIONES: Estado, Rotura prevista, Etiquetas QR, Escanear. */}
                <div className="form-card p-3 br-10 flex flex-column w-full gap-3">
                    {/* ─── FILA 1 — BÚSQUEDA ─────────────────────────────────────── */}
                    <div className="flex flex-column md:flex-row md:flex-wrap md:align-items-center gap-3">
                        <div className="flex align-items-center flex-1" style={{ minWidth: '18rem', maxWidth: '40rem' }}>
                            <i className="fa-solid fa-search mr-2 text-500" />
                            <span className="search-bar-wrapper flex-1">
                                <InputText value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Buscar probeta..." title="Buscar por código o muestra" className="w-full br-7 search-bar" />
                            </span>
                        </div>
                        <div className="flex flex-wrap gap-3 align-items-center">
                            <small className="text-500 font-semibold">Buscar en:</small>
                            <div className="flex align-items-center">
                                <Checkbox inputId="crit-nombre" checked={criteria.nombre} onChange={(e) => setCriteria((prev) => ({ ...prev, nombre: e.checked }))} />
                                <label htmlFor="crit-nombre" className="ml-2 cursor-pointer text-sm">Nombre</label>
                            </div>
                            <div className="flex align-items-center">
                                <Checkbox inputId="crit-cliente" checked={criteria.cliente} onChange={(e) => setCriteria((prev) => ({ ...prev, cliente: e.checked }))} />
                                <label htmlFor="crit-cliente" className="ml-2 cursor-pointer text-sm">Cliente</label>
                            </div>
                            <div className="flex align-items-center">
                                <Checkbox inputId="crit-fecha" checked={criteria.fechaMuestra} onChange={(e) => setCriteria((prev) => ({ ...prev, fechaMuestra: e.checked }))} />
                                <label htmlFor="crit-fecha" className="ml-2 cursor-pointer text-sm">Fecha muestra</label>
                            </div>
                            <div className="flex align-items-center">
                                <Checkbox inputId="crit-rotura" checked={criteria.fechaRotura} onChange={(e) => setCriteria((prev) => ({ ...prev, fechaRotura: e.checked }))} />
                                <label htmlFor="crit-rotura" className="ml-2 cursor-pointer text-sm">Rotura prevista</label>
                            </div>
                            <div className="flex align-items-center">
                                <Checkbox inputId="crit-ensayo" checked={criteria.fechaEnsayo} onChange={(e) => setCriteria((prev) => ({ ...prev, fechaEnsayo: e.checked }))} />
                                <label htmlFor="crit-ensayo" className="ml-2 cursor-pointer text-sm">Rotura real</label>
                            </div>
                        </div>
                    </div>

                    {/* Divider sutil entre secciones. */}
                    <div style={{ height: 1, background: 'var(--surface-border)' }} />

                    {/* ─── FILA 2 — FILTROS + ACCIONES ──────────────────────────── */}
                    <div className="flex flex-column lg:flex-row lg:align-items-end lg:justify-content-between gap-3">
                        <div className="flex flex-column md:flex-row md:flex-wrap gap-3 align-items-stretch md:align-items-end">
                            <div className="flex flex-column" style={{ minWidth: '12rem' }}>
                                <label className="text-xs text-500 font-semibold mb-1 uppercase">Estado</label>
                                <Dropdown
                                    value={filtro}
                                    onChange={(e) => {
                                        setFiltro(e.value);
                                        navigate(`/calidad/ensayos/probetas-terceros?estado=${e.value}`, { replace: true });
                                    }}
                                    options={ESTADO_PROBETA_FILTRO_OPCIONES}
                                    className="w-full br-7"
                                />
                            </div>
                            <div className="flex flex-column" style={{ minWidth: '20rem' }}>
                                <label className="text-xs text-500 font-semibold mb-1 uppercase">Rotura prevista</label>
                                <div className="p-inputgroup flex-1">
                                    <Calendar
                                        value={rangoFechaRotura}
                                        onChange={(e) => setRangoFechaRotura(e.value)}
                                        selectionMode="range"
                                        readOnlyInput
                                        showIcon
                                        placeholder="Rango de fechas"
                                        dateFormat="dd/mm/yy"
                                        className="flex-1"
                                    />
                                    <Button icon="fa-solid fa-calendar-day" outlined tooltip="Hoy" tooltipOptions={{ position: 'top' }} onClick={setRangoHoy} />
                                    <Button label="7d" outlined tooltip="Hoy + próximos 7 días" tooltipOptions={{ position: 'top' }} onClick={setRangoProximaSemana} />
                                    {rangoFechaRotura && (
                                        <Button icon="fa-solid fa-xmark" outlined severity="secondary" tooltip="Limpiar rango" tooltipOptions={{ position: 'top' }} onClick={limpiarRango} />
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Bloque de acciones (derecha). Mismo set y orden que Propias y
                            Pastones para consistencia visual: Planilla → Etiquetas pendientes
                            → Procedimiento → Etiquetas QR → Escanear. */}
                        <div className="flex flex-column">
                            <label className="text-xs text-500 font-semibold mb-1 uppercase">Acciones</label>
                            <div className="flex flex-wrap gap-2">
                                <Button
                                    label="Planilla en blanco"
                                    icon="fa-solid fa-print"
                                    outlined
                                    severity="secondary"
                                    onClick={() => downloadPlanillaCampoMoldeo({
                                        tenantNombre: user?.tenantNombre ?? '',
                                        plantaNombre: visiblePlantaIds.length === 1
                                            ? (user?.allPlantas?.find((p) => Number(p.idPlanta) === Number(visiblePlantaIds[0]))?.nombre ?? '')
                                            : '',
                                    })}
                                    tooltip="Imprimir planilla de moldeo en blanco para completar a mano en obra"
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label="Etiquetas pendientes"
                                    icon="fa-solid fa-tag"
                                    outlined
                                    severity="secondary"
                                    onClick={() => navigate('/calidad/ensayos/probetas/etiquetas-pendientes')}
                                    tooltip="Listar y reimprimir etiquetas QR de probetas sin etiqueta impresa"
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label="Procedimiento etiquetas"
                                    icon="fa-solid fa-book"
                                    outlined
                                    severity="secondary"
                                    onClick={() => navigate('/calidad/ensayos/probetas/etiquetado-doc')}
                                    tooltip="Guía operativa de etiquetado: materiales, pegado, fallback con marcador"
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label="Etiquetas QR"
                                    icon="fa-solid fa-qrcode"
                                    outlined
                                    severity="secondary"
                                    disabled={!listado || listado.length === 0}
                                    onClick={() => {
                                        const items = (listado || []).map((p) => ({
                                            idProbeta: p.idProbeta,
                                            nombre: p.nombre,
                                            codigo: p.codigo,
                                            tipoHormigon: p.muestraTerceros?.tipoHormigon?.tipoHormigon,
                                            diasRotura: p.diasRotura,
                                            fechaConfeccion: p.muestraTerceros?.fecha,
                                            fechaRotura: p.fechaRotura,
                                            fcMpa: p.muestraTerceros?.tipoHormigon?.fcMpa,
                                            cliente: p.muestraTerceros?.cliente?.tipoPersona === 'Jurídica'
                                                ? p.muestraTerceros?.cliente?.razonSocial
                                                : [p.muestraTerceros?.cliente?.apellido, p.muestraTerceros?.cliente?.nombre].filter(Boolean).join(', ') || p.muestraTerceros?.cliente?.nombre,
                                            obra: p.muestraTerceros?.obra?.nombre,
                                            planta: p.muestraTerceros?.planta?.nombre,
                                        }));
                                        const generar = () => {
                                            downloadEtiquetasProbetaQr(items, {
                                                baseUrl: `${window.location.origin}/p/`,
                                            }).catch((err) => {
                                                console.error('Error generando etiquetas QR:', err);
                                                toast('error', 'No se pudieron generar las etiquetas');
                                            });
                                        };
                                        const n = listado.length;
                                        if (n > 50) {
                                            const hojas = Math.ceil(n / 21);
                                            confirmDialog({
                                                header: 'Confirmar impresión masiva',
                                                message: (
                                                    <div className="p-3">
                                                        <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                                                        Vas a generar etiquetas para <strong>{n} probetas</strong> ({hojas} hojas A4).
                                                    </div>
                                                ),
                                                acceptLabel: 'Generar',
                                                rejectLabel: 'Cancelar',
                                                acceptClassName: 'p-button-warning',
                                                accept: generar,
                                            });
                                            return;
                                        }
                                        generar();
                                    }}
                                    tooltip="Imprimir etiquetas QR (3×7 por hoja A4) de las probetas listadas"
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label="Escanear"
                                    icon="fa-solid fa-camera"
                                    outlined
                                    severity="info"
                                    onClick={() => setQrScannerOpen(true)}
                                    tooltip="Escanear etiqueta QR de una probeta"
                                    tooltipOptions={{ position: 'top' }}
                                />
                            </div>
                        </div>
                    </div>
                </div>
                <DataTable value={listado} emptyMessage="Sin registros" stripedRows scrollable paginator rows={50} className="w-full mt-3">
                    {cols.map((c, i) => (<Column sortable={c.sortable} key={i} header={c.header} body={c.body} frozen={c.frozen} />))}
                </DataTable>

                <ProbetaDetailDialog
                    visible={!!detailId}
                    onHide={() => setDetailId(null)}
                    idProbeta={detailId}
                />

                {/* Scanner QR interno (mismo flujo que en Propias). */}
                <QrScanner
                    visible={qrScannerOpen}
                    onClose={() => setQrScannerOpen(false)}
                    onScan={(text) => {
                        setQrScannerOpen(false);
                        try {
                            const url = new URL(text);
                            if (url.origin === window.location.origin) {
                                navigate(`${url.pathname}${url.search}${url.hash}`);
                                return;
                            }
                            window.open(text, '_blank', 'noopener,noreferrer');
                        } catch {
                            const idNum = Number(String(text).trim());
                            if (Number.isFinite(idNum) && idNum > 0) {
                                setDetailId(idNum);
                            } else {
                                toast('warn', `QR no reconocido: ${String(text).slice(0, 60)}`);
                            }
                        }
                    }}
                />
            </div>
        </Container>
    );
};

export default AdminProbetaTerceros;