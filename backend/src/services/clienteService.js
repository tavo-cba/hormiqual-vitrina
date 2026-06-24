const { getCacheForDb } = require('./cacheHelpers');

/** TTL para lista de clientes: 30 min (invalidado por hooks) */
const CLIENTES_TTL = 1800;

/** Verifica si el domicilio tiene datos significativos */
const hasDomicilioData = (dom) => {
    if (!dom) return false;
    return !!(dom.calle || dom.numero || dom.localidad || dom.provincia || dom.codigoPostal || dom.piso || dom.departamento);
};

/** Normaliza un CUIT/CUIL a solo dígitos para comparar */
const normalizeCuit = (cuit) => (cuit == null ? '' : String(cuit).replace(/\D/g, ''));

/**
 * Verifica que no exista otro cliente activo con el mismo CUIT.
 * Lanza un error con status 409 si encuentra un duplicado.
 * @param {number} [excludeId] - idCliente a excluir (para edición).
 */
const assertCuitUnico = async (db, cuit, excludeId = null, transaction = null) => {
    const cuitNorm = normalizeCuit(cuit);
    if (!cuitNorm) return; // CUIT vacío (ej. consumidor final) no se valida

    const where = { cuil_cuit: cuitNorm, activo: true };
    if (excludeId) {
        const { Op } = require('sequelize');
        where.idCliente = { [Op.ne]: excludeId };
    }

    const existente = await db.Cliente.findOne({ where, transaction });
    if (existente) {
        const error = new Error('Ya existe un cliente registrado con ese CUIT.');
        error.status = 409;
        throw error;
    }
};

