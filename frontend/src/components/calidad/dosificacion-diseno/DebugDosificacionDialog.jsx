/* [DEBUG-DOSIF] ─────────────────────────────────────────────────────────────
 * Diálogo de "Dosificación de depuración" — herramienta TEMPORAL para probar la
 * integración con planta Betonmatic en producción sin pasar por el motor
 * normativo. Permite crear una dosificación arbitraria (p. ej. 50 L de agua por
 * m³ y nada más) que luego se publica y despacha por el flujo normal.
 *
 * Sólo visible para admins y sólo cuando el backend expone
 * `config.allowDebugDosificacion === true` (env var ALLOW_DEBUG_DOSIFICACION).
 *
 * Es un componente aislado a propósito: NO toca el wizard de diseño. Para
 * remover la feature cuando el módulo Betonmatic esté estable: borrar este
 * archivo + sus referencias (grep `[DEBUG-DOSIF]`).
 * ───────────────────────────────────────────────────────────────────────── */

import React, { useEffect, useState, useRef } from "react";
import { Dialog } from "primereact/dialog";
import { Dropdown } from "primereact/dropdown";
import { InputText } from "primereact/inputtext";
import { InputNumber } from "primereact/inputnumber";
import { Button } from "primereact/button";
import { Message } from "primereact/message";
import { useToast } from "../../../context/ToastContext";
import {
  getPlantas,
  getCementos,
  getAditivos,
  calcularDosificacion,
  guardarDosificacion,
} from "../../../services/dosificacionDisenoService";

const SLOTS = [1, 2, 3];
const emptyAditivo = () => ({ idAditivo: null, kgM3: null });

