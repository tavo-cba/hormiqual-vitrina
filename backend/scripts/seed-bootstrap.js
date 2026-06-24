/**
 * [VITRINA] seed-bootstrap.js — datos mínimos para poder loguear y operar.
 *
 * Bloqueante 2: no hay endpoint de registro ni seed que cree el primer usuario,
 * planta o entidad. Sin esto no se puede iniciar sesión en el frontend.
 *
 * Crea (idempotente, datos ANONIMIZADOS):
 *   - Una Entidad (tipo 'Planta') + una Planta "Planta Demo".
 *   - Un User admin (username "admin", password "vitrina2026") con isAdmin=true,
 *     hasheado con el MISMO método que userService.createUser (bcryptjs, 10 rondas),
 *     asociado a la planta demo vía UserPlanta.
 *
 * NO siembra Menu: con isAdmin=true el navbar se arma del menuConifg.js estático
 * (filtrado por el bit ADMIN) y MenuGuard hace bypass por ADMIN. Config vacía ->
 * sin disabledModuleRoutes.
 *
 * Requiere que el esquema ya exista (correr antes: node scripts/init-schema.js).
 *
 * Uso:  cd backend && node scripts/seed-bootstrap.js
 */
require('dotenv').config();
const { createDbConnection } = require('../src/models');
const userService = require('../src/services/userService');

const TENANT = process.env.DEV_TENANT || 'vitrina';
const ADMIN_USERNAME = 'admin';
const ADMIN_PASSWORD = 'vitrina2026';

