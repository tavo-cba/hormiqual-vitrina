// src/components/admin/despacho/uikit/MuestraForm.jsx
import React, { useState, useEffect, useRef } from "react";
import {
  Checkbox, Dropdown, InputNumber, InputText, Button, Calendar,
} from "primereact";
import { Dialog } from "primereact/dialog";
import { Fade } from "react-awesome-reveal";
import { Divider } from "primereact/divider";
import { useParams, useNavigate, useSearchParams } from "react-router-dom";
import { useToast } from "../../../../context/ToastContext";
import axios from "axios";
import { config } from "../../../../config/config";
import { isOnPhone, parseLocalDate } from "../../../../common/functions";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";
import { useUserContext } from "../../../../context/UserContext";
import { hasRole, ROLES } from "../../../../lib/roles";
import { downloadEtiquetasProbetaQr } from "../../../calidad/reportes/etiquetasProbetaQrPdf";

/* ───────── Constantes y helpers ───────── */
const msDia = 86_400_000;
const format = (d) =>
  d.toLocaleDateString("es-AR", { day: "2-digit", month: "2-digit", year: "numeric" });
const mapOpt = (arr = [], l, v) => arr.map((o) => ({ label: o[l], value: o[v] }));
const getFechaRotura = (fecha, hora, dias) => {
  if (!fecha) return "";
  const [hh, mm] = (hora || "12:00").split(":").map(Number);
  const base = new Date(
    fecha.getFullYear(),
    fecha.getMonth(),
    fecha.getDate(),
    hh,
    mm
  );
  return format(new Date(base.getTime() + dias * msDia));
};

/* ══════════════════════════════════════════════
   1. Componente presentacional (embed / standalone)
   ══════════════════════════════════════════════ */
