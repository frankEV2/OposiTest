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
  /** Artículo al que pertenece un apartado: "Artículo 21". */
  article?: string;
}

export type Draft = Omit<Question, 'id' | 'createdAt' | 'updatedAt' | 'status' | 'temaId'>;

export interface GenerationReport {
  drafts: Draft[];
  discarded: Record<string, number>;
}

// ---------------------------------------------------------------- patrones

// Castellano y catalán (muchas normas se estudian en su versión catalana).
const UNITS = '(?:un|una|uno|dos|dues|tres|cuatro|quatre|cinco|cinc|seis|sis|siete|set|ocho|vuit|nueve|nou)';
const TENS = '(?:treinta|cuarenta|cincuenta|sesenta|setenta|ochenta|noventa|trenta|quaranta|cinquanta|seixanta|setanta|vuitanta|noranta)';
// Compuestos primero ("setenta y dos", "trenta-dos") para no capturar solo "dos".
const NUM = `(?:\\d+|${TENS}\\s+y\\s+${UNITS}|${TENS}-${UNITS}|vint-i-(?:u|un|una|dos|dues|tres|quatre|cinc|sis|set|vuit|nou)|ciento\\s+(?:veinte|ochenta)|veinti(?:uno|ún|una|dós|dos|trés|tres|cuatro|cinco|séis|seis|siete|ocho|nueve)|dieci(?:séis|seis|siete|ocho|nueve)|${TENS}|${UNITS}|diez|deu|once|onze|doce|dotze|trece|tretze|catorce|catorze|quince|quinze|setze|disset|divuit|dinou|veinte|vint|cien|cent)`;
const UNIT_RE = '(?:días?|dies|dia|mes(?:es|os)?|años?|anys?|horas?|hores|semanas?|setmanes|setmana)';
export const DURATION = new RegExp(`(?<!\\p{L})${NUM}\\s+${UNIT_RE}(?:\\s+(?:hábiles|naturales|hàbils|naturals))?(?!\\p{L})`, 'giu');

const AP = "['’]";
const ORGAN = `((?:\\p{Lu}[\\p{L}]+)(?:\\s+(?:de|del|de la|de las|de los|dels|de les|y|i|para|per a|\\p{Lu}[\\p{L}]+)|\\s+d${AP}(?=\\p{Lu})|\\s+de l${AP}(?=\\p{Lu}))*\\s*(?:\\p{Lu}[\\p{L}]+))`;
export const COMPETENCE = new RegExp(
  `(?:[Cc]orresponder[áa]n?|[Cc]orresponden?|[Cc]ompete|[Cc]ompeter[áa]|[Ss]er[áa]n? competentes?|[Ee]s competente|[Ss]on competentes|[Cc]orrespon(?:en)?|[Cc]orrespondr[àa]n?|[ÉéEe]s competent|[Ss]ón competents|[Ss]erà competent|[Ss]eran competents)\\s+(?:a\\s+la\\s+|a\\s+los\\s+|a\\s+las\\s+|a\\s+les\\s+|a\\s+l${AP}|als\\s+|al\\s+|a\\s+|el\\s+|la\\s+|los\\s+|las\\s+|els\\s+|les\\s+|l${AP})${ORGAN}`,
  'gu',
);

const QUANTITY = /(?<!\p{L})(?:mayoría\s+(?:absoluta|simple|cualificada|de\s+(?:dos\s+tercios|tres\s+quintos|tres\s+cuartos))|majoria\s+(?:absoluta|simple|qualificada|de\s+(?:dos\s+terços|tres\s+cinquenes\s+parts|tres\s+quartes\s+parts))|\d+(?:,\d+)?\s+(?:por|per)\s+(?:ciento|cent|100)|(?:dos|tres|cuatro)\s+(?:tercios|quintos|cuartos)|(?:dos|tres)\s+terços)(?!\p{L})/giu;

