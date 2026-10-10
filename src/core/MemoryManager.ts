import { StateStore } from './StateStore';
import { EventBus, ExtensionEvents } from './EventBus';
import { estimateTokens } from '../utils/tokenCounter';
import type { Message } from './ApiRotator';

export interface ContextPayload {
  systemPrompt: string;
  messages: Message[];
}

// Layer 0 — pinned context (stays fixed per session for prompt caching benefit)
let pinnedSystemPrompt = `You are My AI Coder, a senior software engineer assistant embedded in VS Code.
You write clean, idiomatic TypeScript/JavaScript. You follow project conventions.
You prefer minimal, readable solutions over clever abstractions.
Never add unnecessary comments. Never pad responses.`;

let pinnedProjectContext = '';

class MemoryManagerClass {
  private designRulesInjector?: () => string;

  setDesignRulesInjector(fn: () => string) {
    this.designRulesInjector = fn;
  }

  setSystemPrompt(prompt: string) {
    pinnedSystemPrompt = prompt;
  }

  setProjectContext(ctx: string) {
    pinnedProjectContext = ctx;
  }

  addMessage(sessionId: string, role: 'user' | 'assistant' | 'system', content: string) {
    const tokens = estimateTokens(content);
    StateStore.addMessage(sessionId, role, content, tokens);
    EventBus.emit(ExtensionEvents.SESSION_MESSAGE_ADDED, { sessionId, role });
  }

  clearSession(sessionId: string) {
    StateStore.clearSession(sessionId);
    EventBus.emit(ExtensionEvents.SESSION_CLEARED, { sessionId });
  }

  buildContext(sessionId: string, taskType: string, templateId?: string): ContextPayload {
    // Layer 0 — pinned, always first (enables prompt caching on providers that support it)
    let sysPrompt = pinnedSystemPrompt;
    if (pinnedProjectContext) {
      sysPrompt += `\n\nPROJECT CONTEXT:\n${pinnedProjectContext}`;
    }

    // Layer 2 — optional template injection
    if (templateId) {
      const tpl = StateStore.getTemplate(templateId);
      if (tpl?.systemPromptAddition) {
        sysPrompt += `\n\n${tpl.systemPromptAddition}`;
      }
    }

    // Inject Anti-Slop rules for UI generation tasks
    if (taskType === 'ui_generation' && this.designRulesInjector) {
      sysPrompt += `\n\n${this.designRulesInjector()}`;
    }

    // Layer 1 — rolling window, last 8 messages
    const allMessages = StateStore.getMessages(sessionId);
    const rollingMessages = allMessages.slice(-8) as Message[];

    return { systemPrompt: sysPrompt, messages: rollingMessages };
  }
}

export const MemoryManager = new MemoryManagerClass();
