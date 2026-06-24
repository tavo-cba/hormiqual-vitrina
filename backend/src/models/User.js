const { DataTypes } = require('sequelize');

module.exports = (sequelize) => {
    const User = sequelize.define('User', {
        username: {
            type: DataTypes.STRING,
            allowNull: false,
            unique: true,
            validate: { notEmpty: true },
        },
        password: {
            type: DataTypes.STRING,
            allowNull: false,
            validate: { notEmpty: true },
        },
        name: {
            type: DataTypes.STRING(30),
            allowNull: false,
        },
        lastname: {
            type: DataTypes.STRING(30),
            allowNull: false,
        },
        userHash: {
            type: DataTypes.STRING,
            allowNull: true,
            field: 'user_hash',
        },
        isAdmin: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'is_admin',
        },
        // ── @deprecated (Fase 6) ────────────────────────────────────────────
        // Estos 4 flags son legacy. La autorización del flujo de Dosificación
        // y de transiciones críticas migró a RBAC canónico vía Empleado→Rol
        // (ver `src/domain/roles/index.js`). Estos campos quedan por
        // compatibilidad mientras dura el período de gracia.
        // Migración disponible: `scripts/migrarUsuariosLegacyARoles.js`.
        // Programado para remover en una fase posterior tras revisar logs.
        adminCreateModify: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'admin_create_modify',
            comment: '@deprecated v1.x — usar Empleado→Rol (RESPONSABLE_CALIDAD). Removido en v2.0.',
        },
        adminDelete: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'admin_delete',
            comment: '@deprecated v1.x — usar Empleado→Rol (ADMIN). Removido en v2.0.',
        },
        prodCreateModify: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'prod_create_modify',
            comment: '@deprecated v1.x — usar Empleado→Rol (OPERADOR). Removido en v2.0.',
        },
        prodDelete: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'prod_delete',
            comment: '@deprecated v1.x — usar Empleado→Rol (RESPONSABLE_CALIDAD). Removido en v2.0.',
        },
        hidden: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        allPlantas: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'all_plants',
        },
        soloObra: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'solo_obra',
        },
        accesoAgente: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            field: 'acceso_agente',
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: null,
        },
        // Rol de autoridad dentro del módulo Calidad. Ortogonal al árbol de
        // menús (PermisoMenu): el árbol gates "qué pantallas y CRUD"; este
        // rol gates acciones de autoridad (aprobar dosificación, firmar
        // certificado, transicionar pastón, editar parámetros de planta).
        // NULL = OPERADOR implícito. ADMIN/CLIENTE NO entran acá (ADMIN
        // usa isAdmin; CLIENTE es flujo aparte).
        rolCalidad: {
            type: DataTypes.ENUM('OPERADOR', 'RESPONSABLE_CALIDAD', 'DIRECTOR_TECNICO'),
            allowNull: true,
            defaultValue: null,
        },
        // Rol de autoridad dentro del módulo Flota (sesión 2026-05-11).
        // Mismo patrón ortogonal que rolCalidad. NULL = sin acciones de
        // autoridad; bypass completo si isAdmin=1.
        rolFlota: {
            type: DataTypes.ENUM('FLOTA_OPERADOR', 'FLOTA_SUPERVISOR', 'FLOTA_JEFE'),
            allowNull: true,
            defaultValue: null,
        },
        // Rol de autoridad dentro del módulo Mantenimiento (sesión 2026-05-11).
        rolMantenimiento: {
            type: DataTypes.ENUM('MANT_MECANICO', 'MANT_ENCARGADO', 'MANT_JEFE'),
            allowNull: true,
            defaultValue: null,
        },
        // Rol de autoridad dentro del módulo Producción (sesión 2026-06-03).
        // COORDINADOR crea/edita pedidos y despachos; PLANTISTA reordena,
        // envía a Betonmatic y "trae de vuelta" despachos enviados.
        rolProduccion: {
            type: DataTypes.ENUM('COORDINADOR', 'PLANTISTA'),
            allowNull: true,
            defaultValue: null,
        },
    }, {
        tableName: 'Users',
        timestamps: true,
        underscored: false,
    });
    User.associate = (models) => {
        User.belongsTo(models.Empleado, {
            foreignKey: 'idEmpleado',
            as: 'empleado',
        });
        User.belongsToMany(models.Planta, {
            through: models.UserPlanta,
            foreignKey: 'idUser',
            otherKey: 'idPlanta',
            as: 'plantas',
        });
    };
    return User;
};
