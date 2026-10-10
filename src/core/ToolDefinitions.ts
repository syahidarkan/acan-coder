export interface ToolDefinition {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: {
      type: 'object';
      properties: Record<string, { type: string; description: string; enum?: string[] }>;
      required: string[];
    };
  };
}

export const TOOL_DEFINITIONS: ToolDefinition[] = [
  {
    type: 'function',
    function: {
      name: 'bash',
      description: 'Execute any shell command in the workspace root directory. Use for: running npm/yarn/pnpm, git operations, building projects, installing packages, running tests, checking file system, etc. Always prefer this over explaining commands to the user.',
      parameters: {
        type: 'object',
        properties: {
          command: { type: 'string', description: 'The shell command to execute. Can be multi-line with && or ;' },
        },
        required: ['command'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a file\'s contents. For files > 500 lines, returns a skeleton (class/function signatures) to save tokens — then use read_file_section for specific line ranges.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root (e.g. "src/index.ts")' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Create or completely overwrite a file with new content. Parent directories are created automatically.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          content: { type: 'string', description: 'Full file content to write' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file_section',
      description: 'Read a specific section of a file by line range. Use after read_file shows a skeleton and you need the actual implementation.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'File path relative to workspace root' },
          start_line: { type: 'string', description: 'Starting line number (1-indexed)' },
          end_line: { type: 'string', description: 'Ending line number (inclusive)' },
        },
        required: ['path', 'start_line', 'end_line'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'list_files',
      description: 'List files and directories recursively (max 3 levels deep). Skips node_modules, .git, dist, .next, build.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string', description: 'Directory path relative to workspace root. Use "." for root.' },
        },
        required: ['path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'search_files',
      description: 'Search for text patterns across the project files using grep. Returns matching lines with file paths and line numbers.',
      parameters: {
        type: 'object',
        properties: {
          pattern: { type: 'string', description: 'Search pattern (grep regex)' },
          path: { type: 'string', description: 'Directory to search in (default: ".")' },
          file_pattern: { type: 'string', description: 'File glob pattern (default: "*" = all files). Examples: "*.ts", "*.json"' },
        },
        required: ['pattern'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'git_operation',
      description: 'Execute git commands safely. Supports: status, log, add, commit, push, pull, diff, branch, checkout, stash.',
      parameters: {
        type: 'object',
        properties: {
          operation: {
            type: 'string',
            description: 'Git subcommand',
            enum: ['status', 'log', 'add', 'commit', 'push', 'pull', 'diff', 'branch', 'checkout', 'stash', 'remote', 'init', 'clone'],
          },
          args: { type: 'string', description: 'Additional arguments (e.g. "-m \\"message\\"" for commit, "--all" for add)' },
        },
        required: ['operation'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'scrape_url',
      description: 'Scrape a webpage and return its content as Markdown. Useful for reading documentation, APIs, or any web content.',
      parameters: {
        type: 'object',
        properties: {
          url: { type: 'string', description: 'Full URL to scrape (must start with http:// or https://)' },
        },
        required: ['url'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: 'Execute a Python script or inline Python code. Use for data processing, ML tasks, calculations.',
      parameters: {
        type: 'object',
        properties: {
          code: { type: 'string', description: 'Python code to execute (inline)' },
          script_path: { type: 'string', description: 'Path to a .py file to run (alternative to code)' },
        },
        required: [],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'estimate_vram',
      description: 'Estimate GPU VRAM required for a ML model defined in a Python file.',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the Python file defining the model' },
        },
        required: ['file_path'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'parse_training_log',
      description: 'Parse a ML training log file (JSON, CSV, txt) and return metrics summary (loss, accuracy, epochs).',
      parameters: {
        type: 'object',
        properties: {
          file_path: { type: 'string', description: 'Path to the training log file' },
        },
        required: ['file_path'],
      },
    },
  },
];

// Convert to Gemini format (function_declarations)
export function toGeminiTools(tools: ToolDefinition[]) {
  return {
    function_declarations: tools.map(t => ({
      name: t.function.name,
      description: t.function.description,
      parameters: t.function.parameters,
    })),
  };
}
