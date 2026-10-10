import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { extractSkeleton } from '../engine/AstSkeleton';
import { TrainingLogParser } from '../modules/mlDl/TrainingLogParser';
import { VramProfiler } from '../modules/mlDl/VramProfiler';
import { StateStore } from './StateStore';
import { EventBus, ExtensionEvents } from './EventBus';
import { logger } from '../utils/logger';

const execAsync = promisify(exec);
const SKELETON_LINE_THRESHOLD = 500;
const MAX_FILE_CHARS = 40_000;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', '.next', 'build', '.cache', 'out', '.turbo']);

export interface NormalizedToolCall {
  id: string;
  name: string;
  input: Record<string, string>;
}

export class ToolExecutor {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async execute(call: NormalizedToolCall): Promise<string> {
    const start = Date.now();
    let output = '';
    try {
      output = await this.dispatch(call);
    } catch (err: any) {
      output = `Error: ${err.message ?? String(err)}`;
    }
    const duration = Date.now() - start;
    try {
      StateStore.recordToolExecution(call.name, JSON.stringify(call.input), output.slice(0, 500), duration);
    } catch { /* non-critical */ }
    EventBus.emit(ExtensionEvents.SCRIPT_PROGRESS, { tool: call.name, duration });
    return output;
  }

  private async dispatch(call: NormalizedToolCall): Promise<string> {
    const { name, input } = call;
    switch (name) {
      case 'bash':             return this.runBash(input.command);
      case 'read_file':        return this.readFile(input.path);
      case 'write_file':       return this.writeFile(input.path, input.content);
      case 'read_file_section':return this.readSection(input.path, Number(input.start_line), Number(input.end_line));
      case 'list_files':       return this.listFiles(input.path ?? '.');
      case 'search_files':     return this.searchFiles(input.pattern, input.path, input.file_pattern);
      case 'git_operation':    return this.gitOp(input.operation, input.args ?? '');
      case 'scrape_url':       return this.scrapeUrl(input.url);
      case 'run_python':       return this.runPython(input.code, input.script_path);
      case 'estimate_vram':    return this.estimateVram(input.file_path);
      case 'parse_training_log': return this.parseTrainingLog(input.file_path);
      default:                 return `Unknown tool: ${name}`;
    }
  }

  private resolve(relPath: string): string {
    const full = path.resolve(this.workspacePath, relPath);
    if (!full.startsWith(this.workspacePath)) throw new Error('Path outside workspace');
    return full;
  }

  private async runBash(command: string): Promise<string> {
    const { stdout, stderr } = await execAsync(command, {
      cwd: this.workspacePath,
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', CI: '1' },
    });
    const out = stdout.trim();
    const err = stderr.trim();
    if (!out && !err) return '(no output)';
    if (!err) return out;
    if (!out) return `STDERR: ${err}`;
    return `${out}\n---\nSTDERR: ${err}`;
  }

  private async readFile(relPath: string): Promise<string> {
    const full = this.resolve(relPath);
    const content = fs.readFileSync(full, 'utf8');
    const lineCount = content.split('\n').length;

    if (lineCount > SKELETON_LINE_THRESHOLD && (relPath.endsWith('.ts') || relPath.endsWith('.tsx'))) {
      try {
        const skeleton = await extractSkeleton(full);
        return `[SKELETON — ${lineCount} lines total, use read_file_section for details]\n\n${skeleton}`;
      } catch {
        // fall through to truncated content
      }
    }

    if (content.length > MAX_FILE_CHARS) {
      return content.slice(0, MAX_FILE_CHARS) + `\n...[truncated, ${lineCount} lines total]`;
    }
    return content;
  }

  private writeFile(relPath: string, content: string): string {
    const full = this.resolve(relPath);
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    const lines = content.split('\n').length;
    return `Written: ${relPath} (${lines} lines)`;
  }

  private readSection(relPath: string, start: number, end: number): string {
    const full = this.resolve(relPath);
    const lines = fs.readFileSync(full, 'utf8').split('\n');
    const s = Math.max(0, start - 1);
    const e = Math.min(lines.length, end);
    return lines.slice(s, e).map((l, i) => `${s + i + 1}: ${l}`).join('\n');
  }

