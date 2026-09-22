// Dev 模式验证探针：故意【不设】IDEASPROUT_FORCE_DIST → 走 createMainWindow() 的 dev 分支，
// 即"等 Vite dev server(5173) 就绪 → loadURL"。断言窗口确实加载的是 dev URL、React 挂载成功、
// preload 契约注入、无 console error，并截一张 dev 模式实图。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-dev-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1' // 不真连 AI 后端
// 关键：不设 IDEASPROUT_FORCE_DIST —— 这正是"开发模式"与"打包模式"唯一的区别。

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  check('bootstrap 建了主窗口', !!win)
  if (!win) return finish()

  const errors = []
  win.webContents.on('console-message', (_e, level, message) => {
    if (level >= 3) errors.push(message) // 3 = error
  })
  win.webContents.on('did-fail-load', (_e, code, desc, url) => {
    console.log('  DID_FAIL_LOAD', code, desc, url)
  })

  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1500) // 等 Vite 首屏编译 + React 首次渲染

  // ⚠️ 冷启动时 vite 首次编译可能比 1.5s 慢，直接读 getURL() 会拿到空串误报 —— 改成轮询等待
  const waitFor = async (probe, timeout = 15000) => {
    const end = Date.now() + timeout
    for (;;) {
      const v = await probe()
      if (v) return v
      if (Date.now() > end) return null
      await sleep(300)
    }
  }
  const url = await waitFor(async () => {
    const u = win.webContents.getURL()
    return u.startsWith('http://localhost:5173') ? u : null
  })
  check('窗口加载的是 dev server URL', !!url, url ?? win.webContents.getURL())

  const js = (code) => win.webContents.executeJavaScript(code)

  const mounted = await js("document.querySelectorAll('#root > *').length")
  check('React 已挂载（#root 有子节点）', mounted > 0, 'children=' + mounted)

  const apiCount = await js("Object.keys(window.ideasprout || {}).length")
  check('preload 注入 ideasprout 契约', apiCount > 0, 'keys=' + apiCount)

  const hasCanvas = await js("!!document.querySelector('.react-flow')")
  check('画布 react-flow 已渲染', hasCanvas)

  const title = await js('document.title')
  check('document.title 非空', typeof title === 'string' && title.length > 0, title)

  const viteHmr = await js("!!document.querySelector('script[type=module][src*=\"@vite/client\"]') || !!window.__vite_plugin_react_preamble_installed__")
  check('Vite HMR 客户端已注入（可热更新）', viteHmr)

  check('无 console error', errors.length === 0, errors.slice(0, 3).join(' | '))

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-09-dev-mode.png'), img.toPNG())
  console.log('  screenshot written: ui-09-dev-mode.png')

  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  console.log('\nDEV_E2E ' + (passed === results.length ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(passed === results.length ? 0 : 1)
}

app.on('window-all-closed', () => {})
// 必须在 whenReady 之后再进 main()：bootstrap() 的建窗也挂在 whenReady 上，
// 同步调用 main() 时窗口尚未创建（会误判为"没建窗口"）。
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR', (e && e.stack) || e); finish() }),
)
