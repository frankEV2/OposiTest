/**
 * Instantánea sincronizable: los datos del usuario con CLAVES NATURALES (iguales en todos los
 * dispositivos) en vez de ids locales. No incluye el texto ni la estructura de los PDF: cada
 * dispositivo los recalcula a partir del propio PDF (las secciones se emparejan por su orden).
 *
 * Reglas de fusión (aplySnapshot), sin pérdidas silenciosas:
 *  - Lo que falta en local se añade (salvo que esté borrado con fecha posterior).
 *  - Si existe en ambos, gana el que tenga `updatedAt` más reciente (preguntas, documentos)
 *    o `lastReviewed` más reciente (repasos).
 *  - Un borrado se aplica si es posterior a la última modificación local del elemento.
 *  - Exámenes terminados, respuestas y sesiones solo se añaden (son históricos).
 */
import { db } from '../db/db';
import type {
  Deletion, DocumentMeta, Exam, ExamConfig, ID, Question, QuestionRule, QuestionStatus,
  ReviewItem, StudySession,
} from '../db/types';
import { deleteDocumentContent, importPdf, replacePdf } from '../library/service';
import { docKey, qKey, taxPath } from './keys';

export const SNAPSHOT_VERSION = 1;

interface TaxRef { opo?: string; mat?: string; tema?: string }

export interface SnapDocument {
  key: string;
  sha256: string;
  title: string;
  fileName: string;
  size: number;
  tax: TaxRef;
  importedAt: number;
  updatedAt: number;
}

export interface SnapQuestion {
  key: string;
  hash: string;
  docKey?: string;
  sectionOrder?: number;
  tema?: TaxRef;
  stem: string;
  options: Question['options'];
  correctIndex: Question['correctIndex'];
  explanation: string;
  reference: string;
  sourceExcerpt: string;
  difficulty: Question['difficulty'];
  status: QuestionStatus;
  rule: QuestionRule;
  createdAt: number;
  updatedAt: number;
}

export interface SnapExam {
  key: number; // startedAt
  config: Omit<ExamConfig, 'documentIds' | 'temaIds' | 'sectionIds'> & {
    docKeys: string[]; temas: TaxRef[]; sections: { docKey: string; order: number }[];
  };
  questionKeys: (string | null)[];
  orders: number[][];
  answers: (number | null)[];
  startedAt: number;
  finishedAt: number;
  durationSec?: number;
  correct?: number;
  wrong?: number;
  blank?: number;
  score?: number;
  attempts: { questionKey: string; chosenIndex: number | null; correct: boolean; answeredAt: number }[];
}

export interface Snapshot {
  version: number;
  savedAt: number;
  taxonomy: { opo: string; mat?: string; tema?: string; order: number; createdAt: number }[];
  documents: SnapDocument[];
  questions: SnapQuestion[];
  exams: SnapExam[];
  reviews: (Omit<ReviewItem, 'questionId'> & { questionKey: string })[];
  sessions: StudySession[];
  deletions: Deletion[];
}

// ------------------------------------------------------------------ construir

interface Lookup {
  opo: Map<ID, string>;
  mat: Map<ID, { opo: string; name: string }>;
  tema: Map<ID, { opo: string; mat: string; name: string }>;
}

async function taxLookup(): Promise<Lookup> {
  const opos = await db.oposiciones.toArray();
  const opo = new Map(opos.map((o) => [o.id!, o.name]));
  const mat = new Map((await db.materias.toArray()).filter((m) => opo.has(m.oposicionId))
    .map((m) => [m.id!, { opo: opo.get(m.oposicionId)!, name: m.name }]));
  const tema = new Map((await db.temas.toArray()).filter((t) => mat.has(t.materiaId))
    .map((t) => [t.id!, { opo: mat.get(t.materiaId)!.opo, mat: mat.get(t.materiaId)!.name, name: t.name }]));
  return { opo, mat, tema };
}

const temaRef = (l: Lookup, id?: ID): TaxRef | undefined => {
  const t = id === undefined ? undefined : l.tema.get(id);
  return t ? { opo: t.opo, mat: t.mat, tema: t.name } : undefined;
};

