// Build "legacy" de PDF.js: incluye polyfills (Map.getOrInsertComputed, Math.sumPrecise, Promise.try…)
// que el build moderno usa sin comprobar y que Safari y versiones no recientes de Chrome no tienen.
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs';
import workerUrl from 'pdfjs-dist/legacy/build/pdf.worker.min.mjs?url';
import { extractWith } from './extractCore';

// Worker servido localmente por Vite (sin CDN).
pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export function extractPdfPages(data: ArrayBuffer, onProgress?: (page: number, total: number) => void) {
  return extractWith(pdfjs as never, data, onProgress);
}
