# Fuentes embebidas para PDFs (P2.1)

Para que los PDFs muestren correctamente caracteres Unicode (`SO₃`, `≤`, `≥`,
`³`, `µ`, `°`, etc.) en lugar de fallback a Helvetica con sanitización
agresiva, copiá los TTF de **DejaVu Sans** acá:

```
public/fonts/
├── DejaVuSans.ttf          (~700 KB — REQUERIDO para activar)
└── DejaVuSans-Bold.ttf     (~700 KB — opcional, mejora títulos en negrita)
```

## Descarga

1. Ir a https://dejavu-fonts.github.io/Download.html
2. Bajar el `.tar.bz2` o `.zip`
3. Extraer y copiar **`DejaVuSans.ttf`** y **`DejaVuSans-Bold.ttf`** a esta carpeta

## Verificación

Al recargar el navegador, abrir la consola y buscar el log de `preloadDejavu`
(no debería loguear errores). Generar un certificado: el campo "Sulfatos
(SO₃)" debería renderizar el `₃` real; "Módulo de finura" con tilde; "≤ 5%"
con el operador real.

## Política

- **Bundle size:** los TTF NO se empaquetan en el bundle JS — viven como
  assets estáticos en `public/`. CRA los sirve directo.
- **Carga:** la app llama `preloadDejavu()` al arrancar (`src/index.js`).
  Idempotente y no-bloqueante. Si los archivos no están, fallback silencioso
  a Helvetica + `sanitizePdfText`.
- **Cache:** los TTF se sirven con `cache: 'force-cache'` — el navegador los
  cachea agresivamente. Forzar refresh si hace falta cambiar la fuente.

## Por qué no embebimos el base64 en el bundle

El TTF de DejaVu Sans completo agrega ~700 KB al bundle JS, lo que duplica
el tamaño actual (~600 KB → 1.3 MB). Mejor estrategia: dejar el TTF como
asset estático que se cachea independientemente del bundle.

Si querés un bundle 100% self-contained (sin assets externos), podés
convertir el TTF a base64 y hardcodearlo en `lib/format/dejavuFont.js`:

```js
const DEJAVU_BASE64 = '...700KB de base64...';
```

y modificar `preloadDejavu` para usar esa constante en lugar de `fetch`.
Documentado por completitud — no recomendado por default.
