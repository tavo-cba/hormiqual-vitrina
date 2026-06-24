import React, { useEffect, useState, useCallback, useRef } from "react";
import axios from "axios";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Dialog } from "primereact/dialog";
import { InputText } from "primereact/inputtext";
import { confirmDialog } from "primereact/confirmdialog";
import { config } from "../../../config/config";

/**
 * Widget que muestra y opera el estado de publicación de una `DosificacionDisenada`
 * en Betonmatic. Pensado para vivir en la cabecera de la pantalla del diseñador
 * (DosificacionDisenoPage), debajo del banner de estado.
 *
 * Props:
 *   - dosificacion: { id, codigo, nombre, estado, idPlanta, planta? }
 *   - onPublishedChange?: callback al cambiar estado de publicación (refetch externo)
 *   - toastRef: ref al Toast de la página para feedback
 */
const BetonmaticPublicacionWidget = ({ dosificacion, onPublishedChange, toastRef }) => {
    const [loading, setLoading] = useState(true);
    const [estado, setEstado] = useState(null);
    const [actionLoading, setActionLoading] = useState(false);
    const actionLoadingRef = useRef(false);

    const [dialogVisible, setDialogVisible] = useState(false);
    const [codigoH, setCodigoH] = useState('');
    const [codigoF, setCodigoF] = useState('');

    const idDosif = dosificacion?.id;

    const fetchEstado = useCallback(async () => {
        if (!idDosif) return;
        setLoading(true);
        try {
            const res = await axios.get(
                `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/estado-publicacion`,
                { headers: config.headers }
            );
            setEstado(res.data);
        } catch (err) {
            console.error("Error consultando estado de publicación:", err);
            setEstado({ publicada: false, error: err.response?.data?.error || err.message });
        } finally {
            setLoading(false);
        }
    }, [idDosif]);

    useEffect(() => { fetchEstado(); }, [fetchEstado]);

    const notify = useCallback((severity, summary, detail) => {
        toastRef?.current?.show({ severity, summary, detail, life: severity === 'error' ? 8000 : 4000 });
    }, [toastRef]);

    // Auto-verificación de integridad al abrir la página: una sola vez por
    // montaje, sólo si la publicación nunca se verificó o la última verificación
    // tiene más de 12 h. Silenciosa salvo que detecte un problema real.
    const autoCheckedRef = useRef(false);
    useEffect(() => {
        if (autoCheckedRef.current || loading || !estado?.publicada) return;
        const ev = estado.estadoVerificacion;
        const ultimaMs = estado.ultimaVerificacion ? new Date(estado.ultimaVerificacion).getTime() : 0;
        const stale = ev === 'PENDIENTE' || !ultimaMs || (Date.now() - ultimaMs) > 12 * 3600 * 1000;
        if (!stale) return;
        autoCheckedRef.current = true;
        (async () => {
            try {
                const res = await axios.post(
                    `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/verificar`,
                    {},
                    { headers: config.headers }
                );
                const r = res.data || {};
                if (r.estadoVerificacion === 'DIVERGENTE') {
                    notify('error', 'La fórmula fue modificada en la planta',
                        `${(r.detalle || []).length} diferencia(s) respecto de lo publicado.`);
                } else if (r.estadoVerificacion === 'NO_ENCONTRADA') {
                    notify('error', 'La fórmula ya no está en Betonmatic', 'Fue borrada de la planta.');
                }
                await fetchEstado();
            } catch (err) {
                console.warn('Auto-verificación de integridad falló:', err.message);
            }
        })();
    }, [loading, estado, idDosif, notify, fetchEstado]);

    const abrirDialogoPublicar = () => {
        const def = dosificacion?.codigo || `DOSIF-${idDosif}`;
        setCodigoH(def);
        setCodigoF(def);
        setDialogVisible(true);
    };

    const handlePublicar = async () => {
        if (actionLoadingRef.current) return;
        if (!codigoH || !codigoF) {
            notify('warn', 'Faltan códigos', 'Cargá ambos códigos antes de publicar');
            return;
        }
        actionLoadingRef.current = true;
        setActionLoading(true);
        try {
            await axios.post(
                `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/publicar`,
                { codigoDeHormigon: codigoH, codigoDeFormula: codigoF },
                { headers: config.headers }
            );
            notify('success', 'Publicada en planta', `Fórmula ${codigoH} cargada en Betonmatic`);
            setDialogVisible(false);
            await fetchEstado();
            onPublishedChange?.();
        } catch (err) {
            console.error("Error publicando:", err);
            notify('error', 'No se pudo publicar', err.response?.data?.error || err.message);
        } finally {
            actionLoadingRef.current = false;
            setActionLoading(false);
        }
    };

    const handleVerificar = async () => {
        setActionLoading(true);
        try {
            const res = await axios.post(
                `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/verificar`,
                {},
                { headers: config.headers }
            );
            const ev = res.data.estadoVerificacion;
            const nDif = (res.data.detalle || []).length;
            if (ev === 'OK') {
                notify('success', 'Fórmula íntegra', 'Las dosis en Betonmatic coinciden con lo publicado.');
            } else if (ev === 'DIVERGENTE') {
                notify('error', 'La fórmula fue modificada en la planta',
                    `Se detectaron ${nDif} diferencia${nDif === 1 ? '' : 's'} respecto de lo publicado.`);
            } else if (ev === 'NO_ENCONTRADA') {
                notify('error', 'La fórmula ya no está en Betonmatic', 'Fue borrada de la planta. Volvé a publicarla.');
            } else if (ev === 'NO_VERIFICABLE') {
                notify('warn', 'Existe pero no se pudo comparar',
                    'La planta confirma que la fórmula está cargada, pero no devolvió sus valores para verificar las dosis.');
            } else {
                notify('warn', 'Verificación', `Estado: ${ev}`);
            }
            await fetchEstado();
        } catch (err) {
            notify('error', 'No se pudo verificar', err.response?.data?.error || err.message);
        } finally {
            setActionLoading(false);
        }
    };

    const handleRepublicar = () => {
        confirmDialog({
            message: `Se va a volver a publicar la fórmula ${estado?.codigoDeHormigon} en Betonmatic con los mapeos y dosis actuales. La publicación previa queda marcada como borrada. ¿Continuar?`,
            header: 'Re-publicar fórmula',
            icon: 'fa-solid fa-rotate',
            accept: async () => {
                if (actionLoadingRef.current) return;
                actionLoadingRef.current = true;
                setActionLoading(true);
                try {
                    await axios.post(
                        `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/publicar`,
                        {
                            codigoDeHormigon: estado?.codigoDeHormigon,
                            codigoDeFormula: estado?.codigoDeFormula,
                        },
                        { headers: config.headers }
                    );
                    notify('success', 'Re-publicada en planta', `Fórmula ${estado?.codigoDeHormigon} actualizada en Betonmatic`);
                    await fetchEstado();
                    onPublishedChange?.();
                } catch (err) {
                    notify('error', 'No se pudo re-publicar', err.response?.data?.error || err.message);
                } finally {
                    actionLoadingRef.current = false;
                    setActionLoading(false);
                }
            },
        });
    };

    const handleBorrar = () => {
        confirmDialog({
            message: `Se va a borrar la fórmula ${estado?.codigoDeHormigon} de Betonmatic. ¿Continuar?`,
            header: 'Borrar publicación',
            icon: 'fa-solid fa-trash',
            acceptClassName: 'p-button-danger',
            accept: async () => {
                if (actionLoadingRef.current) return;
                actionLoadingRef.current = true;
                setActionLoading(true);
                try {
                    await axios.delete(
                        `${config.backendUrl}/api/betonmatic/dosificacion-disenada/${idDosif}/publicacion`,
                        { headers: config.headers }
                    );
                    notify('success', 'Borrada de Betonmatic', '');
                    await fetchEstado();
                    onPublishedChange?.();
                } catch (err) {
                    notify('error', 'No se pudo borrar', err.response?.data?.error || err.message);
                } finally {
                    actionLoadingRef.current = false;
                    setActionLoading(false);
                }
            },
        });
    };

    if (loading || !estado) {
        return (
            <div className="form-card br-15 p-2 mt-2 text-sm text-color-secondary flex align-items-center gap-2">
                <i className="fa-solid fa-spinner fa-spin" />
                Consultando estado de publicación en Betonmatic…
            </div>
        );
    }

    // La planta de la dosificación no opera con Betonmatic → el widget no aplica.
    if (estado.betonmaticActivo === false && !estado.publicada) return null;

    const estadosOcultarWidget = ['DESCARTADO', 'ARCHIVADO'];
    if (estadosOcultarWidget.includes(dosificacion?.estado) && !estado.publicada) return null;

    // Severidad / etiqueta del estado de verificación de integridad.
    const verifInfo = (ev) => {
        switch (ev) {
            case 'OK': return { severity: 'success', label: 'Íntegra', icon: 'fa-solid fa-shield-halved' };
            case 'DIVERGENTE': return { severity: 'danger', label: 'Modificada en planta', icon: 'fa-solid fa-triangle-exclamation' };
            case 'NO_ENCONTRADA': return { severity: 'danger', label: 'No está en planta', icon: 'fa-solid fa-circle-xmark' };
            case 'NO_VERIFICABLE': return { severity: 'warning', label: 'No verificable', icon: 'fa-solid fa-circle-question' };
            default: return { severity: 'secondary', label: 'Sin verificar', icon: 'fa-solid fa-clock' };
        }
    };

    const describirDif = (d) => {
        const cod = d.codigoMaterial || '?';
        if (d.tipo === 'FALTANTE') return `${cod}: falta en la planta (publicado ${d.esperado})`;
        if (d.tipo === 'EXTRA') return `${cod}: agregado en la planta (${d.enPlanta}), no estaba publicado`;
        if (d.tipo === 'DOSIS_DISTINTA') return `${cod}: publicado ${d.esperado} · en planta ${d.enPlanta}`;
        return `${cod}: ${d.tipo}`;
    };

    const detalleVerif = Array.isArray(estado.detalleVerificacion) ? estado.detalleVerificacion : [];

    return (
        <div className="form-card br-15 p-3 mt-2 flex align-items-center gap-3 flex-wrap"
            style={{ borderLeft: `4px solid ${estado.publicada ? '#27ae60' : '#95a5a6'}` }}>
            <i className="fa-solid fa-industry" style={{ fontSize: '1.2rem', color: 'var(--text-color-secondary)' }} />
            <span className="font-semibold">Betonmatic</span>

            {estado.publicada ? (
                <>
                    <Tag severity="success" icon="fa-solid fa-check-circle" value="Publicada" />
                    <span className="text-sm font-mono">{estado.codigoDeHormigon}</span>
                    {estado.fechaPublicacion && (
                        <span className="text-color-secondary text-sm">
                            desde {new Date(estado.fechaPublicacion).toLocaleDateString('es-AR')}
                        </span>
                    )}
                    {estado.estadoVerificacion && (
                        <Tag
                            severity={verifInfo(estado.estadoVerificacion).severity}
                            icon={verifInfo(estado.estadoVerificacion).icon}
                            value={verifInfo(estado.estadoVerificacion).label}
                            className="text-xs"
                        />
                    )}
                    <div className="flex gap-2 ml-auto">
                        <Button
                            label="Verificar"
                            icon="fa-solid fa-magnifying-glass"
                            size="small"
                            className="p-button-outlined"
                            loading={actionLoading}
                            disabled={actionLoading}
                            onClick={handleVerificar}
                        />
                        <Button
                            label="Re-publicar"
                            icon="fa-solid fa-rotate"
                            size="small"
                            severity="info"
                            outlined
                            loading={actionLoading}
                            disabled={actionLoading}
                            onClick={handleRepublicar}
                            tooltip="Re-envía la fórmula con los mapeos y dosis actuales. Sirve cuando cambiaste el mapeo de materiales o la dosis."
                            tooltipOptions={{ position: 'top' }}
                        />
                        <Button
                            label="Borrar de planta"
                            icon="fa-solid fa-trash"
                            size="small"
                            severity="danger"
                            outlined
                            loading={actionLoading}
                            disabled={actionLoading}
                            onClick={handleBorrar}
                        />
                    </div>

                    {detalleVerif.length > 0 && (
                        <div style={{ flexBasis: '100%' }} className="mt-1 text-sm">
                            <div className="flex flex-column gap-1 p-2 br-10"
                                style={{ background: 'var(--surface-100)', border: '1px solid var(--surface-border)' }}>
                                <span className="font-medium text-color-secondary">
                                    <i className="fa-solid fa-triangle-exclamation mr-1" />
                                    Diferencias con la fórmula publicada:
                                </span>
                                <ul className="m-0 pl-4">
                                    {detalleVerif.map((d, i) => (
                                        <li key={i} className="text-color">{describirDif(d)}</li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    )}
                </>
            ) : (
                <>
                    <Tag severity="secondary" icon="fa-solid fa-circle-xmark" value="No publicada" />
                    <span className="text-color-secondary text-sm">
                        La fórmula no está cargada en Betonmatic. Las transiciones a A_PRUEBA / EN_PRODUCCION la publican automáticamente.
                    </span>
                    <div className="flex gap-2 ml-auto">
                        <Button
                            label="Publicar a planta"
                            icon="fa-solid fa-paper-plane"
                            size="small"
                            severity="info"
                            loading={actionLoading}
                            disabled={actionLoading}
                            onClick={abrirDialogoPublicar}
                        />
                    </div>
                </>
            )}

            <Dialog
                visible={dialogVisible}
                onHide={() => setDialogVisible(false)}
                header="Publicar fórmula en Betonmatic"
                className="w-11 md:w-7 lg:w-5"
                dismissableMask
            >
                <div className="flex flex-column gap-3 mt-2">
                    <p className="m-0 text-sm text-color-secondary">
                        Estos códigos son los que Betonmatic va a usar para identificar la fórmula. El default
                        sugerido es el código que HormiQual ya generó para la dosificación.
                    </p>
                    <div className="flex flex-column gap-1">
                        <label className="text-sm font-medium">Código de Hormigón</label>
                        <InputText value={codigoH} onChange={(e) => setCodigoH(e.target.value)} placeholder="ej. DOS.000045.v1" />
                    </div>
                    <div className="flex flex-column gap-1">
                        <label className="text-sm font-medium">Código de Fórmula</label>
                        <InputText value={codigoF} onChange={(e) => setCodigoF(e.target.value)} placeholder="ej. DOS.000045.v1" />
                    </div>
                    <div className="flex justify-content-end gap-2 mt-2">
                        <Button label="Cancelar" outlined onClick={() => setDialogVisible(false)} disabled={actionLoading} />
                        <Button label="Publicar" icon="fa-solid fa-paper-plane" severity="info" loading={actionLoading} disabled={actionLoading} onClick={handlePublicar} />
                    </div>
                </div>
            </Dialog>
        </div>
    );
};

export default BetonmaticPublicacionWidget;
