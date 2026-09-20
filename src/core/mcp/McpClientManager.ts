// B.7 MCP 接入（一）：客户端管理器。
// 以 stdio 传输拉起 MCP Server 子进程，维护 id -> Client 的连接，并提供 listTools / callTool。

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'

export interface McpStdioServerConfig {
  /** 逻辑 id，用于在管理器内检索该连接 */
  id: string
  /** 可执行命令（本地示例 server 用 process.execPath + 脚本路径） */
  command: string
  args?: string[]
  env?: Record<string, string>
  cwd?: string
}

export interface McpToolInfo {
  name: string
  description?: string
}

export class McpClientManager {
  private readonly clients = new Map<string, Client>()

  /** 拉起并连接一个 stdio MCP Server，返回其工具名列表。 */
  async connect(cfg: McpStdioServerConfig): Promise<string[]> {
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: cfg.args ?? [],
      env: cfg.env,
      cwd: cfg.cwd,
    })
    const client = new Client(
      { name: 'workbuddy-diverge', version: '0.1.0' },
      { capabilities: {} },
    )
    await client.connect(transport)
    this.clients.set(cfg.id, client)
    const tools = await this.listTools(cfg.id)
    return tools.map((t) => t.name)
  }

  isConnected(id: string): boolean {
    return this.clients.has(id)
  }

  /** 当前已建立的连接 id 列表（AI 后端设置变更时用来关掉不再启用的） */
  connectedIds(): string[] {
    return [...this.clients.keys()]
  }

  async listTools(id: string): Promise<McpToolInfo[]> {
    const client = this.require(id)
    const res = await client.listTools()
    return res.tools.map((t) => ({ name: t.name, description: t.description }))
  }

  /** 调用工具并拼接返回的文本片段。isError 时抛出。 */
  async callTool(
    id: string,
    toolName: string,
    args: Record<string, unknown>,
  ): Promise<string> {
    const client = this.require(id)
    const res = await client.callTool({ name: toolName, arguments: args })
    if (res.isError) {
      throw new Error(`MCP tool "${toolName}" returned isError`)
    }
    return (res.content ?? [])
      .map((c) => (c.type === 'text' ? c.text : ''))
      .join('')
  }

  async disconnect(id: string): Promise<void> {
    const client = this.clients.get(id)
    if (!client) return
    this.clients.delete(id)
    await client.close()
  }

  async disconnectAll(): Promise<void> {
    for (const id of [...this.clients.keys()]) {
      await this.disconnect(id)
    }
  }

  private require(id: string): Client {
    const client = this.clients.get(id)
    if (!client) throw new Error(`MCP server not connected: ${id}`)
    return client
  }
}
