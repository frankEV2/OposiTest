import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { db } from '../db/db';
import type { ID } from '../db/types';
import { generateForDocuments, type DocReport } from '../engine/store';
import { generateWithAI, resetAiProgress, type AiProgress } from '../tutor/questions';
import { activeWorkspace } from '../workspaces';
import GeminiUsage from '../components/GeminiUsage';
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
  const [ai, setAi] = useState<AiProgress | null>(null);
  const [aiCtrl, setAiCtrl] = useState<AbortController | null>(null);

  const usable = docs?.filter((d) => d.extraction !== 'scanned') ?? [];
  const toggle = (id: ID) => setSelected((s) => {
    const n = new Set(s);
    if (n.has(id)) n.delete(id); else n.add(id);
    return n;
  });

  async function runAI() {
    const ctrl = new AbortController();
    setAiCtrl(ctrl);
    setError('');
    try {
      const ws = activeWorkspace();
      setAi(await generateWithAI([...selected], `${ws.organismo} · ${ws.nombre}`, setAi, ctrl.signal));
    } catch (e) {
      if ((e as Error).name !== 'AbortError') setError((e as Error).message);
    } finally {
      setAiCtrl(null);
    }
  }

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
            <div className="row">
              <button className="primary" disabled={!selected.size || busy || !!aiCtrl} onClick={runAI}>
                ✨ Generar con IA, estilo examen ({selected.size})
              </button>
              {aiCtrl && <button onClick={() => aiCtrl.abort()}>Detener</button>}
              <button disabled={!selected.size || busy || !!aiCtrl} onClick={run}>
                {busy ? 'Generando…' : `Generación rápida sin IA (${selected.size})`}
              </button>
            </div>
            <GeminiUsage key={ai?.done ?? -1} />
            {ai && (
              <div className="card" style={{ marginTop: 10 }} role="status">
                <p style={{ margin: 0 }}>
                  <strong>IA:</strong> {ai.done} de {ai.total} bloques de artículos · <strong>{ai.added}</strong> preguntas nuevas
                  {aiCtrl ? '…' : '.'}
                </p>
                {ai.total > 0 && <progress max={ai.total} value={ai.done} style={{ width: '100%' }} />}
                {ai.message && <p className="muted small">{ai.message}</p>}
                {Object.keys(ai.rejected).length > 0 && (
                  <p className="muted small">Descartadas por el control de calidad: {Object.entries(ai.rejected).map(([k, v]) => `${k} (${v})`).join(', ')}.</p>
                )}
                {!aiCtrl && ai.total === 0 && <p className="muted small">Todos los artículos de estos documentos ya tienen preguntas de IA.
                  <button className="link" onClick={async () => { await resetAiProgress(); setAi(null); }}>Permitir generar más</button></p>}
              </div>
            )}
          </>
        )}
        {error && <p className="error">{error}</p>}
        <details style={{ marginTop: 12 }}>
          <summary className="muted small">¿Cómo se generan?</summary>
          <p className="muted small">
            <strong>Con IA (recomendado):</strong> Gemini redacta preguntas al estilo de los exámenes oficiales (conceptos,
            competencias, plazos, procedimientos, supuestos prácticos; nunca «¿qué dice el artículo X?») a partir de cada
            artículo del temario. Cada pregunta se comprueba antes de guardarla: la respuesta debe apoyarse en una cita literal
            del temario, sin números de artículo en el enunciado y sin duplicados. Usa tu cuota gratuita: si se agota, vuelve a
            pulsar otro día y continúa donde lo dejó. Requiere tener configurado el Tutor IA.
          </p>
          <p className="muted small"><strong>Generación rápida sin IA:</strong></p>
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
                {r.hint && <div className="warning">{r.hint}</div>}
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
