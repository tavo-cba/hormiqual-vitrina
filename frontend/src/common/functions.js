export function calculateTimeDifference(date1, date2) {
    // Aseguramos que las fechas sean objetos Date
    const d1 = new Date(date1);
    const d2 = new Date(date2);

    // Determinar cuál es la fecha más reciente y la más antigua
    const [start, end] = d1 < d2 ? [d1, d2] : [d2, d1];

    // Inicializamos las variables para años, meses, días, etc.
    let years = end.getFullYear() - start.getFullYear();
    let months = end.getMonth() - start.getMonth();
    let days = end.getDate() - start.getDate();
    let hours = end.getHours() - start.getHours();
    let minutes = end.getMinutes() - start.getMinutes();

    // Ajustar valores si hay negativos
    if (minutes < 0) {
        minutes += 60;
        hours -= 1;
    }
    if (hours < 0) {
        hours += 24;
        days -= 1;
    }
    if (days < 0) {
        const previousMonth = new Date(end.getFullYear(), end.getMonth(), 0); // Último día del mes anterior
        days += previousMonth.getDate();
        months -= 1;
    }
    if (months < 0) {
        months += 12;
        years -= 1;
    }

    // Construir la salida en texto
    const parts = [];
    if (years > 0) parts.push(`${years} año${years > 1 ? 's' : ''}`);
    if (months > 0) parts.push(`${months} mes${months > 1 ? 'es' : ''}`);
    if (days > 0) parts.push(`${days} día${days > 1 ? 's' : ''}`);
    if (hours > 0) parts.push(`${hours} hora${hours > 1 ? 's' : ''}`);
    if (parts.length === 0 && minutes > 0) {
        parts.push(`${minutes} minuto${minutes > 1 ? 's' : ''}`);
    }

    return parts.length > 0 ? parts.join(', ') : 'Menos de un minuto';
}

export function formatNumber(num) {
    if (!num) return "0";
    return Number(num).toLocaleString('es-ES', { useGrouping: true });
}

export const formatPersonName = (nombre, apellido) => {
    const safeNombre = (nombre || "").trim();
    const safeApellido = (apellido || "").trim();

    if (safeApellido && safeNombre) {
        return `${safeApellido}, ${safeNombre}`;
    }

    return safeApellido || safeNombre;
};

export const getClienteDisplayName = (cliente, fallback = 'Sin nombre') => {
    if (!cliente) return fallback;
    if (cliente.tipoPersona === 'Física') {
        return formatPersonName(cliente.nombre, cliente.apellido) || fallback;
    }
    return cliente.razonSocial || cliente.nombre || fallback;
};

export const formatDate = (dateString) => {
    if (!dateString) return "";
    const [year, month, day] = dateString.split("-");
    return `${day.padStart(2, "0")}/${month.padStart(2, "0")}/${year}`;
};

