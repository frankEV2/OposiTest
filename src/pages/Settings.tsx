import { useLiveQuery } from 'dexie-react-hooks';
import { useState, type FormEvent } from 'react';
import BackupPanel from '../components/BackupPanel';
import SyncPanel from '../components/SyncPanel';
import { db } from '../db/db';
import { getSettings, PENALTIES, setSetting, type AppSettings } from '../db/settings';
import {
  addMateria, addOposicion, addTema, deleteMateria, deleteOposicion, deleteTema, rename,
} from '../db/taxonomy';
import type { ID } from '../db/types';

function AddForm({ placeholder, onAdd }: { placeholder: string; onAdd: (name: string) => Promise<unknown> }) {
  const [name, setName] = useState('');
  const [error, setError] = useState('');
  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      await onAdd(name);
      setName('');
      setError('');
    } catch (err) {
      setError((err as Error).message);
    }
  }
  return (
    <form onSubmit={submit}>
      <div className="row">
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholder} />
        <button type="submit" disabled={!name.trim()}>Añadir</button>
      </div>
      {error && <div className="error">{error}</div>}
    </form>
  );
}

function Item({ name, table, id, onDelete, warn }: {
  name: string; table: 'oposiciones' | 'materias' | 'temas'; id: ID;
  onDelete: (id: ID) => Promise<void>; warn: string;
}) {
  const doRename = async () => {
    const n = prompt('Nuevo nombre', name);
    if (n && n.trim() && n !== name) await rename(table, id, n);
  };
  const doDelete = async () => {
    if (confirm(`¿Eliminar «${name}»? ${warn}`)) await onDelete(id);
  };
  return (
    <span className="tree-item">
      <strong style={{ fontWeight: 500 }}>{name}</strong>
      <button className="link" onClick={doRename}>Renombrar</button>
      <button className="link" onClick={doDelete}>Eliminar</button>
    </span>
  );
}

const KEEP = 'Los documentos y preguntas asociados se conservan sin clasificar.';

function Taxonomy() {
  const data = useLiveQuery(async () => ({
    ops: await db.oposiciones.toArray(),
    mats: await db.materias.orderBy('id').toArray(),
    temas: await db.temas.orderBy('id').toArray(),
  }));
  if (!data) return null;
  return (
    <div className="card">
      <h2>Oposiciones, materias y temas</h2>
      {data.ops.length === 0 && <p className="muted">Aún no hay ninguna oposición.</p>}
      <ul className="tree" style={{ paddingLeft: 0 }}>
        {data.ops.map((o) => (
          <li key={o.id}>
            <details open>
              <summary><Item name={o.name} table="oposiciones" id={o.id!} onDelete={deleteOposicion} warn={`Se eliminarán sus materias y temas. ${KEEP}`} /></summary>
              <ul className="tree">
                {data.mats.filter((m) => m.oposicionId === o.id).map((m) => (
                  <li key={m.id}>
                    <details>
                      <summary><Item name={m.name} table="materias" id={m.id!} onDelete={deleteMateria} warn={`Se eliminarán sus temas. ${KEEP}`} /></summary>
                      <ul className="tree">
                        {data.temas.filter((t) => t.materiaId === m.id).map((t) => (
                          <li key={t.id}><Item name={t.name} table="temas" id={t.id!} onDelete={deleteTema} warn={KEEP} /></li>
                        ))}
                        <li><AddForm placeholder="Nuevo tema" onAdd={(n) => addTema(m.id!, n)} /></li>
                      </ul>
                    </details>
                  </li>
                ))}
                <li><AddForm placeholder="Nueva materia" onAdd={(n) => addMateria(o.id!, n)} /></li>
              </ul>
            </details>
          </li>
        ))}
      </ul>
      <div style={{ marginTop: 12 }}>
        <AddForm placeholder="Nueva oposición (p. ej. Auxiliar Administrativo del Estado)" onAdd={addOposicion} />
      </div>
    </div>
  );
}


function Preferences() {
  const s = useLiveQuery(getSettings) as AppSettings | undefined;
  if (!s) return null;
  return (
    <div className="card">
      <h2>Preferencias</h2>
      <div className="field">
        <label htmlFor="pen">Penalización por respuesta errónea</label>
        <select id="pen" value={s.penalty} onChange={(e) => setSetting('penalty', Number(e.target.value))}>
          {PENALTIES.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="cnt">Número de preguntas por defecto</label>
        <select id="cnt" value={s.defaultCount}
          onChange={(e) => setSetting('defaultCount', Number(e.target.value) as AppSettings['defaultCount'])}>
          {[5, 10, 20, 30, 50, 100].map((n) => <option key={n} value={n}>{n}</option>)}
        </select>
      </div>
      <div className="field">
        <label htmlFor="min">Duración del simulacro (minutos, 0 = sin cronómetro)</label>
        <input id="min" type="number" min={0} max={600} value={s.simulacroMinutes}
          onChange={(e) => setSetting('simulacroMinutes', Math.max(0, Math.min(600, Number(e.target.value) || 0)))} />
      </div>
      <div className="field">
        <label htmlFor="theme">Tema visual</label>
        <select id="theme" value={s.theme} onChange={(e) => setSetting('theme', e.target.value as AppSettings['theme'])}>
          <option value="system">Según el sistema</option>
          <option value="light">Claro</option>
          <option value="dark">Oscuro</option>
        </select>
      </div>
    </div>
  );
}

function Storage() {
  const est = useLiveQuery(async () => {
    const persisted = (await navigator.storage?.persisted?.()) ?? false;
    const e = await navigator.storage?.estimate?.();
    return { persisted, usage: e?.usage, quota: e?.quota };
  });
  const [msg, setMsg] = useState('');
  const mb = (n?: number) => (n == null ? '–' : `${(n / 1048576).toFixed(1)} MB`);
  async function persist() {
    const ok = await navigator.storage?.persist?.();
    setMsg(ok ? 'Almacenamiento persistente concedido.' : 'El navegador no ha concedido el almacenamiento persistente.');
  }
  return (
    <div className="card">
      <h2>Almacenamiento local</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        Usado: {mb(est?.usage)} de {mb(est?.quota)} disponibles ·{' '}
        {est?.persisted ? 'persistente' : 'el navegador podría borrarlo si falta espacio'}
      </p>
      {est && !est.persisted && 'storage' in navigator && 'persist' in navigator.storage && (
        <button onClick={persist}>Solicitar almacenamiento persistente</button>
      )}
      {msg && <p className="muted">{msg}</p>}
    </div>
  );
}

export default function Settings() {
  return (
    <>
      <h1>Configuración</h1>
      <p className="sub">Clasificación de tus documentos y preferencias de examen.</p>
      <Taxonomy />
      <Preferences />
      <SyncPanel />
      <BackupPanel />
      <Storage />
    </>
  );
}
