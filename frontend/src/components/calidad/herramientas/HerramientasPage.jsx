import React, { useState, useEffect, useMemo, useCallback, useContext } from 'react';
import { Card } from 'primereact/card';
import { InputNumber } from 'primereact/inputnumber';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Divider } from 'primereact/divider';
import { SelectButton } from 'primereact/selectbutton';
import { TabView, TabPanel } from 'primereact/tabview';
import { Tooltip } from 'primereact/tooltip';
import { Tag } from 'primereact/tag';
import { Message } from 'primereact/message';
import { ProgressSpinner } from 'primereact/progressspinner';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Chart as PrimeChart } from 'primereact/chart';
import { ThemeContext } from '../../../context/ThemeContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { useToast } from '../../../context/ToastContext';
import {
  listarClasesExposicion,
  listarTmnTabla43,
  listarPulverulentoMinimo,
  listarCurvasAC,
  verificarTabla25,
  verificarTabla43,
  verificarTabla44,
  estimarACDesdeFc,
} from '../../../services/herramientasCalidadService';
import './HerramientasPage.css';

/* ═════════════════════════════════════
   Componentes helper (HER-12 fix):
   INP y FilaPar viven en el módulo, no anidados.
   Antes estaban definidos dentro de TemperaturaHormigon → React
   los destruía y recreaba en cada render, rompiendo el foco del
   teclado y el cursor en mobile (anti-patrón clásico).
   ═════════════════════════════════════ */
const INP = ({ label, value, onChange, min, max, tooltip }) => {
  const id = useMemo(() => `inp-${Math.random().toString(36).slice(2, 9)}`, []);
  return (
    <div>
      <label className="block text-sm mb-1" htmlFor={id}>
        {label}
        {tooltip && (
          <i
            className={`fa-solid fa-circle-question ml-1 text-400 ${id}-tip`}
            style={{ fontSize: '0.75rem', cursor: 'help' }}
            data-pr-tooltip={tooltip}
          />
        )}
        {tooltip && <Tooltip target={`.${id}-tip`} style={{ maxWidth: 240 }} />}
      </label>
      <InputNumber
        inputId={id}
        value={value}
        onValueChange={(e) => onChange(e.value)}
        min={min}
        max={max}
        minFractionDigits={0}
        maxFractionDigits={1}
        className="w-full"
        inputClassName="w-full"
      />
    </div>
  );
};

const FilaPar = ({ labelMasa, masa, onMasa, labelTemp, temp, onTemp, tooltipMasa, tooltipTemp }) => (
  <div className="grid mb-2">
    <div className="col-12 md:col-6">
      <INP label={labelMasa} value={masa} onChange={onMasa} min={0} tooltip={tooltipMasa} />
    </div>
    <div className="col-12 md:col-6">
      <INP label={labelTemp} value={temp} onChange={onTemp} tooltip={tooltipTemp} />
    </div>
  </div>
);

/* ═════════════════════════════════════
   1. Age conversion calculator
   ═════════════════════════════════════ */
const COEF_EDAD = {
  3: 0.46, 7: 0.67, 14: 0.82, 28: 1.00, 56: 1.10, 90: 1.17, 180: 1.23, 365: 1.27,
};

