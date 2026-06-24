// ReportResistencias.jsx
import React, {
  useState,
  useMemo,
  useReducer,
  useEffect,
  useContext,
} from "react";
import axios from "axios";
import dayjs from "dayjs";
import { Button } from "primereact/button";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Chart as PrimeChart } from "primereact/chart";
import ChartJS from "chart.js/auto";

import * as XLSX from "xlsx";
import jsPDF from "jspdf";
import "jspdf-autotable";

import "./resistance-reports.css";
import ResistanceFilter from "./resistance-filter";
import { config } from "../../../config/config";
import { useConfig } from "../../../context/ConfigContext";
import { useToast } from "../../../context/ToastContext";
import { ThemeContext } from "../../../context/ThemeContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import AIPromptButton from "../../../common/components/ai/AIPromptButton";
// PR9 NO aplica acá: el reporte de resistencia trabaja sobre ensayos
// de probetas ya colocadas. El criterio normativo es contractual
// (CIRSOC §6.2.3 / §6.2.4 + IRAM 1666 §A.7.10) y la norma es soberana
// siempre. Ver CLAUDE.md raíz §"Modelo dual de evaluación → IMPORTANTE
// - DÓNDE APLICA LA DUALIDAD". Toggle removido en sesión 2026-05-09.

/* ───────────────────────── state helpers ───────────────────────── */
const filtersReducer = (state, action) => {
  switch (action.type) {
    case "SET_FILTER":
      return { ...state, [action.payload.field]: action.payload.value };
    case "RESET_FILTERS":
      return {
        idCliente: null,
        tipoHormigon: null,
        idDosificacion: null,
        idObra: null,
        idPlanta: null,
        fechaDesde: null,
        fechaHasta: null,
      };
    default:
      return state;
  }
};

/* Column header ↔ etiqueta */
const columnHeaders = {
  tipoHormigon: "Tipo de Hormigón",
  resistencia_media: "Resist. Media",
  desviacion_estandar: "Desviación",
  minima: "Resist. Mín.",
  maxima: "Resist. Máx.",
  caracteristica: "Resist. Característica",
  coef_variacion: "Coef. Variación",
  resistencia_diseno: "Resist. Objetivo",
  cumpleLote: "Cumple Lote",
  cumpleCirsocM1: "Cumple CIRSOC M1",
  cumpleCirsocM2: "Cumple CIRSOC M2",
  tamanoLote: "Tamaño del Lote",
  cliente: "Cliente",
  obra: "Obra",
  planta: "Planta",
  idDosificacion: "Dosificación",
};

