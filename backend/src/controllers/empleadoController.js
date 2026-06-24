const empleadoService = require('../services/empleadoService');
const archivoService = require('../services/archivoService');

const getEmpleados = async (req, res) => {
    try {
        // M-UX-05 (auditoría 08, Bloque 20): filtros opcionales para acotar
        // la lista al personal de calidad de una planta específica.
        // - soloOperariosLab: filtra por rol Calidad (OPERADOR, RESPONSABLE,
        //   DIRECTOR_TECNICO, ADMIN). Excluye empleados sin rol Calidad.
        // - idPlanta: filtra empleados con cuenta de usuario asignada a esa planta
        //   (vía UserPlanta). Empleados sin User no entran al filtro de planta.
        const filtros = {
            soloOperariosLab: req.query.soloOperariosLab === 'true',
            idPlanta: req.query.idPlanta ? Number(req.query.idPlanta) : null,
        };
        const empleados = await empleadoService.getEmpleados(req.db, filtros);
        res.status(200).json(empleados);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al obtener empleados' });
    }
};
const getEmpleado = async (req, res) => {
    try {
        const empleadoId = req.params.id;
        const empleados = await empleadoService.getEmpleado(req.db, empleadoId);
        res.status(200).json(empleados);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al obtener empleado' });
    }
};
const getEmpleadosBaja = async (req, res) => {
    try {
        const empleados = await empleadoService.getEmpleadosBaja(req.db);
        res.status(200).json(empleados);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al obtener empleados dados de baja' });
    }
};
const createEmpleado = async (req, res) => {
    try {
        const nuevoEmpleado = await empleadoService.createEmpleado(req.db, req.body);
        res.status(201).json(nuevoEmpleado);
    } catch (error) {
        console.log(error);
        const detalle = error.errors
            ? error.errors.map(e => e.message).join('. ')
            : error.message || 'Error desconocido';
        res.status(500).json({ error: `Error al crear empleado: ${detalle}` });
    }
};

const updateEmpleado = async (req, res) => {
    try {
        const empleadoId = req.params.id;
        const empleadoActualizado = await empleadoService.updateEmpleado(req.db, empleadoId, req.body);
        res.status(200).json(empleadoActualizado);
    } catch (error) {
        console.log(error);
        const detalle = error.errors
            ? error.errors.map(e => e.message).join('. ')
            : error.message || 'Error desconocido';
        res.status(500).json({ error: `Error al actualizar empleado: ${detalle}` });
    }
};

const deleteEmpleado = async (req, res) => {
    try {
        const empleadoId = req.params.id;
        await empleadoService.deleteEmpleado(req.db, empleadoId);
        res.status(200).json({ message: 'Empleado eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar empleado' });
    }
};

/* Roles */
const getRoles = async (req, res) => {
    try {
        const roles = await empleadoService.getRoles(req.db);
        res.status(200).json(roles);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al obtener roles' });
    }
};

const createRol = async (req, res) => {
    try {
        const nuevoRol = await empleadoService.createRol(req.db, req.body);
        res.status(201).json(nuevoRol);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al crear el rol' });
    }
};
const deleteRol = async (req, res) => {
    try {
        const rolId = req.params.id;
        await empleadoService.deleteRol(req.db, rolId);
        res.status(200).json({ message: 'Rol eliminado correctamente' });
    } catch (error) {
        res.status(500).json({ error: 'Error al eliminar el rol' });
    }
};
const uploadAvatar = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Falta archivo' });

        const nuevoAvatar = await archivoService.uploadEmpleadoAvatar(
            req.db,
            req.params.id,
            req.file,
        );

        res.status(201).json({
            message: 'Avatar actualizado',
            avatar: {
                id: nuevoAvatar.idArchivo,
                url: nuevoAvatar.url,
            },
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al subir avatar' });
    }
};

const uploadFirma = async (req, res) => {
    try {
        if (!req.file) return res.status(400).json({ error: 'Falta archivo' });

        const result = await empleadoService.uploadFirma(
            req.db,
            req.params.id,
            req.file,
        );

        res.status(201).json({
            message: 'Firma actualizada',
            firma: result.firma,
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ error: err.message || 'Error al subir firma' });
    }
};
const bajaEmpleado = async (req, res) => {
    try {
        const empleadoId = req.params.id;
        const { razonBaja, fechaBaja } = req.body;
        const empleado = await empleadoService.bajaEmpleado(
            req.db,
            empleadoId,
            razonBaja,
            fechaBaja
        );
        res.status(200).json(empleado);
    } catch (error) {
        res.status(500).json({ error: 'Error al dar de baja empleado' });
    }
};
const getConvenios = async (req, res) => {
    try {
        const convenios = await empleadoService.getConvenios(req.db);
        res.status(200).json(convenios);
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al obtener convenios' });
    }
};

const updateSalariosBrutos = async (req, res) => {
    try {
        await empleadoService.updateSalariosBrutos(req.db, req.body);
        res.status(200).json({ message: 'Salarios brutos actualizados' });
    } catch (error) {
        console.log(error);
        res.status(500).json({ error: 'Error al actualizar salarios brutos' });
    }
};
const generateTxtConvenio = async (req, res) => {
    try {
        const { nombreTxt, idConvenioEmpleado, idsConvenioEmpleado } = req.body;
        const { nombreArchivo, contenido } = await empleadoService.generateTxtConvenio(
            req.db,
            nombreTxt,
            idsConvenioEmpleado ?? idConvenioEmpleado
        );
        res.setHeader('Content-Type', 'text/plain');
        res.setHeader('Content-Disposition', `attachment; filename="${nombreArchivo}"`);
        res.send(contenido);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Error al generar txt de convenio' });
    }
};
module.exports = {
    getEmpleados,
    getEmpleado,
    createEmpleado,
    updateEmpleado,
    deleteEmpleado,
    getRoles,
    createRol,
    deleteRol,
    uploadAvatar,
    uploadFirma,
    bajaEmpleado,
    getEmpleadosBaja,
    getConvenios,
    updateSalariosBrutos,
    generateTxtConvenio,
};
