import React, { useEffect, useMemo, useState, useRef } from "react";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Dropdown } from "primereact/dropdown";
import { Fade } from "react-awesome-reveal";
import { confirmDialog } from "primereact/confirmdialog";
import { Dialog } from "primereact/dialog";
import axios from "axios";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useNavigate } from "react-router-dom";
import { formatDate, formatNumber, isOnPhone } from "../../../common/functions";
import { useUserContext } from "../../../context/UserContext";
import CellFade from "../empleado/uikit/CellFade";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { SelectButton } from "primereact/selectbutton";
import { useCanPerform } from "../../../lib/roles/useCanPerform";
import { useConfig } from "../../../context/ConfigContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { generarFichaMuestraPdf } from "../muestra/fichaMuestraPdf";
import {
  FORMATO_OPCIONES as ETIQ_FORMATO_OPCIONES,
  imprimirYMarcar as imprimirEtiquetasYMarcar,
  mensajeResultadoEtiquetas,
} from "../../../lib/etiquetasProbeta";

const origenOptions = [
  { label: 'Propias',  value: 'propio' },
  { label: 'Terceros', value: 'tercero' },
  { label: 'Pastones', value: 'paston' },
];

/**
 * Refactor 2026-05-20 — admite render embebido en `MuestrasPage`.
 */
