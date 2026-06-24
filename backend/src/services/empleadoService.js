const archivoService = require('./archivoService');
const { Op } = require('sequelize');
const dayjs = require('dayjs');
const { getCacheForDb } = require('./cacheHelpers');

/** TTL para lista de empleados: 30 min (invalidado por hooks) */
const EMPLEADOS_TTL = 1800;

const createEmpleado = async (db, data) => {
    const transaction = await db.sequelize.transaction();
    try {
        // 1️⃣ Crear la entidad
        const newEntidad = await db.Entidad.create(
            {
                tipoEntidad: 'Empleado',
            },
            { transaction }
        );

        // 2️⃣ Crear el empleado asignándole la entidad creada
        const newEmpleado = await db.Empleado.create(
            {
                ...data,
                idEntidad: newEntidad.idEntidad,
            },
            { transaction }
        );

        // 3️⃣ Crear el domicilio si se proporciona
        if (data.domicilio) {
            await db.Domicilio.create(
                {
                    ...data.domicilio,
                    codigoPostal: data.domicilio.codigoPostal ?? null,
                    // Si "localidad" viene como objeto, se extrae su id
                    localidad: data.domicilio.localidad?.id || data.domicilio.localidad,
                    idEmpleado: newEmpleado.idEmpleado,
                    idEntidad: newEntidad.idEntidad,
                },
                { transaction }
            );
        }

        // 4️⃣ Crear los teléfonos (contacto) si existen
        if (data.contacto && Array.isArray(data.contacto)) {
            await db.Telefono.bulkCreate(
                data.contacto.map(tel => ({
                    ...tel,
                    idEmpleado: newEmpleado.idEmpleado,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }
        if (data.email && Array.isArray(data.email)) {
            await db.Email.bulkCreate(
                data.email.map(mail => ({
                    ...mail,
                    idEmpleado: newEmpleado.idEmpleado,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }

        if (data.bancos && Array.isArray(data.bancos)) {
            await db.Banco.bulkCreate(
                data.bancos.map(banco => ({
                    ...banco,
                    idEmpleado: newEmpleado.idEmpleado,
                    idEntidad: newEntidad.idEntidad,
                })),
                { transaction }
            );
        }

        // 5️⃣ Crear los roles, validando que existan
        if (data.roles && Array.isArray(data.roles)) {
            // Convertir roles en array de números (si vienen como objeto o valor directo)
            const roleIds = data.roles
                .map(r => r.idRol ?? r)
                .filter(id => typeof id === "number");

            // Buscar roles existentes en la base de datos
            const existingRoles = await db.Rol.findAll({
                where: { idRol: roleIds },
                attributes: ['idRol'],
                transaction,
            });
            const validRoleIds = existingRoles.map(r => r.idRol);

            // Verificar si hay roles inválidos
            const invalidRoles = roleIds.filter(id => !validRoleIds.includes(id));
            if (invalidRoles.length > 0) {
                throw new Error(`Roles no encontrados en la BD: ${invalidRoles.join(", ")}`);
            }

            // Crear las relaciones en EmpleadoRol
            if (validRoleIds.length > 0) {
                const nuevosRoles = validRoleIds.map(idRol => ({
                    idEmpleado: newEmpleado.idEmpleado,
                    idRol: idRol,
                }));
                await db.EmpleadoRol.bulkCreate(nuevosRoles, { transaction });
            }
        }

        // 6️⃣ Confirmar la transacción
        await transaction.commit();
        return newEmpleado;
    } catch (error) {
        // Revertir la transacción en caso de error
        await transaction.rollback();
        throw error;
    }
};


const getEmpleados = async (db, filtros = {}) => {
    const tc = getCacheForDb(db);
    // Cache scopeada por filtros para no contaminar variantes.
    const cacheKey = [
        db._soloObra ? 'soloObra' : 'all',
        filtros.soloOperariosLab ? 'opLab' : 'opAll',
        filtros.idPlanta ? `pl${filtros.idPlanta}` : 'plAll',
    ].join(':');
    const cached = tc.get('empleados', cacheKey);
    if (cached) return cached;

    try {
        // [VITRINA] Include defensivo: en el repo-vitrina los módulos RRHH/Flota
        // están recortados, así que las asociaciones bancos/convenioEmpleado/
        // categoriaConvenio/equipos NO existen. Incluir un modelo ausente hace
        // que Sequelize lance y el endpoint devuelva vacío. Construimos el include
        // sólo con las asociaciones realmente registradas. En producción (todas
        // presentes) el resultado es idéntico al include estático original.
        const empAssoc = db.Empleado.associations || {};
        const entAssoc = (db.Entidad && db.Entidad.associations) || {};
        const entidadInclude = [];
        if (entAssoc.domicilio) entidadInclude.push({ model: db.Domicilio, as: 'domicilio' });
        if (entAssoc.telefono) entidadInclude.push({ model: db.Telefono, as: 'telefono' });
        if (entAssoc.email) entidadInclude.push({ model: db.Email, as: 'email' });
        if (entAssoc.bancos && db.Banco) {
            const bancoInc = { model: db.Banco, as: 'bancos' };
            if (db.Banco.associations && db.Banco.associations.nombreBanco) {
                bancoInc.include = [{ model: db.NombreBanco, as: 'nombreBanco' }];
            }
            entidadInclude.push(bancoInc);
        }
        const include = [];
        if (empAssoc.entidad) include.push({ model: db.Entidad, as: 'entidad', include: entidadInclude });
        if (empAssoc.roles) include.push({ model: db.Rol, as: 'roles', attributes: ['idRol', 'nombreRol', 'descripcion'] });
        if (empAssoc.archivos) include.push({ model: db.Archivo, as: 'archivos' });
        if (empAssoc.convenioEmpleado && db.ConvenioEmpleado) include.push({ model: db.ConvenioEmpleado, as: 'convenioEmpleado' });
        if (empAssoc.categoriaConvenio && db.CategoriaConvenio) include.push({ model: db.CategoriaConvenio, as: 'categoriaConvenio' });
        if (empAssoc.equipos && db.EmpleadoEquipo) {
            const equiposInc = { model: db.EmpleadoEquipo, as: 'equipos' };
            if (db.EmpleadoEquipo.associations && db.EmpleadoEquipo.associations.equipos && db.Vehiculo) {
                equiposInc.include = [{ model: db.Vehiculo, as: 'equipos' }];
            }
            include.push(equiposInc);
        }
        const empleados = await db.Empleado.findAll({
            where: { activo: true },
            include,
        });
        let plain = empleados.map(r => r.get({ plain: true }));

        // M-UX-05 — filtro "personal de laboratorio". Tras el refactor de
        // roles 2026-05-20 los roles canónicos ya no viven en EmpleadoRol
        // (ahora cargos descriptivos del libro de sueldos) sino en
        // User.isAdmin / User.rolCalidad. "Personal de laboratorio" = empleado
        // con cuenta de usuario (login válido); rolCalidad NULL se trata como
        // OPERADOR implícito. Empleados sin User (personal histórico del libro
        // de sueldos) no aparecen en el dropdown de operario de ensayo.
        if (filtros.soloOperariosLab) {
            const idsEmpleado = plain.map((e) => e.idEmpleado);
            const usersConCuenta = await db.User.findAll({
                where: { idEmpleado: { [Op.in]: idsEmpleado } },
                attributes: ['idEmpleado'],
            }).catch(() => []);
            const empleadosConCuenta = new Set(usersConCuenta.map((u) => u.idEmpleado));
            plain = plain.filter((e) => empleadosConCuenta.has(e.idEmpleado));
        }

        // M-UX-05 — filtro por planta vía UserPlanta.
        // Política:
        //   - Empleado con User asignado a la planta filtrada → mostrar.
        //   - Empleado SIN User (personal histórico que firma sin cuenta) → mostrar.
        //   - Empleado con User pero NO asignado a la planta → ocultar.
        if (filtros.idPlanta) {
            const idsEmpleado = plain.map((e) => e.idEmpleado);
            const todosUsers = await db.User.findAll({
                where: { idEmpleado: { [Op.in]: idsEmpleado } },
                attributes: ['idEmpleado'],
            }).catch(() => []);
            const empleadosConUser = new Set(todosUsers.map((u) => u.idEmpleado));

            const usersEnPlanta = await db.User.findAll({
                where: { idEmpleado: { [Op.in]: idsEmpleado } },
                attributes: ['idEmpleado'],
                include: [{
                    model: db.Planta,
                    as: 'plantas',
                    attributes: ['idPlanta'],
                    where: { idPlanta: filtros.idPlanta },
                    required: true,
                    through: { attributes: [] },
                }],
            }).catch(() => []);
            const empleadosEnPlanta = new Set(usersEnPlanta.map((u) => u.idEmpleado));

            plain = plain.filter((e) => {
                if (!empleadosConUser.has(e.idEmpleado)) return true; // sin User → mostrar
                return empleadosEnPlanta.has(e.idEmpleado);
            });
        }

        tc.set('empleados', cacheKey, plain, EMPLEADOS_TTL);
        return plain;
    } catch (error) {
        console.error('Error en getEmpleados:', error);
    }
};
const getEmpleado = async (db, empleadoId) => {
    try {
        const empleado = await db.Empleado.findByPk(empleadoId, {
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
                        },
                        {
                            model: db.Banco,
                            as: 'bancos',
                            include: [
                                { model: db.NombreBanco, as: 'nombreBanco' },
                            ],
                        }
                    ]
                },
                {
                    model: db.Rol,  // 🔹 Usa el alias correcto 'roles' en lugar de 'rol'
                    as: 'roles',
                    attributes: ['idRol', 'nombreRol', 'descripcion']
                },
                {
                    model: db.Archivo,
                    as: 'archivos',
                },
                {
                    model: db.ConvenioEmpleado,
                    as: 'convenioEmpleado',
                },
                {
                    model: db.CategoriaConvenio,
                    as: 'categoriaConvenio',
                },
                {
                    model: db.EmpleadoEquipo,
                    as: 'equipos',
                    include: [
                        {
                            model: db.Vehiculo,
                            as: 'equipos',
                        },
                    ],
                },
            ]
        });
        return empleado;
    } catch (error) {
        console.error('Error en getEmpleado:', error);
    }
};

const updateEmpleado = async (db, id, data) => {
    const transaction = await db.sequelize.transaction();

    try {
        const empleado = await db.Empleado.findByPk(id, { transaction });
        if (!empleado) {
            throw new Error("Empleado no encontrado");
        }

        // Desestructuramos data y extraemos entity, roles, domicilio y contacto
        const { entity, roles, domicilio, email, contacto, bancos, ...empleadoData } = data;

        // Actualizar datos del empleado
        await empleado.update(empleadoData, { transaction });

        // Actualizar la entidad asociada si se proporciona
        if (entity) {
            const entidad = await db.Entidad.findByPk(empleado.idEntidad, { transaction });
            if (entidad) {
                await entidad.update(entity, { transaction });
            }
        }

        // Actualizar roles (código ya existente)
        if (roles && Array.isArray(roles)) {
            // Convertir `roles` en array de números
            const roleIds = roles.map(r => r.idRol ?? r).filter(id => typeof id === "number");

            // Obtener los roles que existen en la base de datos
            const existingRoles = await db.Rol.findAll({
                where: { idRol: roleIds },
                attributes: ['idRol'],
                transaction
            });

            // Extraer los `idRol` existentes
            const validRoleIds = existingRoles.map(r => r.idRol);

            // Filtrar roles inválidos
            const invalidRoles = roleIds.filter(id => !validRoleIds.includes(id));
            if (invalidRoles.length > 0) {
                throw new Error(`Roles no encontrados en la BD: ${invalidRoles.join(", ")}`);
            }

            // Eliminar relaciones antiguas y crear nuevas
            await db.EmpleadoRol.destroy({
                where: { idEmpleado: id },
                transaction
            });

            if (validRoleIds.length > 0) {
                const nuevosRoles = validRoleIds.map(idRol => ({
                    idEmpleado: id,
                    idRol: idRol
                }));
                await db.EmpleadoRol.bulkCreate(nuevosRoles, { transaction });
            }
        }

        // Actualizar teléfonos: eliminar todos y volver a crearlos
        if (contacto && Array.isArray(contacto)) {
            await db.Telefono.destroy({
                where: { idEntidad: empleado.idEntidad },
                transaction
            });

            if (contacto.length > 0) {
                await db.Telefono.bulkCreate(
                    contacto.map(tel => ({
                        ...tel,
                        idEmpleado: id,
                        idEntidad: empleado.idEntidad
                    })),
                    { transaction }
                );
            }
        }
        if (email && Array.isArray(email)) {
            await db.Email.destroy({
                where: { idEntidad: empleado.idEntidad },
                transaction
            });

            if (email.length > 0) {
                await db.Email.bulkCreate(
                    email.map(mail => ({
                        ...mail,
                        idEmpleado: id,
                        idEntidad: empleado.idEntidad,
                    })),
                    { transaction }
                );
            }
        }

        if (bancos && Array.isArray(bancos)) {
            await db.Banco.destroy({
                where: { idEntidad: empleado.idEntidad },
                transaction
            });

            if (bancos.length > 0) {
                await db.Banco.bulkCreate(
                    bancos.map(banco => ({
                        ...banco,
                        idEmpleado: id,
                        idEntidad: empleado.idEntidad,
                    })),
                    { transaction }
                );
            }
        }

        // Actualizar domicilio: si se envía domicilio, se actualiza o crea
        if (domicilio) {
            // Se asume que en domicilio se envía un objeto que puede incluir localidad como objeto
            const domicilioData = {
                ...domicilio,
                codigoPostal: domicilio.codigoPostal ?? null,
                // Si la propiedad localidad viene como objeto, extraemos su id
                localidad: domicilio.localidad?.id || domicilio.localidad,
                idEmpleado: empleado.idEmpleado,
                idEntidad: empleado.idEntidad
            };

            // Buscamos si ya existe un domicilio asociado a la entidad
            const domicilioExistente = await db.Domicilio.findOne({
                where: { idEntidad: empleado.idEntidad },
                transaction
            });

            if (domicilioExistente) {
                await domicilioExistente.update(domicilioData, { transaction });
            } else {
                await db.Domicilio.create(domicilioData, { transaction });
            }
        }

        // Confirmar la transacción
        await transaction.commit();
        return empleado;
    } catch (error) {
        await transaction.rollback();
        console.error("Error actualizando empleado:", error);
        throw error;
    }
};

const deleteEmpleado = async (db, id) => {
    try {
        // Buscar el empleado por su ID
        const empleado = await db.Empleado.findByPk(id);
        if (!empleado) {
            throw new Error("Empleado no encontrado");
        }

        await empleado.update({ activo: false });

        return { success: true, message: "Empleado eliminado con éxito" };

    } catch (error) {
        console.error("Error eliminando empleado:", error);
        throw error;
    }
};

const getRoles = async (db) => {
    const tc = getCacheForDb(db);
    const cached = tc.get('catalogos', 'roles');
    if (cached) return cached;

    try {
        const roles = await db.Rol.findAll({
            order: [['nombreRol', 'ASC']]
        });
        const plain = roles.map(r => r.get({ plain: true }));
        tc.set('catalogos', 'roles', plain, 3600);
        return plain;
    } catch (error) {
        console.error('Error en getRoles:', error);
        throw error;
    }
};
const createRol = async (db, data) => {
    try {
        const nuevoRol = await db.Rol.create({
            nombreRol: data.nombreRol,
            descripcion: data.descripcion || null
        });
        return nuevoRol;
    } catch (error) {
        console.error('Error en createRol:', error);
        throw error;
    }
};

const deleteRol = async (db, idRol) => {
    const transaction = await db.sequelize.transaction(); // 🔹 Usamos transacción para evitar inconsistencias

    try {
        await db.EmpleadoRol.destroy({
            where: { idRol },
            transaction
        });

        const rolEliminado = await db.Rol.destroy({
            where: { idRol },
            transaction
        });

        if (rolEliminado === 0) {
            throw new Error(`No se encontró el rol con id ${idRol}`);
        }

        await transaction.commit();
        return { message: `Rol con ID ${idRol} eliminado correctamente` };
    } catch (error) {
        await transaction.rollback();
        console.error('Error en deleteRol:', error);
        throw error;
    }
};

const uploadFirma = async (db, idEmpleado, file) => {
    const empleado = await db.Empleado.findByPk(idEmpleado);
    if (!empleado) throw new Error('Empleado no encontrado');

    const { key, url } = await archivoService.uploadToS3Only(file, { prefix: 'firmas' });

    if (empleado.firmaKey) {
        await archivoService.deleteFromKey(empleado.firmaKey).catch(() => { });
    }

    await empleado.update({ firma: url, firmaKey: key });
    return { id: empleado.idEmpleado, firma: url };
};
const getEmpleadosBaja = async (db) => {
    try {
        const empleados = await db.Empleado.findAll({
            where: { razonBaja: { [Op.ne]: null } },
            include: [
                {
                    model: db.Entidad,
                    as: 'entidad',
                    include: [
                        { model: db.Domicilio, as: 'domicilio' },
                        { model: db.Telefono, as: 'telefono' },
                        { model: db.Email, as: 'email' },
                    ],
                },
                {
                    model: db.Rol,
                    as: 'roles',
                    attributes: ['idRol', 'nombreRol', 'descripcion'],
                },
                { model: db.Archivo, as: 'archivos' },
                { model: db.ConvenioEmpleado, as: 'convenioEmpleado' },
                { model: db.CategoriaConvenio, as: 'categoriaConvenio' },
            ],
        });
        return empleados;
    } catch (error) {
        console.error('Error en getEmpleadosBaja:', error);
    }
};
const bajaEmpleado = async (db, id, razon, fecha) => {
    try {
        const empleado = await db.Empleado.findByPk(id);
        if (!empleado) {
            throw new Error("Empleado no encontrado");
        }

        await empleado.update({
            activo: false,
            razonBaja: razon,
            fechaBaja: fecha,
        });

        return empleado;
    } catch (error) {
        console.error("Error dando de baja empleado:", error);
        throw error;
    }
};
const getConvenios = async (db) => {
    try {
        return await db.ConvenioEmpleado.findAll({
            include: [{ model: db.CategoriaConvenio, as: 'categorias' }],
        });
    } catch (error) {
        console.error('Error en getConvenios:', error);
    }
};

const updateSalariosBrutos = async (db, salarios) => {
    const t = await db.sequelize.transaction();
    try {
        const ids = salarios.map(s => s.idEmpleado);     // [10, 12, 13, …]
        const cases = salarios
            .map(s => `WHEN ${s.idEmpleado} THEN ${s.salarioBruto ?? 0}`)
            .join(' ');   // WHEN 10 THEN 1265800 WHEN 12 THEN 150000 …

        await db.sequelize.query(
            `
        UPDATE Empleado
        SET salarioBruto = CASE idEmpleado
          ${cases}
        END
        WHERE idEmpleado IN (:ids)
      `,
            { replacements: { ids }, transaction: t }
        );

        await t.commit();
        return { updated: ids.length };
    } catch (err) {
        await t.rollback();
        throw err;
    }
};
const generateTxtConvenio = async (db, nombreTxt, idConvenioEmpleado) => {
    // Acepta un id único (back-compat) o un array de ids (selección múltiple de convenios).
    const ids = (Array.isArray(idConvenioEmpleado) ? idConvenioEmpleado : [idConvenioEmpleado])
        .filter(id => id != null);
    const empleados = await db.Empleado.findAll({
        where: { activo: true, idConvenioEmpleado: { [Op.in]: ids } },
        include: [
            { model: db.ConvenioEmpleado, as: 'convenioEmpleado' },
            { model: db.CategoriaConvenio, as: 'categoriaConvenio' },
            {
                model: db.Entidad,
                as: 'entidad',
                include: [{ model: db.Domicilio, as: 'domicilio' }],
            },
        ],
    });


    const formatSalario = salario => {
        const valor = Number(salario || 0);
        const centavos = Math.trunc(valor * 100);
        return Math.abs(centavos)
            .toString()
            .padStart(18, '0');
    };

    const lines = empleados.map(emp => {
        const cuil = String(emp.cuil || '').padStart(11, '0');
        const afiliado = emp.afiliadoGremio ? 'S' : 'N';
        const salario = formatSalario(emp.salarioBruto);
        const fecha = emp.fechaIngreso ? dayjs(emp.fechaIngreso).format('DDMMYYYY') : '00000000';
        const cp = emp.entidad?.domicilio?.codigoPostal
            ? String(emp.entidad.domicilio.codigoPostal).padStart(4, '0')
            : '8361';
        const convenio = emp.convenioEmpleado?.codigoConvenio || '';
        const categoria = emp.categoriaConvenio?.indiceCategoria
            ? emp.categoriaConvenio.indiceCategoria.toString().padStart(2, '0')
            : '00';
        const pep = emp.expuestoPoliticamente ? 'S' : 'N';

        return [
            cuil,
            pep,
            salario,
            salario,
            fecha,
            cp,
            convenio,
            categoria,
            afiliado,
        ].join('');
    });

    return {
        nombreArchivo: `${nombreTxt}.txt`,
        contenido: lines.join('\n'),
    };
};
module.exports = {
    getEmpleados,
    getEmpleado,
    createEmpleado,
    updateEmpleado,
    deleteEmpleado,
    getRoles,
    createRol,
    deleteRol,
    uploadFirma,
    bajaEmpleado,
    getEmpleadosBaja,
    getConvenios,
    updateSalariosBrutos,
    generateTxtConvenio,
};
