import { chromium, type Page } from 'playwright';
import * as fs from 'fs';
import { SelectorMemory } from './SelectorMemory';
import { ApiRotator } from '../../core/ApiRotator';
import { EventBus, ExtensionEvents } from '../../core/EventBus';
import { logger } from '../../utils/logger';

type ScraperState = 'IDLE' | 'RUNNING' | 'ERROR_CAUGHT' | 'AI_HEALING' | 'RETRYING' | 'COMPLETE' | 'FAILED';

interface SelectorError {
  selector: string;
  message: string;
}

export interface DryRunResult {
  success: boolean;
  errors: SelectorError[];
  executionTimeMs: number;
}

export class SelfHealingEngine {
  private state: ScraperState = 'IDLE';
  private retryCount = 0;
  private readonly MAX_RETRIES = 3;
  private memory = new SelectorMemory();

  async runWithHealing<T>(
    scraperFn: (page: Page) => Promise<T>,
    targetUrl: string
  ): Promise<T> {
    this.state = 'IDLE';
    this.retryCount = 0;

    const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
    const page = await browser.newPage();

    try {
      await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      return await this.attempt(scraperFn, page, targetUrl);
    } finally {
      await browser.close();
    }
  }

  private async attempt<T>(
    scraperFn: (page: Page) => Promise<T>,
    page: Page,
    targetUrl: string
  ): Promise<T> {
    this.state = 'RUNNING';

    while (this.retryCount <= this.MAX_RETRIES) {
      try {
        const result = await scraperFn(page);
        this.state = 'COMPLETE';
        return result;
      } catch (err: unknown) {
        const e = err as Error;
        this.state = 'ERROR_CAUGHT';
        logger.warn(`Scraper error (attempt ${this.retryCount + 1}): ${e.message}`);

        // Extract selector from error message
        const selectorMatch = e.message.match(/["']([^"']+)["']/);
        const brokenSelector = selectorMatch?.[1] ?? '';

        if (brokenSelector) {
          // Check memory first (0 token)
          const remembered = this.memory.recall(targetUrl, brokenSelector);
          if (remembered) {
            logger.info(`Memory hit: replacing ${brokenSelector} with ${remembered}`);
            scraperFn = this.patchSelector(scraperFn, brokenSelector, remembered);
            this.state = 'RETRYING';
            this.retryCount++;
            continue;
          }
        }

        if (this.retryCount >= this.MAX_RETRIES) break;

        // Ask AI for healing
        this.state = 'AI_HEALING';
        const healed = await this.healWithAI(page, brokenSelector, targetUrl);
        if (healed) {
          scraperFn = this.patchSelector(scraperFn, brokenSelector, healed);
          this.state = 'RETRYING';
          this.retryCount++;
          continue;
        }

        this.retryCount++;
      }
    }

    this.state = 'FAILED';
    EventBus.emit(ExtensionEvents.SCRIPT_HUMAN_NEEDED, {
      url: targetUrl,
      retries: this.retryCount,
      message: 'Scraper failed after max retries. Manual intervention needed.',
    });
    throw new Error(`Scraping failed after ${this.MAX_RETRIES} retries on ${targetUrl}`);
  }

  private async healWithAI(page: Page, brokenSelector: string, url: string): Promise<string | null> {
    try {
      // Get minimal DOM context around the broken selector
      // page.evaluate runs in browser context — document is available there
      const domContext = await page.evaluate(() => (globalThis as unknown as { document: Document }).document.body.innerHTML.slice(0, 3000));
      const result = await ApiRotator.callApi(
        'code_reasoning',
        [{
          role: 'user',
          content: `This Playwright selector failed: "${brokenSelector}"\n\nHere is the current DOM around that area:\n${domContext}\n\nReturn ONLY the corrected CSS selector as plain text, nothing else.`
        }]
      );
      const newSelector = result.content.trim().replace(/^["']|["']$/g, '');
      if (newSelector) {
        this.memory.remember(url, brokenSelector, newSelector);
        logger.info(`AI healed selector: ${brokenSelector} → ${newSelector}`);
        return newSelector;
      }
    } catch (err) {
      logger.error('AI healing failed', err);
    }
    return null;
  }

  private patchSelector<T>(fn: (page: Page) => Promise<T>, from: string, to: string): (page: Page) => Promise<T> {
    const src = fn.toString().replace(new RegExp(escapeRegex(from), 'g'), to);
    // eslint-disable-next-line no-new-func
    return new Function('page', `return (${src})(page)`) as (page: Page) => Promise<T>;
  }

  async dryRun(scraperFn: (page: Page) => Promise<unknown>, cachedHtmlPath: string): Promise<DryRunResult> {
    const start = Date.now();
    const errors: SelectorError[] = [];

    const html = fs.readFileSync(cachedHtmlPath, 'utf-8');
    const browser = await chromium.launch({ headless: true });
    const page = await browser.newPage();

    try {
      await page.setContent(html);
      await scraperFn(page);
    } catch (err: unknown) {
      const e = err as Error;
      const selectorMatch = e.message.match(/["']([^"']+)["']/);
      errors.push({ selector: selectorMatch?.[1] ?? 'unknown', message: e.message });
    } finally {
      await browser.close();
    }

    return { success: errors.length === 0, errors, executionTimeMs: Date.now() - start };
  }
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
