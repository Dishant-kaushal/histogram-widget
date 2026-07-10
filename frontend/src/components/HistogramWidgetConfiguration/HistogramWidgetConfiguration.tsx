'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode, ChangeEvent } from 'react';
import { Plus, Edit2, Trash2, ArrowLeft, Info } from 'react-feather';
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { ColorInput } from '@faclon-labs/design-sdk/ColorPicker';
import {
  Tabs,
  TabItem,
  TextInput,
  Button,
  IconButton,
  SelectInput,
  DropdownMenu,
  ActionListItem,
  Switch,
  Checkbox,
  Divider,
  TimeTabConfiguration,
  ProductAccordionItem,
  ListCard,
  Modal,
  ModalHeader,
  ModalBody,
  ModalFooter,
} from '@faclon-labs/design-sdk';
import { useUNSTree, type UNSTree } from '../../iosense-sdk/useUNSTree';
import type {
  Bin,
  BindingEntry,
  HistogramAxis,
  HistogramChart,
  HistogramDataSource,
  HistogramDistributionLine,
  HistogramEnvelope,
  HistogramPlotLine,
  PlotLineValueType,
  HistogramStyling,
  HistogramUIConfig,
  HostDefaultDuration,
  HostTimeConfig,
  StylingFontWeight,
  TimeTabUIConfig,
  GTPGlobalTimepicker,
} from '../../iosense-sdk/types';
import './HistogramWidgetConfiguration.css';

// ─── Constants ────────────────────────────────────────────────────────────────

