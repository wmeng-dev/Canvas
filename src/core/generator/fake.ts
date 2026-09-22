// 确定性占位生成器：不联网、不依赖 key。
// 用于：无可用 AI 后端时的兜底、以及 E2E/单测中替代真实生成。
//
// 按 contentType 产出对应形态的内容，使 C.4 的多类型预览在无真实模型时也可演示/验证。
// 测试钩子：IDEASPROUT_FAKE_ECHO=1 时把 prompt **原样（不转义）** 嵌进内容模板里，
// 用于验证 HTML/SVG 沙箱是否真的挡住脚本（正常模式下 prompt 会被转义）。

import type { Generator, NodeContent, NodeSpec } from './types'
import type { ContentType, IdeaAnalysis } from '../../shared/types'
import { clampFeasibility, MAX_TITLE_LENGTH, truncate } from '../../shared/analysis'

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

const LIST_ITEMS = ['占位内容 1', '占位内容 2', '占位内容 3']

/**
 * 占位"结果标题"：**刻意不复述用户输入**，用来验证"节点显示的是发散结果标题而不是原描述"。
 * 带序号，让"重新生成"产出的每一版标题可区分。
 */
function fakeTitle(prompt: string, seq: number): string {
  const short = truncate(prompt.replace(/\s+/g, ' '), 16)
  return truncate(`发散方案 #${seq}：${short}`, MAX_TITLE_LENGTH)
}

/**
 * 占位评估：可行性与 prompt / 版本号相关，保证确定性又逐版可区分；
 * 三条要点用固定短句，便于探针稳定断言。
 */
function fakeAnalysis(prompt: string, seq: number): IdeaAnalysis {
  const base = 55 + ((prompt.length * 7 + seq * 13) % 40)
  return {
    feasibility: clampFeasibility(base),
    pros: ['实现成本可控', '与父节点方向一致', '可小步验证'],
    cons: ['差异化不够突出', '依赖上游数据质量'],
    risks: ['前提不成立时整体失效', '并行推进可能摊薄投入'],
  }
}

function markdownHeading(subject: string, seq: number): string {
  // 注意：markdown 预览不解析内嵌 HTML（安全取舍），所以版本标记必须用 markdown 原生语法，
  // 否则 <sub> 会原样显示出来。
  return `# ${subject}\n\n${LIST_ITEMS.map((i) => `- ${i}`).join('\n')}\n\n*（占位生成 #${seq}）*`
}

function plainText(subject: string, seq: number): string {
  return `${subject}\n\n${LIST_ITEMS.join('\n')}\n\n占位生成 #${seq}`
}

function htmlBody(subject: string, seq: number): string {
  return `<!doctype html><meta charset="utf-8">
<style>
  body { font-family: system-ui, "Microsoft YaHei", sans-serif; margin: 0; padding: 14px; color: #111; }
  h1 { font-size: 17px; margin: 0 0 10px; }
  ul { padding-left: 20px; margin: 0; }
  footer { margin-top: 10px; font-size: 11px; color: #666; }
</style>
<h1>${subject}</h1>
<ul>${LIST_ITEMS.map((i) => `<li>${i}</li>`).join('')}</ul>
<footer>占位生成 #${seq}</footer>`
}

function svgBody(label: string, seq: number, extraRaw: string): string {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 360 200" width="100%" height="100%">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#1f6feb"/>
      <stop offset="100%" stop-color="#8957e5"/>
    </linearGradient>
  </defs>
  <rect x="8" y="8" width="344" height="184" rx="14" fill="url(#g)"/>
  <circle cx="76" cy="76" r="30" fill="#ffffff" fill-opacity="0.85"/>
  <text x="180" y="120" text-anchor="middle" font-family="system-ui, sans-serif" font-size="16" fill="#ffffff">${label}</text>
  <text x="180" y="146" text-anchor="middle" font-family="system-ui, sans-serif" font-size="12" fill="#ffffff" fill-opacity="0.8">SVG 占位生成 #${seq}</text>
  ${extraRaw}
</svg>`
}

export function createFakeGenerator(
  id = 'fake',
  label = '本地占位生成器',
): Generator {
  const echo = process.env.IDEASPROUT_FAKE_ECHO === '1'
  // 每次生成递增：让"重新生成"产出的版本彼此可区分（真实模型也不会两次完全一样）
  let seq = 0

  return {
    id,
    label,
    kind: 'direct',
    async generate(spec: NodeSpec): Promise<NodeContent> {
      const n = ++seq
      const type: ContentType = spec.contentType ?? 'markdown'
      const raw = spec.prompt.trim() || '（空提示）'
      // 正常模式转义；echo 模式保持原样（供沙箱安全性测试注入真载荷）
      const subject = echo ? raw : escapeHtml(raw)
      const parentRaw = spec.parentContext ?? ''
      const parentSafe = echo ? parentRaw : escapeHtml(parentRaw)

      // 主题请求（见 core/theme.ts 的 suggestTheme）：真实模型会返回"一句短主题"，
      // 而占位器只会原样复述我们那段提示词 —— 直接返回会变成一坨没意义的文字。
      // 所以这里给一句确定性的短主题：既让开发态看得下去，也让探针能稳定断言。
      if (spec.nodeId === 'theme') {
        const theme = `占位主题 #${n}`
        return {
          contentType: 'text',
          text: theme,
          title: theme,
          model: 'fake',
          finishedAt: new Date().toISOString(),
        }
      }

      let text: string
      switch (type) {
        case 'html': {
          const quote = parentRaw
            ? `<blockquote style="margin:10px 0 0;padding:6px 10px;border-left:3px solid #999;color:#444;font-size:12px">基于父节点：${parentSafe}</blockquote>`
            : ''
          text = htmlBody(subject, n).replace('</footer>', `</footer>${quote}`)
          break
        }
        case 'svg': {
          const short = raw.length > 22 ? `${raw.slice(0, 22)}…` : raw
          const extra = echo && /[<>&]/.test(raw) ? raw : ''
          text = svgBody(escapeHtml(short), n, extra)
          break
        }
        case 'text':
          text = `${plainText(subject, n)}${parentRaw ? `\n\n基于父节点：${parentSafe}` : ''}`
          break
        case 'markdown':
        default:
          text = `${markdownHeading(subject, n)}${parentRaw ? `\n\n> 基于父节点：${parentSafe}` : ''}`
          break
      }

      return {
        contentType: type,
        text,
        title: fakeTitle(raw, n),
        analysis: fakeAnalysis(raw, n),
        model: 'fake',
        finishedAt: new Date().toISOString(),
      }
    },
  }
}
