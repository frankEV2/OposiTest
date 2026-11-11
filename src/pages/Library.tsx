import { useLiveQuery } from 'dexie-react-hooks';
import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import ClassificationPicker from '../components/ClassificationPicker';
import SearchResults from '../components/SearchResults';
import { db } from '../db/db';
import type { DocumentMeta, ID } from '../db/types';
import { deleteDocument, importPdf, replacePdf, type Classification } from '../library/service';

interface Job {
  name: string;
  progress: string;
  error?: string;
  done?: boolean;
}

const STATUS: Record<DocumentMeta['extraction'], [string, string]> = {
  ok: ['Texto extraído', 'ok'],
  partial: ['Extracción parcial', 'warn'],
  scanned: ['Escaneado: sin texto', 'bad'],
  pending: ['Procesando', 'warn'],
  error: ['Error', 'bad'],
};

const fmtSize = (n: number) => (n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.ceil(n / 1024)} KB`);

function DocumentRow({ doc, onReplace }: { doc: DocumentMeta; onReplace: (doc: DocumentMeta) => void }) {
  const stats = useLiveQuery(async () => ({
    articles: await db.sections.where('documentId').equals(doc.id!).filter((s) => s.kind === 'articulo').count(),
    questions: await db.questions.where('documentId').equals(doc.id!).count(),
  }), [doc.id]);
  const [label, cls] = STATUS[doc.extraction];

  async function remove() {
    const q = stats?.questions ? ` y sus ${stats.questions} preguntas generadas` : '';
    if (confirm(`¿Eliminar «${doc.title}»${q}? Esta acción no se puede deshacer.`)) await deleteDocument(doc.id!);
  }

  async function renameDoc() {
    const t = prompt('Título del documento (se usa en los enunciados de las preguntas nuevas)', doc.title);
    if (t && t.trim() && t.trim() !== doc.title) await db.documents.update(doc.id!, { title: t.trim(), updatedAt: Date.now() });
  }

  return (
    <div className="card doc">
      <div className="doc-head">
        <div style={{ minWidth: 0 }}>
          <Link to={`/biblioteca/${doc.id}`} className="doc-title">{doc.title}</Link>
          <div className="muted small">
            {doc.fileName} · {fmtSize(doc.size)} · {doc.pageCount} pág. · {stats?.articles ?? '–'} artículos
          </div>
        </div>
        <span className={`badge ${cls}`}>{label}</span>
      </div>
      {doc.warnings.map((w) => <div key={w} className="warning">{w}</div>)}
      <div className="doc-foot">
        <ClassificationPicker compact value={doc}
          onChange={(c) => db.documents.update(doc.id!, { ...c, updatedAt: Date.now() })} />
        <div className="row">
          <button onClick={renameDoc}>Renombrar</button>
          <button onClick={() => onReplace(doc)}>Sustituir fichero</button>
          <button className="danger" onClick={remove}>Eliminar</button>
        </div>
      </div>
    </div>
  );
}

export default function Library() {
  const [cls, setCls] = useState<Classification>({});
  const [filter, setFilter] = useState<Classification>({});
  const [jobs, setJobs] = useState<Job[]>([]);
  const [query, setQuery] = useState('');
  const importRef = useRef<HTMLInputElement>(null);
  const replaceRef = useRef<HTMLInputElement>(null);
  const replaceTarget = useRef<DocumentMeta | null>(null);

  const docs = useLiveQuery(() => db.documents.orderBy('importedAt').reverse().toArray());
  const visible = docs?.filter((d) =>
    (!filter.oposicionId || d.oposicionId === filter.oposicionId) &&
    (!filter.materiaId || d.materiaId === filter.materiaId) &&
    (!filter.temaId || d.temaId === filter.temaId));

  const update = (i: number, patch: Partial<Job>) =>
    setJobs((js) => js.map((j, k) => (k === i ? { ...j, ...patch } : j)));

  async function runJobs(files: File[], action: (f: File, onP: (p: number, t: number) => void) => Promise<unknown>) {
    const base = jobs.length;
    setJobs((js) => [...js, ...files.map((f) => ({ name: f.name, progress: 'En cola' }))]);
    // Secuencial: evita saturar memoria con PDF grandes.
    for (const [i, f] of files.entries()) {
      try {
        update(base + i, { progress: 'Leyendo…' });
        await action(f, (p, t) => update(base + i, { progress: `Extrayendo página ${p} de ${t}` }));
        update(base + i, { progress: 'Importado', done: true });
      } catch (e) {
        update(base + i, { progress: 'Error', error: (e as Error).message, done: true });
      }
    }
  }

  async function onImport(list: FileList | null) {
    const files = [...(list ?? [])].filter((f) => f.type === 'application/pdf' || /\.(pdf|md|markdown|txt)$/i.test(f.name));
    if (importRef.current) importRef.current.value = '';
    if (files.length) await runJobs(files, (f, onP) => importPdf(f, cls, onP));
  }

  async function onReplaceFile(list: FileList | null) {
    const f = list?.[0];
    const target = replaceTarget.current;
    if (replaceRef.current) replaceRef.current.value = '';
    if (!f || !target) return;
    if (!confirm(`¿Sustituir el fichero de «${target.title}» por «${f.name}»? Las preguntas generadas pasarán a revisión.`)) return;
    await runJobs([f], (file, onP) => replacePdf(target.id as ID, file, onP));
  }

  return (
    <>
      <div className="page-head">
        <div>
          <h1>Biblioteca</h1>
          <p className="sub">Tus normas y temarios (PDF o Markdown). Los .md de la carpeta temario/ se cargan solos. El texto se extrae y se guarda solo en este dispositivo.</p>
        </div>
        <button className="primary" onClick={() => importRef.current?.click()}>Importar PDF o Markdown</button>
        <input ref={importRef} type="file" accept="application/pdf,.pdf,.md,.markdown,.txt,text/markdown,text/plain" multiple hidden
          onChange={(e) => onImport(e.target.files)} />
        <input ref={replaceRef} type="file" accept="application/pdf,.pdf,.md,.markdown,.txt,text/markdown,text/plain" hidden
          onChange={(e) => onReplaceFile(e.target.files)} />
      </div>

      <details className="card">
        <summary>Clasificación para los próximos PDF importados</summary>
        <div style={{ marginTop: 10 }}><ClassificationPicker value={cls} onChange={setCls} /></div>
      </details>

      {jobs.length > 0 && (
        <div className="card">
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <h2 style={{ margin: 0 }}>Importaciones</h2>
            {jobs.every((j) => j.done) && <button className="link" onClick={() => setJobs([])}>Limpiar</button>}
          </div>
          {jobs.map((j, i) => (
            <div key={i} className="small">
              <strong>{j.name}</strong>: <span className={j.error ? 'error' : 'muted'}>{j.error ?? j.progress}</span>
            </div>
          ))}
        </div>
      )}

      {docs && docs.length > 0 && (
        <div className="card">
          <input type="search" style={{ width: '100%' }} value={query} onChange={(e) => setQuery(e.target.value)}
            placeholder='Buscar en todos los documentos (usa "comillas" para frases exactas)' />
          {query.trim() && <SearchResults query={query} />}
        </div>
      )}

      {docs && docs.length > 0 && (
        <details>
          <summary className="muted">Filtrar documentos</summary>
          <div style={{ margin: '8px 0 16px' }}><ClassificationPicker value={filter} onChange={setFilter} /></div>
        </details>
      )}

      {docs?.length === 0 && (
        <div className="card muted">
          No hay documentos. Pulsa «Importar PDF o Markdown» o copia los .md en public/temario/ para añadir normas (BOE, textos consolidados, temarios…).
          Se recomiendan PDF con texto seleccionable; los escaneados no pueden procesarse.
        </div>
      )}
      {visible?.map((d) => (
        <DocumentRow key={d.id} doc={d} onReplace={(doc) => {
          replaceTarget.current = doc;
          replaceRef.current?.click();
        }} />
      ))}
      {docs && visible && docs.length > 0 && visible.length === 0 && (
        <p className="muted">Ningún documento coincide con el filtro.</p>
      )}
    </>
  );
}
