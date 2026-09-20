// C.2/C.3/C.5 渲染端状态：节点 / 边 / 选中节点 / 版本 / 右键菜单（Zustand）。
// 项目从主进程加载（ensureProject），生成与版本操作走 IPC；
// 无 Electron（纯浏览器预览）时回落到种子数据 + 本地占位生成。

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { AddMcpServerRequest, GeneratorInfo } from '../../shared/ipc'
import type { AiSettingsView } from '../../shared/settings'
import type { ContentType, IdeaAnalysis, NodeVersion, ProjectFile, TreeNode } from '../../shared/types'

// ---------------- D.3 预览面板宽度（可拖动，不再固定 340） ----------------

export const PREVIEW_WIDTH_MIN = 260
export const PREVIEW_WIDTH_MAX = 960
export const PREVIEW_WIDTH_DEFAULT = 340
/** 拖到上限时至少给左侧画布留出的宽度 */
const CANVAS_MIN_WIDTH = 360
const PREVIEW_WIDTH_KEY = 'diverge.previewWidth'

/** 面板宽度上限：取"固定上限"与"视口留白"中的小者，避免把画布挤没。 */
export function clampPreviewWidth(w: number): number {
  const viewportMax =
    typeof window === 'undefined'
      ? PREVIEW_WIDTH_MAX
      : Math.max(PREVIEW_WIDTH_MIN, window.innerWidth - CANVAS_MIN_WIDTH)
  return Math.round(Math.min(Math.max(w, PREVIEW_WIDTH_MIN), Math.min(PREVIEW_WIDTH_MAX, viewportMax)))
}

/** 读取上次宽度（best-effort：file:// 下 localStorage 可能不可用，失败就回落默认）。 */
function loadPreviewWidth(): number {
  try {
    const raw = localStorage.getItem(PREVIEW_WIDTH_KEY)
    const v = raw === null ? NaN : Number(raw)
    if (Number.isFinite(v)) return clampPreviewWidth(v)
  } catch {
    /* 无 localStorage（如纯浏览器预览/打包 file://）→ 用默认值 */
  }
  return PREVIEW_WIDTH_DEFAULT
}

function persistPreviewWidth(w: number): void {
  try {
    localStorage.setItem(PREVIEW_WIDTH_KEY, String(w))
  } catch {
    /* 存不下就算了，不影响本次会话内的拖拽 */
  }
}

export interface CreativeNodeData extends Record<string, unknown> {
  /** 结果标题（发散出来的东西叫什么），由生成器给出、回落到 prompt 派生标签 */
  label: string
  content?: string
  /** 预览用：决定用 markdown / html(沙箱) / svg(沙箱) / text 渲染 */
  contentType?: ContentType
  /** 结构化发散评估（可行性/优点/缺点/风险）；旧节点或第三方后端可能没有 */
  analysis?: IdeaAnalysis | null
  status?: string
  /** 用户当初输入的那句话（不再作为节点标题，仅作次要信息展示） */
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
  /**
   * 正在"编辑描述"的节点 id（null = 不在编辑态）。
   * 放在 store 而不是面板局部 state，是因为右键菜单的「重新生成」也要能进入编辑态 ——
   * 两处入口必须共用同一个状态，否则会出现"菜单进了编辑态、面板却不知道"。
   */
  editingPromptNodeId: string | null

  /** C.6 AI 后端设置面板 */
  aiOpen: boolean
  aiSettings: AiSettingsView | null
  aiBusy: boolean

  /** D.1 导出对话框 */
  exportOpen: boolean

  /** D.3 预览面板宽度（可拖边缘调整） */
  previewWidth: number

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
  /**
   * 用（可能编辑过的）描述重新生成一版。不传描述则沿用节点原描述。
   * 成功后退出编辑态。
   */
  regenerate: (nodeId: string, prompt?: string) => Promise<void>
  /** 进入"编辑描述"态（并选中该节点）；不会触发生成 */
  beginEditPrompt: (nodeId: string) => void
  /** 取消编辑：丢弃改动，回到只读展示 */
  cancelEditPrompt: () => void
  /** 只保存描述、不生成（"不生成"那条路） */
  savePrompt: (nodeId: string, prompt: string) => Promise<void>
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

  // --- D.3 预览面板宽度 ---
  setPreviewWidth: (w: number) => void
  resetPreviewWidth: () => void
}

const seedNodes: CreativeNode[] = [
  {
    id: 'seed-root',
    type: 'idea',
    position: { x: 0, y: 0 },
    data: { label: '创意主题', content: '（未连接主进程的预览模式）', parentId: null },
  },
]

