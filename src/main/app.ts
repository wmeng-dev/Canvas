// C.3 主进程装配：服务(存储+生成器) → IPC handlers → 窗口(preload)。
// 拆出可复用函数，main.ts 只负责调用 bootstrap()。

import { app, BrowserWindow, Menu, shell } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import { createServices } from '../core/services'
import { migrateLegacyDataDir } from '../core/storage/data-dir'
import type { AppServices } from '../core/services'
import { registerIpcHandlers, syncAiBackendsOnStartup } from './ipc/handlers'
import { createSecretBox } from './secret-box'
import { installAutoUpdate } from './auto-update'

const DEV_SERVER_URL = 'http://localhost:5173'

/** 数据目录：默认 userData/ideasprout，可用 IDEASPROUT_DATA_DIR 覆盖（测试/多套数据靠它）。 */
export function resolveDataDir(): string {
  return process.env.IDEASPROUT_DATA_DIR || path.join(app.getPath('userData'), 'ideasprout')
}

/**
 * 主进程全局错误兜底。
 *
 * 为什么必须落盘：**打包后的 Windows 应用没有附着的控制台**，`console.error` 等于扔进黑洞 ——
 * 用户只会看到"窗口突然没了"，我们这边什么都拿不到。日志写到
 * `<dataDir>/logs/main.log`，超过 256KB 就重开一份（不做复杂轮转）。
 *
 * 装上 handler 之后进程不会再因未捕获异常直接退出 —— 对桌面应用这是更好的取舍
 * （数据本来就随改随存，死在半路比"悄悄消失"更容易排查），所以这里只记录不退出。
 */
/**
 * 往 `<dataDir>/logs/main.log` 追加一行。
 *
 * 单独提成导出函数（而不是留在 installErrorHandlers 内部的闭包）的原因：
 * **自动更新也要写同一份日志**（见 auto-update.ts）。打包后的应用没有控制台，
 * "更新为什么没生效"只能靠这份文件回答，所以它必须能被主进程各处复用。
 */
export function writeMainLog(kind: string, detail: unknown): void {
  const stack = detail instanceof Error ? detail.stack || detail.message : String(detail)
  const line = `[${new Date().toISOString()}] ${kind}: ${stack}\n`
  console.error(`[ideasprout] ${line.trim()}`)
  try {
    const file = path.join(resolveDataDir(), 'logs', 'main.log')
    fs.mkdirSync(path.dirname(file), { recursive: true })
    if (fs.existsSync(file) && fs.statSync(file).size > 256 * 1024) fs.writeFileSync(file, line)
    else fs.appendFileSync(file, line)
  } catch {
    /* 日志写不进去也不能再抛（否则会递归进 handler） */
  }
}

export function installErrorHandlers(): void {
  process.on('uncaughtException', (err) => writeMainLog('未捕获异常', err))
  process.on('unhandledRejection', (reason) => writeMainLog('未处理的 Promise 拒绝', reason))
}

/** 依据环境变量组装主进程服务。 */
export function createAppServices(): AppServices {
  const dataDir = resolveDataDir()
  // 应用改名后数据目录会整体挪位（父目录 = 应用名，子目录 = 品牌名），
  // 不迁移的话用户会以为"画布全没了"。这里把旧目录**复制**过来（旧目录保留不动）。
  if (!process.env.IDEASPROUT_DATA_DIR) {
    const migration = migrateLegacyDataDir(app.getPath('userData'), dataDir)
    if (migration.migrated) {
      console.log(`[ideasprout] 已迁移旧数据目录：${migration.from} → ${migration.to}（旧目录保留）`)
    }
  }
  // 本地示例 MCP Server：编译产物就在 dist-electron/core/mcp-server/ 下。
  // 用 electron 自身的可执行文件当 Node 运行时 —— 子进程加 ELECTRON_RUN_AS_NODE=1 即退化为 Node，
  // 这样打包后不必额外依赖系统 node。
  // ⚠️ IDEASPROUT_DATA_DIR 必须**显式注入**：MCP SDK 的 StdioClientTransport 只继承一份
  // 安全白名单环境变量（Windows 上是 APPDATA/PATH/TEMP 等，见 client/stdio.js 的
  // DEFAULT_INHERITED_ENV_VARS），它不在白名单里，不注入的话示例 Server 就找不到画布数据，
  // 只读 tool（list_projects / get_tree / get_node）会报"找不到数据目录"。
  // 环境变量仍只写必要项（SDK 会自动合并安全默认值），避免把整个 process.env（含其它密钥）
  // 落到 settings.json 里 —— 这里新增的只是一个本地路径，不含敏感信息。
  const exampleScript = path.join(__dirname, '../core/mcp-server/workbuddy-mcp-server.js')
  return createServices({
    dataDir,
    secrets: createSecretBox(),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || undefined,
    fakeGenerator: process.env.IDEASPROUT_FAKE_GENERATOR === '1',
    exampleMcpServer: {
      name: '本地示例 Server',
      command: process.execPath,
      args: [exampleScript],
      env: {
        ELECTRON_RUN_AS_NODE: '1',
        IDEASPROUT_MCP_FAKE: '1',
        IDEASPROUT_DATA_DIR: dataDir,
      },
    },
  })
}

