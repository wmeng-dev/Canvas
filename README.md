# 风衍 IdeaSprout

把一个想法当根节点，用 AI 逐层发散成一棵树：每个节点可预览 / 编辑 / 翻案（保留全部历史版本），
整棵树或某条链路可导出为 Markdown / 单文件 HTML。

纯本地桌面应用：数据落在本机 JSON 文件里，**AI 密钥永不出主进程**。
支持通过 MCP 把画布数据喂给外部 AI 客户端（Codex / Trae / WorkBuddy / DeepSeek Harness 等）。

## 技术栈

Electron 31 · React 18 · TypeScript · Vite 5 · @xyflow/react 12 · zustand · @modelcontextprotocol/sdk

## 架构

四层，依赖单向（`renderer → shared ← main → core`）：

| 目录 | 职责 | 关键约束 |
| --- | --- | --- |
| `src/core` | 存储、生成器、MCP server | 纯逻辑，**不 import electron**，所以能被 Node 单测直接跑 |
| `src/shared` | 跨进程类型与纯函数（IPC 契约、树操作、配色） | 主进程与渲染端共用 |
| `src/main` | 主进程：服务装配、IPC handlers、preload、密钥封装 | 密钥只在这里解密 |
| `src/renderer` | React 界面 | 只能通过 `window.ideasprout` 跟主进程说话 |

约定：

- `src/shared/ipc.ts` 是 IPC 的**单一事实来源**（频道名 + 请求/响应类型 + API 面）。
- 一个画布 = 一个项目文件：`<dataDir>/projects/<id>.json`，结构 `{ project, tree: { nodes, edges } }`。
- 设置与密钥：`<dataDir>/settings.json`（密钥用 `safeStorage` 加密，不可用时降级明文并在界面警示）。
- `dataDir` 默认 `userData/ideasprout`，可用 `IDEASPROUT_DATA_DIR` 覆盖（测试/多套数据靠它）。

## 开发

```bash
npm install
npm run dev        # 编译主进程 + 起 Vite dev server + 起 Electron
```

本机 npm 不可用时（见「故障排查」），等价的手工命令：

```bash
node node_modules/typescript/bin/tsc -p tsconfig.main.json   # 主进程 → dist-electron
node node_modules/vite/bin/vite.js                            # dev server（:5173）
node_modules/.bin/electron .                                  # 另开一个终端起应用
```

## 验证（提交前必跑）

```bash
node scripts/verify.cjs
```

一条命令跑完：类型检查与构建 → 全部单元测试 → 全部端到端探针（真窗口 + 生产 `bootstrap()`）。

```bash
node scripts/verify.cjs --skip-build              # 跳过编译/构建
node scripts/verify.cjs --probes-only             # 只跑探针
node scripts/verify.cjs --probes=probe-security.cjs,probe-comments.cjs
node scripts/verify.cjs --list                    # 列出探针
```

- 单元测试（`tests/*.test.cjs`）跑 `src/core` + `src/shared`，纯 Node，不需要 Electron。
- 端到端探针（`tests/e2e/probe-*.cjs`）起真窗口调生产装配入口，含样式硬断言、拖拽、
  注入防护、单实例锁等；`probe-ui.cjs` 是走查型（只截图，产物 `ui-*.png`，供肉眼比对）。
- 想只跑一个：`python tests/e2e/run-probe.py probe-security.cjs`

⚠️ **手动跑探针时必须清掉 `ELECTRON_RUN_AS_NODE`**，否则 Electron 会退化成 Node、启动即退出
（表现为退出码 0 且没有任何日志，很容易误判成"探针坏了"）。
`scripts/verify.cjs` 和 `tests/e2e/run-probe.py` 里都已经处理过这件事。

## 打包

- **Windows**：`node scripts/dist-win.cjs`（一条龙：编译 → 打包 → 读回字节校验）。
  本机没有符号链接特权时它会自动兜底（`--dir` → 手工补图标/版本信息 → `--prepackaged`），
  并把 exe 的自定义图标与版本信息补回来。别只加 `-c.win.signAndEditExecutable=false` 图省事，
  那会让 exe 丢掉图标和版本信息。
- **macOS**：dmg/zip **只能在 macOS 上构建** —— 在 Mac 上 `node scripts/dist.cjs --mac`，
  或走 CI 模板 `docs/ci/github-actions-build.yml`（macos-latest）。

## 文档

| 文档 | 内容 |
| --- | --- |
| [docs/MCP接入配置说明.md](docs/MCP接入配置说明.md) | 让外部 AI 客户端读画布数据（可直接丢给 AI 照着配） |
| [docs/IdeaSprout桌面应用_方案.md](docs/IdeaSprout桌面应用_方案.md) | 产品与技术方案 |
| [docs/IdeaSprout_开发计划.md](docs/IdeaSprout_开发计划.md) | 分阶段开发计划 |
| [docs/IdeaSprout_实现计划_Phase0-1.md](docs/IdeaSprout_实现计划_Phase0-1.md) | Phase 0-1 实现计划 |

## 故障排查

| 症状 | 原因与处理 |
| --- | --- |
| `npm install` / `npm run` 直接崩 | 本机 npm（arborist）不可用。改直连 node 二进制跑 `tsc` / `vite` / `scripts/*.cjs`，见「开发」一节 |
| `has no exported member 'Node'`、`Cannot find module 'zod/v3/index.cjs'`、`registerTool is not a function` | `node_modules` 顶层不完整（被 pnpm 装过的混合体）。补齐依赖后重跑，别只删 `node_modules` 了事 |
| 打包报 `Cannot create symbolic link … 客户端没有所需的特权` | winCodeSign 里含 macOS 符号链接。用 `scripts/dist-win.cjs`（已内置兜底）；根治是开开发者模式或用管理员运行 |
| 打包报 `remove app.asar: 被另一个进程使用` | 输出目录被安全软件 / 索引器锁住。换一个全新的输出目录（脚本默认按时间戳新建，已规避） |
| 冒烟打包后的 exe 启动即退出、无日志 | 环境里残留了 `ELECTRON_RUN_AS_NODE`，删掉再跑 |
| 双击图标"没反应" | 已加单实例锁：应用只允许一个实例，第二次启动会把已有窗口还原并聚焦。日志会打印 `已有实例在运行` |
