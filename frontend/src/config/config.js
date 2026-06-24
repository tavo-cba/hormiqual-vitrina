const tenant = window.location.hostname.split('.')[0];

// En desarrollo, usar la URL del .env o localhost
const devBackendUrl = process.env.REACT_APP_BACKEND_URL || 'http://localhost:3002';
const devPortalUrl = process.env.REACT_APP_PORTAL_URL || 'http://localhost:3001';

// Cargar la URL del backend y portal del tenant
let _backendUrl = process.env.REACT_APP_TEST ? devBackendUrl : null;
let _portalUrl = process.env.REACT_APP_TEST ? devPortalUrl : null;
let _configLoaded = false;

// Intentar cargar tenant-config.json sincrónicamente desde cache de sessionStorage
if (!process.env.REACT_APP_TEST) {
    const cached = sessionStorage.getItem('tenant-backend-url');
    if (cached) {
        _backendUrl = cached;
        _configLoaded = true;
    }
}

export const loadTenantConfig = async () => {
    if (_configLoaded || process.env.REACT_APP_TEST) return;
    try {
        const resp = await fetch('/tenant-config.json');
        const data = await resp.json();
        const tenantCfg = data[tenant];
        if (tenantCfg?.backendUrl) {
            _backendUrl = tenantCfg.backendUrl;
            sessionStorage.setItem('tenant-backend-url', _backendUrl);
        } else {
            _backendUrl = 'https://api.hormiqual.com';
        }
        if (tenantCfg?.portalUrl) {
            _portalUrl = tenantCfg.portalUrl;
        }
    } catch {
        _backendUrl = _backendUrl || 'https://api.hormiqual.com';
    }
    _configLoaded = true;
};

export const getBackendUrl = () => _backendUrl || 'https://api.hormiqual.com';
export const getPortalUrl = () => _portalUrl || 'https://portal.arideros.com.ar';

export const config = {
    get backendUrl() {
        return getBackendUrl();
    },
    get portalUrl() {
        return getPortalUrl();
    },
    headers: {
        Authorization: `Bearer ${localStorage.getItem('token')}`,
        'X-Tenant': tenant,
    },
    tenant,
};
