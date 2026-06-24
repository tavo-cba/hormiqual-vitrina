import React, { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { InputText } from "primereact/inputtext";
import { Button } from "primereact/button";
import ImageUpload from "../../common/components/upload/ImageUpload";
import { Fade } from "react-awesome-reveal";
import axios from "axios";
import { config } from "../../config/config";
import { useToast } from "../../context/ToastContext";
import { InputNumber } from "primereact/inputnumber";
import { Divider } from "primereact/divider";
import { Dropdown } from "primereact/dropdown";
import { Calendar } from "primereact/calendar";
import { InputSwitch } from "primereact/inputswitch";
import { SelectButton } from "primereact/selectbutton";
import { InputTextarea } from "primereact/inputtextarea";
import { MultiSelect } from "primereact/multiselect";
import { Checkbox } from "primereact/checkbox";
import { Tooltip } from "primereact/tooltip";
import { ColorPicker } from "primereact/colorpicker";
import PageHeader from "../../common/components/PageHeader/PageHeader";
import './settings.css';
import { toLocalDate } from '../../common/functions';

const PROVINCIAS_ARGENTINA = [
    'BUENOS AIRES', 'CATAMARCA', 'CHACO', 'CHUBUT', 'CIUDAD AUTONOMA BUENOS AIRES',
    'CORDOBA', 'CORRIENTES', 'ENTRE RIOS', 'FORMOSA', 'JUJUY', 'LA PAMPA', 'LA RIOJA',
    'MENDOZA', 'MISIONES', 'NEUQUEN', 'RIO NEGRO', 'SALTA', 'SAN JUAN', 'SAN LUIS',
    'SANTA CRUZ', 'SANTA FE', 'SANTIAGO DEL ESTERO', 'TIERRA DEL FUEGO', 'TUCUMAN'
].map(p => ({ label: p, value: p }));

const condicionIvaOptions = [
    { label: 'IVA Responsable Inscripto', value: 1 },
    { label: 'IVA Responsable No Inscripto', value: 2 },
    { label: 'IVA Exento', value: 3 },
    { label: 'Consumidor Final', value: 4 },
    { label: 'Monotributista', value: 5 },
];

// Estructura de tabs: grupos padre + items hijos (subtabs).
// Si items === null, el grupo se renderiza directo sin subtabs.
const TAB_GROUPS = [
    {
        id: 'general',
        label: 'General',
        icon: 'fa-solid fa-gear',
        description: 'Datos de la empresa, logos y URLs públicas',
        items: null,
    },
    // [VITRINA] fuera de alcance: facturación (finanzas) — grupo 'facturacion'
    // (Datos AFIP / Remito electrónico / Retenciones) removido del menú de tabs.
    // [VITRINA] fuera de alcance: SMTP/IMAP/Geolocker/piletas — grupo 'integraciones' removido.
    {
        id: 'calidad',
        label: 'Calidad',
        icon: 'fa-solid fa-vial-circle-check',
        description: 'Probetas y unidad de carga en informes técnicos',
        items: null,
    },
];

const findGroup = (id) => TAB_GROUPS.find(g => g.id === id) || TAB_GROUPS[0];

const Settings = () => {
    const [nombreEmpresa, setNombreEmpresa] = useState("");
    const [logoLink, setLogoLink] = useState("");
    const [logoKey, setLogoKey] = useState("");
    const [logoLightLink, setLogoLightLink] = useState("");
    const [logoLightKey, setLogoLightKey] = useState("");
    const [thumbnail, setThumbnail] = useState("");
    const [thumbnailKey, setThumbnailKey] = useState("");
    const [fileKey, setFileKey] = useState(0);
    const [mailUser, setMailUser] = useState("");
    const [mailPassword, setMailPassword] = useState("");
    const [mailHost, setMailHost] = useState("");
    const [mailPort, setMailPort] = useState("");
    const [frontendUrl, setFrontendUrl] = useState("");
    const [portalUrl, setPortalUrl] = useState("");
    const [themeColor, setThemeColor] = useState("#1e40af");
    const [probetaSerieUno, setProbetaSerieUno] = useState(null);
    const [probetaSerieDos, setProbetaSerieDos] = useState(null);
    const [probetaSerieTres, setProbetaSerieTres] = useState(null);
    const [probetaSerieCuatro, setProbetaSerieCuatro] = useState(null);
    // P-V-03 (auditoría 08, Bloque 21): política de unidad de carga.
    const [politicaUnidadCarga, setPoliticaUnidadCarga] = useState('ORIGINAL');
    // Facturación electrónica
    const [facturacionRazonSocial, setFacturacionRazonSocial] = useState("");
    const [facturacionNombreFantasia, setFacturacionNombreFantasia] = useState("");
    const [facturacionCuit, setFacturacionCuit] = useState("");
    const [facturacionDomicilio, setFacturacionDomicilio] = useState("");
    const [facturacionCondicionIvaId, setFacturacionCondicionIvaId] = useState(null);
    const [facturacionInicioActividades, setFacturacionInicioActividades] = useState(null);
    const [facturacionIngresosBrutos, setFacturacionIngresosBrutos] = useState("");
    const [facturacionPuntoVenta, setFacturacionPuntoVenta] = useState(null);
    const [facturacionCbu, setFacturacionCbu] = useState("");
    // Remito electrónico
    const [remitoElectronicoActivo, setRemitoElectronicoActivo] = useState(false);
    const [remitoPuntoVenta, setRemitoPuntoVenta] = useState(null);
    const [remitoCAI, setRemitoCAI] = useState("");
    const [remitoCAIVencimiento, setRemitoCAIVencimiento] = useState(null);
    const [remitoCondicionesVenta, setRemitoCondicionesVenta] = useState("");
    const [remitoAutoEmail, setRemitoAutoEmail] = useState(true);
    const [remitoNumeracionDesde, setRemitoNumeracionDesde] = useState(null);
    const [remitoNumeracionHasta, setRemitoNumeracionHasta] = useState(null);
    // IMAP
    const [imapHost, setImapHost] = useState("");
    const [imapPort, setImapPort] = useState(993);
    const [imapUser, setImapUser] = useState("");
    const [imapPassword, setImapPassword] = useState("");
    const [imapTls, setImapTls] = useState(true);
    const [imapEnabled, setImapEnabled] = useState(false);
    const [testingImap, setTestingImap] = useState(false);
    // Geolocker
    const [geolockerApiKey, setGeolockerApiKey] = useState("");
    const [geolockerApiUrl, setGeolockerApiUrl] = useState("https://backend.geolocker.com.ar");
    const [testingGeolocker, setTestingGeolocker] = useState(false);
    const [geolockerStatus, setGeolockerStatus] = useState(null);
    // Laboratorio
    const [labApiKey, setLabApiKey] = useState("");
    // Retenciones
    const [retencionesGananciasActivo, setRetencionesGananciasActivo] = useState(false);
    const [retencionesIIBBActivo, setRetencionesIIBBActivo] = useState(false);
    const [retencionesIIBBProvincias, setRetencionesIIBBProvincias] = useState([]);
    const [retencionesIIBBAlicuotaConvenio, setRetencionesIIBBAlicuotaConvenio] = useState(1);
    const [retencionesIIBBAlicuotaSinConvenio, setRetencionesIIBBAlicuotaSinConvenio] = useState(2);
    const [empresaConvenioMultilateral, setEmpresaConvenioMultilateral] = useState(false);
    const [retencionesGananciasUltimoNumero, setRetencionesGananciasUltimoNumero] = useState(null);
    const [retencionesIIBBUltimoNumero, setRetencionesIIBBUltimoNumero] = useState(null);

    const [saving, setSaving] = useState(false);
    const savingRef = useRef(false);
    const [initialConfig, setInitialConfig] = useState(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    // Navegación: grupo activo + subtab activo. Se persiste en sessionStorage para
    // que volver a esta página recuerde dónde estaba el usuario.
    const [activeGroupId, setActiveGroupId] = useState(() => sessionStorage.getItem('settingsGroup') || 'general');
    const [activeItemId, setActiveItemId] = useState(() => sessionStorage.getItem('settingsItem') || 'afip');

    const showToast = useToast();

    const activeGroup = findGroup(activeGroupId);
    const activeItem = activeGroup.items ? (activeGroup.items.find(i => i.id === activeItemId) || activeGroup.items[0]) : null;
    const sectionDescription = activeItem?.description || activeGroup.description;

    const handleGroupChange = (group) => {
        setActiveGroupId(group.id);
        sessionStorage.setItem('settingsGroup', group.id);
        if (group.items) {
            const firstItemId = group.items[0].id;
            setActiveItemId(firstItemId);
            sessionStorage.setItem('settingsItem', firstItemId);
        }
    };

    const handleItemChange = (itemId) => {
        setActiveItemId(itemId);
        sessionStorage.setItem('settingsItem', itemId);
    };

    const loadConfig = useCallback(async () => {
        try {
            const { data } = await axios.get(`${config.backendUrl}/api/config/all`, {
                headers: config.headers,
            });
            const configValues = {
                nombreEmpresa: data.nombreEmpresa || "",
                logoLink: data.logoLink || "",
                logoKey: data.logoKey || "",
                logoLightLink: data.logoLightLink || "",
                logoLightKey: data.logoLightKey || "",
                thumbnail: data.thumbnail || "",
                thumbnailKey: data.thumbnailKey || "",
                mailUser: data.mailUser || "",
                mailPassword: data.mailPassword || "",
                mailHost: data.mailHost || "",
                mailPort: data.mailPort || "",
                frontendUrl: data.frontendUrl || "",
                portalUrl: data.portalUrl || "",
                themeColor: data.themeColor || "#1e40af",
                probetaSerieUno: data.probetaSerieUno || null,
                probetaSerieDos: data.probetaSerieDos || null,
                probetaSerieTres: data.probetaSerieTres || null,
                probetaSerieCuatro: data.probetaSerieCuatro || null,
                politicaUnidadCarga: data.politicaUnidadCarga || 'ORIGINAL',
                facturacionRazonSocial: data.facturacionRazonSocial || "",
                facturacionNombreFantasia: data.facturacionNombreFantasia || "",
                facturacionCuit: data.facturacionCuit || "",
                facturacionDomicilio: data.facturacionDomicilio || "",
                facturacionCondicionIvaId: data.facturacionCondicionIvaId || null,
                facturacionInicioActividades: data.facturacionInicioActividades ? toLocalDate(data.facturacionInicioActividades) : null,
                facturacionIngresosBrutos: data.facturacionIngresosBrutos || "",
                facturacionPuntoVenta: data.facturacionPuntoVenta || null,
                facturacionCbu: data.facturacionCbu || "",
                remitoElectronicoActivo: data.remitoElectronicoActivo || false,
                remitoPuntoVenta: data.remitoPuntoVenta || null,
                remitoCAI: data.remitoCAI || "",
                remitoCAIVencimiento: data.remitoCAIVencimiento ? toLocalDate(data.remitoCAIVencimiento) : null,
                remitoCondicionesVenta: data.remitoCondicionesVenta || "",
                remitoAutoEmail: data.remitoAutoEmail !== false,
                remitoNumeracionDesde: data.remitoNumeracionDesde || null,
                remitoNumeracionHasta: data.remitoNumeracionHasta || null,
                imapHost: data.imapHost || "",
                imapPort: data.imapPort || 993,
                imapUser: data.imapUser || "",
                imapPassword: data.imapPassword || "",
                imapTls: data.imapTls !== false,
                imapEnabled: data.imapEnabled || false,
                geolockerApiKey: data.geolockerApiKey || "",
                geolockerApiUrl: data.geolockerApiUrl || "https://backend.geolocker.com.ar",
                labApiKey: data.labApiKey || "",
                retencionesGananciasActivo: data.retencionesGananciasActivo || false,
                retencionesIIBBActivo: data.retencionesIIBBActivo || false,
                retencionesIIBBProvincias: data.retencionesIIBBProvincias || '[]',
                retencionesIIBBAlicuotaConvenio: data.retencionesIIBBAlicuotaConvenio != null ? Number(data.retencionesIIBBAlicuotaConvenio) : 1,
                retencionesIIBBAlicuotaSinConvenio: data.retencionesIIBBAlicuotaSinConvenio != null ? Number(data.retencionesIIBBAlicuotaSinConvenio) : 2,
                empresaConvenioMultilateral: data.empresaConvenioMultilateral || false,
                retencionesGananciasUltimoNumero: data.retencionesGananciasUltimoNumero ?? null,
                retencionesIIBBUltimoNumero: data.retencionesIIBBUltimoNumero ?? null,
            };

            setNombreEmpresa(configValues.nombreEmpresa);
            setLogoLink(configValues.logoLink);
            setLogoKey(configValues.logoKey);
            setLogoLightLink(configValues.logoLightLink);
            setLogoLightKey(configValues.logoLightKey);
            setThumbnail(configValues.thumbnail);
            setThumbnailKey(configValues.thumbnailKey);
            setMailUser(configValues.mailUser);
            setMailPassword(configValues.mailPassword);
            setMailHost(configValues.mailHost);
            setMailPort(configValues.mailPort);
            setFrontendUrl(configValues.frontendUrl);
            setPortalUrl(configValues.portalUrl);
            setThemeColor(configValues.themeColor);
            setProbetaSerieUno(configValues.probetaSerieUno);
            setProbetaSerieDos(configValues.probetaSerieDos);
            setProbetaSerieTres(configValues.probetaSerieTres);
            setProbetaSerieCuatro(configValues.probetaSerieCuatro);
            setPoliticaUnidadCarga(configValues.politicaUnidadCarga ?? 'ORIGINAL');
            setFacturacionRazonSocial(configValues.facturacionRazonSocial);
            setFacturacionNombreFantasia(configValues.facturacionNombreFantasia);
            setFacturacionCuit(configValues.facturacionCuit);
            setFacturacionDomicilio(configValues.facturacionDomicilio);
            setFacturacionCondicionIvaId(configValues.facturacionCondicionIvaId);
            setFacturacionInicioActividades(configValues.facturacionInicioActividades);
            setFacturacionIngresosBrutos(configValues.facturacionIngresosBrutos);
            setFacturacionPuntoVenta(configValues.facturacionPuntoVenta);
            setFacturacionCbu(configValues.facturacionCbu || "");
            setRemitoElectronicoActivo(configValues.remitoElectronicoActivo);
            setRemitoPuntoVenta(configValues.remitoPuntoVenta);
            setRemitoCAI(configValues.remitoCAI);
            setRemitoCAIVencimiento(configValues.remitoCAIVencimiento);
            setRemitoCondicionesVenta(configValues.remitoCondicionesVenta);
            setRemitoAutoEmail(configValues.remitoAutoEmail);
            setRemitoNumeracionDesde(configValues.remitoNumeracionDesde);
            setRemitoNumeracionHasta(configValues.remitoNumeracionHasta);
            setImapHost(configValues.imapHost);
            setImapPort(configValues.imapPort);
            setImapUser(configValues.imapUser);
            setImapPassword(configValues.imapPassword);
            setImapTls(configValues.imapTls);
            setImapEnabled(configValues.imapEnabled);
            setGeolockerApiKey(configValues.geolockerApiKey);
            setGeolockerApiUrl(configValues.geolockerApiUrl);
            setLabApiKey(configValues.labApiKey);
            setRetencionesGananciasActivo(configValues.retencionesGananciasActivo);
            setRetencionesIIBBActivo(configValues.retencionesIIBBActivo);
            setRetencionesIIBBProvincias(configValues.retencionesIIBBProvincias ? JSON.parse(configValues.retencionesIIBBProvincias) : []);
            setRetencionesIIBBAlicuotaConvenio(configValues.retencionesIIBBAlicuotaConvenio);
            setRetencionesIIBBAlicuotaSinConvenio(configValues.retencionesIIBBAlicuotaSinConvenio);
            setEmpresaConvenioMultilateral(configValues.empresaConvenioMultilateral);
            setRetencionesGananciasUltimoNumero(configValues.retencionesGananciasUltimoNumero);
            setRetencionesIIBBUltimoNumero(configValues.retencionesIIBBUltimoNumero);
            setInitialConfig(configValues);
            setHasUnsavedChanges(false);
        } catch (err) {
            console.error("Error cargando configuración:", err);
            showToast("error", "No se pudo cargar la configuración");
        }
    }, [showToast]);

    const currentConfig = useMemo(
        () => ({
            nombreEmpresa,
            logoLink,
            logoKey,
            logoLightLink,
            logoLightKey,
            thumbnail,
            thumbnailKey,
            mailUser,
            mailPassword,
            mailHost,
            mailPort,
            frontendUrl,
            portalUrl,
            themeColor,
            probetaSerieUno,
            probetaSerieDos,
            probetaSerieTres,
            probetaSerieCuatro,
            politicaUnidadCarga,
            facturacionRazonSocial,
            facturacionNombreFantasia,
            facturacionCuit,
            facturacionDomicilio,
            facturacionCondicionIvaId,
            facturacionInicioActividades,
            facturacionIngresosBrutos,
            facturacionPuntoVenta,
            facturacionCbu,
            remitoElectronicoActivo,
            remitoPuntoVenta,
            remitoCAI,
            remitoCAIVencimiento,
            remitoCondicionesVenta,
            remitoAutoEmail,
            remitoNumeracionDesde,
            remitoNumeracionHasta,
            imapHost,
            imapPort,
            imapUser,
            imapPassword,
            imapTls,
            imapEnabled,
            geolockerApiKey,
            geolockerApiUrl,
            labApiKey,
            retencionesGananciasActivo,
            retencionesIIBBActivo,
            retencionesIIBBProvincias: JSON.stringify(retencionesIIBBProvincias || []),
            retencionesIIBBAlicuotaConvenio,
            retencionesIIBBAlicuotaSinConvenio,
            empresaConvenioMultilateral,
            retencionesGananciasUltimoNumero,
            retencionesIIBBUltimoNumero,
        }),
        [
            nombreEmpresa, logoLink, logoKey, logoLightLink, logoLightKey, thumbnail, thumbnailKey,
            mailUser, mailPassword, mailHost, mailPort, frontendUrl, portalUrl, themeColor,
            probetaSerieUno, probetaSerieDos, probetaSerieTres, probetaSerieCuatro, politicaUnidadCarga,
            facturacionRazonSocial, facturacionNombreFantasia, facturacionCuit, facturacionDomicilio,
            facturacionCondicionIvaId, facturacionInicioActividades, facturacionIngresosBrutos,
            facturacionPuntoVenta, facturacionCbu,
            remitoElectronicoActivo, remitoPuntoVenta, remitoCAI, remitoCAIVencimiento,
            remitoCondicionesVenta, remitoAutoEmail, remitoNumeracionDesde, remitoNumeracionHasta,
            imapHost, imapPort, imapUser, imapPassword, imapTls, imapEnabled,
            geolockerApiKey, geolockerApiUrl, labApiKey,
            retencionesGananciasActivo, retencionesIIBBActivo, retencionesIIBBProvincias,
            retencionesIIBBAlicuotaConvenio, retencionesIIBBAlicuotaSinConvenio,
            empresaConvenioMultilateral, retencionesGananciasUltimoNumero, retencionesIIBBUltimoNumero,
        ]
    );

    useEffect(() => {
        if (!initialConfig) return;
        setHasUnsavedChanges(JSON.stringify(initialConfig) !== JSON.stringify(currentConfig));
    }, [currentConfig, initialConfig]);

    useEffect(() => { loadConfig(); }, [loadConfig]);

    const guardar = async (e) => {
        if (e) e.preventDefault();
        if (savingRef.current) return;
        savingRef.current = true;
        setSaving(true);
        try {
            await axios.put(
                `${config.backendUrl}/api/config`,
                currentConfig,
                { headers: config.headers }
            );
            showToast("success", "Configuración guardada");
            setInitialConfig(currentConfig);
            setHasUnsavedChanges(false);
        } catch (err) {
            console.error("Error al guardar configuración:", err);
            showToast("error", "Error al guardar configuración");
        } finally {
            savingRef.current = false;
            setSaving(false);
        }
    };

    const probarImap = async () => {
        setTestingImap(true);
        try {
            const { data } = await axios.post(
                `${config.backendUrl}/api/facturas-compra-pendientes/test-imap`,
                { imapHost, imapPort, imapUser, imapPassword, imapTls },
                { headers: config.headers },
            );
            showToast('success', data.message || 'Conexión exitosa');
        } catch (err) {
            showToast('error', err.response?.data?.error || 'Error al conectar');
        } finally {
            setTestingImap(false);
        }
    };

    const probarGeolocker = async () => {
        if (!geolockerApiKey) {
            showToast('error', 'Ingresá una API Key antes de probar la conexión');
            return;
        }
        setTestingGeolocker(true);
        setGeolockerStatus(null);
        try {
            const { data } = await axios.get(
                `${config.backendUrl}/api/geolocker/status`,
                {
                    headers: config.headers,
                    params: { testApiKey: geolockerApiKey, testApiUrl: geolockerApiUrl },
                }
            );
            setGeolockerStatus(data);
            if (data?.connected) {
                showToast('success', 'Conexión exitosa con Geolocker');
            } else {
                showToast('warn', data?.mode === 'polling'
                    ? 'Conectado en modo polling (WebSocket no disponible)'
                    : 'No se pudo conectar con Geolocker'
                );
            }
        } catch (err) {
            showToast('error', err.response?.data?.error || 'Error al conectar con Geolocker');
            setGeolockerStatus(null);
        } finally {
            setTestingGeolocker(false);
        }
    };

    const generarLabApiKey = () => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        let key = 'lab_';
        for (let i = 0; i < 32; i++) key += chars.charAt(Math.floor(Math.random() * chars.length));
        setLabApiKey(key);
        showToast('info', 'API Key generada. Guardá la configuración para aplicar.');
    };

    // ───────── Renderers por sección ─────────

    const renderGeneral = () => (
        <div className="settings-panel">
            <div className="settings-grid">
                <div className="settings-field">
                    <label htmlFor="nombreEmpresa">Nombre de la empresa</label>
                    <InputText
                        id="nombreEmpresa"
                        value={nombreEmpresa}
                        onChange={(e) => setNombreEmpresa(e.target.value)}
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="frontendUrl">URL del Frontend</label>
                    <InputText
                        id="frontendUrl"
                        value={frontendUrl}
                        onChange={(e) => setFrontendUrl(e.target.value)}
                        placeholder="https://miempresa.hormiqual.com"
                    />
                </div>
                <div className="settings-field settings-field-full">
                    <label htmlFor="portalUrl">URL del Portal de clientes y empleados</label>
                    <InputText
                        id="portalUrl"
                        value={portalUrl}
                        onChange={(e) => setPortalUrl(e.target.value)}
                        placeholder="https://portal.miempresa.com"
                    />
                </div>
                <div className="settings-field settings-field-full">
                    <label htmlFor="themeColor">Color principal del Portal</label>
                    <div className="flex align-items-center gap-3">
                        <ColorPicker
                            id="themeColor"
                            value={themeColor?.replace(/^#/, '') || '1e40af'}
                            onChange={(e) => {
                                const v = e.value || '';
                                setThemeColor(v.startsWith('#') ? v : `#${v}`);
                            }}
                            format="hex"
                        />
                        <InputText
                            value={themeColor || ''}
                            onChange={(e) => {
                                let v = (e.target.value || '').trim();
                                if (v && !v.startsWith('#')) v = `#${v}`;
                                setThemeColor(v);
                            }}
                            placeholder="#1e40af"
                            style={{ width: '140px', fontFamily: 'monospace' }}
                        />
                        <div
                            style={{
                                width: 36,
                                height: 36,
                                borderRadius: 8,
                                border: '1px solid var(--surface-border)',
                                background: themeColor || '#1e40af',
                            }}
                            aria-hidden="true"
                        />
                    </div>
                    <small className="settings-hint">
                        Color de marca aplicado al Portal de clientes y empleados (botones primarios, hero, navbar). Por defecto azul.
                    </small>
                </div>
            </div>

            <div className="settings-subsection">
                <h4 className="settings-subsection-title">
                    <i className="fa-solid fa-image" /> Identidad visual
                </h4>
                <p className="settings-subsection-desc">
                    Logos para tema claro y oscuro, y thumbnail para favicon/PWA. El fondo de cada
                    slot simula el tema donde se mostrará para que veas el contraste real.
                </p>

                <Tooltip target=".settings-help-icon" position="top" />

                <div className="settings-logos-grid">
                    <div className="settings-logo-slot settings-logo-slot--dark">
                        <div className="settings-logo-header">
                            <span className="settings-logo-label">Logo · Tema oscuro</span>
                            <i
                                className="settings-help-icon fa-solid fa-circle-question"
                                data-pr-tooltip="Se muestra sobre el fondo OSCURO de la app, así que el logo debe ser CLARO (blanco o colores claros) para que tenga buen contraste y se lea."
                            />
                        </div>
                        <ImageUpload
                            link={logoLink}
                            setLink={setLogoLink}
                            fileKey={fileKey}
                            setFileKey={setFileKey}
                            setS3Key={setLogoKey}
                            overlayText="Cambiar logo"
                            tipo="documento"
                        />
                    </div>

                    <div className="settings-logo-slot settings-logo-slot--light">
                        <div className="settings-logo-header">
                            <span className="settings-logo-label">Logo · Tema claro</span>
                            <i
                                className="settings-help-icon fa-solid fa-circle-question"
                                data-pr-tooltip="Se muestra sobre el fondo CLARO de la app, así que el logo debe ser OSCURO (negro o colores oscuros) para que tenga buen contraste y se lea."
                            />
                        </div>
                        <ImageUpload
                            link={logoLightLink}
                            setLink={setLogoLightLink}
                            fileKey={logoLightKey}
                            setFileKey={setLogoLightKey}
                            setS3Key={setLogoLightKey}
                            overlayText="Cambiar logo"
                            tipo="documento"
                        />
                    </div>

                    <div className="settings-logo-slot settings-logo-slot--thumb">
                        <div className="settings-logo-header">
                            <span className="settings-logo-label">Thumbnail · Favicon / PWA</span>
                            <i
                                className="settings-help-icon fa-solid fa-circle-question"
                                data-pr-tooltip="Ícono cuadrado usado como favicon del navegador (la pestañita) y como ícono de HormiQual cuando los usuarios la instalan como app (PWA). Mínimo 512×512px y que se reconozca incluso en tamaños chicos."
                            />
                        </div>
                        <ImageUpload
                            link={thumbnail}
                            setLink={setThumbnail}
                            fileKey={thumbnailKey}
                            setFileKey={setThumbnailKey}
                            setS3Key={setThumbnailKey}
                            overlayText="Cambiar thumbnail"
                            tipo="documento"
                        />
                    </div>
                </div>
            </div>
        </div>
    );

    const renderAfip = () => (
        <div className="settings-panel">
            <div className="settings-grid">
                <div className="settings-field">
                    <label htmlFor="facturacionRazonSocial">Razón Social</label>
                    <InputText
                        id="facturacionRazonSocial"
                        value={facturacionRazonSocial}
                        onChange={(e) => setFacturacionRazonSocial(e.target.value)}
                        placeholder="Ej: HORMIQUAL S.R.L."
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionNombreFantasia">Nombre de Fantasía</label>
                    <InputText
                        id="facturacionNombreFantasia"
                        value={facturacionNombreFantasia}
                        onChange={(e) => setFacturacionNombreFantasia(e.target.value)}
                        placeholder="Ej: HORMIQUAL"
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionCuit">CUIT</label>
                    <InputText
                        id="facturacionCuit"
                        value={facturacionCuit}
                        onChange={(e) => setFacturacionCuit(e.target.value.replace(/\D/g, ''))}
                        placeholder="Ej: 30716528295"
                        maxLength={11}
                    />
                    {facturacionCuit && facturacionCuit.length === 11 && (
                        <small className="settings-hint">
                            Formato: {facturacionCuit.slice(0, 2)}-{facturacionCuit.slice(2, 10)}-{facturacionCuit.slice(10)}
                        </small>
                    )}
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionCondicionIva">Condición frente al IVA</label>
                    <Dropdown
                        id="facturacionCondicionIva"
                        value={facturacionCondicionIvaId}
                        options={condicionIvaOptions}
                        onChange={(e) => setFacturacionCondicionIvaId(e.value)}
                        placeholder="Seleccionar condición"
                    />
                </div>
                <div className="settings-field settings-field-full">
                    <label htmlFor="facturacionDomicilio">Domicilio Comercial</label>
                    <InputText
                        id="facturacionDomicilio"
                        value={facturacionDomicilio}
                        onChange={(e) => setFacturacionDomicilio(e.target.value)}
                        placeholder="Ej: Ruta 9 Km 285, Jesús María, Córdoba"
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionInicioActividades">Inicio de Actividades</label>
                    <Calendar
                        id="facturacionInicioActividades"
                        value={facturacionInicioActividades}
                        onChange={(e) => setFacturacionInicioActividades(e.value)}
                        dateFormat="dd/mm/yy"
                        placeholder="Seleccionar fecha"
                        showIcon
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionIngresosBrutos">Ingresos Brutos</label>
                    <InputText
                        id="facturacionIngresosBrutos"
                        value={facturacionIngresosBrutos}
                        onChange={(e) => setFacturacionIngresosBrutos(e.target.value.replace(/\D/g, ''))}
                        placeholder="Ej: 30716528295"
                        maxLength={11}
                    />
                    {facturacionIngresosBrutos && facturacionIngresosBrutos.length === 11 && (
                        <small className="settings-hint">
                            Formato: {facturacionIngresosBrutos.slice(0, 2)}-{facturacionIngresosBrutos.slice(2, 10)}-{facturacionIngresosBrutos.slice(10)}
                        </small>
                    )}
                </div>
                <div className="settings-field">
                    <label htmlFor="facturacionPuntoVenta">Punto de Venta (factura) por defecto</label>
                    <InputNumber
                        id="facturacionPuntoVenta"
                        value={facturacionPuntoVenta}
                        onValueChange={(e) => setFacturacionPuntoVenta(e.value)}
                        placeholder="Ej: 1"
                        min={1}
                        max={99999}
                        useGrouping={false}
                    />
                    <small className="settings-hint">Número que se usará por defecto al crear facturas.</small>
                </div>
                <div className="settings-field settings-field-full">
                    <label htmlFor="facturacionCbu">CBU del emisor (FCE)</label>
                    <InputText
                        id="facturacionCbu"
                        value={facturacionCbu}
                        onChange={(e) => setFacturacionCbu(e.target.value.replace(/\D/g, '').slice(0, 22))}
                        placeholder="Ej: 0110012130001234567890"
                        maxLength={22}
                    />
                    <small className="settings-hint">
                        CBU de 22 dígitos. Obligatorio para emitir Facturas de Crédito Electrónica (FCE) a clientes Empresa Grande.
                    </small>
                </div>
            </div>
        </div>
    );

    const renderRemito = () => (
        <div className="settings-panel">
            <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                    <strong>Remito electrónico activo</strong>
                    <small className="settings-hint">Si lo activás, los despachos generan remitos digitales en lugar del talonario tradicional.</small>
                </div>
                <InputSwitch
                    id="remitoElectronicoActivo"
                    checked={remitoElectronicoActivo}
                    onChange={(e) => setRemitoElectronicoActivo(e.value)}
                />
            </div>

            {!remitoElectronicoActivo ? (
                <div className="settings-empty-state">
                    <i className="fa-solid fa-file-circle-xmark" />
                    <p>Remito electrónico desactivado.</p>
                    <small>Activá la opción de arriba para configurar punto de venta, CAI y numeración.</small>
                </div>
            ) : (
                <div className="settings-grid">
                    <div className="settings-field">
                        <label htmlFor="remitoPuntoVenta">Punto de Venta para remitos</label>
                        <InputNumber
                            id="remitoPuntoVenta"
                            value={remitoPuntoVenta}
                            onValueChange={(e) => setRemitoPuntoVenta(e.value)}
                            placeholder="Ej: 5"
                            min={1}
                            max={99999}
                            useGrouping={false}
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="remitoCAI">CAI</label>
                        <InputText
                            id="remitoCAI"
                            value={remitoCAI}
                            onChange={(e) => setRemitoCAI(e.target.value)}
                            placeholder="Código de Autorización de Impresión"
                            maxLength={20}
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="remitoCAIVencimiento">Vencimiento CAI</label>
                        <Calendar
                            id="remitoCAIVencimiento"
                            value={remitoCAIVencimiento}
                            onChange={(e) => setRemitoCAIVencimiento(e.value)}
                            dateFormat="dd/mm/yy"
                            placeholder="Fecha de vencimiento"
                            showIcon
                        />
                    </div>
                    <div className="settings-field" />
                    <div className="settings-field">
                        <label htmlFor="remitoNumeracionDesde">Numeración desde</label>
                        <InputNumber
                            id="remitoNumeracionDesde"
                            value={remitoNumeracionDesde}
                            onValueChange={(e) => setRemitoNumeracionDesde(e.value)}
                            placeholder="Ej: 1"
                            min={1}
                            useGrouping={false}
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="remitoNumeracionHasta">Numeración hasta</label>
                        <InputNumber
                            id="remitoNumeracionHasta"
                            value={remitoNumeracionHasta}
                            onValueChange={(e) => setRemitoNumeracionHasta(e.value)}
                            placeholder="Ej: 5000"
                            min={1}
                            useGrouping={false}
                        />
                    </div>
                    <div className="settings-field settings-field-full">
                        <label htmlFor="remitoCondicionesVenta">Condiciones de Venta</label>
                        <InputTextarea
                            id="remitoCondicionesVenta"
                            value={remitoCondicionesVenta}
                            onChange={(e) => setRemitoCondicionesVenta(e.target.value)}
                            placeholder="Texto que aparecerá en el pie del remito"
                            rows={3}
                            autoResize
                        />
                    </div>
                    <div className="settings-field-full settings-toggle-row">
                        <div className="settings-toggle-info">
                            <strong>Enviar email automáticamente al firmar el remito</strong>
                            <small className="settings-hint">El cliente recibe el remito firmado en su casilla apenas se completa la entrega.</small>
                        </div>
                        <InputSwitch
                            id="remitoAutoEmail"
                            checked={remitoAutoEmail}
                            onChange={(e) => setRemitoAutoEmail(e.value)}
                        />
                    </div>
                </div>
            )}
        </div>
    );

    const renderRetenciones = () => (
        <div className="settings-panel">
            <div className="settings-retenciones-toggles">
                <div className="settings-toggle-row">
                    <div className="settings-toggle-info">
                        <strong>Retenciones de Ganancias</strong>
                        <small className="settings-hint">Practicamos retenciones de Ganancias a nuestros proveedores.</small>
                    </div>
                    <InputSwitch
                        checked={retencionesGananciasActivo}
                        onChange={(e) => setRetencionesGananciasActivo(e.value)}
                    />
                </div>
                <div className="settings-toggle-row">
                    <div className="settings-toggle-info">
                        <strong>Retenciones de Ingresos Brutos</strong>
                        <small className="settings-hint">Practicamos retenciones de IIBB a nuestros proveedores.</small>
                    </div>
                    <InputSwitch
                        checked={retencionesIIBBActivo}
                        onChange={(e) => setRetencionesIIBBActivo(e.value)}
                    />
                </div>
            </div>

            {retencionesIIBBActivo && (
                <div className="settings-subsection settings-subsection-card">
                    <h4 className="settings-subsection-title">
                        <i className="fa-solid fa-map-location-dot" /> Configuración de IIBB
                    </h4>
                    <div className="settings-grid">
                        <div className="settings-field settings-field-full">
                            <label>Provincias donde practicamos retención</label>
                            <MultiSelect
                                value={retencionesIIBBProvincias}
                                options={PROVINCIAS_ARGENTINA}
                                onChange={(e) => setRetencionesIIBBProvincias(e.value)}
                                placeholder="Seleccioná las provincias"
                                display="chip"
                                filter
                            />
                        </div>
                        <div className="settings-field-full settings-checkbox-row">
                            <Checkbox
                                inputId="empresaConvenioMultilateral"
                                checked={empresaConvenioMultilateral}
                                onChange={(e) => setEmpresaConvenioMultilateral(e.checked)}
                            />
                            <label htmlFor="empresaConvenioMultilateral">
                                Nuestra empresa está inscripta en el <strong>Convenio Multilateral</strong>
                            </label>
                        </div>
                        <div className="settings-field">
                            <label>Alícuota proveedor <strong>con</strong> convenio (%)</label>
                            <InputNumber
                                value={retencionesIIBBAlicuotaConvenio}
                                onValueChange={(e) => setRetencionesIIBBAlicuotaConvenio(e.value)}
                                minFractionDigits={1}
                                maxFractionDigits={2}
                                min={0}
                                max={100}
                                suffix=" %"
                                placeholder="1 %"
                            />
                        </div>
                        <div className="settings-field">
                            <label>Alícuota proveedor <strong>sin</strong> convenio (%)</label>
                            <InputNumber
                                value={retencionesIIBBAlicuotaSinConvenio}
                                onValueChange={(e) => setRetencionesIIBBAlicuotaSinConvenio(e.value)}
                                minFractionDigits={1}
                                maxFractionDigits={2}
                                min={0}
                                max={100}
                                suffix=" %"
                                placeholder="2 %"
                            />
                        </div>
                    </div>
                </div>
            )}

            <Divider />

            <div className="settings-subsection">
                <h4 className="settings-subsection-title">
                    <i className="fa-solid fa-hashtag" /> Numeración de certificados
                </h4>
                <div className="settings-grid">
                    <div className="settings-field">
                        <label htmlFor="retencionesGananciasUltimoNumero">
                            Último número de retención de Ganancias emitido
                        </label>
                        <InputNumber
                            id="retencionesGananciasUltimoNumero"
                            value={retencionesGananciasUltimoNumero}
                            onValueChange={(e) => setRetencionesGananciasUltimoNumero(e.value)}
                            min={0}
                            placeholder="0"
                        />
                        <small className="settings-hint">
                            Próximo certificado: <strong>{new Date().getFullYear()}-{String((retencionesGananciasUltimoNumero || 0) + 1).padStart(4, '0')}</strong>
                        </small>
                    </div>
                    <div className="settings-field">
                        <label htmlFor="retencionesIIBBUltimoNumero">
                            Último número de retención de IIBB emitido
                        </label>
                        <InputNumber
                            id="retencionesIIBBUltimoNumero"
                            value={retencionesIIBBUltimoNumero}
                            onValueChange={(e) => setRetencionesIIBBUltimoNumero(e.value)}
                            min={0}
                            placeholder="0"
                        />
                        <small className="settings-hint">
                            Próximo certificado: <strong>{String((retencionesIIBBUltimoNumero || 0) + 1).padStart(4, '0')}</strong>
                        </small>
                    </div>
                </div>
            </div>
        </div>
    );

    const renderSmtp = () => (
        <div className="settings-panel">
            <div className="settings-grid">
                <div className="settings-field">
                    <label htmlFor="mailUser">Usuario</label>
                    <InputText
                        id="mailUser"
                        value={mailUser}
                        onChange={(e) => setMailUser(e.target.value)}
                        placeholder={nombreEmpresa ? `ejemplo@${nombreEmpresa.toLowerCase()}.com.ar` : 'ejemplo@correo.com.ar'}
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="mailPassword">Contraseña</label>
                    <InputText
                        id="mailPassword"
                        type="password"
                        value={mailPassword}
                        onChange={(e) => setMailPassword(e.target.value)}
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="mailHost">Host</label>
                    <InputText
                        id="mailHost"
                        value={mailHost}
                        onChange={(e) => setMailHost(e.target.value)}
                        placeholder="smtp.miempresa.com"
                    />
                </div>
                <div className="settings-field">
                    <label htmlFor="mailPort">Puerto</label>
                    <InputText
                        id="mailPort"
                        value={mailPort}
                        onChange={(e) => setMailPort(e.target.value)}
                        placeholder="465"
                    />
                </div>
            </div>
        </div>
    );

    const renderImap = () => (
        <div className="settings-panel">
            <div className="settings-toggle-row">
                <div className="settings-toggle-info">
                    <strong>Lectura IMAP activa</strong>
                    <small className="settings-hint">HormiQual revisa la casilla y carga facturas de proveedores automáticamente.</small>
                </div>
                <InputSwitch
                    id="imapEnabled"
                    checked={imapEnabled}
                    onChange={(e) => setImapEnabled(e.value)}
                />
            </div>

            {!imapEnabled ? (
                <div className="settings-empty-state">
                    <i className="fa-solid fa-inbox" />
                    <p>Lectura IMAP desactivada.</p>
                    <small>Activá la opción de arriba para configurar host, puerto y credenciales.</small>
                </div>
            ) : (
                <>
                    <div className="settings-grid">
                        <div className="settings-field">
                            <label htmlFor="imapHost">Host IMAP</label>
                            <InputText
                                id="imapHost"
                                value={imapHost}
                                onChange={(e) => setImapHost(e.target.value)}
                                placeholder="Ej: imap.gmail.com"
                            />
                        </div>
                        <div className="settings-field">
                            <label htmlFor="imapPort">Puerto</label>
                            <InputNumber
                                id="imapPort"
                                value={imapPort}
                                onValueChange={(e) => setImapPort(e.value)}
                                placeholder="993"
                                min={1}
                                max={65535}
                                useGrouping={false}
                            />
                        </div>
                        <div className="settings-field">
                            <label htmlFor="imapUser">Usuario</label>
                            <InputText
                                id="imapUser"
                                value={imapUser}
                                onChange={(e) => setImapUser(e.target.value)}
                                placeholder="facturas@empresa.com"
                            />
                        </div>
                        <div className="settings-field">
                            <label htmlFor="imapPassword">Contraseña</label>
                            <InputText
                                id="imapPassword"
                                type="password"
                                value={imapPassword}
                                onChange={(e) => setImapPassword(e.target.value)}
                            />
                        </div>
                        <div className="settings-field-full settings-toggle-row">
                            <div className="settings-toggle-info">
                                <strong>Usar TLS</strong>
                                <small className="settings-hint">Conexión cifrada. Por defecto activo (recomendado).</small>
                            </div>
                            <InputSwitch
                                id="imapTls"
                                checked={imapTls}
                                onChange={(e) => setImapTls(e.value)}
                            />
                        </div>
                    </div>
                    <div className="settings-actions-bar">
                        <Button
                            label="Probar conexión"
                            icon="fa-solid fa-plug"
                            outlined
                            rounded
                            size="small"
                            loading={testingImap}
                            onClick={probarImap}
                            type="button"
                        />
                    </div>
                </>
            )}
        </div>
    );

    const renderGeolocker = () => (
        <div className="settings-panel">
            <div className="settings-grid">
                <div className="settings-field">
                    <label htmlFor="geolockerApiKey">API Key</label>
                    <InputText
                        id="geolockerApiKey"
                        type="password"
                        value={geolockerApiKey}
                        onChange={(e) => setGeolockerApiKey(e.target.value)}
                        placeholder="Pegá la API Key generada en Geolocker"
                    />
                    <small className="settings-hint">
                        Generala desde el panel de Geolocker en Configuración &gt; API Keys.
                    </small>
                </div>
                <div className="settings-field">
                    <label htmlFor="geolockerApiUrl">URL del servidor</label>
                    <InputText
                        id="geolockerApiUrl"
                        value={geolockerApiUrl}
                        onChange={(e) => setGeolockerApiUrl(e.target.value)}
                        placeholder="https://backend.geolocker.com.ar"
                    />
                    <small className="settings-hint">No modificar salvo indicación del soporte.</small>
                </div>
            </div>
            <div className="settings-actions-bar">
                <Button
                    label="Probar conexión"
                    icon="fa-solid fa-plug"
                    outlined
                    rounded
                    size="small"
                    loading={testingGeolocker}
                    onClick={probarGeolocker}
                    type="button"
                />
                {geolockerStatus && (
                    <span className={`settings-status-pill ${geolockerStatus.connected ? 'is-ok' : 'is-error'}`}>
                        <span className="settings-status-dot" />
                        {geolockerStatus.connected ? 'Conectado' : 'Desconectado'}
                        {geolockerStatus.mode === 'polling' && ' (polling)'}
                    </span>
                )}
            </div>
        </div>
    );

    const renderLaboratorio = () => (
        <div className="settings-panel">
            <div className="settings-grid">
                <div className="settings-field settings-field-full">
                    <label htmlFor="labApiKey">API Key del Laboratorio</label>
                    <div className="settings-inline-input">
                        <InputText
                            id="labApiKey"
                            value={labApiKey}
                            onChange={(e) => setLabApiKey(e.target.value)}
                            placeholder="Ingresá o generá una API Key"
                        />
                        <Button
                            label="Generar"
                            icon="fa-solid fa-key"
                            outlined
                            rounded
                            size="small"
                            onClick={generarLabApiKey}
                            type="button"
                        />
                    </div>
                    <small className="settings-hint">
                        Copiá esta clave y pegala en la configuración del Raspberry del laboratorio.
                    </small>
                </div>
            </div>
        </div>
    );

    const renderCalidad = () => (
        <div className="settings-panel">
            <div className="settings-subsection">
                <h4 className="settings-subsection-title">
                    <i className="fa-solid fa-flask" /> Series de probetas
                </h4>
                <p className="settings-subsection-desc">
                    Días en los que se programan los ensayos de las probetas estándar. Ej: 7 / 14 / 28 / 28.
                </p>
                <div className="settings-grid settings-grid-tight">
                    <div className="settings-field">
                        <label htmlFor="probetaSerieUno">Serie 1 (días)</label>
                        <InputNumber
                            id="probetaSerieUno"
                            value={probetaSerieUno}
                            onChange={(e) => setProbetaSerieUno(e.value)}
                            placeholder="Ej: 7"
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="probetaSerieDos">Serie 2 (días)</label>
                        <InputNumber
                            id="probetaSerieDos"
                            value={probetaSerieDos}
                            onChange={(e) => setProbetaSerieDos(e.value)}
                            placeholder="Ej: 14"
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="probetaSerieTres">Serie 3 (días)</label>
                        <InputNumber
                            id="probetaSerieTres"
                            value={probetaSerieTres}
                            onChange={(e) => setProbetaSerieTres(e.value)}
                            placeholder="Ej: 28"
                        />
                    </div>
                    <div className="settings-field">
                        <label htmlFor="probetaSerieCuatro">Serie 4 (días)</label>
                        <InputNumber
                            id="probetaSerieCuatro"
                            value={probetaSerieCuatro}
                            onChange={(e) => setProbetaSerieCuatro(e.value)}
                            placeholder="Ej: 28"
                        />
                    </div>
                </div>
            </div>

            <Divider />

            {/* P-V-03 (auditoría 08, Bloque 21) — política de unidad de carga
                en certificados/informes. Default 'ORIGINAL' = mostrar la unidad
                con la que la prensa reporta (kN o tonf). */}
            <div className="settings-subsection">
                <h4 className="settings-subsection-title">
                    <i className="fa-solid fa-weight-scale" /> Unidad de carga en informes
                </h4>
                <p className="settings-subsection-desc">
                    Cómo se muestra la carga aplicada en los certificados de ensayo. Algunos clientes piden kN como SI estándar;
                    otros prefieren ver ambas para trazabilidad fiel a la lectura de la prensa.
                </p>
                <SelectButton
                    value={politicaUnidadCarga}
                    onChange={(e) => e.value && setPoliticaUnidadCarga(e.value)}
                    options={[
                        { label: 'Original (kN o tonf)', value: 'ORIGINAL' },
                        { label: 'Solo kN (SI)', value: 'SI_KN' },
                        { label: 'Ambas (kN / tonf)', value: 'AMBAS' },
                    ]}
                />
                <small className="settings-hint" style={{ marginTop: '0.75rem' }}>
                    {politicaUnidadCarga === 'ORIGINAL'
                        ? 'La unidad nativa de la prensa se respeta (1 tonf ≈ 9,80665 kN). Trazabilidad fiel.'
                        : politicaUnidadCarga === 'SI_KN'
                        ? 'Las prensas que reportan en tonf se convierten a kN al imprimir. Recomendado para auditorías externas.'
                        : 'Cada certificado muestra la carga en ambas unidades (ej. "125,00 kN / 12,75 tonf").'}
                </small>
            </div>
        </div>
    );

    const renderContent = () => {
        if (activeGroupId === 'general') return renderGeneral();
        if (activeGroupId === 'calidad') return renderCalidad();
        if (activeGroupId === 'facturacion') {
            if (activeItemId === 'afip') return renderAfip();
            if (activeItemId === 'remito') return renderRemito();
            if (activeItemId === 'retenciones') return renderRetenciones();
        }
        if (activeGroupId === 'integraciones') {
            if (activeItemId === 'smtp') return renderSmtp();
            if (activeItemId === 'imap') return renderImap();
            if (activeItemId === 'geolocker') return renderGeolocker();
            if (activeItemId === 'laboratorio') return renderLaboratorio();
        }
        return renderGeneral();
    };

    return (
        <Fade direction="up" duration={400} triggerOnce>
            <div className="settings-page">
                <PageHeader
                    icon="fa-solid fa-gears"
                    title="Configuración"
                    subtitle="Datos de tu empresa, integraciones externas y políticas del módulo de calidad"
                />

                {/* Navegación: grupos padre + subtabs */}
                <div className="settings-nav">
                    <div className="settings-nav-groups" role="tablist" aria-label="Secciones de configuración">
                        {TAB_GROUPS.map((group) => {
                            const isActive = group.id === activeGroupId;
                            return (
                                <button
                                    key={group.id}
                                    type="button"
                                    role="tab"
                                    aria-selected={isActive}
                                    className={`settings-group ${isActive ? 'active' : ''}`}
                                    onClick={() => handleGroupChange(group)}
                                >
                                    <i className={group.icon} />
                                    <span className="settings-group-label">{group.label}</span>
                                </button>
                            );
                        })}
                    </div>

                    {activeGroup.items && (
                        <div className="settings-nav-subtabs" role="tablist" aria-label={activeGroup.label}>
                            {activeGroup.items.map((item) => {
                                const isActive = item.id === activeItem?.id;
                                return (
                                    <button
                                        key={item.id}
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        className={`settings-subtab ${isActive ? 'active' : ''}`}
                                        onClick={() => handleItemChange(item.id)}
                                        title={item.description}
                                    >
                                        <i className={item.icon} />
                                        <span className="settings-subtab-label">{item.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                {sectionDescription && (
                    <p className="settings-tab-description">
                        <i className="fa-solid fa-circle-info" />
                        {sectionDescription}
                    </p>
                )}

                <form className="settings-form" onSubmit={guardar}>
                    {renderContent()}
                </form>

                {/* Barra de guardado flotante: aparece cuando hay cambios sin guardar */}
                <div className={`settings-save-bar ${hasUnsavedChanges ? 'is-visible' : ''}`}>
                    <span className="settings-save-bar-label">
                        <span className="settings-unsaved-dot" />
                        Tenés cambios sin guardar
                    </span>
                    <Button
                        label="Guardar configuración"
                        icon="fa-solid fa-check"
                        onClick={guardar}
                        loading={saving}
                        disabled={saving}
                        rounded
                        type="button"
                    />
                </div>
            </div>
        </Fade>
    );
};

export default Settings;
