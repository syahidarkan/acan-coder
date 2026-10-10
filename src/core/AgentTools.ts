import * as fs from 'fs';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface ToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments: string;
  };
}

export interface ToolResult {
  tool_call_id: string;
  content: string;
}

export const AGENT_TOOLS = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute a bash command in the workspace directory. Use for git, npm, file operations, etc.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The bash command to run' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read the contents of a file',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write or overwrite a file with new content',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          content: { type: 'string', description: 'Content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files in a directory',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to workspace root (use "." for root)' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for text patterns in files (like grep)',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern' },
          directory: { type: 'string', description: 'Directory to search in (default: ".")' },
        },
        required: ['pattern'],
      },
    },
  },
];

export class ToolExecutor {
  private workspacePath: string;

  constructor(workspacePath: string) {
    this.workspacePath = workspacePath;
  }

  async execute(toolCall: ToolCall): Promise<string> {
    const args = JSON.parse(toolCall.function.arguments);
    const name = toolCall.function.name;

    try {
      switch (name) {
        case 'bash':
          return await this.runBash(args.command);
        case 'read_file':
          return this.readFile(args.path);
        case 'write_file':
          return this.writeFile(args.path, args.content);
        case 'list_files':
          return this.listFiles(args.path ?? '.');
        case 'search_files':
          return await this.searchFiles(args.pattern, args.directory ?? '.');
        default:
          return `Unknown tool: ${name}`;
      }
    } catch (err: any) {
      return `Error: ${err.message ?? String(err)}`;
    }
  }

  private async runBash(command: string): Promise<string> {
    const { stdout, stderr } = await execAsync(command, {
      cwd: this.workspacePath,
      timeout: 60_000,
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const out = stdout.trim();
    const err = stderr.trim();
    if (!out && !err) return '(no output)';
    if (!err) return out;
    if (!out) return `STDERR: ${err}`;
    return `${out}\n---\nSTDERR: ${err}`;
  }

  private readFile(relPath: string): string {
    const full = path.resolve(this.workspacePath, relPath);
    if (!full.startsWith(this.workspacePath)) return 'Error: path outside workspace';
    const content = fs.readFileSync(full, 'utf8');
    // Truncate very large files
    if (content.length > 20_000) return content.slice(0, 20_000) + '\n...[truncated]';
    return content;
  }

  private writeFile(relPath: string, content: string): string {
    const full = path.resolve(this.workspacePath, relPath);
    if (!full.startsWith(this.workspacePath)) return 'Error: path outside workspace';
    fs.mkdirSync(path.dirname(full), { recursive: true });
    fs.writeFileSync(full, content, 'utf8');
    return `Written: ${relPath}`;
  }

  private listFiles(relPath: string): string {
    const full = path.resolve(this.workspacePath, relPath);
    if (!full.startsWith(this.workspacePath)) return 'Error: path outside workspace';
    const entries = fs.readdirSync(full, { withFileTypes: true });
    return entries.map(e => `${e.isDirectory() ? 'DIR' : 'FILE'} ${e.name}`).join('\n');
  }

  private async searchFiles(pattern: string, relDir: string): Promise<string> {
    const full = path.resolve(this.workspacePath, relDir);
    const { stdout } = await execAsync(
      `grep -r --include="*.ts" --include="*.js" --include="*.json" --include="*.md" -l "${pattern}" . 2>/dev/null | head -20`,
      { cwd: full, timeout: 10_000 }
    );
    return stdout.trim() || '(no matches)';
  }
}
