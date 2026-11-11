import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { generateForDocuments } from '../engine/store';
import { parseMarkdown } from './markdown';
import { importPdf } from './service';

const md = (name: string, text: string) => new File([text], name, { type: 'text/markdown' });

const NORMA = `# Ley de prueba

## TÍTULO I. Disposiciones generales

### Artículo 1. Objeto

1. Esta ley tiene por objeto **regular** el procedimiento de prueba.

2. Las alegaciones podrán presentarse en el plazo de diez días hábiles a contar desde la notificación.

### Artículo 2. Competencia

Corresponde al Consejo de Gobierno la aprobación del reglamento general.
`;

const TEMARIO = `# Tema 1. La organización

## 1. Concepto

La organización administrativa es el conjunto de órganos que ejercen funciones públicas.

## 2. Principios

### 2.1 Jerarquía

La jerarquía ordena las relaciones entre órganos superiores e inferiores.

### 2.2 Competencia

La competencia es irrenunciable y se ejerce por los órganos que la tengan atribuida.
`;

describe('markdown', () => {
  beforeEach(async () => { await db.delete(); await db.open(); });

  it('quita la sintaxis y toma el título del primer encabezado', () => {
    const d = parseMarkdown(NORMA);
    expect(d.title).toBe('Ley de prueba');
    expect(d.pages.join('\n')).toContain('Artículo 1. Objeto');
    expect(d.pages.join('\n')).not.toContain('**');
  });

  it('una norma en .md se estructura por artículos y genera preguntas', async () => {
    const id = await importPdf(md('ley.md', NORMA), {});
    const secs = await db.sections.where('documentId').equals(id).toArray();
    expect(secs.filter((s) => s.kind === 'articulo').map((s) => s.label)).toEqual(['Artículo 1', 'Artículo 2']);
    expect((await db.documents.get(id))!.title).toBe('Ley de prueba');
    expect((await db.documentFiles.get(id))!.blob.type).toBe('text/markdown');
  });

  it('un temario sin artículos se estructura por encabezados', async () => {
    const id = await importPdf(md('tema1.md', TEMARIO), {});
    const secs = await db.sections.where('documentId').equals(id).sortBy('order');
    const units = secs.filter((s) => s.kind === 'articulo').map((s) => s.label);
    expect(units).toEqual(['1. Concepto', '2.1 Jerarquía', '2.2 Competencia']);
    const sub = secs.find((s) => s.label === '2.1 Jerarquía')!;
    expect(secs.find((s) => s.id === sub.parentId)!.label).toBe('2. Principios');
    expect((await db.documents.get(id))!.warnings).toEqual([]);
    await generateForDocuments([id]);
  });
});
