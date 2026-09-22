// 关闭画布 tab 的端到端探针（本地，gitignored）。跑生产 bootstrap() + 构建产物。
// 覆盖：
//   A. 契约：window.ideasprout 有 closeProject / reopenProject / listClosedProjects；
//   B. tab 上的 × 关闭当前画布 → tab 少一个、自动切到剩下那张、项目文件仍在磁盘；
//   C. 「已关闭 N」菜单：列出被关掉的画布 → 点一条恢复（内容还在）；
//   D. 关掉最后一张 → 自动补一张空白画布（界面里始终有一张能用的）；
//   E. reload 后：已关闭的画布不会再自己跑回 tab 条。
// 运行：node_modules/electron/dist/electron.exe probe-close.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-close-'))
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
const appStateFile = path.join(dataDir, 'app-state.json')
const projectFileExists = (id) => fs.existsSync(path.join(projectsDir, `${id}.json`))

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
      try { v = await pred() } catch { /* 瞬时错误忽略 */ }
      if (v) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  const click = (sel) => js(`document.querySelector('${sel}')?.click()`)
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
  const text = (sel) => js(`document.querySelector('${sel}')?.textContent ?? null`)
  const exists = (sel) => js(`!!document.querySelector('${sel}')`)
  const tabIds = () =>
    js(`Array.from(document.querySelectorAll('[data-testid="project-tab"]')).map(e => e.dataset.projectId)`)
  const currentId = () =>
    js(`document.querySelector('[data-testid="project-tab"][data-active="1"]')?.dataset.projectId ?? null`)

  // ---------- A. 契约 ----------
  console.log('\n[A] IPC 契约')
  const apiKeys = await js('Object.keys(window.ideasprout || {})')
  for (const k of ['closeProject', 'reopenProject', 'listClosedProjects']) {
    check(`window.ideasprout.${k} 已注入`, apiKeys.includes(k))
  }

  // ---------- B. 关闭当前画布 ----------
  console.log('\n[B] tab 上的 × ：关闭当前画布')
  check('启动即有画布', await waitFor(async () => (await tabIds()).length >= 1))
  // 先建第二张，保证关掉一张后还有得切
  await click('[data-testid="new-canvas"]')
  check('新建后有两个 tab', await waitFor(async () => (await tabIds()).length === 2))
  const ids = await tabIds()
  const cur = await currentId()
  const second = cur ?? ids[ids.length - 1]
  info('当前画布', second)

  // 给当前画布加个节点，好验证"关闭不丢内容"
  // 加节点要走完整流程：新增想法 → 填描述 → 生成（见 probe-canvases 的同款流程）
  await click('[data-testid="new-idea"]')
  check('新增想法对话框打开', await waitFor(() => js(`!!document.querySelector('[data-testid="generate-dialog"]')`)))
  await setInput('[data-testid="prompt-input"]', '从零开始：无人农机的调度策略')
  await sleep(120)
  await click('[data-testid="submit-generate"]')
  const nodeAdded = await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) >= 1)
  check('第二张画布上加了想法节点', nodeAdded)
  const nodesBefore = await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)
  info('关闭前节点数', nodesBefore)

  await click(`[data-testid="close-canvas"][data-project-id="${second}"]`)
  check('关闭后只剩一个 tab', await waitFor(async () => (await tabIds()).length === 1))
  const leftId = (await tabIds())[0]
  check('自动切到了剩下那张', (await currentId()) === leftId)
  check('⚠️ 项目文件仍在磁盘（关闭 ≠ 删除）', projectFileExists(second))
  check('已关闭计数变 1', await waitFor(async () =>
    (await text('[data-testid="history-canvases-toggle"]'))?.includes('1')))

  // ---------- C. 「历史画布」左侧抽屉：恢复已关闭的画布 ----------
  console.log('\n[C] 历史画布抽屉：恢复画布')
  check('⚠️ 历史画布按钮在 tab 条最左边', await waitFor(async () =>
    (await js(`document.querySelector('[data-testid="project-tabs"]')?.firstElementChild?.dataset?.testid`)) === 'history-canvases-toggle'))
  await click('[data-testid="history-canvases-toggle"]')
  check('抽屉打开', await waitFor(async () =>
    (await js(`document.querySelector('[data-testid="history-drawer"]')?.dataset.open`)) === '1'))
  check('⚠️ 抽屉贴在左侧（left≈0，宽度>200）', await waitFor(async () => {
    const r = await js(`(() => { const el = document.querySelector('[data-testid="history-drawer"]'); if (!el) return null; const b = el.getBoundingClientRect(); return { left: Math.round(b.left), width: Math.round(b.width) } })()`)
    return !!r && r.left <= 2 && r.width > 200
  }))
  check('抽屉列出全部画布（当前 + 已关闭）', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="history-canvas-item"]').length`)) === 2))
  check('其中已关闭的正好 1 条', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="history-canvas-item"][data-closed="1"]').length`)) === 1))
  await click('[data-testid="history-canvas-item"][data-closed="1"]')
  check('点完抽屉自动收起', await waitFor(async () =>
    (await js(`document.querySelector('[data-testid="history-drawer"]')?.dataset.open`)) === '0'))
  check('恢复后回到两个 tab', await waitFor(async () => (await tabIds()).length === 2))
  check('恢复的画布成为当前', await waitFor(async () => (await currentId()) === second))
  check('⚠️ 恢复后内容还在（节点数不丢）', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) === nodesBefore))
  check('已关闭计数归 0', await waitFor(async () =>
    (await text('[data-testid="history-canvases-toggle"]'))?.includes('0')))

  // ---------- D. 关掉最后一张 → 自动补空白 ----------
  console.log('\n[D] 关掉最后一张画布')
  const idsNow = await tabIds()
  for (const id of idsNow) {
    await click(`[data-testid="close-canvas"][data-project-id="${id}"]`)
    await sleep(400)
  }
  check('全关光后自动补一张空白画布', await waitFor(async () => (await tabIds()).length === 1))
  check('补出来的是空白画布', await waitFor(async () =>
    (await js(`document.querySelectorAll('[data-testid="idea-node"]').length`)) === 0))
  check('已关闭列表有 2 条', await waitFor(async () =>
    (await text('[data-testid="history-canvases-toggle"]'))?.includes('2')))

  // ---------- E. 重载后已关闭的画布不自己跑回来 ----------
  console.log('\n[E] reload 后保持关闭状态')
  await win.webContents.reload()
  await new Promise((r) => win.webContents.once('did-finish-load', r))
  await sleep(1500)
  check('重载后仍是 1 个 tab（已关闭的没跑回来）', await waitFor(async () =>
    (await tabIds()).length === 1))
  check('已关闭列表落盘后仍在', await waitFor(async () =>
    (await text('[data-testid="history-canvases-toggle"]'))?.includes('2')))
  const state = JSON.parse(fs.readFileSync(appStateFile, 'utf8'))
  check('app-state.json 记了 closedProjectIds', Array.isArray(state.closedProjectIds) && state.closedProjectIds.length === 2)

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
