# Deuda diferida — domain/compliance

Este archivo registra deuda técnica conocida del módulo `domain/compliance`,
con su disposición para los Prompts 2, 3 y 4 del refactor en curso.

Cada entrada indica **qué**, **dónde**, **por qué se difirió**, y **a qué Prompt** pertenece su resolución.

Mantenimiento:
- Cuando se cierre una entrada, moverla a una sección "✅ Cerrado en Prompt N" al final.
- Cuando se introduzca nueva deuda durante este Prompt 1, agregar al inicio.
- Las decisiones que aparecen en JSDoc del código se referencian acá; el JSDoc del código sigue siendo la documentación in-situ, este archivo es el índice.

---

## 📋 Snapshot de cierre del Prompt 2 (2026-04-27)

**Cerradas en Prompt 2:**
- ✅ D2 — `isBlockingInContext` agregado en C3 con tabla declarativa.
- ✅ D3 — Producción ad-hoc en `aptitudMaterialesService` migrada en C7 (helpers compartidos AF/AG con dual-limit declarativo).
- ✅ D4 — Metadata estructurada `{measured, limit, norm}` ahora nativa del motor (C4) + sub-deuda `toEvalEngineString` eliminada como código muerto en C11.1.
- ✅ D5 — `severity` en fail calculada por contexto vía `isBlockingInContext` desde aptitudService (C7).
- ✅ D6 (parcial) — Backend cerrado en C9.1 (`fromAnyLegacy` ya no se usa internamente en aptitud; corrigió bugs latentes 'incompleto'→pending y 'cumple_con_atencion'→passWithObservations). Frontend pendiente para Prompt 3.
- ✅ D10 — `mezclaService.evaluarBandaDualIRAM1627` migrado a `domain/compliance/granulometriaMezcla.js` con shape canónico nativo (C10.3).
- ✅ D14 — Cierre completo en C9: dispatcher canónico ahora consume datos del motor (C6) y de aptitudService (C9.2) en producción. Validado vía smoke real.
- ✅ D18 — Inferencia `tipoAg` desde `AgregadoMeta` en createEnsayo (C11.2) y getResumen (C10.5).

**Abiertas/actualizadas durante Prompt 2:**
- 🟡 D1 — Frontend renderers, sigue pendiente para Prompt 3.
- 🟡 D9, D11, D12, D13 — Sin cambio (fuera de alcance Prompt 2).
- 🟡 D15 — Asimetría legacy/canónica en evaluadores con `complianceHint`. Sigue abierta — la cierran los renderers en Prompt 3 cuando migren a leer `compliance.status` y los evaluadores puedan emitir `estado` legacy alineado al canónico.
- 🟡 D16 — Source de `desgasteLA` minimal (cosmético). Diferido a Prompt 3 / toque editorial.
- 🟡 D17 — Bug semántico legacy `incompleto`/`cumple_con_atencion` documentado. El fix C9.1 ya corrigió el dispatcher; visible cuando renderers Prompt 3 migren a leer canónico.
- 🟡 D19 — Staleness del `veredictoGlobal` re-computado (no persistido). Re-evaluar al cierre del Prompt 3.
- 🟡 D20 — Granulometría individual: cambio observable canónico (C10.2) — agregado al patrón Hybrid Option B junto con D15.

**Confirmaciones de scope:**
- `match()` legacy en `ComplianceResult.js` — INTACTO. Su refactor pertenece al Prompt 4.
- Renderers de PDF y frontend — INTACTOS. Su migración a `compliance.status` pertenece al Prompt 3.

**Smoke final del Prompt 2** ([scripts/smoke-c11-cierre-prompt2.js](../../../scripts/smoke-c11-cierre-prompt2.js)):
- Arideros 6 → APTITUD CONDICIONADA (conditionalPass + requires_mitigation)
- Las Quebradas → APTO CON OBSERVACIONES (passWithObservations)
- Pipeline canónico end-to-end validado en hormiqual_demo con datos completos.

**Suite final:** 67 suites / 1636 tests / 0 regresiones.

---

## 📋 Snapshot de cierre del Prompt 3 (2026-04-28)

**Objetivo del Prompt 3:** migrar todos los renderers (frontend web + 5 PDFs)
del modelo legacy de cumplimiento (5 estados UPPERCASE) al canónico Prompt 2
(7 categorías visuales sobre 10 ComplianceResult states), preservando
back-compat con datos persistidos pre-Prompt 2.

**Cerradas en Prompt 3:**
- ✅ **D1** — Override UPPERCASE en `getDisplayLabel`. Renderers migrados a
  `getCategoriaPdfLabel` / `getCategoriaVeredicto` / `CumplimientoBadge`. La
  función exportada queda como `@deprecated` con back-compat público.
  Sub-deuda menor: 2 call sites en `lib/document-issuance/index.js`
  (`veredictoLabel` + `estadoLabel` per ensayo) siguen invocando el helper
  deprecated. Eliminación oportunista cuando se toque `emitDocument` en
  Prompt 4. No bloqueante: `_UPPERCASE_OVERRIDES` tiene su lock test.
- ✅ **D6** (parcial — frontend cerrado, backend con sub-nota) —
  `fromAnyLegacy` removido del frontend (0 hits productivos). Audit final
  post-Prompt 3 descubrió que backend conserva 2 consumidores activos en
  `alertaCalidadService.js:223,236` no documentados al cierre de Prompt 2.
  No es regresión (comportamiento correcto), pero sumar 1 mini-commit a
  "trabajo principal" Prompt 4 antes de eliminar el helper. Detalle in-line
  en la entrada D6 más abajo.
- ✅ **D15** — Asimetría legacy/canónica en evaluadores con `complianceHint`.
  Renderers Prompt 3 leen `compliance.status` canónico; el patrón Hybrid
  Option B se hizo visible (Petrográfico reactivo / RAS / cumple_con_tolerancia
  ahora se ven como APTITUD CONDICIONADA / APTO CON OBSERVACIONES en lugar
  de NO APTO).
- ✅ **D17** — Fix de mapeo legacy `incompleto` → `pending` y
  `cumple_con_atencion` → `passWithObservations` consumido correctamente por
  AptitudMaterialesPanel + DosificacionDisenoPage migrados en C5.
- ✅ **D20** — Granulometría individual fuera de banda canónica
  (`passWithObservations`) visible en renderers Prompt 3. Cierre conjunto
  con D15.
- ✅ **D22** — Bug latente de `fromLegacyEval` con `observaciones` no-array.
  Fix aplicado en C3 con regression test.
- ✅ **D8** (implícita, no había Dxx) — Counter `totals.noCumple` y flags
  `needsAttention` / `motivo` ahora derivados de compliance canónico
  (C8.5/C8.6). Antes contaminados bajo Hybrid Option B.

**Re-anotadas con estado actualizado:**
- 🟡 **D19** — Staleness del `veredictoGlobal` recomputado.
  - Issue #2 (cliente cachea, sin notificación): **cerrado de facto** por el
    patrón Prompt 3 (eliminación de `aggregate()` frontend + `emitDocument`
    recibe veredictoGlobal pre-computado fresh siempre).
  - Issue #1 (motor cambia, path 1 stale): **sigue abierto pero blast radius
    reducido** (no hay caching frontend que amplíe el problema). Plan de
    cierre (motorVersion + invalidación lazy) válido para Prompt 4 si se
    cambia el motor evaluador.
- 🟡 **D16** — Source granulométrico de `desgasteLA`. Sin cambio.

**Nuevas deudas anotadas durante Prompt 3:**
- 🟡 **D21** — Optimizador y AjustePostOptimizacion + mezclaCalcEngine no
  consumen compliance canónico. Decisión de dominio diferida.
- 🟡 **D23** — Verificaciones aire/pulverulento/HP en dosificación producen
  flags booleanos, no compliance canónico estructurado.
- 🟡 **D24** — Banner ejecutivo opcional al inicio del INF (decisión UX).
- 🟡 **D25** — Watermark "ENTORNO DE DESARROLLO" cortado por ancho diagonal
  en A4 (layout edge case).
- 🟡 **D26** — Vocabularios de dominio específicos preservados (modelo
  prestacional de mezclas + veredicto experimental de pastón). Decisión de
  dominio. Locked vía test.
- 🟡 **D27** — Deuda de pureza arquitectónica preexistente en `src/domain/`
  (10 violaciones en 8 archivos), descubierta en auditoría C9.4. NO producto
  del Prompt 3.
- 🟡 **D28** — Fallback genérico de `resultadoDisplay` con 3 decimales fijos.
  Observado en smoke C9.2 ("Terrones 1,300 %"). Cosmética menor.
- 🟡 **D29** — Page-break de Sección G del INF puede dejar página anterior
  con espacio vacío. Observado en smoke-pdf-visual test1 post-C12. Cosmética
  menor. Ajustar `checkPage(20)` a `checkPage(40)` cuando se haga toque
  editorial.

## D29 — Page-break de Sección G del INF puede dejar página anterior con espacio vacío (Prompt 3 C12 — observado en smoke-pdf-visual test1)

**Archivo:** [`../../../../hormiqual-frontend/src/components/calidad/ensayos-agregados/agregadoFichaTecnicaPdf.js`](../../../../hormiqual-frontend/src/components/calidad/ensayos-agregados/agregadoFichaTecnicaPdf.js)
— ~L1484: `checkPage(20)` al inicio de la sección G "Veredicto del agregado".

**Qué:** El guard `checkPage(20)` reserva sólo 20mm para iniciar G (suficiente
para el banner color de 14mm + un par de líneas). Si la sección F (Advertencia
técnica) terminó cerca del bottom de la página, el guard fuerza `addPage()` y
la página nueva renderiza G entera (banner + dictamen + listas). Si las listas
son cortas (3-4 ensayos pendientes en lugar de 7+), G ocupa ~40-50mm de la
página y el resto queda en blanco — el ojo del lector ve "página casi vacía"
al final del INF.

**Observado en:** smoke-pdf-visual test1.pdf (Las Quebradas) — página 4 casi
vacía con sólo 3 bullets de ensayos pendientes.

**Por qué NO es bug crítico:** el comportamiento es deliberado — el guard
asegura que el banner no se corte a mitad de página. El trade-off es espacio
en blanco al final de la página anterior. El INF sigue siendo legible.

**Refactor sugerido:** ajustar `checkPage(20)` a `checkPage(40)` para que el
salto de página sólo ocurra cuando realmente no entre el banner + dictamen
formal completo. O calcular dinámicamente el espacio total que ocuparán las
listas y saltar sólo si la sección G entera no entra.

**Costo:** muy bajo (1 número). **Riesgo:** bajo — sólo cambia el threshold
de salto. Pero el efecto exacto depende de los datos del INF (cuántos items
hay en cada lista) — requiere validación visual con datos representativos.

**Categoría:** mejora cosmética. Ideal para un toque editorial post-Prompt 3.
NO bloqueante.

---

**Sub-nota a D1 cierre — claves legacy de subtipo:** la unificación de C10
(6.1) usa `formatSubtipoAgregado` con el ENUM canónico de 6 valores (3 arenas
+ 3 rocas). Los valores legacy `GRAVA_PARTIDA`, `PIEDRA_PARTIDA`, `MIXTO`
que existían en el local SUBTIPO_LABELS de MaterialDetailPage NO están en el
ENUM canónico — caen al fallback de `formatEnum` que retorna el string
crudo. Si esos valores existen en BD de producción (algún material legacy
con el subtipo viejo), el dashboard va a mostrar `GRAVA_PARTIDA` raw (feo,
no rompe). **Acción para Prompt 4**: si aparecen, decidir si el ENUM canónico
debe expandirse para cubrirlos (decisión de dominio) o si se hace una
migración de datos (`GRAVA_PARTIDA` → `TRITURADO_NATURAL`, etc.). Por ahora:
information-only, no bloqueante.

