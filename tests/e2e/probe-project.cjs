// 项目文件功能验证（本地，gitignored）：
// 验证顶栏的「改名 / 保存 / 另存为 / 打开」四个动作的产品行为：
//   1. 改名：输入框失焦提交 → 落库 project.name 改变、顶栏回显新名；
//   2. 保存：点击 → 出现「已保存 HH:MM」提示（证明 IPC 往返成功）；
//   3. 另存为：系统保存对话框被探针桩替换，写出完整 ProjectFile 到指定路径，文件可读且结构正确；
//   4. 打开：系统打开对话框被桩替换，导入外部 .json → 顶栏项目名切换为外部项目名、
//      app-state.json 的 lastProjectId 指向导入项目（证明"下次打开"会恢复）。
// 原生对话框无法程序化点击，故在 bootstrap 前替换 electron.dialog 的 showSave/OpenDialog。
const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-proj-'))
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

// 预先造一个"外部项目文件"供「打开」导入
const STUB_OPEN = path.join(dataDir, 'external-project.json')
const EXT_ID = 'ext-1'
fs.writeFileSync(
  STUB_OPEN,
  JSON.stringify({
    project: {
      id: EXT_ID,
      name: '外部导入项目',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    },
    tree: {
      nodes: [
        {
          id: 'ext-n1',
          parentId: null,
          label: '外部节点A',
          prompt: '外部描述',
          content: '# 外部内容',
          contentType: 'markdown',
          analysis: null,
          status: 'done',
          generatorId: null,
          versions: [],
          currentVersionId: null,
          position: { x: 0, y: 0 },
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        },
      ],
      edges: [],
    },
  }),
)
const STUB_SAVE = path.join(dataDir, 'saved-project.json')

// ---- 桩：原生对话框不可点，探针替换返回值 ----
const electron = require('electron')
electron.dialog.showSaveDialog = async () => ({ canceled: false, filePath: STUB_SAVE })
electron.dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [STUB_OPEN] })

const { bootstrap } = require(path.join(ROOT, 'dist-electron/main/app'))
bootstrap()

const NEW_NAME = '改名测试创意'

