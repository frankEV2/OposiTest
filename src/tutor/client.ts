/** Conexión con el intermediario (Cloudflare Worker). La clave de Gemini nunca está en el navegador. */
import type { Chunk } from './rag';

export interface ChatMsg {
  role: 'user' | 'model';
  text: string;
  refs?: { ref: string; documentId: number; sectionId: number }[];
  at: number;
  error?: boolean;
}

const URL_KEY = 'opositest.tutorUrl';
const TOKEN_KEY = 'opositest.tutorToken';
const get = (k: string) => { try { return localStorage.getItem(k) ?? ''; } catch { return ''; } };

export const tutorConfig = () => ({ url: get(URL_KEY), token: get(TOKEN_KEY) });
export function saveTutorConfig(url: string, token: string) {
  try { localStorage.setItem(URL_KEY, url.trim()); localStorage.setItem(TOKEN_KEY, token.trim()); } catch { /* sin almacenamiento */ }
}

/** Envía la conversación con los fragmentos recuperados y va devolviendo el texto según llega. */
export async function askTutor(
  oposicion: string, context: Chunk[], history: ChatMsg[],
  onText: (full: string) => void, signal?: AbortSignal,
): Promise<string> {
  const { url, token } = tutorConfig();
  if (!url || !token) throw new Error('Configura primero el Tutor IA (dirección del intermediario y código de acceso).');
  const res = await fetch(url, {
    method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Tutor-Token': token },
    body: JSON.stringify({
      oposicion,
      context: context.map((c) => ({ ref: c.ref, text: c.text })),
      messages: history.filter((m) => !m.error).slice(-12).map((m) => ({ role: m.role, text: m.text })),
    }),
  });
  if (!res.ok || !res.body) {
    const e = await res.json().catch(() => ({}));
    throw new Error(e.error || `Error ${res.status} del intermediario`);
  }
  // SSE de Gemini: líneas "data: {...}" con candidates[0].content.parts[].text
  const reader = res.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = '';
  let full = '';
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buf += value;
    const lines = buf.split('\n');
    buf = lines.pop() ?? '';
    for (const l of lines) {
      if (!l.startsWith('data:')) continue;
      try {
        const j = JSON.parse(l.slice(5));
        const t = (j.candidates?.[0]?.content?.parts ?? []).map((p: { text?: string }) => p.text ?? '').join('');
        if (t) { full += t; onText(full); }
      } catch { /* fragmento incompleto */ }
    }
  }
  if (!full) throw new Error('La IA no ha devuelto respuesta. Inténtalo de nuevo.');
  return full;
}
