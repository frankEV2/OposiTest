import { beforeEach, describe, expect, it } from 'vitest';
import { strToU8, zipSync } from 'fflate';
import { db } from '../db/db';
import { setSetting } from '../db/settings';
import { addMateria, addOposicion, addTema } from '../db/taxonomy';
import { generateForDocuments } from '../engine/store';
import { createExam, finishExam, setAnswer } from '../exam/service';
import { importPdf } from '../library/service';
import { exportBackup, parseBackup, restoreMerge, restoreReplace } from './backup';

// Texto de prueba (no es una norma real).
const PAGES = [`Artículo 1. Plazos.
1. El plazo para resolver será de tres meses desde la solicitud.
2. Las alegaciones se presentarán en el plazo de diez días hábiles desde la notificación.
Artículo 2. Recursos.
El recurso podrá interponerse en el plazo de un mes desde la notificación.
Artículo 3. Subsanación.
La subsanación se hará en el plazo de quince días hábiles desde el requerimiento.`];
const OTHER = ['Artículo 9. Otra norma.\nTexto distinto de otra norma de prueba con contenido suficiente.'];

const clearAll = () => Promise.all(db.tables.map((t) => t.clear()));
const bytesOf = async (b: Blob) => new Uint8Array(await b.arrayBuffer());

async function seed() {
  const o = await addOposicion('Auxiliar');
  const m = await addMateria(o, 'Derecho');
  const t = await addTema(m, 'Tema 1');
  const doc = await importPdf(new File(['pdf-A'], 'a.pdf'), { oposicionId: o, materiaId: m, temaId: t }, undefined, async () => ({ pages: PAGES }));
  await generateForDocuments([doc]);
  const ex = await createExam({
    mode: 'estudio', count: 10, documentIds: [doc], temaIds: [], sectionIds: [], difficulties: [], pool: 'all',
    shuffle: false, penalty: 0, includePending: true,
  });
  await setAnswer(ex, 0, 3);
  await finishExam(ex);
  await setSetting('penalty', 0.5);
  return doc;
}

async function snapshot() {
  return {
    docs: await db.documents.count(), pages: await db.pages.count(), sections: await db.sections.count(),
    questions: await db.questions.count(), exams: await db.exams.count(), attempts: await db.attempts.count(),
    reviews: await db.reviews.count(), files: await db.documentFiles.count(), temas: await db.temas.count(),
  };
}

beforeEach(clearAll);

describe('copias de seguridad', () => {
  it('exporta y restaura reemplazando todo con los mismos datos', async () => {
    await seed();
    const before = await snapshot();
    const { blob, manifest } = await exportBackup();
    expect(manifest.counts.pdf).toBe(1);
    await clearAll();
    await restoreReplace(parseBackup(await bytesOf(blob)));
    expect(await snapshot()).toEqual(before);
    const f = await db.documentFiles.toArray();
    expect(new TextDecoder().decode(await f[0].blob.arrayBuffer())).toBe('pdf-A');
  });

  it('fusionar sobre los mismos datos no duplica nada', async () => {
    await seed();
    const before = await snapshot();
    const { blob } = await exportBackup();
    const r = await restoreMerge(parseBackup(await bytesOf(blob)));
    expect(await snapshot()).toEqual(before);
    expect(r.skipped.documents).toBe(1);
    expect(r.added.questions ?? 0).toBe(0);
  });

  it('fusionar en una base con otros datos conserva ambos y remapea ids', async () => {
    await seed();
    const original = await snapshot();
    const { blob } = await exportBackup();
    await clearAll();
    await setSetting('penalty', 0); // ajuste local: debe prevalecer
    await importPdf(new File(['pdf-B'], 'b.pdf'), {}, undefined, async () => ({ pages: OTHER }));
    await restoreMerge(parseBackup(await bytesOf(blob)));

    expect(await db.documents.count()).toBe(2);
    expect(await db.questions.count()).toBe(original.questions);
    expect(await db.attempts.count()).toBe(original.attempts);
    expect((await db.settings.get('penalty'))?.value).toBe(0);
    // Integridad referencial tras el remapeo.
    const qs = await db.questions.toArray();
    for (const q of qs) {
      const s = await db.sections.get(q.sectionId!);
      expect(s?.documentId).toBe(q.documentId);
    }
    const doc = await db.documents.filter((d) => d.fileName === 'a.pdf').first();
    expect((await db.temas.get(doc!.temaId!))?.name).toBe('Tema 1');
    const exam = (await db.exams.toArray())[0];
    expect(exam.config.documentIds).toEqual([doc!.id]);
    for (const a of await db.attempts.toArray()) expect(await db.questions.get(a.questionId)).toBeDefined();
    for (const r of await db.reviews.toArray()) expect(await db.questions.get(r.questionId)).toBeDefined();
    const apartados = (await db.sections.where('documentId').equals(doc!.id!).toArray()).filter((s) => s.kind === 'apartado');
    for (const s of apartados) expect((await db.sections.get(s.parentId!))?.documentId).toBe(doc!.id);
  });

  it('rechaza archivos que no son copias válidas', () => {
    expect(() => parseBackup(new Uint8Array([1, 2, 3]))).toThrow(/ZIP válido/);
    expect(() => parseBackup(zipSync({ 'a.txt': strToU8('x') }))).toThrow(/manifest/);
    const future = zipSync({ 'manifest.json': strToU8(JSON.stringify({ app: 'opositest', format: 99 })) });
    expect(() => parseBackup(future)).toThrow(/más reciente/);
  });
});
