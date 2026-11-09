import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../db/db';
import type { ID } from '../db/types';
import { searchSections, type SearchHit } from '../library/search';

const LIMIT = 100;

export default function SearchResults({ query, documentId, onPick }: {
  query: string;
  documentId?: ID;
  onPick?: (sectionId: ID) => void;
}) {
  const [hits, setHits] = useState<SearchHit[] | null>(null);
  const titles = useLiveQuery(async () =>
    new Map((await db.documents.toArray()).map((d) => [d.id!, d.title])));

  useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      const r = await searchSections(query, documentId ? [documentId] : undefined, LIMIT);
      if (alive) setHits(r);
    }, 250);
    return () => { alive = false; clearTimeout(t); };
  }, [query, documentId]);

  if (!hits) return <p className="muted small">Buscando…</p>;
  if (!hits.length) return <p className="muted small">Sin resultados.</p>;
  return (
    <div className="results">
      <p className="muted small">{hits.length >= LIMIT ? `Primeros ${LIMIT} resultados` : `${hits.length} resultado(s)`}</p>
      {hits.map(({ section: s, snippet }) => {
        const head = (
          <>
            <strong>{s.label}</strong>{s.heading && ` · ${s.heading}`}
            {!documentId && <span className="muted"> — {titles?.get(s.documentId)}</span>}
          </>
        );
        return (
          <div key={s.id} className="result">
            {onPick
              ? <button className="link result-link" onClick={() => onPick(s.id!)}>{head}</button>
              : <Link to={`/biblioteca/${s.documentId}?s=${s.id}`}>{head}</Link>}
            <div className="muted small">{snippet}</div>
          </div>
        );
      })}
    </div>
  );
}
