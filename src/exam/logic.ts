import type { ExamConfig, ID, Question } from '../db/types';

export interface Score {
  total: number;
  correct: number;
  wrong: number;
  blank: number;
  /** Porcentaje de aciertos sobre el total. */
  percent: number;
  /** Nota sobre 10 tras penalización (mínimo 0, dos decimales). */
  score: number;
}

/** Nota = (aciertos − errores × penalización) / total × 10. */
export function scoreExam(answers: (number | null)[], correctIdx: number[], penalty: number): Score {
  const total = correctIdx.length;
  let correct = 0;
  let wrong = 0;
  answers.forEach((a, i) => {
    if (a === null || a === undefined) return;
    if (a === correctIdx[i]) correct++;
    else wrong++;
  });
  const blank = total - correct - wrong;
  const raw = total ? ((correct - wrong * penalty) / total) * 10 : 0;
  return {
    total, correct, wrong, blank,
    percent: total ? Math.round((correct / total) * 1000) / 10 : 0,
    score: Math.max(0, Math.round(raw * 100) / 100),
  };
}

export interface SelectionContext {
  /** Ids de preguntas ya respondidas alguna vez. */
  seen: Set<ID>;
  /** sectionId → id del artículo padre (para que elegir un artículo incluya sus apartados). */
  parentOf: Map<ID, ID>;
}

/** Filtra el banco según la configuración (sin límite ni orden). */
export function filterQuestions(all: Question[], cfg: ExamConfig, ctx: SelectionContext): Question[] {
  const docs = new Set(cfg.documentIds);
  const temas = new Set(cfg.temaIds);
  const secs = new Set(cfg.sectionIds);
  const diffs = new Set(cfg.difficulties);
  return all.filter((q) => {
    if (q.status === 'rejected') return false;
    if (q.status === 'pending' && !cfg.includePending) return false;
    if (docs.size && (q.documentId === undefined || !docs.has(q.documentId))) return false;
    if (temas.size && (q.temaId === undefined || !temas.has(q.temaId))) return false;
    if (secs.size) {
      if (q.sectionId === undefined) return false;
      if (!secs.has(q.sectionId) && !secs.has(ctx.parentOf.get(q.sectionId) ?? -1)) return false;
    }
    if (diffs.size && !diffs.has(q.difficulty)) return false;
    if (cfg.pool === 'new' && ctx.seen.has(q.id!)) return false;
    if (cfg.pool === 'seen' && !ctx.seen.has(q.id!)) return false;
    return true;
  });
}

const shuffled = <T,>(a: T[]): T[] => {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [r[i], r[j]] = [r[j], r[i]];
  }
  return r;
};

/**
 * Elige las preguntas del examen. Con `shuffle` el orden y las opciones son aleatorios;
 * sin él se sigue el orden del documento y las opciones no se barajan.
 */
export function pickQuestions(pool: Question[], cfg: ExamConfig): { questions: Question[]; orders: number[][] } {
  const ordered = cfg.shuffle
    ? shuffled(pool)
    : [...pool].sort((a, b) => (a.documentId ?? 0) - (b.documentId ?? 0) || (a.sectionId ?? 0) - (b.sectionId ?? 0) || a.id! - b.id!);
  const questions = ordered.slice(0, cfg.count);
  const orders = questions.map(() => (cfg.shuffle ? shuffled([0, 1, 2, 3]) : [0, 1, 2, 3]));
  return { questions, orders };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
