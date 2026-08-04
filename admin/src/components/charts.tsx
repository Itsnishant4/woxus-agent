"use client";

// Lightweight, dependency-free SVG charts. Both render from
// `{ label, value }[]` and adapt to the theme via currentColor tokens.

export interface ChartDatum {
  label: string;
  value: number;
}

const VIO = "#8b5cf6";
const TEAL = "#14b8a6";
const ROSE = "#f43f5e";
const MUTED = "currentColor";

function maxValue(data: ChartDatum[]): number {
  return Math.max(1, ...data.map((d) => d.value));
}

/** Vertical bar chart with value labels above each bar. */
export function BarChart({
  data,
  height = 180,
  color = VIO,
  format = String,
}: {
  data: ChartDatum[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  if (!data.length) return <ChartEmpty />;
  const max = maxValue(data);
  const gap = 12;
  const chartW = 640;
  const barW = (chartW - gap * (data.length + 1)) / data.length;
  const labelH = 20;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${chartW} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="bar chart"
      >
        {data.map((d, i) => {
          const barH = Math.max(2, (d.value / max) * (height - 34));
          const x = gap + i * (barW + gap);
          const y = height - labelH - barH;
          return (
            <g key={d.label}>
              <rect x={x} y={y} width={barW} height={barH} rx={4} fill={color} />
              <text
                x={x + barW / 2}
                y={y - 5}
                textAnchor="middle"
                fontSize={11}
                fill={MUTED}
                opacity={0.85}
              >
                {format(d.value)}
              </text>
              <text
                x={x + barW / 2}
                y={height - 6}
                textAnchor="middle"
                fontSize={10}
                fill={MUTED}
                opacity={0.6}
              >
                {d.label}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}

/** Area chart (polyline + gradient fill). */
export function AreaChart({
  data,
  height = 180,
  color = TEAL,
  format = String,
}: {
  data: ChartDatum[];
  height?: number;
  color?: string;
  format?: (n: number) => string;
}) {
  if (!data.length) return <ChartEmpty />;
  const max = maxValue(data);
  const pad = 8;
  const plotW = 640;
  const plotH = height - 26;
  const step = data.length > 1 ? (plotW - pad * 2) / (data.length - 1) : 0;

  const pts = data.map((d, i) => {
    const x = pad + i * step;
    const y = pad + (1 - d.value / max) * (plotH - pad * 2);
    return [x, y] as const;
  });

  const line = pts.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${pts[pts.length - 1][0].toFixed(1)},${(plotH - pad).toFixed(1)} L${pts[0][0].toFixed(1)},${(plotH - pad).toFixed(1)} Z`;
  const gid = `grad-${color.replace(/[^a-zA-Z0-9]/g, "")}`;

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${plotW} ${height}`}
        className="w-full h-auto"
        role="img"
        aria-label="area chart"
      >
        <defs>
          <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={0.35} />
            <stop offset="100%" stopColor={color} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <path d={area} fill={`url(#${gid})`} />
        <path d={line} fill="none" stroke={color} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" />
        {pts.map(([x, y], i) => (
          <g key={i}>
            <circle cx={x} cy={y} r={3} fill={color} />
            <text x={x} y={height - 8} textAnchor="middle" fontSize={10} fill={MUTED} opacity={0.6}>
              {data[i].label}
            </text>
            <text x={x} y={y - 7} textAnchor="middle" fontSize={10} fill={MUTED} opacity={0.8}>
              {format(data[i].value)}
            </text>
          </g>
        ))}
      </svg>
    </div>
  );
}

/** Horizontal stacked/segmented bar (e.g. active vs revoked) with legend. */
export function SplitBar({
  parts,
}: {
  parts: { label: string; value: number; color: string }[];
}) {
  const total = Math.max(1, parts.reduce((s, p) => s + p.value, 0));
  return (
    <div className="space-y-2">
      <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
        {parts.map((p, i) => (
          <div
            key={i}
            style={{ width: `${(p.value / total) * 100}%`, background: p.color }}
            title={`${p.label}: ${p.value}`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
        {parts.map((p, i) => (
          <span key={i} className="inline-flex items-center gap-1.5">
            <span className="h-2.5 w-2.5 rounded-sm" style={{ background: p.color }} />
            {p.label}: <b className="text-foreground">{p.value}</b>
          </span>
        ))}
      </div>
    </div>
  );
}

function ChartEmpty() {
  return (
    <div className="py-12 text-center text-sm text-muted-foreground">
      No data yet.
    </div>
  );
}

export { VIO, TEAL, ROSE };
