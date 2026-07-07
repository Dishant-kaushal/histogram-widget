import type { Bin, SeriesPayload, SeriesPoint } from '../../iosense-sdk/types';

/** Map a resolved SeriesPayload's slots into normalized {time, value} points. */
export function slotsToPoints(payload: SeriesPayload | null): SeriesPoint[] {
  if (!payload?.slots) return [];
  const pts: SeriesPoint[] = [];
  for (const s of payload.slots) {
    if (s.value === null || s.value === undefined) continue;
    const value = Number(s.value);
    if (!Number.isFinite(value)) continue;
    pts.push({ time: typeof s.from === 'number' ? s.from : 0, value });
  }
  return pts;
}

// ─── Binning (v1 frequency-count semantics) ───────────────────────────────────
// start ≤ v < end per bin; the LAST bin is end-inclusive so the range max
// (snapped in createGroups) isn't dropped.

export function pointInBin(value: number, bin: Bin, isLast: boolean, includeStartEnd = false): boolean {
  // includeStartEnd → each bin is fully inclusive [start, end]; otherwise
  // [start, end) with the last bin end-inclusive (v1 default).
  if (includeStartEnd) return value >= bin.start && value <= bin.end;
  return value >= bin.start && (isLast ? value <= bin.end : value < bin.end);
}

export function binCounts(points: SeriesPoint[], bins: Bin[], includeStartEnd = false): number[] {
  const counts = new Array<number>(bins.length).fill(0);
  for (const p of points) {
    for (let i = 0; i < bins.length; i++) {
      if (pointInBin(p.value, bins[i], i === bins.length - 1, includeStartEnd)) {
        counts[i] += 1;
        break;
      }
    }
  }
  return counts;
}

// ─── Auto bin generation (v1 createGroups, last-bin end snapped to max) ──────

export function createGroups(
  min: number,
  max: number,
  x: number,
  precision = 2,
): Array<[number, number]> {
  if (min >= max || x <= 0) return [];
  const groupSize = (max - min) / x;
  const groups: Array<[number, number]> = [];
  for (let i = 0; i < x; i++) {
    const start = parseFloat((min + i * groupSize).toFixed(precision));
    const end = parseFloat((start + groupSize).toFixed(precision));
    groups.push([start, end]);
  }
  groups[groups.length - 1][1] = max; // snap last bin end to max (avoids float drift)
  return groups;
}

// ─── Bin labels / tooltip sentinels ──────────────────────────────────────────

/** '' and '-' are the v1 "no name" sentinels. */
export function hasBinName(binName: string | undefined): boolean {
  return !!binName && binName !== '-';
}

export function binLabel(bin: Bin, index: number, showBinRanges: boolean): string {
  if (showBinRanges) return `${bin.start} - ${bin.end}`;
  return String(index + 1); // 1-based bin index
}

// ─── Normal-distribution overlay (v1 calculateFrequencyDistributionOverlay) ──

export function gaussianOverlayPoints(
  frequencies: number[],
  numPoints = 200,
): Array<[number, number]> {
  const totalCount = frequencies.reduce((a, b) => a + b, 0);
  if (totalCount === 0 || frequencies.length < 2) return [];

  const mean =
    frequencies.reduce((acc, y, i) => acc + i * y, 0) / totalCount;
  const variance =
    frequencies.reduce((acc, y, i) => acc + (i - mean) ** 2 * y, 0) / totalCount;
  const stdDev = Math.sqrt(variance);
  if (stdDev === 0) return [];

  const len = frequencies.length;
  const pts: Array<[number, number]> = [];
  for (let j = 0; j < numPoints; j++) {
    const x = ((len - 1) * j) / (numPoints - 1);
    const y =
      (1 / (stdDev * Math.sqrt(2 * Math.PI))) *
      Math.exp(-((x - mean) ** 2) / (2 * stdDev ** 2)) *
      totalCount;
    pts.push([x, y]);
  }
  return pts;
}

// ─── Daily mode: group counts per calendar day (one column group per weekday) ─

export interface DailyGrouping {
  /** Weekday names ordered by calendar date ascending, e.g. ["Monday", …] */
  categories: string[];
  /** perBin[binIndex][dayIndex] = frequency of that bin on that day */
  perBin: number[][];
}

const WEEKDAY_FMT = new Intl.DateTimeFormat('en-US', { weekday: 'long' });

function dayKey(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export function dailyBinCounts(points: SeriesPoint[], bins: Bin[], includeStartEnd = false): DailyGrouping {
  const byDay = new Map<string, SeriesPoint[]>();
  for (const p of points) {
    if (!p.time) continue;
    const key = dayKey(p.time);
    const arr = byDay.get(key);
    if (arr) arr.push(p);
    else byDay.set(key, [p]);
  }
  const dayKeys = Array.from(byDay.keys()).sort();
  const categories = dayKeys.map((k) => WEEKDAY_FMT.format(new Date(`${k}T00:00:00`)));
  const perBin = bins.map(() => new Array<number>(dayKeys.length).fill(0));
  dayKeys.forEach((k, dayIdx) => {
    const counts = binCounts(byDay.get(k)!, bins, includeStartEnd);
    counts.forEach((c, binIdx) => {
      perBin[binIdx][dayIdx] = c;
    });
  });
  return { categories, perBin };
}

// ─── Drill-down: hour-of-day frequency for a single bin (v1 line chart) ──────

export const HOUR_CATEGORIES = Array.from({ length: 24 }, (_, h) => `${String(h).padStart(2, '0')}:00`);

export function hourlyCountsForBin(points: SeriesPoint[], bin: Bin, isLast: boolean, includeStartEnd = false): number[] {
  const counts = new Array<number>(24).fill(0);
  for (const p of points) {
    if (!pointInBin(p.value, bin, isLast, includeStartEnd)) continue;
    counts[new Date(p.time).getHours()] += 1;
  }
  return counts;
}
