# Reporte de cierre — Prompt 4 + cierre acumulado del refactor de cumplimiento

**Fecha de cierre**: 2026-04-29
**Alcance Prompt 4**: cleanup final — eliminación de helpers deprecated con consumidores residuales, cosméticos pendientes, formalización de disposición de deudas diferidas, consolidación del handoff de deudas que sobreviven al refactor.
**Cierre acumulado**: refactor de cumplimiento (Prompts 1-4) completo.

---

## 1. Resumen ejecutivo

El **refactor de cumplimiento** se ejecutó en **4 prompts a lo largo de 30 sub-commits efectivos**, transformando el sistema desde un binario legacy `cumple = 'CUMPLE' | 'NO_CUMPLE'` con 5 estados UPPERCASE hasta un modelo canónico `ComplianceResult` de 10 estados con 7 categorías visuales, donde el sistema entero habla **una voz única canónica** desde el motor de evaluación hasta el certificado profesional firmado por un ingeniero civil.

Los **matices que el binario aplastaba** son ahora visibles en TODA la presentación:
- `passWithObservations` (cumple con observaciones técnicas)
- `conditionalPass` (cumple bajo condiciones de aplicabilidad)
- `inconclusive` (resultado no concluyente por precisión)
- `expired` (ensayo vencido)
- `pending` (material sin ensayo obligatorio)
- `informative` (informativo, sin requisito normativo)
- `notApplicable` (no aplica al contexto)

El refactor cierra con **superficie de API canónica limpia**: helpers deprecated eliminados, modelo de presentación con paridad locked web↔PDF por test, vocabulario unificado IRAM/CIRSOC desde el dashboard hasta el INF profesional.

**Suite final acumulada**:
- Backend: 69 suites / **1638 tests** / 0 regresiones (+1 suite por `d9LockIn`)
- Frontend: 13 suites / **233 tests** / 0 regresiones
- Total: 1871 tests cubriendo el modelo canónico end-to-end

---

## 2. Arco narrativo del refactor

### Prompt 1 — Modelo canónico
Introducción de `ComplianceResult` con 10 estados. Módulo `labels.js` como source of truth de presentación. Adapters bidireccionales (`sequelizeEnum`, `evalEngine`, `aptitudService`). Sistema de alertas con `matchExt()` exhaustivo. Dispatcher canónico `alertarResultadoFueraDeEspec`. Establecimiento del principio "default seguro: NotEvaluated, nunca Pass".

### Prompt 2 — Capa de dominio canonificada
`UsageContext` y `MaterialContext` formales. `isBlockingInContext` con tabla declarativa. `buildCompliance` helper. Propagación de metadata estructurada (`{measured, limit, norm}`) en 18 evaluadores. Motor de aptitud canonificado (`aptitudMaterialesService`). `granulometriaMezcla.js` (Nivel 2). Árbol de veredictos globales con 7 categorías. Endpoint `getResumen` con `veredictoGlobal` agregado. **Patrón Hybrid Option B** activado: legacy `cumple` ENUM y canónico `compliance.status` coexisten transparentemente.

### Prompt 3 — Migración de la capa de presentación
Migración de toda la capa de renderers (frontend web + 5 PDFs) al canónico. Helpers consolidados (`pdfPresentation`, `CumplimientoBadge`, `formatSubtipoAgregado`). Paridad visual web↔PDF locked por test. **Sección "G. Veredicto del agregado"** nueva al final del INF con banner color + dictamen formal + listas detalladas (razones / condiciones / observaciones / pendientes). **Cláusula legal** "Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación" en certificados de aptitud condicionada. Counters extendidos. Vocabulario unificado IRAM/CIRSOC. "Atención" naranja en lugar de verde (Fix B post-smoke). Cierre con C12 (3 fixes acotados detectados por agente smoke-pdf-visual).

### Prompt 4 — Cleanup final (este reporte)
Eliminación de helpers deprecated con consumidores residuales: `fromAnyLegacy`, `getDisplayLabel`, `getDisplayColor`, `getDisplaySeverity`, `_UPPERCASE_OVERRIDES`, `match()` legacy. Cierre formal de D9 con opción β (dos sistemas independientes preservados por diseño + lock-in test). Cosméticos D25 (watermark cortado), D28 (precisión per-código), D29 (page-break Sección G). Warmup D27 Grupo B: `alertasMaterialService.js` movido de `domain/dosificacion/` a `services/`. Disposición formal de D23 y D24 como diferidas a sprints específicos. DEFERRED.md consolidado con snapshot final.

