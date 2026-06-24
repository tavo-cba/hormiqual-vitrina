import React, { useEffect, useState } from "react";
import { getAgregadoMeta } from "../../../../services/agregadoEnsayoService";

const SUBTIPO_MATERIAL_LABELS = {
    CANTO_RODADO: "Canto rodado",
    TRITURADO_NATURAL: "Triturado natural",
    TRITURADO_ARTIFICIAL: "Triturado artificial",
    ARENA_NATURAL: "Arena natural",
    ARENA_TRITURACION: "Arena de trituración",
};

const AgregadoPanel = ({ agregado }) => {
    const [meta, setMeta] = useState(null);

    useEffect(() => {
        if (!agregado) return;
        const agregadoId = agregado.id || agregado.idAgregado;
        if (agregadoId) {
            getAgregadoMeta(agregadoId)
                .then((m) => setMeta(m))
                .catch(() => { /* non-critical */ });
        }
    }, [agregado]);

    if (!agregado) return null;

    // Resolve subtipo label (compat: fallback to tipoGruesoOrigen if still present)
    const subtipoKey = meta?.subtipoMaterial || meta?.tipoGruesoOrigen;
    const subtipoLabel = subtipoKey ? (SUBTIPO_MATERIAL_LABELS[subtipoKey] || subtipoKey) : null;
    const nroExpediente = meta?.nroExpediente || meta?.nroRegistroMinero;

    return (
        <div className="w-full xl:px-3 flex flex-wrap">
            <div className="flex flex-column col-6">
                <small>NOMBRE</small>
                <span className="font-bold">{agregado.nombre}</span>
            </div>
            <div className="flex flex-column col-6">
                <small>TIPO</small>
                <span className="font-bold">{agregado.tipoAgregado}</span>
            </div>
            {meta?.productor && (
                <div className="flex flex-column col-6">
                    <small>PRODUCTOR</small>
                    <span className="font-bold">{meta.productor}</span>
                </div>
            )}
            {meta?.cantera && (
                <div className="flex flex-column col-6">
                    <small>CANTERA</small>
                    <span className="font-bold">{meta.cantera}</span>
                </div>
            )}
            {nroExpediente && (
                <div className="flex flex-column col-6">
                    <small>Nº EXPEDIENTE</small>
                    <span className="font-bold">{nroExpediente}</span>
                </div>
            )}
            {agregado.origen && (
                <div className="flex flex-column col-6">
                    <small>ORIGEN</small>
                    <span className="font-bold">{agregado.origen}</span>
                </div>
            )}
            {subtipoLabel && (
                <div className="flex flex-column col-6">
                    <small>SUBTIPO</small>
                    <span className="font-bold">{subtipoLabel}</span>
                </div>
            )}

            {/* Bloque de caracterización — read-only desde ensayos */}
            {agregado.densidad != null && (
                <div className="flex flex-column col-6">
                    <small>DENSIDAD</small>
                    <span className="font-bold">{agregado.densidad}</span>
                </div>
            )}
            {agregado.absorcion != null && (
                <div className="flex flex-column col-6">
                    <small>ABSORCIÓN</small>
                    <span className="font-bold">{agregado.absorcion}</span>
                </div>
            )}
            {agregado.moduloFinura != null && (
                <div className="flex flex-column col-6">
                    <small>MÓDULO FINURA</small>
                    <span className="font-bold">{agregado.moduloFinura}</span>
                </div>
            )}
            {agregado.pasaTamiz200 != null && (
                <div className="flex flex-column col-6">
                    <small>PASA TAMIZ #200 (%)</small>
                    <span className="font-bold">{agregado.pasaTamiz200}</span>
                </div>
            )}
            {agregado.tamanioMaximoNominal && (
                <div className="flex flex-column col-6">
                    <small>TAMAÑO MÁX. NOMINAL</small>
                    <span className="font-bold">{agregado.tamanioMaximoNominal}</span>
                </div>
            )}
        </div>
    );
};

export default AgregadoPanel;