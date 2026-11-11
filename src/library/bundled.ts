import { db } from '../db/db';
import { ensureTax, resolveCls } from '../sync/snapshot';
import { deleteDocument, importPdf, replacePdf } from './service';

/** Entrada de `public/temario/index.json` (generado por scripts/temario-index.mjs). */
export interface BundledEntry {
  /** Ruta relativa dentro de temario/, p. ej. "Auxiliar/Normativa/ley-39-2015.md". */
  file: string;
  sha256: string;
  size: number;
  /** Clasificación deducida de las carpetas: Oposición / Materia / Tema. */
  tax: { opo?: string; mat?: string; tema?: string };
}

const BASE = 'temario/';
let running: Promise<number> | null = null;

/**
 * Incorpora a la base de datos local los documentos Markdown incluidos en la app.
 * Solo descarga los que faltan o han cambiado (comparando SHA-256), uno a uno;
 * una vez importados quedan en IndexedDB y no se vuelven a procesar.
 * Respeta los documentos que el usuario haya eliminado.
 */
export function loadBundled(onProgress?: (done: number, total: number, name: string) => void): Promise<number> {
  running ??= run(onProgress).finally(() => { running = null; });
  return running;
}

/**
 * Vuelve a incorporar los documentos del temario integrado que el usuario eliminó
 * (borra su marca de eliminación y regenera su banco de preguntas). Devuelve cuántos se restauran.
 */
export async function restoreBundled(): Promise<number> {
  const r = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error('No se pudo leer el índice del temario.');
  const list: BundledEntry[] = await r.json();
  const have = new Set((await db.documents.toArray()).map((d) => d.sha256));
  const missing = list.filter((e) => !have.has(e.sha256));
  await db.deletions.bulkDelete(missing.map((e) => `doc:${e.sha256}`));
  const bank = ((await db.settings.get('bundledBank'))?.value as string[] | undefined) ?? [];
  const gone = new Set(missing.map((e) => e.sha256));
  await db.settings.put({ key: 'bundledBank', value: bank.filter((s) => !gone.has(s)) });
  await loadBundled();
  return missing.length;
}

async function run(onProgress?: (done: number, total: number, name: string) => void): Promise<number> {
  let list: BundledEntry[];
  try {
    const r = await fetch(`${BASE}index.json`, { cache: 'no-cache' });
    if (!r.ok) return 0;
    list = await r.json();
  } catch {
    return 0;
  }
  // Documentos integrados que ya no están en el temario (su fileName es una ruta de temario/): se retiran.
  const files = new Set(list.map((e) => e.file));
  for (const d of await db.documents.toArray()) {
    if (d.fileName.includes('/') && /\.(md|markdown)$/i.test(d.fileName) && !files.has(d.fileName)) await deleteDocument(d.id!);
  }
  const docs = await db.documents.toArray();
  const bySha = new Set(docs.map((d) => d.sha256));
  const byFile = new Map(docs.map((d) => [d.fileName, d]));
  const pending = [];
  for (const e of list) {
    if (bySha.has(e.sha256)) continue;
    if (!byFile.has(e.file) && (await db.deletions.get(`doc:${e.sha256}`))) continue;
    pending.push(e);
  }
  let n = 0;
  for (const [i, e] of pending.entries()) {
    onProgress?.(i, pending.length, e.file);
    try {
      const res = await fetch(BASE + e.file.split('/').map(encodeURIComponent).join('/'));
      if (!res.ok) continue;
      const file = new File([await res.arrayBuffer()], e.file, { type: 'text/markdown' });
      const old = byFile.get(e.file);
      if (old) {
        await replacePdf(old.id!, file);
      } else {
        const { opo, mat, tema } = e.tax;
        if (opo) await ensureTax({ opo, mat, tema }, 0, Date.now());
        await importPdf(file, opo ? await resolveCls({ opo, mat, tema }) : {});
      }
      n++;
    } catch (err) {
      console.warn('No se pudo cargar', e.file, err);
    }
  }
  // Banco de preguntas listo sin pasos manuales: se genera en local y queda guardado en IndexedDB.
  // Se hace una sola vez por versión del documento (clave = SHA-256), aunque la carga se interrumpiera antes.
  const { ENGINE_VERSION } = await import('../engine/generate');
  let bank = new Set(((await db.settings.get('bundledBank'))?.value as string[] | undefined) ?? []);
  if ((await db.settings.get('bundledBankVersion'))?.value !== ENGINE_VERSION) {
    // Motor nuevo: se sustituyen las preguntas automáticas sin revisar del temario integrado
    // (las validadas, editadas, manuales y rechazadas se conservan; el historial de exámenes también).
    const ids = (await db.documents.toArray()).filter((d) => files.has(d.fileName)).map((d) => d.id!);
    const old = (await db.questions.where('documentId').anyOf(ids).toArray())
      .filter((q) => q.status === 'pending' && q.rule !== 'manual').map((q) => q.id!);
    await db.reviews.where('questionId').anyOf(old).delete();
    await db.questions.bulkDelete(old);
    bank = new Set();
    await db.settings.put({ key: 'bundledBankVersion', value: ENGINE_VERSION });
  }
  const todo = (await db.documents.toArray()).filter((d) => files.has(d.fileName) && !bank.has(d.sha256));
  if (todo.length) {
    const { generateForDocuments } = await import('../engine/store');
    await generateForDocuments(todo.map((d) => d.id!));
    todo.forEach((d) => bank.add(d.sha256));
    await db.settings.put({ key: 'bundledBank', value: [...bank] });
  }
  onProgress?.(pending.length, pending.length, '');
  return n;
}
