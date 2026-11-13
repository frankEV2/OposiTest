import type { ExamConfig, ID, Question } from '../db/types';
import { norm } from '../engine/text';

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

const stemWords = (s: string) => new Set(norm(s).split(/\W+/u).filter((w) => w.length > 3));
/** Dos enunciados casi iguales (misma idea con otras palabras). */
export function nearDuplicate(a: Set<string>, b: Set<string>): boolean {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size)) >= 0.8;
}

/**
 * Examen variado, como uno real: reparte las preguntas entre artículos/apartados (una por apartado en cada vuelta),
 * prefiere las redactadas con IA, manuales o validadas y evita dos preguntas casi iguales.
 * `pool` llega ya barajado; el orden relativo se conserva dentro de cada grupo.
 */
export function diversify(pool: Question[], count: number): Question[] {
  const rank = (q: Question) => (q.rule === 'ia' || q.rule === 'manual' || q.status === 'validated' ? 0 : 1);
  const groups = new Map<string, Question[]>();
  for (const q of [...pool].sort((a, b) => rank(a) - rank(b))) {
    const k = q.sectionId !== undefined ? `s${q.sectionId}` : `d${q.documentId}:${q.id}`;
    groups.set(k, [...(groups.get(k) ?? []), q]);
  }
  const out: Question[] = [];
  const picked: Set<string>[] = [];
  const skipped: Question[] = [];
  const lists = [...groups.values()];
  for (let round = 0; out.length < count && lists.some((l) => l.length > round); round++) {
    for (const l of lists) {
      const q = l[round];
      if (!q || out.length >= count) continue;
      const w = stemWords(q.stem);
      if (picked.some((p) => nearDuplicate(p, w))) { skipped.push(q); continue; }
      out.push(q);
      picked.push(w);
    }
  }
  return out.length < count ? [...out, ...skipped.slice(0, count - out.length)] : out;
}

/**
 * Elige las preguntas del examen. Con `shuffle` el orden y las opciones son aleatorios;
 * sin él se sigue el orden del documento y las opciones no se barajan.
 */
export function pickQuestions(pool: Question[], cfg: ExamConfig): { questions: Question[]; orders: number[][] } {
  const ordered = cfg.shuffle
    ? shuffled(pool)
    : [...pool].sort((a, b) => (a.documentId ?? 0) - (b.documentId ?? 0) || (a.sectionId ?? 0) - (b.sectionId ?? 0) || a.id! - b.id!);
  const questions = cfg.shuffle ? diversify(ordered, cfg.count) : ordered.slice(0, cfg.count);
  const orders = questions.map((q) => (cfg.shuffle && !q.fixedOrder ? shuffled([0, 1, 2, 3]) : [0, 1, 2, 3]));
  return { questions, orders };
}

export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const ss = String(s % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}
