// C.3/C.5 核心操作：发散子节点 / 重新生成（新版本） / 翻案。
// 抽成纯函数（只依赖 AppServices），便于 Node 单测；IPC handler 只做一层薄包装。

import type { AppServices } from './services'
import type { Generator } from './generator/types'
import type { TreeNode } from '../shared/types'
import type {
  GenerateChildrenResponse,
  GenerateNodeRequest,
  GenerateNodeResult,
  RegenerateNodeRequest,
} from '../shared/ipc'
import { mapWithConcurrencySettled } from './concurrency'

export const MAX_GENERATE_COUNT = 5
/** 同批子节点的纵向间距（与渲染端 computePosition 的基础间距保持一致） */
const SIBLING_SPACING_Y = 200
/** 并发上限：一次发散 N 条时同时打到后端的请求数 */
export const GENERATE_CONCURRENCY = 2

/**
 * 从 prompt 派生一个短标签 —— **只在生成器给不出结果标题时兜底**
 * （第三方 MCP 后端返回纯文本、或模型输出没解析出 title）。
 */
export function deriveLabel(prompt: string): string {
  const firstLine = (prompt.trim().split(/\r?\n/)[0] ?? '').trim()
  const text = firstLine || '新想法'
  return text.length > 24 ? `${text.slice(0, 24)}…` : text
}

/**
 * 节点显示名 = **发散结果标题**，而不是用户输入的那句话。
 * 拿不到标题才回落到 prompt 派生标签（此时与旧行为一致）。
 */
function displayLabel(title: string | undefined, prompt: string): string {
  const t = (title ?? '').trim()
  return t || deriveLabel(prompt)
}

function pickGenerator(svc: AppServices, generatorId?: string): Generator {
  const id = generatorId || svc.defaultGeneratorId
  const generator = svc.registry.get(id)
  if (!generator) throw new Error(`generator not found: ${id}`)
  return generator
}

/** 未显式给父上文时，从父节点内容推断，支持"在父节点基础上继续发散" */
function inferParentContext(svc: AppServices, projectId: string, parentNodeId: string | null): string | undefined {
  if (!parentNodeId) return undefined
  const file = svc.repo.get(projectId)
  const parent = file.tree.nodes.find((n) => n.id === parentNodeId)
  return parent ? parent.content || parent.prompt || parent.label : undefined
}

/**
 * 发散：为某个父节点生成 count 个子节点并落库。
 * - 受 GENERATE_CONCURRENCY 限制并发
 * - 单条失败不拖垮整批（成功照常入库，失败逐条回报）
 */
export async function generateNode(
  svc: AppServices,
  req: GenerateNodeRequest,
): Promise<GenerateChildrenResponse> {
  const generator = pickGenerator(svc, req.generatorId)
  const count = Math.max(1, Math.min(Math.floor(req.count ?? 1), MAX_GENERATE_COUNT))
  const parentContext = req.parentContext ?? inferParentContext(svc, req.projectId, req.parentNodeId)
  const prompts = Array.from({ length: count }, (_, i) => (count === 1 ? req.prompt : `${req.prompt}（方向 ${i + 1}）`))

  const settled = await mapWithConcurrencySettled(prompts, GENERATE_CONCURRENCY, async (prompt, index) => {
    const content = await generator.generate({
      projectId: req.projectId,
      nodeId: req.parentNodeId ?? 'root',
      prompt,
      parentContext,
      contentType: req.contentType,
    })
    const node = svc.repo.addNode(req.projectId, {
      parentId: req.parentNodeId ?? null,
      // 显示名用"发散结果标题"，绝不直接显示用户输入的那句话
      label: displayLabel(content.title, prompt),
      title: content.title,
      analysis: content.analysis ?? null,
      prompt,
      content: content.text,
      contentType: content.contentType,
      status: 'done',
      generatorId: generator.id,
      model: content.model,
      position: req.position
        ? { x: req.position.x, y: req.position.y + index * SIBLING_SPACING_Y }
        : undefined,
    })
    const file = svc.repo.get(req.projectId)
    const edge = file.tree.edges.find((e) => e.target === node.id) ?? null
    return { node, edge } satisfies GenerateNodeResult
  })

  const items: GenerateNodeResult[] = []
  const failures: { prompt: string; error: string }[] = []
  settled.forEach((r, i) => {
    if (r.ok) items.push(r.value)
    else failures.push({ prompt: prompts[i], error: r.error })
  })

  // 全部失败 → 直接抛错，让上层显示错误（部分成功则返回，由 UI 提示）
  if (items.length === 0 && failures.length > 0) {
    throw new Error(failures[0].error)
  }
  return { items, failures }
}

/**
 * 重新生成：为**已存在**节点再产出一版内容，追加为新版本。
 * 旧版本保留 → 可翻案回退。标题与评估跟随"这一版"一起换（翻案时整版还原），
 * 所以节点显示名会随之更新；拿不到新标题则沿用原名。
 */
export async function regenerateNode(
  svc: AppServices,
  req: RegenerateNodeRequest,
): Promise<TreeNode> {
  const generator = pickGenerator(svc, req.generatorId)
  const file = svc.repo.get(req.projectId)
  const node = file.tree.nodes.find((n) => n.id === req.nodeId)
  if (!node) throw new Error(`node not found: ${req.nodeId}`)

  const prompt = (req.prompt ?? node.prompt ?? node.label).trim()
  const parent = node.parentId ? file.tree.nodes.find((n) => n.id === node.parentId) : undefined
  const parentContext = parent ? parent.content || parent.prompt || parent.label : undefined

  const content = await generator.generate({
    projectId: req.projectId,
    nodeId: node.id,
    prompt,
    parentContext,
    contentType: req.contentType ?? node.contentType,
  })

  return svc.repo.addVersion(req.projectId, node.id, {
    content: content.text,
    contentType: content.contentType,
    title: content.title,
    analysis: content.analysis ?? null,
    generatorId: generator.id,
    model: content.model,
  })
}
