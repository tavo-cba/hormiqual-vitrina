import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { InputTextarea } from 'primereact/inputtextarea';
import { InputNumber } from 'primereact/inputnumber';
import { Checkbox } from 'primereact/checkbox';
import { Dropdown } from 'primereact/dropdown';
import { MultiSelect } from 'primereact/multiselect';
import { Calendar } from 'primereact/calendar';
import { Tag } from 'primereact/tag';
import { TabView, TabPanel } from 'primereact/tabview';
import { ProgressBar } from 'primereact/progressbar';
import { Message } from 'primereact/message';
import { useToast } from '../../../context/ToastContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import axios from 'axios';
import { config } from '../../../config/config';
import './PlacasElastomeroPage.css';

const hdrs = () => ({ ...config.headers, Authorization: `Bearer ${localStorage.getItem('token')}` });
const API = () => `${config.backendUrl}/api/placas-elastomero`;

const DUREZA_OPTIONS = [
  { label: 'Shore 50 ± 5 (10-40 MPa)', value: 50 },
  { label: 'Shore 60 ± 5 (20-50 MPa)', value: 60 },
  { label: 'Shore 70 ± 5 (30-85 MPa)', value: 70 },
];
const DIAMETRO_OPTIONS = [{ label: '100 mm', value: 100 }, { label: '150 mm', value: 150 }];
const MOTIVO_OPTIONS = [
  { label: 'Deterioro visible', value: 'DETERIORO' },
  { label: 'Reemplazo preventivo', value: 'REEMPLAZO_PREVENTIVO' },
  { label: 'Otro', value: 'OTRO' },
];
const ESTADO_TAG = {
  EN_STOCK:    { label: 'En stock',    severity: 'info',      icon: 'fa-solid fa-box' },
  EN_USO:      { label: 'En uso',      severity: 'success',   icon: 'fa-solid fa-play' },
  AGOTADO:     { label: 'Agotada',     severity: 'danger',    icon: 'fa-solid fa-ban' },
  DESCARTADO:  { label: 'Descartada',  severity: 'secondary', icon: 'fa-solid fa-trash' },
};
const ESTADO_FILTER_OPTIONS = [
  { label: 'En uso',     value: 'EN_USO' },
  { label: 'En stock',   value: 'EN_STOCK' },
  { label: 'Agotada',    value: 'AGOTADO' },
  { label: 'Descartada', value: 'DESCARTADO' },
];
const ESTADOS_DEFAULT = ESTADO_FILTER_OPTIONS.map(o => o.value);

const ASPECTO_OPTIONS = [
  { label: 'Conforme', value: 'CONFORME' },
  { label: 'Defectos leves', value: 'DEFECTOS_LEVES' },
  { label: 'No conforme', value: 'NO_CONFORME' },
];

const emptyControl = () => ({
  controlDiametroOk: false,
  controlEspesorOk: false,
  controlDurezaOk: false,
  diametroMedidoMm: null,
  espesorMedidoMm: null,
  durezaMedidaShoreA: null,
  aspectoEstado: null,
  aspectoDetalle: '',
  observacionesRecepcion: '',
});

const ControlChecks = ({ value, onChange }) => {
  const numericRow = (okKey, valueKey, label, unidad, opts = {}) => (
    <div className="flex align-items-center gap-3 mb-2 flex-wrap">
      <div className="flex align-items-center gap-2" style={{ minWidth: '9rem' }}>
        <Checkbox
          inputId={`chk-${okKey}`}
          checked={!!value[okKey]}
          onChange={(e) => onChange({ ...value, [okKey]: e.checked })}
        />
        <label htmlFor={`chk-${okKey}`} className="cursor-pointer font-medium">{label}</label>
      </div>
      <div style={{ flex: 1, minWidth: '12rem' }}>
        <InputNumber
          value={value[valueKey]}
          onValueChange={(e) => onChange({ ...value, [valueKey]: e.value })}
          minFractionDigits={opts.minFractionDigits ?? 0}
          maxFractionDigits={opts.maxFractionDigits ?? 0}
          min={0}
          suffix={` ${unidad}`}
          placeholder={`Medido (${unidad})`}
          className="w-full"
          inputStyle={{ width: '100%' }}
          locale="es-AR"
        />
      </div>
    </div>
  );

  return (
    <div>
      {numericRow('controlDiametroOk', 'diametroMedidoMm', 'Diámetro', 'mm', { minFractionDigits: 1, maxFractionDigits: 1 })}
      {numericRow('controlEspesorOk', 'espesorMedidoMm', 'Espesor', 'mm', { minFractionDigits: 1, maxFractionDigits: 1 })}
      {numericRow('controlDurezaOk', 'durezaMedidaShoreA', 'Dureza', 'Shore A')}

      <div className="mt-2">
        <small className="font-medium block mb-1">Aspecto visual</small>
        <Dropdown
          value={value.aspectoEstado}
          options={ASPECTO_OPTIONS}
          onChange={(e) => onChange({ ...value, aspectoEstado: e.value })}
          placeholder="Seleccionar resultado"
          className="w-full"
          showClear
        />
        {value.aspectoEstado && value.aspectoEstado !== 'CONFORME' && (
          <InputTextarea
            value={value.aspectoDetalle || ''}
            onChange={(e) => onChange({ ...value, aspectoDetalle: e.target.value })}
            className="w-full mt-2"
            rows={2}
            autoResize
            placeholder="Describir defecto (marcas, grietas, rebabas, desviaciones, etc.)"
          />
        )}
      </div>
    </div>
  );
};

