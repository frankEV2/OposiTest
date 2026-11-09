import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect } from 'react';
import { db } from '../db/db';

/** Aplica el tema guardado en ajustes al elemento raíz. */
export function useTheme() {
  const theme = useLiveQuery(() => db.settings.get('theme'))?.value as string | undefined;
  useEffect(() => {
    const root = document.documentElement;
    if (theme === 'light' || theme === 'dark') root.dataset.theme = theme;
    else delete root.dataset.theme;
  }, [theme]);
}
