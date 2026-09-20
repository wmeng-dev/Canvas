// C.2 渲染端状态：节点 / 边 / 选中节点（Zustand）。
// 目前用种子数据；C.3 起接入主进程生成链路后，节点将由生成结果驱动。

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'

export interface CreativeNodeData extends Record<string, unknown> {
  label: string
  content?: string
}

export type CreativeNode = Node<CreativeNodeData>

interface TreeState {
  nodes: CreativeNode[]
  edges: Edge[]
  selectedNodeId: string | null
  onNodesChange: (changes: NodeChange<CreativeNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  selectNode: (id: string | null) => void
}

const seedNodes: CreativeNode[] = [
  {
    id: 'root',
    position: { x: 0, y: 0 },
    data: { label: '创意主题', content: '这是根节点。点击任意节点即可在此查看它的内容。' },
  },
  {
    id: 'a',
    position: { x: 280, y: -120 },
    data: { label: '方向 A', content: '方向 A 的初步想法：把核心体验做减法，突出单一主线。' },
  },
  {
    id: 'b',
    position: { x: 280, y: 120 },
    data: { label: '方向 B', content: '方向 B 的初步想法：用多视角并存的方式承载发散结果。' },
  },
]

const seedEdges: Edge[] = [
  { id: 'root-a', source: 'root', target: 'a', animated: true },
  { id: 'root-b', source: 'root', target: 'b', animated: true },
]

export const useTreeStore = create<TreeState>((set, get) => ({
  nodes: seedNodes,
  edges: seedEdges,
  selectedNodeId: null,
  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (conn) => set({ edges: addEdge(conn, get().edges) }),
  selectNode: (id) => set({ selectedNodeId: id }),
}))
