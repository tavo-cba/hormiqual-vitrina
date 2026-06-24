import React, { useEffect, useMemo, useState } from "react";
import { Card } from "primereact/card";
import { Button } from "primereact/button";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Checkbox } from "primereact/checkbox";
import { Fade } from "react-awesome-reveal";
import { useNavigate } from "react-router-dom";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDate } from "../../../common/functions";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import LoadSpinner from "../../../common/components/loadspinner/LoadSpinner";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import {
  FORMATO_OPCIONES,
  imprimirYMarcar,
  mensajeResultadoEtiquetas,
} from "../../../lib/etiquetasProbeta";

/**
 * N-01 etiqueta QR (sesión 2026-05-09) — Vista "Etiquetas pendientes".
 *
 * Lista probetas en estados ensayables (CURANDO/PENDIENTE) cuya etiqueta
 * QR aún no fue impresa (`etiquetaImpresaAt IS NULL`). Permite seleccionar
 * un subset y reimprimir en lote, eligiendo formato A4 o térmica.
 *
 * Workflow esperado:
 *   1. El operario olvidó imprimir las etiquetas al cargar la muestra, o
 *      la hoja se perdió antes de pegar.
 *   2. Entra a esta vista, filtra por planta y/o rango de fechas, marca
 *      las que necesita reimprimir, click "Imprimir seleccionadas".
 *   3. El backend marca esas probetas como impresas (timestamp + empleado).
 */
