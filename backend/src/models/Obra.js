module.exports = (sequelize, DataTypes) => {
    const Obra = sequelize.define('Obra', {
        idObra: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(255),
            allowNull: false,
        },
        infoAdicional: {
            type: DataTypes.TEXT,
        },
        latitud: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        longitud: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        deleted_at: {
            type: DataTypes.DATE,
            comment: 'Borrado lógico: fecha/hora de inactivación.',
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        // ── Obra propia (Fase ①) ──────────────────────────────────────────
        obraPropia: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'true = obra propia (gestionada por la empresa); false = obra de terceros',
        },
        idGestor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Empleado responsable / jefe de la obra propia',
        },
        fechaInicio: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        fechaFinPrevista: {
            type: DataTypes.DATEONLY,
            allowNull: true,
        },
        presupuesto: {
            type: DataTypes.DECIMAL(15, 2),
            allowNull: true,
            comment: 'Presupuesto informativo (no se usa para el margen)',
        },
        estadoObra: {
            type: DataTypes.ENUM('planificada', 'en_curso', 'finalizada', 'suspendida'),
            allowNull: false,
            defaultValue: 'planificada',
        },
    }, {
        tableName: 'Obra',
        comment: 'Obra de construcción donde se entrega y controla el hormigón.',
    });

    Obra.associate = (models) => {
        Obra.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
        Obra.belongsTo(models.Empleado, {
            foreignKey: 'idGestor',
            as: 'gestor',
        });
        // [VITRINA] Podadas: ObraEmpleado, ObraCentroCosto.
    };

    return Obra;
};
