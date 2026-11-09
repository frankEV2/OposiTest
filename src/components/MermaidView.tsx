import { useEffect, useRef, useState } from 'react';

let counter = 0;

/**
 * Renderiza código Mermaid (librería cargada bajo demanda, sin red).
 * Los nodos con id `s<número>` son clicables y llaman a `onNodeClick(número)`.
 */
export default function MermaidView({ code, onNodeClick }: { code: string; onNodeClick?: (sectionId: number) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setError('');
    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const dark = document.documentElement.dataset.theme === 'dark' ||
          (!document.documentElement.dataset.theme && matchMedia('(prefers-color-scheme: dark)').matches);
        mermaid.initialize({
          startOnLoad: false, securityLevel: 'strict', theme: dark ? 'dark' : 'default',
          flowchart: { htmlLabels: true, curve: 'basis' }, maxTextSize: 200_000,
        });
        const { svg } = await mermaid.render(`mmd-${++counter}`, code);
        if (!alive || !ref.current) return;
        ref.current.innerHTML = svg;
        const el = ref.current.querySelector('svg');
        if (el) { el.style.maxWidth = 'none'; el.removeAttribute('height'); }
        if (onNodeClick) {
          ref.current.querySelectorAll<SVGGElement>('g.node').forEach((g) => {
            const m = g.id.match(/-s(\d+)-/);
            if (!m) return;
            g.style.cursor = 'pointer';
            g.addEventListener('click', () => onNodeClick(Number(m[1])));
          });
        }
      } catch (e) {
        if (alive) setError((e as Error).message);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => { alive = false; };
  }, [code, onNodeClick]);

  return (
    <div>
      <div className="row no-print" style={{ marginBottom: 8 }}>
        <button onClick={() => setZoom((z) => Math.max(0.3, z - 0.2))} aria-label="Alejar">−</button>
        <span className="muted small">{Math.round(zoom * 100)} %</span>
        <button onClick={() => setZoom((z) => Math.min(3, z + 0.2))} aria-label="Acercar">+</button>
        <button onClick={() => setZoom(1)}>100 %</button>
        {loading && <span className="muted small">Dibujando mapa…</span>}
      </div>
      {error && <p className="error">No se pudo dibujar el mapa: {error}</p>}
      <div className="map-scroll">
        <div ref={ref} style={{ transform: `scale(${zoom})`, transformOrigin: '0 0' }} />
      </div>
    </div>
  );
}
