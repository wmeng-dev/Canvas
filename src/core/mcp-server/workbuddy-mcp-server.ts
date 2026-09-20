// B.6 示例 MCP Server（独立进程）：暴露一个 `generate` tool。
// - 用 @modelcontextprotocol/sdk 的 Server + StdioServerTransport。
// - tool 的 inputSchema 用 zod 定义（SDK 内部以 safeParseAsync 校验）。
// - 生成能力通过注入的 Generator 提供（默认 DeepSeek 直连，key 从环境变量读取）。
// - createMcpServer 不连接传输层，便于用 InMemoryTransport 做单测。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { DeepSeekGenerator } from '../generator/direct/deepseek'
import type { ContentType, Generator, NodeContent, NodeSpec } from '../generator/types'

const SERVER_NAME = 'workbuddy-diverge'
const SERVER_VERSION = '0.1.0'

interface GenerateToolArgs {
  projectId: string
  nodeId: string
  prompt: string
  parentContext?: string
  contentType?: ContentType
}

/** 构建并注册 `generate` tool 的 MCP Server（不连接传输层）。 */
export function createMcpServer(generator: Generator): McpServer {
  const server = new McpServer(
    { name: SERVER_NAME, version: SERVER_VERSION },
    { capabilities: {} },
  )

  server.registerTool(
    'generate',
    {
      title: 'Generate creative node content',
      description: '围绕 prompt（可带父节点上下文）生成发散内容，返回纯文本。',
      inputSchema: {
        projectId: z.string().describe('所属项目 id'),
        nodeId: z.string().describe('目标节点 id'),
        prompt: z.string().describe('生成提示词'),
        parentContext: z.string().optional().describe('父节点内容摘要，用于继续发散'),
        contentType: z
          .enum(['text', 'markdown', 'html', 'svg', 'image'])
          .optional()
          .describe('期望返回的内容类型'),
      },
    },
    async (args: GenerateToolArgs) => {
      const spec: NodeSpec = {
        projectId: args.projectId,
        nodeId: args.nodeId,
        prompt: args.prompt,
        parentContext: args.parentContext,
        contentType: args.contentType,
      }
      const content = await generator.generate(spec)
      return { content: [{ type: 'text', text: content.text }] }
    },
  )

  return server
}

/**
 * 按环境变量选择一个默认 generator：
 * - DIVERGE_MCP_FAKE=1：返回确定性假生成器（用于子进程端到端测试，避免联网）。
 * - 否则：DeepSeek 直连，key 取自 DEEPSEEK_API_KEY。
 */
function selectGeneratorFromEnv(): Generator {
  if (process.env.DIVERGE_MCP_FAKE === '1') {
    return {
      id: 'fake',
      label: 'Fake (env)',
      kind: 'direct',
      async generate(spec: NodeSpec): Promise<NodeContent> {
        return {
          contentType: spec.contentType ?? 'text',
          text: 'FAKE:' + spec.prompt,
          model: 'fake',
          finishedAt: new Date().toISOString(),
        }
      },
    }
  }
  return new DeepSeekGenerator({ apiKey: process.env.DEEPSEEK_API_KEY ?? '' })
}

/**
 * 以 stdio 传输启动独立 MCP Server 进程。
 * 未注入 generator 时，按环境变量选择默认后端（见 selectGeneratorFromEnv）。
 */
export async function startStdioServer(generator?: Generator): Promise<void> {
  const gen: Generator = generator ?? selectGeneratorFromEnv()
  const server = createMcpServer(gen)
  const transport = new StdioServerTransport()
  await server.connect(transport)
}

// 仅在作为可执行入口直接运行时才启动 stdio；被测试 import 时不启动。
if (require.main === module) {
  startStdioServer().catch((err) => {
    console.error('[mcp-server] failed to start:', err)
    process.exit(1)
  })
}
