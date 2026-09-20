// MCP 只读数据访问层：让**独立的 MCP Server 子进程**也能读到画布数据（项目 / 树 / 节点）。
//
// 背景（为什么要有这个文件）：
//   MCP Server 是被拉起的**独立进程**，它不在主进程里，拿不到内存中的画布状态。
//   而画布数据本身是"每个项目一个 JSON 文件"（见 storage/store.ts），
//   所以走"直接读文件"是最小改动、也最稳的做法（写入方用"临时文件 + rename"原子替换，
//   并发只读不会读到半写文件；最坏只是读到毫秒级旧值）。
//
// ⚠️ 三个刻意的设计约束：
//   1. **绝不写**。这里不复用 JsonStore —— 它的构造函数会 mkdirSync 建目录，
//      对一个"只读"服务来说是多余的写副作用（甚至会在数据目录不存在时凭空造出空目录）。
//      id 消毒逻辑则复用 store.ts 导出的同一个函数，避免两边分叉。
//   2. **绝不抛到进程外**。坏文件 / 缺字段 / 目录不存在都跳过或归类为"找不到"，
//      由上层（tool 回调）转成 isError 文本，不让子进程崩掉。
//   3. **绝不依赖 Electron**。本文件可能与主进程一起被编译，但只跑在
//      ELECTRON_RUN_AS_NODE 退化的纯 Node 环境里，所以只用 fs/path/process。
//
// 数据目录怎么找（按优先级）：
//   ① 环境变量 DIVERGE_DATA_DIR —— 主进程拉起示例 Server 时会显式注入这一项。
//      ⚠️ 必须显式注入：MCP SDK 的 StdioClientTransport 只继承一份**安全白名单**环境变量
//      （Windows 上是 APPDATA/PATH/TEMP 等，见 client/stdio.js 的 DEFAULT_INHERITED_ENV_VARS），
//      DIVERGE_DATA_DIR 不在其中，不注入就传不过来。
//   ② 标准 userData 路径 + 应用名候选 —— 给"用户手动添加的 Server"兜底：
//      %APPDATA%\<应用名>\diverge\projects（Windows）
//      ~/Library/Application Support/<应用名>/diverge/projects（macOS）
//      $XDG_CONFIG_HOME|~/.config/<应用名>/diverge/projects（Linux）
//      应用名取"打包名 发散创意画布"与"开发名 diverge-desktop"两个候选。

import * as fs from 'fs'
import * as path from 'path'
import { PROJECTS_DIR, sanitizeProjectId } from '../storage/store'
import type { ProjectFile, TreeNode } from '../../shared/types'

/** 项目摘要（列表用，不含节点明细） */
export interface ProjectSummary {
  id: string
  name: string
  /** 节点总数，便于调用方判断"值不值得拉整棵树" */
  nodeCount: number
  updatedAt: string
}

/** get_tree 的返回：项目信息 + 精简节点 + 边 */
export interface TreeView {
  project: { id: string; name: string }
  nodes: TreeNodeView[]
  edges: Array<{ id: string; source: string; target: string }>
}

/**
 * 精简节点。默认**不带**正文与历史版本 —— 一棵树可能几十个节点、每个节点又有多版正文，
 * 全带上会瞬间吃满调用方的上下文。要正文就显式要（includeContent），要某个节点的
 * 全部版本就单独调 get_node。
 */
export interface TreeNodeView {
  id: string
  parentId: string | null
  /** 当前版本的结果标题（不是用户当初输入的那句话，原始输入在 prompt） */
  label: string
  /** 用户当初输入的原始描述 */
  prompt: string
  contentType: string
  status: string
  analysis?: unknown
  currentVersionId: string | null
  versionCount: number
  /** 仅 includeContent=true 时出现：当前生效的正文 */
  content?: string
}

/** 应用名候选：打包名 / 开发名（Electron 的 userData 目录名即应用名） */
const APP_NAME_CANDIDATES = ['发散创意画布', 'diverge-desktop']

/** 按平台列出候选的 userData 目录（不含 /diverge/projects 后缀） */
function candidateUserDataDirs(env: NodeJS.ProcessEnv): string[] {
  const out: string[] = []
  if (process.platform === 'win32') {
    for (const key of ['APPDATA', 'LOCALAPPDATA']) {
      const base = env[key]
      if (base) for (const n of APP_NAME_CANDIDATES) out.push(path.join(base, n))
    }
  } else if (process.platform === 'darwin') {
    const home = env.HOME
    if (home) {
      for (const n of APP_NAME_CANDIDATES)
        out.push(path.join(home, 'Library', 'Application Support', n))
    }
  } else {
    const base = env.XDG_CONFIG_HOME || (env.HOME ? path.join(env.HOME, '.config') : '')
    if (base) for (const n of APP_NAME_CANDIDATES) out.push(path.join(base, n))
  }
  return out
}

/**
 * 定位画布数据的 projects 目录。找不到返回 null（由调用方给出人话错误）。
 * 惰性调用（每次 tool 调用时算）而不是在模块加载期算一次 —— 环境变量/目录状态都可能在之后才就绪。
 */
