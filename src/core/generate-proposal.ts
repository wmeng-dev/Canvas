// 沿"根 → 选中节点"的链路生成一份方案，并把方案作为**方案节点**挂到链条末端。
//
// 与其它生成操作的差别：
//   - 发散（generate-node）：拿着一句话生成 N 条**并列**的想法；
//   - 本文件：拿着**一条收敛链路上的全部已有成果**生成一份**成文方案**（把前面几层的取舍都算进去）。
// 抽成纯函数（只依赖 AppServices），便于 Node 单测；IPC handler 只做一层薄包装。

import type { AppServices } from './services'
import type { Generator } from './generator/types'
import type { TreeNode, TreeEdge } from '../shared/types'
import type { GenerateProposalRequest, GenerateProposalResponse } from '../shared/ipc'
import { collectChainIds } from '../shared/tree'
import { hasAnalysis } from '../shared/analysis'

/** 单个方案节点的显示名前缀（一眼区分"这是方案"而不是又一个想法） */
const PROPOSAL_LABEL_PREFIX = '方案：'

/** 链路里每层最多取多少字进提示词（防止深层链路把上下文撑爆） */
const LAYER_CONTENT_LIMIT = 400

function pickGenerator(svc: AppServices, generatorId?: string): Generator {
  const id = generatorId || svc.defaultGeneratorId
  const generator = svc.registry.get(id)
  if (!generator) throw new Error(`generator not found: ${id}`)
  return generator
}

function clip(text: string, limit: number): string {
  const t = (text ?? '').trim()
  if (t.length <= limit) return t
  return `${t.slice(0, limit)}…`
}

/**
 * 把链路上每一层拼成给模型的提示词。
 *
 * 为什么每层都带上"可行性 + 优点/缺点/风险"而不是只带正文：
 * 发散阶段已经逐层做过取舍，方案要**承接这些取舍**（沿用优点、规避缺点、对冲风险），
 * 只喂正文的话模型等于从头再来一遍，前面几层的工作就白做了。
 */
export function buildProposalPrompt(
  layers: { label: string; prompt?: string; content?: string; analysis?: TreeNode['analysis'] }[],
): string {
  const body = layers
    .map((n, i) => {
      const head = `【第 ${i + 1} 层｜${n.label || '未命名'}】`
      const desc = n.prompt?.trim() ? `原始描述：${clip(n.prompt, 200)}` : ''
      const detail: string[] = []
      const a = n.analysis ?? null
      if (a && hasAnalysis(a)) {
        detail.push(`可行性：${a.feasibility}%`)
        if (a.pros?.length) detail.push(`优点：${a.pros.join('；')}`)
        if (a.cons?.length) detail.push(`缺点：${a.cons.join('；')}`)
        if (a.risks?.length) detail.push(`风险：${a.risks.join('；')}`)
      }
      const text = n.content?.trim() ? `内容：${clip(n.content, LAYER_CONTENT_LIMIT)}` : ''
      return [head, desc, ...detail, text].filter(Boolean).join('\n')
    })
    .join('\n\n')

  return [
    '下面是用户在发散画布上，从最初的主题一路收敛到当前方向的一条完整链路（第 1 层是主题，最后一层是当前选中的方向）。',
    '',
    body,
    '',
    '请基于这条链路产出一份**可落地的方案**，用 Markdown 输出，包含：',
    '1. 一句话结论（这条链路最终要做成什么）',
    '2. 目标与成功标准',
    '3. 方案要点（分条，每条说清楚"做什么 + 为什么"）',
    '4. 实施步骤（按时间顺序，标注关键里程碑）',
    '5. 风险与应对（**必须逐条回应链路上已经识别出的缺点与风险**）',
    '6. 需要的资源 / 前置条件',
    '',
    '要求：结论明确、可直接执行；不要复述链路内容，也不要泛泛而谈。',
  ].join('\n')
}

/**
 * 沿"根 → 目标节点"的链路生成方案，并把结果建成一个挂在该节点下的方案节点。
 *
 * ⚠️ 挂在**链条末端**（而不是根节点下）：方案是这条链路的收敛产物，
 * 挂回根下会和链路本身混在一起，看不出它是从哪条链收出来的。
 */
export async function generateProposal(
  svc: AppServices,
  req: GenerateProposalRequest,
): Promise<GenerateProposalResponse> {
  const generator = pickGenerator(svc, req.generatorId)
  const file = svc.repo.get(req.projectId)
  const target = file.tree.nodes.find((n) => n.id === req.nodeId)
  if (!target) throw new Error(`node not found: ${req.nodeId}`)

  const byId = new Map(file.tree.nodes.map((n) => [n.id, n]))
  const chain = collectChainIds(file.tree.nodes, req.nodeId)
    .map((id) => byId.get(id))
    .filter((n): n is TreeNode => !!n)
  if (chain.length === 0) throw new Error(`node not found: ${req.nodeId}`)

  const prompt = buildProposalPrompt(chain)
  const content = await generator.generate({
    projectId: req.projectId,
    nodeId: target.id,
    prompt,
    parentContext: target.content || target.prompt || target.label,
    contentType: 'markdown',
  })

  const node = svc.repo.addNode(req.projectId, {
    parentId: target.id,
    kind: 'proposal',
    // 方案节点的名字要能看出"它是哪条链收出来的"
    label: `${PROPOSAL_LABEL_PREFIX}${clip(target.label || '未命名', 20)}`,
    title: content.title,
    prompt,
    content: content.text,
    contentType: content.contentType,
    status: 'done',
    generatorId: generator.id,
    model: content.model,
    position: req.position,
  })
  const after = svc.repo.get(req.projectId)
  const edge: TreeEdge | null = after.tree.edges.find((e) => e.target === node.id) ?? null

  return { node, edge, chainLength: chain.length }
}
