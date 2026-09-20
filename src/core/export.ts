// D.1 导出：把一棵创意树整理成可读文档（纯函数，可在 Node 下单测，不依赖 Electron/DOM）。
//
// 两种范围：
// - 'tree'：整棵树（按父子层级展开，呈现"发散全貌"）
// - 'path'：从根到指定节点的链路（呈现"收敛出的方案"——即最终选定的那条思路）
//
// Markdown 渲染刻意保持"可预测"，不引入 markdown 解析库：
//   markdown → 原样内联（本来就是 markdown）
//   text     → 围栏代码块（保住换行与空格）
//   html/svg → 围栏代码块（原文可复制，且不会在导出文档里被当标记执行）

import type { ContentType, ProjectFile, TreeNode } from '../shared/types'

export type ExportFormat = 'markdown' | 'html'

/** 导出范围：整棵树 / 根→选中节点的链路 */
export type ExportScope = 'tree' | 'path'

export interface ExportNode {
  id: string
  label: string
  prompt: string
  content: string
  contentType: ContentType
  /** 层级：0 = 根 */
  depth: number
  /** 当前版本序号（从 1 起）；无版本时为 0 */
  versionNumber: number
  versionCount: number
}

export interface ExportDoc {
  projectName: string
  exportedAt: string
  scope: ExportScope
  nodes: ExportNode[]
}

function toExportNode(node: TreeNode, depth: number): ExportNode {
  const idx = node.currentVersionId
    ? node.versions.findIndex((v) => v.id === node.currentVersionId)
    : -1
  return {
    id: node.id,
    label: node.label,
    prompt: node.prompt,
    content: node.content,
    contentType: node.contentType,
    depth,
    versionNumber: idx >= 0 ? idx + 1 : 0,
    versionCount: node.versions.length,
  }
}

/** 选中节点 → 根节点的链路（按根到叶顺序）。找不到时返回空数组。 */
function buildPath(file: ProjectFile, nodeId: string): ExportNode[] {
  const byId = new Map(file.tree.nodes.map((n) => [n.id, n]))
  const chain: TreeNode[] = []
  let cur = byId.get(nodeId)
  // 防御环：最多走 nodes.length 步
  let guard = file.tree.nodes.length + 1
  while (cur && guard-- > 0) {
    chain.push(cur)
    cur = cur.parentId ? byId.get(cur.parentId) : undefined
  }
  return chain.reverse().map((n, i) => toExportNode(n, i))
}

/** 整棵树 → 深度优先展开（父在前、子紧随，同级按创建时间稳定排序）。 */
function buildTree(file: ProjectFile): ExportNode[] {
  const childrenOf = new Map<string | null, TreeNode[]>()
  for (const n of file.tree.nodes) {
    const key = n.parentId
    const arr = childrenOf.get(key) ?? []
    arr.push(n)
    childrenOf.set(key, arr)
  }
  for (const arr of childrenOf.values()) {
    arr.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0))
  }

  const out: ExportNode[] = []
  const seen = new Set<string>()
  const walk = (parentId: string | null, depth: number): void => {
    for (const n of childrenOf.get(parentId) ?? []) {
      if (seen.has(n.id)) continue // 防御环
      seen.add(n.id)
      out.push(toExportNode(n, depth))
      walk(n.id, depth + 1)
    }
  }
  walk(null, 0)

  // 兜底：父子关系断裂（如父节点被删）而未被 walk 触及的节点，附在尾部（depth 0），
  // 不放到开头 —— 否则文档会以异常节点起头。
  for (const n of file.tree.nodes) {
    if (!seen.has(n.id)) out.push(toExportNode(n, 0))
  }
  return out
}

export function buildOutline(
  file: ProjectFile,
  opts: { scope: ExportScope; nodeId?: string },
  now: Date = new Date(),
): ExportDoc {
  const nodes = opts.scope === 'path' && opts.nodeId ? buildPath(file, opts.nodeId) : buildTree(file)
  return {
    projectName: file.project.name || '未命名项目',
    exportedAt: now.toISOString(),
    scope: opts.scope === 'path' && opts.nodeId ? 'path' : 'tree',
    nodes,
  }
}

/** 生成长度足够、且不会被内容里的反引号提前闭合的围栏。 */
function fence(content: string, lang: string): string {
  const runs = content.match(/`+/g) ?? []
  const longest = runs.reduce((m, r) => Math.max(m, r.length), 0)
  const bar = '`'.repeat(Math.max(3, longest + 1))
  return `${bar}${lang}\n${content}\n${bar}`
}

export function renderMarkdown(doc: ExportDoc): string {
  const scopeLabel = doc.scope === 'path' ? '收敛路径（根 → 选中节点）' : '完整发散树'
  const lines: string[] = []
  lines.push(`# ${doc.projectName}`)
  lines.push('')
  lines.push(`> 导出时间：${doc.exportedAt}　｜　范围：${scopeLabel}　｜　节点数：${doc.nodes.length}`)
  lines.push('')

  if (doc.nodes.length === 0) {
    lines.push('_（当前范围没有可导出的节点）_')
    return `${lines.join('\n')}\n`
  }

  doc.nodes.forEach((n, i) => {
    // 标题层级跟着 depth 走：根为 ##，逐级下沉，最深到 ######
    const level = Math.min(n.depth + 2, 6)
    lines.push(`${'#'.repeat(level)} ${n.label || '未命名'}`)
    lines.push('')
    if (n.prompt) {
      lines.push(`> 提示词：${n.prompt}`)
      lines.push('')
    }
    if (n.versionCount > 1) {
      lines.push(`> 版本：v${n.versionNumber}（共 ${n.versionCount} 版，历史版本未导出）`)
      lines.push('')
    }

    switch (n.contentType) {
      case 'text':
        lines.push(fence(n.content, 'text'))
        break
      case 'html':
        lines.push(fence(n.content, 'html'))
        break
      case 'svg':
        lines.push(fence(n.content, 'svg'))
        break
      case 'markdown':
      default:
        lines.push(n.content)
        break
    }
    lines.push('')

    // 顶级节点之间加分隔线，长文档更好读
    if (n.depth === 0 && i < doc.nodes.length - 1) {
      lines.push('---')
      lines.push('')
    }
  })

  return `${lines.join('\n').trimEnd()}\n`
}

const ILLEGAL = /[\\/:*?"<>|\u0000-\u001f]/g

export function suggestedFileName(doc: ExportDoc, format: ExportFormat): string {
  const base = doc.projectName.replace(ILLEGAL, '_').replace(/\s+/g, ' ').trim() || '发散创意画布'
  const stamp = doc.exportedAt.slice(0, 10)
  const scopeTag = doc.scope === 'path' ? '_收敛路径' : ''
  const ext = format === 'html' ? 'html' : 'md'
  return `${base}${scopeTag}_${stamp}.${ext}`
}
