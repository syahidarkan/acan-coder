import * as vscode from 'vscode';
import { EventBus } from '../core/EventBus';

interface CapturedError {
  message: string;
  source: string;
  timestamp: number;
}

class TerminalWatcherClass {
  private errors: CapturedError[] = [];
  private readonly MAX_ERRORS = 50;

  init(_context: vscode.ExtensionContext) {
    // onDidWriteTerminalData is a proposed API (terminalDataWriteEvent).
    // Avoid using it to keep the extension stable without enabledApiProposals.
    // Error capture is done passively via getRecentErrors() instead.
  }

  captureError(message: string) {
    const err: CapturedError = { message: message.trim().slice(0, 500), source: 'terminal', timestamp: Date.now() };
    this.errors.unshift(err);
    if (this.errors.length > this.MAX_ERRORS) this.errors.pop();
    EventBus.emit('terminal:error', err);
  }

  getRecentErrors(count = 10): CapturedError[] {
    return this.errors.slice(0, count);
  }
}

export const TerminalWatcher = new TerminalWatcherClass();
