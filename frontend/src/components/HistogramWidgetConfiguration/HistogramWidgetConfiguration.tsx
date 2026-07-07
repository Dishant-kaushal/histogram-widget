'use client';

import { useState, useEffect, useRef, useCallback } from 'react';
import type { ReactNode } from 'react';
import { Plus, Edit2, Trash2 } from 'react-feather';
import { UNSPathInput } from '@faclon-labs/design-sdk/UNSPathInput';
import { ColorInput } from '@faclon-labs/design-sdk/ColorPicker';
import {
  Tabs,
  TabItem,
  TextInput,
  Button,
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
import { createGroups } from '../HistogramWidget/histogram-utils';
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

/** Transform the SDK TimeTabUIConfig into the host-shape timeConfig the Lens engine reads. */
function toHostTimeConfig(t: TimeTabUIConfig): HostTimeConfig {
  const pickerType = (t.linkTimeWith ?? t.timeType ?? 'local') as 'local' | 'fixed' | 'global';
  const fd = t.fixed?.duration;
  const fixedDuration =
    pickerType === 'fixed' && fd
      ? {
          id: 'fixed' as const,
          label: fd.name || 'Fixed',
          navigation: fd.navigation ?? 'Previous',
          x: Number(fd.x) || 0,
          xPeriod: fd.xPeriod ?? 'day',
          xEvent: fd.xEvent ?? 'Now',
          y: Number(fd.y) || 0,
          yPeriod: fd.yPeriod ?? 'day',
          yEvent: fd.yEvent ?? 'Now',
        }
      : undefined;
  const cycleTime = (pickerType === 'fixed' ? t.fixed?.cycleTime : t.cycleTime) ?? null;
  return {
    timezone: t.timezone,
    type: pickerType === 'global' ? 'local' : pickerType,
    pickerType,
    cycleTime,
    startTime: null,
    endTime: null,
    fixedDuration,
    defaultDurationId: t.defaultDurationId,
    allDurations: t.allDurations ?? [],
    defaultPeriodicity:
      pickerType === 'fixed' && fd?.periodicity ? fd.periodicity.toLowerCase() : t.defaultPeriodicity,
    shifts: pickerType === 'fixed' ? t.fixed?.shifts ?? t.shifts : t.shifts,
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


// ─── Bin editor ───────────────────────────────────────────────────────────────

function BinEditor({
  bins,
  idPrefix,
  automatic,
  onChange,
}: {
  bins: Bin[];
  idPrefix: string;
  automatic: boolean;
  onChange: (bins: Bin[]) => void;
}) {
  const [genMin, setGenMin] = useState('0');
  const [genMax, setGenMax] = useState('100');
  const [genCount, setGenCount] = useState('10');

  const generate = () => {
    const groups = createGroups(num(genMin), num(genMax), Math.floor(num(genCount)));
    if (groups.length === 0) return;
    onChange(groups.map(([start, end]) => ({ start, end, binName: '-', color: DEFAULT_BIN_COLOR })));
  };

  const updateBin = (i: number, patch: Partial<Bin>) =>
    onChange(bins.map((b, idx) => (idx === i ? { ...b, ...patch } : b)));

  return (
    <div className="hcfg-entry">
      {automatic && (
        <>
          <span className="hcfg-field-label BodyXSmallMedium">Automatic bin width — from range</span>
          <div className="hcfg-bin-generator">
            <TextInput label="Min" name={`${idPrefix}-min`} value={genMin} onChange={({ value }: { value: string }) => setGenMin(value)} />
            <TextInput label="Max" name={`${idPrefix}-max`} value={genMax} onChange={({ value }: { value: string }) => setGenMax(value)} />
            <TextInput label="Bins" name={`${idPrefix}-count`} value={genCount} onChange={({ value }: { value: string }) => setGenCount(value)} />
            <Button variant="Secondary" size="Small" label="Generate" onClick={generate} />
          </div>
        </>
      )}

      {bins.length > 0 && <Divider />}

      {bins.map((bin, i) => (
        <div key={i} className="hcfg-bin-item">
          <div className="hcfg-bin-item__head">
            <span className="hcfg-bin-item__num BodyXSmallRegular">Bin {i + 1}</span>
            <span className="hcfg-bin-item__swatch" style={{ backgroundColor: bin.color }} />
            <Button
              variant="Secondary"
              color="Negative"
              size="XSmall"
              label="✕"
              onClick={() => onChange(bins.filter((_, idx) => idx !== i))}
            />
          </div>
          <TextInput
            label="Name"
            name={`${idPrefix}-bin-${i}-name`}
            value={bin.binName}
            placeholder="-"
            onChange={({ value }: { value: string }) => updateBin(i, { binName: value })}
          />
          <div className="hcfg-row">
            <TextInput label="Start" name={`${idPrefix}-bin-${i}-start`} value={String(bin.start)} onChange={({ value }: { value: string }) => updateBin(i, { start: num(value) })} />
            <TextInput label="End" name={`${idPrefix}-bin-${i}-end`} value={String(bin.end)} onChange={({ value }: { value: string }) => updateBin(i, { end: num(value) })} />
          </div>
          <ColorInput label="Color" placeholder="Select color" value={bin.color} onChange={(v: string) => updateBin(i, { color: v })} />
        </div>
      ))}

      <div className="hcfg-add-row">
        <Button
          variant="Gray"
          size="Small"
          label="+ Add bin"
          onClick={() => {
            const last = bins[bins.length - 1];
            const start = last ? last.end : 0;
            onChange([...bins, { start, end: start + 10, binName: '-', color: DEFAULT_BIN_COLOR }]);
          }}
        />
      </div>
    </div>
  );
}

// ─── Data Source editor (opens in a side modal, like the Line Chart) ─────────

const DEFAULT_COLORS = ['#3b82f6', '#ef4444', '#10b981', '#f59e0b', '#8b5cf6', '#ec4899', '#14b8a6', '#f97316'];

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
  const rootRef = useRef<HTMLDivElement | null>(null);

  const openSrcPanel = (panel: { mode: 'add' } | { mode: 'edit'; index: number }) => {
    const panelEl = (rootRef.current?.closest('.hcfg') as HTMLElement | null) ?? rootRef.current;
    const r = panelEl?.getBoundingClientRect();
    const MODAL_W = 320;
    const vw = typeof window !== 'undefined' ? window.innerWidth : 1200;
    const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
    // Prefer beside the config panel; clamp so the modal is always fully on-screen
    // (in the host's narrow embed the panel's right edge can be near the viewport
    // edge, which would push a fixed-position modal out of view = "popup not showing").
    const desiredX = (r?.right ?? 340) + 16;
    const x = Math.max(12, Math.min(desiredX, vw - MODAL_W - 12));
    const y = Math.max(12, Math.min(r?.top ?? 72, vh - 540));
    setModalAnchor({ x, y });
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
    const tc = nextTime ?? FALLBACK_TIME_CONFIG;
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

  function handleTimeConfigChange(next: TimeTabUIConfig) {
    setTimeTabConfig(next);
    emit(ui, next);
  }

  const [aggOpen, setAggOpen] = useState(false);

  // ── Data tab ────────────────────────────────────────────────────────────────
  const renderDataTab = () => (
    <div className="hcfg-tab-content">
      {/* Chart settings — plain section (not an accordion) */}
      <div className="hcfg-plain-section">
        <TextInput label="Chart Title" name="hcfg-chart-title" value={ui.chartTitle} placeholder="Histogram" onChange={({ value }: { value: string }) => patchUi({ chartTitle: value })} />
        <TextInput label="Chart Label" name="hcfg-chart-label" value={ui.chartLabel} placeholder="Parameter" onChange={({ value }: { value: string }) => patchUi({ chartLabel: value })} />

        <SelectInput
          label="Aggregation"
          name="hcfg-agg"
          value={ui.aggregationMode === 'daily' ? 'Daily (grouped by weekday)' : 'Cumulative'}
          isOpen={aggOpen}
          onClick={() => setAggOpen((o) => !o)}
        >
          <DropdownMenu>
            <ActionListItem
              title="Cumulative"
              description="One histogram over the whole time range"
              selectionType="Single"
              isSelected={ui.aggregationMode === 'cumulative'}
              onClick={() => { patchUi({ aggregationMode: 'cumulative' }); setAggOpen(false); }}
            />
            <ActionListItem
              title="Daily (grouped by weekday)"
              description="One column group per day — use a 1-week range"
              selectionType="Single"
              isSelected={ui.aggregationMode === 'daily'}
              onClick={() => { patchUi({ aggregationMode: 'daily' }); setAggOpen(false); }}
            />
          </DropdownMenu>
        </SelectInput>

        <div className="hcfg-switch-row">
          <span className="BodySmallRegular">Include Start &amp; End</span>
          <Switch name="hcfg-include-se" isChecked={ui.includeStartEnd} onChange={({ isChecked }: { isChecked: boolean }) => patchUi({ includeStartEnd: isChecked })} accessibilityLabel="Include start and end" />
        </div>
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
        isExpanded={binsExpanded}
        onToggle={() => setBinsExpanded((v) => !v)}
      >
        {binsExpanded && (
          <div className="hcfg-accordion-body">
            {ui.dataSources.length === 0 ? (
              <p className="hcfg-field-label BodyXSmallRegular">Add a data source first, then configure its bins here.</p>
            ) : (
              ui.dataSources.map((src, i) => (
                <div key={src._id} className="hcfg-bin-source">
                  <span className="hcfg-bin-source__title BodyXSmallMedium">{src.name || `Data Source ${i + 1}`}</span>
                  <BinEditor
                    bins={src.bins}
                    idPrefix={`bins-${src._id}`}
                    automatic
                    onChange={(bins) => updateSourceBins(src._id, bins)}
                  />
                </div>
              ))
            )}
          </div>
        )}
      </ProductAccordionItem>
    </div>
  );

  const editing = srcPanel?.mode === 'edit' ? ui.dataSources[srcPanel.index] ?? null : null;

  return (
    <div className="hcfg" ref={rootRef}>
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
    </div>
  );
}

export default HistogramWidgetConfiguration;
