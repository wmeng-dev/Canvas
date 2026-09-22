#!/usr/bin/env node
/**
 * 一条命令跑完全部验证：类型检查 → 单元测试 → 端到端探针。
 *
 * 为什么要有它：`.github/` 进不了仓库（PAT 缺 workflow scope），所以本地这一条命令就是
 * 唯一的"全绿"口径。刻意只用 Node 实现（不依赖 python），换台机器直接能跑。
 *
 * 用法：
 *   node scripts/verify.cjs                        # 全量（跳过需要 dev server 的探针）
 *   node scripts/verify.cjs --skip-build           # 跳过编译/构建（产物已是最新时更快）
 *   node scripts/verify.cjs --probes-only          # 只跑探针
 *   node scripts/verify.cjs --probes=a.cjs,b.cjs   # 只跑指定探针（含 probe-dev）
 *   node scripts/verify.cjs --all                  # 连需要 dev server 的探针也跑（要先把 vite 起起来）
 *   node scripts/verify.cjs --unit-only            # 只跑单元测试
 *   node scripts/verify.cjs --list                 # 列出探针
 *
 * ⚠️ 探针的成功标记**各家不同**（CHROME_E2E OK / D1_E2E_OK / C3_..C6_E2E_OK / D3_E2E OK /
 *    MINIMAP_E2E OK / SINGLETON_E2E OK / MENU_E2E OK / RFSTATE_E2E OK / DEV_E2E OK /
 *    UI_WALKTHROUGH_DONE），所以这里用通用正则匹配。曾因为只认 CHROME_E2E，把好几个全过的
 *    探针误报成 NO-RESULT。
 *    ➜ **新写探针务必打一条 `<名>_E2E OK (n/m)`**，否则这里认不出来会被算作失败。
 */
const { spawnSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const ROOT = path.resolve(__dirname, '..')
const E2E_DIR = path.join(ROOT, 'tests', 'e2e')
const TESTS_DIR = path.join(ROOT, 'tests')

const argv = process.argv.slice(2)
const has = (f) => argv.includes(f)
const valueOf = (name) => {
  const hit = argv.find((a) => a.startsWith(`--${name}=`))
  return hit ? hit.slice(name.length + 3) : null
}

const skipBuild = has('--skip-build')
const probesOnly = has('--probes-only')
const unitOnly = has('--unit-only')
const forceAll = has('--all')
const onlyProbes = valueOf('probes')

const MARKER = /([A-Z0-9_]+E2E)[_ ](OK|FAIL)\s*\((\d+)\/(\d+)\)/
const ELECTRON = process.platform === 'win32'
  ? path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
  : path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron')

/**
 * 需要**外部前提**的探针：默认跳过。
 * probe-dev 故意不设 IDEASPROUT_FORCE_DIST，要连 :5173 的 Vite dev server —— 它验的是
 * "开发态分支"，裸机/CI 上没有 dev server 时只会等到超时（假失败，噪音）。
 * 要用就：① `node node_modules/vite/bin/vite.js` 起服务 ② `--probes=probe-dev.cjs`
 * （或 `--all`）。**别把它们算进失败**，否则"一条命令全绿"永远做不到。
 */
const NEEDS_DEV_SERVER = ['probe-dev.cjs']

const results = []
const skipped = []
const record = (group, name, ok, detail) => {
  results.push({ group, name, ok, detail })
  console.log(`  ${ok ? '✓' : '✗'} [${group}] ${name}${detail ? '  → ' + detail : ''}`)
}

/** 跑一个命令，返回 {code, out}（out = stdout+stderr）。 */
function run(cmd, args, opts = {}) {
  const r = spawnSync(cmd, args, {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: opts.timeout || 300000,
    maxBuffer: 64 * 1024 * 1024,
    env: opts.env || process.env,
  })
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') }
}

/** 探针环境：必须清掉 ELECTRON_RUN_AS_NODE，否则 Electron 退化成 Node、启动即退出。 */
function probeEnv() {
  const env = { ...process.env }
  delete env.ELECTRON_RUN_AS_NODE
  env.ELECTRON_ENABLE_LOGGING = '0'
  return env
}

function listProbes() {
  return fs.readdirSync(E2E_DIR).filter((f) => /^probe-.*\.cjs$/.test(f)).sort()
}

// ---------------------------------------------------------------- 0. 准备
console.log('风衍 IdeaSprout · 全量验证\n')
console.log(`仓库根：${ROOT}\n`)

if (has('--list')) {
  console.log('探针清单：')
  for (const p of listProbes()) {
    console.log('  ' + p + (NEEDS_DEV_SERVER.includes(p) ? '   （需 dev server，默认跳过）' : ''))
  }
  process.exit(0)
}

const totalStart = Date.now()

// ---------------------------------------------------------------- 1. 编译 / 构建
if (!probesOnly && !unitOnly && !skipBuild) {
  console.log('[1/3] 类型检查与构建')
  const steps = [
    ['主进程编译', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.main.json']],
    ['渲染端类型检查', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
    ['单测编译', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.test.json']],
    ['渲染端构建', ['node_modules/vite/bin/vite.js', 'build']],
  ]
  for (const [name, args] of steps) {
    const { code, out } = run(process.execPath, args)
    record('build', name, code === 0, code === 0 ? '' : out.split('\n').slice(-4).join(' | '))
  }
} else if (skipBuild || probesOnly || unitOnly) {
  console.log('[1/3] 已跳过编译与构建')
}

// ---------------------------------------------------------------- 2. 单元测试
if (!probesOnly) {
  console.log('\n[2/3] 单元测试（src/core + src/shared）')
  const unitFiles = fs.readdirSync(TESTS_DIR)
    .filter((f) => f.endsWith('.test.cjs'))
    .sort()
  if (unitFiles.length === 0) record('unit', '存在单测文件', false, 'tests/*.test.cjs 一个都没有')
  for (const f of unitFiles) {
    const { code, out } = run(process.execPath, [path.join('tests', f)])
    // ⚠️ 各单测的收尾标记格式并不统一（`ALL X PASSED (13 checks)` / `X_TESTS OK (27)` /
    // `x: 21 checks passed`），所以别去匹配那句话 —— 直接数 `ok()` 打出来的 ✓。
    // 通过与否仍以退出码为准（单测用 assert，失败即非 0）。
    const checks = (out.match(/✓/g) || []).length
    record('unit', f, code === 0, code === 0 ? `${checks} 项` : out.split('\n').slice(-6).join(' | '))
  }
}

// ---------------------------------------------------------------- 3. 端到端探针
if (!unitOnly) {
  console.log('\n[3/3] 端到端探针（真窗口 + 生产 bootstrap）')
  if (!fs.existsSync(ELECTRON)) {
    record('e2e', 'electron 可执行文件存在', false, ELECTRON)
  } else {
    const all = listProbes()
    const chosen = onlyProbes ? onlyProbes.split(',').map((s) => s.trim()).filter(Boolean) : all
    for (const name of chosen) {
      const file = path.join(E2E_DIR, name)
      if (!fs.existsSync(file)) {
        record('e2e', name, false, '文件不存在')
        continue
      }
      // 显式点名（--probes=）或 --all 时照跑；否则跳过需要外部前提的探针。
      if (!onlyProbes && !forceAll && NEEDS_DEV_SERVER.includes(name)) {
        skipped.push(name)
        console.log(`  – [e2e] ${name}  → 跳过（需 dev server / 显式指定）`)
        continue
      }
      const t0 = Date.now()
      const { code, out } = run(ELECTRON, [file], { env: probeEnv(), timeout: 300000 })
      const secs = ((Date.now() - t0) / 1000).toFixed(1)

      const m = MARKER.exec(out)
      let ok
      let detail
      if (m) {
        ok = m[2] === 'OK'
        detail = `${m[3]}/${m[4]} (${m[1]}) ${secs}s`
      } else if (out.includes('UI_WALKTHROUGH_DONE')) {
        ok = true
        detail = `走查完成 ${secs}s`
      } else {
        ok = false
        detail = `无可识别的结果标记（exit=${code}）`
      }
      record('e2e', name, ok, detail)
      if (!ok) {
        console.log('    ---- 输出尾部 ----')
        console.log(out.split('\n').slice(-18).map((l) => '    ' + l).join('\n'))
        console.log('    ------------------')
      }
    }
  }
}

// ---------------------------------------------------------------- 汇总
const bad = results.filter((r) => !r.ok)
const byGroup = (g) => results.filter((r) => r.group === g)
const line = (g, label) => {
  const rs = byGroup(g)
  if (rs.length === 0) return null
  const p = rs.filter((r) => r.ok).length
  return `${label}: ${p}/${rs.length}`
}
console.log('\n===== 汇总 =====')
for (const [g, label] of [['build', '编译构建'], ['unit', '单元测试'], ['e2e', '端到端探针']]) {
  const l = line(g, label)
  if (l) console.log(l)
}
if (skipped.length) console.log(`跳过: ${skipped.length}（${skipped.join(', ')}）—— 需 dev server，见 verify.cjs 顶部说明`)
console.log(`耗时 ${((Date.now() - totalStart) / 1000).toFixed(1)}s`)
console.log(bad.length === 0 ? '\nVERIFY OK —— 全部通过' : `\nVERIFY FAIL —— ${bad.length} 项未通过：\n` + bad.map((b) => `  · [${b.group}] ${b.name}`).join('\n'))
process.exit(bad.length === 0 ? 0 : 1)
