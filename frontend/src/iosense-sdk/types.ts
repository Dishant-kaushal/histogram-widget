// ─── UNS + series (shared, mirrors the platform DataLayer contract) ──────────

export interface UNSNode {
  id: string;
  type: string;
  name?: string;
  path: string | null;
  parentId: string | null;
}

export interface SeriesSlot {
  from: number;
  to: number;
  label: string;
  value: number | null;
  quality: string;
  isPartial?: boolean;
}

export interface SeriesAggregation {
  operator: string;
  downscale: number;
  resolution: string;
}

export interface SeriesMeta {
  type: string;
  key: string;
  unit: string | null;
  dataPrecision: number | null;
  aggregation: SeriesAggregation;
  devID: string;
  sensor: string;
}

export interface SeriesPayload {
  __type: 'series';
  path: string;
  meta: SeriesMeta;
  range: { from: number; to: number };
  slots: SeriesSlot[];
}

/** A shift window (time-of-day range) — forwarded to resolveAndCompute. Unused
 *  by the histogram but referenced by the shared api.ts signature. */
export interface ShiftWindow {
  id: string;
  name: string;
  color: string;
  startTime: string; // "HH:mm"
  endTime: string; // "HH:mm"
}

// ─── Bindings / DataLayer ────────────────────────────────────────────────────

export interface ScalarBinding {
  key: string;
  topic: string;
}
export interface SeriesBinding {
  key: string;
  topic: string;
  type: 'series';
  aggregation?: SeriesAggregation;
}
export type BindingEntry = ScalarBinding | SeriesBinding;

export interface DataEntry {
  key: string;
  value: string | number | null | SeriesPayload;
}

// ─── Time — SDK TimeTabConfiguration types (re-exported) + host shape ────────

import type {
  TimeTabUIConfig,
  GTPPreset,
  GTPShift,
  GTPCycleTimeConfig,
} from '@faclon-labs/design-sdk/TimeTabConfiguration';
export type { TimeTabUIConfig, GTPPreset, GTPShift, GTPCycleTimeConfig };

export interface GTPGlobalTimepicker {
  id: string;
  name: string;
  timezone?: string;
  cycleTime?: GTPCycleTimeConfig;
  allDurations?: GTPPreset[];
  defaultDurationId?: string;
  shifts?: GTPShift[];
  shiftAggregator?: string;
  comparisonMode?: boolean;
  futureDaysAllowed?: string;
}

export interface GTPChartSource {
  id: string;
  name: string;
}
export interface GTPChart {
  id: string;
  name: string;
  sources: GTPChartSource[];
}

/**
 * Host (iosense Lens) time config shape — MUST match the host DataLayer's
 * `TimeConfig` exactly (src/app/data-layer/types + time-calculator). The query
 * engine reads `timeConfig` directly: `cycleTime.hour` (never null) and
 * `defaultDuration.{xPeriod,xEvent,yPeriod,yEvent,navigation,x,y,periodicities}`.
 * A mismatched shape throws "Cannot read properties of undefined (reading 'hour')".
 */
export interface HostCycleTime {
  identifier?: string;
  hour: string;
  minute: string;
  dayOfWeek: number;
  date: string;
  month: string;
  year?: string;
}
export interface HostDefaultDuration {
  id: string;
  label: string;
  calendarType?: string;
  isBuiltIn?: boolean;
  navigation: 'Previous' | 'Next';
  x: number;
  xPeriod: string;
  xEvent: string;
  y: number;
  yPeriod: string;
  yEvent: string;
  periodicities?: string[];
}
export interface HostTimeConfig {
  timezone: string;
  defaultDuration: HostDefaultDuration;
  cycleTime: HostCycleTime;
  shifts: unknown[];
}

// ─── Histogram domain model (ported from IO Lens v1 actualHistogram) ─────────

/** A value-range bucket. Bar height = number of points whose value fell in [start, end). */
export interface Bin {
  start: number;
  end: number;
  /** Optional — the redesigned Bins UI only edits From/To; name falls back to "Bin {i}". */
  binName?: string;
  /** Optional — bars are auto-colored from a palette when not set. */
  color?: string;
}

