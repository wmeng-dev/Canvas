# 发散创意画布桌面应用 · Phase 0/1 详细实现计划

> 配套纲领：`发散创意画布桌面应用_方案.md`（v0.1）
> 本文档提供可直接落地的目录结构、核心模块代码骨架、里程碑与验收标准。
> 项目代号建议：**Diverge**（发散）。下文以 `diverge-desktop/` 为仓库根。

---

## 0. 决策基线（本次已拍板）

| # | 决策点 | 结论 |
|---|---|---|
| 1 | 桌面框架 | **Electron**（MVP 快速验证，核心层与 UI 解耦，未来可平移 Tauri） |
| 2 | 目标平台 | **Windows 优先**（10/11，产出 exe 安装包） |
| 3 | MVP AI 后端 | **DeepSeek 直连** + **workbuddy MCP Server（示例）** 两条链路 |
| 4 | 节点内容类型 | MVP：**HTML / Markdown / SVG**；图片生成后置 |
| 5 | 自身暴露 MCP Server | 推迟至 **Phase 3**（MVP 仅作为 MCP Host 接入） |

---

## 1. 技术栈与版本锁定

```
electron            ^31
electron-builder    ^24        # Windows 打包（nsis 安装包）
vite                ^5
@vitejs/plugin-react ^4
react / react-dom   ^18
typescript          ^5
@xyflow/react       ^12        # 创意树画布
zustand             ^4         # 状态管理
better-sqlite3      ^11        # 本地存储（同步 API，适合桌面）
@modelcontextprotocol/sdk  ^1  # MCP 客户端 + 示例 Server
react-markdown      ^9         # Markdown 预览
node                >= 20（本机用 managed 22）
包管理：pnpm（或 npm）
```

---

## 2. 目录结构

```
diverge-desktop/
├── package.json
├── electron-builder.yml
├── vite.config.ts                # 渲染进程构建
├── tsconfig.json / tsconfig.node.json
├── resources/icon.ico
└── src/
    ├── main/                     # Electron 主进程（只做壳 + IPC 桥）
    │   ├── main.ts               # 创建 BrowserWindow，加载 renderer
    │   ├── preload.ts            # contextBridge 暴露安全 API
    │   └── ipc/handlers.ts       # 注册 IPC 处理 → 调 core
    ├── core/                     # ★ 与 UI 解耦，未来可平移 Tauri
    │   ├── model/types.ts        # Project/Tree/Node/Edge/AISource/MCPServer
    │   ├── generator/
    │   │   ├── types.ts          # Generator 接口 / NodeSpec / NodeContent
    │   │   ├── registry.ts       # GeneratorRegistry（按 id 取后端）
    │   │   ├── direct/deepseek.ts
    │   │   └── mcp/
    │   │       ├── McpClientManager.ts   # MCP 子进程生命周期
    │   │       └── McpAdapter.ts         # MCP tool → Generator
    │   ├── mcp-server/
    │   │   └── workbuddy-mcp-server.ts   # 示例 MCP Server（独立进程）
    │   └── storage/
    │       ├── db.ts             # better-sqlite3 初始化
    │       ├── schema.sql        # 建表
    │       └── repositories.ts   # CRUD
    ├── renderer/                 # React 渲染进程
    │   ├── App.tsx
    │   ├── canvas/CreativeTree.tsx
    │   ├── canvas/NodeCard.tsx
    │   ├── canvas/PreviewPanel.tsx
    │   ├── panels/AISourcePanel.tsx
    │   ├── panels/GenerateDialog.tsx
    │   ├── panels/ExportPanel.tsx
    │   ├── store/useTreeStore.ts
    │   └── styles/global.css
    └── shared/ipc-events.ts      # 主/渲染共享的事件名常量
```

---

## 3. 数据模型与存储

