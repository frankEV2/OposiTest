/**
 * Oposiciones (espacios de trabajo) independientes. Cada una tiene su propia base de datos IndexedDB,
 * así documentos, preguntas, exámenes, estadísticas y ajustes quedan totalmente separados.
 * Para añadir una oposición basta con una entrada nueva aquí (y, si tiene temario integrado,
 * su carpeta en public/temario/).
 */
export interface Workspace {
  id: string;
  organismo: string;
  nombre: string;
  /** Nombre de la base de datos local. */
  dbName: string;
  /** Carpeta de public/temario/ con su temario integrado. */
  temario: string;
  /** Color de acento de la tarjeta. */
  accent: string;
  /** Archivo de estado en Google Drive (sincronización). */
  syncFile: string;
}

export const WORKSPACES: Workspace[] = [
  {
    id: 'puerto-tarragona',
    organismo: 'Autoridad Portuaria de Tarragona',
    nombre: 'Técnico de Gestión Documental',
    dbName: 'opositest', // la base de datos original: conserva todo el progreso existente
    temario: 'Puertos del Estado/',
    accent: '#1f5f8b',
    syncFile: 'opositest-state.json',
  },
  {
    id: 'ayto-tarragona-prl',
    organismo: 'Ayuntamiento de Tarragona',
    nombre: 'Técnico de Prevención de Riesgos Laborales',
    dbName: 'opositest-ayto-tarragona-prl',
    temario: 'Ayuntamiento de Tarragona/',
    accent: '#0f766e',
    syncFile: 'opositest-state-ayto-tarragona-prl.json',
  },
];

const KEY = 'opositest.workspace';
const LAST = 'opositest.lastWorkspace';

function read(k: string): string | null {
  try { return localStorage.getItem(k); } catch { return null; }
}

/** Oposición abierta (null → se muestra la pantalla de selección). */
export function currentWorkspace(): Workspace | null {
  return WORKSPACES.find((w) => w.id === read(KEY)) ?? null;
}

/** Oposición por defecto fuera del navegador (tests): la original. */
export const activeWorkspace = (): Workspace => currentWorkspace() ?? WORKSPACES[0];

export function lastWorkspaceId(): string | null {
  return read(LAST);
}

/** Abre una oposición. Se recarga para abrir su base de datos desde cero. */
export function chooseWorkspace(id: string) {
  try { localStorage.setItem(KEY, id); localStorage.setItem(LAST, id); } catch { /* sin almacenamiento */ }
  location.hash = '#/';
  location.reload();
}

/** Vuelve a la pantalla de selección (se recuerda la última para marcarla). */
export function leaveWorkspace() {
  try { localStorage.removeItem(KEY); } catch { /* sin almacenamiento */ }
  location.hash = '#/';
  location.reload();
}
