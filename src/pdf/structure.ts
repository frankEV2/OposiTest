import type { SectionKind } from '../db/types';
import { joinParagraphs } from './clean';

/** Sección detectada antes de guardarse; `parent` es un índice dentro del array. */
export interface ParsedSection {
  kind: SectionKind;
  label: string;
  heading: string;
  text: string;
  pageStart: number;
  parent?: number;
  /** Interno: entrada del índice del documento (se descarta al final). */
  toc?: boolean;
}

const LEVEL: Record<SectionKind, number> = {
  libro: 0, titulo: 1, capitulo: 2, seccion: 3,
  preambulo: 4, articulo: 4, disposicion: 4, anexo: 4, apartado: 5,
};

const ORD = '(?:primera|segunda|tercera|cuarta|quinta|sexta|s[ée]ptima|octava|novena|d[ée]cima|und[ée]cima|duod[ée]cima|vig[ée]sima|trig[ée]sima|[\\p{L}]+(?:primera|segunda|tercera|cuarta|quinta|sexta|s[ée]ptima|octava|novena)|[úu]nica)';

interface Rule {
  kind: SectionKind;
  re: RegExp;
}

// Todas se aplican al inicio de línea. Grupo 1 = etiqueta, grupo 2 = título en la misma línea.
const RULES: Rule[] = [
  { kind: 'libro', re: /^(LIBRO\s+(?:[IVXLC]+|PRELIMINAR|[A-ZÁÉÍÓÚ]+))\.?\s*(.*)$/u },
  { kind: 'titulo', re: /^(T[ÍI]TULO\s+(?:[IVXLC]+|PRELIMINAR))\.?\s*(.*)$/u },
  { kind: 'capitulo', re: /^(CAP[ÍI]TULO\s+(?:[IVXLC]+|PRELIMINAR|[ÚU]NICO))\.?\s*(.*)$/u },
  { kind: 'seccion', re: /^((?:Secci[óo]n|SECCI[ÓO]N)\s+(?:\d+\.?ª|[IVXLC]+|[ÚU]NICA|[úu]nica|\d+))\.?\s*(.*)$/u },
  { kind: 'articulo', re: /^((?:Art[íi]culo|ART[ÍI]CULO|Art\.)\s+\d+(?:\s+(?:bis|ter|quater|quinquies|sexies|septies))?)\.\s*(.*)$/u },
  { kind: 'articulo', re: /^((?:Art[íi]culo|ART[ÍI]CULO)\s+[úu]nico)\.\s*(.*)$/u },
  // Constitución y otras normas: "Artículo 14" solo en su línea, sin rúbrica.
  { kind: 'articulo', re: /^((?:Art[íi]culo|ART[ÍI]CULO)\s+\d+(?:\s+(?:bis|ter|quater))?)\s*()$/u },
  {
    kind: 'disposicion',
    re: new RegExp(`^((?:Disposici[óo]n|DISPOSICI[ÓO]N)\\s+(?:adicional|transitoria|derogatoria|final|ADICIONAL|TRANSITORIA|DEROGATORIA|FINAL)\\s+${ORD})\\.?\\s*(.*)$`, 'iu'),
  },
  // "Disposición derogatoria" / "Disposición final" sin ordinal, solas en su línea (Constitución).
  { kind: 'disposicion', re: /^((?:Disposici[óo]n|DISPOSICI[ÓO]N)\s+(?:derogatoria|final|DEROGATORIA|FINAL))\.?\s*()$/u },
  { kind: 'anexo', re: /^(ANEXO(?:\s+[IVXLC\d]+)?)\.?\s*(.*)$/u },
  { kind: 'preambulo', re: /^(PRE[ÁA]MBULO|EXPOSICI[ÓO]N DE MOTIVOS)\s*$/u },
];

const APARTADO = /^(\d{1,2})\.\s+\S/;
/** Línea de índice con puntos guía y número de página: "Artículo 3. Objeto . . . . . 12". */
const TOC_LEADER = /(?:\.\s?){4,}\s*\d+\s*$/;
/** Encabezado de índice que cabe en una línea: "Disposición final tercera. Modificación de… social. 69". */
const TOC_PAGE_END = /\.\s+\d{1,3}$/;
/** Máximo de líneas que puede durar una cita «…» sin cerrar antes de darla por rota. */
const MAX_QUOTE_LINES = 400;

/** Normaliza la etiqueta: "ARTÍCULO 5" → "Artículo 5". */
function prettyLabel(kind: SectionKind, raw: string): string {
  const s = raw.replace(/\s+/g, ' ').trim();
  if (kind === 'articulo') return s.replace(/^(art[íi]culo|art\.)/i, 'Artículo');
  if (kind === 'disposicion') {
    const low = s.toLowerCase().replace(/^disposicion/, 'disposición');
    return low.charAt(0).toUpperCase() + low.slice(1);
  }
  return s;
}

/**
 * Detecta la estructura jurídica de un texto (títulos, capítulos, artículos,
 * apartados, disposiciones...). `pages` es el texto ya limpio de cada página.
 */
