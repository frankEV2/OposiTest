/**
 * Banco de preguntas con IA al estilo de los exámenes oficiales (Gemini a través del intermediario).
 * Control de calidad local antes de guardar cada pregunta:
 *  - la respuesta correcta debe estar respaldada por una CITA LITERAL que exista en el temario;
 *  - sin números de artículo en el enunciado ni preguntas del tipo «¿qué artículo…?»;
 *  - 4 opciones distintas, una correcta, opciones compuestas solo al final (orden fijo);
 *  - sin duplicados ni casi duplicados (mismo enunciado con otras palabras).
 * El progreso se guarda: se puede parar y continuar (cuota gratuita limitada).
 */
import { db } from '../db/db';
import type { ID, Question, Section } from '../db/types';
import { shortDocTitle } from '../engine/generate';
import { hash, norm, shuffle } from '../engine/text';
import { tutorConfig } from './client';

interface Frag { ref: string; text: string; section: Section; key: string }
interface AiQ {
  enunciado: string; opciones: string[]; correcta: number; explicacion: string;
  fragmento: number; cita: string; tipo?: string; orden_fijo?: boolean;
}
export interface AiProgress { done: number; total: number; added: number; rejected: Record<string, number>; message?: string }

const DONE_KEY = 'aiQuestionsDone';
const PAUSE_MS = 4500; // ritmo compatible con la cuota gratuita por minuto
const BATCH_CHARS = 5500;
const COMPOUND = /^(todas|ninguna|las respuestas|la\s+a\)|las\s+opciones|ambas)/i;
const ARTICLE_IN_STEM = /(art[ií]culo|art\.)\s*\d|qu[ée]\s+art[ií]culo|en\s+qu[ée]\s+(art[ií]culo|precepto)/i;

const words = (s: string) => new Set(norm(s).split(/\W+/u).filter((w) => w.length > 3));
function similar(a: Set<string>, b: Set<string>) {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / Math.max(1, Math.min(a.size, b.size));
}

/** Unidades de estudio a nivel de artículo (incluye sus apartados), anexo o apartado de apuntes. */
async function fragmentsOf(documentId: ID): Promise<Frag[]> {
  const doc = await db.documents.get(documentId);
  if (!doc) return [];
  const secs = (await db.sections.where('documentId').equals(documentId).sortBy('order'))
    .filter((s) => ['articulo', 'disposicion', 'anexo'].includes(s.kind) && s.text.trim().length > 80);
  const title = shortDocTitle(doc.title);
  return secs.map((s) => ({
    section: s, key: `${doc.sha256}:${s.order}`, text: s.text.slice(0, 3800),
    ref: `${title}, ${s.label.replace(/^Artículo\s+/i, 'art. ')}${s.heading ? ` (${s.heading.replace(/\.$/, '')})` : ''}`,
  }));
}

async function callWorker(oposicion: string, frags: Frag[], count: number, avoid: string[], signal?: AbortSignal) {
  const { url, token } = tutorConfig();
  if (!url || !token) throw new Error('Configura el Tutor IA (código de acceso) para generar preguntas con IA.');
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': token },
    body: JSON.stringify({ task: 'questions', oposicion, count, avoid, context: frags.map((f) => ({ ref: f.ref, text: f.text })) }),
  });
  if (res.status === 429) return { quota: true as const, items: [] };
  if (res.status >= 500) return { busy: true as const, quota: false as const, items: [] };
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || `Error ${res.status}`);
  const data = await res.json().catch(() => ({ preguntas: [] }));
  return { quota: false as const, items: (Array.isArray(data.preguntas) ? data.preguntas : []) as AiQ[] };
}

