import React, { useState, useRef, useEffect } from 'react';
import { postMessage, useExtensionMessage } from '../hooks/useExtensionMessage';

// ─── Types ────────────────────────────────────────────────────────────────────

type MsgRole = 'user' | 'assistant' | 'tool';
interface ChatMsg { role: MsgRole; content: string; }
interface ToolItem {
  id: string;
  name: string;
  input: string;
  output?: string;
  success?: boolean;
  running: boolean;
}
interface LoadedHistory {
  messages: { role: 'user' | 'assistant'; content: string }[];
  age: string;
  project: string;
}

// ─── Markdown renderer ────────────────────────────────────────────────────────
function Markdown({ text }: { text: string }) {
  const parts = text.split(/(```[\s\S]*?```|`[^`\n]+`)/g);
  return (
    <>
      {parts.map((p, i) => {
        if (p.startsWith('```') && p.endsWith('```')) {
          const body = p.slice(3, -3);
          const nl = body.indexOf('\n');
          const lang = nl > 0 ? body.slice(0, nl).trim() : '';
          const code = nl > 0 ? body.slice(nl + 1) : body;
          return (
            <div key={i} style={{ margin: '6px 0', border: '1px solid #27272a', borderRadius: 6, overflow: 'hidden' }}>
              {lang && <div style={{ background: '#18181b', padding: '3px 10px', fontSize: 10.5, color: '#52525b', borderBottom: '1px solid #27272a', fontFamily: 'monospace' }}>{lang}</div>}
              <pre style={{ margin: 0, padding: '10px 12px', background: '#09090b', overflowX: 'auto', fontSize: 12, lineHeight: 1.6, color: '#a1a1aa', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}><code>{code}</code></pre>
            </div>
          );
        }
        if (p.startsWith('`') && p.endsWith('`')) {
          return <code key={i} style={{ background: '#18181b', border: '1px solid #27272a', borderRadius: 3, padding: '1px 5px', fontSize: '0.88em', color: '#a78bfa' }}>{p.slice(1, -1)}</code>;
        }
        return <span key={i} style={{ whiteSpace: 'pre-wrap' }}>{p}</span>;
      })}
    </>
  );
}

// ─── Tool block ───────────────────────────────────────────────────────────────
function ToolBlock({ item }: { item: ToolItem }) {
  const [open, setOpen] = useState(false);

  let preview = '';
  try { const p = JSON.parse(item.input); preview = p.command ?? p.path ?? p.url ?? p.pattern ?? JSON.stringify(p); }
  catch { preview = item.input; }

  const icon = item.running ? '⟳' : item.success === false ? '✗' : '✓';
  const borderColor = item.running ? '#3f3f46' : item.success === false ? '#7f1d1d' : '#14532d';
  const bgColor = item.running ? 'transparent' : item.success === false ? '#1c0a0a' : '#0a1c0e';
  const iconColor = item.running ? '#f59e0b' : item.success === false ? '#ef4444' : '#22c55e';

  return (
    <div style={{ border: `1px solid ${borderColor}`, borderRadius: 6, overflow: 'hidden', background: bgColor, margin: '3px 0' }}>
      <div onClick={() => setOpen(o => !o)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '5px 10px', cursor: 'pointer', userSelect: 'none' }}>
        <span style={{ fontSize: 11, color: iconColor, fontFamily: 'monospace', width: 12, flexShrink: 0,
          ...(item.running ? { animation: 'spin 1s linear infinite', display: 'inline-block' } : {}),
        }}>{icon}</span>
        <span style={{ fontSize: 11, color: '#7c3aed', fontWeight: 600, fontFamily: 'monospace', flexShrink: 0 }}>{item.name}</span>
        <span style={{ fontSize: 11, color: '#52525b', fontFamily: 'monospace', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {preview.slice(0, 72)}
        </span>
        <span style={{ fontSize: 10, color: '#3f3f46', flexShrink: 0 }}>{open ? '▲' : '▼'}</span>
      </div>
      {open && (
        <div style={{ borderTop: `1px solid ${borderColor}` }}>
          <pre style={{ margin: 0, padding: '8px 12px', background: '#09090b', fontSize: 11, lineHeight: 1.5, color: '#71717a', fontFamily: 'monospace', overflowX: 'auto', maxHeight: 280, overflowY: 'auto', whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>
            <span style={{ color: '#3f3f46', userSelect: 'none' }}>▸ INPUT{'\n'}</span>
            {item.input}
            {item.output && (
              <>
                {'\n'}<span style={{ color: '#3f3f46', userSelect: 'none' }}>▸ OUTPUT{'\n'}</span>
                {item.output.length > 4000 ? item.output.slice(0, 4000) + '\n…[truncated]' : item.output}
              </>
            )}
          </pre>
        </div>
      )}
    </div>
  );
}

// ─── Main ChatWindow ──────────────────────────────────────────────────────────
export function ChatWindow() {
  const [messages, setMessages] = useState<ChatMsg[]>([]);
  const [tools, setTools] = useState<ToolItem[]>([]);
  const [input, setInput] = useState('');
  const [isRunning, setIsRunning] = useState(false);
  const [activeModel, setActiveModel] = useState('');
  const [history, setHistory] = useState<LoadedHistory | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useExtensionMessage<ChatMsg>('chat_message', msg => setMessages(prev => [...prev, msg]));
  useExtensionMessage<{ activeModel: string }>('usage_update', d => { if (d.activeModel) setActiveModel(d.activeModel); });
  useExtensionMessage<LoadedHistory>('history_loaded', setHistory);
  useExtensionMessage<{}>('agent_start', () => setIsRunning(true));
  useExtensionMessage<{}>('agent_done', () => setIsRunning(false));

  useExtensionMessage<{ id: string; name: string; input: string }>('tool_start', d => {
    setTools(prev => [...prev, { id: d.id ?? Date.now().toString(), name: d.name, input: d.input, running: true }]);
  });

  useExtensionMessage<{ id: string; name: string; output: string; success: boolean }>('tool_end', d => {
    setTools(prev => prev.map(t =>
      t.id === d.id ? { ...t, output: d.output, success: d.success, running: false } : t
    ));
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, tools, isRunning]);

  function send() {
    if (!input.trim() || isRunning) return;
    const content = input.trim();
    setMessages(prev => [...prev, { role: 'user', content }]);
    setTools([]); // reset tool list for new turn
    setInput('');
    setTimeout(() => {
      if (textareaRef.current) { textareaRef.current.style.height = 'auto'; textareaRef.current.focus(); }
    }, 0);
    postMessage('chat_send', { content });
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send(); }
  }

  function autoResize(e: React.ChangeEvent<HTMLTextAreaElement>) {
    setInput(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 200) + 'px';
  }

  // Merge messages and tool blocks into a single ordered timeline
  // Each user/assistant message is a "turn"; tool blocks belong to the last assistant group
  const timeline: Array<{ type: 'msg'; msg: ChatMsg } | { type: 'tools'; items: ToolItem[] }> = [];
  let pendingTools: ToolItem[] = [];

  // Insert tools before the final_answer if still running, otherwise right before it
  for (const msg of messages) {
    if (msg.role === 'user') {
      if (pendingTools.length > 0) { timeline.push({ type: 'tools', items: pendingTools }); pendingTools = []; }
    }
    timeline.push({ type: 'msg', msg });
  }
  // Current turn tools (may still be running)
  const allTools = [...pendingTools, ...tools];
  if (allTools.length > 0) timeline.push({ type: 'tools', items: allTools });

  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100%', background: 'var(--vscode-editor-background, #09090b)' }}>

      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 16px', borderBottom: '1px solid var(--vscode-panel-border, #27272a)', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: isRunning ? '#f59e0b' : '#22c55e',
            ...(isRunning ? { animation: 'pulse 1s ease-in-out infinite' } : {}) }} />
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--vscode-foreground, #e4e4e7)', letterSpacing: 0.3 }}>
            Acan Coder
          </span>
        </div>
        {activeModel && (
          <span style={{ fontSize: 10.5, color: 'var(--vscode-descriptionForeground, #52525b)', fontFamily: 'monospace' }}>
            {activeModel.split('/').pop()}
          </span>
        )}
      </div>

      {/* History Banner */}
      {history && (
        <div style={{ background: '#0f172a', borderBottom: '1px solid #1e3a5f', flexShrink: 0 }}>
          <div onClick={() => setHistoryExpanded(e => !e)} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 14px', cursor: 'pointer' }}>
            <span style={{ fontSize: 12 }}>📂</span>
            <span style={{ fontSize: 11, color: '#38bdf8', flex: 1 }}>
              <strong>{history.project}</strong> — {history.messages.length} pesan dimuat · {history.age}
            </span>
            <span style={{ fontSize: 10, color: '#334155' }}>{historyExpanded ? '▲' : '▼'}</span>
          </div>
          {historyExpanded && (
            <div style={{ maxHeight: 220, overflowY: 'auto', borderTop: '1px solid #1e3a5f' }}>
              {history.messages.map((m, i) => (
                <div key={i} style={{ padding: '3px 14px', display: 'flex', gap: 8 }}>
                  <span style={{ fontSize: 10, fontWeight: 600, color: m.role === 'user' ? '#475569' : '#7c3aed', flexShrink: 0, width: 20 }}>
                    {m.role === 'user' ? 'U' : 'A'}
                  </span>
                  <span style={{ fontSize: 11, color: '#334155', fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {m.content.slice(0, 100)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Messages + Tool Blocks */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '8px 0', display: 'flex', flexDirection: 'column' }}>
        {messages.length === 0 && tools.length === 0 && (
          <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px 24px', gap: 10 }}>
            <div style={{ fontSize: 26 }}>✦</div>
            <div style={{ fontSize: 14, color: 'var(--vscode-foreground, #e4e4e7)', fontWeight: 500 }}>What can I help with?</div>
            <div style={{ fontSize: 12, color: 'var(--vscode-descriptionForeground, #71717a)', textAlign: 'center', lineHeight: 1.6 }}>
              Saya bisa ngerjain task langsung — git push, buat file,<br />refactor kode, scrape URL, dan lainnya.
            </div>
          </div>
        )}

        {timeline.map((item, i) => {
          if (item.type === 'tools') {
            return (
              <div key={`tools-${i}`} style={{ padding: '2px 14px' }}>
                {item.items.map(t => <ToolBlock key={t.id} item={t} />)}
              </div>
            );
          }
          const m = item.msg;
          return (
            <div key={`msg-${i}`} style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
              <div style={{ fontSize: 11, fontWeight: 600, letterSpacing: 0.5, textTransform: 'uppercase',
                color: m.role === 'user' ? '#52525b' : '#a78bfa' }}>
                {m.role === 'user' ? 'You' : 'Acan Coder'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.7, color: 'var(--vscode-foreground, #e4e4e7)' }}>
                <Markdown text={m.content} />
              </div>
            </div>
          );
        })}

        {/* Running indicator */}
        {isRunning && (
          <div style={{ padding: '10px 16px', display: 'flex', flexDirection: 'column', gap: 5 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: '#a78bfa', letterSpacing: 0.5, textTransform: 'uppercase' }}>Acan Coder · running</div>
            <div style={{ display: 'flex', gap: 4, alignItems: 'center', height: 18 }}>
              {[0, 1, 2].map(n => (
                <div key={n} style={{ width: 5, height: 5, borderRadius: '50%', background: '#a78bfa', opacity: 0.4,
                  animation: `pulse 1.2s ease-in-out ${n * 0.2}s infinite` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div style={{ borderTop: '1px solid var(--vscode-panel-border, #27272a)', padding: '10px 12px', flexShrink: 0, background: 'var(--vscode-editor-background, #09090b)' }}>
        <div style={{ display: 'flex', alignItems: 'flex-end', gap: 8, background: 'var(--vscode-input-background, #18181b)', border: '1px solid var(--vscode-input-border, #3f3f46)', borderRadius: 10, padding: '8px 12px' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={autoResize}
            onKeyDown={handleKeyDown}
            placeholder={isRunning ? 'Sedang berjalan...' : 'Message Acan Coder...'}
            disabled={isRunning}
            rows={1}
            style={{
              flex: 1, background: 'transparent', border: 'none',
              color: 'var(--vscode-input-foreground, #e4e4e7)', fontSize: 13, lineHeight: 1.6,
              resize: 'none', outline: 'none', fontFamily: 'inherit', minHeight: 22, maxHeight: 200, overflowY: 'auto',
              opacity: isRunning ? 0.5 : 1,
            }}
          />
          <button
            onClick={send}
            disabled={isRunning || !input.trim()}
            title="Send (Enter)"
            style={{
              width: 28, height: 28, borderRadius: 6,
              background: isRunning || !input.trim() ? 'transparent' : '#7c3aed',
              border: isRunning || !input.trim() ? '1px solid #3f3f46' : 'none',
              color: isRunning || !input.trim() ? '#52525b' : '#fff',
              cursor: isRunning || !input.trim() ? 'not-allowed' : 'pointer',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              flexShrink: 0, fontSize: 14, transition: 'all 0.15s',
            }}
          >↑</button>
        </div>
        <div style={{ fontSize: 10, color: '#3f3f46', marginTop: 4, paddingLeft: 4 }}>
          Enter · Shift+Enter newline
        </div>
      </div>

      <style>{`
        @keyframes pulse { 0%,100% { opacity:0.2; transform:scale(0.8); } 50% { opacity:1; transform:scale(1.1); } }
        @keyframes spin { from { transform:rotate(0deg); } to { transform:rotate(360deg); } }
        ::-webkit-scrollbar { width: 4px; }
        ::-webkit-scrollbar-track { background: transparent; }
        ::-webkit-scrollbar-thumb { background: #3f3f46; border-radius: 2px; }
      `}</style>
    </div>
  );
}