const ConversionEdad = () => {
  const [resistencia, setResistencia] = useState(null);
  const [edadOrigen, setEdadOrigen] = useState(7);
  const [edadDestino, setEdadDestino] = useState(28);

  const edades = Object.keys(COEF_EDAD).map(e => ({ label: `${e} días`, value: +e }));

  // HER-03/05 fix: cálculo en vivo (useMemo). Antes había un botón
  // "Calcular" que guardaba el resultado en state; si después cambiabas
  // un input el resultado quedaba stale y mentía al usuario.
  const resultado = useMemo(() => {
    if (!Number.isFinite(resistencia) || resistencia <= 0) return null;
    if (!COEF_EDAD[edadOrigen] || !COEF_EDAD[edadDestino]) return null;
    const factor = COEF_EDAD[edadDestino] / COEF_EDAD[edadOrigen];
    return {
      estimada: Math.round(resistencia * factor * 100) / 100,
      factor: Math.round(factor * 1000) / 1000,
    };
  }, [resistencia, edadOrigen, edadDestino]);

  const resetear = () => {
    setResistencia(null);
    setEdadOrigen(7);
    setEdadDestino(28);
  };

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Conversión de resistencia por edad</h4>
      <p className="text-sm text-500 mb-3">
        Estima la resistencia a una edad diferente usando coeficientes <strong>ACI 209R</strong> (cemento
        Portland normal). <em>Aproximación bibliográfica, NO normativa para aceptación
        CIRSOC 200-2024 §6.2 — la aceptación se evalúa a edad de diseño.</em>
      </p>
      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-3">
          <label className="block text-sm mb-1">Resistencia medida (MPa)</label>
          <InputNumber value={resistencia} onValueChange={(e) => setResistencia(e.value)} min={0} max={200} minFractionDigits={1} className="w-full" inputClassName="w-full" />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">Edad de ensayo</label>
          <Dropdown value={edadOrigen} options={edades} onChange={(e) => setEdadOrigen(e.value)} className="w-full" />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">Edad destino</label>
          <Dropdown value={edadDestino} options={edades} onChange={(e) => setEdadDestino(e.value)} className="w-full" />
        </div>
        <div className="col-12 md:col-3 flex align-items-end">
          <Button
            icon="fa-solid fa-arrows-rotate"
            label="Reiniciar"
            severity="secondary"
            outlined
            size="small"
            onClick={resetear}
            disabled={resistencia == null}
          />
        </div>
      </div>
      {resultado ? (
        <div className="surface-100 border-round p-3">
          <div className="flex flex-wrap gap-4">
            <div>
              <span className="text-500 text-sm">Factor</span>
              <div className="text-900 font-bold">{resultado.factor}</div>
            </div>
            <div>
              <span className="text-500 text-sm">Resistencia estimada a {edadDestino}d</span>
              <div className="text-900 font-bold text-xl">{resultado.estimada} MPa</div>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-color-secondary p-2">
          Ingresar la resistencia medida y las edades para ver la estimación.
        </div>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   2. Desvío estándar / f'ck calculator
   ═════════════════════════════════════ */
const CalculadoraDesvio = () => {
  const [values, setValues] = useState('');

  // HER-05 fix: cálculo en vivo con useMemo.
  const resultado = useMemo(() => {
    const nums = values
      .split(/[,;\s\n]+/)
      .map(s => parseFloat(s.trim()))
      .filter(n => !isNaN(n) && n > 0);

    if (nums.length < 2) return null;

    const n = nums.length;
    const mean = nums.reduce((a, b) => a + b, 0) / n;
    const variance = nums.reduce((a, v) => a + (v - mean) ** 2, 0) / (n - 1);
    const sd = Math.sqrt(variance);
    const cv = mean > 0 ? (sd / mean) * 100 : 0;
    const fck = mean - 1.28 * sd;

    return {
      n,
      media: Math.round(mean * 100) / 100,
      desvio: Math.round(sd * 100) / 100,
      cv: Math.round(cv * 100) / 100,
      fck: Math.round(fck * 100) / 100,
      min: Math.round(Math.min(...nums) * 100) / 100,
      max: Math.round(Math.max(...nums) * 100) / 100,
    };
  }, [values]);

  // HER-04 fix: color del f'ck más sutil. f'ck negativo es raro pero
  // matemáticamente posible si σ > media/1.28. No es "rojo error", es
  // "señal de proceso con dispersión excesiva".
  const fckColor = resultado?.fck > 0 ? 'var(--text-color)' : 'var(--orange-500)';

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Calculadora de desvío estándar y f'ck</h4>
      <p className="text-sm text-500 mb-3">
        Ingrese valores de resistencia separados por coma, punto y coma, espacio o nueva línea.
        Calcula f'ck = f'cm − 1,28·σ (<strong>CIRSOC 200-2024 §6.2.3.4</strong> / IRAM 1666:2020 §A.7.10
        Tabla A.3, k=1,28 al 10 % defectuosos).
      </p>
      <div className="mb-3">
        <label className="block text-sm mb-1">Valores de resistencia (MPa)</label>
        <textarea
          className="w-full p-inputtext herramientas-textarea"
          rows={4}
          value={values}
          onChange={(e) => setValues(e.target.value)}
          placeholder="25.3, 27.1, 24.8, 26.5, 28.0..."
        />
      </div>
      <div className="flex gap-2 mb-3">
        <Button
          icon="fa-solid fa-arrows-rotate"
          label="Limpiar"
          severity="secondary"
          outlined
          size="small"
          onClick={() => setValues('')}
          disabled={!values}
        />
        <span className="text-color-secondary text-xs flex align-items-center ml-2">
          {resultado
            ? `${resultado.n} valor${resultado.n !== 1 ? 'es' : ''} ingresado${resultado.n !== 1 ? 's' : ''}`
            : 'Mínimo 2 valores para calcular σ.'}
        </span>
      </div>
      {resultado ? (
        <div className="surface-100 border-round p-3">
          <div className="grid">
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">n</span>
              <span className="text-900 font-bold">{resultado.n}</span>
            </div>
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">Media (f'cm)</span>
              <span className="text-900 font-bold">{resultado.media} MPa</span>
            </div>
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">Desvío (σ)</span>
              <span className="text-900 font-bold">{resultado.desvio} MPa</span>
            </div>
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">CV</span>
              <span className="text-900 font-bold">{resultado.cv}%</span>
            </div>
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">f'ck</span>
              <span className="font-bold text-lg" style={{ color: fckColor }}>
                {resultado.fck} MPa
              </span>
              {resultado.fck <= 0 && (
                <div className="text-xs" style={{ color: 'var(--orange-500)' }}>
                  ⚠ σ excesivo
                </div>
              )}
            </div>
            <div className="col-6 md:col-3 lg:col-2">
              <span className="text-500 text-sm block">Rango</span>
              <span className="text-900 font-bold">{resultado.min} – {resultado.max}</span>
            </div>
          </div>
        </div>
      ) : null}
    </Card>
  );
};

/* ═════════════════════════════════════
   3. Humidity correction
   ═════════════════════════════════════ */
const CorreccionHumedad = () => {
  const [pesoHumedo, setPesoHumedo] = useState(null);
  const [humedad, setHumedad] = useState(null);
  const [absorcion, setAbsorcion] = useState(null);

  // HER-05 fix: useMemo. HER-02: validación estricta de inputs.
  const resultado = useMemo(() => {
    if (!Number.isFinite(pesoHumedo) || pesoHumedo <= 0) return null;
    if (!Number.isFinite(humedad) || humedad < 0) return null;
    const h = humedad / 100;
    const a = (Number.isFinite(absorcion) && absorcion >= 0 ? absorcion : 0) / 100;
    const pesoSeco = pesoHumedo / (1 + h);
    const pesoSSS = pesoSeco * (1 + a);
    const aguaLibre = pesoHumedo - pesoSSS;
    const aguaLibrePct = pesoSSS > 0 ? ((pesoHumedo - pesoSSS) / pesoSSS) * 100 : 0;

    return {
      pesoSeco: Math.round(pesoSeco * 100) / 100,
      pesoSSS: Math.round(pesoSSS * 100) / 100,
      aguaLibre: Math.round(aguaLibre * 100) / 100,
      aguaLibrePct: Math.round(aguaLibrePct * 100) / 100,
    };
  }, [pesoHumedo, humedad, absorcion]);

  const resetear = () => {
    setPesoHumedo(null); setHumedad(null); setAbsorcion(null);
  };

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Corrección por humedad</h4>
      <p className="text-sm text-500 mb-3">
        Calcula peso seco, peso SSS y agua libre de un agregado a partir de su humedad natural y absorción.
        Método estándar: <strong>IRAM 1520</strong> (humedad natural) e <strong>IRAM 1533</strong> /
        IRAM 1858 (absorción según fino o grueso).
      </p>
      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-3">
          <label className="block text-sm mb-1">Peso húmedo (kg)</label>
          <InputNumber value={pesoHumedo} onValueChange={(e) => setPesoHumedo(e.value)} min={0} minFractionDigits={1} className="w-full" inputClassName="w-full" />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">Humedad (%)</label>
          <InputNumber value={humedad} onValueChange={(e) => setHumedad(e.value)} min={0} max={30} minFractionDigits={1} className="w-full" inputClassName="w-full" />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">Absorción (%)</label>
          <InputNumber value={absorcion} onValueChange={(e) => setAbsorcion(e.value)} min={0} max={20} minFractionDigits={1} className="w-full" inputClassName="w-full" />
        </div>
        <div className="col-12 md:col-3 flex align-items-end">
          <Button
            icon="fa-solid fa-arrows-rotate"
            label="Reiniciar"
            severity="secondary"
            outlined
            size="small"
            onClick={resetear}
            disabled={pesoHumedo == null && humedad == null && absorcion == null}
          />
        </div>
      </div>
      {resultado ? (
        <div className="surface-100 border-round p-3">
          <div className="grid">
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Peso seco</span>
              <span className="text-900 font-bold">{resultado.pesoSeco} kg</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Peso SSS</span>
              <span className="text-900 font-bold">{resultado.pesoSSS} kg</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Agua libre</span>
              <span className="text-900 font-bold">{resultado.aguaLibre} kg</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Agua libre (%)</span>
              <span className="text-900 font-bold">{resultado.aguaLibrePct}%</span>
            </div>
          </div>
        </div>
      ) : (
        <div className="text-sm text-color-secondary p-2">
          Completar al menos peso húmedo y humedad para ver los resultados.
        </div>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   4. Unit converter
   ═════════════════════════════════════ */
const CONVERSIONS = [
  { group: 'Resistencia', units: [
    { label: 'MPa', factor: 1 },
    { label: 'kgf/cm²', factor: 10.1972 },
    { label: 'psi', factor: 145.038 },
    { label: 'kPa', factor: 1000 },
  ]},
  { group: 'Volumen', units: [
    { label: 'm³', factor: 1 },
    { label: 'litros', factor: 1000 },
    { label: 'ft³', factor: 35.3147 },
    { label: 'yd³', factor: 1.30795 },
    { label: 'galón (US)', factor: 264.172 },
  ]},
  { group: 'Masa', units: [
    { label: 'kg', factor: 1 },
    { label: 'g', factor: 1000 },
    { label: 'ton', factor: 0.001 },
    { label: 'lb', factor: 2.20462 },
  ]},
  { group: 'Longitud', units: [
    { label: 'mm', factor: 1 },
    { label: 'cm', factor: 0.1 },
    { label: 'm', factor: 0.001 },
    { label: 'in', factor: 0.0393701 },
    { label: 'ft', factor: 0.00328084 },
  ]},
];

const ConversorUnidades = () => {
  const [selectedGroup, setSelectedGroup] = useState(CONVERSIONS[0]);
  const [inputValue, setInputValue] = useState(1);
  const [fromUnit, setFromUnit] = useState(CONVERSIONS[0].units[0]);

  // HER-02 fix: validación de inputValue y factor del fromUnit antes
  // de dividir. Antes: division por cero / NaN si inputValue era null.
  const results = useMemo(() => {
    if (!Number.isFinite(inputValue) || !fromUnit?.factor) return [];
    return selectedGroup.units
      .filter(u => u.label !== fromUnit.label)
      .map(u => ({
        label: u.label,
        value: Math.round((inputValue * u.factor / fromUnit.factor) * 10000) / 10000,
      }));
  }, [selectedGroup, inputValue, fromUnit]);

  const groupOptions = CONVERSIONS.map(g => ({ label: g.group, value: g }));

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Conversor de unidades</h4>
      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-4">
          <label className="block text-sm mb-1">Categoría</label>
          <Dropdown
            value={selectedGroup}
            options={groupOptions}
            onChange={(e) => { setSelectedGroup(e.value); setFromUnit(e.value.units[0]); }}
            className="w-full"
          />
        </div>
        <div className="col-6 md:col-4">
          <label className="block text-sm mb-1">Valor</label>
          <InputNumber value={inputValue} onValueChange={(e) => setInputValue(e.value)} minFractionDigits={0} maxFractionDigits={4} className="w-full" inputClassName="w-full" />
        </div>
        <div className="col-6 md:col-4">
          <label className="block text-sm mb-1">Unidad origen</label>
          <Dropdown
            value={fromUnit}
            options={selectedGroup.units.map(u => ({ label: u.label, value: u }))}
            onChange={(e) => setFromUnit(e.value)}
            className="w-full"
          />
        </div>
      </div>
      {/* HER-16 fix: en mobile cada equivalencia ocupa una fila completa
          (col-6) para que no se aplasten ni se corten los números largos. */}
      {results.length > 0 ? (
        <div className="surface-100 border-round p-3">
          <div className="grid">
            {results.map(r => (
              <div key={r.label} className="col-6 md:col-4 lg:col-3">
                <span className="text-500 text-sm block">{r.label}</span>
                <span className="text-900 font-bold">{r.value}</span>
              </div>
            ))}
          </div>
        </div>
      ) : (
        <div className="text-sm text-color-secondary p-2">
          Ingresar un valor numérico para ver las equivalencias.
        </div>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   5. Temperatura del hormigon fresco
   ═════════════════════════════════════ */
const TemperaturaHormigon = () => {
  const [metodo, setMetodo] = useState(1);
  const [conHielo, setConHielo] = useState(false);

  // Método 1 state. Comentario de campos:
  //   mc/tc: cemento masa+temperatura
  //   ma/ta: arena SSS (asumida) masa+temperatura
  //   mg/tg: agregado grueso masa+temperatura
  //   mw/tw: agua de amasado masa+temperatura
  //   mwa: AGUA LIBRE EN ARENA — su temperatura se asume igual a la
  //        del agregado (ta). HER-13: comentario explícito para que
  //        el usuario sepa.
  //   mwg: ídem grueso.
  const [m1, setM1] = useState({
    mc: 300, tc: 25, ma: 700, ta: 30, mg: 1100, tg: 28,
    mw: 180, tw: 20, mwa: 20, mwg: 15, mh: 0, th: -12,
  });

  // Método 2 state — humedades + absorciones explícitas.
  const [m2, setM2] = useState({
    mc: 300, tc: 25, mw: 180, tw: 20,
    maHumeda: 720, ta: 30, humArena: 3, absArena: 1,
    mgHumeda: 1115, tg: 28, humGrueso: 1.5, absGrueso: 0.8,
    mh: 0, th: -12,
  });

  const upd1 = (k, v) => setM1(prev => ({ ...prev, [k]: v }));
  const upd2 = (k, v) => setM2(prev => ({ ...prev, [k]: v }));

  // HER-05 fix: cálculos intermedios + resultado en useMemo (antes
  // se calculaban en cada render con función `calcIntermedios()` +
  // el resultado venía de un botón "Calcular" que dejaba state stale).
  const inter = useMemo(() => {
    const secaArena = m2.maHumeda / (1 + m2.humArena / 100);
    const absAguaArena = secaArena * (m2.absArena / 100);
    const aguaTotalArena = m2.maHumeda - secaArena;
    const aguaLibreArena = aguaTotalArena - absAguaArena;
    const sssArena = secaArena + absAguaArena;

    const secaGrueso = m2.mgHumeda / (1 + m2.humGrueso / 100);
    const absAguaGrueso = secaGrueso * (m2.absGrueso / 100);
    const aguaTotalGrueso = m2.mgHumeda - secaGrueso;
    const aguaLibreGrueso = aguaTotalGrueso - absAguaGrueso;
    const sssGrueso = secaGrueso + absAguaGrueso;

    return {
      secaArena: Math.round(secaArena),
      aguaLibreArena: Math.round(aguaLibreArena),
      sssArena: Math.round(sssArena),
      secaGrueso: Math.round(secaGrueso),
      aguaLibreGrueso: Math.round(aguaLibreGrueso),
      sssGrueso: Math.round(sssGrueso),
    };
  }, [m2.maHumeda, m2.humArena, m2.absArena, m2.mgHumeda, m2.humGrueso, m2.absGrueso]);

  /**
   * Balance térmico calor específico solidos/agua = 0,22.
   * `ma1/ta1` es el agua libre EN el agregado de arena — su Tº se
   * asume igual a la del agregado (ta), no a la del agua de amasado.
   * `mw1/tw1` ídem grueso. HER-13: documentado.
   */
  const formulaBase = (mc, tc, ma, ta, mg, tg, mw, tw, ma1, ta1, mw1, tw1, hielo) => {
    if (!hielo) {
      const num = 0.22 * (mc * tc + ma * ta + mg * tg) + mw * tw + ma1 * ta1 + mw1 * tw1;
      const den = 0.22 * (mc + ma + mg) + mw + ma1 + mw1;
      return den !== 0 ? Math.round(num / den) : 0;
    } else {
      const { mh, th } = hielo;
      const num = 0.22 * (mc * tc + ma * ta + mg * tg) + mw * tw + ma1 * ta1 + mw1 * tw1 - 80 * mh + 0.5 * th;
      const den = 0.22 * (mc + ma + mg) + mw + ma1 + mw1 + mh;
      return den !== 0 ? Math.round(num / den) : 0;
    }
  };

  const resultado = useMemo(() => {
    let thf;
    let metodoLabel;

    if (metodo === 1) {
      const hielo = conHielo ? { mh: m1.mh, th: m1.th } : null;
      thf = formulaBase(m1.mc, m1.tc, m1.ma, m1.ta, m1.mg, m1.tg, m1.mw, m1.tw, m1.mwa, m1.ta, m1.mwg, m1.tg, hielo);
      metodoLabel = `Método 1 — Componentes directos (${conHielo ? 'con' : 'sin'} hielo)`;
    } else {
      const hielo = conHielo ? { mh: m2.mh, th: m2.th } : null;
      thf = formulaBase(m2.mc, m2.tc, inter.sssArena, m2.ta, inter.sssGrueso, m2.tg, m2.mw, m2.tw, inter.aguaLibreArena, m2.ta, inter.aguaLibreGrueso, m2.tg, hielo);
      metodoLabel = `Método 2 — Humedad y absorción (${conHielo ? 'con' : 'sin'} hielo)`;
    }

    let evaluacion;
    if (thf < 20) evaluacion = { text: 'Temperatura baja. Puede ser adecuada para climas cálidos o hormigones masivos.', sev: 'info' };
    else if (thf <= 30) evaluacion = { text: 'Temperatura dentro del rango recomendado.', sev: 'success' };
    else if (thf <= 35) evaluacion = { text: 'Temperatura elevada. Considerar medidas de enfriamiento.', sev: 'warn' };
    else evaluacion = { text: 'Temperatura muy alta. Riesgo de falso fraguado. Implementar enfriamiento.', sev: 'danger' };

    return { thf, metodoLabel, evaluacion };
  }, [metodo, conHielo, m1, m2, inter]);

  // HER-12 fix: INP y FilaPar viven en el módulo (ver arriba). Antes
  // estaban anidados acá → React los destruía y recreaba en cada render,
  // rompiendo el foco del teclado mientras se tipeaba.

  // Severidades expresadas como CSS variables (regla CLAUDE.md "sin colores
  // hardcoded"). Cada variable tiene override por tema en el theme global.
  const sevColor = {
    success: 'var(--green-500)',
    warn:    'var(--orange-500)',
    danger:  'var(--red-500)',
    info:    'var(--blue-500)',
  };

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Temperatura del hormigón fresco</h4>
      <p className="text-sm text-500 mb-3">
        Estima la temperatura del hormigón fresco a partir de las temperaturas y masas de sus componentes.
        Basado en la fórmula de balance térmico (calor específico sólidos/agua ≈ 0,22 — referencia
        <strong> ACI 305R</strong> / <strong>PCA</strong>).
      </p>

      {/* Selector metodo + hielo */}
      <div className="flex flex-wrap gap-3 align-items-center mb-3">
        <SelectButton
          value={metodo}
          options={[{ label: 'Componentes directos', value: 1 }, { label: 'Humedad y absorcion', value: 2 }]}
          onChange={(e) => e.value != null && setMetodo(e.value)}
        />
        <div className="flex align-items-center gap-2 ml-3">
          <input type="checkbox" id="chkHielo" checked={conHielo} onChange={(e) => setConHielo(e.target.checked)} />
          <label htmlFor="chkHielo" className="text-sm cursor-pointer">Incluir hielo</label>
        </div>
      </div>

      <Divider />

      {/* Metodo 1 */}
      {metodo === 1 && (
        <>
          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Cemento</span>
            <FilaPar labelMasa="Masa (kg/m³)" masa={m1.mc} onMasa={(v) => upd1('mc', v)} labelTemp="Temperatura (°C)" temp={m1.tc} onTemp={(v) => upd1('tc', v)} />
          </div>

          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Arena (SSS)</span>
            <FilaPar labelMasa="Masa SSS (kg/m³)" masa={m1.ma} onMasa={(v) => upd1('ma', v)} labelTemp="Temperatura (°C)" temp={m1.ta} onTemp={(v) => upd1('ta', v)} />
            <div className="grid">
              <div className="col-12 md:col-6"><INP label="Agua libre en arena (kg/m³)" value={m1.mwa} onChange={(v) => upd1('mwa', v)} min={0} /></div>
            </div>
          </div>

          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Agregado grueso</span>
            <FilaPar labelMasa="Masa (kg/m³)" masa={m1.mg} onMasa={(v) => upd1('mg', v)} labelTemp="Temperatura (°C)" temp={m1.tg} onTemp={(v) => upd1('tg', v)} />
            <div className="grid">
              <div className="col-12 md:col-6"><INP label="Agua libre en grueso (kg/m³)" value={m1.mwg} onChange={(v) => upd1('mwg', v)} min={0} /></div>
            </div>
          </div>

          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Agua de amasado</span>
            <FilaPar labelMasa="Masa (kg/m³)" masa={m1.mw} onMasa={(v) => upd1('mw', v)} labelTemp="Temperatura (°C)" temp={m1.tw} onTemp={(v) => upd1('tw', v)} />
          </div>

          {conHielo && (
            <div className="surface-50 border-round p-3 mb-3 border-left-3 border-blue-300">
              <span className="font-bold text-sm block mb-2">Hielo</span>
              <FilaPar labelMasa="Masa (kg/m³)" masa={m1.mh} onMasa={(v) => upd1('mh', v)} labelTemp="Temperatura (°C)" temp={m1.th} onTemp={(v) => upd1('th', v)} />
            </div>
          )}
        </>
      )}

      {/* Metodo 2 */}
      {metodo === 2 && (
        <>
          <div className="grid mb-3">
            <div className="col-12 md:col-6">
              <div className="surface-50 border-round p-3 h-full">
                <span className="font-bold text-sm block mb-2">Cemento</span>
                <FilaPar labelMasa="Masa (kg/m³)" masa={m2.mc} onMasa={(v) => upd2('mc', v)} labelTemp="Temperatura (°C)" temp={m2.tc} onTemp={(v) => upd2('tc', v)} />
              </div>
            </div>
            <div className="col-12 md:col-6">
              <div className="surface-50 border-round p-3 h-full">
                <span className="font-bold text-sm block mb-2">Agua de amasado</span>
                <FilaPar labelMasa="Masa (kg/m³)" masa={m2.mw} onMasa={(v) => upd2('mw', v)} labelTemp="Temperatura (°C)" temp={m2.tw} onTemp={(v) => upd2('tw', v)} />
              </div>
            </div>
          </div>

          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Arena</span>
            <div className="grid">
              <div className="col-12 md:col-3"><INP label="Masa húmeda (kg/m³)" value={m2.maHumeda} onChange={(v) => upd2('maHumeda', v)} min={0} /></div>
              <div className="col-12 md:col-3"><INP label="Temperatura (C)" value={m2.ta} onChange={(v) => upd2('ta', v)} /></div>
              <div className="col-12 md:col-3"><INP label="Humedad (%)" value={m2.humArena} onChange={(v) => upd2('humArena', v)} min={0} /></div>
              <div className="col-12 md:col-3"><INP label="Absorción (%)" value={m2.absArena} onChange={(v) => upd2('absArena', v)} min={0} /></div>
            </div>
          </div>

          <div className="surface-50 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Agregado grueso</span>
            <div className="grid">
              <div className="col-12 md:col-3"><INP label="Masa húmeda (kg/m³)" value={m2.mgHumeda} onChange={(v) => upd2('mgHumeda', v)} min={0} /></div>
              <div className="col-12 md:col-3"><INP label="Temperatura (C)" value={m2.tg} onChange={(v) => upd2('tg', v)} /></div>
              <div className="col-12 md:col-3"><INP label="Humedad (%)" value={m2.humGrueso} onChange={(v) => upd2('humGrueso', v)} min={0} /></div>
              <div className="col-12 md:col-3"><INP label="Absorción (%)" value={m2.absGrueso} onChange={(v) => upd2('absGrueso', v)} min={0} /></div>
            </div>
          </div>

          {/* Cálculos intermedios. HER-15: col-6 en mobile (2 por fila)
              en vez de col-4 (3 por fila) — los labels largos se cortaban
              en 360 px. */}
          <div className="surface-100 border-round p-3 mb-3">
            <span className="font-bold text-sm block mb-2">Cálculos intermedios</span>
            <div className="grid">
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Arena seca</span><span className="font-bold">{inter.secaArena} kg</span></div>
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Agua libre arena</span><span className="font-bold">{inter.aguaLibreArena} kg</span></div>
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Arena SSS</span><span className="font-bold">{inter.sssArena} kg</span></div>
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Grueso seco</span><span className="font-bold">{inter.secaGrueso} kg</span></div>
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Agua libre grueso</span><span className="font-bold">{inter.aguaLibreGrueso} kg</span></div>
              <div className="col-6 md:col-4 lg:col-2"><span className="text-500 text-xs block">Grueso SSS</span><span className="font-bold">{inter.sssGrueso} kg</span></div>
            </div>
          </div>

          {conHielo && (
            <div className="surface-50 border-round p-3 mb-3 border-left-3 border-blue-300">
              <span className="font-bold text-sm block mb-2">Hielo</span>
              <FilaPar labelMasa="Masa (kg/m³)" masa={m2.mh} onMasa={(v) => upd2('mh', v)} labelTemp="Temperatura (°C)" temp={m2.th} onTemp={(v) => upd2('th', v)} />
            </div>
          )}
        </>
      )}

      {/* HER-05 fix: cálculo en vivo (sin botón). HER-07 fix:
          `min-w-7rem` (clase responsive) en vez del `minWidth: '140px'`. */}
      <div className="surface-100 border-round p-3">
        <div className="flex flex-wrap align-items-center gap-4">
          <div className="text-center min-w-7rem">
            <span className="text-500 text-sm block">Temperatura estimada</span>
            <span className="font-bold text-3xl" style={{ color: sevColor[resultado.evaluacion.sev] }}>
              {resultado.thf} °C
            </span>
          </div>
          <div className="flex-1">
            <span className="text-500 text-sm block">{resultado.metodoLabel}</span>
            <span className="text-900 text-sm">{resultado.evaluacion.text}</span>
          </div>
        </div>
      </div>

      {/* Info box */}
      <div className="surface-50 border-round p-3 mt-3 border-left-3 border-orange-300">
        <span className="font-bold text-sm block mb-1">Recomendaciones</span>
        <ul className="text-sm text-600 m-0 pl-3 line-height-3">
          <li>T máx recepción cemento en planta: 70 °C.</li>
          <li>El agua fría es el medio más eficiente para controlar temperatura (Cp ≈ 5× mayor que áridos).</li>
          <li>Hielo en escamas: reduce ~1 °C por cada 5–7 kg en reemplazo de agua (calor de fusión 80 cal/g).</li>
          <li>Regar agregados gruesos puede reducir la temperatura 3–4 °C.</li>
        </ul>
      </div>
    </Card>
  );
};

/* ═════════════════════════════════════
   6. Tabla 2.5 — Durabilidad CIRSOC 200:2024 §2.2.4 (HER-20)
   ═════════════════════════════════════ */
const TIPO_ESTRUCTURAL_OPTIONS = [
  { label: 'Simple',     value: 'SIMPLE' },
  { label: 'Armado',     value: 'ARMADO' },
  { label: 'Pretensado', value: 'PRETENSADO' },
];

const TablaDurabilidad = () => {
  const showToast = useToast();
  const [clases, setClases] = useState([]);
  const [loadingClases, setLoadingClases] = useState(true);

  // Inputs
  const [claseExposicion, setClaseExposicion] = useState(null);
  const [tipoEstructural, setTipoEstructural] = useState('ARMADO');
  const [ac, setAc] = useState(null);
  const [fc, setFc] = useState(null);

  // Resultado
  const [verif, setVerif] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const data = await listarClasesExposicion();
        setClases(data);
      } catch (err) {
        console.error('[TablaDurabilidad] listarClasesExposicion:', err);
        showToast('error', 'No se pudieron cargar las clases de exposición.');
      } finally {
        setLoadingClases(false);
      }
    })();
  }, [showToast]);

  // HER-05 fix: verificación en vivo con debounce ligero (cada cambio
  // dispara una request al backend que invoca el engine puro). No usa
  // useMemo porque hay I/O — pero sí useEffect que cancela el request
  // anterior si los inputs cambian.
  const runVerificacion = useCallback(async () => {
    if (!claseExposicion) {
      setVerif(null);
      return;
    }
    setVerifying(true);
    try {
      const r = await verificarTabla25({
        claseExposicion,
        tipoEstructural,
        ac: Number.isFinite(ac) ? ac : undefined,
        fc: Number.isFinite(fc) ? fc : undefined,
      });
      setVerif(r);
    } catch (err) {
      console.error('[TablaDurabilidad] verificar:', err);
      showToast('error', 'No se pudo verificar.');
      setVerif(null);
    } finally {
      setVerifying(false);
    }
  }, [claseExposicion, tipoEstructural, ac, fc, showToast]);

  useEffect(() => {
    const t = setTimeout(runVerificacion, 250);
    return () => clearTimeout(t);
  }, [runVerificacion]);

  const claseOptions = useMemo(() => {
    return clases.map((c) => ({
      label: `${c.codigo}${c.descripcion ? ' — ' + c.descripcion : ''}`,
      value: c.codigo,
      group: c.grupo,
    }));
  }, [clases]);

  const resetear = () => {
    setClaseExposicion(null);
    setTipoEstructural('ARMADO');
    setAc(null);
    setFc(null);
  };

  // Render del veredicto general
  const veredictoTag = (() => {
    if (!verif) return null;
    if (verif.incumplimientos.length === 0 && verif.advertencias.length === 0) {
      return <Tag severity="success" icon="fa-solid fa-circle-check" value="Cumple Tabla 2.5" />;
    }
    if (verif.incumplimientos.length > 0) {
      return <Tag severity="danger" icon="fa-solid fa-circle-xmark" value="No cumple Tabla 2.5" />;
    }
    return <Tag severity="warning" icon="fa-solid fa-circle-info" value="Faltan datos" />;
  })();

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Tabla 2.5 — Durabilidad por clase de exposición</h4>
      <p className="text-sm text-500 mb-3">
        Verifica los criterios <strong>CIRSOC 200-2024 §2.2.4 Tabla 2.5</strong>: relación a/c máxima
        y f'c mínimo según clase de exposición y tipo estructural. El catálogo del tenant es la
        fuente única de los valores normativos (`DurabilidadExposicion`).
      </p>

      {loadingClases ? (
        <div className="flex justify-content-center p-3">
          <ProgressSpinner style={{ width: 40, height: 40 }} />
        </div>
      ) : (
        <>
          <div className="grid mb-3 align-items-end">
            <div className="col-12 md:col-4">
              <label className="block text-sm mb-1">Clase de exposición *</label>
              <Dropdown
                value={claseExposicion}
                options={claseOptions}
                onChange={(e) => setClaseExposicion(e.value)}
                placeholder="Seleccionar…"
                filter
                showClear
                className="w-full"
                optionLabel="label"
              />
            </div>
            <div className="col-12 md:col-3">
              <label className="block text-sm mb-1">Tipo estructural</label>
              <Dropdown
                value={tipoEstructural}
                options={TIPO_ESTRUCTURAL_OPTIONS}
                onChange={(e) => setTipoEstructural(e.value)}
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">a/c efectiva</label>
              <InputNumber
                value={ac}
                onValueChange={(e) => setAc(e.value)}
                min={0.2}
                max={1.0}
                minFractionDigits={2}
                maxFractionDigits={3}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">f'c (MPa)</label>
              <InputNumber
                value={fc}
                onValueChange={(e) => setFc(e.value)}
                min={0}
                max={120}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-12 md:col-1 flex align-items-end">
              <Button
                icon="fa-solid fa-arrows-rotate"
                severity="secondary"
                outlined
                size="small"
                onClick={resetear}
                tooltip="Reiniciar"
                tooltipOptions={{ position: 'top' }}
                disabled={!claseExposicion && ac == null && fc == null}
              />
            </div>
          </div>

          {!claseExposicion ? (
            <div className="text-sm text-color-secondary p-2">
              Seleccionar una clase de exposición para ver los requisitos.
            </div>
          ) : verifying ? (
            <div className="flex justify-content-center p-3">
              <ProgressSpinner style={{ width: 30, height: 30 }} />
            </div>
          ) : verif ? (
            <>
              <div className="flex flex-wrap gap-3 mb-3 align-items-center">
                {veredictoTag}
                <small className="text-color-secondary">{verif.fuente}</small>
              </div>

              <div className="grid mb-3">
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">a/c máxima exigida</div>
                    <div className="text-900 font-bold text-xl">
                      {verif.acMax != null ? verif.acMax : <span className="text-color-secondary">—</span>}
                    </div>
                    {verif.verificaciones.ac?.valor != null && (
                      <div className="text-sm mt-1">
                        Ingresado: <strong>{verif.verificaciones.ac.valor}</strong>{' '}
                        {verif.verificaciones.ac.ok === true && <i className="fa-solid fa-check text-green-500" />}
                        {verif.verificaciones.ac.ok === false && <i className="fa-solid fa-xmark text-red-500" />}
                      </div>
                    )}
                  </Card>
                </div>
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">f'c mínimo exigido (MPa)</div>
                    <div className="text-900 font-bold text-xl">
                      {verif.fcMin != null ? verif.fcMin : <span className="text-color-secondary">—</span>}
                    </div>
                    {verif.verificaciones.fc?.valor != null && (
                      <div className="text-sm mt-1">
                        Ingresado: <strong>{verif.verificaciones.fc.valor}</strong>{' '}
                        {verif.verificaciones.fc.ok === true && <i className="fa-solid fa-check text-green-500" />}
                        {verif.verificaciones.fc.ok === false && <i className="fa-solid fa-xmark text-red-500" />}
                      </div>
                    )}
                  </Card>
                </div>
                <div className="col-12 md:col-6">
                  <Card className="surface-100 shadow-1 h-full">
                    <div className="text-500 text-xs">Clase × tipo estructural</div>
                    <div className="text-900 font-bold">
                      {verif.claseExposicion}
                      {' · '}
                      {TIPO_ESTRUCTURAL_OPTIONS.find((o) => o.value === verif.tipoEstructural)?.label || verif.tipoEstructural}
                    </div>
                    <small className="text-color-secondary block mt-1">
                      Los valores "—" indican que el catálogo NO declara requisito para esa combinación
                      (no es bug, es ausencia de restricción normativa).
                    </small>
                  </Card>
                </div>
              </div>

              {verif.incumplimientos.length > 0 && (
                <Message
                  severity="error"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Incumplimientos:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.incumplimientos.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
              {verif.advertencias.length > 0 && (
                <Message
                  severity="warn"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Advertencias:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.advertencias.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   7. Tabla 4.3 — Aire incorporado por TMN (HER-22)
   CIRSOC 200:2024 §4.3 — solo aplica a clases C1 y C2.
   ═════════════════════════════════════ */
const TablaAirePorTMN = () => {
  const showToast = useToast();
  const [clases, setClases] = useState([]);
  const [tmns, setTmns] = useState([]);
  const [loadingCat, setLoadingCat] = useState(true);

  const [claseExposicion, setClaseExposicion] = useState(null);
  const [tmnMm, setTmnMm] = useState(null);
  const [airePct, setAirePct] = useState(null);
  const [fceMpa, setFceMpa] = useState(null);

  const [verif, setVerif] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [c, t] = await Promise.all([
          listarClasesExposicion(),
          listarTmnTabla43(),
        ]);
        setClases(c);
        setTmns(t);
      } catch (err) {
        console.error('[TablaAirePorTMN] catálogos:', err);
        showToast('error', 'No se pudieron cargar los catálogos.');
      } finally {
        setLoadingCat(false);
      }
    })();
  }, [showToast]);

  const runVerificacion = useCallback(async () => {
    if (!claseExposicion || !Number.isFinite(tmnMm)) {
      setVerif(null);
      return;
    }
    setVerifying(true);
    try {
      const r = await verificarTabla43({
        claseExposicion,
        tmnMm,
        airePct: Number.isFinite(airePct) ? airePct : undefined,
        fceMpa: Number.isFinite(fceMpa) ? fceMpa : undefined,
      });
      setVerif(r);
    } catch (err) {
      console.error('[TablaAirePorTMN] verificar:', err);
      showToast('error', 'No se pudo verificar.');
      setVerif(null);
    } finally {
      setVerifying(false);
    }
  }, [claseExposicion, tmnMm, airePct, fceMpa, showToast]);

  useEffect(() => {
    const t = setTimeout(runVerificacion, 250);
    return () => clearTimeout(t);
  }, [runVerificacion]);

  // Solo C1 y C2 tienen verificación de aire (otras quedan informativas).
  const claseOptions = useMemo(() => {
    return clases.map((c) => ({
      label: `${c.codigo}${c.descripcion ? ' — ' + c.descripcion : ''}`,
      value: c.codigo,
    }));
  }, [clases]);

  const tmnOptions = useMemo(() => {
    return tmns.map((t) => ({ label: `${t} mm`, value: t }));
  }, [tmns]);

  const resetear = () => {
    setClaseExposicion(null);
    setTmnMm(null);
    setAirePct(null);
    setFceMpa(null);
  };

  const veredictoTag = (() => {
    if (!verif) return null;
    if (!verif.aplica) {
      return <Tag severity="info" icon="fa-solid fa-circle-info" value="Tabla 4.3 no aplica para esta clase" />;
    }
    if (verif.incumplimientos.length === 0 && verif.advertencias.length === 0) {
      return <Tag severity="success" icon="fa-solid fa-circle-check" value="Cumple Tabla 4.3" />;
    }
    if (verif.incumplimientos.length > 0) {
      return <Tag severity="danger" icon="fa-solid fa-circle-xmark" value="No cumple Tabla 4.3" />;
    }
    return <Tag severity="warning" icon="fa-solid fa-circle-info" value="Faltan datos" />;
  })();

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Tabla 4.3 — Aire incorporado por TMN</h4>
      <p className="text-sm text-500 mb-3">
        Verifica el aire total exigido por <strong>CIRSOC 200-2024 §4.3 Tabla 4.3</strong>:
        valor central ± tolerancia, en función del TMN del agregado grueso y la clase de
        exposición. <em>Solo aplica a clases C1 (incluye hormigón bajo agua) y C2.</em>
        Si f'ce ≥ 35 MPa se admite reducir el aire requerido en 1 punto porcentual
        (excepción §4.3 comentario).
      </p>

      {loadingCat ? (
        <div className="flex justify-content-center p-3">
          <ProgressSpinner style={{ width: 40, height: 40 }} />
        </div>
      ) : (
        <>
          <div className="grid mb-3 align-items-end">
            <div className="col-12 md:col-4">
              <label className="block text-sm mb-1">Clase de exposición *</label>
              <Dropdown
                value={claseExposicion}
                options={claseOptions}
                onChange={(e) => setClaseExposicion(e.value)}
                placeholder="Seleccionar…"
                filter
                showClear
                className="w-full"
              />
              <small className="text-color-secondary text-xs">Tabla 4.3 solo aplica a C1 y C2.</small>
            </div>
            <div className="col-12 md:col-3">
              <label className="block text-sm mb-1">TMN agregado grueso *</label>
              <Dropdown
                value={tmnMm}
                options={tmnOptions}
                onChange={(e) => setTmnMm(e.value)}
                placeholder="Seleccionar…"
                showClear
                className="w-full"
              />
            </div>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">Aire medido (%)</label>
              <InputNumber
                value={airePct}
                onValueChange={(e) => setAirePct(e.value)}
                min={0}
                max={15}
                minFractionDigits={1}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">
                f'ce (MPa)
                <i
                  className="fa-solid fa-circle-question ml-1 text-400 fce-tip"
                  style={{ fontSize: '0.75rem', cursor: 'help' }}
                  data-pr-tooltip="Si f'ce ≥ 35 MPa se reduce el aire requerido en 1 punto porcentual (excepción §4.3 comentario)."
                />
                <Tooltip target=".fce-tip" style={{ maxWidth: 280 }} />
              </label>
              <InputNumber
                value={fceMpa}
                onValueChange={(e) => setFceMpa(e.value)}
                min={0}
                max={120}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-12 md:col-1 flex align-items-end">
              <Button
                icon="fa-solid fa-arrows-rotate"
                severity="secondary"
                outlined
                size="small"
                onClick={resetear}
                tooltip="Reiniciar"
                tooltipOptions={{ position: 'top' }}
                disabled={!claseExposicion && tmnMm == null && airePct == null && fceMpa == null}
              />
            </div>
          </div>

          {!claseExposicion || tmnMm == null ? (
            <div className="text-sm text-color-secondary p-2">
              Seleccionar clase de exposición y TMN para ver el aire requerido.
            </div>
          ) : verifying ? (
            <div className="flex justify-content-center p-3">
              <ProgressSpinner style={{ width: 30, height: 30 }} />
            </div>
          ) : verif ? (
            <>
              <div className="flex flex-wrap gap-3 mb-3 align-items-center">
                {veredictoTag}
                <small className="text-color-secondary">{verif.fuente}</small>
              </div>

              {verif.aplica ? (
                <div className="grid mb-3">
                  <div className="col-6 md:col-3">
                    <Card className="surface-100 shadow-1">
                      <div className="text-500 text-xs">Aire requerido</div>
                      <div className="text-900 font-bold text-xl">
                        {verif.aireRequerido != null ? `${verif.aireRequerido.toFixed(1)}%` : '—'}
                      </div>
                      {verif.excepcionH35 && (
                        <div className="text-xs" style={{ color: 'var(--orange-500)' }}>
                          Reducción H-35: efectivo {verif.aireRequeridoEfectivo.toFixed(1)}%
                        </div>
                      )}
                    </Card>
                  </div>
                  <div className="col-6 md:col-3">
                    <Card className="surface-100 shadow-1">
                      <div className="text-500 text-xs">Rango aceptable (± {verif.tolerancia?.toFixed(1)}%)</div>
                      <div className="text-900 font-bold text-xl">
                        {verif.aireMin != null
                          ? `${verif.aireMin.toFixed(1)} – ${verif.aireMax.toFixed(1)}%`
                          : '—'}
                      </div>
                    </Card>
                  </div>
                  {verif.verificacion?.valor != null && (
                    <div className="col-12 md:col-6">
                      <Card className="surface-100 shadow-1 h-full">
                        <div className="text-500 text-xs">Aire ingresado</div>
                        <div className="font-bold text-xl flex align-items-center gap-2">
                          {verif.verificacion.valor.toFixed(1)}%
                          {verif.verificacion.ok === true && <i className="fa-solid fa-check text-green-500" />}
                          {verif.verificacion.ok === false && <i className="fa-solid fa-xmark text-red-500" />}
                        </div>
                      </Card>
                    </div>
                  )}
                </div>
              ) : (
                <Message
                  severity="info"
                  className="w-full mb-2"
                  text={`La clase ${verif.claseExposicion || ''} no requiere verificación de aire por Tabla 4.3 (esta tabla solo aplica a clases C1 y C2).`}
                />
              )}

              {verif.incumplimientos.length > 0 && (
                <Message
                  severity="error"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Incumplimientos:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.incumplimientos.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
              {verif.advertencias.length > 0 && (
                <Message
                  severity="warn"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Advertencias:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.advertencias.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
            </>
          ) : null}
        </>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   HER-24 — Material pulverulento mínimo (CIRSOC 200:2024 Tabla 4.4 §4.1.3)
   Verifica si el contenido total pasante 300 µm (cemento + adiciones +
   finos de los agregados) alcanza el mínimo exigido por TMN.
   Considera la excepción del §4.1.3: f'c ≤ 20 MPa + NO bombeado + sin
   clase de exposición agresiva (CL/M/Q/C1/C2).
   ═════════════════════════════════════ */
const METODO_COLOCACION_OPTIONS = [
  { label: 'Convencional', value: 'CONVENCIONAL' },
  { label: 'Bombeado',     value: 'BOMBEADO' },
];

const TablaPulverulentoMinimo = () => {
  const showToast = useToast();
  const [catalogo, setCatalogo] = useState([]);
  const [clases, setClases] = useState([]);
  const [loadingCat, setLoadingCat] = useState(true);

  const [tmnMm, setTmnMm] = useState(null);
  const [cementoKg, setCementoKg] = useState(null);
  const [adicionesKg, setAdicionesKg] = useState(null);
  const [finosAgregadoKg, setFinosAgregadoKg] = useState(null);
  const [fcMpa, setFcMpa] = useState(null);
  const [metodoColocacion, setMetodoColocacion] = useState('CONVENCIONAL');
  const [claseExposicion, setClaseExposicion] = useState(null);

  const [verif, setVerif] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [p, c] = await Promise.all([
          listarPulverulentoMinimo(),
          listarClasesExposicion(),
        ]);
        setCatalogo(p);
        setClases(c);
      } catch (err) {
        console.error('[TablaPulverulentoMinimo] catálogos:', err);
        showToast('error', 'No se pudieron cargar los catálogos.');
      } finally {
        setLoadingCat(false);
      }
    })();
  }, [showToast]);

  const runVerificacion = useCallback(async () => {
    if (!Number.isFinite(tmnMm)) {
      setVerif(null);
      return;
    }
    setVerifying(true);
    try {
      const r = await verificarTabla44({
        tmnMm,
        cementoKg: Number.isFinite(cementoKg) ? cementoKg : undefined,
        adicionesKg: Number.isFinite(adicionesKg) ? adicionesKg : undefined,
        finosAgregadoKg: Number.isFinite(finosAgregadoKg) ? finosAgregadoKg : undefined,
        fcMpa: Number.isFinite(fcMpa) ? fcMpa : undefined,
        metodoColocacion,
        claseExposicion: claseExposicion || undefined,
      });
      setVerif(r);
    } catch (err) {
      console.error('[TablaPulverulentoMinimo] verificar:', err);
      showToast('error', 'No se pudo verificar.');
      setVerif(null);
    } finally {
      setVerifying(false);
    }
  }, [tmnMm, cementoKg, adicionesKg, finosAgregadoKg, fcMpa, metodoColocacion, claseExposicion, showToast]);

  useEffect(() => {
    const t = setTimeout(runVerificacion, 250);
    return () => clearTimeout(t);
  }, [runVerificacion]);

  const tmnOptions = useMemo(
    () => catalogo.map((r) => ({ label: `${Number(r.tmnMm)} mm`, value: Number(r.tmnMm) })),
    [catalogo]
  );

  const claseOptions = useMemo(
    () => clases.map((c) => ({
      label: `${c.codigo}${c.descripcion ? ' — ' + c.descripcion : ''}`,
      value: c.codigo,
    })),
    [clases]
  );

  const resetear = () => {
    setTmnMm(null);
    setCementoKg(null);
    setAdicionesKg(null);
    setFinosAgregadoKg(null);
    setFcMpa(null);
    setMetodoColocacion('CONVENCIONAL');
    setClaseExposicion(null);
  };

  const veredictoTag = (() => {
    if (!verif) return null;
    if (verif.excepcionH20) {
      return <Tag severity="info" icon="fa-solid fa-circle-info" value="Excepción §4.1.3 — Tabla 4.4 no exigible" />;
    }
    if (verif.verificacion?.ok === true) {
      return <Tag severity="success" icon="fa-solid fa-circle-check" value="Cumple Tabla 4.4" />;
    }
    if (verif.verificacion?.ok === false) {
      return <Tag severity="danger" icon="fa-solid fa-circle-xmark" value="No cumple Tabla 4.4" />;
    }
    return <Tag severity="warning" icon="fa-solid fa-circle-info" value="Faltan datos" />;
  })();

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Tabla 4.4 — Material pulverulento mínimo</h4>
      <p className="text-sm text-500 mb-3">
        Verifica el contenido total pasante 300 µm (cemento + adiciones + finos del agregado)
        contra el mínimo exigido por <strong>CIRSOC 200-2024 Tabla 4.4 §4.1.3</strong>. La
        exigencia <em>no aplica</em> si simultáneamente: f'c ≤ 20 MPa, hormigón no bombeado, y
        sin clase de exposición agresiva (CL/M/Q/C1/C2).
      </p>

      {loadingCat ? (
        <div className="flex justify-content-center p-3">
          <ProgressSpinner style={{ width: 40, height: 40 }} />
        </div>
      ) : (
        <>
          <div className="grid mb-3 align-items-end">
            <div className="col-12 md:col-3">
              <label className="block text-sm mb-1">TMN agregado grueso *</label>
              <Dropdown
                value={tmnMm}
                options={tmnOptions}
                onChange={(e) => setTmnMm(e.value)}
                placeholder="Seleccionar…"
                showClear
                className="w-full"
              />
              <small className="text-color-secondary text-xs">
                TMN normados: 13,2 / 19 / 26,5 / 37,5 / 53 mm.
              </small>
            </div>
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">Cemento (kg/m³)</label>
              <InputNumber
                value={cementoKg}
                onValueChange={(e) => setCementoKg(e.value)}
                min={0}
                max={800}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">Adiciones (kg/m³)</label>
              <InputNumber
                value={adicionesKg}
                onValueChange={(e) => setAdicionesKg(e.value)}
                min={0}
                max={300}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
              <small className="text-color-secondary text-xs">
                Filler, ceniza, escoria, humo de sílice (suma).
              </small>
            </div>
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">
                Finos pasantes 300 µm del agregado (kg/m³)
                <i
                  className="fa-solid fa-circle-question ml-1 text-400 pulv-tip"
                  style={{ fontSize: '0.75rem', cursor: 'help' }}
                  data-pr-tooltip="Aporte de los agregados al pasante 300 µm: suma de (kg/m³ × p300%/100) por cada agregado."
                />
                <Tooltip target=".pulv-tip" style={{ maxWidth: 280 }} />
              </label>
              <InputNumber
                value={finosAgregadoKg}
                onValueChange={(e) => setFinosAgregadoKg(e.value)}
                min={0}
                max={300}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
          </div>

          <Divider align="left">
            <span className="text-sm text-500">Condiciones para excepción §4.1.3 (opcional)</span>
          </Divider>

          <div className="grid mb-3 align-items-end">
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">f'c (MPa)</label>
              <InputNumber
                value={fcMpa}
                onValueChange={(e) => setFcMpa(e.value)}
                min={0}
                max={120}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">Método de colocación</label>
              <Dropdown
                value={metodoColocacion}
                options={METODO_COLOCACION_OPTIONS}
                onChange={(e) => setMetodoColocacion(e.value)}
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-5">
              <label className="block text-sm mb-1">Clase de exposición</label>
              <Dropdown
                value={claseExposicion}
                options={claseOptions}
                onChange={(e) => setClaseExposicion(e.value)}
                placeholder="(opcional — solo para evaluar excepción)"
                filter
                showClear
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-1 flex align-items-end">
              <Button
                icon="fa-solid fa-arrows-rotate"
                severity="secondary"
                outlined
                size="small"
                onClick={resetear}
                tooltip="Reiniciar"
                tooltipOptions={{ position: 'top' }}
                disabled={
                  tmnMm == null && cementoKg == null && adicionesKg == null
                  && finosAgregadoKg == null && fcMpa == null && !claseExposicion
                  && metodoColocacion === 'CONVENCIONAL'
                }
              />
            </div>
          </div>

          {tmnMm == null ? (
            <div className="text-sm text-color-secondary p-2">
              Seleccionar TMN para ver el mínimo y verificar.
            </div>
          ) : verifying ? (
            <div className="flex justify-content-center p-3">
              <ProgressSpinner style={{ width: 30, height: 30 }} />
            </div>
          ) : verif ? (
            <>
              <div className="flex flex-wrap gap-3 mb-3 align-items-center">
                {veredictoTag}
                <small className="text-color-secondary">{verif.fuente}</small>
              </div>

              <div className="grid mb-3">
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">Mínimo exigido</div>
                    <div className="text-900 font-bold text-xl">
                      {verif.minimoKgM3 != null ? `${verif.minimoKgM3} kg/m³` : '—'}
                    </div>
                    <div className="text-color-secondary text-xs">TMN {verif.tmnMm} mm</div>
                  </Card>
                </div>
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">Total estimado</div>
                    <div
                      className="font-bold text-xl"
                      style={{
                        color: verif.verificacion?.ok === false
                          ? 'var(--red-500)'
                          : 'var(--green-500)',
                      }}
                    >
                      {verif.totalPulverulento} kg/m³
                    </div>
                  </Card>
                </div>
                <div className="col-12 md:col-6">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs mb-1">Desglose</div>
                    <div className="text-sm">
                      Cemento <strong>{Math.round(verif.cementoKg)}</strong> + Adiciones{' '}
                      <strong>{Math.round(verif.adicionesKg)}</strong> + Finos agregado{' '}
                      <strong>{Math.round(verif.finosAgregadoKg)}</strong> ={' '}
                      <strong>{verif.totalPulverulento} kg/m³</strong>
                    </div>
                  </Card>
                </div>
              </div>

              {verif.excepcionH20 && (
                <Message
                  severity="info"
                  className="w-full mb-2"
                  text={
                    `Excepción §4.1.3 aplicable: f'c ≤ 20 MPa + ${verif.metodoColocacion === 'CONVENCIONAL' ? 'no bombeado' : 'bombeado'} + sin exposición agresiva. `
                    + 'La verificación de Tabla 4.4 no es exigible en este caso.'
                  }
                />
              )}

              {verif.incumplimientos.length > 0 && (
                <Message
                  severity="error"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Incumplimientos:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.incumplimientos.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
              {verif.advertencias.length > 0 && (
                <Message
                  severity="warn"
                  className="w-full mb-2"
                  content={
                    <div>
                      <strong>Advertencias:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.advertencias.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
            </>
          ) : null}

          <Divider align="left">
            <span className="text-sm text-500">Tabla 4.4 completa</span>
          </Divider>
          <DataTable value={catalogo} size="small" className="text-sm">
            <Column field="tmnMm" header="TMN (mm)" body={(r) => Number(r.tmnMm)} />
            <Column field="minimoKgM3" header="Mín. pasante 300 µm (kg/m³)" body={(r) => Number(r.minimoKgM3)} />
          </DataTable>
          <small className="text-color-secondary text-xs block mt-2">
            Fuente: CIRSOC 200:2024 Tabla 4.4 §4.1.3.
          </small>
        </>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   HER-21 — Estimador de a/c desde resistencia objetivo
   Usa las curvas genéricas a/c-resistencia (Ábaco 2 de referencia) cargadas en
   `CurvaACResistencia` del tenant. Devuelve el mismo a/c que usaría
   el motor de dosificación HormiQual para esa combinación familia ×
   edad × resistencia (interpolando con la misma función `estimarAC`).
   ═════════════════════════════════════ */
const EstimadorAC = () => {
  const showToast = useToast();
  const [familias, setFamilias] = useState([]);
  const [edades, setEdades] = useState([]);
  const [loadingCat, setLoadingCat] = useState(true);

  const [familiaCemento, setFamiliaCemento] = useState(null);
  const [edadDias, setEdadDias] = useState(28);
  const [resistenciaMpa, setResistenciaMpa] = useState(null);

  const [verif, setVerif] = useState(null);
  const [verifying, setVerifying] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const c = await listarCurvasAC();
        setFamilias(c.familias || []);
        setEdades(c.edades && c.edades.length > 0 ? c.edades : [28]);
      } catch (err) {
        console.error('[EstimadorAC] catálogos:', err);
        showToast('error', 'No se pudieron cargar las curvas a/c.');
      } finally {
        setLoadingCat(false);
      }
    })();
  }, [showToast]);

  const runEstimacion = useCallback(async () => {
    if (!Number.isFinite(resistenciaMpa) || resistenciaMpa <= 0) {
      setVerif(null);
      return;
    }
    setVerifying(true);
    try {
      const r = await estimarACDesdeFc({
        resistenciaMpa,
        edadDias,
        familiaCemento: familiaCemento || undefined,
      });
      setVerif(r);
    } catch (err) {
      console.error('[EstimadorAC] estimar:', err);
      showToast('error', 'No se pudo estimar a/c.');
      setVerif(null);
    } finally {
      setVerifying(false);
    }
  }, [resistenciaMpa, edadDias, familiaCemento, showToast]);

  useEffect(() => {
    const t = setTimeout(runEstimacion, 300);
    return () => clearTimeout(t);
  }, [runEstimacion]);

  const familiaOptions = useMemo(() => {
    const opts = familias
      .filter((f) => f !== '')
      .map((f) => ({ label: f, value: f }));
    return [{ label: 'Sin especificar (curvas genéricas)', value: null }, ...opts];
  }, [familias]);

  const edadOptions = useMemo(
    () => edades.map((e) => ({ label: `${e} días`, value: e })),
    [edades]
  );

  const resetear = () => {
    setFamiliaCemento(null);
    setEdadDias(28);
    setResistenciaMpa(null);
  };

  const veredictoTag = (() => {
    if (!verif) return null;
    if (verif.acEstimado == null) {
      return <Tag severity="warning" icon="fa-solid fa-circle-exclamation" value="Sin datos suficientes" />;
    }
    const sev = verif.metodo === 'DIRECTO' ? 'success'
      : verif.metodo === 'INTERPOLACION' ? 'success'
      : 'warning';
    const lbl = verif.metodo === 'DIRECTO' ? 'Coincidencia directa'
      : verif.metodo === 'INTERPOLACION' ? 'Interpolado'
      : verif.metodo === 'EXTRAPOLACION_CERCANO' ? 'Extrapolado (punto más cercano)'
      : verif.metodo;
    return <Tag severity={sev} icon="fa-solid fa-chart-line" value={lbl} />;
  })();

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">a/c desde resistencia objetivo</h4>
      <p className="text-sm text-500 mb-3">
        Estima la relación <strong>a/c</strong> a partir de la <strong>resistencia objetivo</strong>{' '}
        (típicamente f'cm, no f'ck — recordá sumar el sobre-diseño) usando las curvas a/c-resistencia
        de referencia general cargadas para este tenant. Devuelve el mismo a/c que adoptaría el motor
        HormiQual para esa combinación familia × edad × resistencia.
      </p>

      {loadingCat ? (
        <div className="flex justify-content-center p-3">
          <ProgressSpinner style={{ width: 40, height: 40 }} />
        </div>
      ) : edades.length === 0 ? (
        <Message
          severity="warn"
          className="w-full"
          text="No hay curvas a/c-resistencia activas en este tenant. Cargá curvas de referencia en Configuración → Curvas a/c para usar esta calculadora."
        />
      ) : (
        <>
          <div className="grid mb-3 align-items-end">
            <div className="col-12 md:col-4">
              <label className="block text-sm mb-1">
                Resistencia objetivo (MPa) *
                <i
                  className="fa-solid fa-circle-question ml-1 text-400 fcm-tip"
                  style={{ fontSize: '0.75rem', cursor: 'help' }}
                  data-pr-tooltip="Usar f'cm (resistencia media de diseño) = f'ck + sobre-diseño. La curva de referencia está expresada en f'cm, no f'ck."
                />
                <Tooltip target=".fcm-tip" style={{ maxWidth: 300 }} />
              </label>
              <InputNumber
                value={resistenciaMpa}
                onValueChange={(e) => setResistenciaMpa(e.value)}
                min={5}
                max={120}
                minFractionDigits={0}
                maxFractionDigits={1}
                className="w-full"
                inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-3">
              <label className="block text-sm mb-1">Edad de ensayo</label>
              <Dropdown
                value={edadDias}
                options={edadOptions}
                onChange={(e) => setEdadDias(e.value)}
                className="w-full"
              />
            </div>
            <div className="col-12 md:col-4">
              <label className="block text-sm mb-1">Familia de cemento</label>
              <Dropdown
                value={familiaCemento}
                options={familiaOptions}
                onChange={(e) => setFamiliaCemento(e.value)}
                placeholder="(opcional)"
                showClear
                className="w-full"
              />
              <small className="text-color-secondary text-xs">
                Si no se especifica, se usan las curvas sin familia (genéricas).
              </small>
            </div>
            <div className="col-12 md:col-1 flex align-items-end">
              <Button
                icon="fa-solid fa-arrows-rotate"
                severity="secondary"
                outlined
                size="small"
                onClick={resetear}
                tooltip="Reiniciar"
                tooltipOptions={{ position: 'top' }}
                disabled={resistenciaMpa == null && !familiaCemento && edadDias === 28}
              />
            </div>
          </div>

          {!Number.isFinite(resistenciaMpa) ? (
            <div className="text-sm text-color-secondary p-2">
              Ingresar la resistencia objetivo (MPa) para estimar a/c.
            </div>
          ) : verifying ? (
            <div className="flex justify-content-center p-3">
              <ProgressSpinner style={{ width: 30, height: 30 }} />
            </div>
          ) : verif ? (
            <>
              <div className="flex flex-wrap gap-3 mb-3 align-items-center">
                {veredictoTag}
                <small className="text-color-secondary">{verif.fuente}</small>
              </div>

              <div className="grid mb-3">
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">a/c estimado</div>
                    <div className="text-900 font-bold text-2xl">
                      {verif.acEstimado != null ? verif.acEstimado.toFixed(2) : '—'}
                    </div>
                  </Card>
                </div>
                <div className="col-6 md:col-3">
                  <Card className="surface-100 shadow-1">
                    <div className="text-500 text-xs">Resistencia / Edad</div>
                    <div className="text-900 font-bold text-xl">
                      {verif.resistenciaMpa} MPa · {verif.edadDias} d
                    </div>
                  </Card>
                </div>
                {verif.familiaCemento && (
                  <div className="col-12 md:col-6">
                    <Card className="surface-100 shadow-1 h-full">
                      <div className="text-500 text-xs">Familia de cemento</div>
                      <div className="text-900 font-bold">{verif.familiaCemento}</div>
                    </Card>
                  </div>
                )}
              </div>

              {verif.curvasUsadas && verif.curvasUsadas.length > 0 && (
                <>
                  <Divider align="left">
                    <span className="text-sm text-500">Puntos de la curva utilizados</span>
                  </Divider>
                  <DataTable value={verif.curvasUsadas} size="small" className="text-sm">
                    <Column field="resistenciaMpa" header="Resistencia (MPa)" body={(r) => Number(r.resistenciaMpa)} />
                    <Column field="acEstimado" header="a/c" body={(r) => Number(r.acEstimado).toFixed(3)} />
                    <Column field="familiaCemento" header="Familia" body={(r) => r.familiaCemento || '(genérica)'} />
                    <Column field="edadDias" header="Edad (d)" body={(r) => r.edadDias} />
                  </DataTable>
                </>
              )}

              {verif.advertencias && verif.advertencias.length > 0 && (
                <Message
                  severity="warn"
                  className="w-full mb-2 mt-3"
                  content={
                    <div>
                      <strong>Advertencias:</strong>
                      <ul className="m-0 pl-3 mt-1">
                        {verif.advertencias.map((m, i) => <li key={i}>{m}</li>)}
                      </ul>
                    </div>
                  }
                />
              )}
            </>
          ) : null}
        </>
      )}

      <Message
        severity="info"
        className="w-full mt-3"
        text={
          'Esta calculadora usa la tabla genérica de referencia a/c-resistencia. '
          + 'No considera curva específica del fabricante ni curva propia calibrada del tenant. '
          + 'Para esos casos, el motor de dosificación HormiQual aplica la curva configurada por planta.'
        }
      />
    </Card>
  );
};

/* ═════════════════════════════════════
   HER-23 — Cemento mínimo (CIRSOC 200:2024 §4.1.5.2)
   Mínimo de material cementicio (cemento + adiciones) por tipo
   estructural: SIMPLE 250, ARMADO 280, PRETENSADO 300 kg/m³.
   Valores fijos de norma — calculadora 100% client-side.
   Reutiliza TIPO_ESTRUCTURAL_OPTIONS definido para HER-20 (Tabla 2.5).
   ═════════════════════════════════════ */
const CEMENTO_MIN_4_1_5_2 = {
  SIMPLE:     250,
  ARMADO:     280,
  PRETENSADO: 300,
};

const CementoMinimoCirsoc = () => {
  const [tipo, setTipo] = useState('ARMADO');
  const [cementoKg, setCementoKg] = useState(null);
  const [adicionesKg, setAdicionesKg] = useState(null);

  const minimo = CEMENTO_MIN_4_1_5_2[tipo];

  const resultado = useMemo(() => {
    if (!Number.isFinite(cementoKg)) return null;
    const cemTot = (cementoKg || 0) + (Number.isFinite(adicionesKg) ? adicionesKg : 0);
    return {
      total: Math.round(cemTot * 10) / 10,
      cumple: cemTot >= minimo,
      faltan: cemTot < minimo ? Math.round((minimo - cemTot) * 10) / 10 : 0,
    };
  }, [cementoKg, adicionesKg, minimo]);

  const resetear = () => {
    setTipo('ARMADO');
    setCementoKg(null);
    setAdicionesKg(null);
  };

  const veredictoTag = (() => {
    if (!resultado) return null;
    return resultado.cumple
      ? <Tag severity="success" icon="fa-solid fa-circle-check" value="Cumple §4.1.5.2" />
      : <Tag severity="danger"  icon="fa-solid fa-circle-xmark" value="No cumple §4.1.5.2" />;
  })();

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Cemento mínimo — CIRSOC 200:2024 §4.1.5.2</h4>
      <p className="text-sm text-500 mb-3">
        Mínimo de material cementicio (cemento + adiciones contabilizadas como tales)
        según tipo estructural. Valores fijos por norma — el catálogo del tenant no los
        modifica. Si el pliego/cliente exige más, prevalece el valor mayor.
      </p>

      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-5">
          <label className="block text-sm mb-1">Tipo estructural *</label>
          <SelectButton
            value={tipo}
            options={TIPO_ESTRUCTURAL_OPTIONS}
            onChange={(e) => e.value != null && setTipo(e.value)}
          />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">Cemento (kg/m³)</label>
          <InputNumber
            value={cementoKg}
            onValueChange={(e) => setCementoKg(e.value)}
            min={0}
            max={800}
            minFractionDigits={0}
            maxFractionDigits={1}
            className="w-full"
            inputClassName="w-full"
          />
        </div>
        <div className="col-6 md:col-3">
          <label className="block text-sm mb-1">
            Adiciones (kg/m³)
            <i
              className="fa-solid fa-circle-question ml-1 text-400 cem-min-tip"
              style={{ fontSize: '0.75rem', cursor: 'help' }}
              data-pr-tooltip="Filler, ceniza volante, escoria, humo de sílice — solo si se cuentan como material cementicio."
            />
            <Tooltip target=".cem-min-tip" style={{ maxWidth: 280 }} />
          </label>
          <InputNumber
            value={adicionesKg}
            onValueChange={(e) => setAdicionesKg(e.value)}
            min={0}
            max={300}
            minFractionDigits={0}
            maxFractionDigits={1}
            className="w-full"
            inputClassName="w-full"
          />
        </div>
        <div className="col-12 md:col-1 flex align-items-end">
          <Button
            icon="fa-solid fa-arrows-rotate"
            severity="secondary"
            outlined
            size="small"
            onClick={resetear}
            tooltip="Reiniciar"
            tooltipOptions={{ position: 'top' }}
            disabled={tipo === 'ARMADO' && cementoKg == null && adicionesKg == null}
          />
        </div>
      </div>

      <div className="grid mb-3">
        <div className="col-6 md:col-3">
          <Card className="surface-100 shadow-1">
            <div className="text-500 text-xs">Mínimo exigido</div>
            <div className="text-900 font-bold text-xl">{minimo} kg/m³</div>
            <div className="text-color-secondary text-xs">{tipo}</div>
          </Card>
        </div>
        {resultado && (
          <>
            <div className="col-6 md:col-3">
              <Card className="surface-100 shadow-1">
                <div className="text-500 text-xs">Material cementicio</div>
                <div
                  className="font-bold text-xl"
                  style={{ color: resultado.cumple ? 'var(--green-500)' : 'var(--red-500)' }}
                >
                  {resultado.total} kg/m³
                </div>
              </Card>
            </div>
            {!resultado.cumple && (
              <div className="col-12 md:col-6">
                <Card className="surface-100 shadow-1 h-full">
                  <div className="text-500 text-xs">Faltante</div>
                  <div className="font-bold text-xl" style={{ color: 'var(--red-500)' }}>
                    {resultado.faltan} kg/m³
                  </div>
                  <div className="text-color-secondary text-xs">
                    Para alcanzar el mínimo §4.1.5.2 hay que sumar {resultado.faltan} kg/m³ más entre cemento y adiciones.
                  </div>
                </Card>
              </div>
            )}
          </>
        )}
      </div>

      {resultado && (
        <div className="flex flex-wrap gap-3 mb-3 align-items-center">
          {veredictoTag}
          <small className="text-color-secondary">CIRSOC 200:2024 §4.1.5.2</small>
        </div>
      )}

      <Divider align="left">
        <span className="text-sm text-500">Mínimos por tipo estructural</span>
      </Divider>
      <DataTable
        value={Object.entries(CEMENTO_MIN_4_1_5_2).map(([k, v]) => ({ tipo: k, minimo: v }))}
        size="small"
        className="text-sm"
      >
        <Column field="tipo" header="Tipo" />
        <Column field="minimo" header="Mínimo (kg/m³)" />
      </DataTable>
      <Message
        severity="info"
        className="w-full mt-3"
        text={
          'Nota: el mínimo §4.1.5.2 es absoluto y se aplica independientemente del a/c '
          + 'derivado de durabilidad (Tabla 2.5) o del cemento mínimo del pliego. El cemento '
          + 'final adoptado es el máximo entre todos los criterios aplicables.'
        }
      />
    </Card>
  );
};

/* ═════════════════════════════════════
   8. Convertidor pasante ↔ retenido + Módulo de finura (HER-25)
   IRAM 1505 (método de tamizado) + IRAM 1666 (concepto de MF).
   ═════════════════════════════════════ */
const TAMICES_AF_ESTANDAR = [9.5, 4.75, 2.36, 1.18, 0.60, 0.30, 0.15];
const TAMICES_AG_ESTANDAR = [50, 37.5, 25, 19, 13.2, 9.5, 4.75];

const ConvertidorTamizado = () => {
  // Entrada: array de objetos { tamizMm, valor }. El usuario elige si
  // ingresa pasante o retenido acumulado; convertimos al otro y a parcial.
  const [tipoEntrada, setTipoEntrada] = useState('PASANTE_ACUM'); // PASANTE_ACUM | RETENIDO_ACUM
  const [setTamices, setSetTamices] = useState('AF'); // AF | AG | CUSTOM
  const [filas, setFilas] = useState(() =>
    TAMICES_AF_ESTANDAR.map((m) => ({ tamizMm: m, valor: null }))
  );

  const handleCambioSet = (nuevo) => {
    setSetTamices(nuevo);
    if (nuevo === 'AF') setFilas(TAMICES_AF_ESTANDAR.map((m) => ({ tamizMm: m, valor: null })));
    else if (nuevo === 'AG') setFilas(TAMICES_AG_ESTANDAR.map((m) => ({ tamizMm: m, valor: null })));
    // CUSTOM: mantener filas vacías para que el usuario las edite.
  };

  const actualizarFila = (idx, key, valor) => {
    setFilas((prev) => prev.map((f, i) => (i === idx ? { ...f, [key]: valor } : f)));
  };

  const agregarFila = () => setFilas((prev) => [...prev, { tamizMm: null, valor: null }]);
  const quitarFila = (idx) => setFilas((prev) => prev.filter((_, i) => i !== idx));

  // Cálculos en vivo.
  const resultado = useMemo(() => {
    // Filtrar filas válidas (tamiz numérico + valor numérico 0..100).
    const validas = filas
      .filter((f) => Number.isFinite(f.tamizMm) && Number.isFinite(f.valor))
      .map((f) => ({ tamizMm: Number(f.tamizMm), valor: Math.max(0, Math.min(100, Number(f.valor))) }))
      .sort((a, b) => b.tamizMm - a.tamizMm); // mayor → menor
    if (validas.length === 0) return null;

    // Normalizar a pasante acumulado.
    const conPasante = validas.map((f) => ({
      tamizMm: f.tamizMm,
      pasanteAcum: tipoEntrada === 'PASANTE_ACUM' ? f.valor : 100 - f.valor,
      retenidoAcum: tipoEntrada === 'PASANTE_ACUM' ? 100 - f.valor : f.valor,
    }));

    // Retenido parcial = ret_acum[i] - ret_acum[i-1]. Para la fila del
    // mayor tamiz, el retenido parcial es el propio ret_acum (= 100 -
    // pasante).
    const conParcial = conPasante.map((f, i) => {
      const prev = i === 0 ? 0 : conPasante[i - 1].retenidoAcum;
      return { ...f, retenidoParcial: f.retenidoAcum - prev };
    });

    // Módulo de finura (MF) = Σ retenidos acumulados sobre tamices de la
    // serie normalizada / 100. Usamos los tamices del set actual.
    const mf = (() => {
      const tamicesSerie = setTamices === 'AF' ? TAMICES_AF_ESTANDAR
        : setTamices === 'AG' ? TAMICES_AG_ESTANDAR : null;
      if (!tamicesSerie) return null;
      const ret = tamicesSerie.map((t) => {
        const fila = conParcial.find((f) => Math.abs(f.tamizMm - t) < 0.01);
        return fila ? fila.retenidoAcum : null;
      });
      if (ret.some((r) => r == null)) return null; // falta algún tamiz de la serie
      const suma = ret.reduce((a, b) => a + b, 0);
      return Math.round((suma / 100) * 100) / 100;
    })();

    return { filas: conParcial, mf };
  }, [filas, tipoEntrada, setTamices]);

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Pasante ↔ retenido + Módulo de finura</h4>
      <p className="text-sm text-500 mb-3">
        Convierte entre <strong>pasante acumulado</strong>, <strong>retenido acumulado</strong> y
        <strong> retenido parcial</strong>. Calcula el <strong>Módulo de finura</strong> según la
        serie de tamices estándar (IRAM 1505 / IRAM 1627). Para MF en AF se usa la serie 9,5–0,15 mm;
        en AG la serie 50–4,75 mm. Si el set es "Custom" o falta un tamiz de la serie, MF queda en —.
      </p>

      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-4">
          <label className="block text-sm mb-1">Tipo de entrada</label>
          <SelectButton
            value={tipoEntrada}
            options={[
              { label: 'Pasante acumulado %', value: 'PASANTE_ACUM' },
              { label: 'Retenido acumulado %', value: 'RETENIDO_ACUM' },
            ]}
            onChange={(e) => e.value != null && setTipoEntrada(e.value)}
          />
        </div>
        <div className="col-12 md:col-4">
          <label className="block text-sm mb-1">Set de tamices</label>
          <SelectButton
            value={setTamices}
            options={[
              { label: 'AF (fino)', value: 'AF' },
              { label: 'AG (grueso)', value: 'AG' },
              { label: 'Custom', value: 'CUSTOM' },
            ]}
            onChange={(e) => e.value != null && handleCambioSet(e.value)}
          />
        </div>
        <div className="col-12 md:col-4 flex align-items-end gap-2">
          {setTamices === 'CUSTOM' && (
            <Button icon="fa-solid fa-plus" label="Agregar" severity="secondary" outlined size="small" onClick={agregarFila} />
          )}
        </div>
      </div>

      <DataTable
        value={filas}
        size="small"
        stripedRows
        emptyMessage="Sin tamices definidos."
        responsiveLayout="scroll"
      >
        <Column
          header="Tamiz (mm)"
          body={(row, opts) => (
            <InputNumber
              value={row.tamizMm}
              onValueChange={(e) => actualizarFila(opts.rowIndex, 'tamizMm', e.value)}
              min={0.075}
              max={100}
              minFractionDigits={2}
              maxFractionDigits={3}
              disabled={setTamices !== 'CUSTOM'}
              className="w-full"
              inputClassName="w-full"
            />
          )}
          style={{ width: '110px' }}
        />
        <Column
          header={tipoEntrada === 'PASANTE_ACUM' ? '% Pasante acumulado' : '% Retenido acumulado'}
          body={(row, opts) => (
            <InputNumber
              value={row.valor}
              onValueChange={(e) => actualizarFila(opts.rowIndex, 'valor', e.value)}
              min={0}
              max={100}
              minFractionDigits={1}
              maxFractionDigits={1}
              suffix=" %"
              className="w-full"
              inputClassName="w-full"
            />
          )}
        />
        {resultado && (
          <>
            <Column header="% Pasante" body={(_, opts) => {
              const f = resultado.filas.find((x) => x.tamizMm === filas[opts.rowIndex]?.tamizMm);
              return f ? f.pasanteAcum.toFixed(1) : '—';
            }} />
            <Column header="% Ret. acum." body={(_, opts) => {
              const f = resultado.filas.find((x) => x.tamizMm === filas[opts.rowIndex]?.tamizMm);
              return f ? f.retenidoAcum.toFixed(1) : '—';
            }} />
            <Column header="% Ret. parcial" body={(_, opts) => {
              const f = resultado.filas.find((x) => x.tamizMm === filas[opts.rowIndex]?.tamizMm);
              return f ? f.retenidoParcial.toFixed(1) : '—';
            }} />
          </>
        )}
        {setTamices === 'CUSTOM' && (
          <Column header="" body={(_, opts) => (
            <Button icon="fa-solid fa-trash" size="small" severity="danger" text onClick={() => quitarFila(opts.rowIndex)} />
          )} style={{ width: '50px' }} />
        )}
      </DataTable>

      {resultado && (
        <div className="surface-100 border-round p-3 mt-3 flex flex-wrap gap-4 align-items-center">
          <div>
            <span className="text-500 text-sm block">Módulo de finura</span>
            <span className="text-900 font-bold text-2xl">
              {resultado.mf != null ? resultado.mf : <span className="text-color-secondary">—</span>}
            </span>
            <small className="text-color-secondary block">
              {setTamices === 'AF' && 'Serie AF: rango típico 2,3 – 3,1 (IRAM 1666)'}
              {setTamices === 'AG' && 'Serie AG según TMN'}
              {setTamices === 'CUSTOM' && 'Custom: define la serie completa para que se calcule MF'}
            </small>
          </div>
        </div>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   9. Bandas IRAM 1627 — Agregado fino (HER-26)
   IRAM 1627 Tabla 1 — curva A (inferior común) vs curva B (banda
   primaria, restrictiva, §3.2.3.2.b). NO incluye la banda ampliada
   A-C (§3.2.3.2.d, requiere evidencia técnica), ni la tolerancia
   §3.2.4 de 10 pp en 1,18/0,600/0,300 mm, ni la reducción §3.2.3
   de A en 0,300/0,150 mm que aplica condicionalmente (cemento + aire
   intencional / aditivo mineral). Para verificación completa con
   contexto del hormigón, usar el evaluador del módulo Ensayos —
   `granulometriaEvalService` es la SSoT.

   Valores corregidos por revisor-civil (sesión 2026-05-10):
   - 0,300 min: 5 → 10 (5 era el valor REDUCIDO condicional).
   - 0,150 min: 0 → 2 (idem).
   ═════════════════════════════════════ */
const BANDA_AF_IRAM_1627_AB = [
  { tamizMm: 9.50,  min: 100, max: 100 },
  { tamizMm: 4.75,  min:  95, max: 100 },
  { tamizMm: 2.36,  min:  80, max: 100 },
  { tamizMm: 1.18,  min:  50, max:  85 },
  { tamizMm: 0.600, min:  25, max:  60 },
  { tamizMm: 0.300, min:  10, max:  30 },
  { tamizMm: 0.150, min:   2, max:  10 },
];

const BandasIRAM1627 = () => {
  const { isDark } = useContext(ThemeContext);
  const [pasantes, setPasantes] = useState(() =>
    BANDA_AF_IRAM_1627_AB.map((b) => ({ tamizMm: b.tamizMm, pct: null }))
  );

  const actualizarPasante = (idx, valor) => {
    setPasantes((prev) => prev.map((p, i) => (i === idx ? { ...p, pct: valor } : p)));
  };

  const veredictoPorTamiz = useMemo(() => {
    return pasantes.map((p) => {
      const banda = BANDA_AF_IRAM_1627_AB.find((b) => Math.abs(b.tamizMm - p.tamizMm) < 0.001);
      if (!banda || !Number.isFinite(p.pct)) return { ...p, banda, dentro: null };
      return { ...p, banda, dentro: p.pct >= banda.min && p.pct <= banda.max };
    });
  }, [pasantes]);

  const cumpleTotal = useMemo(() => {
    const completos = veredictoPorTamiz.filter((v) => v.dentro != null);
    if (completos.length === 0) return null;
    return completos.every((v) => v.dentro);
  }, [veredictoPorTamiz]);

  // Chart.js: bandas + curva del usuario.
  const chartData = useMemo(() => {
    // Eje X: log (mm) → mostramos directamente las labels de tamices.
    const labels = BANDA_AF_IRAM_1627_AB.map((b) => `${b.tamizMm}`);
    const mins = BANDA_AF_IRAM_1627_AB.map((b) => b.min);
    const maxs = BANDA_AF_IRAM_1627_AB.map((b) => b.max);
    const curva = veredictoPorTamiz.map((v) => Number.isFinite(v.pct) ? v.pct : null);
    return {
      labels,
      datasets: [
        {
          label: 'Banda A–B (límite superior · curva B)',
          data: maxs,
          borderColor: '#10B981',
          backgroundColor: 'rgba(16,185,129,0.15)',
          borderDash: [6, 4],
          fill: '+1',  // rellena hacia el siguiente dataset (el mínimo) → área de la banda
          pointRadius: 0,
        },
        {
          label: 'Banda A–B (límite inferior · curva A)',
          data: mins,
          borderColor: '#10B981',
          borderDash: [6, 4],
          fill: false,
          pointRadius: 0,
        },
        {
          label: 'Curva ingresada',
          data: curva,
          borderColor: '#3B82F6',
          backgroundColor: '#3B82F6',
          fill: false,
          pointRadius: 4,
          tension: 0.2,
          spanGaps: true,
        },
      ],
    };
  }, [veredictoPorTamiz]);

  const chartOptions = useMemo(() => {
    const textColor          = isDark ? '#E5E7EB' : '#374151';
    const textColorSecondary = isDark ? '#9CA3AF' : '#6B7280';
    const surfaceBorder      = isDark ? 'rgba(255,255,255,0.08)' : 'rgba(0,0,0,0.08)';
    return {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { position: 'bottom', labels: { color: textColor, usePointStyle: true } },
      },
      scales: {
        y: {
          title: { display: true, text: '% Pasante acumulado', color: textColorSecondary },
          min: 0, max: 100,
          ticks: { color: textColorSecondary },
          grid: { color: surfaceBorder },
        },
        x: {
          title: { display: true, text: 'Tamiz (mm)', color: textColorSecondary },
          ticks: { color: textColorSecondary },
          grid: { color: surfaceBorder },
          reverse: true,  // tamiz mayor a la izquierda (convención granulometría).
        },
      },
    };
  }, [isDark]);

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Bandas IRAM 1627 — Agregado fino (banda primaria A–B)</h4>
      <p className="text-sm text-500 mb-3">
        Visualiza la curva granulométrica ingresada contra la <strong>banda primaria A–B</strong>
        de <strong>IRAM 1627 Tabla 1</strong> (agregado fino natural o triturado). Para cada tamiz:
        <strong> verde</strong> si está dentro de la banda, <strong>rojo</strong> si está fuera.
      </p>
      <Message
        severity="info"
        className="w-full mb-3"
        content={
          <div className="text-xs">
            <strong>Alcance limitado.</strong> Esta calculadora muestra solo la banda primaria A–B.
            NO contempla la <strong>banda ampliada A–C</strong> (§3.2.3.2.d, requiere evidencia
            técnica), ni la <strong>tolerancia §3.2.4</strong> de 10 pp en los tamices 1,18 / 0,600 /
            0,300, ni la <strong>reducción §3.2.3</strong> de A en 0,300 / 0,150 mm que aplica
            condicionalmente (con cemento + aire intencional / aditivo mineral). Para verificación
            normativa completa con contexto del hormigón, usar el evaluador del módulo Ensayos.
          </div>
        }
      />

      <div className="grid">
        <div className="col-12 lg:col-5">
          <DataTable value={veredictoPorTamiz} size="small" stripedRows responsiveLayout="scroll">
            <Column header="Tamiz" body={(r) => `${r.tamizMm} mm`} style={{ width: '90px' }} />
            <Column header="Banda" body={(r) => r.banda ? `${r.banda.min} – ${r.banda.max}` : '—'} style={{ width: '90px' }} />
            <Column
              header="% Pasante"
              body={(r, opts) => (
                <InputNumber
                  value={r.pct}
                  onValueChange={(e) => actualizarPasante(opts.rowIndex, e.value)}
                  min={0} max={100}
                  minFractionDigits={1} maxFractionDigits={1}
                  suffix=" %"
                  className="w-full"
                  inputClassName="w-full"
                />
              )}
            />
            <Column
              header=""
              body={(r) => {
                if (r.dentro == null) return null;
                return r.dentro
                  ? <i className="fa-solid fa-check text-green-500" />
                  : <i className="fa-solid fa-xmark text-red-500" />;
              }}
              style={{ width: '50px' }}
            />
          </DataTable>

          <div className="mt-3">
            {cumpleTotal === true && (
              <Tag severity="success" icon="fa-solid fa-circle-check" value="Cumple banda A–B en todos los tamices" />
            )}
            {cumpleTotal === false && (
              <Tag severity="danger" icon="fa-solid fa-circle-xmark" value="Fuera de banda A–B en al menos un tamiz (puede estar dentro de A–C — verificar con evaluador completo)" />
            )}
            {cumpleTotal == null && (
              <Tag severity="info" icon="fa-solid fa-circle-info" value="Ingresar los pasantes para verificar" />
            )}
          </div>
        </div>

        <div className="col-12 lg:col-7">
          <div style={{ height: 'clamp(280px, 40vh, 420px)' }}>
            <PrimeChart type="line" data={chartData} options={chartOptions} style={{ height: '100%' }} />
          </div>
        </div>
      </div>
    </Card>
  );
};

/* ═════════════════════════════════════
   10. Masa de probeta cilíndrica / cúbica (HER-27)
   Fórmulas geométricas + densidad típica del hormigón.
   ═════════════════════════════════════ */
const FORMA_PROBETA_OPTIONS = [
  { label: 'Cilíndrica 10×20 (IRAM 1534)', value: 'CIL_10x20', dims: { d: 100, h: 200 } },
  { label: 'Cilíndrica 15×30 (IRAM 1534)', value: 'CIL_15x30', dims: { d: 150, h: 300 } },
  { label: 'Cúbica 15×15×15',              value: 'CUB_15',    dims: { a: 150 } },
  { label: 'Cúbica 20×20×20',              value: 'CUB_20',    dims: { a: 200 } },
  { label: 'Personalizada (cilíndrica)',   value: 'CIL_CUSTOM' },
  { label: 'Personalizada (cúbica)',       value: 'CUB_CUSTOM' },
];

const MasaProbeta = () => {
  const [forma, setForma] = useState('CIL_15x30');
  const [diametro, setDiametro] = useState(150);
  const [altura, setAltura] = useState(300);
  const [arista, setArista] = useState(150);
  const [densidad, setDensidad] = useState(2400);

  // Setear dimensiones default cuando se cambia la forma
  useEffect(() => {
    const def = FORMA_PROBETA_OPTIONS.find((o) => o.value === forma);
    if (!def?.dims) return;
    if (def.dims.d != null) { setDiametro(def.dims.d); setAltura(def.dims.h); }
    if (def.dims.a != null) { setArista(def.dims.a); }
  }, [forma]);

  const esCubica = forma.startsWith('CUB');

  const resultado = useMemo(() => {
    if (!Number.isFinite(densidad) || densidad <= 0) return null;
    let volumenCm3 = null;
    if (esCubica) {
      if (!Number.isFinite(arista) || arista <= 0) return null;
      volumenCm3 = (arista / 10) ** 3;  // mm → cm
    } else {
      if (!Number.isFinite(diametro) || diametro <= 0) return null;
      if (!Number.isFinite(altura) || altura <= 0) return null;
      const r = (diametro / 10) / 2;  // mm → cm
      const h = altura / 10;
      volumenCm3 = Math.PI * r * r * h;
    }
    const volumenM3 = volumenCm3 / 1_000_000;
    const masaKg = volumenM3 * densidad;
    return {
      volumenCm3: Math.round(volumenCm3 * 100) / 100,
      volumenLitros: Math.round((volumenCm3 / 1000) * 1000) / 1000,
      volumenM3: Math.round(volumenM3 * 1_000_000) / 1_000_000,
      masaKg: Math.round(masaKg * 1000) / 1000,
    };
  }, [forma, diametro, altura, arista, densidad, esCubica]);

  return (
    <Card className="shadow-1">
      <h4 className="mt-0">Masa estimada de probeta</h4>
      <p className="text-sm text-500 mb-3">
        Estima el volumen y la masa de una probeta a partir de su geometría y la densidad
        del hormigón. La densidad típica del hormigón normal es <strong>2300 – 2500 kg/m³</strong>
        (default 2400). Para hormigón liviano, ajustar el valor.
      </p>

      <div className="grid mb-3 align-items-end">
        <div className="col-12 md:col-5">
          <label className="block text-sm mb-1">Forma</label>
          <Dropdown
            value={forma}
            options={FORMA_PROBETA_OPTIONS}
            onChange={(e) => setForma(e.value)}
            className="w-full"
          />
        </div>
        {!esCubica ? (
          <>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">Diámetro (mm)</label>
              <InputNumber
                value={diametro}
                onValueChange={(e) => setDiametro(e.value)}
                min={10} max={500}
                disabled={forma !== 'CIL_CUSTOM'}
                className="w-full" inputClassName="w-full"
              />
            </div>
            <div className="col-6 md:col-2">
              <label className="block text-sm mb-1">Altura (mm)</label>
              <InputNumber
                value={altura}
                onValueChange={(e) => setAltura(e.value)}
                min={10} max={1000}
                disabled={forma !== 'CIL_CUSTOM'}
                className="w-full" inputClassName="w-full"
              />
            </div>
          </>
        ) : (
          <div className="col-12 md:col-2">
            <label className="block text-sm mb-1">Arista (mm)</label>
            <InputNumber
              value={arista}
              onValueChange={(e) => setArista(e.value)}
              min={10} max={500}
              disabled={forma !== 'CUB_CUSTOM'}
              className="w-full" inputClassName="w-full"
            />
          </div>
        )}
        <div className="col-12 md:col-3">
          <label className="block text-sm mb-1">
            Densidad (kg/m³)
            <i
              className="fa-solid fa-circle-question ml-1 text-400 dens-tip"
              style={{ fontSize: '0.75rem', cursor: 'help' }}
              data-pr-tooltip="Hormigón normal: 2300-2500. Liviano: 1400-2000. Pesado: > 2600."
            />
            <Tooltip target=".dens-tip" style={{ maxWidth: 240 }} />
          </label>
          <InputNumber
            value={densidad}
            onValueChange={(e) => setDensidad(e.value)}
            min={500} max={5000}
            className="w-full" inputClassName="w-full"
          />
        </div>
      </div>

      {resultado && (
        <div className="surface-100 border-round p-3">
          <div className="grid">
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Volumen</span>
              <span className="text-900 font-bold">{resultado.volumenCm3} cm³</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Equivalente</span>
              <span className="text-900 font-bold">{resultado.volumenLitros} L</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Volumen (m³)</span>
              <span className="text-900 font-bold">{resultado.volumenM3.toExponential(2)}</span>
            </div>
            <div className="col-6 md:col-3">
              <span className="text-500 text-sm block">Masa estimada</span>
              <span className="text-900 font-bold text-xl">{resultado.masaKg} kg</span>
            </div>
          </div>
        </div>
      )}
    </Card>
  );
};

/* ═════════════════════════════════════
   Main page
   ═════════════════════════════════════ */
const HerramientasPage = () => {
  return (
    <div className="p-3">
      <PageHeader
        icon="fa-solid fa-toolbox"
        title="Herramientas"
        subtitle="Calculadoras rápidas para el laboratorio: conversión de edades, estadísticas, humedad, unidades y temperatura."
      />

      {/* PR9 NO aplica acá: las calculadoras usan fórmulas y constantes
          normativas fijas (CIRSOC/IRAM). El catálogo del tenant no
          puede relativizar π, las constantes ACI 209, ni el factor
          1,28 del fractil 10%. Ver CLAUDE.md raíz §"Modelo dual de
          evaluación → IMPORTANTE - DÓNDE APLICA LA DUALIDAD". */}

      <TabView>
        <TabPanel header="Tabla 2.5 — Durabilidad" leftIcon="fa-solid fa-shield-halved mr-2">
          <TablaDurabilidad />
        </TabPanel>
        <TabPanel header="Tabla 4.3 — Aire por TMN" leftIcon="fa-solid fa-wind mr-2">
          <TablaAirePorTMN />
        </TabPanel>
        <TabPanel header="Tabla 4.4 — Pulverulento mínimo" leftIcon="fa-solid fa-mortar-pestle mr-2">
          <TablaPulverulentoMinimo />
        </TabPanel>
        <TabPanel header="§4.1.5.2 — Cemento mínimo" leftIcon="fa-solid fa-cubes mr-2">
          <CementoMinimoCirsoc />
        </TabPanel>
        <TabPanel header="a/c desde f'c objetivo" leftIcon="fa-solid fa-divide mr-2">
          <EstimadorAC />
        </TabPanel>
        <TabPanel header="Conversión de edad" leftIcon="fa-solid fa-clock mr-2">
          <ConversionEdad />
        </TabPanel>
        <TabPanel header="Desvío / f'ck" leftIcon="fa-solid fa-chart-simple mr-2">
          <CalculadoraDesvio />
        </TabPanel>
        <TabPanel header="Corrección por humedad" leftIcon="fa-solid fa-droplet mr-2">
          <CorreccionHumedad />
        </TabPanel>
        <TabPanel header="Conversor de unidades" leftIcon="fa-solid fa-exchange-alt mr-2">
          <ConversorUnidades />
        </TabPanel>
        <TabPanel header="Temperatura H° fresco" leftIcon="fa-solid fa-temperature-high mr-2">
          <TemperaturaHormigon />
        </TabPanel>
        <TabPanel header="Pasante / Retenido" leftIcon="fa-solid fa-arrow-right-arrow-left mr-2">
          <ConvertidorTamizado />
        </TabPanel>
        <TabPanel header="Bandas IRAM 1627" leftIcon="fa-solid fa-chart-area mr-2">
          <BandasIRAM1627 />
        </TabPanel>
        <TabPanel header="Masa de probeta" leftIcon="fa-solid fa-weight-hanging mr-2">
          <MasaProbeta />
        </TabPanel>
      </TabView>
    </div>
  );
};

export default HerramientasPage;
