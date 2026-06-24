'use strict';

/**
 * consistenciaClassifierEngine.js — PR8.16
 *
 * Función pura de auto-clasificación y validación de consistencia del hormigón
 * fresco según CIRSOC 200:2024 Tablas 4.1 y 4.2.
 *
 * Tabla 4.1 (resumen):
 *   Categoría        Asentamiento   Extendido   Remoldeo    Método obligatorio
 *   muy_seca         (no aplica)    (no aplica) > X seg     remoldeo (sólo)
 *   seca             0-2 cm         (no aplica) (variable)  remoldeo o asentamiento
 *   plastica         5-10 cm        (no aplica) (no aplica) asentamiento
 *   muy_plastica    10-15 cm        (no aplica) (no aplica) asentamiento
 *   fluida          15-21 cm       (variable)   (no aplica) asentamiento (cono)
 *   muy_fluida      ≥ 21 cm        ≥ X cm       (no aplica) MESA GRAF (extendido), no cono
 *
 * Tabla 4.2 (tolerancias por método): cada categoría declara su tolerancia
 * sobre el método activo. Los rangos y tolerancias EXACTOS viven en la tabla
 * `Consistencia` (modelo Sequelize) — el engine los recibe como datos.
 *
 * Reglas clave:
 *   1. Si el operador midió por asentamiento (cono) en una mezcla "muy fluida"
 *      → INVÁLIDO (CIRSOC: el cono no discrimina ≥ 21 cm; usar Mesa Graf).
 *   2. La auto-clasificación se infiere del valor medido contra los rangos
 *      del método declarado, eligiendo la categoría cuyo rango contiene
 *      al valor (con tolerancia opcional al borde).
 *   3. Si el valor cae fuera de TODOS los rangos del método → INCLASIFICABLE.
 *
 * Esta es función PURA: no toca DB, ni HTTP, ni Sequelize. Recibe catálogo
 * + medición y devuelve veredicto. Se invoca desde medicionPastonService.
 */

const METODOS_VALIDOS = new Set(['remoldeo', 'asentamiento', 'extendido']);

/**
 * Determina cuál método de medición está activo según los datos provistos.
 * Si el caller pasa más de un valor, se respeta el `metodoPreferido` o se
 * elige el primero no-nulo en orden: extendido > asentamiento > remoldeo.
 *
 * @param {object} medicion - { asentamientoMm, extendidoMm, remoldeoSeg }
 * @param {string} metodoPreferido - opcional
 * @returns {{ metodo, valorMm, valorSeg }}
 */
function inferirMetodo(medicion, metodoPreferido = null) {
  if (metodoPreferido && METODOS_VALIDOS.has(metodoPreferido)) {
    if (metodoPreferido === 'remoldeo' && medicion.remoldeoSeg != null) return { metodo: 'remoldeo', valor: Number(medicion.remoldeoSeg) };
    if (metodoPreferido === 'asentamiento' && medicion.asentamientoMm != null) return { metodo: 'asentamiento', valor: Number(medicion.asentamientoMm) / 10 };
    if (metodoPreferido === 'extendido' && medicion.extendidoMm != null) return { metodo: 'extendido', valor: Number(medicion.extendidoMm) / 10 };
  }
  if (medicion.extendidoMm != null) return { metodo: 'extendido', valor: Number(medicion.extendidoMm) / 10 };
  if (medicion.asentamientoMm != null) return { metodo: 'asentamiento', valor: Number(medicion.asentamientoMm) / 10 };
  if (medicion.remoldeoSeg != null) return { metodo: 'remoldeo', valor: Number(medicion.remoldeoSeg) };
  return { metodo: null, valor: null };
}

/**
 * Devuelve los campos `min`, `max`, `tolerancia` y `permite` para una
 * categoría dada según el método.
 */
function rangoPorMetodo(consistencia, metodo) {
  if (metodo === 'remoldeo') {
    return {
      min: consistencia.remoldeoMin != null ? Number(consistencia.remoldeoMin) : null,
      max: consistencia.remoldeoMax != null ? Number(consistencia.remoldeoMax) : null,
      tolerancia: consistencia.remoldeoTolerancia != null ? Number(consistencia.remoldeoTolerancia) : null,
      permite: !!consistencia.permiteRemoldeo,
    };
  }
  if (metodo === 'asentamiento') {
    return {
      min: consistencia.asentamientoMin != null ? Number(consistencia.asentamientoMin) : null,
      max: consistencia.asentamientoMax != null ? Number(consistencia.asentamientoMax) : null,
      tolerancia: consistencia.asentamientoTolerancia != null ? Number(consistencia.asentamientoTolerancia) : null,
      permite: !!consistencia.permiteAsentamiento,
    };
  }
  if (metodo === 'extendido') {
    return {
      min: consistencia.extendidoMin != null ? Number(consistencia.extendidoMin) : null,
      max: consistencia.extendidoMax != null ? Number(consistencia.extendidoMax) : null,
      tolerancia: consistencia.extendidoTolerancia != null ? Number(consistencia.extendidoTolerancia) : null,
      permite: !!consistencia.permiteExtendido,
    };
  }
  return { min: null, max: null, tolerancia: null, permite: false };
}

