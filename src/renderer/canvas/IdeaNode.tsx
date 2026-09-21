// D.7 自定义节点卡片：显示**发散结果标题**（而不是用户当初输入的那句话）
// + 可行性概率（百分比 + 高/中/低色条）+ 优点 / 缺点 / 风险**全部条目**。
//
// ⚠️ 两个必须照抄默认节点的地方（否则会静默出问题）：
//   1. `<Handle type="target" position={Position.Top}>` 与
//      `<Handle type="source" position={Position.Bottom}>` 必须都在 ——
//      React Flow 的默认节点自带这两个 Handle，换成自定义节点后
//      **不自己补回来，所有连线都会消失**（边的两端要靠 Handle 的测量结果定位）。
//   2. 节点尺寸变了，兄弟间距必须同步调整，见 store/treeStore.ts 的
//      ROOT_SPACING_Y / CHILD_SPACING_Y（X 方向见 IDEA_NODE_WIDTH 与 CHILD_SPACING_X）。
// 原始输入不丢弃：挂在卡片 title 上，鼠标悬停可见；预览面板里也有一行。

import { Handle, Position, type NodeProps } from '@xyflow/react'
import type { CreativeNode } from '../store/treeStore'
import { feasibilityBand, hasAnalysis } from '../../shared/analysis'
import type { IdeaAnalysis } from '../../shared/types'

/** 卡片宽度：布局（computePosition 的 x 偏移）按这个宽度留的余量 */
export const IDEA_NODE_WIDTH = 260

/**
 * 卡片**统一最小高度**（对比用的关键）：三组要点全展开后条数 2~3 条不等，
 * 高度会参差；给一个统一下限让所有卡片高度一致，横向/纵向扫视时行是对齐的。
 * 取值按"3 组 × 每条 1 行"的最坏情况预留（详见下方 MAX_ITEMS_PER_GROUP 的说明）。
 */
export const IDEA_NODE_MIN_HEIGHT = 300

/**
 * ⚠️ 卡片还能长多高，取决于生成侧的内容契约：`core/generator/direct/deepseek.ts`
 * 的提示词明确要求 **pros / cons / risks 各 2~3 条、每条不超过 20 字**。
 * 所以最坏情况是 3×3 = 9 行要点；又因为 20 字在 260px 宽（内容区约 228px）下
 * 正好排得下 1 行（11.5px × 20 ≈ 230px），行数≈条数，高度是**有上界的**。
 * ⇒ 才敢用固定 MIN_HEIGHT + 固定间距常量，而不必去测量回流（那会牵扯动态重排）。
 * 卡片的间距常量见 treeStore 的 ROOT_SPACING_Y / CHILD_SPACING_Y
 * 与 core/generate-node.ts 的 SIBLING_SPACING_Y，三者必须一起改。
 */
export const MAX_ITEMS_PER_GROUP = 3

const MUTED = '#57606a'
const TEXT = '#24292f'

/**
 * 一组要点：**全部条目都渲染出来**（对比用，不做"只显示首条 + 等N条"的截断）。
 * `data-count` 保留（探针按它校验条数与落库一致）。
 */
function ItemGroup({
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
    <div data-testid={testId} data-count={items.length} style={{ marginTop: 6 }}>
      <div style={{ fontSize: 10.5, lineHeight: 1.3, fontWeight: 600, color }}>{name}</div>
      <ul style={{ margin: '2px 0 0', padding: 0, listStyle: 'none' }}>
        {items.map((item, i) => (
          <li
            key={`${i}:${item}`}
            style={{
              display: 'flex',
              gap: 4,
              fontSize: 11.5,
              lineHeight: 1.35,
              color: TEXT,
            }}
          >
            <span style={{ flex: '0 0 auto', color }}>·</span>
            <span style={{ flex: '1 1 auto', minWidth: 0, wordBreak: 'break-word' }}>{item}</span>
          </li>
        ))}
      </ul>
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
        minHeight: showAnalysis ? IDEA_NODE_MIN_HEIGHT : undefined,
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
          <div style={{ marginTop: 6, borderTop: '1px solid #eaeef2', paddingTop: 1 }}>
            <ItemGroup name="优点" color="#1a7f37" items={analysis.pros} testId="idea-pros" />
            <ItemGroup name="缺点" color="#9a6700" items={analysis.cons} testId="idea-cons" />
            <ItemGroup name="风险" color="#cf222e" items={analysis.risks} testId="idea-risks" />
          </div>
        </>
      )}

      <Handle type="source" position={Position.Bottom} isConnectable={isConnectable} />
    </div>
  )
}
