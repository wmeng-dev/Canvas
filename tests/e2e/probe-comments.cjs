// 评论（气泡）功能端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：window.ideasprout 的 5 个评论方法全部注入，且**没有** addReply/removeReply（回复已下线）；
//   B. 节点级评论：角标点击开弹层 → 加评论 → 再加一条（独立评论，不是回复）→ 改正文 →
//      落盘校验 → 删除单条；角标计数 = 评论条数；
//   C. 画布自由气泡：顶栏进入放置模式 → pane 点击创建 → 弹层写正文 → 弹层内**无回复入口** →
//      真实鼠标拖拽 → 流坐标落盘；
//   D. 重载恢复：webContents.reload() 后节点评论角标计数、画布气泡及其正文/坐标均从磁盘恢复。
// 运行：node_modules/electron/dist/electron.exe probe-comments.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-comments-'))
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
      try { v = await pred() } catch { /* 读盘/DOM 瞬时错误忽略 */ }
      if (v) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  // 受控 textarea/input：原型 value setter + input 事件（React 才能感知）
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
  const text = (sel) => js(`document.querySelector('${sel}')?.textContent ?? null`)
  const exists = (sel) => js(`!!document.querySelector('${sel}')`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  const required = ['addNodeComment', 'addCanvasComment', 'updateCommentBody', 'removeComment', 'updateCommentPosition']
  const missing = required.filter((k) => !apiKeys.includes(k))
  check('window.ideasprout 注入 5 个评论方法', missing.length === 0, missing.join(',') || 'all present')
  const retired = ['addReply', 'removeReply'].filter((k) => apiKeys.includes(k))
  check('回复接口已下线（无 addReply/removeReply）', retired.length === 0, retired.join(',') || 'none')

  // ---------- B. 节点级评论 ----------
  console.log('\n[B] 节点级评论：角标 → 弹层 → 加评论 → 再加一条 → 改正文 → 删除单条')
  check('idea 节点渲染', await waitFor(() => exists('.react-flow__node [data-testid="idea-node"]')))
  check('评论角标存在且计数 0', (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '0')

  await click('.react-flow__node [data-testid="comment-badge"]')
  check('点击角标打开节点评论弹层', await waitFor(() => exists('[data-testid="node-comment-panel"]')))
  check('空态提示', (await text('[data-testid="node-comment-panel"]'))?.includes('还没有评论'))

  await setInput('[data-testid="comment-new-input"]', '这个方案成本太高')
  await sleep(120)
  await click('[data-testid="comment-new-send"]')
  check('角标计数变为 1', await waitFor(async () =>
    (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '1'))
  check('评论落盘（节点 comments[0].body）', await waitFor(() => {
    try {
      const node = readProjectFile().tree.nodes[0]
      return node.comments?.[0]?.body === '这个方案成本太高' && node.comments[0].nodeId === node.id
    } catch { return false }
  }))

  // 补充内容 = 再写一条独立评论（不是回复）：弹层里不该有任何回复入口
  check('弹层内无回复输入框', !(await exists('[data-testid="comment-reply-input"]')))
  check('弹层内无回复列表', !(await exists('[data-testid="comment-replies"]')))
  await setInput('[data-testid="comment-new-input"]', '但收益也最大')
  await sleep(120)
  await click('[data-testid="comment-new-send"]')
  check('角标计数变为 2（两条独立评论）', await waitFor(async () =>
    (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '2'))
  check('两条评论都落盘且互不嵌套', await waitFor(() => {
    try {
      const cs = readProjectFile().tree.nodes[0].comments
      return cs?.length === 2 &&
        cs[0].body === '这个方案成本太高' &&
        cs[1].body === '但收益也最大' &&
        !('replies' in cs[0])
    } catch { return false }
  }))

  // 改正文（只改第一条）
  await setInput('[data-testid="comment-root-input"]', '这个方案成本太高（改）')
  await sleep(120)
  await click('[data-testid="comment-save-root"]')
  check('正文编辑落盘', await waitFor(() => {
    try { return readProjectFile().tree.nodes[0].comments?.[0]?.body === '这个方案成本太高（改）' }
    catch { return false }
  }))
  check('编辑第一条不动第二条', await waitFor(() => {
    try { return readProjectFile().tree.nodes[0].comments?.[1]?.body === '但收益也最大' }
    catch { return false }
  }))
  check('角标计数=2（条数，不累加回复）', (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '2')

  // 删除单条（只删第一条）
  await click('[data-testid="comment-delete"]')
  check('删除单条后角标计数=1', await waitFor(async () =>
    (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '1'))
  check('删除单条后落盘只剩一条', await waitFor(() => {
    try {
      const cs = readProjectFile().tree.nodes[0].comments
      return Array.isArray(cs) && cs.length === 1 && cs[0].body === '但收益也最大'
    } catch { return false }
  }))

  // ---------- C. 画布自由气泡 ----------
  console.log('\n[C] 画布自由气泡：放置 → 写评论 → 拖拽')
  await click('[data-testid="toggle-comment"]')
  check('进入放置模式（按钮态/光标类）', await waitFor(async () =>
    (await text('[data-testid="toggle-comment"]'))?.includes('点击画布放置评论') &&
    (await js(`!!document.querySelector('.canvas-placing')`))))
  check('弹层互斥：放置模式下节点弹层已收起', !(await exists('[data-testid="node-comment-panel"]')))

  // pane 点击创建气泡（screenToFlowPosition 用 clientX/Y）
  const PANE = { x: 300, y: 300 }
  await js(`document.querySelector('.react-flow__pane').dispatchEvent(
    new MouseEvent('click', { bubbles: true, clientX: ${PANE.x}, clientY: ${PANE.y} }))`)
  check('气泡节点出现', await waitFor(() => exists('[data-testid="comment-bubble"]')))
  check('放置模式自动退出（按钮复位）', await waitFor(async () =>
    (await text('[data-testid="toggle-comment"]'))?.includes('💬 评论')))
  check('新气泡自动打开评论弹层', await waitFor(() => exists('[data-testid="comment-thread"]')))
  check('气泡上不显示条数（一个气泡=一条评论）', !(await exists('[data-testid="comment-bubble-count"]')))
  check('弹层内无回复输入框', !(await exists('[data-testid="comment-thread"] [data-testid="comment-reply-input"]')))
  check('气泡落盘（file.comments[0] 带流坐标）', await waitFor(() => {
    try {
      const c = readProjectFile().comments?.[0]
      return c && !c.nodeId && typeof c.position?.x === 'number' && c.body === ''
    } catch { return false }
  }))

  await setInput('[data-testid="comment-thread"] [data-testid="comment-root-input"]', '整棵树的布局再疏一点')
  await sleep(120)
  await click('[data-testid="comment-thread"] [data-testid="comment-save-root"]')
  check('气泡根评论落盘', await waitFor(() => {
    try { return readProjectFile().comments?.[0]?.body === '整棵树的布局再疏一点' }
    catch { return false }
  }))

  check('落盘的评论无 replies 字段', await waitFor(() => {
    try { return !('replies' in (readProjectFile().comments?.[0] ?? {})) } catch { return false }
  }))
  check('气泡上显示正文预览', await waitFor(async () =>
    (await text('[data-testid="comment-bubble"]'))?.includes('整棵树的布局')))

  // 真实鼠标拖拽气泡
  const rectBefore = await js(`(() => {
    const r = document.querySelector('[data-testid="comment-bubble"]').getBoundingClientRect();
    return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
  })()`)
  const posBefore = readProjectFile().comments[0].position
  const wc = win.webContents
  // ⚠️ 必须用 CDP 派发：sendInputEvent 的 mouseMove **不带 buttons 位**，
  // d3-drag / React Flow 会当成"没按按键的悬停"而整段忽略，
  // 于是这条断言会偶发假失败（同一提交上时绿时红）。
  if (!wc.debugger.isAttached()) wc.debugger.attach('1.3')
  const cdp = (method, params) => wc.debugger.sendCommand(method, params)
  const from = { x: Math.round(rectBefore.x), y: Math.round(rectBefore.y) }
  const to = { x: from.x - 120, y: from.y + 72 }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 })
  await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
  for (let i = 1; i <= 14; i++) {
    await cdp('Input.dispatchMouseEvent', {
      type: 'mouseMoved',
      x: Math.round(from.x + ((to.x - from.x) * i) / 14),
      y: Math.round(from.y + ((to.y - from.y) * i) / 14),
      button: 'left',
      buttons: 1,
    })
    await sleep(20)
  }
  await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
  await sleep(300)
  check('拖拽后流坐标落盘变化', await waitFor(() => {
    try {
      const p = readProjectFile().comments?.[0]?.position
      return p && (p.x !== posBefore.x || p.y !== posBefore.y)
    } catch { return false }
  }))
  const posAfterDrag = readProjectFile().comments[0].position
  info('position before/after drag', [posBefore, posAfterDrag])

  // ---------- D. 重载恢复（"下次打开"） ----------
  console.log('\n[D] 重载后从磁盘恢复评论')
  await win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(1500)
  check('节点评论角标计数=1（从磁盘恢复）', await waitFor(async () =>
    (await js(`document.querySelector('.react-flow__node [data-testid="comment-badge"]')?.dataset.count`)) === '1'))
  check('画布气泡恢复（正文预览仍在）', await waitFor(async () =>
    (await text('[data-testid="comment-bubble"]'))?.includes('整棵树的布局')))
  check('恢复后气泡流坐标与拖拽后一致', () => {
    const p = readProjectFile().comments?.[0]?.position
    return p && p.x === posAfterDrag.x && p.y === posAfterDrag.y
  })
  check('恢复后气泡根评论在 DOM 可见（title）', (await js(`document.querySelector('[data-testid="comment-bubble"]')?.getAttribute('title')`)) === '整棵树的布局再疏一点')

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