---

## 3. Lo que el usuario gana — síntesis de los 4 prompts

### 3.1 El sistema habla con una voz única
**Antes**: dashboard mostraba "Grava" / "Grava partida" / "Piedra partida" (vocabulario coloquial), certificado del mismo material decía "Canto rodado" / "Triturado natural" / "Triturado artificial" (vocabulario técnico-normativo IRAM/CIRSOC). Dos voces para el mismo enum.
**Después**: el sistema entero usa la nomenclatura técnica del estándar. Dashboard, INF, certificado, listados y PDFs hablan la misma voz.

### 3.2 Los matices ya no se aplastan
**Antes**: una granulometría con desvío menor que cumple §3.2.4 se veía idéntica a un cumple plano (mismo verde, mismo check). El matiz "cumple gracias a tolerancia normativa" era invisible.
**Después**: bullet verde con ícono distinto + texto "Cumple con tolerancia §3.2.4" cita la cláusula normativa exacta. El ingeniero ve que este caso es distinto sin perder trazabilidad normativa.

**Antes**: un material con condicionales (ej. Las Quebradas, no apto para uso con desgaste superficial) se renderizaba como NO APTO rojo en el certificado, transmitiendo bloqueo total.
**Después**: APTITUD CONDICIONADA naranja con cláusula legal explícita: "Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación". Defensa normativa-legal del documento si el material se usa fuera de las condiciones.

### 3.3 Counters fieles a la realidad
**Antes**: el chip "X No cumple" en AgregadoEnsayosPage contaba TODO ensayo con `cumple='NO_CUMPLE'` legacy, incluyendo casos donde el canónico era passWithObservations / conditionalPass. Inflación cognitiva.
**Después**: backend recalcula desde compliance canónico. El counter refleja sólo casos canónicamente NO APTO.

### 3.4 Coherencia interna del sistema
**Antes**: `getResumen` mezclaba criterios — counter canónico + flags `needsAttention` legacy + motivo legacy. Inconsistencia interna.
**Después**: los 3 outputs derivan del compliance canónico en una pasada unificada. `getResumen` internamente coherente.

### 3.5 Sección "Veredicto del agregado" en el INF
Sección nueva que faltaba: dictamen formal al final del documento con banner color + texto formal canónico de las 5 categorías + listas detalladas (razones / condiciones / observaciones / pendientes). Cada item autocontenido (tipo + norma + descripción). El ingeniero cierra el INF sabiendo el veredicto sin tener que descifrar la tabla.

### 3.6 Watermark legible y formato unificado (cosméticos Prompt 4)
**Antes**: watermark "ENTORNO DE DESARROLLO — NO USAR EN OBRA" se cortaba visualmente en A4 a -20°. Terrones de arcilla mostraba "1,300 %" cuando el dato real es "1,30 %". Sección G saltaba a página nueva prematuramente dejando espacio vacío al final de la anterior.
**Después**: watermark entra completo (`'DESARROLLO — NO USAR'`). Decimales per-código (terrones 2, cloruros 3, durabilidad 1). Sección G permanece cohesiva.

---

## 4. Decisiones arquitectónicas vivas en el código

### 4.1 Patrón Hybrid Option B (Prompt 2 D15+D20)
Legacy `cumple` ENUM + canónico `compliance.status` coexisten. Renderers leen canónico cuando está, fallback legacy cuando falta. La presentación NUNCA contradice al canónico. Precedencia 4 niveles documentada en `CumplimientoBadge` JSDoc.

### 4.2 Source of truth canónico (`labels.js` + `pdfPresentation`)
- `labels.js` (backend): `getLongLabel/getShortLabel/getSeverity/getIcon/getColor` — fuente única de presentación per-estado.
- `lib/compliance/pdfPresentation` (frontend): paridad RGB con CATEGORIA_COLORS web, locked por test cross-módulo.
- `CumplimientoBadge` (frontend): patrón uniforme de presentación canónica con back-compat legacy.

### 4.3 Vocabularios de dominio específicos preservados (D26)
Modelo prestacional de mezclas (6 estados, lenguaje no-terminal) y veredicto experimental de pastón (3 estados, acto formal del responsable) NO se canonizan al modelo de 7 categorías. Decisión deliberada protegida por lock-in tests. Reconciliación cross-módulo via adapter sólo si emerge trigger.

