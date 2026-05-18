import { browser } from 'wxt/browser';
import { MessageTypes, type ChatMessage } from '../lib/messaging';
import { sendMessage } from '../lib/ai/client';
import {
  getSettings, saveConversation,
  getRoleForUrl, ensureBuiltinRoles,
  saveRole, getAllRoles, deleteRole, getRole,
  listConversations, getConversation,
} from '../lib/storage';

interface ActiveSession {
  conversationId: string;
  history: ChatMessage[];
  pageUrl: string;
  pageTitle: string;
  pageType: string;
  roleId: string;
  rolePrompt: string;
}

interface PageContextData {
  pageType: string;
  title: string;
  url: string;
  role: { id: string; name: string; isBuiltin: boolean } | null;
}

let activeSession: ActiveSession | null = null;
let cachedPageContext: PageContextData | null = null;
let cachedPageData: { pageType: string; url: string; title: string; pageText?: string } | null = null;

export default defineBackground(async () => {
  await ensureBuiltinRoles();

  // 保持 worker 存活
  browser.runtime.onConnect.addListener((port) => {
    if (port.name === 'sidepanel-keepalive') {
      port.onDisconnect.addListener(() => {});
    }
  });

  browser.runtime.onMessage.addListener((msg, sender) => {
    switch (msg.type) {
      case MessageTypes.ANALYZE_PAGE:
        return handleAnalyzePage(msg.payload);
      case MessageTypes.CHAT_MESSAGE:
        return handleChatMessage(msg.payload);
      case 'GET_ALL_ROLES':
        return getAllRoles();
      case 'SAVE_ROLE':
        return saveRole(msg.payload as Parameters<typeof saveRole>[0]).then(() => true);
      case 'DELETE_ROLE':
        return deleteRole((msg.payload as { id: string }).id).then(() => true);
      case MessageTypes.SWITCH_ROLE:
        return handleSwitchRole((msg.payload as { roleId: string }).roleId);
      case 'GET_CURRENT_CONTEXT':
        return (async () => {
          const ctx = cachedPageContext || await getOrFetchContext();
          return { context: ctx, messages: activeSession?.history || [] };
        })();
      case MessageTypes.START_DOM_SELECT:
        return forwardToActiveTab(MessageTypes.START_DOM_SELECT);
      case MessageTypes.CANCEL_DOM_SELECT:
        return forwardToActiveTab(MessageTypes.CANCEL_DOM_SELECT);
      case MessageTypes.DOM_SELECTED:
        pushToSidePanel({ type: MessageTypes.DOM_SELECTED, payload: msg.payload });
        return;
      case MessageTypes.CREATE_ROLE:
        return handleCreateRole(msg.payload);
      case 'HEARTBEAT':
        return;
      case 'LIST_CONVERSATIONS':
        return (async () => {
          const list = await listConversations();
          return list.map((c) => ({
            id: c.id, title: c.title, updatedAt: c.updatedAt,
            preview: c.messages.filter((m) => m.role === 'assistant').pop()?.content.slice(0, 100) || '',
          }));
        })();
      case 'LOAD_CONVERSATION':
        return (async () => {
          const { id } = msg.payload as { id: string };
          const conv = await getConversation(id);
          return conv ? { messages: conv.messages } : { messages: [] };
        })();
      default:
        return;
    }
  });
});

// ─── 上下文 ───────────────────────────────────────────

async function getOrFetchContext() {
  if (cachedPageContext) return cachedPageContext;
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return null;
  const isTaobao = (tab.url || '').includes('taobao.com') || (tab.url || '').includes('tmall.com');
  if (isTaobao) {
    let pageData = null;
    try { pageData = await browser.tabs.sendMessage(tab.id, { type: MessageTypes.GET_PAGE_DATA }); } catch { /* ignore */ }
    if (browser.runtime.lastError) browser.runtime.lastError = null;
    if (pageData && (pageData as { url: string }).url) {
      await handleAnalyzePage(pageData);
      return cachedPageContext;
    }
  }
  const role = await getRoleForUrl(tab.url || '');
  cachedPageContext = {
    pageType: 'unknown', title: tab.title || tab.url || '', url: tab.url || '',
    role: role ? { id: role.id, name: role.name, isBuiltin: role.isBuiltin } : null,
  };
  return cachedPageContext;
}

// ─── 页面分析 ────────────────────────────────────────

async function handleAnalyzePage(payload: unknown): Promise<void> {
  const data = payload as { pageType: string; url: string; title: string; pageText?: string };
  if (activeSession?.pageUrl === data.url) return;

  const role = await getRoleForUrl(data.url);
  cachedPageContext = {
    pageType: data.pageType, title: data.title, url: data.url,
    role: role ? { id: role.id, name: role.name, isBuiltin: role.isBuiltin } : null,
  };
  pushToSidePanel({ type: MessageTypes.PAGE_CONTEXT, payload: cachedPageContext });

  if (!role) {
    pushToSidePanel({ type: MessageTypes.ASK_CREATE_ROLE, payload: { url: data.url, pageType: data.pageType, title: data.title } });
    return;
  }
  cachedPageData = data;
}

// ─── 对话 ─────────────────────────────────────────────

