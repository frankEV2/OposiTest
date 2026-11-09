import { beforeEach, describe, expect, it } from 'vitest';
import { db } from './db';
import { addMateria, addOposicion, addTema, deleteOposicion } from './taxonomy';
import { DEFAULT_SETTINGS, getSettings, setSetting } from './settings';

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('taxonomía', () => {
  it('crea jerarquía y rechaza duplicados y vacíos', async () => {
    const o = await addOposicion('  Auxiliar   Administrativo ');
    expect((await db.oposiciones.get(o))?.name).toBe('Auxiliar Administrativo');
    await expect(addOposicion('Auxiliar Administrativo')).rejects.toThrow();
    await expect(addOposicion('   ')).rejects.toThrow();
    const m = await addMateria(o, 'Derecho administrativo');
    await addTema(m, 'Tema 1');
    await expect(addTema(m, 'Tema 1')).rejects.toThrow();
    expect(await addTema(m, 'Tema 2')).toBeGreaterThan(0);
  });

  it('borra en cascada sin borrar documentos ni preguntas', async () => {
    const o = await addOposicion('A');
    const m = await addMateria(o, 'M');
    const t = await addTema(m, 'T');
    const docId = await db.documents.add({
      title: 'Ley', fileName: 'ley.pdf', size: 1, sha256: 'x', pageCount: 1,
      oposicionId: o, materiaId: m, temaId: t, extraction: 'ok', warnings: [],
      importedAt: 0, updatedAt: 0,
    });
    await db.questions.add({
      hash: 'h', temaId: t, stem: 's', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      explanation: '', reference: '', sourceExcerpt: '', difficulty: 1,
      status: 'pending', rule: 'manual', createdAt: 0, updatedAt: 0,
    });
    await deleteOposicion(o);
    expect(await db.temas.count()).toBe(0);
    expect(await db.materias.count()).toBe(0);
    const doc = await db.documents.get(docId);
    expect(doc).toBeDefined();
    expect(doc?.temaId).toBeUndefined();
    expect(doc?.oposicionId).toBeUndefined();
    expect((await db.questions.toArray())[0].temaId).toBeUndefined();
  });

  it('impide documentos duplicados por hash', async () => {
    const d = { title: 'a', fileName: 'a', size: 1, sha256: 'same', pageCount: 1,
      extraction: 'ok' as const, warnings: [], importedAt: 0, updatedAt: 0 };
    await db.documents.add(d);
    await expect(db.documents.add({ ...d })).rejects.toThrow();
  });
});

describe('ajustes', () => {
  it('devuelve valores por defecto y persiste cambios', async () => {
    expect(await getSettings()).toEqual(DEFAULT_SETTINGS);
    await setSetting('penalty', 0.25);
    expect((await getSettings()).penalty).toBe(0.25);
  });
});
