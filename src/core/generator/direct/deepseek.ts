import type { Generator, NodeSpec, NodeContent, ContentType } from '../types'

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

/**
 * DeepSeek 直连生成器（B.5）。
 * 实现 Generator 接口；apiKey 由调用方注入（来自本地配置/环境变量，绝不硬编码、不入库）。
 * 用全局 fetch 调 /v1/chat/completions；支持 parentContext 作为 system 上下文（父节点基础上发散）。
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
    const messages: DeepSeekMessage[] = []
    if (spec.parentContext) {
      messages.push({ role: 'system', content: `父节点上下文：\n${spec.parentContext}` })
    }
    messages.push({ role: 'user', content: spec.prompt })

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
    const contentType: ContentType = spec.contentType ?? 'markdown'

    return {
      contentType,
      text,
      model: data.model ?? this.model,
      raw: data,
      finishedAt: new Date().toISOString(),
    }
  }
}
