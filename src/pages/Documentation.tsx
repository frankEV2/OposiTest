/**
 * Biblioteca y documentación de la oposición abierta: normativa oficial (enlaces BOE/DOGC), apuntes y temario (.md)
 * y modelos de examen (PDF). Los datos salen de public/biblioteca/index.json (scripts/biblioteca.mjs), separados por
 * oposición. Los documentos se consultan en un visor superpuesto, sin perder la posición en la lista.
 */
import { useEffect, useMemo, useState } from 'react';
import { activeWorkspace } from '../workspaces';
import { norm } from '../engine/text';

interface Norma { key: string; title: string; bloque: string; url: string; pdf?: string; fuente: string; temas: string[]; textos: { tema?: string; file: string }[] }
interface Apunte { file: string; bloque: string; tema: string; tipo: string; title: string }
interface Examen { grupo: string; title: string; file: string }
interface Lib { normativa: Norma[]; apuntes: Apunte[]; examenes: Examen[] }
type View = { title: string; pdf?: string; md?: string; href: string };

const BASE = import.meta.env.BASE_URL;
const tFile = (f: string) => `${BASE}temario/${f.split('/').map(encodeURIComponent).join('/')}`;
const short = (t: string) => t.replace(/^(Tema\s+\d+)\.?.*$/i, '$1');
const groupBy = <T,>(list: T[], key: (x: T) => string) => {
  const m = new Map<string, T[]>();
  for (const x of list) m.set(key(x), [...(m.get(key(x)) ?? []), x]);
  return [...m];
};

/** Markdown sencillo → elementos (títulos, listas y párrafos); nunca HTML sin escapar. */
function Markdown({ text }: { text: string }) {
  const blocks = text.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean);
  return (
    <div className="lib-md">
      {blocks.map((b, i) => {
        const h = b.match(/^(#{1,4})\s+(.*)$/s);
        if (h) return h[1].length <= 1 ? <h2 key={i}>{h[2]}</h2> : <h3 key={i}>{h[2]}</h3>;
        const lines = b.split('\n');
        if (lines.every((l) => /^\s*([-*•]|\d+[.)]|[a-z]\))\s+/.test(l))) {
          return <ul key={i}>{lines.map((l, j) => <li key={j}>{l.replace(/^\s*[-*•]\s+/, '')}</li>)}</ul>;
        }
        return <p key={i}>{lines.map((l, j) => <span key={j}>{l}{j < lines.length - 1 && <br />}</span>)}</p>;
      })}
    </div>
  );
}

