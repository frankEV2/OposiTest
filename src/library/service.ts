import { db } from '../db/db';
import type { DocumentMeta, ID } from '../db/types';
import { assessQuality, normalizeText, stripRepeatedLines } from '../pdf/clean';
import { parseStructure } from '../pdf/structure';
import { docKey, qKey, recordDeletions } from '../sync/keys';
import { isMarkdownName, parseMarkdown } from './markdown';

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

export function processPages(
  rawPages: string[],
  opts: { markdown?: boolean; fallback?: ReturnType<typeof parseStructure> } = {},
): ProcessedPdf {
  const norm = rawPages.map(normalizeText);
  const pages = opts.markdown ? norm : stripRepeatedLines(norm);
  const q = assessQuality(pages);
  let sections = q.status === 'scanned' ? [] : parseStructure(pages);
  // Temarios en Markdown sin artículos: la estructura sale de los encabezados.
  if (!sections.some((s) => s.kind === 'articulo') && opts.fallback?.some((s) => s.kind === 'articulo')) {
    sections = opts.fallback;
  }
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

/** Extrae y procesa un PDF o un Markdown (.md/.txt) según la extensión. */
async function processFile(file: File, buf: ArrayBuffer, onProgress?: (p: number, t: number) => void, extract?: Extractor) {
  if (isMarkdownName(file.name)) {
    const md = parseMarkdown(new TextDecoder('utf-8').decode(buf));
    return {
      p: processPages(md.pages, { markdown: true, fallback: md.headingSections }),
      title: md.title, type: 'text/markdown',
    };
  }
  const { pages, title } = await (extract ?? (await defaultExtractor()))(buf, onProgress);
  return { p: processPages(pages), title, type: 'application/pdf' };
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

  const { p, title, type } = await processFile(file, buf, onProgress, extract);
  const pages = p.pages;
  const now = Date.now();
  return db.transaction('rw', [db.documents, db.documentFiles, db.pages, db.sections], async () => {
    const id = (await db.documents.add({
      title: title || file.name.replace(/\.(pdf|md|markdown|txt)$/i, ''),
      fileName: file.name, size: file.size, sha256: hash, uid: hash, pageCount: pages.length,
      ...cls, extraction: p.extraction, warnings: p.warnings, importedAt: now, updatedAt: now,
    })) as ID;
    await db.documentFiles.put({ documentId: id, blob: new Blob([buf], { type }) });
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
  const { p, type } = await processFile(file, buf, onProgress, extract);
  const pages = p.pages;
  const before = await db.documents.get(documentId);
  await db.transaction('rw', [db.documents, db.documentFiles, db.pages, db.sections, db.questions], async () => {
    await db.documents.update(documentId, {
      // El uid no cambia: en otros dispositivos se reconoce como el mismo documento con un PDF nuevo.
      uid: before ? docKey(before) : hash,
      fileName: file.name, size: file.size, sha256: hash, pageCount: pages.length,
      extraction: p.extraction, warnings: p.warnings, updatedAt: Date.now(),
    });
    await db.documentFiles.put({ documentId, blob: new Blob([buf], { type }) });
    await storeContent(documentId, p);
    await db.questions.where('documentId').equals(documentId)
      .modify({ sectionId: undefined, status: 'pending', updatedAt: Date.now() });
  });
}

/** Elimina el documento con su contenido, preguntas generadas, repasos y materiales. */
export async function deleteDocument(documentId: ID): Promise<void> {
  await db.transaction('rw',
    [db.documents, db.documentFiles, db.pages, db.sections, db.questions, db.reviews, db.materials, db.deletions],
    async () => {
      const doc = await db.documents.get(documentId);
      const qs = await db.questions.where('documentId').equals(documentId).toArray();
      // Se anotan los borrados para que la sincronización los aplique en los demás dispositivos.
      await recordDeletions([...(doc ? [`doc:${docKey(doc)}`] : []), ...qs.map((q) => `q:${qKey(q)}`)]);
      const qids = qs.map((q) => q.id!);
      await db.reviews.bulkDelete(qids);
      await db.questions.bulkDelete(qids);
      await deleteDocumentContent(documentId);
    });
}

/**
 * Borra solo el documento y su contenido (PDF, páginas, secciones, materiales), sin tocar preguntas
 * ni anotar borrados. Lo usa la sincronización al recibir el borrado de un documento.
 */
export async function deleteDocumentContent(documentId: ID): Promise<void> {
  await db.transaction('rw', [db.documents, db.documentFiles, db.pages, db.sections, db.materials], async () => {
    await db.materials.where('documentId').equals(documentId).delete();
    await db.sections.where('documentId').equals(documentId).delete();
    await db.pages.where('documentId').equals(documentId).delete();
    await db.documentFiles.delete(documentId);
    await db.documents.delete(documentId);
  });
}