**Cambios observables al deployar (changelog):**
1. **Counters extendidos** en MaterialDetailPage: KPI ahora usa 7 categorías
   canónicas en lugar de 5 estados UPPERCASE legacy.
2. **Hybrid Option B visible**: ensayos legacy con `cumple='NO_CUMPLE'` que
   tienen `compliance.status='passWithObservations'/'conditionalPass'` ahora
   se renderizan correctamente como APTO CON OBSERVACIONES / APTITUD
   CONDICIONADA, no NO APTO. Aplica a Petrográfico reactivo, RAS, granulometría
   individual fuera de banda, materias carbonosas zona dual, estabilidad
   basálticas zona dual.
3. **Counter "X No cumple"** en AgregadoEnsayosPage refleja sólo casos
   canónicamente NO APTO (antes infl ado por Hybrid B).
4. **"Atención" naranja** en PDF de dosificación (sección Aptitud de
   materiales): antes verde por mapeo a APTO_CON_OBSERVACIONES, ahora naranja
   APTITUD_CONDICIONADA (Fix B post-smoke).
5. **Sección "G. Veredicto del agregado"** nueva al final del INF (ficha
   técnica del agregado): banner color + texto formal canónico de las 5
   categorías + listas detalladas (razones / condiciones / observaciones /
   pendientes) con tipo + descripción + ref normativa por item.
6. **Cláusula legal en APTITUD CONDICIONADA**: "Su uso fuera de las
   condiciones declaradas no está respaldado por esta evaluación" — cierre
   normativo-legal del documento.
7. **Vocabulario unificado**: dashboard, INF, certificado, listados y PDFs
   hablan ahora vocabulario IRAM/CIRSOC ("Canto rodado" / "Triturado natural"
   / "Triturado artificial"). Antes el dashboard usaba coloquial ("Grava")
   divergente del estándar.
8. **Texto truncado del watermark** identificado pero diferido (D25).
9. **Formato unificado es-AR** en cards de Caracterización: coma decimal,
   punto separador de miles para PUC/PUS, 2 decimales para absorción y
   pasante #200, alineado con el formato de los PDFs.
10. **Subtipo "ARENA_NATURAL" → "Arena natural"** en certificado de
    cumplimiento (mapeo friendly aplicado).

**Categorización de deudas para Prompt 4:**

*Cierre directo en Prompt 4 (deuda menor identificada en Prompt 3):*
- D22 — ya cerrada en Prompt 3 (anotación obsoleta).
- D23 — verificaciones dosificación a compliance canónico.
- D24 — banner ejecutivo INF.
- D25 — watermark layout.
- D28 — precisión per-código en `resultadoDisplay` fallback.
- D29 — page-break Sección G del INF (ajustar checkPage threshold).

*Trabajo principal de Prompt 4:*
- **Migración previa de `alertaCalidadService.js:223,236`** (sub-nota D6) —
  2 call sites de `fromAnyLegacy` que bloquean su eliminación. Mini-commit
  ~10-15 líneas + tests. Hacer ANTES del bloque que elimina helpers deprecated.
- `match()` legacy en `ComplianceResult.js` (declarado out-of-scope en
  Prompt 2/3).
- `_UPPERCASE_OVERRIDES` y eliminación final de `getDisplayLabel`
  deprecated.
- D9 — `AlertaDosificacion`.
- Sub-deuda D1: 2 call sites de `getDisplayLabel` en `emitDocument`.

*Decisiones de dominio diferidas (requieren stakeholder):*
- D21 — algoritmo optimizador.
- D26 — vocabularios prestacional + experimental.
- D27 — pureza arquitectónica preexistente (10 violaciones).

*Fuera de alcance del refactor de cumplimiento:*
- D11, D12, D13 — testing infra.

**Confirmaciones de scope (heredadas):**
- `match()` legacy en `ComplianceResult.js` — sigue INTACTO. Prompt 4.
- Renderers Prompt 3 — TODOS migrados a canónico.
- Backend — solo se tocó `agregadoEnsayoService.getResumen` (C6.5/C8.5/C8.6) +
  `requisitosEnsayos.getDisplayName` (nit chip). Engines de dominio
  intactos (auditoría D27).

**Suite final:** 13 suites frontend / 232 tests / 0 regresiones.
Backend: 68 suites / 1647 tests / 0 regresiones.

---

## 📋 Snapshot de cierre del Prompt 4 (2026-04-29) — CIERRE FINAL DEL REFACTOR DE CUMPLIMIENTO

**Objetivo del Prompt 4:** cleanup final acumulado — eliminar helpers
deprecated con consumidores residuales, cerrar cosméticos pendientes,
formalizar disposición de deudas diferidas y consolidar el handoff de
deudas que sobreviven al refactor.

**Cerradas en Prompt 4:**
- ✅ **D6** (totalmente) — `fromAnyLegacy` alias eliminado de `ComplianceResult.js`.
  C2 migró el último consumidor productivo backend (`alertaCalidadService.js`)
  a `fromLegacyEval` directo. C6 eliminó el alias + actualizó tests
  (`fromAnyLegacy.test.js` → `fromLegacyEval.test.js` con `git mv`).
- ✅ **D1** (totalmente) — `getDisplayLabel`, `getDisplayColor`,
  `getDisplaySeverity`, `_UPPERCASE_OVERRIDES` ELIMINADOS. C3 migró los 2
  call sites residuales en `lib/document-issuance/index.js` a
  `getCategoriaVeredicto`. C4 eliminó las definiciones backend y frontend
  + tests dedicados. La presentación canónica vive ahora exclusivamente
  en `labels.js` (backend) y en `lib/compliance` + `pdfPresentation`
  (frontend).
- ✅ **`match()` legacy** (5 estados core) — ELIMINADO. C5 eliminó el helper
  + sus tests. Audit confirmó 0 consumidores productivos. `matchExt` (10
  estados, exhaustivo) es el único helper de pattern-matching del módulo.
- ✅ **D9** — disposición formal **opción β** (dos sistemas independientes
  por diseño). C7 anotó la decisión en este DEFERRED + creó lock-in test
  `__tests__/d9LockIn.test.js` con 3 invariantes que rompen si alguien
  intenta unificar especulativamente: ENUM `AlertaCalidad.tipo` no
  contiene `MATERIAL_CAMBIO_IMPACTO`, modelo `AlertaDosificacion` sigue
  existiendo separado, los dos modelos tienen propósitos distintos
  documentados in-code.
- ✅ **D25** — watermark "ENTORNO DE DESARROLLO — NO USAR EN OBRA" reescrito
  a `'DESARROLLO — NO USAR'` (21 chars vs 37 originales) y
  `'PRUEBAS — NO USAR'` para STAGING. Fix universal en
  `lib/environment/index.js`; entra completo en A4 a -20° con cualquier
  fontSize que use cada PDF.
- ✅ **D28** — fallback genérico de `resultadoDisplay` con precisión
  per-código en lugar de 3 decimales fijos. Mapeo: cloruros/sulfatos = 3,
  terrones/sales/carbonosas = 2, durabilidad = 1, default = 3 conservador.
  "Terrones de arcilla 1,300 %" ahora se ve como "1,30 %".
- ✅ **D29** — `checkPage(20)` → `checkPage(40)` en Sección G del INF. La
  sección no salta a página nueva prematuramente cuando F termina cerca
  del bottom; cohesión visual del banner+dictamen+listas asegurada.
- ✅ **D27 Grupo B** (warmup C1) — `alertasMaterialService.js` movido de
  `src/domain/dosificacion/` a `src/services/` con `git mv` preservando
  historia. Subagente `revisor-engine-purity` confirmó 9 violaciones
  (era 10) — sólo Grupo A pendiente para sprint dedicado.

**Re-anotadas con disposición formal:**
- 🟡 **D23** — verificaciones aire/pulverulento/HP en `DosificacionDisenoPage`
  producen flags booleanos. Decisión de dominio: **dejar como están**.
  Son flags internos del cálculo de dosificación, no compliance del
  material. La canonización a 3 categorías (APTO/NO APTO/EVAL INCOMPLETA)
  ya hace el trabajo necesario; agregar `passWithObservations` /
  `conditionalPass` requiere stakeholder de mezclas decidiendo cuándo
  un valor "cerca del límite" merece ese matiz. Sin ese trigger, no se
  toca. **Diferida a sprint con stakeholder de mezclas.**
- 🟡 **D24** — banner ejecutivo opcional al inicio del INF. Decisión UX
  sin trigger concreto del usuario. **Diferida a sprint UX**.

**Sin cambios (fuera de alcance):**
- 🟡 **D11, D12, D13** — testing infra (BD testing). Out-of-scope del refactor
  de cumplimiento.
- 🟡 **D16** — source granulométrico de `desgasteLA` (cosmético).
- 🟡 **D19** — issue #2 cerrado en Prompt 3 por patrón sin cache frontend;
  issue #1 (motor cambia, path 1 stale) sigue abierto con blast radius
  reducido. Plan de cierre (motorVersion + invalidación lazy) válido si
  se cambia el motor evaluador.
- 🟡 **D21** — algoritmo del optimizador (`AjustePostOptimizacion` +
  `mezclaCalcEngine.evaluarContraBanda`). Decisión de dominio que
  requiere stakeholder de mezclas. **Sin scope hasta que ocurra esa
  conversación.**
- 🟡 **D22** — ya cerrada en Prompt 3 C3.
- 🟡 **D26** — vocabularios prestacional + experimental preservados por
  diseño con lock-in tests activos. Sin scope hasta que emerja trigger
  cross-módulo.
- 🟡 **D27 Grupo A** — 9 engines con I/O accidental. Sprint dedicado de
  pureza arquitectónica.
- 🟡 **Sub-nota D1 / claves legacy de subtipo** — `GRAVA_PARTIDA`,
  `PIEDRA_PARTIDA`, `MIXTO`. Information-only.

**Cambios observables al deployar:**
1. **Watermark legible** en PDFs no-prod (texto entra completo, no se corta
   por ancho diagonal).
2. **Decimales más razonables** en tabla de cumplimiento del cert: terrones,
   sales solubles y carbonosas con 2 decimales (en lugar de 3 que hacía
   ver "1,300 %").
3. **Sección G del INF cohesiva**: el banner del veredicto + dictamen
   formal + listas detalladas se mantienen en la misma página cuando hay
   espacio mínimo (40mm), evitando saltos prematuros.
4. **`alertasMaterialService` reubicado** en `services/` — ningún cambio
   funcional al usuario, sólo limpieza arquitectónica que el equipo
   técnico verá.

**API pública post-Prompt 4 — superficie limpia de `domain/compliance`:**

```js
// Predicados core + extendidos (10 estados)
isPass, isFail, isConditionalPass, isInconclusive, isNotEvaluated,
isPassWithObservations, isInformative, isExpired, isPending, isNotApplicable,

// Helpers semánticos
isAcceptable, isBlocking,

// Pattern matching exhaustivo (único helper)
matchExt,

// Adapters legacy (sin alias deprecated)
fromLegacyEval, normalizeLegacyStatus,

// Builders + tipo
Compliance, STATUS, CORE_STATUSES, ALL_STATUSES, SEVERITY,

// Presentación canónica (labels.js)
getLongLabel, getShortLabel, getSeverity, getIcon, getColor, getLabels, LABELS,

// Adapters específicos (sequelizeEnum, evalEngine, aptitudService) + 7 categorías
calcularVeredictoGlobal, getCategoriaVeredicto, VEREDICTO_LABELS, ...
```

