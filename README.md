# Canvas
画板工具

## MCP 接入
想让 Codex / Trae / WorkBuddy / DeepSeek Harness 等 AI 客户端读取画布数据，见
[docs/MCP接入配置说明.md](docs/MCP接入配置说明.md)（可直接丢给 AI，让它照着自动配置）。

## 打包
- Windows 安装包：`node scripts/dist-win.cjs`（一条龙：编译 → 打包 → 校验）。
  本机没有符号链接特权时它会自动兜底，并把 exe 的自定义图标与版本信息补回来。
- macOS 的 dmg/zip **只能在 macOS 上构建**：`node scripts/dist.cjs --mac`，
  或走 `docs/ci/github-actions-build.yml` 里的 CI 模板（macos-latest）。
