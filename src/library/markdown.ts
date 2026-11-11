import type { ParsedSection } from '../pdf/structure';
import type { SectionKind } from '../db/types';

/** Líneas por "página" virtual (para el visor por páginas y la búsqueda). */
const LINES_PER_PAGE = 60;

export function isMarkdownName(name: string) {
  return /\.(md|markdown|txt)$/i.test(name);
}

/** Quita la sintaxis Markdown de una línea dejando el texto tal cual. */
function plain(line: string): string {
  return line
    .replace(/^\s{0,3}>\s?/, '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/(\*\*|__)(.+?)\1/g, '$2')
    .replace(/(^|[\s(])[*_]([^*_\n]+)[*_](?=[\s).,;:]|$)/g, '$1$2')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/^\s*\|(.*)\|\s*$/, (_, c: string) => c.split('|').map((x) => x.trim()).join(' · '))
    .replace(/^\s*[*+]\s+/, '- ')
    .replace(/\\([\\`*_{}[\]()#+\-.!])/g, '$1');
}

interface MdLine { text: string; level: number }

function parseLines(md: string): MdLine[] {
  const out: MdLine[] = [];
  let fence = false;
  for (const raw of md.replace(/\r\n?/g, '\n').replace(/^﻿/, '').split('\n')) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (!fence && /^\s*\|?\s*:?-{3,}:?\s*(\|\s*:?-{3,}:?\s*)*\|?\s*$/.test(raw) && raw.includes('|')) continue; // separador de tabla
    if (!fence && /^\s{0,3}([-*_])(\s*\1){2,}\s*$/.test(raw)) { out.push({ text: '', level: 0 }); continue; } // regla horizontal
    const h = fence ? null : /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/.exec(raw);
    if (h) out.push({ text: plain(h[2]), level: h[1].length });
    else out.push({ text: fence ? raw : plain(raw), level: 0 });
  }
  return out;
}

/** Divide en páginas virtuales cortando preferentemente antes de un encabezado. */
function paginate(lines: MdLine[]): { pages: string[]; pageOf: number[] } {
  const pages: string[] = [];
  const pageOf: number[] = [];
  let cur: string[] = [];
  lines.forEach((l, i) => {
    if (cur.length >= LINES_PER_PAGE && (l.level > 0 || cur.length >= LINES_PER_PAGE * 1.5)) {
      pages.push(cur.join('\n'));
      cur = [];
    }
    cur.push(l.text);
    pageOf[i] = pages.length + 1;
  });
  if (cur.length || !pages.length) pages.push(cur.join('\n'));
  return { pages, pageOf };
}

/**
 * Estructura a partir de los encabezados Markdown (para temarios sin artículos).
 * Los encabezados sin subencabezados son las unidades de estudio ('articulo'),
 * los que contienen otros se convierten en título/capítulo/sección.
 */
function headingSections(lines: MdLine[], pageOf: number[]): ParsedSection[] {
  const idx = lines.map((l, i) => (l.level ? i : -1)).filter((i) => i >= 0);
  if (!idx.length) return [];
  const levels = [...new Set(idx.map((i) => lines[i].level))].sort();
  const GROUP: SectionKind[] = ['titulo', 'capitulo', 'seccion'];
  const out: ParsedSection[] = [];
  const stack: { level: number; index: number }[] = [];
  idx.forEach((li, k) => {
    const level = lines[li].level;
    const next = idx[k + 1];
    const end = next ?? lines.length;
    const hasChildren = next !== undefined && lines[next].level > level;
    const body = lines.slice(li + 1, end).map((l) => l.text).join('\n')
      .replace(/\n{3,}/g, '\n\n').trim();
    while (stack.length && stack[stack.length - 1].level >= level) stack.pop();
    const depth = Math.min(levels.indexOf(level), GROUP.length - 1);
    if (!hasChildren && !body) return;
    const kind: SectionKind = hasChildren ? GROUP[depth] : 'articulo';
    out.push({
      kind, label: lines[li].text.slice(0, 120), heading: '', text: body,
      pageStart: pageOf[li], parent: stack.length ? stack[stack.length - 1].index : undefined,
    });
    if (hasChildren) stack.push({ level, index: out.length - 1 });
  });
  return out;
}

export interface MarkdownDoc {
  pages: string[];
  title?: string;
  /** Estructura por encabezados, usada si el texto no contiene artículos. */
  headingSections: ParsedSection[];
}

export function parseMarkdown(md: string): MarkdownDoc {
  const lines = parseLines(md);
  const { pages, pageOf } = paginate(lines);
  const first = lines.find((l) => l.level === 1) ?? lines.find((l) => l.level > 0);
  return { pages, title: first?.text, headingSections: headingSections(lines, pageOf) };
}
