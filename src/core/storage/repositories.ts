import { randomUUID } from 'crypto'
import { JsonStore } from './store'
import type {
  CommentThread,
  IdeaAnalysis,
  NodeVersion,
  Project,
  ProjectFile,
  TreeNode,
  TreeEdge,
} from '../../shared/types'

function nowIso(): string {
  return new Date().toISOString()
}

export type NewNodeInput = Partial<TreeNode> & {
  /** 节点显示名（= 结果标题；生成器给不出时由上层回落成 prompt 派生标签） */
  label: string
  parentId?: string | null
  /** 首个版本的"结果标题"（可选：逐字保留，供翻案时还原显示名） */
  title?: string
  /** 首个版本的结构化评估 */
  analysis?: IdeaAnalysis | null
  /** 生成该内容的模型名（写入首个版本） */
  model?: string
}

export interface NewVersionInput {
  content: string
  contentType?: TreeNode['contentType']
  /**
   * 这一版是用哪句话生成的（可能是用户编辑后的描述）。
   * 给了就写进版本并同步成节点上的描述 —— 与 title/analysis 同一套"跟随版本"规则。
   */
  prompt?: string
  /** 这一版的结果标题；给了就同步成节点显示名 */
  title?: string
  /** 这一版的结构化评估 */
  analysis?: IdeaAnalysis | null
  generatorId?: string | null
  model?: string
}

/**
 * 向后兼容：早期版本的项目文件没有 content 类型 / 版本字段。
 * 就地补齐（仅内存，读时幂等；合成的首版 id 由 nodeId 派生，稳定可复现）。
 */
function migrateNode(n: TreeNode): void {
  if (!n.contentType) n.contentType = 'markdown'
  if (!Array.isArray(n.versions)) n.versions = []
  if (n.versions.length === 0 && n.content) {
    n.versions.push({
      id: `${n.id}-v1`,
      content: n.content,
      contentType: n.contentType,
      // 描述也带上：否则旧项目翻案回 v1 时会因为"版本没有 prompt"而保留后来改过的描述
      prompt: n.prompt || undefined,
      generatorId: n.generatorId,
      createdAt: n.createdAt,
    })
  }
  if (!n.currentVersionId) {
    n.currentVersionId = n.versions.length ? n.versions[n.versions.length - 1].id : null
  }
  if (!Array.isArray(n.comments)) n.comments = []
  // 收展状态：旧文件没有该字段 → 默认展开（false）
  if (typeof n.collapsed !== 'boolean') n.collapsed = false
}

/** 文件级（画布自由气泡）评论列表向后补齐 */
function migrateComments(file: ProjectFile): void {
  if (!Array.isArray(file.comments)) file.comments = []
  for (const n of file.tree.nodes) migrateNode(n)
}

/**
 * 高层仓储：项目 / 节点 / 版本 / 边的 CRUD。
 * 所有写操作经 JsonStore 落盘（原子替换），并维护 project.updatedAt。
 */
export class ProjectRepository {
  constructor(private readonly store: JsonStore) {}

  // ---------- 项目管理 ----------
  create(name: string): ProjectFile {
    const id = randomUUID()
    const ts = nowIso()
    const file: ProjectFile = {
      project: {
        id,
        name: (name || '').trim() || '未命名创意',
        createdAt: ts,
        updatedAt: ts,
      },
      tree: { nodes: [], edges: [] },
    }
    this.store.write(id, file)
    return file
  }

  get(id: string): ProjectFile {
    const file = this.store.read<ProjectFile>(id)
    migrateComments(file)
    return file
  }

  list(): Project[] {
    return this.store
      .listProjectIds()
      .map((id) => this.store.read<ProjectFile>(id).project)
  }

  rename(id: string, name: string): ProjectFile {
    const file = this.get(id)
    const trimmed = (name || '').trim()
    if (trimmed) file.project.name = trimmed
    file.project.updatedAt = nowIso()
    this.store.write(id, file)
    return file
  }