/** Conectores intercambiables gramaticalmente (todos introducen subordinada en subjuntivo). */
const EXCEPTION_SAME = ['salvo que', 'a no ser que', 'excepto que', 'excepto cuando', 'salvo cuando'];
const EXCEPTION_OTHER = ['siempre que', 'aun cuando', 'sin que', 'en tanto que', 'una vez que'];
const EXCEPTION_SAME_CA = ['llevat que', 'tret que', 'excepte que', 'excepte quan', 'llevat de quan', 'tret de quan'];
const EXCEPTION_OTHER_CA = ['sempre que', 'encara que', 'sense que', 'mentre que', 'un cop que'];

const MODAL_SG = ['deberá', 'podrá', 'no podrá', 'no deberá'];
const MODAL_PL = ['deberán', 'podrán', 'no podrán', 'no deberán'];
const MODAL_SG_CA = ['ha de', 'pot', 'no pot', 'no ha de'];
const MODAL_PL_CA = ['han de', 'poden', 'no poden', 'no han de'];

const DEF_LINE = /^[a-zñ]\)\s+([^:]{2,90}):\s+(.{15,})$/u;
const DEF_SENT = /(?:se\s+entender[áa]\s+por|s['’]entén\s+per)\s+([^,:]{2,90})[,:]?\s+(?:el|la|los|las|els|les|l['’]|aquel|aquella|aquellos|aquellas|aquell|aquells|aquelles|todo|toda|tot|tota|cualquier|qualsevol)(?!\p{L})(.{15,})$/iu;

const CATALAN_RE = /(?<!\p{L})(?:Article|aquesta|aquest|els|dels|amb|perquè|també|han de|ha de)(?!\p{L})/gu;
const SPANISH_RE = /(?<!\p{L})(?:Artículo|esta|este|los|del|con|porque|también|deberá|podrá)(?!\p{L})/gu;
/** Idioma predominante de un texto (para elegir conectores y no mezclar distractores). */
export function langOf(text: string): 'ca' | 'es' {
  const t = text.slice(0, 20000);
  return (t.match(CATALAN_RE)?.length ?? 0) > (t.match(SPANISH_RE)?.length ?? 0) ? 'ca' : 'es';
}
const ENUM_ITEM = /^([a-zñ]|\d{1,2}\.ª|\d{1,2}º|[-•])\)?\s+(.{4,})$/u;

// ---------------------------------------------------------------- corpus

export interface Pools {
  durations: Map<string, Set<string>>; // por unidad de tiempo normalizada
  organs: Set<string>;
  quantities: Set<string>;
  definitions: { term: string; def: string; sectionId: number }[];
  enumItems: { item: string; sectionId: number; documentId: number }[];
  /** Rúbricas de artículo por documento (pregunta de rúbrica). */
  headings: Map<number, Map<string, string>>;
  /** Frases literales de cada unidad (pregunta de atribución). */
  statements: { s: string; sectionId: number; article: string; documentId: number }[];
  /** Todo el texto normalizado: una variante "falsa" que aparezca aquí no se usa. */
  textNorm: string;
}

/** Opción compuesta independiente de la posición (las opciones se barajan). */
const ALL_OK = 'Todas las demás opciones son correctas';
const MAJORITIES = ['mayoría absoluta', 'mayoría simple', 'mayoría de dos tercios', 'mayoría de tres quintos'];
/** Plazos habituales por unidad, para completar distractores de la misma unidad. */
const COMMON_DUR: Record<string, string[]> = {
  dia: ['diez días', 'quince días', 'veinte días', 'treinta días', 'cinco días', 'tres días'],
  mes: ['un mes', 'dos meses', 'tres meses', 'seis meses'],
  ano: ['un año', 'dos años', 'cuatro años', 'cinco años'],
  hora: ['veinticuatro horas', 'cuarenta y ocho horas', 'setenta y dos horas'],
  semana: ['una semana', 'dos semanas', 'cuatro semanas'],
};

/** Sube cuando cambia el estilo de las preguntas: el temario integrado se regenera. */
export const ENGINE_VERSION = 3;

