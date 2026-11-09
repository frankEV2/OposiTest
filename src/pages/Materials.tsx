import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import MermaidView from '../components/MermaidView';
import { db } from '../db/db';
import type { ID, Section } from '../db/types';
import {
  buildTree, conceptMap, CONTAINER_KINDS, flashcards, structureMap, summarize, summaryToMarkdown,
  type SummaryLevel, type TreeNode,
} from '../study/materials';

type Tab = 'esquema' | 'resumen' | 'mapa' | 'fichas';
const TABS: [Tab, string][] = [['esquema', 'Esquema'], ['resumen', 'Resumen'], ['mapa', 'Mapa conceptual'], ['fichas', 'Fichas']];

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/markdown;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
const safeName = (s: string) => s.replace(/[^\p{L}\d]+/gu, '-').replace(/^-|-$/g, '').slice(0, 60) || 'documento';

function Outline({ nodes, docId }: { nodes: TreeNode[]; docId: ID }) {
  return (
    <ul className="schema">
      {nodes.map(({ section: s, children }) => (
        <li key={s.id} className={CONTAINER_KINDS.includes(s.kind) ? 'cont' : ''}>
          <Link to={`/biblioteca/${docId}?s=${s.id}`}>{s.label}</Link>
          {s.heading && <span>{CONTAINER_KINDS.includes(s.kind) ? ' · ' : '. '}{s.heading}</span>}
          {children.length > 0 && <Outline nodes={children} docId={docId} />}
        </li>
      ))}
    </ul>
  );
}

function outlineMd(nodes: TreeNode[], depth = 0): string {
  return nodes.map(({ section: s, children }) =>
    `${'  '.repeat(depth)}- ${s.label}${s.heading ? `. ${s.heading}` : ''}\n${outlineMd(children, depth + 1)}`).join('');
}

function Flashcards({ sections, root }: { sections: Section[]; root?: ID }) {
  const base = useMemo(() => flashcards(sections, root), [sections, root]);
  const [cards, setCards] = useState(base);
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  useEffect(() => { setCards(base); setI(0); setFlipped(false); }, [base]);
  if (!cards.length) return <p className="muted">No se han detectado definiciones, plazos, competencias ni enumeraciones en este ámbito.</p>;
  const c = cards[i];
  const go = (d: number) => { setI((i + d + cards.length) % cards.length); setFlipped(false); };
  function shuffle() {
    const a = [...cards];
    for (let k = a.length - 1; k > 0; k--) { const j = Math.floor(Math.random() * (k + 1)); [a[k], a[j]] = [a[j], a[k]]; }
    setCards(a); setI(0); setFlipped(false);
  }
  return (
    <div>
      <button className={`flashcard${flipped ? ' flipped' : ''}`} onClick={() => setFlipped(!flipped)}>
        <span className="muted small">{flipped ? 'Respuesta' : 'Pregunta'} · {c.reference}</span>
        <span className="fc-text">{flipped ? c.back : c.front}</span>
        {!flipped && <span className="muted small">Pulsa para ver la respuesta</span>}
      </button>
      <div className="row" style={{ justifyContent: 'center', marginTop: 12 }}>
        <button onClick={() => go(-1)}>← Anterior</button>
        <span className="muted small">{i + 1} / {cards.length}</span>
        <button onClick={() => go(1)}>Siguiente →</button>
        <button onClick={shuffle}>Barajar</button>
      </div>
    </div>
  );
}