function MuestraForm({
  /* ───── modo embed (true cuando lo usa DespachoForm) ───── */
  embedded = false,

  /* ───── callbacks exclusivos del modo standalone ───── */
  handleSave = () => { },   // ← se usa en el botón “Guardar” cuando embedded = false
  saving = false,      // ← opcional: si quieres mostrar loading en el botón

  /* ───── datos de despacho (para calcular fecha de rotura) ───── */
  fechaDespacho,
  horaDespacho,

  /* ───── operario autofill (cuando es operario, el padre ya setea idOperador) ───── */
  isOperario = false,

  /* ───── estado y setters (provienen del padre) ───── */
  idOperador,
  setIdOperador,
  useProbetas,
  setUseProbetas,
  useTemperatura,
  setUseTemperatura,
  useAireIncorporado,
  setUseAireIncorporado,
  useAsentamiento,
  setUseAsentamiento,
  probetas,
  addProbeta,
  removeProbeta,
  handleProbChange,
  temperaturaAmbiente,
  setTemperaturaAmbiente,
  temperaturaHormigon,
  setTemperaturaHormigon,
  aireIncorporado,
  setAireIncorporado,
  valorAsentamiento,
  setValorAsentamiento,
  idTipoProbeta,
  setIdTipoProbeta,
  idModalidadMuestra,
  setIdModalidadMuestra,

  /* ───── catálogos ───── */
  tiposProbeta = [],
  modalidades = [],
  operadores = [],
  estadosProbeta = [],
}) {
  return (
    <Fade direction="in" duration={800} triggerOnce>
      <div className="grid p-1 xl:p-3">
        {/* ---------- ajustes de muestra ---------- */}
        <div className="flex flex-column w-full">
          <h3 className="m-0 p-0 mb-2">
            <i className="fa-solid fa-gear mr-2" />
            Ajustes de muestra
          </h3>

          <div className="flex flex-column xl:flex-row w-full mb-3 gap-2">
            {/* operador */}
            <div className="flex flex-column box-card xl:w-4">
              <label>Operador</label>
              <Dropdown
                showClear
                value={idOperador}
                disabled={isOperario}
                onChange={(e) => setIdOperador(e.value)}
                options={mapOpt(operadores, "fullName", "idEmpleado")}
                filter
              />
            </div>

            {/* switches — sesión 2026-05-28: el wrapper anterior era
                `flex flex-wrap` con hijos usando `col-12 xl:col-6` (clases
                grid de PrimeFlex), que NO aplican dentro de flex. Resultado:
                el último label ("Registrar aire incorporado") quedaba con el
                checkbox arriba y la descripción debajo. Patrón corregido:
                un único flex row con `gap-3 flex-wrap` y pares Checkbox+label
                inline (replicando muestraTercerosForm.jsx:373-382). Sin
                `col-12` ni width fijo: este div convive en la MISMA fila flex
                que el Dropdown de Operador (`xl:w-4`); si le ponemos col-12
                fuerza 100% de ancho y se monta encima del Operador. Con
                `flex-1` toma el espacio restante después del Operador. */}
            <div className="flex flex-1 align-items-center gap-3 flex-wrap box-card">
              <div className="flex align-items-center">
                <Checkbox
                  disabled={!idOperador && !isOperario}
                  inputId="chkProb"
                  checked={useProbetas}
                  onChange={(e) => setUseProbetas(e.checked)}
                />
                <label htmlFor="chkProb" className="ml-2 white-space-nowrap">
                  Registrar probetas
                </label>
              </div>
              <div className="flex align-items-center">
                <Checkbox
                  disabled={!idOperador && !isOperario}
                  inputId="chkTemp"
                  checked={useTemperatura}
                  onChange={(e) => setUseTemperatura(e.checked)}
                />
                <label htmlFor="chkTemp" className="ml-2 white-space-nowrap">
                  Registrar temperatura
                </label>
              </div>
              <div className="flex align-items-center">
                <Checkbox
                  disabled={!idOperador && !isOperario}
                  inputId="chkAsent"
                  checked={useAsentamiento}
                  onChange={(e) => setUseAsentamiento(e.checked)}
                />
                <label htmlFor="chkAsent" className="ml-2 white-space-nowrap">
                  Registrar asentamiento
                </label>
              </div>
              <div className="flex align-items-center">
                <Checkbox
                  disabled={!idOperador && !isOperario}
                  inputId="aireInc"
                  checked={useAireIncorporado}
                  onChange={(e) => setUseAireIncorporado(e.checked)}
                />
                <label htmlFor="aireInc" className="ml-2 white-space-nowrap">
                  Registrar aire incorporado
                </label>
              </div>
            </div>
          </div>
        </div>

        {(useProbetas || useTemperatura || useAsentamiento || useAireIncorporado) && (
          <Divider className="m-0 mb-3" />
        )}

        {/* ---------- probetas ---------- */}
        {useProbetas && (
          <div className="box-card p-3 pb-1 col-12 mb-2">
            <div className="flex flex-column xl:flex-row align-items-center justify-content-between mb-3">
              <div className="w-full flex justify-content-between xl:justify-content-start align-items-center">
                <h3 className="m-0 p-0 mr-3">
                  <i className="fa-solid fa-flask mr-2" />
                  Probetas
                </h3>
                <Button
                  type="button"
                  icon="fa-solid fa-plus"
                  label={isOnPhone ? null : "Agregar probeta"}
                  onClick={addProbeta}
                  rounded
                  size="small"
                  disabled={!idTipoProbeta || !idModalidadMuestra}
                />
              </div>
              <div className="w-full gap-2 flex align-items-center justify-content-end mt-2 xl:mt-0">
                <div className="w-6 xl:w-3 flex flex-column">
                  <label style={{ fontSize: '0.8rem' }} className="text-center">Tipo probeta</label>
                  <Dropdown
                    value={idTipoProbeta}
                    onChange={(e) => setIdTipoProbeta(e.value)}
                    options={mapOpt(tiposProbeta, "tipo", "idTipoProbeta")}
                    placeholder="Tipo probeta"
                    className=""
                  />
                </div>
                <div className="w-6 xl:w-4 flex flex-column">
                  <label style={{ fontSize: '0.8rem' }} className="text-center">Modalidad</label>
                  <Dropdown
                    value={idModalidadMuestra}
                    onChange={(e) => setIdModalidadMuestra(e.value)}
                    options={mapOpt(modalidades, "modalidad", "idModalidadMuestra")}
                    placeholder="Modalidad"
                  />
                </div>


              </div>
            </div>

            {probetas.map((p, idx) => (
              <Fade key={idx} direction="in" duration={500} triggerOnce>
                <div className="p-3 mb-2 form-card br-7 flex flex-column md:flex-row gap-3 align-items-center">
                  <span className="font-bold">{p.nombre}</span>

                  <Dropdown
                    showClear
                    value={p.idEstadoProbeta}
                    disabled={isOperario}
                    onChange={(e) =>
                      handleProbChange(idx, "idEstadoProbeta", e.value)
                    }
                    options={mapOpt(estadosProbeta, "estado", "idEstadoProbeta")}
                    placeholder="Estado"
                    className="w-full md:w-3"
                  />

                  <InputText
                    value={p.codigo}
                    onChange={(e) =>
                      handleProbChange(idx, "codigo", e.target.value)
                    }
                    placeholder="Código"
                    className="w-full md:w-10rem"
                  />

                  <InputText
                    value={p.observaciones}
                    onChange={(e) =>
                      handleProbChange(idx, "observaciones", e.target.value)
                    }
                    placeholder="Observaciones"
                    className="w-full md:flex-1"
                  />

                  <div className="flex flex-column md:flex-row align-items-center gap-2">
                    <div className="flex align-items-center">
                      <label className="mr-2">Días de rotura</label>
                      <InputNumber
                        value={p.diasRotura}
                        onChange={(e) =>
                          handleProbChange(idx, "diasRotura", e.value)
                        }
                        min={1}
                        size={1}
                      />
                    </div>
                    <small className="text-xs">
                      {getFechaRotura(
                        fechaDespacho,
                        horaDespacho,
                        p.diasRotura
                      )}
                    </small>
                  </div>

                  <Button
                    type="button"
                    icon="fa-solid fa-trash"
                    text
                    label={isOnPhone ? 'Borrar' : ''}
                    severity="danger"
                    onClick={() => removeProbeta(idx)}
                  />
                </div>
              </Fade>
            ))}
          </div>
        )}

        {/* ---------- temperatura y asentamiento ---------- */}
        <div className="flex flex-column xl:flex-row w-full gap-2">
          {useTemperatura && (
            <div className="flex w-full xl:w-auto box-card gap-2 flex-column">
              <h3 className="m-0 p-0 mr-3">
                <i className="fa-solid fa-temperature-half mr-2" />
                Temperatura
              </h3>
              <div className="flex justify-content-between gap-3">
                <div className="flex flex-column">
                  <label>Ambiente (°C)</label>
                  <InputNumber
                    value={temperaturaAmbiente}
                    onChange={(e) => setTemperaturaAmbiente(e.value)}
                    minFractionDigits={1}
                    locale="es-AR"
                    suffix=" °C"
                    size={1}
                  />
                </div>
                <div className="flex flex-column">
                  <label>Hormigón (°C)</label>
                  <InputNumber
                    value={temperaturaHormigon}
                    onChange={(e) => setTemperaturaHormigon(e.value)}
                    minFractionDigits={1}
                    locale="es-AR"
                    suffix=" °C"
                    size={1}
                  />
                </div>
              </div>
            </div>
          )}

          {useAsentamiento && (
            <div className="flex flex-column box-card">
              <h3 className="m-0 p-0 mb-2 mr-3">
                <i className="fa-solid fa-ruler mr-2" />
                Asentamiento
              </h3>
              <label>Asentamiento (cm)</label>
              <InputNumber
                value={valorAsentamiento}
                onChange={(e) => setValorAsentamiento(e.value)}
                minFractionDigits={1}
                locale="es-AR"
                suffix=" cm"
              />
            </div>
          )}

          {useAireIncorporado && (
            <div className="flex flex-column box-card">
              <h3 className="m-0 p-0 mb-2 mr-3">
                <i className="fa-solid fa-wind mr-2" />
                Aire incorporado
              </h3>
              <label>Aire incorporado (%)</label>
              <InputNumber
                value={aireIncorporado}
                onChange={(e) => setAireIncorporado(e.value)}
                minFractionDigits={2}
                locale="es-AR"
                suffix="%"
              />
            </div>
          )}
        </div>

        {/* ---------- botones (solo standalone) ---------- */}
        {!embedded && (
          <div className="flex justify-content-end gap-2 mt-4 col-12">
            <Button
              label="Volver"
              text
              rounded
              size="small"
              onClick={() => window.history.back()}
            />
            <Button
              label="Guardar"
              icon="fa-solid fa-check"
              size="small"
              rounded
              onClick={handleSave}
              disabled={saving}
              loading={saving}
            />
          </div>
        )}
      </div>
    </Fade>
  );

  /* ───── helpers sólo para modo standalone ───── */
  function navigate() { } // placeholder to satisfy lint when embedded
}

