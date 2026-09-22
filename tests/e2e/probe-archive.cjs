// 想法回收站端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：setNodeArchived 注入；
//   B. 造出父子两级；
//   C. 回收站存在、初始为空；
//   D. 拖拽悬停高亮；
//   E. 拖入归档：卡片与边从 DOM 消失、计数 +1、落盘 archived=true；
//   F. 重载恢复：reload 后仍在回收站；
//   G. 取出：面板里点「取出」→ 卡片回来、计数归零、落盘 archived=false；
//   H. 归档父节点：后代跟着隐藏，且回收站只列 1 条（不重复占位）。
// 运行：node_modules/electron/dist/electron.exe probe-archive.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-archive-'))
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
  await sleep(1500)
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
      const desc = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      desc.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`)
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`)

  const ideaCount = () => js(`document.querySelectorAll('[data-testid="idea-node"]').length`)
  const edgeCount = () => js(`document.querySelectorAll('.react-flow__edge').length`)
  const trashCount = () => js(`document.querySelector('[data-testid="trash-bin-count"]')?.textContent`)
  const nodeOnCanvas = (id) => js(`!!document.querySelector('.react-flow__node[data-id="${id}"]')`)
  const rectOf = (sel) =>
    js(`(() => { const el = document.querySelector('${sel}'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + r.height/2 }; })()`)

  /**
   * 真实鼠标拖拽：从 from 拖到 to（中途检查高亮可传 onMidway）。
   *
   * ⚠️ 必须走 CDP 派发：`sendInputEvent` 的 `mouseMove` **不带 buttons 位**，
   * d3-drag 会当成"没按按键的悬停"而整段忽略，于是拖拽落点对不上 →
   * 这条断言会偶发假失败（同一次提交上时绿时红，曾出现 28 项里掉 1 项）。
   * 与 probe-comments.cjs 用的是同一套手法。
   */
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  const cdp = (method, params) => wc.debugger.sendCommand(method, params)
  const dragTo = async (from, to, onMidway) => {
    const fx = Math.round(from.x)
    const fy = Math.round(from.y)
    const tx = Math.round(to.x)
    const ty = Math.round(to.y)
    const STEPS = 14
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: fx, y: fy, button: 'none', buttons: 0 })
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: fx, y: fy, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= STEPS; i++) {
      await cdp('Input.dispatchMouseEvent', {
        type: 'mouseMoved',
        x: Math.round(fx + ((tx - fx) * i) / STEPS),
        y: Math.round(fy + ((ty - fy) * i) / STEPS),
        button: 'left',
        buttons: 1,
      })
      await sleep(20)
    }
    if (onMidway) await onMidway()
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: tx, y: ty, button: 'left', buttons: 0, clickCount: 1 })
  }

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 setNodeArchived', apiKeys.includes('setNodeArchived'),
    apiKeys.includes('setNodeArchived') ? 'present' : apiKeys.join(','))
  check('window.ideasprout 必需方法仍在（回归）',
    ['ensureProject', 'generateNode', 'setNodeCollapsed', 'addNodeComment'].every((k) => apiKeys.includes(k)))

  // ---------- B. 造出父子两级 ----------
  console.log('\n[B] 造出父子两级')
  check('初始只有 1 个根节点', await waitFor(async () => (await ideaCount()) === 1))
  const rootId = readProjectFile().tree.nodes[0].id
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
  const childId = readProjectFile().tree.nodes.find((n) => n.parentId === rootId)?.id
  info('rootId / childId', [rootId, childId])

  // ---------- C. 回收站存在 ----------
  console.log('\n[C] 回收站初始状态')
  check('画布上有回收站', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin"]')`)))
  check('初始计数为 0', (await trashCount()) === '0', await trashCount())

  // ---------- D/E. 拖入归档 ----------
  console.log('\n[D] 拖到回收站上：悬停高亮')
  // ⚠️ 新节点可能生成到画布右侧、被预览面板盖住（DOM 在但点不到）——先点"适应视图"收进可见区
  info('controls 存在', await js(`!!document.querySelector('.react-flow__controls')`))
  info('fitview 按钮存在', await js(`!!document.querySelector('.react-flow__controls-fitview')`))
  info('fitview 前 childRect', await rectOf(`.react-flow__node[data-id="${childId}"]`))
  await click('.react-flow__controls-fitview')
  await sleep(800)
  info('fitview 后 childRect', await rectOf(`.react-flow__node[data-id="${childId}"]`))
  info('viewport transform', await js(`document.querySelector('.react-flow__viewport')?.style.transform ?? null`))
  const childRect = await rectOf(`.react-flow__node[data-id="${childId}"]`)
  const canvasRight = await js(`document.querySelector('.react-flow')?.getBoundingClientRect().right`)
  check('子节点在画布可见区内（未被预览面板遮挡）', childRect && childRect.x < canvasRight,
    JSON.stringify({ childRect, canvasRight }))
  const trashRect = await rectOf('[data-testid="trash-bin"]')
  info('childRect / trashRect', [childRect, trashRect])
  let sawHighlight = false
  await dragTo(childRect, trashRect, async () => {
    sawHighlight = (await js(`document.querySelector('[data-testid="trash-bin"]')?.dataset.highlight`)) === '1'
  })
  check('拖到回收站上方时高亮', sawHighlight)

  console.log('\n[E] 松手归档')
  check('子节点从画布消失', await waitFor(async () => !(await nodeOnCanvas(childId))))
  check('通向它的边也消失', await waitFor(async () => (await edgeCount()) === 0))
  check('回收站计数变 1', await waitFor(async () => (await trashCount()) === '1'), await trashCount())
  check('落盘 archived=true', await waitFor(() => {
    try { return readProjectFile().tree.nodes.find((n) => n.id === childId).archived === true } catch { return false }
  }))
  check('父节点仍在画布上', await nodeOnCanvas(rootId))
  check('父节点的 archived 未被牵连', await waitFor(() => {
    try { return readProjectFile().tree.nodes.find((n) => n.id === rootId).archived === false } catch { return false }
  }))

  // ---------- F. 重载恢复 ----------
  console.log('\n[F] 重载后仍在回收站')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1500)
  check('reload 后子节点仍不在画布上', await waitFor(async () => !(await nodeOnCanvas(childId))))
  check('reload 后回收站计数仍为 1', await waitFor(async () => (await trashCount()) === '1'), await trashCount())

  // ---------- G. 取出 ----------
  console.log('\n[G] 从回收站取出')
  await click('[data-testid="trash-bin-toggle"]')
  check('面板展开', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin-panel"]')`)))
  check('列表里 1 条', await waitFor(async () => (await js(`document.querySelectorAll('[data-testid="trash-bin-item"]').length`)) === 1))
  await click('[data-testid="trash-bin-restore"]')
  check('取回后子节点回到画布', await waitFor(async () => await nodeOnCanvas(childId)))
  check('边也回来了', await waitFor(async () => (await edgeCount()) === 1))
  check('回收站计数归零', await waitFor(async () => (await trashCount()) === '0'), await trashCount())
  check('落盘 archived=false', await waitFor(() => {
    try { return readProjectFile().tree.nodes.find((n) => n.id === childId).archived === false } catch { return false }
  }))

  // ---------- H. 归档父节点 ----------
  console.log('\n[H] 归档父节点：后代跟着走，只列 1 条')
  const rootRect = await rectOf(`.react-flow__node[data-id="${rootId}"]`)
  const trashRect2 = await rectOf('[data-testid="trash-bin"]')
  await dragTo(rootRect, trashRect2)
  check('父节点与子节点一起从画布消失', await waitFor(async () =>
    !(await nodeOnCanvas(rootId)) && !(await nodeOnCanvas(childId))))
  check('回收站只列 1 条（后代不重复占位）', await waitFor(async () => (await trashCount()) === '1'), await trashCount())
  check('落盘：父 archived=true，子自身标记仍为 false',
    await waitFor(() => {
      try {
        const ns = readProjectFile().tree.nodes
        return ns.find((n) => n.id === rootId).archived === true && ns.find((n) => n.id === childId).archived === false
      } catch { return false }
    }))

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
