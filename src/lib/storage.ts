import { openDB, type IDBPDatabase } from 'idb';
import type { ChatMessage } from './messaging';

const DB_NAME = 'taobao_ai_agent';
const DB_VERSION = 2;

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (oldVersion < 1) {
          if (!db.objectStoreNames.contains('conversations')) {
            const store = db.createObjectStore('conversations', { keyPath: 'id' });
            store.createIndex('updatedAt', 'updatedAt');
          }
          if (!db.objectStoreNames.contains('settings')) {
            db.createObjectStore('settings', { keyPath: 'key' });
          }
        }
        if (!db.objectStoreNames.contains('roles')) {
          const roleStore = db.createObjectStore('roles', { keyPath: 'id' });
          roleStore.createIndex('urlPattern', 'urlPattern');
        }
      },
    });
  }
  return dbPromise;
}

// ─── 角色系统 ─────────────────────────────────────────

export interface Role {
  id: string;
  name: string;
  urlPattern: string;
  prompt: string;
  isBuiltin: boolean;
  createdAt: number;
  updatedAt: number;
}

export const BUILTIN_ROLES: Omit<Role, 'createdAt' | 'updatedAt'>[] = [
  {
    id: 'builtin-default',
    name: '通用助手',
    urlPattern: 'default',
    isBuiltin: true,
    prompt: `你是 AI 专家助手，一个通用的智能助手。你可以分析任何页面上的数据和内容，不限于特定平台或领域。

## 行为准则
- 根据当前页面实际内容决定分析方向，不要预设领域
- 用具体数字说话，数据不足时直接说出来
- 回复简洁结构化，结尾提供 1-2 个可追问方向
`,
  },
  {
    id: 'builtin-search',
    name: '市场分析师',
    urlPattern: 'search',
    isBuiltin: true,
    prompt: `你是淘宝市场分析师。当前在搜索结果/列表页面，根据商品列表数据帮你判断市场机会。

## 分析维度
1. 竞争格局：头部集中度、品牌/白牌比例
2. 价格带分布：找出空白和红海区间
3. 机会判断：有没有可切入的细分方向

## 输出要求
- 先给总体判断（值得做/谨慎/不推荐），用数据支撑
- 数据不足时直接说出来
- 结尾提供 1-2 个可追问的方向`,
  },
  {
    id: 'builtin-product',
    name: '商品分析师',
    urlPattern: 'product',
    isBuiltin: true,
    prompt: `你是淘宝商品分析师。当前在商品详情页面，帮你分析这个商品的市场定位和竞争力。

## 分析维度
1. 定位：在同类中的价格/品质定位
2. 优势：从详情和评分看亮点
3. 劣势：从评价和问大家找问题
4. 机会：差异化空间在哪

## 输出要求
- 先给结论，再给数据支撑
- 数据不足时明确告知
- 结尾提供 1-2 个可追问的方向
`,
  },
  {
    id: 'builtin-category',
    name: '类目分析师',
    urlPattern: 'category',
    isBuiltin: true,
    prompt: `你是淘宝类目分析师。当前在类目浏览页面，帮你分析这个品类的整体趋势和机会。

## 分析维度
1. 品类趋势：热门方向、价格走势
2. 品牌格局：品牌集中度、新品牌机会
3. 用户画像：主要消费人群特征
4. 机会判断：新品类的切入可能

## 输出要求
- 基于页面数据做判断
- 数据不足时建议如何获取
- 结尾提供 1-2 个可追问的方向`,
  },
  {
    id: 'builtin-stock',
    name: '股票分析师',
    urlPattern: 'stock',
    isBuiltin: true,
    prompt: `你是股票/财经分析师。根据用户提供的股票、基金、行情数据，帮助分析投资价值和风险。

## 分析维度
1. 基本面：市盈率、市净率、ROE、营收增速
2. 技术面：趋势、支撑位、成交量
3. 行业对比：同行业估值水平
4. 风险提示：政策、市场、流动性风险

## 输出要求
- 数据驱动，不猜测没有的数据
- 明确区分事实和观点
- 免责：声明不构成投资建议
- 结尾提供 1-2 个可追问的方向`,
  },
  {
    id: 'builtin-code',
    name: '代码助手',
    urlPattern: 'code',
    isBuiltin: true,
    prompt: `你是编程助手。帮助用户分析代码、调试、优化、解释技术概念。

## 行为准则
- 代码块标注语言类型
- 先理解问题再给方案，不要猜
- 解释为什么这么做，不怎么做
- 简洁直接，不要啰嗦`,
  },
  {
    id: 'builtin-writer',
    name: '文案助手',
    urlPattern: 'writer',
    isBuiltin: true,
    prompt: `你是文案助手。帮助用户撰写、润色、优化各类文案。

## 行为准则
- 先理解目标受众和场景
- 提供多个版本供选择
- 说明每个版本的特点和适用场景
- 保持原意，只在表达上优化`,
  },
  {
    id: 'builtin-translator',
    name: '翻译助手',
    urlPattern: 'translator',
    isBuiltin: true,
    prompt: `你是翻译助手。帮助用户在中文和英文之间进行精准翻译。

## 行为准则
- 保持原文的语气和风格
- 专业术语使用行业标准译法
- 长文本分段输出，便于对照
- 有歧义时标注并提供备选翻译`,
  },
];

