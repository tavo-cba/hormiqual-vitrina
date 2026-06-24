import React from "react";
import { Divider } from "primereact/divider";
import { Message } from "primereact/message";

const TIPO_FUNCIONAL_LABELS = {
    PLASTIFICANTE: "Plastificante",
    REDUCTOR_AGUA_RANGO_MEDIO: "Reductor de agua rango medio",
    SUPERPLASTIFICANTE: "Superplastificante",
    FLUIDIFICANTE: "Fluidificante",
    RETARDADOR: "Retardador",
    CONTROLADOR_HIDRATACION: "Controlador de hidratación",
    INCORPORADOR_AIRE: "Incorporador de aire",
    OTRO: "Otro",
};

const MODO_EFECTO_LABELS = {
    AHORRO_AGUA: "Ahorro de agua",
    AUMENTO_ASENTAMIENTO: "Aumento de asentamiento",
};

const UNIDAD_DOSIF_LABELS = {
    PORC_SOBRE_CEMENTO: "% sobre cemento",
    ML_POR_100KG_CEMENTO: "ml / 100 kg cemento",
    KG_M3: "kg/m³",
};

const AditivoPanel = ({ aditivo }) => {
    if (!aditivo) return null;
    const unidad = aditivo.unidadMedida?.unidad || aditivo.unidadMedida || "—";
    const hasEffect = aditivo.reduccionAguaPctEsperada || aditivo.incrementoAsentamientoEsperado || aditivo.aireIncorporadoPctEsperado || aditivo.retardoEsperadoMin;
    const aptoParaDosificacion = aditivo.tipoFuncional && aditivo.densidad && hasEffect;

    return (
        <div className="p-3 py-0 flex flex-column gap-2">
            {/* Identificación */}
            <div><b>Marca:</b> {aditivo.marca}</div>
            <div><b>Fabricante:</b> {aditivo.fabrica}</div>
            <div><b>Función:</b> {aditivo.funcion || "—"}</div>

            <Divider className="my-2" />

            {/* Clasificación funcional */}
            <div><b>Tipo funcional:</b> {TIPO_FUNCIONAL_LABELS[aditivo.tipoFuncional] || aditivo.tipoFuncional || "—"}</div>
            {aditivo.subtipo && <div><b>Subtipo:</b> {aditivo.subtipo}</div>}
            {aditivo.baseQuimica && <div><b>Base química:</b> {aditivo.baseQuimica}</div>}

            <Divider className="my-2" />

            {/* Propiedades físicas */}
            <div>
                <b>Densidad:</b>{" "}
                {aditivo.densidad ? `${aditivo.densidad} g/cm³` : <span className="text-orange-500">Sin cargar</span>}
            </div>
            {aditivo.solidosPct != null && <div><b>Sólidos:</b> {aditivo.solidosPct}%</div>}
            <div><b>Unidad de medida:</b> {unidad}</div>

            <Divider className="my-2" />

            {/* Dosificación */}
            {aditivo.unidadDosificacion && <div><b>Unidad dosificación:</b> {UNIDAD_DOSIF_LABELS[aditivo.unidadDosificacion] || aditivo.unidadDosificacion}</div>}
            <div><b>Dosis mínima:</b> {aditivo.dosisMinima != null ? aditivo.dosisMinima : "—"}</div>
            {aditivo.dosisHabitual != null && <div><b>Dosis recomendada:</b> {aditivo.dosisHabitual}</div>}
            <div><b>Dosis máxima:</b> {aditivo.dosisMaxima != null ? aditivo.dosisMaxima : "—"}</div>

            <Divider className="my-2" />

            {/* Efectos para el motor */}
            {aditivo.reduccionAguaPctEsperada != null && <div><b>Reducción de agua:</b> {aditivo.reduccionAguaPctEsperada}%</div>}
            {aditivo.incrementoAsentamientoEsperado != null && <div><b>Incremento asentamiento:</b> {aditivo.incrementoAsentamientoEsperado} mm</div>}
            {aditivo.aireIncorporadoPctEsperado != null && <div><b>Aire incorporado:</b> {aditivo.aireIncorporadoPctEsperado}%</div>}
            {aditivo.retencionTrabajabilidadMin != null && <div><b>Retención trabajabilidad:</b> {aditivo.retencionTrabajabilidadMin} min</div>}
            {aditivo.retardoEsperadoMin != null && <div><b>Retardo esperado:</b> {aditivo.retardoEsperadoMin} min</div>}
            {aditivo.modoEfectoSugerido && <div><b>Modo efecto:</b> {MODO_EFECTO_LABELS[aditivo.modoEfectoSugerido] || aditivo.modoEfectoSugerido}</div>}

            {aditivo.observaciones && (
                <>
                    <Divider className="my-2" />
                    <div><b>Observaciones:</b> {aditivo.observaciones}</div>
                </>
            )}

            {!aptoParaDosificacion && (
                <Message severity="warn" text="Ficha técnica incompleta para dosificación" className="mt-2" />
            )}

            {/* TODO: Sección de documentación técnica asociada (ensayos, fichas de seguridad, certificados)
               Se habilitará cuando se implemente la asociación de documentos a materiales. */}
        </div>
    );
};

export default AditivoPanel;