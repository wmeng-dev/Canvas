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

export interface TreeNode {
  id: string
  parentId: string | null
  label: string
  prompt: string
  content: string
  status: NodeStatus
  generatorId: string | null
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
