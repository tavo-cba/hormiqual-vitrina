import React, { useEffect, useState } from "react";
import "./cemento.css"; // tu CSS de Cementos
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

// Puedes reusar tu CellFade, ajusta la ruta según tu estructura
import CellFade from "../empleado/uikit/CellFade";
import CementoForm from "./uikit/cementoForm";
import CementoPanel from "./uikit/cementoPanel";
import { isOnPhone } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";


const AdminCemento = () => {
    const [cementos, setCementos] = useState([]);
    const [loading, setLoading] = useState(false);
    const [deleteLoading, setDeleteLoading] = useState(false);
    const [editDialog, setEditDialog] = useState(false);
    const [editCemento, setEditCemento] = useState(null);

    const [showDialog, setShowDialog] = useState(false);
    const [showCemento, setShowCemento] = useState(null);

    const [reload, setReload] = useState(false);
    const { searchTerm, setSearchTerm, first, setFirst } = useListParams();

    const navigate = useNavigate();
    const showToast = useToast();

    // Obtener todos los cementos
    const getCementos = async () => {
        try {
            setLoading(true);
            const response = await axios.get(`${config.backendUrl}/api/cementos`, {
                headers: config.headers,
            });
            setCementos(response.data || []);
        } catch (error) {
            console.error(error);
        } finally {
            setLoading(false);
        }
    };

    useEffect(() => {
        getCementos();
    }, []);

    useEffect(() => {
        if (reload) {
            getCementos();
            setReload(false);
        }
    }, [reload]);

    // Crear Cemento en modal
    const showDialogEdit = () => {
        setEditCemento(null);
        setEditDialog(true);
    };

    // Editar Cemento en modal
    const editarCemento = (cemento) => {
        setEditCemento(cemento);
        setEditDialog(true);
    };

    const mostrarCemento = (cemento) => {
        setShowCemento(cemento);
        setShowDialog(true);
    };
    // Confirmar borrado
    const confirmarBorrado = (cem) => {
        confirmDialog({
            message: (
                <div className="p-4 flex flex-column align-items-center overflow-hidden">
                    <i
                        className="fa-solid fa-triangle-exclamation mb-3"
                        style={{ fontSize: "2.6rem", color: "var(--lightred)" }}
                    ></i>
                    <span>¿Estás seguro que quieres borrar este Cemento?</span>
                </div>
            ),
            header: "Borrar Cemento",
            defaultFocus: "accept",
            acceptLabel: (
                <span className="mr-2 ml-2">
                    <i className="fa-solid fa-trash mr-2"></i>Borrar
                </span>
            ),
            acceptClassName: "p-button-danger",
            rejectLabel: "Cancelar",
            accept: () => borrarCemento(cem),
            reject: null,
        });
    };

    // Borrar Cemento
    const borrarCemento = async (cem) => {
        try {
            setDeleteLoading(true);
            await axios.delete(`${config.backendUrl}/api/cementos/${cem.idCemento}`, {
                headers: config.headers,
            });
            // Remover localmente
            setCementos((prev) => prev.filter((c) => c.idCemento !== cem.idCemento));
            showToast("success", "Cemento borrado exitosamente");
        } catch (error) {
            console.error(error);
            showToast("error", "Error al borrar el Cemento");
        } finally {
            setDeleteLoading(false);
        }
    };

    // Filtrar por nombreComercial, por ejemplo
    const filteredCementos = cementos.filter((c) => {
        const txtNombre = c.nombreComercial?.toLowerCase() || "";
        return txtNombre.includes(searchTerm.toLowerCase());
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
            {/* Modal para crear/editar */}
            <Dialog
                visible={editDialog}
                onHide={() => setEditDialog(false)}
                className="w-11 xl:w-auto h-auto"
            >
                <CementoForm
                    setDialogVisible={setEditDialog}
                    editCemento={editCemento}
                    reload={reload}
                    setReload={setReload}
                />
            </Dialog>

            <Dialog
                visible={showDialog}
                onHide={() => setShowDialog(false)}
                className="w-11 xl:w-5"
                header={
                    <h4 className="m-0">
                        <i className="fa-solid fa-industry mr-2" />
                        {showCemento?.nombreComercial}
                    </h4>
                }
                footer={
                    <div className="flex justify-content-center gap-2">
                        <Button
                            label="Editar"
                            icon="fa-solid fa-pencil"
                            rounded
                            size="small"
                            onClick={() => {
                                setShowDialog(false);
                                navigate(`/calidad/catalogos/cementos/editar/${showCemento.idCemento}`);
                            }}
                        />
                        <Button
                            label="Borrar"
                            icon="fa-solid fa-trash"
                            rounded
                            severity="danger"
                            size="small"
                            loading={deleteLoading}
                            onClick={() => {
                                setShowDialog(false);
                                confirmarBorrado(showCemento);
                            }}
                        />
                    </div>
                }
            >
                <CementoPanel cemento={showCemento} />
            </Dialog>

            <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
                <PageHeader icon="fa-solid fa-industry" title="Cementos" subtitle="Gestión de cementos" />
                {cementos.length > 0 && !loading ? (
                    <>
                        <div className="flex align-self-end justify-content-between w-full xl:w-auto flex-1">
                            <span className="search-bar-wrapper mr-2">

                                <InputText
                                    value={searchTerm}
                                    onChange={(e) => setSearchTerm(e.target.value)}
                                    placeholder="Buscar cemento..."
                                    title="Buscar por nombre comercial"
                                    className="search-bar"
                                />
                            </span>
                            <Button
                                label={isOnPhone ? '' : 'Agregar nuevo'}
                                rounded
                                icon="fa-solid fa-plus"
                                severity="success"
                                onClick={() => navigate("/calidad/catalogos/cementos/nuevo")}
                                className="flex mb-2"
                                size="small"
                            />
                        </div>

                        <DataTable
                            value={filteredCementos}
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
                                field="nombreComercial"
                                header="Nombre comercial"
                                body={(c) => (
                                    <CellFade uniqueKey={`nombreCom-${c.idCemento}`}>
                                        <span
                                            className="font-bold hover-blue cursor-pointer"
                                            onClick={() => mostrarCemento(c)}
                                        >
                                            {c.nombreComercial}
                                        </span>
                                    </CellFade>
                                )}
                            />
                            <Column
                                field="fabricante"
                                header="Fabricante"
                                body={(c) => (
                                    <CellFade uniqueKey={`fabricante-${c.idCemento}`}>
                                        {c.fabricante}
                                    </CellFade>
                                )}
                            />
                            <Column
                                field="composicion"
                                header="Composición"
                                body={(c) => (
                                    <CellFade uniqueKey={`comp-${c.idCemento}`}>
                                        {c.composicion}
                                    </CellFade>
                                )}
                            />

                        </DataTable>
                    </>
                ) : (
                    <div className="form-card br-15 flex p-4 xl:p-6 align-items-center justify-content-center flex-column align-self-start">
                        <h2 className="text-center mb-4 mt-0">Aún no hay cementos cargados</h2>
                        <small className="text-center">Crea ahora tu primer Cemento</small>
                        <span
                            className="button-create mt-2"
                            onClick={() => navigate("/calidad/catalogos/cementos/nuevo")}
                        >
                            <i className="fa-solid fa-plus"></i>
                        </span>
                    </div>
                )}
            </div>
        </Fade>
    );
};

export default AdminCemento;
