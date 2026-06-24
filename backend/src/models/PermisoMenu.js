module.exports = (sequelize, DataTypes) => {
  const PermisoMenu = sequelize.define('PermisoMenu', {
    idPermisoMenu: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMenu: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    idUser: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: false,
    },
    puedeVer: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    puedeAgregar: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    puedeEditar: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
    puedeBorrar: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: false,
    },
  }, {
    tableName: 'PermisoMenu',
    timestamps: false,
    comment: '@deprecated v1.x — Reemplazado por RBAC canónico (Empleado→Rol). El control de acceso a menús se deriva del rol del user en frontend (useCanPerform). Mantener tabla por compat hasta v2.0.',
  });

  PermisoMenu.associate = (models) => {
    PermisoMenu.belongsTo(models.Menu, { foreignKey: 'idMenu', as: 'menu' });
    PermisoMenu.belongsTo(models.User, { foreignKey: 'idUser', as: 'user' });
  };

  return PermisoMenu;
};