export default function PlacasElastomeroPage() {
  const showToast = useToast();
  const [placas, setPlacas] = useState([]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const savingRef = useRef(false);
  const [prensas, setPrensas] = useState([]);
  const [tabIndex, setTabIndex] = useState(0);
  const [first, setFirst] = useState(0);
  const [estadosFiltrados, setEstadosFiltrados] = useState(ESTADOS_DEFAULT);

  // Dialogs
  const [createVisible, setCreateVisible] = useState(false);
  const [form, setForm] = useState({});
  const [controlForm, setControlForm] = useState(emptyControl());
  const [controlEnabled, setControlEnabled] = useState(false);

  const [loteVisible, setLoteVisible] = useState(false);
  const [loteForm, setLoteForm] = useState({});
  const [loteDistribucion, setLoteDistribucion] = useState({});

  const [viewItem, setViewItem] = useState(null);
  const [viewVisible, setViewVisible] = useState(false);

  const [activarVisible, setActivarVisible] = useState(false);
  const [activarItem, setActivarItem] = useState(null);
  const [activarPrensas, setActivarPrensas] = useState([]);
  const [laboratorios, setLaboratorios] = useState([]);

  const [descartarVisible, setDescartarVisible] = useState(false);
  const [descartarItem, setDescartarItem] = useState(null);
  const [descartarMotivo, setDescartarMotivo] = useState('REEMPLAZO_PREVENTIVO');
  const [descartarObs, setDescartarObs] = useState('');

  const [controlVisible, setControlVisible] = useState(false);
  const [controlItem, setControlItem] = useState(null);
  const [controlEditForm, setControlEditForm] = useState(emptyControl());

  useEffect(() => {
    Promise.all([
      axios.get(`${config.backendUrl}/api/equipos-laboratorio`, { headers: hdrs(), params: { tipo: 'PRENSA' } }).catch(() => ({ data: [] })),
      axios.get(`${config.backendUrl}/api/laboratorios`, { headers: hdrs() }).catch(() => ({ data: [] })),
    ]).then(([eqRes, labRes]) => {
      const labsArr = labRes.data || [];
      setLaboratorios(labsArr);
      const labById = new Map(labsArr.map((l) => [l.idLaboratorio, l.nombre]));
      const opciones = (eqRes.data || []).map((e) => ({
        label: `${e.nombre}${e.marca ? ` — ${e.marca} ${e.modelo || ''}` : ''}`,
        value: e.nombre,
        idLaboratorio: e.idLaboratorio || null,
        nombreLaboratorio: e.idLaboratorio ? (labById.get(e.idLaboratorio) || '—') : null,
      }));
      setPrensas(opciones);
    });
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try { const { data } = await axios.get(API(), { headers: hdrs() }); setPlacas(data); }
    catch { showToast('error', 'Error cargando placas'); }
    finally { setLoading(false); }
  }, [showToast]);

  useEffect(() => { load(); }, [load]);

  // Tabs por laboratorio (en lugar de por planta). Tab 0 = "Todos".
  const labIdForTab = tabIndex === 0 ? null : laboratorios[tabIndex - 1]?.idLaboratorio;
  const filtered = useMemo(() => {
    const porLab = tabIndex === 0 ? placas : placas.filter(p => p.idLaboratorio === labIdForTab);
    if (!estadosFiltrados || estadosFiltrados.length === 0) return porLab;
    return porLab.filter(p => estadosFiltrados.includes(p.estado));
  }, [placas, tabIndex, labIdForTab, estadosFiltrados]);

  // Actions
  const handleCreate = async () => {
    if (savingRef.current) return;
    const payload = { ...form };
    if (controlEnabled) payload.control = controlForm;
    savingRef.current = true;
    setSaving(true);
    try {
      await axios.post(API(), payload, { headers: hdrs() });
      showToast('success', 'Juego creado y agregado al stock');
      setCreateVisible(false); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const handleCrearLote = async () => {
    const distribucion = laboratorios
      .map((lab) => {
        const fila = loteDistribucion[lab.idLaboratorio] || {};
        return {
          idLaboratorio: lab.idLaboratorio,
          cantidadPG: Number(fila.cantidadPG) || 0,
          cantidadPC: Number(fila.cantidadPC) || 0,
        };
      })
      .filter((f) => f.cantidadPG > 0 || f.cantidadPC > 0);

    if (distribucion.length === 0) {
      showToast('warn', 'Indique al menos una cantidad para algún laboratorio.');
      return;
    }
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API()}/lote-multiple`, { ...loteForm, distribucion }, { headers: hdrs() });
      showToast('success', `Se crearon ${data.cantidad} placas en stock`);
      setLoteVisible(false); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const handleActivar = async () => {
    if (!activarItem || activarPrensas.length === 0) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await axios.post(
        `${API()}/${activarItem.idPlacaElastomero}/activar`,
        { idPrensas: activarPrensas },
        { headers: hdrs() }
      );
      const detalle = activarPrensas.length === 1 ? activarPrensas[0] : `${activarPrensas.length} prensas`;
      showToast('success', `Juego Ø${activarItem.diametroMm} mm activado en ${detalle}`);
      setActivarVisible(false); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const activarLabId = (() => {
    if (activarPrensas.length === 0) return null;
    const first = prensas.find((p) => p.value === activarPrensas[0]);
    return first?.idLaboratorio || null;
  })();
  const activarPrensasOpciones = (() => {
    if (!activarLabId) return prensas;
    return prensas.filter((p) => p.idLaboratorio === activarLabId);
  })();
  const activarLabNombre = activarLabId
    ? (laboratorios.find((l) => l.idLaboratorio === activarLabId)?.nombre || `Lab ${activarLabId}`)
    : null;

  const handleExtender = async (placa) => {
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      const { data } = await axios.post(`${API()}/${placa.idPlacaElastomero}/extender`, {}, { headers: hdrs() });
      showToast('success', data.mensaje); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const handleDescartar = async () => {
    if (!descartarItem) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await axios.post(`${API()}/${descartarItem.idPlacaElastomero}/descartar`, { motivo: descartarMotivo, observaciones: descartarObs }, { headers: hdrs() });
      showToast('info', 'Juego descartado'); setDescartarVisible(false); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const handleGuardarControl = async () => {
    if (!controlItem) return;
    if (savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    try {
      await axios.post(`${API()}/${controlItem.idPlacaElastomero}/control-recepcion`, controlEditForm, { headers: hdrs() });
      showToast('success', 'Control de recepción guardado');
      setControlVisible(false); load();
    } catch (err) { showToast('error', err.response?.data?.error || 'Error'); }
    finally { savingRef.current = false; setSaving(false); }
  };

  const abrirControl = (r) => {
    setControlItem(r);
    const existente = r.controlRecepcion || {};
    setControlEditForm({
      controlDiametroOk: !!existente.controlDiametroOk,
      controlEspesorOk: !!existente.controlEspesorOk,
      controlDurezaOk: !!existente.controlDurezaOk,
      diametroMedidoMm: existente.diametroMedidoMm != null ? Number(existente.diametroMedidoMm) : null,
      espesorMedidoMm: existente.espesorMedidoMm != null ? Number(existente.espesorMedidoMm) : null,
      durezaMedidaShoreA: existente.durezaMedidaShoreA != null ? Number(existente.durezaMedidaShoreA) : null,
      aspectoEstado: existente.aspectoEstado || null,
      aspectoDetalle: existente.aspectoDetalle || '',
      observacionesRecepcion: existente.observacionesRecepcion || '',
    });
    setControlVisible(true);
  };

  // Column bodies
  const estadoBody = (r) => {
    const cfg = ESTADO_TAG[r.estado] || ESTADO_TAG.EN_STOCK;
    return <Tag value={cfg.label} severity={cfg.severity} icon={cfg.icon} />;
  };

  const identificacionBody = (r) => (
    <div className="flex align-items-center gap-2">
      <span className="font-bold">{r.identificacion || '—'}</span>
      {!r.controlRecepcion && (
        <i
          className="fa-solid fa-triangle-exclamation text-yellow-500"
          title="Sin control de recepción"
        />
      )}
    </div>
  );

  const usoBody = (r) => {
    if (r.estado === 'EN_STOCK') return <span className="text-color-secondary text-xs">Sin uso</span>;
    const pct = r.reusosMaxNorma > 0 ? Math.min(100, Math.round((r.reusosActuales / r.reusosMaxNorma) * 100)) : 0;
    const color = pct >= 100 ? '#ef4444' : pct >= 90 ? '#f59e0b' : '#22c55e';
    return (<div style={{ minWidth: 120 }}>
      <div className="text-xs mb-1">{r.reusosActuales} / {r.reusosMaxNorma}{r.reusosExtendidos > 0 ? ` (+${r.reusosExtendidos})` : ''}</div>
      <ProgressBar value={pct} showValue={false} style={{ height: 6 }} color={color} />
    </div>);
  };

  const accionesBody = (r) => {
    const maxExt = Math.floor(r.reusosMaxNorma * 0.5);
    const puedeExtender = r.estado === 'EN_USO' && r.reusosActuales >= r.reusosMaxNorma && r.reusosExtendidos < maxExt;
    return (<div className="flex gap-1 flex-nowrap">
      <Button icon="fa-solid fa-eye" size="small" text onClick={() => { setViewItem(r); setViewVisible(true); }} tooltip="Ver" />
      <Button icon="fa-solid fa-clipboard-check" size="small" text onClick={() => abrirControl(r)} tooltip={r.controlRecepcion ? 'Editar control de recepción' : 'Cargar control de recepción'} />
      {r.estado === 'EN_STOCK' && <Button icon="fa-solid fa-play" size="small" severity="success" text onClick={() => { setActivarItem(r); setActivarPrensas([]); setActivarVisible(true); }} tooltip="Activar en prensa" />}
      {puedeExtender && <Button icon="fa-solid fa-plus" size="small" severity="warning" text onClick={() => handleExtender(r)} loading={saving} disabled={saving} tooltip="Extender uso" />}
      {(r.estado === 'EN_STOCK' || r.estado === 'EN_USO') && <Button icon="fa-solid fa-trash" size="small" severity="danger" text onClick={() => { setDescartarItem(r); setDescartarMotivo('REEMPLAZO_PREVENTIVO'); setDescartarObs(''); setDescartarVisible(true); }} tooltip="Descartar" />}
    </div>);
  };

  const tabla = (data) => (
    <DataTable
      responsiveLayout="scroll"
      value={data}
      loading={loading}
      size="small"
      stripedRows
      emptyMessage="Sin placas."
      paginator
      rows={15}
      first={first}
      onPage={(e) => setFirst(e.first)}
      sortField="estado"
      sortOrder={1}
      rowClassName={(r) => r.estado === 'EN_USO' ? '' : r.estado === 'EN_STOCK' ? '' : 'opacity-60'}
    >
      {tabIndex === 0 && <Column header="Laboratorio" body={(r) => laboratorios.find(l => l.idLaboratorio === r.idLaboratorio)?.nombre || <span className="text-color-secondary">Sin asignar</span>} style={{ maxWidth: 160 }} />}
      <Column header="Identificación" body={identificacionBody} sortable field="identificacion" style={{ minWidth: 130 }} />
      <Column header="Estado" body={estadoBody} sortable field="estado" style={{ minWidth: 130, whiteSpace: 'nowrap' }} />
      <Column header="Prensas" body={(r) => {
        const lista = (r.prensasAsignadas && r.prensasAsignadas.length > 0) ? r.prensasAsignadas : (r.idPrensa ? [r.idPrensa] : []);
        if (lista.length === 0) return <span className="text-color-secondary">—</span>;
        return (
          <div className="flex flex-wrap gap-1">
            {lista.map((nombre) => (<Tag key={nombre} value={nombre} severity="secondary" />))}
          </div>
        );
      }} sortable field="idPrensa" style={{ minWidth: 160 }} />
      <Column header="Dureza" body={(r) => `Shore ${r.durezaShoreA}`} style={{ maxWidth: 90 }} />
      <Column header="Ø" body={(r) => `${r.diametroMm} mm`} style={{ maxWidth: 70 }} />
      <Column header="Alta" body={(r) => r.fechaAlta ? new Date(r.fechaAlta).toLocaleDateString('es-AR') : '—'} style={{ maxWidth: 90 }} />
      <Column header="Usos" body={usoBody} style={{ minWidth: 130 }} />
      <Column header="Acciones" body={accionesBody} style={{ minWidth: 180 }} />
    </DataTable>
  );

  return (
    <div className="p-3">
      <PageHeader icon="fa-solid fa-circle-dot" title="Placas de elastómero" subtitle="Gestión de juegos — IRAM 1709" />
      <div className="flex justify-content-between align-items-center gap-2 mb-3 flex-wrap">
        <div className="flex align-items-center gap-2">
          <small className="text-color-secondary">Estado:</small>
          <MultiSelect
            value={estadosFiltrados}
            options={ESTADO_FILTER_OPTIONS}
            onChange={(e) => { setEstadosFiltrados(e.value); setFirst(0); }}
            placeholder="Todos"
            display="chip"
            panelClassName="placas-estado-filter-panel"
            style={{ minWidth: '18rem' }}
          />
        </div>
        <div className="flex gap-2">
          <Button
            label="Cargar lote (varios juegos)"
            icon="fa-solid fa-layer-group"
            severity="secondary"
            onClick={() => {
              setLoteForm({
                durezaShoreA: 70,
                fechaAlta: new Date(),
                marca: '',
                observaciones: '',
              });
              setLoteDistribucion({});
              setLoteVisible(true);
            }}
          />
          <Button
            label="Nuevo juego"
            icon="fa-solid fa-plus"
            onClick={() => {
              setForm({
                idLaboratorio: labIdForTab || laboratorios[0]?.idLaboratorio,
                durezaShoreA: 70,
                diametroMm: 100,
                fechaAlta: new Date(),
                marca: '',
                observaciones: '',
              });
              setControlEnabled(false);
              setControlForm(emptyControl());
              setCreateVisible(true);
            }}
          />
        </div>
      </div>
      <div className="placas-info-banner mb-3">
        <i className="fa-solid fa-circle-info" />
        <div>Los juegos se crean en stock y se activan al asignarlos a una prensa. La identificación se asigna automáticamente: <strong>PG-NNNN</strong> para placas de 150 mm y <strong>PC-NNNN</strong> para placas de 100 mm. Al alcanzar el límite de reúsos se pueden extender de a 1 (hasta +50%). Luego se marcan como agotadas.</div>
      </div>

      <TabView activeIndex={tabIndex} onTabChange={(e) => { setTabIndex(e.index); setFirst(0); }}>
        <TabPanel header="Todos">{tabla(filtered)}</TabPanel>
        {laboratorios.map(lab => <TabPanel key={lab.idLaboratorio} header={lab.nombre}>{tabla(filtered)}</TabPanel>)}
      </TabView>

      {/* Crear juego individual */}
      <Dialog
        header="Nuevo juego de placas → Stock"
        visible={createVisible}
        onHide={() => setCreateVisible(false)}
        style={{ width: '90vw', maxWidth: '34rem' }}
        footer={<div className="flex justify-content-end gap-2"><Button label="Cancelar" className="p-button-text" onClick={() => setCreateVisible(false)} /><Button label="Crear" icon="fa-solid fa-check" onClick={handleCreate} loading={saving} disabled={!form.idLaboratorio || saving} /></div>}
      >
        <div className="flex flex-column gap-3">
          <div>
            <small className="font-bold">Laboratorio *</small>
            <Dropdown
              value={form.idLaboratorio}
              options={laboratorios.map((l) => ({ label: l.nombre, value: l.idLaboratorio }))}
              onChange={(e) => setForm({ ...form, idLaboratorio: e.value })}
              className="w-full"
              placeholder="Laboratorio"
            />
          </div>
          <div className="grid">
            <div className="col-12 md:col-6"><small className="font-bold">Dureza *</small><Dropdown value={form.durezaShoreA} options={DUREZA_OPTIONS} onChange={(e) => setForm({ ...form, durezaShoreA: e.value })} className="w-full" /></div>
            <div className="col-12 md:col-6"><small className="font-bold">Diámetro *</small><Dropdown value={form.diametroMm} options={DIAMETRO_OPTIONS} onChange={(e) => setForm({ ...form, diametroMm: e.value })} className="w-full" /></div>
          </div>
          <div><small>Fecha de alta</small><Calendar value={form.fechaAlta} onChange={(e) => setForm({ ...form, fechaAlta: e.value })} showTime className="w-full" dateFormat="dd/mm/yy" /></div>
          <div><small>Marca</small><InputText value={form.marca} onChange={(e) => setForm({ ...form, marca: e.target.value })} className="w-full" /></div>
          <div><small>Observaciones</small><InputTextarea value={form.observaciones} onChange={(e) => setForm({ ...form, observaciones: e.target.value })} className="w-full" rows={2} autoResize /></div>

          <div className="placas-info-banner">
            <i className="fa-solid fa-tag" />
            <div>La identificación se asignará automáticamente al crear ({form.diametroMm === 150 ? 'PG-NNNN' : 'PC-NNNN'}).</div>
          </div>

          <div className="flex align-items-center gap-2 mt-2">
            <Checkbox inputId="chk-ctrl" checked={controlEnabled} onChange={(e) => setControlEnabled(e.checked)} />
            <label htmlFor="chk-ctrl" className="cursor-pointer font-bold">Cargar control de recepción</label>
          </div>
          {controlEnabled && (
            <div className="surface-ground border-round p-3">
              <small className="text-color-secondary block mb-2">Verificaciones realizadas al recibir el juego:</small>
              <ControlChecks value={controlForm} onChange={setControlForm} />
              <div className="mt-2">
                <small>Observaciones del control</small>
                <InputTextarea
                  value={controlForm.observacionesRecepcion}
                  onChange={(e) => setControlForm({ ...controlForm, observacionesRecepcion: e.target.value })}
                  className="w-full"
                  rows={2}
                  autoResize
                />
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* Cargar lote (varios juegos) */}
      <Dialog
        header="Cargar lote → Varios juegos"
        visible={loteVisible}
        onHide={() => setLoteVisible(false)}
        style={{ width: '90vw', maxWidth: '52rem' }}
        footer={<div className="flex justify-content-end gap-2"><Button label="Cancelar" className="p-button-text" onClick={() => setLoteVisible(false)} /><Button label="Crear lote" icon="fa-solid fa-check" onClick={handleCrearLote} loading={saving} disabled={saving} /></div>}
      >
        <div className="flex flex-column gap-3">
          <div className="placas-info-banner">
            <i className="fa-solid fa-circle-info" />
            <div>Indique la cantidad de placas Ø150 mm (PG) y Ø100 mm (PC) que se asignan a cada laboratorio. Las identificaciones se asignan automáticamente y son consecutivas.</div>
          </div>

          <div className="grid">
            <div className="col-12 md:col-4"><small className="font-bold">Dureza *</small><Dropdown value={loteForm.durezaShoreA} options={DUREZA_OPTIONS} onChange={(e) => setLoteForm({ ...loteForm, durezaShoreA: e.value })} className="w-full" /></div>
            <div className="col-12 md:col-4"><small>Fecha de alta</small><Calendar value={loteForm.fechaAlta} onChange={(e) => setLoteForm({ ...loteForm, fechaAlta: e.value })} showTime className="w-full" dateFormat="dd/mm/yy" /></div>
            <div className="col-12 md:col-4"><small>Marca</small><InputText value={loteForm.marca || ''} onChange={(e) => setLoteForm({ ...loteForm, marca: e.target.value })} className="w-full" /></div>
            <div className="col-12"><small>Observaciones (se aplican a todos los juegos del lote)</small><InputTextarea value={loteForm.observaciones || ''} onChange={(e) => setLoteForm({ ...loteForm, observaciones: e.target.value })} className="w-full" rows={2} autoResize /></div>
          </div>

          <div className="mt-2">
            <strong className="block mb-2">Distribución por laboratorio</strong>
            {laboratorios.length === 0 && <Message severity="warn" text="No hay laboratorios definidos." />}
            <DataTable
              value={laboratorios}
              size="small"
              emptyMessage="—"
              responsiveLayout="scroll"
            >
              <Column header="Laboratorio" field="nombre" style={{ minWidth: 200 }} />
              <Column
                header="Placas Ø150 mm (PG)"
                body={(lab) => (
                  <InputNumber
                    value={loteDistribucion[lab.idLaboratorio]?.cantidadPG ?? null}
                    onValueChange={(e) =>
                      setLoteDistribucion({
                        ...loteDistribucion,
                        [lab.idLaboratorio]: { ...(loteDistribucion[lab.idLaboratorio] || {}), cantidadPG: e.value },
                      })
                    }
                    min={0}
                    max={500}
                    showButtons
                    buttonLayout="horizontal"
                    decrementButtonIcon="fa-solid fa-minus"
                    incrementButtonIcon="fa-solid fa-plus"
                    inputStyle={{ width: '4rem', textAlign: 'center' }}
                  />
                )}
                style={{ minWidth: 200 }}
              />
              <Column
                header="Placas Ø100 mm (PC)"
                body={(lab) => (
                  <InputNumber
                    value={loteDistribucion[lab.idLaboratorio]?.cantidadPC ?? null}
                    onValueChange={(e) =>
                      setLoteDistribucion({
                        ...loteDistribucion,
                        [lab.idLaboratorio]: { ...(loteDistribucion[lab.idLaboratorio] || {}), cantidadPC: e.value },
                      })
                    }
                    min={0}
                    max={500}
                    showButtons
                    buttonLayout="horizontal"
                    decrementButtonIcon="fa-solid fa-minus"
                    incrementButtonIcon="fa-solid fa-plus"
                    inputStyle={{ width: '4rem', textAlign: 'center' }}
                  />
                )}
                style={{ minWidth: 200 }}
              />
            </DataTable>
          </div>
        </div>
      </Dialog>

      {/* Activar en prensa(s) */}
      <Dialog header={`Activar juego Ø${activarItem?.diametroMm || ''} mm`} visible={activarVisible} onHide={() => setActivarVisible(false)} style={{ width: '90vw', maxWidth: '30rem' }}
        footer={<div className="flex justify-content-end gap-2"><Button label="Cancelar" className="p-button-text" onClick={() => setActivarVisible(false)} /><Button label="Activar" icon="fa-solid fa-play" severity="success" onClick={handleActivar} loading={saving} disabled={activarPrensas.length === 0 || saving} /></div>}>
        <div className="flex flex-column gap-3">
          <div className="placas-info-banner">
            <i className="fa-solid fa-circle-info" />
            <div>Seleccione una o más prensas donde se usará este juego. Todas deben pertenecer al mismo laboratorio.</div>
          </div>
          <div>
            <small className="font-bold">Prensas *</small>
            <MultiSelect
              value={activarPrensas}
              options={activarPrensasOpciones}
              onChange={(e) => setActivarPrensas(e.value)}
              className="w-full"
              placeholder="Seleccionar prensas"
              filter
              optionLabel="label"
              optionValue="value"
              display="chip"
              itemTemplate={(opt) => (
                <div className="flex justify-content-between align-items-center w-full gap-3">
                  <span>{opt.label}</span>
                  <small className="placas-lab-tag">{opt.nombreLaboratorio || 'Sin lab'}</small>
                </div>
              )}
            />
          </div>
          {activarLabNombre && (
            <div className="placas-lab-banner">
              <i className="fa-solid fa-circle-check" />
              <div>
                <strong>Laboratorio común:</strong> {activarLabNombre}.{' '}
                <span>El resto de prensas de otros laboratorios queda oculto hasta que limpies la selección.</span>
              </div>
            </div>
          )}
        </div>
      </Dialog>

      {/* Ver detalle */}
      <Dialog header={`Detalle — ${viewItem?.identificacion || `Ø${viewItem?.diametroMm || ''} mm`}`} visible={viewVisible} onHide={() => setViewVisible(false)} style={{ width: '90vw', maxWidth: '36rem' }}>
        {viewItem && (<div className="flex flex-column gap-2">
          <div className="grid text-sm">
            <div className="col-12 md:col-6"><strong>Identificación:</strong> {viewItem.identificacion || '—'}</div>
            <div className="col-12 md:col-6"><strong>Estado:</strong> {estadoBody(viewItem)}</div>
            <div className="col-12"><strong>Prensas:</strong> {(() => {
              const lista = (viewItem.prensasAsignadas && viewItem.prensasAsignadas.length > 0) ? viewItem.prensasAsignadas : (viewItem.idPrensa ? [viewItem.idPrensa] : []);
              if (lista.length === 0) return 'Sin asignar';
              return (
                <span className="inline-flex flex-wrap gap-1 ml-1">
                  {lista.map((nombre) => (<Tag key={nombre} value={nombre} severity="secondary" />))}
                </span>
              );
            })()}</div>
            <div className="col-12 md:col-6"><strong>Laboratorio:</strong> {laboratorios.find(l => l.idLaboratorio === viewItem.idLaboratorio)?.nombre || <span className="text-color-secondary">Sin asignar</span>}</div>
            <div className="col-12 md:col-6"><strong>Dureza:</strong> Shore {viewItem.durezaShoreA}</div>
            <div className="col-12 md:col-6"><strong>Diámetro:</strong> {viewItem.diametroMm} mm</div>
            <div className="col-12 md:col-6"><strong>Alta:</strong> {viewItem.fechaAlta ? new Date(viewItem.fechaAlta).toLocaleDateString('es-AR') : '—'}</div>
            {viewItem.fechaActivacion && <div className="col-12 md:col-6"><strong>Activación:</strong> {new Date(viewItem.fechaActivacion).toLocaleDateString('es-AR')}</div>}
            {viewItem.marca && <div className="col-12 md:col-6"><strong>Marca:</strong> {viewItem.marca}</div>}
          </div>
          {viewItem.estado !== 'EN_STOCK' && (<div className="surface-ground border-round p-3 mt-2">
            <div className="text-center mb-2"><span className="text-2xl font-bold">{viewItem.reusosActuales}</span><span className="text-color-secondary"> / {viewItem.reusosMaxNorma}{viewItem.reusosExtendidos > 0 ? ` (+${viewItem.reusosExtendidos})` : ''} usos</span></div>
            <ProgressBar value={Math.min(100, Math.round((viewItem.reusosActuales / viewItem.reusosMaxNorma) * 100))} style={{ height: 10 }} color={viewItem.reusosActuales >= viewItem.reusosMaxNorma ? '#ef4444' : viewItem.reusosActuales >= viewItem.reusosMaxNorma * 0.9 ? '#f59e0b' : '#22c55e'} />
            <div className="flex justify-content-between text-xs text-color-secondary mt-1">
              <span>Restantes: {Math.max(0, (viewItem.reusosMaxNorma + viewItem.reusosExtendidos) - viewItem.reusosActuales)}</span>
              <span>Máx. extensión: {Math.floor(viewItem.reusosMaxNorma * 0.5)}</span>
            </div>
          </div>)}

          <div className="surface-ground border-round p-3 mt-2">
            <div className="flex justify-content-between align-items-center mb-2">
              <strong>Control de recepción</strong>
              <Button
                label={viewItem.controlRecepcion ? 'Editar' : 'Cargar'}
                icon="fa-solid fa-clipboard-check"
                size="small"
                text
                onClick={() => { setViewVisible(false); abrirControl(viewItem); }}
              />
            </div>
            {viewItem.controlRecepcion ? (
              <div className="grid text-sm">
                {[
                  ['controlDiametroOk', 'Diámetro', 'diametroMedidoMm', 'mm'],
                  ['controlEspesorOk', 'Espesor', 'espesorMedidoMm', 'mm'],
                  ['controlDurezaOk', 'Dureza', 'durezaMedidaShoreA', 'Shore A'],
                ].map(([okKey, label, valKey, unidad]) => {
                  const v = viewItem.controlRecepcion[valKey];
                  return (
                    <div key={okKey} className="col-12 md:col-6">
                      <i className={`fa-solid ${viewItem.controlRecepcion[okKey] ? 'fa-check text-green-600' : 'fa-xmark text-red-500'} mr-2`} />
                      {label}
                      {v != null && v !== '' && (
                        <span className="text-color-secondary"> — {Number(v).toLocaleString('es-AR')} {unidad}</span>
                      )}
                    </div>
                  );
                })}
                <div className="col-12">
                  <strong>Aspecto visual:</strong>{' '}
                  {viewItem.controlRecepcion.aspectoEstado
                    ? (ASPECTO_OPTIONS.find(o => o.value === viewItem.controlRecepcion.aspectoEstado)?.label || viewItem.controlRecepcion.aspectoEstado)
                    : <span className="text-color-secondary">Sin evaluar</span>}
                  {viewItem.controlRecepcion.aspectoDetalle && (
                    <div className="text-color-secondary">{viewItem.controlRecepcion.aspectoDetalle}</div>
                  )}
                </div>
                {viewItem.controlRecepcion.observacionesRecepcion && (
                  <div className="col-12 text-color-secondary"><strong>Obs.:</strong> {viewItem.controlRecepcion.observacionesRecepcion}</div>
                )}
                {viewItem.controlRecepcion.fechaControl && (
                  <div className="col-12 text-xs text-color-secondary">
                    Controlado el {new Date(viewItem.controlRecepcion.fechaControl).toLocaleString('es-AR')}
                    {viewItem.controlRecepcion.controladoPor ? ` por ${viewItem.controlRecepcion.controladoPor}` : ''}
                  </div>
                )}
              </div>
            ) : (
              <div className="text-color-secondary text-sm">Sin control de recepción cargado.</div>
            )}
          </div>

          {viewItem.fechaBaja && <div className="mt-2 text-sm"><strong>Baja:</strong> {new Date(viewItem.fechaBaja).toLocaleString('es-AR')} — {(viewItem.motivoBaja || '').replace(/_/g, ' ')}</div>}
          {viewItem.observacionesBaja && <div className="text-sm text-color-secondary"><strong>Obs. baja:</strong> {viewItem.observacionesBaja}</div>}
          {viewItem.observaciones && <div className="text-sm text-color-secondary mt-1"><strong>Obs.:</strong> {viewItem.observaciones}</div>}
        </div>)}
      </Dialog>

      {/* Control de recepción */}
      <Dialog
        header={`Control de recepción — ${controlItem?.identificacion || ''}`}
        visible={controlVisible}
        onHide={() => setControlVisible(false)}
        style={{ width: '90vw', maxWidth: '32rem' }}
        footer={<div className="flex justify-content-end gap-2"><Button label="Cancelar" className="p-button-text" onClick={() => setControlVisible(false)} /><Button label="Guardar" icon="fa-solid fa-check" onClick={handleGuardarControl} loading={saving} disabled={saving} /></div>}
      >
        <div className="flex flex-column gap-3">
          <small className="text-color-secondary">Marcá las verificaciones realizadas al recibir el juego:</small>
          <ControlChecks value={controlEditForm} onChange={setControlEditForm} />
          <div>
            <small>Observaciones</small>
            <InputTextarea
              value={controlEditForm.observacionesRecepcion}
              onChange={(e) => setControlEditForm({ ...controlEditForm, observacionesRecepcion: e.target.value })}
              className="w-full"
              rows={3}
              autoResize
            />
          </div>
        </div>
      </Dialog>

      {/* Descartar */}
      <Dialog header="Descartar juego de placas" visible={descartarVisible} onHide={() => setDescartarVisible(false)} style={{ width: '90vw', maxWidth: '28rem' }}
        footer={<div className="flex justify-content-end gap-2"><Button label="Cancelar" className="p-button-text" onClick={() => setDescartarVisible(false)} /><Button label="Descartar" icon="fa-solid fa-trash" severity="danger" onClick={handleDescartar} loading={saving} disabled={saving} /></div>}>
        {descartarItem && (<div className="flex flex-column gap-3">
          <Message severity="warn" text={`Se descartará el juego ${descartarItem.identificacion || `Ø${descartarItem.diametroMm} mm`} (Shore ${descartarItem.durezaShoreA}) con ${descartarItem.reusosActuales} usos.`} className="w-full" />
          <div><small className="font-bold">Motivo *</small><Dropdown value={descartarMotivo} options={MOTIVO_OPTIONS} onChange={(e) => setDescartarMotivo(e.value)} className="w-full" /></div>
          <div><small>Observaciones</small><InputTextarea value={descartarObs} onChange={(e) => setDescartarObs(e.target.value)} className="w-full" rows={3} autoResize placeholder="Estado visual, motivo detallado..." /></div>
        </div>)}
      </Dialog>
    </div>
  );
}
