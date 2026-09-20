// D.1 导出对话框：选格式（Markdown / 单文件 HTML）+ 选范围（整棵树 / 根→选中节点链路）→ 导出。
//
// 渲染放渲染端（html 复用预览组件；markdown 走 core 纯函数），主进程只负责系统保存对话框 + 落盘。
// 项目快照通过 ensureProject() 现取（该调用幂等），保证导出的是磁盘上的权威内容。

import { useEffect, useMemo, useState } from 'react'
import { useTreeStore } from '../store/treeStore'
import { buildOutline, renderMarkdown, suggestedFileName } from '../../core/export'
import type { ExportFormat, ExportScope } from '../../core/export'
import { renderStandaloneHtml } from '../export/standaloneHtml'
import type { ProjectFile } from '../../shared/types'

const labelStyle: React.CSSProperties = { fontSize: 12, color: '#7d8590' }
const fieldStyle: React.CSSProperties = {
  background: '#010409',
  color: '#e6edf3',
  border: '1px solid #30363d',
  borderRadius: 6,
  padding: '6px 8px',
  fontSize: 12,
}

export function ExportDialog() {
  const open = useTreeStore((s) => s.exportOpen)
  const closeExport = useTreeStore((s) => s.closeExport)
  const selectedNodeId = useTreeStore((s) => s.selectedNodeId)
  const projectName = useTreeStore((s) => s.projectName)

  const [format, setFormat] = useState<ExportFormat>('markdown')
  const [scope, setScope] = useState<ExportScope>('tree')
  const [file, setFile] = useState<ProjectFile | null>(null)
  const [busy, setBusy] = useState(false)
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null)

  // 每次打开：重置状态并现取项目快照
  useEffect(() => {
    if (!open) return
    setResult(null)
    setBusy(false)
    setFormat('markdown')
    setScope('tree')
    const api = window.diverge
    if (!api) {
      setFile(null)
      return
    }
    let alive = true
    api
      .ensureProject()
      .then((f) => {
        if (alive) setFile(f)
      })
      .catch(() => {
        if (alive) setFile(null)
      })
    return () => {
      alive = false
    }
  }, [open])

  const hasSelection = !!selectedNodeId
  const selectedLabel = useTreeStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId)?.data.label ?? null,
  )

  const doc = useMemo(() => {
    if (!file) return null
    return buildOutline(file, {
      scope: scope === 'path' ? 'path' : 'tree',
      nodeId: scope === 'path' ? selectedNodeId ?? undefined : undefined,
    })
  }, [file, scope, selectedNodeId])

  if (!open) return null

  const contentSize = doc
    ? (format === 'html' ? renderStandaloneHtml(doc) : renderMarkdown(doc)).length
    : 0

  const doExport = async () => {
    if (!doc) return
    const api = window.diverge
    if (!api) {
      setResult({ ok: false, text: '需要主进程支持才能导出到文件。' })
      return
    }
    setBusy(true)
    setResult(null)
    try {
      const content = format === 'html' ? renderStandaloneHtml(doc) : renderMarkdown(doc)
      const res = await api.saveExport({
        suggestedName: suggestedFileName(doc, format),
        content,
      })
      if (res.saved) setResult({ ok: true, text: `已导出到：${res.path}` })
      else if (res.error) setResult({ ok: false, text: `导出失败：${res.error}` })
      else setResult({ ok: true, text: '已取消保存。' })
    } catch (e) {
      setResult({ ok: false, text: `导出失败：${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      data-testid="export-dialog"
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(1, 4, 9, 0.72)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 60,
      }}
      onClick={() => !busy && closeExport()}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 520,
          maxWidth: 'calc(100vw - 48px)',
          background: '#0d1117',
          border: '1px solid #30363d',
          borderRadius: 10,
          padding: 20,
          boxShadow: '0 16px 48px rgba(0,0,0,0.6)',
        }}
      >
        <h2 style={{ fontSize: 15, margin: '0 0 4px', color: '#e6edf3' }}>导出</h2>
        <p style={{ fontSize: 12, color: '#7d8590', margin: '0 0 14px' }}>{projectName}</p>

        {/* 范围 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <label style={labelStyle}>范围</label>
          <select
            data-testid="export-scope"
            value={scope}
            onChange={(e) => setScope(e.target.value as ExportScope)}
            style={{ ...fieldStyle, flex: 1 }}
          >
            <option value="tree">完整发散树（全部节点）</option>
            <option value="path">收敛路径（根 → 选中节点）</option>
          </select>
        </div>
        <p style={{ ...labelStyle, margin: '6px 0 0' }} data-testid="export-selection-hint">
          {scope === 'path'
            ? hasSelection
              ? `将导出到「${selectedLabel ?? '选中节点'}」为止的链路`
              : '当前没有选中节点，已按完整发散树导出'
            : '按父子层级展开，呈现发散全貌'}
        </p>

        {/* 格式 */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 12 }}>
          <label style={labelStyle}>格式</label>
          <select
            data-testid="export-format"
            value={format}
            onChange={(e) => setFormat(e.target.value as ExportFormat)}
            style={{ ...fieldStyle, flex: 1 }}
          >
            <option value="markdown">Markdown（.md）</option>
            <option value="html">单文件 HTML（.html，内联样式）</option>
          </select>
        </div>

        {/* 概览 */}
        <div
          data-testid="export-summary"
          style={{
            marginTop: 14,
            padding: '10px 12px',
            background: '#161b22',
            border: '1px solid #21262d',
            borderRadius: 8,
            fontSize: 12,
            color: '#8b949e',
          }}
        >
          <div>
            将导出 <strong data-testid="export-node-count" style={{ color: '#e6edf3' }}>{doc?.nodes.length ?? 0}</strong> 个节点 ·
            约 {contentSize} 字符
          </div>
          <div data-testid="export-preview-list" style={{ marginTop: 6, lineHeight: 1.6 }}>
            {(doc?.nodes ?? [])
              .slice(0, 6)
              .map((n) => `${'·'.repeat(n.depth + 1)} ${n.label}`)
              .join('\n')}
            {(doc?.nodes.length ?? 0) > 6 ? `\n… 其余 ${doc!.nodes.length - 6} 个` : ''}
          </div>
        </div>

        {result && (
          <p
            data-testid="export-result"
            style={{
              color: result.ok ? '#3fb950' : '#f85149',
              fontSize: 12,
              margin: '12px 0 0',
              wordBreak: 'break-all',
            }}
          >
            {result.text}
          </p>
        )}

        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 18 }}>
          <button
            data-testid="export-close"
            onClick={() => closeExport()}
            disabled={busy}
            style={{
              background: 'transparent',
              color: '#c9d1d9',
              border: '1px solid #30363d',
              borderRadius: 6,
              padding: '7px 14px',
              fontSize: 13,
              cursor: busy ? 'not-allowed' : 'pointer',
            }}
          >
            关闭
          </button>
          <button
            data-testid="export-submit"
            onClick={doExport}
            disabled={busy || !doc || doc.nodes.length === 0}
            style={{
              background: busy || !doc ? '#1f6feb88' : '#1f6feb',
              color: '#fff',
              border: '1px solid #1f6feb',
              borderRadius: 6,
              padding: '7px 16px',
              fontSize: 13,
              fontWeight: 600,
              cursor: busy ? 'wait' : 'pointer',
            }}
          >
            {busy ? '导出中…' : '选择位置并导出'}
          </button>
        </div>
      </div>
    </div>
  )
}
