// Descarga del BOE los textos consolidados del temario, extrae SOLO los artículos exigidos (literales, sin resumir),
// verifica que no falte ninguno y los guarda como Markdown en public/temario/ para la app.
//   node scripts/boe/build.mjs            → usa la caché (scripts/boe/cache/) y solo descarga lo que falta
//   node scripts/boe/build.mjs --refresh  → vuelve a descargar (p. ej. tras una reforma)
// Fuentes: API de datos abiertos del BOE (legislación consolidada) y, para normas no consolidadas
// (convenios), el XML del Diario Oficial.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, '..', '..');
const spec = JSON.parse(readFileSync(join(here, 'temario.json'), 'utf8'));
const cacheDir = join(here, 'cache');
const refresh = process.argv.includes('--refresh');
mkdirSync(cacheDir, { recursive: true });

async function fetchXml(n) {
  const f = join(cacheDir, `${n.id}.xml`);
  if (existsSync(f) && !refresh) return readFileSync(f, 'utf8');
  const url = n.diario
    ? `https://www.boe.es/diario_boe/xml.php?id=${n.id}`
    : `https://www.boe.es/datosabiertos/api/legislacion-consolidada/id/${n.id}/texto`;
  const r = await fetch(url, { headers: { Accept: 'application/xml' } });
  if (!r.ok) throw new Error(`${n.id}: HTTP ${r.status}`);
  const xml = await r.text();
  writeFileSync(f, xml);
  console.log(`  descargado ${n.id} (${Math.round(xml.length / 1024)} KB)`);
  return xml;
}