const AdminMuestraTerceros = ({ embedded = false, searchTerm, onSearchChange } = {}) => {
    const [muestras, setMuestras] = useState([]);
    const [loading, setLoading] = useState(false);
    const [delLoad, setDelLoad] = useState(false);
    const [searchLocal, setSearchLocal] = useState("");
    const isSearchControlled = typeof searchTerm === 'string';
    const search = isSearchControlled ? searchTerm : searchLocal;
    const setSearch = isSearchControlled
        ? (v) => onSearchChange?.(typeof v === 'function' ? v(searchTerm) : v)
        : setSearchLocal;
    const [first, setFirst] = useState(0);
    const [page, setPage] = useState(0);
    const [confirmDialogVisible, setConfirmDialogVisible] = useState(false);
    const [selectedMuestra, setSelectedMuestra] = useState(null);
    const [loteNumero, setLoteNumero] = useState(null);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const confirmandoRef = useRef(false);
    const [piletasPlanta, setPiletasPlanta] = useState([]);
    const [idPiletaConfirm, setIdPiletaConfirm] = useState(null);

    // 2026-05-28 — multi-select para imprimir etiquetas QR de las probetas
    // de las muestras tildadas. Mismo patrón que muestra.jsx (Propias).
    const [seleccionMuestras, setSeleccionMuestras] = useState([]);
    const [formatoEtiqueta, setFormatoEtiqueta] = useState('a4');
    const [imprimiendoEtiquetas, setImprimiendoEtiquetas] = useState(false);

    const toast = useToast();
    const navigate = useNavigate();
    const { user } = useUserContext();
    // Migración a matriz canónica de roles (igual que muestras propias en
    // muestra.jsx). Antes usábamos `getActions(ruta)` del MenuContext, que
    // depende de cómo esté configurado el menú del tenant — en entornos de
    // desarrollo donde la ruta no está marcada con todas las acciones se
    // ocultaban "+ Nueva", Editar y Borrar. La matriz central no tiene esa
    // dependencia y refleja el gating real del backend.
    const can = useCanPerform(user);
    const puedeAgregar    = can('muestra.crear');
    const puedeEditar     = can('muestra.editar');
    const puedeConfirmar  = can('muestra.confirmar');
    const puedeBorrar     = can('muestra.eliminar');
    const cfgEmpresa = useConfig();
    const [fichaLoad, setFichaLoad] = useState(false);

    const descargarFicha = async (idMuestraTerceros) => {
        try {
            setFichaLoad(true);
            const { data } = await axios.get(
                `${config.backendUrl}/api/muestras-terceros/${idMuestraTerceros}/ficha`,
                { headers: config.headers }
            );
            const { buffer, filename } = await generarFichaMuestraPdf(data, {
                nombreEmpresa: cfgEmpresa?.nombreEmpresa || 'HormiQual',
                direccion: cfgEmpresa?.direccion,
                logoLink: cfgEmpresa?.logoLink || cfgEmpresa?.logoLightLink || null,
            }, {
                tituloDocumento: 'Ficha de muestra de terceros',
                filenamePrefix: 'Ficha_muestra_terceros',
            });
            const blob = new Blob([buffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast('success', 'Ficha generada');
        } catch (err) {
            console.error('Error generando ficha:', err);
            toast('error', err.response?.data?.error || err.message || 'No se pudo generar la ficha');
        } finally {
            setFichaLoad(false);
        }
    };

    const estadoLabels = {
        false: "Pendiente",
        true: "Confirmada",
    };

    const visiblePlantaIds = useMemo(() => {
        if (user?.plantaIds?.length) return user.plantaIds.map(Number);
        if (user?.allPlantas?.length)
            return user.allPlantas.map((p) => Number(p.idPlanta));
        return [];
    }, [user]);

    const extraerLote = (nombre = '') => {
        if (!nombre) return null;
        const fin = /\d/.test(nombre[2]) ? 3 : 2;
        return parseInt(nombre.substring(1, fin), 10);
    };

    const estadoStyle = (id) => {
        switch (id) {
            case false:
                return { background: "#fee2e2", color: "#b91c1c" };
            case true:
                return { background: "#d1fae5", color: "#047857" };
        }
    };

    const loadMuestras = async () => {
        try {
            setLoading(true);
            const { data } = await axios.get(`${config.backendUrl}/api/muestras-terceros`, {
                headers: config.headers,
            });
            setMuestras(data);
        } catch (error) {
            console.error("Error al cargar muestras:", error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        loadMuestras();
    }, []);

    const abrirConfirmacion = async (muestra) => {
        setSelectedMuestra(muestra);
        setLoteNumero(extraerLote(muestra.probetas?.[0]?.nombre));
        setIdPiletaConfirm(null);
        const plantaId = muestra.planta?.idPlanta;
        if (plantaId) {
            try {
                const { data } = await axios.get(`${config.backendUrl}/api/piletas/planta/${plantaId}`, { headers: config.headers });
                setPiletasPlanta(data);
            } catch { setPiletasPlanta([]); }
        } else {
            setPiletasPlanta([]);
        }
        setConfirmDialogVisible(true);
    };

    const confirmarMuestra = async () => {
        if (!selectedMuestra) return;
        if (confirmandoRef.current) return;
        try {
            confirmandoRef.current = true;
            setConfirmLoading(true);
            const { data } = await axios.put(
                `${config.backendUrl}/api/muestras-terceros/confirmar/${selectedMuestra.idMuestraTerceros}`,
                { loteNumero, idPileta: idPiletaConfirm || null },
                { headers: config.headers }
            );
            setMuestras((prev) =>
                prev.map((m) =>
                    m.idMuestraTerceros === selectedMuestra.idMuestraTerceros ? data : m
                )
            );
            toast("success", "Muestra confirmada");
            setConfirmDialogVisible(false);
        } catch (error) {
            console.error("Error al confirmar muestra:", error);
            toast("error", error.response?.data?.message || 'Error');
        } finally {
            confirmandoRef.current = false;
            setConfirmLoading(false);
        }
    };

    const borrarMuestra = async (id) => {
        try {
            setDelLoad(true);
            await axios.delete(`${config.backendUrl}/api/muestras-terceros/${id}`, {
                headers: config.headers,
            });
            setMuestras((prev) => prev.filter((m) => m.idMuestraTerceros !== id));
            toast("success", "Muestra eliminada");
        } catch (error) {
            console.error("Error al borrar muestra:", error);
            toast("error", "Error al eliminar");
        } finally {
            setDelLoad(false);
        }
    };

    const confirmarBorrado = (id) =>
        confirmDialog({
            header: "Eliminar muestra",
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i className="fa-solid fa-triangle-exclamation mb-3" style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}></i>
                    <span>¿Estás seguro que quieres borrar esta muestra?</span>
                </div>
            ),
            acceptClassName: "p-button-danger",
            acceptLabel: (
                <span>
                    <i className="fa-solid fa-trash mr-2" />
                    Borrar
                </span>
            ),
            accept: () => borrarMuestra(id),
            rejectLabel: "Cancelar",
        });

    const filteredMuestras = muestras.filter((m) => {
        const fecha = formatDate(m.fecha);
        const cliente =
            m.cliente?.tipoPersona === 'Jurídica'
                ? m.cliente?.razonSocial
                : m.cliente?.nombre;
        return (
            fecha.toLowerCase().includes(search.toLowerCase()) ||
            String(m.idMuestraTerceros).includes(search) ||
            cliente?.toLowerCase().includes(search.toLowerCase())
        );
    });
    const muestrasVisibles = useMemo(() => {
        if (!visiblePlantaIds.length) return filteredMuestras;
        return filteredMuestras.filter((p) =>
            visiblePlantaIds.includes(p.planta?.idPlanta)
        );
    }, [filteredMuestras, visiblePlantaIds]);

    const handlePage = (e) => {
        setPage(e.page);
        setFirst(e.first);
    };

    // 2026-05-28 — limpiar selección cuando cambia el filtro de búsqueda.
    useEffect(() => {
        setSeleccionMuestras([]);
    }, [search]);

    /**
     * 2026-05-28 — Etiquetas QR de TODAS las probetas activas de las muestras
     * tildadas. El backend filtra por idMuestraTerceros (origen=tercero) y
     * por estados CURANDO/PENDIENTE; el helper genera el PDF y marca como
     * impresas.
     */
    const imprimirEtiquetasMuestrasSeleccionadas = async () => {
        if (seleccionMuestras.length === 0) {
            toast('warn', 'Seleccioná al menos una muestra');
            return;
        }
        const idsMuestra = seleccionMuestras.map((m) => m.idMuestraTerceros);
        const ejecutar = async () => {
            try {
                setImprimiendoEtiquetas(true);
                const { data: probetas } = await axios.post(
                    `${config.backendUrl}/api/probetas/etiquetas-por-muestras`,
                    { idsMuestra, origen: 'tercero' },
                    { headers: config.headers },
                );
                if (!Array.isArray(probetas) || probetas.length === 0) {
                    toast('warn', 'Las muestras seleccionadas no tienen probetas activas (curando/pendientes)');
                    return;
                }
                const res = await imprimirEtiquetasYMarcar(probetas, { formato: formatoEtiqueta });
                const { severity, mensaje } = mensajeResultadoEtiquetas(res);
                toast(severity, `${mensaje} (${idsMuestra.length} muestra(s))`);
                setSeleccionMuestras([]);
            } catch (err) {
                console.error('Error generando etiquetas QR desde muestras (terceros):', err);
                const data = err.response?.data;
                const msg = data?.detail
                    ? `${data.error || 'Error'}: ${data.detail}`
                    : (data?.error || 'No se pudieron generar las etiquetas');
                toast('error', msg);
            } finally {
                setImprimiendoEtiquetas(false);
            }
        };
        if (idsMuestra.length > 50) {
            confirmDialog({
                header: 'Confirmar impresión masiva',
                message: (
                    <div className="p-3">
                        <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                        Vas a generar etiquetas para las probetas de <strong>{idsMuestra.length} muestras de terceros</strong>.
                        Si querés acotar, deseleccioná muestras antes de continuar.
                    </div>
                ),
                acceptLabel: 'Generar',
                rejectLabel: 'Cancelar',
                acceptClassName: 'p-button-warning',
                accept: ejecutar,
            });
            return;
        }
        ejecutar();
    };

    if (loading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    // Refactor 2026-05-20 — modo embebido en MuestrasPage.
    const Container = embedded ? React.Fragment : Fade;
    const containerProps = embedded ? {} : { direction: "up", duration: 500, triggerOnce: true };

    return (
        <Container {...containerProps}>
            <Dialog
                visible={confirmDialogVisible}
                onHide={() => setConfirmDialogVisible(false)}
                className="w-11 xl:w-4"
            >
                <div className="p-4 flex flex-column">
                    <div className="flex w-full align-items-center">
                        <span className="text-center w-6">Confirmar la siguiente muestra con el lote número:</span>
                        <div className="flex flex-column text-center">
                            <small className="mb-2">Lote n°</small>
                            <InputText value={loteNumero} onChange={(e) => setLoteNumero(e.target.value)} className="lote-input" />
                        </div>
                    </div>
                    {piletasPlanta.length > 0 && (
                        <div className="flex flex-column mt-4">
                            <label className="mb-2">Pileta de curado</label>
                            <Dropdown
                                value={idPiletaConfirm}
                                onChange={(e) => setIdPiletaConfirm(e.value)}
                                options={piletasPlanta.map(pl => ({ label: pl.nombre, value: pl.idPileta }))}
                                placeholder="Seleccionar pileta (opcional)"
                                showClear
                                className="w-full"
                            />
                        </div>
                    )}
                    <div className="flex justify-content-center mt-4 w-full">
                        <Button
                            label="Confirmar"
                            icon="fa-solid fa-check"
                            size="small"
                            rounded
                            severity="success"
                            className="mr-2"
                            loading={confirmLoading}
                            disabled={confirmLoading}
                            onClick={confirmarMuestra}
                        />
                        <Button
                            label="Cancelar"
                            icon="fa-solid fa-xmark"
                            size="small"
                            rounded
                            text
                            severity="danger"
                            onClick={() => setConfirmDialogVisible(false)}
                        />
                    </div>
                </div>
            </Dialog>
            <div className={embedded ? "w-full flex flex-column align-items-start" : "w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0"}>
                {!embedded && (
                <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
                    <PageHeader
                        icon="fa-solid fa-flask-vial"
                        title="Muestras de terceros"
                        subtitle="Gestión de muestras de hormigón de proveedores externos"
                    />
                    <SelectButton
                        value="tercero"
                        options={origenOptions}
                        onChange={(e) => {
                            if (e.value === 'propio') navigate('/calidad/ensayos/muestras');
                            else if (e.value === 'paston') navigate('/calidad/ensayos/muestras-pastones');
                        }}
                        className="mb-2"
                    />
                </div>
                )}

                {muestras.length ? (
                    <>
                        {/* Refactor 2026-05-20 — barra unificada al patrón de Muestras propias:
                            buscador a la izquierda con w-full, botón Nueva a la derecha.
                            2026-05-28 — sumo Dropdown formato + botón Etiquetas QR. */}
                        <div className="flex align-items-center w-full mb-2 gap-2 flex-wrap justify-content-between">
                            <span className="search-bar-wrapper">
                                <InputText
                                    value={search}
                                    onChange={(e) => setSearch(e.target.value)}
                                    placeholder="Buscar muestra..."
                                    title="Buscar por fecha, cliente o ID"
                                    className="search-bar"
                                />
                            </span>
                            <div className="flex align-items-center gap-2 flex-wrap">
                                <Dropdown
                                    value={formatoEtiqueta}
                                    options={ETIQ_FORMATO_OPCIONES}
                                    onChange={(e) => setFormatoEtiqueta(e.value)}
                                    style={{ minWidth: '18rem' }}
                                    tooltip="Formato del PDF de etiquetas"
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label={imprimiendoEtiquetas ? 'Generando…' : 'Etiquetas QR'}
                                    icon="fa-solid fa-qrcode"
                                    outlined
                                    severity="secondary"
                                    size="small"
                                    disabled={seleccionMuestras.length === 0 || imprimiendoEtiquetas}
                                    onClick={imprimirEtiquetasMuestrasSeleccionadas}
                                    tooltip={
                                        seleccionMuestras.length === 0
                                            ? 'Tildá una o más muestras para habilitar la impresión'
                                            : `Imprimir etiquetas QR de todas las probetas activas de las ${seleccionMuestras.length} muestra(s) seleccionada(s)`
                                    }
                                    tooltipOptions={{ position: 'top' }}
                                />
                                <Button
                                    label="Nueva"
                                    icon="fa-solid fa-plus"
                                    rounded
                                    size="small"
                                    onClick={() => navigate('/calidad/ensayos/muestras-terceros/nueva')}
                                    style={{ display: !puedeAgregar ? 'none' : null }}
                                />
                            </div>
                        </div>
                        <DataTable
                            value={muestrasVisibles}
                            emptyMessage={<h3>No hay coincidencias</h3>}
                            stripedRows
                            paginator
                            rows={50}
                            first={first}
                            onPage={handlePage}
                            pageLinkSize={isOnPhone ? 2 : 6}
                            className="w-full"
                            selectionMode="multiple"
                            selection={seleccionMuestras}
                            onSelectionChange={(e) => setSeleccionMuestras(e.value)}
                            dataKey="idMuestraTerceros"
                        >
                            <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
                            <Column header="ID" body={(row) => <CellFade uniqueKey={`id-${page}-${row.idMuestraTerceros}`}>{row.idMuestraTerceros}</CellFade>} />
                            <Column header="Fecha" body={(row) => <CellFade uniqueKey={`fecha-${page}-${row.idMuestraTerceros}`}>{formatDate(row.fecha)}</CellFade>} />
                            <Column header="Cliente" body={(r) => <CellFade uniqueKey={`cliente-${page}-${r.idMuestraTerceros}`}>{r.cliente?.tipoPersona === 'Jurídica' ? r.cliente?.razonSocial : r.cliente?.nombre}</CellFade>} />
                            <Column header="Obra" body={(r) => <CellFade uniqueKey={`obra-${page}-${r.idMuestraTerceros}`}>{r.obra?.nombre}</CellFade>} />
                            <Column header="Planta" body={(r) => <CellFade uniqueKey={`planta-${page}-${r.idMuestraTerceros}`}>{r.planta?.nombre}</CellFade>} />
                            <Column header="Tipo H°" body={(r) => <CellFade uniqueKey={`th-${page}-${r.idMuestraTerceros}`}>{r.tipoHormigon?.tipoHormigon}</CellFade>} />
                            <Column header="Lote" body={(row) => <CellFade uniqueKey={`lote-${page}-${row.idMuestraTerceros}`}>{extraerLote(row.probetas?.[0]?.nombre)}</CellFade>} />
                            <Column header="Cant. Probetas" body={(row) => <CellFade uniqueKey={`cant-${page}-${row.idMuestraTerceros}`}>{formatNumber(row.probetas?.length)}</CellFade>} />
                            <Column header="Estado" body={(row) => (
                                <CellFade uniqueKey={`estado-${page}-${row.idMuestraTerceros}`}>
                                    <span style={{ ...estadoStyle(row.estado), padding: '2px 8px', borderRadius: 4, fontWeight: 550, minWidth: 100, textAlign: 'center' }}>{estadoLabels[row.estado] || '-'}</span>
                                </CellFade>
                            )} />
                            <Column header="Acciones" body={(row) => (
                                <CellFade uniqueKey={`acciones-${page}-${row.idMuestraTerceros}`}>
                                    <div className="font-bold flex w-full justify-content-center">
                                        {!row.estado && puedeConfirmar && (
                                            <Button
                                                rounded
                                                icon="fa-solid fa-check"
                                                className="mr-2"
                                                size="small"
                                                severity="success"
                                                tooltip="Confirmar muestra (asigna número de lote)"
                                                tooltipOptions={{ position: 'top' }}
                                                onClick={() => abrirConfirmacion(row)}
                                            />
                                        )}
                                        <Button
                                            rounded
                                            icon="fa-solid fa-pencil"
                                            className="mr-2"
                                            size="small"
                                            onClick={() => navigate(`/calidad/ensayos/muestras-terceros/editar/${row.idMuestraTerceros}`)}
                                            style={{ display: !puedeEditar ? 'none' : null }}
                                        />
                                        <Button
                                            rounded
                                            icon="fa-solid fa-file-pdf"
                                            className="mr-2"
                                            size="small"
                                            severity="info"
                                            loading={fichaLoad}
                                            tooltip="Ficha de muestra (PDF)"
                                            tooltipOptions={{ position: 'top' }}
                                            onClick={() => descargarFicha(row.idMuestraTerceros)}
                                        />
                                        <Button
                                            rounded
                                            icon="fa-solid fa-trash"
                                            style={{ display: !puedeBorrar ? 'none' : null }}
                                            severity="danger"
                                            size="small"
                                            loading={delLoad}
                                            onClick={() => confirmarBorrado(row.idMuestraTerceros)}
                                        />
                                    </div>
                                </CellFade>
                            )} />
                        </DataTable>
                    </>
                ) : (
                    <div
                        className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center cursor-pointer"
                        onClick={() => navigate('/calidad/ensayos/muestras-terceros/nueva')}
                        style={{ display: !puedeAgregar ? 'none' : null }}
                    >
                        <h2 className="mb-2 mt-0">Aún no hay muestras</h2>
                        <span>Crea tu primera muestra</span>
                    </div>
                )}
            </div>
        </Container>
    );
};

export default AdminMuestraTerceros;