/** 领域节点 → 画布节点。缺坐标时按序号做纵向兜底布局。 */
function toCreativeNode(n: TreeNode, index: number): CreativeNode {
  return {
    id: n.id,
    // 自定义节点组件（canvas/IdeaNode.tsx）读 data.label 当结果标题渲染
    type: 'idea',
    position: n.position ?? { x: 0, y: index * ROOT_SPACING_Y },
    data: {
      label: n.label || '未命名',
      content: n.content,
      contentType: n.contentType ?? 'markdown',
      analysis: n.analysis ?? null,
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
            analysis: updated.analysis ?? null,
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

/**
 * 画布布局间距：节点卡片带标题 + 可行性 + 三行要点，比默认单行节点高得多，
 * 间距太近会重叠（卡片实测高度约 150px）。x 方向同理要给卡片宽度留余量。
 * ⚠️ Y 间距必须与主进程 core/generate-node.ts 的 SIBLING_SPACING_Y 保持一致。
 */
export const ROOT_SPACING_Y = 200
const CHILD_SPACING_Y = 200
const CHILD_SPACING_X = 320

/** 新节点坐标：根层纵向排布；子节点在父节点右侧按兄弟序号展开。 */
export function computePosition(
  nodes: CreativeNode[],
  parentId: string | null,
  siblings: number,
): { x: number; y: number } {
  if (!parentId) return { x: 0, y: nodes.length * ROOT_SPACING_Y }
  const parent = nodes.find((n) => n.id === parentId)
  if (!parent) return { x: 0, y: nodes.length * ROOT_SPACING_Y }
  return { x: parent.position.x + CHILD_SPACING_X, y: parent.position.y + siblings * CHILD_SPACING_Y }
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
  editingPromptNodeId: null,
  aiOpen: false,
  aiSettings: null,
  aiBusy: false,
  exportOpen: false,
  previewWidth: loadPreviewWidth(),

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
  selectNode: (id) =>
    // 切到别的节点时退出编辑态：不能把 A 节点未保存的描述带到 B 节点上
    set((s) => ({ selectedNodeId: id, editingPromptNodeId: s.editingPromptNodeId === id ? s.editingPromptNodeId : null })),

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
            type: 'idea',
            position: { x: position.x, y: position.y + i * CHILD_SPACING_Y },
            data: {
              // 纯浏览器占位没有生成器，只能拿输入兜底；界面明确标注是占位
              label: `（占位）${label.slice(0, 24)}`,
              content: `# ${label}\n\n（占位内容，未连接主进程）`,
              contentType: contentType ?? 'markdown',
              analysis: null,
              status: 'done',
              prompt: trimmed,
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

  regenerate: async (nodeId, prompt) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能重新生成。' })
      return
    }
    set({ regeneratingId: nodeId, error: null, menu: null })
    try {
      const updated = await api.regenerateNode({ projectId, nodeId, prompt })
      set((s) => ({
        nodes: mergeNode(s.nodes, updated),
        regeneratingId: null,
        selectedNodeId: nodeId,
        // 生成成功 → 退出编辑态（描述已随这一版落库）
        editingPromptNodeId: s.editingPromptNodeId === nodeId ? null : s.editingPromptNodeId,
      }))
    } catch (e) {
      // 失败时**保留编辑态**：用户刚敲好的描述不能因为一次失败就丢掉
      set({ regeneratingId: null, error: `重新生成失败：${(e as Error).message}` })
    }
  },

  beginEditPrompt: (nodeId) =>
    set({ selectedNodeId: nodeId, editingPromptNodeId: nodeId, menu: null, error: null }),

  cancelEditPrompt: () => set({ editingPromptNodeId: null }),

  savePrompt: async (nodeId, prompt) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能保存描述。' })
      return
    }
    try {
      const updated = await api.updateNodePrompt({ projectId, nodeId, prompt: prompt.trim() })
      set((s) => ({
        nodes: mergeNode(s.nodes, updated),
        selectedNodeId: nodeId,
        editingPromptNodeId: s.editingPromptNodeId === nodeId ? null : s.editingPromptNodeId,
        error: null,
      }))
    } catch (e) {
      set({ error: `保存描述失败：${(e as Error).message}` })
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

  // ---------------- D.3 预览面板宽度 ----------------
  setPreviewWidth: (w) => {
    const next = clampPreviewWidth(w)
    persistPreviewWidth(next)
    set({ previewWidth: next })
  },
  resetPreviewWidth: () => {
    persistPreviewWidth(PREVIEW_WIDTH_DEFAULT)
    set({ previewWidth: PREVIEW_WIDTH_DEFAULT })
  },
}))
