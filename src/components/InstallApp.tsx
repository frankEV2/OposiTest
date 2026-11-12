import { useEffect, useState } from 'react';

type Prompt = Event & { prompt: () => Promise<void>; userChoice: Promise<{ outcome: string }> };
let deferred: Prompt | null = null;

const ua = navigator.userAgent;
const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
const isAndroid = /Android/i.test(ua);
const installed = () =>
  window.matchMedia('(display-mode: standalone)').matches || (navigator as { standalone?: boolean }).standalone === true;

export default function InstallApp() {
  const [done, setDone] = useState(installed());
  const [help, setHelp] = useState(false);
  const [, tick] = useState(0);

  useEffect(() => {
    const onPrompt = (e: Event) => { e.preventDefault(); deferred = e as Prompt; tick((n) => n + 1); };
    const onInstalled = () => { deferred = null; setDone(true); };
    window.addEventListener('beforeinstallprompt', onPrompt);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onPrompt);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  if (done || !(isIOS || isAndroid || deferred)) return null; // només mòbil, o escriptori amb avís natiu

  const click = async () => {
    if (deferred && !isIOS) {
      await deferred.prompt();
      await deferred.userChoice;
      deferred = null;
      tick((n) => n + 1);
    } else setHelp(true);
  };

  return (
    <>
      <button className="install-btn" onClick={click}>📲 Instal·lar aplicació</button>
      {help && (
        <div className="backdrop" style={{ display: 'grid', placeItems: 'center', zIndex: 100 }} onClick={() => setHelp(false)}>
          <div role="dialog" aria-label="Instal·lar aplicació" onClick={(e) => e.stopPropagation()}
            style={{ background: 'var(--surface, #fff)', color: 'inherit', padding: 20, borderRadius: 12, maxWidth: 340, margin: 16 }}>
            <h3 style={{ marginTop: 0 }}>Instal·lar aplicació</h3>
            {isIOS ? (
              <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}>
                <li>Obre aquesta pàgina amb Safari.</li>
                <li>Prem el botó de compartir (⬆︎ quadrat amb fletxa).</li>
                <li>Selecciona «Afegir a la pantalla d'inici».</li>
                <li>Prem «Afegir» per confirmar.</li>
              </ol>
            ) : (
              <ol style={{ paddingLeft: 20, lineHeight: 1.6 }}>
                <li>Obre el menú del navegador (⋮).</li>
                <li>Selecciona «Instal·lar aplicació» o «Afegir a la pantalla d'inici».</li>
                <li>Confirma la instal·lació.</li>
              </ol>
            )}
            <button onClick={() => setHelp(false)}>Tancar</button>
          </div>
        </div>
      )}
    </>
  );
}
