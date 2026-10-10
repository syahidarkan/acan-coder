import axios from 'axios';
import * as vscode from 'vscode';
import { EventBus, ExtensionEvents } from './EventBus';
import { StateStore } from './StateStore';
import { logger } from '../utils/logger';

export type TaskType =
  | 'chat_simple'
  | 'code_generation'
  | 'code_reasoning'
  | 'long_context'
  | 'tool_calling'
  | 'ui_generation'
  | 'intent_parse';

export interface Message {
  role: 'user' | 'assistant' | 'system';
  content: string;
}

export interface ApiResponse {
  content: string;
  provider: string;
  model: string;
  tokensUsed: number;
  toolCalls?: Array<{
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
  }>;
}

interface ModelProfile {
  id: string;
  provider: 'gemini' | 'groq' | 'openrouter' | 'sambanova' | 'together' | 'deepinfra';
  model: string;
  strengths: TaskType[];
  rateLimit: { rpm: number; tpm: number; rpd: number };
  currentUsage: { rpm: number; tpm: number; rpd: number; lastReset: Date };
  avgLatencyMs: number;
  errorCooldownUntil?: Date;
  isAvailable: boolean;
}

export interface UsageSummary {
  activeProvider: string;
  activeModel: string;
  providers: Array<{
    provider: string;
    model: string;
    requestsToday: number;
    tokensToday: number;
    isAvailable: boolean;
    hasKey: boolean;
    keyCount: number;
    cooldownUntil?: string;
  }>;
}

const DEFAULT_POOL: Omit<ModelProfile, 'currentUsage' | 'avgLatencyMs' | 'isAvailable'>[] = [
  // Groq - terbukti 200 ✅
  {
    id: 'groq-qwen',
    provider: 'groq',
    model: 'qwen/qwen3-8b',
    strengths: ['chat_simple', 'code_generation', 'intent_parse'],
    rateLimit: { rpm: 30, tpm: 100_000, rpd: 1000 },
  },
  {
    id: 'groq-llama70b',
    provider: 'groq',
    model: 'llama-3.3-70b-versatile',
    strengths: ['code_reasoning', 'long_context', 'chat_simple'],
    rateLimit: { rpm: 30, tpm: 131_072, rpd: 1000 },
  },
  {
    id: 'groq-llama8b',
    provider: 'groq',
    model: 'llama-3.1-8b-instant',
    strengths: ['chat_simple', 'intent_parse'],
    rateLimit: { rpm: 30, tpm: 131_072, rpd: 1000 },
  },
  // SambaNova - terbukti 200 ✅
  {
    id: 'sambanova-gemma',
    provider: 'sambanova',
    model: 'gemma-4-31B-it',
    strengths: ['chat_simple', 'code_generation', 'ui_generation'],
    rateLimit: { rpm: 30, tpm: 200_000, rpd: 1000 },
  },
  {
    id: 'sambanova-minimax',
    provider: 'sambanova',
    model: 'MiniMax-M3',
    strengths: ['long_context', 'code_reasoning'],
    rateLimit: { rpm: 10, tpm: 100_000, rpd: 500 },
  },
  // Together AI
  {
    id: 'together-llama',
    provider: 'together',
    model: 'meta-llama/Llama-3.3-70B-Instruct-Turbo',
    strengths: ['chat_simple', 'code_generation', 'intent_parse'],
    rateLimit: { rpm: 60, tpm: 200_000, rpd: 2000 },
  },
  {
    id: 'together-qwen',
    provider: 'together',
    model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    strengths: ['code_generation', 'ui_generation', 'tool_calling'],
    rateLimit: { rpm: 60, tpm: 200_000, rpd: 2000 },
  },
  // DeepInfra
  {
    id: 'deepinfra-llama',
    provider: 'deepinfra',
    model: 'meta-llama/Llama-3.3-70B-Instruct',
    strengths: ['chat_simple', 'code_generation'],
    rateLimit: { rpm: 60, tpm: 200_000, rpd: 2000 },
  },
  {
    id: 'deepinfra-qwen',
    provider: 'deepinfra',
    model: 'Qwen/Qwen2.5-Coder-32B-Instruct',
    strengths: ['code_generation', 'ui_generation'],
    rateLimit: { rpm: 60, tpm: 200_000, rpd: 2000 },
  },
  // OpenRouter - masukkan key jika punya
  {
    id: 'openrouter-qwen',
    provider: 'openrouter',
    model: 'qwen/qwen-2.5-coder-32b-instruct',
    strengths: ['code_generation', 'tool_calling'],
    rateLimit: { rpm: 20, tpm: 200_000, rpd: 500 },
  },
  // Gemini - masukkan key jika punya
  {
    id: 'gemini-flash',
    provider: 'gemini',
    model: 'gemini-2.0-flash',
    strengths: ['long_context', 'tool_calling'],
    rateLimit: { rpm: 15, tpm: 1_000_000, rpd: 1500 },
  },
];

