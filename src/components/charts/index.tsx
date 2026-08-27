'use client';

/**
 * Charts, as inline SVG. No charting library.
 *
 * Three reasons, in order of weight: the console has to render correctly in
 * both a light and a dark theme, which means the marks must read CSS custom
 * properties rather than a hard-coded theme object; the shapes needed here are
 * a line, a bar and a stat tile, which is far less code than the adapter layer
 * a library would need; and the storefront already carries a 200KB animation
 * dependency it never imports, so this project has earned some scepticism about
 * adding one more.
 *
 * ---------------------------------------------------------------------------
 * COLOUR
 *
 * The series palette is **not** the console's accent, and that is deliberate.
 * The accent is the interface — buttons, links, the active nav item. A chart
 * series painted in the same colour as every clickable thing on the page reads
 * as interactive when it is not. So identity colours come from a validated
 * categorical palette, and the accent stays on the furniture.
 *
 * That accent used to be teal, and is now the brand amber. **Slot 2 is a
 * red-orange and the brand is a gold**, which is a wider gap than it sounds
 * (hue 18° against 42°, and the brand appears on this screen only as a solid
 * button) but a narrower one than teal gave. If a third series is ever added,
 * take it from the cool end rather than the warm one — and if these two ever
 * start reading as "the eDawr colour", re-run the validator before reaching for
 * a value that looks right.
 *
 * Both slots below were checked with the palette validator against this app's
 * actual surfaces (#ffffff light, #0f1423 dark), all-pairs, in both modes:
 * lightness band, chroma floor, CVD separation under protanopia/deuteranopia,
 * the normal-vision floor, and contrast against the surface. Everything passed.
 * Slot 3 (aqua) was dropped rather than used, because on a white surface it
 * measured 2.82:1 and would have needed relief the layout could not give it.
 *
 * On-time versus late is *not* painted from these slots. It is a status
 * encoding — good against critical — and it ships with a label beside the
 * colour, never colour alone.
 */

import { useId, useState } from 'react';

import { clsx } from 'clsx';

/** Categorical identity slots, light and dark. See the note above. */
export const SERIES = {
  light: ['#2a78d6', '#eb6834'],
  dark: ['#3987e5', '#d95926'],
} as const;

/**
 * Emitted once per chart so the marks can switch with the theme without React
 * re-rendering. `currentColor` is not enough — a chart needs two or three
 * independent colours at once.
 */
function SeriesStyles({ scope }: { scope: string }) {
  return (
    <style>{`
      [data-chart="${scope}"] {
        --s1: ${SERIES.light[0]};
        --s2: ${SERIES.light[1]};
      }
      @media (prefers-color-scheme: dark) {
        :root:not([data-theme="light"]) [data-chart="${scope}"] {
          --s1: ${SERIES.dark[0]};
          --s2: ${SERIES.dark[1]};
        }
      }
      :root[data-theme="dark"] [data-chart="${scope}"] {
        --s1: ${SERIES.dark[0]};
        --s2: ${SERIES.dark[1]};
      }
    `}</style>
  );
}

/* ==========================================================================
   Stat tile
   ========================================================================== */

/**
 * One headline figure, with its change against the previous period.
 *
 * The delta is null when the previous period was zero — a first sale is not
 * "+100%", and rendering it as a trend invents a story out of one data point.
 * In that case the comparison is simply omitted rather than shown as infinity
 * or as a suspiciously round number.
 */
export function StatTile({
  label,
  value,
  delta,
  hint,
  tone = 'neutral',
}: {
  label: string;
  value: string;
  delta?: number | null;
  hint?: string;
  tone?: 'neutral' | 'good' | 'warn' | 'danger';
}) {
  const rising = delta !== null && delta !== undefined && delta > 0;
  const falling = delta !== null && delta !== undefined && delta < 0;

  return (
    <div className="panel p-3.5">
      <p className="text-xs text-ink-faint">{label}</p>
      <p
        className={clsx(
          'numeric mt-1 text-2xl font-semibold tracking-tight',
          tone === 'good' && 'text-ok',
          tone === 'warn' && 'text-warn',
          tone === 'danger' && 'text-danger',
        )}
      >
        {value}
      </p>
      <div className="mt-1 flex items-baseline gap-1.5 text-xs">
        {delta === null || delta === undefined ? (
          <span className="text-ink-faint">{hint ?? 'No prior period'}</span>
        ) : (
          <>
            {/* An arrow as well as a colour: the direction must survive a
                greyscale print and a colourblind reader. */}
            <span className={clsx('numeric font-medium', rising && 'text-ok', falling && 'text-danger')}>
              {rising ? '↑' : falling ? '↓' : '→'} {Math.abs(delta).toFixed(1)}%
            </span>
            <span className="text-ink-faint">{hint ?? 'vs previous period'}</span>
          </>
        )}
      </div>
    </div>
  );
}

