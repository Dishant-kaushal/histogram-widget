// HistogramWidget — self-registration for Lens (window.ReactWidgets)
// Lens calls mount() once, then update() on config/data changes.
//
// HOST CONTRACT (react-wrapper.component.ts → buildProps): the host passes
//   { config: <uiConfig — NOT the envelope>, data: <resolved items[]>, timeConfig,
//     editMode, onEvent }
// and PUSHES data itself: its DataLayer runs the resolveAndCompute query and
// calls update(id, props) with the store's items array (raw shape — `slots` on
// each entry) whenever new data lands. So in the host this wrapper is a pure
// pass-through: no self-fetching.
//
// The mini-engine self-fetch path is kept ONLY for standalone use (no `data`
// prop, config is a full envelope with dynamicBindingPathList).

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HistogramWidget } from './HistogramWidget';
import { resolve } from '../../iosense-sdk/mini-engine';
import type { DataEntry, HistogramEnvelope, HistogramUIConfig, TimeTabUIConfig, WidgetEvent } from '../../iosense-sdk/types';
// Bundle the design-sdk stylesheet so the widget's SDK components (EmptyState,
// etc.) are styled inside the host's shadow root, which loads only this bundle CSS.
import '@faclon-labs/design-sdk/base.css';

interface WidgetProps {
  /** Host: the uiConfig. Standalone/legacy: the full envelope. */
  config?: HistogramEnvelope | HistogramUIConfig;
  /** Host-resolved data items. Presence of this prop (even []) = host mode. */
  data?: unknown;
  timeConfig?: unknown;
  /** Raw SDK time config — the host's preferred read path; drives the widget's
   *  above-chart time picker. Standalone: taken from the envelope. */
  timeTabConfig?: TimeTabUIConfig;
  editMode?: boolean;
  onEvent?: (e: WidgetEvent) => void;
  authentication?: string;
}

function isEnvelope(c: WidgetProps['config']): c is HistogramEnvelope {
  return !!c && typeof c === 'object' && 'uiConfig' in c;
}

/** Host store emits the items array, or null pre-load, or (defensively) the
 *  whole response body. Normalize to the DataEntry[] the widget consumes —
 *  getSeriesData() already tolerates raw items (slots on the entry). */
function normalizeHostData(d: unknown): DataEntry[] {
  if (Array.isArray(d)) return d as DataEntry[];
  if (d && typeof d === 'object' && Array.isArray((d as { data?: unknown }).data)) {
    return (d as { data: DataEntry[] }).data;
  }
  return [];
}

function HistogramWidgetDataLayer(props: WidgetProps) {
  const { config, data: hostData, authentication, onEvent } = props;
  const envelope = isEnvelope(config) ? config : undefined;
  const uiConfig = (envelope ? envelope.uiConfig : (config as HistogramUIConfig)) ?? ({} as HistogramUIConfig);
  // The host ALWAYS includes a data prop (data || []); standalone callers don't.
  const hostMode = hostData !== undefined;

  const [fetched, setFetched] = useState<DataEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (hostMode) return; // host pushes data — never self-fetch
    let cancelled = false;
    if (!envelope?.dynamicBindingPathList?.length) {
      setFetched([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    resolve(envelope, { authentication: authentication ?? '' }).then(({ data: resolved }) => {
      if (!cancelled) {
        setFetched(resolved);
        setLoading(false); // clear even when `resolved` is [] → widget shows "No Data", not a stuck spinner
      }
    });
    return () => {
      cancelled = true;
    };
  }, [hostMode, envelope, authentication]);

  const data = hostMode ? normalizeHostData(hostData) : fetched;
  // Time config for the picker + initial window/periodicity. The host does NOT pass
  // the raw SDK `timeTabConfig` — it passes the RICH `timeConfig` (allDurations,
  // defaultDurationId, defaultPeriodicity, pickerType). Read that first so the
  // picker + default periodicity survive a save + refresh; fall back to an explicit
  // timeTabConfig prop or the standalone envelope's.
  const timeTabConfig = (props.timeTabConfig ??
    (props.timeConfig as TimeTabUIConfig | undefined) ??
    envelope?.timeTabConfig) as TimeTabUIConfig | undefined;

  return React.createElement(HistogramWidget, {
    config: uiConfig,
    data,
    // Host mode: no explicit flag — the widget's empty-data heuristic covers the
    // gap between mount and the first data push.
    loading: hostMode ? undefined : loading,
    timeTabConfig,
    onEvent: onEvent ?? ((e: WidgetEvent) => console.log('[HistogramWidget Event]', e)),
  });
}

const roots = new Map<string, Root>();

function mount(id: string, props: WidgetProps) {
  const container = document.getElementById(id);
  if (!container) throw new Error(`HistogramWidget: container #${id} not found`);

  if (roots.has(id)) {
    roots.get(id)!.unmount();
    roots.delete(id);
  }

  container.setAttribute('data-zone-ignore', '');
  const root = createRoot(container);
  roots.set(id, root);
  root.render(React.createElement(HistogramWidgetDataLayer, props));
}

function update(id: string, props: WidgetProps) {
  const root = roots.get(id);
  if (!root) return mount(id, props);
  root.render(React.createElement(HistogramWidgetDataLayer, props));
}

function unmount(id: string) {
  const root = roots.get(id);
  if (root) {
    root.unmount();
    roots.delete(id);
  }
}

if (typeof window !== 'undefined') {
  (window as unknown as Record<string, unknown>).ReactWidgets ??= {};
  ((window as unknown as Record<string, unknown>).ReactWidgets as Record<string, unknown>).HistogramWidget = {
    mount,
    update,
    unmount,
  };
}

export { mount, update, unmount, HistogramWidgetDataLayer };
export default HistogramWidget;
