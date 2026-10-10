import * as vscode from 'vscode';
import { ApiRotator } from '../core/ApiRotator';
import { AgenticLoop } from '../core/AgenticLoop';
import { ClaudeHistoryReader } from '../core/ClaudeHistoryReader';
import { MemoryManager } from '../core/MemoryManager';
import { v4 as uuidv4 } from 'uuid';

export class ChatPanel {
  private static instance: ChatPanel | undefined;
  private panel: vscode.WebviewPanel | undefined;
  private readonly extensionUri: vscode.Uri;
  private usageInterval: NodeJS.Timeout | undefined;
  private agentLoop: AgenticLoop | null = null;
  private isRunning = false;

  constructor(extensionUri: vscode.Uri) {
    this.extensionUri = extensionUri;
  }

  static getInstance(extensionUri: vscode.Uri): ChatPanel {
    if (!ChatPanel.instance) ChatPanel.instance = new ChatPanel(extensionUri);
    return ChatPanel.instance;
  }

  show() {
    if (this.panel) {
      this.panel.reveal();
      return;
    }

    this.panel = vscode.window.createWebviewPanel(
      'myAiCoder',
      'Acan Coder',
      vscode.ViewColumn.Two,
      {
        enableScripts: true,
        localResourceRoots: [vscode.Uri.joinPath(this.extensionUri, 'resources')],
        retainContextWhenHidden: true,
      }
    );

    this.panel.webview.html = this.buildHtml();
    this.panel.onDidDispose(() => {
      this.panel = undefined;
      if (this.usageInterval) clearInterval(this.usageInterval);
    });

    this.panel.webview.onDidReceiveMessage(async msg => {
      if (msg.type === 'webview_ready') {
        ApiRotator.getUsageStatsAsync().then(stats => {
          this.send('usage_update', stats);
        });
        this.loadProjectHistory();
        this.initAgentLoop();
      }
      if (msg.type === 'chat_send' && !this.isRunning) {
        await this.runAgent(msg.data.content);
      }
    });

    this.usageInterval = setInterval(async () => {
      this.send('usage_update', await ApiRotator.getUsageStatsAsync());
    }, 5000);
  }

  private initAgentLoop() {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    this.agentLoop = new AgenticLoop(workspacePath);
  }

  private async runAgent(userMessage: string) {
    if (!this.agentLoop) this.initAgentLoop();
    this.isRunning = true;
    this.send('agent_start', {});

    await this.agentLoop!.run(userMessage, event => {
      switch (event.type) {
        case 'thinking':
          // AI text before/between tool calls
          if (event.content?.trim()) {
            this.send('chat_message', { role: 'assistant', content: event.content });
          }
          break;
        case 'tool_start':
          this.send('tool_start', {
            id: event.toolId,
            name: event.toolName,
            input: event.toolInput,
          });
          break;
        case 'tool_end':
          this.send('tool_end', {
            id: event.toolId,
            name: event.toolName,
            output: event.content,
            success: true,
          });
          break;
        case 'tool_error':
          this.send('tool_end', {
            id: event.toolId,
            name: event.toolName,
            output: event.content,
            success: false,
          });
          break;
        case 'final_answer':
          this.send('chat_message', { role: 'assistant', content: event.content });
          break;
        case 'error':
          this.send('chat_message', { role: 'assistant', content: `Error: ${event.content}` });
          break;
      }
    });

    this.isRunning = false;
    this.send('agent_done', {});
    // Refresh usage stats after run
    ApiRotator.getUsageStatsAsync().then(stats => this.send('usage_update', stats));
  }

  private loadProjectHistory() {
    const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspacePath) return;

    const history = ClaudeHistoryReader.readLatestSession(workspacePath, 40);
    if (!history) return;

    MemoryManager.setProjectContext(ClaudeHistoryReader.buildContextSummary(history));

    const age = Math.round((Date.now() - history.lastModified.getTime()) / 60_000);
    const ageStr = age < 60 ? `${age} menit lalu` : `${Math.round(age / 60)} jam lalu`;

    this.send('history_loaded', {
      messages: history.messages,
      sessionFile: history.sessionFile,
      age: ageStr,
      project: workspacePath.split('/').pop(),
    });
  }

  private send(type: string, data: unknown) {
    this.panel?.webview.postMessage({ type, data });
  }

  private buildHtml(): string {
    const webviewUri = this.panel!.webview.asWebviewUri(
      vscode.Uri.joinPath(this.extensionUri, 'resources', 'webview', 'app.js')
    );
    const nonce = uuidv4().replace(/-/g, '');
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'nonce-${nonce}'; style-src 'unsafe-inline';">
  <title>Acan Coder</title>
  <style>
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html, body, #root { height: 100%; background: #09090b; color: #e4e4e7; }
    body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif; }
  </style>
</head>
<body>
  <div id="root"></div>
  <script nonce="${nonce}" src="${webviewUri}"></script>
</body>
</html>`;
  }
}
