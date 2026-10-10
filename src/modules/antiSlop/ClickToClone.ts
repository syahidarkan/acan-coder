import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { chromium } from 'playwright';
import { ApiRotator } from '../../core/ApiRotator';
import { MemoryManager } from '../../core/MemoryManager';
import { logger } from '../../utils/logger';

const { diffFromDefaults } = require('../../../scripts/cssDiffer');

interface ClonePayload {
  tag: string;
  classes: string[];
  textContent: string;
  html: string;
  computedStyles: Record<string, string>;
  children: Array<{ tag: string; classes: string[]; computedStyles: Record<string, string> }>;
}

export class ClickToClone {
  private inspectorScript = fs.readFileSync(
    path.join(__dirname, '../../../scripts/browserInspector.js'),
    'utf-8'
  );

  async run(): Promise<void> {
    vscode.window.showInformationMessage('Click any element in your browser to clone it as a React component.');

    let browser;
    try {
      browser = await chromium.connectOverCDP('http://localhost:9222');
    } catch {
      vscode.window.showErrorMessage(
        'Cannot connect to Chrome. Launch Chrome with: google-chrome --remote-debugging-port=9222'
      );
      return;
    }

    const pages = browser.contexts()[0]?.pages() ?? [];
    const page = pages[0];
    if (!page) {
      vscode.window.showErrorMessage('No open page found in Chrome.');
      return;
    }

    // Inject inspector script
    await page.evaluate(this.inspectorScript);

    // Poll for data with 30s timeout
    const data = await page.waitForFunction(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      () => (globalThis as any).__AI_CODER_CLONE_DATA__,
      { timeout: 30_000 }
    ).then(handle => handle.jsonValue()) as ClonePayload;

    const component = await this.extractAndSendToAI(data);
    await this.showResult(component);
  }

  private async extractAndSendToAI(raw: ClonePayload): Promise<string> {
    // Diff CSS against browser defaults to reduce payload
    const significantStyles = diffFromDefaults(raw.computedStyles);
    const childrenMinimal = raw.children.map(c => ({
      tag: c.tag,
      classes: c.classes,
      styles: diffFromDefaults(c.computedStyles),
    }));

    const minimalPayload = {
      tag: raw.tag,
      classes: raw.classes,
      textContent: raw.textContent,
      significantStyles,
      children: childrenMinimal,
    };

    const ctx = MemoryManager.buildContext('click-to-clone', 'ui_generation');
    const result = await ApiRotator.callApi(
      'ui_generation',
      [{
        role: 'user',
        content: `Convert this DOM structure to a clean React component using Tailwind CSS v4.\n\nExtract semantic meaning, don't copy styles verbatim. Make it production-ready.\n\nDOM:\n${JSON.stringify(minimalPayload, null, 2)}`
      }],
      ctx.systemPrompt
    );
    return result.content;
  }

  private async showResult(code: string) {
    const panel = vscode.window.createWebviewPanel(
      'clickToClone',
      'Cloned Component',
      vscode.ViewColumn.Beside,
      { enableScripts: false }
    );
    panel.webview.html = `<!DOCTYPE html><html><body><pre style="font-family:monospace;font-size:13px;padding:16px;white-space:pre-wrap">${escapeHtml(code)}</pre></body></html>`;
  }
}

function escapeHtml(s: string) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}