/* ==========================================================================
   Line chart
   ========================================================================== */

export interface LinePoint {
  label: string;
  value: number;
}

/**
 * A single series over time, with a crosshair and a tooltip.
 *
 * One series, so there is no legend: the panel title already says what is
 * plotted, and a box with one swatch restates it. The only direct label is the
 * final point — a value on every dot is chaos and goes unread.
 */
export function LineChart({
  points,
  formatValue,
  height = 200,
  ariaLabel,
}: {
  points: LinePoint[];
  formatValue: (value: number) => string;
  height?: number;
  ariaLabel: string;
}) {
  const scope = useId().replace(/:/g, '');
  const [hover, setHover] = useState<number | null>(null);

  if (points.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-faint">No data for this range.</p>;
  }

  const width = 720;
  const padding = { top: 14, right: 16, bottom: 22, left: 46 };
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;

  const max = Math.max(...points.map((point) => point.value), 1);
  // The baseline is always zero. Starting a value axis anywhere else
  // exaggerates every wiggle into a trend, which is the oldest chart lie there
  // is — and on a revenue chart it is the most consequential one.
  const scaleY = (value: number) => padding.top + plotHeight - (value / max) * plotHeight;
  const scaleX = (index: number) =>
    padding.left + (points.length === 1 ? plotWidth / 2 : (index / (points.length - 1)) * plotWidth);

  const line = points
    .map((point, index) => `${index === 0 ? 'M' : 'L'} ${scaleX(index)} ${scaleY(point.value)}`)
    .join(' ');

  const area =
    `${line} L ${scaleX(points.length - 1)} ${padding.top + plotHeight}` +
    ` L ${scaleX(0)} ${padding.top + plotHeight} Z`;

  const ticks = [0, max / 2, max];
  const last = points[points.length - 1];
  const active = hover === null ? null : points[hover];

  return (
    <div className="relative" data-chart={scope}>
      <SeriesStyles scope={scope} />

      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="w-full"
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
      >
        {/* Gridlines: hairline, solid, one step off the surface. Recessive by
            construction — they are scaffolding, not data. */}
        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={padding.left}
              x2={width - padding.right}
              y1={scaleY(tick)}
              y2={scaleY(tick)}
              stroke="var(--c-line)"
              strokeWidth={1}
            />
            <text
              x={padding.left - 8}
              y={scaleY(tick) + 3.5}
              textAnchor="end"
              className="fill-[var(--c-ink-faint)] text-[10px]"
              style={{ fontVariantNumeric: 'tabular-nums' }}
            >
              {formatValue(tick)}
            </text>
          </g>
        ))}

        {/* A wash, not a saturated block. */}
        <path d={area} fill="var(--s1)" opacity={0.1} />
        <path
          d={line}
          fill="none"
          stroke="var(--s1)"
          strokeWidth={2}
          strokeLinejoin="round"
          strokeLinecap="round"
        />

        {/* Crosshair. Drawn under the marker so the marker stays readable. */}
        {active ? (
          <line
            x1={scaleX(hover!)}
            x2={scaleX(hover!)}
            y1={padding.top}
            y2={padding.top + plotHeight}
            stroke="var(--c-line-strong)"
            strokeWidth={1}
          />
        ) : null}

        {/* The endpoint, always marked and labelled — the one value a reader
            wants without hovering is "where are we now". The 2px surface ring
            keeps it legible where it crosses the line. */}
        <circle
          cx={scaleX(points.length - 1)}
          cy={scaleY(last.value)}
          r={4}
          fill="var(--s1)"
          stroke="var(--c-surface)"
          strokeWidth={2}
        />

        {active ? (
          <circle
            cx={scaleX(hover!)}
            cy={scaleY(active.value)}
            r={4}
            fill="var(--s1)"
            stroke="var(--c-surface)"
            strokeWidth={2}
          />
        ) : null}

        {/* Invisible hit bands, one per point and far wider than the dots.
            A 4px radius circle is not a hover target anyone can hit. */}
        {points.map((point, index) => (
          <rect
            key={point.label}
            x={scaleX(index) - plotWidth / points.length / 2}
            y={padding.top}
            width={plotWidth / points.length}
            height={plotHeight}
            fill="transparent"
            onMouseEnter={() => setHover(index)}
          />
        ))}

        {/* First and last x labels only. Thirty dates along an axis is a smear. */}
        <text
          x={padding.left}
          y={height - 6}
          className="fill-[var(--c-ink-faint)] text-[10px]"
        >
          {points[0].label}
        </text>
        <text
          x={width - padding.right}
          y={height - 6}
          textAnchor="end"
          className="fill-[var(--c-ink-faint)] text-[10px]"
        >
          {last.label}
        </text>
      </svg>

      {active ? (
        <div
          className="pointer-events-none absolute -top-1 rounded-[0.3rem] border border-line bg-surface px-2 py-1 text-xs shadow-lg"
          style={{
            left: `${(scaleX(hover!) / width) * 100}%`,
            transform: 'translateX(-50%)',
          }}
        >
          <span className="text-ink-faint">{active.label}: </span>
          <span className="numeric font-semibold">{formatValue(active.value)}</span>
        </div>
      ) : null}
    </div>
  );
}

