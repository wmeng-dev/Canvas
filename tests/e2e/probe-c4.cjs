// C.4 端到端验证探针：跑生产 bootstrap()，用假生成器（echo 模式）驱动多类型预览。
// 验证：markdown / html / svg / text 各自渲染正确；HTML 与 SVG 的脚本被沙箱挡住（真 XSS 载荷）。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-c4-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FAKE_ECHO = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
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

  // 通过 UI 生成一个节点：开对话框 → 输入 → 选类型 → 提交
  async function generate(prompt, type) {
    await js('document.querySelector(\'[data-testid="new-idea"]\').click()')
    await sleep(220)
    await js(`(() => {
      const ta = document.querySelector('[data-testid="prompt-input"]');
      const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, 'value').set;
      setter.call(ta, ${JSON.stringify(prompt)});
      ta.dispatchEvent(new Event('input', { bubbles: true }));
      const sel = document.querySelector('[data-testid="content-type-select"]');
      const ssetter = Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype, 'value').set;
      ssetter.call(sel, ${JSON.stringify(type)});
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    })()`)
    await sleep(120)
    const typeApplied = await js('document.querySelector(\'[data-testid="content-type-select"]\').value')
    await js('document.querySelector(\'[data-testid="submit-generate"]\').click()')
    await sleep(800)
    return typeApplied
  }

  // ---------- 阶段 1：Markdown ----------
  const t1 = await generate('减法：<b>不应成为元素</b>', 'markdown')
  check('content-type select applies (markdown)', t1 === 'markdown', t1)
  check('markdown badge shown', (await js('document.querySelector(\'[data-testid="preview-type"]\').textContent')) === 'Markdown')
  check('markdown rendered as DOM (h1)', await js('!!document.querySelector(\'[data-testid="preview-markdown"] h1\')'))
  check('markdown rendered list items', await js('document.querySelectorAll(\'[data-testid="preview-markdown"] li\').length === 3'))
  check(
    'markdown does NOT parse embedded HTML (no <b> element)',
    await js('document.querySelector(\'[data-testid="preview-markdown"] b\') === null'),
    await js('document.querySelector(\'[data-testid="preview-markdown"] h1\').textContent'),
  )

  // ---------- 阶段 2：HTML（沙箱 iframe）----------
  await generate('HTML 卡片预览', 'html')
  check('html badge shown', (await js('document.querySelector(\'[data-testid="preview-type"]\').textContent')) === 'HTML')
  check('html preview is an iframe', await js('document.querySelector(\'[data-testid="preview-html"]\').tagName === "IFRAME"'))
  check('html iframe sandbox attribute is locked down (empty)', (await js('document.querySelector(\'[data-testid="preview-html"]\').getAttribute("sandbox")')) === '')
  // 注意：宿主页是 file://，此时 Chromium 仍允许父页读沙箱 iframe 的 contentDocument，
  // 所以 contentDocument===null 不是可靠的隔离判据。用 contentWindow.origin 判（不透明源应为 "null"）。
  check(
    'html iframe runs in opaque origin (contentWindow.origin === "null")',
    (await js('document.querySelector(\'[data-testid="preview-html"]\').contentWindow.origin')) === 'null',
  )

  // ---------- 阶段 3：纯文本 ----------
  await generate('纯文本节点', 'text')
  check('text badge shown', (await js('document.querySelector(\'[data-testid="preview-type"]\').textContent')) === '纯文本')
  check('text preview is <pre>', await js('document.querySelector(\'[data-testid="preview-text"]\').tagName === "PRE"'))

  // ---------- 阶段 4：XSS 载荷（真尝试越权）----------
  const PAYLOAD = '<script>window.__pwned = 1; parent.__pwned2 = 1;</script><h2 id="evil">injected</h2>'
  await generate(PAYLOAD, 'html')
  const srcdocHasPayload = await js(
    'document.querySelector(\'[data-testid="preview-html"]\').getAttribute("srcdoc").includes("<script>")',
  )
  check('hostile payload really present in srcdoc (test is not vacuous)', srcdocHasPayload)
  check('script did NOT run in host (window.__pwned undefined)', (await js('typeof window.__pwned')) === 'undefined')
  check('script did NOT reach parent (window.__pwned2 undefined)', (await js('typeof window.__pwned2')) === 'undefined')
  check('payload did not inject into host DOM', await js('document.getElementById("evil") === null'))

  // ---------- 阶段 5：SVG（沙箱 iframe）----------
  await generate('SVG 图形预览', 'svg')
  check('svg badge shown', (await js('document.querySelector(\'[data-testid="preview-type"]\').textContent')) === 'SVG')
  check('svg preview is a sandboxed iframe', await js('document.querySelector(\'[data-testid="preview-svg"]\').tagName === "IFRAME"'))
  check(
    'svg sandbox attribute is locked down (empty)',
    (await js('document.querySelector(\'[data-testid="preview-svg"]\').getAttribute("sandbox")')) === '',
  )
  check(
    'svg payload actually contains <svg> markup',
    await js('document.querySelector(\'[data-testid="preview-svg"]\').getAttribute("srcdoc").includes("<svg")'),
  )

  // ---------- 落盘校验：contentType 已持久化 ----------
  const projectsDir = path.join(dataDir, 'projects')
  const files = fs.readdirSync(projectsDir)
  const disk = JSON.parse(fs.readFileSync(path.join(projectsDir, files[0]), 'utf8'))
  const types = disk.tree.nodes.map((n) => n.contentType)
  check('disk persisted contentType per node', JSON.stringify(types) === JSON.stringify(['markdown', 'markdown', 'html', 'text', 'html', 'svg']), JSON.stringify(types))
  check('canvas shows root + 5 generated nodes', disk.tree.nodes.length === 6, 'nodes=' + disk.tree.nodes.length)

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'canvas-screenshot.png'), img.toPNG())
  console.log('  screenshot written: canvas-screenshot.png')

  const pass = results.length > 0 && results.every(Boolean)
  console.log(`\n${pass ? 'C4_E2E_OK' : 'C4_E2E_FAIL'} (${results.filter(Boolean).length}/${results.length})`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
