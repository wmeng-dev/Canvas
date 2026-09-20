// 主进程入口：真正的装配逻辑在 app.ts（bootstrap），此处只做调用。
// 拆分的目的是让 app.ts 可被测试/复用，而 main.ts 保持极薄。

import { bootstrap } from './app'

bootstrap()
