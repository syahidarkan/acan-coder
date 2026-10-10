import * as vscode from 'vscode';

const channel = vscode.window.createOutputChannel('My AI Coder');
const isDev = process.env.NODE_ENV === 'development';

export const logger = {
  info: (msg: string, ...args: unknown[]) => {
    channel.appendLine(`[INFO] ${msg} ${args.length ? JSON.stringify(args) : ''}`);
  },
  warn: (msg: string, ...args: unknown[]) => {
    channel.appendLine(`[WARN] ${msg} ${args.length ? JSON.stringify(args) : ''}`);
  },
  error: (msg: string, err?: unknown) => {
    channel.appendLine(`[ERROR] ${msg} ${err instanceof Error ? err.message : String(err ?? '')}`);
    if (isDev && err instanceof Error) channel.appendLine(err.stack ?? '');
  },
  debug: (msg: string, ...args: unknown[]) => {
    if (!isDev) return;
    channel.appendLine(`[DEBUG] ${msg} ${args.length ? JSON.stringify(args) : ''}`);
  },
  show: () => channel.show(),
};
