// 数据目录迁移：应用改名后 userData 路径会跟着变 ——
//   父目录 = 应用名（package.json name / electron-builder productName）
//   子目录 = 品牌名（本文件的 'ideasprout'）
// 两者任一变化，用户已存的画布就会"看起来全没了"。
//
// 策略：**只复制、不删除**旧目录。
//   - 复制而非移动：万一复制到一半崩了，旧数据仍在，最坏情况只是回到原点；
//   - 不删旧目录：用户想手工核对时还留着一份，磁盘占用换数据安全。
// 迁移是**一次性**的（新目录一旦存在就不再触发）。

import * as fs from 'fs'
import * as path from 'path'

/** 改名前的候选父目录名（开发态包名 / 打包态产品名）。 */
export const LEGACY_APP_NAMES = ['diverge-desktop', '发散创意画布']

/** 改名前的子目录名（dataDir 的最后一段）。 */
export const LEGACY_SUBDIR = 'diverge'

export interface DataDirMigration {
  migrated: boolean
  from?: string
  to?: string
  /** 未迁移的原因：'new-exists' 新目录已有数据；'no-legacy' 没找到任何旧目录 */
  reason?: 'new-exists' | 'no-legacy'
}

/**
 * 把旧数据目录的内容搬到新目录。
 * @param userData 形如 `<...>/Roaming/<当前应用名>` —— 旧目录在它的**同级兄弟目录**里。
 * @param dataDir  当前应使用的完整数据目录。
 */
export function migrateLegacyDataDir(userData: string, dataDir: string): DataDirMigration {
  const to = path.resolve(dataDir)
  if (fs.existsSync(to)) return { migrated: false, reason: 'new-exists' }

  const parent = path.dirname(path.resolve(userData))
  for (const appName of LEGACY_APP_NAMES) {
    const from = path.join(parent, appName, LEGACY_SUBDIR)
    if (!fs.existsSync(from)) continue
    fs.mkdirSync(path.dirname(to), { recursive: true })
    fs.cpSync(from, to, { recursive: true })
    return { migrated: true, from, to }
  }
  return { migrated: false, reason: 'no-legacy' }
}
