import { describe, expect, it } from 'vitest';
import { DAY, nextReview } from './srs';

describe('Leitner', () => {
  const now = 1_000_000;
  it('fallo → caja 1 inmediata; acierto sin repaso → nada', () => {
    expect(nextReview(undefined, 7, false, now)).toEqual({ put: { questionId: 7, box: 1, due: now, lapses: 1, lastReviewed: now } });
    expect(nextReview(undefined, 7, true, now)).toBeNull();
  });
  it('acierto sube de caja con intervalos crecientes y gradúa en la 5', () => {
    const r = nextReview({ questionId: 7, box: 1, due: now, lapses: 2 }, 7, true, now);
    expect(r).toEqual({ put: { questionId: 7, box: 2, due: now + 2 * DAY, lapses: 2, lastReviewed: now } });
    expect(nextReview({ questionId: 7, box: 5, due: now, lapses: 0 }, 7, true, now)).toEqual({ remove: 7 });
    expect(nextReview({ questionId: 7, box: 4, due: now, lapses: 1 }, 7, false, now)).toMatchObject({ put: { box: 1, lapses: 2 } });
  });
});