export const parseDateWithoutTimezone = (dateString) => {
    if (!dateString) return null;

    const parts = dateString.split("-");
    return new Date(parts[0], parts[1] - 1, parts[2]);
};
export const parseAIPayload = (s) => {
    if (!s) return null;
    if (typeof s === 'object') return s; // ya es objeto
    if (typeof s !== 'string') return null;

    // 1) Si viene con fence ```json ... ```
    const fence = s.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    const jsonText = fence ? fence[1] : s;

    try {
        return JSON.parse(jsonText);
    } catch {
        // 2) Último recurso: extraer el primer {...} grande
        const m = jsonText.match(/\{[\s\S]*\}/);
        if (m) {
            return JSON.parse(m[0]);
        }
    }
    return null;
}
export const humanizeDays = (diff) => {
    const abs = Math.abs(diff);
    if (abs >= 365) {
        const years = Math.round(abs / 365);
        return `${years} año${years !== 1 ? 's' : ''}`;
    }
    if (abs >= 30) {
        const months = Math.round(abs / 30);
        return `${months} mes${months !== 1 ? 'es' : ''}`;
    }
    if (abs >= 7) {
        const weeks = Math.round(abs / 7);
        return `${weeks} semana${weeks !== 1 ? 's' : ''}`;
    }
    return `${abs} día${abs !== 1 ? 's' : ''}`;
};
export const calculateMinutesDifference = (timeInMinutes) => {
    if (timeInMinutes < 1) return `${timeInMinutes * 60} segundos`; // Menos de 1 minuto

    const minutes = Math.floor(timeInMinutes % 60);
    const hours = Math.floor(timeInMinutes / 60 % 24);
    const days = Math.floor(timeInMinutes / 1440);

    if (days > 0) {
        return `${days} día${days > 1 ? 's' : ''}, ${hours} hora${hours > 1 ? 's' : ''}, ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else if (hours > 0) {
        return `${hours} hora${hours > 1 ? 's' : ''}, ${minutes} minuto${minutes > 1 ? 's' : ''}`;
    } else {
        return `${minutes} minuto${minutes > 1 ? 's' : ''}`;
    }
};
export const simpleDate = (input) => {
    const date = new Date(input);
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}/${month}/${year}`;
}
export const getYear = (input) => {
    const date = new Date(input);
    const year = date.getFullYear();
    return `${year}`;
}
/**
 * @deprecated Usar el hook `useIsMobile()` de `common/hooks/useIsMobile`.
 * Esta constante se evalúa UNA SOLA VEZ al cargar el bundle (IIFE) y NO
 * reacciona a cambios posteriores: rotar tablet, redimensionar ventana o
 * abrir DevTools no actualiza el valor. Eso causa bugs visibles en filtros
 * laterales que dependen de esta variable. Migrá a `useIsMobile()` que
 * suscribe `matchMedia` y se actualiza en tiempo real.
 */
export const isOnPhone = (() => {
    if (typeof window === 'undefined' || typeof navigator === 'undefined') {
        return false;
    }
    const userAgentMatch = /Android|webOS|iPhone|iPad|iPod|BlackBerry|Windows Phone/i.test(
        navigator.userAgent
    );
    const widthMatch = window.matchMedia('(max-width: 768px)').matches;
    return userAgentMatch || widthMatch;
})();

export const parseLocalDate = (isoStr) => {
    // isoStr puede venir como "2025-04-12"   o "2025-04-12T00:00:00.000Z"
    const [y, m, d] = isoStr.slice(0, 10).split("-").map(Number);
    return new Date(y, m - 1, d);          // 00:00 en zona LOCAL
};

/**
 * Serializa un `Date` a `YYYY-MM-DD` en zona LOCAL.
 *
 * M-CAL-02 (auditoría 08, Bloque 14): `date.toISOString().slice(0, 10)` da
 * la fecha en UTC. En GMT-3, cuando el usuario carga un ensayo entre las
 * 21:00 y 23:59 hora local, la fecha UTC ya está en el día siguiente y el
 * backend recibe la fecha equivocada. Este helper formatea con
 * `getFullYear/getMonth/getDate` (locales) para que el día que el usuario
 * ve en el calendario sea exactamente el que viaja al servidor.
 */
export const dateToYMDLocal = (date) => {
    if (!(date instanceof Date) || isNaN(date)) return null;
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};
export const formatDateDMY = (iso) =>
    iso
        ? new Date(iso).toLocaleDateString("es-AR", {
            day: "2-digit",
            month: "2-digit",
            year: "numeric",
        })
        : "-";
export const formatDateDMYExact = (iso) => {
    if (!iso) return "-";

    // Si es un objeto Date, extraer componentes directamente
    if (iso instanceof Date) {
        if (isNaN(iso)) return "-";
        const day = String(iso.getDate()).padStart(2, '0');
        const month = String(iso.getMonth() + 1).padStart(2, '0');
        const year = iso.getFullYear();
        return `${day}/${month}/${year}`;
    }

    if (typeof iso !== 'string') return "-";

    // Extrae solo la parte de la fecha antes del espacio o la "T"
    const cleanIso = iso.split("T")[0].split(" ")[0];
    const [year, month, day] = cleanIso.split("-");

    return `${day}/${month}/${year}`;
};
export const formatTimeHM = (iso) => {
    if (!iso) return "-";

    const date = new Date(iso);
    if (isNaN(date)) return "-";

    // Convertir a GMT-3 usando Intl
    const options = {
        hour: "2-digit",
        minute: "2-digit",
        hour12: false,
        timeZone: "America/Argentina/Buenos_Aires"
    };

    return new Intl.DateTimeFormat("es-AR", options).format(date);
};


export const parseYearMonth = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;

    const raw = typeof value === 'number' ? String(value) : String(value || '').trim();
    if (!raw) return null;

    const isoMatch = raw.match(/^(\d{4})-(\d{2})(?:-(\d{2}))?$/);
    if (isoMatch) {
        const year = parseInt(isoMatch[1], 10);
        const month = parseInt(isoMatch[2], 10);
        if (!Number.isNaN(year) && month >= 1 && month <= 12) {
            return new Date(year, month - 1, 1);
        }
    }

    const digits = raw.replace(/\D/g, '');

    if (digits.length === 6) {
        const monthFirst = parseInt(digits.slice(0, 2), 10);
        const yearLast = parseInt(digits.slice(2), 10);
        if (monthFirst >= 1 && monthFirst <= 12 && !Number.isNaN(yearLast)) {
            return new Date(yearLast, monthFirst - 1, 1);
        }

        const monthLast = parseInt(digits.slice(-2), 10);
        const yearFirst = parseInt(digits.slice(0, 4), 10);
        if (monthLast >= 1 && monthLast <= 12 && !Number.isNaN(yearFirst)) {
            return new Date(yearFirst, monthLast - 1, 1);
        }
    }

    if (digits.length === 8) {
        const yearFirst = parseInt(digits.slice(0, 4), 10);
        const monthFromYearFirst = parseInt(digits.slice(4, 6), 10);
        if (monthFromYearFirst >= 1 && monthFromYearFirst <= 12 && !Number.isNaN(yearFirst)) {
            return new Date(yearFirst, monthFromYearFirst - 1, 1);
        }

        const monthMiddle = parseInt(digits.slice(2, 4), 10);
        const yearLast = parseInt(digits.slice(4), 10);
        if (monthMiddle >= 1 && monthMiddle <= 12 && !Number.isNaN(yearLast)) {
            return new Date(yearLast, monthMiddle - 1, 1);
        }
    }

    const fallback = new Date(raw);
    if (Number.isNaN(fallback.getTime())) return null;
    return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
};

