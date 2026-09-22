#!/usr/bin/env node
/**
 * Windows 安装包一条龙打包。
 *
 * 为什么需要它：electron-builder 给 exe 打图标/版本信息时要先用 winCodeSign，
 * 而 winCodeSign 包里含 macOS 符号链接，Windows 上创建符号链接需要特权
 * （开发者模式 / 管理员）。没有特权时 7za 报：
 *     ERROR: Cannot create symbolic link : 客户端没有所需的特权。
 *     ...\winCodeSign\<hash>\darwin\10.12\lib\libcrypto.dylib
 * 此时常见的绕过是 -c.win.signAndEditExecutable=false，**代价是 exe 丢掉自定义图标
 * 与版本信息**（快捷方式、任务管理器、文件属性里全是默认 Electron 的样子）。
 *
 * 本脚本的做法：
 *   ① 先按标准姿势打一次（--win 一把过）。有开发者模式的机器到这里就结束了。
 *   ② 只有撞上上面那个符号链接错误才兜底，且**把图标补回来**：
 *      a. --dir 出免安装目录（跳过 rcedit）
 *      b. 拿 rcedit 手工写图标 + 版本信息（参数逐条对齐 app-builder-lib 的
 *         signAndEditResources，见 patchExeResources）。rcedit 来源按优先级：
 *         自留地 → winCodeSign 缓存残留目录 → 自己解压 winCodeSign.7z（排除 darwin，
 *         绕开符号链接）→ 从镜像下载后再解压
 *      c. 读回 exe 字节校验（版本串 + 图标数据），没打上就报错，不闷声出货
 *      d. --prepackaged 用这个已打补丁的目录压 NSIS 安装包（不会重建，补丁保住）
 *
 * 用法：
 *   node scripts/dist-win.cjs                  # 编译 + 打包（自动选新输出目录）
 *   node scripts/dist-win.cjs --skip-build     # 跳过编译，只打包
 *   node scripts/dist-win.cjs --dir-only       # 只出免安装目录，快速自测
 *   node scripts/dist-win.cjs --standard       # 强制标准姿势，失败不倒腾兜底
 *   node scripts/dist-win.cjs --out=release-x  # 指定输出目录
 *
 * 输出：<out>/（标准姿势或 --dir-only）或 <out>/installer/（兜底流程）里的
 *       IdeaSprout-<version>-win-x64-setup.exe
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('child_process')
const { runElectronBuilder, MIRROR_DEFAULTS } = require('./dist.cjs')

const ROOT = path.join(__dirname, '..')
const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'))

// ---------- 参数 ----------
const argv = process.argv.slice(2)
const hasFlag = (name) => argv.includes(name)
const outArg = (argv.find((a) => a.startsWith('--out=')) || '').split('=')[1]

const SKIP_BUILD = hasFlag('--skip-build')
const DIR_ONLY = hasFlag('--dir-only')
const FORCE_STANDARD = hasFlag('--standard')

const ICON = path.join(ROOT, 'build', 'icon.ico')
const EXE_NAME = `${productName()}.exe`

function productName() {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
  const m = yml.match(/^productName:\s*(.+)$/m)
  return m ? m[1].trim() : pkg.name
}
function copyright() {
  const yml = fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')
  const m = yml.match(/^copyright:\s*(.+)$/m)
  return m ? m[1].trim() : ''
}

/**
 * 与 app-builder-lib 的 AppInfo.updaterCacheDirName **同源**：
 *   sanitizeFileName(package.json 的 name).toLowerCase() + '-updater'
 * （见 node_modules/app-builder-lib/out/appInfo.js:122-127）。
 * 写错不致命，但会在用户机器上多留一套更新缓存目录 —— 所以这里不做手拼，走同一个 sanitizer。
 */
function updaterCacheDirName() {
  let sanitize
  try {
    sanitize = require('sanitize-filename')
  } catch {
    sanitize = (s) => String(s).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-')
  }
  return sanitize(pkg.name).toLowerCase() + '-updater'
}

