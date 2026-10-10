import { chromium, type Page } from 'playwright';
import { Readability } from '@mozilla/readability';
import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';
import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { estimateTokens } from '../../utils/tokenCounter';
import { ApiRotator } from '../../core/ApiRotator';
import { logger } from '../../utils/logger';

const MAX_OUTPUT_TOKENS = 8000;
const BLOCK_TYPES = ['image', 'media', 'font'];

export interface ScrapeResult {
  url: string;
  title: string;
  markdown: string;
  estimatedTokens: number;
  scrapedAt: Date;
}

export class UniversalScraper {
  private turndown = new TurndownService({
    headingStyle: 'atx',
    codeBlockStyle: 'fenced',
  });

  async scrape(url: string, _options?: { timeout?: number }): Promise<ScrapeResult> {
    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'] });
    const context = await browser.newContext();
    const page = await context.newPage();

    // Block non-essential resource types
    await page.route('**/*', route => {
      if (BLOCK_TYPES.includes(route.request().resourceType())) {
        return route.abort();
      }
      return route.continue();
    });

    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const html = await page.content();
      const title = await page.title();

      // Extract main content via Readability
      const dom = new JSDOM(html, { url });
      const reader = new Readability(dom.window.document);
      const article = reader.parse();
      const contentHtml = article?.content ?? html;

      // Convert to Markdown
      let markdown = this.turndown.turndown(contentHtml);

      const estimatedTokens = estimateTokens(markdown);
      if (estimatedTokens > MAX_OUTPUT_TOKENS) {
        const charLimit = MAX_OUTPUT_TOKENS * 4;
        markdown = markdown.slice(0, charLimit) + `\n\n[TRUNCATED - ${estimatedTokens} total tokens estimated]`;
      }

      return { url, title, markdown, estimatedTokens: Math.min(estimatedTokens, MAX_OUTPUT_TOKENS), scrapedAt: new Date() };
    } finally {
      await browser.close();
    }
  }

  async scrapeMultiple(urls: string[], concurrency = 3): Promise<ScrapeResult[]> {
    const results: ScrapeResult[] = [];
    const chunks: string[][] = [];
    for (let i = 0; i < urls.length; i += concurrency) {
      chunks.push(urls.slice(i, i + concurrency));
    }
    for (const chunk of chunks) {
      const chunkResults = await Promise.all(chunk.map(u => this.scrape(u).catch(e => {
        logger.error(`Scrape failed for ${u}`, e);
        return null;
      })));
      results.push(...chunkResults.filter(Boolean) as ScrapeResult[]);
    }
    return results;
  }

  async extractStructured(url: string, schema: object): Promise<unknown> {
    const scraped = await this.scrape(url);
    const result = await ApiRotator.callApi(
      'code_reasoning',
      [{
        role: 'user',
        content: `Extract structured data from this content according to the schema.\n\nSchema: ${JSON.stringify(schema)}\n\nContent:\n${scraped.markdown}`
      }]
    );
    try { return JSON.parse(result.content); }
    catch { return result.content; }
  }

  async saveCachedHtml(url: string): Promise<string> {
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
    const cacheDir = path.join(workspaceRoot, '.scraper-cache');
    fs.mkdirSync(cacheDir, { recursive: true });

    const urlHash = crypto.createHash('md5').update(url).digest('hex');
    const cachePath = path.join(cacheDir, `${urlHash}.html`);

    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();
    try {
      await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      const html = await page.content();
      fs.writeFileSync(cachePath, html, 'utf-8');
    } finally {
      await browser.close();
    }
    return cachePath;
  }
}
