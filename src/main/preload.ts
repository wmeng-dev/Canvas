// C.3 preload：在 contextIsolation 下，仅向渲染端暴露最小 API 面（window.diverge）。
// 不暴露 ipcRenderer 本体，渲染端只能调用白名单内的三个方法。

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type { DivergeApi, GenerateNodeRequest } from '../shared/ipc'

const api: DivergeApi = {
  listGenerators: () => ipcRenderer.invoke(IPC.listGenerators),
  ensureProject: () => ipcRenderer.invoke(IPC.ensureProject),
  generateNode: (req: GenerateNodeRequest) => ipcRenderer.invoke(IPC.generateNode, req),
}

contextBridge.exposeInMainWorld('diverge', api)
