import * as fs from 'fs'
import * as path from 'path'

export interface JsonStoreOptions {
  /** 存储根目录，例如 app.getPath('userData')/ideasprout */
  baseDir: string
}

/** 项目文件的所在子目录名（相对 baseDir） */
export const PROJECTS_DIR = 'projects'

/**
 * 项目 id 安全化：只允许 `[a-zA-Z0-9_-]`，其余字符一律换成 `_`，杜绝路径穿越。
 *
 * ⚠️ 这是**单一事实源**：写入方（JsonStore）与只读方（mcp-server/project-reader）
 * 必须用同一个函数，否则两边对"同一 id 对应哪个文件"的理解会分叉。
 * 真实项目 id 是 randomUUID（只含十六进制与连字符），消毒对它是恒等变换。
 */
export function sanitizeProjectId(id: string): string {
  return String(id).replace(/[^a-zA-Z0-9_-]/g, '_')
}

/**
 * 低层 JSON 文件存储。
 * - 每个项目一个文件：<baseDir>/projects/<id>.json
 * - 写操作采用「临时文件 + rename」的原子替换，避免进程中断导致半写损坏。
 * - 项目 id 做安全化，杜绝路径穿越。
 */
export class JsonStore {
  private readonly root: string
  private readonly projectsDir: string

  constructor(opts: JsonStoreOptions) {
    this.root = path.resolve(opts.baseDir)
    this.projectsDir = path.join(this.root, PROJECTS_DIR)
    fs.mkdirSync(this.projectsDir, { recursive: true })
  }

  private projectPath(id: string): string {
    return path.join(this.projectsDir, `${sanitizeProjectId(id)}.json`)
  }

  listProjectIds(): string[] {
    if (!fs.existsSync(this.projectsDir)) return []
    return fs
      .readdirSync(this.projectsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => f.slice(0, -'.json'.length))
  }

  exists(id: string): boolean {
    return fs.existsSync(this.projectPath(id))
  }

  read<T>(id: string): T {
    const p = this.projectPath(id)
    if (!fs.existsSync(p)) {
      throw new Error(`Project not found: ${id}`)
    }
    const raw = fs.readFileSync(p, 'utf-8')
    return JSON.parse(raw) as T
  }

  write<T>(id: string, data: T): void {
    const p = this.projectPath(id)
    const tmp = `${p}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(data, null, 2), 'utf-8')
    fs.renameSync(tmp, p)
  }

  delete(id: string): void {
    const p = this.projectPath(id)
    if (fs.existsSync(p)) fs.unlinkSync(p)
  }
}
