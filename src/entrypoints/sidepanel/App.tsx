import React, { useState, useEffect, useRef, useCallback } from 'react';
import { browser } from 'wxt/browser';
import { MessageTypes, type ChatMessage, type RoleInfo } from '../../lib/messaging';
import { marked } from 'marked';

marked.setOptions({ breaks: true, gfm: true });

let _idCounter = 0;
function uid(prefix: string): string { return `${prefix}-${Date.now()}-${++_idCounter}`; }

interface UIMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'thinking' | 'context';
  content: string;
  isStreaming?: boolean;
}

interface PageContext {
  pageType: string;
  title: string;
  url: string;
  role: { id: string; name: string; isBuiltin: boolean } | null;
}

interface AskCreateRolePayload { url: string; pageType: string; title: string; }

const PAGE_LABELS: Record<string, string> = { search: '搜索结果', product: '商品详情', category: '类目市场' };

const Avatar = ({ role }: { role: 'user' | 'assistant' }) => (
  <div className={`w-7 h-7 rounded-xl flex items-center justify-center text-white text-[10px] font-bold shadow-sm flex-shrink-0 ${
    role === 'assistant' ? 'bg-gradient-to-br from-indigo-500 to-purple-600' : 'bg-gradient-to-br from-emerald-400 to-teal-500'
  }`}>
    {role === 'assistant' ? 'AI' : 'U'}
  </div>
);

