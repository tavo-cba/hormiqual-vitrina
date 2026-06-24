'use strict';

/**
 * ensayosFuncionalesGuard.js (PR5)
 *
 * Lista de "ensayos funcionales" que el motor de cálculo de dosificación de
 * hormigón (`hormiqualCalcEngine.calcularDosificacionHQ`) necesita como inputs
 * matemáticos. Sin estos datos no se puede calcular kg/m³ de cada componente
 * — son ensayos REQUERIDOS por la mecánica del cálculo, NO por la aptitud
 * normativa.
 *
 * Distinción importante:
 *   - "Funcional" (este módulo): el motor MATEMÁTICAMENTE no funciona sin esto.
 *     Bloquea el cálculo. Independiente de la política de aptitud del catálogo.
 *   - "Obligatorio para aptitud" (PR1+PR2): el catálogo del tenant declara
 *     qué ensayos son condicionantes para emitir veredicto APTO. Configurable.
 *
 * El motor TBS (HRDC, riego de imprimación, etc.) NO usa este guard — sus
 * funcionales son distintos (ej: emulsión bituminosa, no granulometría de
 * hormigón). Por ahora aplicamos el guard solo a la dosificación ICPA.
 *
 * Pureza: módulo sin DB, sin HTTP. Recibe POJOs y devuelve POJOs.
 */

/**
 * Ensayos funcionales para agregado FINO (en contexto de hormigón).
 *
 * `codigosAceptados`: lista de códigos del catálogo que satisfacen este
 * requisito. Existe porque el catálogo de HormiQual tiene variantes:
 *   - `IRAM1505_GRANULOMETRIA_HORMIGON` (variante actual con tamices CIRSOC).
 *   - `IRAM1505_GRANULOMETRIA` (legacy, sin sufijo — datos viejos pre-PR3).
 *   - `IRAM1627_GRANULOMETRIA_ESPECIFICA` (alias legacy aceptable).
 *
 * Notar: `IRAM1505_GRANULOMETRIA_TBS` NO está en la lista — su huso DNV
 * difiere de los tamices CIRSOC y NO satisface el cálculo de hormigón.
 */
const FUNCIONALES_FINO = Object.freeze([
    Object.freeze({
        codigo: 'IRAM1520_DENSIDAD_ABSORCION_FINO',
        codigosAceptados: ['IRAM1520_DENSIDAD_ABSORCION_FINO', 'IRAM1520_DENSIDAD_ABSORCION'],
        descripcion: 'Densidad y absorción del agregado fino (IRAM 1520)',
    }),
    Object.freeze({
        codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON',
        codigosAceptados: ['IRAM1505_GRANULOMETRIA_HORMIGON', 'IRAM1505_GRANULOMETRIA', 'IRAM1627_GRANULOMETRIA_ESPECIFICA'],
        descripcion: 'Granulometría para hormigón (IRAM 1505 — variante hormigón)',
    }),
    Object.freeze({
        codigo: 'IRAM1674_MATERIAL_FINO_200',
        codigosAceptados: ['IRAM1674_MATERIAL_FINO_200'],
        descripcion: 'Material que pasa el tamiz 75 µm / pasa #200 (IRAM 1674)',
    }),
]);

/**
 * Ensayos funcionales para agregado GRUESO (en contexto de hormigón).
 *
 * Notar: la granulometría requerida es la variante HORMIGÓN — la
 * `IRAM1505_GRANULOMETRIA_TBS` (separada en PR3) NO cuenta como funcional
 * para dosificación de hormigón. Tienen distintos tamices y husos.
 */
