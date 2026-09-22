// 验证探针（本地，gitignored）：确认 Electron 默认菜单已被关闭（Menu.getApplicationMenu() === null）。
const { app, BrowserWindow, Menu } = require('electron')
const os = require('os')
const fs = require('fs')
const path = require('path')

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ideasprout-menu-'))
process.env.IDEASPROUT_DATA_DIR = dataDir
process.env.IDEASPROUT_FAKE_GENERATOR = '1'
process.env.IDEASPROUT_FORCE_DIST = '1'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

app.whenReady().then(async () => {
  try {
    const { bootstrap } = require(path.join(__dirname, '..', '..', 'dist-electron/main/app'))
    bootstrap()
    // 等窗口建立 + 菜单设置生效
    await sleep(1500)
    const menu = Menu.getApplicationMenu()
    const ok = menu === null || menu === undefined
    console.log('PLATFORM=' + process.platform)
    console.log('MENU_IS_NULL=' + ok + ' (got ' + (menu ? ('label=' + (menu.items[0] && menu.items[0].label)) : 'null') + ')')
    // 标准标记：verify.cjs 按 `<名>_E2E OK (n/m)` 汇总，没有这行会被算成"无可识别结果"。
    console.log('MENU_E2E ' + (ok ? 'OK (1/1)' : 'FAIL (0/1)'))
    app.exit(ok ? 0 : 1)
  } catch (e) {
    console.error('PROBE ERROR:', (e && e.stack) || e)
    app.exit(2)
  }
})
