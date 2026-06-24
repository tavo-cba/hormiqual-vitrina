# Reporte de cierre — Prompt 3

**Fecha de cierre**: 2026-04-28
**Alcance**: migración de los renderers (frontend web + 5 PDFs) desde el modelo legacy de cumplimiento (5 estados UPPERCASE) al modelo canónico Prompt 2 (10 ComplianceResult states sobre 7 categorías visuales).

---

## 1. Resumen ejecutivo

El Prompt 3 refactorizó toda la capa de presentación de cumplimiento del sistema en **18 sub-commits** principales (C1 a C11) más fixes post-smoke (Fix B, Fix C2, nits subtipo + formato), tocando **20 archivos del frontend** (`lib/compliance` + `lib/compliance/pdfPresentation` + `lib/document-issuance` + `lib/format` + 11 componentes web + 5 PDFs) y **3 archivos del backend** (`agregadoEnsayoService.js`, `requisitosEnsayos.js`, `compliance/DEFERRED.md`).

Resultado: **232 tests frontend / 1647 tests backend / 0 regresiones**. Helpers consolidados (`pdfPresentation`, `CumplimientoBadge`, `formatSubtipoAgregado`), 7 deudas cerradas, 8 deudas nuevas anotadas con disposición clara para Prompt 4.

El sistema ahora habla **una sola voz canónica** desde el motor de evaluación (Prompt 2) hasta el certificado profesional firmado por un ingeniero civil. Los matices que el binario legacy aplastaba (passWithObservations, conditionalPass) son ahora visibles en TODA la presentación.

---

## 2. Lo que el usuario gana concretamente — ejemplos paradigmáticos

### 2.1 Caso paradigmático: Arideros 6 (Hybrid Option B)

**Antes**:
- Dashboard MaterialDetailPage: counter "5 ensayos no conformes" incluyendo Granulometría con tamiz fuera de banda.
- Tabla "Cumplimiento normativo": Granulometría con badge rojo "NO CUMPLE".
- INF (ficha técnica del agregado) PDF: Granulometría con bullet rojo "X" y texto sin matiz.
- Sin sección de veredicto global.

**Después**:
- Dashboard counter "4 no conformes" + "1 con observaciones técnicas".
- Tabla muestra Granulometría con badge verde "APTO CON OBSERVACIONES" + ícono `pi-info-circle` (distinto del check de APTO puro).
- INF tiene **nueva Sección G "Veredicto del agregado"** con banner color + dictamen formal:
  > "El agregado evaluado es apto para uso en hormigón. Se registran observaciones técnicas que se detallan a continuación."
  Seguido de lista detallada de observaciones con tipo + norma + descripción ("Granulometría (IRAM 1505): Banda A-B excedida en tamiz 4,75 mm; combinación con arena de mayor MF recomendada"), autocontenida sin "ver tabla anterior".

### 2.2 Caso paradigmático: Las Quebradas (APTITUD CONDICIONADA)

**Antes**:
- Dashboard: badge naranja "APTITUD CONDICIONADA" en MaterialDetailPage (ya canónico desde Prompt 2 backend), pero el PDF rendereaba "NO CUMPLE" rojo en la fila de Pasante #200.
- INF sin cláusula legal de respaldo.

**Después**:
- INF Sección G muestra banner naranja "APTITUD CONDICIONADA" con dictamen formal:
  > "El agregado evaluado es apto sujeto a las condiciones de aplicabilidad indicadas a continuación. **Su uso fuera de las condiciones declaradas no está respaldado por esta evaluación.**"
- Lista detallada de condiciones ("Pasante #200 (IRAM 1540): No apto para uso con desgaste superficial según IRAM 1512 §3.2.1").
- La cláusula legal cierra el flanco normativo: si Las Quebradas se usa para un piso pulido y aparece un problema, el documento tiene defensa.

### 2.3 Caso paradigmático: cumple_con_tolerancia ahora visible

**Antes**: una granulometría con desvío menor que cumple §3.2.4 se veía idéntica a un cumple plano (mismo verde, mismo check). El matiz "cumple gracias a tolerancia normativa" era invisible.

**Después**: bullet verde con ícono distinto + texto "Cumple con tolerancia §3.2.4" cita la cláusula normativa exacta. El ingeniero ve que este caso es distinto sin perder trazabilidad normativa. (D20 paradigma observable en C9.3.)

### 2.4 Counter `noCumple` no contaminado por Hybrid B (C8.5)

