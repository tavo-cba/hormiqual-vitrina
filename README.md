# HormiQual — Módulo de Control de Calidad

Plataforma web para el control integral de calidad en la producción de hormigón
elaborado. Este repositorio contiene el **módulo de Calidad** del sistema: la
administración del catálogo de materiales, la evaluación de ensayos según normas,
la optimización de mezclas granulométricas, el diseño asistido de dosificaciones
y la gestión del ciclo de vida de las fórmulas.

## Alcance de este repositorio

Esta es una versión **autocontenida y sanitizada** del módulo de Calidad, preparada
para su ejecución y evaluación de forma independiente. Incluye la infraestructura
mínima necesaria para funcionar (autenticación, modelo de datos multi-planta y
configuración base).

**No** forma parte de este repositorio la funcionalidad correspondiente a otros
módulos del sistema completo (gestión de despachos y producción, administración de
personal, módulos comerciales y financieros) ni las integraciones con servicios
externos, por encontrarse fuera del alcance de este módulo.

La base de datos incluida ya viene poblada con catálogos normativos de referencia
(serie de tamices, curvas granulométricas IRAM, parámetros de diseño, tablas
CIRSOC) y con un conjunto de datos de ejemplo que permite recorrer las
funcionalidades sin carga previa.

## Stack tecnológico

- **Frontend:** React 18 (Create React App), PrimeReact (componentes de UI),
  Chart.js (gráficos), jsPDF (generación de informes)
- **Backend:** Node.js + Express, ORM Sequelize
- **Base de datos:** MySQL 8
- **Autenticación:** JSON Web Tokens (JWT)

## Requisitos previos

- **Node.js** 18 o superior
- **MySQL 8** (o un entorno que lo incluya, por ejemplo XAMPP)
- **npm** (incluido con Node.js)

## Instalación

### 1. Clonar el repositorio

```bash
git clone <URL-del-repositorio>
cd hormiqual-vitrina
```

### 2. Crear la base de datos

Con el servidor MySQL en ejecución:

```bash
mysql -h 127.0.0.1 -u root -e "CREATE DATABASE hormiqual_vitrina CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;"
```

### 3. Importar los datos

El repositorio incluye un volcado con el esquema completo y los datos de ejemplo:

```bash
mysql -h 127.0.0.1 -u root hormiqual_vitrina < backend/seed/seed-vitrina.sql
```

### 4. Configurar el backend

```bash
cd backend
cp .env.example .env
```

Editar `.env` y completar los datos de conexión a la base. Para una instalación
local estándar (MySQL en `127.0.0.1`, usuario `root` sin contraseña), los valores
del ejemplo ya son válidos. Solo es necesario definir un `SECRET_KEY` (cualquier
cadena para firmar los tokens en desarrollo).

```bash
npm install
npm run dev
```

El backend queda escuchando en **http://localhost:3002**.

### 5. Iniciar el frontend

En otra terminal:

```bash
cd frontend
cp .env.example .env
npm install
npm start
```

La aplicación abre en **http://localhost:3000**.

## Acceso

Una vez levantados ambos servicios, ingresar con alguna de las credenciales de
demostración:

- **Administrador:** `admin` / `vitrina2026` — acceso completo.
- **Operario (rol de carga):** `operario` / `vitrina2026` — perfil de planta.

El segundo usuario permite recorrer el circuito de aprobación: un **operario**
diseña y guarda una dosificación (que no puede auto-aprobar y queda en estado
*Por revisar*), y luego el **administrador** la revisa y aprueba.

> Estas credenciales son públicas e intencionales, para permitir el acceso
> inmediato al entorno de evaluación.

## Funcionalidades

El módulo cubre los siguientes procesos de negocio, accesibles desde el menú lateral:

1. **Caracterización de materiales constituyentes** — registro de agregados,
   cementos, aditivos y agua, con evaluación automática de aptitud según ensayos
   y normas aplicables.
2. **Registro de ensayos de hormigón fresco y confección de probetas** — carga de
   asentamiento, temperatura y aire incorporado, con generación de probetas y sus
   fechas de rotura.
3. **Ensayo de compresión** — cronograma de roturas y registro de resultados con
   cálculo de resistencia individual y estadística.
4. **Optimización de mezclas granulométricas** — combinación de agregados contra
   bandas normativas con cálculo de módulo de finura y desviación.
5. **Diseño de dosificaciones (método ICPA)** — cálculo asistido con verificación
   CIRSOC 200, análisis de trabajabilidad mediante diagrama de Shilstone y factor
   de aptitud de Ken Day.
6. **Aprobación de dosificaciones** — flujo de estados con validación por pastón
   experimental y control por niveles de responsabilidad.
7. **Gestión de excepciones normativas** — cuando una dosificación utiliza una
   mezcla que se aparta de la banda granulométrica normativa, el sistema permite
   registrar una liberación técnica con justificación, evidencia de respaldo y
   firma del responsable (CIRSOC 200 §3.2.3.2 f), complementada por un repositorio
   de evidencias técnicas.
8. **Generación de informes técnicos configurables** — selección de secciones,
   previsualización y exportación a PDF.

## Notas

- El proyecto está preparado para ejecución local con fines de demostración.
- La base de datos incluida no contiene credenciales de servicios externos ni
  datos personales reales.
- La documentación de los scripts de inicialización utilizados para construir la
  base (`backend/scripts/`) se conserva en el repositorio a modo de referencia.

## Licencia

Software de carácter privado. Todos los derechos reservados.
