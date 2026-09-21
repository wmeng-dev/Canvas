# IdeaSprout 画布 MCP 接入配置说明（AI 可执行版）

> **这份文档是给 AI 用的执行手册**，不是给人看的介绍文。
> AI 读到它应当能**自己把 MCP 配好并验证通过**，不需要人再解释一遍。
> 目标：让 Codex CLI / Trae / WorkBuddy / DeepSeek Harness（DSH）等支持 MCP 的客户端，
> 都能直接读取「风衍 IdeaSprout」里的画布数据（项目、发散树、节点版本），并可选地调用生成能力。

---

## 0. 给 AI 的执行清单（按顺序做，不要跳步）

| 步骤 | 做什么 | 做完的判据 |
| --- | --- | --- |
| 1 | 确认前置条件（§1） | Node ≥ 18；`dist-electron/core/mcp-server/workbuddy-mcp-server.js` 存在；知道数据目录 |
| 2 | 确定两个路径变量 `{REPO}` 和 `{DATA_DIR}`（§2） | 两个绝对路径都拿到手 |
| 3 | 按目标客户端写入配置片段（§3，可多选） | 配置文件内容正确落盘 |
| 4 | 让它生效（§4：重启客户端 / Trust） | 客户端已重新加载配置 |
| 5 | **显式调用一次工具**验证（§5） | `list_projects` 返回了项目数组 |
| 6 | 失败就查 §6，修完回到第 5 步 | — |

⚠️ **第 5 步必须用显式调用验证**，不要只在对话里问「MCP 能用吗」——模型会凭印象回答「正常」而实际一个工具都没挂上。

---

## 1. 前置条件

1. **Node.js ≥ 18**（MCP SDK 要求）。`node -v` 检查。
2. **画布仓库已构建出 MCP server 产物**：
   `<仓库>/dist-electron/core/mcp-server/workbuddy-mcp-server.js`
   不存在就在仓库根目录跑：`npm run build:main`（只编译主进程与 core，几秒）。
3. **画布数据目录**：下面二者之一能定位到 `projects/` 目录
   - 显式（推荐）：设环境变量 `IDEASPROUT_DATA_DIR`，指向**含 `projects/` 子目录**的目录。
   - 不设也能用，server 会自动找标准 userData 路径（见 §2 表格）。
4. **DeepSeek key（可选）**：只有 `generate` 工具需要（联网调模型）。
   只用三个只读工具（`list_projects` / `get_tree` / `get_node`）就不用配 key。

---

## 2. 统一启动参数（所有客户端共用这一段）

```
command: node
args:    ["{REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js"]
env:     IDEASPROUT_DATA_DIR = "{DATA_DIR}"     # 推荐显式给；不给则走自动查找
         DEEPSEEK_API_KEY = "sk-..."         # 可选，仅 generate 需要
```

- 传输方式：**stdio**（本地进程，stdin/stdout 通信），不需要端口、不需要起服务。
- **不要**加 `ELECTRON_RUN_AS_NODE`。那是画布**内部**拉起外部 MCP server 时用 Electron 当 Node 的技巧；这里直接用 `node`。
- 路径里的反斜杠：JSON 中必须写成 `\\`（如 `E:\\Canvas\\...`），TOML 中用普通字符串即可。

### 数据目录怎么找（不设 `IDEASPROUT_DATA_DIR` 时的自动查找顺序）

| 平台 | 候选路径 |
| --- | --- |
| Windows | `%APPDATA%\风衍 IdeaSprout\ideasprout\projects`、`%APPDATA%\ideasprout-desktop\ideasprout\projects` |
| macOS | `~/Library/Application Support/风衍 IdeaSprout/ideasprout/projects`（开发名 `ideasprout-desktop` 同理） |
| Linux | `$XDG_CONFIG_HOME` 或 `~/.config` 下的 `<应用名>/ideasprout/projects` |

> 自动查找靠"目录存在"判定；**推荐显式设 `IDEASPROUT_DATA_DIR`**，省掉一半排障时间。

---

## 3. 各客户端配置片段

