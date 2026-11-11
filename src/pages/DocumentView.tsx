import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import SearchResults from '../components/SearchResults';
import { db } from '../db/db';
import type { ID, Section } from '../db/types';

const CONTAINERS = new Set(['libro', 'titulo', 'capitulo', 'seccion']);

function Outline({ sections, selected, onSelect }: {
  sections: Section[]; selected?: ID; onSelect: (id: ID) => void;
}) {
  const children = useMemo(() => {
    const m = new Map<ID | undefined, Section[]>();
    for (const s of sections) {
      if (s.kind === 'apartado') continue;
      const arr = m.get(s.parentId) ?? [];
      arr.push(s);
      m.set(s.parentId, arr);
    }
    return m;
  }, [sections]);

  const render = (parent: ID | undefined, depth: number): React.ReactNode => (
    <ul className="outline">
      {(children.get(parent) ?? []).map((s) =>
        CONTAINERS.has(s.kind) ? (
          <li key={s.id}>
            <details open={depth < 1}>
              <summary>
                <button className={`link${selected === s.id ? ' sel' : ''}`} onClick={() => onSelect(s.id!)}>
                  <strong>{s.label}</strong>{s.heading && ` ${s.heading}`}
                </button>
              </summary>
              {render(s.id, depth + 1)}
            </details>
          </li>
        ) : (
          <li key={s.id}>
            <button className={`link${selected === s.id ? ' sel' : ''}`} onClick={() => onSelect(s.id!)}>
              {s.label}{s.heading && <span className="muted"> {s.heading}</span>}
            </button>
          </li>
        ),
      )}
    </ul>
  );
  return <>{render(undefined, 0)}</>;
}

export default function DocumentView() {
  const id = Number(useParams().id);
  const [params, setParams] = useSearchParams();
  const selected = params.get('s') ? Number(params.get('s')) : undefined;
  const [mode, setMode] = useState<'estructura' | 'paginas'>('estructura');
  const [query, setQuery] = useState('');
  const [pdfUrl, setPdfUrl] = useState<string>();

  const doc = useLiveQuery(() => db.documents.get(id), [id]);
  const sections = useLiveQuery(() => db.sections.where('[documentId+order]')
    .between([id, -Infinity], [id, Infinity]).toArray(), [id]);
  const pages = useLiveQuery(
    async () => (mode === 'paginas' ? await db.pages.where('documentId').equals(id).sortBy('page') : undefined), [id, mode]);

  useEffect(() => () => { if (pdfUrl) URL.revokeObjectURL(pdfUrl); }, [pdfUrl]);
  useEffect(() => {
    if (selected) document.getElementById(`sec-${selected}`)?.scrollIntoView({ block: 'start' });
  }, [selected, sections]);

  if (doc === undefined && sections === undefined) return null;
  if (!doc) return <><h1>Documento no encontrado</h1><Link to="/biblioteca">Volver a la biblioteca</Link></>;

  async function openPdf() {
    const f = await db.documentFiles.get(id);
    if (!f) return;
    // Markdown: se abre como texto plano UTF-8 para que el navegador lo muestre en vez de descargarlo.
    const blob = /markdown|text/.test(f.blob.type) ? new Blob([f.blob], { type: 'text/plain;charset=utf-8' }) : f.blob;
    const url = URL.createObjectURL(blob);
    setPdfUrl(url);
    window.open(url, '_blank', 'noopener');
  }

  const select = (sid: ID) => setParams({ s: String(sid) }, { replace: true });
  const sel = sections?.find((s) => s.id === selected);
  // Un contenedor (título, capítulo…) muestra todos sus descendientes; un artículo, solo él.
  const shown: Section[] = [];
  if (sel) {
    const inside = new Set<ID>([sel.id!]);
    for (const s of sections ?? []) {
      if (s.id === sel.id || (s.parentId !== undefined && inside.has(s.parentId) && CONTAINERS.has(sel.kind))) {
        inside.add(s.id!);
        if (s.kind !== 'apartado') shown.push(s);
      }
    }
  }
  const hasStructure = (sections?.length ?? 0) > 0;

  return (
    <>
      <Link to="/biblioteca" className="small">← Biblioteca</Link>
      <div className="page-head">
        <div style={{ minWidth: 0 }}>
          <h1>{doc.title}</h1>
          <p className="sub">{doc.fileName} · {doc.pageCount} páginas · {sections?.filter((s) => s.kind === 'articulo').length ?? 0} artículos</p>
        </div>
        <button onClick={openPdf}>{/\.(md|markdown|txt)$/i.test(doc.fileName) ? 'Abrir original (.md)' : 'Abrir PDF original'}</button>
      </div>
      {doc.warnings.map((w) => <div key={w} className="warning">{w}</div>)}

      {doc.extraction !== 'scanned' && (
        <>
          <div className="row" style={{ margin: '12px 0' }}>
            <div className="tabs">
              <button className={mode === 'estructura' ? 'on' : ''} onClick={() => setMode('estructura')}>Estructura</button>
              <button className={mode === 'paginas' ? 'on' : ''} onClick={() => setMode('paginas')}>Texto por páginas</button>
            </div>
            <input type="search" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Buscar en este documento" />
          </div>
          {query.trim() && (
            <div className="card">
              <SearchResults query={query} documentId={id} onPick={(sid) => { setMode('estructura'); select(sid); setQuery(''); }} />
            </div>
          )}

          {mode === 'estructura' && (hasStructure ? (
            <div className="reader">
              <nav className="card reader-nav">
                <Outline sections={sections!} selected={selected} onSelect={select} />
              </nav>
              <article className="card reader-body">
                {!sel && <p className="muted">Selecciona un título, capítulo o artículo en el índice.</p>}
                {shown.map((s) => (
                  <section key={s.id} id={`sec-${s.id}`} className="sec">
                    <h3>{s.label}{s.heading && <span className="muted"> · {s.heading}</span>}</h3>
                    <p className="muted small">Página {s.pageStart}</p>
                    {s.text.split('\n').filter(Boolean).map((p, i) => <p key={i}>{p}</p>)}
                  </section>
                ))}
              </article>
            </div>
          ) : (
            <div className="card muted">No se ha detectado estructura de artículos. Consulta el texto por páginas.</div>
          ))}

          {mode === 'paginas' && pages?.map((p) => (
            <div key={p.id} className="card">
              <p className="muted small">Página {p.page}</p>
              <div className="page-text">{p.text || <em className="muted">Sin texto</em>}</div>
            </div>
          ))}
        </>
      )}
    </>
  );
}
