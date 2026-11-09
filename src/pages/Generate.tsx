import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { ID } from '../db/types';
import { generateForDocuments, type DocReport } from '../engine/store';
import ExamSetup from '../components/ExamSetup';

export default function Generate() {
  const docs = useLiveQuery(async () => {
    const list = await db.documents.orderBy('importedAt').reverse().toArray();
    return Promise.all(list.map(async (d) => ({
      ...d, questions: await db.questions.where('documentId').equals(d.id!).count(),
    })));
  });
  const [selected, setSelected] = useState<Set<ID>>(new Set());
  const [busy, setBusy] = useState(false);
  const [reports, setReports] = useState<DocReport[] | null>(null);
  const [error, setError] = useState('');

  const usable = docs?.filter((d) => d.extraction !== 'scanned') ?? [];
  const toggle = (id: ID) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function run() {
    setBusy(true);
    setError('');
    try {
      setReports(await generateForDocuments([...selected]));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <h1>Generar test</h1>
      <p className="sub">Configura un examen con las preguntas del banco o genera nuevas preguntas desde tus documentos.</p>
      <ExamSetup />

      <div className="card">
        <h2>Generar preguntas desde documentos</h2>
        {docs?.length === 0 && <p className="muted">Primero importa documentos en la <Link to="/biblioteca">Biblioteca</Link>.</p>}
        {usable.length > 0 && (
          <>
            <div className="row" style={{ marginBottom: 8 }}>
              <button className="link" onClick={() => setSelected(new Set(usable.map((d) => d.id!)))}>Seleccionar todos</button>
              <button className="link" onClick={() => setSelected(new Set())}>Ninguno</button>
            </div>
            <ul className="checklist">
              {usable.map((d) => (
                <li key={d.id}>
                  <label>
                    <input type="checkbox" checked={selected.has(d.id!)} onChange={() => toggle(d.id!)} />
                    <span>{d.title}</span>
                    <span className="muted small">{d.questions} preguntas en el banco</span>
                  </label>
                </li>
              ))}
            </ul>
            <button className="primary" disabled={!selected.size || busy} onClick={run}>
              {busy ? 'Generando…' : `Generar preguntas (${selected.size})`}
            </button>
          </>
        )}
        {error && <p className="error">{error}</p>}
        <details style={{ marginTop: 12 }}>
          <summary className="muted small">¿Cómo se generan?</summary>
          <p className="muted small">
            Se analizan definiciones, plazos, competencias, enumeraciones, cuantías, excepciones y obligaciones.
            La respuesta correcta es siempre texto literal del artículo, y las alternativas proceden de otros artículos
            de tus documentos (otros plazos, órganos, definiciones o elementos de listas). Si no hay alternativas reales
            suficientes, o la pregunta sería ambigua, se descarta. Las preguntas generadas quedan «sin revisar»
            en el banco para que puedas validarlas, editarlas o rechazarlas. Las rechazadas no vuelven a generarse.
          </p>
        </details>
      </div>

      {reports && (
        <div className="card">
          <h2>Resultado</h2>
          {reports.map((r) => {
            const disc = Object.entries(r.discarded);
            return (
              <div key={r.documentId} className="result">
                <strong>{r.title}</strong>: {r.added} nuevas
                {r.duplicates > 0 && <span className="muted"> · {r.duplicates} ya estaban en el banco</span>}
                {disc.length > 0 && (
                  <details>
                    <summary className="muted small">{disc.reduce((a, [, n]) => a + n, 0)} candidatas descartadas</summary>
                    <ul className="muted small">{disc.map(([k, n]) => <li key={k}>{k}: {n}</li>)}</ul>
                  </details>
                )}
              </div>
            );
          })}
          <p><Link to="/banco">Revisar en el banco de preguntas →</Link></p>
        </div>
      )}
    </>
  );
}
