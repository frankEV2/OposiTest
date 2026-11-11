/**
 * Recuperación local (RAG) sobre el temario de la oposición abierta: la base de datos ya es la de esa
 * oposición, así que nunca se mezclan documentos. Índice BM25 en memoria sobre artículos/apartados
 * (las mismas unidades que usa el generador de preguntas). Solo se envían a la IA los mejores fragmentos.
 */
import { db } from '../db/db';
import type { ID } from '../db/types';
import { unitsFromSections } from '../engine/store';
import { shortDocTitle } from '../engine/generate';
import { fold } from '../pdf/clean';

export interface Chunk {
  documentId: ID;
  sectionId: ID;
  ref: string;
  text: string;
}

const STOP = new Set(('de la el en y a los las del se que por con para un una su al lo como mas o es son ser sus este esta ' +
  'les els i amb per una dels al pel quan que ha han de en un es son seva seu aquesta aquest no si sobre entre ' +
  'cual cuales que quien como donde explica explicame dime hazme sobre tema temario articulo article pregunta preguntas').split(' '));
const words = (s: string) => fold(s).match(/[a-z0-9ñç·]{2,}/g)?.filter((w) => !STOP.has(w)) ?? [];
const stem = (w: string) => (w.length > 5 ? w.slice(0, Math.max(5, w.length - 2)) : w);

interface Index { chunks: Chunk[]; tf: Map<string, number>[]; df: Map<string, number>; len: number[]; avg: number }
let cache: Promise<Index> | null = null;
export const clearTutorIndex = () => { cache = null; };

async function build(): Promise<Index> {
  const [sections, docs] = await Promise.all([db.sections.toArray(), db.documents.toArray()]);
  const title = new Map(docs.map((d) => [d.id!, shortDocTitle(d.title)]));
  const units = unitsFromSections(sections);
  const chunks: Chunk[] = units.map((u) => ({
    documentId: u.documentId, sectionId: u.sectionId,
    ref: `${title.get(u.documentId) ?? ''}, ${u.label.replace(/^Artículo\s+/i, 'art. ')}${u.heading ? ` (${u.heading})` : ''}`,
    text: u.text.length > 2500 ? `${u.text.slice(0, 2500)}…` : u.text,
  }));
  const df = new Map<string, number>();
  const tf = chunks.map((c) => {
    const m = new Map<string, number>();
    for (const w of words(`${c.ref} ${c.ref} ${c.text}`)) m.set(stem(w), (m.get(stem(w)) ?? 0) + 1);
    for (const k of m.keys()) df.set(k, (df.get(k) ?? 0) + 1);
    return m;
  });
  const len = tf.map((m) => [...m.values()].reduce((a, b) => a + b, 0));
  return { chunks, tf, df, len, avg: len.reduce((a, b) => a + b, 0) / Math.max(1, len.length) };
}

/** Fragmentos más relevantes (BM25). Si la consulta es genérica (p. ej. "hazme un simulacro"), muestra variada. */
export async function retrieve(query: string, k = 6): Promise<{ chunks: Chunk[]; matched: boolean }> {
  const ix = await (cache ??= build());
  if (!ix.chunks.length) return { chunks: [], matched: false };
  const q = [...new Set(words(query).map(stem))];
  const N = ix.chunks.length;
  const scored = ix.chunks.map((c, i) => {
    let s = 0;
    for (const t of q) {
      const f = ix.tf[i].get(t);
      if (!f) continue;
      const idf = Math.log(1 + (N - (ix.df.get(t) ?? 0) + 0.5) / ((ix.df.get(t) ?? 0) + 0.5));
      s += idf * ((f * 2.2) / (f + 1.2 * (0.25 + 0.75 * ix.len[i] / ix.avg)));
    }
    return { c, s };
  }).filter((x) => x.s > 0).sort((a, b) => b.s - a.s);
  if (scored.length && scored[0].s >= 2) {
    const top = scored[0].s;
    return { chunks: scored.filter((x) => x.s >= top * 0.35).slice(0, k).map((x) => x.c), matched: true };
  }
  // Consulta genérica: muestra repartida por el temario para tests/simulacros.
  const step = Math.max(1, Math.floor(N / k));
  const offset = Math.floor(Math.random() * step);
  return { chunks: Array.from({ length: Math.min(k, N) }, (_, i) => ix.chunks[(offset + i * step) % N]), matched: false };
}
