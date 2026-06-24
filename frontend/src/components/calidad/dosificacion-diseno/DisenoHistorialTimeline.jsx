import React, { useMemo, useState } from "react";
import { Tag } from "primereact/tag";
import { Button } from "primereact/button";
import { Checkbox } from "primereact/checkbox";

/**
 * Timeline de eventos de auditoría (Fase 4.3).
 *
 * Acepta dos shapes para retrocompatibilidad:
 *   - Array de registros crudos de DisenoHistorial (legacy).
 *   - Array de eventos enriquecidos (Fase 4.2: `{label, categoria, icon, color, destacado, ...}`).
 *
 * Filosofía: el timeline es el control central. Los eventos destacados
 * (auto-aprobaciones, override de pastón, redosificaciones) se resaltan
 * con banner amarillo para que el auditor los detecte de un vistazo.
 *
 * Funcionalidades:
 *   - Filtro "Solo destacados" para revisar concentraciones rápidamente.
 *   - Filtro por categoría (estado / técnico / obra / auditoría).
 *   - Export a CSV para auditoría externa.
 */

// Configuración fallback para records legacy sin label/icon (timelines previos
// a Fase 4.2 ya enriquecidos por backend). Mantener sincronizado con
// hormiqual-backend/src/domain/dosificacion/historialPresentacion.js
const FALLBACK_CONFIG = {
  creacion:               { label: "Creación",                 icon: "fa-solid fa-plus",                  color: "#2196F3" },
  modificacion:           { label: "Modificación",             icon: "fa-solid fa-pen",                   color: "#FF9800" },
  calculo:                { label: "Cálculo",                  icon: "fa-solid fa-calculator",            color: "#9C27B0" },
  cambio_estado:          { label: "Cambio de estado",         icon: "fa-solid fa-arrows-rotate",         color: "#607D8B" },
  nueva_version:          { label: "Nueva versión",            icon: "fa-solid fa-code-branch",           color: "#00BCD4" },
  nueva_ronda_prueba:     { label: "Nueva ronda de prueba",    icon: "fa-solid fa-rotate-right",          color: "#3F51B5" },
  aprobacion:             { label: "Aprobación",               icon: "fa-solid fa-check-circle",          color: "#4CAF50" },
  rechazo:                { label: "Rechazo",                  icon: "fa-solid fa-times-circle",          color: "#F44336" },
  suspension:             { label: "Suspensión",               icon: "fa-solid fa-pause-circle",          color: "#F44336" },
  reactivacion:           { label: "Reactivación",             icon: "fa-solid fa-play-circle",           color: "#4CAF50" },
  archivado:              { label: "Archivado",                icon: "fa-solid fa-archive",               color: "#9E9E9E" },
  correccion_aplicada:    { label: "Corrección aplicada",      icon: "fa-solid fa-screwdriver-wrench",    color: "#FF7043" },
  redosificacion_obra:    { label: "Redosificación en obra",   icon: "fa-solid fa-truck-droplet",         color: "#795548" },
  alerta_resuelta:        { label: "Alerta resuelta",          icon: "fa-solid fa-bell-slash",            color: "#9E9E9E" },
  override_paston:        { label: "Override de pastón",       icon: "fa-solid fa-shield-halved",         color: "#E91E63" },
};

const ESTADO_LABELS = {
  BORRADOR: "Borrador",
  A_PRUEBA: "A prueba",
  PENDIENTE_REVISION: "Pendiente revisión",
  EN_PRODUCCION: "En producción",
  APROBADO: "Aprobado",
  SUSPENDIDO: "Suspendido",
  ARCHIVADO: "Archivado",
  DESCARTADO: "Descartado",
};

const ESTADO_SEV = {
  BORRADOR: "info",
  A_PRUEBA: "warning",
  PENDIENTE_REVISION: "warning",
  EN_PRODUCCION: "success",
  APROBADO: "success",
  SUSPENDIDO: "danger",
  ARCHIVADO: "secondary",
  DESCARTADO: "secondary",
};

