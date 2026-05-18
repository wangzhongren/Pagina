import React, { useState, useEffect } from 'react';
import { browser } from 'wxt/browser';
import { getSettings, saveSetting } from '../../lib/storage';
import type { Role } from '../../lib/storage';

const DEFAULTS = {
  baseUrl: 'https://api.anthropic.com',
  model: 'claude-opus-4-7',
};

const PAGE_PATTERN_LABELS: Record<string, string> = {
  search: '搜索结果页',
  product: '商品详情页',
  category: '类目/市场页',
};

type Tab = 'api' | 'roles';

export default function App() {
  const [tab, setTab] = useState<Tab>('api');
  const [loaded, setLoaded] = useState(false);

  // API settings
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(DEFAULTS.baseUrl);
  const [model, setModel] = useState(DEFAULTS.model);
  const [maxTokens, setMaxTokens] = useState('32768');
  const [saved, setSaved] = useState(false);

  // Roles
  const [roles, setRoles] = useState<Role[]>([]);
  const [editingRole, setEditingRole] = useState<Role | null>(null);
  const [editForm, setEditForm] = useState({ name: '', urlPattern: '', prompt: '' });

  useEffect(() => {
    Promise.all([getSettings(), browser.runtime.sendMessage({ type: 'GET_ALL_ROLES' })]).then(
      ([s, r]) => {
        setApiKey(s.apiKey || '');
        setBaseUrl(s.baseUrl || DEFAULTS.baseUrl);
        setModel(s.model || DEFAULTS.model);
        setMaxTokens(String(s.maxTokens || 32768));
        setRoles(r as Role[] || []);
        setLoaded(true);
      }
    );
  }, []);

  const handleSaveApi = async () => {
    await saveSetting('apiKey', apiKey.trim());
    await saveSetting('baseUrl', baseUrl.trim() || DEFAULTS.baseUrl);
    await saveSetting('model', model.trim() || DEFAULTS.model);
    await saveSetting('maxTokens', parseInt(maxTokens) || 32768);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  const handleEditRole = (role: Role) => {
    setEditingRole(role);
    setEditForm({ name: role.name, urlPattern: role.urlPattern, prompt: role.prompt });
  };

  const handleSaveRole = async () => {
    if (!editingRole || !editForm.name.trim()) return;
    const updated: Role = {
      ...editingRole,
      name: editForm.name.trim(),
      urlPattern: editForm.urlPattern.trim(),
      prompt: editForm.prompt.trim(),
      updatedAt: Date.now(),
    };
    await browser.runtime.sendMessage({ type: 'SAVE_ROLE', payload: updated });
    setRoles((prev) => {
      const exists = prev.find((r) => r.id === updated.id);
      return exists ? prev.map((r) => (r.id === updated.id ? updated : r)) : [...prev, updated];
    });
    setEditingRole(null);
  };

  const handleDeleteRole = async (id: string) => {
    await browser.runtime.sendMessage({ type: 'DELETE_ROLE', payload: { id } });
    setRoles((prev) => prev.filter((r) => r.id !== id));
  };

  const handleNewRole = () => {
    const newRole: Role = {
      id: `role-${Date.now()}`,
      name: '',
      urlPattern: 'search',
      prompt: '',
      isBuiltin: false,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    };
    setEditingRole(newRole);
    setEditForm({ name: '', urlPattern: 'search', prompt: '' });
  };

  if (!loaded) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex gap-1.5">
          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" />
          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.1s' }} />
          <span className="w-2 h-2 bg-indigo-400 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }} />
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-gray-50 via-white to-indigo-50">
      <header className="bg-white border-b border-gray-100">
        <div className="max-w-lg mx-auto px-6 py-4 flex items-center gap-3">
          <div className="w-8 h-8 rounded-xl bg-gradient-to-br from-indigo-500 to-purple-600 flex items-center justify-center shadow-sm">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="22 12 18 12 15 21 9 3 6 12 2 12" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-bold text-gray-800">AI 专家助手</h1>
            <p className="text-xs text-gray-400">设置</p>
          </div>
        </div>
      </header>

      {/* Tabs */}
      <div className="max-w-lg mx-auto px-6 pt-5">
        <div className="flex bg-gray-100 rounded-xl p-1">
          {([
            ['api', 'API 设置'],
            ['roles', '角色管理'],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setTab(key)}
              className={`flex-1 py-2 text-sm font-medium rounded-lg transition-all ${
                tab === key ? 'bg-white text-gray-800 shadow-sm' : 'text-gray-500 hover:text-gray-700'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      <div className="max-w-lg mx-auto px-6 py-5 space-y-5">
        {/* ── API Settings ── */}
        {tab === 'api' && (
          <>
            <ApiCard
              icon="🔑"
              title="API Key"
              desc="Key 仅存储在你的浏览器本地 IndexedDB 中"
            >
              <input
                type="password"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="sk-ant-api03-..."
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300 mb-4"
              />
              <div className="flex items-center gap-2">
                <button onClick={handleSaveApi} className="bg-indigo-500 hover:bg-indigo-600 text-white px-5 py-2 rounded-xl text-sm font-medium transition-all active:scale-95">
                  保存设置
                </button>
                <button onClick={() => { saveSetting('apiKey', ''); setApiKey(''); }} className="text-gray-400 hover:text-red-500 px-3 py-2 rounded-xl text-sm transition-colors">
                  清除 Key
                </button>
                {saved && <span className="text-emerald-500 text-sm font-medium">已保存</span>}
              </div>
            </ApiCard>

            <ApiCard icon="🌐" title="Base URL" desc="API 请求地址，使用代理或兼容接口时修改">
              <input type="text" value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder={DEFAULTS.baseUrl}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300" />
            </ApiCard>

            <ApiCard icon="🧠" title="模型名称" desc="支持任何兼容 Anthropic API 的模型">
              <input type="text" value={model} onChange={(e) => setModel(e.target.value)} placeholder={DEFAULTS.model}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all placeholder:text-gray-300" />
              <div className="flex flex-wrap gap-1.5 mt-3">
                {['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5'].map((m) => (
                  <button key={m} onClick={() => setModel(m)}
                    className={`px-2.5 py-1 rounded-lg text-xs transition-all ${model === m ? 'bg-indigo-100 text-indigo-700 font-medium' : 'bg-gray-50 text-gray-500 hover:bg-gray-100'}`}>
                    {m.replace('claude-', '')}
                  </button>
                ))}
              </div>
            </ApiCard>

            <ApiCard icon="📏" title="最大 Token 数" desc="控制 AI 单次回复的最大长度，部分代理有实际上限">
              <input type="number" value={maxTokens} onChange={(e) => setMaxTokens(e.target.value)}
                className="w-full bg-gray-50 border border-gray-200 rounded-xl px-4 py-3 text-sm font-mono focus:outline-none focus:border-indigo-400 focus:ring-2 focus:ring-indigo-100 transition-all" />
            </ApiCard>
          </>
        )}

        {/* ── Role Management ── */}
        {tab === 'roles' && (
          <>
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">角色列表</h2>
              {!editingRole && (
                <button onClick={handleNewRole} className="bg-indigo-500 hover:bg-indigo-600 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-all">
                  + 新建角色
                </button>
              )}
            </div>

            {/* 新建角色表单 */}
            {editingRole && !roles.find((r) => r.id === editingRole.id) && (
              <RoleEditForm editForm={editForm} setEditForm={setEditForm} onSave={handleSaveRole} onCancel={() => setEditingRole(null)} />
            )}

            {roles.map((role) => (
              <div key={role.id} className="bg-white rounded-2xl shadow-sm border border-gray-100 p-4">
                {editingRole?.id === role.id ? (
                  <RoleEditForm editForm={editForm} setEditForm={setEditForm} onSave={handleSaveRole} onCancel={() => setEditingRole(null)} />
                ) : (
                  <div>
                    <div className="flex items-center justify-between mb-1">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm text-gray-800">{role.name}</span>
                        {role.isBuiltin && (
                          <span className="text-[10px] px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded-full">内置</span>
                        )}
                      </div>
                      <div className="flex items-center gap-1">
                        <button onClick={() => handleEditRole(role)}
                          className="text-xs text-gray-400 hover:text-indigo-500 px-2 py-1 transition-colors">
                          编辑
                        </button>
                        {!role.isBuiltin && (
                          <button onClick={() => handleDeleteRole(role.id)}
                            className="text-xs text-gray-400 hover:text-red-500 px-2 py-1 transition-colors">
                            删除
                          </button>
                        )}
                      </div>
                    </div>
                    <p className="text-[10px] text-gray-400 mb-2">
                      {PAGE_PATTERN_LABELS[role.urlPattern] || role.urlPattern}
                    </p>
                    <p className="text-xs text-gray-500 line-clamp-2 font-mono">{role.prompt.slice(0, 100)}</p>
                  </div>
                )}
              </div>
            ))}
          </>
        )}
      </div>
    </div>
  );
}

function RoleEditForm({ editForm, setEditForm, onSave, onCancel }: {
  editForm: { name: string; urlPattern: string; prompt: string };
  setEditForm: React.Dispatch<React.SetStateAction<{ name: string; urlPattern: string; prompt: string }>>;
  onSave: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-indigo-200 p-4 space-y-3">
      <input type="text" value={editForm.name}
        onChange={(e) => setEditForm((f) => ({ ...f, name: e.target.value }))}
        placeholder="角色名称" autoFocus
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-indigo-400" />
      <select value={editForm.urlPattern}
        onChange={(e) => setEditForm((f) => ({ ...f, urlPattern: e.target.value }))}
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm">
        {Object.entries({ search: '搜索结果页', product: '商品详情页', category: '类目/市场页' }).map(([v, l]) => (
          <option key={v} value={v}>{l}</option>
        ))}
        <option value="custom">自定义 URL</option>
      </select>
      {editForm.urlPattern === 'custom' && (
        <input type="text" value={editForm.urlPattern}
          onChange={(e) => setEditForm((f) => ({ ...f, urlPattern: e.target.value }))}
          placeholder="https://*.taobao.com/*"
          className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-indigo-400" />
      )}
      <textarea value={editForm.prompt} rows={5}
        onChange={(e) => setEditForm((f) => ({ ...f, prompt: e.target.value }))}
        placeholder="角色提示词..."
        className="w-full bg-gray-50 border border-gray-200 rounded-xl px-3 py-2 text-sm font-mono resize-none focus:outline-none focus:border-indigo-400" />
      <div className="flex gap-2">
        <button onClick={onSave} disabled={!editForm.name.trim()}
          className="bg-indigo-500 hover:bg-indigo-600 disabled:opacity-40 text-white px-3 py-1.5 rounded-xl text-xs font-medium transition-all">保存</button>
        <button onClick={onCancel} className="text-gray-400 hover:text-gray-600 text-xs">取消</button>
      </div>
    </div>
  );
}

function ApiCard({ icon, title, desc, children }: { icon: string; title: string; desc: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl shadow-sm border border-gray-100 p-5">
      <div className="flex items-center gap-2 mb-1">
        <span className="text-lg">{icon}</span>
        <h2 className="font-semibold text-gray-800">{title}</h2>
      </div>
      <p className="text-xs text-gray-400 mb-4">{desc}</p>
      {children}
    </div>
  );
}
