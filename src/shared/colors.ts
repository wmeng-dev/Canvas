// 节点卡片自定义颜色的调色板与解析/校验纯函数。
//
// ⚠️ 为什么放 shared 而不是 renderer：
//   1. tsconfig.test.json 只把 core + shared 编译进 dist-test —— 放这里才能被 Node 单测直接覆盖；
//   2. 仓储（core）落盘前也要校验颜色值是否合法，渲染端与存储端必须认同一份调色板，
//      否则会出现"存进去一个渲染端不认识的色值 → 卡片退回默认色"的静默不一致。

export interface CardColor {
  id: string
  label: string
  /** 卡片背景（浅色调，保证深色文字可读） */
  bg: string
  /** 卡片边框（同色系稍深，未选中时使用） */
  border: string
}

/**
 * 固定调色板。刻意用**浅色底 + 深色字**：卡片正文是深色（#24292f），
 * 若允许深色底就得连带处理文字反色，收益不抵复杂度。
 */
export const CARD_COLORS: CardColor[] = [
  { id: 'default', label: '默认', bg: '#ffffff', border: '#d0d7de' },
  { id: 'red', label: '红', bg: '#ffe3e3', border: '#f0b4b4' },
  { id: 'orange', label: '橙', bg: '#ffe8cc', border: '#f0c894' },
  { id: 'yellow', label: '黄', bg: '#fff5c2', border: '#e6d488' },
  { id: 'green', label: '绿', bg: '#dff5e3', border: '#a4dab0' },
  { id: 'blue', label: '蓝', bg: '#dbeafe', border: '#a4c4f0' },
  { id: 'purple', label: '紫', bg: '#ece2ff', border: '#c2acf0' },
]

const BY_BG = new Map(CARD_COLORS.map((c) => [c.bg, c]))

export const DEFAULT_CARD_BG = CARD_COLORS[0].bg
export const DEFAULT_CARD_BORDER = CARD_COLORS[0].border

/**
 * 校验一个落库值是不是本调色板认可的色值。
 * `null` / `undefined` 表示"用默认色"，也算合法（这就是清空颜色的写法）。
 */
export function isValidCardColor(color: unknown): boolean {
  if (color === null || color === undefined) return true
  return typeof color === 'string' && BY_BG.has(color)
}

/** 取卡片背景色：不认识的值一律退回默认白（坏数据不该让卡片变成黑块）。 */
export function resolveCardBg(color?: string | null): string {
  if (!color) return DEFAULT_CARD_BG
  return BY_BG.get(color)?.bg ?? DEFAULT_CARD_BG
}

/** 取卡片边框色（未选中时）：与背景同色系。 */
export function resolveCardBorder(color?: string | null): string {
  if (!color) return DEFAULT_CARD_BORDER
  return BY_BG.get(color)?.border ?? DEFAULT_CARD_BORDER
}
