// C.3 主进程装配：服务(存储+生成器) → IPC handlers → 窗口(preload)。
// 拆出可复用函数，main.ts 只负责调用 bootstrap()。

import { app, BrowserWindow, Menu } from 'electron'
import * as fs from 'fs'
import * as path from 'path'
import * as http from 'http'
import { createServices } from '../core/services'
import { migrateLegacyDataDir } from '../core/storage/data-dir'
import type { AppServices } from '../core/services'
import { registerIpcHandlers, syncAiBackendsOnStartup } from './ipc/handlers'
import { createSecretBox } from './secret-box'

const DEV_SERVER_URL = 'http://localhost:5173'

/** 依据环境变量组装主进程服务。 */
export function createAppServices(): AppServices {
  const dataDir =
    process.env.IDEASPROUT_DATA_DIR || path.join(app.getPath('userData'), 'ideasprout')
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
  const win = new BrowserWindow({
    width: 1280,
    height: 820,
    title: '风衍 IdeaSprout',
    backgroundColor: '#0d1117',
    // 窗口/任务栏图标：开发态从源码目录取（打包后由 exe/dmg 自带图标，找不到就退回默认）。
    icon: fs.existsSync(path.join(app.getAppPath(), 'build', 'icon.ico'))
      ? path.join(app.getAppPath(), 'build', 'icon.ico')
      : undefined,
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