### `core/storage/schema.sql`
```sql
CREATE TABLE IF NOT EXISTS project (
  id TEXT PRIMARY KEY, name TEXT, created_at INTEGER
);
CREATE TABLE IF NOT EXISTS tree (
  id TEXT PRIMARY KEY, project_id TEXT, root_node_id TEXT, title TEXT
);
CREATE TABLE IF NOT EXISTS node (
  id TEXT PRIMARY KEY, tree_id TEXT, parent_id TEXT,
  title TEXT, content_type TEXT,          -- html|markdown|svg|image|text
  content TEXT, prompt_spec TEXT,         -- JSON: {prompt,contentType,seed}
  ai_source_id TEXT, version INTEGER,
  created_at INTEGER, status TEXT         -- draft|final
);
CREATE TABLE IF NOT EXISTS edge (
  id TEXT PRIMARY KEY, tree_id TEXT, from_node_id TEXT, to_node_id TEXT, kind TEXT
);
CREATE TABLE IF NOT EXISTS ai_source (
  id TEXT PRIMARY KEY, label TEXT, kind TEXT,  -- direct|mcp
  config TEXT, is_active INTEGER              -- config: JSON(凭证/引用)
);
CREATE TABLE IF NOT EXISTS mcp_server (
  id TEXT PRIMARY KEY, name TEXT, transport TEXT, -- stdio|http
  command TEXT, args TEXT, url TEXT, env TEXT, enabled INTEGER
);
```

### `core/storage/db.ts`（骨架）
```ts
import Database from 'better-sqlite3';
import { app } from 'electron';
import * as path from 'path';
import { schema } from './schema.sql?raw'; // 或读文件字符串

let _db: Database.Database | null = null;
export function getDb(): Database.Database {
  if (_db) return _db;
  const dir = path.join(app.getPath('userData'), 'diverge');
  require('fs').mkdirSync(dir, { recursive: true });
  _db = new Database(path.join(dir, 'diverge.db'));
  _db.pragma('journal_mode = WAL');
  _db.exec(schema);          // schema.sql 内容内联或读取
  return _db;
}
```

---

## 4. 核心抽象层：Generator

### `core/generator/types.ts`
```ts
export type ContentType = 'html' | 'markdown' | 'svg' | 'image' | 'text';

export interface NodeSpec {
  prompt: string;
  contentType: ContentType;
  variationSeed?: number;     // 并行多版时的差异来源
  context?: { nodeId: string; summary: string }[]; // 父/兄弟节点上下文
}

export interface NodeContent {
  contentType: ContentType;
  body: string;               // HTML 字符串 / Markdown / SVG 源码 / 图片 base64 / 文本
  meta?: Record<string, unknown>;
}

export interface Generator {
  id: string;
  label: string;              // UI 中显示的 AI 后端名
  kind: 'direct' | 'mcp';
  isReady(): Promise<boolean>;
  generate(spec: NodeSpec): Promise<NodeContent>;
}

export class GeneratorRegistry {
  private map = new Map<string, Generator>();
  register(g: Generator) { this.map.set(g.id, g); }
  get(id: string): Generator | undefined { return this.map.get(id); }
  list(): Generator[] { return [...this.map.values()]; }
}
```

> 画布只依赖 `GeneratorRegistry.get(id).generate(spec)`，**新增 AI 后端 = 注册一个新 Generator，画布零改动**。

---

## 5. DeepSeek 直连 adapter

### `core/generator/direct/deepseek.ts`
```ts
import type { Generator, NodeSpec, NodeContent } from '../types';

const EP = 'https://api.deepseek.com/v1/chat/completions';

export class DeepSeekGenerator implements Generator {
  id = 'deepseek-direct';
  label = 'DeepSeek（直连）';
  kind = 'direct' as const;
  constructor(private apiKey: string, private model = 'deepseek-chat') {}

  async isReady() { return !!this.apiKey; }

  async generate(spec: NodeSpec): Promise<NodeContent> {
    const sys = `你是创意发散助手。请只输出 ${spec.contentType} 内容，不要解释。`;
    const res = await fetch(EP, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${this.apiKey}` },
      body: JSON.stringify({
        model: this.model,
        messages: [
          { role: 'system', content: sys },
          { role: 'user', content: spec.prompt + (spec.variationSeed ? ` (变体${spec.variationSeed})` : '') },
        ],
        temperature: 0.9,        // 发散：高随机
      }),
    });
    const data = await res.json();
    return { contentType: spec.contentType, body: data.choices[0].message.content };
  }
}
```

---

## 6. MCP 接入

### 6.1 `core/generator/mcp/McpClientManager.ts`
```ts
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import type { McpServerConfig } from '../../model/types';

export class McpClientManager {
  private clients = new Map<string, Client>();

