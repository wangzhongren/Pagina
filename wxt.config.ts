import { defineConfig } from 'wxt';

export default defineConfig({
  manifest: {
    name: 'Pagina',
    description: 'AI 驱动的通用页面分析助手，支持多轮对话、DOM 框选、自定义角色',
    version: '0.1.0',
    permissions: ['storage', 'sidePanel', 'tabs', 'scripting'],
    host_permissions: ['https://*/*'],
    icons: {
      16: '/icons/icon.svg',
      48: '/icons/icon.svg',
      128: '/icons/icon.svg',
    },
    action: {
      default_title: 'Pagina - 打开侧边栏',
      default_icon: {
        16: '/icons/icon.svg',
      },
    },
  },
  srcDir: 'src',
  outDir: 'dist',
  publicDir: 'public',
});
