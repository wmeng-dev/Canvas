// C.3 核心操作：为一个父节点"发散"生成子节点并落库。
// 抽成纯函数，便于 Node 单测（IPC handler 只做一层薄包装）。

import type { AppServices } from './services'
import type { GenerateNodeRequest, GenerateNodeResult } from '../shared/ipc'

function deriveLabel(prompt: string): string {
  const firstLine = (prompt.trim().split(/\r?\n/)[0] ?? '').trim()
  const text = firstLine || '新想法'
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

export async function generateNode(
  svc: AppServices,
  req: GenerateNodeRequest,
): Promise<GenerateNodeResult> {
  const generatorId = req.generatorId || svc.defaultGeneratorId
  const generator = svc.registry.get(generatorId)
  if (!generator) throw new Error(`generator not found: ${generatorId}`)

  // 未显式给父上文时，从父节点内容推断，支持"在父节点基础上继续发散"
  let parentContext = req.parentContext
  if (!parentContext && req.parentNodeId) {
    const file = svc.repo.get(req.projectId)
    const parent = file.tree.nodes.find((n) => n.id === req.parentNodeId)
    if (parent) parentContext = parent.content || parent.prompt || parent.label
  }

  const content = await generator.generate({
    projectId: req.projectId,
    nodeId: req.parentNodeId ?? 'root',
    prompt: req.prompt,
    parentContext,
    contentType: req.contentType,
  })

  const node = svc.repo.addNode(req.projectId, {
    parentId: req.parentNodeId ?? null,
    label: deriveLabel(req.prompt),
    prompt: req.prompt,
    content: content.text,
    status: 'done',
    generatorId: generator.id,
    position: req.position,
  })

  const file = svc.repo.get(req.projectId)
  const edge = file.tree.edges.find((e) => e.target === node.id) ?? null
  return { node, edge }
}
