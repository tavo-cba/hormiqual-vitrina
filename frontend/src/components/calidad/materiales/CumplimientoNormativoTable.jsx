import React, { useMemo } from 'react';
import { Tag } from 'primereact/tag';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import {
  CATEGORIA_COLORS,
  VEREDICTO,
  getCategoriaVeredicto,
  fromLegacyEval,
} from '../../../lib/compliance';
import { formatParamValue } from '../../../lib/format/agregado';

/**
 * CumplimientoNormativoTable — sección "E" del detalle de material.
 * Itera los requisitos CIRSOC/IRAM y muestra Estado por requisito.
 *
 * Prompt 3 C3 — migración a categorías visuales canónicas:
 *   - STATUS_CONFIG eliminado: ahora consume CATEGORIA_COLORS del lib.
 *   - Estados internos del componente (`cumple`/`atencion`/`no_cumple`/`info`/`sin_dato`)
 *     se mapean a categorías visuales canónicas (APTO/APTO CON OBSERVACIONES/etc.).
 *   - Para requisitos que son 1:1 con un ensayo (terrones, sulfatos, cloruros,
 *     materia orgánica, etc.), preferimos el `compliance.status` canónico
 *     persistido en `ensayoSrc.resultado._evaluacion.compliance` (post-C6
 *     backend). Fallback: re-evaluación local del cliente.
 *   - Para requisitos que son sub-aspectos calculados de un ensayo
 *     (granulometría AF: 4 filas; densidad: 4 filas; PUC/PUS), NO sobreescribimos
 *     con el compliance del ensayo entero — cada fila representa un requisito
 *     normativo distinto y el compliance global del ensayo no aplica per fila.
 *     Marcamos esos `add(...)` con `{ usarCanonico: false }`.
 *
 * Hybrid Option B (D15+D20): un ensayo en passWithObservations canónico (ej:
 * granulometría individual fuera de banda en Arideros 6, materia orgánica
 * con excepción §3.2.3.4 b) ahora se renderiza como "APTO CON OBSERVACIONES"
 * con icono distintivo, en vez del antiguo "NO CUMPLE" rojo.
 */

/** Mapeo de estado interno del componente → categoría visual canónica. */
function mapEstadoInternoACategoria(estado) {
  switch (estado) {
    case 'cumple':    return VEREDICTO.APTO;
    case 'atencion':  return VEREDICTO.APTO_CON_OBSERVACIONES;
    case 'no_cumple': return VEREDICTO.NO_APTO;
    case 'info':      return VEREDICTO.INFORMATIVO;
    case 'sin_dato':  return VEREDICTO.EVALUACION_INCOMPLETA;
    default:          return VEREDICTO.EVALUACION_INCOMPLETA;
  }
}

/**
 * Decide la categoría visual final de una fila.
 *
 * Si la fila representa el veredicto canónico del ensayo entero
 * (`opts.usarCanonico !== false`), prefiere el compliance persistido
 * (post-C6) o el shape legacy via fromLegacyEval. Sino, mapea el estado
 * interno calculado por el componente.
 */
function decidirCategoria(estadoInterno, ensayoSrc, opts = {}) {
  const usarCanonico = opts.usarCanonico !== false;
  if (usarCanonico && ensayoSrc) {
    const persisted = ensayoSrc?.resultado?._evaluacion?.compliance;
    if (persisted?.status) {
      return getCategoriaVeredicto(persisted);
    }
    // Fallback legacy: ensayo persistido pre-C6 sin compliance canónico.
    if (ensayoSrc.cumple || ensayoSrc.estado) {
      return getCategoriaVeredicto(fromLegacyEval(ensayoSrc));
    }
  }
  return mapEstadoInternoACategoria(estadoInterno);
}

function evalMax(val, lim) {
  if (val == null) return 'sin_dato';
  if (val > lim) return 'no_cumple';
  return 'cumple';
}
function evalMin(val, lim) {
  if (val == null) return 'sin_dato';
  if (val < lim) return 'no_cumple';
  return 'cumple';
}
function evalRange(val, min, max) {
  if (val == null) return 'sin_dato';
  if (val < min || val > max) return 'no_cumple';
  return 'cumple';
}

