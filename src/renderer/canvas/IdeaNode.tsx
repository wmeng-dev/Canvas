// D.7 自定义节点卡片：显示**发散结果标题**（而不是用户当初输入的那句话）
// + 可行性概率（百分比 + 高/中/低色条）+ 优点 / 缺点 / 风险各一行。
//
// ⚠️ 两个必须照抄默认节点的地方（否则会静默出问题）：
//   1. `<Handle type="target" position={Position.Top}>` 与
//      `<Handle type="source" position={Position.Bottom}>` 必须都在 ——
//      React Flow 的默认节点自带这两个 Handle，换成自定义节点后
//      **不自己补回来，所有连线都会消失**（边的两端要靠 Handle 的测量结果定位）。
//   2. 节点尺寸变了（比默认单行节点高得多），兄弟间距必须同步调整，
//      见 store/treeStore.ts 的 ROOT_SPACING_Y / CHILD_SPACING_Y。
// 原始输入不丢弃：挂在卡片 title 上，鼠标悬停可见；预览面板里也有一行。

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CreativeNode } from '../store/treeStore'
import { feasibilityBand, hasAnalysis } from '../../shared/analysis'
import type { IdeaAnalysis } from '../../shared/types'

/** 卡片宽度：布局（computePosition 的 x 偏移）按这个宽度留的余量 */
export const IDEA_NODE_WIDTH = 260

const MUTED = '#57606a'
const TEXT = '#24292f'

/** 一行要点：名称 + 首条内容（放不下就省略号），多出来的条数用 等N条 提示 */
function ItemRow({
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
  const rest = items.length - 1
  return (
    <div
      data-testid={testId}
      data-count={items.length}
      style={{ display: 'flex', alignItems: 'baseline', gap: 5, marginTop: 3, minWidth: 0 }}
    >
      <span style={{ flex: '0 0 auto', fontSize: 10.5, fontWeight: 600, color }}>{name}</span>
      <span
        title={items.join('\n')}
        style={{
          flex: '1 1 auto',
          minWidth: 0,
          fontSize: 11.5,
          lineHeight: 1.4,
          color: TEXT,
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap',
        }}
      >
        {items[0]}
      </span>
      {rest > 0 && (
        <span style={{ flex: '0 0 auto', fontSize: 10.5, color: MUTED }}>等{items.length}条</span>
      )}
    </div>
  )
}

function FeasibilityRow({ analysis }: { analysis: IdeaAnalysis }) {
  const band = feasibilityBand(analysis.feasibility)
  return (
    <div
      data-testid="idea-feasibility"
      data-feasibility={analysis.feasibility}
      data-band={band.key}
      style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 7 }}
    >
      <span style={{ fontSize: 10.5, color: MUTED, flex: '0 0 auto' }}>可行性</span>
      <span style={{ fontSize: 14, fontWeight: 700, lineHeight: 1, color: band.color }}>
        {analysis.feasibility}%
      </span>
      <span
        style={{
          fontSize: 10,
          lineHeight: 1.5,
          color: band.color,
          border: `1px solid ${band.color}`,
          borderRadius: 9,
          padding: '0 6px',
          flex: '0 0 auto',
        }}
      >
        {band.label}
      </span>
      <span
        style={{
          flex: '1 1 auto',
          minWidth: 24,
          height: 5,
          borderRadius: 3,
          background: '#eaeef2',
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
  )
}

export function IdeaNode({ data, selected, isConnectable }: NodeProps<CreativeNode>) {
  const analysis = data.analysis ?? null
  const showAnalysis = hasAnalysis(analysis)
  const tooltip = data.prompt ? `原始描述：${data.prompt}` : undefined

  return (
    <div
      data-testid="idea-node"
      data-has-analysis={showAnalysis ? '1' : '0'}
      title={tooltip}
      style={{
        width: IDEA_NODE_WIDTH,
        boxSizing: 'border-box',
        background: '#ffffff',
        color: TEXT,
        border: `1px solid ${selected ? '#1f6feb' : '#d0d7de'}`,
        borderRadius: 8,
        padding: '9px 11px 10px',
        boxShadow: selected
          ? '0 0 0 2px rgba(31, 111, 235, 0.35)'
          : '0 1px 4px rgba(0, 0, 0, 0.4)',
      }}
    >
      <Handle type="target" position={Position.Top} isConnectable={isConnectable} />

      <div
        data-testid="idea-title"
        style={{
          fontSize: 13,
          fontWeight: 600,
          lineHeight: 1.35,
          color: '#0d1117',
          display: '-webkit-box',
          WebkitLineClamp: 2,
          WebkitBoxOrient: 'vertical',
          overflow: 'hidden',
        }}
      >
        {data.label}
      </div>

      {analysis && showAnalysis && (
        <>
          <FeasibilityRow analysis={analysis} />
          <div style={{ marginTop: 6, borderTop: '1px solid #eaeef2', paddingTop: 3 }}>
            <ItemRow name="优点" color="#1a7f37" items={analysis.pros} testId="idea-pros" />
            <ItemRow name="缺点" color="#9a6700" items={analysis.cons} testId="idea-cons" />
            <ItemRow name="风险" color="#cf222e" items={analysis.risks} testId="idea-risks" />
          </div>
        </>
      )}

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}
