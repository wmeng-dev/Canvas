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

/** 一个节点的某个内容版本。节点每次生成/重新生成都会追加一个版本，旧版本永久保留。 */
export interface NodeVersion {
  id: string
  content: string
  contentType: ContentType
  generatorId: string | null
  model?: string
  createdAt: string
}

export interface TreeNode {
  id: string
  parentId: string | null
  label: string
  prompt: string
  /** 当前生效的内容（始终等于 currentVersion 的快照，便于读取方不必走版本表） */
  content: string
  /** 当前生效内容类型：渲染端据此选择预览方式（markdown / html / svg / text） */
  contentType: ContentType
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