// Built-in duration roster — mirrors the SDK TimeTabConfiguration's presets so a
// selected id is always present in allDurations for the host to derive the window.
// NOTE: the `id`s here MUST be members of the SDK TimeTabConfiguration's built-in
// duration catalog (today, yesterday, current_week, previous_7_days, current_month,
// previous_month, previous_3_month, previous_12_month, current_year, previous_year).
// The SDK's Duration accordion counts `enabledBuiltIns + nonBuiltInCustoms`; any id
// NOT in that catalog is rendered as a separate "custom" row AND inflates the badge
// past the enabled list. Seeding only catalog ids keeps the count == the durations
// shown as active. `label`/`periodicities` overrides are fine — they don't change
// built-in-ness (matched by id), so we still get friendly labels + our periodicities.
const FALLBACK_TIME_CONFIG: TimeTabUIConfig = {
  timezone: 'Asia/Kolkata',
  timeType: 'local',
  defaultDurationId: 'previous_7_days',
  defaultPeriodicity: 'hourly',
  allDurations: [
    { id: 'today', label: 'Today', calendarType: 'today', isBuiltIn: true, periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'yesterday', label: 'Yesterday', calendarType: 'yesterday', isBuiltIn: true, periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'previous_7_days', label: 'Last 7 Days', x: 7, xPeriod: 'day', isBuiltIn: true, periodicities: ['hourly', 'daily'] },
    { id: 'current_week', label: 'Current Week', calendarType: 'current_week', isBuiltIn: true, periodicities: ['hourly', 'daily'] },
    { id: 'current_month', label: 'Current Month', calendarType: 'current_month', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
    { id: 'previous_month', label: 'Previous Month', calendarType: 'previous_month', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
    { id: 'previous_3_month', label: 'Last 3 Months', x: 3, xPeriod: 'month', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
    { id: 'current_year', label: 'Current Year', calendarType: 'current_year', isBuiltIn: true, periodicities: ['weekly', 'monthly'] },
  ] as TimeTabUIConfig['allDurations'],
};

/**
 * Ensure the working time config always carries the full duration roster. The
 * host can hand the configurator a skeleton `timeConfig`/`timeTabConfig` with no
 * `allDurations` (the SDK TimeTabConfiguration only populates them once its Time
 * tab is rendered). Without this, the saved envelope — and therefore the widget's
 * date picker — would offer only "Custom" until the user opens the Time tab.
 */
function withDefaultDurations(saved: TimeTabUIConfig | undefined): TimeTabUIConfig {
  const durs = (saved as { allDurations?: unknown[] } | undefined)?.allDurations;
  if (saved && Array.isArray(durs) && durs.length > 0) return saved;
  return {
    ...FALLBACK_TIME_CONFIG,
    ...(saved ?? {}),
    allDurations: FALLBACK_TIME_CONFIG.allDurations,
  } as TimeTabUIConfig;
}

const DEFAULT_STYLING: HistogramStyling = {
  size: { preset: 'Medium', customWidth: 880, customHeight: 400, lockAspectRatio: false },
  card: { wrapInCard: true, backgroundColor: '#FFFFFF', borderColor: '#EEEEEE', borderWidth: 1, borderRadius: 8 },
  hideElements: { settingsIcon: false, exportIcon: false, chartTitle: false },
  advancedEnabled: false,
  chartTitle: { fontSize: 18, fontColor: '#050505', fontWeight: 'Semi-Bold' },
  xAxisLabel: { textColor: '#050505', lineColor: '#DEE1E3', dataPointColor: '#050505' },
  yAxisLabel: { textColor: '#050505', lineColor: '#333333', dataPointColor: '#050505' },
  dataLabels: { color: '#FFFFFF', fontSize: 11 },
  distribution: { color: '#FF6B6B', width: 3, dashStyle: 'Solid' },
  misc: { gridLineColor: '#DEE1E3', legendTextColor: '#292F2E' },
};

// Per-chart defaults. A widget holds a list of these; `style` is shared (below).
const DEFAULT_CHART: Omit<HistogramChart, '_id'> = {
  chartTitle: 'Histogram',
  chartLabel: 'Parameter',
  dataSources: [],
  bins: [],
  axes: [],
  leftAxisName: 'Y Axis',
  distributionLines: [],
  aggregationMode: 'cumulative',
  includeStartEnd: false,
  showBinRanges: false,
  showLineChart: false,
  showDistributionLine: false,
  showPlotLines: false,
  plotLines: [],
};

/** Build a fresh chart. Index seeds the default title ("Histogram", "Histogram 2"…). */
function newHistogramChart(index: number): HistogramChart {
  return {
    ...DEFAULT_CHART,
    _id: `chart_${Date.now()}_${index}`,
    chartTitle: index === 0 ? 'Histogram' : `Histogram ${index + 1}`,
  };
}

const DEFAULT_UI_CONFIG: HistogramUIConfig = {
  charts: [],
  activeChartId: null,
  style: DEFAULT_STYLING,
};

/** Accept both the new multi-chart shape and the legacy flat single-histogram
 *  config (wrap it into one chart) so already-saved envelopes keep working. A
 *  fresh widget starts with NO charts (Figma stage 1 — the user adds the first). */
function normalizeHistogramUIConfig(raw: unknown): HistogramUIConfig {
  const obj = (raw ?? {}) as Partial<HistogramUIConfig> & Partial<HistogramChart> & Record<string, unknown>;
  const style = { ...DEFAULT_STYLING, ...((obj.style as HistogramUIConfig['style']) ?? {}) };
  // An explicit charts array (even empty) is the new shape — respect it as-is.
  if (Array.isArray(obj.charts)) {
    const charts = obj.charts.map((c, i) => ({ ...DEFAULT_CHART, ...c, _id: c._id || `chart_${i + 1}` }));
    const activeChartId = charts.find((c) => c._id === obj.activeChartId)?._id ?? charts[0]?._id ?? null;
    return { charts, activeChartId, style };
  }
  // Legacy flat config → wrap the per-chart fields into a single chart.
  const hasOldData = obj.dataSources || obj.bins || obj.chartTitle || obj.plotLines;
  if (hasOldData) {
    const chart: HistogramChart = { ...DEFAULT_CHART, ...(obj as Partial<HistogramChart>), _id: 'chart_1' };
    return { charts: [chart], activeChartId: chart._id, style };
  }
  return { charts: [], activeChartId: null, style };
}

// Enumerated style choices (mirror the values the renderer maps).
const FONT_WEIGHTS: { value: StylingFontWeight; label: string }[] = [
  { value: 'Regular', label: 'Regular' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Semi-Bold', label: 'Semi-Bold' },
  { value: 'Bold', label: 'Bold' },
];

// Default bar colors assigned to new data sources (cycled by index).
const SOURCE_COLORS = ['#4D79FF', '#7BD88F', '#F0A050', '#F07A7A', '#C77DFF', '#4DD0E1', '#85B8FF', '#FFB74D'];

// Highcharts dashStyle values (title-cased to match the renderer's cast).
const DASH_STYLES: { value: string; label: string }[] = [
  { value: 'Solid', label: 'Solid' },
  { value: 'Dash', label: 'Dash' },
  { value: 'Dot', label: 'Dot' },
  { value: 'ShortDash', label: 'Short Dash' },
  { value: 'LongDash', label: 'Long Dash' },
  { value: 'DashDot', label: 'Dash Dot' },
];

// ─── Helpers ──────────────────────────────────────────────────────────────────

const VARIABLE_REGEX = /^\{\{(.+)\}\}$/;

/** Scan every chart's dataSources[].unsPath for {{topic}} bindings, keyed per
 *  chart index → { key: `charts[ci].dataSources[i].unsPath`, topic, type:'series' }. */
function buildDynamicBindingPathList(uiConfig: HistogramUIConfig): BindingEntry[] {
  const paths: BindingEntry[] = [];
  (uiConfig.charts ?? []).forEach((chart, ci) => {
    (chart.dataSources ?? []).forEach((s, i) => {
      const raw = (s.unsPath || '').trim();
      const match = VARIABLE_REGEX.exec(raw);
      if (match) paths.push({ key: `charts[${ci}].dataSources[${i}].unsPath`, topic: match[1], type: 'series' });
    });
    // Dynamic plot lines — the line's value comes from a bound device topic.
    (chart.plotLines ?? []).forEach((pl, pi) => {
      if (pl.valueType !== 'Dynamic') return;
      const raw = (pl.unsPath || '').trim();
      const match = VARIABLE_REGEX.exec(raw);
      if (match) paths.push({ key: `charts[${ci}].plotLines[${pi}].unsPath`, topic: match[1], type: 'series' });
    });
  });
  return paths;
}

/**
 * Host time contract (view-ai-lens executeQuery → data-layer time-calculator):
 * the host reads `widgetConfig.timeTabConfig || widgetConfig.timeConfig`, then
 * builds its query TimeConfig as { timezone, defaultDuration: allDurations.find(
 * id === defaultDurationId), cycleTime, shifts }. calculateTimeRange() then reads
 * `cycleTime.hour` and `defaultDuration.{navigation,x,xPeriod,xEvent,y,yPeriod,
 * yEvent}` UNCONDITIONALLY. So every emitted duration must be fully resolved and
 * cycleTime must be a non-null object — otherwise the DataLayer query throws
 * "Cannot read properties of undefined (reading 'hour')" and nothing renders.
 */

// SDK-shaped empty cycle time that is also host-safe (parseInt('')||0 → 0).
// Mirrors the host's own fallback: { identifier:'start', hour:'', minute:'', … }.
const EMPTY_CYCLE_TIME = {
  cycleTimeType: 'calendar' as const,
  identifier: 'start' as const,
  hour: '',
  minute: '',
  dayOfWeek: null,
  date: '',
  month: null,
  year: '',
};

type SdkPreset = TimeTabUIConfig['allDurations'][number];

/**
 * Fill in the resolved window fields the host's calculateTimeRange requires.
 * Calendar presets map to exact anchors (host semantics: start = periodStart(
 * xPeriod,xEvent) + sign*x, end = periodStart(yPeriod,yEvent) + sign*y,
 * sign = -1 for 'Previous'). Existing fields on a preset are preserved.
 */
function resolveHostPreset(p: SdkPreset): SdkPreset {
  const d = p as SdkPreset & Record<string, unknown>;
  if (d.navigation && d.xPeriod && d.xEvent && d.yPeriod && d.yEvent) return p; // already resolved
  // start:[x, xPeriod, xEvent], end:[y, yPeriod, yEvent] under navigation:'Previous'
  const CAL: Record<string, [number, string, string, number, string, string]> = {
    today: [0, 'day', 'start', 0, 'day', 'end'],
    yesterday: [1, 'day', 'start', 0, 'day', 'start'],
    current_week: [0, 'week', 'start', 0, 'week', 'end'],
    previous_week: [1, 'week', 'start', 0, 'week', 'start'],
    current_month: [0, 'month', 'start', 0, 'month', 'end'],
    previous_month: [1, 'month', 'start', 0, 'month', 'start'],
    current_year: [0, 'year', 'start', 0, 'year', 'end'],
    previous_year: [1, 'year', 'start', 0, 'year', 'start'],
  };
  const cal = d.calendarType ? CAL[d.calendarType as string] : undefined;
  const [x, xPeriod, xEvent, y, yPeriod, yEvent] = cal ?? [
    // Relative "Last X <period>" (x/xPeriod already on the preset) → window ends now.
    typeof d.x === 'number' ? d.x : 24,
    (d.xPeriod as string) ?? 'hour',
    'now',
    0,
    (d.xPeriod as string) ?? 'hour',
    'now',
  ];
  return {
    ...p,
    navigation: (d.navigation as string) ?? 'Previous',
    x, xPeriod, xEvent, y, yPeriod, yEvent,
  } as SdkPreset;
}

/**
 * Normalize the SDK TimeTabUIConfig so the host's preferred read path
 * (`timeTabConfig`) never hits an undefined cycleTime / unresolved duration.
 */
function hostSafeTimeTab(t: TimeTabUIConfig): TimeTabUIConfig {
  return {
    ...t,
    timezone: t.timezone || 'Asia/Kolkata',
    cycleTime: t.cycleTime ?? EMPTY_CYCLE_TIME,
    shifts: t.shifts ?? [],
    allDurations: (t.allDurations ?? []).map(resolveHostPreset),
  } as TimeTabUIConfig;
}

/**
 * Emit the RICH host `timeConfig` (mirrors the completed line chart). The host
 * passes THIS object to the widget as `props.timeConfig` (it does NOT pass the raw
 * SDK `timeTabConfig`), and its engine derives the window from
 * `allDurations` + `defaultDurationId`. Carrying the full roster + `defaultPeriodicity`
 * + `pickerType` is what lets the widget rebuild the date picker and pick a sane
 * initial periodicity after a save + refresh.
 */
function toHostTimeConfig(t: TimeTabUIConfig): HostTimeConfig {
  const safe = hostSafeTimeTab(t);
  const pickerType = ((t as { linkTimeWith?: string; timeType?: string }).linkTimeWith ??
    (t as { timeType?: string }).timeType ??
    'local') as 'local' | 'fixed' | 'global';
  const fd = (t as { fixed?: { duration?: Record<string, unknown> } }).fixed?.duration;
  const fixedDuration =
    pickerType === 'fixed' && fd
      ? (resolveHostPreset(fd as unknown as SdkPreset) as unknown as HostDefaultDuration)
      : undefined;
  const cycleTime =
    pickerType === 'fixed'
      ? ((t as { fixed?: { cycleTime?: unknown } }).fixed?.cycleTime ?? null)
      : (safe.cycleTime ?? null);
  return {
    type: pickerType === 'global' ? 'local' : pickerType,
    pickerType,
    startTime: null,
    endTime: null,
    fixedDuration,
    defaultDurationId: safe.defaultDurationId,
    allDurations: (safe.allDurations ?? []) as unknown as HostDefaultDuration[],
    defaultPeriodicity:
      pickerType === 'fixed' && (fd as { periodicity?: string })?.periodicity
        ? String((fd as { periodicity?: string }).periodicity).toLowerCase()
        : safe.defaultPeriodicity,
    timezone: safe.timezone,
    cycleTime: safe.cycleTime as unknown as HostTimeConfig['cycleTime'],
    shifts: [],
  };
}

function num(v: string, fallback = 0): number {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Span-based icon action — a clickable that is NOT a <button>. Used inside the
 * ProductAccordionItem header and ListCard trailing slots, both of which render
 * as <button> themselves; a nested <button> is invalid HTML (React dev warning).
 */
function IconAction({
  icon,
  label,
  onClick,
  small,
  destructive,
}: {
  icon: ReactNode;
  label: string;
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
  // `small` (20px) matches the SDK chevron so header actions align with it.
  small?: boolean;
  // `destructive` renders the icon in the error color (e.g. Delete).
  destructive?: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`hcfg-icon-action${small ? ' hcfg-icon-action--sm' : ''}${destructive ? ' hcfg-icon-action--destructive' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(e); }
      }}
    >
      {icon}
    </span>
  );
}


// ─── Bin ranges — inline From/To rows (Figma "Bin Range" accordion) ──────────

function BinRows({ bins, onChange }: { bins: Bin[]; onChange: (bins: Bin[]) => void }) {
  // Bins are a contiguous auto-generated chain: every From = the previous bin's
  // To (disabled). Only the To of NON-last bins is editable; editing it shifts
  // every following bin by the same delta so the chain stays contiguous. The
  // LAST bin's From AND To are both disabled (auto).
  const updateEnd = (i: number, value: number) => {
    const delta = value - bins[i].end;
    onChange(
      bins.map((b, j) => {
        if (j < i) return b;
        if (j === i) return { ...b, end: value };
        return { ...b, start: b.start + delta, end: b.end + delta };
      }),
    );
  };
  const remove = (i: number) => {
    // Re-chain From = previous To after removal so bins stay contiguous.
    const kept = bins.filter((_, idx) => idx !== i);
    let start = kept[0]?.start ?? 0;
    onChange(
      kept.map((b, idx) => {
        if (idx === 0) {
          start = b.end;
          return b;
        }
        const width = Math.max(1, b.end - b.start);
        const next = { ...b, start, end: start + width };
        start = next.end;
        return next;
      }),
    );
  };
  const add = () => {
    const last = bins[bins.length - 1];
    const start = last ? last.end : 0; // contiguous: new From = previous To
    const width = last ? Math.max(1, last.end - last.start) : 1000;
    onChange([...bins, { start, end: start + width }]);
  };
  return (
    <div className="hcfg-bin-rows">
      {bins.map((bin, i) => {
        const isLast = i === bins.length - 1;
        return (
          <div key={i} className="hcfg-bin-row">
            <TextInput label="From" type="number" isDisabled value={String(bin.start)} onChange={() => {}} />
            <TextInput label="To" type="number" isDisabled={isLast} value={String(bin.end)} onChange={({ value }: { value: string }) => updateEnd(i, num(value))} />
            <IconAction destructive icon={<Trash2 size={16} />} label={`Remove bin ${i + 1}`} onClick={() => remove(i)} />
          </div>
        );
      })}
      <div className="hcfg-add-row">
        <button type="button" className="hcfg-add-bin-btn" onClick={add}>
          <Plus size={16} />
          Add Bin
        </button>
      </div>
    </div>
  );
}

// ─── Add / Edit Axis form (popup) ────────────────────────────────────────────
// A default Y axis always exists; each added axis binds ONE data source and sits
// on the Left or Right side of the chart (matches the Column/Line chart flow).

const AXIS_SIDES: { value: 'left' | 'right'; label: string }[] = [
  { value: 'left', label: 'Left' },
  { value: 'right', label: 'Right' },
];

function AxisForm({
  initial,
  existingNames,
  availableSources,
  onSubmit,
  onReady,
}: {
  initial: HistogramAxis | null;
  existingNames: string[];
  availableSources: HistogramDataSource[];
  onSubmit: (axis: { name: string; dataSourceId: string; side: 'left' | 'right' }) => void;
  onReady: (b: EditorBinding) => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'Value');
  const [sourceId, setSourceId] = useState(initial?.dataSourceId ?? availableSources[0]?._id ?? '');
  const [side, setSide] = useState<'left' | 'right'>(initial?.side ?? 'right');
  const [srcOpen, setSrcOpen] = useState(false);
  const [sideOpen, setSideOpen] = useState(false);

  const nameTaken = existingNames.map((n) => n.trim().toLowerCase()).includes(name.trim().toLowerCase());
  const isValid = name.trim() !== '' && !nameTaken && sourceId !== '';

  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit({ name: name.trim(), dataSourceId: sourceId, side });
  }, [isValid, name, sourceId, side, onSubmit]);

  useEditorBinding(isValid, submit, onReady);

  return (
    <div className="hcfg-editor">
      <TextInput
        label="Name"
        necessityIndicator="required"
        value={name}
        validationState={nameTaken ? 'error' : undefined}
        helpText={nameTaken ? 'This name already exists. Try a different name.' : undefined}
        onChange={({ value }: { value: string }) => setName(value)}
      />
      <SelectInput
        label="Data Source"
        placeholder="Select data source"
        value={availableSources.find((s) => s._id === sourceId)?.name || ''}
        isOpen={srcOpen}
        onClick={() => setSrcOpen((o) => !o)}
      >
        <DropdownMenu>
          {availableSources.length === 0 ? (
            <ActionListItem title="No data source available" selectionType="None" isDisabled />
          ) : (
            availableSources.map((s) => (
              <ActionListItem
                key={s._id}
                title={s.name || 'Data Source'}
                selectionType="Single"
                isSelected={sourceId === s._id}
                onClick={() => { setSourceId(s._id); setSrcOpen(false); }}
              />
            ))
          )}
        </DropdownMenu>
      </SelectInput>
      <SelectInput
        label="Position"
        placeholder="Select side"
        value={AXIS_SIDES.find((o) => o.value === side)?.label || ''}
        isOpen={sideOpen}
        onClick={() => setSideOpen((o) => !o)}
      >
        <DropdownMenu>
          {AXIS_SIDES.map((o) => (
            <ActionListItem
              key={o.value}
              title={o.label}
              selectionType="Single"
              isSelected={side === o.value}
              onClick={() => { setSide(o.value); setSideOpen(false); }}
            />
          ))}
        </DropdownMenu>
      </SelectInput>
    </div>
  );
}

// ─── Add/Edit Plotline form (popup) ──────────────────────────────────────────

function PlotLineForm({
  initial,
  onSubmit,
  onReady,
  unsTree,
  isLoadingTree,
  loadWorkspaces,
  resolveUNSValue,
}: {
  initial: HistogramPlotLine | null;
  onSubmit: (pl: Omit<HistogramPlotLine, '_id'>) => void;
  onReady: (b: EditorBinding) => void;
  unsTree: UNSTree;
  isLoadingTree: boolean;
  loadWorkspaces: () => void;
  resolveUNSValue: (raw: string) => string;
}) {
  const [name, setName] = useState(initial?.name ?? 'Value');
  const [color, setColor] = useState(initial?.color ?? '#FF0000');
  const [valueType, setValueType] = useState<PlotLineValueType>(initial?.valueType ?? 'Fixed');
  const [vtOpen, setVtOpen] = useState(false);
  const [value, setValue] = useState(initial ? String(initial.value) : '0');
  const [unsPath, setUnsPath] = useState(initial?.unsPath ?? '');
  const [lineWidth, setLineWidth] = useState(initial ? String(initial.lineWidth) : '2');
  const [dashStyle, setDashStyle] = useState<string>(initial?.dashStyle ?? 'Solid');
  const [styleOpen, setStyleOpen] = useState(false);

  // Dynamic value requires a bound topic; Fixed just needs a name.
  const isValid = name.trim() !== '' && (valueType !== 'Dynamic' || unsPath.trim() !== '');
  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit({
      name: name.trim(),
      color,
      valueType,
      value: num(value),
      unsPath: valueType === 'Dynamic' ? unsPath : undefined,
      lineWidth: num(lineWidth, 2),
      dashStyle,
    });
  }, [isValid, name, color, valueType, value, unsPath, lineWidth, dashStyle, onSubmit]);
  useEditorBinding(isValid, submit, onReady);

  return (
    <div className="hcfg-editor">
      <TextInput label="Name" necessityIndicator="required" placeholder="Enter line name" value={name} onChange={({ value: v }: { value: string }) => setName(v)} />
      <ColorInput label="Color" placeholder="Select color" value={color} onChange={(v: string) => setColor(v)} />
      <SelectInput label="Value Type" value={valueType} isOpen={vtOpen} onClick={() => setVtOpen((o) => !o)}>
        <DropdownMenu>
          {(['Fixed', 'Dynamic'] as PlotLineValueType[]).map((t) => (
            <ActionListItem key={t} title={t} selectionType="Single" isSelected={valueType === t} onClick={() => { setValueType(t); setVtOpen(false); }} />
          ))}
        </DropdownMenu>
      </SelectInput>
      {valueType === 'Fixed' ? (
        <TextInput label="Value" type="number" placeholder="Enter value" value={value} onChange={({ value: v }: { value: string }) => setValue(v)} />
      ) : (
        <UNSPathInput
          label="Value Source (UNS Path)"
          necessityIndicator="required"
          placeholder="Enter UNS Path"
          value={unsPath}
          tree={unsTree}
          isLoading={isLoadingTree}
          onOpen={loadWorkspaces}
          onChange={(v: string) => setUnsPath(resolveUNSValue(v))}
        />
      )}
      <ProductAccordionItem title="Style" isExpanded={styleOpen} onToggle={() => setStyleOpen((v) => !v)}>
        {styleOpen && (
          <div className="hcfg-accordion-body">
            <div className="hcfg-row">
              <TextInput label="Line Width" type="number" placeholder="Enter width" value={lineWidth} onChange={({ value: v }: { value: string }) => setLineWidth(v)} />
              <StyleSelect label="Line Style" value={dashStyle} options={DASH_STYLES} onSelect={(v) => setDashStyle(v)} />
            </div>
          </div>
        )}
      </ProductAccordionItem>
    </div>
  );
}

// ─── Add/Edit Distribution Line form (popup) ─────────────────────────────────

function DistributionLineForm({
  initial,
  onSubmit,
  onReady,
}: {
  initial: HistogramDistributionLine | null;
  onSubmit: (dl: Omit<HistogramDistributionLine, '_id'>) => void;
  onReady: (b: EditorBinding) => void;
}) {
  const [name, setName] = useState(initial?.name ?? 'Line 1');
  const [color, setColor] = useState(initial?.color ?? '#FF6B6B');
  const [lineWidth, setLineWidth] = useState(initial ? String(initial.lineWidth) : '3');
  const [dashStyle, setDashStyle] = useState<string>(initial?.dashStyle ?? 'Solid');
  const [styleOpen, setStyleOpen] = useState(false);

  const isValid = name.trim() !== '';
  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit({ name: name.trim(), color, lineWidth: num(lineWidth, 3), dashStyle });
  }, [isValid, name, color, lineWidth, dashStyle, onSubmit]);
  useEditorBinding(isValid, submit, onReady);

  return (
    <div className="hcfg-editor">
      <TextInput label="Name" necessityIndicator="required" placeholder="Enter line name" value={name} onChange={({ value: v }: { value: string }) => setName(v)} />
      <ColorInput label="Color" placeholder="Select color" value={color} onChange={(v: string) => setColor(v)} />
      <ProductAccordionItem title="Style" isExpanded={styleOpen} onToggle={() => setStyleOpen((v) => !v)}>
        {styleOpen && (
          <div className="hcfg-accordion-body">
            <div className="hcfg-row">
              <TextInput label="Line Width" type="number" placeholder="Enter width" value={lineWidth} onChange={({ value: v }: { value: string }) => setLineWidth(v)} />
              <StyleSelect label="Line Style" value={dashStyle} options={DASH_STYLES} onSelect={(v) => setDashStyle(v)} />
            </div>
          </div>
        )}
      </ProductAccordionItem>
    </div>
  );
}

// ─── Data Source editor (opens in a side modal, like the Line Chart) ─────────

interface EditorBinding {
  submit: () => void;
  isValid: boolean;
}

function useEditorBinding(isValid: boolean, submit: () => void, onReady: (b: EditorBinding) => void) {
  // Hold the latest submit in a ref so the effect doesn't depend on its identity
  // (the parent passes a fresh inline onSubmit each render → would loop otherwise).
  const submitRef = useRef(submit);
  submitRef.current = submit;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  useEffect(() => {
    onReadyRef.current({ isValid, submit: () => submitRef.current() });
  }, [isValid]);
}

interface DataSourceEditorProps {
  initial: HistogramDataSource | null;
  existingCount: number;
  unsTree: UNSTree;
  isLoadingTree: boolean;
  loadWorkspaces: () => void;
  resolveUNSValue: (raw: string) => string;
  onSubmit: (s: HistogramDataSource) => void;
  onReady: (b: EditorBinding) => void;
}

function DataSourceEditor({
  initial,
  existingCount,
  unsTree,
  isLoadingTree,
  loadWorkspaces,
  resolveUNSValue,
  onSubmit,
  onReady,
}: DataSourceEditorProps) {
  const [name, setName] = useState(initial?.name ?? '');
  const [color, setColor] = useState(initial?.color ?? SOURCE_COLORS[existingCount % SOURCE_COLORS.length]);
  const [unsPath, setUnsPath] = useState(initial?.unsPath ?? '');
  const [dataPrecision, setDataPrecision] = useState(initial ? String(initial.dataPrecision) : '2');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  // Bins are configured in the separate "Bins" accordion, not in this popup.
  // New sources start with none; editing preserves the source's existing bins.
  const bins = initial?.bins ?? [];

  const isValid = name.trim().length > 0 && color.trim().length > 0 && unsPath.trim().length > 0;

  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit({
      _id: initial?._id ?? `ds_${Date.now()}_${existingCount}`,
      name: name.trim(),
      color,
      unsPath,
      dataPrecision: Math.max(0, Math.floor(num(dataPrecision, 2))),
      unit: unit.trim() || undefined,
      // Line-chart mode is now a chart-level toggle in the Data Sources accordion
      // body; preserve any legacy per-source value on edit.
      enableLineChart: initial?.enableLineChart ?? false,
      automaticBinWidth: initial?.automaticBinWidth ?? true,
      bins,
    });
  }, [isValid, initial, existingCount, name, color, unsPath, dataPrecision, unit, bins, onSubmit]);

  useEditorBinding(isValid, submit, onReady);

  return (
    <div className="hcfg-editor">
      <TextInput
        label="Data Source Name"
        necessityIndicator="required"
        placeholder="Enter Data Source Name"
        value={name}
        onChange={({ value }: { value: string }) => setName(value)}
      />
      <ColorInput label="Color *" placeholder="Select color" value={color} onChange={(v: string) => setColor(v)} />
      <UNSPathInput
        label="UNS Path"
        necessityIndicator="required"
        placeholder="Enter UNS Path"
        value={unsPath}
        tree={unsTree}
        isLoading={isLoadingTree}
        onOpen={loadWorkspaces}
        onChange={(value: string) => setUnsPath(resolveUNSValue(value))}
      />
      <div className="hcfg-row">
        <TextInput
          label="Data Precision"
          type="number"
          placeholder="Enter value"
          value={dataPrecision}
          helpText={`Accurate to ${num(dataPrecision, 2)} decimals`}
          onChange={({ value }: { value: string }) => setDataPrecision(value)}
        />
        <TextInput
          label="Unit"
          placeholder="e.g. °C, kWh"
          value={unit}
          onChange={({ value }: { value: string }) => setUnit(value)}
        />
      </div>
    </div>
  );
}

// ─── Style tab (v1 Stage 3 "Chart Customization" + all styling) ─────────────

/** Small enum dropdown built on the SDK SelectInput (self-manages open state). */
function StyleSelect<T extends string>({
  label,
  value,
  options,
  onSelect,
}: {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  onSelect: (v: T) => void;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((o) => o.value === value);
  return (
    <SelectInput label={label} value={current?.label ?? String(value)} isOpen={open} onClick={() => setOpen((o) => !o)}>
      <DropdownMenu>
        {options.map((o) => (
          <ActionListItem
            key={o.value}
            title={o.label}
            selectionType="Single"
            isSelected={value === o.value}
            onClick={() => {
              onSelect(o.value);
              setOpen(false);
            }}
          />
        ))}
      </DropdownMenu>
    </SelectInput>
  );
}

function StylingSection({
  value,
  onChange,
}: {
  value: HistogramStyling;
  onChange: (next: HistogramStyling) => void;
}) {
  function update<K extends keyof HistogramStyling>(key: K, patch: Partial<HistogramStyling[K]>) {
    const prev = value[key];
    const merged =
      prev && typeof prev === 'object' && !Array.isArray(prev)
        ? { ...(prev as object), ...(patch as object) }
        : patch;
    onChange({ ...value, [key]: merged } as HistogramStyling);
  }

  // One-to-one with the Figma "Styling" tab (node 18-17275).
  return (
    <div className="hcfg-style-tab">
      {/* Wrap Into Card + card appearance */}
      <div className="hcfg-switch-row">
        <span className="LabelMediumSemibold">Wrap Into Card</span>
        <Switch
          isChecked={value.card.wrapInCard === true}
          onChange={({ isChecked }: { isChecked: boolean }) => update('card', { wrapInCard: isChecked })}
          accessibilityLabel="Wrap into card"
        />
      </div>
      <ColorInput label="Background Color" placeholder="Select color" value={value.card.backgroundColor} onChange={(v: string) => update('card', { backgroundColor: v })} />
      <ColorInput label="Border Color" placeholder="Select color" value={value.card.borderColor} onChange={(v: string) => update('card', { borderColor: v })} />
      <TextInput label="Border Width" type="number" suffix="px" value={String(value.card.borderWidth)} onChange={({ value: v }: { value: string }) => update('card', { borderWidth: num(v, 1) })} />
      <TextInput label="Border Radius" type="number" suffix="px" value={String(value.card.borderRadius)} onChange={({ value: v }: { value: string }) => update('card', { borderRadius: num(v, 4) })} />

      <Divider />

      {/* Hide Widget Element — checkboxes */}
      <p className="hcfg-style-block__title LabelMediumSemibold">Hide Widget Element</p>
      <div className="hcfg-checkbox-col">
        <Checkbox
          label="Setting Icon"
          isChecked={value.hideElements.settingsIcon}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update('hideElements', { settingsIcon: e.target.checked })}
        />
        <Checkbox
          label="Export Icon"
          isChecked={value.hideElements.exportIcon}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update('hideElements', { exportIcon: e.target.checked })}
        />
        <Checkbox
          label="Chart Title"
          isChecked={value.hideElements.chartTitle}
          onChange={(e: ChangeEvent<HTMLInputElement>) => update('hideElements', { chartTitle: e.target.checked })}
        />
      </div>

      <Divider />

      {/* Advanced Settings — reveals font / axis / grid styling */}
      <div className="hcfg-switch-row">
        <span className="LabelMediumSemibold">Advanced Settings</span>
        <Switch
          isChecked={value.advancedEnabled}
          onChange={({ isChecked }: { isChecked: boolean }) => onChange({ ...value, advancedEnabled: isChecked })}
          accessibilityLabel="Advanced settings"
        />
      </div>

      {value.advancedEnabled && (
        <>
          {/* Chart Title */}
          <p className="hcfg-style-block__title LabelMediumSemibold">Chart Title</p>
          <TextInput label="Title Font Size" type="number" value={String(value.chartTitle.fontSize)} onChange={({ value: v }: { value: string }) => update('chartTitle', { fontSize: num(v, 20) })} />
          <ColorInput label="Title Font Color" placeholder="Select color" value={value.chartTitle.fontColor} onChange={(v: string) => update('chartTitle', { fontColor: v })} />
          <StyleSelect label="Title Font Weight" value={value.chartTitle.fontWeight} options={FONT_WEIGHTS} onSelect={(v: StylingFontWeight) => update('chartTitle', { fontWeight: v })} />

          <Divider />

          {/* X Axis */}
          <p className="hcfg-style-block__title LabelMediumSemibold">X Axis</p>
          <ColorInput label="Axis Text Color" placeholder="Select color" value={value.xAxisLabel.textColor} onChange={(v: string) => update('xAxisLabel', { textColor: v })} />
          <ColorInput label="Axis Line Color" placeholder="Select color" value={value.xAxisLabel.lineColor} onChange={(v: string) => update('xAxisLabel', { lineColor: v })} />

          <Divider />

          {/* Y Axis */}
          <p className="hcfg-style-block__title LabelMediumSemibold">Y Axis</p>
          <ColorInput label="Axis Text Color" placeholder="Select color" value={value.yAxisLabel.textColor} onChange={(v: string) => update('yAxisLabel', { textColor: v })} />
          <ColorInput label="Axis Line Color" placeholder="Select color" value={value.yAxisLabel.lineColor} onChange={(v: string) => update('yAxisLabel', { lineColor: v })} />

          <Divider />

          {/* Others */}
          <p className="hcfg-style-block__title LabelMediumSemibold">Others</p>
          <ColorInput label="Grid Line Color" placeholder="Select color" value={value.misc.gridLineColor} onChange={(v: string) => update('misc', { gridLineColor: v })} />
          <ColorInput label="Legend Text Color" placeholder="Select color" value={value.misc.legendTextColor} onChange={(v: string) => update('misc', { legendTextColor: v })} />
        </>
      )}
    </div>
  );
}

// ─── Main configurator ────────────────────────────────────────────────────────

type TopTab = 'Data' | 'Time' | 'Style';

interface HistogramWidgetConfigurationProps {
  config?: HistogramEnvelope;
  authentication?: string;
  onChange: (envelope: HistogramEnvelope) => void;
  /** Host-provided back navigation (matches the other widgets' config forms). */
  onBack?: () => void;
  // Host-injectable UNS + global timepickers (all-or-none; dev harness uses fallback)
  unsTree?: UNSTree;
  isLoadingTree?: boolean;
  onLoadWorkspaces?: () => void;
  resolveUNSValue?: (rawValue: string) => string;
  globalTimepickers?: GTPGlobalTimepicker[];
}

export function HistogramWidgetConfiguration({
  config,
  authentication,
  onChange,
  onBack,
  unsTree: injectedUnsTree,
  isLoadingTree: injectedIsLoadingTree,
  onLoadWorkspaces,
  resolveUNSValue: injectedResolveUNSValue,
  globalTimepickers,
}: HistogramWidgetConfigurationProps) {
  const hasInjectedUNS =
    injectedUnsTree !== undefined && onLoadWorkspaces !== undefined && injectedResolveUNSValue !== undefined;
  const hookResult = useUNSTree(hasInjectedUNS ? undefined : authentication);
  const unsTree = hasInjectedUNS ? injectedUnsTree! : hookResult.unsTree;
  const isLoadingTree = hasInjectedUNS ? injectedIsLoadingTree ?? false : hookResult.isLoadingTree;
  const loadWorkspaces = hasInjectedUNS ? onLoadWorkspaces! : hookResult.loadWorkspaces;
  const resolveUNSValue = hasInjectedUNS ? injectedResolveUNSValue! : hookResult.resolveUNSValue;

  const [topTab, setTopTab] = useState<TopTab>('Data');
  // The persisted widget config: a list of charts + which is active + shared style.
  const [uiTop, setUiTop] = useState<HistogramUIConfig>(() => normalizeHistogramUIConfig(config?.uiConfig));
  const [timeTabConfig, setTimeTabConfig] = useState<TimeTabUIConfig | undefined>(() =>
    withDefaultDurations(config?.timeTabConfig ?? (config?.timeConfig as TimeTabUIConfig | undefined)),
  );
  const idRef = useState(() => config?._id ?? `histogram_${Date.now()}`)[0];
  // Chart Settings block state — 'view' (read-only) / 'add' / 'edit'; the drafts
  // hold the Title + Description while adding or editing.
  const [chartSelOpen, setChartSelOpen] = useState(false);
  const [chartMode, setChartMode] = useState<'view' | 'add' | 'edit'>('view');
  const [draftTitle, setDraftTitle] = useState('');
  const [draftDesc, setDraftDesc] = useState('');

  // Data Source add/edit modal (mirrors the Line Chart's side-modal editor).
  const [srcPanel, setSrcPanel] = useState<{ mode: 'add' } | { mode: 'edit'; index: number } | null>(null);
  const [editorBinding, setEditorBinding] = useState<EditorBinding | null>(null);
  const [modalAnchor, setModalAnchor] = useState<{ x: number; y: number }>({ x: 360, y: 120 });
  // All accordions start collapsed.
  const [dsExpanded, setDsExpanded] = useState(false);
  const [axisExpanded, setAxisExpanded] = useState(false);
  const [binsExpanded, setBinsExpanded] = useState(false);
  const [plotExpanded, setPlotExpanded] = useState(false);
  const [distExpanded, setDistExpanded] = useState(false);
  // Axis popup: 'add'/'edit' = add or edit an axis, 'editLeft' = rename default Y axis.
  const [axisPanel, setAxisPanel] = useState<'add' | 'edit' | 'editLeft' | null>(null);
  const [axisEditorBinding, setAxisEditorBinding] = useState<EditorBinding | null>(null);
  const [editingAxisId, setEditingAxisId] = useState<string | null>(null);
  const [leftNameDraft, setLeftNameDraft] = useState('');
  // Plot Line / Distribution Line popups: null closed, 'add', or edit index.
  const [plotPanel, setPlotPanel] = useState<'add' | number | null>(null);
  const [plotEditorBinding, setPlotEditorBinding] = useState<EditorBinding | null>(null);
  const [distPanel, setDistPanel] = useState<'add' | number | null>(null);
  const [distEditorBinding, setDistEditorBinding] = useState<EditorBinding | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Position a side popup beside the config panel, vertically aligned with the
  // button that opened it (from the click event); clamp so it's always fully
  // on-screen (the host embed can push a fixed-position modal off-view otherwise).
  const computeModalAnchor = (e?: React.MouseEvent | React.KeyboardEvent) => {
    const panelEl = (rootRef.current?.closest('.hcfg') as HTMLElement | null) ?? rootRef.current;
    const pr = panelEl?.getBoundingClientRect();
    const MODAL_W = 320;
    // Reserve enough height for the TALLEST state a popup can reach — the plot/dist
    // line editors grow when their Style accordion is expanded. The SDK Modal
    // clamps its own top ONCE (on open, using the collapsed height) and never
    // re-clamps on growth, so anchoring high enough here is what keeps the footer
    // (Save/Add) on-screen after the accordion opens.
    const MODAL_H = 600;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    // X — just to the right of the config panel.
    const desiredX = (pr?.right ?? 340) + 12;
    const x = Math.max(12, Math.min(desiredX, vw - MODAL_W - 12));
    // Y — align with the clicked button; clamp so the modal stays on-screen.
    const btn = (e?.currentTarget as HTMLElement | null)?.getBoundingClientRect?.();
    const desiredY = btn?.top ?? pr?.top ?? 72;
    const y = Math.max(12, Math.min(desiredY, Math.max(12, vh - MODAL_H - 12)));
    return { x, y };
  };

  // Only one side popup open at a time — opening one closes the others.
  const closeAllPanels = () => {
    setSrcPanel(null);
    setEditorBinding(null);
    setAxisPanel(null);
    setEditingAxisId(null);
    setPlotPanel(null);
    setDistPanel(null);
  };

  const openSrcPanel = (
    panel: { mode: 'add' } | { mode: 'edit'; index: number },
    e?: React.MouseEvent | React.KeyboardEvent,
  ) => {
    closeAllPanels();
    setModalAnchor(computeModalAnchor(e));
    setEditorBinding(null);
    setSrcPanel(panel);
  };
  const closeSrcPanel = () => {
    setSrcPanel(null);
    setEditorBinding(null);
  };

  // The SDK TimeTabConfiguration's Add Shift / Add Duration popups close on a
  // document `mousedown` whose target isn't inside `.fds-ttc__panel-modal`. Its
  // own SelectInput/dropdown popovers portal to <body> (outside that modal), so
  // picking a dropdown value inside the popup was closing it. This guard runs on
  // document mousedown BEFORE the SDK's handler (registered here at config-mount,
  // ahead of the TTC which mounts when the Time tab opens) and, when the click is
  // inside a dropdown popover, stops the SDK's outside-click close from firing.
  // Selection is onClick (unaffected); the option's own mousedown already ran at
  // the target level before this document-phase handler.
  useEffect(() => {
    const POPOVER_SEL =
      '.fds-select-input__popover, .fds-color-input__popover, .fds-uns-path-input__popover, .fds-dropdown-menu, .fds-tz-dropdown, .fds-ttc__tz-dropdown';
    const guard = (e: MouseEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && typeof t.closest === 'function' && t.closest(POPOVER_SEL)) {
        e.stopImmediatePropagation();
      }
    };
    document.addEventListener('mousedown', guard);
    return () => document.removeEventListener('mousedown', guard);
  }, []);

  // Resync when an existing envelope is loaded.
  useEffect(() => {
    if (config) {
      setUiTop(normalizeHistogramUIConfig(config.uiConfig));
      setTimeTabConfig(withDefaultDurations(config.timeTabConfig ?? (config.timeConfig as TimeTabUIConfig | undefined)));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?._id]);

  function emit(nextUi: HistogramUIConfig, nextTime: TimeTabUIConfig | undefined) {
    // The host's executeQuery reads `timeTabConfig || timeConfig` — timeTabConfig
    // WINS, so it must be host-safe too (non-null cycleTime, resolved durations).
    const tc = hostSafeTimeTab(nextTime ?? FALLBACK_TIME_CONFIG);
    const active = nextUi.charts.find((c) => c._id === nextUi.activeChartId) ?? nextUi.charts[0];
    const envelope: HistogramEnvelope = {
      _id: idRef,
      type: 'HistogramWidget',
      // No separate Widget Title field — the active chart's title names the widget.
      general: { title: active?.chartTitle || 'Histogram' },
      timeConfig: toHostTimeConfig(tc),
      timeTabConfig: tc,
      uiConfig: nextUi,
      dynamicBindingPathList: buildDynamicBindingPathList(nextUi),
    };
    console.log('[HistogramWidgetConfiguration] envelope', envelope);
    onChange(envelope);
  }

  // ── Charts list — the widget renders the ACTIVE chart; only `style` is shared.
  // A fresh widget has NO charts yet (Figma stage 1); `activeChart` is then
  // undefined and the data accordions stay hidden until the first chart is added.
  const charts = uiTop.charts ?? [];
  const hasCharts = charts.length > 0;
  const activeChart = charts.find((c) => c._id === uiTop.activeChartId) ?? charts[0];
  // Flattened view so every existing accordion keeps reading per-chart fields off
  // `ui` (active chart's fields) + the shared `ui.style`. Falls back to a blank
  // chart when there are none so reads never throw.
  const activeChartSafe: HistogramChart = activeChart ?? { ...DEFAULT_CHART, _id: '' };
  const ui = { ...activeChartSafe, style: uiTop.style, charts, activeChartId: uiTop.activeChartId };

  // `style`/`charts`/`activeChartId` patch the widget; every other key patches the
  // ACTIVE chart — so all the accordions' patchUi(...) calls just work.
  const TOP_KEYS = new Set(['style', 'charts', 'activeChartId']);
  const patchUi = (patch: Partial<HistogramUIConfig> & Partial<HistogramChart>) => {
    const topPatch: Record<string, unknown> = {};
    const chartPatch: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(patch)) {
      (TOP_KEYS.has(k) ? topPatch : chartPatch)[k] = v;
    }
    const activeId = activeChart?._id;
    const nextCharts = Object.keys(chartPatch).length && activeId
      ? charts.map((c) => (c._id === activeId ? { ...c, ...chartPatch } : c))
      : charts;
    const next: HistogramUIConfig = { ...uiTop, ...topPatch, charts: nextCharts };
    setUiTop(next);
    emit(next, timeTabConfig);
  };

  // Chart Settings block (Figma "CHART SETTINGS STATE"): Title + Description are
  // read-only in 'view'; clicking Add(+)/Edit(✎) drafts a new/existing chart, then
  // Save/Add Chart commits. When >1 chart, the Title field becomes a chart dropdown.
  // With NO charts yet, the block is forced into 'add' (stage 1).
  const chartUiMode: 'view' | 'add' | 'edit' = hasCharts ? chartMode : 'add';
  const isEditingChart = chartUiMode !== 'view';
  const selectChart = (id: string) => {
    const next: HistogramUIConfig = { ...uiTop, charts, activeChartId: id };
    setUiTop(next);
    emit(next, timeTabConfig);
  };
  const startAddChart = () => {
    setDraftTitle('');
    setDraftDesc('');
    setChartMode('add');
  };
  const startEditChart = () => {
    setDraftTitle(activeChartSafe.chartTitle || '');
    setDraftDesc(activeChartSafe.description ?? '');
    setChartMode('edit');
  };
  const cancelChartEdit = () => setChartMode('view');
  const commitAddChart = () => {
    if (!draftTitle.trim()) return;
    const c: HistogramChart = {
      ...newHistogramChart(charts.length),
      chartTitle: draftTitle.trim(),
      description: draftDesc.trim() || undefined,
    };
    const next: HistogramUIConfig = { ...uiTop, charts: [...charts, c], activeChartId: c._id };
    setUiTop(next);
    emit(next, timeTabConfig);
    setChartMode('view');
  };
  const commitEditChart = () => {
    if (!draftTitle.trim()) return;
    patchUi({ chartTitle: draftTitle.trim(), description: draftDesc.trim() || undefined });
    setChartMode('view');
  };
  const deleteChart = (id: string) => {
    // Deleting the last chart returns to the empty stage-1 state.
    const remaining = charts.filter((c) => c._id !== id);
    const next: HistogramUIConfig = { ...uiTop, charts: remaining, activeChartId: remaining[0]?._id ?? null };
    setUiTop(next);
    emit(next, timeTabConfig);
    setChartMode('view');
  };
  // ── Axis (a default Y axis always exists; user adds single-source axes) ──
  const axes = ui.axes ?? [];
  const defaultAxisName = ui.leftAxisName || 'Y Axis';
  const editingAxis = axes.find((a) => a._id === editingAxisId) ?? null;
  const sourceName = (id: string) => ui.dataSources.find((s) => s._id === id)?.name || 'Data Source';
  const submitAxis = (axis: { name: string; dataSourceId: string; side: 'left' | 'right' }) => {
    if (axisPanel === 'edit' && editingAxisId) {
      patchUi({ axes: axes.map((a) => (a._id === editingAxisId ? { ...a, ...axis } : a)) });
    } else {
      patchUi({ axes: [...axes, { _id: `axis_${Date.now()}`, ...axis }] });
    }
    setAxisPanel(null);
    setAxisEditorBinding(null);
    setEditingAxisId(null);
  };
  const deleteAxis = (id: string) => patchUi({ axes: axes.filter((a) => a._id !== id) });
  const openAddAxis = (e?: React.MouseEvent | React.KeyboardEvent) => { closeAllPanels(); setModalAnchor(computeModalAnchor(e)); setAxisEditorBinding(null); setEditingAxisId(null); setAxisPanel('add'); };
  const openEditAxis = (id: string, e?: React.MouseEvent | React.KeyboardEvent) => { closeAllPanels(); setModalAnchor(computeModalAnchor(e)); setAxisEditorBinding(null); setEditingAxisId(id); setAxisPanel('edit'); };
  const openEditLeftAxis = (e?: React.MouseEvent | React.KeyboardEvent) => { closeAllPanels(); setLeftNameDraft(defaultAxisName); setModalAnchor(computeModalAnchor(e)); setAxisPanel('editLeft'); };

  // ── Plot Line / Distribution Line (list + popup) ──
  const plotLines = ui.plotLines ?? [];
  const distributionLines = ui.distributionLines ?? [];
  const openPlotPanel = (p: 'add' | number, e?: React.MouseEvent | React.KeyboardEvent) => { closeAllPanels(); setModalAnchor(computeModalAnchor(e)); setPlotEditorBinding(null); setPlotPanel(p); };
  const submitPlotLine = (pl: Omit<HistogramPlotLine, '_id'>) => {
    const list = typeof plotPanel === 'number'
      ? plotLines.map((p, i) => (i === plotPanel ? { ...p, ...pl } : p))
      : [...plotLines, { _id: `pl_${Date.now()}`, ...pl }];
    patchUi({ plotLines: list, showPlotLines: true });
    setPlotPanel(null);
    setPlotEditorBinding(null);
  };
  const deletePlotLine = (id: string) => patchUi({ plotLines: plotLines.filter((p) => p._id !== id) });
  const openDistPanel = (p: 'add' | number, e?: React.MouseEvent | React.KeyboardEvent) => { closeAllPanels(); setModalAnchor(computeModalAnchor(e)); setDistEditorBinding(null); setDistPanel(p); };
  const submitDistLine = (dl: Omit<HistogramDistributionLine, '_id'>) => {
    const list = typeof distPanel === 'number'
      ? distributionLines.map((d, i) => (i === distPanel ? { ...d, ...dl } : d))
      : [...distributionLines, { _id: `dl_${Date.now()}`, ...dl }];
    patchUi({ distributionLines: list, showDistributionLine: true });
    setDistPanel(null);
    setDistEditorBinding(null);
  };
  const deleteDistLine = (id: string) => patchUi({ distributionLines: distributionLines.filter((d) => d._id !== id) });

  function handleTimeConfigChange(next: TimeTabUIConfig) {
    setTimeTabConfig(next);
    emit(uiTop, next);
  }

  const totalBins = ui.bins.length;

  // ── Data tab ────────────────────────────────────────────────────────────────
  const renderDataTab = () => (
    <div className="hcfg-tab-content">
      {/* Chart Settings — Figma "CHART SETTINGS STATE" (4 stages):
          • no chart yet → empty editable fields, no icons, Add Chart hidden until a title
          • chart added (view) → disabled fields, Add(+) + Edit(✎) icons
          • edit → editable fields, red Delete icon, Cancel/Save
          • >1 chart (view) → Title becomes a dropdown to switch charts */}
      <div className="hcfg-plain-section">
        <div className="hcfg-chart-settings">
          <div className="hcfg-chart-settings__head">
            <span className="hcfg-chart-settings__title LabelMediumSemibold">Chart Settings</span>
            <div className="hcfg-ds-actions">
              {chartUiMode === 'view' && (
                <>
                  <IconAction small icon={<Plus size={16} />} label="Add chart" onClick={startAddChart} />
                  <IconAction small icon={<Edit2 size={16} />} label="Edit chart" onClick={startEditChart} />
                </>
              )}
              {chartUiMode === 'edit' && (
                <IconAction small destructive icon={<Trash2 size={16} />} label="Delete chart" onClick={() => deleteChart(activeChartSafe._id)} />
              )}
            </div>
          </div>

          {/* Title — chart dropdown when >1 chart (view); else editable/disabled field. */}
          {chartUiMode === 'view' && charts.length > 1 ? (
            <SelectInput
              label="Title"
              value={activeChartSafe.chartTitle || 'Chart'}
              isOpen={chartSelOpen}
              onClick={() => setChartSelOpen((o) => !o)}
            >
              <DropdownMenu>
                {charts.map((c) => (
                  <ActionListItem
                    key={c._id}
                    title={c.chartTitle || 'Chart'}
                    selectionType="Single"
                    isSelected={c._id === activeChartSafe._id}
                    onClick={() => { selectChart(c._id); setChartSelOpen(false); }}
                  />
                ))}
              </DropdownMenu>
            </SelectInput>
          ) : (
            <TextInput
              label="Title"
              necessityIndicator="required"
              placeholder="Enter Title"
              value={isEditingChart ? draftTitle : (activeChartSafe.chartTitle || '')}
              isDisabled={!isEditingChart}
              onChange={({ value }: { value: string }) => setDraftTitle(value)}
            />
          )}

          {/* Description — disabled unless adding/editing. */}
          <TextInput
            label="Description"
            placeholder="Enter description"
            value={isEditingChart ? draftDesc : (activeChartSafe.description ?? '')}
            isDisabled={!isEditingChart}
            onChange={({ value }: { value: string }) => setDraftDesc(value)}
          />

          {/* Cancel / Save|Add Chart — Add Chart stays hidden until a title is entered (stage 1). */}
          {isEditingChart && (chartUiMode === 'edit' || draftTitle.trim().length > 0) && (
            <div className="hcfg-chart-settings__actions">
              {(chartUiMode === 'edit' || hasCharts) && (
                <Button variant="Secondary" size="Small" label="Cancel" onClick={cancelChartEdit} />
              )}
              <Button
                variant="Primary"
                size="Small"
                label={chartUiMode === 'add' ? 'Add Chart' : 'Save'}
                isDisabled={!draftTitle.trim()}
                onClick={chartUiMode === 'add' ? commitAddChart : commitEditChart}
              />
            </div>
          )}
        </div>
      </div>

      {/* The data accordions are always shown, but stay DISABLED (can't open, no Add
          controls) until the first chart is added — the Chart Settings block above
          is the only interactive part of stage 1. */}
      <>
      <ProductAccordionItem
        title="Data Sources"
        isDisabled={!hasCharts}
        trailingIcon={
          ui.dataSources.length > 0 ? (
            <span className="hcfg-ds-count BodyXSmallMedium">{ui.dataSources.length}</span>
          ) : undefined
        }
        // Only expandable once a data source exists; the Add (+) below still adds
        // the first one while collapsed.
        isExpanded={ui.dataSources.length > 0 && dsExpanded}
        onToggle={() => { if (ui.dataSources.length > 0) setDsExpanded((v) => !v); }}
        headerAction={
          // A histogram supports a single data source (for now) — only offer Add
          // while none exists (and never before a chart is added).
          hasCharts && ui.dataSources.length === 0 ? (
            <IconAction
              small
              icon={<Plus size={16} />}
              label="Add data source"
              onClick={(e) => {
                if (!dsExpanded) setDsExpanded(true);
                openSrcPanel({ mode: 'add' }, e);
              }}
            />
          ) : undefined
        }
      >
        {/* Render body only when expanded — the SDK's height-animation collapse
            relies on CSS that isn't always present in the host, which left the
            body visible when "closed". Conditional rendering makes it reliable. */}
        {ui.dataSources.length > 0 && dsExpanded && (
          <div className="hcfg-accordion-body">
            {/* Chart-level line-chart toggle (moved out of the Add Data Source
                popup) — sits above the data source list. */}
            <div className="hcfg-switch-row">
              <span className="BodySmallRegular">Enable Data Source Line Chart</span>
              <Switch
                isChecked={!!ui.showLineChart}
                onChange={({ isChecked }: { isChecked: boolean }) => patchUi({ showLineChart: isChecked })}
                accessibilityLabel="Enable data source line chart"
              />
            </div>
            {ui.dataSources.map((src, i) => (
              <ListCard
                key={src._id}
                title={src.name || `Data Source ${i + 1}`}
                subtitle={`${src.unsPath ? 'Bound' : 'No topic'} · precision ${src.dataPrecision}`}
                leadingItem={<span className="hcfg-ds-dot" style={{ background: src.color || '#4D79FF' }} />}
                onClick={(e: React.MouseEvent) => openSrcPanel({ mode: 'edit', index: i }, e)}
                trailingItems={
                  <div className="hcfg-ds-actions">
                    <IconAction destructive icon={<Trash2 size={14} />} label="Delete data source" onClick={() => patchUi({ dataSources: ui.dataSources.filter((_, idx) => idx !== i) })} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </ProductAccordionItem>

      {/* Axis — a default Y axis exists; add an axis by picking a data source and
          a side (Left/Right). Add is available once a data source exists. */}
      <ProductAccordionItem
        title="Axis"
        isDisabled={!hasCharts}
        trailingIcon={<span className="hcfg-ds-count BodyXSmallMedium">{1 + axes.length}</span>}
        // Axes are configured against a data source — only expandable once one exists.
        isExpanded={ui.dataSources.length > 0 && axisExpanded}
        onToggle={() => { if (ui.dataSources.length > 0) setAxisExpanded((v) => !v); }}
        headerAction={
          hasCharts && ui.dataSources.length > 0 ? (
            <IconAction
              small
              icon={<Plus size={16} />}
              label="Add axis"
              onClick={(e) => { if (!axisExpanded) setAxisExpanded(true); openAddAxis(e); }}
            />
          ) : undefined
        }
      >
        {ui.dataSources.length > 0 && axisExpanded && (
          <div className="hcfg-accordion-body">
            <p className="hcfg-axis-hint BodyXSmallRegular">
              <Info size={13} /> A default Y axis is added for you. Add an axis to plot a data source on the Left or Right.
            </p>
            <ListCard
              title={defaultAxisName}
              subtitle="Default · Left"
              onClick={(e: React.MouseEvent) => openEditLeftAxis(e)}
            />
            {axes.map((a) => (
              <ListCard
                key={a._id}
                title={a.name}
                subtitle={`${a.side === 'right' ? 'Right' : 'Left'} · ${sourceName(a.dataSourceId)}`}
                onClick={(e: React.MouseEvent) => openEditAxis(a._id, e)}
                trailingItems={
                  <div className="hcfg-ds-actions">
                    <IconAction destructive icon={<Trash2 size={14} />} label={`Delete axis ${a.name}`} onClick={() => deleteAxis(a._id)} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </ProductAccordionItem>

      {/* Bin Range — chart-level bins as inline From/To rows (Figma). */}
      <ProductAccordionItem
        title="Bin Range"
        isDisabled={!hasCharts}
        trailingIcon={
          totalBins > 0 ? <span className="hcfg-ds-count BodyXSmallMedium">{totalBins}</span> : undefined
        }
        // Bins are defined against a data source — only expandable once one exists
        // (the in-body Add Bin button then creates the individual ranges).
        isExpanded={ui.dataSources.length > 0 && binsExpanded}
        onToggle={() => { if (ui.dataSources.length > 0) setBinsExpanded((v) => !v); }}
      >
        {ui.dataSources.length > 0 && binsExpanded && (
          <div className="hcfg-accordion-body">
            <BinRows bins={ui.bins} onChange={(bins) => patchUi({ bins })} />
          </div>
        )}
      </ProductAccordionItem>

      {/* Plot Line — list + Add Plotline popup (Figma). */}
      <ProductAccordionItem
        title="Plot Line"
        isDisabled={!hasCharts}
        trailingIcon={plotLines.length > 0 ? <span className="hcfg-ds-count BodyXSmallMedium">{plotLines.length}</span> : undefined}
        // Only expandable once a plot line exists; the Add (+) adds the first one.
        isExpanded={plotLines.length > 0 && plotExpanded}
        onToggle={() => { if (plotLines.length > 0) setPlotExpanded((v) => !v); }}
        headerAction={hasCharts ? <IconAction small icon={<Plus size={16} />} label="Add plotline" onClick={(e) => { if (!plotExpanded) setPlotExpanded(true); openPlotPanel('add', e); }} /> : undefined}
      >
        {plotLines.length > 0 && plotExpanded && (
          <div className="hcfg-accordion-body">
            {plotLines.length === 0 ? (
              <p className="hcfg-field-label BodyXSmallRegular">No plot lines yet. Click + to add one.</p>
            ) : (
              plotLines.map((pl, i) => (
                <ListCard
                  key={pl._id}
                  title={pl.name || `Plotline ${i + 1}`}
                  subtitle={`Type: ${pl.valueType ?? 'Fixed'}`}
                  leadingItem={<span className="hcfg-bin-swatch" style={{ background: pl.color }} />}
                  onClick={(e: React.MouseEvent) => openPlotPanel(i, e)}
                  trailingItems={
                    <div className="hcfg-ds-actions">
                      <IconAction destructive icon={<Trash2 size={14} />} label="Delete plotline" onClick={() => deletePlotLine(pl._id)} />
                    </div>
                  }
                />
              ))
            )}
          </div>
        )}
      </ProductAccordionItem>

      {/* Distribution Line — list + popup (Figma). */}
      <ProductAccordionItem
        title="Distribution Line"
        isDisabled={!hasCharts}
        trailingIcon={distributionLines.length > 0 ? <span className="hcfg-ds-count BodyXSmallMedium">{distributionLines.length}</span> : undefined}
        // Only expandable once a distribution line exists; the Add (+) adds the first.
        isExpanded={distributionLines.length > 0 && distExpanded}
        onToggle={() => { if (distributionLines.length > 0) setDistExpanded((v) => !v); }}
        headerAction={hasCharts ? <IconAction small icon={<Plus size={16} />} label="Add distribution line" onClick={(e) => { if (!distExpanded) setDistExpanded(true); openDistPanel('add', e); }} /> : undefined}
      >
        {distributionLines.length > 0 && distExpanded && (
          <div className="hcfg-accordion-body">
            {distributionLines.length === 0 ? (
              <p className="hcfg-field-label BodyXSmallRegular">No distribution lines yet. Click + to add one.</p>
            ) : (
              distributionLines.map((dl, i) => (
                <ListCard
                  key={dl._id}
                  title={dl.name || `Line ${i + 1}`}
                  leadingItem={<span className="hcfg-bin-swatch" style={{ background: dl.color }} />}
                  onClick={(e: React.MouseEvent) => openDistPanel(i, e)}
                  trailingItems={
                    <div className="hcfg-ds-actions">
                      <IconAction destructive icon={<Trash2 size={14} />} label="Delete distribution line" onClick={() => deleteDistLine(dl._id)} />
                    </div>
                  }
                />
              ))
            )}
          </div>
        )}
      </ProductAccordionItem>
      </>
    </div>
  );

  const editing = srcPanel?.mode === 'edit' ? ui.dataSources[srcPanel.index] ?? null : null;

  return (
    <div className="hcfg" ref={rootRef}>
      <div className="hcfg-header">
        <IconButton icon={<ArrowLeft size={20} />} size="Large" accessibilityLabel="Back" onClick={() => onBack?.()} />
        <span className="hcfg-header__title LabelMediumSemibold">Histogram</span>
      </div>
      <div className="hcfg-tabs">
        <Tabs variant="Bordered" size="Medium" value={topTab} onChange={(v: string) => setTopTab(v as TopTab)} isFullWidthTabItem>
          {/* onClick is a safety net so switching works even if Tabs onChange doesn't fire */}
          <TabItem value="Data" label="Data" onClick={() => setTopTab('Data')} />
          <TabItem value="Time" label="Time" onClick={() => setTopTab('Time')} />
          <TabItem value="Style" label="Style" onClick={() => setTopTab('Style')} />
        </Tabs>
      </div>

      <div className="hcfg-body">
        {topTab === 'Data' && renderDataTab()}
        {topTab === 'Time' && (
          <div className="hcfg-time-tab">
            {/* mode="series" → hide the Shift accordion + periodicity/disable-
                periodicity options; the histogram doesn't use shift/comparison. */}
            <TimeTabConfiguration value={timeTabConfig} onChange={handleTimeConfigChange} globalTimepickers={globalTimepickers} mode="series" />
          </div>
        )}
        {topTab === 'Style' && (
          <StylingSection value={ui.style} onChange={(style) => patchUi({ style })} />
        )}
      </div>

      {srcPanel && (
        <Modal
          isOpen
          onClose={closeSrcPanel}
          positionX={modalAnchor.x}
          positionY={modalAnchor.y}
          className="hcfg-side-modal"
          header={<ModalHeader title={srcPanel.mode === 'edit' ? 'Edit Data Source' : 'Add Data Source'} onClose={closeSrcPanel} />}
          footer={
            <ModalFooter
              primaryAction={
                <Button
                  variant="Primary"
                  size="Small"
                  isFullWidth
                  label={srcPanel.mode === 'edit' ? 'Save' : 'Add Data Source'}
                  isDisabled={!editorBinding || !editorBinding.isValid}
                  onClick={() => { if (editorBinding?.isValid) editorBinding.submit(); }}
                />
              }
            />
          }
        >
          <ModalBody>
            <DataSourceEditor
              key={srcPanel.mode === 'edit' ? editing?._id ?? 'edit' : 'new'}
              initial={editing}
              existingCount={ui.dataSources.length}
              unsTree={unsTree}
              isLoadingTree={isLoadingTree}
              loadWorkspaces={loadWorkspaces}
              resolveUNSValue={resolveUNSValue}
              onSubmit={(s) => {
                if (srcPanel.mode === 'edit') {
                  patchUi({ dataSources: ui.dataSources.map((d, idx) => (idx === srcPanel.index ? s : d)) });
                } else {
                  patchUi({ dataSources: [...ui.dataSources, s] });
                }
                closeSrcPanel();
              }}
              onReady={setEditorBinding}
            />
          </ModalBody>
        </Modal>
      )}

      {(axisPanel === 'add' || axisPanel === 'edit') && (
        <Modal
          isOpen
          onClose={() => { setAxisPanel(null); setEditingAxisId(null); }}
          positionX={modalAnchor.x}
          positionY={modalAnchor.y}
          className="hcfg-side-modal"
          header={<ModalHeader title={axisPanel === 'edit' ? 'Edit Axis' : 'Add Axis'} onClose={() => { setAxisPanel(null); setEditingAxisId(null); }} />}
          footer={
            <ModalFooter
              primaryAction={
                <Button
                  variant="Primary"
                  size="Small"
                  isFullWidth
                  label={axisPanel === 'edit' ? 'Save' : 'Add Axis'}
                  isDisabled={!axisEditorBinding || !axisEditorBinding.isValid}
                  onClick={() => { if (axisEditorBinding?.isValid) axisEditorBinding.submit(); }}
                />
              }
              secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={() => { setAxisPanel(null); setEditingAxisId(null); }} />}
            />
          }
        >
          <ModalBody>
            <AxisForm
              key={editingAxisId ?? 'new'}
              initial={editingAxis}
              existingNames={[
                defaultAxisName,
                ...axes.filter((a) => a._id !== editingAxisId).map((a) => a.name),
              ]}
              availableSources={ui.dataSources}
              onSubmit={submitAxis}
              onReady={setAxisEditorBinding}
            />
          </ModalBody>
        </Modal>
      )}

      {axisPanel === 'editLeft' && (
        <Modal
          isOpen
          onClose={() => setAxisPanel(null)}
          positionX={modalAnchor.x}
          positionY={modalAnchor.y}
          className="hcfg-side-modal"
          header={<ModalHeader title="Edit Left Axis" onClose={() => setAxisPanel(null)} />}
          footer={
            <ModalFooter
              primaryAction={
                <Button
                  variant="Primary"
                  size="Small"
                  isFullWidth
                  label="Save"
                  isDisabled={leftNameDraft.trim() === ''}
                  onClick={() => { patchUi({ leftAxisName: leftNameDraft.trim() }); setAxisPanel(null); }}
                />
              }
              secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={() => setAxisPanel(null)} />}
            />
          }
        >
          <ModalBody>
            <div className="hcfg-editor">
              <TextInput
                label="Name"
                necessityIndicator="required"
                value={leftNameDraft}
                onChange={({ value }: { value: string }) => setLeftNameDraft(value)}
              />
            </div>
          </ModalBody>
        </Modal>
      )}

      {plotPanel !== null && (
        <Modal
          isOpen
          onClose={() => setPlotPanel(null)}
          positionX={modalAnchor.x}
          positionY={modalAnchor.y}
          className="hcfg-side-modal"
          header={<ModalHeader title={typeof plotPanel === 'number' ? 'Edit Plotline' : 'Add Plotline'} onClose={() => setPlotPanel(null)} />}
          footer={
            <ModalFooter
              primaryAction={
                <Button
                  variant="Primary"
                  size="Small"
                  isFullWidth
                  label={typeof plotPanel === 'number' ? 'Save' : 'Add Plotline'}
                  isDisabled={!plotEditorBinding || !plotEditorBinding.isValid}
                  onClick={() => { if (plotEditorBinding?.isValid) plotEditorBinding.submit(); }}
                />
              }
              secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={() => setPlotPanel(null)} />}
            />
          }
        >
          <ModalBody>
            <PlotLineForm
              key={typeof plotPanel === 'number' ? plotLines[plotPanel]?._id ?? 'edit' : 'new'}
              initial={typeof plotPanel === 'number' ? plotLines[plotPanel] ?? null : null}
              onSubmit={submitPlotLine}
              onReady={setPlotEditorBinding}
              unsTree={unsTree}
              isLoadingTree={isLoadingTree}
              loadWorkspaces={loadWorkspaces}
              resolveUNSValue={resolveUNSValue}
            />
          </ModalBody>
        </Modal>
      )}

      {distPanel !== null && (
        <Modal
          isOpen
          onClose={() => setDistPanel(null)}
          positionX={modalAnchor.x}
          positionY={modalAnchor.y}
          className="hcfg-side-modal"
          header={<ModalHeader title={typeof distPanel === 'number' ? 'Edit Distribution Line' : 'Add Distribution Line'} onClose={() => setDistPanel(null)} />}
          footer={
            <ModalFooter
              primaryAction={
                <Button
                  variant="Primary"
                  size="Small"
                  isFullWidth
                  label={typeof distPanel === 'number' ? 'Save' : 'Add Line'}
                  isDisabled={!distEditorBinding || !distEditorBinding.isValid}
                  onClick={() => { if (distEditorBinding?.isValid) distEditorBinding.submit(); }}
                />
              }
              secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={() => setDistPanel(null)} />}
            />
          }
        >
          <ModalBody>
            <DistributionLineForm
              key={typeof distPanel === 'number' ? distributionLines[distPanel]?._id ?? 'edit' : 'new'}
              initial={typeof distPanel === 'number' ? distributionLines[distPanel] ?? null : null}
              onSubmit={submitDistLine}
              onReady={setDistEditorBinding}
            />
          </ModalBody>
        </Modal>
      )}
    </div>
  );
}

export default HistogramWidgetConfiguration;
