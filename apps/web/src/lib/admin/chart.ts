/**
 * Charts, as SVG strings — `E11-10`.
 *
 * Andy, on the first attempt: *"The graph in growth is abysmal to say the least."* He was right,
 * and the reasons are worth naming because they are all the same reason — **it drew the data and
 * nothing else**:
 *
 * - **No axis.** A line with no y scale says "it went up" and nothing about by how much.
 * - **No labels.** No dates on the x axis, so a bump could be any week.
 * - **`preserveAspectRatio="none"`**, which stretches the drawing to the container and distorts
 *   every slope in it. The one thing a line chart communicates is gradient, and that threw it away.
 * - **No baseline**, so bars floated with nothing to sit on.
 *
 * ## No library, and no runtime
 *
 * `check-build.mjs` fails the build on any third-party asset and the CSP is `script-src 'self'`,
 * so a charting library is not available even if it were wanted. These functions return a string
 * of SVG; there is nothing to initialise, nothing to tear down, and nothing to re-measure on
 * resize because the viewBox scales itself.
 *
 * ## Readable without seeing it
 *
 * Every chart takes an `label` and renders `role="img"` with an `aria-label`, and every bar and
 * point carries a `<title>` — which is a **native tooltip on hover**, with no JavaScript, and is
 * what a screen reader announces. The numbers are also always in a table beside the chart; the
 * chart is the shape, the table is the record.
 */

const esc = (s: string): string =>
  String(s ?? '').replace(/[&<>"']/g, (c) =>
    c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : c === '"' ? '&quot;' : '&#39;',
  );

export interface Point {
  /** The x label — a date or a month. Thinned before drawing if there are many. */
  label: string;
  value: number;
  /** What the tooltip says. Falls back to `label: value`. */
  title?: string;
}

/**
 * A rounded axis maximum and its ticks.
 *
 * Rounds **up** to 1, 2 or 5 × a power of ten, so the top gridline is a number a person would
 * choose — 12 becomes 20, 230 becomes 250 — rather than the raw maximum, which puts the largest
 * bar flush against the top edge and makes it look clipped.
 */
export function niceScale(max: number, ticks = 4): { max: number; values: number[] } {
  if (!Number.isFinite(max) || max <= 0) return { max: 1, values: [0, 1] };
  const raw = max / ticks;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const normalised = raw / magnitude;
  const step = (normalised <= 1 ? 1 : normalised <= 2 ? 2 : normalised <= 5 ? 5 : 10) * magnitude;
  const top = Math.ceil(max / step) * step;
  const values: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) values.push(Math.round(v * 1e6) / 1e6);
  return { max: top, values };
}

/**
 * Which x labels to print.
 *
 * Printing all of them overlaps into an unreadable smear at anything past about a dozen; printing
 * the first and last only loses the shape. This keeps a target number, always including the last
 * one, because "where does it end" is the question being asked.
 */
export function thinLabels(count: number, target = 7): number[] {
  if (count <= target) return Array.from({ length: count }, (_, i) => i);
  const stride = Math.ceil(count / target);
  const keep: number[] = [];
  for (let i = count - 1; i >= 0; i -= stride) keep.unshift(i);
  return keep;
}

const PAD = { top: 8, right: 8, bottom: 22, left: 44 };

/** The gridlines and their y-axis numbers. Shared by both chart types. */
function grid(scale: { max: number; values: number[] }, w: number, h: number, fmt: (n: number) => string) {
  return scale.values
    .map((v) => {
      const y = PAD.top + (1 - v / scale.max) * h;
      return (
        `<line class="cx__grid" x1="${PAD.left}" y1="${y.toFixed(1)}" ` +
        `x2="${(PAD.left + w).toFixed(1)}" y2="${y.toFixed(1)}"></line>` +
        `<text class="cx__ytick" x="${PAD.left - 6}" y="${(y + 3).toFixed(1)}" ` +
        `text-anchor="end">${esc(fmt(v))}</text>`
      );
    })
    .join('');
}

function xLabels(points: readonly Point[], w: number, h: number, band: number) {
  return thinLabels(points.length)
    .map((i) => {
      const x = PAD.left + band * (i + 0.5);
      return (
        `<text class="cx__xtick" x="${x.toFixed(1)}" y="${(PAD.top + h + 15).toFixed(1)}" ` +
        `text-anchor="middle">${esc(points[i]!.label)}</text>`
      );
    })
    .join('');
}

