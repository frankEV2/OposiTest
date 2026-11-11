import { useLiveQuery } from 'dexie-react-hooks';
import { Fragment, useEffect, useRef, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import { askTutor, saveTutorConfig, tutorConfig, type ChatMsg } from '../tutor/client';
import { retrieve } from '../tutor/rag';
import { canListen, canSpeak, listenOnce, ScreenAwake, Speaker, takeSentences } from '../tutor/voice';
import { activeWorkspace } from '../workspaces';
import GeminiUsage from '../components/GeminiUsage';

const HISTORY = 'tutorHistory'; // en la base de datos de la oposición abierta → historiales separados
const MAX_HISTORY = 200;

/** Opción de pregunta tipo test: «a) …», «**B.** …», «c - …». */
const OPTION = /^\s*[-*•]?\s*\**\(?([a-dA-D])\s*[).:-]\**\s+(.+)$/;

/**
 * Markdown mínimo y seguro (sin HTML): negritas, listas y párrafos.
 * Si `onOption` se indica, las opciones a)–d) de una pregunta tipo test se muestran como botones.
 */
function render(text: string, onOption?: (letter: string, option: string) => void): ReactNode {
  const inline = (s: string) => s.split(/(\*\*[^*]+\*\*)/g).map((p, i) =>
    p.startsWith('**') && p.endsWith('**') ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>);
  const blocks: ReactNode[] = [];
  let list: ReactNode[] = [];
  let opts: { letter: string; text: string }[] = [];
  const flush = () => { if (list.length) { blocks.push(<ul key={blocks.length}>{list}</ul>); list = []; } };
  const flushOpts = () => {
    if (!opts.length) return;
    // Solo es una pregunta de test si hay al menos 3 opciones seguidas.
    if (opts.length >= 3 && onOption) {
      blocks.push(
        <div key={blocks.length} className="quiz-opts" role="group" aria-label="Opciones de respuesta">
          {opts.map((o) => (
            <button key={o.letter} type="button" onClick={() => onOption(o.letter, o.text)}>
              <span className="quiz-letter">{o.letter})</span> {inline(o.text)}
            </button>
          ))}
        </div>,
      );
    } else {
      opts.forEach((o) => blocks.push(<p key={blocks.length}>{o.letter}) {inline(o.text)}</p>));
    }
    opts = [];
  };
  for (const line of text.split('\n')) {
    const op = line.match(OPTION);
    if (op) { flush(); opts.push({ letter: op[1].toLowerCase(), text: op[2].replace(/\*\*$/, '') }); continue; }
    if (line.trim()) flushOpts();
    const li = line.match(/^\s*(?:[-*•]|\d+[.)])\s+(.*)$/);
    if (li) { list.push(<li key={list.length}>{inline(li[1])}</li>); continue; }
    flush();
    const h = line.match(/^#{1,4}\s+(.*)$/);
    if (h) blocks.push(<p key={blocks.length}><strong>{inline(h[1])}</strong></p>);
    else if (line.trim()) blocks.push(<p key={blocks.length}>{inline(line)}</p>);
  }
  flush();
  flushOpts();
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
        Escribe tu código de acceso (el ACCESS_TOKEN de Cloudflare). Se guarda solo en este navegador: hay que ponerlo una vez en cada dispositivo.</p>
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
  const sessionId = useRef(0);
  const everHeard = useRef(false);
  const awake = useRef(new ScreenAwake());
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
  /**
   * Máquina de estados de la conversación (un solo bucle, nunca dos a la vez):
   *   escuchando → (fin de intervención por silencio) → procesando → hablando → escuchando …
   * El micrófono está cerrado mientras habla el tutor, así nunca transcribe su propia voz.
   * Un silencio sin palabras no detiene nada: se vuelve a escuchar. Solo «Finalizar» termina la sesión.
   */
  async function voiceLoop(session: number) {
    let failures = 0;
    let lastSent = '';
    while (active.current && session === sessionId.current) {
      if (paused.current !== null) {
        setV('paused');
        await new Promise<void>((r) => { paused.current = r; });
        paused.current = null;
        continue;
      }
      setV('listening');
      setPartial('');
      const started = Date.now();
      const l = listenOnce(lang, setPartial);
      listener.current = l;
      let heard = '';
      try {
        heard = await l.done;
        failures = 0;
      } catch (e) {
        listener.current = null;
        const msg = (e as Error).message || String(e);
        if (/denegado|not-allowed/i.test(msg) && Date.now() - started > 0 && everHeard.current) {
          // Safari puede exigir un toque para volver a abrir el micrófono: se ofrece «Toca para hablar».
          setVError('El navegador ha cerrado el micrófono. Toca «🎙️ Hablar» para seguir.');
          paused.current = () => {};
          continue;
        }
        if (++failures >= 3 || /denegado/i.test(msg)) { setVError(msg); stopVoice(); return; }
        await new Promise((r) => setTimeout(r, 400 * failures)); // error puntual (red, audio): reintento
        continue;
      }
      listener.current = null;
      if (!active.current || session !== sessionId.current || paused.current !== null) continue;
      heard = heard.trim();
      if (!heard) { await new Promise((r) => setTimeout(r, 150)); continue; } // silencio: seguir escuchando
      everHeard.current = true;
      setVError('');
      if (/^(fin|finalizar|terminar|adiós|adeu|para|stop)[.!]?$/i.test(heard)) { stopVoice(); return; }
      // Evita enviar dos veces la misma intervención (resultados repetidos del reconocedor).
      if (heard === lastSent && Date.now() - started < 3000) continue;
      lastSent = heard;
      setV('thinking');
      await askAloud(heard);
    }
    if (session === sessionId.current) setV('off');
  }

  function startVoice() {
    setVError('');
    speaker.current.unlock(); // iOS: la voz solo se activa tras un gesto del usuario
    speaker.current.muted = muted;
    active.current = true;
    paused.current = null;
    void awake.current.acquire();
    void voiceLoop(++sessionId.current);
  }
  function stopVoice() {
    active.current = false;
    sessionId.current++;
    listener.current?.abort();
    speaker.current.cancel();
    abort.current?.abort();
    awake.current.release();
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
    speaker.current.unlock();
    const r = paused.current;
    paused.current = null;
    if (active.current) r?.(); else startVoice();
  }
  /** Interrumpir: corta la lectura (y la respuesta que aún llega) y pasa a escuchar. */
  function interrupt() { silenced.current = true; speaker.current.cancel(); }
  /** Botón principal del micrófono, según el estado. */
  function micButton() {
    if (vstate === 'speaking' || vstate === 'thinking') interrupt();
    else if (vstate === 'paused') resumeVoice();
    else if (vstate === 'listening') pauseVoice();
  }
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
          <GeminiUsage />
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

      {mode === 'voz' && (!canListen() || !canSpeak()) && (
        <div className="voice-note card">
          {!canListen() && <p>Este navegador no permite reconocer la voz (o la app está instalada en el iPhone).
            Alternativa gratuita: pulsa el <strong>micrófono del teclado</strong> en la caja de texto para dictar;
            las respuestas se leerán en voz alta. En iPhone funciona mejor abriendo la web en Safari.</p>}
          {!canSpeak() && <p>Este navegador no puede leer en voz alta; verás las respuestas por escrito.</p>}
        </div>
      )}
      {mode === 'voz' && canListen() && vstate === 'off' && (
        <div className="voice-options">
          <label><input type="checkbox" checked={showTx} onChange={(e) => setShowTx(e.target.checked)} /> Transcripción</label>
          <label>Idioma <select value={lang} onChange={(e) => setLang(e.target.value)}>
            <option value="es-ES">Castellano</option><option value="ca-ES">Català</option></select></label>
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
            {m.role === 'model'
              ? (m.text
                ? render(m.text, i === msgs.length - 1 && !busy && mode === 'chat'
                  ? (letter, option) => void send(`${letter}) ${option}`)
                  : undefined)
                : <p className="muted">Consultando el temario…</p>)
              : <p>{m.text}</p>}
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

      {mode === 'voz' && canListen() && (
        <div className="voicebar" role="region" aria-label="Controles de voz">
          {(partial && vstate === 'listening') || vError
            ? <p className={`voicebar-line${vError ? ' err' : ''}`} role={vError ? 'alert' : undefined}>{vError || `«${partial}»`}</p>
            : null}
          <div className="voicebar-row">
            <button className="vb-mode" onClick={() => { stopVoice(); setMode('chat'); }} aria-label="Cambiar a chat escrito">💬</button>
            <div className={`vb-status ${vstate}`} role="status">
              <span className="vb-dot" aria-hidden="true" />
              {{ off: 'Listo para hablar', listening: 'Escuchando…', thinking: 'Procesando…',
                speaking: 'Hablando… toca ✋ para interrumpir', paused: 'Micrófono en pausa' }[vstate]}
            </div>
            {vstate !== 'off' && (
              <button className={`vb-mic ${vstate}`} onClick={micButton}
                aria-label={vstate === 'listening' ? 'Silenciar micrófono' : vstate === 'paused' ? 'Reactivar micrófono' : 'Interrumpir y hablar'}>
                {vstate === 'listening' ? '🎙️' : vstate === 'paused' ? '🔇' : '✋'}
              </button>
            )}
            <button className="vb-tts" onClick={toggleMute} aria-pressed={muted} aria-label={muted ? 'Activar la voz del tutor' : 'Silenciar la voz del tutor'}>
              {muted ? '🔕' : '🔈'}
            </button>
            {vstate === 'off'
              ? <button className="vb-main start" onClick={startVoice}>▶ Iniciar conversación</button>
              : <button className="vb-main end" onClick={stopVoice}>■ Finalizar</button>}
          </div>
        </div>
      )}

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
