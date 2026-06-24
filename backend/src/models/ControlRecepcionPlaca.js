'use strict';

/**
 * ControlRecepcionPlaca — 1:1 con PlacaElastomero.
 *
 * Registro de los 4 checks de control de recepción realizados al ingresar
 * un juego al stock (IRAM 1709): Diámetro, Espesor, Aspecto visual, Dureza.
 *
 * El control es opcional: una placa puede existir sin control asociado.
 * Cuando existe, hay exactamente uno (constraint UNIQUE en idPlacaElastomero).
 */
module.exports = (sequelize, DataTypes) => {
    const ControlRecepcionPlaca = sequelize.define('ControlRecepcionPlaca', {
        idControlRecepcion: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idPlacaElastomero: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
        },
        controlDiametroOk: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        controlEspesorOk: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        controlAspectoOk: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Cache derivado: (aspectoEstado === CONFORME). El service lo sincroniza al guardar.',
        },
        controlDurezaOk: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        diametroMedidoMm: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
        },
        espesorMedidoMm: {
            type: DataTypes.DECIMAL(5, 1),
            allowNull: true,
        },
        durezaMedidaShoreA: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
        },
        aspectoEstado: {
            type: DataTypes.ENUM('CONFORME', 'DEFECTOS_LEVES', 'NO_CONFORME'),
            allowNull: true,
        },
        aspectoDetalle: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        observacionesRecepcion: {
            type: DataTypes.TEXT,
            allowNull: true,
        },
        controladoPor: {
            type: DataTypes.STRING(255),
            allowNull: true,
        },
        fechaControl: {
            type: DataTypes.DATE,
            allowNull: true,
        },
    }, {
        tableName: 'ControlRecepcionPlaca',
        timestamps: true,
    });

    ControlRecepcionPlaca.associate = (models) => {
        if (models.PlacaElastomero) {
            ControlRecepcionPlaca.belongsTo(models.PlacaElastomero, {
                foreignKey: 'idPlacaElastomero',
                as: 'placa',
            });
        }
    };

    return ControlRecepcionPlaca;
};
