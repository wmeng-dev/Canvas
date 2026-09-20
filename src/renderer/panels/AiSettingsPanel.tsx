// C.6 AI 后端设置面板：配置 DeepSeek 直连密钥、增删/启停 MCP Server。
// 每次保存都回主进程"重建注册表"，因此返回的视图里 generatorCount 就是实际可用后端数。

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

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#7d8590' }
const inputStyle: React.CSSProperties = {
  width: '100%',
  boxSizing: 'border-box',
  background: '#010409',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
  outline: 'none',
}
const btnStyle: React.CSSProperties = {
  background: '#1f6feb',
  color: '#fff',
  border: '1px solid #1f6feb',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  fontWeight: 600,
  cursor: 'pointer',
}
const ghostBtnStyle: React.CSSProperties = {
  background: 'transparent',
  color: '#c9d1d9',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 12px',
  fontSize: 12,
  cursor: 'pointer',
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
      onClick={() => !busy && closeAi()}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(1, 4, 9, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 70,
      }}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 600,
          maxWidth: 'calc(100vw - 48px)',
          maxHeight: 'calc(100vh - 80px)',
          overflowY: 'auto',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', marginBottom: 4 }}>
          <h2 style={{ fontSize: 15, margin: 0, color: '#e6edf3' }}>AI 后端</h2>
          <div style={{ flex: 1 }} />
          <span data-testid="generator-count" style={{ fontSize: 11, color: '#7d8590' }}>
            可用生成器 {view?.generatorCount ?? 0}
          </span>
          <button
            data-testid="ai-close"
            onClick={closeAi}
            style={{ ...ghostBtnStyle, marginLeft: 12, padding: '3px 10px' }}
          >
            关闭
          </button>
        </div>
        <p style={{ fontSize: 12, color: '#7d8590', margin: '0 0 16px' }}>
          配置直连模型与 MCP 工具服务；保存后立即生效（下次生成即可选用）。
        </p>

        {/* ---------- DeepSeek ---------- */}
        <section style={{ border: '1px solid #21262d', borderRadius: 8, padding: 14, marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>DeepSeek 直连</span>
            <span
              data-testid="ds-status"
              style={{
                fontSize: 11,
                color: ds?.configured ? '#3fb950' : '#7d8590',
                border: `1px solid ${ds?.configured ? '#3fb95055' : '#30363d'}`,
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {ds?.configured ? `已配置 ${ds.masked}` : '未配置'}
            </span>
            {ds?.configured && (
              <span style={{ fontSize: 11, color: plaintextFallback ? '#d29922' : '#7d8590' }}>
                {plaintextFallback ? '明文存储' : 'safeStorage 加密存储'}
              </span>
            )}
          </div>

          {plaintextFallback && (
            <p
              data-testid="ds-plaintext-warning"
              style={{ fontSize: 11, color: '#d29922', margin: '0 0 10px', lineHeight: 1.6 }}
            >
              当前系统没有可用的加密后端（Keychain / DPAPI / libsecret），密钥将以明文写入
              settings.json。请仅在受信任的本机使用。
            </p>
          )}

          <div style={{ display: 'flex', gap: 8 }}>
            <input
              data-testid="ds-input"
              type="password"
              placeholder="sk-…"
              value={keyDraft}
              onChange={(e) => setKeyDraft(e.target.value)}
              style={{ ...inputStyle, flex: 1 }}
            />
            <button
              data-testid="ds-save"
              disabled={busy || !keyDraft.trim()}
              onClick={() => {
                void setDeepSeekKey(keyDraft)
                setKeyDraft('')
              }}
              style={{ ...btnStyle, opacity: busy || !keyDraft.trim() ? 0.5 : 1 }}
            >
              保存
            </button>
            <button
              data-testid="ds-clear"
              disabled={busy || !ds?.configured}
              onClick={() => void clearDeepSeekKey()}
              style={{ ...ghostBtnStyle, opacity: busy || !ds?.configured ? 0.5 : 1 }}
            >
              清除
            </button>
          </div>
        </section>

        {/* ---------- MCP ---------- */}
        <section style={{ border: '1px solid #21262d', borderRadius: 8, padding: 14 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: '#e6edf3' }}>MCP Server</span>
            <div style={{ flex: 1 }} />
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
              style={{ ...ghostBtnStyle, opacity: busy || !view?.exampleMcpServer ? 0.5 : 1 }}
            >
              添加本地示例 Server
            </button>
            <button
              data-testid="mcp-toggle-form"
              onClick={() => setShowAdd((v) => !v)}
              style={ghostBtnStyle}
            >
              {showAdd ? '收起表单' : '手动添加'}
            </button>
          </div>

          <ul data-testid="mcp-list" style={{ listStyle: 'none', margin: '0 0 10px', padding: 0 }}>
            {(view?.mcpServers ?? []).length === 0 && (
              <li style={{ fontSize: 12, color: '#7d8590', padding: '6px 0' }}>
                还没有配置 MCP Server。
              </li>
            )}
            {(view?.mcpServers ?? []).map((m) => (
              <li
                key={m.id}
                data-testid="mcp-item"
                data-server-id={m.id}
                data-state={m.status.state}
                style={{
                  border: '1px solid #21262d',
                  borderRadius: 6,
                  padding: '8px 10px',
                  marginBottom: 6,
                  background: '#161b22',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span style={{ fontSize: 12, fontWeight: 600, color: '#e6edf3' }}>{m.name}</span>
                  <span
                    data-testid="mcp-state"
                    style={{ fontSize: 11, color: STATE_COLOR[m.status.state] }}
                  >
                    {STATE_LABEL[m.status.state]}
                    {m.status.state === 'connected' ? ` · ${m.status.tools.length} 个工具` : ''}
                  </span>
                  <div style={{ flex: 1 }} />
                  <label style={{ fontSize: 11, color: '#7d8590', display: 'flex', gap: 4 }}>
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
                    style={{ ...ghostBtnStyle, padding: '1px 8px', fontSize: 11 }}
                  >
                    删除
                  </button>
                </div>
                <div
                  data-testid="mcp-command"
                  style={{
                    fontSize: 11,
                    color: '#7d8590',
                    marginTop: 4,
                    wordBreak: 'break-all',
                  }}
                >
                  {m.command} {m.args.join(' ')}
                </div>
                {m.status.error && (
                  <div
                    data-testid="mcp-error"
                    style={{ fontSize: 11, color: '#f85149', marginTop: 4, wordBreak: 'break-word' }}
                  >
                    {m.status.error}
                  </div>
                )}
                {m.status.tools.length > 0 && (
                  <div data-testid="mcp-tools" style={{ fontSize: 11, color: '#58a6ff', marginTop: 4 }}>
                    工具：{m.status.tools.join(', ')}
                  </div>
                )}
              </li>
            ))}
          </ul>

          {showAdd && (
            <div data-testid="mcp-form" style={{ display: 'grid', gap: 8 }}>
              <div>
                <span style={labelStyle}>名称</span>
                <input
                  data-testid="mcp-form-name"
                  value={f.name}
                  onChange={(e) => setF({ ...f, name: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={labelStyle}>命令（可执行文件）</span>
                <input
                  data-testid="mcp-form-command"
                  value={f.command}
                  onChange={(e) => setF({ ...f, command: e.target.value })}
                  style={inputStyle}
                />
              </div>
              <div>
                <span style={labelStyle}>参数（每行一个）</span>
                <textarea
                  data-testid="mcp-form-args"
                  rows={2}
                  value={f.args}
                  onChange={(e) => setF({ ...f, args: e.target.value })}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div>
                <span style={labelStyle}>环境变量（每行 KEY=VALUE）</span>
                <textarea
                  data-testid="mcp-form-env"
                  rows={2}
                  value={f.env}
                  onChange={(e) => setF({ ...f, env: e.target.value })}
                  style={{ ...inputStyle, resize: 'vertical', fontFamily: 'inherit' }}
                />
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button style={ghostBtnStyle} onClick={() => setShowAdd(false)}>
                  取消
                </button>
                <button
                  data-testid="mcp-form-submit"
                  disabled={busy || !f.command.trim()}
                  onClick={submitAdd}
                  style={{ ...btnStyle, opacity: busy || !f.command.trim() ? 0.5 : 1 }}
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
