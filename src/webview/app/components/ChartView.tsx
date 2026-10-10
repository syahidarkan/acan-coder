import React from 'react';
import { useExtensionMessage } from '../hooks/useExtensionMessage';
import type { NormalizedMetrics } from '../../../modules/mlDl/TrainingLogParser';

export function ChartView() {
  const [metrics, setMetrics] = React.useState<NormalizedMetrics | null>(null);
  useExtensionMessage<NormalizedMetrics>('chart_data', setMetrics);

  if (!metrics) return (
    <div style={{ color: '#52525b', padding: 32, textAlign: 'center', fontSize: 13 }}>
      No training data loaded. Use <strong>AI Coder: View Training Log</strong>.
    </div>
  );

  return (
    <div style={{ padding: 16, color: '#e4e4e7', fontFamily: 'system-ui, sans-serif', fontSize: 12 }}>
      <div style={{ color: '#a1a1aa', marginBottom: 8 }}>
        Framework: <strong>{metrics.framework}</strong> · Epochs: {metrics.metadata.totalEpochs}
        {metrics.metadata.bestValLoss && ` · Best val loss: ${metrics.metadata.bestValLoss.toFixed(4)} @ epoch ${metrics.metadata.bestEpoch}`}
      </div>
      <div style={{ color: '#52525b', fontSize: 11 }}>
        Chart rendering is handled in the dedicated VS Code WebviewPanel opened by the command.
      </div>
    </div>
  );
}
