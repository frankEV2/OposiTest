import { activeWorkspace } from '../workspaces';
import { db } from '../db/db';
import { clearSearchCache } from '../library/search';
import type { RemoteStore } from './remote';
import { applySnapshot, buildSnapshot, type ApplyDeps, type ApplyReport } from './snapshot';

export const STATE_FILE = activeWorkspace().syncFile;
export const pdfName = (sha256: string) => `pdf-${sha256}.pdf`;

export interface SyncResult extends ApplyReport {
  uploadedPdfs: number;
  at: number;
}

let running: Promise<SyncResult> | null = null;

/**
 * Sincroniza con el almacenamiento remoto:
 *  1. descarga el estado remoto y lo fusiona con el local (trayendo los PDF que falten),
 *  2. sube los PDF locales que no estén en remoto,
 *  3. sube el estado fusionado.
 * Si dos sincronizaciones se lanzan a la vez en esta pestaña, la segunda espera a la primera.
 */
export function syncNow(remote: RemoteStore, extract?: ApplyDeps['extract']): Promise<SyncResult> {
  running ??= run(remote, extract).finally(() => { running = null; });
  return running;
}

async function run(remote: RemoteStore, extract?: ApplyDeps['extract']): Promise<SyncResult> {
  const empty: ApplyReport = { added: {}, updated: {}, deleted: {}, failed: [] };
  const state = await remote.read(STATE_FILE);
  const report = state
    ? await applySnapshot(JSON.parse(await state.text()), { fetchPdf: (sha) => remote.read(pdfName(sha)), extract })
    : empty;

  const remoteNames = new Set(await remote.list());
  let uploadedPdfs = 0;
  for (const d of await db.documents.toArray()) {
    if (remoteNames.has(pdfName(d.sha256))) continue;
    const f = await db.documentFiles.get(d.id!);
    if (!f) continue;
    await remote.write(pdfName(d.sha256), f.blob);
    uploadedPdfs++;
  }
  const at = Date.now();
  await remote.write(STATE_FILE, new Blob([JSON.stringify(await buildSnapshot(at))], { type: 'application/json' }));
  await db.settings.put({ key: 'lastSyncAt', value: at });
  clearSearchCache();
  return { ...report, uploadedPdfs, at };
}