const EtiquetasPendientesPage = () => {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [seleccion, setSeleccion] = useState([]);
  const [idPlanta, setIdPlanta] = useState(null);
  const [desde, setDesde] = useState(null);
  const [hasta, setHasta] = useState(null);
  const [formato, setFormato] = useState('a4');
  const toast = useToast();
  const navigate = useNavigate();
  const { user } = useUserContext();

  const plantasOpts = useMemo(() => {
    const all = user?.allPlantas || [];
    return [
      { label: 'Todas las plantas', value: null },
      ...all.map((p) => ({ label: p.nombre, value: p.idPlanta })),
    ];
  }, [user]);

  const cargar = async () => {
    try {
      setLoading(true);
      const params = new URLSearchParams();
      if (idPlanta) params.set('idPlanta', String(idPlanta));
      if (desde) params.set('desde', desde.toISOString().slice(0, 10));
      if (hasta) params.set('hasta', hasta.toISOString().slice(0, 10));
      const url = `${config.backendUrl}/api/probetas/etiquetas-pendientes${
        params.toString() ? `?${params.toString()}` : ''
      }`;
      const { data: res } = await axios.get(url, { headers: config.headers });
      setItems(Array.isArray(res) ? res : []);
      setSeleccion([]);
    } catch (err) {
      console.error('Error cargando etiquetas pendientes:', err);
      toast('error', 'No se pudieron cargar las etiquetas pendientes');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { cargar(); /* eslint-disable-next-line */ }, []);

  const clienteLabel = (c) => {
    if (!c) return '';
    if (c.tipoPersona === 'Jurídica') return c.razonSocial || c.nombre || '';
    return c.nombre || c.razonSocial || '';
  };

  const seleccionar = (sel) => setSeleccion(Array.isArray(sel) ? sel : []);

  const seleccionarTodos = () => {
    if (seleccion.length === items.length) setSeleccion([]);
    else setSeleccion([...items]);
  };

  const imprimirSeleccionadas = async () => {
    if (seleccion.length === 0) {
      toast('warn', 'Seleccioná al menos una probeta');
      return;
    }
    try {
      setPrinting(true);
      const res = await imprimirYMarcar(seleccion, { formato });
      const { severity, mensaje } = mensajeResultadoEtiquetas(res);
      toast(severity, mensaje);
      // Recargar para que las marcadas desaparezcan del listado.
      await cargar();
    } catch (err) {
      console.error('Error generando etiquetas:', err);
      toast('error', 'No se pudieron generar las etiquetas');
    } finally {
      setPrinting(false);
    }
  };

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
        <PageHeader
          icon="fa-solid fa-qrcode"
          title="Etiquetas pendientes"
          subtitle="Probetas en curado/pendientes con etiqueta QR sin imprimir"
        />

        <div className="w-full mb-2 flex justify-content-end">
          <Button
            label="Ver procedimiento"
            icon="fa-solid fa-book"
            outlined
            severity="secondary"
            size="small"
            onClick={() => navigate('/calidad/ensayos/probetas/etiquetado-doc')}
            tooltip="Guía operativa: cómo pegar las etiquetas y qué materiales usar"
            tooltipOptions={{ position: 'left' }}
          />
        </div>

        <Card className="w-full mb-3">
          <div className="grid">
            <div className="col-12 md:col-4">
              <label className="text-xs text-500 font-semibold mb-1 block uppercase">Planta</label>
              <Dropdown
                value={idPlanta}
                options={plantasOpts}
                onChange={(e) => setIdPlanta(e.value)}
                placeholder="Todas las plantas"
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="text-xs text-500 font-semibold mb-1 block uppercase">Moldeo desde</label>
              <Calendar
                value={desde}
                onChange={(e) => setDesde(e.value)}
                showButtonBar
                dateFormat="dd/mm/yy"
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="text-xs text-500 font-semibold mb-1 block uppercase">Moldeo hasta</label>
              <Calendar
                value={hasta}
                onChange={(e) => setHasta(e.value)}
                showButtonBar
                dateFormat="dd/mm/yy"
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-2 flex align-items-end">
              <Button
                label="Aplicar filtros"
                icon="fa-solid fa-filter"
                onClick={cargar}
                className="w-full"
              />
            </div>
          </div>
        </Card>

        <Card className="w-full">
          <div className="flex align-items-center justify-content-between flex-wrap gap-2 mb-3">
            <div className="flex align-items-center gap-2">
              <Checkbox
                inputId="select-all"
                checked={seleccion.length > 0 && seleccion.length === items.length}
                onChange={seleccionarTodos}
              />
              <label htmlFor="select-all" className="text-sm">
                {seleccion.length === 0
                  ? `${items.length} probeta(s) sin etiqueta impresa`
                  : `${seleccion.length} de ${items.length} seleccionada(s)`}
              </label>
            </div>
            <div className="flex gap-2 flex-wrap align-items-end">
              <Dropdown
                value={formato}
                options={FORMATO_OPCIONES}
                onChange={(e) => setFormato(e.value)}
                style={{ minWidth: '320px' }}
              />
              <Button
                label={printing ? 'Generando…' : 'Imprimir seleccionadas'}
                icon="fa-solid fa-print"
                onClick={imprimirSeleccionadas}
                disabled={printing || seleccion.length === 0}
              />
            </div>
          </div>

          {items.length === 0 ? (
            <div className="text-center text-color-secondary p-5">
              <i className="fa-solid fa-circle-check text-3xl mb-2 text-green-600" />
              <p className="m-0">No hay etiquetas pendientes con los filtros actuales.</p>
            </div>
          ) : (
            <DataTable
              value={items}
              selection={seleccion}
              onSelectionChange={(e) => seleccionar(e.value)}
              dataKey="idProbeta"
              paginator
              rows={20}
              rowsPerPageOptions={[10, 20, 50, 100]}
              responsiveLayout="scroll"
              size="small"
            >
              <Column selectionMode="multiple" headerStyle={{ width: '3rem' }} />
              <Column field="nombre" header="Probeta" sortable />
              <Column
                field="muestra.fecha"
                header="Moldeo"
                body={(p) => p.muestra?.fecha ? formatDate(p.muestra.fecha) : '—'}
                sortable
              />
              <Column
                field="fechaRotura"
                header="Rotura prev."
                body={(p) => p.fechaRotura ? formatDate(p.fechaRotura) : '—'}
                sortable
              />
              <Column field="diasRotura" header="Edad (d)" sortable />
              <Column
                header="Tipo H°"
                body={(p) => p.muestra?.tipoHormigon?.tipoHormigon ?? '—'}
              />
              <Column
                header="Cliente"
                body={(p) => clienteLabel(p.muestra?.cliente) || '—'}
              />
              <Column
                header="Obra"
                body={(p) => p.muestra?.obra?.nombre ?? '—'}
              />
              <Column
                header="Planta"
                body={(p) => p.muestra?.planta?.nombre ?? '—'}
              />
              <Column
                header="Estado"
                body={(p) => p.estadoProbeta?.estadoProbeta ?? '—'}
              />
            </DataTable>
          )}
        </Card>
      </div>
    </Fade>
  );
};

export default EtiquetasPendientesPage;
