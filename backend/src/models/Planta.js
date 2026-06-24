module.exports = (sequelize, DataTypes) => {
    const Planta = sequelize.define('Planta', {
        idPlanta: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        marca: {
            type: DataTypes.STRING(50),
        },
        modelo: {
            type: DataTypes.STRING(50),
        },
        anio: {
            type: DataTypes.DATE,
        },
        capacidad: {
            type: DataTypes.STRING(10),
        },
        fechaUltimaCalibracion: {
            type: DataTypes.DATEONLY,
        },
        certificadoVigente: {
            type: DataTypes.BOOLEAN,
        },
        descripcion: {
            type: DataTypes.TEXT,
        },
        latitud: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        longitud: {
            type: DataTypes.FLOAT,
            allowNull: true,
        },
        radioVerificacionUbicacionMetros: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 200,
            comment: 'Radio (m) dentro del cual se considera que un vehículo "está en planta" para validación de carga.',
        },
        umbralEtaCercaMin: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 15,
            comment: 'Umbral (min) de ETA por debajo del cual un vehículo en tránsito se considera "cerca de planta".',
        },
        umbralSinSenalMin: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 30,
            comment: 'Umbral (min) sin ping GPS a partir del cual se considera "sin señal" y se bloquea la carga.',
        },
        deleted_at: {
            type: DataTypes.DATE,
            comment: 'Borrado lógico: fecha/hora de inactivación.',
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        betonmaticUrl: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'URL del WebAccess de Betonmatic (tunnel Cloudflare)',
        },
        betonmaticModo: {
            type: DataTypes.ENUM('completo', 'terminal'),
            allowNull: true,
            comment: 'Modo de trabajo del Betonmatic: completo o terminal',
        },
        cantidadTolvas: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            defaultValue: 4,
            comment: 'Cantidad de tolvas de agregados disponibles en la planta',
        },
        betonmaticActivo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Si la integración con Betonmatic está habilitada',
        },
        betonmaticCfClientId: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'CF-Access-Client-Id para Cloudflare Zero Trust',
        },
        betonmaticCfClientSecret: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'CF-Access-Client-Secret para Cloudflare Zero Trust',
        },
        betonmaticNroPlanta: {
            type: DataTypes.INTEGER,
            allowNull: true,
            comment: 'NroPlanta de Betonmatic. Hidratado por "Probar conexión"; usado en el payload de CrearLinea.',
        },
        m3PorBatch: {
            type: DataTypes.DOUBLE,
            allowNull: true,
            comment: 'Capacidad del mezclador en m³ por batch. Se envía como `M3xBatch` al publicar fórmulas a Betonmatic; sin este valor la planta no carga la fórmula.',
        },
        capacidadBalanzaCementoKg: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            comment: 'Capacidad máx. (kg) de la tolva balanza de cemento/adiciones — IRAM 1666 Tabla 7 (>30%/≤30%).',
        },
        capacidadBalanzaAridosKg: {
            type: DataTypes.DECIMAL(10, 2),
            allowNull: true,
            comment: 'Capacidad máx. (kg) de la báscula de áridos (única para los 4 áridos) — IRAM 1666 Tabla 7.',
        },
        origenDosificaciones: {
            type: DataTypes.ENUM('DISENADOR', 'ESTATICA'),
            allowNull: false,
            defaultValue: 'ESTATICA',
            comment: 'De dónde salen las dosificaciones para los despachos: DISENADOR (motor Calidad) o ESTATICA (catálogo legacy). DISENADOR requiere módulo Calidad activo en el tenant.',
        },
        googleMapsPlaceUrl: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: 'URL del perfil de Google Maps del negocio',
        },
        // PR8.18 — Modo de producción IRAM 1666 / CIRSOC §6.2:
        //   '1' = planta certificada con SGC vigente → criterios §6.2.3 (medias móviles + estimadores)
        //   '2' = planta sin SGC vigente → criterios §6.2.4 (f'cm3 ≥ f'c+5 + f'ci ≥ f'c)
        // Cambio automático §6.2.2.2: 4 lotes seguidos no conformes en Modo 1 → forzar Modo 2.
        modoProduccion: {
            type: DataTypes.ENUM('1', '2'),
            allowNull: false,
            defaultValue: '2',
            comment: 'IRAM 1666 / CIRSOC §6.2 — Modo 1: SGC certificado / Modo 2: sin SGC. Default 2 (más conservador).',
        },
        sgcOrganismo: {
            type: DataTypes.STRING(120),
            allowNull: true,
            comment: 'PR8.18 — Modo 1: organismo certificador del SGC (ej: IRAM, IAS).',
        },
        sgcVigenciaHasta: {
            type: DataTypes.DATEONLY,
            allowNull: true,
            comment: 'PR8.18 — Modo 1: fecha de vigencia del certificado SGC.',
        },
        sgcAlcance: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'PR8.18 — Modo 1: alcance del SGC (ej: "Producción de hormigón elaborado").',
        },
        // ── RDC / HRDC (Relleno de Densidad Controlada) — modelo Segerer 2017
        //    / AAHE-Becker 2013. RDC fuera de CIRSOC: parámetros de planta del
        //    modelo de diseño (Fase 2). Si quedan en null, el motor usa sus
        //    constantes citadas por defecto (REDUCCION_PCT 22% ≈ PUV 1650,
        //    tolerancia ±80 kg/m³).
        rdcModoDensidad: {
            type: DataTypes.ENUM('REDUCCION_PCT', 'PUV_OBJETIVO'),
            allowNull: false,
            defaultValue: 'REDUCCION_PCT',
            comment: 'RDC: cómo se fija la densidad objetivo. REDUCCION_PCT = % sobre el mortero base; PUV_OBJETIVO = valor fijo.',
        },
        rdcPuvObjetivoKgM3: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'RDC modo PUV_OBJETIVO: densidad fresca objetivo (kg/m³). Null → default del motor (1650, Segerer 2017).',
        },
        rdcReduccionPct: {
            type: DataTypes.DECIMAL(4, 1),
            allowNull: true,
            comment: 'RDC modo REDUCCION_PCT: % de reducción respecto del mortero base sin aire. Null → default del motor (22%).',
        },
        rdcPuvToleranciaKgM3: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'RDC: tolerancia de control del PUV (±kg/m³) para el warning de densidad. Null → default del motor (80, Segerer 2017).',
        },
        rdcFactorAguaConsistencia: {
            type: DataTypes.DECIMAL(4, 3),
            allowNull: true,
            comment: 'RDC Fase 3: factor multiplicativo único de calibración del agua por consistencia (por planta). Null → 1,0 (motor).',
        },
    }, {
        tableName: 'Planta',
        comment: 'Plantas de hormigón, pueden haber varias en distintas ubicaciones.',
    });

    Planta.associate = (models) => {
        Planta.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
        // [VITRINA] Podadas: BocaCarga, ProductoServicio.
        Planta.belongsToMany(models.User, {
            through: models.UserPlanta,
            foreignKey: 'idPlanta',
            otherKey: 'idUser',
            as: 'users',
        });
    };

    return Planta;
};
