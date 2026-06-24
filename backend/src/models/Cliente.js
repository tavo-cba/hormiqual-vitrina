module.exports = (sequelize, DataTypes) => {
    const Cliente = sequelize.define('Cliente', {
        idCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        tipoPersona: {
            type: DataTypes.ENUM('Física', 'Jurídica'),
            allowNull: false,
        },
        nombre: {
            type: DataTypes.STRING(50),
        },
        apellido: {
            type: DataTypes.STRING(50),
        },
        dni: {
            type: DataTypes.CHAR(8),
        },
        cuil_cuit: {
            type: DataTypes.CHAR(11),
        },
        nombreFantasia: {
            type: DataTypes.STRING(255),
        },
        razonSocial: {
            type: DataTypes.STRING(255),
        },
        referencia: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Observación/referencia del cliente (ej. obra o establecimiento). Se concatena al nombre en el listado.',
        },
        condicionIva: {
            type: DataTypes.INTEGER,
            comment: 'Condición frente al IVA del receptor (códigos AFIP FEParamGetCondicionIvaReceptor).',
            allowNull: true,
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
        esEmpresaGrande: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Indica si el cliente es Empresa Grande (obliga a emitir FCE según Ley 27.440).',
        },
        sistemaFCE: {
            type: DataTypes.ENUM('SCA', 'ADC'),
            allowNull: false,
            defaultValue: 'SCA',
            comment: 'Sistema de circulación FCE: SCA (Circulación Abierta) o ADC (Agente de Depósito Colectivo).',
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        idEmpleadoVendedor: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Vendedor asignado al cliente (CRM)',
        },
        idCategoriaCliente: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Categoría del cliente (CRM)',
        },
    }, {
        tableName: 'Cliente',
        comment: 'Representa un cliente (empresa o persona física).',
    });

    Cliente.associate = (models) => {
        Cliente.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });

        Cliente.belongsTo(models.Empleado, { foreignKey: 'idEmpleadoVendedor', as: 'vendedor' });
        // [VITRINA] Podadas: CategoriaCliente, EtiquetaCliente (CRM).
    };

    return Cliente;
};
