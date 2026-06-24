import React, { useState, useEffect, useMemo } from 'react';
import { Dialog } from 'primereact/dialog';
import { Button } from 'primereact/button';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import { Message } from 'primereact/message';
import { generarPdfEnsayo, generarPdfEnsayosBatch } from '../../../services/agregadoEnsayoService';
import { listHusosDnv } from '../../../services/husosDnvService';

// Reconoce las 3 variantes del catálogo: IRAM1505_GRANULOMETRIA (legacy),
// _HORMIGON y _TBS. El dialog ofrece selector de contexto/huso para todas.
const esGranulometria = (tipoCodigo) =>
    typeof tipoCodigo === 'string' && tipoCodigo.startsWith('IRAM1505_GRANULOMETRIA');

/**
 * EnsayoPrintDialog
 *
 * Modal de impresión de ensayos. Acepta:
 *   - modo 'individual': un solo ensayo (con full config de contexto si es granulometría)
 *   - modo 'batch': múltiples ensayos (config por granulometría en la lista)
 *
 * Props:
 *   visible, onHide
 *   ensayos: array de ensayos (cada uno: { idAgregadoEnsayo, tipoCodigo, tipoNombre, contextoAplicacion })
 *   idAgregado: id del agregado contenedor (necesario para batch)
 *   tmnMm: TMN del agregado (para filtrar dropdown de husos)
 *   agregadoNombre: string (para el título/filename)
 */
