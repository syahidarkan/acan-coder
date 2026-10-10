import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { exec } from 'child_process';
import { promisify } from 'util';
import { parse as parseCsv } from 'csv-parse/sync';

const execAsync = promisify(exec);

interface ColInfo { name: string; type: 'numeric' | 'categorical' | 'datetime' | 'text'; }

class EdaGeneratorClass {
  async generate(csvPath: string): Promise<string> {
    const content = fs.readFileSync(csvPath, 'utf-8');
    // Read only first 5 rows for schema detection
    const rows = parseCsv(content, { columns: true, to: 5, skip_empty_lines: true }) as Record<string, string>[];
    if (!rows.length) throw new Error('CSV appears empty');

    const cols = this.inferColumnTypes(rows);
    const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath ?? path.dirname(csvPath);
    const edaDir = path.join(workspaceRoot, 'eda');
    fs.mkdirSync(edaDir, { recursive: true });

    const scriptPath = path.join(edaDir, 'eda_analysis.py');
    const script = this.buildScript(csvPath, cols);
    fs.writeFileSync(scriptPath, script, 'utf-8');

    vscode.window.showInformationMessage(`EDA script generated at eda/eda_analysis.py. Running...`);
    try {
      await execAsync(`python3 "${scriptPath}"`, { cwd: workspaceRoot });
      vscode.window.showInformationMessage('EDA complete. Check eda/ folder for outputs.');
    } catch (err: unknown) {
      vscode.window.showWarningMessage(`EDA run failed: ${(err as Error).message}. Script saved.`);
    }

    return scriptPath;
  }

  private inferColumnTypes(rows: Record<string, string>[]): ColInfo[] {
    const cols = Object.keys(rows[0]);
    return cols.map(name => {
      const vals = rows.map(r => r[name]).filter(v => v !== '' && v !== null);
      if (vals.every(v => !isNaN(Number(v)))) return { name, type: 'numeric' as const };
      if (vals.every(v => !isNaN(Date.parse(v)))) return { name, type: 'datetime' as const };
      if (vals.some(v => v.length > 50)) return { name, type: 'text' as const };
      return { name, type: 'categorical' as const };
    });
  }

  private buildScript(csvPath: string, cols: ColInfo[]): string {
    const numeric = cols.filter(c => c.type === 'numeric').map(c => `"${c.name}"`).join(', ');
    const categorical = cols.filter(c => c.type === 'categorical').map(c => `"${c.name}"`).join(', ');

    return `"""Auto-generated EDA script"""
import pandas as pd
import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import seaborn as sns
import os

OUTPUT_DIR = os.path.join(os.path.dirname(__file__), 'outputs')
os.makedirs(OUTPUT_DIR, exist_ok=True)

df = pd.read_csv(r"${csvPath}")
print("Shape:", df.shape)
print("\\nInfo:")
df.info()
print("\\nDescribe:")
print(df.describe())
print("\\nMissing values:")
print(df.isnull().sum())

numeric_cols = [${numeric}]
categorical_cols = [${categorical}]

# Missing values heatmap
if df.isnull().any().any():
    plt.figure(figsize=(12, 6))
    sns.heatmap(df.isnull(), cbar=False, yticklabels=False, cmap='viridis')
    plt.title('Missing Values Heatmap')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'missing_heatmap.png'), dpi=150)
    plt.close()

# Correlation matrix
if len(numeric_cols) > 1:
    plt.figure(figsize=(10, 8))
    corr = df[numeric_cols].corr()
    sns.heatmap(corr, annot=True, fmt='.2f', cmap='coolwarm', center=0)
    plt.title('Correlation Matrix')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, 'correlation.png'), dpi=150)
    plt.close()

# Distribution plots for numeric
for col in numeric_cols:
    fig, axes = plt.subplots(1, 2, figsize=(12, 4))
    df[col].hist(ax=axes[0], bins=30, color='#f59e0b', edgecolor='black', alpha=0.8)
    axes[0].set_title(f'{col} - Distribution')
    df.boxplot(column=col, ax=axes[1])
    axes[1].set_title(f'{col} - Box Plot')
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, f'dist_{col}.png'), dpi=150)
    plt.close()

# Value counts for categorical
for col in categorical_cols:
    vc = df[col].value_counts().head(20)
    plt.figure(figsize=(10, 4))
    vc.plot(kind='bar', color='#38bdf8', edgecolor='black', alpha=0.8)
    plt.title(f'{col} - Value Counts')
    plt.xticks(rotation=45)
    plt.tight_layout()
    plt.savefig(os.path.join(OUTPUT_DIR, f'vc_{col}.png'), dpi=150)
    plt.close()

# Outlier detection via IQR
outlier_report = {}
for col in numeric_cols:
    q1 = df[col].quantile(0.25)
    q3 = df[col].quantile(0.75)
    iqr = q3 - q1
    outliers = df[(df[col] < q1 - 1.5*iqr) | (df[col] > q3 + 1.5*iqr)]
    outlier_report[col] = len(outliers)
print("\\nOutlier counts (IQR):", outlier_report)
print("\\nEDA complete. Plots saved to", OUTPUT_DIR)
`;
  }
}

export const EdaGenerator = new EdaGeneratorClass();
