'use strict';

/**
 * SecuenciaIdentificacionPlaca — contador autoincremental por tipo de placa.
 *
 * Dos filas fijas:
 *   - `PG` → placas Ø150 mm
 *   - `PC` → placas Ø100 mm
 *
 * El service incrementa el contador transaccionalmente (SELECT ... FOR UPDATE)
 * para evitar colisiones bajo concurrencia.
 */
module.exports = (sequelize, DataTypes) => {
    const SecuenciaIdentificacionPlaca = sequelize.define('SecuenciaIdentificacionPlaca', {
        prefijo: {
            type: DataTypes.STRING(2),
            primaryKey: true,
            allowNull: false,
        },
        ultimoNumero: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
        },
    }, {
        tableName: 'SecuenciaIdentificacionPlaca',
        timestamps: true,
        createdAt: false,
        updatedAt: 'updatedAt',
    });

    return SecuenciaIdentificacionPlaca;
};
