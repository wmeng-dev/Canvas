import { randomUUID } from 'crypto'
import { JsonStore } from './store'
import type {
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
  label: string
  parentId?: string | null
  /** 生成该内容的模型名（写入首个版本） */
  model?: string
}

export interface NewVersionInput {
  content: string
  contentType?: TreeNode['contentType']
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
      generatorId: n.generatorId,
      createdAt: n.createdAt,
    })
  }
  if (!n.currentVersionId) {
    n.currentVersionId = n.versions.length ? n.versions[n.versions.length - 1].id : null
  }
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
    for (const n of file.tree.nodes) migrateNode(n)
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
      status: input.status ?? 'empty',
      generatorId: input.generatorId ?? null,
      versions: [],
      currentVersionId: null,
      position: input.position,
      createdAt: ts,
      updatedAt: ts,
    }
    // 有初始内容就落一个版本，使"版本历史"从第一天起就成立
    if (node.content) {
      const version: NodeVersion = {
        id: randomUUID(),
        content: node.content,
        contentType: node.contentType,
        generatorId: node.generatorId,
        model: input.model,
        createdAt: ts,
      }
      node.versions.push(version)
      node.currentVersionId = version.id
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
      generatorId: input.generatorId ?? node.generatorId,
      model: input.model,
      createdAt: ts,
    }
    node.versions.push(version)
    node.currentVersionId = version.id
    node.content = version.content
    node.contentType = version.contentType
    if (version.generatorId) node.generatorId = version.generatorId
    node.status = 'done'
    node.updatedAt = ts
    file.project.updatedAt = ts
    this.store.write(projectId, file)
    return node
  }

  /** 翻案：把当前版本指回某个历史版本（不删除、不覆盖任何版本）。 */
  setCurrentVersion(projectId: string, nodeId: string, versionId: string): TreeNode {
    const file = this.get(projectId)
    const node = file.tree.nodes.find((n) => n.id === nodeId)
    if (!node) throw new Error(`Node not found: ${nodeId}`)
    const version = node.versions.find((v) => v.id === versionId)
    if (!version) throw new Error(`Version not found: ${versionId}`)
    node.currentVersionId = version.id
    node.content = version.content
    node.contentType = version.contentType
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
