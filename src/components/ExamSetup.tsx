import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { getSettings, PENALTIES } from '../db/settings';
import type { Difficulty, ExamConfig, ID } from '../db/types';
import { countAvailable, createExam } from '../exam/service';

const COUNTS: ExamConfig['count'][] = [5, 10, 20, 30, 50, 100];
const DIFFS: [Difficulty, string][] = [[1, 'Fácil'], [2, 'Media'], [3, 'Difícil']];

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

export default function ExamSetup() {
  const navigate = useNavigate();
  const [cfg, setCfg] = useState<ExamConfig | null>(null);
  const [minutes, setMinutes] = useState(0);
  const [available, setAvailable] = useState<number | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    getSettings().then((s) => {
      setMinutes(s.simulacroMinutes);
      setCfg({
        mode: 'estudio', count: s.defaultCount, documentIds: [], temaIds: [], sectionIds: [], difficulties: [],
        pool: 'all', shuffle: true, penalty: s.penalty, includePending: true,
      });
    });
  }, []);

  const data = useLiveQuery(async () => ({
    docs: await db.documents.toArray(),
    temas: await db.temas.toArray(),
    materias: await db.materias.toArray(),
    total: await db.questions.count(),
  }));
  const oneDoc = cfg?.documentIds.length === 1 ? cfg.documentIds[0] : undefined;
  const articles = useLiveQuery(
    async () => (oneDoc === undefined ? [] : (await db.sections.where('documentId').equals(oneDoc).sortBy('order'))
      .filter((s) => s.kind === 'articulo' || s.kind === 'disposicion')),
    [oneDoc],
  );

  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    countAvailable(cfg).then((n) => alive && setAvailable(n));
    return () => { alive = false; };
  }, [cfg, data]);

  if (!cfg || !data) return null;
  const set = (patch: Partial<ExamConfig>) => setCfg({ ...cfg, ...patch });

  async function start() {
    setError('');
    try {
      const timeLimitSec = cfg!.mode === 'simulacro' && minutes > 0 ? minutes * 60 : undefined;
      const id = await createExam({ ...cfg!, timeLimitSec });
      navigate(`/examen/${id}`);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const materiaName = (id: ID) => data.materias.find((m) => m.id === id)?.name ?? '';

  return (
    <div className="card">
      <h2>Nuevo examen</h2>
      {data.total === 0 ? (
        <p className="muted">El banco está vacío. Genera preguntas en el apartado de abajo para poder hacer exámenes.</p>
      ) : (
        <>
          <div className="row" style={{ marginBottom: 12 }}>
            <div className="tabs">
              <button className={cfg.mode === 'estudio' ? 'on' : ''} onClick={() => set({ mode: 'estudio' })}>Estudio</button>
              <button className={cfg.mode === 'simulacro' ? 'on' : ''} onClick={() => set({ mode: 'simulacro' })}>Simulacro</button>
            </div>
            <span className="muted small">
              {cfg.mode === 'estudio'
                ? 'Corrección y explicación inmediata tras cada respuesta.'
                : 'Sin soluciones hasta finalizar; puedes cambiar respuestas.'}
            </span>
          </div>

          <div className="row setup-row">
            <label className="field"><span>Preguntas</span>
              <select value={cfg.count} onChange={(e) => set({ count: Number(e.target.value) as ExamConfig['count'] })}>
                {COUNTS.map((n) => <option key={n} value={n}>{n}</option>)}
              </select>
            </label>
            <label className="field"><span>Penalización por error</span>
              <select value={cfg.penalty} onChange={(e) => set({ penalty: Number(e.target.value) })}>
                {PENALTIES.map(([l, v]) => <option key={l} value={v}>{l}</option>)}
              </select>
            </label>
            {cfg.mode === 'simulacro' && (
              <label className="field"><span>Cronómetro (min, 0 = sin límite)</span>
                <input type="number" min={0} max={600} value={minutes}
                  onChange={(e) => setMinutes(Math.max(0, Math.min(600, Number(e.target.value) || 0)))} />
              </label>
            )}
          </div>

          <details className="setup-details">
            <summary>Documentos, temas y artículos{(cfg.documentIds.length + cfg.temaIds.length + cfg.sectionIds.length) > 0 && ' (filtrado)'}</summary>
            <div className="setup-grid">
              <div>
                <p className="muted small">Documentos (ninguno = todos)</p>
                {data.docs.map((d) => (
                  <label key={d.id} className="check">
                    <input type="checkbox" checked={cfg.documentIds.includes(d.id!)}
                      onChange={() => set({ documentIds: toggle(cfg.documentIds, d.id!), sectionIds: [] })} />
                    {d.title}
                  </label>
                ))}
              </div>
              {data.temas.length > 0 && (
                <div>
                  <p className="muted small">Temas (ninguno = todos)</p>
                  {data.temas.map((t) => (
                    <label key={t.id} className="check">
                      <input type="checkbox" checked={cfg.temaIds.includes(t.id!)}
                        onChange={() => set({ temaIds: toggle(cfg.temaIds, t.id!) })} />
                      {t.name} <span className="muted small">{materiaName(t.materiaId)}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {oneDoc !== undefined ? (
              articles && articles.length > 0 && (
                <div>
                  <p className="muted small">Artículos concretos (ninguno = todos)
                    {cfg.sectionIds.length > 0 && <button className="link" onClick={() => set({ sectionIds: [] })}>Quitar selección</button>}
                  </p>
                  <div className="article-list">
                    {articles.map((a) => (
                      <label key={a.id} className="check">
                        <input type="checkbox" checked={cfg.sectionIds.includes(a.id!)}
                          onChange={() => set({ sectionIds: toggle(cfg.sectionIds, a.id!) })} />
                        {a.label}
                      </label>
                    ))}
                  </div>
                </div>
              )
            ) : <p className="muted small">Selecciona un único documento para elegir artículos concretos.</p>}
          </details>

          <details className="setup-details">
            <summary>Opciones avanzadas</summary>
            <div className="setup-grid">
              <div>
                <p className="muted small">Dificultad (ninguna = todas)</p>
                {DIFFS.map(([d, l]) => (
                  <label key={d} className="check">
                    <input type="checkbox" checked={cfg.difficulties.includes(d)}
                      onChange={() => set({ difficulties: toggle(cfg.difficulties, d) })} />{l}
                  </label>
                ))}
              </div>
              <div>
                <p className="muted small">Preguntas</p>
                {([['all', 'Todas'], ['new', 'Solo nuevas'], ['seen', 'Solo ya realizadas']] as const).map(([v, l]) => (
                  <label key={v} className="check">
                    <input type="radio" name="pool" checked={cfg.pool === v} onChange={() => set({ pool: v })} />{l}
                  </label>
                ))}
              </div>
              <div>
                <p className="muted small">Otras</p>
                <label className="check">
                  <input type="checkbox" checked={cfg.shuffle} onChange={() => set({ shuffle: !cfg.shuffle })} />
                  Orden aleatorio de preguntas y respuestas
                </label>
                <label className="check">
                  <input type="checkbox" checked={cfg.includePending} onChange={() => set({ includePending: !cfg.includePending })} />
                  Incluir preguntas sin revisar
                </label>
              </div>
            </div>
          </details>

          <div className="row" style={{ marginTop: 12 }}>
            <button className="primary" disabled={!available} onClick={start}>Empezar examen</button>
            <span className="muted small">
              {available === null ? '' : available === 0 ? 'Ninguna pregunta cumple estos criterios.'
                : available < cfg.count ? `Solo hay ${available} preguntas disponibles; el examen tendrá ${available}.`
                  : `${available} preguntas disponibles.`}
            </span>
          </div>
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
