import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

/* ═══════════════════════════════════════════════════════════════
   Columnas del Excel de dosificaciones
   ═══════════════════════════════════════════════════════════════ */
const BASE_HEADERS = [
  "Nombre",
  "Codigo en Planta",
  "Tipo Hormigon",
  "Edad Disenio (dias)",
  "Asentamiento",
  "TMN",
  "Tipo Descarga",
  "Agua (L)",
  "Descripcion",
];

const materialHeaders = (prefix, count) => {
  const cols = [];
  for (let i = 1; i <= count; i++) {
    cols.push(`${prefix} ${i}`);
    cols.push(`Cantidad ${prefix} ${i}`);
  }
  return cols;
};

/* ═══════════════════════════════════════════════════════════════
   Helpers internos
   ═══════════════════════════════════════════════════════════════ */
const maxCount = (dosificaciones, key) =>
  dosificaciones.reduce((mx, d) => Math.max(mx, (d[key] || []).length), 0);

const buildHeaders = (maxCem, maxAdt, maxAgreg, maxFib) => [
  ...BASE_HEADERS,
  ...materialHeaders("Cemento", maxCem),
  ...materialHeaders("Aditivo", maxAdt),
  ...materialHeaders("Agregado", maxAgreg),
  ...materialHeaders("Fibra", maxFib),
];

const dosificacionToRow = (d, maxCem, maxAdt, maxAgreg, maxFib) => {
  const row = {
    Nombre: d.nombre,
    "Codigo en Planta": d.codigoEnPlanta || "",
    "Tipo Hormigon": d.tipoHormigon?.tipoHormigon || "",
    "Edad Disenio (dias)": d.edadDisenio?.dias ?? "",
    Asentamiento: d.asentamientoDisenio?.asentamiento ?? "",
    TMN: d.tamanioMaximoNominal?.tamanio ?? "",
    "Tipo Descarga": d.tipoDescarga?.tipo || "",
    "Agua (L)": d.agua,
    Descripcion: d.descripcion || "",
  };

  // Cementos
  for (let i = 0; i < maxCem; i++) {
    const c = (d.cementos || [])[i];
    row[`Cemento ${i + 1}`] = c?.cemento?.nombreComercial || "";
    row[`Cantidad Cemento ${i + 1}`] = c?.cantidadCemento ?? "";
  }
  // Aditivos
  for (let i = 0; i < maxAdt; i++) {
    const a = (d.aditivos || [])[i];
    row[`Aditivo ${i + 1}`] = a?.aditivo?.marca || "";
    row[`Cantidad Aditivo ${i + 1}`] = a?.cantidad ?? "";
  }
  // Agregados
  for (let i = 0; i < maxAgreg; i++) {
    const ag = (d.agregados || [])[i];
    row[`Agregado ${i + 1}`] = ag?.agregado?.nombre || "";
    row[`Cantidad Agregado ${i + 1}`] = ag?.cantidadAgregado ?? "";
  }
  // Fibras
  for (let i = 0; i < maxFib; i++) {
    const f = (d.fibras || [])[i];
    row[`Fibra ${i + 1}`] = f?.fibra?.marca || "";
    row[`Cantidad Fibra ${i + 1}`] = f?.cantidadFibra ?? "";
  }

  return row;
};

/* ═══════════════════════════════════════════════════════════════
   Hoja de catalogos (referencia para el usuario)
   ═══════════════════════════════════════════════════════════════ */
const buildCatalogSheet = (catalogos) => {
  const maxLen = Math.max(
    catalogos.cementos?.length || 0,
    catalogos.aditivos?.length || 0,
    catalogos.agregados?.length || 0,
    catalogos.fibras?.length || 0,
    catalogos.tiposHormigon?.length || 0,
    catalogos.edadesDisenio?.length || 0,
    catalogos.asentamientosDisenio?.length || 0,
    catalogos.tamaniosMaximos?.length || 0,
    catalogos.tiposDescarga?.length || 0,
  );

  const rows = [];
  for (let i = 0; i < maxLen; i++) {
    rows.push({
      "Tipos Hormigon": catalogos.tiposHormigon?.[i]?.tipoHormigon || "",
      "Edades Disenio (dias)": catalogos.edadesDisenio?.[i]?.dias ?? "",
      "Asentamientos": catalogos.asentamientosDisenio?.[i]?.asentamiento ?? "",
      "TMN": catalogos.tamaniosMaximos?.[i]?.tamanio ?? "",
      "Tipos Descarga": catalogos.tiposDescarga?.[i]?.tipo || "",
      "Cementos": catalogos.cementos?.[i]?.nombreComercial || "",
      "Aditivos": catalogos.aditivos?.[i]?.marca || "",
      "Agregados": catalogos.agregados?.[i]?.nombre || "",
      "Fibras": catalogos.fibras?.[i]?.marca || "",
    });
  }
  return rows;
};

/* ═══════════════════════════════════════════════════════════════
   EXPORTAR dosificaciones de una planta
   ═══════════════════════════════════════════════════════════════ */
