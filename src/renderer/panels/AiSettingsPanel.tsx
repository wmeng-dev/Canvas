// C.6 AI 后端设置面板：配置 DeepSeek 直连密钥、增删/启停 MCP Server。
// 每次保存都回主进程"重建注册表"，因此返回的视图里 generatorCount 就是实际可用后端数。
//
// 样式：这是个模态（复用 .dialog 的材质语言），但内容是长表单、需要整体滚动 →
// 见 styles.css 的 .dialog--scroll（重写为 block，否则 flex 子项会被挤扁而不是滚动）。
// **只有数据驱动的色值留内联**：连接状态的色、以及色点。

import { useEffect, useState } from 'react'
import { useTreeStore } from '../store/treeStore'

const STATE_LABEL: Record<string, string> = {
  connected: '已连接',
  disabled: '已停用',
  error: '连接失败',
  pending: '待连接',
}

const STATE_COLOR: Record<string, string> = {
  connected: '#3fb950',
  disabled: '#7d8590',
  error: '#f85149',
  pending: '#d29922',
}

function parseLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean)
}

function parseEnv(text: string): Record<string, string> {
  const out: Record<string, string> = {}
  for (const line of parseLines(text)) {
    const i = line.indexOf('=')
    if (i > 0) out[line.slice(0, i).trim()] = line.slice(i + 1).trim()
  }
  return out
}

