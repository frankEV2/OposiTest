import { describe, expect, it } from 'vitest';
import type { Attempt, Exam, Question } from '../db/types';
import { byDocument, byMateria, byTema, evolution, failStats, isHard, overview, type Lookups } from './stats';

const att = (questionId: number, correct: boolean, answeredAt = 0): Attempt =>
  ({ examId: 1, questionId, chosenIndex: correct ? 0 : 1, correct, answeredAt });

const attempts = [att(1, true, 1), att(1, false, 2), att(1, false, 3), att(2, true, 1), att(3, false, 1)];

const l: Lookups = {
  questions: new Map([
    [1, { id: 1, documentId: 10, temaId: 100 } as Question],
    [2, { id: 2, documentId: 10, temaId: 101 } as Question],
    [3, { id: 3, documentId: 11 } as Question],
  ]),
  docs: new Map([[10, { id: 10, title: 'Ley A' }], [11, { id: 11, title: 'Ley B' }]] as never),
  temas: new Map([[100, { id: 100, materiaId: 5, name: 'T1', order: 0 }], [101, { id: 101, materiaId: 5, name: 'T2', order: 1 }]]),
  materias: new Map([[5, { id: 5, oposicionId: 1, name: 'Derecho', order: 0 }]]),
};

describe('estadísticas', () => {
  it('resumen general', () => {
    const exams = [{ finishedAt: 5, score: 6 }, { finishedAt: 6, score: 8 }, { startedAt: 1 }] as Exam[];
    const sessions = [{ startedAt: 0, endedAt: 60_000, activity: 'examen' as const }];
    expect(overview(exams, attempts, sessions, 0)).toEqual({
      exams: 2, answered: 5, correct: 2, percent: 40, avgScore: 7, studySec: 60, last7Sec: 60,
    });
  });

  it('agrupa por documento, tema y materia (peores primero)', () => {
    expect(byDocument(attempts, l).map((b) => [b.label, b.percent])).toEqual([['Ley B', 0], ['Ley A', 50]]);
    expect(byTema(attempts, l).map((b) => [b.label, b.answered])).toEqual([['Derecho · T1', 3], ['Derecho · T2', 1]]);
    expect(byMateria(attempts, l)[0]).toMatchObject({ label: 'Derecho', answered: 4, correct: 2, percent: 50 });
  });

  it('más falladas y difíciles', () => {
    const f = failStats(attempts);
    expect(f.map((s) => s.questionId)).toEqual([1, 3]);
    expect(f[0]).toMatchObject({ attempts: 3, wrong: 2, failRate: 66.7, lastCorrect: false });
    expect(f.filter(isHard).map((s) => s.questionId)).toEqual([1]);
  });

  it('evolución ordenada', () => {
    const ex = [
      { id: 2, finishedAt: 20, score: 5, correct: 1, questionIds: [1, 2] },
      { id: 1, finishedAt: 10, score: 9, correct: 2, questionIds: [1, 2] },
    ] as Exam[];
    expect(evolution(ex).map((p) => [p.examId, p.percent])).toEqual([[1, 100], [2, 50]]);
  });
});
