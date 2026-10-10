import * as vscode from 'vscode';
import * as os from 'os';
import * as http from 'http';
import { exec } from 'child_process';
import { promisify } from 'util';
import { EventBus, ExtensionEvents } from '../../core/EventBus';
import { StateStore } from '../../core/StateStore';
import { ScriptDaemon } from '../../engine/ScriptDaemon';
import { ApiRotator } from '../../core/ApiRotator';
import { AgenticLoop } from '../../core/AgenticLoop';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);
const HERMES_PORT = 3456;

type HermesIntent =
  | 'git_pull' | 'git_push' | 'git_status'
  | 'run_script' | 'get_errors' | 'get_status';

interface CommandBody {
  intent: HermesIntent;
  message?: string;
  scriptPath?: string;
}

class HermesClientClass {
  private server: http.Server | null = null;
  private secretStorage!: vscode.SecretStorage;

  init(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
  }

  async start(): Promise<void> {
    const tailscaleIp = this.getTailscaleIp();
    if (!tailscaleIp) {
      logger.warn('Hermes: No Tailscale IP found. Server not started.');
      return;
    }

    this.server = http.createServer(async (req, res) => {
      if (req.method !== 'POST' || req.url !== '/command') {
        res.writeHead(404);
        res.end();
        return;
      }

      // Auth check
      const token = req.headers['x-hermes-token'] as string | undefined;
      const validToken = await this.secretStorage.get('hermesToken');
      if (!token || token !== validToken) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Unauthorized' }));
        return;
      }

      // IP check — must be Tailscale range 100.x.x.x
      const ip = req.socket.remoteAddress ?? '';
      if (!ip.includes('100.')) {
        res.writeHead(403, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Only Tailscale connections allowed' }));
        return;
      }

      let body = '';
      req.on('data', chunk => { body += chunk; });
      req.on('end', async () => {
        try {
          const cmd = JSON.parse(body) as CommandBody;
          EventBus.emit(ExtensionEvents.HERMES_COMMAND_RECEIVED, cmd);
          const data = await this.handleCommand(cmd);
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data }));
          EventBus.emit(ExtensionEvents.HERMES_COMMAND_COMPLETED, { cmd, data });
        } catch (err: unknown) {
          res.writeHead(500, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: false, error: (err as Error).message }));
        }
      });
    });

    this.server.listen(HERMES_PORT, tailscaleIp, () => {
      logger.info(`Hermes listening on ${tailscaleIp}:${HERMES_PORT}`);
    });
  }

  stop() {
    this.server?.close();
    this.server = null;
  }

  private async handleCommand(cmd: CommandBody): Promise<unknown> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

    // Agentic intents — route through AgenticLoop so AI uses tools autonomously
    if (cmd.intent === 'git_push' || cmd.intent === 'git_pull' || cmd.intent === 'run_script') {
      const intentPrompts: Record<string, string> = {
        git_push: `Push semua perubahan ke remote. Commit message: "${cmd.message ?? 'Update from Telegram'}"`,
        git_pull: 'Pull perubahan terbaru dari remote.',
        run_script: `Jalankan script: ${cmd.scriptPath}`,
      };
      const loop = new AgenticLoop(workspaceRoot);
      const log: string[] = [];
      await loop.run(intentPrompts[cmd.intent], event => {
        if (event.type === 'tool_end' || event.type === 'final_answer') {
          log.push(event.content ?? '');
        }
      });
      return log.join('\n\n').trim() || 'Done';
    }

    // Non-agentic status queries
    switch (cmd.intent) {
      case 'git_status': {
        const { stdout } = await execAsync('git status --short', { cwd: workspaceRoot });
        return stdout.trim() || 'Working tree clean';
      }
      case 'get_errors': {
        return StateStore.getApiUsageToday().slice(0, 10);
      }
      case 'get_status': {
        return {
          queueStatus: ScriptDaemon.getQueueStatus(),
          tokenUsage: ApiRotator.getUsageStats(),
        };
      }
    }
  }

  private getTailscaleIp(): string | null {
    const ifaces = os.networkInterfaces();
    for (const iface of Object.values(ifaces)) {
      for (const addr of iface ?? []) {
        if (addr.family === 'IPv4' && addr.address.startsWith('100.')) {
          return addr.address;
        }
      }
    }
    return null;
  }
}

export const HermesClient = new HermesClientClass();
