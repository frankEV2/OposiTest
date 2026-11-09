import { db } from './db';

export interface AppSettings {
  /** Fracción del valor de un acierto que resta cada error (0 = sin penalización). */
  penalty: number;
  defaultCount: 5 | 10 | 20 | 30 | 50 | 100;
  /** Minutos del simulacro; 0 = sin cronómetro. */
  simulacroMinutes: number;
  theme: 'system' | 'light' | 'dark';
}

export const DEFAULT_SETTINGS: AppSettings = {
  penalty: 1 / 3,
  defaultCount: 20,
  simulacroMinutes: 0,
  theme: 'system',
};

export async function getSettings(): Promise<AppSettings> {
  const rows = await db.settings.toArray();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  return { ...DEFAULT_SETTINGS, ...stored } as AppSettings;
}

export async function setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]) {
  await db.settings.put({ key, value });
}

export const PENALTIES: [string, number][] = [
  ['Sin penalización', 0], ['1/4 por error', 0.25], ['1/3 por error', 1 / 3], ['1/2 por error', 0.5], ['1 por error', 1],
];
