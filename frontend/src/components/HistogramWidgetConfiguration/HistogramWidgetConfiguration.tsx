'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Plus, Edit2, Trash2, ArrowLeft } from 'react-feather';
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
  HistogramDataSource,
  HistogramEnvelope,
  HistogramPlotLine,
  HistogramStyling,
  HistogramUIConfig,
  HostTimeConfig,
  StylingFontWeight,
  TimeTabUIConfig,
  GTPGlobalTimepicker,
} from '../../iosense-sdk/types';
import './HistogramWidgetConfiguration.css';

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_BIN_COLOR = '#85B8FF';

// Built-in duration roster — mirrors the SDK TimeTabConfiguration's presets so a
// selected id is always present in allDurations for the host to derive the window.
const FALLBACK_TIME_CONFIG: TimeTabUIConfig = {
  timezone: 'Asia/Kolkata',
  timeType: 'local',
  defaultDurationId: 'last24h',
  defaultPeriodicity: 'hourly',
  allDurations: [
    { id: 'today', label: 'Today', calendarType: 'today', isBuiltIn: true, periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'yesterday', label: 'Yesterday', calendarType: 'yesterday', isBuiltIn: true, periodicities: ['minute', 'hourly', 'daily'] },
    { id: 'last24h', label: 'Last 24 Hours', x: 24, xPeriod: 'hour', isBuiltIn: true, periodicities: ['minute', 'hourly'] },
    { id: 'last7d', label: 'Last 7 Days', x: 7, xPeriod: 'day', isBuiltIn: true, periodicities: ['hourly', 'daily'] },
    { id: 'last30d', label: 'Last 30 Days', x: 30, xPeriod: 'day', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
    { id: 'current_week', label: 'Current Week', calendarType: 'current_week', isBuiltIn: true, periodicities: ['hourly', 'daily'] },
    { id: 'previous_week', label: 'Previous Week', calendarType: 'previous_week', isBuiltIn: true, periodicities: ['hourly', 'daily'] },
    { id: 'current_month', label: 'Current Month', calendarType: 'current_month', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
    { id: 'previous_month', label: 'Previous Month', calendarType: 'previous_month', isBuiltIn: true, periodicities: ['daily', 'weekly'] },
  ] as TimeTabUIConfig['allDurations'],
};

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

const DEFAULT_UI_CONFIG: HistogramUIConfig = {
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
  style: DEFAULT_STYLING,
};

const WIDGET_SIZES: { value: 'Small' | 'Medium' | 'Large' | 'Custom'; label: string; w?: number; h?: number }[] = [
  { value: 'Small', label: 'Small — 580 × 400', w: 580, h: 400 },
  { value: 'Medium', label: 'Medium — 880 × 400', w: 880, h: 400 },
  { value: 'Large', label: 'Large — 1500 × 520', w: 1500, h: 520 },
  { value: 'Custom', label: 'Custom', w: undefined, h: undefined },
];

// Enumerated style choices (mirror the values the renderer maps).
const FONT_WEIGHTS: { value: StylingFontWeight; label: string }[] = [
  { value: 'Regular', label: 'Regular' },
  { value: 'Medium', label: 'Medium' },
  { value: 'Semi-Bold', label: 'Semi-Bold' },
  { value: 'Bold', label: 'Bold' },
];

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

/** Scan dataSources[].unsPath for {{topic}} bindings → { key, topic, type:'series' }. */
function buildDynamicBindingPathList(uiConfig: HistogramUIConfig): BindingEntry[] {
  const paths: BindingEntry[] = [];
  uiConfig.dataSources.forEach((s, i) => {
    const raw = (s.unsPath || '').trim();
    const match = VARIABLE_REGEX.exec(raw);
    if (match) paths.push({ key: `dataSources[${i}].unsPath`, topic: match[1], type: 'series' });
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

/** Also emit the DataLayer TimeConfig shape on `timeConfig` (fallback read path). */
function toHostTimeConfig(t: TimeTabUIConfig): HostTimeConfig {
  const safe = hostSafeTimeTab(t);
  const dur = (safe.allDurations ?? []).find((d) => d.id === safe.defaultDurationId) ?? safe.allDurations?.[0];
  const resolved = (dur ?? resolveHostPreset({ id: 'last24h', label: 'Last 24 Hours', x: 24, xPeriod: 'hour' } as SdkPreset)) as HostTimeConfig['defaultDuration'];
  if (!resolved.periodicities?.length) {
    resolved.periodicities = safe.defaultPeriodicity ? [safe.defaultPeriodicity] : ['hourly'];
  }
  return {
    timezone: safe.timezone,
    defaultDuration: resolved,
    cycleTime: safe.cycleTime as unknown as HostTimeConfig['cycleTime'],
    shifts: (safe.shifts as unknown[]) ?? [],
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
}: {
  icon: ReactNode;
  label: string;
  onClick: (e: React.MouseEvent | React.KeyboardEvent) => void;
  // `small` (20px) matches the SDK chevron so header actions align with it.
  small?: boolean;
}) {
  return (
    <span
      role="button"
      tabIndex={0}
      aria-label={label}
      className={`hcfg-icon-action${small ? ' hcfg-icon-action--sm' : ''}`}
      onClick={(e) => { e.stopPropagation(); onClick(e); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); e.stopPropagation(); onClick(e); }
      }}
    >
      {icon}
    </span>
  );
}


// ─── Single-bin form (opens in the Add/Edit Bin popup, like a data source) ───

function BinForm({
  sources,
  fixedSourceId,
  initial,
  onSubmit,
  onReady,
}: {
  sources: HistogramDataSource[];
  /** Set in edit mode — the bin's source is fixed (no picker). */
  fixedSourceId: string | null;
  initial: Bin | null;
  onSubmit: (sourceId: string, bin: Bin) => void;
  onReady: (b: EditorBinding) => void;
}) {
  const [sourceId, setSourceId] = useState(fixedSourceId ?? sources[0]?._id ?? '');
  const [srcOpen, setSrcOpen] = useState(false);
  const [binName, setBinName] = useState(initial && initial.binName !== '-' ? initial.binName : '');
  const [start, setStart] = useState(initial ? String(initial.start) : '0');
  const [end, setEnd] = useState(initial ? String(initial.end) : '10');
  const [color, setColor] = useState(initial?.color ?? DEFAULT_BIN_COLOR);

  const isValid = sourceId !== '' && start.trim() !== '' && end.trim() !== '' && num(end) > num(start);

  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit(sourceId, { binName: binName.trim() || '-', start: num(start), end: num(end), color });
  }, [isValid, sourceId, binName, start, end, color, onSubmit]);

  useEditorBinding(isValid, submit, onReady);

  const showSourcePicker = !fixedSourceId && sources.length > 1;

  return (
    <div className="hcfg-editor">
      {showSourcePicker && (
        <SelectInput
          label="Data Source"
          value={sources.find((s) => s._id === sourceId)?.name || 'Select data source'}
          isOpen={srcOpen}
          onClick={() => setSrcOpen((o) => !o)}
        >
          <DropdownMenu>
            {sources.map((s) => (
              <ActionListItem
                key={s._id}
                title={s.name || 'Data Source'}
                selectionType="Single"
                isSelected={sourceId === s._id}
                onClick={() => { setSourceId(s._id); setSrcOpen(false); }}
              />
            ))}
          </DropdownMenu>
        </SelectInput>
      )}
      <TextInput label="Bin Name" placeholder="Optional" value={binName} onChange={({ value }: { value: string }) => setBinName(value)} />
      <div className="hcfg-row">
        <TextInput label="Start" necessityIndicator="required" type="number" value={start} onChange={({ value }: { value: string }) => setStart(value)} />
        <TextInput label="End" necessityIndicator="required" type="number" value={end} onChange={({ value }: { value: string }) => setEnd(value)} />
      </div>
      <ColorInput label="Color" placeholder="Select color" value={color} onChange={(v: string) => setColor(v)} />
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
  const [unsPath, setUnsPath] = useState(initial?.unsPath ?? '');
  const [dataPrecision, setDataPrecision] = useState(initial ? String(initial.dataPrecision) : '2');
  const [unit, setUnit] = useState(initial?.unit ?? '');
  const [enableLineChart, setEnableLineChart] = useState(initial?.enableLineChart ?? false);
  // Bins are configured in the separate "Bins" accordion, not in this popup.
  // New sources start with none; editing preserves the source's existing bins.
  const bins = initial?.bins ?? [];

  const isValid = name.trim().length > 0 && unsPath.trim().length > 0;

  const submit = useCallback(() => {
    if (!isValid) return;
    onSubmit({
      _id: initial?._id ?? `ds_${Date.now()}_${existingCount}`,
      name: name.trim(),
      unsPath,
      dataPrecision: Math.max(0, Math.floor(num(dataPrecision, 2))),
      unit: unit.trim() || undefined,
      enableLineChart,
      automaticBinWidth: initial?.automaticBinWidth ?? true,
      bins,
    });
  }, [isValid, initial, existingCount, name, unsPath, dataPrecision, unit, enableLineChart, bins, onSubmit]);

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
      <div className="hcfg-switch-row">
        <span className="BodySmallRegular">Enable Data Source Line Chart</span>
        <Switch isChecked={enableLineChart} onChange={({ isChecked }: { isChecked: boolean }) => setEnableLineChart(isChecked)} accessibilityLabel="Enable line chart" />
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
  ui,
  onChange,
  onPatchUi,
  onPatchPlotLine,
}: {
  value: HistogramStyling;
  ui: HistogramUIConfig;
  onChange: (next: HistogramStyling) => void;
  onPatchUi: (patch: Partial<HistogramUIConfig>) => void;
  onPatchPlotLine: (i: number, patch: Partial<HistogramPlotLine>) => void;
}) {
  const [sizeOpen, setSizeOpen] = useState(false);
  const selectedSize = WIDGET_SIZES.find((s) => s.value === value.size.preset) ?? WIDGET_SIZES[1];

  function update<K extends keyof HistogramStyling>(key: K, patch: Partial<HistogramStyling[K]>) {
    const prev = value[key];
    const merged =
      prev && typeof prev === 'object' && !Array.isArray(prev)
        ? { ...(prev as object), ...(patch as object) }
        : patch;
    onChange({ ...value, [key]: merged } as HistogramStyling);
  }

  return (
    <div className="hcfg-style-tab">
      {/* Widget size + dimensions (v1 Chart Customization) */}
      <SelectInput label="Select Widget Size" value={selectedSize.label} isOpen={sizeOpen} onClick={() => setSizeOpen((o) => !o)}>
        <DropdownMenu>
          {WIDGET_SIZES.map((s) => (
            <ActionListItem
              key={s.value}
              title={s.label}
              selectionType="Single"
              isSelected={value.size.preset === s.value}
              onClick={() => {
                update('size', s.value === 'Custom' ? { preset: 'Custom' } : { preset: s.value, customWidth: s.w, customHeight: s.h });
                setSizeOpen(false);
              }}
            />
          ))}
        </DropdownMenu>
      </SelectInput>
      <div className="hcfg-row">
        <TextInput label="Width (px)" type="number" value={String(value.size.customWidth ?? '')} onChange={({ value: v }: { value: string }) => update('size', { customWidth: v === '' ? undefined : Number(v) })} />
        <TextInput label="Height (px)" type="number" value={String(value.size.customHeight ?? '')} onChange={({ value: v }: { value: string }) => update('size', { customHeight: v === '' ? undefined : Number(v) })} />
      </div>

      <Divider />

      {/* Display toggles (v1 Chart Customization) */}
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Show Plot Lines</span>
        <Switch isChecked={ui.showPlotLines} onChange={({ isChecked }: { isChecked: boolean }) => onPatchUi({ showPlotLines: isChecked })} accessibilityLabel="Show plot lines" />
      </div>
      {ui.showPlotLines && (
        <div className="hcfg-entry">
          {ui.plotLines.map((pl, i) => (
            <div key={pl._id} className="hcfg-bin-item">
              <div className="hcfg-bin-item__head">
                <span className="hcfg-bin-item__num BodyXSmallRegular">Line {i + 1}</span>
                <span className="hcfg-bin-item__swatch" style={{ backgroundColor: pl.color }} />
                <Button variant="Secondary" color="Negative" size="XSmall" label="✕" onClick={() => onPatchUi({ plotLines: ui.plotLines.filter((_, idx) => idx !== i) })} />
              </div>
              <div className="hcfg-row">
                <TextInput label="Value" value={String(pl.value)} onChange={({ value: v }: { value: string }) => onPatchPlotLine(i, { value: num(v) })} />
                <TextInput label="Width" value={String(pl.lineWidth)} onChange={({ value: v }: { value: string }) => onPatchPlotLine(i, { lineWidth: num(v, 2) })} />
              </div>
              <TextInput label="Label" value={pl.name} onChange={({ value: v }: { value: string }) => onPatchPlotLine(i, { name: v })} />
              <ColorInput label="Color" placeholder="Select color" value={pl.color} onChange={(v: string) => onPatchPlotLine(i, { color: v })} />
            </div>
          ))}
          <div className="hcfg-add-row">
            <Button variant="Gray" size="Small" label="+ Add plot line" onClick={() => onPatchUi({ plotLines: [...ui.plotLines, { _id: `pl_${Date.now()}`, name: '', color: '#FF0000', value: 0, lineWidth: 2, dashStyle: 'Solid' }] })} />
          </div>
        </div>
      )}
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Show Bin Ranges</span>
        <Switch isChecked={ui.showBinRanges} onChange={({ isChecked }: { isChecked: boolean }) => onPatchUi({ showBinRanges: isChecked })} accessibilityLabel="Show bin ranges" />
      </div>
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Show Distribution Line</span>
        <Switch isChecked={ui.showDistributionLine} onChange={({ isChecked }: { isChecked: boolean }) => onPatchUi({ showDistributionLine: isChecked })} accessibilityLabel="Show distribution line" />
      </div>
      {ui.showDistributionLine && (
        <div className="hcfg-entry">
          <ColorInput label="Distribution Line Color" placeholder="Select color" value={value.distribution.color} onChange={(v: string) => update('distribution', { color: v })} />
          <div className="hcfg-row">
            <TextInput label="Line Width" type="number" value={String(value.distribution.width)} onChange={({ value: v }: { value: string }) => update('distribution', { width: num(v, 3) })} />
            <StyleSelect label="Dash Style" value={value.distribution.dashStyle} options={DASH_STYLES} onSelect={(v) => update('distribution', { dashStyle: v })} />
          </div>
        </div>
      )}

      <Divider />

      {/* Chart title styling (v1 Chart Customization) */}
      <p className="hcfg-style-block__title LabelMediumSemibold">Chart Title</p>
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Hide Chart Title</span>
        <Switch isChecked={value.hideElements.chartTitle} onChange={({ isChecked }: { isChecked: boolean }) => update('hideElements', { chartTitle: isChecked })} accessibilityLabel="Hide chart title" />
      </div>
      {!value.hideElements.chartTitle && (
        <div className="hcfg-entry">
          <div className="hcfg-row">
            <TextInput label="Font Size (px)" type="number" value={String(value.chartTitle.fontSize)} onChange={({ value: v }: { value: string }) => update('chartTitle', { fontSize: num(v, 18) })} />
            <StyleSelect label="Font Weight" value={value.chartTitle.fontWeight} options={FONT_WEIGHTS} onSelect={(v: StylingFontWeight) => update('chartTitle', { fontWeight: v })} />
          </div>
          <ColorInput label="Font Color" placeholder="Select color" value={value.chartTitle.fontColor} onChange={(v: string) => update('chartTitle', { fontColor: v })} />
        </div>
      )}

      <Divider />

      {/* Axis & grid styling */}
      <p className="hcfg-style-block__title LabelMediumSemibold">Axes &amp; Grid</p>
      <div className="hcfg-entry">
        <div className="hcfg-row">
          <ColorInput label="X Label Color" placeholder="Select color" value={value.xAxisLabel.textColor} onChange={(v: string) => update('xAxisLabel', { textColor: v })} />
          <ColorInput label="X Axis Line" placeholder="Select color" value={value.xAxisLabel.lineColor} onChange={(v: string) => update('xAxisLabel', { lineColor: v })} />
        </div>
        <div className="hcfg-row">
          <ColorInput label="Y Label Color" placeholder="Select color" value={value.yAxisLabel.textColor} onChange={(v: string) => update('yAxisLabel', { textColor: v })} />
          <ColorInput label="Grid Line Color" placeholder="Select color" value={value.misc.gridLineColor} onChange={(v: string) => update('misc', { gridLineColor: v })} />
        </div>
        <ColorInput label="Legend Text Color" placeholder="Select color" value={value.misc.legendTextColor} onChange={(v: string) => update('misc', { legendTextColor: v })} />
      </div>

      <Divider />

      {/* Data labels (frequency count drawn inside each bar) */}
      <p className="hcfg-style-block__title LabelMediumSemibold">Data Labels</p>
      <div className="hcfg-row">
        <ColorInput label="Label Color" placeholder="Select color" value={value.dataLabels.color} onChange={(v: string) => update('dataLabels', { color: v })} />
        <TextInput label="Font Size (px)" type="number" value={String(value.dataLabels.fontSize)} onChange={({ value: v }: { value: string }) => update('dataLabels', { fontSize: num(v, 11) })} />
      </div>

      <Divider />

      {/* Card + toolbar visibility */}
      <p className="hcfg-style-block__title LabelMediumSemibold">Card &amp; Toolbar</p>
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Hide Export Icon</span>
        <Switch isChecked={value.hideElements.exportIcon} onChange={({ isChecked }: { isChecked: boolean }) => update('hideElements', { exportIcon: isChecked })} accessibilityLabel="Hide export icon" />
      </div>
      <div className="hcfg-switch-row">
        <span className="LabelMediumRegular">Wrap Into Card</span>
        <Switch
          isChecked={value.card.wrapInCard === true}
          onChange={({ isChecked }: { isChecked: boolean }) => update('card', { wrapInCard: isChecked })}
          accessibilityLabel="Wrap into card"
        />
      </div>
      {value.card.wrapInCard && (
        <div className="hcfg-entry">
          <div className="hcfg-row">
            <ColorInput label="Background" placeholder="Select color" value={value.card.backgroundColor} onChange={(v: string) => update('card', { backgroundColor: v })} />
            <ColorInput label="Border Color" placeholder="Select color" value={value.card.borderColor} onChange={(v: string) => update('card', { borderColor: v })} />
          </div>
          <div className="hcfg-row">
            <TextInput label="Border Width (px)" type="number" value={String(value.card.borderWidth)} onChange={({ value: v }: { value: string }) => update('card', { borderWidth: num(v, 1) })} />
            <TextInput label="Border Radius (px)" type="number" value={String(value.card.borderRadius)} onChange={({ value: v }: { value: string }) => update('card', { borderRadius: num(v, 8) })} />
          </div>
        </div>
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
  const [ui, setUi] = useState<HistogramUIConfig>({ ...DEFAULT_UI_CONFIG, ...(config?.uiConfig ?? {}) });
  const [timeTabConfig, setTimeTabConfig] = useState<TimeTabUIConfig | undefined>(
    config?.timeTabConfig ?? (config?.timeConfig as TimeTabUIConfig | undefined),
  );
  const idRef = useState(() => config?._id ?? `histogram_${Date.now()}`)[0];

  // Data Source add/edit modal (mirrors the Line Chart's side-modal editor).
  const [srcPanel, setSrcPanel] = useState<{ mode: 'add' } | { mode: 'edit'; index: number } | null>(null);
  const [editorBinding, setEditorBinding] = useState<EditorBinding | null>(null);
  const [modalAnchor, setModalAnchor] = useState<{ x: number; y: number }>({ x: 360, y: 120 });
  const [dsExpanded, setDsExpanded] = useState(true);
  const [binsExpanded, setBinsExpanded] = useState(true);
  // Bin add/edit popup. `binIndex` null = add (source chosen in the popup),
  // number = edit that bin (source fixed). `sourceId` null on header + add.
  const [binPanel, setBinPanel] = useState<{ sourceId: string | null; binIndex: number | null } | null>(null);
  const [binEditorBinding, setBinEditorBinding] = useState<EditorBinding | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // Position a side popup beside the config panel; clamp so it's always fully
  // on-screen (the host embed can push a fixed-position modal off-view otherwise).
  const computeModalAnchor = () => {
    const panelEl = (rootRef.current?.closest('.hcfg') as HTMLElement | null) ?? rootRef.current;
    const r = panelEl?.getBoundingClientRect();
    const MODAL_W = 320;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    const desiredX = (r?.right ?? 340) + 16;
    const x = Math.max(12, Math.min(desiredX, vw - MODAL_W - 12));
    const y = Math.max(12, Math.min(r?.top ?? 72, vh - 540));
    return { x, y };
  };

  const openSrcPanel = (panel: { mode: 'add' } | { mode: 'edit'; index: number }) => {
    setModalAnchor(computeModalAnchor());
    setEditorBinding(null);
    setSrcPanel(panel);
  };
  const closeSrcPanel = () => {
    setSrcPanel(null);
    setEditorBinding(null);
  };

  // Resync when an existing envelope is loaded.
  useEffect(() => {
    if (config) {
      setUi({ ...DEFAULT_UI_CONFIG, ...config.uiConfig });
      setTimeTabConfig(config.timeTabConfig ?? (config.timeConfig as TimeTabUIConfig | undefined));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config?._id]);

  function emit(nextUi: HistogramUIConfig, nextTime: TimeTabUIConfig | undefined) {
    // The host's executeQuery reads `timeTabConfig || timeConfig` — timeTabConfig
    // WINS, so it must be host-safe too (non-null cycleTime, resolved durations).
    const tc = hostSafeTimeTab(nextTime ?? FALLBACK_TIME_CONFIG);
    const envelope: HistogramEnvelope = {
      _id: idRef,
      type: 'HistogramWidget',
      // No separate Widget Title field — the chart title names the widget.
      general: { title: nextUi.chartTitle || 'Histogram' },
      timeConfig: toHostTimeConfig(tc),
      timeTabConfig: tc,
      uiConfig: nextUi,
      dynamicBindingPathList: buildDynamicBindingPathList(nextUi),
    };
    console.log('[HistogramWidgetConfiguration] envelope', envelope);
    onChange(envelope);
  }

  const patchUi = (patch: Partial<HistogramUIConfig>) => {
    const next = { ...ui, ...patch };
    setUi(next);
    emit(next, timeTabConfig);
  };
  const patchPlotLine = (i: number, patch: Partial<HistogramPlotLine>) =>
    patchUi({ plotLines: ui.plotLines.map((p, idx) => (idx === i ? { ...p, ...patch } : p)) });
  const updateSourceBins = (id: string, bins: Bin[]) =>
    patchUi({ dataSources: ui.dataSources.map((s) => (s._id === id ? { ...s, bins } : s)) });

  // ── Bin popup handlers ──
  const openBinPanel = (sourceId: string | null, binIndex: number | null) => {
    setModalAnchor(computeModalAnchor());
    setBinEditorBinding(null);
    setBinPanel({ sourceId, binIndex });
  };
  const closeBinPanel = () => {
    setBinPanel(null);
    setBinEditorBinding(null);
  };
  const submitBin = (sourceId: string, bin: Bin) => {
    if (!binPanel) return;
    const src = ui.dataSources.find((s) => s._id === sourceId);
    if (!src) return;
    const nextBins =
      binPanel.binIndex == null
        ? [...src.bins, bin]
        : src.bins.map((b, i) => (i === binPanel.binIndex ? bin : b));
    updateSourceBins(sourceId, nextBins);
    closeBinPanel();
  };
  const deleteBin = (sourceId: string, binIndex: number) => {
    const src = ui.dataSources.find((s) => s._id === sourceId);
    if (!src) return;
    updateSourceBins(sourceId, src.bins.filter((_, i) => i !== binIndex));
  };

  function handleTimeConfigChange(next: TimeTabUIConfig) {
    setTimeTabConfig(next);
    emit(ui, next);
  }

  const totalBins = ui.dataSources.reduce((n, s) => n + s.bins.length, 0);

  // ── Data tab ────────────────────────────────────────────────────────────────
  const renderDataTab = () => (
    <div className="hcfg-tab-content">
      {/* Chart settings — plain section (title + description only, like the
          Column Chart widget's chart-information section). */}
      <div className="hcfg-plain-section">
        <TextInput label="Chart Title" name="hcfg-chart-title" value={ui.chartTitle} placeholder="Histogram" onChange={({ value }: { value: string }) => patchUi({ chartTitle: value })} />
        <TextInput label="Chart Description" name="hcfg-chart-desc" value={ui.description ?? ''} placeholder="Shown on the widget's info icon" onChange={({ value }: { value: string }) => patchUi({ description: value })} />
      </div>

      <ProductAccordionItem
        title="Data Sources"
        trailingIcon={
          ui.dataSources.length > 0 ? (
            <span className="hcfg-ds-count BodyXSmallMedium">{ui.dataSources.length}</span>
          ) : undefined
        }
        isExpanded={dsExpanded}
        onToggle={() => setDsExpanded((v) => !v)}
        headerAction={
          <IconAction
            small
            icon={<Plus size={16} />}
            label="Add data source"
            onClick={() => {
              if (!dsExpanded) setDsExpanded(true);
              openSrcPanel({ mode: 'add' });
            }}
          />
        }
      >
        {/* Render body only when expanded — the SDK's height-animation collapse
            relies on CSS that isn't always present in the host, which left the
            body visible when "closed". Conditional rendering makes it reliable. */}
        {dsExpanded && (
          <div className="hcfg-accordion-body">
            {ui.dataSources.length === 0 && (
              <p className="hcfg-field-label BodyXSmallRegular">No data source yet. Click + to add one and bind it to a UNS topic.</p>
            )}
            {ui.dataSources.map((src, i) => (
              <ListCard
                key={src._id}
                title={src.name || `Data Source ${i + 1}`}
                subtitle={`${src.bins.length} bin${src.bins.length === 1 ? '' : 's'} · precision ${src.dataPrecision}`}
                leadingItem={<span className="hcfg-ds-dot" />}
                trailingItems={
                  <div className="hcfg-ds-actions">
                    <IconAction icon={<Edit2 size={14} />} label="Edit data source" onClick={() => openSrcPanel({ mode: 'edit', index: i })} />
                    <IconAction icon={<Trash2 size={14} />} label="Delete data source" onClick={() => patchUi({ dataSources: ui.dataSources.filter((_, idx) => idx !== i) })} />
                  </div>
                }
              />
            ))}
          </div>
        )}
      </ProductAccordionItem>

      {/* Bins — separate accordion so the data-source popup stays uncluttered.
          Bins remain per-source; each source gets its own bin editor here. */}
      <ProductAccordionItem
        title="Bins"
        trailingIcon={
          totalBins > 0 ? <span className="hcfg-ds-count BodyXSmallMedium">{totalBins}</span> : undefined
        }
        isExpanded={binsExpanded}
        onToggle={() => setBinsExpanded((v) => !v)}
        headerAction={
          ui.dataSources.length > 0 ? (
            <IconAction
              small
              icon={<Plus size={16} />}
              label="Add bin"
              onClick={() => {
                if (!binsExpanded) setBinsExpanded(true);
                openBinPanel(null, null);
              }}
            />
          ) : undefined
        }
      >
        {/* Body is a list only — adding/editing happens in the popup (header +). */}
        {binsExpanded && (
          <div className="hcfg-accordion-body">
            {ui.dataSources.length === 0 ? (
              <p className="hcfg-field-label BodyXSmallRegular">Add a data source first, then add bins with the + above.</p>
            ) : totalBins === 0 ? (
              <p className="hcfg-field-label BodyXSmallRegular">No bins yet. Click + to add one.</p>
            ) : (
              <div className="hcfg-bin-list">
                {ui.dataSources.flatMap((src) =>
                  src.bins.map((bin, bi) => (
                    <ListCard
                      key={`${src._id}-${bi}`}
                      title={bin.binName && bin.binName !== '-' ? bin.binName : `Bin ${bi + 1}`}
                      subtitle={`${bin.start} – ${bin.end}${ui.dataSources.length > 1 ? ` · ${src.name || 'Source'}` : ''}`}
                      leadingItem={<span className="hcfg-bin-swatch" style={{ background: bin.color }} />}
                      trailingItems={
                        <div className="hcfg-ds-actions">
                          <IconAction icon={<Edit2 size={14} />} label="Edit bin" onClick={() => openBinPanel(src._id, bi)} />
                          <IconAction icon={<Trash2 size={14} />} label="Delete bin" onClick={() => deleteBin(src._id, bi)} />
                        </div>
                      }
                    />
                  )),
                )}
              </div>
            )}
          </div>
        )}
      </ProductAccordionItem>
    </div>
  );

  const editing = srcPanel?.mode === 'edit' ? ui.dataSources[srcPanel.index] ?? null : null;

  return (
    <div className="hcfg" ref={rootRef}>
      <div className="hcfg-header">
        <IconButton icon={<ArrowLeft size={16} />} size="Small" accessibilityLabel="Back" onClick={() => onBack?.()} />
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
            <TimeTabConfiguration value={timeTabConfig} onChange={handleTimeConfigChange} globalTimepickers={globalTimepickers} />
          </div>
        )}
        {topTab === 'Style' && (
          <StylingSection
            value={ui.style}
            ui={ui}
            onChange={(style) => patchUi({ style })}
            onPatchUi={patchUi}
            onPatchPlotLine={patchPlotLine}
          />
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
              secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={closeSrcPanel} />}
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

      {binPanel && (() => {
        const src = ui.dataSources.find((s) => s._id === binPanel.sourceId);
        const editingBin = binPanel.binIndex != null ? src?.bins[binPanel.binIndex] ?? null : null;
        const isEdit = binPanel.binIndex != null;
        return (
          <Modal
            isOpen
            onClose={closeBinPanel}
            positionX={modalAnchor.x}
            positionY={modalAnchor.y}
            className="hcfg-side-modal"
            header={<ModalHeader title={isEdit ? 'Edit Bin' : 'Add Bin'} onClose={closeBinPanel} />}
            footer={
              <ModalFooter
                primaryAction={
                  <Button
                    variant="Primary"
                    size="Small"
                    isFullWidth
                    label={isEdit ? 'Save' : 'Add Bin'}
                    isDisabled={!binEditorBinding || !binEditorBinding.isValid}
                    onClick={() => { if (binEditorBinding?.isValid) binEditorBinding.submit(); }}
                  />
                }
                secondaryAction={<Button variant="Secondary" size="Small" isFullWidth label="Cancel" onClick={closeBinPanel} />}
              />
            }
          >
            <ModalBody>
              <BinForm
                key={isEdit ? `${binPanel.sourceId}-${binPanel.binIndex}` : 'new'}
                sources={ui.dataSources}
                fixedSourceId={isEdit ? binPanel.sourceId : null}
                initial={editingBin}
                onSubmit={submitBin}
                onReady={setBinEditorBinding}
              />
            </ModalBody>
          </Modal>
        );
      })()}
    </div>
  );
}

export default HistogramWidgetConfiguration;
