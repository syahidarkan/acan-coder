import { exec } from 'child_process';
import { promisify } from 'util';
import * as fs from 'fs';
import { ApiRotator } from '../../core/ApiRotator';

const execAsync = promisify(exec);

export interface ModelConfig {
  modelType: 'transformer' | 'cnn' | 'rnn' | 'custom';
  numLayers: number;
  hiddenSize: number;
  numHeads?: number;
  seqLength?: number;
  batchSize: number;
  dtype: 'fp32' | 'fp16' | 'bf16' | 'int8' | 'int4';
  optimizer: 'adam' | 'adamw' | 'sgd' | 'none';
  gradientCheckpointing: boolean;
}

export interface VramEstimate {
  totalGB: number;
  breakdown: { model: number; gradients: number; optimizer: number; activations: number; buffer: number };
  warnings: string[];
  recommendations: string[];
}

const DTYPE_BYTES: Record<ModelConfig['dtype'], number> = { fp32: 4, fp16: 2, bf16: 2, int8: 1, int4: 0.5 };

class VramProfilerClass {
  estimateFromConfig(config: ModelConfig): VramEstimate {
    const bytes = DTYPE_BYTES[config.dtype];
    const paramCount = this.estimateParams(config);

    const modelMemory = (paramCount * bytes) / 1e9;
    const gradMemory = config.optimizer !== 'none' ? (paramCount * 4) / 1e9 : 0;
    const optimizerMemory = (config.optimizer === 'adam' || config.optimizer === 'adamw')
      ? (paramCount * 4 * 2) / 1e9 : 0;
    let activationMemory = this.estimateActivations(config) / 1e9;
    if (config.gradientCheckpointing) activationMemory *= 0.3;

    const subtotal = modelMemory + gradMemory + optimizerMemory + activationMemory;
    const buffer = subtotal * 0.2;
    const totalGB = subtotal + buffer;

    const warnings: string[] = [];
    const recommendations: string[] = [];

    if (totalGB > 80) warnings.push('Requires A100 80GB or multi-GPU setup');
    else if (totalGB > 40) warnings.push('OOM risk on 40GB GPU');
    else if (totalGB > 24) warnings.push('OOM risk on 24GB GPU (RTX 3090/4090)');
    else if (totalGB > 8) warnings.push('OOM risk on 8GB GPU');

    if (!config.gradientCheckpointing && activationMemory > 2) {
      recommendations.push('Enable gradient checkpointing to save ~70% activation memory');
    }
    if (config.dtype === 'fp32') recommendations.push('Switch to bf16 to halve model memory');
    if (config.optimizer === 'adam') recommendations.push('Consider AdaFactor or 8-bit Adam to reduce optimizer memory');

    return {
      totalGB: Math.round(totalGB * 100) / 100,
      breakdown: {
        model: Math.round(modelMemory * 100) / 100,
        gradients: Math.round(gradMemory * 100) / 100,
        optimizer: Math.round(optimizerMemory * 100) / 100,
        activations: Math.round(activationMemory * 100) / 100,
        buffer: Math.round(buffer * 100) / 100,
      },
      warnings,
      recommendations,
    };
  }

  private estimateParams(c: ModelConfig): number {
    if (c.modelType === 'transformer') {
      const attn = 4 * c.hiddenSize * c.hiddenSize;
      const ffn = 8 * c.hiddenSize * c.hiddenSize;
      return c.numLayers * (attn + ffn);
    }
    if (c.modelType === 'cnn') {
      return c.numLayers * c.hiddenSize * c.hiddenSize * 9; // 3x3 kernels
    }
    if (c.modelType === 'rnn') {
      return c.numLayers * 4 * c.hiddenSize * c.hiddenSize;
    }
    return c.numLayers * c.hiddenSize * c.hiddenSize;
  }

  private estimateActivations(c: ModelConfig): number {
    const seqLen = c.seqLength ?? 512;
    if (c.modelType === 'transformer') {
      return c.numLayers * c.batchSize * seqLen * c.hiddenSize * DTYPE_BYTES[c.dtype];
    }
    return c.numLayers * c.batchSize * c.hiddenSize * DTYPE_BYTES[c.dtype];
  }

  async profileFromFile(pythonFile: string): Promise<VramEstimate> {
    const source = fs.readFileSync(pythonFile, 'utf-8');

    // Try to extract config via regex
    const numLayersMatch = source.match(/num_layers\s*=\s*(\d+)|n_layers\s*=\s*(\d+)|num_hidden_layers['":\s]+(\d+)/);
    const hiddenMatch = source.match(/hidden_size\s*=\s*(\d+)|d_model\s*=\s*(\d+)|hidden_dim\s*=\s*(\d+)/);
    const batchMatch = source.match(/batch_size\s*=\s*(\d+)/);

    if (numLayersMatch && hiddenMatch) {
      const numLayers = parseInt(numLayersMatch[1] ?? numLayersMatch[2] ?? numLayersMatch[3] ?? '12');
      const hiddenSize = parseInt(hiddenMatch[1] ?? hiddenMatch[2] ?? hiddenMatch[3] ?? '768');
      const batchSize = batchMatch ? parseInt(batchMatch[1]) : 8;
      const hasFP16 = /fp16|float16/.test(source);
      const hasAdam = /adamw?/.test(source.toLowerCase());
      const hasGC = /gradient_checkpointing/.test(source);

      return this.estimateFromConfig({
        modelType: 'transformer',
        numLayers, hiddenSize, batchSize,
        dtype: hasFP16 ? 'fp16' : 'fp32',
        optimizer: hasAdam ? 'adamw' : 'sgd',
        gradientCheckpointing: hasGC,
      });
    }

    // Fallback to AI parsing
    const result = await ApiRotator.callApi(
      'code_reasoning',
      [{
        role: 'user',
        content: `Extract the model configuration from this PyTorch code as JSON with keys: numLayers, hiddenSize, batchSize, dtype (fp32/fp16/bf16/int8/int4), optimizer (adam/adamw/sgd/none), modelType (transformer/cnn/rnn/custom), gradientCheckpointing (bool)\n\nCode:\n${source.slice(0, 3000)}`
      }]
    );

    try {
      const jsonMatch = result.content.match(/\{[\s\S]+\}/);
      if (jsonMatch) {
        const config = JSON.parse(jsonMatch[0]) as ModelConfig;
        return this.estimateFromConfig(config);
      }
    } catch { /* fallthrough */ }

    return this.estimateFromConfig({ modelType: 'transformer', numLayers: 12, hiddenSize: 768, batchSize: 8, dtype: 'fp32', optimizer: 'adamw', gradientCheckpointing: false });
  }

  async detectGpuVram(): Promise<number> {
    try {
      const { stdout } = await execAsync('nvidia-smi --query-gpu=memory.total --format=csv,noheader,nounits');
      const mb = parseInt(stdout.trim().split('\n')[0]);
      return Math.round(mb / 1024);
    } catch {
      // Apple Silicon or no nvidia-smi
      return 16; // fallback default
    }
  }
}

export const VramProfiler = new VramProfilerClass();
