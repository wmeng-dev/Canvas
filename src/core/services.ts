// 主进程应用服务：把存储仓储 + 生成器注册表 + AI 后端设置组装成一个可复用的服务对象。
// 纯 Node（不 import electron），便于单测；dataDir / SecretBox 由主进程注入。

import { JsonStore } from './storage/store'
import { ProjectRepository } from './storage/repositories'
import { GeneratorRegistry } from './generator/types'
import { DeepSeekGenerator } from './generator/direct/deepseek'
import { createFakeGenerator } from './generator/fake'
import { McpClientManager } from './mcp/McpClientManager'
import {
  SettingsStore,
  AppStateStore,
  plaintextSecretBox,
  openSecret,
} from './settings-store'
import type { AppState, SecretBox } from './settings-store'
import type { ProjectFile, ProjectSummary, TreeNode } from '../shared/types'
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
 * 画布 tab 条的列表（**不含已关闭的**），按最近更新倒序，刚动过的排前面。
 */
export function listProjectSummaries(svc: AppServices): ProjectSummary[] {
  const closed = new Set(svc.appState.read().closedProjectIds ?? [])
  return svc.repo.summaries().filter((p) => !closed.has(p.id))
}

/** 「已关闭」列表：数据仍在磁盘，只是不在 tab 条上，随时可恢复。 */
export function listClosedSummaries(svc: AppServices): ProjectSummary[] {
  const closed = new Set(svc.appState.read().closedProjectIds ?? [])
  const byId = new Map(svc.repo.summaries().map((p) => [p.id, p]))
  // 按关闭顺序（先关的在前）输出；id 在磁盘上已不存在的直接跳过（文件被外部删了就别再列出来）
  return [...closed].map((id) => byId.get(id)).filter((p): p is ProjectSummary => !!p)
}

/**
 * 关闭一张画布 = **从 tab 条移除，项目文件保留**（与浏览器关标签页同一心智）。
 * 关掉当前画布时，把 lastProjectId 挪到剩下的一张上，否则下次打开会回到一张已关闭的画布。
 */
export function closeProject(svc: AppServices, projectId: string): ProjectSummary[] {
  // 未知 id 直接忽略：否则会在 closedProjectIds 里留下永远恢复不了的幽灵记录
  if (!svc.repo.exists(projectId)) return listProjectSummaries(svc)
  const state = svc.appState.read()
  const closed = new Set(state.closedProjectIds ?? [])
  closed.add(projectId)
  const next: AppState = { ...state, closedProjectIds: [...closed] }
  if (state.lastProjectId === projectId) {
    const remaining = svc.repo.summaries().filter((p) => !closed.has(p.id))
    next.lastProjectId = remaining[0]?.id
  }
  svc.appState.write(next)
  return listProjectSummaries(svc)
}

/** 重新打开一张已关闭的画布：从"已关闭"里移除并切过去。 */
export function reopenProject(svc: AppServices, projectId: string): ProjectFile {
  const state = svc.appState.read()
  svc.appState.write({
    ...state,
    closedProjectIds: (state.closedProjectIds ?? []).filter((id) => id !== projectId),
    lastProjectId: projectId,
  })
  return svc.repo.get(projectId)
}

/**
 * 取画布的**顶层主题节点**（唯一那个 `parentId === null` 的想法节点）；没有就按 `theme` 立一个。
 *
 * 为什么要有它：**发散的默认父节点就是它**（见 treeStore.generate）。若默认挂到"根层"，
 * 一次发散 3 条就会得到 3 个并列的孤立根节点 —— 画布看着散，也没有统一的父上下文。
 * 画布还没有顶层节点时（新建后的空白画布 / 早期历史画布），这里顺手补上。
 *
 * ⚠️ 老画布可能残留多个根节点（空白期留下的数据）：一律返回**第一个**，不去动老数据 ——
 * 迁移不该在这里悄悄替用户删东西。
 */
export function ensureThemeRoot(svc: AppServices, projectId: string, theme?: string): TreeNode {
  const file = svc.repo.get(projectId)
  const top = file.tree.nodes.find((n) => n.parentId === null)
  if (top) return top
  const t = theme?.trim() ?? ''
  return svc.repo.addNode(projectId, {
    label: t || '创意主题',
    prompt: t,
    status: 'empty',
    position: { x: 0, y: 0 },
  })
}

/**
 * 新建一个画布并立刻切过去。
 *
 * ⚠️ 新建的仍是**空白页**（用户明确要求从零开始自己加想法）。
 * 顶层主题节点不在这里建，而是等第一次发散时由 `ensureThemeRoot()` 按需立起 ——
 * 那时才知道用户想给的主题是什么（也可以让 AI 生成）。
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
  const state = svc.appState.read()
  const closed = new Set(state.closedProjectIds ?? [])
  // ⚠️ 已关闭的画布不参与"恢复上次"：否则关掉的 tab 会自己跑回来
  if (state.lastProjectId && !closed.has(state.lastProjectId) && svc.repo.exists(state.lastProjectId)) {
    return svc.repo.get(state.lastProjectId)
  }
  // 库里挑第一张**未关闭**的；全被关掉了就新建引导画布
  const list = svc.repo.list().filter((p) => !closed.has(p.id))
  if (list.length > 0) {
    const file = svc.repo.get(list[0].id)
    svc.appState.update((s) => ({ ...s, lastProjectId: file.project.id }))
    return file
  }

  const file = svc.repo.create('我的创意')
  // 引导态画布也走同一个入口：保证"每张画布都有顶层主题节点"这条不变量
  ensureThemeRoot(svc, file.project.id)
  const created = svc.repo.get(file.project.id)
  svc.appState.update((s) => ({ ...s, lastProjectId: created.project.id }))
  return created
}
