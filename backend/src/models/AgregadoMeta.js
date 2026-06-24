module.exports = (sequelize, DataTypes) => {
    const AgregadoMeta = sequelize.define('AgregadoMeta', {
        idAgregadoMeta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        legacyAgregadoId: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            unique: true,
            comment: 'FK lógica a Agregado.idAgregado',
        },
        subtipoMaterial: {
            type: DataTypes.ENUM(
                'CANTO_RODADO', 'TRITURADO_NATURAL', 'TRITURADO_ARTIFICIAL',
                'ESCORIA_ALTO_HORNO', 'LIVIANO',
                'ARENA_NATURAL', 'ARENA_TRITURACION',
            ),
            allowNull: true,
            defaultValue: null,
            comment: 'Subtipo del material: gruesos (CANTO_RODADO|TRITURADO_*|ESCORIA_ALTO_HORNO|LIVIANO) o finos (ARENA_*).',
        },
        cantera: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Nombre de la cantera de origen',
        },
        productor: {
            type: DataTypes.STRING(255),
            allowNull: false,
            defaultValue: '',
            comment: 'Nombre del productor (requerido)',
        },
        nroExpediente: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Número de expediente (ex nroRegistroMinero)',
        },
        tipoRoca: {
            type: DataTypes.ENUM('GRANITICA', 'BASALTICA', 'CALCAREA', 'CUARCITICA', 'OTRA'),
            allowNull: true,
            defaultValue: null,
        },
        evaluacionRas: {
            type: DataTypes.ENUM('NO_EVALUADO', 'NO_REACTIVO', 'POTENCIALMENTE_REACTIVO'),
            allowNull: true,
            defaultValue: 'NO_EVALUADO',
        },
        alertaClasificacion: {
            type: DataTypes.JSON,
            allowNull: true,
            defaultValue: null,
        },
    }, {
        tableName: 'AgregadoMeta',
        comment: 'Metadatos extendidos de agregados sin tocar tabla legacy.',
    });

    return AgregadoMeta;
};