const decode = (s) => s
  .replace(/<[^>]+>/g, '')
  .replace(/&nbsp;|&#160;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
  .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&')
  .replace(/\s+/g, ' ').trim();

/** Párrafos {cls, text} en orden. En el consolidado se toma la última versión (vigente) de cada bloque. */
function paragraphs(xml, diario) {
  let body = xml;
  if (!diario) {
    body = [...xml.matchAll(/<bloque\b[^>]*>([\s\S]*?)<\/bloque>/g)].map((b) => {
      const vs = [...b[1].matchAll(/<version\b[^>]*>([\s\S]*?)<\/version>/g)];
      return vs.length ? vs[vs.length - 1][1] : '';
    }).join('\n');
  } else {
    body = (xml.match(/<texto>([\s\S]*)<\/texto>/) ?? [, xml])[1];
  }
  body = body.replace(/<blockquote\b[\s\S]*?<\/blockquote>/g, ''); // notas de modificación
  return [...body.matchAll(/<p\b[^>]*class="([^"]+)"[^>]*>([\s\S]*?)<\/p>/g)]
    .map((m) => ({ cls: m[1], text: decode(m[2]) }))
    .filter((p) => p.text && !/^nota_pie|^firma|^cabeza_tabla|^cuerpo_tabla/.test(p.cls));
}

const LEVEL = { libro: 0, titulo: 1, capitulo: 2, seccion: 3 };
const fold = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().replace(/\s+/g, ' ').trim();
const ORD = { PRIMERO: 1, SEGUNDO: 2, TERCERO: 3, CUARTO: 4, QUINTO: 5, SEXTO: 6, SEPTIMO: 7, OCTAVO: 8, NOVENO: 9, DECIMO: 10, UNICO: 1 };

/** Convierte párrafos en elementos: cabeceras (con nivel) y artículos (con su texto). */
function elements(ps) {
  const out = [];
  for (const p of ps) {
    const base = p.cls.replace(/_(num|tit)$/, '');
    if (base in LEVEL) {
      const prev = out[out.length - 1];
      if (p.cls.endsWith('_tit') && prev?.kind === 'head' && prev.level === LEVEL[base] && !prev.title) prev.title = p.text;
      else out.push({ kind: 'head', level: LEVEL[base], label: p.text, title: '' });
    } else if (p.cls === 'articulo') {
      const m = fold(p.text).match(/^ARTICULO\s+(\d+(?:\s+(?:BIS|TER|QUATER))?|[A-Z]+)/);
      const num = m ? (ORD[m[1]] ? String(ORD[m[1]]) : m[1].toLowerCase()) : '?';
      out.push({ kind: 'art', num, label: p.text, body: [] });
    } else {
      const last = out[out.length - 1];
      if (last?.kind === 'art') last.body.push(p.text);
      else if (last?.kind === 'head') (last.intro ??= []).push(p.text);
    }
  }
  return out;
}

const matches = (h, sel) => {
  const a = fold(`${h.label} ${h.title}`), b = fold(sel);
  return a.startsWith(b) && !/[A-Z0-9]/.test(a.charAt(b.length));
};

/** Índices [inicio, fin) del bloque que cuelga de una ruta de cabeceras. */
function findPath(els, path, from = 0, to = els.length) {
  let lo = from, hi = to;
  for (const sel of path) {
    const i = els.findIndex((e, k) => k >= lo && k < hi && e.kind === 'head' && matches(e, sel));
    if (i < 0) return null;
    let j = i + 1;
    while (j < hi && !(els[j].kind === 'head' && els[j].level <= els[i].level)) j++;
    lo = i; hi = j;
  }
  return [lo, hi];
}

function parseArts(s) {
  return s.split(',').flatMap((r) => {
    const [a, b] = r.split('-').map((x) => x.trim());
    if (!b) return [a];
    return Array.from({ length: +b - +a + 1 }, (_, k) => String(+a + k));
  });
}

const inventory = [];
for (const n of spec.normas) {
  const xml = await fetchXml(n);
  const els = elements(paragraphs(xml, n.diario));
  const keep = new Set();
  const rows = [];
  for (const sel of n.select) {
    if (sel.path) {
      const r = findPath(els, sel.path);
      if (!r) { rows.push({ sel: sel.path.join(' › '), found: [], missing: ['(sección no encontrada)'] }); continue; }
      const found = [];
      for (let k = r[0]; k < r[1]; k++) { keep.add(k); if (els[k].kind === 'art') found.push(els[k].num); }
      rows.push({ sel: sel.path.join(' › '), found, missing: found.length ? [] : ['(sin artículos)'] });
    } else {
      const want = parseArts(sel.arts);
      const found = [], missing = [];
      for (const w of want) {
        const k = els.findIndex((e) => e.kind === 'art' && e.num === w);
        if (k < 0) { missing.push(w); continue; }
        found.push(w); keep.add(k);
      }
      rows.push({ sel: `arts. ${sel.arts}`, found, missing });
    }
  }
  // Cabeceras de contexto (título/capítulo) de cada artículo incluido, para conservar la estructura.
  const stack = [];
  const ctx = new Set();
  els.forEach((e, k) => {
    if (e.kind === 'head') { while (stack.length && els[stack[stack.length - 1]].level >= e.level) stack.pop(); stack.push(k); }
    else if (keep.has(k)) stack.forEach((h) => ctx.add(h));
  });
  const lines = [`# ${n.title}`, '', `Fuente: BOE ${n.id} (${n.diario ? 'Diario Oficial' : 'texto consolidado'}). Solo los artículos del temario.`, ''];
  els.forEach((e, k) => {
    if (!keep.has(k) && !ctx.has(k)) return;
    if (e.kind === 'head') lines.push(e.label, ...(e.title ? [e.title] : []), '');
    else lines.push(e.label, '', ...e.body.flatMap((t) => [t, '']));
  });
  const md = lines.join('\n').replace(/\n{3,}/g, '\n\n');
  const outFile = join(root, spec.out, n.file);
  mkdirSync(dirname(outFile), { recursive: true });
  if (!existsSync(outFile) || readFileSync(outFile, 'utf8') !== md) writeFileSync(outFile, md);
  // Huecos de numeración dentro de un bloque (posible artículo perdido al extraer).
  const nums = rows.flatMap((r) => r.found).filter((x) => /^\d+$/.test(x)).map(Number).sort((a, b) => a - b);
  inventory.push({ n, rows, total: new Set(rows.flatMap((r) => r.found)).size, nums });
}

// ------------------------------------------------------------------ inventario
let md = '# Inventario del temario\n\n_Generado por `scripts/boe/build.mjs`. Texto literal del BOE; nada resumido._\n\n';
let pending = 0;
for (const { n, rows, total } of inventory) {
  md += `## ${n.title}\n\n${n.id} · ${total} artículos · \`${n.file}\`\n\n| Apartado del temario | Artículos encontrados | Pendientes |\n|---|---|---|\n`;
  for (const r of rows) {
    pending += r.missing.length;
    md += `| ${r.sel} | ${r.found.join(', ') || '—'} | ${r.missing.join(', ') || '✔'} |\n`;
  }
  md += '\n';
}
md += pending ? `**Pendientes: ${pending}.**\n` : '**Completo: no falta ningún artículo.**\n';
writeFileSync(join(here, 'inventario.md'), md);
for (const { n, rows, total } of inventory) {
  const miss = rows.flatMap((r) => r.missing.map((m) => `${r.sel}: ${m}`));
  console.log(`${miss.length ? '✗' : '✔'} ${n.file.padEnd(48)} ${String(total).padStart(3)} arts${miss.length ? '  FALTA → ' + miss.join('; ') : ''}`);
}
console.log(pending ? `Pendientes: ${pending}` : 'Completo: no falta ningún artículo.');
process.exitCode = pending ? 1 : 0;
