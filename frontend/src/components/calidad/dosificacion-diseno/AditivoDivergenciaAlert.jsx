import React, { useMemo, useState } from "react";
import { Button } from "primereact/button";

/**
 * Banner no bloqueante que compara la elección manual de aditivos en el form
 * contra la recomendación del motor (Issue 3 — sesión 2026-05-27).
 *
 * El motor de cálculo NUNCA pisa la selección manual del usuario: este
 * componente solo INFORMA cuando hay divergencia. El usuario decide si la
 * adopta con un click ("Aplicar recomendación") o la ignora.
 *
 * Props:
 *   - recomendacion: shape devuelto por seleccionarAditivos en el backend:
 *       { principal, dosisPrincipal: {dosis, reduccionAguaPct, ...},
 *         retardante, dosisRetardante, alertas, ... }
 *     Puede ser null si el motor no produjo recomendación (e.g. catálogo sin
 *     plastificantes activos).
 *   - aditivosForm: array de 3 slots con la elección actual del usuario:
 *       [{ id, marca, dosis }, ...]
 *     El idx del array es el slot lógico (0=plastificante principal, 1=retardante).
 *   - aditivosCatalogo: array de objetos del catálogo de la planta — solo se
 *     usa para resolver el nombre/marca del aditivo cuando solo tenemos `id`.
 *   - onAplicar(slotIdx, { idAditivo, dosis, modoEfecto }): callback que el
 *     padre usa para hacer setField en los campos del form.
 *
 * No renderiza nada si no hay divergencia detectable.
 */

const TOLERANCIA_DOSIS_PCT = 0.10; // ±10% en dosis se considera "match"

function nombreDe(idAditivo, aditivosCatalogo) {
    if (!idAditivo) return null;
    const ad = (aditivosCatalogo || []).find((a) => Number(a.idAditivo) === Number(idAditivo));
    return ad?.marca || ad?.nombre || ad?.tipoFuncional || `Aditivo #${idAditivo}`;
}

function divergeDosis(dosisA, dosisB) {
    const a = Number(dosisA);
    const b = Number(dosisB);
    if (!Number.isFinite(a) || !Number.isFinite(b)) return true;
    if (a === 0 && b === 0) return false;
    const base = Math.max(Math.abs(a), Math.abs(b));
    return Math.abs(a - b) / base > TOLERANCIA_DOSIS_PCT;
}

