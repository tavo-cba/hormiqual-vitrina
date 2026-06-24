/**
 * HomeCompromisosCard.jsx
 *
 * Card destacada del home para usuarios con acceso al módulo de Compromisos.
 * Muestra los próximos compromisos de PAGO (egresos) y, con un switch, los de
 * COBRO (ingresos), dentro de una ventana de días configurable.
 *
 * Los montos en moneda extranjera se muestran en su moneda + equivalente en
 * pesos. Cotización: la de la ocurrencia/compromiso, o la de referencia de la
 * API como último recurso.
 *
 * Se puede ocultar (persiste en localStorage) y re-habilitar desde el módulo
 * de Compromisos.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Dropdown } from 'primereact/dropdown';
import { SelectButton } from 'primereact/selectbutton';
import { Button } from 'primereact/button';
import { Tooltip } from 'primereact/tooltip';
import axios from 'axios';
import { config } from '../../config/config';
import './HomeCompromisosCard.css';

// Flag de visibilidad compartido con el módulo Compromisos (para re-habilitar).
export const LS_KEY_OCULTO = 'home-compromisos-oculto';

const DIAS_OPCIONES = [
    { label: '30 días', value: 30 },
    { label: '15 días', value: 15 },
    { label: '7 días', value: 7 },
    { label: '3 días', value: 3 },
    { label: '1 día', value: 1 },
];

const LS_KEY_DIAS = 'home-compromisos-dias';
const LS_KEY_MODO = 'home-compromisos-modo';

const toDateOnly = (d) => {
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
};

const fmtMoneda = (valor, moneda) => new Intl.NumberFormat('es-AR', {
    style: 'currency',
    currency: moneda === 'USD' ? 'USD' : 'ARS',
    minimumFractionDigits: 2,
}).format(Number(valor) || 0);

const fmtFechaCorta = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y.slice(2)}`;
};

/** Texto relativo: "Hoy", "Mañana", "En 5 días", "Hace 3 días". */
const textoDias = (iso) => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    const fecha = new Date(y, m - 1, d);
    const diff = Math.round((fecha - hoy) / 86400000);
    if (diff === 0) return 'Hoy';
    if (diff === 1) return 'Mañana';
    if (diff > 1) return `En ${diff} días`;
    if (diff === -1) return 'Ayer';
    return `Hace ${Math.abs(diff)} días`;
};

/** Cotización aplicable a una ocurrencia (moneda→ARS), con fallback a la de referencia. */
const cotizacionDe = (o, cotizRef) => {
    const moneda = o.compromiso?.moneda || 'ARS';
    if (moneda === 'ARS') return 1;
    const propia = Number(o.cotizacionReal ?? o.cotizacion ?? o.compromiso?.cotizacionEstimada);
    if (Number.isFinite(propia) && propia > 0) return propia;
    return cotizRef && cotizRef > 0 ? cotizRef : null;
};

