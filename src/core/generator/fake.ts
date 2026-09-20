// 确定性占位生成器：不联网、不依赖 key。
// 用于：无可用 AI 后端时的兜底、以及 E2E/单测中替代真实生成。

import type { Generator, NodeContent, NodeSpec } from './types'

export function createFakeGenerator(
  id = 'fake',
  label = '本地占位生成器',
): Generator {
  return {
    id,
    label,
    kind: 'direct',
    async generate(spec: NodeSpec): Promise<NodeContent> {
      const subject = spec.prompt.trim() || '（空提示）'
      const parent = spec.parentContext ? `\n\n> 基于父节点：${spec.parentContext}` : ''
      return {
        contentType: spec.contentType ?? 'markdown',
        text: `# ${subject}\n\n- 占位内容 1\n- 占位内容 2\n- 占位内容 3${parent}\n`,
        model: 'fake',
        finishedAt: new Date().toISOString(),
      }
    },
  }
}
