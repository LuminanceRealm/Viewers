import React, { useEffect, useMemo, useRef, useState } from 'react';

export interface ChartPoint {
  x: number;
  /** Realce relativo (%); null = fase sin dato. */
  y: number | null;
  /** Media cruda, para el tooltip. */
  raw: number | null;
  /** Fase marcada por movimiento. */
  flagged?: boolean;
}

export interface ChartSeries {
  id: number;
  label: string;
  color: string;
  points: ChartPoint[];
}

export interface KineticsChartProps {
  series: ChartSeries[];
  /** Etiqueta por posición en x (misma longitud que los puntos). */
  xLabels: string[];
  xAxisLabel: string;
  height?: number;
}

const MARGIN = { top: 12, right: 12, bottom: 30, left: 40 };
const SURFACE = '#000000';
const GRID = '#2a2f3a';
const INK = '#cfd6e2';
const MUTED = '#8a93a3';

function niceTicks(min: number, max: number, count = 4): number[] {
  if (!(max > min)) {
    return [min];
  }
  const span = max - min;
  const rough = span / count;
  const mag = Math.pow(10, Math.floor(Math.log10(rough)));
  const norm = rough / mag;
  const step = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
  const ticks: number[] = [];
  for (let v = Math.ceil(min / step) * step; v <= max + 1e-9; v += step) {
    ticks.push(Number(v.toFixed(6)));
  }
  return ticks;
}

/**
 * Curva tiempo-intensidad: una línea por ROI sobre un solo eje (realce %),
 * marcadores con anillo del color de fondo, rejilla hairline, crosshair que
 * salta a la fase más cercana y un tooltip con todas las series.
 */
