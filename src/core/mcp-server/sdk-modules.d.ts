// 环境声明（ambient）。
//
// 背景：@modelcontextprotocol/sdk@1.30.0 的 npm 包在本机「冻结安装」中未随附可解析的 .d.ts
// （其 package.json 的 exports.types 指向 dist/esm/**/*.d.ts，仅能经 exports 映射访问，
// 而本工程 tsconfig 用 node10 模块解析，不读 exports，故 tsc 无法解析类型）。
// 这里为实际用到的子路径提供最小可用声明以保证类型检查通过；
// 运行时走 package exports 的 require 条件，加载 dist/cjs 的真实实现。
//
// 关键 API（已核对 dist/cjs 源码）：
//   - 高层服务端类为 `McpServer`（server/mcp.js），registerTool(name, config, cb)；
//     低层 `Server`（server/index.js）用 setRequestHandler，此处不涉及。
//   - 子路径导入必须带显式 .js 结尾（Node 不会为 exports 目标补扩展名）。
//
// 注意：本文件不含顶层 import/export（保持为全局声明脚本）。

declare module '@modelcontextprotocol/sdk/server/mcp.js' {
  export interface McpServerOptions {
    capabilities?: {
      tools?: Record<string, unknown>
      resources?: Record<string, unknown>
      prompts?: Record<string, unknown>
      logging?: Record<string, unknown>
    }
  }

  export interface ToolResult {
    content: Array<{ type: string; text: string }>
    isError?: boolean
  }

  export class McpServer {
    constructor(info: { name: string; version: string }, options?: McpServerOptions)
    registerTool(
      name: string,
      config: {
        title?: string
        description?: string
        inputSchema?: Record<string, unknown>
        outputSchema?: Record<string, unknown>
        annotations?: Record<string, unknown>
      },
      cb: (args: any, extra: any) => Promise<ToolResult> | ToolResult,
    ): void
    connect(transport: unknown): Promise<void>
    close(): Promise<void>
  }
}

declare module '@modelcontextprotocol/sdk/server/stdio.js' {
  export class StdioServerTransport {
    constructor()
  }
}

declare module '@modelcontextprotocol/sdk/inMemory.js' {
  export class InMemoryTransport {
    constructor()
    static createLinkedPair(): [InMemoryTransport, InMemoryTransport]
  }
}

declare module '@modelcontextprotocol/sdk/client/index.js' {
  export class Client {
    constructor(
      info: { name: string; version: string },
      options: { capabilities: Record<string, unknown> },
    )
    connect(transport: unknown): Promise<void>
    listTools(params?: unknown, options?: unknown): Promise<{
      tools: Array<{
        name: string
        description?: string
        inputSchema?: unknown
        /** MCP 标准的行为标注；readOnlyHint=true 表示该 tool 只读、不产生副作用 */
        annotations?: Record<string, unknown>
      }>
    }>
    callTool(
      params: { name: string; arguments?: Record<string, unknown> },
      resultSchema?: unknown,
      options?: unknown,
    ): Promise<{ content: Array<{ type: string; text: string }>; isError?: boolean }>
    close(): Promise<void>
  }
}

declare module '@modelcontextprotocol/sdk/client/stdio.js' {
  export interface StdioServerParameters {
    command: string
    args?: string[]
    env?: Record<string, string>
    cwd?: string
    stderr?: 'pipe' | 'overlapped' | 'inherit' | 'ignore'
  }
  export function getDefaultEnvironment(): Record<string, string>
  export class StdioClientTransport {
    constructor(server: StdioServerParameters)
  }
}
