import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from 'primereact/button';
import PageHeader from '../../common/components/PageHeader/PageHeader';

const items = [
  {
    titulo: 'Materiales',
    descripcion: 'Fichas técnicas, revisiones y documentación de materiales.',
    icono: 'fa-solid fa-cubes',
    ruta: '/calidad/catalogos/materiales',
    color: '#3B82F6',
  },
  {
    titulo: 'Curvas granulométricas',
    descripcion: 'Biblioteca de curvas teóricas, bandas y tabuladas para comparación.',
    icono: 'fa-solid fa-bezier-curve',
    ruta: '/calidad/catalogos/curvas',
    color: '#8B5CF6',
  },
  {
    titulo: 'Normas',
    descripcion: 'Catálogo de normas IRAM, CIRSOC y otras. Suba el PDF de cada norma.',
    icono: 'fa-solid fa-book-open',
    ruta: '/calidad/catalogos/normas',
    color: '#10B981',
  },
  {
    titulo: 'Ensayos',
    descripcion: 'Tipos de ensayo, perfiles CORE/AVANZADO, schema keys y visibilidad en cards.',
    icono: 'fa-solid fa-flask-vial',
    ruta: '/calidad/catalogos/ensayos',
    color: '#F59E0B',
  },
  {
    titulo: 'Mezclas',
    descripcion: 'Mezclas de agregados guardadas: proporciones optimizadas, curvas y resultados.',
    icono: 'fa-solid fa-blender',
    ruta: '/calidad/catalogos/mezclas',
    color: '#EC4899',
  },
  {
    titulo: 'Dosificaciones',
    descripcion: 'Diseños de dosificación guardados: método, cemento, mezcla y resultado de cálculo.',
    icono: 'fa-solid fa-calculator',
    ruta: '/calidad/catalogos/dosificaciones',
    color: '#06B6D4',
  },
  {
    titulo: 'Factor de ajuste de curva',
    descripcion: 'Corrección de las curvas a/c-resistencia de referencia general por familia de cemento (CP30/CP40/CP50).',
    icono: 'fa-solid fa-sliders',
    ruta: '/calidad/catalogos/factor-ajuste-curva',
    color: '#F97316',
  },
  {
    titulo: 'Evidencias técnicas',
    descripcion: 'Repositorio CIRSOC §3.2.3.2 f): estudios de laboratorio y antecedentes de obra que respaldan mezclas CUMPLE_AC.',
    icono: 'fa-solid fa-file-shield',
    ruta: '/calidad/catalogos/evidencias-tecnicas',
    color: '#D97706',
  },
];

const CatalogosHub = () => {
  const navigate = useNavigate();

  return (
    <div className="p-4">
      <PageHeader
        icon="fa-solid fa-book"
        title="Catálogos"
        subtitle="Gestión de catálogos de calidad."
      />

      <div className="grid mt-4">
        {items.map((item) => (
          <div key={item.ruta} className="col-12 md:col-6 lg:col-4">
            <div
              className="surface-card border-round shadow-1 p-4 cursor-pointer hover:shadow-3 transition-duration-200"
              style={{ borderLeft: `4px solid ${item.color}` }}
              onClick={() => navigate(item.ruta)}
            >
              <div className="flex align-items-center gap-3 mb-2">
                <div
                  className="flex align-items-center justify-content-center border-round"
                  style={{
                    width: '3rem',
                    height: '3rem',
                    backgroundColor: `${item.color}20`,
                    color: item.color,
                  }}
                >
                  <i className={item.icono} style={{ fontSize: '1.3rem' }} />
                </div>
                <span className="text-xl font-semibold">{item.titulo}</span>
              </div>
              <p className="text-sm text-600 m-0 line-height-3">
                {item.descripcion}
              </p>
              <div className="flex justify-content-end mt-3">
                <Button
                  label="Abrir"
                  icon="fa-solid fa-arrow-right"
                  iconPos="right"
                  text
                  size="small"
                  onClick={(e) => {
                    e.stopPropagation();
                    navigate(item.ruta);
                  }}
                />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default CatalogosHub;