export class ApiRotatorClass {
  private pool: ModelProfile[] = [];
  private lastActiveModel = '';
  private secretStorage!: vscode.SecretStorage;
  // Cache: provider → has at least one key stored
  private providerHasKey: Map<string, boolean> = new Map();

  init(secretStorage: vscode.SecretStorage) {
    this.secretStorage = secretStorage;
    this.pool = DEFAULT_POOL.map(p => ({
      ...p,
      currentUsage: { rpm: 0, tpm: 0, rpd: 0, lastReset: new Date() },
      avgLatencyMs: 500,
      isAvailable: true,
    }));
    // Reset per-minute counters every minute
    setInterval(() => this.resetMinuteCounters(), 60_000);
    // Initial key cache (fire & forget)
    this.refreshKeyCache();
  }

  async refreshKeyCache() {
    const providers = [...new Set(this.pool.map(m => m.provider))];
    for (const p of providers) {
      const keys = await this.getApiKeys(p);
      this.providerHasKey.set(p, keys.length > 0);
    }
  }

  private resetMinuteCounters() {
    this.pool.forEach(m => { m.currentUsage.rpm = 0; });
  }

  route(taskType: TaskType): ModelProfile {
    const now = new Date();
    const available = this.pool.filter(m => {
      if (!m.isAvailable) return false;
      if (m.errorCooldownUntil && m.errorCooldownUntil > now) return false;
      if (m.currentUsage.rpm >= m.rateLimit.rpm) return false;
      if (m.currentUsage.rpd >= m.rateLimit.rpd) return false;
      // skip providers with no stored keys (cache populated on init + setApiKey)
      if (this.providerHasKey.has(m.provider) && !this.providerHasKey.get(m.provider)) return false;
      return true;
    });

    const matching = available.filter(m => m.strengths.includes(taskType));
    const candidates = matching.length > 0 ? matching : available;
    if (candidates.length === 0) throw new Error('No available API providers. All rate limited or in cooldown.');
    return candidates.sort((a, b) => a.avgLatencyMs - b.avgLatencyMs)[0];
  }

  async setApiKey(provider: string, key: string) {
    const existing = await this.secretStorage.get(`apikeys:${provider}`);
    const keys: string[] = existing ? JSON.parse(existing) : [];
    if (!keys.includes(key)) keys.push(key);
    await this.secretStorage.store(`apikeys:${provider}`, JSON.stringify(keys));
    // keep legacy single-key store for compatibility
    await this.secretStorage.store(`apikey:${provider}`, key);
    // update cache immediately so routing picks it up
    this.providerHasKey.set(provider, true);
    // also re-enable pool entries that were marked unavailable due to no key
    for (const m of this.pool) {
      if (m.provider === provider && !m.isAvailable) {
        m.isAvailable = true;
        m.errorCooldownUntil = undefined;
      }
    }
  }

  async getApiKeys(provider: string): Promise<string[]> {
    const multi = await this.secretStorage.get(`apikeys:${provider}`);
    if (multi) return JSON.parse(multi);
    const single = await this.secretStorage.get(`apikey:${provider}`);
    return single ? [single] : [];
  }

  async getApiKey(provider: string): Promise<string | undefined> {
    const keys = await this.getApiKeys(provider);
    return keys[0];
  }

  async removeApiKey(provider: string, keyToRemove: string) {
    const keys = await this.getApiKeys(provider);
    const updated = keys.filter(k => k !== keyToRemove);
    await this.secretStorage.store(`apikeys:${provider}`, JSON.stringify(updated));
    if (updated.length > 0) {
      await this.secretStorage.store(`apikey:${provider}`, updated[0]);
    } else {
      await this.secretStorage.delete(`apikey:${provider}`);
    }
    this.providerHasKey.set(provider, updated.length > 0);
  }

  async clearAllKeys(provider: string) {
    await this.secretStorage.delete(`apikeys:${provider}`);
    await this.secretStorage.delete(`apikey:${provider}`);
    this.providerHasKey.set(provider, false);
    for (const m of this.pool) {
      if (m.provider === provider) m.isAvailable = false;
    }
  }