server 在客户端里叫什么名字可自定，下文统一用 **`ideasprout`**。

### 3.1 Codex CLI

- 配置文件：`~/.codex/config.toml`（或项目级 `.codex/config.toml`）
- 顶层键是 **`mcp_servers`**（不是 `mcpServers`）

```toml
[mcp_servers.ideasprout]
command = "node"
args = ["{REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js"]
env = { IDEASPROUT_DATA_DIR = "{DATA_DIR}", DEEPSEEK_API_KEY = "sk-可选" }
startup_timeout_sec = 20
```

命令行等价写法（不想手改文件时用）：

```bash
codex mcp add ideasprout --env IDEASPROUT_DATA_DIR={DATA_DIR} -- node {REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js
```

`codex mcp list` 可查看已配置的 server。

### 3.2 Trae

- **Trae 中国版**：`%APPDATA%\Trae CN\User\mcp.json`（Windows）/
  `~/Library/Application Support/Trae CN/User/mcp.json`（macOS）
- **Trae 国际版**：`%APPDATA%\Trae\User\mcp.json` / `~/Library/Application Support/Trae/User/mcp.json`
- **项目级**：仓库根目录 `.trae/mcp.json`（需在 Trae 的 MCP 面板确认项目配置导入已启用）
- 版本差异导致路径不一致时，直接在系统里搜 `mcp.json`（在 `Trae` 相关目录下那个即是）。

```json
{
  "mcpServers": {
    "ideasprout": {
      "command": "node",
      "args": ["{REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js"],
      "env": {
        "IDEASPROUT_DATA_DIR": "{DATA_DIR}",
        "DEEPSEEK_API_KEY": "sk-可选"
      }
    }
  }
}
```

### 3.3 WorkBuddy

- 配置文件：`~/.workbuddy/mcp.json`（**不要**写成 `.mcp.json`）
- 写入后**不会自动生效**：需到「连接器管理」页右上角自定义连接器入口，对新 server 点 **Trust** 才会启用。

```json
{
  "mcpServers": {
    "ideasprout": {
      "command": "node",
      "args": ["{REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js"],
      "env": {
        "IDEASPROUT_DATA_DIR": "{DATA_DIR}",
        "DEEPSEEK_API_KEY": "sk-可选"
      }
    }
  }
}
```

### 3.4 DeepSeek Harness（DSH）

- 配置文件：**项目根目录 `.mcp.json`**（Claude-Code / Cursor 兼容的 `mcpServers` 字典）
- server 名需匹配 `[A-Za-z0-9_-]{1,32}` → `ideasprout` 合规
- 改完**必须重启 Harness 会话**（旧会话不会热加载 MCP 配置）

```json
{
  "mcpServers": {
    "ideasprout": {
      "command": "node",
      "args": ["{REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js"],
      "env": {
        "IDEASPROUT_DATA_DIR": "{DATA_DIR}",
        "DEEPSEEK_API_KEY": "sk-可选"
      }
    }
  }
}
```

### 3.5 其它支持 MCP 的客户端（Cursor / Claude Desktop / Claude Code 等）

配置形状与 3.2~3.4 完全相同（`mcpServers` JSON），只是文件位置不同：

| 客户端 | 配置文件 |
| --- | --- |
| Cursor | `.cursor/mcp.json`（项目级） |
| Claude Code | 项目根 `.mcp.json` 或 `~/.claude.json` |
| Claude Desktop | `%APPDATA%\Claude\claude_desktop_config.json` / `~/Library/Application Support/Claude/claude_desktop_config.json` |
| VS Code | `.vscode/mcp.json`（顶层键是 `servers`，不是 `mcpServers`；stdio 需写 `"type": "stdio"`） |

---

## 4. 让它生效

| 客户端 | 生效动作 |
| --- | --- |
| Codex CLI | 重启 codex 会话 |
| Trae | 重启 Trae；项目级配置需确认导入已启用 |
| WorkBuddy | 连接器管理页对新 server 点 **Trust** |
| DeepSeek Harness | 重启 Harness 会话 |