**Métricas de cierre del Prompt 4:**
- Sub-commits: 11 (C1 a C11).
- Archivos modificados: 13 (4 backend src, 6 backend tests, 3 frontend).
- Helpers deprecated eliminados: 6 (`getDisplayLabel`, `getDisplayColor`,
  `getDisplaySeverity`, `_UPPERCASE_OVERRIDES`, `match()` legacy,
  `fromAnyLegacy`).
- Tests eliminados (de los helpers eliminados): ~12.
- Tests nuevos (lock-in D9): 3.
- Suite final: backend 69 suites / 1638 tests / 0 regresiones (vs 1647
  pre-Prompt 4 — neto -9 por eliminación de helpers + alias y +3 por
  lock-in test D9 + nueva suite).
- Frontend: 13 suites / 233 tests / 0 regresiones.

**Deuda residual post-Prompt 4 (lista breve para handoff a futuros sprints):**
- Sprint pureza arquitectónica: D27 Grupo A (9 engines).
- Sprint mezclas con stakeholder: D21 (optimizador) + D23 (verificaciones
  aire/pulverulento/HP).
- Sprint UX con stakeholder de producto: D24 (banner ejecutivo INF).
- Sprint testing infra: D11, D12, D13.
- Sprint visual/cosmético: D16.
- Esperando trigger emergente: D19 issue #1 (staleness path 1), D26
  (vocabularios cross-módulo).

**El refactor de cumplimiento (Prompts 1-4) cierra COMPLETO con esta
disposición.** No queda deuda derivada del modelo canónico abierta. Toda
deuda viva post-Prompt 4 es de dominios adyacentes (pureza arquitectónica,
testing infra, UX, decisiones de stakeholder) o condicional (espera de
triggers emergentes).

**Para el cierre acumulado del refactor, ver:**
[`./REPORTS/PROMPT_4.md`](./REPORTS/PROMPT_4.md) (cierre Prompt 4 + cierre
acumulado de los 4 prompts).

---

## D1 — Override UPPERCASE en `getDisplayLabel` (Commit 3)

**Archivo:** [`ComplianceResult.js`](./ComplianceResult.js) — constante `_UPPERCASE_OVERRIDES`.

**Qué:** Mantenemos `getDisplayLabel` retornando strings UPPERCASE legacy
(`'CUMPLE'`, `'INCONCLUYENTE'`, `'INFORMATIVO'`, `'VENCIDO'`, `'PENDIENTE'`,
`'CUMPLE CONDICIONAL'`, `'CUMPLE CON OBSERVACIÓN'`) en lugar de las labels
canónicas en title case que viven en `labels.js` (`'Cumple'`,
`'Resultado no concluyente'`, etc.). Cuando los call sites legacy migren a
`getLongLabel` / `getShortLabel`, los overrides se pueden eliminar.

**Por qué se difirió:** preservar contrato histórico para no romper
renderers existentes (`PDFs`, frontend). El refactor de los call sites es
del Prompt 3.

**Call sites identificados (a migrar en Prompt 3):**

Backend (a migrar):
- Ningún call site del backend consume `getDisplayLabel` o `getDisplayColor`
  en producción. Solo lo invocan los tests. Eliminar el override es
  trivial cuando lo hagamos.

Frontend (a migrar — copia paralela del módulo):
- [`hormiqual-frontend/src/lib/compliance/index.js:193`](../../../../hormiqual-frontend/src/lib/compliance/index.js)
  define su propio `getDisplayLabel` con el mismo contrato uppercase.
  Esta copia frontend es completamente paralela al módulo backend y
  debe consolidarse o sincronizarse.
- [`hormiqual-frontend/src/lib/compliance/index.js:215`](../../../../hormiqual-frontend/src/lib/compliance/index.js)
  define `getDisplayColor` con paleta RGB propia.
- [`hormiqual-frontend/src/lib/document-issuance/index.js:60`](../../../../hormiqual-frontend/src/lib/document-issuance/index.js)
  importa `getDisplayLabel` y lo aplica a un veredicto global.
- [`hormiqual-frontend/src/lib/document-issuance/index.js:91`](../../../../hormiqual-frontend/src/lib/document-issuance/index.js)
  idem para items individuales.

Frontend (strings hardcoded):
- [`hormiqual-frontend/src/components/calidad/reportes/certificadoCumplimientoPdf.js:284`](../../../../hormiqual-frontend/src/components/calidad/reportes/certificadoCumplimientoPdf.js)
  usa `'NO EVALUADO'` literal — no consume el helper.
- [`hormiqual-frontend/src/components/calidad/reportes/certificadoCumplimientoPdf.js:299`](../../../../hormiqual-frontend/src/components/calidad/reportes/certificadoCumplimientoPdf.js)
  compara contra `'CUMPLE CONDICIONAL'` literal para colorear celdas.

**Resolución:** Prompt 3 (renderers).

---

## ~~D2 — `isBlocking` context-free~~ ✅ (Prompt 2 C3)

**Archivo:** [`./blocking.js`](./blocking.js).

**Resolución:** En C3 se agregó `isBlockingInContext(codigo, usageContext, materialContext)`
con tabla declarativa `BLOCKING_TABLE` y predicates por contexto. La función
`isBlocking` original queda como heurística context-free para retrocompat;
el código nuevo usa `isBlockingInContext`. Validado por
`__tests__/blocking.test.js` (50 tests).

**Detalle (referencia histórica):** `isBlocking` era una heurística context-free

**Archivo:** [`ComplianceResult.js`](./ComplianceResult.js) — función `isBlocking` y JSDoc asociado.

**Qué:** `isBlocking` es una heurística context-free: marca como bloqueantes
`fail | inconclusive | notEvaluated | pending | expired`. Útil para alertas,
pero **insuficiente** para el árbol de veredictos globales: un `pending`
solo bloquea si el ensayo es exigible para el contexto de uso, idem `expired`.
Un `fail` con `severity: 'no_bloqueante'` es informativo y no debería
contar como bloqueante.

**Por qué se difirió:** la noción de "exigible en el contexto" no existe
formalmente todavía. Llega con el refactor del motor en Prompt 2.

**Resolución:** Prompt 2. Implementar
`isBlockingInContext(result, usageContext)` que considere:
- exigibilidad del ensayo según `usageContext` (clase de exposición, destino,
  resistencia objetivo, etc.)
- `severity` del fail (cuando el motor empiece a calcularlo)
- vencimiento relativo al contexto (algunos ensayos se aceptan vencidos
  para usos no críticos)

Mientras tanto:
- Para alertas (Prompt 1, Commit 6): `isBlocking` actual está bien.
- Para veredicto/certificación: NO usar `isBlocking`, leer `status` y
  combinar con contexto explícitamente.

---

## ~~D3 — Producción ad-hoc de `Compliance` en `aptitudMaterialesService.js`~~ ✅ (Prompt 2 C7)

**Archivo:** [`../dosificacion/aptitudMaterialesService.js`](../dosificacion/aptitudMaterialesService.js).

**Resolución:** En C7, la producción ad-hoc se reemplazó por:
1. Helper `_evaluateItem(key, lim, ensayo)` compartido AF/AG con dual-limit
   declarativo + conditions[] driven por `lim.condicional` (kind discriminante).
2. Helper `_buildItemCompliance(item, usageContext, materialContext)` que
   delega en `buildCompliance` del módulo canónico — cada item ahora trae
   su propio `ComplianceResult` con measured/limit/norm/conditions/severity.
3. Compliance global agregado desde los items (severity propagada del
   primer item bloqueante).
4. Generalización: el AG ahora también emite `cumple_condicional` con
   conditions[] en zonas duales (lajosidad, elongación, desgaste LA,
   materiasCarb), restaurando simetría con AF.

Validado por `__tests__/aptitudGeneralizedConditions.test.js` (22 tests) +
smoke real `scripts/smoke-c7-aptitud.js`.

---

## ~~D4 — Metadata estructurada `{ measured, limit, norm }` no proviene del motor~~ ✅ (Prompt 2 C4)

**Archivos:**
- [`../ensayoEvalEngine.js`](../ensayoEvalEngine.js) — `evaluarEnsayo()` ahora expone `compliance: ComplianceResult` con metadata estructurada nativa.
- [`./adapters/evalEngine.js`](./adapters/evalEngine.js) — `fromEvalEngineString` la propaga.

**Resolución:** En C4 (sub-commits C4.2 a C4.5) los 18 evaluadores del
catálogo se enriquecieron con metadata `{ measured, limit, norm }` y
`compliance: ComplianceResult` nativo. Los call sites canónicos (motor +
aptitud + dispatcher) lo consumen directamente. Validado por
`__tests__/evaluadorMetadataCoverage.test.js` (52 tests).

**Sub-deuda `toEvalEngineString`:** ✅ Resuelta en Prompt 2 C11.1. La
función fue eliminada como código muerto tras grep que confirmó
zero call sites en producción. Sus tests de roundtrip y los tests
del shape legacy se removieron junto con la función.

---

## ~~D5 — `severity` en `fail` no se calcula desde aptitudService~~ ✅ (Prompt 2 C7)

**Archivo:** [`../dosificacion/aptitudMaterialesService.js`](../dosificacion/aptitudMaterialesService.js).

**Resolución:** El helper `_buildItemCompliance` invoca `buildCompliance`
con `codigo + usageContext + materialContext`, que internamente llama
`isBlockingInContext(codigo, usageCtx, matCtx)` (introducido en C3) para
asignar `severity = 'bloqueante' | 'no_bloqueante'` en items con estado
`fail`. El compliance global del material agrega: si algún item es
bloqueante, el material entero queda con `severity='bloqueante'`.

Smoke validado: pasante200=4% con `expuestoDesgaste=true` produce
`severity='bloqueante'` → dispatcher emite `ENSAYO_NO_CUMPLE_BLOQUEANTE
/ CRITICO` (antes: `severity=null` → `ENSAYO_NO_CUMPLE / ALTO`).

---

## D6 — `fromAnyLegacy` queda como dispatcher genérico (parcialmente cerrado)

**Archivo:** [`ComplianceResult.js`](./ComplianceResult.js) — `fromAnyLegacy = fromLegacyEval`.

**Qué:** `fromAnyLegacy` (alias de `fromLegacyEval`) sigue siendo el
dispatcher genérico para inputs heterogéneos (strings legacy, objetos del
motor, objetos de aptitud, etc.). Se mantiene como API pública porque hay
call sites en producción que la usan.

**Por qué se difirió:** los call sites en `aptitudMaterialesService.js:344`
y `mezclaService.js:609-610` la consumen. Migrarlos a los adapters
específicos (`fromEvalEngineString`, `fromAptitudServiceShape`,
`fromLegacyMezclaEval`) requiere análisis del tipo de input que recibe
cada call site.

**Estado post-C9 (Prompt 2):**
- ✅ `aptitudMaterialesService.js:344` y `:616` (los 2 call sites internos)
  fueron migrados a factories canónicos explícitos vía
  `_buildAptitudGlobalCompliance`. La migración descubrió y arregló una
  **regresión semántica latente**: `fromAnyLegacy('incompleto')` colapsaba
  a `notEvaluated` en vez de `pending`, lo que mataba el disparador
  `MATERIAL_SIN_ENSAYO`. Ahora 'incompleto' → pending correctamente.
  También 'cumple_con_atencion' → passWithObservations (antes pasaba a pass).
- ⏳ `mezclaService.js:609-610` se difiere a C10 (esa lógica se mueve a
  `granulometriaMezcla.js` con shape canónico nativo, churn evitado).
- ⏳ Frontend (Prompt 3): los renderers que aún consumen el shape legacy
  vía adapter genérico se migran al canónico junto con D1.

**Resolución parcial:** Backend aptitud cerrado en C9. Backend mezcla en C10.
Frontend en Prompt 3.

**Sub-nota descubierta en audit final post-Prompt 3 — `fromAnyLegacy` backend
tiene 2 consumidores activos en `alertaCalidadService.js:223,236`:**

