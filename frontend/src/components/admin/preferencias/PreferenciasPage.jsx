import React, { useContext, useState, useEffect } from 'react';
import { Card } from 'primereact/card';
import { InputSwitch } from 'primereact/inputswitch';
import { SelectButton } from 'primereact/selectbutton';
import { Tag } from 'primereact/tag';
import { Fade } from 'react-awesome-reveal';
import { ThemeContext } from '../../../context/ThemeContext';
import { useMenuContext } from '../../../context/MenuContext';
import PageHeader from '../../../common/components/PageHeader/PageHeader';
import { useToast } from '../../../context/ToastContext';

/**
 * Preferencias del usuario (Configuración → Preferencias).
 *
 * Por ahora las preferencias se persisten en localStorage del navegador. Si en
 * algún momento queremos que viajen entre dispositivos, migramos a una columna
 * `User.preferenciasUI` y dejamos esta pantalla intacta — solo cambia la
 * persistencia.
 */

const KEY_MENU_EXPANDIDO = 'menuMantenerExpandido';
const KEY_MENU_HOVER = 'menuAutoOpenHover';
const KEY_TABLE_DENSITY = 'tableDensity'; // 'compact' | 'normal' | 'comfortable'

const DENSIDAD_OPCIONES = [
  { label: 'Compacta', value: 'compact' },
  { label: 'Normal',   value: 'normal' },
  { label: 'Cómoda',   value: 'comfortable' },
];

const applyDensityClass = (density) => {
  const root = document.documentElement;
  root.classList.remove('density-compact', 'density-normal', 'density-comfortable');
  if (density && density !== 'normal') {
    root.classList.add(`density-${density}`);
  }
};