/* ══════════════════════════════════════════════
   2. Componente autónomo (página) ‑– mismo archivo
   ══════════════════════════════════════════════ */
export function MuestraFormStandalone() {
  const { modo, id } = useParams();      // modo = 'nueva' | 'editar'
  const editing = modo === "editar";
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // Al crear una muestra propia desde la pantalla de Muestras, el usuario
  // elige primero el despacho (DespachoSelectorDialog) y llega acá con
  // ?idDespacho=N. El contexto (cliente/planta/tipo/obra/dosificación) se
  // hidrata desde ese despacho y queda read-only; el backend re-snapshotea.
  const idDespachoParam = !editing ? searchParams.get("idDespacho") : null;
  const toast = useToast();
  const { user } = useUserContext();
  // M-UX-03 fix (auditoría 08, Bloque 1): igual que en ensayoForm.jsx — isOperario
  // es true sólo cuando el único rol del usuario es OPERADOR. RESPONSABLE/DT/ADMIN
  // pueden elegir el operador asignado a la muestra.
  const isOperario = hasRole(user, ROLES.OPERADOR)
      && !hasRole(user, ROLES.RESPONSABLE, ROLES.DIRECTOR_TECNICO, ROLES.ADMIN);

  /* ---------- catálogos ---------- */
  const [operadores, setOperadores] = useState([]);
  const [estadosProbeta, setEstadosProbeta] = useState([]);
  const [tiposProbeta, setTiposProbeta] = useState([]);
  const [modalidades, setModalidades] = useState([]);
  const [probetaConfig, setProbetaConfig] = useState({});
  const [clientes, setClientes] = useState([]);
  const [obras, setObras] = useState([]);
  const [plantas, setPlantas] = useState([]);
  const [tiposHormigon, setTiposHormigon] = useState([]);
  const [dosificaciones, setDosificaciones] = useState([]);
  // Dosificaciones del Diseñador (motor de Calidad). Conviven con las legacy en
  // el dropdown de "Dosificación" — un despacho del Diseñador referencia una de
  // estas, no una `Dosificacion` estática.
  const [dosificacionesDisenadas, setDosificacionesDisenadas] = useState([]);
  const defaultDays = [
    probetaConfig.probetaSerieUno ?? 7,
    probetaConfig.probetaSerieDos ?? 28,
    probetaConfig.probetaSerieTres ?? 28,
    probetaConfig.probetaSerieCuatro ?? 56,
  ];

  useEffect(() => {
    const fetchConfig = async () => {
      try {
        const { data } = await axios.get(`${config.backendUrl}/api/config/probetas`, { headers: config.headers });
        setProbetaConfig(data);
      } catch (err) {
        console.error(err);
      }
    };
    fetchConfig();
  }, []);

  /* ---------- auto-asignar operador para operarios ---------- */
  useEffect(() => {
    if (isOperario && user?.idEmpleado) {
      setIdOperador(user.idEmpleado);
    }
  }, [isOperario, user?.idEmpleado]);

  /* ---------- estado propio ---------- */
  const [idOperador, setIdOperador] = useState(null);
  const [useProbetas, setUseProbetas] = useState(false);
  const [useTemperatura, setUseTemperatura] = useState(false);
  const [useAsentamiento, setUseAsentamiento] = useState(false);
  const [useAireIncorporado, setUseAireIncorporado] = useState(false);
  const [aireIncorporado, setAireIncorporado] = useState(null);
  const [probetas, setProbetas] = useState([]);
  const [temperaturaAmbiente, setTemperaturaAmbiente] = useState(null);
  const [temperaturaHormigon, setTemperaturaHormigon] = useState(null);
  const [valorAsentamiento, setValorAsentamiento] = useState(null);
  /** Fecha y hora base usadas para calcular fechaRotura visualmente.
   *  Para muestras con despacho: vienen del despacho original.
   *  Para muestras sin despacho: vienen del campo "fecha" propio + 12:00. */
  const [fechaBase, setFechaBase] = useState(null);
  const [horaBase, setHoraBase] = useState(null);
  const [tieneDespacho, setTieneDespacho] = useState(false);
  // Despacho asociado al crear (viene por ?idDespacho). Se envía en el payload
  // para que el backend snapshotee el contexto. `despachoInfo` es solo para el
  // banner informativo.
  const [idDespachoLink, setIdDespachoLink] = useState(null);
  const [despachoInfo, setDespachoInfo] = useState(null);

  // N-01 etiqueta QR (sesión 2026-05-09): dialog post-creación que ofrece
  // imprimir las etiquetas QR de las probetas recién moldeadas.
  const [etiquetasDialog, setEtiquetasDialog] = useState({ open: false, muestra: null, probetas: [] });
  const [etiquetasFormato, setEtiquetasFormato] = useState('a4'); // 'a4' | 'termica'

  // Campos contextuales de la Muestra (snapshot propio).
  const [idCliente, setIdCliente] = useState(null);
  const [idTipoHormigon, setIdTipoHormigon] = useState(null);
  const [idPlanta, setIdPlanta] = useState(null);
  const [idObra, setIdObra] = useState(null);
  const [idDosificacion, setIdDosificacion] = useState(null);
  // FK a DosificacionDisenada cuando la muestra proviene de un despacho del
  // Diseñador. Mutuamente excluyente con idDosificacion.
  const [idDosificacionDisenada, setIdDosificacionDisenada] = useState(null);
  const [remito, setRemito] = useState('');
  const [lote, setLote] = useState(1);
  const [loadNewProbeta, setLoadNewProbeta] = useState(false);

  const [saving, setSaving] = useState(false);
  // Guard síncrono contra doble submit: el estado `saving` no commitea a tiempo
  // si el hilo JS está congelado y el usuario encola varios clicks. El ref se
  // setea en el mismo tick, así que bloquea reentradas aunque React no haya
  // re-renderizado todavía.
  const savingRef = useRef(false);
  const [idTipoProbeta, setIdTipoProbeta] = useState(null);
  const [idModalidadMuestra, setIdModalidadMuestra] = useState(null);
  const [loading, setLoading] = useState(false);

  /* ---------- catálogos al montar ---------- */
  useEffect(() => {
    (async () => {
      setLoading(true);
      try {
        const [
          { data: empleados },
          { data: estados },
          { data: tipos },
          { data: mods },
          { data: cli },
          { data: ob },
          { data: pl },
          { data: horm },
        ] = await Promise.all([
          axios.get(`${config.backendUrl}/api/empleados`, { headers: config.headers }),
          // [VITRINA] El módulo Despachos (Producción/Betonmatic) está recortado:
          // /api/despachos/estadoprobeta devuelve 404 y rechazaría todo el
          // Promise.all (dejando TODOS los dropdowns vacíos). Lo degradamos a []
          // para que el resto del lote (cliente, planta, tipo de hormigón,
          // operador) cargue igual. Los estados de probeta se asignan server-side.
          Promise.resolve({ data: [] }),
          axios.get(`${config.backendUrl}/api/muestras/tipoprobeta`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/muestras/modalidades`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/clientes`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/obras`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/plantas`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/muestras/tipohormigon`, { headers: config.headers }),
        ]);
        try {
          const { data: dosifs } = await axios.get(`${config.backendUrl}/api/dosificaciones`, { headers: config.headers });
          setDosificaciones(Array.isArray(dosifs) ? dosifs : []);
        } catch {
          setDosificaciones([]);
        }
        try {
          const { data: disenadas } = await axios.get(`${config.backendUrl}/api/dosificaciones-diseno`, { headers: config.headers });
          setDosificacionesDisenadas(Array.isArray(disenadas) ? disenadas : []);
        } catch {
          setDosificacionesDisenadas([]);
        }
        setOperadores(
          empleados.map((e) => ({
            ...e,
            fullName: `${e.apellido}, ${e.nombre}`,
          }))
        );
        setEstadosProbeta(estados);
        setTiposProbeta(tipos);
        setModalidades(mods);
        setClientes(cli);
        setObras(ob);
        setPlantas(pl);
        setTiposHormigon(horm);
      } catch {
        toast("error", "No se pudieron cargar los catálogos");
      } finally {
        setLoading(false);
      }
    })();
  }, []);

  /* ---------- cargar muestra si editamos ---------- */
  useEffect(() => {
    if (!editing) return;
    (async () => {
      setLoading(true);
      try {
        const { data } = await axios.get(
          `${config.backendUrl}/api/muestras/${id}`,
          { headers: config.headers }
        );
        // 1. estado principal
        setIdOperador(data.idOperador);
        setUseProbetas(!!data.probetas?.length);
        setIdTipoProbeta(data.idTipoProbeta);
        setIdModalidadMuestra(data.idModalidadMuestra);
        setUseTemperatura(
          data.temperaturaAmbiente !== null ||
          data.temperaturaHormigon !== null
        );
        setUseAsentamiento(data.asentamiento !== null);
        setUseAireIncorporado(data.aireincorporado !== null);

        // 2. probetas
        if (data.probetas?.length) {
          const loteActual = data.probetas[0].nombre
            ? Number(data.probetas[0].nombre.match(/^L(\d+)/)[1])
            : 1;
          const mapped = data.probetas.map((p, idx) => ({
            idProbeta: p.idProbeta,
            nombre: p.nombre,
            lote: loteActual,
            idEstadoProbeta: p.idEstadoProbeta ?? 1,
            observaciones: p.observaciones || "",
            codigo: p.codigo || "",
            diasRotura:
              Number(p.diasRotura) ??
              Math.round(
                (new Date(p.fechaRotura) -
                  new Date(`${data.fecha ?? data.despacho?.fecha}T${data.despacho?.hora || '12:00:00'}`)) /
                msDia
              ) ??
              defaultDays[idx] ??
              probetaConfig.probetaSerieCuatro,
          }));
          setProbetas(renameAndReindex(mapped, loteActual));
        }

        // 3. temperatura / asentamiento
        setTemperaturaAmbiente(data.temperaturaAmbiente ?? null);
        setTemperaturaHormigon(data.temperaturaHormigon ?? null);
        setValorAsentamiento(data.asentamiento ?? null);
        setAireIncorporado(data.aireincorporado ?? null);

        // 4. fecha y hora de despacho (para calc. rotura)
        // contexto de la muestra (campos propios con fallback a despacho)
        setIdCliente(data.idCliente ?? data.despacho?.idCliente ?? null);
        setIdTipoHormigon(
          data.idTipoHormigon ??
          data.despacho?.dosificacion?.idTipoHormigon ??
          data.despacho?.dosificacionDisenada?.idTipoHormigon ??
          null
        );
        setIdPlanta(data.idPlanta ?? data.despacho?.idPlanta ?? null);
        setIdObra(data.idObra ?? data.despacho?.idObra ?? null);
        setIdDosificacion(data.idDosificacion ?? data.despacho?.idDosificacion ?? null);
        setIdDosificacionDisenada(
          data.idDosificacionDisenada ?? data.despacho?.idDosificacionDisenada ?? null
        );
        setRemito(data.remito ?? data.despacho?.remito ?? '');
        setTieneDespacho(!!data.idDespacho);

        // fecha y hora base para calc. rotura visual
        const fechaSource = data.fecha ?? data.despacho?.fecha;
        if (fechaSource) setFechaBase(parseLocalDate(fechaSource));
        setHoraBase(data.despacho?.hora ?? '12:00');
      } catch {
        toast("error", "No se pudo cargar la muestra");
        navigate("/calidad/ensayos/muestras");
      } finally {
        setLoading(false);
      }
    })();
  }, [editing, id]);

  /* ---------- cargar despacho asociado (alta con ?idDespacho) ---------- */
  useEffect(() => {
    if (editing || !idDespachoParam) return;
    (async () => {
      try {
        const { data: d } = await axios.get(
          `${config.backendUrl}/api/despachos/${idDespachoParam}`,
          { headers: config.headers }
        );
        if (!d) return;
        // Hidratar contexto desde el despacho (mismo criterio que
        // snapshotFromDespacho del backend).
        setIdCliente(d.idCliente ?? null);
        // El tipo de hormigón puede venir de la dosificación legacy o de la
        // diseñada (despachos del Diseñador). Sin el fallback a dosificacionDisenada
        // el campo quedaba vacío para todo despacho con origen DISENADOR.
        setIdTipoHormigon(
          d.dosificacion?.idTipoHormigon
          ?? d.dosificacionDisenada?.idTipoHormigon
          ?? null
        );
        setIdPlanta(d.idPlanta ?? null);
        setIdObra(d.idObra ?? null);
        setIdDosificacion(d.idDosificacion ?? null);
        setIdDosificacionDisenada(d.idDosificacionDisenada ?? null);
        setRemito(d.remito ?? '');
        if (d.fecha) setFechaBase(parseLocalDate(d.fecha));
        setHoraBase(d.hora ?? '12:00');
        setTieneDespacho(true);
        setIdDespachoLink(d.idDespacho);
        setDespachoInfo({
          idDespacho: d.idDespacho,
          cliente:
            d.cliente?.tipoPersona === 'Jurídica'
              ? d.cliente?.razonSocial
              : [d.cliente?.apellido, d.cliente?.nombre].filter(Boolean).join(', ')
                || d.cliente?.razonSocial || d.cliente?.nombre,
          remito: d.remito,
          fecha: d.fecha,
        });
      } catch {
        toast("error", "No se pudo cargar el despacho seleccionado");
      }
    })();
  }, [editing, idDespachoParam]);

  const renameAndReindex = (arr, loteActual) =>
    [...arr]
      .sort((a, b) => (a.diasRotura ?? 0) - (b.diasRotura ?? 0))
      .map((p, i) => ({
        ...p,
        nombre: `L${loteActual}P${i + 1}`,
        diasRotura: p.diasRotura ?? defaultDays[i] ?? probetaConfig.probetaSerieCuatro,
      }));

  /**
   * Calcula el próximo número de lote disponible para esa fecha + planta.
   * Considera tanto las muestras propias con o sin despacho — la búsqueda usa
   * los campos directos de Muestra (`fecha`, `idPlanta`).
   */
  const fetchLote = async () => {
    if (!fechaBase || !idPlanta) return 1;
    const fechaISO = fechaBase.toISOString().slice(0, 10);
    try {
      const { data } = await axios.get(
        `${config.backendUrl}/api/muestras`,
        { headers: config.headers }
      );
      const lotes = (data || [])
        .filter((m) => {
          const f = (m.fecha ?? m.despacho?.fecha ?? '').slice(0, 10);
          const p = m.idPlanta ?? m.despacho?.idPlanta ?? m.planta?.idPlanta;
          return f === fechaISO && p === idPlanta;
        })
        .map((m) => {
          const nombre = m.probetas?.[0]?.nombre;
          const match = nombre?.match(/^L(\d+)/);
          return match ? Number(match[1]) : null;
        })
        .filter((n) => n != null)
        .sort((a, b) => a - b);
      let next = 1;
      for (const n of lotes) {
        if (n !== next) break;
        next++;
      }
      return next;
    } catch {
      return 1;
    }
  };

  /* Cuando cambia fecha o planta, recalcular lote sugerido y renombrar las
   * probetas ya cargadas (sin pisar las que estamos editando). */
  useEffect(() => {
    if (editing) return;
    if (!fechaBase || !idPlanta) return;
    (async () => {
      const nuevo = await fetchLote();
      setLote(nuevo);
      setProbetas((prev) => prev.length ? renameAndReindex(prev, nuevo) : prev);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fechaBase, idPlanta, editing]);

  /* ---------- helpers probetas ---------- */
  const addProbeta = async () => {
    if (loadNewProbeta) return;
    setLoadNewProbeta(true);
    let loteActual = lote;
    if (!probetas.length) {
      if (!fechaBase) {
        setLoadNewProbeta(false);
        return toast('warn', 'Indicá la fecha de la muestra primero');
      }
      if (!idPlanta) {
        setLoadNewProbeta(false);
        return toast('warn', 'Seleccioná la planta primero');
      }
      if (!editing) {
        loteActual = await fetchLote();
        setLote(loteActual);
      }
    }
    const idx = probetas.length;
    const diasDefault = defaultDays[idx] ?? probetaConfig.probetaSerieCuatro ?? 28;
    setProbetas((prev) =>
      renameAndReindex(
        [
          ...prev,
          {
            lote: loteActual,
            idEstadoProbeta: 1,
            observaciones: '',
            codigo: '',
            diasRotura: diasDefault,
          },
        ],
        loteActual
      )
    );
    setLoadNewProbeta(false);
  };
  const removeProbeta = (idx) =>
    setProbetas((prev) => {
      const resto = prev.filter((_, i) => i !== idx);
      if (!resto.length) return [];
      return renameAndReindex(resto, resto[0].lote);
    });
  const handleProbChange = (idx, field, value) =>
    setProbetas((prev) =>
      prev.map((p, i) => (i === idx ? { ...p, [field]: value } : p))
    );

  /* ---------- guardar ---------- */
  const handleSave = async () => {
    // Guard de reentrada: evita que un doble click cree muestras duplicadas
    // si la app está lenta y el botón todavía no reflejó el estado `saving`.
    if (savingRef.current) return;
    if (!idOperador) return toast("warn", "Selecciona un operador");
    // En modo standalone (sin despacho) los campos contextuales son obligatorios.
    if (!tieneDespacho) {
      if (!fechaBase) return toast("warn", "Indica la fecha de la muestra");
      if (!idCliente) return toast("warn", "Selecciona el cliente");
      if (!idTipoHormigon) return toast("warn", "Selecciona el tipo de hormigón");
      if (!idPlanta) return toast("warn", "Selecciona la planta");
    }
    if (useProbetas && !probetas.length)
      return toast("warn", "Agrega al menos una probeta");
    // Solo la temperatura del hormigón es obligatoria si se tilda el check
    // (se usa para evaluación de fresco — Tabla 4.2 CIRSOC 200-2024 §4.1.1).
    // La temperatura ambiente queda opcional (s/d) para casos en que no se
    // midió o no se registró en obra.
    if (useTemperatura && temperaturaHormigon == null)
      return toast("warn", "Indica la temperatura del hormigón");
    if (useAsentamiento && valorAsentamiento == null)
      return toast("warn", "Indica el asentamiento");
    if (useAireIncorporado && aireIncorporado == null)
      return toast("warn", "Indica el aire incorporado");

    const payload = {
      idOperador,
      idTipoProbeta,
      idModalidadMuestra,
      probetas: useProbetas ? probetas : [],
      cantidadProbetas: useProbetas ? probetas.length : 0,
      temperaturaAmbiente: useTemperatura ? temperaturaAmbiente : null,
      temperaturaHormigon: useTemperatura ? temperaturaHormigon : null,
      asentamiento: useAsentamiento ? valorAsentamiento : null,
      aireincorporado: useAireIncorporado ? aireIncorporado : null,
    };

    // Campos contextuales solo se mandan cuando la muestra no tiene despacho
    // (al crearse desde despacho los snapshotea el backend) o cuando estamos
    // editando una muestra existente sin despacho.
    if (!tieneDespacho) {
      payload.fecha = fechaBase.toISOString().split('T')[0];
      payload.idCliente = idCliente;
      payload.idTipoHormigon = idTipoHormigon;
      payload.idPlanta = idPlanta;
      payload.idObra = idObra ?? null;
      payload.idDosificacion = idDosificacion ?? null;
      payload.idDosificacionDisenada = idDosificacionDisenada ?? null;
      payload.remito = remito?.trim() ? remito.trim() : null;
    } else if (!editing && idDespachoLink) {
      // Alta de muestra asociada a un despacho elegido en el selector: el
      // backend hace el snapshot del contexto desde el despacho.
      payload.idDespacho = idDespachoLink;
    }

    try {
      savingRef.current = true;
      setSaving(true);
      if (editing) {
        await axios.put(
          `${config.backendUrl}/api/muestras/${id}`,
          payload,
          { headers: config.headers }
        );
        toast("success", "Muestra actualizada");
        navigate("/calidad/ensayos/muestras");
      } else {
        const { data: muestraCreada } = await axios.post(
          `${config.backendUrl}/api/muestras`,
          payload,
          { headers: config.headers }
        );
        toast("success", "Muestra registrada");
        // N-01 etiqueta QR (sesión 2026-05-09): si la muestra trae probetas
        // recién creadas, ofrecer impresión del PDF de etiquetas. El usuario
        // puede saltar el paso ("Más tarde") y volver a hacerlo desde la
        // vista "Etiquetas pendientes".
        const probetasNuevas = (muestraCreada?.probetas || []).filter((p) => p?.idProbeta);
        if (probetasNuevas.length > 0) {
          setEtiquetasDialog({
            open: true,
            muestra: muestraCreada,
            probetas: probetasNuevas,
          });
        } else {
          navigate("/calidad/ensayos/muestras");
        }
      }
    } catch {
      toast("error", "Error al guardar");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  };
  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }
  /* ---------- render ---------- */
  const clienteLabel = (c) => {
    if (!c) return '';
    if (c.tipoPersona === 'Jurídica') return c.razonSocial || c.nombre || '';
    const apellidoNombre = [c.apellido, c.nombre].filter(Boolean).join(', ');
    return apellidoNombre || c.nombre || c.razonSocial || '';
  };
  const clienteOpts = clientes.map((c) => ({
    label: clienteLabel(c),
    value: c.idCliente,
  }));
  const obraOpts = mapOpt(obras, 'nombre', 'idObra');
  const plantaOpts = mapOpt(plantas, 'nombre', 'idPlanta');
  const hormOpts = mapOpt(tiposHormigon, 'tipoHormigon', 'idTipoHormigon');
  // Dropdown único que combina dosificaciones legacy y diseñadas. Como ambas
  // numeran sus ids por separado, los valores se prefijan: `L<id>` para la
  // legacy (idDosificacion) y `D<id>` para la diseñada (id). Son mutuamente
  // excluyentes: al elegir una se limpia la otra.
  const dosifOpts = [
    ...dosificaciones.map((d) => ({
      label: d.codigoEnPlanta ? `${d.codigoEnPlanta} — ${d.nombre || ''}` : (d.nombre || `Dosificación ${d.idDosificacion}`),
      value: `L${d.idDosificacion}`,
    })),
    ...dosificacionesDisenadas.map((d) => ({
      label: `${d.nombre || `Diseño ${d.id}`} (Diseñador)`,
      value: `D${d.id}`,
    })),
  ];
  const dosifValue =
    idDosificacionDisenada != null ? `D${idDosificacionDisenada}`
    : idDosificacion != null ? `L${idDosificacion}`
    : null;
  const handleDosifChange = (val) => {
    if (val == null) {
      setIdDosificacion(null);
      setIdDosificacionDisenada(null);
    } else if (val.startsWith('D')) {
      setIdDosificacionDisenada(Number(val.slice(1)));
      setIdDosificacion(null);
    } else {
      setIdDosificacion(Number(val.slice(1)));
      setIdDosificacionDisenada(null);
    }
  };
  const ctxReadOnly = tieneDespacho;

  /* N-01 etiqueta QR (sesión 2026-05-09): handlers del dialog post-creación. */
  const cerrarDialogEtiquetas = () => {
    setEtiquetasDialog({ open: false, muestra: null, probetas: [] });
    navigate("/calidad/ensayos/muestras");
  };

  const imprimirEtiquetasNuevas = async () => {
    const { muestra, probetas: probetasNuevas } = etiquetasDialog;
    if (!probetasNuevas || probetasNuevas.length === 0) return;

    // Hidratamos cada probeta con el contexto de la muestra que se acaba
    // de crear, para que el PDF tenga cliente/obra/planta/tipo sin un
    // round-trip adicional.
    const clienteSnap = clientes.find((c) => c.idCliente === (muestra?.idCliente ?? idCliente));
    const obraSnap = obras.find((o) => o.idObra === (muestra?.idObra ?? idObra));
    const plantaSnap = plantas.find((p) => p.idPlanta === (muestra?.idPlanta ?? idPlanta));
    const tipoSnap = tiposHormigon.find((t) => t.idTipoHormigon === (muestra?.idTipoHormigon ?? idTipoHormigon));
    const fechaConfeccion = muestra?.fecha || (fechaBase ? fechaBase.toISOString().slice(0, 10) : null);

    const items = probetasNuevas.map((p) => ({
      idProbeta: p.idProbeta,
      nombre: p.nombre,
      codigo: p.codigo,
      tipoHormigon: tipoSnap?.tipoHormigon ?? null,
      diasRotura: p.diasRotura,
      fechaConfeccion,
      fechaRotura: p.fechaRotura,
      fcMpa: tipoSnap?.fcMpa ?? null,
      cliente: clienteSnap ? clienteLabel(clienteSnap) : null,
      obra: obraSnap?.nombre ?? null,
      planta: plantaSnap?.nombre ?? null,
    }));

    try {
      await downloadEtiquetasProbetaQr(items, {
        baseUrl: `${window.location.origin}/p/`,
        formato: etiquetasFormato,
      });
      // Marcar como impresas en backend (trazabilidad).
      await axios.post(
        `${config.backendUrl}/api/probetas/etiquetas-impresas`,
        { idsProbeta: items.map((p) => p.idProbeta) },
        { headers: config.headers },
      );
      toast('success', `Etiquetas generadas para ${items.length} probeta(s)`);
    } catch (err) {
      console.error('Error generando etiquetas QR:', err);
      toast('error', 'No se pudieron generar las etiquetas');
    } finally {
      cerrarDialogEtiquetas();
    }
  };

  return (
    <div className="w-full flex flex-column align-items-center justify-content-center py-5">
      <div className="form-card-header w-full xl:w-10 flex justify-content-between align-items-center">
        <h3 className="m-0 p-0">
          <i className="fa-solid fa-pencil mr-2"></i>
          {editing ? 'Editar muestra' : 'Nueva muestra'}
        </h3>
        <i
          className="fa-solid fa-circle-arrow-left cursor-pointer hover-red"
          style={{ fontSize: "1.2rem" }}
          onClick={() => navigate("/calidad/ensayos/muestras")}
        ></i>
      </div>
      <div className="form-card w-full xl:w-10 pb-0">
        {/* Banner del despacho asociado (alta desde el selector) */}
        {!editing && despachoInfo && (
          <div
            className="flex align-items-center gap-2 p-2 mb-2 border-round"
            style={{ background: 'var(--surface-100)', color: 'var(--text-color)' }}
          >
            <i className="fa-solid fa-truck-fast" style={{ color: 'var(--primary-color)' }} />
            <span className="text-sm">
              Muestra asociada al despacho
              {despachoInfo.cliente ? ` de ${despachoInfo.cliente}` : ''}
              {despachoInfo.remito ? ` · Remito ${despachoInfo.remito}` : ''}
              {despachoInfo.fecha ? ` · ${despachoInfo.fecha.split('-').reverse().join('/')}` : ''}
            </span>
          </div>
        )}
        {/* ---------- contexto de la muestra ---------- */}
        <div className="grid p-1 xl:p-3">
          <div className="flex flex-column w-full mb-2">
            <h3 className="m-0 p-0 mb-2">
              <i className="fa-solid fa-clipboard-list mr-2" />
              Contexto
              {ctxReadOnly && (
                <small className="ml-2 text-color-secondary">
                  (snapshot del despacho asociado)
                </small>
              )}
            </h3>
            <div className="grid">
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Fecha</label>
                <Calendar
                  value={fechaBase}
                  onChange={(e) => setFechaBase(e.value)}
                  dateFormat="dd/mm/yy"
                  showIcon
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Cliente</label>
                <Dropdown
                  value={idCliente}
                  onChange={(e) => setIdCliente(e.value)}
                  options={clienteOpts}
                  filter
                  showClear
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Tipo de hormigón</label>
                <Dropdown
                  value={idTipoHormigon}
                  onChange={(e) => setIdTipoHormigon(e.value)}
                  options={hormOpts}
                  filter
                  showClear
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Planta</label>
                <Dropdown
                  value={idPlanta}
                  onChange={(e) => setIdPlanta(e.value)}
                  options={plantaOpts}
                  filter
                  showClear
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Obra <small className="text-color-secondary">(opcional)</small></label>
                <Dropdown
                  value={idObra}
                  onChange={(e) => setIdObra(e.value)}
                  options={obraOpts}
                  filter
                  showClear
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Dosificación <small className="text-color-secondary">(opcional)</small></label>
                <Dropdown
                  value={dosifValue}
                  onChange={(e) => handleDosifChange(e.value)}
                  options={dosifOpts}
                  filter
                  showClear
                  disabled={ctxReadOnly}
                />
              </div>
              <div className="flex flex-column col-12 sm:col-6 lg:col-3">
                <label>Remito <small className="text-color-secondary">(opcional)</small></label>
                <InputText
                  value={remito}
                  onChange={(e) => setRemito(e.target.value)}
                  placeholder="N° de remito"
                  disabled={ctxReadOnly}
                />
              </div>
            </div>
          </div>
          <Divider className="m-0 mb-3" />
        </div>

        <MuestraForm
          /* modo */
          embedded={false}
          isOperario={isOperario}
          /* fecha base para calc. visual de fechaRotura */
          fechaDespacho={fechaBase}
          horaDespacho={horaBase}
          /* estado + setters */
          idOperador={idOperador}
          setIdOperador={setIdOperador}
          useProbetas={useProbetas}
          setUseProbetas={setUseProbetas}
          useTemperatura={useTemperatura}
          setUseTemperatura={setUseTemperatura}
          useAsentamiento={useAsentamiento}
          setUseAsentamiento={setUseAsentamiento}
          useAireIncorporado={useAireIncorporado}
          setUseAireIncorporado={setUseAireIncorporado}
          probetas={probetas}
          addProbeta={addProbeta}
          removeProbeta={removeProbeta}
          handleProbChange={handleProbChange}
          temperaturaAmbiente={temperaturaAmbiente}
          setTemperaturaAmbiente={setTemperaturaAmbiente}
          temperaturaHormigon={temperaturaHormigon}
          setTemperaturaHormigon={setTemperaturaHormigon}
          valorAsentamiento={valorAsentamiento}
          setValorAsentamiento={setValorAsentamiento}
          aireIncorporado={aireIncorporado}
          setAireIncorporado={setAireIncorporado}
          /* catálogos */
          operadores={operadores}
          estadosProbeta={estadosProbeta}
          /* botones standalone */
          handleSave={handleSave}
          saving={saving}
          idTipoProbeta={idTipoProbeta}
          setIdTipoProbeta={setIdTipoProbeta}
          idModalidadMuestra={idModalidadMuestra}
          setIdModalidadMuestra={setIdModalidadMuestra}
          tiposProbeta={tiposProbeta}
          modalidades={modalidades}
        />
      </div>

      {/* N-01 etiqueta QR (sesión 2026-05-09): dialog post-creación. */}
      <Dialog
        header={
          <div className="flex align-items-center gap-2">
            <i className="fa-solid fa-qrcode" style={{ color: '#1e3a5f' }} />
            <span>Imprimir etiquetas QR</span>
          </div>
        }
        visible={etiquetasDialog.open}
        onHide={cerrarDialogEtiquetas}
        style={{ width: '90vw', maxWidth: '520px' }}
        modal
      >
        <div className="flex flex-column gap-3 mt-2">
          <p className="m-0">
            Se crearon <strong>{etiquetasDialog.probetas.length}</strong>{' '}
            probeta{etiquetasDialog.probetas.length !== 1 ? 's' : ''}. Imprimí
            las etiquetas QR ahora para pegarlas al desmoldar (24-48 h después
            del moldeo).
          </p>
          <div className="flex flex-column gap-2">
            <label className="font-semibold text-sm">Formato de impresión</label>
            <div className="flex gap-3 flex-wrap">
              <label className="flex align-items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="formato-etiquetas"
                  value="a4"
                  checked={etiquetasFormato === 'a4'}
                  onChange={() => setEtiquetasFormato('a4')}
                />
                <span className="text-sm">
                  <strong>A4</strong> · grilla 3×7 (papel adhesivo común)
                </span>
              </label>
              <label className="flex align-items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="formato-etiquetas"
                  value="termica"
                  checked={etiquetasFormato === 'termica'}
                  onChange={() => setEtiquetasFormato('termica')}
                />
                <span className="text-sm">
                  <strong>Térmica</strong> · 60×40 mm (Zebra / Brady)
                </span>
              </label>
            </div>
            <small className="text-color-secondary">
              Para curado en pileta usá rollo de poliéster industrial (Brady
              B-7541 o equivalente) en impresora térmica. El papel A4 común
              sirve sólo para validación o curado al aire — se despega en
              pileta.{' '}
              <a
                href="/calidad/ensayos/probetas/etiquetado-doc"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: 'var(--primary-color)', textDecoration: 'underline' }}
              >
                Ver procedimiento operativo
              </a>.
            </small>
          </div>
          <div className="flex justify-content-end gap-2 mt-2">
            <Button
              label="Más tarde"
              icon="fa-solid fa-clock"
              outlined
              severity="secondary"
              onClick={cerrarDialogEtiquetas}
            />
            <Button
              label="Imprimir ahora"
              icon="fa-solid fa-print"
              onClick={imprimirEtiquetasNuevas}
            />
          </div>
        </div>
      </Dialog>
    </div>

  );
}

export default MuestraForm;