function AditivoFila({ etiqueta, tipoSlot, recomendado, dosisRecomendada, modoEfectoRec, elegido, slotIdx, aditivosCatalogo, ignorada, onIgnorar, onAplicar }) {
    if (!recomendado) return null; // motor no recomendó nada en este slot
    if (ignorada) return null;

    const idRec = recomendado.idAditivo;
    const dosisRec = Number(dosisRecomendada?.dosis);
    const marcaRec = recomendado.marca || recomendado.nombre || `Aditivo #${idRec}`;

    const idElegido = elegido?.id || null;
    const dosisElegida = Number(elegido?.dosis);
    const marcaElegida = elegido ? (elegido.marca || nombreDe(idElegido, aditivosCatalogo)) : null;

    const distintoProducto = idElegido && Number(idElegido) !== Number(idRec);
    const distintaDosis = idElegido && !distintoProducto && divergeDosis(dosisElegida, dosisRec);
    const slotVacio = !idElegido;

    // Sin divergencia detectable → no mostramos nada.
    if (!slotVacio && !distintoProducto && !distintaDosis) return null;

    return (
        <div
            className="p-2 border-round mb-2 text-xs"
            style={{ background: 'rgba(245, 158, 11, 0.12)', borderLeft: '3px solid var(--orange-500)' }}
        >
            <div className="flex align-items-start gap-2">
                <i className="fa-solid fa-lightbulb mt-1" style={{ color: 'var(--orange-500)' }} />
                <div className="flex-1">
                    <div className="font-bold mb-1">
                        Sugerencia del motor — {etiqueta}
                    </div>
                    <div className="mb-1">
                        Motor sugiere: <strong>{marcaRec}</strong>
                        {Number.isFinite(dosisRec) && (
                            <> a <strong>{dosisRec}% s/cem.</strong></>
                        )}
                        {dosisRecomendada?.reduccionAguaPct != null && (
                            <small className="ml-2 text-color-secondary">
                                (reducción agua ~{Number(dosisRecomendada.reduccionAguaPct).toFixed(0)}%)
                            </small>
                        )}
                    </div>
                    <div className="mb-2 text-color-secondary">
                        Tu elección:{" "}
                        {slotVacio ? (
                            <em>(slot vacío)</em>
                        ) : (
                            <>
                                <strong>{marcaElegida || 'aditivo seleccionado'}</strong>
                                {Number.isFinite(dosisElegida) && (
                                    <> a <strong>{dosisElegida}% s/cem.</strong></>
                                )}
                            </>
                        )}
                        {distintoProducto && <span className="ml-2 text-orange-600">— producto distinto</span>}
                        {distintaDosis && <span className="ml-2 text-orange-600">— dosis fuera del rango sugerido</span>}
                    </div>
                    <div className="flex gap-2">
                        <Button
                            label="Aplicar recomendación"
                            icon="fa-solid fa-check"
                            size="small"
                            severity="warning"
                            outlined
                            onClick={() => onAplicar(slotIdx, {
                                idAditivo: idRec,
                                dosis: Number.isFinite(dosisRec) ? dosisRec : null,
                                modoEfecto: modoEfectoRec || (tipoSlot === 'retardante' ? 'RETARDANTE' : 'AHORRO_AGUA'),
                            })}
                        />
                        <Button
                            label="Ignorar"
                            icon="fa-solid fa-xmark"
                            size="small"
                            text
                            onClick={() => onIgnorar(slotIdx)}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
}

export default function AditivoDivergenciaAlert({ recomendacion, aditivosForm, aditivosCatalogo, esHRDC = false, onAplicar }) {
    const [ignoradosSlot, setIgnoradosSlot] = useState({}); // { 0: true, 1: true }
    const handleIgnorar = (slotIdx) => setIgnoradosSlot((prev) => ({ ...prev, [slotIdx]: true }));

    // Slot mapping: plastificante principal va al slot 0 (no-HRDC) o al
    // primer slot libre (HRDC, donde el 0 lo ocupa el espumígeno). El
    // retardante va al slot 1 (no-HRDC) o 2 (HRDC). Mantiene la lógica del
    // auto-fill en DosificacionDisenoPage.jsx al "Seleccionar mezcla".
    const slotPlast = esHRDC ? 1 : 0;
    const slotRetardante = esHRDC ? 2 : 1;

    const elegidoPlast = aditivosForm?.[slotPlast] || null;
    const elegidoRetardante = aditivosForm?.[slotRetardante] || null;

    const hayContenido = useMemo(() => Boolean(
        recomendacion && (recomendacion.principal || recomendacion.retardante)
    ), [recomendacion]);

    if (!hayContenido) return null;

    return (
        <div className="mt-2">
            <AditivoFila
                etiqueta="plastificante principal"
                tipoSlot="plastificante"
                recomendado={recomendacion?.principal}
                dosisRecomendada={recomendacion?.dosisPrincipal}
                modoEfectoRec={recomendacion?.principal?.modoEfectoSugerido}
                elegido={elegidoPlast}
                slotIdx={slotPlast}
                aditivosCatalogo={aditivosCatalogo}
                ignorada={ignoradosSlot[slotPlast]}
                onIgnorar={handleIgnorar}
                onAplicar={onAplicar}
            />
            <AditivoFila
                etiqueta="retardante de fraguado"
                tipoSlot="retardante"
                recomendado={recomendacion?.retardante}
                dosisRecomendada={recomendacion?.dosisRetardante}
                modoEfectoRec="RETARDANTE"
                elegido={elegidoRetardante}
                slotIdx={slotRetardante}
                aditivosCatalogo={aditivosCatalogo}
                ignorada={ignoradosSlot[slotRetardante]}
                onIgnorar={handleIgnorar}
                onAplicar={onAplicar}
            />
        </div>
    );
}
