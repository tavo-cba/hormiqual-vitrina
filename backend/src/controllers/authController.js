const authService = require('../services/authService');
const { extractTenantFromRequest } = require('../middlewares/extractTenant');

const login = async (req, res) => {
    try {
        const tenant = extractTenantFromRequest(req);
        const token = await authService.login(tenant, req.body);
        res.status(201).json(token);
    } catch (error) {
        console.error("Error en login:", error.message);
        const msg = error.message.includes("Credenciales") ? error.message : "Error al iniciar sesión";
        res.status(401).json({ error: msg });
    }
};

const getUser = async (req, res) => {
    try {
        const {
            name,
            lastname,
            permission,
            isAdmin,
            allPlantas,
            soloObra,
            accesoAgente,
            plantaIds,
            roles,
            idEmpleado,
            rolCalidad,
            rolFlota,
            rolMantenimiento,
            rolProduccion,
            menuPerms,
            disabledModuleRoutes,
        } = req.user;
        res.status(200).json({
            name,
            lastname,
            permission,
            isAdmin,
            allPlantas,
            soloObra,
            accesoAgente,
            plantaIds,
            roles,
            idEmpleado,
            rolCalidad,
            rolFlota,
            rolMantenimiento,
            rolProduccion,
            menuPerms,
            disabledModuleRoutes,
        });
    } catch (error) {
        console.error("Error al obtener user:", error);
        res.status(500).json({ error: 'Error al obtener usuario' });
    }
};

const verifyToken = async (req, res) => {
    try {
        const token = req.headers.authorization?.split(' ')[1];

        if (!token) {
            return res.status(401).json({ message: 'Token no proporcionado' });
        }

        const tokenRes = await authService.verifyToken(token);
        res.status(200).json(tokenRes);
    } catch (error) {
        res.status(500).json({ error: 'Error al verificar token' });
    }
};

module.exports = {
    login,
    verifyToken,
    getUser
};
