import React, { useState } from 'react';
import { useExtensionMessage } from '../hooks/useExtensionMessage';
import type { UsageSummary } from '../../../core/ApiRotator';

export function TokenBudgetBar() {
  const [usage, setUsage] = useState<UsageSummary | null>(null);
  const [showModal, setShowModal] = useState(false);

  useExtensionMessage<UsageSummary>('usage_update', setUsage);

  if (!usage) return (
    <div style={bar}>
      <span style={{ color: '#52525b', fontSize: 11 }}>Acan Coder — connecting...</span>
    </div>
  );

  const totalReqs = usage.providers.reduce((s, p) => s + p.requestsToday, 0);
  const activeLabel = usage.activeModel
    ? usage.activeModel.replace('openai/', '').split('/').pop()
    : null;
  const activeProviderName = usage.activeModel?.split('/')[0] ?? '';

  // Group providers by provider name for the modal
  const byProvider: Record<string, typeof usage.providers> = {};
  for (const p of usage.providers) {
    if (!byProvider[p.provider]) byProvider[p.provider] = [];
    byProvider[p.provider].push(p);
  }

  return (
    <>
      <div style={bar} onClick={() => setShowModal(true)} title="Click for API status">
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, width: '100%' }}>
          {/* Active model indicator */}
          {activeLabel ? (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1, minWidth: 0 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#22c55e', flexShrink: 0 }} />
              <span style={{ color: '#a1a1aa', fontSize: 11, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {activeProviderName} · {activeLabel}
              </span>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 5, flex: 1 }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#3f3f46' }} />
              <span style={{ color: '#52525b', fontSize: 11 }}>No active model</span>
            </div>
          )}

          {/* Provider dots */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            {Object.entries(byProvider).map(([provider, models]) => {
              const hasKey = models[0].hasKey;
              const anyAvail = models.some(m => m.isAvailable);
              const isActive = activeProviderName === provider;
              const color = !hasKey ? '#3f3f46' : !anyAvail ? '#ef4444' : '#22c55e';
              return (
                <div key={provider} title={`${provider} – ${hasKey ? `${models[0].keyCount} key(s)` : 'no key'}`}
                  style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                  <div style={{
                    width: isActive ? 7 : 5, height: isActive ? 7 : 5,
                    borderRadius: '50%', background: color,
                    boxShadow: isActive ? `0 0 4px ${color}` : 'none',
                    transition: 'all 0.2s',
                  }} />
                </div>
              );
            })}
          </div>

          <span style={{ color: '#52525b', fontSize: 10, fontFamily: 'monospace', flexShrink: 0 }}>
            {totalReqs} req
          </span>
        </div>
      </div>

      {/* Modal */}
      {showModal && (
        <div style={overlay} onClick={() => setShowModal(false)}>
          <div style={modal} onClick={e => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
              <span style={{ fontWeight: 600, fontSize: 13, color: '#e4e4e7' }}>API Status</span>
              <span style={{ cursor: 'pointer', color: '#71717a', fontSize: 16, lineHeight: 1 }} onClick={() => setShowModal(false)}>✕</span>
            </div>

            {Object.entries(byProvider).map(([provider, models]) => {
              const hasKey = models[0].hasKey;
              const keyCount = models[0].keyCount;
              const anyAvail = models.some(m => m.isAvailable);
              const isActive = activeProviderName === provider;

              const statusColor = !hasKey ? '#52525b' : !anyAvail ? '#ef4444' : '#22c55e';
              const statusLabel = !hasKey ? 'No key' : !anyAvail ? 'Rate limited' : 'Active';

              return (
                <div key={provider} style={{
                  marginBottom: 10,
                  border: `1px solid ${isActive ? '#7c3aed44' : '#27272a'}`,
                  borderRadius: 8,
                  overflow: 'hidden',
                  background: isActive ? '#1a0f2e' : 'transparent',
                }}>
                  {/* Provider header */}
                  <div style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '8px 12px', borderBottom: '1px solid #27272a',
                  }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: '50%', background: statusColor }} />
                      <span style={{ fontSize: 12, fontWeight: 600, color: '#e4e4e7', textTransform: 'capitalize' }}>
                        {provider}
                      </span>
                      {isActive && <span style={{ fontSize: 10, color: '#7c3aed', fontWeight: 600 }}>ACTIVE</span>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      {hasKey && (
                        <span style={{ fontSize: 10, color: '#52525b' }}>{keyCount} key{keyCount > 1 ? 's' : ''}</span>
                      )}
                      <span style={{ fontSize: 10, color: statusColor, fontWeight: 500 }}>{statusLabel}</span>
                    </div>
                  </div>

                  {/* Models */}
                  {models.map(m => {
                    const modelActive = `${m.provider}/${m.model}` === usage.activeModel;
                    const mColor = !hasKey ? '#3f3f46' : !m.isAvailable ? '#ef4444' : '#22c55e';
                    return (
                      <div key={m.model} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                        padding: '6px 12px 6px 28px',
                        background: modelActive ? '#2d1b4e' : 'transparent',
                      }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                          <div style={{ width: 5, height: 5, borderRadius: '50%', background: mColor }} />
                          <span style={{ fontSize: 11, color: modelActive ? '#c4b5fd' : '#71717a', fontFamily: 'monospace' }}>
                            {m.model.replace('openai/', '')}
                          </span>
                        </div>
                        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
                          <span style={{ fontSize: 10, color: '#52525b', fontFamily: 'monospace' }}>
                            {m.requestsToday} req · {(m.tokensToday / 1000).toFixed(1)}k tok
                          </span>
                          {m.cooldownUntil && !m.isAvailable && (
                            <span style={{ fontSize: 10, color: '#ef4444' }}>
                              until {new Date(m.cooldownUntil).toLocaleTimeString()}
                            </span>
                          )}
                        </div>
                      </div>
                    );
                  })}
                </div>
              );
            })}

            <div style={{ fontSize: 10, color: '#3f3f46', textAlign: 'center', marginTop: 8 }}>
              Click anywhere outside to close
            </div>
          </div>
        </div>
      )}
    </>
  );
}

const bar: React.CSSProperties = {
  height: 30,
  background: 'var(--vscode-editor-background, #09090b)',
  borderTop: '1px solid var(--vscode-panel-border, #27272a)',
  display: 'flex',
  alignItems: 'center',
  padding: '0 12px',
  cursor: 'pointer',
  flexShrink: 0,
};

const overlay: React.CSSProperties = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(0,0,0,0.6)',
  display: 'flex',
  alignItems: 'flex-end',
  justifyContent: 'center',
  zIndex: 100,
  padding: '0 0 42px',
};

const modal: React.CSSProperties = {
  background: '#18181b',
  border: '1px solid #3f3f46',
  borderRadius: 10,
  padding: 16,
  width: '100%',
  maxWidth: 420,
  color: '#e4e4e7',
  fontFamily: 'system-ui, sans-serif',
  maxHeight: '80vh',
  overflowY: 'auto',
};
