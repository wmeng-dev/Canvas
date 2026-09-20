// C.6 AI 后端装配：把"设置"翻译成"注册表里实际可用的生成器"。
// 纯 Node（不 import electron），因此可用假 SecretBox + 本地示例 MCP Server 做单测。

import { DeepSeekGenerator } from './generator/direct/deepseek'
import { createFakeGenerator } from './generator/fake'
import { McpAdapter } from './mcp/McpAdapter'
import type { McpToolInfo } from './mcp/McpClientManager'
import { GeneratorRegistry } from './generator/types'
import { maskSecret, openSecret } from './settings-store'
import type { AppServices } from './services'
import type { AiSettingsView, McpServerStatus } from '../shared/settings'

/** 默认生成器优先级：DeepSeek 直连 > 任一 MCP 后端 > 其余（如本地占位） */
function pickDefaultGenerator(registry: GeneratorRegistry): string {
  const list = registry.list()
  return (
    list.find((g) => g.id === 'deepseek-direct')?.id ??
    list.find((g) => g.kind === 'mcp')?.id ??
    list[0]?.id ??
    ''
  )
}

/**
 * 依据当前设置重建 AI 后端：
 * 1) 关掉已不再启用的 MCP 连接；2) 连接新启用的（失败记为 error，不影响其它）；
 * 3) 清空并重建注册表（DeepSeek / MCP 各 tool / 占位生成器）。
 */
export async function syncAiBackends(svc: AppServices): Promise<McpServerStatus[]> {
  const settings = svc.settings.read()
  const enabledIds = new Set(settings.mcpServers.filter((s) => s.enabled).map((s) => s.id))

  for (const id of svc.mcp.connectedIds()) {
    if (!enabledIds.has(id)) {
      try {
        await svc.mcp.disconnect(id)
      } catch {
        /* 断开失败不影响后续重建 */
      }
    }
  }

  const statuses = new Map<string, McpServerStatus>()
  // 保留工具明细（不只是名字）：装配生成器时要按 readOnly 过滤
  const toolInfos = new Map<string, McpToolInfo[]>()
  for (const cfg of settings.mcpServers) {
    if (!cfg.enabled) {
      statuses.set(cfg.id, { id: cfg.id, state: 'disabled', tools: [] })
      continue
    }
    try {
      if (!svc.mcp.isConnected(cfg.id)) {
        await svc.mcp.connect({
          id: cfg.id,
          command: cfg.command,
          args: cfg.args,
          env: cfg.env,
          cwd: cfg.cwd,
        })
      }
      const tools = await svc.mcp.listTools(cfg.id)
      toolInfos.set(cfg.id, tools)
      statuses.set(cfg.id, { id: cfg.id, state: 'connected', tools: tools.map((t) => t.name) })
    } catch (e) {
      statuses.set(cfg.id, {
        id: cfg.id,
        state: 'error',
        tools: [],
        error: (e as Error).message,
      })
    }
  }
  svc.mcpStatus = statuses

  // 重建注册表（清空 → 按设置重新注册），避免"关了还在用"的脏状态
  svc.registry.clear()
  const apiKey = openSecret(svc.secrets, settings.deepseek)
  if (apiKey) svc.registry.register(new DeepSeekGenerator({ apiKey }))

  for (const cfg of settings.mcpServers) {
    const status = statuses.get(cfg.id)
    if (!status || status.state !== 'connected') continue
    for (const tool of toolInfos.get(cfg.id) ?? []) {
      // 只读工具（annotations.readOnlyHint）不是"生成后端"：它读数据、不产出内容，
      // 混进生成器下拉只会在被选中时报错（入参契约与 generate 完全不同）。
      if (tool.readOnly) continue
      svc.registry.register(
        new McpAdapter(svc.mcp, cfg.id, tool.name, `mcp:${cfg.id}:${tool.name}`, `${cfg.name} · ${tool.name}`),
      )
    }
  }

  if (svc.fakeEnabled) svc.registry.register(createFakeGenerator())
  svc.defaultGeneratorId = pickDefaultGenerator(svc.registry)

  return [...statuses.values()]
}

/** 构造给渲染端的设置视图（不含明文密钥）。 */
export function buildSettingsView(svc: AppServices): AiSettingsView {
  const settings = svc.settings.read()
  const apiKey = openSecret(svc.secrets, settings.deepseek)
  const protection = settings.deepseek?.protection ?? null

  return {
    deepseek: {
      configured: !!apiKey,
      protection,
      masked: apiKey ? maskSecret(apiKey) : '',
    },
    mcpServers: settings.mcpServers.map((cfg) => ({
      ...cfg,
      status:
        svc.mcpStatus.get(cfg.id) ??
        ({
          id: cfg.id,
          state: cfg.enabled ? 'pending' : 'disabled',
          tools: [],
        } satisfies McpServerStatus),
    })),
    exampleMcpServer: svc.exampleMcpServer,
    generatorCount: svc.registry.list().length,
  }
}
