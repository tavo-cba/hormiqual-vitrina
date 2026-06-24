import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams, useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { Fade } from "react-awesome-reveal";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Calendar } from "primereact/calendar";
import { Button } from "primereact/button";
import { Divider } from "primereact/divider";
import { useToast } from "../../../context/ToastContext";
import PlantasMaterialSection from "../../common/PlantasMaterialSection";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";

/**
 * Formulario para crear/editar Adiciones (MaterialTipo 4).
 * Los demás tipos (Agregados, Cementos, Aditivos, Fibras) se editan
 * desde sus respectivos formularios especializados.
 */
const MaterialForm = () => {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const navigate = useNavigate();
  const showToast = useToast();

  /* ── State ───────────────────────────────── */
  const [nombre, setNombre] = useState("");
  const [proveedor, setProveedor] = useState("");
  const [origen, setOrigen] = useState("");
  const [fechaAlta, setFechaAlta] = useState(null);
  const [observaciones, setObservaciones] = useState("");
  const [propiedades, setPropiedades] = useState([]);
  const [plantasConfig, setPlantasConfig] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const savingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");

  /* ── Fetch (edición) ─────────────────────── */
  const fetchMaterial = useCallback(async () => {
    if (!id) return;
    try {
      const res = await axios.get(`${config.backendUrl}/api/materiales/${id}`, {
        headers: config.headers,
      });
      const m = res.data;
      setNombre(m.nombre || "");
      setProveedor(m.proveedor || "");
      setOrigen(m.origen || "");
      setFechaAlta(m.fechaAlta ? new Date(m.fechaAlta) : null);
      setObservaciones(m.observaciones || "");
      setPropiedades(
        (m.propiedades || []).map((p) => ({
          clave: p.clave,
          valor: p.valor || "",
          unidad: p.unidad || "",
        }))
      );
      const plantas = Array.isArray(m.plantas) ? m.plantas : [];
      setPlantasConfig(plantas.map(p => ({
        idPlanta: p.idPlanta,
        nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
        activo: p.activo !== false,
        observaciones: p.observaciones || null,
        precioActual: p.precioVigente?.precioUnitario != null ? Number(p.precioVigente.precioUnitario) : null,
        unidadPrecio: p.precioVigente?.unidad || 'kg',
        nuevoPrecio: null,
      })));
    } catch (err) {
      console.error(err);
    }
  }, [id]);

  useEffect(() => {
    fetchMaterial();
  }, [fetchMaterial]);

  /* ── Propiedades helpers ─────────────────── */
  const addPropiedad = () => setPropiedades([...propiedades, { clave: "", valor: "", unidad: "" }]);
  const removePropiedad = (i) => setPropiedades(propiedades.filter((_, idx) => idx !== i));
  const updatePropiedad = (i, field, value) => {
    const u = [...propiedades];
    u[i] = { ...u[i], [field]: value };
    setPropiedades(u);
  };

  /* ── Validación ──────────────────────────── */
  const validar = () => {
    if (!nombre.trim()) return "El nombre es obligatorio.";
    return "";
  };

  /* ── Guardar ─────────────────────────────── */
  const guardar = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    setErrorMessage("");
    const error = validar();
    if (error) { setErrorMessage(error); return; }

    savingRef.current = true;
    setSaveLoading(true);
    const payload = {
      idMaterialTipo: 4, // Adiciones
      nombre: nombre.trim(),
      proveedor: proveedor.trim() || null,
      origen: origen.trim() || null,
      fechaAlta: fechaAlta ? fechaAlta.toISOString().split("T")[0] : null,
      observaciones: observaciones.trim() || null,
      propiedades: propiedades
        .filter((p) => p.clave.trim())
        .map((p, i) => ({ clave: p.clave.trim(), valor: p.valor.trim(), unidad: p.unidad.trim(), orden: i })),
      plantasConfig: plantasConfig.map(p => ({
        idPlanta: p.idPlanta,
        activo: p.activo !== false,
        observaciones: p.observaciones || null,
      })),
    };

    try {
      let materialIdGuardado = id;
      if (isEditing) {
        await axios.put(`${config.backendUrl}/api/materiales/${id}`, payload, { headers: config.headers });
        showToast("success", "Adición actualizada con éxito");
      } else {
        const r = await axios.post(`${config.backendUrl}/api/materiales`, payload, { headers: config.headers });
        materialIdGuardado = r.data?.idMaterial || r.data?.id;
        showToast("success", "Adición creada con éxito");
      }

      const hoy = new Date().toISOString().slice(0, 10);
      for (const p of plantasConfig) {
        if (p.nuevoPrecio != null && Number(p.nuevoPrecio) > 0 && materialIdGuardado) {
          try {
            await axios.post(`${config.backendUrl}/api/material-precios`, {
              materialSource: 'adicion',
              materialSourceId: materialIdGuardado,
              idPlanta: p.idPlanta,
              precioUnitario: Number(p.nuevoPrecio),
              unidad: p.unidadPrecio || 'kg',
              fechaVigencia: hoy,
              autoVencer: true,
            }, { headers: config.headers });
          } catch (errP) { console.warn('precio', errP.message); }
        }
      }

      navigate("/calidad/catalogos/materiales?tipo=4");
    } catch (err) {
      console.error(err);
      showToast("error", "Error al guardar la adición");
    } finally {
      savingRef.current = false;
      setSaveLoading(false);
    }
  };

  /* ── Render ──────────────────────────────── */
  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="flex w-full justify-content-center">
        <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column justify-self-center align-items-center w-full xl:w-8">
          <div className="w-full">
            <DetailPageHeader
              icon="fa-solid fa-gem"
              title={isEditing ? "Editar adición" : "Nueva adición"}
              subtitle="Material tipo 4 — adición mineral"
            />
          </div>

          <form className="w-full flex flex-column align-items-center form-card pt-5 pb-5" onSubmit={guardar}>
            {/* ── Datos generales ─────────────── */}
            <div className="flex flex-column xl:flex-row gap-3 justify-content-between w-full xl:w-10">
              <div className="flex flex-column mb-2 w-full xl:w-6">
                <small><small className="color-danger">* </small>Nombre</small>
                <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} />
              </div>
              <div className="flex flex-column mb-2 w-full xl:w-6">
                <small>Proveedor / Fabricante</small>
                <InputText value={proveedor} onChange={(e) => setProveedor(e.target.value)} />
              </div>
            </div>

            <div className="flex flex-column xl:flex-row gap-3 justify-content-between w-full xl:w-10">
              <div className="flex flex-column mb-2 w-full xl:w-6">
                <small>Origen</small>
                <InputText value={origen} onChange={(e) => setOrigen(e.target.value)} />
              </div>
              <div className="flex flex-column mb-2 w-full xl:w-6">
                <small>Fecha de alta</small>
                <Calendar value={fechaAlta} onChange={(e) => setFechaAlta(e.value)} dateFormat="dd/mm/yy" showIcon className="w-full" />
              </div>
            </div>

            <div className="flex flex-column w-full xl:w-10 mb-2">
              <small>Observaciones</small>
              <InputTextarea value={observaciones} onChange={(e) => setObservaciones(e.target.value)} rows={3} autoResize className="w-full" />
            </div>

            {/* ── Documentos (placeholder) ───── */}
            <Divider align="left" className="w-full xl:w-10">
              <span className="font-semibold text-sm"><i className="fa-solid fa-file mr-2" />Documentos</span>
            </Divider>
            <div className="w-full xl:w-10 mb-3">
              <p className="text-sm text-500 m-0">Sección disponible próximamente.</p>
            </div>

            {/* ── Propiedades ─────────────────── */}
            <Divider align="left" className="w-full xl:w-10">
              <span className="font-semibold text-sm"><i className="fa-solid fa-list mr-2" />Propiedades</span>
            </Divider>
            <div className="w-full xl:w-10 flex flex-column gap-2 mb-3">
              {propiedades.map((p, idx) => (
                <div key={idx} className="flex flex-column xl:flex-row gap-2 align-items-end">
                  <div className="flex flex-column w-full xl:w-4">
                    {idx === 0 && <small>Propiedad</small>}
                    <InputText value={p.clave} onChange={(e) => updatePropiedad(idx, "clave", e.target.value)} placeholder="Ej: Densidad" />
                  </div>
                  <div className="flex flex-column w-full xl:w-4">
                    {idx === 0 && <small>Valor</small>}
                    <InputText value={p.valor} onChange={(e) => updatePropiedad(idx, "valor", e.target.value)} placeholder="Ej: 2.65" />
                  </div>
                  <div className="flex flex-column w-full xl:w-3">
                    {idx === 0 && <small>Unidad</small>}
                    <InputText value={p.unidad} onChange={(e) => updatePropiedad(idx, "unidad", e.target.value)} placeholder="Ej: g/cm³" />
                  </div>
                  <Button icon="fa-solid fa-xmark" rounded text severity="danger" size="small" type="button" onClick={() => removePropiedad(idx)} className="flex-shrink-0" />
                </div>
              ))}
              <Button label="Agregar propiedad" icon="fa-solid fa-plus" text size="small" type="button" onClick={addPropiedad} className="align-self-start" />
            </div>

            {/* ── Disponibilidad y precios por planta ─── */}
            <div className="w-full xl:w-10 mb-3">
              <PlantasMaterialSection
                value={plantasConfig}
                onChange={setPlantasConfig}
                tituloMaterial="esta adición"
              />
            </div>

            {/* ── Error + Submit ───────────────── */}
            {errorMessage && <small className="color-danger mb-2">{errorMessage}</small>}
            <Button
              label={isEditing ? "Guardar cambios" : "Crear adición"}
              icon="fa-solid fa-check"
              rounded
              loading={saveLoading}
              disabled={saveLoading}
              type="submit"
              className="mt-2"
            />
          </form>
        </div>
      </div>
    </Fade>
  );
};

export default MaterialForm;
