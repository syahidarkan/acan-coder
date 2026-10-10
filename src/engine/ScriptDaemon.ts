import { Worker, isMainThread, parentPort, workerData } from 'worker_threads';
import * as path from 'path';
import { EventBus, ExtensionEvents } from '../core/EventBus';
import { logger } from '../utils/logger';

export type ScriptTaskType =
  | 'scrape'
  | 'parse_log'
  | 'fetch_asset'
  | 'ast_skeleton'
  | 'vram_estimate'
  | 'render_pptx'
  | 'render_video';

export interface ScriptTask {
  id: string;
  type: ScriptTaskType;
  payload: unknown;
  priority: 'high' | 'normal' | 'low';
  onProgress?: (pct: number, message: string) => void;
}

interface QueuedTask extends ScriptTask {
  resolve: (value: unknown) => void;
  reject: (reason: unknown) => void;
}

const PRIORITY_ORDER = { high: 0, normal: 1, low: 2 };

class ScriptDaemonClass {
  private queue: QueuedTask[] = [];
  private activeCount = 0;
  private readonly MAX_WORKERS = 3;
  private completedCount = 0;

  submit(task: Omit<ScriptTask, 'onProgress'>): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.enqueue({ ...task, resolve, reject });
    });
  }

  submitWithProgress(task: ScriptTask): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.enqueue({ ...task, resolve, reject });
    });
  }

  getQueueStatus() {
    return {
      pending: this.queue.length,
      active: this.activeCount,
      completed: this.completedCount,
    };
  }

  private enqueue(task: QueuedTask) {
    this.queue.push(task);
    this.queue.sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority]);
    this.drain();
  }

  private drain() {
    while (this.activeCount < this.MAX_WORKERS && this.queue.length > 0) {
      const task = this.queue.shift()!;
      this.activeCount++;
      this.runTask(task).finally(() => {
        this.activeCount--;
        this.completedCount++;
        this.drain();
      });
    }
  }

  private runTask(task: QueuedTask): Promise<void> {
    return new Promise(resolve => {
      const worker = new Worker(__filename, {
        workerData: { taskId: task.id, taskType: task.type, payload: task.payload },
      });

      worker.on('message', (msg: { type: string; pct?: number; message?: string; data?: unknown; error?: string }) => {
        if (msg.type === 'progress' && task.onProgress) {
          task.onProgress(msg.pct ?? 0, msg.message ?? '');
          EventBus.emit(ExtensionEvents.SCRIPT_PROGRESS, { taskId: task.id, pct: msg.pct, message: msg.message });
        } else if (msg.type === 'result') {
          task.resolve(msg.data);
        } else if (msg.type === 'error') {
          const err = new Error(msg.error ?? 'Worker error');
          EventBus.emit(ExtensionEvents.SCRIPT_ERROR, { taskId: task.id, error: err, task });
          task.reject(err);
        }
      });

      worker.on('error', err => {
        logger.error(`Worker error in task ${task.id}`, err);
        EventBus.emit(ExtensionEvents.SCRIPT_ERROR, { taskId: task.id, error: err, task });
        task.reject(err);
        resolve();
      });

      worker.on('exit', () => resolve());
    });
  }
}

// Worker thread execution
if (!isMainThread) {
  const { taskType, payload } = workerData as { taskId: string; taskType: ScriptTaskType; payload: unknown };
  (async () => {
    try {
      let result: unknown;
      switch (taskType) {
        case 'ast_skeleton': {
          const { extractSkeleton } = await import('./AstSkeleton');
          result = await extractSkeleton(payload as string);
          break;
        }
        case 'parse_log': {
          const { TrainingLogParser } = await import('../modules/mlDl/TrainingLogParser');
          result = TrainingLogParser.parse(payload as string | { filePath: string });
          break;
        }
        case 'vram_estimate': {
          const { VramProfiler } = await import('../modules/mlDl/VramProfiler');
          result = VramProfiler.estimateFromConfig(payload as Parameters<typeof VramProfiler.estimateFromConfig>[0]);
          break;
        }
        case 'render_pptx': {
          const { PptxDslEngine } = await import('../modules/media/PptxDslEngine');
          const { dsl, outputPath } = payload as { dsl: unknown; outputPath: string };
          await PptxDslEngine.render(dsl as Parameters<typeof PptxDslEngine.render>[0], outputPath, pct => {
            parentPort?.postMessage({ type: 'progress', pct, message: `Rendering slide...` });
          });
          result = outputPath;
          break;
        }
        default:
          result = null;
      }
      parentPort?.postMessage({ type: 'result', data: result });
    } catch (err: unknown) {
      parentPort?.postMessage({ type: 'error', error: err instanceof Error ? err.message : String(err) });
    }
  })();
}

export const ScriptDaemon = new ScriptDaemonClass();
