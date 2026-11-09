import { db } from './db';
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
  return (await db.materias.add({ oposicionId, name: n, order })) as ID;
}

export async function addTema(materiaId: ID, name: string): Promise<ID> {
  const n = requireName(name);
  if (await db.temas.where('[materiaId+name]').equals([materiaId, n]).count()) {
    throw new Error(`Ya existe el tema «${n}»`);
  }
  const order = await db.temas.where('materiaId').equals(materiaId).count();
  return (await db.temas.add({ materiaId, name: n, order })) as ID;
}

export async function rename(table: 'oposiciones' | 'materias' | 'temas', id: ID, name: string) {
  await db[table].update(id, { name: requireName(name) });
}

/**
 * Borra elementos de la taxonomía en cascada. Los documentos y preguntas
 * NO se borran: solo pierden la clasificación.
 */
export async function deleteTema(id: ID) {
  await db.transaction('rw', db.temas, db.documents, db.questions, async () => {
    await db.documents.where('temaId').equals(id).modify({ temaId: undefined });
    await db.questions.where('temaId').equals(id).modify({ temaId: undefined });
    await db.temas.delete(id);
  });
}

export async function deleteMateria(id: ID) {
  const temaIds = (await db.temas.where('materiaId').equals(id).primaryKeys()) as ID[];
  for (const t of temaIds) await deleteTema(t);
  await db.transaction('rw', db.materias, db.documents, async () => {
    await db.documents.where('materiaId').equals(id).modify({ materiaId: undefined });
    await db.materias.delete(id);
  });
}

export async function deleteOposicion(id: ID) {
  const materiaIds = (await db.materias.where('oposicionId').equals(id).primaryKeys()) as ID[];
  for (const m of materiaIds) await deleteMateria(m);
  await db.transaction('rw', db.oposiciones, db.documents, async () => {
    await db.documents.where('oposicionId').equals(id).modify({ oposicionId: undefined });
    await db.oposiciones.delete(id);
  });
}
