import { browser } from 'wxt/browser';
import { detectPageType, getPageTitle } from '../lib/parsers/search-page';
import { MessageTypes, type PageData } from '../lib/messaging';

export default defineContentScript({
  matches: ['https://*/*', 'http://*/*'],
  main() {
    sendPageContext();
    watchPageChanges();
    browser.runtime.onMessage.addListener((msg: { type: string }) => {
      if (msg.type === MessageTypes.GET_PAGE_DATA) return Promise.resolve(getCurrentPageData());
      if (msg.type === MessageTypes.START_DOM_SELECT) { startSelect(); return; }
      if (msg.type === MessageTypes.CANCEL_DOM_SELECT) { stopSelect(); return; }
    });
  },
});

// ─── 页面上下文 ────────────────────────────────────

function getCurrentPageData(): PageData | null {
  const pageType = detectPageType();
  if (pageType === 'unknown') return null;
  return { pageType, url: location.href, title: getPageTitle(), pageText: extractPageText(), listings: [] };
}

let lastUrl = location.href;
function sendPageContext(): void {
  const data = getCurrentPageData();
  if (!data) return;
  browser.runtime.sendMessage({ type: MessageTypes.ANALYZE_PAGE, payload: data }).catch(() => {});
}

// ─── DOM 文本提取 ──────────────────────────────────

function extractPageText(): string {
  const skipTags = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'IFRAME', 'SVG']);
  const skipSel = ['.site-nav', '#site-nav', '[class*="nav"]', '[class*="sidebar"]'];
  function walk(el: Element, depth: number): string[] {
    if (depth > 20 || skipTags.has(el.tagName)) return [];
    for (const s of skipSel) { if (el.matches(s)) return []; }
    const r: string[] = [];
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden') return [];
    if (el.tagName === 'IMG') {
      const img = el as HTMLImageElement;
      const src = img.src || img.getAttribute('data-src') || '';
      const w = img.naturalWidth || img.width || 0, h = img.naturalHeight || img.height || 0;
      if (src && w >= 80 && h >= 80 && !/icon|logo|avatar|btn|star|arrow/.test((img.className + (img.getAttribute('alt') || '')).toLowerCase())) {
        r.push(`[图: ${src}]`);
      }
    }
    for (const c of el.children) r.push(...walk(c, depth + 1));
    let t = '';
    for (const n of el.childNodes) { if (n.nodeType === Node.TEXT_NODE) t += n.textContent || ''; }
    const tt = t.trim();
    if (tt && tt.length > 1) r.push(tt);
    return r;
  }
  const root = document.querySelector('main, #content, #page') || document.body;
  const all = walk(root, 0);
  const seen = new Set<string>();
  return all.filter((l) => {
    if (l.startsWith('[图:')) return true;
    if (l.length > 100) return true;
    if (seen.has(l)) return false;
    seen.add(l); return true;
  }).join('\n');
}

function elementToMarkup(el: HTMLElement, seen: Set<string>): string {
  const lines: string[] = [];
  walkMarkup(el, lines, seen, 0);
  return lines.join('\n');
}

function walkMarkup(el: Element, lines: string[], seen: Set<string>, depth: number): void {
  if (depth > 25) return;
  const style = getComputedStyle(el);
  if (style.display === 'none' || style.visibility === 'hidden') return;
  const tag = el.tagName;

  // 图片
  if (tag === 'IMG') {
    const img = el as HTMLImageElement;
    const src = img.src || img.getAttribute('data-src') || '';
    if (src && img.naturalWidth >= 60 && img.naturalHeight >= 60
      && !/icon|logo|avatar|btn|star|arrow/.test((img.className + (img.getAttribute('alt') || '')).toLowerCase())) {
      const key = `![img](${src})`;
      if (!seen.has(key)) { seen.add(key); lines.push(key); }
    }
    return;
  }

  // 表格 → Markdown 表格
  if (tag === 'TABLE') {
    const rows: string[][] = [];
    for (const tr of el.querySelectorAll('tr')) {
      const cells: string[] = [];
      for (const td of tr.querySelectorAll('td, th')) cells.push((td.textContent || '').trim().replace(/\n/g, ' ').slice(0, 80));
      if (cells.length) rows.push(cells);
    }
    if (rows.length >= 2) {
      const colCount = Math.max(...rows.map((r) => r.length));
      const header = rows[0].map((c) => `**${c}**`);
      lines.push('| ' + header.join(' | ') + ' |');
      lines.push('|' + header.map(() => '---').join('|') + '|');
      for (const row of rows.slice(1, 20)) lines.push('| ' + row.join(' | ') + ' |');
      return;
    }
  }

  // 列表
  if (tag === 'UL' || tag === 'OL') {
    for (const li of el.querySelectorAll(':scope > li')) {
      const t = li.textContent?.trim().slice(0, 200);
      if (t) lines.push(`${tag === 'OL' ? '1.' : '-'} ${t}`);
    }
    return;
  }

  // 标题
  const m = tag.match(/^H([1-6])$/);
  if (m) {
    const t = el.textContent?.trim().slice(0, 200);
    if (t) lines.push(`${'#'.repeat(parseInt(m[1]))} ${t}`);
    return;
  }

  // 链接
  if (tag === 'A') {
    const href = (el as HTMLAnchorElement).href;
    const t = el.textContent?.trim();
    if (t && href && !href.startsWith('javascript:')) { lines.push(`[${t.slice(0, 100)}](${href})`); return; }
  }

  // 递归子元素
  for (const child of el.children) walkMarkup(child, lines, seen, depth + 1);

  // 叶节点文本
  let text = '';
  for (const node of el.childNodes) { if (node.nodeType === Node.TEXT_NODE) text += node.textContent || ''; }
  const tt = text.trim();
  if (tt && tt.length > 1 && !seen.has(tt)) {
    seen.add(tt);
    if (el.children.length === 0 || tt.length > 20) lines.push(tt);
  }
}

