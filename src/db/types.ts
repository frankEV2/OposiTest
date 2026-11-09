/**
 * Modelo de datos de OposiTest.
 * Se define completo desde la fase 1 para evitar migraciones frecuentes;
 * cada fase rellena las tablas que le corresponden.
 */

export type ID = number;

/** Taxonomía: Oposición > Materia > Tema */
export interface Oposicion {
  id?: ID;
  name: string;
  createdAt: number;
}


export interface Materia {
  id?: ID;
  oposicionId: ID;
  name: string;
  order: number;
  createdAt?: number;
}

export interface Tema {
  id?: ID;
  materiaId: ID;
  name: string;
  order: number;
  createdAt?: number;
}

/** Calidad de la extracción de texto del PDF (fase 2). */
export type ExtractionStatus = 'pending' | 'ok' | 'partial' | 'scanned' | 'error';

export interface DocumentMeta {
  id?: ID;
  title: string;
  fileName: string;
  size: number;
  /** SHA-256 del fichero para detectar duplicados. */
  sha256: string;
  /** Identificador estable para sincronizar (SHA-256 original; no cambia al sustituir el PDF). */
  uid?: string;
  pageCount: number;
  oposicionId?: ID;
  materiaId?: ID;
  temaId?: ID;
  extraction: ExtractionStatus;
  /** Avisos de extracción mostrados al usuario. */
  warnings: string[];
  importedAt: number;
  updatedAt: number;
}

/** Fichero PDF original, separado para no cargar blobs al listar. */
export interface DocumentFile {
  documentId: ID;
  blob: Blob;
}

export interface DocumentPage {
  id?: ID;
  documentId: ID;
  page: number;
  text: string;
}

export type SectionKind =
  | 'libro'
  | 'titulo'
  | 'capitulo'
  | 'seccion'
  | 'articulo'
  | 'apartado'
  | 'disposicion'
  | 'anexo'
  | 'preambulo';

/** Unidad estructural detectada en un documento (artículo, título...). */
export interface Section {
  id?: ID;
  documentId: ID;
  parentId?: ID;
  kind: SectionKind;
  /** Ej.: "Artículo 21", "Disposición adicional primera". */
  label: string;
  heading: string;
  text: string;
  order: number;
  pageStart: number;
}

export type QuestionStatus = 'pending' | 'validated' | 'rejected';
export type Difficulty = 1 | 2 | 3;
export type QuestionRule =
  | 'definicion'
  | 'plazo'
  | 'competencia'
  | 'obligacion'
  | 'excepcion'
  | 'enumeracion'
  | 'concepto'
  | 'manual';

export interface Question {
  id?: ID;
  /** Hash normalizado de enunciado + respuesta correcta: evita duplicados. */
  hash: string;
  /** Identificador estable para sincronizar (hash original; no cambia al editar). */
  uid?: string;
  documentId?: ID;
  sectionId?: ID;
  temaId?: ID;
  stem: string;
  options: [string, string, string, string];
  correctIndex: 0 | 1 | 2 | 3;
  explanation: string;
  /** Referencia legible: "Ley 39/2015, art. 21.2". */
  reference: string;
  /** Fragmento literal del documento que justifica la respuesta. */
  sourceExcerpt: string;
  difficulty: Difficulty;
  status: QuestionStatus;
  rule: QuestionRule;
  createdAt: number;
  updatedAt: number;
}

export type ExamMode = 'estudio' | 'simulacro';

export interface ExamConfig {
  mode: ExamMode;
  count: 5 | 10 | 20 | 30 | 50 | 100;
  documentIds: ID[];
  temaIds: ID[];
  sectionIds: ID[];
  difficulties: Difficulty[];
  /** 'new' = no realizadas, 'seen' = ya realizadas, 'all' = todas. */
  pool: 'all' | 'new' | 'seen';
  shuffle: boolean;
  timeLimitSec?: number;
  /** Fracción de acierto que resta cada error (p. ej. 1/3). */
  penalty: number;
  /** Incluir preguntas generadas aún sin revisar. */
  includePending: boolean;
}

export interface Exam {
  id?: ID;
  config: ExamConfig;
  questionIds: ID[];
  /** Orden de presentación de las opciones por pregunta (índices originales). */
  orders: number[][];
  /** Índice ORIGINAL elegido por pregunta, null = en blanco. */
  answers: (number | null)[];
  startedAt: number;
  finishedAt?: number;
  durationSec?: number;
  correct?: number;
  wrong?: number;
  blank?: number;
  /** Nota sobre 10 tras penalización. */
  score?: number;
}

/** Respuesta individual, base de estadísticas y de "Mis errores". */
export interface Attempt {
  id?: ID;
  examId: ID;
  questionId: ID;
  chosenIndex: number | null;
  correct: boolean;
  answeredAt: number;
}

/** Estado de repetición espaciada (Leitner/SM-2 simplificado). */
export interface ReviewItem {
  questionId: ID;
  box: number;
  due: number;
  lapses: number;
  lastReviewed?: number;
}

export type MaterialKind = 'esquema' | 'resumen' | 'mapa' | 'fichas';

export interface StudyMaterial {
  id?: ID;
  documentId: ID;
  sectionIds: ID[];
  kind: MaterialKind;
  level?: 'breve' | 'medio' | 'completo';
  /** Markdown, código Mermaid o JSON de fichas según `kind`. */
  content: string;
  createdAt: number;
}

export interface StudySession {
  id?: ID;
  startedAt: number;
  endedAt: number;
  activity: 'examen' | 'repaso' | 'lectura' | 'material';
}

/** Registro de un borrado, para propagarlo a otros dispositivos al sincronizar. */
export interface Deletion {
  /** "doc:<uid>", "q:<uid>", "rev:<uid pregunta>", "tax:<ruta>" */
  key: string;
  deletedAt: number;
}

export interface Setting {
  key: string;
  value: unknown;
}