export function AiSettingsPanel() {
  const open = useTreeStore((s) => s.aiOpen)
  const view = useTreeStore((s) => s.aiSettings)
  const busy = useTreeStore((s) => s.aiBusy)
  const closeAi = useTreeStore((s) => s.closeAi)
  const setDeepSeekKey = useTreeStore((s) => s.setDeepSeekKey)
  const clearDeepSeekKey = useTreeStore((s) => s.clearDeepSeekKey)
  const addMcpServer = useTreeStore((s) => s.addMcpServer)
  const removeMcpServer = useTreeStore((s) => s.removeMcpServer)
  const setMcpServerEnabled = useTreeStore((s) => s.setMcpServerEnabled)

  const [keyDraft, setKeyDraft] = useState('')
  const [showAdd, setShowAdd] = useState(false)
  const [f, setF] = useState({ name: '', command: '', args: '', env: '' })

  useEffect(() => {
    if (open) {
      setKeyDraft('')
      setShowAdd(false)
      setF({ name: '', command: '', args: '', env: '' })
    }
  }, [open])

  if (!open) return null

  const ds = view?.deepseek
  const plaintextFallback = ds?.protection === 'plaintext'

  const submitAdd = () => {
    if (!f.command.trim()) return
    void addMcpServer({
      name: f.name.trim() || '未命名 Server',
      command: f.command.trim(),
      args: parseLines(f.args),
      env: parseEnv(f.env),
      enabled: true,
    })
    setShowAdd(false)
    setF({ name: '', command: '', args: '', env: '' })
  }

  return (
    <div
      data-testid="ai-panel"
      className="dialog-backdrop dialog-backdrop--top"
      onClick={() => !busy && closeAi()}
    >
      <div
        className="dialog dialog--roomy dialog--scroll"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="dialog__head">
          <h2 className="dialog__title">AI 后端</h2>
          <div className="dialog__head-spacer" />
          <span data-testid="generator-count" className="text-muted inline-note">
            可用生成器 {view?.generatorCount ?? 0}
          </span>
          <button data-testid="ai-close" onClick={closeAi} className="btn btn--sm">
            关闭
          </button>
        </div>
        <p className="dialog__sub">配置直连模型与 MCP 工具服务；保存后立即生效（下次生成即可选用）。</p>

        {/* ---------- DeepSeek ---------- */}
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__title">DeepSeek 直连</span>
            <span
              data-testid="ds-status"
              className={`badge${ds?.configured ? ' badge--on' : ' badge--off'}`}
            >
              {ds?.configured ? `已配置 ${ds.masked}` : '未配置'}
            </span>
            {ds?.configured && (
              <span
                className={`inline-note ${plaintextFallback ? 'text-warn' : 'text-muted'}`}
              >
                {plaintextFallback ? '明文存储' : 'safeStorage 加密存储'}
              </span>
            )}
          </div>

          {plaintextFallback && (
            <p
              data-testid="ds-plaintext-warning"
              className="settings-note settings-note--warn"
            >
              当前系统没有可用的加密后端（Keychain / DPAPI / libsecret），密钥将以明文写入
              settings.json。请仅在受信任的本机使用。
            </p>
          )}

          <div className="settings-row">
            <input
              data-testid="ds-input"
              type="password"
              placeholder="sk-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              className="input"
            />
            <button
              data-testid="ds-save"
              disabled={busy || !keyDraft.trim()}
              onClick={() => {
                void setDeepSeekKey(keyDraft)
                setKeyDraft('')
              }}
              className="btn btn--primary"
            >
              保存
            </button>
            <button
              data-testid="ds-clear"
              disabled={busy || !ds?.configured}
              onClick={() => void clearDeepSeekKey()}
              className="btn"
            >
              清除
            </button>
          </div>
        </section>

        {/* ---------- MCP ---------- */}
        <section className="settings-section">
          <div className="settings-section__head">
            <span className="settings-section__title">MCP Server</span>
            <div className="settings-section__spacer" />
            <button
              data-testid="mcp-add-sample"
              disabled={busy || !view?.exampleMcpServer}
              onClick={() => {
                const t = view?.exampleMcpServer
                if (!t) return
                void addMcpServer({
                  name: t.name,
                  command: t.command,
                  args: t.args,
                  env: t.env,
                  cwd: t.cwd,
                  enabled: true,
                })
              }}
              className="btn btn--sm"
            >
              添加本地示例 Server
            </button>
            <button
              data-testid="mcp-toggle-form"
              onClick={() => setShowAdd((v) => !v)}
              className="btn btn--sm"
            >
              {showAdd ? '收起表单' : '手动添加'}
            </button>
          </div>

          <ul data-testid="mcp-list" className="mcp-list">
            {(view?.mcpServers ?? []).length === 0 && (
              <li className="mcp-list__empty">还没有配置 MCP Server。</li>
            )}
            {(view?.mcpServers ?? []).map((m) => (
              <li
                key={m.id}
                data-testid="mcp-item"
                data-server-id={m.id}
                data-state={m.status.state}
                className="mcp-item"
              >
                <div className="mcp-item__head">
                  <span className="mcp-item__name">{m.name}</span>
                  <span
                    data-testid="mcp-state"
                    className="mcp-item__state"
                    /* 状态色来自 STATE_COLOR（数据 → 连接结果），必须内联 */
                    style={{ color: STATE_COLOR[m.status.state] }}
                  >
                    {STATE_LABEL[m.status.state]}
                    {m.status.state === 'connected' ? ` · ${m.status.tools.length} 个工具` : ''}
                  </span>
                  <div className="mcp-item__spacer" />
                  <label className="mcp-item__enable">
                    <input
                      data-testid="mcp-enabled"
                      type="checkbox"
                      checked={m.enabled}
                      disabled={busy}
                      onChange={(e) => void setMcpServerEnabled(m.id, e.target.checked)}
                    />
                    启用
                  </label>
                  <button
                    data-testid="mcp-remove"
                    disabled={busy}
                    onClick={() => void removeMcpServer(m.id)}
                    className="btn btn--sm btn--danger"
                  >
                    删除
                  </button>
                </div>
                <div data-testid="mcp-command" className="mcp-item__cmd">
                  {m.command} {m.args.join(' ')}
                </div>
                {m.status.error && (
                  <div data-testid="mcp-error" className="mcp-item__err">
                    {m.status.error}
                  </div>
                )}
                {m.status.tools.length > 0 && (
                  <div data-testid="mcp-tools" className="mcp-item__tools">
                    工具：{m.status.tools.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {showAdd && (
            <div data-testid="mcp-form" className="settings-form">
              <div className="field-stack">
                <span className="settings-form__label">名称</span>
                <input
                  data-testid="mcp-form-name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  className="input"
                />
              </div>
              <div className="field-stack">
                <span className="settings-form__label">命令（可执行文件）</span>
                <input
                  data-testid="mcp-form-command"
                  value={f.command}
                  onChange={(e) => setF({ ...f, command: e.target.value })}
                  className="input"
                />
              </div>
              <div className="field-stack">
                <span className="settings-form__label">参数（每行一个）</span>
                <textarea
                  data-testid="mcp-form-args"
                  rows={2}
                  value={f.args}
                  onChange={(e) => setF({ ...f, args: e.target.value })}
                  className="textarea"
                />
              </div>
              <div className="field-stack">
                <span className="settings-form__label">环境变量（每行 KEY=VALUE）</span>
                <textarea
                  data-testid="mcp-form-env"
                  rows={2}
                  value={f.env}
                  onChange={(e) => setF({ ...f, env: e.target.value })}
                  className="textarea"
                />
              </div>
              <div className="settings-form__actions">
                <button className="btn" onClick={() => setShowAdd(false)}>
                  取消
                </button>
                <button
                  data-testid="mcp-form-submit"
                  disabled={busy || !f.command.trim()}
                  onClick={submitAdd}
                  className="btn btn--primary"
                >
                  添加
                </button>
              </div>
            </div>
          )}
        </section>
      </div>
    </div>
  )
}