El cierre de Prompt 2 / C9.1 se enfocó en `aptitudMaterialesService` y omitió
mencionar que el dispatcher de alertas también consume `fromAnyLegacy` para
convertir el shape legacy del `evalResult` a `ComplianceResult` cuando el
caller no lo provee canónico. Los call sites son:

```js
// alertaCalidadService.js:221-236 (extracto)
const { ALL_STATUSES, fromAnyLegacy } = require('../domain/compliance');
// ...
return fromAnyLegacy(evalResult);  // L223
// ...
return fromAnyLegacy(evalResult);  // L236
```

**Implicancia para Prompt 4:** la eliminación de `fromAnyLegacy` (objetivo del
trabajo principal del Prompt 4) requiere migrar previamente esos 2 call sites
a `fromLegacyEval` directamente o a un dispatcher canónico nuevo
(`fromEvalEngineString` específicamente para inputs string). Estimación:
~10-15 líneas + tests del dispatcher.

**Por qué NO es regresión:** el comportamiento actual es correcto — los smokes
de Prompt 3 validaron el dispatcher de alertas en producción. `fromAnyLegacy`
sigue siendo válido como adapter genérico hasta su eliminación final. La
sub-nota es informativa para que Prompt 4 no sorprenda esos call sites cuando
intente eliminar el helper deprecated.

**Categoría:** sumar 1 mini-commit a "trabajo principal" del Prompt 4 antes
del bloque que elimina `fromAnyLegacy` + `_UPPERCASE_OVERRIDES`. No bloqueante.

---

## D9 — `AlertaDosificacion` queda fuera de alcance

**Archivo:** [`../dosificacion/alertasMaterialService.js`](../dosificacion/alertasMaterialService.js).

**Qué:** Sistema de alertas paralelo a `AlertaCalidad`, dirigido a
notificar a dosificaciones cuando un material que usan cambió de ensayos.
Usa otro modelo (`AlertaDosificacion`) y otra lógica (`AlertaDosificacion`
genera alertas por _impacto_ de cambio, no por veredicto de cumplimiento).

**Por qué se difirió:** declarado fuera de alcance en el plan original
del Prompt 1.

**Resolución:** Prompt no asignado. Si en el futuro se quiere unificar
con `AlertaCalidad`, abrir un Prompt aparte.

---

## ~~D10 — Producción ad-hoc en `mezclaService.js`~~ ✅ (Prompt 2 C10.3)

**Archivo:** [`../../services/mezclaService.js`](../../services/mezclaService.js).

**Resolución:** En C10.3 la lógica de evaluación granulométrica de mezcla
combinada migró a [`./granulometriaMezcla.js`](./granulometriaMezcla.js)
con shape canónico nativo (firma `(designMix, usageContext) → ComplianceResult`).
`mezclaService.evaluarBandaDualIRAM1627` queda como wrapper que delega al
módulo canónico y reconstruye el shape legacy esperado por los renderers
del PDF para back-compat. El campo `compliance` ya no se construye via
`fromLegacyMezclaEval` (legacy) sino directamente desde el módulo canónico.

Validado por `__tests__/granulometriaMezcla.test.js` (8 tests).

Cuando Prompt 5 amplíe la verificación IRAM 1627 (tolerancia, fracción
máxima, MF de mezcla), el módulo canónico absorbe el cambio y el wrapper
queda intacto.

**Qué nota legacy (referencia histórica):** `mezclaService` adjuntaba un campo `compliance` a sus respuestas
usando `fromLegacyMezclaEval`. Análogo a la deuda D3 pero para mezclas.

**Por qué se difirió:** análogo a D3 — refactorizar en conjunto con la
migración del consumidor de mezclas.

**Resolución:** Prompt 2. La producción ad-hoc es backend (motor de mezcla),
análogo a D3. Los consumidores frontend que lean el campo `compliance` ya
están cubiertos por D1 (renderers, Prompt 3); este punto se enfoca solo
en la producción interna.

---

## D11 — Sin infraestructura de testing con BD

**Archivos afectados:** todos los modelos Sequelize, especialmente las
migraciones inline en [`../../models/index.js`](../../models/index.js).

**Qué:** El proyecto no tiene infraestructura de testing con BD —
ni `sqlite::memory:` ni docker compose. Las migraciones de schema y los
ALTER se validan con **smoke tests manuales** contra `hormiqual_demo`:

```bash
node -e "...mysql.createConnection().query('SHOW COLUMNS FROM ...')"
```

Los tests Jest existentes inspeccionan modelos vía `rawAttributes` (sin
conectar) y validan la presencia de la sentencia ALTER en `models/index.js`
con regex. No corren la migración en sí.

**Por qué se difirió:** agregar infraestructura de testing con BD requiere:
- decidir entre sqlite-in-memory (rápido, pero el dialecto difiere de MySQL
  para ENUMs y otros tipos) o docker-compose con MySQL real (más lento,
  más robusto);
- crear factories de seed para datos de prueba;
- configurar CI para levantar la BD efímera.

Es trabajo no trivial y no era alcance del Prompt 1 (refactor de modelo
canónico de cumplimiento).

**Resolución:** Sprint futuro, no asignado. Cuando se haga, los tests del
Commit 5 (alertaCalidadEnum.test.js) se pueden extender para validar
inserción real de cada tipo del ENUM.

---

## D12 — Idempotencia de la migración del ENUM AlertaCalidad

**Archivo:** [`../../models/index.js`](../../models/index.js) — bloque "AlertaCalidad.tipo: ENUM aditivo".

**Qué:** El bloque ejecuta `ALTER TABLE ... MODIFY COLUMN ... ENUM(...)` con la
lista completa cada vez que arranca el proceso. MySQL en general acepta
idempotentemente esa operación (definición idéntica = no-op virtual), pero
en algunas versiones puede generar warnings o un breve table copy.

**Por qué se difirió:** el caso patológico es teórico — en `hormiqual_demo`
la migración corrió en startup sin warnings. El check idempotente real
(leer `INFORMATION_SCHEMA.COLUMNS` y solo aplicar el ALTER si la lista
difiere) es más prolijo pero agrega complejidad.

**Resolución:** Si en producción aparecen warnings de "data truncated" o
performance issues por el ALTER repetido, agregar el check idempotente.
Mientras tanto, la implementación actual es suficiente.

---

## D13 — Test de orden exacto del ENUM AlertaCalidad.tipo

**Archivo:** [`../../../__tests__/alertaCalidadEnum.test.js`](../../../__tests__/alertaCalidadEnum.test.js).

**Qué:** Los tests del Commit 5 verifican la presencia de los 12 valores
pero NO el orden exacto. En MySQL los valores ENUM se persisten como
índices numéricos (1, 2, 3...): reordenar la lista corrompe los registros
silenciosamente. El comentario "NO REMOVER, NO REORDENAR" en el modelo
intenta prevenir esto, pero un test exhaustivo lo blindaría.

**Por qué se difirió:** balance entre defensa y costo. Si en algún momento
notamos un push que reordene la lista, agregamos el test. Por ahora el
comentario alcanza.

**Resolución:** opcional. Test sería:
```js
expect(tipoValues).toEqual([
  'ENSAYO_POR_VENCER', 'ENSAYO_VENCIDO', /* ... orden exacto ... */
]);
```

---

## ~~D14 — Inversión de la deuda: dispatcher canónico de alertas listo, motor no produce los datos para activarlo~~ ✅ (Prompt 2 C6 + C9)

**Archivos involucrados:**
- [`../../services/alertaCalidadService.js`](../../services/alertaCalidadService.js) — dispatcher canónico (listo desde Commit 6).
- [`../ensayoEvalEngine.js`](../ensayoEvalEngine.js) — motor `evaluarEnsayo()` (no propaga `condicional`/`condiciones`/`severity`).
- [`../../services/agregadoEnsayoService.js:1117`](../../services/agregadoEnsayoService.js) — caller que construye `_evaluacion` con solo 4 campos (`{estado, mensaje, informativo, alerta}`).

**Qué:** El dispatcher canónico de alertas (Commit 6) ya está listo para
recibir `ComplianceResult` con los campos `severity`, `conditions[]` y
`detection_limit` que activan los disparadores nuevos del Prompt 1
(`APTITUD_CONDICIONADA`, `ENSAYO_NO_CUMPLE_BLOQUEANTE`,
`ENSAYO_INCONCLUYENTE`). Pero el motor `evaluarEnsayo()` no los produce
todavía: el output `_evaluacion` se construye en
`agregadoEnsayoService.js:1117` con solo 4 campos:
```js
resultado._evaluacion = { estado, mensaje, informativo, alerta };
```

Confirmado por `grep`: `condicional` y `condiciones` NO aparecen en
`ensayoEvalEngine.js`. La lógica que produce `cumple_condicional` con
`conditions[]` vive en `aptitudMaterialesService.js` (motor de aptitud
de materiales para dosificación), que **no es invocado** desde
`guardarEnsayo`. Son dos motores distintos que no se comunican.

**Implicancia para release de Prompt 1:** El comportamiento observable
post-Commit 6 es **idéntico** al pre-Commit 6 — los disparadores nuevos
están armados conceptualmente pero ningún flujo en producción los activa.
No se necesita aviso a usuarios ni changelog.

**Implicancia para Prompt 2 — la deuda real:** El refactor del motor
debe garantizar que el output de `evaluarEnsayo()` (y por extensión, el
shape persistido en `_evaluacion`) propague:
- `condicional: boolean` y `condiciones: [{ key, value, description, source }]`
  cuando un evaluador detecta zona condicional (ej: pasante #200 en zona
  `maxStrict < v ≤ maxStandard` con `exclude_destination`).
- `severity: 'bloqueante' | 'no_bloqueante' | null` en casos `NO_CUMPLE`,
  cuando el motor pueda determinar la severidad por contexto.
- `detection_limit` en casos `NO_CONCLUYENTE` (ej: cloruros con `< 0,01%`
  vs límite `0,04%` con precisión requerida `≤ 0,003%`).

Sin esa propagación, los disparadores nuevos del dispatcher quedan
permanentemente dormidos y todo el trabajo de Commits 1-6 queda
sin efecto observable.

**Resolución:** Prompt 2. La conexión entre las dos piezas ya construidas
(motor y dispatcher) es lo que finalmente activa el modelo canónico.

**Estado post-C6:** ✅ El motor de **ensayos** (`evaluarEnsayo` →
`_evaluacion.compliance` → dispatcher) está cerrado. APTITUD_CONDICIONADA
y ENSAYO_INCONCLUYENTE se activan en producción para los evaluadores
refactoreados en C4.

**Estado post-C7:** ✅ El motor de **aptitud** (`verificarAptitudAF/AG` →
`item.compliance` con severity calculada) ahora produce ComplianceResult
canónico que el dispatcher consume directamente. Smoke real validado
(`scripts/smoke-c7-aptitud.js`): pasante200 zona condicional produce
APTITUD_CONDICIONADA, zona estricta con contexto severo produce
ENSAYO_NO_CUMPLE_BLOQUEANTE.

**Cierre completo (Prompt 2 C9):** `dosificacionDisenoService.js` ahora
invoca al dispatcher después de cada `verificarAptitudAF/AG` en los 3 hot
spots (líneas ~2705, 2763, 2872) vía el helper `_dispatchAptitudAlertsForVerificacion`
con anti-duplicado (skip si ya hay PENDIENTE con mismo material+codigoEnsayo+
complianceStatus, mismo patrón que `verificarVencimientosEnsayos`).

**Smoke real validado** (`scripts/smoke-c9-aptitud-flujo-real.js`):
- Llamada a `verificarAptitudMaterialesByParams` (POST /aptitud-materiales-calc
  via service) con pasante200=4% sin desgaste produce APTITUD_CONDICIONADA
  con `value=['surface_wear']` automáticamente.
