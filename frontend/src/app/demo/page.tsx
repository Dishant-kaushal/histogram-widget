'use client';

// TEMPORARY demo page — renders the HistogramWidget with mock UNS series data
// so we can see the chart shape without a backend. Safe to delete.

import { useMemo } from 'react';
import { HistogramWidget } from '../../components/HistogramWidget/HistogramWidget';
import type { DataEntry, HistogramUIConfig, SeriesSlot } from '../../iosense-sdk/types';

// Build a normal-ish distribution of ~600 points in [0,100] across 5 days.
function mockSlots(): SeriesSlot[] {
  const slots: SeriesSlot[] = [];
  const start = 1_700_000_000_000;
  let seed = 42;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  for (let i = 0; i < 600; i++) {
    // sum of 3 uniforms → bell-ish, scaled to 0..100
    const v = ((rand() + rand() + rand()) / 3) * 100;
    slots.push({
      from: start + i * 12 * 60 * 1000, // every 12 min → spans ~5 days
      to: start + i * 12 * 60 * 1000,
      label: '',
      value: Math.round(v * 100) / 100,
      quality: 'good',
    });
  }
  return slots;
}

const BINS = Array.from({ length: 10 }, (_, i) => ({
  start: i * 10,
  end: (i + 1) * 10,
  binName: '-',
  color: ['#4d79ff', '#5b8cff', '#6f9bff', '#85b8ff', '#9fc7ff', '#7bd88f', '#f0a050', '#f07a7a', '#c77dff', '#4dd0e1'][i],
}));

const UI: HistogramUIConfig = {
  chartTitle: 'Temperature Distribution',
  chartLabel: 'Temperature',
  aggregationMode: 'cumulative',
  includeStartEnd: false,
  showBinRanges: true,
  showLineChart: true,
  showDistributionLine: true,
  showPlotLines: true,
  plotLines: [{ _id: 'p1', name: 'Target', color: '#ff5252', value: 90, lineWidth: 2, dashStyle: 'Dash' }],
  dataSources: [
    { _id: 'ds1', name: 'Line A Temp', unsPath: '{{uns:ws1://plant/lineA/temp}}', dataPrecision: 2, enableLineChart: true, automaticBinWidth: true, bins: BINS },
  ],
  style: {
    size: { preset: 'Large', customWidth: 1400, customHeight: 480 },
    card: { wrapInCard: true, backgroundColor: '#FFFFFF', borderColor: '#EEEEEE', borderWidth: 1, borderRadius: 8 },
    hideElements: { settingsIcon: false, exportIcon: false, chartTitle: false },
    advancedEnabled: false,
    chartTitle: { fontSize: 18, fontColor: '#050505', fontWeight: 'Semi-Bold' },
    xAxisLabel: { textColor: '#7a88b0', lineColor: '#DEE1E3', dataPointColor: '#7a88b0' },
    yAxisLabel: { textColor: '#7a88b0', lineColor: '#333333', dataPointColor: '#7a88b0' },
    dataLabels: { color: '#FFFFFF', fontSize: 11 },
    distribution: { color: '#FF6B6B', width: 3, dashStyle: 'Solid' },
    misc: { gridLineColor: '#e5e9f2', legendTextColor: '#3b4560' },
  },
};

export default function Demo() {
  const data: DataEntry[] = useMemo(
    () => [{ key: 'dataSources[0].unsPath', value: { __type: 'series', path: '', meta: {} as never, range: { from: 0, to: 0 }, slots: mockSlots() } }],
    [],
  );
  return (
    <div style={{ padding: 24, background: '#f2f4f8', minHeight: '100vh' }}>
      <div style={{ maxWidth: 1400, height: 500, margin: '0 auto' }}>
        <HistogramWidget config={UI} data={data} onEvent={(e) => console.log(e)} />
      </div>
    </div>
  );
}
