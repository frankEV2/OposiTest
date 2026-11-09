import { fold } from '../pdf/clean';

export { fold };

/** Normalización para comparar opciones: sin tildes, sin puntuación final ni espacios dobles. */
export const norm = (s: string) =>
  fold(s).replace(/[«»"“”]/g, '').replace(/[\s.;,:]+$/g, '').replace(/\s+/g, ' ').trim();

const ABBR = /\b(art|arts|núm|nº|apdo|apdos|sr|sra|d|dª|etc|ss|pág|vid|cfr|admón|excmo|ilmo|e)\./giu;
const DOT = '\u0000';

/** Divide un texto en frases sin cortar abreviaturas jurídicas habituales ni numeraciones "21.2". */
export function sentences(text: string): string[] {
  const protectedText = text
    .replace(ABBR, (m) => m.replace('.', DOT))
    .replace(/(\d)\.(\d)/g, `$1${DOT}$2`)
    // Numeración de apartados al inicio de línea: "1. El plazo…"
    .replace(/(^|\n)(\d{1,2})\.(?=\s)/g, `$1$2${DOT}`);
  return protectedText
    .split(/(?<=[.;])\s+(?=[\p{Lu}¿«(\d])|\n+/u)
    .map((s) => s.split(DOT).join('.').trim())
    .filter((s) => s.length > 0);
}

/** Hash FNV-1a de 32 bits en hexadecimal (estable entre sesiones). */
export function hash(s: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

/** PRNG determinista: misma entrada → mismos distractores y orden. */
export function rng(seed: string): () => number {
  let a = parseInt(hash(seed), 16);
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Recorta un texto alrededor de una posición, en límites de palabra. */
export function windowAround(s: string, start: number, end: number, max = 320): string {
  if (s.length <= max) return s;
  const pad = Math.max(40, Math.floor((max - (end - start)) / 2));
  let a = Math.max(0, start - pad);
  let b = Math.min(s.length, end + pad);
  if (a > 0) a = s.indexOf(' ', a) + 1 || a;
  if (b < s.length) b = s.lastIndexOf(' ', b) > end ? s.lastIndexOf(' ', b) : b;
  return `${a > 0 ? '…' : ''}${s.slice(a, b)}${b < s.length ? '…' : ''}`;
}

/** "Artículo 21.2" → "art. 21.2"; "Disposición adicional primera" se mantiene. */
export function shortRef(label: string): string {
  return label.replace(/^Artículo\s+/i, 'art. ');
}

export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
