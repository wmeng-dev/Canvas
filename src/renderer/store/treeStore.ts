// C.2/C.3/C.5 渲染端状态：节点 / 边 / 选中节点 / 版本 / 右键菜单（Zustand）。
// 项目从主进程加载（ensureProject），生成与版本操作走 IPC；
// 无 Electron（纯浏览器预览）时回落到种子数据 + 本地占位生成。

import { create } from 'zustand'
import { addEdge, applyEdgeChanges, applyNodeChanges } from '@xyflow/react'
import type { Connection, Edge, EdgeChange, Node, NodeChange } from '@xyflow/react'
import type { AddMcpServerRequest, GeneratorInfo } from '../../shared/ipc'
import type { AiSettingsView } from '../../shared/settings'
import { collectAncestorIds, collectDescendantIds } from '../../shared/tree'
import type { VisibilityNode } from '../../shared/tree'
import type {
  CommentThread,
  ContentType,
  IdeaAnalysis,
  NodeVersion,
  ProjectFile,
  ProjectSummary,
  TreeNode,
} from '../../shared/types'

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
  /**
   * 画布自由气泡才携带：该气泡对应的评论 thread。
   * idea 节点不带（节点级评论走 store 的 nodeComments 映射）。
   */
  thread?: CommentThread
  /**
   * 该节点是否"收起"（收起后其**全部后代**在画布上隐藏，自身仍可见）。
   * 落盘在 TreeNode.collapsed → 下次打开保持收展状态。
   */
  collapsed?: boolean
  /**
   * 收展开关用的两个派生计数，**由画布（CreativeTree）算好后随 data 下发**。
   * "谁是谁的子节点"是画布拓扑事实，放在画布一处算，卡片与画布看到的就是同一份。
   */
  childCount?: number
  descendantCount?: number
  /** 收展动作同样由画布下发：卡片只消费画布给的事实（计数 + 动作），不自己再订阅一份。 */
  onToggleCollapse?: (nodeId: string) => void
  /**
   * 该节点是否已"归档"进想法回收站（归档后自身**连同后代**一起从画布隐藏）。
   * 落盘在 TreeNode.archived → 下次打开仍在回收站里。
   */
  archived?: boolean
  /**
   * 卡片自定义颜色（调色板里的背景色值，null = 默认白）。
   * 落盘在 TreeNode.color → 下次打开保持配色。
   */
  color?: string | null
  /** 改色动作同样由画布下发（与 onToggleCollapse 同理） */
  onSetColor?: (nodeId: string, color: string | null) => void
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
  /** 最近一次成功保存的时间戳（ISO），用于顶栏展示"已保存"反馈 */
  lastSavedAt: string | null
  /** 最近一次"另存为"写出的文件路径（展示用） */
  projectPath: string | null
  /** tab 条：所有画布的摘要（按最近更新倒序） */
  projects: ProjectSummary[]
  /** 「已关闭」的画布（tab 关掉了但数据还在，可恢复） */
  closedProjects: ProjectSummary[]
  /** 切画布要重新装载整棵树，给个忙态避免连点 */
  switchingProject: boolean
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

  // --- 评论（气泡）：节点级 + 画布自由气泡 ---
  /** 节点级评论的本地镜像：nodeId -> threads（落盘在 TreeNode.comments） */
  nodeComments: Record<string, CommentThread[]>
  /** 当前打开评论弹层的 idea 节点 id（null = 关闭） */
  activeCommentNodeId: string | null
  /** 当前打开评论弹层的画布气泡 thread id（null = 关闭） */
  activeThreadId: string | null
  /** 画布放置评论模式：下一次点击空白处即在该处创建气泡 */
  placingComment: boolean

  init: () => Promise<void>

  // --- 项目文件：重命名 / 保存 / 另存为 / 打开 ---
  renameProject: (name: string) => Promise<void>
  saveProject: () => Promise<void>
  saveProjectAs: () => Promise<void>
  openProject: () => Promise<void>
  /** 用一份完整项目文件替换当前画布（打开/导入/切 tab 后调用） */
  loadProject: (file: ProjectFile) => void
  /** 重新拉取画布列表（tab 条）；无主进程时静默跳过 */
  loadProjects: () => Promise<void>
  /** 新建一张**空白**画布并切过去 */
  createProject: () => Promise<void>
  /** 切到某个已存在的画布 */
  switchProject: (projectId: string) => Promise<void>
  /**
   * 关闭一张画布的 tab。**不删数据**：项目文件仍在磁盘，之后可从"已关闭"恢复。
   * 关掉的是当前画布时自动切到剩下的一张；全关光了会自动补一张空白画布。
   */
  closeProject: (projectId: string) => Promise<void>
  /** 重新打开一张已关闭的画布 */
  reopenProject: (projectId: string) => Promise<void>
  /** 拉取"已关闭"列表 */
  loadClosedProjects: () => Promise<void>

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
  /** 沿「根 → 该节点」的链路生成一份方案，产物作为方案节点挂在该节点下 */
  generateProposal: (nodeId: string) => Promise<void>
  /** 正在生成方案的节点 id（预览面板据此显示忙态） */
  proposingId: string | null

  beginEditPrompt: (nodeId: string) => void
  /** 取消编辑：丢弃改动，回到只读展示 */
  cancelEditPrompt: () => void
  /** 只保存描述、不生成（"不生成"那条路） */
  savePrompt: (nodeId: string, prompt: string) => Promise<void>
  setVersion: (nodeId: string, versionId: string) => Promise<void>
  /** 收起/展开节点（隐藏/显示其全部后代）：本地先切让画布立刻响应，再落库；落库失败回滚 */
  toggleCollapse: (nodeId: string) => Promise<void>
  /** 归档进回收站：只标自身（后代跟着隐藏，但自身标记不动，取出祖先时自然回来） */
  archiveNode: (nodeId: string) => Promise<void>
  /** 从回收站取出：自身**连同被归档的祖先**一起取消标记，否则取出来仍被祖先挡着看不见 */
  restoreNode: (nodeId: string) => Promise<void>
  /** 改卡片颜色（null = 恢复默认色）；本地先改让画布立刻响应，再落库；落库失败回滚 */
  setNodeColor: (nodeId: string, color: string | null) => Promise<void>

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

  // --- 评论（气泡）：节点级 + 画布自由气泡 ---
  /** 返回 true 表示成功（调用方据此清空输入草稿，失败保留） */
  addNodeComment: (nodeId: string, body: string) => Promise<boolean>
  /** 在画布流坐标创建自由气泡（body 为空，随后在弹层里填写）；成功后自动打开其弹层 */
  addCanvasComment: (pos: { x: number; y: number }) => Promise<boolean>
  updateCommentBody: (threadId: string, body: string) => Promise<boolean>
  removeComment: (threadId: string) => Promise<boolean>
  /** 自由气泡拖动后回写坐标（静默失败只报错条） */
  updateCommentPosition: (threadId: string, x: number, y: number) => Promise<void>
  /** 打开/关闭某 idea 节点的评论弹层（互斥地关闭画布气泡弹层） */
  setActiveCommentNode: (nodeId: string | null) => void
  /** 打开/关闭某画布气泡的评论弹层（互斥地关闭节点弹层） */
  setActiveThread: (threadId: string | null) => void
  /** 进入/退出"点击画布放置评论"模式 */
  togglePlacingComment: () => void
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
      collapsed: n.collapsed ?? false,
      archived: n.archived ?? false,
      color: n.color ?? null,
      kind: n.kind === 'proposal' ? 'proposal' : 'idea',
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
            // 收展状态也跟随落库值；服务端万一没带（老文件）就保留本地现状，避免"重新生成后树意外展开"
            collapsed: updated.collapsed ?? n.data.collapsed ?? false,
            archived: updated.archived ?? n.data.archived ?? false,
            color: updated.color ?? n.data.color ?? null,
            kind: updated.kind === 'proposal' ? 'proposal' : 'idea',
          },
        }
      : n,
  )
}

