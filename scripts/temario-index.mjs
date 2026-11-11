// Genera public/temario/index.json con los .md incluidos en la app.
// Estructura de carpetas: public/temario/<Oposición>/<Materia>/<Tema>/archivo.md (niveles opcionales).
import { createHash } from 'node:crypto';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

const root = join(process.cwd(), 'public', 'temario');
if (!existsSync(root)) mkdirSync(root, { recursive: true });

const out = [];
(function walk(dir) {
  for (const name of readdirSync(dir).sort((a, b) => a.localeCompare(b, 'es', { numeric: true }))) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p);
    else if (/\.(md|markdown)$/i.test(name)) {
      const buf = readFileSync(p);
      const file = relative(root, p).split(sep).join('/');
      const [opo, mat, tema] = file.split('/').slice(0, -1);
      out.push({
        file, size: buf.length, sha256: createHash('sha256').update(buf).digest('hex'),
        tax: Object.fromEntries(Object.entries({ opo, mat, tema }).filter(([, v]) => v)),
      });
    }
  }
})(root);

writeFileSync(join(root, 'index.json'), JSON.stringify(out, null, 1));
console.log(`temario: ${out.length} documento(s)`);
