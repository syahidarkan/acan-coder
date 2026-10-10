import * as fs from 'fs';
import { parse as parseCsv } from 'csv-parse/sync';

export type Framework = 'pytorch' | 'lightning' | 'huggingface' | 'keras' | 'generic';

export interface NormalizedMetrics {
  framework: Framework;
  epochs: number[];
  trainLoss: number[];
  valLoss?: number[];
  trainAcc?: number[];
  valAcc?: number[];
  customMetrics?: Record<string, number[]>;
  metadata: { totalEpochs: number; bestValLoss?: number; bestEpoch?: number };
}

class TrainingLogParserClass {
  parse(input: string | { filePath: string }): NormalizedMetrics {
    let content: string;
    if (typeof input === 'string') {
      content = input;
    } else {
      content = fs.readFileSync(input.filePath, 'utf-8');
    }

    // Try HuggingFace trainer_state.json first
    if (input && typeof input === 'object') {
      const fp = (input as { filePath: string }).filePath;
      if (fp.endsWith('trainer_state.json')) return this.parseHuggingFace(content);
      if (fp.endsWith('.csv')) return this.parseCsv(content);
    }

    if (this.looksLikeLightning(content)) return this.parseLightning(content);
    if (this.looksLikeHuggingFace(content)) return this.parseHuggingFace(content);
    if (this.looksLikeKeras(content)) return this.parseKeras(content);
    return this.parsePyTorch(content);
  }

  private looksLikeLightning(c: string) { return /['"]loss['"]/.test(c) && /['"]epoch['"]/.test(c) && /val_loss/.test(c); }
  private looksLikeHuggingFace(c: string) { return /log_history/.test(c) || /eval_loss/.test(c); }
  private looksLikeKeras(c: string) { return /history\.history/.test(c) || /val_accuracy/.test(c); }

  private parsePyTorch(content: string): NormalizedMetrics {
    const epochs: number[] = [], trainLoss: number[] = [];
    const re = /Epoch\s+(\d+)[^\n]*loss[:\s]+([\d.]+)/gi;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      epochs.push(parseInt(m[1]));
      trainLoss.push(parseFloat(m[2]));
    }
    return this.buildResult('pytorch', epochs, trainLoss);
  }

  private parseLightning(content: string): NormalizedMetrics {
    const epochs: number[] = [], trainLoss: number[] = [], valLoss: number[] = [];
    const re = /\{'loss':\s*([\d.]+).*?'val_loss':\s*([\d.]+).*?'epoch':\s*(\d+)/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(content)) !== null) {
      trainLoss.push(parseFloat(m[1]));
      valLoss.push(parseFloat(m[2]));
      epochs.push(parseInt(m[3]));
    }
    const result = this.buildResult('lightning', epochs, trainLoss);
    result.valLoss = valLoss;
    return result;
  }

  private parseHuggingFace(content: string): NormalizedMetrics {
    let data: { log_history?: Array<Record<string, number>> };
    try { data = JSON.parse(content); } catch { return this.buildResult('huggingface', [], []); }

    const history = data.log_history ?? [];
    const epochs: number[] = [], trainLoss: number[] = [], valLoss: number[] = [], valAcc: number[] = [];

    for (const entry of history) {
      if (entry.loss !== undefined) { epochs.push(entry.epoch ?? epochs.length + 1); trainLoss.push(entry.loss); }
      if (entry.eval_loss !== undefined) valLoss.push(entry.eval_loss);
      if (entry.eval_accuracy !== undefined) valAcc.push(entry.eval_accuracy);
    }

    const result = this.buildResult('huggingface', epochs, trainLoss);
    if (valLoss.length) result.valLoss = valLoss;
    if (valAcc.length) result.valAcc = valAcc;
    return result;
  }

  private parseKeras(content: string): NormalizedMetrics {
    try {
      const data = JSON.parse(content) as Record<string, number[]>;
      const loss = data.loss ?? data['history.history.loss'] ?? [];
      const valLoss = data.val_loss ?? [];
      const acc = data.accuracy ?? data.acc ?? [];
      const valAcc = data.val_accuracy ?? data.val_acc ?? [];
      const epochs = loss.map((_, i) => i + 1);
      const result = this.buildResult('keras', epochs, loss);
      if (valLoss.length) result.valLoss = valLoss;
      if (acc.length) result.trainAcc = acc;
      if (valAcc.length) result.valAcc = valAcc;
      return result;
    } catch {
      return this.buildResult('keras', [], []);
    }
  }

  private parseCsv(content: string): NormalizedMetrics {
    const rows = parseCsv(content, { columns: true, skip_empty_lines: true }) as Record<string, string>[];
    if (!rows.length) return this.buildResult('generic', [], []);

    const cols = Object.keys(rows[0]);
    const epochCol = cols.find(c => /epoch|step/i.test(c));
    const lossCol = cols.find(c => /^loss$/i.test(c) || /train.*loss/i.test(c));
    const valLossCol = cols.find(c => /val.*loss/i.test(c));
    const accCol = cols.find(c => /^acc/i.test(c) || /train.*acc/i.test(c));
    const valAccCol = cols.find(c => /val.*acc/i.test(c));

    const epochs = epochCol ? rows.map(r => parseFloat(r[epochCol])) : rows.map((_, i) => i + 1);
    const trainLoss = lossCol ? rows.map(r => parseFloat(r[lossCol])) : [];
    const result = this.buildResult('generic', epochs, trainLoss);
    if (valLossCol) result.valLoss = rows.map(r => parseFloat(r[valLossCol]));
    if (accCol) result.trainAcc = rows.map(r => parseFloat(r[accCol]));
    if (valAccCol) result.valAcc = rows.map(r => parseFloat(r[valAccCol]));
    return result;
  }

  private buildResult(framework: Framework, epochs: number[], trainLoss: number[]): NormalizedMetrics {
    const valLoss = undefined;
    let bestValLoss: number | undefined, bestEpoch: number | undefined;
    if (valLoss) {
      const minIdx = (valLoss as number[]).indexOf(Math.min(...(valLoss as number[])));
      bestValLoss = (valLoss as number[])[minIdx];
      bestEpoch = epochs[minIdx];
    }
    return { framework, epochs, trainLoss, metadata: { totalEpochs: epochs.length, bestValLoss, bestEpoch } };
  }
}

export const TrainingLogParser = new TrainingLogParserClass();
