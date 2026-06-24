/**
 * HomeObligacionesCard.jsx
 *
 * Card destacada del inicio para usuarios con acceso al módulo de Obligaciones.
 * Muestra las presentaciones / vencimientos normativos próximos a vencer.
 *
 * Cada obligación decide cuándo empieza a avisar con su `diasAnticipacion`: si
 * una obligación tiene 10 días de anticipación, aparece acá cuando falten 10
 * días o menos. El dropdown permite ampliar la ventana para mirar más adelante.
 *
 * Se puede ocultar (persiste en localStorage) y re-habilitar desde el módulo.
 */
import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Link } from 'react-router-dom';
import { Dropdown } from 'primereact/dropdown';
import { Button } from 'primereact/button';
import { Tooltip } from 'primereact/tooltip';
import axios from 'axios';
import { config } from '../../config/config';
import './HomeObligacionesCard.css';

// Flag de visibilidad compartido con el módulo Obligaciones (para re-habilitar).
export const LS_KEY_OCULTO = 'home-obligaciones-oculto';
const LS_KEY_DIAS = 'home-obligaciones-dias';

const DIAS_OPCIONES = [
    { label: 'Anticipación de cada una', value: 0 },
    { label: 'Próximos 15 días', value: 15 },
    { label: 'Próximos 30 días', value: 30 },
    { label: 'Próximos 60 días', value: 60 },
    { label: 'Próximos 90 días', value: 90 },
];

const fmtFechaCorta = (iso) => {
    if (!iso) return '';
    const [y, m, d] = String(iso).slice(0, 10).split('-');
    return `${d}/${m}/${y.slice(2)}`;
};

const diasHasta = (iso) => {
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    const [y, m, d] = String(iso).slice(0, 10).split('-').map(Number);
    return Math.round((new Date(y, m - 1, d) - hoy) / 86400000);
};

/** Texto del badge según los días que faltan. */
const badgeInfo = (iso) => {
    const d = diasHasta(iso);
    if (d < 0) return { cls: 'vencido', text: `Vencido hace ${Math.abs(d)}d` };
    if (d === 0) return { cls: 'hoy', text: 'Vence hoy' };
    if (d === 1) return { cls: 'proximo', text: 'Mañana' };
    return { cls: 'proximo', text: `En ${d} días` };
};

const HomeObligacionesCard = () => {
    const [oculto, setOculto] = useState(() => localStorage.getItem(LS_KEY_OCULTO) === 'true');
    const [dias, setDias] = useState(() => {
        const saved = Number(localStorage.getItem(LS_KEY_DIAS));
        return DIAS_OPCIONES.some((o) => o.value === saved) ? saved : 0;
    });
    const [ocurrencias, setOcurrencias] = useState([]);
    const [loading, setLoading] = useState(false);

    const cargar = useCallback(async () => {
        setLoading(true);
        try {
            const { data } = await axios.get(`${config.backendUrl}/api/obligaciones/avisos`, {
                headers: config.headers,
                params: { dias },
            });
            setOcurrencias(Array.isArray(data) ? data : []);
        } catch (err) {
            console.error('Error cargando obligaciones del inicio:', err);
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
    const ocultar = () => {
        localStorage.setItem(LS_KEY_OCULTO, 'true');
        setOculto(true);
    };

    const { items, vencidas } = useMemo(() => {
        const ordenadas = [...ocurrencias].sort(
            (a, b) => String(a.fechaLimite).localeCompare(String(b.fechaLimite))
        );
        return {
            items: ordenadas,
            vencidas: ordenadas.filter((o) => o.estado === 'vencido').length,
        };
    }, [ocurrencias]);

    if (oculto) return null;

    return (
        <div className={`hoc-card${!loading && items.length === 0 ? ' hoc-card--vacia' : ''}`}>
            <Tooltip target=".hoc-cerrar" position="left" />
            <div className="hoc-header">
                <div className="hoc-title">
                    <span className="hoc-title-icon">
                        <i className="fa-solid fa-file-circle-check" />
                    </span>
                    <div>
                        <h3>Obligaciones por vencer</h3>
                        <small>Presentaciones y vencimientos normativos próximos</small>
                    </div>
                </div>
                <div className="hoc-controls">
                    <Dropdown
                        value={dias}
                        options={DIAS_OPCIONES}
                        onChange={(e) => handleDias(e.value)}
                        className="hoc-dias"
                    />
                    <Button
                        icon="fa-solid fa-xmark"
                        rounded
                        text
                        severity="secondary"
                        className="hoc-cerrar"
                        onClick={ocultar}
                        data-pr-tooltip="Ocultar del inicio (lo podés volver a activar desde Obligaciones)"
                    />
                </div>
            </div>

            {loading ? (
                <div className="hoc-empty">
                    <i className="pi pi-spin pi-spinner" style={{ fontSize: '1.4rem' }} />
                </div>
            ) : items.length === 0 ? (
                <div className="hoc-empty">
                    <i className="fa-solid fa-circle-check" />
                    <span>No hay presentaciones por vencer en este momento</span>
                </div>
            ) : (
                <>
                    {vencidas > 0 && (
                        <div className="hoc-vencidos-aviso">
                            <i className="fa-solid fa-triangle-exclamation" />
                            {vencidas} {vencidas === 1 ? 'presentación vencida' : 'presentaciones vencidas'} — requieren atención inmediata
                        </div>
                    )}
                    <div className="hoc-list">
                        {items.map((o) => {
                            const badge = badgeInfo(o.fechaLimite);
                            return (
                                <div key={o.idOcurrenciaObligacion} className={`hoc-row hoc-row--${badge.cls}`}>
                                    <div className="hoc-row-fecha">
                                        <strong>{fmtFechaCorta(o.fechaLimite)}</strong>
                                        <span className={`hoc-badge hoc-badge--${badge.cls}`}>
                                            {badge.text}
                                        </span>
                                    </div>
                                    <div className="hoc-row-desc">
                                        <span className="hoc-row-desc-main">
                                            {o.obligacion?.descripcion || 'Obligación'}
                                        </span>
                                        {o.obligacion?.organismo && (
                                            <span className="hoc-row-desc-sub">{o.obligacion.organismo}</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                    <div className="hoc-footer">
                        <span className="hoc-total">
                            {items.length} {items.length === 1 ? 'presentación' : 'presentaciones'} para revisar
                        </span>
                        <Link to="/admin/obligaciones" className="hoc-link">
                            Ver todas <i className="fa-solid fa-arrow-right" />
                        </Link>
                    </div>
                </>
            )}
        </div>
    );
};

export default HomeObligacionesCard;
