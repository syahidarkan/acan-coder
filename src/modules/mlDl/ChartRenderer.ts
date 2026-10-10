import * as vscode from 'vscode';
import type { NormalizedMetrics } from './TrainingLogParser';

export class ChartRenderer {
  renderInWebview(metrics: NormalizedMetrics, panel: vscode.WebviewPanel): void {
    panel.webview.html = this.buildHtml(metrics);
  }

  private buildHtml(m: NormalizedMetrics): string {
    const labels = JSON.stringify(m.epochs);
    const trainLoss = JSON.stringify(m.trainLoss);
    const valLoss = JSON.stringify(m.valLoss ?? []);
    const trainAcc = JSON.stringify(m.trainAcc ?? []);
    const valAcc = JSON.stringify(m.valAcc ?? []);
    const hasLoss = m.trainLoss.length > 0;
    const hasAcc = (m.trainAcc?.length ?? 0) > 0;

    return `<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<script src="https://cdn.jsdelivr.net/npm/chart.js@4.4.2/dist/chart.umd.min.js"></script>
<style>
  body { background: #09090b; color: #e4e4e7; font-family: system-ui, sans-serif; padding: 16px; margin: 0; }
  h2 { font-size: 1rem; font-weight: 600; color: #a1a1aa; margin: 0 0 8px; }
  .grid { display: grid; grid-template-columns: ${hasAcc ? '1fr 1fr' : '1fr'}; gap: 16px; }
  canvas { max-height: 320px; }
  .meta { font-size: 0.75rem; color: #71717a; margin-top: 12px; }
  .btn { background: #27272a; border: 1px solid #3f3f46; color: #e4e4e7; padding: 6px 12px; border-radius: 6px; cursor: pointer; font-size: 0.75rem; }
</style>
</head>
<body>
<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:16px">
  <div>
    <h1 style="font-size:1.125rem;font-weight:600;margin:0">${m.framework.toUpperCase()} Training Metrics</h1>
    <div class="meta">Epochs: ${m.metadata.totalEpochs}${m.metadata.bestValLoss ? ` · Best val loss: ${m.metadata.bestValLoss.toFixed(4)} at epoch ${m.metadata.bestEpoch}` : ''}</div>
  </div>
  <button class="btn" onclick="exportCsv()">Export CSV</button>
</div>
<div class="grid">
  ${hasLoss ? `<div><h2>Loss</h2><canvas id="lossChart"></canvas></div>` : ''}
  ${hasAcc ? `<div><h2>Accuracy</h2><canvas id="accChart"></canvas></div>` : ''}
</div>
<script>
const labels = ${labels};
const COLORS = { train: '#f59e0b', val: '#38bdf8', acc: '#34d399', valAcc: '#a78bfa' };
function makeChart(id, datasets) {
  return new Chart(document.getElementById(id), {
    type: 'line',
    data: { labels, datasets },
    options: {
      responsive: true,
      plugins: { legend: { labels: { color: '#a1a1aa', font: { size: 11 } } } },
      scales: {
        x: { ticks: { color: '#52525b' }, grid: { color: '#27272a' } },
        y: { ticks: { color: '#52525b' }, grid: { color: '#27272a' } },
      },
    }
  });
}
${hasLoss ? `makeChart('lossChart', [
  { label: 'Train Loss', data: ${trainLoss}, borderColor: COLORS.train, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },
  ${m.valLoss?.length ? `{ label: 'Val Loss', data: ${valLoss}, borderColor: COLORS.val, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },` : ''}
]);` : ''}
${hasAcc ? `makeChart('accChart', [
  { label: 'Train Acc', data: ${trainAcc}, borderColor: COLORS.acc, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },
  ${m.valAcc?.length ? `{ label: 'Val Acc', data: ${valAcc}, borderColor: COLORS.valAcc, backgroundColor: 'transparent', tension: 0.3, pointRadius: 2 },` : ''}
]);` : ''}
function exportCsv() {
  const rows = [['epoch','trainLoss','valLoss','trainAcc','valAcc']];
  const tl=${trainLoss},vl=${valLoss},ta=${trainAcc},va=${valAcc};
  labels.forEach((ep,i) => rows.push([ep,tl[i]??'',vl[i]??'',ta[i]??'',va[i]??'']));
  const csv = rows.map(r=>r.join(',')).join('\\n');
  const a = document.createElement('a');
  a.href = 'data:text/csv,' + encodeURIComponent(csv);
  a.download = 'metrics.csv';
  a.click();
}
</script>
</body>
</html>`;
  }
}
