import * as vscode from 'vscode';
import { ApiRotator } from './core/ApiRotator';
import { MemoryManager } from './core/MemoryManager';
import { StateStore } from './core/StateStore';
import { PromptTemplateLibrary } from './core/PromptTemplateLibrary';
import { DesignRulesEngine } from './modules/antiSlop/DesignRulesEngine';
import { ClickToClone } from './modules/antiSlop/ClickToClone';
import { runFetchAssets } from './modules/antiSlop/AssetRecovery';
import { UniversalScraper } from './modules/scraping/UniversalScraper';
import { SelfHealingEngine } from './modules/scraping/SelfHealingEngine';
import { TrainingLogParser } from './modules/mlDl/TrainingLogParser';
import { ChartRenderer } from './modules/mlDl/ChartRenderer';
import { VramProfiler } from './modules/mlDl/VramProfiler';
import { EdaGenerator } from './modules/mlDl/EdaGenerator';
import { PptxDslEngine } from './modules/media/PptxDslEngine';
import { RemotionPipeline } from './modules/media/RemotionPipeline';
import { HermesClient } from './modules/hermes/HermesClient';
import { ChatPanel } from './webview/ChatPanel';
import { TerminalWatcher } from './engine/TerminalWatcher';
import { ScriptDaemon } from './engine/ScriptDaemon';
import { logger } from './utils/logger';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';
import type { PptxDsl } from './modules/media/PptxDslEngine';

