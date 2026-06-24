// src/models/Empleado.js - ACTUALIZADO
module.exports = (sequelize, DataTypes) => {
    const Empleado = sequelize.define('Empleado', {
        idEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
            primaryKey: true,
            autoIncrement: true,
        },
        idEntidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: false,
        },
        nombre: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        apellido: {
            type: DataTypes.STRING(100),
            allowNull: false,
        },
        dni: {
            type: DataTypes.CHAR(8),
        },
        fechaNacimiento: {
            type: DataTypes.DATEONLY,
        },
        fechaIngreso: {
            type: DataTypes.DATEONLY,
        },
        razonBaja: {
            type: DataTypes.STRING(255),
        },
        fechaBaja: {
            type: DataTypes.DATEONLY,
        },
        firma: {
            type: DataTypes.TEXT('long'),
            comment: 'Firma del empleado en base64'
        },
        firmaKey: {
            type: DataTypes.STRING(255),
        },
        salarioBruto: {
            type: DataTypes.DECIMAL(15, 2),
            get() {
                const rawValue = this.getDataValue('salarioBruto');
                return rawValue === null ? null : Number(rawValue);
            },
        },
        idConvenioEmpleado: {
            type: DataTypes.INTEGER.UNSIGNED,
        },
        idCategoriaConvenio: {
            type: DataTypes.INTEGER.UNSIGNED,
        },
        idTareaDesempenada: {
            type: DataTypes.INTEGER.UNSIGNED,
        },
        numeroLegajo: {
            type: DataTypes.STRING(50),
            allowNull: true,
        },
        fechaIngresoRecibo: {
            type: DataTypes.DATEONLY,
        },
        expuestoPoliticamente: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        afiliadoGremio: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        diasVacaciones: {
            type: DataTypes.INTEGER,
            allowNull: true,
        },
        vacacionesAcumulables: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
        },
        regimenVacacionalCustom: {
            type: DataTypes.JSON,
            allowNull: true,
            comment: 'Override permanente (nivel 2). Formas: {diasFijos:N} | {escala:[{antiguedadDesde,antiguedadHasta,dias}]} | {idRegimenVacacionesPropio:N}',
            get() {
                const raw = this.getDataValue('regimenVacacionalCustom');
                if (raw == null) return null;
                if (typeof raw === 'string') {
                    try { return JSON.parse(raw); } catch { return null; }
                }
                return raw;
            },
        },
        cuil: {
            type: DataTypes.BIGINT,
        },
        grupoSanguineo: {
            type: DataTypes.STRING(3),
            allowNull: true,
            comment: 'Grupo sanguíneo y factor RH (ej: A+, O-, AB+)',
        },
        deleted_at: {
            type: DataTypes.DATE,
            comment: 'Borrado lógico: fecha/hora de inactivación.',
        },
        registradoWeb: {
            type: DataTypes.BOOLEAN,
            allowNull: true,
            defaultValue: false
        },
        firmaElectronicaBase64: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'Firma electrónica del empleado en base64'
        },
        fechaCreacionFirma: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Fecha de creación de la firma electrónica'
        },
        ipCreacionFirma: {
            type: DataTypes.STRING(45),
            allowNull: true,
            comment: 'IP desde donde se creó la firma'
        },
        activo: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true
        },
        empleadoDeObra: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false
        },

        // ─── Override Planilla Horaria Ley 11.544 ───
        // Si quedan en NULL se usa el default de Config según empleadoDeObra.
        planillaHsEntrada: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Override de Hs entrada para Planilla Ley 11.544 (ej: 19:00 para sereno). NULL = usa default de Config.'
        },
        planillaHsSalida: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Override de Hs salida para Planilla Ley 11.544.'
        },
        planillaPausa: {
            type: DataTypes.STRING(50),
            allowNull: true,
            comment: 'Override de Pausa para Planilla Ley 11.544.'
        },

        // ===== NUEVOS CAMPOS PARA AFIP LIBRO DE SUELDOS DIGITAL =====

        // Códigos AFIP
        idCodigoSituacion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de situación de revista AFIP'
        },
        idCodigoCondicion: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de condición laboral AFIP'
        },
        idCodigoActividad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de actividad económica AFIP'
        },
        idCodigoModalidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de modalidad de contratación AFIP'
        },
        idCodigoObraSocial: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de obra social AFIP'
        },
        idCodigoLocalidad: {
            type: DataTypes.INTEGER.UNSIGNED,
            allowNull: true,
            comment: 'Código de localidad AFIP'
        },

        // Campos adicionales para LSD
        seguroVidaObligatorio: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: true,
            comment: '1=Sí tiene seguro, 0=No tiene seguro'
        },
        cantidadHijos: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Cantidad de hijos para asignaciones familiares'
        },
        tieneConyugue: {
            type: DataTypes.BOOLEAN,
            allowNull: false,
            defaultValue: false,
            comment: 'Si tiene cónyuge para asignaciones familiares'
        },
        diasLiquidados: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 30,
            comment: 'Días liquidados en el período'
        },
        horasTrabajadas: {
            type: DataTypes.INTEGER,
            allowNull: true,
            defaultValue: 0,
            comment: 'Horas trabajadas en el período'
        },
        formaPago: {
            type: DataTypes.ENUM('efectivo', 'transferencia', 'deposito', 'acreditacion'),
            allowNull: false,
            defaultValue: 'acreditacion',
            comment: 'Forma de pago del empleado'
        },
        porcentajeAporteAdicional: {
            type: DataTypes.FLOAT,
            allowNull: false,
            defaultValue: 0,
            comment: 'Porcentaje de aporte adicional seguridad social'
        },
        codigoZona: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 60,
            comment: 'Código de zona geográfica'
        },
        codigoSiniestrado: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Código de siniestrado para ART'
        },
        cantidadAdherentes: {
            type: DataTypes.INTEGER,
            allowNull: false,
            defaultValue: 0,
            comment: 'Cantidad de adherentes obra social'
        },
        dependenciaRevista: {
            type: DataTypes.STRING(100),
            allowNull: true,
            comment: 'Dependencia de revista del empleado'
        },
        baseCalculoDiferencial4: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            comment: 'Base de cálculo diferencial aportes OS y FSR (Rem 4)'
        },
        baseCalculoDiferencial8: {
            type: DataTypes.DECIMAL(12, 2),
            allowNull: false,
            defaultValue: 0,
            comment: 'Base de cálculo diferencial OS y FSR (Rem 8)'
        },
        contribucionTareaDiferencial: {
            type: DataTypes.DECIMAL(3, 2),
            allowNull: true,
            comment: 'Contribución de tarea diferencial expresada con dos decimales'
        },

        // ===== BIOMETRÍA — asistencia por foto + ubicación =====
        faceEmbedding: {
            type: DataTypes.TEXT('long'),
            allowNull: true,
            comment: 'Descriptor facial de referencia (JSON array de floats). No reversible a imagen.'
        },
        faceEnrolledAt: {
            type: DataTypes.DATE,
            allowNull: true,
            comment: 'Fecha/hora del registro del rostro de referencia'
        },
        fotoPerfilKey: {
            type: DataTypes.STRING(255),
            allowNull: true,
            comment: 'Key S3 de la foto de perfil (selfie de onboarding)'
        },
        fotoPerfilUrl: {
            type: DataTypes.STRING(500),
            allowNull: true,
            comment: 'URL de la foto de perfil'
        },
    }, {
        tableName: 'Empleado',
        comment: 'Registro de cada empleado con códigos AFIP para Libro de Sueldos Digital.',
        scopes: {
            soloObra: {
                where: { empleadoDeObra: true }
            }
        }
    });

    Empleado.associate = (models) => {
        // Relaciones existentes
        Empleado.belongsTo(models.Entidad, {
            foreignKey: 'idEntidad',
            as: 'entidad',
        });
        Empleado.belongsToMany(models.Rol, {
            through: models.EmpleadoRol,
            foreignKey: 'idEmpleado',
            otherKey: 'idRol',
            as: 'roles',
        });
        Empleado.hasMany(models.Archivo, {
            foreignKey: 'idEmpleado',
            as: 'archivos',
            onDelete: 'CASCADE',
        });
        // [VITRINA] Podadas asociaciones a modelos fuera de scope:
        // EmpleadoEquipo, ConvenioEmpleado, CategoriaConvenio, TareaDesempenada,
        // Liquidacion, Codigo* (AFIP/LSD), LibroSueldoDigitalDetalle,
        // AvisoChecklistMecanico, Proveedor, ConsentimientoBiometrico, SeguimientoPresupuesto.
    };

    return Empleado;
};