/** One named data source: a UNS series topic + its own bin definition. */
export interface HistogramDataSource {
  _id: string;
  name: string;
  /** Bindable — stores "{{uns:wsId://path}}". Field name MUST be `unsPath`. */
  unsPath: string;
  /** Decimal precision for displayed frequencies / drill-down (v1 "Data Precision"). */
  dataPrecision: number;
  /** Measurement unit label (v1 series unit) — shown alongside values in tooltips. */
  unit?: string;
  /** v1 "Enable Data Source Line Chart" — allow per-bin hour-of-day drill-down for this source. */
  enableLineChart: boolean;
  /** v1 "Automatic Bin Width" — bins auto-generated from a [min,max] range vs manually added. */
  automaticBinWidth?: boolean;
  /** @deprecated bins are now chart-level (HistogramUIConfig.bins). Kept optional for back-compat. */
  bins?: Bin[];
}

export type HistogramAggregation = 'cumulative' | 'daily';

/** A user-added right y-axis. The Left axis is implicit (name "Left") and holds
 *  every data source not assigned to a right axis. */
export interface HistogramRightAxis {
  _id: string;
  name: string;
  /** Data source _ids plotted against this right axis. */
  dataSourceIds: string[];
}

export type PlotLineValueType = 'Fixed' | 'Dynamic';

export interface HistogramPlotLine {
  _id: string;
  name: string;
  color: string;
  /** Fixed = a static y value; Dynamic = derived from data (e.g. mean). */
  valueType?: PlotLineValueType;
  value: number;
  lineWidth: number;
  dashStyle: string;
}

/** A styled normal-distribution overlay line (Figma "Distribution Line" list). */
export interface HistogramDistributionLine {
  _id: string;
  name: string;
  color: string;
  lineWidth: number;
  dashStyle: string;
}

export type StylingFontWeight = 'Regular' | 'Medium' | 'Semi-Bold' | 'Bold';
export type StylingWidgetSize = 'Small' | 'Medium' | 'Large' | 'Custom';

/** Style tab — mirrors the Line/Column chart styling shape, histogram-relevant fields. */
export interface HistogramStyling {
  size: { preset: StylingWidgetSize; customWidth?: number; customHeight?: number; lockAspectRatio?: boolean };
  card: { wrapInCard: boolean; backgroundColor: string; borderColor: string; borderWidth: number; borderRadius: number };
  hideElements: { settingsIcon: boolean; exportIcon: boolean; chartTitle: boolean };
  advancedEnabled: boolean;
  chartTitle: { fontSize: number; fontColor: string; fontWeight: StylingFontWeight };
  xAxisLabel: { textColor: string; lineColor: string; dataPointColor: string };
  yAxisLabel: { textColor: string; lineColor: string; dataPointColor: string };
  /** Frequency labels drawn inside each bar. */
  dataLabels: { color: string; fontSize: number };
  /** Normal-distribution spline overlay. */
  distribution: { color: string; width: number; dashStyle: string };
  misc: { gridLineColor: string; legendTextColor: string };
}

export interface HistogramUIConfig {
  chartTitle: string;
  /** Optional long-form description — surfaced via the widget's info icon. */
  description?: string;
  chartLabel: string;
  dataSources: HistogramDataSource[];
  /** Chart-level bin ranges (From/To), applied to every data source. */
  bins: Bin[];
  /** User-added right y-axes; Left is implicit and holds unassigned sources. */
  rightAxes?: HistogramRightAxis[];
  /** Editable name of the default Left axis. */
  leftAxisName?: string;
  /** Named distribution overlay lines (Figma "Distribution Line" list). */
  distributionLines?: HistogramDistributionLine[];
  aggregationMode: HistogramAggregation;
  /** v1 "Include Start & End" — count values sitting exactly on a bin's start/end boundary. */
  includeStartEnd: boolean;
  showBinRanges: boolean;
  showLineChart: boolean;
  showDistributionLine: boolean;
  showPlotLines: boolean;
  plotLines: HistogramPlotLine[];
  style: HistogramStyling;
}

export interface HistogramEnvelope {
  _id: string;
  type: 'HistogramWidget';
  general: { title: string };
  timeConfig?: HostTimeConfig | TimeTabUIConfig;
  timeTabConfig?: TimeTabUIConfig;
  uiConfig: HistogramUIConfig;
  dynamicBindingPathList: BindingEntry[];
}

// ─── Widget events (widget → host) ───────────────────────────────────────────

export type WidgetEvent =
  | { type: 'TIME_CHANGE'; payload: { startTime: string; endTime: string; periodicity: string } }
  | { type: 'FILTER_CHANGE'; payload: Record<string, unknown> };

/** A normalized data point the widget bins client-side. */
export interface SeriesPoint {
  time: number; // ms epoch
  value: number;
}
