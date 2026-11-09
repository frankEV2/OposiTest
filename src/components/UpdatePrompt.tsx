import { useEffect, useState } from 'react';

/** Registra el service worker (solo en producción) y avisa cuando hay una versión nueva. */
export default function UpdatePrompt() {
  const [update, setUpdate] = useState<((reload?: boolean) => Promise<void>) | null>(null);
  const [offlineReady, setOfflineReady] = useState(false);

  useEffect(() => {
    if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
    import('virtual:pwa-register').then(({ registerSW }) => {
      const updateSW = registerSW({
        onNeedRefresh: () => setUpdate(() => updateSW),
        onOfflineReady: () => setOfflineReady(true),
      });
    });
  }, []);

  if (update) {
    return (
      <div className="update-banner" role="status">
        <span>Hay una versión nueva de OposiTest.</span>
        <button className="primary" onClick={() => update(true)}>Actualizar</button>
        <button onClick={() => setUpdate(null)}>Más tarde</button>
      </div>
    );
  }
  if (offlineReady) {
    return (
      <div className="update-banner" role="status">
        <span>OposiTest ya funciona sin conexión.</span>
        <button onClick={() => setOfflineReady(false)}>Cerrar</button>
      </div>
    );
  }
  return null;
}