const CATEGORIA_LABEL = {
  estado: "Estado",
  tecnico: "Técnico",
  obra: "Obra",
  auditoria: "Auditoría",
};

const CATEGORIA_SEV = {
  estado: "info",
  tecnico: "warning",
  obra: "secondary",
  auditoria: "secondary",
};

function formatFecha(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("es-AR", {
    day: "2-digit", month: "2-digit", year: "numeric",
    hour: "2-digit", minute: "2-digit",
  });
}

/**
 * Normaliza un evento (sea legacy o enriquecido) al shape interno del Timeline.
 */
function normalizarEvento(raw) {
  if (!raw) return null;
  const tipo = raw.tipoEvento || "cambio_estado";
  const fallback = FALLBACK_CONFIG[tipo] || FALLBACK_CONFIG.cambio_estado;
  return {
    id: raw.id,
    timestamp: raw.timestamp || raw.createdAt || null,
    tipoEvento: tipo,
    label: raw.label || fallback.label,
    icon: raw.icon || fallback.icon,
    color: raw.color || fallback.color,
    categoria: raw.categoria || "auditoria",
    estadoAnterior: raw.estadoAnterior || null,
    estadoNuevo: raw.estadoNuevo || null,
    usuario: raw.usuario || null,
    motivo: raw.motivo || null,
    observaciones: raw.observaciones || null,
    hashAlMomento: raw.hashAlMomento || null,
    hashAlMomentoCorto: raw.hashAlMomentoCorto || (raw.hashAlMomento ? String(raw.hashAlMomento).substring(0, 16) : null),
    metadata: raw.metadata || null,
    destacado: raw.destacado === true,
  };
}

function metadataPreview(metadata) {
  if (!metadata) return null;
  const flags = Array.isArray(metadata.flags) ? metadata.flags : [];
  const firmadoPor = metadata.firmadoPor;
  const firmaConcentrada = metadata.firmaConcentrada === true;
  const tipoAccion = metadata.tipoAccion;
  const cantidad = metadata.cantidad;
  const unidad = metadata.unidad;
  const etapa = metadata.etapa;
  const accion = metadata.accion;
  const cantidadCorrecciones = metadata.cantidadCorrecciones;
  const partes = [];
  if (flags.length > 0) partes.push(...flags);
  if (firmadoPor) partes.push(`Firmante: ${firmadoPor}${firmaConcentrada ? " (concentrada)" : ""}`);
  if (tipoAccion) partes.push(`${tipoAccion}${cantidad != null ? ` ${cantidad}${unidad ? ` ${unidad}` : ""}` : ""}${etapa ? ` (${etapa})` : ""}`);
  if (accion === "editar") partes.push("Edición");
  if (accion === "eliminar") partes.push("Eliminación");
  if (cantidadCorrecciones) partes.push(`${cantidadCorrecciones} corrección(es)`);
  return partes.length ? partes.join(" · ") : null;
}

