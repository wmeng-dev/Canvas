// D.3 端到端验证探针：预览面板宽度可拖拽调整。
// 用【真实鼠标事件】(webContents.sendInputEvent) 拖把手，而不是 JS 改 state ——
// 否则"拖动到底能不能改宽"这条根本没被验证。断言：MIN 夹紧 / 1:1 位移 / MAX 夹紧 / 双击复位 / 布局不挤没画布。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-d3-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1' // 读 dist（刚构建的产物），不依赖 dev server

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

const MIN = 260
const MAX = 960
const DEFAULT = 340

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { check('bootstrap 建了窗口', false); return finish() }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(900)

  const js = (code) => win.webContents.executeJavaScript(code)
  const send = (type, x, y, clickCount = 0) =>
    win.webContents.sendInputEvent({ type, x: Math.round(x), y: Math.round(y), button: 'left', clickCount })

  const panelWidth = async () =>
    Math.round(await js("document.querySelector('[data-testid=preview-panel]').getBoundingClientRect().width"))
  const handleX = async () =>
    Math.round(await js("(() => { const r = document.querySelector('[data-testid=preview-resizer]').getBoundingClientRect(); return r.left + r.width / 2; })()"))
  const handleY = async () =>
    Math.round(await js("(() => { const r = document.querySelector('[data-testid=preview-resizer]').getBoundingClientRect(); return r.top + r.height / 2; })()"))
  const innerWidth = await js('window.innerWidth')
  const expectedMax = Math.min(MAX, Math.max(MIN, innerWidth - 360))

  /** 真实拖拽：从把手中心按下，分步移到 targetX，再松开。 */
  async function dragTo(targetX) {
    const x0 = await handleX()
    const y = await handleY()
    send('mouseMove', x0, y)
    send('mouseDown', x0, y, 1)
    const steps = 8
    for (let i = 1; i <= steps; i++) {
      send('mouseMove', x0 + ((targetX - x0) * i) / steps, y)
      await sleep(25)
    }
    send('mouseUp', targetX, y, 1)
    await sleep(160)
  }

  // --- 1. 结构 ---
  check('把手存在', await js("!!document.querySelector('[data-testid=preview-resizer]')"))
  check(
    '把手是面板的直接子节点、不在滚动区内（滚内容时不会滚走）',
    await js(`(() => {
      const h = document.querySelector('[data-testid=preview-resizer]');
      const panel = document.querySelector('[data-testid=preview-panel]');
      const scroll = document.querySelector('[data-testid=preview-scroll]');
      return h.parentElement === panel && scroll.parentElement === panel && !scroll.contains(h);
    })()`),
  )
  check(
    '滚动区可滚、面板裁切',
    await js(`(() => {
      const cs = getComputedStyle(document.querySelector('[data-testid=preview-scroll]'));
      const cp = getComputedStyle(document.querySelector('[data-testid=preview-panel]'));
      return cs.overflowY === 'auto' && cp.overflow === 'hidden';
    })()`),
  )
  check('把手光标 col-resize', await js("getComputedStyle(document.querySelector('[data-testid=preview-resizer]')).cursor === 'col-resize'"))

  const w0 = await panelWidth()
  check('初始宽度落在 [MIN, MAX]', w0 >= MIN && w0 <= MAX, `w0=${w0}`)

  // --- 2. 向右拖到底 → 夹到 MIN ---
  await dragTo(innerWidth - 4)
  const wMin = await panelWidth()
  check('向右拖到底 → 夹紧到 MIN', wMin === MIN, `${wMin} (期望 ${MIN})`)

  // --- 3. 从 MIN 精确左移 100 → 360（证明位移 1:1、且 state/CSS 同步） ---
  const xBefore = await handleX()
  await dragTo(xBefore - 100)
  const wExact = await panelWidth()
  check('从 MIN 左移 100px → 宽度 360（1:1 位移）', wExact === MIN + 100, `${wExact} (期望 ${MIN + 100})`)
  check(
    'DOM 宽度 == store 的 data-width',
    await js(`Number(document.querySelector('[data-testid=preview-panel]').dataset.width) === Math.round(document.querySelector('[data-testid=preview-panel]').getBoundingClientRect().width)`),
  )

  // --- 4. 向左拖到底 → 夹到 MAX（且给画布留了宽度） ---
  await dragTo(4)
  const wMax = await panelWidth()
  check('向左拖到底 → 夹紧到 MAX', wMax === expectedMax, `${wMax} (期望 ${expectedMax})`)
  check('画布没被挤没（仍 > 0）', (await js("document.querySelector('.react-flow') ? document.querySelector('.react-flow').getBoundingClientRect().width : 0")) > 0)

  // --- 5. 双击把手复位 ---
  // 截图放在复位之前：此刻面板是最宽状态，最能说明"宽度可调"。
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-10-preview-resize.png'), img.toPNG())
  console.log('  screenshot written: ui-10-preview-resize.png（最宽态）')

  const hx = await handleX()
  const hy = await handleY()
  send('mouseMove', hx, hy)
  send('mouseDown', hx, hy, 1); send('mouseUp', hx, hy, 1)
  send('mouseDown', hx, hy, 2); send('mouseUp', hx, hy, 2)
  await sleep(220)
  const wReset = await panelWidth()
  check('双击把手 → 复位到默认 340', wReset === DEFAULT, `${wReset} (期望 ${DEFAULT})`)

  // --- 6. 宽度被持久化（best-effort） ---
  const persisted = await js("(() => { try { return localStorage.getItem('ideasprout.previewWidth'); } catch { return 'ERR'; } })()")
  check('宽度写入 localStorage（best-effort）', persisted === String(DEFAULT), `persisted=${persisted}`)

  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  console.log('\nD3_E2E ' + (passed === results.length ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(passed === results.length ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR:', (e && e.stack) || e); finish() }),
)
