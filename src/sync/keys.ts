/** Claves naturales (iguales en todos los dispositivos) y registro de borrados. */
import { db } from '../db/db';
import type { DocumentMeta, ID, Question } from '../db/types';

export const docKey = (d: Pick<DocumentMeta, 'uid' | 'sha256'>) => d.uid ?? d.sha256;
export const qKey = (q: Pick<Question, 'uid' | 'hash'>) => q.uid ?? q.hash;

const SEP = '\u0001';
export const taxPath = (...names: string[]) => names.join(SEP);

/** Ruta "oposición/materia/tema" de un tema, materia u oposición local. */
export async function taxPathOf(kind: 'oposicion' | 'materia' | 'tema', id: ID): Promise<string | undefined> {
  if (kind === 'oposicion') return (await db.oposiciones.get(id))?.name;
  if (kind === 'materia') {
    const m = await db.materias.get(id);
    const o = m && (await db.oposiciones.get(m.oposicionId));
    return m && o ? taxPath(o.name, m.name) : undefined;
  }
  const t = await db.temas.get(id);
  const m = t && (await db.materias.get(t.materiaId));
  const o = m && (await db.oposiciones.get(m.oposicionId));
  return t && m && o ? taxPath(o.name, m.name, t.name) : undefined;
}

/** Anota borrados (se llama dentro o fuera de transacciones que incluyan `db.deletions`). */
export async function recordDeletions(keys: string[], at = Date.now()) {
  if (keys.length) await db.deletions.bulkPut(keys.map((key) => ({ key, deletedAt: at })));
}
