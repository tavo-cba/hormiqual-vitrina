import React from "react";
import { Tag } from 'primereact/tag';
import './userPanel.css';

const UserPanel = ({ user }) => {
    if (!user) return null;

    return (
        <div className="user-panel">
            <div className="user-panel-grid">
                <div className="user-panel-item">
                    <div className="panel-label">
                        <i className="fa-solid fa-user"></i>
                        <span>USUARIO</span>
                    </div>
                    <span className="panel-value">{user.username}</span>
                </div>

                <div className="user-panel-item">
                    <div className="panel-label">
                        <i className="fa-solid fa-briefcase"></i>
                        <span>EMPLEADO</span>
                    </div>
                    <span className="panel-value">
                        {user.empleado ? `${user.empleado.nombre} ${user.empleado.apellido}` : '—'}
                    </span>
                </div>

                <div className="user-panel-item">
                    <div className="panel-label">
                        <i className="fa-solid fa-building"></i>
                        <span>PLANTAS ASIGNADAS</span>
                    </div>
                    <div className="plantas-tags">
                        {user.allPlantas ? (
                            <Tag value="Todas las plantas" severity="info" className="planta-tag" />
                        ) : user.plantas?.length ? (
                            user.plantas.map((planta, idx) => (
                                <Tag key={idx} value={planta.nombre} className="planta-tag" />
                            ))
                        ) : (
                            <span className="panel-value">—</span>
                        )}
                    </div>
                </div>

                <div className="user-panel-item">
                    <div className="panel-label">
                        <i className="fa-solid fa-shield-halved"></i>
                        <span>ROL</span>
                    </div>
                    <Tag
                        value={user.isAdmin ? 'Administrador' : 'Usuario'}
                        severity={user.isAdmin ? 'warning' : 'info'}
                        className="role-tag"
                    />
                </div>

                {user.soloObra && (
                    <div className="user-panel-item">
                        <div className="panel-label">
                            <i className="fa-solid fa-hard-hat"></i>
                            <span>TIPO</span>
                        </div>
                        <Tag value="Solo obras" severity="warning" className="role-tag" />
                    </div>
                )}
            </div>
        </div>
    );
};

export default UserPanel;
