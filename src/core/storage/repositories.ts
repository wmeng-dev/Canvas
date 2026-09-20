import { randomUUID } from 'crypto'
import { JsonStore } from './store'
import type { Project, ProjectFile, TreeNode, TreeEdge } from '../../shared/types'

function nowIso(): string {
  return new Date().toISOString()
}

export type NewNodeInput = Partial<TreeNode> & {
  label: string
  parentId?: string | null
}

/**
 * 高层仓储：项目 / 节点 / 边的 CRUD。
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
    return this.store.read<ProjectFile>(id)
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
      status: input.status ?? 'empty',
      generatorId: input.generatorId ?? null,
      position: input.position,
      createdAt: ts,
      updatedAt: ts,
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