/** 画布自由气泡 → 画布节点（type 'comment'，由 canvas/CommentNode.tsx 渲染）。 */
function toCommentNode(t: CommentThread): CreativeNode {
  return {
    id: t.id,
    type: 'comment',
    position: t.position ?? { x: 0, y: 0 },
    data: { label: '评论', thread: t },
  }
}

function fileToGraph(file: ProjectFile): {
  nodes: CreativeNode[]
  edges: Edge[]
  nodeComments: Record<string, CommentThread[]>
} {
  const ideaNodes = file.tree.nodes.map(toCreativeNode)
  const commentNodes = (file.comments ?? []).map(toCommentNode)
  const nodeComments: Record<string, CommentThread[]> = {}
  for (const n of file.tree.nodes) {
    nodeComments[n.id] = Array.isArray(n.comments) ? n.comments : []
  }
  const edges: Edge[] = file.tree.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    animated: true,
  }))
  return { nodes: [...ideaNodes, ...commentNodes], edges, nodeComments }
}

/**
 * 画布布局间距：节点卡片是"标题 + 可行性 + 优点/缺点/风险**全部条目**"，
 * 高度由内容决定但**有上界**（生成侧契约保证三组各 2~3 条、每条 ≤20 字，
 * 见 IdeaNode 的 IDEA_NODE_MIN_HEIGHT / MAX_ITEMS_PER_GROUP），
 * 实测统一最小高度 300px、最坏约 310px。间距按"卡片最高 + 留白"取 360，保证不重叠。
 * x 方向要给卡片宽度（IDEA_NODE_WIDTH = 260）留余量。
 * ⚠️ Y 间距必须与主进程 core/generate-node.ts 的 SIBLING_SPACING_Y 保持一致。
 */
