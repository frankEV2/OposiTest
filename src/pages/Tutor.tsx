import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { askTutor, saveTutorConfig, tutorConfig, type ChatMsg } from '../tutor/client';
import { retrieve } from '../tutor/rag';
import { activeWorkspace } from '../workspaces';

const HISTORY = 'tutorHistory'; // en la base de datos de la oposición abierta → historiales separados
const MAX_HISTORY = 200;

/** Markdown mínimo y seguro (sin HTML): negritas, listas y párrafos. */
function render(text: string): ReactNode {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list}</ul>); list = []; } };
  for (const line of text.split('\n')) {
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { list.push(<li key={list.length}>{inline(li[1])}</li>); continue; }
    flush();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<p key={blocks.length}><strong>{inline(h[1])}</strong></p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  return blocks;
}

const SUGGESTIONS = [
  'Explícame con un ejemplo práctico ',
  'Hazme un esquema de ',
  'Hazme un test de 5 preguntas, de una en una, sobre ',
  'Hazme un simulacro de examen de 10 preguntas del temario',
];

function Setup({ onDone }: { onDone: () => void }) {
  const cfg = tutorConfig();
  const [url, setUrl] = useState(cfg.url);
  const [token, setToken] = useState(cfg.token);
  return (
    <div className="card tutor-setup">
      <h2>Configurar el Tutor IA</h2>
      <p className="sub">El tutor usa Gemini (cuota gratuita) a través de tu intermediario de Cloudflare, que guarda la clave.
        Pega aquí su dirección y tu código de acceso (se guardan solo en este dispositivo).</p>
      <label>Dirección del intermediario<input value={url} onChange={(e) => setUrl(e.target.value)}
        placeholder="https://opositest-tutor.tu-usuario.workers.dev" inputMode="url" /></label>
      <label>Código de acceso<input value={token} onChange={(e) => setToken(e.target.value)} type="password" autoComplete="off" /></label>
      <div className="row" style={{ marginTop: 10 }}>
        <button className="primary" disabled={!/^(https:\/\/|http:\/\/localhost)/.test(url) || !token}
          onClick={() => { saveTutorConfig(url, token); onDone(); }}>Guardar</button>
      </div>
    </div>
  );
}

export default function Tutor() {
  const ws = activeWorkspace();
  // null = no hay historial (undefined = todavía cargando)
  const saved = useLiveQuery(async () => (await db.settings.get(HISTORY)) ?? null);
  const [msgs, setMsgs] = useState<ChatMsg[] | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [configured, setConfigured] = useState(() => !!tutorConfig().url && !!tutorConfig().token);
  const [showSetup, setShowSetup] = useState(false);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);

  useEffect(() => { if (msgs === null && saved !== undefined) setMsgs((saved?.value as ChatMsg[]) ?? []); }, [saved, msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const persist = (list: ChatMsg[]) => db.settings.put({ key: HISTORY, value: list.slice(-MAX_HISTORY) });

  async function send(text: string) {
    const q = text.trim();
    if (!q || busy || !msgs) return;
    setInput('');
    const user: ChatMsg = { role: 'user', text: q, at: Date.now() };
    // En preguntas de seguimiento cortas ("¿y el plazo?") se busca también con la pregunta anterior.
    const prevUser = [...msgs].reverse().find((m) => m.role === 'user');
    const query = q.split(/\s+/).length < 7 && prevUser ? `${q} ${prevUser.text}` : q;
    let list = [...msgs, user];
    setMsgs(list);
    setBusy(true);
    const ctrl = new AbortController();
    abort.current = ctrl;
    try {
      const { chunks } = await retrieve(query);
      const refs = chunks.map((c) => ({ ref: c.ref, documentId: c.documentId, sectionId: c.sectionId }));
      const answer: ChatMsg = { role: 'model', text: '', refs, at: Date.now() };
      list = [...list, answer];
      setMsgs(list);
      const full = await askTutor(`${ws.organismo} · ${ws.nombre}`, chunks, list.slice(0, -1),
        (t) => setMsgs((cur) => cur && [...cur.slice(0, -1), { ...answer, text: t }]), ctrl.signal);
      list = [...list.slice(0, -1), { ...answer, text: full }];
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      const last = list[list.length - 1];
      const partial = last.role === 'model' ? last : null;
      list = [...list.filter((m) => m !== partial),
        stopped && partial?.text ? { ...partial, text: `${partial.text} …` }
          : { role: 'model', text: stopped ? 'Respuesta detenida.' : (e as Error).message, at: Date.now(), error: true }];
    } finally {
      setMsgs(list);
      await persist(list);
      setBusy(false);
      abort.current = null;
    }
  }

  if (!configured || showSetup) {
    return (<>
      <div className="page-head"><div><h1>Tutor IA</h1><p className="sub">{ws.nombre} · {ws.organismo}</p></div></div>
      <Setup onDone={() => { setConfigured(true); setShowSetup(false); }} />
    </>);
  }

  return (
    <div className="tutor">
      <div className="page-head">
        <div>
          <h1>Tutor IA</h1>
          <p className="sub">Responde solo con el temario de {ws.nombre} ({ws.organismo}).</p>
        </div>
        <div className="row">
          <button className="link" onClick={() => setShowSetup(true)}>Ajustes</button>
          {!!msgs?.length && <button className="link" disabled={busy}
            onClick={async () => { if (confirm('¿Borrar la conversación?')) { setMsgs([]); await persist([]); } }}>Nueva conversación</button>}
        </div>
      </div>

      <div className="chat" aria-live="polite">
        {msgs?.length === 0 && (
          <div className="chat-empty">
            <p>Pregúntame lo que quieras del temario: conceptos, artículos, plazos, diferencias entre figuras…
              También puedo hacerte tests y corregirte.</p>
            <div className="chips">
              {SUGGESTIONS.map((s) => <button key={s} onClick={() => setInput(s)}>{s.trim()}…</button>)}
            </div>
          </div>
        )}
        {msgs?.map((m, i) => (
          <div key={i} className={`bubble ${m.role}${m.error ? ' error' : ''}`}>
            {m.role === 'model' ? (m.text ? render(m.text) : <p className="muted">Consultando el temario…</p>) : <p>{m.text}</p>}
            {m.role === 'model' && !!m.refs?.length && !m.error && (
              <details className="refs">
                <summary>Fragmentos consultados ({m.refs.length})</summary>
                <ul>{m.refs.map((r) => <li key={r.sectionId}>
                  <Link to={`/biblioteca/${r.documentId}?s=${r.sectionId}`}>{r.ref}</Link></li>)}</ul>
              </details>
            )}
          </div>
        ))}
        <div ref={end} />
      </div>

      <form className="composer" onSubmit={(e) => { e.preventDefault(); void send(input); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2} placeholder="Escribe tu pregunta…"
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void send(input); } }} />
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>Detener</button>
          : <button className="primary" type="submit" disabled={!input.trim()}>Enviar</button>}
      </form>
    </div>
  );
}