export async function activate(context: vscode.ExtensionContext) {
  logger.info('Acan Coder activating...');

  // --- Init singletons ---
  try { StateStore.init(); } catch (e) { vscode.window.showErrorMessage(`Acan Coder: StateStore failed – ${e}`); }
  try { ApiRotator.init(context.secrets); } catch (e) { vscode.window.showErrorMessage(`Acan Coder: ApiRotator failed – ${e}`); }
  try { PromptTemplateLibrary.init(); } catch (e) { vscode.window.showErrorMessage(`Acan Coder: PromptTemplateLibrary failed – ${e}`); }
  try { MemoryManager.setDesignRulesInjector(() => DesignRulesEngine.getSystemPromptLayer()); } catch (e) { /* non-critical */ }
  try { HermesClient.init(context.secrets); } catch (e) { /* non-critical */ }
  try { TerminalWatcher.init(context); } catch (e) { /* non-critical */ }

  const chatPanel = ChatPanel.getInstance(context.extensionUri);

  // --- Register commands ---

  // Open Chat
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.openChat', () => chatPanel.show())
  );

  // Set API Key
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.setApiKey', async () => {
      const providers = ['groq', 'sambanova', 'together', 'deepinfra', 'openrouter', 'gemini', 'unsplash', 'pexels'];
      const provider = await vscode.window.showQuickPick(providers, { placeHolder: 'Select provider' });
      if (!provider) return;
      const existing = await ApiRotator.getApiKeys(provider);

      const action = await vscode.window.showQuickPick(
        [
          { label: `➕ Add key (${existing.length} stored)`, action: 'add' },
          { label: `🗑  Clear all keys for ${provider}`, action: 'clear' },
        ],
        { placeHolder: `${provider} — choose action` }
      );
      if (!action) return;

      if (action.action === 'clear') {
        await ApiRotator.clearAllKeys(provider);
        vscode.window.showInformationMessage(`${provider}: all keys removed.`);
        return;
      }

      const key = await vscode.window.showInputBox({
        prompt: `Enter ${provider} API key`,
        placeHolder: 'Paste API key here',
        password: true,
      });
      if (!key) return;
      await ApiRotator.setApiKey(provider, key);
      const total = (await ApiRotator.getApiKeys(provider)).length;
      vscode.window.showInformationMessage(`${provider}: ${total} key tersimpan, akan dirotasi otomatis.`);
    })
  );

  // Add Design Rule
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.addDesignRule', async () => {
      const rule = await vscode.window.showInputBox({ prompt: 'Enter custom design rule' });
      if (rule) DesignRulesEngine.addCustomRule(rule);
    })
  );

  // Set Project Context
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.setProjectContext', async () => {
      const ctx = await vscode.window.showInputBox({
        prompt: 'Describe your project context',
        placeHolder: 'e.g. Next.js SaaS app, TypeScript, Tailwind, shadcn/ui, Supabase',
      });
      if (ctx) MemoryManager.setProjectContext(ctx);
    })
  );

  // Click to Clone
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.clickToClone', async () => {
      const cloner = new ClickToClone();
      await cloner.run().catch(err => vscode.window.showErrorMessage(err.message));
    })
  );

  // Fetch Assets
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.fetchAssets', runFetchAssets)
  );

  // Run Scraper
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.runScraper', async () => {
      const url = await vscode.window.showInputBox({ prompt: 'URL to scrape' });
      if (!url) return;
      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Scraping...', cancellable: false },
        async () => {
          const scraper = new UniversalScraper();
          const result = await scraper.scrape(url);
          const doc = await vscode.workspace.openTextDocument({ content: result.markdown, language: 'markdown' });
          await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
          vscode.window.showInformationMessage(`Scraped ${result.estimatedTokens} tokens from ${result.title}`);
        }
      );
    })
  );

  // Dry Run Scraper
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.dryRunScraper', async () => {
      const scriptUri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { TypeScript: ['ts'] } });
      if (!scriptUri?.[0]) return;

      const scraper = new UniversalScraper();
      const url = await vscode.window.showInputBox({ prompt: 'Target URL (leave blank to use cache)' });

      let cachePath: string | undefined;
      if (url) {
        cachePath = await scraper.saveCachedHtml(url);
        vscode.window.showInformationMessage(`HTML cached at ${cachePath}`);
      } else {
        const cacheUri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { HTML: ['html'] } });
        cachePath = cacheUri?.[0]?.fsPath;
      }
      if (!cachePath) return;

      const engine = new SelfHealingEngine();
      const scriptModule = await import(scriptUri[0].fsPath);
      const fn = scriptModule.default ?? Object.values(scriptModule)[0];
      if (typeof fn !== 'function') {
        vscode.window.showErrorMessage('Script must export a default function(page)');
        return;
      }
      const result = await engine.dryRun(fn as Parameters<typeof engine.dryRun>[0], cachePath);
      const out = vscode.window.createOutputChannel('Acan Coder - Dry Run');
      out.appendLine(result.success ? '✅ Dry run passed!' : `❌ ${result.errors.length} error(s):`);
      result.errors.forEach(e => out.appendLine(`  - ${e.selector}: ${e.message}`));
      out.appendLine(`Time: ${result.executionTimeMs}ms`);
      out.show();
    })
  );

  // View Training Log
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.viewTrainingLog', async () => {
      const fileUri = await vscode.window.showOpenDialog({
        canSelectMany: false,
        filters: { 'Log files': ['json', 'csv', 'txt', 'log'] },
      });
      if (!fileUri?.[0]) return;

      const metrics = TrainingLogParser.parse({ filePath: fileUri[0].fsPath });
      const panel = vscode.window.createWebviewPanel(
        'trainingLog',
        `Training: ${path.basename(fileUri[0].fsPath)}`,
        vscode.ViewColumn.Beside,
        { enableScripts: true }
      );
      const renderer = new ChartRenderer();
      renderer.renderInWebview(metrics, panel);
    })
  );

  // Generate EDA
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.generateEda', async () => {
      const fileUri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { CSV: ['csv'] } });
      if (!fileUri?.[0]) return;
      await EdaGenerator.generate(fileUri[0].fsPath).catch(e => vscode.window.showErrorMessage(e.message));
    })
  );

  // Create Presentation
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.createPresentation', async () => {
      const topic = await vscode.window.showInputBox({ prompt: 'Presentation topic' });
      if (!topic) return;
      const slideCountStr = await vscode.window.showInputBox({ prompt: 'Number of slides', value: '10' });
      const slideCount = parseInt(slideCountStr ?? '10') || 10;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Generating presentation...', cancellable: false },
        async progress => {
          progress.report({ message: 'Asking AI...' });

          const pptxDslSchema = `{"title": "string", "theme": "dark|light|minimal", "slides": [{"type": "title|bullets|two-col|divider|code", ...}]}`;
          const result = await ApiRotator.callApi(
            'code_generation',
            [{ role: 'user', content: `Create a presentation about: ${topic}\nReturn ONLY valid JSON sesuai PptxDsl schema:\n${pptxDslSchema}\nGunakan maksimal ${slideCount} slides. Konten padat, professional.` }]
          );

          let dsl: PptxDsl;
          try {
            const jsonMatch = result.content.match(/\{[\s\S]+\}/);
            dsl = JSON.parse(jsonMatch?.[0] ?? result.content);
          } catch {
            vscode.window.showErrorMessage('AI returned invalid JSON for presentation');
            return;
          }

          const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();
          const outputPath = path.join(workspaceRoot, `${topic.replace(/\s+/g, '_').slice(0, 30)}.pptx`);

          progress.report({ message: 'Rendering slides...' });
          await ScriptDaemon.submitWithProgress({
            id: uuidv4(),
            type: 'render_pptx',
            payload: { dsl, outputPath },
            priority: 'normal',
            onProgress: (pct, msg) => progress.report({ increment: pct, message: msg }),
          });

          vscode.window.showInformationMessage(`Presentation saved: ${outputPath}`);
          await vscode.env.openExternal(vscode.Uri.file(outputPath));
        }
      );
    })
  );

  // Create Video
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.createVideo', async () => {
      const remotion = new RemotionPipeline();
      const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

      const name = await vscode.window.showInputBox({ prompt: 'Project name', value: 'my-video' });
      if (!name) return;

      const description = await vscode.window.showInputBox({ prompt: 'Describe the video content' });
      if (!description) return;

      const confirm = await vscode.window.showQuickPick(['Yes, render now', 'Just generate composition'], { placeHolder: 'Render video?' });

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Creating video...', cancellable: false },
        async progress => {
          progress.report({ message: 'Scaffolding Remotion project...' });
          await remotion.createProject(name, workspaceRoot);
          const projectPath = path.join(workspaceRoot, name);

          progress.report({ message: 'Generating composition...' });
          await remotion.generateComposition(description, projectPath);

          if (confirm === 'Yes, render now') {
            const outputPath = path.join(workspaceRoot, `${name}.mp4`);
            await remotion.render(projectPath, outputPath, (pct, msg) => progress.report({ increment: 1, message: msg }));
            vscode.window.showInformationMessage(`Video saved: ${outputPath}`);
            await vscode.env.openExternal(vscode.Uri.file(workspaceRoot));
          } else {
            vscode.window.showInformationMessage(`Composition written. Open ${name}/ to preview.`);
          }
        }
      );
    })
  );

  // Use Prompt Template
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.useTemplate', async () => {
      const templates = PromptTemplateLibrary.list();
      const picked = await vscode.window.showQuickPick(
        templates.map(t => ({ label: t.name, description: t.taskType, id: t.id })),
        { placeHolder: 'Select template' }
      );
      if (!picked) return;
      PromptTemplateLibrary.incrementUsage(picked.id);
      vscode.window.showInformationMessage(`Template "${picked.label}" will be applied to your next message.`);
    })
  );

  // Save Current as Template
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.saveCurrentAsTemplate', async () => {
      const name = await vscode.window.showInputBox({ prompt: 'Template name' });
      if (!name) return;
      const taskTypes = ['chat_simple', 'code_generation', 'code_reasoning', 'ui_generation', 'intent_parse'];
      const taskType = await vscode.window.showQuickPick(taskTypes, { placeHolder: 'Task type' });
      if (!taskType) return;
      const suffix = await vscode.window.showInputBox({ prompt: 'User prompt suffix (optional)' });
      const id = PromptTemplateLibrary.save({ name, taskType, systemPromptAddition: null, userPromptPrefix: null, userPromptSuffix: suffix || null });
      vscode.window.showInformationMessage(`Template saved with ID: ${id}`);
    })
  );

  // Manage Templates (simple output channel view)
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.manageTemplates', () => {
      const templates = PromptTemplateLibrary.list();
      const out = vscode.window.createOutputChannel('Acan Coder - Templates');
      out.clear();
      templates.forEach(t => {
        out.appendLine(`[${t.id.slice(0, 8)}] ${t.name} (${t.taskType}) — used ${t.usageCount}x`);
        if (t.userPromptSuffix) out.appendLine(`  suffix: ${t.userPromptSuffix}`);
      });
      out.show();
    })
  );

  // Hermes Status
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.hermesStatus', async () => {
      const startHermes = await vscode.window.showQuickPick(['Start Hermes server', 'Stop Hermes server'], { placeHolder: 'Hermes Control' });
      if (startHermes === 'Start Hermes server') {
        await HermesClient.start().catch(e => vscode.window.showErrorMessage(e.message));
        vscode.window.showInformationMessage('Hermes server started on Tailscale interface.');
      } else if (startHermes === 'Stop Hermes server') {
        HermesClient.stop();
        vscode.window.showInformationMessage('Hermes server stopped.');
      }
    })
  );

  // VRAM Profiler (bonus command)
  context.subscriptions.push(
    vscode.commands.registerCommand('my-ai-coder.profileVram', async () => {
      const fileUri = await vscode.window.showOpenDialog({ canSelectMany: false, filters: { Python: ['py'] } });
      if (!fileUri?.[0]) return;

      await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Estimating VRAM...', cancellable: false },
        async () => {
          const estimate = await VramProfiler.profileFromFile(fileUri[0].fsPath);
          const gpuVram = await VramProfiler.detectGpuVram();
          const out = vscode.window.createOutputChannel('Acan Coder - VRAM Profiler');
          out.clear();
          out.appendLine(`Total: ${estimate.totalGB} GB (GPU detected: ${gpuVram} GB)`);
          out.appendLine(`Model: ${estimate.breakdown.model} GB`);
          out.appendLine(`Gradients: ${estimate.breakdown.gradients} GB`);
          out.appendLine(`Optimizer: ${estimate.breakdown.optimizer} GB`);
          out.appendLine(`Activations: ${estimate.breakdown.activations} GB`);
          out.appendLine(`Buffer (20%): ${estimate.breakdown.buffer} GB`);
          if (estimate.warnings.length) out.appendLine(`\nWarnings:\n${estimate.warnings.map(w => '⚠ ' + w).join('\n')}`);
          if (estimate.recommendations.length) out.appendLine(`\nRecommendations:\n${estimate.recommendations.map(r => '→ ' + r).join('\n')}`);
          out.show();
        }
      );
    })
  );

  // Auto-import keys from file if exists
  const importFile = path.join(require('os').homedir(), '.my-ai-coder', 'api-keys-import.json');
  if (require('fs').existsSync(importFile)) {
    try {
      const raw = require('fs').readFileSync(importFile, 'utf8');
      const map: Record<string, string | string[]> = JSON.parse(raw);
      for (const [provider, keys] of Object.entries(map)) {
        const list = Array.isArray(keys) ? keys : [keys];
        for (const k of list) await ApiRotator.setApiKey(provider, k as string);
      }
      require('fs').unlinkSync(importFile);
      vscode.window.showInformationMessage('Acan Coder: API keys imported successfully!');
    } catch (e) {
      vscode.window.showWarningMessage(`Acan Coder: Failed to import keys – ${e}`);
    }
  }

  logger.info('Acan Coder activated. All commands registered.');
}

export function deactivate() {
  HermesClient.stop();
  logger.info('Acan Coder deactivated.');
}