**Antes**: el chip "X No cumple" en AgregadoEnsayosPage contaba TODO ensayo con `cumple='NO_CUMPLE'` legacy, incluyendo casos Hybrid B donde el canónico era passWithObservations / conditionalPass. Inflación cognitiva: el usuario veía "5 no cumplen" cuando técnicamente eran "3 NO APTO + 2 APTO con matiz".

**Después**: backend recalcula `totals.noCumple` desde `getCategoriaVeredicto(item.compliance) === 'NO APTO'`. El counter refleja sólo casos canónicamente NO APTO.

### 2.5 Coherencia interna de `getResumen` (C8.6)

**Antes**: counter usaba canónico (post-C8.5) pero `needsAttention` y `motivo` seguían en legacy. Inconsistencia interna: el usuario veía "0 no aptos" + "atención requerida porque hay un ensayo NO_CUMPLE" simultáneo.

**Después**: los 3 outputs (counter + flag + motivo) derivan del compliance canónico en una pasada unificada post-propagación. `getResumen` internamente coherente.

### 2.6 Vocabulario unificado (C10 6.1)

**Antes**: dashboard mostraba "Grava" / "Grava partida" / "Piedra partida" (vocabulario coloquial) mientras el certificado del mismo material decía "Canto rodado" / "Triturado natural" / "Triturado artificial" (vocabulario técnico-normativo IRAM/CIRSOC). Dos voces para el mismo enum.

**Después**: el sistema entero usa la nomenclatura técnica del estándar. Dashboard, INF, certificado, listados y PDFs hablan la misma voz.

### 2.7 Subtipo "ARENA_NATURAL" friendly (nit post-C9.2)

**Antes**: certificado mostraba `Subtipo: ARENA_NATURAL` (raw enum).
**Después**: `Subtipo: Arena natural`. Mismo helper (`formatSubtipoAgregado`) consumido por todos los renderers.

### 2.8 Formato numérico es-AR unificado (nit post-C9.3)

**Antes**: cards de Caracterización mezclaban `2.58` (período decimal sin coma) con `2,15` (coma) según si el call site pasaba `decimals` o no. PUC/PUS sin separador de miles (`1785 kg/m³`). Pasa #200 y Absorción con 1 decimal en cards y otro en cert.

**Después**: `formatNumber` centralizado. Coma decimal universal, punto separador de miles para PUC/PUS (`1.785 kg/m³`), 2 decimales para absorción y pasante #200 alineado entre cards y cert.

### 2.9 Sección "G. Veredicto del agregado" (C9.3)

Sección nueva al final del INF con:
- Banner color con label canónico (5 categorías) + glifo
- Texto formal del dictamen para la categoría
- Listas detalladas en orden de severidad descendente:
  1. Razones de no aptitud (rojo) — itera `compliance.reasons[]`
  2. Condiciones de aplicabilidad (naranja) — itera `compliance.conditions[].description`
  3. Observaciones técnicas (verde) — usa `compliance.observation`
  4. Ensayos pendientes (azul) — usa `getEnsayosFaltantes(contextoEvaluacion, presentCodes)` con nombre legible
- Cada item autocontenido: tipo + norma + descripción + ref normativa
- Fallback elegante cuando `resumen.veredictoGlobal` falta (datos pre-Prompt 2)

### 2.10 "Atención" naranja en lugar de verde (Fix B post-smoke C9.5)

**Antes**: celda "Atención" en tabla aptitud de materiales del PDF de dosificación se veía verde (mapeo a APTO_CON_OBSERVACIONES). Conflicto cognitivo "verde + Atención".

**Después**: naranja (APTITUD_CONDICIONADA). Consistente con la semántica del label en español ("alerta") y con la hermandad visual histórica de "Atención" + "Excepción" (ambos eran marrón legacy).

---

## 3. Métricas