async function handleChatMessage(payload: unknown): Promise<void> {
  const { message } = payload as { message: string };

  if (!activeSession) {
    const ctx = cachedPageContext || await getOrFetchContext();
    const roleId = ctx?.role?.id || 'builtin-default';
    const role = await getRole(roleId);
    if (!role) {
      pushToSidePanel({ type: MessageTypes.AI_ERROR, payload: { error: '角色数据异常，请刷新扩展' } });
      return;
    }

    const title = ctx?.title || '对话';
    const url = ctx?.url || '';

    const content = cachedPageData?.pageText
      ? `当前页面「${title}」内容：\n\n${cachedPageData.pageText}\n\n用户问题：${message}`
      : message;

    activeSession = {
      conversationId: `conv-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      history: [{ role: 'user', content, timestamp: Date.now() }],
      pageUrl: url, pageTitle: title, pageType: ctx?.pageType || 'unknown',
      roleId: role.id, rolePrompt: role.prompt,
    };
    cachedPageData = null;
  } else {
    // 页面已切换 → 自动附上新页面上下文
    const ctx = cachedPageContext;
    if (ctx && ctx.url !== activeSession.pageUrl && cachedPageData?.pageText) {
      activeSession.pageUrl = ctx.url;
      activeSession.pageTitle = ctx.title;
      const pageNote = `用户切换到了新页面「${ctx.title}」，以下是新页面的内容：\n\n${cachedPageData.pageText}\n\n用户说：${message}`;
      activeSession.history.push({ role: 'user', content: pageNote, timestamp: Date.now() });
      cachedPageData = null;
    } else {
      activeSession.history.push({ role: 'user', content: message, timestamp: Date.now() });
    }
  }

  await saveConversation({
    id: activeSession.conversationId, title: activeSession.pageTitle, pageUrl: activeSession.pageUrl,
    messages: activeSession.history, createdAt: Date.now(), updatedAt: Date.now(),
  });
  await runAnalysis();
}

// ─── 角色切换 ────────────────────────────────────────

async function handleSwitchRole(roleId: string): Promise<void> {
  const role = await getRole(roleId);
  if (!role) return;
  if (cachedPageContext) {
    cachedPageContext.role = { id: role.id, name: role.name, isBuiltin: role.isBuiltin };
    pushToSidePanel({ type: MessageTypes.PAGE_CONTEXT, payload: cachedPageContext });
  }
  if (!activeSession) return;
  activeSession.roleId = role.id;
  activeSession.rolePrompt = role.prompt;
}

// ─── AI 分析 ─────────────────────────────────────────

async function runAnalysis(): Promise<void> {
  const session = activeSession;
  if (!session) return;

  const settings = await getSettings();
  if (!settings.apiKey) {
    pushToSidePanel({ type: MessageTypes.AI_ERROR, payload: { error: '请先配置 API Key' } });
    return;
  }

  let fullResponse = '';
  let streamBuf = '';
  let streamTimer: ReturnType<typeof setTimeout> | null = null;

  const flushStream = () => {
    if (streamBuf) {
      pushToSidePanel({ type: MessageTypes.AI_RESPONSE, payload: { message: { role: 'assistant', content: streamBuf, timestamp: Date.now() } } });
      streamBuf = '';
    }
    streamTimer = null;
  };

  const pushText = (text: string) => {
    fullResponse += text;
    streamBuf += text;
    if (!streamTimer) streamTimer = setTimeout(flushStream, 30);
  };

  try {
    await sendMessage({
      apiKey: settings.apiKey, baseUrl: settings.baseUrl, model: settings.model,
      maxTokens: settings.maxTokens,
      systemPrompt: session.rolePrompt,
      history: session.history,
      onText: pushText,
      onComplete: (_fullText) => {
        flushStream();
        if (fullResponse) {
          session.history.push({ role: 'assistant', content: fullResponse, timestamp: Date.now() });
          saveConversation({
            id: session.conversationId, title: session.pageTitle, pageUrl: session.pageUrl,
            messages: session.history, createdAt: Date.now(), updatedAt: Date.now(),
          }).catch(() => {});
        }
        // 用 _fullText（SDK 返回的完整文本）覆盖流式片段
        if (_fullText) {
          pushToSidePanel({ type: MessageTypes.AI_RESPONSE, payload: { message: { role: 'assistant', content: _fullText, timestamp: Date.now() }, replace: true } });
        }
        pushToSidePanel({ type: MessageTypes.STREAM_COMPLETE });
      },
      onError: (err) => {
        pushToSidePanel({ type: MessageTypes.AI_ERROR, payload: { error: err.message } });
      },
    });
  } catch (err) {
    pushToSidePanel({ type: MessageTypes.AI_ERROR, payload: { error: err instanceof Error ? err.message : String(err) } });
  }
}

// ─── 辅助 ────────────────────────────────────────────

async function handleCreateRole(payload: unknown): Promise<void> {
  const { name, urlPattern, prompt } = payload as { name: string; urlPattern: string; prompt: string };
  const role = {
    id: `role-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name, urlPattern, prompt, isBuiltin: false,
    createdAt: Date.now(), updatedAt: Date.now(),
  };
  await saveRole(role);
  pushToSidePanel({ type: MessageTypes.ROLE_CREATED, payload: { role } });
}

function pushToSidePanel(msg: Record<string, unknown>): void {
  browser.runtime.sendMessage(msg).catch(() => {});
}

async function forwardToActiveTab(type: string): Promise<void> {
  const [tab] = await browser.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id || !tab.url || !(tab.url.startsWith('http://') || tab.url.startsWith('https://'))) return;
  try { await browser.tabs.sendMessage(tab.id, { type }); } catch { /* content script 未就绪 */ }
}
