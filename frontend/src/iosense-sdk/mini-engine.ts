import {
  HistogramEnvelope,
  HistogramUIConfig,
  DataEntry,
  SeriesPayload,
  HostTimeConfig,
  TimeTabUIConfig,
} from './types';
import { resolveAndCompute } from './api';

interface MiniEngineCtx {
  authentication: string;
  override?: { startTime: number; endTime: number };
  /** Periodicity override from the widget. Sent to backend so series aggregate at this granularity. */
  periodicity?: string;
}

export interface MiniEngineResult {
  config: HistogramUIConfig;
  data: DataEntry[];
  /** Populated when resolution failed (network, auth, malformed binding). */
  error?: string;
}

export async function resolve(
  envelope: HistogramEnvelope,
  ctx: MiniEngineCtx,
): Promise<MiniEngineResult> {
  const { startTime, endTime } = computeWindow(envelope, ctx.override);
  const bindings = envelope.dynamicBindingPathList ?? [];

  if (bindings.length === 0) return { config: envelope.uiConfig, data: [] };

  const UNS_TOPIC_RE = /^uns:[^/]+:\/\//;
  const invalidTopics: string[] = [];
  const validBindings = bindings.filter(({ topic }) => {
    if (!UNS_TOPIC_RE.test(topic)) {
      invalidTopics.push(topic);
      console.error(
        `[MiniEngine] Invalid topic format: "${topic}". Expected "uns:wsId://path". ` +
          `Check that resolveUNSValue returned a resolved topic — it logs a warning on cache miss.`,
      );
      return false;
    }
    return true;
  });

  if (validBindings.length === 0 && bindings.length > 0) {
    return {
      config: envelope.uiConfig,
      data: [],
      error: `All ${bindings.length} binding(s) had invalid topic format. First invalid: "${invalidTopics[0]}".`,
    };
  }

  try {
    // Periodicity lives on the raw SDK config; `timeConfig` is now the host shape.
    const periodicity = ctx.periodicity ?? envelope.timeTabConfig?.defaultPeriodicity;
    const resolution = periodicityToResolution(periodicity);
    const items = await resolveAndCompute(
      ctx.authentication,
      validBindings.map((binding) => {
        const base =
          'type' in binding && binding.type === 'series'
            ? { key: binding.key, topic: binding.topic, type: 'series' as const }
            : { key: binding.key, topic: binding.topic };
        // Histogram bins the raw series client-side; keep the requested bucket
        // resolution when available so we get points to count.
        if (resolution && 'type' in base && base.type === 'series') {
          return { ...base, aggregation: { operator: 'mean', downscale: 1, resolution } };
        }
        return base;
      }),
      startTime,
      endTime,
      resolution,
    );
    const data: DataEntry[] = items.map((item) => ({ key: item.key, value: item.value }));
    console.log(
      '[MiniEngine] response →',
      data.map((d) => {
        if (d.value && typeof d.value === 'object' && '__type' in d.value) {
          const p = d.value as SeriesPayload;
          return { key: d.key, slotCount: p.slots?.length ?? 0 };
        }
        return { key: d.key, scalar: d.value };
      }),
    );
    return { config: envelope.uiConfig, data };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error('[MiniEngine] resolveAndCompute failed:', err);
    return { config: envelope.uiConfig, data: [], error: message };
  }
}

/** Extract a SeriesPayload for a binding key — tolerant of the wrapped dev shape
 *  and the raw production shape (slots on the entry itself). */
export function getSeriesData(key: string, data: DataEntry[]): SeriesPayload | null {
  const entry = data.find((d) => d.key === key) as
    | (DataEntry & Partial<SeriesPayload>)
    | undefined;
  if (!entry) return null;
  const v = entry.value as SeriesPayload | string | number | null | undefined;
  if (v !== null && typeof v === 'object' && (v as SeriesPayload).__type === 'series') {
    return v as SeriesPayload;
  }
  if (Array.isArray(entry.slots)) {
    return {
      __type: 'series',
      path: entry.path ?? '',
      meta: entry.meta as SeriesPayload['meta'],
      range: entry.range as SeriesPayload['range'],
      slots: entry.slots as SeriesPayload['slots'],
    };
  }
  return null;
}

function computeWindow(
  envelope: HistogramEnvelope,
  override?: { startTime: number; endTime: number },
): { startTime: number; endTime: number } {
  if (override) return override;
  const now = Date.now();
  // Resolve the local preview window from the raw SDK config (durationId +
  // allDurations); `timeConfig` is the host shape and doesn't carry those.
  const tc = envelope.timeTabConfig as TimeTabUIConfig | undefined;
  if (!tc) return { startTime: now - 86_400_000, endTime: now };
  const dur = tc.allDurations?.find((d) => d.id === tc.defaultDurationId);
  if (dur) return { startTime: computePresetStart(dur, now), endTime: now };
  return { startTime: now - 86_400_000, endTime: now };
}

function periodicityToResolution(p?: string): string | undefined {
  if (!p) return undefined;
  switch (p.toLowerCase()) {
    case 'minute': return 'minute';
    case 'hourly': return 'hour';
    case 'daily': return 'day';
    case 'weekly': return 'week';
    case 'monthly': return 'month';
    default: return p;
  }
}

interface PresetLike {
  x?: number;
  xPeriod?: string;
  calendarType?: string;
}

function computePresetStart(dur: PresetLike, now: number): number {
  const periodMs: Record<string, number> = {
    minute: 60_000,
    hour: 3_600_000,
    day: 86_400_000,
    week: 7 * 86_400_000,
    month: 30 * 86_400_000,
    year: 365 * 86_400_000,
  };
  // Calendar presets (today / current_week / …) — approximate to a sensible window.
  if (dur.calendarType) {
    switch (dur.calendarType) {
      case 'today':
      case 'yesterday': return now - 86_400_000;
      case 'current_week':
      case 'previous_week': return now - 7 * 86_400_000;
      case 'current_month':
      case 'previous_month': return now - 30 * 86_400_000;
      default: return now - 86_400_000;
    }
  }
  const x = dur.x ?? 1;
  return now - x * (periodMs[dur.xPeriod ?? ''] ?? 86_400_000);
}
