import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import * as path from 'path'

/**
 * 主文档的 CSP。
 *
 * 为什么用 <meta http-equiv> 而不是主进程的 onHeadersReceived：
 * 生产态页面走 `file://`，那种响应没有 HTTP 头可改，只有 meta 能生效。
 * （打包后 Electron 每次启动都会打 "Insecure Content-Security-Policy" 警告，看的就是它。）
 *
 * 为什么要分 dev / prod 两套：
 *   · dev 要多放 `ws:`（Vite HMR 的 websocket）和 script 的 `'unsafe-inline'`（react-refresh 注入）
 *   · prod 收紧到 `'self'`。渲染端本身**不发任何网络请求**（DeepSeek / MCP 调用全在主进程，
 *     密钥也不出主进程），所以 `connect-src 'self'` 够用。
 *
 * 几处刻意的取舍（改之前先读）：
 *   · style 一直允许 `'unsafe-inline'` —— React 的 style 属性走 CSSOM，不受 CSP 管；
 *     但 Vite 在 dev 下把样式作为内联 <style> 注入，且界面里确有内联样式。
 *   · img-src 放行 `https:` —— 保证 markdown 里的 `![](https://…)` 仍能显示。
 *     若更在意隐私（远程图片＝可被用来回传"你打开了这个节点"），删掉 `https:` 即可。
 *   · frame-src 必须留 `'self'` —— html/svg 预览是 `<iframe sandbox="" srcDoc>`。
 */
function cspPlugin(isDev: boolean): Plugin {
  const policy = [
    "default-src 'self'",
    isDev ? "script-src 'self' 'unsafe-inline'" : "script-src 'self'",
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob: https:",
    "font-src 'self' data:",
    isDev ? "connect-src 'self' ws:" : "connect-src 'self'",
    "frame-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ')

  return {
    name: 'ideasprout-csp',
    transformIndexHtml: {
      order: 'pre',
      handler() {
        return [
          {
            tag: 'meta',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: policy },
            injectTo: 'head-prepend',
          },
        ]
      },
    },
  }
}

// 渲染进程（React）由 Vite 构建；主进程（Electron）由 tsc 编译到 dist-electron。
export default defineConfig(({ command }) => ({
  plugins: [react(), cspPlugin(command === 'serve')],
  root: path.resolve(__dirname, 'src/renderer'),
  base: './',
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: path.resolve(__dirname, 'dist/renderer'),
    emptyOutDir: true,
  },
}))
