// C.6 AI 后端设置：跨进程共享的类型（不依赖 Node / DOM，可被两端 typecheck）。

/** 一个 MCP Server 的配置（stdio 传输） */
export interface McpServerConfig {
  /** 逻辑 id（稳定，用于连接与检索） */
  id: string
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
  enabled: boolean
}

/**
 * 密钥的落盘形态。
 * - 系统有加密能力（Electron safeStorage / Windows DPAPI 等）→ 存 `encrypted`（密文 base64）
 * - 没有 → 降级存 `plain`，并用 protection 明确标出来（界面上要能看见这个降级）
 */
export interface StoredSecret {
  encrypted?: string
  plain?: string
  protection: 'safeStorage' | 'plaintext'
}

export interface AiSettings {
  deepseek?: StoredSecret
  mcpServers: McpServerConfig[]
}

/** 单个 MCP Server 的运行时状态（不落盘，来自最近一次同步） */
export interface McpServerStatus {
  id: string
  state: 'connected' | 'disabled' | 'error' | 'pending'
  tools: string[]
  error?: string
}

/** 新增 MCP Server 时的表单模板（id 由主进程生成） */
export interface McpServerTemplate {
  name: string
  command: string
  args: string[]
  env: Record<string, string>
  cwd?: string
}

/** 给渲染端的设置视图 —— 永不含密钥明文 */
export interface AiSettingsView {
  deepseek: {
    configured: boolean
    /** 降级为明文时必须让用户看见 */
    protection: 'safeStorage' | 'plaintext' | null
    /** 掩码预览，如 sk-…a1b2 */
    masked: string
  }
  mcpServers: (McpServerConfig & { status: McpServerStatus })[]
  /** 一键添加"本地示例 Server"用的模板（路径由主进程解析） */
  exampleMcpServer: McpServerTemplate | null
  /** 当前注册表里实际可用的生成器总数（含内置） */
  generatorCount: number
}
