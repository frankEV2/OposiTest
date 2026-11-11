// Convierte apuntes en texto (extraídos de PDF) en un Markdown por tema para el temario integrado.
//   node scripts/apunts-to-md.mjs <apunts.txt> "<carpeta de salida>"
// Temas: línea con el número de página N seguida de "N. Título". Subapartados: líneas cortas sin puntuación final.
// Viñetas "•" y numeraciones cortas → elementos de lista. El texto no se modifica.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const [src, out] = process.argv.slice(2);
const lines = readFileSync(src, 'utf8').replace(/\r/g, '').split('\n').map((l) => l.trim());
const temas = [];
for (let i = 0; i < lines.length; i++) {
  const n = lines[i];
  const next = lines[i + 1] ?? '';
  const expected = String((temas.at(-1)?.n ?? 0) + 1);
  const pageStart = /^\d{1,2}$/.test(n) && next.startsWith(`${n}. `);
  // Tema que empieza a media página: "N. Título largo" con N = siguiente tema, fuera de una lista numerada.
  const midPage = n.startsWith(`${expected}. `) && n.length > 40 && !n.includes('→') && !/^\d{1,2}\.\s/.test(lines[i - 1] ?? '');
  if (pageStart || midPage) {
    const head = pageStart ? next : n;
    const num = pageStart ? n : expected;
    let title = head.slice(num.length + 2);
    let j = pageStart ? i + 2 : i + 1;
    while (j < lines.length && /^\p{Ll}/u.test(lines[j]) && title.length < 160) title += ` ${lines[j++]}`;
    temas.push({ n: +num, title: title.replace(/\s+/g, ' ').replace(/\.$/, ''), body: [] });
    i = j - 1;
  } else if (temas.length && n) temas[temas.length - 1].body.push(n);
}

const isHeading = (l, next) => l.length <= 70 && /^\p{Lu}/u.test(l) && !/[.:;,→]$/.test(l) && !/^\d/.test(l)
  && !/^\p{Ll}/u.test(next ?? '') && l.split(' ').length <= 10;

for (const t of temas) {
  const md = [`# Tema ${t.n}. ${t.title}`, ''];
  t.body.forEach((l, k) => {
    const next = t.body[k + 1];
    if (/^[•·▪-]\s*/.test(l)) md.push(`- ${l.replace(/^[•·▪-]\s*/, '')}`);
    else if (/^\d{1,2}\.\s/.test(l) && l.length < 90) md.push(`- ${l.replace(/^\d{1,2}\.\s+/, '')}`);
    else if (isHeading(l, next)) {
      md.push('', `## ${l}`, '');
      // Si le sigue una lista, el título hace de introducción de la enumeración.
      if (/^([•·▪-]|\d{1,2}\.\s)/.test(next ?? '')) md.push(`${l}:`);
    } else md.push(l);
  });
  const dir = join(out, `Tema ${String(t.n).padStart(2, '0')}. ${t.title.slice(0, 80).replace(/[\\/:*?"<>|]/g, '')}`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'Apunts.md'), md.join('\n').replace(/\n{3,}/g, '\n\n') + '\n');
  console.log(`Tema ${t.n}: ${t.title} (${t.body.length} líneas)`);
}
