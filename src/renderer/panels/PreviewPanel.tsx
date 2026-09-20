// C.2/C.4/C.5/D.3 预览面板：选中节点 → 按 contentType 预览 + 版本历史（可翻案）+ 重新生成。
// 类型分发见 previews/ContentPreview.tsx。
// D.3：面板宽度可拖左边缘调整（不再固定 340），双击把手复位。

import { useState } from 'react'
import { useTreeStore, PREVIEW_WIDTH_MAX, PREVIEW_WIDTH_MIN } from '../store/treeStore'
import { ContentPreview } from '../previews/ContentPreview'
import type { ContentType } from '../../shared/types'

const TYPE_LABEL: Record<ContentType, string> = {
  markdown: 'Markdown',
  html: 'HTML',
  svg: 'SVG',
  text: '纯文本',
  image: '图片',
}

function shortTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export function PreviewPanel() {
  const node = useTreeStore(
    (s) => s.nodes.find((n) => n.id === s.selectedNodeId) ?? null,
  )
  const openDialog = useTreeStore((s) => s.openDialog)
  const regenerate = useTreeStore((s) => s.regenerate)
  const setVersion = useTreeStore((s) => s.setVersion)
  const regeneratingId = useTreeStore((s) => s.regeneratingId)
  const width = useTreeStore((s) => s.previewWidth)
  const setPreviewWidth = useTreeStore((s) => s.setPreviewWidth)
  const resetPreviewWidth = useTreeStore((s) => s.resetPreviewWidth)
  const [dragging, setDragging] = useState(false)

  /** 拖左边缘改宽：面板贴右边，指针左移 → 变大。 */
  const onResizeStart = (e: React.MouseEvent) => {
    e.preventDefault() // 阻止拖拽时选中文本（不影响 dblclick）
    const startX = e.clientX
    const startW = width
    setDragging(true)
    document.body.style.cursor = 'col-resize'
    document.body.style.userSelect = 'none'
    const onMove = (ev: MouseEvent) => setPreviewWidth(startW + (startX - ev.clientX))
    const onUp = () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
      document.body.style.cursor = ''
      document.body.style.userSelect = ''
      setDragging(false)
    }
    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
  }

  const contentType = (node?.data.contentType ?? 'markdown') as ContentType
  const versions = node?.data.versions ?? []
  const currentVersionId = node?.data.currentVersionId ?? null
  const busy = !!node && regeneratingId === node.id

  const btn: React.CSSProperties = {
    background: 'transparent',
    color: '#58a6ff',
    border: '1px solid #30363d',
    borderRadius: 6,
    padding: '3px 10px',
    fontSize: 12,
    cursor: 'pointer',
  }

  return (
    <aside
      data-testid="preview-panel"
      data-width={width}
      style={{
        width,
        flex: `0 0 ${width}px`,
        minWidth: 0,
        position: 'relative',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
        borderLeft: '1px solid #21262d',
        background: '#0b0f14',
        boxSizing: 'border-box',
      }}
    >
      {/* 拖拽把手：贴左边缘，拖动改宽，双击复位 */}
      <div
        data-testid="preview-resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="拖动调整预览宽度"
        title={`拖动调整宽度（${PREVIEW_WIDTH_MIN}–${PREVIEW_WIDTH_MAX}px，双击复位）`}
        onMouseDown={onResizeStart}
        onDoubleClick={resetPreviewWidth}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          bottom: 0,
          width: 7,
          cursor: 'col-resize',
          zIndex: 5,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          background: dragging ? '#1f6feb22' : 'transparent',
        }}
      >
        <div
          style={{
            width: 2,
            height: 40,
            borderRadius: 2,
            background: dragging ? '#58a6ff' : '#30363d',
          }}
        />
      </div>
      {/* 滚动区独立成层：把手在它外面，滚内容时把手不会跟着滚走 */}
      <div
        data-testid="preview-scroll"
        style={{ flex: 1, overflowY: 'auto', padding: 16, boxSizing: 'border-box' }}
      >
      <h2 style={{ fontSize: 13, letterSpacing: 0.5, margin: '0 0 12px', color: '#7d8590' }}>
        节点预览
      </h2>
      {!node ? (
        <p style={{ color: '#7d8590', fontSize: 13, lineHeight: 1.6 }}>
          点击画布中的节点查看内容。
        </p>
      ) : (
        <div>
          <div style={{ fontWeight: 600, fontSize: 15, marginBottom: 6, color: '#e6edf3' }}>
            {node.data.label}
          </div>

          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <span
              data-testid="preview-type"
              style={{
                fontSize: 11,
                color: '#58a6ff',
                border: '1px solid #1f6feb55',
                background: '#1f6feb1a',
                borderRadius: 4,
                padding: '1px 6px',
              }}
            >
              {TYPE_LABEL[contentType]}
            </span>
            <button data-testid="branch-from-node" onClick={() => openDialog(node.id)} style={btn}>
              从这里发散
            </button>
            <button
              data-testid="regenerate-node"
              disabled={busy}
              onClick={() => void regenerate(node.id)}
              style={{ ...btn, color: busy ? '#7d8590' : '#58a6ff', cursor: busy ? 'wait' : 'pointer' }}
            >
              {busy ? '重新生成中…' : '重新生成'}
            </button>
          </div>

          <ContentPreview contentType={contentType} content={node.data.content ?? ''} />

          {versions.length > 0 && (
            <div data-testid="version-history" style={{ marginTop: 20 }}>
              <h3
                style={{
                  fontSize: 12,
                  letterSpacing: 0.5,
                  color: '#7d8590',
                  margin: '0 0 8px',
                  borderTop: '1px solid #21262d',
                  paddingTop: 12,
                }}
              >
                版本历史（{versions.length}）
              </h3>
              <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                {[...versions].reverse().map((v) => {
                  const index = versions.indexOf(v) + 1
                  const isCurrent = v.id === currentVersionId
                  return (
                    <li
                      key={v.id}
                      data-testid="version-item"
                      data-current={isCurrent ? '1' : '0'}
                      data-version={index}
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        padding: '6px 8px',
                        marginBottom: 4,
                        borderRadius: 6,
                        background: isCurrent ? '#1f6feb1a' : '#161b22',
                        border: `1px solid ${isCurrent ? '#1f6feb55' : '#21262d'}`,
                        fontSize: 12,
                        color: '#c9d1d9',
                      }}
                    >
                      <span style={{ fontWeight: 600 }}>v{index}</span>
                      <span style={{ color: '#7d8590', fontSize: 11 }}>{shortTime(v.createdAt)}</span>
                      <span style={{ flex: 1 }} />
                      {isCurrent ? (
                        <span style={{ color: '#58a6ff', fontSize: 11 }}>当前</span>
                      ) : (
                        <button
                          data-testid="version-revert"
                          data-version={index}
                          onClick={() => void setVersion(node.id, v.id)}
                          style={{
                            background: 'transparent',
                            color: '#58a6ff',
                            border: '1px solid #30363d',
                            borderRadius: 4,
                            padding: '1px 8px',
                            fontSize: 11,
                            cursor: 'pointer',
                          }}
                        >
                          翻案
                        </button>
                      )}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </div>
      )}
      </div>
    </aside>
  )
}