  async callApi(
    taskType: TaskType,
    messages: Message[],
    systemPrompt?: string,
    _tools?: unknown[]
  ): Promise<ApiResponse> {
    let lastError: Error | null = null;
    let rotations = 0;
    const MAX_ROTATIONS = 8;

    // per-provider key index for rotation within a single callApi
    const keyIndex: Record<string, number> = {};

    while (rotations < MAX_ROTATIONS) {
      const model = this.route(taskType);
      this.lastActiveModel = `${model.provider}/${model.model}`;
      const keys = await this.getApiKeys(model.provider);
      const idx = keyIndex[model.provider] ?? 0;
      const apiKey = keys[idx];
      if (!apiKey) {
        model.isAvailable = false;
        rotations++;
        continue;
      }

      const startTime = Date.now();
      try {
        const result = await this.dispatchRequest(model, messages, systemPrompt, apiKey, _tools as unknown[]);
        const latency = Date.now() - startTime;
        model.avgLatencyMs = model.avgLatencyMs * 0.7 + latency * 0.3;
        model.currentUsage.rpm++;
        model.currentUsage.rpd++;
        model.currentUsage.tpm += result.tokensUsed;
        StateStore.recordApiUsage(model.provider, model.model, result.tokensUsed);
        EventBus.emit(ExtensionEvents.API_USAGE_UPDATED, this.getUsageStats());
        return result;
      } catch (err: unknown) {
        const e = err as { response?: { status?: number }; message?: string };
        const status = e?.response?.status;
        if (status === 429 || status === 503 || status === 402) {
          // rate limited — try next key for this provider first
          if (idx + 1 < keys.length) {
            keyIndex[model.provider] = idx + 1;
            logger.warn(`Rate limited on ${model.provider} key[${idx}], trying key[${idx + 1}]`);
          } else {
            model.errorCooldownUntil = new Date(Date.now() + 60_000);
            EventBus.emit(ExtensionEvents.API_RATE_LIMITED, { provider: model.provider, model: model.model });
            logger.warn(`All keys rate limited on ${model.provider}/${model.model}, rotating provider...`);
            rotations++;
          }
          lastError = new Error(e.message ?? 'Rate limited');
        } else if (status === 410 || status === 404) {
          if (idx + 1 < keys.length) {
            keyIndex[model.provider] = idx + 1;
          } else {
            model.isAvailable = false;
            rotations++;
          }
          lastError = new Error(`${model.provider}/${model.model} returned ${status}`);
        } else if (status === 401 || status === 403) {
          // invalid/revoked key — remove it from storage permanently
          await this.removeApiKey(model.provider, apiKey);
          logger.warn(`${model.provider} key[${idx}] invalid (${status}), removed from storage`);
          const remaining = await this.getApiKeys(model.provider);
          if (remaining.length === 0) {
            model.isAvailable = false;
            this.providerHasKey.set(model.provider, false);
            logger.warn(`${model.provider} all keys invalid, marking unavailable`);
          }
          // reset key index since we removed one
          keyIndex[model.provider] = 0;
          rotations++;
          lastError = new Error(`${model.provider} auth error ${status}`);
        } else if (status === 400) {
          // bad request (wrong model name, etc) — try next key first, then skip model
          if (idx + 1 < keys.length) {
            keyIndex[model.provider] = idx + 1;
          } else {
            model.isAvailable = false;
            logger.warn(`${model.provider}/${model.model} bad request, marking unavailable`);
          }
          rotations++;
          lastError = new Error(`${model.provider} bad request ${status}`);
        } else {
          const body = (e as any)?.response?.data;
          const detail = body ? JSON.stringify(body) : String(err);
          logger.error(`${model.provider}/${model.model} error ${status}: ${detail}`);
          throw new Error(`${model.provider} error ${status}: ${detail}`);
        }
      }
    }
    throw lastError ?? new Error('All API rotation attempts failed');
  }

  private async dispatchRequest(
    model: ModelProfile,
    messages: Message[],
    systemPrompt: string | undefined,
    apiKey: string,
    tools?: unknown[]
  ): Promise<ApiResponse> {
    if (model.provider === 'gemini') {
      return this.callGemini(model, messages, systemPrompt, apiKey, tools);
    }
    return this.callOpenAICompat(model, messages, systemPrompt, apiKey, tools);
  }