export const formatYearMonthCompact = (value) => {
    const date = value instanceof Date ? value : parseYearMonth(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}${year}`;
};

export const formatYearMonthLabel = (value) => {
    const date = value instanceof Date ? value : parseYearMonth(value);
    if (!(date instanceof Date) || Number.isNaN(date.getTime())) return '';
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${month}/${year}`;
};
export const toLocalDate = (value) => {
    if (!value) return null;
    if (value instanceof Date) return value;

    const s = String(value);
    // Tomar solo la parte de fecha antes de "T" o espacio
    let datePart = s.split("T")[0];
    datePart = datePart.split(" ")[0];

    const [y, m, d] = (datePart || "").split("-").map(Number);
    if (!y || !m || !d) {
        // fallback: si viene en otro formato raro, intentá igual
        const dt = new Date(value);
        return Number.isNaN(dt.getTime()) ? null : dt;
    }
    // Importante: constructor (y, m-1, d) crea 00:00 en zona local (sin correrse de día)
    return new Date(y, m - 1, d);
};
export const digitsOnly = (str) => (str || "").toString().replace(/\D/g, "");
export const deriveDniFromCuit = (value) => {
    const clean = digitsOnly(value);

    if (clean.length === 11) {
        return clean.slice(2, -1);
    }

    return "";
};
export const shortenFileName = (name, max = 15) => {
    if (!name) return '';
    if (name.length <= max) return name;

    const parts = name.split('.');
    const ext = parts.length > 1 ? '.' + parts.pop() : '';
    const keep = max - ext.length - 3;      // 3 = "..."
    return keep > 0
        ? name.slice(0, keep) + '...' + ext
        : '...' + ext;                         // por si la ext es muy larga
};
/**
 * Formatea un CUIL/CUIT de 10 u 11 dígitos.
 *  - 11 dígitos →  XX-XXXXXXXX-X    (DNI de 8)
 *  - 10 dígitos →  XX-XXXXXXX-X     (DNI de 7)
 */
