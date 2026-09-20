// C.3 生成对话框：输入一个想法 → 调用主进程生成 → 作为新节点落入画布。
// 纯受控组件，状态取自 treeStore（Zustand）。

import { useEffect, useState } from 'react'
import { useTreeStore } from '../store/treeStore'

export function GenerateDialog() {
  const open = useTreeStore((s) => s.dialogOpen)
  const parentId = useTreeStore((s) => s.dialogParentId)
  const nodes = useTreeStore((s) => s.nodes)
  const generators = useTreeStore((s) => s.generators)
  const generating = useTreeStore((s) => s.generating)
  const error = useTreeStore((s) => s.error)
  const closeDialog = useTreeStore((s) => s.closeDialog)
  const generate = useTreeStore((s) => s.generate)

  const [prompt, setPrompt] = useState('')
  const [generatorId, setGeneratorId] = useState('')

  // 每次打开时重置输入，并默认选中首个生成器
  useEffect(() => {
    if (open) {
      setPrompt('')
      setGeneratorId((prev) => prev || generators[0]?.id || '')
    }
  }, [open, generators])

  if (!open) return null

  const parentLabel = parentId
    ? nodes.find((n) => n.id === parentId)?.data.label ?? '（未知节点）'
    : null

  return (
    <div
      data-testid="generate-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(1, 4, 9, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 50,
      }}
      onClick={() => !generating && closeDialog()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 460,
          maxWidth: 'calc(100vw - 48px)',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <h2 style={{ fontSize: 15, margin: '0 0 4px', color: '#e6edf3' }}>发散新想法</h2>
        <p style={{ fontSize: 12, color: '#7d8590', margin: '0 0 14px' }}>
          {parentLabel ? `基于「${parentLabel}」继续发散` : '在根层新增一个想法'}
        </p>

        <textarea
          data-testid="prompt-input"
          autoFocus
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="描述你想探索的方向，例如：把核心体验做减法，只保留一条主线。"
          rows={4}
          style={{
            width: '100%',
            boxSizing: 'border-box',
            resize: 'vertical',
            background: '#010409',
            color: '#e6edf3',
            border: '1px solid #30363d',
            borderRadius: 6,
            padding: 10,
            fontSize: 13,
            lineHeight: 1.6,
            fontFamily: 'inherit',
            outline: 'none',
          }}
        />

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <label style={{ fontSize: 12, color: '#7d8590' }}>生成器</label>
          <select
            data-testid="generator-select"
            value={generatorId}
            onChange={(e) => setGeneratorId(e.target.value)}
            style={{
              flex: 1,
              background: '#010409',
              color: '#e6edf3',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '6px 8px',
              fontSize: 12,
            }}
          >
            {generators.length === 0 && <option value="">（无可用生成器）</option>}
            {generators.map((g) => (
              <option key={g.id} value={g.id}>
                {g.label}（{g.kind}）
              </option>
            ))}
          </select>
        </div>

        {error && (
          <p data-testid="dialog-error" style={{ color: '#f85149', fontSize: 12, margin: '12px 0 0' }}>
            {error}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            onClick={() => closeDialog()}
            disabled={generating}
            style={{
              background: 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              cursor: generating ? 'not-allowed' : 'pointer',
            }}
          >
            取消
          </button>
          <button
            data-testid="submit-generate"
            onClick={() => generate(prompt, generatorId || undefined)}
            disabled={generating}
            style={{
              background: generating ? '#1f6feb88' : '#1f6feb',
              color: '#fff',
              border: '1px solid #1f6feb',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: generating ? 'wait' : 'pointer',
            }}
          >
            {generating ? '生成中…' : '生成'}
          </button>
        </div>
      </div>
    </div>
  )
}
