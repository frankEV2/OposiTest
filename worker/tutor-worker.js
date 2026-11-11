/**
 * OposiTest · Tutor IA — intermediario seguro entre la app (GitHub Pages) y la API de Gemini.
 * Se despliega en Cloudflare Workers (plan gratuito). La clave de Gemini NUNCA llega al navegador.
 *
 * Variables (Settings → Variables and Secrets del Worker):
 *   GEMINI_API_KEY   (secreto)  clave de Google AI Studio (cuota gratuita, sin tarjeta)
 *   ACCESS_TOKEN     (secreto)  código de acceso que escribirás en la app; impide que otros gasten tu cuota
 *   ALLOWED_ORIGINS  (texto)    p. ej. "https://frankev2.github.io,http://localhost:4173"
 *   GEMINI_MODEL     (texto, opcional) modelo gratuito; por defecto "gemini-flash-lite-latest"
 *
 * La app envía: { context: [{ ref, text }], messages: [{ role: 'user'|'model', text }] }
 * El Worker añade las reglas del tutor y devuelve la respuesta de Gemini en streaming (SSE).
 */

const MAX_BODY = 60_000; // bytes por petición: protege la cuota
const MAX_MESSAGES = 24;

const RULES = `Eres un profesor particular de oposiciones, cercano, claro y riguroso.
Reglas obligatorias:
1. Responde ÚNICAMENTE con la información de los FRAGMENTOS DEL TEMARIO que se te dan en cada consulta.
   No uses conocimientos externos ni inventes artículos, plazos, cifras ni normas.
2. Si los fragmentos no contienen la respuesta, dilo claramente ("Esto no aparece en tu temario") y sugiere
   cómo reformular la pregunta o qué tema consultar. No rellenes con información general.
3. Cita entre corchetes la referencia de cada dato, exactamente como aparece en el fragmento, p. ej. [Ley 39/2015, art. 21].
4. Explica con lenguaje comprensible y, cuando ayude, con un ejemplo práctico sencillo basado en el texto.
5. Si te piden un esquema o resumen, hazlo con viñetas breves y fieles al texto.
6. Si te piden preguntas tipo test o un simulacro: plantea UNA pregunta cada vez con cuatro opciones (a, b, c, d),
   una sola correcta y distractores plausibles basados en el temario. Espera la respuesta del alumno; después
   corrígela, explica el porqué con la referencia y continúa con la siguiente si así se pidió.
7. Responde en el idioma del alumno (castellano o catalán). Sé conciso: prioriza lo que pregunta.`;

function cors(origin, env) {
  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const ok = allowed.includes(origin);
  return {
    ok,
    headers: {
      'Access-Control-Allow-Origin': ok ? origin : 'null',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-Tutor-Token',
      'Access-Control-Max-Age': '86400',
      Vary: 'Origin',
    },
  };
}

const json = (status, obj, headers) =>
  new Response(JSON.stringify(obj), { status, headers: { ...headers, 'Content-Type': 'application/json' } });

/** Comparación en tiempo constante del código de acceso. */
function sameToken(a = '', b = '') {
  if (!a || !b || a.length !== b.length) return false;
  let r = 0;
  for (let i = 0; i < a.length; i++) r |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return r === 0;
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    const c = cors(origin, env);
    if (req.method === 'OPTIONS') return new Response(null, { status: c.ok ? 204 : 403, headers: c.headers });
    if (req.method !== 'POST') return json(405, { error: 'Método no permitido' }, c.headers);
    if (!c.ok) return json(403, { error: 'Origen no permitido' }, c.headers);
    if (!sameToken(req.headers.get('X-Tutor-Token') || '', env.ACCESS_TOKEN)) {
      return json(401, { error: 'Código de acceso incorrecto' }, c.headers);
    }
    if (!env.GEMINI_API_KEY) return json(500, { error: 'Falta GEMINI_API_KEY en el Worker' }, c.headers);

    const raw = await req.text();
    if (raw.length > MAX_BODY) return json(413, { error: 'Consulta demasiado grande' }, c.headers);
    let body;
    try { body = JSON.parse(raw); } catch { return json(400, { error: 'JSON no válido' }, c.headers); }
    const context = Array.isArray(body.context) ? body.context.slice(0, 12) : [];
    const messages = Array.isArray(body.messages) ? body.messages.slice(-MAX_MESSAGES) : [];
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return json(400, { error: 'Falta la pregunta' }, c.headers);
    }

    const fragments = context.length
      ? context.map((f, i) => `[${i + 1}] ${String(f.ref).slice(0, 200)}\n${String(f.text).slice(0, 4000)}`).join('\n\n---\n\n')
      : '(No se ha encontrado ningún fragmento relevante en el temario para esta consulta.)';
    const system = `${RULES}\n\nOposición: ${String(body.oposicion || '').slice(0, 200)}\n\nFRAGMENTOS DEL TEMARIO:\n${fragments}`;

    const model = env.GEMINI_MODEL || 'gemini-flash-lite-latest';
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:streamGenerateContent?alt=sse`;
    const upstream = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': env.GEMINI_API_KEY },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: messages.map((m) => ({
          role: m.role === 'model' ? 'model' : 'user',
          parts: [{ text: String(m.text).slice(0, 4000) }],
        })),
        generationConfig: { temperature: 0.3, maxOutputTokens: 1500 },
      }),
    });
    if (!upstream.ok) {
      const detail = await upstream.text();
      const status = upstream.status === 429 ? 429 : 502;
      const msg = upstream.status === 429
        ? 'Se ha agotado la cuota gratuita de Gemini por ahora. Espera un minuto (o hasta mañana si es el límite diario).'
        : `Error de Gemini (${upstream.status})`;
      return json(status, { error: msg, detail: detail.slice(0, 300) }, c.headers);
    }
    return new Response(upstream.body, {
      headers: { ...c.headers, 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-store' },
    });
  },
};
