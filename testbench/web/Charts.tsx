import { useState } from 'react';

// Single-series charts: one hue (validated default blue), recessive grid, hover tooltip.
const SERIES = '#2a78d6';
const GRID = '#e1e0d9';
const MUTED = '#898781';

const W = 560;
const H = 180;
const PAD = { l: 48, r: 12, t: 12, b: 26 };

function niceMax(v: number) {
  if (v <= 0) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 2, 2.5, 5, 10]) if (v <= m * p) return m * p;
  return 10 * p;
}

function fmt(v: number) {
  return v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}k` : v >= 10 ? v.toFixed(0) : v.toFixed(1);
}

export function LineChart(props: { title: string; unit: string; points: { x: number; y: number }[]; xUnit: string }) {
  const [hover, setHover] = useState<number>();
  const pts = props.points;
  const xMax = Math.max(1, ...pts.map((p) => p.x));
  const yMax = niceMax(Math.max(0, ...pts.map((p) => p.y)));
  const sx = (x: number) => PAD.l + (x / xMax) * (W - PAD.l - PAD.r);
  const sy = (y: number) => H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b);
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * yMax);
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join('');
  const h = hover === undefined ? undefined : pts[hover];

  return (
    <figure className="chart">
      <figcaption>{props.title}</figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        role="img"
        aria-label={props.title}
        onMouseLeave={() => setHover(undefined)}
        onMouseMove={(e) => {
          if (!pts.length) return;
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W;
          let best = 0;
          for (let i = 1; i < pts.length; i++) if (Math.abs(sx(pts[i]!.x) - x) < Math.abs(sx(pts[best]!.x) - x)) best = i;
          setHover(best);
        }}
      >
        {ticks.map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(t)} y2={sy(t)} stroke={GRID} strokeWidth={1} />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
              {fmt(t)}
            </text>
          </g>
        ))}
        <text x={W - PAD.r} y={H - 6} textAnchor="end" fontSize={10} fill={MUTED}>
          {xMax}
          {props.xUnit}
        </text>
        <text x={PAD.l} y={H - 6} fontSize={10} fill={MUTED}>
          0{props.xUnit}
        </text>
        {pts.length > 1 && <path d={path} fill="none" stroke={SERIES} strokeWidth={2} strokeLinejoin="round" />}
        {pts.length === 1 && <circle cx={sx(pts[0]!.x)} cy={sy(pts[0]!.y)} r={4} fill={SERIES} />}
        {h && (
          <g>
            <line x1={sx(h.x)} x2={sx(h.x)} y1={PAD.t} y2={H - PAD.b} stroke={MUTED} strokeDasharray="3 3" />
            <circle cx={sx(h.x)} cy={sy(h.y)} r={4.5} fill={SERIES} stroke="#fcfcfb" strokeWidth={2} />
          </g>
        )}
      </svg>
      {h && (
        <div className="chart-tip" style={{ left: `${(sx(h.x) / W) * 100}%` }}>
          <strong>
            {fmt(h.y)} {props.unit}
          </strong>
          <span>
            at {h.x}
            {props.xUnit}
          </span>
        </div>
      )}
    </figure>
  );
}

/** Reference categorical order (light surface); colour follows the entity's fixed slot, never rank. */
export const CATEGORICAL = ['#2a78d6', '#eb6834', '#1baf7a', '#eda100', '#e87ba4', '#008300', '#6250d6', '#e34948'];

export interface Series {
  key: string;
  label: string;
  color: string;
  /** y = null leaves a gap (no samples that second). */
  points: { x: number; y: number | null; n?: number }[];
}

/** Percentage-over-time lines (0–100 %), legend always, direct end labels when ≤ 4 series. */
export function PercentLinesChart(props: { title: string; series: Series[]; xMax: number; height?: number }) {
  const [hoverX, setHoverX] = useState<number>();
  const H2 = props.height ?? 220;
  const right = props.series.length <= 4 ? 90 : PAD.r;
  const W2 = 1100;
  const xMax = Math.max(1, props.xMax);
  const sx = (x: number) => PAD.l + (x / xMax) * (W2 - PAD.l - right);
  const sy = (y: number) => H2 - PAD.b - (y / 100) * (H2 - PAD.t - PAD.b);
  const xs = [...new Set(props.series.flatMap((s) => s.points.map((p) => p.x)))].sort((a, b) => a - b);

  const pathOf = (pts: Series['points']) => {
    let d = '';
    let pen = false;
    for (const p of pts) {
      if (p.y === null) {
        pen = false;
        continue;
      }
      d += `${pen ? 'L' : 'M'}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`;
      pen = true;
    }
    return d;
  };

  const hoverRows =
    hoverX === undefined
      ? []
      : props.series
          .map((s) => ({ s, p: s.points.find((p) => p.x === hoverX) }))
          .filter((r) => r.p && r.p.y !== null);

  return (
    <figure className="chart wide">
      <figcaption>{props.title}</figcaption>
      <div className="legend">
        {props.series.map((s) => (
          <span key={s.key}>
            <i style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </div>
      <svg
        viewBox={`0 0 ${W2} ${H2}`}
        role="img"
        aria-label={props.title}
        onMouseLeave={() => setHoverX(undefined)}
        onMouseMove={(e) => {
          if (!xs.length) return;
          const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect();
          const x = ((e.clientX - r.left) / r.width) * W2;
          let best = xs[0]!;
          for (const v of xs) if (Math.abs(sx(v) - x) < Math.abs(sx(best) - x)) best = v;
          setHoverX(best);
        }}
      >
        {[0, 25, 50, 75, 100].map((t) => (
          <g key={t}>
            <line x1={PAD.l} x2={W2 - right} y1={sy(t)} y2={sy(t)} stroke={GRID} />
            <text x={PAD.l - 6} y={sy(t) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
              {t}%
            </text>
          </g>
        ))}
        <text x={PAD.l} y={H2 - 6} fontSize={10} fill={MUTED}>
          0s
        </text>
        <text x={W2 - right} y={H2 - 6} textAnchor="end" fontSize={10} fill={MUTED}>
          {xMax}s
        </text>
        {props.series.map((s) => (
          <path key={s.key} d={pathOf(s.points)} fill="none" stroke={s.color} strokeWidth={2} strokeLinejoin="round" />
        ))}
        {props.series.length <= 4 &&
          props.series.map((s) => {
            const last = [...s.points].reverse().find((p) => p.y !== null);
            return (
              last && (
                <text key={s.key} x={sx(last.x) + 6} y={sy(last.y!) + 4} fontSize={11} fill="#52514e">
                  {s.label} {Math.round(last.y!)}%
                </text>
              )
            );
          })}
        {hoverX !== undefined && (
          <g>
            <line x1={sx(hoverX)} x2={sx(hoverX)} y1={PAD.t} y2={H2 - PAD.b} stroke={MUTED} strokeDasharray="3 3" />
            {hoverRows.map(({ s, p }) => (
              <circle key={s.key} cx={sx(p!.x)} cy={sy(p!.y!)} r={4.5} fill={s.color} stroke="#fcfcfb" strokeWidth={2} />
            ))}
          </g>
        )}
      </svg>
      {hoverX !== undefined && hoverRows.length > 0 && (
        <div className="chart-tip" style={{ left: `${(sx(hoverX) / W2) * 100}%` }}>
          <span>at {hoverX}s</span>
          {hoverRows.map(({ s, p }) => (
            <span key={s.key} className="tip-row">
              <i style={{ background: s.color }} />
              {s.label}: <strong>{p!.y!.toFixed(1)}% ON</strong> <span className="muted">(n={p!.n})</span>
            </span>
          ))}
        </div>
      )}
    </figure>
  );
}

export function HistogramChart(props: { title: string; buckets: { upToMs: number; count: number }[] }) {
  const [hover, setHover] = useState<number>();
  const b = props.buckets;
  const total = b.reduce((s, x) => s + x.count, 0) || 1;
  const yMax = niceMax(Math.max(0, ...b.map((x) => x.count)));
  const slot = (W - PAD.l - PAD.r) / Math.max(1, b.length);
  const barW = Math.max(2, slot - 2); // 2px surface gap between bars
  const sy = (y: number) => H - PAD.b - (y / yMax) * (H - PAD.t - PAD.b);
  const h = hover === undefined ? undefined : b[hover];
  const lower = (i: number) => (i === 0 ? 0 : b[i - 1]!.upToMs);

  return (
    <figure className="chart">
      <figcaption>{props.title}</figcaption>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={props.title} onMouseLeave={() => setHover(undefined)}>
        {[0, 0.5, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={sy(f * yMax)} y2={sy(f * yMax)} stroke={GRID} />
            <text x={PAD.l - 6} y={sy(f * yMax) + 4} textAnchor="end" fontSize={10} fill={MUTED}>
              {fmt(f * yMax)}
            </text>
          </g>
        ))}
        {b.map((x, i) => {
          const top = sy(x.count);
          const height = H - PAD.b - top;
          const left = PAD.l + i * slot + 1;
          return (
            <g key={x.upToMs} onMouseEnter={() => setHover(i)}>
              {/* Hit target spans the full slot height, bigger than the mark. */}
              <rect x={left - 1} y={PAD.t} width={slot} height={H - PAD.t - PAD.b} fill="transparent" />
              {height > 0 && (
                <path
                  d={`M${left},${H - PAD.b}V${top + Math.min(4, height)}q0,-${Math.min(4, height)} ${Math.min(4, barW / 2)},-${Math.min(4, height)}H${left + barW - Math.min(4, barW / 2)}q${Math.min(4, barW / 2)},0 ${Math.min(4, barW / 2)},${Math.min(4, height)}V${H - PAD.b}Z`}
                  fill={SERIES}
                  opacity={hover === undefined || hover === i ? 1 : 0.55}
                />
              )}
              {(i % Math.ceil(b.length / 8) === 0 || i === b.length - 1) && (
                <text x={left + barW / 2} y={H - 8} textAnchor="middle" fontSize={10} fill={MUTED}>
                  ≤{x.upToMs}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      {h && hover !== undefined && (
        <div className="chart-tip" style={{ left: `${((PAD.l + hover * slot + slot / 2) / W) * 100}%` }}>
          <strong>{h.count.toLocaleString()} requests</strong>
          <span>
            {lower(hover)}–{h.upToMs} ms · {((h.count / total) * 100).toFixed(1)}%
          </span>
        </div>
      )}
    </figure>
  );
}
