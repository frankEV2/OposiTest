# OposiTest — Estado del proyecto

_Última actualización: 2026-11-09 · Estado: **las 8 fases terminadas** · Siguiente: pruebas en dispositivos reales (ver abajo)_

## Entorno
- Node LTS instalado localmente en `~/.local/node` (no hay Node del sistema). Usar:
  `export PATH=~/.local/node/bin:$PATH`
- Comandos: `npm run dev` · `npm run build` (tsc + vite + service worker) · `npm run preview` · `npm test`
- Vista previa en Claude: `.claude/launch.json` → `dev` (desarrollo, sin SW) y `preview` (build de producción, puerto 4173, con SW).

## Arquitectura
- React 19 + TypeScript + Vite 8, `HashRouter` (funciona como PWA/estático sin reescrituras de servidor).
- Persistencia: IndexedDB con Dexie 4 (`dexie-react-hooks` → `useLiveQuery` para UI reactiva).
- Sin backend ni llamadas de red. CSS propio (sin framework) con variables y modo oscuro.

```
src/
  db/         types.ts (modelo completo), db.ts (esquema Dexie v1), taxonomy.ts, settings.ts, *.test.ts
  components/ Layout.tsx (menú lateral, colapsable en móvil)
  pdf/        extractCore.ts (extracción, común a navegador y Node), extract.ts (PDF.js legacy + worker local, carga diferida), clean.ts (limpieza/calidad), structure.ts (parser jurídico)
  library/    service.ts (importar/sustituir/eliminar), search.ts
  exam/       logic.ts (filtro, selección, nota — puro), service.ts (crear/responder/finalizar)
  sync/       keys.ts (claves naturales + registro de borrados), snapshot.ts (construir/fusionar), sync.ts,
              remote.ts (interfaz + memoria), gdrive.ts (Google Drive appDataFolder), auto.ts
  backup/     backup.ts (exportar ZIP, parsear, restaurar fusionando/reemplazando)
  review/     srs.ts (Leitner, puro)
  stats/      stats.ts (agregados, puro)
  study/      materials.ts (árbol, resúmenes extractivos, mapas Mermaid, fichas — puro)
  engine/     text.ts (frases, hash, PRNG), generate.ts (reglas puras + validación), store.ts (BD, edición manual)
  components/ ClassificationPicker, SearchResults, ExamSetup, MermaidView, ScoreChart, BackupPanel, UpdatePrompt
  pages/      Home, Settings, Library, DocumentView, Generate, Bank, ExamRun, ExamResult, Materials, Mistakes, Stats (todas salvo Home con React.lazy) (secciones de fases futuras)
  hooks/      useTheme.ts
  routes.ts   menú (8 secciones)
  styles/     global.css
public/       icon.svg + PNG 192/512, maskable-512, apple-touch-icon, favicon-32
test-fixtures/ PDF de prueba generados (ley-prueba, norma-prueba, escaneado) — NO son normas reales
```

## Decisiones
- **Esquema completo desde v1** (taxonomía, documentos, ficheros, páginas, secciones, preguntas, exámenes,
  intentos, repasos, materiales, sesiones, ajustes) para minimizar migraciones.
- PDF original en tabla aparte (`documentFiles`) para no cargar blobs al listar.
- Duplicados: `documents.sha256` y `questions.hash` son índices únicos.
- Borrar oposición/materia/tema es en cascada sobre la taxonomía, pero **los documentos y preguntas se conservan** sin clasificar.
- Las preguntas guardan `sourceExcerpt` (texto literal de la norma) para que toda respuesta sea verificable.
- Booleanos no son claves válidas en IndexedDB → `attempts.correct` no está indexado.
- Penalización por defecto 1/3; configurable.
- PDF.js 6 con worker local (`?url` de Vite) y `import()` diferido: solo se descarga al importar.
- Extracción: salto de línea por `hasEOL` o cambio de coordenada Y. Se eliminan cabeceras/pies repetidos
  en ≥50 % de páginas (dígitos normalizados) y se unen palabras con guion.
