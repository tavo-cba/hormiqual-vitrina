import React, { useEffect, useState } from "react";
import "./agregado.css"; // tu CSS
import axios from "axios";
import { config } from "../../../config/config";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "jspdf-autotable";
import { Button } from "primereact/button";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { InputText } from "primereact/inputtext";
import { Dialog } from "primereact/dialog";
import { useNavigate } from "react-router-dom";
import CellFade from "../empleado/uikit/CellFade";
import AgregadoForm from "./uikit/agregadoForm";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import AgregadoPanel from "./uikit/agregadoPanel";
import { isOnPhone } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";

const AdminAgregado = () => {
    const [agregados, setAgregados] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [editDialog, setEditDialog] = useState(false);
    const [editAgregado, setEditAgregado] = useState(null);

    const [reload, setReload] = useState(false);
    const { searchTerm, setSearchTerm, first, setFirst } = useListParams();
    const [viewDialog, setViewDialog] = useState(false);
    const [viewAgregado, setViewAgregado] = useState(null);

    const navigate = useNavigate();
    const showToast = useToast();

    // Cargar agregados (fino + grueso) en un listado unificado
    const getAgregados = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${config.backendUrl}/api/agregados`, {
                headers: config.headers,
            });
            setAgregados(response.data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        getAgregados();
    }, []);

    useEffect(() => {
        if (reload) {
            getAgregados();
            setReload(false);
        }
    }, [reload]);

    // Abrir modal para crear un nuevo Agregado
    const showDialogEdit = () => {
        setEditAgregado(null);
        setEditDialog(true);
    };

    // Abrir modal para editar un Agregado
    const editarAgregado = (agr) => {
        setEditAgregado(agr);
        setEditDialog(true);
    };

    const mostrarAgregado = (agr) => {
        setViewAgregado(agr);
        setViewDialog(true);
    };
    // Confirmar borrado
    const confirmarBorrado = (agr) => {
        confirmDialog({
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i
                        className="fa-solid fa-triangle-exclamation mb-3"
                        style={{ fontSize: "2.6rem", color: "var(--lightred)" }}
                    ></i>
                    <span>¿Estás seguro que quieres borrar este agregado?</span>
                </div>
            ),
            header: "Borrar agregado",
            defaultFocus: "accept",
            acceptLabel: (
                <span className="mr-2 ml-2">
                    <i className="fa-solid fa-trash mr-2"></i>Borrar
                </span>
            ),
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: () => borrarAgregado(agr),
            reject: null,
        });
    };

    // Borrar agregado
    const borrarAgregado = async (agr) => {
        try {
            setDeleteLoading(true);
            // Este DELETE recibe ?tipoAgregado=Fino o Grueso, o un header
            await axios.delete(`${config.backendUrl}/api/agregados/${agr.id}`, {
                headers: {
                    ...config.headers,
                    "x-tipo-agregado": agr.tipoAgregado,
                },
            });
            setAgregados((prev) => prev.filter((a) => a.id !== agr.id || a.tipoAgregado !== agr.tipoAgregado));
            showToast("success", "Agregado borrado exitosamente");
        } catch (error) {
            console.error(error);
            showToast("error", "Error al borrar el agregado");
        } finally {
            setDeleteLoading(false);
        }
    };

    // Filtro básico por origen o densidad...
    const filteredAgregados = agregados.filter((ag) => {
        const txt =
            `${ag?.nombre ?? ""} ${ag?.origen ?? ""}`
                .toLowerCase();
        return txt.includes(searchTerm.toLowerCase());
    });

    const handlePage = (e) => {
        setFirst(e.first);
    };

    if (loading) {
        return (
            <div className="cover-container w-full h-full flex align-self-center justify-content-center">
                <LoadSpinner />
            </div>
        );
    }

    return (
        <Fade direction="up" duration={500} triggerOnce>
            {/* Diálogo para crear/editar Agregado */}
            <Dialog
                visible={editDialog}
                onHide={() => setEditDialog(false)}
                className="w-11 xl:w-auto h-auto"
            >
                <AgregadoForm
                    setDialogVisible={setEditDialog}
                    editAgregado={editAgregado}
                    reload={reload}
                    setReload={setReload}
                />
            </Dialog>

            <Dialog
                visible={viewDialog}
                onHide={() => setViewDialog(false)}
                className="w-11 xl:w-5"
                header={
                    <h4 className="m-0">
                        <i className="fa-solid fa-hill-rockslide mr-2" />
                        {viewAgregado?.nombre}
                    </h4>
                }
                footer={
                    <div className="flex justify-content-center gap-2">
                        <Button label="Ensayos" icon="fa-solid fa-flask-vial" rounded size="small" severity="info" onClick={() => { setViewDialog(false); navigate(`/calidad/agregados/${viewAgregado.id}/ensayos`); }} />
                        <Button label="Editar" icon="fa-solid fa-pencil" rounded size="small" onClick={() => { setViewDialog(false); navigate(`/calidad/catalogos/agregados/editar/${viewAgregado.tipoAgregado}/${viewAgregado.id}`); }} />
                        <Button label="Borrar" icon="fa-solid fa-trash" rounded severity="danger" size="small" loading={deleteLoading} onClick={() => { setViewDialog(false); confirmarBorrado(viewAgregado); }} />
                    </div>
                }
            >
                <AgregadoPanel agregado={viewAgregado} />
            </Dialog>

            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader icon="fa-solid fa-hill-rockslide" title="Agregados" subtitle="Gestión de agregados y materiales" />
                {
                    agregados.length > 0 && !loading ?
                        <>

                            <div className="flex align-self-end justify-content-between w-full xl:w-auto flex-1">
                                <span className="search-bar-wrapper mr-2">

                                    <InputText
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Buscar agregado..."
                                        title="Buscar por nombre u origen"
                                        className="search-bar"
                                    />
                                </span>
                                <Button
                                    label={isOnPhone ? '' : 'Agregar nuevo'}
                                    rounded
                                    icon="fa-solid fa-plus"
                                    severity="success"
                                    onClick={() => navigate("/calidad/catalogos/agregados/nuevo")}
                                    className="flex mb-2"
                                    size="small"
                                />
                            </div>

                            <DataTable
                                value={filteredAgregados}
                                emptyMessage={<h3>No hay coincidencias con la búsqueda</h3>}
                                rowClassName={(rowData, rowIndex) =>
                                    rowIndex % 2 === 0 ? "even-row" : "odd-row"
                                }
                                stripedRows
                                paginator
                                rows={50}
                                pageLinkSize={4}
                                first={first}
                                onPage={handlePage}
                                className="w-full"
                            >
                                <Column
                                    field="nombre"
                                    header="Nombre"
                                    body={(agr) => (
                                        <CellFade uniqueKey={`nombre-${agr.id}`}>
                                            <span
                                                className="font-bold hover-blue cursor-pointer"
                                                onClick={() => mostrarAgregado(agr)}
                                            >
                                                {agr.nombre}
                                            </span>
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    field="tipoAgregado"
                                    header="Tipo"
                                    body={(agr) => (
                                        <CellFade uniqueKey={`tipo-${agr.id}`}>
                                            {agr.tipoAgregado}
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    field="origen"
                                    header="Origen"
                                    body={(agr) => (
                                        <CellFade uniqueKey={`origen-${agr.id}`}>
                                            {agr.origen}
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    header="Densidad"
                                    body={(agr) => (
                                        <CellFade uniqueKey={`dens-${agr.id}`}>
                                            {agr.densidad}
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    header=""
                                    style={{ width: "90px" }}
                                    body={(agr) => (
                                        <Button
                                            icon="fa-solid fa-flask-vial"
                                            rounded
                                            text
                                            size="small"
                                            tooltip="Ensayos"
                                            tooltipOptions={{ position: "top" }}
                                            onClick={() => navigate(`/calidad/agregados/${agr.id}/ensayos`)}
                                        />
                                    )}
                                />
                            </DataTable>
                        </>
                        :
                        <div className="form-card br-15 flex p-4 xl:p-6 align-items-center justify content-center flex-column align-self-start">
                            <h2 className="text-center mb-4 mt-0">Aún no hay agregados cargados</h2>
                            <small className="text-center">Creá ahora tu primer agregado</small>
                            <span className="button-create mt-2" onClick={() => navigate('/calidad/catalogos/agregados/nuevo')}>
                                <i className="fa-solid fa-plus"></i>
                            </span>
                        </div>

                }

            </div>
        </Fade>

    );
};

export default AdminAgregado;
