import Database from 'better-sqlite3';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { logger } from '../utils/logger';

const DB_DIR = path.join(os.homedir(), '.my-ai-coder');
const DB_PATH = path.join(DB_DIR, 'data.db');

export interface ConversationRow {
  sessionId: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  timestamp: number;
  tokenCount: number;
}

export interface SelectorMemoryRow {
  url: string;
  originalSelector: string;
  replacementSelector: string;
  timestamp: number;
  successCount: number;
}

export interface PromptTemplateRow {
  id: string;
  name: string;
  taskType: string;
  systemPromptAddition: string | null;
  userPromptPrefix: string | null;
  userPromptSuffix: string | null;
  usageCount: number;
  lastUsed: number | null;
}

class StateStoreClass {
  private db!: Database.Database;

  init() {
    if (!fs.existsSync(DB_DIR)) fs.mkdirSync(DB_DIR, { recursive: true });
    this.db = new Database(DB_PATH);
    this.db.pragma('journal_mode = WAL');
    this.runMigrations();
    logger.info('StateStore initialized at ' + DB_PATH);
  }

  private runMigrations() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS conversations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        sessionId TEXT NOT NULL,
        role TEXT NOT NULL,
        content TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        tokenCount INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS idx_conv_session ON conversations(sessionId);

      CREATE TABLE IF NOT EXISTS selector_memory (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT NOT NULL,
        originalSelector TEXT NOT NULL,
        replacementSelector TEXT NOT NULL,
        timestamp INTEGER NOT NULL,
        successCount INTEGER NOT NULL DEFAULT 1
      );

      CREATE TABLE IF NOT EXISTS prompt_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        taskType TEXT NOT NULL,
        systemPromptAddition TEXT,
        userPromptPrefix TEXT,
        userPromptSuffix TEXT,
        usageCount INTEGER NOT NULL DEFAULT 0,
        lastUsed INTEGER
      );

      CREATE TABLE IF NOT EXISTS api_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        provider TEXT NOT NULL,
        model TEXT NOT NULL,
        date TEXT NOT NULL,
        requestCount INTEGER NOT NULL DEFAULT 0,
        tokenCount INTEGER NOT NULL DEFAULT 0
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_api_usage ON api_usage(provider, model, date);

      CREATE TABLE IF NOT EXISTS tool_executions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        toolName TEXT NOT NULL,
        input TEXT NOT NULL,
        output TEXT NOT NULL,
        durationMs INTEGER NOT NULL DEFAULT 0,
        timestamp INTEGER NOT NULL
      );
    `);
  }

  // Conversations
  addMessage(sessionId: string, role: string, content: string, tokenCount: number) {
    this.db.prepare(
      'INSERT INTO conversations (sessionId, role, content, timestamp, tokenCount) VALUES (?, ?, ?, ?, ?)'
    ).run(sessionId, role, content, Date.now(), tokenCount);
  }

  getMessages(sessionId: string, limit = 50): ConversationRow[] {
    return this.db.prepare(
      'SELECT * FROM conversations WHERE sessionId = ? ORDER BY timestamp ASC LIMIT ?'
    ).all(sessionId, limit) as ConversationRow[];
  }

  clearSession(sessionId: string) {
    this.db.prepare('DELETE FROM conversations WHERE sessionId = ?').run(sessionId);
  }

  // Selector Memory
  rememberSelector(url: string, original: string, replacement: string) {
    const existing = this.db.prepare(
      'SELECT id, successCount FROM selector_memory WHERE url = ? AND originalSelector = ?'
    ).get(url, original) as { id: number; successCount: number } | undefined;

    if (existing) {
      this.db.prepare('UPDATE selector_memory SET replacementSelector = ?, successCount = successCount + 1, timestamp = ? WHERE id = ?')
        .run(replacement, Date.now(), existing.id);
    } else {
      this.db.prepare(
        'INSERT INTO selector_memory (url, originalSelector, replacementSelector, timestamp, successCount) VALUES (?, ?, ?, ?, 1)'
      ).run(url, original, replacement, Date.now());
    }
  }

  recallSelector(url: string, original: string): string | null {
    const row = this.db.prepare(
      'SELECT replacementSelector FROM selector_memory WHERE url = ? AND originalSelector = ? ORDER BY successCount DESC LIMIT 1'
    ).get(url, original) as { replacementSelector: string } | undefined;
    return row?.replacementSelector ?? null;
  }

  // Prompt Templates
  getTemplates(): PromptTemplateRow[] {
    return this.db.prepare('SELECT * FROM prompt_templates ORDER BY usageCount DESC').all() as PromptTemplateRow[];
  }

  getTemplate(id: string): PromptTemplateRow | null {
    return (this.db.prepare('SELECT * FROM prompt_templates WHERE id = ?').get(id) as PromptTemplateRow) ?? null;
  }

  saveTemplate(t: Omit<PromptTemplateRow, 'usageCount' | 'lastUsed'>) {
    this.db.prepare(
      'INSERT OR REPLACE INTO prompt_templates (id, name, taskType, systemPromptAddition, userPromptPrefix, userPromptSuffix, usageCount, lastUsed) VALUES (?, ?, ?, ?, ?, ?, 0, NULL)'
    ).run(t.id, t.name, t.taskType, t.systemPromptAddition ?? null, t.userPromptPrefix ?? null, t.userPromptSuffix ?? null);
  }

  deleteTemplate(id: string) {
    this.db.prepare('DELETE FROM prompt_templates WHERE id = ?').run(id);
  }

  incrementTemplateUsage(id: string) {
    this.db.prepare('UPDATE prompt_templates SET usageCount = usageCount + 1, lastUsed = ? WHERE id = ?')
      .run(Date.now(), id);
  }

  // API Usage
  recordApiUsage(provider: string, model: string, tokens: number) {
    const date = new Date().toISOString().slice(0, 10);
    this.db.prepare(`
      INSERT INTO api_usage (provider, model, date, requestCount, tokenCount) VALUES (?, ?, ?, 1, ?)
      ON CONFLICT(provider, model, date) DO UPDATE SET requestCount = requestCount + 1, tokenCount = tokenCount + ?
    `).run(provider, model, date, tokens, tokens);
  }

  getApiUsageToday(): Array<{ provider: string; model: string; requestCount: number; tokenCount: number }> {
    const date = new Date().toISOString().slice(0, 10);
    return this.db.prepare('SELECT provider, model, requestCount, tokenCount FROM api_usage WHERE date = ?').all(date) as Array<{ provider: string; model: string; requestCount: number; tokenCount: number }>;
  }

  // Tool Executions
  recordToolExecution(toolName: string, input: string, output: string, durationMs: number) {
    this.db.prepare(
      'INSERT INTO tool_executions (toolName, input, output, durationMs, timestamp) VALUES (?, ?, ?, ?, ?)'
    ).run(toolName, input, output, durationMs, Date.now());
  }
}

export const StateStore = new StateStoreClass();