- Re-llamada con mismos parámetros: 0 alertas nuevas (anti-duplicado OK).
- Mismo material con `expuestoDesgaste: true`: produce ENSAYO_NO_CUMPLE_BLOQUEANTE
  con severity calculada por contexto.

**Estado actual (post-C9):** D14 cerrado completo. Los 3 disparadores nuevos
(APTITUD_CONDICIONADA, ENSAYO_NO_CUMPLE_BLOQUEANTE, ENSAYO_INCONCLUYENTE) se
emiten en producción tanto desde el motor de ensayos (C6) como desde el
motor de aptitud (C9), con anti-duplicado en ambos flujos.

---

## D19 — Staleness del `veredictoGlobal` re-computado en cada `getResumen` (Prompt 2 C11.4)

**Archivo:** [`../../services/agregadoEnsayoService.js`](../../services/agregadoEnsayoService.js) — función `getResumen` y su `veredictoGlobal`.

**Qué:** El campo `veredictoGlobal` que `getResumen` agrega al response NO
se persiste en BD — se RECALCULA en cada lectura. Es "fresh" respecto al
estado actual de los ensayos, pero tiene dos riesgos:

1. **Reglas del motor cambian → ensayos viejos quedan stale.**
   El path 1 de la resolución (`_evaluacion.compliance` persistido) lleva
   el `compliance` que tenía el motor cuando el ensayo fue creado. Si en
   un futuro Prompt se refactora un evaluador o se cambia un límite, los
   ensayos viejos no se re-evalúan automáticamente. Path 2 (re-invocar
   `evaluarEnsayo` sobre el `resultado` raw) sí refleja reglas vigentes,
   pero solo se activa si path 1 no resuelve.

2. **No hay notificación de cambios.**
   Un cliente que cachea `veredictoGlobal` no se entera si los datos
   subyacentes cambian. Para refresh, hay que volver a invocar `getResumen`.

**Mitigación actual:** documentado en JSDoc de `getResumen`. Para forzar
refresh masivo: `reevaluarEnsayosAntiguos(db, { forzar: true })` re-evalúa
todos los ensayos activos y actualiza el `compliance` persistido.

**Plan de cierre (post-Prompt 2):**
- Si en Prompt 3 los renderers necesitan freshness garantizada, considerar
  invalidar `_evaluacion.compliance` cuando se publique una nueva versión
  del motor (campo `motorVersion` en `_evaluacion` + comparación al leer).
- Alternativamente, persistir `veredictoGlobal` como columna derivada del
  agregado y recalcularla via cron / evento de cambio de ensayo.
- Hoy el costo de stale es bajo: el motor del Prompt 2 está estable y el
  uso del campo en frontend es para visualización (no decisión crítica).

**Categoría:** deuda viva. Re-evaluar al cierre del Prompt 3.

---

## D20 — Granulometría individual: cambio observable canónico (Prompt 2 C10.2)

**Archivo:** [`../ensayoEvalEngine.js`](../ensayoEvalEngine.js) — evaluador `IRAM1505_GRANULOMETRIA`.

**Qué:** En C10.2 se aplicó el patrón **Hybrid Option B** (mismo que D15
para Petrográfico/RAS) a granulometría individual:

| Caso | Legacy `estado` | Canónico `compliance.status` |
|---|---|---|
| Banda fuera (cualquier path: AF auto, AG auto, manual) | `NO_CUMPLE` | `passWithObservations` |

**Observable change observable más importante del Prompt 2:**
El dispatcher de alertas trata `passWithObservations` como NO disparable.
Por lo tanto, los ensayos de granulometría con tamices fuera de banda
**dejan de generar alertas** `ENSAYO_NO_CUMPLE_BLOQUEANTE`. La verificación
crítica granulométrica es `granulometriaMezcla.js` (Nivel 2) sobre la curva
combinada — no el agregado individual (Nivel 1, informativo).

**Why-Hybrid-B (auditoría C10.1):** Option A (full change to legacy CUMPLE
+ canónico passWithObservations) habría cambiado counters en
`MaterialDetailPage.jsx:415` y badges en `MezclaDetallePage.jsx:1183` —
observable change indeseado en Prompt 2. Option B preserva legacy
(zero observable en counters/badges) y promueve canónico (renderers Prompt 3
verán passWithObservations).

**Cierre conjunto con D15:** ambas asimetrías legacy/canónica se resuelven
cuando los renderers de Prompt 3 migren a leer `compliance.status`. En ese
momento, los evaluadores pueden volver a un legacy alineado y eliminar el
`complianceHint` transicional.

---

## D21 — Optimizador y ajuste post-optimización no consumen compliance canónico (Prompt 4 — decisión de dominio)

**Archivos:**
- [`../../../../hormiqual-frontend/src/components/calidad/diseno/AjustePostOptimizacion.jsx`](../../../../hormiqual-frontend/src/components/calidad/diseno/AjustePostOptimizacion.jsx) — sliders post-solver para afinar la mezcla.
- [`../../../../hormiqual-frontend/src/components/calidad/diseno/mezclaCalcEngine.js`](../../../../hormiqual-frontend/src/components/calidad/diseno/mezclaCalcEngine.js) — `evaluarContraBanda` (output binario `cumple` consumido por el ranking de candidatos).

**Qué:** Dos archivos del pipeline de optimización de mezclas usan vocabulario
binario `cumple: boolean` (CUMPLE / NO CUMPLE) como primitiva de decisión:

1. **`mezclaCalcEngine.evaluarContraBanda`** retorna
   `{ cumple, fueraDeBanda, alertasMargen, series }`. El boolean `cumple` se
   consume por el optimizer para decidir qué candidato fits a la banda y se
   usa en el ranking de mezclas sugeridas.

2. **`AjustePostOptimizacion`** lee el resultado del solver y permite al
   usuario ajustar manualmente la dosificación; la lógica de "qué proporción
   sigue cumpliendo" usa el mismo binario.

Migrar la shape de retorno de estos primitivos al modelo canónico
(`ComplianceResult`) cambia el contrato del optimizer:
- ¿Un candidato `passWithObservations` rankea igual que un `pass`?
- ¿Un `conditionalPass` se descarta o se considera con menor preferencia?
- ¿`fail` con severity bloqueante se filtra antes del ranking?

**Por qué no se elevó en Prompt 3:** estas son decisiones de **dominio**
(reglas de selección de mezclas), no decisiones de **presentación**. Tocar
el output del optimizer cambia qué mezcla recomienda el sistema — un cambio
funcional, no visual. La política del refactor en curso es no alterar
comportamiento del optimizador; sólo alinear la presentación.

**Criterio de scope que se aplicó (C8 mapping):**
> "¿la migración del valor cambia el output del optimizador? Si sí, fuera del
> Prompt 3; si no, dentro."

Los display sites que **muestran** el resultado del optimizador SÍ se
migraron (MezclasPage 3 sites en C8 — Tag CUMPLE/NO CUMPLE → APTO/NO APTO).
La primitiva del cálculo NO se tocó.

**Para Prompt 4 — preguntas que el stakeholder de mezclas necesita responder:**
1. ¿Una mezcla `passWithObservations` debe rankear con misma prioridad que `pass`?
2. ¿Una mezcla `conditionalPass` (ej. requiere cemento bajo álcali) debe
   sugerirse al usuario o filtrarse del resultset por defecto?
3. ¿Cómo se comunica al usuario que la mezcla "óptima" tiene observaciones
   o condiciones?

**Categoría:** decisión de dominio. Bloqueante para evolucionar el optimizador,
no bloqueante para Prompt 3. Cuando se aborde, los 2 archivos se migran en
conjunto porque comparten el mismo vocabulario binario.

---

## D17 — Fix de mapeo legacy 'incompleto' / 'cumple_con_atencion' (Prompt 2 C9.1)

**Archivo:** [`../dosificacion/aptitudMaterialesService.js`](../dosificacion/aptitudMaterialesService.js) — helper `_buildAptitudGlobalCompliance`.

**Bug latente arreglado:** El call site previo `fromAnyLegacy(resultadoGlobal)`
en `verificarAptitudAF/AG` aplicaba el dispatcher genérico `fromLegacyEval`
que tiene una tabla `normalizeLegacyStatus` con dos mapeos incorrectos para
el vocabulario de aptitud:

| `resultadoGlobal` | Mapeo previo (bug) | Mapeo correcto (C9.1) |
|---|---|---|
| `incompleto` | `notEvaluated` ✗ | `pending` ✅ |
| `cumple_con_atencion` | `pass` ✗ | `passWithObservations` ✅ |

**Origen del bug:** la tabla `normalizeLegacyStatus` se construyó como
"capa de traducción de strings legacy uppercase" (Prompt 1 Bloque C v4),
pensada principalmente para el vocabulario del motor de ensayos
(`CUMPLE`, `NO_CUMPLE`, `NO_EVAL`...). Cuando se incorporó el vocabulario
de aptitud (lowercase, con valores como `incompleto` y `cumple_con_atencion`),
las dos entradas problemáticas se agregaron a la tabla pero apuntando a
estados canónicos incorrectos (`NOT_EVALUATED` para 'incompleto' debió
ser `PENDING`; entrada para 'cumple_con_atencion' faltaba — caía al
default que es Pass via `informativo`/legacy).

**Justificación normativa del fix:**
- `incompleto` significa "faltan ensayos exigibles para concluir" — eso
  es exactamente la semántica de `Pending` (decisión de cierre Prompt 1).
  Mapearlo a `notEvaluated` mata el disparador `MATERIAL_SIN_ENSAYO`
  cuando se dispone con `options.exigible: true`.
- `cumple_con_atencion` lleva una observación técnica que NO debe
  perderse — es el caso paradigmático de `passWithObservations`.
  Colapsarlo a `pass` borra la observación a nivel de status.

**Impacto observable en producción (Prompt 2):**
- ✅ **Cero impacto inmediato:** ningún call site actual lee
  `verif.compliance.status` (verificado via `grep`). El campo `compliance`
  global de la verificación de aptitud existe como API forward-looking
  pero nadie lo consume todavía. La activación de `MATERIAL_SIN_ENSAYO`
  vendría del dispatcher leyendo `item.compliance.status`, no del global.
- ⏳ **Impacto futuro (Prompt 3):** cuando los renderers (PDF, frontend)
  empiecen a leer el status canónico, verán `passWithObservations` /
  `pending` correctamente — lo que era invisible antes ahora se
  distingue. Esto es activación de información dormida, no regresión.

**Plan de cierre:** Documentado solamente. El cambio es estrictamente
correcto (alineado con el adapter `fromAptitudServiceShape` que ya tenía
los mapeos correctos en `GLOBAL_STATE_TO_BUILDER`). Los renderers de
Prompt 3 deben leer el status canónico — D17 cierra junto con D1
cuando los renderers migren.

**Test de regresión:** `__tests__/aptitudGeneralizedConditions.test.js`
sub-suite "C9.1 — global compliance no pierde semántica" — 4 tests que
fijan el contrato canónico.

---

## ~~D18 — Inferencia de `tipoAg` en `createEnsayo`~~ ✅ (Prompt 2 C11.2)

**Estado:** Cerrado. La inferencia de `tipoAgregado` desde
`AgregadoMeta.subtipoMaterial` se aplicó tanto en `getResumen` (C10) como
en `createEnsayo` (C11.2). Cuando `tipo.aplicaA` es ambiguo
(`['FINO','GRUESO']`), el código consulta `AgregadoMeta` y mapea
`ARENA_NATURAL/ARENA_TRITURACION/MEZCLA → FINO` y resto → `GRUESO`.

---

