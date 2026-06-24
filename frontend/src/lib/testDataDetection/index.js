/**
 * testDataDetection — heurística para detectar datos de prueba en documentos.
 *
 * Origen del bug (P2.14 / v2 audit): la ficha de "Arena prueba 1" tenía IDs
 * tipo `1234a5sd` y `asd1f23`, expediente `123456`, nombre con "prueba" y
 * cantera "Arideros x". El sistema generó la ficha con apariencia totalmente
 * oficial — podía haber ido a cliente sin nada que advirtiera que era test.
 *
 * Política definida con el usuario: warning + watermark, NO bloqueo (puede
 * haber falsos positivos legítimos, ej. "Cantera Pruebas SA").
 */

/**
 * Patrones que disparan sospecha de dato de prueba.
 * Cada uno tiene un "peso" — al sumar todos los hits, si supera umbral se
 * marca como dato de prueba.
 */
const PATRONES = [
  // Palabras explícitas
  { regex: /\b(test|prueba|pruebas|dummy|demo|fake|fakes|sample|samples|borrar|temp|temporal)\b/i, peso: 3, motivo: 'palabra clave de testing' },
  // IDs random (alfanumérico mezclado sin patrón obvio)
  { regex: /^[a-z]{2,4}\d+[a-z\d]*$/i, peso: 2, motivo: 'ID con patrón random (letras+dígitos sin separador)' },
  { regex: /^\d+[a-z]{2,4}\d+/i, peso: 2, motivo: 'ID con patrón random (dígitos+letras+dígitos)' },
  // Secuencias triviales
  { regex: /^(123456|12345678|111111|000000|999999|abcdef|qwerty|qweasd|asdfgh)$/i, peso: 3, motivo: 'secuencia trivial (123456 / qwerty / etc)' },
  // Strings de un solo carácter o sin sentido
  { regex: /^([a-z]{1,2})\s*(prueba|test)?$/i, peso: 1, motivo: 'string trivial de 1-2 caracteres' },
  // "Pepe", "Juan" como nombres de prueba típicos cuando vienen como cantera/productor
  { regex: /^(pepe|juan|jose)\s*(prueba|test)?$/i, peso: 2, motivo: 'nombre genérico típico de testing' },
  // Demasiados caracteres "raros" seguidos (asdf, qwer)
  { regex: /(asdf|asdfg|qwer|qwerty|zxcv|hjkl){1,}/i, peso: 3, motivo: 'tipeo de prueba (asdf/qwer/zxcv)' },
];

/**
 * Umbral de severidad: a partir de este score acumulado, se considera prueba.
 */
const UMBRAL_PRUEBA = 3;

/**
 * Campos a inspeccionar de un material/ensayo.
 */
const CAMPOS_INSPECCION = [
  { obj: 'material', key: 'nombre', label: 'Nombre del material' },
  { obj: 'material', key: 'cantera', label: 'Cantera' },
  { obj: 'material', key: 'productor', label: 'Productor' },
  { obj: 'material', key: 'subtipo', label: 'Subtipo' },
];

/**
 * Inspecciona un valor único contra los patrones; devuelve aciertos.
 */
function inspeccionarValor(valor, etiqueta) {
  if (!valor || typeof valor !== 'string') return [];
  const trimmed = valor.trim();
  if (!trimmed) return [];
  const aciertos = [];
  for (const p of PATRONES) {
    if (p.regex.test(trimmed)) {
      aciertos.push({ campo: etiqueta, valor: trimmed, motivo: p.motivo, peso: p.peso });
    }
  }
  return aciertos;
}

/**
 * Detecta si un material + sus ensayos tienen indicios de ser datos de prueba.
 *
 * @param {Object} material - { nombre, cantera, productor, subtipo, isTestData? }
 * @param {Array} [ensayos] - lista de items con `ultimoEnsayo.nroInforme` etc.
 * @returns {{
 *   esProbablementePrueba: boolean,
 *   isTestDataExplicito: boolean,
 *   score: number,
 *   motivos: Array<{ campo, valor, motivo, peso }>,
 *   tag: 'PRODUCCIÓN' | 'POSIBLE_PRUEBA' | 'PRUEBA_CONFIRMADA',
 * }}
 */
export function detectarDatosDePrueba(material = {}, ensayos = []) {
  const isTestDataExplicito = material.isTestData === true;
  const motivos = [];

  // 1) Inspeccionar campos del material
  for (const c of CAMPOS_INSPECCION) {
    motivos.push(...inspeccionarValor(material?.[c.key], c.label));
  }

  // 2) Inspeccionar nroInforme y laboratorio de los ensayos
  if (Array.isArray(ensayos)) {
    ensayos.forEach((it) => {
      const nro = it?.ultimoEnsayo?.nroInforme;
      const lab = it?.ultimoEnsayo?.laboratorio;
      motivos.push(...inspeccionarValor(nro, `Nº informe (${it?.tipo?.codigo || it?.tipo?.nombre || 'ensayo'})`));
      motivos.push(...inspeccionarValor(lab, `Laboratorio (${it?.tipo?.codigo || it?.tipo?.nombre || 'ensayo'})`));
    });
  }

  // Sumar pesos únicos por (campo+motivo) para no contar duplicados
  const dedup = new Map();
  for (const m of motivos) {
    const k = `${m.campo}::${m.motivo}`;
    if (!dedup.has(k)) dedup.set(k, m);
  }
  const motivosUnicos = Array.from(dedup.values());
  const score = motivosUnicos.reduce((s, m) => s + m.peso, 0);

  const heuristicaPositiva = score >= UMBRAL_PRUEBA;
  const esProbablementePrueba = isTestDataExplicito || heuristicaPositiva;

  let tag = 'PRODUCCIÓN';
  if (isTestDataExplicito) tag = 'PRUEBA_CONFIRMADA';
  else if (heuristicaPositiva) tag = 'POSIBLE_PRUEBA';

  return {
    esProbablementePrueba,
    isTestDataExplicito,
    score,
    motivos: motivosUnicos,
    tag,
  };
}

/**
 * Devuelve el texto del watermark a estampar en el PDF.
 */
export function watermarkText(deteccion) {
  if (!deteccion?.esProbablementePrueba) return null;
  if (deteccion.isTestDataExplicito) return 'DATOS DE PRUEBA — NO USAR EN OBRA';
  return 'POSIBLES DATOS DE PRUEBA — VERIFICAR ANTES DE USAR';
}

/**
 * Devuelve el color sugerido (RGB) para el watermark según severidad.
 */
export function watermarkColor(deteccion) {
  if (!deteccion?.esProbablementePrueba) return null;
  if (deteccion.isTestDataExplicito) return [220, 38, 38];   // rojo fuerte
  return [217, 119, 6];                                       // naranja
}
