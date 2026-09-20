// B.6 示例 MCP Server（独立进程）：暴露一个 `generate` tool（生成），
// 以及三个**只读** tool（list_projects / get_tree / get_node）读取画布数据。
// - 用 @modelcontextprotocol/sdk 的 Server + StdioServerTransport。
// - tool 的 inputSchema 用 zod 定义（SDK 内部以 safeParseAsync 校验）。
// - 生成能力通过注入的 Generator 提供（默认 DeepSeek 直连，key 从环境变量读取）。
// - 只读能力直接读磁盘上的项目 JSON（见 project-reader.ts；本进程读不到内存态画布）。
// - createMcpServer 不连接传输层，便于用 InMemoryTransport 做单测。

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js'
import { z } from 'zod'
import { DeepSeekGenerator } from '../generator/direct/deepseek'
import type { ContentType, Generator, NodeContent, NodeSpec } from '../generator/types'
import {
  getNode as readNode,
  getTree as readTree,
  listProjects as readProjects,
  resolveProjectsDir,
} from './project-reader'

const SERVER_NAME = 'workbuddy-diverge'
const SERVER_VERSION = '0.1.0'

interface GenerateToolArgs {
  projectId: string
  nodeId: string
  prompt: string
  parentContext?: string
  contentType?: ContentType
}

/** 只读 tool 的统一返回形状（与 sdk-modules.d.ts 的 ToolResult 结构一致） */
interface ReadOutcome {
  content: Array<{ type: string; text: string }>
  isError?: boolean
}

/**
 * 跑一次只读查询并转成 MCP 文本结果。
 * - 找不到数据目录 / 读失败 → isError 文本（**不抛**，绝不让子进程崩掉）
 * - 成功 → 结构化的 JSON 文本（缩进 2 格，便于人和模型阅读）
 */
function runRead(fn: (projectsDir: string) => unknown): ReadOutcome {
  try {
    const dir = resolveProjectsDir()
    if (!dir) {
      return {
        content: [
          {
            type: 'text',
            text:
              '找不到画布数据目录。请设置环境变量 DIVERGE_DATA_DIR 指向 Diverge 的应用数据目录' +
              '（其下的 projects/ 子目录即画布数据），或让标准 userData 路径下存在该目录。',
          },
        ],
        isError: true,
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(fn(dir), null, 2) }] }
  } catch (e) {
    return {
      content: [{ type: 'text', text: '读取失败：' + ((e as Error)?.message ?? String(e)) }],
      isError: true,
    }
  }
}

/** 构建并注册全部 tool 的 MCP Server（不连接传输层）。 */
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

  // ---------- 以下三个为只读 tool ----------
  // ⚠️ 每个都标注 annotations.readOnlyHint=true。这不是装饰：
  //    装配生成后端时（core/ai-backends.ts）会跳过只读 tool，否则它们会被当成
  //    "生成器"塞进下拉框，被选中时因入参契约不同而必然报错。

  server.registerTool(
    'list_projects',
    {
      title: 'List canvas projects',
      description:
        '列出画布（Diverge）里所有项目：id、名称、节点数、最后更新时间（按更新时间倒序）。只读，不修改任何数据。',
      inputSchema: {},
      annotations: { readOnlyHint: true },
    },
    () => runRead((dir) => readProjects(dir)),
  )

  server.registerTool(
    'get_tree',
    {
      title: 'Read a project tree',
      description:
        '读取某个项目的完整发散树（节点 + 连线）。projectId 可传项目 id 或项目名（也可用 list_projects 拿到的 id）。' +
        '默认返回精简节点：结果标题 label、用户原始描述 prompt、内容类型、状态、可行性评估、版本数；' +
        '需要每个节点当前版本的正文时传 includeContent=true（树大时正文会很长）。只读。',
      inputSchema: {
        projectId: z.string().describe('项目 id 或项目名'),
        includeContent: z
          .boolean()
          .optional()
          .describe('是否附带每个节点当前版本的正文，默认 false'),
      },
      annotations: { readOnlyHint: true },
    },
    (args: { projectId: string; includeContent?: boolean }) =>
      runRead((dir) => readTree(dir, args.projectId, args.includeContent === true)),
  )

  server.registerTool(
    'get_node',
    {
      title: 'Read one node with all versions',
      description:
        '读取单个节点的**全量**数据，含所有历史版本（每版正文 content、结果标题 title、可行性评估 analysis）。' +
        '适合对比不同版本、分析某个想法"翻案"前后的差异。只读。',
      inputSchema: {
        projectId: z.string().describe('项目 id 或项目名'),
        nodeId: z.string().describe('节点 id（可从 get_tree 的返回里取）'),
      },
      annotations: { readOnlyHint: true },
    },
    (args: { projectId: string; nodeId: string }) =>
      runRead((dir) => readNode(dir, args.projectId, args.nodeId)),
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
