'use client';

import React, { useEffect, useMemo, useRef, useState } from 'react';
import type Highcharts from 'highcharts';
import * as XLSX from 'xlsx';

// Load Highcharts' offline exporting so onChartReady instances expose exportChart()
// for the PNG download. Client-only (these modules touch browser globals).
if (typeof window !== 'undefined') {
  import('highcharts/modules/exporting');
  import('highcharts/modules/offline-exporting');
}

import { ColumnChart } from '@faclon-labs/design-sdk/ColumnChart';
import type { ColumnSeries } from '@faclon-labs/design-sdk/ColumnChart';
import { ComboLineChart } from '@faclon-labs/design-sdk/ComboLineChart';
import type { ComboLineSeries } from '@faclon-labs/design-sdk/ComboLineChart';
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import type { LineSeries } from '@faclon-labs/design-sdk/LineChart';
import type { ChartPlotLine, ChartPointClickContext } from '@faclon-labs/design-sdk/Chart';
import { ChartActions, exportChart } from '@faclon-labs/design-sdk/Chart';
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
import { DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk/DropdownMenu';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { Maximize2, Minimize2, ChevronDown } from 'react-feather';
import type {
  Bin,
  DataEntry,
  HistogramChart,
  HistogramDataSource,
  HistogramStyling,
  HistogramUIConfig,
  SeriesPoint,
  TimeTabUIConfig,
  WidgetEvent,
} from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import { HistogramTimeBar } from './HistogramTimeBar';
import { computeRange, defaultPeriodicity, effectiveTimeTab, timeMode } from './histogram-time';
import {
  binCounts,
  binLabel,
  createGroups,
  dailyBinCounts,
  gaussianPerBin,
  hasBinName,
  HOUR_CATEGORIES,
  hourlyCountsForBin,
  pointInBin,
  slotsToPoints,
} from './histogram-utils';
import './HistogramWidget.css';

interface HistogramWidgetProps {
  config: HistogramUIConfig;
  data: DataEntry[];
  /** Explicit resolve-in-flight flag from the data layer. Preferred over
   *  inferring from empty data (which never clears when a resolve returns []). */
  loading?: boolean;
  /** Raw SDK time config — drives the above-chart time picker + TIME_CHANGE emits. */
  timeTabConfig?: TimeTabUIConfig;
  onEvent?: (event: WidgetEvent) => void;
}

const DEFAULT_STYLE: HistogramStyling = {
  size: { preset: 'Medium', customWidth: 880, customHeight: 400, lockAspectRatio: false },
  card: { wrapInCard: true, backgroundColor: '#FFFFFF', borderColor: '#EEEEEE', borderWidth: 1, borderRadius: 8 },
  hideElements: { settingsIcon: false, exportIcon: false, chartTitle: false },
  advancedEnabled: false,
  chartTitle: { fontSize: 18, fontColor: '#050505', fontWeight: 'Semi-Bold' },
  xAxisLabel: { textColor: '#7a88b0', lineColor: '#DEE1E3', dataPointColor: '#7a88b0' },
  yAxisLabel: { textColor: '#7a88b0', lineColor: '#333333', dataPointColor: '#7a88b0' },
  dataLabels: { color: '#FFFFFF', fontSize: 11 },
  distribution: { color: '#FF6B6B', width: 3, dashStyle: 'Solid' },
  misc: { gridLineColor: '#e5e9f2', legendTextColor: '#3b4560' },
};

const DEFAULT_CHART: HistogramChart = {
  _id: 'chart_default',
  chartTitle: 'Histogram',
  chartLabel: 'Parameter',
  dataSources: [],
  bins: [],
  aggregationMode: 'cumulative',
  includeStartEnd: false,
  showBinRanges: false,
  showLineChart: false,
  showDistributionLine: false,
  showPlotLines: false,
  plotLines: [],
};

/** Resolve the widget's chart list, tolerating the legacy flat single-histogram
 *  shape (wrap it into one chart) so already-deployed configs keep working. */
function resolveCharts(config: unknown): HistogramChart[] {
  const c = config as (Partial<HistogramUIConfig> & Partial<HistogramChart>) | undefined;
  if (Array.isArray(c?.charts) && c!.charts!.length) {
    return c!.charts!.map((ch) => ({ ...DEFAULT_CHART, ...ch, plotLines: ch.plotLines ?? [] }));
  }
  // Legacy flat config → wrap into a single chart.
  if (c && (Array.isArray(c.dataSources) || Array.isArray(c.bins) || c.chartTitle)) {
    return [{ ...DEFAULT_CHART, ...(c as Partial<HistogramChart>), _id: c._id || 'chart_1', plotLines: c.plotLines ?? [] }];
  }
  return [{ ...DEFAULT_CHART }];
}

const TOPIC_REGEX = /^\{\{(.+)\}\}$/;

const FONT_WEIGHT_MAP: Record<string, string> = {
  Regular: '400',
  Medium: '500',
  'Semi-Bold': '600',
  Bold: '700',
};

// Bars are auto-colored from this palette (bins no longer carry a color).
const BAR_PALETTE = ['#4d79ff', '#7bd88f', '#f0a050', '#f07a7a', '#c77dff', '#4dd0e1', '#85b8ff', '#ffb74d'];
const binColor = (i: number, override?: string) => override || BAR_PALETTE[i % BAR_PALETTE.length];

interface BarPoint {
  y: number;
  color: string;
  sourceIdx: number;
  binIdx: number;
  bin: Bin;
  sourceTitle: string;
}

interface DrillState {
  sourceIdx: number;
  binIdx: number;
}

interface ClickTarget {
  sourceIdx: number;
  binIdx: number;
}

type ChartModel =
  | {
      kind: 'column';
      categories: string[];
      series: ColumnSeries[];
      /** Distribution overlay(s) as combo line series — when present the view
       *  renders via ComboLineChart (bars + line) instead of a bare ColumnChart. */
      lineSeries?: ComboLineSeries[];
      hcOptions: Highcharts.Options;
      showLegend: boolean;
      xAxisTitle: string;
      /** Maps an SDK point-click to a (source, bin) pair for drill-down. */
      resolveClick: (ctx: ChartPointClickContext) => ClickTarget | null;
    }
  | {
      kind: 'line';
      categories: string[];
      series: LineSeries[];
      hcOptions: Highcharts.Options;
      xAxisTitle: string;
      showLegend?: boolean;
    };

export const HistogramWidget: React.FC<HistogramWidgetProps> = ({ config, data, loading, timeTabConfig, onEvent }) => {
  // Shared styling lives at the widget level; each chart carries its own data.
  const style: HistogramStyling = { ...DEFAULT_STYLE, ...((config as Partial<HistogramUIConfig>)?.style ?? {}) };
  // A widget holds a list of charts and renders the ACTIVE one. `previewChartId`
  // is a runtime-only override (the in-widget title switcher) — never persisted.
  const charts = resolveCharts(config);
  // Whether the host config carries a REAL chart (vs. resolveCharts' fallback
  // default). Used to keep the header title blank until the user adds a chart.
  const hasRealChart = ((): boolean => {
    const c = config as (Partial<HistogramUIConfig> & Partial<HistogramChart>) | undefined;
    if (Array.isArray(c?.charts) && c!.charts!.length > 0) return true;
    return !!(c && (Array.isArray(c.dataSources) || Array.isArray(c.bins) || c.chartTitle));
  })();
  const [previewChartId, setPreviewChartId] = useState<string | null>(null);
  const persistedActiveId = (config as Partial<HistogramUIConfig>)?.activeChartId ?? null;
  const activeChart = charts.find((c) => c._id === (previewChartId ?? persistedActiveId)) ?? charts[0];
  const chartIndex = Math.max(0, charts.findIndex((c) => c._id === activeChart._id));
  // `cfg` = the active chart's per-chart config (already defaulted by resolveCharts).
  const cfg: HistogramChart = activeChart;
  const chartInstance = useRef<Highcharts.Chart | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);

  // Emit TIME_CHANGE once on mount so the host DataLayer registers this widget
  // and fetches its initial window. Refs hold the latest values so the mount-only
  // effect reads them without re-emitting on every host-pushed time update
  // (which would broadcast this widget's window to the whole dashboard).
  const onEventRef = useRef(onEvent);
  onEventRef.current = onEvent;
  const timeTabRef = useRef(timeTabConfig);
  timeTabRef.current = timeTabConfig;
  useEffect(() => {
    const ev = onEventRef.current;
    const tc = effectiveTimeTab(timeTabRef.current);
    if (!ev) return;
    // Fixed mode is driven entirely by the config's Set Duration expression, which
    // can change after mount — the effect below owns those emits so this mount-only
    // one skips it (avoids a duplicate emit on load).
    if (timeMode(tc) === 'fixed') return;
    const { startTime, endTime } = computeRange(tc);
    ev({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(startTime),
        endTime: String(endTime),
        periodicity: defaultPeriodicity(tc).toLowerCase(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Fixed mode: re-emit TIME_CHANGE whenever the config's fixed duration /
  // periodicity changes so the widget reflects Set Duration edits live (the
  // mount-only effect above can't, and re-emitting on every host time push in
  // local/global mode would rebroadcast this widget's window to the dashboard).
  const fixedKey =
    timeMode(timeTabConfig) === 'fixed'
      ? JSON.stringify({
          d:
            (timeTabConfig as { fixed?: { duration?: unknown } } | undefined)?.fixed?.duration ??
            (timeTabConfig as { fixedDuration?: unknown } | undefined)?.fixedDuration ??
            null,
          c: (timeTabConfig as { cycleTime?: unknown } | undefined)?.cycleTime ?? null,
        })
      : null;
  useEffect(() => {
    if (fixedKey === null) return;
    const ev = onEventRef.current;
    if (!ev) return;
    const tc = effectiveTimeTab(timeTabConfig);
    const { startTime, endTime } = computeRange(tc);
    ev({
      type: 'TIME_CHANGE',
      payload: {
        startTime: String(startTime),
        endTime: String(endTime),
        periodicity: defaultPeriodicity(tc).toLowerCase(),
      },
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fixedKey]);
  // Header menus (info / chart-settings / more), one open at a time.
  const [openMenu, setOpenMenu] = useState<'info' | 'settings' | 'more' | null>(null);
  // Track fullscreen so the export menu can offer "Exit full screen".
  const [isFullscreen, setIsFullscreen] = useState(false);
  useEffect(() => {
    const onFsChange = () => setIsFullscreen(document.fullscreenElement === rootElRef.current);
    document.addEventListener('fullscreenchange', onFsChange);
    return () => document.removeEventListener('fullscreenchange', onFsChange);
  }, []);
  // Chart-control view state (from the gear menu; not persisted to config).
  const [viewLabels, setViewLabels] = useState(false);
  const [viewLegend, setViewLegend] = useState<boolean | null>(null);
  // Cumulative Values = the total distribution across all value ranges (our
  // "cumulative" mode). Off → daily (grouped by weekday).
  const [viewCumulative, setViewCumulative] = useState(cfg.aggregationMode !== 'daily');

  const sources: HistogramDataSource[] = cfg.dataSources ?? [];
  // Bins are chart-level (applied to every source). Manual Bin Range config wins;
  // `bins` below falls back to auto-generated bins over the data range when none
  // are configured (see the useMemo after sourcePoints).
  const configBins: Bin[] = cfg.bins ?? [];

  // `bound` = topic is a resolvable {{...}} binding (what the mini-engine needs).
  const boundSources = sources.filter((s) => TOPIC_REGEX.test((s.unsPath ?? '').trim()));
  // `configured` = the user has added a source with SOME topic. Used for the
  // "not configured" gate so a non-brace topic shows "No Data" (diagnosable),
  // not the misleading "Widget not configured".
  const hasConfiguredSource = sources.some((s) => (s.unsPath ?? '').trim() !== '');

  // Resolved points per data source — the only place the data prop is read.
  // Keys are scoped to the active chart index (charts[ci].dataSources[i].unsPath),
  // matching the configurator's dynamicBindingPathList.
  const sourcePoints: SeriesPoint[][] = useMemo(
    () => sources.map((_, i) => slotsToPoints(getSeriesData(`charts[${chartIndex}].dataSources[${i}].unsPath`, data))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, config, chartIndex],
  );

  // A histogram needs bins to draw bars. Auto-generate a sensible set spanning the
  // resolved data's value range so the chart renders out of the box — e.g. daily
  // consumption sums in the 40k–71k range get 10 bins across that span. We fall
  // back to auto-bins when the user has configured NO bins, OR when their bins
  // miss ALL the data (a stale range like 0–1000 vs values of ~70k) — otherwise a
  // completely-out-of-range bin set would draw an empty chart. Configured bins that
  // actually contain data always win.
  const bins: Bin[] = useMemo(() => {
    const values: number[] = [];
    for (const arr of sourcePoints) for (const p of arr) values.push(p.value);
    const autoBins = (): Bin[] => {
      if (values.length === 0) return [];
      let min = Infinity;
      let max = -Infinity;
      for (const v of values) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
      if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
      // Pad a degenerate (all-equal) range so createGroups yields a usable bin.
      if (max <= min) max = min + Math.max(1, Math.abs(min) * 0.1);
      return createGroups(min, max, 10).map(([start, end]) => ({ start, end }));
    };
    if (configBins.length === 0) return autoBins();
    const anyInBin = values.some((v) =>
      configBins.some((b, i) => pointInBin(v, b, i === configBins.length - 1, cfg.includeStartEnd)),
    );
    return anyInBin || values.length === 0 ? configBins : autoBins();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configBins, sourcePoints, cfg.includeStartEnd]);

  // Cumulative bars: counts per bin, concatenated across data sources (v1 §7.1)
  const barPoints: BarPoint[] = useMemo(() => {
    const pts: BarPoint[] = [];
    sources.forEach((src, sourceIdx) => {
      const counts = binCounts(sourcePoints[sourceIdx] ?? [], bins, cfg.includeStartEnd);
      bins.forEach((bin, binIdx) => {
        pts.push({
          y: counts[binIdx] ?? 0,
          // All of a source's bars share the source's color (consistent across
          // cumulative/daily). Bin-level override still wins if set.
          color: bin.color || src.color || binColor(sourceIdx),
          sourceIdx,
          binIdx,
          bin,
          sourceTitle: src.name || `Source ${sourceIdx + 1}`,
        });
      });
    });
    return pts;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourcePoints, config]);

  const hasAnyData = sourcePoints.some((pts) => pts.length > 0);
  // Prefer the explicit flag; only fall back to the (imperfect) empty-data
  // heuristic when the data layer doesn't provide one.
  const isLoading = loading !== undefined ? loading : boundSources.length > 0 && data.length === 0;
  // A histogram needs bins to draw bars (chart-level Bin Range).
  const hasAnyBins = bins.length > 0;
  const canDrill = sources.some((s) => s.enableLineChart) || cfg.showLineChart;

  const handleBarClick = (sourceIdx: number, binIdx: number) => {
    // v1 "Enable Data Source Line Chart" is per-source; fall back to the global flag.
    if (!(sources[sourceIdx]?.enableLineChart || cfg.showLineChart)) return;
    setDrill({ sourceIdx, binIdx });
    const bin = bins[binIdx];
    onEvent?.({
      type: 'FILTER_CHANGE',
      payload: { drilldown: true, binStart: bin?.start, binEnd: bin?.end, binName: bin?.binName },
    });
  };

  const closeDrill = () => {
    setDrill(null);
    onEvent?.({ type: 'FILTER_CHANGE', payload: { drilldown: false } });
  };

  const plotLines: ChartPlotLine[] | undefined = cfg.showPlotLines
    ? toChartPlotLines(cfg, (pi) => {
        // Dynamic plot line — latest resolved value of the bound topic.
        const pts = slotsToPoints(getSeriesData(`charts[${chartIndex}].plotLines[${pi}].unsPath`, data));
        return pts.length ? pts[pts.length - 1].value : undefined;
      })
    : undefined;

  // Bin-range x-axis labels come from the Style tab toggle.
  // Bin ranges (e.g. "0 - 1000") are always shown on the x-axis (the toggle was removed).
  const showRanges = true;

  // Axis side (config): a default Y axis sits on the Left. If the user added an
  // axis binding this source to the Right, flip the Y axis to the opposite side
  // and title it with the axis name.
  const rightAxis = (cfg.axes ?? []).find(
    (a) => a.side === 'right' && sources.some((s) => s._id === a.dataSourceId),
  );
  // Y-axis title reflects the configured axis: the bound right axis's name, else
  // the default (left) axis name, else "Frequency".
  const yAxisTitle = rightAxis?.name || cfg.leftAxisName || 'Frequency';

  // ── Chart model — the SDK ColumnChart/LineChart do the theming, legend,
  //    export and empty states; `highchartsOptions` carries the histogram-only
  //    rendering (touching bars, per-bin colors, distribution overlay). ────────
  const model: ChartModel = useMemo(() => {
    // ── Drill-down line chart (v1 §9: 24 hardcoded hour buckets) ─────────────
    if (drill) {
      const bin = bins[drill.binIdx];
      const isLast = drill.binIdx === bins.length - 1;
      const counts = bin
        ? hourlyCountsForBin(sourcePoints[drill.sourceIdx] ?? [], bin, isLast, cfg.includeStartEnd)
        : new Array<number>(24).fill(0);
      const label = bin
        ? hasBinName(bin.binName)
          ? bin.binName!
          : `Bin ${drill.binIdx + 1} (${bin.start} - ${bin.end})`
        : 'Bin';
      return {
        kind: 'line',
        categories: HOUR_CATEGORIES,
        series: [{ name: label, data: counts, color: bin?.color || sources[drill.sourceIdx]?.color || binColor(drill.sourceIdx) }],
        xAxisTitle: 'Hour of Day',
        hcOptions: {
          xAxis: { labels: { rotation: -45 } },
          tooltip: {
            useHTML: true,
            formatter: function (this: { key?: string; y?: number }): string {
              return `<b>${this.key}</b> : ${this.y}`;
            },
          },
        } as Highcharts.Options,
      };
    }

    // ── Daily grouped columns (v1 §8.3: one series per bin, one group/day) ───
    if (!viewCumulative) {
      let categories: string[] = [];
      const series: ColumnSeries[] = [];
      const seriesMeta: ClickTarget[] = [];
      sources.forEach((src, sourceIdx) => {
        const grouping = dailyBinCounts(sourcePoints[sourceIdx] ?? [], bins, cfg.includeStartEnd);
        if (grouping.categories.length > categories.length) categories = grouping.categories;
        bins.forEach((bin, binIdx) => {
          const name = hasBinName(bin.binName)
            ? bin.binName!
            : `Bin ${binIdx + 1}${showRanges ? ` (${bin.start} - ${bin.end})` : ''}`;
          series.push({
            name: sources.length > 1 ? `${src.name || `Source ${sourceIdx + 1}`}: ${name}` : name,
            data: grouping.perBin[binIdx] ?? [],
            color: bin.color || src.color || binColor(sourceIdx),
          });
          seriesMeta.push({ sourceIdx, binIdx });
        });
      });
      return {
        kind: 'column',
        categories,
        series,
        showLegend: viewLegend ?? true,
        xAxisTitle: 'Day',
        resolveClick: (ctx) => seriesMeta[ctx.seriesIndex] ?? null,
        hcOptions: {
          plotOptions: {
            column: { borderWidth: 0, cursor: canDrill ? 'pointer' : undefined },
            series: { centerInCategory: true },
          },
          tooltip: {
            useHTML: true,
            formatter: function (this: { key?: string; y?: number; series?: { name?: string } }): string {
              return `<b>${this.key} ${this.series?.name}</b> : ${this.y}`;
            },
          },
        } as Highcharts.Options,
      };
    }

    // ── Cumulative histogram (v1 §8.1) ──────────────────────────────────────
    const categories = barPoints.map((p) => binLabel(p.bin, p.binIdx, showRanges));
    const manyBins = barPoints.length > 10;
    // Distribution overlay(s) — real combo LINE series (rendered via ComboLineChart),
    // one expected-count per bin, spline-smoothed. Named lines (Figma list) take
    // precedence; else the legacy single overlay styled by style.distribution.
    // A histogram has a single data source (per chart), so every named line is a
    // styled overlay of the same aggregate normal fit — they differ only by
    // color/width/dash, not data. (No per-line dataSourceId with one source.)
    const distLines = cfg.distributionLines ?? [];
    const perBin = cfg.showDistributionLine
      ? gaussianPerBin(barPoints.map((p) => p.y), barPoints.map((p) => p.bin))
      : [];
    const lineSeries: ComboLineSeries[] =
      perBin.length === 0
        ? []
        : distLines.length > 0
          ? distLines.map((dl) => ({
              type: 'line' as const,
              name: dl.name || 'Frequency Distribution',
              data: perBin,
              color: dl.color || '#FF6B6B',
              dashStyle: (dl.dashStyle || 'Solid') as Highcharts.DashStyleValue,
              smooth: true,
              showMarkers: false,
            }))
          : [
              {
                type: 'line' as const,
                name: 'Frequency Distribution',
                data: perBin,
                color: style.distribution.color || '#FF6B6B',
                dashStyle: (style.distribution.dashStyle || 'Solid') as Highcharts.DashStyleValue,
                smooth: true,
                showMarkers: false,
              },
            ];

    // One data source = one bar color; the single series carries that color and
    // shows a legend entry named after the data source (Figma / SS).
    const legendSource = sources[0];
    const seriesColor = legendSource?.color || binColor(0);
    const seriesName = legendSource?.name || cfg.chartLabel || 'Frequency';

    // ── Line mode — "Enable Data Source Line Chart" renders the frequency
    //    distribution as a LINE (frequency polygon) instead of bars, plus any
    //    distribution overlay as additional line(s). ──────────────────────────
    if (legendSource?.enableLineChart || cfg.showLineChart) {
      const lineSeriesOut: LineSeries[] = [
        { name: seriesName, data: barPoints.map((p) => p.y), color: seriesColor },
      ];
      if (perBin.length) {
        (distLines.length > 0 ? distLines : [undefined]).forEach((dl) => {
          lineSeriesOut.push({
            name: dl?.name || 'Frequency Distribution',
            data: perBin,
            color: dl?.color || style.distribution.color || '#FF6B6B',
          });
        });
      }
      return {
        kind: 'line',
        categories,
        series: lineSeriesOut,
        showLegend: viewLegend ?? true,
        xAxisTitle: '',
        hcOptions: {
          xAxis: { labels: { rotation: manyBins ? -45 : 0 } },
          tooltip: {
            useHTML: true,
            formatter: function (this: { key?: string; y?: number; series?: { name?: string } }): string {
              return `<b>${this.series?.name}</b> · ${this.key} : ${this.y}`;
            },
          },
        } as Highcharts.Options,
      };
    }

    const hcOptions: Highcharts.Options = {
      xAxis: { labels: { rotation: manyBins ? -45 : 0 } },
      plotOptions: {
        column: {
          pointPadding: 0.03,
          groupPadding: 0.05,
          borderWidth: 0,
          cursor: canDrill ? 'pointer' : undefined,
          dataLabels: {
            enabled: viewLabels,
            inside: true,
            rotation: -90,
            style: {
              color: style.dataLabels.color,
              fontWeight: 'bold',
              fontSize: `${style.dataLabels.fontSize}px`,
              textOutline: 'none',
            },
            formatter: function (this: { y?: number }): string {
              return this.y ? String(this.y) : '';
            },
          },
        },
      },
      tooltip: {
        useHTML: true,
        formatter: function (this: {
          y?: number;
          series?: { type?: string };
          point?: { index?: number };
        }): string {
          // The distribution overlay is a line series (spline via smooth).
          if (this.series?.type === 'line' || this.series?.type === 'spline') {
            return `Frequency Distribution: ${Number(this.y).toFixed(2)}`;
          }
          const idx = this.point?.index ?? 0;
          const p = barPoints[idx];
          const src = p ? sources[p.sourceIdx] : undefined;
          const unit = src?.unit ? ` ${src.unit}` : '';
          const n = (p?.binIdx ?? idx) + 1;
          if (showRanges && p?.bin) return `<b>Bin ${n} (${p.bin.start}-${p.bin.end}${unit})</b> : ${this.y}`;
          if (p?.bin && hasBinName(p.bin.binName)) return `<b>${p.bin.binName}</b> : ${this.y}`;
          return `<b>Bin ${n}</b> : ${this.y}`;
        },
      },
    };

    return {
      kind: 'column',
      lineSeries,
      categories,
      series: [{ name: seriesName, data: barPoints.map((p) => p.y), color: seriesColor }],
      showLegend: viewLegend ?? true,
      // No x-axis title in the cumulative view (per SS — the bin labels are enough).
      xAxisTitle: '',
      resolveClick: (ctx) => {
        const p = barPoints[ctx.pointIndex];
        return p ? { sourceIdx: p.sourceIdx, binIdx: p.binIdx } : null;
      },
      hcOptions,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, barPoints, drill, sourcePoints, canDrill, style, showRanges, viewLabels, viewLegend, viewCumulative]);

  // ── Export (v1 §10, alasql replaced with SheetJS/native CSV) ──────────────

  function buildExportRows(): Record<string, unknown>[] {
    if (drill) {
      const bin = bins[drill.binIdx];
      if (!bin) return [];
      const isLast = drill.binIdx === bins.length - 1;
      const counts = hourlyCountsForBin(sourcePoints[drill.sourceIdx] ?? [], bin, isLast, cfg.includeStartEnd);
      return counts.map((c, h) => ({
        Hour: HOUR_CATEGORIES[h],
        Bin: hasBinName(bin.binName) ? bin.binName : `Bin ${drill.binIdx + 1}`,
        'Range Start': bin.start,
        'Range End': bin.end,
        Frequency: c,
      }));
    }
    if (!viewCumulative) {
      const rows: Record<string, unknown>[] = [];
      sources.forEach((src, sourceIdx) => {
        const grouping = dailyBinCounts(sourcePoints[sourceIdx] ?? [], bins, cfg.includeStartEnd);
        bins.forEach((bin, binIdx) => {
          grouping.categories.forEach((day, dayIdx) => {
            rows.push({
              'Data Source': src.name || `Source ${sourceIdx + 1}`,
              Day: day,
              Bin: hasBinName(bin.binName) ? bin.binName : `Bin ${binIdx + 1}`,
              'Range Start': bin.start,
              'Range End': bin.end,
              Frequency: grouping.perBin[binIdx]?.[dayIdx] ?? 0,
            });
          });
        });
      });
      return rows;
    }
    return barPoints.map((p) => ({
      'Data Source': p.sourceTitle,
      Bin: hasBinName(p.bin.binName) ? p.bin.binName : `Bin ${p.binIdx + 1}`,
      'Range Start': p.bin.start,
      'Range End': p.bin.end,
      Frequency: p.y,
    }));
  }

  function exportData(format: 'XLSX' | 'CSV') {
    setOpenMenu(null);
    const rows = buildExportRows();
    if (rows.length === 0) return;
    const sheet = XLSX.utils.json_to_sheet(rows);
    const book = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(book, sheet, 'Histogram');
    const name = (cfg.chartTitle || 'histogram').replace(/[^\w-]+/g, '_');
    XLSX.writeFile(book, `${name}.${format.toLowerCase()}`, {
      bookType: format === 'XLSX' ? 'xlsx' : 'csv',
    });
  }

  // Unified export. Images (SVG/PNG/JPEG) go through the SDK's exportChart off
  // the live Highcharts instance; CSV/XLSX use our SheetJS rows (richer columns
  // + reliable regardless of which Highcharts export-data module is loaded).
  function doExport(format: 'SVG' | 'PNG' | 'JPEG' | 'CSV' | 'XLSX') {
    setOpenMenu(null);
    const fileName = (cfg.chartTitle || 'histogram').replace(/[^\w-]+/g, '_');
    if (format === 'CSV' || format === 'XLSX') {
      exportData(format);
      return;
    }
    if (chartInstance.current) {
      exportChart({ instance: chartInstance.current, engine: 'highcharts', format, fileName });
    }
  }

  function toggleFullscreen() {
    setOpenMenu(null);
    const el = rootElRef.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  }

  const canExport = !isLoading && hasAnyData && hasAnyBins;
  // Legend is on by default in both modes (the SS shows the data-source legend).
  const legendDefaultOn = true;
  const wrapClass = `histogram-widget${style.card.wrapInCard ? '' : ' histogram-widget--bare'}`;
  const wrapStyle: React.CSSProperties = style.card.wrapInCard
    ? {
        background: style.card.backgroundColor,
        borderColor: style.card.borderColor,
        borderWidth: style.card.borderWidth,
        borderRadius: style.card.borderRadius,
        borderStyle: 'solid',
      }
    : { background: 'transparent', border: 'none' };

  const titleStyle: React.CSSProperties = {
    fontSize: style.chartTitle.fontSize,
    color: style.chartTitle.fontColor,
    fontWeight: FONT_WEIGHT_MAP[style.chartTitle.fontWeight] ?? '600',
  };

  // ── Render ─────────────────────────────────────────────────────────────────

  // Diagnostic — surfaces why the widget may show an empty state in the host.
  const allVals = sourcePoints.flat().map((p) => p.value);
  console.log('[HistogramWidget] render', {
    sources: sources.map((s) => ({ name: s.name, unsPath: s.unsPath })),
    bins: bins.length,
    configBins: configBins.length,
    binRange: bins.length ? [bins[0].start, bins[bins.length - 1].end] : null,
    valueRange: allVals.length ? [Math.min(...allVals), Math.max(...allVals)] : null,
    pointCount: allVals.length,
    boundCount: boundSources.length,
    dataKeys: data.map((d) => d.key),
    hasConfiguredSource,
    hasAnyData,
    hasAnyBins,
    isLoading,
  });

  return (
    <div className={wrapClass} style={wrapStyle} ref={rootElRef}>
      <div className="histogram-widget__header">
        {style.hideElements.chartTitle || !hasRealChart ? (
          // No chart added yet (or title hidden in Style tab) → keep the header
          // empty; the reserved min-height stops the chart from shifting up.
          <span className="histogram-widget__title" style={titleStyle} />
        ) : charts.length > 1 ? (
          <ChartTitleSwitcher
            charts={charts}
            activeChart={activeChart}
            titleStyle={titleStyle}
            onSelect={(id) => {
              setPreviewChartId(id);
              setDrill(null);
            }}
          />
        ) : (
          <span className="histogram-widget__title" style={titleStyle}>
            {cfg.chartTitle || 'Histogram'}
          </span>
        )}
        <div className="histogram-widget__actions">
          {drill && (
            <button className="histogram-widget__btn" onClick={closeDrill}>
              ← Back to Histogram
            </button>
          )}

          {/* SDK-native chart header icons (Info / Settings / More) — identical to
              the Column/Line charts. Each icon only renders when its handler is
              passed, so hideElements simply drops the handler. The dropdowns below
              are the SDK DropdownMenu, positioned under the icon group. */}
          <div className="histogram-widget__chart-actions">
            <ChartActions
              onInfoClick={
                cfg.description?.trim()
                  ? () => setOpenMenu((m) => (m === 'info' ? null : 'info'))
                  : undefined
              }
              onSettingsClick={
                style.hideElements.settingsIcon
                  ? undefined
                  : () => setOpenMenu((m) => (m === 'settings' ? null : 'settings'))
              }
              onMoreClick={
                style.hideElements.exportIcon
                  ? undefined
                  : () => setOpenMenu((m) => (m === 'more' ? null : 'more'))
              }
            />

            {openMenu && (
              <div className="histogram-widget__overlay" onClick={() => setOpenMenu(null)} />
            )}

            {/* Info — chart description popover. */}
            {openMenu === 'info' && cfg.description?.trim() && (
              <div className="histogram-widget__popover">{cfg.description}</div>
            )}

            {/* Chart Control — Legends / Data Label / Cumulative Values (SDK menu). */}
            {openMenu === 'settings' && (
              <div className="histogram-widget__menu-anchor">
                <DropdownMenu>
                  <ActionListItem contentType="SectionHeading" title="Chart Control" />
                  <ActionListItem
                    title="Legends"
                    selectionType="Multiple"
                    isSelected={viewLegend ?? legendDefaultOn}
                    onClick={() => setViewLegend((v) => !(v ?? legendDefaultOn))}
                  />
                  <ActionListItem
                    title="Data Label"
                    selectionType="Multiple"
                    isSelected={viewLabels}
                    onClick={() => setViewLabels((v) => !v)}
                  />
                  <ActionListItem contentType="Separator" />
                  {/* Cumulative Values is a toggle (not a checkbox like Legends /
                      Data Label) — the Switch in the trailing slot owns the flip. */}
                  <ActionListItem
                    title="Cumulative Values"
                    description="View the total distribution across all value ranges."
                    trailing={
                      <Switch
                        isChecked={viewCumulative}
                        onChange={({ isChecked }: { isChecked: boolean }) => setViewCumulative(isChecked)}
                        accessibilityLabel="Cumulative Values"
                      />
                    }
                  />
                </DropdownMenu>
              </div>
            )}

            {/* More — full screen + download (SVG/PNG/JPEG/CSV/XLSX). */}
            {openMenu === 'more' && (
              <div className="histogram-widget__menu-anchor">
                <DropdownMenu>
                  <ActionListItem
                    title={isFullscreen ? 'Exit full screen' : 'View in full screen'}
                    leadingIcon={isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
                    onClick={toggleFullscreen}
                  />
                  <ActionListItem contentType="Separator" />
                  <ActionListItem contentType="SectionHeading" title="Download Type" />
                  {(['SVG', 'PNG', 'JPEG', 'CSV', 'XLSX'] as const).map((fmt) => (
                    <ActionListItem
                      key={fmt}
                      title={fmt}
                      isDisabled={!canExport}
                      onClick={() => doExport(fmt)}
                    />
                  ))}
                </DropdownMenu>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Time controls above the chart — local DatePicker+periodicity / fixed / global label.
          Falls back to a default local config so the picker shows even if the host
          doesn't push a timeTabConfig. */}
      {hasConfiguredSource && (
        <HistogramTimeBar
          timeTabConfig={effectiveTimeTab(timeTabConfig)}
          onEvent={onEvent}
        />
      )}

      <div className="histogram-widget__chart-area">
        {!hasConfiguredSource && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="Widget not configured"
              description="Add a data source with a UNS topic and bins to see the histogram"
            />
          </div>
        )}

        {hasConfiguredSource && isLoading && (
          <div className="histogram-widget__loading">
            <div className="histogram-widget__spinner" />
            <span>Fetching Chart Data …</span>
          </div>
        )}

        {hasConfiguredSource && !isLoading && !hasAnyData && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="No Data"
              description="We couldn't find any data for this time range. Try a different date range!"
            />
          </div>
        )}

        {hasConfiguredSource && !isLoading && hasAnyData && !hasAnyBins && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="No bins configured"
              description="Add bins for your data source (Data tab → Bins) to see the histogram."
            />
          </div>
        )}

        {hasConfiguredSource && !isLoading && hasAnyData && hasAnyBins && (
          <>
          <div className="histogram-widget__chart">
            {model.kind === 'column' && model.lineSeries && model.lineSeries.length > 0 ? (
              // Bars + distribution line(s) — the SDK combo chart renders mixed
              // column + line series natively (a plain ColumnChart drops extra
              // series from highchartsOptions, so the overlay never showed).
              <ComboLineChart
                bare
                categories={model.categories}
                series={[
                  ...model.series.map((s) => ({
                    type: 'column' as const,
                    name: s.name,
                    data: s.data as number[],
                    color: s.color,
                  })),
                  ...model.lineSeries,
                ]}
                showLegend={model.showLegend}
                plotLines={plotLines}
                xAxisTitle={model.xAxisTitle}
                yAxisTitle={yAxisTitle}
                highchartsOptions={applyChartStyle(model.hcOptions, style, !!rightAxis)}
                onPointClick={
                  canDrill
                    ? (ctx: ChartPointClickContext) => {
                        const t = model.resolveClick(ctx);
                        if (t) handleBarClick(t.sourceIdx, t.binIdx);
                      }
                    : undefined
                }
                onChartReady={(inst: Highcharts.Chart) => {
                  chartInstance.current = inst;
                }}
              />
            ) : model.kind === 'column' ? (
              <ColumnChart
                bare
                categories={model.categories}
                series={model.series}
                showLegend={model.showLegend}
                plotLines={plotLines}
                xAxisTitle={model.xAxisTitle}
                yAxisTitle={yAxisTitle}
                highchartsOptions={applyChartStyle(model.hcOptions, style, !!rightAxis)}
                onPointClick={
                  canDrill
                    ? (ctx: ChartPointClickContext) => {
                        const t = model.resolveClick(ctx);
                        if (t) handleBarClick(t.sourceIdx, t.binIdx);
                      }
                    : undefined
                }
                onChartReady={(inst: Highcharts.Chart) => {
                  chartInstance.current = inst;
                }}
              />
            ) : (
              <LineChart
                bare
                categories={model.categories}
                series={model.series}
                showLegend={model.showLegend ?? false}
                xAxisTitle={model.xAxisTitle}
                yAxisTitle={yAxisTitle}
                highchartsOptions={applyChartStyle(model.hcOptions, style, !!rightAxis)}
                onChartReady={(inst: Highcharts.Chart) => {
                  chartInstance.current = inst;
                }}
              />
            )}
          </div>
          </>
        )}
      </div>
    </div>
  );
};

/** Clickable chart title that opens a dropdown to switch the active chart —
 *  shown only when the widget has more than one chart (mirrors the Line Chart). */
function ChartTitleSwitcher({
  charts,
  activeChart,
  onSelect,
  titleStyle,
}: {
  charts: HistogramChart[];
  activeChart: HistogramChart;
  onSelect: (id: string) => void;
  titleStyle: React.CSSProperties;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="histogram-widget__title-switcher">
      <button
        type="button"
        className="histogram-widget__title-btn"
        onClick={() => setOpen((o) => !o)}
        aria-label="Switch chart"
      >
        {/* titleStyle on the span (not the button) so the switcher title matches
            the single-chart title size — the .histogram-widget__title CSS font-size
            would otherwise shrink it. */}
        <span className="histogram-widget__title" style={titleStyle}>{activeChart.chartTitle || 'Histogram'}</span>
        <ChevronDown size={16} />
      </button>
      {open && (
        <>
          <div className="histogram-widget__overlay" onClick={() => setOpen(false)} />
          <div className="histogram-widget__menu-anchor histogram-widget__menu-anchor--left">
            <DropdownMenu>
              {charts.map((c) => (
                <ActionListItem
                  key={c._id}
                  title={c.chartTitle || 'Histogram'}
                  selectionType="Single"
                  isSelected={c._id === activeChart._id}
                  onClick={() => {
                    onSelect(c._id);
                    setOpen(false);
                  }}
                />
              ))}
            </DropdownMenu>
          </div>
        </>
      )}
    </div>
  );
}

/** Flip the Y axis to the opposite (right) side when a right-side axis is configured. */
/** Merge the Style tab's Advanced Settings (axis text/line colors, grid-line
 *  color, legend text color) into the chart options, and flip the Y axis to the
 *  opposite side when a right axis is configured. Deep-merges onto the model's own
 *  axis options (rotation, side, etc.) so those survive. Without this the axis /
 *  grid / legend color controls in the Style tab had no effect on the chart. */
function applyChartStyle(opts: Highcharts.Options, style: HistogramStyling, opposite: boolean): Highcharts.Options {
  const x = ((Array.isArray(opts.xAxis) ? opts.xAxis[0] : opts.xAxis) ?? {}) as Highcharts.XAxisOptions;
  const y = ((Array.isArray(opts.yAxis) ? opts.yAxis[0] : opts.yAxis) ?? {}) as Highcharts.YAxisOptions;
  const legend = (opts.legend ?? {}) as Highcharts.LegendOptions;
  return {
    ...opts,
    xAxis: {
      ...x,
      lineColor: style.xAxisLabel.lineColor,
      gridLineColor: style.misc.gridLineColor,
      labels: { ...x.labels, style: { ...(x.labels?.style ?? {}), color: style.xAxisLabel.textColor } },
    },
    yAxis: {
      ...y,
      opposite: opposite || !!y.opposite,
      lineColor: style.yAxisLabel.lineColor,
      gridLineColor: style.misc.gridLineColor,
      labels: { ...y.labels, style: { ...(y.labels?.style ?? {}), color: style.yAxisLabel.textColor } },
    },
    legend: { ...legend, itemStyle: { ...(legend.itemStyle ?? {}), color: style.misc.legendTextColor } },
  };
}

/** Map the widget's plot-line config onto the SDK ChartPlotLine shape. Dynamic
 *  lines take their value from `resolveDynamic(index)` (the latest resolved value
 *  of the bound topic); a dynamic line with no resolved value yet is skipped. */
function toChartPlotLines(
  cfg: HistogramChart,
  resolveDynamic?: (index: number) => number | undefined,
): ChartPlotLine[] {
  const out: ChartPlotLine[] = [];
  (cfg.plotLines ?? []).forEach((pl, pi) => {
    let value = pl.value;
    if (pl.valueType === 'Dynamic') {
      const dyn = resolveDynamic?.(pi);
      if (dyn === undefined) return; // no resolved value → don't draw the line
      value = dyn;
    }
    out.push({
      value,
      color: pl.color || '#ff0000',
      width: pl.lineWidth || 2,
      dashStyle: (pl.dashStyle as ChartPlotLine['dashStyle']) || 'Dash',
      label: pl.name || undefined,
    });
  });
  return out;
}

export default HistogramWidget;
