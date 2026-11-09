import { db } from '../db/db';
import { DriveRemote, hasValidToken } from './gdrive';
import { syncNow, type SyncResult } from './sync';

/** ID de cliente OAuth de Google: el guardado en Ajustes o, si no hay, el definido al compilar. */
export async function getClientId(): Promise<string | undefined> {
  const s = (await db.settings.get('googleClientId'))?.value as string | undefined;
  return s?.trim() || (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
}

export const syncWithDrive = (): Promise<SyncResult> => syncNow(new DriveRemote());

/**
 * Sincronización automática (al abrir la app y al terminar un examen) si el usuario la activó y la
 * sesión de Google sigue vigente. Nunca abre ventanas de Google ni muestra errores: es silenciosa.
 */
export async function autoSync(): Promise<void> {
  try {
    if (!navigator.onLine || !hasValidToken()) return;
    if (!(await db.settings.get('syncAuto'))?.value) return;
    await syncWithDrive();
  } catch {
    /* se reintentará en la próxima ocasión; el usuario puede sincronizar a mano en Configuración */
  }
}
