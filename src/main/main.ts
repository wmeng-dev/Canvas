import { app, BrowserWindow } from 'electron'
import * as path from 'path'
import * as http from 'http'

const DEV_SERVER_URL = 'http://localhost:5173'
const isDev = !app.isPackaged

// 开发模式下，Electron 需在 Vite dev server 就绪后再 loadURL。
// 轮询本地端口直到返回响应，避免“vite 还没起好就加载”的竞态。
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
        if (Date.now() - start > timeoutMs) {
          reject(new Error('dev server wait timeout'))
        } else {
          setTimeout(tick, 500)
        }
      })
    }
    tick()
  })
}

function createWindow(): BrowserWindow {
  const win = new BrowserWindow({
    width: 1200,
    height: 800,
    title: '发散创意画布 · Diverge',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      // preload 将在 B/C 阶段加入（用于安全的 IPC 桥接）
    },
  })

  if (isDev) {
    waitForServer(DEV_SERVER_URL)
      .then(() => win.loadURL(DEV_SERVER_URL))
      .catch((e) => console.error('[main] dev server 等待失败:', e))
  } else {
    // 打包后路径：D.2 打包阶段会据此调整 extraResources
    win.loadFile(path.join(__dirname, '../../dist/renderer/index.html'))
  }
  return win
}

app.whenReady().then(() => {
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
