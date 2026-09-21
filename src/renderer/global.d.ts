// C.3 preload 通过 contextBridge 注入 window.ideasprout；此处为渲染端提供类型。
// 注意：纯浏览器（vite dev/preview，无 Electron）下没有该对象，故为可选。

import type { IdeaSproutApi } from '../shared/ipc'

declare global {
  interface Window {
    ideasprout?: IdeaSproutApi
  }
}

export {}
