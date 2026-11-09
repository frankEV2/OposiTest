import { db } from '../db/db';
import type { ID, Question, Section } from '../db/types';
import { buildPools, generate, validateDraft, type Pools, type Unit } from './generate';
import { hash, norm } from './text';

/** Convierte las secciones en unidades de pregunta: apartados si existen, si no el artículo entero. */
export function unitsFromSections(sections: Section[]): Unit[] {
  const hasChildren = new Set(sections.filter((s) => s.kind === 'apartado').map((s) => s.parentId));
  return sections
    .filter((s) => (s.kind === 'apartado') || ((s.kind === 'articulo' || s.kind === 'disposicion') && !hasChildren.has(s.id)))
    .filter((s) => s.text.trim().length > 0)
    .map((s) => ({ sectionId: s.id!, documentId: s.documentId, label: s.label, heading: s.heading, text: s.text }));
}

export interface DocReport {
  documentId: ID;
  title: string;
  added: number;
  duplicates: number;
  discarded: Record<string, number>;
}

/**
 * Genera y guarda preguntas de los documentos indicados. Los distractores se toman
 * primero del mismo documento y, si no bastan, del resto de la biblioteca.
 * Las preguntas ya existentes (mismo hash, incluidas las rechazadas) no se duplican.
 */
export async function generateForDocuments(documentIds: ID[]): Promise<DocReport[]> {
  const allSections = await db.sections.toArray();
  const libraryUnits = unitsFromSections(allSections);
  const reports: DocReport[] = [];
  let libraryPools: Pools | undefined; // se construye una sola vez y solo si hace falta

  for (const id of documentIds) {
    const doc = await db.documents.get(id);
    if (!doc) continue;
    const units = libraryUnits.filter((u) => u.documentId === id);
    const own = generate(units, doc.title, units);
    // Segunda pasada con el corpus completo para recuperar descartes por falta de alternativas.
    if (libraryUnits.length > units.length) libraryPools ??= buildPools(libraryUnits);
    const wide = libraryUnits.length > units.length ? generate(units, doc.title, libraryPools!) : null;
    const byHash = new Map(own.drafts.map((d) => [d.hash, d]));
    const ownSections = new Set(own.drafts.map((d) => `${d.sectionId}|${d.rule}`));
    for (const d of wide?.drafts ?? []) {
      if (!byHash.has(d.hash) && !ownSections.has(`${d.sectionId}|${d.rule}`)) byHash.set(d.hash, d);
    }
    const drafts = [...byHash.values()];
    const existing = new Set(
      (await db.questions.where('hash').anyOf(drafts.map((d) => d.hash)).toArray()).map((q) => q.hash),
    );
    const now = Date.now();
    const fresh = drafts.filter((d) => !existing.has(d.hash)).map((d): Question => ({
      ...d, temaId: doc.temaId, status: 'pending', createdAt: now, updatedAt: now,
    }));
    if (fresh.length) await db.questions.bulkAdd(fresh);
    reports.push({
      documentId: id, title: doc.title, added: fresh.length,
      duplicates: drafts.length - fresh.length, discarded: own.discarded,
    });
  }
  return reports;
}

export type QuestionInput = Pick<Question, 'stem' | 'options' | 'correctIndex' | 'explanation' | 'reference' |
  'difficulty' | 'documentId' | 'sectionId' | 'temaId' | 'sourceExcerpt'>;

/** Crea o edita una pregunta manualmente; valida y evita duplicados. */
export async function saveQuestion(input: QuestionInput, id?: ID): Promise<ID> {
  const why = validateDraft(input);
  if (why) throw new Error(`Pregunta no válida: ${why}`);
  const h = hash(`${norm(input.stem)}|${norm(input.options[input.correctIndex])}`);
  const dup = await db.questions.where('hash').equals(h).first();
  if (dup && dup.id !== id) throw new Error('Ya existe una pregunta igual en el banco.');
  const now = Date.now();
  if (id) {
    await db.questions.update(id, { ...input, hash: h, status: 'validated', updatedAt: now });
    return id;
  }
  return (await db.questions.add({
    ...input, hash: h, status: 'validated', rule: 'manual', createdAt: now, updatedAt: now,
  })) as ID;
}
