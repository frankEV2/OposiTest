/**
 * Copias de seguridad completas en ZIP:
 *   manifest.json            { app, format, schemaVersion, exportedAt, counts }
 *   data/<tabla>.json        filas de cada tabla (sin blobs)
 *   pdf/<documentId>.pdf     ficheros originales
 *
 * Restauración:
 *   - 'merge' (por defecto): añade lo nuevo sin tocar lo existente. Deduplica documentos por SHA-256,
 *     preguntas por hash, taxonomía por nombre y exámenes por fecha+preguntas; remapea todos los ids.
 *   - 'replace': borra todo y restaura la copia tal cual (la UI exporta antes una copia automática).
 */
import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { db } from '../db/db';
import type {
  Attempt, Deletion, DocumentMeta, DocumentPage, Exam, ID, Materia, Oposicion, Question, ReviewItem, Section, Setting,
  StudyMaterial, StudySession, Tema,
} from '../db/types';

export const BACKUP_FORMAT = 1;
const DATA_TABLES = [
  'oposiciones', 'materias', 'temas', 'documents', 'pages', 'sections', 'questions',
  'exams', 'attempts', 'reviews', 'materials', 'sessions', 'settings', 'deletions',
] as const;
type DataTable = (typeof DATA_TABLES)[number];

export interface BackupData {
  oposiciones: Oposicion[];
  materias: Materia[];
  temas: Tema[];
  documents: DocumentMeta[];
  pages: DocumentPage[];
  sections: Section[];
  questions: Question[];
  exams: Exam[];
  attempts: Attempt[];
  reviews: ReviewItem[];
  materials: StudyMaterial[];
  sessions: StudySession[];
  settings: Setting[];
  deletions: Deletion[];
}

export interface Manifest {
  app: 'opositest';
  format: number;
  schemaVersion: number;
  exportedAt: number;
  counts: Record<string, number>;
}

export interface ParsedBackup {
  manifest: Manifest;
  data: BackupData;
  files: Map<ID, Uint8Array>;
}

export async function exportBackup(): Promise<{ blob: Blob; name: string; manifest: Manifest }> {
  const zip: Zippable = {};
  const counts: Record<string, number> = {};
  const data = {} as Record<DataTable, unknown[]>;
  await db.transaction('r', DATA_TABLES.map((t) => db[t]), async () => {
    for (const t of DATA_TABLES) data[t] = await db[t].toArray();
  });
  for (const t of DATA_TABLES) {
    counts[t] = data[t].length;
    zip[`data/${t}.json`] = [strToU8(JSON.stringify(data[t])), { level: 6 }];
  }
  const files = await db.documentFiles.toArray();
  for (const f of files) {
    zip[`pdf/${f.documentId}.pdf`] = [new Uint8Array(await f.blob.arrayBuffer()), { level: 0 }];
  }
  counts.pdf = files.length;
  const manifest: Manifest = { app: 'opositest', format: BACKUP_FORMAT, schemaVersion: db.verno, exportedAt: Date.now(), counts };
  zip['manifest.json'] = strToU8(JSON.stringify(manifest, null, 2));
  const bytes = zipSync(zip);
  await db.settings.put({ key: 'lastBackupAt', value: manifest.exportedAt });
  const d = new Date(manifest.exportedAt);
  const stamp = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  return { blob: new Blob([bytes as BlobPart], { type: 'application/zip' }), name: `opositest-copia-${stamp}.zip`, manifest };
}

export function parseBackup(bytes: Uint8Array): ParsedBackup {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch {
    throw new Error('El archivo no es un ZIP válido.');
  }
  const raw = entries['manifest.json'];
  if (!raw) throw new Error('El ZIP no es una copia de OposiTest (falta manifest.json).');
  const manifest = JSON.parse(strFromU8(raw)) as Manifest;
  if (manifest.app !== 'opositest') throw new Error('El ZIP no es una copia de OposiTest.');
  if (manifest.format > BACKUP_FORMAT) throw new Error('La copia procede de una versión más reciente de la aplicación.');
  const data = {} as Record<DataTable, unknown[]>;
  for (const t of DATA_TABLES) {
    const e = entries[`data/${t}.json`];
    data[t] = e ? (JSON.parse(strFromU8(e)) as unknown[]) : [];
    if (!Array.isArray(data[t])) throw new Error(`Datos dañados en ${t}.json`);
  }
  const files = new Map<ID, Uint8Array>();
  for (const [name, content] of Object.entries(entries)) {
    const m = name.match(/^pdf\/(\d+)\.pdf$/);
    if (m) files.set(Number(m[1]), content);
  }
  return { manifest, data: data as unknown as BackupData, files };
}

