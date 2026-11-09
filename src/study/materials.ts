/**
 * Material de estudio derivado SOLO del texto del documento (funciones puras).
 * No se resume con lenguaje propio: los "resúmenes" son extractos literales
 * (rúbricas, primeras frases, texto completo) y así se indica en la interfaz.
 */
import type { ID, Section, SectionKind } from '../db/types';
import { COMPETENCE, DURATION, findDefinitions, findEnumerations } from '../engine/generate';
import { sentences, shortRef } from '../engine/text';

export const CONTAINER_KINDS: SectionKind[] = ['libro', 'titulo', 'capitulo', 'seccion'];
const isContainer = (s: Section) => CONTAINER_KINDS.includes(s.kind);

export interface TreeNode {
  section: Section;
  children: TreeNode[];
}

/** Árbol de secciones (sin apartados), opcionalmente limitado a un subárbol. */
export function buildTree(sections: Section[], rootId?: ID): TreeNode[] {
  const byParent = new Map<ID | undefined, Section[]>();
  for (const s of [...sections].sort((a, b) => a.order - b.order)) {
    if (s.kind === 'apartado') continue;
    const k = s.parentId;
    byParent.set(k, [...(byParent.get(k) ?? []), s]);
  }
  const build = (s: Section): TreeNode => ({ section: s, children: (byParent.get(s.id) ?? []).map(build) });
  if (rootId !== undefined) {
    const root = sections.find((s) => s.id === rootId);
    return root ? [build(root)] : [];
  }
  return (byParent.get(undefined) ?? []).map(build);
}

/** Secciones de un subárbol en orden (incluye apartados), o todas si no hay raíz. */
export function scopeSections(sections: Section[], rootId?: ID): Section[] {
  const sorted = [...sections].sort((a, b) => a.order - b.order);
  if (rootId === undefined) return sorted;
  const inside = new Set<ID>([rootId]);
  return sorted.filter((s) => {
    if (s.id === rootId || (s.parentId !== undefined && inside.has(s.parentId))) {
      inside.add(s.id!);
      return true;
    }
    return false;
  });
}

export type SummaryLevel = 'breve' | 'medio' | 'completo';

export interface SummaryBlock {
  section: Section;
  depth: number;
  /** Párrafos literales mostrados para esta sección. */
  lines: string[];
}

/**
 * Resumen extractivo:
 *  - breve: estructura con rúbricas de cada artículo.
 *  - medio: rúbrica + primera frase de cada apartado (o del artículo).
 *  - completo: texto íntegro.
 */
export function summarize(sections: Section[], level: SummaryLevel, rootId?: ID): SummaryBlock[] {
  const scope = scopeSections(sections, rootId);
  const children = new Map<ID, Section[]>();
  for (const s of scope) {
    if (s.kind === 'apartado' && s.parentId !== undefined) children.set(s.parentId, [...(children.get(s.parentId) ?? []), s]);
  }
  const depthOf = new Map<ID, number>();
  const out: SummaryBlock[] = [];
  for (const s of scope) {
    if (s.kind === 'apartado') continue;
    const depth = s.parentId !== undefined && depthOf.has(s.parentId) ? depthOf.get(s.parentId)! + 1 : 0;
    depthOf.set(s.id!, depth);
    let lines: string[] = [];
    if (!isContainer(s)) {
      if (level === 'completo') lines = s.text.split('\n').filter(Boolean);
      else if (level === 'medio') {
        const parts = children.get(s.id!) ?? [s];
        lines = parts.map((p) => firstSentence(p.text)).filter(Boolean);
      }
    }
    out.push({ section: s, depth, lines });
  }
  return out;
}

export function firstSentence(text: string): string {
  const first = sentences(text.split('\n').find((l) => l.trim()) ?? '')[0] ?? '';
  return first.length > 400 ? `${first.slice(0, first.lastIndexOf(' ', 400))}…` : first;
}

export function summaryToMarkdown(title: string, level: SummaryLevel, blocks: SummaryBlock[]): string {
  const head = `# ${title}\n\n> Resumen ${level} extractivo: texto literal del documento, sin redacción propia.\n`;
  const body = blocks.map((b) => {
    const s = b.section;
    const name = `${s.label}${s.heading ? `. ${s.heading}` : ''}`;
    const h = isContainer(s) ? `${'#'.repeat(Math.min(b.depth + 2, 6))} ${name}` : `${'  '.repeat(Math.max(0, b.depth - 1))}- **${name}**`;
    return [h, ...b.lines.map((l) => `${'  '.repeat(b.depth)}  ${l}`)].join('\n');
  });
  return `${head}\n${body.join('\n')}\n`;
}

// ------------------------------------------------------------------ mapas (Mermaid)

