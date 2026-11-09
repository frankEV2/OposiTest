import { db } from './db';
import { recordDeletions, taxPathOf } from '../sync/keys';
import type { ID } from './types';

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

function requireName(name: string): string {
  const n = clean(name);
  if (!n) throw new Error('El nombre no puede estar vacío');
  return n;
}

export async function addOposicion(name: string): Promise<ID> {
  const n = requireName(name);
  if (await db.oposiciones.where('name').equals(n).count()) {
    throw new Error(`Ya existe la oposición «${n}»`);
  }
  return (await db.oposiciones.add({ name: n, createdAt: Date.now() })) as ID;
}

export async function addMateria(oposicionId: ID, name: string): Promise<ID> {
  const n = requireName(name);
  if (await db.materias.where('[oposicionId+name]').equals([oposicionId, n]).count()) {
    throw new Error(`Ya existe la materia «${n}»`);
  }
  const order = await db.materias.where('oposicionId').equals(oposicionId).count();
  return (await db.materias.add({ oposicionId, name: n, order, createdAt: Date.now() })) as ID;
}

export async function addTema(materiaId: ID, name: string): Promise<ID> {
  const n = requireName(name);
  if (await db.temas.where('[materiaId+name]').equals([materiaId, n]).count()) {
    throw new Error(`Ya existe el tema «${n}»`);
  }
  const order = await db.temas.where('materiaId').equals(materiaId).count();
  return (await db.temas.add({ materiaId, name: n, order, createdAt: Date.now() })) as ID;
}

const KIND = { oposiciones: 'oposicion', materias: 'materia', temas: 'tema' } as const;
const FIELD = { oposiciones: 'oposicionId', materias: 'materiaId', temas: 'temaId' } as const;

/**
 * Marca como modificados los documentos y preguntas de un elemento de la taxonomía, para que
 * la sincronización propague su nueva clasificación.
 */
async function touchClassified(table: keyof typeof FIELD, id: ID) {
  const now = Date.now();
  const field = FIELD[table];
  await db.documents.where(field).equals(id).modify({ updatedAt: now });
  if (field === 'temaId') await db.questions.where('temaId').equals(id).modify({ updatedAt: now });
}

export async function rename(table: 'oposiciones' | 'materias' | 'temas', id: ID, name: string) {
  const old = await taxPathOf(KIND[table], id);
  await db[table].update(id, { name: requireName(name), createdAt: Date.now() });
  // Para otros dispositivos, renombrar = borrar la ruta antigua y crear la nueva.
  if (old) await recordDeletions([`tax:${old}`]);
  if (table === 'oposiciones') {
    for (const m of await db.materias.where('oposicionId').equals(id).toArray()) {
      await db.materias.update(m.id!, { createdAt: Date.now() });
      for (const t of await db.temas.where('materiaId').equals(m.id!).toArray()) await db.temas.update(t.id!, { createdAt: Date.now() });
    }
  }
  if (table === 'materias') {
    for (const t of await db.temas.where('materiaId').equals(id).toArray()) await db.temas.update(t.id!, { createdAt: Date.now() });
  }
  await touchClassified(table, id);
}

/**
 * Borra elementos de la taxonomía en cascada. Los documentos y preguntas
 * NO se borran: solo pierden la clasificación.
 */
export async function deleteTema(id: ID) {
  const path = await taxPathOf('tema', id);
  if (path) await recordDeletions([`tax:${path}`]);
  await touchClassified('temas', id);
  await db.transaction('rw', db.temas, db.documents, db.questions, async () => {
    await db.documents.where('temaId').equals(id).modify({ temaId: undefined });
    await db.questions.where('temaId').equals(id).modify({ temaId: undefined });
    await db.temas.delete(id);
  });
}

export async function deleteMateria(id: ID) {
  const temaIds = (await db.temas.where('materiaId').equals(id).primaryKeys()) as ID[];
  for (const t of temaIds) await deleteTema(t);
  const path = await taxPathOf('materia', id);
  if (path) await recordDeletions([`tax:${path}`]);
  await touchClassified('materias', id);
  await db.transaction('rw', db.materias, db.documents, async () => {
    await db.documents.where('materiaId').equals(id).modify({ materiaId: undefined });
    await db.materias.delete(id);
  });
}

export async function deleteOposicion(id: ID) {
  const materiaIds = (await db.materias.where('oposicionId').equals(id).primaryKeys()) as ID[];
  for (const m of materiaIds) await deleteMateria(m);
  const path = await taxPathOf('oposicion', id);
  if (path) await recordDeletions([`tax:${path}`]);
  await touchClassified('oposiciones', id);
  await db.transaction('rw', db.oposiciones, db.documents, async () => {
    await db.documents.where('oposicionId').equals(id).modify({ oposicionId: undefined });
    await db.oposiciones.delete(id);
  });
}