export interface ChartOptions {
  /** Announced to a screen reader, and the caption a sighted reader gets from the heading. */
  label: string;
  /** Formats the y axis and the tooltips. Money passes `formatPaise`; counts pass `String`. */
  format?: (n: number) => string;
  width?: number;
  height?: number;
}

/**
 * A column chart.
 *
 * Columns rather than a line for anything counted per period: a bar has area, and at the small
 * numbers this product will show for months, three orders next to zero orders is legible as bars
 * and nearly invisible as a two-pixel step in a line.
 */
export function columns(points: readonly Point[], options: ChartOptions): string {
  const { label, format = String, width = 720, height = 200 } = options;
  if (points.length === 0) return '';

  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const scale = niceScale(Math.max(...points.map((p) => p.value)));
  const band = w / points.length;
  // A gap of a third of the band, floored at 1px so a hundred columns still render as separate
  // marks, and **capped at 96px** so two buckets are columns rather than slabs — a bar 300px wide
  // stops reading as a measurement and starts reading as a background.
  const barW = Math.min(96, Math.max(1, band * 0.7));

  const bars = points
    .map((p, i) => {
      const barH = (p.value / scale.max) * h;
      const x = PAD.left + band * i + (band - barW) / 2;
      const y = PAD.top + h - barH;
      return (
        `<rect class="cx__bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" ` +
        `width="${barW.toFixed(1)}" height="${Math.max(barH, p.value > 0 ? 1.5 : 0).toFixed(1)}" rx="2">` +
        `<title>${esc(p.title ?? `${p.label}: ${format(p.value)}`)}</title></rect>`
      );
    })
    .join('');

  return (
    `<svg class="cx" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">` +
      grid(scale, w, h, format) +
      bars +
      // The baseline, drawn after the bars so it reads as the ground they stand on.
      `<line class="cx__axis" x1="${PAD.left}" y1="${PAD.top + h}" x2="${PAD.left + w}" y2="${PAD.top + h}"></line>` +
      xLabels(points, w, h, band) +
    `</svg>`
  );
}

/**
 * A line with the area beneath it filled.
 *
 * For cumulative series only — a running total is the one thing where the *area* is meaningful
 * rather than decorative, and where the gradient is the reading.
 */
export function area(points: readonly Point[], options: ChartOptions): string {
  const { label, format = String, width = 720, height = 200 } = options;
  if (points.length === 0) return '';

  const w = width - PAD.left - PAD.right;
  const h = height - PAD.top - PAD.bottom;
  const scale = niceScale(Math.max(...points.map((p) => p.value)));
  const band = w / Math.max(points.length, 1);
  const step = points.length === 1 ? 0 : w / (points.length - 1);

  const xy = points.map((p, i) => ({
    x: PAD.left + (points.length === 1 ? w / 2 : i * step),
    y: PAD.top + (1 - p.value / scale.max) * h,
    p,
  }));

  const line = xy.map((q) => `${q.x.toFixed(1)},${q.y.toFixed(1)}`).join(' ');
  const fill =
    `${PAD.left},${(PAD.top + h).toFixed(1)} ${line} ` +
    `${(PAD.left + (points.length === 1 ? w / 2 : w)).toFixed(1)},${(PAD.top + h).toFixed(1)}`;

  // A dot per point only when they are sparse enough to be distinguishable; past that they merge
  // into a thick line and add nothing but bytes.
  const dots = points.length <= 40
    ? xy.map((q) =>
        `<circle class="cx__dot" cx="${q.x.toFixed(1)}" cy="${q.y.toFixed(1)}" r="2.5">` +
        `<title>${esc(q.p.title ?? `${q.p.label}: ${format(q.p.value)}`)}</title></circle>`).join('')
    : '';

  return (
    `<svg class="cx" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(label)}">` +
      grid(scale, w, h, format) +
      `<polygon class="cx__area" points="${fill}"></polygon>` +
      `<polyline class="cx__line" points="${line}" fill="none"></polyline>` +
      dots +
      `<line class="cx__axis" x1="${PAD.left}" y1="${PAD.top + h}" x2="${PAD.left + w}" y2="${PAD.top + h}"></line>` +
      xLabels(points, w, h, band) +
    `</svg>`
  );
}
