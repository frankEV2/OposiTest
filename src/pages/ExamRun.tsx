import { useLiveQuery } from 'dexie-react-hooks';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, Navigate, useNavigate, useParams } from 'react-router-dom';
import { db } from '../db/db';
import { formatDuration } from '../exam/logic';
import { abandonExam, finishExam, setAnswer } from '../exam/service';

const LETTERS = ['a', 'b', 'c', 'd'];

export default function ExamRun() {
  const id = Number(useParams().id);
  const navigate = useNavigate();
  const exam = useLiveQuery(() => db.exams.get(id), [id]);
  const questions = useLiveQuery(
    async () => (exam ? db.questions.bulkGet(exam.questionIds) : undefined),
    [exam?.questionIds.join()],
  );
  const [i, setI] = useState(0);
  const [now, setNow] = useState(Date.now());
  const finishing = useRef(false);

  const limit = exam?.config.mode === 'simulacro' ? exam.config.timeLimitSec : undefined;
  const remaining = exam && limit ? exam.startedAt + limit * 1000 - now : undefined;

  const finish = useCallback(async () => {
    if (finishing.current) return;
    finishing.current = true;
    await finishExam(id);
    navigate(`/examen/${id}/resultado`, { replace: true });
  }, [id, navigate]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);
  useEffect(() => {
    if (remaining !== undefined && remaining <= 0 && exam && !exam.finishedAt) void finish();
  }, [remaining, exam, finish]);

  const q = questions?.[i];
  const answer = exam?.answers[i] ?? null;
  const study = exam?.config.mode === 'estudio';
  const locked = study && answer !== null;

  const choose = useCallback((orig: number) => {
    if (!exam || locked) return;
    void setAnswer(id, i, study || answer !== orig ? orig : null);
  }, [exam, locked, id, i, study, answer]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!exam || (e.target as HTMLElement).tagName === 'INPUT') return;
      const k = e.key.toLowerCase();
      const pos = ['1', '2', '3', '4'].indexOf(k) >= 0 ? Number(k) - 1 : LETTERS.indexOf(k);
      if (pos >= 0) choose(exam.orders[i][pos]);
      if (e.key === 'ArrowRight') setI((x) => Math.min(x + 1, exam.questionIds.length - 1));
      if (e.key === 'ArrowLeft') setI((x) => Math.max(x - 1, 0));
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [exam, i, choose]);

  if (exam === undefined && questions === undefined) return null;
  if (!exam) return <><h1>Examen no encontrado</h1><Link to="/generar">Nuevo examen</Link></>;
  if (exam.finishedAt && !finishing.current) return <Navigate to={`/examen/${id}/resultado`} replace />;
  if (!questions) return null;

  const n = exam.questionIds.length;
  const answered = exam.answers.filter((a) => a !== null).length;

  async function confirmFinish() {
    const blank = n - answered;
    const msg = blank ? `Tienes ${blank} pregunta(s) sin responder. ¿Finalizar el examen?` : '¿Finalizar el examen?';
    if (confirm(msg)) await finish();
  }
  async function abandon() {
    if (confirm('¿Abandonar el examen? No se guardará ningún resultado.')) {
      await abandonExam(id);
      navigate('/generar');
    }
  }

  return (
    <div className="exam">
      <div className="exam-bar" aria-live="polite">
        <strong>{study ? 'Estudio' : 'Simulacro'}</strong>
        <span className="muted">Pregunta {i + 1} de {n} · {answered} respondidas</span>
        {remaining !== undefined
          ? <span className={`timer${remaining < 60_000 ? ' low' : ''}`}>⏱ {formatDuration(remaining / 1000)}</span>
          : <span className="muted">⏱ {formatDuration((now - exam.startedAt) / 1000)}</span>}
      </div>

      {q ? (
        <div className="card">
          <p className="stem">{q.stem}</p>
          <div className="options">
            {exam.orders[i].map((orig, pos) => {
              let cls = 'option';
              if (answer === orig) cls += ' chosen';
              if (locked) {
                if (orig === q.correctIndex) cls += ' right';
                else if (answer === orig) cls += ' wrong';
              }
              return (
                <button key={orig} className={cls} onClick={() => choose(orig)} disabled={locked} aria-pressed={answer === orig}>
                  <span className="letter">{LETTERS[pos]}</span>{q.options[orig]}
                </button>
              );
            })}
          </div>
          {locked && (
            <div className={`feedback ${answer === q.correctIndex ? 'ok' : 'bad'}`}>
              <strong>{answer === q.correctIndex ? 'Correcto' : 'Incorrecto'}</strong>
              {q.explanation && <p>{q.explanation}</p>}
              {q.reference && <p className="small muted">Referencia: {q.reference}</p>}
            </div>
          )}
          {!study && answer !== null && (
            <button className="link" onClick={() => setAnswer(id, i, null)}>Dejar en blanco</button>
          )}
        </div>
      ) : (
        <div className="card muted">Esta pregunta se ha eliminado del banco y contará como en blanco.</div>
      )}

      <div className="row exam-nav">
        <button disabled={i === 0} onClick={() => setI(i - 1)}>← Anterior</button>
        {i < n - 1
          ? <button className={locked || (!study && answer !== null) ? 'primary' : ''} onClick={() => setI(i + 1)}>Siguiente →</button>
          : <button className="primary" onClick={confirmFinish}>Finalizar</button>}
      </div>

      <div className="grid-nav">
        {exam.questionIds.map((_, k) => {
          let cls = k === i ? 'cur' : '';
          if (exam.answers[k] !== null) {
            cls += study && questions[k]
              ? exam.answers[k] === questions[k]!.correctIndex ? ' good' : ' badq'
              : ' done';
          }
          return <button key={k} className={cls} onClick={() => setI(k)} aria-label={`Ir a la pregunta ${k + 1}`} aria-current={k === i ? 'step' : undefined}>{k + 1}</button>;
        })}
      </div>

      <div className="row" style={{ justifyContent: 'space-between', marginTop: 16 }}>
        <button className="danger" onClick={abandon}>Abandonar</button>
        {i < n - 1 && <button onClick={confirmFinish}>Finalizar examen</button>}
      </div>
      <p className="muted small">Atajos: teclas 1–4 o a–d para responder, flechas para navegar.</p>
    </div>
  );
}