### 4.4 Dos sistemas de alertas preservados por diseño (D9 — Prompt 4 C7)
`AlertaCalidad` (¿el ensayo cumple normativamente?) y `AlertaDosificacion` (¿el cambio del material invalida dosificaciones existentes?) son sistemas con propósitos distintos. Lock-in test con 3 invariantes que rompen si alguien intenta unificarlos especulativamente.

### 4.5 Vocabulario técnico por celda preservado (Prompt 3 C9.3)
En tablas de cumplimiento normativo, "Cumple/No cumple/Atención/Sin dato" por celda es funcional y normativamente correcto en español. APTO/NO APTO se reserva al material entero (sección Veredicto). Color por celda canónico, texto preservado.

### 4.6 Lock-in tests como deuda con fecha de vencimiento auto-impuesta
Patrón aplicado en C2 (10 estados sincronizados), C3 (STATUS_CONFIG eliminado), D26 caso A y B (modelo prestacional + experimental), D9 (dos sistemas separados), regresión D1 cert (sin strings UPPERCASE legacy), hex web↔PDF (consistencia visual). Convierte deuda condicional en error visible.

### 4.7 Pureza arquitectónica como invariante (D27)
`src/domain/` debe ser puro: sin Sequelize, sin `req`/`res`, sin BD, sin HTTP. Auditoría con subagente `revisor-engine-purity`. C1 Prompt 4 cerró Grupo B (alertasMaterialService mal ubicado); Grupo A (9 engines con I/O accidental) queda para sprint dedicado.

---

## 5. Métricas acumuladas — los 4 prompts

| Métrica | Acumulado |
|---|---:|
| Sub-commits totales | ~30 |
| Archivos backend modificados | ~25 |
| Archivos frontend modificados | ~25 |
| Tests backend al cierre | 1638 (de ~470 pre-refactor) |
| Tests frontend al cierre | 233 (de ~50 pre-refactor) |
| Tests nuevos del refactor | ~1350 |
| Regresiones acumuladas | 0 |
| Deudas cerradas (D1, D2, D3, D4, D5, D6, D8 implícita, D9, D10, D14, D15, D17, D18, D20, D22, D25, D27 grupo B, D28, D29) | 19 |
| Deudas re-anotadas con disposición clara | 4 (D16, D19, D23, D24) |
| Deudas que sobreviven al refactor (D11, D12, D13, D21, D26, D27 grupo A, sub-nota legacy keys) | 7 |
| Helpers deprecated eliminados (Prompt 4) | 6 |
| Lock-in tests creados | 5 grupos |
| Documentos generados (REPORTS) | 4 (`PROMPT_3.md`, `PROMPT_4.md`, snapshots en DEFERRED) |

---

## 6. Pipeline canónico end-to-end consolidado

```
[BACKEND]                              [FRONTEND]                          [DOCUMENTO]

evaluarEnsayo(codigo, resultado, ctx)
  → ComplianceResult canónico
                    │
                    ↓
aptitudMaterialesService.verificarAptitud
  → Compliance.X(...) por requisito
                    │
                    ↓
getResumen
  ├→ items[i].compliance (per-ensayo)
  ├→ totals.noCumple (canónico)
  ├→ needsAttention/motivo (canónico)
  └→ veredictoGlobal (agregado)
                    │
                    ↓
                                       lib/compliance
                                       ├→ getCategoriaVeredicto (7 categorías)
                                       ├→ CATEGORIA_COLORS (web)
                                       ├→ CumplimientoBadge (renderer canónico)
                                       └→ pdfPresentation (paridad PDF)
                                                          │
                                                          ↓
                                                                              5 PDFs migrados:
                                                                              ├→ certificadoCumplimientoPdf
                                                                              ├→ informeResistenciaPdf
                                                                              ├→ agregadoFichaTecnicaPdf
                                                                              │   (con nueva Sección G)
                                                                              ├→ mezclaInformePdf
                                                                              └→ dosificacionInformePdf

  alertaCalidadService.dispatch
  ├→ matchExt() exhaustivo sobre 10 estados
  ├→ AlertaCalidad → ¿cumple normativamente?
  └→ AlertaDosificacion → ¿impacto cross-entidad?
     (sistemas separados por D9)
```

