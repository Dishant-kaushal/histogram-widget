// HistogramWidgetConfiguration — self-registration for Lens (window.ReactWidgets)

import React from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { HistogramWidgetConfiguration } from './HistogramWidgetConfiguration';
import type { HistogramEnvelope } from '../../iosense-sdk/types';

interface ConfigProps {
  config?: HistogramEnvelope;
  authentication?: string;
  onChange: (envelope: HistogramEnvelope) => void;
}

const roots = new Map<string, Root>();

function mount(id: string, props: ConfigProps) {
  const container = document.getElementById(id);
  if (!container) throw new Error(`HistogramWidgetConfiguration: container #${id} not found`);

  if (roots.has(id)) {
    roots.get(id)!.unmount();
    roots.delete(id);
  }

  container.setAttribute('data-zone-ignore', '');
  const root = createRoot(container);
  roots.set(id, root);
  root.render(React.createElement(HistogramWidgetConfiguration, props));
}

function update(id: string, props: ConfigProps) {
  const root = roots.get(id);
  if (!root) return mount(id, props);
  root.render(React.createElement(HistogramWidgetConfiguration, props));
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
  ((window as unknown as Record<string, unknown>).ReactWidgets as Record<string, unknown>).HistogramWidgetConfiguration = {
    mount,
    update,
    unmount,
  };
}

export { mount, update, unmount, HistogramWidgetConfiguration };
export default HistogramWidgetConfiguration;
