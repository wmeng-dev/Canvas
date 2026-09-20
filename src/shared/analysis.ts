// 发散评估的纯函数与常量：可行性概率的夹紧 / 高·中·低分档 / 颜色 / 展示规范化。
//
// 放 shared 是因为它被三处共用，必须只有一份实现（否则卡片、预览、导出会各说各话）：
//   - core/export.ts 与 renderer/export/standaloneHtml.tsx（导出文档）
//   - renderer/canvas/IdeaNode.tsx、renderer/panels/PreviewPanel.tsx（界面）
//   - tests/*.test.cjs（Node 单测）
// 不含任何 Node / DOM API。

import type { IdeaAnalysis } from './types'

/** 各维度最多展示/保留几条（模型偶尔会一口气列十条，卡片和文档都会被撑爆） */
export const MAX_ANALYSIS_ITEMS = 3

/** 单条要点最长字符数，超出截断（卡片一行放不下、导出文档也更好读） */
export const MAX_ITEM_LENGTH = 40

/** 结果标题最长字符数 */
export const MAX_TITLE_LENGTH = 40

export type FeasibilityBandKey = 'high' | 'mid' | 'low'

export interface FeasibilityBand {
  key: FeasibilityBandKey
  label: string
  /** 界面用色（同时用于进度条与档位标签） */
  color: string
  /** 该档位的下界（含） */
  min: number
}

/** 从高到低排列，便于按顺序取第一个满足 min 的档位 */
export const FEASIBILITY_BANDS: FeasibilityBand[] = [
  { key: 'high', label: '高', color: '#3fb950', min: 70 },
  { key: 'mid', label: '中', color: '#d29922', min: 40 },
  { key: 'low', label: '低', color: '#f85149', min: 0 },
]

/** 任意取值 → 0-100 整数（直接消费模型输出，容错常见写法） */
export function clampFeasibility(v: unknown): number {
  let n: number
  if (typeof v === 'number') {
    n = v
  } else if (typeof v === 'string') {
    // 容错："78%" / "约 78" / "0.78"
    const m = v.match(/-?\d+(\.\d+)?/)
    n = m ? Number(m[0]) : NaN
    // 没写 % 且是 0~1 之间的小数 → 当作比例（模型偶尔会用 0.78 表示 78%）
    if (Number.isFinite(n) && n > 0 && n < 1 && !v.includes('%')) n *= 100
  } else {
    n = NaN
  }
  if (!Number.isFinite(n)) return 0
  return Math.max(0, Math.min(100, Math.round(n)))
}

/** 可行性概率 → 高 / 中 / 低 档位（含颜色与文案） */
export function feasibilityBand(v: number): FeasibilityBand {
  const n = clampFeasibility(v)
  return FEASIBILITY_BANDS.find((b) => n >= b.min) ?? FEASIBILITY_BANDS[FEASIBILITY_BANDS.length - 1]
}

/** 截断到 max 字符，超出加省略号 */
export function truncate(s: string, max: number): string {
  const t = s.trim()
  return t.length > max ? `${t.slice(0, max - 1)}…` : t
}

/**
 * 规范化模型给的结构化字段：只保留非空字符串、限条数、限长度。
 * 传进来的可能是数组/单字符串/undefined（模型输出没准），这里一律收口。
 */
export function normalizeItems(raw: unknown): string[] {
  const arr = Array.isArray(raw) ? raw : raw === undefined || raw === null ? [] : [raw]
  const out: string[] = []
  for (const item of arr) {
    if (typeof item !== 'string') continue
    const t = item.trim().replace(/^[-*•\s]+/, '').replace(/\s+/g, ' ')
    if (!t) continue
    out.push(truncate(t, MAX_ITEM_LENGTH))
    if (out.length >= MAX_ANALYSIS_ITEMS) break
  }
  return out
}

/**
 * 任意原始值 → IdeaAnalysis | null。
 * 四个维度都为空（没有可行性、也没有任何要点）时返回 null —— 这样"没评估"和
 * "评估全空"在界面上是同一种表现，不需要额外的分支。
 */
export function normalizeAnalysis(raw: unknown): IdeaAnalysis | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  const hasFeasibility = o.feasibility !== undefined && o.feasibility !== null && o.feasibility !== ''
  const pros = normalizeItems(o.pros)
  const cons = normalizeItems(o.cons)
  const risks = normalizeItems(o.risks)
  if (!hasFeasibility && pros.length === 0 && cons.length === 0 && risks.length === 0) return null
  return {
    feasibility: hasFeasibility ? clampFeasibility(o.feasibility) : 0,
    pros,
    cons,
    risks,
  }
}

/** 是否有可展示的评估内容（旧节点 / 第三方后端 → false，界面据此整体隐藏分析区块） */
export function hasAnalysis(a: IdeaAnalysis | null | undefined): a is IdeaAnalysis {
  if (!a) return false
  return a.pros.length > 0 || a.cons.length > 0 || a.risks.length > 0 || a.feasibility > 0
}
