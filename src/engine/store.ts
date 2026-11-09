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
  /** Artículos/apartados con texto analizados. */
  units: number;
  /** Explicación cuando no sale ninguna pregunta nueva. */
  hint?: string;
}

const CATALAN = /\b(?:Article|Títol|Capítol|Disposició|aquesta|els|dels|amb|perquè)\b/u;

/** Motivo legible de que un documento no haya dado preguntas. */
function explain(doc: { extraction: string; warnings: string[]; pageCount: number }, units: Unit[], drafts: number, duplicates: number): string | undefined {
  if (drafts > 0 && duplicates < drafts) return undefined;
  if (duplicates > 0) return 'Todas las preguntas que se pueden generar ya estaban en el banco.';
  const scanned = doc.warnings.find((w) => /sin texto extraíble|escaneado/.test(w));
  if (doc.extraction === 'scanned') {
    return 'El PDF es una imagen escaneada: no tiene texto que analizar. Usa la versión con texto (p. ej. el PDF del BOE) o pásalo por un programa de OCR.';
  }
  if (!units.length) {
    return `No se han detectado artículos en el documento${scanned ? ` y hay páginas escaneadas sin texto (${scanned.match(/\(([\d,\s…]+)\)/)?.[1] ?? ''})` : ''}. ` +
      'El generador trabaja sobre artículos («Artículo 1.», «Article 1»…). Si es un temario o apuntes sin artículos, todavía no se pueden generar preguntas de él.';
  }
  const sample = units.map((u) => u.text).join(' ').slice(0, 5000);
  const lang = CATALAN.test(sample)
    ? ' El texto está en catalán y las reglas de preguntas solo reconocen expresiones en castellano (plazo, corresponde, deberá…): usa la versión en castellano de la norma.'
    : '';
  return `Se analizaron ${units.length} artículos/apartados, pero no contienen plazos, definiciones, enumeraciones, competencias ni otras expresiones que el generador reconozca con suficientes alternativas reales.${lang}` +
    (scanned ? ` Además, hay páginas escaneadas sin texto (${scanned.match(/\(([\d,\s…]+)\)/)?.[1] ?? ''}).` : '');
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
      ...d, uid: d.hash, temaId: doc.temaId, status: 'pending', createdAt: now, updatedAt: now,
    }));
    if (fresh.length) await db.questions.bulkAdd(fresh);
    reports.push({
      documentId: id, title: doc.title, added: fresh.length,
      duplicates: drafts.length - fresh.length, discarded: own.discarded, units: units.length,
      hint: explain(doc, units, drafts.length, drafts.length - fresh.length),
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
    const before = await db.questions.get(id);
    // uid estable: al editar el enunciado cambia el hash, pero sigue siendo la misma pregunta al sincronizar.
    await db.questions.update(id, { ...input, uid: before?.uid ?? before?.hash, hash: h, status: 'validated', updatedAt: now });
    return id;
  }
  return (await db.questions.add({
    ...input, hash: h, uid: h, status: 'validated', rule: 'manual', createdAt: now, updatedAt: now,
  })) as ID;
}
