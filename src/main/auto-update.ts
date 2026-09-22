// 客户端自动更新：electron-updater 读 GitHub Release 里的 latest.yml，比对包内版本决定是否升级。
//
// 进程边界：**检查与下载全在主进程**，渲染端不发任何网络请求（见 README「进程边界」）。
// 所以这里不引入任何 IPC / UI —— 发现新版本后直接用系统原生对话框询问，避免为了一个
// 更新提示去动跨进程契约（src/shared/ipc.ts）。
//
// ⚠️ 三条硬约束，违反任意一条都会"静默地永远是最新版"：
//   1) **只在打包态启用**。开发态没有 resources/app-update.yml，autoUpdater 会直接抛
//      "Cannot find app-update.yml"。这里用 app.isPackaged 挡住。
//   2) **Release 必须是已发布，不能是 draft**。electron-updater 会跳过 draft。
//      electron-builder.yml 里写死了 releaseType: release，别改。
//   3) **包内版本必须与 Release 的版本一致**。比对用的是 package.json 的 version（打进包里的那份），
//      不是 git tag。所以发版流程必须是"先改 version 提交，再打同名 tag"。
//
// 另：Windows 未签名也能自动更新（走 NSIS 安装流程，不强制签名）；macOS 不行
// （Squirrel.Mac 要求已签名）。详见 docs/自动更新说明.md。

import { app, BrowserWindow, dialog } from 'electron'
import type { MessageBoxOptions } from 'electron'
import { autoUpdater } from 'electron-updater'

/** 日志落点：复用主进程的 main.log 写入器；不传则退回 console.error。 */
export type UpdateLogger = (kind: string, detail: unknown) => void

export interface AutoUpdateOptions {
  log?: UpdateLogger
  /** 启动后延迟多久开始检查（毫秒）。默认 8s —— 别和开窗、装配服务、拉 MCP 子进程抢 I/O。 */
  delayMs?: number
}

/** 同一个进程只装一次（bootstrap 理论上只跑一次，但探针会重复调用，防重入更稳）。 */
let installed = false

/**
 * 打开自动更新。返回是否真的启用了（开发态返回 false）。
 *
 * 设计取舍：**自动下载 + 下载完成后询问**，而不是"发现新版本就问是否下载"。
 * 桌面应用体积不大，先下好再问，用户点"立即重启"时是秒切；否则他要在对话框前干等下载。
 */
export function installAutoUpdate(opts: AutoUpdateOptions = {}): boolean {
  const log: UpdateLogger =
    opts.log ?? ((kind, detail) => console.error(`[ideasprout] ${kind}:`, detail))

  if (!app.isPackaged) {
    // 这不是错误，是预期行为 —— 写进日志是为了排查"为什么开发态不检查更新"。
    log('自动更新未启用', '当前非打包态（app.isPackaged=false），缺少 app-update.yml')
    return false
  }
  if (installed) return false
  installed = true

  // autoDownload 默认就是 true，显式写出来是为了让"为什么用户还没确认就开始下载"有据可查。
  autoUpdater.autoDownload = true
  // 用户选了"稍后"时，退出应用时静默安装 —— 否则那个已下载的更新会被无限搁置。
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('error', (err) => log('自动更新失败', err))
  autoUpdater.on('update-available', (info) => log('发现新版本，开始下载', info?.version))
  autoUpdater.on('update-not-available', (info) => log('已是最新版本', info?.version))
  autoUpdater.on('update-downloaded', (info) => {
    log('新版本已下载完成', info?.version)
    void promptInstall(info?.version, log)
  })

  const delay = opts.delayMs ?? 8000
  setTimeout(() => {
    void autoUpdater.checkForUpdates().catch((e) => log('检查更新失败', e))
  }, delay)

  return true
}

/**
 * 下载完成后询问用户。挂在窗口上（有窗口就模态到窗口，没有就独立弹）；
 * 选了"立即重启并安装"才 quitAndInstall()。
 */
async function promptInstall(version: string | undefined, log: UpdateLogger): Promise<void> {
  const options: MessageBoxOptions = {
    type: 'info',
    buttons: ['立即重启并安装', '稍后'],
    defaultId: 0,
    cancelId: 1,
    noLink: true,
    title: '有新版本可用',
    message: version ? `风衍 IdeaSprout ${version} 已下载完成` : '新版本已下载完成',
    detail: '重启应用即可完成更新。选择"稍后"的话，退出应用时会自动安装。',
  }
  try {
    const win = BrowserWindow.getAllWindows()[0]
    const { response } =
      win && !win.isDestroyed() ? await dialog.showMessageBox(win, options) : await dialog.showMessageBox(options)
    if (response === 0) {
      // (isSilent=false, isForceRunAfter=true)：显示安装向导，装完把应用重新拉起来。
      autoUpdater.quitAndInstall(false, true)
    }
  } catch (e) {
    log('更新提示弹窗失败', e)
  }
}