/* ───────────────────────── componente ───────────────────────── */
const ReportResistencias = () => {
  /* ───────── UI & filtros ───────── */
  const toast = useToast();
  const { isDark } = useContext(ThemeContext);
  const [edadDiseno, setEdadDiseno] = useState(null);
  const [filterVisible, setFilterVisible] = useState(false);

  const [tempFilters, dispatch] = useReducer(filtersReducer, {
    idCliente: null,
    tipoHormigon: null,
    idDosificacion: null,
    idObra: null,
    idPlanta: null,
    fechaDesde: null,
    fechaHasta: null,
  });
  const [appliedFilters, setAppliedFilters] = useState({ ...tempFilters });
  const applyFilters = () => setAppliedFilters({ ...tempFilters });
  const clearAllFilters = () => {
    dispatch({ type: "RESET_FILTERS" });
    setAppliedFilters({
      idCliente: null,
      tipoHormigon: null,
      idDosificacion: null,
      idObra: null,
      idPlanta: null,
      fechaDesde: null,
      fechaHasta: null,
    });
  };

  const [showCliente, setShowCliente] = useState(false);
  const [showDosificacion, setShowDosificacion] = useState(false);
  const [showPlanta, setShowPlanta] = useState(false);
  const [showObra, setShowObra] = useState(false);
  const [data10porciento, setData10porciento] = useState(false);
  const [showSabana, setShowSabana] = useState(false);
  const [showHermanas, setShowHermanas] = useState(false);
  const [showListadoProbetas, setShowListadoProbetas] = useState(false);
  const [showResumenEstadistico, setShowResumenEstadistico] = useState(true);
  const [criteriosCumplimiento, setCriteriosCumplimiento] = useState(false);
  const [showIram, setShowIram] = useState(false);
  const [showCirsocM1, setShowCirsocM1] = useState(false);
  const [showCirsocM2, setShowCirsocM2] = useState(false);
  const [esOficial, setEsOficial] = useState(false);
  const [showGraficoComparativo, setShowGraficoComparativo] = useState(true);
  const [showGraficoEvolucion, setShowGraficoEvolucion] = useState(false);
  /* ───────── datos ───────── */
  const [mainData, setMainData] = useState([]);
  const [hermanasData, setHermanasData] = useState({});
  const [probetasData, setProbetasData] = useState([]);
  const [loading, setLoading] = useState(false);
  const [muestrasTerceros, setMuestrasTerceros] = useState(false);
  const [tipoFecha, setTipoFecha] = useState('confeccion');
  const [dosificacionesById, setDosificacionesById] = useState({});

  const cfg = useConfig();

  /* 🚀 Trae los datos cada vez que cambian filtros o edad */
  useEffect(() => {
    if (!edadDiseno) return;

    (async () => {
      setLoading(true);
      const formatDateForApi = (date) =>
        dayjs(date).format("YYYY-MM-DD");
      const normalizeHastaDateForApi = (date) =>
        dayjs(date).add(1, "day").format("YYYY-MM-DD");
      try {
        const params = {
          edadDiseno,
          muestrasTerceros,
          tipoFecha,
          idCliente: appliedFilters.idCliente || undefined,
          idTipoHormigon: appliedFilters.tipoHormigon || undefined,
          idDosificacion: appliedFilters.idDosificacion || undefined,
          idObra: appliedFilters.idObra || undefined,
          idPlanta: appliedFilters.idPlanta || undefined,
          desde: appliedFilters.fechaDesde
            ? formatDateForApi(appliedFilters.fechaDesde)
            : undefined,
          hasta: appliedFilters.fechaHasta
            ? normalizeHastaDateForApi(appliedFilters.fechaHasta)
            : undefined,
        };
        const response = await axios.get(
          `${config.backendUrl}/api/probetas/resistencias`,
          { params, headers: config.headers }
        );
        const resData = response.data ?? [];
        if (resData.main !== undefined) {
          setMainData(resData.main);
          setHermanasData(resData.hermanas || {});
          setProbetasData(resData.probetas || []);
        } else {
          setMainData(Array.isArray(resData) ? resData : []);
          setHermanasData({});
          setProbetasData([]);
        }
      } catch (err) {
        console.error(err);
        setMainData([]);
        setHermanasData({});
      } finally {
        setLoading(false);
      }
    })();
  }, [edadDiseno, muestrasTerceros, tipoFecha, appliedFilters]);

  useEffect(() => {
    if (!mainData.length) return;

    let isMounted = true;

    (async () => {
      try {
        const response = await axios.get(
          `${config.backendUrl}/api/dosificaciones`,
          { headers: config.headers }
        );
        const dosificaciones = response.data ?? [];
        const nextDosificaciones = dosificaciones.reduce((acc, dos) => {
          if (dos?.idDosificacion !== undefined && dos?.idDosificacion !== null) {
            acc[dos.idDosificacion] = dos;
          }
          return acc;
        }, {});
        if (isMounted) {
          setDosificacionesById(nextDosificaciones);
        }
      } catch (err) {
        console.error(err);
      }
    })();

    return () => {
      isMounted = false;
    };
  }, [mainData]);

  const aiPromptData = useMemo(
    () =>
      mainData.map((row) => ({
        ...row,
        dosificacion: row.idDosificacion
          ? dosificacionesById[row.idDosificacion] ??
            dosificacionesById[Number(row.idDosificacion)] ??
            null
          : null,
      })),
      
    [mainData, dosificacionesById]
  );

  /* ───────── ordenamiento ───────── */
  const [sortField, setSortField] = useState(null);
  const [sortOrder, setSortOrder] = useState(1);
  // RES-05: paginación controlada en la tabla principal. Resetear a 0 cuando
  // cambian los filtros aplicados (regla CLAUDE.md).
  const [tableFirst, setTableFirst] = useState(0);
  useEffect(() => { setTableFirst(0); }, [appliedFilters, edadDiseno]);
  const sortData = (arr, field, order) =>
    [...arr].sort((a, b) => {
      const va = a[field];
      const vb = b[field];
      if (field === "tipoHormigon") {
        const na = parseInt(va.replace(/\D/g, ""), 10) || 0;
        const nb = parseInt(vb.replace(/\D/g, ""), 10) || 0;
        return order > 0 ? na - nb : nb - na;
      }
      if (typeof va === "string" && typeof vb === "string") {
        return order > 0
          ? va.localeCompare(vb)
          : vb.localeCompare(va);
      }
      return order > 0 ? va - vb : vb - va;
    });

  const sortedData = useMemo(() => {
    return sortField
      ? sortData(mainData, sortField, sortOrder)
      : mainData;
  }, [mainData, sortField, sortOrder]);

  /* ───────── columnas visibles ───────── */
  const requiredColumns = [
    "tipoHormigon",
    "resistencia_media",
    "caracteristica",
  ];
  const [visibleColumns, setVisibleColumns] = useState([
    ...requiredColumns,
    "desviacion_estandar",
    "cumpleLote",
    "tamanoLote",
    "resistencia_diseno",
  ]);

  const columnOptions = [
    { label: "Tipo de H°", value: "tipoHormigon", disabled: true },
    { label: "Resist. Media", value: "resistencia_media", disabled: true },
    { label: "Resist. Característica", value: "caracteristica", disabled: true },
    { label: "Resist. Objetivo", value: "resistencia_diseno" },
    { label: "Desviación", value: "desviacion_estandar" },
    { label: "Resist. Mín.", value: "minima" },
    { label: "Resist. Máx.", value: "maxima" },
    { label: "Cumple Lote", value: "cumpleLote" },
    { label: "Cumple CIRSOC M1", value: "cumpleCirsocM1" },
    { label: "Cumple CIRSOC M2", value: "cumpleCirsocM2" },
    { label: "Tam. del Lote", value: "tamanoLote" },
    { label: "Cliente", value: "cliente" },
    { label: "Dosificación", value: "idDosificacion" },
    { label: "Obra", value: "obra" },
    { label: "Planta", value: "planta" },
    { label: "Todos", value: "todos" },
  ];
  const optionalColumns = columnOptions.filter(
    (o) => !requiredColumns.includes(o.value) && o.value !== "todos"
  );

  const toggleColumn = (col) => {
    if (requiredColumns.includes(col)) return;
    setVisibleColumns((prev) =>
      prev.includes(col)
        ? prev.filter((c) => c !== col)
        : [...prev, col]
    );
  };

  const toggleAll = () => {
    const allOptValues = optionalColumns.map((o) => o.value);
    const allVisible = allOptValues.every((c) =>
      visibleColumns.includes(c)
    );
    setVisibleColumns(
      allVisible
        ? requiredColumns
        : [...requiredColumns, ...allOptValues]
    );
  };

  const boolCellTemplate = (value) => {
    const className = value == null
      ? "res-bool-cell res-bool-cell--na"
      : value
        ? "res-bool-cell res-bool-cell--yes"
        : "res-bool-cell res-bool-cell--no";

    const icon = value == null
      ? "fa-solid fa-minus"
      : value
        ? "fa-solid fa-check"
        : "fa-solid fa-xmark";

    const text = value == null ? "N/A" : value ? "Sí" : "No";

    return (
      <span className={className}>
        <i className={icon} style={{ fontSize: '0.65rem' }} />
        {text}
      </span>
    );
  };

  /* ───────── exportar ───────── */
  const exportToExcel = () => {
    const rows = sortedData.map((r) => {
      const obj = {};
      visibleColumns.forEach((c) => (obj[columnHeaders[c]] = r[c]));
      return obj;
    });
    const ws = XLSX.utils.json_to_sheet(rows);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Resistencias");
    XLSX.writeFile(wb, "Reporte_Resistencias.xlsx");
  };

  const exportToPDF = async (empleadoFirma, productorHormigon) => {
    try {
      setLoading(true);

      const response = await axios.post(
        `${config.backendUrl}/api/probetas/pdf`,
        {
          params: {
            edadDiseno,
            muestrasTerceros,
            tipoFecha,
            ...appliedFilters,
            showCliente,
            showDosificacion,
            showPlanta,
            showObra,
            data10porciento,
            showSabana,
            showHermanas,
            showListadoProbetas,
            showResumenEstadistico,
            criteriosCumplimiento,
            showIram,
            showCirsocM1,
            showCirsocM2,
            esOficial,
            showGraficoComparativo,
            showGraficoEvolucion,
          },
          empleadoFirma,
          productorHormigon,
          configEmpresa: {
            thumbnail: cfg?.thumbnail,
            nombreEmpresa: cfg?.nombreEmpresa,
          },
          clienteNombre: mainData[0]?.cliente,
        },
        {
          headers: config.headers,
          responseType: 'blob',
        }
      );

      // Crear URL del blob y descargar
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;

      const clienteNombre = appliedFilters.idCliente
        ? (mainData.find((r) => r?.cliente)?.cliente ?? 'Cliente')
        : 'Todos';
      const safeCliente = (clienteNombre || 'Cliente')
        .toString()
        .trim()
        .replace(/\s+/g, ' ')
        .replace(/[\\/*?"<>|]+/g, '');
      const fechaHora = dayjs().format('DD-MM-YYYY HH:mm');
      const fileName = `Reporte Resistencias ${safeCliente} ${fechaHora}.pdf`;

      link.download = fileName;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (error) {
      console.error('Error al generar PDF:', error);
      toast('error', 'Error al generar el PDF. Por favor, intente nuevamente.');
    } finally {
      setLoading(false);
    }
  };

  /* ───────── gráfico ───────── */
  const chartData = {
    labels: sortedData.map((d) => d.tipoHormigon),
    datasets: [
      {
        label: "Resist. Característica (MPa)",
        type: "bar",
        backgroundColor: "rgba(59, 89, 152, 0.75)",
        borderColor: "rgba(59, 89, 152, 1)",
        borderWidth: 1,
        borderRadius: 4,
        data: sortedData.map((d) => d.caracteristica),
      },
      {
        label: "Resist. Media (MPa)",
        type: "bar",
        backgroundColor: "rgba(46, 204, 113, 0.75)",
        borderColor: "rgba(46, 204, 113, 1)",
        borderWidth: 1,
        borderRadius: 4,
        data: sortedData.map((d) => d.resistencia_media),
      },
      {
        label: "Resist. Objetivo (MPa)",
        type: "bar",
        backgroundColor: "rgba(241, 196, 15, 0.75)",
        borderColor: "rgba(241, 196, 15, 1)",
        borderWidth: 1,
        borderRadius: 4,
        data: sortedData.map((d) => d.resistencia_diseno),
      },
    ],
  };

  // Colores del chart resueltos en función del tema activo. Reemplaza el
  // hardcoded "white"/"gray" que dejaba el chart ilegible en modo claro.
  const tickColor = isDark ? "rgba(255,255,255,0.85)" : "#2c3e50";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const tooltipBg = isDark ? "#1f2937" : "#ffffff";
  const tooltipTitle = isDark ? "#ffffff" : "#2c3e50";
  const tooltipBody = isDark ? "rgba(255,255,255,0.85)" : "#34495e";
  const tooltipBorder = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.08)";

  const chartOptions = {
    responsive: true,
    maintainAspectRatio: false,
    scales: {
      x: {
        ticks: { color: tickColor, font: { size: 11 } },
        grid: { color: gridColor },
      },
      y: {
        beginAtZero: true,
        ticks: { color: tickColor, font: { size: 11 } },
        grid: { color: gridColor },
      },
    },
    plugins: {
      legend: {
        position: "bottom",
        labels: {
          color: tickColor,
          padding: 20,
          usePointStyle: true,
          pointStyle: "rectRounded",
        },
      },
      tooltip: {
        backgroundColor: tooltipBg,
        titleColor: tooltipTitle,
        bodyColor: tooltipBody,
        borderColor: tooltipBorder,
        borderWidth: 1,
        padding: 12,
        cornerRadius: 8,
      },
    },
  };


  const allOptionalVisible = optionalColumns.every((c) =>
    visibleColumns.includes(c.value)
  );

  /* ───────── render ───────── */
  return (
    <div className="resistance-module p-0 pt-3">
      {/* Overlay móvil */}
      <div
        className={`res-mobile-overlay ${filterVisible ? 'visible' : ''}`}
        onClick={() => setFilterVisible(false)}
      />

      {/* Botón flotante móvil */}
      <button
        className="res-mobile-filter-btn"
        onClick={() => setFilterVisible(true)}
      >
        <i className="fa-solid fa-sliders" />
      </button>

      {/* Panel de Filtros */}
      <ResistanceFilter
        visible={filterVisible}
        setVisible={setFilterVisible}
        edadDiseno={edadDiseno}
        setEdadDiseno={setEdadDiseno}
        tempFilters={tempFilters}
        dispatch={dispatch}
        handleApplyFilters={applyFilters}
        handleClearAllFilters={clearAllFilters}
        handleToggleAll={toggleAll}
        handleToggleColumn={toggleColumn}
        visibleColumns={visibleColumns}
        optionalColumns={optionalColumns}
        allOptionalVisible={allOptionalVisible}
        exportToExcel={exportToExcel}
        exportToPDF={exportToPDF}
        showCliente={showCliente}
        setShowCliente={setShowCliente}
        showDosificacion={showDosificacion}
        setShowDosificacion={setShowDosificacion}
        showListadoProbetas={showListadoProbetas}
        setShowListadoProbetas={setShowListadoProbetas}
        showPlanta={showPlanta}
        setShowPlanta={setShowPlanta}
        showObra={showObra}
        setShowObra={setShowObra}
        esOficial={esOficial}
        setEsOficial={setEsOficial}
        showSabana={showSabana}
        setShowSabana={setShowSabana}
        showHermanas={showHermanas}
        setShowHermanas={setShowHermanas}
        data10porciento={data10porciento}
        setData10porciento={setData10porciento}
        showResumenEstadistico={showResumenEstadistico}
        setShowResumenEstadistico={setShowResumenEstadistico}
        criteriosCumplimiento={criteriosCumplimiento}
        setCriteriosCumplimiento={setCriteriosCumplimiento}
        showIram={showIram}
        setShowIram={setShowIram}
        showCirsocM1={showCirsocM1}
        setShowCirsocM1={setShowCirsocM1}
        showCirsocM2={showCirsocM2}
        setShowCirsocM2={setShowCirsocM2}
        muestrasTerceros={muestrasTerceros}
        setMuestrasTerceros={setMuestrasTerceros}
        tipoFecha={tipoFecha}
        setTipoFecha={setTipoFecha}
        showGraficoComparativo={showGraficoComparativo}
        setShowGraficoComparativo={setShowGraficoComparativo}
        showGraficoEvolucion={showGraficoEvolucion}
        setShowGraficoEvolucion={setShowGraficoEvolucion}
      />

      {/* Panel Principal */}
      <div className="res-main-panel">
        {/* Header */}
        <div className="res-report-header">
          <h1 className="res-report-title">
            <span className="res-report-title-icon">
              <i className="fa-solid fa-chart-column" />
            </span>
            Reporte de Resistencias
          </h1>
          {edadDiseno && (
            <span className="res-report-badge">
              <i className="fa-solid fa-calendar-check" />
              {edadDiseno} días
            </span>
          )}
        </div>

        {/* RES-11: banner aclaratorio sobre el fractil del estimador.
            CIRSOC 200-2024 §6.2.3.8 (lote estadístico) usa fractil 10 %
            (k = 1,28) para el estimador de aceptación de cliente; CIRSOC
            201 §5.5.3.2 define f'c de proyecto al fractil 5 % (k = 1,65).
            Son cifras distintas y conviven en este reporte: el "fck calc"
            mostrado es el estimador del cliente, NO f'c de proyecto. */}
        {edadDiseno && (
          <div
            className="res-banner-info mb-3 p-2"
            style={{
              // Antes: background var(--blue-50) — casi blanco en ambos temas;
              // en dark mode el var(--text-color) también es claro → texto
              // ilegible. Usamos RGBA con opacidad media para que el azul se
              // vea en ambos temas, y color de texto explícito.
              borderLeft: '4px solid var(--blue-500, #3498db)',
              background: 'rgba(59, 130, 246, 0.15)',
              color: 'var(--text-color)',
              borderRadius: 4,
              fontSize: '0.85rem',
              lineHeight: 1.5,
            }}
          >
            <i className="fa-solid fa-circle-info mr-2" style={{ color: 'var(--blue-500, #3498db)' }} />
            <strong>f'ck mostrado:</strong> estimador al fractil 10 % de aceptación cliente (CIRSOC 200-2024 §6.2.3.8, k = 1,28).
            <strong> f'c de proyecto</strong> se define al fractil 5 % (CIRSOC 201 §5.5.3.2, k = 1,65). Son cifras distintas — no confundir.
          </div>
        )}

        {/* Estado sin selección de edad */}
        {!edadDiseno ? (
          <div className="res-empty-state">
            <div className="res-empty-state-icon">
              <i className="fa-solid fa-calendar-day" />
            </div>
            <h2 className="res-empty-state-title">
              Seleccioná una edad de diseño
            </h2>
            <p className="res-empty-state-text">
              Elegí una edad de diseño en el panel de filtros para visualizar las estadísticas de resistencia.
            </p>
          </div>
        ) : (
          <>
            {/* Loading */}
            {loading ? (
              <div className="res-loading">
                <LoadSpinner />
              </div>
            ) : sortedData.length > 0 ? (
              <>
                {/* Card del Gráfico */}
                <div className="res-chart-card">
                  <div className="res-chart-header">
                    <h3 className="res-chart-title">
                      <i className="fa-solid fa-chart-bar res-chart-title-icon" />
                      Comparativa de resistencias
                    </h3>
                    <span className="res-age-badge">
                      <i className="fa-solid fa-clock" />
                      Edad: {edadDiseno} días
                    </span>
                  </div>
                  <div className="res-chart-body">
                    <PrimeChart
                      type="bar"
                      data={chartData}
                      options={chartOptions}
                      style={{ height: '100%', minHeight: '280px' }}
                    />
                  </div>
                </div>

                {/* Botón AI */}
                <div className="res-ai-section">
                  <AIPromptButton
                    label="Interpretar con IA"
                    confirmMessage="¿Quieres hacer una interpretación de estas estadísticas con IA?"
                    prompt={`Actuá como un ingeniero civil experto en tecnología del hormigón, control de calidad y gestión según normas ISO 9001, IRAM 1666 y CIRSOC 200:2024.

Analizá en detalle las siguientes estadísticas de ensayos de resistencia y sus dosificaciones asociadas. Generá un informe técnico profesional con el siguiente formato:

# INFORME TÉCNICO DE ANÁLISIS DE DOSIFICACIONES Y RESISTENCIAS

## 1. RESUMEN EJECUTIVO
Breve síntesis de los hallazgos principales (2-3 párrafos máximo).

## 2. ANÁLISIS POR TIPO DE HORMIGÓN

Para cada tipo de hormigón (H-17, H-25, H-30, etc.):

### 2.1. Evaluación de Desempeño
- Resistencia media obtenida vs. resistencia de diseño
- Análisis de la desviación estándar y coeficiente de variación
- Cumplimiento de criterios normativos (Lote, CIRSOC M1/M2)
- Tamaño de lote y representatividad estadística

### 2.2. Análisis de la Dosificación Actual
- Relación agua/cemento (calculá y evaluá)
- Contenido de cemento por m³
- Tipo y proporción de agregados finos y gruesos
- Uso de aditivos (dosis y eficiencia)
- Módulo de finura combinado de agregados

### 2.3. Diagnóstico Técnico
Identificá problemas específicos:
- Sobredosificación de cemento (si aplica)
- Relación A/C inadecuada
- Distribución granulométrica de agregados
- Eficiencia del aditivo plastificante
- Variabilidad excesiva en resultados

## 3. PROPUESTAS DE OPTIMIZACIÓN

Para cada dosificación, proponé ajustes concretos y técnicamente fundamentados:

### 3.1. Optimización de Materiales Cementíceos
- Reducción de cemento (si es posible mantener resistencia)
- Uso de adiciones minerales (filler calizo, cenizas volantes, escoria)
- Justificación técnica y económica

### 3.2. Optimización de Agregados
- Ajustes en la proporción arena/ripio
- Mejora de empaquetamiento granulométrico
- Uso de agregados de diferentes tamaños para reducir vacíos

### 3.3. Optimización de Aditivos
- Ajuste de dosis del plastificante actual
- Evaluación de otros aditivos complementarios
- Mejora de trabajabilidad sin aumentar agua

### 3.4. Control de Relación Agua/Cemento
- Valores objetivos de A/C para cada resistencia
- Impacto en durabilidad y resistencia a largo plazo

## 4. CONTROL DE CALIDAD Y TRAZABILIDAD

### 4.1. Análisis de Variabilidad
- Evaluá la consistencia entre muestras del mismo tipo
- Identificá causas potenciales de dispersión
- Sugerencias para mejorar uniformidad

### 4.2. Recomendaciones de Ensayos Adicionales
- Ensayos complementarios sugeridos (permeabilidad, módulo de elasticidad, etc.)
- Frecuencia de muestreo óptima

## 5. ANÁLISIS ECONÓMICO ESTIMADO

Para cada optimización propuesta:
- Reducción estimada de cemento (kg/m³)
- Ahorro potencial en materiales
- Mantenimiento o mejora de propiedades mecánicas

## 6. PLAN DE IMPLEMENTACIÓN

### 6.1. Prioridades
Lista de cambios ordenados por impacto (alto/medio/bajo)

### 6.2. Validación
- Dosificaciones de prueba recomendadas
- Criterios de aceptación
- Cronograma sugerido de implementación

## 7. CONCLUSIONES Y RECOMENDACIONES FINALES

Resumen de las acciones clave con mayor impacto técnico y económico.

---

**IMPORTANTE:**
- Usá valores numéricos específicos de las dosificaciones proporcionadas
- Calculá las relaciones agua/cemento reales
- Basá tus recomendaciones en normativa vigente (IRAM, CIRSOC)
- Justificá técnicamente cada propuesta
- Sé específico: "reducir cemento de 310 a 285 kg/m³" en lugar de "reducir cemento"
- Considerá que el cemento CPF-40 es un cemento filler de resistencia 40 MPa
- Evaluá la eficiencia del aditivo Dynamon XTend W247 R según su dosis
- Analizá la distribución granulométrica según módulos de finura reportados`}
                    data={aiPromptData}
                  />
                </div>

                {/* Recursos MVP Fase D: aviso si hay ensayos con trazabilidad
                    débil (sin calibración del equipo aplicada en el momento del
                    ensayo, ISO 17025 §6.4.7). El backend cuenta en
                    `trazabilidadCalibracion` por lote. Visible solo si hay
                    al menos un ensayo afectado. */}
                {(() => {
                  const totalSinCal = mainData.reduce(
                    (acc, r) => acc + (r.trazabilidadCalibracion?.sinCalibracionAplicada || 0), 0
                  );
                  const totalEnsayos = mainData.reduce(
                    (acc, r) => acc + (r.trazabilidadCalibracion?.totalEnsayos || 0), 0
                  );
                  if (totalSinCal === 0) return null;
                  const pct = totalEnsayos > 0 ? ((totalSinCal / totalEnsayos) * 100).toFixed(1) : '?';
                  return (
                    <div className="mb-3" style={{
                      // Antes: background var(--orange-50) — casi blanco;
                      // en dark mode el texto quedaba ilegible. RGBA con
                      // opacidad media + color de texto explícito.
                      border: '1px solid var(--orange-500)',
                      borderLeft: '4px solid var(--orange-500)',
                      borderRadius: 6,
                      padding: '0.75rem 1rem',
                      background: 'rgba(249, 115, 22, 0.15)',
                      color: 'var(--text-color)',
                    }}>
                      <div style={{ fontWeight: 600, marginBottom: 4 }}>
                        <i className="fa-solid fa-triangle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                        Trazabilidad de calibración — ISO 17025 §6.4.7
                      </div>
                      <div className="text-sm">
                        <strong>{totalSinCal}</strong> de <strong>{totalEnsayos}</strong> ensayo{totalEnsayos !== 1 ? 's' : ''} ({pct}%) se realizaron con un equipo <strong>sin calibración vigente</strong> al momento del ensayo. Estos resultados conservan validez operativa pero tienen trazabilidad débil para auditoría externa.
                      </div>
                      <details className="mt-2 text-sm">
                        <summary style={{ cursor: 'pointer' }}>Ver desglose por lote</summary>
                        <ul className="m-0 pl-4 mt-1">
                          {mainData
                            .filter((r) => (r.trazabilidadCalibracion?.sinCalibracionAplicada || 0) > 0)
                            .map((r) => (
                              <li key={`tc-${r.tipoHormigon}`}>
                                <strong>{r.tipoHormigon}</strong>: {r.trazabilidadCalibracion.sinCalibracionAplicada} de {r.trazabilidadCalibracion.totalEnsayos} ensayos sin calibración aplicada.
                                {r.trazabilidadCalibracion.probetasSinCalibracion?.length > 0 && (
                                  <span style={{ color: 'var(--text-color-secondary)' }}>
                                    {' '}· Probetas: {r.trazabilidadCalibracion.probetasSinCalibracion.join(', ')}
                                  </span>
                                )}
                              </li>
                            ))}
                        </ul>
                      </details>
                    </div>
                  );
                })()}

                {/* RES-12: probetas / muestreos excluidos del cálculo, con
                    cita normativa. Mientras la tabla principal muestra los
                    veredictos del lote ya filtrado, esta sección expone qué
                    quedó afuera y por qué — para auditoría y trazabilidad. */}
                {(() => {
                  const totalInvalidas = mainData.reduce(
                    (acc, r) => acc + (r.muestrasInvalidas?.length || 0), 0
                  );
                  const totalDescartados = mainData.reduce(
                    (acc, r) => acc + (r.muestreosDescartados?.length || 0), 0
                  );
                  if (totalInvalidas === 0 && totalDescartados === 0) return null;
                  return (
                    <details className="res-excluded-panel mb-4" style={{
                      border: '1px solid var(--surface-border)',
                      borderRadius: 6,
                      padding: '0.75rem 1rem',
                      background: 'var(--surface-section, transparent)',
                    }}>
                      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
                        <i className="fa-solid fa-circle-exclamation mr-2" style={{ color: 'var(--orange-500)' }} />
                        Probetas excluidas del cálculo del lote
                        {' '}
                        <span style={{ fontWeight: 400, color: 'var(--text-color-secondary)' }}>
                          ({totalInvalidas + totalDescartados} ítem{(totalInvalidas + totalDescartados) !== 1 ? 's' : ''})
                        </span>
                      </summary>
                      <div className="mt-2 text-sm" style={{ lineHeight: 1.5 }}>
                        {totalInvalidas > 0 && (
                          <div className="mb-3">
                            <strong>Muestras con n &lt; 2 probetas (CIRSOC §6.1.6.1 / IRAM 1666):</strong>
                            <ul className="m-0 pl-4 mt-1">
                              {mainData.flatMap((r) =>
                                (r.muestrasInvalidas || []).map((m, i) => (
                                  <li key={`mi-${r.tipoHormigon}-${i}`}>
                                    <strong>{r.tipoHormigon}</strong> — Muestra #{m.idMuestra}: solo {m.cantidadProbetas ?? 0} probeta(s) — descartada del cálculo del lote.
                                  </li>
                                ))
                              )}
                            </ul>
                          </div>
                        )}
                        {totalDescartados > 0 && (
                          <div>
                            <strong>Warnings de consistencia (asentamiento fuera de tolerancia, etc.):</strong>
                            <ul className="m-0 pl-4 mt-1">
                              {mainData.flatMap((r) =>
                                (r.muestreosDescartados || []).map((w, i) => (
                                  <li key={`md-${r.tipoHormigon}-${i}`}>
                                    <strong>{r.tipoHormigon}</strong> — Muestra #{w.idMuestra}
                                    {w.idProbeta ? ` / Probeta #${w.idProbeta}` : ''}: {w.motivo}
                                    {w.sugerencia && <span style={{ color: 'var(--text-color-secondary)' }}> · sugerencia: {w.sugerencia}</span>}
                                  </li>
                                ))
                              )}
                            </ul>
                          </div>
                        )}
                      </div>
                    </details>
                  );
                })()}

                {/* Card de Tabla */}
                <div className="res-table-card mb-6">
                  <div className="res-table-header">
                    <h3 className="res-table-title">
                      <i className="fa-solid fa-table res-table-title-icon" />
                      Detalle estadístico
                    </h3>
                    <span className="res-table-count">
                      {sortedData.length} registro{sortedData.length !== 1 ? 's' : ''}
                    </span>
                  </div>
                  <div className="res-datatable">
                    <DataTable
                      value={sortedData}
                      scrollable
                      paginator
                      rows={20}
                      rowsPerPageOptions={[10, 20, 50, 100]}
                      first={tableFirst}
                      onPage={(e) => setTableFirst(e.first)}
                      onSort={(e) => {
                        setSortField(e.sortField);
                        setSortOrder(e.sortOrder);
                      }}
                      sortField={sortField}
                      sortOrder={sortOrder}
                      responsiveLayout="scroll"
                    >
                      {visibleColumns.includes("tipoHormigon") && (
                        <Column
                          field="tipoHormigon"
                          header="Tipo de H°"
                          sortable
                        />
                      )}
                      {visibleColumns.includes("resistencia_media") && (
                        <Column
                          field="resistencia_media"
                          header="Resist. Media"
                          sortable
                        />
                      )}
                      {visibleColumns.includes("caracteristica") && (
                        <Column
                          field="caracteristica"
                          header="Resist. Caract."
                          sortable
                        />
                      )}
                      {visibleColumns.includes("desviacion_estandar") && (
                        <Column
                          field="desviacion_estandar"
                          header="Desviación"
                          sortable
                          body={(row) => (
                            // RES-02: si σ es referencial (n<15, CIRSOC §6.2.3.4)
                            // marcamos con asterisco para no usarla como valor
                            // estadístico normativo silenciosamente.
                            <span title={row.desviacionReferencial
                              ? "σ referencial: n < 15 muestras, sin valor estadístico normativo (CIRSOC §6.2.3.4)."
                              : undefined}>
                              {row.desviacion_estandar}
                              {row.desviacionReferencial ? '*' : ''}
                            </span>
                          )}
                        />
                      )}
                      {visibleColumns.includes("minima") && (
                        <Column
                          field="minima"
                          header="Resist. Mín."
                          sortable
                        />
                      )}
                      {visibleColumns.includes("maxima") && (
                        <Column
                          field="maxima"
                          header="Resist. Máx."
                          sortable
                        />
                      )}
                      {visibleColumns.includes("resistencia_diseno") && (
                        <Column
                          field="resistencia_diseno"
                          header="Resist. Objetivo"
                          sortable
                        />
                      )}
                      {visibleColumns.includes("cumpleLote") && (
                        <Column
                          field="cumpleLote"
                          header="Cumple Lote"
                          sortable
                          body={(rowData) => boolCellTemplate(rowData.cumpleLote)}
                        />
                      )}
                      {visibleColumns.includes("cumpleCirsocM1") && (
                        <Column
                          field="cumpleCirsocM1"
                          header="Cumple CIRSOC M1"
                          sortable
                          body={(rowData) => {
                            // RES-02: tooltip con vía aplicada (§6.2.3.7
                            // estimadores vs §6.2.3.8 estadística) + condiciones
                            // crudas de M1 (condMM1, condInd1) + sub-dimensión
                            // del lote (n<5 §6.2.2.4) si corresponde.
                            const d = rowData.detalleM1 || {};
                            const partes = [];
                            if (d.via) partes.push(`Vía: ${d.via}`);
                            if (d.condMM1 != null) partes.push(`prom3 ≥ f'c: ${d.condMM1 ? 'sí' : 'no'}`);
                            if (d.condInd1 != null) partes.push(`indiv ≥ f'c−tol: ${d.condInd1 ? 'sí' : 'no'}`);
                            if (rowData.loteSubdimensionado) partes.push('n<5 §6.2.2.4: lote sub-dimensionado');
                            const tip = partes.length ? partes.join(' · ') : undefined;
                            return (
                              <span title={tip} style={{ display: 'inline-flex', gap: 4, alignItems: 'center' }}>
                                {boolCellTemplate(rowData.cumpleCirsocM1)}
                                {rowData.loteSubdimensionado && (
                                  <span style={{
                                    fontSize: '0.7em',
                                    background: 'var(--orange-100, #ffe0b2)',
                                    color: 'var(--orange-900, #7a4a00)',
                                    padding: '1px 4px',
                                    borderRadius: 3,
                                    fontWeight: 600,
                                  }}>n&lt;5</span>
                                )}
                              </span>
                            );
                          }}
                        />
                      )}
                      {visibleColumns.includes("cumpleCirsocM2") && (
                        <Column
                          field="cumpleCirsocM2"
                          header="Cumple CIRSOC M2"
                          sortable
                          body={(rowData) => boolCellTemplate(rowData.cumpleCirsocM2)}
                        />
                      )}
                      {visibleColumns.includes("tamanoLote") && (
                        <Column
                          field="tamanoLote"
                          header="Tam. del Lote"
                          sortable
                        />
                      )}
                      {visibleColumns.includes("cliente") && (
                        <Column field="cliente" header="Cliente" sortable />
                      )}
                      {visibleColumns.includes("idDosificacion") && (
                        <Column
                          field="dosificacionNombre"
                          header="Dosificación"
                          sortable
                          body={(row) => row.dosificacionNombre || (row.idDosificacion ? `ID ${row.idDosificacion}` : "\u2014")}
                        />
                      )}
                      {visibleColumns.includes("obra") && (
                        <Column field="obra" header="Obra" sortable />
                      )}
                      {visibleColumns.includes("planta") && (
                        <Column field="planta" header="Planta" sortable />
                      )}
                    </DataTable>
                  </div>
                </div>
              </>
            ) : (
              <div className="res-empty-state">
                <div className="res-empty-state-icon">
                  <i className="fa-solid fa-inbox" />
                </div>
                <h2 className="res-empty-state-title">
                  No hay datos disponibles
                </h2>
                <p className="res-empty-state-text">
                  No se encontraron registros con los filtros seleccionados. Probá ajustando los criterios de búsqueda.
                </p>
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
};

export default ReportResistencias;
