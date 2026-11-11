import { describe, expect, it } from 'vitest';
import { speakable, takeSentences } from './voice';

describe('voz', () => {
  it('divide en frases sin cortar abreviaturas ni cifras, y espera si la frase no ha terminado', () => {
    const t = 'Según el art. 5.2 de la Ley 39/2015, pueden representar. Otra frase! Incompleta 5.';
    const { sentences, next } = takeSentences(t, 0);
    expect(sentences).toEqual(['Según el art. 5.2 de la Ley 39/2015, pueden representar.', ' Otra frase!']);
    expect(t.slice(next)).toBe(' Incompleta 5.');
  });

  it('prepara el texto para leerlo: sin referencias ni marcas', () => {
    expect(speakable('**Ojo**: el art. 5 [Ley 39/2015, art. 5.1] dice\n- esto')).toBe('Ojo: el artículo 5 dice\nesto');
  });
});
