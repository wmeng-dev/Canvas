// C.3/C.5 跨进程 IPC 契约：主进程 handler / preload / 渲染端 共用同一套类型与频道名。
// 渲染端通过 window.diverge 访问（见 preload.ts）。

import type {
  CommentThread,
  ContentType,
  ProjectFile,
  ProjectSummary,
  TreeEdge,
  TreeNode,
} from './types'
import type { AiSettingsView } from './settings'

export const IPC = {
  listGenerators: 'diverge:listGenerators',
  ensureProject: 'diverge:ensureProject',
  /** 重命名当前项目（仅改 project.name，便于在库里识别） */
  renameProject: 'diverge:renameProject',
  /** 显式"保存"：把当前项目重新落盘（自动保存已在每次变更时发生，这里是主动确认/刷新） */
  saveProject: 'diverge:saveProject',
  /** "另存为"：导出一份完整项目文件（ProjectFile）到用户选定的路径 */
  saveProjectAs: 'diverge:saveProjectAs',
  /** "打开"：从用户选定的 .json 导入一个项目文件 */
  openProject: 'diverge:openProject',
  // ---------- 评论（气泡）：节点级 + 画布自由气泡 ----------
  addNodeComment: 'diverge:addNodeComment',
  addCanvasComment: 'diverge:addCanvasComment',
  updateCommentBody: 'diverge:updateCommentBody',
  addReply: 'diverge:addReply',
  removeComment: 'diverge:removeComment',
  removeReply: 'diverge:removeReply',
  updateCommentPosition: 'diverge:updateCommentPosition',
  generateNode: 'diverge:generateNode',
  generateProposal: 'diverge:generateProposal',
  regenerateNode: 'diverge:regenerateNode',
  updateNodePrompt: 'diverge:updateNodePrompt',
  setNodeVersion: 'diverge:setNodeVersion',
  setNodeCollapsed: 'diverge:setNodeCollapsed',
  setNodeArchived: 'diverge:setNodeArchived',
  setNodeColor: 'diverge:setNodeColor',
  listProjects: 'diverge:listProjects',
  createProject: 'diverge:createProject',
  switchProject: 'diverge:switchProject',
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

/** 收起/展开某个节点（只改这一节点的标记；后代各自的收展状态不变） */
export interface SetNodeCollapsedRequest {
  projectId: string
  nodeId: string
  /** true = 收起（隐藏全部后代）；false = 展开 */
  collapsed: boolean
}

/**
 * 归档 / 取出（想法回收站）。
 * 做成**批量**而不是单个：取出时要一次性把目标节点**连同它被归档的祖先**一起取消标记，
 * 拆成多次调用会出现"中间态"（祖先已取出、自己还没）在画布上闪一下。
 */
export interface SetNodeArchivedRequest {
  projectId: string
  nodeIds: string[]
  /** true = 归档进回收站；false = 取出回画布 */
  archived: boolean
}

/**
 * 沿"根 → nodeId"的链路生成一份方案（收敛）。
 * `position` 由渲染端算好后传入（与发散一致：画布负责布局，core 只管落库）。
 */
export interface GenerateProposalRequest {
  projectId: string
  /** 链条末端（当前选中的节点） */
  nodeId: string
  generatorId?: string
  position?: { x: number; y: number }
}

export interface GenerateProposalResponse {
  /** 新建出来的方案节点（挂在上述节点之下） */
  node: TreeNode
  /** 末端节点 → 方案节点的边（建节点时自动生成） */
  edge: TreeEdge | null
  /** 参与生成的链路层数（1 = 只选了根节点） */
  chainLength: number
}

/** 改卡片颜色；`color` 为 null 表示恢复默认色（必须是调色板认可的色值） */
export interface SetNodeColorRequest {
  projectId: string
  nodeId: string
  color: string | null
}

/** 画布 tab 条：列出所有画布（按最近更新倒序） */
export interface ListProjectsResponse {
  projects: ProjectSummary[]
}

/** 新建画布：name 为空时用默认名「未命名画布」 */
export interface CreateProjectRequest {
  name?: string
}

/** 切到某个已存在的画布 */
export interface SwitchProjectRequest {
  projectId: string
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

/** 重命名当前项目 */
export interface RenameProjectRequest {
  projectId: string
  name: string
}

/** 显式"保存"：重新落盘当前项目，返回落盘时间戳 */
export interface SaveProjectRequest {
  projectId: string
}
export interface SaveProjectResponse {
  savedAt: string
}

/** "另存为"：导出完整项目文件到用户选定路径 */
export interface SaveProjectAsRequest {
  projectId: string
  /** 建议文件名（对话框里可改），不含非法字符 */
  suggestedName: string
}
export interface SaveProjectAsResponse {
  saved: boolean
  /** 用户取消时为 undefined */
  path?: string
  error?: string
}

/** "打开"：从用户选定的 .json 导入项目 */
export interface OpenProjectResponse {
  opened: boolean
  /** 导入成功后的项目文件（渲染端据此载入画布） */
  file?: ProjectFile
  /** 文件损坏/格式不对/读取失败时的原因 */
  error?: string
}

// ---------- 评论（气泡）请求 ----------

/** 给某节点加一条评论气泡 */
export interface AddNodeCommentRequest {
  projectId: string
  nodeId: string
  body: string
}

/** 在画布上（流坐标）加一条自由气泡 */
export interface AddCanvasCommentRequest {
  projectId: string
  x: number
  y: number
  body: string
}

/** 改某条 thread 的根评论内容 */
export interface UpdateCommentBodyRequest {
  projectId: string
  threadId: string
  body: string
}

/** 给某条 thread 追加回复 */
export interface AddReplyRequest {
  projectId: string
  threadId: string
  body: string
}

/** 删除整条 thread（含回复） */
export interface RemoveCommentRequest {
  projectId: string
  threadId: string
}

/** 删除某条回复 */
export interface RemoveReplyRequest {
  projectId: string
  threadId: string
  replyId: string
}

/** 自由气泡拖动后回写流坐标 */
export interface UpdateCommentPositionRequest {
  projectId: string
  threadId: string
  x: number
  y: number
}

/** preload 暴露到 window.diverge 的 API 面 */
export interface DivergeApi {
  listGenerators(): Promise<GeneratorInfo[]>
  ensureProject(): Promise<ProjectFile>
  /** 重命名当前项目；返回同步后的项目文件 */
  renameProject(req: RenameProjectRequest): Promise<ProjectFile>
  /** 显式"保存"当前项目；返回落盘时间戳 */
  saveProject(req: SaveProjectRequest): Promise<SaveProjectResponse>
  /** "另存为"：导出完整项目文件到用户选定路径 */
  saveProjectAs(req: SaveProjectAsRequest): Promise<SaveProjectAsResponse>
  /** "打开"：从用户选定的 .json 导入项目，返回导入后的项目文件 */
  openProject(): Promise<OpenProjectResponse>
  generateNode(req: GenerateNodeRequest): Promise<GenerateChildrenResponse>
  /** 沿「根 → 该节点」的链路生成方案，产物是挂在该节点下的方案节点 */
  generateProposal(req: GenerateProposalRequest): Promise<GenerateProposalResponse>
  regenerateNode(req: RegenerateNodeRequest): Promise<TreeNode>
  /** 只保存描述（不生成）；返回更新后的节点 */
  updateNodePrompt(req: UpdateNodePromptRequest): Promise<TreeNode>
  setNodeVersion(req: SetNodeVersionRequest): Promise<TreeNode>
  /** 收起/展开节点（隐藏/显示其全部后代），返回更新后的节点 */
  setNodeCollapsed(req: SetNodeCollapsedRequest): Promise<TreeNode>
  /** 归档/取出；返回实际被改动的节点（未知 id 会被静默跳过） */
  setNodeArchived(req: SetNodeArchivedRequest): Promise<TreeNode[]>
  /** 改卡片颜色（null = 恢复默认） */
  setNodeColor(req: SetNodeColorRequest): Promise<TreeNode>
  /** 列出所有画布（tab 条用，按最近更新倒序） */
  listProjects(): Promise<ListProjectsResponse>
  /** 新建空白画布并切过去；返回新画布的完整内容 */
  createProject(req?: CreateProjectRequest): Promise<ProjectFile>
  /** 切到指定画布 */
  switchProject(req: SwitchProjectRequest): Promise<ProjectFile>

  // --- 评论（气泡）：节点级 + 画布自由气泡 ---
  /** 给节点加评论气泡；返回新建的 thread */
  addNodeComment(req: AddNodeCommentRequest): Promise<CommentThread>
  /** 画布自由气泡；返回新建的 thread（body 可为空，随后 updateCommentBody 填写） */
  addCanvasComment(req: AddCanvasCommentRequest): Promise<CommentThread>
  /** 改 thread 根评论；返回更新后的 thread */
  updateCommentBody(req: UpdateCommentBodyRequest): Promise<CommentThread>
  /** 追加回复；返回更新后的 thread */
  addReply(req: AddReplyRequest): Promise<CommentThread>
  /** 删除整条 thread */
  removeComment(req: RemoveCommentRequest): Promise<void>
  /** 删除某条回复 */
  removeReply(req: RemoveReplyRequest): Promise<void>
  /** 自由气泡拖动后回写坐标 */
  updateCommentPosition(req: UpdateCommentPositionRequest): Promise<void>

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