  remove(id: string): void {
    this.store.delete(id)
  }

  /** 项目文件是否存在（按 id） */
  exists(id: string): boolean {
    return this.store.exists(id)
  }

  /**
   * "另存为"的反向：把一个外部读入的 ProjectFile 落库（按文件里自带的 id）。
   * - 缺 id 时自动补一个，保证可后续自动保存；
   * - 直接走底层 JsonStore 写入（保留文件里的全部节点/边/版本，不丢历史）；
   * - 返回时经 get() 跑一遍 migrateNode，保证渲染端拿到的是补齐后的完整结构。
   */
  importExternal(file: ProjectFile): ProjectFile {
    if (!file || typeof file !== 'object' || !file.project || !Array.isArray(file.tree?.nodes)) {
      throw new Error('不是有效的 Diverge 项目文件')
    }
    if (!file.project.id) file.project.id = randomUUID()
    this.store.write(file.project.id, file)
    return this.get(file.project.id)
  }

  /**
   * 显式"保存"：把当前项目（按 id 重新读出再写回）刷一次盘。
   * 自动保存在每次变更时已经发生，这里主要提供一个"主动落盘 + 确认"的入口，
   * 并让"保存"按钮有确定可观测的写盘动作。
   */
  persist(id: string): ProjectFile {
    const file = this.get(id)
    this.store.write(id, file)
    return file
  }

  // ---------- 节点管理 ----------
  addNode(projectId: string, input: NewNodeInput): TreeNode {
    const file = this.get(projectId)
    const ts = nowIso()
    const node: TreeNode = {
      id: randomUUID(),
      parentId: input.parentId ?? null,
      label: input.label,
      prompt: input.prompt ?? '',
      content: input.content ?? '',
      contentType: input.contentType ?? 'markdown',
      analysis: null,
      status: input.status ?? 'empty',
      generatorId: input.generatorId ?? null,
      versions: [],
      currentVersionId: null,
      position: input.position,
      collapsed: input.collapsed ?? false,
      createdAt: ts,
      updatedAt: ts,
    }
    // 有初始内容就落一个版本，使"版本历史"从第一天起就成立
    if (node.content) {
      const version: NodeVersion = {
        id: randomUUID(),
        content: node.content,
        contentType: node.contentType,
        prompt: node.prompt,
        title: input.title,
        analysis: input.analysis ?? null,
        generatorId: node.generatorId,
        model: input.model,
        createdAt: ts,
      }
      node.versions.push(version)
      node.currentVersionId = version.id
      // 节点上的 analysis 是"当前版本"的快照，与 content / contentType 同理
      node.analysis = version.analysis ?? null
    }

    file.tree.nodes.push(node)
    if (node.parentId) {
      file.tree.edges.push({
        id: randomUUID(),
        source: node.parentId,
        target: node.id,
      })
    }
    file.project.updatedAt = ts
    this.store.write(projectId, file)
    return node
  }

