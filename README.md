# OposiTest

Aplicación web personal para preparar oposiciones a partir de tus propios PDF: biblioteca de normas,
generador local de preguntas tipo test, exámenes (estudio y simulacro), esquemas, resúmenes extractivos,
mapas conceptuales, repaso espaciado de errores y estadísticas.

- Funciona **en local y sin conexión** (PWA instalable). No usa servidores ni APIs externas.
- Los datos (PDF, preguntas, progreso) se guardan **solo en el navegador de cada dispositivo** (IndexedDB).
  Para pasarlos a otro equipo: *Configuración → Crear copia de seguridad* y *Restaurar → Fusionar*.

## Uso

Abre la versión publicada en GitHub Pages e instálala desde el navegador
(Chrome/Edge: icono de instalar en la barra de direcciones; iPhone/iPad: Compartir → «Añadir a pantalla de inicio»).

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:5173
npm test
npm run build    # genera dist/
npm run deploy   # pruebas + build + publica dist/ en la rama gh-pages (GitHub Pages)
```

React + TypeScript + Vite, Dexie (IndexedDB), PDF.js, Mermaid, fflate, vite-plugin-pwa.
Estado detallado del proyecto y decisiones: [PROJECT_STATUS.md](PROJECT_STATUS.md).
