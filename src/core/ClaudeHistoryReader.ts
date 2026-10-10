import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { logger } from '../utils/logger';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface ProjectHistory {
  projectPath: string;
  sessionFile: string;
  messages: HistoryMessage[];
  lastModified: Date;
}

export class ClaudeHistoryReader {
  // Claude Code stores sessions at ~/.claude/projects/<encoded-path>/*.jsonl
  // Encoding: workspace path with / replaced by - (leading -)
  // e.g. /Users/acan/myproject → -Users-acan-myproject

  static encodePath(workspacePath: string): string {
    return workspacePath.replace(/\//g, '-');
  }

  static getProjectDir(workspacePath: string): string {
    const encoded = this.encodePath(workspacePath);
    return path.join(os.homedir(), '.claude', 'projects', encoded);
  }

  static readLatestSession(workspacePath: string, maxMessages = 30): ProjectHistory | null {
    try {
      const projectDir = this.getProjectDir(workspacePath);
      if (!fs.existsSync(projectDir)) return null;

      const files = fs.readdirSync(projectDir)
        .filter(f => f.endsWith('.jsonl'))
        .map(f => ({ name: f, mtime: fs.statSync(path.join(projectDir, f)).mtime }))
        .sort((a, b) => b.mtime.getTime() - a.mtime.getTime());

      if (files.length === 0) return null;

      const latest = files[0];
      const sessionFile = path.join(projectDir, latest.name);
      const messages = this.parseJsonl(sessionFile, maxMessages);

      return {
        projectPath: workspacePath,
        sessionFile,
        messages,
        lastModified: latest.mtime,
      };
    } catch (e) {
      logger.warn(`ClaudeHistoryReader: failed to read history for ${workspacePath}: ${e}`);
      return null;
    }
  }

  private static parseJsonl(filePath: string, maxMessages: number): HistoryMessage[] {
    const raw = fs.readFileSync(filePath, 'utf8');
    const lines = raw.trim().split('\n').filter(Boolean);
    const messages: HistoryMessage[] = [];

    for (const line of lines) {
      try {
        const entry = JSON.parse(line);
        // Claude Code format: {"type":"user"|"assistant", "message":{...}}
        const type = entry.type as string;
        if (type !== 'user' && type !== 'assistant') continue;

        const msg = entry.message ?? {};
        const rawContent = msg.content ?? '';
        let content = '';

        if (typeof rawContent === 'string') {
          content = rawContent;
        } else if (Array.isArray(rawContent)) {
          // content blocks: [{type:"text",text:"..."}]
          content = rawContent
            .filter((b: any) => b.type === 'text')
            .map((b: any) => b.text ?? '')
            .join('\n');
        }

        content = content.trim();
        if (content) {
          messages.push({ role: type as 'user' | 'assistant', content });
        }
      } catch {
        // skip malformed lines
      }
    }

    // Return last N messages for context
    return messages.slice(-maxMessages);
  }

  static buildContextSummary(history: ProjectHistory): string {
    const age = Math.round((Date.now() - history.lastModified.getTime()) / 60_000);
    const ageStr = age < 60 ? `${age} min ago` : `${Math.round(age / 60)}h ago`;
    const lines = [
      `[Previous session context from Claude Code — ${ageStr}]`,
      '',
    ];
    for (const m of history.messages) {
      const prefix = m.role === 'user' ? 'User' : 'Assistant';
      const snippet = m.content.length > 300 ? m.content.slice(0, 300) + '…' : m.content;
      lines.push(`${prefix}: ${snippet}`);
    }
    return lines.join('\n');
  }
}
