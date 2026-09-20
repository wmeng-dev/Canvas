// 预览面板里的「发散评估」完整版：可行性（百分比 + 高/中/低色条）+ 优点 / 缺点 / 风险全量列表。
// 卡片（IdeaNode）上是紧缩版（每项只显示首条），这里是完整版，两者共用 shared/analysis 的分档与配色。
// 没有评估数据时整体不渲染 —— 旧节点、或第三方 MCP 后端给不出结构化字段时不显示空盒子。

import { feasibilityBand, hasAnalysis } from '../../shared/analysis'
import type { IdeaAnalysis } from '../../shared/types'

const MUTED = '#7d8590'

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
    <div data-testid={testId} data-count={items.length} style={{ marginTop: 8 }}>
      <div style={{ fontSize: 11, fontWeight: 600, color, marginBottom: 3 }}>{name}</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {items.map((it, i) => (
          <li
            key={`${testId}-${i}`}
            style={{ fontSize: 12.5, lineHeight: 1.6, color: '#c9d1d9', display: 'flex', gap: 6 }}
          >
            <span style={{ color, flex: '0 0 auto' }}>·</span>
            <span style={{ minWidth: 0 }}>{it}</span>
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
      style={{
        background: '#161b22',
        border: '1px solid #21262d',
        borderRadius: 8,
        padding: '10px 12px',
        marginBottom: 14,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontSize: 11, color: MUTED }}>可行性</span>
        <span
          data-testid="preview-feasibility"
          style={{ fontSize: 18, fontWeight: 700, lineHeight: 1, color: band.color }}
        >
          {analysis.feasibility}%
        </span>
        <span
          style={{
            fontSize: 11,
            color: band.color,
            border: `1px solid ${band.color}`,
            borderRadius: 10,
            padding: '0 7px',
          }}
        >
          {band.label}
        </span>
        <span
          style={{
            flex: '1 1 90px',
            minWidth: 90,
            height: 6,
            borderRadius: 3,
            background: '#30363d',
            overflow: 'hidden',
          }}
        >
          <span
            style={{
              display: 'block',
              width: `${analysis.feasibility}%`,
              height: '100%',
              borderRadius: 3,
              background: band.color,
            }}
          />
        </span>
      </div>
      <Group name="优点" color="#3fb950" items={analysis.pros} testId="preview-pros" />
      <Group name="缺点" color="#d29922" items={analysis.cons} testId="preview-cons" />
      <Group name="风险" color="#f85149" items={analysis.risks} testId="preview-risks" />
    </div>
  )
}
