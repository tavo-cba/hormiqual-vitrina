'use strict';

/**
 * Sprint 3 (sesión 2026-05-10) — auditoría persistente de cambios
 * sensibles en `Config`. Hasta ahora los cambios solo dejaban un
 * `console.log` que se perdía cuando rotaban los logs.
 *
 * Casos auditados al cierre de Sprint 3:
 *   - `aprobacionAutomaticaEnsayos` ON/OFF (IRAM 1666 §A.7 segregación
 *     de funciones). La auditoría externa va a pedir el histórico de
 *     cambios al protocolo de aprobación.
 *
 * Diseñado para crecer: cualquier otro campo crítico se loguea con
 * la misma tabla cambiando el `campo` (string).
 *
 * Inmutable: no hay update ni destroy. Si se necesita corregir un
 * registro, se inserta uno nuevo con motivo "correccion_registro".
 */
module.exports = (sequelize, DataTypes) => {
    const ConfigChangeLog = sequelize.define('ConfigChangeLog', {
        idLog: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        campo: {
            type: DataTypes.STRING(100),
            allowNull: false,
            comment: 'Nombre del campo de Config que cambió (ej. aprobacionAutomaticaEnsayos).',
        },
        valorAnterior: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Serializado como string (JSON.stringify si no es primitivo).',
        },
        valorNuevo: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Serializado como string (JSON.stringify si no es primitivo).',
        },
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Empleado que efectuó el cambio (req.user.idEmpleado).',
        },
        nombreEmpleado: {
            type: DataTypes.STRING(200),
            allowNull: true,
            comment: 'Snapshot del nombre completo al momento del cambio (anti-bitrot si el empleado se elimina).',
        },
        motivo: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Justificación opcional. Para cambios críticos puede ser requerido por el controller.',
        },
        ipOrigen: {
            type: DataTypes.STRING(45),
            allowNull: true,
            comment: 'IP del cliente (req.ip). IPv4 o IPv6.',
        },
    }, {
        tableName: 'ConfigChangeLog',
        comment: 'Auditoría inmutable de cambios sensibles en Config (Sprint 3 — sesión 2026-05-10).',
        // No timestamps automáticos — usamos `createdAt` explícito desde Sequelize
        // y NO updatedAt (la tabla es append-only).
        updatedAt: false,
        indexes: [
            { fields: ['campo', 'createdAt'] },
            { fields: ['idEmpleado'] },
        ],
    });

    return ConfigChangeLog;
};