function sanitizeText(text: string): string {
  return text
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F-\x9F]/g, '')
    .replace(/\\u[0-9a-fA-F]{0,3}(?![0-9a-fA-F])/g, '')
    .replace(/\\x[0-9a-fA-F]?/g, '');
}

// ─── DOM 选择器：拖拽即捕获 ───────────────────────

let selecting = false;
let overlayEl: HTMLDivElement | null = null;
let rectEl: HTMLDivElement | null = null;
let dragStart = { x: 0, y: 0 };

function startSelect(): void {
  if (selecting) return;
  selecting = true;
  overlayEl = document.createElement('div');
  overlayEl.style.cssText = 'position:fixed;inset:0;z-index:2147483645;cursor:crosshair;background:rgba(99,102,241,0.04)';
  document.body.appendChild(overlayEl);
  rectEl = document.createElement('div');
  rectEl.style.cssText = 'position:fixed;pointer-events:none;z-index:2147483646;border:2px dashed #6366f1;background:rgba(99,102,241,0.08);display:none';
  document.body.appendChild(rectEl);
  overlayEl.addEventListener('mousedown', onDown);
  overlayEl.addEventListener('wheel', (e) => { e.preventDefault(); window.scrollBy({ left: e.deltaX, top: e.deltaY }); }, { passive: false });
  overlayEl.addEventListener('contextmenu', (e) => { e.preventDefault(); cancel(); });
  document.addEventListener('keydown', onEsc);
}

function stopSelect(): void {
  selecting = false;
  if (overlayEl) { overlayEl.remove(); overlayEl = null; }
  if (rectEl) { rectEl.remove(); rectEl = null; }
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragUp);
  document.removeEventListener('keydown', onEsc);
}

function onEsc(e: KeyboardEvent) { if (e.key === 'Escape') cancel(); }

function cancel() {
  stopSelect();
  browser.runtime.sendMessage({ type: MessageTypes.CANCEL_DOM_SELECT }).catch(() => {});
}

function pointToElement(x: number, y: number): Element | null {
  if (!overlayEl) return null;
  overlayEl.style.pointerEvents = 'none';
  const el = document.elementFromPoint(x, y);
  overlayEl.style.pointerEvents = 'auto';
  return (!el || el === overlayEl || el === rectEl) ? null : el;
}

function onDown(e: MouseEvent): void {
  e.preventDefault();
  dragStart = { x: e.clientX, y: e.clientY };
  rectEl!.style.display = 'block';
  updateRect(e.clientX, e.clientY);
  document.addEventListener('mousemove', onDragMove);
  document.addEventListener('mouseup', onDragUp);
}

function onDragMove(e: MouseEvent): void { updateRect(e.clientX, e.clientY); }

function onDragUp(e: MouseEvent): void {
  document.removeEventListener('mousemove', onDragMove);
  document.removeEventListener('mouseup', onDragUp);
  rectEl!.style.display = 'none';
  const x1 = Math.min(dragStart.x, e.clientX), y1 = Math.min(dragStart.y, e.clientY);
  const x2 = Math.max(dragStart.x, e.clientX), y2 = Math.max(dragStart.y, e.clientY);

  let found: Element[] = [];
  if (x2 - x1 < 10 && y2 - y1 < 10) {
    // 短距离点击 → 选单个元素
    const el = pointToElement(e.clientX, e.clientY);
    if (el) found = [el];
  } else {
    // 拖拽框选
    for (let y = y1; y <= y2; y += 15)
      for (let x = x1; x <= x2; x += 15) {
        const el = pointToElement(x, y);
        if (el && !found.includes(el)) found.push(el);
      }
  }

  const parts: string[] = [];
  const seen = new Set<string>();
  for (const el of found) {
    const markup = elementToMarkup(el as HTMLElement, seen);
    if (markup) parts.push(markup);
  }

  stopSelect();
  browser.runtime.sendMessage({
    type: MessageTypes.DOM_SELECTED,
    payload: { text: sanitizeText(parts.join('\n---\n')) },
  }).catch(() => {});
}

function updateRect(cx: number, cy: number) {
  if (!rectEl) return;
  Object.assign(rectEl.style, {
    left: Math.min(dragStart.x, cx) + 'px', top: Math.min(dragStart.y, cy) + 'px',
    width: Math.abs(cx - dragStart.x) + 'px', height: Math.abs(cy - dragStart.y) + 'px',
  });
}

// ─── 页面切换 ──────────────────────────────────────

function watchPageChanges(): void {
  const origPush = history.pushState.bind(history);
  const origReplace = history.replaceState.bind(history);
  history.pushState = function (...args) { origPush(...args); onUrlChange(); };
  history.replaceState = function (...args) { origReplace(...args); onUrlChange(); };
  window.addEventListener('popstate', onUrlChange);
  setInterval(() => { if (location.href !== lastUrl) onUrlChange(); }, 2000);
}

function onUrlChange(): void {
  if (location.href === lastUrl) return;
  lastUrl = location.href;
  setTimeout(sendPageContext, 1500);
}