export function resolveProjectsDir(env: NodeJS.ProcessEnv = process.env): string | null {
  const explicit = env.DIVERGE_DATA_DIR
  if (explicit) {
    const dir = path.join(explicit, PROJECTS_DIR)
    // 显式指定时即使目录还不存在也认（可能只是还没建过项目），交给上层报"目录不存在"
    return dir
  }
  for (const base of candidateUserDataDirs(env)) {
    const dir = path.join(base, 'diverge', PROJECTS_DIR)
    if (fs.existsSync(dir)) return dir
  }
  return null
}

function isFile(p: string): boolean {
  try {
    return fs.statSync(p).isFile()
  } catch {
    return false
  }
}

/** 读一个项目文件；不存在或解析失败都抛错（由上层转 isError） */
export function readProjectFile(projectsDir: string, projectId: string): ProjectFile {
  if (!projectsDir) throw new Error('画布数据目录未配置')
  const direct = path.join(projectsDir, `${sanitizeProjectId(projectId)}.json`)
  const target = isFile(direct) ? direct : findProjectFile(projectsDir, projectId)
  if (!target) throw new Error(`找不到项目：${projectId}`)
  let file: ProjectFile
  try {
    file = JSON.parse(fs.readFileSync(target, 'utf-8')) as ProjectFile
  } catch (e) {
    throw new Error(`项目文件解析失败（${path.basename(target)}）：${(e as Error).message}`)
  }
  if (!file || !file.project || !file.tree) {
    throw new Error(`项目文件结构不完整：${path.basename(target)}`)
  }
  return file
}

/**
 * 兜底查找：调用方可能传的是项目**名字**而不是 id。
 * 逐个读文件比对 project.id / project.name（项目数量是"用户自己建的那几个"，量级很小）。
 */
function findProjectFile(projectsDir: string, idOrName: string): string | null {
  if (!fs.existsSync(projectsDir)) return null
  for (const f of fs.readdirSync(projectsDir)) {
    if (!f.endsWith('.json')) continue
    const p = path.join(projectsDir, f)
    try {
      const parsed = JSON.parse(fs.readFileSync(p, 'utf-8')) as ProjectFile
      const proj = parsed?.project
      if (proj && (proj.id === idOrName || proj.name === idOrName)) return p
    } catch {
      // 坏文件跳过：一个项目文件损坏不应让整个列表/查找失败
    }
  }
  return null
}

/** 列出所有项目摘要，按 updatedAt 倒序（最近改动的在前） */
export function listProjects(projectsDir: string): ProjectSummary[] {
  if (!projectsDir || !fs.existsSync(projectsDir)) return []
  const out: ProjectSummary[] = []
  for (const f of fs.readdirSync(projectsDir)) {
    if (!f.endsWith('.json')) continue
    try {
      const parsed = JSON.parse(fs.readFileSync(path.join(projectsDir, f), 'utf-8')) as ProjectFile
      const proj = parsed?.project
      if (!proj?.id) continue
      out.push({
        id: proj.id,
        name: proj.name ?? '',
        nodeCount: Array.isArray(parsed.tree?.nodes) ? parsed.tree.nodes.length : 0,
        updatedAt: proj.updatedAt ?? '',
      })
    } catch {
      // 坏文件跳过，不因单个损坏文件让整个列表不可用
    }
  }
  return out.sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)))
}

function toNodeView(n: TreeNode, includeContent: boolean): TreeNodeView {
  const view: TreeNodeView = {
    id: n.id,
    parentId: n.parentId ?? null,
    label: n.label,
    prompt: n.prompt,
    contentType: n.contentType,
    status: n.status,
    analysis: n.analysis ?? null,
    currentVersionId: n.currentVersionId ?? null,
    versionCount: Array.isArray(n.versions) ? n.versions.length : 0,
  }
  if (includeContent) view.content = n.content
  return view
}

/** 取整棵树（节点默认精简，includeContent=true 时带当前正文） */
export function getTree(
  projectsDir: string,
  projectId: string,
  includeContent = false,
): TreeView {
  const file = readProjectFile(projectsDir, projectId)
  const nodes = Array.isArray(file.tree.nodes) ? file.tree.nodes : []
  const edges = Array.isArray(file.tree.edges) ? file.tree.edges : []
  return {
    project: { id: file.project.id, name: file.project.name },
    nodes: nodes.map((n) => toNodeView(n, includeContent)),
    edges: edges.map((e) => ({ id: e.id, source: e.source, target: e.target })),
  }
}

/**
 * 取单个节点的**全量**（含所有历史版本）—— 这个工具本来就是"点名要一个节点"，
 * 所以不再做裁剪：连同每版正文与评估一起给，便于调用方做对比/翻案分析。
 */
export function getNode(
  projectsDir: string,
  projectId: string,
  nodeId: string,
): { project: { id: string; name: string }; node: TreeNode } {
  const file = readProjectFile(projectsDir, projectId)
  const nodes = Array.isArray(file.tree.nodes) ? file.tree.nodes : []
  const node = nodes.find((n) => n.id === nodeId)
  if (!node) throw new Error(`项目 ${file.project.name} 里找不到节点：${nodeId}`)
  return { project: { id: file.project.id, name: file.project.name }, node }
}
