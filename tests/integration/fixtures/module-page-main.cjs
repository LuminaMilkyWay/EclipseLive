// 模块页布局探针用的极简 Electron 主进程（测试夹具，不是应用本体）。
// 按 PROBE_W/PROBE_H 开窗并加载 PROBE_PAGE 指定的页面，供布局守卫测试量取实际排版。
const { app, BrowserWindow } = require('electron')

const width = Number(process.env.PROBE_W || 1280)
const height = Number(process.env.PROBE_H || 720)
const page = process.env.PROBE_PAGE

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width,
    height,
    useContentSize: true,
    show: true,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: false, nodeIntegration: false, sandbox: false }
  })
  await win.loadFile(page)
})