export async function getRoleForUrl(url: string): Promise<Role | undefined> {
  const db = await getDB();
  const all = (await db.getAll('roles')) as Role[];

  // 先查自定义角色（精确 URL 匹配）
  const byUrl = all.filter((r) => !r.isBuiltin).sort((a, b) => b.urlPattern.length - a.urlPattern.length);

  for (const role of byUrl) {
    if (matchUrl(url, role.urlPattern)) return role;
  }

  // 内置角色：返回通用助手作为默认
  return all.find((r) => r.isBuiltin && r.urlPattern === 'default');
}

export async function getRole(id: string): Promise<Role | undefined> {
  const db = await getDB();
  return db.get('roles', id);
}

export async function getAllRoles(): Promise<Role[]> {
  const db = await getDB();
  return db.getAll('roles');
}

export async function saveRole(role: Role): Promise<void> {
  const db = await getDB();
  await db.put('roles', { ...role, updatedAt: Date.now() });
}

export async function deleteRole(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('roles', id);
}

export async function ensureBuiltinRoles(): Promise<void> {
  const db = await getDB();
  const currentIds = BUILTIN_ROLES.map((r) => r.id);
  // 删除不在当前列表中的旧内置角色
  const all = (await db.getAll('roles')) as Role[];
  for (const role of all) {
    if (role.isBuiltin && !currentIds.includes(role.id)) {
      await db.delete('roles', role.id);
    }
  }
  // 新增/更新当前列表中的内置角色
  for (const role of BUILTIN_ROLES) {
    const existing = await db.get('roles', role.id);
    if (!existing || (existing as Role).prompt !== role.prompt) {
      await db.put('roles', { ...role, createdAt: (existing as Role)?.createdAt || Date.now(), updatedAt: Date.now() });
    }
  }
}

// ─── URL 匹配 ─────────────────────────────────────────

function matchUrl(url: string, pattern: string): boolean {
  if (pattern === 'search' || pattern === 'product' || pattern === 'category') {
    return detectUrlType(url) === pattern;
  }
  // 支持通配符 * 匹配
  const regex = new RegExp('^' + pattern.replace(/\*/g, '.*') + '$');
  return regex.test(url);
}

function detectUrlType(url: string): string {
  if (/\/item\.htm/.test(url) || /\/detail\.tmall/.test(url)) return 'product';
  if (/\/category/.test(url) || /\/market/.test(url)) return 'category';
  return 'search';
}

// ─── 对话管理 ─────────────────────────────────────────

export interface Conversation {
  id: string;
  title: string;
  pageUrl: string;
  messages: ChatMessage[];
  createdAt: number;
  updatedAt: number;
}

export async function saveConversation(conv: Conversation): Promise<void> {
  const db = await getDB();
  await db.put('conversations', { ...conv, updatedAt: Date.now() });
}

export async function getConversation(id: string): Promise<Conversation | undefined> {
  const db = await getDB();
  return db.get('conversations', id);
}

export async function listConversations(): Promise<Conversation[]> {
  const db = await getDB();
  const all = await db.getAll('conversations');
  return all.sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 50);
}

export async function deleteConversation(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('conversations', id);
}

// ─── 设置管理 ─────────────────────────────────────────

export interface UserSettings {
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  maxTokens?: number;
}

export async function getSettings(): Promise<UserSettings> {
  const db = await getDB();
  const items = await db.getAll('settings');
  const settings: UserSettings = {};
  for (const item of items) {
    (settings as Record<string, unknown>)[item.key] = item.value;
  }
  return settings;
}

export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', { key, value });
}