export default function Materials() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const docId = params.get('doc') ? Number(params.get('doc')) : undefined;
  const root = params.get('root') ? Number(params.get('root')) : undefined;
  const tab = (params.get('tab') as Tab) || 'esquema';
  const [level, setLevel] = useState<SummaryLevel>('breve');
  const [mapMode, setMapMode] = useState<'estructura' | 'conceptos'>('estructura');

  const docs = useLiveQuery(() => db.documents.filter((d) => d.extraction !== 'scanned').toArray());
  const doc = docs?.find((d) => d.id === docId);
  const sections = useLiveQuery(async () => (docId === undefined ? [] : db.sections.where('documentId').equals(docId).toArray()), [docId]);

  const update = (patch: Record<string, string | undefined>) => {
    const next = new URLSearchParams(params);
    for (const [k, v] of Object.entries(patch)) if (v === undefined) next.delete(k); else next.set(k, v);
    setParams(next, { replace: true });
  };

  useEffect(() => {
    if (docId === undefined && docs?.length === 1) update({ doc: String(docs[0].id) });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docs, docId]);

  const containers = (sections ?? []).filter((s) => CONTAINER_KINDS.includes(s.kind)).sort((a, b) => a.order - b.order);
  const scopeName = root ? containers.find((c) => c.id === root) : undefined;
  const title = doc ? `${doc.title}${scopeName ? ` — ${scopeName.label}` : ''}` : '';
  const tree = useMemo(() => buildTree(sections ?? [], root), [sections, root]);
  const blocks = useMemo(() => summarize(sections ?? [], level, root), [sections, level, root]);
  const map = useMemo(
    () => (mapMode === 'estructura' ? structureMap : conceptMap)(sections ?? [], root, title),
    [sections, root, title, mapMode],
  );
  const openSection = useCallback((sid: number) => navigate(`/biblioteca/${docId}?s=${sid}`), [navigate, docId]);

  return (
    <>
      <h1>Esquemas y resúmenes</h1>
      <p className="sub">Material generado únicamente a partir del texto de tus documentos, sin redacción inventada.</p>

      {docs?.length === 0 ? (
        <div className="card muted">Importa documentos con texto en la <Link to="/biblioteca">Biblioteca</Link> para generar material.</div>
      ) : (
        <div className="card row no-print">
          <select aria-label="Documento" value={docId ?? ''} onChange={(e) => update({ doc: e.target.value || undefined, root: undefined })}>
            <option value="">Elige un documento…</option>
            {docs?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
          {containers.length > 0 && (
            <select aria-label="Ámbito" value={root ?? ''} onChange={(e) => update({ root: e.target.value || undefined })}>
              <option value="">Documento completo</option>
              {containers.map((c) => (
                <option key={c.id} value={c.id}>
                  {'\u00a0\u00a0'.repeat(CONTAINER_KINDS.indexOf(c.kind))}{c.label}{c.heading ? ` · ${c.heading}` : ''}
                </option>
              ))}
            </select>
          )}
        </div>
      )}

      {doc && sections && (
        sections.length === 0 ? (
          <div className="card muted">No se detectó estructura en este documento; no es posible generar material.</div>
        ) : (
          <>
            <div className="tabs no-print" style={{ marginBottom: 12 }}>
              {TABS.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => update({ tab: t })}>{l}</button>)}
            </div>

            {tab === 'esquema' && (
              <div className="card">
                <div className="row no-print" style={{ justifyContent: 'flex-end' }}>
                  <button onClick={() => download(`esquema-${safeName(title)}.md`, `# ${title}\n\n${outlineMd(tree)}`)}>Descargar .md</button>
                  <button onClick={() => window.print()}>Imprimir</button>
                </div>
                <h2 className="print-only">{title}</h2>
                <Outline nodes={tree} docId={doc.id!} />
              </div>
            )}

            {tab === 'resumen' && (
              <div className="card">
                <div className="row no-print" style={{ justifyContent: 'space-between' }}>
                  <div className="tabs">
                    {(['breve', 'medio', 'completo'] as const).map((l) => (
                      <button key={l} className={level === l ? 'on' : ''} onClick={() => setLevel(l)}>{l[0].toUpperCase() + l.slice(1)}</button>
                    ))}
                  </div>
                  <div className="row">
                    <button onClick={() => download(`resumen-${level}-${safeName(title)}.md`, summaryToMarkdown(title, level, blocks))}>Descargar .md</button>
                    <button onClick={() => window.print()}>Imprimir</button>
                  </div>
                </div>
                <p className="notice">
                  Resumen extractivo: {level === 'breve' ? 'estructura y rúbricas de los artículos'
                    : level === 'medio' ? 'rúbricas y primera frase literal de cada apartado' : 'texto íntegro'}.
                  No contiene redacción propia.
                </p>
                <h2 className="print-only">{title} — resumen {level}</h2>
                {blocks.map((b) => (
                  <div key={b.section.id} className={`sum-block ${CONTAINER_KINDS.includes(b.section.kind) ? 'cont' : ''}`}
                    style={{ marginLeft: Math.min(b.depth, 4) * 14 }}>
                    <div className="sum-head">
                      <strong>{b.section.label}</strong>{b.section.heading && <> {CONTAINER_KINDS.includes(b.section.kind) ? '· ' : '. '}{b.section.heading}</>}
                    </div>
                    {b.lines.map((l, k) => <p key={k}>{l}</p>)}
                  </div>
                ))}
              </div>
            )}

            {tab === 'mapa' && (
              <div className="card">
                <div className="row no-print" style={{ marginBottom: 8 }}>
                  <div className="tabs">
                    <button className={mapMode === 'estructura' ? 'on' : ''} onClick={() => setMapMode('estructura')}>Estructura</button>
                    <button className={mapMode === 'conceptos' ? 'on' : ''} onClick={() => setMapMode('conceptos')}>Conceptos</button>
                  </div>
                  <span className="muted small">
                    {mapMode === 'estructura' ? 'Pulsa un nodo para leer el texto.' : 'Definiciones, enumeraciones, plazos y competencias detectados.'}
                  </span>
                </div>
                {map.truncated && (
                  <p className="notice">El mapa se ha limitado a {map.nodes} nodos para que sea legible. Elige un título o capítulo en «Ámbito» para ver el resto.</p>
                )}
                {map.nodes === 0
                  ? <p className="muted">No hay elementos que representar en este ámbito.</p>
                  : <MermaidView code={map.code} onNodeClick={openSection} />}
              </div>
            )}

            {tab === 'fichas' && <div className="card"><Flashcards sections={sections} root={root} /></div>}
          </>
        )
      )}
    </>
  );
}
