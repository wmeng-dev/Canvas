// C.3 跨进程 IPC 契约：主进程 handler / preload / 渲染端 共用同一套类型与频道名。
// 渲染端通过 window.diverge 访问（见 preload.ts）。

import type { ContentType, ProjectFile, TreeEdge, TreeNode } from './types'

export const IPC = {
  listGenerators: 'diverge:listGenerators',
  ensureProject: 'diverge:ensureProject',
  generateNode: 'diverge:generateNode',
} as const

export interface GeneratorInfo {
  id: string
  label: string
  kind: 'direct' | 'mcp'
}

export interface GenerateNodeRequest {
  projectId: string
  /** 父节点 id；为 null 表示在根层新增 */
  parentNodeId: string | null
  prompt: string
  parentContext?: string
  contentType?: ContentType
  /** 不传则用主进程的默认生成器 */
  generatorId?: string
  /** 渲染端算好的画布坐标 */
  position?: { x: number; y: number }
}

export interface GenerateNodeResult {
  node: TreeNode
  edge: TreeEdge | null
}

/** preload 暴露到 window.diverge 的 API 面 */
export interface DivergeApi {
  listGenerators(): Promise<GeneratorInfo[]>
  ensureProject(): Promise<ProjectFile>
  generateNode(req: GenerateNodeRequest): Promise<GenerateNodeResult>
}
