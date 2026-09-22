// 节点卡片自定义颜色端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. IPC 契约：setNodeColor 注入；
//   B. 卡片色板：hover 出现、默认色、点一下改色（背景 + 边框都变）；
//   C. 落盘 + 兄弟节点不受影响（逐节点独立）；
//   D. 右键菜单色板：入口存在，点色点改色且菜单关闭；
//   E. 恢复默认色（第一颗 = 默认白，落盘为 null）；
//   F. 重载恢复：reload 后仍是那个颜色（这就是"下次打开保持配色"）；
//   G. 回归：评论 / 收展 / 回收站入口都还在。
// 运行：node_modules/electron/dist/electron.exe probe-color.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-color-'))
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

  /** 某张卡片的外观（背景 / 边框 / data-color） */
  const cardStyle = (id) =>
    js(`(() => {
      const el = document.querySelector('.react-flow__node[data-id="${id}"] [data-testid="idea-node"]');
      if (!el) return null;
      const cs = getComputedStyle(el);
      return { bg: cs.backgroundColor, border: cs.borderTopColor, color: el.dataset.color };
    })()`)

  // ---------- A. IPC 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  check('window.ideasprout 注入 setNodeColor', apiKeys.includes('setNodeColor'),
    apiKeys.includes('setNodeColor') ? 'present' : apiKeys.join(','))
  check('window.ideasprout 必需方法仍在（回归）',
    ['ensureProject', 'generateNode', 'setNodeCollapsed', 'setNodeArchived', 'addNodeComment'].every((k) => apiKeys.includes(k)))

  // ---------- B. 卡片色板 ----------
  console.log('\n[B] 卡片上的色板')
  check('初始只有 1 个根节点', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) === 1))
  const rootId = readProjectFile().tree.nodes[0].id
  const initial = await cardStyle(rootId)
  info('初始外观', initial)
  check('默认卡片是白底', initial && initial.bg === 'rgb(255, 255, 255)', initial && initial.bg)
  check('默认卡片 data-color=default', initial && initial.color === 'default')

  check('卡片上有色板（7 个色点）', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="card-swatch"]').length`)) === 7),
    await js(`document.querySelectorAll('[data-testid="card-swatch"]').length`))

  const greenBg = await js(`document.querySelector('[data-testid="card-swatch"][data-color-id="green"]')?.dataset.colorBg`)
  info('green bg', greenBg)
  await js(`document.querySelector('[data-testid="card-swatch"][data-color-id="green"]')?.click()`)
  check('点绿色后卡片背景变绿', await waitFor(async () => {
    const s = await cardStyle(rootId)
    return s && s.bg === 'rgb(223, 245, 227)'
  }), JSON.stringify(await cardStyle(rootId)))
  check('边框也跟着变（同色系）', await waitFor(async () => {
    const s = await cardStyle(rootId)
    return s && s.border === 'rgb(164, 218, 176)'
  }), JSON.stringify(await cardStyle(rootId)))
  check('data-color 记的是落库色值', await waitFor(async () => {
    const s = await cardStyle(rootId)
    return s && s.color === greenBg
  }))

  // ---------- C. 落盘与独立性 ----------
  console.log('\n[C] 落盘 + 逐节点独立')
  check('落盘 color = 绿色值', await waitFor(() => {
    try { return nodeOnDisk(rootId).color === greenBg } catch { return false }
  }), JSON.stringify(nodeOnDisk(rootId).color))

  // 造一个兄弟节点：根节点下发散一个子节点
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
  check('新生成的子节点仍是默认色（不继承父节点）',
    await waitFor(() => {
      try { return nodeOnDisk(childId).color === null } catch { return false }
    }), JSON.stringify(nodeOnDisk(childId).color))

  // ---------- D. 右键菜单改色 ----------
  console.log('\n[D] 右键菜单里的色板')
  await click('.react-flow__controls-fitview')
  await sleep(700)
  const rect = await js(`(() => { const el = document.querySelector('.react-flow__node[data-id="${childId}"]'); if (!el) return null; const r = el.getBoundingClientRect(); return { x: r.x + r.width/2, y: r.y + 20 }; })()`)
  info('childRect', rect)
  wc.sendInputEvent({ type: 'mouseDown', x: Math.round(rect.x), y: Math.round(rect.y), button: 'right', clickCount: 1 })
  wc.sendInputEvent({ type: 'mouseUp', x: Math.round(rect.x), y: Math.round(rect.y), button: 'right', clickCount: 1 })
  check('右键菜单打开', await waitFor(() => js(`!!document.querySelector('[data-testid="node-context-menu"]')`)))
  check('菜单里有颜色行（7 个色点）', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="menu-color-swatch"]').length`)) === 7),
    await js(`document.querySelectorAll('[data-testid="menu-color-swatch"]').length`))

  const blueBg = await js(`document.querySelector('[data-testid="menu-color-swatch"][data-color-id="blue"]')?.dataset.colorBg`)
  await js(`document.querySelector('[data-testid="menu-color-swatch"][data-color-id="blue"]')?.click()`)
  check('点蓝色后菜单关闭', await waitFor(async () =>
    !(await js(`!!document.querySelector('[data-testid="node-context-menu"]')`))))
  check('子节点变蓝', await waitFor(async () => {
    const s = await cardStyle(childId)
    return s && s.bg === 'rgb(219, 234, 254)'
  }), JSON.stringify(await cardStyle(childId)))
  check('子节点落盘 color = 蓝色值', await waitFor(() => {
    try { return nodeOnDisk(childId).color === blueBg } catch { return false }
  }), JSON.stringify(nodeOnDisk(childId).color))
  check('父节点仍是绿色（改子节点不影响父节点）', await waitFor(() => {
    try { return nodeOnDisk(rootId).color === greenBg } catch { return false }
  }))

  // ---------- E. 恢复默认色 ----------
  console.log('\n[E] 恢复默认色')
  await js(`document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="card-swatch"][data-color-id="default"]')?.click()`)
  check('点默认色后卡片回到白底', await waitFor(async () => {
    const s = await cardStyle(rootId)
    return s && s.bg === 'rgb(255, 255, 255)'
  }), JSON.stringify(await cardStyle(rootId)))
  check('落盘为 null（而不是存一个白色值）', await waitFor(() => {
    try { return nodeOnDisk(rootId).color === null } catch { return false }
  }), JSON.stringify(nodeOnDisk(rootId).color))

  // ---------- F. 重载恢复 ----------
  console.log('\n[F] 重载后保持配色')
  await wc.reload()
  await new Promise((r) => wc.once('did-finish-load', r))
  await sleep(1600)
  check('reload 后子节点仍是蓝色', await waitFor(async () => {
    const s = await cardStyle(childId)
    return s && s.bg === 'rgb(219, 234, 254)'
  }), JSON.stringify(await cardStyle(childId)))
  check('reload 后根节点仍是默认白', await waitFor(async () => {
    const s = await cardStyle(rootId)
    return s && s.bg === 'rgb(255, 255, 255)'
  }), JSON.stringify(await cardStyle(rootId)))

  // ---------- G. 回归：其它入口没被挤掉 ----------
  console.log('\n[G] 回归：卡片上其它入口仍在')
  check('评论角标仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="comment-badge"]')`)))
  check('收展开关仍在（父节点有子节点）', await waitFor(() =>
    js(`!!document.querySelector('.react-flow__node[data-id="${rootId}"] [data-testid="collapse-toggle"]')`)))
  check('回收站仍在', await waitFor(() => js(`!!document.querySelector('[data-testid="trash-bin"]')`)))

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