export async function buildSnapshot(now = Date.now()): Promise<Snapshot> {
  const l = await taxLookup();
  const taxonomy: Snapshot['taxonomy'] = [];
  for (const o of await db.oposiciones.toArray()) taxonomy.push({ opo: o.name, order: 0, createdAt: o.createdAt });
  for (const m of await db.materias.toArray()) {
    const o = l.opo.get(m.oposicionId);
    if (o) taxonomy.push({ opo: o, mat: m.name, order: m.order, createdAt: m.createdAt ?? 0 });
  }
  for (const t of await db.temas.toArray()) {
    const r = l.tema.get(t.id!);
    if (r) taxonomy.push({ opo: r.opo, mat: r.mat, tema: r.name, order: t.order, createdAt: t.createdAt ?? 0 });
  }

  const docs = await db.documents.toArray();
  const docKeyById = new Map(docs.map((d) => [d.id!, docKey(d)]));
  const documents: SnapDocument[] = docs.map((d) => ({
    key: docKey(d), sha256: d.sha256, title: d.title, fileName: d.fileName, size: d.size,
    tax: {
      opo: d.oposicionId === undefined ? undefined : l.opo.get(d.oposicionId),
      mat: d.materiaId === undefined ? undefined : l.mat.get(d.materiaId)?.name,
      tema: d.temaId === undefined ? undefined : l.tema.get(d.temaId)?.name,
    },
    importedAt: d.importedAt, updatedAt: d.updatedAt,
  }));

  const sectionOrder = new Map<ID, { docId: ID; order: number }>();
  await db.sections.each((s) => sectionOrder.set(s.id!, { docId: s.documentId, order: s.order }));

  const qs = await db.questions.toArray();
  const qKeyById = new Map(qs.map((q) => [q.id!, qKey(q)]));
  const questions: SnapQuestion[] = qs.map((q) => ({
    key: qKey(q), hash: q.hash,
    docKey: q.documentId === undefined ? undefined : docKeyById.get(q.documentId),
    sectionOrder: q.sectionId === undefined ? undefined : sectionOrder.get(q.sectionId)?.order,
    tema: temaRef(l, q.temaId),
    stem: q.stem, options: q.options, correctIndex: q.correctIndex, explanation: q.explanation,
    reference: q.reference, sourceExcerpt: q.sourceExcerpt, difficulty: q.difficulty, status: q.status,
    rule: q.rule, createdAt: q.createdAt, updatedAt: q.updatedAt,
  }));

  const attempts = await db.attempts.toArray();
  const exams: SnapExam[] = (await db.exams.toArray()).filter((e) => e.finishedAt).map((e) => ({
    key: e.startedAt,
    config: {
      ...stripIds(e.config),
      docKeys: e.config.documentIds.map((x) => docKeyById.get(x)).filter((x): x is string => !!x),
      temas: e.config.temaIds.map((x) => temaRef(l, x)).filter((x): x is TaxRef => !!x),
      sections: e.config.sectionIds.map((x) => sectionOrder.get(x))
        .filter((x): x is { docId: ID; order: number } => !!x && docKeyById.has(x.docId))
        .map((x) => ({ docKey: docKeyById.get(x.docId)!, order: x.order })),
    },
    questionKeys: e.questionIds.map((x) => qKeyById.get(x) ?? null),
    orders: e.orders, answers: e.answers, startedAt: e.startedAt, finishedAt: e.finishedAt!,
    durationSec: e.durationSec, correct: e.correct, wrong: e.wrong, blank: e.blank, score: e.score,
    attempts: attempts.filter((a) => a.examId === e.id && qKeyById.has(a.questionId)).map((a) => ({
      questionKey: qKeyById.get(a.questionId)!, chosenIndex: a.chosenIndex, correct: a.correct, answeredAt: a.answeredAt,
    })),
  }));

  const reviews = (await db.reviews.toArray()).filter((r) => qKeyById.has(r.questionId))
    .map(({ questionId, ...r }) => ({ ...r, questionKey: qKeyById.get(questionId)! }));

  return {
    version: SNAPSHOT_VERSION, savedAt: now, taxonomy, documents, questions, exams, reviews,
    sessions: (await db.sessions.toArray()).map(({ id: _id, ...s }) => s),
    deletions: await db.deletions.toArray(),
  };
}

function stripIds(c: ExamConfig) {
  const { documentIds: _d, temaIds: _t, sectionIds: _s, ...rest } = c;
  return rest;
}

// ------------------------------------------------------------------ aplicar

export interface ApplyReport {
  added: Record<string, number>;
  updated: Record<string, number>;
  deleted: Record<string, number>;
  /** Documentos remotos cuyo PDF no se pudo obtener o procesar. */
  failed: string[];
}

export interface ApplyDeps {
  /** Devuelve el PDF con ese SHA-256 desde el almacenamiento remoto (o null si no está). */
  fetchPdf: (sha256: string) => Promise<Blob | null>;
  /** Extractor de texto (en pruebas se sustituye; en el navegador se usa PDF.js). */
  extract?: Parameters<typeof importPdf>[3];
}