---

## 5. 验证（必须显式调工具）

**第一步：命令行自检**（不依赖任何客户端，最快定位问题）。

PowerShell：

```powershell
'{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"probe","version":"0"}}}' | node {REPO}/dist-electron/core/mcp-server/workbuddy-mcp-server.js
```

bash / zsh 用 `echo '...' | node ...` 同理。
期望：stdout 打出一行 JSON，`result.serverInfo` 为 `{"name":"workbuddy-ideasprout","version":"0.1.0"}`。
**没有任何输出 / 直接退出 → 入口文件没构建或 node 版本不对，先修这个，别急着改客户端配置。**

**第二步：在客户端里显式调用**（不要问「能用吗」）：

```
调用 MCP 工具 list_projects，不要传参数。
```

期望：返回项目数组（每项含 `id` / `name` / `nodeCount` / `updatedAt`）；空数组说明连通了但数据目录里没项目。

**第三步：读一棵树**：`get_tree`，参数 `{ "projectId": "<上一步拿到的 id>" }`。
期望：返回 `project` + `nodes` + `edges`。

---

## 6. 故障排查

| 现象 | 原因 | 处理 |
| --- | --- | --- |
| 命令行自检无输出 / 秒退 | 没构建产物，或 node < 18 | 跑 `npm run build:main`；升级 node |
| 客户端里看不到任何 `ideasprout` 工具 | 配置文件位置写错，或没重启 / 没 Trust | 核对 §3 的路径；按 §4 生效 |
| 工具在但调用报「找不到画布数据目录」 | `IDEASPROUT_DATA_DIR` 指向的目录下没有 `projects/` | 改成**含 `projects/` 的那个目录** |
| `list_projects` 返回 `[]` | 目录对但没项目文件，或指向了空目录 | 在画布里新建/保存一个项目后重试 |
| `generate` 报鉴权/网络错 | 没设 `DEEPSEEK_API_KEY` 或 key 无效 | 配 key；只要只读能力就把这条删掉 |
| 读到的是旧内容 | server 读的是**磁盘上的项目文件**，不是画布内存态 | 在画布里执行「保存」再读 |
| JSON 里路径报错 | Windows 反斜杠没转义 | 写成 `E:\\Canvas\\...` |
| WorkBuddy 里始终未生效 | 未 Trust | 连接器管理页点 Trust |

---

## 7. 这个 server 提供什么（工具一览）

server 名：`workbuddy-ideasprout`（版本 0.1.0）

| 工具 | 类型 | 入参 | 说明 |
| --- | --- | --- | --- |
| `list_projects` | 只读 | 无 | 列出所有画布：id、名称、节点数、更新时间（按更新时间倒序） |
| `get_tree` | 只读 | `projectId`（id 或项目名）、`includeContent?` | 读整棵发散树（节点 + 边）。默认**不带正文**（避免撑爆上下文），要正文传 `includeContent: true` |
| `get_node` | 只读 | `projectId`、`nodeId` | 读单个节点**全量**数据，含所有历史版本（正文 / 标题 / 可行性评估），适合对比"翻案"前后 |
| `generate` | 生成 | `projectId`、`nodeId`、`prompt`、`parentContext?`、`contentType?` | 调 DeepSeek 生成内容并返回文本（**需要 key，会联网**；不写画布，只返回文本） |

> 三个只读工具都标注了 `readOnlyHint`，可放心交给 AI 自动调用。

---

## 8. 注意事项

1. **数据是只读的**：server 只读取磁盘上的项目 JSON，不会改画布。想让它"写"目前没有对应工具。
2. **读到的是落盘状态**：画布里改动后要先保存，MCP 侧才能读到最新。
3. **密钥不要进版本库**：`.mcp.json` / `mcp.json` 若含 `DEEPSEEK_API_KEY`，建议 `.gitignore` 掉，另提供 `.example` 占位文件。
4. **一个 server 多处复用**：同一份启动参数可在多个客户端同时配置，互不冲突（各自起独立子进程）。
