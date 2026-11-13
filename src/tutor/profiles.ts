/**
 * Criterios de redacción de preguntas por oposición. Los criterios comunes se definen una sola vez;
 * cada proceso selectivo añade solo lo que le es propio. El Worker los recibe en `guide` y los usa
 * en lugar de un estilo genérico, de modo que nunca se mezclan los criterios de dos oposiciones.
 */
import { activeWorkspace } from '../workspaces';

export interface QuestionProfile {
  /** Se admiten (con moderación) preguntas sobre artículos concretos, como en sus exámenes oficiales. */
  allowArticleStems: boolean;
  guide: string;
}

const COMMON = `CRITERIOS COMUNES DE CALIDAD:
- Cuatro opciones (A-D), una sola correcta según el texto. Redacción natural, clara y precisa, sin trampas lingüísticas.
- Distractores creíbles y homogéneos (forma y longitud parecidas), tomados de otros contenidos del propio temario
  (otro órgano, plazo, sujeto, requisito o consecuencia). Nunca absurdos, evidentes ni de temas ajenos.
- No inventes contenido normativo. No repitas una idea cambiando palabras. No preguntes detalles irrelevantes.
- Proporción orientativa: 70 % conceptos y comprensión (qué es, para qué sirve, quién, qué derechos u obligaciones),
  20 % aplicación práctica con pequeños supuestos realistas («Un empleado… ¿qué debe hacer?»), 10 % detalles
  normativos relevantes (plazos, cifras o requisitos importantes).
- No conviertas cada artículo en una pregunta: prioriza lo que de verdad se evalúa en una oposición.
- Dificultad: facil = conceptos y definiciones básicas; media = obligaciones, competencias, procedimientos y relaciones
  entre conceptos; dificil = diferencias entre conceptos, razonamiento y supuestos prácticos (exigente, no rebuscada).
- Varía la formulación (pregunta directa, frase a completar, supuesto práctico, «¿cuál es correcta/incorrecta?»).
- Explicación breve y didáctica: por qué es correcta, por qué fallan las otras, y la referencia (norma y artículo).
  Los números de artículo van en la explicación, no en el enunciado.
- Distingue el temario GENERAL (conceptos jurídicos y administrativos, organización, derechos y deberes, competencias,
  procedimientos y plazos) del ESPECÍFICO (contenidos técnicos del puesto, responsabilidades y aplicación práctica)
  y adapta el enfoque al bloque al que pertenezca el fragmento.`;

const NO_ARTICLES = `- PROHIBIDO en el enunciado: «¿Qué establece el artículo X?», «¿En qué artículo…?», «Según el artículo X…».
  Pregunta por el contenido, su significado y su aplicación.`;

const PROFILES: Record<string, QuestionProfile> = {
  'puerto-tarragona': {
    allowArticleStems: true,
    guide: `${COMMON}
ESTILO PROPIO (Técnico de Gestión Documental, Autoridad Portuaria de Tarragona). Imita sus exámenes oficiales:
- Enunciados breves que preguntan por el contenido de la norma, a menudo como frase a completar:
  «La Ley 40/2015 tiene por objeto regular:», «Tendrán la consideración de órganos administrativos:».
- Plazos, órganos competentes, requisitos y excepciones son frecuentes; los supuestos prácticos se sitúan en una
  Autoridad Portuaria o en Puertos del Estado.
- Se admiten como última opción «Todas las anteriores son correctas», «Ninguna de las anteriores es correcta» o
  «Las respuestas a) y b) son correctas», con moderación.
- Como en sus exámenes, se admite alguna pregunta sobre un artículo concreto (como máximo 1 de cada 10), siempre
  sobre artículos relevantes; el resto pregunta por el contenido.`,
  },
  'ayto-tarragona-prl': {
    allowArticleStems: false,
    guide: `${COMMON}
${NO_ARTICLES}
- Tampoco aludas al texto en sí («según lo que dice el artículo», «de acuerdo con lo dispuesto», «el texto establece»):
  pregunta directamente por la obligación, el derecho, el concepto o la actuación correcta.
ENFOQUE PROPIO (Técnico de Prevención de Riesgos Laborales, Ayuntamiento de Tarragona). Básate solo en su temario:
- Temario general (régimen local, procedimiento, derechos de la ciudadanía, bienes, presupuesto, igualdad):
  conceptos, competencias municipales, fases y plazos relevantes.
- Temario específico: lo que hace un técnico de PRL en su día a día: evaluación de riesgos y planificación, modalidades
  de organización preventiva, consulta y participación (delegados y comité), formación e información, vigilancia de la
  salud, trabajadores especialmente sensibles y maternidad, coordinación de actividades empresariales, recurso
  preventivo, emergencias e incendios, EPI, equipos de trabajo, señalización, agentes físicos, químicos y biológicos,
  ergonomía, accidentes de trabajo y su investigación.
- Supuestos prácticos realistas en dependencias municipales (brigadas de obras, parques y jardines, oficinas, escuelas,
  policía local, instalaciones deportivas, contratas): «Una contrata de limpieza trabaja en un edificio municipal… ¿qué
  obligación tiene el Ayuntamiento?».
- Evita opciones del tipo «Todas las anteriores…» salvo que la enumeración del texto lo justifique de verdad.`,
  },
  default: {
    allowArticleStems: false,
    guide: `${COMMON}
${NO_ARTICLES}
- Básate solo en el temario y la normativa de esta oposición; no imites exámenes de otros procesos selectivos.
- Los supuestos prácticos se sitúan en el ámbito del puesto convocado (por ejemplo, en un ayuntamiento y sus
  centros de trabajo cuando la oposición es municipal).
- Evita opciones del tipo «Todas las anteriores…» salvo que la enumeración del texto lo justifique de verdad.`,
  },
};

export const questionProfile = (id = activeWorkspace().id): QuestionProfile => PROFILES[id] ?? PROFILES.default;
