/** Extracción de texto independiente del entorno: recibe el módulo PDF.js (navegador o Node). */

interface TextItemLike {
  str: string;
  hasEOL?: boolean;
  transform?: number[];
}

interface PdfjsLike {
  getDocument(src: { data: Uint8Array }): {
    promise: Promise<{
      numPages: number;
      getPage(n: number): Promise<{ getTextContent(): Promise<{ items: unknown[] }>; cleanup(): void }>;
      getMetadata(): Promise<{ info: unknown }>;
    }>;
    destroy(): Promise<void>;
  };
}

/** Extrae el texto de cada página respetando los saltos de línea. */
export async function extractWith(
  pdfjs: PdfjsLike,
  data: ArrayBuffer,
  onProgress?: (page: number, total: number) => void,
): Promise<{ pages: string[]; title?: string }> {
  const task = pdfjs.getDocument({ data: new Uint8Array(data) });
  const pdf = await task.promise;
  const pages: string[] = [];
  try {
    for (let i = 1; i <= pdf.numPages; i++) {
      const page = await pdf.getPage(i);
      const content = await page.getTextContent();
      let text = '';
      let lastY: number | undefined;
      for (const raw of content.items as TextItemLike[]) {
        if (typeof raw.str !== 'string') continue;
        const y = raw.transform?.[5];
        if (lastY !== undefined && y !== undefined && Math.abs(y - lastY) > 2 && !text.endsWith('\n')) {
          text += '\n';
        }
        text += raw.str;
        // PDF.js marca fin de línea también en elementos vacíos: evitar líneas en blanco espurias.
        if (raw.hasEOL && !text.endsWith('\n')) text += '\n';
        if (y !== undefined) lastY = y;
      }
      pages.push(text);
      page.cleanup();
      onProgress?.(i, pdf.numPages);
    }
    const meta = await pdf.getMetadata().catch(() => null);
    const title = (meta?.info as { Title?: string } | undefined)?.Title?.trim() || undefined;
    return { pages, title };
  } finally {
    await task.destroy();
  }
}
