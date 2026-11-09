import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { exportBackup, parseBackup, restoreMerge, restoreReplace, type ParsedBackup, type RestoreReport } from '../backup/backup';
import { db } from '../db/db';
import { clearSearchCache } from '../library/search';

const LABELS: Record<string, string> = {
  oposiciones: 'Oposiciones', materias: 'Materias', temas: 'Temas', documents: 'Documentos', pdf: 'PDF',
  questions: 'Preguntas', exams: 'Exámenes', attempts: 'Respuestas', reviews: 'En repaso', sessions: 'Sesiones',
};

function save(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

export default function BackupPanel() {
  const fileRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [parsed, setParsed] = useState<{ p: ParsedBackup; name: string } | null>(null);
  const [mode, setMode] = useState<'merge' | 'replace'>('merge');
  const [report, setReport] = useState<RestoreReport | null>(null);
  const last = useLiveQuery(() => db.settings.get('lastBackupAt'))?.value as number | undefined;

  async function doExport() {
    setBusy('Creando copia…'); setError('');
    try {
      const { blob, name } = await exportBackup();
      save(blob, name);
    } catch (e) { setError((e as Error).message); } finally { setBusy(''); }
  }

  async function onFile(f?: File) {
    if (fileRef.current) fileRef.current.value = '';
    if (!f) return;
    setError(''); setReport(null);
    try {
      setParsed({ p: parseBackup(new Uint8Array(await f.arrayBuffer())), name: f.name });
      setMode('merge');
    } catch (e) { setError((e as Error).message); }
  }

  async function restore() {
    if (!parsed) return;
    if (mode === 'replace') {
      if (!confirm('Se BORRARÁN todos los datos actuales y se sustituirán por la copia. Antes se descargará una copia de seguridad de lo que tienes ahora. ¿Continuar?')) return;
    }
    setError('');
    try {
      if (mode === 'replace') {
        setBusy('Guardando copia previa…');
        const pre = await exportBackup();
        save(pre.blob, pre.name.replace('copia', 'copia-previa'));
      }
      setBusy('Restaurando…');
      setReport(mode === 'replace' ? await restoreReplace(parsed.p) : await restoreMerge(parsed.p));
      clearSearchCache();
      setParsed(null);
    } catch (e) {
      setError(`No se ha restaurado nada: ${(e as Error).message}`);
    } finally { setBusy(''); }
  }

  const fmt = (t: number) => new Date(t).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' });

  return (
    <div className="card">
      <h2>Copias de seguridad</h2>
      <p className="muted small" style={{ marginTop: 0 }}>
        Un archivo ZIP con documentos PDF, texto extraído, preguntas, exámenes, progreso y ajustes. Se guarda donde tú elijas;
        nada se envía a ningún servidor. {last ? `Última copia: ${fmt(last)}.` : 'Aún no has hecho ninguna copia.'}
      </p>
      <div className="row">
        <button className="primary" onClick={doExport} disabled={!!busy}>Crear copia de seguridad</button>
        <button onClick={() => fileRef.current?.click()} disabled={!!busy}>Restaurar desde archivo…</button>
        <input ref={fileRef} type="file" accept=".zip,application/zip" hidden onChange={(e) => onFile(e.target.files?.[0])} />
        {busy && <span className="muted small">{busy}</span>}
      </div>
      {error && <p className="error">{error}</p>}

      {parsed && (
        <div className="restore">
          <p><strong>{parsed.name}</strong> · copia del {fmt(parsed.p.manifest.exportedAt)}</p>
          <p className="muted small">
            {Object.entries(LABELS).filter(([k]) => parsed.p.manifest.counts[k]).map(([k, l]) => `${l}: ${parsed.p.manifest.counts[k]}`).join(' · ') || 'Copia vacía'}
          </p>
          <label className="check">
            <input type="radio" name="mode" checked={mode === 'merge'} onChange={() => setMode('merge')} />
            <span><strong>Fusionar</strong> (recomendado): añade lo que no tienes y no modifica ni borra tus datos actuales.
              Los duplicados se omiten.</span>
          </label>
          <label className="check">
            <input type="radio" name="mode" checked={mode === 'replace'} onChange={() => setMode('replace')} />
            <span><strong>Reemplazar todo</strong>: borra tus datos actuales y deja solo los de la copia
              (antes se descarga una copia de lo que tienes ahora).</span>
          </label>
          <div className="row">
            <button className={mode === 'replace' ? 'danger' : 'primary'} onClick={restore} disabled={!!busy}>
              {mode === 'replace' ? 'Reemplazar mis datos' : 'Fusionar copia'}
            </button>
            <button onClick={() => setParsed(null)} disabled={!!busy}>Cancelar</button>
          </div>
        </div>
      )}

      {report && (
        <div className="restore">
          <strong>Restauración completada.</strong>
          <p className="muted small">
            Añadido: {Object.entries(report.added).filter(([k, n]) => n && LABELS[k]).map(([k, n]) => `${LABELS[k]} ${n}`).join(' · ') || 'nada nuevo'}
            {Object.keys(report.skipped).length > 0 && (
              <><br />Ya existían (omitidos): {Object.entries(report.skipped).filter(([k]) => LABELS[k]).map(([k, n]) => `${LABELS[k]} ${n}`).join(' · ')}</>
            )}
          </p>
        </div>
      )}
    </div>
  );
}
