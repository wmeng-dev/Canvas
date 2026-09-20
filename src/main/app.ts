// C.3 主进程装配：服务(存储+生成器) → IPC handlers → 窗口(preload)。
// 拆出可复用函数，main.ts 只负责调用 bootstrap()。

import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as http from 'http'
import { createServices } from '../core/services'
import type { AppServices } from '../core/services'
import { registerIpcHandlers, syncAiBackendsOnStartup } from './ipc/handlers'
import { createSecretBox } from './secret-box'

const DEV_SERVER_URL = 'http://localhost:5173'

/** 依据环境变量组装主进程服务。 */
export function createAppServices(): AppServices {
  const dataDir =
    process.env.DIVERGE_DATA_DIR || path.join(app.getPath('userData'), 'diverge')
  // 本地示例 MCP Server：编译产物就在 dist-electron/core/mcp-server/ 下。
  // 用 electron 自身的可执行文件当 Node 运行时 —— 子进程加 ELECTRON_RUN_AS_NODE=1 即退化为 Node，
  // 这样打包后不必额外依赖系统 node。环境变量只写必要项（SDK 会自动合并安全默认值），
  // 避免把整个 process.env（含其它密钥）落到 settings.json 里。
  const exampleScript = path.join(__dirname, '../core/mcp-server/workbuddy-mcp-server.js')
  return createServices({
    dataDir,
    secrets: createSecretBox(),
    deepseekApiKey: process.env.DEEPSEEK_API_KEY || undefined,
    fakeGenerator: process.env.DIVERGE_FAKE_GENERATOR === '1',
    exampleMcpServer: {
      name: '本地示例 Server',
      command: process.execPath,
      args: [exampleScript],
      env: { ELECTRON_RUN_AS_NODE: '1', DIVERGE_MCP_FAKE: '1' },
    },
  })
}

/** 是否加载已构建的渲染产物（打包后、或显式 DIVERGE_FORCE_DIST=1）。 */
export function shouldLoadDist(): boolean {
  return app.isPackaged || process.env.DIVERGE_FORCE_DIST === '1'
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
    title: '发散创意画布 · Diverge',
    backgroundColor: '#0d1117',
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
