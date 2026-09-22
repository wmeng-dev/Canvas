// 画布主题：新建想法时那张"顶层节点"的标题。
//
// 动机：空白画布上直接发散 N 条，会得到 N 个**互不相连的根节点** —— 画布看着散，
// 用户也说不清这张画布到底在探讨什么。所以新建时先立一个"主题"根节点，
// 后续发散都挂在它下面（父上下文也就有了，生成质量更好）。
//
// 本文件分两层：
//   · 纯函数 buildThemePrompt / cleanTheme —— 不依赖 Electron，可单测；
//   · suggestTheme —— 借注册表里的默认生成器让 AI 想一个主题。

import type { AppServices } from './services'
import type { Generator } from './generator/types'

/** 主题长度上限（超出即截断加省略号）—— 根节点卡片标题区放不下更长的 */
export const THEME_MAX_LEN = 20

/**
 * 约束模型只吐一句短主题。
 * 模型天然爱输出"好的，以下是为您构思的主题：1. **xxx**"这类包装，所以要求必须写死。
 */
export function buildThemePrompt(hint?: string): string {
  const h = (hint ?? '').trim()
  const seed = h ? `参考方向：${h}。` : '方向不限，你来定。'
  return [
    '你是创意工作坊的主持人，请为一张"创意发散画布"起一个主题。',
    seed,
    `要求：只输出主题本身，一句话，不超过 ${THEME_MAX_LEN} 个字；`,
    '不要引号、不要序号、不要 Markdown 标记、不要任何解释或前后缀。',
  ].join('\n')
}

/**
 * 把模型输出洗成一句干净的主题。
 *
 * 模型常见的"不听话"（逐条对应下面的替换）：先来一行"主题："、加 `1.` 序号、
 * 用 `**加粗**`、用「」引号、多吐解释行。这里逐层剥掉。
 * 洗不出东西时返回 ''（调用方据此提示用户自己写）。
 */
export function cleanTheme(raw: string): string {
  const lines = (raw ?? '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0)
  // 模型爱先来一句"好的，以下是为您构思的主题："当引子（以冒号收尾），
  // 真正的那句在下一行 —— 所以优先取**不以冒号收尾**的第一行。
  const firstLine = lines.find((l) => !/[:：]$/.test(l)) ?? lines[0] ?? ''

  let t = firstLine
    .replace(/^[#>*\-\s]+/, '') // 标题 / 引用 / 列表符号
    .replace(/^\d+[.、)]\s*/, '') // 序号
    .replace(/^(主题|标题|题目)\s*[:：]\s*/, '') // "主题：xxx"
    .replace(/[*_`~"'「」『』《》【】]/g, '') // 成对 / 装饰符号
    .replace(/\s+/g, ' ')
    .trim()

  if (!t) return ''
  return t.length > THEME_MAX_LEN ? `${t.slice(0, THEME_MAX_LEN)}…` : t
}

/**
 * 让 AI 想一个主题。走**默认生成器**（与发散同一个后端），
 * 所以占位生成器下也能跑通（无网/无 key 时的开发与探针场景）。
 *
 * 失败一律抛错，由调用方（对话框）转成给用户看的一句话。
 */
export async function suggestTheme(
  svc: AppServices,
  hint?: string,
  generatorId?: string,
): Promise<string> {
  const id = generatorId || svc.defaultGeneratorId
  const generator: Generator | undefined = id ? svc.registry.get(id) : undefined
  if (!generator) {
    // 别把 "generator not found: " 这种内部文案抛给用户 —— 它对应的真实处境是"还没配 AI"
    throw new Error('还没有可用的 AI 后端，请先在「AI 后端」里配置 DeepSeek 密钥或 MCP Server')
  }
  const content = await generator.generate({
    projectId: '',
    nodeId: 'theme',
    prompt: buildThemePrompt(hint),
  })
  // 生成器的 title 更接近"一句结论"，优先取它；正文只在 title 缺席时兜底
  const theme = cleanTheme(content.title || content.text || '')
  if (!theme) throw new Error('模型没有给出可用的主题，请手动填写')
  return theme
}
