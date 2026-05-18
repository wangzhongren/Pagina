export function detectPageType(): 'search' | 'product' | 'category' | 'unknown' {
  const url = location.href;
  if (/\/item\.htm/.test(url) || /\/detail\.tmall/.test(url)) return 'product';
  if (/\/category/.test(url) || /\/market/.test(url)) return 'category';
  if (
    document.querySelector('.grid-item') ||
    document.querySelector('.m-itemlist') ||
    document.querySelector('[data-sg-type="item"]') ||
    /list\.taobao/.test(url) ||
    /list\.tmall/.test(url)
  ) return 'search';
  return 'unknown';
}

export function getPageTitle(): string {
  const input = document.querySelector<HTMLInputElement>('#q, input[name="q"]');
  if (input?.value) return input.value;
  const bc = document.querySelector('.breadcrumb, [class*="crumb"]');
  if (bc?.textContent) return bc.textContent.trim().slice(0, 50);
  return document.title || '未知页面';
}
