import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import axios from 'axios';
import { ApiRotator } from '../../core/ApiRotator';
import { logger } from '../../utils/logger';

interface Asset {
  url: string;
  downloadUrl: string;
  credit: string;
  width: number;
  height: number;
  filename: string;
}

export class AssetRecovery {
  async searchUnsplash(query: string, count: number): Promise<Asset[]> {
    const key = await ApiRotator['getApiKey']('unsplash');
    if (!key) throw new Error('Unsplash key not set. Use AI Coder: Set API Key → unsplash');

    const resp = await axios.get('https://api.unsplash.com/search/photos', {
      params: { query, per_page: count, orientation: 'landscape' },
      headers: { Authorization: `Client-ID ${key}` },
    });

    return resp.data.results.map((r: Record<string, unknown>) => ({
      url: (r.urls as Record<string, string>).regular,
      downloadUrl: (r.links as Record<string, string>).download,
      credit: `Photo by ${(r.user as Record<string, Record<string, string>>).name.first} on Unsplash`,
      width: r.width as number,
      height: r.height as number,
      filename: `unsplash-${r.id}.jpg`,
    }));
  }

  async searchPexels(query: string, count: number): Promise<Asset[]> {
    const key = await ApiRotator['getApiKey']('pexels');
    if (!key) throw new Error('Pexels key not set.');

    const resp = await axios.get('https://api.pexels.com/v1/search', {
      params: { query, per_page: count },
      headers: { Authorization: key },
    });

    return resp.data.photos.map((p: Record<string, unknown>) => ({
      url: (p.src as Record<string, string>).large,
      downloadUrl: (p.src as Record<string, string>).original,
      credit: `Photo by ${p.photographer} on Pexels`,
      width: p.width as number,
      height: p.height as number,
      filename: `pexels-${p.id}.jpg`,
    }));
  }

  async fetchSvgIcon(name: string, source: 'lucide' | 'svgl'): Promise<string> {
    if (source === 'lucide') {
      const resp = await axios.get(
        `https://raw.githubusercontent.com/lucide-icons/lucide/main/icons/${name}.svg`
      );
      return resp.data as string;
    }
    // SVGL
    const search = await axios.get(`https://api.svgl.app/api?search=${encodeURIComponent(name)}`);
    const results = search.data as Array<{ svg: string }>;
    if (!results.length) throw new Error(`Icon '${name}' not found on SVGL`);
    const svgResp = await axios.get(results[0].svg);
    return svgResp.data as string;
  }

  async downloadAssets(assets: Asset[], targetFolder: string, onProgress?: (pct: number) => void): Promise<void> {
    const imagesDir = path.join(targetFolder, 'public', 'assets', 'images');
    const iconsDir = path.join(targetFolder, 'public', 'assets', 'icons');
    fs.mkdirSync(imagesDir, { recursive: true });
    fs.mkdirSync(iconsDir, { recursive: true });

    const total = assets.length;
    for (let i = 0; i < assets.length; i++) {
      const asset = assets[i];
      const dest = path.join(imagesDir, asset.filename);
      const resp = await axios.get(asset.downloadUrl, { responseType: 'stream' });
      await new Promise<void>((resolve, reject) => {
        const stream = fs.createWriteStream(dest);
        (resp.data as NodeJS.ReadableStream).pipe(stream);
        stream.on('finish', resolve);
        stream.on('error', reject);
      });
      onProgress?.(Math.round(((i + 1) / total) * 100));
    }

    // Generate index.ts
    const indexContent = assets
      .map(a => {
        const varName = a.filename.replace(/[^a-zA-Z0-9]/g, '_').replace(/^_/, '');
        return `export const ${varName} = '/assets/images/${a.filename}';`;
      })
      .join('\n');
    fs.writeFileSync(path.join(targetFolder, 'src', 'assets', 'index.ts'), indexContent, 'utf-8');
    logger.info(`Downloaded ${assets.length} assets to ${targetFolder}`);
  }
}

export async function runFetchAssets() {
  const recovery = new AssetRecovery();
  const type = await vscode.window.showQuickPick(['photo', 'icon', 'logo'], { placeHolder: 'Asset type' });
  if (!type) return;

  const query = await vscode.window.showInputBox({ prompt: 'Search query' });
  if (!query) return;

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? process.cwd();

  await vscode.window.withProgress(
    { location: vscode.ProgressLocation.Notification, title: `Fetching ${type}s...`, cancellable: false },
    async progress => {
      let assets: Asset[] = [];
      if (type === 'photo') {
        try { assets = await recovery.searchUnsplash(query, 5); }
        catch { assets = await recovery.searchPexels(query, 5); }
      }
      await recovery.downloadAssets(assets, workspaceRoot, pct => {
        progress.report({ increment: pct, message: `${pct}%` });
      });
      vscode.window.showInformationMessage(`Downloaded ${assets.length} assets.`);
    }
  );
}
