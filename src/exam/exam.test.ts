import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import type { ExamConfig, Question } from '../db/types';
import { filterQuestions, pickQuestions, scoreExam } from './logic';
import { createExam, createExamFromIds, finishExam, setAnswer } from './service';

const q = (id: number, extra: Partial<Question> = {}): Question => ({
  id, hash: `h${id}`, documentId: 1, sectionId: id, stem: `Pregunta ${id}`, options: ['a', 'b', 'c', 'd'],
  correctIndex: 0, explanation: '', reference: '', sourceExcerpt: '', difficulty: 2, status: 'validated',
  rule: 'plazo', createdAt: 0, updatedAt: 0, ...extra,
});

const cfg = (extra: Partial<ExamConfig> = {}): ExamConfig => ({
  mode: 'simulacro', count: 10, documentIds: [], temaIds: [], sectionIds: [], difficulties: [],
  pool: 'all', shuffle: false, penalty: 1 / 3, includePending: false, ...extra,
});

describe('puntuación', () => {
  it('aplica penalización y cuenta blancos', () => {
    const s = scoreExam([0, 0, 1, null, 2, 0], [0, 0, 0, 0, 0, 0], 1 / 3);
    expect(s).toMatchObject({ correct: 3, wrong: 2, blank: 1, percent: 50 });
    expect(s.score).toBeCloseTo(((3 - 2 / 3) / 6) * 10, 2);
    expect(scoreExam([1, 1], [0, 0], 1).score).toBe(0); // nunca negativa
    expect(scoreExam([0, 0], [0, 0], 0).score).toBe(10);
  });
});

describe('selección', () => {
  const all = [
    q(1), q(2, { status: 'pending' }), q(3, { status: 'rejected' }), q(4, { difficulty: 3, documentId: 2 }),
    q(5, { sectionId: 50 }), q(6, { temaId: 9 }),
  ];
  const ctx = { seen: new Set([1]), parentOf: new Map([[50, 40]]) };
  const ids = (c: Partial<ExamConfig>) => filterQuestions(all, cfg(c), ctx).map((x) => x.id);

  it('filtra por estado, documento, dificultad, tema, artículo y vistas', () => {
    expect(ids({})).toEqual([1, 4, 5, 6]);
    expect(ids({ includePending: true })).toEqual([1, 2, 4, 5, 6]);
    expect(ids({ documentIds: [2] })).toEqual([4]);
    expect(ids({ difficulties: [3] })).toEqual([4]);
    expect(ids({ temaIds: [9] })).toEqual([6]);
    expect(ids({ sectionIds: [40] })).toEqual([5]); // apartado del artículo elegido
    expect(ids({ pool: 'new' })).toEqual([4, 5, 6]);
    expect(ids({ pool: 'seen' })).toEqual([1]);
  });

  it('limita el número y baraja opciones solo si se pide', () => {
    const many = Array.from({ length: 30 }, (_, i) => q(i + 1));
    const a = pickQuestions(many, cfg({ count: 5 }));
    expect(a.questions.map((x) => x.id)).toEqual([1, 2, 3, 4, 5]);
    expect(a.orders.every((o) => o.join() === '0,1,2,3')).toBe(true);
    const b = pickQuestions(many, cfg({ count: 20, shuffle: true }));
    expect(new Set(b.questions.map((x) => x.id)).size).toBe(20);
    expect(b.orders.every((o) => [...o].sort().join() === '0,1,2,3')).toBe(true);
  });
});

describe('servicio', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.questions.bulkAdd([q(1), q(2), q(3)].map(({ id: _id, ...rest }) => rest as Question));
  });

  it('crea, responde, finaliza una sola vez y registra intentos', async () => {
    const id = await createExam(cfg({ count: 5 }));
    const e = (await db.exams.get(id))!;
    expect(e.questionIds).toHaveLength(3);
    await setAnswer(id, 0, 0);
    await setAnswer(id, 1, 2);
    await setAnswer(id, 1, 3); // cambiar respuesta
    const done = await finishExam(id, e.startedAt + 65_000);
    expect(done).toMatchObject({ correct: 1, wrong: 1, blank: 1, durationSec: 65 });
    expect(await db.attempts.count()).toBe(3);
    await finishExam(id);
    await setAnswer(id, 2, 0); // ignorado: ya finalizado
    expect(await db.attempts.count()).toBe(3);
    expect((await db.exams.get(id))!.answers[2]).toBeNull();
    await expect(createExam(cfg({ pool: 'new' }))).rejects.toThrow(/No hay preguntas/);
  });

  it('el tiempo del simulacro no supera el límite', async () => {
    const id = await createExam(cfg({ timeLimitSec: 60 }));
    const e = (await db.exams.get(id))!;
    expect((await finishExam(id, e.startedAt + 500_000))!.durationSec).toBe(60);
  });
});

describe('repaso', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
    await db.questions.bulkAdd([q(1), q(2), q(3)].map(({ id: _id, ...rest }) => rest as Question));
  });

  it('fallos y blancos entran en repaso; aciertos suben de caja; examen por ids', async () => {
    const id = await createExam(cfg({ count: 5 }));
    await setAnswer(id, 0, 0); // acierto: no entra
    await setAnswer(id, 1, 1); // fallo
    const e = (await finishExam(id))!;
    const reviews = await db.reviews.toArray();
    expect(reviews.map((r) => r.questionId).sort()).toEqual([e.questionIds[1], e.questionIds[2]].sort());
    expect(reviews.every((r) => r.box === 1 && r.lapses === 1)).toBe(true);

    const rid = await createExamFromIds(reviews.map((r) => r.questionId), 'estudio', 0);
    const re = (await db.exams.get(rid))!;
    expect(re.questionIds).toHaveLength(2);
    for (let i = 0; i < 2; i++) await setAnswer(rid, i, 0);
    await finishExam(rid);
    expect((await db.reviews.toArray()).every((r) => r.box === 2 && r.due > Date.now())).toBe(true);
  });
});
