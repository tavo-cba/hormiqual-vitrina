'use strict';

/**
 * Catálogo de motivos para el ajuste manual del cemento en una dosificación.
 *
 * El motor de dosificación calcula un valor de cemento (kg/m³) determinístico
 * basado en CIRSOC 200:2024 + la curva del cemento. El tecnólogo puede
 * decidir adoptar un valor distinto por razones operativas o económicas;
 * en ese caso DEBE elegir un motivo de esta lista (o OTRO + texto libre)
 * para que el ajuste quede trazado en el historial.
 *
 * Si querés agregar un motivo nuevo, agregalo acá Y en el mirror del
 * frontend `src/lib/dosificacion/motivosAjusteCemento.js`. El backend es
 * la fuente de verdad — el frontend solo lista las opciones.
 */

const MOTIVOS_AJUSTE_CEMENTO = Object.freeze({
    REDONDEO: {
        codigo: 'REDONDEO',
        label: 'Por redondeo',
        descripcion: 'El valor calculado se redondea a un múltiplo operativo (5 kg, 10 kg) para simplificar la dosificación en planta.',
    },
    EXPERIENCIA_TECNOLOGO: {
        codigo: 'EXPERIENCIA_TECNOLOGO',
        label: 'Por experiencia del tecnólogo',
        descripcion: 'El tecnólogo adopta un valor distinto al calculado en base a su experiencia con el material y la obra específica.',
    },
    DECISION_CLIENTE: {
        codigo: 'DECISION_CLIENTE',
        label: 'Por decisión del cliente',
        descripcion: 'El cliente solicita expresamente una cantidad de cemento distinta a la calculada (especificación contractual).',
    },
    RESTRICCION_PLANTA: {
        codigo: 'RESTRICCION_PLANTA',
        label: 'Por restricción de planta',
        descripcion: 'Limitación operativa de la planta (capacidad de balanza, dosificación mínima, tolva, silo) que impide adoptar el valor calculado.',
    },
    OPTIMIZACION_ECONOMICA: {
        codigo: 'OPTIMIZACION_ECONOMICA',
        label: 'Por optimización económica',
        descripcion: 'Se ajusta la cantidad de cemento para optimizar el costo del m³ manteniendo el cumplimiento normativo.',
    },
    SEGURIDAD_DURABILIDAD: {
        codigo: 'SEGURIDAD_DURABILIDAD',
        label: 'Por seguridad / durabilidad adicional',
        descripcion: 'Se incrementa la cantidad de cemento sobre el valor calculado para dar margen adicional de seguridad o durabilidad.',
    },
    AJUSTE_ENSAYO_PREVIO: {
        codigo: 'AJUSTE_ENSAYO_PREVIO',
        label: 'Por ajuste de ensayo previo',
        descripcion: 'Ensayos de pastones previos mostraron desvíos que requieren ajustar la cantidad de cemento respecto al valor teórico.',
    },
    OTRO: {
        codigo: 'OTRO',
        label: 'Otro motivo',
        descripcion: 'Cualquier otro motivo no contemplado en la lista; requiere texto libre obligatorio describiendo la razón.',
    },
});

const CODIGOS_VALIDOS = Object.freeze(Object.keys(MOTIVOS_AJUSTE_CEMENTO));

/**
 * Valida que un código de motivo sea válido. Devuelve `null` si OK, o un
 * objeto `{ campo, mensaje }` con el primer error encontrado.
 *
 * Reglas:
 *   - `motivo` requerido y debe estar en CODIGOS_VALIDOS.
 *   - Si `motivo === 'OTRO'`, `motivoOtro` requerido con al menos 10 chars.
 */
function validarMotivo({ motivo, motivoOtro } = {}) {
    if (!motivo) {
        return { campo: 'motivo', mensaje: 'El motivo del ajuste es obligatorio.' };
    }
    if (!CODIGOS_VALIDOS.includes(motivo)) {
        return { campo: 'motivo', mensaje: `Motivo "${motivo}" no es válido. Códigos aceptados: ${CODIGOS_VALIDOS.join(', ')}.` };
    }
    if (motivo === 'OTRO') {
        const texto = (motivoOtro || '').trim();
        if (texto.length < 10) {
            return { campo: 'motivoOtro', mensaje: 'Si elige "Otro motivo", debe describirlo con al menos 10 caracteres.' };
        }
    }
    return null;
}

module.exports = {
    MOTIVOS_AJUSTE_CEMENTO,
    CODIGOS_VALIDOS,
    validarMotivo,
};
