// C.3/C.5 跨进程 IPC 契约：主进程 handler / preload / 渲染端 共用同一套类型与频道名。
// 渲染端通过 window.diverge 访问（见 preload.ts）。

import type { ContentType, ProjectFile, TreeEdge, TreeNode } from './types'

export const IPC = {
  listGenerators: 'diverge:listGenerators',
  ensureProject: 'diverge:ensureProject',
  generateNode: 'diverge:generateNode',
  regenerateNode: 'diverge:regenerateNode',
  setNodeVersion: 'diverge:setNodeVersion',
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
  /** 渲染端算好的画布坐标（首个节点的位置；后续节点按序号下移） */
  position?: { x: number; y: number }
  /** 一次生成几个（发散 N 条），默认 1，上限 5；>1 时受并发限制执行 */
  count?: number
}

export interface GenerateNodeResult {
  node: TreeNode
  edge: TreeEdge | null
}

/** 批量发散时，个别失败不应让整批失败 —— 失败的在此逐条回报 */
export interface GenerateFailure {
  prompt: string
  error: string
}

export interface GenerateChildrenResponse {
  items: GenerateNodeResult[]
  failures: GenerateFailure[]
}

export interface RegenerateNodeRequest {
  projectId: string
  nodeId: string
  /** 不传则沿用节点原 prompt */
  prompt?: string
  contentType?: ContentType
  generatorId?: string
}

export interface SetNodeVersionRequest {
  projectId: string
  nodeId: string
  /** 要"翻案"回的历史版本 id */
  versionId: string
}

/** preload 暴露到 window.diverge 的 API 面 */
export interface DivergeApi {
  listGenerators(): Promise<GeneratorInfo[]>
  ensureProject(): Promise<ProjectFile>
  generateNode(req: GenerateNodeRequest): Promise<GenerateChildrenResponse>
  regenerateNode(req: RegenerateNodeRequest): Promise<TreeNode>
  setNodeVersion(req: SetNodeVersionRequest): Promise<TreeNode>
}
