// C.2 渲染端状态：节点 / 边 / 选中节点（Zustand）。
// C.3 起：项目从主进程加载（ensureProject），生成走 IPC（generateNode），
// 无 Electron（纯浏览器预览）时回落到内置种子数据 + 本地占位生成。

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { GeneratorInfo } from '../../shared/ipc'
import type { ContentType, ProjectFile, TreeNode } from '../../shared/types'

export interface CreativeNodeData extends Record<string, unknown> {
  label: string
  content?: string
  /** 预览用：决定用 markdown / html(沙箱) / svg(沙箱) / text 渲染 */
  contentType?: ContentType
  status?: string
  prompt?: string
  /** 父节点 id（根层为 null）；用于布局与"兄弟计数" */
  parentId?: string | null
}

export type CreativeNode = Node<CreativeNodeData>

interface TreeState {
  projectId: string | null
  projectName: string
  nodes: CreativeNode[]
  edges: Edge[]
  selectedNodeId: string | null
  generators: GeneratorInfo[]
  /** 对话框状态 */
  dialogOpen: boolean
  dialogParentId: string | null
  generating: boolean
  error: string | null

  /** 应用启动时调用：拉项目 + 生成器列表（有 IPC 走主进程，否则用种子数据） */
  init: () => Promise<void>

  onNodesChange: (changes: NodeChange<CreativeNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  selectNode: (id: string | null) => void

  openDialog: (parentId: string | null) => void
  closeDialog: () => void
  clearError: () => void
  generate: (prompt: string, generatorId?: string, contentType?: ContentType) => Promise<void>
}

const seedNodes: CreativeNode[] = [
  {
    id: 'seed-root',
    position: { x: 0, y: 0 },
    data: { label: '创意主题', content: '（未连接主进程的预览模式）', parentId: null },
  },
]

/** 领域节点 → 画布节点。缺坐标时按序号做纵向兜底布局。 */
function toCreativeNode(n: TreeNode, index: number): CreativeNode {
  return {
    id: n.id,
    position: n.position ?? { x: 0, y: index * 150 },
    data: {
      label: n.label || '未命名',
      content: n.content,
      contentType: n.contentType,
      status: n.status,
      prompt: n.prompt,
      parentId: n.parentId,
    },
  }
}

function fileToGraph(file: ProjectFile): { nodes: CreativeNode[]; edges: Edge[] } {
  const nodes = file.tree.nodes.map(toCreativeNode)
  const edges: Edge[] = file.tree.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
  }))
  return { nodes, edges }
}

/** 新节点坐标：根层纵向排布；子节点在父节点右侧按兄弟序号展开。 */
export function computePosition(
  nodes: CreativeNode[],
  parentId: string | null,
  siblings: number,
): { x: number; y: number } {
  if (!parentId) return { x: 0, y: nodes.length * 150 }
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return { x: 0, y: nodes.length * 150 }
  return { x: parent.position.x + 280, y: parent.position.y + siblings * 150 }
}

export const useTreeStore = create<TreeState>((set, get) => ({
  projectId: null,
  projectName: '我的创意',
  nodes: seedNodes,
  edges: [],
  selectedNodeId: null,
  generators: [],
  dialogOpen: false,
  dialogParentId: null,
  generating: false,
  error: null,

  init: async () => {
    const api = window.diverge
    if (!api) {
      // 纯浏览器：无主进程，用种子 + 占位生成器，便于快速预览
      set({ generators: [{ id: 'fake', label: '本地占位生成器（无主进程）', kind: 'direct' }] })
      return
    }
    try {
      const [file, generators] = await Promise.all([api.ensureProject(), api.listGenerators()])
      const { nodes, edges } = fileToGraph(file)
      set({
        projectId: file.project.id,
        projectName: file.project.name,
        nodes,
        edges,
        generators,
        selectedNodeId: nodes[0]?.id ?? null,
        error: null,
      })
    } catch (e) {
      set({ error: `加载项目失败：${(e as Error).message}` })
    }
  },

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),
  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (conn) => set({ edges: addEdge({ ...conn, animated: true }, get().edges) }),
  selectNode: (id) => set({ selectedNodeId: id }),

  openDialog: (parentId) => set({ dialogOpen: true, dialogParentId: parentId, error: null }),
  closeDialog: () => set({ dialogOpen: false, error: null }),
  clearError: () => set({ error: null }),

  generate: async (prompt, generatorId, contentType) => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      set({ error: '请输入一个想法描述。' })
      return
    }
    const { dialogParentId, nodes, projectId } = get()
    const siblings = nodes.filter((n) => (n.data.parentId ?? null) === dialogParentId).length
    const position = computePosition(nodes, dialogParentId, siblings)
    set({ generating: true, error: null })

    const api = window.diverge
    try {
      if (!api) {
        // 无主进程：本地占位，保证对话框在纯浏览器下也可用
        const id = `local-${Date.now()}`
        const newNode: CreativeNode = {
          id,
          position,
          data: {
            label: trimmed.slice(0, 24),
            content: `# ${trimmed}\n\n（占位内容，未连接主进程）`,
            contentType: contentType ?? 'markdown',
            status: 'done',
            parentId: dialogParentId,
          },
        }
        set((s) => ({
          nodes: [...s.nodes, newNode],
          edges: dialogParentId
            ? [...s.edges, { id: `e-${id}`, source: dialogParentId, target: id, animated: true }]
            : s.edges,
          generating: false,
          dialogOpen: false,
          selectedNodeId: id,
        }))
        return
      }

      if (!projectId) throw new Error('项目尚未加载')
      const res = await api.generateNode({
        projectId,
        parentNodeId: dialogParentId,
        prompt: trimmed,
        generatorId,
        contentType,
        position,
      })
      const newNode = toCreativeNode(res.node, 0)
      set((s) => ({
        nodes: [...s.nodes, newNode],
        edges: res.edge
          ? [
              ...s.edges,
              { id: res.edge.id, source: res.edge.source, target: res.edge.target, animated: true },
            ]
          : s.edges,
        generating: false,
        dialogOpen: false,
        selectedNodeId: newNode.id,
        error: null,
      }))
    } catch (e) {
      set({ generating: false, error: `生成失败：${(e as Error).message}` })
    }
  },
}))
