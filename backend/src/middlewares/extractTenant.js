
// Construir la lista de tenants dinámicamente desde las variables DATABASE_*
function getAllowedTenants() {
    const tenants = [];
    for (const key of Object.keys(process.env)) {
        if (key.startsWith('DATABASE_')) {
            const tenant = key.replace('DATABASE_', '').toLowerCase();
            if (tenant) tenants.push(tenant);
        }
    }
    return tenants;
}

function extractTenantFromRequest(req) {
    const isDev = process.env.APP_ENV === 'development';

    if (isDev) {
        // En desarrollo, permitir header X-Tenant o usar DEV_TENANT
        const tenantFromHeader = req.headers['x-tenant'];
        if (tenantFromHeader) {
            const allowedTenants = getAllowedTenants();
            if (allowedTenants.includes(tenantFromHeader.toLowerCase())) {
                return tenantFromHeader.toLowerCase();
            }
        }
        return process.env.DEV_TENANT || 'hormiqual';
    }

    // En producción, resolver SOLO por subdominio del origin/host
    const allowedTenants = getAllowedTenants();

    const host = req.headers.origin || req.headers.host || '';
    const hostname = host.replace(/^https?:\/\//, '').split(':')[0];
    const parts = hostname.split('.');
    const subdomain = parts.length >= 3 ? parts[0] : null;

    if (subdomain && allowedTenants.includes(subdomain.toLowerCase())) {
        return subdomain.toLowerCase();
    }

    throw new Error('Subdominio no permitido');
}

module.exports = { extractTenantFromRequest };
