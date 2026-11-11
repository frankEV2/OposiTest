import { describe, expect, it } from 'vitest';
import { checkAiQuestion } from './questions';

const frag = [{ ref: 'Ley 31/1995, art. 14', text: 'En cumplimiento del deber de protección, el empresario deberá garantizar la seguridad y la salud de los trabajadores a su servicio en todos los aspectos relacionados con el trabajo.' }];
const base = {
  enunciado: '¿Quién tiene el deber de garantizar la seguridad y salud de los trabajadores en todos los aspectos relacionados con el trabajo?',
  opciones: ['El servicio de prevención exclusivamente.', 'El empresario.', 'Los delegados de prevención.', 'La Inspección de Trabajo y Seguridad Social.'],
  correcta: 1, explicacion: 'El empresario deberá garantizar…', fragmento: 1,
  cita: 'el empresario deberá garantizar la seguridad y la salud de los trabajadores',
};

describe('control de calidad de preguntas IA', () => {
  it('acepta una pregunta de estilo examen respaldada por cita literal', () => {
    const r = checkAiQuestion(base, frag);
    expect('reason' in r).toBe(false);
  });
  it('rechaza preguntas por número de artículo', () => {
    expect(checkAiQuestion({ ...base, enunciado: '¿Qué establece el artículo 14 de la Ley 31/1995?' }, frag)).toEqual({ reason: 'pregunta por número de artículo' });
  });
  it('rechaza si la cita no está en el temario (posible invención)', () => {
    expect(checkAiQuestion({ ...base, cita: 'el empresario podrá delegar esta obligación en terceros' }, frag)).toEqual({ reason: 'sin cita literal del temario' });
  });
  it('rechaza opciones compuestas que no estén al final', () => {
    const opciones = ['Todas las anteriores son correctas', ...base.opciones.slice(1)];
    expect(checkAiQuestion({ ...base, opciones }, frag)).toEqual({ reason: 'opción compuesta fuera de lugar' });
  });
});
