// 沿链路生成方案 端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：generateProposal 注入；
//   B. 造出父子两级（根 → 子节点）；
//   C. 预览面板出现「沿链路生成方案」按钮，且显示层数；
//   D. 生成：方案节点出现在画布上、挂在末端节点下、带「方案」标记；
//   E. 落盘：kind=proposal、parentId 指向末端、有边；
//   F. 重载恢复：方案节点还在（标记与内容都在）；
//   G. 回归：发散 / 评论 / 收展 / 回收站 / tab 条都还在。
// 运行：node_modules/electron/dist/electron.exe probe-proposal.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-proposal-'))
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

const projectsDir = path.join(dataDir, 'projects')
const readProjectFile = () => {
  const files = fs.readdirSync(projectsDir)
  return JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8'))
}

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    check('bootstrap 建了窗口', false)
    return finish()
  }
  const wc = win.webContents
  if (wc.isLoading()) await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  const js = (code) => wc.executeJavaScript(code)
  const waitFor = async (pred, timeoutMs = 8000) => {
    const t0 = Date.now()
    for (;;) {
      let v = false
      try { v = await pred() } catch { /* 瞬时错误忽略 */ }
      if (v) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  const setInput = (sel, value) =>
    js(`(() => {
      const el = document.querySelector('${sel}');
      if (!el) return 'MISSING';
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`)
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`)

  const ideaCount = () => js(`document.querySelectorAll('[data-testid="idea-node"]').length`)
  const nodeOnCanvas = (id) => js(`!!document.querySelector('.react-flow__node[data-id="${id}"]')`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 generateProposal', apiKeys.includes('generateProposal'),
    apiKeys.includes('generateProposal') ? 'present' : apiKeys.join(','))
  check('window.ideasprout 必需方法仍在（回归）',
    ['generateNode', 'ensureProject', 'createProject', 'setNodeColor'].every((k) => apiKeys.includes(k)))

  // ---------- B. 造出父子两级 ----------
  console.log('\n[B] 造出父子两级')
  check('初始只有 1 个根节点', await waitFor(async () => (await ideaCount()) === 1))
  const rootId = readProjectFile().tree.nodes[0].id
  await js(`document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="idea-node"]')?.click()`)
  check('预览面板出现"从这里发散"', await waitFor(() =>
    js(`!!document.querySelector('[data-testid="branch-from-node"]')`)))
  await click('[data-testid="branch-from-node"]')
  check('发散对话框打开', await waitFor(() => js(`!!document.querySelector('[data-testid="generate-dialog"]')`)))
  await setInput('[data-testid="prompt-input"]', '子方向：先把成本降下来')
  await sleep(120)
  await click('[data-testid="submit-generate"]')
  check('生成后画布有 2 个节点', await waitFor(async () => (await ideaCount()) === 2))
  const childId = readProjectFile().tree.nodes.find((n) => n.parentId === rootId)?.id
  info('rootId / childId', [rootId, childId])

  // ---------- C. 入口 ----------
  console.log('\n[C] 生成方案入口')
  await js(`document.querySelector('.react-flow__node[data-id="${childId}"] [data-testid="idea-node"]')?.click()`)
  check('预览面板出现「沿链路生成方案」', await waitFor(() =>
    js(`!!document.querySelector('[data-testid="generate-proposal"]')`)))
  const chainLen = await js(`document.querySelector('[data-testid="generate-proposal"]')?.dataset.chainLength`)
  check('按钮上显示 2 层（根 → 子方向）', chainLen === '2', chainLen)

  // ---------- D. 生成 ----------
  console.log('\n[D] 生成方案')
  await click('[data-testid="generate-proposal"]')
  check('画布多出 1 个节点（方案节点）', await waitFor(async () => (await ideaCount()) === 3), await ideaCount())
  const proposalId = await waitFor(() => {
    try {
      const n = readProjectFile().tree.nodes.find((x) => x.kind === 'proposal')
      return n ? n.id : false
    } catch { return false }
  }) && readProjectFile().tree.nodes.find((x) => x.kind === 'proposal')?.id
  info('proposalId', proposalId)
  check('拿到方案节点 id', !!proposalId)
  check('方案节点在画布上', await waitFor(async () => await nodeOnCanvas(proposalId)))
  check('卡片上有「方案」标记', await waitFor(() =>
    js(`!!document.querySelector('.react-flow__node[data-id="${proposalId}"] [data-testid="proposal-badge"]')`)))
  check('生成的方案被自动选中（预览面板能看到内容）', await waitFor(async () =>
    (await js(`document.querySelector('[data-testid="preview-panel"]')?.innerText.length ?? 0`)) > 10))

  // ---------- E. 落盘 ----------
  console.log('\n[E] 落盘')
  const p = readProjectFile().tree.nodes.find((n) => n.id === proposalId)
  check('落盘 kind=proposal', p.kind === 'proposal', p.kind)
  check('挂在链条末端节点下（parentId = 子节点）', p.parentId === childId, p.parentId)
  check('名字带「方案：」前缀', p.label.startsWith('方案：'), p.label)
  check('内容是 markdown', p.contentType === 'markdown', p.contentType)
  check('有正文内容', !!p.content && p.content.length > 0, (p.content || '').slice(0, 40))
  const edges = readProjectFile().tree.edges
  check('有「子节点 → 方案」的边', edges.some((e) => e.source === childId && e.target === proposalId))
  check('末端节点本身没被改写', readProjectFile().tree.nodes.find((n) => n.id === childId).kind === 'idea')

  // ---------- F. 重载 ----------
  console.log('\n[F] 重载后方案还在')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  check('reload 后画布仍是 3 个节点', await waitFor(async () => (await ideaCount()) === 3), await ideaCount())
  check('reload 后方案标记还在', await waitFor(() =>
    js(`!!document.querySelector('.react-flow__node[data-id="${proposalId}"] [data-testid="proposal-badge"]')`)))

  // ---------- G. 回归 ----------
  console.log('\n[G] 回归：其它入口仍在')
  check('画布 tab 条仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="project-tabs"]')`)))
  check('回收站仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin"]')`)))
  check('评论入口仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="toggle-comment"]')`)))
  check('发散入口仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="new-idea"]')`)))

  return finish()
}

function finish() {
  const total = results.length
  const passedCount = results.filter(Boolean).length
  console.log(`\nCHROME_E2E ${passedCount === total && total > 0 ? 'OK' : 'FAIL'} (${passedCount}/${total})`)
  if (total === 0) console.log('（零断言 —— 探针本身坏了，视为失败）')
  app.exit(passedCount === total && total > 0 ? 0 : 1)
}

app.whenReady().then(() => main().catch((e) => {
  console.error('PROBE ERROR:', e)
  finish()
}))
