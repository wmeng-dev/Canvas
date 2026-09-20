// C.6 主进程的密钥封装实现：优先使用 Electron safeStorage（Windows 走 DPAPI、macOS 走 Keychain、
// Linux 走 libsecret/kwallet）。系统没有可用加密后端时降级为明文，并让上层能在界面上标出来。
//
// 注意：safeStorage 只有在 app ready 之后才可用。`isEncryptionAvailable()` **不能**在构造时求值，
// 否则任何"服务早于 whenReady 装配"的调用顺序都会让它恒为 false，
// 从而在支持 DPAPI 的机器上悄悄退化成明文存储（安全降级必须是有意为之，不能是顺序副作用）。
// 因此这里把可用性判定做成惰性求值：构造时不探测，真正加密/解密时再探测。

import { app, safeStorage } from 'electron'
import { plaintextSecretBox } from '../core/settings-store'
import type { SecretBox } from '../core/settings-store'

/** 探测真实加密能力；app 未 ready 或系统无后端时返回 false。 */
function detectAvailable(): boolean {
  try {
    // app 未 ready 前调用会抛错或返回 false —— 两种情况都按"暂不可用"处理。
    if (!app.isReady()) return false
    return safeStorage.isEncryptionAvailable()
  } catch {
    return false
  }
}

export function createSecretBox(): SecretBox {
  // 缓存首次成功探测的结果：一旦确认可用就不再回退（避免 ready 前后行为漂移）。
  let cachedAvailable: boolean | null = null
  const isAvailable = (): boolean => {
    if (cachedAvailable === null) {
      cachedAvailable = detectAvailable()
    }
    return cachedAvailable
  }

  const fallback = plaintextSecretBox()

  return {
    get available(): boolean {
      return isAvailable()
    },
    encrypt(plain: string): string {
      if (!isAvailable()) return fallback.encrypt(plain)
      return safeStorage.encryptString(plain).toString('base64')
    },
    decrypt(payload: string): string {
      if (!isAvailable()) return fallback.decrypt(payload)
      return safeStorage.decryptString(Buffer.from(payload, 'base64'))
    },
  }
}
