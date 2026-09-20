// C.3/C.5 preload：在 contextIsolation 下，仅向渲染端暴露最小 API 面（window.diverge）。
// 不暴露 ipcRenderer 本体，渲染端只能调用白名单内的方法。

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  DivergeApi,
  GenerateNodeRequest,
  RegenerateNodeRequest,
  SetNodeVersionRequest,
} from '../shared/ipc'

const api: DivergeApi = {
  listGenerators: () => ipcRenderer.invoke(IPC.listGenerators),
  ensureProject: () => ipcRenderer.invoke(IPC.ensureProject),
  generateNode: (req: GenerateNodeRequest) => ipcRenderer.invoke(IPC.generateNode, req),
  regenerateNode: (req: RegenerateNodeRequest) => ipcRenderer.invoke(IPC.regenerateNode, req),
  setNodeVersion: (req: SetNodeVersionRequest) => ipcRenderer.invoke(IPC.setNodeVersion, req),
}

contextBridge.exposeInMainWorld('diverge', api)