export interface RestoreReport {
  added: Record<string, number>;
  skipped: Record<string, number>;
}

const pdfBlob = (b?: Uint8Array) => (b ? new Blob([b as BlobPart], { type: 'application/pdf' }) : undefined);
const ALL_TABLES = () => [...DATA_TABLES.map((t) => db[t]), db.documentFiles];

/** Borra todo y restaura la copia con sus ids originales. */
export async function restoreReplace(p: ParsedBackup): Promise<RestoreReport> {
  const added: Record<string, number> = {};
  await db.transaction('rw', ALL_TABLES(), async () => {
    for (const t of [...DATA_TABLES, 'documentFiles' as const]) await db[t].clear();
    for (const t of DATA_TABLES) {
      await (db[t] as unknown as { bulkPut(x: unknown[]): Promise<unknown> }).bulkPut(p.data[t]);
      added[t] = p.data[t].length;
    }
    for (const d of p.data.documents) {
      const blob = pdfBlob(p.files.get(d.id!));
      if (blob) await db.documentFiles.put({ documentId: d.id!, blob });
    }
  });
  return { added, skipped: {} };
}

/** Fusiona la copia con los datos actuales sin modificar ni borrar nada existente. */
export async function restoreMerge(p: ParsedBackup): Promise<RestoreReport> {
  const added: Record<string, number> = {};
  const skipped: Record<string, number> = {};
  const inc = (r: Record<string, number>, k: string) => { r[k] = (r[k] ?? 0) + 1; };
  const strip = <T extends { id?: ID }>(x: T): T => { const { id: _id, ...rest } = x; return rest as T; };

  await db.transaction('rw', ALL_TABLES(), async () => {
    const opo = new Map<ID, ID>();
    for (const o of p.data.oposiciones) {
      const ex = await db.oposiciones.where('name').equals(o.name).first();
      if (ex) { opo.set(o.id!, ex.id!); inc(skipped, 'oposiciones'); } else { opo.set(o.id!, (await db.oposiciones.add(strip(o))) as ID); inc(added, 'oposiciones'); }
    }
    const mat = new Map<ID, ID>();
    for (const m of p.data.materias) {
      const oid = opo.get(m.oposicionId);
      if (oid === undefined) continue;
      const ex = await db.materias.where('[oposicionId+name]').equals([oid, m.name]).first();
      if (ex) { mat.set(m.id!, ex.id!); inc(skipped, 'materias'); } else { mat.set(m.id!, (await db.materias.add({ ...strip(m), oposicionId: oid })) as ID); inc(added, 'materias'); }
    }
    const tem = new Map<ID, ID>();
    for (const t of p.data.temas) {
      const mid = mat.get(t.materiaId);
      if (mid === undefined) continue;
      const ex = await db.temas.where('[materiaId+name]').equals([mid, t.name]).first();
      if (ex) { tem.set(t.id!, ex.id!); inc(skipped, 'temas'); } else { tem.set(t.id!, (await db.temas.add({ ...strip(t), materiaId: mid })) as ID); inc(added, 'temas'); }
    }
    const opt = (m: Map<ID, ID>, v?: ID) => (v === undefined ? undefined : m.get(v));

    // Documentos y su contenido. Si ya existe (mismo SHA-256), sus secciones se emparejan por orden.
    const doc = new Map<ID, ID>();
    const sec = new Map<ID, ID>();
    for (const d of p.data.documents) {
      const ex = await db.documents.where('sha256').equals(d.sha256).first();
      const backupSections = p.data.sections.filter((s) => s.documentId === d.id).sort((a, b) => a.order - b.order);
      if (ex) {
        doc.set(d.id!, ex.id!);
        inc(skipped, 'documents');
        const local = await db.sections.where('documentId').equals(ex.id!).toArray();
        const byOrder = new Map(local.map((s) => [s.order, s.id!]));
        for (const s of backupSections) { const lid = byOrder.get(s.order); if (lid !== undefined) sec.set(s.id!, lid); }
        continue;
      }
      const nid = (await db.documents.add({
        ...strip(d), oposicionId: opt(opo, d.oposicionId), materiaId: opt(mat, d.materiaId), temaId: opt(tem, d.temaId),
      })) as ID;
      doc.set(d.id!, nid);
      inc(added, 'documents');
      const blob = pdfBlob(p.files.get(d.id!));
      if (blob) await db.documentFiles.put({ documentId: nid, blob });
      const pages = p.data.pages.filter((x) => x.documentId === d.id);
      await db.pages.bulkAdd(pages.map((x) => ({ ...strip(x), documentId: nid })));
      const ids = (await db.sections.bulkAdd(
        backupSections.map((s) => ({ ...strip(s), documentId: nid, parentId: undefined })), { allKeys: true },
      )) as ID[];
      backupSections.forEach((s, i) => sec.set(s.id!, ids[i]));
      const updates = backupSections.filter((s) => s.parentId !== undefined && sec.has(s.parentId))
        .map((s) => ({ key: sec.get(s.id!)!, changes: { parentId: sec.get(s.parentId!)! } }));
      if (updates.length) await db.sections.bulkUpdate(updates);
    }

    const qid = new Map<ID, ID>();
    for (const q of p.data.questions) {
      const ex = await db.questions.where('hash').equals(q.hash).first();
      if (ex) { qid.set(q.id!, ex.id!); inc(skipped, 'questions'); continue; }
      qid.set(q.id!, (await db.questions.add({
        ...strip(q), documentId: opt(doc, q.documentId), sectionId: opt(sec, q.sectionId), temaId: opt(tem, q.temaId),
      })) as ID);
      inc(added, 'questions');
    }

    // Exámenes: se omiten los ya presentes (misma fecha de inicio y mismas preguntas).
    const exam = new Map<ID, ID>();
    for (const e of p.data.exams) {
      const questionIds = e.questionIds.map((x) => qid.get(x)).filter((x): x is ID => x !== undefined);
      if (questionIds.length !== e.questionIds.length) { inc(skipped, 'exams'); continue; }
      const dup = await db.exams.where('startedAt').equals(e.startedAt).filter((x) => x.questionIds.join() === questionIds.join()).first();
      if (dup) { inc(skipped, 'exams'); continue; }
      const cfg = {
        ...e.config,
        documentIds: e.config.documentIds.map((x) => doc.get(x)).filter((x): x is ID => x !== undefined),
        temaIds: e.config.temaIds.map((x) => tem.get(x)).filter((x): x is ID => x !== undefined),
        sectionIds: e.config.sectionIds.map((x) => sec.get(x)).filter((x): x is ID => x !== undefined),
      };
      exam.set(e.id!, (await db.exams.add({ ...strip(e), config: cfg, questionIds })) as ID);
      inc(added, 'exams');
    }
    const attempts = p.data.attempts.filter((a) => exam.has(a.examId) && qid.has(a.questionId))
      .map((a) => ({ ...strip(a), examId: exam.get(a.examId)!, questionId: qid.get(a.questionId)! }));
    if (attempts.length) await db.attempts.bulkAdd(attempts);
    added.attempts = attempts.length;

    for (const r of p.data.reviews) {
      const id = qid.get(r.questionId);
      if (id === undefined) continue;
      const ex = await db.reviews.get(id);
      if (ex && (ex.lastReviewed ?? 0) >= (r.lastReviewed ?? 0)) { inc(skipped, 'reviews'); continue; }
      await db.reviews.put({ ...r, questionId: id });
      inc(added, 'reviews');
    }
    for (const s of p.data.sessions) {
      if (await db.sessions.where('startedAt').equals(s.startedAt).filter((x) => x.endedAt === s.endedAt).count()) { inc(skipped, 'sessions'); continue; }
      await db.sessions.add(strip(s));
      inc(added, 'sessions');
    }
    for (const m of p.data.materials) {
      const did = doc.get(m.documentId);
      if (did === undefined) continue;
      await db.materials.add({ ...strip(m), documentId: did, sectionIds: m.sectionIds.map((x) => sec.get(x)).filter((x): x is ID => x !== undefined) });
      inc(added, 'materials');
    }
    for (const d of p.data.deletions) {
      const ex = await db.deletions.get(d.key);
      if (!ex || ex.deletedAt < d.deletedAt) await db.deletions.put(d);
    }
    // Ajustes: solo los que no existen localmente.
    for (const s of p.data.settings) {
      if (s.key === 'lastBackupAt' || (await db.settings.get(s.key))) continue;
      await db.settings.put(s);
      inc(added, 'settings');
    }
  });
  return { added, skipped };
}
