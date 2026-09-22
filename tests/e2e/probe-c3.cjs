// C.3 端到端验证探针：直接调用生产入口 bootstrap()（真实 IPC handlers + preload + 窗口配置），
// 用假生成器驱动完整链路：点击"新增想法" → 输入 → 生成 → 断言画布新增节点 + 落盘。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-c3-'))
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
  check('bootstrap created a window', !!win)
  if (!win) return finish()

  win.webContents.on('preload-error', (_e, p, err) => {
    console.log('  PRELOAD_ERROR', p, '=>', err && err.message)
  })

  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(900) // 等 React init() 完成 IPC 往返

  const js = (code) => win.webContents.executeJavaScript(code)

  // --- 1. preload 契约是否注入 ---
  const apiKeys = await js('Object.keys(window.ideasprout || {}).sort()')
  // 断言"必需的 API 都在"而非固定数量 —— 数量每加一个后端就会变，写死会反复腐烂。
  const REQUIRED_API = [
    'ensureProject',
    'listGenerators',
    'generateNode',
    'regenerateNode',
    'setNodeVersion',
  ]
  const missing = REQUIRED_API.filter((m) => !apiKeys.includes(m))
  check(
    'window.ideasprout exposes the required API surface',
    missing.length === 0,
    missing.length ? 'missing=' + JSON.stringify(missing) : JSON.stringify(apiKeys),
  )

  // --- 2. 初始状态：项目已加载、只有根节点、无错误 ---
  // ⚠️ 项目文件保存功能（D.11）后，项目名从纯文本改为顶栏 <input data-testid="project-name">，
  // innerText 不再包含它 → 断言改读 input 的 value。
  const projectNameShown = await js('document.querySelector(\'[data-testid="project-name"]\')?.value ?? null')
  check('header shows project name from disk', projectNameShown === '我的创意', JSON.stringify(projectNameShown))
  const nodesBefore = await js('document.querySelectorAll(".react-flow__node").length')
  check('initial canvas has 1 root node', nodesBefore === 1, 'nodes=' + nodesBefore)
  const appError0 = await js('!!document.querySelector(\'[data-testid="app-error"]\')')
  check('no startup error banner', !appError0)

  // --- 3. 点击「＋ 新增想法」→ 对话框出现 ---
  await js('document.querySelector(\'[data-testid="new-idea"]\').click()')
  await sleep(250)
  const dialogOpen = await js('!!document.querySelector(\'[data-testid="generate-dialog"]\')')
  check('dialog opens on click', dialogOpen)
  const genOptions = await js(
    'Array.from(document.querySelectorAll(\'[data-testid="generator-select"] option\')).map(o=>o.value)',
  )
  check('generator list comes from main process', genOptions.includes('fake'), JSON.stringify(genOptions))

  // --- 4. 输入提示词（React 受控 textarea 需走原型 setter + input 事件）---
  const PROMPT = '把核心体验做减法，只保留一条主线'
  await js(`(() => {
    const ta = document.querySelector('[data-testid="prompt-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  const typed = await js('document.querySelector(\'[data-testid="prompt-input"]\').value')
  check('prompt typed into dialog', typed === PROMPT, JSON.stringify(typed))

  // --- 5. 点击「生成」→ IPC 往返 → 新节点落画布 ---
  await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
  await sleep(900)

  const dialogClosed = await js('!document.querySelector(\'[data-testid="generate-dialog"]\')')
  check('dialog closes after generate', dialogClosed)
  const nodesAfter = await js('document.querySelectorAll(".react-flow__node").length')
  check('canvas gained exactly 1 node', nodesAfter === 2, 'nodes=' + nodesAfter)
  await waitFor(async () => (await js('document.querySelectorAll(".react-flow__edge").length')) >= 1)
  const edgesAfter = await js('document.querySelectorAll(".react-flow__edge").length')
  check('root-level node adds no edge', edgesAfter === 0, 'edges=' + edgesAfter)
  const previewText = await js('document.querySelector("aside").innerText.replace(/\\n/g," | ")')
  check('preview shows generated content', previewText.includes(PROMPT), JSON.stringify(previewText.slice(0, 120)))
  const appError1 = await js('!!document.querySelector(\'[data-testid="app-error"]\')')
  check('no error banner after generate', !appError1)

  // --- 6. 落盘校验（主进程真实写入 userData/ideasprout/projects/*.json）---
  const projectsDir = path.join(dataDir, 'projects')
  const files = fs.existsSync(projectsDir) ? fs.readdirSync(projectsDir) : []
  const disk = files.length
    ? JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8'))
    : { tree: { nodes: [], edges: [] } }
  check('project file written to disk', files.length === 1, 'files=' + files.length)
  check('disk has root + generated node', disk.tree.nodes.length === 2, 'nodes=' + disk.tree.nodes.length)
  const gen = disk.tree.nodes[1] || {}
  check('generated node marked done by real generator', gen.status === 'done' && gen.generatorId === 'fake',
    JSON.stringify({ status: gen.status, generatorId: gen.generatorId, label: gen.label }))
  check('generated node carries position', !!gen.position, JSON.stringify(gen.position))

  // --- 7. 第二个场景：从已选节点「从这里发散」→ 应产生子节点 + 1 条边 ---
  const branchBtn = await js('!!document.querySelector(\'[data-testid="branch-from-node"]\')')
  check('branch button available when a node is selected', branchBtn)
  await js('document.querySelector(\'[data-testid="branch-from-node"]\').click()')
  await sleep(250)
  const dialog2 = await js('!!document.querySelector(\'[data-testid="generate-dialog"]\')')
  check('dialog opens for branching', dialog2)
  const dialogText = await js(
    'document.querySelector(\'[data-testid="generate-dialog"]\').innerText.replace(/\\n/g," | ")',
  )
  check('dialog indicates parent context', dialogText.includes('基于'), JSON.stringify(dialogText.slice(0, 80)))

  const CHILD_PROMPT = '支线：保留减法后的听觉线索'
  await js(`(() => {
    const ta = document.querySelector('[data-testid="prompt-input"]');
    const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
    setter.call(ta, ${JSON.stringify(CHILD_PROMPT)});
    ta.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
  await sleep(900)

  const nodes3 = await js('document.querySelectorAll(".react-flow__node").length')
  // ⚠️ 偶发（历史复现率约 1/3）：新节点已进 DOM、磁盘上也有边，但 React Flow 这一轮没把边画出来。
  //    不能只等 ">=1"（那会立刻放行），要等"恰好 1 条"；超时后把现场 dump 出来，下次复现能直接定位。
  const edgeOk = await waitFor(
    async () => (await js('document.querySelectorAll(".react-flow__edge").length')) === 1,
    8000,
  )
  const edges3 = await js('document.querySelectorAll(".react-flow__edge").length')
  check('branching adds 1 node', nodes3 === 3, 'nodes=' + nodes3)
  if (!edgeOk) {
    const dump = await js(`(() => ({
      nodes: document.querySelectorAll('.react-flow__node').length,
      edges: document.querySelectorAll('.react-flow__edge').length,
      handles: document.querySelectorAll('.react-flow__handle').length,
      edgesSvgChildren: document.querySelector('.react-flow__edges')
        ? document.querySelector('.react-flow__edges').children.length : -1,
      nodeClasses: Array.from(document.querySelectorAll('.react-flow__node')).map((n) => n.className),
      banner: (document.querySelector('[data-testid="app-warning"], [data-testid="app-error"]') || {}).innerText || null,
    }))()`)
    console.log('  [DIAG 边未渲染] ' + JSON.stringify(dump))
  }
  check('branching adds exactly 1 edge', edges3 === 1, 'edges=' + edges3)
  const preview3 = await js('document.querySelector("aside").innerText.replace(/\\n/g," | ")')
  check('child content uses parent context', preview3.includes('基于父节点：'), JSON.stringify(preview3.slice(0, 140)))

  const disk3 = JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8'))
  const child = disk3.tree.nodes[2] || {}
  check('disk: child links to its parent', child.parentId === disk3.tree.nodes[1].id,
    JSON.stringify({ childParent: child.parentId, expected: disk3.tree.nodes[1].id }))
  check('disk: edge source/target correct',
    disk3.tree.edges.length === 1 &&
      disk3.tree.edges[0].source === disk3.tree.nodes[1].id &&
      disk3.tree.edges[0].target === child.id)
  // D.7：节点显示名换成了"发散结果标题"，原始输入退到 prompt 字段
  check('child label is the generated result title (not the raw prompt)',
    /^发散方案 #\d+：/.test(child.label) && child.label !== CHILD_PROMPT, JSON.stringify(child.label))
  check('child keeps the raw prompt in its prompt field', child.prompt === CHILD_PROMPT, JSON.stringify(child.prompt))
  check('child carries structured analysis on disk',
    !!child.analysis && child.analysis.feasibility > 0 &&
      Array.isArray(child.analysis.pros) && Array.isArray(child.analysis.cons) && Array.isArray(child.analysis.risks),
    JSON.stringify(child.analysis))
  check('version stores the title + analysis (so 翻案 can restore them)',
    child.versions.length === 1 && child.versions[0].title === child.label &&
      JSON.stringify(child.versions[0].analysis) === JSON.stringify(child.analysis))

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'canvas-screenshot.png'), img.toPNG())
  console.log('  screenshot written: canvas-screenshot.png')

  finish()
}

function finish() {
  const pass = results.length > 0 && results.every(Boolean)
  console.log(`\n${pass ? 'C3_E2E_OK' : 'C3_E2E_FAIL'} (${results.filter(Boolean).length}/${results.length})`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
