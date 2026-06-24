'use strict';

/**
 * CatalogoEnsayoSnapshot — fotos persistidas de la configuración del catálogo
 * de tipos de ensayo (`AgregadoEnsayoTipo`).
 *
 * Sustituye al flujo "exportar paquete a JSON" por uno server-side: el usuario
 * crea snapshots nombrados ("Configuración pre-pastón mayo 2026"), los lista,
 * y restaura el catálogo desde uno con un click. El JSON exportable sigue
 * existiendo como utilidad técnica para back-compat.
 *
 * Cada snapshot guarda el shape completo del paquete v1 (mismo contrato que
 * exportPaquete) para permitir restauración con la misma lógica que `import`.
 */
module.exports = (sequelize, DataTypes) => {
    const CatalogoEnsayoSnapshot = sequelize.define('CatalogoEnsayoSnapshot', {
        idCatalogoEnsayoSnapshot: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(120),
            allowNull: false,
            comment: 'Etiqueta legible elegida por el usuario.',
        },
        descripcion: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Notas opcionales sobre el snapshot.',
        },
        material: {
            type: DataTypes.STRING(30),
            allowNull: false,
            defaultValue: 'AGREGADOS',
            comment: 'Material al que pertenece el snapshot (mismo enum que AgregadoEnsayoTipo.material).',
        },
        cantidadEnsayos: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
            defaultValue: 0,
            comment: 'Número de tipos de ensayo capturados en el payload.',
        },
        payload: {
            type: DataTypes.JSON,
            allowNull: false,
            comment: 'Paquete completo (mismo shape que /tipos/export). Permite restaurar invocando el mismo flujo de import.',
            // MySQL/MariaDB: DataTypes.JSON se mapea a LONGTEXT, no a JSON nativo.
            // El auto-parseo al leer no siempre se aplica — garantizamos shape de
            // objeto con getter/setter (mismo patrón que Agregado.aptitudes).
            get() {
                const raw = this.getDataValue('payload');
                if (raw == null) return null;
                if (typeof raw === 'object') return raw;
                if (typeof raw === 'string') {
                    try { return JSON.parse(raw); } catch { return null; }
                }
                return raw;
            },
            set(value) {
                if (value == null) {
                    this.setDataValue('payload', null);
                } else if (typeof value === 'string') {
                    // Si ya viene serializado, lo guardamos tal cual (validamos
                    // que sea JSON válido).
                    try { JSON.parse(value); this.setDataValue('payload', value); }
                    catch { this.setDataValue('payload', JSON.stringify(value)); }
                } else {
                    this.setDataValue('payload', JSON.stringify(value));
                }
            },
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Usuario que creó el snapshot (sólo informativo).',
        },
    }, {
        tableName: 'CatalogoEnsayoSnapshot',
        comment: 'Snapshots persistidos de la configuración del catálogo de tipos de ensayo.',
        indexes: [
            { fields: ['material', 'createdAt'] },
        ],
    });

    return CatalogoEnsayoSnapshot;
};
