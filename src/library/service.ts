import { db } from '../db/db';
import type { DocumentMeta, ID } from '../db/types';
import { assessQuality, normalizeText, stripRepeatedLines } from '../pdf/clean';
import { parseStructure } from '../pdf/structure';

export async function sha256(buf: ArrayBuffer): Promise<string> {
  const h = await crypto.subtle.digest('SHA-256', buf);
  return [...new Uint8Array(h)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export interface Classification {
  oposicionId?: ID;
  materiaId?: ID;
  temaId?: ID;
}

/** Resultado de procesar un PDF, independiente de PDF.js para poder testearlo. */
export interface ProcessedPdf {
  pages: string[];
  extraction: DocumentMeta['extraction'];
  warnings: string[];
  sections: ReturnType<typeof parseStructure>;
}

export function processPages(rawPages: string[]): ProcessedPdf {
  const pages = stripRepeatedLines(rawPages.map(normalizeText));
  const q = assessQuality(pages);
  const sections = q.status === 'scanned' ? [] : parseStructure(pages);
  const warnings = [...q.warnings];
  if (q.status !== 'scanned' && !sections.some((s) => s.kind === 'articulo')) {
    warnings.push('No se han detectado artículos. El texto puede consultarse y buscarse, ' +
      'pero la generación de preguntas por artículo será limitada.');
  }
  return { pages, extraction: q.status, warnings, sections };
}

type Extractor = (buf: ArrayBuffer, onProgress?: (p: number, t: number) => void) =>
  Promise<{ pages: string[]; title?: string }>;

async function defaultExtractor(): Promise<Extractor> {
  return (await import('../pdf/extract')).extractPdfPages;
}

export class DuplicateError extends Error {
  constructor(public existing: DocumentMeta) {
    super(`Este PDF ya está en la biblioteca como «${existing.title}».`);
  }
}

/** Guarda páginas y secciones de un documento (reemplazando las anteriores). */
async function storeContent(documentId: ID, p: ProcessedPdf) {
  await db.pages.where('documentId').equals(documentId).delete();
  await db.sections.where('documentId').equals(documentId).delete();
  await db.pages.bulkAdd(p.pages.map((text, i) => ({ documentId, page: i + 1, text })));
  const ids = (await db.sections.bulkAdd(
    p.sections.map((s, order) => ({
      documentId, kind: s.kind, label: s.label, heading: s.heading, text: s.text,
      order, pageStart: s.pageStart,
    })),
    { allKeys: true },
  )) as ID[];
  const updates = p.sections
    .map((s, i) => (s.parent === undefined ? null : { key: ids[i], changes: { parentId: ids[s.parent] } }))
    .filter((u): u is { key: ID; changes: { parentId: ID } } => u !== null);
  if (updates.length) await db.sections.bulkUpdate(updates);
}

export async function importPdf(
  file: File,
  cls: Classification,
  onProgress?: (p: number, t: number) => void,
  extract?: Extractor,
): Promise<ID> {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  const existing = await db.documents.where('sha256').equals(hash).first();
  if (existing) throw new DuplicateError(existing);

  const { pages, title } = await (extract ?? (await defaultExtractor()))(buf, onProgress);
  const p = processPages(pages);
  const now = Date.now();
  return db.transaction('rw', [db.documents, db.documentFiles, db.pages, db.sections], async () => {
    const id = (await db.documents.add({
      title: title || file.name.replace(/\.pdf$/i, ''),
      fileName: file.name, size: file.size, sha256: hash, pageCount: pages.length,
      ...cls, extraction: p.extraction, warnings: p.warnings, importedAt: now, updatedAt: now,
    })) as ID;
    await db.documentFiles.put({ documentId: id, blob: new Blob([buf], { type: 'application/pdf' }) });
    await storeContent(id, p);
    return id;
  });
}

/**
 * Sustituye el PDF de un documento manteniendo id, título y clasificación.
 * Las preguntas ya generadas pierden su vínculo con el artículo y vuelven a "pendiente"
 * para revisarlas contra la nueva versión.
 */
export async function replacePdf(
  documentId: ID,
  file: File,
  onProgress?: (p: number, t: number) => void,
  extract?: Extractor,
): Promise<void> {
  const buf = await file.arrayBuffer();
  const hash = await sha256(buf);
  const dup = await db.documents.where('sha256').equals(hash).first();
  if (dup && dup.id !== documentId) throw new DuplicateError(dup);
  const { pages } = await (extract ?? (await defaultExtractor()))(buf, onProgress);
  const p = processPages(pages);
  await db.transaction('rw', [db.documents, db.documentFiles, db.pages, db.sections, db.questions], async () => {
    await db.documents.update(documentId, {
      fileName: file.name, size: file.size, sha256: hash, pageCount: pages.length,
      extraction: p.extraction, warnings: p.warnings, updatedAt: Date.now(),
    });
    await db.documentFiles.put({ documentId, blob: new Blob([buf], { type: 'application/pdf' }) });
    await storeContent(documentId, p);
    await db.questions.where('documentId').equals(documentId)
      .modify({ sectionId: undefined, status: 'pending', updatedAt: Date.now() });
  });
}

/** Elimina el documento con su contenido, preguntas generadas, repasos y materiales. */
export async function deleteDocument(documentId: ID): Promise<void> {
  await db.transaction('rw',
    [db.documents, db.documentFiles, db.pages, db.sections, db.questions, db.reviews, db.materials],
    async () => {
      const qids = (await db.questions.where('documentId').equals(documentId).primaryKeys()) as ID[];
      await db.reviews.bulkDelete(qids);
      await db.questions.bulkDelete(qids);
      await db.materials.where('documentId').equals(documentId).delete();
      await db.sections.where('documentId').equals(documentId).delete();
      await db.pages.where('documentId').equals(documentId).delete();
      await db.documentFiles.delete(documentId);
      await db.documents.delete(documentId);
    });
}
