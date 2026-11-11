/**
 * Voz gratuita del navegador: reconocimiento (Web Speech API: Chrome, Edge, Safari macOS/iOS) y
 * síntesis (speechSynthesis, disponible en todos). Sin servicios externos.
 */

type Rec = {
  lang: string; continuous: boolean; interimResults: boolean; maxAlternatives: number;
  start(): void; stop(): void; abort(): void;
  onresult: ((e: { resultIndex: number; results: ArrayLike<ArrayLike<{ transcript: string }> & { isFinal: boolean }> }) => void) | null;
  onend: (() => void) | null;
  onerror: ((e: { error: string }) => void) | null;
};

const RecCtor = (): (new () => Rec) | undefined =>
  (globalThis as unknown as { SpeechRecognition?: new () => Rec; webkitSpeechRecognition?: new () => Rec }).SpeechRecognition
  ?? (globalThis as unknown as { webkitSpeechRecognition?: new () => Rec }).webkitSpeechRecognition;

export const canListen = () => !!RecCtor();
export const canSpeak = () => typeof speechSynthesis !== 'undefined';

/**
 * Escucha una intervención. Devuelve el texto final (o '' si no se entendió nada).
 * `onPartial` recibe la transcripción provisional mientras se habla.
 */
export function listenOnce(lang: string, onPartial: (t: string) => void): { done: Promise<string>; stop: () => void; abort: () => void } {
  const Ctor = RecCtor();
  if (!Ctor) return { done: Promise.reject(new Error('Reconocimiento de voz no disponible')), stop() {}, abort() {} };
  const rec = new Ctor();
  rec.lang = lang;
  rec.continuous = false; // un turno: termina al hacer una pausa (comportamiento fiable también en iOS)
  rec.interimResults = true;
  rec.maxAlternatives = 1;
  let finalText = '';
  let interim = '';
  const done = new Promise<string>((resolve, reject) => {
    rec.onresult = (e) => {
      interim = '';
      for (let i = e.resultIndex; i < e.results.length; i++) {
        const r = e.results[i];
        if (r.isFinal) finalText += r[0].transcript; else interim += r[0].transcript;
      }
      onPartial(`${finalText}${interim}`.trim());
    };
    rec.onerror = (e) => {
      if (e.error === 'no-speech' || e.error === 'aborted') return; // se resuelve en onend
      reject(new Error(e.error === 'not-allowed' || e.error === 'service-not-allowed'
        ? 'Permiso de micrófono denegado. Actívalo en los ajustes del navegador.'
        : `Error de reconocimiento de voz (${e.error})`));
    };
    rec.onend = () => resolve(`${finalText || interim}`.trim());
  });
  rec.start();
  return { done, stop: () => rec.stop(), abort: () => rec.abort() };
}

/** Texto apto para leer en voz alta: sin marcas de formato ni referencias entre corchetes. */
export function speakable(md: string): string {
  return md
    .replace(/\[[^\]]{2,120}\]/g, '')
    .replace(/(?<!\p{L})arts?\.\s*/giu, (m) => (/s/i.test(m) ? 'artículos ' : 'artículo '))
    .replace(/[*_#`>]/g, '')
    .replace(/^\s*[-•]\s+/gm, '')
    .replace(/\s+([.,;:])/g, '$1')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

function pickVoice(lang: string): SpeechSynthesisVoice | undefined {
  const voices = speechSynthesis.getVoices();
  const base = lang.slice(0, 2);
  return voices.find((v) => v.lang === lang && /Google|Premium|Enhanced|Mejorada|Natural/i.test(v.name))
    ?? voices.find((v) => v.lang === lang)
    ?? voices.find((v) => v.lang.startsWith(base));
}

/**
 * Cola de lectura: se le van añadiendo frases según llega la respuesta (empieza a hablar antes de
 * que termine) y avisa cuando se ha leído todo.
 */
export class Speaker {
  private queue: string[] = [];
  private speaking = false;
  private idleResolvers: (() => void)[] = [];
  muted = false;
  rate = 1.05;
  constructor(public lang: string) {}

  /** iOS solo permite hablar tras un gesto: se llama desde el botón «Iniciar». */
  unlock() {
    if (!canSpeak()) return;
    const u = new SpeechSynthesisUtterance(' ');
    u.volume = 0;
    speechSynthesis.speak(u);
  }

  push(text: string) {
    const t = speakable(text);
    if (!t || this.muted || !canSpeak()) return;
    this.queue.push(t);
    if (!this.speaking) this.next();
  }

  private next() {
    const t = this.queue.shift();
    if (t === undefined) {
      this.speaking = false;
      this.idleResolvers.splice(0).forEach((r) => r());
      return;
    }
    this.speaking = true;
    const u = new SpeechSynthesisUtterance(t);
    u.lang = this.lang;
    u.rate = this.rate;
    const v = pickVoice(this.lang);
    if (v) u.voice = v;
    u.onend = () => this.next();
    u.onerror = () => this.next();
    speechSynthesis.speak(u);
  }

  /** Espera a que termine de leer lo pendiente. */
  idle(): Promise<void> {
    return this.speaking || this.queue.length ? new Promise((r) => this.idleResolvers.push(r)) : Promise.resolve();
  }

  /** Interrumpe la lectura (p. ej. cuando el usuario quiere hablar). */
  cancel() {
    this.queue = [];
    if (canSpeak()) speechSynthesis.cancel();
    this.speaking = false;
    this.idleResolvers.splice(0).forEach((r) => r());
  }

  pause() { if (canSpeak()) speechSynthesis.pause(); }
  resume() { if (canSpeak()) speechSynthesis.resume(); }
}

/** Divide el texto que va llegando en frases completas (para empezar a leer cuanto antes). */
const ABBR = /(?:^|[\s(])(?:art|arts|núm|apdo|apdos|pág|sr|sra|etc|ej|p\.ej|d|dª|admón|r\.d|rd|l\.o)$/i;

export function takeSentences(full: string, from: number): { sentences: string[]; next: number } {
  const sentences: string[] = [];
  let start = from;
  for (let i = from; i < full.length; i++) {
    const ch = full[i];
    let end = -1;
    if (ch === '\n') end = i + 1;
    else if ('.!?'.includes(ch)) {
      const after = full[i + 1];
      if (after === undefined) break; // aún puede llegar más texto ("5." → "5.3")
      if (!/\s/.test(after)) continue; // "5.3", "39/2015." seguido de texto…
      if (ch === '.' && ABBR.test(full.slice(start, i))) continue; // "art. 5"
      end = i + 1;
    }
    if (end > 0) {
      const s = full.slice(start, end);
      if (s.trim()) sentences.push(s);
      start = end;
    }
  }
  return { sentences, next: start };
}
