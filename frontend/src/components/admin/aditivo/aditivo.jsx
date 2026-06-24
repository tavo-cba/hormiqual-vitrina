import React, { useEffect, useState } from "react";
import "./aditivo.css";
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
import AditivoForm from "./uikit/aditivoForm";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import AditivoPanel from "./uikit/aditivoPanel";
import { isOnPhone } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";

const AdminAditivo = () => {
  const [aditivos, setAditivos] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editAditivo, setEditAditivo] = useState(null);
  const [viewDialog, setViewDialog] = useState(false);
  const [viewAditivo, setViewAditivo] = useState(null);

  const [reload, setReload] = useState(false);
  const { searchTerm, setSearchTerm, first, setFirst } = useListParams();

  const navigate = useNavigate();
  const showToast = useToast();

  /* ──────────────────────────────────────────────── */
  /* API calls                                        */
  /* ──────────────────────────────────────────────── */
  const getAditivos = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${config.backendUrl}/api/aditivos`, {
        headers: config.headers,
      });
      setAditivos(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    getAditivos();
  }, []);

  useEffect(() => {
    if (reload) {
      getAditivos();
      setReload(false);
    }
  }, [reload]);

  /* ──────────────────────────────────────────────── */
  /* Helpers                                          */
  /* ──────────────────────────────────────────────── */
  const borrarAditivo = async (id) => {
    try {
      setDeleteLoading(true);
      await axios.delete(`${config.backendUrl}/api/aditivos/${id}`, {
        headers: config.headers,
      });
      setAditivos((prev) => prev.filter((a) => a.idAditivo !== id));
      showToast("success", "Aditivo borrado exitosamente");
    } catch (err) {
      console.error(err);
      showToast("error", "Error al borrar el aditivo");
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
          <span>¿Estás seguro que quieres borrar este aditivo?</span>
        </div>
      ),
      header: "Borrar aditivo",
      defaultFocus: "accept",
      acceptLabel: (
        <span className="mr-2 ml-2">
          <i className="fa-solid fa-trash mr-2"></i>Borrar
        </span>
      ),
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: () => borrarAditivo(id),
    });
  };
  const mostrarAditivo = (a) => {
    setViewAditivo(a);
    setViewDialog(true);
  };

  const filtered = aditivos.filter((a) =>
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
        <AditivoForm
          setDialogVisible={setEditDialog}
          editAditivo={editAditivo}
          reload={reload}
          setReload={setReload}
        />
      </Dialog>
      <Dialog
        visible={viewDialog}
        onHide={() => setViewDialog(false)}
        className="w-11 xl:w-5"
        header={<h4 className="m-0"><i className="fa-solid fa-droplet mr-2" />{viewAditivo?.marca}</h4>}
        footer={
          <div className="flex justify-content-center gap-2">
            <Button
              label="Editar"
              icon="fa-solid fa-pencil"
              rounded
              size="small"
              onClick={() => { setViewDialog(false); navigate(`/calidad/catalogos/aditivos/editar/${viewAditivo.idAditivo}`); }}
            />
            <Button
              label="Borrar"
              icon="fa-solid fa-trash"
              severity="danger"
              rounded
              size="small"
              loading={deleteLoading}
              onClick={() => { setViewDialog(false); confirmarBorrado(viewAditivo.idAditivo); }}
            />
          </div>
        }
      >
        <AditivoPanel aditivo={viewAditivo} />
      </Dialog>

      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader icon="fa-solid fa-droplet" title="Aditivos" subtitle="Gestión de aditivos químicos" />

        {filtered.length > 0 ? (
          <>
            <div className="flex align-self-end justify-content-between w-full xl:w-auto flex-1">
              <span className="search-bar-wrapper mr-2">

                <InputText
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  placeholder="Buscar aditivo..."
                  title="Buscar por marca o nombre"
                  className="search-bar"
                />
              </span>
              <Button
                label={isOnPhone ? '' : 'Agregar nuevo'}
                rounded
                icon="fa-solid fa-plus"
                severity="success"
                onClick={() => navigate("/calidad/catalogos/aditivos/nuevo")}
                className="flex mb-2"
                size="small"
              />
            </div>

            <DataTable
              value={filtered}
              stripedRows
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
                  <CellFade uniqueKey={`marca-${row.idAditivo}`}>
                    <span
                      className="font-bold hover-blue cursor-pointer"
                      onClick={() => mostrarAditivo(row)}
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
                  <CellFade uniqueKey={`fabrica-${row.idAditivo}`}>{row.fabrica}</CellFade>
                )}
              />
              <Column
                field="funcion"
                header="Función"
                body={(row) => (
                  <CellFade uniqueKey={`funcion-${row.idAditivo}`}>
                    {row.funcion || "—"}
                  </CellFade>
                )}
              />
            </DataTable>
          </>
        ) : (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center">
            <h2 className="text-center mb-4 mt-0">Aún no hay aditivos cargados</h2>
            <small className="text-center">Creá ahora tu primer aditivo</small>
            <span
              className="button-create mt-2"
              onClick={() => navigate("/calidad/catalogos/aditivos/nuevo")}
            >
              <i className="fa-solid fa-plus"></i>
            </span>
          </div>
        )}
      </div>
    </Fade>
  );
};

export default AdminAditivo;
