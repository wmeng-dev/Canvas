// C.3/C.5/C.6 preload：在 contextIsolation 下，仅向渲染端暴露最小 API 面（window.diverge）。
// 不暴露 ipcRenderer 本体，渲染端只能调用白名单内的方法。

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AddCanvasCommentRequest,
  AddMcpServerRequest,
  AddNodeCommentRequest,
  AddReplyRequest,
  DivergeApi,
  GenerateNodeRequest,
  OpenProjectResponse,
  RenameProjectRequest,
  RegenerateNodeRequest,
  RemoveCommentRequest,
  RemoveReplyRequest,
  SaveExportRequest,
  SaveProjectAsRequest,
  SaveProjectRequest,
  SetNodeArchivedRequest,
  SetNodeCollapsedRequest,
  SetNodeVersionRequest,
  UpdateCommentBodyRequest,
  UpdateCommentPositionRequest,
  UpdateNodePromptRequest,
} from '../shared/ipc'

const api: DivergeApi = {
  listGenerators: () => ipcRenderer.invoke(IPC.listGenerators),
  ensureProject: () => ipcRenderer.invoke(IPC.ensureProject),
  renameProject: (req: RenameProjectRequest) => ipcRenderer.invoke(IPC.renameProject, req),
  saveProject: (req: SaveProjectRequest) => ipcRenderer.invoke(IPC.saveProject, req),
  saveProjectAs: (req: SaveProjectAsRequest) => ipcRenderer.invoke(IPC.saveProjectAs, req),
  openProject: (): Promise<OpenProjectResponse> => ipcRenderer.invoke(IPC.openProject),
  generateNode: (req: GenerateNodeRequest) => ipcRenderer.invoke(IPC.generateNode, req),
  regenerateNode: (req: RegenerateNodeRequest) => ipcRenderer.invoke(IPC.regenerateNode, req),
  updateNodePrompt: (req: UpdateNodePromptRequest) =>
    ipcRenderer.invoke(IPC.updateNodePrompt, req),
  setNodeVersion: (req: SetNodeVersionRequest) => ipcRenderer.invoke(IPC.setNodeVersion, req),
  setNodeCollapsed: (req: SetNodeCollapsedRequest) => ipcRenderer.invoke(IPC.setNodeCollapsed, req),
  setNodeArchived: (req: SetNodeArchivedRequest) => ipcRenderer.invoke(IPC.setNodeArchived, req),

  addNodeComment: (req: AddNodeCommentRequest) => ipcRenderer.invoke(IPC.addNodeComment, req),
  addCanvasComment: (req: AddCanvasCommentRequest) =>
    ipcRenderer.invoke(IPC.addCanvasComment, req),
  updateCommentBody: (req: UpdateCommentBodyRequest) =>
    ipcRenderer.invoke(IPC.updateCommentBody, req),
  addReply: (req: AddReplyRequest) => ipcRenderer.invoke(IPC.addReply, req),
  removeComment: (req: RemoveCommentRequest) => ipcRenderer.invoke(IPC.removeComment, req),
  removeReply: (req: RemoveReplyRequest) => ipcRenderer.invoke(IPC.removeReply, req),
  updateCommentPosition: (req: UpdateCommentPositionRequest) =>
    ipcRenderer.invoke(IPC.updateCommentPosition, req),

  getAiSettings: () => ipcRenderer.invoke(IPC.getAiSettings),
  setDeepSeekKey: (apiKey: string) => ipcRenderer.invoke(IPC.setDeepSeekKey, apiKey),
  clearDeepSeekKey: () => ipcRenderer.invoke(IPC.clearDeepSeekKey),
  addMcpServer: (req: AddMcpServerRequest) => ipcRenderer.invoke(IPC.addMcpServer, req),
  removeMcpServer: (id: string) => ipcRenderer.invoke(IPC.removeMcpServer, id),
  setMcpServerEnabled: (id: string, enabled: boolean) =>
    ipcRenderer.invoke(IPC.setMcpServerEnabled, id, enabled),

  saveExport: (req: SaveExportRequest) => ipcRenderer.invoke(IPC.saveExport, req),
}

contextBridge.exposeInMainWorld('diverge', api)
