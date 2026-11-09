/**
 * Repetición espaciada tipo Leitner (función pura).
 *  - Fallo o en blanco → caja 1, disponible para repasar en el momento.
 *  - Acierto de una pregunta en repaso → sube de caja; vuelve tras 1, 2, 4, 8 o 16 días.
 *  - Acierto en la caja 5 → dominada: sale del repaso (null).
 *  - Acierto de una pregunta que no estaba en repaso → no se añade (null sin cambios).
 */
import type { ID, ReviewItem } from '../db/types';

export const DAY = 86_400_000;
export const INTERVAL_DAYS = [1, 2, 4, 8, 16];
export const MAX_BOX = INTERVAL_DAYS.length;

export type ReviewChange = { put: ReviewItem } | { remove: ID } | null;

export function nextReview(current: ReviewItem | undefined, questionId: ID, correct: boolean, now: number): ReviewChange {
  if (!correct) {
    return { put: { questionId, box: 1, due: now, lapses: (current?.lapses ?? 0) + 1, lastReviewed: now } };
  }
  if (!current) return null;
  if (current.box >= MAX_BOX) return { remove: questionId };
  const box = current.box + 1;
  return { put: { ...current, box, due: now + INTERVAL_DAYS[box - 1] * DAY, lastReviewed: now } };
}
