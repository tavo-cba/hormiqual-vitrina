import React, { useEffect, useState } from "react";
import "./fibra.css";
import axios from "axios";
import { config } from "../../../config/config";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { confirmDialog } from "primereact/confirmdialog";
import { useToast } from "../../../context/ToastContext";
import { InputText } from "primereact/inputtext";
import { Dialog } from "primereact/dialog";
import { useNavigate } from "react-router-dom";
import CellFade from "../empleado/uikit/CellFade";
import FibraForm from "./uikit/fibraForm";
import FibraPanel from "./uikit/fibraPanel";
import { useMenuContext } from "../../../context/MenuContext";
import { isOnPhone } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";


const AdminFibra = () => {
  const [fibras, setFibras] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editFibra, setEditFibra] = useState(null);

  const [reload, setReload] = useState(false);
  const { searchTerm, setSearchTerm, first, setFirst } = useListParams();
  const [showDialog, setShowDialog] = useState(false);
  const [showFibra, setShowFibra] = useState(null);

  const navigate = useNavigate();
  const showToast = useToast();
  const { getActions } = useMenuContext();
  const { puedeAgregar, puedeEditar, puedeBorrar } = getActions('/calidad/catalogos/fibras');

  /* ──────────────────────────────────────────────── */
  /* API calls                                        */
  /* ──────────────────────────────────────────────── */
  const getFibras = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${config.backendUrl}/api/fibras`, {
        headers: config.headers,
      });
      setFibras(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getFibras();
  }, []);

  useEffect(() => {
    if (reload) {
      getFibras();
      setReload(false);
    }
  }, [reload]);

  /* ──────────────────────────────────────────────── */
  /* Helpers                                          */
  /* ──────────────────────────────────────────────── */
  const borrarFibra = async (id) => {
    try {
      setDeleteLoading(true);
      await axios.delete(`${config.backendUrl}/api/fibras/${id}`, {
        headers: config.headers,
      });
      setFibras((prev) => prev.filter((a) => a.idFibra !== id));
      showToast("success", "Fibra borrada exitosamente");
    } catch (err) {
      console.error(err);
      showToast("error", "Error al borrar la fibra");
    } finally {
      setDeleteLoading(false);
    }
  };

  const confirmarBorrado = (id) => {
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i
            className="fa-solid fa-triangle-exclamation mb-3"
            style={{ fontSize: "2.6rem", color: "var(--lightred)" }}
          ></i>
          <span>¿Estás seguro que quieres borrar esta fibra?</span>
        </div>
      ),
      header: "Borrar fibra",
      defaultFocus: "accept",
      acceptLabel: (
        <span className="mr-2 ml-2">
          <i className="fa-solid fa-trash mr-2"></i>Borrar
        </span>
      ),
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: () => borrarFibra(id),
    });
  };

  const mostrarFibra = (fibra) => {
    setShowFibra(fibra);
    setShowDialog(true);
  };

  const filtered = fibras.filter((a) =>
    (a.marca || "").toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  /* ──────────────────────────────────────────────── */
  /* JSX                                              */
  /* ──────────────────────────────────────────────── */
  return (
    <Fade direction="up" duration={500} triggerOnce>
      {/* Diálogo create / edit */}
      <Dialog
        visible={editDialog}
        onHide={() => setEditDialog(false)}
        className="w-11 xl:w-auto h-auto"
      >
        <FibraForm
          setDialogVisible={setEditDialog}
          editFibra={editFibra}
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
            <i className="fa-solid fa-lines-leaning mr-2" />{showFibra?.marca}
          </h4>
        }
        footer={
          <div className="flex justify-content-center gap-2">
            <Button
              label="Editar"
              icon="fa-solid fa-pencil"
              rounded
              size="small"
              style={{ display: !puedeEditar ? 'none' : null }}
              onClick={() => {
                setShowDialog(false);
                navigate(`/calidad/catalogos/fibras/editar/${showFibra.idFibra}`);
              }}
            />
            <Button
              label="Borrar"
              icon="fa-solid fa-trash"
              rounded
              severity="danger"
              size="small"
              loading={deleteLoading}
              style={{ display: !puedeBorrar ? 'none' : null }}
              onClick={() => {
                setShowDialog(false);
                confirmarBorrado(showFibra.idFibra);
              }}
            />
          </div>
        }
      >
        <FibraPanel fibra={showFibra} />
      </Dialog>

      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader icon="fa-solid fa-lines-leaning" title="Fibras" subtitle="Gestión de fibras de refuerzo" />

        {filtered.length > 0 ? (
          <>
            <div className="flex align-self-end justify-content-between w-full xl:w-auto flex-1">
              <span className="search-bar-wrapper mr-2">

                <InputText
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar fibra..."
                  title="Buscar por marca o nombre"
                  className="search-bar"
                />
              </span>
              <Button
                label={isOnPhone ? '' : 'Agregar nueva'}
                rounded
                icon="fa-solid fa-plus"
                severity="success"
                onClick={() => navigate("/calidad/catalogos/fibras/nuevo")}
                className="flex mb-2"
                style={{ display: !puedeAgregar ? 'none' : null }}
                size="small"
              />
            </div>

            <DataTable
              value={filtered}
              stripedRows
              rowClassName={(rowData, rowIndex) =>
                rowIndex % 2 === 0 ? "even-row" : "odd-row"
              }
              paginator
              rows={50}
              pageLinkSize={4}
              first={first}
              onPage={(e) => setFirst(e.first)}
              emptyMessage={<h3>No hay coincidencias con la búsqueda</h3>}
              className="w-full"
            >
              <Column
                sortable
                field="marca"
                header="Nombre comercial"
                body={(row) => (
                  <CellFade uniqueKey={`marca-${row.idFibra}`}>
                    <span
                      className="font-bold hover-blue cursor-pointer"
                      onClick={() => mostrarFibra(row)}
                    >
                      {row.marca}
                    </span>
                  </CellFade>
                )}
              />
              <Column
                field="fabrica"
                header="Fábrica"
                body={(row) => (
                  <CellFade uniqueKey={`fabrica-${row.idFibra}`}>{row.fabrica}</CellFade>
                )}
              />
              <Column
                field="funcion"
                header="Función"
                body={(row) => (
                  <CellFade uniqueKey={`funcion-${row.idFibra}`}>
                    {row.funcion || "—"}
                  </CellFade>
                )}
              />
            </DataTable>
          </>
        ) : (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center">
            <h2 className="text-center mb-4 mt-0">Aún no hay fibras cargadas</h2>
            <small className="text-center">Creá ahora tu primer fibra</small>
            <span
              className="button-create mt-2"
              onClick={() => navigate("/calidad/catalogos/fibras/nuevo")}
            >
              <i className="fa-solid fa-plus"></i>
            </span>
          </div>
        )}
      </div>
    </Fade>
  );
};

export default AdminFibra;
