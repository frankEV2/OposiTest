import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { Classification } from '../library/service';

/** Selectores encadenados Oposición > Materia > Tema. */
export default function ClassificationPicker({ value, onChange, compact }: {
  value: Classification;
  onChange: (c: Classification) => void;
  compact?: boolean;
}) {
  const data = useLiveQuery(async () => ({
    ops: await db.oposiciones.toArray(),
    mats: await db.materias.toArray(),
    temas: await db.temas.toArray(),
  }));
  if (!data) return null;
  const mats = data.mats.filter((m) => m.oposicionId === value.oposicionId);
  const temas = data.temas.filter((t) => t.materiaId === value.materiaId);
  const num = (v: string) => (v ? Number(v) : undefined);

  if (!data.ops.length) {
    return <span className="muted small">Crea oposiciones y temas en Configuración para clasificar.</span>;
  }
  return (
    <div className={`row${compact ? ' small' : ''}`}>
      <select aria-label="Oposición" value={value.oposicionId ?? ''}
        onChange={(e) => onChange({ oposicionId: num(e.target.value) })}>
        <option value="">Sin oposición</option>
        {data.ops.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      <select aria-label="Materia" value={value.materiaId ?? ''} disabled={!mats.length}
        onChange={(e) => onChange({ oposicionId: value.oposicionId, materiaId: num(e.target.value) })}>
        <option value="">Sin materia</option>
        {mats.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
      </select>
      <select aria-label="Tema" value={value.temaId ?? ''} disabled={!temas.length}
        onChange={(e) => onChange({ ...value, temaId: num(e.target.value) })}>
        <option value="">Sin tema</option>
        {temas.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
      </select>
    </div>
  );
}