/**
 * 补齐 resources/app-update.yml —— 客户端自动更新的"托管地址清单"。
 *
 * 为什么必须补：electron-builder 只在 afterPack 钩子里写它，且**仅当本次构建目标满足
 * isSuitableWindowsTarget（nsis）**（app-builder-lib/out/publish/PublishManager.js:88）；
 * 而兜底流程最后一步是 `--prepackaged`，platformPackager.js:143 有一句
 * `if (packagerOptions.prepackaged != null) return;` —— doPack 直接提前返回，
 * afterPack 根本不会被调用。所以**兜底流程必然缺这个文件**，打包出来的 exe 一启动
 * 就报 "Cannot find app-update.yml"，自动更新彻底不工作（且是静默的，用户看不出来）。
 *
 * 已经存在就**不覆盖**：标准姿势下 electron-builder 自己写的那份是权威版本，
 * 这里只在它缺席时补位。内容由 electron-builder.yml 的 publish 段推导，字段与官方一致。
 */
function ensureAppUpdateYml(resourcesDir, label) {
  if (!fs.existsSync(resourcesDir)) {
    console.log(`[updater] ⚠ 找不到 ${path.relative(ROOT, resourcesDir)}，跳过 app-update.yml`)
    return false
  }
  const file = path.join(resourcesDir, 'app-update.yml')
  if (fs.existsSync(file)) {
    console.log(`[updater] ✓ app-update.yml 已存在（electron-builder 生成，${label}）`)
    return true
  }
  let yaml
  try {
    yaml = require('js-yaml')
  } catch {
    console.log('[updater] ⚠ 拿不到 js-yaml，无法补写 app-update.yml（自动更新会不可用）')
    return false
  }
  const conf = yaml.load(fs.readFileSync(path.join(ROOT, 'electron-builder.yml'), 'utf8')) || {}
  const publish = Array.isArray(conf.publish) ? conf.publish[0] : conf.publish
  if (!publish || !publish.provider) {
    console.log('[updater] ⚠ electron-builder.yml 里没有 publish 配置，无法补写 app-update.yml')
    return false
  }
  const payload = { ...publish, updaterCacheDirName: updaterCacheDirName() }
  fs.writeFileSync(file, yaml.dump(payload))
  console.log(`[updater] ✓ 已补写 app-update.yml（${label}）→ ${path.relative(ROOT, file)}`)
  console.log(`[updater]   ${JSON.stringify(payload)}`)
  return true
}

