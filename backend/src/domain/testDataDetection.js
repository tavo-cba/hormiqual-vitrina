'use strict';

/**
 * Espejo backend del módulo `lib/testDataDetection` del frontend.
 * Lógica pura idéntica para que el backend pueda detectar datos de prueba
 * (ej: al validar payloads, al emitir documentos server-side a futuro).
 *
 * Mantener sincronizado con `hormiqual-frontend/src/lib/testDataDetection/index.js`.
 */

const PATRONES = [
  { regex: /\b(test|prueba|pruebas|dummy|demo|fake|fakes|sample|samples|borrar|temp|temporal)\b/i, peso: 3, motivo: 'palabra clave de testing' },
  { regex: /^[a-z]{2,4}\d+[a-z\d]*$/i, peso: 2, motivo: 'ID con patrón random (letras+dígitos sin separador)' },
  { regex: /^\d+[a-z]{2,4}\d+/i, peso: 2, motivo: 'ID con patrón random (dígitos+letras+dígitos)' },
  { regex: /^(123456|12345678|111111|000000|999999|abcdef|qwerty|qweasd|asdfgh)$/i, peso: 3, motivo: 'secuencia trivial (123456 / qwerty / etc)' },
  { regex: /^([a-z]{1,2})\s*(prueba|test)?$/i, peso: 1, motivo: 'string trivial de 1-2 caracteres' },
  { regex: /^(pepe|juan|jose)\s*(prueba|test)?$/i, peso: 2, motivo: 'nombre genérico típico de testing' },
  { regex: /(asdf|asdfg|qwer|qwerty|zxcv|hjkl){1,}/i, peso: 3, motivo: 'tipeo de prueba (asdf/qwer/zxcv)' },
];

const UMBRAL_PRUEBA = 3;

const CAMPOS_INSPECCION = [
  { key: 'nombre', label: 'Nombre del material' },
  { key: 'cantera', label: 'Cantera' },
  { key: 'productor', label: 'Productor' },
  { key: 'subtipo', label: 'Subtipo' },
];

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

function detectarDatosDePrueba(material = {}, ensayos = []) {
  const isTestDataExplicito = material.isTestData === true;
  const motivos = [];
  for (const c of CAMPOS_INSPECCION) {
    motivos.push(...inspeccionarValor(material?.[c.key], c.label));
  }
  if (Array.isArray(ensayos)) {
    ensayos.forEach((it) => {
      const nro = it?.ultimoEnsayo?.nroInforme;
      const lab = it?.ultimoEnsayo?.laboratorio;
      motivos.push(...inspeccionarValor(nro, `Nº informe (${it?.tipo?.codigo || it?.tipo?.nombre || 'ensayo'})`));
      motivos.push(...inspeccionarValor(lab, `Laboratorio (${it?.tipo?.codigo || it?.tipo?.nombre || 'ensayo'})`));
    });
  }
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
  return { esProbablementePrueba, isTestDataExplicito, score, motivos: motivosUnicos, tag };
}

module.exports = { detectarDatosDePrueba, UMBRAL_PRUEBA };
