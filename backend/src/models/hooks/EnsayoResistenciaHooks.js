module.exports = (EnsayoResistencia, EnsayoResistenciaHistory) => {
    /**
     * Recursos MVP Fase C — snapshot de calibración aplicada.
     *
     * Antes de persistir un ensayo, busca la calibración vigente del
     * equipo (idEquipo = idPrensa por la convención de la migración
     * 20260510c) y la setea en `idCalibracionAplicada` si el campo
     * viene vacío. Si el caller ya lo explicitó, respeta su valor.
     *
     * "Vigente" = activa + fechaVencimiento >= hoy. Si el equipo no
     * tiene ninguna calibración vigente, el campo queda NULL — el
     * ensayo se persiste igual (no se bloquea), pero queda detectable
     * por reportes de auditoría posteriores que pueden flagearlos.
     *
     * Esta lógica cierra la cadena de trazabilidad ISO 17025 §6.4.7
     * sin requerir cambios en los callers (servicios de probetas /
     * carga de ensayos / endpoint /api/ensayos-resistencia).
     */
    EnsayoResistencia.beforeCreate(async (ensayoResistencia, options) => {
        if (!ensayoResistencia.idPrensa) return;
        const sequelize = EnsayoResistencia.sequelize;
        const CalibracionEquipo = sequelize?.models?.CalibracionEquipo;
        const EquipoLaboratorio = sequelize?.models?.EquipoLaboratorio;

        // Snapshot 1 — calibración aplicada (Fase C de Recursos MVP).
        if (!ensayoResistencia.idCalibracionAplicada && CalibracionEquipo) {
            const fechaRef = ensayoResistencia.fechaEnsayo || new Date();
            const refDate = new Date(fechaRef);
            refDate.setHours(0, 0, 0, 0);
            const vigente = await CalibracionEquipo.findOne({
                where: {
                    idEquipo: ensayoResistencia.idPrensa,
                    activo: true,
                },
                order: [['fechaCalibracion', 'DESC']],
                transaction: options?.transaction,
            });
            if (vigente && vigente.fechaCalibracion && vigente.fechaVencimiento) {
                const desde = new Date(vigente.fechaCalibracion);
                desde.setHours(0, 0, 0, 0);
                const hasta = new Date(vigente.fechaVencimiento);
                hasta.setHours(0, 0, 0, 0);
                if (desde <= refDate && refDate <= hasta) {
                    ensayoResistencia.idCalibracionAplicada = vigente.idCalibracion;
                }
            }
        }

        // Snapshot 2 — laboratorio (Fase 2 de Laboratorio). Si el caller no lo
        // mandó, lo deducimos desde el equipo (idEquipo == idPrensa por la
        // convención del seed 20260510c). Si el equipo no tiene lab asignado,
        // queda NULL — no bloqueamos, es un dato de auditoría.
        if (!ensayoResistencia.idLaboratorio && EquipoLaboratorio) {
            const equipo = await EquipoLaboratorio.findOne({
                where: { idEquipo: ensayoResistencia.idPrensa },
                attributes: ['idEquipo', 'idLaboratorio'],
                transaction: options?.transaction,
            });
            if (equipo && equipo.idLaboratorio) {
                ensayoResistencia.idLaboratorio = equipo.idLaboratorio;
            }
        }
    });

    /**
     * Sprint 4 (sesión 2026-05-10) — captura el `motivoAjuste` y otros
     * campos auxiliares que NO viven en el registro vivo `EnsayoResistencia`
     * pero que sí deben quedar en el History para auditoría ISO 17025.
     *
     * Cómo invocar desde el caller:
     *   ensayo.update({ ... }, { motivoAjuste: 'texto del revisor', user: 'apellido, nombre' })
     *
     * Sequelize pasa esas options al hook beforeUpdate/afterCreate/etc.
     */
    const buildHistoryRow = (ensayoResistencia, options, operationType) => {
        const base = ensayoResistencia.toJSON();
        return {
            ...base,
            // Los campos de aprobación/desaprobación + técnicos IRAM 1546
            // ya vienen en toJSON() porque están en el modelo. Acá solo
            // agregamos los auxiliares que viven en options.
            motivoAjuste: options?.motivoAjuste ?? null,
            operation_type: operationType,
            operation_date: new Date(),
            operation_user: options?.user || 'desconocido',
        };
    };

    EnsayoResistencia.afterCreate(async (ensayoResistencia, options) => {
        await EnsayoResistenciaHistory.create(buildHistoryRow(ensayoResistencia, options, 'INSERT'));
    });

    EnsayoResistencia.beforeUpdate(async (ensayoResistencia, options) => {
        await EnsayoResistenciaHistory.create(buildHistoryRow(ensayoResistencia, options, 'UPDATE'));
    });

    EnsayoResistencia.beforeDestroy(async (ensayoResistencia, options) => {
        await EnsayoResistenciaHistory.create(buildHistoryRow(ensayoResistencia, options, 'DELETE'));
    });
};