## D18 (referencia histórica) — Inferencia de `tipoAg` en `createEnsayo` no consulta AgregadoMeta cuando `tipo.aplicaA` es ambiguo (Prompt 2 — descubierto en smoke C9.3)

**Archivo:** [`../../services/agregadoEnsayoService.js`](../../services/agregadoEnsayoService.js) — líneas ~1113-1117.

**Qué:** En `createEnsayo`, la auto-evaluación contra parámetros normativos
infiere `tipoAg` del array `tipo.aplicaA` solo cuando ese array tiene un
único valor:

```js
let tipoAg = null;
if (tipo.aplicaA) {
  const arr = typeof tipo.aplicaA === 'string' ? JSON.parse(tipo.aplicaA) : tipo.aplicaA;
  if (arr.length === 1) tipoAg = arr[0];   // ← solo cuando único
}
```

Para tipos de ensayo que aplican a ambos AF y AG (ej:
`IRAM1674_MATERIAL_FINO_200` con `aplicaA = ['FINO', 'GRUESO']`),
`tipoAg` queda en `null`. El evaluador del motor entonces defaultea
al path **AG** (porque `esAF = ctx.tipoAgregado === 'FINO' || ...`
falla con `null`), lo que aplica los límites equivocados cuando el
agregado real es FINO.

**Síntoma observado en smoke C9.3:** Crear ensayo pasante200=4% para
`Las Quebradas` (FINO ARENA_NATURAL) produce:
- **createEnsayo** (path AG default, mal contextualizado): "Pasante #200
  AG: 4% supera ambos límites (1,0% y 1,5%)." → `ENSAYO_NO_CUMPLE_BLOQUEANTE`
- **verificarAptitudAF** (contexto FINO correcto): cumple_condicional
  con `exclude_destination=['surface_wear']` → `APTITUD_CONDICIONADA`

Las dos alertas describen el mismo ensayo con vistas contradictorias.
Para el usuario, la alerta de `createEnsayo` es ruido falso; la de
aptitud es la lectura correcta.

**Por qué no se detectó antes:** la auto-evaluación de `createEnsayo`
existe desde antes del Prompt 1 y siempre tuvo este corner case. Hasta
C6, el `_evaluacion` no propagaba severity, así que las alertas legacy
se emitían como `ENSAYO_NO_CUMPLE / ALTO` (no bloqueante visible).
Post-C6 la severity se calcula correctamente pero AÚN sobre el contexto
equivocado del evaluador, y eleva la alerta a `BLOQUEANTE / CRITICO`,
amplificando la visibilidad del problema.

**Resolución (post-Prompt 2):** En `createEnsayo`, cuando `tipo.aplicaA`
no es único:
1. Consultar `AgregadoMeta.subtipoMaterial` para `legacyAgregadoId`.
2. Mapear subtipo → tipoAg: ARENA_NATURAL/ARENA_TRITURACION/MEZCLA → FINO,
   resto → GRUESO (ya existe `FINO_SUBTIPOS` en
   `dosificacionDisenoService.js:2633` y `:2818`).
3. Si AgregadoMeta no resuelve, mantener `null` (caso defensivo).

Cambio acotado a ~10 líneas de código. Test sugerido: `createEnsayo`
con tipo ambiguo + agregado FINO → motor evalúa contra límites AF.

**Costo de mantener:** Bajo si los flujos de aptitud se priorizan sobre
los del motor (la alerta del motor se puede filtrar como duplicada en
UI). Alto si el usuario lee la alerta del motor sin contexto.

**Prioridad:** Media. Ideal para un toque editorial post-Prompt 2 o
junto con C11 si queda margen de tiempo.

---

## D23 — Verificaciones aire/pulverulento/HP no producen compliance canónico (Prompt 3 C5 — informativa)

**Archivo:** [`../../../../hormiqual-frontend/src/components/calidad/dosificacion-diseno/DosificacionDisenoPage.jsx`](../../../../hormiqual-frontend/src/components/calidad/dosificacion-diseno/DosificacionDisenoPage.jsx) — bloques B/C/D del cálculo de dosificación.

**Qué:** Las 3 verificaciones del cálculo de dosificación
(`verificacionAire` por Tabla 4.3, `verificacionPulverulento` por Tabla 4.4,
y la `comparacion` de producto HP) producen flags booleanos
(`true | false | null`) desde el motor de cálculo del backend, NO un
`ComplianceResult` canónico estructurado.

C5 las migró a categorías visuales con `categoriaDeBoolean`:
- `true → APTO`
- `false → NO APTO`
- `null → EVALUACIÓN INCOMPLETA`

Solo 3 categorías de las 7 son alcanzables. Eso significa que estas
verificaciones nunca van a mostrar `passWithObservations` (cumple cerca
del límite) ni `conditionalPass` (cumple bajo condiciones), aunque el
modelo canónico los soporta.

**Por qué no se elevó:** el motor de cálculo (`dosificacionService` /
`mezclaCalcEngine`) usa esos flags como variables internas de control de
flujo del LP de optimización. Convertirlos a ComplianceResult requiere:
1. Decidir cuándo un valor "cerca del límite" debería ser observación.
2. Decidir cuándo una verificación debería ser condicional.
3. Refactorizar el cálculo para que el output sea estructurado, no booleano.

Esa decisión es de dominio (similar a D21 con AjustePostOptimizacion +
mezclaCalcEngine) — requiere conversación con stakeholder de
mezclas/dosificación.

---

## D24 — Banner ejecutivo al inicio del INF (Prompt 3 C9.3 — UX)

**Archivo:** [`../../../../hormiqual-frontend/src/components/calidad/ensayos-agregados/agregadoFichaTecnicaPdf.js`](../../../../hormiqual-frontend/src/components/calidad/ensayos-agregados/agregadoFichaTecnicaPdf.js)

**Qué:** Durante C9.3 se debatió la ubicación de la nueva sección "G. Veredicto
del agregado" — al inicio del INF (executive summary) o al final (dictamen).
Se eligió el final porque es la convención de informes técnicos profesionales:
el lector debe ver el análisis antes que la conclusión.

**Pendiente:** evaluar si agregar también un **banner ejecutivo corto al
inicio** que repita sólo el veredicto global (label + color), además de la
sección detallada al final. La idea es que el lector pueda reconocer el
estado del material en el primer vistazo sin pasar por todas las páginas.

**Criterio de decisión (no es técnico, es de UX):**
- ¿El usuario lee el INF para auditoría (top-to-bottom) o para consulta rápida
  (necesita el veredicto al instante)?
- ¿Cuántas páginas tiene un INF típico? Si son 2-3, el banner no aporta
  vs scroll al final. Si son 8-10, sí.
- ¿El veredicto al inicio se interpreta como "ya decidido" antes de ver datos?
  ¿Genera sesgo de lectura?

**Por qué no se elevó en C9.3:** la decisión es UX, no normativa. Validar
primero que el formato actual (dictamen al final) funciona bien con usuarios
reales antes de evaluar si el banner aporta o satura.

**Categoría:** decisión de producto. Diferida a sprint con stakeholder de
producto/UX. No bloqueante.

---

## D25 — Watermark "ENTORNO DE DESARROLLO" se corta visualmente en A4 (Prompt 3 C9.3 — layout)

**Archivos:**
- [`../../../../hormiqual-frontend/src/lib/environment/index.js`](../../../../hormiqual-frontend/src/lib/environment/index.js) — `environmentWatermarkText` retorna el string completo.
- Renderers que lo estampan: `certificadoCumplimientoPdf.js`, eventualmente
  los demás PDFs en C9.4/C9.5.

**Qué:** El watermark `'ENTORNO DE DESARROLLO — NO USAR EN OBRA'` (37 caracteres)
se renderiza diagonalmente a -20° con `fontSize: 32` en el centro de páginas
A4 (210mm × 297mm). El ancho del texto a esa fontSize y ángulo supera el
ancho de página utilizable, y `jsPDF` lo recorta sin generar warning. El
usuario ve algo como `'RNO DE DESARROLLO — NO USAR EN OB'` (cortado al
inicio y al final) en un INF de prueba.

**Lo que indica:** el código fuente NO está bug — `environmentWatermarkText`
emite el string completo. Es un edge case de cómo jsPDF aplica el clipping
cuando el texto rotado excede los márgenes de página. Pasó inadvertido durante
mucho tiempo porque el watermark sólo aparece en ambientes no-prod.

**Opciones de fix (no en C9.3):**
1. Reducir `fontSize` a 24-26 — el texto sigue legible y entra completo.
2. Reducir el ángulo de -20° a -10° — el ancho diagonal proyectado disminuye.
3. Reescribir el texto a algo más corto (ej. `'BORRADOR — NO USAR'`).
4. Combinar 1+2.

**Categoría:** layout edge case, no bloqueante en producción (en prod el
watermark no aparece). Diferido a Prompt 4 o sprint visual. Anotado para no
perderse de vista la próxima vez que alguien toque watermarks de PDF.

---

## D26 — Vocabularios de dominio específicos preservados, coexistiendo con el modelo canónico (Prompt 3 C9.4 + C9.5 — decisión de dominio)

**Patrón general:** vocabulario terminológico deliberado de un flow específico
que coexiste con el modelo canónico de 7 categorías. La canonicalización
**resta** matiz en estos casos: el flow tiene su propio set de estados
diseñado para una semántica que el canónico no captura. Reconciliación vía
adapter sólo si emerge necesidad cross-módulo (ej. certificado formal que
requiera unificación).

**Hoy: dos modelos coexisten sin fricción.** Cada flow renderiza su propio
vocabulario en sus propios documentos; ningún caller cross-módulo necesita
leer un veredicto unificado.

**Si aparece un tercer caso del mismo patrón en el futuro, se suma como
ejemplo adicional dentro de D26 — no se abre Dxx nuevo.**

---

### Caso A — Modelo prestacional de mezclas

**Archivo:** [`../../../../hormiqual-frontend/src/components/calidad/diseno/mezclaInformePdf.js`](../../../../hormiqual-frontend/src/components/calidad/diseno/mezclaInformePdf.js)
— función `consolidarEstadoMezcla` (~L139) y constantes
`ESTADO_MEZCLA_LABELS` / `ESTADO_MEZCLA_COLORS` / `VIAB_MEZCLA_LABELS`.

**Qué:** El informe de mezcla emite un dictamen global con un modelo
prestacional de **6 estados** distinto al modelo canónico de **7 categorías**:

| Prestacional        | Canónico aproximado     | Diferencia |
|---------------------|--------------------------|------------|
| CUMPLE              | APTO                     | 1:1 |
| CUMPLE_OBS          | APTO_CON_OBSERVACIONES   | 1:1 |
| **REQUIERE_AJUSTE** | (sin equivalente directo)| Nivel intermedio: desvíos puntuales gestionables. |
| **CON_DESVIOS**     | APTITUD_CONDICIONADA     | Lenguaje no-terminal explícito ("gestionable con pastón"), no es un veredicto bloqueante. |
| NO_CUMPLE           | NO_APTO                  | Sólo casos extremos (sin curva, datos insuficientes, desvíos > 8 pp en muchos tamices). |
| INCOMPLETA          | EVALUACIÓN_INCOMPLETA    | 1:1 |

**Por qué se preserva el modelo prestacional:**

El comentario in-code (mezclaInformePdf.js L78-101) documenta la decisión de
dominio reciente y explícita:

> "El consolidador previo emitía 'NO_CUMPLE' como veredicto terminal apenas
> había más de 2 tamices fuera de banda, confundiendo 'no conformidad
> normativa' con 'inviabilidad técnica'. El modelo nuevo reserva NO_CUMPLE
> para casos verdaderamente bloqueantes... Encauza los desvíos gestionables
> a CON_DESVIOS o REQUIERE_AJUSTE, con lenguaje no-terminal: el material
> puede seguir siendo viable con pastón de prueba y aceptación técnica del
> desvío."