function exportarCSV(eventos, dosifLabel = "dosificacion") {
  const cabecera = [
    "id", "timestamp", "categoria", "tipoEvento", "label",
    "estadoAnterior", "estadoNuevo", "usuario",
    "motivo", "observaciones", "hashAlMomento",
    "destacado", "flags",
  ].join(",");
  const escape = (v) => {
    if (v == null) return "";
    const s = String(v).replace(/"/g, '""');
    return `"${s}"`;
  };
  const lineas = eventos.map((e) => {
    const flags = Array.isArray(e.metadata?.flags) ? e.metadata.flags.join("|") : "";
    return [
      e.id, e.timestamp || "", e.categoria, e.tipoEvento, e.label,
      e.estadoAnterior || "", e.estadoNuevo || "", e.usuario || "",
      e.motivo || "", e.observaciones || "", e.hashAlMomento || "",
      e.destacado ? "true" : "false", flags,
    ].map(escape).join(",");
  });
  const csv = [cabecera, ...lineas].join("\n");
  const blob = new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  const ts = new Date().toISOString().replace(/[:.]/g, "-").substring(0, 19);
  link.download = `historial-${dosifLabel}-${ts}.csv`;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

function TimelineEvent({ event, isLast }) {
  const destacado = event.destacado;
  const preview = metadataPreview(event.metadata);

  return (
    <div className="flex gap-3" style={{ minHeight: isLast ? "auto" : "70px" }}>
      {/* Marker + line */}
      <div className="flex flex-column align-items-center" style={{ width: "32px", flexShrink: 0 }}>
        <div
          className="flex align-items-center justify-content-center border-circle"
          style={{
            width: "32px", height: "32px",
            backgroundColor: event.color,
            color: "#fff",
            fontSize: "0.85rem",
            flexShrink: 0,
            boxShadow: destacado ? "0 0 0 3px rgba(245,158,11,0.35)" : "none",
          }}
          title={event.label}
        >
          <i className={event.icon} />
        </div>
        {!isLast && (
          <div style={{ width: "2px", flex: 1, backgroundColor: "var(--surface-border)", minHeight: "20px" }} />
        )}
      </div>

      {/* Content */}
      <div className="flex-1 pb-3">
        <div className="flex align-items-center gap-2 flex-wrap">
          <span className="font-semibold text-sm">{event.label}</span>
          {event.categoria && (
            <Tag
              value={CATEGORIA_LABEL[event.categoria] || event.categoria}
              severity={CATEGORIA_SEV[event.categoria] || "secondary"}
              className="text-xs"
              style={{ fontSize: "0.65rem" }}
            />
          )}
          {destacado && (
            <Tag
              value="Auditar"
              severity="warning"
              icon="fa-solid fa-flag"
              className="text-xs"
              style={{ fontSize: "0.65rem" }}
            />
          )}
          {event.estadoAnterior && event.estadoNuevo && (
            <span className="flex align-items-center gap-1 text-xs">
              <Tag value={ESTADO_LABELS[event.estadoAnterior] || event.estadoAnterior} severity={ESTADO_SEV[event.estadoAnterior] || "secondary"} className="text-xs" style={{ fontSize: "0.7rem" }} />
              <i className="fa-solid fa-arrow-right text-color-secondary" style={{ fontSize: "0.6rem" }} />
              <Tag value={ESTADO_LABELS[event.estadoNuevo] || event.estadoNuevo} severity={ESTADO_SEV[event.estadoNuevo] || "secondary"} className="text-xs" style={{ fontSize: "0.7rem" }} />
            </span>
          )}
          {!event.estadoAnterior && event.estadoNuevo && (
            <Tag value={ESTADO_LABELS[event.estadoNuevo] || event.estadoNuevo} severity={ESTADO_SEV[event.estadoNuevo] || "secondary"} className="text-xs" style={{ fontSize: "0.7rem" }} />
          )}
        </div>
        <div className="text-xs text-color-secondary mt-1">
          {formatFecha(event.timestamp)}
          {event.usuario && <span className="ml-2">por <b>{event.usuario}</b></span>}
        </div>
        {preview && (
          <div
            className="text-xs mt-1 p-1 border-round inline-block"
            style={{
              background: destacado ? "rgba(245,158,11,0.10)" : "var(--surface-50, var(--surface-ground))",
              border: destacado ? "1px solid rgba(245,158,11,0.4)" : "1px solid transparent",
              maxWidth: "100%",
              wordBreak: "break-word",
            }}
          >
            <i className="fa-solid fa-info-circle mr-1 text-color-secondary" style={{ fontSize: "0.6rem" }} />
            {preview}
          </div>
        )}
        {event.motivo && (
          <div className="text-sm mt-1 p-2 surface-ground border-round">
            <i className="fa-solid fa-quote-left text-color-secondary mr-1" style={{ fontSize: "0.6rem" }} />
            {event.motivo}
          </div>
        )}
        {event.observaciones && (
          <div className="text-xs text-color-secondary mt-1">{event.observaciones}</div>
        )}
        {event.hashAlMomentoCorto && (
          <div className="text-xs mt-1">
            <i className="fa-solid fa-fingerprint mr-1 text-color-secondary" />
            <span className="font-mono">{event.hashAlMomentoCorto}…</span>
          </div>
        )}
      </div>
    </div>
  );
}

export default function DisenoHistorialTimeline({ historial, resumen, dosifLabel }) {
  const [soloDestacados, setSoloDestacados] = useState(false);
  const [filtroCategoria, setFiltroCategoria] = useState(null);

  const eventos = useMemo(
    () => (Array.isArray(historial) ? historial.map(normalizarEvento).filter(Boolean) : []),
    [historial]
  );

  const eventosFiltrados = useMemo(() => {
    return eventos.filter((e) => {
      if (soloDestacados && !e.destacado) return false;
      if (filtroCategoria && e.categoria !== filtroCategoria) return false;
      return true;
    });
  }, [eventos, soloDestacados, filtroCategoria]);

  if (!eventos.length) {
    return (
      <div className="text-color-secondary text-sm p-3 text-center">
        <i className="fa-solid fa-clock-rotate-left mr-2" />
        No hay eventos registrados.
      </div>
    );
  }

  const totalDestacados = resumen?.destacados ?? eventos.filter((e) => e.destacado).length;
  const categorias = ["estado", "tecnico", "obra", "auditoria"];

  return (
    <div className="flex flex-column">
      {/* Toolbar */}
      <div className="flex align-items-center gap-2 flex-wrap p-2 mb-2 border-round surface-100" style={{ background: "var(--surface-50, var(--surface-100))" }}>
        <div className="flex align-items-center gap-1 text-xs">
          <Checkbox
            inputId="solo-destacados"
            checked={soloDestacados}
            onChange={(e) => setSoloDestacados(e.checked)}
          />
          <label htmlFor="solo-destacados" style={{ cursor: "pointer", userSelect: "none" }}>
            Solo destacados
          </label>
          {totalDestacados > 0 && (
            <Tag value={totalDestacados} severity="warning" className="ml-1" style={{ fontSize: "0.6rem" }} />
          )}
        </div>

        <div className="flex align-items-center gap-1">
          {categorias.map((cat) => (
            <Button
              key={cat}
              label={CATEGORIA_LABEL[cat]}
              size="small"
              outlined={filtroCategoria !== cat}
              severity={CATEGORIA_SEV[cat] || "secondary"}
              onClick={() => setFiltroCategoria(filtroCategoria === cat ? null : cat)}
              style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
            />
          ))}
        </div>

        <div className="ml-auto text-xs text-color-secondary">
          {eventosFiltrados.length} de {eventos.length} eventos
        </div>

        <Button
          icon="fa-solid fa-file-csv"
          label="CSV"
          size="small"
          outlined
          severity="secondary"
          onClick={() => exportarCSV(eventosFiltrados, dosifLabel || "dosificacion")}
          style={{ fontSize: "0.7rem", padding: "0.25rem 0.5rem" }}
          tooltip="Exportar timeline filtrado a CSV"
          tooltipOptions={{ position: "top" }}
        />
      </div>

      {/* Eventos */}
      <div className="flex flex-column p-2">
        {eventosFiltrados.length === 0 ? (
          <div className="text-color-secondary text-sm p-3 text-center">
            No hay eventos que coincidan con los filtros.
          </div>
        ) : (
          eventosFiltrados.map((event, idx) => (
            <TimelineEvent
              key={event.id || idx}
              event={event}
              isLast={idx === eventosFiltrados.length - 1}
            />
          ))
        )}
      </div>
    </div>
  );
}
