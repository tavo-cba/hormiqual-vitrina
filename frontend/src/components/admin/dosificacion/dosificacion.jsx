// src/pages/admin/dosificacion/dosificacion.jsx
import React, { useEffect, useState, useRef } from "react";
import "./dosificacion.css";
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
import { Dropdown } from "primereact/dropdown";
import { Dialog } from "primereact/dialog";
import { useNavigate } from "react-router-dom";

import CellFade from "../empleado/uikit/CellFade";
import DosificacionForm from "./uikit/dosificacionForm";
import { isOnPhone } from "../../../common/functions";
import DosificacionPanel from "./uikit/dosificacionPanel";
import { useMenuContext } from "../../../context/MenuContext";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import useListParams from "../../../common/hooks/useListParams";
import { exportarDosificaciones, descargarPlantilla, parsearExcelDosificaciones } from "./dosificacionExcel";

const AdminDosificacion = () => {
  /* ────────────────  State  ──────────────── */
  const [dosificaciones, setDosificaciones] = useState([]);
  const [loading, setLoading] = useState(false);
  const [deleteLoading, setDeleteLoading] = useState(false);
  const [editDialog, setEditDialog] = useState(false);
  const [editDosificacion, setEditDosificacion] = useState(null);
  const [showDialog, setShowDialog] = useState(false);
  const [showDosificacion, setShowDosificacion] = useState(null);

  const [reload, setReload] = useState(false);
  const { searchTerm, setSearchTerm, first, setFirst } = useListParams();
  const [plantaFilter, setPlantaFilter] = useState(null);
  const [plantas, setPlantas] = useState([]);
  const [catalogos, setCatalogos] = useState(null);
  const [importLoading, setImportLoading] = useState(false);
  const [importResult, setImportResult] = useState(null);
  const [importResultDialog, setImportResultDialog] = useState(false);
  const fileInputRef = useRef(null);

  const navigate = useNavigate();
  const showToast = useToast();
  const { getActions } = useMenuContext();
  const { puedeAgregar, puedeEditar, puedeBorrar } =
    getActions("/admin/dosificaciones");
  const todosPermisos = puedeAgregar && puedeEditar && puedeBorrar;

  /* ────────────────  API  ──────────────── */
  const getDosificaciones = async () => {
    try {
      setLoading(true);
      const res = await axios.get(`${config.backendUrl}/api/dosificaciones`, {
        headers: config.headers,
      });
      setDosificaciones(res.data || []);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const getCatalogos = async () => {
    try {
      const [basicos, cem, adt, agr, fib] = await Promise.all([
        axios.get(`${config.backendUrl}/api/dosificaciones/catalogos/basicos`, { headers: config.headers }),
        axios.get(`${config.backendUrl}/api/cementos`, { headers: config.headers }),
        axios.get(`${config.backendUrl}/api/aditivos`, { headers: config.headers }),
        axios.get(`${config.backendUrl}/api/agregados`, { headers: config.headers }),
        axios.get(`${config.backendUrl}/api/fibras`, { headers: config.headers }),
      ]);
      const cat = {
        ...basicos.data,
        cementos: cem.data || [],
        aditivos: adt.data || [],
        agregados: agr.data || [],
        fibras: fib.data || [],
      };
      setCatalogos(cat);
      setPlantas(cat.plantas || []);
    } catch (err) {
      console.error("Error al cargar catálogos:", err);
    }
  };

  useEffect(() => {
    getDosificaciones();
    getCatalogos();
  }, []);

  useEffect(() => {
    if (reload) {
      getDosificaciones();
      setReload(false);
    }
  }, [reload]);

  /* ────────────────  Delete  ──────────────── */
  const borrarDosificacion = async (id) => {
    try {
      setDeleteLoading(true);
      await axios.delete(`${config.backendUrl}/api/dosificaciones/${id}`, {
        headers: config.headers,
      });
      setDosificaciones((prev) => prev.filter((d) => d.idDosificacion !== id));
      showToast("success", "Dosificación borrada exitosamente");
    } catch (err) {
      console.error(err);
      showToast("error", "Error al borrar la dosificación");
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
          <span>¿Estás seguro que quieres borrar esta dosificación?</span>
        </div>
      ),
      header: "Borrar dosificación",
      defaultFocus: "accept",
      acceptLabel: (
        <span className="mr-2 ml-2">
          <i className="fa-solid fa-trash mr-2"></i>Borrar
        </span>
      ),
      acceptClassName: "p-button-danger",
      rejectLabel: "Cancelar",
      accept: () => borrarDosificacion(id),
    });
  };

  /* ────────────────  Excel  ──────────────── */
  const handleDescargarPlantilla = () => {
    descargarPlantilla(catalogos);
    showToast("success", "Plantilla descargada");
  };

  const handleExportar = () => {
    if (!plantaFilter) {
      showToast("warn", "Seleccioná una planta para exportar");
      return;
    }
    const planta = plantas.find((p) => p.idPlanta === plantaFilter);
    const dosifPlanta = dosificaciones.filter((d) => d.idPlanta === plantaFilter);
    if (!dosifPlanta.length) {
      showToast("warn", "No hay dosificaciones para esta planta");
      return;
    }
    exportarDosificaciones(dosifPlanta, planta?.nombre || "Planta", catalogos);
    showToast("success", "Excel exportado");
  };

  const handleImportarClick = () => {
    if (!plantaFilter) {
      showToast("warn", "Seleccioná una planta para importar");
      return;
    }
    fileInputRef.current?.click();
  };

  const handleFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    e.target.value = "";

    try {
      setImportLoading(true);
      const rows = await parsearExcelDosificaciones(file);
      if (!rows.length) {
        showToast("warn", "El archivo no contiene dosificaciones válidas");
        return;
      }
      const res = await axios.post(
        `${config.backendUrl}/api/dosificaciones/importar`,
        { idPlanta: plantaFilter, dosificaciones: rows },
        { headers: config.headers }
      );
      setImportResult(res.data);
      setImportResultDialog(true);
      setReload(true);
    } catch (err) {
      console.error("Error al importar dosificaciones:", err);
      const msg = err.response?.data?.error || "Error al importar el archivo";
      showToast("error", msg);
    } finally {
      setImportLoading(false);
    }
  };

  const confirmarImportar = () => {
    confirmDialog({
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i className="fa-solid fa-file-import mb-3" style={{ fontSize: "2.6rem", color: "var(--primary-color)" }} />
          <span className="text-center">
            Esto va a sincronizar las dosificaciones de la planta con el contenido del Excel.
            <br /><br />
            <strong>Se agregarán las nuevas, se actualizarán las modificadas y se borrarán las que ya no estén en el archivo.</strong>
          </span>
        </div>
      ),
      header: "Importar dosificaciones",
      defaultFocus: "reject",
      acceptLabel: (
        <span className="mr-2 ml-2">
          <i className="fa-solid fa-file-import mr-2" />Importar
        </span>
      ),
      rejectLabel: "Cancelar",
      accept: () => fileInputRef.current?.click(),
    });
  };

  /* ────────────────  Helpers  ──────────────── */
  const mostrarDosificacion = (d) => {
    setShowDosificacion(d);
    setShowDialog(true);
  };

  const filtered = dosificaciones.filter((d) => {
    const matchSearch = (d.nombre || "").toLowerCase().includes(searchTerm.toLowerCase());
    const matchPlanta = !plantaFilter || d.idPlanta === plantaFilter;
    return matchSearch && matchPlanta;
  });

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  /* ────────────────  JSX  ──────────────── */
  return (
    <Fade direction="up" duration={500} triggerOnce>
      {/* Modal create / edit */}
      <Dialog
        visible={editDialog}
        onHide={() => setEditDialog(false)}
        className="w-11 xl:w-auto h-auto"
      >
        <DosificacionForm
          setDialogVisible={setEditDialog}
          editDosificacion={editDosificacion}
          reload={reload}
          setReload={setReload}
        />
      </Dialog>
      <Dialog
        visible={showDialog}
        onHide={() => setShowDialog(false)}
        className="w-11 xl:w-5"
        header={<h4 className="m-0"><i className="fa-solid fa-flask-vial mr-2" />{showDosificacion?.nombre}</h4>}
        footer={
          <div className="flex justify-content-center gap-2">
            {puedeEditar && (
              <Button
                label="Editar"
                icon="fa-solid fa-pencil"
                rounded
                size="small"
                onClick={() => {
                  setShowDialog(false);
                  navigate(`/admin/dosificaciones/editar/${showDosificacion?.idDosificacion}`);
                }}
              />
            )}
            {puedeBorrar && (
              <Button
                label="Borrar"
                icon="fa-solid fa-trash"
                rounded
                severity="danger"
                size="small"
                loading={deleteLoading}
                onClick={() => {
                  setShowDialog(false);
                  confirmarBorrado(showDosificacion.idDosificacion);
                }}
              />
            )}
          </div>
        }
      >
        <DosificacionPanel dosificacion={showDosificacion} />
      </Dialog>

      {/* Hidden file input for import */}
      <input
        type="file"
        ref={fileInputRef}
        accept=".xlsx,.xls"
        style={{ display: "none" }}
        onChange={handleFileChange}
      />

      {/* Import result dialog */}
      <Dialog
        visible={importResultDialog}
        onHide={() => setImportResultDialog(false)}
        header={<h4 className="m-0"><i className="fa-solid fa-file-import mr-2" />Resultado de importación</h4>}
        className="w-11 xl:w-4"
      >
        {importResult && (
          <div className="flex flex-column gap-3 p-2">
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-circle-plus" style={{ color: "var(--color-success)" }} />
              <span><strong>{importResult.creadas}</strong> dosificaciones creadas</span>
            </div>
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-pen" style={{ color: "var(--primary-color)" }} />
              <span><strong>{importResult.actualizadas}</strong> dosificaciones actualizadas</span>
            </div>
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-trash" style={{ color: "var(--color-danger)" }} />
              <span><strong>{importResult.eliminadas}</strong> dosificaciones eliminadas</span>
            </div>
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-equals" style={{ color: "var(--text-color-secondary)" }} />
              <span><strong>{importResult.sinCambios}</strong> sin cambios</span>
            </div>
            {importResult.errores?.length > 0 && (
              <div className="mt-2">
                <strong style={{ color: "var(--color-danger)" }}>Errores:</strong>
                <ul className="mt-1">
                  {importResult.errores.map((err, i) => (
                    <li key={i} style={{ color: "var(--color-danger)" }}>{err}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </Dialog>

      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pl-0 xl:pt-0">
        <PageHeader icon="fa-solid fa-flask-vial" title="Dosificaciones" subtitle="Gestión de dosificaciones de hormigón" />

        {/* Toolbar: filtro planta + acciones Excel */}
        <div className="flex flex-wrap align-items-center justify-content-between w-full gap-2 mb-3">
          <div className="flex flex-wrap align-items-center gap-2 flex-1">
            <Dropdown
              value={plantaFilter}
              options={plantas}
              onChange={(e) => { setPlantaFilter(e.value); setFirst(0); }}
              optionLabel="nombre"
              optionValue="idPlanta"
              placeholder="Todas las plantas"
              showClear
              className="w-14rem"
            />
            <span className="search-bar-wrapper">
              <InputText
                value={searchTerm}
                onChange={(e) => { setSearchTerm(e.target.value); setFirst(0); }}
                placeholder="Buscar dosificación..."
                title="Buscar por nombre o planta"
                className="search-bar"
              />
            </span>
          </div>
          <div className="flex flex-wrap align-items-center gap-2">
            <Button
              label={isOnPhone ? "" : "Plantilla"}
              icon="fa-solid fa-download"
              rounded
              outlined
              size="small"
              tooltip="Descargar Excel modelo"
              tooltipOptions={{ position: "top" }}
              onClick={handleDescargarPlantilla}
            />
            <Button
              label={isOnPhone ? "" : "Exportar"}
              icon="fa-solid fa-file-export"
              rounded
              outlined
              size="small"
              severity="info"
              tooltip="Exportar dosificaciones de la planta seleccionada"
              tooltipOptions={{ position: "top" }}
              onClick={handleExportar}
            />
            <Button
              label={isOnPhone ? "" : "Importar"}
              icon="fa-solid fa-file-import"
              rounded
              size="small"
              severity="warning"
              tooltip="Importar dosificaciones desde Excel a la planta seleccionada"
              tooltipOptions={{ position: "top" }}
              loading={importLoading}
              onClick={confirmarImportar}
              style={{ display: !todosPermisos ? "none" : null }}
            />
            <Button
              label={isOnPhone ? "" : "Agregar nueva"}
              rounded
              icon="fa-solid fa-plus"
              severity="success"
              onClick={() => navigate("/admin/dosificaciones/nueva")}
              style={{ display: !puedeAgregar ? "none" : null }}
              size="small"
            />
          </div>
        </div>

        {filtered.length > 0 ? (
          <>

            <DataTable
              value={filtered}
              stripedRows
              paginator
              rows={50}
              pageLinkSize={4}
              first={first}
              onPage={(e) => setFirst(e.first)}
              emptyMessage={<h3>No hay coincidencias</h3>}
              className="w-full"
            >
              <Column
                sortable
                field="nombre"
                header="Nombre"
                body={(row) => (
                  <CellFade uniqueKey={`nombre-${row.idDosificacion}`}>
                    <span
                      className="font-bold hover-blue cursor-pointer"
                      onClick={() => mostrarDosificacion(row)}
                    >
                      {row.nombre}
                    </span>
                  </CellFade>
                )}
              />
              <Column
                field="tipoHormigon.tipoHormigon"
                header="Tipo H°"
                body={(row) => (
                  <CellFade uniqueKey={`tipoH-${row.idDosificacion}`}>
                    {row.tipoHormigon?.tipoHormigon || "—"}
                  </CellFade>
                )}
              />
              <Column
                sortable
                field="planta.nombre"
                header="Planta"
                body={(row) => (
                  <CellFade uniqueKey={`planta-${row.idDosificacion}`}>
                    {row.planta?.nombre || "—"}
                  </CellFade>
                )}
              />
              <Column
                field="agua"
                header="Agua (L)"
                body={(row) => (
                  <CellFade uniqueKey={`agua-${row.idDosificacion}`}>
                    {row.agua}
                  </CellFade>
                )}
              />
            </DataTable>
          </>
        ) : dosificaciones.length === 0 ? (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center">
            <h2 className="text-center mb-4 mt-0">
              Aún no hay dosificaciones cargadas
            </h2>
            <small className="text-center">
              Creá una nueva dosificación o importá desde un Excel
            </small>
            <span
              className="button-create mt-2"
              style={{ display: !puedeAgregar ? "none" : null }}
              onClick={() => navigate("/admin/dosificaciones/nueva")}
            >
              <i className="fa-solid fa-plus"></i>
            </span>
          </div>
        ) : (
          <div className="form-card br-15 flex p-4 xl:p-6 flex-column align-items-center">
            <h3 className="text-center m-0">No hay coincidencias con los filtros aplicados</h3>
          </div>
        )}
      </div>
    </Fade>
  );
};

export default AdminDosificacion;
