// 跨进程共享的领域类型定义（主进程 core / 渲染进程 renderer 共用）。
// 仅含类型与接口，不依赖任何 Node 或 DOM API，可安全被两端 typecheck。

export type NodeStatus = 'empty' | 'pending' | 'done' | 'error'

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
