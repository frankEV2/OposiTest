/**
 * Simula dos dispositivos (A = ordenador, B = móvil) que comparten un almacenamiento remoto.
 * Como la base de datos es única en las pruebas, "cambiar de dispositivo" = guardar su estado
 * con exportBackup y restaurarlo con restoreReplace.
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { exportBackup, parseBackup, restoreReplace } from '../backup/backup';
import { db } from '../db/db';
import { addMateria, addOposicion, addTema, rename } from '../db/taxonomy';
import { generateForDocuments, saveQuestion } from '../engine/store';
import { createExam, finishExam, setAnswer } from '../exam/service';
import { deleteDocument, importPdf } from '../library/service';
import { docKey, qKey } from './keys';
import { MemoryRemote } from './remote';
import { STATE_FILE, syncNow } from './sync';

// Texto de prueba (no es una norma real). El extractor falso devuelve este texto para cualquier PDF.
const PAGES = [`Artículo 1. Plazos.
1. El plazo para resolver será de tres meses desde la solicitud.
2. Las alegaciones se presentarán en el plazo de diez días hábiles desde la notificación.
Artículo 2. Recursos.
El recurso podrá interponerse en el plazo de un mes desde la notificación.
Artículo 3. Subsanación.
La subsanación se hará en el plazo de quince días hábiles desde el requerimiento.`];
const extract = async () => ({ pages: PAGES });

const clearAll = () => Promise.all(db.tables.map((t) => t.clear()));
type Device = Blob | null;
const save = async (): Promise<Device> => (await exportBackup()).blob;
async function load(d: Device) {
  await clearAll();
  if (d) await restoreReplace(parseBackup(new Uint8Array(await d.arrayBuffer())));
}

beforeEach(clearAll);

describe('sincronización entre dispositivos', () => {
  it('lleva documentos, preguntas, exámenes, repasos y clasificación de A a B y propaga cambios y borrados', async () => {
    const remote = new MemoryRemote();

    // --- A: crea contenido y sincroniza.
    const o = await addOposicion('Auxiliar');
    const m = await addMateria(o, 'Derecho');
    const t = await addTema(m, 'Tema 1');
    const docA = await importPdf(new File(['pdf-A'], 'ley.pdf'), { oposicionId: o, materiaId: m, temaId: t }, undefined, extract);
    await generateForDocuments([docA]);
    const nQuestions = await db.questions.count();
    const exam = await createExam({
      mode: 'estudio', count: 10, documentIds: [docA], temaIds: [], sectionIds: [], difficulties: [], pool: 'all',
      shuffle: false, penalty: 0, includePending: true,
    });
    await setAnswer(exam, 0, 3); // fallo → entra en repaso
    await finishExam(exam);
    const r1 = await syncNow(remote, extract);
    expect(r1.uploadedPdfs).toBe(1);
    expect(remote.files.has(STATE_FILE)).toBe(true);
    let A = await save();

    // --- B (vacío): sincroniza y recibe todo.
    await load(null);
    const r2 = await syncNow(remote, extract);
    expect(r2.added.documentos).toBe(1);
    expect(await db.questions.count()).toBe(nQuestions);
    expect(await db.exams.count()).toBe(1);
    expect(await db.attempts.count()).toBe(nQuestions);
    expect(await db.reviews.count()).toBe(nQuestions - 1);
    const docB = (await db.documents.toArray())[0];
    expect((await db.temas.get(docB.temaId!))?.name).toBe('Tema 1');
    expect(new TextDecoder().decode(await (await db.documentFiles.get(docB.id!))!.blob.arrayBuffer())).toBe('pdf-A');
    for (const q of await db.questions.toArray()) {
      if (q.sectionId !== undefined) expect((await db.sections.get(q.sectionId))?.documentId).toBe(docB.id);
    }

    // B: valida una pregunta, edita otra (cambia su hash), borra una tercera y renombra el tema.
    const [q1, q2, q3] = (await db.questions.toArray()).sort((a, b) => a.hash.localeCompare(b.hash));
    await new Promise((r) => setTimeout(r, 5)); // asegura updatedAt posterior
    await db.questions.update(q1.id!, { status: 'validated', updatedAt: Date.now() });
    await saveQuestion({ ...q2, stem: `${q2.stem} (editada)` }, q2.id);
    await db.questions.delete(q3.id!);
    await db.deletions.put({ key: `q:${qKey(q3)}`, deletedAt: Date.now() });
    await rename('temas', docB.temaId!, 'Tema 1 bis');
    await syncNow(remote, extract);
    let B = await save();

    // --- A: recibe los cambios de B.
    await load(A);
    await syncNow(remote, extract);
    const qs = new Map((await db.questions.toArray()).map((q) => [qKey(q), q]));
    expect(qs.get(qKey(q1))?.status).toBe('validated');
    expect(qs.get(qKey(q2))?.stem).toContain('(editada)');
    expect(qs.has(qKey(q3))).toBe(false);
    expect(await db.questions.count()).toBe(nQuestions - 1);
    const docA2 = (await db.documents.toArray())[0];
    expect((await db.temas.get(docA2.temaId!))?.name).toBe('Tema 1 bis');
    expect(await db.temas.filter((x) => x.name === 'Tema 1').count()).toBe(0);
    expect(await db.exams.count()).toBe(1); // no se duplica

    // A: borra el documento y sincroniza.
    await deleteDocument(docA2.id!);
    await syncNow(remote, extract);
    A = await save();

    // --- B: recibe el borrado.
    await load(B);
    await syncNow(remote, extract);
    expect(await db.documents.count()).toBe(0);
    expect(await db.questions.count()).toBe(0);
    expect(await db.reviews.count()).toBe(0);
    expect(await db.exams.count()).toBe(1); // el historial se conserva
    B = await save();
    void A; void B;
  });

  it('el mismo PDF importado en los dos dispositivos se reconoce como uno solo', async () => {
    const remote = new MemoryRemote();
    await importPdf(new File(['mismo'], 'a.pdf'), {}, undefined, extract);
    await syncNow(remote, extract);
    await load(null);
    await importPdf(new File(['mismo'], 'b.pdf'), {}, undefined, extract);
    await db.documents.toCollection().modify({ uid: 'otra-clave' });
    await syncNow(remote, extract);
    expect(await db.documents.count()).toBe(1);
    const d = (await db.documents.toArray())[0];
    expect(docKey(d)).toBe([d.sha256, 'otra-clave'].sort()[0]);
  });

  it('informa de los documentos cuyo PDF no está en remoto sin romper el resto', async () => {
    const remote = new MemoryRemote();
    await importPdf(new File(['pdf-X'], 'x.pdf'), {}, undefined, extract);
    await syncNow(remote, extract);
    for (const k of [...remote.files.keys()]) if (k.startsWith('pdf-')) remote.files.delete(k);
    await load(null);
    const r = await syncNow(remote, extract);
    expect(r.failed).toHaveLength(1);
    expect(await db.documents.count()).toBe(0);
  });
});
