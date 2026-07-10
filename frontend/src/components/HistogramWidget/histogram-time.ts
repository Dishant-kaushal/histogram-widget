// Widget-side time resolution for the 3 picker modes (mirrors the line chart):
//   local  → user picks a range/preset in a DatePicker above the chart + periodicity
//   fixed  → window comes from the single inline "Set Duration" expression
//   global → window comes from the linked dashboard Global Time Picker (GTP)
// The widget emits TIME_CHANGE(startTime,endTime,periodicity) so the host
// DataLayer re-runs resolveAndCompute; it never fetches itself in host mode.

import { resolveDurationWindow } from '../../iosense-sdk/time';
import type { Duration, CycleTime, TimeTabUIConfig } from '../../iosense-sdk/types';

export type TimeMode = 'local' | 'fixed' | 'global';

/** Minimal local time config used when the host doesn't push a timeTabConfig,
 *  so the above-chart DatePicker still renders (local mode). Duration ids mirror
 *  the config's FALLBACK_TIME_CONFIG (SDK built-in catalog ids) so a fresh widget
 *  and the configurator offer the same presets. */
export const DEFAULT_LOCAL_TIME_TAB = {
  timezone: 'Asia/Kolkata',
  timeType: 'local',
  linkTimeWith: 'local',
  defaultDurationId: 'previous_7_days',
  defaultPeriodicity: 'hourly',
  allDurations: [
    { id: 'today', label: 'Today', calendarType: 'today', periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'yesterday', label: 'Yesterday', calendarType: 'yesterday', periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'previous_7_days', label: 'Last 7 Days', x: 7, xPeriod: 'day', periodicities: ['hourly', 'daily'] },
    { id: 'current_week', label: 'Current Week', calendarType: 'current_week', periodicities: ['hourly', 'daily'] },
    { id: 'current_month', label: 'Current Month', calendarType: 'current_month', periodicities: ['daily', 'weekly'] },
    { id: 'previous_month', label: 'Previous Month', calendarType: 'previous_month', periodicities: ['daily', 'weekly'] },
    { id: 'previous_3_month', label: 'Last 3 Months', x: 3, xPeriod: 'month', periodicities: ['daily', 'weekly'] },
    { id: 'current_year', label: 'Current Year', calendarType: 'current_year', periodicities: ['weekly', 'monthly'] },
  ],
} as unknown as TimeTabUIConfig;

export interface TimeWindow {
  startTime: number;
  endTime: number;
}

/** The config to actually drive the picker from: the host-provided one when it
 *  carries a duration roster, else the built-in default. Guards against a
 *  non-null timeConfig that has no `allDurations` (which a plain `?? default`
 *  would miss), so the date picker never collapses to just "Custom". */
export function effectiveTimeTab(tc: TimeTabUIConfig | undefined): TimeTabUIConfig {
  const durs = (tc as { allDurations?: unknown[] } | undefined)?.allDurations;
  return tc && Array.isArray(durs) && durs.length > 0 ? tc : DEFAULT_LOCAL_TIME_TAB;
}

const DAY_MS = 86_400_000;

