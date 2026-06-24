'use strict';

/**
 * PlacaElastomeroPrensa — tabla intermedia que vincula un juego de placas
 * de elastómero con todas las prensas en las que puede usarse.
 *
 * Una placa puede asignarse a 1..N prensas siempre que todas pertenezcan al
 * mismo laboratorio (validación a cargo del service). El conteo de reúsos
 * (PlacaElastomero.reusosActuales) se incrementa cuando se ensaya en
 * cualquiera de las prensas asignadas.
 *
 * `PlacaElastomero.idPrensa` se mantiene como "prensa primaria" (la primera
 * elegida al activar) para back-compat de listados rápidos; la fuente real
 * de la asignación es esta tabla.
 */
module.exports = (sequelize, DataTypes) => {
    const PlacaElastomeroPrensa = sequelize.define('PlacaElastomeroPrensa', {
        idPlacaElastomero: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            allowNull: false,
        },
        idPrensa: {
            type: DataTypes.STRING(50),
            primaryKey: true,
            allowNull: false,
            comment: 'Nombre de la prensa (consistente con PlacaElastomero.idPrensa).',
        },
    }, {
        tableName: 'PlacaElastomeroPrensa',
        indexes: [
            { fields: ['idPrensa'], name: 'idx_pep_prensa' },
        ],
    });

    PlacaElastomeroPrensa.associate = (models) => {
        if (models.PlacaElastomero) {
            PlacaElastomeroPrensa.belongsTo(models.PlacaElastomero, {
                foreignKey: 'idPlacaElastomero',
                as: 'placa',
            });
        }
    };

    return PlacaElastomeroPrensa;
};
