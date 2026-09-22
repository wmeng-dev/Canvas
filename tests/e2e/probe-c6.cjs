// C.6 端到端验证探针：跑生产 bootstrap()，走真实 UI + 真实 safeStorage + 真实 MCP 子进程。
// 覆盖：DeepSeek key 保存/掩码/落盘形态 → 添加示例 MCP Server → 生成器列表刷新 →
//      停用/删除联动 → 界面永不回显明文密钥。
// 非产品代码，仅本地验证用（已 gitignore）。

const { app, BrowserWindow } = require('electron')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-c6-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const TEST_KEY = 'sk-test-abcdefghijklmnop-9876'
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
  const text = (sel) =>
    js(`(() => { const e = document.querySelector(${JSON.stringify(sel)}); return e ? e.innerText.replace(/\\n/g,' | ') : '(missing)'; })()`)
  const genCount = () => js('Number(document.querySelector(\'[data-testid="generator-count"]\').textContent.replace(/\\D/g, ""))')

  // ---------- 1. 打开面板 ----------
  check('AI panel closed initially', await js('!document.querySelector(\'[data-testid="ai-panel"]\')'))
  await js('document.querySelector(\'[data-testid="open-ai"]\').click()')
  await sleep(400)
  check('AI panel opens from header', await js('!!document.querySelector(\'[data-testid="ai-panel"]\')'))
  check('DeepSeek starts unconfigured', (await text('[data-testid="ds-status"]')).includes('未配置'))
  check('only the placeholder generator at first', (await genCount()) === 1, 'count=' + (await genCount()))

  // ---------- 2. 保存密钥 ----------
  await js(`(() => {
    const el = document.querySelector('[data-testid="ds-input"]');
    Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el, ${JSON.stringify(TEST_KEY)});
    el.dispatchEvent(new Event('input', { bubbles: true }));
  })()`)
  await js('document.querySelector(\'[data-testid="ds-save"]\').click()')
  await sleep(700)
  const dsStatus = await text('[data-testid="ds-status"]')
  check('DeepSeek shows configured + masked', dsStatus.includes('已配置') && dsStatus.includes('…'), JSON.stringify(dsStatus))
  check('mask hides the real key', !dsStatus.includes(TEST_KEY))
  check('generator count grew (placeholder + deepseek)', (await genCount()) === 2, 'count=' + (await genCount()))
  check('panel never echoes the raw key', !(await js('document.body.innerHTML.includes(' + JSON.stringify(TEST_KEY) + ')')))
  const hasWarning = await js('!!document.querySelector(\'[data-testid="ds-plaintext-warning"]\')')

  // 落盘形态：本机 safeStorage 可用则应加密，不可用才允许明文 ——
  // 不变量是「明文存储」与「界面警示」必须同时成立或同时不成立（降级不得静默）。
  const settingsPath = path.join(dataDir, 'settings.json')
  const onDisk = fs.readFileSync(settingsPath, 'utf-8')
  const protection = JSON.parse(onDisk).deepseek.protection
  check('settings.json records the protection mode', protection === 'safeStorage' || protection === 'plaintext', protection)
  if (protection === 'safeStorage') {
    check('raw key is NOT on disk (encrypted at rest)', !onDisk.includes(TEST_KEY))
    check('disk holds an encrypted payload', typeof JSON.parse(onDisk).deepseek.encrypted === 'string')
    check('no plaintext warning when keys are encrypted', !hasWarning)
  } else {
    check('degraded to plaintext only because the OS has no crypto backend', onDisk.includes(TEST_KEY))
    check('plaintext fallback is disclosed to the user', hasWarning)
  }

  // ---------- 3. 添加本地示例 MCP Server ----------
  await js('document.querySelector(\'[data-testid="mcp-add-sample"]\').click()')
  await sleep(2500) // 需要拉起子进程 + 握手 + listTools
  check('one MCP server listed', (await js('document.querySelectorAll(\'[data-testid="mcp-item"]\').length')) === 1)
  check('MCP server connected', (await js('document.querySelector(\'[data-testid="mcp-item"]\').getAttribute("data-state")')) === 'connected')
  const toolsText = await text('[data-testid="mcp-tools"]')
  check('tools discovered over MCP', toolsText.includes('generate'), JSON.stringify(toolsText))
  for (const n of ['list_projects', 'get_tree', 'get_node']) {
    check(`只读 tool "${n}" 也被发现并列出`, toolsText.includes(n), JSON.stringify(toolsText))
  }
  // 关键断言：示例 server 现在有 4 个 tool（1 生成 + 3 只读），但生成器**只 +1** ——
  // 只读 tool 靠 annotations.readOnlyHint 被排除在生成后端之外；
  // 若不排除，下拉里会多出 3 个"选了必然报错"的项（入参契约与 generate 完全不同）。
  check('generator count grew by exactly 1 (read-only tools excluded)', (await genCount()) === 3, 'count=' + (await genCount()))
  const persisted = JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).mcpServers[0]
  check('示例 server 的 env 注入了 IDEASPROUT_DATA_DIR（子进程据此读画布）',
    persisted.env.IDEASPROUT_DATA_DIR === dataDir, JSON.stringify(persisted.env))

  // ---------- 4. 生成器下拉里出现 MCP 后端 ----------
  await js('document.querySelector(\'[data-testid="ai-close"]\').click()')
  await sleep(300)
  await js('document.querySelector(\'[data-testid="new-idea"]\').click()')
  await sleep(300)
  const options = await js(
    'Array.from(document.querySelectorAll(\'[data-testid="generator-select"] option\')).map(o=>o.textContent)',
  )
  check('generator dropdown contains the MCP backend', options.some((o) => o.includes('本地示例 Server') && o.includes('generate')), JSON.stringify(options))
  for (const n of ['list_projects', 'get_tree', 'get_node']) {
    check(`只读 tool "${n}" 未进入生成器下拉`, !options.some((o) => o.includes(n)), JSON.stringify(options))
  }
  await js('document.querySelector(\'[data-testid="generate-dialog"]\').click()')
  await sleep(250)

  // ---------- 5. 停用 → 后端注销 ----------
  await js('document.querySelector(\'[data-testid="open-ai"]\').click()')
  await sleep(400)
  await js('document.querySelector(\'[data-testid="mcp-enabled"]\').click()')
  await sleep(1800)
  check('server reports disabled after unchecking',
    (await js('document.querySelector(\'[data-testid="mcp-item"]\').getAttribute("data-state")')) === 'disabled')
  check('generator count dropped back', (await genCount()) === 2, 'count=' + (await genCount()))

  // ---------- 6. 删除 ----------
  await js('document.querySelector(\'[data-testid="mcp-remove"]\').click()')
  await sleep(1200)
  check('server removed from list', (await js('document.querySelectorAll(\'[data-testid="mcp-item"]\').length')) === 0)
  check('settings.json no longer holds the server', JSON.parse(fs.readFileSync(settingsPath, 'utf-8')).mcpServers.length === 0)

  // ---------- 7. 清除密钥 ----------
  await js('document.querySelector(\'[data-testid="ds-clear"]\').click()')
  await sleep(700)
  check('DeepSeek back to unconfigured', (await text('[data-testid="ds-status"]')).includes('未配置'))
  check('generator count back to placeholder only', (await genCount()) === 1, 'count=' + (await genCount()))
  const finalSettings = JSON.parse(fs.readFileSync(settingsPath, 'utf-8'))
  check('key removed from disk entirely', finalSettings.deepseek === undefined, JSON.stringify(finalSettings))

  const img = await win.webContents.capturePage()
  fs.writeFileSync(path.join(ROOT, 'canvas-screenshot.png'), img.toPNG())
  console.log('  screenshot written: canvas-screenshot.png')

  const pass = results.length > 0 && results.every(Boolean)
  console.log(`\n${pass ? 'C6_E2E_OK' : 'C6_E2E_FAIL'} (${results.filter(Boolean).length}/${results.length})`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    app.exit(2)
  }),
)