  updateNode(projectId: string, nodeId: string, patch: Partial<TreeNode>): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    Object.assign(node, patch, { updatedAt: nowIso() })
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return node
  }

  /**
   * 追加一个内容版本并设为当前（"重新生成"用）。
   * 旧版本一律保留 —— 这是"可翻案"的前提。
   * 描述 / 标题 / 评估都属于"这一版"，会一并同步到节点，翻案时可整版还原。
   */
  addVersion(projectId: string, nodeId: string, input: NewVersionInput): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    const ts = nowIso()
    const version: NodeVersion = {
      id: randomUUID(),
      content: input.content,
      contentType: input.contentType ?? node.contentType,
      prompt: input.prompt ?? node.prompt,
      title: input.title,
      analysis: input.analysis ?? null,
      generatorId: input.generatorId ?? node.generatorId,
      model: input.model,
      createdAt: ts,
    }
    node.versions.push(version)
    node.currentVersionId = version.id
    node.content = version.content
    node.contentType = version.contentType
    node.analysis = version.analysis ?? null
    // 描述跟随这一版（编辑过描述再重新生成时，这里把新描述落到节点上）
    if (version.prompt !== undefined) node.prompt = version.prompt
    // 拿不到标题就沿用原显示名 —— 宁可保留已知名字，也不要退化成 prompt 派生标签
    const nextTitle = version.title?.trim()
    if (nextTitle) node.label = nextTitle
    if (version.generatorId) node.generatorId = version.generatorId
    node.status = 'done'
    node.updatedAt = ts
    file.project.updatedAt = ts
    this.store.write(projectId, file)
    return node
  }

  /**
   * "编辑描述但不生成"：只把当前版本的描述改成新值，**不追加版本、不动内容**。
   * 描述与 title/analysis 一样属于版本 → 之后翻案回旧版本时，描述会一起回退。
   * 节点还没有任何版本（空节点的描述编辑）时只改节点上的描述。
   */
  updateNodePrompt(projectId: string, nodeId: string, prompt: string): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    const ts = nowIso()
    if (node.currentVersionId) {
      const current = node.versions.find((v) => v.id === node.currentVersionId)
      if (current) current.prompt = prompt
    }
    node.prompt = prompt
    node.updatedAt = ts
    file.project.updatedAt = ts
    this.store.write(projectId, file)
    return node
  }

  /**
   * 翻案：把当前版本指回某个历史版本（不删除、不覆盖任何版本）。
   * 描述 / 标题 / 评估同属版本内容，一并还原，否则会出现"正文回到 v1、描述还停在 v2"的错位。
   */
  setCurrentVersion(projectId: string, nodeId: string, versionId: string): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    const version = node.versions.find((v) => v.id === versionId)
    if (!version) throw new Error(`Version not found: ${versionId}`)
    node.currentVersionId = version.id
    node.content = version.content
    node.contentType = version.contentType
    node.analysis = version.analysis ?? null
    // 旧数据的版本可能没有 prompt → 那就保留节点上的描述，不要清空
    if (version.prompt !== undefined) node.prompt = version.prompt
    const title = version.title?.trim()
    if (title) node.label = title
    node.generatorId = version.generatorId
    node.updatedAt = nowIso()
    file.project.updatedAt = node.updatedAt
    this.store.write(projectId, file)
    return node
  }

  removeNode(projectId: string, nodeId: string): void {
    const file = this.get(projectId)
    file.tree.nodes = file.tree.nodes.filter((n) => n.id !== nodeId)
    file.tree.edges = file.tree.edges.filter(
      (e) => e.source !== nodeId && e.target !== nodeId,
    )
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
  }

  // ---------- 收展（折叠子树） ----------
  /**
   * 设置某节点的收展状态。
   * ⚠️ 只改这一个节点的标记 —— 后代的 collapsed 各自独立保留，
   * 于是"收起 A → 展开 A"后，A 的后代里原本就是收起的那些仍保持收起（符合直觉的树行为）。
   */
  setNodeCollapsed(projectId: string, nodeId: string, collapsed: boolean): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    node.collapsed = !!collapsed
    node.updatedAt = nowIso()
    file.project.updatedAt = node.updatedAt
    this.store.write(projectId, file)
    return node
  }

  // ---------- 评论（气泡）：节点级 + 画布自由气泡 ----------
  /**
   * 在节点评论、画布评论两处定位某个 thread，返回其所在容器与下标。
   * 删除/回复/改坐标都需要先定位（thread 可能挂在节点上，也可能在画布上）。
   */
  private locateThread(
    file: ProjectFile,
    threadId: string,
  ): { container: CommentThread[]; index: number } | null {
    for (const n of file.tree.nodes) {
      const list = n.comments ?? []
      const index = list.findIndex((t) => t.id === threadId)
      if (index >= 0) return { container: list, index }
    }
    const list = file.comments ?? []
    const index = list.findIndex((t) => t.id === threadId)
    if (index >= 0) return { container: list, index }
    return null
  }

  /** 给某节点加一条评论气泡（根评论），返回新建的 thread */
  addNodeComment(projectId: string, nodeId: string, body: string): CommentThread {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    if (!Array.isArray(node.comments)) node.comments = []
    const thread: CommentThread = {
      id: randomUUID(),
      nodeId,
      body: String(body ?? '').trim(),
      createdAt: nowIso(),
      replies: [],
    }
    node.comments.push(thread)
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return thread
  }

  /** 在画布上某流坐标加一条自由气泡（根评论可为空，随后编辑） */
  addCanvasComment(projectId: string, x: number, y: number, body: string): CommentThread {
    const file = this.get(projectId)
    if (!Array.isArray(file.comments)) file.comments = []
    const thread: CommentThread = {
      id: randomUUID(),
      position: { x, y },
      body: String(body ?? '').trim(),
      createdAt: nowIso(),
      replies: [],
    }
    file.comments.push(thread)
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return thread
  }

  /** 改某条 thread 的根评论内容（画布气泡刚创建时常为空，用户随后填写） */
  updateCommentBody(projectId: string, threadId: string, body: string): CommentThread {
    const file = this.get(projectId)
    const loc = this.locateThread(file, threadId)
    if (!loc) throw new Error(`Comment thread not found: ${threadId}`)
    const thread = loc.container[loc.index]
    thread.body = String(body ?? '').trim()
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return thread
  }

  /** 给某条 thread 追加一条回复，返回更新后的 thread */
  addReply(projectId: string, threadId: string, body: string): CommentThread {
    const file = this.get(projectId)
    const loc = this.locateThread(file, threadId)
    if (!loc) throw new Error(`Comment thread not found: ${threadId}`)
    const thread = loc.container[loc.index]
    thread.replies.push({
      id: randomUUID(),
      body: String(body ?? '').trim(),
      createdAt: nowIso(),
    })
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return thread
  }

  /** 删除整条 thread（含其回复） */
  removeComment(projectId: string, threadId: string): void {
    const file = this.get(projectId)
    const loc = this.locateThread(file, threadId)
    if (!loc) return
    loc.container.splice(loc.index, 1)
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
  }

  /** 删除 thread 里的某条回复 */
  removeReply(projectId: string, threadId: string, replyId: string): void {
    const file = this.get(projectId)
    const loc = this.locateThread(file, threadId)
    if (!loc) return
    const thread = loc.container[loc.index]
    thread.replies = thread.replies.filter((r) => r.id !== replyId)
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
  }

  /** 自由气泡拖动后回写流坐标 */
  updateCommentPosition(projectId: string, threadId: string, x: number, y: number): void {
    const file = this.get(projectId)
    const loc = this.locateThread(file, threadId)
    if (!loc) return
    const thread = loc.container[loc.index]
    thread.position = { x, y }
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
  }

  // ---------- 边管理 ----------
  addEdge(projectId: string, source: string, target: string): TreeEdge {
    if (source === target) throw new Error('self-loop edge rejected')
    const file = this.get(projectId)
    if (!file.tree.nodes.some((n) => n.id === source) ||
        !file.tree.nodes.some((n) => n.id === target)) {
      throw new Error('edge endpoints must reference existing nodes')
    }
    if (file.tree.edges.some((e) => e.source === source && e.target === target)) {
      throw new Error('edge already exists')
    }
    const edge: TreeEdge = { id: randomUUID(), source, target }
    file.tree.edges.push(edge)
    const child = file.tree.nodes.find((n) => n.id === target)
    if (child) child.parentId = source
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
    return edge
  }

  removeEdge(projectId: string, edgeId: string): void {
    const file = this.get(projectId)
    file.tree.edges = file.tree.edges.filter((e) => e.id !== edgeId)
    file.project.updatedAt = nowIso()
    this.store.write(projectId, file)
  }
}
