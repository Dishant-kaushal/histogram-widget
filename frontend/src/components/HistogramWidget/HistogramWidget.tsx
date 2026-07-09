'use client';

import React, { useMemo, useRef, useState } from 'react';
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
import { LineChart } from '@faclon-labs/design-sdk/LineChart';
import type { LineSeries } from '@faclon-labs/design-sdk/LineChart';
import type { ChartPlotLine, ChartPointClickContext } from '@faclon-labs/design-sdk/Chart';
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
import { Tooltip } from '@faclon-labs/design-sdk/Tooltip';
import { Checkbox } from '@faclon-labs/design-sdk/Checkbox';
import { Switch } from '@faclon-labs/design-sdk/Switch';
import { exportChart } from '@faclon-labs/design-sdk/Chart';
import { Info, Settings, MoreVertical } from 'react-feather';
import type {
  Bin,
  DataEntry,
  HistogramDataSource,
  HistogramStyling,
  HistogramUIConfig,
  SeriesPoint,
  WidgetEvent,
} from '../../iosense-sdk/types';
import { getSeriesData } from '../../iosense-sdk/mini-engine';
import {
  binCounts,
  binLabel,
  dailyBinCounts,
  gaussianOverlayPoints,
  hasBinName,
  HOUR_CATEGORIES,
  hourlyCountsForBin,
  slotsToPoints,
} from './histogram-utils';
import './HistogramWidget.css';

interface HistogramWidgetProps {
  config: HistogramUIConfig;
  data: DataEntry[];
  /** Explicit resolve-in-flight flag from the data layer. Preferred over
   *  inferring from empty data (which never clears when a resolve returns []). */
  loading?: boolean;
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

const DEFAULT_CONFIG: HistogramUIConfig = {
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
  style: DEFAULT_STYLE,
};

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
    };