export default function App() {
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [apiKeyMissing, setApiKeyMissing] = useState(false);
  const [pageContext, setPageContext] = useState<PageContext | null>(null);
  const [askCreateRole, setAskCreateRole] = useState<AskCreateRolePayload | null>(null);
  const [roleForm, setRoleForm] = useState({ name: '', prompt: '' });
  const [allRoles, setAllRoles] = useState<RoleInfo[]>([]);
  const [showRoleMenu, setShowRoleMenu] = useState(false);
  const [isSelecting, setIsSelecting] = useState(false);
  const [pendingSelections, setPendingSelections] = useState<string[]>([]);
  const [selectionDesc, setSelectionDesc] = useState('');
  const [showHistory, setShowHistory] = useState(false);
  const [historyList, setHistoryList] = useState<Array<{ id: string; title: string; updatedAt: number; preview: string }>>([]);

  const chatEndRef = useRef<HTMLDivElement>(null);
  const streamBufferRef = useRef('');
  const streamingMsgIdRef = useRef<string | null>(null);
  const isLoadingRef = useRef(false);

  const send = useCallback((msg: Record<string, unknown>) =>
    browser.runtime.sendMessage(msg).catch(() => {}), []);

  useEffect(() => { chatEndRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages, askCreateRole]);

  // 心跳 + 长连接保活，防止 service worker 被杀
  useEffect(() => {
    let port = browser.runtime.connect({ name: 'sidepanel-keepalive' });
    let timer: ReturnType<typeof setInterval>;

    const reconnect = () => {
      try { port.disconnect(); } catch {}
      port = browser.runtime.connect({ name: 'sidepanel-keepalive' });
      port.onDisconnect.addListener(() => {
        setTimeout(reconnect, 500);
      });
    };

    port.onDisconnect.addListener(() => {
      setTimeout(reconnect, 500);
    });

    // 每 15 秒发一次心跳 ping
    timer = setInterval(() => {
      browser.runtime.sendMessage({ type: 'HEARTBEAT' }).catch(() => {});
    }, 15000);

    return () => {
      clearInterval(timer);
      try { port.disconnect(); } catch {}
    };
  }, []);

  // 加载角色列表 + 当前页面上下文
  useEffect(() => {
    const sendWithRetry = async (msg: Record<string, unknown>, retries = 3) => {
      for (let i = 0; i < retries; i++) {
        try { return await browser.runtime.sendMessage(msg); }
        catch { if (i < retries - 1) await new Promise((r) => setTimeout(r, 500)); }
      }
      return null;
    };
    sendWithRetry({ type: 'GET_ALL_ROLES' }).then((roles) => setAllRoles((roles || []) as RoleInfo[]));
    sendWithRetry({ type: 'GET_CURRENT_CONTEXT' }).then((result) => {
      const { context: ctx } = (result as { context: PageContext | null }) || {};
      if (ctx?.url) setPageContext(ctx);
    });
  }, []);

  useEffect(() => {
    const listener = (msg: { type: string; payload: unknown }) => {
      switch (msg.type) {
        case MessageTypes.PAGE_CONTEXT: {
          const ctx = msg.payload as PageContext | null;
          if (!ctx) break;
          setPageContext(ctx);
          setAskCreateRole(null);
          // 不自动清空消息，保留当前对话
          break;
        }
        case MessageTypes.ASK_CREATE_ROLE: {
          const p = msg.payload as AskCreateRolePayload;
          setAskCreateRole(p);
          setRoleForm({ name: '', prompt: `你是淘宝 ${PAGE_LABELS[p.pageType] || '页面'} 的分析助手。请基于页面数据帮用户分析。` });
          break;
        }
        case MessageTypes.ROLE_CREATED: {
          setAskCreateRole(null);
          // 刷新角色列表
          browser.runtime.sendMessage({ type: 'GET_ALL_ROLES' }).then((roles) => setAllRoles(roles as RoleInfo[] || []));
          break;
        }
        case MessageTypes.AI_RESPONSE: {
          const payload = msg.payload as { message: ChatMessage; replace?: boolean };
          const { message } = payload;
          // 后端流结束时的完整文本覆盖
          if (payload.replace) {
            setMessages((prev) => {
              const lastAI = [...prev].reverse().find((m) => m.role === 'assistant');
              if (lastAI) return prev.map((m) => m.id === lastAI.id ? { ...m, content: message.content, isStreaming: true } : m);
              return [...prev, { id: uid('msg'), role: 'assistant', content: message.content, isStreaming: true }];
            });
            break;
          }
          if (streamingMsgIdRef.current) {
            streamBufferRef.current += message.content;
            setMessages((prev) => prev.map((m) => m.id === streamingMsgIdRef.current ? { ...m, content: streamBufferRef.current } : m));
          } else {
            const msgId = uid('msg');
            streamingMsgIdRef.current = msgId;
            streamBufferRef.current = message.content;
            setMessages((prev) => [...prev, { id: msgId, role: 'assistant', content: message.content, isStreaming: true }]);
          }
          break;
        }
        case MessageTypes.STREAM_COMPLETE: {
          // 流结束，标记消息为非 streaming 状态
          const mid = streamingMsgIdRef.current;
          if (mid) {
            setMessages((prev) => prev.map((m) =>
              m.id === mid ? { ...m, isStreaming: false } : m
            ));
          }
          streamingMsgIdRef.current = null;
          streamBufferRef.current = '';
          isLoadingRef.current = false;
          setIsLoading(false);
          break;
        }
        case MessageTypes.AI_THINKING: {
          setMessages((prev) => [...prev, { id: uid('thinking'), role: 'thinking', content: (msg.payload as { thinking: string }).thinking }]);
          break;
        }
        case MessageTypes.AI_ERROR: {
          const { error } = msg.payload as { error: string };
          if (error.includes('API Key')) setApiKeyMissing(true);
          setMessages((prev) => [...prev, { id: uid('err'), role: 'system', content: error }]);
          finishStreaming();
          isLoadingRef.current = false;
          setIsLoading(false);
          break;
        }
        case MessageTypes.DOM_SELECTED: {
          setIsSelecting(false);
          const { text } = msg.payload as { text: string };
          if (!text) break;
          setPendingSelections((prev) => {
            if (prev.includes(text)) return prev; // 去重
            return [...prev, text];
          });
          if (!selectionDesc) setSelectionDesc('');
          break;
        }
        case MessageTypes.CANCEL_DOM_SELECT: {
          setIsSelecting(false);
          break;
        }
      }
    };
    browser.runtime.onMessage.addListener(listener);
    return () => { browser.runtime.onMessage.removeListener(listener); };
  }, []);

  const finishStreaming = useCallback(() => {
    if (streamingMsgIdRef.current) {
      setMessages((prev) => prev.map((m) => m.id === streamingMsgIdRef.current ? { ...m, isStreaming: false } : m));
      streamingMsgIdRef.current = null;
      streamBufferRef.current = '';
    }
  }, []);

  const handleSend = useCallback(async () => {
    const text = input.trim();
    if (!text || isLoading) return;
    setInput('');
    setMessages((prev) => [...prev, { id: uid('u'), role: 'user', content: text }]);
    isLoadingRef.current = true;
    setIsLoading(true);
    await send({ type: MessageTypes.CHAT_MESSAGE, payload: { message: text } });
  }, [input, isLoading]);

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  }, [handleSend]);

  const handleCreateRole = useCallback(async () => {
    if (!askCreateRole || !roleForm.name.trim()) return;
    await send({
      type: MessageTypes.CREATE_ROLE,
      payload: { name: roleForm.name.trim(), urlPattern: askCreateRole.pageType, prompt: roleForm.prompt.trim(), url: askCreateRole.url, pageType: askCreateRole.pageType, title: askCreateRole.title },
    });
    setAskCreateRole(null);
  }, [askCreateRole, roleForm]);

  const handleSwitchRole = useCallback(async (roleId: string) => {
    setShowRoleMenu(false);
    const role = allRoles.find((r) => r.id === roleId);
    setMessages((prev) => [...prev, { id: uid('ctx'), role: 'context', content: `已切换至「${role?.name || roleId}」` }]);
    await send({ type: MessageTypes.SWITCH_ROLE, payload: { roleId } });
  }, [allRoles]);

  const handleSubmitSelection = useCallback(async () => {
    if (!pendingSelections.length || isLoadingRef.current) return;
    const desc = selectionDesc.trim();
    const body = pendingSelections.map((s, i) => `[区域 ${i + 1}]:\n${s}`).join('\n\n---\n\n');
    const msg = desc
      ? `以下是我从页面选取的数据（${desc}）：\n\n${body}`
      : `以下是页面中选取的内容，请总结要点：\n\n${body}`;
    setMessages((prev) => [...prev, { id: uid('u'), role: 'user', content: msg }]);
    setPendingSelections([]);
    setSelectionDesc('');
    isLoadingRef.current = true;
    setIsLoading(true);
    await send({ type: MessageTypes.CHAT_MESSAGE, payload: { message: msg } }).catch(() => {});
  }, [pendingSelections, selectionDesc]);

  const handleCancelSelection = useCallback(() => {
    setPendingSelections([]);
    setSelectionDesc('');
  }, []);

  const handleLoadConversation = useCallback(async (id: string) => {
    const result = await browser.runtime.sendMessage({ type: 'LOAD_CONVERSATION', payload: { id } });
    const { messages: msgs } = (result as { messages: ChatMessage[] }) || {};
    if (msgs?.length) {
      setMessages(msgs.filter((m) => m.role === 'user' || m.role === 'assistant').map((m) => ({
        id: uid(m.role === 'user' ? 'u' : 'msg'),
        role: m.role as 'user' | 'assistant',
        content: m.content,
        isStreaming: false,
      })));
    }
    setShowHistory(false);
  }, []);

  const handleDomSelect = useCallback(async () => {
    if (isSelecting) { await send({ type: MessageTypes.CANCEL_DOM_SELECT }); setIsSelecting(false); return; }
    await send({ type: MessageTypes.START_DOM_SELECT });
    setIsSelecting(true);
  }, [isSelecting]);

  const handleOpenSettings = useCallback(async () => {
    await browser.runtime.openOptionsPage();
  }, []);

  const exportMessages = useCallback((format: 'md' | 'csv') => {
    const msgs = messages.filter((m) => m.role === 'user' || m.role === 'assistant');
    const now = new Date().toISOString().slice(0, 10);
    const title = pageContext?.title || 'chat';

    if (format === 'md') {
      const lines: string[] = [
        `# ${title}`,
        `> 导出时间: ${new Date().toLocaleString()}`,
        `> 角色: ${pageContext?.role?.name || '未知'}`,
        '',
      ];
      for (const m of msgs) {
        lines.push(`### ${m.role === 'user' ? '🧑 用户' : '🤖 AI'}`);
        lines.push('');
        lines.push(m.content);
        lines.push('');
      }
      download(`${title}-${now}.md`, lines.join('\n'), 'text/markdown');
    } else {
      const rows = [['角色', '内容', '时间']];
      for (const m of msgs) {
        rows.push([
          m.role === 'user' ? '用户' : 'AI',
          m.content.replace(/"/g, '""').replace(/\n/g, ' '),
          '',
        ]);
      }
      const csv = rows.map((r) => r.map((c) => `"${c}"`).join(',')).join('\n');
      download(`${title}-${now}.csv`, '﻿' + csv, 'text/csv');
    }
  }, [messages, pageContext]);

  const renderMessage = (msg: UIMessage) => {
    if (msg.role === 'context') return <div key={msg.id} className="mx-4 my-2 px-4 py-2.5 bg-indigo-50 border border-indigo-100 rounded-2xl text-xs text-indigo-700">{msg.content}</div>;
    if (msg.role === 'thinking') return (
      <div key={msg.id} className="flex items-center gap-2 px-4 py-1">
        <div className="flex gap-1">{[0, 0.1, 0.2].map((d) => <span key={d} className="w-1 h-1 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: `${d}s` }} />)}</div>
        <span className="text-xs text-gray-400">{msg.content}</span>
      </div>
    );
    if (msg.role === 'system') return <div key={msg.id} className="mx-4 my-2 px-4 py-3 bg-red-50 border border-red-100 rounded-2xl text-sm text-red-600">{msg.content}</div>;

    const isUser = msg.role === 'user';
    return (
      <div key={msg.id} className={`flex gap-2 px-4 py-2 ${isUser ? 'flex-row-reverse' : ''}`}>
        <Avatar role={isUser ? 'user' : 'assistant'} />
        <div className={`max-w-[82%] px-4 py-2.5 text-sm leading-relaxed ${isUser ? 'bg-indigo-500 text-white rounded-2xl rounded-tr-md shadow-sm' : 'bg-white border border-gray-100 text-gray-700 rounded-2xl rounded-tl-md shadow-sm'}`}>
          {isUser ? <p className="whitespace-pre-wrap">{msg.content}</p> : <div className="message-content" dangerouslySetInnerHTML={{ __html: marked.parse(msg.content) as string }} />}
          {msg.isStreaming && <span className="inline-block w-1.5 h-4 bg-indigo-400 ml-0.5 rounded-sm animate-pulse align-text-bottom" />}
        </div>
      </div>
    );
  };

  return (
    <div className="flex flex-col h-screen bg-[#f8f9fc]">
      {/* Header */}
      <header className="flex items-center justify-between px-5 py-3 bg-white border-b border-gray-100 shrink-0">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm flex-shrink-0">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div className="min-w-0">
            <h1 className="font-bold text-sm text-gray-800 leading-none truncate">AI 专家助手</h1>
            <p className="text-[10px] text-gray-400 mt-0.5 truncate">
              {pageContext ? `${PAGE_LABELS[pageContext.pageType] || '页面'} · ${pageContext.title.slice(0, 15)}` : '已就绪'}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-1 flex-shrink-0">
          {/* Role badge / switcher — always visible */}
          <div className="relative">
            <button
              onClick={() => setShowRoleMenu(!showRoleMenu)}
              className="text-[10px] px-2 py-1 bg-indigo-100 text-indigo-600 rounded-full font-medium hover:bg-indigo-200 transition-colors flex items-center gap-1"
            >
              {pageContext?.role?.name || '选择角色'}
              <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3"><polyline points="6 9 12 15 18 9" /></svg>
            </button>
            {showRoleMenu && (
              <div className="absolute right-0 top-full mt-1 w-44 bg-white rounded-xl shadow-lg border border-gray-100 py-1 z-50">
                <p className="text-[10px] text-gray-400 px-3 py-1.5">切换角色</p>
                {allRoles.map((r) => (
                  <button
                    key={r.id}
                    onClick={() => handleSwitchRole(r.id)}
                    className={`w-full text-left px-3 py-1.5 text-xs hover:bg-gray-50 flex items-center justify-between ${r.id === pageContext?.role?.id ? 'text-indigo-600 font-medium' : 'text-gray-600'}`}
                  >
                    <span>{r.name}</span>
                    {r.id === pageContext?.role?.id && <span className="text-indigo-400">✓</span>}
                  </button>
                ))}
                </div>
              )}
            </div>
          <button onClick={() => exportMessages('md')} className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="导出 Markdown">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" /><polyline points="7 10 12 15 17 10" /><line x1="12" y1="15" x2="12" y2="3" />
            </svg>
          </button>
          <button onClick={() => exportMessages('csv')} className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="导出 CSV">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><polyline points="14 2 14 8 20 8" /><line x1="16" y1="13" x2="8" y2="13" /><line x1="16" y1="17" x2="8" y2="17" />
            </svg>
          </button>
          <button
            onClick={() => { setMessages([]); send({ type: MessageTypes.SWITCH_ROLE, payload: { roleId: pageContext?.role?.id || 'builtin-default' } }); }}
            className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title="新对话"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <line x1="12" y1="5" x2="12" y2="19" /><line x1="5" y1="12" x2="19" y2="12" />
            </svg>
          </button>
          <button
            onClick={async () => {
              setShowHistory(true);
              const result = await browser.runtime.sendMessage({ type: 'LIST_CONVERSATIONS' });
              setHistoryList(result as Array<{ id: string; title: string; updatedAt: number; preview: string }> || []);
            }}
            className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors"
            title="历史记录"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="10" /><polyline points="12 6 12 12 16 14" />
            </svg>
          </button>
          <button onClick={handleOpenSettings} className="w-8 h-8 rounded-xl bg-gray-50 hover:bg-gray-100 flex items-center justify-center text-gray-400 hover:text-gray-600 transition-colors" title="设置">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3" /><path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </button>
        </div>
      </header>

      {/* API Key */}
      {apiKeyMissing && (
        <div className="mx-4 mt-3 px-4 py-2.5 bg-amber-50 border border-amber-100 rounded-2xl text-xs text-amber-700 flex items-center justify-between shrink-0">
          <span>请先配置 API Key</span>
          <button onClick={handleOpenSettings} className="font-semibold underline ml-2">前往设置</button>
        </div>
      )}

      {/* Role creation form */}
      {askCreateRole && (
        <div className="mx-4 mt-3 bg-white border border-indigo-200 rounded-2xl p-4 shadow-sm shrink-0">
          <p className="text-sm font-semibold text-gray-800 mb-1">为此页面创建 AI 角色</p>
          <p className="text-xs text-gray-400 mb-3">页面「{askCreateRole.title}」没有匹配的角色。</p>
          <label className="block text-xs font-medium text-gray-600 mb-1">角色名称</label>
          <input type="text" value={roleForm.name} onChange={(e) => setRoleForm((f) => ({ ...f, name: e.target.value }))} placeholder="例如：家居品类分析师"
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-400" onKeyDown={(e) => { if (e.key === 'Enter') handleCreateRole(); }} />
          <label className="block text-xs font-medium text-gray-600 mb-1">提示词</label>
          <textarea value={roleForm.prompt} onChange={(e) => setRoleForm((f) => ({ ...f, prompt: e.target.value }))} rows={4}
            className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 resize-none focus:outline-none focus:border-indigo-400 font-mono" />
          <div className="flex items-center gap-2">
            <button onClick={handleCreateRole} disabled={!roleForm.name.trim()} className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white px-4 py-1.5 rounded-xl text-sm font-medium transition-all">创建并开始分析</button>
            <button onClick={() => setAskCreateRole(null)} className="text-gray-400 hover:text-gray-600 text-sm">跳过</button>
          </div>
        </div>
      )}

      {/* History panel */}
      {showHistory && (
        <div className="flex-1 overflow-y-auto">
          <div className="p-3 flex items-center justify-between border-b border-gray-100">
            <h2 className="font-semibold text-sm text-gray-800">历史对话</h2>
            <button onClick={() => setShowHistory(false)} className="text-gray-400 hover:text-gray-600 text-xs">关闭</button>
          </div>
          {historyList.length === 0 ? (
            <p className="text-xs text-gray-400 text-center py-8">暂无历史对话</p>
          ) : (
            historyList.map((h) => (
              <button
                key={h.id}
                onClick={() => handleLoadConversation(h.id)}
                className="w-full text-left px-4 py-3 border-b border-gray-50 hover:bg-gray-50 transition-colors"
              >
                <div className="flex items-center justify-between mb-1">
                  <span className="text-sm font-medium text-gray-700 truncate">{h.title}</span>
                  <span className="text-[10px] text-gray-400 flex-shrink-0 ml-2">{new Date(h.updatedAt).toLocaleDateString()}</span>
                </div>
                <p className="text-xs text-gray-400 truncate">{h.preview}</p>
              </button>
            ))
          )}
        </div>
      )}

      {/* Messages */}
      {!showHistory && (
      <div className="flex-1 overflow-y-auto py-3 space-y-1">
        {messages.length === 0 && !pageContext && !askCreateRole && !apiKeyMissing && (
          <div className="flex flex-col items-center justify-center h-full px-6">
            <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-lg shadow-indigo-200 mb-5">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12" /></svg>
            </div>
            <h2 className="font-bold text-base text-gray-800 mb-1">AI 专家助手已就绪</h2>
            <p className="text-xs text-gray-400 text-center mb-6">打开任意页面，选择角色后即可开始</p>
            <div className="grid grid-cols-1 gap-2 w-full">
              {[
                { icon: '⬜', title: '框选页面元素', desc: '按住 Shift 在页面上拖拽选取' },
                { icon: '🤖', title: '通用助手', desc: '全场景分析，无需切换' },
                { icon: '🎭', title: '自定义角色', desc: '创建专属分析角色' },
                { icon: '⬇️', title: '导出聊天', desc: 'Header 按钮导出 MD / CSV' },
              ].map(({ icon, title, desc }) => (
                <div key={title} className="flex items-center gap-3 bg-white rounded-2xl px-4 py-3 border border-gray-100 shadow-sm">
                  <span className="text-lg">{icon}</span>
                  <div><p className="text-sm font-semibold text-gray-700">{title}</p><p className="text-xs text-gray-400">{desc}</p></div>
                </div>
              ))}
            </div>
          </div>
        )}
        {messages.map(renderMessage)}
        {isLoading && !streamingMsgIdRef.current && (
          <div className="flex items-center gap-2 px-4 py-3">
            <Avatar role="assistant" />
            <div className="bg-white border border-gray-100 rounded-2xl rounded-tl-md px-4 py-3 shadow-sm">
              <div className="flex gap-1.5">
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.15s' }} />
                <span className="w-1.5 h-1.5 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.3s' }} />
              </div>
            </div>
          </div>
        )}
        <div ref={chatEndRef} />
      </div>
      )}

      {/* DOM select hint */}
      {isSelecting && (
        <div className="px-3 pb-1 shrink-0">
          <div className="bg-indigo-500 rounded-xl px-3 py-2 text-xs text-white flex items-center justify-between shadow-sm">
            <div className="flex items-center gap-2">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 3v18M3 8h5M16 3v18M3 16h5" /></svg>
              <span>拖拽框选页面内容 · 右键/ESC 取消 · 松开即捕获</span>
            </div>
            <button onClick={handleDomSelect} className="text-white/70 hover:text-white font-medium ml-2 px-2 py-0.5 bg-white/15 rounded-lg">取消</button>
          </div>
        </div>
      )}

      {/* Pending selection popup */}
      {pendingSelections.length > 0 && (
        <div className="px-3 pb-1 shrink-0">
          <div className="bg-white border border-indigo-200 rounded-2xl p-4 shadow-lg">
            <p className="text-sm font-semibold text-gray-800 mb-1">
              已选取 {pendingSelections.length} 段内容（{pendingSelections.reduce((s, t) => s + t.length, 0)} 字符）
            </p>
            {pendingSelections.map((s, i) => (
              <div key={i} className="text-xs text-gray-500 mb-2 pl-2 border-l-2 border-indigo-200">
                <span className="text-indigo-400 font-medium">[区域 {i + 1}]</span> {s.slice(0, 80)}...
              </div>
            ))}
            <div className="flex items-center gap-2 mb-3">
              <span className="text-xs text-gray-400">继续点击「选取文本」追加更多</span>
              <button onClick={handleCancelSelection} className="text-xs text-gray-400 hover:text-red-400 ml-auto">清空</button>
            </div>
            <input
              type="text" value={selectionDesc}
              onChange={(e) => setSelectionDesc(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') handleSubmitSelection(); }}
              placeholder="描述这些数据是什么（如：Top10商品的标题和价格）"
              className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm mb-3 focus:outline-none focus:border-indigo-400"
            />
            <button onClick={handleSubmitSelection} className="bg-indigo-500 hover:bg-indigo-600 text-white px-4 py-1.5 rounded-xl text-sm font-medium transition-all w-full">
              发送全部选中的内容
            </button>
          </div>
        </div>
      )}

      {/* Action bar */}
      <div className="px-3 pt-1 pb-0 shrink-0">
        <button
          onClick={handleDomSelect}
          disabled={isLoading}
          className={`w-full flex items-center justify-center gap-2 py-2 rounded-xl text-xs font-medium transition-all disabled:opacity-40 ${
            isSelecting
              ? 'bg-indigo-100 text-indigo-600 border border-indigo-200'
              : 'bg-white text-gray-500 border border-gray-200 hover:border-indigo-200 hover:text-indigo-600 shadow-sm'
          }`}
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><rect x="3" y="3" width="18" height="18" rx="3" /><path d="M8 3v18M3 8h5M16 3v18M3 16h5" /></svg>
          <span>{isSelecting ? '拖拽框选页面内容，松开即捕获…' : '拖拽框选页面内容'}</span>
        </button>
      </div>

      {/* Input */}
      <footer className="p-3 shrink-0">
        <div className="flex items-center gap-2 bg-white rounded-2xl border border-gray-200 px-4 py-1.5 shadow-sm focus-within:border-indigo-300 focus-within:ring-2 focus-within:ring-indigo-100 transition-all">
          <input type="text" value={input}
            onChange={(e) => setInput(e.target.value)} onKeyDown={handleKeyDown}
            placeholder={pageContext ? '追问更多…' : '输入你的问题…'} disabled={isLoading}
            className="flex-1 bg-transparent py-1.5 text-sm outline-none placeholder:text-gray-300 disabled:opacity-40" />
          <button onClick={handleSend} disabled={isLoading || !input.trim()}
            onKeyDown={(e) => { if (e.key === ' ') e.preventDefault(); }}
            className="w-8 h-8 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white flex items-center justify-center disabled:opacity-30 disabled:cursor-not-allowed transition-all hover:shadow-md active:scale-90 flex-shrink-0">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M22 2L11 13" /><path d="M22 2L15 22L11 13L2 9L22 2Z" /></svg>
          </button>
        </div>
      </footer>
    </div>
  );
}

function download(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 100);
}
