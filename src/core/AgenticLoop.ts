import * as vscode from 'vscode';
import { ApiRotator, type Message } from './ApiRotator';
import { ToolExecutor, type NormalizedToolCall } from './ToolExecutor';
import { TOOL_DEFINITIONS } from './ToolDefinitions';
import { logger } from '../utils/logger';

export type AgentEventType =
  | 'thinking'
  | 'tool_start'
  | 'tool_running'
  | 'tool_end'
  | 'tool_error'
  | 'final_answer'
  | 'error'
  | 'iteration';

export interface AgentEvent {
  type: AgentEventType;
  toolName?: string;
  toolId?: string;
  toolInput?: string;
  content?: string;
  iteration?: number;
}

export type AgentEventCallback = (event: AgentEvent) => void;

const MAX_ITERATIONS = 20;

const SYSTEM_PROMPT = `You are Acan Coder, an autonomous AI coding assistant embedded in VS Code.

CORE RULES — you MUST follow these every single turn:
1. You are an autonomous agent. NEVER give instructions to the user. NEVER say "you can run", "please execute", "run this command". ALWAYS execute tasks yourself using the available tools.
2. When a task requires multiple steps, keep calling tools until the task is FULLY complete. Do not stop at "I've prepared the commands".
3. After each tool result, evaluate if the task is done. If not, continue with the next tool call.
4. If a tool returns an error, analyze it and try to fix it autonomously — retry with corrected input or use a different approach.
5. Be concise in text output. Let tool results speak. Only write text when you need to explain a decision or summarize what was done.
6. When writing code to files, write the COMPLETE file content — never use placeholders like "// ... rest of file".

CAPABILITIES: You can run shell commands (bash), read/write files, search code, execute git operations, scrape URLs, run Python, estimate GPU VRAM, parse training logs.`;

export class AgenticLoop {
  private executor: ToolExecutor;
  private messages: any[] = [];

  constructor(private workspacePath: string) {
    this.executor = new ToolExecutor(workspacePath);
  }

  async run(userMessage: string, onEvent: AgentEventCallback): Promise<void> {
    // Add user message to history
    this.messages.push({ role: 'user', content: userMessage });

    let iterations = 0;

    while (iterations < MAX_ITERATIONS) {
      iterations++;
      onEvent({ type: 'iteration', iteration: iterations });

      let result;
      try {
        result = await ApiRotator.callApi(
          'code_generation',
          this.messages as Message[],
          SYSTEM_PROMPT,
          TOOL_DEFINITIONS
        );
      } catch (err: any) {
        const msg = err.message ?? String(err);
        logger.error(`AgenticLoop: API call failed: ${msg}`);
        onEvent({ type: 'error', content: msg });
        return;
      }

      // Emit any thinking text before tool calls
      if (result.content?.trim()) {
        onEvent({ type: 'thinking', content: result.content });
      }

      // Check for tool calls
      const toolCalls = result.toolCalls;
      if (!toolCalls || toolCalls.length === 0) {
        // No tool calls — task complete
        if (result.content?.trim()) {
          onEvent({ type: 'final_answer', content: result.content });
        }
        this.messages.push({ role: 'assistant', content: result.content ?? '' });
        return;
      }

      // Add assistant message with tool calls to history
      this.messages.push({
        role: 'assistant',
        content: result.content || null,
        tool_calls: toolCalls,
      });

      // Execute each tool call
      for (const raw of toolCalls) {
        const call = this.normalizeToolCall(raw);
        onEvent({ type: 'tool_start', toolName: call.name, toolId: call.id, toolInput: JSON.stringify(call.input) });

        let output: string;
        try {
          onEvent({ type: 'tool_running', toolName: call.name, toolId: call.id });
          output = await this.executor.execute(call);
          onEvent({ type: 'tool_end', toolName: call.name, toolId: call.id, content: output });
        } catch (err: any) {
          output = `Error executing ${call.name}: ${err.message}`;
          onEvent({ type: 'tool_error', toolName: call.name, toolId: call.id, content: output });
        }

        // Add tool result to history
        this.messages.push({
          role: 'tool',
          tool_call_id: call.id,
          content: output,
        });
      }

      // Loop again — AI will read tool results and decide next step
    }

    // Reached max iterations
    onEvent({
      type: 'final_answer',
      content: `⚠ Reached maximum iterations (${MAX_ITERATIONS}). The task may be incomplete. Check the tool outputs above for progress made.`,
    });
  }

  clearHistory() {
    this.messages = [];
  }

  private normalizeToolCall(raw: any): NormalizedToolCall {
    // OpenAI format: { id, type, function: { name, arguments } }
    if (raw.function) {
      let input: Record<string, string>;
      try {
        input = JSON.parse(raw.function.arguments ?? '{}');
      } catch {
        input = { raw: raw.function.arguments ?? '' };
      }
      return { id: raw.id ?? `tc-${Date.now()}`, name: raw.function.name, input };
    }
    // Gemini format: { functionCall: { name, args } }
    if (raw.functionCall) {
      return { id: `tc-${Date.now()}`, name: raw.functionCall.name, input: raw.functionCall.args ?? {} };
    }
    return { id: raw.id ?? `tc-${Date.now()}`, name: raw.name ?? 'unknown', input: raw.input ?? {} };
  }
}
