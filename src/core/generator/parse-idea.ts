// 把模型返回的一段文本解析成「结果标题 + 结构化评估 + 正文」。
//
// 为什么需要它：生成器被要求输出一个 JSON 对象（见 deepseek.ts 的 system prompt），
// 但模型输出永远不能当作可信输入 —— 可能被 ```json 围栏包住、可能前面寒暄一句、
// 也可能整个退化成普通文本。这里的姿态是"能解析就用，解析不了就当作纯文本正文"，
// 任何情况下都不会让一次生成失败。

import type { IdeaAnalysis } from '../../shared/types'
import { MAX_TITLE_LENGTH, normalizeAnalysis, truncate } from '../../shared/analysis'

export interface ParsedIdea {
  /** 结果标题（模型没给 / 不合法时为 undefined，调用方回落 deriveLabel(prompt)） */
  title?: string
  analysis?: IdeaAnalysis | null
  /** 正文（markdown / html / svg / text）；解析失败时就是原始文本 */
  body: string
}

/** 结构化的判据：至少出现一个约定字段，避免把"恰好是 JSON 的正文"误吞 */
const STRUCTURED_KEYS = ['title', 'feasibility', 'pros', 'cons', 'risks', 'content'] as const

/** 去掉 ```json ... ``` / ``` ... ``` 围栏 */
function stripFence(s: string): string {
  const m = s.match(/^\s*```[a-zA-Z]*\s*\n([\s\S]*?)\n?\s*```\s*$/)
  return m ? m[1] : s
}

/** 从可能夹着寒暄的文本里截出最外层 JSON 对象（用括号配对，不靠正则） */
function extractObject(text: string): string | null {
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let i = start; i < text.length; i++) {
    const ch = text[i]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') inString = true
    else if (ch === '{') depth++
    else if (ch === '}') {
      depth--
      if (depth === 0) return text.slice(start, i + 1)
    }
  }
  return null
}

function tryParseJson(text: string): Record<string, unknown> | null {
  const candidates = [text.trim(), extractObject(text)].filter((c): c is string => !!c)
  for (const c of candidates) {
    try {
      const v = JSON.parse(stripFence(c)) as unknown
      if (v && typeof v === 'object' && !Array.isArray(v)) return v as Record<string, unknown>
    } catch {
      /* 换下一个候选 */
    }
  }
  return null
}

/**
 * 解析一次生成结果。
 * - 命中结构化字段 → 取 title / analysis / content（content 缺失则不塞 JSON 文本当正文）
 * - 未命中 → 整段原样当正文（与旧行为完全一致，向后兼容）
 */
export function parseIdeaResponse(raw: string): ParsedIdea {
  const text = raw ?? ''
  const obj = tryParseJson(text)
  if (!obj) return { body: text.trim() }

  const hit = STRUCTURED_KEYS.some((k) => k in obj)
  if (!hit) return { body: text.trim() }

  const rawTitle = typeof obj.title === 'string' ? obj.title : ''
  const title = rawTitle.trim() ? truncate(rawTitle, MAX_TITLE_LENGTH) : undefined
  const contentKeys = ['content', 'body', 'markdown', 'text'] as const
  let body = ''
  for (const k of contentKeys) {
    const v = obj[k]
    if (typeof v === 'string' && v.trim()) {
      body = v
      break
    }
  }
  return { title, analysis: normalizeAnalysis(obj), body }
}