export function parseStructure(pages: string[]): ParsedSection[] {
  const out: ParsedSection[] = [];
  const stack: number[] = []; // índices de secciones abiertas
  let current: { idx: number; lines: string[] } | null = null;
  let awaitingHeading = false; // títulos/capítulos suelen llevar el nombre en la línea siguiente

  const flush = () => {
    if (current) out[current.idx].text = joinParagraphs(current.lines.join('\n')).trim();
  };

  const open = (kind: SectionKind, label: string, heading: string, page: number) => {
    flush();
    // Las disposiciones, anexos y el preámbulo están fuera de títulos y capítulos.
    if (kind === 'disposicion' || kind === 'anexo' || kind === 'preambulo') stack.length = 0;
    while (stack.length && LEVEL[out[stack[stack.length - 1]].kind] >= LEVEL[kind]) stack.pop();
    const parent = stack.length ? stack[stack.length - 1] : undefined;
    out.push({ kind, label, heading: heading.trim(), text: '', pageStart: page, parent });
    stack.push(out.length - 1);
    current = { idx: out.length - 1, lines: [] };
    awaitingHeading = !heading.trim() && LEVEL[kind] <= 3;
  };

  // Texto citado entre « » (p. ej. una disposición que da nueva redacción a otra ley): sus
  // "Artículo N." pertenecen a OTRA norma y no deben abrir secciones de este documento.
  let quoteDepth = 0;
  let quoteLines = 0;

  pages.forEach((pageText, p) => {
    for (const rawLine of pageText.split('\n')) {
      const line = rawLine.trim();
      if (!line) {
        current?.lines.push('');
        continue;
      }
      // Línea de índice: cierra la sección abierta (también una entrada de índice partida en dos líneas)
      // para que el texto que siga (p. ej. el preámbulo) no se atribuya a esa entrada.
      const isToc = TOC_LEADER.test(line) || (TOC_PAGE_END.test(line) && RULES.some((r) => r.re.test(line)));
      if (isToc) {
        if (current) out[(current as { idx: number }).idx].toc = true;
        flush();
        current = null;
        awaitingHeading = false;
        continue;
      }
      const inQuote = quoteDepth > 0;
      quoteDepth = Math.max(0, quoteDepth + (line.match(/«/g)?.length ?? 0) - (line.match(/»/g)?.length ?? 0));
      quoteLines = quoteDepth > 0 ? quoteLines + 1 : 0;
      if (quoteLines > MAX_QUOTE_LINES) { quoteDepth = 0; quoteLines = 0; }
      if (inQuote) {
        current?.lines.push(line);
        continue;
      }
      const rule = RULES.find((r) => r.re.test(line));
      if (rule) {
        const m = line.match(rule.re)!;
        open(rule.kind, prettyLabel(rule.kind, m[1]), m[2] ?? '', p + 1);
        continue;
      }
      if (awaitingHeading && current) {
        out[current.idx].heading = line;
        awaitingHeading = false;
        continue;
      }
      const cur = current as { idx: number; lines: string[] } | null;
      if (cur && APARTADO.test(line)) {
        const parentIdx = stack.find((i) => out[i].kind === 'articulo');
        if (parentIdx !== undefined) {
          const n = line.match(APARTADO)![1];
          open('apartado', `${out[parentIdx].label}.${n}`, '', p + 1);
          current!.lines.push(line);
          // el texto del apartado también forma parte del artículo
          continue;
        }
      }
      current?.lines.push(line);
    }
  });
  flush();

  // El texto de un artículo debe incluir el de sus apartados.
  out.forEach((s, i) => {
    if (s.kind === 'apartado' && s.parent !== undefined) {
      const art = out[s.parent];
      art.text = art.text ? `${art.text}\n${s.text}` : s.text;
      void i;
    }
  });

  // Repetir hasta estabilizar: al quitar los artículos del índice, sus títulos quedan vacíos.
  let list = out;
  for (;;) {
    const next = removeIndexEntries(list);
    if (next.length === list.length) return next;
    list = next;
  }
}

/**
 * Los textos consolidados (BOE) incluyen un índice al principio que repite las
 * etiquetas sin contenido. Se descartan las entradas vacías cuya etiqueta vuelve a aparecer.
 */
function removeIndexEntries(list: ParsedSection[]): ParsedSection[] {
  const key = (s: ParsedSection) => `${s.kind}|${s.label.toLowerCase()}`;
  const counts = new Map<string, number>();
  list.forEach((s) => counts.set(key(s), (counts.get(key(s)) ?? 0) + 1));
  const seen = new Map<string, number>();
  const keep = list.map((s) => {
    const k = key(s);
    const n = (seen.get(k) ?? 0) + 1;
    seen.set(k, n);
    const hasChildren = list.some((c) => c.parent !== undefined && list[c.parent] === s);
    if (s.toc) return false;
    return !(counts.get(k)! > 1 && n < counts.get(k)! && !s.text && !hasChildren);
  });
  const newIndex = new Map<number, number>();
  const result: ParsedSection[] = [];
  list.forEach((s, i) => {
    if (!keep[i]) return;
    newIndex.set(i, result.length);
    const { toc: _toc, ...clean } = s;
    result.push(clean);
  });
  for (const s of result) {
    let p = s.parent;
    while (p !== undefined && !newIndex.has(p)) p = list[p].parent;
    s.parent = p === undefined ? undefined : newIndex.get(p);
  }
  return result;
}
