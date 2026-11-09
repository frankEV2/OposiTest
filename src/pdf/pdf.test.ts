import { describe, expect, it } from 'vitest';
import { assessQuality, fold, joinParagraphs, normalizeText, stripRepeatedLines } from './clean';
import { parseStructure } from './structure';

describe('limpieza', () => {
  it('quita cabeceras repetidas y une guiones', () => {
    const pages = [1, 2, 3, 4].map((n) => `BOLETÍN OFICIAL DEL ESTADO\nContenido ${"abcd"[n - 1]}\nPágina ${n}`);
    const out = stripRepeatedLines(pages);
    expect(out[0]).toBe("Contenido a");
    expect(normalizeText('procedi-\nmiento  administrativo')).toBe('procedimiento administrativo');
  });

  it('une líneas de un mismo párrafo pero no apartados', () => {
    expect(joinParagraphs('El plazo será\nde tres meses.\n2. Otro apartado.')).toBe(
      'El plazo será de tres meses.\n2. Otro apartado.',
    );
  });

  it('detecta PDF escaneados y páginas vacías', () => {
    const full = 'Lorem ipsum '.repeat(10);
    expect(assessQuality(['', '', '']).status).toBe('scanned');
    expect(assessQuality([full, '', full, full, full]).status).toBe('partial');
    expect(assessQuality([full, full]).status).toBe('ok');
  });

  it('fold quita tildes', () => expect(fold('Disposición ÚNICA')).toBe('disposicion unica'));
});

const LEY = [
  `ÍNDICE
TÍTULO PRELIMINAR
Disposiciones generales
Artículo 1. Objeto de la Ley.
Artículo 2. Ámbito subjetivo.
TÍTULO PRELIMINAR
Disposiciones generales
Artículo 1. Objeto de la Ley.
1. La presente Ley tiene por objeto regular
los requisitos de validez.
2. Solo mediante ley podrán incluirse trámites adicionales.
Artículo 2. Ámbito subjetivo.
La presente Ley se aplica al sector público.`,
  `TÍTULO I
De los interesados
CAPÍTULO I
La capacidad de obrar
Artículo 3. Capacidad de obrar.
Tendrán capacidad de obrar las personas físicas.
Disposición adicional primera. Especialidades por razón de materia.
Se regirán por su normativa específica.
Disposición final única. Entrada en vigor.
La presente Ley entrará en vigor al año.`,
];

describe('estructura', () => {
  const s = parseStructure(LEY);
  const labels = s.map((x) => x.label);

  it('elimina las entradas del índice', () => {
    expect(labels.filter((l) => l === 'Artículo 1')).toHaveLength(1);
    expect(labels.filter((l) => l === 'TÍTULO PRELIMINAR')).toHaveLength(1);
  });

  it('detecta artículos, apartados, títulos y disposiciones con jerarquía', () => {
    const art1 = s.find((x) => x.label === 'Artículo 1')!;
    expect(art1.heading).toBe('Objeto de la Ley.');
    expect(art1.text).toContain('regular los requisitos de validez.');
    expect(art1.text).toContain('2. Solo mediante ley');
    const ap = s.find((x) => x.label === 'Artículo 1.2')!;
    expect(ap.kind).toBe('apartado');
    expect(s[ap.parent!].label).toBe('Artículo 1');
    const art3 = s.find((x) => x.label === 'Artículo 3')!;
    expect(s[art3.parent!].kind).toBe('capitulo');
    expect(s[s[art3.parent!].parent!].heading).toBe('De los interesados');
    expect(art3.pageStart).toBe(2);
    const da = s.find((x) => x.kind === 'disposicion')!;
    expect(da.label).toBe('Disposición adicional primera');
    expect(da.parent).toBeUndefined();
    expect(parseStructure(['Disposicion final unica. Vigor.\nTexto.'])[0].label).toBe('Disposición final única'.replace('única', 'unica'));
    expect(labels).toContain('Disposición final única');
  });

  it('no confunde referencias en mitad de una línea', () => {
    const r = parseStructure(['Artículo 4. Plazos.\nSegún el artículo 21. de esta ley se resolverá.']);
    expect(r.filter((x) => x.kind === 'articulo')).toHaveLength(1);
  });
});

