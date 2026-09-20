// B.7 MCP 接入（二）：把某个 MCP Server 的一个 tool 适配成统一的 Generator。
// 这样上层（GeneratorRegistry / C.3 的生成链路）可以像用 DeepSeek 直连一样使用 MCP 后端。

import type { ContentType, Generator, NodeContent, NodeSpec } from '../generator/types'
import type { McpClientManager } from './McpClientManager'

export class McpAdapter implements Generator {
  readonly kind = 'mcp' as const
  readonly id: string
  readonly label: string

  constructor(
    private readonly manager: McpClientManager,
    private readonly serverId: string,
    private readonly toolName: string = 'generate',
    id?: string,
    label?: string,
  ) {
    this.id = id ?? `mcp:${serverId}:${toolName}`
    this.label = label ?? `MCP · ${serverId}`
  }

  async generate(spec: NodeSpec): Promise<NodeContent> {
    const text = await this.manager.callTool(this.serverId, this.toolName, {
      projectId: spec.projectId,
      nodeId: spec.nodeId,
      prompt: spec.prompt,
      parentContext: spec.parentContext,
      contentType: spec.contentType,
    })
    const contentType: ContentType = spec.contentType ?? 'markdown'
    return {
      contentType,
      text,
      model: `${this.serverId}:${this.toolName}`,
      finishedAt: new Date().toISOString(),
    }
  }
}