/** 是否加载已构建的渲染产物（打包后、或显式 IDEASPROUT_FORCE_DIST=1）。 */
export function shouldLoadDist(): boolean {
  return app.isPackaged || process.env.IDEASPROUT_FORCE_DIST === '1'
}

/** 生产态渲染产物目录（file:// 白名单只放行这里面的东西）。 */
const DIST_RENDERER_DIR = path.resolve(__dirname, '../../dist/renderer')

/**
 * 渲染端可能自己发起的"合法"导航：
 *   · about: —— srcdoc 沙箱 iframe（预览 html/svg）
 *   · file:  —— **只限我们自己的构建产物目录**。不能放行任意 file:，
 *               否则生成内容里一个 `[x](file:///C:/…)` 同样能把应用界面换掉。
 *   · dev server —— 开发态
 * 其余一律视为"要跑到应用外面去"。
 * （导出是为了让 probe-security.cjs 能直接断言判定结果 —— 纯函数，比"试着导航一下看看"精确得多。）
 */
export function isInternalUrl(raw: string): boolean {
  try {
    const u = new URL(raw)
    if (u.protocol === 'about:') return true
    if (u.protocol === 'file:') {
      // Windows 的 file URL 形如 file:///E:/a/b.html，pathname 是 /E:/a/b.html（多一个前导斜杠）；
      // POSIX 的 pathname 本身就是绝对路径，去掉前导斜杠反而会变成相对路径。故分平台处理。
      const p = decodeURIComponent(u.pathname)
      const abs = process.platform === 'win32' ? path.resolve(p.replace(/^[/\\]/, '')) : path.resolve(p)
      return abs === DIST_RENDERER_DIR || abs.startsWith(DIST_RENDERER_DIR + path.sep)
    }
    return u.origin === DEV_SERVER_URL
  } catch {
    return false
  }
}

/** 只把 http/https 交给系统浏览器；file:、自定义协议、javascript: 一律丢弃。 */
function openExternalIfSafe(raw: string): void {
  try {
    const u = new URL(raw)
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return
    void shell.openExternal(u.toString())
  } catch {
    /* 不是合法 URL：忽略 */
  }
}

/**
 * 外链与跳转防护。
 *
 * 主窗口本身就是"应用"：一旦被内容导航走就回不来（没有后退/刷新，用户只能重启），
 * 而且那个远程页面会跑在挂着 `window.ideasprout` 的窗口里。
 *
 * 当前唯一会把外部地址交出去的入口是 **markdown 预览** —— react-markdown 默认把
 * `[文字](https://…)` 渲染成真 <a href>（html/svg 走 `<iframe sandbox="">` 已被隔离）。
 * 这里挂在 `web-contents-created` 上，是为了把之后新增的任何 WebContents 一并覆盖，
 * 而不是只盯着眼前这一个窗口。
 */
function installNavigationGuards(): void {
  app.on('web-contents-created', (_event, contents) => {
    // window.open / target=_blank：一律不开新窗口，能把浏览器做的事交给系统浏览器。
    contents.setWindowOpenHandler(({ url }) => {
      openExternalIfSafe(url)
      return { action: 'deny' }
    })
    // 页面内发起的跳转（含点 <a href>）：出站就拦下来，改交给系统浏览器。
    contents.on('will-navigate', (event, url) => {
      if (isInternalUrl(url)) return
      event.preventDefault()
      openExternalIfSafe(url)
    })
  })
}

