import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useMemo, useState, type FormEvent } from 'react';
import { db } from '../db/db';
import type { Difficulty, ID, Question, QuestionRule, QuestionStatus } from '../db/types';
import { RULE_LABEL } from '../engine/generate';
import { saveQuestion } from '../engine/store';
import { fold } from '../engine/text';

const PAGE = 25;
const STATUS_LABEL: Record<QuestionStatus, string> = { pending: 'Sin revisar', validated: 'Validada', rejected: 'Rechazada' };
const STATUS_CLS: Record<QuestionStatus, string> = { pending: 'warn', validated: 'ok', rejected: 'bad' };
const DIFF_LABEL = ['', 'Fácil', 'Media', 'Difícil'];
const LETTERS = ['a', 'b', 'c', 'd'];

interface Filters {
  documentId: string;
  status: string;
  rule: string;
  difficulty: string;
  text: string;
}
const EMPTY: Filters = { documentId: '', status: '', rule: '', difficulty: '', text: '' };

function Editor({ initial, onDone }: { initial?: Question; onDone: () => void }) {
  const docs = useLiveQuery(() => db.documents.toArray());
  const [q, setQ] = useState({
    stem: initial?.stem ?? '',
    options: [...(initial?.options ?? ['', '', '', ''])] as Question['options'],
    correctIndex: initial?.correctIndex ?? 0,
    explanation: initial?.explanation ?? '',
    reference: initial?.reference ?? '',
    difficulty: initial?.difficulty ?? 2,
    documentId: initial?.documentId,
  });
  const [error, setError] = useState('');

  async function submit(e: FormEvent) {
    e.preventDefault();
    try {
      const doc = q.documentId ? await db.documents.get(q.documentId) : undefined;
      await saveQuestion({
        ...q,
        options: q.options.map((o) => o.trim()) as Question['options'],
        stem: q.stem.trim(),
        sectionId: initial?.documentId === q.documentId ? initial?.sectionId : undefined,
        temaId: doc?.temaId ?? initial?.temaId,
        sourceExcerpt: initial?.sourceExcerpt ?? '',
      }, initial?.id);
      onDone();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return (
    <form className="card editor" onSubmit={submit}>
      <h2>{initial ? 'Editar pregunta' : 'Nueva pregunta'}</h2>
      <label className="field wide">
        <span>Enunciado</span>
        <textarea rows={3} value={q.stem} onChange={(e) => setQ({ ...q, stem: e.target.value })} required />
      </label>
      {q.options.map((o, i) => (
        <div key={i} className="row option-edit">
          <input type="radio" name="correct" aria-label={`Opción ${LETTERS[i]} correcta`}
            checked={q.correctIndex === i} onChange={() => setQ({ ...q, correctIndex: i as Question['correctIndex'] })} />
          <span>{LETTERS[i]})</span>
          <input value={o} required onChange={(e) => {
            const options = [...q.options] as Question['options'];
            options[i] = e.target.value;
            setQ({ ...q, options });
          }} />
        </div>
      ))}
      <p className="muted small">Marca con el círculo la respuesta correcta.</p>
      <label className="field wide">
        <span>Explicación</span>
        <textarea rows={2} value={q.explanation} onChange={(e) => setQ({ ...q, explanation: e.target.value })} />
      </label>
      <div className="row">
        <label className="field"><span>Referencia</span>
          <input value={q.reference} placeholder="Ley 39/2015, art. 21.2" onChange={(e) => setQ({ ...q, reference: e.target.value })} />
        </label>
        <label className="field"><span>Documento</span>
          <select value={q.documentId ?? ''} onChange={(e) => setQ({ ...q, documentId: e.target.value ? Number(e.target.value) : undefined })}>
            <option value="">Ninguno</option>
            {docs?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
          </select>
        </label>
        <label className="field"><span>Dificultad</span>
          <select value={q.difficulty} onChange={(e) => setQ({ ...q, difficulty: Number(e.target.value) as Difficulty })}>
            {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABEL[d]}</option>)}
          </select>
        </label>
      </div>
      {error && <p className="error">{error}</p>}
      <div className="row">
        <button type="submit" className="primary">Guardar y validar</button>
        <button type="button" onClick={onDone}>Cancelar</button>
      </div>
    </form>
  );
}

function QuestionCard({ q, onEdit }: { q: Question; onEdit: () => void }) {
  const setStatus = (status: QuestionStatus) => db.questions.update(q.id!, { status, updatedAt: Date.now() });
  async function remove() {
    if (!confirm('¿Eliminar esta pregunta definitivamente? (Si la rechazas, no se volverá a generar.)')) return;
    await db.transaction('rw', db.questions, db.reviews, async () => {
      await db.reviews.delete(q.id!);
      await db.questions.delete(q.id!);
    });
  }
  return (
    <div className="card question">
      <div className="doc-head">
        <div className="small muted">
          {RULE_LABEL[q.rule]} · {DIFF_LABEL[q.difficulty]}{q.reference && ` · ${q.reference}`}
        </div>
        <span className={`badge ${STATUS_CLS[q.status]}`}>{STATUS_LABEL[q.status]}</span>
      </div>
      <p className="stem">{q.stem}</p>
      <ol className="opts">
        {q.options.map((o, i) => <li key={i} className={i === q.correctIndex ? 'correct' : ''}>{o}</li>)}
      </ol>
      <details>
        <summary className="muted small">Explicación y fuente</summary>
        {q.explanation && <p className="small">{q.explanation}</p>}
        {q.sourceExcerpt && <blockquote className="small muted">{q.sourceExcerpt}</blockquote>}
      </details>
      <div className="row" style={{ marginTop: 8 }}>
        {q.status !== 'validated' && <button onClick={() => setStatus('validated')}>Validar</button>}
        {q.status !== 'rejected' && <button onClick={() => setStatus('rejected')}>Rechazar</button>}
        <button onClick={onEdit}>Editar</button>
        <button className="danger" onClick={remove}>Eliminar</button>
      </div>
    </div>
  );
}

