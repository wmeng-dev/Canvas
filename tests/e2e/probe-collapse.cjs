// 节点收展（折叠子树）端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：setNodeCollapsed 注入；
//   B. 造出父子两级（根节点 → 在根节点下发散一个子节点）；
//   C. 收展开关：只有有子节点的卡片才有开关，叶子没有；
//   D. 收起：子节点与边从 DOM 消失，开关显示 "+1"；
//   E. 落盘：项目文件里 collapsed=true；
//   F. 重载恢复：reload 后仍是收起状态（这就是"下次打开保持"）；
//   G. 展开：子节点与边回来，落盘回到 false。
// 运行：node_modules/electron/dist/electron.exe probe-collapse.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-collapse-'))
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
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1500)
  const js = (code) => win.webContents.executeJavaScript(code)
  const waitFor = async (pred, timeoutMs = 8000) => {
    const t0 = Date.now()
    for (;;) {
      let v = false
      try { v = await pred() } catch { /* DOM/读盘瞬时错误忽略 */ }
      if (v) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  const setInput = (sel, value) =>
    js(`(() => {
      const el = document.querySelector('${sel}');
      if (!el) return 'MISSING';
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`)
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`)

  const ideaCount = () => js(`document.querySelectorAll('[data-testid="idea-node"]').length`)
  const edgeCount = () => js(`document.querySelectorAll('.react-flow__edge').length`)
  const toggleCount = () => js(`document.querySelectorAll('[data-testid="collapse-toggle"]').length`)
  // 只认某个节点自己的开关（收起后 DOM 里可能同时存在多个节点的开关）
  const toggleOf = (nodeId) =>
    js(`(() => {
      const el = document.querySelector('.react-flow__node[data-id="${nodeId}"] [data-testid="collapse-toggle"]');
      return el ? { text: el.textContent, collapsed: el.dataset.collapsed, hidden: el.dataset.hidden } : null;
    })()`)
  const clickToggle = (nodeId) =>
    js(`document.querySelector('.react-flow__node[data-id="${nodeId}"] [data-testid="collapse-toggle"]')?.click()`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 setNodeCollapsed', apiKeys.includes('setNodeCollapsed'),
    apiKeys.includes('setNodeCollapsed') ? 'present' : apiKeys.join(','))
  check('window.ideasprout 必需方法仍在（回归）',
    ['ensureProject', 'generateNode', 'setNodeVersion'].every((k) => apiKeys.includes(k)))

  // ---------- B. 造出父子两级 ----------
  console.log('\n[B] 造出父子两级')
  check('初始只有 1 个根节点', await waitFor(async () => (await ideaCount()) === 1))
  const rootId = readProjectFile().tree.nodes[0].id
  info('rootId', rootId)

  // 选中根节点 → 预览面板出现「基于该节点发散」→ 生成一个子节点
  await js(`document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="idea-node"]')?.click()`)
  check('预览面板出现"基于该节点发散"', await waitFor(() =>
    js(`!!document.querySelector('[data-testid="branch-from-node"]')`)))
  await click('[data-testid="branch-from-node"]')
  check('发散对话框打开', await waitFor(() => js(`!!document.querySelector('[data-testid="generate-dialog"]')`)))
  await setInput('[data-testid="prompt-input"]', '子方向：先把成本降下来')
  await sleep(120)
  await click('[data-testid="submit-generate"]')
  check('生成后画布有 2 个节点', await waitFor(async () => (await ideaCount()) === 2))
  check('生成后有 1 条边', await waitFor(async () => (await edgeCount()) === 1))

  const nodesAfterGen = readProjectFile().tree.nodes
  const childId = nodesAfterGen.find((n) => n.parentId === rootId)?.id
  check('子节点 parentId 指向根节点', !!childId, childId)
  info('childId', childId)

  // ---------- C. 开关只在有子节点的卡片上出现 ----------
  console.log('\n[C] 收展开关的出现条件')
  info('toggleCount', await toggleCount())
  info('rootChildCount', await js(
    `document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="idea-node"]')?.dataset.childCount`,
  ))
  check('全画布只有 1 个开关（只有根节点有子节点）', await waitFor(async () => (await toggleCount()) === 1))
  const rootToggle0 = await toggleOf(rootId)
  check('根节点开关存在且为展开态', rootToggle0 && rootToggle0.collapsed === '0', JSON.stringify(rootToggle0))
  check('根节点开关显示"−"', rootToggle0 && rootToggle0.text === '−', rootToggle0 && rootToggle0.text)
  check('叶子节点（子节点）没有开关', (await toggleOf(childId)) === null)

  // ---------- D. 收起 ----------
  console.log('\n[D] 收起：隐藏全部后代')
  await clickToggle(rootId)
  check('子节点从 DOM 消失（只剩根节点）', await waitFor(async () => (await ideaCount()) === 1))
  check('通往子节点的边也隐藏', await waitFor(async () => (await edgeCount()) === 0))
  const rootToggle1 = await toggleOf(rootId)
  check('开关切到收起态', rootToggle1 && rootToggle1.collapsed === '1', JSON.stringify(rootToggle1))
  check('开关显示被隐藏的后代数量 +1', rootToggle1 && rootToggle1.text === '+1', rootToggle1 && rootToggle1.text)
  check('data-hidden=1', rootToggle1 && rootToggle1.hidden === '1')

  // ---------- E. 落盘 ----------
  console.log('\n[E] 落盘')
  const savedRoot = readProjectFile().tree.nodes.find((n) => n.id === rootId)
  check('项目文件里 root.collapsed=true', savedRoot.collapsed === true, String(savedRoot.collapsed))

  // ---------- F. 重载恢复 ----------
  console.log('\n[F] 重载后保持收起（下次打开）')
  await win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(1500)
  check('重载后仍只有 1 个可见节点', await waitFor(async () => (await ideaCount()) === 1))
  const rootToggle2 = await toggleOf(rootId)
  check('重载后开关仍是收起态 +1', rootToggle2 && rootToggle2.collapsed === '1' && rootToggle2.text === '+1',
    JSON.stringify(rootToggle2))

  // ---------- G. 展开 ----------
  console.log('\n[G] 展开：后代回来')
  await clickToggle(rootId)
  check('子节点回到画布', await waitFor(async () => (await ideaCount()) === 2))
  check('边也回来了', await waitFor(async () => (await edgeCount()) === 1))
  const rootToggle3 = await toggleOf(rootId)
  check('开关回到展开态 −', rootToggle3 && rootToggle3.collapsed === '0' && rootToggle3.text === '−',
    JSON.stringify(rootToggle3))
  const savedRoot2 = readProjectFile().tree.nodes.find((n) => n.id === rootId)
  check('项目文件里 root.collapsed=false', savedRoot2.collapsed === false, String(savedRoot2.collapsed))

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
