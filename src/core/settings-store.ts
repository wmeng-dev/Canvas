// C.6 设置持久化 + 密钥封装。
// 刻意把"加密能力"抽成 SecretBox 接口：core 层不 import electron，因此可被 Node 单测覆盖；
// 主进程注入 safeStorage 实现（见 src/main/secret-box.ts），无加密能力时注入明文降级实现。

import * as fs from 'fs'
import * as path from 'path'
import type { AiSettings, StoredSecret } from '../shared/settings'

export interface SecretBox {
  /** 当前环境是否具备真实加密能力 */
  readonly available: boolean
  /** 明文 → base64 密文 */
  encrypt(plain: string): string
  /** base64 密文 → 明文（解不开时抛错） */
  decrypt(payload: string): string
}

/** 无加密能力时的降级实现：**不做任何加密**，仅用于让应用仍可运行。 */
export function plaintextSecretBox(): SecretBox {
  return {
    available: false,
    encrypt: (plain) => Buffer.from(plain, 'utf-8').toString('base64'),
    decrypt: (payload) => Buffer.from(payload, 'base64').toString('utf-8'),
  }
}

/** 用当前 SecretBox 封装一个明文密钥。 */
export function sealSecret(box: SecretBox, plain: string): StoredSecret {
  if (box.available) {
    return { encrypted: box.encrypt(plain), protection: 'safeStorage' }
  }
  return { plain, protection: 'plaintext' }
}

/** 还原密钥明文；无法还原时返回 null（不抛错，避免拖垮整个设置页）。 */
export function openSecret(box: SecretBox, secret?: StoredSecret): string | null {
  if (!secret) return null
  try {
    if (secret.encrypted) return box.decrypt(secret.encrypted)
    if (secret.plain) return secret.plain
  } catch {
    return null
  }
  return null
}

/** 生成掩码预览，例如 sk-abc…cd12（永不回传完整密钥）。 */
export function maskSecret(plain: string): string {
  const s = plain.trim()
  if (s.length <= 8) return '••••'
  return `${s.slice(0, 4)}…${s.slice(-4)}`
}

const SETTINGS_FILE = 'settings.json'

const EMPTY: AiSettings = { mcpServers: [] }

/** 应用级状态（与 AI 设置分开持久化，避免污染 AiSettings 语义）。 */
export interface AppState {
  /** 上次打开/创建的项目 id；启动时优先恢复它，实现"下次打开修改" */
  lastProjectId?: string
}

const EMPTY_STATE: AppState = {}

/** 应用状态持久化：<baseDir>/app-state.json（临时文件 + rename 原子替换）。 */
export class AppStateStore {
  private readonly file: string

  constructor(baseDir: string) {
    this.file = path.join(path.resolve(baseDir), 'app-state.json')
  }

  get path(): string {
    return this.file
  }

  read(): AppState {
    if (!fs.existsSync(this.file)) return { ...EMPTY_STATE }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<AppState>
      return { lastProjectId: raw.lastProjectId }
    } catch {
      return { ...EMPTY_STATE }
    }
  }

  write(state: AppState): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf-8')
    fs.renameSync(tmp, this.file)
  }

  update(mutate: (s: AppState) => AppState): AppState {
    const next = mutate(this.read())
    this.write(next)
    return next
  }
}

/** 设置文件存储：<baseDir>/settings.json（临时文件 + rename 原子替换）。 */
export class SettingsStore {
  private readonly file: string

  constructor(baseDir: string) {
    this.file = path.join(path.resolve(baseDir), SETTINGS_FILE)
  }

  get path(): string {
    return this.file
  }

  read(): AiSettings {
    if (!fs.existsSync(this.file)) return { ...EMPTY, mcpServers: [] }
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf-8')) as Partial<AiSettings>
      return {
        deepseek: raw.deepseek,
        mcpServers: Array.isArray(raw.mcpServers) ? raw.mcpServers : [],
      }
    } catch {
      // 文件损坏时不让应用起不来，按空设置处理
      return { ...EMPTY, mcpServers: [] }
    }
  }

  write(settings: AiSettings): void {
    fs.mkdirSync(path.dirname(this.file), { recursive: true })
    const tmp = `${this.file}.${process.pid}.tmp`
    fs.writeFileSync(tmp, JSON.stringify(settings, null, 2), 'utf-8')
    fs.renameSync(tmp, this.file)
  }

  update(mutate: (s: AiSettings) => AiSettings): AiSettings {
    const next = mutate(this.read())
    this.write(next)
    return next
  }
}