(async () => {
  const db = await createDbConnection(TENANT);

  // ── 1) Planta demo (Entidad -> Planta), idempotente por nombre ──
  let planta = await db.Planta.findOne({ where: { nombre: 'Planta Demo' } });
  if (!planta) {
    const entidad = await db.Entidad.create({ tipoEntidad: 'Planta' });
    planta = await db.Planta.create({
      nombre: 'Planta Demo',
      idEntidad: entidad.idEntidad,
      descripcion: 'Planta de ejemplo (vitrina TFG)',
      activo: true,
    });
    console.log(`[bootstrap] Planta creada: idPlanta=${planta.idPlanta} ("Planta Demo")`);
  } else {
    console.log(`[bootstrap] Planta ya existe: idPlanta=${planta.idPlanta} (no se duplica)`);
  }

  // ── 2) Usuario admin, idempotente por username ──
  const existing = await db.User.findOne({ where: { username: ADMIN_USERNAME } });
  if (!existing) {
    // Reutiliza userService.createUser -> mismo hash (bcryptjs, SALT_ROUNDS=10)
    // + crea UserPlanta para asociarlo a la planta demo.
    const user = await userService.createUser(db, {
      username: ADMIN_USERNAME,
      password: ADMIN_PASSWORD,
      name: 'Admin',
      lastname: 'Vitrina',
      isAdmin: true,
      allPlantas: false,
      plantaIds: [planta.idPlanta],
      adminCreateModify: true,
      adminDelete: true,
      prodCreateModify: true,
      prodDelete: true,
    });
    console.log(`[bootstrap] Usuario admin creado: id=${user.id} username="${ADMIN_USERNAME}" password="${ADMIN_PASSWORD}" (asociado a idPlanta=${planta.idPlanta})`);
  } else {
    console.log(`[bootstrap] Usuario "${ADMIN_USERNAME}" ya existe: id=${existing.id} (no se duplica)`);
  }

  // ── 3) Fila Config base, idempotente ──
  // Producción SIEMPRE tiene una fila Config. Sin ella, getProbetasConfig (y otros
  // getters de configService) devuelven null y el form de Muestras crashea al leer
  // probetaConfig.probetaSerieUno. Creamos una con los defaults del modelo
  // (probetaSerie 7/28/28/56). NO se copian credenciales ni datos sensibles.
  if (db.Config) {
    const cfgCount = await db.Config.count();
    if (cfgCount === 0) {
      await db.Config.create({});
      console.log('[bootstrap] Config base creada (series de probeta por defecto 7/28/28/56).');
    } else {
      console.log(`[bootstrap] Config ya existe (${cfgCount} fila/s, no se duplica).`);
    }
  }

  // ── 4) Operador demo (Empleado), idempotente por (nombre, apellido) ──
  // El form de Muestras exige un Operador (idOperador). En la vitrina no hay ABM
  // de Empleado (módulo RRHH recortado), así que sembramos uno. Patrón Entidad:
  // Entidad(tipoEntidad='Empleado') + Empleado(nombre, apellido, idEntidad).
  if (db.Empleado && db.Entidad) {
    const yaExiste = await db.Empleado.findOne({ where: { nombre: 'Juan', apellido: 'Operario' } });
    if (!yaExiste) {
      const ent = await db.Entidad.create({ tipoEntidad: 'Empleado' });
      const emp = await db.Empleado.create({ nombre: 'Juan', apellido: 'Operario', idEntidad: ent.idEntidad });
      console.log(`[bootstrap] Operador demo creado: idEmpleado=${emp.idEmpleado} ("Operario, Juan").`);
    } else {
      console.log('[bootstrap] Operador demo "Juan Operario" ya existe (no se duplica).');
    }
  }

  // ── 5) Clientes demo, idempotente por razonSocial ──
  // El form de Muestras exige un Cliente. Sin ABM de Cliente en la vitrina,
  // sembramos 3 (Jurídicas). Patrón Entidad: Entidad(tipoEntidad='Cliente') +
  // Cliente(tipoPersona='Jurídica', razonSocial, idEntidad).
  if (db.Cliente && db.Entidad) {
    const CLIENTES_DEMO = [
      'Hormigonera Demo S.A.',
      'Constructora del Valle S.R.L.',
      'Obras y Pavimentos del Sur S.A.',
    ];
    for (const razonSocial of CLIENTES_DEMO) {
      const yaExiste = await db.Cliente.findOne({ where: { razonSocial } });
      if (!yaExiste) {
        const ent = await db.Entidad.create({ tipoEntidad: 'Cliente' });
        const cli = await db.Cliente.create({ tipoPersona: 'Jurídica', razonSocial, idEntidad: ent.idEntidad });
        console.log(`[bootstrap] Cliente demo creado: idCliente=${cli.idCliente} ("${razonSocial}").`);
      } else {
        console.log(`[bootstrap] Cliente demo "${razonSocial}" ya existe (no se duplica).`);
      }
    }
  }

  // ── 6) Obras demo, idempotente por nombre ──
  // Campo opcional en Muestras, pero útil para la demo. Patrón Entidad:
  // Entidad(tipoEntidad='Obra') + Obra(nombre, idEntidad, estadoObra).
  if (db.Obra && db.Entidad) {
    const OBRAS_DEMO = [
      { nombre: 'Edificio Las Lomas — Torre A', estadoObra: 'en_curso' },
      { nombre: 'Pavimento Ruta Provincial 12', estadoObra: 'en_curso' },
      { nombre: 'Puente Arroyo Seco',           estadoObra: 'planificada' },
      { nombre: 'Nave Industrial Parque Norte', estadoObra: 'finalizada' },
    ];
    for (const o of OBRAS_DEMO) {
      const yaExiste = await db.Obra.findOne({ where: { nombre: o.nombre } });
      if (!yaExiste) {
        const ent = await db.Entidad.create({ tipoEntidad: 'Obra' });
        const obra = await db.Obra.create({ nombre: o.nombre, estadoObra: o.estadoObra, idEntidad: ent.idEntidad });
        console.log(`[bootstrap] Obra demo creada: idObra=${obra.idObra} ("${o.nombre}").`);
      } else {
        console.log(`[bootstrap] Obra demo "${o.nombre}" ya existe (no se duplica).`);
      }
    }
  }

  // ── 7) User del Operador demo (para el dropdown de Operario del ensayo) ──
  // El filtro `soloOperariosLab` del form de ensayo solo lista empleados CON un
  // User vinculado. Creamos un User para Juan Operario + rol OPERADOR para que
  // aparezca como operario del ensayo (y para mostrar separación de roles).
  if (db.User && db.Empleado) {
    const juan = await db.Empleado.findOne({ where: { nombre: 'Juan', apellido: 'Operario' } });
    if (juan) {
      let uOp = await db.User.findOne({ where: { username: 'operario' } });
      if (!uOp) {
        uOp = await userService.createUser(db, {
          username: 'operario',
          password: ADMIN_PASSWORD,
          name: 'Juan',
          lastname: 'Operario',
          idEmpleado: juan.idEmpleado,
          allPlantas: false,
          plantaIds: [planta.idPlanta],
          prodCreateModify: true,
        });
        console.log(`[bootstrap] User "operario" creado (id=${uOp.id}, password="${ADMIN_PASSWORD}") vinculado a Juan Operario.`);
      } else {
        console.log('[bootstrap] User "operario" ya existe (no se duplica).');
      }
      // rolCalidad lo seteamos aparte (createUser no lo toma como parámetro).
      await db.User.update({ rolCalidad: 'OPERADOR' }, { where: { id: uOp.id } });
    }
  }

  // ── 8) Prensa demo (AUTOMÁTICA), idempotente por nombre ──
  // Habilita el form de ensayo de compresión: con prensa AUTOMÁTICA, el operario
  // ingresa la "Carga aplicada" directa y el motor calcula la resistencia usando
  // el diámetro real de la probeta (carga / área). Sin prensa no hay cálculo.
  if (db.Prensa) {
    // idPlanta es necesario: el form de ensayo, cuando la planta no tiene
    // laboratorios cargados (caso vitrina), filtra las prensas por planta
    // (p.idPlanta === idPlanta de la muestra). Sin idPlanta no aparece en el
    // dropdown.
    const [prensa, creada] = await db.Prensa.findOrCreate({
      where: { nombre: 'Prensa Automática Demo' },
      defaults: { nombre: 'Prensa Automática Demo', tipoOperacion: 'AUTOMATICA', activo: true, idPlanta: planta.idPlanta },
    });
    // Back-fill por si la prensa ya existía sin idPlanta (corrida previa del seed).
    if (prensa.idPlanta == null) { await prensa.update({ idPlanta: planta.idPlanta }); }
    console.log(creada
      ? `[bootstrap] Prensa demo creada (idPrensa=${prensa.idPrensa}, AUTOMATICA).`
      : '[bootstrap] Prensa demo ya existe (no se duplica).');
  }

  console.log('[bootstrap] Listo. Menu NO sembrado (isAdmin habilita navbar via menuConifg estatico + MenuGuard bypass).');
  process.exit(0);
})().catch((e) => {
  console.error('[bootstrap] ERROR:', e);
  process.exit(1);
});
