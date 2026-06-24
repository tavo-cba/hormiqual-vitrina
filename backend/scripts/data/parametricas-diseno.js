/**
 * [VITRINA] Datos parametricos del Disenador extraidos VERBATIM de migraciones
 * de produccion (no se inventaron valores). Fuentes:
 *  - 20260308-seed-curvas-diseno-base.js (ACI 211.1)
 *  - 20260310-add-icpa-method.js (ICPA)
 *  - 20260314-replace-durabilidad-cirsoc200.js (CIRSOC T.2.5, fcmin ya corregido)
 *  - 20260507-seed-cirsoc-t43-t44.js (CIRSOC T.4.3 / T.4.4)
 */

const curvaAguaACI = [
      // TMN 9.5 mm
      { nombre: 'ACI 211.1 – 9.5mm triturado', tmnMm: 9.50, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 207, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 9.5mm triturado', tmnMm: 9.50, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 228, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 9.5mm triturado', tmnMm: 9.50, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 243, formaAgregado: 'TRITURADO' },
      // TMN 12.5 mm
      { nombre: 'ACI 211.1 – 12.5mm triturado', tmnMm: 12.50, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 199, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 12.5mm triturado', tmnMm: 12.50, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 216, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 12.5mm triturado', tmnMm: 12.50, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 228, formaAgregado: 'TRITURADO' },
      // TMN 19 mm
      { nombre: 'ACI 211.1 – 19mm triturado', tmnMm: 19.00, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 190, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 19mm triturado', tmnMm: 19.00, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 205, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 19mm triturado', tmnMm: 19.00, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 216, formaAgregado: 'TRITURADO' },
      // TMN 25 mm
      { nombre: 'ACI 211.1 – 25mm triturado', tmnMm: 25.00, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 179, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 25mm triturado', tmnMm: 25.00, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 193, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 25mm triturado', tmnMm: 25.00, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 202, formaAgregado: 'TRITURADO' },
      // TMN 37.5 mm
      { nombre: 'ACI 211.1 – 37.5mm triturado', tmnMm: 37.50, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 166, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 37.5mm triturado', tmnMm: 37.50, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 181, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 37.5mm triturado', tmnMm: 37.50, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 190, formaAgregado: 'TRITURADO' },
      // TMN 50 mm
      { nombre: 'ACI 211.1 – 50mm triturado', tmnMm: 50.00, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 154, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 50mm triturado', tmnMm: 50.00, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 169, formaAgregado: 'TRITURADO' },
      { nombre: 'ACI 211.1 – 50mm triturado', tmnMm: 50.00, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 178, formaAgregado: 'TRITURADO' },

      // Canto rodado (aprox 25 l/m³ menos)
      { nombre: 'ACI 211.1 – 9.5mm rodado', tmnMm: 9.50, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 183, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 9.5mm rodado', tmnMm: 9.50, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 201, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 9.5mm rodado', tmnMm: 9.50, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 217, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 19mm rodado', tmnMm: 19.00, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 166, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 19mm rodado', tmnMm: 19.00, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 181, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 19mm rodado', tmnMm: 19.00, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 195, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 25mm rodado', tmnMm: 25.00, asentamientoMinMm: 25, asentamientoMaxMm: 50, aguaLtsM3: 154, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 25mm rodado', tmnMm: 25.00, asentamientoMinMm: 75, asentamientoMaxMm: 100, aguaLtsM3: 168, formaAgregado: 'CANTO_RODADO' },
      { nombre: 'ACI 211.1 – 25mm rodado', tmnMm: 25.00, asentamientoMinMm: 150, asentamientoMaxMm: 175, aguaLtsM3: 181, formaAgregado: 'CANTO_RODADO' },
    ];

const curvaACACI = [
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 45, acEstimado: 0.380 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 40, acEstimado: 0.420 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 35, acEstimado: 0.470 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 30, acEstimado: 0.520 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 25, acEstimado: 0.570 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 20, acEstimado: 0.630 },
      { nombre: 'ACI 211.1 – genérica 28d', familiaCemento: null, edadDias: 28, resistenciaMpa: 15, acEstimado: 0.710 },
      // 7 días
      { nombre: 'ACI 211.1 – genérica 7d', familiaCemento: null, edadDias: 7, resistenciaMpa: 30, acEstimado: 0.400 },
      { nombre: 'ACI 211.1 – genérica 7d', familiaCemento: null, edadDias: 7, resistenciaMpa: 25, acEstimado: 0.440 },
      { nombre: 'ACI 211.1 – genérica 7d', familiaCemento: null, edadDias: 7, resistenciaMpa: 20, acEstimado: 0.500 },
      { nombre: 'ACI 211.1 – genérica 7d', familiaCemento: null, edadDias: 7, resistenciaMpa: 15, acEstimado: 0.580 },
      { nombre: 'ACI 211.1 – genérica 7d', familiaCemento: null, edadDias: 7, resistenciaMpa: 10, acEstimado: 0.680 },
    ];

const aireEsperado = [
      { tmnMm: 9.50, aireBasePct: 3.00, conIncorporadorPct: 7.50 },
      { tmnMm: 12.50, aireBasePct: 2.50, conIncorporadorPct: 7.00 },
      { tmnMm: 19.00, aireBasePct: 2.00, conIncorporadorPct: 6.00 },
      { tmnMm: 25.00, aireBasePct: 1.50, conIncorporadorPct: 5.50 },
      { tmnMm: 37.50, aireBasePct: 1.00, conIncorporadorPct: 5.00 },
      { tmnMm: 50.00, aireBasePct: 0.50, conIncorporadorPct: 4.50 },
    ];

const curvaAguaICPA = [
      // MF 2.40
      { nombre: 'ICPA – MF2.40 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 208, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 228, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 195, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 212, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 187, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 202, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 177, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 192, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 166, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 182, formaAgregado: 'TRITURADO', moduloFinura: 2.40 },

      // MF 2.60
      { nombre: 'ICPA – MF2.60 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 202, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 222, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 190, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 207, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 182, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 197, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 172, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 187, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 161, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },
      { nombre: 'ICPA – MF2.60 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 177, formaAgregado: 'TRITURADO', moduloFinura: 2.60 },

      // MF 2.80
      { nombre: 'ICPA – MF2.80 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 197, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 217, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 185, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 202, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 177, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 192, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 167, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 182, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 157, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 172, formaAgregado: 'TRITURADO', moduloFinura: 2.80 },

      // MF 3.00
      { nombre: 'ICPA – MF3.00 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 193, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 212, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 180, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 197, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 172, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 187, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 162, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 177, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 152, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },
      { nombre: 'ICPA – MF3.00 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 167, formaAgregado: 'TRITURADO', moduloFinura: 3.00 },

      // MF 3.20
      { nombre: 'ICPA – MF3.20 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 188, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 207, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 175, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 192, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 167, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 182, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 157, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 172, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 147, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 162, formaAgregado: 'TRITURADO', moduloFinura: 3.20 },

      // MF 3.40
      { nombre: 'ICPA – MF3.40 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 183, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN13.2 triturado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 202, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 170, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN19 triturado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 187, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 162, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN25 triturado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 177, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 152, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN37.5 triturado', tmnMm: 37.50, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 167, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 142, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },
      { nombre: 'ICPA – MF3.40 TMN50 triturado',   tmnMm: 50.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 157, formaAgregado: 'TRITURADO', moduloFinura: 3.40 },

      // Canto rodado — same MF set, ~ 25 l/m³ less
      // MF 2.40
      { nombre: 'ICPA – MF2.40 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 185, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 205, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 172, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 189, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 164, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      { nombre: 'ICPA – MF2.40 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 179, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.40 },
      // MF 2.80
      { nombre: 'ICPA – MF2.80 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 174, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 194, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 162, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 179, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 154, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      { nombre: 'ICPA – MF2.80 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 169, formaAgregado: 'CANTO_RODADO', moduloFinura: 2.80 },
      // MF 3.20
      { nombre: 'ICPA – MF3.20 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 165, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN13.2 rodado', tmnMm: 13.20, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 184, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 152, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN19 rodado',   tmnMm: 19.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 169, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 50, asentamientoMaxMm: 70,  aguaLtsM3: 144, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
      { nombre: 'ICPA – MF3.20 TMN25 rodado',   tmnMm: 25.00, asentamientoMinMm: 100, asentamientoMaxMm: 150, aguaLtsM3: 159, formaAgregado: 'CANTO_RODADO', moduloFinura: 3.20 },
    ];

const curvaACICPA = [
      // CP40 (most common)
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 50, acEstimado: 0.330 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 45, acEstimado: 0.370 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 40, acEstimado: 0.410 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 35, acEstimado: 0.460 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 30, acEstimado: 0.510 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 25, acEstimado: 0.560 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 20, acEstimado: 0.620 },
      { nombre: 'ICPA – CP40 28d', familiaCemento: 'CP40', edadDias: 28, resistenciaMpa: 15, acEstimado: 0.700 },

      // CP30
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 40, acEstimado: 0.370 },
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 35, acEstimado: 0.410 },
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 30, acEstimado: 0.460 },
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 25, acEstimado: 0.520 },
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 20, acEstimado: 0.580 },
      { nombre: 'ICPA – CP30 28d', familiaCemento: 'CP30', edadDias: 28, resistenciaMpa: 15, acEstimado: 0.660 },

      // CP50
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 55, acEstimado: 0.330 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 50, acEstimado: 0.370 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 45, acEstimado: 0.400 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 40, acEstimado: 0.440 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 35, acEstimado: 0.490 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 30, acEstimado: 0.540 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 25, acEstimado: 0.600 },
      { nombre: 'ICPA – CP50 28d', familiaCemento: 'CP50', edadDias: 28, resistenciaMpa: 20, acEstimado: 0.660 },
    ];

const durabilidad = [
  {
    codigo: 'A1', grupo: 'Carbonatación', orden: 1,
    descripcionCorta: 'Ambiente seco o permanentemente sumergido',
    tipoProceso: 'Carbonatación',
    acMaxSimple: null,  acMaxArmado: 0.60, acMaxPretensado: 0.60,
    fcminSimple: null,  fcminArmado: 20,   fcminPretensado: 25,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'A2', grupo: 'Carbonatación', orden: 2,
    descripcionCorta: 'Ambientes húmedos excepcionalmente secos',
    tipoProceso: 'Carbonatación',
    acMaxSimple: null,  acMaxArmado: 0.60, acMaxPretensado: 0.60,
    fcminSimple: null,  fcminArmado: 20,   fcminPretensado: 25,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'A3', grupo: 'Carbonatación', orden: 3,
    descripcionCorta: 'Ambientes expuestos a ciclos de mojado y secado',
    tipoProceso: 'Carbonatación',
    acMaxSimple: null,  acMaxArmado: 0.50, acMaxPretensado: 0.50,
    fcminSimple: null,  fcminArmado: 25,   fcminPretensado: 30,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'CL1', grupo: 'Cloruros no marinos', orden: 4,
    descripcionCorta: 'Húmedo o sumergido, con cloruros de origen distinto del medio marino',
    tipoProceso: 'Cloruros',
    acMaxSimple: 0.45, acMaxArmado: 0.45, acMaxPretensado: 0.45,
    fcminSimple: 35,   fcminArmado: 35,   fcminPretensado: 35,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'CL2', grupo: 'Cloruros no marinos', orden: 5,
    descripcionCorta: 'Expuesto a emanaciones de gas Cl₂',
    tipoProceso: 'Cloruros',
    acMaxSimple: 0.45, acMaxArmado: 0.40, acMaxPretensado: 0.40,
    fcminSimple: 35,   fcminArmado: 40,   fcminPretensado: 40,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'M1', grupo: 'Marino', orden: 6,
    descripcionCorta: 'Al aire, a más de 1 km de la línea de marea alta',
    tipoProceso: 'Marino',
    acMaxSimple: null, acMaxArmado: 0.50, acMaxPretensado: 0.50,
    fcminSimple: null, fcminArmado: 30,   fcminPretensado: 35,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'M2', grupo: 'Marino', orden: 7,
    descripcionCorta: 'Al aire, a menos de 1 km de la línea de marea alta o con aire saturado de sales',
    tipoProceso: 'Marino',
    acMaxSimple: 0.45, acMaxArmado: 0.45, acMaxPretensado: 0.45,
    fcminSimple: 35,   fcminArmado: 35,   fcminPretensado: 35,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'M3', grupo: 'Marino', orden: 8,
    descripcionCorta: 'Zona de mareas / salpicaduras / condición sumergida marina severa',
    tipoProceso: 'Marino',
    acMaxSimple: 0.45, acMaxArmado: 0.40, acMaxPretensado: 0.40,
    fcminSimple: 35,   fcminArmado: 40,   fcminPretensado: 40,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'C1', grupo: 'Congelación y deshielo', orden: 9,
    descripcionCorta: 'Sin sales descongelantes',
    tipoProceso: 'Congelación y deshielo',
    acMaxSimple: 0.45, acMaxArmado: 0.45, acMaxPretensado: 0.45,
    fcminSimple: 30,   fcminArmado: 35,   fcminPretensado: 35,
    requiereAireTabla43: true,  requiereProteccionSuperficial: false,
  },
  {
    codigo: 'C2', grupo: 'Congelación y deshielo', orden: 10,
    descripcionCorta: 'Con sales descongelantes',
    tipoProceso: 'Congelación y deshielo',
    acMaxSimple: 0.40, acMaxArmado: 0.40, acMaxPretensado: 0.40,
    fcminSimple: 35,   fcminArmado: 40,   fcminPretensado: 40,
    requiereAireTabla43: true,  requiereProteccionSuperficial: false,
  },
  {
    codigo: 'Q1', grupo: 'Ataque químico', orden: 11,
    descripcionCorta: 'Moderado',
    tipoProceso: 'Ataque químico',
    acMaxSimple: 0.50, acMaxArmado: 0.50, acMaxPretensado: 0.50,
    fcminSimple: 30,   fcminArmado: 35,   fcminPretensado: 40,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'Q2', grupo: 'Ataque químico', orden: 12,
    descripcionCorta: 'Fuerte',
    tipoProceso: 'Ataque químico',
    acMaxSimple: 0.45, acMaxArmado: 0.45, acMaxPretensado: 0.45,
    fcminSimple: 35,   fcminArmado: 35,   fcminPretensado: 40,
    requiereAireTabla43: false, requiereProteccionSuperficial: false,
  },
  {
    codigo: 'Q3', grupo: 'Ataque químico', orden: 13,
    descripcionCorta: 'Muy fuerte',
    tipoProceso: 'Ataque químico',
    acMaxSimple: 0.40, acMaxArmado: 0.40, acMaxPretensado: 0.40,
    fcminSimple: 40,   fcminArmado: 40,   fcminPretensado: 45,
    requiereAireTabla43: false, requiereProteccionSuperficial: true,
  },
  {
    codigo: 'Q4', grupo: 'Ataque químico', orden: 14,
    descripcionCorta: 'Muy fuerte — conducción/tratamiento de líquidos cloacales al aire libre',
    tipoProceso: 'Ataque químico',
    acMaxSimple: 0.40, acMaxArmado: 0.40, acMaxPretensado: 0.40,
    fcminSimple: 40,   fcminArmado: 40,   fcminPretensado: 45,
    requiereAireTabla43: false, requiereProteccionSuperficial: true,
  },
];

const aireDurabilidad = [
  { tmnMm: 13.2, claseExposicion: 'C1', aireTotalPct: 5.5, toleranciaPct: 1.5 },
  { tmnMm: 13.2, claseExposicion: 'C2', aireTotalPct: 7.0, toleranciaPct: 1.5 },
  { tmnMm: 19.0, claseExposicion: 'C1', aireTotalPct: 5.0, toleranciaPct: 1.5 },
  { tmnMm: 19.0, claseExposicion: 'C2', aireTotalPct: 6.0, toleranciaPct: 1.5 },
  { tmnMm: 26.5, claseExposicion: 'C1', aireTotalPct: 4.5, toleranciaPct: 1.5 },
  { tmnMm: 26.5, claseExposicion: 'C2', aireTotalPct: 6.0, toleranciaPct: 1.5 },
  { tmnMm: 37.5, claseExposicion: 'C1', aireTotalPct: 4.5, toleranciaPct: 1.5 },
  { tmnMm: 37.5, claseExposicion: 'C2', aireTotalPct: 5.5, toleranciaPct: 1.5 },
];

const pulverulento = [
  { tmnMm: 13.2, minimoKgM3: 480 },
  { tmnMm: 19.0, minimoKgM3: 440 },
  { tmnMm: 26.5, minimoKgM3: 410 },
  { tmnMm: 37.5, minimoKgM3: 380 },
  { tmnMm: 53.0, minimoKgM3: 350 },
];

module.exports = { curvaAguaACI, curvaACACI, aireEsperado, curvaAguaICPA, curvaACICPA, durabilidad, aireDurabilidad, pulverulento };