const DebugDosificacionDialog = ({ visible, onHide, onCreated }) => {
  const showToast = useToast();

  const [plantas, setPlantas] = useState([]);
  const [cementos, setCementos] = useState([]);
  const [aditivos, setAditivos] = useState([]);

  const [idPlanta, setIdPlanta] = useState(null);
  const [nombre, setNombre] = useState("");
  const [aguaLtsM3, setAguaLtsM3] = useState(50);
  const [cementoId, setCementoId] = useState(null);
  const [cementoKgM3, setCementoKgM3] = useState(null);
  const [aditivoRows, setAditivoRows] = useState([emptyAditivo()]);

  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);

  // Cargar plantas al abrir.
  useEffect(() => {
    if (!visible) return;
    getPlantas()
      .then((p) => setPlantas(Array.isArray(p) ? p : []))
      .catch((err) => {
        console.error("Error al cargar plantas:", err);
        showToast("error", "No se pudieron cargar las plantas.");
      });
  }, [visible]); // eslint-disable-line react-hooks/exhaustive-deps

  // Cargar materiales de la planta elegida.
  useEffect(() => {
    if (!idPlanta) {
      setCementos([]);
      setAditivos([]);
      return;
    }
    Promise.all([getCementos(idPlanta), getAditivos(idPlanta)])
      .then(([c, a]) => {
        setCementos(Array.isArray(c) ? c : []);
        setAditivos(Array.isArray(a) ? a : []);
      })
      .catch((err) => {
        console.error("Error al cargar materiales:", err);
        showToast("error", "No se pudieron cargar los materiales de la planta.");
      });
  }, [idPlanta]); // eslint-disable-line react-hooks/exhaustive-deps

  const reset = () => {
    setIdPlanta(null);
    setNombre("");
    setAguaLtsM3(50);
    setCementoId(null);
    setCementoKgM3(null);
    setAditivoRows([emptyAditivo()]);
  };

  const handleHide = () => {
    if (saving) return;
    reset();
    onHide?.();
  };

  const plantaOptions = plantas.map((p) => ({ label: p.nombre, value: p.idPlanta }));
  const cementoOptions = cementos.map((c) => ({
    label: `${c.nombreComercial || "Sin nombre"} — ${c.fabricante || ""}`.trim(),
    value: c.idCemento,
  }));
  const aditivoOptions = aditivos.map((a) => ({
    label: (a.marca || "Sin marca").trim() + (a.funcion ? ` — ${a.funcion}` : ""),
    value: a.idAditivo,
  }));

  const setAditivoRow = (idx, patch) => {
    setAditivoRows((rows) => rows.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };
  const addAditivoRow = () => {
    if (aditivoRows.length >= SLOTS.length) return;
    setAditivoRows((rows) => [...rows, emptyAditivo()]);
  };
  const removeAditivoRow = (idx) => {
    setAditivoRows((rows) => (rows.length === 1 ? [emptyAditivo()] : rows.filter((_, i) => i !== idx)));
  };

  // Aditivos efectivamente cargados (con material y dosis > 0), reindexados a slots 1..N.
  const aditivosValidos = aditivoRows
    .filter((r) => r.idAditivo && Number(r.kgM3) > 0)
    .map((r, i) => ({ slot: i + 1, idAditivo: r.idAditivo, kgM3: Number(r.kgM3) }));

  const nombreFinal = () => {
    const base = (nombre || "").trim() || `Envío de prueba ${new Date().toISOString().slice(0, 10)}`;
    return /^\[debug\]/i.test(base) ? base : `[DEBUG] ${base}`;
  };

  const handleCreate = async () => {
    if (savingRef.current) return;
    if (!idPlanta) return showToast("warn", "Seleccioná una planta de destino.");
    if (!(Number(aguaLtsM3) > 0)) return showToast("warn", "El agua (L/m³) debe ser mayor a 0.");
    if (cementoId && !(Number(cementoKgM3) > 0)) {
      return showToast("warn", "Si elegís un cemento, indicá su dosis (kg/m³).");
    }

    savingRef.current = true;
    setSaving(true);
    try {
      const nom = nombreFinal();
      const aditivosNombrePorId = new Map(aditivos.map((a) => [a.idAditivo, (a.marca || "Aditivo").trim()]));

      // 1) Calcular (motor echo, sin validaciones normativas).
      const calc = await calcularDosificacion({
        tipologiaCodigo: "debug",
        nombre: nom,
        idPlanta,
        debug: {
          aguaLtsM3: Number(aguaLtsM3),
          cementoKgM3: cementoId ? Number(cementoKgM3) : undefined,
          aditivos: aditivosValidos.map((a) => ({
            slot: a.slot,
            kgM3: a.kgM3,
            nombre: aditivosNombrePorId.get(a.idAditivo) || `Aditivo ${a.slot}`,
          })),
        },
      });

      if (!calc?.resultado) {
        throw new Error(calc?.message || "El cálculo de depuración no devolvió resultado.");
      }

      // 2) Guardar — las FK (idCemento, idAditivoN) las persiste el backend desde
      //    el body; el publicador a Betonmatic las cruza con el resultadoJson.
      const body = {
        nombre: nom,
        descripcion: "Dosificación de depuración — sólo para pruebas de integración con planta. No usar en producción.",
        idPlanta,
        tipologiaCodigo: "debug",
        idCemento: cementoId || null,
        cementoKgM3Adoptado: cementoId ? Number(cementoKgM3) : null,
        parametrosObjetivoJson: JSON.stringify({
          tipologiaCodigo: "debug",
          esDebug: true,
          aguaLtsM3: Number(aguaLtsM3),
        }),
        resultadoJson: JSON.stringify(calc.resultado),
        trazabilidadJson: JSON.stringify(calc.trazabilidad || {}),
      };
      aditivosValidos.forEach((a) => {
        body[`idAditivo${a.slot}`] = a.idAditivo;
        body[`etapaAditivo${a.slot}`] = "PLANTA";
      });

      const res = await guardarDosificacion(body);
      const creada = res?.data || res;
      showToast("success", `Dosificación de depuración creada: ${nom}`);
      onCreated?.(creada);
      handleHide();
    } catch (err) {
      console.error("Error al crear dosificación de depuración:", err);
      showToast("error", err.response?.data?.message || err.message || "No se pudo crear la dosificación de depuración.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };

  const footer = (
    <div className="flex justify-content-end gap-2">
      <Button label="Cancelar" icon="fa-solid fa-xmark" severity="secondary" text onClick={handleHide} disabled={saving} />
      <Button label="Crear y guardar" icon="fa-solid fa-flask-vial" severity="warning" onClick={handleCreate} loading={saving} disabled={saving} />
    </div>
  );

  return (
    <Dialog
      header="Dosificación de depuración"
      visible={visible}
      onHide={handleHide}
      footer={footer}
      style={{ width: "90vw", maxWidth: "640px" }}
      breakpoints={{ "768px": "95vw" }}
      dismissableMask={!saving}
    >
      <Message
        severity="warn"
        className="w-full mb-3"
        content={
          <span>
            <strong>Herramienta de depuración.</strong> Crea una dosificación arbitraria (sin cálculo ni
            verificación normativa) para probar el envío a planta Betonmatic. No usar en producción.
          </span>
        }
      />

      <div className="formgrid grid">
        <div className="field col-12 md:col-6">
          <label htmlFor="dbg-planta" className="font-medium">Planta de destino *</label>
          <Dropdown
            id="dbg-planta"
            value={idPlanta}
            options={plantaOptions}
            onChange={(e) => setIdPlanta(e.value)}
            placeholder="Seleccionar planta"
            className="w-full"
            filter
          />
        </div>
        <div className="field col-12 md:col-6">
          <label htmlFor="dbg-nombre" className="font-medium">Nombre</label>
          <InputText
            id="dbg-nombre"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            placeholder="[DEBUG] Envío de prueba"
            className="w-full"
          />
          <small className="text-color-secondary">Se antepone “[DEBUG]” automáticamente.</small>
        </div>

        <div className="field col-12 md:col-6">
          <label htmlFor="dbg-agua" className="font-medium">Agua (L/m³) *</label>
          <InputNumber
            id="dbg-agua"
            value={aguaLtsM3}
            onValueChange={(e) => setAguaLtsM3(e.value)}
            min={0}
            maxFractionDigits={1}
            className="w-full"
            inputClassName="w-full"
          />
        </div>
      </div>

      <fieldset className="mt-2 mb-3" style={{ border: "1px solid var(--surface-border)", borderRadius: 6 }}>
        <legend className="px-2 text-color-secondary">Cemento (opcional)</legend>
        <div className="formgrid grid">
          <div className="field col-12 md:col-7">
            <label htmlFor="dbg-cemento" className="font-medium">Cemento</label>
            <Dropdown
              id="dbg-cemento"
              value={cementoId}
              options={cementoOptions}
              onChange={(e) => setCementoId(e.value)}
              placeholder={idPlanta ? "Sin cemento" : "Elegí una planta primero"}
              className="w-full"
              showClear
              filter
              disabled={!idPlanta}
            />
          </div>
          <div className="field col-12 md:col-5">
            <label htmlFor="dbg-cemento-kg" className="font-medium">Dosis (kg/m³)</label>
            <InputNumber
              id="dbg-cemento-kg"
              value={cementoKgM3}
              onValueChange={(e) => setCementoKgM3(e.value)}
              min={0}
              maxFractionDigits={1}
              className="w-full"
              inputClassName="w-full"
              disabled={!cementoId}
            />
          </div>
        </div>
      </fieldset>

      <fieldset className="mb-2" style={{ border: "1px solid var(--surface-border)", borderRadius: 6 }}>
        <legend className="px-2 text-color-secondary">Aditivos (opcional, hasta 3)</legend>
        {aditivoRows.map((row, idx) => (
          <div className="formgrid grid" key={idx}>
            <div className="field col-12 md:col-7">
              <label className="font-medium">Aditivo {idx + 1}</label>
              <Dropdown
                value={row.idAditivo}
                options={aditivoOptions}
                onChange={(e) => setAditivoRow(idx, { idAditivo: e.value })}
                placeholder={idPlanta ? "Sin aditivo" : "Elegí una planta primero"}
                className="w-full"
                showClear
                filter
                disabled={!idPlanta}
              />
            </div>
            <div className="field col-10 md:col-4">
              <label className="font-medium">Dosis (kg/m³)</label>
              <InputNumber
                value={row.kgM3}
                onValueChange={(e) => setAditivoRow(idx, { kgM3: e.value })}
                min={0}
                maxFractionDigits={2}
                className="w-full"
                inputClassName="w-full"
                disabled={!row.idAditivo}
              />
            </div>
            <div className="field col-2 md:col-1 flex align-items-end">
              <Button
                icon="fa-solid fa-trash"
                severity="secondary"
                text
                onClick={() => removeAditivoRow(idx)}
                tooltip="Quitar"
                tooltipOptions={{ position: "left" }}
              />
            </div>
          </div>
        ))}
        {aditivoRows.length < SLOTS.length && (
          <Button
            label="Agregar aditivo"
            icon="fa-solid fa-plus"
            size="small"
            text
            onClick={addAditivoRow}
            disabled={!idPlanta}
          />
        )}
      </fieldset>

      <small className="text-color-secondary">
        Tras crear la dosificación quedará en estado Borrador. Por ser de depuración, un administrador puede
        promoverla a producción y publicarla a Betonmatic sin pastón ni verificación de aptitud.
      </small>
    </Dialog>
  );
};

export default DebugDosificacionDialog;
