'use client';

import React, { useMemo, useRef, useState } from 'react';
import Highcharts from 'highcharts';
import HighchartsReact from 'highcharts-react-official';
import * as XLSX from 'xlsx';

// HC 12 modules self-register on import, but touch browser globals — load
// client-side only so Next.js prerendering doesn't crash.
if (typeof window !== 'undefined') {
  import('highcharts/modules/exporting');
}
import { EmptyState } from '@faclon-labs/design-sdk/EmptyState';
import { NoDataOneIllustration } from '@faclon-labs/design-sdk/EmptyState/illustrations/NoDataOneIllustration';
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

interface BarPoint {
  y: number;
  color: string;
  sourceIdx: number;
  binIdx: number;
  bin: Bin;
  sourceTitle: string;
  globalIdx: number;
}

interface DrillState {
  sourceIdx: number;
  binIdx: number;
}

export const HistogramWidget: React.FC<HistogramWidgetProps> = ({ config, data, loading, onEvent }) => {
  const cfg: HistogramUIConfig = {
    ...DEFAULT_CONFIG,
    ...config,
    plotLines: config?.plotLines ?? [],
    style: { ...DEFAULT_STYLE, ...(config?.style ?? {}) },
  };
  const style = cfg.style;
  const chartRef = useRef<HighchartsReact.RefObject>(null);
  const [drill, setDrill] = useState<DrillState | null>(null);
  const [exportOpen, setExportOpen] = useState(false);

  const axisLabelStyle = { color: style.xAxisLabel.textColor, fontSize: '11px' };
  const yAxisLabelStyle = { color: style.yAxisLabel.textColor, fontSize: '11px' };
  const axisTitleStyle = { color: style.xAxisLabel.textColor, fontSize: '12px' };
  const gridColor = style.misc.gridLineColor;

  const sources: HistogramDataSource[] = cfg.dataSources ?? [];
  const boundSources = sources.filter((s) => TOPIC_REGEX.test((s.unsPath ?? '').trim()));

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
      const counts = binCounts(sourcePoints[sourceIdx] ?? [], src.bins ?? [], cfg.includeStartEnd);
      (src.bins ?? []).forEach((bin, binIdx) => {
        pts.push({
          y: counts[binIdx] ?? 0,
          color: bin.color || '#85B8FF',
          sourceIdx,
          binIdx,
          bin,
          sourceTitle: src.name || `Source ${sourceIdx + 1}`,
          globalIdx: pts.length,
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
  // A histogram needs bins to draw bars. Bins are configured per source (Data
  // tab → Bins); a source added without bins would otherwise render a blank chart.
  const hasAnyBins = sources.some((s) => (s.bins?.length ?? 0) > 0);

  const handleBarClick = (sourceIdx: number, binIdx: number) => {
    // v1 "Enable Data Source Line Chart" is per-source; fall back to the global flag.
    if (!(sources[sourceIdx]?.enableLineChart || cfg.showLineChart)) return;
    setDrill({ sourceIdx, binIdx });
    const bin = sources[sourceIdx]?.bins?.[binIdx];
    onEvent?.({
      type: 'FILTER_CHANGE',
      payload: { drilldown: true, binStart: bin?.start, binEnd: bin?.end, binName: bin?.binName },
    });
  };

  const closeDrill = () => {
    setDrill(null);
    onEvent?.({ type: 'FILTER_CHANGE', payload: { drilldown: false } });
  };

  // ── Chart options ─────────────────────────────────────────────────────────

  const chartOptions: Highcharts.Options = useMemo(() => {
    const base: Highcharts.Options = {
      chart: {
        backgroundColor: 'transparent',
        style: { fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif" },
        animation: { duration: 300 },
        height: null,
      },
      title: {
        text: style.hideElements.chartTitle ? undefined : cfg.chartTitle || undefined,
        style: {
          fontSize: `${style.chartTitle.fontSize}px`,
          color: style.chartTitle.fontColor,
          fontWeight: FONT_WEIGHT_MAP[style.chartTitle.fontWeight] ?? '600',
        },
      },
      credits: { enabled: false },
      exporting: { enabled: false },
      lang: { noData: 'No Data' },
    };

    // ── Drill-down line chart (v1 §9: 24 hardcoded hour buckets) ───────────
    if (drill) {
      const src = sources[drill.sourceIdx];
      const bin = src?.bins?.[drill.binIdx];
      const isLast = drill.binIdx === (src?.bins?.length ?? 0) - 1;
      const counts = bin
        ? hourlyCountsForBin(sourcePoints[drill.sourceIdx] ?? [], bin, isLast, cfg.includeStartEnd)
        : new Array<number>(24).fill(0);
      const label = bin
        ? hasBinName(bin.binName)
          ? bin.binName
          : `Bin ${drill.binIdx + 1} (${bin.start} - ${bin.end})`
        : 'Bin';
      return {
        ...base,
        title: { ...base.title, text: `${label} — Hourly Frequency` },
        xAxis: {
          categories: HOUR_CATEGORIES,
          title: { text: 'Hour of Day', style: axisTitleStyle },
          labels: { style: axisLabelStyle, rotation: -45 },
          lineColor: style.xAxisLabel.lineColor,
        },
        yAxis: {
          title: { text: 'Frequency', style: axisTitleStyle },
          gridLineColor: gridColor,
          labels: { style: yAxisLabelStyle },
        },
        legend: { enabled: false },
        tooltip: {
          formatter: function (this: Highcharts.Point): string {
            return `<b>${this.category}</b> : ${this.y}`;
          },
        } as Highcharts.TooltipOptions,
        series: [
          {
            type: 'line',
            name: label,
            data: counts,
            color: bin?.color || '#85B8FF',
            marker: { enabled: true, radius: 3 },
          },
        ],
      };
    }

    // ── Daily grouped columns (v1 §8.3: one series per bin, one group/day) ──
    if (cfg.aggregationMode === 'daily') {
      let categories: string[] = [];
      const seriesList: Highcharts.SeriesColumnOptions[] = [];
      sources.forEach((src, sourceIdx) => {
        const grouping = dailyBinCounts(sourcePoints[sourceIdx] ?? [], src.bins ?? [], cfg.includeStartEnd);
        if (grouping.categories.length > categories.length) categories = grouping.categories;
        (src.bins ?? []).forEach((bin, binIdx) => {
          const name = hasBinName(bin.binName)
            ? bin.binName
            : `Bin ${binIdx + 1}${cfg.showBinRanges ? ` (${bin.start} - ${bin.end})` : ''}`;
          seriesList.push({
            type: 'column',
            name: sources.length > 1 ? `${src.name || `Source ${sourceIdx + 1}`}: ${name}` : name,
            data: grouping.perBin[binIdx] ?? [],
            color: bin.color || '#85B8FF',
            custom: { sourceIdx, binIdx },
          } as Highcharts.SeriesColumnOptions);
        });
      });
      return {
        ...base,
        xAxis: {
          categories,
          title: { text: 'Day', style: axisTitleStyle },
          labels: { style: axisLabelStyle },
          lineColor: style.xAxisLabel.lineColor,
        },
        yAxis: {
          title: { text: 'Frequency', style: axisTitleStyle },
          gridLineColor: gridColor,
          labels: { style: yAxisLabelStyle },
          plotLines: cfg.showPlotLines ? toHighchartsPlotLines(cfg) : undefined,
        },
        legend: { enabled: true, itemStyle: { fontSize: '11px', color: style.misc.legendTextColor } },
        tooltip: {
          formatter: function (this: Highcharts.Point): string {
            return `<b>${this.category} ${this.series.name}</b> : ${this.y}`;
          },
        } as Highcharts.TooltipOptions,
        plotOptions: {
          column: {
            borderColor: 'transparent',
            point: {
              events: {
                click: function (this: Highcharts.Point) {
                  const custom = (this.series.options as Highcharts.SeriesColumnOptions).custom as
                    | { sourceIdx: number; binIdx: number }
                    | undefined;
                  if (custom) handleBarClick(custom.sourceIdx, custom.binIdx);
                },
              },
            },
          },
        },
        series: seriesList,
      };
    }

    // ── Cumulative histogram (v1 §8.1) ──────────────────────────────────────
    const categories = barPoints.map((p) => binLabel(p.bin, p.binIdx, cfg.showBinRanges));
    const manyBins = barPoints.length > 10;

    const columnSeries: Highcharts.SeriesColumnOptions = {
      type: 'column',
      name: cfg.chartLabel || 'Parameter',
      colorByPoint: true,
      data: barPoints.map((p) => ({
        y: p.y,
        color: p.color,
        custom: { sourceIdx: p.sourceIdx, binIdx: p.binIdx },
      })),
      dataLabels: {
        enabled: true,
        inside: true,
        rotation: -90,
        style: {
          color: style.dataLabels.color,
          fontWeight: 'bold',
          fontSize: `${style.dataLabels.fontSize}px`,
          textOutline: 'none',
        },
        formatter: function (this: Highcharts.Point): string {
          return this.y ? String(this.y) : '';
        },
      } as Highcharts.PlotColumnDataLabelsOptions,
      showInLegend: false,
    };

    const seriesList: Highcharts.SeriesOptionsType[] = [columnSeries];
    if (cfg.showDistributionLine) {
      const overlay = gaussianOverlayPoints(barPoints.map((p) => p.y));
      if (overlay.length > 0) {
        seriesList.push({
          type: 'spline',
          name: 'Frequency Distribution',
          data: overlay,
          color: style.distribution.color || '#FF6B6B',
          lineWidth: style.distribution.width || 3,
          dashStyle: (style.distribution.dashStyle || 'Solid') as Highcharts.DashStyleValue,
          marker: { enabled: false },
          zIndex: 5,
          enableMouseTracking: true,
        });
      }
    }

    return {
      ...base,
      xAxis: {
        categories,
        title: { text: cfg.showBinRanges ? 'Bin Ranges' : 'Bin Data Points', style: axisTitleStyle },
        labels: { style: axisLabelStyle, rotation: manyBins ? -45 : 0 },
        lineColor: style.xAxisLabel.lineColor,
      },
      yAxis: {
        title: { text: 'Frequency', style: axisTitleStyle },
        gridLineColor: gridColor,
        labels: { style: yAxisLabelStyle },
        plotLines: cfg.showPlotLines ? toHighchartsPlotLines(cfg) : undefined,
      },
      legend: { enabled: cfg.showDistributionLine, itemStyle: { fontSize: '11px', color: style.misc.legendTextColor } },
      tooltip: {
        formatter: function (this: Highcharts.Point): string {
          if (this.series.type === 'spline') {
            return `Frequency Distribution: ${Number(this.y).toFixed(2)}`;
          }
          const custom = (this.options as { custom?: { sourceIdx: number; binIdx: number } }).custom;
          const src = custom ? sources[custom.sourceIdx] : undefined;
          const bin = custom && src ? src.bins?.[custom.binIdx] : undefined;
          const i = (custom?.binIdx ?? this.index) + 1;
          const unit = src?.unit ? ` ${src.unit}` : '';
          if (cfg.showBinRanges && bin) return `<b>Bin ${i} (${bin.start}-${bin.end}${unit})</b> : ${this.y}`;
          if (bin && hasBinName(bin.binName)) return `<b>${bin.binName}</b> : ${this.y}`;
          return `<b>Bin ${i}</b> : ${this.y}`;
        },
      } as Highcharts.TooltipOptions,
      plotOptions: {
        column: {
          borderColor: 'transparent',
          cursor: sources.some((s) => s.enableLineChart) || cfg.showLineChart ? 'pointer' : undefined,
          point: {
            events: {
              click: function (this: Highcharts.Point) {
                const custom = (this.options as { custom?: { sourceIdx: number; binIdx: number } }).custom;
                if (custom) handleBarClick(custom.sourceIdx, custom.binIdx);
              },
            },
          },
        },
      },
      series: seriesList,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cfg, barPoints, drill, sourcePoints]);

  // ── Export (v1 §10, alasql replaced with SheetJS/native CSV) ──────────────

  function buildExportRows(): Record<string, unknown>[] {
    if (drill) {
      const src = sources[drill.sourceIdx];
      const bin = src?.bins?.[drill.binIdx];
      if (!bin) return [];
      const isLast = drill.binIdx === (src.bins?.length ?? 0) - 1;
      const counts = hourlyCountsForBin(sourcePoints[drill.sourceIdx] ?? [], bin, isLast, cfg.includeStartEnd);
      return counts.map((c, h) => ({
        Hour: HOUR_CATEGORIES[h],
        Bin: hasBinName(bin.binName) ? bin.binName : `Bin ${drill.binIdx + 1}`,
        'Range Start': bin.start,
        'Range End': bin.end,
        Frequency: c,
      }));
    }
    if (cfg.aggregationMode === 'daily') {
      const rows: Record<string, unknown>[] = [];
      sources.forEach((src, sourceIdx) => {
        const grouping = dailyBinCounts(sourcePoints[sourceIdx] ?? [], src.bins ?? [], cfg.includeStartEnd);
        (src.bins ?? []).forEach((bin, binIdx) => {
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
    setExportOpen(false);
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

  function exportPng() {
    setExportOpen(false);
    const chart = chartRef.current?.chart as unknown as
      | { exportChart?: (opts: object, chartOpts: object) => void }
      | undefined;
    chart?.exportChart?.({ type: 'image/png' }, {});
  }

  const canExport = !isLoading && hasAnyData;
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

  // ── Render ─────────────────────────────────────────────────────────────────

  return (
    <div className={wrapClass} style={wrapStyle}>
      <div className="histogram-widget__header">
        <span className="histogram-widget__title">
          {style.hideElements.chartTitle ? '' : cfg.chartTitle || 'Histogram'}
        </span>
        <div className="histogram-widget__actions">
          {drill && (
            <button className="histogram-widget__btn" onClick={closeDrill}>
              ← Back to Histogram
            </button>
          )}
          {!style.hideElements.exportIcon && (
            <div className="histogram-widget__export">
              <button
                className="histogram-widget__btn"
                disabled={!canExport}
                onClick={() => setExportOpen((v) => !v)}
              >
                Export ▾
              </button>
              {exportOpen && (
                <>
                  <div className="histogram-widget__overlay" onClick={() => setExportOpen(false)} />
                  <div className="histogram-widget__export-menu">
                    <button onClick={() => exportData('XLSX')}>Download XLSX</button>
                    <button onClick={() => exportData('CSV')}>Download CSV</button>
                    <button onClick={exportPng}>Download PNG</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      <div className="histogram-widget__chart-area">
        {boundSources.length === 0 && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="Widget not configured"
              description="Add a data source with a UNS topic and bins to see the histogram"
            />
          </div>
        )}

        {boundSources.length > 0 && isLoading && (
          <div className="histogram-widget__loading">
            <div className="histogram-widget__spinner" />
            <span>Fetching Chart Data …</span>
          </div>
        )}

        {boundSources.length > 0 && !isLoading && !hasAnyData && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="No Data"
              description="We couldn't find any data for this time range. Try a different date range!"
            />
          </div>
        )}

        {boundSources.length > 0 && !isLoading && hasAnyData && !hasAnyBins && (
          <div className="histogram-widget__empty">
            <EmptyState
              size="Medium"
              illustration={<NoDataOneIllustration />}
              title="No bins configured"
              description="Add bins for your data source (Data tab → Bins) to see the histogram."
            />
          </div>
        )}

        {boundSources.length > 0 && !isLoading && hasAnyData && hasAnyBins && (
          <HighchartsReact
            ref={chartRef}
            highcharts={Highcharts}
            options={chartOptions}
            containerProps={{ style: { width: '100%', height: '100%', minHeight: '320px' } }}
          />
        )}
      </div>
    </div>
  );
};

function toHighchartsPlotLines(cfg: HistogramUIConfig): Highcharts.YAxisPlotLinesOptions[] {
  return (cfg.plotLines ?? []).map((pl) => ({
    value: pl.value,
    color: pl.color || '#ff0000',
    width: pl.lineWidth || 2,
    dashStyle: (pl.dashStyle || 'Solid') as Highcharts.DashStyleValue,
    zIndex: 4,
    label: {
      text: pl.name || '',
      style: { color: pl.color || '#ff0000', fontSize: '10px' },
    },
  }));
}

export default HistogramWidget;
