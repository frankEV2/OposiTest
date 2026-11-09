import { useState } from 'react';
import { Link } from 'react-router-dom';
import type { Point } from '../stats/stats';

const W = 640;
const H = 220;
const PAD = { l: 32, r: 16, t: 12, b: 28 };
const fmtDate = (t: number) => new Date(t).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
const fmtScore = (n: number) => n.toFixed(2).replace('.', ',');

/** Evolución de la nota (una serie, eje 0–10). SVG propio con tooltip al pasar el ratón. */
export default function ScoreChart({ points }: { points: Point[] }) {
  const [hover, setHover] = useState<number | null>(null);
  if (points.length < 2) return <p className="muted small">Haz al menos dos exámenes para ver la evolución.</p>;

  const iw = W - PAD.l - PAD.r;
  const ih = H - PAD.t - PAD.b;
  const x = (i: number) => PAD.l + (points.length === 1 ? iw / 2 : (i / (points.length - 1)) * iw);
  const y = (v: number) => PAD.t + ih - (v / 10) * ih;
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.score).toFixed(1)}`).join(' ');
  const hp = hover !== null ? points[hover] : null;

  function onMove(e: React.PointerEvent<SVGSVGElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    let best = 0;
    points.forEach((_, i) => { if (Math.abs(x(i) - px) < Math.abs(x(best) - px)) best = i; });
    setHover(best);
  }

  return (
    <div className="chart">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Evolución de la nota de los exámenes"
        onPointerMove={onMove} onPointerLeave={() => setHover(null)}>
        {[0, 5, 10].map((v) => (
          <g key={v}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(v)} y2={y(v)} className={v === 5 ? 'grid mid' : 'grid'} />
            <text x={PAD.l - 8} y={y(v) + 4} className="axis" textAnchor="end">{v}</text>
          </g>
        ))}
        <text x={PAD.l} y={H - 8} className="axis">{fmtDate(points[0].at)}</text>
        <text x={W - PAD.r} y={H - 8} className="axis" textAnchor="end">{fmtDate(points[points.length - 1].at)}</text>
        {hp && <line x1={x(hover!)} x2={x(hover!)} y1={PAD.t} y2={PAD.t + ih} className="crosshair" />}
        <path d={path} className="series" />
        {points.map((p, i) => (
          <circle key={p.examId} cx={x(i)} cy={y(p.score)} r={hover === i ? 6 : 4} className="dot" />
        ))}
      </svg>
      {hp && (
        <div className="tooltip" style={{ left: `${(x(hover!) / W) * 100}%` }}>
          <strong>{fmtScore(hp.score)}</strong> · {hp.percent} % aciertos<br />
          <span className="muted">{fmtDate(hp.at)} · <Link to={`/examen/${hp.examId}/resultado`}>ver</Link></span>
        </div>
      )}
    </div>
  );
}
