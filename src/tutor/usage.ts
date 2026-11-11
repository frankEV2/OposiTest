/**
 * Uso aproximado de la cuota gratuita de Gemini. La API no informa de lo que queda: se cuentan las consultas
 * hechas desde este dispositivo en el «día de Google» (la cuota diaria se repone a medianoche, hora del Pacífico).
 */
const KEY = 'opositest.geminiUsage';

/** Fecha y segundos transcurridos del día en la zona horaria del Pacífico. */
function pacificNow(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
  }).formatToParts(now).map((p) => [p.type, p.value]));
  return { day: `${parts.year}-${parts.month}-${parts.day}`, secs: +parts.hour * 3600 + +parts.minute * 60 + +parts.second };
}

function read(): { day: string; chat: number; questions: number; quotaHit?: number } {
  try {
    const v = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (v && v.day === pacificNow().day) return v;
  } catch { /* sin almacenamiento */ }
  return { day: pacificNow().day, chat: 0, questions: 0 };
}
const write = (v: ReturnType<typeof read>) => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch { /* */ } };

/** Anota una consulta a Gemini (chat del tutor o generación de preguntas). */
export function recordUse(kind: 'chat' | 'questions') {
  const v = read();
  v[kind]++;
  write(v);
}
/** Anota que Google ha respondido «cuota agotada». */
export function recordQuotaHit() { const v = read(); v.quotaHit = Date.now(); write(v); }

export interface UsageInfo { chat: number; questions: number; total: number; resetAt: Date; resetIn: string; quotaHitToday: boolean }

export function usageInfo(now = new Date()): UsageInfo {
  const v = read();
  const ms = (86400 - pacificNow(now).secs) * 1000;
  const h = Math.floor(ms / 3_600_000);
  const m = Math.floor((ms % 3_600_000) / 60_000);
  return {
    chat: v.chat, questions: v.questions, total: v.chat + v.questions,
    resetAt: new Date(now.getTime() + ms), resetIn: h ? `${h} h ${m} min` : `${m} min`, quotaHitToday: !!v.quotaHit,
  };
}
