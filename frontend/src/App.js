import React, { useEffect } from 'react'; // Asegúrate de importar useEffect
import './App.css';
import './common/anim.css';
import { PrimeReactProvider } from 'primereact/api';
import Cover from './components/cover/cover';
import 'primereact/resources/primereact.min.css';
import 'primeflex/primeflex.css';
import { UserProvider } from './context/UserContext';
import { ToastProvider } from './context/ToastContext';
import { addLocale, locale } from 'primereact/api';
import { ConfirmDialog } from 'primereact/confirmdialog';
import { ThemeProvider } from '@emotion/react';
import SwitchThemeProvider from './context/ThemeContext';
import { MenuProvider } from './context/MenuContext';
import { ConfigProvider } from './context/ConfigContext';
import InstallPrompt from './common/components/InstallPrompt';
// [VITRINA] desactivado: depende de módulo fuera de alcance (TFG módulo Calidad)
// import AIAssistant from './components/ai-assistant/AIAssistant';
import { registerServiceWorker, trySyncQueue } from './utils/offlineStorage';
import { installDecimalKeyboardFix } from './lib/format/decimalKeyboard';

addLocale('es', {
  // Calendar
  firstDayOfWeek: 1,
  dayNames: ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"],
  dayNamesShort: ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"],
  dayNamesMin: ["D", "L", "M", "X", "J", "V", "S"],
  monthNames: ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"],
  monthNamesShort: ["Ene", "Feb", "Mar", "Abr", "May", "Jun", "Jul", "Ago", "Sep", "Oct", "Nov", "Dic"],
  today: "Hoy",
  clear: "Limpiar",
  weekHeader: "Sm",
  dateFormat: "dd/mm/yy",
  chooseDate: "Elegir fecha",
  chooseMonth: "Elegir mes",
  chooseYear: "Elegir año",
  prevDecade: "Década anterior",
  nextDecade: "Década siguiente",
  prevYear: "Año anterior",
  nextYear: "Año siguiente",
  prevMonth: "Mes anterior",
  nextMonth: "Mes siguiente",
  prevHour: "Hora anterior",
  nextHour: "Hora siguiente",
  prevMinute: "Minuto anterior",
  nextMinute: "Minuto siguiente",
  prevSecond: "Segundo anterior",
  nextSecond: "Segundo siguiente",
  am: "a. m.",
  pm: "p. m.",
  now: "Ahora",

  // Acciones generales
  accept: "Aceptar",
  reject: "Cancelar",
  choose: "Elegir",
  upload: "Subir",
  uploading: "Subiendo",
  cancel: "Cancelar",
  completed: "Completado",
  pending: "Pendiente",
  apply: "Aplicar",

  // DataTable / Dropdown
  emptyFilterMessage: "Sin resultados",
  emptyMessage: "Sin opciones disponibles",
  filter: "Filtrar",
  equals: "Igual a",
  notEquals: "Distinto a",
  noFilter: "Sin filtro",
  lt: "Menor que",
  lte: "Menor o igual que",
  gt: "Mayor que",
  gte: "Mayor o igual que",
  dateIs: "La fecha es",
  dateIsNot: "La fecha no es",
  dateBefore: "Fecha anterior a",
  dateAfter: "Fecha posterior a",
  contains: "Contiene",
  notContains: "No contiene",
  startsWith: "Empieza con",
  endsWith: "Termina con",
  matchAll: "Todas las condiciones",
  matchAny: "Cualquier condición",
  addRule: "Agregar regla",
  removeRule: "Quitar regla",

  // Password strength
  passwordPrompt: "Ingresá una contraseña",
  weak: "Débil",
  medium: "Media",
  strong: "Fuerte",

  // Aria
  aria: {
    trueLabel: "Verdadero",
    falseLabel: "Falso",
    nullLabel: "Sin seleccionar",
    star: "1 estrella",
    stars: "{star} estrellas",
    selectAll: "Seleccionar todo",
    unselectAll: "Deseleccionar todo",
    close: "Cerrar",
    previous: "Anterior",
    next: "Siguiente",
    navigation: "Navegación",
    scrollTop: "Ir arriba",
    moveTop: "Mover al tope",
    moveUp: "Subir",
    moveDown: "Bajar",
    moveBottom: "Mover al final",
    moveToTarget: "Mover al destino",
    moveToSource: "Mover al origen",
    moveAllToTarget: "Mover todos al destino",
    moveAllToSource: "Mover todos al origen",
    pageLabel: "Página {page}",
    firstPageLabel: "Primera página",
    lastPageLabel: "Última página",
    nextPageLabel: "Siguiente página",
    prevPageLabel: "Página anterior",
    rowsPerPageLabel: "Filas por página",
    jumpToPageDropdownLabel: "Ir a la página",
    jumpToPageInputLabel: "Ir a la página",
    selectRow: "Seleccionar fila",
    unselectRow: "Deseleccionar fila",
    expandRow: "Expandir fila",
    collapseRow: "Contraer fila",
    showFilterMenu: "Mostrar menú de filtros",
    hideFilterMenu: "Ocultar menú de filtros",
    filterOperator: "Operador de filtro",
    filterConstraint: "Restricción de filtro",
    editRow: "Editar fila",
    saveEdit: "Guardar edición",
    cancelEdit: "Cancelar edición",
    listView: "Vista de lista",
    gridView: "Vista de grilla",
    slide: "Diapositiva",
    slideNumber: "{slideNumber}",
    zoomImage: "Ampliar imagen",
    zoomIn: "Acercar",
    zoomOut: "Alejar",
    rotateRight: "Rotar a la derecha",
    rotateLeft: "Rotar a la izquierda",
  },
});
locale('es');

