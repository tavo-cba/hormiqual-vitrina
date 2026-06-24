const userService = require('../services/userService');

/** GET /api/users */
exports.getUsers = async (req, res) => {
  try {
    const users = await userService.getUsers(req.db);
    res.status(200).json(users);
  } catch (err) {
    console.error('Error in getUsers:', err);
    res.status(500).json({ error: 'Error al obtener usuarios' });
  }
};

/** GET /api/users/:id */
exports.getUser = async (req, res) => {
  try {
    const user = await userService.getUser(req.db, req.params.id);
    if (!user) return res.status(404).json({ error: 'Usuario no encontrado' });
    res.status(200).json(user);
  } catch (err) {
    console.error('Error in getUser:', err);
    res.status(500).json({ error: 'Error al obtener el usuario' });
  }
};

/** POST /api/users */
exports.createUser = async (req, res) => {
  try {
    const newUser = await userService.createUser(req.db, req.body);
    res.status(201).json(newUser);
  } catch (err) {
    console.error('Error in createUser:', err);
    const detalle = Array.isArray(err.errors) && err.errors.length
      ? err.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
      : null;
    res.status(500).json({
      error: detalle || err.message || 'Error al crear el usuario',
      campos: Array.isArray(err.errors) ? err.errors.map((e) => e.path) : undefined,
    });
  }
};

/** PUT /api/users/:id */
exports.updateUser = async (req, res) => {
  try {
    const updated = await userService.updateUser(req.db, req.params.id, req.body);
    res.status(200).json(updated);
  } catch (err) {
    console.error('Error in updateUser:', err);
    // Sequelize ValidationError trae los campos que fallaron en err.errors[].
    // Lo serializamos para que el frontend muestre algo más útil que
    // "Validation error".
    const detalle = Array.isArray(err.errors) && err.errors.length
      ? err.errors.map((e) => `${e.path}: ${e.message}`).join('; ')
      : null;
    res.status(500).json({
      error: detalle || err.message || 'Error al actualizar el usuario',
      campos: Array.isArray(err.errors) ? err.errors.map((e) => e.path) : undefined,
    });
  }
};

/** DELETE /api/users/:id */
exports.deleteUser = async (req, res) => {
  try {
    await userService.deleteUser(req.db, req.params.id);
    res.status(200).json({ message: 'Usuario eliminado correctamente' });
  } catch (err) {
    console.error('Error in deleteUser:', err);
    res.status(500).json({ error: 'Error al eliminar el usuario' });
  }
};