function fmt(v, dec = 2) {
  if (v == null) return '—';
  const n = Number(v);
  return isNaN(n) ? String(v) : n.toLocaleString('es-AR', { minimumFractionDigits: dec, maximumFractionDigits: dec });
}

/**
 * Evalúa la vigencia de un ensayo a partir de su fechaVencimiento.
 * Retorna null si no hay fecha; sino { dias, estado, color }.
 *   estado: 'vencido' | 'critico' (≤7d) | 'proximo' (≤30d) | 'ok' (>30d)
 * Espejo de la helper en MaterialDetailPage. Si aparece un tercer call site,
 * extraer a `lib/vigencia.js` compartido.
 */
function evaluarVigencia(fechaVencimiento) {
  if (!fechaVencimiento) return null;
  const venc = new Date(fechaVencimiento);
  if (isNaN(venc.getTime())) return null;
  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const dias = Math.round((venc - hoy) / 86400000);
  if (dias < 0)   return { dias, estado: 'vencido',  color: '#dc2626', label: `Vencido ${Math.abs(dias)}d` };
  if (dias <= 7)  return { dias, estado: 'critico',  color: '#dc2626', label: `${dias}d` };
  if (dias <= 30) return { dias, estado: 'proximo',  color: '#d97706', label: `${dias}d` };
  return { dias, estado: 'ok', color: '#059669', label: `${dias}d` };
}

function findEnsayo(ensayos, codigoIncludes) {
  return ensayos.find(e => {
    const cod = e.tipo?.codigo || e.AgregadoEnsayoTipo?.codigo || '';
    return codigoIncludes.some(c => cod.includes(c));
  });
}

function parseResultado(ens) {
  if (!ens) return null;
  let r = ens.resultado;
  if (typeof r === 'string') { try { r = JSON.parse(r); } catch { r = null; } }
  return r;
}