  private async callGemini(
    model: ModelProfile,
    messages: Message[],
    systemPrompt: string | undefined,
    apiKey: string,
    tools?: unknown[]
  ): Promise<ApiResponse> {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model.model}:generateContent?key=${apiKey}`;
    // Flatten tool/assistant messages for Gemini (no tool role support — merge into user)
    const geminiMessages = messages
      .filter(m => m.role !== 'system' && (m as any).role !== 'tool')
      .map(m => ({
        role: (m.role === 'assistant' ? 'model' : 'user'),
        parts: [{ text: m.content ?? '' }],
      }));

    const body: Record<string, unknown> = { contents: geminiMessages };
    if (systemPrompt) body.systemInstruction = { parts: [{ text: systemPrompt }] };
    if (tools && tools.length > 0) {
      // Gemini function_declarations format
      body.tools = [{
        function_declarations: (tools as any[]).map(t => ({
          name: t.function.name,
          description: t.function.description,
          parameters: t.function.parameters,
        })),
      }];
    }

    const resp = await axios.post(url, body);
    const candidate = resp.data.candidates?.[0];
    const part = candidate?.content?.parts?.[0];
    const text: string = part?.text ?? '';
    // Gemini tool call
    const functionCall = part?.functionCall;
    const toolCalls = functionCall
      ? [{ id: `tc-${Date.now()}`, type: 'function' as const, function: { name: functionCall.name, arguments: JSON.stringify(functionCall.args) } }]
      : undefined;
    const tokensUsed: number = resp.data.usageMetadata?.totalTokenCount ?? estimateTokens(text);
    return { content: text, provider: model.provider, model: model.model, tokensUsed, toolCalls };
  }

  private async callOpenAICompat(
    model: ModelProfile,
    messages: Message[],
    systemPrompt: string | undefined,
    apiKey: string,
    tools?: unknown[]
  ): Promise<ApiResponse> {
    const baseUrls: Record<string, string> = {
      groq: 'https://api.groq.com/openai/v1',
      openrouter: 'https://openrouter.ai/api/v1',
      sambanova: 'https://api.sambanova.ai/v1',
      together: 'https://api.together.ai/v1',
      deepinfra: 'https://api.deepinfra.com/v1/openai',
    };
    const baseUrl = baseUrls[model.provider];
    const allMessages: Message[] = systemPrompt
      ? [{ role: 'system', content: systemPrompt }, ...messages]
      : messages;

    const body: Record<string, unknown> = { model: model.model, messages: allMessages };
    if (tools && tools.length > 0) {
      body.tools = tools;
      body.tool_choice = 'auto';
    }

    const resp = await axios.post(
      `${baseUrl}/chat/completions`,
      body,
      { headers: { Authorization: `Bearer ${apiKey}` } }
    );
    const choice = resp.data.choices?.[0];
    const text: string = choice?.message?.content ?? '';
    const toolCalls = choice?.message?.tool_calls;
    const tokensUsed: number = resp.data.usage?.total_tokens ?? estimateTokens(text);
    return { content: text, provider: model.provider, model: model.model, tokensUsed, toolCalls };
  }

  async getUsageStatsAsync(): Promise<UsageSummary> {
    const dbUsage = StateStore.getApiUsageToday();
    const usageMap = new Map(dbUsage.map(u => [`${u.provider}/${u.model}`, u]));
    // Cache key counts per provider
    const keyCounts: Record<string, number> = {};
    for (const m of this.pool) {
      if (keyCounts[m.provider] === undefined) {
        keyCounts[m.provider] = (await this.getApiKeys(m.provider)).length;
      }
    }
    return {
      activeProvider: this.lastActiveModel.split('/')[0] ?? '',
      activeModel: this.lastActiveModel,
      providers: this.pool.map(m => {
        const key = `${m.provider}/${m.model}`;
        const db = usageMap.get(key);
        const keyCount = keyCounts[m.provider] ?? 0;
        return {
          provider: m.provider,
          model: m.model,
          requestsToday: db?.requestCount ?? 0,
          tokensToday: db?.tokenCount ?? 0,
          isAvailable: m.isAvailable && (!m.errorCooldownUntil || m.errorCooldownUntil <= new Date()),
          hasKey: keyCount > 0,
          keyCount,
          cooldownUntil: m.errorCooldownUntil?.toISOString(),
        };
      }),
    };
  }

  getUsageStats(): UsageSummary {
    const dbUsage = StateStore.getApiUsageToday();
    const usageMap = new Map(dbUsage.map(u => [`${u.provider}/${u.model}`, u]));
    return {
      activeProvider: this.lastActiveModel.split('/')[0] ?? '',
      activeModel: this.lastActiveModel,
      providers: this.pool.map(m => {
        const key = `${m.provider}/${m.model}`;
        const db = usageMap.get(key);
        return {
          provider: m.provider,
          model: m.model,
          requestsToday: db?.requestCount ?? 0,
          tokensToday: db?.tokenCount ?? 0,
          isAvailable: m.isAvailable && (!m.errorCooldownUntil || m.errorCooldownUntil <= new Date()),
          hasKey: false,
          keyCount: 0,
          cooldownUntil: m.errorCooldownUntil?.toISOString(),
        };
      }),
    };
  }
}

function estimateTokens(text: string) { return Math.ceil(text.length / 4); }

export const ApiRotator = new ApiRotatorClass();