export default function Bank() {
  const [f, setF] = useState<Filters>(EMPTY);
  const [page, setPage] = useState(0);
  const [editing, setEditing] = useState<Question | 'new' | null>(null);
  const docs = useLiveQuery(() => db.documents.toArray());
  const all = useLiveQuery(() => db.questions.toArray());

  const filtered = useMemo(() => {
    const t = fold(f.text.trim());
    return (all ?? []).filter((q) =>
      (!f.documentId || String(q.documentId ?? '') === f.documentId) &&
      (!f.status || q.status === f.status) &&
      (!f.rule || q.rule === f.rule) &&
      (!f.difficulty || String(q.difficulty) === f.difficulty) &&
      (!t || fold(`${q.stem} ${q.options.join(' ')} ${q.reference}`).includes(t)),
    ).sort((a, b) => (a.documentId ?? 0) - (b.documentId ?? 0) || (a.sectionId ?? 0) - (b.sectionId ?? 0) || a.id! - b.id!);
  }, [all, f]);

  useEffect(() => setPage(0), [f]);
  const counts = useMemo(() => {
    const c = { pending: 0, validated: 0, rejected: 0 };
    for (const q of all ?? []) c[q.status]++;
    return c;
  }, [all]);
  const pendingInView = filtered.filter((q) => q.status === 'pending');
  const pages = Math.max(1, Math.ceil(filtered.length / PAGE));
  const set = (k: keyof Filters) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });

  async function validateAll() {
    if (!confirm(`¿Marcar como validadas ${pendingInView.length} preguntas sin revisar? Conviene revisarlas antes.`)) return;
    const now = Date.now();
    await db.questions.bulkUpdate(pendingInView.map((q) => ({ key: q.id as ID, changes: { status: 'validated' as const, updatedAt: now } })));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Banco de preguntas</h1>
          <p className="sub">
            {all?.length ?? 0} preguntas · {counts.validated} validadas · {counts.pending} sin revisar · {counts.rejected} rechazadas
          </p>
        </div>
        <button className="primary" onClick={() => setEditing('new')}>Nueva pregunta</button>
      </div>

      {editing && (
        <Editor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? undefined : editing}
          onDone={() => setEditing(null)} />
      )}

      <div className="card">
        <input type="search" style={{ width: '100%' }} placeholder="Buscar en enunciados, respuestas y referencias"
          value={f.text} onChange={set('text')} />
        <details style={{ marginTop: 8 }}>
          <summary className="muted small">Filtros</summary>
          <div className="row" style={{ marginTop: 8 }}>
            <select aria-label="Documento" value={f.documentId} onChange={set('documentId')}>
              <option value="">Todos los documentos</option>
              {docs?.map((d) => <option key={d.id} value={d.id}>{d.title}</option>)}
            </select>
            <select aria-label="Estado" value={f.status} onChange={set('status')}>
              <option value="">Cualquier estado</option>
              {Object.entries(STATUS_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
            <select aria-label="Tipo" value={f.rule} onChange={set('rule')}>
              <option value="">Cualquier tipo</option>
              {(Object.keys(RULE_LABEL) as QuestionRule[]).map((k) => <option key={k} value={k}>{RULE_LABEL[k]}</option>)}
            </select>
            <select aria-label="Dificultad" value={f.difficulty} onChange={set('difficulty')}>
              <option value="">Cualquier dificultad</option>
              {[1, 2, 3].map((d) => <option key={d} value={d}>{DIFF_LABEL[d]}</option>)}
            </select>
            <button className="link" onClick={() => setF(EMPTY)}>Quitar filtros</button>
          </div>
        </details>
        {pendingInView.length > 0 && (
          <div style={{ marginTop: 8 }}>
            <button onClick={validateAll}>Validar las {pendingInView.length} sin revisar de esta vista</button>
          </div>
        )}
      </div>

      {all?.length === 0 && <div className="card muted">El banco está vacío. Genera preguntas desde «Generar test» o crea una manualmente.</div>}
      {all && all.length > 0 && filtered.length === 0 && <p className="muted">Ninguna pregunta coincide con los filtros.</p>}

      {filtered.slice(page * PAGE, (page + 1) * PAGE).map((q) => (
        <QuestionCard key={q.id} q={q} onEdit={() => { setEditing(q); window.scrollTo({ top: 0 }); }} />
      ))}

      {pages > 1 && (
        <div className="row" style={{ justifyContent: 'center' }}>
          <button disabled={page === 0} onClick={() => setPage(page - 1)}>Anterior</button>
          <span className="muted small">Página {page + 1} de {pages}</span>
          <button disabled={page >= pages - 1} onClick={() => setPage(page + 1)}>Siguiente</button>
        </div>
      )}
    </>
  );
}
