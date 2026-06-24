module.exports = (sequelize, DataTypes) => {
    const PastonPrueba = sequelize.define('PastonPrueba', {
        idPastonPrueba: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idDosificacionDisenada: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        // PR8 — Escala del pastón. LABORATORIO: vol. reducido (litros),
        // materiales en kg+L. PRODUCCION: escala real (m³), kg+m³, recomendado
        // ≥ 2.5 m³ para tener al menos 2 batches de planta y poder corregir
        // errores del primer batch antes de despachar.
        escala: {
            type: DataTypes.ENUM('LABORATORIO', 'PRODUCCION'),
            allowNull: false,
            defaultValue: 'LABORATORIO',
        },
        volumenM3: {
            type: DataTypes.DECIMAL(6, 4),
            allowNull: false,
        },
        factorExcedente: {
            type: DataTypes.DECIMAL(4, 2),
            allowNull: false,
            defaultValue: 1.10,
        },
        volumenEfectivoM3: {
            type: DataTypes.DECIMAL(6, 4),
            allowNull: false,
        },
        correccionHumedad: {
            type: DataTypes.BOOLEAN,
            defaultValue: false,
        },
        // PR9 — Humedad superficial medida por agregado al momento del
        // pastón. Shape: [{ idAgregado, nombre, humedadPct, absorcionPct }].
        // Se usa para corregir el agua libre y las cantidades de agregado
        // seco/húmedo. Null en pastones legacy o si no se midió.
        humedadAgregadosJson: {
            type: DataTypes.JSON,
            allowNull: true,
        },
        componentes: {
            type: DataTypes.JSON,
            allowNull: false,
        },
        numeroRondaPrueba: {
          type: DataTypes.INTEGER.UNSIGNED,
          allowNull: false,
          defaultValue: 1,
          comment: 'Ronda de prueba a la que pertenece el pastón (se toma del contador de la dosificación al crear).',
        },
        fecha: { type: DataTypes.DATEONLY, allowNull: true },
        hora: { type: DataTypes.TIME, allowNull: true },
        operador: { type: DataTypes.STRING(255), allowNull: true },
        // ─── Campos legacy de medición (PR10 — DEPRECATED desde 2026-05-05) ───
        // Los datos de medición ahora viven en `MedicionPaston` como serie
        // temporal (etapa PLANTA / TRANSPORTE / OBRA). Estos campos se conservan
        // por back-compat con consumers viejos (PDFs, dashboards), pero el form
        // nuevo NO los edita: cuando se carga un pastón nuevo, los datos van a
        // la primera MedicionPaston. `actualizarPaston` los rechaza si ya hay
        // mediciones cargadas. Quedan poblados solo en pastones legacy o como
        // mirror de la primera medición (auto-creada por crearPaston cuando el
        // caller los manda en el body).
        asentamientoMedido: { type: DataTypes.DECIMAL(5, 1), allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.asentamientoMm.' },
        temperaturaHormigon: { type: DataTypes.DECIMAL(4, 1), allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.temperaturaHormigonC.' },
        temperaturaAmbiente: { type: DataTypes.DECIMAL(4, 1), allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.temperaturaAmbienteC.' },
        puvMedido: { type: DataTypes.DECIMAL(8, 2), allowNull: true, comment: 'DEPRECATED PR10 — el PUV se mide al final del pastón, no por medición; queda como dato único del pastón.' },
        aireMedido: { type: DataTypes.DECIMAL(4, 2), allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.aireMedidoPct.' },
        aspecto: { type: DataTypes.STRING(50), allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.aspecto.' },
        probetasMoldeadas: { type: DataTypes.SMALLINT.UNSIGNED, allowNull: true, comment: 'DEPRECATED PR10 — ver MedicionPaston.probetasMoldeadas.' },
        tipoProbeta: { type: DataTypes.STRING(20), allowNull: true },
        identificacionProbetas: { type: DataTypes.STRING(100), allowNull: true },
        observaciones: { type: DataTypes.TEXT, allowNull: true },
        createdBy: { type: DataTypes.STRING(255), allowNull: true },

        // ── Resultado de prueba (evaluación del pastón) ──
        // APROBADO_PRELIMINAR (sesión 2026-06-14): aprobado para iniciar uso
        // de la dosificación pendiente de resultados de rotura de probetas.
        // Se promueve a APROBADO una vez que las probetas confirman fc.
        veredicto: {
            type: DataTypes.ENUM('APROBADO', 'APROBADO_PRELIMINAR', 'RECHAZADO', 'OBSERVADO'),
            allowNull: true,
            comment: 'Veredicto de la prueba: APROBADO = apto definitivo (con probetas confirmadas), APROBADO_PRELIMINAR = apto pendiente de rotura, RECHAZADO = no apto, OBSERVADO = condicional.',
        },
        correccionesJson: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Correcciones realizadas en planta: { aguaAgregadaLts, aditivoAgregado, dosisExtraPct, otraCorrecciones }',
        },
        fotosJson: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Fotos de referencia: [{ url, descripcion }]',
        },
        observacionesGenerales: {
            type: DataTypes.TEXT,
            allowNull: true,
            comment: 'Observaciones técnicas generales de la prueba (más allá del aspecto).',
        },
        evaluadoPor: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Persona que realizó la evaluación de la prueba.',
        },
        veredictoEmitidoPor: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Persona que emitió el veredicto (puede diferir del evaluador).',
        },
        fechaVeredicto: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Fecha y hora del veredicto.',
        },
    }, {
        tableName: 'PastonPrueba',
        comment: 'Pastones de prueba de laboratorio con resultados y veredicto de evaluación.',
    });

    PastonPrueba.associate = (models) => {
        PastonPrueba.belongsTo(models.DosificacionDisenada, {
            foreignKey: 'idDosificacionDisenada',
            as: 'dosificacionDisenada',
        });
    };

    return PastonPrueba;
};
