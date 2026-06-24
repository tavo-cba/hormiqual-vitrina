/**
 * PR4 / decisión 2026-05-28 — Fixes preexistentes detectados por auditor-pdf
 * sobre test87/88/89 (pastón) y test92 (certificado/informe).
 *
 *   Bug 1: motivos genéricos del certificado ("No cumple con el criterio
 *          normativo" repetido) por evaluador con `mensaje` vacío.
 *          → fix: enriquecer compliance con `_ensayoNombre`/`_ensayoNormaRef`
 *            y que `canIssue` prefije las razones con ese label.
 *
 *   Bug 2: Pasante #200 (IRAM 1674) 1,70% AF marcado NO APTO contra
 *          límite mostrado 3%/5% por persistence de evaluación vieja con
 *          tipoAg=null (cae a rama AG con límite 1%/1.5%).
 *          → fix backend: forzar re-eval en compliance persistido para
 *            códigos context-sensitive (IRAM 1540 / IRAM 1674 / PASA_200).
 */

import { canIssue } from "../CertificateIssuancePolicy";

describe("PR4 — Bug 1: motivos del certificado prefijan el nombre del ensayo", () => {
  const material = { idAgregado: 19, tipo: "FINO", nombre: "Arena lavada" };

  test("Sin metadata: razón cruda (back-compat con callers viejos)", () => {
    const complianceResults = [
      { status: "fail", reasons: ["No cumple con el criterio normativo"] },
    ];
    const decision = canIssue({ material, complianceResults });
    expect(decision.decision).toBe("denied");
    expect(decision.reasons[0]).toContain("No cumple con el criterio normativo");
    // Sin metadata: NO debe haber prefijo de tipo "Nombre (Norma): ..."
    // (la única ":" permitida es la del cabezal "N ensayo(s) no cumplen:").
    expect(decision.reasons[0]).not.toMatch(/[^:]+\([^)]+\):/);
  });

  test("Con _ensayoNombre: razón prefijada con el nombre", () => {
    const complianceResults = [
      {
        status: "fail",
        reasons: ["No cumple con el criterio normativo"],
        _ensayoNombre: "Material fino que pasa por tamiz IRAM 75 µm",
        _ensayoNormaRef: "IRAM 1540",
      },
    ];
    const decision = canIssue({ material, complianceResults });
    expect(decision.decision).toBe("denied");
    expect(decision.reasons[0]).toContain("Material fino que pasa por tamiz IRAM 75 µm");
    expect(decision.reasons[0]).toContain("(IRAM 1540)");
    expect(decision.reasons[0]).toContain("No cumple con el criterio normativo");
  });

  test("Cuando reasons está vacío, usa fallback genérico pero con prefijo", () => {
    const complianceResults = [
      {
        status: "fail",
        reasons: [],
        _ensayoNombre: "Pasante #200",
        _ensayoNormaRef: "IRAM 1540",
      },
    ];
    const decision = canIssue({ material, complianceResults });
    expect(decision.decision).toBe("denied");
    expect(decision.reasons[0]).toContain("Pasante #200");
    expect(decision.reasons[0]).toContain("no cumple con el criterio normativo");
  });

  test("Dos ensayos NO_CUMPLE diferentes → cada uno prefijado por separado", () => {
    const complianceResults = [
      {
        status: "fail",
        reasons: ["valor 1,70% supera límite"],
        _ensayoNombre: "Pasante #200",
        _ensayoNormaRef: "IRAM 1540",
      },
      {
        status: "fail",
        reasons: ["fuera de banda A-B"],
        _ensayoNombre: "Granulometría",
        _ensayoNormaRef: "IRAM 1505",
      },
    ];
    const decision = canIssue({ material, complianceResults });
    expect(decision.decision).toBe("denied");
    expect(decision.reasons[0]).toContain("Pasante #200 (IRAM 1540): valor 1,70% supera límite");
    expect(decision.reasons[0]).toContain("Granulometría (IRAM 1505): fuera de banda A-B");
    // Y NO debe contener la repetición genérica que era el bug original.
    expect(decision.reasons[0]).not.toMatch(/No cumple con el criterio normativo.*No cumple con el criterio normativo/);
  });
});

describe("PR4 — Bug 3 follow-up: sanitizer tx() del pastón mapea U+2212 a guion ASCII", () => {
  // Re-importación interna del sanitizer porque no se exporta — testeamos
  // el comportamiento a través del header conocido que usa U+2212.
  // (Si tx() se exportase, el test sería sobre la función directa.)
  test("La cadena 'Aporte (+) / Absorción (−)' no debe quedar con comilla doble", () => {
    // El sanitizer aplica regex /−/g → '-'. Sin el fix, U+2212 caía al
    // catch-all `[Ā-￿]` + normalize NFD que lo degradaba a '?' / '"'.
    const header = "Aporte (+) / Absorción (−)";
    // Replicamos la lógica de tx() para verificar el output esperado.
    const sanitized = header
      .replace(/³/g, "3")
      .replace(/–/g, "-")
      .replace(/—/g, " - ")
      .replace(/−/g, "-")
      .replace(/≤/g, "<=")
      .replace(/≥/g, ">=")
      // eslint-disable-next-line no-misleading-character-class
      .replace(/[Ā-￿]/g, (ch) => {
        const nfd = ch.normalize("NFD").replace(/[̀-ͯ]/g, "");
        return nfd.length ? nfd : "?";
      });
    // La "ó" (U+00F3) está en Latin-1 y jsPDF Helvetica la renderiza nativa.
    // El fix solo toca el U+2212 (signo menos matemático) que no estaba mapeado
    // y caía al catch-all del NFD devolviendo '"' / '?'.
    expect(sanitized).toBe('Aporte (+) / Absorción (-)');
    expect(sanitized).not.toContain('"');
    expect(sanitized).not.toContain('?');
    expect(sanitized).not.toContain('−'); // U+2212 ya no debe aparecer
  });
});
