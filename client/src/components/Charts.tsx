/** Shared chart components — SVG-only, no position:absolute label hacks */

function pct(v: number | null) {
  return v === null ? '—' : `${Math.round(v * 100)}%`
}

/**
 * Bar chart rendered entirely in SVG. Labels are <text> elements inside the
 * SVG coordinate space — no position:absolute escaping, no paddingBottom hacks,
 * no dependency on parent overflow behaviour.
 */
export function SimpleBarChart({
  data,
  color = 'var(--color-accent)',
}: {
  data: { label: string; value: number }[]
  color?: string
}) {
  if (data.length === 0) return null

  const BAR_W = 12
  const GAP = 2
  const BAR_H = 100
  const LABEL_H = 52
  const PAD = { left: 8, right: 8, top: 4 }

  const n = data.length
  const max = Math.max(...data.map((d) => d.value), 1)
  // Exact pixel dimensions — outer div handles horizontal scrolling
  const svgW = PAD.left + n * (BAR_W + GAP) - GAP + PAD.right
  const svgH = PAD.top + BAR_H + LABEL_H
  const showLabel = (i: number) => n <= 8 || i % Math.ceil(n / 8) === 0

  return (
    <div style={{ overflowX: 'auto' }}>
      <svg width={svgW} height={svgH} style={{ display: 'block' }}>
        {data.map((d, i) => {
          const x = PAD.left + i * (BAR_W + GAP)
          const h = Math.max(2, (d.value / max) * BAR_H)
          const y = PAD.top + BAR_H - h
          const lx = x + BAR_W / 2
          const ly = PAD.top + BAR_H + 10
          return (
            <g key={i}>
              <rect
                x={x} y={y}
                width={BAR_W} height={h}
                rx={2}
                fill={color}
                fillOpacity={d.value === 0 ? 0.2 : 1}
              >
                <title>{d.label}: {d.value}</title>
              </rect>
              {showLabel(i) && (
                <text
                  x={lx} y={ly}
                  fontSize={9}
                  fill="var(--color-text-muted)"
                  textAnchor="end"
                  transform={`rotate(-45,${lx},${ly})`}
                >
                  {d.label}
                </text>
              )}
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/**
 * SVG line chart for a rolling accuracy trend.
 *
 * Fixes vs the original inline version:
 *  - Increased PAD.bottom (24→44) so x-axis labels sit safely inside the
 *    viewBox — the old y={H-4} placed baselines at the clip boundary.
 *  - Guards against n=1: dividing by (n-1)=0 produced NaN coordinates.
 *  - Removed CSS `overflow: visible` — it does not override parent container
 *    clipping; all content is now within the viewBox instead.
 *  - `display: block` eliminates the inline-block bottom gap.
 */
export function AccuracyLineChart({
  data,
}: {
  data: { date: string; accuracy: number | null }[]
}) {
  const W = 600
  const H = 200
  const PAD = { top: 10, right: 10, bottom: 44, left: 36 }
  const innerW = W - PAD.left - PAD.right
  const innerH = H - PAD.top - PAD.bottom

  const points = data
    .map((d, i) => ({ x: i, y: d.accuracy, date: d.date }))
    .filter((p) => p.y !== null) as { x: number; y: number; date: string }[]

  if (points.length === 0) {
    return <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-muted)' }}>No accuracy data yet.</p>
  }

  const n = data.length
  // n=1 guard: place the single point at horizontal centre
  const toSvgX = (i: number) =>
    n <= 1 ? PAD.left + innerW / 2 : PAD.left + (i / (n - 1)) * innerW
  const toSvgY = (v: number) => PAD.top + (1 - v) * innerH

  const path = points
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${toSvgX(p.x).toFixed(1)},${toSvgY(p.y).toFixed(1)}`)
    .join(' ')

  // labelY: 20px below the chart area, well inside the viewBox (H=200)
  const labelY = PAD.top + innerH + 20

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', maxWidth: W, display: 'block' }}>
      {/* Grid lines + y-axis labels */}
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line
            x1={PAD.left} y1={toSvgY(v)}
            x2={W - PAD.right} y2={toSvgY(v)}
            stroke="var(--color-border)" strokeWidth={1}
          />
          <text
            x={PAD.left - 4} y={toSvgY(v) + 4}
            textAnchor="end" fontSize={10} fill="var(--color-text-muted)"
          >
            {Math.round(v * 100)}%
          </text>
        </g>
      ))}
      {/* Line */}
      <path
        d={path}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth={2}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
      {/* Data points */}
      {points.map((p, i) => (
        <circle key={i} cx={toSvgX(p.x)} cy={toSvgY(p.y)} r={3} fill="var(--color-accent)">
          <title>{p.date}: {pct(p.y)}</title>
        </circle>
      ))}
      {/* X-axis labels — every ~6th point, safely inside viewBox */}
      {data
        .filter((_, i) => i % Math.ceil(n / 6) === 0)
        .map((d) => {
          const idx = data.findIndex((dd) => dd.date === d.date)
          return (
            <text
              key={d.date}
              x={toSvgX(idx)}
              y={labelY}
              textAnchor="middle"
              fontSize={10}
              fill="var(--color-text-muted)"
            >
              {d.date.slice(5)}
            </text>
          )
        })}
    </svg>
  )
}
