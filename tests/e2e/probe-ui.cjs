// UI 走查探针：跑生产构建产物 + 生产 bootstrap()，在若干关键状态各截一张图，
// 供肉眼确认"界面与操作"。（非产品代码，仅本地验证用，已 gitignore）
//
// 输出：ui-01..ui-06*.png

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-ui-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  win.webContents.on('preload-error', (_e, p, err) => console.log('  PRELOAD_ERROR', p, err && err.message))
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1000)
  const js = (code) => win.webContents.executeJavaScript(code)
  const shot = async (name) => {
    const img = await win.webContents.capturePage()
    fs.writeFileSync(path.join(ROOT, name), img.toPNG())
    console.log('  shot ->', name)
  }
  const setCtl = (testid, value, proto, evt) =>
    js(`(() => {
      const el = document.querySelector('[data-testid="${testid}"]');
      Object.getOwnPropertyDescriptor(window.${proto}.prototype,'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('${evt}', { bubbles: true }));
    })()`)
  const rightClick = (label) =>
    js(`(() => {
      const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.innerText.includes(${JSON.stringify(label)}));
      if (!el) return 'NOT_FOUND';
      const r = el.getBoundingClientRect();
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }));
      return 'OK';
    })()`)
  const dismiss = async () => {
    // 只用于关掉右键菜单（点它的背景层）
    await js(`(() => { const b = document.querySelector('[data-testid="menu-backdrop"]'); if (b) b.click(); })()`)
    await sleep(250)
  }

  // ---------- 01 初始：只有一个根节点 ----------
  await shot('ui-01-initial.png')

  // ---------- 造一棵有内容的树：根 → markdown 子 + html 子 + 孙 ----------
  const makeNode = async (parentLabel, prompt, contentType) => {
    if (parentLabel) {
      await rightClick(parentLabel)
      await sleep(220)
      await js('document.querySelector(\'[data-testid="menu-ideasprout"]\').click()')
      await sleep(220)
    } else {
      await js('document.querySelector(\'[data-testid="new-idea"]\').click()')
      await sleep(220)
    }
    await setCtl('prompt-input', prompt, 'HTMLTextAreaElement', 'input')
    if (contentType) await setCtl('content-type-select', contentType, 'HTMLSelectElement', 'change')
    await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
    await sleep(1300)
  }

  await makeNode(null, '把核心体验做减法，只保留一条主线', 'markdown')
  await makeNode(null, '用一张信息图说明取舍', 'html')
  await makeNode('把核心体验做减法', '只留下听觉线索作为唯一锚点', 'markdown')

  // 选中 markdown 子节点，让右侧预览有明显内容
  await js(`(() => {
    const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.innerText.includes('把核心体验做减法'));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`)
  await sleep(400)

  // ---------- 02 画布 + 预览面板（markdown） ----------
  await shot('ui-02-canvas-preview-markdown.png')

  // ---------- 03 预览面板渲染沙箱 HTML ----------
  await js(`(() => {
    const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.innerText.includes('用一张信息图说明取舍'));
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`)
  await sleep(400)
  await shot('ui-03-canvas-preview-html.png')

  // ---------- 04 节点右键菜单 ----------
  await rightClick('把核心体验做减法')
  await sleep(300)
  await shot('ui-04-node-context-menu.png')
  await dismiss()

  // ---------- 05 生成对话框 ----------
  await js('document.querySelector(\'[data-testid="new-idea"]\').click()')
  await sleep(350)
  await setCtl('prompt-input', '再从用户情绪角度发散两条', 'HTMLTextAreaElement', 'input')
  await setCtl('count-select', '2', 'HTMLSelectElement', 'change')
  await sleep(250)
  await shot('ui-05-generate-dialog.png')
  await js('document.querySelector(\'[data-testid="generate-dialog"]\').click()')
  await sleep(300)

  // ---------- 06 AI 后端面板 ----------
  await js('document.querySelector(\'[data-testid="open-ai"]\').click()')
  await sleep(600)
  await shot('ui-06-ai-backends.png')
  await js('document.querySelector(\'[data-testid="ai-close"]\').click()')
  await sleep(300)

  // ---------- 07 导出对话框 ----------
  await js('document.querySelector(\'[data-testid="open-export"]\').click()')
  await sleep(700)
  await setCtl('export-format', 'html', 'HTMLSelectElement', 'change')
  await sleep(250)
  await shot('ui-07-export-dialog.png')
  await js('document.querySelector(\'[data-testid="export-close"]\').click()')
  await sleep(250)

  // ---------- 08 版本历史（重新生成一次制造 v2） ----------
  // D.9：菜单里的「重新生成」先进编辑态，需再点「重新生成」确认才产出 v2。
  await rightClick('把核心体验做减法')
  await sleep(250)
  await js('document.querySelector(\'[data-testid="menu-regenerate"]\').click()')
  await sleep(350)
  await shot('ui-08-edit-prompt.png')
  await js('document.querySelector(\'[data-testid="confirm-regenerate"]\').click()')
  await sleep(1300)
  await shot('ui-08-version-history.png')

  const finalNodes = await js('document.querySelectorAll(".react-flow__node").length')
  const finalEdges = await js('document.querySelectorAll(".react-flow__edge").length')
  console.log(`\n  final canvas: ${finalNodes} nodes / ${finalEdges} edges`)
  console.log('UI_WALKTHROUGH_DONE')
  app.exit(0)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
