// C.3/C.5/C.6 主进程 IPC handlers：把渲染端请求路由到 core 层（生成器 + 存储 + AI 后端设置）。

import { randomUUID } from 'crypto'
import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type {
  AddMcpServerRequest,
  GenerateNodeRequest,
  RegenerateNodeRequest,
  SetNodeVersionRequest,
} from '../../shared/ipc'
import type { AiSettingsView } from '../../shared/settings'
import { ensureProject } from '../../core/services'
import type { AppServices } from '../../core/services'
import { generateNode, regenerateNode } from '../../core/generate-node'
import { buildSettingsView, syncAiBackends } from '../../core/ai-backends'
import { openSecret, sealSecret } from '../../core/settings-store'

/** 设置变更后：先按新设置重建后端，再回传最新视图（渲染端一次拿到结果） */
async function syncAndView(svc: AppServices): Promise<AiSettingsView> {
  await syncAiBackends(svc)
  return buildSettingsView(svc)
}

export function registerIpcHandlers(svc: AppServices): void {
  ipcMain.handle(IPC.listGenerators, () =>
    svc.registry.list().map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
  )

  ipcMain.handle(IPC.ensureProject, () => ensureProject(svc))

  ipcMain.handle(IPC.generateNode, (_evt, req: GenerateNodeRequest) => generateNode(svc, req))

  ipcMain.handle(IPC.regenerateNode, (_evt, req: RegenerateNodeRequest) =>
    regenerateNode(svc, req),
  )

  ipcMain.handle(IPC.setNodeVersion, (_evt, req: SetNodeVersionRequest) =>
    svc.repo.setCurrentVersion(req.projectId, req.nodeId, req.versionId),
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
