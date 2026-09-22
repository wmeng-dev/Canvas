// 安全防护端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. 主文档带 CSP，且是收紧后的 prod 策略；
//   B. 站外跳转（https）被拦下并转交系统浏览器，主窗口不被导航走；
//   C. 越界的 file:// 被判定为"外部"（否则生成内容里的 file 链接能把界面换掉）；
//   D. window.open 被拒（不开新窗口），同样转交系统浏览器；
//   E. 非 http/https（javascript:）不会被交给系统浏览器；
//   F. 折腾完这些之后应用仍健康。
// 运行：node_modules/electron/dist/electron.exe probe-security.cjs（需清 ELECTRON_RUN_AS_NODE）
const electron = require('electron')
const { app, BrowserWindow } = electron
const path = require('path')
const os = require('os')
const fs = require('fs')
const { pathToFileURL } = require('url')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-security-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

// ⚠️ 必须在 require bootstrap 之前替换 shell.openExternal：
// 一是测试环境真去调系统浏览器会弹窗；二是"到底有没有把地址交出去"正是要断言的行为。
// （app.ts 编译成 CJS 后是 electron_1.shell.openExternal(...)，运行时查属性，替换有效。）
const opened = []
electron.shell.openExternal = async (url) => {
  opened.push(url)
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}
const info = (name, val) => console.log('  · ' + name + ' = ' + JSON.stringify(val))

const appModule = require(path.join(ROOT, 'dist-electron/main/app'))
const { bootstrap, isInternalUrl } = appModule
bootstrap()

const DIST_INDEX = pathToFileURL(path.join(ROOT, 'dist', 'renderer', 'index.html')).href

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    check('bootstrap 建了窗口', false)
    return finish()
  }
  const wc = win.webContents
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1500)
  const js = (code) => wc.executeJavaScript(code)
  const url = () => wc.getURL()

  // ---------- A. CSP ----------
  console.log('\n[A] 主文档 CSP')
  const csp = await js(
    `(document.querySelector('meta[http-equiv="Content-Security-Policy"]') || {}).content || ''`,
  )
  check('CSP meta 已注入', !!csp, csp ? csp.slice(0, 48) + '…' : '(缺失)')
  check(
    "script-src 收紧到 'self'（无 unsafe-eval / unsafe-inline）",
    /script-src 'self'(;|$)/.test(csp) && !csp.includes('unsafe-eval') && !/script-src[^;]*unsafe-inline/.test(csp),
  )
  check("object-src / base-uri 均为 'none'", csp.includes("object-src 'none'") && csp.includes("base-uri 'none'"))
  check("frame-src 保留 'self'（沙箱预览依赖它）", csp.includes("frame-src 'self'"))

  // ---------- C（先做纯函数判定，快且无副作用）----------
  console.log('\n[C] 内部 / 外部 URL 判定')
  check('自己的构建产物 → 内部', isInternalUrl(DIST_INDEX) === true, DIST_INDEX)
  check('dev server → 内部', isInternalUrl('http://localhost:5173/') === true)
  check('about:srcdoc → 内部（沙箱 iframe）', isInternalUrl('about:srcdoc') === true)
  check('站外 https → 外部', isInternalUrl('https://example.com/evil') === false)
  check('越界 file:// → 外部', isInternalUrl('file:///C:/Windows/win.ini') === false)
  check('javascript: → 外部', isInternalUrl('javascript:alert(1)') === false)

  // ---------- B. 站外跳转 ----------
  console.log('\n[B] 站外跳转（https）')
  const before = url()
  await js(`location.href = 'https://example.com/evil'`)
  await sleep(700)
  check('主窗口没有被导航走', url() === before, url().slice(0, 56))
  check('地址被转交系统浏览器', opened.includes('https://example.com/evil'), JSON.stringify(opened))
  check('界面仍在（root 有内容）', await js(`document.getElementById('root').childElementCount > 0`))

  // ---------- D. window.open ----------
  console.log('\n[D] window.open / target=_blank')
  const openedBeforeD = opened.length
  const winCountBefore = BrowserWindow.getAllWindows().length
  const ret = await js(`String(window.open('https://example.com/popup'))`)
  await sleep(600)
  check('window.open 返回 null（被拒）', ret === 'null', ret)
  check('没有新开窗口', BrowserWindow.getAllWindows().length === winCountBefore, BrowserWindow.getAllWindows().length + ' 个窗口')
  check('地址被转交系统浏览器', opened.length === openedBeforeD + 1 && opened.includes('https://example.com/popup'))

  // ---------- E. 非 http/https 协议 ----------
  console.log('\n[E] 非 http/https 协议')
  const openedBeforeE = opened.length
  await js(`location.href = 'javascript:void(0)'`)
  await sleep(500)
  check('javascript: 不会被交给系统浏览器', opened.length === openedBeforeE)

  // ---------- F. 折腾完仍然健康 ----------
  console.log('\n[F] 兜完这些之后应用仍健康')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  check('reload 后应用仍渲染', await js(`document.getElementById('root').childElementCount > 0`))
  check('画布入口仍在', await js(`!!document.querySelector('[data-testid="new-idea"]')`))

  info('交给系统浏览器的地址', opened)
  return finish()
}

function finish() {
  const total = results.length
  const passedCount = results.filter(Boolean).length
  console.log(`\nCHROME_E2E ${passedCount === total && total > 0 ? 'OK' : 'FAIL'} (${passedCount}/${total})`)
  if (total === 0) console.log('（零断言 —— 探针本身坏了，视为失败）')
  app.exit(passedCount === total && total > 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    finish()
  }),
)
