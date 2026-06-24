import React, { useEffect, useState, useCallback, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { Fade } from "react-awesome-reveal";
import { DataTable } from "primereact/datatable";
import { Column } from "primereact/column";
import { Button } from "primereact/button";
import { InputText } from "primereact/inputtext";
import { Tag } from "primereact/tag";
import { InputSwitch } from "primereact/inputswitch";
import { Tooltip } from "primereact/tooltip";
import { Message } from "primereact/message";
import { confirmDialog } from "primereact/confirmdialog";
import axios from "axios";
import { config } from "../../../config/config";
import { formatDateDMY } from "../../../common/functions";
import PageHeader from "../../../common/components/PageHeader/PageHeader";
import { useToast } from "../../../context/ToastContext";
import { useUserContext } from "../../../context/UserContext";
import useCanPerform from "../../../lib/roles/useCanPerform";

/**
 * Calcula el factor de resistencia esperado para una edad de ensayo dada.
 * @param {number} edadEnsayo - Edad del ensayo en dias
 * @param {number} edadDisenio - Edad de diseno en dias (ej: 28)
 * @returns {number|null} factor (0.70, 0.85, 1.0) o null si no aplica
 */
export const getFactorEdad = (edadEnsayo, edadDisenio) => {
    if (!edadEnsayo || !edadDisenio) return null;
    if (edadEnsayo >= 6 && edadEnsayo <= 8) return 0.70;
    if (edadEnsayo >= 13 && edadEnsayo <= 15) return 0.85;
    if (edadEnsayo >= edadDisenio - 1 && edadEnsayo <= edadDisenio + 1) return 1.0;
    return null;
};

/**
 * Determina el color de cumplimiento de resistencia.
 * @returns {'green'|'orange'|'red'|null}
 */
export const getColorCumplimiento = (resistencia, resistenciaObjetivo, edadEnsayo, edadDisenio) => {
    const factor = getFactorEdad(edadEnsayo, edadDisenio);
    if (factor == null || !resistenciaObjetivo || !resistencia) return null;
    const meta = resistenciaObjetivo * factor;
    if (resistencia >= meta) return 'green';
    if (resistencia >= meta * 0.85) return 'orange';
    return 'red';
};

const severityMap = { green: 'success', orange: 'warning', red: 'danger' };

/**
 * Sprint 6 B1 (sesión 2026-05-10): fuente canónica del f'c es
 * `TipoHormigon.fcMpa` (campo DB declarado, fuente única). Si el
 * tenant tiene tipos legacy sin fcMpa o tipos con nombre exótico
 * tipo "Especial", caemos al regex del nombre como fallback. Antes
 * usaba SOLO el regex, lo que fallaba con tipos sin dígito ("Especial",
 * "H-A1", etc.) → color quedaba null y el ensayo no se podía pre-aprobar.
 */
const extractResObjetivo = (e) => {
    const tipo = e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon
        || e.probeta?.muestraTerceros?.tipoHormigon
        || null;
    // 1. Preferir el campo canónico fcMpa.
    if (tipo?.fcMpa != null) {
        const n = Number(tipo.fcMpa);
        if (Number.isFinite(n) && n > 0) return n;
    }
    // 2. Fallback: regex del nombre (legacy).
    const th = tipo?.tipoHormigon || '';
    const match = th.match(/\d+/);
    return match ? Number(match[0]) : null;
};

const extractEdadDisenio = (e) => {
    return e.probeta?.muestra?.despacho?.dosificacion?.edadDisenio?.dias ?? null;
};

const getColorEnsayo = (e) => {
    const res = Number(e.resistencia);
    const resObj = extractResObjetivo(e);
    const edadDis = extractEdadDisenio(e);
    return getColorCumplimiento(res, resObj, e.edadEnsayo, edadDis);
};

export default function RevisionesEnsayo() {
    const [ensayos, setEnsayos] = useState([]);
    const [loading, setLoading] = useState(true);
    const [search, setSearch] = useState("");
    // Sprint 5 M6: debounce 300 ms para el filtro de búsqueda. Antes
    // filtraba en cada keystroke (con muchos ensayos podía laggear).
    const [searchDebounced, setSearchDebounced] = useState("");
    // Sprint 5 M6: paginación controlada — al cambiar filtros se resetea
    // (regla CLAUDE.md). El DataTable acepta `first` controlado.
    const [first, setFirst] = useState(0);
    const [selectedEnsayos, setSelectedEnsayos] = useState([]);
    const [approving, setApproving] = useState(false);
    const approvingRef = useRef(false);

    // Configuracion de aprobacion automatica
    const [aprobacionAutomatica, setAprobacionAutomatica] = useState(false);
    const [savingConfig, setSavingConfig] = useState(false);
    const savingConfigRef = useRef(false);

    const navigate = useNavigate();
    const toast = useToast();
    const { user } = useUserContext();
    const can = useCanPerform(user);
    const puedeAprobarConDesvios = can('ensayo.aprobarMasivoConDesvios');
    const puedeCambiarConfigAuto = can('config.aprobacionAutomatica');

    // M6: debounce de search.
    useEffect(() => {
        const t = setTimeout(() => setSearchDebounced(search), 300);
        return () => clearTimeout(t);
    }, [search]);
    // M6: paginación reset al cambiar el filtro debounced.
    useEffect(() => { setFirst(0); }, [searchDebounced]);

    const fetchEnsayos = useCallback(async () => {
        try {
            setLoading(true);
            const { data } = await axios.get(
                `${config.backendUrl}/api/probetas/ensayos-pendientes-revision`,
                { headers: config.headers }
            );
            setEnsayos(data);
            setSelectedEnsayos([]);
        } catch (err) {
            // Sprint 5 M1: catch ya no es silencioso (regla CLAUDE.md).
            console.error('[RevisionesEnsayo] fetchEnsayos:', err);
            toast('error', 'No se pudieron cargar los ensayos pendientes de revisión.');
            setEnsayos([]);
        } finally {
            setLoading(false);
        }
    }, [toast]);

    // Cargar configuracion actual
    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const { data } = await axios.get(
                    `${config.backendUrl}/api/config/all`,
                    { headers: config.headers }
                );
                setAprobacionAutomatica(data.aprobacionAutomaticaEnsayos ?? false);
            } catch (err) {
                // M1: este sí queda con warn (no es bloqueante — solo
                // cargamos un default false), pero al menos lo logueamos
                // para no perder señales de problemas de auth o red.
                console.warn('[RevisionesEnsayo] No se pudo cargar Config:', err.message || err);
            }
        };
        fetchConfig();
    }, []);

    useEffect(() => { fetchEnsayos(); }, [fetchEnsayos]);

    const handleToggleAprobacion = async (value) => {
        if (!puedeCambiarConfigAuto) {
            toast('warn',
                'Solo el Director Técnico (o un administrador) puede cambiar este parámetro. ' +
                'Desactivar la revisión humana afecta el protocolo de control de calidad (IRAM 1666 §A.7).'
            );
            return;
        }
        // Confirmación explícita por la implicancia normativa.
        const confirmar = window.confirm(
            value
                ? 'Está por DESACTIVAR la revisión humana de ensayos. Esta opción vulnera la segregación de funciones exigida por IRAM 1666:2020 §A.7 e ISO 17025 §7.8. Solo recomendable en entornos pre-acreditación.\n\n¿Confirma activar la aprobación automática?'
                : '¿Confirma volver al modo de revisión manual? A partir de ahora cada ensayo cargado quedará pendiente hasta que un Responsable de Calidad lo apruebe.'
        );
        if (!confirmar) return;

        if (savingConfigRef.current) return;
        savingConfigRef.current = true;
        setSavingConfig(true);
        try {
            await axios.put(
                `${config.backendUrl}/api/config`,
                { aprobacionAutomaticaEnsayos: value },
                { headers: config.headers }
            );
            setAprobacionAutomatica(value);
            toast('success', value
                ? 'Aprobación automática activada'
                : 'Revisión manual activada'
            );
        } catch {
            toast('error', 'No se pudo guardar la configuración');
        } finally {
            savingConfigRef.current = false;
            setSavingConfig(false);
        }
    };

    // Sprint 5 M6: filtro sobre el `searchDebounced` para evitar refiltrar
    // en cada keystroke (con miles de ensayos puede laggear el render).
    const filtered = ensayos.filter((e) => {
        if (!searchDebounced.trim()) return true;
        const s = searchDebounced.toLowerCase();
        const nombre = (e.probeta?.nombre || e.probeta?.codigo || '').toLowerCase();
        const remito = (e.probeta?.muestra?.despacho?.remito || e.probeta?.muestraTerceros?.remito || '').toLowerCase();
        const tipoH = (e.probeta?.muestra?.despacho?.dosificacion?.tipoHormigon?.tipoHormigon
            || e.probeta?.muestraTerceros?.tipoHormigon?.tipoHormigon || '').toLowerCase();
        const operario = e.operarioEnsayo
            ? `${e.operarioEnsayo.apellido} ${e.operarioEnsayo.nombre}`.toLowerCase()
            : '';
        return nombre.includes(s) || remito.includes(s) || tipoH.includes(s) || operario.includes(s);
    });

    // Sprint 5 M4: intersectar la selección con los visibles cuando cambia
    // el filtro. Antes, los seleccionados que dejaban de estar en `filtered`
    // permanecían en `selectedEnsayos` (ocultos) y el botón "Aprobar
    // seleccionados" podía aprobar ensayos no visibles para el usuario.
    useEffect(() => {
        setSelectedEnsayos((prev) => {
            if (prev.length === 0) return prev;
            const visiblesSet = new Set(filtered.map((e) => e.idEnsayoResistencia));
            const next = prev.filter((e) => visiblesSet.has(e.idEnsayoResistencia));
            return next.length === prev.length ? prev : next;
        });
        // Solo nos importa la lista de visibles, no las otras deps.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [searchDebounced, ensayos]);

    const ensayosVerdes = filtered.filter((e) => getColorEnsayo(e) === 'green');

    const handleSelectVerdes = () => {
        setSelectedEnsayos(ensayosVerdes);
    };

    // Sprint 2 — aprobación masiva con manejo de 403 (lote con desvíos
    // requiere DT) y 400 (falta motivo). El backend valida y rebota.
    const enviarAprobacionMasivo = async (ids, motivoAprobacionMasiva = undefined) => {
        if (approvingRef.current) return;
        approvingRef.current = true;
        setApproving(true);
        try {
            const payload = motivoAprobacionMasiva
                ? { ids, motivoAprobacionMasiva }
                : { ids };
            const { data } = await axios.put(
                `${config.backendUrl}/api/probetas/ensayos/aprobar-masivo`,
                payload,
                { headers: config.headers }
            );
            const aprobados = data.aprobados;
            toast('success', `${aprobados} ensayo${aprobados !== 1 ? 's' : ''} aprobado${aprobados !== 1 ? 's' : ''}`);
            await fetchEnsayos();
        } catch (err) {
            const status = err?.response?.status;
            const body = err?.response?.data;
            if (status === 403 && body?.requierePermisoDesvios) {
                const dv = body.desvios || {};
                const cuantos = (dv.naranjas?.length || 0) + (dv.rojos?.length || 0) + (dv.indeterminados?.length || 0);
                toast('error',
                    `El lote incluye ${cuantos} ensayo${cuantos !== 1 ? 's' : ''} fuera del rango esperado para la edad. ` +
                    'Solo un Director Técnico puede aprobarlos en masivo. ' +
                    'Aprobarlos uno por uno desde la vista detalle, o pedir aprobación al DT.'
                );
            } else if (status === 400 && body?.motivo === 'motivo_aprobacion_masiva_faltante') {
                // El usuario es DT y el backend pide motivo. Re-pedimos.
                const motivo = window.prompt(
                    'El lote incluye ensayos con desvíos respecto del rango esperado para la edad. ' +
                    'Como DT, está autorizado a aprobarlos en masivo. Por favor documente el motivo (mínimo 10 caracteres):'
                );
                if (motivo && motivo.trim().length >= 10) {
                    approvingRef.current = false;
                    await enviarAprobacionMasivo(ids, motivo.trim());
                    return;
                }
                toast('warn', 'Aprobación cancelada: falta motivo documentado.');
            } else {
                console.error('Error al aprobar ensayos masivamente:', err);
                toast('error', body?.error || 'No se pudieron aprobar los ensayos');
            }
        } finally {
            approvingRef.current = false;
            setApproving(false);
        }
    };

    const handleAprobarMasivo = (ids, label) => {
        if (!ids || ids.length === 0) {
            toast('warn', 'No hay ensayos para aprobar');
            return;
        }
        confirmDialog({
            message: `¿Aprobar ${ids.length} ensayo${ids.length !== 1 ? 's' : ''}? ${label}`,
            header: 'Confirmar aprobación masiva',
            icon: 'fa-solid fa-circle-check',
            acceptLabel: 'Aprobar',
            rejectLabel: 'Cancelar',
            acceptClassName: 'p-button-success',
            accept: () => enviarAprobacionMasivo(ids),
        });
    };

    const cols = [
        {
            header: "Fecha ensayo",
            body: (e) => formatDateDMY(e.fechaEnsayo),
            sortable: true,
        },
        {
            header: "Probeta",
            body: (e) => (
                <span className="font-bold">
                    {e.probeta?.nombre || e.probeta?.codigo || '-'}
                </span>
            ),
        },
        {
            header: "Remito",
            body: (e) => e.probeta?.muestra?.despacho?.remito
                || e.probeta?.muestraTerceros?.remito || '-',
        },
        {
            header: "Dosificación",
            body: (e) => e.probeta?.muestra?.despacho?.dosificacion?.nombre
                || e.probeta?.muestraTerceros?.tipoHormigon?.tipoHormigon || '-',
        },
        {
            header: "Edad",
            body: (e) => e.edadEnsayo ? `${e.edadEnsayo} d` : '-',
        },
        {
            header: "Resistencia",
            body: (e) => {
                const res = Number(e.resistencia);
                const resObj = extractResObjetivo(e);
                const edadDis = extractEdadDisenio(e);
                const color = getColorCumplimiento(res, resObj, e.edadEnsayo, edadDis);
                if (!res) return '-';
                return (
                    <Tag
                        severity={color ? severityMap[color] : 'info'}
                        value={`${res.toFixed(1)} MPa`}
                    />
                );
            },
        },
        {
            header: "Operario",
            body: (e) => e.operarioEnsayo
                ? `${e.operarioEnsayo.apellido}, ${e.operarioEnsayo.nombre}`
                : '-',
        },
        {
            header: "Planta",
            body: (e) => e.probeta?.muestra?.despacho?.planta?.nombre
                || e.probeta?.muestraTerceros?.planta?.nombre || '-',
        },
        {
            header: "",
            body: (e) => (
                <Button
                    icon="fa-solid fa-magnifying-glass"
                    rounded
                    size="small"
                    tooltip="Revisar"
                    onClick={() => navigate(`/calidad/revisiones-ensayos/revisar/${e.idEnsayoResistencia}`)}
                />
            ),
        },
    ];

    return (
        <Fade triggerOnce>
            <PageHeader
                icon="fa-solid fa-clipboard-check"
                title="Revisiones de ensayos"
                subtitle="Validación según IRAM 1666:2020 §A.7.10 (autocontrol del productor)"
            />

            {/* Sprint 3 (sesión 2026-05-10) — banner permanente cuando el
                toggle "Aprobación automática" está ON. Es el modo más
                riesgoso: cada ensayo cargado se aprueba al instante sin
                revisión humana, vulnerando IRAM 1666:2020 §A.7 (segregación
                de funciones) e ISO 17025 §7.8 (control de informes). El
                banner queda visible siempre que el modo esté activado para
                que el operario en planta no lo olvide. */}
            {aprobacionAutomatica && (
                <Message
                    severity="warn"
                    className="w-full mt-3"
                    content={
                        <div className="flex align-items-start gap-2">
                            <i className="fa-solid fa-triangle-exclamation mt-1" />
                            <div className="text-sm">
                                <strong>Modo de aprobación automática activo.</strong>
                                {' '}Cada ensayo cargado se aprueba al instante sin revisión humana.
                                Este modo vulnera la segregación de funciones exigida por <strong>IRAM 1666:2020 §A.7</strong>
                                {' '}e <strong>ISO 17025 §7.8</strong>. Usar solo en entornos pre-acreditación
                                o sin emisión de certificados externos.
                            </div>
                        </div>
                    }
                />
            )}

            <div className="flex align-items-center justify-content-between gap-2 mt-3 mb-3">
                <div className="flex align-items-center gap-2 flex-1">
                    <span className="p-input-icon-left search-bar-wrapper">
                        <InputText
                            value={search}
                            onChange={(ev) => setSearch(ev.target.value)}
                            placeholder="Buscar revisión..."
                            title="Buscar por probeta, remito, dosificación u operario"
                            className="search-bar"
                        />
                    </span>
                    <Button
                        icon="fa-solid fa-arrows-rotate"
                        rounded
                        text
                        onClick={fetchEnsayos}
                        tooltip="Actualizar"
                    />
                </div>

                {/* Toggle aprobación automática */}
                <div className="flex align-items-center gap-3 surface-card border-round px-3 py-2 shadow-1">
                    <div className="text-right">
                        <div className="flex align-items-center justify-content-end gap-2 mb-1">
                            <span className="font-semibold text-sm">
                                {aprobacionAutomatica ? 'Aprobación automática' : 'Revisión manual'}
                            </span>
                            <Tooltip
                                target=".revision-mode-help"
                                position="left"
                                style={{ maxWidth: 320 }}
                                content={
                                    'Revisión manual: cada ensayo queda pendiente hasta que un responsable de calidad lo revise y apruebe antes de aparecer en reportes y portal.\n\n' +
                                    'Aprobación automática: los ensayos se aprueban instantáneamente al ser cargados sin revisión previa. Usar solo si no se requiere control de calidad.'
                                }
                            />
                            <i
                                className="fa-solid fa-circle-question text-400 cursor-pointer revision-mode-help"
                                style={{ fontSize: '0.95rem' }}
                            />
                        </div>
                        <div className="text-500 text-xs">
                            {aprobacionAutomatica
                                ? 'Los ensayos se aprueban al crearse'
                                : 'Los ensayos requieren revisión'}
                        </div>
                    </div>
                    <InputSwitch
                        checked={aprobacionAutomatica}
                        onChange={(e) => handleToggleAprobacion(e.value)}
                        disabled={savingConfig || !puedeCambiarConfigAuto}
                        tooltip={
                            !puedeCambiarConfigAuto
                                ? 'Solo el Director Técnico puede cambiar este parámetro (IRAM 1666 §A.7 segregación de funciones).'
                                : undefined
                        }
                    />
                </div>
            </div>

            {/* Barra de acciones masivas. Sprint 2:
                - "Aprobar todos dentro del rango esperado para la edad":
                  visible para RC+, solo verdes (factores de referencia, no normativos).
                - "Aprobar seleccionados": visible siempre, pero si la
                  selección incluye desvíos, el backend exige rol DT + motivo.
                  El handler maneja el 403/400 y pide el motivo. */}
            <div className="flex align-items-center gap-2 mb-2 flex-wrap">
                <Button
                    icon="fa-solid fa-check-double"
                    label={`Aprobar todos dentro del rango esperado para la edad (${ensayosVerdes.length})`}
                    severity="success"
                    size="small"
                    disabled={ensayosVerdes.length === 0 || approving}
                    tooltip="Aprueba en lote los ensayos cuya resistencia cae dentro del rango esperado para la edad. Los factores 0,70 (7d) y 0,85 (14d) son referencias técnicas (ACI 209R) — no son límites normativos."
                    tooltipOptions={{ position: 'bottom', style: { maxWidth: 360 } }}
                    onClick={() =>
                        handleAprobarMasivo(
                            ensayosVerdes.map((e) => e.idEnsayoResistencia),
                            'Solo se aprobarán los ensayos dentro del rango esperado.'
                        )
                    }
                />
                <Button
                    icon="fa-solid fa-list-check"
                    label={
                        puedeAprobarConDesvios
                            ? `Aprobar seleccionados (${selectedEnsayos.length})`
                            : `Aprobar seleccionados (${selectedEnsayos.length}) — solo verdes`
                    }
                    severity="success"
                    outlined
                    size="small"
                    disabled={selectedEnsayos.length === 0 || approving}
                    tooltip={
                        puedeAprobarConDesvios
                            ? 'Aprueba los ensayos marcados. Si incluye desvíos, se pedirá motivo (rol DT requerido).'
                            : 'Aprueba los ensayos marcados. Si la selección incluye ensayos fuera del rango esperado, el sistema rechazará el lote (requiere rol Director Técnico).'
                    }
                    tooltipOptions={{ position: 'bottom', style: { maxWidth: 360 } }}
                    onClick={() =>
                        handleAprobarMasivo(
                            selectedEnsayos.map((e) => e.idEnsayoResistencia),
                            'Se aprobarán los ensayos seleccionados.'
                        )
                    }
                />
                <Button
                    icon="fa-solid fa-circle-check"
                    label="Seleccionar verdes"
                    severity="secondary"
                    outlined
                    size="small"
                    disabled={ensayosVerdes.length === 0}
                    tooltip="Marca en la tabla todos los ensayos dentro del rango esperado para la edad"
                    tooltipOptions={{ position: 'bottom' }}
                    onClick={handleSelectVerdes}
                />
                {selectedEnsayos.length > 0 && (
                    <Button
                        icon="fa-solid fa-xmark"
                        label="Limpiar selección"
                        severity="secondary"
                        text
                        size="small"
                        onClick={() => setSelectedEnsayos([])}
                    />
                )}
            </div>

            <DataTable responsiveLayout="scroll"
                value={filtered}
                loading={loading}
                emptyMessage={
                    aprobacionAutomatica
                        ? 'La aprobación automática está activa. No hay ensayos pendientes de revisión.'
                        : 'No hay ensayos pendientes de revisión'
                }
                stripedRows
                scrollable
                paginator
                rows={30}
                first={first}
                onPage={(e) => setFirst(e.first)}
                className="w-full"
                selection={selectedEnsayos}
                onSelectionChange={(e) => setSelectedEnsayos(e.value)}
                selectionMode="multiple"
                dataKey="idEnsayoResistencia"
                sortField="fechaEnsayo"
                sortOrder={-1}
            >
                <Column selectionMode="multiple" style={{ width: '3rem' }} />
                {cols.map((c, i) => (
                    <Column
                        key={i}
                        header={c.header}
                        body={c.body}
                        sortable={c.sortable}
                    />
                ))}
            </DataTable>
        </Fade>
    );
}
