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

/**
 * AUDIT_CHUNKS=1 时把"实际进包的第三方包名"打到 stderr（构建期排查开关，不设则零开销）。
 *
 * 用途：核对上面那条"分类必须闭包"的不变量。新增依赖后先跑一次
 *   AUDIT_CHUNKS=1 node node_modules/vite/bin/vite.js build
 * 看清单里多了谁，再决定前缀归到哪一类 —— 漏归一类就会退回 "Circular chunk" 警告
 * （实测踩过：`style-to-js` 留在兜底 vendor，而它依赖的 `style-to-object` 被判进
 * vendor-markdown，两块互相依赖）。别靠猜。
 */
const AUDIT_PKGS: Set<string> | null = process.env.AUDIT_CHUNKS ? new Set<string>() : null
if (AUDIT_PKGS) {
  process.on('exit', () => {
    console.error('\n[AUDIT_CHUNKS] 实际进包的第三方包：\n' + [...AUDIT_PKGS].sort().join(' '))
  })
}

/**
 * 分包策略：把第三方依赖按"是谁在撑"，从应用代码里切出来。
 *
 * 为什么值得切（对 Electron 而言不是"省流量"）：
 *   · 单块 737KB 时，产物里分不清"这次涨的是依赖还是我们自己的代码"——切成
 *     vendor-react / vendor-flow / vendor-markdown 后，体积变化一眼归位。
 *   · Vite 对 >500KB 的块会警告，警告长期存在就会掩盖新出现的体积回归。
 *
 * 为什么**不做**懒加载（试过、不可行，别再试）：
 *   `export/standaloneHtml.tsx` 用同步的 `renderToStaticMarkup` 复用
 *   `ContentPreview → MarkdownView`，它**不能等 Suspense**。所以 markdown 链
 *   必须留在同步依赖图里，`React.lazy` 化会让"导出单文件 HTML"直接崩。
 *
 * ⚠️ 分类必须**闭包**：一个包进了 A 块，它的依赖也得在 A 块（或 A 允许依赖的块）。
 *    否则会出现 "Circular chunk" 警告 —— 实测踩过一次：`style-to-js` 留在兜底
 *    vendor，而它依赖的 `style-to-object` 被判进 vendor-markdown，两个块互相
 *    依赖。加包前先看它拉的是什么。
 *
 * @param id 模块的绝对路径（Rollup 传入）
 */
function manualChunks(id: string): string | undefined {
  if (!id.includes('node_modules')) return undefined
  // 取包名：node_modules/<name> 或 node_modules/@scope/<name>
  const m = id.split(/[\\/]node_modules[\\/]/).pop()
  if (!m) return undefined
  const parts = m.split(/[\\/]/)
  const pkg = parts[0].startsWith('@') ? `${parts[0]}/${parts[1]}` : parts[0]
  if (AUDIT_PKGS) AUDIT_PKGS.add(pkg)

  if (/^(react|react-dom|scheduler)$/.test(pkg)) return 'vendor-react'
  if (/^(@xyflow\/|d3-|classcat$)/.test(pkg)) return 'vendor-flow'
  if (MARKDOWN_PKGS.test(pkg)) return 'vendor-markdown'
  return 'vendor'
}

/**
 * 命中即归入 vendor-markdown 的包。
 * 前缀表是照着"实际进包的第三方包"清单逐条核的（`AUDIT_CHUNKS=1` 跑构建可复现，
 * 见 REFERENCE.md 的做法），不是凭印象写的 —— 漏一个就会退回循环分块警告。
 */
const MARKDOWN_PKGS =
  /^(react-markdown|remark-|rehype-|micromark|mdast-|hast-|unist-|estree-util-|vfile|unified|devlop|bail|trough|extend|is-plain-obj|trim-lines|longest-streak|markdown-table|ccount|character-entities|decode-named-character-reference|property-information|space-separated-tokens|comma-separated-tokens|style-to-js|style-to-object|inline-style-parser|html-url-attributes|stringify-entities|parse-entities|is-alphanumerical|is-alphabetical|is-decimal|is-hexadecimal|is-whitespace-character|is-word-character|is-absolute-url|entities|web-namespaces|html-void-elements|@ungap\/)/

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
    rollupOptions: {
      output: { manualChunks },
    },
  },
}))