export default function CumplimientoNormativoTable({ ensayos = [], tipoAgregado = 'Fino' }) {
  const esFino = tipoAgregado.toUpperCase() === 'FINO';

  const rows = useMemo(() => {
    const items = [];

    /**
     * Helper. `opts.usarCanonico=false` para sub-aspectos de un ensayo
     * (granulometría, densidad, PUC/PUS, TMN) — el compliance global del
     * ensayo no aplica per fila en esos casos.
     */
    const add = (requisito, unidad, especificacion, resultado, estadoInterno, obs, ensayoSrc, opts = {}) => {
      items.push({
        requisito,
        unidad,
        especificacion,
        resultado: resultado ?? '—',
        estadoInterno,
        categoria: decidirCategoria(estadoInterno, ensayoSrc, opts),
        obs: obs || '',
        vence: ensayoSrc?.fechaVencimiento || null,
      });
    };

    // ── Densidades (IRAM 1520 / 1533) ── (4 filas → sub-aspectos info, sin canónico)
    const denEns = findEnsayo(ensayos, esFino ? ['1520_DENSIDAD'] : ['1533_DENSIDAD']);
    const denR = parseResultado(denEns);
    add('Densidad estado SSS (d3)', '—', 'Sin requisito', denR?.densidadRelativaAparenteSSS != null ? formatParamValue('densidadSSS', denR.densidadRelativaAparenteSSS) : null, 'info', '', denEns, { usarCanonico: false });
    add('Densidad seca (d2)', '—', 'Sin requisito', denR?.densidadRelativaAparenteSeca != null ? formatParamValue('densidadSeca', denR.densidadRelativaAparenteSeca) : null, 'info', '', denEns, { usarCanonico: false });
    add('Densidad real (d1)', '—', 'Sin requisito', denR?.densidadRelativaReal != null ? formatParamValue('densidadReal', denR.densidadRelativaReal) : null, 'info', '', denEns, { usarCanonico: false });
    const abs = denR?.absorcionPct;
    add('Absorción', '%', 'Sin requisito', abs != null ? formatParamValue('absorcion', abs) : null, 'info',
      abs != null && abs > (esFino ? 3 : 2) ? 'Valor elevado; monitorear demanda de agua' : '', denEns, { usarCanonico: false });

    // ── MF (derivado de granulometría) ── (sub-aspecto, sin canónico)
    const mfEns = findEnsayo(ensayos, ['MODULO_FINEZA', 'MODULO_FINURA']);
    const mfR = parseResultado(mfEns);
    const mfVal = mfR?.valor;
    const granEns = findEnsayo(ensayos, ['1505_GRANULOMETRIA']);
    const granR = parseResultado(granEns);
    const mf = mfVal ?? granR?.granulometria?.evaluacionAuto?.moduloFinura?.valor ?? granR?.granulometria?.evaluacion?.calculos?.moduloFinura?.valor ?? granR?.granulometria?.moduloFinura;

    if (esFino) {
      add('Módulo de finura', '—', '2,3 a 3,1', mf != null ? formatParamValue('mf', mf) : null, evalRange(mf, 2.3, 3.1),
        mf != null && mf < 2.3 ? 'MF < 2,3. Arena fina, mezclar con arena más gruesa (§3.2.3.2 b)' : '', mfEns || granEns, { usarCanonico: false });
    } else {
      add('Módulo de finura', '—', 'Sin requisito', mf != null ? formatParamValue('mf', mf) : null, 'info', '', mfEns || granEns, { usarCanonico: false });
    }

    // TMN (only for grueso) — sub-aspecto info
    if (!esFino) {
      const tmnEns = findEnsayo(ensayos, ['TMN']);
      const tmnR = parseResultado(tmnEns);
      const tmn = tmnR?.valor ?? granR?.granulometria?.tmn;
      add('TMN', 'mm', 'Sin requisito', tmn != null ? `${formatParamValue('tmn', tmn)} mm` : null, 'info', '', tmnEns || granEns, { usarCanonico: false });
    }

    // ── Pasante #200 (IRAM 1540) ── (1:1 con ensayo, canónico aplica)
    const pasEns = findEnsayo(ensayos, ['1540', '1674_MATERIAL']);
    const pasR = parseResultado(pasEns);
    const pasVal = pasR?.pasa200Pct ?? pasR?.valor;
    if (esFino) {
      add('Pasante tamiz #200', '%', '≤ 3,0 / ≤ 5,0 (1)', pasVal != null ? formatParamValue('pasa200', pasVal) : null, evalMax(pasVal, 5.0),
        '(1) 3,0% con desgaste superficial; 5,0% otros. Arena trituración: +2 pp', pasEns);
    } else {
      add('Pasante tamiz #200', '%', '≤ 1,0 / ≤ 1,5 (1)', pasVal != null ? formatParamValue('pasa200', pasVal) : null, evalMax(pasVal, 1.5),
        '(1) 1,0% grava/canto rodado; 1,5% piedra partida. Ajustable por §3.2.4.3 c)', pasEns);
    }

    // ── Terrones de arcilla ── (1:1 canónico)
    const terrEns = findEnsayo(ensayos, ['TERRONES']);
    const terrR = parseResultado(terrEns);
    const terrVal = terrR?.valor;
    const limTerr = esFino ? 3.0 : 2.0;
    add('Terrones de arcilla y p.f.', '%', `≤ ${fmt(limTerr, 1)}`, terrVal != null ? formatParamValue('terronesArcilla', terrVal) : null, evalMax(terrVal, limTerr), '', terrEns);

    // ── Durabilidad sulfato sodio ── (1:1 canónico)
    const durEns = findEnsayo(ensayos, ['1525_DURABILIDAD', '1648_ESTABILIDAD']);
    const durR = parseResultado(durEns);
    const durVal = durR?.perdidaPct ?? durR?.valor;
    const limDur = esFino ? 10 : 12;
    add('Pérdida sulfato de sodio', '%', `≤ ${limDur} (2)`, durVal != null ? formatParamValue('perdidaSulfato', durVal) : null, evalMax(durVal, limDur),
      '(2) Solo para clases C1/C2 (congelación). Otros: informativo.', durEns);

    // ── Sulfatos SO3 ── (1:1 canónico)
    const sulfEns = findEnsayo(ensayos, ['SULFATOS']);
    const sulfR = parseResultado(sulfEns);
    const sulfVal = sulfR?.valor;
    const limSulf = esFino ? 0.1 : 0.075;
    add('Sulfatos (como SO3)', '%', `≤ ${fmt(limSulf, 3)}`, sulfVal != null ? formatParamValue('sulfatosSO3', sulfVal) : null, evalMax(sulfVal, limSulf), '', sulfEns);

    // ── Cloruros (1:1 canónico) ──
    const clorEns = findEnsayo(ensayos, ['CLORUROS']);
    const clorR = parseResultado(clorEns);
    const clorVal = clorR?.valor;
    const clorOp = clorR?.operador || (clorR?.esMenorQue ? 'menor_que' : null);
    const clorPfx = clorOp === 'menor_que' ? '< ' : clorOp === 'mayor_que' ? '> ' : '';
    // Cloruros: operador censurado preserva el qualifier; se muestra siempre con la
    // precisión canónica del parámetro (`cloruros` = 2 decimales) — no más 3 decimales
    // engañosos en valores como "< 0,003".
    const clorDisplay = clorOp
      ? `${clorPfx}${formatParamValue('cloruros', clorVal)}`
      : (clorVal != null ? formatParamValue('cloruros', clorVal) : null);
    if (esFino) {
      const clorEfectivo = clorOp === 'menor_que' ? 0 : clorVal;
      add('Cloruros solubles', '%', '<= 0,04 (3)', clorDisplay, clorVal != null ? evalMax(clorEfectivo, 0.04) : 'sin_dato',
        '(3) IRAM 1512 Tabla 1. Ademas aplica al hormigon (art. 2.2.8).', clorEns);
    } else {
      let clorEstado = 'sin_dato';
      let clorObs = '(3) IRAM 1531 Tabla 1. Ademas aplica al hormigon (art. 2.2.8).';
      if (clorVal != null) {
        if (clorOp === 'menor_que' && clorVal > 0.003) {
          clorEstado = 'sin_dato';
          clorObs = '(3) IRAM 1531 Tabla 1 (<= 0,003%). Precisión insuficiente. Solicitar ensayo con precisión <= 0,001%.';
        } else if (clorOp === 'mayor_que' && clorVal > 0.003) {
          clorEstado = 'no_cumple';
        } else {
          clorEstado = evalMax(clorOp === 'menor_que' ? 0 : clorVal, 0.003);
        }
      }
      add('Cloruros solubles', '%', '<= 0,003 (3)', clorDisplay, clorEstado, clorObs, clorEns);
    }

    // ── Sales solubles ── (1:1 canónico)
    const salEns = findEnsayo(ensayos, ['SALES_SOLUBLES']);
    const salR = parseResultado(salEns);
    const salVal = salR?.valor;
    add('Sales solubles totales', '%', '≤ 1,5', salVal != null ? formatParamValue('salesSolubles', salVal) : null, evalMax(salVal, 1.5), '', salEns);

    // ── Materia orgánica ── (1:1 canónico — caso paradigmático §3.2.3.4 b)
    if (esFino) {
      const orgEns = findEnsayo(ensayos, ['MATERIA_ORGANICA']);
      const orgR = parseResultado(orgEns);
      const orgCualit = orgR?.resultadoColorimetrico;
      add('Materia orgánica', 'mg/kg', '< 500', orgCualit === 'menor_500' ? '< 500' : orgCualit === 'igual_o_mayor_500' ? '≥ 500' : null,
        orgCualit === 'menor_500' ? 'cumple' : orgCualit === 'igual_o_mayor_500' ? 'no_cumple' : 'sin_dato',
        'Si ≥ 500: excepción posible con ensayo de morteros (§3.2.3.4 b)', orgEns);
    }

    // ── Materias carbonosas ── (1:1 canónico — caso D15 zona dual)
    const carbEns = findEnsayo(ensayos, ['MATERIAS_CARBONOSAS']);
    const carbR = parseResultado(carbEns);
    const carbVal = carbR?.valor;
    add('Materias carbonosas', '%', '≤ 0,5 / ≤ 1,0 (4)', carbVal != null ? formatParamValue('materiasCarbonosas', carbVal) : null, evalMax(carbVal, 1.0),
      esFino ? '(4) 0,5% si aspecto superficial importante; 1,0% otros' : '(4) 0,5% si C1/C2 o abrasión; 1,0% otros', carbEns);

    // ── Equivalente arena ── (1:1 canónico)
    if (esFino) {
      const eaEns = findEnsayo(ensayos, ['EQUIVALENTE_ARENA']);
      const eaR = parseResultado(eaEns);
      const eaVal = eaR?.equivalenteArenaPct ?? eaR?.ea_promedio ?? eaR?.valor;
      add('Equivalente de arena', '%', '≥ 75', eaVal != null ? formatParamValue('equivalenteArena', eaVal) : null, evalMin(eaVal, 75), '', eaEns);
    }

    // ── PUC / PUS ── (sub-aspectos info)
    const puEns = findEnsayo(ensayos, ['PESO_UNITARIO']);
    const puR = parseResultado(puEns);
    add('PUC', 'kg/m³', 'Sin requisito', puR?.puc != null ? formatParamValue('puc', puR.puc) : null, 'info', '', puEns, { usarCanonico: false });
    add('PUS', 'kg/m³', 'Sin requisito', puR?.pus != null ? formatParamValue('pus', puR.pus) : null, 'info', '', puEns, { usarCanonico: false });

    // ── Solo grueso (1:1 canónico para los 5) ──
    if (!esFino) {
      const lajEns = findEnsayo(ensayos, ['1687_1_LAJOSIDAD']);
      const lajR = parseResultado(lajEns);
      const lajVal = lajR?.lajosidadPct;
      add('Índice de lajosidad', '%', '≤ 30 / ≤ 25 (5)', lajVal != null ? formatParamValue('lajosidad', lajVal) : null, evalMax(lajVal, 30),
        '(5) 30% uso general; 25% para H ≥ 50 (Tabla 3.7)', lajEns);

      const elongEns = findEnsayo(ensayos, ['1687_2_ELONGACION']);
      const elongR = parseResultado(elongEns);
      const elongVal = elongR?.elongacionPct;
      add('Índice de elongación', '%', '≤ 45 / ≤ 40 (5)', elongVal != null ? formatParamValue('elongacion', elongVal) : null, evalMax(elongVal, 45),
        '(5) 45% uso general; 40% para H ≥ 50 (Tabla 3.7)', elongEns);

      const blandEns = findEnsayo(ensayos, ['PARTICULAS_BLANDAS']);
      const blandR = parseResultado(blandEns);
      const blandCualit = blandR?.resultadoCualitativo;
      add('Partículas blandas', '%', '≤ 5,0', blandCualit === 'no_contiene' ? 'No contiene' : (blandR?.valor != null ? formatParamValue('particulasBlandas', blandR.valor) : null),
        blandCualit === 'no_contiene' ? 'cumple' : evalMax(blandR?.valor, 5.0), '', blandEns);

      const laEns = findEnsayo(ensayos, ['DESGASTE_LA']);
      const laR = parseResultado(laEns);
      const laVal = laR?.losAngelesPct ?? laR?.perdidaPct ?? laR?.valor;
      add('Desgaste Los Ángeles', '%', '≤ 50 / ≤ 30 (6)', laVal != null ? formatParamValue('losAngeles', laVal) : null, evalMax(laVal, 50),
        '(6) 50% general; 30% si expuesto a abrasión (§3.2.4.5 b)', laEns);

      const polvoEns = findEnsayo(ensayos, ['POLVO_ADHERIDO']);
      const polvoR = parseResultado(polvoEns);
      const polvoVal = polvoR?.valor;
      add('Polvo adherido', '%', '≤ 1,5 (ref.)', polvoVal != null ? formatParamValue('polvoAdherido', polvoVal) : null, evalMax(polvoVal, 1.5),
        'Sin req. CIRSOC/IRAM directo. Referencia para pavimentos.', polvoEns);
    }

    // ── Granulometría — sub-aspectos calculados (4 filas AF, 1 fila AG)
    // SIN canónico: cada fila es su propio requisito normativo.
    if (granEns) {
      const ea = granR?.granulometria?.evaluacionAuto;
      const eag = granR?.granulometria?.evaluacionAutoGrueso;

      if (esFino && ea) {
        const abSt = ea.resultadoGlobal?.bandaAB;
        const tolPp = ea.tolerancia_3_2_4?.excesoTotal ?? ea.tolerancia10pp?.excesoTotal;
        const obsAB = abSt === 'cumple_con_tolerancia'
          ? `Cumple con tolerancia §3.2.4 (excedencia total ${tolPp ?? '?'} pp ≤ 10 pp en tamices 1,18 / 0,600 / 0,300 mm)`
          : ea.bandaAB?.fueraDeBanda > 0
            ? `Peor desvío: ${ea.bandaAB.peorDesvio} pp`
            : '';
        const resAB = abSt === 'cumple'
          ? 'Dentro'
          : abSt === 'cumple_con_tolerancia'
            ? `${ea.bandaAB?.fueraDeBanda || 0} sobre B (Σ${tolPp ?? '?'} pp)`
            : `${ea.bandaAB?.fueraDeBanda || 0} fuera`;
        add('Granulometría banda A-B', '—', 'IRAM 1627 §3.2.1 + §3.2.4',
          resAB,
          (abSt === 'cumple' || abSt === 'cumple_con_tolerancia') ? 'cumple' : abSt === 'no_cumple' ? 'no_cumple' : 'sin_dato',
          obsAB, granEns, { usarCanonico: false });

        const acSt = ea.resultadoGlobal?.bandaAC;
        add('Granulometría banda A-C', '—', 'IRAM 1627 §3.2.5',
          ea.bandaAC?.fueraDeBanda > 0 ? `${ea.bandaAC.fueraDeBanda} fuera` : 'Dentro',
          acSt === 'cumple' ? 'cumple' : 'no_cumple',
          acSt === 'cumple' ? 'Solo admisible en obras de tipo corriente con control en obra (§3.2.5). No para hormigón estructural.' : '', granEns, { usarCanonico: false });

        if (ea.tolerancia10pp?.aplica) {
          add('Tolerancia 10 pp (Curva B)', '—', '<= 10 pp',
            `${ea.tolerancia10pp.excesoTotal} pp`,
            ea.tolerancia10pp.cumple ? 'cumple' : 'no_cumple',
            'Tamices 1,18 / 600 / 300 µm (§3.2.3.2 d)', granEns, { usarCanonico: false });
        }

        const fracSt = ea.resultadoGlobal?.fraccion;
        add('Fracción máx. entre tamices', '%', '<= 45',
          ea.fraccionMaxima?.peorValor != null ? `${ea.fraccionMaxima.peorValor}` : null,
          fracSt === 'cumple' ? 'cumple' : 'no_cumple',
          ea.fraccionMaxima?.peorEntre ? `${ea.fraccionMaxima.peorEntre} (§3.2.3.2 e)` : '', granEns, { usarCanonico: false });
      }

      if (!esFino && eag) {
        const discrepancia = granR?.granulometria?._discrepanciaBanda;
        const evUsuario = granR?.granulometria?.evaluacion;
        const idCurvaObjetivo = granR?.granulometria?.idCurvaObjetivo;
        const nombreCurva = granR?.granulometria?.objetivo?.nombre;
        const usaCurva = idCurvaObjetivo != null && evUsuario != null;

        if (usaCurva) {
          const cumpleCurva = evUsuario.cumple === true;
          const nFuera = evUsuario.stats?.nFuera ?? 0;
          const resumen = cumpleCurva ? 'Dentro' : `${nFuera} fuera`;
          const especif = nombreCurva || `Curva objetivo #${idCurvaObjetivo}`;
          let estado;
          let obs;
          if (discrepancia) {
            estado = 'atencion';
            obs = discrepancia.mensaje;
          } else {
            estado = cumpleCurva ? 'cumple' : 'no_cumple';
            obs = cumpleCurva
              ? `Curva: ${especif}`
              : `Peor desvío: ${evUsuario.stats?.peorDesvioPct || 0} pp — Curva: ${especif}`;
          }
          add('Granulometría', '—', especif, resumen, estado, obs, granEns, { usarCanonico: false });
        } else {
          add('Granulometría', '—', `Tabla 3.5 (TMN ${eag.tmnMm || '—'} mm)`,
            eag.cumple ? 'Dentro' : `${eag.fueraDeBanda} fuera`,
            eag.cumple ? 'cumple' : 'no_cumple',
            eag.cumple ? `Granulometría ${eag.bandaNominal} mm` : `Peor desvío: ${eag.peorDesvio} pp`, granEns, { usarCanonico: false });
        }
      }
    }

    return items;
  }, [ensayos, esFino]);

  /** Renderiza el chip de la categoría visual con su severity + icon. */
  const statusBody = (row) => {
    const cfg = CATEGORIA_COLORS[row.categoria] || CATEGORIA_COLORS[VEREDICTO.EVALUACION_INCOMPLETA];
    return (
      <Tag value={row.categoria} severity={cfg.severity} icon={cfg.icon} />
    );
  };

  const vigenciaBody = (row) => {
    const v = evaluarVigencia(row.vence);
    if (!v) return <span className="text-color-secondary">—</span>;
    const titulo = `Vence: ${new Date(row.vence).toLocaleDateString('es-AR')} (${v.label})`;
    return (
      <span
        className="font-medium text-xs"
        style={{ color: v.color }}
        title={titulo}
      >
        {v.label}
      </span>
    );
  };

  /**
   * Background de la fila por categoría visual. Mantenemos la convención
   * del componente original: NO_APTO/APTITUD_CONDICIONADA tienen fondo
   * notable; APTO_CON_OBSERVACIONES queda con fondo blanco (el icono
   * informa la observación). Categorías neutras sin fondo.
   */
  const rowClass = (row) => {
    if (row.categoria === VEREDICTO.NO_APTO) return 'bg-red-50';
    if (row.categoria === VEREDICTO.APTITUD_CONDICIONADA) return 'bg-orange-50';
    return '';
  };

  const normasRef = esFino
    ? 'CIRSOC 200-2024 (Tablas 3.3, 3.4) · IRAM 1512 · IRAM 1627'
    : 'CIRSOC 200-2024 (Tablas 3.5, 3.6, 3.7) · IRAM 1531';

  return (
    <div>
      <DataTable responsiveLayout="scroll" value={rows} size="small" stripedRows rowClassName={rowClass} emptyMessage="Sin datos de cumplimiento.">
        <Column field="requisito" header="Requisito" style={{ minWidth: 180 }} />
        <Column field="unidad" header="Unidad" style={{ width: 60 }} className="text-center" />
        <Column field="especificacion" header="Especificación" style={{ width: 140 }} className="text-center" />
        <Column field="resultado" header="Resultado" style={{ width: 100 }} className="text-center font-bold" />
        <Column header="Vigencia" style={{ width: 90 }} body={vigenciaBody} className="text-center" />
        <Column header="Estado" style={{ width: 140 }} body={statusBody} className="text-center" />
        <Column field="obs" header="Observaciones" style={{ minWidth: 200 }} className="text-xs text-color-secondary" />
      </DataTable>
      <small className="text-color-secondary block mt-2">Normas de referencia: {normasRef}</small>
    </div>
  );
}
