// 主进程应用服务：把存储仓储 + 生成器注册表 + AI 后端设置组装成一个可复用的服务对象。
// 纯 Node（不 import electron），便于单测；dataDir / SecretBox 由主进程注入。

import { JsonStore } from './storage/store'
import { ProjectRepository } from './storage/repositories'
import { GeneratorRegistry } from './generator/types'
import { DeepSeekGenerator } from './generator/direct/deepseek'
import { createFakeGenerator } from './generator/fake'
import { McpClientManager } from './mcp/McpClientManager'
import { SettingsStore, AppStateStore, plaintextSecretBox, openSecret } from './settings-store'
import type { SecretBox } from './settings-store'
import type { ProjectFile, ProjectSummary } from '../shared/types'
import type { McpServerStatus, McpServerTemplate } from '../shared/settings'

export interface AppServices {
  repo: ProjectRepository
  registry: GeneratorRegistry
  settings: SettingsStore
  /** 应用级状态（上次项目等），与 AI 设置分开 */
  appState: AppStateStore
  secrets: SecretBox
  mcp: McpClientManager
  dataDir: string
  /** 当前默认生成器 id（AI 后端变更时会被重建） */
  defaultGeneratorId: string
  /** 是否注册本地占位生成器（无 key 环境 / 测试 / 探针用） */
  fakeEnabled: boolean
  /** 各 MCP server 最近一次同步状态（不落盘） */
  mcpStatus: Map<string, McpServerStatus>
  /** 一键添加本地示例 MCP Server 的模板（脚本路径由主进程解析后注入） */
  exampleMcpServer: McpServerTemplate | null
}

export interface CreateServicesOptions {
  dataDir: string
  /** 密钥封装实现；不传则用明文降级（仅适合测试） */
  secrets?: SecretBox
  /** 提供则注册 DeepSeek 直连（优先级低于磁盘设置里的 key） */
  deepseekApiKey?: string
  /** 提供则注册本地占位生成器（无 key 环境/测试用） */
  fakeGenerator?: boolean
  /** 本地示例 MCP Server 模板 */
  exampleMcpServer?: McpServerTemplate
}

/**
 * 同步构造服务。此阶段只注册"不需要异步握手"的后端（DeepSeek / 占位生成器）；
 * MCP server 需要拉起子进程，由 ai-backends.ts 的 syncAiBackends() 异步完成。
 */
export function createServices(opts: CreateServicesOptions): AppServices {
  const repo = new ProjectRepository(new JsonStore({ baseDir: opts.dataDir }))
  const settings = new SettingsStore(opts.dataDir)
  const appState = new AppStateStore(opts.dataDir)
  const secrets = opts.secrets ?? plaintextSecretBox()
  const registry = new GeneratorRegistry()

  const stored = settings.read()
  // 磁盘设置里的 key 优先于环境变量（用户在 UI 里配的应覆盖启动参数）
  const apiKey = openSecret(secrets, stored.deepseek) ?? opts.deepseekApiKey
  if (apiKey) registry.register(new DeepSeekGenerator({ apiKey }))
  if (opts.fakeGenerator) registry.register(createFakeGenerator())

  const first = registry.list()[0]

  return {
    repo,
    registry,
    settings,
    appState,
    secrets,
    mcp: new McpClientManager(),
    dataDir: opts.dataDir,
    defaultGeneratorId: first?.id ?? '',
    fakeEnabled: opts.fakeGenerator === true,
    mcpStatus: new Map(),
    exampleMcpServer: opts.exampleMcpServer ?? null,
  }
}

/**
 * 画布 tab 条的列表。按最近更新倒序，刚动过的排前面。
 */
export function listProjectSummaries(svc: AppServices): ProjectSummary[] {
  return svc.repo.summaries()
}

/**
 * 新建一个画布并立刻切过去。
 *
 * ⚠️ 刻意**不加默认根节点**：用户明确要求新建的是空白页，从零开始自己加想法。
 * （首次启动时 `ensureProject()` 仍会建一个带「创意主题」的画布，那是"从来没用过"的引导态，
 *   与"主动新建"意图不同。）
 */
export function createProject(svc: AppServices, name?: string): ProjectFile {
  const file = svc.repo.create(name?.trim() || '未命名画布')
  svc.appState.update((s) => ({ ...s, lastProjectId: file.project.id }))
  return svc.repo.get(file.project.id)
}

/** 切到指定画布（写 lastProjectId → 下次打开回来的还是这张）。 */
export function switchProject(svc: AppServices, projectId: string): ProjectFile {
  const file = svc.repo.get(projectId)
  svc.appState.update((s) => ({ ...s, lastProjectId: file.project.id }))
  return file
}

/**
 * 返回"当前应打开的项目"：
 * 1. 优先恢复上次打开/创建的项目（appState.lastProjectId，实现"下次打开修改"）；
 * 2. 否则取库里第一个项目；
 * 3. 库为空则创建一个带根节点的 "我的创意"。
 * 选定后都会把 lastProjectId 写回，保证重启能恢复同一项目。
 */
export function ensureProject(svc: AppServices): ProjectFile {
  const lastId = svc.appState.read().lastProjectId
  if (lastId && svc.repo.exists(lastId)) {
    return svc.repo.get(lastId)
  }
  const list = svc.repo.list()
  if (list.length > 0) {
    const file = svc.repo.get(list[0].id)
    svc.appState.update((s) => ({ ...s, lastProjectId: file.project.id }))
    return file
  }

  const file = svc.repo.create('我的创意')
  svc.repo.addNode(file.project.id, {
    label: '创意主题',
    prompt: '',
    status: 'empty',
    position: { x: 0, y: 0 },
  })
  const created = svc.repo.get(file.project.id)
  svc.appState.update((s) => ({ ...s, lastProjectId: created.project.id }))
  return created
}