  async connect(cfg: McpServerConfig): Promise<Client> {
    const transport = new StdioClientTransport({
      command: cfg.command,
      args: JSON.parse(cfg.args || '[]'),
      env: JSON.parse(cfg.env || '{}'),
    });
    const client = new Client({ name: 'diverge', version: '0.1' }, { capabilities: {} });
    await client.connect(transport);
    this.clients.set(cfg.id, client);
    return client;
  }
  get(id: string) { return this.clients.get(id); }
  async disconnect(id: string) { await this.clients.get(id)?.close(); this.clients.delete(id); }
}
```

### 6.2 `core/generator/mcp/McpAdapter.ts`
把"暴露了 `generate` tool 的 MCP Server"适配成 `Generator`：
```ts
export class McpAdapter implements Generator {
  id: string; label: string; kind = 'mcp' as const;
  constructor(private serverId: string, private client: Client, private toolName = 'generate') {
    this.id = `mcp:${serverId}`;
    this.label = `MCP·${serverId}`;
  }
  async isReady() { return !!this.client; }
  async generate(spec: NodeSpec): Promise<NodeContent> {
    const r = await this.client.callTool({
      name: this.toolName,
      arguments: { prompt: spec.prompt, contentType: spec.contentType, seed: spec.variationSeed },
    });
    // r.content 为 MCP Content 数组，归一化为 NodeContent
    const text = (r.content as any[]).map(c => c.text ?? '').join('');
    return { contentType: spec.contentType, body: text };
  }
}
```

### 6.3 `core/mcp-server/workbuddy-mcp-server.ts`（示例 Server，独立进程）
用于验证"通过 MCP 接入任意 AI 工具"链路。真实场景替换为任意 AI 工具的 MCP Server。
```ts
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const server = new Server({ name: 'workbuddy-mcp-server', version: '0.1' }, { capabilities: { tools: {} } });

server.setRequestHandler(ListToolsRequestSchema, async () => ({
  tools: [{
    name: 'generate',
    description: '按提示词生成创意内容（示例：内部可接任意 AI）',
    inputSchema: {
      type: 'object',
      properties: {
        prompt: { type: 'string' },
        contentType: { type: 'string', enum: ['html', 'markdown', 'svg', 'text'] },
        seed: { type: 'number' },
      },
      required: ['prompt', 'contentType'],
    },
  }],
}));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const { prompt, contentType, seed } = req.params.arguments as any;
  // 示例实现：调用内部 AI（此处占位，可替换为真实 AI SDK 调用）
  const text = `<!-- workbuddy-mcp-server 生成 (seed=${seed ?? 0}) -->\n${prompt}`;
  return { content: [{ type: 'text', text }] };
});

await server.connect(new StdioServerTransport());
```
> 注册方式：在 `mcp_server` 表写入 `{command:'node', args:'["src/core/mcp-server/workbuddy-mcp-server.ts"]', transport:'stdio'}`，启动时 `McpClientManager.connect` 拉起子进程。

---

## 7. Electron 主进程 + IPC

### `src/shared/ipc-events.ts`
```ts
export const IPC = {
  GENERATE_NODE: 'generate-node',       // {spec, aiSourceId} → NodeContent
  LIST_AI_SOURCES: 'list-ai-sources',
  ADD_MCP_SERVER: 'add-mcp-server',     // 配置 → 连接
  LOAD_TREE: 'load-tree',               // treeId → Tree+Nodes
  SAVE_NODE: 'save-node',               // Node → 落库
  EXPORT: 'export',                     // {treeId, format} → 文件路径
} as const;
```

### `src/main/main.ts`（骨架）
```ts
import { app, BrowserWindow } from 'electron';
import * as path from 'path';
import { registerIpc } from './ipc/handlers';