const PreferenciasPage = () => {
  const { isDark, toggleTheme } = useContext(ThemeContext);
  const { closeMenu } = useMenuContext();
  const showToast = useToast();
  const [mantenerExpandido, setMantenerExpandido] = useState(
    () => localStorage.getItem(KEY_MENU_EXPANDIDO) === '1'
  );
  const [autoOpenHover, setAutoOpenHover] = useState(
    () => localStorage.getItem(KEY_MENU_HOVER) === '1'
  );
  const [tableDensity, setTableDensity] = useState(
    () => localStorage.getItem(KEY_TABLE_DENSITY) || 'normal'
  );

  // Aplicar la densidad al cargar la página por si el bootstrap del App.jsx
  // todavía no lo hizo (ej. primer click después de cambiarla en otra pestaña).
  useEffect(() => {
    applyDensityClass(tableDensity);
  }, [tableDensity]);

  // Re-sync si otra pestaña cambia las preferencias.
  useEffect(() => {
    const onStorage = (e) => {
      if (e.key === KEY_MENU_EXPANDIDO) setMantenerExpandido(e.newValue === '1');
      if (e.key === KEY_MENU_HOVER)     setAutoOpenHover(e.newValue === '1');
      if (e.key === KEY_TABLE_DENSITY) {
        const v = e.newValue || 'normal';
        setTableDensity(v);
        applyDensityClass(v);
      }
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  const handleMenuToggle = (value) => {
    setMantenerExpandido(value);
    localStorage.setItem(KEY_MENU_EXPANDIDO, value ? '1' : '0');
    showToast(
      'success',
      value
        ? 'El menú lateral se mantendrá expandido al navegar.'
        : 'El menú lateral se replegará al navegar.'
    );
  };

  const handleHoverToggle = (value) => {
    setAutoOpenHover(value);
    localStorage.setItem(KEY_MENU_HOVER, value ? '1' : '0');
    // Al activar el hover, despineamos el menú para que el efecto sea visible
    // de entrada. Si el user lo quiere re-pinear, click en el botón de
    // expandir/plegar como siempre.
    if (value) {
      closeMenu(true);
    }
    showToast(
      'success',
      value
        ? 'El menú lateral se abrirá automáticamente al pasar el mouse.'
        : 'El menú lateral solo se abrirá al clickear el botón de expandir.'
    );
  };

  const handleDensityChange = (value) => {
    if (!value) return; // SelectButton permite null si se vuelve a clickear la actual
    setTableDensity(value);
    localStorage.setItem(KEY_TABLE_DENSITY, value);
    applyDensityClass(value);
    showToast('success', `Densidad de tablas: ${DENSIDAD_OPCIONES.find(o => o.value === value)?.label || value}`);
  };

  const handleThemeToggle = () => {
    toggleTheme();
  };

  return (
    <Fade direction="up" duration={500} triggerOnce>
      <div className="p-3">
        <PageHeader
          icon="fa-solid fa-sliders"
          title="Preferencias"
          subtitle="Personalizá el comportamiento y la apariencia de HormiQual en este dispositivo."
        />

        {/* Apariencia */}
        <Card className="shadow-1 mb-3" title={<span><i className="fa-solid fa-palette mr-2 text-primary" />Apariencia</span>}>
          <div className="flex justify-content-between align-items-center flex-wrap gap-3">
            <div className="flex-1" style={{ minWidth: '260px' }}>
              <div className="font-semibold mb-1">Tema</div>
              <small className="text-color-secondary block">
                Modo oscuro o claro de toda la aplicación. Se aplica al instante.
              </small>
            </div>
            <div className="flex align-items-center gap-2">
              <i className="fa-solid fa-sun text-color-secondary" />
              <InputSwitch checked={isDark} onChange={handleThemeToggle} />
              <i className="fa-solid fa-moon text-color-secondary" />
              <Tag
                value={isDark ? 'Oscuro' : 'Claro'}
                severity={isDark ? 'info' : 'warning'}
                className="ml-2"
              />
            </div>
          </div>

          <div className="flex justify-content-between align-items-center flex-wrap gap-3 mt-4 pt-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
            <div className="flex-1" style={{ minWidth: '260px' }}>
              <div className="font-semibold mb-1">Densidad de las tablas</div>
              <small className="text-color-secondary block">
                Ajusta el padding y el tamaño de letra de todas las tablas. "Compacta"
                muestra más filas en pantallas chicas; "Cómoda" prioriza legibilidad.
              </small>
            </div>
            <SelectButton
              value={tableDensity}
              options={DENSIDAD_OPCIONES}
              onChange={(e) => handleDensityChange(e.value)}
              allowEmpty={false}
            />
          </div>
        </Card>

        {/* Comportamiento del menú */}
        <Card className="shadow-1 mb-3" title={<span><i className="fa-solid fa-bars mr-2 text-primary" />Comportamiento del menú</span>}>
          <div className="flex justify-content-between align-items-center flex-wrap gap-3">
            <div className="flex-1" style={{ minWidth: '260px' }}>
              <div className="font-semibold mb-1">Mantener menú expandido al navegar</div>
              <small className="text-color-secondary block">
                Si lo activás, al hacer click en un item de un grupo (por ejemplo
                "Calidad → Laboratorio → Equipos"), el grupo se mantiene abierto.
                Por defecto, el grupo se repliega.
              </small>
            </div>
            <InputSwitch
              checked={mantenerExpandido}
              onChange={(e) => handleMenuToggle(e.value)}
            />
          </div>

          <div className="flex justify-content-between align-items-center flex-wrap gap-3 mt-4 pt-3" style={{ borderTop: '1px solid var(--surface-border)' }}>
            <div className="flex-1" style={{ minWidth: '260px' }}>
              <div className="font-semibold mb-1">Auto-abrir el menú al pasar el mouse</div>
              <small className="text-color-secondary block">
                Si lo activás, el sidebar se expande automáticamente al pasar el
                cursor por encima y se recoge al sacarlo (a menos que esté fijado).
                Por defecto el menú solo se abre con el botón de expandir.
              </small>
            </div>
            <InputSwitch
              checked={autoOpenHover}
              onChange={(e) => handleHoverToggle(e.value)}
            />
          </div>
        </Card>

        {/* Espacio para crecer */}
        <Card className="shadow-1 mb-3 surface-50" title={<span><i className="fa-solid fa-flask mr-2 text-color-secondary" />Próximamente</span>}>
          <div className="text-color-secondary text-sm">
            Estamos preparando más preferencias para que ajustes HormiQual a tu gusto:
            densidad de tablas, atajos de teclado, idioma. Si tenés alguna idea,
            comentala con tu administrador.
          </div>
        </Card>

        <small className="text-color-secondary block mt-2">
          <i className="fa-solid fa-circle-info mr-1" />
          Estas preferencias se guardan en este navegador. Al cambiar de dispositivo
          o iniciar sesión desde otro browser, las preferencias arrancan en sus
          valores por defecto.
        </small>
      </div>
    </Fade>
  );
};

export default PreferenciasPage;
