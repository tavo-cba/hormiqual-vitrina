const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
require('dotenv').config();
const { createDbConnection } = require('../models');


const SECRET_KEY = process.env.SECRET_KEY;

const login = async (tenant, data) => {
    const { username, password } = data;

    try {
        const db = await createDbConnection(tenant);
        const user = await db.User.findOne({ where: { username } });

        if (!user) {
            throw new Error('Credenciales inválidas');
        }

        const isPasswordValid = await bcrypt.compare(password, user.password);
        if (!isPasswordValid) {
            throw new Error('Credenciales inválidas');
        }

        const token = jwt.sign(
            {
                id: user.id,
                username: user.username,
                tenant,
                permission: user.permission
            },
            SECRET_KEY,
            { expiresIn: '30d' }
        );

        return token;
    } catch (error) {
        console.error('Error en login:', error);
        throw new Error('Error en el proceso de login');
    }
};

const verifyToken = async (token) => {
    try {
        const decoded = jwt.verify(token, SECRET_KEY);
        return decoded;
    } catch (error) {
        throw new Error('Token inválido');
    }
};

module.exports = { login, verifyToken };
