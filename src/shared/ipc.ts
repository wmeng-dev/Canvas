// C.3/C.5 跨进程 IPC 契约：主进程 handler / preload / 渲染端 共用同一套类型与频道名。
// 渲染端通过 window.diverge 访问（见 preload.ts）。

import type { ContentType, ProjectFile, TreeEdge, TreeNode } from './types'
import type { AiSettingsView } from './settings'

export const IPC = {
  listGenerators: 'diverge:listGenerators',
  ensureProject: 'diverge:ensureProject',
  generateNode: 'diverge:generateNode',
  regenerateNode: 'diverge:regenerateNode',
  updateNodePrompt: 'diverge:updateNodePrompt',
  setNodeVersion: 'diverge:setNodeVersion',
  getAiSettings: 'diverge:getAiSettings',
  setDeepSeekKey: 'diverge:setDeepSeekKey',
  clearDeepSeekKey: 'diverge:clearDeepSeekKey',
  addMcpServer: 'diverge:addMcpServer',
  removeMcpServer: 'diverge:removeMcpServer',
  setMcpServerEnabled: 'diverge:setMcpServerEnabled',
  saveExport: 'diverge:saveExport',
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
  /** 编辑后的描述；不传则沿用节点原描述 */
  prompt?: string
  contentType?: ContentType
  generatorId?: string
}

/**
 * "编辑描述但不生成"：只更新描述，不追加版本、不动内容。
 * 描述属于当前版本 → 之后翻案回旧版本时会一起回退。
 */
export interface UpdateNodePromptRequest {
  projectId: string
  nodeId: string
  prompt: string
}

export interface SetNodeVersionRequest {
  projectId: string
  nodeId: string
  /** 要"翻案"回的历史版本 id */
  versionId: string
}

/** C.6 新增 MCP server 的入参（id 由主进程生成，避免与既有冲突） */
export interface AddMcpServerRequest {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled?: boolean
}

/**
 * D.1 导出：渲染端负责把文档渲染成最终字符串（Markdown 或单文件 HTML），
 * 主进程只负责弹系统保存对话框 + 落盘 —— 这样渲染逻辑（含 markdown→HTML）留在
 * 渲染端复用现有预览组件，主进程保持无渲染依赖。
 */
export interface SaveExportRequest {
  /** 建议文件名；用户可在系统对话框里改 */
  suggestedName: string
  /** 完整文件内容 */
  content: string
}

export interface SaveExportResponse {
  saved: boolean
  /** 用户取消时为 undefined */
  path?: string
  error?: string
}

/** preload 暴露到 window.diverge 的 API 面 */
export interface DivergeApi {
  listGenerators(): Promise<GeneratorInfo[]>
  ensureProject(): Promise<ProjectFile>
  generateNode(req: GenerateNodeRequest): Promise<GenerateChildrenResponse>
  regenerateNode(req: RegenerateNodeRequest): Promise<TreeNode>
  /** 只保存描述（不生成）；返回更新后的节点 */
  updateNodePrompt(req: UpdateNodePromptRequest): Promise<TreeNode>
  setNodeVersion(req: SetNodeVersionRequest): Promise<TreeNode>

  // --- C.6 AI 后端设置 ---
  getAiSettings(): Promise<AiSettingsView>
  /** 保存 DeepSeek key（空字符串＝清除）；返回同步后的最新视图 */
  setDeepSeekKey(apiKey: string): Promise<AiSettingsView>
  clearDeepSeekKey(): Promise<AiSettingsView>
  addMcpServer(req: AddMcpServerRequest): Promise<AiSettingsView>
  removeMcpServer(id: string): Promise<AiSettingsView>
  setMcpServerEnabled(id: string, enabled: boolean): Promise<AiSettingsView>

  // --- D.1 导出 ---
  saveExport(req: SaveExportRequest): Promise<SaveExportResponse>
}