export const HistogramWidget: React.FC<HistogramWidgetProps> = ({ config, data, loading, onEvent }) => {
  const cfg: HistogramUIConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    plotLines: config?.plotLines ?? [],
    style: { ...DEFAULT_STYLE, ...(config?.style ?? {}) },
  };
  const style = cfg.style;
  const chartInstance = useRef<Highcharts.Chart | null>(null);
  const rootElRef = useRef<HTMLDivElement | null>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  // Header menus (info / chart-settings / more), one open at a time.
  const [openMenu, setOpenMenu] = useState<'info' | 'settings' | 'more' | null>(null);
  // Chart-control view state (from the gear menu; not persisted to config).
  const [viewLabels, setViewLabels] = useState(false);
  const [viewLegend, setViewLegend] = useState<boolean | null>(null);
  // Cumulative Values = the total distribution across all value ranges (our
  // "cumulative" mode). Off → daily (grouped by weekday).
  const [viewCumulative, setViewCumulative] = useState(cfg.aggregationMode !== 'daily');

  const sources: HistogramDataSource[] = cfg.dataSources ?? [];
  // Bins are now chart-level (applied to every source); auto-colored from a palette.
  const bins: Bin[] = cfg.bins ?? [];
  // `bound` = topic is a resolvable {{...}} binding (what the mini-engine needs).
  const boundSources = sources.filter((s) => TOPIC_REGEX.test((s.unsPath ?? '').trim()));
  // `configured` = the user has added a source with SOME topic. Used for the
  // "not configured" gate so a non-brace topic shows "No Data" (diagnosable),
  // not the misleading "Widget not configured".
  const hasConfiguredSource = sources.some((s) => (s.unsPath ?? '').trim() !== '');

  // Resolved points per data source — the only place the data prop is read.
  const sourcePoints: SeriesPoint[][] = useMemo(
    () => sources.map((_, i) => slotsToPoints(getSeriesData(`dataSources[${i}].unsPath`, data))),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data, config],
  );

  // Cumulative bars: counts per bin, concatenated across data sources (v1 §7.1)
  const barPoints: BarPoint[] = useMemo(() => {
    const pts: BarPoint[] = [];
    sources.forEach((src, sourceIdx) => {
      const counts = binCounts(sourcePoints[sourceIdx] ?? [], bins, cfg.includeStartEnd);
      bins.forEach((bin, binIdx) => {
        pts.push({
          y: counts[binIdx] ?? 0,
          color: binColor(binIdx, bin.color),
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

  const plotLines: ChartPlotLine[] | undefined = cfg.showPlotLines ? toChartPlotLines(cfg) : undefined;

  // Bin-range x-axis labels come from the Style tab toggle.
  const showRanges = cfg.showBinRanges;

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
        series: [{ name: label, data: counts, color: binColor(drill.binIdx, bin?.color) }],
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
            color: binColor(binIdx, bin.color),
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
    const overlay = cfg.showDistributionLine ? gaussianOverlayPoints(barPoints.map((p) => p.y)) : [];

    const hcOptions: Highcharts.Options = {
      // colorByPoint + colors → one color per bin (index-aligned to barPoints).
      colors: barPoints.map((p) => p.color),
      xAxis: { labels: { rotation: manyBins ? -45 : 0 } },
      plotOptions: {
        column: {
          colorByPoint: true,
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
          if (this.series?.type === 'spline') {
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
      // Distribution overlay as a 2nd (spline) series, merged in by index so the
      // computed column series at index 0 is preserved.
      ...(overlay.length > 0
        ? {
            series: [
              {},
              {
                type: 'spline',
                name: 'Frequency Distribution',
                data: overlay,
                color: style.distribution.color || '#FF6B6B',
                lineWidth: style.distribution.width || 3,
                dashStyle: (style.distribution.dashStyle || 'Solid') as Highcharts.DashStyleValue,
                marker: { enabled: false },
                zIndex: 5,
              },
            ] as unknown as Highcharts.SeriesOptionsType[],
          }
        : {}),
    };

    return {
      kind: 'column',
      categories,
      series: [{ name: cfg.chartLabel || 'Frequency', data: barPoints.map((p) => p.y), showInLegend: false }],
      showLegend: viewLegend ?? false,
      xAxisTitle: showRanges ? 'Bin Ranges' : 'Bin Data Points',
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
  // Legend default depends on the mode (daily groups → on; cumulative → off).
  const legendDefaultOn = !viewCumulative;
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
  console.log('[HistogramWidget] render', {
    sources: sources.map((s) => ({ name: s.name, unsPath: s.unsPath })),
    bins: bins.length,
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
        <span className="histogram-widget__title" style={titleStyle}>
          {style.hideElements.chartTitle ? '' : cfg.chartTitle || 'Histogram'}
        </span>
        <div className="histogram-widget__actions">
          {drill && (
            <button className="histogram-widget__btn" onClick={closeDrill}>
              ← Back to Histogram
            </button>
          )}

          {/* Info — SDK Tooltip, only when a chart description is set. */}
          {cfg.description?.trim() && (
            <Tooltip bodyText={cfg.description} heading={cfg.chartTitle || undefined}>
              <button className="histogram-widget__icon-btn" aria-label="Chart info">
                <Info size={16} />
              </button>
            </Tooltip>
          )}

          {/* Chart settings — quick view toggles (SDK checkboxes). */}
          <div className="histogram-widget__menu-wrap">
            <button
              className="histogram-widget__icon-btn"
              title="Chart settings"
              aria-label="Chart settings"
              onClick={() => setOpenMenu((m) => (m === 'settings' ? null : 'settings'))}
            >
              <Settings size={16} />
            </button>
            {openMenu === 'settings' && (
              <>
                <div className="histogram-widget__overlay" onClick={() => setOpenMenu(null)} />
                <div className="histogram-widget__menu histogram-widget__menu--settings">
                  <span className="histogram-widget__menu-label">Chart Control</span>
                  <Checkbox label="Legends" isChecked={viewLegend ?? legendDefaultOn} onChange={(e) => setViewLegend(e.target.checked)} />
                  <Checkbox label="Data Label" isChecked={viewLabels} onChange={(e) => setViewLabels(e.target.checked)} />
                  <div className="histogram-widget__menu-divider" />
                  <div className="histogram-widget__setting-row">
                    <div className="histogram-widget__setting-text">
                      <span className="histogram-widget__setting-title">Cumulative Values</span>
                      <span className="histogram-widget__setting-desc">View the total distribution across all value ranges.</span>
                    </div>
                    <Switch
                      isChecked={viewCumulative}
                      onChange={({ isChecked }: { isChecked: boolean }) => setViewCumulative(isChecked)}
                      accessibilityLabel="Cumulative values"
                    />
                  </div>
                </div>
              </>
            )}
          </div>

          {/* More — full screen + download (SVG/PNG/JPEG/CSV/XLSX). */}
          {!style.hideElements.exportIcon && (
            <div className="histogram-widget__menu-wrap">
              <button
                className="histogram-widget__icon-btn"
                title="More"
                aria-label="More options"
                onClick={() => setOpenMenu((m) => (m === 'more' ? null : 'more'))}
              >
                <MoreVertical size={16} />
              </button>
              {openMenu === 'more' && (
                <>
                  <div className="histogram-widget__overlay" onClick={() => setOpenMenu(null)} />
                  <div className="histogram-widget__menu">
                    <button className="histogram-widget__menu-item" onClick={toggleFullscreen}>
                      View in full screen
                    </button>
                    <div className="histogram-widget__menu-divider" />
                    <span className="histogram-widget__menu-label">Download Type</span>
                    {(['SVG', 'PNG', 'JPEG', 'CSV', 'XLSX'] as const).map((fmt) => (
                      <button
                        key={fmt}
                        className="histogram-widget__menu-item"
                        disabled={!canExport}
                        onClick={() => doExport(fmt)}
                      >
                        {fmt}
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

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
          <div className="histogram-widget__chart">
            {model.kind === 'column' ? (
              <ColumnChart
                bare
                categories={model.categories}
                series={model.series}
                showLegend={model.showLegend}
                plotLines={plotLines}
                xAxisTitle={model.xAxisTitle}
                yAxisTitle="Frequency"
                highchartsOptions={model.hcOptions}
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
                showLegend={false}
                xAxisTitle={model.xAxisTitle}
                yAxisTitle="Frequency"
                highchartsOptions={model.hcOptions}
                onChartReady={(inst: Highcharts.Chart) => {
                  chartInstance.current = inst;
                }}
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
};

/** Map the widget's plot-line config onto the SDK ChartPlotLine shape. */
function toChartPlotLines(cfg: HistogramUIConfig): ChartPlotLine[] {
  return (cfg.plotLines ?? []).map((pl) => ({
    value: pl.value,
    color: pl.color || '#ff0000',
    width: pl.lineWidth || 2,
    dashStyle: (pl.dashStyle as ChartPlotLine['dashStyle']) || 'Dash',
    label: pl.name || undefined,
  }));
}

export default HistogramWidget;