async function main() {
  const win = BrowserWindow.getAllWindows()[0]
  if (!win) {
    check('bootstrap 建了窗口', false)
    return finish()
  }
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(1200)
  const js = (code) => win.webContents.executeJavaScript(code)
  try {
    info('startup app-state', JSON.parse(fs.readFileSync(path.join(dataDir, 'app-state.json'), 'utf8')))
  } catch (e) {
    info('startup app-state MISSING/EMPTY', String(e))
  }

  const projectsDir = path.join(dataDir, 'projects')
  const readProject = () => {
    const files = fs.readdirSync(projectsDir)
    return JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8')).project
  }
  const waitFor = async (pred, timeoutMs = 6000) => {
    const t0 = Date.now()
    for (;;) {
      if (await pred()) return true
      if (Date.now() - t0 > timeoutMs) return false
      await sleep(100)
    }
  }
  const setInput = (sel, value) =>
    js(`(() => {
      const el = document.querySelector('${sel}');
      const proto = Object.getPrototypeOf(el);
      const desc = Object.getOwnPropertyDescriptor(proto, 'value');
      desc.set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('input', { bubbles: true }));
      return el.value;
    })()`)
  const blur = (sel) =>
    js(`(() => {
      const el = document.querySelector('${sel}');
      // React 的 onBlur 经根节点的 'focusout' 委托，直接 blur() 在元素未聚焦时是 no-op，
      // 故手动派发一个会冒泡的 focusout 事件来触发 onBlur。
      el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
    })()`)

  // ---------- 0. 顶栏基本元素 ----------
  if (!(await waitFor(async () => (await js('!!document.querySelector(\'[data-testid="project-name"]\')'))))) {
    check('顶栏出现项目名输入框', false)
    return finish()
  }
  check('顶栏出现项目名输入框', true)
  for (const t of ['open-project', 'save-project-as', 'save-project']) {
    check(`顶栏有「${t}」按钮`, await js(`!!document.querySelector('[data-testid="${t}"]')`))
  }

  // ---------- 1. 改名 ----------
  await setInput('[data-testid="project-name"]', NEW_NAME)
  // 等一帧让 React 把 nameDraft 状态更新到最新（否则 commitName 读到的还是旧值）
  await sleep(150)
  await blur('[data-testid="project-name"]')
  const renamed = await waitFor(async () => {
    try {
      return readProject().name === NEW_NAME
    } catch {
      return false
    }
  }, 6000)
  check('改名后落库 project.name 改变', renamed, renamed ? '' : readProject().name)
  const inputVal = await js('document.querySelector(\'[data-testid="project-name"]\').value')
  check('顶栏输入框回显新名', inputVal === NEW_NAME, JSON.stringify(inputVal))

  // ---------- 2. 保存 ----------
  await js('document.querySelector(\'[data-testid="save-project"]\').click()')
  const saved = await waitFor(async () => (await js('!!document.querySelector(\'[data-testid="saved-hint"]\')')), 6000)
  check('点「保存」后出现「已保存」提示（IPC 往返成功）', saved)
  // 落库名仍是新名（保存不丢改名）
  check('保存后项目名仍为改名后的值', readProject().name === NEW_NAME)

  // ---------- 3. 另存为：写出完整 ProjectFile ----------
  await js('document.querySelector(\'[data-testid="save-project-as"]\').click()')
  // 等文件既存在又有内容（避免读到 writeFile 还未刷完的 0 字节文件）
  const savedFile = await waitFor(() => {
    try {
      return fs.existsSync(STUB_SAVE) && fs.statSync(STUB_SAVE).size > 2
    } catch {
      return false
    }
  }, 6000)
  check('「另存为」写出项目文件到指定路径', savedFile, STUB_SAVE)
  if (savedFile) {
    const exported = JSON.parse(fs.readFileSync(STUB_SAVE, 'utf8'))
    check('导出文件是完整 ProjectFile（含 project + tree.nodes）',
      !!exported.project && Array.isArray(exported.tree?.nodes))
    check('导出文件携带改名后的项目名', exported.project?.name === NEW_NAME, JSON.stringify(exported.project?.name))
  }

  // ---------- 4. 打开：导入外部项目 ----------
  await js('document.querySelector(\'[data-testid="open-project"]\').click()')
  const opened = await waitFor(
    async () => (await js('document.querySelector(\'[data-testid="project-name"]\').value')) === '外部导入项目',
    6000,
  )
  check('「打开」导入外部项目后顶栏项目名切换', opened)
  const appStatePath = path.join(dataDir, 'app-state.json')
  let raw = ''
  try {
    raw = fs.readFileSync(appStatePath, 'utf8')
  } catch (e) {
    raw = 'ENOENT:' + String(e)
  }
  info('app-state raw', raw)
  let appState = null
  try {
    appState = JSON.parse(raw)
  } catch (e) {
    info('app-state parse error', String(e))
  }
  check('app-state.json 的 lastProjectId 指向导入项目（下次打开恢复）',
    !!appState && appState.lastProjectId === EXT_ID, JSON.stringify(appState))
  // 导入项目已落库到 userData
  const importedOnDisk = fs.existsSync(path.join(projectsDir, `${EXT_ID}.json`))
  check('导入项目已落库（可被自动保存继续维护）', importedOnDisk)

  finish()
}

let done = false
function finish() {
  if (done) return
  done = true
  const passed = results.filter(Boolean).length
  const allGreen = results.length > 0 && passed === results.length
  console.log('\nCHROME_E2E ' + (allGreen ? 'OK' : 'FAIL') + ' (' + passed + '/' + results.length + ')')
  app.exit(allGreen ? 0 : 1)
}

app.on('window-all-closed', () => {})
app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', (e && e.stack) || e)
    finish()
  }),
)
