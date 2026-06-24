import React, { useEffect, useMemo, useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { InputNumber } from "primereact/inputnumber";
import { Calendar } from "primereact/calendar";
import { Tag } from "primereact/tag";
import { Fade } from "react-awesome-reveal";
import axios from "axios";
import { config } from "../../../config/config";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import { useConfig } from "../../../context/ConfigContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { dateToYMDLocal } from "../../../common/functions";

/**
 * N-03 — Página de generación del informe de aceptación de obra/lote.
 *
 * Flujo: el usuario selecciona cliente → obra → dosificación → edad de
 * diseño → rango de fechas. Se hace preview del veredicto y con un click
 * se descarga el PDF (renderizado server-side con HTML→Puppeteer).
 *
 * Decisión de producto: se eliminó el toggle "prestacional/prescriptivo"
 * que existía en versiones previas — la distinción no aplica al ámbito
 * de aceptación de probetas porque f'c es un valor objetivo y medible,
 * no algo que el catálogo del tenant pueda relativizar. Lo que sí se
 * informa son los 3 criterios paralelos M1/M2/IRAM-autocontrol (todos
 * normativos).
 */

const METODOLOGIA_LABEL = {
  lote_estimadores: 'estimadores §6.2.3.7 (3 ≤ n < 30)',
  lote_pleno:       'estadística plena §6.2.3.8 (n ≥ 30)',
  no_aplica_m1:     'no aplica (n < 3)',
  no_aplica:        'no aplica',
};

const VEREDICTO_SEVERITY = {
  APTO:                   'success',
  ACEPTABLE_CON_RESERVAS: 'warning',
  NO_APTO:                'danger',
};

const VEREDICTO_LABEL = {
  APTO:                   'APTO',
  ACEPTABLE_CON_RESERVAS: 'ACEPTABLE CON RESERVAS',
  NO_APTO:                'NO APTO',
};

const InformeAceptacionLotePage = () => {
  const showToast = useToast();
  const { user } = useUserContext();
  const cfgEmpresa = useConfig();

  // Catálogos
  const [clientes, setClientes] = useState([]);
  const [obras, setObras] = useState([]);
  const [dosificaciones, setDosificaciones] = useState([]);

  // Form state
  const [idCliente, setIdCliente] = useState(null);
  const [idObra, setIdObra] = useState(null);
  const [idDosificacion, setIdDosificacion] = useState(null);
  const [edadDiseno, setEdadDiseno] = useState(28);
  const [desde, setDesde] = useState(null);
  const [hasta, setHasta] = useState(null);

  const [loading, setLoading] = useState(false);
  const [data, setData] = useState(null);

  /* ─── Cargar catálogos ─── */
  useEffect(() => {
    (async () => {
      try {
        const [{ data: cli }, { data: obs }, { data: dos }] = await Promise.all([
          axios.get(`${config.backendUrl}/api/clientes`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/obras`, { headers: config.headers }),
          axios.get(`${config.backendUrl}/api/dosificaciones`, { headers: config.headers }),
        ]);
        // Cliente puede ser Jurídica (razonSocial poblado, nombre vacío) o
        // Física (nombre + apellido). El dropdown necesita un displayName
        // unificado — replica el patrón de admin/cliente/cliente.jsx.
        setClientes((cli || []).map((c) => ({
          ...c,
          displayName:
            c.tipoPersona === 'Física'
              ? [c.apellido, c.nombre].filter(Boolean).join(', ') || c.nombre || `#${c.idCliente}`
              : c.razonSocial || c.nombreFantasia || c.nombre || `#${c.idCliente}`,
        })));
        setObras(obs || []);
        setDosificaciones(dos || []);
      } catch (err) {
        console.error('Error cargando catálogos:', err);
        showToast('error', 'No se pudieron cargar los catálogos');
      }
    })();
  }, []);

  /* ─── Filtrar obras por cliente ─── */
  const obrasFiltradas = useMemo(() => {
    if (!idCliente) return obras;
    return obras.filter((o) => o.idCliente === idCliente);
  }, [obras, idCliente]);

  /* ─── Generar preview ─── */
  const generarPreview = async () => {
    if (!idDosificacion) {
      showToast('warn', 'Seleccioná una dosificación para emitir el informe.');
      return;
    }
    if (!edadDiseno) {
      showToast('warn', 'Seleccioná una edad de diseño.');
      return;
    }
    try {
      setLoading(true);
      const body = {
        idCliente,
        idObra,
        idDosificacion,
        edadDiseno,
        desde: dateToYMDLocal(desde),
        hasta: dateToYMDLocal(hasta),
      };
      const { data: res } = await axios.post(
        `${config.backendUrl}/api/probetas/aceptacion-lote`,
        body,
        { headers: config.headers }
      );
      setData(res);
      // M7 (auditoría revisor-civil 2026-05-09): el backend devuelve
      // veredictoGlobal como objeto { codigo, criterio } con la cita
      // normativa del modo aplicado. El toast humaniza solo el código.
      const codigo = res.veredictoGlobal?.codigo ?? res.veredictoGlobal ?? '';
      const veredictoTxt = String(codigo).replace(/_/g, ' ').toLowerCase();
      showToast('success', `Lote evaluado: ${veredictoTxt}`);
    } catch (err) {
      console.error('Error generando preview:', err);
      const msg = err.response?.data?.error || 'No se pudo generar el informe';
      showToast('error', msg);
      setData(null);
    } finally {
      setLoading(false);
    }
  };

  /* ─── Descargar PDF (server-side: HTML+CSS → Puppeteer) ─── */
  const descargarPdf = async () => {
    if (!idDosificacion) {
      showToast('warn', 'Seleccioná una dosificación para emitir el informe.');
      return;
    }
    try {
      setLoading(true);
      const body = {
        idCliente,
        idObra,
        idDosificacion,
        edadDiseno,
        desde: dateToYMDLocal(desde),
        hasta: dateToYMDLocal(hasta),
      };
      const response = await axios.post(
        `${config.backendUrl}/api/probetas/aceptacion-lote/pdf`,
        body,
        { headers: config.headers, responseType: 'blob' }
      );
      const blob = new Blob([response.data], { type: 'application/pdf' });
      const url = URL.createObjectURL(blob);
      // Extraer nombre del header Content-Disposition si vino.
      const cd = response.headers['content-disposition'] || '';
      const match = /filename="([^"]+)"/.exec(cd);
      const filename = match ? match[1] : 'informe-aceptacion-lote.pdf';
      const a = document.createElement('a');
      a.href = url;
      a.download = filename;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
      showToast('success', 'PDF generado');
    } catch (err) {
      console.error('Error generando PDF:', err);
      // El backend manda JSON con error en este caso pero responseType:blob lo wrappea.
      let msg = 'No se pudo generar el PDF';
      if (err.response?.data instanceof Blob) {
        try { msg = JSON.parse(await err.response.data.text()).error || msg; }
        catch { /* ignore */ }
      }
      showToast('error', msg);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="w-full flex flex-column align-items-start xl:p-6 xl:pt-0 xl:pl-0">
        <PageHeader
          icon="fa-solid fa-file-shield"
          title="Informe de aceptación de obra"
          subtitle="CIRSOC 200-2024 §6.2.3 (Modo 1) / §6.2.4 (Modo 2) sobre lote homogéneo"
        />

        {/* PR9 NO aplica acá. El informe de aceptación de obra/lote
            evalúa conformidad contractual con CIRSOC 200-2024 §6.2.3
            (Modo 1) o §6.2.4 (Modo 2): f'c es valor objetivo medible
            y la norma es soberana. El catálogo del tenant NO puede
            relativizar f'c. Cualquier criterio "prestacional" en este
            contexto sería contractualmente nulo. Ver CLAUDE.md raíz
            §"Modelo dual de evaluación". */}

        {/* Form de selección */}
        <Card className="w-full mb-3">
          <div className="grid">
            <div className="col-12 md:col-6 xl:col-4">
              <label className="block mb-1">Cliente</label>
              <Dropdown
                value={idCliente}
                onChange={(e) => { setIdCliente(e.value); setIdObra(null); }}
                options={clientes}
                optionLabel="displayName"
                optionValue="idCliente"
                filter
                showClear
                placeholder="Todos"
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-6 xl:col-4">
              <label className="block mb-1">Obra</label>
              <Dropdown
                value={idObra}
                onChange={(e) => setIdObra(e.value)}
                options={obrasFiltradas}
                optionLabel="nombre"
                optionValue="idObra"
                filter
                showClear
                placeholder="Todas"
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-6 xl:col-4">
              <label className="block mb-1">Dosificación *</label>
              <Dropdown
                value={idDosificacion}
                onChange={(e) => setIdDosificacion(e.value)}
                options={dosificaciones}
                optionLabel="nombre"
                optionValue="idDosificacion"
                filter
                showClear
                placeholder="Obligatorio"
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block mb-1">Edad de diseño *</label>
              <InputNumber
                value={edadDiseno}
                onChange={(e) => setEdadDiseno(e.value)}
                suffix=" días"
                min={1}
                max={365}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block mb-1">Desde</label>
              <Calendar
                value={desde}
                onChange={(e) => setDesde(e.value)}
                dateFormat="dd/mm/yy"
                showIcon
                showOnFocus={false}
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block mb-1">Hasta</label>
              <Calendar
                value={hasta}
                onChange={(e) => setHasta(e.value)}
                dateFormat="dd/mm/yy"
                showIcon
                showOnFocus={false}
                className="w-full"
              />
            </div>
          </div>
          <div className="flex justify-content-end mt-3 gap-2">
            <Button
              icon="fa-solid fa-magnifying-glass"
              label="Generar preview"
              onClick={generarPreview}
              disabled={!idDosificacion || !edadDiseno || loading}
              loading={loading}
            />
            {data && (
              <Button
                icon="fa-solid fa-file-pdf"
                label="Descargar PDF"
                severity="success"
                onClick={descargarPdf}
              />
            )}
          </div>
        </Card>

        {/* Preview del veredicto */}
        {loading && (
          <div className="w-full flex justify-content-center p-5">
            <LoadSpinner />
          </div>
        )}

        {!loading && data && (
          <Card className="w-full">
            <div className="flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
              <h3 className="m-0">Preview del informe</h3>
              <Tag
                severity={VEREDICTO_SEVERITY[data.veredictoGlobal?.codigo ?? data.veredictoGlobal] || 'info'}
                value={VEREDICTO_LABEL[data.veredictoGlobal?.codigo ?? data.veredictoGlobal] || (data.veredictoGlobal?.codigo ?? data.veredictoGlobal)}
                style={{ fontSize: '1rem', padding: '0.5rem 1rem' }}
              />
            </div>

            <div className="grid">
              <div className="col-12 md:col-6">
                <h5 className="mt-0">Lote</h5>
                <ul className="m-0 pl-3" style={{ lineHeight: 1.8 }}>
                  <li><strong>Cliente:</strong> {data.lote.cliente || '—'}</li>
                  <li><strong>Obra:</strong> {data.lote.obra || '—'}</li>
                  <li><strong>Tipo H°:</strong> {data.lote.tipoHormigon}</li>
                  <li><strong>f'c objetivo:</strong> {data.lote.resistencia_diseno} MPa</li>
                  <li><strong>n:</strong> {data.lote.tamanoLote} muestra(s)</li>
                </ul>
              </div>
              <div className="col-12 md:col-6">
                <h5 className="mt-0">Estadísticas</h5>
                <ul className="m-0 pl-3" style={{ lineHeight: 1.8 }}>
                  <li><strong>fcm:</strong> {data.lote.resistencia_media} MPa</li>
                  <li><strong>σ:</strong> {data.lote.desviacion_estandar} MPa</li>
                  <li><strong>CV:</strong> {data.lote.coef_variacion}</li>
                  <li><strong>fck calc:</strong> {data.lote.caracteristica} MPa</li>
                  <li><strong>Mín / Máx:</strong> {data.lote.minima} / {data.lote.maxima} MPa</li>
                </ul>
              </div>
              <div className="col-12">
                <h5 className="mt-0">Cumplimiento</h5>
                <div className="text-sm text-500 mb-2">
                  <i className="fa-solid fa-info-circle mr-1" />
                  Tres criterios paralelos: CIRSOC M1/M2 (aceptación cliente) e
                  IRAM 1666 (autocontrol del productor). Cada uno responde a
                  preguntas distintas; ver cuál aplica a tu rol y contrato.
                </div>
                <div className="flex flex-wrap gap-2">
                  <Tag
                    severity={data.cumplimiento.cumpleCirsocM1 === true ? 'success' : data.cumplimiento.cumpleCirsocM1 === false ? 'danger' : 'info'}
                    value={`CIRSOC 200-2024 §6.2.3 (M1): ${data.cumplimiento.cumpleCirsocM1 === true ? 'CUMPLE' : data.cumplimiento.cumpleCirsocM1 === false ? 'NO CUMPLE' : 'no aplica'}`}
                    tooltip="Aceptación cliente, criterio 'blando': prom3 ≥ f'c (§6.2.3.7.a Ec. 6-3) + individual ≥ f'c − 3,5 MPa (§6.2.3.7.b Ec. 6-4) si f'c ≤ 35; ≥ 0,90·f'c (§6.2.3.7.c Ec. 6-5) si f'c > 35"
                  />
                  <Tag
                    severity={data.cumplimiento.cumpleCirsocM2 === true ? 'success' : data.cumplimiento.cumpleCirsocM2 === false ? 'danger' : 'info'}
                    value={`CIRSOC 200-2024 §6.2.4 (M2): ${data.cumplimiento.cumpleCirsocM2 === true ? 'CUMPLE' : data.cumplimiento.cumpleCirsocM2 === false ? 'NO CUMPLE' : 'no aplica'}`}
                    tooltip="Aceptación cliente, criterio 'estricto': prom3 ≥ f'c + 5 MPa (§6.2.4.a Ec. 6-7) + individual ≥ f'c sin tolerancia (§6.2.4 Ec. 6-8)"
                  />
                  <Tag
                    severity={data.cumplimiento.cumpleIramAutocontrol?.cumple === true ? 'success' : data.cumplimiento.cumpleIramAutocontrol?.cumple === false ? 'danger' : 'info'}
                    value={`IRAM 1666:2020 §A.7.10 (autocontrol): ${data.cumplimiento.cumpleIramAutocontrol?.cumple === true ? 'CUMPLE' : data.cumplimiento.cumpleIramAutocontrol?.cumple === false ? 'NO CUMPLE' : 'no aplica'}`}
                    tooltip="Autocontrol del PRODUCTOR (3-MA ≥ f'c + k·σ). NO es aceptación cliente."
                  />
                  <Tag
                    severity="info"
                    value={`Metodología CIRSOC: ${METODOLOGIA_LABEL[data.cumplimiento.evaluacionMetodologia] || String(data.cumplimiento.evaluacionMetodologia || '').replace(/_/g, ' ')}`}
                  />
                </div>

                {/* ACE-05: detalle del criterio IRAM 1666:2020 §A.7.10.1.1
                    (3-MA ≥ f'c + k·σ). El backend reporta umbral, k, σ y la
                    lista de ventanas que fallaron — exponer esa data hace
                    que el dictamen no sea una "caja negra". Si en el
                    futuro IRAM agrega criterios adicionales (mínimo
                    individual, CV) habrá que actualizar el motor; hoy el
                    backend reporta solo §A.7.10.1.1. */}
                {data.cumplimiento.cumpleIramAutocontrol && (
                  (() => {
                    const ac = data.cumplimiento.cumpleIramAutocontrol;
                    if (ac.cumple === null || ac.cumple === undefined) {
                      return ac.motivo ? (
                        <div className="mt-2 text-sm text-500">
                          <i className="fa-solid fa-info-circle mr-1" />
                          IRAM autocontrol no evaluable: {ac.motivo}
                        </div>
                      ) : null;
                    }
                    return (
                      <div className="mt-2 text-sm" style={{ lineHeight: 1.7 }}>
                        <div className="text-500 mb-1">
                          <i className="fa-solid fa-list-check mr-1" />
                          Detalle IRAM 1666:2020 §A.7.10.1.1 — autocontrol del productor
                        </div>
                        <ul className="m-0 pl-3">
                          <li>
                            <strong>Criterio:</strong> toda 3-MA ≥ f'c + k·σ ={' '}
                            <strong>{ac.umbral != null ? `${ac.umbral} MPa` : '—'}</strong>
                            {ac.k != null && (
                              <>{' '}(k = {Number(ac.k).toFixed(3)} de Tabla A.3 para n = {ac.n})</>
                            )}
                          </li>
                          <li>
                            <strong>σ aplicado:</strong>{' '}
                            {ac.sigma != null ? `${ac.sigma} MPa` : '—'}
                            {ac.desviacionReferencial && (
                              <span className="ml-2" style={{ color: 'var(--orange-500)' }}>
                                (n &lt; 15 → σ referencial)
                              </span>
                            )}
                          </li>
                          <li>
                            <strong>Resultado:</strong>{' '}
                            {ac.cumple
                              ? `Todas las 3-MA ≥ ${ac.umbral} MPa.`
                              : `${ac.fallos?.length ?? 0} ventana(s) de 3-MA por debajo del umbral.`}
                          </li>
                        </ul>
                      </div>
                    );
                  })()
                )}
              </div>
            </div>

            {data.advertencias && data.advertencias.length > 0 && (
              <div className="mt-3 p-3" style={{ background: 'var(--yellow-50)', borderRadius: 6 }}>
                <strong><i className="fa-solid fa-triangle-exclamation mr-2" />Advertencias:</strong>
                <ul className="m-0 pl-3 mt-2">
                  {data.advertencias.map((a, i) => <li key={i}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* Recursos MVP Fase D: trazabilidad ISO 17025 §6.4.7.
                Cuenta cuántos ensayos del lote se hicieron con un equipo
                sin calibración vigente al momento. Si todos los ensayos
                tienen calibración aplicada, no se muestra nada. */}
            {(() => {
              const t = data.trazabilidadCalibracion;
              if (!t || !t.sinCalibracionAplicada) return null;
              const pct = t.totalEnsayos > 0
                ? ((t.sinCalibracionAplicada / t.totalEnsayos) * 100).toFixed(1)
                : '?';
              return (
                <div className="mt-3 p-3" style={{
                  border: '1px solid var(--orange-500)',
                  borderLeft: '4px solid var(--orange-500)',
                  borderRadius: 6,
                  background: 'var(--orange-50, rgba(245, 158, 11, 0.08))',
                }}>
                  <strong>
                    <i className="fa-solid fa-microscope mr-2" style={{ color: 'var(--orange-500)' }} />
                    Trazabilidad de calibración — ISO 17025 §6.4.7
                  </strong>
                  <div className="mt-2 text-sm" style={{ lineHeight: 1.5 }}>
                    <strong>{t.sinCalibracionAplicada}</strong> de <strong>{t.totalEnsayos}</strong> ensayo{t.totalEnsayos !== 1 ? 's' : ''} ({pct}%) se realizaron con un equipo de medición <strong>sin calibración vigente</strong> al momento del ensayo.
                    {' '}Los resultados conservan validez operativa, pero la cadena de trazabilidad metrológica para auditoría externa es débil.
                    {t.probetasSinCalibracion?.length > 0 && (
                      <div className="mt-2 text-color-secondary">
                        Probetas afectadas: {t.probetasSinCalibracion.join(', ')}
                      </div>
                    )}
                    <div className="mt-2 text-color-secondary" style={{ fontSize: '0.85em' }}>
                      Acción recomendada: gestionar la nueva calibración en <em>Calidad → Recursos → Equipos</em>.
                    </div>
                  </div>
                </div>
              );
            })()}
          </Card>
        )}
      </div>
    </Fade>
  );
};

export default InformeAceptacionLotePage;