export async function applySnapshot(remote: Snapshot, deps: ApplyDeps): Promise<ApplyReport> {
  if (remote.version > SNAPSHOT_VERSION) throw new Error('Los datos de la nube proceden de una versión más reciente de la app. Actualízala.');
  const rep: ApplyReport = { added: {}, updated: {}, deleted: {}, failed: [] };
  const inc = (r: Record<string, number>, k: string) => { r[k] = (r[k] ?? 0) + 1; };

  // 1. Borrados: unión (se conserva la fecha más reciente).
  for (const d of remote.deletions) {
    const ex = await db.deletions.get(d.key);
    if (!ex || ex.deletedAt < d.deletedAt) await db.deletions.put(d);
  }
  const deletedAt = new Map((await db.deletions.toArray()).map((d) => [d.key, d.deletedAt]));
  const isDeleted = (key: string, ts: number) => (deletedAt.get(key) ?? -1) > ts;

  // 2. Taxonomía.
  for (const t of [...remote.taxonomy].sort((a, b) => (a.mat ? (a.tema ? 2 : 1) : 0) - (b.mat ? (b.tema ? 2 : 1) : 0))) {
    const path = taxPath(...[t.opo, t.mat, t.tema].filter((x): x is string => !!x));
    if (isDeleted(`tax:${path}`, t.createdAt)) continue;
    if ((await ensureTax(t, t.order, t.createdAt)).created) inc(rep.added, 'taxonomía');
  }
  for (const [path, ts] of deletedAt) {
    if (!path.startsWith('tax:')) continue;
    const ids = await findTax(path.slice(4).split('\u0001'));
    if (!ids) continue;
    if (await removeTax(ids, ts)) inc(rep.deleted, 'taxonomía');
  }

  // 3. Documentos.
  const local = await db.documents.toArray();
  const byKey = new Map(local.map((d) => [docKey(d), d]));
  const bySha = new Map(local.map((d) => [d.sha256, d]));
  for (const r of remote.documents) {
    if (isDeleted(`doc:${r.key}`, r.updatedAt)) continue;
    let l = byKey.get(r.key) ?? bySha.get(r.sha256);
    if (l && docKey(l) !== r.key) {
      // Mismo PDF importado por separado en dos dispositivos: ambos adoptan la menor de las claves.
      const key = [docKey(l), r.key].sort()[0];
      await db.documents.update(l.id!, { uid: key });
      l = { ...l, uid: key };
    }
    const cls = await resolveCls(r.tax);
    try {
      if (!l) {
        const blob = await deps.fetchPdf(r.sha256);
        if (!blob) { rep.failed.push(r.title); continue; }
        const id = await importPdf(new File([blob], r.fileName, { type: blob.type || 'application/pdf' }), cls, undefined, deps.extract);
        await db.documents.update(id, { uid: r.key, title: r.title, importedAt: r.importedAt, updatedAt: r.updatedAt });
        byKey.set(r.key, (await db.documents.get(id))!);
        inc(rep.added, 'documentos');
      } else if (r.updatedAt > l.updatedAt) {
        if (r.sha256 !== l.sha256) {
          const blob = await deps.fetchPdf(r.sha256);
          if (!blob) { rep.failed.push(r.title); continue; }
          await replacePdf(l.id!, new File([blob], r.fileName, { type: blob.type || 'application/pdf' }), undefined, deps.extract);
        }
        await db.documents.update(l.id!, {
          title: r.title, oposicionId: cls.oposicionId, materiaId: cls.materiaId, temaId: cls.temaId, updatedAt: r.updatedAt,
        });
        inc(rep.updated, 'documentos');
      }
    } catch (e) {
      rep.failed.push(`${r.title}: ${(e as Error).message}`);
    }
  }
  for (const d of await db.documents.toArray()) {
    if (isDeleted(`doc:${docKey(d)}`, d.updatedAt)) { await deleteDocumentContent(d.id!); inc(rep.deleted, 'documentos'); }
  }

  // 4. Preguntas.
  const docIdByKey = new Map((await db.documents.toArray()).map((d) => [docKey(d), d.id!]));
  const sectionIdOf = async (dk?: string, order?: number) => {
    const did = dk === undefined ? undefined : docIdByKey.get(dk);
    if (did === undefined || order === undefined) return undefined;
    return (await db.sections.where('[documentId+order]').equals([did, order]).first())?.id;
  };
  const localQs = await db.questions.toArray();
  const qByKey = new Map(localQs.map((q) => [qKey(q), q]));
  const qByHash = new Map(localQs.map((q) => [q.hash, q]));
  for (const r of remote.questions) {
    if (isDeleted(`q:${r.key}`, r.updatedAt)) continue;
    const l = qByKey.get(r.key) ?? qByHash.get(r.hash);
    if (l && l.updatedAt >= r.updatedAt) continue;
    const fields = {
      uid: r.key, hash: r.hash,
      documentId: r.docKey === undefined ? undefined : docIdByKey.get(r.docKey),
      sectionId: await sectionIdOf(r.docKey, r.sectionOrder),
      temaId: r.tema ? (await findTax([r.tema.opo!, r.tema.mat!, r.tema.tema!].filter(Boolean)))?.temaId : undefined,
      stem: r.stem, options: r.options, correctIndex: r.correctIndex, explanation: r.explanation,
      reference: r.reference, sourceExcerpt: r.sourceExcerpt, difficulty: r.difficulty, status: r.status,
      rule: r.rule, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
    // Otra pregunta local con el mismo hash (índice único): no se puede guardar; se omite.
    const clash = qByHash.get(r.hash);
    if (clash && clash.id !== l?.id) continue;
    if (l) { await db.questions.update(l.id!, fields); inc(rep.updated, 'preguntas'); }
    else { const id = (await db.questions.add(fields as Question)) as ID; qByKey.set(r.key, { ...(fields as Question), id }); qByHash.set(r.hash, { ...(fields as Question), id }); inc(rep.added, 'preguntas'); }
  }
  for (const q of await db.questions.toArray()) {
    if (isDeleted(`q:${qKey(q)}`, q.updatedAt)) {
      await db.reviews.delete(q.id!);
      await db.questions.delete(q.id!);
      inc(rep.deleted, 'preguntas');
    }
  }
  const qIdByKey = new Map((await db.questions.toArray()).map((q) => [qKey(q), q.id!]));

  // 5. Exámenes terminados y sus respuestas (históricos: solo se añaden).
  const localStarts = new Set((await db.exams.toArray()).map((e) => e.startedAt));
  for (const r of remote.exams) {
    if (localStarts.has(r.key)) continue;
    const temaIds: ID[] = [];
    for (const t of r.config.temas) { const id = (await findTax([t.opo!, t.mat!, t.tema!].filter(Boolean)))?.temaId; if (id !== undefined) temaIds.push(id); }
    const sectionIds: ID[] = [];
    for (const s of r.config.sections) { const id = await sectionIdOf(s.docKey, s.order); if (id !== undefined) sectionIds.push(id); }
    const { docKeys, temas: _t, sections: _s, ...cfg } = r.config;
    const exam: Exam = {
      config: { ...cfg, documentIds: docKeys.map((k) => docIdByKey.get(k)).filter((x): x is ID => x !== undefined), temaIds, sectionIds },
      // Pregunta que ya no existe: id -1 (la pantalla de resultados la muestra como eliminada).
      questionIds: r.questionKeys.map((k) => (k ? qIdByKey.get(k) ?? -1 : -1)),
      orders: r.orders, answers: r.answers, startedAt: r.startedAt, finishedAt: r.finishedAt,
      durationSec: r.durationSec, correct: r.correct, wrong: r.wrong, blank: r.blank, score: r.score,
    };
    const examId = (await db.exams.add(exam)) as ID;
    const atts = r.attempts.filter((a) => qIdByKey.has(a.questionKey))
      .map((a) => ({ examId, questionId: qIdByKey.get(a.questionKey)!, chosenIndex: a.chosenIndex, correct: a.correct, answeredAt: a.answeredAt }));
    if (atts.length) await db.attempts.bulkAdd(atts);
    inc(rep.added, 'exámenes');
  }

  // 6. Repasos: gana el más reciente; un "quitar del repaso" posterior lo elimina.
  for (const r of remote.reviews) {
    const qid = qIdByKey.get(r.questionKey);
    if (qid === undefined || isDeleted(`rev:${r.questionKey}`, r.lastReviewed ?? 0)) continue;
    const l = await db.reviews.get(qid);
    if (!l || (l.lastReviewed ?? 0) < (r.lastReviewed ?? 0)) {
      const { questionKey: _k, ...rest } = r;
      await db.reviews.put({ ...rest, questionId: qid });
      inc(l ? rep.updated : rep.added, 'repasos');
    }
  }
  const keyByQid = new Map([...qIdByKey].map(([k, id]) => [id, k]));
  for (const r of await db.reviews.toArray()) {
    const k = keyByQid.get(r.questionId);
    // Sin pregunta (huérfano) o quitado del repaso en otro dispositivo después del último repaso local.
    if (!k || isDeleted(`rev:${k}`, r.lastReviewed ?? 0)) { await db.reviews.delete(r.questionId); inc(rep.deleted, 'repasos'); }
  }

  // 7. Sesiones de estudio.
  const sessKeys = new Set((await db.sessions.toArray()).map((s) => `${s.startedAt}|${s.endedAt}`));
  const newSess = remote.sessions.filter((s) => !sessKeys.has(`${s.startedAt}|${s.endedAt}`));
  if (newSess.length) await db.sessions.bulkAdd(newSess);

  return rep;
}

// ------------------------------------------------------------------ taxonomía por nombre

/**
 * Aplica un borrado remoto de la taxonomía SIN anotar borrados ni cambiar fechas de documentos y
 * preguntas (si se marcaran como modificados "ahora", taparían los cambios que llegan del otro dispositivo).
 */
async function removeTax(ids: { oposicionId?: ID; materiaId?: ID; temaId?: ID }, ts: number): Promise<boolean> {
  const dropTema = async (id: ID) => {
    await db.documents.where('temaId').equals(id).modify({ temaId: undefined });
    await db.questions.where('temaId').equals(id).modify({ temaId: undefined });
    await db.temas.delete(id);
  };
  const dropMateria = async (id: ID) => {
    for (const t of await db.temas.where('materiaId').equals(id).primaryKeys()) await dropTema(t as ID);
    await db.documents.where('materiaId').equals(id).modify({ materiaId: undefined });
    await db.materias.delete(id);
  };
  if (ids.temaId !== undefined) {
    const t = await db.temas.get(ids.temaId);
    if (!t || (t.createdAt ?? 0) >= ts) return false;
    await dropTema(ids.temaId);
    return true;
  }
  if (ids.materiaId !== undefined) {
    const m = await db.materias.get(ids.materiaId);
    if (!m || (m.createdAt ?? 0) >= ts) return false;
    await dropMateria(ids.materiaId);
    return true;
  }
  if (ids.oposicionId !== undefined) {
    const o = await db.oposiciones.get(ids.oposicionId);
    if (!o || o.createdAt >= ts) return false;
    for (const m of await db.materias.where('oposicionId').equals(ids.oposicionId).primaryKeys()) await dropMateria(m as ID);
    await db.documents.where('oposicionId').equals(ids.oposicionId).modify({ oposicionId: undefined });
    await db.oposiciones.delete(ids.oposicionId);
    return true;
  }
  return false;
}

async function findTax(names: string[]): Promise<{ oposicionId?: ID; materiaId?: ID; temaId?: ID } | null> {
  const [opo, mat, tema] = names;
  const o = opo === undefined ? undefined : await db.oposiciones.where('name').equals(opo).first();
  if (!o) return null;
  if (mat === undefined) return { oposicionId: o.id };
  const m = await db.materias.where('[oposicionId+name]').equals([o.id!, mat]).first();
  if (!m) return null;
  if (tema === undefined) return { oposicionId: o.id, materiaId: m.id };
  const t = await db.temas.where('[materiaId+name]').equals([m.id!, tema]).first();
  return t ? { oposicionId: o.id, materiaId: m.id, temaId: t.id } : null;
}

export async function ensureTax(t: { opo: string; mat?: string; tema?: string }, order: number, createdAt: number) {
  let created = false;
  let o = await db.oposiciones.where('name').equals(t.opo).first();
  if (!o) { o = { id: (await db.oposiciones.add({ name: t.opo, createdAt })) as ID, name: t.opo, createdAt }; created = !t.mat; }
  if (!t.mat) return { created };
  let m = await db.materias.where('[oposicionId+name]').equals([o.id!, t.mat]).first();
  if (!m) { m = { id: (await db.materias.add({ oposicionId: o.id!, name: t.mat, order, createdAt })) as ID, oposicionId: o.id!, name: t.mat, order }; created = !t.tema; }
  if (!t.tema) return { created };
  if (!(await db.temas.where('[materiaId+name]').equals([m.id!, t.tema]).first())) {
    await db.temas.add({ materiaId: m.id!, name: t.tema, order, createdAt });
    created = true;
  }
  return { created };
}

export async function resolveCls(t: TaxRef): Promise<Pick<DocumentMeta, 'oposicionId' | 'materiaId' | 'temaId'>> {
  const names = [t.opo, t.mat, t.tema];
  const cut = names.indexOf(undefined);
  const ids = await findTax((cut === -1 ? names : names.slice(0, cut)) as string[]);
  return { oposicionId: ids?.oposicionId, materiaId: ids?.materiaId, temaId: ids?.temaId };
}

