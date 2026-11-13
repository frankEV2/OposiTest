import { db } from '../db/db';
import type { Exam, ExamConfig, ID } from '../db/types';
import { filterQuestions, pickQuestions, scoreExam, type SelectionContext } from './logic';
import { nextReview } from '../review/srs';
import { qKey, recordDeletions } from '../sync/keys';

export async function selectionContext(cfg?: ExamConfig): Promise<SelectionContext> {
  const seen = new Set((await db.attempts.toArray()).map((a) => a.questionId));
  const parentOf = new Map<ID, ID>();
  await db.sections.where('kind').equals('apartado').each((s) => {
    if (s.parentId !== undefined) parentOf.set(s.id!, s.parentId);
  });
  // Documentos con artículos concretos elegidos: el filtro por artículo solo se aplica a ellos.
  const sectionDocs = cfg?.sectionIds.length
    ? new Set((await db.sections.bulkGet(cfg.sectionIds)).flatMap((s) => (s ? [s.documentId] : []))) : undefined;
  return { seen, parentOf, sectionDocs };
}

/** Número de preguntas disponibles para una configuración. */
export async function countAvailable(cfg: ExamConfig): Promise<number> {
  return filterQuestions(await db.questions.toArray(), cfg, await selectionContext(cfg)).length;
}

export async function createExam(cfg: ExamConfig): Promise<ID> {
  const pool = filterQuestions(await db.questions.toArray(), cfg, await selectionContext(cfg));
  if (!pool.length) throw new Error('No hay preguntas que cumplan los criterios elegidos.');
  const { questions, orders } = pickQuestions(pool, cfg);
  return (await db.exams.add({
    config: cfg,
    questionIds: questions.map((q) => q.id!),
    orders,
    answers: questions.map(() => null),
    startedAt: Date.now(),
  })) as ID;
}

/** Examen con una lista concreta de preguntas (repaso de errores). */
export async function createExamFromIds(ids: ID[], mode: ExamConfig['mode'], penalty: number): Promise<ID> {
  const qs = (await db.questions.bulkGet(ids)).filter((q) => q && q.status !== 'rejected');
  if (!qs.length) throw new Error('No hay preguntas para repasar.');
  const cfg: ExamConfig = {
    mode, count: 100, documentIds: [], temaIds: [], sectionIds: [], difficulties: [], pool: 'all',
    shuffle: true, penalty, includePending: true,
  };
  const { questions, orders } = pickQuestions(qs as NonNullable<(typeof qs)[number]>[], { ...cfg, count: Math.min(qs.length, 100) as ExamConfig['count'] });
  return (await db.exams.add({
    config: { ...cfg, count: questions.length as ExamConfig['count'] },
    questionIds: questions.map((q) => q.id!), orders,
    answers: questions.map(() => null), startedAt: Date.now(),
  })) as ID;
}

export async function setAnswer(examId: ID, index: number, answer: number | null) {
  await db.transaction('rw', db.exams, async () => {
    const e = await db.exams.get(examId);
    if (!e || e.finishedAt) return;
    const answers = [...e.answers];
    answers[index] = answer;
    await db.exams.update(examId, { answers });
  });
}

/** Cierra el examen: calcula la nota y registra un intento por pregunta. Idempotente. */
export async function finishExam(examId: ID, at = Date.now()): Promise<Exam | undefined> {
  return db.transaction('rw', [db.exams, db.questions, db.attempts, db.sessions, db.reviews, db.deletions], async () => {
    const e = await db.exams.get(examId);
    if (!e || e.finishedAt) return e;
    const qs = await db.questions.bulkGet(e.questionIds);
    // Preguntas borradas entretanto: cuentan como en blanco con respuesta imposible.
    const correctIdx = qs.map((q) => q?.correctIndex ?? -1);
    const limit = e.config.mode === 'simulacro' && e.config.timeLimitSec ? e.config.timeLimitSec : Infinity;
    const durationSec = Math.min(Math.round((at - e.startedAt) / 1000), limit);
    const s = scoreExam(e.answers, correctIdx, e.config.penalty);
    const finished: Partial<Exam> = {
      finishedAt: at, durationSec, correct: s.correct, wrong: s.wrong, blank: s.blank, score: s.score,
    };
    await db.exams.update(examId, finished);
    await db.attempts.bulkAdd(
      e.questionIds.map((questionId, i) => ({
        examId, questionId, chosenIndex: e.answers[i], correct: e.answers[i] !== null && e.answers[i] === correctIdx[i], answeredAt: at,
      })).filter((a) => qs[e.questionIds.indexOf(a.questionId)]),
    );
    // Repetición espaciada: blancos cuentan como fallo.
    const existing = await db.reviews.bulkGet(e.questionIds);
    for (const [i, qid] of e.questionIds.entries()) {
      if (!qs[i]) continue;
      const change = nextReview(existing[i], qid, e.answers[i] !== null && e.answers[i] === correctIdx[i], at);
      if (change && 'put' in change) await db.reviews.put(change.put);
      else if (change) {
        await db.reviews.delete(change.remove);
        await recordDeletions([`rev:${qKey(qs[i]!)}`], at); // dominada: sale del repaso en todos los dispositivos
      }
    }
    await db.sessions.add({ startedAt: e.startedAt, endedAt: e.startedAt + durationSec * 1000, activity: 'examen' });
    return { ...e, ...finished };
  });
}

export async function abandonExam(examId: ID) {
  await db.exams.delete(examId);
}
