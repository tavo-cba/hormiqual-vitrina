import React, { useEffect, useState, useMemo } from 'react';
import { DataTable } from 'primereact/datatable';
import { Column } from 'primereact/column';
import { Button } from 'primereact/button';
import { confirmDialog } from 'primereact/confirmdialog';
import { useNavigate } from 'react-router-dom';
import { Dialog } from 'primereact/dialog';
import { InputText } from 'primereact/inputtext';
import { Tag } from 'primereact/tag';
import axios from 'axios';
import { config } from '../../../config/config';
import { useToast } from '../../../context/ToastContext';
import { Fade } from 'react-awesome-reveal';
import { useUserContext } from '../../../context/UserContext';
import { useMenuContext } from '../../../context/MenuContext';
import NonPerm from '../../../common/components/nonperm/nonperm';
import LoadSpinner from '../../../common/components/loadspinner/LoadSpinner';
import CellFade from '../empleado/uikit/CellFade';
import UserPanel from './uikit/userPanel';
// [VITRINA] clonado de permisos fuera de alcance — componente no copiado
// import ClonarPermisosDialog from './uikit/ClonarPermisosDialog';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import useListParams from '../../../common/hooks/useListParams';
import './user.css';

export default function AdminUsers() {
  /* ───────── hooks ───────── */
  const [users, setUsers] = useState([]);
  const { searchTerm: globalFilter, setSearchTerm: setGlobalFilter, first, setFirst } = useListParams();
  const toast = useToast();
  const navigate = useNavigate();
  const { hasPermission } = useUserContext();
  const { getActions } = useMenuContext();
  const { puedeEditar, puedeBorrar } = getActions('/admin/usuarios');
  const [loading, setLoading] = useState(false);
  const [showDialog, setShowDialog] = useState(false);
  const [showUser, setShowUser] = useState(null);
  const [showClone, setShowClone] = useState(false);

  /* ───────── carga inicial ───────── */
  const loadUsers = async () => {
    try {
      setLoading(true)
      const { data } = await axios.get(`${config.backendUrl}/api/users`, {
        headers: config.headers,
      });

      const mapped = data.map((u) => ({
        ...u,
        plantasLabel: u.allPlantas
          ? 'Todas'
          : u.plantas?.length
            ? u.plantas.map((p) => p.nombre).join(', ')
            : '—',
        searchString: `${u.username} ${u.name || ''} ${u.lastname || ''} ${u.empleado?.nombre || ''} ${u.empleado?.apellido || ''}`.toLowerCase()
      }));

      setUsers(mapped);
    } catch {
      toast('error', 'No se pudieron cargar los usuarios');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadUsers();
  }, []);

  /* ───────── filtrado ───────── */
  const filteredUsers = useMemo(() => {
    if (!globalFilter) return users;
    const searchTerm = globalFilter.toLowerCase();
    return users.filter(user => user.searchString.includes(searchTerm));
  }, [users, globalFilter]);

  /* ───────── borrar ───────── */
  const borrarUsuario = async (id) => {
    try {
      await axios.delete(`${config.backendUrl}/api/users/${id}`, {
        headers: config.headers,
      });
      toast('success', 'Usuario eliminado');
      loadUsers();
    } catch {
      toast('error', 'Error al borrar el usuario');
    }
  };

  const confirmarBorrado = (id) =>
    confirmDialog({
      header: 'Eliminar usuario',
      message: (
        <div className="p-4 flex flex-column align-items-center overflow-hidden">
          <i
            className="fa-solid fa-triangle-exclamation mb-3"
            style={{ fontSize: '2.6rem', color: 'var(--lightred)' }}
          />
          <span>¿Estás seguro que quieres borrar este usuario?</span>
        </div>
      ),
      acceptClassName: 'p-button-danger',
      acceptLabel: (
        <span>
          <i className="fa-solid fa-trash mr-2" />
          Borrar
        </span>
      ),
      accept: () => borrarUsuario(id),
      rejectLabel: 'Cancelar',
    });

  /* ───────── acciones ───────── */
  const mostrarUsuario = (u) => {
    setShowUser(u);
    setShowDialog(true);
  };

  /* ───────── templates ───────── */
  const usernameBodyTemplate = (row) => (
    <CellFade uniqueKey={`user-${row.id}`}>
      <div className="flex align-items-center gap-2">
        <div className="user-avatar">
          <i className="fa-solid fa-user"></i>
        </div>
        <span className="font-semibold user-clickable" onClick={() => mostrarUsuario(row)}>
          {row.username}
        </span>
      </div>
    </CellFade>
  );

  const adminBodyTemplate = (row) => (
    row.isAdmin ? (
      <Tag value="Admin" severity="info" icon="fa-solid fa-crown" className="user-tag" />
    ) : (
      <Tag value="Usuario" severity="secondary" className="user-tag" />
    )
  );

  const plantasBodyTemplate = (row) => (
    <span className="plantas-label">{row.plantasLabel}</span>
  );

  if (!hasPermission('ADMIN')) return <NonPerm />;

  if (loading) {
    return (
      <div className="cover-container w-full h-full flex align-self-center justify-content-center">
        <LoadSpinner />
      </div>
    );
  }

  /* ───────── render ───────── */
  return (
    <Fade direction="up" duration={500} triggerOnce>
      <Dialog
        visible={showDialog}
        onHide={() => setShowDialog(false)}
        className="w-11 xl:w-5 user-detail-dialog"
        header={
          <div className="flex align-items-center gap-2">
            <div className="user-avatar-large">
              <i className="fa-solid fa-user"></i>
            </div>
            <div>
              <h4 className="m-0">{showUser?.username}</h4>
              <small className="text-color-secondary">{showUser?.empleado?.nombre} {showUser?.empleado?.apellido}</small>
            </div>
          </div>
        }
        footer={
          <div className="flex justify-content-center gap-2">
            {puedeEditar && (
              <Button 
                label="Editar" 
                icon="fa-solid fa-pencil" 
                rounded 
                size="small" 
                onClick={() => { 
                  setShowDialog(false); 
                  navigate(`/admin/usuarios/editar/${showUser.id}`); 
                }} 
              />
            )}
            {puedeBorrar && (
              <Button 
                label="Borrar" 
                icon="fa-solid fa-trash" 
                severity="danger" 
                rounded 
                size="small" 
                onClick={() => { 
                  setShowDialog(false); 
                  confirmarBorrado(showUser.id); 
                }} 
              />
            )}
          </div>
        }
      >
        <UserPanel user={showUser} />
      </Dialog>

      {/* [VITRINA] clonado de permisos fuera de alcance
      <ClonarPermisosDialog
        visible={showClone}
        onHide={() => setShowClone(false)}
        users={users}
        onDone={loadUsers}
      /> */}

      <div className="users-container md:pt-0">
        <PageHeader
          icon="fa-solid fa-users"
          title="Usuarios del sistema"
          subtitle="Gestión de cuentas de acceso"
        />

        <div className="flex justify-content-end w-full mb-3 gap-2 flex-wrap">
          {/* [VITRINA] clonado de permisos / plantillas fuera de alcance
          <Button
            label="Plantillas de permisos"
            icon="fa-solid fa-layer-group"
            onClick={() => navigate('/admin/plantillas-permiso')}
            size="small"
            rounded
            outlined
            tooltip="Crear y editar moldes de permisos reutilizables"
            tooltipOptions={{ position: 'bottom' }}
          />
          <Button
            label="Clonar permisos"
            icon="fa-solid fa-clone"
            onClick={() => setShowClone(true)}
            size="small"
            rounded
            outlined
            tooltip="Copiar la configuración de permisos de un usuario o plantilla a otros usuarios"
            tooltipOptions={{ position: 'bottom' }}
          /> */}
          <Button
            label="Nuevo usuario"
            icon="fa-solid fa-plus"
            onClick={() => navigate('/admin/usuarios/nuevo')}
            size="small"
            rounded
            className="users-new-btn"
          />
        </div>

        <div className="users-filters">
          <span className="p-input-icon-left search-input-wrapper">
            <i className="fa-solid fa-magnifying-glass ml-3" />
            <span className="search-bar-wrapper">
              <InputText
                value={globalFilter}
                onChange={(e) => setGlobalFilter(e.target.value)}
                placeholder="Buscar usuario..."
                title="Buscar por usuario o empleado"
                className="w-full search-input search-bar"
              />
            </span>
          </span>
          {globalFilter && (
            <Button
              icon="fa-solid fa-xmark"
              rounded
              text
              size="small"
              onClick={() => setGlobalFilter('')}
              className="clear-search-btn"
              tooltip="Limpiar búsqueda"
            />
          )}
        </div>

        <div className="users-table-wrapper">
          <DataTable
            value={filteredUsers}
            paginator
            rows={25}
            rowsPerPageOptions={[10, 25, 50, 100]}
            responsiveLayout="scroll"
            emptyMessage={
              <div className="empty-state">
                <i className="fa-solid fa-user-slash mb-3"></i>
                <p>No se encontraron usuarios</p>
                {globalFilter && <small>Intenta con otros términos de búsqueda</small>}
              </div>
            }
            className="users-datatable"
          >
            <Column
              field="username"
              header="Usuario"
              body={usernameBodyTemplate}
              sortable
            />
            <Column 
              field="name" 
              header="Nombre" 
              sortable 
            />
            <Column 
              field="lastname" 
              header="Apellido" 
              sortable 
            />
            <Column
              field="plantasLabel"
              header="Plantas"
              body={plantasBodyTemplate}
            />
            <Column
              field="isAdmin"
              header="Rol"
              body={adminBodyTemplate}
              style={{ width: '120px' }}
              sortable
            />
          </DataTable>
        </div>
      </div>
    </Fade>
  );
}