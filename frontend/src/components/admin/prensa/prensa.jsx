import React, { useEffect, useState } from "react";
import "./prensa.css";                  // Tu CSS para estilos
import axios from "axios";
import { config } from "../../../config/config";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
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
import PrensaForm from "./uikit/prensaForm";
import PrensaPanel from "./uikit/prensaPanel";
import { formatDate, isOnPhone } from "../../../common/functions";
import { useMenuContext } from "../../../context/MenuContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";

const AdminPrensa = () => {
    const [prensas, setPrensas] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [editDialog, setEditDialog] = useState(false);
    const [editPrensa, setEditPrensa] = useState(null);

    const [showDialog, setShowDialog] = useState(false);
    const [showPrensa, setShowPrensa] = useState(null);

    const [reload, setReload] = useState(false);
    const { searchTerm, setSearchTerm, first, setFirst } = useListParams();

    const navigate = useNavigate();
    const showToast = useToast();
    const { getActions } = useMenuContext();
    const { puedeAgregar, puedeEditar, puedeBorrar } = getActions('/admin/prensas');
    const todosPermisos = puedeAgregar && puedeEditar && puedeBorrar;

    // Obtener todas las prensas
    const getPrensas = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${config.backendUrl}/api/prensas`, {
                headers: config.headers,
            });
            setPrensas(response.data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        getPrensas();
    }, []);

    useEffect(() => {
        if (reload) {
            getPrensas();
            setReload(false);
        }
    }, [reload]);

    // Abrir diálogo para crear una nueva prensa
    const showDialogEdit = () => {
        setEditPrensa(null);
        setEditDialog(true);
    };

    // Abrir diálogo para editar una prensa existente
    const editarPrensa = (prensa) => {
        setEditPrensa(prensa);
        setEditDialog(true);
    };
    const mostrarPrensa = (prensa) => {
        setShowPrensa(prensa);
        setShowDialog(true);
    };
    const mostrarDocumentacion = (prensa) => {
        navigate(`/admin/archivo/4/${prensa.idPrensa}`);
    };
    // Confirmar borrado
    const confirmarBorrado = (idPrensa) => {
        confirmDialog({
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i
                        className="fa-solid fa-triangle-exclamation mb-3"
                        style={{ fontSize: "2.6rem", color: "var(--lightred)" }}
                    ></i>
                    <span>¿Estás seguro que quieres borrar esta prensa?</span>
                </div>
            ),
            header: "Borrar prensa",
            defaultFocus: "accept",
            acceptLabel: (
                <span className="mr-2 ml-2">
                    <i className="fa-solid fa-trash mr-2"></i>Borrar
                </span>
            ),
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: () => borrarPrensa(idPrensa),
            reject: null,
        });
    };

    // Borrar prensa
    const borrarPrensa = async (idPrensa) => {
        try {
            setDeleteLoading(true);
            await axios.delete(`${config.backendUrl}/api/prensas/${idPrensa}`, {
                headers: config.headers,
            });

            // Eliminar del state
            setPrensas((prev) => prev.filter((p) => p.idPrensa !== idPrensa));
            showToast("success", "Prensa borrada exitosamente");
        } catch (error) {
            console.error(error);
            showToast("error", "Error al borrar la prensa");
        } finally {
            setDeleteLoading(false);
        }
    };

    // Filtrado por nombre
    const filteredPrensas = prensas.filter((p) => {
        const nombre = p.nombre?.toLowerCase() || "";
        return nombre.includes(searchTerm.toLowerCase());
    });

    // Manejador de cambio de página
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
            {/* Diálogo para crear/editar una prensa */}
            <Dialog
                visible={editDialog}
                onHide={() => setEditDialog(false)}
                className="w-11 xl:w-auto h-auto"
            >
                <PrensaForm
                    setDialogVisible={setEditDialog}
                    editPrensa={editPrensa}
                    reload={reload}
                    setReload={setReload}
                />
            </Dialog>
            <Dialog
                visible={showDialog}
                onHide={() => setShowDialog(false)}
                className="w-11 xl:w-5"
                header={<h4 className="m-0"><i className="fa-solid fa-cube mr-2"></i>Detalle de la prensa</h4>}
                footer={
                    <div className="flex justify-content-center gap-2">
                        {todosPermisos && (
                            <Button label="Ver documentación" icon="fa-solid fa-folder-open" severity="secondary" rounded size="small" onClick={() => { navigate(`/admin/archivo/4/${showPrensa.idPrensa}`) }} />
                        )}
                        <Button
                            label="Editar"
                            icon="fa-solid fa-pencil"
                            rounded
                            size="small"
                            style={{ display: !puedeEditar ? 'none' : null }}
                            onClick={() => { setShowDialog(false); navigate(`/admin/prensas/editar/${showPrensa?.idPrensa}`); }}
                        />
                        <Button
                            label="Borrar"
                            icon="fa-solid fa-trash"
                            rounded
                            severity="danger"
                            size="small"
                            loading={deleteLoading}
                            style={{ display: !puedeBorrar ? 'none' : null }}
                            onClick={() => { setShowDialog(false); confirmarBorrado(showPrensa.idPrensa); }}
                        />
                    </div>
                }
            >
                <PrensaPanel prensa={showPrensa} />
            </Dialog>

            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader icon="fa-solid fa-cube" title="Prensas" subtitle="Gestión de prensas de laboratorio" />
                {
                    prensas.length > 0 && !loading ?
                        <>
                            <div className="flex align-self-end justify-content-between w-full xl:w-auto flex-1">
                                <span className="search-bar-wrapper mr-2">

                                    <InputText
                                        value={searchTerm}
                                        onChange={(e) => setSearchTerm(e.target.value)}
                                        placeholder="Buscar prensa..."
                                        title="Buscar por nombre o modelo"
                                        className="search-bar"
                                    />
                                </span>
                                <Button
                                    label={isOnPhone ? '' : 'Agregar nueva'}
                                    rounded
                                    icon="fa-solid fa-plus"
                                    severity="success"
                                    onClick={() => navigate("/admin/prensas/nuevo")}
                                    className="flex mb-2"
                                    style={{ display: !puedeAgregar ? 'none' : null }}
                                    size="small"
                                />
                            </div>

                            <DataTable
                                value={filteredPrensas}
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
                                    sortable
                                    field="nombre"
                                    header="Nombre"
                                    body={(rowData) => (
                                        <CellFade uniqueKey={`prensa-nombre-${rowData.idPrensa}`}>
                                            <span className="font-bold hover-blue cursor-pointer" onClick={() => mostrarPrensa(rowData)}>
                                                {rowData.nombre}
                                            </span>
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    field="marca"
                                    header="Marca"
                                    body={(rowData) => (
                                        <CellFade uniqueKey={`prensa-marca-${rowData.idPrensa}`}>
                                            {rowData.marca || "—"}
                                        </CellFade>
                                    )}
                                />
                                <Column
                                    field="modelo"
                                    header="Modelo"
                                    body={(rowData) => (
                                        <CellFade uniqueKey={`prensa-modelo-${rowData.idPrensa}`}>
                                            {rowData.modelo || "—"}
                                        </CellFade>
                                    )}
                                />
                            </DataTable>
                        </>
                        :
                        <div className="form-card br-15 flex p-4 xl:p-6 align-items-center justify content-center flex-column align-self-start">
                            <h2 className="text-center mb-4 mt-0">Aún no hay prensas cargadas</h2>
                            <small className="text-center">Creá ahora tu primer prensa</small>
                            <span className="button-create mt-2" style={{ display: !puedeAgregar ? 'none' : null }} onClick={() => navigate('/admin/prensas/nuevo')}>
                                <i className="fa-solid fa-plus"></i>
                            </span>
                        </div>

                }

            </div>
        </Fade>
    );
};

export default AdminPrensa;
