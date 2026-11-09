import { db } from '../db/db';
import type { ID, Section } from '../db/types';
import { fold } from '../pdf/clean';

export interface SearchHit {
  section: Section;
  snippet: string;
}

interface Entry { section: Section; hay: string; body: string }

/**
 * Caché en memoria del texto normalizado por documento. Se invalida cuando cambia
 * `updatedAt` del documento (sustitución del PDF) o cuando el documento desaparece.
 */
const cache = new Map<ID, { updatedAt: number; entries: Entry[] }>();

async function entriesFor(documentIds?: ID[]): Promise<Entry[]> {
  const docs = documentIds?.length ? (await db.documents.bulkGet(documentIds)).filter(Boolean) : await db.documents.toArray();
  const live = new Set<ID>();
  const out: Entry[] = [];
  for (const d of docs) {
    const id = d!.id!;
    live.add(id);
    let c = cache.get(id);
    if (!c || c.updatedAt !== d!.updatedAt) {
      const secs = await db.sections.where('documentId').equals(id).toArray();
      c = {
        updatedAt: d!.updatedAt,
        entries: secs.filter((s) => s.kind !== 'apartado').sort((a, b) => a.order - b.order)
          .map((s) => ({ section: s, hay: fold(`${s.label} ${s.heading} ${s.text}`), body: fold(s.text) })),
      };
      cache.set(id, c);
    }
    out.push(...c.entries);
  }
  if (!documentIds?.length) for (const id of cache.keys()) if (!live.has(id)) cache.delete(id);
  return out;
}

/** Vacía la caché (p. ej. tras restaurar una copia que reutiliza ids). */
export const clearSearchCache = () => cache.clear();

/**
 * Búsqueda insensible a tildes y mayúsculas sobre artículos, disposiciones y anexos.
 * Todas las palabras de la consulta deben aparecer; una frase entre comillas se busca literal.
 */
export async function searchSections(query: string, documentIds?: ID[], limit = 100): Promise<SearchHit[]> {
  const phrases = [...query.matchAll(/"([^"]+)"/g)].map((m) => fold(m[1].trim())).filter(Boolean);
  const words = fold(query.replace(/"[^"]*"/g, ' ')).split(/\s+/).filter((w) => w.length > 1);
  const terms = [...phrases, ...words];
  if (!terms.length) return [];

  const hits: SearchHit[] = [];
  for (const { section: s, hay, body } of await entriesFor(documentIds)) {
    if (!terms.every((t) => hay.includes(t))) continue;
    // fold() conserva la longitud en español (solo quita diacríticos), así que las posiciones coinciden.
    const pos = Math.max(0, body.indexOf(terms[0]));
    const start = Math.max(0, pos - 80);
    hits.push({
      section: s,
      snippet: (start > 0 ? '…' : '') + s.text.slice(start, pos + 160).replace(/\n/g, ' ') + '…',
    });
    if (hits.length >= limit) break;
  }
  return hits;
}
