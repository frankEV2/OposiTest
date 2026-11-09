import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import { getClientId, syncWithDrive } from '../sync/auto';
import { connect, disconnect, hasValidToken } from '../sync/gdrive';
import type { SyncResult } from '../sync/sync';

const fmt = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });
const summary = (r: Record<string, number>) => Object.entries(r).filter(([, n]) => n).map(([k, n]) => `${k} ${n}`).join(' · ');

export default function SyncPanel() {
  const clientId = useLiveQuery(getClientId);
  const last = useLiveQuery(() => db.settings.get('lastSyncAt'))?.value as number | undefined;
  const auto = !!useLiveQuery(() => db.settings.get('syncAuto'))?.value;
  const [connected, setConnected] = useState(hasValidToken());
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [result, setResult] = useState<SyncResult | null>(null);
  const online = navigator.onLine;

  async function doSync() {
    setError(''); setResult(null);
    try {
      if (!hasValidToken()) { setBusy('Conectando con Google…'); await connect(clientId!); setConnected(true); }
      setBusy('Sincronizando…');
      setResult(await syncWithDrive());
    } catch (e) {
      setError((e as Error).message);
      setConnected(hasValidToken());
    } finally { setBusy(''); }
  }

  async function saveClientId() {
    const v = draft.trim();
    if (!/^[\w-]+\.apps\.googleusercontent\.com$/.test(v)) { setError('El ID debe terminar en «.apps.googleusercontent.com».'); return; }
    setError('');
    await db.settings.put({ key: 'googleClientId', value: v });
    setDraft('');
  }

  return (
    <div className="card">
      <h2>Sincronización entre dispositivos</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Mantén los mismos PDF, preguntas, exámenes y repasos en tu ordenador y tu móvil usando <strong>tu propio Google Drive</strong>.
        Los datos se guardan en una carpeta privada de la app (no aparece entre tus archivos ni la ve nadie más).
        Estudiar sigue funcionando sin conexión; solo sincronizar necesita internet.
      </p>

      {!clientId ? (
        <>
          <p className="small">Para activarla, pega una vez el <strong>ID de cliente de Google</strong> de la app (es gratuito; mira los pasos abajo).</p>
          <div className="row">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} placeholder="1234…apps.googleusercontent.com" aria-label="ID de cliente de Google" />
            <button onClick={saveClientId} disabled={!draft.trim()}>Guardar</button>
          </div>
        </>
      ) : (
        <>
          <div className="row">
            <button className="primary" onClick={doSync} disabled={!!busy || !online}>
              {connected ? 'Sincronizar ahora' : 'Conectar con Google Drive y sincronizar'}
            </button>
            {connected && <button onClick={async () => { await disconnect(); setConnected(false); }} disabled={!!busy}>Desconectar</button>}
            {busy && <span className="muted small">{busy}</span>}
            {!online && <span className="muted small">Sin conexión a internet.</span>}
          </div>
          <label className="check" style={{ marginTop: 8 }}>
            <input type="checkbox" checked={auto} onChange={(e) => db.settings.put({ key: 'syncAuto', value: e.target.checked })} />
            Sincronizar sola al abrir la app y al terminar cada examen (mientras la sesión de Google siga activa, ~1 hora)
          </label>
          <p className="muted small">{last ? `Última sincronización: ${fmt(last)}.` : 'Aún no se ha sincronizado este dispositivo.'}</p>
        </>
      )}

      {error && <p className="error">{error}</p>}
      {result && (
        <div className="restore">
          <strong>Sincronización completada.</strong>
          <p className="muted small">
            {summary(result.added) ? <>Recibido: {summary(result.added)}<br /></> : null}
            {summary(result.updated) ? <>Actualizado: {summary(result.updated)}<br /></> : null}
            {summary(result.deleted) ? <>Borrado: {summary(result.deleted)}<br /></> : null}
            {result.uploadedPdfs ? <>PDF subidos: {result.uploadedPdfs}<br /></> : null}
            {!summary(result.added) && !summary(result.updated) && !summary(result.deleted) && !result.uploadedPdfs && 'Todo estaba al día.'}
          </p>
          {result.failed.length > 0 && <p className="error">No se pudieron traer: {result.failed.join('; ')}</p>}
        </div>
      )}

      <details style={{ marginTop: 10 }}>
        <summary className="muted small">Cómo obtener el ID de cliente de Google (una sola vez, gratis)</summary>
        <ol className="small guide">
          <li>Entra en <strong>console.cloud.google.com</strong> con tu cuenta de Google y crea un proyecto (p. ej. «OposiTest»).</li>
          <li>En «APIs y servicios → Biblioteca», busca <strong>Google Drive API</strong> y pulsa «Habilitar».</li>
          <li>En «APIs y servicios → Pantalla de consentimiento de OAuth»: tipo <strong>Externo</strong>, nombre «OposiTest», tu correo;
            en «Usuarios de prueba» añade tu propia cuenta de Gmail.</li>
          <li>En «Credenciales → Crear credenciales → ID de cliente de OAuth»: tipo <strong>Aplicación web</strong>.
            En «Orígenes de JavaScript autorizados» añade <code>{location.origin}</code>.</li>
          <li>Copia el <strong>ID de cliente</strong> (termina en <code>.apps.googleusercontent.com</code>) y pégalo arriba.
            Haz lo mismo en el móvil (o sincroniza una vez y ya quedará guardado).</li>
        </ol>
        {clientId && <button className="link" onClick={() => db.settings.delete('googleClientId')}>Cambiar ID de cliente</button>}
      </details>
    </div>
  );
}