/** Valida una pregunta de la IA; devuelve el motivo de rechazo o la pregunta lista para guardar. */
export function checkAiQuestion(q: AiQ, frags: { text: string; ref: string }[]):
  { reason: string } | { stem: string; options: [string, string, string, string]; correct: 0 | 1 | 2 | 3; frag: number; fixed: boolean } {
  const stem = String(q.enunciado ?? '').trim();
  const opts = (q.opciones ?? []).map((o) => String(o).replace(/^[a-d]\)\s*/i, '').trim());
  if (stem.length < 20 || opts.length !== 4 || opts.some((o) => !o || o.length > 320)) return { reason: 'formato incorrecto' };
  if (!(q.correcta >= 0 && q.correcta <= 3)) return { reason: 'formato incorrecto' };
  if (ARTICLE_IN_STEM.test(stem)) return { reason: 'pregunta por número de artículo' };
  if (new Set(opts.map(norm)).size !== 4) return { reason: 'opciones repetidas' };
  const fi = Number(q.fragmento) - 1;
  const frag = frags[fi] ?? frags.find((f) => norm(f.text).includes(norm(q.cita ?? '')));
  const cita = norm(String(q.cita ?? '')).replace(/[«»"“”]/g, '');
  if (!frag || cita.length < 15 || !norm(frag.text).includes(cita)) return { reason: 'sin cita literal del temario' };
  const compound = opts.map((o) => COMPOUND.test(o));
  if (compound.slice(0, 3).some(Boolean)) return { reason: 'opción compuesta fuera de lugar' };
  // La respuesta correcta (si no es compuesta) debe compartir contenido con la cita o el fragmento.
  const correct = opts[q.correcta];
  if (!compound[q.correcta] && similar(words(correct), words(frag.text)) < 0.5) return { reason: 'respuesta no respaldada por el texto' };
  // Pista involuntaria: la correcta mucho más larga que todas las demás.
  const others = opts.filter((_, i) => i !== q.correcta && !compound[i]).map((o) => o.length);
  if (!compound[q.correcta] && others.length && correct.length > 1.5 * Math.max(...others) && correct.length - Math.max(...others) > 25) {
    return { reason: 'la correcta se delata por su longitud' };
  }
  if (/^(la|esta|dicha)\s+(norma|ley)\b/i.test(stem)) return { reason: 'enunciado sin nombrar la norma' };
  // Distractores que se delatan con palabras absolutas que la correcta no tiene.
  const ABS = /(?<!\p{L})(exclusivamente|únicamente|unicamente|solamente|nunca|en ningún caso|siempre y en todo caso)(?!\p{L})/iu;
  const absWrong = opts.filter((o, i) => i !== q.correcta && ABS.test(o)).length;
  if (absWrong >= 2 && !ABS.test(correct)) return { reason: 'distractores delatados por palabras absolutas' };
  return { stem, options: opts as [string, string, string, string], correct: q.correcta as 0 | 1 | 2 | 3, frag: frags.indexOf(frag), fixed: compound[3] };
}

/** Genera preguntas con IA para los documentos indicados, repartidas por todos sus artículos/apartados. */
export async function generateWithAI(
  documentIds: ID[], oposicion: string, onProgress: (p: AiProgress) => void, signal?: AbortSignal,
): Promise<AiProgress> {
  const done = new Set(((await db.settings.get(DONE_KEY))?.value as string[] | undefined) ?? []);
  const all: Frag[] = [];
  for (const id of documentIds) all.push(...(await fragmentsOf(id)));
  const todo = all.filter((f) => !done.has(f.key));
  // Lotes de artículos consecutivos del mismo documento.
  const batches: Frag[][] = [];
  for (const f of todo) {
    const last = batches[batches.length - 1];
    const size = last?.reduce((a, x) => a + x.text.length, 0) ?? Infinity;
    if (last && last[0].section.documentId === f.section.documentId && size + f.text.length <= BATCH_CHARS && last.length < 5) last.push(f);
    else batches.push([f]);
  }
  const p: AiProgress = { done: 0, total: batches.length, added: 0, rejected: {} };
  const reject = (r: string) => { p.rejected[r] = (p.rejected[r] ?? 0) + 1; };
  onProgress({ ...p });
  const existing = await db.questions.toArray();
  const hashes = new Set(existing.map((q) => q.hash));
  const stems = existing.filter((q) => q.rule === 'ia').map((q) => ({ doc: q.documentId, w: words(q.stem) }));

  for (const batch of batches) {
    if (signal?.aborted) break;
    const docId = batch[0].section.documentId;
    const count = Math.max(2, Math.min(8, Math.round(batch.reduce((a, f) => a + f.text.length, 0) / 700)));
    const avoid = existing.filter((q) => q.documentId === docId && q.rule === 'ia').slice(-30).map((q) => q.stem);
    let r: Awaited<ReturnType<typeof callWorker>> = await callWorker(oposicion, batch, count, avoid, signal);
    // Reintentos: cuota por minuto (429) o Gemini saturado (5xx) son pasajeros.
    for (let retry = 0; (r.quota || 'busy' in r) && retry < 3 && !signal?.aborted; retry++) {
      const wait = r.quota ? 60_000 : 15_000 * (retry + 1);
      onProgress({ ...p, message: r.quota ? 'Cuota por minuto alcanzada: esperando 60 s…' : 'Gemini está saturado: reintentando…' });
      await new Promise((ok) => setTimeout(ok, wait));
      r = await callWorker(oposicion, batch, count, avoid, signal);
    }
    if (r.quota) { p.message = 'Se ha agotado la cuota gratuita de hoy. Pulsa de nuevo mañana: continuará donde lo dejó.'; break; }
    if ('busy' in r) { p.message = 'Gemini no responde ahora mismo. Vuelve a pulsar más tarde: continuará donde lo dejó.'; break; }
    const now = Date.now();
    const doc = await db.documents.get(docId);
    const fresh: Question[] = [];
    const perFrag = new Map<number, number>();
    for (const q of r.items) {
      const v = checkAiQuestion(q, batch);
      if ('reason' in v) { reject(v.reason); continue; }
      // Reparto: como máximo 2 preguntas por artículo en cada tanda.
      if ((perFrag.get(v.frag) ?? 0) >= 2) { reject('demasiadas del mismo artículo'); continue; }
      perFrag.set(v.frag, (perFrag.get(v.frag) ?? 0) + 1);
      const h = hash(`${norm(v.stem)}|${norm(v.options[v.correct])}`);
      const w = words(v.stem);
      if (hashes.has(h) || stems.some((s) => s.doc === docId && similar(s.w, w) >= 0.8)) { reject('duplicada'); continue; }
      // Sin opciones compuestas, el orden se baraja aquí para repartir la posición de la correcta.
      let options = v.options;
      let correct = v.correct;
      if (!v.fixed) {
        const order = shuffle([0, 1, 2, 3], Math.random);
        options = order.map((i) => v.options[i]) as typeof options;
        correct = order.indexOf(v.correct) as typeof correct;
      }
      const f = batch[v.frag];
      hashes.add(h);
      stems.push({ doc: docId, w });
      fresh.push({
        hash: h, uid: h, documentId: docId, sectionId: f.section.id, temaId: doc?.temaId,
        stem: v.stem, options, correctIndex: correct, fixedOrder: v.fixed || undefined,
        explanation: String(q.explicacion ?? '').trim() || `Lo establece ${f.ref}.`,
        reference: f.ref, sourceExcerpt: String(q.cita), difficulty: q.tipo === 'practico' ? 3 : 2,
        status: 'pending', rule: 'ia', createdAt: now, updatedAt: now,
      });
    }
    if (fresh.length) { await db.questions.bulkAdd(fresh); existing.push(...fresh); }
    p.added += fresh.length;
    batch.forEach((f) => done.add(f.key));
    await db.settings.put({ key: DONE_KEY, value: [...done] });
    p.done++;
    onProgress({ ...p, message: undefined });
    if (p.done < p.total) await new Promise((ok) => setTimeout(ok, PAUSE_MS));
  }
  return p;
}

/** Olvida qué artículos ya se procesaron (para volver a generar sobre todo el temario). */
export const resetAiProgress = () => db.settings.delete(DONE_KEY);
