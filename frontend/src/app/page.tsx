'use client';

// Dev preview harness — simulates the Lens side-by-side layout.
// Configurator onChange → envelope → mini-engine resolve() → widget re-renders.
//
// Auth: open /?token=<SSO_TOKEN> once (exchanged + stored in localStorage),
// or paste a JWT into the token field.

import { useEffect, useState } from 'react';
import HistogramWidgetConfiguration from '../components/HistogramWidgetConfiguration';
import { HistogramWidget } from '../components/HistogramWidget/HistogramWidget';
import { validateSSOToken } from '../iosense-sdk/api';
import { resolve } from '../iosense-sdk/mini-engine';
import type { DataEntry, HistogramEnvelope } from '../iosense-sdk/types';

// Dev-only: synthesize a bell-ish series (~600 pts in [0,100] over ~5 days) for
// each binding so the widget preview renders WITHOUT a backend token. Lets you
// see bars appear as you add bins locally. Real data replaces this once a token
// is provided.
function mockSeriesData(envelope: HistogramEnvelope): DataEntry[] {
  const start = 1_700_000_000_000;
  let seed = 7;
  const rand = () => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const slots = Array.from({ length: 600 }, (_, i) => {
    const v = ((rand() + rand() + rand()) / 3) * 100;
    return { from: start + i * 12 * 60 * 1000, to: start + i * 12 * 60 * 1000, label: '', value: Math.round(v * 100) / 100, quality: 'good' };
  });
  return (envelope.dynamicBindingPathList ?? []).map((b) => ({
    key: b.key,
    value: { __type: 'series' as const, path: '', meta: {} as never, range: { from: 0, to: 0 }, slots },
  }));
}

export default function Home() {
  const [envelope, setEnvelope] = useState<HistogramEnvelope | undefined>(undefined);
  const [data, setData] = useState<DataEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [token, setToken] = useState('');
  const [authError, setAuthError] = useState('');
  // Render the configurator/widget client-only. The design-sdk's
  // ProductAccordionItem and TimeTabConfiguration render a <button> inside a
  // <button> (invalid HTML) — harmless in the host's client-only mount, but it
  // trips Next.js hydration when SSR'd. Gating on `mounted` skips SSR of that
  // subtree so server + first client render agree.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  // Pick up token from localStorage / exchange SSO ?token= on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const ssoToken = params.get('token');

    if (ssoToken) {
      params.delete('token');
      const newUrl = `${window.location.pathname}${params.toString() ? `?${params}` : ''}`;
      window.history.replaceState({}, '', newUrl);

      validateSSOToken(ssoToken)
        .then((jwt) => setToken(jwt))
        .catch((err) => setAuthError(err instanceof Error ? err.message : 'Auth failed'));
    } else {
      setToken(localStorage.getItem('bearer_token') ?? '');
    }
  }, []);

  // Re-resolve whenever the envelope or token changes. With a token → real
  // resolveAndCompute. Without one → inject mock series so the preview renders
  // locally (dev convenience).
  useEffect(() => {
    if (!envelope) return;
    if (!token) {
      setData(mockSeriesData(envelope));
      setLoading(false);
      return;
    }
    let cancelled = false;
    console.log('[Harness] resolving envelope:', envelope.dynamicBindingPathList);
    setLoading(true);
    resolve(envelope, { authentication: token }).then(({ data: resolved }) => {
      if (cancelled) return;
      console.log('[Harness] resolved data:', resolved);
      setData(resolved);
      setLoading(false);
    });
    return () => { cancelled = true; };
  }, [envelope, token]);

  return (
    <div style={{ display: 'flex', height: '100vh', fontFamily: 'system-ui, sans-serif', background: '#f8fafc' }}>
      {/* Left — Configuration panel (~38%) */}
      <div
        style={{
          width: '38%',
          minWidth: 340,
          borderRight: '1px solid #e5e7eb',
          background: '#fff',
          overflow: 'hidden',
          display: 'flex',
          flexDirection: 'column',
        }}
      >
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Configuration</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>HistogramWidget</span>
        </div>

        {/* Token input (dev only) */}
        <div style={{ padding: '8px 16px', borderBottom: '1px solid #f3f4f6', display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontSize: 11, color: '#6b7280', flexShrink: 0 }}>Bearer token</span>
          <input
            type="password"
            placeholder="Paste JWT, or open /?token=<SSO_TOKEN>"
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              localStorage.setItem('bearer_token', e.target.value);
            }}
            style={{
              flex: 1,
              padding: '4px 8px',
              fontSize: 11,
              border: '1px solid #d1d5db',
              borderRadius: 4,
              background: '#f9fafb',
              outline: 'none',
            }}
          />
        </div>
        {authError && (
          <div style={{ padding: '6px 16px', fontSize: 11, color: '#dc2626', borderBottom: '1px solid #fee2e2', background: '#fef2f2' }}>
            Auth error: {authError}
          </div>
        )}

        <div style={{ flex: 1, overflow: 'auto' }}>
          {mounted ? (
            <HistogramWidgetConfiguration
              config={envelope}
              authentication={token}
              onChange={setEnvelope}
            />
          ) : (
            <div style={{ padding: 16, color: '#9ca3af', fontSize: 13 }}>Loading configuration…</div>
          )}
        </div>
      </div>

      {/* Right — Widget preview (~62%) */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
        <div style={{ padding: '12px 16px', borderBottom: '1px solid #e5e7eb', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ fontSize: 13, fontWeight: 600, color: '#374151' }}>Widget Preview</span>
          <span style={{ fontSize: 11, color: '#9ca3af' }}>
            {envelope
              ? `${envelope.uiConfig.dataSources.length} source(s) · ${envelope.uiConfig.aggregationMode} · ${envelope.dynamicBindingPathList.length} binding(s)`
              : 'not configured'}
          </span>
        </div>
        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {envelope ? (
            <HistogramWidget
              config={envelope.uiConfig}
              data={data}
              loading={loading}
              onEvent={(e) => console.log('[Widget Event]', e)}
            />
          ) : (
            <div style={{ padding: 32, color: '#9ca3af', fontSize: 13 }}>
              Configure the widget on the left to preview it.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