export const formatCuilCuit = (value = "") => {
    const clean = digitsOnly(value);

    if (clean.length === 11) {
        return `${clean.slice(0, 2)}-${clean.slice(2, 10)}-${clean.slice(10)}`;
    }

    if (clean.length === 10) {
        return `${clean.slice(0, 2)}-${clean.slice(2, 9)}-${clean.slice(9)}`;
    }

    return clean;
};

/**
 * Resuelve un ID de localidad (Georef API / CABA) a { localidad, provincia }.
 */
let _cabaBarrios = null;
export const obtenerLocalidad = async (idLoc) => {
    if (!idLoc) return { localidad: '', provincia: '' };

    // Lazy-load CABA barrios
    if (!_cabaBarrios) {
        try {
            const mod = await import('./localidadescaba.json');
            _cabaBarrios = mod.default || mod;
        } catch {
            _cabaBarrios = [];
        }
    }

    const barrio = _cabaBarrios.find((b) => b.id === Number(idLoc));
    if (barrio) {
        return { localidad: barrio.nombre, provincia: 'CABA' };
    }

    try {
        const res = await fetch(`https://apis.datos.gob.ar/georef/api/localidades?id=${idLoc}`);
        const data = await res.json();
        const loc = data.localidades?.[0];
        return {
            localidad: loc?.nombre || '',
            provincia: loc?.provincia?.nombre || '',
        };
    } catch {
        return { localidad: '', provincia: '' };
    }
};

/**
 * Construye "Calle 123, Localidad, Provincia" desde un objeto domicilio.
 */
export const buildDireccionCompleta = async (dom) => {
    if (!dom) return '';
    let calle = dom.calle || '';
    if (dom.numero) calle += ` ${dom.numero}`;
    if (dom.piso) calle += `, Piso ${dom.piso}`;
    if (dom.departamento) calle += `, Dpto ${dom.departamento}`;

    const parts = [];
    if (calle.trim()) parts.push(calle.trim());

    if (dom.localidad) {
        const { localidad, provincia } = await obtenerLocalidad(dom.localidad);
        if (localidad) parts.push(localidad);
        if (provincia) parts.push(provincia);
    }

    return parts.join(', ');
};

/**
 * Identificador legible de un vehículo para dropdowns y datatables.
 * Formato:
 *   - "Interno - Patente | Marca Modelo"  (cuando hay todo)
 *   - "Interno - Patente"                  (sin marca/modelo)
 *   - "Interno" o "Patente"                (cuando falta uno)
 *   - "#id"                                (fallback)
 */
export const formatVehiculoLabel = (v, { withMarcaModelo = true } = {}) => {
    if (!v) return '—';
    const interno = v.interno != null && String(v.interno).trim() !== '' ? String(v.interno).trim() : null;
    const patente = v.patente != null && String(v.patente).trim() !== '' ? String(v.patente).trim() : null;

    let ident;
    if (interno && patente) ident = `${interno} - ${patente}`;
    else if (interno) ident = interno;
    else if (patente) ident = patente;
    else ident = `#${v.idVehiculo ?? '—'}`;

    if (!withMarcaModelo) return ident;
    const sub = [v.marca, v.modelo].filter(Boolean).join(' ').trim();
    return sub ? `${ident} | ${sub}` : ident;
};