// C.3 主进程 IPC handlers：把渲染端请求路由到 core 层（生成器 + 存储）。

import { ipcMain } from 'electron'
import { IPC } from '../../shared/ipc'
import type { GenerateNodeRequest } from '../../shared/ipc'
import { ensureProject } from '../../core/services'
import type { AppServices } from '../../core/services'
import { generateNode } from '../../core/generate-node'

export function registerIpcHandlers(svc: AppServices): void {
  ipcMain.handle(IPC.listGenerators, () =>
    svc.registry.list().map((g) => ({ id: g.id, label: g.label, kind: g.kind })),
  )

  ipcMain.handle(IPC.ensureProject, () => ensureProject(svc))

  ipcMain.handle(IPC.generateNode, (_evt, req: GenerateNodeRequest) =>
    generateNode(svc, req),
  )
}
