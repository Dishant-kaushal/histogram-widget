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
  /** Previous-period buckets returned by resolveAndCompute in comparison mode
   *  (index-aligned to `slots`). Present only when comparisonStartTime/End sent. */
  comparisonSlots?: SeriesSlot[];
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

/** A resolvable duration expression (preset) — the shape resolveDurationWindow reads. */
export interface Duration {
  id?: string;
  label?: string;
  calendarType?: string;
  navigation?: string;
  x?: number;
  xPeriod?: string;
  xEvent?: string;
  y?: number;
  yPeriod?: string;
  yEvent?: string;
  periodicities?: string[];
}

/** Cycle-time (shift anchor) fields read by resolveDurationWindow. Tolerant of
 *  string|number|null the SDK emits. */
export interface CycleTime {
  identifier?: string;
  hour?: string | number;
  minute?: string | number;
  dayOfWeek?: number | null;
  date?: string | number;
  month?: string | number | null;
  year?: string | number;
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
/** The runtime time config the host passes to the widget as `props.timeConfig`
 *  and stores on the envelope. RICH shape (mirrors the line chart) — carries the
 *  full duration roster + default periodicity + picker mode so the widget can
 *  rebuild the date picker and derive the initial window/periodicity after a
 *  save + refresh (the host does NOT pass the raw SDK `timeTabConfig`). */
export interface HostTimeConfig {
  /** 'local' | 'fixed' (global is normalized to 'local' for the host engine). */
  type?: 'local' | 'fixed';
  pickerType?: 'local' | 'fixed' | 'global';
  startTime?: number | null;
  endTime?: number | null;
  fixedDuration?: HostDefaultDuration | Record<string, unknown> | null;
  defaultDurationId?: string;
  allDurations?: HostDefaultDuration[];
  defaultPeriodicity?: string;
  timezone: string;
  /** @deprecated the host derives the window from allDurations + defaultDurationId. */
  defaultDuration?: HostDefaultDuration;
  cycleTime: HostCycleTime | null;
  shifts: unknown[];
  /** Aggregation operator for shift buckets. */
  shiftAggregator?: string;
  /** Comparison Mode is enabled → the widget offers a Compare toggle. */
  comparisonMode?: boolean;
  /** Deviation color pattern for comparison mode. */
  deviationPattern?: string;
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
  /** Bar color for this source's bins (Figma "Color *"). All of a source's bars use it. */
  color: string;
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

/** A user-added y-axis. A default Y axis (Left) always exists; each added axis
 *  binds a single data source and sits on the Left or Right side of the chart. */
export interface HistogramAxis {
  _id: string;
  name: string;
  /** The single data source plotted against this axis. */
  dataSourceId: string;
  /** Which side of the chart this axis sits on. */
  side: 'left' | 'right';
}

/** @deprecated superseded by {@link HistogramAxis} (single source + side). */
export interface HistogramRightAxis {
  _id: string;
  name: string;
  dataSourceIds: string[];
}

export type PlotLineValueType = 'Fixed' | 'Dynamic';

export interface HistogramPlotLine {
  _id: string;
  name: string;
  color: string;
  /** Fixed = a static y value; Dynamic = the value comes from a bound device topic. */
  valueType?: PlotLineValueType;
  value: number;
  /** Dynamic value binding — "{{uns:wsId://path}}". The widget draws the plot line
   *  at the latest resolved value of this topic. Field name MUST be `unsPath`. */
  unsPath?: string;
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

/** One histogram chart definition. A widget holds a list of these; the widget
 *  renders the ACTIVE one, with a title switcher when there is more than one
 *  (mirrors the Line Chart's ChartInstance model). Every field here is per-chart;
 *  only `style` (and time) are shared at the widget level. */
export interface HistogramChart {
  _id: string;
  chartTitle: string;
  /** Optional long-form description — surfaced via the widget's info icon. */
  description?: string;
  chartLabel: string;
  dataSources: HistogramDataSource[];
  /** Chart-level bin ranges (From/To), applied to every data source. */
  bins: Bin[];
  /** User-added axes — each binds one data source to the Left or Right side.
   *  The default Y axis (named by {@link leftAxisName}) always exists. */
  axes?: HistogramAxis[];
  /** @deprecated superseded by {@link axes}. */
  rightAxes?: HistogramRightAxis[];
  /** Editable name of the default Y axis (Left). */
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
}

export interface HistogramUIConfig {
  /** The charts in this widget. The widget renders the active one. */
  charts: HistogramChart[];
  /** Which chart is active (persisted); the widget falls back to charts[0]. */
  activeChartId: string | null;
  /** Shared styling across all charts (Style tab). */
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
  | {
      type: 'TIME_CHANGE';
      payload: {
        startTime: string;
        endTime: string;
        periodicity: string;
        /** Comparison mode — previous-period window; the backend returns
         *  comparisonSlots in the same resolveAndCompute call. */
        comparisonStartTime?: string;
        comparisonEndTime?: string;
      };
    }
  | { type: 'FILTER_CHANGE'; payload: Record<string, unknown> };

/** A normalized data point the widget bins client-side. */
export interface SeriesPoint {
  time: number; // ms epoch
  value: number;
}
