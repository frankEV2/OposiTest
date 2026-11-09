import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import ScoreChart from '../components/ScoreChart';
import { db } from '../db/db';
import { formatDuration } from '../exam/logic';
import {
  byDocument, byMateria, byTema, evolution, failStats, overview, type Bucket, type Lookups,
} from '../stats/stats';

function Bars({ items, empty }: { items: Bucket[]; empty: string }) {
  if (!items.length) return <p className="muted small">{empty}</p>;
  return (
    <div className="bars">
      {items.map((b) => (
        <div key={b.key} className="bar-row" title={`${b.correct} aciertos de ${b.answered}`}>
          <span className="bar-label">{b.label}</span>
          <span className="bar-track"><span className="bar-fill" style={{ width: `${b.percent}%` }} /></span>
          <span className="bar-value">{String(b.percent).replace('.', ',')} % <span className="muted">({b.answered})</span></span>
        </div>
      ))}
    </div>
  );
}

type Group = 'materia' | 'tema' | 'documento';

export default function Stats() {
  const [group, setGroup] = useState<Group>('documento');
  const data = useLiveQuery(async () => {
    const [exams, attempts, sessions, questions, docs, temas, materias] = await Promise.all([
      db.exams.toArray(), db.attempts.toArray(), db.sessions.toArray(), db.questions.toArray(),
      db.documents.toArray(), db.temas.toArray(), db.materias.toArray(),
    ]);
    const l: Lookups = {
      questions: new Map(questions.map((q) => [q.id!, q])),
      docs: new Map(docs.map((d) => [d.id!, d])),
      temas: new Map(temas.map((t) => [t.id!, t])),
      materias: new Map(materias.map((m) => [m.id!, m])),
    };
    return { exams, attempts, sessions, l };
  });
  if (!data) return null;

  const o = overview(data.exams, data.attempts, data.sessions);
  const points = evolution(data.exams);
  const groups = { materia: byMateria, tema: byTema, documento: byDocument };
  const buckets = groups[group](data.attempts, data.l);
  const worst = failStats(data.attempts).slice(0, 10);
  const history = data.exams.filter((e) => e.finishedAt).sort((a, b) => b.finishedAt! - a.finishedAt!);

  if (!o.exams) {
    return (
      <>
        <h1>Estadísticas</h1>
        <div className="card muted">Aún no has terminado ningún examen. <Link to="/generar">Empieza uno</Link> para ver tu progreso.</div>
      </>
    );
  }

  const tiles: [string, string][] = [
    ['Aciertos', `${String(o.percent).replace('.', ',')} %`],
    ['Nota media', o.avgScore.toFixed(2).replace('.', ',')],
    ['Exámenes', String(o.exams)],
    ['Preguntas respondidas', String(o.answered)],
    ['Tiempo de estudio', formatDuration(o.studySec)],
    ['Últimos 7 días', formatDuration(o.last7Sec)],
  ];

  return (
    <>
      <h1>Estadísticas</h1>
      <p className="sub">Calculadas a partir de tus exámenes terminados en este dispositivo.</p>
      <div className="grid">
        {tiles.map(([l, v]) => <div key={l} className="card stat"><div className="value">{v}</div><div className="label">{l}</div></div>)}
      </div>

      <div className="card">
        <h2>Evolución de la nota</h2>
        <ScoreChart points={points} />
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: 'space-between', marginBottom: 8 }}>
          <h2 style={{ margin: 0 }}>Rendimiento</h2>
          <select aria-label="Agrupar por" value={group} onChange={(e) => setGroup(e.target.value as Group)}>
            <option value="documento">Por documento</option>
            <option value="materia">Por materia</option>
            <option value="tema">Por tema</option>
          </select>
        </div>
        <Bars items={buckets} empty={group === 'documento' ? 'Sin datos.' : 'Clasifica tus documentos por materia y tema en la Biblioteca para ver este desglose.'} />
        <p className="muted small">Porcentaje de aciertos (entre paréntesis, preguntas respondidas). Los peores primero.</p>
      </div>

      <div className="card">
        <h2>Preguntas más falladas</h2>
        {worst.length === 0 ? <p className="muted small">Ningún fallo registrado.</p> : (
          <table className="table">
            <thead><tr><th>Pregunta</th><th>Fallos</th><th>% fallo</th></tr></thead>
            <tbody>
              {worst.map((s) => {
                const q = data.l.questions.get(s.questionId);
                return (
                  <tr key={s.questionId}>
                    <td>{q ? q.stem : <em className="muted">Pregunta eliminada</em>}<div className="muted small">{q?.reference}</div></td>
                    <td>{s.wrong}/{s.attempts}</td>
                    <td>{String(s.failRate).replace('.', ',')} %</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
        <p><Link to="/errores">Repasar en «Mis errores» →</Link></p>
      </div>

      <div className="card">
        <h2>Historial</h2>
        <table className="table">
          <thead><tr><th>Fecha</th><th>Modo</th><th>Preguntas</th><th>Nota</th><th>Tiempo</th><th /></tr></thead>
          <tbody>
            {history.map((e) => (
              <tr key={e.id}>
                <td>{new Date(e.finishedAt!).toLocaleString('es-ES', { dateStyle: 'short', timeStyle: 'short' })}</td>
                <td>{e.config.mode === 'estudio' ? 'Estudio' : 'Simulacro'}</td>
                <td>{e.questionIds.length}</td>
                <td>{(e.score ?? 0).toFixed(2).replace('.', ',')}</td>
                <td>{formatDuration(e.durationSec ?? 0)}</td>
                <td><Link to={`/examen/${e.id}/resultado`}>Ver</Link></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </>
  );
}