// 开发模式：等 Vite dev server 就绪再 loadURL。
function waitForServer(url: string, timeoutMs = 30000): Promise<void> {
  const u = new URL(url)
  const start = Date.now()
  return new Promise((resolve, reject) => {
    const tick = () => {
      const req = http.get({ hostname: u.hostname, port: u.port, path: '/' }, (res) => {
        res.destroy()
        resolve()
      })
      req.on('error', () => {
        if (Date.now() - start > timeoutMs) reject(new Error('dev server wait timeout'))
        else setTimeout(tick, 500)
      })
    }
    tick()
  })
}

export function createMainWindow(): BrowserWindow {
  // 窗口/任务栏图标：开发态从源码目录取（打包后由 exe/dmg 自带图标，找不到就退回默认）。
  // ⚠️ 文件不存在时要**整个键都不给**，不能写 `icon: undefined` —— 键在就会被 Electron
  // 拿去建 NativeImage，于是每次建窗都刷一条 `Argument must be a file path or a NativeImage`
  // 警告（探针日志里会淹没真正有用的报错）。
  const iconPath = path.join(app.getAppPath(), 'build', 'icon.ico')
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '风衍 IdeaSprout',
    backgroundColor: '#0d1117',
    ...(fs.existsSync(iconPath) ? { icon: iconPath } : {}),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // Electron 默认 sandbox:true，会禁止 preload 做相对路径 require（只允许 require('electron')），
      // 于是 preload 里 `require('../shared/ipc')` 会报 module not found、contextBridge 不执行。
      // 这里关闭沙箱：渲染进程仅加载本地构建产物（无远程内容），且 contextIsolation 仍开启，
      // 换来 preload 能直接复用 shared/ipc 契约（单一事实来源，不重复维护频道名）。
      sandbox: false,
      preload: path.join(__dirname, 'preload.js'),
    },
  })

  if (shouldLoadDist()) {
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'))
  } else {
    waitForServer(DEV_SERVER_URL)
      .then(() => win.loadURL(DEV_SERVER_URL))
      .catch((e) => console.error('[main] dev server 等待失败:', e))
  }
  return win
}

export function bootstrap(): void {
  // 错误兜底要第一个装：后面任何一步（建窗口、装配服务）抛出的未捕获异常
  // 都应该留下痕迹，而不是让打包后的应用"静默消失"。
  installErrorHandlers()
  // 防护必须在建窗口之前挂好，否则第一个窗口的 WebContents 会漏掉。
  installNavigationGuards()

  app.whenReady().then(() => {
    // 不要系统默认菜单（File / Edit / View / Window / Help）：那是 Electron 在 dev 下
    // 露出来的"开发者残影"（含 Reload / Toggle Developer Tools / About 等），产品里显得业余。
    // Windows/Linux 上把应用菜单设成 null 即可让顶部菜单栏消失。
    // ⚠️ macOS 不能整条拿掉（App 菜单是系统规范、且拿掉后应用行为异常），
    // 所以只在非 darwin 平台设 null；mac 上保持默认即可。
    // ⚠️ 副作用：默认菜单绑定的快捷键（Ctrl+Shift+I 开 DevTools、Ctrl+R 重载等）
    // 会一并消失；但输入框内的复制/粘贴/撤销由 Chromium 原生处理，与菜单无关，不受影响。
    // ⚠️ 必须在 ready 之后调用（Menu API 在 ready 前不可用）。
    if (process.platform !== 'darwin') Menu.setApplicationMenu(null)

    // 服务必须在 ready 之后装配：safeStorage 等 Electron API 在 ready 前不可用，
    // 过早构造会让密钥封装误判为"无加密能力"而悄悄降级为明文（见 secret-box.ts）。
    const services = createAppServices()
    registerIpcHandlers(services)
    createMainWindow()
    // 自动更新：只在打包态启用，且内部有 8s 延迟 —— 不与开窗、拉 MCP 子进程抢 I/O。
    // 必须放在 createMainWindow() 之后：更新完成后的询问对话框要挂到主窗口上。
    installAutoUpdate({ log: writeMainLog })
    // 后台接起已配置的 AI 后端（MCP 要拉子进程，不能阻塞开窗）
    void syncAiBackendsOnStartup(services)
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createMainWindow()
    })
  })

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
