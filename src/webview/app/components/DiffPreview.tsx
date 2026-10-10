import React from 'react';

interface Props { original: string; modified: string; }

export function DiffPreview({ original, modified }: Props) {
  const origLines = original.split('\n');
  const modLines = modified.split('\n');
  const maxLen = Math.max(origLines.length, modLines.length);

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, fontFamily: 'monospace', fontSize: 12 }}>
      <div style={{ background: '#1c1c1e', borderRadius: 6, padding: 8, overflow: 'auto' }}>
        <div style={{ color: '#71717a', marginBottom: 8, fontSize: 11 }}>Original</div>
        {origLines.map((line, i) => (
          <div key={i} style={{ color: modLines[i] !== line ? '#f87171' : '#e4e4e7', whiteSpace: 'pre' }}>
            {line || ' '}
          </div>
        ))}
      </div>
      <div style={{ background: '#1c1c1e', borderRadius: 6, padding: 8, overflow: 'auto' }}>
        <div style={{ color: '#71717a', marginBottom: 8, fontSize: 11 }}>Modified</div>
        {modLines.map((line, i) => (
          <div key={i} style={{ color: origLines[i] !== line ? '#86efac' : '#e4e4e7', whiteSpace: 'pre' }}>
            {line || ' '}
          </div>
        ))}
      </div>
    </div>
  );
}