export function titleCase(s: string): string {
  if (!s) return s;
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Picker mode. The SDK config uses `linkTimeWith`; the host's runtime `timeConfig`
 *  prop uses `pickerType`; `timeType` is a legacy alias. We accept all three. */
export function timeMode(tc: TimeTabUIConfig | undefined): TimeMode {
  const raw = String(
    (tc as { linkTimeWith?: string } | undefined)?.linkTimeWith ??
      (tc as { pickerType?: string } | undefined)?.pickerType ??
      (tc as { timeType?: string } | undefined)?.timeType ??
      'local',
  );
  return raw === 'fixed' || raw === 'global' ? raw : 'local';
}

/** The GTP settings snapshot the configurator persists (durations + linked id). */
interface GlobalSnapshot {
  globalTimepickerId?: string;
  allDurations?: Duration[];
  defaultDurationId?: string;
}

/** Resolve the ACTIVE duration expression for the current mode. */
function activeDuration(tc: TimeTabUIConfig | undefined): Duration | undefined {
  if (!tc) return undefined;
  const mode = timeMode(tc);
  if (mode === 'fixed') {
    // SDK config nests it at `fixed.duration`; the host's runtime timeConfig puts
    // the resolved expression at `fixedDuration`. Accept either.
    const fd =
      (tc as { fixed?: { duration?: Record<string, unknown> } }).fixed?.duration ??
      (tc as { fixedDuration?: Record<string, unknown> }).fixedDuration;
    if (fd) {
      return {
        navigation: (fd.navigation as string) ?? 'Previous',
        x: Number(fd.x) || 0,
        xPeriod: (fd.xPeriod as string) ?? 'day',
        xEvent: (fd.xEvent as string) ?? 'Now',
        y: Number(fd.y) || 0,
        yPeriod: (fd.yPeriod as string) ?? 'day',
        yEvent: (fd.yEvent as string) ?? 'Now',
      };
    }
  }
  if (mode === 'global') {
    const g = (tc as { global?: GlobalSnapshot }).global;
    const durs = g?.allDurations ?? [];
    return durs.find((d) => d.id === g?.defaultDurationId) ?? durs[0];
  }
  // local
  return tc.allDurations?.find((d) => d.id === tc.defaultDurationId) ?? tc.allDurations?.[0];
}

/** Compute [startTime, endTime] from the SDK time config for any mode. */
export function computeRange(tc: TimeTabUIConfig | undefined, now = Date.now()): TimeWindow {
  const dur = activeDuration(tc);
  const cycleTime = (tc?.cycleTime ?? undefined) as CycleTime | undefined;
  if (dur) return resolveDurationWindow(dur, now, cycleTime);
  return { startTime: now - DAY_MS, endTime: now };
}

// ─── Periodicity ──────────────────────────────────────────────────────────────

const PERIODICITY_ORDER = ['Minute', 'Hourly', 'Daily', 'Weekly', 'Monthly'];
const PERIODICITY_MS: Record<string, number> = {
  Minute: 60_000,
  Hourly: 3_600_000,
  Daily: 86_400_000,
  Weekly: 7 * 86_400_000,
  Monthly: 30 * 86_400_000,
};

// Coarsest-first (Monthly → Minute), so the dropdown reads high-to-low and the
// default selection (options[0]) is the COARSEST valid periodicity — matching the
// line chart. (Previously finest-first, which defaulted to Minute → "No Data" for
// short ranges like Last 24 Hours where minute-resolution data may be absent.)
function orderDescending(list: string[]): string[] {
  return [...new Set(list)].sort((a, b) => PERIODICITY_ORDER.indexOf(b) - PERIODICITY_ORDER.indexOf(a));
}

const PRESET_MINS: Record<string, number> = { minute: 1, hour: 60, day: 1440, week: 10080, month: 43200, year: 525600 };

/** Valid periodicities for a preset (explicit list, else calendar/rolling heuristic). */
export function presetPeriodicities(preset: Duration | undefined): string[] {
  if (!preset) return orderDescending(PERIODICITY_ORDER);
  if (preset.periodicities?.length) return orderDescending(preset.periodicities.map(titleCase));
  if (preset.calendarType) {
    switch (preset.calendarType) {
      case 'today':
      case 'yesterday': return ['Hourly', 'Minute'];
      case 'current_week':
      case 'previous_week': return ['Daily', 'Hourly'];
      case 'current_month':
      case 'previous_month': return ['Weekly', 'Daily', 'Hourly'];
      default: return orderDescending(PERIODICITY_ORDER);
    }
  }
  if (typeof preset.x === 'number' && preset.xPeriod) {
    const mins = preset.x * (PRESET_MINS[preset.xPeriod] ?? 1440);
    if (mins <= 1440) return ['Hourly', 'Minute'];
    if (mins <= 10080) return ['Daily', 'Hourly'];
    if (mins <= 43200) return ['Weekly', 'Daily', 'Hourly'];
    return ['Monthly', 'Weekly', 'Daily'];
  }
  return orderDescending(PERIODICITY_ORDER);
}

/** Valid periodicities for an arbitrary [start,end] span (custom range). */
export function rangePeriodicities(startMs: number, endMs: number): string[] {
  const span = endMs - startMs;
  if (span <= 0) return orderDescending(PERIODICITY_ORDER);
  const MAX_BUCKETS = 1000;
  const valid = PERIODICITY_ORDER.filter((p) => span >= PERIODICITY_MS[p] && span / PERIODICITY_MS[p] <= MAX_BUCKETS);
  return orderDescending(valid.length ? valid : ['Minute']);
}

/** Coarsest valid periodicity a freshly loaded widget defaults to. */
export function defaultPeriodicity(tc: TimeTabUIConfig | undefined): string {
  if (timeMode(tc) === 'fixed') {
    // Fixed mode carries its periodicity on the Set Duration expression. Read it
    // from whichever shape the host hands us: the SDK config nests it at
    // `fixed.duration.periodicity`; the rich runtime timeConfig puts it on
    // `fixedDuration.periodicity` and/or the top-level `defaultPeriodicity`.
    const fd =
      (tc as { fixed?: { duration?: { periodicity?: string } } } | undefined)?.fixed?.duration ??
      (tc as { fixedDuration?: { periodicity?: string } } | undefined)?.fixedDuration;
    const p = fd?.periodicity ?? tc?.defaultPeriodicity;
    if (p) return titleCase(p);
  }
  const dur = activeDuration(tc);
  const opts = presetPeriodicities(dur);
  return opts[0] ?? titleCase(tc?.defaultPeriodicity || 'Hourly');
}

/**
 * Choose the periodicity after a duration/range change.
 *
 * 1. PRESERVE the current periodicity whenever it's still valid for the new range.
 * 2. Otherwise pick the CLOSEST valid periodicity by granularity (not the coarsest).
 *
 * This is critical for a HISTOGRAM: the periodicity sets the aggregation
 * granularity, so it drives the value magnitudes (hourly sums ~2.9k vs daily sums
 * ~70k) — and the user's fixed bins only match one magnitude. Keeping the current
 * periodicity (or, when unavailable, the nearest one) keeps the transition smooth
 * and the bins meaningful. Minute is de-prioritised on ties because backends often
 * have no minute-resolution data (empty slots → blank chart). (`touched` kept for
 * call-site compatibility; no longer forces a reset.)
 */
export function pickPeriodicity(options: string[], current: string, _touched?: boolean): string {
  if (!options.length) return current;
  if (options.includes(current)) return current;
  const rank = (p: string) => {
    const i = PERIODICITY_ORDER.indexOf(p);
    return i === -1 ? 0 : i;
  };
  const cur = rank(current);
  return [...options].sort((a, b) => {
    const da = Math.abs(rank(a) - cur);
    const db = Math.abs(rank(b) - cur);
    if (da !== db) return da - db; // closest granularity wins
    const am = a === 'Minute' ? 1 : 0;
    const bm = b === 'Minute' ? 1 : 0;
    if (am !== bm) return am - bm; // avoid Minute on a tie (often no data)
    return rank(a) - rank(b); // else prefer the finer one (smaller values)
  })[0];
}
