// C.5 端到端验证探针：跑生产 bootstrap()，验证
//   右键菜单 → 一次发散 3 条（含并发） → 重新生成（追加版本） → 翻案回退 → 落盘
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-c5-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/** 轮询等待：React Flow 的边比节点晚一帧渲染，固定 sleep 会偶发读到 edges=0。 */
async function waitFor(pred, timeoutMs = 6000) {
  const t0 = Date.now()
  for (;;) {
    if (await pred()) return true
    if (Date.now() - t0 > timeoutMs) return false
    await sleep(100)
  }
}
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  win.webContents.on('preload-error', (_e, p, err) => console.log('  PRELOAD_ERROR', p, err && err.message))
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(900)
  const js = (code) => win.webContents.executeJavaScript(code)

  const nodeCount = () => js('document.querySelectorAll(".react-flow__node").length')
  const edgeCount = () => js('document.querySelectorAll(".react-flow__edge").length')
  const previewText = () =>
    js(`(() => {
      const el = document.querySelector('[data-testid="preview-markdown"]') || document.querySelector('[data-testid="preview-text"]');
      return el ? el.innerText.replace(/\\n+/g, ' | ') : '(none)';
    })()`)
  const currentVersion = () =>
    js(`(() => {
      const el = document.querySelector('[data-testid="version-item"][data-current="1"]');
      return el ? Number(el.getAttribute('data-version')) : 0;
    })()`)

  // ---------- 1. 初始状态 ----------
  check('initial canvas has 1 root node', (await nodeCount()) === 1)
  check('no edges initially', (await edgeCount()) === 0)

  // ---------- 2. 右键节点 → 上下文菜单 ----------
  const rc = await js(`(() => {
    const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.innerText.includes('创意主题'));
    if (!el) return 'NOT_FOUND';
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }));
    return 'OK';
  })()`)
  check('contextmenu dispatched on node', rc === 'OK', rc)
  await sleep(250)
  check('context menu rendered', await js('!!document.querySelector(\'[data-testid="node-context-menu"]\')'))
  const menuText = await js(
    'document.querySelector(\'[data-testid="node-context-menu"]\').innerText.replace(/\\n/g, " | ")',
  )
  check('menu shows node label', menuText.includes('创意主题'), JSON.stringify(menuText))
  check('menu offers ideasprout', await js('!!document.querySelector(\'[data-testid="menu-ideasprout"]\')'))
  check(
    'menu offers regenerate (first version for empty node)',
    await js('!!document.querySelector(\'[data-testid="menu-regenerate"]\')'),
    JSON.stringify(menuText),
  )

  // ---------- 3. 从菜单发散 ----------
  await js('document.querySelector(\'[data-testid="menu-ideasprout"]\').click()')
  await sleep(250)
  check('context menu closed after choosing', await js('!document.querySelector(\'[data-testid="node-context-menu"]\')'))
  check('dialog opened from menu', await js('!!document.querySelector(\'[data-testid="generate-dialog"]\')'))
  const dlgText = await js('document.querySelector(\'[data-testid="generate-dialog"]\').innerText.replace(/\\n/g," | ")')
  check('dialog knows the parent node', dlgText.includes('基于「创意主题」'), JSON.stringify(dlgText.slice(0, 90)))

  // ---------- 4. 一次发散 3 条（并发）----------
  await js(`(() => {
    const ta = document.querySelector('[data-testid="prompt-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(ta, '三条并行方向');
    ta.dispatchEvent(new Event('input', { bubbles: true }));
    const sel = document.querySelector('[data-testid="count-select"]');
    Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set.call(sel, '3');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  check('count select set to 3', (await js('document.querySelector(\'[data-testid="count-select"]\').value')) === '3')
  await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
  await sleep(1400)

  // ⚠️ 等待的谓词必须就是断言值本身：写 waitFor(>=N) 再断言 ===N 等于没等（一到就放行）。
  //    节点/边是异步渲染的，React Flow 的边还比节点晚一帧。
  await waitFor(async () => (await nodeCount()) === 4)
  check('canvas gained 3 children', (await nodeCount()) === 4, 'nodes=' + (await nodeCount()))
  await waitFor(async () => (await edgeCount()) === 3, 8000)
  check('3 edges from parent', (await edgeCount()) === 3, 'edges=' + (await edgeCount()))
  check('no error banner', await js('!document.querySelector(\'[data-testid="app-error"]\')'))
  check('no warning banner (nothing failed)', await js('!document.querySelector(\'[data-testid="app-warning"]\')'))
  check('first child selected & shows fresh v1', (await currentVersion()) === 1, 'current v' + (await currentVersion()))
  const v1Text = await previewText()
  check('v1 content rendered', v1Text.includes('三条并行方向'), JSON.stringify(v1Text.slice(0, 90)))

  // ---------- 5. 重新生成 → 追加新版本 ----------
  // D.9：点「重新生成」只进入编辑态（描述 → 输入框），确认后才真正生成。
  check('regenerate button present', await js('!!document.querySelector(\'[data-testid="regenerate-node"]\')'))
  await js('document.querySelector(\'[data-testid="regenerate-node"]\').click()')
  await sleep(300)
  check(
    'D.9: regenerate enters edit mode first (no immediate generation)',
    await js('!!document.querySelector(\'[data-testid="prompt-editor"]\')'),
  )
  check(
    'D.9: edit mode offers confirm / save / cancel',
    (await js('!!document.querySelector(\'[data-testid="confirm-regenerate"]\')')) &&
      (await js('!!document.querySelector(\'[data-testid="save-prompt"]\')')) &&
      (await js('!!document.querySelector(\'[data-testid="cancel-edit"]\')')),
  )
  await js('document.querySelector(\'[data-testid="confirm-regenerate"]\').click()')
  await sleep(1200)
  check(
    'D.9: confirmed regenerate leaves edit mode',
    await js('!document.querySelector(\'[data-testid="prompt-editor"]\')'),
  )
  const versionCount = await js('document.querySelectorAll(\'[data-testid="version-item"]\').length')
  check('version history now has 2 entries', versionCount === 2, 'count=' + versionCount)
  check('current version became v2', (await currentVersion()) === 2, 'current v' + (await currentVersion()))
  const v2Text = await previewText()
  check('v2 content differs from v1', v2Text !== v1Text, JSON.stringify(v2Text.slice(0, 90)))
  // 占位生成器带全局序号：v2 的序号应比 v1 更大（说明是新的一次生成，而不是旧内容）
  const seqOf = (t) => {
    const m = /#(\d+)/.exec(t)
    return m ? Number(m[1]) : -1
  }
  check(
    'v2 is a fresh generation (sequence advanced)',
    seqOf(v2Text) > seqOf(v1Text) && seqOf(v1Text) > 0,
    `v1=#${seqOf(v1Text)} v2=#${seqOf(v2Text)}`,
  )

  // 5b. 已有版本的节点，菜单应预告下一个版本号
  await js(`(() => {
    const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => n.innerText.includes('三条并行方向'));
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: r.left + r.width/2, clientY: r.top + r.height/2 }));
  })()`)
  await sleep(250)
  const menuText2 = await js('document.querySelector(\'[data-testid="node-context-menu"]\').innerText.replace(/\\n/g," | ")')
  check('menu previews next version number (v3)', menuText2.includes('v3'), JSON.stringify(menuText2))
  await js('document.querySelector(\'[data-testid="menu-backdrop"]\').click()')
  await sleep(200)
  check('backdrop click closes menu', await js('!document.querySelector(\'[data-testid="node-context-menu"]\')'))

  // ---------- 6. 翻案回 v1 ----------
  check('revert button offered for v1', await js('!!document.querySelector(\'[data-testid="version-revert"]\')'))
  await js('document.querySelector(\'[data-testid="version-revert"]\').click()')
  await sleep(900)
  check('current version back to v1', (await currentVersion()) === 1, 'current v' + (await currentVersion()))
  const afterRevert = await previewText()
  check('content reverted to v1 text', afterRevert === v1Text, JSON.stringify(afterRevert.slice(-40)))
  check(
    'no version was deleted by revert',
    (await js('document.querySelectorAll(\'[data-testid="version-item"]\').length')) === 2,
  )

  // ---------- 7. 落盘 ----------
  const projectsDir = path.join(dataDir, 'projects')
  const files = fs.readdirSync(projectsDir)
  const disk = JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8'))
  const child = disk.tree.nodes.find((n) => (n.prompt || '').includes('三条并行方向（方向 1）')) || disk.tree.nodes[1]
  check('disk has root + 3 children', disk.tree.nodes.length === 4, 'nodes=' + disk.tree.nodes.length)
  check('disk has 3 edges all from root', disk.tree.edges.length === 3 &&
    disk.tree.edges.every((e) => e.source === disk.tree.nodes[0].id), 'edges=' + disk.tree.edges.length)
  check('disk: child has 2 versions', child.versions.length === 2, 'versions=' + child.versions.length)
  check('disk: currentVersionId points at v1 (revert persisted)', child.currentVersionId === child.versions[0].id)
  check('disk: node content matches its current version', child.content === child.versions[0].content)
  check(
    'disk: siblings share x and are staggered 360 apart in y',
    JSON.stringify(disk.tree.nodes.slice(1).map((n) => n.position)) ===
      JSON.stringify([
        { x: 320, y: 0 },
        { x: 320, y: 360 },
        { x: 320, y: 720 },
      ]),
    JSON.stringify(disk.tree.nodes.slice(1).map((n) => n.position)),
  )

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'canvas-screenshot.png'), img.toPNG())
  console.log('  screenshot written: canvas-screenshot.png')

  const pass = results.length > 0 && results.every(Boolean)
  console.log(`\n${pass ? 'C5_E2E_OK' : 'C5_E2E_FAIL'} (${results.filter(Boolean).length}/${results.length})`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
