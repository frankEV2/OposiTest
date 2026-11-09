/** Almacenamiento remoto mínimo que necesita la sincronización (Google Drive u otro). */
export interface RemoteStore {
  /** Nombres de los ficheros existentes. */
  list(): Promise<string[]>;
  read(name: string): Promise<Blob | null>;
  write(name: string, data: Blob): Promise<void>;
}

/** Implementación en memoria (pruebas). */
export class MemoryRemote implements RemoteStore {
  files = new Map<string, Blob>();
  async list() { return [...this.files.keys()]; }
  async read(name: string) { return this.files.get(name) ?? null; }
  async write(name: string, data: Blob) { this.files.set(name, data); }
}