function createWindow() {
  const win = new BrowserWindow({
    width: 1440, height: 900,
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, sandbox: true },
  });
  if (process.env.VITE_DEV) win.loadURL('http://localhost:5173');
  else win.loadFile(path.join(__dirname, '../renderer/index.html'));
}
app.whenReady().then(() => { registerIpc(); createWindow(); });
```
> 安全：渲染进程 `sandbox: true`；预览不可信 HTML 用独立沙箱 iframe（`sandbox="allow-scripts"` 且 `srcdoc` 隔离，禁止与父页通信）。

---

## 8. 渲染进程（核心交互）

- `canvas/CreativeTree.tsx`：用 `@xyflow/react` 渲染节点图，`nodes`/`edges` 来自 Zustand；节点双击打开 `PreviewPanel`；从节点右键"发散"→ 打开 `GenerateDialog`。
- `canvas/PreviewPanel.tsx`：
  - `html` → `<iframe sandbox="allow-scripts" srcDoc={body} />`（样式注入受限，保证隔离）
  - `markdown` → `<ReactMarkdown>{body}</ReactMarkdown>`
  - `svg` → `dangerouslySetInnerHTML`（仅渲染，不执行脚本）
- `panels/GenerateDialog.tsx`：选 AI 后端（来自 `LIST_AI_SOURCES`）+ 提示词 + 方案数量 N → 循环 N 次并发 `GENERATE_NODE`，每结果建一个子节点并 `SAVE_NODE`。
- `store/useTreeStore.ts`：Zustand 管理 nodes/edges/selected，调用 preload 暴露的 IPC。

---

## 9. Phase 0 里程碑（技术验证，约 1–2 周）

| ID | 任务 | 验收标准（DoD） |
|---|---|---|
| P0-1 | Electron+Vite+React+TS 空壳跑通 | `npm run dev` 打开窗口并渲染一个 React 页面；热更新可用 |
| P0-2 | SQLite 存储层 + 建表 | 启动后 `userData/diverge/diverge.db` 存在，5 张表就位；可插入并读回一条 project |
| P0-3 | DeepSeek 直连 adapter | 配 key 后，给定 prompt 能返回文本并在控制台/预览显示 |
| P0-4 | MCP 接入示例 Server | `McpClientManager` 拉起 `workbuddy-mcp-server`，`listTools` 看到 `generate`，`callTool` 成功返回 |
| P0-5 | 端到端打通 | 画布点节点 → 选 DeepSeek 或 MCP 后端 → 生成内容落库并预览 |

## 10. Phase 1 里程碑（MVP，约 4–6 周）

| ID | 任务 | 验收标准 |
|---|---|---|
| P1-1 | 创意树画布 | React Flow 支持节点增删、父子连线、缩放平移、拖拽；布局稳定 |
| P1-2 | 生成对话框（N 版并行） | 选后端+提示词+数量 N，一次并发生成 N 个子节点 |
| P1-3 | 多类型预览 | HTML(沙箱iframe)/Markdown/SVG 三类正确渲染 |
| P1-4 | 发散/收敛 | 从任意节点继续发散生成子节点；旧版保留，可对比/翻案 |
| P1-5 | 本地存储闭环 | 重启应用后树与节点、资源文件完整恢复 |
| P1-6 | 导出 | 最终方案导出 Markdown / 单文件 HTML（内联 CSS/JS） |
| P1-7 | AI 后端管理 UI | 可视化配置 DeepSeek key；添加/启停 MCP server 并实时状态 |
| P1-8 | Windows 打包 | electron-builder 产出 exe/nsis 安装包，干净机可安装运行 |

---

## 11. Windows 打包（`electron-builder.yml` 要点）
```yaml
appId: com.diverge.desktop
productName: Diverge 发散创意画布
directories:
  output: dist-electron
files: ["dist/**/*", "dist-electron/**/*"]
win:
  target: nsis
  icon: resources/icon.ico
nsis:
  oneClick: false
  allowToChangeInstallationDirectory: true
```
> 注意 `better-sqlite3` 与 MCP SDK 需原生/Electron 重建：`electron-builder` 自动处理；若用 pnpm 需配置 `node-linker=hoisted`。

---

## 12. 风险与注意
- **better-sqlite3 原生模块**：Electron 下需用对应 ABI 重建（`electron-rebuild` 或 builder 钩子）。
- **MCP Server 安全**：stdio Server 命令白名单 + 沙箱进程；仅允许 `generate` 类 tool 接入生成链路。
- **不可信 HTML**：预览一律沙箱 iframe，`srcDoc` 隔离，禁止访问父页/网络（按需求收紧 `sandbox` 属性）。
- **并发生成**：N 版并行需限流（如 4 并发），避免 API 限频；失败节点可单点重试。

---

> 下一步：确认后进入 **P0-1**（搭建 Electron+Vite+React+TS 空壳）。