/** Versión imprimible (Guardar como PDF del navegador) de un texto .md. */
function printText(title: string, text: string) {
  const w = window.open('', '_blank');
  if (!w) return;
  w.document.title = title;
  const style = w.document.createElement('style');
  style.textContent = 'body{font:12pt/1.5 Georgia,serif;margin:2cm;white-space:pre-wrap}h1{font-size:16pt}';
  w.document.head.appendChild(style);
  const h = w.document.createElement('h1');
  h.textContent = title;
  const pre = w.document.createElement('div');
  pre.textContent = text.replace(/^#+\s*/gm, '');
  w.document.body.append(h, pre);
  setTimeout(() => w.print(), 300);
}

export default function Documentation() {
  const ws = activeWorkspace();
  const [lib, setLib] = useState<Lib | null>(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [view, setView] = useState<View | null>(null);

  useEffect(() => {
    fetch(`${BASE}biblioteca/index.json`, { cache: 'no-cache' })
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(`Error ${r.status}`))))
      .then((all) => setLib(all[ws.id] ?? { normativa: [], apuntes: [], examenes: [] }))
      .catch(() => setError('No se ha podido cargar la biblioteca (¿sin conexión?).'));
  }, [ws.id]);

  useEffect(() => {
    if (!view) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setView(null); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [view]);

  const f = useMemo(() => {
    if (!lib) return null;
    const words = norm(q).split(/\s+/).filter(Boolean);
    const ok = (...s: string[]) => { const t = norm(s.join(' ')); return words.every((w) => t.includes(w)); };
    return {
      normativa: lib.normativa.filter((n) => ok(n.title, n.bloque, ...n.temas)),
      apuntes: lib.apuntes.filter((a) => ok(a.title, a.tema, a.tipo, a.bloque)),
      examenes: lib.examenes.filter((x) => ok(x.title, x.grupo)),
    };
  }, [lib, q]);

  async function openMd(title: string, files: string[]) {
    const texts = await Promise.all(files.map((file) => fetch(tFile(file)).then((r) => r.text()).catch(() => '')));
    setView({ title, md: texts.join('\n\n---\n\n'), href: tFile(files[0]) });
  }

  if (error) return <><h1>Biblioteca</h1><p className="error">{error}</p></>;
  if (!lib || !f) return <h1>Biblioteca</h1>;
  const searching = q.trim().length > 0;

  return (
    <>
      <h1>Biblioteca</h1>
      <p className="sub">{ws.nombre} · {ws.organismo}: normativa oficial, apuntes y modelos de examen.</p>
      <input className="lib-search" type="search" placeholder="Buscar por nombre, normativa o tema…" value={q} onChange={(e) => setQ(e.target.value)} />

      <details className="lib-sec lib-normativa" open={searching || undefined}>
        <summary>⚖️ Normativa y legislación <span className="muted small">{f.normativa.length}</span></summary>
        {groupBy(f.normativa, (n) => n.bloque).map(([bloque, list]) => (
          <div key={bloque}>
            <h3 className="lib-bloque">{bloque}</h3>
            {list.map((n) => (
              <div key={n.key} className="lib-item">
                <div className="lib-main">
                  <strong>{n.title}</strong>
                  <span className="muted small">{n.fuente}{n.temas.length > 0 && ` · Temas: ${n.temas.map(short).join(', ')}`}</span>
                </div>
                <div className="lib-actions">
                  <a className="btn" href={n.url} target="_blank" rel="noopener noreferrer" title="Texto oficial">🌐 Oficial</a>
                  {n.pdf && <a className="btn" href={n.pdf} target="_blank" rel="noopener noreferrer" title="PDF oficial">📄 PDF</a>}
                  {n.textos.length > 0 && (
                    <button onClick={() => openMd(n.title, n.textos.map((t) => t.file))} title="Artículos incluidos en el temario">📖 Temario</button>
                  )}
                </div>
              </div>
            ))}
          </div>
        ))}
        {f.normativa.length === 0 && <p className="muted small">Sin resultados.</p>}
      </details>

      <details className="lib-sec lib-apuntes" open={searching || undefined}>
        <summary>📝 Apuntes y material de estudio <span className="muted small">{f.apuntes.length}</span></summary>
        {groupBy(f.apuntes, (a) => a.bloque).map(([bloque, list]) => (
          <div key={bloque}>
            <h3 className="lib-bloque">{bloque}</h3>
            {groupBy(list, (a) => a.tema || 'General').map(([tema, items]) => (
              <div key={tema} className="lib-tema">
                <p className="muted small">{tema}</p>
                {items.map((a) => (
                  <div key={a.file} className="lib-item">
                    <div className="lib-main">
                      <strong>{a.tipo === 'Apuntes' ? '📝 ' : ''}{a.tipo === 'Apuntes' ? 'Apuntes' : a.title}</strong>
                      <span className="muted small">{a.tipo}</span>
                    </div>
                    <div className="lib-actions">
                      <button onClick={() => openMd(`${a.title}`, [a.file])}>Leer</button>
                      <a className="btn" href={tFile(a.file)} download>⬇ .md</a>
                      <button onClick={async () => printText(a.title, await fetch(tFile(a.file)).then((r) => r.text()))} title="Imprimir o guardar como PDF">🖨 PDF</button>
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        ))}
        {f.apuntes.length === 0 && <p className="muted small">Sin resultados.</p>}
      </details>

      <details className="lib-sec lib-examenes" open={searching || undefined}>
        <summary>📋 Modelos de examen <span className="muted small">{f.examenes.length}</span></summary>
        {lib.examenes.length === 0 ? (
          <p className="muted small">Todavía no hay modelos de examen oficiales de esta oposición en la aplicación.</p>
        ) : groupBy(f.examenes, (x) => x.grupo).map(([grupo, list]) => (
          <div key={grupo}>
            <h3 className="lib-bloque">{grupo}</h3>
            {list.map((x) => (
              <div key={x.file} className="lib-item">
                <div className="lib-main"><strong>📋 {x.title}</strong><span className="muted small">PDF oficial</span></div>
                <div className="lib-actions">
                  <button onClick={() => setView({ title: `${grupo} · ${x.title}`, pdf: BASE + x.file, href: BASE + x.file })}>Ver</button>
                  <a className="btn" href={BASE + x.file} download>⬇ Descargar</a>
                </div>
              </div>
            ))}
          </div>
        ))}
      </details>

      {view && (
        <div className="lib-modal" role="dialog" aria-modal="true" aria-label={view.title} onClick={() => setView(null)}>
          <div className="lib-modal-box" onClick={(e) => e.stopPropagation()}>
            <div className="lib-modal-head">
              <strong>{view.title}</strong>
              <div className="lib-actions">
                <a className="btn" href={view.href} target="_blank" rel="noopener noreferrer">Abrir en pestaña</a>
                {view.md !== undefined && <button onClick={() => printText(view.title, view.md!)}>🖨 PDF</button>}
                <button onClick={() => setView(null)} aria-label="Cerrar">✕</button>
              </div>
            </div>
            <div className="lib-modal-body">
              {view.pdf ? <iframe title={view.title} src={view.pdf} /> : <Markdown text={view.md ?? ''} />}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
