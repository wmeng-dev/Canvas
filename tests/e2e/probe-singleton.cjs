// 单实例锁探针（本地，gitignored）。
//
// ⚠️ 这个探针和别的不一样：它**自己拉起两个真实 Electron 进程**（跑 dist-electron/main/main.js），
// 因为单实例锁装在 main.ts 里，而其它探针是直接调 bootstrap()、压根不经过 main.ts。
// 本文件本身也由 Electron 执行，但它不建窗口、不 bootstrap —— 只当"启动器 + 断言器"。
//
// 覆盖：
//   ① 第一个实例能拿到锁并正常存活；
//   ② 第二个实例拿不到锁、打印提示后自行退出（而不是又开一个窗口去写同一批 JSON）；
//   ③ 第一个实例不受影响。
// 运行：node_modules/electron/dist/electron.exe probe-singleton.cjs（需清 ELECTRON_RUN_AS_NODE）
const { app } = require('electron')
const { spawn } = require('child_process')
const path = require('path')
const os = require('os')
const fs = require('fs')

const ROOT = path.resolve(__dirname, '../..')
const EXE = path.join(ROOT, 'node_modules', 'electron', 'dist', 'electron.exe')
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-singleton-'))
const LOCK_MSG = '单实例锁'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const results = []
const check = (name, cond, detail) => {
  results.push(!!cond)
  console.log((cond ? '  ✓ ' : '  ✗ ') + name + (detail !== undefined ? '  → ' + detail : ''))
}

function launch(tag) {
  const env = { ...process.env, IDEASPROUT_FORCE_DIST: '1', IDEASPROUT_DATA_DIR: DATA_DIR }
  // 否则 Electron 退化成 Node：`app` 是 undefined，启动即崩 —— 会把"锁没生效"
  // 伪装成"进程退出了"。
  delete env.ELECTRON_RUN_AS_NODE
  const child = spawn(EXE, [ROOT], { cwd: ROOT, env, stdio: ['ignore', 'pipe', 'pipe'] })
  child.tag = tag
  child.out = ''
  child.exited = false
  const collect = (b) => {
    child.out += b.toString('utf8')
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  child.on('exit', (code) => {
    child.exited = true
    child.exitCode = code
  })
  return child
}

async function main() {
  console.log('\n[A] 第一个实例应该正常起来')
  const a = launch('A')
  await sleep(6000)
  if (a.exited) {
    check('第一个实例拿到锁并存活', false, `A 提前退出 exit=${a.exitCode}；本机可能已有实例在跑，请关掉重试`)
    return finish()
  }
  check('第一个实例拿到锁并存活', true)
  check('第一个实例没有打印锁提示', !a.out.includes(LOCK_MSG))

  console.log('\n[B] 第二个实例应该被挡住')
  const b = launch('B')
  const t0 = Date.now()
  while (!b.exited && Date.now() - t0 < 20000) await sleep(200)
  check('第二个实例自行退出（没有又开一个窗口）', b.exited, b.exited ? `exit=${b.exitCode}` : '20s 内没退出')
  check('第二个实例打印了单实例锁提示', b.out.includes(LOCK_MSG), JSON.stringify(b.out.trim().slice(-140)))

  console.log('\n[C] 第一个实例不受影响')
  check('第一个实例仍然存活', !a.exited)
  check('第一个实例建了画布数据（说明真的跑起来了）', fs.existsSync(path.join(DATA_DIR, 'app-state.json')))

  a.kill()
  await sleep(600)
  return finish()
}

function finish() {
  const total = results.length
  const passedCount = results.filter(Boolean).length
  console.log(`\nSINGLETON_E2E ${passedCount === total && total > 0 ? 'OK' : 'FAIL'} (${passedCount}/${total})`)
  if (total === 0) console.log('（零断言 —— 探针本身坏了，视为失败）')
  app.exit(passedCount === total && total > 0 ? 0 : 1)
}

app.whenReady().then(() =>
  main().catch((e) => {
    console.error('PROBE ERROR:', e)
    finish()
  }),
)
