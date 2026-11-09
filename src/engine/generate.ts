/**
 * Motor local de preguntas. Funciones puras: reciben unidades de texto (artículos/apartados)
 * y devuelven borradores ya validados. Reglas:
 *  - Toda respuesta correcta es texto literal de la norma.
 *  - Los distractores proceden del propio corpus (otros plazos, órganos, definiciones,
 *    elementos de otras enumeraciones) o de conjuntos cerrados de expresiones gramaticales
 *    (conectores, verbos modales). Nunca se inventan.
 *  - Si no hay suficientes distractores reales o la pregunta resulta ambigua, se descarta.
 */
import type { Difficulty, Question, QuestionRule } from '../db/types';
import { cap, hash, norm, rng, sentences, shortRef, shuffle, windowAround } from './text';

export interface Unit {
  sectionId: number;
  documentId: number;
  /** "Artículo 21.2", "Disposición adicional primera"… */
  label: string;
  heading: string;
  text: string;
}

export type Draft = Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'temaId'>;

export interface GenerationReport {
  drafts: Draft[];
  discarded: Record<string, number>;
}

// ---------------------------------------------------------------- patrones

const UNITS = '(?:un|una|uno|dos|tres|cuatro|cinco|seis|siete|ocho|nueve)';
const TENS = '(?:treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa)';
// Compuestos primero ("setenta y dos") para no capturar solo "dos".
const NUM = `(?:\\d+|${TENS}\\s+y\\s+${UNITS}|ciento\\s+(?:veinte|ochenta)|veinti(?:uno|ún|una|dós|dos|trés|tres|cuatro|cinco|séis|seis|siete|ocho|nueve)|dieci(?:séis|seis|siete|ocho|nueve)|${TENS}|${UNITS}|diez|once|doce|trece|catorce|quince|veinte|cien)`;
const UNIT_RE = '(?:días?|mes(?:es)?|años?|horas?|semanas?)';
export const DURATION = new RegExp(`\\b${NUM}\\s+${UNIT_RE}(?:\\s+(?:hábiles|naturales))?\\b`, 'giu');

const ORGAN = '((?:\\p{Lu}[\\p{L}]+)(?:\\s+(?:de|del|de la|de las|de los|y|para|\\p{Lu}[\\p{L}]+))*\\s*(?:\\p{Lu}[\\p{L}]+))';
export const COMPETENCE = new RegExp(
  `(?:[Cc]orresponder[áa]n?|[Cc]orresponden?|[Cc]ompete|[Cc]ompeter[áa]|[Ss]er[áa]n? competentes?|[Ee]s competente|[Ss]on competentes)\\s+(?:a\\s+la|a\\s+los|a\\s+las|al|a|el|la|los|las)\\s+${ORGAN}`,
  'gu',
);

const QUANTITY = /\b(?:mayoría\s+(?:absoluta|simple|cualificada|de\s+(?:dos\s+tercios|tres\s+quintos|tres\s+cuartos))|\d+(?:,\d+)?\s+por\s+(?:ciento|100)|(?:dos|tres|cuatro)\s+(?:tercios|quintos|cuartos))\b/giu;

/** Conectores intercambiables gramaticalmente (todos introducen subordinada en subjuntivo). */
const EXCEPTION_SAME = ['salvo que', 'a no ser que', 'excepto que', 'excepto cuando', 'salvo cuando'];
const EXCEPTION_OTHER = ['siempre que', 'aun cuando', 'sin que', 'en tanto que', 'una vez que'];

const MODAL_SG = ['deberá', 'podrá', 'no podrá', 'no deberá'];
const MODAL_PL = ['deberán', 'podrán', 'no podrán', 'no deberán'];

const DEF_LINE = /^[a-zñ]\)\s+([^:]{2,90}):\s+(.{15,})$/u;
const DEF_SENT = /se\s+entender[áa]\s+por\s+([^,:]{2,90})[,:]?\s+(?:el|la|los|las|aquel|aquella|aquellos|aquellas|todo|toda|cualquier)\b(.{15,})$/iu;
const ENUM_ITEM = /^([a-zñ]|\d{1,2}\.ª|\d{1,2}º)\)?\s+(.{4,})$/u;

// ---------------------------------------------------------------- corpus

