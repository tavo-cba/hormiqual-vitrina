import React, { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Dialog } from "primereact/dialog";
import { Divider } from "primereact/divider";
import { Button } from "primereact/button";
import axios from "axios";
import { config } from "../../../../config/config";
import { formatDate, formatDateDMY } from "../../../../common/functions";
import LoadSpinner from "../../../../common/components/loadspinner/LoadSpinner";
import {
    ESTADO_PROBETA,
    ESTADO_PROBETA_LABEL,
    ESTADO_PROBETA_CLASS,
    ESTADOS_NO_ENSAYABLES,
} from "../../../../lib/constants/estadoProbeta";
import { generarCertificadoIndividualPdf } from "../certificadoIndividualPdf";
import { useToast } from "../../../../context/ToastContext";
import { useConfig } from "../../../../context/ConfigContext";
// El CSS de los badges vive en `../probeta.css` (con override dark mode).
import "../probeta.css";

const Field = ({ label, value, icon }) => (
    <div className="flex flex-column col-6 md:col-4 mb-2">
        <small className="text-500 mb-1">
            {icon && <i className={`${icon} mr-1`} />}
            {label}
        </small>
        <span className="font-medium">{value || "—"}</span>
    </div>
);

const ProbetaDetailDialog = ({ visible, onHide, idProbeta }) => {
    const [data, setData] = useState(null);
    const [loading, setLoading] = useState(false);
    const toast = useToast();
    const cfgEmpresa = useConfig();
    const navigate = useNavigate();

    const descargarCertificado = async () => {
        if (!data || data.idEstadoProbeta !== ESTADO_PROBETA.ENSAYADA) return;
        try {
            const { buffer, filename } = await generarCertificadoIndividualPdf(data, {
                nombreEmpresa: cfgEmpresa?.nombreEmpresa || 'HormiQual',
                direccion: cfgEmpresa?.direccion,
                logoLink: cfgEmpresa?.logoLink || cfgEmpresa?.logoLightLink || null,
                // P-V-03 (Bloque 21): respeta política configurada en Settings.
                politicaUnidadCarga: cfgEmpresa?.politicaUnidadCarga ?? 'ORIGINAL',
            });
            const blob = new Blob([buffer], { type: 'application/pdf' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = filename;
            document.body.appendChild(a);
            a.click();
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
            toast('success', 'Certificado generado');
        } catch (err) {
            console.error('Error generando certificado:', err);
            toast('error', err.message || 'No se pudo generar el certificado');
        }
    };

    useEffect(() => {
        if (!visible || !idProbeta) return;
        (async () => {
            setLoading(true);
            try {
                const { data: probeta } = await axios.get(
                    `${config.backendUrl}/api/probetas/${idProbeta}`,
                    { headers: config.headers }
                );
                setData(probeta);
            } catch {
                setData(null);
            } finally {
                setLoading(false);
            }
        })();
    }, [visible, idProbeta]);

    const onDialogHide = () => {
        onHide();
        setData(null);
    };

    if (!visible) return null;

    const esTercero = !!data?.idMuestraTerceros;
    // Probeta de pastón de prueba (propia, sin Muestra, ligada a MuestraPaston).
    const mp = data?.muestraPaston || null;
    const esPaston = !!(data?.esPaston || mp);
    const nombreCliente = (c) =>
        c ? (c.tipoPersona === "Jurídica" ? c.razonSocial : c.nombre) : null;
    const fecha = esPaston
        ? mp?.fecha
        : esTercero
            ? data?.muestraTerceros?.fecha
            : data?.muestra?.despacho?.fecha;
    const planta = esPaston
        ? mp?.planta?.nombre
        : esTercero
            ? data?.muestraTerceros?.planta?.nombre
            : data?.muestra?.despacho?.planta?.nombre;
    const cliente = esPaston
        ? nombreCliente(mp?.cliente)
        : esTercero
            ? nombreCliente(data?.muestraTerceros?.cliente)
            : nombreCliente(data?.muestra?.despacho?.cliente);
    const tipoHormigon = esPaston
        ? mp?.tipoHormigon?.tipoHormigon
        : esTercero
            ? data?.muestraTerceros?.tipoHormigon?.tipoHormigon
            : data?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon;
    const ensayo = data?.ensayo;
    const archivos = data?.archivos || [];

    // Acceso a la carga/edición del ensayo de rotura. El diálogo de detalle es
    // de solo lectura; este es el único puente desde el clic en el nombre de la
    // probeta hacia la pantalla donde se carga la resistencia. Disponible para
    // cualquier probeta que NO esté en estado terminal (mirror de
    // `ESTADOS_NO_ENSAYABLES` del backend). La ruta difiere según el origen:
    // las de terceros tienen su propia ruta de edición; propias y de pastón
    // comparten la ruta de probetas propias.
    const esTerminal = data ? ESTADOS_NO_ENSAYABLES.includes(data.idEstadoProbeta) : false;
    const puedeCargarEnsayo = !!data && !esTerminal;
    const irACargarEnsayo = () => {
        const ruta = esTercero
            ? `/calidad/ensayos/probetas-terceros/editar/${idProbeta}`
            : `/calidad/ensayos/probetas/editar/${idProbeta}`;
        onDialogHide();
        navigate(ruta);
    };

    const footerTemplate = () => (
        <div className="flex justify-content-end">
            <Button
                icon="fa-solid fa-flask-vial"
                label={ensayo ? "Editar ensayo" : "Cargar ensayo"}
                onClick={irACargarEnsayo}
            />
        </div>
    );

    const headerTemplate = () => (
        <div className="flex align-items-center gap-2 flex-wrap">
            <i className="fa-solid fa-flask" />
            <span className="font-bold text-lg">{data?.nombre || "Probeta"}</span>
            {data && (
                <span
                    className={ESTADO_PROBETA_CLASS[data.idEstadoProbeta] || 'estado-badge'}
                    style={{ fontSize: "0.85rem" }}
                >
                    {ESTADO_PROBETA_LABEL[data.idEstadoProbeta] || '-'}
                </span>
            )}
            {data?.idEstadoProbeta === ESTADO_PROBETA.ENSAYADA && data?.ensayo && (
                <Button
                    icon="fa-solid fa-file-pdf"
                    label="Certificado"
                    size="small"
                    severity="info"
                    text
                    onClick={descargarCertificado}
                    tooltip="N-04 — Certificado individual de ensayo (IRAM 1546)"
                    tooltipOptions={{ position: 'top' }}
                    className="ml-2"
                />
            )}
        </div>
    );

    return (
        <Dialog
            visible={visible}
            onHide={onDialogHide}
            header={headerTemplate}
            footer={!loading && puedeCargarEnsayo ? footerTemplate : null}
            className="w-11 md:w-8 xl:w-6"
            dismissableMask
            draggable={false}
        >
            {loading ? (
                <div className="flex justify-content-center p-5">
                    <LoadSpinner />
                </div>
            ) : !data ? (
                <p className="text-center text-500 p-4">No se encontró la probeta.</p>
            ) : (
                <div className="flex flex-column">
                    {/* ---- Datos generales ---- */}
                    <h4 className="m-0 mb-2">
                        <i className="fa-solid fa-info-circle mr-2" />
                        Información general
                    </h4>
                    <div className="flex flex-wrap">
                        <Field label="Nombre" value={data.nombre} />
                        <Field label="Código" value={data.codigo} />
                        <Field label="Estado" value={
                            <span className={ESTADO_PROBETA_CLASS[data.idEstadoProbeta] || 'estado-badge'}>
                                {ESTADO_PROBETA_LABEL[data.idEstadoProbeta] || '-'}
                            </span>
                        } />
                        <Field label="Fecha" value={formatDate(fecha)} />
                        <Field label="Planta" value={planta} />
                        {cliente && <Field label="Cliente" value={cliente} />}
                        {tipoHormigon && <Field label="Tipo H°" value={tipoHormigon} />}
                        <Field label="Días de rotura" value={data.diasRotura} />
                        <Field label="Rotura prevista" value={formatDateDMY(data.fechaRotura)} />
                    </div>

                    {data.observaciones && (
                        <div className="mb-3 px-2">
                            <small className="text-500">Observaciones</small>
                            <p className="m-0 mt-1">{data.observaciones}</p>
                        </div>
                    )}

                    {/* ---- Pastón de prueba (probeta propia confeccionada en un pastón) ---- */}
                    {esPaston && mp && (
                        <>
                            <Divider className="my-2" />
                            <h4 className="m-0 mb-2">
                                <i className="fa-solid fa-vials mr-2" />
                                Pastón de prueba
                            </h4>
                            <div className="flex flex-wrap">
                                <Field
                                    label="Confeccionada en"
                                    value={mp.origen === 'OBRA' ? 'Obra' : 'Planta'}
                                    icon="fa-solid fa-location-dot"
                                />
                                {mp.loteNumero && <Field label="Lote" value={mp.loteNumero} />}
                                {mp.obra?.nombre && <Field label="Obra" value={mp.obra.nombre} />}
                                {mp.dosificacion?.nombre && (
                                    <Field label="Dosificación" value={mp.dosificacion.nombre} />
                                )}
                            </div>
                        </>
                    )}

                    {/* ---- Ensayo ---- */}
                    {ensayo && (
                        <>
                            <Divider className="my-2" />
                            <h4 className="m-0 mb-2">
                                <i className="fa-solid fa-flask-vial mr-2" />
                                Ensayo de resistencia
                            </h4>
                            <div className="flex flex-wrap">
                                <Field label="Fecha ensayo" value={formatDate(ensayo.fechaEnsayo)} />
                                <Field label="Hora" value={ensayo.horaEnsayo?.slice(0, 5)} />
                                <Field label="Operario" value={
                                    ensayo.operarioEnsayo
                                        ? `${ensayo.operarioEnsayo.apellido}, ${ensayo.operarioEnsayo.nombre}`
                                        : "—"
                                } />
                                <Field label="Peso" value={ensayo.peso != null ? `${ensayo.peso} grs` : null} />
                                <Field label="Altura" value={ensayo.altura != null ? `${ensayo.altura} mm` : null} />
                                <Field label="Diámetro" value={ensayo.diametro != null ? `${ensayo.diametro} mm` : null} />
                                <Field label="Prensa" value={ensayo.prensa?.nombre} />
                                <Field label="Divisor" value={ensayo.lecturaPrensa} />
                                <Field label="Carga aplicada" value={ensayo.cargaAplicada != null ? `${Number(ensayo.cargaAplicada).toFixed(2)}` : null} />
                            </div>

                            <div className="flex justify-content-center my-3">
                                <div
                                    className="flex flex-column align-items-center p-3 border-round-lg"
                                    style={{ background: "#d1fae5", minWidth: 180 }}
                                >
                                    <small className="text-700 font-medium mb-1">Resistencia</small>
                                    <span className="text-3xl font-bold" style={{ color: "#047857" }}>
                                        {Number(ensayo.resistencia).toFixed(2)} MPa
                                    </span>
                                </div>
                            </div>

                            {ensayo.observaciones && (
                                <div className="mb-3 px-2">
                                    <small className="text-500">Observaciones del ensayo</small>
                                    <p className="m-0 mt-1">{ensayo.observaciones}</p>
                                </div>
                            )}
                        </>
                    )}

                    {/* ---- Archivos ---- */}
                    {archivos.length > 0 && (
                        <>
                            <Divider className="my-2" />
                            <h4 className="m-0 mb-2">
                                <i className="fa-solid fa-file mr-2" />
                                Archivos ({archivos.length})
                            </h4>
                            <div className="flex flex-column gap-2">
                                {archivos.map((a) => (
                                    <a
                                        key={a.idArchivo}
                                        href={a.url}
                                        target="_blank"
                                        rel="noreferrer"
                                        className="flex align-items-center gap-2 p-2 border-round hover:surface-100 text-primary no-underline"
                                    >
                                        <i className={a.mimeType?.startsWith("image/") ? "fa-solid fa-image" : "fa-solid fa-file-lines"} />
                                        <span>{a.nombreOriginal}</span>
                                    </a>
                                ))}
                            </div>
                        </>
                    )}
                </div>
            )}
        </Dialog>
    );
};

export default ProbetaDetailDialog;
