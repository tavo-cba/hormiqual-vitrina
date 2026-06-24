/**
 * document-issuance — entry point único para emisión de documentos formales.
 *
 * Garantiza que TODA emisión pase por la CertificateIssuancePolicy. No se
 * puede saltear: el componente UI llama `emitDocument()` y este módulo decide
 * internamente qué tipo de PDF generar.
 *
 * Estructura:
 *   - CertificateIssuancePolicy: decide Allowed / Denied
 *   - emitDocument: pegamento entre policy + renderer
 *   - El renderer (certificadoCumplimientoPdf.js) NO debe importarse desde
 *     componentes UI directamente. Si lo hacés, salteás la policy y reintroducís
 *     el bug P0.1.
 */

import { canIssue, isAllowed, isDenied, isRequiresApproval, DECISION } from './CertificateIssuancePolicy';
import { fromLegacyEval, isAcceptable, getCategoriaVeredicto, Compliance } from '../compliance';
import { resolveResultadoDisplay } from './resultadoDisplay';
import { resolveSpecDisplay } from './specDisplay';

/**
 * X6 (auditoría 2026-05-08): un ensayo vencido no debe traducirse a
 * `cumple: false` (NO APTO rojo) — debe ser EVALUACIÓN INCOMPLETA (azul,
 * sin dato vigente). Si el backend no marca el ensayo nested con
 * `estado === 'VENCIDO'` pero sí marca `it.estado === 'VENCIDO'` a nivel
 * item, esta función promueve el compliance al status canónico `expired`
 * antes de pasarlo a la policy y al renderer.
 */
function _adaptComplianceConsiderandoVencimiento(item) {
  const compliance = fromLegacyEval(item?.ultimoEnsayo);
  // Si el item está marcado como VENCIDO a nivel padre, prevalece sobre
  // un cumple/no-cumple histórico del último ensayo.
  if (item?.estado === 'VENCIDO' && compliance?.status !== 'expired') {
    return Compliance.expired({
      reason: 'Ensayo vencido — sin dato vigente para certificar.',
      _ensayoNombre: item?.tipo?.nombre || null,
      _ensayoNormaRef: item?.tipo?.normaRef || null,
    });
  }
  // Fix auditor-pdf 2026-05-28 (test92, bug 1): enriquecer la compliance
  // con metadata del ensayo (nombre + norma) para que la policy del
  // certificado pueda mostrar "IRAM 1540 Pasante #200: <razón>" en lugar
  // de "No cumple con el criterio normativo" genérico cuando el evaluador
  // no devolvió `mensaje`.
  return {
    ...compliance,
    _ensayoNombre: item?.tipo?.nombre || null,
    _ensayoNormaRef: item?.tipo?.normaRef || null,
  };
}

export { canIssue, isAllowed, isDenied, isRequiresApproval, DECISION };

/**
 * Resultado de un intento de emisión.
 *
 * @typedef {Object} IssuanceResult
 * @property {('CERTIFICADO'|'INFORME_EVALUACION')} type - tipo de documento generado
 * @property {boolean} generated - si el PDF se descargó
 * @property {string[]} reasons - razones de denied (vacío si allowed)
 * @property {string[]} notes - notas para certificados con condicionales
 * @property {string} veredictoLabel - Label canónico de la categoría visual:
 *   "APTO" / "NO APTO" / "APTO CON OBSERVACIONES" / "APTITUD CONDICIONADA" /
 *   "EVALUACIÓN INCOMPLETA" / "INFORMATIVO" / "NO APLICA". (Prompt 4 C3:
 *   migrado desde el legacy UPPERCASE de `getDisplayLabel` al canónico de
 *   `getCategoriaVeredicto`. El campo se mantiene por shape, sin consumers
 *   reales según el audit del cierre de Prompt 3.)
 */

/**
 * Emite un documento (certificado o informe de evaluación) para un material.
 *
 * Flujo:
 *   1. Adapta los ensayos legacy a ComplianceResult (uno por item)
 *   2. Recibe `veredictoGlobal` PRE-COMPUTADO desde el caller (campo nuevo
 *      del response de getResumen del backend, post-Prompt 2 C10.5).
 *      Si el caller no lo trae (back-compat con datos pre-Prompt 2), se
 *      construye un fallback a partir del primer item con compliance, o se
 *      cae a notEvaluated.
 *   3. Evalúa la policy con ese veredicto pre-computado.
 *   4. Genera el PDF correspondiente al tipo decidido.
 *
 * Prompt 3 C2: `aggregate()` del frontend eliminada. La agregación es lógica
 * de dominio que vive en el backend (`calcularVeredictoGlobal`). El caller
 * debe pasar `veredictoGlobal` del response, no recomputarlo localmente.
 *
 * @param {Object} args
 * @param {Object} args.material
 * @param {Array}  args.ensayos - lista de items con { ultimoEnsayo, tipo, ... }
 * @param {Object} [args.veredictoGlobal] - ComplianceResult pre-computado por
 *   el backend (campo nuevo de getResumen). Si está disponible, se usa
 *   directamente; si no, fallback documentado.
 * @param {Object} [args.metadata] - empresa, planta, nroCertificado, normaRef, responsable, etc.
 * @returns {Promise<IssuanceResult>}
 */