export const exportarDosificaciones = (dosificaciones, plantaNombre, catalogos) => {
  if (!dosificaciones.length) return;

  const maxCem = Math.max(maxCount(dosificaciones, "cementos"), 2);
  const maxAdt = Math.max(maxCount(dosificaciones, "aditivos"), 1);
  const maxAgreg = Math.max(maxCount(dosificaciones, "agregados"), 1);
  const maxFib = Math.max(maxCount(dosificaciones, "fibras"), 1);

  const headers = buildHeaders(maxCem, maxAdt, maxAgreg, maxFib);
  const rows = dosificaciones.map((d) =>
    dosificacionToRow(d, maxCem, maxAdt, maxAgreg, maxFib)
  );

  const ws = XLSX.utils.json_to_sheet(rows, { header: headers });

  // Auto-width columns
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dosificaciones");

  // Hoja de catalogos
  if (catalogos) {
    const catRows = buildCatalogSheet(catalogos);
    const wsCat = XLSX.utils.json_to_sheet(catRows);
    wsCat["!cols"] = Object.keys(catRows[0] || {}).map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, wsCat, "Catalogos");
  }

  const fecha = new Date().toISOString().slice(0, 10);
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf]), `Dosificaciones_${plantaNombre}_${fecha}.xlsx`);
};

/* ═══════════════════════════════════════════════════════════════
   DESCARGAR PLANTILLA (Excel vacio con headers + catalogos)
   ═══════════════════════════════════════════════════════════════ */
export const descargarPlantilla = (catalogos) => {
  const maxCem = 2;
  const maxAdt = 3;
  const maxAgreg = 4;
  const maxFib = 2;

  const headers = buildHeaders(maxCem, maxAdt, maxAgreg, maxFib);

  // Crear hoja con solo headers
  const ws = XLSX.utils.aoa_to_sheet([headers]);
  ws["!cols"] = headers.map((h) => ({ wch: Math.max(h.length + 2, 14) }));

  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Dosificaciones");

  // Hoja de catalogos
  if (catalogos) {
    const catRows = buildCatalogSheet(catalogos);
    const wsCat = XLSX.utils.json_to_sheet(catRows);
    wsCat["!cols"] = Object.keys(catRows[0] || {}).map((h) => ({ wch: Math.max(h.length + 2, 14) }));
    XLSX.utils.book_append_sheet(wb, wsCat, "Catalogos");
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf]), "Dosificaciones_Plantilla.xlsx");
};

/* ═══════════════════════════════════════════════════════════════
   LEER Excel subido (parse en frontend, enviar JSON al backend)
   ═══════════════════════════════════════════════════════════════ */
export const parsearExcelDosificaciones = (file) => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const wb = XLSX.read(e.target.result, { type: "array" });
        const ws = wb.Sheets[wb.SheetNames[0]];
        const rows = XLSX.utils.sheet_to_json(ws, { defval: "" });
        // Normalizar filas
        const parsed = rows
          .filter((r) => r["Nombre"]?.toString().trim())
          .map((r) => {
            const base = {
              nombre: r["Nombre"]?.toString().trim(),
              codigoEnPlanta: r["Codigo en Planta"]?.toString().trim() || null,
              tipoHormigon: r["Tipo Hormigon"]?.toString().trim(),
              edadDisenio: r["Edad Disenio (dias)"] !== "" ? Number(r["Edad Disenio (dias)"]) : null,
              asentamiento: r["Asentamiento"] !== "" ? Number(r["Asentamiento"]) : null,
              tmn: r["TMN"] !== "" ? Number(r["TMN"]) : null,
              tipoDescarga: r["Tipo Descarga"]?.toString().trim(),
              agua: r["Agua (L)"] !== "" ? Number(r["Agua (L)"]) : null,
              descripcion: r["Descripcion"]?.toString().trim() || null,
              cementos: [],
              aditivos: [],
              agregados: [],
              fibras: [],
            };

            // Extraer materiales dinamicamente
            for (let i = 1; i <= 10; i++) {
              const cemName = r[`Cemento ${i}`]?.toString().trim();
              const cemCant = r[`Cantidad Cemento ${i}`];
              if (cemName) base.cementos.push({ nombre: cemName, cantidad: Number(cemCant) || 0 });

              const adtName = r[`Aditivo ${i}`]?.toString().trim();
              const adtCant = r[`Cantidad Aditivo ${i}`];
              if (adtName) base.aditivos.push({ nombre: adtName, cantidad: Number(adtCant) || 0 });

              const agrName = r[`Agregado ${i}`]?.toString().trim();
              const agrCant = r[`Cantidad Agregado ${i}`];
              if (agrName) base.agregados.push({ nombre: agrName, cantidad: Number(agrCant) || 0 });

              const fibName = r[`Fibra ${i}`]?.toString().trim();
              const fibCant = r[`Cantidad Fibra ${i}`];
              if (fibName) base.fibras.push({ nombre: fibName, cantidad: Number(fibCant) || 0 });
            }

            return base;
          });
        resolve(parsed);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = reject;
    reader.readAsArrayBuffer(file);
  });
};