El INF de mezcla no es un certificado formal — su footer aclara
"Este documento no reemplaza ensayos de laboratorio ni la evaluación de un
profesional competente". Es un informe de cálculo orientativo.

C9.4 (camino α) migró sólo los display sites de **requisito individual por
celda** (color/icon canónico, texto técnico "Cumple / No cumple / Atención"
preservado, mismo patrón que C9.3). El consolidador prestacional quedó
intacto deliberadamente.

**Trigger concreto que dispararía la implementación del adapter
prestacional → canónico:**

Si el certificado formal de mezcla (`certificadoCumplimientoPdf` aplicado a
una mezcla, no solo a un agregado) requiere mostrar un **veredicto canónico
de la mezcla** derivado del estado prestacional. Hoy
`certificadoCumplimientoPdf` recibe `veredictoGlobal` pre-computado del
backend (vía `emitDocument`); si ese flujo se extiende a mezclas, el adapter
es necesario. Sin ese trigger no hay caller que justifique la API extra.

**Lock-in test:** existe un test que documenta la decisión y rompe si alguien
intenta canonizar el consolidador sin abrir D26 — ver
`mezclaInformePdf.test.js` "El consolidador prestacional NO incluye un
campo compliance canónico (D26 lock-in)".

---

### Caso B — Veredicto experimental de pastón (Prompt 3 C9.5)

**Archivo:** [`../../../../hormiqual-frontend/src/components/calidad/dosificacion-diseno/dosificacionInformePdf.js`](../../../../hormiqual-frontend/src/components/calidad/dosificacion-diseno/dosificacionInformePdf.js)
— sección "Verificación experimental" (~L5288-5302).

**Qué:** El bloque de veredicto experimental de un pastón emite un dictamen
con vocabulario propio del flow de validación experimental:

| Veredicto pastón | Color | Semántica |
|---|---|---|
| `APROBADO`  | verde      | El pastón superó la prueba experimental. |
| `RECHAZADO` | rojo       | El pastón falló la prueba; la dosificación no se libera. |
| `OBSERVADO` | naranja    | El pastón cumplió con observaciones del responsable técnico. |

Más metadata: `evaluadoPor`, `veredictoEmitidoPor`, `fechaVeredicto`.

**Por qué se preserva:**

El veredicto de pastón es un **acto formal del responsable técnico tras una
prueba experimental controlada** — no es el mismo concepto que el compliance
de un material o de un requisito normativo individual. Las diferencias
semánticas con el canónico:

1. El acto incluye **firma del responsable** y **fecha del veredicto** — es
   un documento formal con trazabilidad de decisión humana, no un cálculo.
2. `OBSERVADO` significa "cumplió con observaciones del que firmó", no
   "cumple con observaciones técnicas del motor". El matiz es quién decide:
   acto humano vs evaluación automática.
3. `RECHAZADO` puede aplicarse a un pastón que **canónicamente sería APTO**
   pero el responsable técnico decidió rechazarlo por razones contextuales
   (ej. falta de confianza en la calibración del laboratorio que evaluó).

Forzar el alineado al canónico colapsa el matiz "decisión humana
contextualizada" que es exactamente lo que un veredicto experimental aporta
sobre un cálculo automático.

**Trigger concreto que dispararía la canonización:** si el certificado formal
del hormigón requiriese mostrar un veredicto unificado que combine compliance
del material + verificación CIRSOC + veredicto experimental de pastón en un
único string canónico. Hoy estos tres niveles se renderizan separados; cada
uno con su vocabulario.

---

**Categoría general:** decisión de dominio. Deuda condicional que se resuelve
sólo si emerge el trigger cross-módulo. No es deuda urgente. Cada caso
preserva su vocabulario específico hasta que aparezca el caller que demande
unificación.

---

## D27 — Deuda de pureza arquitectónica preexistente en `src/domain/` (Prompt 3 C9.4 — descubierto en auditoría)

**Origen:** auditoría de pureza arquitectónica del subagente `revisor-engine-purity`
ejecutada al cierre de C9.4. El cambio del Prompt 3 a `requisitosEnsayos.js`
(agregado `DISPLAY_NAME` + `getDisplayName`) es **puro y NO introduce
regresiones**. Las violaciones listadas son **todas preexistentes** al refactor
de compliance canónico.

CLAUDE.md establece como regla: "Antes de tocar `src/domain/`, leé
`hormiqual-backend/CLAUDE.md` (reglas de pureza). No agregues imports de
modelos Sequelize, `fetch`, ni acceso a `req` en engines." Sin embargo el
codebase actual viola esa regla en 10 ubicaciones distribuidas en 8 archivos.

**Categorización en dos grupos:**

### Grupo A — Engines con I/O accidental (resoluble por refactor de pasaje de datos)

Patrón común: el engine carga sus propios datos desde BD o desde otros
services (vía `require` dinámico o estático), en lugar de recibirlos
ya-resueltos por parámetro. El refactor para cada uno es: mover la carga de
datos al caller en `src/services/`, y pasar al engine sólo la estructura
de datos pura.

| Archivo:línea | Patrón concreto | Estado |
|---|---|---|
| ~~`ensayoEvalEngine.js:438`~~ | ~~`require('../services/granulometriaEvalService')` dinámico~~ | **Resuelto (auditoría 01-calidad C2 / Fase C R2 — 2026-05-07)**: línea 485 ahora hace `require('./granulometria/resolverCumpleGrueso')` apuntando a un módulo de domain. La función pura se extrajo a `src/domain/granulometria/resolverCumpleGrueso.js`; el service la re-exporta para back-compat. |
| ~~`compliance/granulometriaMezcla.js:155`~~ | ~~`require('../../services/importIRAM1627Service')` (lee disco con `fs`)~~ | **Resuelto (Fase C R2 — 2026-05-07)**: el engine recibe `bandasIRAM1627Tablas` por inyección desde el caller (`mezclaService.evaluarBandaDualIRAM1627`). |
| ~~`compliance/granulometriaMezcla.js:190`~~ | ~~`require('../../services/granulometriaEvalService')` dinámico~~ | **Resuelto (Fase C R2 — 2026-05-07)**: el engine recibe `evalContraSpec` por inyección. |
| ~~`dosificacion/sugerenciaMezclaEngine.js:12`~~ | ~~`require('../../services/tipologiaHormigonService')` estático~~ | **Resuelto (Fase C R2 — 2026-05-07)**: la tabla `SHILSTONE_POR_TIPOLOGIA` y `getShilstoneConfig` (puras) viven en `src/domain/dosificacion/shilstoneConfig.js`; el engine importa de domain. |
| ~~`mezclaPropsEngine.js:113`~~ | ~~`db.AgregadoEnsayo.findAll(...)`~~ | **Resuelto (Fase C R3 — 2026-05-07)**: `fetchEnsayoResults` migrada a `src/services/mezclaPropsService.js`. |
| ~~`mezclaPropsEngine.js:193-194`~~ | ~~`db.AgregadoFino.findByPk`, `db.AgregadoGrueso.findByPk`~~ | **Resuelto (Fase C R3 — 2026-05-07)**: `calcularPropiedadesCombinadas` migrada al service. 3 callers actualizados. |
| ~~`compliance/materialContext.js:99`~~ | ~~`process.env.NODE_ENV` para logging condicional~~ | **Resuelto (Fase C R1 — 2026-05-07)**: removido junto con 5× `console.debug`. |
| ~~`compliance/materialContext.js:107,112,140`~~ | ~~`db.Agregado.findByPk`, `db.AgregadoMeta.findOne`, `db.Cemento.findByPk`~~ | **Resuelto (Fase C R3 — 2026-05-07)**: `materialContextFromDb` migrada a `src/services/materialContextService.js`. El domain solo expone `createMaterialContext` (puro). |
| ~~`dosificacion/trabajabilidadEngine.js:31`~~ | ~~`db.ParametroTrabajabilidad.findAll(...)` + cache global~~ | **Resuelto (auditoría 01-calidad C1 — 2026-05-07)**: la carga vive en `services/dosificacionDisenoService.js` y se pasa al engine vía `dbParams`. Engine puro. |

**Estado del Grupo A:** ✅ **Cerrado en su totalidad** durante la auditoría
01-calidad (sesión 2026-05-07). Validado por `revisor-engine-purity` post
Ronda 3: cero violaciones canónicas en `src/domain/`. Backend 116/116 suites,
2531 tests verdes.

### Grupo B — Archivo completo mal ubicado

| Archivo | Patrón concreto |
|---|---|
| `dosificacion/alertasMaterialService.js` | Servicio de persistencia completo viviendo en `domain/`. Tiene `db.sequelize.query` raw + ~10 llamadas Sequelize CRUD (`findOne`, `create`, `update`, `findAll`, `findByPk`). Ya lleva `Service` en el nombre — el directorio equivocado es el problema. |

**Refactor sugerido:** mover el archivo entero a `src/services/`. La función
`evaluarImpacto()` (lógica pura) puede separarse a un helper en `domain/`
si lo amerita. La estructura debería ser:
- `src/services/alertasMaterialService.js` — orquestación de persistencia
- `src/domain/alertasMaterialEngine.js` (opcional) — sólo `evaluarImpacto()`
  pura si tiene complejidad propia

**Costo estimado:** bajo. Es un `git mv` + ajustar paths de import en los
callers + verificar que ningún engine de `domain/` lo importa (lo cual ya
sería violación adicional).

**Riesgo de seguir como está:** alto en términos arquitectónicos. Un archivo
completo de servicio de persistencia disfrazado de domain es la peor forma
del mismo problema — confunde el contrato de la capa entera.

### Limítrofe aceptado

`dosificacion/hashIntegridad.js` usa `require('crypto')` (stdlib). Es una
transformación determinística sin side effects observables. Aceptable en
`domain/` mientras no se use para firmar, escribir certificados, o llamar
servicios externos. Uso actual (SHA-256 de JSON serializado) es puro.

**Plan de cierre:**
- Diferido a Prompt 4 o sprint dedicado a pureza arquitectónica.
- Empezar por Grupo B (1 archivo, costo bajo) como warmup.
- Grupo A puede atacarse incrementalmente uno por archivo, con tests de
  pureza vía subagente `revisor-engine-purity` por commit.

**Categoría:** deuda preexistente descubierta durante el Prompt 3. NO
producto de este refactor. No bloqueante para cerrar el Prompt 3 ni para
features nuevos. Sí bloqueante a futuro si se introducen tests
arquitectónicos automatizados.

**Categoría:** informativa. No bloqueante. Cuando se quiera ampliar el
matiz de las verificaciones, este es el punto de entrada.

---

## D28 — Fallback genérico de `resultadoDisplay` con precisión fija de 3 decimales (Prompt 3 — observado en smoke C9.2)

**Archivo:** [`../../../../hormiqual-frontend/src/lib/document-issuance/resultadoDisplay.js`](../../../../hormiqual-frontend/src/lib/document-issuance/resultadoDisplay.js) — fallback
genérico al final del switch (~L128).

**Qué:** El fallback genérico que cubre los ensayos químicos sin caso
específico (`Sulfatos`, `Sales solubles`, `Cloruros solubles`, `Terrones de
arcilla`, `Materias carbonosas`, `Durabilidad por sulfato`) usa
`fmt(r.valor, 3)` con **3 decimales fijos**.

Esto produce display correcto para químicos donde el valor típico es
< 0,1% (ej. cloruros ~0,003%), pero **excesivo** para ensayos como Terrones
de arcilla cuyo valor típico es 1-3% — el ingeniero ve "1,300 %" cuando
"1,30 %" sería suficiente.

**Observado en:** smoke C9.2 — celda "Terrones de arcilla y partículas
friables: 1,300 %" en la tabla de ensayos del certificado.

