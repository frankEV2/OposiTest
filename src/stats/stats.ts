/** Agregados de progreso (funciones puras sobre los datos locales). */
import type { Attempt, DocumentMeta, Exam, ID, Materia, Question, StudySession, Tema } from '../db/types';

export interface Bucket {
  key: string;
  label: string;
  answered: number;
  correct: number;
  /** % de aciertos sobre respondidas (blancos cuentan como no acierto). */
  percent: number;
}

const pct = (c: number, n: number) => (n ? Math.round((c / n) * 1000) / 10 : 0);

function bucketize(attempts: Attempt[], keyOf: (a: Attempt) => { key: string; label: string } | null): Bucket[] {
  const m = new Map<string, Bucket>();
  for (const a of attempts) {
    const k = keyOf(a);
    if (!k) continue;
    const b = m.get(k.key) ?? { ...k, answered: 0, correct: 0, percent: 0 };
    b.answered++;
    if (a.correct) b.correct++;
    m.set(k.key, b);
  }
  return [...m.values()].map((b) => ({ ...b, percent: pct(b.correct, b.answered) }))
    .sort((a, b) => a.percent - b.percent || b.answered - a.answered);
}

export interface Overview {
  exams: number;
  answered: number;
  correct: number;
  percent: number;
  avgScore: number;
  studySec: number;
  last7Sec: number;
}

export function overview(exams: Exam[], attempts: Attempt[], sessions: StudySession[], now = Date.now()): Overview {
  const done = exams.filter((e) => e.finishedAt);
  const correct = attempts.filter((a) => a.correct).length;
  const dur = (s: StudySession) => Math.max(0, (s.endedAt - s.startedAt) / 1000);
  return {
    exams: done.length,
    answered: attempts.length,
    correct,
    percent: pct(correct, attempts.length),
    avgScore: done.length ? Math.round((done.reduce((a, e) => a + (e.score ?? 0), 0) / done.length) * 100) / 100 : 0,
    studySec: sessions.reduce((a, s) => a + dur(s), 0),
    last7Sec: sessions.filter((s) => s.startedAt >= now - 7 * 86_400_000).reduce((a, s) => a + dur(s), 0),
  };
}

export interface Lookups {
  questions: Map<ID, Question>;
  docs: Map<ID, DocumentMeta>;
  temas: Map<ID, Tema>;
  materias: Map<ID, Materia>;
}

export function byDocument(attempts: Attempt[], l: Lookups): Bucket[] {
  return bucketize(attempts, (a) => {
    const d = l.questions.get(a.questionId)?.documentId;
    const doc = d !== undefined ? l.docs.get(d) : undefined;
    return doc ? { key: String(doc.id), label: doc.title } : null;
  });
}

export function byTema(attempts: Attempt[], l: Lookups): Bucket[] {
  return bucketize(attempts, (a) => {
    const t = l.questions.get(a.questionId)?.temaId;
    const tema = t !== undefined ? l.temas.get(t) : undefined;
    if (!tema) return null;
    const mat = l.materias.get(tema.materiaId);
    return { key: String(tema.id), label: mat ? `${mat.name} · ${tema.name}` : tema.name };
  });
}

export function byMateria(attempts: Attempt[], l: Lookups): Bucket[] {
  return bucketize(attempts, (a) => {
    const t = l.questions.get(a.questionId)?.temaId;
    const mat = t !== undefined ? l.materias.get(l.temas.get(t)?.materiaId ?? -1) : undefined;
    return mat ? { key: String(mat.id), label: mat.name } : null;
  });
}

export interface FailStat {
  questionId: ID;
  attempts: number;
  wrong: number;
  failRate: number;
  lastAt: number;
  lastCorrect: boolean;
}

/** Estadística de fallos por pregunta, ordenada por nº de fallos y tasa. */
export function failStats(attempts: Attempt[]): FailStat[] {
  const m = new Map<ID, FailStat>();
  for (const a of [...attempts].sort((x, y) => x.answeredAt - y.answeredAt)) {
    const s = m.get(a.questionId) ?? { questionId: a.questionId, attempts: 0, wrong: 0, failRate: 0, lastAt: 0, lastCorrect: false };
    s.attempts++;
    if (!a.correct) s.wrong++;
    s.lastAt = a.answeredAt;
    s.lastCorrect = a.correct;
    m.set(a.questionId, s);
  }
  return [...m.values()].filter((s) => s.wrong > 0)
    .map((s) => ({ ...s, failRate: pct(s.wrong, s.attempts) }))
    .sort((a, b) => b.wrong - a.wrong || b.failRate - a.failRate || b.lastAt - a.lastAt);
}

/** Preguntas "difíciles" para el usuario: ≥2 intentos y ≥50 % de fallos. */
export const isHard = (s: FailStat) => s.attempts >= 2 && s.failRate >= 50;

export interface Point { at: number; score: number; percent: number; examId: ID }

export function evolution(exams: Exam[]): Point[] {
  return exams.filter((e) => e.finishedAt)
    .sort((a, b) => a.finishedAt! - b.finishedAt!)
    .map((e) => ({
      at: e.finishedAt!, examId: e.id!, score: e.score ?? 0,
      percent: pct(e.correct ?? 0, e.questionIds.length),
    }));
}