/** Frases aptas como afirmación completa: ni muy cortas ni muy largas y sin remisiones vacías. */
function statementsOf(u: Unit): string[] {
  return sentences(u.text)
    .map((s) => s.replace(/^\d{1,2}\.\s+/, '').replace(/^[a-zñ]\)\s+/u, ''))
    .filter((s) => s.length >= 50 && s.length <= 300 && /[.;]$/.test(s) && !/[:]$/.test(s) && /\p{Lu}/u.test(s[0])
      && !/(?<!\p{L})(?:Art[ií]culo|Article)\s+\d+\s+\p{L}/u.test(s));
}

const TIME_UNITS: [RegExp, string][] = [[/dia|dies/, 'dia'], [/mes/, 'mes'], [/ano|any/, 'ano'], [/hor/, 'hora'], [/seman|setman/, 'semana']];
const timeUnit = (d: string) => TIME_UNITS.find(([re]) => re.test(norm(d)))?.[1] ?? 'otro';

// Quita la puntuación final, el "y"/"o" que enlaza el último elemento y las comillas de cierre de textos citados.
const cleanItem = (s: string) => s.replace(/[»"”]+\s*$/u, '').replace(/[;,.]?(?:\s+(?:y|o|i))?\s*$/u, '').replace(/[;.]$/, '').trim();

/** Nombre corto de la norma para los enunciados: "Ley Orgánica 1/2004, de 28 de diciembre, de…" → "Ley Orgánica 1/2004". */
export function shortDocTitle(title: string): string {
  const t = title.trim().replace(/\.$/, '');
  if (/^(?:Ley|Real Decreto|Decreto|Orden|Reglamento|Instrucción|Resolución|Llei|Decret|Ordre|Reial decret)\b/iu.test(t)) {
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
  const p: Pools = { durations: new Map(), organs: new Set(), quantities: new Set(), definitions: [], enumItems: [], headings: new Map(), statements: [], textNorm: "" };
  for (const u of units) {
    const art = u.article ?? u.label;
    for (const s of statementsOf(u)) p.statements.push({ s, sectionId: u.sectionId, article: art, documentId: u.documentId });
    const head = cleanItem(u.heading ?? '');
    if (head.length >= 3 && /^(Art[ií]culo|Article)\s/u.test(art)) {
      if (!p.headings.has(u.documentId)) p.headings.set(u.documentId, new Map());
      p.headings.get(u.documentId)!.set(art, head);
    }
    for (const m of u.text.matchAll(DURATION)) {
      const k = timeUnit(m[0]);
      if (!p.durations.has(k)) p.durations.set(k, new Set());
      p.durations.get(k)!.add(m[0].toLowerCase());
    }
    for (const m of u.text.matchAll(COMPETENCE)) p.organs.add(m[1]);
    for (const m of u.text.matchAll(QUANTITY)) p.quantities.add(m[0].toLowerCase());
    for (const d of findDefinitions(u.text)) p.definitions.push({ ...d, sectionId: u.sectionId });
    for (const e of findEnumerations(u.text)) {
      for (const item of e.items) p.enumItems.push({ item, sectionId: u.sectionId, documentId: u.documentId });
    }
  }
  p.textNorm = units.map((u) => norm(u.text)).join(" | ");
  return p;
}

// ---------------------------------------------------------------- plantillas

interface Ctx {
  lang: 'ca' | 'es';
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
/** Unidad de una norma (artículo, disposición, anexo) o apartado de unos apuntes/temario. */
const isLegal = (label: string) => /^(Art[ií]culo|Article|Disposici|Anexo|ANEXO|Pre[áa]mbulo|Annex)/u.test(label);
const intro = (c: Ctx) => isLegal(c.unit.label)
  ? `Según ${refWithArticle(c.unit.label)} de ${c.docTitle}`
  : `En relación con «${c.unit.label}» (${c.docTitle})`;

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
  const expl = `${cap(refWithArticle(c.unit.label))} dice literalmente: «${windowAround(sentence, at, at + answer.length, 420)}»`;
  // Estilo de examen oficial: el enunciado es el inicio de la frase y las opciones, su continuación
  // completa, que solo se diferencia en el dato preguntado (plazo, órgano, cifra, verbo…).
  const before = sentence.slice(0, at).trimEnd();
  if (before.length >= 10 && !/[«(]$/.test(before)) {
    const lead = before.length <= 260 ? before : `…${before.slice(before.indexOf(' ', before.length - 250) + 1)}`;
    let tail = sentence.slice(at + answer.length).replace(/[.;:]$/, '');
    if (tail.length > 110) tail = `${tail.slice(0, tail.lastIndexOf(' ', 110))}…`;
    const opt = (x: string) => `${x}${tail}`;
    const stem = `${intro(c)}, ${lead.charAt(0).toLowerCase()}${lead.slice(1)}…`;
    return assemble(c, rule, stem, opt(answer), distractors.map(opt), expl, sentence, difficulty);
  }
  const stem = `${intro(c)}, complete el texto: «${shown}»`;
  return assemble(c, rule, stem, answer, distractors, expl, sentence, difficulty);
}

// ---------------------------------------------------------------- variantes falsas plausibles

/** Cambios mínimos que invierten o alteran el sentido (como los distractores de los exámenes oficiales). */
const SWAPS: [string, string][] = [
  ['no podrán', 'podrán'], ['no podrá', 'podrá'], ['podrán', 'no podrán'], ['podrá', 'no podrá'],
  ['deberán', 'podrán'], ['deberá', 'podrá'], ['en ningún caso', 'en todo caso'], ['en todo caso', 'en ningún caso'],
  ['máximo', 'mínimo'], ['mínimo', 'máximo'], ['máxima', 'mínima'], ['mínima', 'máxima'],
  ['superior', 'inferior'], ['inferior', 'superior'], ['mayor', 'menor'], ['menor', 'mayor'],
  ['anterior', 'posterior'], ['posterior', 'anterior'], ['salvo que', 'siempre que'], ['siempre que', 'salvo que'],
  ['obligatoria', 'voluntaria'], ['obligatorio', 'voluntario'], ['expresa', 'tácita'], ['expreso', 'tácito'],
  ['únicamente', 'preferentemente'], ['exclusivamente', 'preferentemente'], ['directa', 'indirecta'],
  ['del Congreso de los Diputados', 'del Senado'], ['del Senado', 'del Congreso de los Diputados'],
  ['el Congreso de los Diputados', 'el Senado'], ['el Senado', 'el Congreso de los Diputados'],
  ['a las Cortes Generales', 'al Congreso de los Diputados'], ['de las Cortes Generales', 'del Congreso de los Diputados'],
  ['por las Cortes Generales', 'por el Congreso de los Diputados'], ['absoluta', 'simple'], ['simple', 'absoluta'],
  ['hábiles', 'naturales'], ['naturales', 'hábiles'], ['gratuita', 'onerosa'], ['prohibida', 'permitida'],
];
const swapRe = new Map(SWAPS.map(([a]) => [a, new RegExp(`(?<!\\p{L})${a}(?!\\p{L})`, 'u')]));

/** Variantes falsas de una frase: cada una cambia un solo dato y no aparece en ningún texto del temario. */
export function mutations(s: string, c: Pick<Ctx, 'pools' | 'rand'>): string[] {
  const out = new Set<string>();
  for (const [a, b] of SWAPS) {
    const m = swapRe.get(a)!.exec(s);
    if (m) out.add(s.slice(0, m.index) + b + s.slice(m.index + a.length));
  }
  const durs = [...s.matchAll(DURATION)];
  if (durs.length === 1) {
    const d = durs[0];
    const alt = pick(c.pools.durations.get(timeUnit(d[0])) ?? [], d[0], c.rand, 2) ?? [];
    for (const x of alt) out.add(s.slice(0, d.index!) + x + s.slice(d.index! + d[0].length));
  }
  for (const m of s.matchAll(COMPETENCE)) {
    const at = m.index! + m[0].length - m[1].length;
    for (const o of pick(c.pools.organs, m[1], c.rand, 2) ?? []) out.add(s.slice(0, at) + o + s.slice(at + m[1].length));
    break;
  }
  // Cifras sueltas (edades, porcentajes, números de artículo): ±1 o ±2, salvo años y referencias "N/AAAA".
  // Solo cifras con magnitud (edades, porcentajes, miembros…), no números de artículo ni direcciones.
  const num = [...s.matchAll(/(?<![\d/.,])(\d{1,3})(?=\s*(?:%|por\s+(?:ciento|100)|años|días|meses|horas|semanas|miembros|personas|trabajadores|vocales|representantes|votos))/gu)].find((x) => +x[1] > 1);
  if (num) {
    const n = +num[1];
    for (const k of [n + 1, n - 1, n + 2]) if (k > 0) out.add(s.slice(0, num.index!) + k + s.slice(num.index! + num[1].length));
  }
  return shuffle([...out], c.rand).filter((v) => !c.pools.textNorm.includes(norm(v)));
}

/**
 * «Señale la afirmación correcta / INCORRECTA» sobre el artículo: una frase literal frente a variantes
 * con un dato cambiado, o tres frases literales frente a una alterada.
 */
function* afirmacionQuestions(c: Ctx): Generator<Result> {
  const sts = shuffle(statementsOf(c.unit), c.rand);
  if (!sts.length) return;
  const ref = refWithArticle(c.unit.label);
  const head = `${intro(c)}, señale la afirmación`;
  const withMut = sts.map((s) => ({ s, m: mutations(s, c) })).filter((x) => x.m.length);
  if (!withMut.length) return;
  const negative = sts.length >= 4 && c.rand() < 0.5;
  if (negative) {
    const { s, m } = withMut[0];
    const others = sts.filter((x) => x !== s).slice(0, 3);
    yield assemble(c, 'afirmacion', `${head} INCORRECTA:`, m[0], others,
      `Es incorrecta: ${ref} dice «${s}». Las demás reproducen literalmente el artículo.`, s, 3);
    return;
  }
  const { s, m } = withMut[0];
  const fill = [...m, ...withMut.slice(1).flatMap((x) => x.m)];
  const d = pick(fill, s, c.rand);
  if (!d) { yield { discard: 'afirmación sin suficientes variantes' }; return; }
  yield assemble(c, 'afirmacion', `${head} correcta:`, s, d,
    `${cap(ref)} dice literalmente: «${s}». Las demás opciones alteran algún dato del texto.`, s, 3);
}

const lenDifficulty = (s: string): Difficulty => (s.split(/\s+/).length > 45 ? 3 : 2);

function* plazoQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    if (!/plazo|dentro de|a contar|desde|termini|dins de|a comptar|des de|des del/i.test(s)) continue;
    const m = [...s.matchAll(DURATION)];
    if (m.length !== 1) continue; // con varios plazos la frase es ambigua
    const ans = m[0][0];
    // Alternativas de la misma unidad (días con días…): primero del temario y, si faltan, plazos habituales.
    const pool = [...(c.pools.durations.get(timeUnit(ans)) ?? []), ...(COMMON_DUR[timeUnit(ans)] ?? [])];
    const all = [...c.pools.durations.values()].flatMap((x) => [...x]);
    const d = pick(pool.filter((x) => !norm(s).includes(norm(x))), ans, c.rand) ?? pick(all, ans, c.rand);
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
    const q = m[0][0].toLowerCase();
    // Mayorías con mayorías, porcentajes con porcentajes.
    const same = /^(mayor|major)/.test(q) ? [...MAJORITIES, ...[...c.pools.quantities].filter((x) => /^(mayor|major)/.test(x))]
      : [...c.pools.quantities].filter((x) => !/^(mayor|major)/.test(x));
    const d = pick(same, m[0][0], c.rand);
    if (!d) { yield { discard: 'cuantía sin suficientes alternativas en el corpus' }; continue; }
    yield cloze(c, 'concepto', s, m[0].index!, m[0][0], d, 2);
  }
}

function* exceptionQuestions(c: Ctx, sents: string[]): Generator<Result> {
  const [same, other] = c.lang === 'ca' ? [EXCEPTION_SAME_CA, EXCEPTION_OTHER_CA] : [EXCEPTION_SAME, EXCEPTION_OTHER];
  for (const s of sents) {
    const low = s.toLowerCase();
    const conn = same.find((k) => new RegExp(`(?<!\\p{L})${k}(?!\\p{L})`, 'u').test(low));
    if (!conn) continue;
    const at = low.search(new RegExp(`(?<!\\p{L})${conn}(?!\\p{L})`, 'u'));
    const answer = s.slice(at, at + conn.length);
    const d = pick(other, answer, c.rand, 3, same)!;
    yield cloze(c, 'excepcion', s, at, answer, d, 3);
  }
}

function* obligationQuestions(c: Ctx, sents: string[]): Generator<Result> {
  for (const s of sents) {
    const ca = c.lang === 'ca';
    const m = ca ? s.match(/(?<!\p{L})(han de|ha de)(?!\p{L})/u) : s.match(/(?<!\p{L})(deberán|deberá)(?!\p{L})/u);
    if (!m || (ca ? /(?<!\p{L})no\s+han?\s+de(?!\p{L})/u : /(?<!\p{L})no\s+deber/u).test(s)) continue;
    const set = ca ? (m[1] === 'han de' ? MODAL_PL_CA : MODAL_SG_CA) : (m[1] === 'deberán' ? MODAL_PL : MODAL_SG);
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
    const all = c.pools.enumItems
      .filter((x) => x.sectionId !== c.unit.sectionId && !inList.has(norm(x.item)) && !listText.includes(norm(x.item)));
    // Elementos ajenos de la misma norma (más plausibles); los de otras normas solo si no bastan.
    const sameDoc = all.filter((x) => x.documentId === c.unit.documentId).map((x) => x.item);
    const foreign = sameDoc.length >= 3 ? sameDoc : all.map((x) => x.item);
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
    // Forma positiva, al estilo de los exámenes oficiales, con «Todas las demás opciones son correctas»
    // unas veces como respuesta verdadera (tres elementos de la lista) y otras como falsa (uno solo).
    const stemPos = `${intro(c)} («${introTxt}»), ¿cuál de las siguientes respuestas es correcta?`;
    const three = pick(e.items, '', c.rand, 3);
    if (three && e.items.length >= 3 && c.rand() < 0.5) {
      yield assemble(c, 'enumeracion', stemPos, ALL_OK, three, `${expl} Los tres elementos figuran en ella.`, `${e.intro}\n${listing}`, 3);
    } else {
      const correct = e.items[Math.floor(c.rand() * e.items.length)];
      const others = pick(close, correct, c.rand, 2, e.items);
      if (others) yield assemble(c, 'enumeracion', stemPos, correct, [...others, ALL_OK], expl, `${e.intro}\n${listing}`, 3);
    }
  }
}

/** Rúbrica del artículo: cubre todos los artículos con título, aunque no tengan otras expresiones. */
function* rubricaQuestions(c: Ctx, done: Set<string>): Generator<Result> {
  const art = c.unit.article ?? c.unit.label;
  const heads = c.pools.headings.get(c.unit.documentId);
  const own = heads?.get(art);
  if (!own || done.has(art)) return;
  done.add(art);
  let others = [...heads!.entries()].filter(([a, h]) => a !== art && norm(h) !== norm(own)).map(([, h]) => h);
  // Documento con pocos artículos: rúbricas de las demás normas del temario (mismo idioma).
  if (others.length < 3) {
    others = others.concat([...c.pools.headings].filter(([d]) => d !== c.unit.documentId)
      .flatMap(([, m]) => [...m.values()]).filter((h) => norm(h) !== norm(own)));
  }
  const d = pick(bySimilarity(others, [own]), own, c.rand) ?? pick(others, own, c.rand);
  if (!d) { yield { discard: 'rúbrica sin suficientes alternativas' }; return; }
  const ref = shortRef(art);
  const stem = `En ${c.docTitle}, ¿cuál es la rúbrica (título) del ${ref}?`;
  yield {
    ...assemble(c, 'rubrica', stem, own, d, `El ${ref} de ${c.docTitle} lleva por título «${own}».`, `${art}. ${own}`, 2),
    reference: `${c.docTitle}, ${ref}`,
  };
}

/**
 * Atribución: una frase literal del artículo frente a tres frases literales de otros artículos.
 * Funciona con cualquier redacción, así que cubre todo el contenido aunque no haya plazos, órganos, etc.
 */
function* atribucionQuestions(c: Ctx): Generator<Result> {
  const own = statementsOf(c.unit);
  if (!own.length) return;
  const art = c.unit.article ?? c.unit.label;
  const correct = own[Math.floor(c.rand() * own.length)];
  const unitNorm = norm(c.unit.text);
  const cands = c.pools.statements
    .filter((x) => x.article !== art || x.documentId !== c.unit.documentId)
    .filter((x) => !unitNorm.includes(norm(x.s)));
  // Preferencia: mismo documento y longitud parecida (que no se distinga por el estilo).
  const score = (x: typeof cands[number]) =>
    (x.documentId === c.unit.documentId ? 0 : 1) + Math.abs(x.s.length - correct.length) / correct.length;
  const close = [...cands].sort((a, b) => score(a) - score(b)).slice(0, 12).map((x) => x.s);
  const d = pick(close, correct, c.rand);
  if (!d) { yield { discard: 'atribución sin suficientes frases de otros artículos' }; return; }
  const ref = isLegal(c.unit.label) ? shortRef(c.unit.label) : `apartado «${c.unit.label}»`;
  const stem = `¿Cuál de los siguientes textos corresponde al ${ref} de ${c.docTitle}?`;
  yield assemble(c, 'atribucion', stem, correct, d,
    `El ${ref} de ${c.docTitle} dice literalmente: «${correct}». Las demás opciones pertenecen a otros artículos del temario.`,
    correct, lenDifficulty(correct) === 3 ? 3 : 2);
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
  const rubricas = new Set<string>();
  const lang = langOf(units.map((u) => u.text).join('\n'));
  const discard = (r: string) => { discarded[r] = (discarded[r] ?? 0) + 1; };

  for (const unit of units) {
    const c: Ctx = { lang, unit, docTitle, pools, rand: rng(`${docTitle}|${unit.label}|${unit.text.length}`) };
    const sents = sentences(unit.text).map((s) => s.replace(/^\d{1,2}\.\s+/, "")).filter((s) => s.length >= 30 && s.length <= 900);
    const gens = [
      definitionQuestions(c), afirmacionQuestions(c), plazoQuestions(c, sents), competenciaQuestions(c, sents),
      enumerationQuestions(c), quantityQuestions(c, sents), exceptionQuestions(c, sents),
      obligationQuestions(c, sents), rubricaQuestions(c, rubricas), atribucionQuestions(c),
    ];
    let count = 0;
    for (const g of gens) {
      for (const r of g) {
        if ('discard' in r) { discard(r.discard); continue; }
        const why = validateDraft(r);
        if (why) { discard(why); continue; }
        if (seen.has(r.hash)) continue;
        // Los artículos de definiciones generan una pregunta por término.
        // La rúbrica no cuenta para el límite: asegura al menos una pregunta por artículo.
        // Rúbrica y atribución son más sencillas: solo se usan si el artículo no ha dado otra pregunta.
        if ((r.rule === 'rubrica' || r.rule === 'atribucion') && count > 0) continue;
        if (r.rule !== 'definicion' && r.rule !== 'rubrica' && r.rule !== 'atribucion' && count >= MAX_PER_UNIT) { discard('límite de preguntas por artículo'); continue; }
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
  excepcion: 'Excepción', enumeracion: 'Enumeración', concepto: 'Cuantía/mayoría', rubrica: 'Rúbrica', atribucion: 'Texto del artículo', afirmacion: 'Afirmación correcta/incorrecta', manual: 'Manual',
};

export { cap };
