// 打包入口（electron-builder 包装器）。
//
// 存在的理由：electron-builder 需要从 **GitHub Releases** 下载三样东西 ——
//   · Electron 分发 zip（~111 MB）
//   · winCodeSign（改 exe 图标/版本信息用）
//   · nsis / nsis-resources（生成安装包用）
// 国内直连 GitHub 常被墙/极慢，表现为卡在 "downloading" 或 502。
// 这里默认走 npmmirror 镜像；若你自己设了这两个环境变量，则完全尊重你的设置（不覆盖）。
//
// 用法：node scripts/dist.cjs [electron-builder 的任意参数]
//   例：node scripts/dist.cjs --win nsis
//       node scripts/dist.cjs --win --dir          # 只出免安装目录，便于快速自测
//
// 也可以被别的脚本 require（只取镜像环境与调用封装，不会有副作用）；
// scripts/dist-win.cjs（Windows 一条龙打包）就是这么用的。
//
// ⚠️ Windows 上如果遇到 winCodeSign 符号链接报错（"客户端没有所需的特权"），
//    别直接加 -c.win.signAndEditExecutable=false 就算了 —— 那会让 exe 丢掉
//    自定义图标与版本信息。改用 scripts/dist-win.cjs，它会自动兜底并把图标补回去。

const { spawnSync } = require('child_process')
const path = require('path')

const DEFAULTS = {
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
}

/** electron-builder CLI 的绝对路径（require.resolve 失败时退回手拼路径） */
function electronBuilderCli() {
  try {
    return require.resolve('electron-builder/cli.js')
  } catch {
    return path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js')
  }
}

/** 带上默认镜像的 env（已存在的同名变量一律不动） */
function buildEnv() {
  const env = { ...process.env }
  const applied = []
  for (const [key, value] of Object.entries(DEFAULTS)) {
    if (!env[key]) {
      env[key] = value
      applied.push(key)
    }
  }
  if (applied.length) {
    console.log(`[dist] 未检测到镜像变量，使用默认镜像：${applied.join(', ')}`)
    console.log(`[dist] （如需覆盖，请先自行设置这两个环境变量）`)
  }
  return env
}

/**
 * 跑一次 electron-builder。
 * @param {string[]} args 直接透传的参数
 * @param {{mirrorEnv?: boolean, capture?: boolean, label?: string}} [opts]
 *   mirrorEnv 默认 true；capture=true 时不继承 stdio，改为把输出喂给 onLine
 * @returns {{status:number, stdout:string, stderr:string}}
 */
function runElectronBuilder(args, opts = {}) {
  const env = opts.mirrorEnv === false ? { ...process.env } : buildEnv()
  console.log(`[dist] electron-builder ${args.join(' ') || '(默认目标)'}`)
  const res = spawnSync(process.execPath, [electronBuilderCli(), ...args], {
    stdio: opts.capture ? 'pipe' : 'inherit',
    env,
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
  })
  if (res.error) {
    console.error('[dist] 启动 electron-builder 失败：', res.error.message)
    return { status: 1, stdout: '', stderr: res.error.message }
  }
  const stdout = res.stdout || ''
  const stderr = res.stderr || ''
  if (opts.capture) {
    // capture 模式下把日志转出来，别把报错吞掉
    const all = (stdout + '\n' + stderr).split('\n').filter(Boolean)
    const tail = all.slice(-25).join('\n')
    if (tail) console.log(tail)
  }
  return { status: res.status === null ? 1 : res.status, stdout, stderr }
}

module.exports = { buildEnv, runElectronBuilder, electronBuilderCli, MIRROR_DEFAULTS: DEFAULTS }

if (require.main === module) {
  const args = process.argv.slice(2)
  // stdio: inherit —— 让 electron-builder 的下载进度/报错原样透出
  const res = runElectronBuilder(args)
  process.exit(res.status)
}
