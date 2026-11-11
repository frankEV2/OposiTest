# Tutor IA · intermediario seguro (Cloudflare Workers, gratis)

GitHub Pages es estático: la clave de Gemini no puede estar en la web. Este Worker la guarda como secreto y
reenvía a Gemini solo las consultas que llegan desde tu web con tu código de acceso.

## 1. Clave gratuita de Gemini (sin tarjeta)
1. Entra en https://aistudio.google.com con tu cuenta de Google.
2. **Get API key → Create API key** (proyecto nuevo). No actives facturación.
3. Copia la clave. En **Rate limits** verás la cuota gratuita de tu proyecto.

## 2. Worker en Cloudflare (plan Free, sin tarjeta)
1. Crea una cuenta en https://dash.cloudflare.com/sign-up.
2. **Workers & Pages → Create → Create Worker** → nombre `opositest-tutor` → **Deploy**.
3. **Edit code**: borra el contenido, pega `worker/tutor-worker.js` completo → **Deploy**.
4. **Settings → Variables and Secrets → Add**:
   - `GEMINI_API_KEY` · tipo **Secret** · la clave del paso 1.
   - `ACCESS_TOKEN` · tipo **Secret** · un código largo inventado (p. ej. 30 caracteres aleatorios).
   - `ALLOWED_ORIGINS` · tipo **Text** · `https://frankev2.github.io`
   - (opcional) `GEMINI_MODEL` · tipo **Text** · un modelo con cuota gratuita (por defecto `gemini-flash-lite-latest`).
5. Copia la dirección del Worker (`https://opositest-tutor.<tu-subdominio>.workers.dev`).

## 3. En la app
**Tutor IA → Ajustes**: pega la dirección del Worker y el `ACCESS_TOKEN`. Se guardan solo en tu dispositivo
(hazlo una vez en cada dispositivo).

## Seguridad
- La clave de Gemini solo existe en Cloudflare. El navegador nunca la ve.
- El Worker rechaza otros orígenes, peticiones sin el código de acceso y consultas de más de 60 KB.
- Si sospechas que el código se ha filtrado, cambia `ACCESS_TOKEN` en Cloudflare y en la app.
- Cuota gratuita de Gemini: Google puede usar las consultas para mejorar sus productos; no escribas datos personales.