export interface Pools {
  durations: Map<string, Set<string>>; // por unidad de tiempo normalizada
  organs: Set<string>;
  quantities: Set<string>;
  definitions: { term: string; def: string; sectionId: number }[];
  enumItems: { item: string; sectionId: number }[];
}

const timeUnit = (d: string) => {
  const m = norm(d).match(/(dia|mes|ano|hora|semana)/);
  return m ? m[1] : 'otro';
};

// Quita la puntuación final, el "y"/"o" que enlaza el último elemento y las comillas de cierre de textos citados.
const cleanItem = (s: string) => s.replace(/[»"”]+\s*$/u, '').replace(/[;,.]?\s*(?:y|o)?\s*$/u, '').replace(/[;.]$/, '').trim();

/** Nombre corto de la norma para los enunciados: "Ley Orgánica 1/2004, de 28 de diciembre, de…" → "Ley Orgánica 1/2004". */
export function shortDocTitle(title: string): string {
  const t = title.trim().replace(/\.$/, '');
  if (/^(?:Ley|Real Decreto|Decreto|Orden|Reglamento|Instrucción|Resolución|Llei|Decret|Ordre)\b/u.test(t)) {
    const m = t.match(/^(.*?\d+\/\d{4})(?=[,\s]|$)/u);
    if (m) return m[1];
  }
  return t.length > 80 ? `${t.slice(0, t.lastIndexOf(' ', 80))}…` : t;
}

const firstWord = (s: string) => s.split(/\s+/)[0].toLowerCase();
/**
 * Ordena los elementos ajenos por parecido con los de la lista (misma palabra inicial y longitud
 * similar), para que los distractores no se descarten solo por su estilo.
 */
function bySimilarity(cands: string[], items: string[]): string[] {
  const starts = new Set(items.map(firstWord));
  const avg = items.reduce((a, x) => a + x.length, 0) / Math.max(1, items.length);
  const score = (c: string) => (starts.has(firstWord(c)) ? 0 : 2) + Math.abs(c.length - avg) / avg;
  return [...new Set(cands)].sort((a, b) => score(a) - score(b) || a.localeCompare(b)).slice(0, 8);
}

export interface Enumeration {
  intro: string;
  items: string[];
}

/** Detecta enumeraciones: una frase terminada en ":" seguida de ≥3 elementos a), b), c)… */
export function findEnumerations(text: string): Enumeration[] {
  const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
  const out: Enumeration[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (!lines[i].endsWith(':')) continue;
    const items: string[] = [];
    let j = i + 1;
    while (j < lines.length && ENUM_ITEM.test(lines[j])) {
      items.push(cleanItem(lines[j].match(ENUM_ITEM)![2]));
      j++;
    }
    if (items.length >= 3 && !items.some((it) => DEF_LINE.test(`a) ${it}`))) {
      const intro = sentences(lines[i]).pop() ?? lines[i];
      out.push({ intro, items: items.filter((it) => it.length <= 220) });
    }
  }
  return out.filter((e) => e.items.length >= 3);
}

export function findDefinitions(text: string): { term: string; def: string }[] {
  const out: { term: string; def: string }[] = [];
  for (const line of text.split('\n')) {
    const m = line.trim().match(DEF_LINE);
    if (m) out.push({ term: m[1].trim(), def: cleanItem(m[2]) });
  }
  for (const s of sentences(text)) {
    const m = s.match(DEF_SENT);
    if (m) {
      const def = s.slice(s.toLowerCase().indexOf(m[1].toLowerCase()) + m[1].length).replace(/^[,:]?\s*/, '');
      out.push({ term: m[1].trim(), def: cleanItem(def) });
    }
  }
  return out.filter((d) => d.def.length >= 15 && d.def.length <= 260);
}

export function buildPools(units: Unit[]): Pools {
  const p: Pools = { durations: new Map(), organs: new Set(), quantities: new Set(), definitions: [], enumItems: [] };
  for (const u of units) {
    for (const m of u.text.matchAll(DURATION)) {
      const k = timeUnit(m[0]);
      if (!p.durations.has(k)) p.durations.set(k, new Set());
      p.durations.get(k)!.add(m[0].toLowerCase());
    }
    for (const m of u.text.matchAll(COMPETENCE)) p.organs.add(m[1]);
    for (const m of u.text.matchAll(QUANTITY)) p.quantities.add(m[0].toLowerCase());
    for (const d of findDefinitions(u.text)) p.definitions.push({ ...d, sectionId: u.sectionId });
    for (const e of findEnumerations(u.text)) {
      for (const item of e.items) p.enumItems.push({ item, sectionId: u.sectionId });
    }
  }
  return p;
}

// ---------------------------------------------------------------- plantillas

interface Ctx {
  unit: Unit;
  docTitle: string;
  pools: Pools;
  rand: () => number;
}

type Result = Draft | { discard: string };

const refOf = (c: Ctx) => `${c.docTitle}, ${shortRef(c.unit.label)}`;
/** "el art. 21.2" / "la disposición adicional primera" (concordancia de género). */
export const refWithArticle = (label: string) =>
  /^disposici/i.test(label) ? `la ${label.charAt(0).toLowerCase()}${label.slice(1)}`
    : /^(anexo|pre[áa]mbulo)/i.test(label) ? `el ${label}` : `el ${shortRef(label)}`;
const intro = (c: Ctx) => `Según ${refWithArticle(c.unit.label)} de ${c.docTitle}`;

/** Elige `n` distractores distintos entre sí y de la respuesta (comparación normalizada). */
function pick(cands: Iterable<string>, correct: string, rand: () => number, n = 3, exclude: string[] = []): string[] | null {
  const seen = new Set([norm(correct), ...exclude.map(norm)]);
  const out: string[] = [];
  for (const c of shuffle([...cands], rand)) {
    const k = norm(c);
    if (!k || seen.has(k)) continue;
    seen.add(k);
    out.push(c);
    if (out.length === n) return out;
  }
  return null;
}

function assemble(c: Ctx, rule: QuestionRule, stem: string, correct: string, distractors: string[],
  explanation: string, excerpt: string, difficulty: Difficulty): Draft {
  const options = shuffle([correct, ...distractors], c.rand) as Draft['options'];
  return {
    hash: hash(`${norm(stem)}|${norm(correct)}`),
    documentId: c.unit.documentId,
    sectionId: c.unit.sectionId,
    stem, options,
    correctIndex: options.indexOf(correct) as Draft['correctIndex'],
    explanation, reference: refOf(c), sourceExcerpt: excerpt, difficulty, rule,
  };
}

/** Pregunta de completar: se oculta `answer` (en la posición `at`) dentro de la frase. */
function cloze(c: Ctx, rule: QuestionRule, sentence: string, at: number, answer: string,
  distractors: string[], difficulty: Difficulty): Result {
  const blanked = sentence.slice(0, at) + '______' + sentence.slice(at + answer.length);
  const shown = windowAround(blanked, at, at + 6);
  const fold = norm(shown);
  if (fold.includes(norm(answer)) && norm(answer).length > 3) return { discard: 'la respuesta aparece en el enunciado' };
  // Ambigüedad: si la frase con un distractor también figura literalmente en la norma, se descarta.
  const unitNorm = norm(c.unit.text);
  for (const d of distractors) {
    const filled = norm(sentence.slice(Math.max(0, at - 30), at) + d + sentence.slice(at + answer.length, at + answer.length + 30));
    if (unitNorm.includes(filled)) return { discard: 'distractor también válido en el texto' };
  }
  const stem = `${intro(c)}, complete el texto: «${shown}»`;
  const expl = `${cap(refWithArticle(c.unit.label))} dice literalmente: «${windowAround(sentence, at, at + answer.length, 420)}»`;
  return assemble(c, rule, stem, answer, distractors, expl, sentence, difficulty);
}

const lenDifficulty = (s: string): Difficulty => (s.split(/\s+/).length > 45 ? 3 : 2);

function* plazoQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    if (!/plazo|dentro de|a contar|desde/i.test(s)) continue;
    const m = [...s.matchAll(DURATION)];
    if (m.length !== 1) continue; // con varios plazos la frase es ambigua
    const ans = m[0][0];
    const pool = c.pools.durations.get(timeUnit(ans)) ?? new Set<string>();
    const all = [...c.pools.durations.values()].flatMap((x) => [...x]);
    const d = pick(pool, ans, c.rand) ?? pick(all, ans, c.rand);
    if (!d) { yield { discard: 'plazo sin suficientes alternativas en el corpus' }; continue; }
    yield cloze(c, 'plazo', s, m[0].index!, ans, d, s.length > 220 ? 2 : 1);
  }
}

function* competenciaQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    for (const m of s.matchAll(COMPETENCE)) {
      const organ = m[1];
      if (organ.split(/\s+/).length < 2) continue;
      const d = pick(c.pools.organs, organ, c.rand);
      if (!d) { yield { discard: 'órgano sin suficientes alternativas en el corpus' }; continue; }
      yield cloze(c, 'competencia', s, m.index! + m[0].length - organ.length, organ, d, lenDifficulty(s));
      break;
    }
  }
}

function* quantityQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    const m = [...s.matchAll(QUANTITY)];
    if (m.length !== 1) continue;
    const d = pick(c.pools.quantities, m[0][0], c.rand);
    if (!d) { yield { discard: 'cuantía sin suficientes alternativas en el corpus' }; continue; }
    yield cloze(c, 'concepto', s, m[0].index!, m[0][0], d, 2);
  }
}

function* exceptionQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    const low = s.toLowerCase();
    const conn = EXCEPTION_SAME.find((k) => new RegExp(`\\b${k}\\b`).test(low));
    if (!conn) continue;
    const at = low.search(new RegExp(`\\b${conn}\\b`));
    const answer = s.slice(at, at + conn.length);
    const d = pick(EXCEPTION_OTHER, answer, c.rand, 3, EXCEPTION_SAME)!;
    yield cloze(c, 'excepcion', s, at, answer, d, 3);
  }
}

function* obligationQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    const m = s.match(/(?<!\p{L})(deberán|deberá)(?!\p{L})/u);
    if (!m || /(?<!\p{L})no\s+deber/u.test(s)) continue;
    const set = m[1] === 'deberán' ? MODAL_PL : MODAL_SG;
    const d = set.filter((x) => x !== m[1]);
    yield cloze(c, 'obligacion', s, m.index!, m[1], d, 3);
  }
}

function* definitionQuestions(c: Ctx): Generator<Result> {
  for (const { term, def } of findDefinitions(c.unit.text)) {
    const others = c.pools.definitions.filter((d) => norm(d.term) !== norm(term)).map((d) => d.def);
    const d = pick(others, def, c.rand);
    if (!d) { yield { discard: 'definición sin suficientes alternativas' }; continue; }
    const stem = `${intro(c)}, ¿qué se entiende por «${term}»?`;
    yield assemble(c, 'definicion', stem, def, d,
      `${cap(refWithArticle(c.unit.label))} define «${term}» como: «${def}».`, `${term}: ${def}`, def.length > 150 ? 2 : 1);
  }
}

function* enumerationQuestions(c: Ctx): Generator<Result> {
  for (const e of findEnumerations(c.unit.text)) {
    const inList = new Set(e.items.map(norm));
    const listText = norm(c.unit.text);
    const foreign = c.pools.enumItems
      .filter((x) => x.sectionId !== c.unit.sectionId && !inList.has(norm(x.item)) && !listText.includes(norm(x.item)))
      .map((x) => x.item);
    const listing = e.items.map((it, i) => `${String.fromCharCode(97 + i)}) ${it}`).join('; ');
    const introTxt = windowAround(e.intro.replace(/^\d{1,2}\.\s+/, ''), 0, 0, 220);
    const expl = `${cap(refWithArticle(c.unit.label))} enumera: ${listing}.`;

    // Forma negativa: tres elementos de la lista y uno ajeno.
    const own = pick(e.items, '', c.rand, 3);
    const close = bySimilarity(foreign, e.items);
    const outsider = pick(close, '', c.rand, 1, e.items);
    if (own && outsider) {
      const stem = `${intro(c)} («${introTxt}»), ¿cuál de los siguientes NO figura en la enumeración?`;
      yield assemble(c, 'enumeracion', stem, outsider[0], own, `${expl} «${outsider[0]}» no aparece en ella.`,
        `${e.intro}\n${listing}`, 3);
    } else {
      yield { discard: 'enumeración sin elementos ajenos en el corpus' };
    }
    // Forma positiva: un elemento de la lista y tres ajenos.
    const correct = e.items[Math.floor(c.rand() * e.items.length)];
    const others = pick(close, correct, c.rand, 3, e.items);
    if (others) {
      const stem = `${intro(c)} («${introTxt}»), ¿cuál de los siguientes figura en la enumeración?`;
      yield assemble(c, 'enumeracion', stem, correct, others, expl, `${e.intro}\n${listing}`, 2);
    }
  }
}