/** 输出目录：显式指定优先；否则 release-win-<yyyymmdd-HHMM>，撞名/被占用就用下一个 */
function pickOutDir() {
  if (outArg) return path.resolve(ROOT, outArg)
  const d = new Date()
  const pad = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`
  let p = path.join(ROOT, `release-win-${stamp}`)
  let n = 2
  while (fs.existsSync(p)) p = path.join(ROOT, `release-win-${stamp}-${n++}`)
  return p
}

// electron-builder 参数：只负责把输出目录推进去（中文产物名靠 yml 里的 artifactName 兜住）。
// 一律传相对路径，避免 electron-builder 对中文绝对路径的处理差异。
function ebArgs(dir, extra = []) {
  return [...extra, `-c.directories.output=${path.relative(ROOT, dir)}`]
}

// ---------- 步骤 1：编译 ----------
function compile() {
  const steps = [
    ['编译主进程', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.main.json']],
    ['类型检查渲染端', ['node_modules/typescript/bin/tsc', '-p', 'tsconfig.json', '--noEmit']],
    ['构建渲染端', ['node_modules/vite/bin/vite.js', 'build']],
  ]
  for (const [label, args] of steps) {
    process.stdout.write(`[build] ${label} ... `)
    const r = spawnSync(process.execPath, args, { cwd: ROOT, encoding: 'utf8' })
    if (r.status !== 0) {
      console.log('失败')
      console.log((r.stdout || '') + (r.stderr || ''))
      fail(`编译步骤「${label}」失败`)
    }
    console.log('ok')
  }
}

// ---------- 步骤 2：rcedit 补图标 + 版本信息 ----------
const WINCODESIGN_VERSION = 'winCodeSign-2.6.0'
const cacheRoot = path.join(
  process.env.LOCALAPPDATA || process.env.APPDATA || os.homedir(),
  'electron-builder',
  'Cache'
)
const ownCache = path.join(cacheRoot, 'winCodeSign-noDarwin')

function candidatesInWinCodeSignCache() {
  const base = path.join(cacheRoot, 'winCodeSign')
  if (!fs.existsSync(base)) return []
  return fs
    .readdirSync(base)
    .map((d) => path.join(base, d, 'rcedit-x64.exe'))
    .filter((p) => fs.existsSync(p))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)
}

function find7za() {
  const p = path.join(ROOT, 'node_modules', '7zip-bin', 'win', 'x64', '7za.exe')
  return fs.existsSync(p) ? p : null
}

function winCodeSign7z() {
  const base = path.join(cacheRoot, 'winCodeSign')
  const local = fs.existsSync(base)
    ? fs
        .readdirSync(base)
        .filter((f) => f.endsWith('.7z'))
        .map((f) => path.join(base, f))
        .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs)[0]
    : null
  return local || null
}

function download(url, dest) {
  return new Promise((resolve, reject) => {
    const https = require('https')
    const http = require('http')
    const client = url.startsWith('https') ? https : http
    client
      .get(url, (res) => {
        if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
          res.resume()
          return download(res.headers.location, dest).then(resolve, reject)
        }
        if (res.statusCode !== 200) {
          res.resume()
          return reject(new Error(`HTTP ${res.statusCode} ${url}`))
        }
        const f = fs.createWriteStream(dest)
        res.pipe(f)
        f.on('finish', () => f.close(() => resolve(dest)))
        f.on('error', reject)
      })
      .on('error', reject)
  })
}

/**
 * 找到（必要时现造）一个可用的 rcedit。
 * 关键点：解压 winCodeSign 时排除 darwin/ —— 那两个 macOS 符号链接正是报错源头，
 * Windows 打包根本用不到它们。
 */
async function ensureRcedit() {
  const own = path.join(ownCache, 'rcedit-x64.exe')
  if (fs.existsSync(own)) {
    console.log(`[patch] 使用上次自解的 rcedit：${own}`)
    return own
  }

  const cached = candidatesInWinCodeSignCache()
  if (cached.length) {
    console.log(`[patch] 复用 winCodeSign 缓存里残留的 rcedit：${cached[0]}`)
    return cached[0]
  }

  const sz = find7za()
  if (!sz) {
    console.log('[patch] 找不到 7za.exe，无法自行解压 winCodeSign')
    return null
  }

  let archive = winCodeSign7z()
  if (!archive) {
    const base =
      process.env.ELECTRON_BUILDER_BINARIES_MIRROR ||
      MIRROR_DEFAULTS.ELECTRON_BUILDER_BINARIES_MIRROR
    const url = `${base}${WINCODESIGN_VERSION}/${WINCODESIGN_VERSION}.7z`
    fs.mkdirSync(path.join(cacheRoot, 'winCodeSign'), { recursive: true })
    archive = path.join(cacheRoot, 'winCodeSign', `${WINCODESIGN_VERSION}.7z`)
    console.log(`[patch] 本地没有 winCodeSign 包，从镜像下载：${url}`)
    try {
      await download(url, archive)
    } catch (e) {
      console.log(`[patch] 下载失败：${e.message}`)
      return null
    }
  }

  fs.mkdirSync(ownCache, { recursive: true })
  console.log('[patch] 自行解压 winCodeSign（排除 darwin，绕开符号链接特权要求）')
  const r = spawnSync(sz, ['x', archive, '-o' + ownCache, '-x!darwin', '-y'], { encoding: 'utf8' })
  if (r.status !== 0 || !fs.existsSync(own)) {
    console.log('[patch] 解压失败：', (r.stderr || r.stdout || '').trim().slice(0, 400))
    return null
  }
  return own
}

/** 参数逐条对齐 app-builder-lib/out/winPackager.js 的 signAndEditResources */
function patchExeResources(rcedit, exe) {
  const args = [
    exe,
    '--set-icon',
    ICON,
    '--set-version-string',
    'FileDescription',
    productName(),
    '--set-version-string',
    'ProductName',
    productName(),
    '--set-version-string',
    'CompanyName',
    pkg.author || '',
    '--set-version-string',
    'InternalName',
    productName(),
    '--set-file-version',
    pkg.version,
    '--set-product-version',
    `${pkg.version}.0`,
  ]
  const cr = copyright()
  if (cr) args.push('--set-version-string', 'LegalCopyright', cr)
  // node 传参是 UTF-16 → 中文产品名不会乱码
  const r = spawnSync(rcedit, args, { encoding: 'utf8' })
  if (r.status !== 0) {
    console.log('[patch] rcedit 失败：', (r.stderr || r.stdout || '').trim().slice(0, 400))
    return false
  }
  return true
}

/** 读回字节校验：版本串（硬断言）+ 图标数据（软警告） */
function verifyPatchedExe(exe) {
  const buf = fs.readFileSync(exe)
  const u16 = (s) => Buffer.from(s, 'utf16le')
  const strings = [productName(), `${pkg.version}.0`]
  const cr = copyright()
  if (cr) strings.push(cr)
  const missing = strings.filter((s) => !buf.includes(u16(s)))
  if (missing.length) {
    console.log(`[verify] ✗ exe 里缺版本串：${missing.join(' / ')}`)
    return false
  }
  console.log(`[verify] ✓ 版本信息已写入（${strings.join(' / ')}）`)

  if (!fs.existsSync(ICON)) {
    console.log('[verify] ⚠ 找不到 build/icon.ico，跳过图标字节校验')
    return true
  }
  const ico = fs.readFileSync(ICON)
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const starts = []
  for (let i = 0; i < ico.length - 8; i++) if (ico.slice(i, i + 8).equals(sig)) starts.push(i)
  if (!starts.length) {
    console.log('[verify] ⚠ icon.ico 里没有 PNG 条目（BMP 条目不做字节比对），跳过图标校验')
    return true
  }
  let hit = 0
  starts.forEach((s, i) => {
    const end = i + 1 < starts.length ? starts[i + 1] : ico.length
    const png = ico.slice(s, end)
    if (png.length > 512 && buf.includes(png)) hit++
  })
  console.log(
    hit
      ? `[verify] ✓ 自定义图标已写入（${hit}/${starts.length} 个尺寸命中）`
      : `[verify] ⚠ icon.ico 的 ${starts.length} 个 PNG 条目在 exe 里都没命中 —— 图标可能没打上`
  )
  return true
}

// ---------- 工具 ----------
function fail(msg) {
  console.error(`\n✗ ${msg}`)
  process.exit(1)
}

function sizeOf(p) {
  try {
    return `${(fs.statSync(p).size / 1024 / 1024).toFixed(1)} MB`
  } catch {
    return '(缺失)'
  }
}

function listInstallers(dir) {
  if (!fs.existsSync(dir)) return []
  return fs
    .readdirSync(dir)
    .filter((f) => /setup.*\.exe$/i.test(f))
    .map((f) => path.join(dir, f))
}

function report(dirs) {
  console.log('\n================ 打包结果 ================')
  const installers = dirs.flatMap(listInstallers)
  if (installers.length) {
    for (const p of installers) console.log(`安装包  ${sizeOf(p)}  ${path.relative(ROOT, p)}`)
  } else {
    const unpacked = dirs.map((d) => path.join(d, 'win-unpacked')).find((d) => fs.existsSync(d))
    if (unpacked) console.log(`免安装目录（未压安装包）：${path.relative(ROOT, unpacked)}`)
  }
  console.log('=========================================')
}

// ---------- 主流程 ----------
async function main() {
  const out = pickOutDir()
  console.log(`[run] 输出目录：${path.relative(ROOT, out)}`)
  if (os.platform() !== 'win32') {
    console.log('⚠ 当前不是 Windows，打包 Windows 目标通常会失败（跨平台限制）')
  }

  if (!SKIP_BUILD) compile()
  else console.log('[build] 跳过编译（--skip-build）')

  if (DIR_ONLY) {
    const r = runElectronBuilder(['--win', '--dir', ...ebArgs(out), '-c.win.signAndEditExecutable=false'])
    if (r.status !== 0) fail('--dir-only 打包失败')
    ensureAppUpdateYml(path.join(out, 'win-unpacked', 'resources'), '--dir-only')
    report([out])
    return
  }

  // ① 标准姿势：有开发者模式/管理员的机器一次过
  if (!FORCE_STANDARD) {
    console.log('\n[1/2] 先按标准姿势打包（一把过则无需兜底）')
    const r = runElectronBuilder(['--win', ...ebArgs(out)], { capture: true })
    if (r.status === 0) {
      console.log('\n✓ 标准姿势成功（本机具备符号链接特权，无需兜底）')
      ensureAppUpdateYml(path.join(out, 'win-unpacked', 'resources'), '标准姿势')
      report([out])
      return
    }
    const symlinkTrouble = /symbolic link|符号链接/i.test(r.stdout + r.stderr)
    if (!symlinkTrouble) {
      console.log('\n注意：这次失败看起来不是 winCodeSign 符号链接问题，下面照样走兜底流程做一次对比')
    } else {
      console.log('→ 命中 winCodeSign 符号链接权限问题，切兜底流程（并把图标补回来）')
    }
  } else {
    console.log('\n[1/2] --standard：跳过标准尝试，直接兜底流程')
  }

  // ② 兜底：dir → patch → prepackaged
  console.log('\n[2/2] 兜底流程')
  console.log('[2.1] 出免安装目录（跳过 rcedit）')
  const dirRes = runElectronBuilder([
    '--win',
    '--dir',
    ...ebArgs(out),
    '-c.win.signAndEditExecutable=false',
  ])
  if (dirRes.status !== 0) fail('免安装目录打包失败')

  const exe = path.join(out, 'win-unpacked', EXE_NAME)
  if (!fs.existsSync(exe)) {
    const found = fs.existsSync(path.join(out, 'win-unpacked'))
      ? fs.readdirSync(path.join(out, 'win-unpacked')).filter((f) => f.endsWith('.exe'))
      : []
    fail(`找不到 ${EXE_NAME}（win-unpacked 里的 exe：${found.join(', ') || '无'}）`)
  }

  console.log('[2.2] 手工补 exe 的资源（图标 + 版本信息）')
  const rcedit = await ensureRcedit()
  if (!rcedit) {
    console.log('⚠ 拿不到 rcedit —— 继续打包，但 exe 会是默认 Electron 图标、无版本信息')
  } else if (!patchExeResources(rcedit, exe)) {
    fail('rcedit 执行失败')
  } else if (!verifyPatchedExe(exe)) {
    fail('补丁校验不通过（版本信息没写进 exe）')
  }

  console.log('[2.3] 用已打补丁的目录压 NSIS 安装包')
  // 必须在 --prepackaged **之前**补：这一步之后的 afterPack 不会被调用，
  // 而 --prepackaged 是原样压包，所以补在这里才能进安装包。
  ensureAppUpdateYml(path.join(out, 'win-unpacked', 'resources'), '兜底流程')
  const instDir = path.join(out, 'installer')
  const instRes = runElectronBuilder([
    '--win',
    '--prepackaged',
    path.relative(ROOT, path.join(out, 'win-unpacked')),
    ...ebArgs(instDir),
    '-c.win.signAndEditExecutable=false',
  ])
  if (instRes.status !== 0) fail('安装包打包失败')

  console.log('\n✓ 兜底流程完成（图标与版本信息已补回）')
  report([instDir, out])
}

main().catch((e) => fail(e && e.stack ? e.stack : String(e)))
