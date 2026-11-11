import { useEffect, useState } from 'react';
import { usageInfo } from '../tutor/usage';

/** Uso de hoy de la cuota gratuita de Gemini y cuándo se repone (aproximado: solo este dispositivo). */
export default function GeminiUsage() {
  const [u, setU] = useState(usageInfo);
  useEffect(() => { const t = setInterval(() => setU(usageInfo()), 30_000); return () => clearInterval(t); }, []);
  const hora = u.resetAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return (
    <details className="usage">
      <summary>
        Cuota gratuita de Gemini hoy: <strong>{u.total}</strong> consultas desde este dispositivo
        {u.quotaHitToday ? ' · ⚠ agotada en algún momento' : ''} · se repone en {u.resetIn} ({hora})
      </summary>
      <p className="muted small">
        Tutor: {u.chat} · Generación de preguntas: {u.questions}. Google no informa de cuántas consultas quedan:
        el límite exacto y el uso de todos tus dispositivos se ven en <a href="https://aistudio.google.com/usage"
        target="_blank" rel="noopener noreferrer">Google AI Studio → Usage</a>. El límite por minuto se repone cada minuto;
        el diario, a medianoche de California ({hora} hora local).
      </p>
    </details>
  );
}
