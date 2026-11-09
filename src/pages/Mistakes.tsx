import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { getSettings } from '../db/settings';
import type { ExamMode, ID, Question, ReviewItem } from '../db/types';
import { createExamFromIds } from '../exam/service';
import { DAY, MAX_BOX } from '../review/srs';
import { failStats, isHard, type FailStat } from '../stats/stats';

type Tab = 'hoy' | 'repaso' | 'falladas' | 'dificiles';

const when = (t: number, now: number) => {
  if (t <= now) return 'hoy';
  const d = Math.ceil((t - now) / DAY);
  return d === 1 ? 'mañana' : `en ${d} días`;
};

function Row({ q, review, stat, now }: { q: Question; review?: ReviewItem; stat?: FailStat; now: number }) {
  return (
    <div className="card question">
      <div className="doc-head">
        <span className="muted small">{q.reference || 'Sin referencia'}</span>
        <span className="muted small">
          {stat && `${stat.wrong} fallo(s) de ${stat.attempts} · `}
          {review ? `Caja ${review.box}/${MAX_BOX} · repaso ${when(review.due, now)}` : 'Fuera del repaso'}
        </span>
      </div>
      <p className="stem">{q.stem}</p>
      <details>
        <summary className="muted small">Ver respuesta</summary>
        <p className="small"><strong>{q.options[q.correctIndex]}</strong></p>
        {q.explanation && <p className="small muted">{q.explanation}</p>}
      </details>
      {review && (
        <button className="link" onClick={() => db.reviews.delete(q.id!)}>Quitar del repaso</button>
      )}
    </div>
  );
}

export default function Mistakes() {
  const navigate = useNavigate();
  const [tab, setTab] = useState<Tab>('hoy');
  const [mode, setMode] = useState<ExamMode>('estudio');
  const [error, setError] = useState('');
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 60_000); return () => clearInterval(t); }, []);

  const data = useLiveQuery(async () => {
    const [reviews, attempts, questions] = await Promise.all([db.reviews.toArray(), db.attempts.toArray(), db.questions.toArray()]);
    return { reviews, stats: failStats(attempts), questions: new Map(questions.map((q) => [q.id!, q])) };
  });

  const lists = useMemo(() => {
    if (!data) return null;
    const live = (id: ID) => { const q = data.questions.get(id); return q && q.status !== 'rejected' ? q : undefined; };
    const rev = new Map(data.reviews.map((r) => [r.questionId, r]));
    const st = new Map(data.stats.map((s) => [s.questionId, s]));
    const mk = (ids: ID[]) => ids.filter(live).map((id) => ({ q: live(id)!, review: rev.get(id), stat: st.get(id) }));
    return {
      hoy: mk(data.reviews.filter((r) => r.due <= now).sort((a, b) => a.box - b.box || a.due - b.due).map((r) => r.questionId)),
      repaso: mk([...data.reviews].sort((a, b) => a.due - b.due).map((r) => r.questionId)),
      falladas: mk(data.stats.slice(0, 100).map((s) => s.questionId)),
      dificiles: mk(data.stats.filter(isHard).map((s) => s.questionId)),
    };
  }, [data, now]);

  if (!lists) return null;
  const current = lists[tab];
  const LABELS: [Tab, string][] = [
    ['hoy', `Para hoy (${lists.hoy.length})`], ['repaso', `En repaso (${lists.repaso.length})`],
    ['falladas', `Más falladas (${lists.falladas.length})`], ['dificiles', `Difíciles (${lists.dificiles.length})`],
  ];

  async function start() {
    setError('');
    try {
      const { penalty } = await getSettings();
      const id = await createExamFromIds(current.slice(0, 100).map((x) => x.q.id!), mode, penalty);
      navigate(`/examen/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <>
      <h1>Mis errores</h1>
      <p className="sub">
        Las preguntas falladas o en blanco entran en repaso. Cada acierto las espacia más (1, 2, 4, 8 y 16 días);
        tras acertar en la última caja se dan por dominadas. Un fallo las devuelve a la caja 1.
      </p>
      <div className="tabs" style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        {LABELS.map(([t, l]) => <button key={t} className={tab === t ? 'on' : ''} onClick={() => setTab(t)}>{l}</button>)}
      </div>

      {current.length > 0 ? (
        <div className="card row">
          <select aria-label="Modo" value={mode} onChange={(e) => setMode(e.target.value as ExamMode)}>
            <option value="estudio">Estudio</option>
            <option value="simulacro">Simulacro</option>
          </select>
          <button className="primary" onClick={start}>
            Repasar {Math.min(current.length, 100)} pregunta{current.length === 1 ? '' : 's'}
          </button>
          {current.length > 100 && <span className="muted small">Se toman las 100 primeras.</span>}
          {error && <span className="error">{error}</span>}
        </div>
      ) : (
        <div className="card muted">
          {tab === 'hoy' ? (lists.repaso.length ? 'No tienes repasos pendientes hoy. ¡Buen trabajo!' : 'Aún no hay preguntas en repaso. Haz algún examen desde ')
            : tab === 'dificiles' ? 'Aparecen aquí las preguntas con al menos 2 intentos y un 50 % o más de fallos.'
              : 'No hay preguntas en esta lista.'}
          {tab === 'hoy' && !lists.repaso.length && <Link to="/generar">Generar test</Link>}
        </div>
      )}

      {current.map(({ q, review, stat }) => <Row key={q.id} q={q} review={review} stat={stat} now={now} />)}
    </>
  );
}
