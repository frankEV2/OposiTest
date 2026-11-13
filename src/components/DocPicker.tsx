import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../db/db';
import type { DocumentMeta, ExamConfig, ID } from '../db/types';

/**
 * Selector de temario compacto: bloques plegables (Temario general / específico…), dentro de cada bloque una entrada por
 * normativa (los extractos de la misma ley repartidos por temas se agrupan) y, al desplegarla, sus temas y artículos.
 * Un clic en la normativa la selecciona entera. La selección vive en `cfg`, así que se conserva al plegar y desplegar.
 * Cada documento sigue siendo independiente (y conserva su tema): solo cambia cómo se muestran.
 */
interface Props { cfg: ExamConfig; set: (patch: Partial<ExamConfig>) => void }
interface Group { key: string; title: string; docs: (DocumentMeta & { tema: string })[] }
interface Block { name: string; groups: Group[] }

/** «Ley 31/1995, de 8 de noviembre, de PRL (Tema 01)» → «Ley 31/1995, de 8 de noviembre, de PRL». */
const baseTitle = (t: string) => t.replace(/\s*\((?:Tema|Tem[aà])\s*\d+[^)]*\)\s*$/iu, '').trim();
const temaLabel = (name: string) => name.replace(/^(Tema\s+\d+)\.?\s*/i, '$1 · ');

function Check({ state, onChange, children }: { state: 'all' | 'some' | 'none'; onChange: () => void; children: React.ReactNode }) {
  return (
    <label className="check">
      <input type="checkbox" checked={state === 'all'} ref={(el) => { if (el) el.indeterminate = state === 'some'; }} onChange={onChange} />
      {children}
    </label>
  );
}

