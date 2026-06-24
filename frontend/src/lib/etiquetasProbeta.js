import axios from "axios";
import { config } from "../config/config";
import { downloadEtiquetasProbetaQr } from "../components/calidad/reportes/etiquetasProbetaQrPdf";
import {
  generarEtiquetasProbetaZpl,
  downloadEtiquetasProbetaZpl,
} from "../components/calidad/reportes/etiquetasProbetaZpl";
import { enviarZpl } from "./zebraBrowserPrint";

export const FORMATO_OPCIONES = [
  { label: "A4 (papel adhesivo común, 21 etiquetas/hoja)", value: "a4" },
  { label: "Térmica PDF (rollo 60×40 mm: Zebra ZD220 / Brady)", value: "termica" },
  { label: "Zebra (impresión directa · requiere Browser Print)", value: "zpl" },
];

const startOfDay = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
const endOfDay   = (d) => { const x = new Date(d); x.setHours(23, 59, 59, 999); return x; };

// Semana ISO: lunes a domingo, conteniendo `ref`.
const rangoSemana = (ref = new Date()) => {
  const d = startOfDay(ref);
  const dow = d.getDay(); // 0=domingo, 1=lunes...
  const offsetLunes = dow === 0 ? -6 : 1 - dow;
  const lunes = new Date(d); lunes.setDate(d.getDate() + offsetLunes);
  const domingo = new Date(lunes); domingo.setDate(lunes.getDate() + 6);
  return [startOfDay(lunes), endOfDay(domingo)];
};

const rangoMes = (ref = new Date()) => {
  const d = new Date(ref);
  const primero = new Date(d.getFullYear(), d.getMonth(), 1, 0, 0, 0, 0);
  const ultimo  = new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59, 59, 999);
  return [primero, ultimo];
};

export const QUICK_FILTROS_FECHA = [
  { label: "Todo",         value: "todo" },
  { label: "Hoy",          value: "hoy",     getRange: () => [startOfDay(new Date()), endOfDay(new Date())] },
  { label: "Esta semana",  value: "semana",  getRange: () => rangoSemana() },
  { label: "Este mes",     value: "mes",     getRange: () => rangoMes() },
  { label: "Personalizado", value: "custom" },
];

const probetaCliente = (p) =>
  p?.muestra?.cliente
  ?? p?.muestra?.despacho?.cliente
  ?? p?.muestraTerceros?.cliente
  ?? p?.muestraPaston?.cliente
  ?? null;

const clienteLabel = (c) => {
  if (!c) return "";
  if (c.tipoPersona === "Jurídica") return c.razonSocial || c.nombre || "";
  return c.nombre || c.razonSocial || "";
};

const probetaPlanta = (p) =>
  p?.muestra?.planta
  ?? p?.muestra?.despacho?.planta
  ?? p?.muestraTerceros?.planta
  ?? p?.muestraPaston?.planta
  ?? null;

const probetaTipoHormigon = (p) =>
  p?.muestra?.tipoHormigon?.tipoHormigon
  ?? p?.muestra?.dosificacion?.tipoHormigon?.tipoHormigon
  ?? p?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon
  ?? p?.muestraTerceros?.tipoHormigon?.tipoHormigon
  ?? p?.muestraPaston?.tipoHormigon?.tipoHormigon
  ?? p?.muestraPaston?.dosificacion?.tipoHormigon?.tipoHormigon
  ?? null;

const probetaFechaMuestra = (p) =>
  p?.muestra?.fecha
  ?? p?.muestra?.despacho?.fecha
  ?? p?.muestraTerceros?.fecha
  ?? p?.muestraPaston?.fecha
  ?? null;

const probetaFcMpa = (p) =>
  p?.muestra?.tipoHormigon?.fcMpa
  ?? p?.muestraTerceros?.tipoHormigon?.fcMpa
  ?? p?.muestraPaston?.tipoHormigon?.fcMpa;

const probetaObra = (p) =>
  p?.muestra?.obra?.nombre
  ?? p?.muestraTerceros?.obra?.nombre
  ?? p?.muestraPaston?.obra?.nombre;

