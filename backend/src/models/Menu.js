module.exports = (sequelize, DataTypes) => {
  const Menu = sequelize.define('Menu', {
    idMenu: {
      type: DataTypes.INTEGER.UNSIGNED,
      primaryKey: true,
      autoIncrement: true,
    },
    idMenuPadre: {
      type: DataTypes.INTEGER.UNSIGNED,
      allowNull: true,
    },
    nombre: {
      type: DataTypes.STRING(100),
      allowNull: false,
    },
    ruta: {
      type: DataTypes.STRING(100),
      allowNull: true,
    },
    icono: {
      type: DataTypes.STRING(50),
      allowNull: true,
    },
    orden: {
      type: DataTypes.INTEGER,
      allowNull: false,
      defaultValue: 0,
    },
    activo: {
      type: DataTypes.BOOLEAN,
      allowNull: false,
      defaultValue: true,
    },
    modulo: {
      type: DataTypes.STRING(50),
      allowNull: true,
      defaultValue: null,
      comment: 'Módulo al que pertenece (null = siempre visible)',
    },
  }, {
    tableName: 'Menu',
    comment: 'Estructura de menú de navegación',
  });

  Menu.associate = (models) => {
    Menu.belongsTo(Menu, { as: 'padre', foreignKey: 'idMenuPadre' });
    Menu.hasMany(Menu, { as: 'hijos', foreignKey: 'idMenuPadre' });
    Menu.belongsToMany(models.User, {
      through: models.PermisoMenu,
      foreignKey: 'idMenu',
      otherKey: 'idUser',
      as: 'usuarios',
    });
  };

  return Menu;
};