const FUNCIONALES_GRUESO = Object.freeze([
    Object.freeze({
        codigo: 'IRAM1533_DENSIDAD_GRUESO',
        codigosAceptados: ['IRAM1533_DENSIDAD_GRUESO', 'IRAM1520_DENSIDAD_ABSORCION_GRUESO', 'IRAM1533_DENSIDAD_ABSORCION'],
        descripcion: 'Densidad y absorción del agregado grueso (IRAM 1533)',
    }),
    Object.freeze({
        codigo: 'IRAM1505_GRANULOMETRIA_HORMIGON',
        codigosAceptados: ['IRAM1505_GRANULOMETRIA_HORMIGON', 'IRAM1505_GRANULOMETRIA', 'IRAM1627_GRANULOMETRIA_ESPECIFICA'],
        descripcion: 'Granulometría para hormigón (IRAM 1505 — variante hormigón)',
    }),
    Object.freeze({
        codigo: 'IRAM1674_MATERIAL_FINO_200',
        codigosAceptados: ['IRAM1674_MATERIAL_FINO_200'],
        descripcion: 'Material que pasa el tamiz 75 µm / pasa #200 (IRAM 1674)',
    }),
]);

/**
 * Verifica que cada agregado de la mezcla tenga cargados los ensayos
 * funcionales requeridos por el motor de cálculo de hormigón.
 *
 * @param {Array<{id, nombre, esFino, codigosCargados}>} agregados
 *   - id: identificador (cualquier shape, solo se propaga al error)
 *   - nombre: string visible en el mensaje
 *   - esFino: boolean. true → FUNCIONALES_FINO, false → FUNCIONALES_GRUESO
 *   - codigosCargados: array de strings con los códigos de ensayos vigentes
 *     cargados para el agregado.
 * @returns {{ ok: boolean, faltantes: Array<{agregadoId, agregadoNombre, codigo, descripcion}> }}
 */
function validarEnsayosFuncionalesParaDosificacion(agregados) {
    if (!Array.isArray(agregados)) return { ok: true, faltantes: [] };
    const faltantes = [];
    for (const ag of agregados) {
        if (!ag) continue;
        const requeridos = ag.esFino ? FUNCIONALES_FINO : FUNCIONALES_GRUESO;
        const cargados = new Set(Array.isArray(ag.codigosCargados) ? ag.codigosCargados : []);
        for (const req of requeridos) {
            // PR9-fix: aceptar cualquiera de los códigos equivalentes del catálogo.
            // Antes pedía match EXACTO con `req.codigo`, lo que rompía cuando el
            // catálogo tenía variantes (`_HORMIGON` vs sin sufijo, etc.) o cuando
            // el caller canonicalizaba el código y el target era una variante.
            const aceptados = Array.isArray(req.codigosAceptados) && req.codigosAceptados.length > 0
                ? req.codigosAceptados
                : [req.codigo];
            const satisfecho = aceptados.some((c) => cargados.has(c));
            if (!satisfecho) {
                faltantes.push({
                    agregadoId: ag.id ?? null,
                    agregadoNombre: ag.nombre || 'Agregado sin nombre',
                    codigo: req.codigo,
                    descripcion: req.descripcion,
                });
            }
        }
    }
    return { ok: faltantes.length === 0, faltantes };
}

/**
 * Construye un Error con statusCode=400 + mensaje legible y `code` semántico
 * para que el controller pueda mapearlo a HTTP 400 con detalle estructurado.
 */
function buildEnsayosFuncionalesError(faltantes) {
    const lista = faltantes || [];
    const lineas = lista.map(
        (f) => `  · "${f.agregadoNombre}": falta ${f.descripcion} [${f.codigo}]`
    );
    const mensaje =
        'No se puede calcular la dosificación: faltan ensayos funcionales requeridos por el motor:\n' +
        lineas.join('\n') +
        '\n\nCargá estos ensayos antes de calcular. Son inputs matemáticos del cálculo, no opcionales.';
    const err = new Error(mensaje);
    err.statusCode = 400;
    err.code = 'ENSAYOS_FUNCIONALES_FALTANTES';
    err.faltantes = lista;
    err.details = lista;  // alias para que el controller propague la lista al frontend
    return err;
}

module.exports = {
    FUNCIONALES_FINO,
    FUNCIONALES_GRUESO,
    validarEnsayosFuncionalesParaDosificacion,
    buildEnsayosFuncionalesError,
};
