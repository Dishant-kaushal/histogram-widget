'use client';

// Time controls above the chart — mirrors the Line Chart widget:
//   local  → DatePicker (range + presets) + periodicity dropdown
//   fixed  → read-only duration label (window set in the configurator)
//   global → read-only "linked GTP" label (a dashboard Global Time Picker drives it)
// Emits TIME_CHANGE(startTime,endTime,periodicity) so the host DataLayer refetches.

import { useEffect, useMemo, useRef, useState } from 'react';
import { Clock } from 'react-feather';
import { DatePicker } from '@faclon-labs/design-sdk/DatePicker';
import type { DateRange, DatePresetOption } from '@faclon-labs/design-sdk/DatePicker';
import { SelectInput, DropdownMenu, ActionListItem } from '@faclon-labs/design-sdk';
import type { TimeTabUIConfig, WidgetEvent } from '../../iosense-sdk/types';
import {
  computeRange,
  defaultPeriodicity,
  pickPeriodicity,
  presetPeriodicities,
  rangePeriodicities,
  timeMode,
} from './histogram-time';

interface Props {
  timeTabConfig?: TimeTabUIConfig;
  onEvent?: (e: WidgetEvent) => void;
}

/** Emit TIME_CHANGE(startTime,endTime,periodicity) so the host DataLayer refetches. */
function emitTimeChange(
  onEvent: Props['onEvent'],
  startMs: number,
  endMs: number,
  periodicity: string,
) {
  onEvent?.({
    type: 'TIME_CHANGE',
    payload: {
      startTime: String(startMs),
      endTime: String(endMs),
      periodicity: periodicity.toLowerCase(),
    },
  });
}

export function HistogramTimeBar({ timeTabConfig, onEvent }: Props) {
  const mode = timeMode(timeTabConfig);

  const initialRange = useMemo<DateRange>(() => {
    const { startTime, endTime } = computeRange(timeTabConfig);
    return { start: new Date(startTime), end: new Date(endTime) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    timeTabConfig?.defaultDurationId,
    (timeTabConfig as { linkTimeWith?: string } | undefined)?.linkTimeWith,
    // eslint-disable-next-line react-hooks/exhaustive-deps
    JSON.stringify(timeTabConfig?.allDurations ?? null),
  ]);

  const [rangeValue, setRangeValue] = useState<DateRange>(initialRange);
  const [selectedPreset, setSelectedPreset] = useState<string>(timeTabConfig?.defaultDurationId ?? 'custom');
  const [periodicity, setPeriodicity] = useState<string>(() => defaultPeriodicity(timeTabConfig));
  const [open, setOpen] = useState(false);
  const [pOpen, setPOpen] = useState(false);
  const touchedRef = useRef(false);
  const presetSelectingRef = useRef(false);

  // Re-sync when the host pushes a new default duration / mode.
  useEffect(() => {
    setRangeValue(initialRange);
  }, [initialRange]);
  useEffect(() => {
    if (timeTabConfig?.defaultDurationId) setSelectedPreset(timeTabConfig.defaultDurationId);
  }, [timeTabConfig?.defaultDurationId]);

  const activePreset = timeTabConfig?.allDurations?.find((d) => d.id === selectedPreset);
  const periodicityOptions = useMemo(
    () =>
      selectedPreset === 'custom'
        ? rangePeriodicities(rangeValue.start.getTime(), rangeValue.end.getTime())
        : presetPeriodicities(activePreset),
    [selectedPreset, activePreset, rangeValue],
  );

  // Keep periodicity valid for the current option set.
  useEffect(() => {
    if (!periodicityOptions.length) return;
    setPeriodicity((prev) => pickPeriodicity(periodicityOptions, prev, touchedRef.current));
  }, [periodicityOptions]);

  // Only local mode gets an interactive picker; fixed/global are host-driven.
  // Render a subtle clock-icon caption (not a bordered chip) — for fixed mode it
  // reads the periodicity straight off the config's Set Duration expression so it
  // stays in sync as the user edits it.
  if (mode !== 'local') {
    // Read the periodicity from the config (handles both the SDK + rich host
    // shapes) — NOT the `periodicity` state, which the range effect above rewrites
    // to fit the fixed window's span and would show e.g. "Daily" instead of the
    // "Weekly" the user picked in Set Duration.
    const fixedPeriodicity = defaultPeriodicity(timeTabConfig);
    const label = mode === 'fixed' ? `Fixed: ${fixedPeriodicity}` : 'Linked to Global Time Picker';
    return (
      <div className="histogram-widget__timebar">
        <span className="histogram-widget__fixed-time">
          <Clock size={14} />
          <span>{label}</span>
        </span>
      </div>
    );
  }

  const presets: DatePresetOption[] = [
    { value: 'custom', label: 'Custom' },
    ...(timeTabConfig?.allDurations ?? []).map((d) => ({ value: d.id ?? '', label: d.label || d.id || '' })),
  ];

  const bar = (
    <div className="histogram-widget__timebar">
      <DatePicker
        mode="range"
        isOpen={open}
        onOpenChange={setOpen}
        rangeValue={rangeValue}
        placeholder="Select date range"
        presets={presets}
        selectedPreset={selectedPreset}
        onPresetSelect={(v: string) => {
          presetSelectingRef.current = true;
          setSelectedPreset(v);
          if (v !== 'custom') {
            const preset = timeTabConfig?.allDurations?.find((d) => d.id === v);
            const { startTime, endTime } = computeRange({ ...timeTabConfig, defaultDurationId: v } as TimeTabUIConfig);
            setRangeValue({ start: new Date(startTime), end: new Date(endTime) });
            const opts = presetPeriodicities(preset);
            const next = pickPeriodicity(opts, periodicity, touchedRef.current);
            setPeriodicity(next);
            emitTimeChange(onEvent, startTime, endTime, next);
          }
        }}
        onRangeChange={(v: DateRange | null) => {
          if (!v) return;
          setRangeValue(v);
          if (presetSelectingRef.current) {
            presetSelectingRef.current = false;
            return; // preset path already emitted
          }
          const vStart = new Date(v.start).getTime();
          const vEnd = new Date(v.end).getTime();
          const opts = rangePeriodicities(vStart, vEnd);
          const next = pickPeriodicity(opts, periodicity, touchedRef.current);
          setPeriodicity(next);
          setSelectedPreset('custom');
          emitTimeChange(onEvent, vStart, vEnd, next);
        }}
      />

      {/* Periodicity — a separate control pinned to the right edge (matches the
          Column/Line chart filters row and the Figma). */}
      <div className="histogram-widget__periodicity">
        <SelectInput label="" value={periodicity} placeholder="Periodicity" isOpen={pOpen} onClick={() => setPOpen((o) => !o)}>
          <DropdownMenu>
            {periodicityOptions.map((opt) => (
              <ActionListItem
                key={opt}
                title={opt}
                selectionType="Single"
                isSelected={opt === periodicity}
                onClick={() => {
                  touchedRef.current = true;
                  setPeriodicity(opt);
                  setPOpen(false);
                  emitTimeChange(onEvent, rangeValue.start.getTime(), rangeValue.end.getTime(), opt);
                }}
              />
            ))}
          </DropdownMenu>
        </SelectInput>
      </div>
    </div>
  );

  return bar;
}
