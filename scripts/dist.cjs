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

const { spawnSync } = require('child_process')
const path = require('path')

const DEFAULTS = {
  ELECTRON_MIRROR: 'https://registry.npmmirror.com/-/binary/electron/',
  ELECTRON_BUILDER_BINARIES_MIRROR:
    'https://registry.npmmirror.com/-/binary/electron-builder-binaries/',
}

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

let cli
try {
  cli = require.resolve('electron-builder/cli.js')
} catch {
  // 兜底：直接从 node_modules 拼路径
  cli = path.join(__dirname, '..', 'node_modules', 'electron-builder', 'cli.js')
}

const args = process.argv.slice(2)
console.log(`[dist] electron-builder ${args.join(' ') || '(默认目标)'}`)

// stdio: inherit —— 让 electron-builder 的下载进度/报错原样透出
const res = spawnSync(process.execPath, [cli, ...args], { stdio: 'inherit', env })

if (res.error) {
  console.error('[dist] 启动 electron-builder 失败：', res.error.message)
  process.exit(1)
}
process.exit(res.status === null ? 1 : res.status)