const EnsayoPrintDialog = ({ visible, onHide, ensayos = [], idAgregado, tmnMm: tmnMmRaw = null, agregadoNombre = '' }) => {
    // Defensiva: tmnMm puede llegar como number o como objeto { valor, fechaEnsayo, ... }
    // cuando se pasa desde caracterización sin deshelar. Siempre lo normalizamos a number|null.
    const tmnMm = useMemo(() => {
        if (tmnMmRaw == null) return null;
        if (typeof tmnMmRaw === 'object') {
            const v = tmnMmRaw.valor;
            if (v == null) return null;
            const n = Number(v);
            return isNaN(n) ? null : n;
        }
        const n = Number(tmnMmRaw);
        return isNaN(n) ? null : n;
    }, [tmnMmRaw]);

    const [opcionesPorEnsayo, setOpcionesPorEnsayo] = useState({});
    const [husos, setHusos] = useState([]);
    const [loadingHusos, setLoadingHusos] = useState(false);
    const [generating, setGenerating] = useState(false);
    const [error, setError] = useState(null);

    const granulometrias = useMemo(
        () => ensayos.filter((e) => esGranulometria(e.tipoCodigo)),
        [ensayos],
    );

    // Cargar husos filtrados por TMN cuando el dialog se abre y hay granulometrías
    useEffect(() => {
        if (!visible) return;
        if (granulometrias.length === 0) return;
        setLoadingHusos(true);
        listHusosDnv(tmnMm)
            .then((data) => setHusos(data))
            .catch((e) => setError(`No se pudieron cargar husos DNV: ${e.message}`))
            .finally(() => setLoadingHusos(false));
    }, [visible, granulometrias.length, tmnMm]);

    // Inicializar opcionesPorEnsayo con defaults al abrir
    useEffect(() => {
        if (!visible) return;
        const init = {};
        for (const e of ensayos) {
            if (esGranulometria(e.tipoCodigo)) {
                // Default: contextos derivados de contextoAplicacion del ensayo
                const contextosDefault = e.contextoAplicacion === 'TBS' ? ['TBS']
                    : e.contextoAplicacion === 'AMBOS' ? ['HORMIGON', 'TBS']
                    : ['HORMIGON'];
                init[e.idAgregadoEnsayo] = {
                    contextos: contextosDefault,
                    idHusoDNV: null,
                };
            }
        }
        setOpcionesPorEnsayo(init);
        setError(null);
    }, [visible, ensayos]);

    const toggleContexto = (idEnsayo, ctx) => {
        setOpcionesPorEnsayo((prev) => {
            const current = prev[idEnsayo] || { contextos: [], idHusoDNV: null };
            const has = current.contextos.includes(ctx);
            const nuevos = has
                ? current.contextos.filter((c) => c !== ctx)
                : [...current.contextos, ctx];
            return { ...prev, [idEnsayo]: { ...current, contextos: nuevos } };
        });
    };

    const setHusoPara = (idEnsayo, idHusoDNV) => {
        setOpcionesPorEnsayo((prev) => ({
            ...prev,
            [idEnsayo]: { ...(prev[idEnsayo] || { contextos: [] }), idHusoDNV },
        }));
    };

    // Opciones del dropdown de huso con etiqueta legible
    const husoOptions = useMemo(() => husos.map((h) => ({
        label: `${h.codigo}  ·  ${h.tipoTBS}${h.capa ? ` ${h.capa}` : ''}  ·  TMN ${h.tmnMm} mm`,
        value: h.idHusoDNV,
    })), [husos]);

    // Validación: cada granulometría debe tener al menos un contexto; si TBS, huso obligatorio
    const validacionError = useMemo(() => {
        for (const g of granulometrias) {
            const o = opcionesPorEnsayo[g.idAgregadoEnsayo];
            if (!o || o.contextos.length === 0) {
                return `Seleccioná al menos un contexto para "${g.tipoCodigo}".`;
            }
            if (o.contextos.includes('TBS') && !o.idHusoDNV) {
                return `Elegí un huso DNV para "${g.tipoCodigo}" (contexto TBS).`;
            }
        }
        return null;
    }, [granulometrias, opcionesPorEnsayo]);

    const handleGenerar = async () => {
        if (validacionError) { setError(validacionError); return; }
        setError(null);
        setGenerating(true);
        try {
            const filenameBase = (agregadoNombre || `agregado-${idAgregado}`).replace(/[^\w\-]+/g, '_');

            if (ensayos.length === 1) {
                const e = ensayos[0];
                const opt = opcionesPorEnsayo[e.idAgregadoEnsayo] || {};
                await generarPdfEnsayo(e.idAgregadoEnsayo, opt, `${filenameBase}-${e.tipoCodigo}-${e.idAgregadoEnsayo}.pdf`);
            } else {
                const payload = ensayos.map((e) => ({
                    idAgregadoEnsayo: e.idAgregadoEnsayo,
                    opciones: opcionesPorEnsayo[e.idAgregadoEnsayo] || {},
                }));
                await generarPdfEnsayosBatch(idAgregado, payload, `${filenameBase}-ensayos.pdf`);
            }
            onHide();
        } catch (err) {
            const msg = err.response?.data?.error || err.message;
            setError(`No se pudo generar el PDF: ${msg}`);
        } finally {
            setGenerating(false);
        }
    };

    const footer = (
        <div>
            <Button label="Cancelar" icon="pi pi-times" onClick={onHide} text disabled={generating} />
            <Button
                label={generating ? 'Generando...' : 'Generar PDF'}
                icon="pi pi-file-pdf"
                onClick={handleGenerar}
                disabled={generating || !!validacionError}
            />
        </div>
    );

    return (
        <Dialog
            header={ensayos.length === 1
                ? `Imprimir ensayo — ${ensayos[0]?.tipoCodigo || ''}`
                : `Imprimir ${ensayos.length} ensayos`}
            visible={visible}
            onHide={onHide}
            footer={footer}
            style={{ width: '90vw', maxWidth: '640px' }}
            modal
        >
            {error && <Message severity="error" text={error} className="mb-3 w-full" />}

            {ensayos.length === 0 && (
                <Message severity="warn" text="No hay ensayos para imprimir." />
            )}

            {ensayos.map((e) => {
                const esGranu = esGranulometria(e.tipoCodigo);
                const opt = opcionesPorEnsayo[e.idAgregadoEnsayo] || {};
                const ctxAplic = e.contextoAplicacion || 'HORMIGON';

                return (
                    <div key={e.idAgregadoEnsayo} className="mb-4 p-3" style={{ border: '1px solid #e2e8f0', borderRadius: 6 }}>
                        <div className="font-bold mb-1">{e.tipoCodigo}</div>
                        <div className="text-sm text-color-secondary mb-2">{e.tipoNombre || ''}</div>

                        {!esGranu && (
                            <div className="text-sm text-color-secondary">
                                Ensayo no granulométrico — se imprime tabular sin opciones adicionales.
                            </div>
                        )}

                        {esGranu && (
                            <>
                                <div className="mb-2 text-sm">
                                    <span className="text-color-secondary">Contexto del ensayo:</span>{' '}
                                    <strong>{ctxAplic}</strong>
                                </div>

                                <div className="mb-3">
                                    <label className="block font-bold text-sm mb-1">Vistas a generar</label>
                                    <div className="flex gap-3">
                                        <div className="flex align-items-center gap-2">
                                            <Checkbox
                                                inputId={`ctx-horm-${e.idAgregadoEnsayo}`}
                                                checked={(opt.contextos || []).includes('HORMIGON')}
                                                onChange={() => toggleContexto(e.idAgregadoEnsayo, 'HORMIGON')}
                                                disabled={ctxAplic === 'TBS'}
                                            />
                                            <label htmlFor={`ctx-horm-${e.idAgregadoEnsayo}`}>Hormigón (IRAM 1627)</label>
                                        </div>
                                        <div className="flex align-items-center gap-2">
                                            <Checkbox
                                                inputId={`ctx-tbs-${e.idAgregadoEnsayo}`}
                                                checked={(opt.contextos || []).includes('TBS')}
                                                onChange={() => toggleContexto(e.idAgregadoEnsayo, 'TBS')}
                                                disabled={ctxAplic === 'HORMIGON'}
                                            />
                                            <label htmlFor={`ctx-tbs-${e.idAgregadoEnsayo}`}>TBS (Huso DNV)</label>
                                        </div>
                                    </div>
                                </div>

                                {(opt.contextos || []).includes('TBS') && (
                                    <div>
                                        <label className="block font-bold text-sm mb-1">Huso DNV a plotear</label>
                                        <Dropdown
                                            value={opt.idHusoDNV}
                                            options={husoOptions}
                                            onChange={(ev) => setHusoPara(e.idAgregadoEnsayo, ev.value)}
                                            placeholder={loadingHusos ? 'Cargando husos...' : 'Seleccionar huso'}
                                            disabled={loadingHusos || husos.length === 0}
                                            className="w-full"
                                            filter
                                        />
                                        {tmnMm != null && (
                                            <small className="text-color-secondary">
                                                Filtrados por TMN del agregado ({tmnMm} mm)
                                            </small>
                                        )}
                                    </div>
                                )}
                            </>
                        )}
                    </div>
                );
            })}
        </Dialog>
    );
};

export default EnsayoPrintDialog;