export async function emitDocument({ material, ensayos = [], veredictoGlobal: veredictoFromCaller, metadata = {} }) {
  // Lazy import del renderer para no cargarlo si no se usa
  const { generarCertificadoCumplimientoPdf, DOC_TYPE } = await import(
    '../../components/calidad/reportes/certificadoCumplimientoPdf'
  );

  // 1. Construir ComplianceResults por ensayo (sigue necesario porque la
  //    policy y el PDF iteran items individualmente).
  const items = ensayos.filter((it) => it.ultimoEnsayo && it.estado !== 'NO_APLICA');
  // X6: usa adapter que considera `estado === 'VENCIDO'` a nivel item
  // y promueve el compliance a `expired` (EVALUACIÓN INCOMPLETA) en lugar
  // de dejar que el ensayo histórico se renderice como NO APTO.
  const complianceResults = items.map((it) => _adaptComplianceConsiderandoVencimiento(it));

  // 2. Veredicto agregado: preferir el pre-computado por backend (post-C10.5).
  //    Fallback: si el caller no lo trajo, derivamos uno conservador desde
  //    los items. NO recomputamos la regla de precedencia del backend acá —
  //    si llegamos al fallback es porque los datos vienen pre-Prompt 2 y
  //    la mejor aproximación es marcar el veredicto como notEvaluated para
  //    no introducir divergencia silenciosa.
  let veredictoGlobal = veredictoFromCaller;
  if (!veredictoGlobal || !veredictoGlobal.status) {
    veredictoGlobal = {
      status: 'notEvaluated',
      reason: 'Veredicto agregado no provisto por el caller (datos legacy). ' +
        'El caller debería pasar veredictoGlobal del response de getResumen.',
    };
  }
  // Prompt 4 C3: label canónico (APTO / NO APTO / APTO CON OBSERVACIONES /
  // APTITUD CONDICIONADA / EVALUACIÓN INCOMPLETA / etc), reemplaza el legacy
  // UPPERCASE de `getDisplayLabel`. Audit del cierre de Prompt 3 confirmó 0
  // consumers reales del campo `result.veredictoLabel`; se preserva el shape
  // para back-compat de la API pública.
  const veredictoCategoria = getCategoriaVeredicto(veredictoGlobal);
  const veredictoLabel = veredictoCategoria;

  // 3. Policy decide el tipo de documento.
  // Para P1.9 pasamos los códigos presentes y el contexto técnico del material
  // (si está disponible) para que la policy verifique requisitos por destino.
  const presentCodes = items.map((it) => it.tipo?.codigo).filter(Boolean);
  const policyContext = {
    ...metadata,
    tipoAgregado: material?.tipo || material?.tipoAgregado || null,
    expuestoDesgaste: metadata.expuestoDesgaste,
    claseExposicion: metadata.claseExposicion,
    fceMpa: metadata.fceMpa,
  };
  const decision = canIssue({ material, complianceResults, context: policyContext, presentCodes });

  // 4. Construir lista de ensayos con estado por compliance.
  // El resultado de cada ensayo se resuelve por código (densidad tiene 4
  // campos, granulometría tiene un objeto, materia orgánica es cualitativa,
  // etc); ver `resultadoDisplay.js` para el mapeo completo.
  const ensayosForPdf = items.map((it, idx) => {
    const compliance = complianceResults[idx];
    const { display, unidad } = resolveResultadoDisplay(it);
    return {
      nombre: it.tipo?.nombre,
      norma: it.tipo?.normaRef,
      resultado: display,
      unidad,
      // P2.11 — la columna Especificación ya no es vacía: muestra el límite
      // normativo aplicable según el tipo de ensayo y el tipo de agregado.
      especificacion: resolveSpecDisplay(it, material) || '',
      // Prompt 3 C9.2: el PDF prefiere `compliance` (rich) sobre `cumple` (boolean).
      // Mantenemos `cumple` y `estadoLabel` por back-compat con cualquier path
      // legacy que aún los lea.
      // Prompt 4 C3: `estadoLabel` migrado a label canónico
      // (`getCategoriaVeredicto`). El PDF migrado en C9.2 lo IGNORA — usa
      // `e.compliance || e.cumple` directo via `getCategoriaPdfLabel` —
      // pero el campo se preserva en el shape para back-compat.
      compliance,
      cumple: isAcceptable(compliance),
      estadoLabel: getCategoriaVeredicto(compliance),
      fecha: it.ultimoEnsayo?.fechaEnsayo,
      laboratorio: it.ultimoEnsayo?.laboratorio,
      nroInforme: it.ultimoEnsayo?.nroInforme,
    };
  });

  // 4.b. Detalle estructurado para fallas granulométricas (P1.3).
  // Cuando un ensayo de granulometría es NO_CUMPLE / CUMPLE_AC, el motivo
  // genérico ("N tamices fuera") no alcanza: se necesita ver QUÉ tamiz, qué
  // valor medido y los límites violados. Extraemos el array `fueraDeBanda`
  // del evaluador (granulometriaEvalService) y lo pasamos al renderer.
  const granulometriaDetalle = [];
  items.forEach((it, idx) => {
    const compliance = complianceResults[idx];
    if (isAcceptable(compliance)) return; // Pass limpio: no hay nada que detallar
    const codigo = it.tipo?.codigo || '';
    if (!codigo.includes('GRANULOMETR') && !codigo.includes('1505')) return;
    const r = it.ultimoEnsayo?.resultado;
    if (!r) return;
    let resultado = r;
    if (typeof resultado === 'string') {
      try { resultado = JSON.parse(resultado); } catch { resultado = null; }
    }
    const g = resultado?.granulometria;
    if (!g) return;
    const fuera = g.evaluacionAuto?.fueraDeBanda
      || g.evaluacionAutoGrueso?.fueraDeBanda
      || g.evaluacion?.fueraDeBanda
      || [];
    if (!fuera.length) return;
    const banda = g.evaluacionAuto?.resultadoGlobal?.bandaAplicada
      || g.evaluacionAuto?.bandaEvaluada
      || g.evaluacion?.bandaEvaluada
      || g.evaluacion?.banda
      || null;
    granulometriaDetalle.push({
      ensayoNombre: it.tipo?.nombre || 'Análisis granulométrico',
      banda,
      fueraDeBanda: fuera,
    });
  });

  // P1.5: contexto de uso bajo el cual se evaluó la aptitud (mismo objeto
  // que la policy ya consume — se hace explícito en el documento).
  const destinoUso = {
    expuestoDesgaste: metadata.expuestoDesgaste ?? null,
    claseExposicion: metadata.claseExposicion ?? null,
    fceMpa: metadata.fceMpa ?? null,
  };

  if (isAllowed(decision)) {
    generarCertificadoCumplimientoPdf({
      tipo: DOC_TYPE.CERTIFICADO,
      ...metadata,
      material,
      ensayos: ensayosForPdf,
      // Prompt 3 C9.2: pasar el ComplianceResult agregado al PDF, además de
      // los flags legacy (cumpleGlobal + veredictoGlobalLabel) por back-compat.
      veredictoGlobal,
      cumpleGlobal: true,
      veredictoGlobalLabel: veredictoLabel,
      notasCondicionales: decision.notes || [],
      granulometriaDetalle,
      destinoUso,
    });
    return {
      type: 'CERTIFICADO',
      generated: true,
      reasons: [],
      notes: decision.notes || [],
      veredictoLabel,
    };
  }

  // Fase 2 RBAC — el caller debe interceptar este caso y mostrar el dialog
  // de pedido de firma en lugar de generar el PDF. El renderer NO se invoca.
  if (isRequiresApproval(decision)) {
    return {
      type: 'REQUIRES_APPROVAL',
      generated: false,
      reasons: [],
      notes: decision.notes || [],
      reason: decision.reason,
      veredictoLabel,
      // Snapshot que el caller puede mandar al endpoint /api/document-approvals
      approvalContext: {
        decision: decision.decision,
        reason: decision.reason,
        notes: decision.notes || [],
        ensayos: ensayosForPdf,
        granulometriaDetalle,
        destinoUso,
        metadata,
      },
    };
  }

  // Denied → emitir Informe de Evaluación
  generarCertificadoCumplimientoPdf({
    tipo: DOC_TYPE.INFORME_EVALUACION,
    ...metadata,
    material,
    // Cambiar prefijo del nro: INF en lugar de CERT
    nroCertificado: (metadata.nroCertificado || '').replace(/^CERT-/, 'INF-'),
    ensayos: ensayosForPdf,
    // Prompt 3 C9.2: shape consistente con la invocación CERTIFICADO arriba
    // (mismo set de campos, mismo orden) para que el contrato sea uniforme.
    veredictoGlobal,
    cumpleGlobal: false,
    veredictoGlobalLabel: veredictoLabel,
    razonesNoCumple: decision.reasons || [],
    granulometriaDetalle,
    destinoUso,
  });
  return {
    type: 'INFORME_EVALUACION',
    generated: true,
    reasons: decision.reasons || [],
    notes: [],
    veredictoLabel,
  };
}