const createCliente = async (db, data) => {
    await assertCuitUnico(db, data.cuil_cuit);
    const transaction = await db.sequelize.transaction();
    try {
        // 1️⃣ Crear la entidad (tipoEntidad = 'Cliente' o algo que uses en tu sistema)
        const newEntidad = await db.Entidad.create(
            {
                tipoEntidad: 'Cliente',
            },
            { transaction }
        );

        // 2️⃣ Crear el cliente asignándole la entidad creada (solo campos del modelo)
        const { domicilio, contacto, email, ...clienteData } = data;
        const newCliente = await db.Cliente.create(
            {
                ...clienteData,
                idEntidad: newEntidad.idEntidad,
            },
            { transaction }
        );

        // 3️⃣ Crear el domicilio si se proporciona con datos significativos
        if (hasDomicilioData(domicilio)) {
            await db.Domicilio.create(
                {
                    calle: domicilio.calle || null,
                    numero: domicilio.numero || null,
                    piso: domicilio.piso || null,
                    departamento: domicilio.departamento || null,
                    codigoPostal: domicilio.codigoPostal ?? null,
                    localidad: domicilio.localidad?.id || domicilio.localidad || null,
                    idCliente: newCliente.idCliente,
                    idEntidad: newEntidad.idEntidad,
                },
                { transaction }
            );
        }

        // 4️⃣ Crear los teléfonos (contacto) si existen
        if (contacto && Array.isArray(contacto)) {
            await db.Telefono.bulkCreate(
                contacto.map(tel => ({
                    ...tel,
                    idCliente: newCliente.idCliente,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }

        if (email && Array.isArray(email)) {
            await db.Email.bulkCreate(
                email.map(mail => ({
                    ...mail,
                    idCliente: newCliente.idCliente,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }

        // 5️⃣ Confirmar la transacción
        await transaction.commit();
        return newCliente;
    } catch (error) {
        // Revertir la transacción en caso de error
        await transaction.rollback();
        throw error;
    }
};

const getClientes = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('clientes', 'all');
    if (cached) return cached;

    try {
        const result = await db.Cliente.findAll({
            where: { activo: true },
            include: [
                {
                    model: db.Entidad,
                    as: 'entidad',
                    include: [
                        {
                            model: db.Domicilio,
                            as: 'domicilio',
                        },
                        {
                            model: db.Telefono,
                            as: 'telefono',
                        },
                        {
                            model: db.Email,
                            as: 'email',
                        }
                    ]
                }
            ]
        });
        const plain = result.map(r => r.get({ plain: true }));
        tc.set('clientes', 'all', plain, CLIENTES_TTL);
        return plain;
    } catch (error) {
        console.error('Error en getClientes:', error);
        throw error;
    }
};

const getCliente = async (db, clienteId) => {
    try {
        return await db.Cliente.findByPk(clienteId, {
            include: [
                {
                    model: db.Entidad,
                    as: 'entidad',
                    include: [
                        {
                            model: db.Domicilio,
                            as: 'domicilio',
                        },
                        {
                            model: db.Telefono,
                            as: 'telefono',
                        },
                        {
                            model: db.Email,
                            as: 'email',
                        }
                    ]
                }
            ]
        });
    } catch (error) {
        console.error('Error en getCliente:', error);
        throw error;
    }
};

const updateCliente = async (db, id, data) => {
    const transaction = await db.sequelize.transaction();

    try {
        const cliente = await db.Cliente.findByPk(id, { transaction });
        if (!cliente) {
            throw new Error("Cliente no encontrado");
        }

        // Desestructuramos data y extraemos campos que no sean directos de Cliente
        const { domicilio, contacto, email, ...clienteData } = data;

        // Validar CUIT único (excluyendo el propio cliente)
        if (clienteData.cuil_cuit !== undefined) {
            await assertCuitUnico(db, clienteData.cuil_cuit, cliente.idCliente, transaction);
        }

        // 1️⃣ Actualizar datos del cliente
        await cliente.update(clienteData, { transaction });

        // 2️⃣ Actualizar/crear/eliminar teléfonos
        if (contacto && Array.isArray(contacto)) {
            // Eliminamos todos los teléfonos actuales vinculados a la entidad
            await db.Telefono.destroy({
                where: { idEntidad: cliente.idEntidad },
                transaction
            });

            // Creamos los nuevos
            if (contacto.length > 0) {
                await db.Telefono.bulkCreate(
                    contacto.map(tel => ({
                        ...tel,
                        idCliente: cliente.idCliente,  // Opcional
                        idEntidad: cliente.idEntidad
                    })),
                    { transaction }
                );
            }
        }
        if (email && Array.isArray(email)) {
            await db.Email.destroy({
                where: { idEntidad: cliente.idEntidad },
                transaction
            });

            if (email.length > 0) {
                await db.Email.bulkCreate(
                    email.map(mail => ({
                        ...mail,
                        idCliente: cliente.idCliente,
                        idEntidad: cliente.idEntidad,
                    })),
                    { transaction }
                );
            }
        }
        // 3️⃣ Actualizar domicilio
                if (hasDomicilioData(domicilio)) {
            const domicilioData = {
                calle: domicilio.calle || null,
                numero: domicilio.numero || null,
                piso: domicilio.piso || null,
                departamento: domicilio.departamento || null,
                codigoPostal: domicilio.codigoPostal ?? null,
                localidad: domicilio.localidad?.id || domicilio.localidad || null,
                idCliente: cliente.idCliente,
                idEntidad: cliente.idEntidad
            };

            const domicilioExistente = await db.Domicilio.findOne({
                where: { idEntidad: cliente.idEntidad },
                transaction
            });

            if (domicilioExistente) {
                await domicilioExistente.update(domicilioData, { transaction });
            } else {
                await db.Domicilio.create(domicilioData, { transaction });
            }
        }

        await transaction.commit();
        return cliente;
    } catch (error) {
        await transaction.rollback();
        console.error("Error actualizando cliente:", error);
        throw error;
    }
};

const deleteCliente = async (db, id) => {
    try {
        const cliente = await db.Cliente.findByPk(id);
        if (!cliente) {
            throw new Error("Cliente no encontrado");
        }

        await cliente.update({ activo: false });

        return { success: true, message: "Cliente eliminado con éxito" };
    } catch (error) {
        console.error("Error eliminando cliente:", error);
        throw error;
    }
};

// Exportar los métodos
/**
 * Devuelve los remitos del cliente combinando dos fuentes:
 *  - Archivos de remito (Archivo) subidos en despachos de hormigón y áridos.
 *  - Remitos electrónicos (RemitoVenta) vinculados al cliente.
 * Cada item lleva un campo `origen` ("archivo" | "remitoVenta") para distinguirlos.
 */
const getRemitosDespacho = async (db, idCliente) => {
    const { Op } = require('sequelize');

    // --- 1. Archivos de remito desde despachos ---
    const [despachos, despachosArido] = await Promise.all([
        db.Despacho.findAll({ where: { idCliente }, attributes: ['idDespacho'], raw: true }),
        db.DespachoArido.findAll({ where: { idCliente }, attributes: ['idDespachoArido'], raw: true }),
    ]);

    const despachoIds = despachos.map(d => d.idDespacho);
    const despachoAridoIds = despachosArido.map(d => d.idDespachoArido);

    let archivos = [];
    if (despachoIds.length || despachoAridoIds.length) {
        const orConditions = [];
        if (despachoIds.length) orConditions.push({ idDespacho: despachoIds });
        if (despachoAridoIds.length) orConditions.push({ idDespachoArido: despachoAridoIds });

        archivos = await db.Archivo.findAll({
            where: { [Op.or]: orConditions },
            include: [
                {
                    model: db.Despacho, as: 'despacho',
                    attributes: ['idDespacho', 'fecha', 'remito', 'idObra', 'idPedido'],
                    include: [{ model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] }],
                },
                {
                    model: db.DespachoArido, as: 'despachoArido',
                    attributes: ['idDespachoArido', 'fecha', 'remito', 'idObra', 'idPedidoArido'],
                    include: [{ model: db.Obra, as: 'obra', attributes: ['idObra', 'nombre'] }],
                },
            ],
            order: [['createdAt', 'DESC']],
        });
    }

    // --- 2. Remitos electrónicos (RemitoVenta) del cliente ---
    const remitosVenta = await db.RemitoVenta.findAll({
        where: { idCliente },
        include: [
            { model: db.Obra, as: 'obra' },
            { model: db.Despacho, as: 'despacho' },
            { model: db.DespachoArido, as: 'despachoArido' },
        ],
        order: [['fecha', 'DESC'], ['idRemitoVenta', 'DESC']],
    });

    // --- 3. Combinar con campo "origen", deduplicando ---
    // Archivos de PDF generados por signRemito() ya están representados en RemitoVenta,
    // así que excluimos archivos cuyo despacho/despachoArido ya tiene un RemitoVenta asociado.
    const remitoDespachoIds = new Set(remitosVenta.filter(r => r.idDespacho).map(r => r.idDespacho));
    const remitoDespachoAridoIds = new Set(remitosVenta.filter(r => r.idDespachoArido).map(r => r.idDespachoArido));

    const resultArchivos = archivos
        .filter(a => {
            if (a.idDespacho && remitoDespachoIds.has(a.idDespacho)) return false;
            if (a.idDespachoArido && remitoDespachoAridoIds.has(a.idDespachoArido)) return false;
            return true;
        })
        .map(a => ({
            ...a.toJSON(),
            origen: 'archivo',
        }));
    const resultRemitos = remitosVenta.map(r => ({
        ...r.toJSON(),
        origen: 'remitoVenta',
    }));

    return [...resultArchivos, ...resultRemitos];
};

module.exports = {
    createCliente,
    getClientes,
    getCliente,
    updateCliente,
    deleteCliente,
    getRemitosDespacho,
};