// "Lote" de la etiqueta = remito de la muestra (decisión 2026-06-02).
// Probetas de pastón / terceros pueden no tener remito → queda vacío.
const probetaRemito = (p) =>
  p?.muestra?.remito
  ?? p?.muestra?.despacho?.remito
  ?? p?.muestraTerceros?.remito
  ?? null;

/**
 * Shape común que consume `downloadEtiquetasProbetaQr`. Se usa desde
 * probeta.jsx, muestra.jsx, muestraTerceros.jsx y EtiquetasPendientesPage.jsx.
 */
export const probetaToPdfItem = (p) => ({
  idProbeta: p.idProbeta,
  nombre: p.nombre,
  codigo: p.codigo,
  tipoHormigon: probetaTipoHormigon(p),
  diasRotura: p.diasRotura,
  fechaConfeccion: probetaFechaMuestra(p),
  fechaRotura: p.fechaRotura,
  fcMpa: probetaFcMpa(p),
  cliente: clienteLabel(probetaCliente(p)),
  obra: probetaObra(p),
  planta: probetaPlanta(p)?.nombre,
  remito: probetaRemito(p),
});

/**
 * Genera las etiquetas (PDF A4/térmica o archivo ZPL según `formato`) y
 * marca las probetas como impresas en backend.
 * Idempotente desde el lado del server (re-imprimir actualiza timestamp).
 */
export const imprimirYMarcar = async (probetas, { formato = "a4", filename } = {}) => {
  const items = probetas.map(probetaToPdfItem);
  const baseUrl = `${window.location.origin}/p/`;

  // metodo: 'impresora' (ZPL directo a Zebra), 'archivo' (descarga .zpl como
  // fallback) o 'pdf' (A4/térmica). El llamador usa esto para el toast.
  let metodo = 'pdf';
  let motivo = null;

  if (formato === "zpl") {
    const zpl = generarEtiquetasProbetaZpl(items, { baseUrl });
    try {
      // El QR lo dibuja la propia impresora (^BQ). Browser Print reenvía el
      // ZPL crudo a la Zebra por defecto.
      await enviarZpl(zpl);
      metodo = 'impresora';
    } catch (err) {
      // Browser Print no instalado / sin permiso del dominio / sin impresora
      // por defecto / certificado no aceptado → caemos al archivo .zpl.
      console.warn('Impresión directa Zebra no disponible, se descarga el .zpl:', err);
      downloadEtiquetasProbetaZpl(items, { baseUrl }, filename || "etiquetas-probetas.zpl");
      metodo = 'archivo';
      motivo = err?.message || 'Zebra Browser Print no está disponible.';
    }
  } else {
    await downloadEtiquetasProbetaQr(
      items,
      { baseUrl, formato },
      filename || "etiquetas-probetas.pdf",
    );
  }

  const idsProbeta = items.map((p) => p.idProbeta).filter((n) => Number.isInteger(n) && n > 0);
  if (idsProbeta.length > 0) {
    await axios.post(
      `${config.backendUrl}/api/probetas/etiquetas-impresas`,
      { idsProbeta },
      { headers: config.headers },
    );
  }
  return { impresas: idsProbeta.length, metodo, motivo };
};

/**
 * Traduce el resultado de `imprimirYMarcar` a un toast (severity + mensaje),
 * para que las pantallas no dupliquen la lógica de método/fallback.
 *
 * @param {{impresas:number, metodo?:string, motivo?:string}} res
 * @returns {{severity:'success'|'warn', mensaje:string}}
 */
export const mensajeResultadoEtiquetas = (res) => {
  const { impresas = 0, metodo, motivo } = res || {};
  if (metodo === 'impresora') {
    return { severity: 'success', mensaje: `Enviado a la impresora Zebra: ${impresas} etiqueta(s).` };
  }
  if (metodo === 'archivo') {
    return {
      severity: 'warn',
      mensaje: `No se pudo imprimir directo${motivo ? `: ${motivo}` : ' (Zebra Browser Print no disponible)'} Se descargó el archivo .zpl para ${impresas} probeta(s); podés enviarlo con Zebra Setup Utilities.`,
    };
  }
  return { severity: 'success', mensaje: `Etiquetas generadas para ${impresas} probeta(s).` };
};
