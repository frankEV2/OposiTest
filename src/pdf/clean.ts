/** Limpieza de texto extraído de PDF (funciones puras, testeables). */

/** Mínimo de letras para considerar que una página tiene texto real. */
export const MIN_LETTERS_PER_PAGE = 40;

export const countLetters = (s: string) => (s.match(/\p{L}/gu) ?? []).length;

const lineKey = (l: string) => l.trim().replace(/\d+/g, '#').toLowerCase();

/**
 * Elimina cabeceras y pies de página repetidos (p. ej. "BOLETÍN OFICIAL DEL ESTADO",
 * "Página 12") que aparecen en al menos la mitad de las páginas.
 */
export function stripRepeatedLines(pages: string[]): string[] {
  if (pages.length < 3) return pages;
  // Solo se consideran las primeras y últimas líneas de cada página (zona de cabecera/pie):
  // borrar líneas repetidas del cuerpo eliminaría contenido real (p. ej. "Artículo 1" sin rúbrica).
  const EDGE = 4;
  const edges = (p: string) => {
    const lines = p.split('\n').map((l, i) => ({ l, i })).filter((x) => x.l.trim());
    return [...lines.slice(0, EDGE), ...lines.slice(-EDGE)];
  };
  const freq = new Map<string, number>();
  for (const p of pages) {
    for (const k of new Set(edges(p).map((x) => lineKey(x.l)))) freq.set(k, (freq.get(k) ?? 0) + 1);
  }
  const threshold = Math.max(3, Math.ceil(pages.length * 0.5));
  const drop = new Set([...freq].filter(([k, n]) => n >= threshold && k.length <= 120 && !STRUCTURE.test(k)).map(([k]) => k));
  return pages.map((p) => {
    const remove = new Set(edges(p).filter((x) => drop.has(lineKey(x.l))).map((x) => x.i));
    return p.split('\n').filter((_, i) => !remove.has(i)).join('\n');
  });
}

/** Encabezados estructurales que nunca deben tratarse como cabecera/pie repetido. */
const STRUCTURE = /^(art[íi]culo|t[íi]tulo|cap[íi]tulo|secci[óo]n|disposici[óo]n|anexo|libro)\b/i;

/** Une palabras partidas con guion a final de línea y normaliza espacios. */
export function normalizeText(s: string): string {
  return s
    .replace(/\u00ad/g, '')
    .replace(/[ \t\u00a0]+/g, ' ')
    .replace(/(\p{Ll})-\n(\p{Ll})/gu, '$1$2')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Une líneas que son continuación de un párrafo (la siguiente empieza en minúscula
 * o la anterior no termina en puntuación fuerte).
 */
export function joinParagraphs(s: string): string {
  const lines = s.split('\n');
  const out: string[] = [];
  for (const line of lines) {
    const prev = out[out.length - 1];
    const startsBlock = /^(\d+\.|[a-zñ]\)|\d+\.ª|[–—•-] |[IVXLC]+\.)\s/.test(line);
    if (prev !== undefined && prev !== '' && line !== '' && !startsBlock &&
        (/^\p{Ll}/u.test(line) || !/[.:;]$/.test(prev))) {
      out[out.length - 1] = `${prev} ${line}`;
    } else {
      out.push(line);
    }
  }
  return out.join('\n');
}

/** Normaliza para búsquedas: minúsculas y sin tildes. */
export const fold = (s: string) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();

export interface ExtractionQuality {
  status: 'ok' | 'partial' | 'scanned';
  warnings: string[];
}

export function assessQuality(pages: string[]): ExtractionQuality {
  const empty = pages.map((p, i) => (countLetters(p) < MIN_LETTERS_PER_PAGE ? i + 1 : 0)).filter(Boolean);
  if (pages.length === 0 || empty.length >= pages.length * 0.8) {
    return {
      status: 'scanned',
      warnings: ['El PDF parece escaneado (imagen sin capa de texto). No se puede extraer su contenido; ' +
        'aplícale OCR con otra herramienta y vuelve a importarlo.'],
    };
  }
  if (empty.length > 0) {
    const list = empty.length > 15 ? `${empty.slice(0, 15).join(', ')}…` : empty.join(', ');
    return {
      status: 'partial',
      warnings: [`${empty.length} página(s) sin texto extraíble (${list}). Pueden ser portadas, imágenes o páginas escaneadas.`],
    };
  }
  return { status: 'ok', warnings: [] };
}
