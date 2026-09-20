// C.2/C.3/C.5 渲染端状态：节点 / 边 / 选中节点 / 版本 / 右键菜单（Zustand）。
// 项目从主进程加载（ensureProject），生成与版本操作走 IPC；
// 无 Electron（纯浏览器预览）时回落到种子数据 + 本地占位生成。

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { AddMcpServerRequest, GeneratorInfo } from '../../shared/ipc'
import type { AiSettingsView } from '../../shared/settings'
import type { ContentType, NodeVersion, ProjectFile, TreeNode } from '../../shared/types'

export interface CreativeNodeData extends Record<string, unknown> {
  label: string
  content?: string
  /** 预览用：决定用 markdown / html(沙箱) / svg(沙箱) / text 渲染 */
  contentType?: ContentType
  status?: string
  prompt?: string
  /** 父节点 id（根层为 null）；用于布局与"兄弟计数" */
  parentId?: string | null
  /** 历史版本（按时间升序）与当前版本，用于"翻案" */
  versions?: NodeVersion[]
  currentVersionId?: string | null
}

export type CreativeNode = Node<CreativeNodeData>

interface ContextMenuState {
  nodeId: string
  /** 视口坐标（fixed 定位） */
  x: number
  y: number
}

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
  /** 部分失败（批量发散时个别失败）的提示 */
  warning: string | null
  /** 右键菜单 */
  menu: ContextMenuState | null
  /** 正在重新生成的节点 id */
  regeneratingId: string | null

  /** C.6 AI 后端设置面板 */
  aiOpen: boolean
  aiSettings: AiSettingsView | null
  aiBusy: boolean

  /** D.1 导出对话框 */
  exportOpen: boolean

  init: () => Promise<void>

  onNodesChange: (changes: NodeChange<CreativeNode>[]) => void
  onEdgesChange: (changes: EdgeChange[]) => void
  onConnect: (conn: Connection) => void
  selectNode: (id: string | null) => void

  openDialog: (parentId: string | null) => void
  closeDialog: () => void
  clearError: () => void
  clearWarning: () => void

  openMenu: (nodeId: string, x: number, y: number) => void
  closeMenu: () => void

  generate: (prompt: string, generatorId?: string, contentType?: ContentType, count?: number) => Promise<void>
  regenerate: (nodeId: string) => Promise<void>
  setVersion: (nodeId: string, versionId: string) => Promise<void>

  // --- C.6 AI 后端设置 ---
  openAi: () => void
  closeAi: () => void
  loadAiSettings: () => Promise<void>
  setDeepSeekKey: (apiKey: string) => Promise<void>
  clearDeepSeekKey: () => Promise<void>
  addMcpServer: (req: AddMcpServerRequest) => Promise<void>
  removeMcpServer: (id: string) => Promise<void>
  setMcpServerEnabled: (id: string, enabled: boolean) => Promise<void>

  // --- D.1 导出 ---
  openExport: () => void
  closeExport: () => void
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
      contentType: n.contentType ?? 'markdown',
      status: n.status,
      prompt: n.prompt,
      parentId: n.parentId,
      versions: n.versions ?? [],
      currentVersionId: n.currentVersionId ?? null,
    },
  }
}

