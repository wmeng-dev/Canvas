// idea 节点拖动位置持久化 端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖远端合入的 dd9bf11：拖完 idea 节点 → 流坐标落盘 → 重进画布保持位置；
// 以及这次重构动过的分叉点：拖到回收站仍是「归档」而不是「存坐标」。
// 运行：python launcher（须清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-nodepos-'))
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
const nodeOnDisk = (id) => readProjectFile().tree.nodes.find((n) => n.id === id)

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
      const d = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value');
      d.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`)
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`)

  // ---------- 用 CDP 派发真实拖拽（buttons 位完整，d3-drag/React Flow 才认） ----------
  wc.debugger.attach('1.3')
  const cdp = (method, params) => wc.debugger.sendCommand(method, params)
  const drag = async (from, to, steps = 14) => {
    await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x: from.x, y: from.y, button: 'none', buttons: 0 })
    await cdp('Input.dispatchMouseEvent', { type: 'mousePressed', x: from.x, y: from.y, button: 'left', buttons: 1, clickCount: 1 })
    for (let i = 1; i <= steps; i++) {
      const x = Math.round(from.x + ((to.x - from.x) * i) / steps)
      const y = Math.round(from.y + ((to.y - from.y) * i) / steps)
      await cdp('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y, button: 'left', buttons: 1 })
      await sleep(20)
    }
    await cdp('Input.dispatchMouseEvent', { type: 'mouseReleased', x: to.x, y: to.y, button: 'left', buttons: 0, clickCount: 1 })
    await sleep(600)
  }

  /** 画布上某节点的位置（React Flow 写在 DOM transform 里）+ 卡片中心的屏幕坐标 */
  const nodeBox = (id) =>
    js(`(() => {
      const el = document.querySelector('.react-flow__node[data-id="${id}"]');
      if (!el) return null;
      const st = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return {
        transform: st.transform,
        x: Math.round(r.x + r.width / 2),
        y: Math.round(r.y + 24),
        w: Math.round(r.width),
      };
    })()`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 setNodePosition', apiKeys.includes('setNodePosition'),
    apiKeys.includes('setNodePosition') ? 'present' : apiKeys.join(','))
  check('原有必需方法仍在（回归）',
    ['ensureProject', 'generateNode', 'setNodeColor', 'setNodeArchived', 'addNodeComment'].every((k) => apiKeys.includes(k)))

  // ---------- B. 造一个子节点 ----------
  console.log('\n[B] 准备：根 + 一个子节点')
  check('初始只有 1 个根节点', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) === 1))
  const rootId = readProjectFile().tree.nodes[0].id
  await js(`document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="idea-node"]')?.click()`)
  check('预览面板出现"基于该节点发散"', await waitFor(() =>
    js(`!!document.querySelector('[data-testid="branch-from-node"]')`)))
  await click('[data-testid="branch-from-node"]')
  await waitFor(() => js(`!!document.querySelector('[data-testid="generate-dialog"]')`))
  await setInput('[data-testid="prompt-input"]', '子方向：先把成本降下来')
  await sleep(120)
  await click('[data-testid="submit-generate"]')
  check('生成后画布有 2 个节点', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) === 2))
  const childId = readProjectFile().tree.nodes.find((n) => n.parentId === rootId)?.id
  const before = await nodeOnDisk(rootId)?.position
  const beforeDom = await nodeBox(rootId)
  info('拖前落盘 position', before)
  info('拖前 DOM', beforeDom)
  await click('.react-flow__controls-fitview')
  await sleep(700)

  // ---------- C. 真拖拽 → 落盘 ----------
  console.log('\n[C] 拖动 idea 节点 → 流坐标落盘')
  const box = await nodeBox(rootId)
  check('拿到根节点屏幕坐标', box && box.w > 0, JSON.stringify(box))
  await drag({ x: box.x, y: box.y }, { x: box.x + 220, y: box.y + 160 })
  const movedDom = await nodeBox(rootId)
  info('拖后 DOM', movedDom)
  check('节点真的被拖动了（DOM transform 变了）', movedDom && movedDom.transform !== beforeDom.transform)
  check('拖完后落盘出现 position', await waitFor(() => {
    try { const p = nodeOnDisk(rootId).position; return p && Number.isFinite(p.x) && Number.isFinite(p.y) } catch { return false }
  }), JSON.stringify(await nodeOnDisk(rootId)?.position))
  const savedPos = await nodeOnDisk(rootId).position
  check('落盘坐标是「新位置」而不是旧值（确实变了）',
    !before || savedPos.x !== before.x || savedPos.y !== before.y,
    `before=${JSON.stringify(before)} after=${JSON.stringify(savedPos)}`)
  check('落盘坐标是有限数值（没写成 NaN / undefined）',
    Number.isFinite(savedPos.x) && Number.isFinite(savedPos.y), JSON.stringify(savedPos))

  // ---------- D. 重载后保持 ----------
  console.log('\n[D] 重载画布后位置保持')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  // 注意：waitFor 是「布尔谓词」，取值要另写轮询，别拿它当取值函数（这里踩过）
  const poll = async (fn, timeoutMs = 8000) => {
    const t0 = Date.now()
    for (;;) {
      let v = null
      try { v = await fn() } catch { /* 瞬时错误忽略 */ }
      if (v) return v
      if (Date.now() - t0 > timeoutMs) return null
      await sleep(100)
    }
  }
  const afterReload = await poll(() =>
    js(`(() => {
      const e = document.querySelector('.react-flow__node[data-id="${rootId}"]');
      if (!e) return null;
      const t = getComputedStyle(e).transform;
      const m = t.match(/matrix\\(([^)]+)\\)/);
      if (!m) return null;
      const parts = m[1].split(',').map((s) => parseFloat(s.trim()));
      return { x: parts[4], y: parts[5], zoom: parts[0] };
    })()`))
  info('reload 后画布上的位置（换算回流坐标）', afterReload)
  check('reload 后画布上的流坐标 == 落盘的坐标（考虑 zoom 归一）',
    afterReload && Math.abs(afterReload.x / afterReload.zoom - savedPos.x) < 1.5 &&
      Math.abs(afterReload.y / afterReload.zoom - savedPos.y) < 1.5,
    `disk=${JSON.stringify(savedPos)} dom=${JSON.stringify(afterReload)}`)

  // ---------- E. 拖到回收站仍走「归档」而不是「存坐标」 ----------
  console.log('\n[E] 拖到回收站 = 归档（新逻辑的分叉点）')
  const childBefore = await nodeOnDisk(childId)?.position
  const trash = await js(`(() => {
    const el = document.querySelector('[data-testid="trash-bin"]');
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { x: Math.round(r.x + r.width / 2), y: Math.round(r.y + r.height / 2) };
  })()`)
  info('回收站中心', trash)
  check('回收站存在', !!trash)
  const childBox = await nodeBox(childId)
  info('子节点屏幕坐标', childBox)
  await drag({ x: childBox.x, y: childBox.y }, trash)
  check('拖到回收站后子节点 archived=true', await waitFor(() => {
    try { return nodeOnDisk(childId).archived === true } catch { return false }
  }), JSON.stringify(nodeOnDisk(childId)?.archived))
  check('归档这次没有顺手写 position（分叉没有两头都走）',
    JSON.stringify(await nodeOnDisk(childId)?.position) === JSON.stringify(childBefore),
    `before=${JSON.stringify(childBefore)} after=${JSON.stringify(await nodeOnDisk(childId)?.position)}`)

  // ---------- F. 回归：画布基本功能没被新逻辑挤掉 ----------
  console.log('\n[F] 回归')
  check('回收站仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin"]')`)))
  check('评论角标仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="comment-badge"]')`)))
  check('自定义色板仍在（7 色）', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="card-swatch"]').length`)) === 7))

  try { wc.debugger.detach() } catch { /* 已断开 */ }
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