**Refactor sugerido:** mapeo per-código de precisión normativa, análogo a
las constantes `PRECISION` ya existentes en `lib/format/index.js`. Algo como
`PRECISION_BY_CODIGO = { TERRONES: 2, SULFATOS: 3, CLORUROS: 3, ... }` que
el switch consulte antes del fallback.

**Costo:** bajo (~10 líneas + tests). **Riesgo:** muy bajo — sólo cambia
display de PDF, no afecta cálculo ni evaluación.

**Categoría:** cosmética menor. Ideal para un toque editorial post-Prompt 3
o como warmup de Prompt 4. Anotado para no perderse de vista la próxima vez
que se toque `resultadoDisplay`.

---

## D22 — Cobertura de fallback legacy débil (Prompt 3 C3 — descubierto en smoke)

**Archivo:** [`../../../../hormiqual-frontend/src/lib/compliance/index.js`](../../../../hormiqual-frontend/src/lib/compliance/index.js) — `fromLegacyEval`.

**Qué:** Durante el smoke visual del C3 apareció un bug latente en
`fromLegacyEval` (frontend): el destructuring `const { detalle = [], observaciones = [] } = legacy`
asume que esos campos son arrays. Los ensayos persistidos en BD a veces
traen `observaciones: null` o un string suelto, lo que rompía el spread
`[...detalle, ...observaciones]` con `TypeError: observaciones is not iterable`.

El bug existía pre-Prompt 3 pero no se ejercitaba: hasta C3, el flujo
del componente no llamaba `fromLegacyEval` en este caso edge. C3 expandió
los call paths del adapter (override canónico cuando `compliance` falta
y `cumple`/`estado` legacy existe), exponiendo el bug.

**Lo que indica:**
- Los tests del Prompt 1 cubrían bien los caminos canónicos de
  `fromLegacyEval` (10 status, conditionals, etc).
- Pero los caminos de **datos malformados de producción** (BD con shape
  no estricto) no estaban cubiertos por tests — solo se descubrían al
  ejercitar visualmente.

**Fix aplicado en C3:** validación `Array.isArray(legacy.detalle)` y
`Array.isArray(legacy.observaciones)` antes del spread. Test de regresión
en `lib/compliance/__tests__/compliance.test.js` "REGRESIÓN C3:
detalle/observaciones no-array no rompe (null, string, undefined)".

**Resolución:** sin acción adicional. El bug está fixed y locked. Anotado
para Prompt 4: cuando se decida ampliar tests legacy o auditar otros
adapters, considerar agregar un set de tests con shapes "malformados de
producción" (campos null donde se espera array, strings donde se espera
objeto, números donde se espera string, etc.) para reducir el riesgo de
encontrar otro bug similar en producción.

**Categoría:** información para Prompt 4. No bloqueante.

---

## D16 — Source granulométrico de `desgasteLA` queda en referencia mínima (Prompt 2 C7)

**Archivo:** [`../dosificacion/aptitudMaterialesService.js`](../dosificacion/aptitudMaterialesService.js) — `limites.desgasteLA.condicional.source`.

**Qué:** Los 5 evaluadores AF/AG con dual-limit declarativo (pasante200 AF,
materiasCarb AF/AG, lajosidad, elongación, desgasteLA) declaran `source` en
su `lim.condicional`. Cuatro de ellos llevan referencia "rica" — citan
CIRSOC + tabla específica:

| Evaluador | Source declarado |
|---|---|
| pasante200 AF | `CIRSOC 200:2024 §3.2.3.3 Tabla 3.4` |
| materiasCarb AF | `CIRSOC 200:2024 §3.2.3.4` |
| materiasCarb AG | `CIRSOC 200:2024 §3.2.4 / Tabla 3.6` |
| lajosidad AG | `CIRSOC 200 Tabla 3.7` |
| elongación AG | `CIRSOC 200 Tabla 3.7` |
| **desgasteLA AG** | **`IRAM 1532`** ← más escueta |

`desgasteLA` solo cita la norma del ensayo (IRAM 1532) sin referenciar el
artículo CIRSOC que aplica al destino "pavement_abrasion". Si el PDF
renderea la condición con la fuente normativa, en este caso la línea
quedará menos informativa que las otras.

**Impacto:** Bajo — la condición sigue siendo válida y processable; solo
el texto al usuario es menos rico.

**Resolución:** Prompt 3 (renderers) o cuando se incorpore CIRSOC 200
§3.2.4.5 al catálogo de referencias. Cambio trivial: `source: 'IRAM 1532
/ CIRSOC 200 §3.2.4.5'`. No requiere migración ni back-compat.

---

## D15 — Asimetría legacy/canónica en evaluadores con `complianceHint` (Prompt 2 C4.3 + C10.2)

**Archivos involucrados:**
- [`../ensayoEvalEngine.js`](../ensayoEvalEngine.js) — evaluadores
  `IRAM1649_EXAMEN_PETROGRAFICO`, `IRAM1674_RAS_ACELERADO`,
  `IRAM1647_MATERIAS_CARBONOSAS`, `IRAM1519_ESTABILIDAD_BASALTICAS`,
  `IRAM1687_1_LAJOSIDAD`, `IRAM1687_2_ELONGACION`, `IRAM1532_DESGASTE_LA`,
  `IRAM1505_GRANULOMETRIA` (C10.2).
- [`../../../__tests__/conditionalPassPetrograficoRAS.test.js`](../../../__tests__/conditionalPassPetrograficoRAS.test.js)
  — regresión que codifica la asimetría como contrato.

**Qué:** Cinco evaluadores producen `estado` legacy distinto del estado
canónico que expone su `compliance: ComplianceResult`. La discrepancia
es deliberada y se materializa vía el campo `complianceHint` que el
helper `_buildComplianceFromEvaluadorOutput` consume con prioridad
sobre la derivación desde `estado`:

| Caso | Legacy `estado` | Canónico `compliance.status` | Razón asimetría |
|---|---|---|---|
| Petrográfico `no_cumple_reactivo` | `NO_CUMPLE` | `conditional_pass` (requires_mitigation) | Apto con cemento bajo álcali / IRAM 1674 |
| RAS acelerado ≥ 0,10% | `NO_CUMPLE` | `conditional_pass` (requires_mitigation) | Apto con cemento bajo álcali / puzolanas |
| Materias carbonosas zona 0,5–1,0% | `CUMPLE` (alerta) | `conditional_pass` (exclude `surface_wear`) | CUMPLE legacy preexistente |
| Estabilidad basálticas zona 10–30% | `CUMPLE` (alerta) | `conditional_pass` (requires_documentation `experience_25y`) | CUMPLE legacy preexistente |
| Lajosidad/Elongación/Desgaste LA zona intermedia | `CUMPLE` (alerta) | `conditional_pass` (exclude_destination) | CUMPLE legacy preexistente |
| **Granulometría banda fuera (C10.2)** | `NO_CUMPLE` | `pass_with_observations` | Nivel 1 informativo; verificación crítica es Nivel 2 (`granulometriaMezcla.js`) |

Los tres casos con `NO_CUMPLE` legacy (petrográfico, RAS, granulometría)
son los más sensibles porque
el `estado: 'NO_CUMPLE'` legacy es el que activa `AlertaCalidad` y dispara
el ENUM `cumple` actual. **La opción B aprobada** mantiene el legacy para
que el observable de alertas y dashboards no cambie hasta Prompt 3.

**Por qué se hizo así (Option B):**
- Migrar el `estado` legacy a `'CUMPLE'` ahora dejaría 4+ consumidores
  backend (visual/derivado) y 5+ frontend leyendo el ENUM `cumple` con
  un valor que oculta la condicionalidad. Es regresión observable.
- Migrar todo a `'CUMPLE'` y eliminar el hint requeriría auditar y
  migrar esos consumidores en el mismo commit, ampliando el blast
  radius de C4 a renderers/UI — fuera del alcance de Prompt 2.
- Mantener la asimetría con el hint preserva el comportamiento legacy
  (zero-regression) y simultáneamente activa la primera generación de
  `APTITUD_CONDICIONADA` desde el motor para el dispatcher canónico
  (D14 cerrado para estos códigos).

**Por qué `complianceHint` no es API estable:**
- Es un puente de transición entre el shape legacy del motor y el
  canónico. Una vez que los consumidores leen `compliance.status`, el
  hint se vuelve redundante: el evaluador puede producir directamente
  `estado: 'CUMPLE'` y el helper deriva el canónico vía la rama
  legacy con `condicional/condiciones` propagados ya como first-class.
- El hint vive solo dentro de `_buildComplianceFromEvaluadorOutput` y
  no se persiste ni se expone fuera del motor.

**Resolución (Prompt 3):**
1. Migrar consumidores backend de `cumple === 'NO_CUMPLE'` a
   `compliance.status` (4 sites identificados; algunos derivados de
   `_evaluacion`, otros de queries directas a AgregadoEnsayo).
2. Migrar consumidores frontend (5 sites — incluidos en D1).
3. Una vez todos los consumidores leen `compliance.status`:
   - Petrográfico/RAS reactivos: cambiar `estado: 'NO_CUMPLE'` →
     `estado: 'CUMPLE'` con `condicional: true` + `condiciones[]`.
   - Eliminar `complianceHint` de los cinco evaluadores listados.
   - Verificar que las regresiones de
     `__tests__/conditionalPassPetrograficoRAS.test.js` se actualicen
     a la API estable (ya no testean asimetría).
4. Auditar `AlertaCalidad` para asegurar que la transición de
   `ENSAYO_NO_CUMPLE_BLOQUEANTE` → `APTITUD_CONDICIONADA` para estos
   códigos no produce alertas duplicadas en el período de migración.

**Costo de mantener:** Pequeño — 5 evaluadores con un campo extra
documentado. Sin penalización runtime.

**Costo de no cerrar en Prompt 3:** Aceptable como deuda perenne si
los consumidores legacy no llegan a migrarse. El campo `cumple` queda
como vista degradada del canónico (pierde condicionalidad pero no es
incorrecto en el sentido binario "este agregado pasa o no").

---

## ✅ Cerradas durante Prompt 1

### D7 — Valores ENUM nuevos en AlertaCalidad ✅ (Commit 5)

**Archivo:** [`../../models/AlertaCalidad.js`](../../models/AlertaCalidad.js).

**Resolución:** ENUM extendido con `ENSAYO_NO_CUMPLE_BLOQUEANTE`,
`APTITUD_CONDICIONADA`, `ENSAYO_INCONCLUYENTE`. Migración aditiva en
`runPendingMigrations` con `ALTER TABLE ... MODIFY COLUMN`. Aplicada
en `hormiqual_demo` con verificación `SHOW COLUMNS`. Tests
estructurales en [`../../../__tests__/alertaCalidadEnum.test.js`](../../../__tests__/alertaCalidadEnum.test.js).

### D8 — Refactor del dispatcher de alertas ✅ (Commit 6)

**Archivo:** [`../../services/alertaCalidadService.js`](../../services/alertaCalidadService.js).

**Resolución:** `alertarResultadoFueraDeEspec` reescrita para:
- Aceptar ComplianceResult canónico o shape legacy (back-compat).
- Dispatchear vía `matchExt()` exhaustivo sobre los 10 estados.
- Aplicar política conservadora para `inconclusive`/`expired`/`pending`
  (no emitir sin `options.exigible: true` explícito).
- Persistir el `compliance` completo en el campo `detalle` para auditoría.

Caller en `agregadoEnsayoService.js:1175` actualizado: filtro
`cumpleValue === 'NO_CUMPLE'` eliminado, el dispatcher decide. Tests en
[`../../../__tests__/alertarResultadoFueraDeEspec.test.js`](../../../__tests__/alertarResultadoFueraDeEspec.test.js).