export default function KineticsChart({
  series,
  xLabels,
  xAxisLabel,
  height = 200,
}: KineticsChartProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(260);
  const [hoverIndex, setHoverIndex] = useState<number | null>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) {
      return;
    }
    const observer = new ResizeObserver(entries => {
      const w = entries[0]?.contentRect.width;
      if (w && w > 0) {
        setWidth(Math.floor(w));
      }
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  const plot = useMemo(() => {
    const xs = (series[0]?.points.map(p => p.x) ?? xLabels.map((_, i) => i)).map(x =>
      Number.isFinite(x) ? x : 0
    );
    const ys = series.flatMap(s => s.points.map(p => p.y)).filter((v): v is number => v !== null);
    const yMin = Math.min(0, ...ys);
    const yMax = Math.max(10, ...ys);
    const pad = (yMax - yMin) * 0.08;
    const y0 = yMin - pad;
    const y1 = yMax + pad;
    const x0 = Math.min(...xs);
    const x1 = Math.max(...xs);
    const innerW = Math.max(10, width - MARGIN.left - MARGIN.right);
    const innerH = Math.max(10, height - MARGIN.top - MARGIN.bottom);
    const sx = (x: number) =>
      MARGIN.left + (x1 === x0 ? innerW / 2 : ((x - x0) / (x1 - x0)) * innerW);
    const sy = (y: number) => MARGIN.top + innerH - ((y - y0) / (y1 - y0)) * innerH;
    const labelStep = Math.max(1, Math.ceil(xs.length / Math.max(1, Math.floor(innerW / 48))));
    return { xs, sx, sy, y0, y1, innerW, innerH, yTicks: niceTicks(y0, y1), labelStep };
  }, [series, xLabels, width, height]);

  const onMove = (e: React.MouseEvent<SVGSVGElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - rect.left;
    let best = 0;
    let bestD = Infinity;
    plot.xs.forEach((x, i) => {
      const d = Math.abs(plot.sx(x) - px);
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    });
    setHoverIndex(best);
  };

  const hasData = series.some(s => s.points.some(p => p.y !== null));

  return (
    <div
      ref={hostRef}
      className="relative w-full"
    >
      <svg
        width={width}
        height={height}
        role="img"
        aria-label="Curva tiempo-intensidad"
        onMouseMove={onMove}
        onMouseLeave={() => setHoverIndex(null)}
        style={{ display: 'block', background: SURFACE }}
      >
        {/* rejilla y eje y */}
        {plot.yTicks.map(t => (
          <g key={t}>
            <line
              x1={MARGIN.left}
              x2={MARGIN.left + plot.innerW}
              y1={plot.sy(t)}
              y2={plot.sy(t)}
              stroke={GRID}
              strokeWidth={1}
            />
            <text
              x={MARGIN.left - 6}
              y={plot.sy(t)}
              fill={MUTED}
              fontSize={10}
              textAnchor="end"
              dominantBaseline="middle"
            >
              {t}%
            </text>
          </g>
        ))}
        {/* eje x: sólo las etiquetas que caben sin encimarse */}
        {plot.xs.map((x, i) =>
          !(i % plot.labelStep === 0 || i === plot.xs.length - 1) ? null : (
            <text
              key={i}
              x={plot.sx(x)}
              y={height - MARGIN.bottom + 14}
              fill={MUTED}
              fontSize={10}
              textAnchor="middle"
            >
              {xLabels[i] ?? ''}
            </text>
          )
        )}
        <text
          x={MARGIN.left + plot.innerW / 2}
          y={height - 4}
          fill={MUTED}
          fontSize={10}
          textAnchor="middle"
        >
          {xAxisLabel}
        </text>

        {/* crosshair */}
        {hoverIndex !== null && plot.xs[hoverIndex] !== undefined && (
          <line
            x1={plot.sx(plot.xs[hoverIndex])}
            x2={plot.sx(plot.xs[hoverIndex])}
            y1={MARGIN.top}
            y2={MARGIN.top + plot.innerH}
            stroke={INK}
            strokeWidth={1}
            opacity={0.6}
          />
        )}

        {/* series */}
        {series.map(s => {
          const segments: string[] = [];
          let current: string[] = [];
          s.points.forEach(p => {
            if (p.y === null) {
              if (current.length) {
                segments.push(current.join(' '));
                current = [];
              }
              return;
            }
            current.push(`${plot.sx(p.x)},${plot.sy(p.y)}`);
          });
          if (current.length) {
            segments.push(current.join(' '));
          }
          return (
            <g key={s.id}>
              {segments.map((d, i) => (
                <polyline
                  key={i}
                  points={d}
                  fill="none"
                  stroke={s.color}
                  strokeWidth={2}
                  strokeLinejoin="round"
                  strokeLinecap="round"
                />
              ))}
              {s.points.map((p, i) =>
                p.y === null ? null : (
                  <g key={i}>
                    <circle
                      cx={plot.sx(p.x)}
                      cy={plot.sy(p.y)}
                      r={6}
                      fill={SURFACE}
                    />
                    <circle
                      cx={plot.sx(p.x)}
                      cy={plot.sy(p.y)}
                      r={4}
                      fill={p.flagged ? SURFACE : s.color}
                      stroke={s.color}
                      strokeWidth={p.flagged ? 2 : 0}
                    />
                  </g>
                )
              )}
            </g>
          );
        })}

        {!hasData && (
          <text
            x={MARGIN.left + plot.innerW / 2}
            y={MARGIN.top + plot.innerH / 2}
            fill={MUTED}
            fontSize={11}
            textAnchor="middle"
          >
            Sin datos todavía
          </text>
        )}
      </svg>

      {hoverIndex !== null && hasData && (
        <div
          className="pointer-events-none absolute top-1 rounded bg-black/90 px-2 py-1 text-[11px] text-white shadow"
          style={{
            left: Math.min(width - 130, Math.max(0, plot.sx(plot.xs[hoverIndex]) + 8)),
            border: `1px solid ${GRID}`,
          }}
        >
          <div className="text-muted-foreground mb-0.5">{xLabels[hoverIndex]}</div>
          {series.map(s => {
            const p = s.points[hoverIndex];
            return (
              <div
                key={s.id}
                className="flex items-center gap-1.5"
              >
                <span
                  className="inline-block h-0.5 w-3"
                  style={{ background: s.color }}
                />
                <strong className="tabular-nums">
                  {p?.y === null || p === undefined ? '–' : `${p.y.toFixed(0)}%`}
                </strong>
                <span className="text-muted-foreground tabular-nums">
                  {p?.raw === null || p === undefined ? '' : `(${p.raw.toFixed(0)})`}
                </span>
                <span className="text-muted-foreground">{s.label}</span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
