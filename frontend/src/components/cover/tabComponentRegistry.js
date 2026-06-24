// Registro de componentes que se pueden abrir como pestañas sin ruta.
// Para agregar un componente: importarlo y añadirlo aquí con una clave estable.
// Uso: openComponentTab('miClave', { prop: valor }, 'Titulo', 'fa-solid fa-icon')
// Las pestañas de componente son solo de sesión (no persisten al recargar).

const tabComponentRegistry = {
    // Ejemplo:
    // 'clienteDetalle': ClienteDetalleComponent,
};

export default tabComponentRegistry;
