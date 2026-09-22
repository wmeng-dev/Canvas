// 预览面板里的「发散评估」完整版：可行性（百分比 + 高/中/低色条）+ 优点 / 缺点 / 风险全量列表。
// 卡片（IdeaNode）上是紧缩版（每项只显示首条），这里是完整版，两者共用 shared/analysis 的分档与配色。
// 没有评估数据时整体不渲染 —— 旧节点、或第三方 MCP 后端给不出结构化字段时不显示空盒子。
//
// 样式：静态外观走 .analysis*（styles.css），**只有分档颜色**留内联 —— 它来自
// feasibilityBand / Group 的 color 入参（数据驱动），写进 CSS 就成了改不动的死值。

import { feasibilityBand, hasAnalysis } from '../../shared/analysis'
import type { IdeaAnalysis } from '../../shared/types'

function Group({
  name,
  color,
  items,
  testId,
}: {
  name: string
  color: string
  items: string[]
  testId: string
}) {
  if (items.length === 0) return null
  return (
    <div data-testid={testId} data-count={items.length} className="analysis__group">
      <div className="analysis__group-name" style={{ color }}>
        {name}
      </div>
      <ul className="analysis__group-list">
        {items.map((it, i) => (
          <li key={`${testId}-${i}`} className="analysis__group-item">
            <span className="analysis__bullet" style={{ color }}>
              ·
            </span>
            <span className="analysis__text">{it}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

export function AnalysisBlock({ analysis }: { analysis: IdeaAnalysis | null | undefined }) {
  if (!hasAnalysis(analysis)) return null
  const band = feasibilityBand(analysis.feasibility)
  return (
    <div
      data-testid="preview-analysis"
      data-feasibility={analysis.feasibility}
      data-band={band.key}
      className="analysis"
    >
      <div className="analysis__head">
        <span className="analysis__label">可行性</span>
        <span
          data-testid="preview-feasibility"
          className="analysis__score"
          style={{ color: band.color }}
        >
          {analysis.feasibility}%
        </span>
        <span className="analysis__band" style={{ color: band.color, borderColor: band.color }}>
          {band.label}
        </span>
        <span className="analysis__bar">
          <span
            className="analysis__bar-fill"
            style={{ width: `${analysis.feasibility}%`, background: band.color }}
          />
        </span>
      </div>
      <Group name="优点" color="#3fb950" items={analysis.pros} testId="preview-pros" />
      <Group name="缺点" color="#d29922" items={analysis.cons} testId="preview-cons" />
      <Group name="风险" color="#f85149" items={analysis.risks} testId="preview-risks" />
    </div>
  )
}