- Escaneado: página con <40 letras = vacía; ≥80 % vacías → `scanned` (sin secciones). Algunas → `partial` + aviso.
- Parser por líneas con regex al inicio de línea (LIBRO/TÍTULO/CAPÍTULO/Sección/Artículo N [bis]/Disposición…/ANEXO/Preámbulo).
  Apartados "N. " dentro de artículo → sección `apartado` con etiqueta "Artículo N.M"; el texto del artículo incluye sus apartados.
  Disposiciones/anexos/preámbulo son siempre de nivel superior. Entradas del índice (BOE) se eliminan: vacías y con la etiqueta repetida.
- Sustituir PDF: conserva id/título/clasificación; preguntas del documento → `pending` y sin `sectionId`.
- Eliminar documento: borra páginas, secciones, fichero, preguntas, repasos y materiales; los `attempts` históricos se conservan.
- Motor de preguntas (fase 3), todo en funciones puras y deterministas (PRNG con semilla = mismo resultado):
  - Unidades: apartados si el artículo los tiene; si no, el artículo o disposición completa.
  - Reglas: definición (listas "a) Término: def" y "se entenderá por"), plazo (frases con "plazo/dentro de/a contar/desde" y UN solo plazo),
    competencia ("Corresponde al/Será competente el" + órgano en mayúsculas), enumeración (intro con ":" + ≥3 elementos; forma
    positiva y forma "NO figura"), cuantía/mayoría, excepción ("salvo que"…), obligación ("deberá(n)").
  - Respuesta correcta = texto literal. Distractores: del mismo documento; si faltan, de toda la biblioteca (2.ª pasada).
    Solo excepción/obligación usan conjuntos cerrados de conectores/modales (sin sinónimos del correcto).
  - Descartes: sin 3 alternativas reales, respuesta visible en el enunciado, distractor que también encaja literalmente
    en el texto, opciones repetidas o largas. Máx. 3 preguntas por unidad (salvo definiciones).
  - Generadas → estado `pending` ("Sin revisar"); manuales/editadas → `validated`. Las rechazadas se conservan para que su hash
    impida regenerarlas. El título del documento va en el enunciado (los documentos se pueden renombrar en la Biblioteca;
    las preguntas ya creadas no cambian).
  - Usar en los regex `(?<!\p{L})…(?!\p{L})` en vez de `\b` cuando haya tildes.
- Exámenes (fase 4):
  - `Exam.orders[i]` = orden de presentación de opciones; `answers` guarda el índice ORIGINAL (no la posición).
    Sin "orden aleatorio" se sigue el orden del documento y no se barajan opciones.
  - Nota = (aciertos − errores × penalización) / total × 10, mínimo 0, 2 decimales. Penalización y nº por defecto desde Ajustes.
  - Estudio: la respuesta se bloquea al elegir y se muestra corrección + explicación. Simulacro: se puede cambiar o dejar en blanco
    (pulsar de nuevo la opción elegida la desmarca), sin soluciones hasta finalizar.
  - Cronómetro por reloj de pared (`startedAt + límite`): sigue corriendo si se cierra la app; al agotarse finaliza solo y el
    tiempo registrado se limita al máximo.
  - `finishExam` es idempotente; crea un `Attempt` por pregunta y una `StudySession` 'examen'. Abandonar borra el examen.
  - Seleccionar artículos concretos incluye sus apartados (mapa `parentOf`). Rechazadas nunca entran; "sin revisar" es opcional (por defecto sí).
  - Examen sin terminar → aviso "Continuar" en Inicio.
- Material de estudio (fase 5): se calcula al vuelo desde `sections` (no se guarda en `materials`; es instantáneo y
  siempre coincide con el documento actual). Ámbito: documento completo o un título/capítulo/sección.
  - Resúmenes EXTRACTIVOS: breve = estructura + rúbricas; medio = rúbrica + 1.ª frase de cada apartado; completo = texto íntegro.
  - Mapas: Mermaid 12 `flowchart LR`, `securityLevel: 'strict'`, import dinámico (no está en el bundle principal).
    Ids de nodo `s<sectionId>` → clic abre el artículo (se busca `-s(\d+)-` en el id del `g.node`). Máx. 120 nodos.
    "Conceptos" reutiliza extractores del motor (definiciones, enumeraciones, plazos, competencias).
  - Fichas: definiciones, enumeraciones, plazos y competencias con respuesta literal.
  - Exportar .md y imprimir (CSS `@media print`).
  - `sentences()` protege la numeración "1. " al inicio de línea; el motor quita ese número de las frases de los enunciados.
