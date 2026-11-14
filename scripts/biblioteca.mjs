// Genera public/biblioteca/index.json: la Biblioteca de cada oposición (normativa, apuntes y modelos de examen).
// Reutiliza lo que ya existe: scripts/boe/*.json (normas con su id BOE y sus temas), public/temario/index.json
// (apuntes y extractos .md) y scripts/biblioteca/extra.json (normativa adicional y exámenes en PDF).
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

const read = (p) => JSON.parse(readFileSync(p, 'utf8'));
const index = read('public/temario/index.json');
const extra = read('scripts/biblioteca/extra.json');
const WS = {
  'puerto-tarragona': { temario: 'Puertos del Estado/', boe: 'scripts/boe/temario.json' },
  'ayto-tarragona-prl': { temario: 'Ayuntamiento de Tarragona/', boe: 'scripts/boe/temario-prl.json' },
};

const boeLinks = (id, diario) => (diario
  ? { url: `https://www.boe.es/diario_boe/txt.php?id=${id}`, fuente: 'BOE (texto publicado)' }
  : { url: `https://www.boe.es/buscar/act.php?id=${id}`, pdf: `https://www.boe.es/buscar/pdf/${id.slice(6, 10)}/${id}-consolidado.pdf`, fuente: 'BOE · texto consolidado vigente' });

const out = {};
for (const [ws, cfg] of Object.entries(WS)) {
  const files = index.filter((e) => e.file.startsWith(cfg.temario));
  const temaNames = [...new Set(files.map((e) => e.tax.tema).filter(Boolean))];
  const fullTema = (t) => temaNames.find((n) => n.startsWith(t)) ?? t;
  const boe = read(cfg.boe);
  const normas = new Map();
  const add = (key, base, tema, file) => {
    const n = normas.get(key) ?? { ...base, temas: [], textos: [] };
    if (tema && !n.temas.includes(tema)) n.temas.push(tema);
    if (file && !n.textos.some((t) => t.file === file)) n.textos.push({ tema, file });
    normas.set(key, n);
  };
  const bloqueOf = (file) => files.find((e) => e.file === file)?.tax.mat ?? 'Temario';
  for (const n of boe.normas) {
    // Puerto: una entrada por norma; PRL: cada tema remite a varias normas (parts).
    for (const p of n.parts ?? [n]) {
      const file = `${(boe.out.replace('public/temario/', '') + '/').replace(/\/+$/, '/')}${n.tema ? `${n.tema}/` : ''}${p.file}`;
      add(p.id, { key: p.id, title: p.title, bloque: bloqueOf(file), ...boeLinks(p.id, p.diario) }, n.tema, existsSync(`public/temario/${file}`) ? file : undefined);
    }
  }
  for (const n of extra[ws]?.normativa ?? []) {
    const links = n.id ? boeLinks(n.id, n.diario) : { url: n.eli, fuente: n.fuente };
    for (const t of n.temas ?? [undefined]) add(n.id ?? n.eli, { key: n.id ?? n.eli, title: n.title, bloque: n.bloque, ...links }, t && fullTema(t));
  }
  // Apuntes y material: los .md del temario (apuntes propios y extractos de normativa por tema).
  const apuntes = files.map((e) => {
    const name = e.file.split('/').pop().replace(/\.md$/i, '');
    return {
      file: e.file, bloque: e.tax.mat ?? 'Temario', tema: e.tax.tema ?? '',
      tipo: /apunt/i.test(name) ? 'Apuntes' : 'Temario (artículos seleccionados)',
      title: /apunt/i.test(name) ? `Apuntes · ${e.tax.tema ?? ''}` : (normas.get([...normas.keys()].find((k) => normas.get(k).textos.some((t) => t.file === e.file)))?.title ?? name),
    };
  });
  const examenes = (extra[ws]?.examenes ?? []).map((x) => ({ ...x, file: `biblioteca/${ws}/${x.file}` }));
  for (const x of examenes) if (!existsSync(`public/${x.file}`)) throw new Error(`Falta ${x.file}`);
  out[ws] = { normativa: [...normas.values()].sort((a, b) => Number(!/general/i.test(a.bloque)) - Number(!/general/i.test(b.bloque)) || a.bloque.localeCompare(b.bloque) || (a.temas[0] ?? '').localeCompare(b.temas[0] ?? '')), apuntes, examenes };
}
writeFileSync('public/biblioteca/index.json', JSON.stringify(out, null, 1));
console.log(`biblioteca: ${Object.entries(out).map(([k, v]) => `${k} ${v.normativa.length} normas/${v.apuntes.length} apuntes/${v.examenes.length} exámenes`).join(' · ')}`);
