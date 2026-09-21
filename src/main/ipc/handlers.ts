// C.3/C.5/C.6 主进程 IPC handlers：把渲染端请求路由到 core 层（生成器 + 存储 + AI 后端设置）。

import { randomUUID } from 'crypto'
import * as fs from 'fs'
import { BrowserWindow, dialog, ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  AddCanvasCommentRequest,
  AddMcpServerRequest,
  AddNodeCommentRequest,
  AddReplyRequest,
  GenerateNodeRequest,
  OpenProjectResponse,
  RegenerateNodeRequest,
  RemoveCommentRequest,
  RemoveReplyRequest,
  RenameProjectRequest,
  SaveExportRequest,
  SaveProjectAsRequest,
  SaveProjectRequest,
  SetNodeArchivedRequest,
  CreateProjectRequest,
  SetNodeColorRequest,
  SwitchProjectRequest,
  SetNodeCollapsedRequest,
  SetNodeVersionRequest,
  UpdateCommentBodyRequest,
  UpdateCommentPositionRequest,
  UpdateNodePromptRequest,
} from '../../shared/ipc'
import type { AiSettingsView } from '../../shared/settings'
import type { ProjectFile } from '../../shared/types'
import {
  createProject,
  ensureProject,
  listProjectSummaries,
  switchProject,
} from '../../core/services'
import type { AppServices } from '../../core/services'
import { generateNode, regenerateNode } from '../../core/generate-node'
import { buildSettingsView, syncAiBackends } from '../../core/ai-backends'
import { openSecret, sealSecret } from '../../core/settings-store'

/** 设置变更后：先按新设置重建后端，再回传最新视图（渲染端一次拿到结果） */
async function syncAndView(svc: AppServices): Promise<AiSettingsView> {
  await syncAiBackends(svc)
  return buildSettingsView(svc)
}

