// 跨进程共享的领域类型定义（主进程 core / 渲染进程 renderer 共用）。
// 仅含类型与接口，不依赖任何 Node 或 DOM API，可安全被两端 typecheck。

export type NodeStatus = 'empty' | 'pending' | 'done' | 'error'

/** 生成内容类型（主进程 Generator 与渲染端预览共用同一套取值） */
export type ContentType = 'text' | 'markdown' | 'html' | 'svg' | 'image'

export interface Project {
  id: string
  name: string
  createdAt: string
  updatedAt: string
}

/**
 * 发散评估：针对"这个想法本身"的结构化判断，与输出格式（markdown/html/svg）无关。
 * 由生成器给出（DeepSeek 走 JSON 约定）；第三方 MCP 后端给不出时整体为 undefined，
 * 界面据此降级为"只有标题与正文"，不显示空的分析区块。
 */
export interface IdeaAnalysis {
  /** 可行性概率：0-100 的整数（百分比） */
  feasibility: number
  /** 优点（每条一句短句） */
  pros: string[]
  /** 缺点 */
  cons: string[]
  /** 风险 */
  risks: string[]
}

/** 一个节点的某个内容版本。节点每次生成/重新生成都会追加一个版本，旧版本永久保留。 */
export interface NodeVersion {
  id: string
  content: string
  contentType: ContentType
  /**
   * 这一版的"结果标题"——即发散出来的东西叫什么，而不是当初输入的那句话。
   * 节点显示名跟随当前版本的 title；生成器没给（如第三方 MCP 后端）时回落到 prompt 派生标签。
   */
  title?: string
  /** 这一版的发散评估 */
  analysis?: IdeaAnalysis | null
  generatorId: string | null
  model?: string
  createdAt: string
}

export interface TreeNode {
  id: string
  parentId: string | null
  /**
   * 节点显示名 = 当前版本的**结果标题**（发散出来的东西叫什么）。
   * 生成器给不出标题时回落到 prompt 派生的短标签（deriveLabel）。
   * 注意：它**不是**用户输入的那句话 —— 原始输入在 `prompt` 里。
   */
  label: string
  prompt: string
  /** 当前生效的内容（始终等于 currentVersion 的快照，便于读取方不必走版本表） */
  content: string
  /** 当前生效内容类型：渲染端据此选择预览方式（markdown / html / svg / text） */
  contentType: ContentType
  /** 当前生效版本的结构化评估快照（旧项目文件 / 第三方后端可能没有） */
  analysis?: IdeaAnalysis | null
  status: NodeStatus
  generatorId: string | null
  /** 历史版本（按时间升序）；"翻案"= 把 currentVersionId 指回其中某个旧版本 */
  versions: NodeVersion[]
  currentVersionId: string | null
  /** 画布坐标（渲染端生成/布局后回写，便于下次打开保持布局） */
  position?: { x: number; y: number }
  createdAt: string
  updatedAt: string
}

export interface TreeEdge {
  id: string
  source: string
  target: string
}

export interface ProjectFile {
  project: Project
  tree: {
    nodes: TreeNode[]
    edges: TreeEdge[]
  }
}
