// 画布外设（右下角）验证：第三方「React Flow」署名已移除，且自家控件/缩略图仍在。
// 重点：不仅断言"署名没了"，还要断言"没被误删别的东西"。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-att-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}
const info = (name, val) => console.log('  · ' + name + ' = ' + JSON.stringify(val))

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) { check('bootstrap 建了窗口', false); return finish() }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1200)

  const js = (code) => win.webContents.executeJavaScript(code)

  // 1) 第三方署名必须消失（包括链接与文末的 data-message 提示）
  const att = await js(`(() => {
    const els = Array.from(document.querySelectorAll('.react-flow__attribution'));
    const links = Array.from(document.querySelectorAll('.react-flow a[href*="reactflow.dev"]'));
    return { count: els.length, links: links.map((a) => a.getAttribute('href')),
             textHit: document.body.innerText.includes('React Flow') };
  })()`)
  info('署名节点', att)
  check('右下角第三方署名节点已移除 (.react-flow__attribution)', att.count === 0, `count=${att.count}`)
  check('画布内不再有指向 reactflow.dev 的链接', att.links.length === 0, JSON.stringify(att.links))
  check('页面文本不再出现「React Flow」', att.textHit === false, `textHit=${att.textHit}`)

  // 2) 不能误删自家控件：缩放控件 / 缩略图 / 背景网格
  const chrome = await js(`(() => ({
    controls: document.querySelectorAll('.react-flow__controls-button').length,
    minimap: document.querySelectorAll('.react-flow__minimap').length,
    minimapNodes: document.querySelectorAll('.react-flow__minimap-node').length,
    background: document.querySelectorAll('.react-flow__background').length,
    zoomIn: !!document.querySelector('.react-flow__controls-zoomin'),
    zoomOut: !!document.querySelector('.react-flow__controls-zoomout'),
    fitView: !!document.querySelector('.react-flow__controls-fitview'),
  }))()`)
  info('画布控件', chrome)
  check('缩放控件仍在（zoomIn/zoomOut/fitView 三个按钮）',
    chrome.zoomIn && chrome.zoomOut && chrome.fitView, `buttons=${chrome.controls}`)
  check('缩略图仍在且画出节点', chrome.minimap === 1 && chrome.minimapNodes > 0, `minimap=${chrome.minimap} nodes=${chrome.minimapNodes}`)
  check('背景网格仍在', chrome.background === 1, `background=${chrome.background}`)

  // 3) 视觉兜底：截右下角一块，人工可比对
  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'ui-12-attribution-removed.png'), img.toPNG())
  console.log('  screenshot written: ui-12-attribution-removed.png')
  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  console.log('\nCHROME_E2E ' + (passed === results.length ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(passed === results.length ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => { console.error('PROBE ERROR:', (e && e.stack) || e); finish() }),
)