- Repaso (fase 6): Leitner en `reviews`. Fallo/blanco → caja 1 con `due = ahora` (repasable el mismo día);
  acierto → sube de caja, vuelve a 1/2/4/8/16 días; acierto en caja 5 → se elimina (dominada). Acierto de pregunta no
  incluida → no se añade. Se aplica en `finishExam` (cualquier examen, no solo los de repaso).
  - «Mis errores»: Para hoy / En repaso / Más falladas (top 100) / Difíciles (≥2 intentos y ≥50 % de fallo).
    «Repasar» crea un examen con esos ids (`createExamFromIds`, máx. 100, aleatorio, penalización de Ajustes).
- Estadísticas: calculadas al vuelo desde `exams`/`attempts`/`sessions` (no hay tablas de agregados).
  Rendimiento por documento/materia/tema usa la clasificación ACTUAL de la pregunta (`temaId`). Gráfico SVG propio
  (una serie 0–10, tooltip con enlace al resultado); barras CSS. Tiempo de estudio = duración de exámenes (`sessions`).
- Copias (fase 7): fflate. ZIP = `manifest.json` (app, format=1, schemaVersion, counts) + `data/<tabla>.json` + `pdf/<id>.pdf`
  (PDF sin comprimir, JSON nivel 6). `lastBackupAt` en `settings`.
  - Fusionar (por defecto): nunca modifica ni borra lo existente. Dedup: taxonomía por nombre, documentos por sha256
    (sus secciones se emparejan por `order`), preguntas por hash, exámenes por startedAt+preguntas, sesiones por inicio+fin,
    repasos: gana el `lastReviewed` más reciente; ajustes locales prevalecen. Todos los ids se remapean. Una transacción
    → si falla, no se restaura nada.
  - Reemplazar: confirmación + descarga automática previa (`opositest-copia-previa-*.zip`) y luego restauración con ids originales.
- PWA (fase 7): vite-plugin-pwa 2 (workbox), `registerType: 'prompt'`, registro solo en producción (`UpdatePrompt`):
  avisos "funciona sin conexión" y "versión nueva → Actualizar". Precache de TODO el build (~7 MB, 109 ficheros;
  Mermaid es la mayor parte) para que mapas y PDF.js funcionen offline. `base: './'` → desplegable en cualquier ruta.
- Búsqueda: en memoria sobre `sections` (sin apartados), sin tildes, todas las palabras o "frase exacta", máx. 100.

- Sincronización (posterior a la fase 8) con Google Drive del usuario, sin servidor propio:
  - Carpeta privada `appDataFolder` (permiso `drive.appdata`), Google Identity Services (token ~1 h en localStorage).
    ID de cliente OAuth en `.env` (`VITE_GOOGLE_CLIENT_ID`, proyecto Google Cloud `opositest-514218`, origen autorizado
    `https://frankev2.github.io`, app en modo «Prueba» con franev21@gmail.com como usuario de prueba). Se puede
    sobrescribir en Configuración (`settings.googleClientId`).
  - Remoto: `opositest-state.json` (instantánea) + `pdf-<sha256>.pdf`. El texto/estructura NO se sube: cada dispositivo
    lo recalcula desde el PDF y las preguntas se enlazan por (documento, `order` de la sección).
  - Claves naturales: documento `uid` (sha original, estable al sustituir), pregunta `uid` (hash original, estable al
    editar), taxonomía por nombres, examen por `startedAt`, repaso por pregunta.
  - Fusión: añadir lo que falta; si existe en ambos gana `updatedAt` (o `lastReviewed`); exámenes/respuestas/sesiones
    solo se añaden. Borrados: tabla `deletions` (Dexie v2) con `doc:`, `q:`, `rev:`, `tax:`; un borrado se aplica si es
    posterior a la última modificación del elemento. Renombrar taxonomía = borrar ruta antigua + crear nueva (y se
    "tocan" documentos/preguntas para propagar la clasificación). Los borrados remotos de taxonomía se aplican SIN
    cambiar fechas (si no, taparían los cambios recibidos).
  - Mismo PDF importado por separado en dos dispositivos: se unifican adoptando la menor de las dos claves.
  - Auto-sync opcional al abrir y al terminar examen, solo si el token sigue vigente (nunca abre ventanas).
  - Límite conocido: dos dispositivos sincronizando a la vez → gana la última escritura del estado (la siguiente
    sincronización lo recompone, salvo cambios hechos en ese intervalo exacto). Los PDF borrados no se eliminan de Drive.