function App() {
  // Usamos useEffect para agregar los event listeners al montar el componente
  useEffect(() => {
    // Función para deshabilitar el zoom con la rueda del mouse
    const disableZoom = (event) => {
      if (event.ctrlKey || event.metaKey) {
        event.preventDefault();
      }
    };

    // Función para deshabilitar el zoom con gestos táctiles
    const disablePinchZoom = (event) => {
      if (event.touches.length > 1) {
        event.preventDefault();
      }
    };

    // Agregar event listeners
    window.addEventListener('wheel', disableZoom, { passive: false });
    window.addEventListener('touchmove', disablePinchZoom, { passive: false });

    // Limpiar event listeners al desmontar el componente
    return () => {
      window.removeEventListener('wheel', disableZoom);
      window.removeEventListener('touchmove', disablePinchZoom);
    };
  }, []); // El array vacío asegura que esto solo se ejecute una vez

  // Soporte de punto decimal (numpad) como coma en todos los <InputNumber>.
  // Locale es-AR usa coma como separador decimal pero el numpad emite "."
  // y PrimeReact lo descarta. El listener delegado convierte "." → "," antes
  // de que PrimeReact procese la tecla — afecta a todos los InputNumber del
  // proyecto sin tener que tocar cada form individualmente.
  useEffect(() => {
    const uninstall = installDecimalKeyboardFix();
    return uninstall;
  }, []);

  // Register SW and flush offline sync queue on load + when back online
  useEffect(() => {
    // [VITRINA] Service worker DESACTIVADO: en demo local sirve el bundle
    // cache-first (nombre fijo /static/js/bundle.js) y deja al navegador pegado
    // a un bundle viejo. Además desregistramos cualquier SW previo y limpiamos
    // caches para que el navegador deje de servir el bundle stale.
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.getRegistrations()
        .then((regs) => regs.forEach((r) => r.unregister()))
        .catch(() => {});
      if (window.caches?.keys) {
        caches.keys().then((keys) => keys.forEach((k) => caches.delete(k))).catch(() => {});
      }
    }
    // registerServiceWorker();  // [VITRINA] desactivado
    trySyncQueue();
    const handleOnline = () => trySyncQueue();
    window.addEventListener('online', handleOnline);
    return () => window.removeEventListener('online', handleOnline);
  }, []);

  // Auto-focus en el input de filtro cuando se abre un Dropdown con filter
  useEffect(() => {
    // Cuando se abre un panel, forzar focus en el filter y mantenerlo
    const observer = new MutationObserver((mutations) => {
      for (const mutation of mutations) {
        for (const node of mutation.addedNodes) {
          if (node.nodeType === 1 && node.classList?.contains('p-dropdown-panel')) {
            const filterInput = node.querySelector('.p-dropdown-filter');
            if (filterInput) {
              filterInput.focus();
              setTimeout(() => filterInput.focus(), 10);
              setTimeout(() => filterInput.focus(), 50);
              setTimeout(() => filterInput.focus(), 150);
            }
          }
        }
      }
    });
    observer.observe(document.body, { childList: true });

    // Evitar que el hover en items robe el focus del filter input
    const handleFocusOut = (e) => {
      const panel = e.target.closest('.p-dropdown-panel');
      if (!panel) return;
      const filterInput = panel.querySelector('.p-dropdown-filter');
      if (filterInput && e.target === filterInput) {
        // El focus se está yendo del filter input — si se va a un item del dropdown, recuperarlo
        setTimeout(() => {
          if (panel.isConnected && !filterInput.contains(document.activeElement)) {
            filterInput.focus();
          }
        }, 0);
      }
    };
    document.addEventListener('focusout', handleFocusOut, true);

    return () => {
      observer.disconnect();
      document.removeEventListener('focusout', handleFocusOut, true);
    };
  }, []);

  // Manejo del scroll cuando se abre/cierra un dialog o dropdown
  useEffect(() => {
    const handleWheel = (e) => {
      // Buscar si hay algún dropdown visible (dropdown o multiselect)
      const dropdown = document.querySelector('.p-dropdown-panel');
      const multiselect = document.querySelector('.p-multiselect-panel');
      const isDropdownVisible = dropdown && dropdown.offsetParent !== null;
      const isMultiselectVisible = multiselect && multiselect.offsetParent !== null;

      // Si hay un dropdown o multiselect visible, SOLO permitir scroll en él
      if (isDropdownVisible || isMultiselectVisible) {
        const panel = isDropdownVisible ? dropdown : multiselect;

        // SIEMPRE scrollear la lista de items, sin importar dónde esté el mouse
        const itemsWrapper = panel.querySelector('.p-dropdown-items-wrapper, .p-multiselect-items-wrapper');
        if (itemsWrapper) {
          // Prevenir el scroll por defecto y scrollear manualmente el items wrapper
          e.preventDefault();
          itemsWrapper.scrollTop += e.deltaY;
          e.stopPropagation();
        }
        return;
      }

      // Buscar el dialog más cercano
      const dialogContent = e.target.closest('.p-dialog-content');
      const dialogMask = document.querySelector('.p-dialog-mask');

      if (dialogMask && dialogContent) {
        // Si estamos dentro del dialog, solo permitir scroll en el dialog
        e.stopPropagation();
        return;
      }

      if (dialogMask && !dialogContent) {
        // Si hay un dialog abierto pero el scroll no está sobre él, bloquear
        e.preventDefault();
        e.stopPropagation();
      }
    };

    // No usar observer ni position fixed, el scroll se maneja solo con el handleWheel

    // Agregar listener de wheel
    document.addEventListener('wheel', handleWheel, { passive: false, capture: true });

    return () => {
      document.removeEventListener('wheel', handleWheel, { capture: true });
    };
  }, []);

  // <AIAssistant />
  return (
    <SwitchThemeProvider>
      <ConfigProvider>
        <ToastProvider>
          <UserProvider>
            <MenuProvider>
              <PrimeReactProvider value={{
                appendTo: typeof document !== 'undefined' ? document.body : 'self',
                locale: 'es',
                zIndex: {
                  modal: 1100,    // Dialog, Sidebar
                  overlay: 1300,  // Dropdown, Calendar, MultiSelect — arriba del modal
                  menu: 1000,
                  tooltip: 1500,  // tooltips siempre arriba de todo
                  toast: 1400,
                },
              }}>
                <ConfirmDialog id="confirmDialog" />
                <Cover />
              </PrimeReactProvider>
            </MenuProvider>
          </UserProvider>
        </ToastProvider>
      </ConfigProvider>
    </SwitchThemeProvider>
  );
}

export default App;