| Métrica | Cantidad |
|---|---:|
| Sub-commits principales | 11 (C1, C2, C3, C4, C5, C6, C7, C8, C9, C10, C11) |
| Sub-sub-commits backend (paralelo a un commit principal) | 4 (C3.5, C6.5, C8.5, C8.6) |
| Sub-sub-commits PDFs (C9 partido) | 5 (C9.1, C9.2, C9.3, C9.4, C9.5) |
| Fixes post-smoke (de un sub-commit ya cerrado) | 5 (Fix B, Fix C2, nit subtipo, nit formato cards, fix frame cert) |
| Archivos frontend tocados | 20 |
| Archivos backend tocados | 3 |
| Tests frontend agregados | 232 (vs ~50 pre-Prompt 3) |
| Tests backend al cierre | 1647 (vs 1636 pre-Prompt 3) |
| Regresiones en tests | 0 |
| Deudas cerradas (de la lista pre-Prompt 3) | 7 (D1, D6, D15, D17, D20, D22, contadores contaminados) |
| Deudas re-anotadas con estado actualizado | 1 (D19) |
| Deudas nuevas anotadas durante Prompt 3 | 8 (D21, D23, D24, D25, D26, D27, D28 + sub-nota legacy keys) |
| Helpers nuevos consolidados | 5 (`pdfPresentation`, `CumplimientoBadge`, `formatSubtipoAgregado`, `getDisplayName` requisitos, helpers per-componente) |
| Lock-in tests (cierre de deuda condicional vía test) | 4 grupos (D26 caso A, D26 caso B, regresión D1 cert, hex web↔RGB PDF) |

---

## 4. Decisiones arquitectónicas vivas en el código

### 4.1 Patrón Hybrid Option B (Prompt 2 D15+D20, visibilizado en Prompt 3)

**Principio**: legacy `cumple` ENUM + canónico `compliance.status` coexisten. Renderers leen canónico cuando está, fallback legacy cuando falta. La presentación NUNCA contradice al canónico.

**Implementación**: precedencia 4 niveles documentada en `CumplimientoBadge` JSDoc:
1. `compliance` directo (caller pre-resuelto)
2. `ensayo.resultado._evaluacion.compliance` (persistido)
3. `fromLegacyEval(ensayo)` (fallback lossy)
4. EVALUACIÓN INCOMPLETA (default seguro)

### 4.2 Source of truth de presentación canónica (`lib/compliance` + `pdfPresentation`)

- `CATEGORIA_COLORS` (web) — severity + bgClass + textClass + icon + hex per categoría
- `CATEGORIA_PDF_COLORS` (PDF) — tuplas RGB equivalentes a los hex del web
- `getCategoriaPdfLabel` / `getCategoriaPdfColor` / `getCategoriaPdfIcon`
- Coherencia web↔PDF locked por test ("Cada hex del web tiene su tupla RGB equivalente en PDF")

### 4.3 Vocabularios de dominio específicos preservados (D26)

**Principio**: el modelo canónico NO se fuerza donde una decisión deliberada de dominio creó vocabulario propio. Casos identificados:
- **Modelo prestacional de mezcla** (6 estados con lenguaje no-terminal): `mezclaInformePdf.consolidarEstadoMezcla` preservado intacto.
- **Veredicto experimental de pastón** (3 estados como acto formal del responsable): preservado.

Reconciliación cross-módulo via adapter sólo si emerge necesidad. Lock-in tests verifican que no se canoniza accidentalmente.

### 4.4 Vocabulario técnico por celda preservado (C9.3)

**Principio**: en tablas de cumplimiento normativo, el vocabulario por celda ("Cumple / No cumple / Atencion / Sin dato") es funcional y normativamente correcto en español. La categoría canónica APTO/NO APTO se reserva al material entero (sección Veredicto). Color por celda migrado al canónico, texto preservado.

### 4.5 Lock-in tests como deuda con fecha de vencimiento

**Patrón**: cuando una decisión debe protegerse de regresiones futuras (ej. preservar el modelo prestacional de D26), se escribe un test que rompe si alguien intenta canonizarlo. Eso convierte deuda condicional en error visible.

Ejemplos:
- "ESTADO_MEZCLA_LABELS tiene exactamente los 6 estados prestacionales"
- "consolidarEstadoMezcla retorna estado prestacional, NO un campo `compliance` canónico"
- "El archivo NO importa Compliance factories del módulo canónico"
- Regresión D1 cert: scan de strings literales 'CUMPLE'/'NO CUMPLE'/'CUMPLE CONDICIONAL'/'NO EVALUADO'

---

## 5. Handoff a Prompt 4

Lista categorizada del scope que entra a Prompt 4 (espejo del snapshot en DEFERRED.md):

### 5.1 Cierre directo (deuda menor identificada en Prompt 3)
- D23 — verificaciones aire/pulverulento/HP a compliance canónico (decisión de dominio leve).
- D24 — banner ejecutivo opcional al inicio del INF (decisión UX).
- D25 — watermark "ENTORNO DE DESARROLLO" cortado en A4 (layout).
- D28 — precisión per-código en `resultadoDisplay` fallback (cosmética).

