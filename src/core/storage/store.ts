import * as fs from 'fs'
import * as path from 'path'

export interface JsonStoreOptions {
  /** 存储根目录，例如 app.getPath('userData')/diverge */
  baseDir: string
}

const PROJECTS_DIR = 'projects'

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
    const safe = String(id).replace(/[^a-zA-Z0-9_-]/g, '_')
    return path.join(this.projectsDir, `${safe}.json`)
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