/* ==========================================================================
   Horizontal bar chart
   ========================================================================== */

export interface BarRow {
  label: string;
  value: number;
  /** Optional second line under the label, e.g. "18 units". */
  detail?: string;
}

/**
 * Ranked rows — top products, revenue by category.
 *
 * Horizontal, because the labels are product names and a vertical bar chart
 * would either rotate them 45° or truncate them. Every bar takes the *same*
 * hue: these are nominal categories, so colouring each one differently would
 * spend the identity channel re-encoding what the bar length already shows.
 */
export function BarChart({
  rows,
  formatValue,
  ariaLabel,
}: {
  rows: BarRow[];
  formatValue: (value: number) => string;
  ariaLabel: string;
}) {
  const scope = useId().replace(/:/g, '');

  if (rows.length === 0) {
    return <p className="py-10 text-center text-sm text-ink-faint">No data for this range.</p>;
  }

  const max = Math.max(...rows.map((row) => row.value), 1);

  return (
    <ul className="space-y-2" data-chart={scope} aria-label={ariaLabel}>
      <SeriesStyles scope={scope} />
      {rows.map((row) => (
        <li key={row.label} className="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1">
          <span className="truncate text-sm" title={row.label}>
            {row.label}
            {row.detail ? (
              <span className="ml-1.5 text-2xs text-ink-faint">{row.detail}</span>
            ) : null}
          </span>
          {/* The value is a direct label on every row, which is legal here and
              not on a line chart: there are ten rows, not thirty points, and
              the number is the thing being ranked. */}
          <span className="numeric text-sm font-medium">{formatValue(row.value)}</span>

          <div className="col-span-2 h-1.5 overflow-hidden rounded-full bg-raised">
            <div
              className="h-full rounded-full"
              style={{
                width: `${Math.max((row.value / max) * 100, 1.5)}%`,
                background: 'var(--s1)',
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  );
}

/* ==========================================================================
   On-time split
   ========================================================================== */

/**
 * On-time against late, as one bar.
 *
 * A **status** encoding, not a categorical one: good and critical have reserved
 * meanings, and they never double as "series 1 and 2". Both segments carry a
 * text label beside the colour, so the split is readable without seeing hue at
 * all — and the 2px surface gap between them is what separates the segments,
 * rather than a stroke drawn around each.
 */
export function OnTimeBar({
  onTime,
  late,
}: {
  onTime: number;
  late: number;
}) {
  const total = onTime + late;

  if (total === 0) {
    return (
      <p className="py-6 text-center text-sm text-ink-faint">
        Nothing delivered in this range yet.
      </p>
    );
  }

  const onTimePercent = (onTime / total) * 100;

  return (
    <div>
      <div className="flex h-2.5 gap-[2px] overflow-hidden rounded-full">
        <div
          className="rounded-l-full bg-ok"
          style={{ width: `${onTimePercent}%` }}
        />
        <div className="flex-1 rounded-r-full bg-danger" />
      </div>

      <dl className="mt-3 grid grid-cols-2 gap-3 text-sm">
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-ok" aria-hidden="true" />
          <div>
            <dt className="text-xs text-ink-faint">On time</dt>
            <dd className="numeric font-semibold">{onTime}</dd>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 shrink-0 rounded-full bg-danger" aria-hidden="true" />
          <div>
            <dt className="text-xs text-ink-faint">Late</dt>
            <dd className="numeric font-semibold">{late}</dd>
          </div>
        </div>
      </dl>
    </div>
  );
}
