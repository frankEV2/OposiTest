import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link, Navigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { formatDuration } from '../exam/logic';

const LETTERS = ['a', 'b', 'c', 'd'];
type View = 'all' | 'wrong' | 'blank';

const penaltyLabel = (p: number) => (p === 0 ? 'sin penalización' : `penalización ${p === 1 / 3 ? '1/3' : p} por error`);

export default function ExamResult() {
  const id = Number(useParams().id);
  const [view, setView] = useState<View>('all');
  const exam = useLiveQuery(() => db.exams.get(id), [id]);
  const questions = useLiveQuery(
    async () => (exam ? db.questions.bulkGet(exam.questionIds) : undefined), [exam?.questionIds.join()]);

  if (exam === undefined) return null;
  if (!exam) return <><h1>Examen no encontrado</h1><Link to="/generar">Nuevo examen</Link></>;
  if (!exam.finishedAt) return <Navigate to={`/examen/${id}`} replace />;
  if (!questions) return null;

  const n = exam.questionIds.length;
  const pct = n ? Math.round(((exam.correct ?? 0) / n) * 1000) / 10 : 0;
  const stats: [string, string | number, string?][] = [
    ['Nota', (exam.score ?? 0).toFixed(2).replace('.', ','), (exam.score ?? 0) >= 5 ? 'ok' : 'bad'],
    ['Aciertos', exam.correct ?? 0, 'ok'],
    ['Errores', exam.wrong ?? 0, 'bad'],
    ['En blanco', exam.blank ?? 0],
    ['Porcentaje', `${String(pct).replace('.', ',')} %`],
    ['Tiempo', formatDuration(exam.durationSec ?? 0)],
  ];

  const items = exam.questionIds.map((qid, i) => ({ qid, i, q: questions[i], a: exam.answers[i] }))
    .filter(({ q, a }) => view === 'all' || (view === 'blank' ? a === null : q && a !== null && a !== q.correctIndex));

  return (
    <>
      <h1>Resultado</h1>
      <p className="sub">
        {exam.config.mode === 'estudio' ? 'Estudio' : 'Simulacro'} · {n} preguntas · {penaltyLabel(exam.config.penalty)} ·{' '}
        {new Date(exam.finishedAt).toLocaleString('es-ES', { dateStyle: 'medium', timeStyle: 'short' })}
      </p>
      <div className="grid">
        {stats.map(([l, v, c]) => (
          <div className="card stat" key={l}>
            <div className={`value ${c ?? ''}`}>{v}</div>
            <div className="label">{l}</div>
          </div>
        ))}
      </div>

      <div className="row" style={{ margin: '8px 0 16px' }}>
        <Link className="btn primary" to="/generar">Nuevo examen</Link>
        <div className="tabs">
          {([['all', 'Todas'], ['wrong', `Falladas (${exam.wrong ?? 0})`], ['blank', `En blanco (${exam.blank ?? 0})`]] as const)
            .map(([v, l]) => <button key={v} className={view === v ? 'on' : ''} onClick={() => setView(v)}>{l}</button>)}
        </div>
      </div>

      {items.length === 0 && <p className="muted">No hay preguntas en esta vista.</p>}
      {items.map(({ qid, i, q, a }) => (
        <div key={qid} className="card question">
          <div className="doc-head">
            <span className="muted small">Pregunta {i + 1}</span>
            <span className={`badge ${!q ? '' : a === null ? 'warn' : a === q.correctIndex ? 'ok' : 'bad'}`}>
              {!q ? 'Eliminada' : a === null ? 'En blanco' : a === q.correctIndex ? 'Acierto' : 'Error'}
            </span>
          </div>
          {q ? (
            <>
              <p className="stem">{q.stem}</p>
              <ol className="opts plain">
                {exam.orders[i].map((orig, pos) => (
                  <li key={orig} className={orig === q.correctIndex ? 'correct' : orig === a ? 'chosen-wrong' : ''}>
                    {LETTERS[pos]}) {q.options[orig]}{orig === a && ' ← tu respuesta'}
                  </li>
                ))}
              </ol>
              {q.explanation && <p className="small">{q.explanation}</p>}
              {q.reference && (
                <p className="small muted">
                  Referencia:{' '}
                  {q.documentId && q.sectionId
                    ? <Link to={`/biblioteca/${q.documentId}?s=${q.sectionId}`}>{q.reference}</Link>
                    : q.reference}
                </p>
              )}
            </>
          ) : <p className="muted">La pregunta se eliminó del banco.</p>}
        </div>
      ))}
    </>
  );
}
