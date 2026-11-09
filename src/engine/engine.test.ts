import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../db/db';
import { importPdf } from '../library/service';
import { findDefinitions, findEnumerations, generate, validateDraft, type Unit } from './generate';
import { generateForDocuments, saveQuestion } from './store';
import { norm, sentences } from './text';

// Texto de prueba redactado para los tests (no es una norma real).
const u = (sectionId: number, label: string, text: string): Unit =>
  ({ sectionId, documentId: 1, label, heading: '', text });

const UNITS: Unit[] = [
  u(1, 'Artículo 2', 'A los efectos de esta norma se entiende por:\na) Interesado: la persona que promueve el procedimiento como titular de derechos.\nb) Registro: el archivo donde se anotan las entradas y salidas de documentos.\nc) Expediente: el conjunto ordenado de documentos que sirven de antecedente a la resolución.\nd) Sede electrónica: la dirección electrónica disponible para los ciudadanos a través de redes.'),
  u(2, 'Artículo 21.2', 'El plazo máximo en el que debe notificarse la resolución expresa será de tres meses desde la entrada de la solicitud.'),
  u(3, 'Artículo 22.1', 'Las alegaciones podrán presentarse en el plazo de diez días hábiles a contar desde la notificación.'),
  u(4, 'Artículo 30.4', 'El recurso de alzada podrá interponerse en el plazo de un mes desde la notificación.'),
  u(5, 'Artículo 32.1', 'El recurso extraordinario se interpondrá en el plazo de cuatro años desde la fecha de la resolución.'),
  u(6, 'Artículo 33.1', 'La subsanación se realizará en el plazo de quince días hábiles desde el requerimiento.'),
  u(7, 'Artículo 40', 'Corresponde al Consejo de Ministros la aprobación del reglamento general.'),
  u(8, 'Artículo 41', 'Corresponde a la Comisión Delegada del Gobierno el informe previo de los proyectos.'),
  u(9, 'Artículo 42', 'Será competente el Ministerio de Hacienda para la tramitación de los expedientes.'),
  u(10, 'Artículo 43', 'Corresponde al Tribunal de Cuentas la fiscalización externa de la actividad económica.'),
  u(11, 'Artículo 50', 'Son causas de abstención las siguientes:\na) Tener interés personal en el asunto;\nb) Tener parentesco con cualquiera de los interesados;\nc) Haber intervenido como perito en el procedimiento;\nd) Tener relación de servicio con la persona interesada.'),
  u(12, 'Artículo 51', 'Son derechos de las personas los siguientes:\na) Comunicarse con las Administraciones a través de un punto de acceso general;\nb) Ser asistidos en el uso de medios electrónicos;\nc) Utilizar las lenguas oficiales en el territorio de su comunidad.'),
  u(13, 'Artículo 60', 'El órgano competente deberá dictar resolución expresa, salvo que se produzca la terminación por desistimiento del interesado.'),
];

describe('texto', () => {
  it('no corta en abreviaturas ni en numeraciones', () => {
    expect(sentences('Según el art. 21.2 de la ley. Otra frase aquí.')).toEqual([
      'Según el art. 21.2 de la ley.', 'Otra frase aquí.',
    ]);
  });
});

describe('extractores', () => {
  it('detecta definiciones y enumeraciones distintas', () => {
    expect(findDefinitions(UNITS[0].text).map((d) => d.term)).toEqual(['Interesado', 'Registro', 'Expediente', 'Sede electrónica']);
    expect(findEnumerations(UNITS[0].text)).toHaveLength(0); // una lista de definiciones no es enumeración
    expect(findEnumerations(UNITS[10].text)[0].items[0]).toBe('Tener interés personal en el asunto');
  });
});

describe('generador', () => {
  const { drafts, discarded } = generate(UNITS, 'Ley de prueba');
  const rules = new Set(drafts.map((d) => d.rule));

  it('genera todas las reglas', () => {
    for (const r of ['definicion', 'plazo', 'competencia', 'enumeracion', 'excepcion', 'obligacion']) {
      expect(rules, r).toContain(r);
    }
    expect(Object.keys(discarded).length).toBeGreaterThanOrEqual(0);
  });

  it('cada pregunta es válida, literal y con distractores del corpus', () => {
    const corpus = norm(UNITS.map((x) => x.text).join(' '));
    for (const d of drafts) {
      expect(validateDraft(d)).toBeNull();
      expect(d.reference).toMatch(/^Ley de prueba, /);
      const correct = d.options[d.correctIndex];
      if (d.rule !== 'enumeracion') expect(norm(d.sourceExcerpt)).toContain(norm(correct));
      if (['plazo', 'competencia', 'definicion'].includes(d.rule)) {
        for (const o of d.options) expect(corpus, o).toContain(norm(o));
      }
    }
  });

  it('la forma negativa de enumeración tiene como respuesta un elemento ajeno', () => {
    const neg = drafts.find((d) => d.stem.includes('NO figura'))!;
    const unit = UNITS.find((x) => x.sectionId === neg.sectionId)!;
    expect(norm(unit.text)).not.toContain(norm(neg.options[neg.correctIndex]));
    neg.options.filter((_, i) => i !== neg.correctIndex).forEach((o) => expect(norm(unit.text)).toContain(norm(o)));
  });

  it('el plazo se oculta en el enunciado', () => {
    const p = drafts.find((d) => d.rule === 'plazo' && d.sectionId === 2)!;
    expect(p.stem).toContain('______');
    expect(p.options[p.correctIndex]).toBe('tres meses');
    expect(p.stem).not.toContain('tres meses');
  });

  it('es determinista', () => {
    expect(generate(UNITS, 'Ley de prueba').drafts).toEqual(drafts);
  });

  it('descarta plazos si no hay alternativas reales', () => {
    const r = generate([UNITS[1]], 'X');
    expect(r.drafts.filter((d) => d.rule === 'plazo')).toHaveLength(0);
    expect(r.discarded['plazo sin suficientes alternativas en el corpus']).toBe(1);
  });
});

describe('banco', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('guarda, evita duplicados al regenerar y valida manuales', async () => {
    const pages = [UNITS.map((x) => `${x.label.replace(/\.\d+$/, '')}. Título.\n${x.text}`).join('\n')];
    const id = await importPdf(new File(['x'], 'prueba.pdf'), { temaId: 3 }, undefined, async () => ({ pages }));
    const [r1] = await generateForDocuments([id]);
    expect(r1.added).toBeGreaterThan(5);
    const q = await db.questions.toArray();
    expect(q.every((x) => x.status === 'pending' && x.temaId === 3)).toBe(true);
    const [r2] = await generateForDocuments([id]);
    expect(r2.added).toBe(0);
    expect(r2.duplicates).toBe(r1.added);

    const input = {
      stem: '¿Cuál es la capital administrativa de prueba?', options: ['A', 'B', 'C', 'D'] as [string, string, string, string],
      correctIndex: 1 as const, explanation: '', reference: '', difficulty: 1 as const, sourceExcerpt: '',
    };
    const mid = await saveQuestion(input);
    expect((await db.questions.get(mid))?.rule).toBe('manual');
    await expect(saveQuestion(input)).rejects.toThrow(/Ya existe/);
    await expect(saveQuestion({ ...input, options: ['A', 'A', 'C', 'D'] })).rejects.toThrow(/repetidas/);
  });
});
