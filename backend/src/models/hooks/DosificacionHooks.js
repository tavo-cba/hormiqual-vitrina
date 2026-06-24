module.exports = (Dosificacion, DosificacionHistory) => {
    Dosificacion.afterCreate(async (dosificacion, options) => {
        await DosificacionHistory.create({
            ...dosificacion.toJSON(),
            operation_type: 'INSERT',
            operation_date: new Date(),
            operation_user: options.user || 'desconocido',
        });
    });

    Dosificacion.beforeUpdate(async (dosificacion, options) => {
        await DosificacionHistory.create({
            ...dosificacion.toJSON(),
            operation_type: 'UPDATE',
            operation_date: new Date(),
            operation_user: options.user || 'desconocido',
        });
    });

    Dosificacion.beforeDestroy(async (dosificacion, options) => {
        await DosificacionHistory.create({
            ...dosificacion.toJSON(),
            operation_type: 'DELETE',
            operation_date: new Date(),
            operation_user: options.user || 'desconocido',
        });
    });
};