describe('casos reales del BOE', () => {
  it('ignora el índice, el texto citado de otras leyes y admite "Artículo N" sin rúbrica', () => {
    const r = parseStructure([
      `ÍNDICE
Artículo 1. Objeto . . . . . . . . . . . 5
Artículo 2. Especialidades de la resolución en los procedimientos en materia de responsabilidad
patrimonial.. . . . . . . . . . . . . 6
Disposición final tercera. Modificación de la Ley 36/2011, reguladora de la jurisdicción social. 69
I
Texto del preámbulo que no debe ir dentro de ninguna disposición.
Artículo 1. Objeto.
Texto del artículo uno.
Artículo 2. Especialidades.
Texto del artículo dos.
Disposición final tercera. Modificación de otra ley.
Uno. El Título V queda redactado del siguiente modo:
«TÍTULO V
Artículo 22. Del ejercicio de la iniciativa legislativa.
El Gobierno ejercerá la iniciativa.»
Artículo 14
1. Los españoles son iguales ante la ley.`,
    ]);
    const labels = r.map((x) => x.label);
    expect(labels.filter((l) => l === 'Artículo 1')).toHaveLength(1);
    expect(labels.filter((l) => l === 'Artículo 2')).toHaveLength(1);
    expect(labels.filter((l) => l.startsWith('Disposición final'))).toHaveLength(1);
    expect(labels).not.toContain('Artículo 22');
    expect(labels).not.toContain('TÍTULO V');
    const df = r.find((x) => x.kind === 'disposicion')!;
    expect(df.text).toContain('Artículo 22. Del ejercicio');
    expect(df.text).not.toContain('preámbulo');
    expect(r.find((x) => x.label === 'Artículo 14')!.text).toContain('iguales ante la ley');
    expect(labels).toContain('Artículo 14.1');
  });

  it('no borra líneas repetidas del cuerpo de la página', () => {
    const pages = [1, 2, 3, 4].map((n) => `BOLETÍN OFICIAL DEL ESTADO\nCabecera\nx\ny\nArtículo ${n}\ny el\ncuerpo ${n} a\ncuerpo ${n} b\ncuerpo ${n} c\ncuerpo ${n} d\nPágina ${n}`);
    const out = stripRepeatedLines(pages);
    expect(out[0]).toContain('Artículo 1');
    expect(out[0]).toContain('y el');
    expect(out[0]).not.toContain('BOLETÍN');
    expect(out[0]).not.toContain('Página');
  });
});

describe('índices de varias líneas y disposiciones', () => {
  it('descarta entradas de índice en tres líneas y "Disposición adicional" sin ordinal', () => {
    const r = parseStructure([`Disposición adicional octava. Resoluciones de la Secretaría General del Ministerio de
Asuntos Económicos que establezcan las condiciones de uso de sistemas de
identificación. . . . . . . . . . . . . . . 67
Disposición adicional octava. Resoluciones de la Secretaría General.
Texto real de la disposición octava con su contenido.
Disposición adicional prevista en la ley anterior para el sistema de registro.`]);
    expect(r.filter((x) => x.kind === 'disposicion').map((x) => x.label)).toEqual(['Disposición adicional octava']);
    expect(r[0].text).toContain('Texto real');
    expect(r[0].text).toContain('Disposición adicional prevista');
  });
});

describe('textos en catalán', () => {
  it('detecta títols, capítols, articles amb rúbrica a la línia següent i disposicions', () => {
    const r = parseStructure([`Títol preliminar
Article 1
Objecte de la Llei
1. Aquesta Llei té per objecte actuar contra la violència.
2. Aquesta Llei estableix mesures de protecció integral.
Títol 11
Drets de les dones víctimes de violència de gènere
Capítol 1
Dret a la informació
Article 17
Garantia dels drets de les víctimes
1. Totes les dones víctimes tenen garantits els drets.
Disposició addicional primera. Pensió de viduïtat.
Text de la disposició.
Disposició final
Text final.`]);
    const labels = r.map((x) => x.label);
    expect(labels).toEqual(expect.arrayContaining(['Títol preliminar', 'Article 1', 'Article 1.1', 'Títol 11', 'Capítol 1', 'Article 17', 'Disposició addicional primera', 'Disposició final']));
    const a1 = r.find((x) => x.label === 'Article 1')!;
    expect(a1.heading).toBe('Objecte de la Llei');
    expect(a1.text).toContain('actuar contra la violència');
    const a17 = r.find((x) => x.label === 'Article 17')!;
    expect(r[a17.parent!].label).toBe('Capítol 1');
    expect(r.find((x) => x.label === 'Títol 11')!.heading).toBe('Drets de les dones víctimes de violència de gènere');
  });

  it('no toma como rúbrica la primera frase de un artículo sin rúbrica', () => {
    const r = parseStructure(['Artículo 14\nLos españoles son iguales ante la ley, sin que pueda prevalecer discriminación alguna.']);
    expect(r[0].heading).toBe('');
    expect(r[0].text).toContain('Los españoles son iguales');
  });
});