**Casos paradigmáticos validados end-to-end**:
- **Arideros 6** → APTO CON OBSERVACIONES desde motor a INF.
- **Las Quebradas** → APTITUD CONDICIONADA con cláusula legal en certificado.

---

## 7. Confirmaciones de scope (lo que NO se hizo, intencionalmente)

- **Optimizador de mezclas** (`mezclaCalcEngine.evaluarContraBanda` + `AjustePostOptimizacion`): preservado bajo D21. Decisión de dominio que requiere stakeholder de mezclas — sin scope hasta que ocurra esa conversación.
- **Modelo prestacional de mezclas** (`consolidarEstadoMezcla`): preservado bajo D26. Vocabulario deliberadamente distinto del canónico, locked por test.
- **Veredicto experimental de pastón**: preservado bajo D26 (mismo principio).
- **9 engines con I/O accidental** (D27 Grupo A): preservados — sprint dedicado de pureza arquitectónica.
- **Testing infra de BD** (D11, D12, D13): out-of-scope del refactor de cumplimiento.

---

## 8. Deuda residual post-Prompt 4 — handoff a futuros sprints

### Sprint pureza arquitectónica
- D27 Grupo A: 9 engines con I/O accidental (`ensayoEvalEngine`, `granulometriaMezcla`, `sugerenciaMezclaEngine`, `mezclaPropsEngine`, `materialContext`, `trabajabilidadEngine`).

### Sprint mezclas con stakeholder de dominio
- D21: algoritmo del optimizador (¿conditionalPass rankea igual que pass? ¿se filtra del resultset por defecto?).
- D23: verificaciones aire/pulverulento/HP (¿cuándo "cerca del límite" merece passWithObservations?).

### Sprint UX con stakeholder de producto
- D24: banner ejecutivo opcional al inicio del INF.

### Sprint testing infra
- D11, D12, D13: BD testing.

### Sprint visual/cosmético
- D16: source granulométrico de `desgasteLA`.

### Esperando trigger emergente (no requieren sprint dedicado)
- D19 issue #1: motor cambia → path 1 stale (cerrar cuando se cambie el motor evaluador).
- D26: vocabularios prestacional + experimental (cerrar cuando emerja certificado formal cross-módulo).
- Sub-nota D1: claves legacy de subtipo en BD de producción (cerrar si aparecen).

---

## 9. Cierre — el refactor de cumplimiento está completo

El sistema entró al refactor con cumplimiento binario representado por strings UPPERCASE legacy mezclados a través de la aplicación, donde los matices del modelo de dominio que la práctica profesional reconoce como distintos (cumple-con-tolerancia, cumple-con-condiciones, no-concluyente, vencido, pendiente) se aplastaban a "CUMPLE" o "NO CUMPLE" o se perdían en cadenas de fallback.

El sistema sale del refactor con:
- **Modelo canónico de 10 estados** representando los matices reales del dominio normativo argentino (CIRSOC 200-2024 + IRAM 1512/1531/1627/1601/1525).
- **7 categorías visuales** que el ingeniero ve consistentemente desde el dashboard hasta el certificado profesional firmado.
- **Pipeline end-to-end** desde el motor de evaluación → resumen → frontend → PDFs, con paridad visual locked por test cross-módulo.
- **Decisiones arquitectónicas vivas** documentadas in-code: Hybrid Option B, vocabularios de dominio específicos preservados, dos sistemas de alertas separados, vocabulario técnico por celda preservado, lock-in tests como deuda con fecha de vencimiento auto-impuesta.
- **Cláusula legal** en certificados de aptitud condicionada que cierra el flanco normativo-legal del documento.

La deuda que sobrevive al refactor es deuda **adyacente** (pureza arquitectónica, testing infra, decisiones de stakeholder de dominio, UX) o **condicional** (espera de triggers emergentes). Ninguna deuda derivada del modelo canónico queda abierta.

**El sistema habla con una sola voz canónica desde el motor hasta el certificado profesional firmado por el ingeniero civil.**

---

*Reporte generado al cierre del refactor de cumplimiento (Prompts 1-4) — 2026-04-29.*
*Para deuda viva ver `DEFERRED.md` (snapshot Prompt 4 al inicio).*
*Para el detalle del Prompt 3 ver `REPORTS/PROMPT_3.md`.*