## Terminado
- [x] Fase 1: estructura, esquema Dexie, CRUD de taxonomía, ajustes (penalización, nº preguntas, cronómetro, tema),
  info de almacenamiento + solicitud de almacenamiento persistente, layout responsive, Inicio con contadores reales.
  4 tests pasan; build OK; verificado en navegador.

- [x] Fase 2: biblioteca (importación múltiple con progreso, SHA-256 anti-duplicados, clasificación por documento,
  filtro, aviso de escaneados/páginas sin texto, sustituir, eliminar), visor por estructura e índice navegable,
  texto por páginas, abrir PDF original, búsqueda global y por documento. 15 tests pasan; verificado en navegador con los PDF de `test-fixtures/` (pasando por PDF.js real).

- [x] Fase 3: motor local de preguntas (7 reglas), informe de generación con motivos de descarte, banco con filtros
  (documento/estado/tipo/dificultad/texto), paginación, validar/rechazar/editar/eliminar, validación masiva, alta manual,
  renombrar documentos. 24 tests pasan; verificado en navegador (18 preguntas desde `norma-prueba.pdf`).

- [x] Fase 4: configurador (modo, nº, penalización, cronómetro, documentos, temas, artículos, dificultad, nuevas/realizadas,
  aleatorio, incluir sin revisar, contador de disponibles), examen con navegación/rejilla/atajos de teclado, resultado con
  nota, %, tiempo y revisión filtrable (todas/falladas/en blanco) con enlace al artículo. 29 tests pasan; verificado en navegador
  (estudio completo y simulacro finalizado por tiempo).

- [x] Fase 5: página «Esquemas y resúmenes» con esquema navegable, resumen breve/medio/completo, mapas de estructura y
  de conceptos (zoom, clic a artículo), fichas con volteo y barajado, descarga .md e impresión. 33 tests pasan; verificado en navegador.

- [x] Fase 6: repetición espaciada, «Mis errores» con 4 listas y examen de repaso, «Estadísticas» (resumen, evolución,
  rendimiento agrupado, más falladas, historial). 40 tests pasan; verificado en navegador (2 exámenes + repaso).

- [x] Fase 7: copias ZIP completas (exportar, vista previa, fusionar, reemplazar con copia previa), PWA instalable y offline.
  44 tests pasan; verificado en navegador: build de producción con SW activo, recarga con el servidor parado, exportar,
  fusionar (sin duplicados) y reemplazar.

- [x] Fase 8: pruebas con 3 normas reales del BOE y corrección del parser/motor, rendimiento (caché de búsqueda,
  pools únicos), carga diferida de páginas (bundle inicial 445 → 367 KB), revisión móvil 375 px + modo oscuro en las
  14 pantallas (sin desbordamiento), contraste y accesibilidad, compatibilidad Safari (PDF.js legacy). 47 tests pasan;
  build de producción verificada (importación con el worker legacy, aviso de actualización del SW).

- [x] Sincronización entre dispositivos con Google Drive: motor probado con dos dispositivos simulados (alta, cambios,
  edición, renombrado, borrados, PDF duplicado, PDF ausente). 50 tests. Falta probar contra Google real (requiere el ID de cliente).

