import React, { useEffect, useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Fade } from "react-awesome-reveal";
import { useNavigate } from "react-router-dom";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import axios from "axios";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import "./EtiquetadoProbetasDocPage.css";

/**
 * N-01 etiqueta QR (sesión 2026-05-09) — vista del procedimiento
 * operativo de etiquetado de probetas.
 *
 * El contenido se carga desde el backend (`GET /api/docs/etiquetado-probetas`)
 * para mantener UNA sola fuente de verdad: el .md versionado en
 * `hormiqual-backend/docs/etiquetado-probetas.md`. Si la doc se actualiza,
 * la app muestra la versión nueva sin re-deploy del frontend.
 */
const EtiquetadoProbetasDocPage = () => {
  const [titulo, setTitulo] = useState("Procedimiento operativo");
  const [contenido, setContenido] = useState("");
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();
  const toast = useToast();

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const { data } = await axios.get(
          `${config.backendUrl}/api/docs/etiquetado-probetas`,
          { headers: config.headers }
        );
        if (cancelled) return;
        setTitulo(data?.titulo || "Procedimiento operativo");
        setContenido(data?.contenido || "");
      } catch (err) {
        if (cancelled) return;
        console.error("Error cargando documento:", err);
        const msg = err.response?.status === 403
          ? "No tenés permisos para ver este documento."
          : "No se pudo cargar el documento.";
        toast("error", msg);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [toast]);

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
        <PageHeader
          icon="fa-solid fa-book"
          title={titulo}
          subtitle="Guía de etiquetado físico de probetas con QR"
        />

        <Card className="w-full">
          <div className="flex justify-content-between align-items-center mb-3 flex-wrap gap-2">
            <Button
              label="Volver"
              icon="fa-solid fa-arrow-left"
              outlined
              severity="secondary"
              onClick={() => {
                if (window.history.length > 1) window.history.back();
                else navigate('/calidad/ensayos/probetas');
              }}
            />
            <Button
              label="Etiquetas pendientes"
              icon="fa-solid fa-tag"
              outlined
              onClick={() => navigate('/calidad/ensayos/probetas/etiquetas-pendientes')}
            />
          </div>

          {loading ? (
            <div className="flex justify-content-center p-5">
              <LoadSpinner />
            </div>
          ) : (
            <div className="markdown-doc px-2" style={{ maxWidth: '900px', margin: '0 auto' }}>
              <ReactMarkdown remarkPlugins={[remarkGfm]}>
                {contenido || '_(documento vacío)_'}
              </ReactMarkdown>
            </div>
          )}
        </Card>
      </div>
    </Fade>
  );
};

export default EtiquetadoProbetasDocPage;
