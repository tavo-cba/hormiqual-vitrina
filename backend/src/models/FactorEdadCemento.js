module.exports = (sequelize, DataTypes) => {
    const FactorEdadCemento = sequelize.define('FactorEdadCemento', {
        idFactorEdadCemento: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        cementoTipo: {
            type: DataTypes.STRING(30),
            allowNull: false,
            comment: 'Tipo de cemento: CPN, CPN_ARS, CPP, CPE, CPF',
        },
        edadDias: {
            type: DataTypes.SMALLINT.UNSIGNED,
            allowNull: false,
        },
        factor: {
            type: DataTypes.DECIMAL(5, 3),
            allowNull: false,
            comment: 'Factor β: f\'c(t) = f\'c(28) × β(t)',
        },
        fuente: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Origen del dato: Bibliográfico, Experimental, etc.',
        },
    }, {
        tableName: 'FactorEdadCemento',
        comment: 'Factores de edad β(t) por tipo de cemento para diseño a edades no estándar.',
        indexes: [
            { unique: true, fields: ['cementoTipo', 'edadDias'] },
        ],
    });

    return FactorEdadCemento;
};
