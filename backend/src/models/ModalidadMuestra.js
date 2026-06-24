// src/models/ModalidadMuestra.js
module.exports = (sequelize, DataTypes) => {
    const ModalidadMuestra = sequelize.define(
      "ModalidadMuestra",
      {
        idModalidadMuestra: {
          type: DataTypes.INTEGER.UNSIGNED,
          primaryKey: true,
          autoIncrement: true,
        },
        modalidad: {
          type: DataTypes.STRING(20),
          allowNull: false,
          unique: true,
        },
        descripcion: DataTypes.TEXT,
      },
      {
        tableName: "ModalidadMuestra",
        comment: "Modalidad en la que se toma la muestra: planta, obra o remota",
      }
    );
  
    return ModalidadMuestra;
  };
  