/**
 * Google Drive como almacenamiento remoto, en la carpeta privada de la aplicación ("appDataFolder"):
 * solo esta app puede leerla y no aparece entre los archivos del usuario. Permiso mínimo: drive.appdata.
 *
 * Autenticación con Google Identity Services (modelo de token, sin servidor propio). El token dura
 * ~1 hora; se guarda en localStorage para no pedir permiso en cada apertura mientras siga vigente.
 */
import type { RemoteStore } from './remote';

const SCOPE = 'https://www.googleapis.com/auth/drive.appdata';
const GIS_SRC = 'https://accounts.google.com/gsi/client';
const API = 'https://www.googleapis.com/drive/v3';
const UPLOAD = 'https://www.googleapis.com/upload/drive/v3';
const TOKEN_KEY = 'opositest.gdrive.token';

interface StoredToken { value: string; expiresAt: number }

interface TokenResponse { access_token?: string; expires_in?: number; error?: string; error_description?: string }
interface GoogleOAuth {
  initTokenClient(cfg: {
    client_id: string; scope: string; callback: (r: TokenResponse) => void;
    error_callback?: (e: { type: string; message?: string }) => void;
  }): { requestAccessToken(o?: { prompt?: string }): void };
  revoke(token: string, done?: () => void): void;
}
declare global { interface Window { google?: { accounts: { oauth2: GoogleOAuth } } } }

function readToken(): StoredToken | null {
  try {
    const t = JSON.parse(localStorage.getItem(TOKEN_KEY) ?? 'null') as StoredToken | null;
    return t && t.expiresAt > Date.now() + 60_000 ? t : null;
  } catch {
    return null;
  }
}
function writeToken(t: StoredToken | null) {
  try {
    if (t) localStorage.setItem(TOKEN_KEY, JSON.stringify(t)); else localStorage.removeItem(TOKEN_KEY);
  } catch { /* almacenamiento no disponible: el token vive solo en memoria */ }
  memoryToken = t;
}
let memoryToken: StoredToken | null = null;

/** ¿Hay una sesión de Google vigente (sin necesidad de pedir permiso)? */
export const hasValidToken = () => !!(readToken() ?? (memoryToken && memoryToken.expiresAt > Date.now() + 60_000));
const currentToken = () => (readToken() ?? memoryToken)?.value;

let gisLoading: Promise<void> | null = null;
function loadGis(): Promise<void> {
  if (window.google?.accounts?.oauth2) return Promise.resolve();
  gisLoading ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => { gisLoading = null; reject(new Error('No se pudo cargar el inicio de sesión de Google (¿sin conexión?).')); };
    document.head.appendChild(s);
  });
  return gisLoading;
}

/**
 * Pide (o renueva) el permiso de Google. Debe llamarse desde un clic del usuario la primera vez,
 * para que el navegador no bloquee la ventana de Google.
 */
export async function connect(clientId: string): Promise<void> {
  await loadGis();
  await new Promise<void>((resolve, reject) => {
    const client = window.google!.accounts.oauth2.initTokenClient({
      client_id: clientId,
      scope: SCOPE,
      callback: (r) => {
        if (r.error || !r.access_token) { reject(new Error(r.error_description || r.error || 'Permiso denegado')); return; }
        writeToken({ value: r.access_token, expiresAt: Date.now() + (r.expires_in ?? 3600) * 1000 });
        resolve();
      },
      error_callback: (e) => reject(new Error(e.type === 'popup_closed' ? 'Se cerró la ventana de Google antes de terminar.' : e.message || e.type)),
    });
    client.requestAccessToken({ prompt: '' });
  });
}

export async function disconnect(): Promise<void> {
  const t = currentToken();
  writeToken(null);
  if (t && window.google?.accounts?.oauth2) await new Promise<void>((r) => window.google!.accounts.oauth2.revoke(t, r));
}

export class DriveError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

async function call(url: string, init: RequestInit = {}): Promise<Response> {
  const token = currentToken();
  if (!token) throw new DriveError('La sesión de Google ha caducado. Pulsa «Conectar con Google Drive».', 401);
  const res = await fetch(url, { ...init, headers: { ...(init.headers ?? {}), Authorization: `Bearer ${token}` } });
  if (res.status === 401) { writeToken(null); throw new DriveError('La sesión de Google ha caducado. Vuelve a conectar.', 401); }
  if (!res.ok && res.status !== 404) {
    const body = await res.text().catch(() => '');
    throw new DriveError(`Google Drive respondió ${res.status}: ${body.slice(0, 200)}`, res.status);
  }
  return res;
}

/** Carpeta privada de la app en Google Drive. */
export class DriveRemote implements RemoteStore {
  private ids: Map<string, string> | null = null;

  private async index(): Promise<Map<string, string>> {
    if (this.ids) return this.ids;
    const ids = new Map<string, string>();
    let pageToken = '';
    do {
      const q = new URLSearchParams({ spaces: 'appDataFolder', fields: 'nextPageToken,files(id,name)', pageSize: '1000' });
      if (pageToken) q.set('pageToken', pageToken);
      const data = await (await call(`${API}/files?${q}`)).json() as { files: { id: string; name: string }[]; nextPageToken?: string };
      for (const f of data.files) ids.set(f.name, f.id);
      pageToken = data.nextPageToken ?? '';
    } while (pageToken);
    this.ids = ids;
    return ids;
  }

  async list() { return [...(await this.index()).keys()]; }

  async read(name: string): Promise<Blob | null> {
    const id = (await this.index()).get(name);
    if (!id) return null;
    const res = await call(`${API}/files/${id}?alt=media`);
    return res.status === 404 ? null : res.blob();
  }

  async write(name: string, data: Blob): Promise<void> {
    const ids = await this.index();
    const id = ids.get(name);
    if (id) {
      await call(`${UPLOAD}/files/${id}?uploadType=media`, { method: 'PATCH', body: data, headers: { 'Content-Type': data.type || 'application/octet-stream' } });
      return;
    }
    const boundary = `opositest${Math.random().toString(36).slice(2)}`;
    const meta = JSON.stringify({ name, parents: ['appDataFolder'] });
    const body = new Blob([
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${meta}\r\n`,
      `--${boundary}\r\nContent-Type: ${data.type || 'application/octet-stream'}\r\n\r\n`, data,
      `\r\n--${boundary}--`,
    ]);
    const res = await call(`${UPLOAD}/files?uploadType=multipart&fields=id`, {
      method: 'POST', body, headers: { 'Content-Type': `multipart/related; boundary=${boundary}` },
    });
    ids.set(name, ((await res.json()) as { id: string }).id);
  }
}
