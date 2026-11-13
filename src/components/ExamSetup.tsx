import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { db } from '../db/db';
import { getSettings, PENALTIES } from '../db/settings';
import type { Difficulty, ExamConfig } from '../db/types';
import { countAvailable, createExam } from '../exam/service';
import DocPicker from './DocPicker';
import type { AiProgress } from '../tutor/questions';

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
  const [ai, setAi] = useState<AiProgress | null>(null);

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
    total: await db.questions.count(),
  }));
  useEffect(() => {
    if (!cfg) return;
    let alive = true;
    countAvailable(cfg).then((n) => alive && setAvailable(n));
    return () => { alive = false; };
  }, [cfg, data]);

  if (!cfg || !data) return null;
  const set = (patch: Partial<ExamConfig>) => setCfg({ ...cfg, ...patch });

  // Amplía el banco solo con el contenido seleccionado (vuelve a pasar por sus artículos buscando conceptos nuevos).
  async function expand() {
    setError('');
    try {
      const [{ generateWithAI }, { activeWorkspace }] = await Promise.all([import('../tutor/questions'), import('../workspaces')]);
      const ws = activeWorkspace();
      const r = await generateWithAI(cfg!.documentIds, `${ws.organismo} · ${ws.nombre}`, setAi, undefined, true);
      setAi(r.message ? r : null);
    } catch (e) {
      setError((e as Error).message);
      setAi(null);
    }
  }

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
            <summary>Documentos, temas y artículos{cfg.documentIds.length > 0 && ` (${cfg.documentIds.length} seleccionados)`}</summary>
            <DocPicker cfg={cfg} set={set} />
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
          {available !== null && available < cfg.count && cfg.documentIds.length > 0 && (
            <p className="muted small">
              Con el temario seleccionado no hay más preguntas distintas y de calidad (no se rellenan con duplicados).{' '}
              {ai ? (ai.message ?? `Ampliando con IA… ${ai.done}/${ai.total} tandas, ${ai.added} preguntas nuevas.`)
                : <button className="link" onClick={expand}>Ampliar el banco con IA a partir de esta selección</button>}
            </p>
          )}
          {error && <p className="error">{error}</p>}
        </>
      )}
    </div>
  );
}
