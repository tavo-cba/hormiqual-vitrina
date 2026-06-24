'use strict';

/**
 * Clasificador de "veredicto cualitativo por edad" de un ensayo de
 * resistencia. Sprint 2 — Revisiones de Ensayos (sesión 2026-05-10).
 *
 * Espejo del helper frontend `RevisionesEnsayo.getColorCumplimiento` para
 * que el backend pueda validar safeguards de aprobación masiva sin
 * confiar en lo que mande el cliente.
 *
 * IMPORTANTE — naturaleza de los umbrales:
 *
 * Los factores 0,70 (a 7 d) y 0,85 (a 14 d) son **ratios indicativos** de
 * literatura ACI 209R / ICPA para cemento Portland normal. NO son límites
 * normativos (CIRSOC 200-2024 §6.2 evalúa aceptación a edad de diseño,
 * típicamente 28 d). El veredicto cualitativo por edad lo usa la pantalla
 * de Revisiones para presentar al revisor un primer "filtro visual" de
 * cuáles ensayos están dentro del rango esperado, y para gobernar el
 * safeguard server-side de aprobación masiva: el RC puede aprobar en
 * lote sólo "verdes"; cualquier "naranja" o "rojo" requiere DT
 * (ACI 318 §26.12 — resultados no conformes requieren investigación
 * documentada del firmante técnico).
 *
 * Esta clasificación NO se usa para veredictos contractuales (M1/M2 del
 * lote) ni para informes de aceptación — esos usan `f'c` directo según
 * CIRSOC 200-2024 §6.2.3/§6.2.4.
 */

const COLORES = Object.freeze({
    VERDE:    'green',   // dentro del rango esperado
    NARANJA:  'orange',  // dentro del 85% del rango esperado (atención)
    ROJO:     'red',     // fuera del 85% del rango esperado (desvío)
});

/**
 * Devuelve el factor esperado para la edad dada vs la edad de diseño,
 * o `null` si no aplica (edad muy lejos de los hitos típicos).
 *
 * Ventanas:
 *   - 6 a 8 días     → 0,70
 *   - 13 a 15 días   → 0,85
 *   - edadDiseño ± 1 → 1,00
 *
 * @param {number} edadEnsayo - días.
 * @param {number} edadDiseño - días (típicamente 28).
 */
function getFactorEdad(edadEnsayo, edadDiseno) {
    if (!Number.isFinite(edadEnsayo) || !Number.isFinite(edadDiseno)) return null;
    if (edadEnsayo >= 6 && edadEnsayo <= 8) return 0.70;
    if (edadEnsayo >= 13 && edadEnsayo <= 15) return 0.85;
    if (edadEnsayo >= edadDiseno - 1 && edadEnsayo <= edadDiseno + 1) return 1.0;
    return null;
}

/**
 * Clasifica un ensayo en uno de los 3 colores, o `null` si los datos
 * no son suficientes para una clasificación segura.
 *
 * @param {Object} args
 * @param {number} args.resistencia       - MPa medidos.
 * @param {number} args.resistenciaObjetivo - f'c declarado (MPa).
 * @param {number} args.edadEnsayo        - días desde la confección.
 * @param {number} args.edadDiseno        - días, típicamente 28.
 * @returns {'green' | 'orange' | 'red' | null}
 */
function clasificarColorEnsayoPorEdad({ resistencia, resistenciaObjetivo, edadEnsayo, edadDiseno }) {
    if (!Number.isFinite(resistencia) || resistencia <= 0) return null;
    if (!Number.isFinite(resistenciaObjetivo) || resistenciaObjetivo <= 0) return null;
    const factor = getFactorEdad(edadEnsayo, edadDiseno);
    if (factor == null) return null;
    const meta = resistenciaObjetivo * factor;
    if (resistencia >= meta) return COLORES.VERDE;
    if (resistencia >= meta * 0.85) return COLORES.NARANJA;
    return COLORES.ROJO;
}

/**
 * Variante orientada al safeguard de aprobación masiva: dado un set de
 * ensayos, devuelve cuáles son "verdes" y cuáles tienen "desvíos".
 *
 * Si la clasificación es `null` (faltan datos para clasificar) el ensayo
 * se cuenta como "indeterminado". Por defecto los indeterminados NO se
 * tratan como verdes — quedan fuera del bulk verde para forzar revisión
 * caso por caso.
 *
 * @param {Array<{ idEnsayoResistencia: number, resistencia: number,
 *                 resistenciaObjetivo: number, edadEnsayo: number,
 *                 edadDiseno: number }>} ensayos
 * @returns {{
 *   verdes:         number[],   // idEnsayoResistencia que clasifican green
 *   naranjas:       number[],   // ídem orange
 *   rojos:          number[],   // ídem red
 *   indeterminados: number[],   // sin clasificación posible (datos faltantes)
 *   tieneDesvios:   boolean,
 * }}
 */
function segregarPorVeredicto(ensayos) {
    const verdes = [];
    const naranjas = [];
    const rojos = [];
    const indeterminados = [];
    for (const e of ensayos || []) {
        const color = clasificarColorEnsayoPorEdad({
            resistencia: Number(e.resistencia),
            resistenciaObjetivo: Number(e.resistenciaObjetivo),
            edadEnsayo: Number(e.edadEnsayo),
            edadDiseno: Number(e.edadDiseno),
        });
        if (color === COLORES.VERDE)      verdes.push(e.idEnsayoResistencia);
        else if (color === COLORES.NARANJA) naranjas.push(e.idEnsayoResistencia);
        else if (color === COLORES.ROJO)    rojos.push(e.idEnsayoResistencia);
        else                                indeterminados.push(e.idEnsayoResistencia);
    }
    return {
        verdes,
        naranjas,
        rojos,
        indeterminados,
        tieneDesvios: naranjas.length > 0 || rojos.length > 0 || indeterminados.length > 0,
    };
}

module.exports = {
    COLORES,
    getFactorEdad,
    clasificarColorEnsayoPorEdad,
    segregarPorVeredicto,
};
