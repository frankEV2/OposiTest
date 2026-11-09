import { describe, expect, it } from 'vitest';
import type { Section } from '../db/types';
import { parseStructure } from '../pdf/structure';
import { buildTree, conceptMap, flashcards, structureMap, summarize, summaryToMarkdown } from './materials';
import { norm } from '../engine/text';

// Texto de prueba (no es una norma real).
const TEXT = `TÍTULO I
De los interesados
CAPÍTULO I
Definiciones
Artículo 2. Definiciones.
A los efectos de esta norma se entiende por:
a) Interesado: la persona que promueve el procedimiento como titular de derechos.
b) Registro: el archivo donde se anotan las entradas y salidas de documentos.
Artículo 3. Plazos.
1. El plazo para resolver será de tres meses desde la solicitud. Se notificará después.
2. Corresponde al Consejo de Ministros la aprobación del reglamento "general".
TÍTULO II
Abstención
Artículo 4. Causas.
Son causas de abstención las siguientes:
a) Tener interés personal en el asunto;
b) Tener parentesco con los interesados;
c) Haber sido perito en el procedimiento.`;

const sections: Section[] = parseStructure([TEXT]).map((s, i) => ({
  id: i + 1, documentId: 1, kind: s.kind, label: s.label, heading: s.heading, text: s.text,
  order: i, pageStart: 1, parentId: s.parent === undefined ? undefined : s.parent + 1,
}));
const id = (label: string) => sections.find((s) => s.label === label)!.id!;

describe('material de estudio', () => {
  it('construye el árbol sin apartados y por subárbol', () => {
    const t = buildTree(sections);
    expect(t.map((n) => n.section.label)).toEqual(['TÍTULO I', 'TÍTULO II']);
    expect(buildTree(sections, id('TÍTULO II'))[0].children[0].section.label).toBe('Artículo 4');
  });

  it('los resúmenes son literales y crecen por nivel', () => {
    const corpus = norm(TEXT);
    const breve = summarize(sections, 'breve');
    const medio = summarize(sections, 'medio');
    const completo = summarize(sections, 'completo');
    expect(breve.every((b) => b.lines.length === 0)).toBe(true);
    const art3 = medio.find((b) => b.section.label === 'Artículo 3')!;
    expect(art3.lines[0]).toBe('1. El plazo para resolver será de tres meses desde la solicitud.');
    for (const b of [...medio, ...completo]) for (const l of b.lines) expect(corpus).toContain(norm(l));
    const len = (x: typeof breve) => x.reduce((a, b) => a + b.lines.join().length, 0);
    expect(len(medio)).toBeLessThan(len(completo));
    expect(summaryToMarkdown('Prueba', 'medio', medio)).toContain('## TÍTULO I. De los interesados');
  });

  it('genera mapas Mermaid con ids enlazables y texto escapado', () => {
    const m = structureMap(sections, undefined, 'Prueba');
    expect(m.code).toMatch(/^flowchart LR/);
    expect(m.code).toContain(`s${id('Artículo 3')}("art. 3. Plazos.")`);
    const c = conceptMap(sections, undefined, 'Prueba');
    expect(c.code).toContain('Plazo: tres meses');
    expect(c.code).toContain('Competencia: Consejo de Ministros');
    expect(c.code).toContain('Interesado: la persona');
    expect(c.code).not.toMatch(/reglamento "general"/);
    expect(c.truncated).toBe(false);
  });

  it('crea fichas con respuesta literal', () => {
    const f = flashcards(sections);
    const backs = f.map((x) => x.back);
    expect(backs).toContain('tres meses');
    expect(backs).toContain('Consejo de Ministros');
    expect(backs).toContain('la persona que promueve el procedimiento como titular de derechos');
    expect(f.find((x) => x.front.startsWith('Son causas'))!.back.split('\n')).toHaveLength(3);
    expect(flashcards(sections, id('TÍTULO II'))).toHaveLength(1);
  });
});