const HomeCompromisosCard = () => {
    const [oculto, setOculto] = useState(() => localStorage.getItem(LS_KEY_OCULTO) === 'true');
    const [dias, setDias] = useState(() => {
        const saved = Number(localStorage.getItem(LS_KEY_DIAS));
        return DIAS_OPCIONES.some((o) => o.value === saved) ? saved : 7;
    });
    const [modo, setModo] = useState(() => localStorage.getItem(LS_KEY_MODO) || 'pago');
    const [ocurrencias, setOcurrencias] = useState([]);
    const [cotizRef, setCotizRef] = useState(null);
    const [loading, setLoading] = useState(false);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const hoy = new Date();
            hoy.setHours(0, 0, 0, 0);
            const hasta = new Date(hoy);
            hasta.setDate(hasta.getDate() + dias);
            const [ocRes, cotizRes] = await Promise.allSettled([
                axios.get(`${config.backendUrl}/api/compromisos/ocurrencias`, {
                    headers: config.headers,
                    params: { desde: toDateOnly(hoy), hasta: toDateOnly(hasta) },
                }),
                axios.get(`${config.backendUrl}/api/compromisos/cotizacion-dolar`, {
                    headers: config.headers,
                }),
            ]);
            if (ocRes.status === 'fulfilled') {
                const lista = (Array.isArray(ocRes.value.data) ? ocRes.value.data : []).filter(
                    (o) => o.estado === 'pendiente' || o.estado === 'vencido'
                );
                setOcurrencias(lista);
            } else {
                setOcurrencias([]);
            }
            if (cotizRes.status === 'fulfilled') {
                const v = Number(cotizRes.value.data?.cotizacion);
                setCotizRef(Number.isFinite(v) && v > 0 ? v : null);
            }
        } catch (err) {
            console.error('Error cargando compromisos del home:', err);
            setOcurrencias([]);
        } finally {
            setLoading(false);
        }
    }, [dias]);

    useEffect(() => { if (!oculto) cargar(); }, [cargar, oculto]);

    const handleDias = (value) => {
        setDias(value);
        localStorage.setItem(LS_KEY_DIAS, String(value));
    };
    const handleModo = (value) => {
        if (!value) return;
        setModo(value);
        localStorage.setItem(LS_KEY_MODO, value);
    };
    const ocultar = () => {
        localStorage.setItem(LS_KEY_OCULTO, 'true');
        setOculto(true);
    };

    // Separar por tipo, calcular conversión a pesos y totales
    const { items, totalPesos, totalUSD, vencidos, hayParcial } = useMemo(() => {
        const tipoBuscado = modo === 'pago' ? 'egreso' : 'ingreso';
        const filtradas = ocurrencias
            .filter((o) => (o.compromiso?.tipo || 'egreso') === tipoBuscado)
            .sort((a, b) => String(a.fechaProgramada).localeCompare(String(b.fechaProgramada)));

        let sumaPesos = 0;
        let sumaUSD = 0;
        let countVencidos = 0;
        let parcial = false;

        const enriquecidas = filtradas.map((o) => {
            const moneda = o.compromiso?.moneda || 'ARS';
            const montoOriginal = Number(o.montoProyectado) || 0;
            const cotiz = cotizacionDe(o, cotizRef);
            const montoPesos = cotiz ? montoOriginal * cotiz : null;
            if (o.estado === 'vencido') countVencidos += 1;
            if (moneda === 'ARS') {
                sumaPesos += montoOriginal;
            } else {
                sumaUSD += montoOriginal;
                if (montoPesos != null) sumaPesos += montoPesos;
                else parcial = true; // un USD sin cotización no entra al total en pesos
            }
            return { ...o, _moneda: moneda, _montoOriginal: montoOriginal, _montoPesos: montoPesos };
        });

        return {
            items: enriquecidas,
            totalPesos: sumaPesos,
            totalUSD: sumaUSD,
            vencidos: countVencidos,
            hayParcial: parcial,
        };
    }, [ocurrencias, modo, cotizRef]);

    // Return temprano DESPUÉS de todos los hooks (regla de hooks de React)
    if (oculto) return null;

    const esPago = modo === 'pago';
    const hoyISO = toDateOnly(new Date());

    return (
        <div className={`hcc-card ${esPago ? 'hcc-card--pago' : 'hcc-card--cobro'}${!loading && items.length === 0 ? ' hcc-card--vacia' : ''}`}>
            <Tooltip target=".hcc-cerrar" position="left" />
            <div className="hcc-header">
                <div className="hcc-title">
                    <span className="hcc-title-icon">
                        <i className={esPago ? 'fa-solid fa-money-bill-wave' : 'fa-solid fa-hand-holding-dollar'} />
                    </span>
                    <div>
                        <h3>Próximos compromisos</h3>
                        <small>{esPago ? 'Pagos próximos a vencer' : 'Cobros próximos a percibir'}</small>
                    </div>
                </div>
                <div className="hcc-controls">
                    <SelectButton
                        value={modo}
                        onChange={(e) => handleModo(e.value)}
                        options={[
                            { label: 'A pagar', value: 'pago' },
                            { label: 'A cobrar', value: 'cobro' },
                        ]}
                    />
                    <Dropdown
                        value={dias}
                        options={DIAS_OPCIONES}
                        onChange={(e) => handleDias(e.value)}
                        className="hcc-dias"
                    />
                    <Button
                        icon="fa-solid fa-xmark"
                        rounded
                        text
                        severity="secondary"
                        className="hcc-cerrar"
                        onClick={ocultar}
                        data-pr-tooltip="Ocultar del inicio (lo podés volver a activar desde Compromisos)"
                    />
                </div>
            </div>

            {loading ? (
                <div className="hcc-empty">
                    <i className="pi pi-spin pi-spinner" style={{ fontSize: '1.4rem' }} />
                </div>
            ) : items.length === 0 ? (
                <div className="hcc-empty">
                    <i className="fa-solid fa-circle-check" />
                    <span>No hay {esPago ? 'pagos' : 'cobros'} en los próximos {dias} {dias === 1 ? 'día' : 'días'}</span>
                </div>
            ) : (
                <>
                    {vencidos > 0 && (
                        <div className="hcc-vencidos-aviso">
                            <i className="fa-solid fa-triangle-exclamation" />
                            {vencidos} {vencidos === 1 ? 'compromiso vencido' : 'compromisos vencidos'} — requieren atención inmediata
                        </div>
                    )}
                    <div className="hcc-list">
                        {items.map((o) => {
                            const fechaISO = String(o.fechaProgramada).slice(0, 10);
                            const esVencido = o.estado === 'vencido';
                            const esHoy = fechaISO === hoyISO;
                            const esUSD = o._moneda !== 'ARS';
                            return (
                                <div
                                    key={o.idOcurrenciaCompromiso}
                                    className={`hcc-row ${esVencido ? 'hcc-row--vencido' : esHoy ? 'hcc-row--hoy' : ''}`}
                                >
                                    <div className="hcc-row-fecha">
                                        <strong>{fmtFechaCorta(fechaISO)}</strong>
                                        <span className={`hcc-dias-rel ${esVencido ? 'hcc-dias-rel--vencido' : esHoy ? 'hcc-dias-rel--hoy' : ''}`}>
                                            {textoDias(fechaISO)}
                                        </span>
                                    </div>
                                    <div className="hcc-row-desc">
                                        {o.compromiso?.descripcion || 'Compromiso'}
                                    </div>
                                    <div className="hcc-row-monto">
                                        {esUSD ? (
                                            <>
                                                <span className="hcc-monto-principal">
                                                    {fmtMoneda(o._montoOriginal, 'USD')}
                                                </span>
                                                <span className="hcc-monto-secundario">
                                                    {o._montoPesos != null
                                                        ? `≈ ${fmtMoneda(o._montoPesos, 'ARS')}`
                                                        : 'sin cotización'}
                                                </span>
                                            </>
                                        ) : (
                                            <span className="hcc-monto-principal">
                                                {fmtMoneda(o._montoOriginal, 'ARS')}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="hcc-footer">
                        <div className="hcc-total">
                            <span>Total {esPago ? 'a pagar' : 'a cobrar'} (en pesos)</span>
                            <div className="hcc-total-montos">
                                <strong>{fmtMoneda(totalPesos, 'ARS')}</strong>
                                {totalUSD > 0 && (
                                    <span className="hcc-total-usd">
                                        incluye {fmtMoneda(totalUSD, 'USD')} en dólares
                                        {hayParcial && ' (parte sin cotización)'}
                                    </span>
                                )}
                            </div>
                        </div>
                        <Link to="/admin/compromisos" className="hcc-link">
                            Ver todos <i className="fa-solid fa-arrow-right" />
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
};

export default HomeCompromisosCard;
