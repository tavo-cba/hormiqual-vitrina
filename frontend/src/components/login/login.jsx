import React, { useState, useRef, useEffect, useContext } from 'react';
import './login.css';
import axios from 'axios';
import { config } from '../../config/config';
import { InputText } from 'primereact/inputtext';
import { useConfig } from "../../context/ConfigContext";
import { ThemeContext } from "../../context/ThemeContext";
// [VITRINA] Logos por defecto (la tabla Config no trae logoLink).
import logoDark from "../../assets/img/logo-dark.png";
import logoLight from "../../assets/img/logo-light.png";


const SupportCard = ({ className = '', whatsappSoporte }) => {
    if (!whatsappSoporte) return null;
    return (
        <div className={`login-support ${className}`}>
            <div className="login-support-icon">
                <i className="fa-solid fa-headset" />
            </div>
            <div className="login-support-text">
                <h4 className="login-support-title">Soporte técnico</h4>
                <p className="login-support-desc">
                    ¿Tenés algún problema? Escribinos.
                </p>
            </div>
            <a
                href={`https://wa.me/${whatsappSoporte}`}
                target="_blank"
                rel="noopener noreferrer"
                className="login-support-link"
            >
                <i className="fa-brands fa-whatsapp" />
                Contactar
            </a>
        </div>
    );
};

const Login = () => {
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [errorMessage, setErrorMessage] = useState('');
    const [loading, setLoading] = useState(false);
    const [passwordVisible, setPasswordVisible] = useState(false);
    const usernameRef = useRef(null);

    const cfg = useConfig();
    const { isDark } = useContext(ThemeContext) || {};

    // Panel de marca: fondo siempre oscuro (gradiente) → logo claro (logo-dark).
    const brandLogo = cfg?.logoLink || logoDark;
    // Logo mobile en el panel del formulario: se adapta al tema.
    const mobileLogo = cfg?.logoLink || (isDark ? logoDark : logoLight);

    useEffect(() => {
        usernameRef.current?.focus();
    }, []);

    const handleSubmit = async (e) => {
        e.preventDefault();
        setErrorMessage('');
        setLoading(true);

        try {
            const response = await axios.post(`${config.backendUrl}/api/auth/login`, {
                username,
                password,
            });
            const token = response.data;
            localStorage.setItem('token', token);
            window.location.href = '/';
        } catch (error) {
            setErrorMessage(
                error.response?.data?.message || 'Error al iniciar sesión. Intenta nuevamente.'
            );
            setLoading(false);
        }
    };

    return (
        <div className="login-screen">
            {/* Left branding panel (desktop only) */}
            <div className="login-brand-panel">
                {/* Animated floating orbs */}
                <div className="login-brand-orb login-brand-orb--1" />
                <div className="login-brand-orb login-brand-orb--2" />
                <div className="login-brand-orb login-brand-orb--3" />
                <div className="login-brand-orb login-brand-orb--4" />
                {/* Subtle grid overlay */}
                <div className="login-brand-grid" />
                <img src={brandLogo} alt="HormiQual" className="login-brand-logo" />
                <p className="login-brand-tagline">
                    Gestión integral de hormigón elaborado
                </p>
            </div>

            {/* Right form panel */}
            <div className="login-form-panel">
                <div className="login-form-wrapper">
                    {/* Mobile-only logo */}
                    <img src={mobileLogo} alt="HormiQual" className="login-mobile-logo" />

                    <h1 className="login-form-heading">Iniciar sesión</h1>
                    <p className="login-form-subheading">
                        Ingresá tus credenciales para continuar
                    </p>

                    {errorMessage && (
                        <div className="login-error" role="alert">
                            <i className="fa-solid fa-circle-xmark" />
                            <span>{errorMessage}</span>
                        </div>
                    )}

                    <form onSubmit={handleSubmit} autoComplete="on">
                        {/* Username */}
                        <div className="login-field">
                            <label className="login-field-label" htmlFor="login-user">
                                Usuario
                            </label>
                            <div className="login-input-wrapper">
                                <i className="fa-solid fa-user login-input-icon" />
                                <InputText
                                    ref={usernameRef}
                                    id="login-user"
                                    type="text"
                                    className="login-input"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="Tu nombre de usuario"
                                    required
                                    autoComplete="username"
                                />
                            </div>
                        </div>

                        {/* Password */}
                        <div className="login-field">
                            <label className="login-field-label" htmlFor="login-pass">
                                Contraseña
                            </label>
                            <div className="login-input-wrapper">
                                <i className="fa-solid fa-lock login-input-icon" />
                                <InputText
                                    id="login-pass"
                                    type={passwordVisible ? 'text' : 'password'}
                                    className="login-input"
                                    value={password}
                                    onChange={(e) => setPassword(e.target.value)}
                                    placeholder="Tu contraseña"
                                    required
                                    autoComplete="current-password"
                                    style={{ paddingRight: '2.8rem' }}
                                />
                                <button
                                    type="button"
                                    className="login-eye-btn"
                                    onClick={() => setPasswordVisible(!passwordVisible)}
                                    tabIndex={-1}
                                    aria-label={passwordVisible ? 'Ocultar contraseña' : 'Mostrar contraseña'}
                                >
                                    <i className={`fa-solid ${passwordVisible ? 'fa-eye-slash' : 'fa-eye'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Submit */}
                        <button
                            type="submit"
                            className="login-submit-btn"
                            disabled={loading}
                        >
                            {loading && <span className="login-spinner" />}
                            {loading ? 'Iniciando sesión...' : 'Iniciar sesión'}
                        </button>
                    </form>

                    {/* Support – desktop (inline) */}
                    <SupportCard className="login-support--desktop" whatsappSoporte={cfg?.whatsappSoporte} />

                    <p className="login-footer">
                        &copy; {new Date().getFullYear()} &middot; HormiQual
                    </p>
                </div>

                {/* Support – mobile (pinned to bottom) */}
                <SupportCard className="login-support--mobile" whatsappSoporte={cfg?.whatsappSoporte} />
            </div>
        </div>
    );
};

export default Login;