export default function DocPicker({ cfg, set }: Props) {
  const [open, setOpen] = useState<Set<string>>(new Set());
  const blocks = useLiveQuery(async () => {
    const [docs, temas, materias] = await Promise.all([db.documents.toArray(), db.temas.toArray(), db.materias.toArray()]);
    const tema = new Map(temas.map((t) => [t.id!, t]));
    const materia = new Map(materias.map((m) => [m.id!, m]));
    const out = new Map<string, { order: number; groups: Map<string, Group> }>();
    for (const d of docs.filter((x) => x.extraction !== 'scanned')) {
      const t = d.temaId !== undefined ? tema.get(d.temaId) : undefined;
      const m = materia.get(t?.materiaId ?? d.materiaId ?? -1);
      const name = m?.name ?? 'Documentos';
      const b = out.get(name) ?? { order: m?.order ?? 999, groups: new Map() };
      out.set(name, b);
      const title = baseTitle(d.title);
      const g = b.groups.get(title) ?? { key: `${name}|${title}`, title, docs: [] };
      g.docs.push({ ...d, tema: t?.name ?? '' });
      b.groups.set(title, g);
    }
    return [...out].sort((a, b) => a[1].order - b[1].order || a[0].localeCompare(b[0]))
      .map(([name, b]): Block => ({
        name,
        groups: [...b.groups.values()].map((g) => ({ ...g, docs: g.docs.sort((x, y) => x.tema.localeCompare(y.tema)) }))
          .sort((x, y) => x.docs[0].tema.localeCompare(y.docs[0].tema) || x.title.localeCompare(y.title)),
      }));
  });
  const openDoc = [...open].filter((k) => k.startsWith('doc:')).map((k) => Number(k.slice(4)));
  const articles = useLiveQuery(async () => {
    const secs = openDoc.length ? await db.sections.where('documentId').anyOf(openDoc).sortBy('order') : [];
    return secs.filter((s) => s.kind === 'articulo' || s.kind === 'disposicion' || s.kind === 'anexo');
  }, [openDoc.join(',')]);
  if (!blocks) return null;

  const selected = new Set(cfg.documentIds);
  const stateOf = (ids: ID[]) => {
    const n = ids.filter((id) => selected.has(id)).length;
    return n === 0 ? 'none' : n === ids.length ? 'all' : 'some';
  };
  const setDocs = (ids: ID[], on: boolean) => {
    const next = new Set(selected);
    ids.forEach((id) => (on ? next.add(id) : next.delete(id)));
    // Al quitar un documento se olvidan sus artículos concretos.
    const keep = cfg.sectionIds.filter((sid) => {
      const s = articles?.find((a) => a.id === sid);
      return !s || next.has(s.documentId);
    });
    set({ documentIds: [...next], sectionIds: keep, temaIds: [] });
  };
  const toggleOpen = (k: string) => setOpen((o) => { const n = new Set(o); if (n.has(k)) n.delete(k); else n.add(k); return n; });
  const toggleSection = (docId: ID, sid: ID) => {
    const on = !cfg.sectionIds.includes(sid);
    const sectionIds = on ? [...cfg.sectionIds, sid] : cfg.sectionIds.filter((x) => x !== sid);
    set({ sectionIds, documentIds: on && !selected.has(docId) ? [...cfg.documentIds, docId] : cfg.documentIds, temaIds: [] });
  };

  const nGroups = blocks.flatMap((b) => b.groups).filter((g) => stateOf(g.docs.map((d) => d.id!)) !== 'none').length;
  return (
    <div className="docpick">
      <p className="muted small">
        {cfg.documentIds.length === 0 ? 'Sin selección: entra todo el temario.'
          : `Seleccionado: ${nGroups} normativa${nGroups === 1 ? '' : 's'} · ${cfg.documentIds.length} documento${cfg.documentIds.length === 1 ? '' : 's'}`
            + (cfg.sectionIds.length ? ` · ${cfg.sectionIds.length} artículo${cfg.sectionIds.length === 1 ? '' : 's'} concretos` : '')}
        {cfg.documentIds.length > 0 && <button className="link" onClick={() => set({ documentIds: [], sectionIds: [], temaIds: [] })}>Quitar todo</button>}
      </p>
      {blocks.map((b) => {
        const ids = b.groups.flatMap((g) => g.docs.map((d) => d.id!));
        const n = ids.filter((id) => selected.has(id)).length;
        return (
          <details key={b.name} className="docpick-block">
            <summary><strong>{b.name}</strong> <span className="muted small">{n ? `${n}/${ids.length} seleccionados` : `${b.groups.length} normativas`}</span></summary>
            <div className="docpick-actions">
              <button className="link" onClick={() => setDocs(ids, true)}>Seleccionar todo</button>
              <button className="link" onClick={() => setDocs(ids, false)}>Deseleccionar todo</button>
            </div>
            {b.groups.map((g) => {
              const gids = g.docs.map((d) => d.id!);
              const multi = g.docs.length > 1;
              // Una sola pieza: el desplegable muestra directamente sus artículos.
              const gk = multi ? g.key : `doc:${gids[0]}`;
              return (
                <div key={g.key} className="docpick-group">
                  <div className="docpick-row">
                    <Check state={stateOf(gids)} onChange={() => setDocs(gids, stateOf(gids) !== 'all')}>
                      {g.title}{multi && <span className="muted small"> · {g.docs.length} temas</span>}
                    </Check>
                    <button className="link" aria-expanded={open.has(gk)} onClick={() => toggleOpen(gk)}>
                      {open.has(gk) ? 'Ocultar' : multi ? 'Temas y artículos' : 'Artículos'}
                    </button>
                  </div>
                  {open.has(gk) && (
                    <div className="docpick-sub">
                      {g.docs.map((d) => {
                        const arts = articles?.filter((a) => a.documentId === d.id) ?? [];
                        const dk = `doc:${d.id}`;
                        return (
                          <div key={d.id}>
                            {multi && (
                              <div className="docpick-row">
                                <Check state={selected.has(d.id!) ? 'all' : 'none'} onChange={() => setDocs([d.id!], !selected.has(d.id!))}>
                                  {d.tema ? temaLabel(d.tema) : d.title}
                                </Check>
                                <button className="link" onClick={() => toggleOpen(dk)}>{open.has(dk) ? 'Ocultar artículos' : 'Artículos'}</button>
                              </div>
                            )}
                            {open.has(dk) && (
                              <div className="article-list">
                                {arts.length === 0 && <span className="muted small">Sin artículos detectados.</span>}
                                {arts.map((a) => (
                                  <label key={a.id} className="check">
                                    <input type="checkbox" checked={cfg.sectionIds.includes(a.id!)} onChange={() => toggleSection(d.id!, a.id!)} />
                                    {a.label}
                                  </label>
                                ))}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  )}
                </div>
              );
            })}
          </details>
        );
      })}
    </div>
  );
}
