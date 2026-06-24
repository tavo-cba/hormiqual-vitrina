/**
 * Helpers compartidos para listados con paginación + búsqueda server-side.
 *
 * Patrón de uso (opt-in, sin breaking changes):
 *
 *   const opts = readPagingOpts(req.query);    // { paginate, page, limit, search }
 *   if (opts.paginate) {
 *     const { rows, count } = await Model.findAndCountAll({ where, include, limit, offset });
 *     return makePagedResponse(rows, count, opts);
 *   } else {
 *     // comportamiento histórico: array directo, sin paginar
 *     const rows = await Model.findAll({ where, include });
 *     return rows;
 *   }
 *
 * El opt-in se dispara cuando el cliente manda `?page=`, `?limit=` o `?paginate=true`.
 * Si no manda nada de eso, los consumidores viejos (que esperan array) siguen
 * funcionando igual.
 *
 * `search` se aplica server-side: el frontend nunca filtra solo lo de su página
 * actual — manda el término al backend, que busca contra todo el dataset y
 * después pagina.
 */

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;

/**
 * Lee parámetros de paginación del query string.
 *
 * @param {object} query Generalmente `req.query`
 * @returns {{ paginate: boolean, page: number, limit: number, offset: number, search: string }}
 */
function readPagingOpts(query = {}) {
    const hasPage = query.page !== undefined && query.page !== null && query.page !== '';
    const hasLimit = query.limit !== undefined && query.limit !== null && query.limit !== '';
    const hasPaginateFlag = query.paginate === 'true' || query.paginate === '1' || query.paginate === true;
    const paginate = hasPage || hasLimit || hasPaginateFlag;

    let page = Number(query.page);
    if (!Number.isFinite(page) || page < 1) page = 1;

    let limit = Number(query.limit);
    if (!Number.isFinite(limit) || limit < 1) limit = DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;

    const search = typeof query.search === 'string' ? query.search.trim() : '';

    return {
        paginate,
        page,
        limit,
        offset: (page - 1) * limit,
        search,
    };
}

/**
 * Construye un cláusula `[Op.like]` para el patrón "%term%" — escapando los
 * comodines `%` y `_` que el usuario pudiera tipear como caracteres literales.
 */
function likePattern(term) {
    if (!term) return null;
    const escaped = String(term).replace(/[\\%_]/g, '\\$&');
    return `%${escaped}%`;
}

/**
 * Devuelve el shape paginado estándar.
 */
function makePagedResponse(rows, total, { page, limit }) {
    return {
        rows,
        total,
        page,
        limit,
        pages: Math.max(1, Math.ceil((total || 0) / limit)),
    };
}

module.exports = {
    readPagingOpts,
    likePattern,
    makePagedResponse,
    DEFAULT_LIMIT,
    MAX_LIMIT,
};