/** 把主进程返回的节点合并回画布（保留原坐标 —— 重新生成/翻案不应让节点跳位）。 */
function mergeNode(nodes: CreativeNode[], updated: TreeNode): CreativeNode[] {
  return nodes.map((n) =>
    n.id === updated.id
      ? {
          ...n,
          data: {
            ...n.data,
            label: updated.label,
            content: updated.content,
            contentType: updated.contentType ?? 'markdown',
            status: updated.status,
            prompt: updated.prompt,
            versions: updated.versions ?? [],
            currentVersionId: updated.currentVersionId ?? null,
          },
        }
      : n,
  )
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
  warning: null,
  menu: null,
  regeneratingId: null,
  aiOpen: false,
  aiSettings: null,
  aiBusy: false,
  exportOpen: false,

  init: async () => {
    const api = window.diverge
    if (!api) {
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
  clearWarning: () => set({ warning: null }),

  openMenu: (nodeId, x, y) => set({ menu: { nodeId, x, y } }),
  closeMenu: () => set({ menu: null }),

  generate: async (prompt, generatorId, contentType, count = 1) => {
    const trimmed = prompt.trim()
    if (!trimmed) {
      set({ error: '请输入一个想法描述。' })
      return
    }
    const { dialogParentId, nodes, projectId } = get()
    const siblings = nodes.filter((n) => (n.data.parentId ?? null) === dialogParentId).length
    const position = computePosition(nodes, dialogParentId, siblings)
    set({ generating: true, error: null, warning: null, menu: null })

    const api = window.diverge
    try {
      if (!api) {
        // 无主进程：本地占位，保证对话框在纯浏览器下也可用
        const created: CreativeNode[] = Array.from({ length: count }, (_, i) => {
          const label = count === 1 ? trimmed : `${trimmed}（方向 ${i + 1}）`
          return {
            id: `local-${Date.now()}-${i}`,
            position: { x: position.x, y: position.y + i * 150 },
            data: {
              label: label.slice(0, 24),
              content: `# ${label}\n\n（占位内容，未连接主进程）`,
              contentType: contentType ?? 'markdown',
              status: 'done',
              parentId: dialogParentId,
            },
          }
        })
        set((s) => ({
          nodes: [...s.nodes, ...created],
          edges: [
            ...s.edges,
            ...(dialogParentId
              ? created.map((c) => ({
                  id: `e-${c.id}`,
                  source: dialogParentId,
                  target: c.id,
                  animated: true,
                }))
              : []),
          ],
          generating: false,
          dialogOpen: false,
          selectedNodeId: created[0]?.id ?? null,
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
        count,
        position,
      })
      const created = res.items.map((it, i) => toCreativeNode(it.node, i))
      set((s) => ({
        nodes: [...s.nodes, ...created],
        edges: [
          ...s.edges,
          ...res.items
            .filter((it) => it.edge)
            .map((it) => ({
              id: it.edge!.id,
              source: it.edge!.source,
              target: it.edge!.target,
              animated: true,
            })),
        ],
        generating: false,
        dialogOpen: false,
        selectedNodeId: created[0]?.id ?? null,
        error: null,
        warning:
          res.failures.length > 0
            ? `有 ${res.failures.length} 条生成失败：${res.failures[0].error}`
            : null,
      }))
    } catch (e) {
      set({ generating: false, error: `生成失败：${(e as Error).message}` })
    }
  },

  regenerate: async (nodeId) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能重新生成。' })
      return
    }
    set({ regeneratingId: nodeId, error: null, menu: null })
    try {
      const updated = await api.regenerateNode({ projectId, nodeId })
      set((s) => ({
        nodes: mergeNode(s.nodes, updated),
        regeneratingId: null,
        selectedNodeId: nodeId,
      }))
    } catch (e) {
      set({ regeneratingId: null, error: `重新生成失败：${(e as Error).message}` })
    }
  },

  setVersion: async (nodeId, versionId) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能翻案。' })
      return
    }
    try {
      const updated = await api.setNodeVersion({ projectId, nodeId, versionId })
      set((s) => ({ nodes: mergeNode(s.nodes, updated), selectedNodeId: nodeId, error: null }))
    } catch (e) {
      set({ error: `翻案失败：${(e as Error).message}` })
    }
  },

  // ---------------- C.6 AI 后端设置 ----------------
  openAi: () => {
    set({ aiOpen: true })
    void get().loadAiSettings()
  },
  closeAi: () => set({ aiOpen: false }),

  loadAiSettings: async () => {
    const api = window.diverge
    if (!api) return
    try {
      set({ aiSettings: await api.getAiSettings() })
    } catch (e) {
      set({ error: `读取 AI 设置失败：${(e as Error).message}` })
    }
  },

  setDeepSeekKey: async (apiKey) => {
    const api = window.diverge
    if (!api) return
    set({ aiBusy: true, error: null })
    try {
      const aiSettings = await api.setDeepSeekKey(apiKey)
      set({ aiSettings, generators: await api.listGenerators(), aiBusy: false })
    } catch (e) {
      set({ aiBusy: false, error: `保存密钥失败：${(e as Error).message}` })
    }
  },

  clearDeepSeekKey: async () => {
    const api = window.diverge
    if (!api) return
    set({ aiBusy: true, error: null })
    try {
      const aiSettings = await api.clearDeepSeekKey()
      set({ aiSettings, generators: await api.listGenerators(), aiBusy: false })
    } catch (e) {
      set({ aiBusy: false, error: `清除密钥失败：${(e as Error).message}` })
    }
  },

  addMcpServer: async (req) => {
    const api = window.diverge
    if (!api) return
    set({ aiBusy: true, error: null })
    try {
      const aiSettings = await api.addMcpServer(req)
      set({ aiSettings, generators: await api.listGenerators(), aiBusy: false })
    } catch (e) {
      set({ aiBusy: false, error: `添加 MCP Server 失败：${(e as Error).message}` })
    }
  },

  removeMcpServer: async (id) => {
    const api = window.diverge
    if (!api) return
    set({ aiBusy: true, error: null })
    try {
      const aiSettings = await api.removeMcpServer(id)
      set({ aiSettings, generators: await api.listGenerators(), aiBusy: false })
    } catch (e) {
      set({ aiBusy: false, error: `删除 MCP Server 失败：${(e as Error).message}` })
    }
  },

  setMcpServerEnabled: async (id, enabled) => {
    const api = window.diverge
    if (!api) return
    set({ aiBusy: true, error: null })
    try {
      const aiSettings = await api.setMcpServerEnabled(id, enabled)
      set({ aiSettings, generators: await api.listGenerators(), aiBusy: false })
    } catch (e) {
      set({ aiBusy: false, error: `${enabled ? '启用' : '停用'} MCP Server 失败：${(e as Error).message}` })
    }
  },

  // ---------------- D.1 导出 ----------------
  openExport: () => set({ exportOpen: true }),
  closeExport: () => set({ exportOpen: false }),
}))
