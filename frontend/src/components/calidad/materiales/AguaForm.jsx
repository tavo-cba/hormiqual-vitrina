import React, { useState, useEffect, useCallback, useRef } from "react";
import { useParams } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { InputText } from "primereact/inputtext";
import { InputTextarea } from "primereact/inputtextarea";
import { Dropdown } from "primereact/dropdown";
import { Button } from "primereact/button";
import { useToast } from "../../../context/ToastContext";
import { getAgua, createAgua, updateAgua } from "../../../services/aguaService";
import DetailPageHeader from "../../../common/components/DetailPageHeader/DetailPageHeader";
import PlantasMaterialSection from "../../common/PlantasMaterialSection";

const FUENTE_OPTIONS = [
  { label: "Agua potable de red", value: "RED_PUBLICA" },
  { label: "Pozo", value: "POZO" },
  { label: "Agua recuperada de procesos de la industria del hormigón", value: "RECUPERADA_HORMIGON" },
  { label: "Agua residual industrial", value: "RESIDUAL_INDUSTRIAL" },
  { label: "Agua de fuentes subterráneas", value: "SUBTERRANEA" },
  { label: "Agua de lluvia", value: "LLUVIA" },
  { label: "Agua superficial natural", value: "SUPERFICIAL" },
  { label: "Agua de mar o agua salobre", value: "MAR_SALOBRE" },
  { label: "Agua residual cloacal tratada", value: "RESIDUAL_CLOACAL_TRATADA" },
];

const AguaForm = () => {
  const { id } = useParams();
  const isEditing = Boolean(id);
  const showToast = useToast();

  const [nombre, setNombre] = useState("");
  const [fuenteOrigen, setFuenteOrigen] = useState(null);
  const [observaciones, setObservaciones] = useState("");
  const [plantasConfig, setPlantasConfig] = useState([]);
  const [saveLoading, setSaveLoading] = useState(false);
  const savingRef = useRef(false);
  const [errorMessage, setErrorMessage] = useState("");

  const fetchData = useCallback(async () => {
    if (!id) return;
    try {
      const agua = await getAgua(id);
      setNombre(agua.nombre || "");
      setFuenteOrigen(agua.fuenteOrigen || null);
      setObservaciones(agua.observaciones || "");
      if (Array.isArray(agua.plantas) && agua.plantas.length > 0) {
        setPlantasConfig(agua.plantas.map(p => ({
          idPlanta: p.idPlanta,
          nombrePlanta: p.planta?.nombre || `Planta ${p.idPlanta}`,
          activo: p.activo !== false,
          observaciones: p.observaciones || null,
        })));
      } else if (agua.idPlanta) {
        setPlantasConfig([{
          idPlanta: agua.idPlanta,
          nombrePlanta: agua.planta?.nombre || `Planta ${agua.idPlanta}`,
          activo: true,
          observaciones: null,
        }]);
      }
    } catch {
      showToast("error", "Error al cargar agua");
    }
  }, [id, showToast]);

  useEffect(() => { fetchData(); }, [fetchData]);

  const guardarAgua = async (e) => {
    e.preventDefault();
    if (savingRef.current) return;
    if (!nombre.trim()) { setErrorMessage("El nombre es obligatorio"); return; }
    if (!fuenteOrigen) { setErrorMessage("Seleccioná la fuente de origen"); return; }
    setErrorMessage("");
    savingRef.current = true;
    setSaveLoading(true);
    try {
      const body = {
        nombre: nombre.trim(),
        fuenteOrigen,
        observaciones: observaciones.trim() || null,
        plantasConfig: plantasConfig.map(p => ({
          idPlanta: p.idPlanta,
          activo: p.activo !== false,
          observaciones: p.observaciones || null,
        })),
      };
      if (isEditing) {
        await updateAgua(id, body);
        showToast("success", "Agua actualizada con éxito");
      } else {
        await createAgua(body);
        showToast("success", "Agua creada con éxito");
      }
      window.history.back();
    } catch (err) {
      const msg = err?.response?.data?.error || "Error al guardar el agua";
      showToast("error", msg);
    } finally {
      savingRef.current = false;
      setSaveLoading(false);
    }
  };

  return (
    <Fade direction="up" duration={500} triggerOnce className="w-full">
      <div className="flex w-full justify-content-center">
        <div className="p-0 py-4 xl:p-3 xl:pt-5 flex flex-column justify-self-center align-items-center w-full xl:w-8">
          <div className="w-full">
            <DetailPageHeader
              icon="fa-solid fa-droplet"
              title={isEditing ? "Editar agua" : "Nueva agua"}
              subtitle="Material — Agua de mezcla"
            />
          </div>

          <form className="w-full flex flex-column align-items-center form-card pt-5 pb-5 gap-2" onSubmit={guardarAgua}>
            <div className="flex flex-wrap justify-content-center xl:w-9">
              <div className="flex flex-column col-12 md:col-6">
                <small><small className="color-danger">* </small>Nombre</small>
                <InputText value={nombre} onChange={(e) => setNombre(e.target.value)} placeholder="Ej: Agua Planta 1 L. Beltrán" />
              </div>
              <div className="flex flex-column col-12 md:col-6">
                <small><small className="color-danger">* </small>Fuente de origen</small>
                <Dropdown
                  value={fuenteOrigen}
                  onChange={(e) => setFuenteOrigen(e.value)}
                  options={FUENTE_OPTIONS}
                  placeholder="Selecciona"
                  className="w-full"
                />
              </div>
              <div className="flex flex-column col-12 md:col-12">
                <small>Observaciones</small>
                <InputTextarea
                  value={observaciones}
                  onChange={(e) => setObservaciones(e.target.value)}
                  rows={2}
                  autoResize
                  className="w-full"
                />
              </div>
            </div>

            <div className="w-full xl:w-9 mt-3">
              <PlantasMaterialSection
                value={plantasConfig}
                onChange={setPlantasConfig}
                tituloMaterial="esta agua"
                hidePrecio
              />
            </div>

            {errorMessage && (
              <small className="error-msg flex align-items-center mt-2 mb-2">
                <i className="fa-regular fa-circle-xmark mr-2"></i>
                {errorMessage}
              </small>
            )}

            <div className="flex justify-content-end mt-3">
              <Button
                label="Guardar"
                type="submit"
                rounded
                icon="fa-solid fa-check"
                loading={saveLoading}
                disabled={saveLoading}
              />
            </div>
          </form>
        </div>
      </div>
    </Fade>
  );
};

export default AguaForm;
