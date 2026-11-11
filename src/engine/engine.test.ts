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
      if (d.rule === 'definicion') {
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

  it('el plazo se pregunta con la frase como enunciado', () => {
    const p = drafts.find((d) => d.rule === 'plazo' && d.sectionId === 2)!;
    // Estilo oficial: el enunciado es el inicio de la frase y las opciones, su continuación.
    expect(p.stem).toMatch(/será de…$/);
    expect(p.options[p.correctIndex]).toMatch(/^tres meses desde la entrada/);
    expect(p.stem).not.toContain('tres meses');
    p.options.forEach((o) => expect(o).toMatch(/mes(?:es)? desde la entrada/));
  });

  it('es determinista', () => {
    expect(generate(UNITS, 'Ley de prueba').drafts).toEqual(drafts);
  });

  it('completa los plazos con alternativas de la misma unidad', () => {
    const r = generate([UNITS[1]], 'X');
    const p = r.drafts.find((d) => d.rule === 'plazo')!;
    p.options.forEach((o) => expect(o).toMatch(/mes(?:es)? desde/));
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

describe('explicación cuando no hay preguntas', () => {
  beforeEach(async () => {
    await Promise.all(db.tables.map((t) => t.clear()));
  });

  it('explica el escaneado, la falta de artículos y el idioma', async () => {
    const scan = await importPdf(new File(['s'], 's.pdf'), {}, undefined, async () => ({ pages: ['', '', ''] }));
    const noArts = await importPdf(new File(['n'], 'n.pdf'), {}, undefined, async () => ({
      pages: ['Tema 1. La organización del Estado y sus principios fundamentales en el ordenamiento.'],
    }));
    const cat = await importPdf(new File(['c'], 'c.pdf'), {}, undefined, async () => ({
      pages: ['Article 1\nObjecte de la Llei\n1. Aquesta Llei té per objecte actuar contra la violència dels homes.'],
    }));
    const [r1, r2, r3] = await generateForDocuments([scan, noArts, cat]);
    expect(r1.hint).toMatch(/imagen escaneada/);
    expect(r2.hint).toMatch(/No se han detectado artículos/);
    expect(r1.hint).not.toContain('(s)');
    expect(r3.units).toBe(1);
    expect(r3.hint).not.toMatch(/catalán/);
  });
});

describe('catalán, rúbrica y atribución', () => {
  const ca = (n: number, label: string, heading: string, text: string): Unit =>
    ({ sectionId: n, documentId: 1, label, heading, text });
  const UNITS_CA: Unit[] = [
    ca(1, 'Article 1', 'Objecte de la Llei', 'Aquesta Llei té per objecte regular el procediment administratiu comú de les administracions.'),
    ca(2, 'Article 2', 'Termini de presentació', 'Les al·legacions es poden presentar en el termini de deu dies hàbils a comptar de la notificació.'),
    ca(3, 'Article 3', 'Recurs d’alçada', 'El recurs es pot interposar en el termini d’un mes des de la notificació de la resolució expressa.'),
    ca(4, 'Article 4', 'Esmena', 'L’esmena s’ha de fer en el termini de quinze dies hàbils des del requeriment de l’òrgan.'),
    ca(5, 'Article 5', 'Revisió', 'El recurs extraordinari s’interposa en el termini de quatre anys des de la data de la resolució.'),
    ca(6, 'Article 6', 'Obligació de resoldre', 'L’Administració ha de dictar resolució expressa en tots els procediments, llevat que es produeixi el desistiment.'),
  ];
  it('genera preguntas de las normas en catalán sin salir del texto', () => {
    const { drafts } = generate(UNITS_CA, 'Llei 39/2015');
    const rules = new Set(drafts.map((d) => d.rule));
    expect(rules.has('plazo')).toBe(true);
    expect(rules.has('rubrica') || rules.has('atribucion') || rules.has('afirmacion')).toBe(true);
    // Todos los artículos tienen al menos una pregunta.
    expect(new Set(drafts.map((d) => d.sectionId)).size).toBe(UNITS_CA.length);
    const all = norm(UNITS_CA.map((u) => `${u.heading} ${u.text}`).join(' '));
    for (const d of drafts) {
      if (d.rule === 'rubrica' || d.rule === 'atribucion') d.options.forEach((o) => expect(all).toContain(norm(o)));
    }
    const exc = drafts.find((d) => d.rule === 'excepcion');
    if (exc) expect(exc.options[exc.correctIndex]).toMatch(/^llevat que/);
  });
});

describe('nombre corto de la norma', () => {
  it('abrevia títulos oficiales y deja los demás', async () => {
    const { shortDocTitle } = await import('./generate');
    expect(shortDocTitle('Ley Orgánica 1/2004, de 28 de diciembre, de Medidas de Protección Integral contra la Violencia de Género.')).toBe('Ley Orgánica 1/2004');
    expect(shortDocTitle('Real Decreto Legislativo 2/2011, de 5 de septiembre, por el que se aprueba…')).toBe('Real Decreto Legislativo 2/2011');
    expect(shortDocTitle('Orden HAP/1234/2020, de 1 de enero')).toBe('Orden HAP/1234/2020');
    expect(shortDocTitle('Constitución Española.')).toBe('Constitución Española');
  });
});

describe('estilo examen oficial', () => {
  it('afirmación correcta/incorrecta con variantes de un solo dato que no están en el texto', () => {
    const units: Unit[] = [
      u(1, 'Artículo 5', 'El órgano competente podrá ampliar el plazo máximo de resolución por un tiempo que no exceda de la mitad.\nLa solicitud deberá presentarse en el registro electrónico de la Administración u Organismo al que se dirija.\nEn ningún caso podrá exigirse al interesado la presentación de documentos originales.\nLa resolución expresa será motivada en los supuestos previstos en el artículo siguiente de esta norma.'),
    ];
    const { drafts } = generate(units, 'Ley de prueba');
    const a = drafts.find((d) => d.rule === 'afirmacion')!;
    expect(a.stem).toMatch(/señale la afirmación (correcta|INCORRECTA):$/);
    const text = norm(units[0].text);
    const literal = a.options.filter((o) => text.includes(norm(o)));
    expect(literal.length === 1 || literal.length === 3).toBe(true);
    if (literal.length === 1) expect(a.options[a.correctIndex]).toBe(literal[0]);
    else expect(text).not.toContain(norm(a.options[a.correctIndex]));
  });
});