// ---------------------------------------------------------------- validación

export function validateDraft(d: Pick<Draft, 'stem' | 'options' | 'correctIndex'>): string | null {
  if (d.stem.trim().length < 15) return 'enunciado demasiado corto';
  if (d.options.length !== 4 || d.options.some((o) => !o || !o.trim())) return 'faltan opciones';
  if (new Set(d.options.map(norm)).size !== 4) return 'opciones repetidas';
  if (d.correctIndex < 0 || d.correctIndex > 3) return 'respuesta correcta no válida';
  if (d.options.some((o) => o.length > 320)) return 'opción demasiado larga';
  return null;
}

const MAX_PER_UNIT = 3;
const SHARE: Partial<Record<QuestionRule, number>> = { obligacion: 0.15, excepcion: 0.1 };

/** Limita la proporción de ciertas reglas, conservando una muestra repartida por el documento. */
function capShare(drafts: Draft[], discard: (r: string) => void): Draft[] {
  const others = drafts.filter((d) => !(d.rule in SHARE)).length;
  const keep = new Set<Draft>(drafts.filter((d) => !(d.rule in SHARE)));
  for (const [rule, share] of Object.entries(SHARE) as [QuestionRule, number][]) {
    const list = drafts.filter((d) => d.rule === rule);
    // Proporción sobre el total resultante: n / (others + n) <= share.
    const max = Math.max(1, Math.floor((share * others) / (1 - share)));
    const step = list.length / Math.min(max, list.length);
    for (let i = 0; i < Math.min(max, list.length); i++) keep.add(list[Math.floor(i * step)]);
    for (let i = 0; i < list.length - Math.min(max, list.length); i++) discard('límite de preguntas de literalidad');
  }
  return drafts.filter((d) => keep.has(d));
}

/** Genera preguntas para un documento. `corpus` aporta distractores (por defecto, las propias unidades). */
export function generate(units: Unit[], fullTitle: string, corpus: Unit[] | Pools = units): GenerationReport {
  const docTitle = shortDocTitle(fullTitle);
  const pools = Array.isArray(corpus) ? buildPools(corpus) : corpus;
  const drafts: Draft[] = [];
  const discarded: Record<string, number> = {};
  const seen = new Set<string>();
  const discard = (r: string) => { discarded[r] = (discarded[r] ?? 0) + 1; };

  for (const unit of units) {
    const c: Ctx = { unit, docTitle, pools, rand: rng(`${docTitle}|${unit.label}|${unit.text.length}`) };
    const sents = sentences(unit.text).map((s) => s.replace(/^\d{1,2}\.\s+/, "")).filter((s) => s.length >= 30 && s.length <= 900);
    const gens = [
      definitionQuestions(c), plazoQuestions(c, sents), competenciaQuestions(c, sents),
      enumerationQuestions(c), quantityQuestions(c, sents), exceptionQuestions(c, sents),
      obligationQuestions(c, sents),
    ];
    let count = 0;
    for (const g of gens) {
      for (const r of g) {
        if ('discard' in r) { discard(r.discard); continue; }
        const why = validateDraft(r);
        if (why) { discard(why); continue; }
        if (seen.has(r.hash)) continue;
        // Los artículos de definiciones generan una pregunta por término.
        if (r.rule !== 'definicion' && count >= MAX_PER_UNIT) { discard('límite de preguntas por artículo'); continue; }
        seen.add(r.hash);
        drafts.push(r);
        count++;
      }
    }
  }
  // Las preguntas de pura literalidad (modal "deberá", conectores) no deben dominar el banco.
  const capped = capShare(drafts, discard);
  return { drafts: capped, discarded };
}

export const RULE_LABEL: Record<QuestionRule, string> = {
  definicion: 'Definición', plazo: 'Plazo', competencia: 'Competencia', obligacion: 'Obligación',
  excepcion: 'Excepción', enumeracion: 'Enumeración', concepto: 'Cuantía/mayoría', manual: 'Manual',
};

export { cap };
