import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { askTutor, saveTutorConfig, tutorConfig, type ChatMsg } from '../tutor/client';
import { retrieve } from '../tutor/rag';
import { canListen, canSpeak, listenOnce, Speaker, takeSentences } from '../tutor/voice';
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

  // ---- modo voz
  const [mode, setMode] = useState<'chat' | 'voz'>('chat');
  const [vstate, setV] = useState<'off' | 'listening' | 'thinking' | 'speaking' | 'paused'>('off');
  const [partial, setPartial] = useState('');
  const [vError, setVError] = useState('');
  const [muted, setMuted] = useState(false);
  const [showTx, setShowTx] = useState(true);
  const [lang, setLang] = useState(() => (ws.id.includes('ayto') ? 'ca-ES' : 'es-ES'));
  const speaker = useRef(new Speaker(lang));
  const listener = useRef<{ stop: () => void; abort: () => void } | null>(null);
  const active = useRef(false);
  const paused = useRef<null | (() => void)>(null);
  const silenced = useRef(false);
  const msgsRef = useRef<ChatMsg[] | null>(null);
  msgsRef.current = msgs;
  useEffect(() => { speaker.current.lang = lang; }, [lang]);
  useEffect(() => () => { active.current = false; listener.current?.abort(); speaker.current.cancel(); }, []);

  useEffect(() => { if (msgs === null && saved !== undefined) setMsgs((saved?.value as ChatMsg[]) ?? []); }, [saved, msgs]);
  useEffect(() => { end.current?.scrollIntoView({ block: 'end' }); }, [msgs]);

  const persist = (list: ChatMsg[]) => db.settings.put({ key: HISTORY, value: list.slice(-MAX_HISTORY) });

  async function send(text: string, onDelta?: (full: string) => void): Promise<string> {
    const q = text.trim();
    const msgs = msgsRef.current;
    if (!q || busy || !msgs) return '';
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
        (t) => { setMsgs((cur) => cur && [...cur.slice(0, -1), { ...answer, text: t }]); onDelta?.(t); }, ctrl.signal);
      list = [...list.slice(0, -1), { ...answer, text: full }];
      return full;
    } catch (e) {
      const stopped = (e as Error).name === 'AbortError';
      const last = list[list.length - 1];
      const partial = last.role === 'model' ? last : null;
      list = [...list.filter((m) => m !== partial),
        stopped && partial?.text ? { ...partial, text: `${partial.text} …` }
          : { role: 'model', text: stopped ? 'Respuesta detenida.' : (e as Error).message, at: Date.now(), error: true }];
      const last2 = list[list.length - 1];
      return last2.error ? '' : last2.text;
    } finally {
      setMsgs(list);
      await persist(list);
      setBusy(false);
      abort.current = null;
    }
  }

  /** Enviar desde la caja de texto; en modo voz sin reconocimiento (dictado del teclado) se lee la respuesta. */
  function submit() {
    if (mode === 'voz') { speaker.current.unlock(); speaker.current.muted = muted; return askAloud(input); }
    return send(input);
  }

  /** Pregunta y lee la respuesta en voz alta a medida que llega (frase a frase). */
  async function askAloud(q: string) {
    const sp = speaker.current;
    let spoken = 0;
    silenced.current = false;
    // Tras interrumpir o pausar, el resto de la respuesta que siga llegando no se lee.
    const say = (s: string) => { if (!silenced.current && paused.current === null) { setV('speaking'); sp.push(s); } };
    const full = await send(q, (t) => {
      const { sentences, next } = takeSentences(t, spoken);
      spoken = next;
      sentences.forEach(say);
    });
    if (full.length > spoken) say(full.slice(spoken));
    if (!full) say('No he podido obtener respuesta.');
    await sp.idle();
  }

  /** Conversación por turnos: escuchar → responder (en voz) → volver a escuchar. */
  async function voiceLoop() {
    let empty = 0;
    while (active.current) {
      if (paused.current !== null) {
        setV('paused');
        await new Promise<void>((r) => { paused.current = r; });
        paused.current = null;
        if (!active.current) break;
      }
      setV('listening');
      setPartial('');
      const l = listenOnce(lang, setPartial);
      listener.current = l;
      let heard = '';
      try { heard = await l.done; } catch (e) { setVError((e as Error).message); stopVoice(); return; }
      listener.current = null;
      if (!active.current || paused.current !== null) continue;
      if (!heard) {
        if (++empty >= 2) { setVError('No te he oído. Pulsa «Continuar» cuando quieras hablar.'); paused.current = () => {}; }
        continue;
      }
      empty = 0;
      setVError('');
      if (/^(fin|finalizar|terminar|adiós|adeu|para|stop)[.!]?$/i.test(heard.trim())) { stopVoice(); return; }
      setV('thinking');
      await askAloud(heard);
    }
    setV('off');
  }

  function startVoice() {
    setVError('');
    speaker.current.unlock(); // iOS: la voz solo se activa tras un gesto del usuario
    speaker.current.muted = muted;
    active.current = true;
    paused.current = null;
    void voiceLoop();
  }
  function stopVoice() {
    active.current = false;
    listener.current?.abort();
    speaker.current.cancel();
    abort.current?.abort();
    const resume = paused.current;
    paused.current = null;
    resume?.();
    setV('off');
    setPartial('');
  }
  function pauseVoice() {
    paused.current = () => {};
    listener.current?.abort();
    speaker.current.cancel();
    setV('paused');
  }
  function resumeVoice() {
    setVError('');
    const r = paused.current;
    paused.current = null;
    if (active.current) r?.(); else startVoice();
  }
  /** Interrumpir: corta la lectura y pasa a escuchar. */
  function interrupt() { silenced.current = true; speaker.current.cancel(); }
  function toggleMute() {
    const m = !muted;
    setMuted(m);
    speaker.current.muted = m;
    if (m) speaker.current.cancel();
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
          <div className="seg" role="tablist" aria-label="Modo">
            <button role="tab" aria-selected={mode === 'chat'} className={mode === 'chat' ? 'on' : ''}
              onClick={() => { stopVoice(); setMode('chat'); }}>💬 Chat</button>
            <button role="tab" aria-selected={mode === 'voz'} className={mode === 'voz' ? 'on' : ''}
              onClick={() => setMode('voz')}>🎙️ Voz</button>
          </div>
          <button className="link" onClick={() => setShowSetup(true)}>Ajustes</button>
          {!!msgs?.length && <button className="link" disabled={busy}
            onClick={async () => { if (confirm('¿Borrar la conversación?')) { setMsgs([]); await persist([]); } }}>Nueva conversación</button>}
        </div>
      </div>

      {mode === 'voz' && (
        <div className="voice card">
          {!canListen() && (
            <p className="voice-note">Este navegador no permite reconocer la voz (o la app está instalada en el iPhone).
              Alternativa gratuita: pulsa el <strong>micrófono del teclado</strong> en la caja de texto para dictar;
              las respuestas se leerán en voz alta. En iPhone funciona mejor abriendo la web en Safari.</p>
          )}
          {!canSpeak() && <p className="voice-note">Este navegador no puede leer en voz alta; verás las respuestas por escrito.</p>}
          {canListen() && (<>
            <div className={`voice-orb ${vstate}`} aria-hidden="true">
              {vstate === 'listening' ? '🎙️' : vstate === 'thinking' ? '⏳' : vstate === 'speaking' ? '🔊' : vstate === 'paused' ? '⏸️' : '🎓'}
            </div>
            <p className="voice-status" role="status">
              {{ off: 'Pulsa «Iniciar» y habla con tu tutor.', listening: 'Te escucho…', thinking: 'Consultando el temario…',
                speaking: 'Respondiendo… (pulsa «Hablar» para interrumpir)', paused: 'En pausa' }[vstate]}
            </p>
            {vstate === 'listening' && partial && <p className="voice-partial">«{partial}»</p>}
            <div className="voice-controls">
              {vstate === 'off' && <button className="primary" onClick={startVoice}>▶ Iniciar</button>}
              {vstate === 'speaking' && <button className="primary" onClick={interrupt}>🎙️ Hablar</button>}
              {vstate === 'listening' && <button onClick={() => listener.current?.stop()}>✓ He terminado</button>}
              {(vstate === 'listening' || vstate === 'speaking' || vstate === 'thinking') && <button onClick={pauseVoice}>⏸ Pausar</button>}
              {vstate === 'paused' && <button className="primary" onClick={resumeVoice}>▶ Continuar</button>}
              <button onClick={toggleMute} aria-pressed={muted}>{muted ? '🔇 Sin voz' : '🔈 Con voz'}</button>
              {vstate !== 'off' && <button className="danger" onClick={stopVoice}>■ Finalizar</button>}
            </div>
            <div className="voice-options">
              <label><input type="checkbox" checked={showTx} onChange={(e) => setShowTx(e.target.checked)} /> Transcripción</label>
              <label>Idioma <select value={lang} disabled={vstate !== 'off'} onChange={(e) => setLang(e.target.value)}>
                <option value="es-ES">Castellano</option><option value="ca-ES">Català</option></select></label>
            </div>
          </>)}
          {vError && <p className="voice-error" role="alert">{vError}</p>}
        </div>
      )}

      <div className="chat" aria-live="polite" hidden={mode === 'voz' && canListen() && !showTx}>
        {msgs?.length === 0 && mode === 'chat' && (
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

      {(mode === 'chat' || !canListen()) && (
      <form className="composer" onSubmit={(e) => { e.preventDefault(); void submit(); }}>
        <textarea value={input} onChange={(e) => setInput(e.target.value)} rows={2}
          placeholder={mode === 'voz' ? 'Dicta con el micrófono del teclado…' : 'Escribe tu pregunta…'}
          onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void submit(); } }} />
        {busy
          ? <button type="button" onClick={() => abort.current?.abort()}>Detener</button>
          : <button className="primary" type="submit" disabled={!input.trim()}>Enviar</button>}
      </form>
      )}
    </div>
  );
}