  private listFiles(relPath: string, depth = 0): string {
    const full = this.resolve(relPath);
    if (!fs.existsSync(full)) return `Path not found: ${relPath}`;
    const entries = fs.readdirSync(full, { withFileTypes: true });
    const lines: string[] = [];
    for (const e of entries) {
      if (SKIP_DIRS.has(e.name)) continue;
      const indent = '  '.repeat(depth);
      if (e.isDirectory()) {
        lines.push(`${indent}${e.name}/`);
        if (depth < 2) {
          const sub = this.listFiles(path.join(relPath, e.name), depth + 1);
          if (sub) lines.push(sub);
        }
      } else {
        lines.push(`${indent}${e.name}`);
      }
    }
    return lines.join('\n');
  }

  private async searchFiles(pattern: string, relDir = '.', filePattern = ''): Promise<string> {
    const full = this.resolve(relDir);
    const include = filePattern ? `--include="${filePattern}"` : '--include="*.ts" --include="*.tsx" --include="*.js" --include="*.jsx" --include="*.json" --include="*.md"';
    const { stdout } = await execAsync(
      `grep -rn ${include} --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist "${pattern}" . 2>/dev/null | head -40`,
      { cwd: full, timeout: 10_000 }
    );
    return stdout.trim() || '(no matches)';
  }

  private async gitOp(operation: string, args: string): Promise<string> {
    const allowed = ['status', 'log', 'add', 'commit', 'push', 'pull', 'diff', 'branch', 'checkout', 'stash', 'remote', 'init', 'clone'];
    if (!allowed.includes(operation)) return `git ${operation} not allowed`;
    const cmd = `git ${operation}${args ? ' ' + args : ''}`;
    return this.runBash(cmd);
  }

  private async scrapeUrl(url: string): Promise<string> {
    if (!url.startsWith('http://') && !url.startsWith('https://')) {
      return 'Error: URL must start with http:// or https://';
    }
    try {
      // Dynamic import to avoid loading playwright at startup
      const { UniversalScraper } = await import('../modules/scraping/UniversalScraper');
      const scraper = new UniversalScraper();
      const result = await scraper.scrape(url);
      const preview = result.markdown.slice(0, 8000);
      return `# ${result.title}\n\n${preview}${result.markdown.length > 8000 ? '\n...[truncated]' : ''}`;
    } catch (err: any) {
      return `Scrape failed: ${err.message}`;
    }
  }

  private async runPython(code?: string, scriptPath?: string): Promise<string> {
    if (scriptPath) {
      const full = this.resolve(scriptPath);
      return this.runBash(`python3 "${full}"`);
    }
    if (code) {
      // Write to temp file and run
      const tmpFile = path.join(this.workspacePath, '.acan_tmp.py');
      fs.writeFileSync(tmpFile, code, 'utf8');
      try {
        const result = await this.runBash(`python3 "${tmpFile}"`);
        return result;
      } finally {
        try { fs.unlinkSync(tmpFile); } catch { /* ignore */ }
      }
    }
    return 'Error: provide either code or script_path';
  }

  private async estimateVram(relPath: string): Promise<string> {
    const full = this.resolve(relPath);
    try {
      const estimate = await VramProfiler.profileFromFile(full);
      const gpuVram = await VramProfiler.detectGpuVram();
      return JSON.stringify({
        totalGB: estimate.totalGB,
        gpuDetectedGB: gpuVram,
        fits: estimate.totalGB <= gpuVram,
        breakdown: estimate.breakdown,
        warnings: estimate.warnings,
        recommendations: estimate.recommendations,
      }, null, 2);
    } catch (err: any) {
      return `VRAM estimation failed: ${err.message}`;
    }
  }

  private parseTrainingLog(relPath: string): string {
    const full = this.resolve(relPath);
    try {
      const metrics = TrainingLogParser.parse({ filePath: full });
      return JSON.stringify({
        framework: metrics.framework,
        totalEpochs: metrics.metadata.totalEpochs,
        bestValLoss: metrics.metadata.bestValLoss,
        bestEpoch: metrics.metadata.bestEpoch,
        lastTrainLoss: metrics.trainLoss[metrics.trainLoss.length - 1],
        lastValLoss: metrics.valLoss?.[metrics.valLoss.length - 1],
      }, null, 2);
    } catch (err: any) {
      return `Parse failed: ${err.message}`;
    }
  }
}