/** 文件名非法字符清洗（对话框 defaultPath 仅作建议，这里再兜一层避免写入失败）。 */
function sanitizeFileName(name: string): string {
  return name.replace(/[\\/:*?"<>|]/g, '_').replace(/\s+/g, ' ').trim()
}

export function registerIpcHandlers(svc: AppServices): void {
  ipcMain.handle(IPC.listGenerators, () =>
    svc.registry.list().map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
  )

  ipcMain.handle(IPC.ensureProject, () => ensureProject(svc))

  // ---------- 项目文件：重命名 / 保存 / 另存为 / 打开 ----------
  ipcMain.handle(IPC.renameProject, (_evt, req: RenameProjectRequest) =>
    svc.repo.rename(req.projectId, req.name),
  )

  // 显式"保存"：重新落盘当前项目，返回落盘时间戳。
  ipcMain.handle(IPC.saveProject, (_evt, req: SaveProjectRequest) => {
    svc.repo.persist(req.projectId)
    return { savedAt: new Date().toISOString() }
  })

  // "另存为"：把完整项目文件导出到用户选定的路径（系统保存对话框）。
  ipcMain.handle(IPC.saveProjectAs, async (evt, req: SaveProjectAsRequest) => {
    const file = svc.repo.get(req.projectId)
    const content = JSON.stringify(file, null, 2)
    const suggestedName = sanitizeFileName(req.suggestedName || `${file.project.name || 'diverge-project'}.json`)
    const filters = [{ name: 'Diverge 项目', extensions: ['json'] }]
    const parent = BrowserWindow.fromWebContents(evt.sender)
    const result = parent
      ? await dialog.showSaveDialog(parent, { defaultPath: suggestedName, filters })
      : await dialog.showSaveDialog({ defaultPath: suggestedName, filters })
    if (result.canceled || !result.filePath) return { saved: false }
    try {
      await fs.promises.writeFile(result.filePath, content, 'utf-8')
      return { saved: true, path: result.filePath }
    } catch (e) {
      return { saved: false, error: (e as Error).message }
    }
  })

  // "打开"：从用户选定的 .json 导入项目，落库并设为 lastProjectId。
  ipcMain.handle(IPC.openProject, async (evt): Promise<OpenProjectResponse> => {
    const filters = [{ name: 'Diverge 项目', extensions: ['json'] }]
    const parent = BrowserWindow.fromWebContents(evt.sender)
    const result = parent
      ? await dialog.showOpenDialog(parent, { properties: ['openFile'], filters })
      : await dialog.showOpenDialog({ properties: ['openFile'], filters })
    if (result.canceled || !result.filePaths || result.filePaths.length === 0) {
      return { opened: false }
    }
    try {
      const raw = await fs.promises.readFile(result.filePaths[0], 'utf-8')
      const file = JSON.parse(raw) as ProjectFile
      const imported = svc.repo.importExternal(file)
      svc.appState.update((s) => ({ ...s, lastProjectId: imported.project.id }))
      return { opened: true, file: imported }
    } catch (e) {
      return { opened: false, error: (e as Error).message }
    }
  })

  ipcMain.handle(IPC.generateNode, (_evt, req: GenerateNodeRequest) => generateNode(svc, req))

  ipcMain.handle(IPC.regenerateNode, (_evt, req: RegenerateNodeRequest) =>
    regenerateNode(svc, req),
  )

  // "编辑描述但不生成"：只改描述，不追加版本、不动内容
  ipcMain.handle(IPC.updateNodePrompt, (_evt, req: UpdateNodePromptRequest) =>
    svc.repo.updateNodePrompt(req.projectId, req.nodeId, String(req.prompt ?? '').trim()),
  )

  ipcMain.handle(IPC.setNodeVersion, (_evt, req: SetNodeVersionRequest) =>
    svc.repo.setCurrentVersion(req.projectId, req.nodeId, req.versionId),
  )

  ipcMain.handle(IPC.setNodeCollapsed, (_evt, req: SetNodeCollapsedRequest) =>
    svc.repo.setNodeCollapsed(req.projectId, req.nodeId, !!req.collapsed),
  )

  ipcMain.handle(IPC.setNodeArchived, (_evt, req: SetNodeArchivedRequest) =>
    svc.repo.setNodesArchived(req.projectId, req.nodeIds ?? [], !!req.archived),
  )

  ipcMain.handle(IPC.setNodeColor, (_evt, req: SetNodeColorRequest) =>
    svc.repo.setNodeColor(req.projectId, req.nodeId, req.color ?? null),
  )

  // ---------- 画布 tab 条：列出 / 新建 / 切换 ----------
  ipcMain.handle(IPC.listProjects, () => ({ projects: listProjectSummaries(svc) }))

  ipcMain.handle(IPC.createProject, (_evt, req: CreateProjectRequest = {}) => createProject(svc, req.name))

  ipcMain.handle(IPC.switchProject, (_evt, req: SwitchProjectRequest) => switchProject(svc, req.projectId))

  // ---------- 评论（气泡）：节点级 + 画布自由气泡 ----------
  ipcMain.handle(IPC.addNodeComment, (_evt, req: AddNodeCommentRequest) =>
    svc.repo.addNodeComment(req.projectId, req.nodeId, String(req.body ?? '')),
  )

  ipcMain.handle(IPC.addCanvasComment, (_evt, req: AddCanvasCommentRequest) =>
    svc.repo.addCanvasComment(req.projectId, Number(req.x) || 0, Number(req.y) || 0, String(req.body ?? '')),
  )

  ipcMain.handle(IPC.updateCommentBody, (_evt, req: UpdateCommentBodyRequest) =>
    svc.repo.updateCommentBody(req.projectId, req.threadId, String(req.body ?? '')),
  )

  ipcMain.handle(IPC.addReply, (_evt, req: AddReplyRequest) =>
    svc.repo.addReply(req.projectId, req.threadId, String(req.body ?? '')),
  )

  ipcMain.handle(IPC.removeComment, (_evt, req: RemoveCommentRequest) =>
    svc.repo.removeComment(req.projectId, req.threadId),
  )

  ipcMain.handle(IPC.removeReply, (_evt, req: RemoveReplyRequest) =>
    svc.repo.removeReply(req.projectId, req.threadId, req.replyId),
  )

  ipcMain.handle(IPC.updateCommentPosition, (_evt, req: UpdateCommentPositionRequest) =>
    svc.repo.updateCommentPosition(req.projectId, req.threadId, Number(req.x) || 0, Number(req.y) || 0),
  )

  // ---------- C.6 AI 后端设置 ----------
  ipcMain.handle(IPC.getAiSettings, () => buildSettingsView(svc))

  ipcMain.handle(IPC.setDeepSeekKey, async (_evt, apiKey: string) => {
    const key = String(apiKey ?? '').trim()
    svc.settings.update((s) => ({
      ...s,
      deepseek: key ? sealSecret(svc.secrets, key) : undefined,
    }))
    return syncAndView(svc)
  })

  ipcMain.handle(IPC.clearDeepSeekKey, async () => {
    svc.settings.update((s) => ({ ...s, deepseek: undefined }))
    return syncAndView(svc)
  })

  ipcMain.handle(IPC.addMcpServer, async (_evt, req: AddMcpServerRequest) => {
    const name = String(req?.name ?? '').trim() || '未命名 Server'
    const command = String(req?.command ?? '').trim()
    if (!command) throw new Error('command 不能为空')
    const id = `mcp-${randomUUID().slice(0, 8)}`
    svc.settings.update((s) => ({
      ...s,
      mcpServers: [
        ...s.mcpServers,
        {
          id,
          name,
          command,
          args: Array.isArray(req.args) ? req.args : [],
          env: req.env && typeof req.env === 'object' ? req.env : {},
          cwd: req.cwd,
          enabled: req.enabled !== false,
        },
      ],
    }))
    return syncAndView(svc)
  })

  ipcMain.handle(IPC.removeMcpServer, async (_evt, id: string) => {
    svc.settings.update((s) => ({
      ...s,
      mcpServers: s.mcpServers.filter((m) => m.id !== id),
    }))
    return syncAndView(svc)
  })

  ipcMain.handle(IPC.setMcpServerEnabled, async (_evt, id: string, enabled: boolean) => {
    svc.settings.update((s) => ({
      ...s,
      mcpServers: s.mcpServers.map((m) => (m.id === id ? { ...m, enabled: !!enabled } : m)),
    }))
    return syncAndView(svc)
  })

  // ---------- D.1 导出 ----------
  // 内容由渲染端渲染好（复用预览组件），这里只负责系统保存对话框 + 落盘。
  ipcMain.handle(IPC.saveExport, async (evt, req: SaveExportRequest) => {
    const content = String(req?.content ?? '')
    const suggestedName = String(req?.suggestedName ?? '').trim() || 'export.md'
    const isHtml = suggestedName.toLowerCase().endsWith('.html')
    const filters = isHtml
      ? [{ name: 'HTML 文档', extensions: ['html'] }]
      : [{ name: 'Markdown 文档', extensions: ['md', 'markdown'] }]

    const parent = BrowserWindow.fromWebContents(evt.sender)
    const opts = { defaultPath: suggestedName, filters }
    const result = parent
      ? await dialog.showSaveDialog(parent, opts)
      : await dialog.showSaveDialog(opts)

    if (result.canceled || !result.filePath) return { saved: false }
    try {
      await fs.promises.writeFile(result.filePath, content, 'utf-8')
      return { saved: true, path: result.filePath }
    } catch (e) {
      return { saved: false, error: (e as Error).message }
    }
  })
}

/** 启动时的后台同步（不阻塞建窗口）：把设置里的后端接起来。 */
export async function syncAiBackendsOnStartup(svc: AppServices): Promise<void> {
  try {
    await syncAiBackends(svc)
  } catch (e) {
    console.error('[main] AI 后端初始化失败:', (e as Error).message)
  }
  // 顺带校验一次密钥可解密（解不开时明确报出来，而不是等到生成才失败）
  const key = openSecret(svc.secrets, svc.settings.read().deepseek)
  if (svc.settings.read().deepseek && !key) {
    console.error('[main] 已保存的 DeepSeek key 无法解密（可能换了系统账户/密钥环）')
  }
}
