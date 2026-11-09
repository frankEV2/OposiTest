import { useLiveQuery } from 'dexie-react-hooks';
import { Link } from 'react-router-dom';
import { db } from '../db/db';

export default function Home() {
  const stats = useLiveQuery(async () => ({
    documents: await db.documents.count(),
    questions: await db.questions.where('status').anyOf('validated', 'pending').count(),
    exams: await db.exams.where('finishedAt').above(0).count(),
    due: await db.reviews.where('due').belowOrEqual(Date.now()).count(),
    open: (await db.exams.orderBy('startedAt').reverse().toArray()).find((e) => !e.finishedAt),
  }));

  const items = [
    ['Documentos', stats?.documents],
    ['Preguntas en el banco', stats?.questions],
    ['Exámenes realizados', stats?.exams],
    ['Repasos para hoy', stats?.due],
  ] as const;

  return (
    <>
      <h1>Inicio</h1>
      <p className="sub">Todos tus datos se guardan solo en este dispositivo.</p>
      {stats?.open && (
        <div className="card row" style={{ justifyContent: 'space-between' }}>
          <span>
            Tienes un {stats.open.config.mode === 'estudio' ? 'examen de estudio' : 'simulacro'} sin terminar
            ({stats.open.answers.filter((a) => a !== null).length} de {stats.open.questionIds.length} respondidas).
          </span>
          <Link className="btn primary" to={`/examen/${stats.open.id}`}>Continuar</Link>
        </div>
      )}
      <div className="grid">
        {items.map(([label, value]) => (
          <div className="card stat" key={label}>
            <div className="value">{value ?? '–'}</div>
            <div className="label">{label}</div>
          </div>
        ))}
      </div>
      {stats && stats.documents === 0 && (
        <div className="card">
          <h2>Primeros pasos</h2>
          <ol className="muted" style={{ margin: 0, paddingLeft: 20 }}>
            <li>Crea tu oposición, materias y temas en <Link to="/configuracion">Configuración</Link>.</li>
            <li>Importa tus normas en PDF en la <Link to="/biblioteca">Biblioteca</Link>.</li>
          </ol>
        </div>
      )}
    </>
  );
}