const esc = (s: string) => s.replace(/"/g, '#quot;').replace(/[<>]/g, ' ').replace(/[[\]{}]/g, ' ').trim();
const clip = (s: string, n = 60) => (s.length > n ? `${s.slice(0, s.lastIndexOf(' ', n) > 20 ? s.lastIndexOf(' ', n) : n)}…` : s);

export const MAX_NODES = 120;

export interface MapResult {
  code: string;
  nodes: number;
  truncated: boolean;
}

/** Mapa de estructura: contenedores → artículos (rúbrica). Ids `s<sectionId>` para enlazar al texto. */
export function structureMap(sections: Section[], rootId: ID | undefined, title: string): MapResult {
  const lines = ['flowchart LR', `  root(["${esc(clip(title, 50))}"])`];
  let count = 0;
  let truncated = false;
  const walk = (nodes: TreeNode[], parent: string) => {
    for (const n of nodes) {
      if (count >= MAX_NODES) { truncated = true; return; }
      const s = n.section;
      const id = `s${s.id}`;
      const label = isContainer(s) ? `${s.label}${s.heading ? `<br/>${clip(s.heading, 50)}` : ''}` : `${shortRef(s.label)}${s.heading ? `. ${clip(s.heading, 45)}` : ''}`;
      lines.push(`  ${id}${isContainer(s) ? `["${esc(label).replace(' br/ ', '<br/>')}"]` : `("${esc(label)}")`}`);
      lines.push(`  ${parent} --> ${id}`);
      if (isContainer(s)) lines.push(`  class ${id} container`);
      count++;
      walk(n.children, id);
    }
  };
  walk(buildTree(sections, rootId), 'root');
  lines.push('  classDef container fill:#e8f0fa,stroke:#1f5fae,color:#1c2330');
  return { code: lines.join('\n'), nodes: count, truncated };
}

/** Mapa conceptual: definiciones, enumeraciones, plazos y competencias detectados en el ámbito elegido. */
export function conceptMap(sections: Section[], rootId: ID | undefined, title: string): MapResult {
  const units = scopeSections(sections, rootId).filter((s) => s.kind === 'articulo' || s.kind === 'disposicion');
  const lines = ['flowchart LR', `  root(["${esc(clip(title, 50))}"])`];
  let count = 0;
  let truncated = false;
  let k = 0;
  const add = (parent: string, label: string, cls?: string) => {
    if (count >= MAX_NODES) { truncated = true; return null; }
    const id = `c${k++}`;
    lines.push(`  ${id}["${esc(clip(label, 70))}"]`, `  ${parent} --> ${id}`);
    if (cls) lines.push(`  class ${id} ${cls}`);
    count++;
    return id;
  };
  for (const s of units) {
    const defs = findDefinitions(s.text);
    const enums = findEnumerations(s.text);
    const plazos = sentences(s.text).filter((x) => /plazo/i.test(x)).flatMap((x) => [...x.matchAll(DURATION)].map((m) => m[0]));
    const organs = [...s.text.matchAll(COMPETENCE)].map((m) => m[1]);
    if (!defs.length && !enums.length && !plazos.length && !organs.length) continue;
    if (count >= MAX_NODES) { truncated = true; break; }
    const art = `s${s.id}`;
    lines.push(`  ${art}("${esc(`${shortRef(s.label)}${s.heading ? `. ${clip(s.heading, 40)}` : ''}`)}")`, `  root --> ${art}`);
    count++;
    for (const d of defs) add(art, `${d.term}: ${d.def}`, 'def');
    for (const e of enums) {
      const id = add(art, e.intro, 'enum');
      if (id) for (const it of e.items) add(id, it);
    }
    for (const p of new Set(plazos)) add(art, `Plazo: ${p}`, 'plazo');
    for (const o of new Set(organs)) add(art, `Competencia: ${o}`, 'comp');
  }
  lines.push(
    '  classDef def fill:#eef7f1,stroke:#1a7f4b,color:#1c2330',
    '  classDef enum fill:#fff6e5,stroke:#b27500,color:#1c2330',
    '  classDef plazo fill:#fdecec,stroke:#b42318,color:#1c2330',
    '  classDef comp fill:#e8f0fa,stroke:#1f5fae,color:#1c2330',
  );
  return { code: lines.join('\n'), nodes: count, truncated };
}

// ------------------------------------------------------------------ fichas

export interface Flashcard {
  front: string;
  back: string;
  sectionId: ID;
  reference: string;
}

/** Fichas pregunta-respuesta con respuesta literal. */
export function flashcards(sections: Section[], rootId?: ID): Flashcard[] {
  const out: Flashcard[] = [];
  const scope = scopeSections(sections, rootId);
  const hasApartados = new Set(scope.filter((s) => s.kind === 'apartado').map((s) => s.parentId));
  for (const s of scope) {
    if (!(s.kind === 'articulo' || s.kind === 'disposicion' || s.kind === 'apartado')) continue;
    const ref = shortRef(s.label);
    // Definiciones y enumeraciones: a nivel de artículo (sus apartados repetirían el texto).
    if (s.kind !== 'apartado') {
      for (const d of findDefinitions(s.text)) out.push({ front: `¿Qué se entiende por «${d.term}»? (${ref})`, back: d.def, sectionId: s.id!, reference: ref });
      for (const e of findEnumerations(s.text)) {
        out.push({ front: `${e.intro} (${ref})`, back: e.items.map((it, i) => `${String.fromCharCode(97 + i)}) ${it}`).join('\n'), sectionId: s.id!, reference: ref });
      }
    }
    if (s.kind !== 'apartado' && hasApartados.has(s.id)) continue;
    for (const sent of sentences(s.text)) {
      const plazos = [...sent.matchAll(DURATION)];
      if (/plazo/i.test(sent) && plazos.length === 1) {
        const m = plazos[0];
        out.push({ front: `¿Qué plazo? «${sent.slice(0, m.index)}______${sent.slice(m.index! + m[0].length)}» (${ref})`, back: m[0], sectionId: s.id!, reference: ref });
      }
      const comp = [...sent.matchAll(COMPETENCE)][0];
      if (comp && comp[1].split(/\s+/).length >= 2) {
        const at = comp.index! + comp[0].length - comp[1].length;
        out.push({ front: `¿Quién? «${sent.slice(0, at)}______${sent.slice(at + comp[1].length)}» (${ref})`, back: comp[1], sectionId: s.id!, reference: ref });
      }
    }
  }
  return out;
}
