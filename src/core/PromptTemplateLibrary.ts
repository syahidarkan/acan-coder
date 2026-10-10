import { StateStore, PromptTemplateRow } from './StateStore';
import { v4 as uuidv4 } from 'uuid';
import type { Message } from './ApiRotator';

export type { PromptTemplateRow as PromptTemplate };

const BUILTIN_TEMPLATES: Omit<PromptTemplateRow, 'usageCount' | 'lastUsed'>[] = [
  {
    id: 'builtin-shadcn',
    name: 'Shadcn Component',
    taskType: 'ui_generation',
    systemPromptAddition: null,
    userPromptPrefix: null,
    userPromptSuffix: 'Return only the component code. Use shadcn/ui primitives. No explanation.',
  },
  {
    id: 'builtin-python-ml',
    name: 'Python ML Script',
    taskType: 'code_generation',
    systemPromptAddition: null,
    userPromptPrefix: null,
    userPromptSuffix: 'Add type hints. Add docstrings. Use numpy/pandas/torch conventions.',
  },
  {
    id: 'builtin-playwright',
    name: 'Playwright Scraper',
    taskType: 'code_generation',
    systemPromptAddition: null,
    userPromptPrefix: 'Write a Playwright TypeScript script that:',
    userPromptSuffix: 'Include error handling. Use async/await. Export as default function.',
  },
  {
    id: 'builtin-react',
    name: 'React Component',
    taskType: 'ui_generation',
    systemPromptAddition: null, // Anti-Slop rules injected automatically for ui_generation
    userPromptPrefix: null,
    userPromptSuffix: null,
  },
  {
    id: 'builtin-debug',
    name: 'Debug & Fix',
    taskType: 'code_reasoning',
    systemPromptAddition: null,
    userPromptPrefix: 'Here is a bug report. Analyze the root cause and provide a minimal fix:',
    userPromptSuffix: 'Explain WHY the bug occurs in one sentence, then show the corrected code only.',
  },
];

class PromptTemplateLibraryClass {
  init() {
    for (const t of BUILTIN_TEMPLATES) {
      if (!StateStore.getTemplate(t.id)) {
        StateStore.saveTemplate(t);
      }
    }
  }

  list(): PromptTemplateRow[] {
    return StateStore.getTemplates();
  }

  get(id: string): PromptTemplateRow | null {
    return StateStore.getTemplate(id);
  }

  save(template: Omit<PromptTemplateRow, 'id' | 'usageCount' | 'lastUsed'>): string {
    const id = uuidv4();
    StateStore.saveTemplate({ ...template, id });
    return id;
  }

  delete(id: string) {
    StateStore.deleteTemplate(id);
  }

  incrementUsage(id: string) {
    StateStore.incrementTemplateUsage(id);
  }

  applyToMessages(templateId: string, messages: Message[]): Message[] {
    const tpl = StateStore.getTemplate(templateId);
    if (!tpl) return messages;

    const updated = [...messages];
    const lastUserIdx = updated.map(m => m.role).lastIndexOf('user');
    if (lastUserIdx === -1) return messages;

    let content = updated[lastUserIdx].content;
    if (tpl.userPromptPrefix) content = `${tpl.userPromptPrefix}\n${content}`;
    if (tpl.userPromptSuffix) content = `${content}\n${tpl.userPromptSuffix}`;
    updated[lastUserIdx] = { ...updated[lastUserIdx], content };
    return updated;
  }
}

export const PromptTemplateLibrary = new PromptTemplateLibraryClass();
