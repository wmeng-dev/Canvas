// 多画布（tab 条）端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：listProjects / createProject / switchProject 注入；
//   B. tab 条：初始 1 个 tab，当前 tab 内嵌可编辑画布名；
//   C. 新建画布：tab +1，新画布**空白**（0 节点），并自动切过去；
//   D. 切回老画布：节点还在（tab 切换不丢内容）；
//   E. 在空白画布上发散：自动立顶层主题节点（可手写 / AI 生成），发散结果挂在它下面
//      —— 而不是变成一堆并列的孤立根节点；
//   F. 落盘 + 重载：回到上次那张画布（tab 状态保持）；
//   G. 回归：评论 / 收展 / 回收站 / 配色入口都还在。
// 运行：node_modules/electron/dist/electron.exe probe-canvases.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-canvases-'))
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
const projectFiles = () => fs.readdirSync(projectsDir).filter((f) => f.endsWith('.json'))
const readProjectFile = (id) => JSON.parse(fs.readFileSync(path.join(projectsDir, `${id}.json`), 'utf8'))
const appState = () => {
  try {
    return JSON.parse(fs.readFileSync(path.join(dataDir, 'app-state.json'), 'utf8'))
  } catch {
    return null
  }
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

  const tabCount = () => js(`document.querySelectorAll('[data-testid="project-tab"]').length`)
  const ideaCount = () => js(`document.querySelectorAll('[data-testid="idea-node"]').length`)
  const activeTabId = () =>
    js(`document.querySelector('[data-testid="project-tab"][data-active="1"]')?.dataset.projectId`)
  const nameValue = () => js(`document.querySelector('[data-testid="project-name"]')?.value`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 list/create/switch',
    ['listProjects', 'createProject', 'switchProject'].every((k) => apiKeys.includes(k)),
    apiKeys.filter((k) => ['listProjects', 'createProject', 'switchProject'].includes(k)).join(','))
  check('window.ideasprout 必需方法仍在（回归）',
    ['ensureProject', 'generateNode', 'setNodeColor', 'setNodeArchived'].every((k) => apiKeys.includes(k)))

  // ---------- B. tab 条 ----------
  console.log('\n[B] tab 条初始状态')
  check('初始 1 个 tab', await waitFor(async () => (await tabCount()) === 1), await tabCount())
  const firstId = await activeTabId()
  info('firstTabId', firstId)
  check('当前 tab 有 data-active=1', !!firstId)
  check('当前 tab 内嵌画布名输入框（= 顶栏那个 project-name）',
    (await nameValue()) === '我的创意', await nameValue())
  check('初始画布有 1 个根节点', await waitFor(async () => (await ideaCount()) === 1))

  // ---------- C. 新建画布 = 空白 ----------
  console.log('\n[C] 新建画布（空白页）')
  await click('[data-testid="new-canvas"]')
  check('tab 变成 2 个', await waitFor(async () => (await tabCount()) === 2), await tabCount())
  check('自动切到新画布', await waitFor(async () => (await activeTabId()) !== firstId))
  const secondId = await activeTabId()
  info('secondTabId', secondId)
  check('新画布是空白的（0 个想法节点）', await waitFor(async () => (await ideaCount()) === 0), await ideaCount())
  check('落盘也是 0 节点', await waitFor(() => {
    try { return readProjectFile(secondId).tree.nodes.length === 0 } catch { return false }
  }))
  check('磁盘上有 2 个画布文件', projectFiles().length === 2, projectFiles().length)
  check('app-state 记住了新画布', await waitFor(() => appState()?.lastProjectId === secondId),
    JSON.stringify(appState()))
  check('新画布默认名「未命名画布」', (await nameValue()) === '未命名画布', await nameValue())

  // ---------- D. 切回老画布 ----------
  console.log('\n[D] 切回老画布')
  await js(`document.querySelector('[data-testid="project-tab"][data-project-id="${firstId}"]')?.click()`)
  check('当前 tab 回到第一张', await waitFor(async () => (await activeTabId()) === firstId))
  check('老画布的节点还在（切 tab 不丢内容）', await waitFor(async () => (await ideaCount()) === 1), await ideaCount())
  check('画布名也切回来了', await waitFor(async () => (await nameValue()) === '我的创意'), await nameValue())

  // 再切回新画布，确认仍是空白
  await js(`document.querySelector('[data-testid="project-tab"][data-project-id="${secondId}"]')?.click()`)
  check('再切回新画布仍是空白', await waitFor(async () =>
    (await activeTabId()) === secondId && (await ideaCount()) === 0))

  // ---------- E. 在空白画布上发散：先立顶层主题，结果挂在它下面 ----------
  // 这一段是"一次发散 3 条变成 3 个并列的孤立根节点"那个体验问题的回归测试：
  // 默认父节点必须是**画布的顶层主题节点**，而不是"根层"。
  console.log('\n[E] 空白画布上发散：自动立顶层主题 + 结果挂在它下面')
  await click('[data-testid="new-idea"]')
  check('新增想法对话框打开', await waitFor(() => js(`!!document.querySelector('[data-testid="generate-dialog"]')`)))
  check('画布还没有顶层节点 → 对话框出现「主题」输入',
    await waitFor(() => js(`!!document.querySelector('[data-testid="theme-input"]')`)))

  // 「AI 生成主题」：占位生成器给的是确定性短主题
  await click('[data-testid="suggest-theme"]')
  const themeVal = () => js(`document.querySelector('[data-testid="theme-input"]')?.value ?? ''`)
  check('「AI 生成主题」把结果填进主题输入框',
    await waitFor(async () => /^占位主题 #\d+$/.test(String(await themeVal()))), await themeVal())

  // 改成一个明确的主题，验证它落到顶层节点的标题上
  await setInput('[data-testid="theme-input"]', '无人农机调度')
  await setInput('[data-testid="prompt-input"]', '从零开始：无人农机的调度策略')
  // 一次发散 3 条 —— 正是当初"变成 3 个孤立根节点"的场景
  await js(`(() => {
    const sel = document.querySelector('[data-testid="count-select"]');
    const d = Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, 'value');
    d.set.call(sel, '3');
    sel.dispatchEvent(new Event('change', { bubbles: true }));
  })()`)
  await sleep(150)
  await click('[data-testid="submit-generate"]')

  const edgeCount = () => js(`document.querySelectorAll('.react-flow__edge').length`)
  check('画布上共 4 个节点（1 个主题 + 3 条发散）',
    await waitFor(async () => (await ideaCount()) === 4), await ideaCount())
  check('3 条发散各自连回主题（3 条边）',
    await waitFor(async () => (await edgeCount()) === 3), await edgeCount())

  const diskShape = () => {
    try {
      const f = readProjectFile(secondId)
      return {
        roots: f.tree.nodes.filter((n) => n.parentId === null).map((n) => n.label),
        kids: f.tree.nodes.filter((n) => n.parentId !== null).length,
        edges: f.tree.edges.length,
      }
    } catch {
      return null
    }
  }
  check('落盘：只有 1 个顶层节点，且它就是刚定的主题',
    await waitFor(() => {
      const s = diskShape()
      return !!s && s.roots.length === 1 && s.roots[0] === '无人农机调度'
    }), JSON.stringify(diskShape()))
  check('落盘：3 条发散都是它的子节点（不是 3 个孤立根）',
    await waitFor(() => diskShape()?.kids === 3), JSON.stringify(diskShape()))
  check('落盘：3 条边都在（主题 → 各发散节点）',
    await waitFor(() => diskShape()?.edges === 3), JSON.stringify(diskShape()))
  const tabCountOf = (id) =>
    js(`document.querySelector('[data-testid="project-tab"][data-project-id="${id}"] [data-testid="project-tab-count"]')?.textContent`)
  check('tab 上的节点数跟着更新（4）',
    await waitFor(async () => (await tabCountOf(secondId)) === '4'), await tabCountOf(secondId))

  // 再开一次对话框：画布已有顶层节点 → 不再要主题，且明确说明会挂到哪
  await click('[data-testid="new-idea"]')
  check('已有顶层节点时不再出现「主题」输入',
    await waitFor(async () => (await js(`!document.querySelector('[data-testid="theme-input"]')`)) === true))
  const dlgText2 = await js(`document.querySelector('[data-testid="generate-dialog"]').innerText`)
  check('对话框说明会挂到顶层主题下', dlgText2.includes('无人农机调度'), JSON.stringify(dlgText2.slice(0, 90)))
  await click('[data-testid="submit-generate"]') // 空描述会被拦下，顺便确认不误伤
  await sleep(200)
  check('空描述不生成（提示仍未关掉对话框）',
    await js(`!!document.querySelector('[data-testid="generate-dialog"]')`))
  await js(`document.querySelector('[data-testid="generate-dialog"] .btn')?.click()`) // 取消
  await waitFor(async () => (await js(`!document.querySelector('[data-testid="generate-dialog"]')`)))

  // ---------- F. 重载 ----------
  console.log('\n[F] 重载后回到上次那张画布')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  check('reload 后 tab 仍是 2 个', await waitFor(async () => (await tabCount()) === 2), await tabCount())
  check('reload 后停在新画布（tab 状态保持）', await waitFor(async () => (await activeTabId()) === secondId))
  check('新画布的内容还在（4 个节点）', await waitFor(async () => (await ideaCount()) === 4), await ideaCount())

  // ---------- G. 回归 ----------
  console.log('\n[G] 回归：其它入口仍在')
  check('评论入口仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="toggle-comment"]')`)))
  check('回收站仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin"]')`)))
  check('保存/另存为/打开仍在', await waitFor(() => js(
    `!!document.querySelector('[data-testid="save-project"]') && !!document.querySelector('[data-testid="save-project-as"]') && !!document.querySelector('[data-testid="open-project"]')`)))

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