export const ROOT_SPACING_Y = 360
const CHILD_SPACING_Y = 360
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

/**
 * 画布节点 → 可见性计算用的最小形状。
 * shared/tree 的纯函数只认 `{ id, parentId, collapsed, archived }`，而画布节点把这些字段
 * 放在 `data` 里 —— 适配在这里做一次，避免多个调用点各自拼结构。
 */
export function toVisibilityNode(n: CreativeNode): VisibilityNode {
  return {
    id: n.id,
    parentId: n.data.parentId ?? null,
    collapsed: n.data.collapsed ?? false,
    archived: n.data.archived ?? false,
  }
}

/** 在状态里按 id 找一条评论 thread（先查节点级映射，再查画布气泡节点）。 */
function findThread(
  state: { nodeComments: Record<string, CommentThread[]>; nodes: CreativeNode[] },
  threadId: string,
): CommentThread | null {
  for (const list of Object.values(state.nodeComments)) {
    const hit = list.find((t) => t.id === threadId)
    if (hit) return hit
  }
  for (const n of state.nodes) {
    if (n.type === 'comment' && n.data.thread?.id === threadId) return n.data.thread
  }
  return null
}

const createdTreeStore = create<TreeState>((set, get) => {
  /**
   * 把某条 thread 的最新内容写回状态：先找节点级评论（nodeComments 映射），
   * 再找画布气泡节点（nodes 里 type==='comment'）。两处互斥，命中即返回。
   */
  const replaceThread = (t: CommentThread) => {
    const { nodeComments, nodes } = get()
    for (const [nodeId, list] of Object.entries(nodeComments)) {
      if (list.some((x) => x.id === t.id)) {
        set({
          nodeComments: { ...nodeComments, [nodeId]: list.map((x) => (x.id === t.id ? t : x)) },
        })
        return
      }
    }
    set({
      nodes: nodes.map((n) =>
        n.id === t.id && n.type === 'comment' ? { ...n, data: { ...n.data, thread: t } } : n,
      ),
    })
  }

  /** 删除某条 thread（节点级或画布气泡），并收起可能打开着的弹层。 */
  const deleteThread = (threadId: string) => {
    const { nodeComments, nodes } = get()
    for (const [nodeId, list] of Object.entries(nodeComments)) {
      if (list.some((x) => x.id === threadId)) {
        set({
          nodeComments: { ...nodeComments, [nodeId]: list.filter((x) => x.id !== threadId) },
          activeThreadId: null,
        })
        return
      }
    }
    set({
      nodes: nodes.filter((n) => !(n.id === threadId && n.type === 'comment')),
      activeThreadId: null,
    })
  }

  return {
  projectId: null,
  projectName: '我的创意',
  lastSavedAt: null,
  projectPath: null,
  projects: [],
  closedProjects: [],
  switchingProject: false,
  nodes: seedNodes,
  edges: [],
  selectedNodeId: null,
  generators: [],
  dialogOpen: false,
  dialogParentId: null,
  generating: false,
  proposingId: null,
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
  nodeComments: {},
  activeCommentNodeId: null,
  activeThreadId: null,
  placingComment: false,

  init: async () => {
    const api = window.diverge
    if (!api) {
      set({ generators: [{ id: 'fake', label: '本地占位生成器（无主进程）', kind: 'direct' }] })
      return
    }
    try {
      const [file, generators, projectsRes, closedRes] = await Promise.all([
        api.ensureProject(),
        api.listGenerators(),
        api.listProjects().catch(() => null), // 列表失败不该拖垮主流程
        api.listClosedProjects().catch(() => null),
      ])
      const { nodes, edges, nodeComments } = fileToGraph(file)
      set({
        projectId: file.project.id,
        projectName: file.project.name,
        projects: projectsRes?.projects ?? [],
        closedProjects: closedRes ?? [],
        nodes,
        edges,
        nodeComments,
        generators,
        activeCommentNodeId: null,
        activeThreadId: null,
        placingComment: false,
        selectedNodeId: nodes[0]?.id ?? null,
        error: null,
      })
    } catch (e) {
      set({ error: `加载项目失败：${(e as Error).message}` })
    }
  },

  // ---------------- 项目文件：重命名 / 保存 / 另存为 / 打开 ----------------
  renameProject: async (name) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能重命名。' })
      return
    }
    try {
      const file = await api.renameProject({ projectId, name: name.trim() || '未命名创意' })
      set({ projectName: file.project.name, error: null })
      // tab 上是画布名，改名后要跟着变（列表里存的是改名前的快照）
      await get().loadProjects()
    } catch (e) {
      set({ error: `重命名失败：${(e as Error).message}` })
    }
  },

  saveProject: async () => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能保存。' })
      return
    }
    try {
      const { savedAt } = await api.saveProject({ projectId })
      set({ lastSavedAt: savedAt, projectPath: null, error: null })
    } catch (e) {
      set({ error: `保存失败：${(e as Error).message}` })
    }
  },

  saveProjectAs: async () => {
    const { projectId, projectName } = get()
    const api = window.diverge
    if (!api || !projectId) {
      set({ error: '需要主进程支持才能导出项目文件。' })
      return
    }
    try {
      const res = await api.saveProjectAs({
        projectId,
        suggestedName: `${projectName || 'diverge-project'}.json`,
      })
      if (res.saved && res.path) {
        set({ lastSavedAt: new Date().toISOString(), projectPath: res.path, error: null })
      } else if (!res.saved && res.error) {
        set({ error: `保存失败：${res.error}` })
      }
    } catch (e) {
      set({ error: `保存失败：${(e as Error).message}` })
    }
  },

  openProject: async () => {
    const api = window.diverge
    if (!api) {
      set({ error: '需要主进程支持才能打开项目。' })
      return
    }
    try {
      const res = await api.openProject()
      if (res.opened && res.file) {
        get().loadProject(res.file)
        // ⚠️ 导入的项目是新 id，不在原 tab 列表里 —— 不刷新的话 tab 条里就没有"当前画布"这一格，
        // 连画布名输入框都会跟着消失（tab 条只给列表里的项渲染）。
        await get().loadProjects()
        set({ error: null })
      } else if (res.error) {
        set({ error: `打开失败：${res.error}` })
      }
    } catch (e) {
      set({ error: `打开失败：${(e as Error).message}` })
    }
  },

  /** 用一份完整项目文件替换当前画布（打开/导入后调用）。 */
  loadProject: (file) => {
    const { nodes, edges, nodeComments } = fileToGraph(file)
    set({
      projectId: file.project.id,
      projectName: file.project.name,
      nodes,
      edges,
      nodeComments,
      selectedNodeId: nodes[0]?.id ?? null,
      activeCommentNodeId: null,
      activeThreadId: null,
      placingComment: false,
      lastSavedAt: null,
      projectPath: null,
      warning: null,
      error: null,
    })
  },

  onNodesChange: (changes) => set({ nodes: applyNodeChanges(changes, get().nodes) }),

  loadProjects: async () => {
    const api = window.diverge
    if (!api) return
    try {
      const res = await api.listProjects()
      set({ projects: res.projects ?? [] })
    } catch {
      // 列表只是 tab 条的辅助信息，拉不到就保持现状，不打扰用户
    }
  },

  createProject: async () => {
    const api = window.diverge
    if (!api) {
      set({ error: '需要主进程支持才能新建画布。' })
      return
    }
    const current = get().projectId
    set({ switchingProject: true })
    try {
      const file = await api.createProject({})
      get().loadProject(file)
      await get().loadProjects()
      set({ error: null })
    } catch (e) {
      set({ error: `新建画布失败：${(e as Error).message}` })
      // 失败就留在原画布，别把用户丢到半路
      if (current) await get().switchProject(current).catch(() => undefined)
    } finally {
      set({ switchingProject: false })
    }
  },

  switchProject: async (projectId) => {
    const api = window.diverge
    const { projectId: currentId } = get()
    if (!api) {
      set({ error: '需要主进程支持才能切换画布。' })
      return
    }
    if (currentId === projectId) return // 点当前 tab：无事可做（也避免无谓重载丢状态）
    set({ switchingProject: true })
    try {
      const file = await api.switchProject({ projectId })
      get().loadProject(file)
      await get().loadProjects()
      set({ error: null })
    } catch (e) {
      set({ error: `切换画布失败：${(e as Error).message}` })
    } finally {
      set({ switchingProject: false })
    }
  },

  onEdgesChange: (changes) => set({ edges: applyEdgeChanges(changes, get().edges) }),
  onConnect: (conn) => set({ edges: addEdge({ ...conn, animated: true }, get().edges) }),

  loadClosedProjects: async () => {
    const api = window.diverge
    if (!api) return
    try {
      const closed = await api.listClosedProjects()
      set({ closedProjects: closed, error: null })
    } catch (e) {
      set({ error: `读取已关闭画布失败：${(e as Error).message}` })
    }
  },

  closeProject: async (projectId) => {
    const api = window.diverge
    if (!api) {
      set({ error: '需要主进程支持才能关闭画布。' })
      return
    }
    set({ switchingProject: true })
    try {
      const remaining = await api.closeProject({ projectId })
      await get().loadClosedProjects()
      const { projectId: currentId } = get()
      if (projectId !== currentId) {
        // 关的不是当前画布：tab 列表更新一下就行，画布内容不用动
        set({ projects: remaining, error: null })
      } else if (remaining.length > 0) {
        // 关的是当前画布 → 切到剩下的一张（服务端已把 lastProjectId 挪过去了）
        const file = await api.switchProject({ projectId: remaining[0].id })
        get().loadProject(file)
        set({ projects: remaining, error: null })
      } else {
        // 全关掉了 → 像浏览器那样补一张空白画布，保证界面里始终有一张能用的
        await get().createProject()
      }
    } catch (e) {
      set({ error: `关闭画布失败：${(e as Error).message}` })
    } finally {
      set({ switchingProject: false })
    }
  },

  reopenProject: async (projectId) => {
    const api = window.diverge
    if (!api) {
      set({ error: '需要主进程支持才能恢复画布。' })
      return
    }
    set({ switchingProject: true })
    try {
      const file = await api.reopenProject({ projectId })
      get().loadProject(file)
      await Promise.all([get().loadProjects(), get().loadClosedProjects()])
      set({ error: null })
    } catch (e) {
      set({ error: `恢复画布失败：${(e as Error).message}` })
    } finally {
      set({ switchingProject: false })
    }
  },

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
    // 父节点原本是收起的 → 生成成功后自动展开它：
    // 否则新生成的子节点会立刻被父节点的收起状态藏起来，用户会以为"生成没生效"。
    const parentWasCollapsed = dialogParentId
      ? (nodes.find((n) => n.id === dialogParentId)?.data.collapsed ?? false)
      : false
    const expandParent = (list: CreativeNode[]) =>
      parentWasCollapsed && dialogParentId
        ? list.map((n) =>
            n.id === dialogParentId ? { ...n, data: { ...n.data, collapsed: false } } : n,
          )
        : list
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
          nodes: expandParent([...s.nodes, ...created]),
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
      // 父节点原本收起 → 一并落库为展开，避免刷新后又收回去（本地改动已在 expandParent 里做）
      if (parentWasCollapsed && dialogParentId) {
        await api.setNodeCollapsed({ projectId, nodeId: dialogParentId, collapsed: false })
      }
      const created = res.items.map((it, i) => toCreativeNode(it.node, i))
      set((s) => ({
        nodes: expandParent([...s.nodes, ...created]),
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

  /**
   * 沿「根 → 该节点」的链路生成一份方案（收敛）。
   * 与发散（`generate`）最大的差别：产物**只有一个**，且挂在链条**末端**而不是根下 ——
   * 方案是这条链一路取舍后的结果，挂回根下就分不清它是从哪条链收出来的。
   */
  generateProposal: async (nodeId) => {
    const { nodes, projectId } = get()
    const api = window.diverge
    if (!projectId) {
      set({ error: '项目尚未加载' })
      return
    }
    const siblings = nodes.filter((n) => n.data.parentId === nodeId).length
    const position = computePosition(nodes, nodeId, siblings)
    // 末端节点原本是收起的 → 生成后自动展开，否则新方案节点会立刻被藏住（看起来像"没生成"）
    const wasCollapsed = nodes.find((n) => n.id === nodeId)?.data.collapsed ?? false
    set({ proposingId: nodeId, error: null, warning: null })

    try {
      if (!api) throw new Error('需要主进程支持才能生成方案。')
      const res = await api.generateProposal({ projectId, nodeId, position })
      if (wasCollapsed) await api.setNodeCollapsed({ projectId, nodeId, collapsed: false })
      const created = toCreativeNode(res.node, 0)
      set((s) => ({
        nodes: [
          ...s.nodes.map((n) => (wasCollapsed && n.id === nodeId ? { ...n, data: { ...n.data, collapsed: false } } : n)),
          created,
        ],
        edges: res.edge
          ? [...s.edges, { id: res.edge.id, source: res.edge.source, target: res.edge.target, animated: true }]
          : s.edges,
        proposingId: null,
        selectedNodeId: created.id,
      }))
    } catch (e) {
      set({ proposingId: null, error: `生成方案失败：${(e as Error).message}` })
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

  toggleCollapse: async (nodeId) => {
    const { nodes, projectId } = get()
    const target = nodes.find((n) => n.id === nodeId)
    if (!target) return
    const prev = target.data.collapsed ?? false
    const next = !prev
    const apply = (list: CreativeNode[], v: boolean) =>
      list.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, collapsed: v } } : n))
    // 乐观更新：先切本地让画布立刻收展，再落库；落库失败回滚到原状态
    set({ nodes: apply(nodes, next) })
    const api = window.diverge
    if (!api || !projectId) return // 无主进程（纯浏览器预览）：仅本地生效
    try {
      await api.setNodeCollapsed({ projectId, nodeId, collapsed: next })
    } catch (e) {
      set({ nodes: apply(get().nodes, prev), error: `收展状态保存失败：${(e as Error).message}` })
    }
  },

  // ---------------- 想法回收站（归档 / 取出） ----------------
  archiveNode: async (nodeId) => {
    const { nodes, projectId } = get()
    const target = nodes.find((n) => n.id === nodeId)
    if (!target || target.data.archived) return
    const prev = nodes
    // 归档后该节点连同后代一起从画布消失；若当前预览的正是它们之一，清空选中避免预览一个看不见的节点
    const gone = new Set<string>([nodeId, ...collectDescendantIds(nodes.map(toVisibilityNode), nodeId)])
    set({
      nodes: nodes.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, archived: true } } : n)),
      selectedNodeId: gone.has(get().selectedNodeId ?? '') ? null : get().selectedNodeId,
    })
    const api = window.diverge
    if (!api || !projectId) return
    try {
      await api.setNodeArchived({ projectId, nodeIds: [nodeId], archived: true })
    } catch (e) {
      set({ nodes: prev, error: `归档失败：${(e as Error).message}` })
    }
  },

  restoreNode: async (nodeId) => {
    const { nodes, projectId } = get()
    const vis = nodes.map(toVisibilityNode)
    // 取出要连带祖先：只取消自己，若祖上还有归档项，取出来照样看不见
    const ids = [nodeId, ...collectAncestorIds(vis, nodeId).filter((id) => vis.find((v) => v.id === id)?.archived)]
    const prev = nodes
    const idSet = new Set(ids)
    set({
      nodes: nodes.map((n) =>
        idSet.has(n.id) ? { ...n, data: { ...n.data, archived: false } } : n,
      ),
      selectedNodeId: nodeId,
    })
    const api = window.diverge
    if (!api || !projectId) return
    try {
      await api.setNodeArchived({ projectId, nodeIds: ids, archived: false })
    } catch (e) {
      set({ nodes: prev, error: `取出失败：${(e as Error).message}` })
    }
  },

  // ---------------- 卡片自定义颜色 ----------------
  setNodeColor: async (nodeId, color) => {
    const { nodes, projectId } = get()
    const prevColor = nodes.find((n) => n.id === nodeId)?.data.color ?? null
    const apply = (list: CreativeNode[], c: string | null) =>
      list.map((n) => (n.id === nodeId ? { ...n, data: { ...n.data, color: c } } : n))
    // 乐观更新：先改本地让卡片立刻变色，再落库；落库失败回滚到原色
    set({ nodes: apply(nodes, color) })
    const api = window.diverge
    if (!api || !projectId) return // 无主进程（纯浏览器预览）：仅本地生效
    try {
      await api.setNodeColor({ projectId, nodeId, color: color ?? null })
    } catch (e) {
      set({ nodes: apply(get().nodes, prevColor), error: `改色失败：${(e as Error).message}` })
    }
  },

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

  // ---------------- 评论（气泡）：节点级 + 画布自由气泡 ----------------
  addNodeComment: async (nodeId, body) => {
    const text = body.trim()
    if (!text) return false
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      // 无主进程（纯浏览器预览）：本地占位，保证功能可用
      const thread: CommentThread = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        nodeId,
        body: text,
        createdAt: new Date().toISOString(),
      }
      set((s) => ({
        nodeComments: { ...s.nodeComments, [nodeId]: [...(s.nodeComments[nodeId] ?? []), thread] },
      }))
      return true
    }
    try {
      const thread = await api.addNodeComment({ projectId, nodeId, body: text })
      set((s) => ({
        nodeComments: { ...s.nodeComments, [nodeId]: [...(s.nodeComments[nodeId] ?? []), thread] },
        error: null,
      }))
      return true
    } catch (e) {
      set({ error: `添加评论失败：${(e as Error).message}` })
      return false
    }
  },

  addCanvasComment: async (pos) => {
    set({ placingComment: false }) // 放置是一次性动作，创建后立即退出放置模式
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) {
      const thread: CommentThread = {
        id: `local-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        position: pos,
        body: '',
        createdAt: new Date().toISOString(),
      }
      set((s) => ({ nodes: [...s.nodes, toCommentNode(thread)], activeThreadId: thread.id }))
      return true
    }
    try {
      const thread = await api.addCanvasComment({ projectId, x: pos.x, y: pos.y, body: '' })
      set((s) => ({
        nodes: [...s.nodes, toCommentNode(thread)],
        activeThreadId: thread.id, // 新气泡自动打开弹层，用户直接写第一条评论
        error: null,
      }))
      return true
    } catch (e) {
      set({ error: `添加评论失败：${(e as Error).message}` })
      return false
    }
  },

  updateCommentBody: async (threadId, body) => {
    const { projectId } = get()
    const api = window.diverge
    const text = body.trim()
    if (api && projectId) {
      try {
        const t = await api.updateCommentBody({ projectId, threadId, body: text })
        replaceThread(t)
        set({ error: null })
        return true
      } catch (e) {
        set({ error: `保存评论失败：${(e as Error).message}` })
        return false
      }
    }
    const cur = findThread(get(), threadId)
    if (!cur) return false
    replaceThread({ ...cur, body: text })
    return true
  },

  removeComment: async (threadId) => {
    const { projectId } = get()
    const api = window.diverge
    deleteThread(threadId) // 本地先删（含收起弹层），落库失败只报错条
    if (api && projectId) {
      try {
        await api.removeComment({ projectId, threadId })
      } catch (e) {
        set({ error: `删除评论失败：${(e as Error).message}` })
      }
    }
    return true
  },

  updateCommentPosition: async (threadId, x, y) => {
    const { projectId } = get()
    const api = window.diverge
    if (!api || !projectId) return
    try {
      await api.updateCommentPosition({ projectId, threadId, x, y })
    } catch (e) {
      set({ error: `保存评论位置失败：${(e as Error).message}` })
    }
  },

  setActiveCommentNode: (nodeId) =>
    set({ activeCommentNodeId: nodeId, activeThreadId: null }),
  setActiveThread: (threadId) =>
    set({ activeThreadId: threadId, activeCommentNodeId: null }),
  togglePlacingComment: () =>
    set((s) => ({
      placingComment: !s.placingComment,
      activeCommentNodeId: null,
      activeThreadId: null,
    })),
  }
})

/**
 * ⚠️ 导出前做一次 globalThis 单例守卫 —— 这不是防御性冗余，是实测踩到的坑：
 * 本机的 vite 构建会把本模块打进**两份**（产物里 store 的特征字符串各出现两次），
 * 两份各自 `create` 一次就得到两个互不相通的 store，而各组件绑到哪一份是不确定的：
 * 一旦"画布绑 A、卡片绑 B"，卡片上点按钮就只改到 B（UI 看着变了），
 * 画布纹丝不动，且 B 那份从没跑过 init()、projectId 是空的 → 写不进磁盘。
 * 挂到 globalThis 后，无论被打成几份，全应用拿到的都是同一个 store。
 */
type StoreSingletonHost = typeof globalThis & { __divergeTreeStore__?: typeof createdTreeStore }
export const useTreeStore = (
  (globalThis as StoreSingletonHost).__divergeTreeStore__ ??= createdTreeStore
)
