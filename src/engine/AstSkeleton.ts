import { Project, SyntaxKind } from 'ts-morph';
import * as fs from 'fs';

export async function extractSkeleton(filePath: string): Promise<string> {
  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFileAtPath(filePath);
  const sourceFile = project.getSourceFileOrThrow(filePath);

  const lines: string[] = [];

  // Imports
  for (const imp of sourceFile.getImportDeclarations()) {
    lines.push(imp.getText());
  }
  lines.push('');

  // Interfaces and type aliases (full)
  for (const iface of sourceFile.getInterfaces()) {
    lines.push(iface.getText());
    lines.push('');
  }
  for (const ta of sourceFile.getTypeAliases()) {
    lines.push(ta.getText());
    lines.push('');
  }

  // Functions (signature only)
  for (const fn of sourceFile.getFunctions()) {
    const jsdoc = fn.getJsDocs().map(d => d.getText()).join('\n');
    if (jsdoc) lines.push(jsdoc);
    const sig = fn.getText().replace(/\{[\s\S]*\}$/, '{ /* ... implementation hidden */ }');
    lines.push(sig);
    lines.push('');
  }

  // Classes (method signatures only)
  for (const cls of sourceFile.getClasses()) {
    const clsLines: string[] = [];
    clsLines.push(`class ${cls.getName() ?? 'Anonymous'} {`);
    for (const method of cls.getMethods()) {
      const jsdoc = method.getJsDocs().map(d => d.getText()).join('\n');
      if (jsdoc) clsLines.push('  ' + jsdoc);
      const params = method.getParameters().map(p => p.getText()).join(', ');
      const returnType = method.getReturnTypeNode()?.getText() ?? '';
      const mods = method.getModifiers().map(m => m.getText()).join(' ');
      clsLines.push(`  ${mods} ${method.getName()}(${params})${returnType ? ': ' + returnType : ''} { /* ... */ }`);
    }
    clsLines.push('}');
    lines.push(clsLines.join('\n'));
    lines.push('');
  }

  // Exports
  for (const exp of sourceFile.getExportDeclarations()) {
    lines.push(exp.getText());
  }

  return lines.join('\n');
}

export function extractFileSection(filePath: string, startLine: number, endLine: number): string {
  const content = fs.readFileSync(filePath, 'utf-8');
  return content.split('\n').slice(startLine - 1, endLine).join('\n');
}

export interface DependencyNode {
  filePath: string;
  imports: DependencyNode[];
}

export async function buildDependencyGraph(entryFile: string, visited = new Set<string>()): Promise<DependencyNode> {
  if (visited.has(entryFile)) return { filePath: entryFile, imports: [] };
  visited.add(entryFile);

  const project = new Project({ skipAddingFilesFromTsConfig: true });
  project.addSourceFileAtPath(entryFile);
  const sourceFile = project.getSourceFileOrThrow(entryFile);

  const imports: DependencyNode[] = [];
  for (const imp of sourceFile.getImportDeclarations()) {
    const resolved = imp.getModuleSpecifierSourceFile();
    if (resolved) {
      imports.push(await buildDependencyGraph(resolved.getFilePath(), visited));
    }
  }

  return { filePath: entryFile, imports };
}
