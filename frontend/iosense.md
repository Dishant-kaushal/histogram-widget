# iosense.md — Histogram Widget (IO Lens v2 port)

Port of the IO Lens v1 `actualHistogram` Angular widget to a React micro-frontend
following the v2 DataLayer architecture (widgets are pure renderers; all data
resolution goes through the mini-engine's `resolveAndCompute`).

## Project state

- **Location:** `frontend/` (Next.js app is the base — same convention as the
  ColumnChart / ImageWidget / WidgetTemplate projects):
  - `src/components/HistogramWidget/` — pure widget + DataLayer wrapper (`index.ts`)
  - `src/components/HistogramWidgetConfiguration/` — configurator
  - `src/iosense-sdk/` — `types.ts`, `api.ts`, `mini-engine.ts`
  - `src/app/page.tsx` — dev preview harness (config panel + live widget)
- **Widget type key:** `HistogramWidget` (config: `HistogramWidgetConfiguration`),
  self-registered on `window.ReactWidgets` (SSR-safe `typeof window` guard) for the
  Lens host to `mount`/`update`/`unmount`.
- **Build:** `npm run build` (Next.js). Dev harness: `npm run dev` →
  http://localhost:3000/?token=<SSO_TOKEN> (or paste a JWT into the token field).

## API calls used (function IDs / endpoints)

| Purpose | Endpoint | Notes |
|---|---|---|
| SSO token exchange | `GET https://connector.iosense.io/api/retrieve-sso-token/{ssoToken}` | Dev harness auth; stores `bearer_token` + `organisation` in localStorage |
| Data resolution (ALL widget data) | `POST https://stagingsv.iosense.io/api/account/uns/resolveAndCompute` | Body: `{ graph: "iosense_test_uns", config: [{key, topic}], startTime, endTime }` (ms epoch). One batched call for every entry in `dynamicBindingPathList`. |

The v1 endpoints (`PUT /api/account/histogram/fetchDeviceRange`,
`PUT /api/account/histogram/getLineChartData`) are **not** used in v2 — binning,
daily grouping, and the hour-of-day drill-down are computed client-side from the
resolved series slots.

## Open contract question (backend team)

Whether `resolveAndCompute` can return histogram-bucketed counts for a series
topic. Current implementation assumes it returns the raw time-series
(`{slots: [{time, value}]}` or similar) and **bins client-side** in
`histogram-utils.ts` (`normalizeSeriesPoints` is tolerant of `slots[]`,
`{time|timestamp, value|data}` objects, `[t, v]` tuples, and bare arrays).

## v1 semantics preserved

- Bin model `{start, end, binName, color}`; `''`/`'-'` binName sentinels → "Bin {i}" fallback
- `createGroups` auto-binning with last-bin end snapped to max
- Counts summed per bin, concatenated across data sources
- Cumulative vs Daily (grouped by weekday) aggregation; Daily pairs with a 7-day window (configurator auto-sets duration)
- Data labels inside bars rotated -90°, x-labels rotate -45° when >10 bins
- `showBinRanges`, normal-distribution spline overlay (Gaussian from bin frequencies, 200 pts), Y-axis plot lines
- Per-bin drill-down → 24-hour ("00:00"–"23:00") frequency line chart, clear-then-redraw, bin-colored
- Export XLSX/CSV (SheetJS, replaces alasql) + PNG (Highcharts offline export)

## Envelope shape emitted by the configurator

```jsonc
{
  "_id": "histogram_<ts>",
  "type": "HistogramWidget",
  "general": { "title": "" },
  "timeConfig": { "timezone", "type": "local|fixed", "startTime", "endTime",
                  "defaultDuration", "allDurations", "defaultPeriodicity" },
  "uiConfig": {
    "chartTitle", "chartLabel",
    "dataSources": [{ "id", "title", "topic": "{{uns topic}}", "bins": [Bin] }],
    "aggregationMode": "cumulative|daily",
    "showBinRanges", "showDistributionLine", "distributionLineColor|Width|DashStyle",
    "showLineChart", "showPlotLines", "plotLines": [PlotLine]
  },
  "dynamicBindingPathList": [{ "key": "dataSources[0].topic", "topic": "<no braces>", "type": "series" }]
}
```
