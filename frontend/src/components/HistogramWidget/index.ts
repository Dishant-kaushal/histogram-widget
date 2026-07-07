// HistogramWidget — self-registration for Lens (window.ReactWidgets)
// Lens calls mount() once, then update() on config changes.
//
// The host passes the saved envelope as `config` + an auth token. The
// DataLayer wrapper here runs the mini-engine (one batched resolveAndCompute
// over dynamicBindingPathList) and feeds the resolved DataEntry[] to the pure
// HistogramWidget — the widget component itself never fetches.

import React, { useEffect, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HistogramWidget } from './HistogramWidget';
import { resolve } from '../../iosense-sdk/mini-engine';
import type { DataEntry, HistogramEnvelope, WidgetEvent } from '../../iosense-sdk/types';
// Bundle the design-sdk stylesheet so the widget's SDK components (EmptyState,
// etc.) are styled inside the host's shadow root, which loads only this bundle CSS.
import '@faclon-labs/design-sdk/styles.css';

interface WidgetProps {
  config?: HistogramEnvelope;
  authentication?: string;
}

function HistogramWidgetDataLayer({ config: envelope, authentication }: WidgetProps) {
  const [data, setData] = useState<DataEntry[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!envelope?.dynamicBindingPathList?.length) {
      setData([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    resolve(envelope, { authentication: authentication ?? '' }).then(({ data: resolved }) => {
      if (!cancelled) {
        setData(resolved);
        setLoading(false); // clear even when `resolved` is [] → widget shows "No Data", not a stuck spinner
      }
    });
    return () => {
      cancelled = true;
    };
  }, [envelope, authentication]);

  return React.createElement(HistogramWidget, {
    config: envelope?.uiConfig ?? ({} as HistogramEnvelope['uiConfig']),
    data,
    loading,
    onEvent: (e: WidgetEvent) => console.log('[HistogramWidget Event]', e),
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
