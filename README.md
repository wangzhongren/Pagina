# Pagina

> Page + AI — 浏览器侧边栏 AI 助手，支持 Claude API 兼容的多模型。选中页面文本、切换角色、多轮对话、历史管理。
> 
> 一个完整的 **WXT + React + Claude API** 浏览器扩展示例。

---

## 功能

| 功能 | 说明 |
|------|------|
| 页面感知 | 自动提取当前页 DOM 文本作为上下文 |
| 拖拽框选 | 在页面上直接拖拽选取任意文本发给 AI |
| 多轮对话 | 流式渲染，支持追问和深入分析 |
| 角色系统 | 内置通用/市场/商品/类目/股票/代码/文案/翻译 8 个角色，可自定义 |
| 历史记录 | IndexedDB 持久化，关闭重开不丢失 |
| 导出 | Header 按钮导出 Markdown / CSV |
| 多模型 | 兼容 Claude API、DeepSeek 代理等任意兼容接口 |

---

## 安装

```bash
git clone https://github.com/wangzhongren/Pagina.git && cd Pagina
npm install
npm run build
```

然后在 Chrome 中：
1. 打开 `chrome://extensions/`
2. 开启「开发者模式」
3. 点击「加载已解压的扩展程序」→ 选择 `dist/chrome-mv3`

## 配置

加载扩展后，右键扩展图标 → 选项，填入：

| 字段 | 说明 |
|------|------|
| API Key | 你的 Claude / DeepSeek API Key |
| Base URL | `https://api.anthropic.com` 或代理地址 |
| 模型名称 | `claude-opus-4-7` 等 |
| 最大 Token | 控制单次回复长度 |

---

## 开发

```bash
npm run dev     # 开发模式（热更新）
npm run build   # 生产构建
npm run zip     # 打包为 .zip
```

### 技术栈

| 层 | 技术 |
|----|------|
| 扩展框架 | WXT (WebExtension Tools) |
| 前端 | React 18 + TailwindCSS |
| AI | Claude API (Anthropic SDK) |
| 存储 | IndexedDB (idb) |
| Markdown | marked |

### 项目结构

```
src/
├── entrypoints/
│   ├── content.ts          # 页面注入：DOM 提取 + 拖拽框选
│   ├── background.ts       # Service Worker：API 调用 + 会话管理
│   ├── sidepanel/          # 侧边栏 React UI
│   │   ├── App.tsx         # 聊天界面、拖拽框选、角色切换
│   │   └── style.css
│   └── options/            # 设置页面
├── lib/
│   ├── ai/
│   │   └── client.ts       # Claude API 流式调用 + 文本去重
│   ├── parsers/
│   │   └── search-page.ts  # 页面类型检测 + DOM 文本提取
│   ├── messaging.ts        # 消息类型定义
│   └── storage.ts          # IndexedDB CRUD（角色、会话、设置）
├── public/
│   └── icons/
└── wxt.config.ts
```

### 数据流

```
content.ts (DOM 文本 / 框选)  →  background.ts (Claude API)  →  sidepanel (流式渲染)
                                      ↕
                                  storage.ts (IndexedDB)
```

---

## 角色系统

角色通过 IndexedDB 持久化，支持 CRUD。

### 内置角色

| 角色 | 用途 |
|------|------|
| 通用助手 | 全场景分析，自动匹配 |
| 市场分析师 | 搜索页/列表页 |
| 商品分析师 | 商品详情页 |
| 类目分析师 | 类目/市场页 |
| 股票分析师 | 财报、行情分析 |
| 代码助手 | 代码调试和技术问题 |
| 文案助手 | 文案撰写和润色 |
| 翻译助手 | 中英互译 |

### 自定义角色

在设置页面新建、编辑、删除自定义角色。每个角色绑定 URL 匹配规则，进入对应页面自动激活。

---

## 架构要点

### Manifest V3 Service Worker 保活

- `browser.runtime.connect()` 长连接端口
- 断开后 500ms 自动重连
- 15 秒心跳 ping

### 流式渲染

- 30ms 批量推送，减少消息频率
- SDK 返回全文模式去重（`startsWith` 检测）
- `STREAM_COMPLETE` 信号标记流结束

### 文本去重

部分代理返回累计全文而非增量，客户端自动检测并提取 delta：

```js
if (raw.startsWith(fullText)) {
  delta = raw.slice(fullText.length);
} else {
  delta = raw;
}
```

---

