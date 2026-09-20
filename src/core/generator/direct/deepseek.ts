import type { Generator, NodeSpec, NodeContent, ContentType } from '../types'
import { parseIdeaResponse } from '../parse-idea'

const DEFAULT_ENDPOINT = 'https://api.deepseek.com/v1/chat/completions'

export interface DeepSeekConfig {
  apiKey: string
  model?: string
  baseUrl?: string
  temperature?: number
  maxTokens?: number
}

interface DeepSeekMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

/** 正文格式随内容类型变（其余字段的契约不变） */
function bodyFormatRule(contentType: ContentType): string {
  switch (contentType) {
    case 'html':
      return 'content 放一段 HTML **片段**（不要 <html>/<head>/<body> 外壳，不要 <script>，样式内联或用 <style>）'
    case 'svg':
      return 'content 放一个完整的 <svg> 元素（带 xmlns 与 viewBox，不要 <script>）'
    case 'text':
      return 'content 放纯文本（不要使用 markdown 标记，不要用 # 或 - 开头）'
    case 'markdown':
    default:
      return 'content 用 markdown 组织（小标题 + 列表，围绕 title 展开说明，不要重复 title 之外的废话）'
  }
}

/**
 * 输出契约：**只输出一个 JSON 对象**，包含结果标题、四项评估与正文。
 * 之所以要求 JSON 而不是让模型写 markdown 再由我们去正则抠字段：抠 markdown 极其脆弱
 * （模型换个写法就崩），而 JSON 有明确的结构与转义规则，配合 response_format 基本不会跑偏。
 * 注意 prompt 里必须出现 "json" 字样 —— OpenAI 兼容接口的 json_object 模式有此要求。
 */
function buildSystemPrompt(contentType: ContentType, parentContext?: string): string {
  const lines = [
    '你是一个创意发散助手。用户给出一个想法或方向，你要在此基础上继续发散，' +
      '并对发散出来的这个方向做出务实的评估（不要一味吹捧，缺点与风险要真实）。',
    '',
    '只输出一个 JSON 对象，不要输出任何解释文字，不要用 markdown 代码围栏包裹。字段如下：',
    '{',
    '  "title": "结果标题。用一句话说清发散出来的这个东西叫什么，不要复述用户的输入，不超过 20 字",',
    '  "feasibility": 0 到 100 的整数，表示这个方向的可行性概率（只写数字，不要写 % 号）',
    '  "pros": ["优点，每条不超过 20 字"],',
    '  "cons": ["缺点，每条不超过 20 字"],',
    '  "risks": ["风险，每条不超过 20 字"],',
    '  "content": "正文"',
    '}',
    '',
    `正文格式：${bodyFormatRule(contentType)}。`,
    '',
    '硬性要求：',
    '- JSON 必须合法可解析：content 里的换行写成 \\n，双引号写成 \\"。',
    '- pros / cons / risks 各给 2 到 3 条，条数不必一样。',
    '- 字段名必须与上面完全一致。',
  ]
  if (parentContext) {
    lines.push('', '父节点上下文（你要在此基础上继续发散）：', parentContext)
  }
  return lines.join('\n')
}

/**
 * DeepSeek 直连生成器（B.5）。
 * 实现 Generator 接口；apiKey 由调用方注入（来自本地配置/环境变量，绝不硬编码、不入库）。
 * 用全局 fetch 调 /v1/chat/completions；parentContext 作为 system 消息的一部分（父节点基础上发散）。
 */
export class DeepSeekGenerator implements Generator {
  readonly id = 'deepseek-direct'
  readonly label = 'DeepSeek 直连'
  readonly kind = 'direct' as const

  private readonly apiKey: string
  private readonly model: string
  private readonly baseUrl: string
  private readonly temperature: number
  private readonly maxTokens: number

  constructor(cfg: DeepSeekConfig) {
    this.apiKey = cfg.apiKey
    this.model = cfg.model ?? 'deepseek-chat'
    this.baseUrl = cfg.baseUrl ?? DEFAULT_ENDPOINT
    this.temperature = cfg.temperature ?? 0.8
    this.maxTokens = cfg.maxTokens ?? 2048
  }

  async generate(spec: NodeSpec): Promise<NodeContent> {
    const contentType: ContentType = spec.contentType ?? 'markdown'
    const messages: DeepSeekMessage[] = [
      { role: 'system', content: buildSystemPrompt(contentType, spec.parentContext) },
      { role: 'user', content: spec.prompt },
    ]

    const res = await fetch(this.baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        messages,
        temperature: this.temperature,
        max_tokens: this.maxTokens,
        stream: false,
        // 强约束成 JSON 对象：模型不再有可能夹带寒暄或围栏
        response_format: { type: 'json_object' },
      }),
    })

    if (!res.ok) {
      const txt = await res.text().catch(() => '')
      throw new Error(`DeepSeek HTTP ${res.status}: ${txt.slice(0, 300)}`)
    }

    const data = (await res.json()) as {
      choices?: { message?: { content?: string } }[]
      model?: string
    }
    const text = data?.choices?.[0]?.message?.content ?? ''
    // 解析失败不会抛错：整段原样当正文，标题回落 prompt 派生标签（与旧行为一致）
    const parsed = parseIdeaResponse(text)

    return {
      contentType,
      text: parsed.body,
      title: parsed.title,
      analysis: parsed.analysis,
      model: data.model ?? this.model,
      raw: data,
      finishedAt: new Date().toISOString(),
    }
  }
}
