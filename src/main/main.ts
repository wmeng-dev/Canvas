// 主进程入口：真正的装配逻辑在 app.ts（bootstrap），此处只做调用。
// 拆分的目的是让 app.ts 可被测试/复用，而 main.ts 保持极薄。

import { app, BrowserWindow } from 'electron'
import { bootstrap } from './app'

// 单实例锁：多开会让两个进程同时写同一批 JSON（app-state.json 与每个项目文件）。
// AppStateStore 的原子写只防"文件被撕"，**不防两份内存互相覆盖** —— 典型后果是
// lastProjectId / closedProjectIds 漂移，甚至用陈旧快照盖掉另一实例刚写的内容。
// 用户很容易撞上：快捷键连点、任务栏重复点、刚装完手快点两次图标。
//
// ⚠️ 这一层刻意放在 main.ts 而不是 bootstrap()：端到端探针是直接调 bootstrap() 的，
// 不该被实例锁挡住（跑探针时用户很可能正开着应用；且探针用 IDEASPROUT_DATA_DIR 指向
// 临时目录，本来也碰不到真实数据）。
if (!app.requestSingleInstanceLock()) {
  // 留一行日志：既方便排查"点了图标没反应"，也让自动化测试有个可断言的信号
  // （否则"进程退出了"无法区分是锁生效还是启动崩了）。
  console.log('[ideasprout] 已有实例在运行，本次启动退出（单实例锁）')
  app.quit()
} else {
  // 第二个实例被拒之后，把已在运行的窗口还原并聚焦 —— 用户预期是"点一下就到前面"，
  // 而不是"点了没反应"。
  app.on('second-instance', () => {
    const win = BrowserWindow.getAllWindows()[0]
    if (!win) return
    if (win.isMinimized()) win.restore()
    if (!win.isVisible()) win.show()
    win.focus()
  })

  bootstrap()
}
