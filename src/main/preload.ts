// C.3/C.5/C.6 preload：在 contextIsolation 下，仅向渲染端暴露最小 API 面（window.ideasprout）。
// 不暴露 ipcRenderer 本体，渲染端只能调用白名单内的方法。

import { contextBridge, ipcRenderer } from 'electron'
import { IPC } from '../shared/ipc'
import type {
  AddCanvasCommentRequest,
  AddMcpServerRequest,
  AddNodeCommentRequest,
  IdeaSproutApi,
  GenerateNodeRequest,
  OpenProjectResponse,
  RenameProjectRequest,
  RegenerateNodeRequest,
  RemoveCommentRequest,
  SaveExportRequest,
  SaveProjectAsRequest,
  SaveProjectRequest,
  SetNodeArchivedRequest,
  SetNodeCollapsedRequest,
  CreateProjectRequest,
  EnsureThemeRootRequest,
  SuggestThemeRequest,
  SwitchProjectRequest,
  CloseProjectRequest,
  ReopenProjectRequest,
  GenerateProposalRequest,
  SetNodeColorRequest,
  SetNodePositionRequest,
  SetNodeVersionRequest,
  UpdateCommentBodyRequest,
  UpdateCommentPositionRequest,
  UpdateNodePromptRequest,
} from '../shared/ipc'

const api: IdeaSproutApi = {
  listGenerators: () => ipcRenderer.invoke(IPC.listGenerators),
  ensureProject: () => ipcRenderer.invoke(IPC.ensureProject),
  renameProject: (req: RenameProjectRequest) => ipcRenderer.invoke(IPC.renameProject, req),
  saveProject: (req: SaveProjectRequest) => ipcRenderer.invoke(IPC.saveProject, req),
  saveProjectAs: (req: SaveProjectAsRequest) => ipcRenderer.invoke(IPC.saveProjectAs, req),
  openProject: (): Promise<OpenProjectResponse> => ipcRenderer.invoke(IPC.openProject),
  generateNode: (req: GenerateNodeRequest) => ipcRenderer.invoke(IPC.generateNode, req),
  generateProposal: (req: GenerateProposalRequest) => ipcRenderer.invoke(IPC.generateProposal, req),
  regenerateNode: (req: RegenerateNodeRequest) => ipcRenderer.invoke(IPC.regenerateNode, req),
  updateNodePrompt: (req: UpdateNodePromptRequest) =>
    ipcRenderer.invoke(IPC.updateNodePrompt, req),
  setNodeVersion: (req: SetNodeVersionRequest) => ipcRenderer.invoke(IPC.setNodeVersion, req),
  setNodeCollapsed: (req: SetNodeCollapsedRequest) => ipcRenderer.invoke(IPC.setNodeCollapsed, req),
  setNodeArchived: (req: SetNodeArchivedRequest) => ipcRenderer.invoke(IPC.setNodeArchived, req),
  setNodeColor: (req: SetNodeColorRequest) => ipcRenderer.invoke(IPC.setNodeColor, req),
  setNodePosition: (req: SetNodePositionRequest) => ipcRenderer.invoke(IPC.setNodePosition, req),
  listProjects: () => ipcRenderer.invoke(IPC.listProjects),
  createProject: (req?: CreateProjectRequest) => ipcRenderer.invoke(IPC.createProject, req ?? {}),
  ensureThemeRoot: (req: EnsureThemeRootRequest) => ipcRenderer.invoke(IPC.ensureThemeRoot, req),
  suggestTheme: (req: SuggestThemeRequest) => ipcRenderer.invoke(IPC.suggestTheme, req),
  switchProject: (req: SwitchProjectRequest) => ipcRenderer.invoke(IPC.switchProject, req),
  closeProject: (req: CloseProjectRequest) => ipcRenderer.invoke(IPC.closeProject, req),
  reopenProject: (req: ReopenProjectRequest) => ipcRenderer.invoke(IPC.reopenProject, req),
  listClosedProjects: () => ipcRenderer.invoke(IPC.listClosedProjects),

  addNodeComment: (req: AddNodeCommentRequest) => ipcRenderer.invoke(IPC.addNodeComment, req),
  addCanvasComment: (req: AddCanvasCommentRequest) =>
    ipcRenderer.invoke(IPC.addCanvasComment, req),
  updateCommentBody: (req: UpdateCommentBodyRequest) =>
    ipcRenderer.invoke(IPC.updateCommentBody, req),
  removeComment: (req: RemoveCommentRequest) => ipcRenderer.invoke(IPC.removeComment, req),
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

contextBridge.exposeInMainWorld('ideasprout', api)