- Estructura en catalán (Portal Jurídic / DOGC): Article, Títol, Capítol, Secció, Disposició + ordinales catalanes; cifras
  árabes en títulos/capítulos por errores de OCR ("Títol 11"). Rúbrica en la línea siguiente al artículo solo si es corta,
  sin puntuación final ni conector final, empieza en mayúscula y la línea siguiente no sigue en minúscula.
- «Generar test» explica por qué un documento no da preguntas (`DocReport.hint`): escaneado, sin artículos, idioma
  catalán (las reglas del motor son en castellano) o sin expresiones reconocibles.

- Markdown (2026-11-11): `.md/.markdown/.txt` se importan por la misma tubería que los PDF (`library/markdown.ts`,
  `processFile` en `service.ts`); sync y copias funcionan igual (el blob se guarda como `text/markdown`).
  Estructura: primero el parser jurídico; si no hay artículos, los encabezados `#` (hojas = unidades 'articulo').
- Temario integrado: `public/temario/<Oposición>/<Materia>/<Tema>/*.md` → `scripts/temario-index.mjs` (predev/prebuild)
  genera `index.json` con SHA-256. Al abrir la app `library/bundled.ts` importa solo lo que falta o cambió (si cambia,
  sustituye el documento con el mismo `fileName`), clasifica por carpetas y respeta los borrados del usuario.

## Limitaciones conocidas
- Reglas de preguntas solo en castellano (los textos en catalán se estructuran pero no generan preguntas).
- Sin OCR: los PDF escaneados se detectan pero no se procesan (OCR local, p. ej. Tesseract.js, sería pesado ~10 MB+; valorar más adelante).
- Parser validado con 3 normas consolidadas del BOE; otros formatos (BOJA/DOGC, temarios de academias, PDF a dos columnas,
  tablas) pueden necesitar reglas nuevas.

- Los órganos se detectan solo si van en mayúsculas iniciales; "corresponde al órgano competente" no genera pregunta.
- Instalación PWA en iOS: Safari → Compartir → «Añadir a pantalla de inicio» (iOS no muestra aviso de instalación).
  Safari puede borrar los datos de sitios no instalados tras semanas sin uso: recomendar instalar y hacer copias.
- No probado aún en Safari/iOS, Firefox ni Windows reales (solo Chromium del panel); el código está preparado (ver Compatibilidad).
- El tiempo de estudio solo cuenta exámenes (lectura y material no se cronometran).
- Los resúmenes no son abstractivos (no hay IA local fiable sin descargas pesadas); se presentan como extractos literales.

## Siguiente tarea (opcional)
1. Probar en dispositivos reales: Safari macOS, iPhone (instalar desde Compartir → Añadir a pantalla de inicio),
   Chrome/Edge en Windows y Android. Importar un PDF, hacer un examen, crear y restaurar una copia.
2. Probar más normas/temarios y ajustar `src/pdf/structure.ts` con casos de test en `src/pdf/pdf.test.ts`.
3. Mejoras posibles: cronometrar tiempo de lectura/material; OCR opcional (Tesseract.js, carga bajo demanda);
   reducir precache excluyendo diagramas de Mermaid no usados.

## Publicación
- Repositorio: https://github.com/frankEV2/OposiTest (público). Web: **https://frankev2.github.io/OposiTest/**
- GitHub Pages sirve la rama `gh-pages` (contenido de `dist/`). Para publicar cambios: `npm run deploy`
  (pruebas + build + `scripts/deploy.mjs`, que hace push forzado de `dist/` a `gh-pages`) y `git push` para el código.
- No hay workflow de Actions: el token de `gh` no tiene el scope `workflow`. Si se quiere despliegue automático,
  `gh auth refresh -s workflow` y añadir `.github/workflows/`.

## Uso
```
export PATH=~/.local/node/bin:$PATH
npm install        # solo la primera vez
npm run dev        # desarrollo en http://localhost:5173
npm run build      # genera dist/ (app estática + service worker)
npm run preview    # sirve dist/ en http://localhost:4173 para instalarla como PWA
```
`dist/` puede servirse desde cualquier servidor estático o carpeta (rutas relativas). Para instalarla en otros
dispositivos de la red hace falta HTTPS (requisito de los service workers fuera de localhost).