### 5.2 Trabajo principal
- `match()` legacy en `ComplianceResult.js` (declarado out-of-scope desde Prompt 2).
- `_UPPERCASE_OVERRIDES` y eliminación final de `getDisplayLabel` deprecated.
- Sub-deuda D1: 2 call sites de `getDisplayLabel` en `lib/document-issuance/index.js` (back-compat tail muerto, cleanup oportunista cuando se toque emitDocument).
- D9 — `AlertaDosificacion`.

### 5.3 Decisiones de dominio diferidas (requieren stakeholder)
- D21 — algoritmo del optimizador (`AjustePostOptimizacion` + `mezclaCalcEngine`): ¿cómo rankea conditionalPass / passWithObservations?
- D26 — vocabularios prestacional + experimental: ¿se unifican vía adapter cuando aparezca trigger cross-módulo?
- D27 — pureza arquitectónica preexistente (10 violaciones en 8 archivos descubiertas en auditoría).

### 5.4 Fuera de alcance del refactor de cumplimiento
- D11, D12, D13 — testing infra (sin BD testing).
- Sub-nota a D1: claves legacy de subtipo (GRAVA_PARTIDA, etc.) en BD de producción si existen — decisión de dominio de cuándo cubrirlas.

---

## 6. Pipeline canónico end-to-end validado

**Backend** (Prompt 2 + correcciones Prompt 3):
- `evaluarEnsayo(codigo, resultado, ctx)` emite `compliance: ComplianceResult` canónico.
- `aptitudMaterialesService.verificarAptitudAF/AG` emite `Compliance.X(...)` canónicos por requisito.
- `getResumen` propaga `compliance` per item (C6.5) + recalcula `totals.noCumple` + `needsAttention` + `motivo` desde compliance canónico (C8.5/C8.6) + expone `veredictoGlobal` agregado.

**Frontend** (Prompt 3):
- `lib/compliance` exporta 7 categorías canónicas + helpers + `fromLegacyEval` defensivo (D22 fix).
- `lib/compliance/pdfPresentation` expone color/label/icon canónicos per categoría con paridad visual web↔PDF locked por test.
- `lib/document-issuance.emitDocument` recibe `veredictoGlobal` pre-computado del response (eliminación de `aggregate()` frontend).
- 11 componentes web migrados a `getCategoriaVeredicto` / `CumplimientoBadge`.
- 5 PDFs migrados con grilla A/B/C consistente (display vs vocabulario interno vs normativo).
- 1 sección PDF nueva (Sección G "Veredicto del agregado" en INF).

**Casos paradigmáticos validados**:
- Arideros 6 → APTO CON OBSERVACIONES end-to-end (motor → resumen → frontend → INF).
- Las Quebradas → APTITUD CONDICIONADA end-to-end con cláusula legal.

---

## 7. Confirmaciones de scope (lo que NO se hizo, intencionalmente)

- Engines de dominio (`src/domain/`) — INTACTOS. La auditoría de pureza descubrió 10 violaciones preexistentes (D27) que NO son producto del Prompt 3.
- `match()` legacy en `ComplianceResult.js` — INTACTO. Refactor pertenece al Prompt 4.
- Modelo prestacional de mezclas (`consolidarEstadoMezcla`) — preservado intencional bajo D26.
- Veredicto experimental de pastón — preservado intencional bajo D26.
- Optimizador (`mezclaCalcEngine.evaluarContraBanda` + `AjustePostOptimizacion`) — preservado bajo D21.

---

## 8. Suite final

**Frontend**: 13 suites / 232 tests / 0 regresiones.
**Backend**: 68 suites / 1647 tests / 0 regresiones (vs 1636 pre-Prompt 3 — 11 tests nuevos por D17 spot-check + getDisplayName + C8.6).

---

## 9. Cierre

El Prompt 3 cierra con el patrón "vocabulario canónico end-to-end" establecido y verificado. El sistema habla con una voz desde el motor hasta el certificado firmado. Los matices del modelo de dominio que el binario legacy aplastaba son ahora visibles en TODA la presentación, sin perder back-compat con datos persistidos pre-Prompt 2.

El handoff a Prompt 4 está categorizado en 4 buckets con disposición clara. La deuda más relevante (`match()` legacy en `ComplianceResult.js` + `_UPPERCASE_OVERRIDES`) sigue siendo el trabajo principal del Prompt 4, con la ventaja de que ahora todos los renderers ya consumen canónico — eliminar el helper deprecated es una pasada de cleanup, no un refactor de presentación.

---

*Reporte generado al cierre del Prompt 3 (2026-04-28). Para deuda viva ver `DEFERRED.md`.*