/**
 * Auto-clasifica una medición de consistencia y verifica:
 *   - método válido para la categoría inferida (Tabla 4.1)
 *   - valor dentro del rango (con tolerancia Tabla 4.2)
 *
 * @param {object} medicion - { asentamientoMm?, extendidoMm?, remoldeoSeg? }
 * @param {Array<object>} catalogoConsistencias - filas de tabla `Consistencia`,
 *        cada una con { codigo, nombre, permite*, *Min, *Max, *Tolerancia, ... }
 * @param {object} opts - { categoriaEsperada?, metodoPreferido? }
 *        - categoriaEsperada: codigo de la categoría declarada por el operador.
 *          Si se provee, además se valida que la inferida coincida.
 *        - metodoPreferido: forzar método de medición (default: inferido).
 * @returns {{ valido, categoriaInferida, metodoUsado, valor, dentroRango,
 *             dentroTolerancia, rango, tolerancia, mensajes, advertencias }}
 */
function clasificarMedicion(medicion, catalogoConsistencias, opts = {}) {
  const out = {
    valido: false,
    categoriaInferida: null,
    metodoUsado: null,
    valor: null,
    unidad: null,
    rango: null,
    tolerancia: null,
    dentroRango: null,
    dentroTolerancia: null,
    mensajes: [],
    advertencias: [],
    fuente: 'CIRSOC 200:2024 Tablas 4.1 y 4.2',
  };

  if (!medicion || (medicion.asentamientoMm == null && medicion.extendidoMm == null && medicion.remoldeoSeg == null)) {
    out.mensajes.push('Sin medición de consistencia (asentamiento/extendido/remoldeo).');
    return out;
  }
  if (!Array.isArray(catalogoConsistencias) || catalogoConsistencias.length === 0) {
    out.mensajes.push('Catálogo de consistencias vacío — no se puede clasificar.');
    return out;
  }

  const { metodo, valor } = inferirMetodo(medicion, opts.metodoPreferido);
  if (!metodo) {
    out.mensajes.push('No se pudo inferir método de medición.');
    return out;
  }
  out.metodoUsado = metodo;
  out.valor = valor;
  out.unidad = metodo === 'remoldeo' ? 's' : 'cm';

  // Buscar la categoría cuyo rango (con tolerancia) contiene el valor.
  // Iteramos en orden creciente para preferir la categoría más específica.
  const ordenadas = [...catalogoConsistencias].sort((a, b) => (a.orden || 0) - (b.orden || 0));
  let calce = null;
  let calceConTol = null;
  for (const c of ordenadas) {
    const { min, max, tolerancia, permite } = rangoPorMetodo(c, metodo);
    if (!permite || min == null || max == null) continue;
    // Strict: dentro de [min, max]
    if (valor >= min && valor <= max) {
      calce = { categoria: c, rango: { min, max }, tolerancia, dentroTolerancia: true };
      break;
    }
    // Con tolerancia: dentro de [min - tol, max + tol]
    if (tolerancia != null && valor >= (min - tolerancia) && valor <= (max + tolerancia)) {
      if (!calceConTol) calceConTol = { categoria: c, rango: { min, max }, tolerancia, dentroTolerancia: true, fueraDeRangoEstricto: true };
    }
  }

  const elegido = calce || calceConTol;
  if (!elegido) {
    out.mensajes.push(`Valor ${valor} ${out.unidad} no calza en ninguna categoría conocida para el método "${metodo}".`);
    return out;
  }

  out.categoriaInferida = elegido.categoria.codigo;
  out.rango = elegido.rango;
  out.tolerancia = elegido.tolerancia;
  out.dentroRango = !elegido.fueraDeRangoEstricto;
  out.dentroTolerancia = elegido.dentroTolerancia;
  out.valido = true;

  // Validación: método obligatorio por categoría (Tabla 4.1).
  // Para "muy_fluida": el cono de Abrams no discrimina >= 21 cm; debe usarse
  // Mesa Graf (extendido). Si el operador midió con asentamiento → advertir.
  const cat = elegido.categoria;
  if (cat.codigo === 'muy_fluida' && metodo === 'asentamiento') {
    out.advertencias.push('Categoría "muy fluida": el cono de Abrams no discrimina ≥ 21 cm. Recomendado: Mesa Graf (extendido) según CIRSOC §4.1.1.');
  }
  // "muy_seca": solo método remoldeo es válido.
  if (cat.codigo === 'muy_seca' && metodo === 'asentamiento') {
    out.advertencias.push('Categoría "muy seca": el cono no es aplicable (asentamiento ~ 0). Usar método de Vebe / remoldeo.');
  }

  if (out.fueraDeRangoEstricto || elegido.fueraDeRangoEstricto) {
    out.mensajes.push(`Valor ${valor} ${out.unidad} fuera del rango estricto [${elegido.rango.min}, ${elegido.rango.max}] pero dentro de tolerancia ±${elegido.tolerancia}.`);
  } else {
    out.mensajes.push(`Valor ${valor} ${out.unidad} dentro del rango [${elegido.rango.min}, ${elegido.rango.max}] de "${cat.codigo}".`);
  }

  // Si el operador declaró una categoría esperada, comparar.
  if (opts.categoriaEsperada && opts.categoriaEsperada !== out.categoriaInferida) {
    out.advertencias.push(`Categoría esperada "${opts.categoriaEsperada}" no coincide con inferida "${out.categoriaInferida}" para el valor medido.`);
  }

  return out;
}

module.exports = {
  clasificarMedicion,
  inferirMetodo,
  rangoPorMetodo,
  METODOS_VALIDOS,
};
