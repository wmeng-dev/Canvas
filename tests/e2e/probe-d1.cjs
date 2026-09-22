// D.1 端到端验证探针：跑生产 bootstrap()，验证
//   导出对话框 → 两种范围（整树 / 收敛路径） → 两种格式（Markdown / 单文件 HTML）
//   → 落盘内容正确 → 导出的 HTML 用新窗口独立打开后仍能正确渲染。
//
// 原生保存对话框无法被程序化点击，这里在**探针里**打桩 electron.dialog.showSaveDialog
// （产品代码不留测试钩子）。非产品代码，仅本地验证用（已 gitignore）。

const electron = require('electron')
const { app, BrowserWindow } = electron
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-d1-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const OUT_MD = path.join(os.tmpdir(), `ideasprout-export-${process.pid}.md`)
const OUT_HTML = path.join(os.tmpdir(), `ideasprout-export-${process.pid}.html`)

// --- 打桩保存对话框：记录调用参数、把文件写到探针指定位置 ---
const dialogCalls = []
let nextPath = OUT_MD
electron.dialog.showSaveDialog = async (...args) => {
  const opts = args.length > 1 ? args[1] : args[0]
  dialogCalls.push(opts)
  return { canceled: false, filePath: nextPath }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
/**
 * 轮询等待：节点/边/对话框都是异步渲染出来的。
 * ⚠️ 不要用固定 sleep 断言异步渲染结果 —— 全量回归 12 个探针连跑时，
 *    某一轮就会恰好读到"还没渲染出来"，表现为偶发失败。
 */
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
  win.webContents.on('preload-error', (_e, p, err) => console.log('  PRELOAD_ERROR', p, err && err.message))
  if (win.webContents.isLoading()) {
    await new Promise((r) => win.webContents.once('did-finish-load', r))
  }
  await sleep(900)
  const js = (code) => win.webContents.executeJavaScript(code)

  const nodeCount = () => js('document.querySelectorAll(".react-flow__node").length')
  const setControlled = (testid, value, proto, evt) =>
    js(`(() => {
      const el = document.querySelector('[data-testid="${testid}"]');
      Object.getOwnPropertyDescriptor(window.${proto}.prototype,'value').set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event('${evt}', { bubbles: true }));
    })()`)

  /**
   * 按"当初输入的那句话"定位画布节点 —— 用磁盘上的 prompt→id 映射，
   * **不要靠 innerText 里出现 label**：D.7 之后节点显示的是发散结果标题，
   * 真实模型给的标题通常不含原始输入（假生成器的标题恰好含，靠它匹配会得到假绿灯）。
   */
  const projectsDir = path.join(dataDir, 'projects')
  const readTree = () => {
    const files = fs.readdirSync(projectsDir)
    return JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8')).tree
  }
  const nodeIdByPrompt = (prompt) => {
    const n = readTree().nodes.find((x) => x.prompt === prompt)
    if (!n) throw new Error('no node for prompt: ' + prompt)
    return n.id
  }
  const nodeRect = (id) =>
    js(`(() => {
      const el = document.querySelector('.react-flow__node[data-id="${id}"]');
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { left: r.left, top: r.top, width: r.width, height: r.height };
    })()`)

  /** 等某个节点真的渲染到画布上并能量到坐标（节点是异步渲染的，量不到就没法派事件） */
  const waitNodeRect = async (id) => {
    let r = null
    await waitFor(async () => !!(r = await nodeRect(id)), 8000)
    if (!r) throw new Error('节点未渲染出坐标: ' + id)
    return r
  }

  /** 从右键菜单发起一次发散（带内容类型），生成一个子节点 */
  const ideasproutFrom = async (targetLabel, prompt, contentType) => {
    // 根节点用 label 找（它的 prompt 为空），子节点用 prompt→id 找。
    // ⚠️ 用 textContent 而非 innerText：innerText 依赖布局，节点刚插入/尚未排版的那一帧
    //    会返回空串 → 找不到元素 → 后面 querySelector(...).click() 在 null 上抛
    //    "Script failed to execute"（本机偶发命中过，全量回归连跑时更易触发）。
    let id = null
    if (targetLabel === '创意主题') {
      await waitFor(async () => {
        id = await js(`(() => {
          const el = Array.from(document.querySelectorAll('.react-flow__node')).find(n => (n.textContent || '').includes(${JSON.stringify(targetLabel)}));
          return el ? el.getAttribute('data-id') : null;
        })()`)
        return !!id
      }, 6000)
      if (!id) throw new Error('找不到根节点: ' + targetLabel)
    } else {
      id = nodeIdByPrompt(targetLabel)
    }
    const r = await waitNodeRect(id)
    await js(`(() => {
      const el = document.querySelector('.react-flow__node[data-id="${id}"]');
      el.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: ${Math.round(r.left + r.width / 2)}, clientY: ${Math.round(r.top + r.height / 2)} }));
    })()`)
    await sleep(220)
    if (!(await waitFor(() => js('!!document.querySelector(\'[data-testid="menu-ideasprout"]\')'), 4000))) {
      throw new Error('右键菜单未出现: ' + targetLabel)
    }
    await js('document.querySelector(\'[data-testid="menu-ideasprout"]\').click()')
    await sleep(220)
    await setControlled('prompt-input', prompt, 'HTMLTextAreaElement', 'input')
    if (contentType) await setControlled('content-type-select', contentType, 'HTMLSelectElement', 'change')
    await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
    await sleep(1200)
  }

  // ---------- 1. 造一棵小树：根 + markdown 子 + html 子 ----------
  check('initial canvas has 1 root node', (await nodeCount()) === 1)
  await ideasproutFrom('创意主题', '导出测试 A', 'markdown')
  await ideasproutFrom('创意主题', '导出测试 B', 'html')
  check('canvas has root + 2 children', (await nodeCount()) === 3, 'nodes=' + (await nodeCount()))
  check('no error banner', await js('!document.querySelector(\'[data-testid="app-error"]\')'))

  // 选中第一个子节点（供"收敛路径"用）—— 同样按 prompt 定位，不靠 label 文本
  const childAId = nodeIdByPrompt('导出测试 A')
  await waitNodeRect(childAId) // 等它真的渲染出来，否则下面的 querySelector 拿 null 直接抛
  await js(`(() => {
    const el = document.querySelector('.react-flow__node[data-id="${childAId}"]');
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  })()`)
  await sleep(300)

  // ---------- 2. 打开导出对话框 ----------
  check('export dialog closed initially', await js('!document.querySelector(\'[data-testid="export-dialog"]\')'))
  await js('document.querySelector(\'[data-testid="open-export"]\').click()')
  await sleep(600)
  check('export dialog opens', await js('!!document.querySelector(\'[data-testid="export-dialog"]\')'))
  check('scope select present', await js('!!document.querySelector(\'[data-testid="export-scope"]\')'))
  check('format select present', await js('!!document.querySelector(\'[data-testid="export-format"]\')'))
  const treeCount = await js('Number(document.querySelector(\'[data-testid="export-node-count"]\').innerText)')
  check('tree scope counts all 3 nodes', treeCount === 3, 'count=' + treeCount)
  const listText = await js('document.querySelector(\'[data-testid="export-preview-list"]\').innerText.replace(/\\n/g," | ")')
  check('preview list shows the hierarchy', listText.includes('创意主题') && listText.includes('导出测试 A'), JSON.stringify(listText.slice(0, 100)))

  // ---------- 3. 切到"收敛路径"范围 ----------
  await setControlled('export-scope', 'path', 'HTMLSelectElement', 'change')
  await sleep(300)
  const pathCount = await js('Number(document.querySelector(\'[data-testid="export-node-count"]\').innerText)')
  check('path scope narrows to the selected chain', pathCount === 2, 'count=' + pathCount)
  const hint = await js('document.querySelector(\'[data-testid="export-selection-hint"]\').innerText')
  check('hint explains the path scope', hint.includes('导出测试 A'), JSON.stringify(hint))

  // ---------- 4. 导出 Markdown（整树） ----------
  await setControlled('export-scope', 'tree', 'HTMLSelectElement', 'change')
  await setControlled('export-format', 'markdown', 'HTMLSelectElement', 'change')
  await sleep(250)
  nextPath = OUT_MD
  await js('document.querySelector(\'[data-testid="export-submit"]\').click()')
  await sleep(900)

  check('save dialog invoked once', dialogCalls.length === 1, 'calls=' + dialogCalls.length)
  check(
    'suggested filename is .md with a date stamp',
    /\.md$/.test(dialogCalls[0]?.defaultPath || '') && /\d{4}-\d{2}-\d{2}/.test(dialogCalls[0]?.defaultPath || ''),
    JSON.stringify(dialogCalls[0]?.defaultPath),
  )
  const resultText = await js('document.querySelector(\'[data-testid="export-result"]\').innerText')
  check('UI reports the saved path', resultText.includes(OUT_MD), JSON.stringify(resultText.slice(0, 120)))

  check('markdown file written to disk', fs.existsSync(OUT_MD))
  const md = fs.readFileSync(OUT_MD, 'utf-8')
  check('md starts with the project title', /^# /.test(md), JSON.stringify(md.split('\n')[0]))
  check('md meta line records scope + node count', md.includes('范围：完整发散树') && md.includes('节点数：3'), '')
  check('md nests by depth (root ##, child ###)', md.includes('## 创意主题') && md.includes('### 发散方案 #'), '')
  check('md records the prompt', md.includes('> 提示词：导出测试 A'), '')
  check('md inlines markdown content as-is', md.includes('- 占位内容 1'), '')
  check('md fences the html child instead of inlining it', md.includes('```html'), '')
  check('md does NOT fence the markdown child', !md.includes('```markdown'), '')
  // D.7：导出文档与界面一致，带上结构化评估
  check('md carries the analysis block', /\*\*可行性\*\*：\d+%（[高中低]）/.test(md) &&
    md.includes('**优点**：') && md.includes('**缺点**：') && md.includes('**风险**：'), '')
  check('md keeps the raw prompt as a side note, not as the heading',
    md.includes('> 提示词：导出测试 A') && !/^### 导出测试 A$/m.test(md), '')

  // ---------- 5. 导出单文件 HTML ----------
  await setControlled('export-format', 'html', 'HTMLSelectElement', 'change')
  await sleep(250)
  nextPath = OUT_HTML
  await js('document.querySelector(\'[data-testid="export-submit"]\').click()')
  await sleep(900)
  check('save dialog invoked a second time', dialogCalls.length === 2, 'calls=' + dialogCalls.length)
  check('suggested filename is .html', /\.html$/.test(dialogCalls[1]?.defaultPath || ''), JSON.stringify(dialogCalls[1]?.defaultPath))

  check('html file written to disk', fs.existsSync(OUT_HTML))
  const html = fs.readFileSync(OUT_HTML, 'utf-8')
  check('html declares doctype + lang', html.startsWith('<!doctype html>') && html.includes('lang="zh-CN"'), '')
  check('html is self-contained (inline <style>, no external refs)',
    html.includes('<style>') && !/<link\b/i.test(html) && !/src="https?:/i.test(html), '')
  check('html has a table of contents', html.includes('<nav class="toc">'), '')
  check('html escapes the project title into <title>', /<title>[^<]+<\/title>/.test(html), '')
  check('html carries the markdown typography', html.includes('.md-body'), '')
  // D.7：HTML 导出也要有评估区块（可行性百分比 + 高/中/低 + 优点/缺点/风险）
  check('html carries the analysis block', html.includes('class="analysis"') &&
    /可行性<\/span><span class="pct" style="color:#[0-9a-f]{6}">\d+%/.test(html) &&
    html.includes('class="pros"') && html.includes('class="cons"') && html.includes('class="risks"'), '')

  // ---------- 6. 用独立窗口打开导出的 HTML，确认内容真的渲染出来 ----------
  const viewer = new BrowserWindow({ show: false, width: 900, height: 700 })
  await viewer.loadFile(OUT_HTML)
  await sleep(500)
  const vjs = (code) => viewer.webContents.executeJavaScript(code)
  const sections = await vjs('document.querySelectorAll("section.node").length')
  check('viewer: one <section> per node', sections === 3, 'sections=' + sections)
  const h1s = await vjs('document.querySelectorAll(".md-body h1").length')
  check('viewer: markdown child rendered to a real <h1>', h1s >= 1, 'h1=' + h1s)
  const lists = await vjs('document.querySelectorAll(".md-body li").length')
  check('viewer: markdown list rendered to real <li>', lists >= 2, 'li=' + lists)
  const iframes = await vjs('document.querySelectorAll(\'iframe[sandbox=""]\').length')
  check('viewer: html child is sandboxed in an iframe', iframes === 1, 'iframes=' + iframes)
  const analysisBlocks = await vjs('document.querySelectorAll("section.node .analysis").length')
  check('viewer: analysis blocks render (only for nodes that have one)', analysisBlocks === 2,
    'blocks=' + analysisBlocks)
  const orphanText = await vjs('document.body.innerText.includes("未定义")')
  check('viewer: no template leakage / undefined text', orphanText === false, '')
  const viewerTitle = await vjs('document.title')
  check('viewer: title comes from the project', viewerTitle.includes('风衍 IdeaSprout'), JSON.stringify(viewerTitle))
  // 留一份"导出物实际渲染效果"的截图，便于肉眼确认排版
  const vimg = await viewer.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'export-html-screenshot.png'), vimg.toPNG())
  console.log('  screenshot written: export-html-screenshot.png')
  viewer.destroy()

  // ---------- 7. 收敛路径导出（文件名带标识） ----------
  await setControlled('export-scope', 'path', 'HTMLSelectElement', 'change')
  await setControlled('export-format', 'markdown', 'HTMLSelectElement', 'change')
  await sleep(250)
  const pathName = path.join(os.tmpdir(), `ideasprout-export-path-${process.pid}.md`)
  nextPath = pathName
  await js('document.querySelector(\'[data-testid="export-submit"]\').click()')
  await sleep(800)
  check('path export suggested name marks the scope',
    /收敛路径/.test(dialogCalls[2]?.defaultPath || ''), JSON.stringify(dialogCalls[2]?.defaultPath))
  const mdPath = fs.readFileSync(pathName, 'utf-8')
  check('path export covers exactly the chain', mdPath.includes('范围：收敛路径') && mdPath.includes('节点数：2'), '')
  check('path export starts at the root', mdPath.includes('## 创意主题'), '')
  check('path export does NOT include the sibling branch', !mdPath.includes('导出测试 B'), '')

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'canvas-screenshot.png'), img.toPNG())
  console.log('  screenshot written: canvas-screenshot.png')

  const pass = results.length > 0 && results.every(Boolean)
  console.log(`\n${pass ? 'D1_E2E_OK' : 'D1_E2E_FAIL'} (${results.filter(Boolean).length}/${results.length})`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
