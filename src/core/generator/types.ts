// B.4 Generator 抽象层：统一接口 + 注册表。
// DeepSeek 直连（B.5）与 MCP adapter（B.7）都实现 Generator 接口，
// 主程序通过 GeneratorRegistry 按 id 选择后端，对上层屏蔽差异。

import type { ContentType } from '../../shared/types'

// ContentType 已在 shared 中定义（渲染端预览也需要），此处转出以保持既有导入路径可用。
export type { ContentType }

/** 一个树节点的生成规格 */
export interface NodeSpec {
  projectId: string
  nodeId: string
  prompt: string
  /** 父节点内容摘要，用于"在父节点基础上继续发散" */
  parentContext?: string
  contentType?: ContentType
}

/** 单次生成结果 */
export interface NodeContent {
  contentType: ContentType
  text: string
  raw?: unknown
  model?: string
  finishedAt: string
}

/** 统一生成器接口 */
export interface Generator {
  readonly id: string
  readonly label: string
  readonly kind: 'direct' | 'mcp'
  generate(spec: NodeSpec): Promise<NodeContent>
}

/** 生成器注册表（按 id 检索，支持运行时增删） */
export class GeneratorRegistry {
  private readonly map = new Map<string, Generator>()

  register(g: Generator): void {
    this.map.set(g.id, g)
  }

  unregister(id: string): void {
    this.map.delete(id)
  }

  /** 清空注册表（AI 后端设置变更后整体重建用） */
  clear(): void {
    this.map.clear()
  }

  get(id: string): Generator | undefined {
    return this.map.get(id)
  }

  list(): Generator[] {
    return [...this.map.values()]
  }
}
