import Dexie, { type EntityTable, type Table } from 'dexie';
import type {
  Attempt,
  Deletion,
  DocumentFile,
  DocumentMeta,
  DocumentPage,
  Exam,
  Materia,
  Oposicion,
  Question,
  ReviewItem,
  Section,
  Setting,
  StudyMaterial,
  StudySession,
  Tema,
} from './types';

export class OposiDB extends Dexie {
  oposiciones!: EntityTable<Oposicion, 'id'>;
  materias!: EntityTable<Materia, 'id'>;
  temas!: EntityTable<Tema, 'id'>;
  documents!: EntityTable<DocumentMeta, 'id'>;
  documentFiles!: Table<DocumentFile, number>;
  pages!: EntityTable<DocumentPage, 'id'>;
  sections!: EntityTable<Section, 'id'>;
  questions!: EntityTable<Question, 'id'>;
  exams!: EntityTable<Exam, 'id'>;
  attempts!: EntityTable<Attempt, 'id'>;
  reviews!: Table<ReviewItem, number>;
  materials!: EntityTable<StudyMaterial, 'id'>;
  sessions!: EntityTable<StudySession, 'id'>;
  settings!: Table<Setting, string>;
  deletions!: Table<Deletion, string>;

  constructor(name = 'opositest') {
    super(name);
    this.version(1).stores({
      oposiciones: '++id, &name',
      materias: '++id, oposicionId, [oposicionId+name]',
      temas: '++id, materiaId, [materiaId+name]',
      documents: '++id, &sha256, oposicionId, materiaId, temaId, importedAt',
      documentFiles: 'documentId',
      pages: '++id, documentId, [documentId+page]',
      sections: '++id, documentId, parentId, kind, [documentId+order]',
      questions: '++id, &hash, documentId, sectionId, temaId, status, difficulty, rule',
      exams: '++id, startedAt, finishedAt',
      attempts: '++id, examId, questionId, answeredAt',
      reviews: 'questionId, due',
      materials: '++id, documentId, kind',
      sessions: '++id, startedAt',
      settings: 'key',
    });
    // v2: registro de borrados para la sincronización entre dispositivos.
    this.version(2).stores({ deletions: 'key' });
  }
}

export const db = new OposiDB();
