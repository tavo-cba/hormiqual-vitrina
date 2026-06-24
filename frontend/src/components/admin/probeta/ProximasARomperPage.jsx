import React, { useEffect, useMemo, useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Fade } from "react-awesome-reveal";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDate } from "../../../common/functions";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import QrScanner from "../../../common/components/QrScanner/QrScanner";
import { ESTADO_PROBETA_LABEL, ESTADO_PROBETA_CLASS } from "../../../lib/constants/estadoProbeta";
import "./probeta.css";

/**
 * N-05 (auditoría 08, Bloque 7): vista de planificación diaria del
 * laboratorio. Muestra probetas que tienen fecha de rotura prevista
 * dentro del rango configurado, agrupadas por día y por planta.
 *
 * Acción rápida "Romper" lleva al formulario de edición de probeta para
 * cargar el ensayo.
 */
const RANGO_OPCIONES = [
  { label: 'Hoy',           value: 1 },
  { label: 'Próximos 3 días', value: 3 },
  { label: 'Próximos 7 días', value: 7 },
  { label: 'Próximos 14 días', value: 14 },
  { label: 'Próximos 30 días', value: 30 },
];

const ProximasARomperPage = () => {
  const [data, setData] = useState({ porDia: [], total: 0 });
  const [loading, setLoading] = useState(false);
  const [dias, setDias] = useState(7);
  // N-01 (Bloque 22) — scanner QR para confirmar identidad de la probeta
  // antes de romper. Es el use case principal definido con el user.
  const [qrScannerOpen, setQrScannerOpen] = useState(false);
  const navigate = useNavigate();
  const toast = useToast();
  const { user } = useUserContext();

  const visiblePlantaIds = useMemo(() => {
    if (user?.plantaIds?.length) return user.plantaIds.map(Number);
    if (user?.allPlantas?.length) return user.allPlantas.map((p) => Number(p.idPlanta));
    return [];
  }, [user]);

  const cargar = async () => {
    try {
      setLoading(true);
      const { data: res } = await axios.get(
        `${config.backendUrl}/api/probetas/proximas-a-romper?dias=${dias}`,
        { headers: config.headers }
      );
      setData(res);
    } catch (err) {
      console.error('Error cargando probetas próximas:', err);
      toast('error', 'No se pudieron cargar las probetas próximas a romper');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); }, [dias]);

  const irARomper = (idProbeta) => {
    navigate(`/calidad/ensayos/probetas/editar/${idProbeta}`);
  };

  // Filtro de planta por usuario (también lo aplica el backend, pero acá
  // ocultamos plantas a las que el user no tiene acceso por si el backend
  // las devolvió por error).
  const porDiaVisible = useMemo(() => {
    if (!visiblePlantaIds.length) return data.porDia;
    return data.porDia
      .map((dia) => ({
        ...dia,
        plantas: dia.plantas.filter((pl) => !pl.idPlanta || visiblePlantaIds.includes(pl.idPlanta)),
      }))
      .filter((dia) => dia.plantas.length > 0);
  }, [data.porDia, visiblePlantaIds]);

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
        <div className="flex w-full justify-content-between align-items-center flex-wrap gap-2">
          <PageHeader
            icon="fa-solid fa-calendar-day"
            title="Próximas a romper"
            subtitle={`${data.total} probeta(s) en el rango seleccionado`}
          />
          <div className="flex gap-2 align-items-center">
            <Button
              label="Escanear QR"
              icon="fa-solid fa-camera"
              outlined
              severity="info"
              onClick={() => setQrScannerOpen(true)}
              tooltip="Escanear etiqueta de probeta para confirmar identidad antes de romper"
              tooltipOptions={{ position: 'top' }}
            />
            <Dropdown
              value={dias}
              onChange={(e) => setDias(e.value)}
              options={RANGO_OPCIONES}
              className="w-full md:w-15rem br-7"
            />
          </div>
        </div>

        {porDiaVisible.length === 0 && (
          <div className="form-card p-4 br-15 w-full text-center">
            <i className="fa-solid fa-circle-check mb-2" style={{ fontSize: '2rem', color: 'var(--green-500)' }} />
            <p className="m-0">Sin probetas pendientes de rotura en el rango seleccionado.</p>
          </div>
        )}

        {porDiaVisible.map((dia) => (
          <Card
            key={dia.fecha}
            title={
              <div className="flex align-items-center gap-2">
                <i className="fa-solid fa-calendar" />
                <span>{formatDate(dia.fecha)}</span>
                <span className="ml-auto text-500" style={{ fontSize: '0.85rem', fontWeight: 'normal' }}>
                  {dia.plantas.reduce((acc, pl) => acc + pl.probetas.length, 0)} probeta(s)
                </span>
              </div>
            }
            className="w-full mb-3"
          >
            {dia.plantas.map((pl) => (
              <div key={pl.idPlanta} className="mb-3">
                <h5 className="m-0 mb-2">
                  <i className="fa-solid fa-industry mr-2" />{pl.nombre}
                </h5>
                <div className="flex flex-column gap-2">
                  {pl.probetas.map((p) => (
                    <div
                      key={p.idProbeta}
                      className="flex align-items-center justify-content-between p-2 br-7"
                      style={{ borderBottom: '1px solid var(--surface-border)' }}
                    >
                      <div className="flex flex-column">
                        <span className="font-bold">
                          {p.nombre || `Probeta #${p.idProbeta}`}
                          {p.esPaston && (
                            <span
                              className="probeta-paston-badge ml-2"
                              title={`Probeta de pastón de prueba${p.pastonOrigen ? ` (${p.pastonOrigen === 'OBRA' ? 'en obra' : 'en planta'})` : ''}`}
                            >
                              <i className="fa-solid fa-vials mr-1" />Pastón
                            </span>
                          )}
                        </span>
                        <span className="text-500" style={{ fontSize: '0.85rem' }}>
                          {p.tipoHormigon || '—'} · {p.cliente || '—'} · {p.obra || 'Sin obra'} · {p.diasRotura} días
                        </span>
                      </div>
                      <div className="flex align-items-center gap-2">
                        <span className={ESTADO_PROBETA_CLASS[p.idEstadoProbeta] || 'estado-badge'}>
                          {ESTADO_PROBETA_LABEL[p.idEstadoProbeta] || '-'}
                        </span>
                        <Button
                          icon="fa-solid fa-flask-vial"
                          label="Romper"
                          size="small"
                          onClick={() => irARomper(p.idProbeta)}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </Card>
        ))}
      </div>

      {/* N-01 (Bloque 22): scanner interno con cámara, evita el error que
          el user reportó con el lector nativo del teléfono. Si el QR contiene
          una URL del mismo origen → navegación interna. */}
      <QrScanner
        visible={qrScannerOpen}
        onClose={() => setQrScannerOpen(false)}
        onScan={(text) => {
          setQrScannerOpen(false);
          try {
            const url = new URL(text);
            if (url.origin === window.location.origin) {
              navigate(`${url.pathname}${url.search}${url.hash}`);
              return;
            }
            window.open(text, '_blank', 'noopener,noreferrer');
          } catch {
            const idNum = Number(String(text).trim());
            if (Number.isFinite(idNum) && idNum > 0) {
              navigate(`/calidad/ensayos/probetas?detail=${idNum}`);
            } else {
              toast('warn', `QR no reconocido: ${String(text).slice(0, 60)}`);
            }
          }
        }}
      />
    </Fade>
  );
};

export default ProximasARomperPage;
