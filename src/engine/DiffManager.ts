import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export class DiffManager {
  static async showDiff(title: string, original: string, modified: string): Promise<void> {
    const tmpDir = os.tmpdir();
    const origPath = path.join(tmpDir, `mac-ai-original-${Date.now()}.ts`);
    const modPath = path.join(tmpDir, `mac-ai-modified-${Date.now()}.ts`);

    fs.writeFileSync(origPath, original, 'utf-8');
    fs.writeFileSync(modPath, modified, 'utf-8');

    const origUri = vscode.Uri.file(origPath);
    const modUri = vscode.Uri.file(modPath);

    await vscode.commands.executeCommand('vscode.diff', origUri, modUri, title);
  }

  static async applyEdit(filePath: string, newContent: string): Promise<void> {
    const uri = vscode.Uri.file(filePath);
    const edit = new vscode.WorkspaceEdit();
    const doc = await vscode.workspace.openTextDocument(uri);
    const fullRange = new vscode.Range(
      doc.lineAt(0).range.start,
      doc.lineAt(doc.lineCount - 1).range.end
    );
    edit.replace(uri, fullRange, newContent);
    await vscode.workspace.applyEdit(edit);
  }
}
