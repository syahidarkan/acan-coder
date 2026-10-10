import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec, spawn } from 'child_process';
import { promisify } from 'util';
import { ApiRotator } from '../../core/ApiRotator';
import { logger } from '../../utils/logger';

const execAsync = promisify(exec);

export class RemotionPipeline {
  async createProject(name: string, targetFolder: string): Promise<void> {
    await vscode.window.withProgress(
      { location: vscode.ProgressLocation.Notification, title: 'Creating Remotion project...', cancellable: false },
      async () => {
        await execAsync(`npx create-video@latest ${name} --template blank --yes`, { cwd: targetFolder });
      }
    );
    vscode.window.showInformationMessage(`Remotion project created at ${path.join(targetFolder, name)}`);
  }

  async generateComposition(request: string, projectPath: string): Promise<string> {
    const result = await ApiRotator.callApi(
      'code_generation',
      [{
        role: 'user',
        content: `Generate a Remotion video composition. The video should: ${request}\n\nReturn ONLY the complete TypeScript component code for src/Composition.tsx.`,
      }],
      `You are generating a Remotion video composition in TypeScript.
Required imports: from 'remotion' import { AbsoluteFill, Sequence, useCurrentFrame, useVideoConfig, interpolate, spring }
Return ONLY the complete TypeScript component code for src/Composition.tsx.
Make it 30fps, 10 seconds duration by default.`
    );

    const compositionPath = path.join(projectPath, 'src', 'Composition.tsx');
    fs.mkdirSync(path.dirname(compositionPath), { recursive: true });
    fs.writeFileSync(compositionPath, result.content, 'utf-8');
    logger.info(`Composition written to ${compositionPath}`);
    return compositionPath;
  }

  async render(
    projectPath: string,
    outputPath: string,
    onProgress?: (pct: number, message: string) => void
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      const proc = spawn('npx', ['remotion', 'render', 'Composition', outputPath], {
        cwd: projectPath,
        shell: true,
      });

      proc.stdout.on('data', (data: Buffer) => {
        const text = data.toString();
        const match = text.match(/(\d+)\/(\d+)/);
        if (match) {
          const pct = Math.round((parseInt(match[1]) / parseInt(match[2])) * 100);
          onProgress?.(pct, `Frame ${match[1]}/${match[2]}`);
        }
        logger.debug('[remotion] ' + text.trim());
      });

      proc.stderr.on('data', (data: Buffer) => logger.warn('[remotion stderr] ' + data.toString().trim()));
      proc.on('close', code => {
        if (code === 0) resolve();
        else reject(new Error(`Remotion render exited with code ${code}`));
      });
    });
  }
}
