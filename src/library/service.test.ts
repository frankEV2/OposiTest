import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { deleteDocument, DuplicateError, importPdf, replacePdf } from './service';
import { searchSections } from './search';

const fakeFile = (content: string, name = 'ley.pdf') =>
  new File([content], name, { type: 'application/pdf' });

const extractor = (pages: string[]) => async () => ({ pages });

const LEY = [
  'Artículo 1. Objeto.\n1. Esta ley regula el procedimiento administrativo común.\n2. También el silencio.',
  'Artículo 2. Plazos.\nEl plazo máximo para resolver será de tres meses.',
];

beforeEach(async () => {
  await Promise.all(db.tables.map((t) => t.clear()));
});

describe('biblioteca', () => {
  it('importa, enlaza la jerarquía y evita duplicados', async () => {
    const id = await importPdf(fakeFile('A'), {}, undefined, extractor(LEY));
    const doc = await db.documents.get(id);
    expect(doc?.title).toBe('ley');
    expect(doc?.extraction).toBe('ok');
    expect(await db.pages.where('documentId').equals(id).count()).toBe(2);
    const ap = await db.sections.filter((s) => s.label === 'Artículo 1.2').first();
    expect(ap?.parentId).toBeDefined();
    expect((await db.sections.get(ap!.parentId!))?.label).toBe('Artículo 1');
    await expect(importPdf(fakeFile('A', 'otra.pdf'), {}, undefined, extractor(LEY))).rejects.toBeInstanceOf(DuplicateError);
  });

  it('marca escaneados sin secciones', async () => {
    const id = await importPdf(fakeFile('S'), {}, undefined, extractor(['', ' ', '']));
    const doc = await db.documents.get(id);
    expect(doc?.extraction).toBe('scanned');
    expect(doc?.warnings[0]).toMatch(/escaneado/);
  });

  it('busca sin tildes y por frase', async () => {
    await importPdf(fakeFile('A'), {}, undefined, extractor(LEY));
    expect((await searchSections('PROCEDIMIENTO comun'))[0].section.label).toBe('Artículo 1');
    expect(await searchSections('"tres meses"')).toHaveLength(1);
    expect(await searchSections('"meses tres"')).toHaveLength(0);
  });

  it('sustituye manteniendo clasificación y borra en cascada', async () => {
    const id = await importPdf(fakeFile('A'), { temaId: 7 }, undefined, extractor(LEY));
    await db.questions.add({
      hash: 'q', documentId: id, sectionId: 1, stem: '', options: ['a', 'b', 'c', 'd'], correctIndex: 0,
      explanation: '', reference: '', sourceExcerpt: '', difficulty: 1, status: 'validated',
      rule: 'plazo', createdAt: 0, updatedAt: 0,
    });
    await replacePdf(id, fakeFile('B'), undefined, extractor([LEY[1]]));
    const doc = await db.documents.get(id);
    expect(doc?.temaId).toBe(7);
    expect(doc?.pageCount).toBe(1);
    expect(await db.sections.filter((s) => s.label === 'Artículo 1').count()).toBe(0);
    expect((await db.questions.toArray())[0].status).toBe('pending');

    await deleteDocument(id);
    expect(await db.documents.count()).toBe(0);
    expect(await db.sections.count()).toBe(0);
    expect(await db.pages.count()).toBe(0);
    expect(await db.questions.count()).toBe(0);
    expect(await db.documentFiles.count()).toBe(0);
  });
});
